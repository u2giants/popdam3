-- popcre/shared-db#6918 (u2giants/popdam3#1198 item 3): foolproof move
-- identity. Owner ruling (Albert Hazan, 2026-11-19, verbatim): "there must be
-- a foolproof way to differentiate between 'disappear' and moved. we can't
-- have duplicates".
--
-- Today's move/proof match (quick_hash, filename, size) is a SAMPLED hint that
-- collides for template-derived files (KNOWN_QUIRKS #51) and cannot be the
-- proof. The plan evaluated on popdam3#1198: record the NAS file identity at
-- ingest and match on it first, with a full-content hash as the cross-volume
-- fallback.
--
--   nas_volume  — stable volume/share key from the scanning bridge. NEVER raw
--                 st_dev: Btrfs anonymous device numbers change across mounts.
--   nas_ino     — inode at last ingest. bigint: Btrfs inodes exceed 2^53; the
--                 bridge stats with BigInt and sends the value as a JSON string.
--   content_sha256 — full-content SHA-256, computed once per changed file at
--                 ingest; the cross-volume fallback (a copy gets a new inode).
--
-- Matching order in the app (agent-api): (nas_volume, nas_ino) with a
-- name-or-size sanity guard against inode reuse → content_sha256 → the
-- existing hint. No backfill here: values fill as files are re-ingested; the
-- hint keeps matching until then. Rollback (named): a forward migration
-- `alter table public.assets drop column if exists nas_volume, drop column if
-- exists nas_ino, drop column if exists content_sha256;` (both indexes drop
-- with their columns).
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;

alter table public.assets add column if not exists nas_volume text null;
alter table public.assets add column if not exists nas_ino bigint null;
alter table public.assets add column if not exists content_sha256 text null;

create index if not exists idx_assets_nas_file_identity
  on public.assets (nas_volume, nas_ino)
  where nas_volume is not null and nas_ino is not null;
create index if not exists idx_assets_content_sha256
  on public.assets (content_sha256)
  where content_sha256 is not null;

commit;
