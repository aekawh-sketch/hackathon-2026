// Сквозные проверки API на настоящей PostgreSQL (TEST_DATABASE_URL). ТЗ 13: владение, ревизии, публикация, загрузки.
import { demoVenue, refreshCapturePoints, type MapDocument } from '@space-map/map-core';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/db/migrate.ts';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/spacemap_test';

let app: Awaited<ReturnType<typeof buildApp>>;
let storageDir: string;

beforeAll(async () => {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  await migrate(DB_URL);
  storageDir = await mkdtemp(join(tmpdir(), 'space-map-test-'));
  app = await buildApp({ port: 0, databaseUrl: DB_URL, storageDir, cookieSecure: false, sessionDays: 14, logger: false, openAccess: false });
});

afterAll(async () => {
  await app?.close();
  await rm(storageDir, { recursive: true, force: true });
});

/** Клиент с cookie и CSRF-заголовком, как браузер. */
class Client {
  cookies = new Map<string, string>();

  /** Какой экземпляр API: по умолчанию общий для тестов. */
  constructor(private readonly server: () => typeof app = () => app) {}

  async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, opts: { csrf?: boolean; ip?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (opts.csrf !== false && this.cookies.has('sm_csrf')) headers['x-csrf-token'] = this.cookies.get('sm_csrf')!;
    const res = await this.server().inject({ method, url, headers, ...(opts.ip ? { remoteAddress: opts.ip } : {}), ...(body !== undefined ? { payload: body as object } : {}) });
    this.store(res.headers['set-cookie']);
    return res;
  }

  async upload(url: string, file: Buffer, fields: Record<string, string> = {}, method: 'POST' | 'PUT' = 'POST') {
    const boundary = `----sm${Math.random().toString(16).slice(2)}`;
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
    const res = await this.server().inject({
      method,
      url,
      payload: Buffer.concat(parts),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-csrf-token': this.cookies.get('sm_csrf') ?? '',
      },
    });
    return res;
  }

  private store(setCookie: string | string[] | undefined) {
    for (const c of [setCookie ?? []].flat()) {
      const [pair] = c.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (value) this.cookies.set(name!, value);
      else this.cookies.delete(name!);
    }
  }
}

let seq = 0;
async function newUser() {
  const c = new Client();
  const res = await c.req('POST', '/api/auth/register', { email: `user${++seq}@test.local`, password: 'correct-horse', name: `Пользователь ${seq}` });
  expect(res.statusCode).toBe(201);
  return c;
}

async function newVenue(c: Client, name = 'Отель Север') {
  const res = await c.req('POST', '/api/venues', { name });
  expect(res.statusCode).toBe(201);
  return res.json().venue as { id: string; slug: string };
}

const image = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 160, b: 200 } } })
    .jpeg()
    .toBuffer();

