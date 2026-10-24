// Правка плана в редакторе: помещения (создать, сдвинуть, изменить форму, удалить), места, двери и граф.
// Все функции чистые: принимают документ и возвращают новый — так работают «Отменить / Повторить».
import { acceptSuggestions, pinnedMarkers } from './panorama.ts';
import { distance, hasLineOfSight, pointInPolygon, pointInUnit, pointSegmentDistance, polygonArea, polygonEdges, segmentIntersection, signedArea, unitAt, unitRings } from './geometry.ts';
import type { MapDocument, NavEdge, NavNode, Opening, Place, Unit, UnitKind, Vec2 } from './types.ts';

/** Шаг сетки редактора, метры. */
export const GRID = 0.5;
const EPS = 1e-6;
const ON_WALL = 0.05;

export function snap(v: number, step = GRID): number {
  return Math.round(v / step) * step;
}

export function snapPoint(p: Vec2, step = GRID): Vec2 {
  return [snap(p[0], step), snap(p[1], step)];
}

/** ID, которого ещё нет среди сущностей документа. */
export function newId(doc: MapDocument, prefix: string): string {
  const used = new Set<string>([
    ...doc.units.map((u) => u.id),
    ...doc.places.map((p) => p.id),
    ...doc.openings.map((o) => o.id),
    ...doc.obstacles.map((o) => o.id),
    ...doc.graph.nodes.map((n) => n.id),
    ...doc.graph.edges.map((e) => e.id),
  ]);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!used.has(id)) return id;
  }
}

export function rectPolygon(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Прямоугольник со сторонами вдоль осей — для него редактор меняет ширину и глубину. */
export function isAxisRect(polygon: Vec2[]): boolean {
  if (polygon.length !== 4) return false;
  return polygonEdges(polygon).every(([a, b]) => Math.abs(a[0] - b[0]) < EPS || Math.abs(a[1] - b[1]) < EPS);
}

export function polygonBounds(polygon: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...polygon.map((p) => p[0])),
    minY: Math.min(...polygon.map((p) => p[1])),
    maxX: Math.max(...polygon.map((p) => p[0])),
    maxY: Math.max(...polygon.map((p) => p[1])),
  };
}

// ── Пересечения помещений ──

function strictlyInside(p: Vec2, polygon: Vec2[]): boolean {
  if (!pointInPolygon(p, polygon)) return false;
  return polygonEdges(polygon).every(([a, b]) => pointSegmentDistance(p, a, b) > ON_WALL);
}

function properCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const hit = segmentIntersection(a, b, c, d);
  if (!hit) return false;
  // Касание вершиной или стыковка по стене — не пересечение.
  return [a, b, c, d].every((p) => distance(hit, p) > ON_WALL);
}

/** Помещения налезают друг на друга (общая стена и касание углом — не налезают). */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const [p, q] of polygonEdges(a)) {
    for (const [r, s] of polygonEdges(b)) if (properCrossing(p, q, r, s)) return true;
  }
  if (a.some((p) => strictlyInside(p, b)) || b.some((p) => strictlyInside(p, a))) return true;
  // Совпадающие или вложенные целиком с общими стенами: проверяем середины.
  const center = (poly: Vec2[]): Vec2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return strictlyInside(center(a), b) || strictlyInside(center(b), a);
}

/** Помещения, с которыми пересекается полигон (кроме `except`). */
export function overlappingUnits(doc: MapDocument, level: string, polygon: Vec2[], except?: string): Unit[] {
  const isAncestor = (ancestor: string, child: string) => {
    let current = doc.units.find((u) => u.id === child);
    while (current?.parent) {
      if (current.parent === ancestor) return true;
      current = doc.units.find((u) => u.id === current!.parent);
    }
    return false;
  };
  return doc.units.filter((u) =>
    u.level === level && u.id !== except && polygonsOverlap(polygon, u.polygon) &&
    !(except && (isAncestor(except, u.id) || isAncestor(u.id, except))),
  );
}

