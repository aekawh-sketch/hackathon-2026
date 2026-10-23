// Новая площадка: пустая карта с одним этажом и категориями по умолчанию (ТЗ 5.1, 5.3).
import { demoVenue, type MapDocument } from '@space-map/map-core';
import { randomBytes } from 'node:crypto';

export function emptyVenueDoc(venueId: string, name: string): MapDocument {
  return {
    schema: 2,
    venue: { id: venueId, name, planNorth: null, scaleClass: 'scaled' },
    categories: demoVenue().categories,
    levels: [{ id: 'L1', name: '1 этаж', ordinal: 0, underlay: null }],
    units: [],
    obstacles: [],
    openings: [],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
    settings: { markerRange: 20, linkRange: 15 },
  };
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const RESERVED = new Set(['api', 'app', 'files', 'p', 'm', 'q', 'admin', 'demo-api', 'health']);

export function slugify(name: string): string {
  const base = [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base.length >= 3 ? base : `map-${base || 'new'}`;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED.has(slug);
}

export function slugWithSuffix(base: string): string {
  return `${base.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
}