describe('вход', () => {
  it('регистрация, «кто я», выход', async () => {
    const c = await newUser();
    expect((await c.req('GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await c.req('POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await c.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('изменяющий запрос без CSRF-заголовка отклоняется', async () => {
    const c = await newUser();
    const res = await c.req('POST', '/api/venues', { name: 'Без CSRF' }, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('csrf');
  });

  it('пауза после 5 неверных паролей', async () => {
    const c = await newUser();
    const email = `user${seq}@test.local`;
    const anon = new Client();
    for (let i = 0; i < 5; i++) expect((await anon.req('POST', '/api/auth/login', { email, password: 'wrong-pass' })).statusCode).toBe(401);
    expect((await anon.req('POST', '/api/auth/login', { email, password: 'correct-horse' })).statusCode).toBe(429);
    expect(c.cookies.has('sm_session')).toBe(true);
  });
});

describe('гостевой вход одной кнопкой', () => {
  it('у каждого гостя своя копия демо-площадки, по паролю под гостем не войти, частота ограничена', async () => {
    const g1 = new Client();
    const r1 = await g1.req('POST', '/api/auth/guest');
    expect(r1.statusCode).toBe(201);
    expect(r1.json().user.isGuest).toBe(true);
    const draft = (await g1.req('GET', `/api/venues/${r1.json().venueId}/draft`)).json();
    expect(draft.doc.places.length).toBe(demoVenue().places.length);
    expect(draft.doc.venue.id).toBe(r1.json().venueId);

    const g2 = new Client();
    const r2 = await g2.req('POST', '/api/auth/guest');
    expect(r2.json().venueId).not.toBe(r1.json().venueId);
    expect((await g2.req('GET', `/api/venues/${r1.json().venueId}`)).statusCode).toBe(404);

    const login = await new Client().req('POST', '/api/auth/login', { email: r1.json().user.email, password: '!guest-no-password' });
    expect(login.statusCode).toBe(401);

    // Два уже есть; ещё восемь проходят, одиннадцатый с того же адреса — отказ.
    for (let i = 0; i < 8; i++) expect((await new Client().req('POST', '/api/auth/guest')).statusCode).toBe(201);
    expect((await new Client().req('POST', '/api/auth/guest')).statusCode).toBe(429);
  });

  it('гость сохраняет аккаунт и открывает свои площадки с другого устройства', async () => {
    const phone = new Client();
    const guest = await phone.req('POST', '/api/auth/guest', undefined, { ip: '10.0.0.7' });
    expect(guest.statusCode).toBe(201);
    const own = await newVenue(phone, 'Коридор');
    const claim = await phone.req('POST', '/api/auth/claim', { name: 'Иван', email: 'ivan-claim@test.local', password: 'correct-horse' });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().user).toMatchObject({ email: 'ivan-claim@test.local', isGuest: false });
    // Вход не слетел, повторно сохранить нельзя.
    expect((await phone.req('GET', '/api/auth/me')).json().user.isGuest).toBe(false);
    expect((await phone.req('POST', '/api/auth/claim', { name: 'Иван', email: 'other@test.local', password: 'correct-horse' })).statusCode).toBe(409);

    const laptop = new Client();
    expect((await laptop.req('POST', '/api/auth/login', { email: 'ivan-claim@test.local', password: 'correct-horse' })).statusCode).toBe(200);
    const ids = (await laptop.req('GET', '/api/venues')).json().venues.map((v: { id: string }) => v.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(guest.json().venueId);

    // Занятую почту гость взять не может.
    const other = new Client();
    await other.req('POST', '/api/auth/guest', undefined, { ip: '10.0.0.8' });
    const taken = await other.req('POST', '/api/auth/claim', { name: 'Не Иван', email: 'ivan-claim@test.local', password: 'correct-horse' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('email_taken');
  });
});

describe('площадки и владение', () => {
  it('ссылка из названия, повтор — с хвостом', async () => {
    const c = await newUser();
    const a = await newVenue(c, 'Гостиница «Ёлка»');
    expect(a.slug).toBe('gostinitsa-elka');
    const b = await newVenue(c, 'Гостиница «Ёлка»');
    expect(b.slug).toMatch(/^gostinitsa-elka-[0-9a-f]{6}$/);
  });

  it('чужая площадка не видна и не меняется', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const v = await newVenue(owner);
    expect((await stranger.req('GET', `/api/venues/${v.id}`)).statusCode).toBe(404);
    expect((await stranger.req('GET', `/api/venues/${v.id}/draft`)).statusCode).toBe(404);
    const draft = (await owner.req('GET', `/api/venues/${v.id}/draft`)).json();
    expect((await stranger.req('PUT', `/api/venues/${v.id}/draft`, { revision: draft.revision, doc: draft.doc })).statusCode).toBe(404);
    expect((await stranger.req('POST', `/api/venues/${v.id}/publish`)).statusCode).toBe(404);
  });
});

describe('черновик карты', () => {
  it('ревизии: второе сохранение со старой ревизией — 409', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const { revision, doc } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const first = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(revision + 1);
    const stale = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.revision).toBe(revision + 1);
  });

  it('настройки створок двери сохраняются, неверный угол — 400', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const doc: MapDocument = demoVenue();
    doc.openings[2]!.door = { leaves: 2, swing: -1, hinge: 'end', openAngle: 45 };
    const saved = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc });
    expect(saved.statusCode).toBe(200);
    const back = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    expect(back.doc.openings[2].door).toEqual({ leaves: 2, swing: -1, hinge: 'end', openAngle: 45 });
    doc.openings[2]!.door = { leaves: 3 as 2, swing: 1, hinge: 'start', openAngle: 400 };
    expect((await c.req('PUT', `/api/venues/${v.id}/draft`, { revision: back.revision, doc })).statusCode).toBe(400);
  });

  it('вырезы в помещении сохраняются', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const doc: MapDocument = demoVenue();
    doc.units[0]!.holes = [[[4, 4], [5, 4], [5, 5], [4, 5]]];
    expect((await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc })).statusCode).toBe(200);
    const back = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    expect(back.doc.units[0].holes).toEqual([[[4, 4], [5, 4], [5, 5], [4, 5]]]);
  });

  it('точки съёмки сохраняются; точка с несуществующей панорамой — 422', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const doc = refreshCapturePoints(demoVenue());
    expect(doc.capturePoints!.length).toBeGreaterThan(0);
    const saved = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc });
    expect(saved.statusCode).toBe(200);
    const back = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    expect(back.doc.capturePoints).toEqual(doc.capturePoints);
    back.doc.capturePoints[0].panorama = 'nope';
    expect((await c.req('PUT', `/api/venues/${v.id}/draft`, { revision: back.revision, doc: back.doc })).statusCode).toBe(422);
  });

  it('битые ссылки — 422, неверная схема — 400', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const doc: MapDocument = demoVenue();
    doc.places[0]!.node = 'nope';
    const bad = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('invalid_map');
    const wrongShape = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc: { ...demoVenue(), units: 'много' } });
    expect(wrongShape.statusCode).toBe(400);
  });
});

