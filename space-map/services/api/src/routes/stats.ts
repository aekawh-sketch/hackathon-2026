// Статистика просмотров: карта посетителя присылает события, организатор смотрит отчёт по своей площадке.
// Храним только счётчики по дням — ни cookies, ни адресов, ни устройств посетителей.
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { AppDeps } from '../app.ts';
import { requireUser } from '../auth.ts';
import { venueStats, venues } from '../db/schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { ownedVenue } from '../venues.ts';

const KINDS = ['open', 'place', 'route', 'panorama', 'search_miss'] as const;
type Kind = (typeof KINDS)[number];

/** День по Москве: кейс и площадки — в России, сутки отчёта не должны резаться по UTC. */
const TODAY = sql`(now() at time zone 'Europe/Moscow')::date`;

/** Не больше стольких событий в минуту с одного адреса — счётчики не накрутить скриптом. */
const PER_MINUTE = 60;

export const statsRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db }) => {
  const recent = new Map<string, { count: number; reset: number }>();
  const allow = (key: string, n: number): boolean => {
    const now = Date.now();
    const entry = recent.get(key);
    if (!entry || entry.reset < now) {
      if (recent.size > 10_000) recent.clear();
      recent.set(key, { count: n, reset: now + 60_000 });
      return n <= PER_MINUTE;
    }
    entry.count += n;
    return entry.count <= PER_MINUTE;
  };

  app.post(
    '/p/:slug/events',
    {
      schema: {
        params: Type.Object({ slug: Type.String({ maxLength: 48 }) }),
        body: Type.Object({
          events: Type.Array(
            Type.Object({
              kind: Type.Union(KINDS.map((k) => Type.Literal(k))),
              target: Type.Optional(Type.String({ maxLength: 64 })),
            }),
            { minItems: 1, maxItems: 20 },
          ),
        }),
      },
    },
    async (req, reply) => {
      const [venue] = await db.select().from(venues).where(eq(venues.slug, req.params.slug)).limit(1);
      if (!venue || venue.publishedVersion === null) throw notFound('Карта не найдена');
      if (!allow(`${req.ip}:${venue.id}`, req.body.events.length)) throw new ApiError(429, 'too_many_events', 'Слишком много событий');
      // Одинаковые события пачки — одной строкой: ON CONFLICT не обновляет строку дважды за запрос.
      const counts = new Map<string, { kind: Kind; target: string; count: number }>();
      for (const e of req.body.events) {
        const target = cleanTarget(e.kind, e.target ?? '');
        if (target === null) continue;
        const key = `${e.kind}\u0000${target}`;
        const row = counts.get(key) ?? { kind: e.kind, target, count: 0 };
        row.count++;
        counts.set(key, row);
      }
      if (counts.size > 0) {
        await db
          .insert(venueStats)
          .values([...counts.values()].map((r) => ({ venueId: venue.id, day: TODAY, kind: r.kind, target: r.target, count: r.count })))
          .onConflictDoUpdate({
            target: [venueStats.venueId, venueStats.day, venueStats.kind, venueStats.target],
            set: { count: sql`${venueStats.count} + excluded.count` },
          });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    '/api/venues/:id/stats',
    { schema: { params: Type.Object({ id: Type.String() }), querystring: Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })) }) } },
    async (req) => {
      const venue = await ownedVenue(db, req.params.id, requireUser(req));
      const days = req.query.days ?? 30;
      const since = sql`${TODAY} - ${days - 1}::int`;
      const scope = and(eq(venueStats.venueId, venue.id), gte(venueStats.day, since));
      const daily = await db
        .select({ day: venueStats.day, kind: venueStats.kind, count: sql<number>`sum(${venueStats.count})::int` })
        .from(venueStats)
        .where(scope)
        .groupBy(venueStats.day, venueStats.kind)
        .orderBy(venueStats.day);
      const top = async (kind: Kind, limit: number) =>
        db
          .select({ target: venueStats.target, count: sql<number>`sum(${venueStats.count})::int` })
          .from(venueStats)
          .where(and(scope, eq(venueStats.kind, kind)))
          .groupBy(venueStats.target)
          .orderBy(desc(sql`sum(${venueStats.count})`))
          .limit(limit);
      const [today] = (await db.execute(sql`select ${TODAY}::text as day`)).rows as { day: string }[];
      return {
        days,
        today: today!.day,
        daily,
        places: await top('place', 20),
        routes: await top('route', 10),
        panoramas: await top('panorama', 10),
        misses: await top('search_miss', 10),
      };
    },
  );
};

/** ID места или панорамы — как в документе карты; запрос поиска — коротко и без лишних знаков. null — не записываем. */
function cleanTarget(kind: Kind, target: string): string | null {
  if (kind === 'open') return '';
  if (kind === 'search_miss') {
    const q = target.toLowerCase().replace(/[^\p{L}\p{N} -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    return q.length >= 2 ? q : null;
  }
  if (kind === 'route' && target === '') return '';
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(target) ? target : null;
}
