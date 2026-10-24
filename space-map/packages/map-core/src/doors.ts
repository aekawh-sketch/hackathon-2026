// Двери и проёмы: постановка по центру стены, растягивание вдоль стены, створки для плана и 3D.
import { distance, pointInUnit, pointSegmentDistance, polygonArea, polygonEdges } from './geometry.ts';
import { sharedUnitWalls } from './edit.ts';
import type { DoorStyle, MapDocument, Opening, Unit, Vec2 } from './types.ts';

export type DoorType = 'single' | 'double' | 'passage';

/** Настройки новой двери в редакторе: применяются к двери в момент постановки. */
export interface DoorPreset {
  type: DoorType;
  openAngle: number;
}

export const DEFAULT_DOOR_PRESET: DoorPreset = { type: 'single', openAngle: 90 };

export const DOOR_WIDTH: Record<DoorType, number> = { single: 0.9, double: 1.6, passage: 1.2 };
export const DOOR_MIN_WIDTH = 0.6;
/** Отступ двери от угла комнаты и от соседнего проёма. */
export const JAMB = 0.15;

const ON_WALL = 0.05;
const DOOR_MIN_WALL = DOOR_MIN_WIDTH + 2 * JAMB;

type Wall = [Vec2, Vec2];

// ── Стена проёма и свободные участки ──

/** Отрезок стены, на которой стоит проём: общая стена двух помещений или граница помещения у входа. */
export function openingWall(doc: MapDocument, o: Opening): Wall | null {
  const units = o.units.map((id) => doc.units.find((u) => u.id === id));
  if (units.some((u) => !u)) return null;
  const candidates: Wall[] = units.length === 2 ? sharedUnitWalls(units[0]!, units[1]!) : polygonEdges(units[0]!.polygon);
  return candidates.find(([a, b]) => pointSegmentDistance(o.segment[0], a, b) < ON_WALL && pointSegmentDistance(o.segment[1], a, b) < ON_WALL) ?? null;
}

/** Положение точки вдоль стены, метры от её начала. */
function along(wall: Wall, p: Vec2): number {
  const [a, b] = wall;
  const len = distance(a, b);
  return ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
}

function pointAt(wall: Wall, t: number): Vec2 {
  const [a, b] = wall;
  const len = distance(a, b);
  return [round2(a[0] + ((b[0] - a[0]) * t) / len), round2(a[1] + ((b[1] - a[1]) * t) / len)];
}

/** Участки стены, где может стоять дверь: без других проёмов, с отступом JAMB от углов и соседей. */
export function freeIntervals(doc: MapDocument, wall: Wall, exceptId?: string): [number, number][] {
  const len = distance(wall[0], wall[1]);
  let free: [number, number][] = [[JAMB, len - JAMB]];
  for (const o of doc.openings) {
    if (o.id === exceptId) continue;
    if (pointSegmentDistance(o.segment[0], wall[0], wall[1]) > ON_WALL || pointSegmentDistance(o.segment[1], wall[0], wall[1]) > ON_WALL) continue;
    const t0 = along(wall, o.segment[0]);
    const t1 = along(wall, o.segment[1]);
    free = cut(free, Math.min(t0, t1) - JAMB, Math.max(t0, t1) + JAMB);
  }
  return free.filter(([s, e]) => e - s >= DOOR_MIN_WIDTH);
}

function cut(intervals: [number, number][], cs: number, ce: number): [number, number][] {
  return intervals.flatMap(([s, e]): [number, number][] => {
    if (ce <= s || cs >= e) return [[s, e]];
    return [...(cs > s ? [[s, cs] as [number, number]] : []), ...(ce < e ? [[ce, e] as [number, number]] : [])];
  });
}

/** Свободный участок, в котором стоит (или рядом с которым) точка t. */
function intervalNear(free: [number, number][], t: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const iv of free) {
    const d = t < iv[0] ? iv[0] - t : t > iv[1] ? t - iv[1] : 0;
    if (d < bestD) {
      best = iv;
      bestD = d;
    }
  }
  return best;
}

// ── Постановка двери ──

/**
 * Дверь между помещениями a и b: на общей стене, ближайшей к точке нажатия, по центру её свободного участка.
 * Ширина — по типу двери; на короткой стене дверь сужается, но не меньше DOOR_MIN_WIDTH.
 * Открывается в меньшее помещение: двери кабинетов открываются внутрь, а не в коридор.
 */
