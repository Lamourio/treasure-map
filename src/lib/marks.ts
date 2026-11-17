// Tile mark codes. Stored as bytes in a Uint8Array (0 = no mark).

export type MarkCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MARK_NONE = 0;
export const MARK_T = 1;
export const MARK_R = 2;
export const MARK_D = 3;
export const MARK_S = 4;
export const MARK_C = 5;
export const MARK_X = 6;

/** Number of code slots (0 = none plus every code), for arrays indexed by code. */
export const CODE_SLOTS = 7;

/**
 * Codes offered in the app. R (2) is switched off for now: its number stays reserved so saved
 * data keeps loading, and existing R tiles are kept but not drawn. Add 2 back here to re-enable it.
 */
export const MARK_CODES: MarkCode[] = [1, 5, 4, 3, 6]; // display order: T, C, S, D, X

/** Codes shown as pins when zoomed out, in priority order (D gets none). */
export const PIN_CODES: number[] = [1, 5, 4];

/** Codes that get an area drawn around them (when enabled). */
export const RANGE_CODES: number[] = [1, 5, 6];

/**
 * The 39×39 area of a T, C or X tile, as measured in the game: a diamond of 20 × 20 game tiles.
 * An even size has no middle tile, so the marked tile sits just below-right of the centre: the
 * area reaches AREA_BACK tiles from it towards the top-left and top-right edges and AREA_FWD tiles
 * towards the bottom ones (along the diagonals, (X+1, Y+1) and (X-1, Y+1)). Around 490:230 its
 * corners are 490:210 (top), 509:229 (right), 490:248 (bottom) and 471:229 (left): X 471..509 and
 * Y 210..248, 39 values each, 400 tiles.
 */
export const AREA_BACK = 10;
export const AREA_FWD = 9;

/** True when a tile at offset (dx, dy) from a marked tile lies in its area. */
export function inArea(dx: number, dy: number): boolean {
  if ((dx + dy) & 1) return false;
  const da = (dx + dy) / 2; // steps along (X+1, Y+1)
  const db = (dy - dx) / 2; // steps along (X-1, Y+1)
  return da >= -AREA_BACK && da <= AREA_FWD && db >= -AREA_BACK && db <= AREA_FWD;
}

/** Width and height of a code's area in coordinates (39). */
export function rangeSize(_code: number): number {
  return 2 * (AREA_BACK + AREA_FWD) + 1;
}

export function isActiveMark(code: number): boolean {
  return MARK_CODES.includes(code as MarkCode);
}

export interface MarkInfo {
  letter: string;
  name: string;
  color: string;
  text: string; // letter colour on top of the mark colour
}

export const MARKS: Record<number, MarkInfo> = {
  1: { letter: 'T', name: 'Treasure found', color: '#FFC000', text: '#1a1a1a' },
  2: { letter: 'R', name: 'Reward / collected', color: '#00B050', text: '#ffffff' },
  3: { letter: 'D', name: 'Dug, nothing here', color: '#7F7F7F', text: '#ffffff' },
  4: { letter: 'S', name: 'Suspected', color: '#FFFF00', text: '#1a1a1a' },
  5: { letter: 'C', name: 'Scrap', color: '#00B0F0', text: '#1a1a1a' },
  6: { letter: 'X', name: 'Empty area (39×39)', color: '#6C5B9E', text: '#ffffff' },
};

export function markFromLetter(letter: string): MarkCode | null {
  const l = letter.trim().toUpperCase();
  for (const c of [1, 2, 3, 4, 5, 6] as MarkCode[]) if (MARKS[c].letter === l) return c; // R still imports (kept hidden)
  return null;
}
