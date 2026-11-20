import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuestions } from './parser.mjs';
import { collectAnswers, readAnswerEntries } from './answer-key.mjs';
import { cleanHindiText } from './hindi-text.mjs';

test('extracts Hindi prompts and printed choice labels without changing their text', () => {
  const [first, second] = parseQuestions([{ num: 1, text: [
    'हिन्दी अभ्यास परीक्षा',
    'प्रश्न संख्या १२। भारत की राजधानी कौन-सी है?',
    '(क) मुंबई (ख) नई दिल्ली (ग) चेन्नई (घ) जयपुर',
    'उत्तर: (ख)',
    '१३. सभी सही विकल्प चुनिए। २ से विभाज्य संख्याएँ कौन-सी हैं?',
    'क) चार',
    'ख) पाँच',
    'ग) छः',
    'घ) सात',
    'उत्तर कुंजी',
    '१२. ख',
    '१३. क और ग',
  ].join('\n') }]);
  assert.equal(first.number, 12);
  assert.equal(first.prompt, 'भारत की राजधानी कौन-सी है?');
  assert.deepEqual(first.optionLabels, ['क', 'ख', 'ग', 'घ']);
  assert.deepEqual(first.correct, [1]);
  assert.equal(second.number, 13);
  assert.ok(second.prompt.includes('२ से विभाज्य'));
  assert.equal(second.type, 'msq');
  assert.deepEqual(second.correct, [0, 2]);
});

test('matches Hindi or English keys by question number and option order', () => {
  const page = { num: 1, text: 'प्रश्न १. सही विकल्प चुनिए।\n(क) प्रथम (ख) दूसरा (ग) तीसरा (घ) चौथा' };
  const hindiKey = collectAnswers(readAnswerEntries('उत्तर कुंजी\nप्रश्न १. सही उत्तर: (घ)')).answers;
  const englishKey = collectAnswers(readAnswerEntries('1. D')).answers;
  for (const key of [hindiKey, englishKey]) {
    assert.deepEqual(parseQuestions([page], key)[0].correct, [3]);
  }
});

test('repairs split Hindi headings and misplaced vowel marks in PDF text', () => {
  const text = cleanHindiText('िहन्दी परीक्षा\nप्रश्न\n१. भारत की राजधानी रोचक है ?\n(क) नई िदल्ली\n(ख) चेन्नई\nउत्तर कुं जी\n१. क');
  assert.match(text, /^\s*हिन्दी परीक्षा/);
  const [question] = parseQuestions([{ num: 1, text }]);
  assert.equal(question.number, 1);
  assert.equal(question.options[0], 'नई दिल्ली');
  assert.deepEqual(question.correct, [0]);
});

test('limits Hindi OCR digit corrections to question and answer labels', () => {
  const text = cleanHindiText('प्रश्न र. वर्ण र. का उदाहरण चुनिए।\nउत्तर कुंजी\nश्.ख', true);
  assert.equal(text, 'प्रश्न २. वर्ण र. का उदाहरण चुनिए।\nउत्तर कुंजी\n१.ख');
});
