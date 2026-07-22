-- Preview/disposable verification for the dflow.sample_shipment_item restore
-- and membership-uniqueness constraint. All fixture changes roll back.
-- Run only after 20260722220000 and 20260722220100 are applied.
begin;

do $$
declare
  v_sample_a integer;
  v_sample_b integer;
  v_box      integer;
  v_dup_blocked boolean := false;
  v_null_box_ok boolean := false;
begin
  ----------------------------------------------------------------------------
  -- Structure
  ----------------------------------------------------------------------------
  if to_regclass('dflow.sample_shipment_item') is null then
    raise exception 'dflow.sample_shipment_item was not restored';
  end if;

  -- Exactly the seven expected columns, matching the plm template.
  if (
    select count(*) from information_schema.columns
    where table_schema = 'dflow' and table_name = 'sample_shipment_item'
      and column_name in ('shipment_item_id_pk','sample_id_fk','box_id_fk',
                          'factory_group_id_fk','leg_type','added_date','added_user')
  ) <> 7 then
    raise exception 'dflow.sample_shipment_item is missing expected columns';
  end if;

  -- Primary key is a generated identity (its own fresh sequence).
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'dflow.sample_shipment_item'::regclass
      and attname = 'shipment_item_id_pk' and attidentity <> ''
  ) then
    raise exception 'shipment_item_id_pk is not an identity column';
  end if;

  ----------------------------------------------------------------------------
  -- Foreign keys (same refs and delete rules as plm)
  ----------------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.sample_shipment_item'::regclass
      and conname = 'sample_shipment_item_sample_id_fk_fkey'
      and confrelid = 'dflow.sample'::regclass
      and confdeltype = 'c'  -- ON DELETE CASCADE
  ) then
    raise exception 'sample_id_fk FK to dflow.sample (ON DELETE CASCADE) is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.sample_shipment_item'::regclass
      and conname = 'sample_shipment_item_box_id_fk_fkey'
      and confrelid = 'dflow.sample_box'::regclass
      and confdeltype = 'n'  -- ON DELETE SET NULL
  ) then
    raise exception 'box_id_fk FK to dflow.sample_box (ON DELETE SET NULL) is missing';
  end if;

  ----------------------------------------------------------------------------
  -- Indexes and the uniqueness constraint
  ----------------------------------------------------------------------------
  if not exists (select 1 from pg_indexes
                 where schemaname='dflow' and tablename='sample_shipment_item'
                   and indexname='sample_shipment_item_sample_id_fk_idx')
     or not exists (select 1 from pg_indexes
                 where schemaname='dflow' and tablename='sample_shipment_item'
                   and indexname='sample_shipment_item_box_id_fk_idx') then
    raise exception 'FK-supporting indexes are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.sample_shipment_item'::regclass
      and conname = 'sample_shipment_item_sample_box_uniq'
      and contype = 'u'
  ) then
    raise exception 'UNIQUE(sample_id_fk, box_id_fk) constraint is missing';
  end if;

  ----------------------------------------------------------------------------
  -- Behavioural checks (fixtures roll back)
  ----------------------------------------------------------------------------
  insert into dflow.sample_box (box_label) values ('test-box') returning box_id_pk into v_box;
  insert into dflow.sample (origin, direction, status)
    values ('factory', 'inbound', 'created') returning sample_id_pk into v_sample_a;
  insert into dflow.sample (origin, direction, status)
    values ('factory', 'inbound', 'created') returning sample_id_pk into v_sample_b;

  -- First membership succeeds.
  insert into dflow.sample_shipment_item (sample_id_fk, box_id_fk, leg_type)
    values (v_sample_a, v_box, 'factory_to_ningbo');

  -- Duplicate (same sample + same box) must be rejected by the unique constraint.
  begin
    insert into dflow.sample_shipment_item (sample_id_fk, box_id_fk, leg_type)
      values (v_sample_a, v_box, 'factory_to_nyc');
  exception when unique_violation then
    v_dup_blocked := true;
  end;
  if not v_dup_blocked then
    raise exception 'duplicate (sample_id_fk, box_id_fk) membership was NOT blocked';
  end if;

  -- A membership with a NULL box is allowed (NULLs distinct) and does not
  -- collide even for the same sample -- the app may create a shipment item
  -- before a box is assigned.
  begin
    insert into dflow.sample_shipment_item (sample_id_fk, box_id_fk) values (v_sample_a, null);
    insert into dflow.sample_shipment_item (sample_id_fk, box_id_fk) values (v_sample_a, null);
    v_null_box_ok := true;
  exception when others then
    v_null_box_ok := false;
  end;
  if not v_null_box_ok then
    raise exception 'NULL box_id_fk memberships were unexpectedly rejected';
  end if;

  -- A different sample in the same box is fine.
  insert into dflow.sample_shipment_item (sample_id_fk, box_id_fk, leg_type)
    values (v_sample_b, v_box, 'factory_to_ningbo');

  -- Deleting the sample cascades its memberships (ON DELETE CASCADE).
  delete from dflow.sample where sample_id_pk = v_sample_a;
  if exists (select 1 from dflow.sample_shipment_item where sample_id_fk = v_sample_a) then
    raise exception 'ON DELETE CASCADE from dflow.sample did not remove memberships';
  end if;

  raise notice 'dflow.sample_shipment_item restore + uniqueness: all checks passed';
end $$;

rollback;
