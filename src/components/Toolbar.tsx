import { useState, type CSSProperties, type FormEvent } from 'react';
import { coordError, parseCoordPair, toIndex } from '../lib/coords';
import { MapView } from '../lib/mapView';
import { MARKS, MARK_CODES } from '../lib/marks';
import { Tool, store } from '../lib/store';
import { useStore } from '../lib/useStore';
import { Icon } from './Icon';

export function Toolbar({ view }: { view: MapView | null }) {
  const store = useStore();
  const { tool, showZones, panelOpen } = store.settings;
  const setTool = (t: Tool) => store.setSettings({ tool: t });

  return (
    <header className="toolbar">
      <div className="brand" title="Treasure Hunt Map">
        <span className="brand-mark">T</span>
        <span className="brand-name">Treasure Map</span>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Tool">
        <button
          className={tool === 'select' ? 'active' : ''}
          onClick={() => setTool('select')}
          title="Select: click a tile to select it, then mark it from the card or with keys 1–3 (V)"
          aria-pressed={tool === 'select'}
        >
          <Icon name="pointer" size={16} />
          <span className="hide-sm">Select</span>
        </button>
        {MARK_CODES.map((c) => (
          <button
            key={c}
            className={`brush ${tool === c ? 'active' : ''}`}
            onClick={() => setTool(c)}
            title={`Brush: ${MARKS[c].name} (${MARKS[c].letter}) — click or drag to paint`}
            aria-pressed={tool === c}
            style={{ '--brush': MARKS[c].color, '--brush-text': MARKS[c].text } as CSSProperties}
          >
            {MARKS[c].letter}
          </button>
        ))}
        <button
          className={tool === 0 ? 'active' : ''}
          onClick={() => setTool(0)}
          title="Eraser brush (E)"
          aria-pressed={tool === 0}
        >
          <Icon name="eraser" size={16} />
        </button>
      </div>

      <div className="group">
        <button onClick={() => store.undo()} disabled={!store.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button onClick={() => store.redo()} disabled={!store.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon name="redo" />
        </button>
      </div>

      <div className="group">
        <button className="zoom-step" onClick={() => view?.zoomBy(1 / 1.6)} title="Zoom out (-)" aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="zoom-step" onClick={() => view?.zoomBy(1.6)} title="Zoom in (+)" aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <button onClick={() => view?.fit()} title="Fit whole map (F)" aria-label="Fit map">
          <Icon name="fit" />
        </button>
        <button
          className={showZones ? 'active' : ''}
          onClick={() => store.setSettings({ showZones: !showZones })}
          title="Show / hide zones (Z)"
          aria-pressed={showZones}
        >
          <Icon name="layers" />
          <span className="hide-sm">Zones</span>
        </button>
      </div>

      <QuickGo view={view} />

      <div className="spacer" />
      <button
        className={`panel-toggle ${panelOpen ? 'active' : ''}`}
        onClick={() => store.setSettings({ panelOpen: !panelOpen })}
        title="Toggle side panel (P)"
        aria-label="Toggle side panel"
      >
        <Icon name="panel" />
      </button>
    </header>
  );
}

/** "Go to X:Y" box, usable even when the side panel is closed. */
function QuickGo({ view }: { view: MapView | null }) {
  const [text, setText] = useState('');
  const go = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const p = parseCoordPair(text);
    if (!p) return store.notify('Type coordinates like 123:456');
    const err = coordError(p.x, p.y);
    if (err) return store.notify(err);
    const i = toIndex(p.x, p.y);
    store.select(i);
    view?.goTo(i);
    setText('');
    (e.currentTarget.querySelector('input') as HTMLInputElement).blur();
  };
  return (
    <form className="quick-go" onSubmit={go} role="search">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Go to X:Y" aria-label="Go to coordinates X:Y" enterKeyHint="go" />
      <button type="submit" aria-label="Go" title="Go to tile">
        <Icon name="target" size={16} />
      </button>
    </form>
  );
}
