const HUBS = [
  {
    key: 'open-stock',
    label: 'Open Stock',
    nav: 'Weekly worklist',
    tabs: ['worklist', 'insights', 'data'],
    filterColumns: ['DISTRIBUTOR NAME', 'SCS'],
  },
  {
    key: 'dc-matrix',
    label: 'DC Matrix',
    nav: 'Distributor mapping',
    tabs: ['view', 'upload'],
    filterColumns: ['SUPPLY_CHAIN_CODE', 'DISTRIBUTOR_TYPE'],
  },
  {
    key: 'conversions',
    label: 'Conversions',
    nav: 'Conversion workflows',
    tabs: ['source', 'upload'],
    filterColumns: ['ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION', 'COMPLETION STATUS', 'Analyst'],
  },
  {
    key: 'unlocked-accounts',
    label: 'Unlocked Accounts',
    nav: 'Account state',
    tabs: ['source', 'history'],
    filterColumns: ['DCN', 'UNIT_NUMBER', 'DC_NAME', 'SECTOR_ATTRIBUTE'],
  },
  {
    key: 'slow-dead',
    label: 'Slow and Dead',
    nav: 'Inventory analysis',
    tabs: ['view', 'insights'],
    filterColumns: ['Sector', 'Category', 'NOTICE'],
  },
  {
    key: 'itrade',
    label: 'iTrade',
    nav: 'iTrade views',
    tabs: ['source'],
    filterColumns: ['SECTOR', 'DISTRIBUTOR', 'STATUS'],
  },
  {
    key: 'off-mog',
    label: 'Off MOG',
    nav: 'Off-MOG review',
    tabs: ['view'],
    filterColumns: ['DISTRIBUTOR', 'MOG'],
  },
  {
    key: 'prop-list',
    label: 'Prop List',
    nav: 'Monthly prop list',
    tabs: ['view'],
    filterColumns: ['SECTOR', 'NOTICE', 'CATEGORY'],
  },
  {
    key: 'substitutions',
    label: 'Substitutions',
    nav: 'Sub references',
    tabs: ['view'],
    filterColumns: ['DISTRIBUTOR', 'CATEGORY'],
  },
  {
    key: 'autoshipments',
    label: 'Autoshipments',
    nav: 'Submission issues',
    tabs: ['view'],
    filterColumns: ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND'],
  },
];

const SPECIAL_OPEN_STOCK_FILTERS = {
  inStock: 'All',
  newItem: 'All',
  attentionOnly: false,
  missingEtaOnly: false,
  pendingMgmtOnly: false,
};

const OPEN_STOCK_ACTION_COLUMNS = [
  'DISTRIBUTOR NAME',
  'SCS',
  'DISTCODE MOG DIN',
  'BRAND',
  'DESCRIPTION',
  'DIN',
  'In Stock (Y/N?)',
  'ETA',
  'PO #',
  'Current DC Comment',
  'Current SCS Comment',
  'Required DC Update',
  'Pending Management Comments',
];

const AUTH_CODE_KEY = 'oidc_auth_code';
const ACCESS_TOKEN_KEY = 'oauth_access_token';
const ID_TOKEN_KEY = 'oidc_id_token';
const OIDC_STATE_KEY = 'oidc_state';

const state = {
  hub: 'open-stock',
  tab: 'worklist',
  source: '',
  sourceLabel: '',
  search: '',
  reportDate: '',
  previousDate: '',
  today: '',
  dates: [],
  filters: {},
  specialFilters: { ...SPECIAL_OPEN_STOCK_FILTERS },
  rows: [],
  previousRows: [],
  columns: [],
  editableColumns: [],
  filterColumns: [],
  metrics: {},
  sources: [],
  sync: {},
  auth: {
    checked: false,
    enabled: false,
    required: false,
    configured: false,
    oidcIssuer: '',
    authorizeUrl: '',
    clientId: '',
    redirectUri: '',
    logoutUrl: '',
    authenticated: false,
    claims: null,
    error: '',
  },
  changed: new Map(),
  rowByKey: new Map(),
  message: '',
  error: '',
  userName: 'SULLIK09',
  busy: false,
};

const app = document.querySelector('#app');
const API_CACHE_TTL_MS = 120_000;
const API_CACHE_LIMIT = 24;
const VIRTUAL_TABLE_THRESHOLD = 140;
const VIRTUAL_ROW_HEIGHT = 44;
const VIRTUAL_WINDOW_ROWS = 86;
const VIRTUAL_COMPACT_ROWS = 52;
const VIRTUAL_OVERSCAN = 8;
const VIRTUAL_RERENDER_DELTA = 6;
const apiCache = new Map();
const tableWindows = new Map();
const nonEmptyColumnCache = new WeakMap();
const filterValueCache = new WeakMap();
let loadRequestId = 0;
let queuedRender = 0;

function hubMeta(key = state.hub) {
  return HUBS.find((hub) => hub.key === key) || HUBS[0];
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cell(row, column) {
  return String(row?.data?.[column] ?? '');
}

function rawCell(row, column) {
  return row?.data?.[column];
}

function numberFormat(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : String(value ?? '');
}

function moneyFormat(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '';
}

function percentFormat(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  return d ? `${((n / d) * 100).toFixed(1)}%` : '0.0%';
}

function metricLabel(value) {
  return titleCase(String(value).replace(/[A-Z]/g, (letter) => ` ${letter}`));
}

const ICON_PATHS = {
  activity: '<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="M3 8v8l9 5 9-5V8"/>',
  boxes: '<path d="M2 7.5 7 5l5 2.5-5 2.5-5-2.5Z"/><path d="M2 7.5v5L7 15l5-2.5v-5"/><path d="m12 7.5 5-2.5 5 2.5-5 2.5-5-2.5Z"/><path d="M12 7.5v5l5 2.5 5-2.5v-5"/><path d="m7 15 5 2.5 5-2.5"/><path d="M7 15v4l5 2 5-2v-4"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16"/><path d="M3 21h18"/><path d="M9 8h1"/><path d="M14 8h1"/><path d="M9 12h1"/><path d="M14 12h1"/><path d="M9 16h1"/><path d="M14 16h1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
  fileQuestion: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9.1 11a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 19h.01"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h13l-1 5 1 5H4"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  packagePlus: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="M3 8v8l9 5 9-5V8"/><path d="M17 14v6"/><path d="M14 17h6"/>',
  packageX: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="M3 8v8l9 5 9-5V8"/><path d="m15.5 15.5 4 4"/><path d="m19.5 15.5-4 4"/>',
  sparkles: '<path d="M12 3 9.5 8.5 4 11l5.5 2.5L12 19l2.5-5.5L20 11l-5.5-2.5L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
  truck: '<path d="M10 17H5a2 2 0 0 1-2-2V6h12v11"/><path d="M15 8h3l3 4v3a2 2 0 0 1-2 2h-1"/><path d="M8 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/><path d="M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.activity}</svg>`;
}

function metricIconName(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('distributor')) return 'building';
  if (text === 'scs' || text.includes('analyst') || text.includes('user')) return 'users';
  if (text.includes('out of stock') || text.includes('oos')) return 'packageX';
  if (text.includes('attention') || text.includes('escalation')) return 'alert';
  if (text.includes('eta')) return 'clock';
  if (text.includes('po')) return 'fileQuestion';
  if (text.includes('pending') || text.includes('comment')) return 'message';
  if (text.includes('new')) return 'packagePlus';
  if (text.includes('value') || text.includes('tev')) return 'dollar';
  if (text.includes('qoh') || text.includes('stock')) return 'boxes';
  if (text.includes('intentional')) return 'flag';
  if (text.includes('total') || text.includes('rows') || text.includes('lines')) return 'list';
  return 'activity';
}

