import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from '../_lib/auth.js';
import { getHubRows } from '../_lib/sync.js';
import { numberQuery, pageSizeQuery, sendError, sendJson, stringQuery } from '../_lib/http.js';
import { requireHubConfig } from '../_lib/hub-config.js';

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'GET') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const hubKey = stringQuery(request.query.hub);
    if (!hubKey) {
      sendError(response, 400, 'Missing hub key');
      return;
    }

    const filtersText = stringQuery(request.query.filters);
    const filters = filtersText ? (JSON.parse(filtersText) as Record<string, string[]>) : {};
    const result = await getHubRows(requireHubConfig(hubKey), {
      page: numberQuery(request.query.page, 1, 1000),
      pageSize: pageSizeQuery(request.query.pageSize),
      search: stringQuery(request.query.search),
      runDate: stringQuery(request.query.runDate),
      filters,
      source: stringQuery(request.query.source),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, 500, 'Failed to load hub rows', error);
  }
}
