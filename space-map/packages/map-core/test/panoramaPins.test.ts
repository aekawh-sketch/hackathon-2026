import { describe, expect, it } from 'vitest';
import {
  azimuth,
  deletePlace,
  demoVenue,
  headingFromCorrespondence,
  normalize180,
  pinPanoramaPoint,
  refreshCapturePoints,
  refreshPanoramaMarkers,
  removePanoramaPin,
  setPanoramaHeading,
  validateReferences,
  visibleLandmarks,
  type Landmark,
  type MapDocument,
  type PanoramaPin,
} from '../src/index.ts';

/** Панорама демо, из которой видно и двери, и места. */
function setup() {
  const doc = demoVenue();
  for (const pano of doc.panoramas) {
    const marks = visibleLandmarks(doc, pano.level, pano.pos);
    const door = marks.find((l) => l.kind === 'door');
    const place = marks.find((l) => l.kind === 'place');
    if (door && place) return { doc, pano, door, place, marks };
  }
  throw new Error('в демо нет панорамы с дверью и местом в поле зрения');
}

const pinOf = (l: Landmark, yaw: number, pitch = 0): PanoramaPin => ({ yaw, pitch, kind: l.kind, pos: l.pos, name: l.name, ...(l.place ? { place: l.place } : {}) });
const panoOf = (doc: MapDocument, id: string) => doc.panoramas.find((p) => p.id === id)!;
/** Так делает редактор после каждой правки. */
const afterEdit = (doc: MapDocument) => refreshPanoramaMarkers(refreshCapturePoints(doc));

describe('«Установить точку» в панораме', () => {
  it('точка сохраняется, направление — по ней; правка плана её не стирает', () => {
    const { doc, pano, door } = setup();
    const next = afterEdit(pinPanoramaPoint(doc, pano.id, pinOf(door, 40, -5)));
    const p = panoOf(next, pano.id);
    expect(p.pins).toEqual([pinOf(door, 40, -5)]);
    expect(p.heading).toBeCloseTo(headingFromCorrespondence(pano.pos, door.pos, 40), 0);
    expect(validateReferences(next)).toEqual([]);
  });

  it('место с точкой стоит ровно там, куда нажали, — и после правки плана, и после сдвига на градусы', () => {
    const { doc, pano, place } = setup();
    let next = afterEdit(pinPanoramaPoint(doc, pano.id, pinOf(place, -70, 4)));
    const marker = () => panoOf(next, pano.id).markers.filter((m) => m.place === place.place);
    expect(marker()).toEqual([{ place: place.place, yaw: -70, pitch: 4, status: 'accepted' }]);
    next = afterEdit(setPanoramaHeading(next, pano.id, (panoOf(next, pano.id).heading ?? 0) + 5));
    expect(marker()).toEqual([{ place: place.place, yaw: -70, pitch: 4, status: 'accepted' }]);
  });

  it('несколько точек: направление по всем, и через 0°/360° среднее не ломается', () => {
    const { doc, pano, marks } = setup();
    const heading = 355;
    // Точки, нажатые без ошибки при направлении 355°.
    let next = doc;
    for (const l of marks.slice(0, 3)) next = pinPanoramaPoint(next, pano.id, pinOf(l, normalize180(azimuth(pano.pos, l.pos) - heading)));
    const h = panoOf(next, pano.id).heading!;
    expect(Math.abs(normalize180(h - heading))).toBeLessThan(0.2);
  });

  it('та же дверь ещё раз — точка переставляется, а не добавляется', () => {
    const { doc, pano, door } = setup();
    const next = pinPanoramaPoint(pinPanoramaPoint(doc, pano.id, pinOf(door, 40)), pano.id, pinOf(door, 52));
    expect(panoOf(next, pano.id).pins).toEqual([pinOf(door, 52)]);
  });

  it('убрать точку: направление по оставшимся, а без точек — как было', () => {
    const { doc, pano, door, place } = setup();
    const two = pinPanoramaPoint(pinPanoramaPoint(doc, pano.id, pinOf(door, 40)), pano.id, pinOf(place, -70));
    const one = removePanoramaPin(two, pano.id, 0);
    expect(panoOf(one, pano.id).pins).toEqual([pinOf(place, -70)]);
    expect(panoOf(one, pano.id).heading).toBeCloseTo(headingFromCorrespondence(pano.pos, place.pos, -70), 0);
    const none = removePanoramaPin(one, pano.id, 0);
    expect(panoOf(none, pano.id).pins).toEqual([]);
    expect(panoOf(none, pano.id).heading).toBe(panoOf(one, pano.id).heading);
  });

  it('место удалили — его метка не возвращается, ссылки в документе целы', () => {
    const { doc, pano, place } = setup();
    const pinned = pinPanoramaPoint(doc, pano.id, pinOf(place, -70));
    const gone = afterEdit(deletePlace(pinned, place.place!));
    expect(panoOf(gone, pano.id).markers.some((m) => m.place === place.place)).toBe(false);
    expect(validateReferences(gone)).toEqual([]);
  });
});
