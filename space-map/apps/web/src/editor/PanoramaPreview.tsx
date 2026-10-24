// Просмотр панорамы в редакторе: проверить снятую фотосферу — как она повёрнута, где встали метки мест
// и стрелки переходов. Переход по стрелке открывает соседнюю панораму здесь же.
// «Установить точку» (ТЗ 5.6): нажать в панораме на дверь или место и выбрать его из списка. Точка остаётся в панораме
// (оранжевая метка, сохраняется в карте), направление панорамы считается по всем точкам, метки и переходы встают по плану,
// а место с точкой — ровно туда, куда нажали. Нужно для загруженных панорам: их направление неизвестно.
// «Стрелки»: стрелка по плану смотрит прямо на точку соседней панорамы и может увести не туда (точка стоит
// неточно, идти надо через дверь сбоку). Здесь её ставят вручную — нажатием на проход, — добавляют переход,
// которого нет в подсказках, убирают лишний и подстраивают направление всей панорамы на градусы.
import {
  addLink,
  distance,
  normalize180,
  panoramaPointName,
  pinPanoramaPoint,
  removeLink,
  removePanoramaPin,
  resetLinkYaw,
  setLinkYaw,
  setPanoramaHeading,
  unitAt,
  visibleLandmarks,
  type Landmark,
  type MapDocument,
  type PanoramaPlacement,
} from '@space-map/map-core';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
/** Точки, поставленные вручную, — оранжевые: видно, что их ставил организатор, а не расчёт. */
const PIN_COLOR = '#FF7A1A';