describe('публикация', () => {
  it('ссылка постоянная, сохранение обновляет опубликованную карту', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const anon = new Client();
    expect((await anon.req('GET', `/p/${v.slug}/latest.json`)).statusCode).toBe(404);

    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc: demoVenue() });
    const pub = await c.req('POST', `/api/venues/${v.id}/publish`);
    expect(pub.json().version).toBe(1);

    const latest = await anon.req('GET', `/p/${v.slug}/latest.json`);
    expect(latest.statusCode).toBe(200);
    const map = await anon.req('GET', latest.json().url);
    expect(map.statusCode).toBe(200);
    expect(map.headers['cache-control']).toContain('immutable');
    expect(map.json().places).toHaveLength(demoVenue().places.length);
    expect(map.json().venue.id).toBe(v.id);

    const draft = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    draft.doc.places[0].name = 'Новый вход';
    const saved = await c.req('PUT', `/api/venues/${v.id}/draft`, { revision: draft.revision, doc: draft.doc });
    expect(saved.json().publishedVersion).toBe(2);
    const latest2 = (await anon.req('GET', `/p/${v.slug}/latest.json`)).json();
    expect(latest2.version).toBe(2);
    expect((await anon.req('GET', latest2.url)).json().places[0].name).toBe('Новый вход');
  });

  it('закрытая карта — только владельцу', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    await c.req('POST', `/api/venues/${v.id}/publish`);
    await c.req('PATCH', `/api/venues/${v.id}`, { visibility: 'private' });
    expect((await new Client().req('GET', `/p/${v.slug}/latest.json`)).statusCode).toBe(404);
    expect((await c.req('GET', `/p/${v.slug}/latest.json`)).statusCode).toBe(200);
  });
});

