import { useEffect, useState } from 'react';
import { MARK_ICONS } from '../lib/icons';
import { MARKS, MARK_CODES } from '../lib/marks';
import { useStore } from '../lib/useStore';
import { Icon } from './Icon';
import { PinGlyph } from './PinGlyph';

const TOAST_MS = 4000;
const HINT_KEY = 'treasure-map:hint-dismissed';

/** Bottom toast for the last change, with Undo / Redo. */
export function Toaster() {
  const store = useStore();
  const notice = store.notice;
  const [hiddenId, setHiddenId] = useState(0);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setHiddenId(notice.id), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!notice || hiddenId === notice.id) return null;
  return (
    <div className="toast" role="status" key={notice.id}>
      <span className="toast-text">{notice.text}</span>
      {notice.action && (
        <button className="toast-action" onClick={() => (notice.action === 'undo' ? store.undo() : store.redo())}>
          {notice.action === 'undo' ? 'Undo' : 'Redo'}
        </button>
      )}
      <button className="icon-btn" onClick={() => setHiddenId(notice.id)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

const BRUSH_SIZES = [
  { r: 0, label: '1' },
  { r: 1, label: '3' },
  { r: 2, label: '5' },
  { r: 4, label: '9' },
];

/** Shows the active brush and its options (size, shape, what the eraser removes), with a way out. */
export function BrushBanner() {
  const store = useStore();
  const { tool, brushSize, brushShape, eraseCodes } = store.settings;
  if (tool === 'select') return null;
  const eraser = tool === 0;
  const allCodes = MARK_CODES.every((c) => eraseCodes[c]);
  const toggleCode = (c: number) => {
    const next = [...eraseCodes];
    next[c] = !next[c];
    if (MARK_CODES.some((m) => next[m])) store.setSettings({ eraseCodes: next }); // keep at least one
  };
  // from "All", picking a code narrows the eraser to just that code
  const eraseOnly = (c: number) => store.setSettings({ eraseCodes: [0, 1, 2, 3, 4].map((m) => m === c) });
  const hint =
    brushShape === 'box'
      ? `Drag a box to ${eraser ? 'erase' : 'paint'} an area`
      : `Click or drag to ${eraser ? 'erase' : 'paint'}${eraser ? '' : ' · right-drag erases'}`;

  return (
    <div className="brush-banner" role="toolbar" aria-label="Brush options">
      <div className="bb-row">
        {eraser ? (
          <span className="bb-title">
            <Icon name="eraser" size={16} /> Eraser
          </span>
        ) : (
          <span className="bb-title">
            <PinGlyph icon={MARK_ICONS[tool]} color={MARKS[tool].color} size={18} />
            Paint <b>{MARKS[tool].letter}</b>
          </span>
        )}
        <div className="bb-seg" role="radiogroup" aria-label="Shape">
          <button className={brushShape === 'brush' ? 'active' : ''} onClick={() => store.setSettings({ brushShape: 'brush' })} title="Freehand brush">
            Brush
          </button>
          <button className={brushShape === 'box' ? 'active' : ''} onClick={() => store.setSettings({ brushShape: 'box' })} title="Drag a rectangle">
            Box
          </button>
        </div>
        {brushShape === 'brush' && (
          <div className="bb-seg" role="radiogroup" aria-label="Brush size">
            {BRUSH_SIZES.map((s) => (
              <button
                key={s.r}
                className={brushSize === s.r ? 'active' : ''}
                onClick={() => store.setSettings({ brushSize: s.r })}
                title={`${s.label}×${s.label} tiles`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <button className="primary bb-done" onClick={() => store.setSettings({ tool: 'select' })} title="Back to Select (Esc)">
          Done
        </button>
      </div>
      {eraser && (
        <div className="bb-row">
          <span className="muted small">Erase</span>
          <div className="bb-seg" aria-label="Codes to erase">
            <button
              className={allCodes ? 'active' : ''}
              onClick={() => store.setSettings({ eraseCodes: [true, true, true, true, true] })}
              title="Erase every mark"
            >
              All
            </button>
            {MARK_CODES.map((c) => (
              <button
                key={c}
                className={!allCodes && eraseCodes[c] ? 'active' : ''}
                onClick={() => (allCodes ? eraseOnly(c) : toggleCode(c))}
                title={`Erase ${MARKS[c].name} marks`}
                aria-pressed={!allCodes && eraseCodes[c]}
              >
                <PinGlyph icon={MARK_ICONS[c]} color={MARKS[c].color} size={14} />
                {MARKS[c].letter}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="bb-hint muted small">{hint}</div>
    </div>
  );
}

/** One-time "how it works" card. */
export function FirstRunHint() {
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* per-viewer convenience only */
    }
  };
  return (
    <div className="first-hint" role="dialog" aria-label="Getting started">
      <b>Getting started</b>
      <ul>
        <li>Click or tap a tile to select it, then mark it from the card (or keys 1–3).</li>
        <li>Drag to move. Wheel, pinch or double-click to zoom.</li>
        <li>To mark many tiles at once, pick a brush (T D S) in the toolbar.</li>
        <li>Type “123:456” in the Go box to jump to a tile.</li>
      </ul>
      <button className="primary" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
