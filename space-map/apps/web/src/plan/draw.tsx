// Общая отрисовка плана для карты посетителя и редактора (один код — ТЗ 4.1).
// Фигуры рисуются в экранных координатах: толщина линий и размер значков не зависят от зума.
import { doorLeaves, doorStyleOf, type DoorLeaf, type MapDocument, type Vec2 } from '@space-map/map-core';
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { Circle, Group, Line, Path, Text } from 'react-konva';
import { categoryIconPath, ICON_PATHS } from '../ui/icons.tsx';
import {
  CAPTURE,
  DOOR,
  ENTRANCE,
  LABEL,
  OBSTACLE_FILL,
  OBSTACLE_STROKE,
  PANORAMA,
  PLAN_BG,
  ROUTE,
  ROUTE_CASING,
  SELECTED,
  UNIT_FILL,
  WALL,
  WALL_WIDTH,
} from './style.ts';
import { worldToScreen, zoomAt, type Viewport } from './viewport.ts';

export const flatPoints = (view: Viewport, pts: Vec2[]) => pts.flatMap((p) => worldToScreen(view, p));

/** Размер контейнера для Stage. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Точечная сетка под планом — 1 м, а при мелком масштабе 5 м. Рисуется фоном CSS, а не фигурами. */
export function gridStyle(view: Viewport): CSSProperties {
  const step = view.scale >= 14 ? view.scale : view.scale * 5;
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${view.x % step}px ${view.y % step}px`,
  };
}

/** Зум и сдвиг двумя пальцами: точка между пальцами остаётся под ними. */
export function pinchView(v: Viewport, prev: Vec2, next: Vec2, other: Vec2): Viewport {
  const before = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
  const after = Math.hypot(next[0] - other[0], next[1] - other[1]);
  if (before <= 0) return v;
  const midBefore: Vec2 = [(prev[0] + other[0]) / 2, (prev[1] + other[1]) / 2];
  const midAfter: Vec2 = [(next[0] + other[0]) / 2, (next[1] + other[1]) / 2];
  const zoomed = zoomAt(v, midBefore, after / before);
  return { ...zoomed, x: zoomed.x + midAfter[0] - midBefore[0], y: zoomed.y + midAfter[1] - midBefore[1] };
}

export interface BasePlanProps {
  doc: MapDocument;
  level: string;
  view: Viewport;
  /** Подсвеченное помещение (редактор). */
  selectedUnit?: string | null;
  hoverUnit?: string | null;
  selectedOpening?: string | null;
  /** Выбранный вырез: `${unitId}#${номер}`. */
  selectedHole?: string | null;
  /** Помещения, которые нельзя поставить (пересечение) — красная заливка. */
  invalidUnit?: string | null;
}

/** Полы, стены, проходы и препятствия. */
export function BasePlan({ doc, level, view, selectedUnit, hoverUnit, selectedOpening, selectedHole, invalidUnit }: BasePlanProps) {
  const units = doc.units.filter((u) => u.level === level);
  const flat = (pts: Vec2[]) => flatPoints(view, pts);
  const doorWidth = WALL_WIDTH + 3;
  return (
    <>
      {units.map((u) => (
        <Line
          key={u.id}
          points={flat(u.polygon)}
          closed
          fill={u.id === invalidUnit ? '#FDE2E2' : UNIT_FILL[u.kind]}
          stroke={WALL}
          strokeWidth={WALL_WIDTH}
          lineJoin="miter"
          perfectDrawEnabled={false}
        />
      ))}
      {/* Вырезы: внутри — не помещение (колонна, шахта, перегородка), вокруг — стены */}
      {units.flatMap((u) =>
        (u.holes ?? []).map((h, i) => {
          const key = `${u.id}#${i}`;
          const selected = key === selectedHole;
          return (
            <Line
              key={`hole-${key}`}
              points={flat(h)}
              closed
              fill={selected ? 'rgba(47,91,234,0.12)' : PLAN_BG}
              stroke={selected ? ROUTE : WALL}
              strokeWidth={selected ? WALL_WIDTH + 1 : WALL_WIDTH}
              lineJoin="miter"
              perfectDrawEnabled={false}
            />
          );
        }),
      )}
      {doc.obstacles
        .filter((o) => o.level === level)
        .map((o) => (
          <Line key={o.id} points={flat(o.polygon)} closed fill={OBSTACLE_FILL} stroke={OBSTACLE_STROKE} strokeWidth={1} perfectDrawEnabled={false} />
        ))}
      {doc.openings
        .filter((o) => o.level === level)
        .map((o) => {
          const [a, b] = o.segment.map((p) => worldToScreen(view, p)) as [Vec2, Vec2];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const n: Vec2 = [(-(b[1] - a[1]) / len) * 5, ((b[0] - a[0]) / len) * 5];
          const selected = o.id === selectedOpening;
          return (
            <Group key={o.id}>
              <Line points={[...a, ...b]} stroke={o.kind === 'entrance' ? ENTRANCE : DOOR} strokeWidth={o.kind === 'entrance' ? doorWidth + 1 : doorWidth} lineCap="butt" />
              {/* Косяки — короткие засечки поперёк стены */}
              {o.kind !== 'entrance' && (
                <>
                  <Line points={[a[0] - n[0], a[1] - n[1], a[0] + n[0], a[1] + n[1]]} stroke={WALL} strokeWidth={2} lineCap="round" />
                  <Line points={[b[0] - n[0], b[1] - n[1], b[0] + n[0], b[1] + n[1]]} stroke={WALL} strokeWidth={2} lineCap="round" />
                </>
              )}
              {/* Створки, как на архитектурном плане: полотно и дуга открывания */}
              {(() => {
                const style = doorStyleOf(doc, o);
                return style ? doorLeaves(o, style).map((leaf, i) => <DoorLeafShape key={i} leaf={leaf} view={view} />) : null;
              })()}
              {selected && <Line points={[...a, ...b]} stroke={SELECTED} strokeWidth={doorWidth + 4} opacity={0.55} lineCap="round" />}
            </Group>
          );
        })}
      {units
        .filter((u) => u.id === selectedUnit || u.id === hoverUnit)
        .map((u) => (
          <Line
            key={`sel-${u.id}`}
            points={flat(u.polygon)}
            closed
            stroke={u.id === invalidUnit ? '#E5484D' : u.id === selectedUnit ? ROUTE : '#7C93E8'}
            strokeWidth={u.id === selectedUnit ? 3 : 2}
            dash={u.id === selectedUnit ? undefined : [6, 4]}
            fill={u.id === selectedUnit ? 'rgba(47,91,234,0.06)' : undefined}
            listening={false}
          />
        ))}
    </>
  );
}

