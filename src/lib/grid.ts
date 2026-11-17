import { COLS, ROWS, TILE_COUNT, isTile } from './coords';

// Tile geometry, as in the game. Only X:Y with an even X + Y are tiles (see coords.ts). A tile is
// a diamond 2 world units wide and 1 tall centred on (col + 0.5, row / 2 + 0.25): X runs straight
// to the right one unit per step, Y straight down half a unit per step. So 5:11 sits above 4:12
// and 6:12, which sit above 5:13, and the 507 x 1019 map stays square (about 508 x 510 units).
//
// Turned by 45°, the diamonds form a plain square grid ("iso" coordinates): a = (col + row) / 2
// grows towards the lower right (X+1, Y+1), b = (row - col) / 2 + H towards the lower left
// (X-1, Y+1). Textures are built in that grid at one pixel per tile and drawn with a transform
// that turns each pixel into a 2:1 diamond on screen.

/** Half the column range: keeps b >= 0. */
const H = (COLS - 1) >> 1; // 253

/** Side of the iso grid (some cells are outside the map). */
export const ISO_SIZE = ((COLS - 1 + ROWS - 1) >> 1) + 1; // 763

/** Bounding box of the map in world units (edge tiles included whole). */
export const MAP_X0 = -0.5;
export const MAP_X1 = COLS + 0.5;
export const MAP_Y0 = -0.25;
export const MAP_Y1 = (ROWS - 1) / 2 + 0.75;

/** Half-width and half-height of a tile in world units. */
export const TILE_HW = 1;
export const TILE_HH = 0.5;

let outline: Path2D | null = null;

/** Zigzag outline of the map in world units, following the outer edges of the edge tiles. */
export function mapOutline(): Path2D {
  if (outline) return outline;
  const p = new Path2D();
  const last = ROWS - 1;
  // top: tiles of row 0 sit in the even columns, the odd columns start a row lower
  p.moveTo(centerX(0) - TILE_HW, centerY(0));
  for (let c = 0; c < COLS; c++) p.lineTo(centerX(c), c & 1 ? centerY(0) : centerY(0) - TILE_HH);
  p.lineTo(centerX(COLS - 1) + (((COLS - 1) & 1) ? 0 : TILE_HW), centerY(((COLS - 1) & 1) ? 1 : 0));
  // right: the last column on even rows when it is even, else on odd rows
  for (let r = 0; r <= last; r++) {
    const c = ((COLS - 1 + r) & 1) === 0 ? COLS - 1 : COLS - 2;
    p.lineTo(centerX(c) + TILE_HW, centerY(r));
  }
  // bottom
  for (let c = COLS - 1; c >= 0; c--) p.lineTo(centerX(c), ((c + last) & 1) === 0 ? centerY(last) + TILE_HH : centerY(last));
  // left: column 0 on even rows, column 1 on odd rows
  for (let r = last; r >= 0; r--) p.lineTo(centerX(r & 1) - TILE_HW, centerY(r));
  p.closePath();
  outline = p;
  return p;
}

/** Iso cell of a tile (col, row); only meaningful when col + row is even. */
export function isoA(c: number, r: number): number {
  return (c + r) >> 1;
}

export function isoB(c: number, r: number): number {
  return ((r - c) >> 1) + H;
}

/** Tile index at iso cell (a, b), or -1 outside the map. */
export function fromIso(a: number, b: number): number {
  const r = a + b - H;
  const c = a - b + H;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1;
  return r * COLS + c;
}

/** Iso pixel of a tile that does not exist in the game: past the end, so typed-array writes are no-ops. */
export const NO_ISO = ISO_SIZE * ISO_SIZE;

/** iso pixel (a + b * ISO_SIZE) of every tile (NO_ISO for non-tiles), and the tile of every iso pixel (-1 = none). */
export const TILE_ISO = new Uint32Array(TILE_COUNT).fill(NO_ISO);
export const ISO_TILE = new Int32Array(ISO_SIZE * ISO_SIZE).fill(-1);
for (let i = 0; i < TILE_COUNT; i++) {
  if (!isTile(i)) continue;
  const c = i % COLS;
  const r = (i - c) / COLS;
  const p = isoA(c, r) + isoB(c, r) * ISO_SIZE;
  TILE_ISO[i] = p;
  ISO_TILE[p] = i;
}

/** Centre of a tile in world units. */
export function centerX(c: number): number {
  return c + 0.5;
}

export function centerY(r: number): number {
  return r * 0.5 + 0.25;
}

export function tileCenter(i: number): [number, number] {
  const c = i % COLS;
  const r = (i - c) / COLS;
  return [centerX(c), centerY(r)];
}

/** World point -> continuous iso coordinates (cell (a, b) covers [a, a+1) x [b, b+1)). */
export function worldToIso(wx: number, wy: number): [number, number] {
  return [wx / 2 + wy, wy - wx / 2 + H + 0.5];
}

/**
 * Canvas transform from iso cells to CSS px for a view with world origin (ox, oy) and `scale` px
 * per world unit: x = ox + scale * (a - b + H + 0.5), y = oy + scale * ((a + b - H) / 2 - 0.25).
 */
export function isoMatrix(scale: number, ox: number, oy: number): [number, number, number, number, number, number] {
  return [scale, scale / 2, -scale, scale / 2, ox + scale * (H + 0.5), oy - scale * (H / 2 + 0.25)];
}

/** One CSS px as a line width in iso units (the transform stretches by sqrt(1.25) * scale across a cell edge). */
export function isoPx(scale: number): number {
  return Math.sqrt(1.25) / scale;
}

export function tileAtWorld(wx: number, wy: number): number {
  const [pu, pv] = worldToIso(wx, wy);
  if (pu < 0 || pv < 0) return -1;
  return fromIso(Math.floor(pu), Math.floor(pv));
}

/** Tiles of the diamond (2·radius+1 tiles along each side) centred on tile i, cut at the map edge. */
export function diamondTiles(i: number, radius: number): number[] {
  const p = TILE_ISO[i];
  if (p === NO_ISO) return [];
  const u = p % ISO_SIZE;
  const v = (p - u) / ISO_SIZE;
  const out: number[] = [];
  for (let dv = -radius; dv <= radius; dv++) {
    for (let du = -radius; du <= radius; du++) {
      const j = fromIso(u + du, v + dv);
      if (j >= 0) out.push(j);
    }
  }
  return out;
}

/** Tiles of the (2·radius+1) × (2·radius+1) box of X and Y values around tile i (the game's 39×39 areas), cut at the map edge. */
export function boxTiles(i: number, radius: number): number[] {
  const c = i % COLS;
  const r = (i - c) / COLS;
  const out: number[] = [];
  for (let rr = Math.max(0, r - radius); rr <= Math.min(ROWS - 1, r + radius); rr++) {
    for (let cc = Math.max(0, c - radius); cc <= Math.min(COLS - 1, c + radius); cc++) {
      if (((cc + rr) & 1) === 0) out.push(rr * COLS + cc);
    }
  }
  return out;
}
