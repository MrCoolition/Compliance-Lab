function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

function withLeadingSlash(value, fallback) {
  const raw = String(value || fallback).trim();
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function withoutTrailingSlash(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function requestOrigin(request) {
  const forwardedHost = request.headers['x-forwarded-host'];
  const forwardedProto = request.headers['x-forwarded-proto'];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || request.headers.host || '';
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
  return host ? `${proto}://${host}` : '';
}

function redirectUriFor(configuredRedirectUri, origin) {
  if (configuredRedirectUri && !configuredRedirectUri.includes('YOUR_APP.vercel.app')) {
    return configuredRedirectUri;
  }
  return origin || configuredRedirectUri;
}

async function readJsonBody(request) {
  if (typeof request.body === 'string') {
    return request.body ? JSON.parse(request.body) : {};
  }
  if (request.body && typeof request.body === 'object') {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function authConfig(request) {
  const authority = withoutTrailingSlash(env('OIDC_AUTHORITY', 'OIDC_ISSUER', 'AUTH_AUTHORITY'));
  const origin = requestOrigin(request);
  return {
    authority,
    clientId: env('OIDC_CLIENT_ID', 'AUTH_CLIENT_ID'),
    clientSecret: env('OIDC_CLIENT_SECRET', 'AUTH_CLIENT_SECRET'),
    redirectUri: redirectUriFor(env('OIDC_REDIRECT_URI', 'AUTH_REDIRECT_URI'), origin),
    tokenPath: withLeadingSlash(env('OIDC_TOKEN_PATH', 'AUTH_TOKEN_PATH'), '/token'),
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const code = String(body.code || '').trim();
    const config = authConfig(request);

    if (!config.authority || !config.clientId || !config.clientSecret) {
      sendJson(response, 401, { error: 'OIDC authority, client id, and client secret are required for code exchange.' });
      return;
    }
    if (!code) {
      sendJson(response, 401, { error: 'Authorization code is required.' });
      return;
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: body.redirectUri || config.redirectUri,
    });

    const tokenResponse = await fetch(`${config.authority}${config.tokenPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const text = await tokenResponse.text();
    const parsed = text ? JSON.parse(text) : {};

    if (!tokenResponse.ok || !parsed.access_token) {
      sendJson(response, 401, {
        error: parsed.error_description || parsed.error || `OIDC code exchange failed with ${tokenResponse.status}.`,
      });
      return;
    }

    sendJson(response, 200, {
      access_token: parsed.access_token,
      id_token: parsed.id_token,
      token_type: parsed.token_type,
      expires_in: parsed.expires_in,
    });
  } catch (error) {
    sendJson(response, 401, { error: error instanceof Error ? error.message : String(error) });
  }
}
