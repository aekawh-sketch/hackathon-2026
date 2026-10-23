// Подсказки меток и переходов, ориентация, прогулка по маршруту — ТЗ 5.6, 5.7, 5.10.
import { azimuth, distance, hasLineOfSight, normalize180, normalize360 } from './geometry.ts';
import type { NavGraph } from './graph.ts';
import type { MapDocument, PanoramaLink, PanoramaMarker, PanoramaPlacement, Place, Vec2 } from './types.ts';

export const MARKER_HEIGHT = 1.2;

/** heading по одному соответствию: объект виден в панораме под yaw и стоит на плане в target. */
export function headingFromCorrespondence(panoPos: Vec2, target: Vec2, yawInPano: number): number {
  return normalize360(azimuth(panoPos, target) - yawInPano);
}

/** Где в панораме окажется точка плана. Без heading или без видимости — null. */
export function projectToPanorama(
  doc: MapDocument,
  pano: PanoramaPlacement,
  level: string,
  target: Vec2,
  targetHeight = MARKER_HEIGHT,
): { yaw: number; pitch: number; distance: number } | null {
  if (pano.heading === null || level !== pano.level) return null;
  const d = distance(pano.pos, target);
  if (d < 0.3) return null; // точка под ногами — направление не определено
  if (!hasLineOfSight(doc, level, pano.pos, target)) return null;
  const yaw = normalize180(azimuth(pano.pos, target) - pano.heading);
  const pitch = (Math.atan2(targetHeight - pano.cameraHeight, d) * 180) / Math.PI;
  return { yaw, pitch, distance: d };
}

/** Новые подсказки меток для панорамы: места в радиусе и на прямой видимости, которых в ней ещё нет. */
export function suggestMarkers(doc: MapDocument, pano: PanoramaPlacement): PanoramaMarker[] {
  if (doc.venue.scaleClass !== 'scaled') return [];
  const present = new Set(pano.markers.map((m) => m.place));
  const result: PanoramaMarker[] = [];
  for (const place of doc.places) {
    if (place.hidden || present.has(place.id)) continue;
    const p = projectToPanorama(doc, pano, place.level, place.pos);
    if (p && p.distance <= doc.settings.markerRange) {
      result.push({ place: place.id, yaw: round1(p.yaw), pitch: round1(p.pitch), status: 'suggested' });
    }
  }
  return result;
}

/** Подсказки переходов: в каждом секторе 30° — ближайшая видимая панорама, не больше 6. */
export function suggestLinks(doc: MapDocument, pano: PanoramaPlacement): PanoramaLink[] {
  if (doc.venue.scaleClass !== 'scaled' || pano.heading === null) return [];
  const linked = new Set(pano.links.map((l) => l.to));
  const bySector = new Map<number, { to: string; yaw: number; d: number }>();
  for (const other of doc.panoramas) {
    if (other.id === pano.id || linked.has(other.id) || other.level !== pano.level) continue;
    const d = distance(pano.pos, other.pos);
    if (d > doc.settings.linkRange || !hasLineOfSight(doc, pano.level, pano.pos, other.pos)) continue;
    const yaw = normalize180(azimuth(pano.pos, other.pos) - pano.heading);
    const sector = Math.floor(normalize360(yaw) / 30);
    const prev = bySector.get(sector);
    if (!prev || d < prev.d) bySector.set(sector, { to: other.id, yaw, d });
  }
  return [...bySector.values()]
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)
    .map(({ to, yaw }) => ({ to, yaw: round1(yaw), status: 'suggested' as const }));
}

/** «Принять все» для одной панорамы: подсказки меток и переходов становятся подтверждёнными. */
export function acceptSuggestions(doc: MapDocument, panoId: string): MapDocument {
  return {
    ...doc,
    panoramas: doc.panoramas.map((pa) => {
      if (pa.id !== panoId) return pa;
      const markers = [...pa.markers, ...suggestMarkers(doc, pa)].map((m) => ({ ...m, status: 'accepted' as const }));
      const links = [...pa.links, ...suggestLinks(doc, pa)].map((l) => ({ ...l, status: 'accepted' as const }));
      return { ...pa, markers, links };
    }),
  };
}

