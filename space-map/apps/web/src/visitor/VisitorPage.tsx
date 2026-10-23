// Карта посетителя (ТЗ 5.9, 5.10, 5.12, 5.19 — слои «вручную» и «QR-якорь»).
import {
  azimuth,
  NavGraph,
  nearestVisibleNode,
  normalize180,
  routePolyline,
  searchPlaces,
  walkthrough,
  type MapDocument,
  type PanoramaPlacement,
  type Place,
  type Vec2,
} from '@space-map/map-core';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { loadPublishedMap, panoramaUrls, type LoadedMap } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { PlanCanvas } from '../plan/PlanCanvas.tsx';
import { categoryIcon } from '../plan/style.ts';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));
const Model3DView = lazy(() => import('../three/Model3DView.tsx'));

const WALK_SPEED = 1.2; // м/с, ТЗ 4.4

type Endpoint = { kind: 'place'; id: string } | { kind: 'point'; pos: Vec2; label: string };

interface PanoState {
  ids: string[];
  index: number;
  tour: boolean;
  yaw: number;
}

export function VisitorPage() {
  const { slug = 'demo' } = useParams();
  const [search] = useSearchParams();
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(null);
    setError(null);
    loadPublishedMap(slug)
      .then(setLoaded)
      .catch(() => setError('Карта не найдена или пока закрыта.'));
  }, [slug]);

  if (error) return <div className="screen-message">{error}</div>;
  if (!loaded) return <div className="screen-message">Загружаем карту…</div>;
  return <Visitor doc={loaded.doc} anchorCode={search.get('a')} offlineDemo={loaded.offlineDemo} />;
}

