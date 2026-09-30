-- Rolled-back structural contracts for issue #2179 (ColdLion /itemImages metadata).
-- Gate: plan_coldlion_landing_schema_completion.md section 9 Step 6 - grain proof from
-- live sampling, complete owner field disposition (all 14 ingested 2026-09-28),
-- idempotent replay, no unexplained duplicate collapse, and NO image-content column.
begin;

do $$
declare
  v_count integer;
begin
  if to_regclass('coldlion.item_image_metadata') is null then
    raise exception 'missing coldlion.item_image_metadata';
  end if;

  -- No image bytes: the two excluded content fields must never have a column.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'coldlion.item_image_metadata'::regclass
    and a.attnum > 0 and not a.attisdropped
    and (a.attname in ('resource_content','thumbnail128','thumbnail_128','raw')
         or a.atttypid = 'bytea'::regtype);
  if v_count <> 0 then
    raise exception 'item_image_metadata carries an image-content or raw column';
  end if;

  -- Complete field disposition: 14 ingested source fields + 5 provenance columns.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'coldlion.item_image_metadata'::regclass
    and a.attnum > 0 and not a.attisdropped;
  if v_count <> 19 then
    raise exception 'item_image_metadata must carry 14 source + 5 provenance columns, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'coldlion.item_image_metadata'::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname in ('company_code','pkey','resource_id','division_code','item_no',
      'color_code','label_code','file_name','file_type','item_image_desc',
      'created_time','created_user','mod_time','mod_user');
  if v_count <> 14 then
    raise exception 'item_image_metadata is missing an owner-ingested field (found % of 14)', v_count;
  end if;

  -- Grain: the vendor row id, never the colliding item/colour selector or resourceId.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.item_image_metadata'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, pkey)'
  ) then
    raise exception 'item_image_metadata grain is not (company_code, pkey)';
  end if;
  select count(*) into v_count from pg_constraint
  where conrelid = 'coldlion.item_image_metadata'::regclass and contype = 'u';
  if v_count <> 0 then
    raise exception 'item_image_metadata asserts an unproven unique key';
  end if;

  -- Attributable to its pull; no FK out of the landing schema.
  select count(*) into v_count
  from pg_constraint c join pg_class rt on rt.oid = c.confrelid
  join pg_namespace rn on rn.oid = rt.relnamespace
  where c.conrelid = 'coldlion.item_image_metadata'::regclass and c.contype = 'f'
    and (rn.nspname <> 'coldlion' or rt.relname <> 'sync_run');
  if v_count <> 0 then
    raise exception 'item_image_metadata has a foreign key other than coldlion.sync_run';
  end if;

  -- The sync_run FK must exist (zero FKs is not attributable).
  select count(*) into v_count
  from pg_constraint c
  join pg_class rt on rt.oid = c.confrelid
  where c.conrelid = 'coldlion.item_image_metadata'::regclass and c.contype = 'f'
    and rt.relname = 'sync_run';
  if v_count <> 1 then
    raise exception 'item_image_metadata must reference coldlion.sync_run (found %)', v_count;
  end if;
  select count(*) into v_count
  from pg_constraint c
  where c.conrelid = 'coldlion.item_image_metadata'::regclass and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY [(]run_id[)] REFERENCES coldlion[.]sync_run[(]id[)]';
  if v_count <> 1 then
    raise exception 'item_image_metadata sync_run FK is not run_id -> sync_run(id)';
  end if;

  -- Empty-date marker must be storable as NULL; blanks must be storable.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'coldlion.item_image_metadata'::regclass
    and a.attname in ('created_time','mod_time') and a.attnotnull;
  if v_count <> 0 then
    raise exception 'a source timestamp is NOT NULL';
  end if;
  select count(*) into v_count from pg_constraint c
  where c.conrelid = 'coldlion.item_image_metadata'::regclass and c.contype = 'c'
    and (pg_get_constraintdef(c.oid) like '%btrim%' or pg_get_constraintdef(c.oid) like '%EP001%');
  if v_count <> 0 then
    raise exception 'item_image_metadata carries a non-blank or EP001 check';
  end if;

  -- No application role may reach the landing layer.
  select count(*) into v_count
  from unnest(array['anon','authenticated']) g(r)
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(v)
  where has_table_privilege(g.r, 'coldlion.item_image_metadata', p.v);
  if v_count <> 0 then
    raise exception 'item_image_metadata is reachable by an application role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'coldlion.item_image_metadata'::regclass) then
    raise exception 'row level security is not enabled on item_image_metadata';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'coldlion' and tablename = 'item_image_metadata') then
    raise exception 'item_image_metadata has a policy';
  end if;

  if coalesce(obj_description('coldlion.item_image_metadata'::regclass, 'pg_class'), '') not like '%75 rows%' then
    raise exception 'item_image_metadata comment no longer carries the grain proof';
  end if;
end $$;

-- BEHAVIOUR: idempotent replay; the colliding selector must NOT collapse rows.
do $$
declare
  v_run uuid;
begin
  insert into coldlion.sync_run(endpoint, requested_by)
  values ('/itemImages', 'coldlion_item_image_metadata_landing_contracts')
  returning id into v_run;

  -- Two image records sharing item/colour AND resourceId are two rows (census case).
  insert into coldlion.item_image_metadata(
    company_code, pkey, resource_id, division_code, item_no, color_code, label_code,
    file_name, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values
    ('TESTCO', 700001, 55, 'EH001', 'ITEM-1', 'BLK', '', 'a.jpg', v_run, now(), repeat('a',64), now(), now()),
    ('TESTCO', 700002, 55, 'EH001', 'ITEM-1', 'BLK', '', 'b.jpg', v_run, now(), repeat('b',64), now(), now());
  if (select count(*) from coldlion.item_image_metadata where item_no = 'ITEM-1') <> 2 then
    raise exception 'the colliding item/colour selector collapsed two image records';
  end if;

  -- The same record pulled again is an update, not a second row.
  insert into coldlion.item_image_metadata(
    company_code, pkey, item_no, file_name, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 700001, 'ITEM-1', 'a2.jpg', v_run, now(), repeat('c',64), now(), now())
  on conflict (company_code, pkey) do update
    set file_name = excluded.file_name, source_hash = excluded.source_hash,
        last_seen_at = excluded.last_seen_at;
  if (select count(*) from coldlion.item_image_metadata where item_no = 'ITEM-1') <> 2
     or (select file_name from coldlion.item_image_metadata where pkey = 700001 and company_code = 'TESTCO') <> 'a2.jpg' then
    raise exception 'item_image_metadata replay was not idempotent';
  end if;

  -- Same pkey, different company: a different row.
  insert into coldlion.item_image_metadata(
    company_code, pkey, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('OTHERCO', 700001, v_run, now(), repeat('d',64), now(), now());
  if (select count(*) from coldlion.item_image_metadata where pkey = 700001) <> 2 then
    raise exception 'company_code did not separate two tenants on one pkey';
  end if;

  begin
    insert into coldlion.item_image_metadata(
      company_code, pkey, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 700009, v_run, now(), repeat('e',64), now(), now() - interval '1 day');
    raise exception 'accepted last_seen_at before first_seen_at';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.item_image_metadata(
      company_code, pkey, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 700010, v_run, now(), 'not-a-sha256', now(), now());
    raise exception 'accepted a malformed source_hash';
  exception when check_violation then null;
  end;
end $$;

rollback;
