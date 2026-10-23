// Поиск мест посетителем — ТЗ 5.12. Идёт в браузере по данным карты.
import type { MapDocument, Place } from './types.ts';

export function normalizeText(s: string): string {
  return s.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

export function searchPlaces(doc: MapDocument, query: string): Place[] {
  const q = normalizeText(query);
  if (!q) return [];
  const categories = new Map(doc.categories.map((c) => [c.id, c]));
  const scored: { place: Place; score: number }[] = [];
  for (const place of doc.places) {
    if (place.hidden) continue;
    const cat = categories.get(place.category);
    const name = normalizeText(place.name);
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.includes(q)) score = 3;
    else if (place.number && normalizeText(place.number) === q) score = 3;
    else if (cat && [cat.name, ...cat.synonyms].some((s) => normalizeText(s).includes(q))) score = 2;
    else if (normalizeText(place.description).includes(q)) score = 1;
    if (score > 0) scored.push({ place, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name, 'ru')).map((s) => s.place);
}