function hubIconName(key) {
  return {
    'open-stock': 'box',
    'dc-matrix': 'building',
    conversions: 'activity',
    'unlocked-accounts': 'users',
    'slow-dead': 'boxes',
    itrade: 'list',
    'off-mog': 'packageX',
    'prop-list': 'flag',
    substitutions: 'packagePlus',
    autoshipments: 'truck',
  }[key] || 'activity';
}

function renderMetricCard(label, value, detail = '') {
  return `
    <article class="metric">
      <div class="metric-icon">${iconSvg(metricIconName(label))}</div>
      <div class="metric-copy">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(numberFormat(value))}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    </article>
  `;
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function rowsToCsv(rows, columns) {
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(cell(row, column))).join(',')),
  ].join('\r\n');
}

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseJwt(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))));
  } catch {
    return null;
  }
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem('authToken');
}

function getIdToken() {
  return localStorage.getItem(ID_TOKEN_KEY) || sessionStorage.getItem(ID_TOKEN_KEY);
}

function getIdTokenClaims() {
  const token = getIdToken();
  return token ? parseJwt(token) : null;
}

function isTokenBypass() {
  return Boolean(localStorage.getItem('authTokenBypass'));
}

function hasLocalAuthSession() {
  return Boolean(getAccessToken()) || isTokenBypass();
}

function clearOidcSession() {
  sessionStorage.removeItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(ID_TOKEN_KEY);
}

function clearLocalSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(AUTH_CODE_KEY);
  clearOidcSession();
}

function generateAndStoreState() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(OIDC_STATE_KEY, value);
  return value;
}

function validateState(value) {
  const stored = sessionStorage.getItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(OIDC_STATE_KEY);
  return !stored || stored === value;
}

function applyAuthClaims() {
  const claims = getIdTokenClaims();
  state.auth.claims = claims;
  const user = claims?.username || claims?.user || claims?.name || claims?.email || claims?.sub;
  if (user) state.userName = String(user);
}

function authHeaders(options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function downloadFromUrl(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    let message = `Download failed: ${response.status}`;
    try {
      message = JSON.parse(text).error || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const disposition = response.headers.get('content-disposition') || '';
  const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || '';
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

async function api(path, options = {}) {
  const { skipAuth, headers: _headers, ...fetchOptions } = options;
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...authHeaders({ skipAuth, headers: _headers }) },
    ...fetchOptions,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    throw new Error(cleanText || `Request returned non-JSON response: ${response.status}`);
  }
  if (!response.ok) {
    if (response.status === 401 && state.auth.enabled) {
      state.auth.authenticated = false;
      if (state.auth.required) clearLocalSession();
    }
    throw new Error(json.error || `Request failed: ${response.status}`);
  }
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') clearClientCaches();
  return json;
}

async function loadAuthConfig() {
  try {
    const config = await api('/api/Auth/config', { skipAuth: true });
    state.auth = {
      ...state.auth,
      checked: true,
      enabled: Boolean(config.enabled),
      required: Boolean(config.required),
      configured: Boolean(config.configured),
      oidcIssuer: String(config.oidcIssuer || ''),
      authorizeUrl: String(config.authorizeUrl || ''),
      clientId: String(config.clientId || ''),
      redirectUri: String(config.redirectUri || window.location.origin),
      logoutUrl: String(config.logoutUrl || ''),
      authenticated: hasLocalAuthSession(),
      error: '',
    };
    await handleAuthCallback();
    applyAuthClaims();
  } catch (error) {
    state.auth.checked = true;
    state.auth.error = error.message;
    if (state.auth.required) state.error = error.message;
  }
}

function loginRedirect() {
  if (!state.auth.configured || !state.auth.oidcIssuer || !state.auth.clientId) {
    setMessage('', 'OIDC login is not configured for this environment.');
    render();
    return;
  }
  const oidcState = generateAndStoreState();
  const params = new URLSearchParams({
    client_id: state.auth.clientId,
    redirect_uri: state.auth.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: oidcState,
  });
  const authorizeUrl = state.auth.authorizeUrl || `${state.auth.oidcIssuer}/authorize`;
  window.location.href = `${authorizeUrl}?${params.toString()}`;
}

async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const oidcState = params.get('state');
  if (!code) {
    state.auth.authenticated = hasLocalAuthSession();
    return false;
  }

  if (oidcState && !validateState(oidcState)) {
    clearLocalSession();
    state.auth.authenticated = false;
    state.auth.error = 'State parameter validation failed.';
    return false;
  }

  try {
    const response = await api('/api/Auth/exchange-code', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ code, redirectUri: state.auth.redirectUri }),
    });
    localStorage.setItem(AUTH_CODE_KEY, code);
    if (response.access_token) localStorage.setItem(ACCESS_TOKEN_KEY, response.access_token);
    if (response.id_token) {
      localStorage.setItem(ID_TOKEN_KEY, response.id_token);
      sessionStorage.setItem(ID_TOKEN_KEY, response.id_token);
    }
    state.auth.authenticated = Boolean(response.access_token);
    state.auth.error = '';
    window.history.replaceState({}, '', window.location.pathname);
    return state.auth.authenticated;
  } catch (error) {
    clearLocalSession();
    state.auth.authenticated = false;
    state.auth.error = error.message;
    return false;
  }
}

function logout() {
  clearLocalSession();
  state.auth.authenticated = false;
  const service = encodeURIComponent(window.location.origin);
  if (state.auth.logoutUrl) {
    window.location.href = `${state.auth.logoutUrl}?service=${service}`;
    return;
  }
  render();
}

function clearClientCaches() {
  apiCache.clear();
  tableWindows.clear();
}

function pruneApiCache() {
  while (apiCache.size > API_CACHE_LIMIT) {
    apiCache.delete(apiCache.keys().next().value);
  }
}

async function cachedApi(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') return api(path, options);

  const cached = apiCache.get(path);
  if (cached && Date.now() - cached.createdAt < API_CACHE_TTL_MS) {
    return cached.value;
  }
  apiCache.delete(path);

  const pending = api(path)
    .then((result) => {
      apiCache.set(path, { createdAt: Date.now(), value: result });
      pruneApiCache();
      return result;
    })
    .catch((error) => {
      apiCache.delete(path);
      throw error;
    });

  apiCache.set(path, { createdAt: Date.now(), value: pending });
  pruneApiCache();
  return pending;
}

function setMessage(message, error = '') {
  state.message = message || '';
  state.error = error || '';
}

function currentFilterPayload() {
  const payload = {};
  Object.entries(state.filters).forEach(([column, values]) => {
    if (Array.isArray(values) && values.length) payload[column] = values;
  });
  if (state.hub === 'open-stock') {
    if (state.specialFilters.distributor?.length) payload['DISTRIBUTOR NAME'] = state.specialFilters.distributor;
    if (state.specialFilters.scs?.length) payload.SCS = state.specialFilters.scs;
    payload.inStock = state.specialFilters.inStock;
    payload.newItem = state.specialFilters.newItem;
    payload.attentionOnly = state.specialFilters.attentionOnly;
    payload.missingEtaOnly = state.specialFilters.missingEtaOnly;
    payload.pendingMgmtOnly = state.specialFilters.pendingMgmtOnly;
  }
  return payload;
}

