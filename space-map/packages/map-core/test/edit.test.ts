import { describe, expect, it } from 'vitest';
import {
  addDoor,
  addPlace,
  createRoom,
  deleteUnit,
  demoVenue,
  duplicateUnit,
  movePlace,
  NavGraph,
  overlappingUnits,
  polygonsOverlap,
  rebuildGraph,
  rectPolygon,
  refreshPanoramaMarkers,
  resizeRect,
  sharedWalls,
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
    const doc = rebuildGraph(demoVenue(), L);
    expect(validateReferences(doc)).toEqual([]);
    const r = routeLength(doc, 'p-entrance', 'p-hall-b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.length).toBeGreaterThan(21.2);
    expect(r.length).toBeLessThan(32);
  });

  it('все места на этаже достижимы', () => {
    const doc = rebuildGraph(demoVenue(), L);
    for (const p of doc.places) {
      if (p.id === 'p-entrance') continue;
      expect(routeLength(doc, 'p-entrance', p.id).ok).toBe(true);
    }
  });
});

describe('создание помещения', () => {
  it('новая комната у коридора получает дверь и попадает в маршруты', () => {
    const base = rebuildGraph(demoVenue(), L);
    // Справа от коридора: 30–34 × 4–8.
    const { doc, id } = createRoom(base, L, rectPolygon([30, 4], [34, 8]), { name: 'Кладовая' });
    expect(doc.units.find((u) => u.id === id)?.name).toBe('Кладовая');
    const door = doc.openings.find((o) => o.units.includes(id as never));
    expect(door).toBeDefined();
    expect(door!.units).toContain('u-corridor');
    const { doc: withPlace, id: place } = addPlace(doc, L, [32, 6], 'room', 'Склад');
    expect(routeLength(withPlace, 'p-entrance', place).ok).toBe(true);
    expect(validateReferences(withPlace)).toEqual([]);
  });

  it('пересечение с существующими помещениями находится', () => {
    expect(overlappingUnits(demoVenue(), L, rectPolygon([8, 8], [12, 12])).map((u) => u.id).sort()).toEqual(['u-a', 'u-lobby']);
    expect(overlappingUnits(demoVenue(), L, rectPolygon([30, 0], [34, 4]))).toEqual([]);
  });
});

describe('сдвиг и форма', () => {
  it('сдвиг уносит места внутри, оторванная дверь заменяется новой', () => {
    const base = rebuildGraph(demoVenue(), L);
    const { doc: withRoom, id } = createRoom(base, L, rectPolygon([30, 4], [34, 8]));
    const placed = addPlace(withRoom, L, [32, 6], 'room', 'Склад');
    // Вниз на 4 м: 30–34 × 0–4 — коридор уже не рядом, зато граничит с выставочным залом.
    const moved = translateUnit(placed.doc, id, [0, -4]);
    const place = moved.places.find((p) => p.id === placed.id)!;
    expect(place.pos).toEqual([32, 2]);
    const doors = moved.openings.filter((o) => o.units.includes(id as never));
    expect(doors).toHaveLength(1);
    expect(doors[0]!.units).toContain('u-c');
    expect(routeLength(moved, 'p-entrance', placed.id).ok).toBe(true);
    expect(validateReferences(moved)).toEqual([]);
  });

  it('изменение размера сохраняет дверь на общей стене', () => {
    const base = rebuildGraph(demoVenue(), L);
    const { doc, id } = createRoom(base, L, rectPolygon([30, 4], [34, 8]));
    const resized = resizeRect(doc, id, 6, 5);
    const unit = resized.units.find((u) => u.id === id)!;
    expect(unit.polygon).toContainEqual([36, 9]);
    expect(resized.openings.some((o) => o.units.includes(id as never))).toBe(true);
  });

  it('перенос места перестраивает его узел', () => {
    const doc = movePlace(rebuildGraph(demoVenue(), L), 'p-coffee', [3, 3]);
    expect(doc.places.find((p) => p.id === 'p-coffee')!.pos).toEqual([3, 3]);
    expect(routeLength(doc, 'p-entrance', 'p-coffee').ok).toBe(true);
  });
});

describe('удаление и копия', () => {
  it('удаление помещения убирает двери, места и метки в панорамах', () => {
    let doc = demoVenue();
    doc = refreshPanoramaMarkers(doc);
    const next = deleteUnit(doc, 'u-a');
    expect(next.units.some((u) => u.id === 'u-a')).toBe(false);
    expect(next.openings.some((o) => o.id === 'd-a')).toBe(false);
    expect(next.places.some((p) => p.id === 'p-room-a')).toBe(false);
    expect(next.panoramas.flatMap((p) => p.markers).some((m) => m.place === 'p-room-a')).toBe(false);
    expect(validateReferences(next)).toEqual([]);
  });

  it('копия встаёт рядом без пересечений', () => {
    const doc = rebuildGraph(demoVenue(), L);
    const copy = duplicateUnit(doc, 'u-wc');
    expect(copy).not.toBeNull();
    const unit = copy!.doc.units.find((u) => u.id === copy!.id)!;
    expect(overlappingUnits(copy!.doc, L, unit.polygon, unit.id)).toEqual([]);
  });

  it('дверь вручную между соседями', () => {
    const doc = addDoor(demoVenue(), 'u-a', 'u-b', [18, 10]);
    const door = doc.openings[doc.openings.length - 1]!;
    expect(door.units).toEqual(['u-a', 'u-b']);
    expect(door.segment[0][0]).toBeCloseTo(18);
  });
});
