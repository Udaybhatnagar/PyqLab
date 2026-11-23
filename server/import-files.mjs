import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const uploadOwner = randomUUID();
let temporaryRoot;

export async function stageImportFiles(file, answerKey) {
  temporaryRoot ??= mkdtemp(join(tmpdir(), 'pyq-lab-'));
  const root = await temporaryRoot;
  const id = randomUUID();
  await mkdir(join(root, id));
  try {
    await writeFile(join(root, id, 'paper.pdf'), file.buffer);
    if (answerKey) await writeFile(join(root, id, 'key'), answerKey.buffer);
    return id;
  } catch (error) {
    await removeImportFiles(id);
    throw error;
  }
}

export async function readImportFiles({ stage, keyName }) {
  const root = await temporaryRoot;
  const buffer = await readFile(join(root, stage, 'paper.pdf'));
  const answerKey = keyName ? { originalname: keyName, buffer: await readFile(join(root, stage, 'key')) } : null;
  return { file: { buffer }, answerKey };
}

export async function removeImportFiles(stage) {
  if (!stage || !temporaryRoot) return;
  const folder = join(await temporaryRoot, stage);
  await Promise.allSettled(['paper.pdf', 'key'].map((name) => unlink(join(folder, name))));
  await rmdir(folder).catch(() => {});
}
