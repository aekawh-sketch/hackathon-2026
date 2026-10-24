import { businessCentreFixture } from './fixtures/businessCentre.ts';
import { describe, expect, it } from 'vitest';
import {
  addHole,
  addWall,
  addPlace,
  buildModel3D,
  deleteHole,
  distance,
  hasLineOfSight,
  holeAt,
  moveHole,
  NavGraph,
  placeDoor,
  placeEntrance,
  rebuildGraph,
  rectPolygon,
  splitUnit,
  unitAt,
  validateReferences,
  type MapDocument,
  type Unit,
  type Vec2,
} from '../src/index.ts';

const L = 'L1';

function single(unit: Partial<Unit> & { polygon: Vec2[] }): MapDocument {
  const doc = businessCentreFixture();
  return {
    ...doc,
    units: [{ id: 'r', level: L, kind: 'hall', name: 'Зал', walkable: true, ...unit }],
    obstacles: [],
    openings: [],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
  };
}

function route(doc: MapDocument, a: string, b: string) {
  const g = new NavGraph(doc);
  return g.route(doc.places.find((p) => p.id === a)!.node!, doc.places.find((p) => p.id === b)!.node!);
}

function withTwoPlaces(doc: MapDocument, pa: Vec2, pb: Vec2) {
  const a = addPlace(doc, L, pa, 'hall', 'А');
  const b = addPlace(a.doc, L, pb, 'hall', 'Б');
  return { doc: b.doc, a: a.id, b: b.id };
}

describe('вырезы', () => {
  const hall = () => single({ polygon: rectPolygon([0, 0], [10, 6]) });

  it('ставится внутри, у стены и поверх другого — нет', () => {
    const ok = addHole(hall(), 'r', rectPolygon([4, 2], [6, 4]));
    expect(ok.ok).toBe(true);
    expect(addHole(hall(), 'r', rectPolygon([0, 2], [2, 4]))).toMatchObject({ ok: false });
    if (!ok.ok) return;
    expect(addHole(ok.doc, 'r', rectPolygon([5, 3], [7, 5]))).toMatchObject({ ok: false, message: 'Вырезы не должны пересекаться' });
  });

  it('в вырезе нет помещения: место туда не поставить, видимость через него закрыта', () => {
    const r = addHole(hall(), 'r', rectPolygon([4, 1], [6, 5]));
    if (!r.ok) throw new Error(r.message);
    expect(unitAt(r.doc, L, [5, 3])).toBeNull();
    expect(holeAt(r.doc, L, [5, 3])?.index).toBe(0);
    expect(hasLineOfSight(r.doc, L, [1, 3], [9, 3])).toBe(false);
    expect(hasLineOfSight(r.doc, L, [1, 0.5], [9, 0.5])).toBe(true);
  });

  it('маршрут огибает колонну, а не обрывается', () => {
    const r = addHole(hall(), 'r', rectPolygon([4, 1], [6, 5]));
    if (!r.ok) throw new Error(r.message);
    const { doc, a, b } = withTwoPlaces(r.doc, [1, 3], [9, 3]);
    const path = route(doc, a, b);
    expect(path.ok).toBe(true);
    if (path.ok) expect(path.length).toBeGreaterThan(8.5); // по прямой 8 м, вокруг колонны длиннее
  });

  it('место в вырезе не даёт его поставить', () => {
    const { doc } = withTwoPlaces(hall(), [5, 3], [9, 3]);
    expect(addHole(doc, 'r', rectPolygon([4, 2], [6, 4]))).toMatchObject({ ok: false });
  });

  it('сдвиг и удаление выреза', () => {
    const r = addHole(hall(), 'r', rectPolygon([4, 2], [6, 4]));
    if (!r.ok) throw new Error(r.message);
    const moved = moveHole(r.doc, 'r', 0, [2, 0]);
    expect(moved.ok && moved.doc.units[0]!.holes![0]).toContainEqual([8, 4]);
    expect(moveHole(r.doc, 'r', 0, [5, 0]).ok).toBe(false); // упёрся бы в стену
    const removed = deleteHole(r.doc, 'r', 0);
    expect(removed.units[0]!.holes).toBeUndefined();
  });

  it('вокруг выреза в 3D — стены', () => {
    const r = addHole(hall(), 'r', rectPolygon([4, 2], [6, 4]));
    if (!r.ok) throw new Error(r.message);
    const model = buildModel3D(r.doc, L);
    const around = model.walls.filter((w) => [w.a, w.b].every((p) => p[0] >= 4 && p[0] <= 6 && p[1] >= 2 && p[1] <= 4));
    expect(around).toHaveLength(4);
    expect(model.floors[0]!.holes).toHaveLength(1);
  });
});

