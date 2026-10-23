// Вырезы в помещении и разделение помещения на два. Двери между частями организатор ставит сам.
import { reconcileOpenings, newId, polygonsOverlap, rebuildGraph } from './edit.ts';
import { distance, pointInPolygon, pointSegmentDistance, polygonArea, polygonEdges, segmentIntersection } from './geometry.ts';
import type { MapDocument, Unit, Vec2 } from './types.ts';

export type RoomResult = { ok: true; doc: MapDocument; id: string; index?: number } | { ok: false; message: string };

/** Вырез меньше этого — случайный щелчок, а не колонна. */
const HOLE_MIN_SIDE = 0.15;
/** Вырез не прижимается к стене вплотную: иначе получится не вырез, а изменение формы комнаты. */
const HOLE_MARGIN = 0.1;

// ── Вырезы ──

/** Вырез, в который попала точка: помещение и номер выреза. */
export function holeAt(doc: MapDocument, level: string, p: Vec2): { unit: Unit; index: number } | null {
  for (const unit of doc.units) {
    if (unit.level !== level || !unit.holes) continue;
    const index = unit.holes.findIndex((h) => pointInPolygon(p, h));
    if (index >= 0) return { unit, index };
  }
  return null;
}

/** Почему вырез нельзя поставить, или null — можно. */
function holeProblem(doc: MapDocument, unit: Unit, hole: Vec2[], except?: number): string | null {
  const xs = hole.map((p) => p[0]);
  const ys = hole.map((p) => p[1]);
  if (Math.max(...xs) - Math.min(...xs) < HOLE_MIN_SIDE - 1e-9 || Math.max(...ys) - Math.min(...ys) < HOLE_MIN_SIDE - 1e-9) {
    return 'Вырез слишком маленький';
  }
  const inside = hole.every((p) => pointInPolygon(p, unit.polygon) && polygonEdges(unit.polygon).every(([a, b]) => pointSegmentDistance(p, a, b) >= HOLE_MARGIN - 1e-9));
  // В комнате сложной формы вершины выреза могут быть внутри, а сторона — пересекать стену.
  const crossesWall = polygonEdges(hole).some(([c, d]) => polygonEdges(unit.polygon).some(([e, f]) => segmentIntersection(c, d, e, f)));
  if (!inside || crossesWall) return 'Вырез должен быть внутри комнаты и не касаться стен';
  if ((unit.holes ?? []).some((h, i) => i !== except && polygonsOverlap(h, hole))) return 'Вырезы не должны пересекаться';
  const covers = (p: Vec2) => pointInPolygon(p, hole);
  const blocked =
    doc.places.some((p) => p.level === unit.level && covers(p.pos)) ||
    doc.panoramas.some((p) => p.level === unit.level && covers(p.pos)) ||
    doc.anchors.some((a) => a.level === unit.level && covers(a.pos));
  if (blocked) return 'В вырезе стоит место или панорама — сначала перенесите их';
  return null;
}

export function addHole(doc: MapDocument, unitId: string, hole: Vec2[]): RoomResult {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, message: 'Помещение не найдено' };
  const shape = hole.map(round2v);
  const problem = holeProblem(doc, unit, shape);
  if (problem) return { ok: false, message: problem };
  const holes = [...(unit.holes ?? []), shape];
  return { ok: true, doc: withUnit(doc, { ...unit, holes }), id: unit.id, index: holes.length - 1 };
}

export function setHolePolygon(doc: MapDocument, unitId: string, index: number, hole: Vec2[]): RoomResult {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit?.holes?.[index]) return { ok: false, message: 'Вырез не найден' };
  const shape = hole.map(round2v);
  const problem = holeProblem(doc, unit, shape, index);
  if (problem) return { ok: false, message: problem };
  const holes = unit.holes.map((h, i) => (i === index ? shape : h));
  return { ok: true, doc: withUnit(doc, { ...unit, holes }), id: unit.id, index };
}

export function moveHole(doc: MapDocument, unitId: string, index: number, delta: Vec2): RoomResult {
  const hole = doc.units.find((u) => u.id === unitId)?.holes?.[index];
  if (!hole) return { ok: false, message: 'Вырез не найден' };
  return setHolePolygon(doc, unitId, index, hole.map((p) => [p[0] + delta[0], p[1] + delta[1]] as Vec2));
}

export function deleteHole(doc: MapDocument, unitId: string, index: number): MapDocument {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit?.holes?.[index]) return doc;
  const holes = unit.holes.filter((_, i) => i !== index);
  const { holes: _drop, ...rest } = unit;
  return withUnit(doc, holes.length ? { ...unit, holes } : rest);
}

// ── Разделение ──

/**
 * Линия разреза, продлённая до стен: где прямая через a и b входит в помещение и где выходит.
 * Прямая должна пересечь контур ровно дважды — у сложной формы иначе получилось бы больше двух частей.
 */