describe('панорамы', () => {
  it('не 2:1 — 422; 2:1 — превью; до публикации файл виден только владельцу', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const bad = await c.upload(`/api/venues/${v.id}/panoramas`, await image(1200, 900));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('not_equirectangular');

    const ok = await c.upload(`/api/venues/${v.id}/panoramas`, await image(2048, 1024));
    expect(ok.statusCode).toBe(201);
    const pano = ok.json().panorama;
    expect(pano.width).toBe(2048);

    expect((await c.req('GET', pano.urls.preview)).statusCode).toBe(200);
    expect((await new Client().req('GET', pano.urls.preview)).statusCode).toBe(404);
    await c.req('POST', `/api/venues/${v.id}/publish`);
    const pub = await new Client().req('GET', pano.urls.preview);
    expect(pub.statusCode).toBe(200);
    expect(pub.headers['cache-control']).toContain('immutable');
    const meta = await sharp(pub.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 512]);
  });

  it('не изображение — 422', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const res = await c.upload(`/api/venues/${v.id}/panoramas`, Buffer.from('<svg onload="alert(1)"></svg>'));
    expect(res.statusCode).toBe(422);
  });
});

describe('серия кадров для склейки', () => {
  it('повтор кадра не дублирует, мало кадров — 422, иначе — в очередь', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    const cap = (await c.req('POST', `/api/venues/${v.id}/captures`)).json().capture;
    const frame = await image(800, 600);
    const url = (id: string) => `/api/venues/${v.id}/captures/${cap.id}/frames/${id}`;

    expect((await c.upload(url('f1'), frame, { orientation: '[0,0,0,1]' }, 'PUT')).statusCode).toBe(201);
    const again = await c.upload(url('f1'), frame, {}, 'PUT');
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect((await c.upload(url('f2'), frame, { orientation: '[2,0,0]' }, 'PUT')).statusCode).toBe(422);

    expect((await c.req('POST', `/api/venues/${v.id}/captures/${cap.id}/stitch`)).statusCode).toBe(422);
    for (const id of ['f2', 'f3', 'f4', 'f5', 'f6']) expect((await c.upload(url(id), frame, {}, 'PUT')).statusCode).toBe(201);
    const stitched = await c.req('POST', `/api/venues/${v.id}/captures/${cap.id}/stitch`);
    expect(stitched.statusCode).toBe(200);
    expect(stitched.json().capture.status).toBe('queued');
    expect(stitched.json().capture.frames).toHaveLength(6);
    // Повторное «склеить» не ставит вторую задачу.
    expect((await c.req('POST', `/api/venues/${v.id}/captures/${cap.id}/stitch`)).json().capture.status).toBe('queued');
  });
});