describe('Г-образная комната', () => {
  it('маршрут между крыльями идёт через угол', () => {
    const doc = single({ polygon: [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]] });
    const { doc: withPlaces, a, b } = withTwoPlaces(doc, [7, 1.5], [1.5, 7]);
    expect(hasLineOfSight(withPlaces, L, [7, 1.5], [1.5, 7])).toBe(false);
    expect(route(withPlaces, a, b).ok).toBe(true);
  });
});

describe('разделение', () => {
  it('линия поперёк делит комнату на две, бо́льшая часть остаётся той же комнатой', () => {
    const base = single({ polygon: rectPolygon([0, 0], [10, 6]) });
    const r = splitUnit(base, 'r', [4, 1], [4, 2]); // короткий штрих — продлевается до стен
    if (!r.ok) throw new Error(r.message);
    expect(r.doc.units).toHaveLength(2);
    const keep = r.doc.units.find((u) => u.id === 'r')!;
    const added = r.doc.units.find((u) => u.id === r.id)!;
    expect(keep.polygon).toContainEqual([10, 6]);
    expect(added.polygon).toContainEqual([0, 0]);
    expect(added.name).toBe('Зал — часть 2');
    expect(r.chord).toEqual([[4, 0], [4, 6]]);
    expect(validateReferences(r.doc)).toEqual([]);
  });

  it('между частями двери нет, пока её не поставят', () => {
    const base = single({ polygon: rectPolygon([0, 0], [10, 6]) });
    const r = splitUnit(base, 'r', [4, 0], [4, 6]);
    if (!r.ok) throw new Error(r.message);
    const { doc, a, b } = withTwoPlaces(r.doc, [2, 3], [8, 3]);
    expect(route(doc, a, b).ok).toBe(false);
    const door = placeDoor(doc, 'r', r.id, [4, 3])!;
    expect(route(rebuildGraph(door.doc, L), a, b).ok).toBe(true);
  });

  it('дверь на стене отрезанной части переходит к ней', () => {
    const doc = businessCentreFixture();
    // Выставочный зал 14–30 × 0–4, дверь в коридор на x 20–21,5. Режем по x = 24: дверь остаётся у западной части.
    const r = splitUnit(doc, 'u-c', [24, 0], [24, 4]);
    if (!r.ok) throw new Error(r.message);
    const big = r.doc.units.find((u) => u.id === 'u-c')!;
    expect(big.polygon).toContainEqual([14, 0]);
    expect(r.doc.openings.find((o) => o.id === 'd-c')!.units).toContain('u-c');
    // Режем по x = 18: восточная часть (18–30) больше, дверь на x 20 — у неё, она остаётся u-c.
    const r2 = splitUnit(doc, 'u-c', [18, 0], [18, 4]);
    if (!r2.ok) throw new Error(r2.message);
    expect(r2.doc.openings.find((o) => o.id === 'd-c')!.units).toContain('u-c');
    expect(validateReferences(r2.doc)).toEqual([]);
    // Режем по x = 21,8: западная часть (31,2 м²) меньше восточной (32,8 м²) и новая — дверь уходит к ней.
    const r3 = splitUnit(doc, 'u-c', [21.8, 0], [21.8, 4]);
    if (!r3.ok) throw new Error(r3.message);
    const moved = r3.doc.openings.find((o) => o.id === 'd-c')!;
    expect(moved.units).toContain(r3.id);
    expect(moved.units).not.toContain('u-c');
    expect(validateReferences(r3.doc)).toEqual([]);
  });

  it('мимо комнаты и через вырез — нельзя', () => {
    const base = single({ polygon: rectPolygon([0, 0], [10, 6]) });
    expect(splitUnit(base, 'r', [12, 0], [12, 6]).ok).toBe(false);
    const holed = addHole(base, 'r', rectPolygon([4, 2], [6, 4]));
    if (!holed.ok) throw new Error(holed.message);
    expect(splitUnit(holed.doc, 'r', [5, 0], [5, 6])).toMatchObject({ ok: false, message: 'Линия разреза проходит через вырез' });
    const beside = splitUnit(holed.doc, 'r', [8, 0], [8, 6]);
    expect(beside.ok && beside.doc.units.find((u) => u.id === 'r')!.holes).toHaveLength(1);
  });
});

