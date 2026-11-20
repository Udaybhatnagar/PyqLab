import { PDFParse } from 'pdf-parse';
import { choiceOrder, normalizeDigits } from '../src/paper-text.js';
import { attachDiagrams, inspectDiagrams, inspectScan, openPdf } from './diagrams.mjs';
import { answerLetters, matchAnswerKey, readAnswerEntries } from './answer-key.mjs';
import { createPaperWorker } from './ocr.mjs';
import { cleanHindiText } from './hindi-text.mjs';

const questionPattern = /^\s*(?:(?:Q(?:uestion)?|प्रश्[\u200C\u200D]?न(?:\s*(?:संख्या|क्रमांक|सं\.?))?)\s*\.?\s*(\d{1,4})\s*[.):।–-]?\s*|(\d{1,4})\s*[.):।–-]\s*)(\S.*)$/i;
const graphicHeading = /^(?:(?:Q(?:uestion)?|प्रश्[\u200C\u200D]?न(?:\s*(?:संख्या|क्रमांक|सं\.?))?)\.?\s*(\d{1,4})[.):।–-]?|(\d{1,4})[.):।–-])$/i;
const optionPattern = /(?<!\S)(?:\(\s*([A-Hकखगघङचछज])\s*\)|([A-Hकखगघङचछज])\s*[.):।])\s*/gi;
const textOptionPattern = /(?<!\S)(?:\(\s*([A-Hकखगघङचछज])\s*\)|([A-Hकखगघङचछज])\s*[.):।])\s*(?=\S)/gi;
const inlineAnswer = /^(?:(?:correct\s+)?answers?|ans\.?|key|(?:सही\s+)?उत्तर)\s*[:.–-]\s*(.+)$/i;
const answerKeyHeading = /^\s*(?:(?:official|final|provisional|correct)\s+)?(?:answer\s*key|answer\s*sheet|answers|solutions|उत्तर\s*कुंजी|उत्तरमाला|उत्तर\s*तालिका|सही\s*उत्तर)(?:\s*[:.।-]\s*|\s*)$/i;
const multi = /\b(?:MSQ|multiple\s+select(?:ion)?|select\s+(?:all|more than one)|(?:one|two)\s+or\s+more|more than one\s+(?:option|answer))\b|एक\s+से\s+अधिक|सभी\s+(?:सही|उपयुक्त)\s+(?:विकल्प|उत्तर)/i;
const single = /\b(?:MCQ|single\s+(?:correct|choice|select))\b|केवल\s+एक\s+(?:सही\s+)?(?:विकल्प|उत्तर)/i;
const isNoise = /^(?:--\s*\d+\s+of\s+\d+\s*--|(?:page\s+(?:no\.?\s*)?|पृष्ठ\s*(?:संख्या\s*)?)\d+(?:\s*(?:of|\/)\s*\d+)?|(?:please\s+)?turn\s+(?:over|the page)|continued(?:\s+on\s+(?:the\s+)?next\s+page)?|end\s+of\s+(?:the\s+)?(?:paper|test|exam|section)|©.*|copyright\b.*|all rights reserved\.?)[\s.।]*$/i;
const sectionHeading = /^(?:section\s+[a-z0-9ivx]+(?:\b|[.):–-])|(?:general\s+)?instructions\b|directions\b|(?:सामान्य\s+)?निर्देश\s*[:।-]|(?:खंड|भाग)\s+\S{1,5}(?:\s|$))/i;
const annotation = /^(?:explanation|solution|rationale|hint|notes?|topic|difficulty|source|reference|marks|time allowed|व्याख्या|समाधान|संकेत|टिप्पणी)\s*[:.–-](?:\s|$)/i;
const inlineMetadata = /\s+(?:(?:(?:correct\s+)?answers?|ans\.?|key|(?:सही\s+)?उत्तर)\s*[:.–-]\s*(.+?)|(?:explanation|solution|hint|source|difficulty|व्याख्या|समाधान)\s*[:.–-]\s*.+)$/i;
const footerLink = /^(?:(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,})$/i;

