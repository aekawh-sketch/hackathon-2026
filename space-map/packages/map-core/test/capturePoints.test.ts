import { describe, expect, it } from 'vitest';
import {
  activeCapturePoints,
  addCapturePoint,
  captureCoverage,
  captureRoute,
  deleteUnit,
  demoVenue,
  distance,
  hasLineOfSight,
  moveCapturePoint,
  NavGraph,
  pendingCapturePoints,
  planCapturePoints,
  pointInUnit,
  rebuildGraph,
  rectPolygon,
  refreshCapturePoints,
  removeCapturePoint,
  restoreRemovedCapturePoints,
  segmentIntersection,
  translateUnit,
  validateReferences,
  type MapDocument,
  type Opening,
  type Unit,
  type Vec2,
} from '../src/index.ts';

const L = 'L1';

function plan(units: (Partial<Unit> & { id: string; polygon: Vec2[] })[], openings: Opening[] = []): MapDocument {
  const doc = demoVenue();
  return rebuildGraph(
    {
      ...doc,
      venue: { ...doc.venue, id: `test-${Math.random()}` },
      units: units.map((u) => ({ level: L, kind: 'hall', name: u.id, walkable: true, ...u })),
      obstacles: [],
      openings,
      graph: { nodes: [], edges: [] },
      places: [],
      panoramas: [],
      anchors: [],
    },
    L,
  );
}

const door = (id: string, a: Vec2, b: Vec2, units: [string, string] | [string]): Opening => ({
  id,
  level: L,
  kind: units.length === 1 ? 'entrance' : 'door',
  segment: [a, b],
  units,
});

