// План для посетителя: жесты (сдвиг, щипок, колесо), касания по местам и панорамам, кнопки масштаба.
import type { MapDocument, Vec2 } from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Circle, Layer, Stage } from 'react-konva';
import { Icon } from '../ui/icons.tsx';
import { BasePlan, gridStyle, PanoDot, pinchView, PlacePin, RouteLine, UnitLabels, useElementSize } from './draw.tsx';
import { FROM, SELECTED } from './style.ts';
import { fitBoundsInset, levelBounds, screenToWorld, worldToScreen, zoomAt, type Insets, type Viewport } from './viewport.ts';

export interface PlanCanvasProps {
  doc: MapDocument;
  level: string;
  route?: Vec2[] | null;
  selectedPlace?: string | null;
  activePanorama?: string | null;
  fromPoint?: Vec2 | null;
  /** «Куда» — точка на плане, а не место. */
  toPoint?: Vec2 | null;
  /** Категория в фильтре — остальные места приглушены. */
  category?: string | null;
  /** Панели поверх карты — «показать всё» вписывает план в свободную часть. */
  insets?: Insets;
  /** Смена значения — снова «показать всё». */
  fitKey?: number;
  /** Вписать в экран эти точки (маршрут), а не весь этаж. */
  focus?: Vec2[] | null;
  onPlaceClick?: (id: string) => void;
  onPanoramaClick?: (id: string) => void;
  onEmptyClick?: (world: Vec2) => void;
}

// Палец при нажатии почти всегда немного съезжает, а попасть им точнее ~1 см трудно —
// для касаний пороги больше, чем для мыши: иначе нажатие считается сдвигом карты или промахом.
const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const TAP_TOLERANCE = COARSE ? 12 : 8;
const PLACE_HIT = COARSE ? 28 : 22;
const PANO_HIT = COARSE ? 24 : 16;
/** Кнопкам масштаба нужно столько свободной высоты над шторкой; меньше — прячем «+/−», остаётся щипок. */
const ZOOM_ROOM = 230;
const FIT_ROOM = 110;

