-- derived-from: none
-- Issue #7041 (claim #7061): append-only DELETE guard on
-- dflow_prod.item_description_parts (plan D11; review of PR #7044). Fix
-- forward of 20261225091507, which is applied on production and guarded only
-- UPDATE while the item-master grants role holds DELETE. The sandbox half
-- carries the same guard inside its own still-unapplied 20261225091506.
--
-- Objects: function dflow_prod.item_description_parts_no_delete(), trigger
-- item_description_parts_no_delete. Direct DELETE raises check_violation; the
-- itemHeader ON DELETE CASCADE (depth > 1) is still allowed. No data written.
-- Idempotent (OR REPLACE / drop-if-exists). Rollback: drop trigger
-- item_description_parts_no_delete on dflow_prod.item_description_parts, drop
-- function dflow_prod.item_description_parts_no_delete.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regclass('dflow_prod.item_description_parts') is null then
    raise exception '#7041/20261225120103 self-check: dflow_prod.item_description_parts is missing — 20261225091507 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- D11 append-only also covers DELETE: a parts row is never removed directly.
-- The one allowed path is the itemHeader ON DELETE CASCADE, which runs this
-- trigger from inside the referential-integrity trigger (depth > 1).
create or replace function dflow_prod.item_description_parts_no_delete() returns trigger as $fn$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'item_description_parts % is append-only: rows are never deleted (clear is_current and insert a new row instead)',
    old.id using errcode = 'check_violation';
end
$fn$ language plpgsql;

drop trigger if exists item_description_parts_no_delete on dflow_prod.item_description_parts;
create trigger item_description_parts_no_delete
  before delete on dflow_prod.item_description_parts
  for each row execute function dflow_prod.item_description_parts_no_delete();
