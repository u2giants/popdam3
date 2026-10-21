-- Issue #2358 contract: reversible, hash-pinned canonical licensing merge.
--
-- Covers catalog posture, argument refusal, catalog-discovered dependents, alias and
-- tombstone retention, stale-hash and wrong-hash refusal, conflict refusal through the
-- trial apply, guarded protected writes, rollback, and idempotency in both directions.
-- Every block runs inside a transaction that is rolled back.

-- -------------------------------------------------------------------------------------
-- Block 1: catalog posture, Property merge, Licensor merge, rollback, idempotency.
-- -------------------------------------------------------------------------------------
begin;

insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
select pg_backend_pid(),txid_current(),'core.licensor','canonical_merge',gen_random_uuid(),repeat('a',64),'issue2358-contract',array['name','code','status'],clock_timestamp()+interval '1 minute'
  from generate_series(1,2);
insert into core.licensor(id,name,code,status) values
  ('23580000-0000-0000-0000-00000000000a','ZZ Merge Survivor 2358','ZZ2358S','active'),
  ('23580000-0000-0000-0000-00000000000b','ZZ Merge Duplicate 2358','ZZ2358D','active');
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
select pg_backend_pid(),txid_current(),'core.property','canonical_merge',gen_random_uuid(),repeat('b',64),'issue2358-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute'
  from generate_series(1,3);
insert into core.property(id,licensor_id,name,code,status) values
  ('23580000-0000-0000-0000-0000000000a1','23580000-0000-0000-0000-00000000000a','ZZ2358 Survivor Property','ZZ2358PA','active'),
  ('23580000-0000-0000-0000-0000000000b1','23580000-0000-0000-0000-00000000000b','ZZ2358 Keeper Property','ZZ2358PB1','active'),
  ('23580000-0000-0000-0000-0000000000b2','23580000-0000-0000-0000-00000000000b','ZZ2358 Dup Property','ZZ2358PB2','potential');
insert into core.property_alias(id,property_id,licensor_id,alias,source_system) values
  ('23580000-0000-0000-0000-0000000000c2','23580000-0000-0000-0000-0000000000b2','23580000-0000-0000-0000-00000000000b','ZZ2358 Old Spelling Two','issue2358-contract');

do $contracts$
declare
  c_la constant uuid := '23580000-0000-0000-0000-00000000000a';
  c_lb constant uuid := '23580000-0000-0000-0000-00000000000b';
  c_pb1 constant uuid := '23580000-0000-0000-0000-0000000000b1';
  c_pb2 constant uuid := '23580000-0000-0000-0000-0000000000b2';
  c_alias2 constant uuid := '23580000-0000-0000-0000-0000000000c2';
  v_plan plm.licensing_canonical_change_history%rowtype;
  v_plan2 plm.licensing_canonical_change_history%rowtype;
  v_app plm.licensing_canonical_change_history%rowtype;
  v_app2 plm.licensing_canonical_change_history%rowtype;
  v_rb plm.licensing_canonical_change_history%rowtype;
  v_rb2 plm.licensing_canonical_change_history%rowtype;
  v_t regclass := to_regclass('plm.licensing_canonical_change_history');
  v_count integer;
  v_count2 integer;
  v_text text;
  v_state text;
  v_dep jsonb;
