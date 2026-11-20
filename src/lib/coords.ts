// Game coordinates: X 3..509 (left to right), Y 3..1021 (top to bottom). Only pairs with an even
// X + Y are tiles: the game's diamonds touch at (X±1, Y±1), so 5:11 sits above 4:12 and 6:12, and
// 5:12 does not exist. Internally every pair has an index (col = X - 3, row = Y - 3,
// index = row * COLS + col), so saved data keeps its layout; isTile() tells the real ones apart.

export const MIN_X = 3;
export const MAX_X = 509;
export const MIN_Y = 3;
export const MAX_Y = 1021;
export const COLS = MAX_X - MIN_X + 1; // 507
export const ROWS = MAX_Y - MIN_Y + 1; // 1019
export const TILE_COUNT = COLS * ROWS;

export function isValidX(x: number): boolean {
  return Number.isInteger(x) && x >= MIN_X && x <= MAX_X;
}

export function isValidY(y: number): boolean {
  return Number.isInteger(y) && y >= MIN_Y && y <= MAX_Y;
}

/** X + Y even: a tile that exists in the game. */
export function isTileXY(x: number, y: number): boolean {
  return ((x + y) & 1) === 0;
}

/** Index of a tile that exists in the game (X + Y even). MIN_X + MIN_Y is even, so col + row works too. */
export function isTile(i: number): boolean {
  const c = i % COLS;
  return ((c + (i - c) / COLS) & 1) === 0;
}

export function isValidCoord(x: number, y: number): boolean {
  return isValidX(x) && isValidY(y) && isTileXY(x, y);
}

/** The game tiles touching a non-tile X:Y (its four sides), inside the map. */
export function tilesAround(x: number, y: number): string[] {
  return [
    [x, y - 1],
    [x - 1, y],
    [x + 1, y],
    [x, y + 1],
  ]
    .filter(([a, b]) => isValidX(a) && isValidY(b))
    .map(([a, b]) => `${a}:${b}`);
}

export function toIndex(x: number, y: number): number {
  return (y - MIN_Y) * COLS + (x - MIN_X);
}

export function indexX(i: number): number {
  return (i % COLS) + MIN_X;
}

export function indexY(i: number): number {
  return Math.floor(i / COLS) + MIN_Y;
}

export function formatIndex(i: number): string {
  return `${indexX(i)}:${indexY(i)}`;
}

/** Parses "123:456", "123 456", "123,456" or "X:123 Y:456". Range is not checked. */
export function parseCoordPair(text: string): { x: number; y: number } | null {
  const m = text.match(/(\d+)\s*[:;,/\s]\s*(?:y\s*[:=]?\s*)?(\d+)/i);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function coordError(x: number, y: number): string | null {
  if (!isValidX(x)) return `X must be a whole number from ${MIN_X} to ${MAX_X}`;
  if (!isValidY(y)) return `Y must be a whole number from ${MIN_Y} to ${MAX_Y}`;
  if (!isTileXY(x, y)) return `${x}:${y} is not a tile in the game (X + Y must be even). Nearby: ${tilesAround(x, y).join(', ')}`;
  return null;
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${-n}`;
}

/**
 * Finds every coordinate pair in free text ("123:456, 130:470" or one "123 456" per line).
 * Returns valid pairs (deduplicated, in order) and the invalid ones as typed.
 */
export function parseCoordList(text: string): { valid: { x: number; y: number }[]; invalid: string[] } {
  const pairs: [number, number][] = [];
  for (const m of text.matchAll(/(\d+)\s*[:;,/]\s*(\d+)/g)) pairs.push([Number(m[1]), Number(m[2])]);
  if (!pairs.length) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) pairs.push([Number(m[1]), Number(m[2])]);
    }
  }
  const seen = new Set<string>();
  const valid: { x: number; y: number }[] = [];
  const invalid: string[] = [];
  for (const [x, y] of pairs) {
    const key = `${x}:${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isValidCoord(x, y)) valid.push({ x, y });
    else invalid.push(key);
  }
  return { valid, invalid };
}

/** Distance in tiles as the game's 37×37 areas count it: max(|ΔX|, |ΔY|). */
export function chebyshev(a: number, b: number): number {
  return Math.max(Math.abs(indexX(a) - indexX(b)), Math.abs(indexY(a) - indexY(b)));
}
