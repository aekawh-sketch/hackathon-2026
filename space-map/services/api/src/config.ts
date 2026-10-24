export interface Config {
  port: number;
  databaseUrl: string;
  storageDir: string;
  cookieSecure: boolean;
  /** Срок сессии организатора. */
  sessionDays: number;
  /**
   * Временный общий доступ (стенд команды): любой вошедший видит и правит все площадки.
   * Выключен по умолчанию — включать только на демо-стенде, не в продакшене.
   */
  openAccess: boolean;
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
    openAccess: env.OPEN_ACCESS === 'true',
    logger: env.NODE_ENV !== 'test',
  };
}
