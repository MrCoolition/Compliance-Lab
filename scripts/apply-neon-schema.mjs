import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (process.env[key]) {
      continue;
    }
    process.env[key] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
}

loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'));

const schema = process.env.NEON_SCHEMA || 'open_stock_hub';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  throw new Error('NEON_SCHEMA must be a simple Postgres identifier.');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to apply the Neon schema.');
}

const migrationPath = resolve(root, 'db/migrations/001_neon_cache_schema.sql');
const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll('__SCHEMA__', `"${schema}"`);
const statements = migrationSql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

const pool = new Pool({ connectionString });
try {
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log(`Applied Neon schema migration to schema "${schema}".`);
} finally {
  await pool.end();
}
