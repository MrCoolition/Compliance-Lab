import crypto from 'node:crypto';
import { dbExecute, dbQuery } from './database';
import { configuredSnowflakeDatabase, configuredSnowflakeSchema, neonTable } from './env';
import type { HubConfig, HubSourceConfig } from './hub-config';
import { insertDateKeyExpression, quoteSnowflakeIdentifier, runSnowflakeQuery, runSnowflakeStatement, type SnowflakeRow } from './snowflake';

export interface SyncOptions {
  runDate?: string;
  limit?: number;
}

export interface SyncResult {
  hub: string;
  sources: Array<{
    source: string;
    selected: number;
    upserted: number;
  }>;
}

export interface HubRowsResult {
  hub: string;
  label: string;
  description: string;
  columns: string[];
  editableColumns: string[];
  filterColumns: string[];
  sources: Array<{
    name: string;
    label: string;
    objectName: string;
  }>;
  rows: Array<{
    rowKey: string;
    sourceName: string;
    snapshotDate: string;
    data: SnowflakeRow;
    syncedAt?: string;
  }>;
  total: number;
  metrics: Record<string, number | string>;
  sync?: {
    lastRunAt?: string;
    lastStatus?: string;
  };
}

function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSnapshot(value: unknown, fallback = 'current'): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }
  const text = String(value ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 8) {
    return digits.slice(0, 8);
  }
  return text || fallback;
}

function normalizeChangeValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

function pickFirst(row: SnowflakeRow, candidates: string[] = []): unknown {
  const byUpper = new Map(Object.keys(row).map((key) => [key.toUpperCase(), key]));
  for (const candidate of candidates) {
    const direct = row[candidate];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
      return direct;
    }
    const actual = byUpper.get(candidate.toUpperCase());
    if (actual) {
      const value = row[actual];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return undefined;
}

function rowKeyFor(row: SnowflakeRow, source: HubSourceConfig): string {
  const fromConfiguredKey = normalizeKey(pickFirst(row, source.keyColumns));
  if (fromConfiguredKey) {
    return fromConfiguredKey;
  }
  return hashJson(row).slice(0, 32);
}

function snapshotFor(row: SnowflakeRow, source: HubSourceConfig, options: SyncOptions): string {
  if (options.runDate) {
    return normalizeSnapshot(options.runDate);
  }
  return normalizeSnapshot(pickFirst(row, source.snapshotColumns));
}

function searchTextFor(row: SnowflakeRow, columns: string[]): string {
  const keys = columns.length > 0 ? columns : Object.keys(row);
  return keys
    .map((key) => String(row[key] ?? ''))
    .join(' ')
    .toLowerCase();
}

function filterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim() !== '');
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return [value];
  }
  return [];
}

function buildSelectSql(source: HubSourceConfig, options: SyncOptions): { sqlText: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (options.runDate && source.snapshotColumns?.length) {
    clauses.push(`${insertDateKeyExpression(quoteSnowflakeIdentifier(source.snapshotColumns[0]))} = ?`);
    binds.push(normalizeSnapshot(options.runDate));
  }

  const whereSql = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  const limitSql = options.limit ? ` limit ${Math.max(1, options.limit)}` : '';
  return {
    sqlText: `select * from ${source.objectName}${whereSql}${limitSql}`,
    binds,
  };
}

const sourceColumnCache = new Map<string, Map<string, string>>();
const directRowsCache = new Map<string, { expiresAt: number; value: HubRowsResult }>();
const DIRECT_ROWS_CACHE_TTL_MS = Number(process.env.HUB_QUERY_CACHE_TTL_MS ?? 120_000);
const DIRECT_ROWS_CACHE_LIMIT = Number(process.env.HUB_QUERY_CACHE_LIMIT ?? 16);

function directRowsCacheKey(
  config: HubConfig,
  args: {
    page: number;
    pageSize?: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
    source?: string;
    projection?: 'screen' | 'full';
  },
): string {
  const filters = Object.fromEntries(
    Object.entries(args.filters ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, [...values].sort()]),
  );
  return hashJson([config.key, args.page, args.pageSize ?? null, args.search ?? '', normalizeSnapshot(args.runDate, ''), args.source ?? '', args.projection ?? 'screen', filters]);
}

export function clearHubRowsCache(): void {
  directRowsCache.clear();
}

