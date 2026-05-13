import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from './_lib/auth';
import { configuredSnowflakeDatabase, configuredSnowflakeSchema } from './_lib/env';
import { readJsonBody, sendError, sendJson } from './_lib/http';
import { quoteSnowflakeIdentifier, runSnowflakeQuery, runSnowflakeStatement } from './_lib/snowflake';

interface FeedbackRequest {
  appName: string;
  rating: number;
  feedbackText?: string;
  submittedBy?: string;
  context?: Record<string, unknown>;
}

const FEEDBACK_TABLE = `${configuredSnowflakeDatabase()}.${configuredSnowflakeSchema()}.FEEDBACK_HUB`;

async function feedbackColumns(): Promise<Set<string>> {
  const rows = await runSnowflakeQuery<{ COLUMN_NAME: string }>(
    `
      select column_name
      from ${configuredSnowflakeDatabase()}.information_schema.columns
      where table_schema = ?
        and table_name = 'FEEDBACK_HUB'
    `,
    [configuredSnowflakeSchema().toUpperCase()],
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME).toUpperCase()));
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const body = readJsonBody<FeedbackRequest>(request);
    const cols = await feedbackColumns();
    const insertParts: Array<{ column: string; expr: string; value?: unknown }> = [];
    for (const candidate of ['EVENT_TS', 'CREATED_AT', 'INSERTED_AT', 'UPDATED_AT', 'INSERT_DATE', 'CREATED_DATE']) {
      if (cols.has(candidate)) {
        insertParts.push({ column: candidate, expr: 'current_timestamp()' });
        break;
      }
    }
    const values: Record<string, unknown> = {
      APP_NAME: body.appName,
      RATING: Number(body.rating || 0),
      FEEDBACK_TEXT: body.feedbackText ?? null,
      SUBMITTED_BY: body.submittedBy ?? request.headers['x-user-name']?.toString() ?? null,
      PAGE_NAME: body.appName,
      CONTEXT_JSON: JSON.stringify(body.context ?? {}),
      IS_ACTIVE: true,
    };
    for (const [column, value] of Object.entries(values)) {
      if (!cols.has(column)) continue;
      insertParts.push({ column, expr: column === 'CONTEXT_JSON' ? 'parse_json(?)' : '?', value });
    }
    if (insertParts.length === 0) {
      throw new Error('FEEDBACK_HUB has no recognized writable columns.');
    }
    await runSnowflakeStatement(
      `
        insert into ${FEEDBACK_TABLE}
          (${insertParts.map((part) => quoteSnowflakeIdentifier(part.column)).join(', ')})
        select ${insertParts.map((part) => part.expr).join(', ')}
      `,
      insertParts.filter((part) => part.expr.includes('?')).map((part) => part.value),
    );

    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendError(response, 500, 'Failed to submit feedback', error);
  }
}
