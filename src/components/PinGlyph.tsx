import { PIN_ICONS, PinIcon, readableOn } from '../lib/icons';

/** Round coloured badge with an icon, matching the pins drawn on the map. */
export function PinGlyph({ icon, color, size = 18, title }: { icon: PinIcon; color: string; size?: number; title?: string }) {
  const fg = readableOn(color);
  return (
    <svg className="pin-glyph" width={size} height={size} viewBox="-4 -4 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="15" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      {PIN_ICONS[icon].map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? (p.fill === 'fg' ? fg : color) : 'none'}
          stroke={p.stroke ? (p.stroke === 'fg' ? fg : color) : 'none'}
          strokeWidth={p.width ?? 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
