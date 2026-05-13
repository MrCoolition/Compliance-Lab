import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  HUB_DEFINITIONS,
  OPEN_STOCK_EDITABLE_COLUMNS,
  OPEN_STOCK_KEY_COL,
  OPEN_STOCK_UPLOAD_EDITABLE_COLUMNS,
  type FilterDefinition,
  type HubDefinition,
  type HubKey,
  hubDefinitionFor,
} from './data/hub-definitions';
import { HUB_NAV_ITEMS } from './data/mock-hubs';
import { HubService } from './data/hub.service';
import type { HubResponse, HubRow, OpenStockChange } from './models/hub';

interface MetricCard {
  label: string;
  value: string | number;
  hint?: string;
}

interface InsightRow {
  label: string;
  value: number | string;
}

type CsvScope = 'all' | 'attention' | 'display';

const SUPER_USERS = new Set(['jordaa14', 'phillg02', 'gilbem02', 'sullik09']);

@Component({
  selector: 'osh-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private readonly hubService = inject(HubService);

  readonly hubs = HUB_NAV_ITEMS;
  readonly hubDefinitions = HUB_DEFINITIONS;
  readonly pageSize = 500;

  selectedHubKey: HubKey = 'open-stock';
  activeTab = 'worklist';
  activeSource = '';
  searchText = '';
  reportDate = '';
  recentDates: string[] = [];
  lookbackFill = false;
  userName = '';
  feedbackText = '';
  feedbackRating = 3;
  uploadText = '';
  statusMessage = '';
  errorMessage = '';
  loading = false;
  saving = false;
  response?: HubResponse;
  filters: Record<string, string | string[] | boolean> = {};

  changedRows = new Map<string, OpenStockChange>();

  async ngOnInit(): Promise<void> {
    this.resetFiltersForHub();
    try {
      this.recentDates = await this.hubService.getRecentOpenStockDates();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.recentDates = [];
    }
    this.reportDate = this.recentDates[0] ?? this.todayKey();
    await this.loadHub();
  }

  get selectedHub(): HubDefinition {
    return hubDefinitionFor(this.selectedHubKey);
  }

  get selectedHubLabel(): string {
    return this.response?.label ?? this.selectedHub.label;
  }

  get tabs(): Array<{ key: string; label: string }> {
    return this.selectedHub.tabs;
  }

  get rows(): HubRow[] {
    return this.response?.rows ?? [];
  }

  get rowsForSource(): HubRow[] {
    if (!this.activeSource) {
      return this.rows;
    }
    return this.rows.filter((row) => row.sourceName === this.activeSource || row.sourceName.toLowerCase() === this.activeSource.toLowerCase());
  }

  get displayRows(): HubRow[] {
    let rows = [...this.rowsForSource];

    for (const filter of this.selectedHub.filters) {
      const value = this.filters[filter.key];
      if (filter.kind === 'multi' && Array.isArray(value) && value.length > 0 && filter.column) {
        const allowed = new Set(value.map((item) => this.normalize(item)));
        rows = rows.filter((row) => allowed.has(this.normalize(this.cell(row, filter.column!))));
      }
      if (filter.kind === 'single' && typeof value === 'string' && value !== '' && value !== 'All' && filter.column) {
        rows = rows.filter((row) => this.normalize(this.cell(row, filter.column!)) === this.normalize(value));
      }
      if (filter.kind === 'checkbox' && value === true) {
        rows = this.applyBooleanFilter(rows, filter.key);
      }
    }

    const q = this.searchText.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => this.searchableText(row).includes(q));
    }

    return rows;
  }

  get displayColumns(): string[] {
    const seen = new Set<string>();
    const columns: string[] = [];
    for (const column of this.selectedHub.primaryColumns) {
      if (!seen.has(column)) {
        columns.push(column);
        seen.add(column);
      }
    }
    for (const column of this.response?.columns ?? []) {
      if (!seen.has(column)) {
        columns.push(column);
        seen.add(column);
      }
    }
    return columns.slice(0, this.selectedHubKey === 'open-stock' ? 48 : 44);
  }

  get sourceTabs(): Array<{ key: string; label: string }> {
    if (this.selectedHub.sourceTabs?.length) {
      return this.selectedHub.sourceTabs;
    }
    return Array.from(new Set(this.rows.map((row) => row.sourceName))).map((source) => ({ key: source, label: source }));
  }

  get changedCount(): number {
    return this.changedRows.size;
  }

  get canSave(): boolean {
    return this.changedCount > 0 && !this.saving;
  }

  get isSuperUser(): boolean {
    return SUPER_USERS.has(this.userName.trim().toLowerCase());
  }

  get previousRunDate(): string {
    if (!this.reportDate || this.recentDates.length === 0) {
      return '';
    }
    const selected = Number.parseInt(this.reportDate, 10);
    const prior = this.recentDates
      .filter((date) => Number.parseInt(date, 10) < selected)
      .sort()
      .reverse()[0];
    return prior ?? '';
  }

  get reportFreshness(): { tone: 'good' | 'warn' | 'bad'; text: string } {
    const selected = this.dateFromKey(this.reportDate);
    const today = this.dateFromKey(this.todayKey());
    if (!selected || !today) {
      return { tone: 'warn', text: 'Run date status unavailable.' };
    }
    const days = Math.abs(Math.round((today.getTime() - selected.getTime()) / 86_400_000));
    if (days === 0) {
      return { tone: 'good', text: 'Report is up to date.' };
    }
    if (days > 7) {
      return { tone: 'bad', text: `Report last run ${days} days ago.` };
    }
    return { tone: 'warn', text: days === 1 ? 'Report last run 1 day ago.' : `Report last run ${days} days ago.` };
  }

  get attentionRows(): HubRow[] {
    return this.displayRows.filter((row) => this.isAttentionRow(row));
  }

  get uploadPreviewRows(): Array<Record<string, string>> {
    return this.parseCsv(this.uploadText).slice(0, 5);
  }

  selectHub(hubKey: string): void {
    this.selectedHubKey = hubDefinitionFor(hubKey).key;
    this.activeTab = this.selectedHub.tabs[0]?.key ?? 'view';
    this.activeSource = this.selectedHub.sourceTabs?.[0]?.key ?? '';
    this.searchText = '';
    this.uploadText = '';
    this.lookbackFill = false;
    this.changedRows.clear();
    this.resetFiltersForHub();
    void this.loadHub();
  }

  setTab(tabKey: string): void {
    this.activeTab = tabKey;
    const matchingSource = this.selectedHub.sourceTabs?.find((source) => source.label === this.tabs.find((tab) => tab.key === tabKey)?.label);
    if (matchingSource) {
      this.activeSource = matchingSource.key;
    }
  }

  setSource(sourceKey: string): void {
    this.activeSource = sourceKey;
  }

  async loadHub(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    this.statusMessage = '';
    try {
      this.response = await this.hubService.getHubRows({
        hubKey: this.selectedHubKey,
        page: 1,
        pageSize: this.pageSize,
        search: this.searchText.trim() || undefined,
        runDate: this.selectedHubKey === 'open-stock' ? this.reportDate.trim() || undefined : undefined,
        filters: this.serverFilters(),
      });
      if (!this.activeSource && this.sourceTabs.length > 0 && this.selectedHub.sourceTabs?.length) {
        this.activeSource = this.sourceTabs[0].key;
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async refreshWeekly(): Promise<void> {
    if (this.selectedHubKey !== 'open-stock') {
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.statusMessage = '';
    try {
      await this.hubService.syncHub(this.selectedHubKey, this.reportDate || undefined);
      this.statusMessage = 'Refresh completed. Latest rows are loading.';
      await this.loadHub();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Refresh failed.';
    } finally {
      this.loading = false;
    }
  }

  async runAction(action: string): Promise<void> {
    if (action === 'weekly-refresh') {
      await this.refreshWeekly();
      return;
    }
    if (action === 'undo-inline-save') {
      await this.undoOpenStock();
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    this.statusMessage = '';
    try {
      const result = await this.hubService.runHubAction(this.selectedHubKey, action, {
        activeTab: this.activeTab,
        activeSource: this.activeSource,
        filters: this.filters,
        rowKeys: this.displayRows.map((row) => row.rowKey),
        userName: this.userName || 'Unknown',
      });
      this.statusMessage = result.message;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }

  async saveChanges(): Promise<void> {
    if (this.changedRows.size === 0) {
      return;
    }
    this.saving = true;
    this.errorMessage = '';
    this.statusMessage = '';
    try {
      if (this.selectedHubKey === 'open-stock') {
        const result = await this.hubService.saveOpenStockChanges(this.reportDate || this.todayKey(), Array.from(this.changedRows.values()), this.userName || 'Unknown');
        this.statusMessage = `Saved ${result.loggedChanges} cell change(s); rows affected: ${result.rowsAffected}.`;
      } else {
        const result = await this.hubService.runHubAction(this.selectedHubKey, 'save-edits', {
          activeTab: this.activeTab,
          activeSource: this.activeSource,
          changes: Array.from(this.changedRows.values()),
          userName: this.userName || 'Unknown',
        });
        this.statusMessage = result.message;
      }
      this.changedRows.clear();
      await this.loadHub();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }

  async undoOpenStock(): Promise<void> {
    this.saving = true;
    this.errorMessage = '';
    this.statusMessage = '';
    try {
      const result = await this.hubService.undoOpenStockChange(this.reportDate || this.todayKey(), this.userName || 'Unknown');
      this.statusMessage = result.keysReverted > 0 ? `Undo complete. Keys reverted: ${result.keysReverted}; rows affected: ${result.rowsAffected}.` : 'No saved inline change was found to undo.';
      await this.loadHub();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }

  async applyUpload(): Promise<void> {
    const parsedRows = this.parseCsv(this.uploadText);
    if (parsedRows.length === 0) {
      this.errorMessage = 'Upload text is empty or could not be parsed.';
      return;
    }

    if (this.selectedHubKey === 'open-stock') {
      const changes = parsedRows
        .map((row) => ({
          rowKey: row[OPEN_STOCK_KEY_COL] ?? '',
          values: Object.fromEntries(OPEN_STOCK_UPLOAD_EDITABLE_COLUMNS.filter((column) => Object.hasOwn(row, column)).map((column) => [column, row[column]])),
        }))
        .filter((change) => change.rowKey && Object.keys(change.values).length > 0);

      if (changes.length === 0) {
        this.errorMessage = `Upload must include ${OPEN_STOCK_KEY_COL} and at least one editable column.`;
        return;
      }
      const result = await this.hubService.saveOpenStockChanges(this.reportDate || this.todayKey(), changes, this.userName || 'Unknown');
      this.statusMessage = `Upload applied. Changes logged: ${result.loggedChanges}; rows affected: ${result.rowsAffected}.`;
      this.uploadText = '';
      await this.loadHub();
      return;
    }

    await this.runAction(`apply-${this.selectedHubKey}-upload`);
  }

  handleUploadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.uploadText = String(reader.result ?? '');
    };
    reader.readAsText(file);
  }

  resetFiltersForHub(): void {
    this.filters = {};
    for (const filter of this.selectedHub.filters) {
      if (filter.defaultValue !== undefined) {
        this.filters[filter.key] = Array.isArray(filter.defaultValue) ? [...filter.defaultValue] : filter.defaultValue;
      } else if (filter.kind === 'multi') {
        this.filters[filter.key] = [];
      } else if (filter.kind === 'checkbox') {
        this.filters[filter.key] = false;
      } else {
        this.filters[filter.key] = '';
      }
    }
  }

  filterOptions(filter: FilterDefinition): string[] {
    if (filter.options) {
      return filter.options;
    }
    if (!filter.column) {
      return [];
    }
    return Array.from(new Set(this.rowsForSource.map((row) => this.cell(row, filter.column!)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  cell(row: HubRow, column: string): string {
    const data = row.data ?? {};
    const exact = data[column];
    if (exact !== undefined && exact !== null) {
      return String(exact);
    }
    const found = Object.keys(data).find((key) => this.canonical(key) === this.canonical(column));
    const value = found ? data[found] : '';
    return value === undefined || value === null ? '' : String(value);
  }

  updateCell(row: HubRow, column: string, value: string): void {
    row.data = { ...row.data, [column]: value };
    const existing = this.changedRows.get(row.rowKey) ?? { rowKey: row.rowKey, values: {} };
    this.changedRows.set(row.rowKey, {
      ...existing,
      values: { ...existing.values, [column]: value },
    });
  }

  isChanged(row: HubRow, column: string): boolean {
    return Object.hasOwn(this.changedRows.get(row.rowKey)?.values ?? {}, column);
  }

  isEditableColumn(column: string): boolean {
    if (!this.selectedHub.editableColumns.includes(column)) {
      return false;
    }
    if (this.selectedHubKey === 'open-stock') {
      return this.activeTab === 'worklist';
    }
    if (this.selectedHubKey === 'conversions') {
      return ['sourcing-master', 'srs-master', 'dc-communications'].includes(this.activeTab);
    }
    if (this.selectedHubKey === 'dc-matrix') {
      return ['add-row', 'update-row', 'upload'].includes(this.activeTab);
    }
    if (this.selectedHubKey === 'unlocked-accounts') {
      return ['unlocked', 'locked'].includes(this.activeTab);
    }
    return this.selectedHub.editableColumns.length > 0;
  }

  optionsForColumn(column: string): string[] {
    if (column === 'New Item?') {
      return ['', 'YES', 'NO'];
    }
    if (column === 'In Stock (Y/N?)') {
      return ['', 'Y', 'N'];
    }
    if (column === '+2 Weeks') {
      return ['', '+2 Weeks', '30+ Days'];
    }
    if (column === 'Pending Management Comments') {
      return ['', '2+ Weeks - No ETA/PO & No Justification', '+2 Weeks', '30+ Days - Not Stocked & No approval', 'Repeat DC Comment'];
    }
    if (['COMPASS_CONTROLLED_DC', 'CONVERSION_DC'].includes(column)) {
      return ['', 'Y', 'N'];
    }
    return [];
  }

  metricCards(): MetricCard[] {
    if (this.selectedHubKey === 'open-stock') {
      const kpis = this.openStockKpis(this.displayRows);
      return [
        { label: 'Rows in view', value: this.formatNumber(this.displayRows.length) },
        { label: 'Distributors', value: this.formatNumber(this.uniqueCount(this.displayRows, 'DISTRIBUTOR NAME')) },
        { label: 'SCS', value: this.formatNumber(this.uniqueCount(this.displayRows, 'SCS')) },
        { label: 'Run date', value: this.formatDateLabel(this.reportDate) },
        { label: 'Out of stock', value: this.formatNumber(kpis.outOfStock) },
        { label: 'Attention', value: this.formatNumber(kpis.attention) },
      ];
    }

    if (this.selectedHubKey === 'slow-dead') {
      const totalValue = this.displayRows.reduce((sum, row) => sum + this.toNumber(this.cell(row, 'True Extended Value')), 0);
      const qoh = this.displayRows.reduce((sum, row) => sum + this.toNumber(this.cell(row, 'QOH')), 0);
      return [
        { label: 'Rows in view', value: this.formatNumber(this.displayRows.length) },
        { label: 'QOH', value: this.formatNumber(qoh) },
        { label: 'True Extended Value', value: this.currency(totalValue) },
        { label: 'Categories', value: this.formatNumber(this.uniqueCount(this.displayRows, 'Category')) },
      ];
    }

    return [
      { label: 'Rows in view', value: this.formatNumber(this.displayRows.length) },
      { label: 'Total rows', value: this.formatNumber(this.response?.total ?? this.rows.length) },
      { label: 'Columns', value: this.formatNumber(this.displayColumns.length) },
      { label: 'Views', value: this.formatNumber(this.sourceTabs.length || 1) },
    ];
  }

  openStockHighlights(): InsightRow[] {
    const rows = this.displayRows;
    const isMmmNewht = (row: HubRow) => ['MMM', 'NEWHT'].includes(this.normUpper(this.cell(row, 'MOG FLAG DESC') || this.cell(row, 'MOG FLAG') || this.cell(row, 'MOG')));
    const plus = (row: HubRow) => this.cell(row, '+2 Weeks');
    const pending = (row: HubRow) => this.normUpper(this.cell(row, 'Pending Management Comments'));
    const noEta = (row: HubRow) => this.cell(row, 'ETA').trim() === '';
    const status = (row: HubRow) => this.normUpper(this.cell(row, 'ESCALATION SUPPORT [ES1.1]') || this.cell(row, 'Required DC Update') || this.cell(row, 'Current DC Comment'));
    const conversion = (row: HubRow) => this.normUpper(this.cell(row, 'Conversion Item') || this.cell(row, 'Source')).includes('CONVERSION');

    return [
      { label: 'Total Lines (MMM/NEWHT)', value: rows.filter(isMmmNewht).length },
      { label: '2+ Weeks and 30+ Days without ETA', value: rows.filter((row) => isMmmNewht(row) && ['+2 Weeks', '30+ Days'].includes(plus(row)) && noEta(row)).length },
      { label: '2+ Weeks - No ETA/PO and No Justification', value: rows.filter((row) => isMmmNewht(row) && pending(row).includes('2+ WEEKS') && pending(row).includes('NO ETA/PO')).length },
      { label: '30+ Days - Not Stocked and No Approval', value: rows.filter((row) => isMmmNewht(row) && pending(row).includes('30+ DAYS') && pending(row).includes('NOT STOCKED')).length },
      { label: 'Repeat DC Comment', value: rows.filter((row) => isMmmNewht(row) && pending(row).includes('REPEAT DC COMMENT')).length },
      { label: 'PO Short', value: rows.filter((row) => isMmmNewht(row) && status(row).includes('PO SHORT') && status(row).includes('SUPPORT REQUEST SUBMITTED')).length },
      { label: 'Product Unavailable', value: rows.filter((row) => isMmmNewht(row) && status(row).includes('PRODUCT UNAVAILABLE')).length },
      { label: 'Conversion Items with No ETA', value: rows.filter((row) => isMmmNewht(row) && conversion(row) && plus(row) === '+2 Weeks' && noEta(row)).length },
      { label: 'Conversion Items Not Stocked 30+ Days', value: rows.filter((row) => isMmmNewht(row) && conversion(row) && plus(row) === '30+ Days').length },
    ];
  }

  rootCauseRows(): InsightRow[] {
    const rows = this.displayRows;
    const oos = rows.filter((row) => this.normUpper(this.cell(row, 'In Stock (Y/N?)')) === 'N');
    const missingEta = (row: HubRow) => this.cell(row, 'ETA').trim() === '';
    const missingPo = (row: HubRow) => this.cell(row, 'PO #').trim() === '';
    return [
      { label: 'OOS + Missing ETA and PO', value: oos.filter((row) => missingEta(row) && missingPo(row)).length },
      { label: 'OOS + Missing ETA only', value: oos.filter((row) => missingEta(row) && !missingPo(row)).length },
      { label: 'OOS + Missing PO only', value: oos.filter((row) => !missingEta(row) && missingPo(row)).length },
      { label: 'OOS + ETA and PO present', value: oos.filter((row) => !missingEta(row) && !missingPo(row)).length },
    ];
  }

  etaBucketRows(): InsightRow[] {
    const buckets: Record<string, number> = {
      Overdue: 0,
      '0-14d': 0,
      '15-30d': 0,
      '31-60d': 0,
      '61+d': 0,
      Unknown: 0,
    };
    const runDate = this.dateFromKey(this.reportDate) ?? new Date();
    for (const row of this.displayRows) {
      const eta = new Date(this.cell(row, 'ETA'));
      if (Number.isNaN(eta.getTime())) {
        buckets.Unknown += 1;
        continue;
      }
      const days = Math.round((eta.getTime() - runDate.getTime()) / 86_400_000);
      if (days < 0) {
        buckets.Overdue += 1;
      } else if (days <= 14) {
        buckets['0-14d'] += 1;
      } else if (days <= 30) {
        buckets['15-30d'] += 1;
      } else if (days <= 60) {
        buckets['31-60d'] += 1;
      } else {
        buckets['61+d'] += 1;
      }
    }
    return Object.entries(buckets).map(([label, value]) => ({ label, value }));
  }

  slowDeadBreakdown(column: string, valueColumn: string): InsightRow[] {
    const totals = new Map<string, number>();
    for (const row of this.displayRows) {
      const key = this.cell(row, column) || '(blank)';
      totals.set(key, (totals.get(key) ?? 0) + this.toNumber(this.cell(row, valueColumn)));
    }
    return Array.from(totals.entries())
      .map(([label, value]) => ({ label, value: this.currency(value) }))
      .slice(0, 12);
  }

  downloadCsv(scope: CsvScope = 'display'): void {
    const rows = scope === 'attention' ? this.attentionRows : scope === 'all' ? this.rowsForSource : this.displayRows;
    const columns = this.displayColumns;
    const csv = this.toCsv(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.selectedHubKey}_${scope}_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async submitFeedback(): Promise<void> {
    if (!this.feedbackText.trim()) {
      return;
    }
    await this.hubService.submitFeedback(this.selectedHubLabel, this.feedbackRating, this.feedbackText.trim());
    this.feedbackText = '';
    this.feedbackRating = 3;
    this.statusMessage = 'Feedback submitted.';
  }

  formatDateLabel(value: string): string {
    const date = this.dateFromKey(value);
    if (!date) {
      return value || 'Current';
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(date);
  }

  private applyBooleanFilter(rows: HubRow[], key: string): HubRow[] {
    if (key === 'attentionOnly') {
      return rows.filter((row) => this.isAttentionRow(row));
    }
    if (key === 'missingEtaOnly') {
      return rows.filter((row) => this.cell(row, 'ETA').trim() === '');
    }
    if (key === 'pendingMgmtOnly') {
      return rows.filter((row) => this.cell(row, 'Pending Management Comments').trim() !== '');
    }
    return rows;
  }

  private isAttentionRow(row: HubRow): boolean {
    const instock = this.normUpper(this.cell(row, 'In Stock (Y/N?)'));
    const etaMissing = this.cell(row, 'ETA').trim() === '';
    const poMissing = this.cell(row, 'PO #').trim() === '';
    return instock === 'N' && (etaMissing || poMissing);
  }

  private openStockKpis(rows: HubRow[]): Record<string, number> {
    const outOfStock = rows.filter((row) => this.normUpper(this.cell(row, 'In Stock (Y/N?)')) === 'N').length;
    const missingEta = rows.filter((row) => this.cell(row, 'ETA').trim() === '').length;
    const missingPo = rows.filter((row) => this.cell(row, 'PO #').trim() === '').length;
    const pendingMgmt = rows.filter((row) => this.cell(row, 'Pending Management Comments').trim() !== '').length;
    const newItems = rows.filter((row) => this.normUpper(this.cell(row, 'New Item?')) === 'YES').length;
    const attention = rows.filter((row) => this.isAttentionRow(row)).length;
    return { outOfStock, missingEta, missingPo, pendingMgmt, newItems, attention };
  }

  private serverFilters(): Record<string, string[]> {
    const filters: Record<string, string[]> = {};
    for (const filter of this.selectedHub.filters) {
      const value = this.filters[filter.key];
      if (filter.column && Array.isArray(value) && value.length > 0) {
        filters[filter.column] = value;
      }
    }
    return filters;
  }

  private searchableText(row: HubRow): string {
    return Object.values(row.data ?? {})
      .map((value) => String(value ?? ''))
      .join(' ')
      .toLowerCase();
  }

  private toCsv(rows: HubRow[], columns: string[]): string {
    const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`;
    const lines = [columns.map(escape).join(',')];
    for (const row of rows) {
      lines.push(columns.map((column) => escape(this.cell(row, column))).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  private parseCsv(text: string): Array<Record<string, string>> {
    const rows: string[][] = [];
    let current = '';
    let row: string[] = [];
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') {
          index += 1;
        }
        row.push(current);
        if (row.some((cell) => cell.trim() !== '')) {
          rows.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current);
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
    const [headers = [], ...body] = rows;
    return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] ?? '').trim()])));
  }

  private uniqueCount(rows: HubRow[], column: string): number {
    return new Set(rows.map((row) => this.cell(row, column).trim()).filter(Boolean)).size;
  }

  private toNumber(value: string): number {
    const numeric = Number.parseFloat(String(value).replace(/[$,]/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private currency(value: number): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }

  private canonical(value: string): string {
    return value.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private normUpper(value: string): string {
    return value.trim().toUpperCase();
  }

  private todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  private dateFromKey(value: string): Date | undefined {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length !== 8) {
      return undefined;
    }
    const date = new Date(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8)));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
