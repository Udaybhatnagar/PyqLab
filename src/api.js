const storageKey = 'pyq.workspace';
const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '');
let workspace = localStorage.getItem(storageKey);
if (!workspace) {
  workspace = crypto.randomUUID();
  localStorage.setItem(storageKey, workspace);
}

export async function api(path, options = {}) {
  const { body, method = 'GET' } = options;
  const headers = { 'X-Study-Workspace': workspace };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(apiOrigin + '/api' + path, {
      method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  if (response.status === 204) return;
  return options.blob ? response.blob() : response.json();
}

export function draftKey(id, filter) { return 'pyq.draft.' + id + '.' + filter; }
export function readDraft(id, filter) {
  try { return JSON.parse(localStorage.getItem(draftKey(id, filter))); }
  catch { return null; }
}

export function formatTime(seconds) {
  return [Math.floor(seconds / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

export const filters = { all: 'All questions', mcq: 'MCQ only', msq: 'MSQ only' };
export const letter = (index) => String.fromCharCode(65 + index);
export const choiceLabel = (question, index) => question.optionLabels?.[index] ?? letter(index);

export function remapDrafts(id, before, after) {
  if (before.every((type, index) => type === after[index])) return;
  for (const filter of ['mcq', 'msq']) {
    const draft = readDraft(id, filter);
    if (!draft) continue;
    const oldPositions = before.flatMap((type, position) => type === filter ? [position] : []);
    const newPositions = after.flatMap((type, position) => type === filter ? [position] : []);
    if (!newPositions.length) {
      localStorage.removeItem(draftKey(id, filter));
      continue;
    }
    const oldIndexes = new Map(oldPositions.map((position, index) => [position, index]));
    const answers = {}, flags = {};
    newPositions.forEach((position, index) => {
      const old = oldIndexes.get(position);
      if (draft.answers[old]) answers[index] = draft.answers[old];
      if (draft.flags[old]) flags[index] = draft.flags[old];
    });
    const active = newPositions.indexOf(oldPositions[draft.index]);
    localStorage.setItem(draftKey(id, filter),
      JSON.stringify({ ...draft, answers, flags, index: active < 0 ? Math.min(draft.index, newPositions.length - 1) : active }));
  }
}
