export interface Config {
  port: number;
  databaseUrl: string;
  storageDir: string;
  cookieSecure: boolean;
  /** Срок сессии организатора. */
  sessionDays: number;
  logger: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Нет DATABASE_URL — см. services/api/.env.example');
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
    storageDir: env.STORAGE_DIR ?? './data',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionDays: 14,
    logger: env.NODE_ENV !== 'test',
  };
}
