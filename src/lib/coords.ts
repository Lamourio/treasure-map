// Game coordinates: X 3..509 (left to right), Y 3..1021 (top to bottom).
// Internally tiles are addressed by col = X - 3, row = Y - 3, index = row * COLS + col.

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

export function isValidCoord(x: number, y: number): boolean {
  return isValidX(x) && isValidY(y);
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

export function chebyshev(a: number, b: number): number {
  return Math.max(Math.abs(indexX(a) - indexX(b)), Math.abs(indexY(a) - indexY(b)));
}
