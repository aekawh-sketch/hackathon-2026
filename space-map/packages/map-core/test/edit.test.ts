import { businessCentreFixture } from './fixtures/businessCentre.ts';
import { describe, expect, it } from 'vitest';
import {
  addDoor,
  addPlace,
  createRoom,
  deleteUnit,
  duplicateUnit,
  movePlace,
  NavGraph,
  overlappingUnits,
  placeDoor,
  pointInUnit,
  unitAt,
  polygonsOverlap,
  rebuildGraph,
  rectPolygon,
  roomPlacement,
  refreshPanoramaMarkers,
  resizeRect,
  sharedWalls,
  sharedUnitWalls,
  translateUnit,
  validateReferences,
  type MapDocument,
} from '../src/index.ts';

const L = 'L1';
const routeLength = (doc: MapDocument, fromPlace: string, toPlace: string) => {
  const a = doc.places.find((p) => p.id === fromPlace)!.node!;
  const b = doc.places.find((p) => p.id === toPlace)!.node!;
  return new NavGraph(doc).route(a, b);
};

describe('пересечения и общие стены', () => {
  it('соседи по стене не пересекаются, налезающие — пересекаются', () => {
    expect(polygonsOverlap(rectPolygon([0, 0], [4, 4]), rectPolygon([4, 0], [8, 4]))).toBe(false);
    expect(polygonsOverlap(rectPolygon([0, 0], [4, 4]), rectPolygon([3, 1], [8, 3]))).toBe(true);
    expect(polygonsOverlap(rectPolygon([0, 0], [4, 4]), rectPolygon([1, 1], [2, 2]))).toBe(true);
    expect(polygonsOverlap(rectPolygon([0, 0], [4, 4]), rectPolygon([0, 0], [4, 4]))).toBe(true);
  });

  it('общая стена — пересечение границ', () => {
    const walls = sharedWalls(rectPolygon([10, 7], [18, 14]), rectPolygon([10, 4], [30, 7]));
    expect(walls).toHaveLength(1);
    const [a, b] = walls[0]!;
    expect(Math.abs(a[0] - b[0])).toBeCloseTo(8);
  });
});