export function isLinked(doc: MapDocument, a: string, b: string): boolean {
  const pa = doc.panoramas.find((p) => p.id === a);
  const pb = doc.panoramas.find((p) => p.id === b);
  const accepted = (from?: PanoramaPlacement, to?: string) =>
    !!from?.links.some((l) => l.to === to && l.status === 'accepted');
  return accepted(pa, b) || accepted(pb, a);
}

export interface Walkthrough {
  /** Непрерывные куски: внутри куска соседние панорамы связаны подтверждённым переходом. */
  segments: string[][];
  /** Панорам хватает на весь путь — без разрывов и с покрытыми началом и концом. */
  complete: boolean;
  /** Участки маршрута без покрытия, в метрах вдоль маршрута. */
  gaps: { from: number; to: number }[];
  length: number;
}

export interface WalkthroughOptions {
  /** Панорама «на маршруте», если ближе к линии. */
  nearRoute?: number;
  /** Допустимый разрыв у начала и конца. */
  edgeGap?: number;
}

/**
 * Последовательность панорам по маршруту. Порядок — по положению вдоль маршрута,
 * связность — только по подтверждённым переходам: через закрытые помещения не прыгаем.
 */
export function walkthrough(doc: MapDocument, graph: NavGraph, routeNodes: string[], options: WalkthroughOptions = {}): Walkthrough {
  const nearRoute = options.nearRoute ?? 3;
  const edgeGap = options.edgeGap ?? 6;
  const points = routeNodes.map((id) => graph.nodes.get(id)!);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    cumulative.push(cumulative[i - 1]! + (prev.level === cur.level ? distance(prev.pos, cur.pos) : 0));
  }
  const length = cumulative[cumulative.length - 1] ?? 0;

  const onRoute: { id: string; along: number }[] = [];
  for (const pano of doc.panoramas) {
    let best: { along: number; d: number } | null = null;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      if (a.level !== pano.level) continue;
      if (i === points.length - 1 || points[i + 1]!.level !== a.level) {
        const d = distance(pano.pos, a.pos);
        if (!best || d < best.d) best = { along: cumulative[i]!, d };
        continue;
      }
      const b = points[i + 1]!;
      const proj = projectOnSegment(pano.pos, a.pos, b.pos);
      if (!best || proj.d < best.d) best = { along: cumulative[i]! + proj.t * distance(a.pos, b.pos), d: proj.d };
    }
    if (best && best.d <= nearRoute) onRoute.push({ id: pano.id, along: best.along });
  }
  onRoute.sort((a, b) => a.along - b.along);

  const segments: string[][] = [];
  const gaps: { from: number; to: number }[] = [];
  if (onRoute.length === 0) return { segments, complete: false, gaps: [{ from: 0, to: length }], length };

  if (onRoute[0]!.along > edgeGap) gaps.push({ from: 0, to: onRoute[0]!.along });
  let current = [onRoute[0]!.id];
  for (let i = 1; i < onRoute.length; i++) {
    const prev = onRoute[i - 1]!;
    const next = onRoute[i]!;
    if (isLinked(doc, prev.id, next.id)) {
      current.push(next.id);
    } else {
      segments.push(current);
      gaps.push({ from: prev.along, to: next.along });
      current = [next.id];
    }
  }
  segments.push(current);
  const last = onRoute[onRoute.length - 1]!;
  if (length - last.along > edgeGap) gaps.push({ from: last.along, to: length });

  return { segments, complete: gaps.length === 0, gaps, length };
}

function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { t, d: distance(p, [a[0] + t * dx, a[1] + t * dy]) };
}

export function placeById(doc: MapDocument, id: string): Place | undefined {
  return doc.places.find((p) => p.id === id);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