/** Проверяет новую комнату: она может быть свободной либо целиком вложенной в одно существующее помещение. */
export function roomPlacement(doc: MapDocument, level: string, polygon: Vec2[]): { valid: boolean; parent: Unit | null } {
  const center: Vec2 = [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];
  const candidate = unitAt(doc, level, center);
  const nested = !!candidate?.walkable && polygon.every((p) => pointInUnit(p, candidate));
  const ancestors = new Set<string>();
  let ancestor = candidate?.parent ? doc.units.find((u) => u.id === candidate.parent) : undefined;
  while (ancestor) {
    ancestors.add(ancestor.id);
    ancestor = ancestor.parent ? doc.units.find((u) => u.id === ancestor!.parent) : undefined;
  }
  const overlaps = overlappingUnits(doc, level, polygon).filter((u) => u.id !== candidate?.id && !ancestors.has(u.id));
  const parent = nested ? candidate : null;
  return { valid: overlaps.length === 0 && (!candidate || nested), parent };
}

// ── Общие стены и двери ──

/** Куски границ двух полигонов, лежащие на одной прямой и перекрывающиеся. */
export function sharedWalls(a: Vec2[], b: Vec2[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (const [p, q] of polygonEdges(a)) {
    const len = distance(p, q);
    if (len < EPS) continue;
    const dir: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    for (const [r, s] of polygonEdges(b)) {
      if (pointLineDist(r, p, dir) > ON_WALL || pointLineDist(s, p, dir) > ON_WALL) continue;
      const tr = dot(sub(r, p), dir);
      const ts = dot(sub(s, p), dir);
      const t0 = Math.max(0, Math.min(tr, ts));
      const t1 = Math.min(len, Math.max(tr, ts));
      if (t1 - t0 > 0.1) out.push([add(p, scale(dir, t0)), add(p, scale(dir, t1))]);
    }
  }
  return out;
}

/** Общие стены помещений, включая границу внутренней комнаты, записанную как вырез родителя. */
export function sharedUnitWalls(a: Unit, b: Unit): [Vec2, Vec2][] {
  return unitRings(a).flatMap((ringA) => unitRings(b).flatMap((ringB) => sharedWalls(ringA, ringB)));
}

function onBoundary(segment: [Vec2, Vec2], unit: Unit): boolean {
  return unitRings(unit).flatMap(polygonEdges).some(
    ([a, b]) => pointSegmentDistance(segment[0], a, b) < ON_WALL && pointSegmentDistance(segment[1], a, b) < ON_WALL,
  );
}

/** Проход, который больше не стоит на общей стене своих помещений, превращается в стену. */
export function reconcileOpenings(doc: MapDocument): MapDocument {
  const units = new Map(doc.units.map((u) => [u.id, u]));
  const openings = doc.openings.filter((o) =>
    o.units.every((id) => {
      const u = units.get(id);
      return !!u && onBoundary(o.segment, u);
    }),
  );
  return openings.length === doc.openings.length ? doc : { ...doc, openings };
}

const HUB_KINDS: UnitKind[] = ['corridor', 'lobby', 'hall'];

function isConnected(doc: MapDocument, unitId: string): boolean {
  return doc.openings.some((o) => hasUnit(o, unitId) && (o.units.length === 2 || o.kind === 'entrance'));
}

/**
 * Если в помещение не ведёт ни одна дверь — ставим дверь посередине самой длинной общей стены,
 * предпочитая коридор и холл, чтобы новая комната сразу попадала в маршруты.
 */
export function autoConnect(doc: MapDocument, unitId: string): MapDocument {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit || !unit.walkable || isConnected(doc, unitId)) return doc;
  let best: { other: Unit; wall: [Vec2, Vec2]; score: number } | null = null;
  for (const other of doc.units) {
    if (other.id === unit.id || other.level !== unit.level || !other.walkable) continue;
    for (const wall of sharedUnitWalls(unit, other)) {
      const len = distance(wall[0], wall[1]);
      if (len < 0.8) continue;
      const score = len + (HUB_KINDS.includes(other.kind) ? 1000 : 0);
      if (!best || score > best.score) best = { other, wall, score };
    }
  }
  if (!best) return doc;
  const [p, q] = best.wall;
  const len = distance(p, q);
  const width = Math.min(1.2, len - 0.4);
  const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const dir: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const opening: Opening = {
    id: newId(doc, 'd'),
    level: unit.level,
    kind: 'door',
    segment: [round2v(add(mid, scale(dir, -width / 2))), round2v(add(mid, scale(dir, width / 2)))],
    units: [best.other.id, unit.id],
  };
  return { ...doc, openings: [...doc.openings, opening] };
}