describe('граф из плана', () => {
  it('маршрут по построенному графу обходит стены и не короче прямой', () => {
    const doc = rebuildGraph(businessCentreFixture(), L);
    expect(validateReferences(doc)).toEqual([]);
    const r = routeLength(doc, 'p-entrance', 'p-hall-b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.length).toBeGreaterThan(21.2);
    expect(r.length).toBeLessThan(32);
  });

  it('все места на этаже достижимы', () => {
    const doc = rebuildGraph(businessCentreFixture(), L);
    for (const p of doc.places) {
      if (p.id === 'p-entrance') continue;
      expect(routeLength(doc, 'p-entrance', p.id).ok).toBe(true);
    }
  });
});

describe('создание помещения', () => {
  it('новая комната без двери не попадает в маршруты; дверь ставится вручную', () => {
    const base = rebuildGraph(businessCentreFixture(), L);
    // Справа от коридора: 30–34 × 4–8.
    const { doc, id } = createRoom(base, L, rectPolygon([30, 4], [34, 8]), { name: 'Кладовая' });
    expect(doc.units.find((u) => u.id === id)?.name).toBe('Кладовая');
    expect(doc.openings.some((o) => o.units.includes(id as never))).toBe(false);
    const { doc: withPlace, id: place } = addPlace(doc, L, [32, 6], 'room', 'Склад');
    expect(routeLength(withPlace, 'p-entrance', place).ok).toBe(false);

    const door = placeDoor(withPlace, id, 'u-corridor')!;
    const withDoor = rebuildGraph(door.doc, L);
    expect(withDoor.openings.find((o) => o.id === door.id)!.units).toContain('u-corridor');
    expect(routeLength(withDoor, 'p-entrance', place).ok).toBe(true);
    expect(validateReferences(withDoor)).toEqual([]);
  });

  it('пересечение с существующими помещениями находится', () => {
    expect(overlappingUnits(businessCentreFixture(), L, rectPolygon([8, 8], [12, 12])).map((u) => u.id).sort()).toEqual(['u-a', 'u-lobby']);
    expect(overlappingUnits(businessCentreFixture(), L, rectPolygon([30, 0], [34, 4]))).toEqual([]);
  });

  it('вложенная комната вырезается из родителя и соединяется с ним дверью', () => {
    const host = { id: 'u-host', level: L, kind: 'hall' as const, name: 'Зал', walkable: true, polygon: rectPolygon([0, 0], [20, 20]) };
    const base: MapDocument = { ...businessCentreFixture(), units: [host], openings: [], places: [], panoramas: [], anchors: [], obstacles: [], graph: { nodes: [], edges: [] } };
    const nested = createRoom(base, L, rectPolygon([4, 4], [8, 8]), { name: 'Переговорная' });
    const room = nested.doc.units.find((u) => u.id === nested.id)!;
    const parent = nested.doc.units.find((u) => u.id === host.id)!;

    expect(room.parent).toBe(host.id);
    expect(roomPlacement(base, L, rectPolygon([4, 4], [8, 8])).valid).toBe(true);
    expect(roomPlacement(nested.doc, L, rectPolygon([3, 3], [6, 6])).valid).toBe(false);
    expect(roomPlacement(nested.doc, L, rectPolygon([5, 5], [7, 7])).parent?.id).toBe(room.id);
    expect(parent.holes).toContainEqual(room.polygon);
    expect(pointInUnit([2, 2], parent)).toBe(true);
    expect(pointInUnit([6, 6], parent)).toBe(false);
    expect(unitAt(nested.doc, L, [6, 6])?.id).toBe(room.id);
    expect(sharedUnitWalls(parent, room)).toHaveLength(4);

    const door = placeDoor(nested.doc, host.id, room.id, [4, 6]);
    expect(door).not.toBeNull();
    const withDoor = rebuildGraph(door!.doc, L);
    const outerPlace = addPlace(withDoor, L, [2, 2], 'food', 'Стойка в зале');
    const innerPlace = addPlace(outerPlace.doc, L, [6, 6], 'food', 'Стол в комнате');
    const connected = rebuildGraph(innerPlace.doc, L);
    expect(routeLength(connected, outerPlace.id, innerPlace.id).ok).toBe(true);
    expect(validateReferences(connected)).toEqual([]);
  });

  it('сдвиг и удаление вложенной комнаты синхронизируют вырез родителя', () => {
    const host = { id: 'u-host', level: L, kind: 'hall' as const, name: 'Зал', walkable: true, polygon: rectPolygon([0, 0], [20, 20]) };
    const base: MapDocument = { ...businessCentreFixture(), units: [host], openings: [], places: [], panoramas: [], anchors: [], obstacles: [], graph: { nodes: [], edges: [] } };
    const created = createRoom(base, L, rectPolygon([4, 4], [8, 8]));
    const moved = translateUnit(created.doc, created.id, [2, 1]);
    const movedRoom = moved.units.find((u) => u.id === created.id)!;
    const movedHost = moved.units.find((u) => u.id === host.id)!;
    expect(movedRoom.polygon).toContainEqual([6, 5]);
    expect(movedHost.holes).toContainEqual(movedRoom.polygon);
    const deleted = deleteUnit(moved, created.id);
    expect(deleted.units.find((u) => u.id === host.id)?.holes ?? []).toHaveLength(0);
    expect(validateReferences(deleted)).toEqual([]);
  });
});

describe('сдвиг и форма', () => {
  it('сдвиг уносит места внутри; оторванная дверь пропадает, новую ставят вручную', () => {
    const base = rebuildGraph(businessCentreFixture(), L);
    const { doc: withRoom, id } = createRoom(base, L, rectPolygon([30, 4], [34, 8]));
    const withDoor = rebuildGraph(placeDoor(withRoom, id, 'u-corridor')!.doc, L);
    const placed = addPlace(withDoor, L, [32, 6], 'room', 'Склад');
    // Вниз на 4 м: 30–34 × 0–4 — коридор уже не рядом, зато граничит с выставочным залом.
    const moved = translateUnit(placed.doc, id, [0, -4]);
    const place = moved.places.find((p) => p.id === placed.id)!;
    expect(place.pos).toEqual([32, 2]);
    expect(moved.openings.some((o) => o.units.includes(id as never))).toBe(false);
    expect(routeLength(moved, 'p-entrance', placed.id).ok).toBe(false);
    const reconnected = rebuildGraph(placeDoor(moved, id, 'u-c')!.doc, L);
    expect(routeLength(reconnected, 'p-entrance', placed.id).ok).toBe(true);
    expect(validateReferences(reconnected)).toEqual([]);
  });

  it('изменение размера сохраняет дверь на общей стене', () => {
    const base = rebuildGraph(businessCentreFixture(), L);
    const created = createRoom(base, L, rectPolygon([30, 4], [34, 8]));
    const id = created.id;
    const doc = placeDoor(created.doc, id, 'u-corridor')!.doc;
    const resized = resizeRect(doc, id, 6, 5);
    const unit = resized.units.find((u) => u.id === id)!;
    expect(unit.polygon).toContainEqual([36, 9]);
    expect(resized.openings.some((o) => o.units.includes(id as never))).toBe(true);
  });

  it('перенос места перестраивает его узел', () => {
    const doc = movePlace(rebuildGraph(businessCentreFixture(), L), 'p-coffee', [3, 3]);
    expect(doc.places.find((p) => p.id === 'p-coffee')!.pos).toEqual([3, 3]);
    expect(routeLength(doc, 'p-entrance', 'p-coffee').ok).toBe(true);
  });
});

describe('удаление и копия', () => {
  it('удаление помещения убирает двери, места и метки в панорамах', () => {
    let doc = businessCentreFixture();
    doc = refreshPanoramaMarkers(doc);
    const next = deleteUnit(doc, 'u-a');
    expect(next.units.some((u) => u.id === 'u-a')).toBe(false);
    expect(next.openings.some((o) => o.id === 'd-a')).toBe(false);
    expect(next.places.some((p) => p.id === 'p-room-a')).toBe(false);
    expect(next.panoramas.flatMap((p) => p.markers).some((m) => m.place === 'p-room-a')).toBe(false);
    expect(validateReferences(next)).toEqual([]);
  });

  it('копия встаёт рядом без пересечений', () => {
    const doc = rebuildGraph(businessCentreFixture(), L);
    const copy = duplicateUnit(doc, 'u-wc');
    expect(copy).not.toBeNull();
    const unit = copy!.doc.units.find((u) => u.id === copy!.id)!;
    expect(overlappingUnits(copy!.doc, L, unit.polygon, unit.id)).toEqual([]);
  });

  it('дверь вручную между соседями', () => {
    const doc = addDoor(businessCentreFixture(), 'u-a', 'u-b', [18, 10]);
    const door = doc.openings[doc.openings.length - 1]!;
    expect(door.units).toEqual(['u-a', 'u-b']);
    expect(door.segment[0][0]).toBeCloseTo(18);
  });
});
