import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AnnotationMode, getDocument, OPS, Util, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const coordinateScale = 10000;

export function openPdf(buffer) {
  return getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, maxImageSize: 16_000_000,
    verbosity: VerbosityLevel.ERRORS,
  });
}

export function validCrop(crop, pages = 100) {
  if (!crop || !Number.isInteger(crop.page) || crop.page < 1 || crop.page > pages) return false;
  const { left, top, right, bottom } = crop;
  return [left, top, right, bottom].every((value) => Number.isInteger(value) && value >= 0 && value <= coordinateScale) &&
    right - left >= 20 && bottom - top >= 20;
}

async function render(page, maxSide, operationsFilter) {
  const size = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: maxSide / Math.max(size.width, size.height) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, operationsFilter, annotationMode: AnnotationMode.DISABLE }).promise;
  return { canvas, viewport };
}

export async function renderPage(pdf, pageNumber) {
  const task = openPdf(pdf);
  try {
    const page = await (await task.promise).getPage(pageNumber);
    return (await render(page, 1460)).canvas;
  } finally {
    await task.destroy();
  }
}

export function cropImage(source, crop) {
  const x = Math.floor(crop.left * source.width / coordinateScale);
  const y = Math.floor(crop.top * source.height / coordinateScale);
  const width = Math.ceil(crop.right * source.width / coordinateScale) - x;
  const height = Math.ceil(crop.bottom * source.height / coordinateScale) - y;
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

function graphicRegions(canvas, page) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const unit = 10;
  const columns = Math.ceil(width / unit);
  const rows = Math.ceil(height / unit);
  const bins = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 211) continue;
      const slot = Math.floor(y / unit) * columns + Math.floor(x / unit);
      bins[slot] = Math.min(5, bins[slot] + 1);
    }
  }
  const regions = [];
  for (let slot = 0; slot < bins.length; slot++) {
    if (bins[slot] < 2) continue;
    const pending = [slot];
    bins[slot] = 0;
    let left = columns, right = 0, top = rows, bottom = 0;
    for (let i = 0; i < pending.length; i++) {
      const x = pending[i] % columns;
      const y = Math.floor(pending[i] / columns);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= columns || y + dy < 0 || y + dy >= rows) continue;
          const neighbor = (y + dy) * columns + x + dx;
          if (bins[neighbor] < 2) continue;
          bins[neighbor] = 0;
          pending.push(neighbor);
        }
      }
    }
    const w = (right - left + 1) * unit;
    const h = (bottom - top + 1) * unit;
    if (pending.length < 5 || w < 20 || h < 20 || w / h > 12 || h / w > 12 ||
        (w > width * .86 && h > height * .65)) continue;
    const clamp = (value) => Math.max(0, Math.min(coordinateScale, Math.round(value * coordinateScale)));
    regions.push({
      page, left: clamp((left * unit - 5) / width), top: clamp((top * unit - 5) / height),
      right: clamp(((right + 1) * unit + 5) / width), bottom: clamp(((bottom + 1) * unit + 5) / height),
    });
  }
  return regions;
}

function positionText(items, viewport) {
  const pieces = items.filter((item) => item.str?.trim()).map((item) => {
    const transform = Util.transform(viewport.transform, item.transform);
    return {
      text: item.str.trim(), x: transform[4], y: transform[5],
      width: item.width * viewport.scale, height: Math.max(3, Math.hypot(transform[2], transform[3])),
    };
  });
  return groupRows(pieces, viewport);
}

function groupRows(pieces, viewport) {
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const piece of pieces) {
    const last = rows.at(-1);
    if (last && piece.y - last.y <= Math.max(2, piece.height * .26)) last.pieces.push(piece);
    else rows.push({ y: piece.y, height: piece.height, pieces: [piece] });
  }
  return rows.map((row) => {
    let text = '';
    const segments = row.pieces.sort((a, b) => a.x - b.x).map((piece) => {
      if (text) text += ' ';
      const start = text.length;
      text += piece.text;
      return { ...piece, start, end: text.length };
    });
    return {
      text,
      y: row.y / viewport.height * coordinateScale,
      gap: (row.height * 1.85) / viewport.height * coordinateScale,
      xAt(index) {
        const piece = segments.find((segment) => index < segment.end) ?? segments.at(-1);
        return (piece.x + Math.max(0, index - piece.start) / piece.text.length * piece.width) / viewport.width * coordinateScale;
      },
    };
  });
}

export async function inspectScan(buffer, pageNumber, blocks) {
  const image = await loadImage(buffer);
  const scale = 1040 / Math.max(image.width, image.height);
  const canvas = createCanvas(Math.ceil(image.width * scale), Math.ceil(image.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  const words = (blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)).filter((word) => word.text.trim());
  const pieces = words.map(({ text, bbox }) => {
    const { x0, y0, x1, y1 } = bbox;
    const x = x0 * scale, top = y0 * scale, width = (x1 - x0) * scale, height = (y1 - y0) * scale;
    context.fillRect(x - 2, top - 2, width + 4, height + 4);
    return { text, x, y: top + height, width, height };
  });
  const regions = graphicRegions(canvas, pageNumber);
  return pieces.length && regions.length ? { rows: groupRows(pieces, canvas), regions } : null;
}

const drawing = new Set([OPS.constructPath, OPS.paintImageXObject, OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.shadingFill]);

export async function inspectDiagrams(page) {
  const operators = await page.getOperatorList();
  if (!operators.fnArray.some((op) => drawing.has(op))) return null;
  const { items } = await page.getTextContent();
  if (!items.some((item) => item.str?.trim())) return null;
  const { canvas, viewport } = await render(page, 1040, (index) =>
    operators.fnArray[index] !== OPS.showText && operators.fnArray[index] !== OPS.showSpacedText);
  const regions = graphicRegions(canvas, page.pageNumber);
  if (!regions.length) return null;
  const rows = positionText(items, viewport);
  return rows.length ? { rows, regions } : null;
}

export function attachDiagrams(regions, anchors) {
  for (const crop of regions) {
    const candidates = anchors.filter((anchor) =>
      anchor.page === crop.page && anchor.y <= crop.bottom && anchor.y >= crop.top - 2200 &&
      anchor.x <= crop.right);
    // A figure beside a label shares its row. A figure under a label uses the preceding row.
    const beside = candidates.filter(({ y, x }) => y >= crop.top - 160 && x <= crop.left + 100);
    const above = candidates.filter(({ y }) => y <= crop.top + 160);
    const candidate = (beside.length ? beside : above)
      .sort((a, b) => Math.abs(a.y - b.y) < 65 ? b.x - a.x : b.y - a.y)[0];
    if (candidate?.figures && candidate.figures.length < 4) candidate.figures.push(crop);
  }
}
