// Просмотр панорамы в редакторе: проверить снятую фотосферу — как она повёрнута, где встали метки мест
// и стрелки переходов. Переход по стрелке открывает соседнюю панораму здесь же.
// «Повернуть по двери» (ТЗ 5.6): нажать в панораме на дверь или место и выбрать его из списка — направление
// панорамы посчитается само, метки и переходы встанут по плану. Нужно для загруженных панорам: их направление неизвестно.
// «Стрелки»: стрелка по плану смотрит прямо на точку соседней панорамы и может увести не туда (точка стоит
// неточно, идти надо через дверь сбоку). Здесь её ставят вручную — нажатием на проход, — добавляют переход,
// которого нет в подсказках, убирают лишний и подстраивают направление всей панорамы на градусы.
import {
  addLink,
  distance,
  normalize180,
  orientPanorama,
  removeLink,
  resetLinkYaw,
  setLinkYaw,
  setPanoramaHeading,
  unitAt,
  visibleLandmarks,
  type MapDocument,
  type PanoramaPlacement,
} from '@space-map/map-core';
import { lazy, Suspense, useMemo, useState } from 'react';
import { panoramaUrls } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon } from '../ui/icons.tsx';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));

type Orient = null | { step: 'tap' } | { step: 'pick'; yaw: number; pitch: number };
/** list — стрелки видны, выбираем; aim — нажать, куда ведёт переход [to]; add — выбрать панораму для нового. */
type Arrows = null | { step: 'list' } | { step: 'aim'; to: string; isNew: boolean } | { step: 'add' };

/** Сдвиг всех меток и стрелок по плану, градусы: ◀ — влево (направление панорамы растёт). */
const NUDGES = [5, 1, -1, -5];

