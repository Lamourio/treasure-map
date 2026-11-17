import { COLS, ROWS, TILE_COUNT, isTile } from './coords';
import { MARK_C, MARK_D, MARK_T, MARK_X, RANGE_RADIUS } from './marks';
import { areaLevel, zoneArea, zoneLevel } from './zones';

// "Where to search next" as a small probability model.
//
// Distances are counted the way the game's 39×39 areas are: max(|ΔX|, |ΔY|), so an area is every
// tile within 19 of its centre. All work happens on the plain X/Y grid (one cell per coordinate
// pair, the tile index); pairs that are not tiles (X + Y odd) carry no weight.
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

/** Summed-area table of a W×H grid, (W+1)×(H+1), for O(1) box sums. */
function sat(src: ArrayLike<number>, out: Float64Array) {
  const M = W + 1;
  for (let r = 0; r < H; r++) {
    let row = 0;
    for (let c = 0; c < W; c++) {
      row += src[c + r * W];
      out[c + 1 + (r + 1) * M] = out[c + 1 + r * M] + row;
    }
  }
}

/** Sum over the search box centred on cell (c, r), clipped to the grid. */
function box(t: Float64Array, c: number, r: number, rad = SEARCH_RADIUS): number {
  const M = W + 1;
  const a0 = Math.max(0, c - rad);
  const a1 = Math.min(W, c + rad + 1);
  const b0 = Math.max(0, r - rad);
  const b1 = Math.min(H, r + rad + 1);
  return t[a1 + b1 * M] - t[a0 + b1 * M] - t[a1 + b0 * M] + t[a0 + b0 * M];
}

/** dst = max of src over the box of radius rad around each cell (rows, then columns; monotone deque). */
function slidingMax(src: Float64Array, dst: Float64Array, tmp: Float64Array, rad: number) {
  const q = new Int32Array(Math.max(W, H));
  const pass = (from: Float64Array, to: Float64Array, lines: number, len: number, stride: number, step: number) => {
    for (let line = 0; line < lines; line++) {
      const base = line * stride;
      let h = 0;
      let t = 0;
      for (let k = 0; k < len + rad; k++) {
        if (k < len) {
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
  pass(src, tmp, H, W, W, 1); // along rows
  pass(tmp, dst, W, H, 1, W); // along columns
}

/** Weight of a tile at distance d from the nearest find. */
const WEIGHT = new Float64Array(256);
for (let d = 0; d < 256; d++) WEIGHT[d] = 1 - Math.exp(-Math.pow(d / KEEP_AWAY, SHARPNESS));
const weightAt = (d: number) => (d < 256 ? WEIGHT[d] : 1);

/** Real tiles in a full search box (a 39×39 box of coordinates holds 761 tiles around a tile). */
const FULL = (() => {
  let n = 0;
  for (let dr = -SEARCH_RADIUS; dr <= SEARCH_RADIUS; dr++) for (let dc = -SEARCH_RADIUS; dc <= SEARCH_RADIUS; dc++) if (!((dc + dr) & 1)) n++;
  return n;
})();

/** The best 39×39 searches in one level (0 = any), in order, plus the weight map. */
export function computeSuggestions(marks: Uint8Array, marked: Iterable<number>, level: number, count = SUGGEST_COUNT): SuggestionResult {
  const heat = new Uint8Array(TILE_COUNT);
  // distance to the nearest find
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
      const c = i % W;
      const r = (i - c) / W;
      for (let b = Math.max(0, r - RANGE_RADIUS); b <= Math.min(H - 1, r + RANGE_RADIUS); b++) {
        empty.fill(1, b * W + Math.max(0, c - RANGE_RADIUS), b * W + Math.min(W - 1, c + RANGE_RADIUS) + 1);
      }
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

  // weight per tile (chosen level only), per-area totals
  const wt = new Float64Array(TILE_COUNT);
  const other = new Uint8Array(TILE_COUNT); // tile of another level
  const acc = new Map<number, { mass: number; gap: number }>();
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!isTile(i)) continue;
    if (level && zoneLevel[i] !== level) {
      other[i] = 1;
      continue;
    }
    const a = zoneArea[i];
    const df = toFind[i];
    const w = empty[i] ? 0 : weightAt(df) * factor[a];
    wt[i] = w;
    heat[i] = Math.round(w * 255);
    total += w;
    let b = acc.get(a);
    if (!b) acc.set(a, (b = { mass: 0, gap: 0 }));
    b.mass += w;
    if (df > b.gap) b.gap = df;
  }
  if (!total) return { list: [], heat };

  // where a search may be centred: a tile of the level; spill = its box's tiles on other levels
  const T = new Float64Array((W + 1) * (H + 1));
  sat(other, T);
  const spillOf = new Int32Array(TILE_COUNT).fill(-1); // -1 = not a centre
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!isTile(i) || other[i] || !areaLevel[zoneArea[i]]) continue;
    const c = i % W;
    spillOf[i] = level ? box(T, c, (i - c) / W) : 0;
  }

  const S = new Float64Array((W + 1) * (H + 1));
  const yieldOf = new Float64Array(TILE_COUNT); // what the search centred here would cover
  const bestCover = new Float64Array(TILE_COUNT); // best search that covers this tile
  const tmp = new Float64Array(TILE_COUNT);
  const value = new Float64Array(TILE_COUNT);
  const allowed = (sp: number) => sp >= 0 && sp <= MAX_SPILL * FULL;
  const list: Suggestion[] = [];
  for (let n = 0; n < count; n++) {
    // a tile whose best possible search is poor (a strip along a border, a corridor between
    // searched areas, a corner) would need a wasteful search later: it counts extra now
    sat(wt, S);
    let top = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      const sp = spillOf[i];
      let y = 0;
      if (allowed(sp)) {
        const c = i % W;
        y = Math.max(0, box(S, c, (i - c) / W) - SPILL_COST * sp);
      }
      yieldOf[i] = y;
      if (y > top) top = y;
    }
    if (!top) break;
    slidingMax(yieldOf, bestCover, tmp, SEARCH_RADIUS);
    for (let i = 0; i < TILE_COUNT; i++) value[i] = wt[i] ? wt[i] * (1 + HARD_BONUS * (1 - bestCover[i] / top)) : 0;
    sat(value, T);
    // best search within the spill limit; if none fits, the least bad one anywhere in the level
    let best = -1;
    let bestScore = 0;
    let any = -1;
    let anyScore = -Infinity;
    for (let i = 0; i < TILE_COUNT; i++) {
      const sp = spillOf[i];
      if (sp < 0) continue;
      const c = i % W;
      const sc = box(T, c, (i - c) / W) - SPILL_COST * sp;
      if (allowed(sp) && sc > bestScore) (best = i), (bestScore = sc);
      if (sc > anyScore) (any = i), (anyScore = sc);
    }
    const i = best >= 0 ? best : any;
    if (i < 0) break;
    const c = i % W;
    const r = (i - c) / W;
    const covers = box(S, c, r) / total;
    const area = zoneArea[i];
    const a = acc.get(area);
    list.push({ i, covers, area, chance: a ? a.mass / total : 0, gap: a?.gap ?? 0, found: found.get(area) ?? {}, spill: spillOf[i] / FULL });
    // later searches only count what this one leaves
    for (let b = Math.max(0, r - SEARCH_RADIUS); b <= Math.min(H - 1, r + SEARCH_RADIUS); b++) {
      wt.fill(0, b * W + Math.max(0, c - SEARCH_RADIUS), b * W + Math.min(W - 1, c + SEARCH_RADIUS) + 1);
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
