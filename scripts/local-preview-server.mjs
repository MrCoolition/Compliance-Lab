import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import crypto from 'node:crypto';

const root = resolve('.');

function loadLocalEnv() {
  for (const fileName of ['.env.local', '.env']) {
    try {
      const body = readFileSync(resolve(root, fileName), 'utf8');
      for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key] !== undefined) continue;
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // Env files are optional.
    }
  }
}

loadLocalEnv();

const port = Number(process.env.PORT || 4173);

const REPORT_DB = process.env.SNOWFLAKE_DATABASE || process.env.SNOWFLAKE_DB || 'FOODBUY_MASALA_PROD';
const REPORT_SCHEMA = process.env.SNOWFLAKE_SCHEMA || 'COMPLIANCE_LAB';
const SILVER_SCHEMA = process.env.SNOWFLAKE_SILVER_SCHEMA || 'MASALA_SILVER_COMPLIANCE_LAB';
const OPENSTOCK_KEY = 'DISTCODE MOG DIN';
const OPENSTOCK_TABLE = `${REPORT_DB}.${REPORT_SCHEMA}.OPENSTOCKREPORT`;
const CHANGE_BATCH_TABLE = `${REPORT_DB}.${REPORT_SCHEMA}.OPENSTOCK_CHANGE_BATCH`;
const CHANGE_LOG_TABLE = `${REPORT_DB}.${REPORT_SCHEMA}.OPENSTOCK_CHANGE_LOG`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function fqn(objectName, schema = REPORT_SCHEMA) {
  return `${REPORT_DB}.${schema}.${objectName}`;
}

