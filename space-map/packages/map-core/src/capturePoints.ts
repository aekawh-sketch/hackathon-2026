// Точки съёмки фотосфер (ТЗ 5.4, П1): сервис сам предлагает, где снимать. Цель — чтобы панорамы
// закрыли пол каждого помещения, а соседние точки видели друг друга, в том числе через двери:
// тогда между ними есть переход и прогулка по любому маршруту идёт без разрывов (ТЗ 5.10).
// Расчёт — по плану: мебели и стёкол план не знает, поэтому точки — предложение, последнее слово за организатором.
import { distance, hasLineOfSight, pointInUnit, pointSegmentDistance, polygonArea, polygonEdges, segmentIntersection, signedArea, unitRings } from './geometry.ts';
import { NavGraph, nearestVisibleNode, routePolyline } from './graph.ts';
import type { CapturePoint, MapDocument, Opening, Unit, Vec2 } from './types.ts';

export interface CapturePlanOptions {
  /**
   * С какого расстояния панорама ещё хорошо показывает пол и стены, м. На 7 м предмет в 1 м
   * занимает ~8°, это ~90 пикселей панорамы 4096 × 2048.
   */
  radius?: number;
  /** Не ближе к стене, м: у стены половина обзора закрыта, а кадры плохо клеятся. */
  clearance?: number;
  /** Доля пола помещения, которую должны закрыть панорамы. */
  coverage?: number;
}

const DEFAULTS: Required<CapturePlanOptions> = { radius: 7, clearance: 0.7, coverage: 0.97 };

/** Минут на одну точку: ~34 кадра (ТЗ 5.4), переход к точке и проверка. Для оценки «сколько снимать». */
export const MINUTES_PER_SHOT = 3;

/** Ближе — одна точка обслуживает обе двери (двери друг напротив друга в коридоре). */
const MERGE = 1.5;
/** Точка у двери — на оси двери, на середине глубины помещения, но не дальше этого. */
const DOOR_DEPTH_MAX = 3;
const DOOR_DEPTH_MIN = 0.6;
/** Сколько точек сетки на помещение: держит расчёт быстрым и для больших залов. */
const MAX_SAMPLES = 400;
const ON_WALL = 0.05;

/** Точки, которые нужно снять или уже сняты: без убранных организатором. */
export function activeCapturePoints(doc: MapDocument, level?: string): CapturePoint[] {
  return (doc.capturePoints ?? []).filter((p) => p.origin !== 'removed' && (level === undefined || p.level === level));
}

/** Точки, которые ещё не сняты. */
export function pendingCapturePoints(doc: MapDocument, level?: string): CapturePoint[] {
  return activeCapturePoints(doc, level).filter((p) => p.panorama === null);
}

/** Сколько минут займёт съёмка оставшихся точек. */
export function captureMinutes(doc: MapDocument, level?: string): number {
  return pendingCapturePoints(doc, level).length * MINUTES_PER_SHOT;
}

/**
 * Где поставить новые рассчитанные точки, если уже есть отснятые панорамы, ручные и убранные точки.
 * Порядок расчёта:
 * 1) у каждой двери между помещениями — по точке с обеих сторон на её оси, если через эту дверь ещё никто никого не видит;
 * 2) в каждом помещении — жадное покрытие пола: точка, которая видит больше всего непокрытого пола;
 * 3) точки одного помещения, не видящие друг друга (Г-образная комната, колонна), связываются точкой у угла.
 */
