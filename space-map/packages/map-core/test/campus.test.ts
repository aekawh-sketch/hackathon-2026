import { describe, expect, it } from 'vitest';
import { buildModel3D, campusVenue, createRoom, NavGraph, pointInUnit, rectPolygon, roomPlacement, routeLegs, validateReferences } from '../src/index.ts';
import type { MapDocument, Vec2 } from '../src/index.ts';

describe('несколько зданий и территория между ними', () => {
  const doc = campusVenue();
  const node = (name: string) => doc.places.find((p) => p.name === name)!.node!;

  it('комната встаёт вплотную к вложенной комнате с любой стороны', () => {
    // Раньше угол на левой или нижней стене соседа считался внутри него — комнату нельзя было поставить.
    let d: MapDocument = { ...doc, levels: [doc.levels[0]!], units: [], openings: [], places: [], panoramas: [], graph: { nodes: [], edges: [] }, capturePoints: [] };
    d = createRoom(d, 'L1', rectPolygon([0, 0], [40, 40]), { kind: 'hall' }).doc;
    d = createRoom(d, 'L1', rectPolygon([5, 5], [10, 10])).doc;
    for (const [a, b] of [[[10, 5], [15, 10]], [[0, 5], [5, 10]], [[5, 0], [10, 5]], [[5, 10], [10, 15]]] as [Vec2, Vec2][]) {
      expect(roomPlacement(d, 'L1', rectPolygon(a, b)).valid).toBe(true);
    }
  });

  it('двор, два корпуса, два этажа — документ целый, все места в маршрутах', () => {
    expect(validateReferences(doc)).toEqual([]);
    expect(doc.levels).toHaveLength(2);
    expect(doc.places.every((p) => p.node !== null)).toBe(true);
    const yard = doc.units.find((u) => u.kind === 'outdoor')!;
    // Корпуса стоят во дворе: их помещения — вырезы двора.
    expect(doc.units.filter((u) => u.level === 'L1' && u.kind !== 'outdoor').every((u) => u.parent === yard.id)).toBe(true);
  });

  it('из аудитории корпуса А в библиотеку корпуса Б — через двор', () => {
    const graph = new NavGraph(doc);
    const route = graph.route(node('Аудитория 101'), node('Абонемент'));
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const yard = doc.units.find((u) => u.kind === 'outdoor')!;
    const inYard = route.nodes.filter((id) => pointInUnit(graph.nodes.get(id)!.pos, yard));
    expect(inYard.length).toBeGreaterThanOrEqual(2);
  });

  it('из актового зала корпуса А в читальный зал корпуса Б: вниз, через двор, вверх', () => {
    const graph = new NavGraph(doc);
    const route = graph.route(node('Актовый зал'), node('Читальный зал'));
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const legs = routeLegs(doc, graph, route.nodes);
    expect(legs.map((l) => l.level)).toEqual(['L2', 'L1', 'L2']);
    expect(legs[0]!.change).toMatchObject({ kind: 'stairs', floors: -1 });
    expect(legs[1]!.change).toMatchObject({ kind: 'stairs', floors: 1 });
  });

  it('в 3D у двора нет стен по краю, у корпусов — есть', () => {
    const model = buildModel3D(doc, 'L1');
    const onYardEdge = model.walls.filter((w) => [w.a, w.b].every((p) => p[0] === 0 || p[1] === 0 || p[0] === 64 || p[1] === 42));
    expect(onYardEdge).toHaveLength(0);
    expect(model.walls.some((w) => w.a[0] === 6 && w.b[0] === 6)).toBe(true);
  });
});
