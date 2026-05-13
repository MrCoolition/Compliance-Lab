import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from '../_lib/auth';
import { readJsonBody, sendError, sendJson } from '../_lib/http';
import { undoLatestOpenStockBatch } from '../_lib/sync';

interface UndoRequest {
  runDate: string;
  userName?: string;
  operation?: string;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const body = readJsonBody<UndoRequest>(request);
    if (!body.runDate) {
      sendError(response, 400, 'runDate is required');
      return;
    }

    const result = await undoLatestOpenStockBatch({
      runDate: body.runDate,
      userName: body.userName || request.headers['x-user-name']?.toString() || 'Unknown',
      operation: body.operation,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, 500, 'Failed to undo Open Stock changes', error);
  }
}