function pageLines(pages) {
  const counts = new Map();
  const linesByPage = pages.map((page) => {
    const input = page.layout ? page.layout.rows.flatMap((row, index, rows) =>
      index && row.y - rows[index - 1].y > row.gap ? [{ text: '' }, row] : [row]
    ) : page.text.split(/\r?\n/).map((text) => ({ text }));
    const lines = input.map(({ text, ...position }) => ({
      ...position, edge: false, indented: /^\s{2,}\S/.test(text),
      text: cleanHindiText(text, page.fromOcr).trim().replace(/[\uFF01-\uFF5E]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xFEE0)),
    }));
    const visible = lines.filter(({ text }) => text);
    const headings = new Set();
    for (const line of [...visible.slice(0, 2), ...visible.slice(-2)]) {
      const { text } = line;
      if (text.length < 8 || questionPattern.test(normalizeDigits(text)) || answerKeyHeading.test(text) ||
          inlineAnswer.test(text) || [...text.matchAll(optionPattern)].some((match) => match.index === 0)) continue;
      line.edge = true;
      headings.add(text.toLowerCase());
    }
    for (const heading of headings) counts.set(heading, (counts.get(heading) ?? 0) + 1);
    return { num: page.num, lines };
  });
  return linesByPage.map(({ num, lines }) => ({
    num, lines: lines.filter(({ text, edge }) => !edge || (counts.get(text.toLowerCase()) ?? 0) < 2),
  }));
}

