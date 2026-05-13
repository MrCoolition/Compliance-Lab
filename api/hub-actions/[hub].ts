import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthenticatedRequest } from '../_lib/auth.js';
import { configuredSnowflakeDatabase, configuredSnowflakeSchema } from '../_lib/env.js';
import { readJsonBody, sendError, sendJson } from '../_lib/http.js';
import { requireHubConfig, type HubSourceConfig } from '../_lib/hub-config.js';
import { insertDateKeyExpression, quoteSnowflakeIdentifier, runSnowflakeQuery, runSnowflakeStatement } from '../_lib/snowflake.js';
import { clearHubRowsCache } from '../_lib/sync.js';

const OPENSTOCK_TABLE = `${configuredSnowflakeDatabase()}.${configuredSnowflakeSchema()}.OPENSTOCKREPORT`;
const OPENSTOCK_KEY = 'DISTCODE MOG DIN';
const SUPER_USERS = new Set(['jordaa14', 'phillg02', 'gilbem02', 'sullik09']);
const CARRY_FORWARD_COLS = [
  'In Stock (Y/N?)',
  'ETA',
  'PO #',
  'Current DC Comment',
  'Current SCS Comment',
  'Required DC Update',
  'Pending Management Comments',
];

interface ActionRequest {
  action: string;
  payload?: Record<string, unknown>;
}

function normalizeSnapshot(value: unknown): string {
  const text = String(value ?? '').trim();
  const digits = text.replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : text;
}

function splitFqn(objectName: string): { database: string; schema: string; object: string } {
  const [database, schema, object] = objectName.split('.');
  return { database, schema, object };
}

async function fetchColumns(objectName: string): Promise<Map<string, string>> {
  const fqn = splitFqn(objectName);
  const rows = await runSnowflakeQuery<{ COLUMN_NAME: string }>(
    `
      select column_name
      from ${fqn.database}.information_schema.columns
      where table_schema = ?
        and table_name = ?
      order by ordinal_position
    `,
    [fqn.schema.toUpperCase(), fqn.object.toUpperCase()],
  );
  return new Map(rows.map((row) => [String(row.COLUMN_NAME).toUpperCase(), String(row.COLUMN_NAME)]));
}

function actual(columns: Map<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const hit = columns.get(candidate.toUpperCase());
    if (hit) return hit;
  }
  return undefined;
}

function sourceFor(hub: string, sourceName?: unknown): HubSourceConfig {
  const config = requireHubConfig(hub);
  const requested = String(sourceName || '');
  return config.sources.find((source) => source.name === requested || source.objectName.endsWith(`.${requested}`)) || config.sources[0];
}

async function weeklyRefresh(payload: Record<string, unknown>) {
  const userName = String(payload.userName || '');
  if (userName && !SUPER_USERS.has(userName.toLowerCase())) {
    throw new Error('Weekly refresh is restricted to Open Stock super users.');
  }
  const todayRows = await runSnowflakeQuery<{ TODAY: string }>("select to_char(current_date(), 'YYYYMMDD') as TODAY");
  const today = String(todayRows[0]?.TODAY || '');
  const fromDate = normalizeSnapshot(payload.fromDate || payload.runDate || today);
  const countRows = await runSnowflakeQuery<{ ROW_COUNT: number }>(
    `
      select count(*) as ROW_COUNT
      from ${OPENSTOCK_TABLE}
      where ${insertDateKeyExpression(quoteSnowflakeIdentifier('INSERT_DATE'))} = ?
    `,
    [today],
  );
  if (Number(countRows[0]?.ROW_COUNT || 0) > 0 && !payload.force) {
    return { alreadyRunToday: true, runDate: today, fromDate, message: 'Open Stock refresh has already run today.' };
  }
  await runSnowflakeQuery(`call ${configuredSnowflakeDatabase()}.${configuredSnowflakeSchema()}.OPEN_STOCK_REPORT_RUN(?, ?)`, [fromDate, today]);
  clearHubRowsCache();
  return { alreadyRunToday: false, runDate: today, fromDate, message: `Weekly refresh completed for ${fromDate} through ${today}.` };
}

