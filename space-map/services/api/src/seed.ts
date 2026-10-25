// Демо-организатор, карта манежа с 12 панорамами и пример campus.
// Существующие планы и версии не перезаписываем.
import { campusVenue, demoVenue, DEMO_SLUG } from '@space-map/map-core';
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { mapDrafts, users, venues } from './db/schema.ts';
import { LocalStorage } from './storage.ts';
import { publish } from './venues.ts';

const config = loadConfig();
const email = process.env.DEMO_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_PASSWORD;
if (!email || !password || password.length < 8) {
  throw new Error('Задайте DEMO_EMAIL и DEMO_PASSWORD (от 8 символов) в services/api/.env');
}

await migrate(config.databaseUrl, console.log);
const { db, pool } = createDb(config.databaseUrl);
const storage = new LocalStorage(config.storageDir);

let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) {
  [user] = await db.insert(users).values({ email, name: 'Демо-организатор', passwordHash: await hashPassword(password) }).returning();
  console.log(`создан организатор ${email}`);
} else {
  console.log(`организатор ${email} уже есть — пароль не меняю`);
}

// Перенос прежнего адреса на /m/demo сохраняет владельца, черновик, версии и панорамы.
const LEGACY_DEMO_SLUG = 'hakaton-osen-2026-manezh-dgtu-bccf39';
if (!(await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, DEMO_SLUG)).limit(1)).length) {
  await db.update(venues).set({ slug: DEMO_SLUG }).where(eq(venues.slug, LEGACY_DEMO_SLUG));
}
const [existing] = await db.select().from(venues).where(eq(venues.slug, DEMO_SLUG)).limit(1);
const STOCK_DEMO_NAME = 'Демо-площадка «Бизнес-центр»';
const HACKATHON_NAME = 'Хакатон «Осень 2026» — Манеж ДГТУ';

if (!existing) {
  const [venue] = await db.insert(venues).values({ ownerId: user!.id, name: HACKATHON_NAME, slug: DEMO_SLUG }).returning();
  const doc = demoVenue();
  doc.venue.id = venue!.id;
  await db.insert(mapDrafts).values({ venueId: venue!.id, doc, updatedBy: user!.id });
  const version = await publish(db, storage, venue!.id, user!.id);
  console.log(`площадка demo опубликована, версия ${version}: /m/${DEMO_SLUG}`);
} else {
  const [draft] = await db.select().from(mapDrafts).where(eq(mapDrafts.venueId, existing.id)).limit(1);
  const isStockDemo = existing.name === STOCK_DEMO_NAME || draft?.doc.venue.name === STOCK_DEMO_NAME;
  if (!isStockDemo) {
    console.log('площадка demo уже изменена — пропускаю, чтобы сохранить её план');
  } else {
    const doc = demoVenue();
    doc.venue.id = existing.id;
    await db.transaction(async (tx) => {
      await tx.update(venues).set({ name: HACKATHON_NAME, updatedAt: new Date() }).where(eq(venues.id, existing.id));
      if (draft) {
        await tx.update(mapDrafts).set({ doc, revision: draft.revision + 1, updatedBy: user!.id, updatedAt: new Date() }).where(eq(mapDrafts.venueId, existing.id));
      } else {
        await tx.insert(mapDrafts).values({ venueId: existing.id, doc, updatedBy: user!.id });
      }
    });
    const version = await publish(db, storage, existing.id, user!.id);
    console.log(`стандартная демо-площадка обновлена и опубликована, версия ${version}: /m/${DEMO_SLUG}`);
  }
}

// Пример из нескольких зданий: этажи, лестницы, территория между корпусами.
const [campus] = await db.select().from(venues).where(eq(venues.slug, 'campus')).limit(1);
if (!campus) {
  const doc = campusVenue();
  const [venue] = await db.insert(venues).values({ ownerId: user!.id, name: doc.venue.name, slug: 'campus' }).returning();
  doc.venue.id = venue!.id;
  await db.insert(mapDrafts).values({ venueId: venue!.id, doc, updatedBy: user!.id });
  const version = await publish(db, storage, venue!.id, user!.id);
  console.log(`площадка campus опубликована, версия ${version}: /m/campus`);
} else {
  console.log('площадка campus уже есть — пропускаю');
}

await pool.end();
