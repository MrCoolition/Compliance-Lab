import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractBearerToken, validateTokenViaProfile } from '../_lib/auth';
import { requireHubConfig } from '../_lib/hub-config';
import { pageSizeQuery, sendError, sendJson, stringQuery } from '../_lib/http';
import { syncHubToNeon } from '../_lib/sync';

function authRequired(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.AUTH_REQUIRED || process.env.OIDC_AUTH_REQUIRED || '').toLowerCase());
}

async function isAuthorized(request: VercelRequest): Promise<boolean> {
  if (authRequired()) {
    const token = extractBearerToken(request);
    if (token && (await validateTokenViaProfile(request, token))) {
      return true;
    }
  }

  const syncKey = process.env.SYNC_API_KEY;
  if (process.env.ALLOW_UI_SYNC === 'true' && !syncKey) {
    return true;
  }
  if (!syncKey) {
    return false;
  }
  return request.headers['x-sync-key'] === syncKey;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const hubKey = stringQuery(request.query.hub);
  if (!hubKey) {
    sendError(response, 400, 'Missing hub key');
    return;
  }

  if (request.method === 'GET') {
    const config = requireHubConfig(hubKey);
    sendJson(response, 200, {
      hub: config.key,
      label: config.label,
      sources: config.sources.map((source) => source.name),
      requiresHeader: Boolean(process.env.SYNC_API_KEY),
    });
    return;
  }

  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }

  if (!(await isAuthorized(request))) {
    sendError(response, 401, 'Refresh is not authorized for this environment.');
    return;
  }

  try {
    const result = await syncHubToNeon(requireHubConfig(hubKey), {
      runDate: stringQuery(request.query.runDate),
      limit: pageSizeQuery(request.query.limit),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, 500, 'Sync failed', error);
  }
}