export function placeDoor(
  doc: MapDocument,
  a: string,
  b: string,
  at?: Vec2,
  preset: DoorPreset = DEFAULT_DOOR_PRESET,
): { doc: MapDocument; id: string } | null {
  const ua = doc.units.find((u) => u.id === a);
  const ub = doc.units.find((u) => u.id === b);
  if (!ua || !ub) return null;
  const walls = sharedUnitWalls(ua, ub).filter(([p, q]) => distance(p, q) >= DOOR_MIN_WALL);
  if (walls.length === 0) return null;

  const wall = at
    ? walls.reduce((w, cur) => (pointSegmentDistance(at, cur[0], cur[1]) < pointSegmentDistance(at, w[0], w[1]) ? cur : w))
    : walls.reduce((w, cur) => (distance(cur[0], cur[1]) > distance(w[0], w[1]) ? cur : w));
  const free = freeIntervals(doc, wall);
  const interval = at ? intervalNear(free, along(wall, at)) : free.reduce<[number, number] | null>((x, iv) => (!x || iv[1] - iv[0] > x[1] - x[0] ? iv : x), null);
  if (!interval) return null;

  const width = Math.min(DOOR_WIDTH[preset.type], interval[1] - interval[0]);
  const mid = (interval[0] + interval[1]) / 2;
  const segment: [Vec2, Vec2] = [pointAt(wall, mid - width / 2), pointAt(wall, mid + width / 2)];
  const id = nextOpeningId(doc);
  const base: Opening = { id, level: ua.level, kind: preset.type === 'passage' ? 'passage' : 'door', segment, units: [a, b] };
  const opening: Opening =
    preset.type === 'passage'
      ? base
      : { ...base, door: { leaves: preset.type === 'double' ? 2 : 1, swing: defaultSwing(doc, base), hinge: 'start', openAngle: clampAngle(preset.openAngle) } };
  return { doc: { ...doc, openings: [...doc.openings, opening] }, id };
}

/**
 * Вход с улицы на наружной стене помещения: по центру свободной наружной части стены, ближайшей к нажатию.
 * Части стены, общие с соседними помещениями, не годятся — там ставится обычная дверь.
 */
export function placeEntrance(doc: MapDocument, unitId: string, at: Vec2, preset: DoorPreset = DEFAULT_DOOR_PRESET): { doc: MapDocument; id: string } | null {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) return null;
  const wall = polygonEdges(unit.polygon).reduce((w, cur) => (pointSegmentDistance(at, cur[0], cur[1]) < pointSegmentDistance(at, w[0], w[1]) ? cur : w));
  if (distance(wall[0], wall[1]) < DOOR_MIN_WALL) return null;
  let free = freeIntervals(doc, wall);
  for (const other of doc.units) {
    if (other.id === unit.id || other.level !== unit.level) continue;
    for (const [c, d] of sharedUnitWalls(unit, other)) {
      if (pointSegmentDistance(c, wall[0], wall[1]) > ON_WALL || pointSegmentDistance(d, wall[0], wall[1]) > ON_WALL) continue;
      const tc = along(wall, c);
      const td = along(wall, d);
      free = cut(free, Math.min(tc, td) - JAMB, Math.max(tc, td) + JAMB);
    }
  }
  const interval = intervalNear(free.filter(([s, e]) => e - s >= DOOR_MIN_WIDTH), along(wall, at));
  if (!interval) return null;
  const width = Math.min(DOOR_WIDTH[preset.type], interval[1] - interval[0]);
  const mid = (interval[0] + interval[1]) / 2;
  const id = nextOpeningId(doc);
  const base: Opening = { id, level: unit.level, kind: 'entrance', segment: [pointAt(wall, mid - width / 2), pointAt(wall, mid + width / 2)], units: [unit.id] };
  const opening: Opening =
    preset.type === 'passage'
      ? base
      : { ...base, door: { leaves: preset.type === 'double' ? 2 : 1, swing: defaultSwing(doc, base), hinge: 'start', openAngle: clampAngle(preset.openAngle) } };
  return { doc: { ...doc, openings: [...doc.openings, opening] }, id };
}

function nextOpeningId(doc: MapDocument): string {
  const used = new Set(doc.openings.map((o) => o.id));
  let n = doc.openings.length + 1;
  while (used.has(`d${n}`)) n++;
  return `d${n}`;
}

// ── Растягивание и сдвиг вдоль стены ──

/**
 * Новый пролёт проёма [t0, t1] (метры вдоль стены). Проём остаётся в своём свободном участке
 * и не уже DOOR_MIN_WIDTH. Без стены (помещение сдвинули) — документ без изменений.
 */