export function planCapturePoints(doc: MapDocument, level: string, options: CapturePlanOptions = {}): Vec2[] {
  const opts = { ...DEFAULTS, ...options };
  const linkRange = doc.settings.linkRange;
  const units = doc.units.filter((u) => u.level === level && u.walkable && u.kind !== 'elevator');
  const fixed: Vec2[] = [
    ...doc.panoramas.filter((p) => p.level === level).map((p) => p.pos),
    ...(doc.capturePoints ?? []).filter((p) => p.level === level && (p.origin !== 'auto' || p.panorama !== null)).map((p) => p.pos),
  ];
  const added: Vec2[] = [];
  const all = () => [...fixed, ...added];
  const pointsIn = (unit: Unit) => all().filter((p) => pointInUnit(p, unit));
  const push = (p: Vec2) => {
    if (!all().some((q) => distance(p, q) < 0.05)) added.push(p);
  };

  // 1. Двери: точка с каждой стороны на оси двери — отрезок между ними проходит точно через проём.
  for (const opening of doc.openings) {
    if (opening.level !== level) continue;
    // Вход с улицы отдельной точки не требует: перехода наружу нет, пол у входа закроет покрытие.
    if (opening.units.length !== 2) continue;
    const sides = opening.units.map((id) => units.find((u) => u.id === id));
    if (sides.some((u) => !u)) continue;
    const [ua, ub] = sides as [Unit, Unit];
    if (seenThroughDoor(doc, level, opening, pointsIn(ua), pointsIn(ub), linkRange)) continue;
    const pa = doorAxisPoint(opening, ua);
    const pb = doorAxisPoint(opening, ub);
    if (!pa || !pb) continue;
    // Рядом уже есть точка, которая видит другую сторону через эту дверь, — новую не ставим.
    const reuse = (unit: Unit, near: Vec2, other: Vec2) =>
      pointsIn(unit).find((q) => distance(q, near) < MERGE && throughDoor(doc, level, opening, q, other, linkRange));
    const a = reuse(ua, pa, pb) ?? pa;
    const b = reuse(ub, pb, a) ?? pb;
    if (throughDoor(doc, level, opening, a, b, linkRange)) {
      push(a);
      push(b);
    } else {
      push(pa);
      push(pb);
    }
  }

  // 2 и 3. Покрытие пола и связность внутри каждого помещения.
  for (const unit of units) {
    const grid = unitGrid(unit, opts.clearance);
    if (grid.samples.length === 0) continue;
    const sees = (a: Vec2, b: Vec2) => distance(a, b) <= opts.radius && visibleInUnit(unit, grid.convex, a, b);
    const covered = grid.samples.map((s) => pointsIn(unit).some((p) => sees(p, s)));
    const visible = grid.candidates.map((c) => grid.samples.flatMap((s, i) => (sees(c, s) ? [i] : [])));
    const need = Math.ceil(grid.samples.length * opts.coverage);
    let count = covered.filter(Boolean).length;
    while (count < need) {
      const open = grid.samples.filter((_, i) => !covered[i]);
      const center: Vec2 = [open.reduce((s, p) => s + p[0], 0) / open.length, open.reduce((s, p) => s + p[1], 0) / open.length];
      let best = -1;
      let bestGain = 0;
      let bestD = Infinity;
      visible.forEach((list, i) => {
        const gain = list.reduce((s, j) => s + (covered[j] ? 0 : 1), 0);
        const d = distance(grid.candidates[i]!, center);
        if (gain > bestGain || (gain === bestGain && gain > 0 && d < bestD - 1e-9)) {
          best = i;
          bestGain = gain;
          bestD = d;
        }
      });
      if (best < 0) break;
      push(grid.candidates[best]!);
      for (const j of visible[best]!) covered[j] = true;
      count += bestGain;
    }
    connectInside(unit, grid, pointsIn, push, (a, b) => distance(a, b) <= linkRange && visibleInUnit(unit, grid.convex, a, b));
  }
  return added;
}

/**
 * План съёмки заново по текущему плану: рассчитанные точки пересчитываются, ручные, отснятые и убранные
 * остаются. Точки, оставшиеся вне помещений (комнату удалили), пропадают.
 * Повторный вызов без правок плана возвращает тот же документ.
 */
export function refreshCapturePoints(doc: MapDocument, options: CapturePlanOptions = {}): MapDocument {
  const existing = doc.capturePoints ?? [];
  const insideWalkable = (p: CapturePoint) => doc.units.some((u) => u.level === p.level && u.walkable && pointInUnit(p.pos, u));
  const kept = existing.filter((p) => (p.origin !== 'auto' || p.panorama !== null) && insideWalkable(p));
  const oldAuto = existing.filter((p) => p.origin === 'auto' && p.panorama === null);
  const base: MapDocument = { ...doc, capturePoints: kept };
  const used = new Set(kept.map((p) => p.id));
  const fresh: CapturePoint[] = [];
  for (const level of doc.levels) {
    for (const pos of cachedPlan(base, level.id, options)) {
      // Точка на прежнем месте сохраняет ID — выбор в редакторе не слетает.
      const same = oldAuto.find((p) => p.level === level.id && !used.has(p.id) && distance(p.pos, pos) < 0.01);
      const id = same?.id ?? freeId(used, 'cp');
      used.add(id);
      fresh.push({ id, level: level.id, pos, origin: 'auto', panorama: null });
    }
  }
  const next = [...kept, ...fresh];
  if (next.length === existing.length && next.every((p, i) => samePoint(p, existing[i]!))) return doc;
  return { ...doc, capturePoints: next };
}

