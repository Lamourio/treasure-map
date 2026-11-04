// Small glyphs used inside map pins and in the UI. Paths use a 24x24 box.
// Each part is filled/stroked with the foreground colour ("fg") or with the
// pin colour ("bg", used to cut details out of a filled shape).

export type PinIcon = 'chest' | 'gift' | 'question' | 'cross' | 'crown' | 'ruin' | 'castle' | 'flag' | 'star' | 'gem' | 'dot';

interface Part {
  d: string;
  fill?: 'fg' | 'bg';
  stroke?: 'fg' | 'bg';
  width?: number;
}

export const PIN_ICONS: Record<PinIcon, Part[]> = {
  chest: [
    { d: 'M3 12h18v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z', fill: 'fg' },
    { d: 'M3 10.5V9c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v1.5z', fill: 'fg' },
    { d: 'M10.3 9.5h3.4v4.5h-3.4z', fill: 'bg' },
  ],
  gift: [
    { d: 'M4 12h16v8.5H4z', fill: 'fg' },
    { d: 'M3 8h18v3H3z', fill: 'fg' },
    { d: 'M11 8h2v12.5h-2z', fill: 'bg' },
    { d: 'M12 7.5C10.5 4 6.5 3.5 6.5 6S10 7.5 12 7.5zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 7.5 12 7.5z', fill: 'fg' },
  ],
  question: [
    { d: 'M8.6 9a3.5 3.5 0 1 1 5.1 3.1c-1.1.6-1.7 1.3-1.7 2.6', stroke: 'fg', width: 2.8 },
    { d: 'M10.4 19a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z', fill: 'fg' },
  ],
  cross: [{ d: 'M7 7l10 10M17 7 7 17', stroke: 'fg', width: 3 }],
  crown: [
    { d: 'M3 17.5 4.5 7l4.5 4.5L12 4.5l3 7 4.5-4.5L21 17.5z', fill: 'fg' },
    { d: 'M3 19h18v2H3z', fill: 'fg' },
  ],
  ruin: [
    { d: 'M3 19.5h18V21H3z', fill: 'fg' },
    { d: 'M5 18.5V10h3v8.5z', fill: 'fg' },
    { d: 'M10.5 18.5V5.5l3 2V18.5z', fill: 'fg' },
    { d: 'M16 18.5v-5.5l3-1.5v7z', fill: 'fg' },
  ],
  castle: [
    {
      d: 'M3.5 21V7.5H6V10h2V7.5h2.5V10h3V7.5H16V10h2V7.5h2.5V21H14.5v-4a2.5 2.5 0 0 0-5 0v4z',
      fill: 'fg',
    },
  ],
  flag: [
    { d: 'M6 3v18', stroke: 'fg', width: 2.2 },
    { d: 'M7 4h12l-3 4.5 3 4.5H7z', fill: 'fg' },
  ],
  star: [{ d: 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z', fill: 'fg' }],
  gem: [
    { d: 'M6.5 4h11L21.5 9 12 21 2.5 9z', fill: 'fg' },
    { d: 'M2.5 9h19M9 4.2 7.5 9 12 20M15 4.2 16.5 9 12 20', stroke: 'bg', width: 1.1 },
  ],
  dot: [{ d: 'M12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z', fill: 'fg' }],
};

export const ICON_LABELS: Record<PinIcon, string> = {
  chest: 'Chest',
  gift: 'Gift',
  question: 'Question',
  cross: 'Cross',
  crown: 'Crown',
  ruin: 'Ruin',
  castle: 'Castle',
  flag: 'Flag',
  star: 'Star',
  gem: 'Gem',
  dot: 'Dot',
};

export const LANDMARK_ICON_CHOICES: PinIcon[] = ['crown', 'ruin', 'castle', 'flag', 'star', 'gem', 'chest', 'dot'];

/** Icon per mark code (T, R, D, S). */
export const MARK_ICONS: Record<number, PinIcon> = { 1: 'chest', 2: 'gift', 3: 'cross', 4: 'question' };

export function isPinIcon(v: unknown): v is PinIcon {
  return typeof v === 'string' && v in PIN_ICONS;
}

/** Dark or white, whichever reads better on the given #RRGGBB colour. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#1a1a1a' : '#ffffff';
}

const pathCache = new Map<string, Path2D>();

/** Draws an icon with its top-left corner at (x, y), `size` CSS px wide. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: PinIcon,
  x: number,
  y: number,
  size: number,
  fg: string,
  bg: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of PIN_ICONS[icon]) {
    let p = pathCache.get(part.d);
    if (!p) {
      p = new Path2D(part.d);
      pathCache.set(part.d, p);
    }
    if (part.fill) {
      ctx.fillStyle = part.fill === 'fg' ? fg : bg;
      ctx.fill(p);
    }
    if (part.stroke) {
      ctx.strokeStyle = part.stroke === 'fg' ? fg : bg;
      ctx.lineWidth = part.width ?? 2;
      ctx.stroke(p);
    }
  }
  ctx.restore();
}
