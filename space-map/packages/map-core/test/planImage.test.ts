import { describe, expect, it } from 'vitest';
import { applyRecognizedPlan, NavGraph, polygonArea, recognizePlan, setUnderlay, underlayToPlan, validateReferences } from '../src/index.ts';
import type { MapDocument, Vec2 } from '../src/index.ts';

/** Картинка плана: белый лист, стены — чёрные прямоугольники в метрах (x вправо, y вниз от угла листа). */
function drawPlan(widthM: number, heightM: number, ppm: number, rects: [number, number, number, number][]) {
  const width = Math.round(widthM * ppm);
  const height = Math.round(heightM * ppm);
  const gray = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.round(y0 * ppm); y < Math.round(y1 * ppm); y++) {
      for (let x = Math.round(x0 * ppm); x < Math.round(x1 * ppm); x++) gray[y * width + x] = 20;
    }
  }
  return { gray, width, height, pxPerM: ppm };
}

const T = 0.1; // половина толщины стены

/** Горизонтальная стена на высоте y от x0 до x1 с проёмами [начало, конец]. */
function hWall(y: number, x0: number, x1: number, gaps: [number, number][] = []): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let from = x0 - T;
  for (const [g0, g1] of gaps) {
    out.push([from, y - T, g0, y + T]);
    from = g1;
  }
  out.push([from, y - T, x1 + T, y + T]);
  return out;
}

function vWall(x: number, y0: number, y1: number, gaps: [number, number][] = []): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let from = y0 - T;
  for (const [g0, g1] of gaps) {
    out.push([x - T, from, x + T, g0]);
    from = g1;
  }
  out.push([x - T, from, x + T, y1 + T]);
  return out;
}

/**
 * Здание 20 × 12 м на листе 24 × 16 м: коридор 2 м посередине, сверху три кабинета, снизу два,
 * у каждого дверь 0,9 м в коридор, вход с улицы 1,4 м в левом торце коридора. Плюс подписи-«буквы».
 */
function officePlan(ppm = 40) {
  const walls = [
    ...hWall(2, 2, 22),
    ...hWall(14, 2, 22),
    ...vWall(2, 2, 14, [[7.3, 8.7]]),
    ...vWall(22, 2, 14),
    ...hWall(7, 2, 22, [[4, 4.9], [10, 10.9], [17, 17.9]]),
    ...hWall(9, 2, 22, [[6, 6.9], [15, 15.9]]),
    ...vWall(8, 2, 7),
    ...vWall(14, 2, 7),
    ...vWall(12, 9, 14),
  ];
  // Подписи комнат: мелкие тёмные пятна не должны превращаться в стены.
  const letters: [number, number, number, number][] = [];
  for (const [cx, cy] of [[5, 4.5], [11, 4.5], [18, 4.5], [7, 11.5], [17, 11.5]] as Vec2[]) {
    for (let i = 0; i < 4; i++) letters.push([cx + i * 0.3, cy, cx + i * 0.3 + 0.15, cy + 0.3]);
  }
  return drawPlan(24, 16, ppm, [...walls, ...letters]);
}

function bbox(polygon: Vec2[]): [number, number, number, number] {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Тот же этаж, как рисуют архитекторы: стены контуром в две линии, дуги открывания дверей, стол, серый пол. */
function outlinePlan(ppm = 30) {
  const W = 24 * ppm;
  const H = 16 * ppm;
  const gray = new Uint8Array(W * H).fill(250);
  for (let y = 2 * ppm; y < 14 * ppm; y++) for (let x = 2 * ppm; x < 22 * ppm; x++) gray[y * W + x] = 225;
  const dot = (x: number, y: number) => {
    const px = Math.round(x * ppm);
    const py = Math.round(y * ppm);
    if (px >= 0 && py >= 0 && px < W && py < H) gray[py * W + px] = 30;
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * ppm * 2);
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  };
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    line(x0, y0, x1, y0);
    line(x1, y0, x1, y1);
    line(x1, y1, x0, y1);
    line(x0, y1, x0, y0);
  };
  const walls = [
    ...hWall(2, 2, 22),
    ...hWall(14, 2, 22),
    ...vWall(2, 2, 14, [[7.3, 8.7]]),
    ...vWall(22, 2, 14),
    ...hWall(7, 2, 22, [[4, 4.9], [10, 10.9], [17, 17.9]]),
    ...hWall(9, 2, 22, [[6, 6.9], [15, 15.9]]),
    ...vWall(8, 2, 7),
    ...vWall(14, 2, 7),
    ...vWall(12, 9, 14),
  ];
  for (const [x0, y0, x1, y1] of walls) box(x0, y0, x1, y1);
  for (const x of [4, 10, 17]) {
    line(x, 6.9, x, 6);
    for (let a = 0; a <= 90; a += 2) dot(x + 0.9 * Math.sin((a * Math.PI) / 180), 6.9 - 0.9 * Math.cos((a * Math.PI) / 180));
  }
  box(16, 3, 19, 4.5);
  return { gray, width: W, height: H, pxPerM: ppm };
}

