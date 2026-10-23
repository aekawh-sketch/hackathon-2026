import { describe, expect, it } from 'vitest';
import {
  cameraForward,
  demoVenue,
  deviceQuaternion,
  headingFromAim,
  projectToCamera,
  rectPolygon,
  routeDirectionInPanorama,
  routeInPanorama,
  routeOnCamera,
  type CameraPose,
  type MapDocument,
  type PanoramaPlacement,
  type Vec2,
} from '../src/index.ts';

const L = 'L1';

/** Две комнаты 5 × 5 м, между ними дверь на x = 5, y 2…3. */
function twoRooms(): MapDocument {
  const doc = demoVenue();
  return {
    ...doc,
    units: [
      { id: 'a', level: L, kind: 'room', name: 'А', walkable: true, polygon: rectPolygon([0, 0], [5, 5]) },
      { id: 'b', level: L, kind: 'room', name: 'Б', walkable: true, polygon: rectPolygon([5, 0], [10, 5]) },
    ],
    obstacles: [],
    openings: [{ id: 'd', level: L, kind: 'door', segment: [[5, 2], [5, 3]], units: ['a', 'b'] }],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
  };
}

const pano = (pos: Vec2, heading: number | null): PanoramaPlacement => ({
  id: 'pa',
  pano: 'x',
  level: L,
  pos,
  node: null,
  heading,
  cameraHeight: 1.5,
  markers: [],
  customMarkers: [],
  links: [],
});

const close = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe('маршрут на полу панорамы', () => {
  it('прямо по курсу: yaw 0, линия поднимается к горизонту с расстоянием', () => {
    const doc = twoRooms();
    const lines = routeInPanorama(doc, pano([1, 2.5], 90), [
      [1, 2.5],
      [9.5, 2.5],
    ]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.every(([yaw]) => Math.abs(yaw) < 0.2)).toBe(true);
    for (let i = 1; i < line.length; i++) expect(line[i]![1]).toBeGreaterThanOrEqual(line[i - 1]![1]);
    expect(line[line.length - 1]![1]).toBeCloseTo((Math.atan2(-1.5, 8.5) * 180) / Math.PI, 0);
  });

  it('часть маршрута за стеной не рисуется', () => {
    const doc = twoRooms();
    const lines = routeInPanorama(doc, pano([2.5, 2.5], 90), [
      [2.5, 2.5],
      [7.5, 2.5],
      [7.5, 4.8],
    ]);
    // Через дверь видно только узкий сектор: всё, что нарисовано, — в нём.
    const half = (Math.atan(0.5 / 2.5) * 180) / Math.PI;
    expect(lines.flat().every(([yaw]) => Math.abs(yaw) <= half + 0.5)).toBe(true);
    expect(lines.flat().length).toBeGreaterThan(5);
  });

  it('без направления панорамы — пусто', () => {
    expect(routeInPanorama(twoRooms(), pano([1, 2.5], null), [[1, 2.5], [4, 2.5]])).toEqual([]);
  });

  it('куда продолжается маршрут — для стрелки, когда перехода нет', () => {
    const yaw = routeDirectionInPanorama(twoRooms(), pano([1, 1], 0), [
      [1, 1],
      [4, 1],
      [4, 4],
    ]);
    expect(yaw).toBeCloseTo(90, 0);
  });
});

describe('маршрут на экране камеры', () => {
  const view = { width: 400, height: 800, vfov: 67 };

  it('телефон лежит экраном вверх — поворота нет; стоит вертикально — камера смотрит вперёд', () => {
    close(deviceQuaternion(0, 0, 0), [0, 0, 0, 1]);
    close(cameraForward(deviceQuaternion(0, 90, 0)), [0, 1, 0]);
    // alpha растёт против часовой: повернулись на 90° влево — смотрим вдоль −x.
    close(cameraForward(deviceQuaternion(90, 90, 0)), [-1, 0, 0]);
  });

  it('точка пола впереди — по центру ниже горизонта, правее — правее, за спиной — не видна', () => {
    const pose: CameraPose = { pos: [0, 0], height: 1.5, worldHeading: 0, q: deviceQuaternion(0, 90, 0) };
    const ahead = projectToCamera(pose, view, [0, 5])!;
    expect(ahead.x).toBeCloseTo(200);
    expect(ahead.y).toBeGreaterThan(400);
    expect(projectToCamera(pose, view, [1, 5])!.x).toBeGreaterThan(200);
    expect(projectToCamera(pose, view, [0, -5])).toBeNull();
    // Точка на высоте камеры — ровно в центре экрана.
    const eye = projectToCamera(pose, view, [0, 5], 1.5)!;
    expect(eye.y).toBeCloseTo(400);
  });

  it('прицел на дверь связывает датчики с планом: дверь потом оказывается в центре экрана', () => {
    const q = deviceQuaternion(30, 90, 0);
    const doorPos: Vec2 = [10, 0];
    const heading = headingFromAim(q, [0, 0], doorPos)!;
    expect(heading).toBeCloseTo(120);
    const s = projectToCamera({ pos: [0, 0], height: 1.5, worldHeading: heading, q }, view, doorPos, 1.5)!;
    expect(s.x).toBeCloseTo(200);
    expect(s.y).toBeCloseTo(400);
    expect(headingFromAim(deviceQuaternion(0, 0, 0), [0, 0], doorPos)).toBeNull();
  });

  it('маршрут прямо по курсу ложится вертикальной линией к центру экрана', () => {
    const doc = twoRooms();
    const pose: CameraPose = { pos: [1, 2.5], height: 1.5, worldHeading: 90, q: deviceQuaternion(0, 90, 0) };
    const lines = routeOnCamera(doc, L, pose, view, [
      [1, 2.5],
      [9.5, 2.5],
    ]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.every(([x]) => Math.abs(x - 200) < 1)).toBe(true);
    for (let i = 1; i < line.length; i++) expect(line[i]![1]).toBeLessThanOrEqual(line[i - 1]![1]);
    expect(line[line.length - 1]![1]).toBeGreaterThan(400);
  });
});
