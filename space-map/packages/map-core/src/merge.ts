// Слияние правок двух редакторов одной площадки (телефон в приложении снимает панорамы, на сайте правят план).
// База — документ, который оба видели последним; «мои» и «их» правки накладываются по сущностям и по полям:
// поле берётся моё только там, где его менял я, иначе — их. Удалённое любой стороной — удалено (кроме точки съёмки,
// в которой сняли панораму: снимок дороже). Новые ID идут подряд (pa-6, cp-12), поэтому одинаковый ID у разного
// содержимого — две разные сущности: моя получает свободный ID, ссылки на неё — тоже.
import { refreshCapturePoints } from './capturePoints.ts';
import { rebuildGraph, reconcileOpenings, refreshPanoramaMarkers } from './edit.ts';
import type { MapDocument, Opening, PanoramaLink, PanoramaPlacement } from './types.ts';
import { validateReferences } from './validate.ts';

type Entity = { id: string };

/**
 * Свести мои и чужие правки поверх общей базы. Итог нормализован (двери, граф, точки съёмки, метки) и проверен;
 * null — свести не удалось (висят ссылки), решать человеку.
 */
export function mergeDocuments(base: MapDocument, mine: MapDocument, theirs: MapDocument): MapDocument | null {
  if (equal(mine, base)) return theirs;
  if (equal(theirs, base)) return mine;
  const m = renameClashes(base, mine, theirs);
  const merged: MapDocument = {
    ...theirs,
    venue: mergeValue(base.venue, m.venue, theirs.venue),
    settings: mergeValue(base.settings, m.settings, theirs.settings),
    categories: mergeList(base.categories, m.categories, theirs.categories),
    levels: mergeList(base.levels, m.levels, theirs.levels),
    units: mergeList(base.units, m.units, theirs.units),
    obstacles: mergeList(base.obstacles, m.obstacles, theirs.obstacles),
    openings: mergeList(base.openings, m.openings, theirs.openings),
    places: mergeList(base.places, m.places, theirs.places),
    panoramas: mergeList(base.panoramas, m.panoramas, theirs.panoramas, { item: mergePanorama }),
    anchors: mergeList(base.anchors, m.anchors, theirs.anchors),
    capturePoints: mergeList(base.capturePoints ?? [], m.capturePoints ?? [], theirs.capturePoints ?? [], { keepChanged: true }),
  };
  let doc = reconcileOpenings(repair(merged));
  for (const level of doc.levels) doc = rebuildGraph(doc, level.id);
  doc = refreshPanoramaMarkers(refreshCapturePoints(doc));
  return validateReferences(doc).length ? null : doc;
}

/** Переходы панорамы сливаются по цели: два телефона, снявшие соседей одной панорамы, оба добавили ей переход. */
function mergePanorama(b: PanoramaPlacement, m: PanoramaPlacement, t: PanoramaPlacement): PanoramaPlacement {
  return { ...mergeValue(b, m, t), links: mergeKeyed<PanoramaLink>(b.links, m.links, t.links, (l) => l.to) };
}

function mergeList<T extends Entity>(b: T[], m: T[], t: T[], opts: { item?: (b: T, m: T, t: T) => T; keepChanged?: boolean } = {}): T[] {
  return mergeKeyed(b, m, t, (x) => x.id, opts);
}

/**
 * Список сущностей по ключу. Порядок — их, новые мои — в конце.
 * keepChanged: сущность, которую одна сторона удалила, а другая изменила, остаётся изменённой.
 */
function mergeKeyed<T>(b: T[], m: T[], t: T[], key: (x: T) => string, opts: { item?: (b: T, m: T, t: T) => T; keepChanged?: boolean } = {}): T[] {
  const item = opts.item ?? mergeValue;
  const bm = new Map(b.map((x) => [key(x), x]));
  const mm = new Map(m.map((x) => [key(x), x]));
  const tm = new Map(t.map((x) => [key(x), x]));
  const keys = [...tm.keys(), ...[...mm.keys()].filter((k) => !tm.has(k))];
  const out: T[] = [];
  for (const k of keys) {
    const bi = bm.get(k);
    const mi = mm.get(k);
    const ti = tm.get(k);
    if (bi === undefined) {
      out.push((mi ?? ti)!); // новое: одинаковые ID с разным содержимым уже разведены
    } else if (mi !== undefined && ti !== undefined) {
      out.push(item(bi, mi, ti));
    } else if (opts.keepChanged) {
      const left = mi ?? ti!;
      if (!equal(left, bi)) out.push(left);
    }
  }
  return out;
}

/** Значение по полям: моё — где менял я, иначе их; оба поменяли одно поле — моё. */
function mergeValue<T>(b: T, m: T, t: T): T {
  if (equal(m, b)) return t;
  if (equal(t, b) || equal(m, t)) return m;
  if (!isRecord(b) || !isRecord(m) || !isRecord(t)) return m;
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(m), ...Object.keys(t)])) {
    const v = mergeValue(b[k], m[k], t[k]);
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!equal(ra[k], rb[k])) return false;
  return true;
}

// ── Одинаковые новые ID ──

