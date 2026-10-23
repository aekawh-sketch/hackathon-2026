// Демо-данные (ТЗ 11.3): организатор из DEMO_EMAIL / DEMO_PASSWORD и опубликованная площадка «demo»
// с панорамами из apps/web/public/demo/panoramas. Ничего не удаляет: что уже есть — пропускает.
import { acceptSuggestions, demoVenue } from '@space-map/map-core';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { mapDrafts, panoramas, users, venues } from './db/schema.ts';
import { processPanorama } from './images.ts';
import { LocalStorage } from './storage.ts';
import { publish } from './venues.ts';

const DEMO_PANORAMAS = fileURLToPath(new URL('../../../apps/web/public/demo/panoramas/', import.meta.url));

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

const [existing] = await db.select().from(venues).where(eq(venues.slug, 'demo')).limit(1);
if (existing) {
  console.log('площадка demo уже есть — пропускаю');
} else {
  const [venue] = await db.insert(venues).values({ ownerId: user!.id, name: 'Демо-площадка «Бизнес-центр»', slug: 'demo' }).returning();
  let doc = demoVenue();
  doc.venue.id = venue!.id;

  // Демо-панорамы проходят тот же путь, что и загрузка организатором.
  for (const placement of doc.panoramas) {
    const out = await processPanorama(await readFile(`${DEMO_PANORAMAS}${placement.pano}.jpg`));
    const [row] = await db
      .insert(panoramas)
      .values({ venueId: venue!.id, source: 'upload', status: 'ready', width: out.width, height: out.height, createdBy: user!.id })
      .returning();
    await storage.put(`panoramas/${row!.id}/pano.jpg`, out.pano);
    await storage.put(`panoramas/${row!.id}/preview.jpg`, out.preview);
    placement.pano = row!.id;
  }
  for (const pa of doc.panoramas) doc = acceptSuggestions(doc, pa.id);

  await db.insert(mapDrafts).values({ venueId: venue!.id, doc, updatedBy: user!.id });
  const version = await publish(db, storage, venue!.id, user!.id);
  console.log(`площадка demo опубликована, версия ${version}: /m/demo`);
}

await pool.end();