const hubs = {
  'open-stock': {
    label: 'Open Stock',
    description: 'Editable Open Stock worklist with saved change history.',
    sources: [
      { name: 'OPENSTOCKREPORT', objectName: fqn('OPENSTOCKREPORT'), keyColumns: [OPENSTOCK_KEY], snapshotColumns: ['INSERT_DATE'] },
      { name: 'OPENSTOCKREPORT_ALLMOG', objectName: fqn('OPENSTOCKREPORT_ALLMOG'), keyColumns: [OPENSTOCK_KEY], snapshotColumns: ['INSERT_DATE'] },
      { name: 'OPENSTOCKREPORT_OS', objectName: fqn('OPENSTOCKREPORT_OS'), keyColumns: [OPENSTOCK_KEY], snapshotColumns: ['INSERT_DATE'] },
      { name: 'OPENSTOCKREPORT_SYSCO', objectName: fqn('OPENSTOCKREPORT_SYSCO'), keyColumns: [OPENSTOCK_KEY], snapshotColumns: ['INSERT_DATE'] },
    ],
    columns: ['DISTRIBUTOR NAME', 'DISTRIBUTOR ID', OPENSTOCK_KEY, 'MOG NAME', 'MOG FLAG DESC', 'MANUFACTURER NAME', 'MIN', 'BRAND', 'DESCRIPTION', 'PACK SIZE', 'CREATED DATE', 'DIN', 'New Item?', 'In Stock (Y/N?)', 'ETA', '+2 Weeks', 'PO #', 'Previous DC Comment', 'Required DC Update', 'Current DC Comment', 'Previous SCS Comment', 'Current SCS Comment', 'Pending Management Comments', 'SCS'],
    editableColumns: ['New Item?', 'In Stock (Y/N?)', 'ETA', 'PO #', 'Current DC Comment', 'Current SCS Comment', 'Required DC Update', 'Pending Management Comments'],
    filterColumns: ['DISTRIBUTOR NAME', 'SCS', 'In Stock (Y/N?)', 'New Item?', '+2 Weeks'],
    searchColumns: ['DISTRIBUTOR NAME', 'SCS', 'MANUFACTURER NAME', 'BRAND', 'DESCRIPTION', 'DIN', OPENSTOCK_KEY, 'Current DC Comment', 'Current SCS Comment', 'Required DC Update', 'Pending Management Comments', 'PO #'],
  },
  'dc-matrix': hub('DC Matrix', 'DC Matrix records and supply-chain mapping.', [source('V_DC_MATRIX')], ['SC_PARENT_NAME', 'DISTRIBUTOR_TYPE', 'DISTRIBUTOR_COUNTRY', 'SUPPLY_CHAIN_NAME', 'SUPPLY_CHAIN_CODE', 'MOG_TYPE', 'ITRADE_NAME', 'SHORT_NAME', 'COMPASS', 'HEALTHTRUST', 'CONVERSION_DC'], ['DISTRIBUTOR_TYPE', 'SUPPLY_CHAIN_NAME', 'SUPPLY_CHAIN_CODE']),
  conversions: hub('Conversions', 'Conversion read models and manual override workflows.', [source('V_WORKING_MASTER_TOOL'), source('V_ACTION_FILE_TOOL'), source('DC_COMMUNICATION_TOOL', SILVER_SCHEMA)], ['PrimaryKey', 'ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION', 'COMPLETION STATUS', 'COMPLETION COMMENTS', 'Analyst'], ['ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION']),
  'unlocked-accounts': hub('Unlocked Accounts', 'Current unlocked and locked account state.', [source('UNLOCKED_ACCOUNTS'), source('LOCKED_INACTIVE_ACCOUNTS')], ['BUSINESS', 'CUSTOMER', 'DC_NAME', 'DISTRIBUTOR_CODE', 'SECTOR_ATTRIBUTE', 'UNIT_NUMBER', 'DSTCODEUNIT', 'DCN', 'DSTCODEDCN', 'DATE_UNLOCKED', 'ACCOUNT_TYPE', 'REQUESTOR_NAME'], ['DCN', 'UNIT_NUMBER', 'DC_NAME', 'SECTOR_ATTRIBUTE']),
  'slow-dead': hub('Slow and Dead', 'Slow and dead inventory view with sector and category analysis.', [source('V_SLOWDEAD_ALL')], ['Sector', 'Category', 'NOTICE', 'QOH', 'True Extended Value', 'Intentional?'], ['Sector', 'Category', 'NOTICE']),
  itrade: hub('iTrade', 'iTrade reference views loaded as separate source tabs.', [source('V_ITRADE_ACCOUNT_LIST'), source('V_AUTOSHIPMENT_ITRADE_TOOL'), source('V_ITRADE_CONVERSION_BAR_UNITS'), source('V_ITRADE_SECTORS_AT_DC')], ['ACCOUNT', 'DISTRIBUTOR', 'SECTOR', 'STATUS'], ['SECTOR', 'DISTRIBUTOR', 'STATUS']),
  'off-mog': hub('Off MOG', 'Off MOG reference view.', [source('V_OFF_MOG')], ['DISTRIBUTOR', 'MOG', 'DIN', 'BRAND', 'DESCRIPTION'], ['DISTRIBUTOR', 'MOG']),
  'prop-list': hub('Prop List', 'Monthly proprietary list view.', [source('V_PROPRIETARY_LIST_MONTHLY')], ['SECTOR', 'NOTICE', 'CATEGORY', 'DIN', 'MIN', 'BRAND', 'DESCRIPTION'], ['SECTOR', 'NOTICE', 'CATEGORY']),
  substitutions: hub('Substitutions', 'Substitutions view with global search and export.', [source('V_SUBSTITUTIONS')], ['DISTRIBUTOR', 'DIN', 'BRAND', 'DESCRIPTION', 'SUBSTITUTE'], ['DISTRIBUTOR', 'CATEGORY']),
  autoshipments: hub('Autoshipments', 'Autoshipments workflow view.', [source('V_AUTO_SHIPMENTS')], ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND', 'ACCOUNT', 'DISTRIBUTOR'], ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND']),
};

function source(objectName, schema = REPORT_SCHEMA) {
  return { name: objectName, objectName: fqn(objectName, schema), keyColumns: [] };
}

