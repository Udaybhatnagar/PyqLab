import { useState } from 'react';
import { ClipboardCheck, LoaderCircle } from 'lucide-react';
import { api, remapDrafts } from './api';
import { Modal } from './Modal';

export function AnswerKeyDialog({ paper, onClose, onSaved }) {
  const [source, setSource] = useState('file');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [startQuestion, setStartQuestion] = useState('1');
  const [preview, setPreview] = useState(null);
  const [excluded, setExcluded] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endpoint = '/papers/' + paper.id + '/answer-key';

  async function analyze(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let body = { text, startQuestion };
      if (source === 'file') {
        if (!file?.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a PDF or JPG key up to 20 MB.');
        body = new FormData();
        body.append('answerKey', file);
        body.append('startQuestion', startQuestion);
      }
      setPreview(await api(endpoint, { method: 'POST', body }));
      setExcluded(new Set());
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError('');
    setBusy(true);
    const { filename, usedOcr, found, conflicts, matches } = preview;
    try {
      const entries = matches.filter(({ number }) => !excluded.has(number));
      const result = await api(endpoint, { method: 'PUT', body: { entries, filename, usedOcr, found, conflicts } });
      remapDrafts(paper.id, result.beforeTypes, result.types);
      onSaved();
    } catch (issue) {
      setError(issue.message);
      setBusy(false);
    }
  }

  return <Modal title="Match answer key" className="match-key-modal" onClose={busy ? undefined : onClose}>
    <p className="modal-lead"><strong>{paper.title}</strong>. A key can contain just question numbers and answer choices.</p>
    {preview ? <>
      <div className="key-summary">
        <ClipboardCheck size={20}/>
        <div><strong>{preview.filename}</strong><p>{preview.matched} of {preview.total} questions matched.</p>
          {!preview.matched && <small>Check that the numbers match the paper, or paste the answers and set the first question number.</small>}
          {preview.matched > 0 && (preview.matched < preview.total || preview.found > preview.matched) && <small>Unmatched questions keep any correct choices already saved.</small>}
          {preview.conflicts > 0 && <small>Conflicting entries were skipped.</small>}
          {preview.usedOcr && <small>Check recognized letters against the original key.</small>}
        </div>
      </div>
      {preview.matches.length > 0 && <fieldset className="key-matches"><legend>Confirm matched answers</legend>
        {preview.matches.map(({ number, choices }) => <label key={number}><input type="checkbox" checked={!excluded.has(number)} disabled={busy}
          onChange={(event) => setExcluded((current) => {
            const next = new Set(current);
            if (event.target.checked) next.delete(number); else next.add(number);
            return next;
          })}/><span>Question {number}</span><strong>{choices.join(', ')}</strong></label>)}
      </fieldset>}
      <div className="modal-actions">
        <button className="button outline" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Change key</button>
        <button className="button primary" disabled={busy || preview.matches.length === excluded.size} onClick={save}>
          {busy && <LoaderCircle size={16} className="spin"/>} Save and update results
        </button>
      </div>
    </> : <form className="key-match-form" onSubmit={analyze}>
      <div className="key-source-options" role="group" aria-label="Answer key source">
        <button type="button" className="button outline" aria-pressed={source === 'file'} onClick={() => setSource('file')}>Upload PDF or JPG</button>
        <button type="button" className="button outline" aria-pressed={source === 'paste'} onClick={() => setSource('paste')}>Paste answers</button>
      </div>
      {source === 'file' ? <label>Answer key file<input type="file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" onChange={(event) => setFile(event.target.files[0] ?? null)}/></label> :
        <label>Answers<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={30000} rows={5}
          placeholder={'1. B\n2. A, D\n3–5: C B A'}/></label>}
      <label className="key-start-label">First question number for an unnumbered key<input type="number" min="1" max="9999" required value={startQuestion} onChange={(event) => setStartQuestion(event.target.value)}/></label>
      <div className="modal-actions">
        <button type="button" className="button outline" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy || (source === 'file' ? !file : !text.trim())}>{busy && <LoaderCircle size={16} className="spin"/>} Match answers</button>
      </div>
    </form>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </Modal>;
}
