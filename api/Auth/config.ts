import type { VercelRequest, VercelResponse } from '@vercel/node';
import { publicAuthConfig } from '../_lib/auth';
import { sendError, sendJson } from '../_lib/http';

export default function handler(request: VercelRequest, response: VercelResponse): void {
  if (request.method !== 'GET') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  sendJson(response, 200, publicAuthConfig(request));
}