function hub(label, description, sources, columns, filterColumns = []) {
  return {
    label,
    description,
    sources,
    columns,
    editableColumns: [],
    filterColumns,
    searchColumns: [],
  };
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function insertDateExpr(columnSql) {
  return `SUBSTR(REGEXP_REPLACE(TO_VARCHAR(${columnSql}), '[^0-9]', ''), 1, 8)`;
}

function normalizeSnapshot(value, fallback = 'current') {
  const text = String(value ?? '').trim();
  const digits = text.replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : text || fallback;
}

function configuredPrivateKey() {
  if (process.env.SNOWFLAKE_PRIVATE_KEY) return process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  if (process.env.SNOWFLAKE_PRIVATE_KEY_BASE64) return Buffer.from(process.env.SNOWFLAKE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
  if (process.env.SNOWFLAKE_PRIVATE_KEY_PATH) return readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH, 'utf8');
  return '';
}

function missingSnowflakeConfig() {
  const missing = [];
  const authenticator = String(process.env.SNOWFLAKE_AUTHENTICATOR || '').toUpperCase();
  const browserSso = authenticator === 'EXTERNALBROWSER';
  const oauth = authenticator === 'OAUTH';
  if (!process.env.SNOWFLAKE_ACCOUNT) missing.push('SNOWFLAKE_ACCOUNT');
  if (!process.env.SNOWFLAKE_USERNAME) missing.push('SNOWFLAKE_USERNAME');
  if (!process.env.SNOWFLAKE_WAREHOUSE) missing.push('SNOWFLAKE_WAREHOUSE');
  if (oauth && !(process.env.SNOWFLAKE_OAUTH_TOKEN || process.env.SNOWFLAKE_TOKEN)) missing.push('SNOWFLAKE_OAUTH_TOKEN');
  if (!browserSso && !oauth && !process.env.SNOWFLAKE_PASSWORD && !configuredPrivateKey()) {
    missing.push('SNOWFLAKE_PASSWORD or SNOWFLAKE_PRIVATE_KEY');
  }
  return missing;
}

async function snowflakeSdk() {
  try {
    const mod = await import('snowflake-sdk');
    return mod.default || mod;
  } catch (error) {
    throw new Error(`snowflake-sdk is not installed for the local preview. Run npm install before live preview. (${error.message})`);
  }
}

async function snowflakeQuery(sqlText, binds = []) {
  const missing = missingSnowflakeConfig();
  if (missing.length) {
    throw new Error(`Snowflake connection is not configured. Missing: ${missing.join(', ')}.`);
  }

  const snowflake = await snowflakeSdk();
  const privateKey = configuredPrivateKey();
  const authenticator = String(process.env.SNOWFLAKE_AUTHENTICATOR || '').toUpperCase();
  const oauth = authenticator === 'OAUTH';
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: REPORT_DB,
    schema: REPORT_SCHEMA,
    ...(process.env.SNOWFLAKE_ROLE ? { role: process.env.SNOWFLAKE_ROLE } : {}),
    ...(process.env.SNOWFLAKE_AUTHENTICATOR ? { authenticator: process.env.SNOWFLAKE_AUTHENTICATOR } : {}),
    ...(oauth ? { token: process.env.SNOWFLAKE_OAUTH_TOKEN || process.env.SNOWFLAKE_TOKEN } : {}),
    ...(!oauth && privateKey ? { privateKey } : {}),
    ...(!oauth && !privateKey && process.env.SNOWFLAKE_PASSWORD ? { password: process.env.SNOWFLAKE_PASSWORD } : {}),
    ...(privateKey && process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE ? { privateKeyPass: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE } : {}),
    ...(String(process.env.SNOWFLAKE_CLIENT_STORE_TEMPORARY_CREDENTIAL || '').toLowerCase() === 'true' ? { clientStoreTemporaryCredential: true } : {}),
  });

  if (typeof connection.connectAsync === 'function') {
    await connection.connectAsync();
  } else {
    await new Promise((resolveConnect, rejectConnect) => {
      connection.connect((error) => (error ? rejectConnect(error) : resolveConnect()));
    });
  }

  try {
    return await new Promise((resolveRows, rejectRows) => {
      connection.execute({
        sqlText,
        binds,
        complete: (error, _statement, rows) => (error ? rejectRows(error) : resolveRows(rows || [])),
      });
    });
  } finally {
    await new Promise((resolveDestroy) => connection.destroy(() => resolveDestroy()));
  }
}

