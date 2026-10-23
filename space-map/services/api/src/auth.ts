// Вход организаторов (ТЗ 6.1): argon2id, сессия в httpOnly-cookie, CSRF по схеме double-submit,
// пауза после 5 неверных паролей.
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { sessions, users } from './db/schema.ts';
import { ApiError, unauthorized } from './errors.ts';

export const SESSION_COOKIE = 'sm_session';
export const CSRF_COOKIE = 'sm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
}

/** У гостя нет пароля: это значение не разбирается как хэш argon2, поэтому вход по паролю невозможен. */
export const GUEST_PASSWORD_HASH = '!guest-no-password';

/** Не больше max событий за windowMs с одного ключа (IP). В памяти процесса, как и LoginThrottle. */
export class RateWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, message: string): void {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) throw new ApiError(429, 'rate_limited', message);
    recent.push(now);
    this.hits.set(key, recent);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export const hashPassword = (password: string) => hash(password, { algorithm: 2 /* argon2id */ });
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);

/** Пауза после неверных паролей. В памяти процесса: API один, для нескольких копий — вынести в БД. */
export class LoginThrottle {
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxFails = 5,
    private readonly lockMs = 5 * 60_000,
  ) {}

  check(key: string): void {
    const entry = this.fails.get(key);
    if (entry && entry.until > Date.now()) {
      const minutes = Math.ceil((entry.until - Date.now()) / 60_000);
      throw new ApiError(429, 'too_many_attempts', `Слишком много попыток. Попробуйте через ${minutes} мин.`);
    }
  }

  fail(key: string): void {
    const entry = this.fails.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= this.maxFails) {
      entry.until = Date.now() + this.lockMs;
      entry.count = 0;
    }
    this.fails.set(key, entry);
  }

  success(key: string): void {
    this.fails.delete(key);
  }
}

export async function startSession(db: Db, config: Config, reply: FastifyReply, userId: string): Promise<void> {
  const raw = token();
  await db.insert(sessions).values({
    tokenHash: sha256(raw),
    userId,
    expiresAt: new Date(Date.now() + config.sessionDays * 86_400_000),
  });
  const base = { path: '/', secure: config.cookieSecure, sameSite: 'lax' as const, maxAge: config.sessionDays * 86_400 };
  reply.setCookie(SESSION_COOKIE, raw, { ...base, httpOnly: true });
  // CSRF-токен читает фронт и шлёт заголовком; чужой сайт его не прочитает.
  reply.setCookie(CSRF_COOKIE, token(), { ...base, httpOnly: false });
}

export async function endSession(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(raw)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Достаёт пользователя по cookie в каждом запросе и проверяет CSRF у изменяющих запросов. */
export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const [row] = await db
      .select({ id: users.id, email: users.email, name: users.name, isGuest: users.isGuest })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(raw)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    req.user = row ?? null;
  });

  app.addHook('preHandler', async (req) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    if (!req.cookies[SESSION_COOKIE]) return; // без сессии нечего подделывать
    const cookie = req.cookies[CSRF_COOKIE] ?? '';
    const header = String(req.headers[CSRF_HEADER] ?? '');
    const ok = cookie.length > 0 && cookie.length === header.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
    if (!ok) throw new ApiError(403, 'csrf', 'Сессия устарела. Обновите страницу.');
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
