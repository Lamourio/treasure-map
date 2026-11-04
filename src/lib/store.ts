import { TILE_COUNT, formatIndex, indexX, indexY, isValidCoord, toIndex } from './coords';
import { PinIcon, isPinIcon } from './icons';
import { MARKS, MarkCode, markFromLetter } from './marks';
import { zoneLevel } from './zones';

export interface LandmarkType {
  id: string;
  name: string;
  color: string;
  icon?: PinIcon; // optional for data saved before icons existed; see typeIcon()
}

export interface Landmark {
  id: string;
  name: string;
  typeId: string;
  level: number | null;
  x: number;
  y: number;
  size: number; // radius in tiles: 0 = 1 tile, 3 = 7x7
  notes: string;
}

/** 'select' = click selects a tile; a MarkCode = brush that paints that code (0 = eraser). */
export type Tool = 'select' | MarkCode;

export interface Settings {
  showZones: boolean;
  showPins: boolean; // pins + clusters for marks and landmarks when zoomed out
  brushSize: number; // brush radius in tiles: 0 = 1 tile, 1 = 3x3, 2 = 5x5, 4 = 9x9
  brushShape: 'brush' | 'box'; // freehand stamp, or drag a rectangle
  eraseCodes: boolean[]; // which mark codes the eraser removes (indexed by code)
  showCodes: boolean[]; // indexed by mark code (index 0 unused)
  dimUnmarked: boolean;
  tool: Tool;
  panelOpen: boolean;
}

export type StoreEvent =
  | { type: 'marks'; indices: number[] | null } // null = everything changed
  | { type: 'landmarks' }
  | { type: 'settings' }
  | { type: 'selection' }
  | { type: 'other' };

interface TileChange {
  i: number;
  pm: number; // previous mark
  nm: number; // next mark
  pn: string | undefined; // previous note
  nn: string | undefined; // next note
}

interface LandmarkState {
  landmarks: Landmark[];
  types: LandmarkType[];
}

interface Snapshot extends LandmarkState {
  marks: Uint8Array;
  notes: Map<number, string>;
}

type Op =
  | { kind: 'tiles'; label: string; changes: TileChange[] }
  | { kind: 'landmarks'; label: string; prev: LandmarkState; next: LandmarkState; key?: string; time: number }
  | { kind: 'snapshot'; label: string; prev: Snapshot; next: Snapshot };

/** Short message shown in the toast after a change, with the action its button performs. */
export interface Notice {
  id: number;
  text: string;
  action: 'undo' | 'redo' | null;
}

function describeTiles(changes: TileChange[]): string {
  if (changes.length === 1) {
    const c = changes[0];
    const at = formatIndex(c.i);
    if (c.pm === c.nm) return c.nn ? `Note saved on ${at}` : `Note removed from ${at}`;
    if (!c.nm) return `Cleared ${at}`;
    return `${at} marked ${MARKS[c.nm].letter} · ${MARKS[c.nm].name}`;
  }
  const codes = new Set(changes.map((c) => c.nm));
  if (codes.size === 1) {
    const m = [...codes][0];
    return m ? `Painted ${changes.length} tiles ${MARKS[m].letter}` : `Erased ${changes.length} tiles`;
  }
  return `Changed ${changes.length} tiles`;
}

export interface ImportResult {
  marks: number;
  landmarks: number;
  types: number;
  warnings: string[];
}

export const NOTE_MAX = 200;
export const MAX_SIZE = 50;
const HISTORY_LIMIT = 300;
const RECENT_LIMIT = 12;
const STORAGE_KEY = 'treasure-map:v1';
const EXPORT_APP = 'treasure-hunt-map';

export const DEFAULT_TYPES: LandmarkType[] = [
  { id: 'throne', name: "King's Throne", color: '#7030A0', icon: 'crown' },
  { id: 'ruin', name: 'Ruin', color: '#C65911', icon: 'ruin' },
  { id: 'fortress', name: 'Fortress', color: '#2F5597', icon: 'castle' },
  { id: 'alliance', name: 'Alliance Base', color: '#00B0F0', icon: 'flag' },
  { id: 'other', name: 'Other', color: '#FF66CC', icon: 'star' },
];

