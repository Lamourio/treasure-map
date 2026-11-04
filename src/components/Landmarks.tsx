import { useState } from 'react';
import { MAX_X, MAX_Y, MIN_X, MIN_Y, coordError, indexX, indexY, parseCoordPair, toIndex } from '../lib/coords';
import { MapView } from '../lib/mapView';
import { ICON_LABELS, LANDMARK_ICON_CHOICES, PinIcon } from '../lib/icons';
import { Landmark, MAX_SIZE, typeIcon } from '../lib/store';
import { PinGlyph } from './PinGlyph';
import { Group } from './panel/Group';
import { useStore } from '../lib/useStore';

interface Draft {
  name: string;
  typeId: string;
  level: string;
  x: string;
  y: string;
  size: string;
  notes: string;
}

function toDraft(l: Landmark): Draft {
  return {
    name: l.name,
    typeId: l.typeId,
    level: l.level === null ? '' : String(l.level),
    x: String(l.x),
    y: String(l.y),
    size: String(l.size),
    notes: l.notes,
  };
}

function validate(d: Draft): string | null {
  if (!d.name.trim()) return 'Name is required';
  if (d.x === '' || d.y === '') return 'Enter X and Y';
  const err = coordError(Number(d.x), Number(d.y));
  if (err) return err;
  const size = Number(d.size || 0);
  if (!Number.isInteger(size) || size < 0 || size > MAX_SIZE) return `Size must be a whole number from 0 to ${MAX_SIZE}`;
  if (d.level !== '') {
    const lv = Number(d.level);
    if (!Number.isInteger(lv) || lv < 1 || lv > 99) return 'Level must be empty or 1–99';
  }
  return null;
}