export type CaptureEditResult = { ok: true; doc: MapDocument; id: string } | { ok: false; message: string };

/** Своя точка съёмки организатора. */
export function addCapturePoint(doc: MapDocument, level: string, pos: Vec2): CaptureEditResult {
  const check = placeCheck(doc, level, pos);
  if (check) return { ok: false, message: check };
  const used = new Set((doc.capturePoints ?? []).map((p) => p.id));
  const id = freeId(used, 'cp');
  const point: CapturePoint = { id, level, pos: round2v(pos), origin: 'manual', panorama: null };
  return { ok: true, doc: refreshCapturePoints({ ...doc, capturePoints: [...(doc.capturePoints ?? []), point] }), id };
}

/** Сдвинуть точку. Рассчитанная становится ручной: расчёт её больше не двигает. */
export function moveCapturePoint(doc: MapDocument, id: string, pos: Vec2): CaptureEditResult {
  const point = doc.capturePoints?.find((p) => p.id === id);
  if (!point) return { ok: false, message: 'Точка не найдена' };
  const check = placeCheck(doc, point.level, pos);
  if (check) return { ok: false, message: check };
  const capturePoints = doc.capturePoints!.map((p) =>
    p.id === id ? { ...p, pos: round2v(pos), origin: p.origin === 'auto' ? ('manual' as const) : p.origin } : p,
  );
  return { ok: true, doc: refreshCapturePoints({ ...doc, capturePoints }), id };
}

/**
 * Убрать точку. Рассчитанная остаётся как «убранная»: расчёт считает её место закрытым и не ставит
 * туда новую. Ручная удаляется. Снятая панорама при этом остаётся на плане.
 */
export function removeCapturePoint(doc: MapDocument, id: string): MapDocument {
  const point = doc.capturePoints?.find((p) => p.id === id);
  if (!point) return doc;
  const capturePoints =
    point.origin === 'auto' && point.panorama === null
      ? doc.capturePoints!.map((p) => (p.id === id ? { ...p, origin: 'removed' as const } : p))
      : doc.capturePoints!.filter((p) => p.id !== id);
  return refreshCapturePoints({ ...doc, capturePoints });
}

/** Вернуть все убранные точки этажа: расчёт расставит их заново. */
export function restoreRemovedCapturePoints(doc: MapDocument, level: string): MapDocument {
  const capturePoints = (doc.capturePoints ?? []).filter((p) => !(p.level === level && p.origin === 'removed'));
  return refreshCapturePoints({ ...doc, capturePoints });
}

/** Привязать снятую панораму к точке (после склейки). */
export function attachPanoramaToPoint(doc: MapDocument, pointId: string, panoramaId: string): MapDocument {
  return {
    ...doc,
    capturePoints: (doc.capturePoints ?? []).map((p) =>
      p.id === pointId ? { ...p, panorama: panoramaId, origin: p.origin === 'removed' ? 'manual' : p.origin } : p,
    ),
  };
}

// ── Маршрут съёмки ──

export interface CaptureLeg {
  /** Откуда: ID точки или null — старт (вход). */
  from: string | null;
  to: string;
  length: number;
  /** Линия на плане от точки до точки по проходимым местам. */
  line: Vec2[];
}

export interface CaptureRoute {
  /** Точки по порядку съёмки. */
  order: string[];
  legs: CaptureLeg[];
  length: number;
}

/**
 * В каком порядке обходить неснятые точки: от входа «ближайшая следующая» по реальным путям, затем
 * улучшение перестановками 2-opt (ТЗ 5.9, п. 21). Это маршрут для того, кто снимает.
 * @param start откуда начинает съёмку; по умолчанию — QR-якорь или вход этажа
 */
