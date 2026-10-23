// Карта посетителя (ТЗ 5.9, 5.10, 5.12, 5.19 — слои «вручную» и «QR-якорь»).
import {
  azimuth,
  NavGraph,
  nearestVisibleNode,
  normalize180,
  routePolyline,
  searchPlaces,
  unitAt,
  walkthrough,
  type Category,
  type MapDocument,
  type PanoramaPlacement,
  type Place,
  type Vec2,
} from '@space-map/map-core';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { loadPublishedMap, panoramaUrls, type LoadedMap } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { PlanCanvas } from '../plan/PlanCanvas.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { CategoryBadge, Icon } from '../ui/icons.tsx';
import { Sheet, useMediaQuery, type SheetMode } from '../ui/Sheet.tsx';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));
const Model3DView = lazy(() => import('../three/Model3DView.tsx'));

const WALK_SPEED = 1.2; // м/с, ТЗ 4.4
const DESKTOP = '(min-width: 900px)';
const PANEL_WIDTH = 392;

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

  if (error)
    return (
      <div className="screen-message">
        <div className="empty-state">
          <Icon name="map" size={32} />
          <p>{error}</p>
        </div>
      </div>
    );
  if (!loaded)
    return (
      <div className="screen-message">
        <div className="loader" aria-label="Загружаем карту" />
      </div>
    );
  return <Visitor doc={loaded.doc} anchorCode={search.get('a')} offlineDemo={loaded.offlineDemo} edited={loaded.edited} />;
}

