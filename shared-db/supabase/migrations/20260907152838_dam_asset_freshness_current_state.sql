-- derived-from: none
--
-- Issue #2356; claim #2521; reserved version 20260907152838.
--
-- dam.asset already has the canonical source identity
-- (source_system, source_id) and the scalar licensor_id/property_id compatibility
-- columns used by existing PopDAM callers. This additive migration leaves all of
-- those columns, their foreign keys, and the existing source-identity uniqueness
-- constraint unchanged.
--
-- Existing rows are deliberately not rewritten. The new columns are nullable so
-- their unknown historical freshness stays honest. Defaults make new rows complete,
-- while a row-aware guard requires freshness for new rows without scanning or
-- rewriting history. Existing unknown timestamps survive unrelated metadata edits.
-- "Current" is the predicate missing_since is null, not a second boolean that could drift away from the timestamp.

alter table dam.asset
  add column if not exists first_seen_at timestamptz;

alter table dam.asset
  add column if not exists last_seen_at timestamptz;

alter table dam.asset
  add column if not exists missing_since timestamptz;

alter table dam.asset
  alter column first_seen_at set default now();

alter table dam.asset
  alter column last_seen_at set default now();

do $freshness_constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'dam.asset'::regclass
      and conname = 'dam_asset_seen_order'
  ) then
    alter table dam.asset
      add constraint dam_asset_seen_order
      check (
        first_seen_at is null
        or last_seen_at is null
        or last_seen_at >= first_seen_at
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'dam.asset'::regclass
      and conname = 'dam_asset_missing_after_first_seen'
  ) then
    alter table dam.asset
      add constraint dam_asset_missing_after_first_seen
      check (
        missing_since is null
        or first_seen_at is null
        or missing_since >= first_seen_at
      ) not valid;
  end if;
end
$freshness_constraints$;

-- New rows require complete facts. Historical unknown facts remain unknown on
-- metadata-only edits; once recorded, a fact cannot be erased back to NULL.
create or replace function dam.enforce_asset_freshness()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $guard$
begin
  if tg_op = 'INSERT' then
    if new.first_seen_at is null or new.last_seen_at is null then
      raise check_violation using message = 'new Asset requires first_seen_at and last_seen_at';
    end if;
  else
    if (old.first_seen_at is not null and new.first_seen_at is null)
       or (old.last_seen_at is not null and new.last_seen_at is null) then
      raise check_violation using message = 'recorded Asset freshness cannot become unknown';
    end if;
  end if;
  return new;
end;
$guard$;

revoke all on function dam.enforce_asset_freshness() from public, anon, authenticated, service_role;

create or replace trigger dam_asset_freshness_guard
before insert or update on dam.asset
for each row execute function dam.enforce_asset_freshness();

comment on column dam.asset.first_seen_at is
  'When this canonical Asset source identity was first observed. Null on rows that '
  'predate issue #2356; use created_at as the historical fallback.';

comment on column dam.asset.last_seen_at is
  'When this canonical Asset source identity was most recently observed. Callers '
  'record source sightings explicitly; metadata-only edits do not imply freshness.';

comment on column dam.asset.missing_since is
  'When the Asset stopped appearing in its authoritative source. Null means current. '
  'Source absence is retained for review and never expressed by deleting the Asset.';
