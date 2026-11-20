import { useRef, useState } from 'react';
import { BookOpen, Check, ClipboardCheck, FileText, GraduationCap, LayoutGrid, Target, UploadCloud, Zap } from 'lucide-react';
import { letter } from './api';
import { samplePapers } from './demo';
import './landing.css';

export function Logo() {
  return <div className="logo"><span className="logo-mark"><Zap size={21} fill="currentColor" /></span><span>PYQ<span className="logo-light">Lab</span><small>PRACTICE WORKSPACE</small></span></div>;
}

function PracticePreview() {
  const [selected, setSelected] = useState(null);
  const question = samplePapers[1].questions[0];
  const correct = question.correct.includes(selected);
  return <div className="landing-demo">
    <div className="landing-demo-top"><span><span className="landing-demo-mark"><Zap size={15} fill="currentColor"/></span> Try a question</span><span className="type-chip mcq">MCQ</span></div>
    <h2>{question.prompt}</h2>
    <div className="landing-demo-options" role="radiogroup" aria-label="Sample answer options">
      {question.options.map((option, index) => <label key={option} className={'landing-demo-option' + (selected === index ? ' chosen' : '')}>
        <input className="sr-only" type="radio" name="sample-answer" checked={selected === index} onChange={() => setSelected(index)}/>
        <span className="option-letter mcq">{letter(index)}</span>{option}{selected === index && <Check size={16} aria-hidden="true"/>}
      </label>)}
    </div>
    <p className={'landing-demo-feedback' + (correct ? ' correct' : '')} role="status">
      {selected === null ? 'Choose one answer to try it out.' : correct ? 'Correct. The derivative is 3x² + 2, which equals 5 at x = 1.' : 'Try again. Differentiate each term before substituting x = 1.'}
    </p>
  </div>;
}

export function Landing({ onSample, onUpload }) {
  const steps = useRef(null);
  const features = [
    [FileText, 'mint', 'Import past papers', 'Extract questions, answer choices, and diagrams from a PDF.',
      <button className="button text-button" onClick={onUpload}>Import a paper</button>],
    [ClipboardCheck, 'violet', 'Score with an answer key', 'Attach a PDF or JPG key and confirm the matched answers before practice.', null],
    [BookOpen, 'peach', 'Practice in exam mode', 'Answer MCQs and MSQs and pause when you need a break.',
      <button className="button text-button" onClick={onSample}>Open a sample</button>],
    [Target, 'blue', 'Plan your revision', 'Find important questions and topics to revisit, grouped by paper.',
      <a className="button text-button" href="#improvement">View Improvement</a>],
  ];
  return <div className="landing">
    <div className="landing-dark">
      <header className="landing-header landing-inner">
        <a href="#" aria-label="PYQ Lab home"><Logo/></a>
        <nav aria-label="Main navigation">
          <button className="landing-nav-link" onClick={() => { steps.current.focus({ preventScroll: true }); steps.current.scrollIntoView(); }}>How it works</button>
          <a className="button landing-workspace-link" href="#dashboard"><LayoutGrid size={17}/>Dashboard</a>
        </nav>
      </header>
      <main>
        <section className="landing-hero landing-inner" aria-labelledby="landing-heading">
          <div className="landing-copy">
            <h1 id="landing-heading">Turn past papers into <em>real practice.</em></h1>
            <p>Upload a previous-year paper and its answer key. Practice at your pace, get a score, and see what needs revision.</p>
            <div className="landing-actions">
              <button className="button primary" onClick={onUpload}><UploadCloud size={18}/>Upload a paper</button>
              <button className="button hero-secondary" onClick={onSample}><BookOpen size={18}/>Try a sample set</button>
            </div>
            <p className="landing-signup"><GraduationCap size={17}/> No signup required</p>
          </div>
          <div className="landing-demo-wrap"><PracticePreview/></div>
        </section>
      </main>
    </div>
    <section className="landing-steps landing-inner" tabIndex={-1} ref={steps} aria-labelledby="landing-steps-heading">
      <div className="landing-steps-heading">
        <h2 id="landing-steps-heading">From PDF to practice</h2>
      </div>
      <div className="landing-step-grid">{features.map(([Icon, color, title, description, action]) => (
        <article className="landing-step" key={title}>
          <span className={'subject-icon ' + color}><Icon size={21}/></span>
          <h3>{title}</h3><p>{description}</p>{action}
        </article>
      ))}</div>
    </section>
    <footer className="landing-footer">
      <div className="landing-inner">
        <a href="#" aria-label="PYQ Lab home"><Logo/></a>
        <nav aria-label="Footer navigation">
          <a href="#dashboard">Dashboard</a>
          <a href="#library">Paper library</a>
          <a href="#improvement">Improvement</a>
        </nav>
      </div>
    </footer>
  </div>;
}
