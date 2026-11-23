import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, Atom, BookOpen, BookOpenCheck, Braces, ChevronRight, CircleHelp, ClipboardList,
  FileText, FolderOpen, GraduationCap, LayoutGrid, LibraryBig, Menu, Plus, Search, Sparkles, Target,
  UploadCloud, Zap, ChartNoAxesCombined, Check, Sigma, LoaderCircle, Trash2, ClipboardCheck,
} from 'lucide-react';
import { api, draftKey, filters, readDraft } from './api';
import { samplePapers } from './demo';
import { ImportEditor, UploadDialog } from './import';
import { Exam, Result } from './practice';
import { Modal } from './Modal';
import { Landing, Logo } from './Landing';
import { Improvement } from './Improvement';
import { AnswerKeyDialog } from './AnswerKey';
import { TextPreview } from './TextPreview';
import { getLocalPdf, pdfDigest, removeLocalPdf, saveLocalPdf } from './pdf-storage';
import './style.css';

const sampleIndex = new Map(samplePapers.map((paper) => [paper.id, paper]));
const shortcuts = [
  ['dashboard', 'Dashboard', LayoutGrid], ['library', 'Paper library', LibraryBig],
  ['subjects', 'Subjects', BookOpen], ['progress', 'My progress', ChartNoAxesCombined],
  ['improvement', 'Improvement', Target],
];
const theme = {
  physics: { name: 'violet', Icon: Atom },
  mathematics: { name: 'mint', Icon: Sigma },
  'computer science': { name: 'peach', Icon: Braces },
  chemistry: { name: 'peach', Icon: Activity },
};

const getRoute = () => location.hash.slice(1) || 'home';
const go = (next) => { location.hash = next; };
const date = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

function SubjectIcon({ subject, size = 20 }) {
  const { name, Icon } = theme[subject.toLowerCase()] ?? { name: 'blue', Icon: BookOpen };
  return <span className={'subject-icon ' + name}><Icon size={size} strokeWidth={1.8} /></span>;
}

function Hero({ onUpload, onSample }) {
  return <section className="hero">
    <div className="hero-copy">
      <span className="eyebrow hero-tag"><Sparkles size={14} /> YOUR STUDY SPACE</span>
      <h1>Past papers.<br/><em>Better practice.</em></h1>
      <p>Turn previous-year question papers into interactive practice sets and track your progress.</p>
      <div className="hero-actions">
        <button className="button primary" onClick={onUpload}><UploadCloud size={18}/>Upload a PDF</button>
        <button className="button hero-secondary" onClick={onSample}><BookOpen size={17}/>Try a sample</button>
      </div>
    </div>
    <div className="hero-art" aria-hidden="true">
      <div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/>
      <div className="art-star art-star-top">✳</div><div className="art-star art-star-bottom">✦</div>
      <span className="art-node art-node-one"/><span className="art-node art-node-two"/>
      <div className="art-paper back-paper"><FileText size={32}/><span>PDF</span><i/><i/><i/></div>
      <div className="art-paper front-paper">
        <div className="art-kicker"><span><Zap size={11} fill="currentColor"/></span> PRACTICE SET <span className="art-kicker-dots">•••</span></div>
        <div className="art-question">Question 01</div>
        <div className="art-line long"/><div className="art-line mid"/>
        <div className="art-choice"><span/><i/></div>
        <div className="art-choice chosen"><span><Check size={9}/></span><i/></div>
        <div className="art-choice"><span/><i/></div>
      </div>
      <span className="art-tick"><Check size={22} strokeWidth={2.5}/></span>
    </div>
  </section>;
}

function PaperTable({ papers, onPractice, onPdf, onDelete, onMatchKey, attemptMap }) {
  return <div className={'paper-table' + (onDelete ? ' library-table' : '')}>
    <div className="table-heading"><span>Paper</span><span>Subject</span><span>Questions</span><span>Action</span></div>
    {papers.map((paper) => <div className="paper-row" key={paper.id}>
      <div className="paper-info"><SubjectIcon subject={paper.subject}/><div><strong>{paper.title}</strong><small>{paper.sample ? 'Sample set' : paper.filename}</small></div></div>
      <span className="paper-subject">{paper.subject}</span>
      <span className="paper-count">{paper.count ?? paper.questions.length} <span>questions</span></span>
      <div className="paper-actions">
        {paper.filename && <button className="icon-button pdf-link" title="Open source PDF" aria-label={'Open source PDF for ' + paper.title} onClick={() => onPdf(paper)}><FileText size={17}/></button>}
        {onMatchKey && !paper.sample && <button className="icon-button paper-key" title="Match answer key" aria-label={'Match answer key for ' + paper.title} onClick={() => onMatchKey(paper)}><ClipboardCheck size={17}/></button>}
        <button className="button practice-button" onClick={() => onPractice(paper)}>{attemptMap.has(paper.id) ? 'Practice again' : 'Practice'}<ChevronRight size={16}/></button>
        {onDelete && !paper.sample && <button className="icon-button paper-delete" title="Delete paper" aria-label={'Delete ' + paper.title} onClick={() => onDelete(paper)}><Trash2 size={17}/></button>}
      </div>
    </div>)}
  </div>;
}