export function parseQuestions(pages, suppliedAnswers = new Map(), matched = new Set()) {
  const questions = [];
  const keyLines = [];
  let sectionType = 'mcq';
  let question = null;
  let inKey = false;
  let pending = [];
  let afterBoundary = false;
  const anchors = [];

  function addAnchor(page, line, index, figures) {
    if (line.xAt) anchors.push({ page: page.num, y: line.y, x: line.xAt(index), figures });
  }

  function applyWrappedText(beforeAnotherChoice) {
    const option = question?.options.at(-1);
    for (const line of pending) {
      // A following option label is strong evidence that adjacent lines belong to this choice.
      const continuesSentence = /^(?:\p{Ll}|\p{Script=Devanagari})/u.test(line.text) && /[\p{L}\p{M}]$/u.test(option.text);
      const continuesMath = /^[,.)=+*/]/.test(line.text) || /[,;:–-]$/.test(option.text);
      if (!beforeAnotherChoice && !line.indented && !continuesSentence && !continuesMath) break;
      option.text += ' ' + line.text;
    }
    pending = [];
  }

  function finish() {
    applyWrappedText(false);
    if (question?.options.length >= 2) questions.push(question);
    question = null;
    afterBoundary = false;
  }

  for (const page of pageLines(pages)) {
    if (question?.options.length) {
      applyWrappedText(false);
      afterBoundary = true;
    }
    for (const line of page.lines) {
      const value = line.text;
      const structure = normalizeDigits(value);
      if (!value || isNoise.test(structure) || (line.edge && footerLink.test(value))) {
        if (question?.options.length) {
          applyWrappedText(false);
          afterBoundary = true;
        }
        continue;
      }
      if (answerKeyHeading.test(value)) {
        finish();
        addAnchor(page, line, 0);
        inKey = true;
        continue;
      }
      if (inKey) {
        keyLines.push(value);
        continue;
      }

      const heading = structure.match(questionPattern) ?? structure.match(graphicHeading);
      if (heading) {
        finish();
        question = { number: Number(heading[1] ?? heading[2]), page: page.num, type: sectionType, prompt: [], figures: [], options: [], key: [] };
        addAnchor(page, line, 0, question.figures);
      } else if (sectionHeading.test(value) || (!question && (multi.test(value) || single.test(value)))) {
        finish();
        addAnchor(page, line, 0);
        if (multi.test(value)) sectionType = 'msq';
        else if (single.test(value) || /^(?:section\b|खंड|भाग)/i.test(value)) sectionType = 'mcq';
        continue;
      }
      if (!question) continue;
      const content = heading ? (heading[3] ? value.slice(-heading[3].length) : '') : value;
      const answer = content.match(inlineAnswer);
      if (answer && question.options.length >= 2) {
        applyWrappedText(false);
        question.key = answerLetters(answer[1]);
        addAnchor(page, line, 0);
        afterBoundary = true;
        continue;
      }
      if (question.options.length && annotation.test(content)) {
        applyWrappedText(false);
        addAnchor(page, line, 0);
        afterBoundary = true;
        continue;
      }
      const metadata = content.match(inlineMetadata);
      const choiceText = metadata ? content.slice(0, metadata.index) : content;
      const matches = [...choiceText.matchAll(line.xAt ? optionPattern : textOptionPattern)];
      const first = matches[0];
      const validOptions = first && (first.index === 0 || matches.length >= 2) && matches.every((match, index) => {
        const label = (match[1] ?? match[2]).toUpperCase();
        const previous = matches[index - 1];
        const lastLabel = previous ? (previous[1] ?? previous[2]).toUpperCase() : question.options.at(-1)?.label;
        return choiceOrder(label) === (lastLabel ? choiceOrder(lastLabel) + 1 : 0);
      });
      if (validOptions) {
        applyWrappedText(true);
        if (first.index > 0) question.prompt.push(choiceText.slice(0, first.index).trim());
        matches.forEach((match, index) => {
          const option = {
            label: (match[1] ?? match[2]).toUpperCase(),
            text: choiceText.slice(match.index + match[0].length, matches[index + 1]?.index).trim(),
            figures: [],
          };
          question.options.push(option);
          addAnchor(page, line, value.length - content.length + match.index, option.figures);
        });
        if (metadata?.[1]) question.key = answerLetters(metadata[1]);
        afterBoundary = Boolean(metadata);
      } else if (question.options.length) {
        if (!afterBoundary) pending.push(line);
      } else {
        if (multi.test(content)) question.type = 'msq';
        question.prompt.push(content);
      }
    }
  }
  finish();

  const keys = new Map(readAnswerEntries(keyLines.join('\n')));
  attachDiagrams(pages.flatMap((page) => page.layout?.regions ?? []), anchors);
  const parsed = questions.slice(0, 500).flatMap((item) => {
    const options = item.options.filter((option) => option.text || option.figures.length);
    if (options.length < 2 || (!item.prompt.join('').trim() && !item.figures.length)) return [];
    const correct = [...new Set((item.key.length ? item.key : keys.get(item.number) ?? [])
      .map((letter) => options.findIndex((option) => choiceOrder(option.label) === choiceOrder(letter))).filter((index) => index >= 0))];
    return [{
      number: item.number, page: item.page,
      type: correct.length > 1 ? 'msq' : item.type,
      prompt: item.prompt.join('\n'), options: options.map((option) => option.text), correct,
      ...(options.some((option, i) => option.label.charCodeAt(0) !== 65 + i) ? { optionLabels: options.map((option) => option.label) } : {}),
      ...(item.figures.length ? { figures: item.figures } : {}),
      ...(options.some((option) => option.figures.length) ? { optionFigures: options.map((option) => option.figures) } : {}),
    }];
  });
  for (const { index, number, correct } of matchAnswerKey(parsed, suppliedAnswers)) {
    matched.add(number);
    parsed[index] = { ...parsed[index], correct, type: correct.length > 1 ? 'msq' : parsed[index].type };
  }
  return parsed;
}

const hindiCharacters = (text) => (text.match(/[\u0900-\u095f\u0970-\u097f]/g) ?? []).length;

function questionScore(page) {
  return parseQuestions([page]).reduce((score, question) => score + 10 + question.options.length + question.correct.length, 0);
}

