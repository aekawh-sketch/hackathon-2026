import type { MapDocument, Vec2 } from './types.ts';

const EPS = 1e-9;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Азимут от a к b: градусы по часовой от «верха» плана (+y), 0…360. */
export function azimuth(a: Vec2, b: Vec2): number {
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return normalize360(deg);
}

export function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

export function normalize180(deg: number): number {
  const r = normalize360(deg);
  return r > 180 ? r - 360 : r;
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Точка пересечения отрезков ab и cd (включая касание концами) или null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < EPS) return null; // параллельны или совпадают — сквозь стену вдоль неё не смотрим
  const qp: Vec2 = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (pi[1] > p[1] !== pj[1] > p[1] && p[0] < ((pj[0] - pi[0]) * (p[1] - pi[1])) / (pj[1] - pi[1]) + pi[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonArea(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1];
  }
  return Math.abs(sum) / 2;
}

/** Площадь со знаком: > 0 — обход против часовой стрелки. */
export function signedArea(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1];
  }
  return sum / 2;
}

export function polygonEdges(polygon: Vec2[]): [Vec2, Vec2][] {
  return polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as [Vec2, Vec2]);
}

/** Контуры помещения: внешний и вырезы. Все они — стены. */
export function unitRings(unit: { polygon: Vec2[]; holes?: Vec2[][] }): Vec2[][] {
  return unit.holes?.length ? [unit.polygon, ...unit.holes] : [unit.polygon];
}

/** Точка внутри помещения и не в вырезе. */
export function pointInUnit(p: Vec2, unit: { polygon: Vec2[]; holes?: Vec2[][] }): boolean {
  return pointInPolygon(p, unit.polygon) && !(unit.holes ?? []).some((h) => pointInPolygon(p, h));
}

/** Отрезок ab не пересекает стен этажа: границы помещений и вырезов — стены, кроме мест, где стоит проход. */
export function hasLineOfSight(doc: MapDocument, level: string, a: Vec2, b: Vec2, doorTolerance = 0.05): boolean {
  const openings = doc.openings.filter((o) => o.level === level);
  for (const unit of doc.units) {
    if (unit.level !== level) continue;
    for (const [c, d] of unitRings(unit).flatMap(polygonEdges)) {
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      // Касание концами отрезка (точка стоит на стене) стеной не считаем.
      if (distance(hit, a) < doorTolerance || distance(hit, b) < doorTolerance) continue;
      const throughDoor = openings.some((o) => pointSegmentDistance(hit, o.segment[0], o.segment[1]) < doorTolerance);
      if (!throughDoor) return false;
    }
  }
  return true;
}

export function unitAt(doc: MapDocument, level: string, p: Vec2) {
  return doc.units.find((u) => u.level === level && pointInUnit(p, u)) ?? null;
}