export function PlanCanvas(props: PlanCanvasProps) {
  const { doc, level, route, selectedPlace, activePanorama, fromPoint, toPoint, category, insets, fitKey = 0, focus } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapRef);
  const [view, setView] = useState<Viewport>({ scale: 20, x: 0, y: 0 });
  const freeHeight = (size?.h ?? 1000) - (insets?.bottom ?? 0) - (insets?.top ?? 0);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef({ moved: false, start: [0, 0] as Vec2 });

  const insetKey = `${insets?.top ?? 0}:${insets?.right ?? 0}:${insets?.bottom ?? 0}:${insets?.left ?? 0}`;
  const fit = () => {
    if (!size) return;
    const pts = focus && focus.length > 1 ? focus : null;
    // Короткий маршрут не раздуваем во весь экран: рамка не меньше 14 × 10 м.
    const grow = (lo: number, hi: number, min: number): [number, number] => {
      const pad = Math.max(2, (min - (hi - lo)) / 2);
      return [lo - pad, hi + pad];
    };
    const bounds = pts
      ? (() => {
          const [minX, maxX] = grow(Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), 14);
          const [minY, maxY] = grow(Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])), 10);
          return { minX, minY, maxX, maxY };
        })()
      : levelBounds(doc, level);
    setView(fitBoundsInset(bounds, size.w, size.h, insets));
  };

  // Пока посетитель сам не двигал карту, она вписывается заново при смене размеров и панелей.
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
    fit();
  }, [doc.venue.id, level, fitKey]);
  useEffect(() => {
    if (!touched.current) fit();
  }, [size?.w, size?.h, insetKey]);

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const places = useMemo(() => doc.places.filter((p) => p.level === level && !p.hidden), [doc, level]);
  const panoramas = useMemo(() => doc.panoramas.filter((p) => p.level === level), [doc, level]);
  const categories = useMemo(() => new Map(doc.categories.map((c) => [c.id, c])), [doc]);

  const hitTest = (screen: Vec2) => {
    const near = (p: Vec2, r: number) => {
      const s = worldToScreen(view, p);
      return Math.hypot(s[0] - screen[0], s[1] - screen[1]) <= r;
    };
    // Сверху — выбранное, потом остальные места, потом панорамы.
    const ordered = [...places].sort((a, b) => Number(b.id === selectedPlace) - Number(a.id === selectedPlace));
    const place = ordered.find((p) => near(p.pos, PLACE_HIT));
    if (place) return { kind: 'place' as const, id: place.id };
    const pano = panoramas.find((p) => near(p.pos, PANO_HIT));
    if (pano) return { kind: 'pano' as const, id: pano.id };
    return null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { moved: false, start: p };
    else gesture.current.moved = true; // второй палец — это зум, а не касание
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (pointers.current.size === 1) {
      const g = gesture.current;
      if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) > TAP_TOLERANCE) g.moved = true;
      if (g.moved) {
        touched.current = true;
        setView((v) => ({ ...v, x: v.x + p[0] - prev[0], y: v.y + p[1] - prev[1] }));
      }
      pointers.current.set(e.pointerId, p);
      return;
    }
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    pointers.current.set(e.pointerId, p);
    touched.current = true;
    if (other) setView((v) => pinchView(v, prev, p, other));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId);
    if (!had || pointers.current.size > 0 || gesture.current.moved || e.type === 'pointercancel') return;
    const screen = local(e);
    const hit = hitTest(screen);
    if (hit?.kind === 'place') props.onPlaceClick?.(hit.id);
    else if (hit?.kind === 'pano') props.onPanoramaClick?.(hit.id);
    else props.onEmptyClick?.(screenToWorld(view, screen));
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const at = local(e);
    touched.current = true;
    setView((v) => zoomAt(v, at, Math.exp(-e.deltaY * 0.0015)));
  };

  const zoomButton = (factor: number) => {
    if (!size) return;
    touched.current = true;
    const left = insets?.left ?? 0;
    const bottom = insets?.bottom ?? 0;
    setView((v) => zoomAt(v, [left + (size.w - left) / 2, (size.h - bottom) / 2], factor));
  };

  const s = (p: Vec2) => worldToScreen(view, p);
  const showPlaceNames = view.scale > 22;

  return (
    <div className="plan-wrap">
      <div
        ref={wrapRef}
        className="plan-canvas"
        style={gridStyle(view)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {size && (
          <Stage width={size.w} height={size.h} listening={false}>
            <Layer listening={false}>
              <BasePlan doc={doc} level={level} view={view} />
              <UnitLabels doc={doc} level={level} view={view} />
              {route && <RouteLine view={view} route={route} />}
            </Layer>
            <Layer listening={false}>
              {panoramas.map((p) => {
                const [x, y] = s(p.pos);
                return <PanoDot key={p.id} x={x} y={y} active={p.id === activePanorama} />;
              })}
              {fromPoint &&
                (() => {
                  const [x, y] = s(fromPoint);
                  return (
                    <>
                      <Circle x={x} y={y} radius={16} fill={FROM} opacity={0.18} />
                      <Circle x={x} y={y} radius={8} fill={FROM} stroke="#FFFFFF" strokeWidth={3} />
                    </>
                  );
                })()}
              {toPoint &&
                (() => {
                  const [x, y] = s(toPoint);
                  return (
                    <>
                      <Circle x={x} y={y} radius={16} fill={SELECTED} opacity={0.2} />
                      <Circle x={x} y={y} radius={8} fill={SELECTED} stroke="#FFFFFF" strokeWidth={3} />
                    </>
                  );
                })()}
              {[...places]
                .sort((a, b) => Number(a.id === selectedPlace) - Number(b.id === selectedPlace))
                .map((p) => {
                  const [x, y] = s(p.pos);
                  const cat = categories.get(p.category);
                  return (
                    <PlacePin
                      key={p.id}
                      x={x}
                      y={y}
                      color={cat?.color ?? '#4A5568'}
                      icon={cat?.icon ?? ''}
                      name={p.name}
                      selected={p.id === selectedPlace}
                      showLabel={showPlaceNames}
                      dim={!!category && p.category !== category && p.id !== selectedPlace}
                    />
                  );
                })}
            </Layer>
          </Stage>
        )}
      </div>
      <div
        className="map-controls"
        style={{ bottom: (insets?.bottom ?? 0) + 16, display: freeHeight < FIT_ROOM ? 'none' : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {freeHeight >= ZOOM_ROOM && (
          <>
            <button type="button" className="map-ctl" aria-label="Приблизить" onClick={() => zoomButton(1.4)}>
              <Icon name="plus" />
            </button>
            <button type="button" className="map-ctl" aria-label="Отдалить" onClick={() => zoomButton(1 / 1.4)}>
              <Icon name="minus" />
            </button>
          </>
        )}
        <button
          type="button"
          className="map-ctl"
          aria-label="Показать всё"
          onClick={() => {
            touched.current = false;
            fit();
          }}
        >
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}
