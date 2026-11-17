import { COLS, ROWS, TILE_COUNT, isTile } from './coords';
import { AREA_STEPS, MARK_C, MARK_D, MARK_T, MARK_X } from './marks';
import { ISO_SIZE, ISO_TILE, TILE_ISO, areaTiles } from './grid';
import { areaLevel, zoneArea, zoneLevel } from './zones';

// "Where to search next" as a small probability model.
//
// Distances between finds are max(|ΔX|, |ΔY|): the spacing of the shared finds fits that better
// than a diamond distance. Areas and searches are the game's 39×39 diamond (see marks.ts).
//
// Finds keep away from each other: fitting simulated drops to the shared finds (107 of
// 2026-11-07) gives a keep-away radius of about 33 tiles with a steep edge. A tile's weight for the
// next drop is h(d) = 1 - exp(-(d / 33)^8), with d its distance to the nearest find: ~0 within 22
// tiles, ~0.5 at 31, ~1 from 40. That matches the observed gaps (median 41, 10% under 31), which
// a softer curve could not. Treasures and scrap showed the same spacing, so both count as finds.
//
// Finds are also spread a little more evenly over the ruins than spacing alone explains, so a
// ruin's weight is multiplied by exp(-RUIN_QUOTA * finds already in it), ~14% less per find. All
// three values are fitted together on all levels (per-ruin chi-square, empty ruins, median and
// 10th-percentile nearest-neighbour distance).
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

/** Marks that push the next drop away. */
export const FIND_CODES: number[] = [MARK_T, MARK_C];
/** Dug, nothing there: only that tile is ruled out. */
export const DUG_CODE = MARK_D;
/** Searched 39×39 area with nothing in it: every tile of the area is ruled out. */
export const EMPTY_AREA_CODE = MARK_X;
/** Fitted keep-away radius (tiles, max(|ΔX|, |ΔY|)) and sharpness of the weight curve. */
export const KEEP_AWAY = 33;
/** Fitted per-find penalty of a ruin: its weight is multiplied by exp(-RUIN_QUOTA * finds in it). */
export const RUIN_QUOTA = 0.15;
const SHARPNESS = 8;
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
  /** Weight 0..255 per tile index for the chosen level; 0 elsewhere. */
  heat: Uint8Array;
}

const W = COLS;
const H = ROWS;
const INF = 1 << 20;

/** Two-pass distance transform over the X/Y grid; with all 8 neighbours at cost 1 it is exact for max(|ΔX|, |ΔY|). */
export function chebyshevTransform(dist: Int32Array) {
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const p = c + r * W;
      let d = dist[p];
      if (!d) continue;
      if (c > 0) d = Math.min(d, dist[p - 1] + 1);
      if (r > 0) {
        d = Math.min(d, dist[p - W] + 1);
        if (c > 0) d = Math.min(d, dist[p - W - 1] + 1);
        if (c < W - 1) d = Math.min(d, dist[p - W + 1] + 1);
      }
      dist[p] = d;
    }
  }
  for (let r = H - 1; r >= 0; r--) {
    for (let c = W - 1; c >= 0; c--) {
      const p = c + r * W;
      let d = dist[p];
      if (!d) continue;
      if (c < W - 1) d = Math.min(d, dist[p + 1] + 1);
      if (r < H - 1) {
        d = Math.min(d, dist[p + W] + 1);
        if (c < W - 1) d = Math.min(d, dist[p + W + 1] + 1);
        if (c > 0) d = Math.min(d, dist[p + W - 1] + 1);
      }
      dist[p] = d;
    }
  }
}

// Sums over a search use the iso grid (see grid.ts), where an area is a square of 2·steps+1 cells
// without its 4 corner cells, so a summed-area table gives each one in O(1).
const N = ISO_SIZE;
const K = AREA_STEPS;

/** Summed-area table of an N×N iso array, (N+1)×(N+1). */
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

/** Sum of src over the area centred on iso cell (u, v): the square from the table minus the 4 corner cells. */
function areaSum(t: Float64Array, src: ArrayLike<number>, u: number, v: number): number {
  const M = N + 1;
  const a0 = Math.max(0, u - K);
  const a1 = Math.min(N, u + K + 1);
  const b0 = Math.max(0, v - K);
  const b1 = Math.min(N, v + K + 1);
  let s = t[a1 + b1 * M] - t[a0 + b1 * M] - t[a1 + b0 * M] + t[a0 + b0 * M];
  for (const du of [-K, K]) {
    for (const dv of [-K, K]) {
      const a = u + du;
      const b = v + dv;
      if (a >= 0 && a < N && b >= 0 && b < N) s -= src[a + b * N];
    }
  }
  return s;
}

