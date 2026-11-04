import { useMemo, useState } from 'react';
import { chebyshev, formatIndex, parseCoordList, toIndex } from '../../lib/coords';
import { copyText } from '../../lib/clipboard';
import { MARK_ICONS } from '../../lib/icons';
import { MapView } from '../../lib/mapView';
import { MARKS, MARK_CODES, MARK_S } from '../../lib/marks';
import { useStore } from '../../lib/useStore';
import { LEVELS, LEVEL_COLORS, zoneLevel } from '../../lib/zones';
import { PinGlyph } from '../PinGlyph';
import { StatsTable } from '../Stats';
import { Group } from './Group';

const PAGE = 200;

export function MarksTab({ view }: { view: MapView | null }) {
  return (
    <>
      <MarkBrowser view={view} />
      <Group title="Paste coordinates" collapsibleId="paste" defaultOpen={false}>
        <PasteCoords />
      </Group>
      <Group title="Progress by zone" collapsibleId="zone-stats" defaultOpen={false}>
        <StatsTable />
      </Group>
    </>
  );
}

/** Lists marked tiles of one code with zone filter, note search and sorting. */
function MarkBrowser({ view }: { view: MapView | null }) {
  const store = useStore();
  const [code, setCode] = useState<number>(1);
  const [level, setLevel] = useState(0); // 0 = all zones
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'pos' | 'near'>('pos');
  const [limit, setLimit] = useState(PAGE);
  const sel = store.selected;
  const version = store.version;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = store.indicesWithMark(code);
    if (level) list = list.filter((i) => zoneLevel[i] === level);
    if (q) list = list.filter((i) => store.notes.get(i)?.toLowerCase().includes(q));
    if (sort === 'near' && sel !== null) list = [...list].sort((a, b) => chebyshev(a, sel) - chebyshev(b, sel));
    return list;
  }, [store, code, level, query, sort, sel, version]);

  const jump = (i: number) => {
    store.select(i);
    view?.goTo(i);
  };

  return (
    <Group
      title="Marked tiles"
      actions={
        <button
          className="small-btn"
          disabled={!items.length}
          onClick={() => copyText(items.map(formatIndex).join(', '), `${items.length} coordinates`)}
          title="Copy these coordinates, e.g. to paste in the game chat"
        >
          Copy list
        </button>
      }
    >
      <div className="code-tabs" role="tablist" aria-label="Mark code">
        {MARK_CODES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={code === c}
            className={code === c ? 'active' : ''}
            onClick={() => {
              setCode(c);
              setLimit(PAGE);
            }}
            title={MARKS[c].name}
            aria-label={`${MARKS[c].name}: ${store.markCounts[c]}`}
          >
            <PinGlyph icon={MARK_ICONS[c]} color={MARKS[c].color} size={18} />
            <span className="code-count">{store.markCounts[c]}</span>
          </button>
        ))}
      </div>
      <div className="browser-filters">
        <input type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Zone filter">
          <option value={0}>All zones</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 6 ? 'Throne' : `Level ${l}`}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'pos' | 'near')} aria-label="Sort">
          <option value="pos">By position</option>
          <option value="near" disabled={sel === null}>
            Nearest to selected
          </option>
        </select>
      </div>
      <div className="muted small browser-count">
        {items.length} {MARKS[code].name.toLowerCase()} tile{items.length === 1 ? '' : 's'}
        {sort === 'near' && sel !== null && ` · from ${formatIndex(sel)}`}
      </div>
      {items.length > 0 && (
        <ul className="tile-rows">
          {items.slice(0, limit).map((i) => {
            const note = store.notes.get(i);
            const lvl = zoneLevel[i];
            return (
              <li key={i}>
                <button className={`tile-row ${sel === i ? 'active' : ''}`} onClick={() => jump(i)}>
                  <span className="tile-row-coord">{formatIndex(i)}</span>
                  <span className="lvl-dot" style={{ background: LEVEL_COLORS[lvl] }} title={lvl === 6 ? 'Throne' : `Level ${lvl}`}>
                    {lvl === 6 ? 'K' : lvl}
                  </span>
                  <span className="tile-row-note">{note}</span>
                  {sel !== null && sel !== i && <span className="tile-row-dist">{chebyshev(i, sel)}t</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > limit && (
        <button className="wide small-btn" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, items.length - limit)} more
        </button>
      )}
    </Group>
  );
}

/** Marks every coordinate found in pasted text with one code (one undo step). */
function PasteCoords() {
  const store = useStore();
  const [text, setText] = useState('');
  const [code, setCode] = useState<number>(MARK_S);
  const parsed = useMemo(() => parseCoordList(text), [text]);
  const apply = () => {
    store.markMany(
      parsed.valid.map((p) => toIndex(p.x, p.y)),
      code,
    );
    setText('');
  };
  return (
    <div className="paste-coords">
      <textarea
        rows={3}
        placeholder={'e.g. 123:456, 130:470\nor one "123 456" per line'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Coordinates to mark"
      />
      <div className="muted small">
        {parsed.valid.length} valid
        {parsed.invalid.length > 0 && (
          <span className="error-text">
            {' '}
            · {parsed.invalid.length} outside the map ({parsed.invalid.slice(0, 3).join(', ')}
            {parsed.invalid.length > 3 ? '…' : ''})
          </span>
        )}
      </div>
      <div className="row">
        <select value={code} onChange={(e) => setCode(Number(e.target.value))} aria-label="Mark as">
          {MARK_CODES.map((c) => (
            <option key={c} value={c}>
              Mark as {MARKS[c].letter} · {MARKS[c].name}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!parsed.valid.length} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