export function captureRoute(doc: MapDocument, level: string, start?: Vec2): CaptureRoute {
  const points = pendingCapturePoints(doc, level);
  if (points.length === 0) return { order: [], legs: [], length: 0 };
  const graph = new NavGraph(doc);
  const origin = start ?? defaultStart(doc, level) ?? points[0]!.pos;
  const stops: Vec2[] = [origin, ...points.map((p) => p.pos)];
  const nodes = stops.map((p) => nearestVisibleNode(doc, level, p)?.id ?? null);
  const fromNode = new Map<string, Map<string, number>>();
  const distFrom = (id: string) => {
    let d = fromNode.get(id);
    if (!d) fromNode.set(id, (d = graph.distancesFrom(id)));
    return d;
  };
  const n = stops.length;
  const cost: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = stops[i]!;
      const b = stops[j]!;
      let d = hasLineOfSight(doc, level, a, b) ? distance(a, b) : Infinity;
      const na = nodes[i];
      const nb = nodes[j];
      if (na && nb) {
        const g = distFrom(na).get(nb);
        if (g !== undefined) d = Math.min(d, distance(a, graph.nodes.get(na)!.pos) + g + distance(graph.nodes.get(nb)!.pos, b));
      }
      cost[i]![j] = cost[j]![i] = d;
    }
  }

  // Ближайшая следующая от старта (индекс 0), затем 2-opt по открытому пути с закреплённым началом.
  const tour = [0];
  const left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (left.size > 0) {
    const last = tour[tour.length - 1]!;
    let best = -1;
    for (const j of left) if (best < 0 || cost[last]![j]! < cost[last]![best]!) best = j;
    tour.push(best);
    left.delete(best);
  }
  const edge = (i: number, j: number) => (j >= tour.length ? 0 : cost[tour[i]!]![tour[j]!]!);
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < tour.length - 2; i++) {
      for (let k = i + 2; k < tour.length; k++) {
        const before = edge(i, i + 1) + edge(k, k + 1);
        const after = cost[tour[i]!]![tour[k]!]! + (k + 1 < tour.length ? cost[tour[i + 1]!]![tour[k + 1]!]! : 0);
        if (after < before - 1e-6) {
          tour.splice(i + 1, k - i, ...tour.slice(i + 1, k + 1).reverse());
          improved = true;
        }
      }
    }
  }

  const legs: CaptureLeg[] = [];
  for (let s = 1; s < tour.length; s++) {
    const i = tour[s - 1]!;
    const j = tour[s]!;
    const a = stops[i]!;
    const b = stops[j]!;
    let line: Vec2[] = [a, b];
    if (!hasLineOfSight(doc, level, a, b) && nodes[i] && nodes[j]) {
      const r = graph.route(nodes[i]!, nodes[j]!);
      if (r.ok) line = [a, ...routePolyline(graph, r.nodes), b];
      else if (nodes[i] === nodes[j]) line = [a, graph.nodes.get(nodes[i]!)!.pos, b];
    }
    legs.push({ from: i === 0 ? null : points[i - 1]!.id, to: points[j - 1]!.id, length: Number.isFinite(cost[i]![j]!) ? cost[i]![j]! : polylineLength(line), line: dedupe(line) });
  }
  return { order: legs.map((l) => l.to), legs, length: legs.reduce((s, l) => s + l.length, 0) };
}

/** Доля пола помещения, которую видят точки (отснятые панорамы и активные точки съёмки), 0…1. */
export function captureCoverage(doc: MapDocument, unitId: string, options: CapturePlanOptions = {}): number {
  const opts = { ...DEFAULTS, ...options };
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) return 0;
  const grid = unitGrid(unit, opts.clearance);
  if (grid.samples.length === 0) return 1;
  const points = [
    ...doc.panoramas.filter((p) => p.level === unit.level).map((p) => p.pos),
    ...(doc.capturePoints ?? []).filter((p) => p.level === unit.level).map((p) => p.pos),
  ].filter((p) => pointInUnit(p, unit));
  const seen = grid.samples.filter((s) => points.some((p) => distance(p, s) <= opts.radius && visibleInUnit(unit, grid.convex, p, s)));
  return seen.length / grid.samples.length;
}

// ── Расчёт ──

/** Последний расчёт по каждому этажу: правка места или подписи не пересчитывает точки заново. */
const planCache = new Map<string, { key: string; result: Vec2[] }>();

