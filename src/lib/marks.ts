// Tile mark codes. Stored as bytes in a Uint8Array (0 = no mark).

export type MarkCode = 0 | 1 | 2 | 3 | 4 | 5;

export const MARK_NONE = 0;
export const MARK_T = 1;
export const MARK_R = 2;
export const MARK_D = 3;
export const MARK_S = 4;
export const MARK_C = 5;

/** Number of code slots (0 = none plus every code), for arrays indexed by code. */
export const CODE_SLOTS = 6;

/**
 * Codes offered in the app. R (2) is switched off for now: its number stays reserved so saved
 * data keeps loading, and existing R tiles are kept but not drawn. Add 2 back here to re-enable it.
 */
export const MARK_CODES: MarkCode[] = [1, 5, 4, 3]; // display order: T, C, S, D

/** Codes shown as pins when zoomed out, in priority order (D gets none). */
export const PIN_CODES: number[] = [1, 5, 4];

/** Codes that get a range square drawn around them (when enabled), and its half-size: 39×39 tiles. */
export const RANGE_CODES: number[] = [1, 5];
export const RANGE_RADIUS = 19;

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
};

export function markFromLetter(letter: string): MarkCode | null {
  const l = letter.trim().toUpperCase();
  for (const c of [1, 2, 3, 4, 5] as MarkCode[]) if (MARKS[c].letter === l) return c; // R still imports (kept hidden)
  return null;
}
