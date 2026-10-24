import { describe, expect, it } from 'vitest';
import {
  acceptSuggestions,
  addLink,
  azimuth,
  demoVenue,
  isLinked,
  normalize180,
  orientPanorama,
  rectPolygon,
  removeLink,
  resetLinkYaw,
  setLinkYaw,
  setPanoramaHeading,
  type MapDocument,
  type PanoramaPlacement,
  type Vec2,
} from '../src/index.ts';

const L = 'L1';

/** «Зал» 0…10 и «Кабинет» 10…16 через дверь y 4…5; панорамы a и c в зале, b в кабинете. */
function plan(): MapDocument {
  const doc = demoVenue();
  const pano = (id: string, pos: Vec2, heading: number): PanoramaPlacement => ({
    id,
    pano: id,
    level: L,
    pos,
    node: null,
    heading,
    cameraHeight: 1.5,
    markers: [],
    customMarkers: [],
    links: [],
  });
  return {
    ...doc,
    venue: { ...doc.venue, scaleClass: 'scaled' },
    units: [
      { id: 'hall', level: L, kind: 'hall', name: 'Зал', walkable: true, polygon: rectPolygon([0, 0], [10, 8]) },
      { id: 'office', level: L, kind: 'room', name: 'Кабинет', walkable: true, polygon: rectPolygon([10, 0], [16, 8]) },
    ],
    obstacles: [],
    openings: [{ id: 'd', level: L, kind: 'door', segment: [[10, 4], [10, 5]], units: ['hall', 'office'] }],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [pano('a', [5, 4.5], 0), pano('b', [13, 4.5], 90), pano('c', [2, 1], 0)],
    anchors: [],
    settings: { markerRange: 15, linkRange: 15 },
  };
}

const link = (doc: MapDocument, from: string, to: string) => doc.panoramas.find((p) => p.id === from)!.links.find((l) => l.to === to);
const planYaw = (doc: MapDocument, from: string, to: string) => {
  const a = doc.panoramas.find((p) => p.id === from)!;
  const b = doc.panoramas.find((p) => p.id === to)!;
  return Math.round(normalize180(azimuth(a.pos, b.pos) - a.heading!) * 10) / 10;
};

describe('стрелки переходов вручную', () => {
  const linked = () => acceptSuggestions(plan(), 'a');

  it('стрелка встаёт, куда нажали, и помечается ручной', () => {
    const doc = setLinkYaw(linked(), 'a', 'b', 200);
    expect(link(doc, 'a', 'b')).toEqual({ to: 'b', yaw: -160, status: 'accepted', manual: true });
    // Остальные стрелки не тронуты.
    expect(link(doc, 'a', 'c')).toEqual(link(linked(), 'a', 'c'));
  });

  it('поворот панорамы пересчитывает подсказанные стрелки, а ручные оставляет', () => {
    const manual = setLinkYaw(linked(), 'a', 'b', 12);
    const turned = setPanoramaHeading(manual, 'a', 45);
    expect(turned.panoramas.find((p) => p.id === 'a')!.heading).toBe(45);
    expect(link(turned, 'a', 'b')).toEqual({ to: 'b', yaw: 12, status: 'accepted', manual: true });
    expect(link(turned, 'a', 'c')!.yaw).toBe(planYaw(turned, 'a', 'c'));
    expect(link(turned, 'a', 'c')!.manual).toBeUndefined();
  });

  it('«Повернуть по двери» тоже не сбивает ручные стрелки', () => {
    const manual = setLinkYaw(linked(), 'a', 'b', 12);
    // Середина двери (10; 4,5) видна в панораме под yaw 60 → направление пересчитается.
    const oriented = orientPanorama(manual, 'a', [10, 4.5], 60);
    expect(oriented.panoramas.find((p) => p.id === 'a')!.heading).toBe(30);
    expect(link(oriented, 'a', 'b')!.yaw).toBe(12);
  });

  it('«По плану» возвращает расчёт и снимает пометку', () => {
    const doc = resetLinkYaw(setLinkYaw(linked(), 'a', 'b', 12), 'a', 'b');
    expect(link(doc, 'a', 'b')).toEqual({ to: 'b', yaw: planYaw(doc, 'a', 'b'), status: 'accepted' });
    expect(link(doc, 'a', 'b')!.yaw).toBe(90);
  });

  it('новый переход: стрелка вручную, у соседа — обратная по плану', () => {
    const doc = addLink(plan(), 'b', 'c', -100);
    expect(link(doc, 'b', 'c')).toEqual({ to: 'c', yaw: -100, status: 'accepted', manual: true });
    expect(link(doc, 'c', 'b')).toEqual({ to: 'b', yaw: planYaw(doc, 'c', 'b'), status: 'accepted' });
    expect(isLinked(doc, 'b', 'c')).toBe(true);
    // Повторное добавление заменяет стрелку, а не дублирует; уже стоящую обратную не трогает.
    const again = addLink(setLinkYaw(doc, 'c', 'b', 5), 'b', 'c', -90);
    expect(again.panoramas.find((p) => p.id === 'b')!.links.filter((l) => l.to === 'c')).toHaveLength(1);
    expect(link(again, 'b', 'c')!.yaw).toBe(-90);
    expect(link(again, 'c', 'b')!.yaw).toBe(5);
  });

  it('без направления соседа обратная стрелка не ставится', () => {
    const doc = plan();
    const noHeading = { ...doc, panoramas: doc.panoramas.map((p) => (p.id === 'c' ? { ...p, heading: null } : p)) };
    const next = addLink(noHeading, 'b', 'c', -100);
    expect(link(next, 'b', 'c')).toBeDefined();
    expect(link(next, 'c', 'b')).toBeUndefined();
  });

  it('переход в саму себя или в несуществующую панораму не добавляется', () => {
    const doc = plan();
    expect(addLink(doc, 'a', 'a', 0)).toBe(doc);
    expect(addLink(doc, 'a', 'nope', 0)).toBe(doc);
  });

  it('удаление перехода — в обе стороны', () => {
    const both = acceptSuggestions(acceptSuggestions(plan(), 'a'), 'b');
    expect(isLinked(both, 'a', 'b')).toBe(true);
    const doc = removeLink(both, 'a', 'b');
    expect(link(doc, 'a', 'b')).toBeUndefined();
    expect(link(doc, 'b', 'a')).toBeUndefined();
    expect(isLinked(doc, 'a', 'b')).toBe(false);
    expect(link(doc, 'a', 'c')).toBeDefined();
  });
});