begin
  -- ---------------------------------------------------------------------------------
  -- Catalog posture.
  -- ---------------------------------------------------------------------------------
  if v_t is null then raise exception 'CONTRACT: history table missing'; end if;
  select count(*) into v_count from plm.licensing_canonical_change_history;
  if v_count <> 0 then raise exception 'CONTRACT: history must ship empty, found %', v_count; end if;
  if has_table_privilege('service_role', v_t, 'insert') or has_table_privilege('service_role', v_t, 'update')
     or has_table_privilege('service_role', v_t, 'delete') or has_table_privilege('authenticated', v_t, 'select')
     or has_table_privilege('anon', v_t, 'select') then
    raise exception 'CONTRACT: history must be append-only by privilege and hidden from browser roles';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_t) then
    raise exception 'CONTRACT: history must have RLS enabled';
  end if;
  select count(*) into v_count from pg_proc p
   where p.oid in (to_regprocedure('plm.plan_licensing_canonical_merge(text,uuid,uuid)'),
                   to_regprocedure('plm.apply_licensing_canonical_merge(uuid,text,boolean)'))
     and p.prosecdef and p.proconfig @> array['search_path=pg_catalog'];
  if v_count <> 2 then raise exception 'CONTRACT: both functions must be pinned security definer'; end if;
  if has_function_privilege('authenticated', 'plm.plan_licensing_canonical_merge(text,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'plm.apply_licensing_canonical_merge(uuid,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'plm.apply_licensing_canonical_merge(uuid,text,boolean)', 'execute')
     or not has_function_privilege('service_role', 'plm.apply_licensing_canonical_merge(uuid,text,boolean)', 'execute') then
    raise exception 'CONTRACT: functions must be service-role only';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Argument refusal.
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.plan_licensing_canonical_merge('property', c_pb1, c_pb1);
    raise exception 'CONTRACT: self-merge must be refused';
  exception when sqlstate '22023' then null; end;
  begin
    perform plm.plan_licensing_canonical_merge('franchise', c_pb2, c_pb1);
    raise exception 'CONTRACT: unknown kind must be refused';
  exception when sqlstate '22023' then null; end;
  begin
    perform plm.plan_licensing_canonical_merge('property', gen_random_uuid(), c_pb1);
    raise exception 'CONTRACT: missing entity must be refused';
  exception when sqlstate 'P0002' then null; end;

  -- ---------------------------------------------------------------------------------
  -- Property merge: PB2 -> PB1 (same Licensor).
  -- ---------------------------------------------------------------------------------
  v_plan := plm.plan_licensing_canonical_merge('property', c_pb2, c_pb1);
  if v_plan.plan_status <> 'preview' then
    raise exception 'CONTRACT: clean property merge must preview, got % (%)', v_plan.plan_status, v_plan.refusal_reason;
  end if;
  if v_plan.plan_hash <> encode(extensions.digest(v_plan.body::text, 'sha256'), 'hex') then
    raise exception 'CONTRACT: plan_hash must be sha256 of the stored body';
  end if;
  -- Dependents are discovered from the catalog: the alias FK is present with one row,
  -- and the list covers every FK column that references core.property(id).
  select e into v_dep from jsonb_array_elements(v_plan.body->'dependents') e
   where e->>'table' = 'core.property_alias' and e->>'column' = 'property_id';
  if v_dep is null or jsonb_array_length(v_dep->'rows') <> 1 then
    raise exception 'CONTRACT: core.property_alias.property_id dependent must ledger one row, got %', v_dep;
  end if;
  select count(distinct (c.conrelid, a.attname)) into v_count
    from pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) k(src, dst)
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = k.dst and ra.attname = 'id'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.src
   where c.contype = 'f' and c.confrelid = 'core.property'::regclass;
  if jsonb_array_length(v_plan.body->'dependents') <> v_count then
    raise exception 'CONTRACT: plan must enumerate all % catalog dependents, got %',
      v_count, jsonb_array_length(v_plan.body->'dependents');
  end if;
  if v_plan.body->'alias'->>'action' <> 'insert' then
    raise exception 'CONTRACT: property merge must plan to retain the duplicate name as an alias';
  end if;

  -- Idempotent re-plan.
  v_plan2 := plm.plan_licensing_canonical_merge('property', c_pb2, c_pb1);
  if v_plan2.id <> v_plan.id then raise exception 'CONTRACT: identical re-plan must return the same row'; end if;

  -- Wrong hash.
  begin
    perform plm.apply_licensing_canonical_merge(v_plan.id, repeat('0', 64));
    raise exception 'CONTRACT: wrong hash must be refused';
  exception when sqlstate '40001' then null; end;

  v_app := plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash);
  if v_app.event_kind <> 'merge_applied' or v_app.plan_id <> v_plan.id or v_app.rollback_hash is null then
    raise exception 'CONTRACT: apply must record merge_applied with a rollback hash';
  end if;
  if v_app.rollback_hash <> encode(extensions.digest(v_app.body::text, 'sha256'), 'hex') then
    raise exception 'CONTRACT: rollback_hash must pin the stored rollback plan';
  end if;
  perform 1 from core.property where id = c_pb2 and status = 'archived'
     and metadata->'canonical_merge'->>'merged_into' = c_pb1::text;
  if not found then raise exception 'CONTRACT: duplicate property must be a tombstone, not deleted'; end if;
  perform 1 from core.property_alias where id = c_alias2 and property_id = c_pb1;
  if not found then raise exception 'CONTRACT: duplicate alias must be repointed to the survivor'; end if;
  perform 1 from core.property_alias where property_id = c_pb1 and alias = 'ZZ2358 Dup Property'
     and source_system = 'canonical_merge';
  if not found then raise exception 'CONTRACT: duplicate name must be retained as a survivor alias'; end if;

  -- Idempotent apply.
  select count(*) into v_count from plm.licensing_canonical_change_history;
  v_app2 := plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash);
  select count(*) into v_count2 from plm.licensing_canonical_change_history;
  if v_app2.id <> v_app.id or v_count2 <> v_count then
    raise exception 'CONTRACT: re-applying an applied plan must be a no-op returning the same row';
  end if;

  -- Rollback.
  begin
    perform plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash, true);
    raise exception 'CONTRACT: rollback with the plan hash (not the rollback hash) must be refused';
  exception when sqlstate '40001' then null; end;
  v_rb := plm.apply_licensing_canonical_merge(v_plan.id, v_app.rollback_hash, true);
  if v_rb.event_kind <> 'rollback_applied' or v_rb.plan_id <> v_plan.id then
    raise exception 'CONTRACT: rollback must record rollback_applied';
  end if;
  perform 1 from core.property where id = c_pb2 and status = 'potential' and not (metadata ? 'canonical_merge');
  if not found then raise exception 'CONTRACT: rollback must restore the duplicate exactly'; end if;
  perform 1 from core.property_alias where id = c_alias2 and property_id = c_pb2;
  if not found then raise exception 'CONTRACT: rollback must move the alias back'; end if;
  perform 1 from core.property_alias where property_id = c_pb1 and alias = 'ZZ2358 Dup Property';
  if found then raise exception 'CONTRACT: rollback must remove the alias the merge created'; end if;
  v_rb2 := plm.apply_licensing_canonical_merge(v_plan.id, v_app.rollback_hash, true);
  if v_rb2.id <> v_rb.id then raise exception 'CONTRACT: repeated rollback must be a no-op'; end if;

  -- Re-merging after a rollback is a NEW plan, not the old applied no-op.
  v_plan2 := plm.plan_licensing_canonical_merge('property', c_pb2, c_pb1);
  if v_plan2.id = v_plan.id or v_plan2.plan_status <> 'preview' then
    raise exception 'CONTRACT: post-rollback re-plan must be a fresh preview';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Licensor merge: LB -> LA. core.property.licensor_id is a guarded dependent, and
  -- core.property_alias.licensor_id follows by ON UPDATE CASCADE.
  -- ---------------------------------------------------------------------------------
  v_plan := plm.plan_licensing_canonical_merge('licensor', c_lb, c_la);
  if v_plan.plan_status <> 'preview' then
    raise exception 'CONTRACT: clean licensor merge must preview, got % (%) %', v_plan.plan_status, v_plan.refusal_reason, v_plan.body->'conflicts';
  end if;
  select e into v_dep from jsonb_array_elements(v_plan.body->'dependents') e
   where e->>'table' = 'core.property' and e->>'column' = 'licensor_id';
  if v_dep is null or jsonb_array_length(v_dep->'rows') <> 2 or not (v_dep->>'guarded')::boolean then
    raise exception 'CONTRACT: guarded core.property.licensor_id dependent must ledger two rows';
  end if;
  if (select e->>'table' from jsonb_array_elements(v_plan.body->'dependents') with ordinality x(e, o)
       where jsonb_array_length(e->'rows') > 0 order by o limit 1) <> 'core.property' then
    raise exception 'CONTRACT: composite-FK parent core.property must be repointed first';
  end if;

  -- Stale hash: live state changes after planning.
  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values (pg_backend_pid(),txid_current(),'core.licensor','canonical_merge',gen_random_uuid(),repeat('c',64),'issue2358-contract',array['name'],clock_timestamp()+interval '1 minute');
  update core.licensor set name = 'ZZ Merge Duplicate 2358 renamed' where id = c_lb;
  begin
    perform plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash);
    raise exception 'CONTRACT: stale plan must be refused';
  exception when sqlstate '40001' then
    get stacked diagnostics v_text = message_text;
    if position('stale plan hash' in v_text) = 0 then
      raise exception 'CONTRACT: stale refusal for the wrong reason: %', v_text;
    end if;
  end;
  perform 1 from core.property where id = c_pb1 and licensor_id = c_lb;
  if not found then raise exception 'CONTRACT: a refused apply must write nothing'; end if;

  v_plan := plm.plan_licensing_canonical_merge('licensor', c_lb, c_la);
  v_app := plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash);
  select count(*) into v_count from core.property where licensor_id = c_la and id in (c_pb1, c_pb2);
  if v_count <> 2 then raise exception 'CONTRACT: licensor merge must repoint both properties'; end if;
  perform 1 from core.property_alias where id = c_alias2 and licensor_id = c_la;
  if not found then raise exception 'CONTRACT: property alias licensor must follow the merge'; end if;
  perform 1 from core.licensor where id = c_lb and status = 'archived'
     and metadata->'canonical_merge'->>'merged_into' = c_la::text;
  if not found then raise exception 'CONTRACT: duplicate licensor must be a tombstone'; end if;
  select count(*) into v_count from plm.licensing_write_guard_audit
   where write_kind = 'canonical_merge' and plan_hash = v_plan.plan_hash;
  if v_count <> 3 then
    raise exception 'CONTRACT: two property repoints and one tombstone must pass the guard, got %', v_count;
  end if;

  v_rb := plm.apply_licensing_canonical_merge(v_plan.id, v_app.rollback_hash, true);
  select count(*) into v_count from core.property where licensor_id = c_lb and id in (c_pb1, c_pb2);
  if v_count <> 2 then raise exception 'CONTRACT: licensor rollback must move both properties back'; end if;
  perform 1 from core.property_alias where id = c_alias2 and licensor_id = c_lb;
  if not found then raise exception 'CONTRACT: alias licensor must follow the rollback'; end if;
  perform 1 from core.licensor where id = c_lb and status = 'active' and not (metadata ? 'canonical_merge');
  if not found then raise exception 'CONTRACT: licensor rollback must restore the duplicate'; end if;

  -- ---------------------------------------------------------------------------------
  -- Append-only by privilege.
  -- ---------------------------------------------------------------------------------
  set local role service_role;
  begin
    update plm.licensing_canonical_change_history set recorded_by = 'x';
    raise exception 'CONTRACT: service_role must not update history';
  exception when insufficient_privilege then null; end;
  begin
    delete from plm.licensing_canonical_change_history;
    raise exception 'CONTRACT: service_role must not delete history';
  exception when insufficient_privilege then null; end;
  reset role;

  raise notice 'issue #2358 canonical merge contracts (block 1) PASS';