function DeletePaperDialog({ paper, onCancel, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/papers/' + paper.id, { method: 'DELETE' });
      await removeLocalPdf(paper.id).catch(() => {});
      Object.keys(filters).forEach((filter) => localStorage.removeItem(draftKey(paper.id, filter)));
      onDeleted(paper);
    } catch (issue) {
      setError(issue.message);
      setBusy(false);
    }
  }
  return <Modal title="Delete paper?" onClose={busy ? undefined : onCancel}>
    <p className="modal-lead"><strong>{paper.title}</strong> and its attempts will be removed from your library, My progress, and Improvement.</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="modal-actions">
      <button className="button outline" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="button danger" disabled={busy} onClick={remove}>{busy ? <LoaderCircle className="spin" size={17}/> : <Trash2 size={17}/>} Delete paper</button>
    </div>
  </Modal>;
}

function Empty({ icon: Icon, title, children }) {
  return <div className="empty"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3>{children}</div>;
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [library, setLibrary] = useState({ papers: [], attempts: [] });
  const [connectionError, setConnectionError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [imported, setImported] = useState(null);
  const [setup, setSetup] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [loaded, setLoaded] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [pdf, setPdf] = useState(null);
  const [removePaper, setRemovePaper] = useState(null);
  const [keyPaper, setKeyPaper] = useState(null);
  const [resultRevision, setResultRevision] = useState(0);

  useEffect(() => {
    const handleHash = () => {
      setRoute(getRoute());
      setMobileOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLibrary(await api('/library'));
      setConnectionError('');
    } catch (error) { setConnectionError(error.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const [page, id, mode] = route.split('/');
  const inPractice = page === 'practice' || page === 'result';
  useEffect(() => {
    if (!['practice', 'result'].includes(page)) return;
    let canceled = false;
    setLoadError('');
    const request = page === 'result' ? api('/attempts/' + encodeURIComponent(id ?? '')) :
      (sampleIndex.has(id) ? Promise.resolve(sampleIndex.get(id)) : api('/papers/' + encodeURIComponent(id ?? '')));
    request.then((data) => { if (!canceled) setLoaded({ route, data }); }).catch((error) => {
      if (!canceled) setLoadError(error.message);
    });
    return () => { canceled = true; };
  }, [page, id, route, resultRevision]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const allPapers = useMemo(() => [...library.papers, ...samplePapers], [library.papers]);
  const subjects = [...new Set(allPapers.map((paper) => paper.subject))];
  const attemptMap = new Map(library.attempts.map((attempt) => [attempt.paperId, attempt]));
  const listed = allPapers.filter((paper) => (!subjectFilter || paper.subject === subjectFilter) &&
    [paper.title, paper.subject, paper.filename ?? ''].some((text) => text.toLowerCase().includes(search.trim().toLowerCase())));
  const title = shortcuts.find(([key]) => key === page)?.[1] ?? 'Dashboard';

  function openPractice(paper) {
    setSetup({ paper, loading: !paper.questions });
    setFilter('all');
    if (!paper.questions) api('/papers/' + paper.id).then((details) => {
      setSetup((current) => current?.paper.id === paper.id ? { paper: details, loading: false } : current);
    }).catch((error) => {
      setSetup((current) => current?.paper.id === paper.id ? { paper, error: error.message } : current);
    });
  }

  async function openPdf(paper) {
    setPdf({ id: paper.id, title: paper.title || paper.filename, hasServerPdf: paper.hasServerPdf });
    try {
      const local = await getLocalPdf(paper.id).catch(() => null);
      if (!local && paper.hasServerPdf === false) throw new Error('The original PDF is available in the browser where it was imported or moved.');
      const blob = local ?? await api('/papers/' + paper.id + '/pdf', { blob: true });
      const url = URL.createObjectURL(blob);
      setPdf((current) => {
        if (current?.id !== paper.id) { URL.revokeObjectURL(url); return current; }
        return { ...current, url, blob, local: Boolean(local) };
      });
    } catch (error) {
      setPdf((current) => current?.id === paper.id ? { ...current, error: error.message } : current);
    }
  }

  async function movePdf(paper) {
    setPdf((current) => ({ ...current, moving: true, moveError: '' }));
    try {
      await saveLocalPdf(paper.id, paper.blob);
      const local = await getLocalPdf(paper.id);
      if (!local || local.size !== paper.blob.size) throw new Error('The browser copy could not be verified. The database copy was kept.');
      await api('/papers/' + paper.id + '/pdf', { method: 'DELETE', body: { sha256: await pdfDigest(local) } });
      setPdf((current) => ({ ...current, moving: false, confirmMove: false, hasServerPdf: false, local: true }));
      setNotice('PDF moved to this browser.');
      refresh();
    } catch (issue) {
      setPdf((current) => ({ ...current, moving: false, moveError: issue.message }));
    }
  }

  async function openPdfText(paper) {
    setPdf((current) => ({ ...current, showText: true, textError: '' }));
    if (paper.text !== undefined) return;
    try {
      const { text } = await api('/papers/' + paper.id + '/text');
      setPdf((current) => current?.id === paper.id ? { ...current, text } : current);
    } catch (issue) {
      setPdf((current) => current?.id === paper.id ? { ...current, textError: issue.message } : current);
    }
  }

  function openLibrary(subject = '') {
    setSubjectFilter(subject);
    setSearch('');
    go('library');
  }

  const onSubmitted = (attemptId) => { refresh(); go('result/' + attemptId); };
  const activeQuestions = setup?.paper.questions?.filter((question) => filter === 'all' || question.type === filter) || [];

  return <>
    {page === 'home' ? <Landing onSample={() => openPractice(samplePapers[0])} onUpload={() => setUploadOpen(true)}/> :
    <div className={'app-shell' + (inPractice ? ' practice-shell' : '')}>
      {!inPractice && <>
        {mobileOpen && <button className="nav-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation"/>}
        <aside className={'sidebar' + (mobileOpen ? ' open' : '')}>
          <a href="#" className="brand-link" aria-label="PYQ Lab home"><Logo/></a>
          <button className="button primary sidebar-upload" onClick={() => { setMobileOpen(false); setUploadOpen(true); }}><Plus size={19}/> Import paper</button>
          <nav className="nav-group" aria-label="Workspace">
            <p>WORKSPACE</p>
            {shortcuts.map(([key, label, Icon]) => <a key={key} href={'#' + key} aria-current={key === page ? 'page' : undefined} className={key === page ? 'active' : ''} onClick={() => { if (key === 'library') { setSubjectFilter(''); setSearch(''); } setMobileOpen(false); }}><Icon size={19}/>{label}{key === page && <i/>}</a>)}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note"><GraduationCap size={22}/><div><strong>Study at your pace</strong><small>Your papers and progress stay linked to this browser.</small></div></div>
            <span className="sidebar-footer"><span className="status-dot"/> Personal workspace</span>
          </div>
        </aside>
      </>}
      <div className="workspace">
        {!inPractice && <header className="topbar"><div className="breadcrumb">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={22}/></button>
          <span>Workspace</span><ChevronRight size={15}/><strong>{title}</strong>
        </div><div className="topbar-actions"><button className="button top-search" aria-label="Find a paper" onClick={() => { openLibrary(); setTimeout(() => document.getElementById('paper-search')?.focus(), 60); }}><Search size={17}/><span>Find a paper</span></button><span className="avatar" title="Personal workspace"><GraduationCap size={19}/></span></div></header>}
        {inPractice ? (
          <main className="practice-main">
            {loadError ? <Empty icon={CircleHelp} title="Could not open this page"><p>{loadError}</p><button className="button practice-button" onClick={() => go('dashboard')}>Return to dashboard</button></Empty> :
              loaded?.route !== route ? <div role="status" className="loading-page"><LoaderCircle className="spin"/> Loading workspace…</div> :
              page === 'result' ? <Result data={loaded.data.result} paperId={loaded.data.paperId} back={() => go('progress')}
                onMatchKey={loaded.data.paperAvailable && !sampleIndex.has(loaded.data.paperId) ?
                  () => setKeyPaper({ id: loaded.data.paperId, title: loaded.data.result.title }) : undefined}
                retry={loaded.data.paperAvailable ? () => go('practice/' + loaded.data.paperId + '/' + loaded.data.result.filter) : undefined}/> :
              <Exam key={route} paper={loaded.data} filter={Object.hasOwn(filters, mode) ? mode : 'all'} onExit={() => go('library')} onSubmitted={onSubmitted}/>}
          </main>
        ) : <main className="content">
          {connectionError && <div className="banner warning" role="status"><span>{connectionError}</span><button className="button practice-button" onClick={refresh}>Retry connection</button></div>}
          {page === 'dashboard' && <>
            <Hero onUpload={() => setUploadOpen(true)} onSample={() => openPractice(samplePapers[0])}/>
            <section className="stats" aria-label="Workspace totals">
              {[
                [FolderOpen, allPapers.length, 'Practice sets', 'mint'],
                [BookOpen, subjects.length, 'Subjects', 'violet'],
                [CircleHelp, allPapers.reduce((sum, paper) => sum + (paper.count ?? paper.questions.length), 0), 'Questions available', 'peach'],
                [Target, library.attempts.length, 'Attempts completed', 'blue'],
              ].map(([Icon, value, name, color]) => <div className="stat" key={name}><span className={'subject-icon ' + color}><Icon size={20}/></span><div><strong>{value}</strong><p>{name}</p></div></div>)}
            </section>
            <section aria-labelledby="recent-heading">
              <div className="section-head"><div><h2 id="recent-heading">Practice papers</h2><p>Pick up a paper and start practicing.</p></div><button className="button outline" onClick={() => openLibrary()}>View library <ChevronRight size={16}/></button></div>
              <PaperTable papers={allPapers.slice(0, 5)} onPractice={openPractice} onPdf={openPdf} attemptMap={attemptMap}/>
            </section>
          </>}
          {page === 'library' && <>
            <div className="page-head"><div><h1>Paper library</h1><p>Find a practice set or import a previous-year paper.</p></div><button className="button primary" onClick={() => setUploadOpen(true)}><UploadCloud size={18}/>Upload a PDF</button></div>
            <div className="library-controls"><label className="search-input"><Search size={18}/><input id="paper-search" aria-label="Search papers" type="search" placeholder="Search papers…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
              <select aria-label="Filter by subject" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">All subjects</option>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></div>
            {listed.length ? <PaperTable papers={listed} onPractice={openPractice} onPdf={openPdf} onDelete={setRemovePaper} onMatchKey={setKeyPaper} attemptMap={attemptMap}/> :
              <Empty icon={Search} title="No matching papers"><p>Try another search or subject.</p><button className="button outline" onClick={() => { setSubjectFilter(''); setSearch(''); }}>Clear filters</button></Empty>}
          </>}
          {page === 'subjects' && <>
            <div className="page-head"><div><h1>Subjects</h1><p>Browse your papers by subject.</p></div></div>
            <div className="subject-grid">{subjects.map((subject) => {
              const papers = allPapers.filter((paper) => paper.subject === subject);
              return <button key={subject} className="subject-card" onClick={() => openLibrary(subject)}><SubjectIcon subject={subject} size={23}/><span><strong>{subject}</strong><small>{papers.length} {papers.length === 1 ? 'set' : 'sets'} · {papers.reduce((sum, paper) => sum + (paper.count ?? paper.questions.length), 0)} questions</small></span><ChevronRight size={19}/></button>;
            })}</div>
          </>}
          {page === 'progress' && <>
            <div className="page-head"><div><h1>My progress</h1><p>See past scores and revisit marked questions.</p></div></div>
            {library.attempts.length ? <div className="paper-table progress-table">{library.attempts.map((attempt) => (
              <div className="paper-row" key={attempt.id}><div className="paper-info"><SubjectIcon subject={attempt.result.subject}/><div><strong>{attempt.result.title}</strong><small>{date(attempt.createdAt)} · {filters[attempt.result.filter]}</small></div></div>
                <span className="paper-subject">{attempt.result.answered}/{attempt.result.total} answered</span>
                <span className="paper-count">{attempt.result.graded ? attempt.result.correct + '/' + attempt.result.graded + ' correct' : 'Ungraded'}</span>
                <button className="button practice-button" onClick={() => go('result/' + attempt.id)}>View result<ChevronRight size={16}/></button></div>
            ))}</div> : <Empty icon={ClipboardList} title="Your practice history starts here"><p>Complete a practice set to see your results and review flagged questions.</p><button className="button primary" onClick={() => openLibrary()}>Browse papers</button></Empty>}
          </>}
          {page === 'improvement' && <Improvement papers={allPapers}/>}
          {!shortcuts.some(([key]) => key === page) && <Empty icon={CircleHelp} title="Page not found"><button className="button outline" onClick={() => go('dashboard')}>Back to dashboard</button></Empty>}
        </main>}
      </div>
    </div>}
    {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} onImported={(data, file, keyFile) => { setUploadOpen(false); setImported({ data, file, keyFile }); }}/>}
    {imported && <ImportEditor data={imported.data} file={imported.file} keyFile={imported.keyFile} subjects={subjects} onClose={() => {
      removeLocalPdf(imported.data.id).catch(() => {});
      setImported(null);
    }} onSaved={(paper) => { setImported(null); refresh(); openLibrary(); setNotice('Paper added to your library.'); openPractice(paper); }}/>}
    {removePaper && <DeletePaperDialog paper={removePaper} onCancel={() => setRemovePaper(null)} onDeleted={(paper) => {
      setRemovePaper(null);
      setLibrary((current) => ({
        papers: current.papers.filter(({ id }) => id !== paper.id),
        attempts: current.attempts.filter(({ paperId }) => paperId !== paper.id),
      }));
      setNotice('Paper deleted from your library.');
      refresh();
    }}/>}
    {keyPaper && <AnswerKeyDialog paper={keyPaper} onClose={() => setKeyPaper(null)} onSaved={() => {
      setKeyPaper(null);
      setResultRevision((current) => current + 1);
      refresh();
      setNotice('Answer key saved. Results updated.');
    }}/>}
    {setup && <Modal title="Start practice" onClose={() => setSetup(null)}>
      <div className="setup-paper"><SubjectIcon subject={setup.paper.subject}/><div><strong>{setup.paper.title}</strong><small>{setup.paper.subject}</small></div></div>
      {setup.loading ? <p role="status" className="inline-loading"><LoaderCircle className="spin" size={16}/> Loading questions…</p> : setup.error ? <p className="error-text" role="alert">{setup.error}</p> : <>
        <fieldset className="mode-picker"><legend>Question types</legend>
          {Object.entries(filters).map(([key, label]) => {
            const count = setup.paper.questions.filter((question) => key === 'all' || question.type === key).length;
            return <button key={key} type="button" aria-pressed={filter === key} disabled={!count} onClick={() => setFilter(key)}><span>{label}</span><small>{count} questions</small></button>;
          })}
        </fieldset>
        <div className="modal-actions"><button className="button outline" onClick={() => setSetup(null)}>Cancel</button><button className="button primary" disabled={!activeQuestions.length} onClick={() => { go('practice/' + setup.paper.id + '/' + filter); setSetup(null); }}><BookOpenCheck size={18}/>{readDraft(setup.paper.id, filter) ? 'Resume practice' : 'Start practice'}</button></div>
      </>}
    </Modal>}
    {pdf && <Modal className="pdf-modal" title={pdf.title} onClose={pdf.moving ? undefined : () => { if (pdf.url) URL.revokeObjectURL(pdf.url); setPdf(null); }}>
      {pdf.showText ? <>
        <button className="button outline" onClick={() => setPdf((current) => ({ ...current, showText: false }))}>Back to PDF</button>
        {pdf.text !== undefined ? <TextPreview text={pdf.text} filename={pdf.title}/> :
          pdf.textError ? <p className="error-text" role="alert">{pdf.textError}</p> : <p className="inline-loading" role="status">Loading extracted text…</p>}
      </> : pdf.confirmMove ? <>
        <p className="modal-lead">Move this PDF to this browser and remove its Neon copy? Your practice set and scores will stay available. Download a backup to keep the original if you clear this site’s browser data.</p>
        {pdf.moveError && <p className="error-text" role="alert">{pdf.moveError}</p>}
        <div className="modal-actions">
          <button className="button outline" disabled={pdf.moving} onClick={() => setPdf((current) => ({ ...current, confirmMove: false }))}>Cancel</button>
          <button className="button primary" disabled={pdf.moving} onClick={() => movePdf(pdf)}>{pdf.moving ? 'Moving PDF…' : 'Move PDF'}</button>
        </div>
      </> : pdf.url ? <><iframe src={pdf.url} title="Original question paper"/><div className="modal-actions">
        {pdf.hasServerPdf && <button className="button outline" onClick={() => setPdf((current) => ({ ...current, confirmMove: true }))}>Move PDF to this browser</button>}
        <button className="button outline" onClick={() => openPdfText(pdf)}>View extracted text</button>
        <a className="button outline" href={pdf.url} download={pdf.title + '.pdf'}><ArrowDownToLine size={17}/>Download PDF</a></div></> :
        pdf.error ? <><p className="error-text" role="alert">{pdf.error}</p><div className="modal-actions">
          <button className="button outline" onClick={() => openPdfText(pdf)}>View extracted text</button>
        </div></> : <p role="status">Loading PDF…</p>}
    </Modal>}
    {notice && <div className="toast" role="status"><Check size={18}/>{notice}</div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
