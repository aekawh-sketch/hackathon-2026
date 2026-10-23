// Маршрут с плана в «настоящем» пространстве: линия на полу в панораме (ТЗ 5.7, 5.10)
// и поверх видео с камеры на экране съёмки (ТЗ 5.4). План — 2D в метрах, пол — z = 0,
// камера стоит в известной точке плана на высоте cameraHeight. Этого хватает, пока человек
// только поворачивается на месте (3 степени свободы); идти с такой разметкой нельзя — положение не отслеживается.
import { rotateVector, type Quat, type Vec3 } from './capture.ts';
import { azimuth, distance, hasLineOfSight, normalize180, normalize360 } from './geometry.ts';
import type { MapDocument, PanoramaPlacement, Vec2 } from './types.ts';

export interface RouteViewOptions {
  /** Дальше этого линия не рисуется: на горизонте она сливается в точку, м. */
  maxDistance?: number;
  /** Шаг, с которым линия разбивается на точки, м. */
  step?: number;
}

/** Точка линии маршрута в панораме: yaw и pitch в градусах. */
export type PanoPoint = [number, number];

/**
 * Линия маршрута на полу панорамы — от места съёмки вперёд по маршруту. Куски за стенами выпадают,
 * поэтому результат — несколько линий. Без направления панорамы (heading) — пусто.
 */
