import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { validateReferences } from '@space-map/map-core';
import { and, desc, eq } from 'drizzle-orm';
import type { AppDeps } from '../app.ts';
import { requireUser } from '../auth.ts';
import { mapDrafts, mapVersions, users, venues } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { MapDocumentSchema } from '../mapSchema.ts';
import { emptyVenueDoc, isValidSlug, slugify, slugWithSuffix } from '../venueTemplate.ts';
import { ownedVenue, publish, type Venue } from '../venues.ts';

const VenueId = Type.Object({ id: Type.String() });

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

export const venueRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db, storage }) => {
  app.get('/', async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(venues).where(eq(venues.ownerId, user.id)).orderBy(desc(venues.updatedAt));
    return { venues: rows.map(venueView) };
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
    return { venue: venueView(await ownedVenue(db, req.params.id, user.id)) };
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
      const venue = await ownedVenue(db, req.params.id, user.id);
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
      const venue = await ownedVenue(db, req.params.id, user.id);
      if (req.body.confirmName.trim() !== venue.name) throw new ApiError(422, 'confirm_mismatch', 'Введите точное название площадки');
      await db.delete(venues).where(eq(venues.id, venue.id));
      await storage.delete(`versions/${venue.id}`);
      return { ok: true };
    },
  );

  // ── Черновик карты ──

  app.get('/:id/draft', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user.id);
    const [draft] = await db
      .select({ revision: mapDrafts.revision, doc: mapDrafts.doc, updatedAt: mapDrafts.updatedAt, updatedBy: users.name })
      .from(mapDrafts)
      .leftJoin(users, eq(users.id, mapDrafts.updatedBy))
      .where(eq(mapDrafts.venueId, venue.id))
      .limit(1);
    return draft;
  });

  app.put(
    '/:id/draft',
    {
      bodyLimit: 5 * 1024 * 1024,
      schema: { params: VenueId, body: Type.Object({ revision: Type.Integer({ minimum: 1 }), doc: MapDocumentSchema }) },
    },
    async (req) => {
      const user = requireUser(req);
      const venue = await ownedVenue(db, req.params.id, user.id);
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
    const venue = await ownedVenue(db, req.params.id, user.id);
    const version = await publish(db, storage, venue.id, user.id);
    return { version, url: `/m/${venue.slug}` };
  });

  app.get('/:id/versions', { schema: { params: VenueId } }, async (req) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user.id);
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
