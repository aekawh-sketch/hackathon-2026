import { describe, expect, it } from 'vitest';
import { addPlace, deletePanorama, demoVenue, panoramaForPlace, rectPolygon, setPlacePanorama, validateReferences, type MapDocument, type PanoramaPlacement, type Place, type Vec2 } from '../src/index.ts';

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

  it('без метки и своей — панорамы нет, даже если в той же комнате или у самого места есть чужая', () => {
    // Иначе панорама, загруженная для одного места, показывалась у всех мест комнаты,
    // а «Удалить панораму» в карточке удаляла чужую — и тут же подбиралась следующая.
    const p = { ...place('стенд', [9, 2]), node: 'n' };
    const doc = plan([pano('room', [3, 2]), pano('at', [9.2, 2], { node: 'n' }), pano('door', [11, 4.5])], [p]);
    expect(panoramaForPlace(doc, p)).toBeNull();
  });

  it('у неориентированной своей панорамы направление неизвестно', () => {
    const p = { ...place('стенд', [4, 4]), panorama: 'raw' };
    const doc = plan([pano('raw', [2, 2], { heading: null })], [p]);
    expect(panoramaForPlace(doc, p)).toMatchObject({ panorama: { id: 'raw' }, yaw: null, reason: 'own' });
  });
});

describe('своя панорама места', () => {
  it('новое место пустое, даже если рядом есть панорамы и место в них отмечено', () => {
    const doc = plan([pano('hall', [5, 4])], []);
    const added = addPlace(doc, L, [4, 4], 'hall', 'Туалет');
    const p = added.doc.places.find((x) => x.id === added.id)!;
    expect(p.panorama).toBeNull();
    const marked = { ...added.doc, panoramas: added.doc.panoramas.map((pa) => ({ ...pa, markers: [{ place: p.id, yaw: 10, pitch: 0, status: 'accepted' as const }] })) };
    expect(panoramaForPlace(marked, p)).toBeNull();
  });

  it('снятая для места — его, взгляд по метке или на место', () => {
    const p = { ...place('стенд', [4, 4]), panorama: 'mine' };
    const doc = plan([pano('near', [4.5, 4]), pano('mine', [2, 4])], [p]);
    expect(panoramaForPlace(doc, p)).toMatchObject({ panorama: { id: 'mine' }, yaw: 90, reason: 'own' });
  });

  it('удалили панораму — место снова пустое, ссылок в пустоту нет', () => {
    const doc = plan([pano('mine', [2, 4])], [place('стенд', [4, 4])]);
    const bound = setPlacePanorama(doc, 'стенд', 'mine');
    const after = deletePanorama(bound, 'mine');
    expect(after.places[0]!.panorama).toBeNull();
    expect(validateReferences(after).filter((i) => i.path.startsWith('places') && i.path.endsWith('.panorama'))).toEqual([]);
    expect(validateReferences({ ...bound, panoramas: [] }).some((i) => i.path === 'places[0].panorama')).toBe(true);
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