function Visitor({ doc, anchorCode, offlineDemo }: { doc: MapDocument; anchorCode: string | null; offlineDemo: boolean }) {
  const level = doc.levels[0]?.id ?? 'L1';
  const graph = useMemo(() => new NavGraph(doc), [doc]);
  const placesById = useMemo(() => new Map(doc.places.map((p) => [p.id, p])), [doc]);
  const categories = useMemo(() => new Map(doc.categories.map((c) => [c.id, c])), [doc]);
  const scaled = doc.venue.scaleClass === 'scaled';

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [pickingFrom, setPickingFrom] = useState(false);
  const [mode, setMode] = useState<'plan' | '3d'>('plan');
  const [pano, setPano] = useState<PanoState | null>(null);
  const [panoPlace, setPanoPlace] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);

  // QR-якорь «Вы здесь»: точка «откуда» уже стоит (ТЗ 5.19, слой 1).
  useEffect(() => {
    const anchor = anchorCode ? doc.anchors.find((a) => a.code === anchorCode) : undefined;
    if (anchor) setFrom({ kind: 'point', pos: anchor.pos, label: 'Вы здесь' });
  }, [doc, anchorCode]);

  const sheetRef = useRef<HTMLElement>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSheetHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const endpointNode = (e: Endpoint): string | null =>
    e.kind === 'place' ? (placesById.get(e.id)?.node ?? null) : (nearestVisibleNode(doc, level, e.pos)?.id ?? null);
  const endpointPos = (e: Endpoint): Vec2 | null => (e.kind === 'place' ? (placesById.get(e.id)?.pos ?? null) : e.pos);
  const endpointLabel = (e: Endpoint) => (e.kind === 'place' ? (placesById.get(e.id)?.name ?? '') : e.label);

  const route = useMemo(() => {
    if (!from || !to) return null;
    const a = endpointNode(from);
    const b = placesById.get(to)?.node ?? null;
    if (!a || !b) return { ok: false as const, reason: 'not_found' as const };
    return graph.route(a, b);
  }, [from, to, graph]);

  const routeLine = useMemo(() => {
    if (!route?.ok || !from || !to) return null;
    const start = endpointPos(from);
    const end = placesById.get(to)?.pos;
    const line = routePolyline(graph, route.nodes);
    return [...(start ? [start] : []), ...line, ...(end ? [end] : [])];
  }, [route]);

  const walk = useMemo(() => (route?.ok ? walkthrough(doc, graph, route.nodes) : null), [route]);

  const results = useMemo(() => {
    if (query.trim()) return searchPlaces(doc, query);
    return doc.places.filter((p) => !p.hidden && (!category || p.category === category));
  }, [doc, query, category]);

  const selectedPlace = selected ? placesById.get(selected) : undefined;

  // ── Панорамы ──
  const panoById = useMemo(() => new Map(doc.panoramas.map((p) => [p.id, p])), [doc]);
  const panoramaForPlace = (place: Place): PanoramaPlacement | undefined => {
    const withMarker = doc.panoramas
      .filter((pa) => pa.markers.some((m) => m.place === place.id && m.status === 'accepted'))
      .sort((a, b) => dist(a.pos, place.pos) - dist(b.pos, place.pos));
    return withMarker[0] ?? doc.panoramas.find((pa) => pa.node === place.node);
  };

  const openPanorama = (id: string, yaw?: number) => {
    setPanoPlace(null);
    setPano({ ids: [id], index: 0, tour: false, yaw: yaw ?? 0 });
  };

  const startTour = () => {
    if (!walk || walk.segments.length === 0) return;
    const ids = walk.segments.flat();
    setPanoPlace(null);
    setPano({ ids, index: 0, tour: true, yaw: yawTowards(ids[0]!, ids[1]) });
  };

  const yawTowards = (fromId: string, toId?: string): number => {
    const a = panoById.get(fromId);
    if (!a || a.heading === null) return 0;
    if (!toId) return 0;
    const link = a.links.find((l) => l.to === toId);
    if (link) return link.yaw;
    const b = panoById.get(toId);
    return b ? normalize180(azimuth(a.pos, b.pos) - a.heading) : 0;
  };

  const tourStep = (delta: number) => {
    if (!pano) return;
    const index = Math.max(0, Math.min(pano.ids.length - 1, pano.index + delta));
    setPano({ ...pano, index, yaw: yawTowards(pano.ids[index]!, pano.ids[index + 1]) });
  };

  const current = pano ? panoById.get(pano.ids[pano.index]!) : undefined;
  const panoMarkers: PanoMarker[] = useMemo(() => {
    if (!current) return [];
    const places: PanoMarker[] = current.markers
      .filter((m) => m.status === 'accepted' && placesById.get(m.place) && !placesById.get(m.place)!.hidden)
      .map((m) => {
        const p = placesById.get(m.place)!;
        return { id: `place:${p.id}`, kind: 'place', yaw: m.yaw, pitch: m.pitch, label: p.name, icon: categoryIcon(categories.get(p.category)?.icon ?? '') };
      });
    const links: PanoMarker[] = current.links
      .filter((l) => l.status === 'accepted' && panoById.has(l.to))
      .map((l) => ({ id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label: 'Перейти сюда' }));
    return [...places, ...links];
  }, [current]);

  const onPanoMarker = (m: PanoMarker) => {
    if (!current) return;
    if (m.kind === 'place') {
      setPanoPlace(m.id.slice('place:'.length));
      return;
    }
    const target = panoById.get(m.id.slice('link:'.length));
    if (!target) return;
    // После перехода смотрим туда же, куда смотрели до него (ТЗ 5.7).
    const worldDir = (current.heading ?? 0) + m.yaw;
    const yaw = target.heading === null ? 0 : normalize180(worldDir - target.heading);
    if (pano?.tour) {
      const index = pano.ids.indexOf(target.id);
      if (index >= 0) return setPano({ ...pano, index, yaw });
    }
    openPanorama(target.id, yaw);
  };

  // ── Действия ──
  const choosePlace = (id: string) => {
    setSelected(id);
    setQuery('');
  };
  const routeHere = (id: string) => {
    setTo(id);
    setSelected(null);
    if (!from) setPickingFrom(true);
  };
  const routeFromHere = (id: string) => {
    setFrom({ kind: 'place', id });
    setSelected(null);
    setPickingFrom(false);
  };
  const clearRoute = () => {
    setFrom(null);
    setTo(null);
    setPickingFrom(false);
  };

  const onPlanEmpty = (pos: Vec2) => {
    if (pickingFrom) {
      setFrom({ kind: 'point', pos, label: 'Точка на карте' });
      setPickingFrom(false);
    } else {
      setSelected(null);
    }
  };

  const onPlanPlace = (id: string) => {
    if (pickingFrom) return routeFromHere(id);
    choosePlace(id);
  };

  const routeVisible = !!(to || from);

  return (
    <div className="visitor">
      <header className="topbar">
        <h1 className="topbar-title">{doc.venue.name}</h1>
        <div className="segmented" role="group" aria-label="Вид карты">
          <button type="button" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>
            План
          </button>
          <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
            3D
          </button>
        </div>
      </header>

      <main className="visitor-map">
        {mode === 'plan' ? (
          <PlanCanvas
            doc={doc}
            level={level}
            route={routeLine}
            selectedPlace={selected ?? to}
            fromPoint={from ? endpointPos(from) : null}
            bottomInset={sheetHeight}
            fitKey={fitKey}
            onPlaceClick={onPlanPlace}
            onPanoramaClick={(id) => openPanorama(id)}
            onEmptyClick={onPlanEmpty}
          />
        ) : (
          <Suspense fallback={<div className="screen-message">Строим 3D…</div>}>
            <Model3DView doc={doc} level={level} route={routeLine} />
          </Suspense>
        )}
        {offlineDemo && <div className="badge">Демо-карта без сервера</div>}
      </main>

      <section className="sheet" ref={sheetRef} aria-label="Поиск и маршрут">
        <div className="sheet-handle" aria-hidden />
        {routeVisible ? (
          <div className="route-panel">
            <div className="route-ends">
              <button type="button" className={`route-end ${pickingFrom ? 'is-picking' : ''}`} onClick={() => setPickingFrom(true)}>
                <span className="dot dot-from" />
                {from ? endpointLabel(from) : pickingFrom ? 'Нажмите на карте, откуда идти' : 'Откуда?'}
              </button>
              <div className="route-end">
                <span className="dot dot-to" />
                {to ? placesById.get(to)?.name : 'Куда? Выберите место'}
              </div>
            </div>
            {route && !route.ok && (
              <p className="notice">{route.reason === 'same_point' ? 'Вы уже на месте.' : 'Маршрут не найден. Попробуйте выбрать другие точки.'}</p>
            )}
            {route?.ok && (
              <p className="route-summary">
                {scaled ? (
                  <>
                    {Math.round(route.length)} м · ~{Math.max(1, Math.round(route.length / WALK_SPEED / 60))} мин пешком
                  </>
                ) : (
                  'Маршрут построен (план без масштаба — расстояние не показываем)'
                )}
              </p>
            )}
            {walk && walk.segments.length > 0 && (
              <>
                <button type="button" className="btn btn-primary" onClick={startTour}>
                  Пройти в панорамах ({walk.segments.flat().length})
                </button>
                {!walk.complete && <p className="hint">Панорамы есть не на всём пути — участки без них показаны пропусками.</p>}
              </>
            )}
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setFitKey((k) => k + 1)}>
                Показать весь маршрут
              </button>
              <button type="button" className="btn btn-ghost" onClick={clearRoute}>
                Сбросить
              </button>
            </div>
          </div>
        ) : selectedPlace ? (
          <PlaceCard
            place={selectedPlace}
            categoryName={categories.get(selectedPlace.category)?.name ?? ''}
            icon={categoryIcon(categories.get(selectedPlace.category)?.icon ?? '')}
            hasPanorama={!!panoramaForPlace(selectedPlace)}
            onRouteHere={() => routeHere(selectedPlace.id)}
            onRouteFrom={() => routeFromHere(selectedPlace.id)}
            onPanorama={() => {
              const pa = panoramaForPlace(selectedPlace);
              if (!pa) return;
              const marker = pa.markers.find((m) => m.place === selectedPlace.id);
              openPanorama(pa.id, marker?.yaw);
            }}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="search-panel">
            <input
              className="search-input"
              type="search"
              placeholder="Найти место: кофе, зал, стенд 14…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск по карте"
            />
            <div className="chips" role="list">
              {doc.categories
                .filter((c) => doc.places.some((p) => p.category === c.id && !p.hidden))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    className="chip"
                    aria-pressed={category === c.id}
                    onClick={() => setCategory(category === c.id ? null : c.id)}
                  >
                    {categoryIcon(c.icon)} {c.name}
                  </button>
                ))}
            </div>
            <ul className="place-list">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" className="place-row" onClick={() => choosePlace(p.id)}>
                    <span className="place-row-icon">{categoryIcon(categories.get(p.category)?.icon ?? '')}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{categories.get(p.category)?.name}</small>
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="hint">Ничего не нашлось. Попробуйте другое слово.</li>}
            </ul>
          </div>
        )}
      </section>

      {pano && current && (
        <div className="pano-overlay" role="dialog" aria-label="Панорама">
          <Suspense fallback={<div className="screen-message">Загружаем панораму…</div>}>
            <PanoramaViewer
              key="viewer"
              imageUrl={panoramaUrls(current).image}
              previewUrl={panoramaUrls(current).preview}
              initialYaw={pano.yaw}
              markers={panoMarkers}
              onMarkerClick={onPanoMarker}
            />
          </Suspense>
          <button type="button" className="btn btn-secondary pano-close" onClick={() => setPano(null)}>
            ← К карте
          </button>
          {pano.tour && (
            <div className="tour-bar">
              <button type="button" className="btn btn-secondary" disabled={pano.index === 0} onClick={() => tourStep(-1)}>
                Назад
              </button>
              <span>
                {pano.index + 1} из {pano.ids.length}
              </span>
              <button type="button" className="btn btn-primary" disabled={pano.index >= pano.ids.length - 1} onClick={() => tourStep(1)}>
                Дальше
              </button>
            </div>
          )}
          {panoPlace && placesById.get(panoPlace) && (
            <div className="pano-card">
              <strong>{placesById.get(panoPlace)!.name}</strong>
              <p>{placesById.get(panoPlace)!.description}</p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPano(null);
                    routeHere(panoPlace);
                  }}
                >
                  Маршрут сюда
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPanoPlace(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlaceCard(props: {
  place: Place;
  categoryName: string;
  icon: string;
  hasPanorama: boolean;
  onRouteHere: () => void;
  onRouteFrom: () => void;
  onPanorama: () => void;
  onClose: () => void;
}) {
  const { place } = props;
  return (
    <article className="place-card">
      <header className="place-card-head">
        <span className="place-card-icon">{props.icon}</span>
        <div>
          <h2>{place.name}</h2>
          <small>
            {props.categoryName}
            {place.number ? ` · № ${place.number}` : ''}
          </small>
        </div>
        <button type="button" className="btn btn-ghost" aria-label="Закрыть" onClick={props.onClose}>
          ✕
        </button>
      </header>
      {place.description && <p>{place.description}</p>}
      {place.hours && <p className="hint">Часы работы: {place.hours}</p>}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={props.onRouteHere}>
          Маршрут сюда
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onRouteFrom}>
          Отсюда
        </button>
        {props.hasPanorama && (
          <button type="button" className="btn btn-secondary" onClick={props.onPanorama}>
            Панорама
          </button>
        )}
      </div>
    </article>
  );
}

function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
