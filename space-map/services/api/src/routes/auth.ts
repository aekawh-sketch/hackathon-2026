import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { acceptSuggestions, demoVenue, DEMO_SLUG, type MapDocument } from '@space-map/map-core';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { configuredUser, CSRF_COOKIE, endSession, GUEST_PASSWORD_HASH, hashPassword, LoginThrottle, RateWindow, requireUser, startSession, USER_FIELDS, verifyPassword } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { mapDrafts, users, venues } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { slugWithSuffix } from '../venueTemplate.ts';
import type { AppDeps } from '../app.ts';

const Email = Type.String({ format: 'email', maxLength: 200 });
const Password = Type.String({ minLength: 8, maxLength: 200 });

/** Шаблон гостевой площадки: черновик опубликованной демо-площадки (с её панорамами) или встроенная демо-карта. */
async function demoTemplate(db: Db): Promise<MapDocument> {
  const [row] = await db
    .select({ doc: mapDrafts.doc })
    .from(mapDrafts)
    .innerJoin(venues, eq(venues.id, mapDrafts.venueId))
    .where(eq(venues.slug, DEMO_SLUG))
    .limit(1);
  if (row) return structuredClone(row.doc);
  let doc = demoVenue();
  for (const pa of doc.panoramas) doc = acceptSuggestions(doc, pa.id);
  return doc;
}

export const authRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db, config }) => {
  const throttle = new LoginThrottle();
  const guestLimit = new RateWindow(10, 60 * 60_000);
  // Адрес администратора сначала регистрируют, затем добавляют в конфигурацию.
  // Резервирование не позволяет занять ещё не созданный административный аккаунт через открытую форму.
  const checkRegistrationEmail = (email: string) => {
    if (config.adminEmails.includes(email)) throw new ApiError(403, 'reserved_email', 'Этот адрес зарезервирован администратором сервиса. Используйте вход.');
  };

  // Вход одной кнопкой: свой гостевой аккаунт и своя копия демо-площадки — гости не правят одну карту на всех.
  app.post('/guest', async (req, reply) => {
    // Повторное нажатие или возврат в другой вкладке не создаёт новый аккаунт.
    if (req.user) {
      if (!req.user.isGuest) throw new ApiError(409, 'already_signed_in', 'Вы уже вошли. Откройте «Мои площадки».');
      const [own] = await db.select({ id: venues.id }).from(venues).where(eq(venues.ownerId, req.user.id)).limit(1);
      if (own) return { user: req.user, venueId: own.id };
      const name = 'Демо-площадка — ваша копия';
      const doc = await demoTemplate(db);
      const venueId = await db.transaction(async (tx) => {
        const [venue] = await tx.insert(venues).values({ ownerId: req.user!.id, name, slug: slugWithSuffix('demo-copy') }).returning({ id: venues.id });
        doc.venue = { ...doc.venue, id: venue!.id, name };
        await tx.insert(mapDrafts).values({ venueId: venue!.id, doc, updatedBy: req.user!.id });
        return venue!.id;
      });
      return reply.status(201).send({ user: req.user, venueId });
    }
    guestLimit.hit(req.ip, 'Слишком много гостевых входов с этого адреса. Попробуйте через час или зарегистрируйтесь.');
    const guestUser = () => ({ email: `guest-${randomBytes(6).toString('hex')}@guest.space-map`, name: 'Гость', passwordHash: GUEST_PASSWORD_HASH, isGuest: true });

    const name = 'Демо-площадка — ваша копия';
    const { user, venueId } = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values(guestUser())
        .returning(USER_FIELDS);
      const [venue] = await tx.insert(venues).values({ ownerId: user!.id, name, slug: slugWithSuffix('demo-copy') }).returning({ id: venues.id });
      const doc = await demoTemplate(db);
      doc.venue = { ...doc.venue, id: venue!.id, name };
      await tx.insert(mapDrafts).values({ venueId: venue!.id, doc, updatedBy: user!.id });
      return { user: user!, venueId: venue!.id };
    });
    await startSession(db, config, reply, user.id, req);
    return reply.status(201).send({ user, venueId });
  });

  // Открытая регистрация создаёт обычного пользователя.
  app.post(
    '/register',
    {
      schema: {
        body: Type.Object({ email: Email, password: Password, name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }) }),
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      checkRegistrationEmail(email);
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length) throw new ApiError(409, 'email_taken', 'Этот email уже зарегистрирован. Войдите.');
      const [user] = await db
        .insert(users)
        .values({ email, name: req.body.name.trim(), passwordHash: await hashPassword(req.body.password) })
        .returning(USER_FIELDS);
      await startSession(db, config, reply, user!.id, req);
      return reply.status(201).send({ user });
    },
  );

  // Гость сохраняет аккаунт: те же пользователь и площадки, но с почтой и паролем — их можно открыть с любого устройства.
  // Регистрация так не умеет: она заводит нового пустого пользователя, а гостевые площадки остались бы у гостя.
  app.post(
    '/claim',
    { schema: { body: Type.Object({ email: Email, password: Password, name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }) }) } },
    async (req) => {
      const me = requireUser(req);
      if (!me.isGuest) throw new ApiError(409, 'not_guest', 'Аккаунт уже сохранён');
      const email = req.body.email.trim().toLowerCase();
      checkRegistrationEmail(email);
      const taken = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (taken.length) throw new ApiError(409, 'email_taken', 'Этот email уже зарегистрирован. Укажите другой.');
      const [user] = await db
        .update(users)
        .set({ email, name: req.body.name.trim(), passwordHash: await hashPassword(req.body.password), isGuest: false })
        .where(eq(users.id, me.id))
        .returning(USER_FIELDS);
      return { user: user! };
    },
  );

  app.post('/login', { schema: { body: Type.Object({ email: Email, password: Type.String({ maxLength: 200 }) }) } }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const key = `${email}|${req.ip}`;
    throttle.check(key);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Одинаковая ошибка для «нет такого» и «неверный пароль» — не подсказываем, какие email есть.
    if (!user || !(await verifyPassword(user.passwordHash, req.body.password))) {
      throttle.fail(key);
      throw new ApiError(401, 'bad_credentials', 'Неверный email или пароль');
    }
    throttle.success(key);
    await startSession(db, config, reply, user.id, req);
    return { user: configuredUser({ id: user.id, email: user.email, name: user.name, isGuest: user.isGuest, role: user.role }, config) };
  });

  app.post('/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });

  app.get('/me', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!req.user) await endSession(db, req, reply);
    else if (!req.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
        path: '/', secure: config.cookieSecure, sameSite: 'lax', httpOnly: false, maxAge: config.sessionDays * 86_400,
      });
    }
    return { user: requireUser(req) };
  });
};
