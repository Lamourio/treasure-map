import { TILE_COUNT } from './coords';
import { ISO_SIZE, ISO_TILE, TILE_ISO } from './grid';
import { MARK_C, MARK_D, MARK_T } from './marks';
import { areaLevel, zoneArea, zoneLevel } from './zones';

// "Where to search next": so far finds have been spread out across the map (more evenly than
// random), so the zone areas with the biggest stretch away from every find are the best bets.
// Distances are diamond-grid steps (Chebyshev distance in iso space), the same metric as the
// 39×39 areas.

/** Marks that count as "this spot is known": treasure, scrap and dug (nothing). */
export const SEARCHED_CODES: number[] = [MARK_T, MARK_C, MARK_D];

export const SUGGEST_COUNT = 5;

export interface Suggestion {
  /** Zone area id. */
  area: number;
  /** Where to look: the most central tile of the area's empty part. */
  i: number;
  /** How far the area reaches away from any find, in tiles (the ranking score). */
  gap: number;
  /** Radius of the empty diamond around `i` that stays inside the area and the map. */
  radius: number;
  /** Known marks inside the area, by code (T, C, D). */
  found: Record<number, number>;
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

/** Zone areas of one level (0 = any), best first: the area reaching farthest from any known mark. */
export function computeSuggestions(marks: Uint8Array, marked: Iterable<number>, level: number, count = SUGGEST_COUNT): Suggestion[] {
  // distance to the nearest known mark only (map edges and zone borders don't count)
  const toFind = new Int32Array(N * N).fill(INF);
  // distance to a known mark, the map edge or another area: how central a tile is in its empty part
  const toEdge = new Int32Array(N * N);
  for (let p = 0; p < N * N; p++) toEdge[p] = ISO_TILE[p] < 0 ? 0 : INF;
  const found = new Map<number, Record<number, number>>();
  let any = false;
  for (const i of marked) {
    const m = marks[i];
    if (!SEARCHED_CODES.includes(m)) continue;
    toFind[TILE_ISO[i]] = 0;
    toEdge[TILE_ISO[i]] = 0;
    any = true;
    const f = found.get(zoneArea[i]) ?? {};
    f[m] = (f[m] ?? 0) + 1;
    found.set(zoneArea[i], f);
  }
  if (!any) return [];
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

  const best = new Map<number, { gap: number; i: number; edge: number; far: number }>();
  for (let i = 0; i < TILE_COUNT; i++) {
    if (level && zoneLevel[i] !== level) continue;
    const a = zoneArea[i];
    const p = TILE_ISO[i];
    let b = best.get(a);
    if (!b) best.set(a, (b = { gap: 0, i: -1, edge: -1, far: -1 }));
    if (toFind[p] > b.gap) b.gap = toFind[p];
    // spot: the most central empty tile; ties go to the one farther from finds
    if (toEdge[p] > b.edge || (toEdge[p] === b.edge && toFind[p] > b.far)) {
      b.i = i;
      b.edge = toEdge[p];
      b.far = toFind[p];
    }
  }
  return [...best.entries()]
    .filter(([a, b]) => areaLevel[a] && b.i >= 0)
    .sort((x, y) => y[1].gap - x[1].gap)
    .slice(0, count)
    .map(([area, b]) => ({ area, i: b.i, gap: b.gap, radius: Math.max(0, b.edge - 1), found: found.get(area) ?? {} }));
}

let cacheKey = '';
let cache: Suggestion[] = [];

/** Cached suggestions; recomputed only when the marks or the level change. */
export function getSuggestions(marks: Uint8Array, marked: Iterable<number>, marksRevision: number, level: number): Suggestion[] {
  const key = `${marksRevision}|${level}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = computeSuggestions(marks, marked, level);
  }
  return cache;
}
