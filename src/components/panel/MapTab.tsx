import { MARK_ICONS } from '../../lib/icons';
import { MapView } from '../../lib/mapView';
import { MARKS, MARK_CODES } from '../../lib/marks';
import { typeIcon } from '../../lib/store';
import { useStore } from '../../lib/useStore';
import { LEVELS, LEVEL_COLORS, levelName, tilesPerLevel } from '../../lib/zones';
import { PinGlyph } from '../PinGlyph';
import { DisplayOptions } from '../Stats';
import { Group } from './Group';

export function MapTab({ view }: { view: MapView | null }) {
  const store = useStore();
  return (
    <>
      <Group
        title="Display & filters"
        actions={
          <button className="small-btn" onClick={() => view?.fit()} title="Fit the whole map (F)">
            Fit map
          </button>
        }
      >
        <DisplayOptions />
      </Group>
      <Group title="Legend">
        <div className="subhead first">Zones</div>
        <ul className="legend-list">
          {LEVELS.map((l) => (
            <li key={l}>
              <span className="swatch" style={{ background: LEVEL_COLORS[l] }} />
              {levelName(l)}
              <span className="muted small">{tilesPerLevel[l].toLocaleString()} tiles</span>
            </li>
          ))}
        </ul>
        <div className="subhead">Marks</div>
        <ul className="legend-list">
          {MARK_CODES.map((c) => (
            <li key={c}>
              <PinGlyph icon={MARK_ICONS[c]} color={MARKS[c].color} size={18} />
              <b>{MARKS[c].letter}</b> {MARKS[c].name}
            </li>
          ))}
        </ul>
        <div className="subhead">Landmark types</div>
        <ul className="legend-list">
          {store.types.map((t) => (
            <li key={t.id}>
              <PinGlyph icon={typeIcon(t)} color={t.color} size={18} />
              {t.name}
            </li>
          ))}
        </ul>
      </Group>
    </>
  );
}
