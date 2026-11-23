import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const pages = new Map();

async function renderPage(pdf, number) {
  const task = getDocument({ data: await pdf.arrayBuffer(), isEvalSupported: false });
  try {
    const page = await (await task.promise).getPage(number);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1460 / Math.max(original.width, original.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    return canvas;
  } finally {
    await task.destroy();
  }
}

export async function renderPdfImage(id, pdf, number, crop) {
  const key = id + '/' + number;
  const pending = pages.get(key) ?? renderPage(pdf, number);
  pages.delete(key);
  pages.set(key, pending);
  if (pages.size > 4) pages.delete(pages.keys().next().value);
  let fullPage;
  try { fullPage = await pending; }
  catch (error) {
    if (pages.get(key) === pending) pages.delete(key);
    throw error;
  }
  let canvas = fullPage;
  if (crop) {
    const x = Math.floor(crop.left * fullPage.width / 10000);
    const y = Math.floor(crop.top * fullPage.height / 10000);
    const width = Math.ceil(crop.right * fullPage.width / 10000) - x;
    const height = Math.ceil(crop.bottom * fullPage.height / 10000) - y;
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(fullPage, x, y, width, height, 0, 0, width, height);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render this diagram.')), 'image/png');
  });
}
