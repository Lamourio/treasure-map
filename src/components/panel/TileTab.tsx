import { formatIndex } from '../../lib/coords';
import { MapView } from '../../lib/mapView';
import { MARKS } from '../../lib/marks';
import { useStore } from '../../lib/useStore';
import { Finder, TileDetails } from '../Finder';
import { Group } from './Group';

export function TileTab({ view }: { view: MapView | null }) {
  const store = useStore();
  const sel = store.selected;
  return (
    <>
      <Group title="Go to">
        <Finder view={view} />
      </Group>
      <Group title="Selected tile">
        {sel !== null ? (
          <TileDetails index={sel} view={view} />
        ) : (
          <div className="empty-state">Tap a tile on the map, or enter coordinates above, to see and mark it here.</div>
        )}
      </Group>
      <Group
        title="Recent jumps"
        actions={
          store.recent.length > 0 && (
            <button className="small-btn" onClick={() => store.clearRecent()}>
              Clear
            </button>
          )
        }
      >
        {store.recent.length ? (
          <div className="coord-list">
            {store.recent.map((i) => {
              const m = store.marks[i];
              return (
                <button
                  key={i}
                  className={`coord-item ${sel === i ? 'active' : ''}`}
                  onClick={() => {
                    store.select(i);
                    view?.goTo(i);
                  }}
                  title={m ? MARKS[m].name : 'No mark'}
                >
                  {m > 0 && <span className="mark-dot" style={{ background: MARKS[m].color }} />}
                  {formatIndex(i)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">Tiles you jump to (Go, lists, pins) appear here.</div>
        )}
      </Group>
    </>
  );
}
