import { businessCentreFixture } from './fixtures/businessCentre.ts';
import { describe, expect, it } from 'vitest';
import {
  activeCapturePoints,
  addPanoramaAtPoint,
  directionInFrame,
  equirectDirection,
  isLinked,
  orientPanorama,
  pendingCapturePoints,
  visibleLandmarks,
  rebuildGraph,
  refreshCapturePoints,
  SphereCoverage,
  validateReferences,
  type CameraFrustum,
  type Quat,
} from '../src/index.ts';

const close = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

/** Камера повернулась вправо на yaw и вверх на pitch (градусы). */
function look(yaw: number, pitch: number): Quat {
  const y = (-yaw * Math.PI) / 360;
  const p = (pitch * Math.PI) / 360;
  // q = qY(−yaw) · qX(pitch)
  const [ax, ay, az, aw] = [0, Math.sin(y), 0, Math.cos(y)];
  const [bx, by, bz, bw] = [Math.sin(p), 0, 0, Math.cos(p)];
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** Основная камера телефона вертикально: ~53° × 67° (ТЗ 5.4). */
const frame = (yaw: number, pitch: number): CameraFrustum => ({ q: look(yaw, pitch), tanX: Math.tan((53 * Math.PI) / 360), tanY: Math.tan((67 * Math.PI) / 360) });

describe('фотосфера по ориентации камеры', () => {
  it('центр панорамы — вперёд, правее — вправо, верх — зенит', () => {
    close(equirectDirection(0.5, 0.5), [0, 0, -1]);
    close(equirectDirection(0.75, 0.5), [1, 0, 0]);
    close(equirectDirection(0.5, 0), [0, 1, 0]);
  });

  it('направление в кадре: по центру, у края, за спиной', () => {
    close(directionInFrame(frame(0, 0), [0, 0, -1])!, [0, 0]);
    expect(directionInFrame(frame(0, 0), [0, 0, 1])).toBeNull();
    // Повернулись вправо на 90° — то, что справа, теперь в центре.
    close(directionInFrame(frame(90, 0), [1, 0, 0])!, [0, 0]);
    expect(directionInFrame(frame(0, 0), [1, 0, -1])).toBeNull();
  });

  it('тот же кадр второй раз ничего не добавляет, подсказка ведёт к неснятому', () => {
    const c = new SphereCoverage();
    expect(c.gain(frame(0, 0))).toBe(1);
    c.mark(frame(0, 0));
    expect(c.gain(frame(0, 0))).toBe(0);
    expect(c.coveredAt([0, 0, -1])).toBe(true);
    expect(c.coveredAt([0, 0, 1])).toBe(false);
    const missing = c.nearestMissing([0, 0, -1])!;
    expect(directionInFrame(frame(0, 0), missing, 0.85)).toBeNull();
  });

  it('три пояса и зенит закрывают сферу выше −70°', () => {
    const c = new SphereCoverage();
    for (let yaw = 0; yaw < 360; yaw += 30) c.mark(frame(yaw, 0));
    for (let yaw = 0; yaw < 360; yaw += 40) c.mark(frame(yaw, 45));
    for (let yaw = 0; yaw < 360; yaw += 40) c.mark(frame(yaw, -45));
    for (let yaw = 0; yaw < 360; yaw += 120) c.mark(frame(yaw, 80));
    expect(c.fraction).toBeGreaterThan(0.97);
  });
});

describe('снятая панорама — на план', () => {
  it('встаёт в точку, точка снята, переходы в обе стороны, ссылки целы', () => {
    const doc = refreshCapturePoints(rebuildGraph(businessCentreFixture(), 'L1'));
    // Точка в коридоре у двери в переговорную — рядом панорама коридора.
    const point = pendingCapturePoints(doc, 'L1').find((p) => p.pos[0] === 13 && p.pos[1] === 5.5)!;
    expect(point).toBeDefined();
    const r = addPanoramaAtPoint(doc, { pointId: point.id, pano: 'shot-1', level: 'L1', pos: point.pos, heading: 90, cameraHeight: 1.45 });
    expect(validateReferences(r.doc)).toEqual([]);
    expect(activeCapturePoints(r.doc).find((p) => p.id === point.id)!.panorama).toBe(r.id);
    expect(pendingCapturePoints(r.doc).some((p) => p.id === point.id)).toBe(false);
    const pano = r.doc.panoramas.find((p) => p.id === r.id)!;
    expect(pano.node).not.toBeNull();
    expect(pano.links.length).toBeGreaterThan(0);
    const neighbour = r.doc.panoramas.find((p) => p.id === 'pa-corridor')!;
    expect(neighbour.links.some((l) => l.to === r.id && l.status === 'accepted')).toBe(true);
    expect(isLinked(r.doc, r.id, 'pa-corridor')).toBe(true);
  });
});

describe('направление загруженной панорамы по двери', () => {
  it('без направления меток и переходов нет; нажали на дверь — появились, направление верное', () => {
    const doc = refreshCapturePoints(rebuildGraph(businessCentreFixture(), 'L1'));
    const point = pendingCapturePoints(doc, 'L1').find((p) => p.pos[0] === 13 && p.pos[1] === 5.5)!;
    const placed = addPanoramaAtPoint(doc, { pointId: point.id, pano: 'shot-2', level: 'L1', pos: point.pos, heading: null, cameraHeight: 1.5 });
    const before = placed.doc.panoramas.find((p) => p.id === placed.id)!;
    expect(before.links).toEqual([]);

    // Из точки в коридоре видна дверь в переговорную «А» — она в списке ориентиров.
    const marks = visibleLandmarks(placed.doc, 'L1', point.pos);
    const doorA = marks.find((m) => m.name === 'Дверь в «Переговорная «А»»')!;
    expect(doorA).toBeDefined();
    expect(marks.every((m, i) => i === 0 || m.distance >= marks[i - 1]!.distance)).toBe(true);

    // В панораме эта дверь оказалась под yaw = 30°: значит, центр панорамы смотрит на 30° левее двери.
    const oriented = orientPanorama(placed.doc, placed.id, doorA.pos, 30);
    const pano = oriented.panoramas.find((p) => p.id === placed.id)!;
    expect(pano.heading).not.toBeNull();
    expect(pano.links.length).toBeGreaterThan(0);
    expect(isLinked(oriented, placed.id, 'pa-corridor')).toBe(true);
    expect(validateReferences(oriented)).toEqual([]);
  });
});
