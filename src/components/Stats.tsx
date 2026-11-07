import { MARK_ICONS } from '../lib/icons';
import { PinGlyph } from './PinGlyph';
import { CODE_SLOTS, MARKS, MARK_CODES, PIN_CODES, RANGE_CODES, rangeSize } from '../lib/marks';
import type { MarkLayers } from '../lib/store';
import { useStore } from '../lib/useStore';

const LAYER_OPTIONS: { id: MarkLayers; label: string; title: string }[] = [
  { id: 'both', label: 'Both', title: 'Shared marks and your own marks' },
  { id: 'own', label: 'Mine', title: 'Only the marks you added in this browser' },
  { id: 'shared', label: 'Shared', title: 'Only the marks published with the site' },
];
import { LEVELS, LEVEL_COLORS, levelName, tilesPerLevel } from '../lib/zones';

export function DisplayOptions() {
  const store = useStore();
  const { showZones, showPins, showRanges, showCodes, dimUnmarked, markLayers } = store.settings;
  return (
    <div className="options">
      <div className="layer-row">
        <span>Marks from</span>
        <div className="segmented" role="radiogroup" aria-label="Which marks to show">
          {LAYER_OPTIONS.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={markLayers === o.id}
              className={markLayers === o.id ? 'active' : ''}
              title={o.title}
              onClick={() => store.setSettings({ markLayers: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={showZones} onChange={(e) => store.setSettings({ showZones: e.target.checked })} />
        Show zones
      </label>
      <label className="check" title="When zoomed out, show treasure, scrap and suspected tiles and landmarks as pins">
        <input type="checkbox" checked={showPins} onChange={(e) => store.setSettings({ showPins: e.target.checked })} />
        Pins when zoomed out
        <span className="pin-legend">
          {PIN_CODES.map((c) => (
            <PinGlyph key={c} icon={MARK_ICONS[c]} color={MARKS[c].color} size={16} title={MARKS[c].name} />
          ))}
        </span>
      </label>
      <label className="check" title="Show the 39×39 area around each treasure, scrap and empty-area tile, centred on it">
        <input type="checkbox" checked={showRanges} onChange={(e) => store.setSettings({ showRanges: e.target.checked })} />
        Mark areas
        <span className="pin-legend">
          {RANGE_CODES.map((c) => (
            <PinGlyph key={c} icon={MARK_ICONS[c]} color={MARKS[c].color} size={16} title={`${MARKS[c].name}: ${rangeSize(c)}×${rangeSize(c)}`} />
          ))}
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={dimUnmarked} onChange={(e) => store.setSettings({ dimUnmarked: e.target.checked })} />
        Dim unmarked tiles
      </label>
      <div className="subhead">Show marks</div>
      <div className="code-filter">
        {MARK_CODES.map((c) => (
          <label key={c} className="check" title={MARKS[c].name}>
            <input
              type="checkbox"
              checked={showCodes[c]}
              onChange={(e) => {
                const next = [...showCodes];
                next[c] = e.target.checked;
                store.setSettings({ showCodes: next });
              }}
            />
            <span className="mark-chip" style={{ background: MARKS[c].color, color: MARKS[c].text }}>
              {MARKS[c].letter}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function StatsTable() {
  const store = useStore();
  const c = store.levelMarkCounts;
  return (
    <table className="stats">
      <thead>
        <tr>
          <th>Zone</th>
          <th className="num">Tiles</th>
          {MARK_CODES.map((m) => (
            <th key={m} className="num">
              <span className="mark-chip" style={{ background: MARKS[m].color, color: MARKS[m].text }} title={MARKS[m].name}>
                {MARKS[m].letter}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {LEVELS.map((l) => (
          <tr key={l}>
            <td>
              <span className="swatch" style={{ background: LEVEL_COLORS[l] }} />
              {l === 6 ? 'Throne' : levelName(l)}
            </td>
            <td className="num">{tilesPerLevel[l].toLocaleString()}</td>
            {MARK_CODES.map((m) => (
              <td key={m} className={`num ${c[l * CODE_SLOTS + m] ? '' : 'zero'}`}>
                {c[l * CODE_SLOTS + m]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td className="num">{tilesPerLevel.reduce((a, b) => a + b, 0).toLocaleString()}</td>
          {MARK_CODES.map((m) => (
            <td key={m} className="num">
              {store.markCounts[m]}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}
