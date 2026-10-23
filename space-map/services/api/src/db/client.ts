import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}