describe('общий доступ (OPEN_ACCESS — стенд команды)', () => {
  it('любой вошедший видит и правит чужую площадку; без флага — 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'space-map-open-'));
    const open = await buildApp({ port: 0, databaseUrl: DB_URL, storageDir: dir, cookieSecure: false, sessionDays: 14, logger: false, openAccess: true });
    try {
      const owner = await newUser();
      const v = await newVenue(owner, 'Общая площадка');

      const teammate = new Client(() => open);
      expect((await teammate.req('POST', '/api/auth/register', { email: 'teammate@test.local', password: 'correct-horse', name: 'Сокомандник' })).statusCode).toBe(201);
      const list = (await teammate.req('GET', '/api/venues')).json();
      expect(list.openAccess).toBe(true);
      expect(list.venues.map((x: { id: string }) => x.id)).toContain(v.id);
      const draft = (await teammate.req('GET', `/api/venues/${v.id}/draft`)).json();
      expect((await teammate.req('PUT', `/api/venues/${v.id}/draft`, { revision: draft.revision, doc: draft.doc })).statusCode).toBe(200);

      // Править можно, а удалить чужую — нет: удаление необратимо.
      const del = await teammate.req('DELETE', `/api/venues/${v.id}`, { confirmName: 'Общая площадка' });
      expect(del.statusCode).toBe(403);
      expect(del.json().code).toBe('not_owner');

      // Тот же сокомандник на API без флага — чужую площадку не видит.
      const strict = new Client();
      strict.cookies = teammate.cookies;
      expect((await strict.req('GET', `/api/venues/${v.id}`)).statusCode).toBe(404);
      expect((await strict.req('GET', '/api/venues')).json().openAccess).toBe(false);
    } finally {
      await open.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('инструменты списка площадок', () => {
  /** Площадка с загруженной панорамой, которая стоит на плане. */
  async function venueWithPanorama(c: Client) {
    const v = await newVenue(c, 'Склад «Восток»');
    const pano = (await c.upload(`/api/venues/${v.id}/panoramas`, await image(2048, 1024))).json().panorama;
    const { revision } = (await c.req('GET', `/api/venues/${v.id}/draft`)).json();
    const doc: MapDocument = demoVenue();
    doc.panoramas[0]!.pano = pano.id;
    expect((await c.req('PUT', `/api/venues/${v.id}/draft`, { revision, doc })).statusCode).toBe(200);
    return { v, pano, doc };
  }

  it('в списке — счётчики, миниатюра плана, обложка и «моя»', async () => {
    const c = await newUser();
    const { v, pano, doc } = await venueWithPanorama(c);
    const item = (await c.req('GET', '/api/venues')).json().venues.find((x: { id: string }) => x.id === v.id);
    expect(item.stats).toEqual({ units: doc.units.length, places: doc.places.length, panoramas: doc.panoramas.length });
    expect(item.thumb.units.length).toBeGreaterThan(0);
    expect(item.coverPano).toBe(pano.id);
    expect(item.isOwner).toBe(true);
    expect(item.ownerName).toBeNull();
    expect(new Date(item.editedAt).getTime()).toBeGreaterThan(0);
  });

  it('дублирование: новая площадка со своими копиями панорам, исходная не меняется', async () => {
    const c = await newUser();
    const { v, pano } = await venueWithPanorama(c);
    const dup = await c.req('POST', `/api/venues/${v.id}/duplicate`);
    expect(dup.statusCode).toBe(201);
    const copy = dup.json().venue;
    expect(copy.id).not.toBe(v.id);
    expect(copy.name).toBe('Склад «Восток» (копия)');
    expect(copy.publishedVersion).toBeNull();
    const copyDraft = (await c.req('GET', `/api/venues/${copy.id}/draft`)).json();
    expect(copyDraft.doc.venue.id).toBe(copy.id);
    const copyPano = copyDraft.doc.panoramas[0].pano;
    expect(copyPano).not.toBe(pano.id);
    expect((await c.req('GET', `/files/panoramas/${copyPano}/preview.jpg`)).statusCode).toBe(200);
    expect((await c.req('GET', `/api/venues/${v.id}/draft`)).json().doc.panoramas[0].pano).toBe(pano.id);
  });

  it('снять с публикации: ссылка перестаёт открываться, повторная публикация — следующая версия', async () => {
    const c = await newUser();
    const v = await newVenue(c);
    expect((await c.req('POST', `/api/venues/${v.id}/publish`)).json().version).toBe(1);
    expect((await new Client().req('GET', `/p/${v.slug}/latest.json`)).statusCode).toBe(200);
    const off = await c.req('POST', `/api/venues/${v.id}/unpublish`);
    expect(off.json().venue.publishedVersion).toBeNull();
    expect((await new Client().req('GET', `/p/${v.slug}/latest.json`)).statusCode).toBe(404);
    expect((await c.req('POST', `/api/venues/${v.id}/publish`)).json().version).toBe(2);
  });

  it('удаление убирает и файлы панорам', async () => {
    const c = await newUser();
    const { v, pano } = await venueWithPanorama(c);
    const panoDir = join(storageDir, 'panoramas', pano.id);
    expect(await stat(panoDir).then(() => true, () => false)).toBe(true);
    expect((await c.req('DELETE', `/api/venues/${v.id}`, { confirmName: 'не то' })).statusCode).toBe(422);
    expect((await c.req('DELETE', `/api/venues/${v.id}`, { confirmName: 'Склад «Восток»' })).statusCode).toBe(200);
    expect(await stat(panoDir).then(() => true, () => false)).toBe(false);
    expect((await c.req('GET', `/api/venues/${v.id}`)).statusCode).toBe(404);
  });
});
