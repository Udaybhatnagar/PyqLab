import { PDFParse } from 'pdf-parse';
import { choiceOrder, hindiText, normalizeDigits } from '../src/paper-text.js';
import { createPaperWorker } from './ocr.mjs';
import { cleanHindiText } from './hindi-text.mjs';

function normalizeKeyText(text) {
  return normalizeDigits(cleanHindiText(text).normalize('NFKC'))
    .replace(/(?:प्रश्न\s*(?:क्रमांक|संख्या|सं\.?)?)/g, 'Q ')
    .replace(/(?:सही\s+)?उत्तर(?:\s*कुंजी)?/g, 'Answer')
    .replace(/(?:और|तथा)/g, ' and ')
    .replace(/(?<![\p{L}\p{M}])[कखगघङचछज]+(?![\p{L}\p{M}])/gu, (letters) =>
      [...letters].map((letter) => String.fromCharCode(65 + choiceOrder(letter))).join(''))
    .replace(/।/g, '.');
}

export function answerLetters(value) {
  const input = normalizeKeyText(value).trim();
  const compact = input.match(/^\(?([A-H]{2,8})\)?(?=\s*(?:$|[.)–-]))/);
  if (compact) return [...compact[1]];
  return (input.match(/^\(?[A-H]\)?(?:\s*(?:[,;/&+]|and|\s)\s*\(?[A-H]\)?)*(?=\s*(?:$|[.)–-]))/i)?.[0]
    .toUpperCase().match(/\b[A-H]\b/g) ?? []);
}

const keyEntry = /(?:^|[\s;,|])(?:Q(?:uestion)?\.?\s*)?(\d{1,4})[ \t]*(?:[:.)|–—=-]\s*)?(?:(?:Ans(?:wer)?\.?)\s*[:.)–-]?\s*)?(\(?[A-H]{1,8}\)?(?:(?:[ \t]*(?:[,/&+]|\band\b)[ \t]*|[ \t]+(?=\(?[A-H]\)?(?:[ \t,;|]|$)))\(?[A-H]{1,8}\)?)*)\b\)?(?=$|[\s.;|,])/gi;
const numberHeader = /^(?:q(?:uestion)?s?(?:\s*(?:no\.?|numbers?))?)\s*[:|]?\s+/i;
const answerHeader = /^(?:(?:correct\s+)?(?:answers?|options?)|ans\.?)\s*[:|]?\s+/i;
const range = /^(?:Q(?:uestions?)?\.?\s*)?(\d{1,4})\s*(?:[-–—]|\bto\b)\s*(?:Q\.?\s*)?(\d{1,4})\s*(?:[:=|]\s*|\s+)(.+)$/i;
const bareRange = /^(?:Q(?:uestions?)?\.?\s*)?\d{1,4}\s*(?:[-–—]|\bto\b)\s*(?:Q\.?\s*)?\d{1,4}[:=|]?$/i;
const rowNumber = /^(?:Q\.?\s*)?\(?(\d{1,4})\)?[.)]?$/i;

function choiceCell(value, numeric = false) {
  const cell = value.trim();
  if (numeric && /^\(?[1-8]\)?$/.test(cell)) return [String.fromCharCode(64 + Number(cell.replace(/[()]/g, '')))];
  if (!/^\(?[A-H]{1,8}\)?(?:\s*(?:[,/&+]|and)\s*\(?[A-H]\)?)*$/i.test(cell)) return [];
  return answerLetters(cell.toUpperCase());
}

function choiceRow(text, numeric = false) {
  const value = text.trim();
  if (!value) return [];
  const cells = /[|;]/.test(value) ? value.split(/[|;]/).map((cell) => cell.trim()).filter(Boolean) :
    value.match(/\([^)]*\)|[^\s,]+/g) ?? [];
  const choices = cells.map((cell) => choiceCell(cell, numeric));
  return choices.every((letters) => letters.length) ? choices : [];
}

export function readAnswerEntries(text, { sequenceStart } = {}) {
  const entries = [];
  const lines = normalizeKeyText(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sequence = [];
  let numericColumns = false;
  for (let index = 0; index < lines.length; index++) {
    if (/\b(?:option\s+(?:number|no\.?)|correct\s+option)\b/i.test(lines[index]) &&
        /\b(?:question|q\.)/i.test(lines[index])) numericColumns = true;
    const line = lines[index].replace(numberHeader, '');
    const wrappedRange = bareRange.test(line) && Boolean(lines[index + 1]);
    const spans = line.match(range) ?? (wrappedRange ?
      (line.replace(/[:=|]$/, '') + ': ' + lines[index + 1].replace(answerHeader, '')).match(range) : null);
    if (spans) {
      const start = Number(spans[1]);
      const size = Number(spans[2]) - start + 1;
      const spanText = spans[3].trim();
      let choices = /^[A-H]+$/i.test(spanText) && spanText.length === size ?
        [...spanText.toUpperCase()].map((letter) => [letter]) : choiceRow(spanText, true);
      if (choices.length === 1 && choices[0].length === 1) {
        choices = Array.from({ length: Math.min(size, 500) }, () => choices[0]);
      }
      if (size > 0 && size <= 500 && choices.length === size) {
        choices.forEach((choice, offset) => entries.push([start + offset, choice]));
        if (wrappedRange) index++;
      }
      continue;
    }
    const explicitNumeric = line.match(/^(?:Q(?:uestion)?\.?\s*)?(\d{1,4})\s*[:.)|=–—-]\s*(?:\(?([1-8])\)?)$/i) ??
      (numericColumns ? line.match(/^(\d{1,4})\s+([1-8])$/) : null);
    if (explicitNumeric) {
      entries.push([Number(explicitNumeric[1]), choiceCell(explicitNumeric[2], true)]);
      continue;
    }
    const numbers = line.split(/[\s|,]+/).filter(Boolean);
    if (numbers.length && numbers.every((part) => rowNumber.test(part)) && lines[index + 1]) {
      const hasAnswerHeader = answerHeader.test(lines[index + 1]);
      const answersLine = lines[index + 1].replace(answerHeader, '');
      const single = numbers.length === 1 ? choiceCell(answersLine, hasAnswerHeader) : [];
      const answers = single.length ? [single] : choiceRow(answersLine, hasAnswerHeader);
      if (answers.length === numbers.length) {
        numbers.forEach((number, position) => entries.push([Number(number.match(rowNumber)[1]), answers[position]]));
        index++;
        continue;
      }
    }
    for (const match of line.matchAll(keyEntry)) {
      const letters = answerLetters(match[2].toUpperCase());
      if (letters.length) entries.push([Number(match[1]), letters]);
    }
    if (sequenceStart !== undefined) {
      const unnumbered = line.replace(answerHeader, '');
      // A continuous run like "BACD" represents consecutive answer letters here.
      const choices = /^[A-H]{2,}$/i.test(unnumbered) ? [...unnumbered.toUpperCase()].map((letter) => [letter]) : choiceRow(unnumbered);
      if (choices.length) sequence.push(...choices);
    }
  }
  return entries.length || !sequence.length ? entries :
    sequence.slice(0, 500).map((choice, index) => [sequenceStart + index, choice]);
}

