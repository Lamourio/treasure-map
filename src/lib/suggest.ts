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
// chance not covered by the ones before it. With a level chosen, a search should stay inside that
// level (tiles off the map are fine): each tile it spends on another level costs SPILL_COST of a
// likely tile, and at most MAX_SPILL of it may spill. So a search only pushes over the border
// when that picks up a strip along it, instead of leaving the strip for an awkward search later.
// For the same reason a tile counts extra when even the best search that could cover it would
// cover little (a strip along a border, a corridor between searched areas, a corner); this is
// recomputed after each pick, so slivers one search leaves pull the next one towards them.
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
/** Extra value of a tile whose best possible search is poor: up to +HARD_BONUS for the worst. */
const HARD_BONUS = 1;
/** Cost of a searched tile of another level, against a likely tile (1). */
const SPILL_COST = 0.25;
/** Most of a search that may land on other levels. */
const MAX_SPILL = 0.25;

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
  /** Share of the search on other levels' tiles, 0..1 (0 = fully inside the chosen level). */
  spill: number;
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

/** dst = max of src over the box of radius r around each cell (rows, then columns; monotone deque). */
function slidingMax(src: Float64Array, dst: Float64Array, tmp: Float64Array, r: number) {
  const q = new Int32Array(N);
  const pass = (from: Float64Array, to: Float64Array, stride: number, step: number) => {
    for (let line = 0; line < N; line++) {
      const base = line * stride;
      let h = 0;
      let t = 0;
      for (let k = 0; k < N + r; k++) {
        if (k < N) {
          const x = from[base + k * step];
          while (t > h && from[base + q[t - 1] * step] <= x) t--;
          q[t++] = k;
        }
        const c = k - r;
        if (c < 0) continue;
        while (q[h] < c - r) h++;
        to[base + c * step] = from[base + q[h] * step];
      }
    }
  };
  pass(src, tmp, N, 1);
  pass(tmp, dst, 1, N);
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

  // where a search may be centred: a tile of the level; spill = its box's tiles on other levels
  const full = (2 * SEARCH_RADIUS + 1) ** 2;
  const T = new Float64Array((N + 1) * (N + 1));
  sat(other, T);
  const spillOf = new Int32Array(N * N).fill(-1); // -1 = not a centre
  for (let p = 0; p < N * N; p++) {
    const t = ISO_TILE[p];
    if (t < 0 || other[p] || !areaLevel[zoneArea[t]]) continue;
    spillOf[p] = level ? box(T, p % N, (p / N) | 0) : 0;
  }
  const W = new Float64Array((N + 1) * (N + 1));
  const yieldOf = new Float64Array(N * N); // what the search centred here would cover
  const bestCover = new Float64Array(N * N); // best search that covers this tile
  const tmp = new Float64Array(N * N);
  const value = new Float64Array(N * N);
  const allowed = (sp: number) => sp >= 0 && sp <= MAX_SPILL * full;
  const list: Suggestion[] = [];
  for (let n = 0; n < count; n++) {
    // a tile whose best possible search is poor (a strip along a border, a corridor between
    // searched areas, a corner) would need a wasteful search later: it counts extra now
    sat(wt, W);
    let top = 0;
    for (let p = 0; p < N * N; p++) {
      const sp = spillOf[p];
      const y = allowed(sp) ? Math.max(0, box(W, p % N, (p / N) | 0) - SPILL_COST * sp) : 0;
      yieldOf[p] = y;
      if (y > top) top = y;
    }
    if (!top) break;
    slidingMax(yieldOf, bestCover, tmp, SEARCH_RADIUS);
    for (let p = 0; p < N * N; p++) value[p] = wt[p] ? wt[p] * (1 + HARD_BONUS * (1 - bestCover[p] / top)) : 0;
    sat(value, T);
    // best search within the spill limit; if none fits, the least bad one anywhere in the level
    let best = -1;
    let bestScore = 0;
    let any = -1;
    let anyScore = -Infinity;
    for (let p = 0; p < N * N; p++) {
      const sp = spillOf[p];
      if (sp < 0) continue;
      const sc = box(T, p % N, (p / N) | 0) - SPILL_COST * sp;
      if (allowed(sp) && sc > bestScore) (best = p), (bestScore = sc);
      if (sc > anyScore) (any = p), (anyScore = sc);
    }
    const p = best >= 0 ? best : any;
    if (p < 0) break;
    const u = p % N;
    const v = (p - u) / N;
    const covers = box(W, u, v) / total;
    const i = ISO_TILE[p];
    const area = zoneArea[i];
    const a = acc.get(area);
    list.push({ i, covers, area, chance: a ? a.mass / total : 0, gap: a?.gap ?? 0, found: found.get(area) ?? {}, spill: spillOf[p] / full });
    // later searches only count what this one leaves
    for (let b = Math.max(0, v - SEARCH_RADIUS); b <= Math.min(N - 1, v + SEARCH_RADIUS); b++) {
      for (let x = Math.max(0, u - SEARCH_RADIUS); x <= Math.min(N - 1, u + SEARCH_RADIUS); x++) {
        wt[x + b * N] = 0;
      }
    }
  }
  return { list, heat };
}

let cacheKey = '';
let cacheLevel = -1;
let cache: SuggestionResult = { list: [], heat: new Uint8Array(0) };

/**
 * Cached suggestions; recomputed only when the marks or the level change. While `busy` (a brush
 * stroke in progress) the last result is kept, and it is recomputed once the stroke ends.
 */
export function getSuggestions(marks: Uint8Array, marked: Iterable<number>, marksRevision: number, level: number, busy = false): SuggestionResult {
  const key = `${marksRevision}|${level}`;
  if (busy && cacheLevel === level) return cache;
  if (key !== cacheKey) {
    cacheKey = key;
    cacheLevel = level;
    cache = computeSuggestions(marks, marked, level);
  }
  return cache;
}
