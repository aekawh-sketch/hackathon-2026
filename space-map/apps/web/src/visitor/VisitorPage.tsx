// Карта посетителя (ТЗ 5.9, 5.10, 5.12, 5.19 — слои «вручную» и «QR-якорь»).
import {
  azimuth,
  NavGraph,
  nearestVisibleNode,
  panoramaForPlace,
  panoramaPointName,
  normalize180,
  routeDirectionInPanorama,
  routeLegs,
  searchPlaces,
  sortedLevels,
  unitAt,
  walkthrough,
  type Category,
  type MapDocument,
  type PanoramaPlacement,
  type Place,
  type RouteLeg,
  type Vec2,
} from '@space-map/map-core';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { loadPublishedMap, panoramaUrls, publishedVersion, trackView, type LoadedMap, type StatKind } from '../api.ts';
import type { PanoMarker } from '../panorama/PanoramaViewer.tsx';
import { PlanCanvas } from '../plan/PlanCanvas.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { CategoryBadge, Icon } from '../ui/icons.tsx';
import { Sheet, useMediaQuery, type SheetMode } from '../ui/Sheet.tsx';
import { ThemeToggle } from '../ui/theme.tsx';
import { LevelSwitch } from '../ui/LevelSwitch.tsx';
import { OfflineSave, useOnline } from './OfflineSave.tsx';

const PanoramaViewer = lazy(() => import('../panorama/PanoramaViewer.tsx'));
const Model3DView = lazy(() => import('../three/Model3DView.tsx'));

const WALK_SPEED = 1.2; // м/с, ТЗ 4.4
/** Как часто карта посетителя проверяет, не опубликовали ли новую версию. */
const MAP_SYNC_MS = 8_000;
/** Поворот на 90° «стоит» метр пути: из почти равных маршрутов выбираем тот, где меньше поворотов. */
const TURN_PENALTY = 1;
const DESKTOP = '(min-width: 900px)';
const PANEL_WIDTH = 392;

type Endpoint = { kind: 'place'; id: string } | { kind: 'point'; pos: Vec2; label: string; level: string };

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

  // Карту обновили (организатор сохранил или снял панораму) — подхватываем новую версию без перезагрузки.
  // Спрашиваем только номер версии; вкладка в фоне не спрашивает, при возвращении — сразу.
  const version = loaded?.offlineDemo ? null : (loaded?.version ?? null);
  useEffect(() => {
    if (version === null) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        if ((await publishedVersion(slug)) === version || stopped) return;
        const next = await loadPublishedMap(slug);
        if (!stopped && !next.offlineDemo) setLoaded(next);
      } catch {
        // Нет связи — спросим в следующий раз.
      }
    };
    const id = setInterval(() => void check(), MAP_SYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, version]);

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
  return (
    <Visitor
      doc={loaded.doc}
      anchorCode={search.get('a')}
      offlineDemo={loaded.offlineDemo}
      edited={loaded.edited}
      statsSlug={loaded.offlineDemo ? null : slug}
      slug={slug}
      version={loaded.version}
    />
  );
}

interface VisitorProps {
  doc: MapDocument;
  anchorCode: string | null;
  offlineDemo: boolean;
  edited: boolean;
  /** Куда слать статистику просмотров; null — карта не с сервера. */
  statsSlug: string | null;
  slug: string;
  version: number | null;
}