/** Дверь в общей стене двух помещений в точке `at` (ближайшая точка стены). */
export function addDoor(doc: MapDocument, a: string, b: string, at?: Vec2): MapDocument {
  const ua = doc.units.find((u) => u.id === a);
  const ub = doc.units.find((u) => u.id === b);
  if (!ua || !ub) return doc;
  const walls = sharedUnitWalls(ua, ub).filter(([p, q]) => distance(p, q) >= 0.8);
  if (walls.length === 0) return doc;
  const target = at ?? midpoint(walls[0]!);
  const wall = walls.reduce((w, cur) => (pointSegmentDistance(target, cur[0], cur[1]) < pointSegmentDistance(target, w[0], w[1]) ? cur : w));
  const [p, q] = wall;
  const len = distance(p, q);
  const dir: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const width = Math.min(1.2, len - 0.4);
  const t = Math.max(width / 2 + 0.2, Math.min(len - width / 2 - 0.2, dot(sub(target, p), dir)));
  const mid = add(p, scale(dir, t));
  const opening: Opening = {
    id: newId(doc, 'd'),
    level: ua.level,
    kind: 'door',
    segment: [round2v(add(mid, scale(dir, -width / 2))), round2v(add(mid, scale(dir, width / 2)))],
    units: [a, b],
  };
  return { ...doc, openings: [...doc.openings, opening] };
}

export function deleteOpening(doc: MapDocument, id: string): MapDocument {
  return { ...doc, openings: doc.openings.filter((o) => o.id !== id) };
}

/** Помещения, граничащие с данным по стене длиной от 0,8 м. */
export function neighbours(doc: MapDocument, unitId: string): Unit[] {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) return [];
  return doc.units.filter(
    (u) => u.id !== unitId && u.level === unit.level && sharedUnitWalls(unit, u).some(([p, q]) => distance(p, q) >= 0.8),
  );
}

// ── Помещения ──

export const UNIT_KIND_NAMES: Record<UnitKind, string> = {
  room: 'Комната',
  corridor: 'Коридор',
  hall: 'Зал',
  lobby: 'Холл',
  stairs: 'Лестница',
  elevator: 'Лифт',
  restroom: 'Туалет',
  service: 'Служебное',
  outdoor: 'Улица',
};

export interface CreateRoomOptions {
  name?: string;
  kind?: UnitKind;
}

/** Новое помещение. Возвращает документ и ID; граф достраивается сам, дверь организатор ставит вручную. */
export function createRoom(doc: MapDocument, level: string, polygon: Vec2[], options: CreateRoomOptions = {}): { doc: MapDocument; id: string } {
  const id = newId(doc, 'u');
  const { parent } = roomPlacement(doc, level, polygon);
  const kind = options.kind ?? 'room';
  const count = doc.units.filter((u) => u.kind === kind).length + 1;
  const unit: Unit = {
    id,
    level,
    ...(parent ? { parent: parent.id } : {}),
    kind,
    name: options.name ?? `${UNIT_KIND_NAMES[kind]} ${count}`,
    walkable: kind !== 'service',
    polygon: polygon.map(round2v),
  };
  const units = doc.units.map((u) => u.id === parent?.id ? { ...u, holes: [...(u.holes ?? []), unit.polygon] } : u);
  return { doc: rebuildGraph({ ...doc, units: [...units, unit] }, level), id };
}

export function updateUnit(doc: MapDocument, id: string, patch: Partial<Pick<Unit, 'name' | 'kind' | 'walkable'>>): MapDocument {
  let next: MapDocument = { ...doc, units: doc.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) };
  if (patch.walkable !== undefined || patch.kind !== undefined) {
    const unit = next.units.find((u) => u.id === id);
    if (unit) next = rebuildGraph(next, unit.level);
  }
  return next;
}

