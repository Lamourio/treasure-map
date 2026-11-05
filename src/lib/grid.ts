import { COLS, ROWS, TILE_COUNT } from './coords';

// Tile geometry. Tiles are diamonds in staggered rows: rows with an even game Y (odd internal
// row) sit half a tile to the right, so the lower-right neighbour of 100:200 is 101:201 and the
// one of 101:201 is 101:202. In world units a diamond is 1 wide and 1 tall and rows are 0.5
// apart, so the 507 x 1019 map stays square.
//
// Turned by 45°, the diamonds form a plain square grid ("iso" coordinates): u grows towards the
// lower right, v towards the lower left. Textures are built in that grid at one pixel per tile
// and drawn with a rotating transform, so each pixel shows up as a diamond on screen.

/** Side of the iso grid (some cells are outside the map). */
export const ISO_SIZE = COLS + (ROWS >> 1);

/** Bounding box of the map in world units (edge tiles included whole). */
export const MAP_X0 = 0;
export const MAP_X1 = COLS + 0.5;
export const MAP_Y0 = -0.25;
export const MAP_Y1 = (ROWS - 1) / 2 + 0.75;

let outline: Path2D | null = null;

/** Zigzag outline of the map in world units, following the outer edges of the edge tiles. */
export function mapOutline(): Path2D {
  if (outline) return outline;
  const p = new Path2D();
  const last = ROWS - 1;
  p.moveTo(0, centerY(0));
  for (let c = 0; c < COLS; c++) {
    p.lineTo(c + 0.5, centerY(0) - 0.5); // top vertices of the first row (not shifted)
    p.lineTo(c + 1, centerY(0));
  }
  for (let r = 1; r <= last; r++) p.lineTo(r & 1 ? COLS + 0.5 : COLS, centerY(r)); // right vertices
  const shift = (last & 1) * 0.5;
  for (let c = COLS - 1; c >= 0; c--) {
    p.lineTo(c + 0.5 + shift, centerY(last) + 0.5); // bottom vertices of the last row
    p.lineTo(c + shift, centerY(last));
  }
  for (let r = last - 1; r >= 1; r--) p.lineTo(r & 1 ? 0.5 : 0, centerY(r)); // left vertices
  p.closePath();
  outline = p;
  return p;
}

export function isoU(c: number, r: number): number {
  return c + ((r + 1) >> 1);
}

export function isoV(c: number, r: number): number {
  return (r >> 1) - c + COLS - 1;
}

/** Tile index at iso cell (u, v), or -1 outside the map. */
export function fromIso(u: number, v: number): number {
  const r = u + v - (COLS - 1);
  if (r < 0 || r >= ROWS) return -1;
  const c = u - ((r + 1) >> 1);
  if (c < 0 || c >= COLS) return -1;
  return r * COLS + c;
}

/** iso pixel (u + v * ISO_SIZE) of every tile, and the tile of every iso pixel (-1 = none). */
export const TILE_ISO = new Uint32Array(TILE_COUNT);
export const ISO_TILE = new Int32Array(ISO_SIZE * ISO_SIZE).fill(-1);
for (let i = 0; i < TILE_COUNT; i++) {
  const c = i % COLS;
  const r = (i - c) / COLS;
  const p = isoU(c, r) + isoV(c, r) * ISO_SIZE;
  TILE_ISO[i] = p;
  ISO_TILE[p] = i;
}

/** Centre of a tile in world units. */
export function centerX(c: number, r: number): number {
  return c + 0.5 + (r & 1) * 0.5;
}

export function centerY(r: number): number {
  return r * 0.5 + 0.25;
}

export function tileCenter(i: number): [number, number] {
  const c = i % COLS;
  const r = (i - c) / COLS;
  return [centerX(c, r), centerY(r)];
}

/** World point -> continuous iso coordinates (cell (u, v) covers [u, u+1) x [v, v+1)). */
export function worldToIso(wx: number, wy: number): [number, number] {
  return [wx + wy - 0.25, wy - wx + COLS - 0.25];
}

export function tileAtWorld(wx: number, wy: number): number {
  const [pu, pv] = worldToIso(wx, wy);
  if (pu < 0 || pv < 0) return -1;
  return fromIso(Math.floor(pu), Math.floor(pv));
}

/** Tiles of the (2·radius+1)-wide diamond centred on tile i, cut at the map edge. */
export function diamondTiles(i: number, radius: number): number[] {
  const p = TILE_ISO[i];
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