export function typeIcon(t: LandmarkType): PinIcon {
  return t.icon ?? DEFAULT_TYPES.find((d) => d.id === t.id)?.icon ?? 'star';
}

const DEFAULT_LANDMARKS: Landmark[] = [
  { id: 'kings-throne', name: "King's Throne", typeId: 'throne', level: null, x: 256, y: 514, size: 0, notes: '' },
];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function defaultSettings(): Settings {
  return {
    showZones: true,
    showPins: true,
    brushSize: 0,
    brushShape: 'brush',
    eraseCodes: [true, true, true, true, true],
    showCodes: [true, true, true, true, true],
    dimUnmarked: false,
    tool: 'select',
    panelOpen: typeof window === 'undefined' || window.innerWidth > 820,
  };
}

function encodeRle(arr: Uint8Array): number[] {
  const out: number[] = [];
  let prev = arr[0];
  let run = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === prev) run++;
    else {
      out.push(prev, run);
      prev = arr[i];
      run = 1;
    }
  }
  out.push(prev, run);
  return out;
}

function decodeRle(rle: unknown, into: Uint8Array): boolean {
  if (!Array.isArray(rle)) return false;
  let k = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i];
    const n = rle[i + 1];
    if (typeof v !== 'number' || typeof n !== 'number' || v < 0 || v > 4 || n < 0 || k + n > into.length) return false;
    into.fill(v, k, k + n);
    k += n;
  }
  return k === into.length;
}

function cleanNote(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const t = text.trim().slice(0, NOTE_MAX);
  return t || undefined;
}

function parseMarkCode(v: unknown): MarkCode | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4) return v as MarkCode;
  if (typeof v === 'string') return markFromLetter(v);
  return null;
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

export class Store {
  readonly marks = new Uint8Array(TILE_COUNT);
  readonly notes = new Map<number, string>();
  /** Indices of all marked tiles (for fast iteration when marks are sparse). */
  readonly marked = new Set<number>();
  /** markCounts[code] */
  readonly markCounts = new Array<number>(5).fill(0);
  /** levelMarkCounts[level * 5 + code] */
  readonly levelMarkCounts = new Array<number>(7 * 5).fill(0);

  landmarks: Landmark[] = DEFAULT_LANDMARKS.map((l) => ({ ...l }));
  types: LandmarkType[] = DEFAULT_TYPES.map((t) => ({ ...t }));
  settings: Settings = defaultSettings();
  selected: number | null = null;
  saveError: string | null = null;
  notice: Notice | null = null;
  /** Tiles recently jumped to (newest first). */
  recent: number[] = [];
  private noticeId = 0;

  version = 0;
  private listeners = new Set<(ev: StoreEvent) => void>();
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  private stroke: Map<number, TileChange> | null = null;
  private saveTimer: number | undefined;

