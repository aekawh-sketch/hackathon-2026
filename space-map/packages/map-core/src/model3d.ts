// 3D-модель этажа из плана — ТЗ 5.18. Стены «выдавливаются» из границ помещений, в проходах — проёмы.
import { pointSegmentDistance, unitRings } from './geometry.ts';
import type { MapDocument, Vec2 } from './types.ts';

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  height: number;
}

export interface Model3D {
  walls: WallSegment[];
  floors: { unit: string; polygon: Vec2[]; holes: Vec2[][]; kind: string }[];
  blocks: { id: string; polygon: Vec2[]; height: number }[];
}

export interface Model3DOptions {
  wallHeight?: number;
  obstacleHeight?: number;
}

const ANGLE_STEP = 0.1; // градусы
const OFFSET_STEP = 0.01; // метры

/**
 * Общие стены соседних помещений склеиваются в одну (иначе две совпадающие плоскости мерцают),
 * из них вырезаются проходы.
 */
export function buildModel3D(doc: MapDocument, level: string, options: Model3DOptions = {}): Model3D {
  const wallHeight = options.wallHeight ?? 3;
  const obstacleHeight = options.obstacleHeight ?? 2.5;

  const lines = new Map<string, { origin: Vec2; dir: Vec2; intervals: [number, number][] }>();
  for (const unit of doc.units) {
    // Территория (двор между зданиями) — без стен по краю: стены корпусов дают сами корпуса.
    if (unit.level !== level || unit.kind === 'outdoor') continue;
    for (const ring of unitRings(unit)) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      let dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      // Направление приводим к полуплоскости, чтобы ab и ba попали в одну линию.
      if (dir[0] < -1e-9 || (Math.abs(dir[0]) < 1e-9 && dir[1] < 0)) dir = [-dir[0], -dir[1]];
      const normal: Vec2 = [-dir[1], dir[0]];
      const offset = a[0] * normal[0] + a[1] * normal[1];
      const angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
      const key = `${Math.round(angle / ANGLE_STEP)}:${Math.round(offset / OFFSET_STEP)}`;
      let line = lines.get(key);
      if (!line) {
        line = { origin: [normal[0] * offset, normal[1] * offset], dir, intervals: [] };
        lines.set(key, line);
      }
      const ta = project(a, line.origin, line.dir);
      const tb = project(b, line.origin, line.dir);
      line.intervals.push([Math.min(ta, tb), Math.max(ta, tb)]);
    }
  }

  const openings = doc.openings.filter((o) => o.level === level);
  const walls: WallSegment[] = [];
  for (const line of lines.values()) {
    let solid = union(line.intervals);
    for (const o of openings) {
      const [p, q] = o.segment;
      if (pointLineDistance(p, line.origin, line.dir) > 0.05 || pointLineDistance(q, line.origin, line.dir) > 0.05) continue;
      const tp = project(p, line.origin, line.dir);
      const tq = project(q, line.origin, line.dir);
      solid = subtract(solid, [Math.min(tp, tq), Math.max(tp, tq)]);
    }
    for (const [t0, t1] of solid) {
      if (t1 - t0 < 0.02) continue;
      walls.push({ a: at(line.origin, line.dir, t0), b: at(line.origin, line.dir, t1), height: wallHeight });
    }
  }

  return {
    walls,
    floors: doc.units.filter((u) => u.level === level).map((u) => ({ unit: u.id, polygon: u.polygon, holes: u.holes ?? [], kind: u.kind })),
    blocks: doc.obstacles.filter((o) => o.level === level).map((o) => ({ id: o.id, polygon: o.polygon, height: obstacleHeight })),
  };
}

function project(p: Vec2, origin: Vec2, dir: Vec2): number {
  return (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1];
}

function at(origin: Vec2, dir: Vec2, t: number): Vec2 {
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
}

function pointLineDistance(p: Vec2, origin: Vec2, dir: Vec2): number {
  const far: Vec2 = [origin[0] + dir[0] * 1e6, origin[1] + dir[1] * 1e6];
  const near: Vec2 = [origin[0] - dir[0] * 1e6, origin[1] - dir[1] * 1e6];
  return pointSegmentDistance(p, near, far);
}

function union(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1e-6) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtract(intervals: [number, number][], [cs, ce]: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of intervals) {
    if (ce <= s || cs >= e) {
      out.push([s, e]);
      continue;
    }
    if (cs > s) out.push([s, cs]);
    if (ce < e) out.push([ce, e]);
  }
  return out;
}
