const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  panel: 'M3 4h18v16H3zM15 4v16',
  pointer: 'M5 3l14 7.5-6 1.5 3.5 7-2.5 1.2-3.5-7L6 17.5z',
  eraser: 'm7 21-4-4 11-11 7 7-8 8M7 21h13M9.5 10.5l6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  close: 'M6 6l12 12M18 6 6 18',
  more: 'M4.5 12h1M11.5 12h1M18.5 12h1',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
