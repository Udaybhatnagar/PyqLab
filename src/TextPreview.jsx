import { useEffect, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { contentLanguage } from './paper-text';

export function TextPreview({ text, filename }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!text) return;
    const download = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    setUrl(download);
    return () => URL.revokeObjectURL(download);
  }, [text]);
  if (!text) return <p className="modal-lead">No readable text was extracted from this PDF.</p>;

  return <div className="extracted-text-view">
    <textarea className="extracted-text" aria-label="Extracted PDF text" lang={contentLanguage(text)} dir="auto" value={text} readOnly/>
    <div className="modal-actions">
      <a className="button outline" href={url || undefined} download={filename.replace(/\.pdf$/i, '') + '.txt'}><ArrowDownToLine size={17}/> Download text</a>
    </div>
  </div>;
}
