// Маршрут с плана в «настоящем» пространстве: линия на полу в панораме (ТЗ 5.7, 5.10)
// и поверх камеры на экране съёмки (ТЗ 5.4). План — 2D в метрах, пол — z = 0.
// Где камера на плане, знают по-разному: в панораме — точка съёмки; на ходу — WebXR (ARCore сам
// отслеживает положение, `ArFrame` связывает его мир с планом) или шаги вдоль линии маршрута (`StepDetector`).
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

/** Ближайшее к `p` место на линии: номер отрезка, доля внутри него, путь вдоль линии от начала и расстояние до линии. */
export function nearestOnLine(line: Vec2[], p: Vec2): { segment: number; t: number; along: number; distance: number } {
  let best = { segment: 0, t: 0, along: 0, distance: line.length ? distance(p, line[0]!) : Infinity };
  let walked = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const d = distance(p, [a[0] + t * dx, a[1] + t * dy]);
    if (d < best.distance - 1e-9) best = { segment: i, t, along: walked + t * Math.sqrt(len2), distance: d };
    walked += Math.sqrt(len2);
  }
  return best;
}

/** Длина линии, м. */
export function lineLength(line: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distance(line[i - 1]!, line[i]!);
  return s;
}

/** Точка на линии в `along` метрах от начала (с обрезкой по концам). */
export function pointAlong(line: Vec2[], along: number): Vec2 {
  if (line.length === 0) return [0, 0];
  let left = Math.max(0, along);
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const len = distance(a, b);
    if (left <= len) return len < 1e-9 ? a : [a[0] + ((b[0] - a[0]) * left) / len, a[1] + ((b[1] - a[1]) * left) / len];
    left -= len;
  }
  return line[line.length - 1]!;
}

/** Точки маршрута с шагом step, начиная с места на маршруте, ближайшего к `from`. */
function samplesAhead(route: Vec2[], from: Vec2, step: number): Vec2[] {
  const { segment: bestSeg, t: bestT } = nearestOnLine(route, from);
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

/** Плавный переход между ориентациями: t = 0 — a, t = 1 — b. Короткий путь по сфере. */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    cos = -cos;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const angle = Math.acos(Math.min(1, cos));
    const sin = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / sin;
    kb = Math.sin(t * angle) / sin;
  }
  const q: Quat = [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// ── Шаги ──

export interface StepDetectorOptions {
  /** Порог «вверх» над средним, м/с²: выше — шаг. */
  high?: number;
  /** Порог «вниз»: ниже — готовы ловить следующий шаг. */
  low?: number;
  /** Не чаще одного шага за столько миллисекунд (быстрая ходьба — ~3 шага в секунду). */
  minInterval?: number;
}

/**
 * Шагомер по акселерометру (`devicemotion`, ускорение с гравитацией). Ищет пики модуля ускорения
 * над медленно плывущим средним, с гистерезисом и минимальным интервалом — дрожь руки шагом не считается.
 */
export class StepDetector {
  steps = 0;
  private mean = 9.81;
  private fast = 0;
  private armed = true;
  private last = -Infinity;
  private readonly high: number;
  private readonly low: number;
  private readonly minInterval: number;

  constructor(options: StepDetectorOptions = {}) {
    this.high = options.high ?? 1.2;
    this.low = options.low ?? 0.2;
    this.minInterval = options.minInterval ?? 300;
  }

  /** a — модуль ускорения, м/с²; t — время, мс. true — только что сделан шаг. */
  push(a: number, t: number): boolean {
    this.mean += (a - this.mean) * 0.02;
    this.fast += (a - this.mean - this.fast) * 0.35;
    if (this.armed && this.fast > this.high && t - this.last >= this.minInterval) {
      this.steps++;
      this.last = t;
      this.armed = false;
      return true;
    }
    if (!this.armed && this.fast < this.low) this.armed = true;
    return false;
  }
}

// ── WebXR ──

/** Мир WebXR: x — вправо, y — вверх, −z — вперёд (куда смотрела камера при старте), метры. */
export type XrPoint = Vec3;

/**
 * Связь мира WebXR с планом: в мире камера стояла в `camera`, на плане — в `stand`;
 * поворот `delta` — на сколько градусов по часовой азимут плана больше азимута в мире.
 */
export interface ArFrame {
  stand: Vec2;
  camera: XrPoint;
  delta: number;
  /** Высота пола в мире WebXR (для `local-floor` — 0). */
  floorY: number;
}

/** Азимут направления в мире WebXR по горизонтали: 0 — вперёд (−z), по часовой. */
export function xrAzimuth(dir: XrPoint): number {
  return normalize360((Math.atan2(dir[0], -dir[2]) * 180) / Math.PI);
}

/**
 * Привязка мира WebXR к плану прицелом: человек стоит в `stand`, камера в `camera` смотрит
 * направлением `forward` на объект плана `landmark`. null — смотрит почти вертикально.
 */
export function arFrameFromAim(stand: Vec2, landmark: Vec2, camera: XrPoint, forward: XrPoint, floorY: number): ArFrame | null {
  if (Math.hypot(forward[0], forward[2]) < 0.2) return null;
  return { stand, camera, delta: normalize360(azimuth(stand, landmark) - xrAzimuth(forward)), floorY };
}

/** Точка мира WebXR — на плане. */
export function arToPlan(frame: ArFrame, p: XrPoint): Vec2 {
  const r = (frame.delta * Math.PI) / 180;
  const du = p[0] - frame.camera[0];
  const dv = -(p[2] - frame.camera[2]);
  return [frame.stand[0] + du * Math.cos(r) + dv * Math.sin(r), frame.stand[1] - du * Math.sin(r) + dv * Math.cos(r)];
}

/** Точка плана на высоте `height` над полом — в мире WebXR. */
export function planToAr(frame: ArFrame, q: Vec2, height = 0): XrPoint {
  const r = (frame.delta * Math.PI) / 180;
  const x = q[0] - frame.stand[0];
  const y = q[1] - frame.stand[1];
  const du = x * Math.cos(r) - y * Math.sin(r);
  const dv = x * Math.sin(r) + y * Math.cos(r);
  return [frame.camera[0] + du, frame.floorY + height, frame.camera[2] - dv];
}

/** Человек подтвердил, что стоит в точке плана `at`: сдвиг привязки снимает накопленный уход, поворот — прежний. */
export function reanchorArFrame(frame: ArFrame, camera: XrPoint, at: Vec2): ArFrame {
  return { ...frame, stand: at, camera };
}

// ── Общее ──

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