end
$contracts$;

rollback;


-- -------------------------------------------------------------------------------------
-- Block 2: conflict refusal.
-- -------------------------------------------------------------------------------------
begin;

insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
select pg_backend_pid(),txid_current(),'core.licensor','canonical_merge',gen_random_uuid(),repeat('a',64),'issue2358-contract',array['name','code','status'],clock_timestamp()+interval '1 minute'
  from generate_series(1,3);
insert into core.licensor(id,name,code,status) values
  ('23580000-0000-0000-0000-00000000001a','ZZ Merge Survivor 2358 C','ZZ2358SC','active'),
  ('23580000-0000-0000-0000-00000000001b','ZZ Merge Duplicate 2358 C','ZZ2358DC','active'),
  ('23580000-0000-0000-0000-00000000001c','ZZ Merge Archived 2358 C','ZZ2358XC','archived');
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
select pg_backend_pid(),txid_current(),'core.property','canonical_merge',gen_random_uuid(),repeat('b',64),'issue2358-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute'
  from generate_series(1,2);
-- Same Property code under both Licensors: repointing collides on (licensor_id, code).
insert into core.property(id,licensor_id,name,code,status) values
  ('23580000-0000-0000-0000-0000000001a1','23580000-0000-0000-0000-00000000001a','ZZ2358 Collide A','ZZ2358COL','active'),
  ('23580000-0000-0000-0000-0000000001b1','23580000-0000-0000-0000-00000000001b','ZZ2358 Collide B','ZZ2358COL','active');

