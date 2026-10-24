import { describe, expect, it } from 'vitest';
import { demoVenue, rectPolygon, validateReferences, type MapDocument } from '../src/index.ts';

function nestedRoom(right: number): MapDocument {
  return {
    ...demoVenue(),
    units: [
      { id: 'parent', level: 'L1', kind: 'hall', name: 'Зал', walkable: true, polygon: rectPolygon([0, 0], [10, 10]) },
      { id: 'child', parent: 'parent', level: 'L1', kind: 'room', name: 'Комната', walkable: true, polygon: rectPolygon([5, 5], [right, 10]) },
    ],
    openings: [], places: [], panoramas: [], anchors: [], obstacles: [], capturePoints: [], graph: { nodes: [], edges: [] },
  };
}

describe('границы вложенной комнаты', () => {
  it('позволяет комнате примыкать к наружной стене родителя', () => {
    expect(validateReferences(nestedRoom(10))).toEqual([]);
  });

  it('отклоняет комнату, действительно выходящую за границу', () => {
    expect(validateReferences(nestedRoom(11))).toContainEqual({ path: 'units[1].parent', message: 'комната выходит за границы родителя' });
  });
});
