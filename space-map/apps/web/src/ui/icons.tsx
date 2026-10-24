// Иконки интерфейса и категорий: линейные пути 24×24. Один набор для DOM (<Icon>), плана (Konva Path) и 3D (Path2D).
import type { CSSProperties } from 'react';

export const ICON_PATHS = {
  // Категории мест
  door: 'M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3.5 21h17M14.5 12.5v.01',
  desk: 'M4 17h16M5.5 17a6.5 6.5 0 0 1 13 0M12 8.5V6.5M10 6.5h4M3 20h18',
  hall: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  room: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5zM8.5 10h.01M12 10h.01M15.5 10h.01',
  booth: 'M5 21V4M5 4.5h12.5l-2.5 4 2.5 4H5',
  wc: 'M8 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM16 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM6 9.5h4l.5 6H9v5.5H7v-5.5H5.5zM14 9.5h4l1.5 6h-2v5.5h-3v-5.5h-2zM12 9v12',
  coffee: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.75 16a5 5 0 0 1 6.5 0M12 19.5h.01',
  elevator: 'M5 3h14v18H5zM9 9l3-3 3 3M9 15l3 3 3-3',
  stairs: 'M4 20h4v-4h4v-4h4V8h4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.01',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  // Интерфейс
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16',
  from: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3',
  pano: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.6-2.2h5.4L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
  swap: 'M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 21l2.5-6.5L14 17v4M7 12.5l2.5-4.5 3.5 1 2 3.5 2.5 1M11.5 14.5L13 9',
  map: 'M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14',
  cube: 'M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5zM12 12l8.5-4.75M12 12v9.5M12 12L3.5 7.25',
  download: 'M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  cursor: 'M5 3.5l13 7.5-5.5 1.5L10 18z',
  square: 'M4.5 4.5h15v15h-15zM4.5 4.5h0',
  split: 'M4.5 4.5h15v15h-15zM12 2.5v19',
  hole: 'M4.5 4.5h15v15h-15zM9.5 9.5h5v5h-5z',
  zone: 'M4.5 4.5h15v15h-15zM8 8h8v8H8z',
  doorAdd: 'M4 4h6v16H4zM14 12h7M17.5 8.5v7',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  top: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5',
  cut: 'M4 15h16M7 15V9h10v6M4 19h16',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  grid: 'M4 4h16v16H4zM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4.3 14.2a1.6 1.6 0 0 1 2.6-1.9L8 14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  building: 'M4 21V5l8-2v18M12 7h8v14M7.5 8h1M7.5 12h1M7.5 16h1M15.5 11h1M15.5 15h1M2.5 21h19',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM20 14v.01M14 20v.01',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Иконка категории места: известное имя или булавка. */
export function categoryIconPath(icon: string): string {
  return (ICON_PATHS as Record<string, string>)[icon] ?? ICON_PATHS.pin;
}

export function Icon({ name, size = 20, stroke = 2, style, className }: { name: IconName; size?: number; stroke?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Значок категории — кружок цвета категории с белой иконкой. */
export function CategoryBadge({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="cat-badge" style={{ width: size, height: size, background: color }} aria-hidden>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
        <path d={categoryIconPath(icon)} />
      </svg>
    </span>
  );
}