export function setOpeningSpan(doc: MapDocument, id: string, t0: number, t1: number): MapDocument {
  const o = doc.openings.find((x) => x.id === id);
  if (!o) return doc;
  const wall = openingWall(doc, o);
  if (!wall) return doc;
  const current = (along(wall, o.segment[0]) + along(wall, o.segment[1])) / 2;
  const free = intervalNear(freeIntervals(doc, wall, id), current);
  if (!free) return doc;
  let s = Math.max(free[0], Math.min(t0, t1));
  let e = Math.min(free[1], Math.max(t0, t1));
  if (e - s < DOOR_MIN_WIDTH) {
    // Сжали слишком сильно — держим минимальную ширину, не вылезая из участка.
    const c = Math.max(free[0] + DOOR_MIN_WIDTH / 2, Math.min(free[1] - DOOR_MIN_WIDTH / 2, (s + e) / 2));
    s = c - DOOR_MIN_WIDTH / 2;
    e = c + DOOR_MIN_WIDTH / 2;
  }
  // Направление отрезка сохраняем: от него зависят «куда открывается» и петли.
  const forward = along(wall, o.segment[1]) >= along(wall, o.segment[0]);
  const segment: [Vec2, Vec2] = forward ? [pointAt(wall, s), pointAt(wall, e)] : [pointAt(wall, e), pointAt(wall, s)];
  return replaceOpening(doc, { ...o, segment });
}

/** Пролёт проёма вдоль его стены: [начало, конец] в метрах и длина стены. */
export function openingSpan(doc: MapDocument, id: string): { t0: number; t1: number; wallLength: number; wall: Wall } | null {
  const o = doc.openings.find((x) => x.id === id);
  const wall = o ? openingWall(doc, o) : null;
  if (!o || !wall) return null;
  const a = along(wall, o.segment[0]);
  const b = along(wall, o.segment[1]);
  return { t0: Math.min(a, b), t1: Math.max(a, b), wallLength: distance(wall[0], wall[1]), wall };
}

/** Тянем за край: другой край стоит на месте. edge 0 — segment[0], 1 — segment[1]. */
export function dragOpeningEdge(doc: MapDocument, id: string, edge: 0 | 1, to: Vec2, step = 0.05): MapDocument {
  const o = doc.openings.find((x) => x.id === id);
  const wall = o ? openingWall(doc, o) : null;
  if (!o || !wall) return doc;
  const fixed = along(wall, o.segment[edge === 0 ? 1 : 0]);
  const moving = snapTo(along(wall, to), step);
  return setOpeningSpan(doc, id, fixed, moving);
}

/** Тянем за середину: проём едет вдоль стены, ширина та же. */
export function slideOpening(doc: MapDocument, id: string, delta: number, step = 0.05): MapDocument {
  const span = openingSpan(doc, id);
  if (!span) return doc;
  const width = span.t1 - span.t0;
  const free = intervalNear(freeIntervals(doc, span.wall, id), (span.t0 + span.t1) / 2);
  if (!free) return doc;
  const s = Math.max(free[0], Math.min(free[1] - width, snapTo(span.t0 + delta, step)));
  return setOpeningSpan(doc, id, s, s + width);
}

/** Ширина с центром на месте. */
export function setOpeningWidth(doc: MapDocument, id: string, width: number): MapDocument {
  const span = openingSpan(doc, id);
  if (!span) return doc;
  const c = (span.t0 + span.t1) / 2;
  return setOpeningSpan(doc, id, c - width / 2, c + width / 2);
}

/** «По центру стены»: та же ширина, середина свободного участка. */
export function centerOpening(doc: MapDocument, id: string): MapDocument {
  const span = openingSpan(doc, id);
  if (!span) return doc;
  const free = intervalNear(freeIntervals(doc, span.wall, id), (span.t0 + span.t1) / 2);
  if (!free) return doc;
  const width = Math.min(span.t1 - span.t0, free[1] - free[0]);
  const c = (free[0] + free[1]) / 2;
  return setOpeningSpan(doc, id, c - width / 2, c + width / 2);
}

/** «На всю стену»: проём растягивается на весь свободный участок. */
export function fillOpening(doc: MapDocument, id: string): MapDocument {
  const span = openingSpan(doc, id);
  if (!span) return doc;
  const free = intervalNear(freeIntervals(doc, span.wall, id), (span.t0 + span.t1) / 2);
  return free ? setOpeningSpan(doc, id, free[0], free[1]) : doc;
}

// ── Створки ──

/** Тип двери для интерфейса. */
export function doorTypeOf(o: Opening): DoorType {
  if (o.kind === 'passage' || (o.kind === 'entrance' && !o.door)) return 'passage';
  return o.door?.leaves === 2 ? 'double' : 'single';
}

/**
 * Створки с подставленными значениями по умолчанию. У прохода без двери — null.
 * Вход с улицы без настроек — тоже проём: так он нарисован в старых картах.
 */
