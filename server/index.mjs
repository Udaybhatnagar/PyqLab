import express from 'express';
import multer from 'multer';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { extractPaper } from './parser.mjs';
import { collectAnswers, extractAnswerKey, isPdf, matchAnswerKey, readAnswerEntries } from './answer-key.mjs';
import { cropImage, renderPage, validCrop } from './diagrams.mjs';
import { validChoiceLabel } from '../src/paper-text.js';
import { paperLanguages } from './ocr.mjs';
import { productionFrontend } from '../src/deployment.js';
import { samplePapers } from '../src/demo.js';
import { importJobSchema, runImportJobs } from './import-jobs.mjs';
import { removeImportFiles, stageImportFiles, uploadOwner } from './import-files.mjs';

const app = express();
const root = fileURLToPath(new URL('../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl?.hostname.endsWith('.neon.tech') && databaseUrl.searchParams.get('sslmode') === 'require' &&
    !databaseUrl.searchParams.has('uselibpqcompat')) {
  databaseUrl.searchParams.set('sslmode', 'verify-full');
}
const pool = databaseUrl ? new pg.Pool({
  connectionString: databaseUrl.toString(),
  enableChannelBinding: true,
  connectionTimeoutMillis: 8000,
}) : null;
pool?.on('error', (error) => console.error('Database connection lost:', error.code ?? error.name));
app.disable('x-powered-by');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 2, fields: 2, fieldSize: 64 } });
const importFiles = upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'answerKey', maxCount: 1 }]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let databaseReady;
let importsRunning = 0;
let importWorkerRunning = false;
const importConcurrency = process.env.RENDER ? 1 : 2;
const pageCache = new Map();
const frontendOrigins = new Set([productionFrontend, ...(process.env.FRONTEND_ORIGIN ?? '').split(',')
  .map((value) => value.trim().replace(/\/+$/, '')).filter(Boolean)]);
const activeAttempt = 'NOT EXISTS (SELECT 1 FROM pyq_lab_papers deleted ' +
  'WHERE deleted.workspace = a.workspace AND deleted.id::text = a.paper_id AND deleted.deleted_at IS NOT NULL)';