  constructor() {
    this.load();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushSave());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushSave();
      });
    }
  }

  // ---------------------------------------------------------------- events

  subscribe = (fn: (ev: StoreEvent) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(ev: StoreEvent, persist = true) {
    this.version++;
    for (const fn of this.listeners) fn(ev);
    if (persist) this.scheduleSave();
  }

  // ---------------------------------------------------------------- tiles

  private applyTile(i: number, mark: number, note: string | undefined) {
    const prev = this.marks[i];
    if (prev !== mark) {
      const lvl = zoneLevel[i];
      this.markCounts[prev]--;
      this.levelMarkCounts[lvl * 5 + prev]--;
      this.markCounts[mark]++;
      this.levelMarkCounts[lvl * 5 + mark]++;
      this.marks[i] = mark;
      if (mark) this.marked.add(i);
      else this.marked.delete(i);
    }
    if (note) this.notes.set(i, note);
    else this.notes.delete(i);
  }

  private recountMarks() {
    this.markCounts.fill(0);
    this.levelMarkCounts.fill(0);
    this.marked.clear();
    for (let i = 0; i < TILE_COUNT; i++) {
      const m = this.marks[i];
      this.markCounts[m]++;
      this.levelMarkCounts[zoneLevel[i] * 5 + m]++;
      if (m) this.marked.add(i);
    }
    for (const i of this.notes.keys()) if (!this.marks[i]) this.notes.delete(i);
  }

  /** Sets a tile's mark (clearing a mark drops its note). Part of the open stroke, if any. */
  setTile(i: number, mark: number, note: string | undefined = this.notes.get(i)) {
    const nn = mark ? cleanNote(note) : undefined;
    const pm = this.marks[i];
    const pn = this.notes.get(i);
    if (pm === mark && pn === nn) return;
    if (this.stroke) {
      const c = this.stroke.get(i);
      if (c) {
        c.nm = mark;
        c.nn = nn;
      } else this.stroke.set(i, { i, pm, nm: mark, pn, nn });
    } else {
      const changes = [{ i, pm, nm: mark, pn, nn }];
      this.pushOp({ kind: 'tiles', label: describeTiles(changes), changes });
    }
    this.applyTile(i, mark, nn);
    this.emit({ type: 'marks', indices: [i] });
  }

  clearTile(i: number) {
    this.setTile(i, 0);
  }

  setNote(i: number, text: string) {
    if (!this.marks[i]) return;
    this.setTile(i, this.marks[i], text);
  }

  beginStroke() {
    this.endStroke();
    this.stroke = new Map();
  }

  endStroke() {
    if (!this.stroke) return;
    const changes = [...this.stroke.values()].filter((c) => c.pm !== c.nm || c.pn !== c.nn);
    this.stroke = null;
    if (changes.length) this.pushOp({ kind: 'tiles', label: describeTiles(changes), changes });
  }

  // ------------------------------------------------------------ landmarks

  private landmarkState(): LandmarkState {
    return { landmarks: this.landmarks, types: this.types };
  }

  private commitLandmarks(next: LandmarkState, label: string, key?: string) {
    const prev = this.landmarkState();
    const top = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (key && top && top.kind === 'landmarks' && top.key === key && now - top.time < 1500) {
      top.next = next; // coalesce rapid edits of the same thing (typing, colour drag)
      top.time = now;
      this.redoStack = [];
    } else {
      this.pushOp({ kind: 'landmarks', label, prev, next, key, time: now });
    }
    this.landmarks = next.landmarks;
    this.types = next.types;
    this.emit({ type: 'landmarks' });
  }

  addLandmark(l: Omit<Landmark, 'id'>): Landmark {
    const lm = { ...l, id: uid() };
    this.commitLandmarks({ landmarks: [...this.landmarks, lm], types: this.types }, `Added landmark "${lm.name}"`);
    return lm;
  }

  updateLandmark(id: string, patch: Partial<Omit<Landmark, 'id'>>) {
    const name = patch.name ?? this.landmarks.find((l) => l.id === id)?.name;
    this.commitLandmarks(
      { landmarks: this.landmarks.map((l) => (l.id === id ? { ...l, ...patch } : l)), types: this.types },
      `Updated landmark "${name}"`,
    );
  }

  deleteLandmark(id: string) {
    const name = this.landmarks.find((l) => l.id === id)?.name;
    this.commitLandmarks(
      { landmarks: this.landmarks.filter((l) => l.id !== id), types: this.types },
      `Deleted landmark "${name}"`,
    );
  }

  addType(name: string, color: string, icon: PinIcon = 'star'): LandmarkType {
    const t = { id: uid(), name, color, icon };
    this.commitLandmarks({ landmarks: this.landmarks, types: [...this.types, t] }, `Added type "${name}"`);
    return t;
  }

  updateType(id: string, patch: Partial<Omit<LandmarkType, 'id'>>) {
    this.commitLandmarks(
      { landmarks: this.landmarks, types: this.types.map((t) => (t.id === id ? { ...t, ...patch } : t)) },
      'Updated landmark type',
      `type:${id}:${Object.keys(patch).join()}`,
    );
  }

  /** Deletes a type; landmarks using it move to "Other" (or the first remaining type). */
  deleteType(id: string) {
    const types = this.types.filter((t) => t.id !== id);
    if (!types.length) return;
    const fallback = (types.find((t) => t.id === 'other') ?? types[0]).id;
    this.commitLandmarks(
      { landmarks: this.landmarks.map((l) => (l.typeId === id ? { ...l, typeId: fallback } : l)), types },
      `Deleted type "${this.types.find((t) => t.id === id)?.name}"`,
    );
  }

  typeOf(l: Landmark): LandmarkType {
    return this.types.find((t) => t.id === l.typeId) ?? { id: '?', name: 'Unknown', color: '#999999' };
  }

  landmarksAt(x: number, y: number): Landmark[] {
    return this.landmarks.filter((l) => Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= l.size);
  }

  /** Nearest landmark by Chebyshev distance to its centre. */
  nearestLandmark(x: number, y: number): { landmark: Landmark; distance: number } | null {
    let best: Landmark | null = null;
    let bestD = Infinity;
    for (const l of this.landmarks) {
      const d = Math.max(Math.abs(l.x - x), Math.abs(l.y - y));
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best ? { landmark: best, distance: bestD } : null;
  }

  // ------------------------------------------------------------- settings

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.emit({ type: 'settings' });
  }

  select(i: number | null) {
    if (this.selected === i) return;
    this.selected = i;
    this.emit({ type: 'selection' }, false);
  }

  addRecent(i: number) {
    this.recent = [i, ...this.recent.filter((r) => r !== i)].slice(0, RECENT_LIMIT);
    this.emit({ type: 'other' });
  }

  clearRecent() {
    this.recent = [];
    this.emit({ type: 'other' });
  }

  // --------------------------------------------------------------- queries

  /** Marked tile indices for one code, sorted by Y then X. */
  indicesWithMark(code: number): number[] {
    const out: number[] = [];
    for (const i of this.marked) if (this.marks[i] === code) out.push(i);
    return out.sort((a, b) => a - b);
  }

  // --------------------------------------------------------------- history

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  private pushOp(op: Op) {
    this.undoStack.push(op);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.notify(op.label, 'undo');
  }

  /** Shows a toast. `action` adds an Undo/Redo button. */
  notify(text: string, action: Notice['action'] = null) {
    this.notice = { id: ++this.noticeId, text, action };
    this.emit({ type: 'other' }, false);
  }

  undo() {
    this.endStroke();
    const op = this.undoStack.pop();
    if (!op) return;
    this.applyOp(op, true);
    this.redoStack.push(op);
    this.notify(`Undone: ${op.label}`, 'redo');
  }

  redo() {
    this.endStroke();
    const op = this.redoStack.pop();
    if (!op) return;
    this.applyOp(op, false);
    this.undoStack.push(op);
    this.notify(`Redone: ${op.label}`, 'undo');
  }

  private applyOp(op: Op, reverse: boolean) {
    if (op.kind === 'tiles') {
      const list = reverse ? [...op.changes].reverse() : op.changes;
      for (const c of list) this.applyTile(c.i, reverse ? c.pm : c.nm, reverse ? c.pn : c.nn);
      this.emit({ type: 'marks', indices: op.changes.map((c) => c.i) });
    } else if (op.kind === 'landmarks') {
      const s = reverse ? op.prev : op.next;
      this.landmarks = s.landmarks;
      this.types = s.types;
      this.emit({ type: 'landmarks' });
    } else {
      this.restoreSnapshot(reverse ? op.prev : op.next);
    }
  }

  private snapshot(): Snapshot {
    return {
      marks: this.marks.slice(),
      notes: new Map(this.notes),
      landmarks: this.landmarks,
      types: this.types,
    };
  }

  private restoreSnapshot(s: Snapshot) {
    this.marks.set(s.marks);
    this.notes.clear();
    for (const [k, v] of s.notes) this.notes.set(k, v);
    this.landmarks = s.landmarks;
    this.types = s.types;
    this.recountMarks();
    this.emit({ type: 'marks', indices: null });
    this.emit({ type: 'landmarks' });
  }

  /** Runs a bulk change as one undoable step. */
  private bulk(label: string, fn: () => void) {
    this.endStroke();
    const prev = this.snapshot();
    fn();
    this.recountMarks();
    this.pushOp({ kind: 'snapshot', label, prev, next: this.snapshot() });
    this.emit({ type: 'marks', indices: null });
    this.emit({ type: 'landmarks' });
  }

  /** Sets many tiles to one code as a single undoable step. */
  markMany(indices: number[], code: number) {
    if (!indices.length) return;
    const label = code ? `Marked ${indices.length} tiles ${MARKS[code].letter}` : `Cleared ${indices.length} tiles`;
    this.bulk(label, () => {
      for (const i of indices) {
        this.marks[i] = code;
        if (!code) this.notes.delete(i);
      }
    });
  }

  // ------------------------------------------------------- export / import

  exportData() {
    const marks = [...this.marked]
      .sort((a, b) => a - b)
      .map((i) => {
        const m: { x: number; y: number; code: string; note?: string } = {
          x: indexX(i),
          y: indexY(i),
          code: MARKS[this.marks[i]].letter,
        };
        const note = this.notes.get(i);
        if (note) m.note = note;
        return m;
      });
    return {
      app: EXPORT_APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      coordinates: 'game (X 3..509, Y 3..1021)',
      marks,
      landmarks: this.landmarks,
      landmarkTypes: this.types,
    };
  }

  /** Validates and applies an exported file. Throws with a readable message on bad input. */
  importData(raw: unknown, mode: 'replace' | 'merge'): ImportResult {
    if (!raw || typeof raw !== 'object') throw new Error('The file is not a JSON object.');
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.marks) && !Array.isArray(data.landmarks)) {
      throw new Error('No "marks" or "landmarks" found - is this a treasure map export?');
    }
    const warnings: string[] = [];
    const warn = (msg: string) => {
      if (warnings.length < 20) warnings.push(msg);
      else if (warnings.length === 20) warnings.push('...more problems not shown');
    };

    // types
    let types: LandmarkType[] = mode === 'replace' ? [] : [...this.types];
    if (Array.isArray(data.landmarkTypes)) {
      data.landmarkTypes.forEach((t: any, n: number) => {
        if (!t || typeof t.name !== 'string' || !t.name.trim() || !isHexColor(t.color)) {
          warn(`landmark type #${n + 1} skipped (needs name and #RRGGBB colour)`);
          return;
        }
        const id = typeof t.id === 'string' && t.id ? t.id : uid();
        const existing = types.findIndex((x) => x.id === id);
        const type: LandmarkType = { id, name: t.name.trim().slice(0, 40), color: t.color };
        if (isPinIcon(t.icon)) type.icon = t.icon;
        if (existing >= 0) types[existing] = type;
        else types.push(type);
      });
    }
    if (!types.length) types = DEFAULT_TYPES.map((t) => ({ ...t }));
    const typeIdFor = (l: any): string => {
      if (typeof l.typeId === 'string' && types.some((t) => t.id === l.typeId)) return l.typeId;
      if (typeof l.type === 'string') {
        const byName = types.find((t) => t.name.toLowerCase() === l.type.toLowerCase());
        if (byName) return byName.id;
      }
      return (types.find((t) => t.id === 'other') ?? types[types.length - 1]).id;
    };

    // landmarks
    const landmarks: Landmark[] = mode === 'replace' ? [] : [...this.landmarks];
    let landmarkCount = 0;
    if (Array.isArray(data.landmarks)) {
      data.landmarks.forEach((l: any, n: number) => {
        const label = `landmark #${n + 1}${l && typeof l.name === 'string' ? ` "${l.name}"` : ''}`;
        if (!l || typeof l.name !== 'string' || !l.name.trim()) return warn(`${label} skipped (no name)`);
        const x = Number(l.x);
        const y = Number(l.y);
        if (!isValidCoord(x, y)) return warn(`${label} skipped (invalid coordinates ${l.x}:${l.y})`);
        const size = Number(l.size ?? 0);
        if (!Number.isInteger(size) || size < 0 || size > MAX_SIZE) return warn(`${label} skipped (size must be 0-${MAX_SIZE})`);
        const level = l.level === null || l.level === undefined || l.level === '' ? null : Number(l.level);
        if (level !== null && (!Number.isInteger(level) || level < 1 || level > 99)) return warn(`${label} skipped (bad level)`);
        const id = typeof l.id === 'string' && l.id ? l.id : uid();
        const lm: Landmark = {
          id,
          name: l.name.trim().slice(0, 60),
          typeId: typeIdFor(l),
          level,
          x,
          y,
          size,
          notes: typeof l.notes === 'string' ? l.notes.slice(0, 1000) : '',
        };
        const existing = landmarks.findIndex((o) => o.id === id);
        if (existing >= 0) landmarks[existing] = lm;
        else landmarks.push(lm);
        landmarkCount++;
      });
    }

    // marks
    const tiles: { i: number; code: MarkCode; note?: string }[] = [];
    if (Array.isArray(data.marks)) {
      data.marks.forEach((m: any, n: number) => {
        const x = Number(m?.x);
        const y = Number(m?.y);
        if (!isValidCoord(x, y)) return warn(`mark #${n + 1} skipped (invalid coordinates ${m?.x}:${m?.y})`);
        const code = parseMarkCode(m.code);
        if (!code) return warn(`mark #${n + 1} at ${x}:${y} skipped (unknown code "${m.code}")`);
        tiles.push({ i: toIndex(x, y), code, note: cleanNote(m.note) });
      });
    }

    this.bulk(`Imported ${tiles.length} marks and ${landmarkCount} landmarks`, () => {
      if (mode === 'replace') {
        this.marks.fill(0);
        this.notes.clear();
      }
      for (const t of tiles) {
        this.marks[t.i] = t.code;
        if (t.note) this.notes.set(t.i, t.note);
        else this.notes.delete(t.i);
      }
      this.landmarks = landmarks;
      this.types = types;
    });
    return { marks: tiles.length, landmarks: landmarkCount, types: types.length, warnings };
  }

  // ----------------------------------------------------------- persistence

  private scheduleSave() {
    if (typeof window === 'undefined') return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  flushSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const prevError = this.saveError;
    try {
      const payload = {
        v: 1,
        marks: encodeRle(this.marks),
        notes: [...this.notes],
        landmarks: this.landmarks,
        types: this.types,
        settings: this.settings,
        recent: this.recent,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      this.saveError = null;
    } catch (e) {
      this.saveError = `Could not save to browser storage: ${(e as Error).message}. Export a backup!`;
    }
    if (prevError !== this.saveError) this.emit({ type: 'other' }, false);
  }

  private load() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      this.saveError = 'Browser storage is unavailable; changes will not be kept after closing.';
    }
    if (!raw) {
      this.recountMarks();
      return;
    }
    try {
      const d = JSON.parse(raw);
      if (!decodeRle(d.marks, this.marks)) this.marks.fill(0);
      if (Array.isArray(d.notes)) {
        for (const [i, text] of d.notes) {
          const note = cleanNote(text);
          if (Number.isInteger(i) && i >= 0 && i < TILE_COUNT && note) this.notes.set(i, note);
        }
      }
      if (Array.isArray(d.types) && d.types.length) this.types = d.types;
      if (Array.isArray(d.landmarks)) this.landmarks = d.landmarks;
      if (Array.isArray(d.recent)) this.recent = d.recent.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < TILE_COUNT).slice(0, RECENT_LIMIT);
      if (d.settings) {
        // on phones the panel covers the map, so always start with it closed
        const s = { ...defaultSettings(), ...d.settings, panelOpen: d.settings.panelOpen && window.innerWidth > 820 };
        if (s.tool === 'cycle') s.tool = 'select'; // saved before the select tool existed
        if (!Array.isArray(s.eraseCodes) || s.eraseCodes.length !== 5) s.eraseCodes = defaultSettings().eraseCodes;
        if (![0, 1, 2, 4].includes(s.brushSize)) s.brushSize = 0;
        if (s.brushShape !== 'box') s.brushShape = 'brush';
        if (!Array.isArray(s.showCodes) || s.showCodes.length !== 5) s.showCodes = defaultSettings().showCodes;
        this.settings = s;
      }
    } catch {
      this.saveError = 'Saved data was unreadable and has been ignored.';
    }
    this.recountMarks();
  }
}

export const store = new Store();
