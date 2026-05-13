function hasSnowflakeAuth() {
  const authenticator = String(process.env.SNOWFLAKE_AUTHENTICATOR || '').toUpperCase();
  if (authenticator === 'EXTERNALBROWSER') {
    return true;
  }
  if (authenticator === 'OAUTH') {
    return Boolean(process.env.SNOWFLAKE_OAUTH_TOKEN || process.env.SNOWFLAKE_TOKEN);
  }
  return Boolean(
    process.env.SNOWFLAKE_PASSWORD
      || process.env.SNOWFLAKE_PRIVATE_KEY
      || process.env.SNOWFLAKE_PRIVATE_KEY_BASE64
      || process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
  );
}

export default function handler(_request, response) {
  const body = {
    ok: true,
    status: 'function_runtime_ok',
    timestamp: new Date().toISOString(),
    node: process.version,
    vercel: {
      env: process.env.VERCEL_ENV || '',
      region: process.env.VERCEL_REGION || '',
      url: process.env.VERCEL_URL || '',
    },
    checks: {
      databaseUrl: Boolean(process.env.DATABASE_URL),
      snowflakeAccount: Boolean(process.env.SNOWFLAKE_ACCOUNT),
      snowflakeUsername: Boolean(process.env.SNOWFLAKE_USERNAME),
      snowflakeAuth: hasSnowflakeAuth(),
      snowflakeWarehouse: Boolean(process.env.SNOWFLAKE_WAREHOUSE),
      oidcAuthority: Boolean(process.env.OIDC_AUTHORITY),
      oidcClientId: Boolean(process.env.OIDC_CLIENT_ID),
      oidcClientSecret: Boolean(process.env.OIDC_CLIENT_SECRET),
      oidcRedirectUri: Boolean(process.env.OIDC_REDIRECT_URI),
    },
  };

  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
