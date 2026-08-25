-- Issue #1439 contract: one mapping authority per entity, no inferred links.
begin;

do $contract$
begin
  if exists (select 1 from dflow.artists where core_artist_id is not null) then
    raise exception 'migration guessed or backfilled an artist mapping';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.artists'::regclass
      and conname = 'artists_core_artist_id_fkey'
      and convalidated
      and confrelid = 'core.artist'::regclass
      and pg_get_constraintdef(oid) like '%ON UPDATE CASCADE ON DELETE RESTRICT%'
  ) then
    raise exception 'artist canonical bridge FK contract is missing or incorrect';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'artists'
      and indexname = 'artists_core_artist_id_idx'
      and indexdef like 'CREATE INDEX%WHERE (core_artist_id IS NOT NULL)'
  ) then
    raise exception 'artist bridge lookup index is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'dflow' and table_name = 'factory_canonical_identity'
      and column_name = 'legacy_factory_id' and data_type = 'integer'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'dflow' and table_name = 'factory_canonical_identity'
      and column_name = 'core_factory_id' and data_type = 'uuid'
  ) then
    raise exception 'Factory canonical identity view shape is missing or incorrect';
  end if;

  if exists (
    select 1 from dflow.factory_canonical_identity
    group by legacy_factory_id having count(*) > 1
  ) then
    raise exception 'Factory canonical identity view duplicates a legacy identity';
  end if;

  if exists (
    select 1 from dflow.factory_canonical_identity v
    where v.core_factory_id is not null
      and not exists (
        select 1 from core.factory_source_ref r
        where r.factory_id = v.core_factory_id
          and r.source_system = 'designflow_plm' and r.source_table = 'Factory'
          and r.source_id = v.legacy_factory_id::text
      )
  ) then
    raise exception 'Factory view exposes a mapping outside core.factory_source_ref';
  end if;

  if has_table_privilege('anon', 'dflow.factory_canonical_identity', 'SELECT') then
    raise exception 'anon must not read the Factory identity bridge';
  end if;

  if has_table_privilege('authenticated', 'dflow.factory_canonical_identity', 'SELECT') then
    raise exception 'authenticated must not read the Factory identity bridge directly';
  end if;

  if has_table_privilege('service_role', 'dflow.factory_canonical_identity', 'SELECT') then
    raise exception 'service_role must not receive an unusable direct Factory bridge grant';
  end if;

  if position('designflow_plm' in pg_get_viewdef('dflow.factory_canonical_identity'::regclass, true)) = 0
     or position('Factory' in pg_get_viewdef('dflow.factory_canonical_identity'::regclass, true)) = 0 then
    raise exception 'Factory identity view must use the established designflow_plm/Factory source-ref contract';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dflow' and c.relname = 'factory_canonical_identity'
      and coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'Factory identity view must honor underlying table security';
  end if;
end
$contract$;

rollback;