do $conflicts$
declare
  v_plan plm.licensing_canonical_change_history%rowtype;
begin
  v_plan := plm.plan_licensing_canonical_merge('licensor',
    '23580000-0000-0000-0000-00000000001b', '23580000-0000-0000-0000-00000000001a');
  if v_plan.plan_status <> 'refused'
     or not exists (select 1 from jsonb_array_elements(v_plan.body->'conflicts') c
                     where c->>'code' = 'trial_apply_refused'
                       and c->>'constraint' = 'property_licensor_id_code_key') then
    raise exception 'CONTRACT: unique collision on a dependent must refuse the plan, got % %',
      v_plan.plan_status, v_plan.body->'conflicts';
  end if;
  begin
    perform plm.apply_licensing_canonical_merge(v_plan.id, v_plan.plan_hash);
    raise exception 'CONTRACT: a refused plan must not apply';
  exception when sqlstate '40001' then null; end;
  perform 1 from core.property where id = '23580000-0000-0000-0000-0000000001b1'
     and licensor_id = '23580000-0000-0000-0000-00000000001b';
  if not found then raise exception 'CONTRACT: the trial apply must leave no trace'; end if;

  v_plan := plm.plan_licensing_canonical_merge('licensor',
    '23580000-0000-0000-0000-00000000001b', '23580000-0000-0000-0000-00000000001c');
  if v_plan.plan_status <> 'refused' or position('survivor_not_live' in v_plan.refusal_reason) = 0 then
    raise exception 'CONTRACT: an archived survivor must refuse the plan';
  end if;

  v_plan := plm.plan_licensing_canonical_merge('property',
    '23580000-0000-0000-0000-0000000001b1', '23580000-0000-0000-0000-0000000001a1');
  if v_plan.plan_status <> 'refused' or position('cross_licensor_property_merge' in v_plan.refusal_reason) = 0 then
    raise exception 'CONTRACT: a cross-licensor property merge must be refused';
  end if;

  raise notice 'issue #2358 canonical merge contracts (block 2) PASS';
end
$conflicts$;

rollback;
