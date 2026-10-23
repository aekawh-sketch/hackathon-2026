// Общий слой преобразований «план ↔ экран» (ТЗ 4.1). План: метры, y вверх. Экран: пиксели, y вниз.
import type { MapDocument, Vec2 } from '@space-map/map-core';

export interface Viewport {
  /** Пикселей на метр. */
  scale: number;
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 2;
export const MAX_SCALE = 400;

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return [p[0] * v.scale + v.x, -p[1] * v.scale + v.y];
}

export function screenToWorld(v: Viewport, s: Vec2): Vec2 {
  return [(s[0] - v.x) / v.scale, -(s[1] - v.y) / v.scale];
}

/** Зум вокруг точки экрана: точка плана под пальцем остаётся на месте. */
export function zoomAt(v: Viewport, at: Vec2, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const world = screenToWorld(v, at);
  return { scale, x: at[0] - world[0] * scale, y: at[1] + world[1] * scale };
}

export function fitBounds(b: Bounds, width: number, height: number, padding = 24): Viewport {
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((width - 2 * padding) / bw, (height - 2 * padding) / bh)));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { scale, x: width / 2 - cx * scale, y: height / 2 + cy * scale };
}

export function levelBounds(doc: MapDocument, level: string): Bounds {
  const pts = doc.units.filter((u) => u.level === level).flatMap((u) => u.polygon);
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 20, maxY: 20 };
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxX: Math.max(...pts.map((p) => p[0])),
    maxY: Math.max(...pts.map((p) => p[1])),
  };
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
  const n = polygon.length;
  return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n];
}
