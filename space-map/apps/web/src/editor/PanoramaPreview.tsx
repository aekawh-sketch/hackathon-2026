// Просмотр панорамы в редакторе: проверить снятую фотосферу — как она повёрнута, где встали метки мест
// и стрелки переходов. Переход по стрелке открывает соседнюю панораму здесь же.
import { normalize180, unitAt, type MapDocument } from '@space-map/map-core';
import { lazy, Suspense, useMemo, useState } from 'react';
import { panoramaUrls } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon } from '../ui/icons.tsx';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));

export function PanoramaPreview({ doc, panoId, onClose }: { doc: MapDocument; panoId: string; onClose: () => void }) {
  const [current, setCurrent] = useState({ id: panoId, yaw: 0 });
  const pano = doc.panoramas.find((p) => p.id === current.id);
  const room = pano ? unitAt(doc, pano.level, pano.pos)?.name : undefined;

  const markers = useMemo<PanoMarker[]>(() => {
    if (!pano) return [];
    const places = new Map(doc.places.map((p) => [p.id, p]));
    const categories = new Map(doc.categories.map((c) => [c.id, c]));
    return [
      ...pano.markers
        .filter((m) => m.status === 'accepted' && places.has(m.place))
        .map((m) => {
          const place = places.get(m.place)!;
          const cat = categories.get(place.category);
          return { id: `place:${place.id}`, kind: 'place' as const, yaw: m.yaw, pitch: m.pitch, label: place.name, icon: cat?.icon, color: cat?.color };
        }),
      ...pano.links
        .filter((l) => doc.panoramas.some((p) => p.id === l.to))
        .map((l) => {
          const target = doc.panoramas.find((p) => p.id === l.to)!;
          const name = unitAt(doc, target.level, target.pos)?.name;
          return { id: `link:${l.to}`, kind: 'link' as const, yaw: l.yaw, pitch: -22, label: name ? `Перейти: ${name}` : 'Перейти сюда' };
        }),
    ];
  }, [doc, pano]);

  const onMarker = (m: PanoMarker) => {
    if (m.kind !== 'link' || !pano) return;
    const target = doc.panoramas.find((p) => p.id === m.id.slice('link:'.length));
    if (!target) return;
    // Смотрим туда же, куда смотрели, — как у посетителя.
    const yaw = target.heading === null || pano.heading === null ? 0 : normalize180(pano.heading + m.yaw - target.heading);
    setCurrent({ id: target.id, yaw });
  };

  if (!pano) return null;
  return (
    <div className="pano-overlay" role="dialog" aria-label="Панорама">
      <ErrorBoundary fallback={<div className="screen-message dark">Не удалось загрузить панораму.</div>}>
        <Suspense fallback={<div className="screen-message dark"><div className="loader" /></div>}>
          <PanoramaViewer
            imageUrl={panoramaUrls(pano).image}
            previewUrl={panoramaUrls(pano).preview}
            initialYaw={current.yaw}
            markers={markers}
            onMarkerClick={onMarker}
          />
        </Suspense>
      </ErrorBoundary>
      <div className="pano-top">
        <button type="button" className="glass-btn" onClick={onClose}>
          <Icon name="back" size={18} />К плану
        </button>
        {room && <span className="glass-title">{room}</span>}
      </div>
      {pano.heading === null && (
        <div className="pano-card">
          <p>Направление этой панорамы не задано — метки мест и переходы в ней не показываются.</p>
        </div>
      )}
    </div>
  );
}
