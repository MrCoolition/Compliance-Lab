import type { VercelRequest, VercelResponse } from '@vercel/node';

function sendJson(response: VercelResponse, status: number, body: unknown): void {
  response.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(body));
}

export default async function handler(_request: VercelRequest, response: VercelResponse): Promise<void> {
  const authenticator = String(process.env.SNOWFLAKE_AUTHENTICATOR || '').toUpperCase();
  const browserSso = authenticator === 'EXTERNALBROWSER';
  const oauth = authenticator === 'OAUTH';
  const hasPasswordOrKey = Boolean(
    process.env.SNOWFLAKE_PASSWORD
      || process.env.SNOWFLAKE_PRIVATE_KEY
      || process.env.SNOWFLAKE_PRIVATE_KEY_BASE64
      || process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
  );
  const hasOauthToken = Boolean(process.env.SNOWFLAKE_OAUTH_TOKEN || process.env.SNOWFLAKE_TOKEN);
  const hasAuth = browserSso || (oauth ? hasOauthToken : hasPasswordOrKey);

  const checks = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    snowflakeAccount: Boolean(process.env.SNOWFLAKE_ACCOUNT),
    snowflakeUsername: Boolean(process.env.SNOWFLAKE_USERNAME),
    snowflakeAuth: hasAuth,
    snowflakeWarehouse: Boolean(process.env.SNOWFLAKE_WAREHOUSE),
    schema: process.env.NEON_SCHEMA || 'open_stock_hub',
  };

  let neon = process.env.DATABASE_URL ? 'not_checked' : 'not_configured';
  let neonError = '';
  try {
    if (process.env.DATABASE_URL) {
      const { dbQuery } = await import('./_lib/database');
      await dbQuery('select 1 as ok');
      neon = 'ok';
    }
  } catch (error) {
    neon = 'failed';
    neonError = error instanceof Error ? error.message : String(error);
  }

  let snowflake = checks.snowflakeAccount && checks.snowflakeUsername && checks.snowflakeAuth && checks.snowflakeWarehouse ? 'not_checked' : 'not_configured';
  let snowflakeError = '';
  try {
    if (snowflake === 'not_checked') {
      const { runSnowflakeQuery } = await import('./_lib/snowflake');
      await runSnowflakeQuery('select current_database() as DATABASE_NAME, current_schema() as SCHEMA_NAME');
      snowflake = 'ok';
    }
  } catch (error) {
    snowflake = 'failed';
    snowflakeError = error instanceof Error ? error.message : String(error);
  }

  sendJson(response, 200, {
    ok: snowflake === 'ok',
    neon,
    snowflake,
    checks,
    errors: {
      neon: neonError || undefined,
      snowflake: snowflakeError || undefined,
    },
  });
}