function Visitor({ doc, anchorCode, offlineDemo, edited, statsSlug, slug, version }: VisitorProps) {
  const online = useOnline();
  const levels = useMemo(() => sortedLevels(doc), [doc]);
  const [levelId, setLevelId] = useState(() => levels[0]?.id ?? 'L1');
  const level = doc.levels.some((l) => l.id === levelId) ? levelId : (levels[0]?.id ?? 'L1');
  const nameOfLevel = (id: string) => doc.levels.find((l) => l.id === id)?.name ?? '';
  const levelName = nameOfLevel(level);
  const graph = useMemo(() => new NavGraph(doc, { turnPenalty: TURN_PENALTY }), [doc]);
  const placesById = useMemo(() => new Map(doc.places.map((p) => [p.id, p])), [doc]);
  const categories = useMemo(() => new Map(doc.categories.map((c) => [c.id, c])), [doc]);
  const scaled = doc.venue.scaleClass === 'scaled';
  const desktop = useMediaQuery(DESKTOP);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  /** Какой конец маршрута ставится следующим касанием карты. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  // Посетитель сразу видит площадку в 3D — так понятнее, как она устроена; план — одним касанием.
  const [mode, setMode] = useState<'plan' | '3d'>('3d');
  const [pano, setPano] = useState<PanoState | null>(null);
  const [panoPlace, setPanoPlace] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [focusRoute, setFocusRoute] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('peek');
  const [sheetHeight, setSheetHeight] = useState(0);

  // Статистика для организатора: только счётчики, без сведений о посетителе. Открытие карты — раз за сеанс вкладки.
  const track = (kind: StatKind, target?: string) => statsSlug && trackView(statsSlug, kind, target);
  useEffect(() => {
    if (!statsSlug) return;
    const key = `space-map:opened:${statsSlug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Хранилище недоступно — считаем каждое открытие.
    }
    trackView(statsSlug, 'open');
  }, [statsSlug]);

  // QR-якорь «Вы здесь»: точка «откуда» уже стоит (ТЗ 5.19, слой 1).
  useEffect(() => {
    const anchor = anchorCode ? doc.anchors.find((a) => a.code === anchorCode) : undefined;
    if (anchor) {
      setFrom({ kind: 'point', pos: anchor.pos, label: 'Вы здесь', level: anchor.level });
      setLevelId(anchor.level);
    }
  }, [doc, anchorCode]);

  const endpointNode = (e: Endpoint): string | null =>
    e.kind === 'place' ? (placesById.get(e.id)?.node ?? null) : (nearestVisibleNode(doc, e.level, e.pos)?.id ?? null);
  const endpointLevel = (e: Endpoint): string | null => (e.kind === 'place' ? (placesById.get(e.id)?.level ?? null) : e.level);
  const endpointPos = (e: Endpoint): Vec2 | null => (e.kind === 'place' ? (placesById.get(e.id)?.pos ?? null) : e.pos);
  const endpointLabel = (e: Endpoint) => (e.kind === 'place' ? (placesById.get(e.id)?.name ?? '') : e.label);

  const route = useMemo(() => {
    if (!from || !to) return null;
    const a = endpointNode(from);
    const b = endpointNode(to);
    if (!a || !b) return { ok: false as const, reason: 'not_found' as const };
    return graph.route(a, b);
  }, [from, to, graph]);

  // Маршрут по этажам: участок на каждом этаже и переход по лестнице или лифту на следующий.
  const legs = useMemo<RouteLeg[] | null>(() => {
    if (!route?.ok || !from || !to) return null;
    const out = routeLegs(doc, graph, route.nodes).map((l) => ({ ...l, points: [...l.points] }));
    const start = endpointPos(from);
    const end = endpointPos(to);
    if (start && out[0]) out[0].points.unshift(start);
    if (end && out.length) out[out.length - 1]!.points.push(end);
    return out.map((l) => ({ ...l, points: dedupe(l.points) }));
  }, [route]);
  const lineOn = (lv: string): Vec2[] | null => {
    const pts = legs?.filter((l) => l.level === lv).flatMap((l) => l.points) ?? [];
    return pts.length >= 2 ? pts : null;
  };
  const routeLine = useMemo(() => lineOn(level), [legs, level]);
  // Новый маршрут начинается на этаже «откуда».
  useEffect(() => {
    if (legs?.[0]) setLevelId(legs[0].level);
  }, [legs]);

  // Новый маршрут — сразу показать его целиком.
  useEffect(() => {
    if (routeLine) {
      setFocusRoute(true);
      setFitKey((k) => k + 1);
    }
  }, [routeLine]);

  const walk = useMemo(() => (route?.ok ? walkthrough(doc, graph, route.nodes) : null), [route]);

  // Маршрут считаем один раз на пару «откуда — куда»: обновление карты пересчитывает маршрут, но это не новый.
  const trackedRoute = useRef('');
  useEffect(() => {
    if (!route?.ok || !from || !to) return;
    const key = JSON.stringify([from, to]);
    if (trackedRoute.current === key) return;
    trackedRoute.current = key;
    track('route', to.kind === 'place' ? to.id : '');
  }, [route]);

  const results = useMemo(() => {
    if (query.trim()) return searchPlaces(doc, query);
    return doc.places.filter((p) => !p.hidden && (!category || p.category === category));
  }, [doc, query, category]);

  // Искали и не нашли — организатору подсказка, каких мест или слов не хватает. Ждём, пока человек допечатает.
  const searchMiss = query.trim().length >= 3 && results.length === 0 ? query.trim() : null;
  useEffect(() => {
    if (!searchMiss) return;
    const t = setTimeout(() => track('search_miss', searchMiss), 1500);
    return () => clearTimeout(t);
  }, [searchMiss]);

  const selectedPlace = selected ? placesById.get(selected) : undefined;
  const roomOf = (p: Place) => {
    const u = unitAt(doc, p.level, p.pos);
    return u && u.name !== p.name ? u.name : null;
  };

  // ── Панорамы ──
  const panoById = useMemo(() => new Map(doc.panoramas.map((p) => [p.id, p])), [doc]);
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
  useEffect(() => {
    if (current) track('panorama', current.id);
  }, [current?.id]);
  const currentRoom = current ? unitAt(doc, current.level, current.pos)?.name : undefined;

  // Соседи по маршруту: в прогулке — по её порядку, в одиночной панораме — если она стоит на маршруте.
  // Линия маршрута на этаже открытой панорамы: по ней стрелки «дальше по маршруту».
  const panoLine = current ? lineOn(current.level) : null;
  const routeNeighbours = useMemo(() => {
    if (!current || !legs) return null;
    const ids = pano?.tour ? pano.ids : (walk?.segments.flat() ?? []);
    const i = pano?.tour ? pano.index : ids.indexOf(current.id);
    if (i < 0) return { next: null, prev: null };
    return { next: ids[i + 1] ?? null, prev: ids[i - 1] ?? null };
  }, [current, legs, pano, walk]);

  const panoMarkers: PanoMarker[] = useMemo(() => {
    if (!current) return [];
    const places: PanoMarker[] = current.markers
      .filter((m) => m.status === 'accepted' && placesById.get(m.place) && !placesById.get(m.place)!.hidden)
      .map((m) => {
        const p = placesById.get(m.place)!;
        const cat = categories.get(p.category);
        return { id: `place:${p.id}`, kind: 'place', yaw: m.yaw, pitch: m.pitch, label: p.name, icon: cat?.icon, color: cat?.color };
      });
    const next = routeNeighbours?.next ?? null;
    const prev = routeNeighbours?.prev ?? null;
    const links: PanoMarker[] = current.links
      .filter((l) => l.status === 'accepted' && panoById.has(l.to))
      .map((l) => {
        const target = panoById.get(l.to)!;
        const room = panoramaPointName(doc, target.id) ?? unitAt(doc, target.level, target.pos)?.name;
        if (routeNeighbours && l.to === next) {
          return { id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label: `Дальше по маршруту · ${Math.round(dist(current.pos, target.pos))} м`, route: 'next' };
        }
        const label = routeNeighbours && l.to === prev ? 'Назад по маршруту' : room ? `Перейти: ${room}` : 'Перейти сюда';
        return { id: `link:${l.to}`, kind: 'link', yaw: l.yaw, pitch: -22, label, route: routeNeighbours ? (l.to === prev ? 'prev' : 'off') : undefined };
      });
    // Маршрут идёт дальше, а перехода туда нет (разрыв в панорамах или конец куска) — стрелка по линии маршрута.
    if (routeNeighbours && panoLine && !links.some((l) => l.route === 'next')) {
      const yaw = routeDirectionInPanorama(doc, current, panoLine);
      const end = panoLine[panoLine.length - 1]!;
      if (yaw !== null && dist(current.pos, end) > 2) {
        links.push({
          id: 'route-next',
          kind: 'link',
          yaw,
          pitch: -22,
          label: next ? 'Дальше по маршруту — к следующей панораме' : 'Маршрут идёт дальше — панорам там нет',
          route: 'next',
        });
      }
    }
    return [...places, ...links];
  }, [current, routeNeighbours, legs]);

  const onPanoMarker = (m: PanoMarker) => {
    if (!current) return;
    if (m.kind === 'place') {
      setPanoPlace(m.id.slice('place:'.length));
      return;
    }
    if (m.id === 'route-next') {
      const nextId = routeNeighbours?.next;
      if (!nextId) return setPano(null); // дальше панорам нет — показываем путь на плане
      if (pano?.tour) return tourStep(1);
      const nextPano = panoById.get(nextId);
      const nextLine = nextPano ? lineOn(nextPano.level) : null;
      return openPanorama(nextId, (nextPano && nextLine && routeDirectionInPanorama(doc, nextPano, nextLine)) ?? 0);
    }
    const target = panoById.get(m.id.slice('link:'.length));
    if (!target) return;
    // После перехода смотрим туда же, куда смотрели до него (ТЗ 5.7).
    const worldDir = (current.heading ?? 0) + m.yaw;
    const yaw = target.heading === null ? 0 : normalize180(worldDir - target.heading);
    if (pano?.tour) {
      const index = pano.ids.indexOf(target.id);
      if (index >= 0) return setPano({ ...pano, index, yaw: m.route === 'next' ? yawTowards(target.id, pano.ids[index + 1]) : yaw });
    }
    openPanorama(target.id, yaw);
  };

  // ── Действия ──
  const choosePlace = (id: string) => {
    const place = placesById.get(id);
    if (place) setLevelId(place.level);
    if (id !== selected) track('place', id);
    setSelected(id);
    setQuery('');
    setSheetMode('auto');
  };
  const routeVisible = !!(to || from);

  // Поставили один конец — следующее касание карты ставит другой, если его ещё нет.
  const setEnd = (which: 'from' | 'to', e: Endpoint) => {
    const other = which === 'from' ? to : from;
    if (which === 'from') setFrom(e);
    else setTo(e);
    setSelected(null);
    setPicking(other ? null : which === 'from' ? 'to' : 'from');
    setSheetMode('auto');
  };
  const routeHere = (id: string) => setEnd('to', { kind: 'place', id });
  const routeFromHere = (id: string) => setEnd('from', { kind: 'place', id });
  const clearRoute = () => {
    setFrom(null);
    setTo(null);
    setPicking(null);
    setFocusRoute(false);
    setSheetMode('peek');
  };
  const swapRoute = () => {
    if (!from || !to) return;
    setFrom(to);
    setTo(from);
  };

  const pointEndpoint = (pos: Vec2): Endpoint => {
    const room = unitAt(doc, level, pos);
    return { kind: 'point', pos, label: room ? `Точка: ${room.name}` : 'Точка на карте', level };
  };

  /** Какой конец заполнить касанием: явно выбранный, иначе недостающий, пока маршрут открыт. */
  const endToFill = (): 'from' | 'to' | null => picking ?? (routeVisible ? (!to ? 'to' : !from ? 'from' : null) : null);

  const onPlanEmpty = (pos: Vec2) => {
    const which = endToFill();
    if (which) return setEnd(which, pointEndpoint(pos));
    if (selected) {
      setSelected(null);
      setSheetMode('peek');
    }
  };

  const onPlanPlace = (id: string) => {
    // Маршрут открыт и оба конца стоят — место становится новым «Куда».
    const which = endToFill() ?? (routeVisible ? 'to' : null);
    if (which) return setEnd(which, { kind: 'place', id });
    choosePlace(id);
  };

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
          {!online && <span className="pill">Без интернета</span>}
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

  // Посетитель карту не правит — редактор только из кабинета. Отсюда — ко всем картам; встроенная в чужой сайт карта
  // кнопку не показывает: уводить с чужой страницы незачем.
  const embedded = window.self !== window.top;
  const homeLink = embedded ? null : (
    <Link to="/" className="icon-btn" aria-label="Все карты" title="Все карты">
      <Icon name="grid" size={19} />
    </Link>
  );

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
          <button type="button" className={`route-end ${picking === 'from' ? 'is-picking' : ''}`} onClick={() => setPicking('from')}>
            <span className="dot dot-from" />
            <span className="route-end-text">
              <small>Откуда</small>
              {from ? endpointLabel(from) : picking === 'from' ? 'Нажмите на карте или на место' : 'Выберите точку'}
            </span>
          </button>
          <button type="button" className={`route-end ${picking === 'to' ? 'is-picking' : ''}`} onClick={() => setPicking('to')}>
            <span className="dot dot-to" />
            <span className="route-end-text">
              <small>Куда</small>
              {to ? endpointLabel(to) : picking === 'to' ? 'Нажмите на карте или на место' : 'Выберите место'}
            </span>
          </button>
          {from && to && (
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
        {legs &&
          legs.map(
            (leg, i) =>
              leg.change && (
                <div key={i} className="route-floor">
                  <Icon name={leg.change.kind} size={19} />
                  <span>{floorStep(leg, nameOfLevel)}</span>
                  {leg.change.to !== level && (
                    <button type="button" className="btn btn-secondary" onClick={() => setLevelId(leg.change!.to)}>
                      Показать
                    </button>
                  )}
                </div>
              ),
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
    const placePano = panoramaForPlace(doc, selectedPlace);
    content = (
      <PlaceCard
        place={selectedPlace}
        category={cat}
        room={roomOf(selectedPlace)}
        previewUrl={placePano ? panoramaUrls(placePano.panorama).preview : null}
        onRouteHere={() => routeHere(selectedPlace.id)}
        onRouteFrom={() => routeFromHere(selectedPlace.id)}
        onPanorama={() => placePano && openPanorama(placePano.panorama.id, placePano.yaw ?? undefined)}
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
                      {levels.length > 1 ? ` · ${nameOfLevel(p.level)}` : ''}
                    </small>
                  </span>
                  <Icon name="back" size={18} className="row-chevron" />
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="hint empty-row">Ничего не нашлось. Попробуйте другое слово.</li>}
        </ul>
        {/* На телефоне в шапке место нужно названию — переключатель темы внизу списка. */}
        <div className="sheet-foot">
          <OfflineSave slug={slug} doc={doc} version={version} />
          {!desktop && <ThemeToggle labeled className="btn btn-ghost" />}
        </div>
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
            selectedPlace={selected ?? (to?.kind === 'place' ? to.id : null)}
            fromPoint={from && endpointLevel(from) === level ? endpointPos(from) : null}
            toPoint={to?.kind === 'point' && to.level === level ? to.pos : null}
            category={query.trim() ? null : category}
            insets={insets}
            fitKey={fitKey}
            focus={focusRoute ? routeLine : null}
            onPlaceClick={onPlanPlace}
            onEmptyClick={onPlanEmpty}
          />
        ) : (
          <ErrorBoundary fallback={<div className="screen-message">Не удалось загрузить 3D. Проверьте интернет и откройте вид снова.</div>}>
            <Suspense fallback={<div className="screen-message"><div className="loader" /></div>}>
              <Model3DView doc={doc} level={level} route={routeLine} selectedPlace={selected ?? (to?.kind === 'place' ? to.id : null)} onPlaceClick={onPlanPlace} insets={insets} />
            </Suspense>
          </ErrorBoundary>
        )}
        {levels.length > 1 && <LevelSwitch levels={levels} value={level} onChange={setLevelId} style={desktop ? { left: PANEL_WIDTH + 48, bottom: 24 } : { left: 12, top: 136 }} />}
        {!picking && legs && (() => {
          // Маршрут уходит с этого этажа (или проходит не здесь) — подсказка, куда дальше.
          const here = legs.find((l) => l.level === level && l.change);
          const onRoute = legs.some((l) => l.level === level);
          if (!here && onRoute) return null;
          const target = here ? here.change!.to : legs[0]!.level;
          return (
            <div className="map-banner" role="status" style={desktop ? { left: PANEL_WIDTH + 48 } : undefined}>
              <Icon name={here ? here.change!.kind : 'route'} size={18} />
              {here ? floorStep(here, nameOfLevel) : 'Маршрут — на другом этаже'}
              <button type="button" className="map-banner-btn" onClick={() => setLevelId(target)}>
                {here ? 'Дальше' : 'Показать'}
              </button>
            </div>
          );
        })()}
        {picking && (
          <div className="map-banner" role="status" style={desktop ? { left: PANEL_WIDTH + 48 } : undefined}>
            <Icon name={picking === 'from' ? 'from' : 'pin'} size={18} />
            {picking === 'from' ? 'Нажмите на карте, откуда идти' : 'Нажмите на место или точку, куда идти'}
            <button type="button" className="map-banner-btn" onClick={() => setPicking(null)}>
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
            {homeLink}
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
                <ThemeToggle />
                {homeLink}
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
  /** Превью панорамы, где видно место; null — панорамы рядом нет. */
  previewUrl: string | null;
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
      {props.previewUrl && (
        <button type="button" className="pano-preview" onClick={props.onPanorama} aria-label={`Открыть панораму: ${place.name}`}>
          <img src={props.previewUrl} alt="" loading="lazy" decoding="async" />
          <span className="pano-preview-label">
            <Icon name="pano" size={17} /> Открыть панораму
          </span>
        </button>
      )}
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
        {props.previewUrl && (
          <button type="button" className="btn btn-secondary" onClick={props.onPanorama}>
            <Icon name="pano" size={18} />
            Открыть панораму
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

/** «По лестнице вверх на «3 этаж»» — переход с участка маршрута на следующий этаж. */
function floorStep(leg: RouteLeg, nameOf: (id: string) => string): string {
  const change = leg.change!;
  const how = change.kind === 'elevator' ? 'На лифте' : 'По лестнице';
  const dir = change.floors > 0 ? 'вверх' : 'вниз';
  return `${how} ${dir} на «${nameOf(change.to)}»`;
}
