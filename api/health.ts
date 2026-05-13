import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dbQuery } from './_lib/database';
import { neonSchema } from './_lib/env';
import { sendJson } from './_lib/http';
import { runSnowflakeQuery } from './_lib/snowflake';

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
    schema: neonSchema(),
  };

  let neon = process.env.DATABASE_URL ? 'not_checked' : 'not_configured';
  try {
    if (process.env.DATABASE_URL) {
      await dbQuery('select 1 as ok');
      neon = 'ok';
    }
  } catch {
    neon = 'failed';
  }

  let snowflake = checks.snowflakeAccount && checks.snowflakeUsername && checks.snowflakeAuth && checks.snowflakeWarehouse ? 'not_checked' : 'not_configured';
  try {
    if (snowflake === 'not_checked') {
      await runSnowflakeQuery('select current_database() as DATABASE_NAME, current_schema() as SCHEMA_NAME');
      snowflake = 'ok';
    }
  } catch {
    snowflake = 'failed';
  }

  sendJson(response, 200, {
    ok: snowflake === 'ok',
    neon,
    snowflake,
    checks,
  });
}
