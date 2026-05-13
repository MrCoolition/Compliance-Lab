import snowflake from 'snowflake-sdk';
import { readFileSync } from 'node:fs';
import { configuredSnowflakeDatabase, configuredSnowflakeSchema, optionalEnv, requiredEnv } from './env';

export type SnowflakeRow = Record<string, unknown>;
type SnowflakeConnection = ReturnType<typeof snowflake.createConnection>;

function configuredPrivateKey(): string {
  const inlineKey = optionalEnv('SNOWFLAKE_PRIVATE_KEY');
  if (inlineKey) {
    return inlineKey.replace(/\\n/g, '\n');
  }

  const base64Key = optionalEnv('SNOWFLAKE_PRIVATE_KEY_BASE64');
  if (base64Key) {
    return Buffer.from(base64Key, 'base64').toString('utf8');
  }

  const keyPath = optionalEnv('SNOWFLAKE_PRIVATE_KEY_PATH');
  if (keyPath) {
    return readFileSync(keyPath, 'utf8');
  }

  return '';
}

function createConnection(): SnowflakeConnection {
  const role = optionalEnv('SNOWFLAKE_ROLE');
  const authenticator = optionalEnv('SNOWFLAKE_AUTHENTICATOR');
  const authenticatorUpper = authenticator.toUpperCase();
  const privateKey = configuredPrivateKey();
  const privateKeyPass = optionalEnv('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE');
  const password = optionalEnv('SNOWFLAKE_PASSWORD');
  const oauthToken = optionalEnv('SNOWFLAKE_OAUTH_TOKEN') || optionalEnv('SNOWFLAKE_TOKEN');
  const browserSso = authenticatorUpper === 'EXTERNALBROWSER';
  const oauth = authenticatorUpper === 'OAUTH';

  if (oauth && !oauthToken) {
    throw new Error('Missing Snowflake OAuth token. Set SNOWFLAKE_OAUTH_TOKEN.');
  }

  if (!browserSso && !oauth && !privateKey && !password) {
    throw new Error('Missing Snowflake authentication. Set SNOWFLAKE_AUTHENTICATOR=EXTERNALBROWSER, SNOWFLAKE_PASSWORD, or SNOWFLAKE_PRIVATE_KEY.');
  }

  const connectionOptions: Record<string, unknown> = {
    account: requiredEnv('SNOWFLAKE_ACCOUNT'),
    username: requiredEnv('SNOWFLAKE_USERNAME'),
    warehouse: requiredEnv('SNOWFLAKE_WAREHOUSE'),
    database: configuredSnowflakeDatabase(),
    schema: configuredSnowflakeSchema(),
    ...(role ? { role } : {}),
    ...(authenticator ? { authenticator } : {}),
    ...(oauth ? { token: oauthToken } : {}),
    ...(!oauth && privateKey ? { privateKey } : {}),
    ...(!oauth && !privateKey && password ? { password } : {}),
    ...(privateKey && privateKeyPass ? { privateKeyPass } : {}),
    ...(optionalEnv('SNOWFLAKE_CLIENT_STORE_TEMPORARY_CREDENTIAL').toLowerCase() === 'true'
      ? { clientStoreTemporaryCredential: true }
      : {}),
  };

  return snowflake.createConnection(connectionOptions as Parameters<typeof snowflake.createConnection>[0]);
}

function connect(connection: SnowflakeConnection): Promise<void> {
  const asyncConnection = connection as SnowflakeConnection & {
    connectAsync?: (callback?: (error?: Error | null) => void) => Promise<unknown>;
  };
  if (typeof asyncConnection.connectAsync === 'function') {
    return asyncConnection.connectAsync().then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function destroy(connection: SnowflakeConnection): Promise<void> {
  return new Promise((resolve) => {
    connection.destroy(() => resolve());
  });
}

export async function runSnowflakeQuery<T extends SnowflakeRow = SnowflakeRow>(
  sqlText: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const connection = createConnection();
  await connect(connection);

  try {
    return await new Promise<T[]>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (error, _statement, rows) => {
          if (error) {
            reject(error);
            return;
          }
          resolve((rows ?? []) as T[]);
        },
      });
    });
  } finally {
    await destroy(connection);
  }
}

export async function runSnowflakeStatement(sqlText: string, binds: unknown[] = []): Promise<number> {
  const connection = createConnection();
  await connect(connection);

  try {
    return await new Promise<number>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (error, statement) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(statement?.getNumRowsAffected?.() ?? 0);
        },
      });
    });
  } finally {
    await destroy(connection);
  }
}

export function quoteSnowflakeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function insertDateKeyExpression(columnSql: string): string {
  return `SUBSTR(REGEXP_REPLACE(TO_VARCHAR(${columnSql}), '[^0-9]', ''), 1, 8)`;
}
