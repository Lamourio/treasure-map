import { useCallback, useEffect, useRef, useState } from 'react';
import { formatIndex, indexX, indexY } from '../lib/coords';
import { HoverInfo, MapView } from '../lib/mapView';
import { MARKS, MARK_CODES, PIN_CODES } from '../lib/marks';
import { MARK_ICONS } from '../lib/icons';
import { store, typeIcon } from '../lib/store';
import { NoteInput } from './Finder';
import { BrushBanner, FirstRunHint, Toaster } from './MapOverlays';
import { PinGlyph } from './PinGlyph';
import { useStore } from '../lib/useStore';
import { LEVEL_COLORS, levelName, zoneLevel } from '../lib/zones';

interface Props {
  onReady: (view: MapView | null) => void;
}

export function MapCanvas({ onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const jumpTo = useCallback((i: number) => {
    store.select(i);
    viewRef.current?.goTo(i);
  }, []);

  useEffect(() => {
    const view = new MapView(canvasRef.current!, store, setHover);
    view.attachCard(cardRef.current);
    const cardRo = new ResizeObserver(() => view.requestRender());
    cardRo.observe(cardRef.current!);
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => view.setSize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    view.setSize(wrap.clientWidth, wrap.clientHeight);
    viewRef.current = view;
    onReady(view);
    if (import.meta.env.DEV) (window as unknown as { __mapView: MapView }).__mapView = view;
    return () => {
      ro.disconnect();
      cardRo.disconnect();
      view.destroy();
      onReady(null);
    };
  }, [onReady]);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" />
      <div className="tile-card" ref={cardRef}>
        <TileCard onJump={jumpTo} />
      </div>
      {hover && <Tooltip info={hover} />}
      <BrushBanner />
      <FirstRunHint />
      <Toaster />
    </div>
  );
}

function Tooltip({ info }: { info: HoverInfo }) {
  useStore(); // refresh when the hovered tile changes (e.g. after a click)
  const i = info.index;
  const level = zoneLevel[i];
  const mark = store.marks[i];
  const note = store.notes.get(i);
  const lms = store.landmarksAt(indexX(i), indexY(i));
  const left = Math.min(info.clientX + 14, window.innerWidth - 230);
  const top = Math.min(info.clientY + 16, window.innerHeight - 140);
  if (info.cluster) {
    return (
      <div className="tooltip" style={{ left: Math.max(8, left), top }}>
        <div className="tooltip-coord">{info.cluster.count} marks here</div>
        {PIN_CODES.map(
          (c) =>
            info.cluster!.counts[c] > 0 && (
              <div className="tooltip-row" key={c}>
                <PinGlyph icon={MARK_ICONS[c]} color={MARKS[c].color} />
                {info.cluster!.counts[c]} × {MARKS[c].name}
              </div>
            ),
        )}
        <div className="tooltip-note">Click to zoom in</div>
      </div>
    );
  }
  return (
    <div className="tooltip" style={{ left: Math.max(8, left), top }}>
      <div className="tooltip-coord">{formatIndex(i)}</div>
      <div className="tooltip-row">
        <span className="swatch" style={{ background: LEVEL_COLORS[level] }} />
        {levelName(level)}
      </div>
      {mark > 0 && (
        <div className="tooltip-row">
          <PinGlyph icon={MARK_ICONS[mark]} color={MARKS[mark].color} />
          {MARKS[mark].name}
          {store.isShared(i) && <span className="shared-tag">shared</span>}
        </div>
      )}
      {note && <div className="tooltip-note">{note}</div>}
      {lms.map((l) => (
        <div className="tooltip-row" key={l.id}>
          <PinGlyph icon={typeIcon(store.typeOf(l))} color={store.typeOf(l).color} />
          {l.name}
          {l.level ? ` (Lv ${l.level})` : ''}
        </div>
      ))}
    </div>
  );
}

/** Card shown next to the selected tile: mark it, add a note. Positioned by MapView. */
function TileCard({ onJump }: { onJump: (i: number) => void }) {
  const store = useStore();
  const i = store.selected;
  if (i === null) return null;
  const level = zoneLevel[i];
  const mark = store.marks[i];
  const note = store.notes.get(i) ?? '';
  const lms = store.landmarksAt(indexX(i), indexY(i));
  const shared = store.isShared(i);
  return (
    <>
      <div className="card-head">
        <span className="card-coord">{formatIndex(i)}</span>
        <span className="level-chip" style={{ background: LEVEL_COLORS[level] }}>
          {levelName(level)}
        </span>
        <button className="icon-btn" onClick={() => store.select(null)} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </div>
      <div className="card-marks" role="radiogroup" aria-label="Mark">
        {MARK_CODES.map((c, n) => (
          <button
            key={c}
            className={mark === c ? 'active' : ''}
            style={mark === c ? { background: MARKS[c].color, borderColor: MARKS[c].color, color: MARKS[c].text } : undefined}
            onClick={() => store.setTile(i, c)}
            disabled={shared}
            title={shared ? 'Shared mark - read-only' : `${MARKS[c].name} (key ${n + 1})`}
            aria-pressed={mark === c}
          >
            <PinGlyph icon={MARK_ICONS[c]} color={MARKS[c].color} size={16} />
            {MARKS[c].letter}
          </button>
        ))}
        <button
          onClick={() => store.setTile(i, 0)}
          disabled={shared || !mark}
          title={shared ? 'Shared mark - read-only' : 'Clear mark (key 0 / Delete)'}
          aria-label="Clear mark"
        >
          ✕
        </button>
      </div>
      <div className="card-status">
        <span>
          {mark ? MARKS[mark].name : 'No mark'}
          {shared && <span className="shared-tag" title="Published with the site, the same for everyone. Read-only.">shared · read-only</span>}
        </span>
        {mark > 0 && <SameMarkNav index={i} mark={mark} onJump={onJump} />}
      </div>
      {mark > 0 && <NoteInput key={`${i}:${note}`} initial={note} disabled={shared} onCommit={(t) => store.setNote(i, t)} />}
      {lms.map((l) => (
        <div className="card-landmark" key={l.id}>
          <PinGlyph icon={typeIcon(store.typeOf(l))} color={store.typeOf(l).color} size={16} />
          {l.name}
          {l.level ? ` (Lv ${l.level})` : ''}
        </div>
      ))}
      <div className="card-hint">Keys: {MARK_CODES.map((c, n) => `${n + 1} ${MARKS[c].letter}`).join(' · ')} · 0 clear · arrows move</div>
    </>
  );
}

/** "‹ 3 / 5 ›": step through the tiles that have the same mark (keys N / Shift+N). */
function SameMarkNav({ index, mark, onJump }: { index: number; mark: number; onJump: (i: number) => void }) {
  const list = store.indicesWithMark(mark);
  if (list.length < 2) return null;
  const pos = list.indexOf(index);
  const step = (dir: number) => onJump(list[(pos + dir + list.length) % list.length]);
  return (
    <span className="same-nav">
      <button className="icon-btn" onClick={() => step(-1)} title={`Previous ${MARKS[mark].letter} tile (Shift+N)`} aria-label="Previous">
        ‹
      </button>
      {pos + 1} / {list.length}
      <button className="icon-btn" onClick={() => step(1)} title={`Next ${MARKS[mark].letter} tile (N)`} aria-label="Next">
        ›
      </button>
    </span>
  );
}
