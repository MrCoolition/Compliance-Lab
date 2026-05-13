import { configuredSnowflakeDatabase, configuredSnowflakeSchema, optionalEnv } from './env';

export interface HubSourceConfig {
  name: string;
  objectName: string;
  keyColumns?: string[];
  snapshotColumns?: string[];
}

export interface HubConfig {
  key: string;
  label: string;
  description: string;
  sources: HubSourceConfig[];
  defaultColumns: string[];
  editableColumns: string[];
  filterColumns: string[];
  searchColumns: string[];
}

const REPORT_DB = configuredSnowflakeDatabase();
const REPORT_SCHEMA = configuredSnowflakeSchema();
const SILVER_SCHEMA = optionalEnv('SNOWFLAKE_SILVER_SCHEMA', 'MASALA_SILVER_COMPLIANCE_LAB');

function fqn(tableOrView: string, schema = REPORT_SCHEMA): string {
  return `${REPORT_DB}.${schema}.${tableOrView}`;
}

const openStockColumns = [
  'DISTRIBUTOR NAME',
  'DISTRIBUTOR ID',
  'DISTCODE MOG DIN',
  'MOG NAME',
  'MOG FLAG DESC',
  'MANUFACTURER NAME',
  'MIN',
  'BRAND',
  'DESCRIPTION',
  'PACK SIZE',
  'CREATED DATE',
  'DIN',
  'New Item?',
  'In Stock (Y/N?)',
  'ETA',
  '+2 Weeks',
  'PO #',
  'Previous DC Comment',
  'Required DC Update',
  'Current DC Comment',
  'Previous SCS Comment',
  'Current SCS Comment',
  'Pending Management Comments',
  'SCS',
];

const openStockEditable = [
  'New Item?',
  'In Stock (Y/N?)',
  'ETA',
  'PO #',
  'Current DC Comment',
  'Current SCS Comment',
  'Required DC Update',
  'Pending Management Comments',
];