async function loadOpenStockDates() {
  try {
    const query = state.reportDate ? `?runDate=${encodeURIComponent(state.reportDate)}` : '';
    const result = await cachedApi(`/api/open-stock/dates${query}`);
    state.dates = result.dates || [];
    state.today = result.today || '';
    if (state.dates.length) {
      if (!state.reportDate || !state.dates.includes(state.reportDate)) {
        state.reportDate = state.dates[0];
      }
      state.previousDate = previousDateFromDates(state.dates, state.reportDate) || '';
    } else {
      if (!state.reportDate) state.reportDate = result.selectedDate || state.today || '';
      state.previousDate = result.previousDate || '';
    }
  } catch (error) {
    state.error = error.message;
  }
}

function previousDateFromDates(dates, selectedDate) {
  const selected = Number(selectedDate);
  if (!Number.isFinite(selected)) return '';
  return dates
    .map((date) => String(date || '').trim())
    .filter((date) => /^\d{8}$/.test(date) && Number(date) < selected)
    .sort((a, b) => Number(b) - Number(a))[0] || '';
}

async function loadPreviousOpenStockRows() {
  state.previousRows = [];
  if (state.hub !== 'open-stock' || !state.previousDate) return;
  try {
    const params = new URLSearchParams({
      page: '1',
      pageSize: 'all',
      search: state.search,
      runDate: state.previousDate,
      filters: JSON.stringify(currentFilterPayload()),
    });
    const result = await cachedApi(`/api/hubs/open-stock?${params.toString()}`);
    state.previousRows = result.rows || [];
  } catch {
    state.previousRows = [];
  }
}

async function loadHub() {
  const requestId = ++loadRequestId;
  state.busy = true;
  render();
  try {
    state.error = '';
    if (state.hub === 'open-stock') await loadOpenStockDates();
    if (requestId !== loadRequestId) return;
    const params = new URLSearchParams({
      page: '1',
      pageSize: 'all',
      search: state.search,
      filters: JSON.stringify(currentFilterPayload()),
    });
    if (state.hub === 'open-stock' && state.reportDate) params.set('runDate', state.reportDate);
    if (state.source) params.set('source', state.source);
    const result = await cachedApi(`/api/hubs/${state.hub}?${params.toString()}`);
    if (requestId !== loadRequestId) return;
    state.rows = result.rows || [];
    state.rowByKey = new Map(state.rows.map((row) => [row.rowKey, row]));
    state.columns = result.columns || [];
    state.editableColumns = result.editableColumns || [];
    state.filterColumns = result.filterColumns || hubMeta().filterColumns || [];
    state.metrics = result.metrics || {};
    state.sync = result.sync || {};
    state.sources = Array.isArray(result.sources) ? result.sources : [];
    if (state.hub !== 'open-stock' && !state.source && state.sources.length > 1) {
      state.source = state.sources[0].name;
      state.sourceLabel = state.sources[0].label || state.sources[0].name;
      await loadHub();
      return;
    }
    if (state.source && state.sources.length) {
      const source = state.sources.find((item) => item.name === state.source || item.label === state.source);
      state.sourceLabel = source?.label || state.source;
    }
    tableWindows.clear();
    state.changed.clear();
    await loadPreviousOpenStockRows();
    if (requestId !== loadRequestId) return;
  } catch (error) {
    if (requestId !== loadRequestId) return;
    state.rows = [];
    state.rowByKey = new Map();
    state.columns = [];
    state.editableColumns = [];
    state.metrics = {};
    state.sync = { lastStatus: 'connection error' };
    state.changed.clear();
    state.error = error.message;
  } finally {
    if (requestId === loadRequestId) {
      state.busy = false;
      render();
    }
  }
}

function updateCell(rowKey, column, value) {
  const row = state.rowByKey.get(rowKey) || state.rows.find((item) => item.rowKey === rowKey);
  if (!row) return;
  row.data[column] = value;
  const existing = state.changed.get(rowKey) || { rowKey, values: {} };
  existing.values[column] = value;
  state.changed.set(rowKey, existing);
  filterValueCache.delete(state.rows);
  nonEmptyColumnCache.delete(state.rows);
  scheduleRender();
}

async function saveChanges() {
  if (state.changed.size === 0) {
    setMessage('No changes to save.');
    render();
    return;
  }
  try {
    const changes = Array.from(state.changed.values());
    const endpoint = state.hub === 'open-stock' ? '/api/open-stock/changes' : `/api/hub-actions/${state.hub}`;
    const body =
      state.hub === 'open-stock'
        ? { runDate: state.reportDate, userName: state.userName, changes }
        : { action: 'save-source', payload: { source: state.source, userName: state.userName, changes } };
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    setMessage(result.message || `Saved ${result.loggedChanges ?? result.updated ?? state.changed.size} change(s).`);
    await loadHub();
  } catch (error) {
    setMessage('', error.message);
    render();
  }
}

async function undoLast() {
  try {
    const result = await api('/api/open-stock/undo', {
      method: 'POST',
      body: JSON.stringify({ runDate: state.reportDate, userName: state.userName }),
    });
    setMessage(result.message || 'Undo complete.');
    await loadHub();
  } catch (error) {
    setMessage('', error.message);
    render();
  }
}

async function runHubAction(action, payload = {}) {
  try {
    const result = await api(`/api/hub-actions/${state.hub}`, {
      method: 'POST',
      body: JSON.stringify({ action, payload: { ...payload, userName: state.userName, runDate: state.reportDate, previousRunDate: state.previousDate } }),
    });
    setMessage(result.message || 'Action complete.');
    if (result.runDate) state.reportDate = result.runDate;
    await loadHub();
  } catch (error) {
    setMessage('', error.message);
    render();
  }
}

async function syncHub() {
  try {
    const result = await api(`/api/sync/${state.hub}?runDate=${encodeURIComponent(state.reportDate)}`, { method: 'POST' });
    setMessage(result.message || 'Live rows refreshed.');
    await loadHub();
  } catch (error) {
    setMessage('', error.message);
    render();
  }
}

function optionHtml(column, value) {
  const options = {
    'New Item?': ['', 'YES', 'NO'],
    'In Stock (Y/N?)': ['', 'Y', 'N'],
    '+2 Weeks': ['', '+2 Weeks', '30+ Days'],
    'Pending Management Comments': [
      '',
      '2+ Weeks - No ETA/PO & No Justification',
      '+2 Weeks',
      '30+ Days - Not Stocked & No approval',
      'Repeat DC Comment',
    ],
  }[column];
  if (!options) return '';
  return `<select data-edit="${escapeHtml(column)}">${options
    .map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option || 'Blank')}</option>`)
    .join('')}</select>`;
}

function renderEditorCell(row, column) {
  const value = cell(row, column);
  if (!canEditColumn(column)) {
    return `<div class="cell-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div>`;
  }
  const select = optionHtml(column, value);
  if (select) return select;
  return `<input data-edit="${escapeHtml(column)}" value="${escapeHtml(value)}">`;
}

function sourceAllowsEdits() {
  if (state.hub === 'open-stock' || state.hub === 'dc-matrix' || state.hub === 'unlocked-accounts') return true;
  if (state.hub === 'conversions') {
    return ['SOURCING_CONVERSION_MASTER_TBL', 'CONVERSION_ANALYSIS_SRFS_MASTER_TBL', 'DC_COMMUNICATIONS_MANUAL_TBL'].includes(state.source);
  }
  return false;
}

function canEditColumn(column) {
  return sourceAllowsEdits() && state.editableColumns.includes(column);
}

function columnWidth(column) {
  const name = String(column || '').toUpperCase();
  if (['SCS', 'CA', 'MOG', 'DIN', 'MIN', 'QOH'].includes(name)) return 76;
  if (name.includes('DATE') || name.includes('DAY') || name.includes('MONTH') || name.includes('YEAR') || name.includes('FLAG')) return 104;
  if (name.includes('DESCRIPTION') || name.includes('COMMENT') || name.includes('UPDATE') || name.includes('REASON') || name.includes('NOTES')) return 230;
  if (name.includes('NAME') || name.includes('DISTRIBUTOR') || name.includes('CUSTOMER') || name.includes('CATEGORY') || name.includes('NOTICE')) return 170;
  if (name.includes('KEY') || name.includes('CODE') || name.includes('ACCOUNT') || name.includes('DSTCODE')) return 148;
  return 124;
}

