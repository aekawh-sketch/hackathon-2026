// Публичная часть для посетителя (ТЗ 5.11, 6.3): только опубликованные карты; закрытые — только владельцу.
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { planOutline, type MapDocument } from '@space-map/map-core';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import { panoramas, venues } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { isUuid, versionKey, type Venue } from '../venues.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Кто может смотреть опубликованную карту. Чужим — 404, а не 403: не подсказываем, что карта есть. */
function canView(venue: Venue, req: FastifyRequest, openAccess: boolean): boolean {
  const editor = !!req.user && (openAccess || req.user.id === venue.ownerId);
  if (venue.publishedVersion === null) return editor;
  return venue.visibility === 'public' || editor;
}

export const publicRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db, storage, config }) => {
  const venueBySlug = async (slug: string) => (await db.select().from(venues).where(eq(venues.slug, slug)).limit(1))[0];

  // Каталог «Все карты» для посетителя: только опубликованные открытые карты — то, что и так открывается по ссылке.
  // Счётчики, миниатюра плана и обложка — из опубликованной версии, а не из черновика.
  app.get('/p/index.json', async (_req, reply) => {
    const rows = await db
      .select()
      .from(venues)
      .where(and(isNotNull(venues.publishedVersion), eq(venues.visibility, 'public')))
      .orderBy(desc(venues.updatedAt))
      .limit(200);
    const list = [];
    for (const venue of rows) {
      const file = await storage.read(versionKey(venue.id, venue.publishedVersion!));
      if (!file) continue;
      const doc = JSON.parse(await streamText(file.stream)) as MapDocument;
      list.push({
        slug: venue.slug,
        name: doc.venue.name || venue.name,
        updatedAt: venue.updatedAt,
        stats: { units: doc.units.length, places: doc.places.filter((p) => !p.hidden).length, panoramas: doc.panoramas.length },
        thumb: planOutline(doc),
        coverPano: doc.panoramas[0]?.pano ?? null,
      });
    }
    reply.header('cache-control', 'public, max-age=30');
    return { venues: list };
  });

  app.get('/p/:slug/latest.json', { schema: { params: Type.Object({ slug: Type.String({ maxLength: 48 }) }) } }, async (req, reply) => {
    const venue = await venueBySlug(req.params.slug);
    if (!venue || venue.publishedVersion === null || !canView(venue, req, config.openAccess)) throw notFound('Карта не найдена или закрыта');
    // Короткий кэш: после сохранения посетители увидят новую версию в пределах минуты.
    reply.header('cache-control', venue.visibility === 'public' ? 'public, max-age=30' : 'private, no-store');
    return { version: venue.publishedVersion, url: `/p/${venue.slug}/v/${venue.publishedVersion}/map.json` };
  });

  app.get(
    '/p/:slug/v/:version/map.json',
    { schema: { params: Type.Object({ slug: Type.String({ maxLength: 48 }), version: Type.Integer({ minimum: 1 }) }) } },
    async (req, reply) => {
      const venue = await venueBySlug(req.params.slug);
      if (!venue || venue.publishedVersion === null || req.params.version > venue.publishedVersion || !canView(venue, req, config.openAccess)) {
        throw notFound('Версия карты не найдена');
      }
      const file = await storage.read(versionKey(venue.id, req.params.version));
      if (!file) throw notFound('Версия карты не найдена');
      return sendFile(reply, file, 'application/json; charset=utf-8', venue.visibility === 'public' ? IMMUTABLE : 'private, no-store');
    },
  );

  // Файлы панорамы: открыты, если панорама на публичной опубликованной карте; иначе — только владельцу.
  app.get(
    '/files/panoramas/:id/:file',
    { schema: { params: Type.Object({ id: Type.String(), file: Type.Union([Type.Literal('pano.jpg'), Type.Literal('preview.jpg')]) }) } },
    async (req, reply) => {
      if (!isUuid(req.params.id)) throw notFound();
      const [row] = await db
        .select({ venue: venues })
        .from(panoramas)
        .innerJoin(venues, eq(venues.id, panoramas.venueId))
        .where(and(eq(panoramas.id, req.params.id), eq(panoramas.status, 'ready')))
        .limit(1);
      if (!row || !canView(row.venue, req, config.openAccess)) throw notFound('Панорама не найдена');
      const file = await storage.read(`panoramas/${req.params.id}/${req.params.file}`);
      if (!file) throw notFound('Панорама не найдена');
      const isPublic = row.venue.publishedVersion !== null && row.venue.visibility === 'public';
      return sendFile(reply, file, 'image/jpeg', isPublic ? IMMUTABLE : 'private, no-store');
    },
  );
};

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function sendFile(reply: FastifyReply, file: { stream: NodeJS.ReadableStream; size: number }, type: string, cache: string) {
  return reply.header('content-type', type).header('content-length', file.size).header('cache-control', cache).send(file.stream);
}