export function PanoramaPreview({ doc, panoId, initialYaw = 0, onCommit, onClose }: { doc: MapDocument; panoId: string; initialYaw?: number; onCommit: (doc: MapDocument) => void; onClose: () => void }) {
  const [current, setCurrent] = useState({ id: panoId, yaw: initialYaw });
  const [orient, setOrient] = useState<Orient>(null);
  const [arrows, setArrows] = useState<Arrows>(null);
  const pano = doc.panoramas.find((p) => p.id === current.id);
  const room = pano ? unitAt(doc, pano.level, pano.pos)?.name : undefined;
  const landmarks = useMemo(() => (pano ? visibleLandmarks(doc, pano.level, pano.pos).slice(0, 8) : []), [doc, pano]);
  /** Как назвать соседнюю панораму: помещение и расстояние — в одной комнате их бывает несколько. */
  const panoName = (target: PanoramaPlacement) => {
    const name = unitAt(doc, target.level, target.pos)?.name ?? 'Панорама';
    return pano ? `${name} · ${Math.round(distance(pano.pos, target.pos))} м` : name;
  };
  // Панорамы этажа, куда из этой ещё нет перехода, — ближние первыми.
  const candidates = useMemo(
    () =>
      pano
        ? doc.panoramas
            .filter((p) => p.id !== pano.id && p.level === pano.level && !pano.links.some((l) => l.to === p.id))
            .sort((a, b) => distance(pano.pos, a.pos) - distance(pano.pos, b.pos))
            .slice(0, 10)
        : [],
    [doc, pano],
  );
  const aimed = arrows?.step === 'aim' ? doc.panoramas.find((p) => p.id === arrows.to) : undefined;
  const aimedLink = arrows?.step === 'aim' && !arrows.isNew ? pano?.links.find((l) => l.to === arrows.to) : undefined;

  const markers = useMemo<PanoMarker[]>(() => {
    if (!pano) return [];
    // Пока выбираем дверь — метки не мешают; отмечаем, куда нажали.
    if (orient) return orient.step === 'pick' ? [{ id: 'tap', kind: 'place', yaw: orient.yaw, pitch: orient.pitch, label: 'Сюда нажали', icon: 'door', color: '#FF7A1A' }] : [];
    // Ставим стрелку — видна только она, крупно: понятно, откуда её переносим.
    if (arrows?.step === 'aim') {
      const l = pano.links.find((x) => x.to === arrows.to);
      return l && !arrows.isNew ? [{ id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label: 'Сейчас стрелка здесь', route: 'next' }] : [];
    }
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
          if (arrows) return { id: `link:${l.to}`, kind: 'link' as const, yaw: l.yaw, pitch: -22, label: `Стрелка: ${panoName(target)}${l.manual ? ' · поставлена вручную' : ''}` };
          const name = unitAt(doc, target.level, target.pos)?.name;
          return { id: `link:${l.to}`, kind: 'link' as const, yaw: l.yaw, pitch: -22, label: name ? `Перейти: ${name}` : 'Перейти сюда' };
        }),
    ];
  }, [doc, pano, orient, arrows]);

  const onMarker = (m: PanoMarker) => {
    if (arrows?.step === 'list' && m.kind === 'link') return setArrows({ step: 'aim', to: m.id.slice('link:'.length), isNew: false });
    if (orient || arrows || m.kind !== 'link' || !pano) return;
    const target = doc.panoramas.find((p) => p.id === m.id.slice('link:'.length));
    if (!target) return;
    // Смотрим туда же, куда смотрели, — как у посетителя.
    const yaw = target.heading === null || pano.heading === null ? 0 : normalize180(pano.heading + m.yaw - target.heading);
    setOrient(null);
    setCurrent({ id: target.id, yaw });
  };

  const onPanoClick = (yaw: number, pitch: number) => {
    if (orient) return setOrient({ step: 'pick', yaw, pitch });
    if (arrows?.step !== 'aim' || !pano) return;
    onCommit(arrows.isNew ? addLink(doc, pano.id, arrows.to, yaw) : setLinkYaw(doc, pano.id, arrows.to, yaw));
    setArrows({ step: 'list' });
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
            onPanoClick={onPanoClick}
          />
        </Suspense>
      </ErrorBoundary>
      <div className="pano-top">
        <button type="button" className="glass-btn" onClick={onClose}>
          <Icon name="back" size={18} />К плану
        </button>
        {room && <span className="glass-title">{room}</span>}
        {!orient && !arrows && pano.heading !== null && (
          <>
            <button type="button" className="glass-btn" onClick={() => setOrient({ step: 'tap' })}>
              <Icon name="rotate" size={18} />Повернуть
            </button>
            <button type="button" className="glass-btn" onClick={() => setArrows({ step: 'list' })}>
              <Icon name="route" size={18} />Стрелки
            </button>
          </>
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
      {arrows?.step === 'list' && (
        <div className="pano-card">
          <p>
            <b>Стрелка ведёт не туда?</b> Нажмите на неё, а потом в панораме — на проход, куда она должна вести.
          </p>
          <div className="nudge">
            <span>Всё по плану съехало на угол — сдвиньте метки и стрелки:</span>
            <div className="nudge-row">
              {NUDGES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn btn-secondary"
                  aria-label={`${d > 0 ? 'Влево' : 'Вправо'} на ${Math.abs(d)}°`}
                  onClick={() => onCommit(setPanoramaHeading(doc, pano.id, (pano.heading ?? 0) + d))}
                >
                  {d > 0 ? `◀ ${d}°` : `${-d}° ▶`}
                </button>
              ))}
            </div>
            <small>Стрелки, поставленные вручную, держатся за снимок и не сдвигаются.</small>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setArrows({ step: 'add' })}>
              <Icon name="plus" size={17} /> Добавить переход
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setArrows(null)}>
              <Icon name="check" size={17} /> Готово
            </button>
          </div>
        </div>
      )}
      {arrows?.step === 'aim' && aimed && (
        <div className="pano-card">
          <p>
            <b>Куда идти: {panoName(aimed)}?</b> Нажмите в панораме на проход или дверь, через которые туда ведёт путь.
          </p>
          <div className="row">
            {aimedLink?.manual && (
              <button type="button" className="btn btn-ghost" onClick={() => { onCommit(resetLinkYaw(doc, pano.id, aimed.id)); setArrows({ step: 'list' }); }}>
                <Icon name="reset" size={17} /> По плану
              </button>
            )}
            {aimedLink && (
              <button type="button" className="btn btn-danger" onClick={() => { onCommit(removeLink(doc, pano.id, aimed.id)); setArrows({ step: 'list' }); }}>
                <Icon name="trash" size={17} /> Убрать переход
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setArrows({ step: 'list' })}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {arrows?.step === 'add' && (
        <div className="pano-card">
          <p>
            <b>Переход куда?</b> Потом нажмите в панораме, куда к ней идти.
          </p>
          {candidates.length === 0 ? (
            <p className="hint">Все панорамы этажа уже связаны с этой.</p>
          ) : (
            <div className="orient-list">
              {candidates.map((c) => (
                <button key={c.id} type="button" className="btn btn-secondary" onClick={() => setArrows({ step: 'aim', to: c.id, isNew: true })}>
                  <Icon name="pano" size={17} /> {panoName(c)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setArrows({ step: 'list' })}>
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
