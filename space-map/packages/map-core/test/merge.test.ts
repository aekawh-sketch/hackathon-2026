import { describe, expect, it } from 'vitest';
import {
  addPanoramaAtPoint,
  capturePointForPlace,
  deletePanorama,
  deletePlace,
  demoVenue,
  mergeDocuments,
  refreshCapturePoints,
  refreshPanoramaMarkers,
  updatePlace,
  validateReferences,
  type MapDocument,
} from '../src/index.ts';

// База — как в редакторе после загрузки: точки съёмки и метки уже посчитаны.
const base = refreshPanoramaMarkers(refreshCapturePoints(demoVenue()));
// Места, у которых можно поставить точку съёмки (внутри помещения для посетителей).
const shootable = base.places.filter((p) => capturePointForPlace(base, p.id) !== null);
const [A, B] = [shootable[0]!, shootable[shootable.length - 1]!];

/** Снять фотосферу у места — как кнопка «Снять фотосферу» в карточке места. */
function shoot(doc: MapDocument, placeId: string, asset: string): MapDocument {
  const r = capturePointForPlace(doc, placeId)!;
  const point = r.doc.capturePoints!.find((p) => p.id === r.pointId)!;
  return addPanoramaAtPoint(r.doc, { pointId: point.id, pano: asset, level: point.level, pos: point.pos, heading: 0, cameraHeight: 1.5 }).doc;
}

/** Какие снимки (ID на сервере) висят на точках съёмки. */
const shotAssets = (doc: MapDocument) =>
  new Set((doc.capturePoints ?? []).filter((c) => c.panorama).map((c) => doc.panoramas.find((p) => p.id === c.panorama)?.pano));

describe('слияние правок двух редакторов', () => {
  it('места для съёмки в демо есть', () => {
    expect(A.id).not.toBe(B.id);
  });

  it('правок нет у одной стороны — берётся другая', () => {
    const theirs = updatePlace(base, A.id, { name: 'Переименовали' });
    expect(mergeDocuments(base, base, theirs)).toBe(theirs);
    expect(mergeDocuments(base, theirs, base)).toBe(theirs);
  });

  it('телефон снял панораму, на сайте переименовали место — есть и то и другое', () => {
    const mine = shoot(base, A.id, 'asset-phone');
    const theirs = updatePlace(base, B.id, { name: 'Регистрация (новая)' });
    const merged = mergeDocuments(base, mine, theirs)!;
    expect(merged).not.toBeNull();
    expect(validateReferences(merged)).toEqual([]);
    expect(merged.places.find((p) => p.id === B.id)?.name).toBe('Регистрация (новая)');
    expect(merged.panoramas.some((p) => p.pano === 'asset-phone')).toBe(true);
    expect(shotAssets(merged).has('asset-phone')).toBe(true);
  });

  it('два телефона сняли по панораме одновременно — обе на месте, ID разные', () => {
    const mine = shoot(base, A.id, 'asset-1');
    const theirs = shoot(base, B.id, 'asset-2');
    // Номера идут подряд — обе стороны дали новой панораме один ID.
    const newIds = (d: MapDocument) => d.panoramas.filter((p) => !base.panoramas.some((b) => b.id === p.id)).map((p) => p.id);
    expect(newIds(mine)).toEqual(newIds(theirs));
    const merged = mergeDocuments(base, mine, theirs)!;
    expect(validateReferences(merged)).toEqual([]);
    expect(merged.panoramas).toHaveLength(base.panoramas.length + 2);
    expect(new Set(merged.panoramas.map((p) => p.id)).size).toBe(merged.panoramas.length);
    expect(shotAssets(merged)).toEqual(new Set([...shotAssets(base), 'asset-1', 'asset-2']));
  });

  it('разные поля одного места сливаются, одно поле правили оба — побеждает моё', () => {
    const mine = updatePlace(updatePlace(base, A.id, { hours: '09:00–21:00' }), B.id, { name: 'Моё имя' });
    const theirs = updatePlace(updatePlace(base, A.id, { description: 'Их описание' }), B.id, { name: 'Их имя' });
    const merged = mergeDocuments(base, mine, theirs)!;
    const a = merged.places.find((p) => p.id === A.id)!;
    expect([a.hours, a.description]).toEqual(['09:00–21:00', 'Их описание']);
    expect(merged.places.find((p) => p.id === B.id)?.name).toBe('Моё имя');
  });

  it('место удалили на сайте, а на телефоне правили — удалено, меток на него нет', () => {
    const mine = updatePlace(base, A.id, { description: 'правка' });
    const theirs = deletePlace(base, A.id);
    const merged = mergeDocuments(base, mine, theirs)!;
    expect(validateReferences(merged)).toEqual([]);
    expect(merged.places.some((p) => p.id === A.id)).toBe(false);
    expect(merged.panoramas.some((pa) => pa.markers.some((m) => m.place === A.id))).toBe(false);
  });

  it('панораму удалили на сайте, а новая с телефона вела в неё — переходов в пустоту нет', () => {
    const gone = base.panoramas[0]!;
    const mine = shoot(base, A.id, 'asset-phone');
    const theirs = deletePanorama(base, gone.id);
    const merged = mergeDocuments(base, mine, theirs)!;
    expect(validateReferences(merged)).toEqual([]);
    expect(merged.panoramas.some((p) => p.id === gone.id)).toBe(false);
    expect(merged.panoramas.some((p) => p.pano === 'asset-phone')).toBe(true);
  });

  it('точку убрали на сайте, а телефон в ней снял — точка со снимком остаётся', () => {
    const r = capturePointForPlace(base, A.id)!;
    const withPoint = r.doc;
    const point = withPoint.capturePoints!.find((p) => p.id === r.pointId)!;
    const mine = addPanoramaAtPoint(withPoint, { pointId: point.id, pano: 'asset-phone', level: point.level, pos: point.pos, heading: 0, cameraHeight: 1.5 }).doc;
    const theirs = { ...withPoint, capturePoints: withPoint.capturePoints!.filter((p) => p.id !== point.id) };
    const merged = mergeDocuments(withPoint, mine, theirs)!;
    const kept = merged.capturePoints!.find((p) => p.id === point.id);
    expect(kept?.panorama).not.toBeNull();
    expect(merged.panoramas.find((p) => p.id === kept!.panorama)?.pano).toBe('asset-phone');
  });
});