export function Landmarks({ view }: { view: MapView | null }) {
  const store = useStore();
  const [editing, setEditing] = useState<string | null>(null); // landmark id or 'new'
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<'added' | 'name' | 'near'>('added');

  const startNew = () => {
    const sel = store.selected;
    setEditing('new');
    setError(null);
    setDraft({
      name: '',
      typeId: store.types.find((t) => t.id === 'ruin')?.id ?? store.types[0].id,
      level: '',
      x: sel === null ? '' : String(indexX(sel)),
      y: sel === null ? '' : String(indexY(sel)),
      size: '0',
      notes: '',
    });
  };

  const startEdit = (l: Landmark) => {
    setEditing(l.id);
    setDraft(toDraft(l));
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setDraft(null);
    setError(null);
  };

  const save = () => {
    if (!draft) return;
    const err = validate(draft);
    if (err) return setError(err);
    const data = {
      name: draft.name.trim(),
      typeId: draft.typeId,
      level: draft.level === '' ? null : Number(draft.level),
      x: Number(draft.x),
      y: Number(draft.y),
      size: Number(draft.size || 0),
      notes: draft.notes.trim(),
    };
    if (editing === 'new') store.addLandmark(data);
    else if (editing) store.updateLandmark(editing, data);
    cancel();
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setCoord = (axis: 'x' | 'y', value: string) => {
    const pair = /\d\s*[:;,/\s]\s*\d/.test(value) ? parseCoordPair(value) : null;
    if (pair) set({ x: String(pair.x), y: String(pair.y) });
    else set({ [axis]: value.replace(/[^\d]/g, '') });
  };

  const form = draft && (
    <form
      className="lm-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="full">
        <span>Name</span>
        <input value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </label>
      <label>
        <span>Type</span>
        <select value={draft.typeId} onChange={(e) => set({ typeId: e.target.value })}>
          {store.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Level</span>
        <input inputMode="numeric" placeholder="optional" value={draft.level} onChange={(e) => set({ level: e.target.value.replace(/[^\d]/g, '') })} />
      </label>
      <label>
        <span>X</span>
        <input inputMode="numeric" placeholder={`${MIN_X}–${MAX_X}`} value={draft.x} onChange={(e) => setCoord('x', e.target.value)} />
      </label>
      <label>
        <span>Y</span>
        <input inputMode="numeric" placeholder={`${MIN_Y}–${MAX_Y}`} value={draft.y} onChange={(e) => setCoord('y', e.target.value)} />
      </label>
      <label>
        <span title="Radius in tiles: 0 = 1 tile, 3 = 7×7">Size (radius)</span>
        <input inputMode="numeric" value={draft.size} onChange={(e) => set({ size: e.target.value.replace(/[^\d]/g, '') })} />
      </label>
      <div className="form-cell">
        <button
          type="button"
          className="small-btn"
          disabled={store.selected === null}
          onClick={() => store.selected !== null && set({ x: String(indexX(store.selected)), y: String(indexY(store.selected)) })}
          title="Use the selected tile's coordinates"
        >
          Use selected tile
        </button>
      </div>
      <label className="full">
        <span>Notes</span>
        <textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {error && <div className="error full">{error}</div>}
      <div className="full form-actions">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          {editing === 'new' ? 'Add landmark' : 'Save'}
        </button>
      </div>
    </form>
  );

  const q = query.trim().toLowerCase();
  const sel = store.selected;
  const distTo = (l: Landmark) => (sel === null ? 0 : Math.max(Math.abs(l.x - indexX(sel)), Math.abs(l.y - indexY(sel))));
  let shown = store.landmarks.filter(
    (l) => (!typeFilter || l.typeId === typeFilter) && (!q || l.name.toLowerCase().includes(q) || l.notes.toLowerCase().includes(q)),
  );
  if (sort === 'name') shown = [...shown].sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'near' && sel !== null) shown = [...shown].sort((a, b) => distTo(a) - distTo(b));

  return (
    <>
      <Group
        title={`Landmarks (${store.landmarks.length})`}
        actions={
          editing !== 'new' && (
            <button className="small-btn primary" onClick={startNew}>
              + Add
            </button>
          )
        }
      >
        {editing === 'new' && form}
        <div className="browser-filters">
          <input type="search" placeholder="Search name or notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search landmarks" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type filter">
            <option value="">All types</option>
            {store.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="added">Order added</option>
            <option value="name">By name</option>
            <option value="near" disabled={sel === null}>
              Nearest to selected
            </option>
          </select>
        </div>
        <ul className="lm-list">
          {shown.map((l) =>
            editing === l.id ? (
              <li key={l.id} className="editing">
                {form}
              </li>
            ) : (
              <li key={l.id}>
                <button
                  className="lm-main"
                  onClick={() => {
                    const i = toIndex(l.x, l.y);
                    store.select(i);
                    view?.goTo(i, Math.min(24, Math.max(8, 300 / (l.size * 2 + 1))));
                  }}
                  title={l.notes || 'Jump to landmark'}
                >
                  <PinGlyph icon={typeIcon(store.typeOf(l))} color={store.typeOf(l).color} size={20} />
                  <span className="lm-name">
                    {l.name}
                    {l.level ? <span className="muted"> · Lv {l.level}</span> : null}
                  </span>
                  <span className="lm-coord">
                    {l.x}:{l.y}
                    {l.size ? ` ±${l.size}` : ''}
                    {sel !== null && <span className="lm-dist">{distTo(l)}t away</span>}
                  </span>
                </button>
                <button className="icon-btn" onClick={() => startEdit(l)} title="Edit" aria-label={`Edit ${l.name}`}>
                  ✎
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => confirm(`Delete landmark "${l.name}"?`) && store.deleteLandmark(l.id)}
                  title="Delete"
                  aria-label={`Delete ${l.name}`}
                >
                  ×
                </button>
              </li>
            ),
          )}
        </ul>
        {shown.length === 0 && (
          <div className="empty-state">{store.landmarks.length ? 'No landmark matches.' : 'No landmarks yet. Use + Add.'}</div>
        )}
      </Group>
      <Group title="Landmark types" collapsibleId="types" defaultOpen={false}>
        <TypeEditor />
      </Group>
    </>
  );
}

function TypeEditor() {
  const store = useStore();
  return (
    <div className="type-editor">
      {store.types.map((t) => {
        const used = store.landmarks.filter((l) => l.typeId === t.id).length;
        return (
          <div className="type-row" key={t.id}>
            <PinGlyph icon={typeIcon(t)} color={t.color} size={22} />
            <input
              className="type-name"
              defaultValue={t.name}
              key={t.name}
              maxLength={40}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== t.name) store.updateType(t.id, { name });
                else e.target.value = t.name;
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Type name"
            />
            <select
              className="icon-select"
              value={typeIcon(t)}
              onChange={(e) => store.updateType(t.id, { icon: e.target.value as PinIcon })}
              aria-label={`${t.name} icon`}
            >
              {LANDMARK_ICON_CHOICES.map((ic) => (
                <option key={ic} value={ic}>
                  {ICON_LABELS[ic]}
                </option>
              ))}
            </select>
            <input type="color" value={t.color} onChange={(e) => store.updateType(t.id, { color: e.target.value })} aria-label={`${t.name} colour`} />
            <span className="muted small" title="Landmarks using this type">{used}</span>
            <button
              className="icon-btn danger"
              disabled={store.types.length <= 1}
              onClick={() =>
                (!used || confirm(`"${t.name}" is used by ${used} landmark(s). They will move to "Other". Delete?`)) && store.deleteType(t.id)
              }
              title="Delete type"
              aria-label={`Delete type ${t.name}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="small-btn" onClick={() => store.addType('New type', '#888888')}>
        + Add type
      </button>
    </div>
  );
}
