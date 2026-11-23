import { readImportFiles, removeImportFiles, uploadOwner } from './import-files.mjs';

export const importJobSchema = `
  CREATE TABLE IF NOT EXISTS pyq_lab_import_jobs (
    id uuid PRIMARY KEY REFERENCES pyq_lab_papers(id) ON DELETE CASCADE,
    options jsonb NOT NULL, key_data bytea, status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
    error text, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
  );
`;

export async function runImportJobs(pool, transaction, parseImport) {
  // A restarted worker can reclaim an expired job. Stop retrying after a second interruption.
  await pool.query(`
    UPDATE pyq_lab_import_jobs SET status = 'failed', key_data = NULL,
      error = 'Extraction was interrupted twice. Try splitting the PDF into smaller files.'
    WHERE status = 'running' AND lease_until < now() AND attempts >= 2
  `);
  while (true) {
    const { rows } = await pool.query(`
      WITH next_job AS (
        SELECT id FROM pyq_lab_import_jobs
        WHERE (options->>'uploadOwner' IS NULL OR options->>'uploadOwner' = $1)
          AND (status = 'queued' OR (status = 'running' AND lease_until < now() AND attempts < 2))
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE pyq_lab_import_jobs j SET status = 'running', attempts = j.attempts + 1,
        lease_until = now() + interval '90 seconds'
      FROM next_job n, pyq_lab_papers p WHERE j.id = n.id AND p.id = j.id
      RETURNING j.id, j.attempts, j.options, j.key_data, p.pdf
    `, [uploadOwner]);
    const job = rows[0];
    if (!job) return;
    const keepLease = setInterval(() => {
      pool.query("UPDATE pyq_lab_import_jobs SET lease_until = now() + interval '90 seconds' WHERE id = $1 AND attempts = $2 AND status = 'running'",
        [job.id, job.attempts]).catch((issue) => console.error('Import lease check failed:', issue.code ?? issue.name));
    }, 20000);

    try {
      let paper;
      try {
        const input = job.options.stage ? await readImportFiles(job.options) : {
          file: { buffer: job.pdf },
          answerKey: job.key_data && { buffer: job.key_data, originalname: job.options.keyName },
        };
        paper = await parseImport({
          ...input,
          sequenceStart: job.options.sequenceStart,
          language: job.options.language,
        });
      } catch (issue) {
        await pool.query("UPDATE pyq_lab_import_jobs SET status = $3, error = $4, key_data = NULL WHERE id = $1 AND attempts = $2 AND status = 'running'",
          [job.id, job.attempts, issue.code === 'ENOENT' ? 'needs-upload' : 'failed', issue.status ? issue.message : 'Extraction failed. Please try again.']);
        continue;
      }
      const { pages, answerKey, extractedText, ...result } = paper;
      await transaction(async (db) => {
        const completed = await db.query("UPDATE pyq_lab_import_jobs SET status = 'ready', result = $3, key_data = NULL WHERE id = $1 AND attempts = $2 AND status = 'running'",
          [job.id, job.attempts, result]);
        if (completed.rowCount) await db.query('UPDATE pyq_lab_papers SET pages = $2, answer_key = $3, extracted_text = $4 WHERE id = $1',
          [job.id, pages, answerKey, extractedText]);
      });
    } finally {
      clearInterval(keepLease);
      await removeImportFiles(job.options.stage);
    }
  }
}
