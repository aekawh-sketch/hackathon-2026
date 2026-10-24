import { describe, expect, it } from 'vitest';
import {
  addPanoramaAtPoint,
  capturePointForPlace,
  deletePanorama,
  demoVenue,
  panoramaForPlace,
  rectPolygon,
  refreshCapturePoints,
  removeCapturePoint,
  setPlacePanorama,
  validateReferences,
  type CapturePoint,
  type MapDocument,
  type PanoramaPlacement,
  type Place,
  type ShotPanorama,
  type Vec2,
} from '../src/index.ts';

const L = 'L1';

/** «Зал» 0…10 и «Кабинет» 10…16 через дверь y 4…5. Точки съёмки — свои, чтобы расчёт их не двигал. */
function plan(capturePoints: CapturePoint[], places: Place[] = [], panoramas: PanoramaPlacement[] = []): MapDocument {
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
    places: places.map((p) => ({ ...p, category: doc.categories[0]!.id })),
    panoramas,
    anchors: [],
    capturePoints,
  };
}

const point = (id: string, pos: Vec2, extra: Partial<CapturePoint> = {}): CapturePoint => ({ id, level: L, pos, origin: 'manual', panorama: null, ...extra });
const place = (id: string, pos: Vec2, extra: Partial<Place> = {}): Place => ({
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
  ...extra,
});
const shot = (pointId: string | null, pos: Vec2, pano: string): ShotPanorama => ({ pointId, pano, level: L, pos, heading: null, cameraHeight: 1.5 });
const pointOf = (doc: MapDocument, id: string) => doc.capturePoints!.find((p) => p.id === id)!;
/** Так делает редактор после каждой правки. */
const upload = (doc: MapDocument, s: ShotPanorama) => {
  const r = addPanoramaAtPoint(doc, s);
  return { doc: refreshCapturePoints(r.doc), id: r.id };
};

describe('загрузка панорамы в точку', () => {
  const base = () => plan([point('cp-a', [3, 4]), point('cp-b', [7, 4]), point('cp-c', [13, 4])], [place('стенд', [3, 4.5]), place('бар', [7, 3])]);

  it('встаёт только в свою точку, у мест комнаты чужой панорамы не появляется', () => {
    const { doc, id } = upload(base(), shot('cp-a', [3, 4], 'asset-1'));
    expect(pointOf(doc, 'cp-a').panorama).toBe(id);
    expect(pointOf(doc, 'cp-b').panorama).toBeNull();
    expect(pointOf(doc, 'cp-c').panorama).toBeNull();
    for (const p of doc.places) expect(panoramaForPlace(doc, p)).toBeNull();
    expect(validateReferences(doc)).toEqual([]);
  });

  it('повторно в ту же точку — замена, а не вторая панорама поверх', () => {
    const first = upload(base(), shot('cp-a', [3, 4], 'asset-1'));
    const own = setPlacePanorama(first.doc, 'стенд', first.id);
    const second = upload(own, shot('cp-a', [3, 4], 'asset-2'));
    expect(second.doc.panoramas.map((p) => p.pano)).toEqual(['asset-2']);
    expect(pointOf(second.doc, 'cp-a').panorama).toBe(second.id);
    // Место, для которого прежняя была своей, получило новую.
    expect(second.doc.places.find((p) => p.id === 'стенд')!.panorama).toBe(second.id);
    // Одна точка — одна панорама, лишних точек не появилось.
    expect(second.doc.capturePoints!.filter((p) => p.panorama !== null)).toHaveLength(1);
    expect(validateReferences(second.doc)).toEqual([]);
  });

  it('ID точки достался точке в другом месте — у панорамы своя точка, чужая не заменяется', () => {
    const b = upload(base(), shot('cp-b', [7, 4], 'asset-b'));
    // Маршрут съёмки помнил «cp-b», а сняли в 4 м от неё.
    const far = upload(b.doc, shot('cp-b', [3, 1], 'asset-far'));
    expect(pointOf(far.doc, 'cp-b').panorama).toBe(b.id);
    expect(far.doc.panoramas.map((p) => p.pano).sort()).toEqual(['asset-b', 'asset-far']);
    expect(far.doc.capturePoints!.find((p) => p.panorama === far.id)).toMatchObject({ pos: [3, 1], origin: 'manual' });
  });

  it('номер удалённой панорамы не достаётся новой', () => {
    const one = upload(base(), shot('cp-a', [3, 4], 'asset-1'));
    const two = upload(one.doc, shot('cp-b', [7, 4], 'asset-2'));
    const third = upload(deletePanorama(two.doc, one.id), shot('cp-c', [13, 4], 'asset-3'));
    expect([one.id, two.id, third.id]).toEqual(['pa-1', 'pa-2', 'pa-3']);
  });
});