function samePolygon(a: Vec2[], b: Vec2[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < EPS && Math.abs(p[1] - b[i]![1]) < EPS);
}

/**
 * Сдвиг помещения вместе со всем, что внутри: вырезы, места, препятствия, панорамы, QR-якоря и его двери.
 * Двери, оторвавшиеся от соседей, исчезают — новую организатор ставит сам.
 */
export function translateUnit(doc: MapDocument, id: string, delta: Vec2): MapDocument {
  const unit = doc.units.find((u) => u.id === id);
  if (!unit || (Math.abs(delta[0]) < EPS && Math.abs(delta[1]) < EPS)) return doc;
  const movedIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of doc.units) {
      if (candidate.parent && movedIds.has(candidate.parent) && !movedIds.has(candidate.id)) {
        movedIds.add(candidate.id);
        changed = true;
      }
    }
  }
  const inside = (p: Vec2) => pointInPolygon(p, unit.polygon);
  const move = (p: Vec2): Vec2 => round2v([p[0] + delta[0], p[1] + delta[1]]);
  const centroid = (poly: Vec2[]): Vec2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  const same = (lvl: string) => lvl === unit.level;

  const before = new Set(doc.openings.map((o) => o.id));
  const moved: MapDocument = {
    ...doc,
    units: doc.units.map((u) => {
      if (movedIds.has(u.id)) return { ...u, polygon: u.polygon.map(move), ...(u.holes ? { holes: u.holes.map((h) => h.map(move)) } : {}) };
      if (u.id === unit.parent) return { ...u, holes: (u.holes ?? []).map((hole) => samePolygon(hole, unit.polygon) ? unit.polygon.map(move) : hole) };
      return u;
    }),
    places: doc.places.map((p) => (same(p.level) && inside(p.pos) ? { ...p, pos: move(p.pos), polygon: p.polygon?.map(move) ?? null } : p)),
    obstacles: doc.obstacles.map((o) => (same(o.level) && inside(centroid(o.polygon)) ? { ...o, polygon: o.polygon.map(move) } : o)),
    panoramas: doc.panoramas.map((pa) => (same(pa.level) && inside(pa.pos) ? { ...pa, pos: move(pa.pos) } : pa)),
    anchors: doc.anchors.map((a) => (same(a.level) && inside(a.pos) ? { ...a, pos: move(a.pos) } : a)),
    openings: doc.openings.map((o) => (o.units.some((unitId) => movedIds.has(unitId)) ? { ...o, segment: [move(o.segment[0]), move(o.segment[1])] as [Vec2, Vec2] } : o)),
    ...(doc.capturePoints ? { capturePoints: doc.capturePoints.map((c) => (same(c.level) && inside(c.pos) ? { ...c, pos: move(c.pos) } : c)) } : {}),
  };
  return afterGeometryChange(moved, unit.level, id, before);
}

/** Новая форма помещения (перетаскивание вершин, ширина и глубина в инспекторе). Вырезы, оставшиеся снаружи, пропадают. */
export function setUnitPolygon(doc: MapDocument, id: string, polygon: Vec2[]): MapDocument {
  const unit = doc.units.find((u) => u.id === id);
  if (!unit || polygon.length < 3 || polygonArea(polygon) < 0.5) return doc;
  const before = new Set(doc.openings.map((o) => o.id));
  const shape = polygon.map(round2v);
  if (doc.units.some((child) => child.parent === id && !child.polygon.every((p) => pointInPolygon(p, shape)))) return doc;
  const holes = unit.holes?.filter((h) => h.every((p) => strictlyInside(p, shape)));
  const next: MapDocument = {
    ...doc,
    units: doc.units.map((u) => {
      if (u.id === id) return { ...u, polygon: shape, ...(holes ? { holes } : {}) };
      if (u.id === unit.parent) return { ...u, holes: (u.holes ?? []).map((hole) => samePolygon(hole, unit.polygon) ? shape : hole) };
      return u;
    }),
  };
  return afterGeometryChange(next, unit.level, id, before);
}

