import { formatIndex } from '../../lib/coords';
import { MapView } from '../../lib/mapView';
import { MARKS } from '../../lib/marks';
import { SEARCHED_CODES, getSuggestions } from '../../lib/suggest';
import { useStore } from '../../lib/useStore';
import { LEVELS, LEVEL_COLORS, areaLabels, levelName, zoneLevel } from '../../lib/zones';

/** Ranks zone areas by how far they reach away from every treasure, scrap or dug tile. */
export function SearchSuggestions({ view }: { view: MapView | null }) {
  const store = useStore();
  const { suggestLevel, showSuggestions } = store.settings;
  const list = getSuggestions(store.marks, store.marked, store.marksRevision, suggestLevel);

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
              <button className="tile-row" onClick={() => jump(s.i)} title="Jump there">
                <span className="suggest-rank">{n + 1}</span>
                <span className="swatch" style={{ background: LEVEL_COLORS[zoneLevel[s.i]] }} />
                <span className="suggest-text">
                  <b>{formatIndex(s.i)}</b>
                  <span className="muted small">
                    {' '}
                    area {areaLabels[s.area - 1] ? `${areaLabels[s.area - 1].x}:${areaLabels[s.area - 1].y}` : s.area}
                  </span>
                  <span className="small suggest-sub">
                    {s.gap} tiles from any find ·{' '}
                    {SEARCHED_CODES.map((c) => `${s.found[c] ?? 0} ${MARKS[c].letter}`).join(' ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="muted small">No empty patch left{suggestLevel ? ` in ${levelName(suggestLevel)}` : ''}.</div>
      )}
      <div className="muted small" style={{ marginTop: 8 }}>
        Zone areas ranked by how far they reach from any {SEARCHED_CODES.map((c) => MARKS[c].letter).join(' / ')} mark (finds tend
        to be spread out); the spot is the middle of the area's empty part. Mark searched spots D so they count. Follows the
        Both / Mine / Shared switch.
      </div>
    </div>
  );
}
