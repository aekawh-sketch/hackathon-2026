// Этажи: добавить (пустой или копией плана другого), переименовать, переставить, удалить.
// Лестницы и лифты, стоящие друг над другом на соседних этажах, соединяют этажи в маршрутах.
import { distance, pointInUnit, pointSegmentDistance, unitRings } from './geometry.ts';
import { polygonsOverlap, rebuildGraph } from './edit.ts';
import type { NavGraph } from './graph.ts';
import type { Level, MapDocument, Unit, Vec2 } from './types.ts';

/** Снизу вверх. */
export function sortedLevels(doc: MapDocument): Level[] {
  return [...doc.levels].sort((a, b) => a.ordinal - b.ordinal);
}

export type VerticalKind = 'stairs' | 'elevator';

/** Цена перехода на соседний этаж, метры пути: подъём по лестнице и ожидание лифта. */
export const FLOOR_COST: Record<VerticalKind, number> = { stairs: 12, elevator: 18 };

export function isVertical(unit: Unit): unit is Unit & { kind: VerticalKind } {
  return unit.walkable && (unit.kind === 'stairs' || unit.kind === 'elevator');
}

export interface VerticalLink {
  a: Unit;
  b: Unit;
  kind: VerticalKind;
}

/** Лестницы и лифты соседних этажей, которые стоят друг над другом (контуры пересекаются). */
export function verticalLinks(doc: MapDocument): VerticalLink[] {
  const order = sortedLevels(doc);
  const out: VerticalLink[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    const below = doc.units.filter((u) => u.level === order[i]!.id && isVertical(u));
    const above = doc.units.filter((u) => u.level === order[i + 1]!.id && isVertical(u));
    for (const a of below) {
      for (const b of above) {
        if (a.kind !== b.kind) continue;
        if (polygonsOverlap(a.polygon, b.polygon) || pointInUnit(interiorPoint(a), b) || pointInUnit(interiorPoint(b), a)) {
          out.push({ a, b, kind: a.kind as VerticalKind });
        }
      }
    }
  }
  return out;
}