/** Прямоугольник: новая ширина и глубина, левый нижний угол на месте. */
export function resizeRect(doc: MapDocument, id: string, width: number, depth: number): MapDocument {
  const unit = doc.units.find((u) => u.id === id);
  if (!unit || !isAxisRect(unit.polygon) || width < 1 || depth < 1) return doc;
  const b = polygonBounds(unit.polygon);
  return setUnitPolygon(doc, id, rectPolygon([b.minX, b.minY], [b.minX + width, b.minY + depth]));
}

/** После изменения формы: двери, ушедшие со своей стены, превращаются в стену; граф — заново. Новых дверей сами не ставим. */
function afterGeometryChange(doc: MapDocument, level: string, _changed: string, _openingsBefore: Set<string>): MapDocument {
  return rebuildGraph(reconcileOpenings(doc), level);
}

/** Удалить помещение с дверями и всем, что внутри. */
export function deleteUnit(doc: MapDocument, id: string): MapDocument {
  const unit = doc.units.find((u) => u.id === id);
  if (!unit) return doc;
  const removedIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of doc.units) {
      if (child.parent && removedIds.has(child.parent) && !removedIds.has(child.id)) {
        removedIds.add(child.id);
        changed = true;
      }
    }
  }
  const inside = (p: Vec2) => pointInPolygon(p, unit.polygon);
  const same = (lvl: string) => lvl === unit.level;
  const gonePlaces = new Set(doc.places.filter((p) => same(p.level) && inside(p.pos)).map((p) => p.id));
  const gonePanos = new Set(doc.panoramas.filter((p) => same(p.level) && inside(p.pos)).map((p) => p.id));
  const next: MapDocument = {
    ...doc,
    units: doc.units
      .filter((u) => !removedIds.has(u.id))
      .map((u) => u.id === unit.parent ? { ...u, holes: (u.holes ?? []).filter((hole) => !samePolygon(hole, unit.polygon)) } : u),
    openings: doc.openings.filter((o) => !o.units.some((unitId) => removedIds.has(unitId))),
    obstacles: doc.obstacles.filter((o) => !(same(o.level) && o.polygon.every(inside))),
    places: doc.places.filter((p) => !gonePlaces.has(p.id)),
    anchors: doc.anchors.filter((a) => !(same(a.level) && inside(a.pos))),
    ...(doc.capturePoints ? { capturePoints: doc.capturePoints.filter((c) => !(same(c.level) && inside(c.pos))) } : {}),
    panoramas: doc.panoramas
      .filter((pa) => !gonePanos.has(pa.id))
      .map((pa) => ({
        ...pa,
        markers: pa.markers.filter((m) => !gonePlaces.has(m.place)),
        links: pa.links.filter((l) => !gonePanos.has(l.to)),
      })),
  };
  return rebuildGraph(next, unit.level);
}

/** Копия помещения рядом (справа, если там свободно, иначе сверху). */
export function duplicateUnit(doc: MapDocument, id: string): { doc: MapDocument; id: string } | null {
  const unit = doc.units.find((u) => u.id === id);
  if (!unit) return null;
  const b = polygonBounds(unit.polygon);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const candidates: Vec2[] = [
    [w, 0],
    [0, h],
    [-w, 0],
    [0, -h],
  ];
  for (const [dx, dy] of candidates) {
    const polygon = unit.polygon.map((p) => [p[0] + dx, p[1] + dy] as Vec2);
    if (roomPlacement(doc, unit.level, polygon).valid) {
      return createRoom(doc, unit.level, polygon, { kind: unit.kind, name: `${unit.name} (копия)` });
    }
  }
  return null;
}

// ── Места ──

