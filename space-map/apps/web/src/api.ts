// Все запросы к серверу — в одном модуле.
import { acceptSuggestions, demoVenue, type MapDocument, type PanoramaPlacement } from '@space-map/map-core';

export interface LoadedMap {
  doc: MapDocument;
  version: number | null;
  /** Карта не с сервера, а встроенная демо-площадка. */
  offlineDemo: boolean;
}

export async function loadPublishedMap(slug: string): Promise<LoadedMap> {
  try {
    const latest = await getJson<{ version: number; url: string }>(`/p/${encodeURIComponent(slug)}/latest.json`);
    const doc = await getJson<MapDocument>(latest.url);
    return { doc, version: latest.version, offlineDemo: false };
  } catch (err) {
    if (slug !== 'demo') throw err;
    return { doc: builtInDemo(), version: null, offlineDemo: true };
  }
}

/** Встроенная демо-площадка: подсказки меток и переходов уже приняты, как это сделал бы организатор. */
export function builtInDemo(): MapDocument {
  let doc = demoVenue();
  for (const pa of doc.panoramas) doc = acceptSuggestions(doc, pa.id);
  return doc;
}

export function panoramaUrls(p: PanoramaPlacement): { image: string; preview: string } {
  if (p.pano.startsWith('demo-')) {
    return { image: `/demo/panoramas/${p.pano}.jpg`, preview: `/demo/panoramas/${p.pano}-preview.jpg` };
  }
  return { image: `/files/panoramas/${p.pano}/pano.jpg`, preview: `/files/panoramas/${p.pano}/preview.jpg` };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, body?.code ?? 'http_error', body?.message ?? `Ошибка ${res.status}`);
  }
  return (await res.json()) as T;
}
