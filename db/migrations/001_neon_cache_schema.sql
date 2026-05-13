create schema if not exists __SCHEMA__;

create table if not exists __SCHEMA__.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.hub_sync_runs (
  run_id uuid primary key,
  hub_key text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  requested_snapshot_date text,
  rows_loaded integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists __SCHEMA__.hub_rows (
  hub_key text not null,
  source_name text not null,
  row_key text not null,
  snapshot_date text not null default 'current',
  data jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  source_hash text not null,
  synced_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_modified_at timestamptz,
  primary key (hub_key, source_name, row_key, snapshot_date)
);

create index if not exists hub_rows_hub_snapshot_idx
  on __SCHEMA__.hub_rows (hub_key, snapshot_date, last_seen_at desc);

create index if not exists hub_rows_source_idx
  on __SCHEMA__.hub_rows (hub_key, source_name);

create index if not exists hub_rows_data_gin_idx
  on __SCHEMA__.hub_rows using gin (data);

create table if not exists __SCHEMA__.openstock_change_batches (
  batch_id uuid primary key,
  operation text not null,
  run_date text not null,
  changed_by text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'undone')),
  changed_at timestamptz not null default now(),
  affected_keys integer not null default 0,
  rows_affected integer not null default 0,
  undone_at timestamptz,
  undone_by text,
  error_message text
);

create table if not exists __SCHEMA__.openstock_change_log (
  id bigserial primary key,
  batch_id uuid not null references __SCHEMA__.openstock_change_batches(batch_id),
  run_date text not null,
  row_key text not null,
  column_name text not null,
  old_value text,
  new_value text,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists openstock_change_log_batch_idx
  on __SCHEMA__.openstock_change_log (batch_id);

create table if not exists __SCHEMA__.manual_overrides (
  hub_key text not null,
  source_name text not null,
  row_key text not null,
  values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (hub_key, source_name, row_key)
);

create table if not exists __SCHEMA__.account_history (
  history_id uuid primary key,
  account_record_id text,
  event_type text not null,
  source_state text,
  target_state text,
  details jsonb not null default '{}'::jsonb,
  event_by text,
  event_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.feedback (
  feedback_id bigserial primary key,
  app_name text not null,
  rating integer not null check (rating between 1 and 5),
  feedback_text text,
  submitted_by text,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into __SCHEMA__.schema_migrations (version)
values ('001_neon_cache_schema')
on conflict (version) do nothing;