function emptyDoc(): MapDocument {
  return {
    schema: 2,
    venue: { id: 'v', name: 'Офис', planNorth: null, scaleClass: 'scaled' },
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

describe('распознавание плана по картинке', () => {
  it('находит кабинеты и коридор по середине стен, двери и вход', () => {
    const plan = recognizePlan(officePlan());
    expect(plan.rooms).toHaveLength(6);
    const corridors = plan.rooms.filter((r) => r.kind === 'corridor');
    expect(corridors).toHaveLength(1);
    // Коридор: от середины левой стены до правой, от y = 7 до 9 (на картинке) — то есть −7…−9 на плане.
    const [x0, y0, x1, y1] = bbox(corridors[0]!.polygon);
    expect(x0).toBeCloseTo(2, 0);
    expect(x1).toBeCloseTo(22, 0);
    expect(y0).toBeCloseTo(-9, 0);
    expect(y1).toBeCloseTo(-7, 0);
    // Каждая комната — прямоугольник по середине своих стен (±0,12 м).
    const expected = [
      [2, -7, 8, -2],
      [8, -7, 14, -2],
      [14, -7, 22, -2],
      [2, -14, 12, -9],
      [12, -14, 22, -9],
      [2, -9, 22, -7],
    ];
    for (const room of plan.rooms) {
      expect(room.polygon).toHaveLength(4);
      const box = bbox(room.polygon);
      const match = expected.find((e) => e.every((v, i) => Math.abs(v - box[i]!) < 0.12));
      expect(match, JSON.stringify(box)).toBeDefined();
    }
    expect(plan.doors.filter((d) => d.rooms.length === 2)).toHaveLength(5);
    const entrances = plan.doors.filter((d) => d.rooms.length === 1);
    expect(entrances).toHaveLength(1);
    expect(entrances[0]!.at[0]).toBeCloseTo(2, 0);
    expect(entrances[0]!.width).toBeGreaterThan(1.1);
  });

  it('стены контуром, дуги дверей и мебель не мешают', () => {
    const plan = recognizePlan(outlinePlan());
    expect(plan.rooms).toHaveLength(6);
    expect(plan.rooms.every((r) => r.polygon.length === 4)).toBe(true);
    expect(plan.doors.filter((d) => d.rooms.length === 2)).toHaveLength(5);
    expect(plan.doors.filter((d) => d.rooms.length === 1)).toHaveLength(1);
  });

  it('без распознанной двери узкий проём не склеивает комнаты, а широкий вход не делает коридор улицей', () => {
    const plan = recognizePlan(officePlan(25));
    expect(plan.rooms).toHaveLength(6);
    expect(plan.rooms.filter((r) => r.kind === 'corridor')).toHaveLength(1);
  });

  it('распознанный план становится этажом: двери на общих стенах, маршрут из кабинета в кабинет', () => {
    const plan = recognizePlan(officePlan());
    const { doc, rooms, doors } = applyRecognizedPlan(emptyDoc(), 'L1', plan, [0, 16]);
    expect(rooms).toBe(6);
    expect(doors).toBe(6);
    expect(validateReferences(doc)).toEqual([]);
    expect(doc.openings.filter((o) => o.kind === 'entrance')).toHaveLength(1);
    // Двери стоят там, где проёмы на картинке: дверь кабинета слева сверху — x 4…4,9, на стене y = 16 − 7 = 9.
    const door = doc.openings.find((o) => o.kind === 'door' && Math.abs(o.segment[0][1] - 9) < 0.15 && o.segment[0][0] < 6)!;
    expect(door).toBeDefined();
    const mid = (door.segment[0][0] + door.segment[1][0]) / 2;
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(5);
    // Из первого кабинета в последний — через двери и коридор.
    const offices = doc.units.filter((u) => u.kind === 'room');
    const nodeIn = (polygon: Vec2[]) => doc.graph.nodes.find((n) => pointIn(n.pos, polygon))!;
    const route = new NavGraph(doc).route(nodeIn(offices[0]!.polygon).id, nodeIn(offices[offices.length - 1]!.polygon).id);
    expect(route.ok).toBe(true);
  });

  it('подложка: пиксель картинки → точка плана', () => {
    const underlay = { asset: 'a', pxPerM: 50, origin: [10, 20] as Vec2, rotation: 0, opacity: 0.5 };
    expect(underlayToPlan(underlay, 100, 50)).toEqual([12, 19]);
    const doc = setUnderlay(emptyDoc(), 'L1', underlay);
    expect(doc.levels[0]!.underlay).toEqual(underlay);
    expect(setUnderlay(doc, 'L1', null).levels[0]!.underlay).toBeNull();
  });
});

function pointIn(p: Vec2, polygon: Vec2[]): boolean {
  const [x0, y0, x1, y1] = bbox(polygon);
  return p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;
}