export function collectAnswers(entries) {
  const answers = new Map();
  const conflicts = new Set();
  for (const [number, choices] of entries) {
    if (!number || conflicts.has(number)) continue;
    const letters = [...new Set(choices)].sort();
    if (answers.has(number) && answers.get(number).join('') !== letters.join('')) {
      answers.delete(number);
      conflicts.add(number);
    } else answers.set(number, letters);
  }
  return { answers, conflicts: conflicts.size };
}

export function matchAnswerKey(questions, answers) {
  const counts = new Map();
  for (const { number } of questions) counts.set(number, (counts.get(number) ?? 0) + 1);
  return questions.flatMap((question, index) => {
    const choices = counts.get(question.number) === 1 && answers.get(question.number);
    if (!choices?.length) return [];
    const labels = question.optionLabels ?? question.options.map((_, i) => String.fromCharCode(65 + i));
    const correct = [...new Set(choices.map((choice) => labels.findIndex((label) =>
      choiceOrder(label) === choiceOrder(choice) && choiceOrder(choice) >= 0)))];
    return correct.includes(-1) ? [] : [{ number: question.number, index, choices: correct.map((i) => labels[i]), correct }];
  });
}

export function isPdf(buffer) {
  return buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
}

// Read the size before decoding so an unusually large JPEG cannot exhaust the OCR worker.
function jpegSize(buffer) {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 4 <= buffer.length && buffer[offset] === 0xff) {
    while (buffer[offset] === 0xff) offset++;
    if (offset + 2 >= buffer.length) return null;
    const type = buffer[offset++];
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length || type === 0xda) return null;
    if (frames.has(type) && length >= 8) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

const badKey = (message, status = 422) => Object.assign(new Error(message), { status });

export async function extractAnswerKey(file, sequenceStart = 1, language = 'auto') {
  const buffer = file.buffer;
  let parser;
  let worker;
  let hindiWorker;
  let usedOcr = false;
  async function recognize(image) {
    worker ??= await createPaperWorker(language);
    usedOcr = true;
    const { data } = await worker.recognize(image);
    const primary = cleanHindiText(data.text, true);
    if (language === 'hindi' || (language === 'auto' && hindiText.test(primary))) {
      hindiWorker ??= await createPaperWorker('hindi', true);
      const alternative = cleanHindiText((await hindiWorker.recognize(image)).data.text, true);
      if (readAnswerEntries(alternative, { sequenceStart }).length > readAnswerEntries(primary, { sequenceStart }).length) return alternative;
    }
    return primary;
  }
  try {
    let text;
    if (isPdf(buffer)) {
      parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
      const { total } = await parser.getInfo();
      if (total > 20) throw badKey('Use an answer-key PDF with 20 pages or fewer.');
      const { pages } = await parser.getText({ lineThreshold: 4, lineEnforce: true, cellSeparator: ' ' });
      const pageTexts = [];
      for (const page of pages) {
        if (!readAnswerEntries(page.text, { sequenceStart }).length) {
          const shot = await parser.getScreenshot({ partial: [page.num], desiredWidth: 1600, imageDataUrl: false });
          pageTexts.push(await recognize(Buffer.from(shot.pages[0].data)));
        } else pageTexts.push(page.text);
      }
      text = pageTexts.join('\n');
    } else {
      const size = jpegSize(buffer);
      if (!size) throw badKey('Choose a valid PDF or JPG for the answer key.', 415);
      if (!size.width || !size.height || size.width * size.height > 16_000_000) {
        throw badKey('Use an answer-key JPG smaller than 16 megapixels.');
      }
      text = await recognize(buffer);
    }
    return { ...collectAnswers(readAnswerEntries(text, { sequenceStart })), usedOcr };
  } catch (error) {
    if (error.status) throw error;
    throw badKey('Could not read the answer key. Try a clear JPG or a password-free PDF.');
  } finally {
    await hindiWorker?.terminate();
    await worker?.terminate();
    await parser?.destroy();
  }
}
