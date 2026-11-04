import { useEffect, useState } from 'react';
import {
  MAX_X,
  MAX_Y,
  MIN_X,
  MIN_Y,
  coordError,
  formatIndex,
  indexX,
  indexY,
  parseCoordPair,
  signed,
  toIndex,
} from '../lib/coords';
import { copyText } from '../lib/clipboard';
import { MapView } from '../lib/mapView';
import { MARKS, MARK_CODES } from '../lib/marks';
import { NOTE_MAX, typeIcon } from '../lib/store';
import { PinGlyph } from './PinGlyph';
import { useStore } from '../lib/useStore';
import { LEVEL_COLORS, levelName, zoneLevel } from '../lib/zones';

export function Finder({ view }: { view: MapView | null }) {
  const store = useStore();
  const sel = store.selected;
  const [xText, setXText] = useState('');
  const [yText, setYText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // follow selections made on the map or from lists
  useEffect(() => {
    if (sel === null) return;
    setXText(String(indexX(sel)));
    setYText(String(indexY(sel)));
    setError(null);
  }, [sel]);

  const onInput = (axis: 'x' | 'y', value: string) => {
    setError(null);
    const pair = /\d\s*[:;,/\s]\s*\d/.test(value) ? parseCoordPair(value) : null;
    if (pair) {
      setXText(String(pair.x));
      setYText(String(pair.y));
    } else if (axis === 'x') setXText(value.replace(/[^\d]/g, ''));
    else setYText(value.replace(/[^\d]/g, ''));
  };

  const go = () => {
    const x = Number(xText);
    const y = Number(yText);
    const err = xText === '' || yText === '' ? 'Enter both X and Y' : coordError(x, y);
    if (err) return setError(err);
    const i = toIndex(x, y);
    store.select(i);
    view?.goTo(i);
  };

  return (
    <div className="finder">
      <form
        className="finder-form"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label>
          <span>X</span>
          <input
            inputMode="numeric"
            placeholder={`${MIN_X}–${MAX_X}`}
            value={xText}
            onChange={(e) => onInput('x', e.target.value)}
            aria-label="X coordinate"
          />
        </label>
        <label>
          <span>Y</span>
          <input
            inputMode="numeric"
            placeholder={`${MIN_Y}–${MAX_Y}`}
            value={yText}
            onChange={(e) => onInput('y', e.target.value)}
            aria-label="Y coordinate"
          />
        </label>
        <button type="submit" className="primary">
          Go
        </button>
      </form>
      <div className="hint">Tip: paste “123:456” into either box.</div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function TileDetails({ index, view }: { index: number; view: MapView | null }) {
  const store = useStore();
  const x = indexX(index);
  const y = indexY(index);
  const level = zoneLevel[index];
  const mark = store.marks[index];
  const note = store.notes.get(index) ?? '';
  const nearest = store.nearestLandmark(x, y);

  return (
    <div className="tile-details">
      <div className="tile-head">
        <button className="link coord-big" onClick={() => view?.goTo(index)} title="Centre on this tile">
          {formatIndex(index)}
        </button>
        <span className="level-chip" style={{ background: LEVEL_COLORS[level] }}>
          {levelName(level)}
        </span>
        <button className="small-btn" onClick={() => copyText(formatIndex(index), formatIndex(index))} title="Copy X:Y">
          Copy
        </button>
        <button className="icon-btn" onClick={() => store.select(null)} title="Clear selection" aria-label="Clear selection">
          ×
        </button>
      </div>

      <div className="mark-picker" role="radiogroup" aria-label="Mark">
        <button className={mark === 0 ? 'active' : ''} onClick={() => store.setTile(index, 0)}>
          None
        </button>
        {MARK_CODES.map((c) => (
          <button
            key={c}
            className={mark === c ? 'active' : ''}
            style={mark === c ? { background: MARKS[c].color, color: MARKS[c].text, borderColor: MARKS[c].color } : undefined}
            onClick={() => store.setTile(index, c)}
            title={MARKS[c].name}
          >
            {MARKS[c].letter}
          </button>
        ))}
      </div>
      <div className="muted small">{mark ? MARKS[mark].name : 'No mark'}</div>

      <NoteInput key={`${index}:${note}:${mark > 0}`} initial={note} disabled={!mark} onCommit={(t) => store.setNote(index, t)} />

      <dl className="facts">
        <dt>Nearest landmark</dt>
        <dd>
          {nearest ? (
            <>
              <PinGlyph icon={typeIcon(store.typeOf(nearest.landmark))} color={store.typeOf(nearest.landmark).color} size={16} />{" "}
              {nearest.landmark.name}
              {nearest.landmark.level ? ` (Lv ${nearest.landmark.level})` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
        {nearest && (
          <>
            <dt>Distance</dt>
            <dd>{nearest.distance} tiles</dd>
            <dt>Offset</dt>
            <dd>
              X {signed(x - nearest.landmark.x)} / Y {signed(y - nearest.landmark.y)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function NoteInput({ initial, disabled, onCommit }: { initial: string; disabled: boolean; onCommit: (t: string) => void }) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial) onCommit(text);
  };
  return (
    <input
      className="note-input"
      placeholder={disabled ? 'Mark the tile to add a note' : 'Note (Enter to save)'}
      maxLength={NOTE_MAX}
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(initial);
      }}
      aria-label="Note"
    />
  );
}