export function movePlace(doc: MapDocument, id: string, pos: Vec2): MapDocument {
  const place = doc.places.find((p) => p.id === id);
  if (!place) return doc;
  const delta: Vec2 = [pos[0] - place.pos[0], pos[1] - place.pos[1]];
  const move = (point: Vec2): Vec2 => round2v([point[0] + delta[0], point[1] + delta[1]]);
  const next: MapDocument = {
    ...doc,
    places: doc.places.map((p) => (p.id === id ? { ...p, pos: move(p.pos), polygon: p.polygon?.map(move) ?? null } : p)),
  };
  return rebuildGraph(next, place.level);
}

export function updatePlace(doc: MapDocument, id: string, patch: Partial<Pick<Place, 'name' | 'category' | 'description' | 'number' | 'hours' | 'hidden'>>): MapDocument {
  return { ...doc, places: doc.places.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Привязать к месту его панораму (снятую из карточки места) или отвязать — null. */
export function setPlacePanorama(doc: MapDocument, placeId: string, panoramaId: string | null): MapDocument {
  return { ...doc, places: doc.places.map((p) => (p.id === placeId ? { ...p, panorama: panoramaId } : p)) };
}

export function addPlace(doc: MapDocument, level: string, pos: Vec2, category: string, name = 'Новое место'): { doc: MapDocument; id: string } {
  const id = newId(doc, 'p');
  const place: Place = {
    id,
    level,
    pos: round2v(pos),
    node: null,
    polygon: null,
    name,
    category,
    number: null,
    description: '',
    photos: [],
    hours: null,
    hidden: false,
    // Новое место без панорамы, пока её не снимут для него: чужая панорама рядом — не его.
    panorama: null,
  };
  return { doc: rebuildGraph({ ...doc, places: [...doc.places, place] }, level), id };
}

// ── Граф маршрутов ──

const APPROACH = 0.6;

/**
 * Граф этажа заново из плана: у каждой двери по узлу с обеих сторон, у каждого места и панорамы — свой узел;
 * внутри помещения узлы соединяются по прямой видимости. Веса — длины в метрах, поэтому A* остаётся точным.
 */
export function rebuildGraph(doc: MapDocument, level: string): MapDocument {
  const units = doc.units.filter((u) => u.level === level && u.walkable);
  const nodes: NavNode[] = doc.graph.nodes.filter((n) => n.level !== level);
  const keepIds = new Set(nodes.map((n) => n.id));
  const edges: NavEdge[] = doc.graph.edges.filter((e) => keepIds.has(e.from) && keepIds.has(e.to));
  const byUnit = new Map<string, NavNode[]>(units.map((u) => [u.id, []]));
  const unitOf = (p: Vec2) => units.find((u) => pointInUnit(p, u));

  let edgeNo = 0;
  const edgeId = () => `ae-${level}-${++edgeNo}`;
  const link = (a: NavNode, b: NavNode) => {
    const w = Math.round(distance(a.pos, b.pos) * 100) / 100;
    edges.push({ id: edgeId(), from: a.id, to: b.id, weight: Math.max(w, 0.01), access: 'public' });
  };

  for (const o of doc.openings) {
    if (o.level !== level) continue;
    const [p, q] = o.segment;
    const len = distance(p, q);
    if (len < EPS) continue;
    const mid = midpoint(o.segment);
    const normal: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
    const sides: NavNode[] = [];
    for (const sign of [1, -1]) {
      const pos = round2v(add(mid, scale(normal, sign * APPROACH)));
      const unit = unitOf(pos);
      if (!unit || !hasUnit(o, unit.id)) continue;
      const node: NavNode = { id: `an-${o.id}-${sign > 0 ? 'a' : 'b'}`, level, pos, origin: 'auto' };
      nodes.push(node);
      byUnit.get(unit.id)!.push(node);
      sides.push(node);
    }
    if (sides.length === 2) link(sides[0]!, sides[1]!);
  }

  const places = doc.places.map((pl) => {
    if (pl.level !== level) return pl;
    const unit = unitOf(pl.pos);
    if (!unit) return { ...pl, node: null };
    const node: NavNode = { id: `an-place-${pl.id}`, level, pos: pl.pos, origin: 'auto' };
    nodes.push(node);
    byUnit.get(unit.id)!.push(node);
    return { ...pl, node: node.id };
  });

  const panoramas = doc.panoramas.map((pa) => {
    if (pa.level !== level) return pa;
    const unit = unitOf(pa.pos);
    if (!unit) return { ...pa, node: null };
    const node: NavNode = { id: `an-pano-${pa.id}`, level, pos: pa.pos, origin: 'auto' };
    nodes.push(node);
    byUnit.get(unit.id)!.push(node);
    return { ...pa, node: node.id };
  });

  // Узлы у вогнутых углов комнаты и у углов вырезов: путь огибает колонну или угол Г-образной комнаты,
  // а не обрывается, когда двери не видят друг друга.
  for (const unit of units) {
    cornerPoints(unit).forEach((pos, i) => {
      const node: NavNode = { id: `an-corner-${unit.id}-${i}`, level, pos, origin: 'auto' };
      nodes.push(node);
      byUnit.get(unit.id)!.push(node);
    });
  }

  const next: MapDocument = { ...doc, places, panoramas, graph: { nodes, edges } };
  for (const unit of units) {
    const list = byUnit.get(unit.id)!;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (pointInUnit(midpoint([a.pos, b.pos]), unit) && hasLineOfSight(next, level, a.pos, b.pos)) link(a, b);
      }
    }
  }
  return next;
}