export async function extractPaper(buffer, suppliedAnswers, language = 'auto') {
  const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
  let worker;
  let hindiWorker;
  try {
    const info = await parser.getInfo();
    if (info.total > 100) throw Object.assign(new Error('Use a PDF with 100 pages or fewer.'), { status: 422 });
    const result = await parser.getText({ lineThreshold: 4, lineEnforce: true, cellSeparator: ' ' });
    for (const page of result.pages) page.text = cleanHindiText(page.text);
    const notes = [];
    const graphicsDocument = openPdf(buffer);
    try {
      const document = await graphicsDocument.promise;
      for (const page of result.pages) {
        const source = await document.getPage(page.num);
        try { page.layout = await inspectDiagrams(source); }
        finally { source.cleanup(); }
      }
    } catch {
      notes.push('Some figures could not be detected automatically. Use Add diagram in the editor to crop them from the PDF.');
    } finally {
      await graphicsDocument.destroy();
    }
    const scanned = result.pages.filter((page) =>
      (!page.layout && page.text.replace(/\s/g, '').length < 45) ||
      (language === 'hindi' && hindiCharacters(page.text) < 8));
    if (scanned.length) {
      try {
        worker = await createPaperWorker(language);
        for (const page of scanned.slice(0, 25)) {
          const shot = await parser.getScreenshot({ partial: [page.num], desiredWidth: 1600, imageDataUrl: false });
          const image = Buffer.from(shot.pages[0].data);
          const { data } = await worker.recognize(image, {}, { blocks: true });
          const asPage = (recognition) => ({ num: page.num, text: cleanHindiText(recognition.text, true), fromOcr: true });
          let recognized = data;
          let candidate = asPage(data);
          if (language !== 'english' && hindiCharacters(data.text) >= 8) {
            hindiWorker ??= await createPaperWorker('hindi', true);
            const { data: hindi } = await hindiWorker.recognize(image, {}, { blocks: true });
            const alternative = asPage(hindi);
            if (hindiCharacters(alternative.text) >= hindiCharacters(candidate.text) * .8 &&
                questionScore(alternative) >= questionScore(candidate)) {
              recognized = hindi;
              candidate = alternative;
            }
          }
          const betterHindi = language !== 'english' &&
            hindiCharacters(candidate.text) >= Math.max(8, hindiCharacters(page.text) + 1);
          if (betterHindi || candidate.text.trim().length > page.text.trim().length) {
            const layout = await inspectScan(image, page.num, recognized.blocks);
            if (layout) {
              if (hindiCharacters(candidate.text) >= 8) layout.regions = layout.regions.filter(({ left, right, top, bottom }) =>
                right - left >= 500 && bottom - top >= 400);
              if (layout.regions.length && questionScore({ ...candidate, layout }) >= questionScore(candidate)) candidate.layout = layout;
            }
            Object.assign(page, { ...candidate, layout: candidate.layout ?? null });
          }
        }
        const count = Math.min(25, scanned.length);
        notes.push((language === 'english' ? 'English' : 'Hindi and English') + ' OCR was attempted on ' +
          count + (count === 1 ? ' page' : ' pages') + ' without readable text. Check the text and diagram placements.');
        if (scanned.length > 25) notes.push('Remaining scanned pages need manual review. For automatic OCR, import them in a separate PDF.');
      } catch {
        notes.push('OCR could not finish. Use the original PDF to add or fix questions in the editor.');
      }
    }
    const matched = new Set();
    const text = result.pages.map((page) => page.text.trim()).filter(Boolean).join('\n\n').replaceAll('\0', '');
    if (text.length > 2_000_000) notes.push('The extracted text preview was limited to the first two million characters.');
    return { pages: info.total, questions: parseQuestions(result.pages, suppliedAnswers, matched), notes, matched: matched.size,
      extractedText: text.slice(0, 2_000_000) };
  } finally {
    await hindiWorker?.terminate();
    await worker?.terminate();
    await parser.destroy();
  }
}