export function routeInPanorama(doc: MapDocument, pano: PanoramaPlacement, route: Vec2[], options: RouteViewOptions = {}): PanoPoint[][] {
  if (pano.heading === null || route.length < 2) return [];
  const heading = pano.heading;
  const maxDistance = options.maxDistance ?? 15;
  const lines: PanoPoint[][] = [];
  let current: PanoPoint[] = [];
  for (const p of samplesAhead(route, pano.pos, options.step ?? 0.25)) {
    const d = distance(pano.pos, p);
    if (d < 0.6) continue; // под ногами направление не определено, а линия уходит в надир
    if (d > maxDistance || !hasLineOfSight(doc, pano.level, pano.pos, p)) {
      if (current.length > 1) lines.push(current);
      current = [];
      continue;
    }
    const yaw = normalize180(azimuth(pano.pos, p) - heading);
    const pitch = (Math.atan2(-pano.cameraHeight, d) * 180) / Math.PI;
    current.push([round1(yaw), round1(pitch)]);
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

/**
 * Куда в панораме продолжается маршрут: направление на точку маршрута в `ahead` метрах впереди
 * (или дальше, если она за углом). Для стрелки «Дальше», когда перехода в следующую панораму нет.
 */
export function routeDirectionInPanorama(doc: MapDocument, pano: PanoramaPlacement, route: Vec2[], ahead = 3): number | null {
  if (pano.heading === null || route.length < 2) return null;
  let last: Vec2 | null = null;
  for (const p of samplesAhead(route, pano.pos, 0.5)) {
    if (!hasLineOfSight(doc, pano.level, pano.pos, p)) break;
    last = p;
    if (distance(pano.pos, p) >= ahead) break;
  }
  if (!last || distance(pano.pos, last) < 0.5) return null;
  return round1(normalize180(azimuth(pano.pos, last) - pano.heading));
}

// ── Камера ──

/**
 * Ориентация телефона по `deviceorientation` (alpha, beta, gamma в градусах) и повороту экрана —
 * кватернион «камера → мир». Формула из спецификации W3C (порядок Z-X'-Y'').
 * Мир: x — вправо, y — вперёд (куда alpha = 0), z — вверх. Камера: x — вправо по экрану, y — вверх
 * по экрану, задняя камера смотрит вдоль −z. Для задней камеры это и есть оси телефона.
 */
export function deviceQuaternion(alpha: number, beta: number, gamma: number, screenAngle = 0): Quat {
  const r = Math.PI / 360; // половина угла в радианах
  const cx = Math.cos(beta * r);
  const cy = Math.cos(gamma * r);
  const cz = Math.cos(alpha * r);
  const sx = Math.sin(beta * r);
  const sy = Math.sin(gamma * r);
  const sz = Math.sin(alpha * r);
  const q: Quat = [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
  if (!screenAngle) return q;
  // Экран повёрнут (альбомная ориентация) — оси экрана повёрнуты относительно осей телефона вокруг z.
  const h = (-screenAngle * Math.PI) / 360;
  return multiply(q, [0, 0, Math.sin(h), Math.cos(h)]);
}

/** Куда смотрит камера в мире — единичный вектор. */
export function cameraForward(q: Quat): Vec3 {
  return rotateVector(q, [0, 0, -1]);
}

/**
 * Связать мир датчиков с планом: человек навёл прицел (центр экрана) на объект `target` плана.
 * Возвращает азимут плана, куда смотрит ось мира +y. Компас в помещении врёт, а так хватает одной двери.
 * null — телефон смотрит почти вертикально, направление по горизонтали не определено.
 */
export function headingFromAim(q: Quat, cameraPos: Vec2, target: Vec2): number | null {
  const f = cameraForward(q);
  if (Math.hypot(f[0], f[1]) < 0.2) return null;
  const yaw = (Math.atan2(f[0], f[1]) * 180) / Math.PI;
  return normalize360(azimuth(cameraPos, target) - yaw);
}

export interface CameraView {
  width: number;
  height: number;
  /** Вертикальный угол обзора кадра на экране, градусы. */
  vfov: number;
}

export interface CameraPose {
  /** Где стоит камера на плане. */
  pos: Vec2;
  /** Высота камеры над полом, м. */
  height: number;
  /** Азимут плана, куда смотрит ось мира +y (`headingFromAim`). */
  worldHeading: number;
  /** Ориентация телефона «камера → мир» (`deviceQuaternion`). */
  q: Quat;
}

/** Точка пола плана на экране: пиксели и глубина; null — за спиной у камеры. */
export function projectToCamera(pose: CameraPose, view: CameraView, target: Vec2, targetHeight = 0): { x: number; y: number; depth: number } | null {
  const d = distance(pose.pos, target);
  const yaw = ((azimuth(pose.pos, target) - pose.worldHeading) * Math.PI) / 180;
  const world: Vec3 = [d * Math.sin(yaw), d * Math.cos(yaw), targetHeight - pose.height];
  const conj: Quat = [-pose.q[0], -pose.q[1], -pose.q[2], pose.q[3]];
  const [x, y, z] = rotateVector(conj, world);
  const depth = -z;
  if (depth < 0.1) return null;
  const fy = 1 / Math.tan((view.vfov * Math.PI) / 360);
  const fx = fy * (view.height / view.width);
  return {
    x: ((1 + (x / depth) * fx) / 2) * view.width,
    y: ((1 - (y / depth) * fy) / 2) * view.height,
    depth,
  };
}

/**
 * Линия маршрута на экране камеры: точки маршрута на полу, видимые с места съёмки, в пикселях.
 * Куски за спиной и за стенами выпадают — результат из нескольких линий.
 */
export function routeOnCamera(
  doc: MapDocument,
  level: string,
  pose: CameraPose,
  view: CameraView,
  route: Vec2[],
  options: RouteViewOptions = {},
): Vec2[][] {
  const maxDistance = options.maxDistance ?? 20;
  const lines: Vec2[][] = [];
  let current: Vec2[] = [];
  const flush = () => {
    if (current.length > 1) lines.push(current);
    current = [];
  };
  for (const p of samplesAhead(route, pose.pos, options.step ?? 0.25)) {
    const d = distance(pose.pos, p);
    if (d < 0.4) continue;
    if (d > maxDistance || !hasLineOfSight(doc, level, pose.pos, p)) {
      flush();
      continue;
    }
    const s = projectToCamera(pose, view, p);
    if (!s) {
      flush();
      continue;
    }
    current.push([Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10]);
  }
  flush();
  return lines;
}

// ── Общее ──

/** Точки маршрута с шагом step, начиная с места на маршруте, ближайшего к `from`. */
function samplesAhead(route: Vec2[], from: Vec2, step: number): Vec2[] {
  let bestSeg = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((from[0] - a[0]) * dx + (from[1] - a[1]) * dy) / len2));
    const d = distance(from, [a[0] + t * dx, a[1] + t * dy]);
    if (d < bestD - 1e-9) {
      bestD = d;
      bestSeg = i;
      bestT = t;
    }
  }
  const out: Vec2[] = [];
  for (let i = bestSeg; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const len = distance(a, b);
    if (len < 1e-9) continue;
    const t0 = i === bestSeg ? bestT * len : 0;
    for (let s = t0; s < len; s += step) out.push([a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len]);
  }
  out.push(route[route.length - 1]!);
  return out;
}

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
