export interface Config {
  port: number;
  databaseUrl: string;
  storageDir: string;
  cookieSecure: boolean;
  /** Срок сессии организатора. */
  sessionDays: number;
  /** Почты существующих аккаунтов администраторов всего сервиса, только из .env. */
  adminEmails: string[];
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
    adminEmails: [...new Set((env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))],
    logger: env.NODE_ENV !== 'test',
  };
}