describe('вход с улицы', () => {
  it('на наружной стене — вход по центру свободной наружной части', () => {
    const doc = businessCentreFixture();
    // Нижняя стена выставочного зала y = 0, x 14–30 — наружная.
    const r = placeEntrance(doc, 'u-c', [16, 0])!;
    const o = r.doc.openings.find((x) => x.id === r.id)!;
    expect(o.kind).toBe('entrance');
    expect(o.units).toEqual(['u-c']);
    const mid: Vec2 = [(o.segment[0][0] + o.segment[1][0]) / 2, (o.segment[0][1] + o.segment[1][1]) / 2];
    expect(mid[1]).toBeCloseTo(0);
    expect(distance(o.segment[0], o.segment[1])).toBeCloseTo(0.9);
    expect(validateReferences(r.doc)).toEqual([]);
  });
});

describe('стена линией', () => {
  const hall = () => single({ polygon: rectPolygon([0, 0], [10, 6]) });

  it('от стены до стены — две комнаты, прохода между ними нет', () => {
    const r = addWall(hall(), L, [5, 0.2], [5, 5.8]);
    if (!r.ok) throw new Error(r.message);
    expect(r.kind).toBe('split');
    expect(r.doc.units).toHaveLength(2);
    const { doc, a, b } = withTwoPlaces(r.doc, [2, 3], [8, 3]);
    expect(route(doc, a, b).ok).toBe(false);
  });

  it('отдельно стоящая — перегородка: сквозь неё не видно, маршрут обходит', () => {
    const r = addWall(hall(), L, [5, 1.5], [5, 4.5]);
    if (!r.ok) throw new Error(r.message);
    expect(r.kind).toBe('partition');
    expect(hasLineOfSight(r.doc, L, [3, 3], [7, 3])).toBe(false);
    const { doc, a, b } = withTwoPlaces(r.doc, [3, 3], [7, 3]);
    const path = route(doc, a, b);
    expect(path.ok).toBe(true);
    if (path.ok) expect(path.length).toBeGreaterThan(4.5);
  });

  it('от стены внутрь — стена в контуре: щели у стены нет, маршрут обходит свободный конец', () => {
    const r = addWall(hall(), L, [5, 0.1], [5, 4]);
    if (!r.ok) throw new Error(r.message);
    expect(r.kind).toBe('notch');
    const unit = r.doc.units[0]!;
    expect(unit.polygon).toHaveLength(8);
    expect(validateReferences(r.doc)).toEqual([]);
    // Вдоль пола у самой стены — тоже закрыто: стена прижата к стене помещения.
    expect(hasLineOfSight(r.doc, L, [3, 0.3], [7, 0.3])).toBe(false);
    expect(hasLineOfSight(r.doc, L, [3, 5], [7, 5])).toBe(true);
    const { doc, a, b } = withTwoPlaces(r.doc, [3, 1], [7, 1]);
    const path = route(doc, a, b);
    expect(path.ok).toBe(true);
    if (path.ok) expect(path.length).toBeGreaterThan(6);
  });

  it('стена вдоль стены и в дверь — отказ с понятной причиной', () => {
    expect(addWall(hall(), L, [1, 0.1], [6, 0.6])).toMatchObject({ ok: false });
    const withDoor = { ...hall(), openings: [{ id: 'd', level: L, kind: 'entrance' as const, segment: [[4.5, 0], [5.5, 0]] as [Vec2, Vec2], units: ['r'] as [string] }] };
    expect(addWall(withDoor, L, [5, 0.1], [5, 4])).toMatchObject({ ok: false, message: 'Стена упирается в дверь — сдвиньте стену или дверь' });
    expect(addWall(hall(), L, [3, 3], [3.1, 3])).toMatchObject({ ok: false, message: 'Стена слишком короткая' });
  });
});
