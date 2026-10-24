// Просмотр панорамы в редакторе: проверить снятую фотосферу — как она повёрнута, где встали метки мест
// и стрелки переходов. Переход по стрелке открывает соседнюю панораму здесь же.
// «Повернуть по двери» (ТЗ 5.6): нажать в панораме на дверь или место и выбрать его из списка — направление
// панорамы посчитается само, метки и переходы встанут по плану. Нужно для загруженных панорам: их направление неизвестно.
import { normalize180, orientPanorama, unitAt, visibleLandmarks, type MapDocument } from '@space-map/map-core';
import { lazy, Suspense, useMemo, useState } from 'react';
import { panoramaUrls } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon } from '../ui/icons.tsx';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));

type Orient = null | { step: 'tap' } | { step: 'pick'; yaw: number; pitch: number };

export function PanoramaPreview({ doc, panoId, onCommit, onClose }: { doc: MapDocument; panoId: string; onCommit: (doc: MapDocument) => void; onClose: () => void }) {
  const [current, setCurrent] = useState({ id: panoId, yaw: 0 });
  const [orient, setOrient] = useState<Orient>(null);
  const pano = doc.panoramas.find((p) => p.id === current.id);
  const room = pano ? unitAt(doc, pano.level, pano.pos)?.name : undefined;
  const landmarks = useMemo(() => (pano ? visibleLandmarks(doc, pano.level, pano.pos).slice(0, 8) : []), [doc, pano]);

  const markers = useMemo<PanoMarker[]>(() => {
    if (!pano) return [];
    // Пока выбираем дверь — метки не мешают; отмечаем, куда нажали.
    if (orient) return orient.step === 'pick' ? [{ id: 'tap', kind: 'place', yaw: orient.yaw, pitch: orient.pitch, label: 'Сюда нажали', icon: 'door', color: '#FF7A1A' }] : [];
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
  }, [doc, pano, orient]);

  const onMarker = (m: PanoMarker) => {
    if (orient || m.kind !== 'link' || !pano) return;
    const target = doc.panoramas.find((p) => p.id === m.id.slice('link:'.length));
    if (!target) return;
    // Смотрим туда же, куда смотрели, — как у посетителя.
    const yaw = target.heading === null || pano.heading === null ? 0 : normalize180(pano.heading + m.yaw - target.heading);
    setOrient(null);
    setCurrent({ id: target.id, yaw });
  };

  const pick = (pos: [number, number]) => {
    if (!pano || orient?.step !== 'pick') return;
    onCommit(orientPanorama(doc, pano.id, pos, orient.yaw));
    setCurrent({ id: pano.id, yaw: orient.yaw });
    setOrient(null);
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
            onPanoClick={(yaw, pitch) => orient && setOrient({ step: 'pick', yaw, pitch })}
          />
        </Suspense>
      </ErrorBoundary>
      <div className="pano-top">
        <button type="button" className="glass-btn" onClick={onClose}>
          <Icon name="back" size={18} />К плану
        </button>
        {room && <span className="glass-title">{room}</span>}
        {!orient && pano.heading !== null && (
          <button type="button" className="glass-btn" onClick={() => setOrient({ step: 'tap' })}>
            <Icon name="rotate" size={18} />Повернуть
          </button>
        )}
      </div>
      {!orient && pano.heading === null && (
        <div className="pano-card">
          <p>Направление панорамы не задано — поэтому в ней нет меток мест и переходов. Задайте его по одной двери.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setOrient({ step: 'tap' })}>
            <Icon name="rotate" size={18} /> Повернуть по двери
          </button>
        </div>
      )}
      {orient?.step === 'tap' && (
        <div className="pano-card">
          <p>
            <b>Нажмите в панораме на середину двери</b> или на место, которое есть на плане (стойка, стенд).
          </p>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setOrient(null)}>
            Отмена
          </button>
        </div>
      )}
      {orient?.step === 'pick' && (
        <div className="pano-card">
          <p>
            <b>Что это?</b> Выберите ту же дверь или место на плане.
          </p>
          {landmarks.length === 0 ? (
            <p className="hint">Из этой точки на плане не видно ни дверей, ни мест — проверьте, где стоит панорама.</p>
          ) : (
            <div className="orient-list">
              {landmarks.map((l) => (
                <button key={`${l.kind}:${l.pos.join(',')}`} type="button" className="btn btn-secondary" onClick={() => pick(l.pos)}>
                  <Icon name={l.kind === 'door' ? 'door' : 'pin'} size={17} /> {l.name}
                  <small> · {Math.round(l.distance * 10) / 10} м</small>
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={() => setOrient({ step: 'tap' })}>
              Нажать заново
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOrient(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