/** Все точки помещения связаны: из любой можно дойти до любой, переходя между видящими друг друга. */
function connected(doc: MapDocument, points: Vec2[]): boolean {
  if (points.length < 2) return true;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    points.forEach((p, j) => {
      if (!seen.has(j) && distance(points[i]!, p) <= doc.settings.linkRange && hasLineOfSight(doc, L, points[i]!, p)) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === points.length;
}

describe('расстановка точек съёмки', () => {
  it('комната 7 × 5 м — одна точка в центре', () => {
    const doc = plan([{ id: 'r', polygon: rectPolygon([0, 0], [7, 5]) }]);
    expect(planCapturePoints(doc, L)).toEqual([[3.5, 2.5]]);
  });

  it('Г-образная комната: пол закрыт, точки видят друг друга', () => {
    const doc = refreshCapturePoints(plan([{ id: 'r', polygon: [[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]] }]));
    const points = activeCapturePoints(doc).map((p) => p.pos);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(captureCoverage(doc, 'r')).toBeGreaterThanOrEqual(0.97);
    expect(connected(doc, points)).toBe(true);
  });

  it('колонна: точки не в колонне, пол за ней закрыт', () => {
    const doc = refreshCapturePoints(plan([{ id: 'r', polygon: rectPolygon([0, 0], [12, 8]), holes: [rectPolygon([5, 3], [7, 5])] }]));
    const unit = doc.units[0]!;
    const points = activeCapturePoints(doc).map((p) => p.pos);
    expect(points.every((p) => pointInUnit(p, unit))).toBe(true);
    expect(captureCoverage(doc, 'r')).toBeGreaterThanOrEqual(0.97);
    expect(connected(doc, points)).toBe(true);
  });

  it('длинный коридор — точки по оси, соседние в пределах перехода', () => {
    const doc = refreshCapturePoints(plan([{ id: 'c', kind: 'corridor', polygon: rectPolygon([0, 0], [24, 2]) }]));
    const xs = activeCapturePoints(doc)
      .map((p) => {
        expect(p.pos[1]).toBe(1);
        return p.pos[0];
      })
      .sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(14);
  });

  it('дверь не по центру: с обеих сторон есть точки, которые видят друг друга через проём', () => {
    const d = door('d', [5, 3], [6, 3], ['c', 'r']);
    const doc = refreshCapturePoints(
      plan(
        [
          { id: 'c', kind: 'corridor', polygon: rectPolygon([0, 0], [14, 3]) },
          { id: 'r', kind: 'room', polygon: rectPolygon([0, 3], [7, 8]) },
        ],
        [d],
      ),
    );
    const [corridor, room] = doc.units;
    const points = activeCapturePoints(doc).map((p) => p.pos);
    const inRoom = points.filter((p) => pointInUnit(p, room!));
    const inCorridor = points.filter((p) => pointInUnit(p, corridor!));
    const through = inRoom.some((a) =>
      inCorridor.some((b) => segmentIntersection(a, b, d.segment[0], d.segment[1]) && hasLineOfSight(doc, L, a, b) && distance(a, b) <= 15),
    );
    expect(through).toBe(true);
    expect(connected(doc, points)).toBe(true);
  });

  it('демо: у отснятых панорам новых точек нет, пол закрыт, ссылки целы', () => {
    const doc = refreshCapturePoints(rebuildGraph(demoVenue(), L));
    expect(validateReferences(doc)).toEqual([]);
    const auto = activeCapturePoints(doc, L);
    for (const pano of doc.panoramas) expect(auto.every((p) => distance(p.pos, pano.pos) >= 1.5)).toBe(true);
    for (const unit of doc.units) expect(captureCoverage(doc, unit.id)).toBeGreaterThanOrEqual(0.97);
  });

  it('повторный пересчёт без правок возвращает тот же документ', () => {
    const doc = refreshCapturePoints(rebuildGraph(demoVenue(), L));
    expect(refreshCapturePoints(doc)).toBe(doc);
  });
});

describe('правка точек съёмки', () => {
  const room = () => plan([{ id: 'r', polygon: rectPolygon([0, 0], [7, 5]) }]);

  it('своя точка в центре — рассчитанные не нужны', () => {
    const r = addCapturePoint(room(), L, [3.5, 2.5]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.capturePoints).toEqual([{ id: r.id, level: L, pos: [3.5, 2.5], origin: 'manual', panorama: null }]);
  });

  it('точку нельзя поставить вне помещения и вплотную к стене', () => {
    expect(addCapturePoint(room(), L, [9, 9]).ok).toBe(false);
    expect(addCapturePoint(room(), L, [0.1, 2]).ok).toBe(false);
  });

  it('сдвинутая рассчитанная точка становится ручной и остаётся на месте', () => {
    const doc = refreshCapturePoints(room());
    const id = doc.capturePoints![0]!.id;
    const r = moveCapturePoint(doc, id, [3, 2]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const moved = r.doc.capturePoints!.find((p) => p.id === id)!;
    expect(moved.origin).toBe('manual');
    expect(moved.pos).toEqual([3, 2]);
    expect(refreshCapturePoints(r.doc).capturePoints!.find((p) => p.id === id)!.pos).toEqual([3, 2]);
  });

  it('убранная точка не возвращается, пока её не вернут', () => {
    const doc = refreshCapturePoints(room());
    const removed = removeCapturePoint(doc, doc.capturePoints![0]!.id);
    expect(activeCapturePoints(removed)).toHaveLength(0);
    expect(refreshCapturePoints(removed)).toBe(removed);
    expect(activeCapturePoints(restoreRemovedCapturePoints(removed, L))).toHaveLength(1);
  });

  it('точки едут вместе с комнатой и пропадают вместе с ней', () => {
    const base = plan([
      { id: 'a', polygon: rectPolygon([0, 0], [7, 5]) },
      { id: 'b', polygon: rectPolygon([20, 0], [27, 5]) },
    ]);
    const r = addCapturePoint(base, L, [2, 2]);
    if (!r.ok) throw new Error(r.message);
    const moved = refreshCapturePoints(translateUnit(r.doc, 'a', [0, 10]));
    expect(moved.capturePoints!.find((p) => p.id === r.id)!.pos).toEqual([2, 12]);
    const gone = refreshCapturePoints(deleteUnit(r.doc, 'a'));
    expect(gone.capturePoints!.some((p) => p.id === r.id)).toBe(false);
    expect(activeCapturePoints(gone).every((p) => p.pos[0] >= 20)).toBe(true);
  });
});

describe('маршрут съёмки', () => {
  it('обходит все неснятые точки, начинается у входа, не проходит сквозь стены', () => {
    const doc = refreshCapturePoints(rebuildGraph(demoVenue(), L));
    const route = captureRoute(doc, L);
    const pending = pendingCapturePoints(doc, L).map((p) => p.id);
    expect([...route.order].sort()).toEqual([...pending].sort());
    expect(route.legs[0]!.from).toBeNull();
    expect(route.legs[0]!.line[0]).toEqual(doc.anchors[0]!.pos);
    expect(Number.isFinite(route.length)).toBe(true);
    for (const leg of route.legs) {
      for (let i = 1; i < leg.line.length; i++) expect(hasLineOfSight(doc, L, leg.line[i - 1]!, leg.line[i]!)).toBe(true);
    }
  });

  it('точки в коридоре — по порядку от входа', () => {
    const doc = refreshCapturePoints(plan([{ id: 'c', kind: 'corridor', polygon: rectPolygon([0, 0], [24, 2]) }]));
    const route = captureRoute(doc, L, [0.5, 1]);
    const xs = route.order.map((id) => doc.capturePoints!.find((p) => p.id === id)!.pos[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('логичный маршрут', () => {
  // Два пути из A в C: «Г» — 20,4 м и один поворот; «лесенка» — 20 м и три поворота.
  const graphDoc = (): MapDocument => {
    const doc = demoVenue();
    const nodes: [string, Vec2][] = [
      ['A', [0, 0]],
      ['B', [10, 0]],
      ['C', [10, 10]],
      ['P', [5, 0]],
      ['Q', [5, 5]],
      ['R', [10, 5]],
    ];
    const edges: [string, string, number][] = [
      ['A', 'B', 10.2],
      ['B', 'C', 10.2],
      ['A', 'P', 5],
      ['P', 'Q', 5],
      ['Q', 'R', 5],
      ['R', 'C', 5],
    ];
    return {
      ...doc,
      graph: {
        nodes: nodes.map(([id, pos]) => ({ id, level: L, pos, origin: 'manual' as const })),
        edges: edges.map(([from, to, weight], i) => ({ id: `e${i}`, from, to, weight, access: 'public' as const })),
      },
    };
  };

  it('без штрафа — кратчайший, со штрафом за повороты — путь с меньшим числом поворотов, длина честная', () => {
    const doc = graphDoc();
    const plain = new NavGraph(doc).route('A', 'C');
    const logical = new NavGraph(doc, { turnPenalty: 1 }).route('A', 'C');
    expect(plain.ok && plain.nodes).toEqual(['A', 'P', 'Q', 'R', 'C']);
    expect(logical.ok && logical.nodes).toEqual(['A', 'B', 'C']);
    expect(logical.ok && logical.length).toBeCloseTo(20.4);
  });
});