const columnCache = new Map();

function splitFqn(objectName) {
  const parts = objectName.split('.').map((part) => part.trim()).filter(Boolean);
  return parts.length === 3 ? { database: parts[0], schema: parts[1], object: parts[2] } : undefined;
}

async function sourceColumns(sourceConfig) {
  if (columnCache.has(sourceConfig.objectName)) return columnCache.get(sourceConfig.objectName);
  const fqnParts = splitFqn(sourceConfig.objectName);
  if (!fqnParts) return new Map();
  const rows = await snowflakeQuery(
    `
      select column_name
      from ${fqnParts.database}.information_schema.columns
      where table_schema = ?
        and table_name = ?
      order by ordinal_position
    `,
    [fqnParts.schema.toUpperCase(), fqnParts.object.toUpperCase()],
  );
  const map = new Map(rows.map((row) => [String(row.COLUMN_NAME).toUpperCase(), String(row.COLUMN_NAME)]));
  columnCache.set(sourceConfig.objectName, map);
  return map;
}

function actualColumn(columns, candidates = []) {
  for (const candidate of candidates) {
    const hit = columns.get(String(candidate).toUpperCase());
    if (hit) return hit;
  }
  return undefined;
}

function filterValues(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim() !== '' && value !== 'All') return [value];
  return [];
}

function normalizeFilters(raw = {}) {
  const normalized = { ...raw };
  if (raw.distributor) normalized['DISTRIBUTOR NAME'] = filterValues(raw.distributor);
  if (raw.scs) normalized.SCS = filterValues(raw.scs);
  if (raw.inStock && raw.inStock !== 'All') normalized['In Stock (Y/N?)'] = filterValues(raw.inStock);
  if (raw.newItem && raw.newItem !== 'All') normalized['New Item?'] = filterValues(raw.newItem);
  return normalized;
}

async function buildRowsForSource(config, sourceConfig, url) {
  const columns = await sourceColumns(sourceConfig);
  const rawFilters = JSON.parse(url.searchParams.get('filters') || '{}');
  const filters = normalizeFilters(rawFilters);
  const runDate = url.searchParams.get('runDate');
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const pageSize = Math.max(1, Math.min(Number(url.searchParams.get('pageSize') || 500), 1000));
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const clauses = [];
  const binds = [];

  const snapshotColumn = actualColumn(columns, sourceConfig.snapshotColumns || []);
  if (runDate && snapshotColumn) {
    clauses.push(`${insertDateExpr(quoteIdent(snapshotColumn))} = ?`);
    binds.push(normalizeSnapshot(runDate));
  }

  const allowed = new Set(config.filterColumns.map((column) => column.toUpperCase()));
  for (const [column, rawValue] of Object.entries(filters)) {
    const values = filterValues(rawValue);
    const target = columns.get(column.toUpperCase());
    if (!target || !allowed.has(column.toUpperCase()) || values.length === 0) continue;
    clauses.push(`TO_VARCHAR(${quoteIdent(target)}) in (${values.map(() => '?').join(', ')})`);
    binds.push(...values);
  }

  if (search) {
    const searchColumns = (config.searchColumns.length ? config.searchColumns : Array.from(columns.values()))
      .map((column) => columns.get(column.toUpperCase()))
      .filter(Boolean);
    if (searchColumns.length) {
      clauses.push(`(${searchColumns.map((column) => `LOWER(TO_VARCHAR(${quoteIdent(column)})) like ?`).join(' or ')})`);
      binds.push(...searchColumns.map(() => `%${search}%`));
    }
  }

  const whereSql = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  const offset = (page - 1) * pageSize;
  const rows = await snowflakeQuery(`select * from ${sourceConfig.objectName}${whereSql} limit ${pageSize} offset ${offset}`, binds);
  return rows.map((row) => ({
    rowKey: rowKeyFor(row, sourceConfig),
    sourceName: sourceConfig.name,
    snapshotDate: runDate ? normalizeSnapshot(runDate) : normalizeSnapshot(firstPresent(row, sourceConfig.snapshotColumns || [])),
    data: { ...row, __sourceName: sourceConfig.name },
    syncedAt: new Date().toISOString(),
  }));
}

