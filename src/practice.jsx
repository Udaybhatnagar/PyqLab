import { useEffect, useRef, useState } from 'react';
import { BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Flag, LayoutGrid, LoaderCircle, RotateCcw, Target, X, Zap } from 'lucide-react';
import { api, choiceLabel, draftKey, filters, formatTime, readDraft } from './api';
import { Modal } from './Modal';
import { Figures } from './diagrams';
import { contentLanguage } from './paper-text';

const markers = [
  { key: 'important', label: 'Important', Icon: Bookmark },
  { key: 'review', label: 'Needs review', Icon: Flag },
  { key: 'topicRevision', label: 'Needs topic revision', Icon: BookOpen },
];

export function Exam({ paper, filter, onExit, onSubmitted }) {
  const positions = paper.questions.flatMap((question, index) => filter === 'all' || question.type === filter ? [index] : []);
  const questions = positions.map((position) => paper.questions[position]);
  const [draft, setDraft] = useState(() => readDraft(paper.id, filter) ?? {
    id: crypto.randomUUID(), answers: {}, flags: {}, index: 0, seconds: 0,
  });
  const { index, answers, flags, seconds } = draft;
  const question = questions[index];
  const currentFlags = flags[index] ?? {};
  const selected = answers[index] ?? [];
  const answered = questions.filter((_, i) => answers[i]?.length).length;
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const questionHeading = useRef(null);
  const previousIndex = useRef(index);

  useEffect(() => {
    if (busy) return;
    const interval = setInterval(() => setDraft((state) => ({ ...state, seconds: state.seconds + 1 })), 1000);
    return () => clearInterval(interval);
  }, [busy]);

  useEffect(() => {
    localStorage.setItem(draftKey(paper.id, filter), JSON.stringify(draft));
  }, [draft, paper.id, filter]);

  useEffect(() => {
    if (previousIndex.current === index) return;
    previousIndex.current = index;
    const heading = questionHeading.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const card = heading.closest('.question-card');
    if (card.getBoundingClientRect().top < 0 || heading.getBoundingClientRect().bottom > window.innerHeight) {
      card.scrollIntoView({ block: 'start' });
    }
  }, [index]);

  function jump(next) {
    if (next >= 0 && next < questions.length) setDraft((state) => ({ ...state, index: next }));
  }

  function toggleAnswer(option) {
    setDraft((state) => {
      const previous = state.answers[index] ?? [];
      const next = question.type === 'mcq' ? [option] : previous.includes(option) ? previous.filter((i) => i !== option) : [...previous, option];
      return { ...state, answers: { ...state.answers, [index]: next } };
    });
  }

  function toggleFlag(flag) {
    setDraft((state) => ({ ...state, flags: { ...state.flags, [index]: { ...state.flags[index], [flag]: !state.flags[index]?.[flag] } } }));
  }

  useEffect(() => {
    function handleKey(event) {
      if (confirm || !question || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        jump(index + (event.key === 'ArrowLeft' ? -1 : 1));
      } else if (/^[1-8]$/.test(event.key) && Number(event.key) <= question.options.length) {
        toggleAnswer(Number(event.key) - 1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await api('/papers/' + paper.id + '/attempts', { method: 'POST', body: { ...draft, filter, positions } });
      localStorage.removeItem(draftKey(paper.id, filter));
      onSubmitted(draft.id);
    } catch (issue) { setError(issue.message); setBusy(false); }
  }

  if (!question) return <div className="empty"><CircleHelp/><h3>No questions in this mode</h3><button className="button outline" onClick={onExit}>Back to library</button></div>;

  return <>
    <header className="exam-header">
      <div className="exam-brand"><span className="logo-mark"><Zap size={19} fill="currentColor"/></span><div><strong>{paper.title}</strong><small>{paper.subject} · {filters[filter]}</small></div></div>
      <div className="exam-header-actions"><span className="timer" aria-label={'Elapsed time ' + formatTime(seconds)}><Clock3 size={17}/>{formatTime(seconds)}</span><button className="button outline" onClick={() => setConfirm('exit')}><X size={17}/> Exit</button></div>
    </header>
    <div className="exam-layout">
      <section className="question-card" aria-label="Current question">
        <div className="question-topline"><span>QUESTION {index + 1} <span className="muted">/ {questions.length}</span></span><span className={'type-chip ' + question.type}>{question.type.toUpperCase()}</span></div>
        <h1 ref={questionHeading} className="question-text" tabIndex={-1} dir="auto" lang={contentLanguage(question.prompt)}>{question.prompt || 'Study the diagram'}</h1>
        <Figures paperId={paper.id} crops={question.figures} label="Question diagram"/>
        <p id="question-hint" className="question-hint">{question.type === 'mcq' ? 'Choose one answer.' : 'Select all answers that apply.'}</p>
        <div key={index} className="options" role={question.type === 'mcq' ? 'radiogroup' : 'group'} aria-label="Answer options" aria-describedby="question-hint">
          {question.options.map((option, position) => {
            const checked = selected.includes(position);
            return <label key={position} className={'exam-option' + (checked ? ' selected' : '')}>
              <input type={question.type === 'mcq' ? 'radio' : 'checkbox'} name="answer" checked={checked} onChange={() => toggleAnswer(position)}/>
              <span className={'option-letter ' + question.type}>{choiceLabel(question, position)}</span>
              <span className="answer-text" dir="auto" lang={contentLanguage(option)}>{option}<Figures paperId={paper.id} crops={question.optionFigures?.[position]} label={'Diagram for option ' + choiceLabel(question, position)}/></span>
              {checked && <Check className="answer-check" size={18} aria-hidden="true"/>}
            </label>;
          })}
        </div>
        <div className="flag-actions">
          {markers.map(({ key, label, Icon }) => (
            <button key={key} aria-pressed={!!currentFlags[key]} className={'button outline flag ' + key} onClick={() => toggleFlag(key)}><Icon size={17}/> {label}</button>
          ))}
          {selected.length > 0 && <button className="button text-button clear-answer" onClick={() => setDraft((state) => ({ ...state, answers: { ...state.answers, [index]: [] } }))}>Clear answer</button>}
        </div>
        <div className="exam-nav">
          <button className="button outline" disabled={!index} onClick={() => jump(index - 1)}><ChevronLeft size={18}/> Previous</button>
          {index + 1 < questions.length ? <button className="button primary" onClick={() => jump(index + 1)}>Next <ChevronRight size={18}/></button> :
            <button className="button primary" onClick={() => setConfirm('submit')}>Finish practice <Check size={18}/></button>}
        </div>
      </section>
      <aside className="question-map">
        <h2><LayoutGrid size={19}/> Question navigator</h2>
        <div className="question-progress"><span>Answered</span><strong>{answered} / {questions.length}</strong></div>
        <progress value={answered} max={questions.length} aria-label="Questions answered"/>
        <div className="navigator-grid">
          {questions.map((_, i) => {
            const active = markers.filter(({ key }) => flags[i]?.[key]);
            const isAnswered = !!answers[i]?.length;
            return <button key={i} aria-current={index === i ? 'step' : undefined}
              aria-label={['Question ' + (i + 1), isAnswered ? 'answered' : 'unanswered', ...active.map(({ label }) => label.toLowerCase())].join(', ')}
              className={(isAnswered ? 'answered ' : '') + (index === i ? 'current' : '')} onClick={() => jump(i)}>
              {i + 1}<span className="navigator-marks">{active.map(({ key }) => <i className={key + '-dot'} key={key}/>)}</span>
            </button>;
          })}
        </div>
        <div className="nav-legend"><span><i className="answered-dot"/>Answered</span><span><i className="unanswered-dot"/>Unanswered</span>{markers.map(({ key, label }) => <span key={key}><i className={key + '-dot'}/>{label}</span>)}</div>
        <button className="button primary submit-button" onClick={() => setConfirm('submit')}><Check size={18}/> Submit attempt</button>
        <small className="draft-note">Progress saves in this browser.</small>
      </aside>
    </div>
    {confirm && <Modal title={confirm === 'exit' ? 'Pause practice?' : 'Submit this attempt?'} onClose={busy ? undefined : () => setConfirm('')}>
      <p className="modal-lead">{confirm === 'exit' ? 'Your answers and markers will be here when you resume this practice set.' : 'You answered ' + answered + ' of ' + questions.length + ' questions. Submit to see your results and marked questions.'}</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button outline" disabled={busy} onClick={() => setConfirm('')}>Keep practicing</button>
        <button className="button primary" disabled={busy} onClick={confirm === 'exit' ? onExit : submit}>{busy && <LoaderCircle size={17} className="spin"/>}{confirm === 'exit' ? 'Save and exit' : 'Submit attempt'}</button></div>
    </Modal>}
  </>;
}

const reviewFilters = [
  ['all', 'All questions'], ['marked', 'Marked'],
  ...markers.map(({ key, label }) => [key, label]),
  ['incorrect', 'Incorrect'], ['skipped', 'Skipped'], ['ungraded', 'Ungraded'],
];
const statuses = { correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped', ungraded: 'Ungraded' };

function displayChoices(item, indexes, empty) {
  return indexes?.map((index) => choiceLabel(item, index)).sort().join(', ') || empty;
}

export function ReviewOptions({ item, paperId }) {
  return <div className="review-options">{item.options.map((option, position) => {
    const correct = item.correct.includes(position);
    const selected = item.selected?.includes(position);
    return <div className={'review-option' + (correct ? ' right-option' : selected && item.correct.length ? ' wrong-option' : '')} key={position}>
      <span className="option-letter">{choiceLabel(item, position)}</span>
      <span className="answer-text" lang={contentLanguage(option)}>{option}<Figures paperId={paperId} crops={item.optionFigures?.[position]} label={'Diagram for option ' + choiceLabel(item, position)}/></span>
      {(correct || selected) && <small>{[correct && 'Correct answer', selected && 'Your answer'].filter(Boolean).join(' · ')}</small>}
    </div>;
  })}</div>;
}

export function ReviewDetails({ summary, children }) {
  const [open, setOpen] = useState(false);
  return <details className="review-item" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {open && children}
  </details>;
}

export function Result({ data, paperId, back, retry, onMatchKey }) {
  const [filter, setFilter] = useState('all');
  const shown = data.items.filter((item) => {
    if (filter === 'all' || item.status === filter) return true;
    return markers.some(({ key }) => item[key] && (filter === 'marked' || filter === key));
  });
  const accuracy = data.graded ? Math.round(data.correct / data.graded * 100) + '%' : '—';
  return <>
    <header className="exam-header">
      <div className="exam-brand"><span className="logo-mark"><Target size={19}/></span><div><strong>Practice complete</strong><small>Results & review</small></div></div>
      <button className="button outline" onClick={back}><ChevronLeft size={18}/> My progress</button>
    </header>
    <div className="results-layout">
      <div className="results-hero"><div><span className="eyebrow"><Check size={15}/> ATTEMPT COMPLETE</span><h1>{data.title}</h1><p>{data.subject} · {filters[data.filter]}</p></div>
        {retry && <button className="button primary" onClick={retry}><RotateCcw size={17}/> Practice again</button>}</div>
      <div className="results-stats">
        <div><strong>{data.graded ? data.correct + ' / ' + data.graded : '—'}</strong><span>Correct</span></div>
        <div><strong>{accuracy}</strong><span>Score on graded questions</span></div>
        <div><strong>{data.answered} / {data.total}</strong><span>Answered</span></div>
        <div><strong>{formatTime(data.duration)}</strong><span>Time spent</span></div>
      </div>
      {data.graded < data.total && <div className="banner warning result-key-banner">
        <div>{data.graded === 0 && data.answerKey ? 'The uploaded key did not match any questions in this attempt.' :
          data.graded === 0 ? 'No correct choices are mapped for this attempt.' :
            (data.total - data.graded) + ' of ' + data.total + ' questions are still ungraded.'}</div>
        {onMatchKey && <button className="button outline" onClick={onMatchKey}>Match answer key</button>}
      </div>}
      <div className="section-head review-heading"><div><h2>Review answers</h2><p>{data.marked} marked for another look</p></div><select aria-label="Filter review answers" value={filter} onChange={(event) => setFilter(event.target.value)}>{reviewFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="review-list">
        {shown.map((item) => <ReviewDetails key={item.index} summary={<><span className="review-number" aria-label={'Question ' + (item.number ?? item.index + 1)}>{item.number ?? item.index + 1}</span>
          <div className="review-prompt"><strong lang={contentLanguage(item.prompt)}>{item.prompt || 'Diagram question'}</strong><span className="review-answer">Your answer <b>{displayChoices(item, item.selected, 'Not answered')}</b>
            <span>Key <b>{displayChoices(item, item.correct, 'Unmapped')}</b></span></span></div>
          <span className="review-status-icons">{markers.map(({ key, label, Icon }) => item[key] && <Icon key={key} className={key} size={16} role="img" aria-label={label} title={label}/>)}</span><span className={'result-status ' + item.status}>{statuses[item.status]}</span><ChevronRight className="review-chevron" size={17}/></>}>
          <Figures paperId={paperId} crops={item.figures} label="Question diagram"/>
          <ReviewOptions paperId={paperId} item={item}/>
        </ReviewDetails>)}
        {!shown.length && <div className="empty"><h3>No questions match this filter</h3><button className="button outline" onClick={() => setFilter('all')}>Show all questions</button></div>}
      </div>
    </div>
  </>;
}