export function cutChord(unit: Unit, a: Vec2, b: Vec2): { chord: [Vec2, Vec2]; edges: [number, number] } | null {
  if (distance(a, b) < 0.2) return null;
  const dir: Vec2 = [(b[0] - a[0]) / distance(a, b), (b[1] - a[1]) / distance(a, b)];
  const far = 1e5;
  const p: Vec2 = [a[0] - dir[0] * far, a[1] - dir[1] * far];
  const q: Vec2 = [a[0] + dir[0] * far, a[1] + dir[1] * far];
  const hits: { point: Vec2; edge: number; t: number }[] = [];
  polygonEdges(unit.polygon).forEach(([c, d], i) => {
    const hit = segmentIntersection(p, q, c, d);
    if (!hit) return;
    // Прямая через вершину даёт два попадания в соседние рёбра — оставляем одно.
    if (hits.some((h) => distance(h.point, hit) < 1e-6)) return;
    hits.push({ point: hit, edge: i, t: (hit[0] - p[0]) * dir[0] + (hit[1] - p[1]) * dir[1] });
  });
  if (hits.length !== 2) return null;
  hits.sort((x, y) => x.t - y.t);
  return { chord: [hits[0]!.point, hits[1]!.point], edges: [hits[0]!.edge, hits[1]!.edge] };
}

/**
 * Разделить помещение линией на два. Бо́льшая часть сохраняет ID и название, меньшая — новое.
 * Вырезы остаются в своей части; линия не должна их пересекать. Двери на стенах частей сохраняются,
 * новой двери между частями нет — её ставят инструментом «Дверь».
 */
export function splitUnit(doc: MapDocument, unitId: string, a: Vec2, b: Vec2): RoomResult & { chord?: [Vec2, Vec2] } {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, message: 'Помещение не найдено' };
  const cut = cutChord(unit, a, b);
  if (!cut) return { ok: false, message: 'Проведите линию поперёк комнаты — от стены до стены' };
  const [p1, p2] = cut.chord;
  const [e1, e2] = cut.edges;
  if (distance(p1, p2) < 0.5) return { ok: false, message: 'Разрез слишком короткий' };
  if ((unit.holes ?? []).some((h) => polygonEdges(h).some(([c, d]) => segmentIntersection(p1, p2, c, d)))) {
    return { ok: false, message: 'Линия разреза проходит через вырез' };
  }

  const ring = unit.polygon;
  const n = ring.length;
  const walk = (from: number, to: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = (from + 1) % n; ; i = (i + 1) % n) {
      out.push(ring[i]!);
      if (i === to) break;
    }
    return out;
  };
  // Часть 1: от p1 по контуру до p2; часть 2: от p2 до p1. Вершины, совпавшие с точками разреза, убираем.
  const clean = (poly: Vec2[]) => poly.filter((v, i) => distance(v, poly[(i + 1) % poly.length]!) > 1e-6).map(round2v);
  const first = clean([p1, ...walk(e1, e2), p2]);
  const second = clean([p2, ...walk(e2, e1), p1]);
  if (polygonArea(first) < 1 || polygonArea(second) < 1) return { ok: false, message: 'Одна из частей меньше 1 м² — проведите линию дальше от стены' };

  const [big, small] = polygonArea(first) >= polygonArea(second) ? [first, second] : [second, first];
  const holesOf = (poly: Vec2[]) => (unit.holes ?? []).filter((h) => pointInPolygon(centroid(h), poly));
  const id = newId(doc, 'u');
  const keep: Unit = { ...unit, polygon: big };
  const added: Unit = { id, level: unit.level, kind: unit.kind, name: `${unit.name} — часть 2`, walkable: unit.walkable, polygon: small };
  const bigHoles = holesOf(big);
  const smallHoles = holesOf(small);
  if (bigHoles.length) keep.holes = bigHoles;
  else delete keep.holes;
  if (smallHoles.length) added.holes = smallHoles;

  // Двери, стоявшие на стенах новой части, теперь ведут в неё.
  const onBoundary = (seg: [Vec2, Vec2], poly: Vec2[]) =>
    polygonEdges(poly).some(([c, d]) => pointSegmentDistance(seg[0], c, d) < 0.05 && pointSegmentDistance(seg[1], c, d) < 0.05);
  const openings = doc.openings.map((o) => {
    if (!(o.units as readonly string[]).includes(unit.id) || onBoundary(o.segment, big) || !onBoundary(o.segment, small)) return o;
    return { ...o, units: o.units.map((u) => (u === unit.id ? id : u)) as typeof o.units };
  });

  let next: MapDocument = { ...doc, openings, units: [...doc.units.map((u) => (u.id === unit.id ? keep : u)), added] };
  next = reconcileOpenings(next);
  return { ok: true, doc: rebuildGraph(next, unit.level), id, chord: [round2v(p1), round2v(p2)] };
}

// ── Вспомогательное ──

function withUnit(doc: MapDocument, unit: Unit): MapDocument {
  return rebuildGraph({ ...doc, units: doc.units.map((u) => (u.id === unit.id ? unit : u)) }, unit.level);
}

function centroid(poly: Vec2[]): Vec2 {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}

function round2v(p: Vec2): Vec2 {
  const r = (v: number) => Math.round(v * 100) / 100 + 0; // + 0: без «-0» в JSON
  return [r(p[0]), r(p[1])];
}