function cachedPlan(doc: MapDocument, level: string, options: CapturePlanOptions): Vec2[] {
  const key = JSON.stringify([
    options,
    doc.settings.linkRange,
    doc.units.filter((u) => u.level === level).map((u) => [u.kind, u.walkable, u.polygon, u.holes ?? null]),
    doc.openings.filter((o) => o.level === level).map((o) => [o.units, o.segment]),
    doc.panoramas.filter((p) => p.level === level).map((p) => p.pos),
    (doc.capturePoints ?? []).filter((p) => p.level === level).map((p) => [p.pos, p.origin, p.panorama]),
  ]);
  const cacheKey = `${doc.venue.id}:${level}`;
  const hit = planCache.get(cacheKey);
  if (hit && hit.key === key) return hit.result;
  const result = planCapturePoints(doc, level, options);
  planCache.set(cacheKey, { key, result });
  return result;
}

interface UnitGrid {
  /** Точки пола, которые должны попасть в обзор. */
  samples: Vec2[];
  /** Где можно встать: не ближе clearance к стенам. */
  candidates: Vec2[];
  convex: boolean;
}

function unitGrid(unit: Unit, clearance: number): UnitGrid {
  const rings = unitRings(unit);
  const edges = rings.flatMap(polygonEdges);
  const wallDist = (p: Vec2) => Math.min(...edges.map(([a, b]) => pointSegmentDistance(p, a, b)));
  const area = polygonArea(unit.polygon);
  const step = Math.max(0.5, Math.ceil(Math.sqrt(area / MAX_SAMPLES) * 2) / 2);
  const xs = unit.polygon.map((p) => p[0]);
  const ys = unit.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const samples: Vec2[] = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const p: Vec2 = [x, y];
      if (pointInUnit(p, unit)) samples.push(p);
    }
  }
  // Кандидаты — на сетке, кратной шагу: в прямоугольнике 7 × 5 м центр (3,5; 2,5) — среди них.
  const candidates: Vec2[] = [];
  let widest: { p: Vec2; d: number } | null = null;
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const p: Vec2 = [round2(x), round2(y)];
      if (!pointInUnit(p, unit)) continue;
      const d = wallDist(p);
      if (d >= clearance - 1e-9) candidates.push(p);
      if (!widest || d > widest.d) widest = { p, d };
    }
  }
  // Узкое помещение (коридор уже 1,4 м): встаём посередине.
  if (candidates.length === 0 && widest) candidates.push(widest.p);
  if (candidates.length === 0 && samples.length > 0) candidates.push(samples[0]!);
  return { samples, candidates, convex: !unit.holes?.length && isConvex(unit.polygon) };
}

function isConvex(polygon: Vec2[]): boolean {
  const sign = Math.sign(signedArea(polygon));
  return polygon.every((v, i) => {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const turn = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]);
    return turn * sign >= -1e-9;
  });
}

/** Видно ли b из a внутри помещения: отрезок не пересекает его стен и вырезов. */
function visibleInUnit(unit: Unit, convex: boolean, a: Vec2, b: Vec2): boolean {
  if (convex) return true;
  for (const [c, d] of unitRings(unit).flatMap(polygonEdges)) {
    const hit = segmentIntersection(a, b, c, d);
    if (hit && distance(hit, a) > ON_WALL && distance(hit, b) > ON_WALL) return false;
  }
  return pointInUnit([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], unit);
}

/** Точка на оси двери внутри помещения: на середине глубины помещения вдоль оси, от 0,6 до 3 м. */
function doorAxisPoint(opening: Opening, unit: Unit): Vec2 | null {
  const [p, q] = opening.segment;
  const len = distance(p, q);
  if (len < 1e-6) return null;
  const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let normal: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
  if (!pointInUnit([mid[0] + normal[0] * 0.3, mid[1] + normal[1] * 0.3], unit)) normal = [-normal[0], -normal[1]];
  if (!pointInUnit([mid[0] + normal[0] * 0.3, mid[1] + normal[1] * 0.3], unit)) return null;
  // Глубина помещения по оси двери — до ближайшей стены напротив.
  const far: Vec2 = [mid[0] + normal[0] * 100, mid[1] + normal[1] * 100];
  let depth = 100;
  for (const [c, d] of unitRings(unit).flatMap(polygonEdges)) {
    const hit = segmentIntersection(mid, far, c, d);
    if (hit) {
      const t = distance(mid, hit);
      if (t > ON_WALL && t < depth) depth = t;
    }
  }
  const along = Math.max(DOOR_DEPTH_MIN, Math.min(DOOR_DEPTH_MAX, depth / 2));
  const pos = round2v([mid[0] + normal[0] * along, mid[1] + normal[1] * along]);
  return pointInUnit(pos, unit) ? pos : null;
}