export function doorStyleOf(doc: MapDocument, o: Opening): DoorStyle | null {
  if (o.kind === 'passage' || (o.kind === 'entrance' && !o.door)) return null;
  return o.door ?? { leaves: 1, swing: defaultSwing(doc, o), hinge: 'start', openAngle: 90 };
}

/** Сменить тип: дверь, двустворчатая или проём без двери. Остальные настройки створок сохраняются. */
export function setDoorType(doc: MapDocument, id: string, type: DoorType): MapDocument {
  const o = doc.openings.find((x) => x.id === id);
  if (!o) return doc;
  if (type === 'passage') {
    const { door: _drop, ...rest } = o;
    return replaceOpening(doc, { ...rest, kind: o.kind === 'entrance' ? 'entrance' : 'passage' });
  }
  const style = doorStyleOf(doc, { ...o, kind: 'door' })!;
  return replaceOpening(doc, { ...o, kind: o.kind === 'entrance' ? 'entrance' : 'door', door: { ...style, leaves: type === 'double' ? 2 : 1 } });
}

export function updateDoorStyle(doc: MapDocument, id: string, patch: Partial<DoorStyle>): MapDocument {
  const o = doc.openings.find((x) => x.id === id);
  const style = o ? doorStyleOf(doc, o) : null;
  if (!o || !style) return doc;
  const next = { ...style, ...patch };
  return replaceOpening(doc, { ...o, door: { ...next, openAngle: clampAngle(next.openAngle) } });
}

/** Помещения по обе стороны проёма: side 1 — слева от segment[0] → segment[1], −1 — справа. null — улица. */
export function openingSides(doc: MapDocument, o: Opening): { side: 1 | -1; unit: Unit | null }[] {
  return ([1, -1] as const).map((side) => ({ side, unit: unitOnSide(doc, o, side) }));
}

export interface DoorLeaf {
  /** Петля. */
  hinge: Vec2;
  /** Конец закрытой створки (на линии стены). */
  closedTip: Vec2;
  /** Конец створки в текущем положении. */
  openTip: Vec2;
  length: number;
  /** Угол створки на плане (атан2 по осям плана), радианы. */
  angle: number;
}

/** Створки для отрисовки: одна у петли или две от каждого косяка навстречу друг другу. */
export function doorLeaves(o: Opening, style: DoorStyle): DoorLeaf[] {
  const [p, q] = o.segment;
  const len = distance(p, q);
  if (len < 1e-6) return [];
  const d: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const n: Vec2 = [-d[1] * style.swing, d[0] * style.swing];
  const theta = (clampAngle(style.openAngle) * Math.PI) / 180;
  const leaf = (hinge: Vec2, dir: Vec2, length: number): DoorLeaf => {
    const open: Vec2 = [dir[0] * Math.cos(theta) + n[0] * Math.sin(theta), dir[1] * Math.cos(theta) + n[1] * Math.sin(theta)];
    return {
      hinge,
      closedTip: [hinge[0] + dir[0] * length, hinge[1] + dir[1] * length],
      openTip: [hinge[0] + open[0] * length, hinge[1] + open[1] * length],
      length,
      angle: Math.atan2(open[1], open[0]),
    };
  };
  if (style.leaves === 2) return [leaf(p, d, len / 2), leaf(q, [-d[0], -d[1]], len / 2)];
  return style.hinge === 'start' ? [leaf(p, d, len)] : [leaf(q, [-d[0], -d[1]], len)];
}

// ── Вспомогательное ──

/** По умолчанию дверь открывается в меньшее помещение; у входа — внутрь здания. */
function defaultSwing(doc: MapDocument, o: Opening): 1 | -1 {
  const left = unitOnSide(doc, o, 1);
  const right = unitOnSide(doc, o, -1);
  if (!left) return -1;
  if (!right) return 1;
  return polygonArea(left.polygon) <= polygonArea(right.polygon) ? 1 : -1;
}

function unitOnSide(doc: MapDocument, o: Opening, side: 1 | -1): Unit | null {
  const [p, q] = o.segment;
  const len = distance(p, q) || 1;
  const probe: Vec2 = [(p[0] + q[0]) / 2 - ((q[1] - p[1]) / len) * 0.3 * side, (p[1] + q[1]) / 2 + ((q[0] - p[0]) / len) * 0.3 * side];
  return doc.units.find((u) => u.level === o.level && (o.units as readonly string[]).includes(u.id) && pointInUnit(probe, u)) ?? null;
}

function replaceOpening(doc: MapDocument, next: Opening): MapDocument {
  return { ...doc, openings: doc.openings.map((o) => (o.id === next.id ? next : o)) };
}

function clampAngle(deg: number): number {
  return Math.max(0, Math.min(150, Math.round(deg)));
}

function snapTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
