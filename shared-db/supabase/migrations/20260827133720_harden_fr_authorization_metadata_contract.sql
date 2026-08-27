-- #1259: finish binding the FR authorization metadata shapes without weakening
-- the transaction-bound licensing write guard.
--
-- 20260819151527 rejects arbitrary supersedes VALUES, but admits the key on
-- historical statement 20260802171000 and permits replacement statement
-- 20260818174350 to omit it. Bind each admitted migration to its exact shape.
--
-- Patch the CURRENT guard body instead of recreating an older copy. The guard
-- has since gained canonical DELETE protection (#1339) and ColdLion status-only
-- lifecycle updates for both Licensors and Properties (#1429). Replacing it from
-- the older FR migration would silently erase both later capabilities.
--
-- The exactly-one-outstanding check remains deliberately expiry-blind. An
-- expired, committed FR authorization is evidence of an abandoned or failed
-- bundle and fails closed until a superuser investigates and removes that one
-- stale row. It is not silently ignored.

do $patch$
declare
  v_def text := pg_get_functiondef('app.enforce_licensing_write_authority()'::regprocedure);
  v_old text := $old$
    if v_ruling ? 'supersedes'
       and v_ruling ->> 'supersedes' is distinct from '20260802171000' then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata supersedes an unexpected migration (%)', coalesce(v_ruling ->> 'supersedes', '<null>');
    end if;$old$;
  v_new text := $new$
    -- The metadata shapes are bound one-for-one to the two admitted statements.
    -- Historical 20260802171000 never carried a supersedes key. Replacement
    -- 20260818174350 must carry the exact pointer to that historical statement.
    if v_ruling ->> 'migration' = '20260802171000'
       and v_ruling ? 'supersedes' then
      raise exception 'owner_ruling_fr_inactivation refused: historical ruling migration 20260802171000 must not carry supersedes';
    end if;
    if v_ruling ->> 'migration' = '20260818174350'
       and (
         not (v_ruling ? 'supersedes')
         or v_ruling ->> 'supersedes' is distinct from '20260802171000'
       ) then
      raise exception 'owner_ruling_fr_inactivation refused: replacement ruling migration 20260818174350 must supersede 20260802171000, not %', coalesce(v_ruling ->> 'supersedes', '<missing>');
    end if;$new$;
  v_latch text := $latch$
      where a2.write_kind = 'owner_ruling_fr_inactivation'
        and a2.id <> v_auth.id
        and a2.consumed_at is null$latch$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception '#1259 FR metadata patch point expected exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_latch, ''))) / length(v_latch) <> 1 then
    raise exception '#1259 expiry-blind FR authorization latch is missing or ambiguous';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$patch$;

revoke all on function app.enforce_licensing_write_authority() from public;
