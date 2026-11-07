import { TILE_COUNT } from './coords';
import { ISO_SIZE, ISO_TILE, TILE_ISO } from './grid';
import { MARK_C, MARK_D, MARK_T, MARK_X, RANGE_EXTENT, RANGE_RADIUS } from './marks';
import { areaLevel, zoneArea, zoneLevel } from './zones';

// "Where to search next" as a small probability model.
//
// Finds keep away from each other: fitting simulated drops to the shared finds (107 on
// 2026-11-07) gives a soft keep-away radius of about 39 tiles. A tile's weight for the next drop
// is h(d) = 1 - exp(-(d / R)^4), with d its distance to the nearest find: ~0 right next to a
// find, ~0.5 at 36 tiles, ~1 from about 55 tiles. Treasures and scrap showed the same spacing
// (no extra treasure-treasure gap), so both count as finds.
//
// Finds are also spread a little more evenly over the ruins than spacing alone explains, so a
// ruin's weight is multiplied by exp(-RUIN_QUOTA * finds already in it) (~10% less per find).
// Fitted on all levels at once (per-ruin chi-square, empty ruins and nearest-neighbour distance);
// the effect is weak, larger values make ruins far more even than observed.
//
// A dug-empty tile (D) only rules out that tile; an empty-area mark (X) rules out its whole 39×39
// area. Neither pushes drops away.
//
// Suggestions are 39×39 searches (the size of an X), picked greedily: each one covers the most
// chance not covered by the ones before it. With a level chosen, a search must stay inside that
// level (tiles off the map are fine), so no part of it is wasted on other levels. Tiles that few
// such searches can reach (corners, narrow strips, pockets between levels) count extra, so they
// get covered now instead of needing an awkward search later.
//
// Distances are diamond-grid steps (Chebyshev distance in iso space), the same metric as the
// 39×39 areas.

/** Marks that push the next drop away. */
export const FIND_CODES: number[] = [MARK_T, MARK_C];
/** Dug, nothing there: only that tile is ruled out. */
export const DUG_CODE = MARK_D;
/** Searched 39×39 area with nothing in it: every tile of the area is ruled out. */
export const EMPTY_AREA_CODE = MARK_X;
/** Fitted keep-away radius (tiles) and sharpness of the weight curve. */
export const KEEP_AWAY = 39;
/** Fitted per-find penalty of a ruin: its weight is multiplied by exp(-RUIN_QUOTA * finds in it). */
export const RUIN_QUOTA = 0.1;
const SHARPNESS = 4;
/** Half-size of a suggested search (39×39, like an X mark). */
export const SEARCH_RADIUS = RANGE_RADIUS;
/** Extra value of a tile that few searches can reach: up to +HARD_BONUS (0..1) for the hardest. */
const HARD_BONUS = 0.5;

export const SUGGEST_COUNT = 5;

