import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAnswers, readAnswerEntries } from './answer-key.mjs';
import { parseQuestions } from './parser.mjs';

test('reads inline answers, wrapped grid rows, and multiple choices', () => {
  const { answers, conflicts } = collectAnswers(readAnswerEntries(
    'Answer key\nQ1. (B)   2: A & C\nQuestion | 3 | 4 | 5\nAnswer | D | B,D | AC\n6 | C\n7. B D'
  ));
  assert.deepEqual([...answers], [[1, ['B']], [2, ['A', 'C']], [3, ['D']], [4, ['B', 'D']], [5, ['A', 'C']], [6, ['C']], [7, ['B', 'D']]]);
  assert.equal(conflicts, 0);
});

test('omits conflicting entries while keeping repeated equivalent entries', () => {
  const { answers, conflicts } = collectAnswers(readAnswerEntries('1. B   2. A,C\n1. C   2. C,A'));
  assert.deepEqual([...answers], [[2, ['A', 'C']]]);
  assert.equal(conflicts, 1);
});

test('reads ranges, numeric choices, and headerless lists with a starting question', () => {
  assert.deepEqual(readAnswerEntries('Questions 12–14: B | (A,D) | C\n15–16\nAnswers: DA\n17: 2'), [
    [12, ['B']], [13, ['A', 'D']], [14, ['C']], [15, ['D']], [16, ['A']], [17, ['B']],
  ]);
  assert.deepEqual(readAnswerEntries('Answer key\nB C\n(A,D) D', { sequenceStart: 20 }), [
    [20, ['B']], [21, ['C']], [22, ['A', 'D']], [23, ['D']],
  ]);
  assert.deepEqual(readAnswerEntries('Question No. | Correct Option\n12 2\n13 4'), [[12, ['B']], [13, ['D']]]);
});

test('preserves printed letters when an empty option is dropped', () => {
  const page = { num: 1, text: '1. Select an option.\nA) First B)  C) Third D) Fourth' };
  page.layout = {
    rows: [
      { text: '1. Select an option.', y: 500, gap: 250, xAt: () => 600 },
      { text: 'A) First B)  C) Third D) Fourth', y: 700, gap: 250, xAt: () => 600 },
    ], regions: [],
  };
  const [question] = parseQuestions([page], new Map([[1, ['D']]]));
  assert.deepEqual(question.optionLabels, ['A', 'C', 'D']);
  assert.deepEqual(question.correct, [2]);
});

test('matches external answers by question number and labels before scoring', () => {
  const key = new Map([[3, ['A', 'C']], [8, ['B']], [9, ['H']], [11, ['A']]]);
  const matched = new Set();
  const questions = parseQuestions([{ num: 1, text: [
    '3. Select odd digits.', 'A) 1 B) 2 C) 3', 'Answer: B',
    '8. Find the even digit.', 'A) 1 B) 2',
    '9. Find the odd digit.', 'A) 1 B) 2', 'Answer: A',
    '11. Which question is repeated?', 'A) First B) Second',
    '11. Which question is repeated again?', 'A) First B) Second',
  ].join('\n') }], key, matched);
  assert.deepEqual(questions.map(({ correct }) => correct), [[0, 2], [1], [0], [], []]);
  assert.equal(questions[0].type, 'msq');
  assert.deepEqual([...matched], [3, 8]);
});
