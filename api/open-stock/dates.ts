import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from '../_lib/auth';
import { requireHubConfig } from '../_lib/hub-config';
import { numberQuery, sendError, sendJson, stringQuery } from '../_lib/http';
import { fetchRecentSnapshotDates } from '../_lib/sync';
import { runSnowflakeQuery } from '../_lib/snowflake';

function normalizeSnapshot(value: unknown): string {
  const text = String(value ?? '').trim();
  const digits = text.replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : text;
}

async function snowflakeToday(): Promise<string> {
  const rows = await runSnowflakeQuery<{ TODAY: string }>("select to_char(current_date(), 'YYYYMMDD') as TODAY");
  return String(rows[0]?.TODAY || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'GET') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const dates = await fetchRecentSnapshotDates(requireHubConfig('open-stock'), numberQuery(request.query.limit, 25, 100));
    const selectedDate = normalizeSnapshot(stringQuery(request.query.runDate)) || dates[0] || '';
    const previousDate = dates.find((date) => date < selectedDate);
    sendJson(response, 200, {
      dates,
      today: await snowflakeToday(),
      selectedDate,
      previousDate,
    });
  } catch (error) {
    sendError(response, 500, 'Failed to load report run dates', error);
  }
}