function columnSizeClass(column) {
  const width = columnWidth(column);
  if (width <= 80) return 'col-xs';
  if (width <= 110) return 'col-sm';
  if (width <= 150) return 'col-md';
  if (width <= 190) return 'col-lg';
  return 'col-xl';
}

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tableKey(rows, columns, options) {
  return options.tableKey || simpleHash([state.hub, state.tab, state.source, state.reportDate, rows.length, columns.join('|')].join('::'));
}

function nonEmptyColumnsFor(rows, columns) {
  const signature = columns.join('\u001f');
  const cached = nonEmptyColumnCache.get(rows);
  if (cached?.signature === signature) return cached.columns;

  const columnsWithValues = new Set();
  for (const row of rows) {
    const data = row.data || {};
    for (const column of columns) {
      if (columnsWithValues.has(column)) continue;
      const value = data[column];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        columnsWithValues.add(column);
      }
    }
    if (columnsWithValues.size === columns.length) break;
  }

  nonEmptyColumnCache.set(rows, { signature, columns: columnsWithValues });
  return columnsWithValues;
}

function visibleColumnsFor(rows, columns, options) {
  if (options.keepMissing) return columns.filter(Boolean);
  const columnsWithValues = nonEmptyColumnsFor(rows, columns);
  const cols = columns.filter((column) => {
    if (!column) return false;
    if (canEditColumn(column) || (state.hub === 'open-stock' && OPEN_STOCK_ACTION_COLUMNS.includes(column))) return true;
    return columnsWithValues.has(column);
  });
  return cols.length ? cols : columns.filter(Boolean);
}

function renderTable(rows = state.rows, columns = state.columns, options = {}) {
  if (!rows.length) return '<div class="empty">No rows found.</div>';
  const visibleColumns = visibleColumnsFor(rows, columns, options);
  const tableMinWidth = Math.max(720, visibleColumns.reduce((total, column) => total + columnWidth(column), 0));
  const key = tableKey(rows, visibleColumns, options);
  const windowRows = options.compact ? VIRTUAL_COMPACT_ROWS : VIRTUAL_WINDOW_ROWS;
  const virtual = !options.noVirtual && rows.length > VIRTUAL_TABLE_THRESHOLD;
  const savedWindow = tableWindows.get(key) || { start: 0, scrollTop: 0 };
  const maxStart = Math.max(0, rows.length - windowRows);
  const start = virtual ? Math.min(Math.max(0, savedWindow.start || 0), maxStart) : 0;
  const end = virtual ? Math.min(rows.length, start + windowRows) : rows.length;
  const renderedRows = rows.slice(start, end);
  const topSpacer = virtual ? start * VIRTUAL_ROW_HEIGHT : 0;
  const bottomSpacer = virtual ? Math.max(0, rows.length - end) * VIRTUAL_ROW_HEIGHT : 0;
  const colSpan = Math.max(1, visibleColumns.length);
  const rowHtml = renderedRows
    .map(
      (row) => `<tr data-row-key="${escapeHtml(row.rowKey)}">
        ${visibleColumns
          .map((column) => {
            const changed = state.changed.get(row.rowKey)?.values?.[column] !== undefined;
            const editable = canEditColumn(column);
            return `<td class="${editable ? 'editable' : ''} ${changed ? 'changed' : ''}">${renderEditorCell(row, column)}</td>`;
          })
          .join('')}
      </tr>`,
    )
    .join('');

  return `
    <div class="table-frame">
      <div class="table-scroll ${options.compact ? 'compact' : ''}" ${
        virtual
          ? `data-virtual-table="${escapeHtml(key)}" data-row-height="${VIRTUAL_ROW_HEIGHT}" data-total-rows="${rows.length}" data-window-size="${windowRows}"`
          : ''
      }>
        <table style="min-width:${tableMinWidth}px">
          <colgroup>
            ${visibleColumns.map((column) => `<col class="${columnSizeClass(column)}">`).join('')}
          </colgroup>
          <thead><tr>${visibleColumns.map((column) => `<th><span class="th-label" title="${escapeHtml(column)}">${escapeHtml(column)}</span></th>`).join('')}</tr></thead>
          <tbody>
            ${topSpacer ? `<tr class="virtual-spacer"><td colspan="${colSpan}" style="height:${topSpacer}px"></td></tr>` : ''}
            ${rowHtml}
            ${bottomSpacer ? `<tr class="virtual-spacer"><td colspan="${colSpan}" style="height:${bottomSpacer}px"></td></tr>` : ''}
          </tbody>
        </table>
      </div>
      ${virtual ? `<div class="table-status">Rendering rows ${numberFormat(start + 1)}-${numberFormat(end)} of ${numberFormat(rows.length)}. Exports include every loaded row.</div>` : ''}
    </div>
  `;
}