export const hubConfigs: HubConfig[] = [
  {
    key: 'open-stock',
    label: 'Open Stock',
    description: 'Editable Open Stock worklist with saved change history.',
    sources: [
      {
        name: 'OPENSTOCKREPORT',
        objectName: fqn('OPENSTOCKREPORT'),
        keyColumns: ['DISTCODE MOG DIN'],
        snapshotColumns: ['INSERT_DATE'],
      },
      {
        name: 'OPENSTOCKREPORT_ALLMOG',
        objectName: fqn('OPENSTOCKREPORT_ALLMOG'),
        keyColumns: ['DISTCODE MOG DIN'],
        snapshotColumns: ['INSERT_DATE'],
      },
      {
        name: 'OPENSTOCKREPORT_OS',
        objectName: fqn('OPENSTOCKREPORT_OS'),
        keyColumns: ['DISTCODE MOG DIN'],
        snapshotColumns: ['INSERT_DATE'],
      },
      {
        name: 'OPENSTOCKREPORT_SYSCO',
        objectName: fqn('OPENSTOCKREPORT_SYSCO'),
        keyColumns: ['DISTCODE MOG DIN'],
        snapshotColumns: ['INSERT_DATE'],
      },
    ],
    defaultColumns: openStockColumns,
    editableColumns: openStockEditable,
    filterColumns: ['DISTRIBUTOR NAME', 'SCS', 'In Stock (Y/N?)', 'New Item?', '+2 Weeks'],
    searchColumns: ['DISTRIBUTOR NAME', 'SCS', 'MANUFACTURER NAME', 'BRAND', 'DESCRIPTION', 'DIN', 'DISTCODE MOG DIN', 'Current DC Comment', 'Current SCS Comment', 'Required DC Update', 'Pending Management Comments', 'PO #'],
  },
  {
    key: 'dc-matrix',
    label: 'DC Matrix',
    description: 'DC Matrix records and supply-chain mapping.',
    sources: [{ name: 'V_DC_MATRIX', objectName: fqn('V_DC_MATRIX'), keyColumns: ['SUPPLY_CHAIN_CODE'] }],
    defaultColumns: ['SC_PARENT_NAME', 'DISTRIBUTOR_TYPE', 'DISTRIBUTOR_COUNTRY', 'SUPPLY_CHAIN_NAME', 'SUPPLY_CHAIN_CODE', 'MOG_TYPE', 'ITRADE_NAME', 'SHORT_NAME', 'COMPASS', 'HEALTHTRUST', 'CONVERSION_DC'],
    editableColumns: ['MOG_TYPE', 'ITRADE_NAME', 'REACTORNET_NAME', 'SHORT_NAME', 'ITRADE_PARENT_CODE', 'ITRADE_CODE', 'COMPASS', 'HMS_HOST', 'CSM', 'AIMBRIDGE', 'HEALTHTRUST', 'COMPASS_CONTROLLED_DC', 'CONVERSION_DC', 'REMEDY_CODE', 'PHASE_OUT_NAME', 'FUTURECARE', 'ALTERNATE_NAME'],
    filterColumns: ['DISTRIBUTOR_TYPE', 'SUPPLY_CHAIN_NAME', 'SUPPLY_CHAIN_CODE'],
    searchColumns: ['SC_PARENT_NAME', 'SUPPLY_CHAIN_NAME', 'SUPPLY_CHAIN_CODE', 'ITRADE_NAME', 'SHORT_NAME'],
  },
  {
    key: 'conversions',
    label: 'Conversions',
    description: 'Conversion read models and manual override workflows.',
    sources: [
      { name: 'V_WORKING_MASTER_TOOL', objectName: fqn('V_WORKING_MASTER_TOOL'), keyColumns: ['PrimaryKey', 'PRIMARYKEY'] },
      { name: 'V_ACTION_FILE_TOOL', objectName: fqn('V_ACTION_FILE_TOOL'), keyColumns: ['PrimaryKey', 'PRIMARYKEY'] },
      { name: 'DC_COMMUNICATION_TOOL', objectName: fqn('DC_COMMUNICATION_TOOL', SILVER_SCHEMA), keyColumns: ['SEQUENCE'] },
    ],
    defaultColumns: ['PrimaryKey', 'ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION', 'COMPLETION STATUS', 'COMPLETION COMMENTS', 'Analyst'],
    editableColumns: ['DATE EXECUTED (ACTUAL DATE)', 'NEW ITEM ATTRIBUTES', 'NEW MOG', 'CONVERSION ANALYSIS COMMENTS', 'COMPLETION STATUS', 'COMPLETION COMMENTS', 'ROW #', 'Analyst'],
    filterColumns: ['ConversionMonth', 'DISTRIBUTOR NAME', 'ACTION'],
    searchColumns: ['PrimaryKey', 'DISTRIBUTOR NAME', 'ACTION', 'CONVERSION ANALYSIS NAME', 'ITEM DESCRIPTION'],
  },
  {
    key: 'unlocked-accounts',
    label: 'Unlocked Accounts',
    description: 'Current unlocked and locked account state.',
    sources: [
      { name: 'UNLOCKED_ACCOUNTS', objectName: fqn('UNLOCKED_ACCOUNTS'), keyColumns: ['ACCOUNT_RECORD_ID', 'DSTCODEDCN'] },
      { name: 'LOCKED_INACTIVE_ACCOUNTS', objectName: fqn('LOCKED_INACTIVE_ACCOUNTS'), keyColumns: ['ACCOUNT_RECORD_ID', 'DSTCODEDCN'] },
    ],
    defaultColumns: ['BUSINESS', 'CUSTOMER', 'DC_NAME', 'DISTRIBUTOR_CODE', 'SECTOR_ATTRIBUTE', 'UNIT_NUMBER', 'DSTCODEUNIT', 'DCN', 'DSTCODEDCN', 'DATE_UNLOCKED', 'ACCOUNT_TYPE', 'REQUESTOR_NAME'],
    editableColumns: ['SECTOR_ATTRIBUTE', 'CUS_CODE', 'DIST_CUSTOMER_NAME', 'DCN_CODE', 'DATE_UNLOCKED', 'UNLOCK_DOTCOM', 'UNLOCK_MYORDERS', 'UNLOCK_NO_CAT_MYORDERS', 'ACCOUNT_TYPE', 'REQUESTOR_NAME'],
    filterColumns: ['DCN', 'UNIT_NUMBER', 'DC_NAME', 'SECTOR_ATTRIBUTE'],
    searchColumns: ['BUSINESS', 'CUSTOMER', 'DC_NAME', 'DISTRIBUTOR_CODE', 'UNIT_NUMBER', 'DSTCODEDCN', 'REQUESTOR_NAME'],
  },
  {
    key: 'slow-dead',
    label: 'Slow and Dead',
    description: 'Slow and dead inventory view with sector and category analysis.',
    sources: [{ name: 'V_SLOWDEAD_ALL', objectName: fqn('V_SLOWDEAD_ALL'), keyColumns: ['DISTCODEDIN', 'DIN', 'MIN'] }],
    defaultColumns: ['Sector', 'Category', 'NOTICE', 'QOH', 'True Extended Value', 'Intentional?'],
    editableColumns: [],
    filterColumns: ['Sector', 'Category', 'NOTICE'],
    searchColumns: ['Sector', 'Category', 'NOTICE', 'DESCRIPTION', 'BRAND', 'MIN'],
  },
  {
    key: 'itrade',
    label: 'iTrade',
    description: 'iTrade reference views loaded as separate source tabs.',
    sources: [
      { name: 'V_ITRADE_ACCOUNT_LIST', objectName: fqn('V_ITRADE_ACCOUNT_LIST') },
      { name: 'V_AUTOSHIPMENT_ITRADE_TOOL', objectName: fqn('V_AUTOSHIPMENT_ITRADE_TOOL') },
      { name: 'V_ITRADE_CONVERSION_BAR_UNITS', objectName: fqn('V_ITRADE_CONVERSION_BAR_UNITS') },
      { name: 'V_ITRADE_SECTORS_AT_DC', objectName: fqn('V_ITRADE_SECTORS_AT_DC') },
    ],
    defaultColumns: ['ACCOUNT', 'DISTRIBUTOR', 'SECTOR', 'STATUS'],
    editableColumns: [],
    filterColumns: ['SECTOR', 'DISTRIBUTOR', 'STATUS'],
    searchColumns: [],
  },
  {
    key: 'off-mog',
    label: 'Off MOG',
    description: 'Off MOG reference view.',
    sources: [{ name: 'V_OFF_MOG', objectName: fqn('V_OFF_MOG') }],
    defaultColumns: ['DISTRIBUTOR', 'MOG', 'DIN', 'BRAND', 'DESCRIPTION'],
    editableColumns: [],
    filterColumns: ['DISTRIBUTOR', 'MOG'],
    searchColumns: [],
  },
  {
    key: 'prop-list',
    label: 'Prop List',
    description: 'Monthly proprietary list view.',
    sources: [{ name: 'V_PROPRIETARY_LIST_MONTHLY', objectName: fqn('V_PROPRIETARY_LIST_MONTHLY'), keyColumns: ['DIN', 'MIN'] }],
    defaultColumns: ['SECTOR', 'NOTICE', 'CATEGORY', 'DIN', 'MIN', 'BRAND', 'DESCRIPTION'],
    editableColumns: [],
    filterColumns: ['SECTOR', 'NOTICE', 'CATEGORY'],
    searchColumns: [],
  },
  {
    key: 'substitutions',
    label: 'Substitutions',
    description: 'Substitutions view with global search and export.',
    sources: [{ name: 'V_SUBSTITUTIONS', objectName: fqn('V_SUBSTITUTIONS') }],
    defaultColumns: ['DISTRIBUTOR', 'DIN', 'BRAND', 'DESCRIPTION', 'SUBSTITUTE'],
    editableColumns: [],
    filterColumns: ['DISTRIBUTOR', 'CATEGORY'],
    searchColumns: [],
  },
  {
    key: 'autoshipments',
    label: 'Autoshipments',
    description: 'Autoshipments workflow view.',
    sources: [{ name: 'V_AUTO_SHIPMENTS', objectName: fqn('V_AUTO_SHIPMENTS') }],
    defaultColumns: ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND', 'ACCOUNT', 'DISTRIBUTOR'],
    editableColumns: [],
    filterColumns: ['SUBMISSION MONTH', 'SUBMISSION DAY', 'SUBMISSION YEAR', 'ISSUES FOUND'],
    searchColumns: [],
  },
];

export function getHubConfig(key: string): HubConfig | undefined {
  return hubConfigs.find((hub) => hub.key === key);
}

export function requireHubConfig(key: string): HubConfig {
  const config = getHubConfig(key);
  if (!config) {
    throw new Error(`Unknown hub: ${key}`);
  }
  return config;
}