/** Названия помещений — в левом верхнем углу, как на архитектурном плане: центр остаётся местам. */
/** Створка двери: полотно от петли и тонкая дуга, по которой оно открывается. */
function DoorLeafShape({ leaf, view }: { leaf: DoorLeaf; view: Viewport }) {
  const [hx, hy] = worldToScreen(view, leaf.hinge);
  const [tx, ty] = worldToScreen(view, leaf.openTip);
  // Дуга от закрытого положения к открытому: точки по окружности вокруг петли.
  const start = Math.atan2(leaf.closedTip[1] - leaf.hinge[1], leaf.closedTip[0] - leaf.hinge[0]);
  let sweep = leaf.angle - start;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.12));
  const arc: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (sweep * i) / steps;
    arc.push(...worldToScreen(view, [leaf.hinge[0] + Math.cos(t) * leaf.length, leaf.hinge[1] + Math.sin(t) * leaf.length]));
  }
  return (
    <>
      {Math.abs(sweep) > 0.02 && <Line points={arc} stroke={WALL} strokeWidth={1} opacity={0.55} dash={[3, 3]} listening={false} />}
      <Line points={[hx, hy, tx, ty]} stroke={WALL} strokeWidth={2.2} lineCap="round" listening={false} />
    </>
  );
}

export function UnitLabels({ doc, level, view, extra }: { doc: MapDocument; level: string; view: Viewport; extra?: (unitId: string) => string | null }) {
  if (view.scale < 12) return null;
  return (
    <>
      {doc.units
        .filter((u) => u.level === level)
        .map((u) => {
          const minX = Math.min(...u.polygon.map((p) => p[0]));
          const maxX = Math.max(...u.polygon.map((p) => p[0]));
          const maxY = Math.max(...u.polygon.map((p) => p[1]));
          const [x, y] = worldToScreen(view, [minX, maxY]);
          const width = (maxX - minX) * view.scale - 16;
          if (width < 40) return null;
          const sub = extra?.(u.id);
          return (
            <Group key={`l-${u.id}`} x={x + 9} y={y + 8} listening={false}>
              <Text
                width={width}
                text={u.name.toUpperCase()}
                fontSize={10.5}
                fontStyle="700"
                letterSpacing={0.6}
                fill={LABEL}
                wrap="none"
                ellipsis
                fontFamily="Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
              />
              {sub && <Text y={15} width={width} text={sub} fontSize={11} fill="#2F5BEA" fontStyle="600" fontFamily="Inter, system-ui, sans-serif" />}
            </Group>
          );
        })}
    </>
  );
}

