import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { registerAuth } from './auth.ts';
import type { Config } from './config.ts';
import { createDb, type Db } from './db/client.ts';
import { errorHandler } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { mediaRoutes } from './routes/media.ts';
import { publicRoutes } from './routes/public.ts';
import { statsRoutes } from './routes/stats.ts';
import { venueRoutes } from './routes/venues.ts';
import { LocalStorage, type Storage } from './storage.ts';

export interface AppDeps {
  db: Db;
  storage: Storage;
  config: Config;
}

export async function buildApp(config: Config) {
  const { db, pool } = createDb(config.databaseUrl);
  const storage = new LocalStorage(config.storageDir);
  const deps: AppDeps = { db, storage, config };

  const app = Fastify({
    logger: config.logger ? { level: 'info' } : false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler(errorHandler);
  app.addHook('onClose', async () => pool.end());
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 60_000_000, files: 1 } });
  await app.register(swagger, {
    openapi: { info: { title: 'Карта пространства — API', version: '0.1.0' } },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  registerAuth(app, db, config);

  app.get('/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth', ...deps });
  await app.register(venueRoutes, { prefix: '/api/venues', ...deps });
  await app.register(mediaRoutes, { prefix: '/api/venues', ...deps });
  await app.register(publicRoutes, deps);
  await app.register(statsRoutes, deps);

  return app;
}