/** Отрезок ab проходит через проём и ничем не перекрыт — между точками будет переход. */
function throughDoor(doc: MapDocument, level: string, opening: Opening, a: Vec2, b: Vec2, linkRange: number): boolean {
  return distance(a, b) <= linkRange && !!segmentIntersection(a, b, opening.segment[0], opening.segment[1]) && hasLineOfSight(doc, level, a, b);
}

function seenThroughDoor(doc: MapDocument, level: string, opening: Opening, as: Vec2[], bs: Vec2[], linkRange: number): boolean {
  return as.some((a) => bs.some((b) => throughDoor(doc, level, opening, a, b, linkRange)));
}

/** Точки одного помещения, не видящие друг друга, связываем точкой, которую видят обе группы. */
function connectInside(
  unit: Unit,
  grid: UnitGrid,
  pointsIn: (u: Unit) => Vec2[],
  push: (p: Vec2) => void,
  linked: (a: Vec2, b: Vec2) => boolean,
): void {
  for (let guard = 0; guard < 10; guard++) {
    const points = pointsIn(unit);
    if (points.length < 2) return;
    const group = points.map((_, i) => i);
    const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) if (linked(points[i]!, points[j]!)) group[root(i)] = root(j);
    }
    const roots = [...new Set(points.map((_, i) => root(i)))];
    if (roots.length < 2) return;
    const first = points.filter((_, i) => root(i) === roots[0]);
    const rest = points.filter((_, i) => root(i) !== roots[0]);
    let best: { p: Vec2; score: number } | null = null;
    for (const c of grid.candidates) {
      const a = first.filter((p) => linked(c, p));
      const b = rest.filter((p) => linked(c, p));
      if (a.length === 0 || b.length === 0) continue;
      const score = Math.min(...a.map((p) => distance(c, p))) + Math.min(...b.map((p) => distance(c, p)));
      if (!best || score < best.score - 1e-9) best = { p: c, score };
    }
    if (!best) return;
    push(best.p);
  }
}

function placeCheck(doc: MapDocument, level: string, pos: Vec2): string | null {
  const unit = doc.units.find((u) => u.level === level && pointInUnit(pos, u));
  if (!unit) return 'Точка съёмки должна стоять внутри помещения';
  if (!unit.walkable) return 'В это помещение посетителей не пускают — снимать там не нужно';
  const wall = Math.min(...unitRings(unit).flatMap(polygonEdges).map(([a, b]) => pointSegmentDistance(pos, a, b)));
  if (wall < 0.3) return 'Слишком близко к стене — отойдите хотя бы на 30 см';
  return null;
}

function defaultStart(doc: MapDocument, level: string): Vec2 | null {
  const anchor = doc.anchors.find((a) => a.level === level);
  if (anchor) return anchor.pos;
  const entrance = doc.openings.find((o) => o.level === level && o.kind === 'entrance');
  if (!entrance) return null;
  const unit = doc.units.find((u) => u.id === entrance.units[0]);
  return unit ? doorAxisPoint(entrance, unit) : null;
}

function samePoint(a: CapturePoint, b: CapturePoint): boolean {
  return a.id === b.id && a.level === b.level && a.origin === b.origin && a.panorama === b.panorama && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1];
}

function freeId(used: Set<string>, prefix: string): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!used.has(id)) return id;
  }
}

function polylineLength(line: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distance(line[i - 1]!, line[i]!);
  return s;
}

function dedupe(line: Vec2[]): Vec2[] {
  return line.filter((p, i) => i === 0 || distance(p, line[i - 1]!) > 0.01);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round2v(p: Vec2): Vec2 {
  return [round2(p[0]), round2(p[1])];
}

