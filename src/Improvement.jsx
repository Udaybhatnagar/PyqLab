import { useEffect, useState } from 'react';
import { BookOpen, Bookmark, ChevronRight, ClipboardCheck, FileText, LoaderCircle } from 'lucide-react';
import { api, readDraft, filters } from './api';
import { Figures } from './diagrams';
import { contentLanguage } from './paper-text';
import { ReviewDetails, ReviewOptions } from './practice';

async function readPausedMarks(papers) {
  return (await Promise.all(papers.map(async (paper) => {
    const drafts = Object.keys(filters).flatMap((mode) => {
      const draft = readDraft(paper.id, mode);
      const flagged = Object.entries(draft?.flags ?? {}).filter(([, flags]) => flags.important || flags.topicRevision);
      return flagged.length ? [{ mode, flagged }] : [];
    });
    if (!drafts.length) return null;
    const full = paper.questions ? paper : await api('/papers/' + paper.id);
    const questions = drafts.flatMap(({ mode, flagged }) => {
      const inAttempt = full.questions.filter((question) => mode === 'all' || question.type === mode);
      return flagged.flatMap(([index, flags]) => inAttempt[index] ? [{
        ...inAttempt[index], important: flags.important, topicRevision: flags.topicRevision, draftMode: mode,
      }] : []);
    });
    return { id: paper.id, title: paper.title, subject: paper.subject, questions };
  }))).filter(Boolean);
}

function groupMarks(papers) {
  const byPaper = new Map();
  for (const paper of papers) {
    if (!byPaper.has(paper.id)) byPaper.set(paper.id, { ...paper, items: new Map() });
    const group = byPaper.get(paper.id);
    for (const question of paper.questions) {
      const key = JSON.stringify([question.number, question.page, question.prompt, question.options]);
      const prior = group.items.get(key);
      if (!prior) group.items.set(key, { ...question, key });
      else {
        prior.important ||= question.important;
        prior.topicRevision ||= question.topicRevision;
        prior.draftMode ??= question.draftMode;
      }
    }
  }
  return [...byPaper.values()].sort((a, b) => a.title.localeCompare(b.title)).map((paper) => ({
    ...paper, questions: [...paper.items.values()].sort((a, b) => a.number - b.number || (a.page ?? 0) - (b.page ?? 0)),
  }));
}

export function Improvement({ papers }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [paperFilter, setPaperFilter] = useState('');
  const [marker, setMarker] = useState('all');

  useEffect(() => {
    let active = true;
    Promise.all([api('/improvement'), readPausedMarks(papers)])
      .then(([saved, paused]) => { if (active) { setGroups(groupMarks([...saved, ...paused])); setError(''); } })
      .catch((issue) => { if (active) setError(issue.message); });
    return () => { active = false; };
  }, [papers, reload]);

  const shown = (groups ?? []).filter((paper) => !paperFilter || paper.id === paperFilter).map((paper) => ({
    ...paper, questions: paper.questions.filter((question) => marker === 'all' || question[marker]),
  })).filter((paper) => paper.questions.length);

  return <>
    <div className="page-head"><div><h1>Improvement</h1><p>Revisit important questions and topics marked for revision, grouped by paper.</p></div></div>
    {error ? <div className="banner warning" role="alert">{error}<button className="button outline" onClick={() => { setError(''); setReload((count) => count + 1); }}>Try again</button></div> :
      !groups ? <div className="inline-loading" role="status"><LoaderCircle className="spin" size={17}/> Loading marked questions…</div> :
      !groups.length ? <div className="empty"><div className="empty-icon"><ClipboardCheck size={25}/></div><h3>No marked questions yet</h3><p>Mark a question Important or Needs topic revision while practicing to see it here.</p><a className="button primary" href="#library">Browse papers</a></div> : <>
        <div className="library-controls improvement-controls">
          <select aria-label="Filter by paper" value={paperFilter} onChange={(event) => setPaperFilter(event.target.value)}>
            <option value="">All papers</option>{groups.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}
          </select>
          <select aria-label="Filter by marker" value={marker} onChange={(event) => setMarker(event.target.value)}>
            <option value="all">All markers</option><option value="important">Important</option><option value="topicRevision">Needs topic revision</option>
          </select>
        </div>
        {shown.length ? <div className="improvement-groups">{shown.map((paper) => <section className="improvement-paper" key={paper.id}>
          <header><span className="subject-icon mint"><FileText size={20}/></span>
            <div><h2>{paper.title}</h2><p>{paper.subject} · {paper.questions.length} {paper.questions.length === 1 ? 'question' : 'questions'}</p></div>
          </header>
          <div className="review-list">{paper.questions.map((question) => <ReviewDetails key={question.key} summary={<>
              <span className="review-number">{question.number}</span><strong lang={contentLanguage(question.prompt)}>{question.prompt || 'Diagram question'}</strong>
              <span className="review-status-icons">{question.important && <Bookmark size={16} className="important" aria-label="Important"/>}{question.topicRevision && <BookOpen size={16} className="topicRevision" aria-label="Needs topic revision"/>}</span>
              <ChevronRight className="review-chevron" size={17}/>
            </>}>
            <Figures paperId={paper.id} crops={question.figures} label="Question diagram"/>
            <ReviewOptions paperId={paper.id} item={question}/>
            <div className="improvement-links">
              {question.draftMode && <a className="button outline" href={'#practice/' + paper.id + '/' + question.draftMode}>Resume practice</a>}
              {question.attemptId && <a className="button outline" href={'#result/' + question.attemptId}>View attempt</a>}
            </div>
          </ReviewDetails>)}</div>
        </section>)}</div> : <div className="empty"><h3>No questions match these filters</h3><button className="button outline" onClick={() => { setPaperFilter(''); setMarker('all'); }}>Clear filters</button></div>}
      </>}
  </>;
}
