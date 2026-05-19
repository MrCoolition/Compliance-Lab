import type { VercelRequest, VercelResponse } from '@vercel/node';

export function sendJson(response: VercelResponse, status: number, body: unknown): void {
  response.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(body));
}

export function sendError(response: VercelResponse, status: number, message: string, details?: unknown): void {
  const detailMessage = details instanceof Error ? details.message : '';
  const safeMessage = detailMessage.startsWith('Snowflake EXTERNALBROWSER authentication')
    ? detailMessage
    : message;
  sendJson(response, status, {
    error: safeMessage,
    details: process.env.NODE_ENV === 'production' ? undefined : details,
  });
}

export function stringQuery(value: VercelRequest['query'][string]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function numberQuery(value: VercelRequest['query'][string], fallback: number, max: number): number {
  const text = stringQuery(value);
  const parsed = text ? Number.parseInt(text, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function pageSizeQuery(value: VercelRequest['query'][string]): number | undefined {
  const text = stringQuery(value)?.trim().toLowerCase();
  if (!text || ['all', 'none', 'full', '0', '-1'].includes(text)) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

export function readJsonBody<T>(request: VercelRequest): T {
  if (typeof request.body === 'string') {
    return JSON.parse(request.body) as T;
  }
  return request.body as T;
}
