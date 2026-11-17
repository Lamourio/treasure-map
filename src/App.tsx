import { useCallback, useEffect, useState } from 'react';
import { MapCanvas } from './components/MapCanvas';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { MAX_X, MAX_Y, MIN_X, MIN_Y, indexX, indexY, toIndex } from './lib/coords';
import { MapView } from './lib/mapView';
import { MARK_CODES, MarkCode } from './lib/marks';
import { Tool, store } from './lib/store';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', t: 1, d: 3, s: 4, c: 5, x: 6, e: 0 };
// number keys follow the order of the codes in use: 1 = T, 2 = C, 3 = S, 4 = D
const MARK_KEYS: Record<string, MarkCode> = { '0': 0, delete: 0, backspace: 0 };
MARK_CODES.forEach((c, n) => (MARK_KEYS[String(n + 1)] = c));
const ARROWS: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

export function App() {
  const [view, setView] = useState<MapView | null>(null);
  const onReady = useCallback((v: MapView | null) => setView(v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) store.redo();
          else store.undo();
        } else if (key === 'y') {
          e.preventDefault();
          store.redo();
        }
        return;
      }
      if (e.altKey) return;
      const sel = store.selected;

      // selected tile: arrows move it to the next tile straight left / right / up / down (X or Y
      // ±2: tiles only exist where X + Y is even), Shift for 10 tiles; 1-5 mark it, 0/Delete clears it
      if (key in ARROWS && sel !== null) {
        e.preventDefault();
        const [dx, dy] = ARROWS[key];
        let step = e.shiftKey ? 20 : 2;
        const ok = (x: number, y: number) => x >= MIN_X && x <= MAX_X && y >= MIN_Y && y <= MAX_Y;
        while (step > 0 && !ok(indexX(sel) + dx * step, indexY(sel) + dy * step)) step -= 2;
        if (!step) return;
        const i = toIndex(indexX(sel) + dx * step, indexY(sel) + dy * step);
        store.select(i);
        view?.ensureVisible(i);
        return;
      }
      if (key in MARK_KEYS && sel !== null) {
        e.preventDefault();
        store.setTile(sel, MARK_KEYS[key]);
        return;
      }
      // N / Shift+N: next / previous tile with the same mark as the selected one
      if (key === 'n' && sel !== null && store.marks[sel]) {
        const list = store.indicesWithMark(store.marks[sel]);
        if (list.length > 1) {
          const i = list[(list.indexOf(sel) + (e.shiftKey ? -1 : 1) + list.length) % list.length];
          store.select(i);
          view?.goTo(i);
        }
        return;
      }

      if (key in TOOL_KEYS) store.setSettings({ tool: TOOL_KEYS[key] });
      else if (key === 'escape') {
        if (store.settings.tool !== 'select') store.setSettings({ tool: 'select' });
        else store.select(null);
      } else if (key === 'f') view?.fit();
      else if (key === 'z') store.setSettings({ showZones: !store.settings.showZones });
      else if (key === 'p') store.setSettings({ panelOpen: !store.settings.panelOpen });
      else if (key === '+' || key === '=') view?.zoomBy(1.6);
      else if (key === '-' || key === '_') view?.zoomBy(1 / 1.6);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  return (
    <div className="app">
      <Toolbar view={view} />
      <main className="main">
        <MapCanvas onReady={onReady} />
        <SidePanel view={view} />
      </main>
    </div>
  );
}