function firstPresent(row, candidates = []) {
  const byUpper = new Map(Object.keys(row).map((key) => [key.toUpperCase(), key]));
  for (const candidate of candidates) {
    const actual = byUpper.get(candidate.toUpperCase()) || candidate;
    const value = row[actual];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function rowKeyFor(row, sourceConfig) {
  const key = firstPresent(row, sourceConfig.keyColumns || []);
  if (key !== undefined) return String(key).trim().replace(/\s+/g, ' ');
  return Buffer.from(JSON.stringify(row)).toString('base64url').slice(0, 32);
}

function orderedColumns(config, rows) {
  const seen = new Set();
  const ordered = [];
  for (const column of config.columns) {
    if (!seen.has(column)) {
      ordered.push(column);
      seen.add(column);
    }
  }
  for (const row of rows) {
    for (const column of Object.keys(row.data || {})) {
      if (!seen.has(column)) {
        ordered.push(column);
        seen.add(column);
      }
    }
  }
  return ordered;
}

function metricsFor(key, rows) {
  if (key !== 'open-stock') return { total: rows.length, visibleRows: rows.length };
  const value = (row, column) => String(row.data?.[column] ?? '').trim();
  const unique = (column) => new Set(rows.map((row) => value(row, column)).filter(Boolean)).size;
  const norm = (row, column) => value(row, column).toUpperCase();
  return {
    total: rows.length,
    distributors: unique('DISTRIBUTOR NAME'),
    scs: unique('SCS'),
    outOfStock: rows.filter((row) => ['N', 'NO', 'FALSE', '0'].includes(norm(row, 'In Stock (Y/N?)'))).length,
    missingEta: rows.filter((row) => value(row, 'ETA') === '').length,
    missingPo: rows.filter((row) => value(row, 'PO #') === '').length,
    pendingManagement: rows.filter((row) => value(row, 'Pending Management Comments') !== '').length,
  };
}

async function getHubPayload(key, url) {
  const config = hubs[key];
  if (!config) throw Object.assign(new Error('Hub not found.'), { statusCode: 404 });

  const errors = [];
  const rows = [];
  for (const sourceConfig of config.sources) {
    try {
      const sourceRows = await buildRowsForSource(config, sourceConfig, url);
      if (key === 'open-stock') {
        if (sourceRows.length > 0) rows.push(...sourceRows);
        if (sourceRows.length > 0) break;
      } else {
        rows.push(...sourceRows);
      }
    } catch (error) {
      errors.push(`${sourceConfig.name}: ${error.message}`);
    }
  }
  if (!rows.length && errors.length) throw new Error(errors.join(' | '));

  return {
    hub: key,
    label: config.label,
    description: config.description,
    columns: orderedColumns(config, rows),
    editableColumns: config.editableColumns,
    filterColumns: config.filterColumns,
    sources: config.sources.map((sourceConfig) => sourceConfig.name),
    rows,
    total: rows.length,
    metrics: metricsFor(key, rows),
    sync: { lastStatus: errors.length ? `partial (${errors.length} source error${errors.length === 1 ? '' : 's'})` : 'live', lastRunAt: new Date().toISOString() },
  };
}

async function ensureOpenStockAuditTables() {
  await snowflakeQuery(`create table if not exists ${CHANGE_BATCH_TABLE} (BATCH_ID string, OPERATION string, RUN_DATE string, CHANGED_BY string, CHANGED_AT timestamp_ntz, AFFECTED_KEYS number, UNDONE_AT timestamp_ntz, UNDONE_BY string)`);
  await snowflakeQuery(`create table if not exists ${CHANGE_LOG_TABLE} (BATCH_ID string, OPERATION string, RUN_DATE string, DISTCODE_MOG_DIN string, COLUMN_NAME string, OLD_VALUE string, NEW_VALUE string, CHANGED_BY string, CHANGED_AT timestamp_ntz)`);
}

async function updateOpenStockRow(rowKey, runDate, values, userName) {
  const columns = await sourceColumns({ name: 'OPENSTOCKREPORT', objectName: OPENSTOCK_TABLE });
  const setLines = [];
  const binds = [];
  const has = (column) => columns.has(column.toUpperCase());
  const actual = (column) => columns.get(column.toUpperCase()) || column;
  const addTrimmed = (column) => {
    if (!Object.hasOwn(values, column) || !has(column)) return;
    setLines.push(`${quoteIdent(actual(column))} = NULLIF(TRIM(?), '')`);
    binds.push(values[column] ?? null);
  };

  addTrimmed('New Item?');
  if (Object.hasOwn(values, 'In Stock (Y/N?)') && has('In Stock (Y/N?)')) {
    setLines.push(`${quoteIdent(actual('In Stock (Y/N?)'))} = CASE WHEN UPPER(TRIM(COALESCE(?, ''))) IN ('Y','YES','TRUE','T','1') THEN 'Y' WHEN UPPER(TRIM(COALESCE(?, ''))) IN ('N','NO','FALSE','F','0') THEN 'N' ELSE NULLIF(TRIM(?), '') END`);
    binds.push(values['In Stock (Y/N?)'] ?? null, values['In Stock (Y/N?)'] ?? null, values['In Stock (Y/N?)'] ?? null);
  }
  if (Object.hasOwn(values, 'ETA') && has('ETA')) {
    setLines.push(`${quoteIdent(actual('ETA'))} = COALESCE(TO_VARCHAR(TRY_TO_DATE(NULLIF(TRIM(?), ''), 'MM/DD/YYYY'), 'MM/DD/YYYY'), NULLIF(TRIM(?), ''))`);
    binds.push(values.ETA ?? null, values.ETA ?? null);
  }
  ['PO #', 'Current DC Comment', 'Current SCS Comment', 'Required DC Update', 'Pending Management Comments'].forEach(addTrimmed);
  if (has('UPDATED_BY')) {
    setLines.push(`${quoteIdent(actual('UPDATED_BY'))} = ?`);
    binds.push(userName || 'Unknown');
  } else if (has('LAST_UPDATED_BY')) {
    setLines.push(`${quoteIdent(actual('LAST_UPDATED_BY'))} = ?`);
    binds.push(userName || 'Unknown');
  }
  if (has('UPDATED_AT')) setLines.push(`${quoteIdent(actual('UPDATED_AT'))} = current_timestamp()`);
  else if (has('LAST_UPDATED_DATE')) setLines.push(`${quoteIdent(actual('LAST_UPDATED_DATE'))} = current_timestamp()`);
  if (!setLines.length) return 0;

  const result = await snowflakeQuery(
    `
      update ${OPENSTOCK_TABLE}
      set ${setLines.join(', ')}
      where ${quoteIdent(OPENSTOCK_KEY)} = ?
        and ${insertDateExpr(quoteIdent('INSERT_DATE'))} = ?
    `,
    [...binds, rowKey, normalizeSnapshot(runDate)],
  );
  return Number(result?.[0]?.['number of rows updated'] || result?.[0]?.['rows_updated'] || 0);
}

async function handleOpenStockChanges(body) {
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (!body.runDate || changes.length === 0) return { batchId: '', rowsAffected: 0, loggedChanges: 0 };
  await ensureOpenStockAuditTables();
  const batchId = crypto.randomUUID();
  const userName = body.userName || 'Unknown';
  await snowflakeQuery(`insert into ${CHANGE_BATCH_TABLE} (BATCH_ID, OPERATION, RUN_DATE, CHANGED_BY, CHANGED_AT, AFFECTED_KEYS, UNDONE_AT, UNDONE_BY) select ?, 'INLINE_SAVE', ?, ?, current_timestamp(), ?, null, null`, [batchId, normalizeSnapshot(body.runDate), userName, changes.length]);
  let rowsAffected = 0;
  let loggedChanges = 0;
  for (const change of changes) {
    const values = Object.fromEntries(Object.entries(change.values || {}).filter(([column]) => hubs['open-stock'].editableColumns.includes(column)));
    if (!change.rowKey || !Object.keys(values).length) continue;
    const openStockColumns = await sourceColumns({ name: 'OPENSTOCKREPORT', objectName: OPENSTOCK_TABLE });
    const beforeColumns = Object.keys(values)
      .map((column) => openStockColumns.get(column.toUpperCase()))
      .filter(Boolean);
    const beforeRows = await snowflakeQuery(
      `
        select ${beforeColumns.length ? beforeColumns.map(quoteIdent).join(', ') : 'null as NO_WRITABLE_COLUMNS'}
        from ${OPENSTOCK_TABLE}
        where ${quoteIdent(OPENSTOCK_KEY)} = ?
          and ${insertDateExpr(quoteIdent('INSERT_DATE'))} = ?
        limit 1
      `,
      [change.rowKey, normalizeSnapshot(body.runDate)],
    );
    rowsAffected += await updateOpenStockRow(change.rowKey, body.runDate, values, userName);
    const before = beforeRows[0] || {};
    for (const [column, value] of Object.entries(values)) {
      const oldValue = firstPresent(before, [column]);
      if (String(oldValue ?? '').trim() === String(value ?? '').trim()) continue;
      await snowflakeQuery(`insert into ${CHANGE_LOG_TABLE} (BATCH_ID, OPERATION, RUN_DATE, DISTCODE_MOG_DIN, COLUMN_NAME, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT) select ?, 'INLINE_SAVE', ?, ?, ?, ?, ?, ?, current_timestamp()`, [batchId, normalizeSnapshot(body.runDate), change.rowKey, column, oldValue == null ? null : String(oldValue), value == null ? null : String(value), userName]);
      loggedChanges += 1;
    }
  }
  return { batchId, rowsAffected, loggedChanges };
}

async function handleOpenStockUndo(body) {
  const runDate = normalizeSnapshot(body.runDate);
  const userName = body.userName || 'Unknown';
  await ensureOpenStockAuditTables();
  const batchRows = await snowflakeQuery(
    `
      select BATCH_ID
      from ${CHANGE_BATCH_TABLE}
      where RUN_DATE = ?
        and OPERATION = 'INLINE_SAVE'
        and CHANGED_BY = ?
        and UNDONE_AT is null
      order by CHANGED_AT desc
      limit 1
    `,
    [runDate, userName],
  );
  const batchId = batchRows[0]?.BATCH_ID;
  if (!batchId) {
    return { keysReverted: 0, rowsAffected: 0, message: 'No saved change batch was found to undo.' };
  }

  const changeRows = await snowflakeQuery(
    `
      select DISTCODE_MOG_DIN, COLUMN_NAME, OLD_VALUE
      from ${CHANGE_LOG_TABLE}
      where BATCH_ID = ?
    `,
    [batchId],
  );
  const grouped = new Map();
  for (const row of changeRows) {
    const key = String(row.DISTCODE_MOG_DIN || '').trim();
    const column = String(row.COLUMN_NAME || '').trim();
    if (!key || !column) continue;
    const values = grouped.get(key) || {};
    values[column] = row.OLD_VALUE;
    grouped.set(key, values);
  }

  let rowsAffected = 0;
  for (const [rowKey, values] of grouped.entries()) {
    rowsAffected += await updateOpenStockRow(rowKey, runDate, values, userName);
  }

  await snowflakeQuery(
    `
      update ${CHANGE_BATCH_TABLE}
      set UNDONE_AT = current_timestamp(),
          UNDONE_BY = ?
      where BATCH_ID = ?
    `,
    [userName, batchId],
  );

  return {
    batchId,
    keysReverted: grouped.size,
    rowsAffected,
    message: `Undo complete. Keys reverted: ${grouped.size}; rows affected: ${rowsAffected}.`,
  };
}

async function recentOpenStockDates(url) {
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 25), 100));
  const queries = [];
  for (const sourceConfig of hubs['open-stock'].sources) {
    const columns = await sourceColumns(sourceConfig);
    const snapshot = actualColumn(columns, sourceConfig.snapshotColumns || []);
    if (!snapshot) continue;
    queries.push(`select distinct ${insertDateExpr(quoteIdent(snapshot))} as INSERT_DATE_KEY from ${sourceConfig.objectName} where ${quoteIdent(snapshot)} is not null`);
  }
  if (!queries.length) return [];
  const rows = await snowflakeQuery(`select INSERT_DATE_KEY from (${queries.join(' union ')}) where INSERT_DATE_KEY is not null and INSERT_DATE_KEY <> '' order by INSERT_DATE_KEY desc limit ?`, [limit]);
  return rows.map((row) => String(row.INSERT_DATE_KEY)).filter(Boolean);
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolveBody({});
      try {
        resolveBody(JSON.parse(text));
      } catch (error) {
        rejectBody(error);
      }
    });
    request.on('error', rejectBody);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function handleApi(request, response, url) {
  const hubMatch = url.pathname.match(/^\/api\/hubs\/([^/]+)$/);
  if (request.method === 'GET' && hubMatch) return sendJson(response, 200, await getHubPayload(hubMatch[1], url));
  if (request.method === 'GET' && url.pathname === '/api/open-stock/dates') return sendJson(response, 200, { dates: await recentOpenStockDates(url) });
  if (request.method === 'POST' && url.pathname === '/api/open-stock/changes') return sendJson(response, 200, await handleOpenStockChanges(await readRequestBody(request)));
  if (request.method === 'POST' && url.pathname === '/api/open-stock/undo') return sendJson(response, 200, await handleOpenStockUndo(await readRequestBody(request)));
  if (request.method === 'POST' && /^\/api\/sync\/[^/]+$/.test(url.pathname)) return sendJson(response, 200, { message: 'Live query mode is active; refresh uses the current source rows.' });
  if (request.method === 'POST' && url.pathname === '/api/feedback') return sendJson(response, 501, { error: 'Feedback writes require the deployed API path.' });
  return sendJson(response, 404, { error: 'Endpoint not found.' });
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const target = decoded === '/' ? '/preview.html' : decoded;
  const candidates = [resolve(join(root, normalize(target))), resolve(join(root, 'public', normalize(target)))];
  return candidates.find((candidate) => candidate.startsWith(root));
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      const status = error.statusCode || (String(error.message || '').includes('not configured') || String(error.message || '').includes('not installed') ? 503 : 500);
      sendJson(response, status, { error: error instanceof Error ? error.message : 'Request failed.' });
    }
    return;
  }

  const pathname = safePath(url.pathname) || resolve(root, 'preview.html');
  const paths = [pathname, resolve(root, 'public', url.pathname.replace(/^\//, '')), resolve(root, 'preview.html')];
  for (const path of paths) {
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': mimeTypes[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
      return;
    } catch {
      // Try the next candidate.
    }
  }

  sendJson(response, 404, { error: 'File not found.' });
}).listen(port, '127.0.0.1', () => {
  console.log(`Compliance Lab preview: http://127.0.0.1:${port}`);
  console.log(`Snowflake preview mode: ${missingSnowflakeConfig().length ? `missing ${missingSnowflakeConfig().join(', ')}` : 'configured'}`);
});