export function RouteLine({ view, route }: { view: Viewport; route: Vec2[] }) {
  if (route.length < 2) return null;
  const pts = flatPoints(view, route);
  return (
    <>
      <Line points={pts} stroke={ROUTE_CASING} strokeWidth={11} lineCap="round" lineJoin="round" listening={false} />
      <Line points={pts} stroke={ROUTE} strokeWidth={5.5} lineCap="round" lineJoin="round" listening={false} />
      <Line points={pts} stroke="#FFFFFF" strokeWidth={1.6} dash={[2, 9]} lineCap="round" lineJoin="round" opacity={0.9} listening={false} />
    </>
  );
}

const FONT = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Значок места: круг цвета категории с иконкой и подпись с белым ореолом. */
export function PlacePin(props: { x: number; y: number; color: string; icon: string; name: string; selected?: boolean; showLabel?: boolean; dim?: boolean }) {
  const { x, y, color, icon, name, selected, showLabel, dim } = props;
  const r = selected ? 16 : 12.5;
  const s = (r * 1.15) / 24;
  return (
    <Group x={x} y={y} opacity={dim ? 0.35 : 1} listening={false}>
      {selected && <Circle radius={r + 9} fill={color} opacity={0.18} />}
      <Circle radius={r} fill={color} stroke="#FFFFFF" strokeWidth={2.5} shadowColor="#0E1726" shadowBlur={6} shadowOpacity={0.25} shadowOffsetY={1.5} />
      <Path data={categoryIconPath(icon)} x={-12 * s} y={-12 * s} scaleX={s} scaleY={s} stroke="#FFFFFF" strokeWidth={2.2} lineCap="round" lineJoin="round" />
      {(showLabel || selected) && (
        <Text
          x={-80}
          y={r + 4}
          width={160}
          align="center"
          text={name}
          fontSize={selected ? 12.5 : 11.5}
          fontStyle="600"
          fill="#1A2433"
          stroke="#FFFFFF"
          strokeWidth={3.5}
          fillAfterStrokeEnabled
          fontFamily={FONT}
        />
      )}
    </Group>
  );
}

export function PanoDot({ x, y, active }: { x: number; y: number; active?: boolean }) {
  const r = active ? 10 : 8;
  const s = (r * 1.2) / 24;
  return (
    <Group x={x} y={y} listening={false}>
      <Circle radius={r + 4} fill={PANORAMA} opacity={0.18} />
      <Circle radius={r} fill={PANORAMA} stroke="#FFFFFF" strokeWidth={2} />
      <Path data={ICON_PATHS.pano} x={-12 * s} y={-12 * s} scaleX={s} scaleY={s} stroke="#FFFFFF" strokeWidth={2.4} />
    </Group>
  );
}

/** Маршрут съёмки: пунктир от точки к точке по проходимым местам. */
export function CaptureRouteLine({ view, legs }: { view: Viewport; legs: Vec2[][] }) {
  return (
    <>
      {legs.map((leg, i) =>
        leg.length < 2 ? null : (
          <Group key={i} listening={false}>
            <Line points={flatPoints(view, leg)} stroke="#FFFFFF" strokeWidth={6} lineCap="round" lineJoin="round" opacity={0.8} />
            <Line points={flatPoints(view, leg)} stroke={CAPTURE} strokeWidth={2.5} dash={[7, 6]} lineCap="round" lineJoin="round" />
          </Group>
        ),
      )}
    </>
  );
}

/**
 * Точка съёмки панорамы: номер в порядке обхода. Рассчитанная — пунктирное кольцо (предложение),
 * поставленная вручную — сплошная заливка; снятая — галочка.
 */
export function CapturePointMark(props: { x: number; y: number; label: string; origin: 'auto' | 'manual'; shot: boolean; selected?: boolean }) {
  const { x, y, label, origin, shot, selected } = props;
  const r = selected ? 13 : 11;
  const filled = origin === 'manual' || shot;
  const s = 13 / 24;
  return (
    <Group x={x} y={y} listening={false}>
      {selected && <Circle radius={r + 6} fill={SELECTED} opacity={0.22} />}
      <Circle
        radius={r}
        fill={filled ? CAPTURE : '#FFFFFF'}
        stroke={selected ? SELECTED : CAPTURE}
        strokeWidth={selected ? 3 : 2.2}
        dash={filled ? undefined : [4, 3]}
        shadowColor="#0E1726"
        shadowBlur={4}
        shadowOpacity={0.18}
      />
      {shot ? (
        <Path data={ICON_PATHS.check} x={-12 * s} y={-12 * s} scaleX={s} scaleY={s} stroke="#FFFFFF" strokeWidth={3.2} />
      ) : (
        <Text text={label} x={-r} y={-6.5} width={r * 2} align="center" fontSize={12} fontStyle="700" fontFamily={FONT} fill={filled ? '#FFFFFF' : CAPTURE} />
      )}
    </Group>
  );
}