function Visitor({ doc, anchorCode, offlineDemo, edited }: { doc: MapDocument; anchorCode: string | null; offlineDemo: boolean; edited: boolean }) {
  const level = doc.levels[0]?.id ?? 'L1';
  const levelName = doc.levels[0]?.name ?? '';
  const graph = useMemo(() => new NavGraph(doc), [doc]);
  const placesById = useMemo(() => new Map(doc.places.map((p) => [p.id, p])), [doc]);
  const categories = useMemo(() => new Map(doc.categories.map((c) => [c.id, c])), [doc]);
  const scaled = doc.venue.scaleClass === 'scaled';
  const desktop = useMediaQuery(DESKTOP);

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
  const [focusRoute, setFocusRoute] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('peek');
  const [sheetHeight, setSheetHeight] = useState(0);

  // QR-якорь «Вы здесь»: точка «откуда» уже стоит (ТЗ 5.19, слой 1).
  useEffect(() => {
    const anchor = anchorCode ? doc.anchors.find((a) => a.code === anchorCode) : undefined;
    if (anchor) setFrom({ kind: 'point', pos: anchor.pos, label: 'Вы здесь' });
  }, [doc, anchorCode]);

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
    return dedupe([...(start ? [start] : []), ...line, ...(end ? [end] : [])]);
  }, [route]);

  // Новый маршрут — сразу показать его целиком.
  useEffect(() => {
    if (routeLine) {
      setFocusRoute(true);
      setFitKey((k) => k + 1);
    }
  }, [routeLine]);

  const walk = useMemo(() => (route?.ok ? walkthrough(doc, graph, route.nodes) : null), [route]);

  const results = useMemo(() => {
    if (query.trim()) return searchPlaces(doc, query);
    return doc.places.filter((p) => !p.hidden && (!category || p.category === category));
  }, [doc, query, category]);

  const selectedPlace = selected ? placesById.get(selected) : undefined;
  const roomOf = (p: Place) => {
    const u = unitAt(doc, p.level, p.pos);
    return u && u.name !== p.name ? u.name : null;
  };

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

  const yawTowards = (fromId: string, toId?: string): number => {
    const a = panoById.get(fromId);
    if (!a || a.heading === null || !toId) return 0;
    const link = a.links.find((l) => l.to === toId);
    if (link) return link.yaw;
    const b = panoById.get(toId);
    return b ? normalize180(azimuth(a.pos, b.pos) - a.heading) : 0;
  };

  const startTour = () => {
    if (!walk || walk.segments.length === 0) return;
    const ids = walk.segments.flat();
    setPanoPlace(null);
    setPano({ ids, index: 0, tour: true, yaw: yawTowards(ids[0]!, ids[1]) });
  };

  const tourStep = (delta: number) => {
    if (!pano) return;
    const index = Math.max(0, Math.min(pano.ids.length - 1, pano.index + delta));
    setPano({ ...pano, index, yaw: yawTowards(pano.ids[index]!, pano.ids[index + 1]) });
  };

  const current = pano ? panoById.get(pano.ids[pano.index]!) : undefined;
  const currentRoom = current ? unitAt(doc, current.level, current.pos)?.name : undefined;
  const panoMarkers: PanoMarker[] = useMemo(() => {
    if (!current) return [];
    const places: PanoMarker[] = current.markers
      .filter((m) => m.status === 'accepted' && placesById.get(m.place) && !placesById.get(m.place)!.hidden)
      .map((m) => {
        const p = placesById.get(m.place)!;
        const cat = categories.get(p.category);
        return { id: `place:${p.id}`, kind: 'place', yaw: m.yaw, pitch: m.pitch, label: p.name, icon: cat?.icon, color: cat?.color };
      });
    const links: PanoMarker[] = current.links
      .filter((l) => l.status === 'accepted' && panoById.has(l.to))
      .map((l) => {
        const target = panoById.get(l.to)!;
        const room = unitAt(doc, target.level, target.pos)?.name;
        return { id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label: room ? `Перейти: ${room}` : 'Перейти сюда' };
      });
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
    setSheetMode('auto');
  };
  const routeHere = (id: string) => {
    setTo(id);
    setSelected(null);
    if (!from) setPickingFrom(true);
    setSheetMode('auto');
  };
  const routeFromHere = (id: string) => {
    setFrom({ kind: 'place', id });
    setSelected(null);
    setPickingFrom(false);
    setSheetMode('auto');
  };
  const clearRoute = () => {
    setFrom(null);
    setTo(null);
    setPickingFrom(false);
    setFocusRoute(false);
    setSheetMode('peek');
  };
  const swapRoute = () => {
    if (!from || from.kind !== 'place' || !to) return;
    setFrom({ kind: 'place', id: to });
    setTo(from.id);
  };

  const onPlanEmpty = (pos: Vec2) => {
    if (pickingFrom) {
      const room = unitAt(doc, level, pos);
      setFrom({ kind: 'point', pos, label: room ? `Точка: ${room.name}` : 'Точка на карте' });
      setPickingFrom(false);
    } else if (selected) {
      setSelected(null);
      setSheetMode('peek');
    }
  };

  const onPlanPlace = (id: string) => {
    if (pickingFrom) return routeFromHere(id);
    choosePlace(id);
  };

  const routeVisible = !!(to || from);
  const visibleCategories = doc.categories.filter((c) => doc.places.some((p) => p.category === c.id && !p.hidden));
  const minutes = route?.ok ? Math.max(1, Math.round(route.length / WALK_SPEED / 60)) : 0;

  const insets = desktop ? { left: PANEL_WIDTH + 32, top: 0, bottom: 0 } : { top: 72, bottom: sheetHeight };

  const brand = (
    <div className="brand">
      <span className="brand-mark" aria-hidden>
        <Icon name="building" size={20} />
      </span>
      <div className="brand-text">
        <h1 className="brand-title">{doc.venue.name}</h1>
        <p className="brand-sub">
          {levelName}
          {offlineDemo && <span className="pill">{edited ? 'Демо · изменено' : 'Демо'}</span>}
        </p>
      </div>
    </div>
  );

  const viewSwitch = (
    <div className="segmented" role="group" aria-label="Вид карты">
      <button type="button" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>
        <Icon name="map" size={17} />
        <span>План</span>
      </button>
      <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
        <Icon name="cube" size={17} />
        <span>3D</span>
      </button>
    </div>
  );

  const editLink = offlineDemo ? (
    <Link to="/app/editor" className="icon-btn" aria-label="Редактор площадки" title="Редактор площадки">
      <Icon name="edit" size={19} />
    </Link>
  ) : null;

  let content;
  if (routeVisible) {
    content = (
      <div className="route-panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Маршрут</h2>
          <button type="button" className="icon-btn ghost" aria-label="Закрыть маршрут" onClick={clearRoute}>
            <Icon name="close" />
          </button>
        </div>
        <div className="route-ends">
          <div className="route-line" aria-hidden />
          <button type="button" className={`route-end ${pickingFrom ? 'is-picking' : ''}`} onClick={() => setPickingFrom(true)}>
            <span className="dot dot-from" />
            <span className="route-end-text">
              <small>Откуда</small>
              {from ? endpointLabel(from) : pickingFrom ? 'Нажмите на карте или на место' : 'Выберите точку'}
            </span>
          </button>
          <div className="route-end">
            <span className="dot dot-to" />
            <span className="route-end-text">
              <small>Куда</small>
              {to ? placesById.get(to)?.name : 'Выберите место'}
            </span>
          </div>
          {from?.kind === 'place' && to && (
            <button type="button" className="icon-btn route-swap" aria-label="Поменять местами" onClick={swapRoute}>
              <Icon name="swap" size={18} />
            </button>
          )}
        </div>
        {route && !route.ok && (
          <p className="notice">{route.reason === 'same_point' ? 'Вы уже на месте.' : 'Маршрут не найден. Попробуйте выбрать другие точки.'}</p>
        )}
        {route?.ok && (
          <div className="route-stats">
            {scaled ? (
              <>
                <div className="stat">
                  <strong>{minutes}</strong>
                  <span>мин пешком</span>
                </div>
                <div className="stat">
                  <strong>{Math.round(route.length)}</strong>
                  <span>метров</span>
                </div>
              </>
            ) : (
              <p className="hint">Маршрут построен. План без масштаба — расстояние не показываем.</p>
            )}
          </div>
        )}
        {walk && walk.segments.length > 0 && (
          <>
            <button type="button" className="btn btn-primary btn-block" onClick={startTour}>
              <Icon name="walk" size={19} />
              Пройти в панорамах · {walk.segments.flat().length}
            </button>
            {!walk.complete && <p className="hint">Панорамы есть не на всём пути — участки без них пропускаются.</p>}
          </>
        )}
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFocusRoute(true);
              setFitKey((k) => k + 1);
            }}
          >
            <Icon name="fit" size={18} />
            Весь маршрут
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearRoute}>
            Сбросить
          </button>
        </div>
      </div>
    );
  } else if (selectedPlace) {
    const cat = categories.get(selectedPlace.category);
    content = (
      <PlaceCard
        place={selectedPlace}
        category={cat}
        room={roomOf(selectedPlace)}
        hasPanorama={!!panoramaForPlace(selectedPlace)}
        onRouteHere={() => routeHere(selectedPlace.id)}
        onRouteFrom={() => routeFromHere(selectedPlace.id)}
        onPanorama={() => {
          const pa = panoramaForPlace(selectedPlace);
          if (!pa) return;
          const marker = pa.markers.find((m) => m.place === selectedPlace.id);
          openPanorama(pa.id, marker?.yaw);
        }}
        onClose={() => {
          setSelected(null);
          setSheetMode('peek');
        }}
      />
    );
  } else {
    content = (
      <div className="search-panel">
        <label className="search-field">
          <Icon name="search" size={19} />
          <input
            type="search"
            placeholder="Кофе, зал, стенд 14…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => !desktop && setSheetMode('full')}
            aria-label="Поиск по карте"
            enterKeyHint="search"
          />
          {query && (
            <button type="button" className="search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <div className="chips" role="list">
          {visibleCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className="chip"
              aria-pressed={category === c.id}
              style={{ ['--chip' as string]: c.color }}
              onClick={() => {
                setCategory(category === c.id ? null : c.id);
                setQuery('');
              }}
            >
              <span className="chip-dot" />
              {c.name}
            </button>
          ))}
        </div>
        <p className="list-caption">
          {query.trim() ? `Найдено: ${results.length}` : category ? categories.get(category)?.name : 'Все места'}
          {!query.trim() && <span>{results.length}</span>}
        </p>
        <ul className="place-list">
          {results.map((p) => {
            const cat = categories.get(p.category);
            const room = roomOf(p);
            return (
              <li key={p.id}>
                <button type="button" className="place-row" onClick={() => choosePlace(p.id)}>
                  <CategoryBadge icon={cat?.icon ?? ''} color={cat?.color ?? '#4A5568'} size={38} />
                  <span className="place-row-text">
                    <strong>{p.name}</strong>
                    <small>
                      {cat?.name}
                      {room ? ` · ${room}` : ''}
                    </small>
                  </span>
                  <Icon name="back" size={18} className="row-chevron" />
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="hint empty-row">Ничего не нашлось. Попробуйте другое слово.</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className={`visitor ${desktop ? 'is-desktop' : 'is-mobile'}`}>
      <main className="visitor-map">
        {mode === 'plan' ? (
          <PlanCanvas
            doc={doc}
            level={level}
            route={routeLine}
            selectedPlace={selected ?? to}
            fromPoint={from ? endpointPos(from) : null}
            category={query.trim() ? null : category}
            insets={insets}
            fitKey={fitKey}
            focus={focusRoute ? routeLine : null}
            onPlaceClick={onPlanPlace}
            onPanoramaClick={(id) => openPanorama(id)}
            onEmptyClick={onPlanEmpty}
          />
        ) : (
          <ErrorBoundary fallback={<div className="screen-message">Не удалось загрузить 3D. Проверьте интернет и откройте вид снова.</div>}>
            <Suspense fallback={<div className="screen-message"><div className="loader" /></div>}>
              <Model3DView doc={doc} level={level} route={routeLine} selectedPlace={selected ?? to} onPlaceClick={onPlanPlace} insets={insets} />
            </Suspense>
          </ErrorBoundary>
        )}
        {pickingFrom && (
          <div className="map-banner" role="status" style={desktop ? { left: PANEL_WIDTH + 48 } : undefined}>
            <Icon name="from" size={18} />
            Нажмите на карте, откуда идти
            <button type="button" className="map-banner-btn" onClick={() => setPickingFrom(false)}>
              Отмена
            </button>
          </div>
        )}
      </main>

      {!desktop && (
        <header className="topbar">
          {brand}
          <div className="topbar-actions">
            {viewSwitch}
            {editLink}
          </div>
        </header>
      )}

      <Sheet
        mode={sheetMode}
        onModeChange={setSheetMode}
        desktop={desktop}
        onHeight={setSheetHeight}
        label="Поиск и маршрут"
        header={
          desktop ? (
            <div className="panel-header">
              {brand}
              <div className="topbar-actions">
                {viewSwitch}
                {editLink}
              </div>
            </div>
          ) : null
        }
      >
        {content}
      </Sheet>

      {pano && current && (
        <div className="pano-overlay" role="dialog" aria-label="Панорама">
          <ErrorBoundary fallback={<div className="screen-message dark">Не удалось загрузить панораму.</div>}>
          <Suspense fallback={<div className="screen-message dark"><div className="loader" /></div>}>
            <PanoramaViewer
              key="viewer"
              imageUrl={panoramaUrls(current).image}
              previewUrl={panoramaUrls(current).preview}
              initialYaw={pano.yaw}
              markers={panoMarkers}
              onMarkerClick={onPanoMarker}
            />
          </Suspense>
          </ErrorBoundary>
          <div className="pano-top">
            <button type="button" className="glass-btn" onClick={() => setPano(null)}>
              <Icon name="back" size={18} />К карте
            </button>
            {currentRoom && <span className="glass-title">{currentRoom}</span>}
          </div>
          {pano.tour && (
            <div className="tour-bar">
              <button type="button" className="glass-btn" disabled={pano.index === 0} onClick={() => tourStep(-1)}>
                Назад
              </button>
              <div className="tour-progress" aria-label={`${pano.index + 1} из ${pano.ids.length}`}>
                {pano.ids.map((id, i) => (
                  <span key={id + i} className={i === pano.index ? 'is-active' : i < pano.index ? 'is-done' : ''} />
                ))}
              </div>
              <button type="button" className="btn btn-primary" disabled={pano.index >= pano.ids.length - 1} onClick={() => tourStep(1)}>
                Дальше
              </button>
            </div>
          )}
          {panoPlace && placesById.get(panoPlace) && (
            <div className="pano-card">
              <div className="place-card-head">
                <CategoryBadge
                  icon={categories.get(placesById.get(panoPlace)!.category)?.icon ?? ''}
                  color={categories.get(placesById.get(panoPlace)!.category)?.color ?? '#4A5568'}
                  size={40}
                />
                <div>
                  <h2>{placesById.get(panoPlace)!.name}</h2>
                  <small>{categories.get(placesById.get(panoPlace)!.category)?.name}</small>
                </div>
                <button type="button" className="icon-btn ghost" aria-label="Закрыть" onClick={() => setPanoPlace(null)}>
                  <Icon name="close" />
                </button>
              </div>
              {placesById.get(panoPlace)!.description && <p>{placesById.get(panoPlace)!.description}</p>}
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  setPano(null);
                  routeHere(panoPlace);
                }}
              >
                <Icon name="route" size={18} />
                Маршрут сюда
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlaceCard(props: {
  place: Place;
  category: Category | undefined;
  room: string | null;
  hasPanorama: boolean;
  onRouteHere: () => void;
  onRouteFrom: () => void;
  onPanorama: () => void;
  onClose: () => void;
}) {
  const { place, category } = props;
  return (
    <article className="place-card">
      <header className="place-card-head">
        <CategoryBadge icon={category?.icon ?? ''} color={category?.color ?? '#4A5568'} size={46} />
        <div>
          <h2>{place.name}</h2>
          <small>
            {category?.name}
            {place.number ? ` · № ${place.number}` : ''}
            {props.room ? ` · ${props.room}` : ''}
          </small>
        </div>
        <button type="button" className="icon-btn ghost" aria-label="Закрыть" onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </header>
      {place.description && <p className="place-desc">{place.description}</p>}
      {place.hours && <p className="hint">Часы работы: {place.hours}</p>}
      <div className="action-grid">
        <button type="button" className="btn btn-primary" onClick={props.onRouteHere}>
          <Icon name="route" size={18} />
          Маршрут сюда
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onRouteFrom}>
          <Icon name="from" size={18} />
          Отсюда
        </button>
        {props.hasPanorama && (
          <button type="button" className="btn btn-secondary" onClick={props.onPanorama}>
            <Icon name="pano" size={18} />
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

/** Соседние совпадающие точки (место стоит ровно на узле) — убираем, чтобы линия не ломалась. */
function dedupe(points: Vec2[]): Vec2[] {
  return points.filter((p, i) => i === 0 || dist(p, points[i - 1]!) > 0.01);
}