async function connect() {
  if (!pool) throw Object.assign(new Error('Set DATABASE_URL on the server to save imports and results.'), { status: 503 });
  databaseReady ??= pool.query(
    'CREATE TABLE IF NOT EXISTS pyq_lab_papers (' +
    'id uuid PRIMARY KEY, workspace uuid NOT NULL, filename text NOT NULL, pdf bytea NOT NULL, ' +
    'pages integer NOT NULL, title text, subject text, questions jsonb, ' +
    'created_at timestamptz NOT NULL DEFAULT now());' +
    'ALTER TABLE pyq_lab_papers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;' +
    'ALTER TABLE pyq_lab_papers ADD COLUMN IF NOT EXISTS answer_key jsonb;' +
    'ALTER TABLE pyq_lab_papers ADD COLUMN IF NOT EXISTS extracted_text text;' +
    'CREATE INDEX IF NOT EXISTS pyq_lab_papers_workspace ON pyq_lab_papers (workspace, created_at DESC);' +
    'CREATE TABLE IF NOT EXISTS pyq_lab_attempts (' +
    'id uuid PRIMARY KEY, workspace uuid NOT NULL, paper_id text NOT NULL, ' +
    'result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());' +
    'CREATE INDEX IF NOT EXISTS pyq_lab_attempts_workspace ON pyq_lab_attempts (workspace, created_at DESC);' +
    importJobSchema +
    'DELETE FROM pyq_lab_papers WHERE title IS NULL AND created_at < now() - interval \'1 day\';'
  ).catch((error) => {
    databaseReady = undefined;
    console.error('Database setup failed:', error.code ?? error.name);
    throw Object.assign(new Error('Could not connect to PostgreSQL. Check the server configuration.'), { status: 503 });
  });
  await databaseReady;
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  res.vary('Origin');
  if (frontendOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Study-Workspace');
    res.set('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.use('/api', express.json({ limit: '8mb' }));
app.use('/api', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const workspace = req.get('x-study-workspace');
  if (!workspace || !uuid.test(workspace)) return res.status(400).json({ error: 'This browser has no valid study workspace.' });
  req.workspace = workspace;
  await connect();
  next();
});

app.get('/api/library', async (req, res) => {
  const [papers, attempts] = await Promise.all([
    pool.query('SELECT id, filename, pages, title, subject, octet_length(pdf) > 0 AS "hasServerPdf", jsonb_array_length(questions) AS count, created_at AS "createdAt" FROM pyq_lab_papers WHERE workspace = $1 AND title IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC', [req.workspace]),
    pool.query('SELECT a.id, a.paper_id AS "paperId", a.created_at AS "createdAt", a.result - \'items\' AS result ' +
      'FROM pyq_lab_attempts a WHERE a.workspace = $1 AND ' + activeAttempt + ' ORDER BY a.created_at DESC LIMIT 300', [req.workspace]),
  ]);
  res.json({ papers: papers.rows, attempts: attempts.rows });
});

app.get('/api/improvement', async (req, res) => {
  const { rows } = await pool.query(
    "SELECT a.paper_id, a.id, a.result->>'title' AS title, a.result->>'subject' AS subject, item " +
    "FROM pyq_lab_attempts a CROSS JOIN LATERAL jsonb_array_elements(a.result->'items') AS questions(item) " +
    'WHERE a.workspace = $1 AND ' + activeAttempt + " AND (item @> '{\"important\":true}' OR item @> '{\"topicRevision\":true}') " +
    'ORDER BY a.created_at DESC, a.id DESC', [req.workspace],
  );
  const papers = new Map();
  for (const { paper_id: paperId, id, title, subject, item } of rows) {
    if (!papers.has(paperId)) papers.set(paperId, { id: paperId, title, subject, questions: new Map() });
    const questions = papers.get(paperId).questions;
    const key = JSON.stringify([item.number, item.page, item.prompt, item.options]);
    const existing = questions.get(key);
    if (existing) {
      existing.important ||= item.important === true;
      existing.topicRevision ||= item.topicRevision === true;
    } else {
      const { number, page, prompt, options, optionLabels, figures, optionFigures, correct, important, topicRevision, type } = item;
      questions.set(key, { number, page, prompt, options, optionLabels, figures, optionFigures, correct, type, important, topicRevision, attemptId: id });
    }
  }
  res.json([...papers.values()].map((paper) => ({ ...paper, questions: [...paper.questions.values()] })));
});

function importInput(req) {
  const file = req.files?.pdf?.[0];
  const answerKey = req.files?.answerKey?.[0];
  const sequenceStart = readSequenceStart(req.body?.startQuestion);
  const language = req.body?.language ?? 'auto';
  if (!paperLanguages.has(language)) throw requestError(400, 'Choose Automatic, Hindi, or English for the paper.');
  if (!file || !isPdf(file.buffer)) throw requestError(415, 'Choose a valid question-paper PDF.');
  return { file, answerKey, sequenceStart, language };
}

async function parseImport({ file, answerKey, sequenceStart, language }) {
  try {
    const key = answerKey && await extractAnswerKey(answerKey, sequenceStart, language);
    const { matched, ...paper } = await extractPaper(file.buffer, key?.answers, language);
    return { ...paper, answerKey: key ? describeKey(key, answerKey.originalname, matched) : null };
  } catch (error) {
    if (error.status) throw error;
    throw requestError(422, 'This PDF could not be opened. Make sure it is readable and password-free.');
  }
}

app.post('/api/import', importFiles, async (req, res) => {
  const input = importInput(req);
  if (importsRunning >= importConcurrency) throw requestError(429, 'Other imports are in progress. Try again in a moment.');
  importsRunning++;
  let paper;
  try { paper = await parseImport(input); }
  finally { importsRunning--; }
  const id = randomUUID();
  const filename = input.file.originalname.slice(0, 240);
  await pool.query('INSERT INTO pyq_lab_papers (id, workspace, filename, pdf, pages, answer_key, extracted_text) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, req.workspace, filename, Buffer.alloc(0), paper.pages, paper.answerKey, paper.extractedText]);
  res.status(201).json({ id, filename, ...paper });
});

function scheduleImports() {
  if (importWorkerRunning || importsRunning >= importConcurrency) return;
  importWorkerRunning = true;
  importsRunning++;
  setImmediate(async () => {
    try { await runImportJobs(pool, transaction, parseImport); }
    catch (issue) { console.error('Import queue failed:', issue.code ?? issue.name); }
    finally { importWorkerRunning = false; importsRunning--; }
  });
}

app.post('/api/import/jobs/:id', importFiles, async (req, res) => {
  const { id } = req.params;
  if (!uuid.test(id)) throw requestError(400, 'Invalid import ID.');
  if (req.query.storage !== 'browser') throw requestError(409, 'Refresh PYQ Lab to use browser PDF storage, then try again.');
  const { file, answerKey, sequenceStart, language } = importInput(req);
  const stage = await stageImportFiles(file, answerKey);
  const options = { stage, uploadOwner, sequenceStart, language, keyName: answerKey?.originalname.slice(0, 240) };
  let retained = false;
  try {
    retained = await transaction(async (db) => {
      const inserted = await db.query(
        'INSERT INTO pyq_lab_papers (id, workspace, filename, pdf, pages) VALUES ($1, $2, $3, $4, 0) ON CONFLICT DO NOTHING',
        [id, req.workspace, file.originalname.slice(0, 240), Buffer.alloc(0)],
      );
      if (inserted.rowCount) {
        await db.query("INSERT INTO pyq_lab_import_jobs (id, options, lease_until) VALUES ($1, $2, now() + interval '90 seconds')", [id, options]);
        return true;
      }
      const restarted = await db.query(
        "UPDATE pyq_lab_import_jobs j SET status = 'queued', options = $3, key_data = NULL, error = NULL, lease_until = now() + interval '90 seconds' " +
        "FROM pyq_lab_papers p WHERE p.id = j.id AND j.id = $1 AND p.workspace = $2 AND (j.status = 'needs-upload' OR " +
        "(j.status IN ('queued','running') AND j.lease_until < now() AND j.options->>'uploadOwner' <> $4))",
        [id, req.workspace, options, uploadOwner],
      );
      if (restarted.rowCount) return true;
      const prior = await db.query('SELECT 1 FROM pyq_lab_import_jobs j JOIN pyq_lab_papers p USING (id) WHERE j.id = $1 AND p.workspace = $2',
        [id, req.workspace]);
      if (!prior.rowCount) throw requestError(409, 'This import could not be started. Choose the file again.');
      return false;
    });
  } finally {
    if (!retained) await removeImportFiles(stage);
  }
  res.status(202).json({ id });
  scheduleImports();
});

app.get('/api/import/jobs/:id', async (req, res) => {
  if (!uuid.test(req.params.id)) throw requestError(404, 'Import could not be found.');
  const { rows } = await pool.query(
    "SELECT CASE WHEN j.status IN ('queued','running') AND j.lease_until < now() AND j.options->>'uploadOwner' <> $3 THEN 'needs-upload' ELSE j.status END AS status, " +
    'j.error, j.result, p.id, p.filename, p.pages, p.extracted_text AS "extractedText", p.answer_key AS "answerKey" ' +
    'FROM pyq_lab_import_jobs j JOIN pyq_lab_papers p USING (id) WHERE j.id = $1 AND p.workspace = $2',
    [req.params.id, req.workspace, uploadOwner],
  );
  if (!rows.length) throw requestError(404, 'This import could not be found. Upload the PDF again.');
  const { status, error, result, ...paper } = rows[0];
  res.json({ status, ...(status === 'ready' ? { paper: { ...paper, ...result } } : { error }) });
  if (status === 'queued' || status === 'running') scheduleImports();
});

app.param('id', (req, res, next, id) => {
  if (uuid.test(id) || samplePapers.some((paper) => paper.id === id)) next();
  else res.status(404).json({ error: 'This item could not be found.' });
});

app.delete('/api/papers/:id', async (req, res) => {
  if (!uuid.test(req.params.id)) return res.status(404).json({ error: 'This paper could not be found.' });
  await transaction(async (db) => {
    const removed = await db.query(
      "UPDATE pyq_lab_papers SET deleted_at = COALESCE(deleted_at, now()), pdf = ''::bytea WHERE id = $1 AND workspace = $2 AND title IS NOT NULL",
      [req.params.id, req.workspace],
    );
    if (!removed.rowCount) throw requestError(404, 'This paper could not be found.');
    await db.query('DELETE FROM pyq_lab_attempts WHERE workspace = $1 AND paper_id = $2', [req.workspace, req.params.id]);
    await db.query('DELETE FROM pyq_lab_import_jobs WHERE id = $1', [req.params.id]);
  });
  const prefix = req.workspace + '/' + req.params.id + '/';
  for (const key of pageCache.keys()) {
    if (key.startsWith(prefix)) pageCache.delete(key);
  }
  res.sendStatus(204);
});

app.get('/api/papers/:id/pdf', async (req, res) => {
  if (!uuid.test(req.params.id)) return res.sendStatus(404);
  const { rows } = await pool.query('SELECT pdf FROM pyq_lab_papers WHERE id = $1 AND workspace = $2 AND deleted_at IS NULL AND octet_length(pdf) > 0', [req.params.id, req.workspace]);
  if (!rows.length) return res.status(404).json({ error: 'PDF could not be found.' });
  res.type('pdf').set('X-Content-Type-Options', 'nosniff').send(rows[0].pdf);
});

app.delete('/api/papers/:id/pdf', async (req, res) => {
  const digest = req.body?.sha256;
  if (!uuid.test(req.params.id) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
    throw requestError(400, 'The local PDF copy must be verified first.');
  }
  const removed = await pool.query(
    "UPDATE pyq_lab_papers SET pdf = ''::bytea WHERE id = $1 AND workspace = $2 AND title IS NOT NULL AND deleted_at IS NULL " +
    "AND (octet_length(pdf) = 0 OR encode(sha256(pdf), 'hex') = $3)",
    [req.params.id, req.workspace, digest],
  );
  if (!removed.rowCount) throw requestError(409, 'The stored PDF could not be matched. Its database copy was kept.');
  const prefix = req.workspace + '/' + req.params.id + '/';
  for (const key of pageCache.keys()) {
    if (key.startsWith(prefix)) pageCache.delete(key);
  }
  res.sendStatus(204);
});

app.get('/api/papers/:id/text', async (req, res) => {
  if (!uuid.test(req.params.id)) throw requestError(404, 'This paper could not be found.');
  const { rows } = await pool.query(
    'SELECT extracted_text AS text FROM pyq_lab_papers WHERE id = $1 AND workspace = $2 AND title IS NOT NULL AND deleted_at IS NULL',
    [req.params.id, req.workspace],
  );
  if (!rows.length) throw requestError(404, 'This paper could not be found.');
  if (rows[0].text === null) throw requestError(404, 'Re-import this PDF to generate an extracted text copy.');
  res.json(rows[0]);
});

app.get('/api/papers/:id/pages/:page', async (req, res) => {
  const page = Number(req.params.page);
  const { left, top, right, bottom } = req.query;
  const hasCrop = [left, top, right, bottom].some((value) => value !== undefined);
  const crop = { page, left: Number(left), top: Number(top), right: Number(right), bottom: Number(bottom) };
  if (!uuid.test(req.params.id) || !Number.isInteger(page) || page < 1 || page > 100 ||
      (hasCrop && !validCrop(crop))) {
    return res.status(400).json({ error: 'Invalid PDF page or crop.' });
  }
  const key = req.workspace + '/' + req.params.id + '/' + page;
  let pending = pageCache.get(key);
  if (!pending) {
    pending = (async () => {
      const { rows } = await pool.query('SELECT pdf FROM pyq_lab_papers WHERE id = $1 AND workspace = $2 AND pages >= $3 AND deleted_at IS NULL AND octet_length(pdf) > 0', [req.params.id, req.workspace, page]);
      if (!rows.length) throw Object.assign(new Error('The source PDF page could not be found.'), { status: 404 });
      return renderPage(rows[0].pdf, page);
    })();
    pending.catch(() => { if (pageCache.get(key) === pending) pageCache.delete(key); });
  }
  pageCache.delete(key);
  pageCache.set(key, pending);
  if (pageCache.size > 8) pageCache.delete(pageCache.keys().next().value);
  const canvas = await pending;
  res.type('png').set('X-Content-Type-Options', 'nosniff')
    .send(hasCrop ? cropImage(canvas, crop) : canvas.toBuffer('image/png'));
});

function textField(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max;
}

function validFigures(figures) {
  return figures === undefined || (Array.isArray(figures) && figures.length <= 4 && figures.every((crop) => validCrop(crop)));
}

function validQuestion(question) {
  return question && Number.isInteger(question.number) && question.number > 0 &&
    (question.page === undefined || (Number.isInteger(question.page) && question.page > 0 && question.page <= 100)) &&
    ['mcq', 'msq'].includes(question.type) && validFigures(question.figures) &&
    typeof question.prompt === 'string' && question.prompt.length <= 6000 && (question.prompt.trim() || question.figures?.length) &&
    Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 8 &&
    (question.optionLabels === undefined || (Array.isArray(question.optionLabels) &&
      question.optionLabels.length === question.options.length &&
      new Set(question.optionLabels).size === question.options.length &&
      question.optionLabels.every(validChoiceLabel))) &&
    (question.optionFigures === undefined || (Array.isArray(question.optionFigures) &&
      question.optionFigures.length === question.options.length && question.optionFigures.every(validFigures))) &&
    question.options.every((option, i) => typeof option === 'string' && option.length <= 3000 &&
      (option.trim() || question.optionFigures?.[i]?.length)) &&
    Array.isArray(question.correct) && (question.type === 'msq' || question.correct.length <= 1) &&
    new Set(question.correct).size === question.correct.length &&
    question.correct.every((index) => Number.isInteger(index) && index >= 0 && index < question.options.length);
}

app.put('/api/papers/:id', async (req, res) => {
  if (!uuid.test(req.params.id)) return res.sendStatus(404);
  const { title, subject, questions } = req.body ?? {};
  if (!textField(title, 140) || !textField(subject, 60) || !Array.isArray(questions) ||
      !questions.length || questions.length > 500 || !questions.every(validQuestion)) {
    return res.status(400).json({ error: 'Enter a title, a subject, and at least one valid question with two or more options.' });
  }
  const cleanCrops = (crops) => crops?.map(({ page, left, top, right, bottom }) => ({ page, left, top, right, bottom })) ?? [];
  const cleaned = questions.map(({ number, page, prompt, options, optionLabels, type, correct, figures, optionFigures }) => ({
    number, page, prompt: prompt.trim(), options: options.map((option) => option.trim()), type, correct,
    ...(optionLabels ? { optionLabels } : {}),
    ...(figures?.length ? { figures: cleanCrops(figures) } : {}),
    ...(optionFigures?.some((crops) => crops?.length) ? { optionFigures: optionFigures.map(cleanCrops) } : {}),
  }));
  const requiredPages = cleaned.reduce((max, question) => Math.max(max, question.page ?? 1,
    ...(question.figures ?? []).map((crop) => crop.page),
    ...(question.optionFigures ?? []).flat().map((crop) => crop.page)), 1);
  const { rows } = await pool.query(
    'UPDATE pyq_lab_papers SET title = $3, subject = $4, questions = $5 WHERE id = $1 AND workspace = $2 AND pages >= $6 AND deleted_at IS NULL RETURNING id, filename, pages, title, subject, jsonb_array_length(questions) AS count, created_at AS "createdAt"',
    [req.params.id, req.workspace, title.trim(), subject.trim(), JSON.stringify(cleaned), requiredPages],
  );
  if (!rows.length) return res.status(404).json({ error: 'This paper could not be found.' });
  res.json(rows[0]);
});

async function readPaper(id, workspace, db = pool, lock = '') {
  const sample = samplePapers.find((paper) => paper.id === id);
  if (sample) return sample;
  const { rows } = await db.query(
    'SELECT id, filename, pages, title, subject, questions, answer_key AS "answerKey" FROM pyq_lab_papers WHERE id = $1 AND workspace = $2 AND title IS NOT NULL AND deleted_at IS NULL' + lock,
    [id, workspace],
  );
  return rows[0];
}

app.get('/api/papers/:id', async (req, res) => {
  const paper = await readPaper(req.params.id, req.workspace);
  if (!paper) return res.status(404).json({ error: 'This paper could not be found.' });
  res.json(paper);
});

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

function readSequenceStart(value) {
  const start = value === undefined || value === '' ? 1 : Number(value);
  if (!Number.isInteger(start) || start < 1 || start > 9999) throw requestError(400, 'Enter a first question number between 1 and 9999.');
  return start;
}

function describeKey(key, name, matched) {
  return { filename: name.slice(0, 240), found: key.answers.size, conflicts: key.conflicts, usedOcr: key.usedOcr, matched };
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function grade(correct, selected) {
  if (!correct.length) return 'ungraded';
  if (!selected.length) return 'skipped';
  return selected.length === correct.length && selected.every((number) => correct.includes(number)) ? 'correct' : 'incorrect';
}

function score(items) {
  return {
    correct: items.filter((item) => item.status === 'correct').length,
    graded: items.filter((item) => item.status !== 'ungraded').length,
  };
}

app.post('/api/papers/:id/answer-key', upload.single('answerKey'), async (req, res) => {
  if (!uuid.test(req.params.id)) throw requestError(404, 'This paper could not be found.');
  const paper = await readPaper(req.params.id, req.workspace);
  if (!paper) throw requestError(404, 'This paper could not be found.');
  const { text, startQuestion } = req.body ?? {};
  const start = readSequenceStart(startQuestion);
  if (!req.file && !textField(text, 30000)) throw requestError(400, 'Upload a PDF or JPG key, or paste up to 30,000 characters.');
  if (importsRunning >= importConcurrency) throw requestError(429, 'Other imports are in progress. Try again in a moment.');
  let key;
  importsRunning++;
  try {
    key = req.file ? await extractAnswerKey(req.file, start) :
      { ...collectAnswers(readAnswerEntries(text, { sequenceStart: start })), usedOcr: false };
  } finally {
    importsRunning--;
  }
  const matches = matchAnswerKey(paper.questions, key.answers);
  res.json({
    ...describeKey(key, req.file?.originalname ?? 'Pasted answer key', matches.length),
    total: paper.questions.length,
    matches: matches.map(({ number, choices }) => ({ number, choices })),
  });
});

app.put('/api/papers/:id/answer-key', async (req, res) => {
  if (!uuid.test(req.params.id)) throw requestError(404, 'This paper could not be found.');
  const { entries, filename, usedOcr, found, conflicts } = req.body ?? {};
  if (!Array.isArray(entries) || !entries.length || entries.length > 500 ||
      !entries.every((entry) => entry && Number.isInteger(entry.number) && entry.number > 0 &&
        Array.isArray(entry.choices) && entry.choices.length > 0 && entry.choices.length <= 8 &&
        entry.choices.every(validChoiceLabel))) {
    throw requestError(400, 'Select at least one matched answer to save.');
  }
  const answers = collectAnswers(entries.map(({ number, choices }) => [number, choices])).answers;
  const outcome = await transaction(async (db) => {
    const paper = await readPaper(req.params.id, req.workspace, db, ' FOR UPDATE');
    if (!paper) throw requestError(404, 'This paper could not be found.');
    const matches = matchAnswerKey(paper.questions, answers);
    if (matches.length !== entries.length) throw requestError(409, 'Some answers no longer match this paper. Check the key again.');
    const beforeTypes = paper.questions.map((question) => question.type);
    const updatedByNumber = new Map();
    for (const { index, number, correct } of matches) {
      const question = paper.questions[index];
      paper.questions[index] = { ...question, correct, type: correct.length > 1 ? 'msq' : question.type };
      updatedByNumber.set(number, paper.questions[index]);
    }
    const info = {
      filename: textField(filename, 240) ? filename : 'Answer key',
      matched: matches.length,
      found: Number.isInteger(found) && found >= matches.length ? found : matches.length,
      conflicts: Number.isInteger(conflicts) && conflicts >= 0 ? conflicts : 0,
      usedOcr: usedOcr === true,
    };
    await db.query('UPDATE pyq_lab_papers SET questions = $3, answer_key = $4 WHERE id = $1 AND workspace = $2',
      [paper.id, req.workspace, JSON.stringify(paper.questions), info]);
    const { rows } = await db.query('SELECT id, result FROM pyq_lab_attempts WHERE workspace = $1 AND paper_id = $2',
      [req.workspace, paper.id]);
    const updates = rows.map(({ id, result }) => {
      const items = result.items.map((item) => {
        const question = updatedByNumber.get(item.number);
        if (!question || JSON.stringify(question.options) !== JSON.stringify(item.options) ||
            JSON.stringify(question.optionLabels) !== JSON.stringify(item.optionLabels)) return item;
        return { ...item, correct: question.correct, status: grade(question.correct, item.selected) };
      });
      return { id, result: { ...result, ...score(items), answerKey: info, items } };
    });
    if (updates.length) await db.query(
      'UPDATE pyq_lab_attempts AS a SET result = u.result FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, result jsonb) ' +
      'WHERE a.id = u.id AND a.workspace = $2 AND a.paper_id = $3', [JSON.stringify(updates), req.workspace, paper.id],
    );
    return { beforeTypes, types: paper.questions.map((question) => question.type), attempts: updates.length };
  });
  res.json(outcome);
});

app.post('/api/papers/:id/attempts', async (req, res) => {
  const { id, filter, answers, flags, seconds, positions } = req.body ?? {};
  if (typeof id !== 'string' || !uuid.test(id) || !['all', 'mcq', 'msq'].includes(filter) ||
      !answers || typeof answers !== 'object' || !flags || typeof flags !== 'object') {
    return res.status(400).json({ error: 'This attempt is missing required information.' });
  }
  const outcome = await transaction(async (db) => {
    const paper = await readPaper(req.params.id, req.workspace, db, ' FOR SHARE');
    if (!paper) throw requestError(404, 'This paper could not be found.');
    if (positions !== undefined && (!Array.isArray(positions) || positions.length > paper.questions.length ||
        positions.some((position, i) => !Number.isInteger(position) || position < 0 ||
          position >= paper.questions.length || (i > 0 && position <= positions[i - 1])))) {
      throw requestError(400, 'The attempt question order is invalid. Open the paper again.');
    }
    const questions = positions ? positions.map((position) => paper.questions[position]) :
      paper.questions.filter((question) => filter === 'all' || question.type === filter);
    if (!questions.length) throw requestError(400, 'There are no questions for this filter.');
    const items = questions.map((question, index) => {
      const raw = answers[index];
      const selected = Array.isArray(raw) ? [...new Set(raw.filter(
        (n) => Number.isInteger(n) && n >= 0 && n < question.options.length,
      ))].slice(0, question.type === 'mcq' ? 1 : question.options.length) : [];
      return {
        ...question, selected, status: grade(question.correct, selected), index,
        important: flags[index]?.important === true,
        review: flags[index]?.review === true,
        topicRevision: flags[index]?.topicRevision === true,
      };
    });
    const result = {
      title: paper.title, subject: paper.subject, filter, answerKey: paper.answerKey,
      duration: Number.isFinite(seconds) ? Math.max(0, Math.min(604800, Math.floor(seconds))) : 0,
      total: items.length,
      answered: items.filter((item) => item.selected.length).length,
      ...score(items),
      marked: items.filter((item) => item.important || item.review || item.topicRevision).length,
      items,
    };
    const saved = await db.query(
      'INSERT INTO pyq_lab_attempts (id, workspace, paper_id, result) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING result',
      [id, req.workspace, paper.id, JSON.stringify(result)],
    );
    if (saved.rows.length) return { status: 201, result: saved.rows[0].result };
    const prior = await db.query('SELECT result FROM pyq_lab_attempts WHERE id = $1 AND workspace = $2 AND paper_id = $3', [id, req.workspace, paper.id]);
    if (!prior.rows.length) throw requestError(409, 'This attempt could not be saved. Refresh and try again.');
    return { status: 200, result: prior.rows[0].result };
  });
  res.status(outcome.status).json(outcome.result);
});

app.get('/api/attempts/:id', async (req, res) => {
  if (!uuid.test(req.params.id)) return res.sendStatus(404);
  const { rows } = await pool.query(
    'SELECT a.paper_id AS "paperId", a.result, p.id IS NOT NULL AS "paperAvailable" FROM pyq_lab_attempts a ' +
    'LEFT JOIN pyq_lab_papers p ON p.id::text = a.paper_id AND p.workspace = a.workspace AND p.deleted_at IS NULL ' +
    'WHERE a.id = $1 AND a.workspace = $2 AND ' + activeAttempt, [req.params.id, req.workspace],
  );
  if (!rows.length) return res.status(404).json({ error: 'This attempt could not be found.' });
  const attempt = rows[0];
  res.json({ ...attempt, paperAvailable: attempt.paperAvailable || samplePapers.some((paper) => paper.id === attempt.paperId) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'This endpoint could not be found.' }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each upload must be 20 MB or smaller.' : 'Upload one question-paper PDF and one optional answer key.' });
  }
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error('Request failed:', error.code ?? error.name);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

if (process.env.npm_lifecycle_event === 'dev') {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else if (existsSync(new URL('../dist/index.html', import.meta.url))) {
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.get('/{*path}', (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
}

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
await once(server, 'listening');
console.log('PYQ Lab is running at http://' + host + ':' + port);