function pruneDirectRowsCache(): void {
  while (directRowsCache.size > DIRECT_ROWS_CACHE_LIMIT) {
    directRowsCache.delete(directRowsCache.keys().next().value);
  }
}

function splitFqn(objectName: string): { database: string; schema: string; object: string } | undefined {
  const parts = objectName.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) {
    return undefined;
  }
  return { database: parts[0], schema: parts[1], object: parts[2] };
}

async function fetchSourceColumns(source: HubSourceConfig): Promise<Map<string, string>> {
  const cached = sourceColumnCache.get(source.objectName);
  if (cached) {
    return cached;
  }

  const fqn = splitFqn(source.objectName);
  if (!fqn) {
    return new Map();
  }

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
  const columns = new Map(rows.map((row) => [String(row.COLUMN_NAME).toUpperCase(), String(row.COLUMN_NAME)]));
  sourceColumnCache.set(source.objectName, columns);
  return columns;
}

function pickActualColumn(columns: Map<string, string>, candidates: string[] = []): string | undefined {
  for (const candidate of candidates) {
    const actual = columns.get(candidate.toUpperCase());
    if (actual) {
      return actual;
    }
  }
  return undefined;
}

async function buildDirectSelectSql(
  config: HubConfig,
  source: HubSourceConfig,
  args: {
    page: number;
    pageSize?: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
    source?: string;
    projection?: 'screen' | 'full';
  },
): Promise<{ sqlText: string; binds: unknown[] }> {
  const columns = await fetchSourceColumns(source);
  const clauses: string[] = [];
  const binds: unknown[] = [];

  const snapshotColumn = pickActualColumn(columns, source.snapshotColumns);
  if (args.runDate && snapshotColumn) {
    clauses.push(`${insertDateKeyExpression(quoteSnowflakeIdentifier(snapshotColumn))} = ?`);
    binds.push(normalizeSnapshot(args.runDate));
  }

  const allowedFilters = new Set(config.filterColumns.map((column) => column.toUpperCase()));
  for (const [column, rawValues] of Object.entries(args.filters ?? {})) {
    const values = filterValues(rawValues);
    if (!allowedFilters.has(column.toUpperCase()) || values.length === 0) {
      continue;
    }
    const actualColumn = columns.get(column.toUpperCase());
    if (!actualColumn) {
      continue;
    }
    const placeholders = values.map(() => '?').join(', ');
    clauses.push(`TO_VARCHAR(${quoteSnowflakeIdentifier(actualColumn)}) in (${placeholders})`);
    binds.push(...values);
  }

  if (args.search?.trim()) {
    const searchColumns = (config.searchColumns.length ? config.searchColumns : Array.from(columns.values()))
      .map((column) => columns.get(column.toUpperCase()))
      .filter((column): column is string => Boolean(column));
    if (searchColumns.length > 0) {
      const searchSql = searchColumns
        .map((column) => `LOWER(TO_VARCHAR(${quoteSnowflakeIdentifier(column)})) like ?`)
        .join(' or ');
      clauses.push(`(${searchSql})`);
      binds.push(...searchColumns.map(() => `%${args.search!.trim().toLowerCase()}%`));
    }
  }

  const whereSql = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  const pagingSql = args.pageSize
    ? ` limit ${Math.max(1, args.pageSize)} offset ${Math.max(0, (args.page - 1) * args.pageSize)}`
    : '';
  return {
    sqlText: `select * from ${source.objectName}${whereSql}${pagingSql}`,
    binds,
  };
}

