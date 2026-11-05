import { useState } from 'react';
import { PIN_ICONS, PinIcon } from '../lib/icons';
import { MapView } from '../lib/mapView';
import { MARK_CODES } from '../lib/marks';
import { useStore } from '../lib/useStore';
import { DataPanel } from './DataPanel';
import { Icon } from './Icon';
import { Landmarks } from './Landmarks';
import { Group } from './panel/Group';
import { MapTab } from './panel/MapTab';
import { MarksTab } from './panel/MarksTab';
import { TileTab } from './panel/TileTab';

type TabId = 'tile' | 'marks' | 'landmarks' | 'map' | 'more';

const TABS: { id: TabId; label: string; icon: PinIcon | 'layers' | 'more' | 'target' }[] = [
  { id: 'tile', label: 'Tile', icon: 'target' },
  { id: 'marks', label: 'Marks', icon: 'chest' },
  { id: 'landmarks', label: 'Landmarks', icon: 'flag' },
  { id: 'map', label: 'Map', icon: 'layers' },
  { id: 'more', label: 'More', icon: 'more' },
];

const TAB_KEY = 'treasure-map:panel-tab';

function readTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some((x) => x.id === t)) return t as TabId;
  } catch {
    /* ignore */
  }
  return 'tile';
}

function TabIcon({ icon }: { icon: (typeof TABS)[number]['icon'] }) {
  if (icon === 'layers' || icon === 'target') return <Icon name={icon} size={18} />;
  if (icon === 'more') return <Icon name="more" size={18} />;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {PIN_ICONS[icon].map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill === 'fg' ? 'currentColor' : 'none'}
          stroke={p.stroke === 'fg' ? 'currentColor' : 'none'}
          strokeWidth={p.width ?? 2}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function SidePanel({ view }: { view: MapView | null }) {
  const store = useStore();
  const [expanded, setExpanded] = useState(false); // phone bottom sheet: half or nearly full height
  const [tab, setTabState] = useState<TabId>(readTab);
  if (!store.settings.panelOpen) return null;

  const setTab = (t: TabId) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const badge: Partial<Record<TabId, number>> = {
    marks: MARK_CODES.reduce((n: number, c) => n + store.markCounts[c], 0),
    landmarks: store.landmarks.length,
  };

  return (
    <aside className={`side-panel ${expanded ? 'expanded' : ''}`}>
      <div className="panel-head">
        {/* phone only: bottom-sheet bar */}
        <div className="panel-bar">
          <button className="sheet-handle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? 'Show more map' : 'Expand panel'}
          </button>
          <button className="icon-btn" onClick={() => store.setSettings({ panelOpen: false })} aria-label="Close panel">
            <Icon name="close" size={16} />
          </button>
        </div>
        <nav className="panel-tabs" role="tablist" aria-label="Panel sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              <TabIcon icon={t.icon} />
              <span className="panel-tab-label">{t.label}</span>
              {badge[t.id] ? <span className="panel-tab-badge">{badge[t.id]! > 999 ? '999+' : badge[t.id]}</span> : null}
            </button>
          ))}
        </nav>
      </div>
      <div className="panel-body" role="tabpanel">
        {tab === 'tile' && <TileTab view={view} />}
        {tab === 'marks' && <MarksTab view={view} />}
        {tab === 'landmarks' && <Landmarks view={view} />}
        {tab === 'map' && <MapTab view={view} />}
        {tab === 'more' && (
          <>
            <Group title="Backup & data">
              <DataPanel />
            </Group>
            <Group title="How to use" collapsibleId="help">
              <Help />
            </Group>
          </>
        )}
      </div>
    </aside>
  );
}

function Help() {
  return (
    <ul className="help">
      <li>
        <b>Click</b> or <b>tap</b> a tile to select it (click it again to deselect). A card opens next to it: pick T / D / S,
        clear the mark, or add a note. Clicking never changes a mark by itself.
      </li>
      <li>
        With a tile selected: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> mark it T / D / S, <kbd>0</kbd> or <kbd>Delete</kbd> clears it,{' '}
        <kbd>←↑↓→</kbd> move to the next tile (<kbd>Shift</kbd> = 10 tiles), <kbd>N</kbd> / <kbd>Shift+N</kbd> jump to the next / previous tile with the same mark, <kbd>Esc</kbd> closes the card.
      </li>
      <li>
        To mark many tiles, pick a <b>brush</b> (T/C/S/D/eraser) in the toolbar. The banner on the map sets the size (1, 3, 5
        or 9 tiles) or <b>Box</b> to drag a rectangle; the eraser can be limited to some codes. <b>Right-drag</b> erases
        with any brush. Pan with the middle mouse button, <b>Space+drag</b>, or two fingers. <kbd>Esc</kbd> goes back to Select.
      </li>
      <li>
        <b>Wheel</b>, <b>pinch</b> or <b>double-click</b> zooms; <b>drag</b> pans (Shift+wheel pans sideways). Type <b>123:456</b> in the toolbar box to jump to a tile.
      </li>
      <li>
        Keys: <kbd>V</kbd> select, <kbd>T</kbd> <kbd>R</kbd> <kbd>D</kbd> <kbd>S</kbd> brushes, <kbd>E</kbd> eraser,{' '}
        <kbd>F</kbd> fit, <kbd>Z</kbd> zones, <kbd>P</kbd> panel, <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo/redo.
      </li>
      <li>Every change shows a message with <b>Undo</b> at the bottom of the map.</li>
      <li>Everything is saved in this browser. Use Export regularly for backups or to share.</li>
    </ul>
  );
}
