import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={'modal ' + className}
    onCancel={(event) => { event.preventDefault(); onClose?.(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div className="modal-content">
      <header><h2 id={titleId}>{title}</h2>{onClose && <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>}</header>
      {children}
    </div>
  </dialog>;
}
