// Все запросы к серверу — в одном модуле.
import { acceptSuggestions, demoVenue, type MapDocument, type PanoramaPlacement, type PlanOutline } from '@space-map/map-core';
import { loadEditedDemo } from './demoStore.ts';

export interface LoadedMap {
  doc: MapDocument;
  version: number | null;
  /** Карта не с сервера, а встроенная демо-площадка. */
  offlineDemo: boolean;
  /** Демо-площадка изменена в редакторе этого браузера. */
  edited: boolean;
}

/**
 * Указатель на последнюю опубликованную версию — всегда свежий, мимо кэша браузера (сервер разрешает хранить его 30 с):
 * иначе обновлённая карта подтянулась бы со старым номером. Сама версия (map.json) неизменна и кэшируется.
 */
async function latestPointer(slug: string): Promise<{ version: number; url: string }> {
  const res = await fetch(`/p/${encodeURIComponent(slug)}/latest.json`, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`latest.json: ${res.status}`);
  return (await res.json()) as { version: number; url: string };
}

/** Номер опубликованной версии — без самой карты: посетитель так узнаёт, что карту обновили. */
export async function publishedVersion(slug: string): Promise<number> {
  return (await latestPointer(slug)).version;
}

export async function loadPublishedMap(slug: string): Promise<LoadedMap> {
  try {
    const latest = await latestPointer(slug);
    const doc = await getJson<MapDocument>(latest.url);
    return { doc, version: latest.version, offlineDemo: false, edited: false };
  } catch (err) {
    if (slug !== 'demo') throw err;
    const edited = loadEditedDemo();
    return { doc: edited ?? builtInDemo(), version: null, offlineDemo: true, edited: !!edited };
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
    const base = `${import.meta.env.BASE_URL}demo/panoramas/${p.pano}`;
    return { image: `${base}.jpg`, preview: `${base}-preview.jpg` };
  }
  return { image: `/files/panoramas/${p.pano}/pano.jpg`, preview: `/files/panoramas/${p.pano}/preview.jpg` };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  return request<T>('GET', url);
}

/** CSRF-токен лежит в читаемой cookie; сервер сверяет его с заголовком у изменяющих запросов. */
function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)sm_csrf=([^;]+)/)?.[1] ?? '';
}

/** Организатор вошёл в этом браузере: cookie с CSRF-токеном выдаётся только вместе с сессией. Без запроса к серверу. */
export function hasOrganizerSession(): boolean {
  return csrfToken() !== '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, credentials: 'include', headers, body: payload });
  } catch {
    throw new ApiError(0, 'offline', 'Нет связи с сервером');
  }
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
    const err = (await res.json().catch(() => null)) as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Ошибка ${res.status}`, err?.details);
  }
  return (await res.json()) as T;
}

// ── Кабинет организатора ──

export interface User {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
}

export interface VenueSummary {
  id: string;
  name: string;
  slug: string;
  visibility: 'public' | 'private';
  publishedVersion: number | null;
  embedDomains: string[];
  updatedAt: string;
}

/** Строка списка «Мои площадки»: то, что нужно для карточки, без загрузки всего плана. */
export interface VenueListItem extends VenueSummary {
  editedAt: string;
  /** Моя площадка: удалить её могу только я. */
  isOwner: boolean;
  /** Можно удалить: своя или (при общем доступе) чужой черновик. */
  canDelete: boolean;
  /** Кто создал — при общем доступе, если не я. */
  ownerName: string | null;
  stats: { units: number; places: number; panoramas: number };
  thumb: PlanOutline | null;
  /** Панорама для обложки карточки. */
  coverPano: string | null;
}

export interface Draft {
  revision: number;
  doc: MapDocument;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PanoramaAsset {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  width: number | null;
  height: number | null;
  urls: { image: string; preview: string } | null;
}

export const auth = {
  me: () => request<{ user: User }>('GET', '/api/auth/me').then((r) => r.user),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }).then((r) => r.user),
  register: (name: string, email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { name, email, password }).then((r) => r.user),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  /** Вход одной кнопкой: гостевой аккаунт и своя копия демо-площадки. */
  /** `shared` — общий доступ: гость правит общую демо-площадку, а не свою копию. */
  guest: () => request<{ user: User; venueId: string; shared?: boolean }>('POST', '/api/auth/guest'),
  /** Гость сохраняет аккаунт: почта и пароль, площадки остаются при нём. */
  claim: (name: string, email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/claim', { name, email, password }).then((r) => r.user),
};

export const venuesApi = {
  /** Мои площадки; при общем доступе стенда (`openAccess`) — все. */
  list: () => request<{ venues: VenueListItem[]; openAccess?: boolean }>('GET', '/api/venues'),
  /** Копия с планом, местами и своими копиями панорам; не опубликована. */
  duplicate: (id: string) => request<{ venue: VenueSummary }>('POST', `/api/venues/${id}/duplicate`).then((r) => r.venue),
  /** Посетители больше не открывают карту по ссылке; черновик остаётся. */
  unpublish: (id: string) => request<{ venue: VenueSummary }>('POST', `/api/venues/${id}/unpublish`).then((r) => r.venue),
  /** Удалить навсегда; confirmName — точное название, защита от случайного нажатия. */
  remove: (id: string, confirmName: string) => request<{ ok: true }>('DELETE', `/api/venues/${id}`, { confirmName }),
  create: (name: string) => request<{ venue: VenueSummary }>('POST', '/api/venues', { name }).then((r) => r.venue),
  get: (id: string) => request<{ venue: VenueSummary }>('GET', `/api/venues/${id}`).then((r) => r.venue),
  update: (id: string, patch: Partial<Pick<VenueSummary, 'name' | 'slug' | 'visibility' | 'embedDomains'>>) =>
    request<{ venue: VenueSummary }>('PATCH', `/api/venues/${id}`, patch).then((r) => r.venue),
  draft: (id: string) => request<Draft>('GET', `/api/venues/${id}/draft`),
  /** Только номер ревизии черновика — проверить, не сохранил ли кто-то после нас. */
  draftRevision: (id: string) => request<{ revision: number; updatedBy: string | null }>('GET', `/api/venues/${id}/draft/revision`),
  saveDraft: (id: string, revision: number, doc: MapDocument) =>
    request<{ revision: number; publishedVersion: number | null }>('PUT', `/api/venues/${id}/draft`, { revision, doc }),
  publish: (id: string) => request<{ version: number; url: string }>('POST', `/api/venues/${id}/publish`),
  panoramas: (id: string) => request<{ panoramas: PanoramaAsset[] }>('GET', `/api/venues/${id}/panoramas`).then((r) => r.panoramas),
  uploadPanorama: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ panorama: PanoramaAsset }>('POST', `/api/venues/${id}/panoramas`, form).then((r) => r.panorama);
  },
};
