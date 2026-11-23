import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, ClipboardCheck, FileText, LoaderCircle, Plus, Save, Trash2, UploadCloud, X } from 'lucide-react';
import { api, choiceLabel } from './api';
import { contentLanguage, nextChoiceLabel } from './paper-text';
import { TextPreview } from './TextPreview';
import { DiagramPicker, FigureEditor } from './diagrams';
import { Modal } from './Modal';
import { removeLocalPdf, saveLocalPdf } from './pdf-storage';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const temporaryFailure = (issue) => [0, 408, 429, 502, 503, 504].includes(issue.status);

export function UploadDialog({ onClose, onImported }) {
  const input = useRef(null);
  const keyInput = useRef(null);
  const [file, setFile] = useState(null);
  const [keyFile, setKeyFile] = useState(null);
  const [startQuestion, setStartQuestion] = useState('1');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState('auto');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState('');
  const storedId = useRef(null);

  function forgetLocalCopy() {
    if (storedId.current) removeLocalPdf(storedId.current).catch(() => {});
    storedId.current = null;
    setJobId(null);
  }

  function close() {
    forgetLocalCopy();
    onClose();
  }

  function pick(candidate) {
    if (busy || !candidate) return;
    setError('');
    forgetLocalCopy();
    if (!/\.pdf$/i.test(candidate.name) && candidate.type !== 'application/pdf') {
      setFile(null);
      setError('Select a PDF file.');
      return;
    }
    if (candidate.size > 20 * 1024 * 1024 || !candidate.size) {
      setFile(null);
      setError('Choose a PDF between 1 byte and 20 MB.');
      return;
    }
    setFile(candidate);
  }

  function pickKey(candidate) {
    if (!candidate || busy) return;
    setError('');
    forgetLocalCopy();
    if (!/\.(pdf|jpe?g)$/i.test(candidate.name) && !['application/pdf', 'image/jpeg'].includes(candidate.type)) {
      setError('Choose a PDF or JPG for the answer key.');
      return;
    }
    if (!candidate.size || candidate.size > 20 * 1024 * 1024) {
      setError('Choose an answer key between 1 byte and 20 MB.');
      return;
    }
    setKeyFile(candidate);
  }

  async function extract(event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    const id = jobId ?? crypto.randomUUID();
    const endpoint = '/import/jobs/' + id;
    const start = () => {
      const body = new FormData();
      body.append('pdf', file);
      body.append('language', language);
      if (keyFile) {
        body.append('answerKey', keyFile);
        body.append('startQuestion', startQuestion);
      }
      return api(endpoint + '?storage=browser', { method: 'POST', body, signal: AbortSignal.timeout(90000) });
    };
    try {
      if (!jobId) {
        if (storedId.current && storedId.current !== id) await removeLocalPdf(storedId.current);
        await saveLocalPdf(id, file);
        storedId.current = id;
        setProgress('Uploading the PDF…');
        try { await start(); }
        catch (issue) {
          if (!temporaryFailure(issue)) throw issue;
          setProgress('Reconnecting to the upload server…');
          await pause(3000);
          try { await api(endpoint, { signal: AbortSignal.timeout(15000) }); }
          catch (checkError) {
            if (checkError.status !== 404 && !temporaryFailure(checkError)) throw checkError;
            await start();
          }
        }
        setJobId(id);
      }
      setProgress('PDF uploaded. Waiting for extraction to start…');
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline) {
        let job;
        try { job = await api(endpoint, { signal: AbortSignal.timeout(20000) }); }
        catch (issue) {
          if (!temporaryFailure(issue)) {
            if (issue.status === 404) setJobId(null);
            throw issue;
          }
          setProgress('The server is reconnecting. We’ll check this upload again.');
          await pause(5000);
          continue;
        }
        if (job.status === 'ready') return onImported(job.paper, file, keyFile);
        if (job.status === 'needs-upload') {
          setProgress('The extraction server restarted. Resending your local PDF…');
          await start();
          await pause(3000);
          continue;
        }
        if (job.status === 'failed') {
          setJobId(null);
          throw new Error(job.error || 'Extraction failed. Please try again.');
        }
        setProgress(job.status === 'queued' ? 'PDF uploaded. Waiting for extraction to start…' :
          'Extracting questions. Scanned papers can take several minutes.');
        await pause(3000);
      }
      throw new Error('This import is still pending. Select Check progress to keep waiting.');
    } catch (issue) {
      setError(issue.message);
      setBusy(false);
    }
  }

  return <Modal title="Import a question paper" onClose={busy ? undefined : close}>
    <p className="modal-lead">Your original PDF stays in this browser. The server reads it temporarily to build your practice set.</p>
    <form onSubmit={extract}>
      <input ref={input} className="sr-only" type="file" accept=".pdf,application/pdf" tabIndex={-1} onChange={(event) => pick(event.target.files[0])}/>
      <button type="button" className={'dropzone' + (dragging ? ' dragging' : '')} disabled={busy} onClick={() => input.current.click()}
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files[0]); }}>
        <span className="subject-icon mint">{file ? <FileText size={23}/> : <UploadCloud size={24}/>}</span>
        <strong>{file ? file.name : 'Choose a PDF or drag it here'}</strong>
        <small>{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB · Click to replace' : 'PDF up to 20 MB and 100 pages'}</small>
      </button>
      <label className="key-start-label">Paper language
        <select aria-label="Paper language" value={language} disabled={busy} onChange={(event) => { setLanguage(event.target.value); forgetLocalCopy(); }}>
          <option value="auto">Automatic (Hindi and English)</option>
          <option value="hindi">Hindi (हिन्दी)</option>
          <option value="english">English</option>
        </select>
      </label>
      <div className="key-upload">
        <span className="subject-icon violet"><ClipboardCheck size={20}/></span>
        <div><strong>Answer key <small>Optional</small></strong><p>{keyFile ? keyFile.name : 'PDF or JPG up to 20 MB'}</p></div>
        <input ref={keyInput} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" tabIndex={-1}
          onChange={(event) => { pickKey(event.target.files[0]); event.target.value = ''; }}/>
        <button type="button" className="button outline" aria-label={keyFile ? 'Replace answer key' : 'Choose answer key'}
          disabled={busy} onClick={() => keyInput.current.click()}>{keyFile ? 'Replace' : 'Choose file'}</button>
        {keyFile && <button type="button" className="icon-button" aria-label="Remove answer key" disabled={busy}
          onClick={() => { setKeyFile(null); forgetLocalCopy(); setError(''); }}><X size={17}/></button>}
      </div>
      {keyFile && <label className="key-start-label">First question number for an unnumbered key
        <input type="number" min="1" max="9999" value={startQuestion} disabled={busy} required onChange={(event) => { setStartQuestion(event.target.value); forgetLocalCopy(); }}/>
      </label>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {busy && <p className="inline-loading" role="status"><LoaderCircle size={16} className="spin"/> {progress}</p>}
      <div className="modal-actions">
        <button type="button" className="button outline" disabled={busy} onClick={close}>Cancel</button>
        <button type="submit" className="button primary" disabled={!file || busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <UploadCloud size={17}/>} {jobId && !busy ? 'Check progress' : 'Extract questions'}</button>
      </div>
    </form>
  </Modal>;
}

function newQuestion(number) { return { number, type: 'mcq', prompt: '', options: ['', '', '', ''], correct: [] }; }

export function ImportEditor({ data, file, keyFile, subjects, onClose, onSaved }) {
  const [title, setTitle] = useState(data.filename.replace(/\.pdf$/i, '').replaceAll('_', ' ').slice(0, 140));
  const [subject, setSubject] = useState('');
  const [questions, setQuestions] = useState(() => data.questions.length ? data.questions : [newQuestion(1)]);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [keyUrl, setKeyUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [diagramTarget, setDiagramTarget] = useState(null);
  const question = questions[index];

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!keyFile) return;
    const url = URL.createObjectURL(keyFile);
    setKeyUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [keyFile]);

  function update(patch) {
    setQuestions((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function adjustOption(value, position) {
    update({ options: question.options.map((option, i) => i === position ? value : option) });
  }

  function removeOption(position) {
    update({
      options: question.options.filter((_, i) => i !== position),
      optionLabels: question.options.map((_, i) => choiceLabel(question, i)).filter((_, i) => i !== position),
      optionFigures: question.optionFigures?.filter((_, i) => i !== position),
      correct: question.correct.filter((i) => i !== position).map((i) => i > position ? i - 1 : i),
    });
  }

  function addOption() {
    const labels = question.options.map((_, i) => choiceLabel(question, i));
    const next = nextChoiceLabel(labels);
    if (!next) return;
    update({ options: [...question.options, ''], optionLabels: [...labels, next],
      optionFigures: question.optionFigures && [...question.optionFigures, []] });
  }

  function changeFigures(position, transform) {
    if (position === 'prompt') {
      update({ figures: transform(question.figures ?? []) });
    } else {
      update({ optionFigures: question.options.map((_, i) => {
        const figures = question.optionFigures?.[i] ?? [];
        return i === position ? transform(figures) : figures;
      }) });
    }
  }

  function toggleKey(position) {
    const correct = question.correct.includes(position)
      ? question.correct.filter((i) => i !== position)
      : question.type === 'mcq' ? [position] : [...question.correct, position];
    update({ correct });
  }

  function addQuestion() {
    setQuestions([...questions, newQuestion(Math.max(...questions.map((item) => item.number)) + 1)]);
    setIndex(questions.length);
  }

  function removeQuestion() {
    setQuestions(questions.filter((_, i) => i !== index));
    setIndex(Math.min(index, questions.length - 2));
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const invalidIndex = questions.findIndex((item) => (!item.prompt.trim() && !item.figures?.length) ||
      item.options.some((option, i) => !option.trim() && !item.optionFigures?.[i]?.length));
    if (invalidIndex !== -1) {
      setIndex(invalidIndex);
      setError('Add text or a diagram to the question and each answer choice, or remove unused choices.');
      return;
    }
    setBusy(true);
    try {
      const matchedSubject = subjects.find((item) => item.toLowerCase() === subject.trim().toLowerCase());
      onSaved(await api('/papers/' + data.id, { method: 'PUT', body: { title, subject: matchedSubject ?? subject, questions } }));
    } catch (issue) { setError(issue.message); setBusy(false); }
  }

  return <><Modal title="Review extracted questions" className={'editor-modal' + (source ? ' wide-editor' : '')} onClose={busy ? undefined : () => setDiscard(true)}>
    {discard ? <>
      <p className="modal-lead">Discard this import? You can upload the PDF again later.</p>
      <div className="modal-actions"><button className="button outline" onClick={() => setDiscard(false)}>Keep editing</button><button className="button danger" onClick={onClose}>Discard import</button></div>
    </> : <form onSubmit={save}>
      <div className="import-summary"><span><FileText size={16}/> {data.filename} · {data.pages} {data.pages === 1 ? 'page' : 'pages'}</span>
        <div className="import-source-actions">
          <button className="button outline" type="button" onClick={() => setSource(source === 'text' ? '' : 'text')}>{source === 'text' ? 'Hide text' : 'View extracted text'}</button>
          <button className="button outline" type="button" onClick={() => setSource(source === 'paper' ? '' : 'paper')}>{source === 'paper' ? 'Hide PDF' : 'View PDF'}</button>
        </div></div>
      <p className="modal-lead">{data.questions.length ? data.questions.length + ' questions detected. Check the choices, diagrams, and answer keys.' : 'No multiple-choice questions were detected. You can still download the extracted text or add questions manually.'}</p>
      {data.answerKey && <div className="key-summary">
        <ClipboardCheck size={20}/>
        <div><strong>{data.answerKey.filename}</strong><p>{data.answerKey.matched} of {data.questions.length} questions matched to the uploaded key.</p>
          {(data.answerKey.found !== data.answerKey.matched || data.answerKey.conflicts > 0 || data.answerKey.matched < data.questions.length) &&
            <small>Check unmatched questions and set any missing correct choices below.</small>}
          {data.answerKey.usedOcr && <small>Check the selections against the original. OCR can misread letters.</small>}
        </div>
        <button className="button outline" type="button" onClick={() => setSource(source === 'key' ? '' : 'key')}>{source === 'key' ? 'Hide key' : 'View answer key'}</button>
      </div>}
      {data.notes.length > 0 && <div className="banner warning"><AlertCircle size={17}/><span>{data.notes.join(' ')}</span></div>}
      <div className="editor-layout">
        <div className="editor-fields">
          <div className="field-grid">
            <label>Paper title<input value={title} required maxLength={140} onChange={(event) => setTitle(event.target.value)}/></label>
            <label>Subject<input list="existing-subjects" value={subject} required maxLength={60} placeholder="e.g. Physics" onChange={(event) => setSubject(event.target.value)}/><datalist id="existing-subjects">{subjects.map((item) => <option key={item} value={item}/>)}</datalist></label>
          </div>
          <div className="editor-question">
            <div className="editor-nav"><div><button type="button" className="icon-button" disabled={!index} onClick={() => setIndex(index - 1)} aria-label="Previous extracted question"><ChevronLeft size={19}/></button>
              <strong>Question {index + 1} of {questions.length}</strong>
              <button type="button" className="icon-button" disabled={index + 1 >= questions.length} onClick={() => setIndex(index + 1)} aria-label="Next extracted question"><ChevronRight size={19}/></button></div>
              <button type="button" className="icon-button remove" disabled={questions.length < 2} onClick={removeQuestion} aria-label="Remove question" title="Remove question"><Trash2 size={17}/></button>
            </div>
            <div className="field-grid editor-type">
              <label>Type<select value={question.type} onChange={(event) => update({ type: event.target.value, correct: event.target.value === 'mcq' ? question.correct.slice(0, 1) : question.correct })}><option value="mcq">MCQ · Single answer</option><option value="msq">MSQ · Multiple answers</option></select></label>
              {question.page && <p>Source page {question.page} · Q{question.number}</p>}
            </div>
            <label>Question text<textarea rows={3} maxLength={6000} lang={contentLanguage(question.prompt)} value={question.prompt} onChange={(event) => update({ prompt: event.target.value })}/></label>
            <FigureEditor paperId={data.id} crops={question.figures} label="Question diagram"
              onAdd={() => setDiagramTarget('prompt')} onRemove={(index) => changeFigures('prompt', (crops) => crops.filter((_, i) => i !== index))}/>
            <div className="editor-choice-label"><strong>Answer options</strong><small>Tick each correct answer if you have the key.</small></div>
            {question.options.map((option, position) => <div key={position} className="edit-option-wrap"><div className="edit-option">
              <button type="button" className={'key-check' + (question.correct.includes(position) ? ' checked' : '')} aria-label={'Mark option ' + choiceLabel(question, position) + ' correct'} aria-pressed={question.correct.includes(position)} onClick={() => toggleKey(position)}>{question.correct.includes(position) ? <Check size={16}/> : choiceLabel(question, position)}</button>
              <input aria-label={'Option ' + choiceLabel(question, position)} lang={contentLanguage(option)} maxLength={3000} value={option} onChange={(event) => adjustOption(event.target.value, position)}/>
              <button type="button" className="icon-button remove" disabled={question.options.length === 2} aria-label={'Remove option ' + choiceLabel(question, position)} onClick={() => removeOption(position)}><Trash2 size={16}/></button>
            </div>
              <FigureEditor paperId={data.id} crops={question.optionFigures?.[position]} label={'Diagram for option ' + choiceLabel(question, position)}
                onAdd={() => setDiagramTarget(position)} onRemove={(index) => changeFigures(position, (crops) => crops.filter((_, i) => i !== index))}/>
            </div>)}
            <button type="button" className="button text-button" disabled={question.options.length >= 8} onClick={addOption}><Plus size={16}/> Add option</button>
          </div>
        </div>
        {source === 'paper' && <iframe className="editor-pdf" title="Original question paper" src={pdfUrl + '#page=' + (question.page ?? 1)}/>}
        {source === 'text' && <TextPreview text={data.extractedText} filename={data.filename}/>}
        {source === 'key' && (keyFile.type === 'image/jpeg' || /\.jpe?g$/i.test(keyFile.name) ?
          <img className="editor-key-image" alt="Uploaded answer key" src={keyUrl}/> :
          <iframe className="editor-pdf" title="Uploaded answer key" src={keyUrl}/>)}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="modal-actions editor-actions">
        <button type="button" className="button outline" disabled={questions.length >= 500 || busy} onClick={addQuestion}><Plus size={17}/> Add question</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <Save size={17}/>} Save practice set</button>
      </div>
    </form>}
  </Modal>
    {diagramTarget !== null && <DiagramPicker paperId={data.id} initialPage={question.page ?? 1} pages={data.pages}
      onClose={() => setDiagramTarget(null)}
      onPick={(crop) => { changeFigures(diagramTarget, (crops) => [...crops, crop]); setDiagramTarget(null); }}/>}
  </>;
}
