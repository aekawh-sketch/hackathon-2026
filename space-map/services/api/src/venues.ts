// Доступ к площадке и публикация (ТЗ 5.11, 6.2). Чужая площадка — 404, чтобы не раскрывать, что она существует.
import { validateReferences, type MapDocument } from '@space-map/map-core';
import { and, eq, max } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { isAdmin, type SessionUser } from './auth.ts';
import type { Db } from './db/client.ts';
import { mapDrafts, mapVersions, venues } from './db/schema.ts';
import { ApiError, notFound } from './errors.ts';
import type { Storage } from './storage.ts';

export type Venue = typeof venues.$inferSelect;

/** Площадка, которую этот пользователь может править: своя, а администратору — любая. */
export async function ownedVenue(db: Db, venueId: string, user: SessionUser): Promise<Venue> {
  if (!isUuid(venueId)) throw notFound('Площадка не найдена');
  const [venue] = await db
    .select()
    .from(venues)
    .where(isAdmin(user) ? eq(venues.id, venueId) : and(eq(venues.id, venueId), eq(venues.ownerId, user.id)))
    .limit(1);
  if (!venue) throw notFound('Площадка не найдена');
  return venue;
}

export const versionKey = (venueId: string, version: number) => `versions/${venueId}/${version}.json`;

/**
 * Публикация: снимок черновика пишется файлом, потом в одной транзакции — учёт версии и указатель «последняя».
 * Сбой между шагами оставляет лишний файл, но текущую карту не ломает.
 */
export async function publish(db: Db, storage: Storage, venueId: string, userId: string): Promise<number> {
  const [draft] = await db.select().from(mapDrafts).where(eq(mapDrafts.venueId, venueId)).limit(1);
  if (!draft) throw notFound('Черновик не найден');
  const issues = validateReferences(draft.doc);
  if (issues.length) throw new ApiError(422, 'invalid_map', 'В карте есть ошибки ссылок', issues);

  return db.transaction(async (tx) => {
    // Блокируем строку площадки: две публикации подряд не получат один номер версии.
    await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId)).for('update');
    const [{ last } = { last: 0 }] = await tx
      .select({ last: max(mapVersions.version) })
      .from(mapVersions)
      .where(eq(mapVersions.venueId, venueId));
    const version = (last ?? 0) + 1;
    const body = JSON.stringify(draft.doc satisfies MapDocument);
    await storage.put(versionKey(venueId, version), body);
    await tx.insert(mapVersions).values({ venueId, version, sha256: createHash('sha256').update(body).digest('hex'), createdBy: userId });
    await tx.update(venues).set({ publishedVersion: version, updatedAt: new Date() }).where(eq(venues.id, venueId));
    return version;
  });
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
