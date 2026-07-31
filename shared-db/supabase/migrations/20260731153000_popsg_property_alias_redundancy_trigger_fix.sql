-- PSG-5 corrective forward migration for
-- 20260731150000_popsg_property_resolution_contracts.sql
--
-- BUG (caught by supabase/tests/popsg_property_resolution_contracts.sql case F3
-- against preview, before this ever reached production):
--
--   core.reject_redundant_property_alias() is a BEFORE INSERT/UPDATE trigger that
--   read `new.normalized_alias`. That column is GENERATED ALWAYS ... STORED, and
--   Postgres computes generated columns AFTER all BEFORE-row triggers have run.
--   So `new.normalized_alias` was always NULL inside the trigger, `NULL IN (...)`
--   evaluated to NULL, the IF never fired, and EVERY redundant alias was accepted.
--
--   This is a silent failure: the trigger existed, was attached, and raised no
--   error. Nothing but an explicit behavioural test could have revealed it.
--
-- FIX: compute the normalized form from `new.alias` directly inside the trigger,
-- using the same canonical normalizer the generated column uses. The two can never
-- drift because they call the identical function.
--
-- The applied 20260731150000 migration is deliberately NOT edited (AGENTS.md
-- section 4 rule 4 -- never rewrite an applied migration). This replaces the
-- function body forward.
--
-- No table, column, constraint, grant, or policy changes. No data is written.

create or replace function core.reject_redundant_property_alias()
returns trigger
language plpgsql
security definer
set search_path = core, pg_catalog
as $$
declare
  v_norm_alias text;
  v_norm_name  text;
  v_norm_code  text;
begin
  -- Compute from the RAW alias. Do not read new.normalized_alias here: in a BEFORE
  -- trigger the generated column has not been populated yet and is always NULL.
  v_norm_alias := core.normalize_popsg_property_observation(new.alias);

  select core.normalize_popsg_property_observation(p.name),
         core.normalize_popsg_property_observation(coalesce(p.code, ''))
    into v_norm_name, v_norm_code
    from core.property p
   where p.id = new.property_id;

  -- v_norm_code is '' when the Property has no code; an alias can never normalize
  -- to '' (property_alias_normalized_not_blank rejects that first), so the empty
  -- code cannot produce a false redundancy hit.
  if v_norm_alias is not distinct from v_norm_name
     or v_norm_alias is not distinct from v_norm_code then
    raise exception
      'property_alias: alias % is redundant -- it normalizes to the target Property''s own name or code',
      new.alias
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function core.reject_redundant_property_alias() is
  'Rejects a property alias that normalizes to its target Property''s own name or code. '
  'Computes the normalized form from new.alias directly -- a BEFORE trigger cannot read '
  'a GENERATED column, which is the bug this migration fixed (test case F3).';

revoke execute on function core.reject_redundant_property_alias() from public;
