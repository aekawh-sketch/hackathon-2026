// Холст редактора: выбор, перетаскивание помещений и мест, вершины, рисование комнат, двери.
// Жесты свои (Pointer Events), Konva только рисует: одинаково работает мышью, пером и пальцем.
import {
  activeCapturePoints,
  addCapturePoint,
  addHole,
  addPlace,
  moveCapturePoint,
  createRoom,
  holeAt,
  moveHole,
  placeEntrance,
  pointInUnit,
  addWall,
  dragOpeningEdge,
  GRID,
  openingSpan,
  placeDoor,
  rebuildGraph,
  slideOpening,
  type DoorPreset,
  isAxisRect,
  movePlace,
  overlappingUnits,
  pointInPolygon,
  pointSegmentDistance,
  polygonArea,
  polygonBounds,
  unitRings,
  rectPolygon,
  roomPlacement,
  setUnderlay,
  setUnitPolygon,
  sharedUnitWalls,
  snap,
  snapPoint,
  translateUnit,
  unitAt,
  type MapDocument,
  type Vec2,
} from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Circle, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { BasePlan, CapturePointMark, CaptureRouteLine, flatPoints, gridStyle, PanoDot, pinchView, PlaceArea, PlacePin, UnitLabels, useElementSize } from '../plan/draw.tsx';
import { useTheme } from '../ui/theme.tsx';
import { ROUTE } from '../plan/style.ts';
import { fitBoundsInset, levelBounds, screenToWorld, worldToScreen, zoomAt, type Insets, type Viewport } from '../plan/viewport.ts';
import { Icon } from '../ui/icons.tsx';
import { invertedCanvas, useImage } from '../ui/useImage.ts';

/** underlay — сдвиг подложки (готового плана картинкой): включается из панели «Готовый план». */
export type Tool = 'select' | 'room' | 'zone' | 'place' | 'door' | 'wall' | 'hole' | 'shot' | 'underlay';
/** Вырез выбирается как `{ kind: 'hole', id: '<unitId>#<номер>' }`; `shot` — точка съёмки панорамы. */
export type Selection = { kind: 'unit' | 'place' | 'opening' | 'hole' | 'shot'; id: string } | null;

export function holeRef(id: string): { unitId: string; index: number } {
  const at = id.lastIndexOf('#');
  return { unitId: id.slice(0, at), index: Number(id.slice(at + 1)) };
}

export interface EditorCanvasProps {
  doc: MapDocument;
  level: string;
  tool: Tool;
  selection: Selection;
  showGraph: boolean;
  placeCategory: string;
  areaCategory: string;
  /** Настройки новой двери: тип и насколько открыта. */
  doorPreset: DoorPreset;
  insets: Insets;
  fitKey: number;
  /** Показывать точки съёмки панорам. */
  showShots: boolean;
  /** Номера точек в порядке обхода. */
  shotLabels: Map<string, string>;
  /** Маршрут съёмки — показывается, пока выбран инструмент «Съёмка» или точка. */
  shotRoute: Vec2[][];
  /** keepSheet — выбор по ходу перетаскивания: на телефоне шторка не выезжает. */
  onSelect: (s: Selection, opts?: { keepSheet?: boolean }) => void;
  onCommit: (doc: MapDocument, select?: Selection) => void;
  onToolDone: () => void;
  onToast: (message: string) => void;
  /** Адрес картинки подложки; нет — подложку не показываем (демо без сервера). */
  underlaySrc?: (asset: string) => string;
}

type Drag =
  | { kind: 'pan' }
  | { kind: 'tap' }
  | { kind: 'unit'; id: string; start: Vec2 }
  | { kind: 'vertex'; id: string; index: number; original: Vec2[] }
  | { kind: 'areaVertex'; id: string; index: number; original: Vec2[] }
  | { kind: 'place'; id: string; start: Vec2; origin: Vec2 }
  | { kind: 'shot'; id: string; start: Vec2; origin: Vec2 }
  | { kind: 'draw'; start: Vec2 }
  | { kind: 'doorEdge'; id: string; edge: 0 | 1 }
  | { kind: 'doorSlide'; id: string; start: Vec2 }
  | { kind: 'cut'; start: Vec2 }
  | { kind: 'holeDraw'; start: Vec2; unitId: string }
  | { kind: 'holeMove'; unitId: string; index: number; start: Vec2 }
  | { kind: 'underlay'; start: Vec2; origin: Vec2 };

