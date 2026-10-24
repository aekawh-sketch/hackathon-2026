import { describe, expect, it } from 'vitest';
import { demoVenue, panoramaForPlace, rectPolygon, type MapDocument, type PanoramaPlacement, type Place, type Vec2 } from '../src/index.ts';

const L = 'L1';

/** Две комнаты через стену x = 10 с дверью y 4…5: «Зал» слева, «Кабинет» справа. */
function plan(panoramas: PanoramaPlacement[], places: Place[]): MapDocument {
  const doc = demoVenue();
  return {
    ...doc,
    units: [
      { id: 'hall', level: L, kind: 'hall', name: 'Зал', walkable: true, polygon: rectPolygon([0, 0], [10, 8]) },
      { id: 'office', level: L, kind: 'room', name: 'Кабинет', walkable: true, polygon: rectPolygon([10, 0], [16, 8]) },
    ],
    obstacles: [],
    openings: [{ id: 'd', level: L, kind: 'door', segment: [[10, 4], [10, 5]], units: ['hall', 'office'] }],
    graph: { nodes: [], edges: [] },
    places,
    panoramas,
    anchors: [],
  };
}

const pano = (id: string, pos: Vec2, extra: Partial<PanoramaPlacement> = {}): PanoramaPlacement => ({
  id,
  pano: id,
  level: L,
  pos,
  node: null,
  heading: 0,
  cameraHeight: 1.5,
  markers: [],
  customMarkers: [],
  links: [],
  ...extra,
});

const place = (id: string, pos: Vec2): Place => ({
  id,
  level: L,
  pos,
  node: null,
  polygon: null,
  name: id,
  category: 'hall',
  number: null,
  description: '',
  photos: [],
  hours: null,
  hidden: false,
});

describe('панорама для места', () => {
  it('сначала панорама с меткой места, даже если другая ближе', () => {
    const p = place('стенд', [4, 4]);
    const doc = plan([pano('near', [5, 4]), pano('far', [1, 1], { markers: [{ place: 'стенд', yaw: 33, pitch: -5, status: 'accepted' }] })], [p]);
    expect(panoramaForPlace(doc, p)).toMatchObject({ panorama: { id: 'far' }, yaw: 33, reason: 'marker' });
  });

  it('без метки — ближайшая в той же комнате, а не за стеной', () => {
    const p = place('стенд', [9, 2]);
    const doc = plan([pano('wall', [11, 2]), pano('room', [3, 2])], [p]);
    const r = panoramaForPlace(doc, p)!;
    expect(r.panorama.id).toBe('room');
    expect(r.reason).toBe('room');
    expect(r.yaw).toBeCloseTo(90); // место строго справа, панорама смотрит «вверх»
  });

  it('в комнате панорам нет — та, откуда место видно через дверь', () => {
    const p = place('шкаф', [12, 4.5]);
    const doc = plan([pano('hall', [6, 4.5])], [p]);
    expect(panoramaForPlace(doc, p)).toMatchObject({ panorama: { id: 'hall' }, reason: 'visible' });
  });

  it('не видно ниоткуда — нет панорамы', () => {
    const p = place('шкаф', [15, 1]);
    const doc = plan([pano('hall', [2, 7])], [p]);
    expect(panoramaForPlace(doc, p)).toBeNull();
  });

  it('у неориентированной панорамы направление неизвестно', () => {
    const p = place('стенд', [4, 4]);
    const doc = plan([pano('raw', [2, 2], { heading: null })], [p]);
    expect(panoramaForPlace(doc, p)).toMatchObject({ panorama: { id: 'raw' }, yaw: null });
  });
});

describe('миниатюра плана', () => {
  it('контуры нижнего этажа с границами; пустой план — null', async () => {
    const { planOutline } = await import('../src/index.ts');
    const doc = demoVenue();
    const outline = planOutline(doc)!;
    expect(outline.units.length).toBe(doc.units.filter((u) => u.level === doc.levels[0]!.id).length);
    for (const u of outline.units) for (const [x, y] of u.polygon) {
      expect(x).toBeGreaterThanOrEqual(outline.bounds.minX);
      expect(y).toBeLessThanOrEqual(outline.bounds.maxY);
    }
    expect(planOutline({ ...doc, units: [] })).toBeNull();
    const big = { ...doc, units: [{ ...doc.units[0]!, polygon: Array.from({ length: 400 }, (_, i) => [Math.cos(i / 64) * 5, Math.sin(i / 64) * 5] as [number, number]) }] };
    expect(planOutline(big, 150, 40)!.units[0]!.polygon.length).toBeLessThanOrEqual(40);
  });
});
