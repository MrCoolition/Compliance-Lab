import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { requireAuthenticatedRequest } from '../_lib/auth.js';
import { getHubRows } from '../_lib/sync.js';
import { numberQuery, pageSizeQuery, sendError, stringQuery } from '../_lib/http.js';
import { requireHubConfig } from '../_lib/hub-config.js';

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function csvBytes(rows: Array<{ data: Record<string, unknown> }>, columns: string[]): Buffer {
  const lines = [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row.data[column])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function safeName(value: string): string {
  return (value || 'export').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'export';
}

async function hubPayload(request: VercelRequest, source?: string) {
  const hubKey = stringQuery(request.query.hub);
  if (!hubKey) throw new Error('Missing hub key');
  const filtersText = stringQuery(request.query.filters);
  const filters = filtersText ? (JSON.parse(filtersText) as Record<string, string[]>) : {};
  return getHubRows(requireHubConfig(hubKey), {
    page: numberQuery(request.query.page, 1, 1000),
    pageSize: pageSizeQuery(request.query.pageSize),
    search: stringQuery(request.query.search),
    runDate: stringQuery(request.query.runDate),
    filters,
    source,
    projection: 'full',
  });
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'GET') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  if (!(await requireAuthenticatedRequest(request, response))) return;

  try {
    const hubKey = stringQuery(request.query.hub);
    if (!hubKey) {
      sendError(response, 400, 'Missing hub key');
      return;
    }
    const config = requireHubConfig(hubKey);
    const format = (stringQuery(request.query.format) || 'csv').toLowerCase();
    const requestedSource = stringQuery(request.query.source);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    if (format === 'zip') {
      const zip = new JSZip();
      const sources = requestedSource ? config.sources.filter((source) => source.name === requestedSource) : config.sources;
      for (const source of sources.length ? sources : config.sources) {
        const payload = await hubPayload(request, source.name);
        zip.file(`${safeName(source.name)}_${stamp}.csv`, csvBytes(payload.rows, payload.columns));
      }
      const out = await zip.generateAsync({ type: 'nodebuffer' });
      response.status(200).setHeader('content-type', 'application/zip');
      response.setHeader('content-disposition', `attachment; filename="${safeName(hubKey)}_${stamp}_csv.zip"`);
      response.send(out);
      return;
    }

    if (format === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      const sources = requestedSource ? config.sources.filter((source) => source.name === requestedSource) : config.sources;
      for (const source of sources.length ? sources : config.sources) {
        const payload = await hubPayload(request, source.name);
        const data = payload.rows.map((row) => Object.fromEntries(payload.columns.map((column) => [column, row.data[column] ?? ''])));
        const sheet = XLSX.utils.json_to_sheet(data, { header: payload.columns });
        XLSX.utils.book_append_sheet(workbook, sheet, safeName(source.name).slice(0, 31));
      }
      const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
      response.status(200).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.setHeader('content-disposition', `attachment; filename="${safeName(hubKey)}_${stamp}.xlsx"`);
      response.send(out);
      return;
    }

    const payload = await hubPayload(request, requestedSource);
    response.status(200).setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="${safeName(hubKey)}_${stamp}.csv"`);
    response.send(csvBytes(payload.rows, payload.columns));
  } catch (error) {
    sendError(response, 500, 'Failed to export hub data', error);
  }
}