export function PanoramaPreview({ doc, panoId, initialYaw = 0, onCommit, onClose }: { doc: MapDocument; panoId: string; initialYaw?: number; onCommit: (doc: MapDocument) => void; onClose: () => void }) {
  const [current, setCurrent] = useState({ id: panoId, yaw: initialYaw });
  const [orient, setOrient] = useState<Orient>(null);
  const [arrows, setArrows] = useState<Arrows>(null);
  /** Нажали на точку, поставленную вручную, — её номер в pins: можно убрать. */
  const [pinMenu, setPinMenu] = useState<number | null>(null);
  /** Список поставленных точек — убрать ошибочную, не разыскивая её в панораме. */
  const [pinsOpen, setPinsOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pano = doc.panoramas.find((p) => p.id === current.id);
  const pins = pano?.pins ?? [];

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);
  // Название точки съёмки (если организатор его дал) понятнее помещения: в одной комнате бывает несколько панорам.
  const room = pano ? (panoramaPointName(doc, pano.id) ?? unitAt(doc, pano.level, pano.pos)?.name) : undefined;
  const landmarks = useMemo(() => (pano ? visibleLandmarks(doc, pano.level, pano.pos).slice(0, 8) : []), [doc, pano]);
  /** Как назвать соседнюю панораму: помещение и расстояние — в одной комнате их бывает несколько. */
  const panoName = (target: PanoramaPlacement) => {
    const name = panoramaPointName(doc, target.id) ?? unitAt(doc, target.level, target.pos)?.name ?? 'Панорама';
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
    if (orient) return orient.step === 'pick' ? [{ id: 'tap', kind: 'place', yaw: orient.yaw, pitch: orient.pitch, label: 'Сюда нажали', icon: 'door', color: PIN_COLOR }] : [];
    // Ставим стрелку — видна только она, крупно: понятно, откуда её переносим.
    if (arrows?.step === 'aim') {
      const l = pano.links.find((x) => x.to === arrows.to);
      return l && !arrows.isNew ? [{ id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label: 'Сейчас стрелка здесь', route: 'next' }] : [];
    }
    const places = new Map(doc.places.map((p) => [p.id, p]));
    const categories = new Map(doc.categories.map((c) => [c.id, c]));
    // Место с точкой рисуем один раз — точкой.
    const pinnedPlaces = new Set(pins.map((p) => p.place));
    return [
      ...pins.map((pin, i) => {
        const place = pin.place ? places.get(pin.place) : undefined;
        const icon = pin.kind === 'door' ? 'door' : categories.get(place?.category ?? '')?.icon;
        return { id: `pin:${i}`, kind: 'place' as const, yaw: pin.yaw, pitch: pin.pitch, label: place?.name ?? pin.name, icon, color: PIN_COLOR };
      }),
      ...pano.markers
        .filter((m) => m.status === 'accepted' && places.has(m.place) && !pinnedPlaces.has(m.place))
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
          const name = panoramaPointName(doc, target.id) ?? unitAt(doc, target.level, target.pos)?.name;
          return { id: `link:${l.to}`, kind: 'link' as const, yaw: l.yaw, pitch: -22, label: name ? `Перейти: ${name}` : 'Перейти сюда' };
        }),
    ];
  }, [doc, pano, pins, orient, arrows]);

  const onMarker = (m: PanoMarker) => {
    if (arrows?.step === 'list' && m.kind === 'link') return setArrows({ step: 'aim', to: m.id.slice('link:'.length), isNew: false });
    if (!orient && !arrows && m.id.startsWith('pin:')) return setPinMenu(Number(m.id.slice('pin:'.length)));
    if (orient || arrows || m.kind !== 'link' || !pano) return;
    const target = doc.panoramas.find((p) => p.id === m.id.slice('link:'.length));
    if (!target) return;
    // Смотрим туда же, куда смотрели, — как у посетителя.
    const yaw = target.heading === null || pano.heading === null ? 0 : normalize180(pano.heading + m.yaw - target.heading);
    setOrient(null);
    setPinMenu(null);
    setCurrent({ id: target.id, yaw });
  };

  const onPanoClick = (yaw: number, pitch: number) => {
    if (orient) return setOrient({ step: 'pick', yaw, pitch });
    if (arrows?.step !== 'aim' || !pano) return;
    onCommit(arrows.isNew ? addLink(doc, pano.id, arrows.to, yaw) : setLinkYaw(doc, pano.id, arrows.to, yaw));
    setArrows({ step: 'list' });
  };

  // Вид не трогаем: точка остаётся там, куда смотрели, и сразу видна на месте.
  const pick = (l: Landmark) => {
    if (!pano || orient?.step !== 'pick') return;
    const next = pinPanoramaPoint(doc, pano.id, { yaw: orient.yaw, pitch: orient.pitch, kind: l.kind, pos: l.pos, name: l.name, ...(l.place ? { place: l.place } : {}) });
    onCommit(next);
    const count = next.panoramas.find((p) => p.id === pano.id)?.pins?.length ?? 1;
    setNote(count > 1 ? `Точка сохранена. Направление — по ${count} точкам` : 'Точка сохранена, панорама повёрнута по ней');
    setOrient(null);
  };

  const unpin = (index: number) => {
    if (!pano) return;
    onCommit(removePanoramaPin(doc, pano.id, index));
    setPinMenu(null);
    if (pins.length <= 1) setPinsOpen(false);
    setNote('Точка убрана');
  };
  // Поставленные точки списком, у каждой — «Убрать»: ошибочный выбор исправляется сразу.
  const pinList = pins.length > 0 && (
    <ul className="pin-list">
      {pins.map((pin, i) => (
        <li key={`${pin.yaw}:${pin.pitch}`}>
          <Icon name={pin.kind === 'door' ? 'door' : 'pin'} size={17} />
          <span>{(pin.place ? doc.places.find((p) => p.id === pin.place)?.name : undefined) ?? pin.name}</span>
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => unpin(i)}>
            <Icon name="trash" size={16} /> Убрать
          </button>
        </li>
      ))}
    </ul>
  );
  const menuPin = pinMenu !== null ? pins[pinMenu] : undefined;

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
            <button type="button" className="glass-btn" onClick={() => { setPinMenu(null); setPinsOpen(false); setOrient({ step: 'tap' }); }}>
              <Icon name="pin" size={18} />Установить точку
            </button>
            {pins.length > 0 && (
              <button type="button" className="glass-btn" aria-expanded={pinsOpen} onClick={() => { setPinMenu(null); setPinsOpen((o) => !o); }}>
                <Icon name="check" size={18} />Точки · {pins.length}
              </button>
            )}
            <button type="button" className="glass-btn" onClick={() => { setPinMenu(null); setArrows({ step: 'list' }); }}>
              <Icon name="route" size={18} />Стрелки
            </button>
          </>
        )}
      </div>
      {!orient && pano.heading === null && (
        <div className="pano-card">
          <p>Направление панорамы не задано — поэтому в ней нет меток мест и переходов. Установите точку: нажмите на дверь или место, которое есть на плане.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setOrient({ step: 'tap' })}>
            <Icon name="pin" size={18} /> Установить точку
          </button>
        </div>
      )}
      {orient?.step === 'tap' && (
        <div className="pano-card">
          <p>
            <b>Нажмите в панораме на середину двери</b> или на место, которое есть на плане (стойка, стенд). Чем больше точек, тем точнее
            повернётся панорама.
          </p>
          {pinList}
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
      {pinsOpen && !orient && !arrows && !menuPin && (
        <div className="pano-card">
          <p>
            <b>Поставленные точки.</b> По ним считается направление панорамы — ошибочную уберите.
          </p>
          {pinList}
          <button type="button" className="btn btn-primary btn-block" onClick={() => setPinsOpen(false)}>
            Готово
          </button>
        </div>
      )}
      {menuPin && !orient && !arrows && (
        <div className="pano-card">
          <p>
            <b>Точка: {menuPin.name}</b>
            <br />
            Поставлена вручную. По точкам считается направление панорамы{menuPin.place ? ', а место стоит ровно здесь' : ''}.
          </p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={() => unpin(pinMenu!)}>
              <Icon name="trash" size={17} /> Убрать точку
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPinMenu(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
      {note && (
        <div className="pano-note" role="status">
          <Icon name="check" size={16} /> {note}
        </div>
      )}
      {orient?.step === 'pick' && (
        <div className="pano-card">
          <p>
            <b>Что здесь?</b> Выберите ту же дверь или место на плане — точка сохранится в панораме.
          </p>
          {landmarks.length === 0 ? (
            <p className="hint">Из этой точки на плане не видно ни дверей, ни мест — проверьте, где стоит панорама.</p>
          ) : (
            <div className="orient-list">
              {landmarks.map((l) => (
                <button key={`${l.kind}:${l.pos.join(',')}`} type="button" className="btn btn-secondary" onClick={() => pick(l)}>
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
