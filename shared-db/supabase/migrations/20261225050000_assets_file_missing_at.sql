-- popcre/shared-db#6896 (u2giants/popdam3#1198): mark records whose NAS file
-- is gone. Owner ruling (Albert Hazan, 2026-11-19, verbatim): "when artwork is
-- gone from the NAS it should be marked 'no longer on the NAS'".
--
-- public.assets.file_missing_at: NULL = the file is on the NAS (or not checked
-- yet). A timestamp = the last complete scan confirmed the file is gone and
-- the record kept its place (no surviving copy, so it must not be hidden —
-- the 2026-11-19 12:27 PM EST ruling on popdam3#1198). popdam3's missing-file
-- reconciliation sets it on a confirmed absence and clears it when the scan
-- walk sees the file again (including an unchanged return, which never reaches
-- ingest). No backfill here: the next complete scan flags every live record
-- whose file is gone.
--
-- The partial index serves the badge/filter path and stays tiny (only flagged
-- rows). Rollback (named): a forward migration
-- `alter table public.assets drop column if exists file_missing_at;` — the
-- index drops with the column.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;

alter table public.assets add column if not exists file_missing_at timestamptz null;
create index if not exists idx_assets_file_missing_at
  on public.assets (file_missing_at)
  where file_missing_at is not null;

commit;
