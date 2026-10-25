export interface Config {
  port: number;
  databaseUrl: string;
  storageDir: string;
  cookieSecure: boolean;
  /** Срок сессии организатора. */
  sessionDays: number;
  /**
   * Код администратора (`ADMIN_INVITE_CODE`): с ним регистрируются администраторы — они видят и правят все площадки.
   * Нет кода (или короче 8 символов) — администратором не стать, у каждого только свои площадки.
   */
  adminCode: string | null;
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
    adminCode: env.ADMIN_INVITE_CODE && env.ADMIN_INVITE_CODE.trim().length >= 8 ? env.ADMIN_INVITE_CODE.trim() : null,
    logger: env.NODE_ENV !== 'test',
  };
}
