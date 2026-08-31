-- Issue #778 — freeze the leftover `designflow` schema instead of dropping it.
--
-- Owner authorization 2026-08-27: "rename it".
--
-- The schema is NOT empty. It holds 1,385 rows across 7 tables and has two
-- inbound foreign keys that still resolve:
--   app.RolePermissions        -> designflow."Roles"     (4 rows)
--   plm.art_piece_attachment   -> designflow.art_piece   (2,276 rows)
-- Renaming keeps every foreign key intact (they track the object, not the name)
-- while making it unmistakable that nothing new should be built against it.
-- The DROP remains deferred until those two children are disposed of.
--
-- Pre-rename backup: backups/designflow-orphan-schema-backup-2026-08-27.json

-- PostgreSQL fails this statement if the source is missing or the target exists.
-- Keeping it declarative also makes the exact structural effect statically auditable.
alter schema designflow rename to designflow_frozen_20260710;

comment on schema designflow_frozen_20260710 is
  'FROZEN 2026-08-27 (issue #778). Leftover pre-migration DesignFlow schema; not the live DesignFlow database. Read-only history. Do not build against it. Drop deferred until app.RolePermissions and plm.art_piece_attachment no longer reference it.';
