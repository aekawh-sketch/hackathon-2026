// Холст редактора: выбор, перетаскивание помещений и мест, вершины, рисование комнат, двери.
// Жесты свои (Pointer Events), Konva только рисует: одинаково работает мышью, пером и пальцем.
import {
  addDoor,
  addPlace,
  createRoom,
  GRID,
  isAxisRect,
  movePlace,
  overlappingUnits,
  pointInPolygon,
  pointSegmentDistance,
  polygonArea,
  polygonBounds,
  rectPolygon,
  setUnitPolygon,
  sharedWalls,
  snap,
  snapPoint,
  translateUnit,
  unitAt,
  type MapDocument,
  type Vec2,
} from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Layer, Line, Rect, Stage, Text } from 'react-konva';
import { BasePlan, flatPoints, gridStyle, PanoDot, pinchView, PlacePin, UnitLabels, useElementSize } from '../plan/draw.tsx';
import { ROUTE } from '../plan/style.ts';
import { fitBoundsInset, levelBounds, screenToWorld, worldToScreen, zoomAt, type Insets, type Viewport } from '../plan/viewport.ts';
import { Icon } from '../ui/icons.tsx';

export type Tool = 'select' | 'room' | 'place' | 'door';
export type Selection = { kind: 'unit' | 'place' | 'opening'; id: string } | null;

export interface EditorCanvasProps {
  doc: MapDocument;
  level: string;
  tool: Tool;
  selection: Selection;
  showGraph: boolean;
  placeCategory: string;
  insets: Insets;
  fitKey: number;
  onSelect: (s: Selection) => void;
  onCommit: (doc: MapDocument, select?: Selection) => void;
  onToolDone: () => void;
  onToast: (message: string) => void;
}

type Drag =
  | { kind: 'pan' }
  | { kind: 'tap' }
  | { kind: 'unit'; id: string; start: Vec2 }
  | { kind: 'vertex'; id: string; index: number; original: Vec2[] }
  | { kind: 'place'; id: string; start: Vec2; origin: Vec2 }
  | { kind: 'draw'; start: Vec2 };

interface Preview {
  doc?: MapDocument;
  invalidUnit?: string | null;
  draft?: { polygon: Vec2[]; invalid: boolean } | null;
}

const TAP = 7;