/** dst = max of src over the square of radius rad around each iso cell (rows, then columns; monotone deque). */
function slidingMax(src: Float64Array, dst: Float64Array, tmp: Float64Array, rad: number) {
  const q = new Int32Array(N);
  const pass = (from: Float64Array, to: Float64Array, stride: number, step: number) => {
    for (let line = 0; line < N; line++) {
      const base = line * stride;
      let h = 0;
      let t = 0;
      for (let k = 0; k < N + rad; k++) {
        if (k < N) {
          const x = from[base + k * step];
          while (t > h && from[base + q[t - 1] * step] <= x) t--;
          q[t++] = k;
        }
        const c = k - rad;
        if (c < 0) continue;
        while (q[h] < c - rad) h++;
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

/** Tiles in a full search (the area: 21 × 21 diagonal tiles without the 4 tips = 437). */
const FULL = (2 * K + 1) ** 2 - 4;

/** The best 39×39 searches in one level (0 = any), in order, plus the weight map. */
export function computeSuggestions(marks: Uint8Array, marked: Iterable<number>, level: number, count = SUGGEST_COUNT): SuggestionResult {
  const heat = new Uint8Array(TILE_COUNT);
  // distance to the nearest find, max(|ΔX|, |ΔY|), on the X/Y grid
  const toFind = new Int32Array(TILE_COUNT).fill(INF);
  const found = new Map<number, Record<number, number>>();
  // tiles known to be empty: D tiles and every tile of an X area
  const empty = new Uint8Array(TILE_COUNT);
  let finds = 0;
  for (const i of marked) {
    if (!isTile(i)) continue;
    const m = marks[i];
    if (FIND_CODES.includes(m)) {
      toFind[i] = 0;
      finds++;
    } else if (m === DUG_CODE) {
      empty[i] = 1;
    } else if (m === EMPTY_AREA_CODE) {
      for (const j of areaTiles(i, K)) empty[j] = 1;
    } else continue;
    const f = found.get(zoneArea[i]) ?? {};
    f[m] = (f[m] ?? 0) + 1;
    found.set(zoneArea[i], f);
  }
  if (!finds) return { list: [], heat };
  chebyshevTransform(toFind);

  const factor = new Float64Array(256);
  for (let a = 0; a < 256; a++) {
    const f = found.get(a);
    let k = 0;
    if (f) for (const c of FIND_CODES) k += f[c] ?? 0;
    factor[a] = Math.exp(-RUIN_QUOTA * k);
  }

  // weight per tile (chosen level only) in iso cells, per-area totals
  const wt = new Float64Array(N * N);
  const other = new Uint8Array(N * N); // tile of another level
  const acc = new Map<number, { mass: number; gap: number }>();
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!isTile(i)) continue;
    const p = TILE_ISO[i];
    if (level && zoneLevel[i] !== level) {
      other[p] = 1;
      continue;
    }
    const a = zoneArea[i];
    const df = toFind[i];
    const w = empty[i] ? 0 : weightAt(df) * factor[a];
    wt[p] = w;
    heat[i] = Math.round(w * 255);
    total += w;
    let b = acc.get(a);
    if (!b) acc.set(a, (b = { mass: 0, gap: 0 }));
    b.mass += w;
    if (df > b.gap) b.gap = df;
  }
  if (!total) return { list: [], heat };

  // where a search may be centred: a tile of the level; spill = its area's tiles on other levels
  const T = new Float64Array((N + 1) * (N + 1));
  sat(other, T);
  const spillOf = new Int32Array(N * N).fill(-1); // per iso cell; -1 = not a centre
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!isTile(i) || !areaLevel[zoneArea[i]]) continue;
    const p = TILE_ISO[i];
    if (other[p]) continue;
    const u = p % N;
    spillOf[p] = level ? areaSum(T, other, u, (p - u) / N) : 0;
  }

  const S = new Float64Array((N + 1) * (N + 1));
  const yieldOf = new Float64Array(N * N); // what the search centred here would cover
  const bestCover = new Float64Array(N * N); // best search that covers this tile (square around it)
  const tmp = new Float64Array(N * N);
  const value = new Float64Array(N * N);
  const allowed = (sp: number) => sp >= 0 && sp <= MAX_SPILL * FULL;
  const list: Suggestion[] = [];
  for (let n = 0; n < count; n++) {
    // a tile whose best possible search is poor (a strip along a border, a corridor between
    // searched areas, a corner) would need a wasteful search later: it counts extra now
    sat(wt, S);
    let top = 0;
    for (let p = 0; p < N * N; p++) {
      const sp = spillOf[p];
      let y = 0;
      if (allowed(sp)) {
        const u = p % N;
        y = Math.max(0, areaSum(S, wt, u, (p - u) / N) - SPILL_COST * sp);
      }
      yieldOf[p] = y;
      if (y > top) top = y;
    }
    if (!top) break;
    slidingMax(yieldOf, bestCover, tmp, K);
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
      const u = p % N;
      const sc = areaSum(T, value, u, (p - u) / N) - SPILL_COST * sp;
      if (allowed(sp) && sc > bestScore) (best = p), (bestScore = sc);
      if (sc > anyScore) (any = p), (anyScore = sc);
    }
    const p = best >= 0 ? best : any;
    if (p < 0) break;
    const u = p % N;
    const covers = areaSum(S, wt, u, (p - u) / N) / total;
    const i = ISO_TILE[p];
    const area = zoneArea[i];
    const a = acc.get(area);
    list.push({ i, covers, area, chance: a ? a.mass / total : 0, gap: a?.gap ?? 0, found: found.get(area) ?? {}, spill: spillOf[p] / FULL });
    // later searches only count what this one leaves
    for (const j of areaTiles(i, K)) wt[TILE_ISO[j]] = 0;
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
