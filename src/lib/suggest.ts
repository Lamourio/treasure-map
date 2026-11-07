import { TILE_COUNT } from './coords';
import { ISO_SIZE, ISO_TILE, TILE_ISO } from './grid';
import { MARK_C, MARK_D, MARK_T, MARK_X, RANGE_EXTENT } from './marks';
import { areaLevel, zoneArea, zoneLevel } from './zones';

// "Where to search next" as a small probability model.
//
// Finds keep away from each other: fitting simulated drops to the shared finds (101 on
// 2026-11-07) gives a soft keep-away radius of about 33 tiles. A tile's weight for the next drop
// is h(d) = 1 - exp(-(d / R)^4), with d its distance to the nearest find: ~0 right next to a
// find, ~0.5 at 30 tiles, ~1 from about 45 tiles. Treasures and scrap showed the same spacing
// (no extra treasure-treasure gap), so both count as finds. A dug-empty tile (D) only rules out
// that tile; an empty-area mark (X) rules out its whole 38×38 area. Neither pushes drops away. An area's chance is the share of the total weight that lies in it, so it grows with
// both its size and how empty it is.
//
// Distances are diamond-grid steps (Chebyshev distance in iso space), the same metric as the
// 39×39 areas.

/** Marks that push the next drop away. */
export const FIND_CODES: number[] = [MARK_T, MARK_C];
/** Dug, nothing there: only that tile is ruled out. */
export const DUG_CODE = MARK_D;
/** Searched 38×38 area with nothing in it: every tile of the area is ruled out. */
export const EMPTY_AREA_CODE = MARK_X;
/** Fitted keep-away radius (tiles) and sharpness of the weight curve. */
export const KEEP_AWAY = 33;
const SHARPNESS = 4;

export const SUGGEST_COUNT = 5;

export interface Suggestion {
  /** Zone area id. */
  area: number;
  /** Where to look: the most central of the area's most likely tiles. */
  i: number;
  /** Share of the chance for the next drop (within the chosen level) that falls in this area, 0..1. */
  chance: number;
  /** How far the area reaches away from any find, in tiles. */
  gap: number;
  /** Known marks inside the area, by code (T, C, D). */
  found: Record<number, number>;
}

export interface SuggestionResult {
  list: Suggestion[];
  /** Weight 0..255 per iso cell (u + v * ISO_SIZE) for the chosen level; 0 elsewhere. */
  heat: Uint8Array;
}

const N = ISO_SIZE;
const INF = 1 << 20;

/** Two-pass distance transform over the iso grid; with all 8 neighbours at cost 1 it is exact for Chebyshev. */
function transform(dist: Int32Array) {
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const p = u + v * N;
      let d = dist[p];
      if (!d) continue;
      if (u > 0) d = Math.min(d, dist[p - 1] + 1);
      if (v > 0) {
        d = Math.min(d, dist[p - N] + 1);
        if (u > 0) d = Math.min(d, dist[p - N - 1] + 1);
        if (u < N - 1) d = Math.min(d, dist[p - N + 1] + 1);
      }
      dist[p] = d;
    }
  }
  for (let v = N - 1; v >= 0; v--) {
    for (let u = N - 1; u >= 0; u--) {
      const p = u + v * N;
      let d = dist[p];
      if (!d) continue;
      if (u < N - 1) d = Math.min(d, dist[p + 1] + 1);
      if (v < N - 1) {
        d = Math.min(d, dist[p + N] + 1);
        if (u < N - 1) d = Math.min(d, dist[p + N + 1] + 1);
        if (u > 0) d = Math.min(d, dist[p + N - 1] + 1);
      }
      dist[p] = d;
    }
  }
}

/** Weight of a tile at distance d from the nearest find. */
const WEIGHT = new Float64Array(256);
for (let d = 0; d < 256; d++) WEIGHT[d] = 1 - Math.exp(-Math.pow(d / KEEP_AWAY, SHARPNESS));
const weightAt = (d: number) => (d < 256 ? WEIGHT[d] : 1);

