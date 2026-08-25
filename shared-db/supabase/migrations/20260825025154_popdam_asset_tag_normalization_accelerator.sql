-- Production-safe prerequisite for #1427's bounded legacy metadata reconciliation.
-- Apply this version before the still-pending 20260825010603 migration.
set statement_timeout = '10min';

-- The merged migration adds the same columns with IF NOT EXISTS. Adding them here
-- makes the batch predicate indexable before that migration begins; it does not
-- change the final #1427 contract.
alter table public.asset_tags
  add column if not exists category text,
  add column if not exists status text,
  add column if not exists confidence numeric,
  add column if not exists model text,
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists updated_at timestamptz not null default now();

-- The original table-wide reconciliation is intentionally unchanged. Its
-- keyset batches previously restarted from the primary-key head and repeatedly
-- scanned rows that no longer matched. This partial index gives each batch a
-- much cheaper ordered scan of the dirty-row subset. Dead index entries remain
-- until the enclosing migration transaction commits, so the index does not
-- physically shrink between internal batches; it avoids repeated table/primary-
-- key prefix scans without changing the existing global timeout.
create index if not exists asset_tags_pending_metadata_normalization_idx
  on public.asset_tags (id)
  where tag is distinct from btrim(tag)
     or source is distinct from btrim(source)
     or category is null
     or status is null
     or source is null
     or source = '';