export function EditorCanvas(props: EditorCanvasProps) {
  const { doc, level, tool, selection, showGraph, insets } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapRef);
  const [view, setView] = useState<Viewport>({ scale: 20, x: 0, y: 0 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const drag = useRef<{ mode: Drag; startScreen: Vec2; moved: boolean; pointerId: number } | null>(null);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, []);
  const handleR = coarse ? 13 : 8;

  const insetKey = `${insets.top ?? 0}:${insets.right ?? 0}:${insets.bottom ?? 0}:${insets.left ?? 0}`;
  const fit = () => size && setView(fitBoundsInset(levelBounds(doc, level), size.w, size.h, insets, 40));
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
    fit();
  }, [level, props.fitKey]);
  useEffect(() => {
    if (!touched.current) fit();
  }, [size?.w, size?.h, insetKey]);

  const shown = preview?.doc ?? doc;
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toWorld = (s: Vec2) => screenToWorld(view, s);
  const toScreen = (w: Vec2) => worldToScreen(view, w);
  const selectedUnit = selection?.kind === 'unit' ? doc.units.find((u) => u.id === selection.id) : undefined;

  // ── Попадания ──
  const hitVertex = (s: Vec2) => {
    if (!selectedUnit) return -1;
    return selectedUnit.polygon.findIndex((p) => {
      const q = toScreen(p);
      return Math.hypot(q[0] - s[0], q[1] - s[1]) <= handleR + 6;
    });
  };
  const hitPlace = (s: Vec2) =>
    [...doc.places]
      .filter((p) => p.level === level)
      .sort((a, b) => Number(b.id === selection?.id) - Number(a.id === selection?.id))
      .find((p) => {
        const q = toScreen(p.pos);
        return Math.hypot(q[0] - s[0], q[1] - s[1]) <= 20;
      });
  const hitOpening = (s: Vec2) => {
    const w = toWorld(s);
    const tol = 10 / view.scale;
    return doc.openings.find((o) => o.level === level && pointSegmentDistance(w, o.segment[0], o.segment[1]) <= tol);
  };
  const hitUnit = (s: Vec2) => {
    const w = toWorld(s);
    const hits = doc.units.filter((u) => u.level === level && pointInPolygon(w, u.polygon));
    return hits.sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0];
  };

  // ── Предпросмотр ──
  const previewKey = useRef('');
  const updatePreview = (key: string, make: () => Preview | null) => {
    if (key === previewKey.current) return;
    previewKey.current = key;
    setPreview(make());
  };
  const clearPreview = () => {
    previewKey.current = '';
    setPreview(null);
  };

  const dragTo = (d: Drag, s: Vec2) => {
    const w = toWorld(s);
    if (d.kind === 'unit') {
      const delta: Vec2 = [snap(w[0] - d.start[0]), snap(w[1] - d.start[1])];
      updatePreview(`u:${delta}`, () => {
        if (delta[0] === 0 && delta[1] === 0) return null;
        const next = translateUnit(doc, d.id, delta);
        const unit = next.units.find((u) => u.id === d.id)!;
        const bad = overlappingUnits(next, level, unit.polygon, d.id).length > 0;
        return { doc: next, invalidUnit: bad ? d.id : null };
      });
    } else if (d.kind === 'vertex') {
      const p = snapPoint(w);
      const poly = reshape(d.original, d.index, p);
      updatePreview(`v:${p}`, () => {
        if (!poly) return { invalidUnit: d.id };
        const next = setUnitPolygon(doc, d.id, poly);
        const bad = next === doc || overlappingUnits(next, level, poly, d.id).length > 0;
        return { doc: next, invalidUnit: bad ? d.id : null };
      });
    } else if (d.kind === 'place') {
      const p = snapPoint([d.origin[0] + w[0] - d.start[0], d.origin[1] + w[1] - d.start[1]], GRID / 2);
      updatePreview(`p:${p}`, () => ({ doc: movePlace(doc, d.id, p) }));
    } else if (d.kind === 'draw') {
      const p = snapPoint(w);
      const polygon = rectPolygon(d.start, p);
      updatePreview(`d:${p}`, () => {
        const b = polygonBounds(polygon);
        const small = b.maxX - b.minX < 1 || b.maxY - b.minY < 1;
        return { draft: { polygon, invalid: small || overlappingUnits(doc, level, polygon).length > 0 } };
      });
    }
  };

  const finish = (d: Drag, moved: boolean, s: Vec2) => {
    const w = toWorld(s);
    const p = preview;
    clearPreview();
    if (!moved) return tapAt(d, s, w);
    if (d.kind === 'unit' || d.kind === 'vertex') {
      if (!p?.doc) return;
      if (p.invalidUnit) return props.onToast('Помещения не должны пересекаться — вернул на место');
      props.onCommit(p.doc, { kind: 'unit', id: d.id });
    } else if (d.kind === 'place') {
      if (!p?.doc) return;
      const place = p.doc.places.find((x) => x.id === d.id)!;
      if (!unitAt(p.doc, level, place.pos)) return props.onToast('Место должно стоять внутри помещения');
      props.onCommit(p.doc, { kind: 'place', id: d.id });
    } else if (d.kind === 'draw') {
      const draft = p?.draft;
      if (!draft) return;
      if (draft.invalid) return props.onToast('Комната меньше 1 м или налезает на другое помещение');
      const created = createRoom(doc, level, draft.polygon);
      const doors = created.doc.openings.filter((o) => (o.units as readonly string[]).includes(created.id)).length;
      props.onCommit(created.doc, { kind: 'unit', id: created.id });
      props.onToast(doors > 0 ? 'Комната создана, дверь поставлена автоматически' : 'Комната создана. Поставьте дверь: инструмент «Дверь»');
      props.onToolDone();
    }
  };

  const tapAt = (d: Drag, s: Vec2, w: Vec2) => {
    if (tool === 'room') return props.onToast('Проведите пальцем или мышью, чтобы нарисовать комнату');
    if (tool === 'place') {
      const unit = unitAt(doc, level, w);
      if (!unit || !unit.walkable) return props.onToast('Нажмите внутри помещения');
      const created = addPlace(doc, level, snapPoint(w, GRID / 2), props.placeCategory);
      props.onCommit(created.doc, { kind: 'place', id: created.id });
      props.onToolDone();
      return;
    }
    if (tool === 'door') {
      const tol = 0.8;
      const near = doc.units.filter(
        (u) => u.level === level && u.polygon.some((_, i) => pointSegmentDistance(w, u.polygon[i]!, u.polygon[(i + 1) % u.polygon.length]!) < tol),
      );
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i]!;
          const b = near[j]!;
          const walls = sharedWalls(a.polygon, b.polygon).filter(([p, q]) => pointSegmentDistance(w, p, q) < tol);
          if (walls.length === 0) continue;
          const next = addDoor(doc, a.id, b.id, w);
          if (next === doc) continue;
          const door = next.openings[next.openings.length - 1]!;
          props.onCommit(next, { kind: 'opening', id: door.id });
          return props.onToast(`Дверь: ${a.name} ↔ ${b.name}`);
        }
      }
      return props.onToast('Нажмите на общую стену двух помещений');
    }
    if (d.kind === 'place') return props.onSelect({ kind: 'place', id: d.id });
    const opening = hitOpening(s);
    if (opening) return props.onSelect({ kind: 'opening', id: opening.id });
    if (d.kind === 'unit') return props.onSelect({ kind: 'unit', id: d.id });
    props.onSelect(null);
  };

  // ── Указатель ──
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size > 1) {
      // Второй палец — отменяем начатое действие, дальше только зум.
      clearPreview();
      if (drag.current) drag.current = { ...drag.current, mode: { kind: 'pan' }, moved: true };
      return;
    }
    const w = toWorld(s);
    let mode: Drag = { kind: 'pan' };
    if (tool === 'room') mode = { kind: 'draw', start: snapPoint(w) };
    else if (tool === 'select') {
      const v = hitVertex(s);
      const place = hitPlace(s);
      const opening = hitOpening(s);
      const unit = hitUnit(s);
      if (v >= 0 && selectedUnit) mode = { kind: 'vertex', id: selectedUnit.id, index: v, original: selectedUnit.polygon };
      else if (place) mode = { kind: 'place', id: place.id, start: w, origin: place.pos };
      else if (opening) mode = { kind: 'tap' };
      else if (unit) mode = { kind: 'unit', id: unit.id, start: w };
    }
    drag.current = { mode, startScreen: s, moved: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      // Наведение мышью — подсветка помещения.
      if (tool === 'select' && e.pointerType === 'mouse') {
        const u = hitUnit(s);
        setHover(u?.id ?? null);
      }
      return;
    }
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size > 1) {
      touched.current = true;
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) setView((v) => pinchView(v, prev, s, other));
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(s[0] - d.startScreen[0], s[1] - d.startScreen[1]) > TAP) d.moved = true;
    if (!d.moved) return;
    if (d.mode.kind === 'pan' || d.mode.kind === 'tap') {
      touched.current = true;
      setView((v) => ({ ...v, x: v.x + s[0] - prev[0], y: v.y + s[1] - prev[1] }));
      return;
    }
    if (d.mode.kind === 'unit' && selection?.id !== d.mode.id) props.onSelect({ kind: 'unit', id: d.mode.id });
    dragTo(d.mode, s);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!had || !d || d.pointerId !== e.pointerId) {
      if (pointers.current.size === 0) drag.current = null;
      return;
    }
    drag.current = null;
    if (e.type === 'pointercancel') return clearPreview();
    finish(d.mode, d.moved, local(e));
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const at = local(e);
    touched.current = true;
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) setView((v) => zoomAt(v, at, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  // ── Отрисовка ──
  const categories = useMemo(() => new Map(shown.categories.map((c) => [c.id, c])), [shown]);
  const shownSelected = selectedUnit ? shown.units.find((u) => u.id === selectedUnit.id) : undefined;
  const dims = (unitId: string) => {
    if (unitId !== selection?.id) return null;
    const u = shown.units.find((x) => x.id === unitId);
    if (!u) return null;
    if (isAxisRect(u.polygon)) {
      const b = polygonBounds(u.polygon);
      return `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} м`;
    }
    return `${fmt(polygonArea(u.polygon))} м²`;
  };
  const cursor =
    tool === 'room' ? 'crosshair' : tool === 'place' || tool === 'door' ? 'copy' : hover ? 'move' : 'grab';

  return (
    <div className="plan-wrap">
      <div
        ref={wrapRef}
        className={`plan-canvas editor-canvas tool-${tool}`}
        style={{ ...gridStyle(view), cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
      >
        {size && (
          <Stage width={size.w} height={size.h} listening={false}>
            <Layer listening={false}>
              <BasePlan
                doc={shown}
                level={level}
                view={view}
                selectedUnit={selection?.kind === 'unit' ? selection.id : null}
                hoverUnit={tool === 'select' ? hover : null}
                selectedOpening={selection?.kind === 'opening' ? selection.id : null}
                invalidUnit={preview?.invalidUnit ?? null}
              />
              <UnitLabels doc={shown} level={level} view={view} extra={dims} />
              {showGraph &&
                shown.graph.edges.map((e) => {
                  const a = shown.graph.nodes.find((n) => n.id === e.from);
                  const b = shown.graph.nodes.find((n) => n.id === e.to);
                  if (!a || !b || a.level !== level) return null;
                  return <Line key={e.id} points={flatPoints(view, [a.pos, b.pos])} stroke={ROUTE} strokeWidth={1.2} opacity={0.45} dash={[4, 4]} />;
                })}
              {preview?.draft && (
                <>
                  <Line
                    points={flatPoints(view, preview.draft.polygon)}
                    closed
                    fill={preview.draft.invalid ? 'rgba(229,72,77,0.12)' : 'rgba(47,91,234,0.10)'}
                    stroke={preview.draft.invalid ? '#E5484D' : ROUTE}
                    strokeWidth={2.5}
                    dash={[8, 5]}
                  />
                  {(() => {
                    const b = polygonBounds(preview.draft.polygon);
                    const [x, y] = toScreen([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
                    return (
                      <Text
                        x={x - 60}
                        y={y - 8}
                        width={120}
                        align="center"
                        text={`${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} м`}
                        fontSize={13}
                        fontStyle="600"
                        fill={preview.draft.invalid ? '#B42318' : '#1E46C7'}
                        stroke="#FFFFFF"
                        strokeWidth={3}
                        fillAfterStrokeEnabled
                      />
                    );
                  })()}
                </>
              )}
            </Layer>
            <Layer listening={false}>
              {shown.panoramas
                .filter((p) => p.level === level)
                .map((p) => {
                  const [x, y] = toScreen(p.pos);
                  return <PanoDot key={p.id} x={x} y={y} />;
                })}
              {shown.places
                .filter((p) => p.level === level)
                .map((p) => {
                  const [x, y] = toScreen(p.pos);
                  const cat = categories.get(p.category);
                  return (
                    <PlacePin
                      key={p.id}
                      x={x}
                      y={y}
                      color={cat?.color ?? '#4A5568'}
                      icon={cat?.icon ?? ''}
                      name={p.name}
                      selected={selection?.kind === 'place' && selection.id === p.id}
                      showLabel={view.scale > 22}
                      dim={p.hidden}
                    />
                  );
                })}
              {shownSelected &&
                tool === 'select' &&
                shownSelected.polygon.map((p, i) => {
                  const [x, y] = toScreen(p);
                  return (
                    <Rect
                      key={i}
                      x={x - handleR}
                      y={y - handleR}
                      width={handleR * 2}
                      height={handleR * 2}
                      cornerRadius={4}
                      fill="#FFFFFF"
                      stroke={ROUTE}
                      strokeWidth={2.5}
                      shadowColor="#0E1726"
                      shadowBlur={4}
                      shadowOpacity={0.2}
                    />
                  );
                })}
            </Layer>
          </Stage>
        )}
      </div>
      <div className="map-controls" style={{ bottom: (insets.bottom ?? 0) + 16, right: (insets.right ?? 0) + 16 }} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="map-ctl" aria-label="Приблизить" onClick={() => size && setView((v) => zoomAt(v, [size.w / 2, size.h / 2], 1.4))}>
          <Icon name="plus" />
        </button>
        <button type="button" className="map-ctl" aria-label="Отдалить" onClick={() => size && setView((v) => zoomAt(v, [size.w / 2, size.h / 2], 1 / 1.4))}>
          <Icon name="minus" />
        </button>
        <button type="button" className="map-ctl" aria-label="Показать всё" onClick={fit}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}

/**
 * Новая форма при перетаскивании вершины. У прямоугольника противоположный угол стоит на месте,
 * у произвольного полигона двигается одна вершина. null — слишком мало (меньше 1 м).
 */
function reshape(original: Vec2[], index: number, p: Vec2): Vec2[] | null {
  if (isAxisRect(original)) {
    const opposite = original[(index + 2) % 4]!;
    if (Math.abs(p[0] - opposite[0]) < 1 || Math.abs(p[1] - opposite[1]) < 1) return null;
    return rectPolygon(opposite, p);
  }
  const next = original.map((q, i) => (i === index ? p : q));
  return polygonArea(next) < 1 ? null : next;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU');
}