describe('удаление', () => {
  it('«Убрать точку» со снятой панорамой — панорама уходит вместе с ней, без бесхозных', () => {
    // Рассчитанная точка без панорамы при пересчёте уезжает — снимаем в обе до него, как бывает на деле.
    const start = plan([point('cp-a', [3, 4]), point('cp-auto', [7, 4], { origin: 'auto' })]);
    const both = refreshCapturePoints(addPanoramaAtPoint(addPanoramaAtPoint(start, shot('cp-a', [3, 4], 'asset-1')).doc, shot('cp-auto', [7, 4], 'asset-2')).doc);
    expect(pointOf(both, 'cp-auto').panorama).not.toBeNull();

    const manualGone = removeCapturePoint(both, 'cp-a');
    expect(manualGone.panoramas.map((p) => p.pano)).toEqual(['asset-2']);
    expect(manualGone.capturePoints!.some((p) => p.id === 'cp-a')).toBe(false);

    const autoGone = removeCapturePoint(manualGone, 'cp-auto');
    expect(autoGone.panoramas).toEqual([]);
    // Рассчитанная остаётся «убранной»: расчёт не поставит её снова.
    expect(pointOf(autoGone, 'cp-auto')).toMatchObject({ origin: 'removed', panorama: null });
    expect(validateReferences(autoGone)).toEqual([]);
  });

  it('панорама без точки (старые данные) получает точку; ссылка в пустоту сбрасывается', () => {
    const orphan: PanoramaPlacement = {
      id: 'pa-1', pano: 'asset-1', level: L, pos: [5, 2], node: null, heading: null, cameraHeight: 1.5, markers: [], customMarkers: [], links: [],
    };
    const doc = refreshCapturePoints(plan([point('cp-a', [3, 4], { panorama: 'pa-9' })], [], [orphan]));
    expect(pointOf(doc, 'cp-a').panorama).toBeNull();
    expect(doc.capturePoints!.find((p) => p.panorama === 'pa-1')).toMatchObject({ pos: [5, 2], origin: 'manual' });
    // Повторный пересчёт ничего не меняет.
    expect(refreshCapturePoints(doc)).toBe(doc);
  });
});

describe('панорама из карточки места', () => {
  it('снять для места ещё раз — в его же точке, с заменой', () => {
    let doc = refreshCapturePoints(plan([], [place('шкаф', [13, 6], { panorama: null })]));
    const first = capturePointForPlace(doc, 'шкаф')!;
    let r = upload(first.doc, shot(first.pointId, pointOf(first.doc, first.pointId).pos, 'asset-1'));
    doc = setPlacePanorama(r.doc, 'шкаф', r.id);

    const again = capturePointForPlace(doc, 'шкаф')!;
    expect(again.pointId).toBe(first.pointId);
    r = upload(again.doc, shot(again.pointId, pointOf(again.doc, again.pointId).pos, 'asset-2'));
    expect(r.doc.panoramas.map((p) => p.pano)).toEqual(['asset-2']);
    expect(r.doc.places[0]!.panorama).toBe(r.id);
    expect(panoramaForPlace(r.doc, r.doc.places[0]!)).toMatchObject({ panorama: { pano: 'asset-2' }, reason: 'own' });
  });
});