/**
 * Метки мест в панорамах заново по плану (после сдвига помещений), переходы между панорамами сохраняются.
 * Места, поставленные точкой вручную, остаются там, куда нажал организатор.
 */
export function refreshPanoramaMarkers(doc: MapDocument): MapDocument {
  let next: MapDocument = { ...doc, panoramas: doc.panoramas.map((pa) => ({ ...pa, markers: pinnedMarkers(doc, pa) })) };
  for (const pa of next.panoramas) next = acceptSuggestions(next, pa.id);
  // acceptSuggestions мог добавить новые переходы — оставляем только прежние.
  const links = new Map(doc.panoramas.map((pa) => [pa.id, pa.links]));
  return { ...next, panoramas: next.panoramas.map((pa) => ({ ...pa, links: links.get(pa.id) ?? pa.links })) };
}

const CORNER_OFFSET = 0.4;

/**
 * Точки обхода углов: у вогнутых вершин внешнего контура и у выпуклых вершин вырезов —
 * сдвиг на CORNER_OFFSET внутрь проходимой части по биссектрисе угла.
 */
function cornerPoints(unit: Unit): Vec2[] {
  const out: Vec2[] = [];
  unitRings(unit).forEach((ring, ringIndex) => {
    const orientation = Math.sign(signedArea(ring));
    ring.forEach((v, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const next = ring[(i + 1) % ring.length]!;
      const turn = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]);
      // Внешний контур: нужен поворот против обхода (вогнутый угол); вырез: по обходу (колонна выпирает в комнату).
      const needed = ringIndex === 0 ? turn * orientation < -EPS : turn * orientation > EPS;
      if (!needed) return;
      const a = unitVec(sub(prev, v));
      const b = unitVec(sub(next, v));
      const bis = unitVec(add(a, b));
      if (Math.hypot(bis[0], bis[1]) < EPS) return;
      const pos = round2v(add(v, scale(bis, -CORNER_OFFSET)));
      if (pointInUnit(pos, unit)) out.push(pos);
    });
  });
  return out;
}

function unitVec(a: Vec2): Vec2 {
  const len = Math.hypot(a[0], a[1]);
  return len < EPS ? [0, 0] : [a[0] / len, a[1] / len];
}

function hasUnit(o: Opening, unitId: string): boolean {
  return (o.units as readonly string[]).includes(unitId);
}

// ── Векторы ──

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}
function scale(a: Vec2, k: number): Vec2 {
  return [a[0] * k, a[1] * k];
}
function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}
function midpoint([a, b]: [Vec2, Vec2]): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
function pointLineDist(p: Vec2, origin: Vec2, dir: Vec2): number {
  const v = sub(p, origin);
  return Math.abs(v[0] * dir[1] - v[1] * dir[0]);
}
function round2v(p: Vec2): Vec2 {
  return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}
