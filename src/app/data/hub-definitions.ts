export type HubKey =
  | 'autoshipments'
  | 'conversions'
  | 'dc-matrix'
  | 'itrade'
  | 'off-mog'
  | 'open-stock'
  | 'prop-list'
  | 'slow-dead'
  | 'substitutions'
  | 'unlocked-accounts';

export type FilterKind = 'checkbox' | 'multi' | 'single' | 'text';

export interface FilterDefinition {
  key: string;
  label: string;
  kind: FilterKind;
  column?: string;
  options?: string[];
  defaultValue?: string | boolean | string[];
}

export interface HubTabDefinition {
  key: string;
  label: string;
}

export interface HubActionDefinition {
  key: string;
  label: string;
  tone?: 'primary' | 'danger' | 'neutral';
}

export interface HubDefinition {
  key: HubKey;
  label: string;
  description: string;
  navDescription: string;
  tabs: HubTabDefinition[];
  guide: string[];
  primaryColumns: string[];
  editableColumns: string[];
  filters: FilterDefinition[];
  sourceTabs?: HubTabDefinition[];
  actions?: HubActionDefinition[];
}

export const OPEN_STOCK_KEY_COL = 'DISTCODE MOG DIN';

export const OPEN_STOCK_EDITABLE_COLUMNS = [
  'New Item?',
  'In Stock (Y/N?)',
  'ETA',
  'PO #',
  'Current DC Comment',
  'Current SCS Comment',
  'Required DC Update',
  'Pending Management Comments',
];

export const OPEN_STOCK_UPLOAD_EDITABLE_COLUMNS = [...OPEN_STOCK_EDITABLE_COLUMNS, 'SCS'];

export const OPEN_STOCK_WORKLIST_COLUMNS = [
  'DISTRIBUTOR NAME',
  'DISTRIBUTOR ID',
  OPEN_STOCK_KEY_COL,
  'MOG NAME',
  'MOG FLAG DESC',
  'MOG FLAG',
  'MOG',
  'MANUFACTURER NAME',
  'MANUFACTURER  NAME',
  'MIN',
  'BRAND',
  'DESCRIPTION',
  'PACK SIZE',
  'USER COMMENTS',
  'Usage',
  'USAGE',
  'CREATED DATE',
  'DIN',
  'New Item?',
  'In Stock (Y/N?)',
  'ETA',
  '+2 Weeks',
  'Days Since SRF',
  'PO#',
  'PO #',
  'Previous DC Comment',
  'Previoud DC Update',
  'Previous DC Update',
  'Required DC Update',
  'Current DC Comment',
  'Previous CA Comment',
  'Previous SCS Comment',
  'Current CA Comment',
  'Current SCS Comment',
  'Pending Management Comments',
  'CA',
  'SCS',
];

export const DC_MATRIX_LOCKED_COLUMNS = [
  'SC_PARENT_NAME',
  'DISTRIBUTOR_TYPE',
  'DISTRIBUTOR_COUNTRY',
  'SUPPLY_CHAIN_NAME',
  'SUPPLY_CHAIN_PARENT_CODE',
  'SUPPLY_CHAIN_CODE',
];

export const DC_MATRIX_EDITABLE_COLUMNS = [
  'MOG_TYPE',
  'ITRADE_NAME',
  'REACTORNET_NAME',
  'SHORT_NAME',
  'ITRADE_PARENT_CODE',
  'ITRADE_CODE',
  'COMPASS',
  'HMS_HOST',
  'CSM',
  'AIMBRIDGE',
  'HEALTHTRUST',
  'COMPASS_CONTROLLED_DC',
  'CONVERSION_DC',
  'REMEDY_CODE',
  'PHASE_OUT_NAME',
  'FUTURECARE',
  'ALTERNATE_NAME',
  'NAME_CONV_DIST_DC_NAME',
  'NAME_CONV_DIST_PARENT',
  'NAME_CONV_SC_DC_NAME',
];

export const UNLOCKED_TEMPLATE_COLUMNS = [
  'BUSINESS',
  'CUSTOMER',
  'DC_NAME',
  'DISTRIBUTOR_CODE',
  'SECTOR_ATTRIBUTE',
  'UNIT_NUMBER',
  'DSTCODEUNIT',
  'CUS_CODE',
  'DIST_CUSTOMER_NAME',
  'DCN',
  'DSTCODEDCN',
  'DCN_CODE',
  'DATE_UNLOCKED',
  'UNLOCK_DOTCOM',
  'UNLOCK_MYORDERS',
  'UNLOCK_NO_CAT_MYORDERS',
  'ACCOUNT_TYPE',
  'REQUESTOR_NAME',
];

