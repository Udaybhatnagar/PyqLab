import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuestions } from './parser.mjs';

test('keeps option continuations and ignores headers, footers, and explanations', () => {
  const questions = parseQuestions([
    { num: 1, text: [
      'Practice Paper 2026', '1. Find the value of x².',
      'A) √2', 'B) 4 obtained by', 'substituting the value of x',
      'C) 8', 'D) 16', 'Explanation: Start with x = 2.',
      'This is part of the explanation.', 'Answer: B',
      'Visit the institute for more practice', '-- 1 of 2 --',
    ].join('\n') },
    { num: 2, text: [
      'Practice Paper 2026', '2. Which statement is correct?',
      'A) One B) Two C) Three D) Four Explanation: A) is correct.',
      'Visit the institute for more practice', '-- 2 of 2 --',
    ].join('\n') },
  ]);
  assert.equal(questions[0].prompt, 'Find the value of x².');
  assert.deepEqual(questions[0].options, ['√2', '4 obtained by substituting the value of x', '8', '16']);
  assert.deepEqual(questions[0].correct, [1]);
  assert.deepEqual(questions[1].options, ['One', 'Two', 'Three', 'Four']);
});

test('keeps the question across pages while excluding detached page text', () => {
  const questions = parseQuestions([
    { num: 1, text: '1. Pick the prime numbers.\nA) 2\nB) 4\nmore practice at the school library\nPage 1 of 2' },
    { num: 2, text: 'Winter assessment\nC) 5\nD) 9\n\nwww.example.test\nAnswer key\n1. A,C' },
  ]);
  assert.deepEqual(questions[0].options, ['2', '4', '5', '9']);
  assert.deepEqual(questions[0].correct, [0, 2]);
  assert.equal(questions[0].type, 'msq');
});

test('keeps a wrapped final choice and extracts an inline answer key', () => {
  const questions = parseQuestions([{ num: 1, text:
    '1. Which of these is correct?\nA) Constant\nB) A line with variable slope\n  and no vertical intercept\n\nStudy guide text\n' +
    '2. Which is a prime? A) 3 B) 6 Answer: A',
  }]);
  assert.deepEqual(questions[0].options, ['Constant', 'A line with variable slope and no vertical intercept']);
  assert.deepEqual(questions[1].options, ['3', '6']);
  assert.deepEqual(questions[1].correct, [0]);
});

test('places diagrams under their question and beside their image-only choices', () => {
  const row = (text, y, xAt = () => 800) => ({ text, y, gap: 250, xAt });
  const prompt = { page: 1, left: 1400, top: 1200, right: 3400, bottom: 2200 };
  const choiceA = { page: 1, left: 1400, top: 2450, right: 2400, bottom: 3000 };
  const choiceB = { page: 1, left: 4300, top: 2450, right: 5400, bottom: 3100 };
  const [question] = parseQuestions([{ num: 1, layout: {
    rows: [
      row('1. Match the figure.', 1000),
      row('A) B)', 2500, (offset) => offset < 3 ? 800 : 3900),
      row('C) None of these', 3500),
      row('Answer: B', 3900),
    ],
    regions: [prompt, choiceA, choiceB],
  } }]);
  assert.deepEqual(question.options, ['', '', 'None of these']);
  assert.deepEqual(question.figures, [prompt]);
  assert.deepEqual(question.optionFigures, [[choiceA], [choiceB], []]);
  assert.deepEqual(question.correct, [1]);
});
