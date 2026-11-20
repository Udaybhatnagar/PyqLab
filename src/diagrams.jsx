import { useEffect, useRef, useState } from 'react';
import { Crop, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';

function imagePath(paperId, page, crop) {
  const path = '/papers/' + paperId + '/pages/' + page;
  if (!crop) return path;
  const { left, top, right, bottom } = crop;
  return path + '?' + new URLSearchParams({ left, top, right, bottom });
}

function usePageImage(path) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    let current = true;
    let url;
    setImage(null);
    api(path, { blob: true }).then((blob) => {
      if (!current) return;
      url = URL.createObjectURL(blob);
      setImage({ path, url });
    }).catch((error) => { if (current) setImage({ path, error: error.message }); });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return image?.path === path ? image : null;
}

function Figure({ paperId, crop, label }) {
  const image = usePageImage(imagePath(paperId, crop.page, crop));
  if (!image) return <small className="figure-message">Loading diagram…</small>;
  if (image.error) return <small className="figure-message">Diagram unavailable</small>;
  return <img className="paper-figure" src={image.url} alt={label} draggable={false}/>;
}

export function Figures({ paperId, crops, label }) {
  if (!crops?.length) return null;
  return <span className="paper-figures">{crops.map((crop, i) => (
    <Figure paperId={paperId} key={i} crop={crop} label={label + (crops.length > 1 ? ' ' + (i + 1) : '')}/>
  ))}</span>;
}

export function FigureEditor({ paperId, crops = [], label, onAdd, onRemove }) {
  return <div className="figure-editor">
    {crops.map((crop, index) => <div className="figure-editor-preview" key={index}>
      <Figure paperId={paperId} crop={crop} label={label}/>
      <button type="button" className="icon-button remove" title="Remove diagram" aria-label={'Remove ' + label.toLowerCase() + ' ' + (index + 1)} onClick={() => onRemove(index)}><Trash2 size={16}/></button>
    </div>)}
    <button type="button" className="button text-button" aria-label={'Add ' + label.toLowerCase()} disabled={crops.length >= 4} onClick={onAdd}><ImagePlus size={17}/> Add diagram</button>
  </div>;
}

function rectangle(start, end) {
  return {
    left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y),
  };
}

export function DiagramPicker({ paperId, initialPage, pages, onPick, onClose }) {
  const [page, setPage] = useState(initialPage);
  const [box, setBox] = useState(null);
  const start = useRef(null);
  const image = usePageImage(imagePath(paperId, page));

  function point(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const normalize = (fraction) => Math.round(Math.max(0, Math.min(1, fraction)) * 10000);
    return { x: normalize((event.clientX - bounds.left) / bounds.width), y: normalize((event.clientY - bounds.top) / bounds.height) };
  }

  const selected = box && box.right - box.left >= 20 && box.bottom - box.top >= 20;
  return <Modal title="Crop a diagram from the PDF" onClose={onClose} className="crop-modal">
    <div className="crop-toolbar"><p className="modal-lead">Drag a box around the figure or enter its boundaries as percentages below.</p>
      <label>Page <select aria-label="Source page" value={page} onChange={(event) => { setPage(Number(event.target.value)); setBox(null); }}>
        {Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </select></label>
    </div>
    {image?.url ? <>
      <div className="crop-surface"
        onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); setBox(null); }}
        onPointerMove={(event) => { if (start.current) setBox(rectangle(start.current, point(event))); }}
        onPointerUp={(event) => { if (start.current) setBox(rectangle(start.current, point(event))); start.current = null; }}
        onPointerCancel={() => { start.current = null; }}>
        <img src={image.url} alt={'Page ' + page + ' of the source PDF'} draggable={false}/>
        {selected && <span className="crop-selection" style={{
          left: box.left / 100 + '%', top: box.top / 100 + '%',
          width: (box.right - box.left) / 100 + '%', height: (box.bottom - box.top) / 100 + '%',
        }}/>}
      </div>
      <div className="crop-boundaries">
        {['left', 'top', 'right', 'bottom'].map((edge) => <label key={edge}>{edge} (%)
          <input type="number" min="0" max="100" step=".01" value={box ? box[edge] / 100 : ''}
            onChange={(event) => {
              const value = Math.max(0, Math.min(10000, Math.round(Number(event.target.value) * 100)));
              setBox({ left: 0, top: 0, right: 0, bottom: 0, ...box, [edge]: value });
            }}/>
        </label>)}
      </div>
    </> : image?.error ? <p role="alert" className="error-text">{image.error}</p> : <p className="inline-loading" role="status"><LoaderCircle className="spin" size={16}/> Loading PDF page…</p>}
    <div className="modal-actions">
      <button className="button outline" type="button" onClick={onClose}>Cancel</button>
      <button className="button primary" type="button" disabled={!selected || !image?.url} onClick={() => onPick({ page, ...box })}><Crop size={17}/> Use diagram</button>
    </div>
  </Modal>;
}