export const HUB_DEFINITIONS: HubDefinition[] = [
  {
    key: 'autoshipments',
    label: 'Autoshipments',
    description: 'Autoshipments view with search, issue filters, and export tools.',
    navDescription: 'Submission issue review',
    tabs: [{ key: 'view', label: 'Autoshipments' }],
    guide: ['Filter by submission period or issue status.', 'Search across the current view.', 'Export the current result set for follow-up.'],
    primaryColumns: ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND', 'ACCOUNT', 'DISTRIBUTOR'],
    editableColumns: [],
    filters: [
      { key: 'submissionMonth', label: 'Submission Month', kind: 'multi', column: 'SUBMISSION MONTH' },
      { key: 'submissionDay', label: 'Submission Day', kind: 'multi', column: 'SUBMISSION DAY' },
      { key: 'submissionYear', label: 'Submission Year', kind: 'multi', column: 'SUBMISSION YEAR' },
      { key: 'issuesFound', label: 'Issues Found', kind: 'multi', column: 'ISSUES FOUND' },
    ],
  },
  {
    key: 'conversions',
    label: 'Conversions',
    description: 'Conversion workbooks, action files, DC communications, and editable manual tables.',
    navDescription: 'Conversion action tracking',
    tabs: [
      { key: 'working-master', label: 'Working Master Tool' },
      { key: 'action-file', label: 'Action File Tool' },
      { key: 'sourcing-master', label: 'Sourcing Conversion Master' },
      { key: 'srs-master', label: 'Conversion Master' },
      { key: 'dc-communications', label: 'DC Communications' },
    ],
    guide: ['Use the read-only tabs for working and action file review.', 'Edit manual columns in the manual tabs only.', 'Export a workbook when a full handoff is needed.'],
    primaryColumns: ['PrimaryKey', 'ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION', 'COMPLETION STATUS', 'COMPLETION COMMENTS', 'Analyst'],
    editableColumns: ['DATE EXECUTED (ACTUAL DATE)', 'NEW ITEM ATTRIBUTES', 'NEW MOG', 'CONVERSION ANALYSIS COMMENTS', 'COMPLETION STATUS', 'COMPLETION COMMENTS', 'ROW #', 'Analyst'],
    filters: [
      { key: 'conversionMonth', label: 'Conversion Month', kind: 'multi', column: 'ConversionMonth' },
      { key: 'distributorName', label: 'Distributor', kind: 'multi', column: 'DISTRIBUTOR NAME' },
      { key: 'action', label: 'Action', kind: 'multi', column: 'ACTION' },
    ],
    sourceTabs: [
      { key: 'V_WORKING_MASTER_TOOL', label: 'Working Master Tool' },
      { key: 'V_ACTION_FILE_TOOL', label: 'Action File Tool' },
      { key: 'DC_COMMUNICATION_TOOL', label: 'DC Communications' },
    ],
  },
  {
    key: 'dc-matrix',
    label: 'DC Matrix',
    description: 'Maintain supply-chain mapping records, add distributor rows, and apply template uploads.',
    navDescription: 'Distributor mapping',
    tabs: [
      { key: 'add-row', label: 'Add New Row' },
      { key: 'update-row', label: 'Update Existing Row' },
      { key: 'upload', label: 'Upload' },
    ],
    guide: ['Select a distributor code to start a new row.', 'Only matrix detail columns are editable.', 'Use uploads for bulk keyed updates.'],
    primaryColumns: [...DC_MATRIX_LOCKED_COLUMNS, ...DC_MATRIX_EDITABLE_COLUMNS],
    editableColumns: DC_MATRIX_EDITABLE_COLUMNS,
    filters: [
      { key: 'supplyChainCode', label: 'Supply Chain Code', kind: 'multi', column: 'SUPPLY_CHAIN_CODE' },
      { key: 'distributorType', label: 'Distributor Type', kind: 'multi', column: 'DISTRIBUTOR_TYPE' },
    ],
    actions: [
      { key: 'submit-new-row', label: 'Submit row', tone: 'primary' },
      { key: 'save-matrix', label: 'Save changes', tone: 'primary' },
      { key: 'apply-matrix-upload', label: 'Apply upload', tone: 'primary' },
    ],
  },
  {
    key: 'itrade',
    label: 'iTrade',
    description: 'Account list, autoshipment, conversion unit, and sector-at-DC reference views.',
    navDescription: 'iTrade references',
    tabs: [
      { key: 'account-list', label: 'Account List' },
      { key: 'autoshipments-itrade-tool', label: 'Autoshipments iTrade Tool' },
      { key: 'conversion-bar-units', label: 'Conversion BAR Units' },
      { key: 'sectors-at-dc', label: 'Sectors at DC' },
    ],
    guide: ['Switch tabs to review each iTrade reference view.', 'Search within the loaded view.', 'Export all currently loaded rows when sharing downstream.'],
    primaryColumns: ['ACCOUNT', 'DISTRIBUTOR', 'SECTOR', 'STATUS'],
    editableColumns: [],
    filters: [
      { key: 'sector', label: 'Sector', kind: 'multi', column: 'SECTOR' },
      { key: 'distributor', label: 'Distributor', kind: 'multi', column: 'DISTRIBUTOR' },
    ],
    sourceTabs: [
      { key: 'V_ITRADE_ACCOUNT_LIST', label: 'Account List' },
      { key: 'V_AUTOSHIPMENT_ITRADE_TOOL', label: 'Autoshipments iTrade Tool' },
      { key: 'V_ITRADE_CONVERSION_BAR_UNITS', label: 'Conversion BAR Units' },
      { key: 'V_ITRADE_SECTORS_AT_DC', label: 'Sectors at DC' },
    ],
  },
  {
    key: 'off-mog',
    label: 'Off MOG',
    description: 'Off MOG reference view with global search and export.',
    navDescription: 'Off-MOG review',
    tabs: [{ key: 'off-mog', label: 'Off MOG' }],
    guide: ['Search the reference view.', 'Export the current result set.', 'Use the table to inspect distributor, MOG, and item detail.'],
    primaryColumns: ['DISTRIBUTOR', 'MOG', 'DIN', 'BRAND', 'DESCRIPTION'],
    editableColumns: [],
    filters: [
      { key: 'distributor', label: 'Distributor', kind: 'multi', column: 'DISTRIBUTOR' },
      { key: 'mog', label: 'MOG', kind: 'multi', column: 'MOG' },
    ],
  },
  {
    key: 'open-stock',
    label: 'Open Stock',
    description: 'Edit the worklist, review signals, import updates, and export focused views.',
    navDescription: 'Editable weekly worklist',
    tabs: [
      { key: 'worklist', label: 'Worklist' },
      { key: 'insights', label: 'Insights' },
      { key: 'data', label: 'Data' },
    ],
    guide: [
      'Choose a report run date from the sidebar.',
      'Use filters to narrow the worklist by distributor, SCS, stock status, and escalation state.',
      'Edit only the allowed worklist columns, then save changes.',
      'Use Data for template export, upload review, and bulk updates.',
      'Use Insights to review aging, escalation, ETA, and action-list signals.',
    ],
    primaryColumns: OPEN_STOCK_WORKLIST_COLUMNS,
    editableColumns: OPEN_STOCK_EDITABLE_COLUMNS,
    filters: [
      { key: 'distributor', label: 'Distributor', kind: 'multi', column: 'DISTRIBUTOR NAME' },
      { key: 'scs', label: 'SCS', kind: 'multi', column: 'SCS' },
      { key: 'inStock', label: 'In Stock', kind: 'single', column: 'In Stock (Y/N?)', options: ['All', 'Y', 'N'], defaultValue: 'All' },
      { key: 'newItem', label: 'New Item?', kind: 'single', column: 'New Item?', options: ['All', 'YES', 'NO'], defaultValue: 'All' },
      { key: 'attentionOnly', label: 'Only items needing attention', kind: 'checkbox', defaultValue: false },
      { key: 'missingEtaOnly', label: 'Only rows missing ETA', kind: 'checkbox', defaultValue: false },
      { key: 'pendingMgmtOnly', label: 'Only rows with pending mgmt comment', kind: 'checkbox', defaultValue: false },
    ],
    actions: [
      { key: 'weekly-refresh', label: 'Refresh weekly', tone: 'primary' },
      { key: 'persist-lookback', label: 'Persist lookback', tone: 'primary' },
      { key: 'undo-inline-save', label: 'Undo last inline save' },
    ],
  },
  {
    key: 'prop-list',
    label: 'Prop List',
    description: 'Monthly proprietary list with sector, notice, category, search, and export.',
    navDescription: 'Monthly proprietary list',
    tabs: [{ key: 'view', label: 'Prop List' }],
    guide: ['Filter by sector, notice, or category.', 'Search the current list.', 'Export the filtered view as CSV.'],
    primaryColumns: ['SECTOR', 'NOTICE', 'CATEGORY', 'DIN', 'MIN', 'BRAND', 'DESCRIPTION'],
    editableColumns: [],
    filters: [
      { key: 'sector', label: 'Sector', kind: 'multi', column: 'SECTOR' },
      { key: 'notice', label: 'NOTICE', kind: 'multi', column: 'NOTICE' },
      { key: 'category', label: 'Category', kind: 'multi', column: 'CATEGORY' },
    ],
  },
  {
    key: 'slow-dead',
    label: 'Slow and Dead',
    description: 'Slow and dead inventory review with sector, category, notice, and value analysis.',
    navDescription: 'Slow/dead analysis',
    tabs: [
      { key: 'all-sd', label: 'All S&D' },
      { key: 'insights', label: 'Insights' },
    ],
    guide: ['Filter by sector, category, or notice.', 'Review value and quantity breakdowns in Insights.', 'Export the current filtered view.'],
    primaryColumns: ['Sector', 'Category', 'NOTICE', 'QOH', 'True Extended Value', 'Intentional?'],
    editableColumns: [],
    filters: [
      { key: 'sector', label: 'Sector', kind: 'multi', column: 'Sector' },
      { key: 'category', label: 'Category', kind: 'multi', column: 'Category' },
      { key: 'notice', label: 'NOTICE', kind: 'multi', column: 'NOTICE' },
    ],
  },
  {
    key: 'substitutions',
    label: 'Substitutions',
    description: 'Substitutions reference view with global search and export.',
    navDescription: 'Substitution references',
    tabs: [{ key: 'view', label: 'Substitutions' }],
    guide: ['Search across the substitutions view.', 'Inspect item and replacement details.', 'Export the current filtered rows.'],
    primaryColumns: ['DISTRIBUTOR', 'DIN', 'BRAND', 'DESCRIPTION', 'SUBSTITUTE'],
    editableColumns: [],
    filters: [
      { key: 'distributor', label: 'Distributor', kind: 'multi', column: 'DISTRIBUTOR' },
      { key: 'category', label: 'Category', kind: 'multi', column: 'CATEGORY' },
    ],
  },
  {
    key: 'unlocked-accounts',
    label: 'Unlocked Accounts',
    description: 'Current-state operations for unlocked and locked accounts.',
    navDescription: 'Unlocked and locked state',
    tabs: [
      { key: 'unlocked', label: 'Unlocked Accounts' },
      { key: 'locked', label: 'Locked Accounts' },
      { key: 'history', label: 'History Export' },
    ],
    guide: ['Filter by DCN, unit number, DC, or sector.', 'Lock, unlock, or transfer the filtered set after review.', 'Use templates for batch updates.'],
    primaryColumns: [...UNLOCKED_TEMPLATE_COLUMNS, 'DATE_LOCKED', 'LOCK_REASON', 'LAST_TRANSACTION_DATE'],
    editableColumns: ['SECTOR_ATTRIBUTE', 'CUS_CODE', 'DIST_CUSTOMER_NAME', 'DCN_CODE', 'DATE_UNLOCKED', 'UNLOCK_DOTCOM', 'UNLOCK_MYORDERS', 'UNLOCK_NO_CAT_MYORDERS', 'ACCOUNT_TYPE', 'REQUESTOR_NAME'],
    filters: [
      { key: 'dcn', label: 'DCN / Account Number', kind: 'multi', column: 'DCN' },
      { key: 'unitNumber', label: 'Unit Number', kind: 'multi', column: 'UNIT_NUMBER' },
      { key: 'dcName', label: 'DC', kind: 'multi', column: 'DC_NAME' },
      { key: 'sectorAttribute', label: 'Sector Attribute', kind: 'multi', column: 'SECTOR_ATTRIBUTE' },
    ],
    sourceTabs: [
      { key: 'UNLOCKED_ACCOUNTS', label: 'Unlocked Accounts' },
      { key: 'LOCKED_INACTIVE_ACCOUNTS', label: 'Locked Accounts' },
    ],
    actions: [
      { key: 'lock-filtered', label: 'Lock filtered set', tone: 'danger' },
      { key: 'unlock-filtered', label: 'Unlock filtered set', tone: 'primary' },
      { key: 'bl-transfer', label: 'BL transfer filtered set', tone: 'primary' },
      { key: 'apply-account-upload', label: 'Apply batch upload', tone: 'primary' },
    ],
  },
];

export function hubDefinitionFor(key: string): HubDefinition {
  return HUB_DEFINITIONS.find((hub) => hub.key === key) ?? HUB_DEFINITIONS.find((hub) => hub.key === 'open-stock')!;
}
