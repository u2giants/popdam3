-- Mark the manual PopSG licensor backfills as prospective (status = 'potential').
--
-- These five brands exist in the PopSG style-guide library but are not (yet) in
-- the DesignFlow PLM / ColdLion feed. 'potential' is the canonical prospective
-- state (app.entity_status: active, inactive, archived, deleted, potential) and
-- is self-correcting: plm.import_master_data() force-sets matched rows to
-- 'active', so a row stays 'potential' only while absent from the feed. When a
-- license is signed and the brand appears upstream, the import flips it to
-- 'active' automatically.
--
-- Scoped to metadata->>'source' = 'manual_popsg_backfill' so a real feed-sourced
-- row of the same name is never affected. Idempotent. NASA is intentionally NOT
-- included here (it is a lapsed/former license, not prospective).

update core.licensor
set status = 'potential'::app.entity_status,
    updated_at = now()
where metadata->>'source' = 'manual_popsg_backfill'
  and lower(name) in ('miller coors', 'anheuser busch', 'nfl', 'ford', 'ncaa')
  and status is distinct from 'potential'::app.entity_status;