type Renamable = 'categories' | 'units' | 'obstacles' | 'openings' | 'places' | 'panoramas' | 'anchors' | 'capturePoints';
const RENAMABLE: Renamable[] = ['categories', 'units', 'obstacles', 'openings', 'places', 'panoramas', 'anchors', 'capturePoints'];

function renameClashes(base: MapDocument, mine: MapDocument, theirs: MapDocument): MapDocument {
  const used = new Set<string>();
  for (const d of [mine, theirs]) for (const key of RENAMABLE) for (const x of (d[key] ?? []) as Entity[]) used.add(x.id);
  let doc = mine;
  for (const key of RENAMABLE) {
    const inBase = new Set(((base[key] ?? []) as Entity[]).map((x) => x.id));
    const their = new Map(((theirs[key] ?? []) as Entity[]).map((x) => [x.id, x]));
    const map = new Map<string, string>();
    for (const x of (doc[key] ?? []) as Entity[]) {
      const other = their.get(x.id);
      if (inBase.has(x.id) || !other || equal(x, other)) continue;
      const id = freeLike(used, x.id);
      used.add(id);
      map.set(x.id, id);
    }
    if (map.size) doc = renameIn(doc, key, map);
  }
  return doc;
}

/** Свободный ID того же вида: pa-6 → pa-7 (или дальше, если занят). */
function freeLike(used: Set<string>, id: string): string {
  const prefix = id.replace(/-\d+$/, '');
  for (let i = 1; ; i++) {
    const next = `${prefix}-${i}`;
    if (!used.has(next)) return next;
  }
}

function renameIn(doc: MapDocument, key: Renamable, map: Map<string, string>): MapDocument {
  const r = (id: string) => map.get(id) ?? id;
  const ids = <T extends Entity>(list: T[]) => list.map((x) => (map.has(x.id) ? { ...x, id: r(x.id) } : x));
  switch (key) {
    case 'categories':
      return { ...doc, categories: ids(doc.categories), places: doc.places.map((p) => ({ ...p, category: r(p.category) })) };
    case 'units':
      return {
        ...doc,
        units: ids(doc.units).map((u) => (u.parent ? { ...u, parent: r(u.parent) } : u)),
        openings: doc.openings.map((o) => ({ ...o, units: o.units.map(r) as Opening['units'] })),
      };
    case 'places':
      return {
        ...doc,
        places: ids(doc.places),
        panoramas: doc.panoramas.map((pa) => ({ ...pa, markers: pa.markers.map((mk) => ({ ...mk, place: r(mk.place) })) })),
      };
    case 'panoramas':
      return {
        ...doc,
        panoramas: ids(doc.panoramas).map((pa) => ({ ...pa, links: pa.links.map((l) => ({ ...l, to: r(l.to) })) })),
        places: doc.places.map((p) => (p.panorama ? { ...p, panorama: r(p.panorama) } : p)),
        capturePoints: (doc.capturePoints ?? []).map((c) => (c.panorama ? { ...c, panorama: r(c.panorama) } : c)),
      };
    case 'obstacles':
      return { ...doc, obstacles: ids(doc.obstacles) };
    case 'openings':
      return { ...doc, openings: ids(doc.openings) };
    case 'anchors':
      return { ...doc, anchors: ids(doc.anchors) };
    case 'capturePoints':
      return { ...doc, capturePoints: ids(doc.capturePoints ?? []) };
  }
}

// ── Висящие ссылки после слияния ──

/** Одна сторона удалила то, на что ссылается правка другой: ссылку убираем, сущность оставляем. */
function repair(doc: MapDocument): MapDocument {
  const levels = new Set(doc.levels.map((l) => l.id));
  const onLevel = <T extends { level: string }>(list: T[]) => list.filter((x) => levels.has(x.level));
  const units = onLevel(doc.units);
  const unitIds = new Set(units.map((u) => u.id));
  const categories = new Set(doc.categories.map((c) => c.id));
  const fallbackCategory = doc.categories[0]?.id;
  const panoramas = onLevel(doc.panoramas);
  const panoIds = new Set(panoramas.map((p) => p.id));
  const places = onLevel(doc.places).map((p) => {
    const category = categories.has(p.category) || !fallbackCategory ? p.category : fallbackCategory;
    const panorama = p.panorama && !panoIds.has(p.panorama) ? null : p.panorama;
    return category === p.category && panorama === p.panorama ? p : { ...p, category, panorama };
  });
  const placeIds = new Set(places.map((p) => p.id));
  return {
    ...doc,
    units: units.map((u) => {
      if (!u.parent || unitIds.has(u.parent)) return u;
      const { parent: _gone, ...rest } = u;
      return rest;
    }),
    obstacles: onLevel(doc.obstacles),
    openings: onLevel(doc.openings),
    places,
    panoramas: panoramas.map((pa) => ({
      ...pa,
      markers: pa.markers.filter((mk) => placeIds.has(mk.place)),
      links: pa.links.filter((l) => l.to !== pa.id && panoIds.has(l.to)),
    })),
    anchors: onLevel(doc.anchors),
    capturePoints: onLevel(doc.capturePoints ?? []).map((c) => (c.panorama && !panoIds.has(c.panorama) ? { ...c, panorama: null } : c)),
  };
}
