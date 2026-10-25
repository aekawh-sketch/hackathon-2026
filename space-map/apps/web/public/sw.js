// Карта без интернета: сайт, открытые карты и их панорамы остаются в кэше устройства.
// Страницы и указатель на последнюю версию карты — сначала из сети (чтобы видеть свежее), без сети — из кэша.
// Неизменяемое (сборка сайта, версии карт, панорамы) — из кэша, а при первом запросе кладётся туда.
// Кабинет и редактор (/api) работают только с сетью: правки должны попадать на сервер.
const VERSION = 'v1';
const SHELL = `space-map-shell-${VERSION}`;
const DATA = `space-map-data-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Сайт целиком на первом же заходе: страница и скрипты, на которые она ссылается.
      const cache = await caches.open(SHELL);
      const res = await fetch('/', { cache: 'no-store' });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put('/index.html', res);
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, DATA]);
      for (const key of await caches.keys()) if (key.startsWith('space-map-') && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (req.mode === 'navigate' && !/^\/(api|p|files|downloads)\//.test(path)) {
    event.respondWith(networkFirst(req, SHELL, '/index.html'));
  } else if (path.startsWith('/assets/') || path.startsWith('/icons/')) {
    event.respondWith(cacheFirst(req, SHELL));
  } else if (/^\/p\/[^/]+\/v\/\d+\/map\.json$/.test(path) || /^\/files\/panoramas\//.test(path) || path.startsWith('/demo/panoramas/')) {
    event.respondWith(cacheFirst(req, DATA));
  } else if (path === '/p/index.json' || /^\/p\/[^/]+\/latest\.json$/.test(path) || path === '/manifest.webmanifest') {
    event.respondWith(networkFirst(req, DATA));
  }
});

async function networkFirst(req, cacheName, key = req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    // Под ключом страницы — только сама страница, а не файл, открытый переходом по ссылке.
    const page = key === req || (res.headers.get('content-type') ?? '').includes('text/html');
    if (res.ok && page && canStore(res)) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreVary: true, ignoreSearch: key !== req });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && canStore(res)) {
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
  }
  return res;
}

// Закрытые карты и панорамы нельзя оставлять в общем кэше после выхода из аккаунта.
function canStore(res) {
  return !/\b(private|no-store)\b/i.test(res.headers.get('cache-control') ?? '');
}