function norm(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normStock(value) {
  const clean = norm(value);
  if (['Y', 'YES', 'TRUE', 'T', '1'].includes(clean)) return 'Y';
  if (['N', 'NO', 'FALSE', 'F', '0'].includes(clean)) return 'N';
  return '';
}

function openStockKpis(rows = state.rows) {
  const total = rows.length;
  const oos = rows.filter((row) => normStock(rawCell(row, 'In Stock (Y/N?)')) === 'N').length;
  const missingEta = rows.filter((row) => cell(row, 'ETA').trim() === '').length;
  const missingPo = rows.filter((row) => cell(row, 'PO #').trim() === '').length;
  const attention = rows.filter((row) => normStock(rawCell(row, 'In Stock (Y/N?)')) === 'N' && (cell(row, 'ETA').trim() === '' || cell(row, 'PO #').trim() === '')).length;
  const pending = rows.filter((row) => cell(row, 'Pending Management Comments').trim() !== '').length;
  const newItems = rows.filter((row) => norm(rawCell(row, 'New Item?')) === 'YES').length;
  return { total, oos, attention, missingEta, missingPo, newItems, pending };
}

function attentionRows(rows = state.rows) {
  return rows.filter((row) => normStock(rawCell(row, 'In Stock (Y/N?)')) === 'N' && (cell(row, 'ETA').trim() === '' || cell(row, 'PO #').trim() === ''));
}

function parseEta(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function etaBuckets(rows = state.rows) {
  const run = state.reportDate && /^\d{8}$/.test(state.reportDate)
    ? new Date(`${state.reportDate.slice(0, 4)}-${state.reportDate.slice(4, 6)}-${state.reportDate.slice(6, 8)}T00:00:00`)
    : new Date();
  const buckets = { Overdue: 0, '0-14d': 0, '15-30d': 0, '31-60d': 0, '61+d': 0, Unknown: 0 };
  rows.forEach((row) => {
    const eta = parseEta(rawCell(row, 'ETA'));
    if (!eta) {
      buckets.Unknown += 1;
      return;
    }
    const days = Math.floor((eta.getTime() - run.getTime()) / 86400000);
    if (days < 0) buckets.Overdue += 1;
    else if (days <= 14) buckets['0-14d'] += 1;
    else if (days <= 30) buckets['15-30d'] += 1;
    else if (days <= 60) buckets['31-60d'] += 1;
    else buckets['61+d'] += 1;
  });
  return buckets;
}

function groupCount(rows, column, predicate = () => true, limit = 12) {
  const counts = new Map();
  rows.forEach((row) => {
    if (!predicate(row)) return;
    const key = cell(row, column).trim() || '(blank)';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function renderBars(items, format = numberFormat) {
  const max = Math.max(...items.map(([, value]) => Number(value) || 0), 1);
  return `<div class="bars">${items
    .map(
      ([label, value]) => `<div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track"><span style="width:${Math.max(2, (Number(value || 0) / max) * 100)}%"></span></div>
        <strong>${escapeHtml(format(value))}</strong>
      </div>`,
    )
    .join('')}</div>`;
}

function renderInsightHighlights() {
  const rows = state.rows;
  const isMmmNewht = (row) => ['MMM', 'NEWHT'].includes(norm(rawCell(row, 'MOG FLAG DESC') || rawCell(row, 'MOG FLAG') || rawCell(row, 'MOG')));
  const plus = (row) => norm(rawCell(row, '+2 Weeks'));
  const pending = (row) => norm(rawCell(row, 'Pending Management Comments'));
  const statusText = (row) => norm(rawCell(row, 'ESCALATION SUPPORT [ES1.1]') || rawCell(row, 'ESCALATION SUPPORT') || rawCell(row, 'STATUS') || rawCell(row, 'Required DC Update') || rawCell(row, 'Current DC Comment'));
  const conversion = (row) => norm(rawCell(row, 'Conversion Item') || rawCell(row, 'CONVERSION')).includes('Y') || norm(rawCell(row, 'SOURCE')).includes('CONVERSION') || norm(rawCell(row, 'MOG FLAG DESC')).includes('CONV');
  const count = (predicate) => rows.filter(predicate).length;
  const highlights = [
    ['MMM/NEWHT lines', count(isMmmNewht)],
    ['2+ weeks or 30+ days without ETA', count((row) => isMmmNewht(row) && ['+2 WEEKS', '30+ DAYS'].includes(plus(row)) && !cell(row, 'ETA').trim())],
    ['2+ weeks no ETA/PO escalation', count((row) => isMmmNewht(row) && pending(row).includes('2+ WEEKS') && pending(row).includes('NO ETA/PO'))],
    ['30+ days not stocked escalation', count((row) => isMmmNewht(row) && pending(row).includes('30+ DAYS') && pending(row).includes('NOT STOCKED'))],
    ['Repeat DC comment', count((row) => isMmmNewht(row) && pending(row).includes('REPEAT DC COMMENT'))],
    ['30+ days SORF', count((row) => plus(row) === '30+ DAYS' && norm(rawCell(row, 'MOG FLAG DESC') || rawCell(row, 'MOG FLAG') || rawCell(row, 'MOG')) === 'SORF')],
    ['30+ days MMM/NEWHT', count((row) => plus(row) === '30+ DAYS' && isMmmNewht(row))],
    ['PO short recovery', count((row) => isMmmNewht(row) && statusText(row).includes('PO SHORT') && statusText(row).includes('SUPPORT REQUEST SUBMITTED FOR RECOVERY'))],
    ['Product unavailable', count((row) => isMmmNewht(row) && statusText(row).includes('PRODUCT UNAVAILABLE'))],
    ['Conversion items no ETA', count((row) => isMmmNewht(row) && conversion(row) && plus(row) === '+2 WEEKS' && !cell(row, 'ETA').trim())],
    ['Conversion items not stocked 30+ days', count((row) => isMmmNewht(row) && conversion(row) && plus(row) === '30+ DAYS')],
  ];
  return renderBars(highlights);
}

function renderOpenStockChanges() {
  if (!state.previousRows.length) {
    return '<div class="empty">Previous run comparison is unavailable for this filter.</div>';
  }
  const prevByKey = new Map(state.previousRows.map((row) => [row.rowKey, normStock(rawCell(row, 'In Stock (Y/N?)'))]));
  const newOos = state.rows.filter((row) => normStock(rawCell(row, 'In Stock (Y/N?)')) === 'N' && prevByKey.get(row.rowKey) !== 'N');
  const resolved = state.rows.filter((row) => normStock(rawCell(row, 'In Stock (Y/N?)')) !== 'N' && prevByKey.get(row.rowKey) === 'N');
  return `
    <div class="split">
      <article class="panel nested">
        <div class="panel-heading"><h3>New OOS</h3><span class="pill">${numberFormat(newOos.length)}</span></div>
        ${renderTable(newOos, OPEN_STOCK_ACTION_COLUMNS, { compact: true })}
      </article>
      <article class="panel nested">
        <div class="panel-heading"><h3>Resolved OOS</h3><span class="pill">${numberFormat(resolved.length)}</span></div>
        ${renderTable(resolved, OPEN_STOCK_ACTION_COLUMNS, { compact: true })}
      </article>
    </div>
  `;
}

function renderOpenStockInsights() {
  const k = openStockKpis();
  const previous = openStockKpis(state.previousRows);
  const bucketItems = Object.entries(etaBuckets());
  const oosPredicate = (row) => normStock(rawCell(row, 'In Stock (Y/N?)')) === 'N';
  return `
    <section class="metric-grid">
      ${[
        ['Total', k.total, previous.total],
        ['Out of stock', k.oos, previous.oos],
        ['Attention', k.attention, previous.attention],
        ['Missing ETA', k.missingEta, previous.missingEta],
        ['Missing PO', k.missingPo, previous.missingPo],
        ['New items', k.newItems, previous.newItems],
        ['Pending mgmt', k.pending, previous.pending],
      ]
        .map(([label, value, prev]) => {
          const delta = state.previousRows.length ? Number(value) - Number(prev || 0) : null;
          return renderMetricCard(label, value, delta === null ? '' : `${delta >= 0 ? '+' : ''}${numberFormat(delta)}`);
        })
        .join('')}
    </section>
    <section class="insights-grid">
      <article class="panel">
        <div class="panel-heading"><h3>Insight Highlights</h3><span class="pill">${state.previousDate ? `vs ${state.previousDate}` : 'current'}</span></div>
        ${renderInsightHighlights()}
      </article>
      <article class="panel">
        <div class="panel-heading"><h3>OOS Root Cause</h3><span class="pill">${numberFormat(k.oos)} OOS</span></div>
        ${renderBars([
          ['OOS + missing ETA and PO', state.rows.filter((row) => oosPredicate(row) && !cell(row, 'ETA').trim() && !cell(row, 'PO #').trim()).length],
          ['OOS + missing ETA only', state.rows.filter((row) => oosPredicate(row) && !cell(row, 'ETA').trim() && cell(row, 'PO #').trim()).length],
          ['OOS + missing PO only', state.rows.filter((row) => oosPredicate(row) && cell(row, 'ETA').trim() && !cell(row, 'PO #').trim()).length],
          ['OOS + ETA and PO present', state.rows.filter((row) => oosPredicate(row) && cell(row, 'ETA').trim() && cell(row, 'PO #').trim()).length],
        ])}
      </article>
      <article class="panel">
        <div class="panel-heading"><h3>ETA Aging</h3><span class="pill">${state.reportDate}</span></div>
        ${renderBars(bucketItems)}
      </article>
      <article class="panel">
        <div class="panel-heading"><h3>Top OOS Distributors</h3></div>
        ${renderBars(groupCount(state.rows, 'DISTRIBUTOR NAME', oosPredicate))}
      </article>
      <article class="panel wide">
        <div class="panel-heading"><h3>Status Movement</h3><span class="pill">${state.previousDate || 'no previous run'}</span></div>
        ${renderOpenStockChanges()}
      </article>
      <article class="panel wide">
        <div class="panel-heading">
          <h3>Action List</h3>
          <button data-action="export-attention">Export CSV</button>
        </div>
        ${renderTable(attentionRows(), OPEN_STOCK_ACTION_COLUMNS, { compact: true })}
      </article>
    </section>
  `;
}

function renderSlowDeadInsights() {
  const rows = state.rows;
  const total = rows.length;
  const intentional = rows.filter((row) => norm(rawCell(row, 'Intentional?')) === 'Y').length;
  const totalValue = rows.reduce((sum, row) => sum + Number(rawCell(row, 'True Extended Value') || 0), 0);
  const qoh = rows.reduce((sum, row) => sum + Number(rawCell(row, 'QOH') || 0), 0);
  const sectorValue = groupCount(rows, 'Sector', () => true, 20).map(([sector]) => [
    sector,
    rows.filter((row) => (cell(row, 'Sector').trim() || '(blank)') === sector).reduce((sum, row) => sum + Number(rawCell(row, 'True Extended Value') || 0), 0),
  ]);
  const categoryQoh = groupCount(rows, 'Category', () => true, 25).map(([category]) => [
    category,
    rows.filter((row) => (cell(row, 'Category').trim() || '(blank)') === category).reduce((sum, row) => sum + Number(rawCell(row, 'QOH') || 0), 0),
  ]);
  return `
    <section class="metric-grid compact-metrics">
      ${renderMetricCard('Total S&D', total)}
      ${renderMetricCard('Excl. intentionals', total - intentional)}
      ${renderMetricCard('Intentional', intentional)}
      ${renderMetricCard('True extended value', moneyFormat(totalValue))}
      ${renderMetricCard('QOH', qoh)}
    </section>
    <section class="insights-grid">
      <article class="panel"><div class="panel-heading"><h3>Sector Value</h3></div>${renderBars(sectorValue, moneyFormat)}</article>
      <article class="panel"><div class="panel-heading"><h3>Category QOH</h3></div>${renderBars(categoryQoh)}</article>
      <article class="panel wide"><div class="panel-heading"><h3>NOTICE Value</h3></div>${renderBars(groupCount(rows, 'NOTICE', () => true, 20).map(([notice]) => [notice, rows.filter((row) => (cell(row, 'NOTICE').trim() || '(blank)') === notice).reduce((sum, row) => sum + Number(rawCell(row, 'True Extended Value') || 0), 0)]), moneyFormat)}</article>
    </section>
  `;
}

function renderMetricGrid() {
  const entries = Object.entries(state.metrics).filter(([label]) => !['pageRows'].includes(label));
  if (!entries.length) return '';
  return `
    <section class="metric-grid compact-metrics">
      ${entries.map(([label, value]) => renderMetricCard(metricLabel(label), value)).join('')}
    </section>
  `;
}

function filterValues(column) {
  let rowCache = filterValueCache.get(state.rows);
  if (!rowCache) {
    rowCache = new Map();
    filterValueCache.set(state.rows, rowCache);
  }
  if (rowCache.has(column)) return rowCache.get(column);

  const values = new Set();
  state.rows.forEach((row) => {
    const value = cell(row, column).trim();
    if (value) values.add(value);
  });
  const sorted = [...values].sort((a, b) => a.localeCompare(b));
  rowCache.set(column, sorted);
  return sorted;
}

function renderMultiSelect(id, column, selectedValues = []) {
  const values = filterValues(column);
  return `
    <label>${escapeHtml(titleCase(column))}
      <select id="${id}" multiple size="${Math.min(5, Math.max(2, values.length || 2))}">
        ${values.map((value) => `<option value="${escapeHtml(value)}" ${selectedValues.includes(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </label>
  `;
}

function renderSidebarFilters() {
  if (state.hub === 'open-stock') {
    return `
      ${renderMultiSelect('filterDistributor', 'DISTRIBUTOR NAME', state.specialFilters.distributor || [])}
      ${renderMultiSelect('filterScs', 'SCS', state.specialFilters.scs || [])}
      <label>In Stock
        <select id="filterInStock">${['All', 'Y', 'N'].map((value) => `<option ${value === state.specialFilters.inStock ? 'selected' : ''}>${value}</option>`).join('')}</select>
      </label>
      <label>New Item
        <select id="filterNewItem">${['All', 'YES', 'NO'].map((value) => `<option ${value === state.specialFilters.newItem ? 'selected' : ''}>${value}</option>`).join('')}</select>
      </label>
      <label class="check"><input id="attentionOnly" type="checkbox" ${state.specialFilters.attentionOnly ? 'checked' : ''}> <span>Attention only</span></label>
      <label class="check"><input id="missingEtaOnly" type="checkbox" ${state.specialFilters.missingEtaOnly ? 'checked' : ''}> <span>Missing ETA only</span></label>
      <label class="check"><input id="pendingMgmtOnly" type="checkbox" ${state.specialFilters.pendingMgmtOnly ? 'checked' : ''}> <span>Pending mgmt only</span></label>
    `;
  }
  return (state.filterColumns || hubMeta().filterColumns || [])
    .filter((column) => state.columns.includes(column))
    .map((column) => renderMultiSelect(`filter_${column.replace(/[^A-Za-z0-9]+/g, '_')}`, column, state.filters[column] || []))
    .join('');
}

function renderSourceTabs() {
  if (!state.sources.length || state.hub === 'open-stock') return '';
  return `
    <div class="source-tabs">
      ${state.sources
        .map((source) => `<button class="${source.name === state.source ? 'active' : ''}" data-source="${escapeHtml(source.name)}">${escapeHtml(source.label || source.name)}</button>`)
        .join('')}
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">CL</span>
        <div><h1>Compliance Lab</h1><p>Operations Platform</p></div>
      </div>
      <nav class="hub-nav" aria-label="Hubs">
        ${HUBS.map(
          (hub) => `<button class="${hub.key === state.hub ? 'active' : ''}" data-hub="${hub.key}">
            <span class="hub-icon">${iconSvg(hubIconName(hub.key))}</span>
            <span class="hub-copy"><span>${escapeHtml(hub.label)}</span><small>${escapeHtml(hub.nav)}</small></span>
          </button>`,
        ).join('')}
      </nav>
      <section class="sidebar-panel">
        <label>Search <input id="searchInput" type="search" value="${escapeHtml(state.search)}"></label>
        ${
          state.hub === 'open-stock'
            ? `<label>Report run date
                <select id="reportDate">${state.dates.map((date) => `<option value="${escapeHtml(date)}" ${date === state.reportDate ? 'selected' : ''}>${escapeHtml(formatRunDate(date))}</option>`).join('')}</select>
              </label>`
            : ''
        }
        <label>User <input id="userName" value="${escapeHtml(state.userName)}"></label>
        <div class="button-row">
          <button class="primary" data-action="apply">Apply</button>
          <button data-action="sync">Reload</button>
          <button data-action="reset-filters">Reset</button>
        </div>
      </section>
      <section class="sidebar-panel">${renderSidebarFilters() || '<p class="muted">No filters for this view.</p>'}</section>
    </aside>
  `;
}

function formatRunDate(value) {
  if (!/^\d{8}$/.test(String(value || ''))) return value || '';
  const d = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderTabs() {
  const tabs = hubMeta().tabs;
  if (tabs.length <= 1) return '';
  return `<div class="tabs">${tabs.map((tab) => `<button class="${state.tab === tab ? 'active' : ''}" data-tab="${tab}">${escapeHtml(titleCase(tab))}</button>`).join('')}</div>`;
}

function renderTopActions() {
  const canEdit = sourceAllowsEdits() && state.editableColumns.length > 0;
  const openStock = state.hub === 'open-stock';
  const unlocked = state.hub === 'unlocked-accounts';
  const sourceName = state.source || '';
  const authButton = state.auth.enabled
    ? state.auth.authenticated
      ? '<button data-auth-action="logout">Sign Out</button>'
      : '<button class="primary" data-auth-action="login">Sign In</button>'
    : '';
  return `
    <div class="topbar-actions">
      ${authButton}
      <button data-action="export-view">CSV</button>
      <button data-action="export-xlsx">Excel</button>
      <button data-action="export-zip">CSV ZIP</button>
      ${openStock ? `<button data-action="persist-lookback" ${!state.previousDate ? 'disabled' : ''}>Persist Lookback</button>` : ''}
      ${openStock ? '<button data-action="weekly-refresh">Weekly Refresh</button><button data-action="undo">Undo</button>' : ''}
      ${unlocked && sourceName === 'UNLOCKED_ACCOUNTS' ? '<button data-action="lock-filtered" class="danger">Lock Visible</button><button data-action="bl-transfer">BL Transfer</button>' : ''}
      ${unlocked && sourceName === 'LOCKED_INACTIVE_ACCOUNTS' ? '<button data-action="unlock-filtered" class="primary">Unlock Visible</button>' : ''}
      ${canEdit ? `<button class="primary" data-action="save" ${state.changed.size === 0 ? 'disabled' : ''}>Save ${state.changed.size || ''}</button>` : ''}
    </div>
  `;
}

function renderWorklist() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <div><h3>Worklist</h3><p>${numberFormat(state.rows.length)} visible rows</p></div>
        <span class="pill">${state.reportDate ? formatRunDate(state.reportDate) : 'live'}</span>
      </div>
      ${renderTable()}
    </section>
    ${
      state.changed.size
        ? `<section class="panel"><div class="panel-heading"><h3>Pending Changes</h3><span class="pill">${state.changed.size}</span></div>${renderTable(rowsForChanges(), state.columns, { compact: true })}</section>`
        : ''
    }
  `;
}

function rowsForChanges() {
  const keys = new Set(state.changed.keys());
  return state.rows.filter((row) => keys.has(row.rowKey));
}

function renderDataTab() {
  return `
    <section class="data-layout">
      <div class="data-actions">
        <article class="panel">
        <div class="panel-heading"><h3>Exports</h3><span class="pill">${numberFormat(state.rows.length)} loaded</span></div>
        <div class="inline-actions">
          <button data-action="export-view">Current CSV</button>
          <button data-action="export-xlsx">All Loaded Excel</button>
          <button data-action="export-zip">All Loaded CSV ZIP</button>
          ${state.hub === 'open-stock' ? '<button data-action="export-attention">Action List CSV</button>' : ''}
        </div>
        </article>
        <article class="panel">
        <div class="panel-heading"><h3>Import Updates</h3><span class="pill">${state.editableColumns.length} editable fields</span></div>
        <div class="drop-zone">
          <input type="file" id="importCsv" accept=".csv,text/csv">
          <p>CSV key column: rowKey or the source key field.</p>
        </div>
        </article>
      </div>
      <article class="panel table-panel">
        <div class="panel-heading"><h3>Current Rows</h3><span class="pill">${state.sourceLabel || state.hub}</span></div>
        ${renderTable()}
      </article>
    </section>
  `;
}

function renderUnlockedHistory() {
  const historySource = 'UNLOCKED_ACCOUNTS_HISTORY';
  return `
    <section class="panel">
      <div class="panel-heading">
        <h3>History Export</h3>
        <div class="inline-actions">
          <button data-action="export-view">CSV</button>
          <button data-action="export-xlsx">Excel</button>
        </div>
      </div>
      ${state.source === historySource ? renderTable() : '<div class="empty">Select a history source when it is available from Snowflake.</div>'}
    </section>
  `;
}

function renderHubBody() {
  if (state.hub === 'open-stock') {
    if (state.tab === 'insights') return renderOpenStockInsights();
    if (state.tab === 'data') return renderDataTab();
    return renderWorklist();
  }
  if (state.hub === 'slow-dead' && state.tab === 'insights') return renderSlowDeadInsights();
  if (state.hub === 'unlocked-accounts' && state.tab === 'history') return renderUnlockedHistory();
  if (state.tab === 'upload') return renderDataTab();
  return `
    <section class="panel">
      <div class="panel-heading">
        <div><h3>${escapeHtml(state.sourceLabel || hubMeta().label)}</h3><p>${numberFormat(state.rows.length)} visible rows</p></div>
        <span class="pill">${state.sync.lastStatus || 'live'}</span>
      </div>
      ${renderTable()}
    </section>
  `;
}

function renderAuthGate() {
  return `
    <main class="content auth-content">
      <section class="auth-gate">
        <div class="auth-card">
          <p class="eyebrow">Secure access</p>
          <h2>Compliance Lab</h2>
          <p>Sign in with your organization account to open the Operations Platform.</p>
          ${state.auth.error ? `<div class="notice error">${escapeHtml(state.auth.error)}</div>` : ''}
          <div class="inline-actions">
            <button class="primary" data-auth-action="login" ${!state.auth.configured ? 'disabled' : ''}>Sign In</button>
            ${state.auth.configured ? '' : '<span class="muted">OIDC environment variables are not configured.</span>'}
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderLoadingShell() {
  return `
    <main class="content auth-content">
      <section class="auth-gate">
        <div class="auth-card">
          <p class="eyebrow">Loading</p>
          <h2>Compliance Lab</h2>
          <p>Preparing the Operations Platform.</p>
        </div>
      </section>
    </main>
  `;
}

function renderMain() {
  if (!state.auth.checked) return renderLoadingShell();
  if (state.auth.required && !state.auth.authenticated) return renderAuthGate();
  const meta = hubMeta();
  return `
    <main class="content">
      <header class="topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.sync.lastStatus || 'live')}</p>
          <h2>${escapeHtml(meta.label)}</h2>
          <p>${escapeHtml(state.sourceLabel || meta.nav)}${state.previousDate && state.hub === 'open-stock' ? ` - previous ${formatRunDate(state.previousDate)}` : ''}</p>
        </div>
        ${renderTopActions()}
      </header>
      ${state.message ? `<div class="notice success">${escapeHtml(state.message)}</div>` : ''}
      ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ''}
      ${state.busy ? '<div class="notice">Loading live Snowflake rows...</div>' : ''}
      ${renderMetricGrid()}
      ${renderSourceTabs()}
      ${renderTabs()}
      ${renderHubBody()}
      ${renderFeedback()}
    </main>
  `;
}

function renderFeedback() {
  return `
    <section class="feedback">
      <div><h3>Feedback</h3></div>
      <label>Rating <input id="feedbackRating" type="number" min="1" max="5" value="3"></label>
      <label>Notes <textarea id="feedbackText"></textarea></label>
      <button data-action="feedback">Submit</button>
    </section>
  `;
}

function scheduleRender() {
  if (queuedRender) return;
  queuedRender = window.requestAnimationFrame(() => {
    queuedRender = 0;
    render();
  });
}

function render() {
  app.innerHTML = `<div class="app-shell">${renderSidebar()}${renderMain()}</div>`;
  bindEvents();
}

function bindVirtualTables() {
  document.querySelectorAll('[data-virtual-table]').forEach((shell) => {
    const key = shell.dataset.virtualTable;
    const saved = tableWindows.get(key);
    if (saved?.scrollTop) {
      window.requestAnimationFrame(() => {
        shell.scrollTop = saved.scrollTop;
      });
    }

    shell.addEventListener(
      'scroll',
      () => {
        const rowHeight = Number(shell.dataset.rowHeight) || VIRTUAL_ROW_HEIGHT;
        const totalRows = Number(shell.dataset.totalRows) || 0;
        const windowRows = Number(shell.dataset.windowSize) || VIRTUAL_WINDOW_ROWS;
        const current = tableWindows.get(key) || { start: 0, scrollTop: 0 };
        const maxStart = Math.max(0, totalRows - windowRows);
        const scrollTop = shell.scrollTop;
        const nextStart = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN));
        tableWindows.set(key, { start: nextStart, scrollTop });
        if (Math.abs(nextStart - (current.start || 0)) >= VIRTUAL_RERENDER_DELTA) scheduleRender();
      },
      { passive: true },
    );
  });
}

function bindEvents() {
  document.querySelectorAll('[data-auth-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.authAction === 'login') loginRedirect();
      if (button.dataset.authAction === 'logout') logout();
    });
  });

  document.querySelectorAll('[data-hub]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.hub = button.dataset.hub;
      state.tab = hubMeta().tabs[0];
      state.source = '';
      state.sourceLabel = '';
      state.search = '';
      state.filters = {};
      state.specialFilters = { ...SPECIAL_OPEN_STOCK_FILTERS };
      setMessage('');
      await loadHub();
    });
  });

  document.querySelectorAll('[data-source]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.source = button.dataset.source;
      state.sourceLabel = button.textContent || state.source;
      state.changed.clear();
      await loadHub();
    });
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      render();
    });
  });

  document.querySelectorAll('[data-edit]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const rowKey = event.target.closest('tr')?.dataset.rowKey;
      if (rowKey) updateCell(rowKey, event.target.dataset.edit, event.target.value);
    });
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button.dataset.action));
  });

  const fileInput = document.querySelector('#importCsv');
  if (fileInput) fileInput.addEventListener('change', importCsv);
  bindVirtualTables();
}

function selectedMulti(id) {
  return [...(document.querySelector(`#${CSS.escape(id)}`)?.selectedOptions || [])].map((option) => option.value);
}

function readBaseInputs() {
  state.search = document.querySelector('#searchInput')?.value ?? state.search;
  state.reportDate = document.querySelector('#reportDate')?.value ?? state.reportDate;
  state.userName = document.querySelector('#userName')?.value ?? state.userName;
}

function readFilters() {
  readBaseInputs();
  if (state.hub === 'open-stock') {
    state.specialFilters = {
      distributor: selectedMulti('filterDistributor'),
      scs: selectedMulti('filterScs'),
      inStock: document.querySelector('#filterInStock')?.value || 'All',
      newItem: document.querySelector('#filterNewItem')?.value || 'All',
      attentionOnly: Boolean(document.querySelector('#attentionOnly')?.checked),
      missingEtaOnly: Boolean(document.querySelector('#missingEtaOnly')?.checked),
      pendingMgmtOnly: Boolean(document.querySelector('#pendingMgmtOnly')?.checked),
    };
    return;
  }
  const next = {};
  (state.filterColumns || []).forEach((column) => {
    const id = `filter_${column.replace(/[^A-Za-z0-9]+/g, '_')}`;
    const values = selectedMulti(id);
    if (values.length) next[column] = values;
  });
  state.filters = next;
}

async function handleAction(action) {
  readBaseInputs();
  if (action === 'apply') {
    readFilters();
    await loadHub();
  } else if (action === 'sync') {
    await syncHub();
  } else if (action === 'reset-filters') {
    state.filters = {};
    state.specialFilters = { ...SPECIAL_OPEN_STOCK_FILTERS };
    state.search = '';
    await loadHub();
  } else if (action === 'save') {
    await saveChanges();
  } else if (action === 'undo') {
    await undoLast();
  } else if (action === 'weekly-refresh') {
    if (window.confirm('Run the Open Stock weekly refresh now?')) await runHubAction('weekly-refresh', { fromDate: state.reportDate });
  } else if (action === 'persist-lookback') {
    await runHubAction('persist-lookback');
  } else if (action === 'lock-filtered') {
    if (window.confirm(`Lock ${state.rows.length.toLocaleString()} visible account rows?`)) await runHubAction('lock-filtered', { rowKeys: state.rows.map((row) => row.rowKey) });
  } else if (action === 'unlock-filtered') {
    if (window.confirm(`Unlock ${state.rows.length.toLocaleString()} visible account rows?`)) await runHubAction('unlock-filtered', { rowKeys: state.rows.map((row) => row.rowKey) });
  } else if (action === 'bl-transfer') {
    const destinationDc = window.prompt('Destination DC name');
    if (destinationDc) await runHubAction('bl-transfer', { rowKeys: state.rows.map((row) => row.rowKey), destinationDc });
  } else if (action === 'export-view') {
    try {
      await downloadFromUrl(exportUrl('csv'));
    } catch (error) {
      setMessage('', error.message);
      render();
    }
  } else if (action === 'export-xlsx') {
    try {
      await downloadFromUrl(exportUrl('xlsx'));
    } catch (error) {
      setMessage('', error.message);
      render();
    }
  } else if (action === 'export-zip') {
    try {
      await downloadFromUrl(exportUrl('zip'));
    } catch (error) {
      setMessage('', error.message);
      render();
    }
  } else if (action === 'export-attention') {
    download(`open_stock_action_list_${state.reportDate}.csv`, 'text/csv;charset=utf-8', rowsToCsv(attentionRows(), OPEN_STOCK_ACTION_COLUMNS));
  } else if (action === 'feedback') {
    await submitFeedback();
  }
}

function exportUrl(format) {
  const params = new URLSearchParams({
    format,
    page: '1',
    pageSize: 'all',
    search: state.search,
    filters: JSON.stringify(currentFilterPayload()),
  });
  if (state.hub === 'open-stock' && state.reportDate) params.set('runDate', state.reportDate);
  if (state.source) params.set('source', state.source);
  return `/api/export/${state.hub}?${params.toString()}`;
}

async function submitFeedback() {
  const rating = Number(document.querySelector('#feedbackRating')?.value || 3);
  const feedbackText = document.querySelector('#feedbackText')?.value || '';
  if (!feedbackText.trim()) return;
  try {
    const result = await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        appName: hubMeta().label,
        rating,
        feedbackText,
        submittedBy: state.userName,
        context: { source: 'local_preview', hub: state.hub, source: state.source },
      }),
    });
    setMessage(result.message || 'Feedback submitted.');
    render();
  } catch (error) {
    setMessage('', error.message);
    render();
  }
}

async function importCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  const sourceKey = state.hub === 'open-stock' ? 'DISTCODE MOG DIN' : state.columns.find((column) => ['ACCOUNT_RECORD_ID', 'SUPPLY_CHAIN_CODE', 'PrimaryKey', 'PRIMARYKEY', 'DSTCODEDCN'].includes(column));
  const keyIndex = headers.findIndex((header) => ['rowKey', sourceKey].includes(header));
  if (keyIndex === -1) {
    setMessage('', `CSV must include rowKey${sourceKey ? ` or ${sourceKey}` : ''}.`);
    render();
    return;
  }
  let imported = 0;
  for (const line of lines) {
    const values = parseCsvLine(line);
    const rowKey = values[keyIndex];
    const change = { rowKey, values: {} };
    headers.forEach((header, index) => {
      if (state.editableColumns.includes(header)) change.values[header] = values[index] ?? '';
    });
    if (Object.keys(change.values).length) {
      state.changed.set(rowKey, change);
      imported += 1;
    }
  }
  setMessage(`Imported ${imported.toLocaleString()} changed row(s). Review, then save.`);
  render();
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function bootstrap() {
  render();
  await loadAuthConfig();
  if (state.auth.required && !state.auth.authenticated) {
    render();
    return;
  }
  await loadOpenStockDates();
  await loadHub();
}

bootstrap();