async function persistLookback(payload: Record<string, unknown>) {
  const runDate = normalizeSnapshot(payload.runDate);
  const previousRunDate = normalizeSnapshot(payload.previousRunDate);
  if (!runDate || !previousRunDate) {
    return { rowsAffected: 0, message: 'Run date and previous run date are required.' };
  }
  const columns = await fetchColumns(OPENSTOCK_TABLE);
  const keyCol = actual(columns, [OPENSTOCK_KEY]);
  const insertCol = actual(columns, ['INSERT_DATE']);
  if (!keyCol || !insertCol) throw new Error('Open Stock table is missing key or INSERT_DATE columns.');
  const setLines: string[] = [];
  const tests: string[] = [];
  for (const column of CARRY_FORWARD_COLS) {
    const col = actual(columns, [column]);
    if (!col) continue;
    const dbCol = `db.${quoteSnowflakeIdentifier(col)}`;
    const prevCol = `prev.${quoteSnowflakeIdentifier(col)}`;
    const test = `NULLIF(TRIM(TO_VARCHAR(${dbCol})), '') is null and NULLIF(TRIM(TO_VARCHAR(${prevCol})), '') is not null`;
    setLines.push(`${quoteSnowflakeIdentifier(col)} = iff(${test}, TO_VARCHAR(${prevCol}), ${dbCol})`);
    tests.push(`(${test})`);
  }
  if (!tests.length) return { rowsAffected: 0, message: 'No carry-forward columns exist on the Open Stock table.' };
  const rowsAffected = await runSnowflakeStatement(
    `
      update ${OPENSTOCK_TABLE} as db
      set ${setLines.join(', ')}
      from ${OPENSTOCK_TABLE} as prev
      where db.${quoteSnowflakeIdentifier(keyCol)} = prev.${quoteSnowflakeIdentifier(keyCol)}
        and ${insertDateKeyExpression(`db.${quoteSnowflakeIdentifier(insertCol)}`)} = ?
        and ${insertDateKeyExpression(`prev.${quoteSnowflakeIdentifier(insertCol)}`)} = ?
        and (${tests.join(' or ')})
    `,
    [runDate, previousRunDate],
  );
  clearHubRowsCache();
  return { rowsAffected, message: `Lookback persisted from ${previousRunDate} into ${runDate}. Rows affected: ${rowsAffected}.` };
}

async function saveSource(hub: string, payload: Record<string, unknown>) {
  const config = requireHubConfig(hub);
  const source = sourceFor(hub, payload.source);
  const columns = await fetchColumns(source.objectName);
  const keyCol = actual(columns, source.keyColumns || []);
  if (!keyCol) throw new Error('This source does not expose a stable key column for direct updates.');
  const allowed = new Set(config.editableColumns.map((column) => column.toUpperCase()));
  const changes = Array.isArray(payload.changes) ? payload.changes as Array<{ rowKey: string; values: Record<string, unknown> }> : [];
  let updated = 0;
  let rowsAffected = 0;
  for (const change of changes) {
    const values = Object.entries(change.values || {})
      .filter(([column]) => allowed.has(column.toUpperCase()) && columns.has(column.toUpperCase()))
      .map(([column, value]) => [columns.get(column.toUpperCase())!, value] as const);
    if (!change.rowKey || !values.length) continue;
    rowsAffected += await runSnowflakeStatement(
      `
        update ${source.objectName}
        set ${values.map(([column]) => `${quoteSnowflakeIdentifier(column)} = ?`).join(', ')}
        where TO_VARCHAR(${quoteSnowflakeIdentifier(keyCol)}) = ?
      `,
      [...values.map(([, value]) => value), change.rowKey],
    );
    updated += 1;
  }
  if (updated > 0) clearHubRowsCache();
  return { updated, rowsAffected, message: `Saved ${updated} keyed update(s). Rows affected: ${rowsAffected}.` };
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;
  try {
    const hub = String(request.query.hub || '');
    const body = readJsonBody<ActionRequest>(request);
    const payload = body.payload || {};
    if (hub === 'open-stock' && body.action === 'weekly-refresh') {
      sendJson(response, 200, await weeklyRefresh(payload));
      return;
    }
    if (hub === 'open-stock' && body.action === 'persist-lookback') {
      sendJson(response, 200, await persistLookback(payload));
      return;
    }
    if (['save-source', 'save-matrix', 'save-manual'].includes(body.action)) {
      sendJson(response, 200, await saveSource(hub, payload));
      return;
    }
    sendError(response, 404, `Unsupported action: ${hub}/${body.action}`);
  } catch (error) {
    sendError(response, 500, 'Hub action failed', error);
  }
}
