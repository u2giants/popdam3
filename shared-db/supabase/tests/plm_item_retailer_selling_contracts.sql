-- Item retailer selling-signal contracts (#4964 / claim #4965). Disposable
-- database transaction only; harness owns BEGIN/ROLLBACK. Catalogue-only
-- verification: column shape, foreign keys, uniqueness, the signal check, the
-- retailer lookup index, and RLS deny-by-default. Break-the-suite check:
-- renaming a column, dropping an FK, the unique constraint, the check, the
-- index, or the RLS revoke must fail a phase here.

-- =====================================================================================
-- Phase 1 — table shape: 6 columns with the expected types.
-- =====================================================================================
do $phase1$
declare
  actual text[];
begin
  select array_agg(a.attname::text || ':' || t.typname order by a.attnum)
    into actual
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_type t on t.oid = a.atttypid
   where a.attrelid = 'plm.item_retailer_selling'::regclass
     and a.attnum > 0 and not a.attisdropped;

  if actual is distinct from array[
    'id:uuid',
    'item_id:uuid',
    'retailer_id:uuid',
    'selling_signal:text',
    'created_at:timestamptz',
    'updated_at:timestamptz'
  ]::text[] then
    raise exception 'phase1: columns %, expected id/item_id/retailer_id/selling_signal/created_at/updated_at', actual;
  end if;
end
$phase1$;

-- =====================================================================================
-- Phase 2 — foreign keys: item_id -> plm.item(id), retailer_id -> core.customer(id),
-- both ON DELETE RESTRICT, plus UNIQUE (item_id, retailer_id).
-- =====================================================================================
do $phase2$
declare
  fk_items text[];
  uniq_cols name[];
begin
  select array_agg(
      a.attname || '->' || pg_catalog.pg_get_constraintdef(c.oid) order by a.attname
    )
    into fk_items
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'plm.item_retailer_selling'::regclass
     and c.contype = 'f';

  if array_length(fk_items, 1) <> 2
     or not exists (select 1 from unnest(fk_items) u(v) where v like 'item_id->%plm.item%')
     or not exists (select 1 from unnest(fk_items) u(v) where v like 'item_id->%ON DELETE RESTRICT%')
     or not exists (select 1 from unnest(fk_items) u(v) where v like 'retailer_id->%core.customer%')
     or not exists (select 1 from unnest(fk_items) u(v) where v like 'retailer_id->%ON DELETE RESTRICT%')
  then
    raise exception 'phase2: foreign keys %, expected item_id->plm.item(id) and retailer_id->core.customer(id), both ON DELETE RESTRICT', fk_items;
  end if;

  select array_agg(a.attname order by u.n)
    into uniq_cols
    from pg_catalog.pg_constraint c
    cross join unnest(c.conkey) with ordinality as u(attnum, n)
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = u.attnum
   where c.conrelid = 'plm.item_retailer_selling'::regclass
     and c.contype = 'u'
     and c.conname = 'item_retailer_selling_item_retailer_key';

  if uniq_cols is distinct from array['item_id', 'retailer_id']::name[] then
    raise exception 'phase2: unique key columns %, expected (item_id, retailer_id)', uniq_cols;
  end if;
end
$phase2$;

-- =====================================================================================
-- Phase 3 — the signal check accepts only red/yellow/green.
-- =====================================================================================
do $phase3$
declare
  def text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid)
    into def
    from pg_catalog.pg_constraint c
   where c.conrelid = 'plm.item_retailer_selling'::regclass
     and c.contype = 'c'
     and c.conname = 'item_retailer_selling_signal_check';

  if def is null
     or def not like '%red%'
     or def not like '%yellow%'
     or def not like '%green%'
  then
    raise exception 'phase3: item_retailer_selling_signal_check missing or incomplete: %', def;
  end if;
end
$phase3$;

-- =====================================================================================
-- Phase 4 — retailer lookup index on (retailer_id), valid and ready.
-- =====================================================================================
do $phase4$
declare
  v_owner oid;
  v_atts  name[];
  v_valid boolean;
begin
  select i.indrelid, i.indisvalid and i.indisready
    into v_owner, v_valid
    from pg_catalog.pg_index i
   where i.indexrelid = 'plm.item_retailer_selling_retailer_id_idx'::regclass;

  if v_owner is null then
    raise exception 'phase4: plm.item_retailer_selling_retailer_id_idx is missing';
  end if;
  if v_owner <> 'plm.item_retailer_selling'::regclass then
    raise exception 'phase4: item_retailer_selling_retailer_id_idx is not on plm.item_retailer_selling';
  end if;
  if not v_valid then
    raise exception 'phase4: item_retailer_selling_retailer_id_idx is not valid/ready';
  end if;

  select array_agg(a.attname order by u.n)
    into v_atts
    from pg_catalog.pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'plm.item_retailer_selling_retailer_id_idx'::regclass;

  if v_atts is distinct from array['retailer_id']::name[] then
    raise exception 'phase4: item_retailer_selling_retailer_id_idx columns %, expected (retailer_id)', v_atts;
  end if;
end
$phase4$;

-- =====================================================================================
-- Phase 5 — RLS deny-by-default: RLS on, no policies, no privileges for the
-- browser or service roles.
-- =====================================================================================
do $phase5$
declare
  rel_grants text[];
begin
  if not exists (
    select 1 from pg_catalog.pg_class
     where oid = 'plm.item_retailer_selling'::regclass and relrowsecurity
  ) then
    raise exception 'phase5: row level security is not enabled';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'plm' and tablename = 'item_retailer_selling'
  ) then
    raise exception 'phase5: unexpected RLS policy';
  end if;

  select array_agg(grantee || ':' || privilege_type)
    into rel_grants
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name = 'item_retailer_selling'
     and grantee in ('public', 'anon', 'authenticated', 'service_role');

  if rel_grants is not null then
    raise exception 'phase5: unexpected grants to %', rel_grants;
  end if;
end
$phase5$;
