import { Pool } from '@neondatabase/serverless';
import { neonTable, requiredEnv } from './env';

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requiredEnv('DATABASE_URL'),
    });
  }
  return pool;
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function dbExecute(text: string, params: unknown[] = []): Promise<number> {
  const result = await getPool().query(text, params);
  return result.rowCount ?? 0;
}

export async function assertSchemaReady(): Promise<void> {
  await dbQuery(`select 1 from ${neonTable('hub_rows')} limit 1`);
}