export interface Suggestion {
  /** Centre of the 39×39 search: mark it X if nothing turns up. */
  i: number;
  /** Share of the chance (within the chosen level) this search covers, 0..1, after the ones before it. */
  covers: number;
  /** Zone area of the centre. */
  area: number;
  /** Share of the chance that falls in that whole area, 0..1. */
  chance: number;
  /** How far the area reaches away from any find, in tiles. */
  gap: number;
  /** Known marks inside the area, by code (T, C, D, X). */
  found: Record<number, number>;
  /** False when no search fits inside the level here, so this one also covers other levels. */
  inside: boolean;
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

/** Summed-area table of an N×N iso array, (N+1)×(N+1), for O(1) box sums. */
function sat(src: ArrayLike<number>, out: Float64Array) {
  const M = N + 1;
  for (let v = 0; v < N; v++) {
    let row = 0;
    for (let u = 0; u < N; u++) {
      row += src[u + v * N];
      out[u + 1 + (v + 1) * M] = out[u + 1 + v * M] + row;
    }
  }
}

/** Sum over the search box centred on iso cell (u, v), clipped to the grid. */
function box(t: Float64Array, u: number, v: number, r = SEARCH_RADIUS): number {
  const M = N + 1;
  const a0 = Math.max(0, u - r);
  const a1 = Math.min(N, u + r + 1);
  const b0 = Math.max(0, v - r);
  const b1 = Math.min(N, v + r + 1);
  return t[a1 + b1 * M] - t[a0 + b1 * M] - t[a1 + b0 * M] + t[a0 + b0 * M];
}

/** Weight of a tile at distance d from the nearest find. */
const WEIGHT = new Float64Array(256);
for (let d = 0; d < 256; d++) WEIGHT[d] = 1 - Math.exp(-Math.pow(d / KEEP_AWAY, SHARPNESS));
const weightAt = (d: number) => (d < 256 ? WEIGHT[d] : 1);

/** The best 39×39 searches in one level (0 = any), in order, plus the weight map. */
export function computeSuggestions(marks: Uint8Array, marked: Iterable<number>, level: number, count = SUGGEST_COUNT): SuggestionResult {
  const heat = new Uint8Array(N * N);
  // distance to the nearest find
  const toFind = new Int32Array(N * N).fill(INF);
  const found = new Map<number, Record<number, number>>();
  // tiles known to be empty: D tiles and every tile of an X area
  const empty = new Uint8Array(N * N);
  let finds = 0;
  for (const i of marked) {
    const m = marks[i];
    if (FIND_CODES.includes(m)) {
      toFind[TILE_ISO[i]] = 0;
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
  transform(toFind);

  const factor = new Float64Array(256);
  for (let a = 0; a < 256; a++) {
    const f = found.get(a);
    let k = 0;
    if (f) for (const c of FIND_CODES) k += f[c] ?? 0;
    factor[a] = Math.exp(-RUIN_QUOTA * k);
  }

  // weight per iso cell (chosen level only), per-area totals
  const wt = new Float64Array(N * N);
  const other = new Uint8Array(N * N); // map tile of another level
  const acc = new Map<number, { mass: number; gap: number }>();
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    const p = TILE_ISO[i];
    if (level && zoneLevel[i] !== level) {
      other[p] = 1;
      continue;
    }
    const a = zoneArea[i];
    const df = toFind[p];
    const w = empty[p] ? 0 : weightAt(df) * factor[a];
    wt[p] = w;
    heat[p] = Math.round(w * 255);
    total += w;
    let b = acc.get(a);
    if (!b) acc.set(a, (b = { mass: 0, gap: 0 }));
    b.mass += w;
    if (df > b.gap) b.gap = df;
  }
  if (!total) return { list: [], heat };

  // where a search may be centred: a tile of the level whose box holds no other level
  const T = new Float64Array((N + 1) * (N + 1));
  sat(other, T);
  const centre = new Uint8Array(N * N); // 1 = allowed, 2 = in the level but spills over
  for (let p = 0; p < N * N; p++) {
    const t = ISO_TILE[p];
    if (t < 0 || other[p] || !areaLevel[zoneArea[t]]) continue;
    centre[p] = level && box(T, p % N, (p / N) | 0) > 0 ? 2 : 1;
  }
  // how many allowed searches reach each tile; few = hard to reach, worth more now
  const ok = new Uint8Array(N * N);
  for (let p = 0; p < N * N; p++) ok[p] = centre[p] === 1 ? 1 : 0;
  sat(ok, T);
  const full = (2 * SEARCH_RADIUS + 1) ** 2;
  const value = new Float64Array(N * N);
  for (let p = 0; p < N * N; p++) {
    if (!wt[p]) continue;
    const reach = box(T, p % N, (p / N) | 0);
    value[p] = wt[p] * (1 + HARD_BONUS * (1 - Math.min(1, reach / full)));
  }

  const W = new Float64Array((N + 1) * (N + 1));
  const list: Suggestion[] = [];
  for (let n = 0; n < count; n++) {
    sat(value, T);
    let best = -1;
    let bestScore = 0;
    let spill = -1;
    let spillScore = 0;
    for (let p = 0; p < N * N; p++) {
      const c = centre[p];
      if (!c) continue;
      const s = box(T, p % N, (p / N) | 0);
      if (c === 1 ? s > bestScore : s > spillScore) {
        if (c === 1) (best = p), (bestScore = s);
        else (spill = p), (spillScore = s);
      }
    }
    const inside = best >= 0;
    const p = inside ? best : spill;
    if (p < 0) break;
    sat(wt, W);
    const u = p % N;
    const v = (p - u) / N;
    const covers = box(W, u, v) / total;
    const i = ISO_TILE[p];
    const area = zoneArea[i];
    const a = acc.get(area);
    list.push({ i, covers, area, chance: a ? a.mass / total : 0, gap: a?.gap ?? 0, found: found.get(area) ?? {}, inside });
    // later searches only count what this one leaves
    for (let b = Math.max(0, v - SEARCH_RADIUS); b <= Math.min(N - 1, v + SEARCH_RADIUS); b++) {
      for (let x = Math.max(0, u - SEARCH_RADIUS); x <= Math.min(N - 1, u + SEARCH_RADIUS); x++) {
        wt[x + b * N] = 0;
        value[x + b * N] = 0;
      }
    }
  }
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
