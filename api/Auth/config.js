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

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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

function authConfig(request) {
  const authority = withoutTrailingSlash(env('OIDC_AUTHORITY', 'OIDC_ISSUER', 'AUTH_AUTHORITY'));
  const origin = requestOrigin(request);
  const logoutUrl = env('OIDC_LOGOUT_URL', 'AUTH_LOGOUT_URL') || (authority ? `${authority}/logout` : '');
  const authorizeUrl = env('OIDC_AUTHORIZE_URL', 'AUTH_AUTHORIZE_URL') || (authority ? `${authority}/authorize` : '');

  return {
    enabled: Boolean(authority && env('OIDC_CLIENT_ID', 'AUTH_CLIENT_ID')) || truthy(env('AUTH_REQUIRED', 'OIDC_AUTH_REQUIRED')),
    required: truthy(env('AUTH_REQUIRED', 'OIDC_AUTH_REQUIRED')),
    configured: Boolean(authority && env('OIDC_CLIENT_ID', 'AUTH_CLIENT_ID')),
    oidcIssuer: authority,
    authorizeUrl,
    clientId: env('OIDC_CLIENT_ID', 'AUTH_CLIENT_ID'),
    redirectUri: redirectUriFor(env('OIDC_REDIRECT_URI', 'AUTH_REDIRECT_URI'), origin),
    logoutUrl,
    tokenPath: withLeadingSlash(env('OIDC_TOKEN_PATH', 'AUTH_TOKEN_PATH'), '/token'),
    profilePath: withLeadingSlash(env('OIDC_PROFILE_PATH', 'AUTH_PROFILE_PATH'), '/profile'),
  };
}

export default function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const config = authConfig(request);
  sendJson(response, 200, {
    enabled: config.enabled,
    required: config.required,
    configured: config.configured,
    oidcIssuer: config.oidcIssuer,
    authorizeUrl: config.authorizeUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    logoutUrl: config.logoutUrl,
  });
}
