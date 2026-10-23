import type { MapDocument, Vec2 } from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Circle, Group, Layer, Line, Stage, Text } from 'react-konva';
import { categoryIcon, PANORAMA, ROUTE, ROUTE_CASING, SELECTED, UNIT_FILL, WALL } from './style.ts';
import { fitBounds, levelBounds, polygonCentroid, screenToWorld, worldToScreen, zoomAt, type Viewport } from './viewport.ts';

export interface PlanCanvasProps {
  doc: MapDocument;
  level: string;
  route?: Vec2[] | null;
  selectedPlace?: string | null;
  activePanorama?: string | null;
  fromPoint?: Vec2 | null;
  /** Сколько пикселей снизу закрыто шторкой — «показать всё» вписывает план выше. */
  bottomInset?: number;
  /** Смена значения — снова «показать всё». */
  fitKey?: number;
  onPlaceClick?: (id: string) => void;
  onPanoramaClick?: (id: string) => void;
  onEmptyClick?: (world: Vec2) => void;
}

const TAP_TOLERANCE = 6;

export function PlanCanvas(props: PlanCanvasProps) {
  const { doc, level, route, selectedPlace, activePanorama, fromPoint, bottomInset = 0, fitKey = 0 } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<Viewport>({ scale: 20, x: 0, y: 0 });

  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef({ moved: false, start: [0, 0] as Vec2 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size) return;
    setView(fitBounds(levelBounds(doc, level), size.w, Math.max(size.h - bottomInset, 120)));
    // Перевписываем только при смене карты, этажа, размера или по явному запросу.
  }, [doc.venue.id, level, size?.w, size?.h, bottomInset, fitKey]);

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { moved: false, start: p };
    else gesture.current.moved = true; // второй палец — это зум, а не тап
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (pointers.current.size === 1) {
      const g = gesture.current;
      if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) > TAP_TOLERANCE) g.moved = true;
      if (g.moved) setView((v) => ({ ...v, x: v.x + p[0] - prev[0], y: v.y + p[1] - prev[1] }));
      pointers.current.set(e.pointerId, p);
      return;
    }
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId);
    const other = others[0]?.[1];
    pointers.current.set(e.pointerId, p);
    if (!other) return;
    const before = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
    const after = Math.hypot(p[0] - other[0], p[1] - other[1]);
    const midBefore: Vec2 = [(prev[0] + other[0]) / 2, (prev[1] + other[1]) / 2];
    const midAfter: Vec2 = [(p[0] + other[0]) / 2, (p[1] + other[1]) / 2];
    if (before > 0) {
      setView((v) => {
        const zoomed = zoomAt(v, midBefore, after / before);
        return { ...zoomed, x: zoomed.x + midAfter[0] - midBefore[0], y: zoomed.y + midAfter[1] - midBefore[1] };
      });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const at = local(e);
    setView((v) => zoomAt(v, at, Math.exp(-e.deltaY * 0.0015)));
  };

  // Konva шлёт click/tap после pointerup, поэтому «был ли сдвиг» берём из жеста.
  // На тач-экране одно касание может прийти и как tap, и как click — второе отбрасываем.
  const lastTap = useRef(0);
  const once = () => {
    const now = performance.now();
    if (now - lastTap.current < 400) return false;
    lastTap.current = now;
    return true;
  };
  const tap = (fn?: () => void) => () => {
    if (!gesture.current.moved && once()) fn?.();
  };

  const onStageTap = (e: { target: unknown; currentTarget: unknown; evt: { clientX?: number; clientY?: number; changedTouches?: TouchList } }) => {
    if (e.target !== e.currentTarget || gesture.current.moved) return; // попали в фигуру или двигали карту
    if (!once()) return;
    const touch = e.evt.changedTouches?.[0];
    const point = touch ?? (e.evt as { clientX: number; clientY: number });
    props.onEmptyClick?.(screenToWorld(view, local(point)));
  };

  const s = (p: Vec2) => worldToScreen(view, p);
  const flat = (pts: Vec2[]) => pts.flatMap((p) => s(p));

  const units = useMemo(() => doc.units.filter((u) => u.level === level), [doc, level]);
  const categories = useMemo(() => new Map(doc.categories.map((c) => [c.id, c])), [doc]);
  const showLabels = view.scale > 14;
  const showPlaceNames = view.scale > 24;

  return (
    <div
      ref={wrapRef}
      className="plan-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {size && (
        <Stage width={size.w} height={size.h} onClick={onStageTap} onTap={onStageTap}>
          <Layer listening={false}>
            {units.map((u) => (
              <Line key={u.id} points={flat(u.polygon)} closed fill={UNIT_FILL[u.kind]} stroke={WALL} strokeWidth={2} />
            ))}
            {doc.openings
              .filter((o) => o.level === level)
              .map((o) => (
                <Line key={o.id} points={flat(o.segment)} stroke="#FFFFFF" strokeWidth={5} lineCap="butt" />
              ))}
            {doc.obstacles
              .filter((o) => o.level === level)
              .map((o) => (
                <Line key={o.id} points={flat(o.polygon)} closed fill="#CBD5E1" stroke="#94A3B8" strokeWidth={1} />
              ))}
            {showLabels &&
              units.map((u) => {
                const [x, y] = s(polygonCentroid(u.polygon));
                return (
                  <Text key={`l-${u.id}`} x={x - 60} y={y - 7} width={120} align="center" text={u.name} fontSize={12} fill="#475569" />
                );
              })}
            {route && route.length > 1 && (
              <>
                <Line points={flat(route)} stroke={ROUTE_CASING} strokeWidth={10} lineCap="round" lineJoin="round" />
                <Line points={flat(route)} stroke={ROUTE} strokeWidth={5} lineCap="round" lineJoin="round" />
              </>
            )}
          </Layer>
          <Layer>
            {doc.panoramas
              .filter((p) => p.level === level)
              .map((p) => {
                const [x, y] = s(p.pos);
                const active = p.id === activePanorama;
                return (
                  <Circle
                    key={p.id}
                    x={x}
                    y={y}
                    radius={active ? 9 : 7}
                    fill={PANORAMA}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    hitStrokeWidth={20}
                    onClick={tap(() => props.onPanoramaClick?.(p.id))}
                    onTap={tap(() => props.onPanoramaClick?.(p.id))}
                  />
                );
              })}
            {fromPoint && (() => {
              const [x, y] = s(fromPoint);
              return <Circle x={x} y={y} radius={8} fill="#16A34A" stroke="#FFFFFF" strokeWidth={3} listening={false} />;
            })()}
            {doc.places
              .filter((p) => p.level === level && !p.hidden)
              .map((p) => {
                const [x, y] = s(p.pos);
                const cat = categories.get(p.category);
                const selected = p.id === selectedPlace;
                const r = selected ? 17 : 13;
                return (
                  <Group
                    key={p.id}
                    x={x}
                    y={y}
                    onClick={tap(() => props.onPlaceClick?.(p.id))}
                    onTap={tap(() => props.onPlaceClick?.(p.id))}
                  >
                    <Circle radius={r} fill="#FFFFFF" stroke={selected ? SELECTED : (cat?.color ?? WALL)} strokeWidth={selected ? 4 : 2.5} hitStrokeWidth={16} />
                    <Text x={-r} y={-8} width={2 * r} align="center" text={categoryIcon(cat?.icon ?? '')} fontSize={selected ? 17 : 14} listening={false} />
                    {(showPlaceNames || selected) && (
                      <Text x={-70} y={r + 3} width={140} align="center" text={p.name} fontSize={11} fontStyle="bold" fill="#1E293B" listening={false} />
                    )}
                  </Group>
                );
              })}
          </Layer>
        </Stage>
      )}
      <button
        type="button"
        className="plan-fit"
        aria-label="Показать всё"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => size && setView(fitBounds(levelBounds(doc, level), size.w, Math.max(size.h - bottomInset, 120)))}
      >
        ⤢
      </button>
    </div>
  );
}
