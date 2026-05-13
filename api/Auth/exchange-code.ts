import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exchangeAuthorizationCode } from '../_lib/auth';
import { readJsonBody, sendError, sendJson } from '../_lib/http';

interface ExchangeCodeRequest {
  code?: string;
  redirectUri?: string;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }

  try {
    const body = readJsonBody<ExchangeCodeRequest>(request);
    const result = await exchangeAuthorizationCode(request, body.code || '', body.redirectUri);
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, 401, 'Code exchange failed', error);
  }
}
