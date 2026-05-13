import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './http';

interface AuthConfig {
  required: boolean;
  authority: string;
  authorizeUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
  profilePath: string;
  logoutUrl: string;
  bypassToken: string;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

const PROFILE_CACHE_TTL_MS = 60_000;
const profileCache = new Map<string, { createdAt: number; claims: Record<string, unknown> }>();

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }
  return '';
}

function withLeadingSlash(value: string, fallback: string): string {
  const raw = (value || fallback).trim();
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}

function redirectUriFor(configuredRedirectUri: string, origin: string): string {
  if (configuredRedirectUri && !configuredRedirectUri.includes('YOUR_APP.vercel.app')) {
    return configuredRedirectUri;
  }
  return origin || configuredRedirectUri;
}

function authorizeUrlFor(authority: string): string {
  const explicit = env('OIDC_AUTHORIZE_URL', 'AUTH_AUTHORIZE_URL');
  if (explicit) return explicit;
  return authority ? `${authority}/authorize` : '';
}

function originFor(request: VercelRequest): string {
  const forwardedHost = request.headers['x-forwarded-host'];
  const forwardedProto = request.headers['x-forwarded-proto'];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || request.headers.host || '';
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
  return host ? `${proto}://${host}` : '';
}

function authConfig(request: VercelRequest): AuthConfig {
  const authority = withoutTrailingSlash(env('OIDC_AUTHORITY', 'OIDC_ISSUER', 'AUTH_AUTHORITY'));
  const origin = originFor(request);
  const logoutUrl = env('OIDC_LOGOUT_URL', 'AUTH_LOGOUT_URL') || (authority ? `${authority}/logout` : '');
  return {
    required: truthy(env('AUTH_REQUIRED', 'OIDC_AUTH_REQUIRED')),
    authority,
    authorizeUrl: authorizeUrlFor(authority),
    clientId: env('OIDC_CLIENT_ID', 'AUTH_CLIENT_ID'),
    clientSecret: env('OIDC_CLIENT_SECRET', 'AUTH_CLIENT_SECRET'),
    redirectUri: redirectUriFor(env('OIDC_REDIRECT_URI', 'AUTH_REDIRECT_URI'), origin),
    tokenPath: withLeadingSlash(env('OIDC_TOKEN_PATH', 'AUTH_TOKEN_PATH'), '/token'),
    profilePath: withLeadingSlash(env('OIDC_PROFILE_PATH', 'AUTH_PROFILE_PATH'), '/profile'),
    logoutUrl,
    bypassToken: env('AUTH_BYPASS_TOKEN'),
  };
}

export function publicAuthConfig(request: VercelRequest): Record<string, unknown> {
  const config = authConfig(request);
  const configured = Boolean(config.authority && config.clientId);
  return {
    enabled: configured || config.required,
    required: config.required,
    configured,
    oidcIssuer: config.authority,
    authorizeUrl: config.authorizeUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    logoutUrl: config.logoutUrl,
  };
}

export function extractBearerToken(request: VercelRequest): string {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export async function exchangeAuthorizationCode(
  request: VercelRequest,
  code: string,
  redirectUri?: string,
): Promise<TokenResponse> {
  const config = authConfig(request);
  if (!config.authority || !config.clientId || !config.clientSecret) {
    throw new Error('OIDC authority, client id, and client secret are required for code exchange.');
  }
  if (!code || !code.trim()) {
    throw new Error('Authorization code is required.');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri || config.redirectUri,
  });

  const response = await fetch(`${config.authority}${config.tokenPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(body.error_description || body.error || `OIDC code exchange failed with ${response.status}.`);
  }
  if (!body.access_token) {
    throw new Error('OIDC code exchange did not return an access token.');
  }
  return {
    access_token: body.access_token,
    id_token: body.id_token,
    token_type: body.token_type,
    expires_in: body.expires_in,
  };
}

export async function validateTokenViaProfile(request: VercelRequest, token: string): Promise<Record<string, unknown> | null> {
  const config = authConfig(request);
  if (!token) return null;
  if (config.bypassToken && token === config.bypassToken) {
    return { sub: 'bypass', name: 'Token Bypass' };
  }

  const cached = profileCache.get(token);
  if (cached && Date.now() - cached.createdAt < PROFILE_CACHE_TTL_MS) {
    return cached.claims;
  }
  profileCache.delete(token);

  if (!config.authority || !config.profilePath) {
    return null;
  }

  const profileUrl = `${config.authority}${config.profilePath}?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(profileUrl);
  if (!response.ok) {
    return null;
  }
  const claims = (await response.json()) as Record<string, unknown>;
  profileCache.set(token, { createdAt: Date.now(), claims });
  return claims;
}

export async function requireAuthenticatedRequest(request: VercelRequest, response: VercelResponse): Promise<boolean> {
  const config = authConfig(request);
  if (!config.required) return true;

  const token = extractBearerToken(request);
  if (!token) {
    sendError(response, 401, 'Authentication is required.');
    return false;
  }

  const claims = await validateTokenViaProfile(request, token);
  if (!claims) {
    sendError(response, 401, 'Token validation failed.');
    return false;
  }
  return true;
}
