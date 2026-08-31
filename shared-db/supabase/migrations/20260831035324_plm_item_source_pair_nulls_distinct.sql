-- Issue #652: source-less canonical items must not collide with each other.
--
-- The original constraint treated (NULL, NULL) as one shared identity, so the
-- whole table could contain only one item without an external source pair.
-- Preserve uniqueness for real source identities while restoring standard
-- NULLS DISTINCT behavior for items that do not have one yet.
-- derived-from: 20260621151024

begin;

do $$
declare
  v_nulls_not_distinct boolean;
begin
  select i.indnullsnotdistinct
    into v_nulls_not_distinct
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conrelid = 'plm.item'::regclass
    and c.conname = 'item_source_system_source_id_key'
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) key_column
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = key_column
    ) = array['source_id', 'source_system']
  limit 1;

  if v_nulls_not_distinct is null then
    raise exception
      'expected item_source_system_source_id_key on plm.item(source_system, source_id); refusing an unverified repair';
  end if;

  if not v_nulls_not_distinct then
    raise exception
      'item_source_system_source_id_key is already NULLS DISTINCT; refusing an unexpected starting state';
  end if;
end;
$$;

alter table plm.item
  drop constraint item_source_system_source_id_key;

alter table plm.item
  add constraint item_source_system_source_id_key
  unique nulls distinct (source_system, source_id);

comment on constraint item_source_system_source_id_key on plm.item is
  'NULLS DISTINCT since 20260831035324: multiple items may lack an external identity, while each non-null source_system/source_id pair remains unique.';

commit;
