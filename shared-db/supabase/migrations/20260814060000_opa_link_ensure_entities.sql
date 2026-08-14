-- REGRESSION FIX. 20260814040000 added foreign keys from plm.opa_property_character to the
-- new plm.opa_property and plm.opa_character entity tables, and by doing so broke the
-- existing OPA loader.
--
-- plm.sync_opa_property_character() inserts link rows directly and knows nothing about the
-- entity tables, so every insert of a previously unseen property or character now fails
-- with
--   insert or update on table "opa_property_character" violates foreign key constraint
--   "plm_opa_property_character_property_fk"
-- caught by supabase/tests/opa_property_character_importer_contracts.sql and
-- opa_property_character_landing_contracts.sql. The backfill covered every row that already
-- existed, which is why nothing looked wrong until a NEW row was loaded.
--
-- The fix is a trigger rather than an edit to the loader, deliberately:
--   * it repairs every writer at once, including the loader, the tests, and any external
--     import path we do not control;
--   * ordering entity-before-link then stops being a rule each writer has to remember,
--     which is the same class of mistake that caused this;
--   * it keeps working after the loader stops writing the deprecated name columns.

create or replace function plm.opa_link_ensure_entities()
returns trigger
language plpgsql
security definer
set search_path to 'plm', 'pg_temp'
as $function$
begin
  -- Property. The name is taken from the deprecated link column while the loader still
  -- sends it. Once it stops, the entity row must already exist - and if it does not, fail
  -- loudly with an actionable message rather than inventing a placeholder name.
  insert into plm.opa_property (licensed_property_id, property_name, first_seen_at, last_seen_at)
  select new.licensed_property_id, new.property_name, now(), now()
  where new.property_name is not null and btrim(new.property_name) <> ''
  on conflict (licensed_property_id) do update
    set property_name = excluded.property_name,
        last_seen_at  = now(),
        updated_at    = now()
    where plm.opa_property.property_name is distinct from excluded.property_name;

  -- Only speak up when the name is genuinely ABSENT (null), which is the post-deprecation
  -- case where the entity must already exist. A present-but-blank name is a data-shape
  -- problem the table's own CHECK constraint already rejects, and it must keep rejecting it
  -- as a check_violation - preempting that here would silently change the error class the
  -- landing contract tests assert on.
  if new.property_name is null and not exists (
    select 1 from plm.opa_property p
    where p.licensed_property_id = new.licensed_property_id
  ) then
    raise exception
      'OPA link refused: property % is not in plm.opa_property and this row carried no property name. Load the property entity first.',
      new.licensed_property_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Character, same contract.
  insert into plm.opa_character (character_id, character_name, first_seen_at, last_seen_at)
  select new.character_id, new.character_name, now(), now()
  where new.character_name is not null and btrim(new.character_name) <> ''
  on conflict (character_id) do update
    set character_name = excluded.character_name,
        last_seen_at   = now(),
        updated_at     = now()
    where plm.opa_character.character_name is distinct from excluded.character_name;

  if new.character_name is null and not exists (
    select 1 from plm.opa_character c
    where c.character_id = new.character_id
  ) then
    raise exception
      'OPA link refused: character % is not in plm.opa_character and this row carried no character name. Load the character entity first.',
      new.character_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$function$;

comment on function plm.opa_link_ensure_entities() is
  'BEFORE INSERT/UPDATE on plm.opa_property_character: guarantees the property and '
  'character entity rows exist, so no writer has to remember to order entity-before-link. '
  'Added after 20260814040000''s foreign keys broke plm.sync_opa_property_character().';

drop trigger if exists opa_link_ensure_entities on plm.opa_property_character;
create trigger opa_link_ensure_entities
  before insert or update on plm.opa_property_character
  for each row execute function plm.opa_link_ensure_entities();

revoke all on function plm.opa_link_ensure_entities() from public;

-- Assert the trigger is actually installed. The functional proof that the regression is
-- gone belongs to supabase/tests/opa_property_character_importer_contracts.sql and
-- opa_property_character_landing_contracts.sql, which load real snapshots through
-- plm.sync_opa_property_character(). An insert here would have to satisfy every business
-- CHECK on the landing table (line of business, entitlement scope, option source), which
-- makes it a brittle duplicate of those tests rather than an independent check.
do $$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plm'
      and c.relname = 'opa_property_character'
      and t.tgname  = 'opa_link_ensure_entities'
      and not t.tgisinternal
  ) then
    raise exception 'opa link trigger was not installed';
  end if;

  raise notice 'opa link trigger installed on plm.opa_property_character';
end $$;