interface Preview {
  doc?: MapDocument;
  invalidUnit?: string | null;
  draft?: { polygon: Vec2[]; invalid: boolean; color?: string } | null;
  /** Разрез: проведённая линия, продлённая до стен (chord), и почему нельзя. */
  cut?: { line: [Vec2, Vec2]; chord: [Vec2, Vec2] | null; message: string | null; unitId: string | null; kind?: 'split' | 'partition' | 'notch' } | null;
}

/** Шаг привязки для разрезов и вырезов: мельче сетки комнат — колонна бывает 0,4 м. */
const FINE = 0.1;

/** Почти горизонтальная или вертикальная линия выравнивается по оси — так режут планы. */
function axisSnap(a: Vec2, b: Vec2): Vec2 {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dx < dy * 0.25) return [a[0], b[1]];
  if (dy < dx * 0.25) return [b[0], a[1]];
  return b;
}

/** Сдвиг пальца, после которого нажатие уже не нажатие, а перетаскивание. */
const TAP_MOUSE = 7;
const TAP_TOUCH = 12;
/** Кнопкам масштаба нужно столько свободной высоты над шторкой; меньше — прячем «+/−», остаётся щипок. */
const ZOOM_ROOM = 230;
const FIT_ROOM = 110;

export function EditorCanvas(props: EditorCanvasProps) {
  const theme = useTheme(); // палитра плана — из темы: перерисовка при её смене
  const { doc, level, tool, selection, showGraph, insets } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapRef);
  const [view, setView] = useState<Viewport>({ scale: 20, x: 0, y: 0 });
  // Под подсказкой инструмента (~48 px) и над шторкой.
  const freeHeight = (size?.h ?? 1000) - (insets.bottom ?? 0) - (insets.top ?? 0) - 48;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const drag = useRef<{ mode: Drag; startScreen: Vec2; moved: boolean; pointerId: number } | null>(null);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, []);
  const handleR = coarse ? 13 : 8;
  // Пальцем точнее ~1 см не попасть: для касаний зоны попадания больше.
  const tap = coarse ? TAP_TOUCH : TAP_MOUSE;
  const placeHit = coarse ? 28 : 20;
  const shotHit = coarse ? 26 : 16;
  const doorHit = coarse ? 18 : 10;

  const insetKey = `${insets.top ?? 0}:${insets.right ?? 0}:${insets.bottom ?? 0}:${insets.left ?? 0}`;
  // Подложка этажа: на пустом этаже «Показать всё» показывает картинку плана — иначе её не найти.
  const levelUnderlay = doc.levels.find((l) => l.id === level)?.underlay ?? null;
  const underlayImage = useImage(levelUnderlay && props.underlaySrc ? props.underlaySrc(levelUnderlay.asset) : null);
  const emptyLevel = !doc.units.some((u) => u.level === level);
  const bounds = () => {
    if (!emptyLevel || !levelUnderlay || !underlayImage) return levelBounds(doc, level);
    const [x, y] = levelUnderlay.origin;
    return { minX: x, maxX: x + underlayImage.naturalWidth / levelUnderlay.pxPerM, minY: y - underlayImage.naturalHeight / levelUnderlay.pxPerM, maxY: y };
  };
  const fit = () => size && setView(fitBoundsInset(bounds(), size.w, size.h, insets, 40));
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
    fit();
  }, [level, props.fitKey]);
  useEffect(() => {
    if (!touched.current) fit();
  }, [size?.w, size?.h, insetKey]);
  useEffect(() => {
    if (emptyLevel) fit();
  }, [underlayImage, levelUnderlay?.pxPerM]);

  const shown = preview?.doc ?? doc;
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toWorld = (s: Vec2) => screenToWorld(view, s);
  const toScreen = (w: Vec2) => worldToScreen(view, w);
  const selectedUnit = selection?.kind === 'unit' ? doc.units.find((u) => u.id === selection.id) : undefined;
  const selectedArea = selection?.kind === 'place' ? doc.places.find((p) => p.id === selection.id && p.polygon) : undefined;

  // ── Попадания ──
  const hitVertex = (s: Vec2) => {
    if (!selectedUnit) return -1;
    return selectedUnit.polygon.findIndex((p) => {
      const q = toScreen(p);
      return Math.hypot(q[0] - s[0], q[1] - s[1]) <= handleR + 6;
    });
  };
  const hitAreaVertex = (s: Vec2) => {
    if (!selectedArea?.polygon) return -1;
    return selectedArea.polygon.findIndex((p) => {
      const q = toScreen(p);
      return Math.hypot(q[0] - s[0], q[1] - s[1]) <= handleR + 6;
    });
  };
  const hitPlace = (s: Vec2) => {
    const world = toWorld(s);
    const places = doc.places.filter((p) => p.level === level);
    const area = places
      .filter((p) => p.polygon && pointInPolygon(world, p.polygon))
      .sort((a, b) => polygonArea(a.polygon!) - polygonArea(b.polygon!))[0];
    if (area) return area;
    return places
      .filter((p) => !p.polygon)
      .sort((a, b) => Number(b.id === selection?.id) - Number(a.id === selection?.id))
      .find((p) => {
        const q = toScreen(p.pos);
        return Math.hypot(q[0] - s[0], q[1] - s[1]) <= placeHit;
      });
  };
  // «Точки съёмки» в меню прячет и точки, и кружки панорам в них; инструмент «Съёмка» включает их сам (EditorPage).
  const shotsVisible = props.showShots;
  const hitShot = (s: Vec2) =>
    shotsVisible
      ? activeCapturePoints(doc, level).find((p) => {
          const q = toScreen(p.pos);
          return Math.hypot(q[0] - s[0], q[1] - s[1]) <= shotHit;
        })
      : undefined;
  const hitOpening = (s: Vec2) => {
    const w = toWorld(s);
    const tol = doorHit / view.scale;
    return doc.openings.find((o) => o.level === level && pointSegmentDistance(w, o.segment[0], o.segment[1]) <= tol);
  };
  /** Ручка на краю выбранной двери: 0 — segment[0], 1 — segment[1]. */
  const selectedOpening = selection?.kind === 'opening' ? doc.openings.find((o) => o.id === selection.id) : undefined;
  const hitDoorEdge = (s: Vec2): 0 | 1 | -1 => {
    if (!selectedOpening) return -1;
    for (const edge of [0, 1] as const) {
      const q = toScreen(selectedOpening.segment[edge]);
      if (Math.hypot(q[0] - s[0], q[1] - s[1]) <= handleR + 6) return edge;
    }
    return -1;
  };
  const hitHole = (s: Vec2) => {
    const hole = holeAt(doc, level, toWorld(s));
    if (!hole) return null;
    const ring = hole.unit.holes?.[hole.index];
    const belongsToRoom = ring && doc.units.some((unit) =>
      unit.parent === hole.unit.id && unit.polygon.length === ring.length &&
      unit.polygon.every((point, i) => Math.abs(point[0] - ring[i]![0]) < 0.01 && Math.abs(point[1] - ring[i]![1]) < 0.01),
    );
    return belongsToRoom ? null : hole;
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
      updatePreview(`p:${p}`, () => {
        const next = movePlace(doc, d.id, p);
        const moved = next.places.find((place) => place.id === d.id)!;
        const unit = unitAt(next, level, moved.pos);
        return moved.polygon && (!unit?.walkable || !moved.polygon.every((point) => pointInUnit(point, unit)))
          ? { invalidUnit: d.id }
          : { doc: next };
      });
    } else if (d.kind === 'shot') {
      const p = snapPoint([d.origin[0] + w[0] - d.start[0], d.origin[1] + w[1] - d.start[1]], GRID / 2);
      updatePreview(`s:${p}`, () => {
        const r = moveCapturePoint(doc, d.id, p);
        return r.ok ? { doc: r.doc } : null;
      });
    } else if (d.kind === 'doorEdge') {
      // Тянем край: дверь растягивается или сужается вдоль своей стены, другой край на месте.
      const next = dragOpeningEdge(doc, d.id, d.edge, w);
      const o = next.openings.find((x) => x.id === d.id)!;
      updatePreview(`de:${o.segment}`, () => ({ doc: next }));
    } else if (d.kind === 'doorSlide') {
      const span = openingSpan(doc, d.id);
      if (!span) return;
      const [a, b] = span.wall;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const delta = ((w[0] - d.start[0]) * (b[0] - a[0]) + (w[1] - d.start[1]) * (b[1] - a[1])) / len;
      const next = slideOpening(doc, d.id, delta);
      const o = next.openings.find((x) => x.id === d.id)!;
      updatePreview(`ds:${o.segment}`, () => ({ doc: next }));
    } else if (d.kind === 'cut') {
      const end = axisSnap(d.start, snapPoint(w, FINE));
      updatePreview(`c:${end}`, () => {
        const line: [Vec2, Vec2] = [d.start, end];
        // Стена — как провели: от стены до стены делит комнату, иначе встаёт перегородкой (addWall).
        const r = addWall(doc, level, d.start, end);
        if (!r.ok) return { cut: { line, chord: null, message: r.message, unitId: null } };
        return { doc: r.doc, cut: { line, chord: r.line, message: null, unitId: r.unitId, kind: r.kind } };
      });
    } else if (d.kind === 'holeDraw') {
      const p = snapPoint(w, FINE);
      const polygon = rectPolygon(d.start, p);
      updatePreview(`h:${p}`, () => {
        const r = addHole(doc, d.unitId, polygon);
        return r.ok ? { doc: r.doc, draft: { polygon, invalid: false } } : { draft: { polygon, invalid: true } };
      });
    } else if (d.kind === 'holeMove') {
      const delta: Vec2 = [snap(w[0] - d.start[0], FINE), snap(w[1] - d.start[1], FINE)];
      updatePreview(`hm:${delta}`, () => {
        if (delta[0] === 0 && delta[1] === 0) return null;
        const r = moveHole(doc, d.unitId, d.index, delta);
        return r.ok ? { doc: r.doc } : { invalidUnit: d.unitId };
      });
    } else if (d.kind === 'underlay') {
      const underlay = doc.levels.find((l) => l.id === level)?.underlay;
      if (!underlay) return;
      const origin: Vec2 = [snap(d.origin[0] + w[0] - d.start[0], FINE), snap(d.origin[1] + w[1] - d.start[1], FINE)];
      updatePreview(`ul:${origin}`, () => ({ doc: setUnderlay(doc, level, { ...underlay, origin }) }));
    } else if (d.kind === 'draw') {
      const p = snapPoint(w);
      const polygon = rectPolygon(d.start, p);
      updatePreview(`d:${p}`, () => {
        const b = polygonBounds(polygon);
        const small = b.maxX - b.minX < 1 || b.maxY - b.minY < 1;
        if (tool === 'zone') {
          const center: Vec2 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
          const unit = unitAt(doc, level, center);
          const inside = !!unit?.walkable && polygon.every((point) => pointInUnit(point, unit));
          const color = doc.categories.find((c) => c.id === props.areaCategory)?.color;
          return { draft: { polygon, color, invalid: b.maxX - b.minX < 0.5 || b.maxY - b.minY < 0.5 || !inside } };
        }
        return { draft: { polygon, invalid: small || !roomPlacement(doc, level, polygon).valid } };
      });
    } else if (d.kind === 'areaVertex') {
      const p = snapPoint(w);
      const polygon = reshape(d.original, d.index, p, 0.5);
      updatePreview(`av:${p}`, () => {
        if (!polygon) return { invalidUnit: d.id };
        const bounds = polygonBounds(polygon);
        const unit = unitAt(doc, level, [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]);
        const valid = !!unit?.walkable && polygon.every((point) => pointInUnit(point, unit));
        if (!valid) return { invalidUnit: d.id };
        const center: Vec2 = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
        const next = { ...doc, places: doc.places.map((place) => place.id === d.id ? { ...place, pos: center, polygon } : place) };
        return { doc: rebuildGraph(next, level) };
      });
    }
  };

  const finish = (d: Drag, moved: boolean, s: Vec2) => {
    const w = toWorld(s);
    const p = preview;
    clearPreview();
    if (!moved) return tapAt(d, s, w);
    if (d.kind === 'cut') {
      const cut = p?.cut;
      if (!cut || !p?.doc) return props.onToast(cut?.message ?? 'Проведите линию внутри помещения');
      const added = p.doc.units.find((u) => !doc.units.some((x) => x.id === u.id));
      // Инструмент не сбрасываем: стены обычно ставят подряд.
      props.onCommit(p.doc, null);
      return props.onToast(
        cut.kind === 'split'
          ? `Стена разделила комнату${added ? `: «${added.name}»` : ''}. Дверь в ней поставьте инструментом «Дверь»`
          : cut.kind === 'partition'
            ? 'Стена поставлена. Убрать — выберите её и «Убрать стену»'
            : 'Стена поставлена. Передумали — «Отменить» вверху',
      );
    }
    if (d.kind === 'underlay') {
      if (p?.doc) props.onCommit(p.doc, props.selection);
      return;
    }
    if (d.kind === 'holeDraw') {
      const draft = p?.draft;
      if (!draft) return;
      const r = addHole(doc, d.unitId, draft.polygon);
      if (!r.ok) return props.onToast(r.message);
      props.onCommit(r.doc, { kind: 'hole', id: `${d.unitId}#${r.index}` });
      props.onToast('Вырез готов. Узкий вырез работает как перегородка');
      return props.onToolDone();
    }
    if (d.kind === 'holeMove') {
      if (!p?.doc) return p?.invalidUnit ? props.onToast('Вырез должен остаться внутри комнаты — вернул на место') : undefined;
      return props.onCommit(p.doc, { kind: 'hole', id: `${d.unitId}#${d.index}` });
    }
    if (d.kind === 'doorEdge' || d.kind === 'doorSlide') {
      if (!p?.doc) return;
      // Середина двери сдвинулась — узлы маршрута у двери тоже.
      return props.onCommit(rebuildGraph(p.doc, level), { kind: 'opening', id: d.id });
    }
    if (d.kind === 'unit' || d.kind === 'vertex') {
      if (!p?.doc) return;
      if (p.invalidUnit) return props.onToast('Помещения не должны пересекаться — вернул на место');
      props.onCommit(p.doc, { kind: 'unit', id: d.id });
    } else if (d.kind === 'areaVertex') {
      if (!p?.doc) return props.onToast('Зона должна оставаться внутри помещения и быть не меньше 0,5 м');
      props.onCommit(p.doc, { kind: 'place', id: d.id });
    } else if (d.kind === 'shot') {
      if (!p?.doc) {
        const r = moveCapturePoint(doc, d.id, toWorld(s));
        return props.onToast(r.ok ? 'Точка осталась на месте' : `${r.message} — вернул на место`);
      }
      props.onCommit(p.doc, { kind: 'shot', id: d.id });
    } else if (d.kind === 'place') {
      if (!p?.doc) return p?.invalidUnit ? props.onToast('Зона должна целиком оставаться внутри помещения') : undefined;
      const place = p.doc.places.find((x) => x.id === d.id)!;
      if (!unitAt(p.doc, level, place.pos)) return props.onToast('Место должно стоять внутри помещения');
      props.onCommit(p.doc, { kind: 'place', id: d.id });
    } else if (d.kind === 'draw') {
      const draft = p?.draft;
      if (!draft) return;
      if (tool === 'zone') {
        if (draft.invalid) return props.onToast('Зона должна быть не меньше 0,5 м и целиком внутри помещения');
        const bounds = polygonBounds(draft.polygon);
        const center: Vec2 = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
        const category = doc.categories.find((c) => c.id === props.areaCategory) ?? doc.categories[0];
        if (!category) return props.onToast('Сначала добавьте категорию места');
        const created = addPlace(doc, level, center, category.id, category.name);
        const next = {
          ...created.doc,
          places: created.doc.places.map((place) => place.id === created.id ? { ...place, polygon: draft.polygon } : place),
        };
        props.onCommit(rebuildGraph(next, level), { kind: 'place', id: created.id });
        props.onToast(`Зона «${category.name}» создана. Тяните её за середину или за угол`);
        return props.onToolDone();
      }
      if (draft.invalid) return props.onToast('Комната меньше 1 м или налезает на другое помещение');
      const created = createRoom(doc, level, draft.polygon);
      const doors = created.doc.openings.filter((o) => (o.units as readonly string[]).includes(created.id)).length;
      props.onCommit(created.doc, { kind: 'unit', id: created.id });
      props.onToast(
        doors > 0
          ? 'Комната создана, дверь поставлена автоматически, точки съёмки рассчитаны'
          : 'Комната создана, точки съёмки рассчитаны. Поставьте дверь: инструмент «Дверь»',
      );
      props.onToolDone();
    }
  };

  const tapAt = (d: Drag, s: Vec2, w: Vec2) => {
    if (tool === 'room') return props.onToast('Проведите пальцем или мышью, чтобы нарисовать комнату');
    if (tool === 'zone') return props.onToast('Протяните прямоугольник внутри помещения, чтобы нарисовать зону');
    if (tool === 'wall') return props.onToast('Проведите линию — получится стена');
    if (tool === 'hole') return props.onToast('Протяните прямоугольник внутри комнаты');
    if (tool === 'underlay') return props.onToast('Тяните картинку, чтобы совместить её с рисунком');
    if (tool === 'shot') {
      if (d.kind === 'shot') return props.onSelect({ kind: 'shot', id: d.id });
      const r = addCapturePoint(doc, level, snapPoint(w, GRID / 2));
      if (!r.ok) return props.onToast(r.message);
      props.onCommit(r.doc, { kind: 'shot', id: r.id });
      return props.onToast('Своя точка съёмки добавлена. Рассчитанные точки рядом пересчитаны');
    }
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
        (u) => u.level === level && unitRings(u).some((ring) => ring.some((_, i) => pointSegmentDistance(w, ring[i]!, ring[(i + 1) % ring.length]!) < tol)),
      );
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i]!;
          const b = near[j]!;
          const walls = sharedUnitWalls(a, b).filter(([p, q]) => pointSegmentDistance(w, p, q) < tol);
          if (walls.length === 0) continue;
          // Дверь встаёт по центру свободного куска стены, с настройками из панели «Новая дверь».
          const placed = placeDoor(doc, a.id, b.id, w, props.doorPreset);
          if (!placed) return props.onToast('На этой стене нет места для двери');
          props.onCommit(rebuildGraph(placed.doc, level), { kind: 'opening', id: placed.id });
          return props.onToast(`${props.doorPreset.type === 'passage' ? 'Проём' : 'Дверь'} по центру стены: ${a.name} ↔ ${b.name}. Края можно тянуть`);
        }
      }
      // Стена одного помещения — наружная: дверь станет входом с улицы.
      const outer = near.sort(
        (x, y) =>
          Math.min(...x.polygon.map((_, i) => pointSegmentDistance(w, x.polygon[i]!, x.polygon[(i + 1) % x.polygon.length]!))) -
          Math.min(...y.polygon.map((_, i) => pointSegmentDistance(w, y.polygon[i]!, y.polygon[(i + 1) % y.polygon.length]!))),
      )[0];
      if (outer) {
        const placed = placeEntrance(doc, outer.id, w, props.doorPreset);
        if (!placed) return props.onToast('На этой стене нет места для входа');
        props.onCommit(rebuildGraph(placed.doc, level), { kind: 'opening', id: placed.id });
        return props.onToast(`Вход с улицы в «${outer.name}» — по центру наружной стены`);
      }
      return props.onToast('Нажмите на стену помещения');
    }
    if (d.kind === 'holeMove') return props.onSelect({ kind: 'hole', id: `${d.unitId}#${d.index}` });
    if (d.kind === 'place') return props.onSelect({ kind: 'place', id: d.id });
    if (d.kind === 'shot') return props.onSelect({ kind: 'shot', id: d.id });
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
    else if (tool === 'zone') mode = { kind: 'draw', start: snapPoint(w) };
    else if (tool === 'shot') {
      const shot = hitShot(s);
      if (shot) mode = { kind: 'shot', id: shot.id, start: w, origin: shot.pos };
    }
    else if (tool === 'wall') mode = { kind: 'cut', start: snapPoint(w, FINE) };
    else if (tool === 'underlay') {
      const underlay = doc.levels.find((l) => l.id === level)?.underlay;
      if (underlay) mode = { kind: 'underlay', start: w, origin: underlay.origin };
    }
    else if (tool === 'hole') {
      const unit = doc.units.find((u) => u.level === level && pointInUnit(w, u));
      if (unit) mode = { kind: 'holeDraw', start: snapPoint(w, FINE), unitId: unit.id };
    } else if (tool === 'select') {
      const v = hitVertex(s);
      const areaVertex = hitAreaVertex(s);
      const edge = hitDoorEdge(s);
      const place = hitPlace(s);
      const shot = hitShot(s);
      const opening = hitOpening(s);
      const unit = hitUnit(s);
      const hole = hitHole(s);
      if (areaVertex >= 0 && selectedArea?.polygon) mode = { kind: 'areaVertex', id: selectedArea.id, index: areaVertex, original: selectedArea.polygon };
      else if (v >= 0 && selectedUnit) mode = { kind: 'vertex', id: selectedUnit.id, index: v, original: selectedUnit.polygon };
      else if (edge >= 0 && selectedOpening) mode = { kind: 'doorEdge', id: selectedOpening.id, edge: edge as 0 | 1 };
      // Выбранная точка съёмки — впереди места под ней, иначе место впереди точки.
      else if (shot && selection?.kind === 'shot' && selection.id === shot.id) mode = { kind: 'shot', id: shot.id, start: w, origin: shot.pos };
      else if (place) mode = { kind: 'place', id: place.id, start: w, origin: place.pos };
      else if (shot) mode = { kind: 'shot', id: shot.id, start: w, origin: shot.pos };
      else if (opening && opening.id === selectedOpening?.id) mode = { kind: 'doorSlide', id: opening.id, start: w };
      else if (opening) mode = { kind: 'tap' };
      else if (hole) mode = { kind: 'holeMove', unitId: hole.unit.id, index: hole.index, start: w };
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
    if (!d.moved && Math.hypot(s[0] - d.startScreen[0], s[1] - d.startScreen[1]) > tap) d.moved = true;
    if (!d.moved) return;
    if (d.mode.kind === 'pan' || d.mode.kind === 'tap') {
      touched.current = true;
      setView((v) => ({ ...v, x: v.x + s[0] - prev[0], y: v.y + s[1] - prev[1] }));
      return;
    }
    if (d.mode.kind === 'unit' && selection?.id !== d.mode.id) props.onSelect({ kind: 'unit', id: d.mode.id }, { keepSheet: true });
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
    tool === 'room' || tool === 'zone' ? 'crosshair' : tool === 'place' || tool === 'door' || tool === 'shot' ? 'copy' : hover || tool === 'underlay' ? 'move' : 'grab';

  // Подложка — поверх заливки помещений с умножением цвета: белое прозрачно, видны линии плана. В тёмной теме — негатив с осветлением.
  const underlay = shown.levels.find((l) => l.id === level)?.underlay ?? null;
  const dark = theme === 'dark';
  const underlaySource = useMemo(() => (underlayImage && dark ? invertedCanvas(underlayImage) : underlayImage), [underlayImage, dark]);

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
                selectedHole={selection?.kind === 'hole' ? selection.id : null}
                invalidUnit={preview?.invalidUnit ?? null}
              />
              {underlay && underlayImage && underlaySource && (
                <KonvaImage
                  image={underlaySource}
                  x={toScreen(underlay.origin)[0]}
                  y={toScreen(underlay.origin)[1]}
                  width={(underlayImage.naturalWidth / underlay.pxPerM) * view.scale}
                  height={(underlayImage.naturalHeight / underlay.pxPerM) * view.scale}
                  opacity={underlay.opacity}
                  globalCompositeOperation={dark ? 'screen' : 'multiply'}
                />
              )}
              {shown.places.filter((p) => p.level === level && p.polygon).map((p) => (
                <PlaceArea
                  key={p.id}
                  place={p}
                  view={view}
                  color={categories.get(p.category)?.color ?? '#4A5568'}
                  selected={selection?.kind === 'place' && selection.id === p.id}
                />
              ))}
              <UnitLabels doc={shown} level={level} view={view} extra={dims} />
              {showGraph &&
                shown.graph.edges.map((e) => {
                  const a = shown.graph.nodes.find((n) => n.id === e.from);
                  const b = shown.graph.nodes.find((n) => n.id === e.to);
                  if (!a || !b || a.level !== level) return null;
                  return <Line key={e.id} points={flatPoints(view, [a.pos, b.pos])} stroke={ROUTE} strokeWidth={1.2} opacity={0.45} dash={[4, 4]} />;
                })}
              {preview?.cut && (
                <>
                  <Line
                    points={flatPoints(view, preview.cut.chord ?? preview.cut.line)}
                    stroke={preview.cut.message ? '#E5484D' : ROUTE}
                    strokeWidth={3}
                    dash={[10, 6]}
                    lineCap="round"
                  />
                  {preview.cut.message &&
                    (() => {
                      const [x, y] = toScreen(preview.cut.line[1]);
                      return (
                        <Text x={x - 110} y={y + 12} width={220} align="center" text={preview.cut.message} fontSize={13} fontStyle="600" fill="#B42318" stroke="#FFFFFF" strokeWidth={3} fillAfterStrokeEnabled />
                      );
                    })()}
                </>
              )}
              {preview?.draft && (
                <>
                  <Line
                    points={flatPoints(view, preview.draft.polygon)}
                    closed
                    fill={preview.draft.invalid ? 'rgba(229,72,77,0.12)' : rgba(preview.draft.color ?? ROUTE, 0.12)}
                    stroke={preview.draft.invalid ? '#E5484D' : preview.draft.color ?? ROUTE}
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
                        fill={preview.draft.invalid ? '#B42318' : preview.draft.color ?? '#1E46C7'}
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
              {shotsVisible && (tool === 'shot' || selection?.kind === 'shot') && <CaptureRouteLine view={view} legs={props.shotRoute} />}
              {shotsVisible &&
                shown.panoramas
                .filter((p) => p.level === level)
                .map((p) => {
                  const [x, y] = toScreen(p.pos);
                  return <PanoDot key={p.id} x={x} y={y} />;
                })}
              {shotsVisible &&
                activeCapturePoints(shown, level).map((p) => {
                  const [x, y] = toScreen(p.pos);
                  return (
                    <CapturePointMark
                      key={p.id}
                      x={x}
                      y={y}
                      label={props.shotLabels.get(p.id) ?? ''}
                      origin={p.origin === 'auto' ? 'auto' : 'manual'}
                      shot={p.panorama !== null}
                      selected={selection?.kind === 'shot' && selection.id === p.id}
                    />
                  );
                })}
              {shown.places
                .filter((p) => p.level === level && !p.polygon)
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
              {tool === 'select' && selectedArea?.polygon && (() => {
                const area = shown.places.find((place) => place.id === selectedArea.id);
                if (!area?.polygon) return null;
                const color = categories.get(area.category)?.color ?? ROUTE;
                return area.polygon.map((p, i) => {
                  const [x, y] = toScreen(p);
                  return <Rect key={`area-${i}`} x={x - handleR} y={y - handleR} width={handleR * 2} height={handleR * 2} cornerRadius={4} fill="#FFFFFF" stroke={color} strokeWidth={2.5} shadowColor="#0E1726" shadowBlur={4} shadowOpacity={0.2} />;
                });
              })()}
              {tool === 'select' &&
                selectedOpening &&
                (() => {
                  // Ручки на краях выбранной двери и её ширина — меняется прямо во время растягивания.
                  const o = shown.openings.find((x) => x.id === selectedOpening.id);
                  if (!o) return null;
                  const [a, b] = o.segment.map(toScreen) as [Vec2, Vec2];
                  const width = Math.hypot(o.segment[1][0] - o.segment[0][0], o.segment[1][1] - o.segment[0][1]);
                  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                  const off: Vec2 = [((b[1] - a[1]) / len) * 22, (-(b[0] - a[0]) / len) * 22];
                  return (
                    <>
                      {[a, b].map(([x, y], i) => (
                        <Circle key={i} x={x} y={y} radius={handleR} fill="#FFFFFF" stroke={ROUTE} strokeWidth={2.5} shadowColor="#0E1726" shadowBlur={4} shadowOpacity={0.2} />
                      ))}
                      <Text
                        x={(a[0] + b[0]) / 2 + off[0] - 40}
                        y={(a[1] + b[1]) / 2 + off[1] - 8}
                        width={80}
                        align="center"
                        text={`${fmt(width)} м`}
                        fontSize={13}
                        fontStyle="600"
                        fill="#1E46C7"
                        stroke="#FFFFFF"
                        strokeWidth={3}
                        fillAfterStrokeEnabled
                      />
                    </>
                  );
                })()}
            </Layer>
          </Stage>
        )}
      </div>
      <div
        className="map-controls"
        style={{ bottom: (insets.bottom ?? 0) + 16, right: (insets.right ?? 0) + 16, display: freeHeight < FIT_ROOM ? 'none' : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {freeHeight >= ZOOM_ROOM && (
          <>
            <button type="button" className="map-ctl" aria-label="Приблизить" onClick={() => size && setView((v) => zoomAt(v, [size.w / 2, size.h / 2], 1.4))}>
              <Icon name="plus" />
            </button>
            <button type="button" className="map-ctl" aria-label="Отдалить" onClick={() => size && setView((v) => zoomAt(v, [size.w / 2, size.h / 2], 1 / 1.4))}>
              <Icon name="minus" />
            </button>
          </>
        )}
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
function reshape(original: Vec2[], index: number, p: Vec2, minimum = 1): Vec2[] | null {
  if (isAxisRect(original)) {
    const opposite = original[(index + 2) % 4]!;
    if (Math.abs(p[0] - opposite[0]) < minimum || Math.abs(p[1] - opposite[1]) < minimum) return null;
    return rectPolygon(opposite, p);
  }
  const next = original.map((q, i) => (i === index ? p : q));
  return polygonArea(next) < minimum * minimum ? null : next;
}

function rgba(color: string, alpha: number): string {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return `rgba(47,91,234,${alpha})`;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU');
}
