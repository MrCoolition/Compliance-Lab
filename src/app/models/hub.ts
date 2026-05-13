export interface HubNavItem {
  key: string;
  label: string;
  description: string;
}

export interface HubRow {
  rowKey: string;
  sourceName: string;
  snapshotDate: string;
  data: Record<string, unknown>;
  syncedAt?: string;
}

export interface HubResponse {
  hub: string;
  label: string;
  description: string;
  columns: string[];
  editableColumns: string[];
  filterColumns: string[];
  sources?: string[];
  rows: HubRow[];
  total: number;
  metrics: Record<string, number | string>;
  sync?: {
    lastRunAt?: string;
    lastStatus?: string;
  };
}

export interface OpenStockChange {
  rowKey: string;
  values: Record<string, unknown>;
}

export interface SaveChangesResponse {
  batchId: string;
  rowsAffected: number;
  loggedChanges: number;
}

export interface UndoChangesResponse {
  batchId?: string;
  keysReverted: number;
  rowsAffected: number;
}

export interface HubActionResponse {
  ok: boolean;
  action: string;
  message: string;
  rowsAffected?: number;
}
