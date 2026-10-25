import { describe, expect, it } from 'vitest';
import {
  addDoor,
  addLevel,
  addPlace,
  createRoom,
  deleteLevel,
  moveLevel,
  NavGraph,
  rectPolygon,
  renameLevel,
  routeLegs,
  sortedLevels,
  updateUnit,
  validateReferences,
  verticalLinks,
} from '../src/index.ts';
import type { MapDocument } from '../src/index.ts';

function emptyDoc(): MapDocument {
  return {
    schema: 2,
    venue: { id: 'v', name: 'Корпус', planNorth: null, scaleClass: 'scaled' },
    categories: [{ id: 'c', name: 'Разное', icon: 'pin', color: '#888888', synonyms: [] }],
    levels: [{ id: 'L1', name: '1 этаж', ordinal: 0, underlay: null }],
    units: [],
    obstacles: [],
    openings: [],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
    settings: { markerRange: 20, linkRange: 15 },
  };
}

/** Этаж: коридор 20 × 3, сверху кабинет и лестница, у каждого дверь в коридор. */
function floor(doc: MapDocument, level: string): MapDocument {
  let d = doc;
  const corridor = createRoom(d, level, rectPolygon([0, 0], [20, 3]), { kind: 'corridor' });
  d = corridor.doc;
  const office = createRoom(d, level, rectPolygon([0, 3], [8, 9]), { kind: 'room' });
  d = office.doc;
  const stairs = createRoom(d, level, rectPolygon([16, 3], [20, 7]), { kind: 'stairs' });
  d = stairs.doc;
  d = addDoor(d, corridor.id, office.id);
  d = addDoor(d, corridor.id, stairs.id);
  return d;
}

describe('этажи', () => {
  it('новый этаж копией плана: лестницы друг над другом соединяют этажи в маршруте', () => {
    let doc = floor(emptyDoc(), 'L1');
    const added = addLevel(doc, { copyFrom: 'L1' });
    doc = added.doc;
    expect(added.id).toBe('L2');
    expect(sortedLevels(doc).map((l) => l.name)).toEqual(['1 этаж', '2 этаж']);
    expect(doc.units.filter((u) => u.level === 'L2')).toHaveLength(3);
    expect(doc.openings.filter((o) => o.level === 'L2')).toHaveLength(2);
    expect(verticalLinks(doc)).toHaveLength(1);

    const a = addPlace(doc, 'L1', [4, 6], 'c', 'Касса');
    const b = addPlace(a.doc, 'L2', [4, 6], 'c', 'Библиотека');
    doc = b.doc;
    expect(validateReferences(doc)).toEqual([]);

    const graph = new NavGraph(doc);
    const from = doc.places.find((p) => p.id === a.id)!.node!;
    const to = doc.places.find((p) => p.id === b.id)!.node!;
    const route = graph.route(from, to);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const legs = routeLegs(doc, graph, route.nodes);
    expect(legs.map((l) => l.level)).toEqual(['L1', 'L2']);
    expect(legs[0]!.change).toEqual({ to: 'L2', kind: 'stairs', floors: 1 });
    expect(legs[1]!.change).toBeUndefined();
  });

  it('через этаж — одним переходом на 2 этажа; лифт отдельно от лестницы', () => {
    let doc = floor(emptyDoc(), 'L1');
    doc = addLevel(doc, { copyFrom: 'L1' }).doc;
    doc = addLevel(doc, { copyFrom: 'L1' }).doc;
    const a = addPlace(doc, 'L1', [4, 6], 'c', 'Вход');
    const b = addPlace(a.doc, 'L3', [4, 6], 'c', 'Актовый зал');
    doc = b.doc;
    const graph = new NavGraph(doc);
    const route = graph.route(doc.places.find((p) => p.id === a.id)!.node!, doc.places.find((p) => p.id === b.id)!.node!);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const legs = routeLegs(doc, graph, route.nodes);
    expect(legs.map((l) => l.level)).toEqual(['L1', 'L3']);
    expect(legs[0]!.change).toEqual({ to: 'L3', kind: 'stairs', floors: 2 });

    // Лестница на 3 этаже стала лифтом — со 2 этажа на 3 не подняться.
    const stairs3 = doc.units.find((u) => u.level === 'L3' && u.kind === 'stairs')!;
    const cut = updateUnit(doc, stairs3.id, { kind: 'elevator' });
    expect(new NavGraph(cut).route(cut.places.find((p) => p.id === a.id)!.node!, cut.places.find((p) => p.id === b.id)!.node!).ok).toBe(false);
  });

  it('переименовать, переставить, удалить этаж со всем содержимым', () => {
    let doc = floor(emptyDoc(), 'L1');
    doc = addLevel(doc, { copyFrom: 'L1' }).doc;
    doc = addPlace(doc, 'L2', [4, 6], 'c', 'Библиотека').doc;
    doc = renameLevel(doc, 'L2', 'Второй');
    expect(doc.levels.find((l) => l.id === 'L2')!.name).toBe('Второй');

    const basement = addLevel(doc, { below: true, name: 'Подвал' });
    doc = basement.doc;
    expect(sortedLevels(doc).map((l) => l.name)).toEqual(['Подвал', '1 этаж', 'Второй']);
    doc = moveLevel(doc, basement.id, 1);
    expect(sortedLevels(doc).map((l) => l.name)).toEqual(['1 этаж', 'Подвал', 'Второй']);

    doc = deleteLevel(doc, 'L2');
    expect(doc.levels.map((l) => l.id).sort()).toEqual(['L1', basement.id].sort());
    expect(doc.units.some((u) => u.level === 'L2')).toBe(false);
    expect(doc.places.some((p) => p.level === 'L2')).toBe(false);
    expect(validateReferences(doc)).toEqual([]);
    // Последний этаж не удаляется.
    const single = deleteLevel(deleteLevel(doc, basement.id), 'L1');
    expect(single.levels).toHaveLength(1);
  });
});