/** Zone areas of one level (0 = any), most likely first, plus the weight map. */
export function computeSuggestions(marks: Uint8Array, marked: Iterable<number>, level: number, count = SUGGEST_COUNT): SuggestionResult {
  const heat = new Uint8Array(N * N);
  // distance to the nearest find
  const toFind = new Int32Array(N * N).fill(INF);
  // distance to a find, the map edge or another area: how central a tile is (picks the spot)
  const toEdge = new Int32Array(N * N);
  for (let p = 0; p < N * N; p++) toEdge[p] = ISO_TILE[p] < 0 ? 0 : INF;
  const found = new Map<number, Record<number, number>>();
  // tiles known to be empty: D tiles and every tile of an X area
  const empty = new Uint8Array(N * N);
  let finds = 0;
  for (const i of marked) {
    const m = marks[i];
    if (FIND_CODES.includes(m)) {
      toFind[TILE_ISO[i]] = 0;
      toEdge[TILE_ISO[i]] = 0;
      finds++;
    } else if (m === DUG_CODE) {
      empty[TILE_ISO[i]] = 1;
    } else if (m === EMPTY_AREA_CODE) {
      const [lo, hi] = RANGE_EXTENT[m];
      const p = TILE_ISO[i];
      const u = p % N;
      const v = (p - u) / N;
      for (let b = Math.max(0, v - lo); b <= Math.min(N - 1, v + hi); b++) {
        for (let a = Math.max(0, u - lo); a <= Math.min(N - 1, u + hi); a++) empty[a + b * N] = 1;
      }
    } else continue;
    const f = found.get(zoneArea[i]) ?? {};
    f[m] = (f[m] ?? 0) + 1;
    found.set(zoneArea[i], f);
  }
  if (!finds) return { list: [], heat };
  // a tile next to another area is a border
  for (let p = 0; p < N * N; p++) {
    const t = ISO_TILE[p];
    if (t < 0 || !toEdge[p]) continue;
    const a = zoneArea[t];
    const u = p % N;
    for (const q of [p - 1, p + 1, p - N, p + N]) {
      if (q < 0 || q >= N * N || (q === p - 1 && u === 0) || (q === p + 1 && u === N - 1)) continue;
      const tq = ISO_TILE[q];
      if (tq >= 0 && zoneArea[tq] !== a) {
        toEdge[p] = 1;
        break;
      }
    }
  }
  transform(toFind);
  transform(toEdge);

  type Acc = { mass: number; gap: number; i: number; w: number; edge: number };
  const acc = new Map<number, Acc>();
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (level && zoneLevel[i] !== level) continue;
    const p = TILE_ISO[i];
    const df = toFind[p];
    const w = empty[p] ? 0 : weightAt(df);
    heat[p] = Math.round(w * 255);
    total += w;
    const a = zoneArea[i];
    let b = acc.get(a);
    if (!b) acc.set(a, (b = { mass: 0, gap: 0, i: -1, w: -1, edge: -1 }));
    b.mass += w;
    if (df > b.gap) b.gap = df;
    // spot: the most likely tiles (weight in 1% steps), the most central of those
    const wq = Math.round(w * 100);
    if (wq > b.w || (wq === b.w && toEdge[p] > b.edge)) {
      b.i = i;
      b.w = wq;
      b.edge = toEdge[p];
    }
  }
  const list = [...acc.entries()]
    .filter(([a, b]) => areaLevel[a] && b.i >= 0 && b.mass > 0)
    .sort((x, y) => y[1].mass - x[1].mass)
    .slice(0, count)
    .map(([area, b]) => ({ area, i: b.i, chance: total ? b.mass / total : 0, gap: b.gap, found: found.get(area) ?? {} }));
  return { list, heat };
}

let cacheKey = '';
let cache: SuggestionResult = { list: [], heat: new Uint8Array(0) };

/** Cached suggestions; recomputed only when the marks or the level change. */
export function getSuggestions(marks: Uint8Array, marked: Iterable<number>, marksRevision: number, level: number): SuggestionResult {
  const key = `${marksRevision}|${level}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = computeSuggestions(marks, marked, level);
  }
  return cache;
}
