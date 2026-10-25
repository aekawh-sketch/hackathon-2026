import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { planOutline, validateReferences, type MapDocument } from '@space-map/map-core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppDeps } from '../app.ts';
import { isAdmin, requireUser, type SessionUser } from '../auth.ts';
import { captures, mapDrafts, mapVersions, panoramas, users, venues } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { MapDocumentSchema } from '../mapSchema.ts';
import { emptyVenueDoc, isValidSlug, slugify, slugWithSuffix } from '../venueTemplate.ts';
import { isUuid, ownedVenue, publish, type Venue } from '../venues.ts';

const VenueId = Type.Object({ id: Type.String() });

/** Удалить можно свою площадку, а администратору — любую (решение владельца проекта). */
function canDelete(v: Venue, user: SessionUser): boolean {
  return v.ownerId === user.id || isAdmin(user);
}

function venueView(v: Venue) {
  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    visibility: v.visibility,
    publishedVersion: v.publishedVersion,
    embedDomains: v.embedDomains,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export const venueRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db, storage, config }) => {
  // Список для «Мои площадки»: счётчики, миниатюра плана, обложка-панорама, кто создал и когда правили.
  app.get('/', async (req) => {
    const user = requireUser(req);
    // Администратору — все площадки, остальным — только свои.
    const query = db
      .select({ venue: venues, doc: mapDrafts.doc, draftAt: mapDrafts.updatedAt, ownerName: users.name })
      .from(venues)
      .leftJoin(mapDrafts, eq(mapDrafts.venueId, venues.id))
      .leftJoin(users, eq(users.id, venues.ownerId));
    const rows = await (isAdmin(user) ? query : query.where(eq(venues.ownerId, user.id))).orderBy(desc(venues.updatedAt));
    const list = rows.map(({ venue, doc, draftAt, ownerName }) => {
      const editedAt = draftAt && draftAt > venue.updatedAt ? draftAt : venue.updatedAt;
      return {
        ...venueView(venue),
        editedAt,
        isOwner: venue.ownerId === user.id,
        canDelete: canDelete(venue, user),
        ownerName: venue.ownerId === user.id ? null : (ownerName ?? null),
        stats: doc ? { units: doc.units.length, places: doc.places.length, panoramas: doc.panoramas.length } : { units: 0, places: 0, panoramas: 0 },
        thumb: doc ? planOutline(doc) : null,
        coverPano: doc?.panoramas[0]?.pano ?? null,
      };
    });
    list.sort((a, b) => b.editedAt.getTime() - a.editedAt.getTime());
    return { venues: list };
  });

  app.post(
    '/',
    { schema: { body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), slug: Type.Optional(Type.String({ maxLength: 48 })) }) } },
    async (req, reply) => {
      const user = requireUser(req);
      const name = req.body.name.trim();
      if (req.body.slug !== undefined && !isValidSlug(req.body.slug)) {
        throw new ApiError(422, 'bad_slug', 'Ссылка: латинские буквы, цифры и дефис, от 3 до 48 символов');
      }
      const base = req.body.slug ?? slugify(name);
      const venue = await db.transaction(async (tx) => {
        const taken = await tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, base)).limit(1);
        if (taken.length && req.body.slug) throw new ApiError(409, 'slug_taken', 'Такая ссылка уже занята');
        const slug = taken.length || !isValidSlug(base) ? slugWithSuffix(base) : base;
        const [created] = await tx.insert(venues).values({ ownerId: user.id, name, slug }).returning();
        await tx.insert(mapDrafts).values({ venueId: created!.id, doc: emptyVenueDoc(created!.id, name), updatedBy: user.id });
        return created!;
      });
      return reply.status(201).send({ venue: venueView(venue) });
    },
  );

  app.get('/:id', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    return { venue: venueView(await ownedVenue(db, req.params.id, user)) };
  });

  app.patch(
    '/:id',
    {
      schema: {
        params: VenueId,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          slug: Type.Optional(Type.String({ maxLength: 48 })),
          visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('private')])),
          embedDomains: Type.Optional(Type.Array(Type.String({ pattern: '^[a-z0-9.-]+(:[0-9]+)?$', maxLength: 120 }), { maxItems: 20 })),
        }),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const venue = await ownedVenue(db, req.params.id, user);
      const { slug, ...rest } = req.body;
      if (slug !== undefined && slug !== venue.slug) {
        if (!isValidSlug(slug)) throw new ApiError(422, 'bad_slug', 'Ссылка: латинские буквы, цифры и дефис, от 3 до 48 символов');
        const taken = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, slug)).limit(1);
        if (taken.length) throw new ApiError(409, 'slug_taken', 'Такая ссылка уже занята');
      }
      const [updated] = await db
        .update(venues)
        .set({ ...rest, ...(slug !== undefined ? { slug } : {}), updatedAt: new Date() })
        .where(eq(venues.id, venue.id))
        .returning();
      return { venue: venueView(updated!) };
    },
  );

  app.delete(
    '/:id',
    { schema: { params: VenueId, body: Type.Object({ confirmName: Type.String({ maxLength: 120 }) }) } },
    async (req) => {
      const user = requireUser(req);
      const venue = await ownedVenue(db, req.params.id, user);
      if (!canDelete(venue, user)) throw new ApiError(403, 'not_owner', 'Удалить площадку может только её создатель');
      if (req.body.confirmName.trim() !== venue.name) throw new ApiError(422, 'confirm_mismatch', 'Введите точное название площадки');
      const panoIds = (await db.select({ id: panoramas.id }).from(panoramas).where(eq(panoramas.venueId, venue.id))).map((r) => r.id);
      const captureIds = (await db.select({ id: captures.id }).from(captures).where(eq(captures.venueId, venue.id))).map((r) => r.id);
      await db.delete(venues).where(eq(venues.id, venue.id));
      // Файлы — после удаления строк: если что-то не сотрётся, в базе на них уже никто не ссылается.
      await storage.delete(`versions/${venue.id}`);
      await storage.delete(`underlays/${venue.id}`);
      for (const id of panoIds) await storage.delete(`panoramas/${id}`);
      for (const id of captureIds) await storage.delete(`captures/${id}`);
      return { ok: true };
    },
  );

  // Копия площадки с планом, местами и своими копиями панорам. Не опубликована, создатель — тот, кто копирует.
  app.post('/:id/duplicate', { schema: { params: VenueId } }, async (req, reply) => {
    const user = requireUser(req);
    const source = await ownedVenue(db, req.params.id, user);
    const [draft] = await db.select({ doc: mapDrafts.doc }).from(mapDrafts).where(eq(mapDrafts.venueId, source.id)).limit(1);
    if (!draft) throw new ApiError(404, 'not_found', 'Черновик площадки не найден');
    const name = `${source.name} (копия)`.slice(0, 120);

    // Панорамы этой площадки копируются файлами под новыми ID, иначе копия зависела бы от исходной.
    // Встроенные демо-панорамы (demo-…) общие — их не трогаем.
    const ids = [...new Set(draft.doc.panoramas.map((p) => p.pano))].filter(isUuid);
    const own = ids.length
      ? await db.select().from(panoramas).where(and(eq(panoramas.venueId, source.id), inArray(panoramas.id, ids), eq(panoramas.status, 'ready')))
      : [];
    const mapping = new Map(own.map((p) => [p.id, randomUUID()]));
    for (const [from, to] of mapping) {
      for (const file of ['pano.jpg', 'preview.jpg']) await storage.copy(`panoramas/${from}/${file}`, `panoramas/${to}/${file}`);
    }

    const venue = await db.transaction(async (tx) => {
      const [created] = await tx.insert(venues).values({ ownerId: user.id, name, slug: slugWithSuffix(slugify(source.name)) }).returning();
      // Подложки готового плана лежат по площадке — копия получает свои файлы с теми же именами.
      for (const level of draft.doc.levels) {
        const asset = level.underlay?.asset;
        if (asset && isUuid(asset)) await storage.copy(`underlays/${source.id}/${asset}.jpg`, `underlays/${created!.id}/${asset}.jpg`);
      }
      if (own.length) {
        await tx.insert(panoramas).values(
          own.map((p) => ({ id: mapping.get(p.id)!, venueId: created!.id, source: p.source, status: 'ready' as const, width: p.width, height: p.height, createdBy: user.id })),
        );
      }
      const doc: MapDocument = structuredClone(draft.doc);
      doc.venue = { ...doc.venue, id: created!.id, name };
      doc.panoramas = doc.panoramas.map((p) => (mapping.has(p.pano) ? { ...p, pano: mapping.get(p.pano)! } : p));
      await tx.insert(mapDrafts).values({ venueId: created!.id, doc, updatedBy: user.id });
      return created!;
    });
    return reply.status(201).send({ venue: venueView(venue) });
  });

  // Снять с публикации: посетители по ссылке больше не открывают карту, черновик и история версий остаются.
  app.post('/:id/unpublish', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user);
    const [updated] = await db.update(venues).set({ publishedVersion: null, updatedAt: new Date() }).where(eq(venues.id, venue.id)).returning();
    return { venue: venueView(updated!) };
  });

  // ── Черновик карты ──

  app.get('/:id/draft', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user);
    const [draft] = await db
      .select({ revision: mapDrafts.revision, doc: mapDrafts.doc, updatedAt: mapDrafts.updatedAt, updatedBy: users.name })
      .from(mapDrafts)
      .leftJoin(users, eq(users.id, mapDrafts.updatedBy))
      .where(eq(mapDrafts.venueId, venue.id))
      .limit(1);
    return draft;
  });

  // Лёгкая проверка «не сохранил ли кто-то после меня»: редактор спрашивает раз в несколько секунд,
  // а весь документ забирает, только когда ревизия выросла.
  app.get('/:id/draft/revision', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user);
    const [row] = await db
      .select({ revision: mapDrafts.revision, updatedBy: users.name })
      .from(mapDrafts)
      .leftJoin(users, eq(users.id, mapDrafts.updatedBy))
      .where(eq(mapDrafts.venueId, venue.id))
      .limit(1);
    if (!row) throw new ApiError(404, 'not_found', 'Черновик не найден');
    return row;
  });

  app.put(
    '/:id/draft',
    {
      bodyLimit: 5 * 1024 * 1024,
      schema: { params: VenueId, body: Type.Object({ revision: Type.Integer({ minimum: 1 }), doc: MapDocumentSchema }) },
    },
    async (req) => {
      const user = requireUser(req);
      const venue = await ownedVenue(db, req.params.id, user);
      const doc = { ...req.body.doc, venue: { ...req.body.doc.venue, id: venue.id } };
      const issues = validateReferences(doc);
      if (issues.length) throw new ApiError(422, 'invalid_map', 'В карте есть ошибки ссылок', issues);

      // Оптимистичная блокировка: сохраняем, только если никто не сохранил раньше нас.
      const [saved] = await db
        .update(mapDrafts)
        .set({ doc, revision: req.body.revision + 1, updatedBy: user.id, updatedAt: new Date() })
        .where(and(eq(mapDrafts.venueId, venue.id), eq(mapDrafts.revision, req.body.revision)))
        .returning({ revision: mapDrafts.revision });
      if (!saved) {
        const [current] = await db
          .select({ revision: mapDrafts.revision, updatedAt: mapDrafts.updatedAt, updatedBy: users.name })
          .from(mapDrafts)
          .leftJoin(users, eq(users.id, mapDrafts.updatedBy))
          .where(eq(mapDrafts.venueId, venue.id));
        throw new ApiError(409, 'revision_conflict', 'Карту изменили в другом окне', current);
      }
      // Опубликованная карта обновляется при каждом сохранении, ссылка та же (ТЗ Е7).
      const publishedVersion = venue.publishedVersion !== null ? await publish(db, storage, venue.id, user.id) : null;
      return { revision: saved.revision, publishedVersion };
    },
  );

  // ── Публикация ──

  app.post('/:id/publish', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user);
    const version = await publish(db, storage, venue.id, user.id);
    return { version, url: `/m/${venue.slug}` };
  });

  app.get('/:id/versions', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user);
    const rows = await db
      .select({ version: mapVersions.version, createdAt: mapVersions.createdAt, createdBy: users.name })
      .from(mapVersions)
      .leftJoin(users, eq(users.id, mapVersions.createdBy))
      .where(eq(mapVersions.venueId, venue.id))
      .orderBy(desc(mapVersions.version))
      .limit(50);
    return { versions: rows };
  });
};
