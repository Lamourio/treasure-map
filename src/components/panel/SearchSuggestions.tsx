import { formatIndex } from '../../lib/coords';
import { MapView } from '../../lib/mapView';
import { MARKS } from '../../lib/marks';
import { DUG_CODE, EMPTY_AREA_CODE, FIND_CODES, KEEP_AWAY, getSuggestions } from '../../lib/suggest';
import { useStore } from '../../lib/useStore';
import { LEVELS, LEVEL_COLORS, areaLabels, levelName, zoneLevel } from '../../lib/zones';

/** "2 T · 1 C", or "no marks" for an untouched area. */
function foundText(found: Record<number, number>): string {
  const parts = [...FIND_CODES, DUG_CODE, EMPTY_AREA_CODE].filter((c) => found[c]).map((c) => `${found[c]} ${MARKS[c].letter}`);
  return parts.length ? parts.join(' · ') : 'no marks';
}

function pct(x: number): string {
  return x >= 0.995 ? '100%' : x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`;
}

/** The best 39×39 searches for the next drop, in order (see lib/suggest.ts). */
export function SearchSuggestions({ view }: { view: MapView | null }) {
  const store = useStore();
  const { suggestLevel, showSuggestions } = store.settings;
  const { list } = getSuggestions(store.marks, store.marked, store.marksRevision, suggestLevel);

  const jump = (i: number) => {
    store.select(i);
    view?.goTo(i, 4);
  };

  return (
    <div className="suggest">
      <div className="suggest-controls">
        <label>
          Level{' '}
          <select value={suggestLevel} onChange={(e) => store.setSettings({ suggestLevel: Number(e.target.value) })}>
            <option value={0}>Any</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelName(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showSuggestions} onChange={(e) => store.setSettings({ showSuggestions: e.target.checked })} />
          Show on map
        </label>
      </div>
      {list.length ? (
        <ol className="suggest-list">
          {list.map((s, n) => (
            <li key={s.i}>
              <button className="tile-row" onClick={() => jump(s.i)} title="Jump there; mark the centre X if the search finds nothing">
                <span className="suggest-rank">{n + 1}</span>
                <span className="swatch" style={{ background: LEVEL_COLORS[zoneLevel[s.i]] }} />
                <span className="suggest-text">
                  <b>{formatIndex(s.i)}</b>
                  <span className="suggest-chance" title="Share of the chance this 39×39 search covers">
                    {pct(s.covers)}
                  </span>
                  {!s.inside && (
                    <span className="small error-text" title="No 39×39 search fits inside the level here">
                      {' '}
                      spills over
                    </span>
                  )}
                  <span className="small suggest-sub" title={`Parts of this area are ${s.gap} tiles from the nearest find`}>
                    area {areaLabels[s.area - 1] ? `${areaLabels[s.area - 1].x}:${areaLabels[s.area - 1].y}` : s.area} {pct(s.chance)} ·{' '}
                    {foundText(s.found)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="muted small">Nothing to suggest{suggestLevel ? ` in ${levelName(suggestLevel)}` : ''}.</div>
      )}
      <div className="muted small" style={{ marginTop: 8 }}>
        Finds keep about {KEEP_AWAY} tiles away from each other and ruins with fewer finds are a little more likely. Each row
        is a 39×39 search{suggestLevel ? ` kept inside ${levelName(suggestLevel)}` : ''}, best first; its % is the share of the
        chance it covers that the ones above it don't. Spots few searches can reach (corners, narrow strips) count extra. If a
        search turns up nothing, mark its centre X and the list updates. Follows the Both / Mine / Shared switch.
      </div>
    </div>
  );
}