/** Точка внутри помещения подальше от стен: центр, а если он снаружи (Г-образная комната) — лучшая точка сетки. */
export function interiorPoint(unit: Unit): Vec2 {
  const pts = unit.polygon;
  const c: Vec2 = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  if (pointInUnit(c, unit)) return round2v(c);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const edges = unitRings(unit).flatMap((ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as [Vec2, Vec2]));
  let best: Vec2 = pts[0]!;
  let bestD = -1;
  for (let i = 1; i < 12; i++) {
    for (let j = 1; j < 12; j++) {
      const p: Vec2 = [x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * j) / 12];
      if (!pointInUnit(p, unit)) continue;
      const d = Math.min(...edges.map(([a, b]) => pointSegmentDistance(p, a, b)));
      if (d > bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  return round2v(best);
}

export interface AddLevelOptions {
  name?: string;
  /** Скопировать помещения и двери с этого этажа — у этажей одного здания стены обычно те же. */
  copyFrom?: string;
  /** Этаж ниже всех (подвал), а не выше. */
  below?: boolean;
}

export function addLevel(doc: MapDocument, options: AddLevelOptions = {}): { doc: MapDocument; id: string } {
  const used = new Set(doc.levels.map((l) => l.id));
  let n = doc.levels.length + 1;
  while (used.has(`L${n}`)) n++;
  const id = `L${n}`;
  const ordinals = doc.levels.map((l) => l.ordinal);
  const ordinal = options.below ? Math.min(...ordinals) - 1 : Math.max(...ordinals) + 1;
  const name = options.name?.trim() || (ordinal >= 0 ? `${ordinal + 1} этаж` : `${ordinal} этаж`);
  let next: MapDocument = { ...doc, levels: [...doc.levels, { id, name, ordinal, underlay: null }] };
  if (options.copyFrom) next = copyPlan(next, options.copyFrom, id);
  return { doc: rebuildAll(next), id };
}

/** Помещения, двери и препятствия этажа from — на этаж to, с новыми ID. Места, панорамы и QR не копируются. */
function copyPlan(doc: MapDocument, from: string, to: string): MapDocument {
  const used = new Set<string>([...doc.units, ...doc.openings, ...doc.obstacles].map((x) => x.id));
  const fresh = (prefix: string) => {
    let i = 1;
    while (used.has(`${prefix}-${i}`)) i++;
    const id = `${prefix}-${i}`;
    used.add(id);
    return id;
  };
  const unitIds = new Map<string, string>();
  for (const u of doc.units) if (u.level === from) unitIds.set(u.id, fresh('u'));
  const units: Unit[] = doc.units
    .filter((u) => u.level === from)
    .map((u) => ({ ...u, id: unitIds.get(u.id)!, level: to, ...(u.parent ? { parent: unitIds.get(u.parent) ?? u.parent } : {}) }));
  const openings = doc.openings
    .filter((o) => o.level === from && o.units.every((id) => unitIds.has(id)))
    .map((o) => ({ ...o, id: fresh('d'), level: to, units: o.units.map((id) => unitIds.get(id)!) as typeof o.units }));
  const obstacles = doc.obstacles.filter((o) => o.level === from).map((o) => ({ ...o, id: fresh('ob'), level: to }));
  return { ...doc, units: [...doc.units, ...units], openings: [...doc.openings, ...openings], obstacles: [...doc.obstacles, ...obstacles] };
}

export function renameLevel(doc: MapDocument, id: string, name: string): MapDocument {
  return { ...doc, levels: doc.levels.map((l) => (l.id === id ? { ...l, name } : l)) };
}

/** Поменять этаж местами с соседним: direction 1 — выше, −1 — ниже. */
export function moveLevel(doc: MapDocument, id: string, direction: 1 | -1): MapDocument {
  const order = sortedLevels(doc);
  const i = order.findIndex((l) => l.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= order.length) return doc;
  const a = order[i]!;
  const b = order[j]!;
  return rebuildAll({ ...doc, levels: doc.levels.map((l) => (l.id === a.id ? { ...l, ordinal: b.ordinal } : l.id === b.id ? { ...l, ordinal: a.ordinal } : l)) });
}

/** Удалить этаж со всем, что на нём. Последний этаж не удаляется. */
export function deleteLevel(doc: MapDocument, id: string): MapDocument {
  if (doc.levels.length <= 1 || !doc.levels.some((l) => l.id === id)) return doc;
  const off = <T extends { level: string }>(list: T[]) => list.filter((x) => x.level !== id);
  const panoramas = new Set(doc.panoramas.filter((p) => p.level === id).map((p) => p.id));
  const nodes = new Set(doc.graph.nodes.filter((n) => n.level === id).map((n) => n.id));
  const next: MapDocument = {
    ...doc,
    levels: doc.levels.filter((l) => l.id !== id),
    units: off(doc.units),
    obstacles: off(doc.obstacles),
    openings: off(doc.openings),
    graph: { nodes: off(doc.graph.nodes), edges: doc.graph.edges.filter((e) => !nodes.has(e.from) && !nodes.has(e.to)) },
    places: off(doc.places).map((p) => (p.panorama && panoramas.has(p.panorama) ? { ...p, panorama: null } : p)),
    panoramas: off(doc.panoramas).map((p) => ({ ...p, links: p.links.filter((l) => !panoramas.has(l.to)) })),
    anchors: off(doc.anchors),
    ...(doc.capturePoints ? { capturePoints: off(doc.capturePoints) } : {}),
  };
  return rebuildAll(next);
}

/** Граф всех этажей заново: после смены порядка этажей меняется, какие лестницы друг над другом. */
function rebuildAll(doc: MapDocument): MapDocument {
  let next = doc;
  for (const level of doc.levels) next = rebuildGraph(next, level.id);
  return next;
}

export interface RouteLeg {
  level: string;
  points: Vec2[];
  /** Чем этот участок заканчивается: переход на другой этаж. */
  change?: { to: string; kind: VerticalKind; floors: number };
}

/** Маршрут по этажам: участок на каждом этаже и как с него перейти на следующий. */
export function routeLegs(doc: MapDocument, graph: NavGraph, nodeIds: string[]): RouteLeg[] {
  const order = sortedLevels(doc).map((l) => l.id);
  const legs: RouteLeg[] = [];
  for (const id of nodeIds) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const last = legs[legs.length - 1];
    if (last && last.level === node.level) last.points.push(node.pos);
    else legs.push({ level: node.level, points: [node.pos] });
  }
  // Этаж, который лестница проходит насквозь, — одна точка в шахте: «на 2 этажа вверх», а не два перехода.
  const kept = legs.filter((leg, i) => i === 0 || i === legs.length - 1 || leg.points.length > 1);
  kept.forEach((leg, i) => {
    const next = kept[i + 1];
    if (!next) return;
    const end = leg.points[leg.points.length - 1]!;
    const shaft = doc.units.find((u) => u.level === leg.level && isVertical(u) && pointInUnit(end, u));
    leg.change = { to: next.level, kind: (shaft?.kind as VerticalKind | undefined) ?? 'stairs', floors: order.indexOf(next.level) - order.indexOf(leg.level) };
  });
  return kept;
}

/** Узел перехода между этажами в лестнице или лифте. */
export function verticalNodeId(unitId: string): string {
  return `an-vert-${unitId}`;
}

function round2v(p: Vec2): Vec2 {
  return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

/** Расстояние между двумя узлами перехода не меньше FLOOR_COST — A* без эвристики между этажами остаётся точным. */
export function floorEdgeWeight(kind: VerticalKind, a: Vec2, b: Vec2): number {
  return Math.max(FLOOR_COST[kind], Math.round(distance(a, b) * 100) / 100);
}