async function getHubRowsFromSnowflake(
  config: HubConfig,
  args: {
    page: number;
    pageSize?: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
    source?: string;
    projection?: 'screen' | 'full';
  },
): Promise<HubRowsResult> {
  const dataRows: HubRowsResult['rows'] = [];
  const sourceErrors: string[] = [];

  const sources = config.sources.filter(
    (source) => !args.source || source.name === args.source || source.objectName.endsWith(`.${args.source}`),
  );

  for (const source of sources.length ? sources : config.sources) {
    try {
      const query = await buildDirectSelectSql(config, source, args);
      const rows = await runSnowflakeQuery(query.sqlText, query.binds);
      for (const row of rows) {
        dataRows.push({
          rowKey: rowKeyFor(row, source),
          sourceName: source.name,
          snapshotDate: snapshotFor(row, source, { runDate: args.runDate }),
          data: { ...row, __sourceName: source.name },
          syncedAt: new Date().toISOString(),
        });
      }
      if (config.key === 'open-stock' && rows.length > 0) {
        break;
      }
    } catch (error) {
      sourceErrors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (dataRows.length === 0 && sourceErrors.length > 0) {
    throw new Error(sourceErrors.join(' | '));
  }

  const rawRows = dataRows.map((row) => row.data);
  const columns = args.projection === 'full' ? orderedColumns(config, rawRows) : displayColumns(config, rawRows);
  return {
    hub: config.key,
    label: config.label,
    description: config.description,
    columns,
    editableColumns: config.editableColumns,
    filterColumns: config.filterColumns,
    sources: config.sources.map((source) => ({
      name: source.name,
      label: source.name,
      objectName: source.objectName,
    })),
    rows: args.projection === 'full' ? dataRows : projectResultRows(dataRows, columns),
    total: dataRows.length,
    metrics: computeMetrics(config, rawRows, dataRows.length),
    sync: {
      lastRunAt: new Date().toISOString(),
      lastStatus: sourceErrors.length ? `partial (${sourceErrors.length} source error${sourceErrors.length === 1 ? '' : 's'})` : 'live',
    },
  };
}

async function upsertRows(config: HubConfig, source: HubSourceConfig, rows: SnowflakeRow[], options: SyncOptions): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const table = neonTable('hub_rows');
  const chunkSize = 250;
  let upserted = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders: string[] = [];
    const params: unknown[] = [];

    chunk.forEach((row) => {
      const base = params.length;
      const rowKey = rowKeyFor(row, source);
      const snapshotDate = snapshotFor(row, source, options);
      const sourceHash = hashJson(row);
      const searchText = searchTextFor(row, config.searchColumns);

      params.push(config.key, source.name, rowKey, snapshotDate, JSON.stringify(row), searchText, sourceHash);
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, now(), now())`);
    });

    await dbExecute(
      `
        insert into ${table}
          (hub_key, source_name, row_key, snapshot_date, data, search_text, source_hash, synced_at, last_seen_at)
        values ${placeholders.join(', ')}
        on conflict (hub_key, source_name, row_key, snapshot_date)
        do update set
          data = excluded.data,
          search_text = excluded.search_text,
          source_hash = excluded.source_hash,
          synced_at = excluded.synced_at,
          last_seen_at = excluded.last_seen_at
      `,
      params,
    );
    upserted += chunk.length;
  }

  return upserted;
}

export async function syncHubToNeon(config: HubConfig, options: SyncOptions = {}): Promise<SyncResult> {
  const runId = crypto.randomUUID();
  const syncRunsTable = neonTable('hub_sync_runs');

  await dbExecute(
    `insert into ${syncRunsTable} (run_id, hub_key, status, started_at, requested_snapshot_date) values ($1, $2, 'running', now(), $3)`,
    [runId, config.key, options.runDate ?? null],
  );

  const result: SyncResult = { hub: config.key, sources: [] };
  try {
    for (const source of config.sources) {
      const query = buildSelectSql(source, options);
      const rows = await runSnowflakeQuery(query.sqlText, query.binds);
      const upserted = await upsertRows(config, source, rows, options);
      result.sources.push({ source: source.name, selected: rows.length, upserted });
    }

    await dbExecute(
      `update ${syncRunsTable} set status = 'succeeded', finished_at = now(), rows_loaded = $1 where run_id = $2`,
      [result.sources.reduce((total, source) => total + source.upserted, 0), runId],
    );
    return result;
  } catch (error) {
    await dbExecute(
      `update ${syncRunsTable} set status = 'failed', finished_at = now(), error_message = $1 where run_id = $2`,
      [error instanceof Error ? error.message : String(error), runId],
    );
    throw error;
  }
}

function orderedColumns(config: HubConfig, rows: SnowflakeRow[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const column of config.defaultColumns) {
    if (!seen.has(column)) {
      ordered.push(column);
      seen.add(column);
    }
  }
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        ordered.push(column);
        seen.add(column);
      }
    }
  }
  return ordered;
}

function displayColumns(config: HubConfig, rows: SnowflakeRow[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const actualByUpper = new Map<string, string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((column) => {
      if (!actualByUpper.has(column.toUpperCase())) {
        actualByUpper.set(column.toUpperCase(), column);
      }
    });
  });
  const add = (column?: string): void => {
    if (!column || seen.has(column)) {
      return;
    }
    const actual = actualByUpper.get(column.toUpperCase()) ?? column;
    if (seen.has(actual)) {
      return;
    }
    ordered.push(actual);
    seen.add(actual);
  };

  config.defaultColumns.forEach(add);
  config.editableColumns.forEach(add);
  config.filterColumns.forEach(add);
  config.sources.forEach((source) => {
    source.keyColumns?.forEach(add);
    source.snapshotColumns?.forEach(add);
  });

  return ordered.length ? ordered : orderedColumns(config, rows);
}

function projectResultRows(rows: HubRowsResult['rows'], columns: string[]): HubRowsResult['rows'] {
  return rows.map((row) => ({
    ...row,
    data: Object.fromEntries(columns.map((column) => [column, row.data[column]])),
  }));
}

function computeMetrics(config: HubConfig, rows: SnowflakeRow[], total: number): Record<string, number | string> {
  const unique = (column: string) => new Set(rows.map((row) => String(row[column] ?? '')).filter(Boolean)).size;
  const norm = (value: unknown) => String(value ?? '').trim().toUpperCase();

  if (config.key === 'open-stock') {
    const outOfStock = rows.filter((row) => ['N', 'NO', 'FALSE', '0'].includes(norm(row['In Stock (Y/N?)']))).length;
    const missingEta = rows.filter((row) => String(row['ETA'] ?? '').trim() === '').length;
    const pending = rows.filter((row) => String(row['Pending Management Comments'] ?? '').trim() !== '').length;
    return {
      total,
      pageRows: rows.length,
      distributors: unique('DISTRIBUTOR NAME'),
      scs: unique('SCS'),
      outOfStock,
      missingEta,
      pendingManagement: pending,
    };
  }

  return {
    total,
    pageRows: rows.length,
    sources: unique('__sourceName'),
  };
}

async function getHubRowsFromCache(
  config: HubConfig,
  args: {
    page: number;
    pageSize?: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
    source?: string;
    projection?: 'screen' | 'full';
  },
): Promise<HubRowsResult> {
  const table = neonTable('hub_rows');
  const clauses = ['hub_key = $1'];
  const params: unknown[] = [config.key];

  if (args.runDate) {
    params.push(normalizeSnapshot(args.runDate));
    clauses.push(`snapshot_date = $${params.length}`);
  }

  if (args.search) {
    params.push(`%${args.search.trim().toLowerCase()}%`);
    clauses.push(`search_text ilike $${params.length}`);
  }

  if (args.source) {
    params.push(args.source);
    clauses.push(`source_name = $${params.length}`);
  }

  const allowedFilters = new Set(config.filterColumns.map((column) => column.toUpperCase()));
  for (const [column, rawValues] of Object.entries(args.filters ?? {})) {
    const values = filterValues(rawValues);
    if (!allowedFilters.has(column.toUpperCase()) || values.length === 0) {
      continue;
    }
    params.push(column, values);
    clauses.push(`data ->> $${params.length - 1} = any($${params.length}::text[])`);
  }

  const whereSql = clauses.join(' and ');

  const countRows = await dbQuery<{ count: string }>(`select count(*)::text as count from ${table} where ${whereSql}`, params);
  const total = Number.parseInt(countRows[0]?.count ?? '0', 10);

  let pagingSql = '';
  if (args.pageSize) {
    const offset = (args.page - 1) * args.pageSize;
    params.push(args.pageSize, offset);
    pagingSql = `limit $${params.length - 1} offset $${params.length}`;
  }
  const rows = await dbQuery<{
    row_key: string;
    source_name: string;
    snapshot_date: string;
    data: SnowflakeRow;
    synced_at: string;
  }>(
    `
      select row_key, source_name, snapshot_date, data, synced_at::text
      from ${table}
      where ${whereSql}
      order by last_seen_at desc, row_key asc
      ${pagingSql}
    `,
    params,
  );

  const dataRows = rows.map((row) => ({
    rowKey: row.row_key,
    sourceName: row.source_name,
    snapshotDate: row.snapshot_date,
    data: { ...row.data, __sourceName: row.source_name },
    syncedAt: row.synced_at,
  }));

  const lastRun = await dbQuery<{ status: string; finished_at?: string; started_at?: string }>(
    `
      select status, finished_at::text, started_at::text
      from ${neonTable('hub_sync_runs')}
      where hub_key = $1
      order by started_at desc
      limit 1
    `,
    [config.key],
  );

  const rawRows = dataRows.map((row) => row.data);
  const columns = args.projection === 'full' ? orderedColumns(config, rawRows) : displayColumns(config, rawRows);
  return {
    hub: config.key,
    label: config.label,
    description: config.description,
    columns,
    editableColumns: config.editableColumns,
    filterColumns: config.filterColumns,
    sources: config.sources.map((source) => ({
      name: source.name,
      label: source.name,
      objectName: source.objectName,
    })),
    rows: args.projection === 'full' ? dataRows : projectResultRows(dataRows, columns),
    total,
    metrics: computeMetrics(config, rawRows, total),
    sync: lastRun[0]
      ? {
          lastRunAt: lastRun[0].finished_at ?? lastRun[0].started_at,
          lastStatus: lastRun[0].status,
        }
      : undefined,
  };
}

export async function getHubRows(
  config: HubConfig,
  args: {
    page: number;
    pageSize?: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
    source?: string;
    projection?: 'screen' | 'full';
  },
): Promise<HubRowsResult> {
  if (process.env.HUB_QUERY_MODE === 'neon') {
    return getHubRowsFromCache(config, args);
  }
  if (process.env.HUB_QUERY_CACHE === 'false') {
    return getHubRowsFromSnowflake(config, args);
  }

  const cacheKey = directRowsCacheKey(config, args);
  const cached = directRowsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  directRowsCache.delete(cacheKey);

  const result = await getHubRowsFromSnowflake(config, args);
  directRowsCache.set(cacheKey, { expiresAt: Date.now() + DIRECT_ROWS_CACHE_TTL_MS, value: result });
  pruneDirectRowsCache();
  return result;
}

export async function applyOpenStockChanges(args: {
  runDate: string;
  userName: string;
  changes: Array<{
    rowKey: string;
    values: Record<string, unknown>;
  }>;
  editableColumns: string[];
}): Promise<{ batchId: string; rowsAffected: number; loggedChanges: number }> {
  const batchId = crypto.randomUUID();
  const allowed = new Set(args.editableColumns);
  const safeChanges = args.changes
    .map((change) => ({
      rowKey: change.rowKey,
      values: Object.fromEntries(Object.entries(change.values).filter(([column]) => allowed.has(column))),
    }))
    .filter((change) => change.rowKey && Object.keys(change.values).length > 0);

  if (safeChanges.length === 0) {
    return { batchId, rowsAffected: 0, loggedChanges: 0 };
  }

  await ensureSnowflakeOpenStockAuditTables();
  await writeSnowflakeOpenStockBatch({
    batchId,
    operation: 'INLINE_SAVE',
    runDate: normalizeSnapshot(args.runDate),
    changedBy: args.userName,
    affectedKeys: safeChanges.length,
  });

  if (process.env.DATABASE_URL) {
    await dbExecute(
      `
        insert into ${neonTable('openstock_change_batches')}
          (batch_id, operation, run_date, changed_by, status, changed_at, affected_keys)
        values ($1, 'INLINE_SAVE', $2, $3, 'running', now(), $4)
      `,
      [batchId, normalizeSnapshot(args.runDate), args.userName, safeChanges.length],
    );
  }

  let rowsAffected = 0;
  try {
    let loggedChanges = 0;
    if (process.env.OPENSTOCK_SNOWFLAKE_WRITES !== 'false') {
      for (const change of safeChanges) {
        const before = await fetchSnowflakeOpenStockValues(change.rowKey, args.runDate, Object.keys(change.values));
        rowsAffected += await updateSnowflakeOpenStockRow(change.rowKey, args.runDate, change.values, args.userName);
        for (const [column, value] of Object.entries(change.values)) {
          const oldValue = pickFirst(before, [column]);
          if (normalizeChangeValue(oldValue) === normalizeChangeValue(value)) {
            continue;
          }
          await writeSnowflakeOpenStockLog({
            batchId,
            operation: 'INLINE_SAVE',
            runDate: normalizeSnapshot(args.runDate),
            rowKey: change.rowKey,
            column,
            oldValue,
            newValue: value,
            changedBy: args.userName,
          });
          loggedChanges += 1;
        }
      }
    }

    if (process.env.DATABASE_URL) {
      for (const change of safeChanges) {
        await dbExecute(
          `
            update ${neonTable('hub_rows')}
            set data = data || $1::jsonb,
                search_text = lower(search_text || ' ' || $2),
                last_modified_at = now()
            where hub_key = 'open-stock'
              and row_key = $3
              and snapshot_date = $4
          `,
          [JSON.stringify(change.values), Object.values(change.values).join(' '), change.rowKey, normalizeSnapshot(args.runDate)],
        );

        for (const [column, value] of Object.entries(change.values)) {
          await dbExecute(
            `
              insert into ${neonTable('openstock_change_log')}
                (batch_id, run_date, row_key, column_name, new_value, changed_by, changed_at)
              values ($1, $2, $3, $4, $5, $6, now())
            `,
            [batchId, normalizeSnapshot(args.runDate), change.rowKey, column, value == null ? null : String(value), args.userName],
          );
        }
      }

      await dbExecute(
        `update ${neonTable('openstock_change_batches')} set status = 'succeeded', rows_affected = $1 where batch_id = $2`,
        [rowsAffected, batchId],
      );
    }

    clearHubRowsCache();
    return {
      batchId,
      rowsAffected,
      loggedChanges,
    };
  } catch (error) {
    if (process.env.DATABASE_URL) {
      await dbExecute(
        `update ${neonTable('openstock_change_batches')} set status = 'failed', error_message = $1 where batch_id = $2`,
        [error instanceof Error ? error.message : String(error), batchId],
      );
    }
    throw error;
  }
}

async function ensureSnowflakeOpenStockAuditTables(): Promise<void> {
  const database = configuredSnowflakeDatabase();
  const schema = configuredSnowflakeSchema();
  await runSnowflakeStatement(
    `
      create table if not exists ${database}.${schema}.OPENSTOCK_CHANGE_BATCH (
        BATCH_ID string,
        OPERATION string,
        RUN_DATE string,
        CHANGED_BY string,
        CHANGED_AT timestamp_ntz,
        AFFECTED_KEYS number,
        UNDONE_AT timestamp_ntz,
        UNDONE_BY string
      )
    `,
  );
  await runSnowflakeStatement(
    `
      create table if not exists ${database}.${schema}.OPENSTOCK_CHANGE_LOG (
        BATCH_ID string,
        OPERATION string,
        RUN_DATE string,
        DISTCODE_MOG_DIN string,
        COLUMN_NAME string,
        OLD_VALUE string,
        NEW_VALUE string,
        CHANGED_BY string,
        CHANGED_AT timestamp_ntz
      )
    `,
  );
}

async function writeSnowflakeOpenStockBatch(args: {
  batchId: string;
  operation: string;
  runDate: string;
  changedBy: string;
  affectedKeys: number;
}): Promise<void> {
  const database = configuredSnowflakeDatabase();
  const schema = configuredSnowflakeSchema();
  await runSnowflakeStatement(
    `
      insert into ${database}.${schema}.OPENSTOCK_CHANGE_BATCH
        (BATCH_ID, OPERATION, RUN_DATE, CHANGED_BY, CHANGED_AT, AFFECTED_KEYS, UNDONE_AT, UNDONE_BY)
      select ?, ?, ?, ?, current_timestamp(), ?, null, null
    `,
    [args.batchId, args.operation, args.runDate, args.changedBy, args.affectedKeys],
  );
}

async function writeSnowflakeOpenStockLog(args: {
  batchId: string;
  operation: string;
  runDate: string;
  rowKey: string;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
}): Promise<void> {
  const database = configuredSnowflakeDatabase();
  const schema = configuredSnowflakeSchema();
  await runSnowflakeStatement(
    `
      insert into ${database}.${schema}.OPENSTOCK_CHANGE_LOG
        (BATCH_ID, OPERATION, RUN_DATE, DISTCODE_MOG_DIN, COLUMN_NAME, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT)
      select ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp()
    `,
    [
      args.batchId,
      args.operation,
      args.runDate,
      args.rowKey,
      args.column,
      args.oldValue == null ? null : String(args.oldValue),
      args.newValue == null ? null : String(args.newValue),
      args.changedBy,
    ],
  );
}

async function fetchSnowflakeOpenStockValues(rowKey: string, runDate: string, columns: string[]): Promise<Record<string, unknown>> {
  if (columns.length === 0) {
    return {};
  }
  const database = configuredSnowflakeDatabase();
  const schema = configuredSnowflakeSchema();
  const openStockTable = `${database}.${schema}.OPENSTOCKREPORT`;
  const sourceColumns = await fetchSourceColumns({ name: 'OPENSTOCKREPORT', objectName: openStockTable });
  const actualColumns = columns
    .map((column) => sourceColumns.get(column.toUpperCase()))
    .filter((column): column is string => Boolean(column));

  if (actualColumns.length === 0) {
    return {};
  }

  const selectSql = actualColumns.map((column) => quoteSnowflakeIdentifier(column)).join(', ');
  const rows = await runSnowflakeQuery(
    `
      select ${selectSql}
      from ${openStockTable}
      where ${quoteSnowflakeIdentifier('DISTCODE MOG DIN')} = ?
        and ${insertDateKeyExpression(quoteSnowflakeIdentifier('INSERT_DATE'))} = ?
      limit 1
    `,
    [rowKey, normalizeSnapshot(runDate)],
  );
  return rows[0] ?? {};
}

export async function fetchRecentSnapshotDates(config: HubConfig, limit = 25): Promise<string[]> {
  const queries: string[] = [];
  const binds: unknown[] = [];
  for (const source of config.sources) {
    const columns = await fetchSourceColumns(source);
    const snapshotColumn = pickActualColumn(columns, source.snapshotColumns);
    if (!snapshotColumn) {
      continue;
    }
    queries.push(
      `
        select distinct ${insertDateKeyExpression(quoteSnowflakeIdentifier(snapshotColumn))} as INSERT_DATE_KEY
        from ${source.objectName}
        where ${quoteSnowflakeIdentifier(snapshotColumn)} is not null
      `,
    );
  }

  if (queries.length === 0) {
    return [];
  }

  binds.push(Math.max(1, Math.min(limit, 100)));
  const rows = await runSnowflakeQuery<{ INSERT_DATE_KEY: string }>(
    `
      select INSERT_DATE_KEY
      from (${queries.join(' union ')})
      where INSERT_DATE_KEY is not null
        and INSERT_DATE_KEY <> ''
      order by INSERT_DATE_KEY desc
      limit ?
    `,
    binds,
  );
  return rows.map((row) => String(row.INSERT_DATE_KEY)).filter(Boolean);
}

export async function undoLatestOpenStockBatch(args: {
  runDate: string;
  userName: string;
  operation?: string;
}): Promise<{ batchId?: string; keysReverted: number; rowsAffected: number; message: string }> {
  const database = configuredSnowflakeDatabase();
  const schema = configuredSnowflakeSchema();
  await ensureSnowflakeOpenStockAuditTables();
  const operation = args.operation ?? 'INLINE_SAVE';
  const batchRows = await runSnowflakeQuery<{ BATCH_ID: string }>(
    `
      select BATCH_ID
      from ${database}.${schema}.OPENSTOCK_CHANGE_BATCH
      where RUN_DATE = ?
        and OPERATION = ?
        and CHANGED_BY = ?
        and UNDONE_AT is null
      order by CHANGED_AT desc
      limit 1
    `,
    [normalizeSnapshot(args.runDate), operation, args.userName],
  );
  const batchId = batchRows[0]?.BATCH_ID;
  if (!batchId) {
    return { keysReverted: 0, rowsAffected: 0, message: 'No saved change batch was found to undo.' };
  }

  const changeRows = await runSnowflakeQuery<{
    DISTCODE_MOG_DIN: string;
    COLUMN_NAME: string;
    OLD_VALUE: string | null;
  }>(
    `
      select DISTCODE_MOG_DIN, COLUMN_NAME, OLD_VALUE
      from ${database}.${schema}.OPENSTOCK_CHANGE_LOG
      where BATCH_ID = ?
    `,
    [batchId],
  );

  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of changeRows) {
    const key = String(row.DISTCODE_MOG_DIN ?? '').trim();
    const column = String(row.COLUMN_NAME ?? '').trim();
    if (!key || !column) {
      continue;
    }
    const values = byKey.get(key) ?? {};
    values[column] = row.OLD_VALUE;
    byKey.set(key, values);
  }

  let rowsAffected = 0;
  for (const [rowKey, values] of byKey.entries()) {
    rowsAffected += await updateSnowflakeOpenStockRow(rowKey, args.runDate, values, args.userName);
  }

  await runSnowflakeStatement(
    `
      update ${database}.${schema}.OPENSTOCK_CHANGE_BATCH
      set UNDONE_AT = current_timestamp(),
          UNDONE_BY = ?
      where BATCH_ID = ?
    `,
    [args.userName, batchId],
  );

  clearHubRowsCache();
  return {
    batchId,
    keysReverted: byKey.size,
    rowsAffected,
    message: `Undo complete. Keys reverted: ${byKey.size}; rows affected: ${rowsAffected}.`,
  };
}

async function updateSnowflakeOpenStockRow(
  rowKey: string,
  runDate: string,
  values: Record<string, unknown>,
  userName: string,
): Promise<number> {
  const openStockTable = `${configuredSnowflakeDatabase()}.${configuredSnowflakeSchema()}.OPENSTOCKREPORT`;
  const sourceColumns = await fetchSourceColumns({ name: 'OPENSTOCKREPORT', objectName: openStockTable });
  const setLines: string[] = [];
  const binds: unknown[] = [];

  function hasColumn(column: string): boolean {
    return sourceColumns.has(column.toUpperCase());
  }

  function actualColumn(column: string): string {
    return sourceColumns.get(column.toUpperCase()) ?? column;
  }

  function addTrimmed(column: string): void {
    if (!hasColumn(column)) {
      return;
    }
    setLines.push(`${quoteSnowflakeIdentifier(actualColumn(column))} = NULLIF(TRIM(?), '')`);
    binds.push(values[column] ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(values, 'New Item?')) {
    addTrimmed('New Item?');
  }

  if (Object.prototype.hasOwnProperty.call(values, 'In Stock (Y/N?)') && hasColumn('In Stock (Y/N?)')) {
    setLines.push(`
      ${quoteSnowflakeIdentifier(actualColumn('In Stock (Y/N?)'))} = CASE
        WHEN UPPER(TRIM(COALESCE(?, ''))) IN ('Y', 'YES', 'TRUE', 'T', '1') THEN 'Y'
        WHEN UPPER(TRIM(COALESCE(?, ''))) IN ('N', 'NO', 'FALSE', 'F', '0') THEN 'N'
        ELSE NULLIF(TRIM(?), '')
      END
    `);
    binds.push(values['In Stock (Y/N?)'] ?? null, values['In Stock (Y/N?)'] ?? null, values['In Stock (Y/N?)'] ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(values, 'ETA') && hasColumn('ETA')) {
    setLines.push(`
      ${quoteSnowflakeIdentifier(actualColumn('ETA'))} = COALESCE(
        TO_VARCHAR(TRY_TO_DATE(NULLIF(TRIM(?), ''), 'MM/DD/YYYY'), 'MM/DD/YYYY'),
        NULLIF(TRIM(?), '')
      )
    `);
    binds.push(values.ETA ?? null, values.ETA ?? null);
  }

  for (const column of [
    '+2 Weeks',
    'PO #',
    'Current DC Comment',
    'Current SCS Comment',
    'Required DC Update',
    'Pending Management Comments',
  ]) {
    if (Object.prototype.hasOwnProperty.call(values, column)) {
      addTrimmed(column);
    }
  }

  if (hasColumn('UPDATED_BY')) {
    setLines.push(`${quoteSnowflakeIdentifier(actualColumn('UPDATED_BY'))} = ?`);
    binds.push(userName || 'Unknown');
  } else if (hasColumn('LAST_UPDATED_BY')) {
    setLines.push(`${quoteSnowflakeIdentifier(actualColumn('LAST_UPDATED_BY'))} = ?`);
    binds.push(userName || 'Unknown');
  }

  if (hasColumn('UPDATED_AT')) {
    setLines.push(`${quoteSnowflakeIdentifier(actualColumn('UPDATED_AT'))} = current_timestamp()`);
  } else if (hasColumn('LAST_UPDATED_DATE')) {
    setLines.push(`${quoteSnowflakeIdentifier(actualColumn('LAST_UPDATED_DATE'))} = current_timestamp()`);
  }

  if (setLines.length === 0) {
    return 0;
  }

  const setSql = setLines.join(', ');
  binds.push(rowKey, normalizeSnapshot(runDate));
  const sqlText = `
    update ${openStockTable}
    set ${setSql}
    where ${quoteSnowflakeIdentifier('DISTCODE MOG DIN')} = ?
      and ${insertDateKeyExpression(quoteSnowflakeIdentifier('INSERT_DATE'))} = ?
  `;
  return runSnowflakeStatement(sqlText, binds);
}
