const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export function neonSchema(): string {
  const schema = optionalEnv('NEON_SCHEMA', 'open_stock_hub');
  if (!IDENTIFIER_PATTERN.test(schema)) {
    throw new Error('NEON_SCHEMA must be a simple Postgres identifier.');
  }
  return schema;
}

export function quotePgIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function neonTable(tableName: string): string {
  return `${quotePgIdentifier(neonSchema())}.${quotePgIdentifier(tableName)}`;
}

export function configuredSnowflakeDatabase(): string {
  return optionalEnv('SNOWFLAKE_DATABASE', optionalEnv('SNOWFLAKE_DB', 'FOODBUY_MASALA_PROD'));
}

export function configuredSnowflakeSchema(): string {
  return optionalEnv('SNOWFLAKE_SCHEMA', 'COMPLIANCE_LAB');
}
