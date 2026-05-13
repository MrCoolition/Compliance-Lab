import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from '../_lib/auth.js';
import { readJsonBody, sendError, sendJson } from '../_lib/http.js';
import { requireHubConfig } from '../_lib/hub-config.js';
import { applyOpenStockChanges } from '../_lib/sync.js';

interface ChangeRequest {
  runDate: string;
  userName?: string;
  changes: Array<{
    rowKey: string;
    values: Record<string, unknown>;
  }>;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const body = readJsonBody<ChangeRequest>(request);
    if (!body.runDate || !Array.isArray(body.changes)) {
      sendError(response, 400, 'runDate and changes are required');
      return;
    }

    const result = await applyOpenStockChanges({
      runDate: body.runDate,
      userName: body.userName || request.headers['x-user-name']?.toString() || 'Unknown',
      changes: body.changes,
      editableColumns: requireHubConfig('open-stock').editableColumns,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, 500, 'Failed to save Open Stock changes', error);
  }
}
