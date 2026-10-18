-- Issue #2336 contract: hash-pinned licensing consolidation engine.
--
-- Behaviour covers real native NBCU/Paramount/OPA source qualification, physical
-- provenance/support, protected spelling/old aliases, exact retry and conditional
-- support inverse. Current landing constraints and immutable guards remain intact.
-- Catalog assertions complement those row-level regressions.

begin;

do $contracts$
declare
  v_plan plm.licensing_consolidation_plan%rowtype;
  v_plan2 plm.licensing_consolidation_plan%rowtype;
  v_plan_first_id uuid;
  v_plan_first_hash text;
  v_applied plm.licensing_consolidation_plan%rowtype;
  v_count integer;
  v_bool boolean;
  v_text text;
  v_sqlstate text;
  v_capture uuid := gen_random_uuid();
  v_capture2 uuid := gen_random_uuid();
  v_licensor uuid;
  v_property uuid;
  v_auth_id uuid;
  t text;
begin
  -- ---------------------------------------------------------------------------------
  -- Shape: the plan table exists and is EMPTY. #2336 authorizes no plan rows, so a
  -- populated table here means data reached a public repository or an unauthorized
  -- load ran.
  -- ---------------------------------------------------------------------------------
  if to_regclass('plm.licensing_consolidation_plan') is null then
    raise exception 'CONTRACT: plm.licensing_consolidation_plan does not exist';
  end if;
  select count(*) into v_count from plm.licensing_consolidation_plan;
  if v_count <> 0 then
    raise exception 'CONTRACT: plm.licensing_consolidation_plan must ship empty, found % row(s)', v_count;
  end if;

  -- Fail closed: no client role may write the plan table.
  if has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'insert')
     or has_table_privilege('service_role', to_regclass('plm.licensing_consolidation_plan'), 'insert')
     or has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'update')
     or has_table_privilege('service_role', to_regclass('plm.licensing_consolidation_plan'), 'delete') then
    raise exception 'CONTRACT: plm.licensing_consolidation_plan must have no write grant for any client role';
  end if;
  if not has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'select') then
    raise exception 'CONTRACT: authenticated must be able to read plm.licensing_consolidation_plan';
  end if;
  if has_table_privilege('anon', to_regclass('plm.licensing_consolidation_plan'), 'select') then
    raise exception 'CONTRACT: anon must not be able to read plm.licensing_consolidation_plan';
  end if;

  -- RLS on.
  select c.relrowsecurity into v_bool
    from pg_catalog.pg_class c
   where c.oid = to_regclass('plm.licensing_consolidation_plan');
  if not coalesce(v_bool, false) then
    raise exception 'CONTRACT: plm.licensing_consolidation_plan must have RLS enabled';
  end if;

  -- Both functions are pinned SECURITY DEFINER and service-role only.
  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (
           to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'),
           to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'))
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog'];
  if v_count <> 2 then
    raise exception 'CONTRACT: both consolidation functions must be security definer with pinned search_path (found %)', v_count;
  end if;
  if has_function_privilege('anon',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or has_function_privilege('authenticated',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or has_function_privilege('anon',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute')
     or has_function_privilege('authenticated',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute') then
    raise exception 'CONTRACT: anon and authenticated must not execute the consolidation functions';
  end if;
  if not has_function_privilege('service_role',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or not has_function_privilege('service_role',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute') then
    raise exception 'CONTRACT: service_role must be able to execute the consolidation functions';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Immutability: content columns cannot change, DELETE is refused, and the apply
  -- lifecycle is the only mutable surface.
  -- ---------------------------------------------------------------------------------
  -- The trigger exists.
  select count(*) into v_count
    from pg_catalog.pg_trigger t
   where t.tgrelid = to_regclass('plm.licensing_consolidation_plan')
     and t.tgname = 'licensing_consolidation_plan_immutable_trg'
     and not t.tgisinternal;
  if v_count <> 1 then
    raise exception 'CONTRACT: the plan immutability trigger is missing';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Complete-capture gate: an unknown / missing capture produces a REFUSED plan with
  -- a recorded reason, never a silent empty preview and never an applyable plan.
  -- ---------------------------------------------------------------------------------
  -- Blank p_entity_source_id is refused (not an empty preview).
  begin
    perform plm.plan_licensing_consolidation('not_a_real_source', v_capture, '   ');
    raise exception 'CONTRACT: blank p_entity_source_id must be refused';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('p_entity_source_id must be null or a non-blank source id' in v_text) = 0 then
      raise exception 'CONTRACT: blank filter failed for the wrong reason: %', v_text;
    end if;
  end;

  -- Unknown source system: refused.
  v_plan := plm.plan_licensing_consolidation('not_a_real_source', v_capture);
  v_plan_first_id := v_plan.id;
  v_plan_first_hash := v_plan.plan_hash;
  if v_plan.plan_status <> 'refused' or v_plan.plan_schema_version<>1 then
    raise exception 'CONTRACT: unknown source_system must produce a refused plan, got %', v_plan.plan_status;
  end if;
  if v_plan.refusal_reason is null
     or position('complete-capture gate refused: capture is missing, not complete, or its source root is unknown' in v_plan.refusal_reason) = 0 then
    raise exception 'CONTRACT: refused plan must record the complete-capture gate, got %', v_plan.refusal_reason;
  end if;
  if v_plan.capture_complete then
    raise exception 'CONTRACT: refused plan must record capture_complete = false';
  end if;
  if v_plan.operations <> '[]'::jsonb then
    raise exception 'CONTRACT: refused plan must carry no operations';
  end if;

  -- Known source, capture that does not exist: refused (null check inside the gate
  -- treats a missing row as not complete).
  v_plan := plm.plan_licensing_consolidation('paramount', v_capture);
  if v_plan.plan_status <> 'refused' or v_plan.plan_schema_version<>2 then
    raise exception 'CONTRACT: missing paramount capture must produce a refused plan, got %', v_plan.plan_status;
  end if;

  -- ---------------------------------------------------------------------------------
  -- Every enhanced source stays schema2 when its capture qualification fails; no legacy fallback.
  foreach t in array array['paramount','nbcu','disney_opa'] loop
    v_plan2:=plm.plan_licensing_consolidation(' '||t||' ',gen_random_uuid());
    if v_plan2.plan_schema_version<>2 or v_plan2.plan_status<>'refused' then raise exception 'enhanced qualification fell back to legacy for %',t;end if;
  end loop;
  -- Apply refuses a refused plan.
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.apply_licensing_consolidation(v_plan.id, v_plan.plan_hash);
    raise exception 'CONTRACT: apply of a refused plan must fail';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('qualified bounded preview plan required' in v_text) = 0
       and position('cannot be applied' in v_text) = 0 then
      raise exception 'CONTRACT: apply of a refused plan failed for the wrong reason: %', v_text;
    end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- Apply refuses a wrong or malformed expected hash (conflict refusal).
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.apply_licensing_consolidation(v_plan.id, repeat('0', 64));
    raise exception 'CONTRACT: apply with a wrong expected_hash must fail';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('exact schema2 plan hash required' in v_text) = 0 then
      raise exception 'CONTRACT: wrong-hash apply failed for the wrong reason: %', v_text;
    end if;
  end;

  begin
    perform plm.apply_licensing_consolidation(v_plan.id, 'not-a-hash');
    raise exception 'CONTRACT: apply with a malformed expected_hash must fail';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('exact schema2 plan hash required' in v_text) = 0 then
      raise exception 'CONTRACT: malformed-hash apply failed for the wrong reason: %', v_text;
    end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- Immutability, exercised on a real refused plan row (the only row kind we can
  -- create without capture fixtures).
  -- ---------------------------------------------------------------------------------
  begin
    update plm.licensing_consolidation_plan
       set operations = '[{"op":"update_entity"}]'::jsonb
     where id = v_plan.id;
    raise exception 'CONTRACT: plan content must be immutable';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('immutable' in v_text) = 0 then
      raise exception 'CONTRACT: content update refused for the wrong reason: %', v_text;
    end if;
  end;

  begin
    update plm.licensing_consolidation_plan
       set plan_hash = repeat('a', 64)
     where id = v_plan.id;
    raise exception 'CONTRACT: plan_hash must be immutable';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('immutable' in v_text) = 0 then
      raise exception 'CONTRACT: hash update refused for the wrong reason: %', v_text;
    end if;
  end;

  begin
    delete from plm.licensing_consolidation_plan where id = v_plan.id;
    raise exception 'CONTRACT: plan rows must never be deletable';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('cannot be deleted' in v_text) = 0
       and position('immutable' in v_text) = 0 then
      raise exception 'CONTRACT: delete refused for the wrong reason: %', v_text;
    end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- Idempotent planning: the same (source, capture, hash) returns the same row.
  -- Two refused plans over the same unknown source and same capture share a hash and
  -- therefore share a row. (v_plan was overwritten above by the paramount probe, so
  -- the first plan's identity is carried in v_plan_first_id / v_plan_first_hash.)
  -- ---------------------------------------------------------------------------------
  v_plan2 := plm.plan_licensing_consolidation('not_a_real_source', v_capture);
  if v_plan2.id is distinct from v_plan_first_id then
    raise exception 'CONTRACT: re-planning identical refused input must return the same plan row';
  end if;
  if v_plan2.plan_hash <> v_plan_first_hash then
    raise exception 'CONTRACT: identical refused input must produce an identical plan hash';
  end if;

  -- Different capture, same unknown source: a different plan (capture is identity).
  v_plan2 := plm.plan_licensing_consolidation('not_a_real_source', v_capture2);
  if v_plan2.id = v_plan_first_id then
    raise exception 'CONTRACT: a different capture_id must produce a different plan';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Hash shape is pinned to 64 lowercase hex.
  -- ---------------------------------------------------------------------------------
  if v_plan.plan_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'CONTRACT: plan_hash must be 64 lowercase hex, got %', v_plan.plan_hash;
  end if;

  -- ---------------------------------------------------------------------------------
  -- Write-authorization vocabulary: scrape_consolidation is a kind the Step 1.0 guard
  -- already understands, and the consolidation engine never invents a new kind. Proved
  -- by catalog, not by writing a protected row (that is the guard's own contract).
  -- ---------------------------------------------------------------------------------
  select count(*) into v_count
    from pg_catalog.pg_constraint
   where conrelid = to_regclass('plm.licensing_write_authorization')
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%scrape_consolidation%';
  if v_count < 1 then
    raise exception 'CONTRACT: scrape_consolidation must remain an allowed write_kind on the Step 1.0 guard';
  end if;

  -- The operation vocabulary has no DELETE. The plan function body must never mention
  -- a delete of a canonical entity; asserted on the routine source so a future edit
  -- cannot quietly introduce one.
  select prosrc into v_text
    from pg_catalog.pg_proc
   where oid = to_regprocedure('plm.apply_licensing_consolidation(uuid,text)');
  if position('delete from core.' in lower(v_text)) > 0
     or position('delete from plm.licensing' in lower(v_text)) > 0 then
    raise exception 'CONTRACT: apply must never hard-delete canonical or licensing rows';
  end if;

  -- Engine-private helpers are unreachable by every client, including service.
  foreach t in array array['plm.licensing_consolidation_operation_state(jsonb)','plm.apply_licensing_support_operation(uuid,text,jsonb)'] loop
    if to_regprocedure(t) is null then raise exception 'CONTRACT: private helper missing %',t;end if;
    if has_function_privilege('anon',to_regprocedure(t),'execute') or has_function_privilege('authenticated',to_regprocedure(t),'execute') or has_function_privilege('service_role',to_regprocedure(t),'execute') then raise exception 'CONTRACT: private operation capability exposed %',t;end if;
  end loop;
  if not has_function_privilege('service_role',to_regprocedure('plm.licensing_consolidation_capture_snapshot(text,uuid)'),'execute') or has_function_privilege('authenticated',to_regprocedure('plm.licensing_consolidation_capture_snapshot(text,uuid)'),'execute') then raise exception 'CONTRACT: qualified capture privilege mismatch';end if;
  -- ---------------------------------------------------------------------------------
  -- The engine writes protected canonical columns only through scrape_consolidation.
  -- The create rule (new Property = potential) is pinned by the Step 1.0 guard for
  -- this write_kind; assert the guard still refuses a non-potential create under it.
  -- (No row is written here: we assert the constraint text, which is the enforcement
  -- of record.)
  -- ---------------------------------------------------------------------------------
  select count(*) into v_count
    from pg_catalog.pg_proc
   where oid = to_regprocedure('app.enforce_licensing_write_authority()')
     and prosrc like '%scrape_consolidation%'
     and prosrc like '%potential%';
  if v_count < 1 then
    raise exception 'CONTRACT: the Step 1.0 guard must still pin scrape_consolidation creates to potential';
  end if;

  -- Physical checks reject malformed new plan facts on INSERT, independently of immutable UPDATE guards.
  foreach t in array array['plan_schema_version','capture_snapshot','applied_state'] loop
    begin
      insert into plm.licensing_consolidation_plan
      select (jsonb_populate_record(null::plm.licensing_consolidation_plan,to_jsonb(v_plan)||jsonb_build_object('id',gen_random_uuid(),'plan_hash',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'))||case t when 'plan_schema_version' then jsonb_build_object(t,3) else jsonb_build_object(t,'[]'::jsonb) end)).*;
      raise exception 'CONTRACT: malformed plan fact accepted: %',t;
    exception when check_violation then
      get stacked diagnostics v_text=constraint_name;
      if v_text is distinct from (case t when 'plan_schema_version' then 'licensing_consolidation_plan_schema_version_chk' else 'licensing_consolidation_plan_'||t||'_chk' end) then raise exception 'CONTRACT: wrong physical check rejected %: %',t,v_text;end if;
    end;
  end loop;
  raise notice 'hash-pinned licensing consolidation contracts verified';
end;
$contracts$;

rollback;

-- Current native physical planner/apply/inverse regressions; each fixture rolls back.
begin;
-- Invented current-native fixtures use the real protected-column authorizations.
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'issue2336-native-contract',array['name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.licensor(id,name,code,status) values('23360000-0000-0000-0000-000000000001','ZZ Native Contract2336','ZZ2336N','active');
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'issue2336-native-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.property(id,licensor_id,name,code,status) values('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000001','Synthetic original','ZZ2336NP','potential');
insert into core.character(id,licensor_id,name) values('23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000001','Synthetic canonical character');
insert into core.style_guide(id,licensor_id,name,property_id) values('23360000-0000-0000-0000-000000000005','23360000-0000-0000-0000-000000000001','Synthetic guide','23360000-0000-0000-0000-000000000002');
insert into plm.pmt_capture(capture_id,status,capture_kind,source_system,source_url,library_name,started_at,completed_at,captured_by,private_source_commit,manifest_sha256,portal_global_asset_count,licensed_title_count,licensed_property_selection_count,property_result_row_count,unique_asset_count,metadata_batch_count,validated_at,validation_passed)
 values('23360000-0000-0000-0000-000000000020','complete','full','paramount_creative_library','https://fixture.invalid','Synthetic test','2026-10-10 12:00Z','2026-10-10 12:01Z','issue2336-test',repeat('a',40),repeat('b',64),0,1,1,1,0,0,now(),true);
insert into plm.pmt_authorized_title(capture_id,authorized_title_key,authorized_title_name,capture_status,unique_asset_count,full_metadata_count,source_hash) values('23360000-0000-0000-0000-000000000020','title','Synthetic title','captured',0,0,repeat('c',64));
insert into plm.pmt_property(capture_id,property_source_id,property_name,is_licensed_selection,source_hash) values('23360000-0000-0000-0000-000000000020','0007','Synthetic original',true,repeat('d',64));
insert into plm.pmt_character(capture_id,character_source_id,character_name,source_hash) values('23360000-0000-0000-0000-000000000020','0008','Synthetic native character',repeat('e',64));
insert into plm.pmt_collection(capture_id,collection_source_id,collection_name,source_hash) values('23360000-0000-0000-0000-000000000020','0009','Synthetic native collection',repeat('f',64));
insert into plm.pmt_authorized_title_property(capture_id,authorized_title_key,property_source_id,mapping_status,source_evidence,paramount_property_name,source_hash) values('23360000-0000-0000-0000-000000000020','title','0007','mapped','exact_property_selection','Synthetic original',repeat('1',64));
insert into plm.pmt_property_character(capture_id,property_source_id,character_source_id,source_evidence,source_hash) values('23360000-0000-0000-0000-000000000020','0007','0008','explicit_cascading_pair',repeat('2',64));
insert into plm.pmt_property_collection(capture_id,property_source_id,collection_source_id,source_evidence,source_hash) values('23360000-0000-0000-0000-000000000020','0007','0009','explicit_cascading_pair',repeat('2',64));
insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values('paramount','property','0007','23360000-0000-0000-0000-000000000002','matched');
insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status) values('paramount','character','0008','23360000-0000-0000-0000-000000000004','matched');
insert into plm.source_resolution(source_system,entity_kind,source_id,core_style_guide_id,resolution_status) values('paramount','style_guide','0009','23360000-0000-0000-0000-000000000005','matched');
insert into plm.licensing_source_scope values('23360000-0000-0000-0000-000000000001','paramount','canonical_identity','entity','property',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','paramount','canonical_identity','entity','character',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','paramount','canonical_identity','entity','style_guide',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','paramount','relationship_evidence','relationship','property_character',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','paramount','relationship_evidence','relationship','property_style_guide',now(),'synthetic test');
do $test$ declare p plm.licensing_consolidation_plan;q plm.licensing_consolidation_plan;r plm.licensing_consolidation_plan;rejected boolean:=false;native_capture uuid;native_table text;phase integer;pair_id uuid;pair_created timestamptz;baseline jsonb;m1_capture_time timestamptz;m1_seen timestamptz;m1_expected_seen timestamptz;m1_tid tid;m1_op jsonb;m1_state jsonb;m1_text text;m1_source_table text;m1_source_id text;begin
 -- M1 regression: an old, complete native capture inserts exact source timestamps;
 -- its inverse retires without refreshing last_seen_at; a filtered plan of that same
 -- capture reactivates the existing row and the real timestamp trigger may advance
 -- last_seen_at to transaction_timestamp(). The applied audit must reflect that exact
 -- trigger result without changing first_seen_at or any other planned source field.
 -- This nested block rolls its full synthetic lifecycle back before later fixtures.
 begin
  select completed_at into m1_capture_time from plm.pmt_capture where capture_id='23360000-0000-0000-0000-000000000020';
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');
  if p.plan_status<>'preview' then raise exception 'M1 original native capture did not produce a preview';end if;
  select count(*),(array_agg(value))[1] into phase,m1_op from jsonb_array_elements(p.operations) where value->>'kind'='entity_source' and value->>'entity_kind'='property'
   and value->'owners' @> '[{"table":"core.property","id":"23360000-0000-0000-0000-000000000002"}]'::jsonb;
  if phase<>1 or m1_op->'before'->'rows' is distinct from '[]'::jsonb then raise exception 'M1 original plan must contain exactly one true-insert property source operation';end if;
  m1_source_table:=m1_op->'identity'->>'source_table';m1_source_id:=m1_op->'identity'->>'source_id';
  if m1_source_table is null or m1_source_id is null then raise exception 'M1 property source operation lacks its full planner identity';end if;
  q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  select last_seen_at into m1_seen from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  if q.plan_status<>'applied' or m1_seen is distinct from m1_capture_time then raise exception 'M1 insert path changed the native capture timestamp';end if;

  r:=plm.plan_licensing_consolidation_rollback(q.id,encode(extensions.digest(q.applied_state::text,'sha256'),'hex'));
  r:=plm.apply_licensing_consolidation(r.id,r.plan_hash);
  select last_seen_at into m1_seen from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  if r.plan_status<>'applied' or not exists(select 1 from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id and missing_since is not null)
     or m1_seen is distinct from m1_capture_time then raise exception 'M1 retirement path changed the source timestamp';end if;

  -- A metadata-only correction is outside the actual UPDATE OF trigger columns.
  update core.taxonomy_source_ref set source_name='Synthetic original metadata correction'
   where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  select last_seen_at into m1_seen from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  if m1_seen is distinct from m1_capture_time then raise exception 'M1 non-trigger metadata update changed last_seen_at';end if;

  -- The same capture and selected entity now exercise an existing-row UPDATE. Each
  -- hostile source fact is changed under the real table/apply guards and must refuse
  -- before the planned operation can write; the exception block rolls that tamper back.
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020','0007');
  if p.plan_status<>'preview' then raise exception 'M1 filtered same-capture replan did not produce a preview';end if;

  begin
   update core.taxonomy_source_ref set source_name='malicious source name'
    where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
   perform plm.apply_licensing_consolidation(p.id,p.plan_hash);
   raise exception 'source_name tamper unexpectedly applied';
  exception when serialization_failure then null;end;
  begin
   update core.taxonomy_source_ref set raw=raw||jsonb_build_object('malicious_native_provenance',true)
    where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
   perform plm.apply_licensing_consolidation(p.id,p.plan_hash);
   raise exception 'raw tamper unexpectedly applied';
  exception when serialization_failure then null;end;
  begin
   update core.taxonomy_source_ref set source_id=m1_source_id||'-malicious-identity'
    where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
   perform plm.apply_licensing_consolidation(p.id,p.plan_hash);
   raise exception 'identity tamper unexpectedly applied';
  exception when serialization_failure then null;end;
  begin
   update core.taxonomy_source_ref set last_seen_at=m1_capture_time+interval '1 second'
    where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
   perform plm.apply_licensing_consolidation(p.id,p.plan_hash);
   raise exception 'timestamp tamper unexpectedly applied';
  exception when serialization_failure then null;end;

  m1_expected_seen:=greatest(m1_capture_time,transaction_timestamp());
  select value into m1_op from jsonb_array_elements(p.operations) where value->>'kind'='entity_source' and value->'identity'->>'source_table'=m1_source_table and value->'identity'->>'source_id'=m1_source_id;
  if m1_op is null then raise exception 'M1 filtered plan lost the exact property source operation';end if;
  q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  select last_seen_at into m1_seen from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  select value->'state' into m1_state from jsonb_array_elements(q.applied_state->'operations') where value->>'op_key'=m1_op->>'op_key';
  if q.plan_status<>'applied' or m1_seen is distinct from m1_expected_seen
     or (m1_state->'rows'->0->>'last_seen_at')::timestamptz is distinct from m1_expected_seen
     or (m1_state->'rows'->0->>'first_seen_at')::timestamptz is distinct from m1_capture_time
     or m1_state->'rows'->0->>'source_name' is distinct from m1_op->'after'->>'source_name'
     or m1_state->'rows'->0->'raw' is distinct from m1_op->'after'->'raw' then
    raise exception 'M1 exact trigger timestamp or non-timestamp source fields differ from the guarded plan';
  end if;

  -- A true retry of the just-applied filtered plan must return its immutable audit
  -- before running another UPDATE. The ctid check detects even a same-transaction
  -- rewrite, for which transaction_timestamp() itself would not advance.
  select ctid into m1_tid from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  r:=plm.apply_licensing_consolidation(q.id,q.plan_hash);
  select last_seen_at into m1_seen from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id;
  if not exists(select 1 from core.taxonomy_source_ref where source_system='paramount' and source_table=m1_source_table and source_id=m1_source_id and ctid=m1_tid) then raise exception 'M1 second-apply no-op rewrote the source row';end if;
  if r.applied_state is distinct from q.applied_state or r.entity_operation_count is distinct from q.entity_operation_count
     or m1_seen is distinct from m1_expected_seen then raise exception 'M1 exact second-apply no-op changed state, count, or timestamp';end if;
  raise notice 'M1 same-capture apply/rollback/filtered replan/apply retry, trigger-only timestamp, insert/retirement/non-trigger and tamper guards PASS';
  raise exception using errcode='Z2336',message='roll back isolated M1 timestamp regression fixture';
 exception when sqlstate 'Z2336' then null;end;

 -- Native output boundary: 505 additional matched characters plus seven base
 -- operations makes exactly512. One further result refuses the entire plan;
 -- input qualification is unchanged and no actual consolidation is performed.
 begin
  insert into core.character(id,licensor_id,name)
   select md5('ZZ2336-output-bound-'||n)::uuid,'23360000-0000-0000-0000-000000000001','ZZ2336 output bound '||n from generate_series(1,505) n;
  insert into plm.pmt_character(capture_id,character_source_id,character_name,source_hash)
   select '23360000-0000-0000-0000-000000000020',(900000+n)::text,'ZZ2336 output bound '||n,repeat('e',64) from generate_series(1,505) n;
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status)
   select 'paramount','character',(900000+n)::text,md5('ZZ2336-output-bound-'||n)::uuid,'matched' from generate_series(1,505) n;
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');
  if p.plan_status<>'preview' or jsonb_array_length(p.operations)<>512 then raise exception 'exact512 output boundary lost';end if;
  insert into core.character(id,licensor_id,name) values(md5('ZZ2336-output-bound-506')::uuid,'23360000-0000-0000-0000-000000000001','ZZ2336 output bound 506');
  insert into plm.pmt_character(capture_id,character_source_id,character_name,source_hash) values('23360000-0000-0000-0000-000000000020','900506','ZZ2336 output bound 506',repeat('e',64));
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status) values('paramount','character','900506',md5('ZZ2336-output-bound-506')::uuid,'matched');
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');
  if p.plan_status<>'refused' or p.refusal_reason<>'consolidation whole plan exceeds512operations'
   or not p.capture_complete or not p.source_scope_checked or p.operations<>'[]'::jsonb or p.rollback_operations<>'[]'::jsonb
   or p.capture_snapshot->'capture_complete'<>'true'::jsonb or p.capture_snapshot->'source_scope_checked'<>'true'::jsonb
   or exists(select 1 from core.taxonomy_source_ref where source_system='paramount') then raise exception '513 output refusal partialwrites or gate facts';end if;
  raise notice 'Native512 preview/513 whole-output refusal, zero writes and truthful qualified gates PASS';
  raise exception using errcode='Z2336',message='roll back native output boundary fixture';
 exception when sqlstate 'Z2336' then null;end;
 begin
  delete from plm.licensing_source_scope where source_system='paramount' and scope_axis='entity' and permitted_kind='character';
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');
  if p.plan_status<>'refused' or not p.capture_complete or p.source_scope_checked or p.operations<>'[]'::jsonb then raise exception 'qualified capture/missing authority facts false';end if;
  raise notice 'Complete capture with missing current authority records true/false gate facts PASS';
  raise exception using errcode='Z2336',message='roll back native missing authority fixture';
 exception when sqlstate 'Z2336' then null;end;
 -- Scoped licensing validation must not fire or retime unrelated caller constraints.
 begin
  create temporary table issue2336_unrelated_deferred(k integer,
   constraint issue2336_unrelated_deferred_uq unique(k) deferrable initially deferred) on commit drop;
  insert into issue2336_unrelated_deferred values(1),(1);
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  if q.plan_status<>'applied' then raise exception 'scoped licensing postvalidation lost';end if;
  delete from issue2336_unrelated_deferred where ctid=(select ctid from issue2336_unrelated_deferred limit 1);
  set constraints pg_temp.issue2336_unrelated_deferred_uq immediate;
  raise notice 'Unrelated deferred caller constraint was not prematurely fired PASS';
  raise exception using errcode='Z2336',message='roll back isolated deferred-mode fixture';
 exception when sqlstate 'Z2336' then null;end;
 begin
  create temporary table issue2336_unrelated_immediate(k integer,
   constraint issue2336_unrelated_immediate_uq unique(k) deferrable initially immediate) on commit drop;
  insert into issue2336_unrelated_immediate values(1);
  p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  rejected:=false;begin insert into issue2336_unrelated_immediate values(1);exception when unique_violation then rejected:=true;end;
  if not rejected then raise exception 'unrelated immediate caller constraint was deferred';end if;
  raise notice 'Unrelated immediate caller constraint remains immediate PASS';
  raise exception using errcode='Z2336',message='roll back isolated immediate-mode fixture';
 exception when sqlstate 'Z2336' then null;end;
 -- A real two-rename qualified capture must refuse during planning, while
 -- its explicit filtered plans remain usable under the unchanged single-use key.
 begin
  native_capture:=gen_random_uuid();
  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
   values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'issue2336-two-renames',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.property(id,licensor_id,name,code,status) values('23360000-0000-0000-0000-000000000003','23360000-0000-0000-0000-000000000001','Second old official','ZZ2336N2','potential');
  insert into plm.pmt_capture select (jsonb_populate_record(null::plm.pmt_capture,to_jsonb(c)||jsonb_build_object('capture_id',native_capture,'started_at','2026-10-10 13:00Z'::timestamptz,'completed_at','2026-10-10 13:01Z'::timestamptz,'licensed_property_selection_count',2,'property_result_row_count',2))).* from plm.pmt_capture c where capture_id='23360000-0000-0000-0000-000000000020';
  foreach native_table in array array['pmt_authorized_title','pmt_character','pmt_collection'] loop
   execute format('insert into plm.%I select (jsonb_populate_record(null::plm.%I,to_jsonb(t)||jsonb_build_object(''capture_id'',$1))).* from plm.%I t where capture_id=$2',native_table,native_table,native_table) using native_capture,'23360000-0000-0000-0000-000000000020'::uuid;
  end loop;
  insert into plm.pmt_property select (jsonb_populate_record(null::plm.pmt_property,to_jsonb(t)||jsonb_build_object('capture_id',native_capture,'property_name','First new official'))).* from plm.pmt_property t where capture_id='23360000-0000-0000-0000-000000000020';
  insert into plm.pmt_property(capture_id,property_source_id,property_name,is_licensed_selection,source_hash) values(native_capture,'0010','Second new official',true,repeat('d',64));
  insert into plm.pmt_authorized_title_property select (jsonb_populate_record(null::plm.pmt_authorized_title_property,to_jsonb(t)||jsonb_build_object('capture_id',native_capture,'paramount_property_name','First new official'))).* from plm.pmt_authorized_title_property t where capture_id='23360000-0000-0000-0000-000000000020';
  insert into plm.pmt_authorized_title_property(capture_id,authorized_title_key,property_source_id,mapping_status,source_evidence,paramount_property_name,source_hash) values(native_capture,'title','0010','mapped','exact_property_selection','Second new official',repeat('1',64));
  foreach native_table in array array['pmt_property_collection','pmt_property_character'] loop
   execute format('insert into plm.%I select (jsonb_populate_record(null::plm.%I,to_jsonb(t)||jsonb_build_object(''capture_id'',$1))).* from plm.%I t where capture_id=$2',native_table,native_table,native_table) using native_capture,'23360000-0000-0000-0000-000000000020'::uuid;
  end loop;
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values('paramount','property','0010','23360000-0000-0000-0000-000000000003','matched');
  p:=plm.plan_licensing_consolidation('paramount',native_capture);
  if p.plan_status<>'refused' or not p.capture_complete or p.source_scope_checked or p.refusal_reason not like '%more than one property rename%' or p.operations<>'[]'::jsonb
     or exists(select 1 from core.taxonomy_source_ref where source_system='paramount') then raise exception 'two-rename capture emitted an unapplyable or partially written preview';end if;
  perform set_config('TimeZone','America/New_York',true);
  p:=plm.plan_licensing_consolidation('paramount',native_capture,'0007');
  perform set_config('TimeZone','UTC',true);
  r:=plm.plan_licensing_consolidation('paramount',native_capture,'0007');
  if p.plan_status<>'preview' or p.id<>r.id or p.plan_hash<>r.plan_hash then raise exception 'filtered plan or cross-timezone identity lost';end if;
  -- A forged applied payload, even with superficially plausible counters, must
  -- fail before the actual physical operations fulfill their planned outcomes.
  rejected:=false;begin
   update plm.licensing_consolidation_plan set plan_status='applied',applied_at=now(),applied_by='forged',applied_state='{}',entity_operation_count=0,relationship_operation_count=0,retire_operation_count=0 where id=p.id;
  exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'unexecuted forged applied payload accepted';end if;
  perform set_config('TimeZone','America/New_York',true);
  q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  if q.plan_status<>'applied' or (select name from core.property where id='23360000-0000-0000-0000-000000000002')<>'First new official'
     or (select name from core.property where id='23360000-0000-0000-0000-000000000003')<>'Second old official' then raise exception 'filtered real rename failed or changed unrelated property';end if;
  if (select (value->>'changes')::integer from jsonb_array_elements(q.applied_state->'operations') where value->>'op_key'='40:name:23360000-0000-0000-0000-000000000002')<>2 then raise exception 'real rename/new retained alias must count two content changes';end if;
  -- Only the native test's postgres role creates this hostile stored-audit copy;
  -- client plan INSERT grants and all immutable UPDATE guards remain unchanged.
  insert into plm.licensing_consolidation_plan
   select (jsonb_populate_record(null::plm.licensing_consolidation_plan,to_jsonb(q)||jsonb_build_object(
    'id',gen_random_uuid(),'plan_hash',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
    'operations',jsonb_set(q.operations,'{0,owners,0,table}',to_jsonb('core.property;select pg_sleep(5)'::text))))).* returning * into r;
  rejected:=false;begin perform plm.plan_licensing_consolidation_rollback(r.id,encode(extensions.digest(r.applied_state::text,'sha256'),'hex'));
   exception when invalid_parameter_value then if sqlerrm<>'rollback unknown canonical owner endpoint' then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'hostile rollback owner identifier accepted';end if;
  rejected:=false;begin update plm.licensing_consolidation_plan set entity_operation_count=entity_operation_count+1 where id=q.id;exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'applied real counters mutable';end if;
  raise exception using errcode='Z2336',message='roll back additional synthetic rename case';
 exception when sqlstate 'Z2336' then null;end;
 rejected:=false;
 baseline:=jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')));
 begin perform plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020','7');exception when others then rejected:=true;end;if not rejected then raise exception 'leading zero ID corrupted';end if;
 begin update plm.pmt_property set property_name='Unsafe source mutation' where capture_id='23360000-0000-0000-0000-000000000020';raise exception 'completed native property mutation accepted';exception when sqlstate 'P0001' then if sqlerrm='completed native property mutation accepted' then raise;end if;end;
 p:=plm.plan_licensing_consolidation('paramount','23360000-0000-0000-0000-000000000020');if (plm.plan_licensing_consolidation(' paramount ','23360000-0000-0000-0000-000000000020')).id<>p.id then raise exception 'padded paramount identity differs';end if;q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
 if q.entity_operation_count<>3 or q.relationship_operation_count<>4 or not exists(select 1 from core.property_style_guide where property_id='23360000-0000-0000-0000-000000000002' and style_guide_id='23360000-0000-0000-0000-000000000005' and is_current) then raise exception 'real Collection/StyleGuide support missing';end if;
 r:=plm.apply_licensing_consolidation(q.id,q.plan_hash);if r.id<>q.id or r.applied_state is distinct from q.applied_state then raise exception 'exact repeated native apply changed state';end if;
 begin
 update core.property_character_source_edge set metadata=metadata||jsonb_build_object('changed_poststate',true) where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='paramount' and is_current;
 perform plm.plan_licensing_consolidation_rollback(q.id,encode(extensions.digest(q.applied_state::text,'sha256'),'hex'));raise exception 'changed physical poststate accepted for inverse';
 exception when sqlstate '40001' then null;end;
 begin
 delete from plm.licensing_source_scope where source_system='paramount' and licensor_id='23360000-0000-0000-0000-000000000001';
 perform plm.plan_licensing_consolidation_rollback(q.id,encode(extensions.digest(q.applied_state::text,'sha256'),'hex'));raise exception 'revoked current source authority accepted for inverse';
 exception when sqlstate 'P0001' then if sqlerrm='revoked current source authority accepted for inverse' then raise;end if;end;
 r:=plm.plan_licensing_consolidation_rollback(q.id,encode(extensions.digest(q.applied_state::text,'sha256'),'hex'));r:=plm.apply_licensing_consolidation(r.id,r.plan_hash);
 if exists(select 1 from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and is_current) or exists(select 1 from core.property_style_guide_current where property_id='23360000-0000-0000-0000-000000000002' and style_guide_id='23360000-0000-0000-0000-000000000005') or (select count(*) from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='paramount')<>1 or (select count(*) from core.taxonomy_source_ref where entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005') and source_system='paramount')<>3 then raise exception 'physical conditional rollback failed/history deleted';end if;
 if q.id=(select rollback_of from plm.licensing_consolidation_plan where id=r.id) and (select plan_status from plm.licensing_consolidation_plan where id=q.id)='applied' then -- Distinct immutable captures exercise real missing-support retirement and reactivation.
 select created_at into pair_created from core.property_character_associations where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004';
 for phase in 1..3 loop
  native_capture:=gen_random_uuid();
  insert into plm.pmt_capture select (jsonb_populate_record(null::plm.pmt_capture,to_jsonb(c)||jsonb_build_object('capture_id',native_capture,'started_at','2026-10-11 12:00Z'::timestamptz+phase*interval '1 minute','completed_at','2026-10-11 12:01Z'::timestamptz+phase*interval '1 minute'))).* from plm.pmt_capture c where capture_id='23360000-0000-0000-0000-000000000020';
  foreach native_table in array array['pmt_authorized_title','pmt_property','pmt_character','pmt_collection','pmt_authorized_title_property','pmt_property_collection','pmt_property_character'] loop
   if phase=2 and native_table='pmt_property_character' then continue;end if;
   execute format('insert into plm.%I select (jsonb_populate_record(null::plm.%I,to_jsonb(t)||jsonb_build_object(''capture_id'',$1))).* from plm.%I t where capture_id=$2',native_table,native_table,native_table) using native_capture,'23360000-0000-0000-0000-000000000020'::uuid;
  end loop;
  p:=plm.plan_licensing_consolidation('paramount',native_capture);q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  if phase=2 then
   if exists(select 1 from core.property_character_associations_current where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004') then raise exception 'missing last direct support kept pair current';end if;
  else
   if not exists(select 1 from core.property_character_associations_current where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004') then raise exception 'restored exact native support failed reactivation';end if;
  end if;
  if not exists(select 1 from core.property_character_associations where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and created_at=pair_created) then raise exception 'reactivation replaced historical pair identity or timestamp';end if;
 end loop;
 if (select count(*) from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='paramount')<3 or (select count(*) from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='paramount' and is_current)<>1 then raise exception 'physical support retirement/reactivation lost history';end if;
 begin
 native_capture:=gen_random_uuid();
 insert into plm.pmt_capture select (jsonb_populate_record(null::plm.pmt_capture,to_jsonb(c)||jsonb_build_object('capture_id',native_capture,'started_at','2026-10-11 12:10Z'::timestamptz,'completed_at','2026-10-11 12:11Z'::timestamptz))).* from plm.pmt_capture c where capture_id='23360000-0000-0000-0000-000000000020';
 foreach native_table in array array['pmt_authorized_title','pmt_property','pmt_character','pmt_collection','pmt_authorized_title_property','pmt_property_collection','pmt_property_character'] loop
 execute format('insert into plm.%I select (jsonb_populate_record(null::plm.%I,to_jsonb(t)||jsonb_build_object(''capture_id'',$1))).* from plm.%I t where capture_id=$2',native_table,native_table,native_table) using native_capture,'23360000-0000-0000-0000-000000000020'::uuid;
 end loop;
 update core.property_character_source_edge set metadata=metadata-'engine_schema_version' where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='paramount' and is_current;
 r:=plm.plan_licensing_consolidation('paramount',native_capture);
 if r.plan_status<>'refused' or r.plan_schema_version<>2 or r.refusal_reason not like '%incompatible namespace%' then raise exception 'NULL legacy source provenance was accepted or rewritten: % / %',r.plan_status,r.refusal_reason;end if;
 raise exception 'restore deliberately invalid fixture' using errcode='P0002';
 exception when sqlstate 'P0002' then null;end;

 declare compat plm.licensing_consolidation_plan;legacy_hash text;begin
 legacy_hash:=encode(extensions.digest(jsonb_build_object('source_system','paramount','capture_id','23360000-0000-0000-0000-000000000020','operations','[]'::jsonb)::text,'sha256'),'hex');
 insert into plm.licensing_consolidation_plan(source_system,capture_id,plan_hash,plan_schema_version,capture_complete,source_scope_checked,operations,rollback_operations,planned_by) values('paramount','23360000-0000-0000-0000-000000000020',legacy_hash,1,true,true,'[]','[]','schema1-existing-format-test') returning * into compat;
 compat:=plm.apply_licensing_consolidation(compat.id,compat.plan_hash);if compat.plan_status<>'applied' or compat.plan_schema_version<>1 or compat.applied_state is not null then raise exception 'existing paramount schema1 apply compatibility lost';end if;
 if (plm.apply_licensing_consolidation(compat.id,compat.plan_hash)).id<>compat.id then raise exception 'existing paramount schema1 applied retry lost';end if;
 end;
raise notice 'Paramount native leading-zero IDs, actual Collection support, conditional physical rollback/history PASS';else raise exception 'audit lineage lost';end if;
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
end $test$;

rollback;
begin;
-- Invented current-native fixtures use the real protected-column authorizations.
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'issue2336-native-contract',array['name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.licensor(id,name,code,status) values('23360000-0000-0000-0000-000000000001','ZZ Native Contract2336','ZZ2336N','active');
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'issue2336-native-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.property(id,licensor_id,name,code,status) values('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000001','Synthetic original','ZZ2336NP','potential');
insert into core.character(id,licensor_id,name) values('23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000001','Synthetic canonical character');
insert into core.style_guide(id,licensor_id,name,property_id) values('23360000-0000-0000-0000-000000000005','23360000-0000-0000-0000-000000000001','Synthetic guide','23360000-0000-0000-0000-000000000002');
insert into plm.nbcu_capture(id,capture_key,status,source_repository,source_commit_sha,source_manifest_sha256,portal_base_url,source_captured_at,load_completed_at,expected_counts,observed_counts,raw_summary,created_by) values('23360000-0000-0000-0000-000000000010','issue2336-nbcu-native','complete','fixture',repeat('a',40),repeat('b',64),'https://fixture.invalid','2026-10-10 12:00Z','2026-10-10 12:01Z','{"assets":0,"properties":1,"characters":1,"style_guides":0,"scopes":1,"ip_family_property":0,"property_character":1,"asset_property":0,"asset_character":0,"asset_style_guide":0,"style_guide_property":0,"asset_ip_family":0}'::jsonb,'{"assets":0,"properties":1,"characters":1,"style_guides":0,"scopes":1,"ip_family_property":0,"property_character":1,"asset_property":0,"asset_character":0,"asset_style_guide":0,"style_guide_property":0,"asset_ip_family":0}'::jsonb,'{}','test');
insert into plm.nbcu_scope(capture_id,scope_key,scope_label,scope_href,page_count,indexed_rows,unique_assets,terminal,source_files,raw) values('23360000-0000-0000-0000-000000000010','href-sha256:'||repeat('c',64),'fixture','https://fixture.invalid/scope',0,0,0,true,'[]','{}');
insert into plm.nbcu_property(capture_id,property_key,property_source_id,property_label,source_kind,source_url,source_captured_at,raw) values('23360000-0000-0000-0000-000000000010','source-id:700','700','Exact Official NBCU','property','https://fixture.invalid',now(),'{}');
insert into plm.nbcu_character(capture_id,character_key,character_source_id,character_label,source_url,source_captured_at,raw) values('23360000-0000-0000-0000-000000000010','701','701','Synthetic native character','https://fixture.invalid',now(),'{}');
insert into plm.nbcu_property_character(capture_id,property_key,character_key,property_label,character_label,evidence_type,evidence_value,source_captured_at,source_url,raw) values('23360000-0000-0000-0000-000000000010','source-id:700','701','Exact Official NBCU','Synthetic native character','exact_native_pair','invented direct fixture',now(),'https://fixture.invalid','{}');
insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values('nbcu','property','source-id:700','23360000-0000-0000-0000-000000000002','matched');
insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status) values('nbcu','character','701','23360000-0000-0000-0000-000000000004','matched');
insert into plm.licensing_source_scope values('23360000-0000-0000-0000-000000000001','nbcu','canonical_identity','entity','property',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','nbcu','canonical_identity','entity','character',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','nbcu','relationship_evidence','relationship','property_character',now(),'synthetic test');
-- Creative metadata-only Property remains raw evidence, even with a durable mapping.
insert into plm.nbcu_property(capture_id,property_key,property_label,source_kind,source_url,source_captured_at,raw) values('23360000-0000-0000-0000-000000000010','metadata-label-sha256:'||repeat('f',64),'Creative-only unrelated title','asset_metadata_label','https://fixture.invalid',now(),'{}');
update plm.nbcu_capture set expected_counts=jsonb_set(expected_counts,'{properties}','2'),observed_counts=jsonb_set(observed_counts,'{properties}','2')||jsonb_build_object('asset_metadata_values',0,'asset_scopes',0) where id='23360000-0000-0000-0000-000000000010';
insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values('nbcu','property','metadata-label-sha256:'||repeat('f',64),'23360000-0000-0000-0000-000000000002','matched');
do $test$ declare p plm.licensing_consolidation_plan;q plm.licensing_consolidation_plan;rejected boolean:=false;n bigint;baseline jsonb;begin
 baseline:=jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')));
 begin perform plm.plan_licensing_consolidation('nbcu','23360000-0000-0000-0000-000000000010','700');exception when others then rejected:=true;end;if not rejected then raise exception 'NBCU fallback erroneously accepted';end if;
 begin
 update plm.nbcu_property_character set evidence_type='cooccurrence' where capture_id='23360000-0000-0000-0000-000000000010';
 perform plm.licensing_consolidation_capture_snapshot('nbcu','23360000-0000-0000-0000-000000000010');raise exception 'cooccurrence became direct source authority';
 exception when sqlstate 'P0001' then if sqlerrm='cooccurrence became direct source authority' then raise;end if;end;
 begin
 update plm.nbcu_capture set expected_counts=jsonb_set(expected_counts,'{asset_property}','null') where id='23360000-0000-0000-0000-000000000010';
 perform plm.licensing_consolidation_capture_snapshot('nbcu','23360000-0000-0000-0000-000000000010');raise exception 'JSON null native expected count accepted';
 exception when sqlstate 'P0001' then if sqlerrm='JSON null native expected count accepted' then raise;end if;end;
 p:=plm.plan_licensing_consolidation('nbcu','23360000-0000-0000-0000-000000000010');if (plm.plan_licensing_consolidation(' nbcu ','23360000-0000-0000-0000-000000000010')).id<>p.id then raise exception 'padded nbcu identity differs';end if;
 begin
 update plm.source_resolution set resolution_status='rejected',core_character_id=null where source_system='nbcu' and entity_kind='character' and source_id='701';
 perform plm.apply_licensing_consolidation(p.id,p.plan_hash);raise exception 'changed durable decision accepted by apply';
 exception when sqlstate '40001' then null;end;
 if exists(select 1 from core.taxonomy_source_ref where entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005') and source_system='nbcu') then raise exception 'stale decision refusal wrote provenance';end if;
 begin
 update core.character set licensor_id=null where id='23360000-0000-0000-0000-000000000004';
 perform plm.apply_licensing_consolidation(p.id,p.plan_hash);raise exception 'missing owner accepted by apply';
 exception when sqlstate 'P0001' then if sqlerrm='missing owner accepted by apply' then raise;end if;end;
 q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
 if q.plan_status<>'applied' or q.entity_operation_count<3 or q.relationship_operation_count<>2 then raise exception 'physical counters missing';end if;
 if (select name from core.property where id='23360000-0000-0000-0000-000000000002')<>'Exact Official NBCU' or not exists(select 1 from core.property_alias where property_id='23360000-0000-0000-0000-000000000002' and alias='Synthetic original' and not cross_app_certified and approved_by is null) then raise exception 'protected official rename/prior alias missing';end if;
 if exists(select 1 from core.taxonomy_source_ref where entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005') and source_system='nbcu' and source_id like '%metadata-label-sha256%') or exists(select 1 from core.property_alias where property_id='23360000-0000-0000-0000-000000000002' and alias='Creative-only unrelated title') or not exists(select 1 from plm.nbcu_property where capture_id='23360000-0000-0000-0000-000000000010' and source_kind='asset_metadata_label') then raise exception 'Creative-only raw Property became canonical authority or was lost';end if;
 if (select count(*) from core.taxonomy_source_ref where entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005') and source_system='nbcu' and missing_since is null)<>2 or (select count(*) from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='nbcu' and is_current)<>1 or not exists(select 1 from core.property_character_associations where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and is_current) then raise exception 'real support/pair writes missing';end if;
 begin
 perform plm.plan_licensing_consolidation_rollback(q.id,encode(extensions.digest(q.applied_state::text,'sha256'),'hex'));raise exception 'rename inverse ignored retained-alias conflict';
 exception when sqlstate 'P0001' then if sqlerrm='rename inverse ignored retained-alias conflict' then raise;end if;end;
 if (select name from core.property where id='23360000-0000-0000-0000-000000000002')<>'Exact Official NBCU' or not exists(select 1 from core.property_alias where property_id='23360000-0000-0000-0000-000000000002' and alias='Synthetic original') then raise exception 'refused rename inverse changed official name or old alias';end if;
 select count(*) into n from plm.licensing_write_guard_audit;
 -- Idempotency succeeds before no-write capture recheck, even after a new complete root.
 insert into plm.nbcu_capture(id,capture_key,status,source_repository,source_commit_sha,source_manifest_sha256,portal_base_url,source_captured_at,load_completed_at,expected_counts,observed_counts,raw_summary,created_by) select '23360000-0000-0000-0000-000000000011','issue2336-later-native',status,source_repository,source_commit_sha,source_manifest_sha256,portal_base_url,'2026-10-11 12:00Z','2026-10-11 12:01Z',expected_counts,observed_counts,raw_summary,created_by from plm.nbcu_capture where id='23360000-0000-0000-0000-000000000010';
 q:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
 if (select count(*) from plm.licensing_write_guard_audit)<>n then raise exception 'idempotent retry consumed new authorization';end if;

 declare compat plm.licensing_consolidation_plan;legacy_hash text;begin
 legacy_hash:=encode(extensions.digest(jsonb_build_object('source_system','nbcu','capture_id','23360000-0000-0000-0000-000000000010','operations','[]'::jsonb)::text,'sha256'),'hex');
 insert into plm.licensing_consolidation_plan(source_system,capture_id,plan_hash,plan_schema_version,capture_complete,source_scope_checked,operations,rollback_operations,planned_by) values('nbcu','23360000-0000-0000-0000-000000000010',legacy_hash,1,true,true,'[]','[]','schema1-existing-format-test') returning * into compat;
 compat:=plm.apply_licensing_consolidation(compat.id,compat.plan_hash);if compat.plan_status<>'applied' or compat.plan_schema_version<>1 or compat.applied_state is not null then raise exception 'existing nbcu schema1 apply compatibility lost';end if;
 if (plm.apply_licensing_consolidation(compat.id,compat.plan_hash)).id<>compat.id then raise exception 'existing nbcu schema1 applied retry lost';end if;
 end;
 raise notice 'NBCU native namespace, real source refs/pair, protected alias and exact idempotent physical apply PASS';
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
end $test$;
rollback;

begin;
-- Invented current-native fixtures use the real protected-column authorizations.
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'issue2336-native-contract',array['name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.licensor(id,name,code,status) values('23360000-0000-0000-0000-000000000001','ZZ Native Contract2336','ZZ2336N','active');
insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'issue2336-native-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
insert into core.property(id,licensor_id,name,code,status) values('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000001','Synthetic original','ZZ2336NP','potential');
insert into core.character(id,licensor_id,name) values('23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000001','Synthetic canonical character');
insert into core.style_guide(id,licensor_id,name,property_id) values('23360000-0000-0000-0000-000000000005','23360000-0000-0000-0000-000000000001','Synthetic guide','23360000-0000-0000-0000-000000000002');
do $opa_native$ declare c uuid:='23360000-0000-0000-0000-000000000030';x record;h text;root_hash text;plan plm.licensing_consolidation_plan;applied plm.licensing_consolidation_plan;inverse plm.licensing_consolidation_plan;baseline jsonb;begin
 baseline:=jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')));
 insert into plm.opa_capture(id,capture_key,source_repository,source_commit_sha,source_manifest_sha256,source_captured_at,status,load_completed_at,expected_scope_count,expected_unique_property_count,expected_unique_character_count,expected_scope_membership_count,expected_cross_scope_property_count,expected_relationship_count,expected_duplicate_pair_count,observed_unique_property_count,observed_unique_character_count,observed_scope_membership_count,observed_cross_scope_property_count,observed_relationship_count,observed_duplicate_pair_count,created_by)
 values(c,'issue2336-opa-native','fixture',repeat('a',40),repeat('b',64),'2026-10-10 12:00Z','complete','2026-10-10 12:01Z',2,2,2,2,0,2,0,2,2,2,0,2,0,'test');
 for x in select * from (values ('disney_home_standard','Disney','21','49',400,401),('lucas_home_standard','Lucas','462','50',402,403)) q(scope_key,branch,template_id,workflow_id,property_id,character_id) loop
  h:=encode(extensions.digest(convert_to(x.property_id::text,'UTF8')||decode('00','hex')||convert_to('Synthetic original','UTF8')||decode('00','hex')||convert_to('900','UTF8')||decode('00','hex')||convert_to(x.character_id::text,'UTF8')||decode('00','hex')||convert_to('Synthetic native character','UTF8')||decode('00','hex')||convert_to('999','UTF8'),'sha256'),'hex');
  insert into plm.opa_capture_scope(capture_id,scope_key,region,branch,lob,submission_type,template_id,workflow_id,source_sha256,expected_property_count,expected_character_count,expected_relationship_count,expected_relationship_sha256,authentication_evidence_sha256,authenticated_at,observed_property_count,observed_character_count,observed_relationship_count,observed_duplicate_pair_count,observed_relationship_sha256,status,finished_at)
   values(c,x.scope_key,'North America',x.branch,'200','Standard',x.template_id,x.workflow_id,repeat('c',64),1,1,1,h,repeat('d',64),now(),1,1,1,0,h,'complete',now());
  insert into plm.opa_property_character_capture(capture_id,scope_key,chunk_key,chunk_sha256,licensed_property_id,property_name,option_source_id,character_id,character_name,brand_property_id,source_row_sha256)
   values(c,x.scope_key,'chunk',repeat('e',64),x.property_id,'Synthetic original',900,x.character_id,'Synthetic native character',999,h);
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values('disney_opa','property',x.property_id::text,'23360000-0000-0000-0000-000000000002','matched');
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status) values('disney_opa','character',x.character_id::text,'23360000-0000-0000-0000-000000000004','matched');
 end loop;
 select encode(extensions.digest(convert_to(string_agg(source_row_sha256,e'\n' order by source_row_sha256),'UTF8'),'sha256'),'hex') into root_hash from plm.opa_property_character_capture where capture_id=c;
 update plm.opa_capture set observed_relationship_sha256=root_hash where id=c;
 insert into plm.licensing_source_scope values('23360000-0000-0000-0000-000000000001','disney_opa','canonical_identity','entity','property',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','disney_opa','canonical_identity','entity','character',now(),'synthetic test'),('23360000-0000-0000-0000-000000000001','disney_opa','relationship_evidence','relationship','property_character',now(),'synthetic test');
 begin perform plm.plan_licensing_consolidation('disney_opa',c,'999');raise exception 'brand ID incorrectly accepted as licensed Property';exception when sqlstate '22023' then null;end;
 begin update plm.opa_capture_scope set authentication_evidence_sha256=null,authenticated_at=null where capture_id=c and scope_key='lucas_home_standard';perform plm.licensing_consolidation_capture_snapshot('disney_opa',c);raise exception 'unauthenticated complete route accepted';exception when sqlstate 'P0001' then if sqlerrm='unauthenticated complete route accepted' then raise;end if;end;
 begin update plm.opa_capture_scope set expected_relationship_sha256=repeat('f',64) where capture_id=c;perform plm.licensing_consolidation_capture_snapshot('disney_opa',c);raise exception 'incorrect route manifest accepted';exception when sqlstate 'P0001' then if sqlerrm='incorrect route manifest accepted' then raise;end if;end;
 plan:=plm.plan_licensing_consolidation('disney_opa',c);if (plm.plan_licensing_consolidation(' disney_opa ',c)).id<>plan.id then raise exception 'padded OPA identity differs';end if;applied:=plm.apply_licensing_consolidation(plan.id,plan.plan_hash);
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
 if applied.plan_status<>'applied' or (select count(*) from core.taxonomy_source_ref where entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005') and source_system='disney_opa' and missing_since is null)<>4 or (select count(*) from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='disney_opa' and is_current)<>1 then raise exception 'approved two-route physical OPA provenance missing';end if;
 inverse:=plm.plan_licensing_consolidation_rollback(applied.id,encode(extensions.digest(applied.applied_state::text,'sha256'),'hex'));inverse:=plm.apply_licensing_consolidation(inverse.id,inverse.plan_hash);
 if exists(select 1 from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='disney_opa' and is_current) or not exists(select 1 from core.property_character_source_edge where property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004' and source_system='disney_opa' and not is_current) then raise exception 'OPA inverse erased history or retained current support';end if;

 declare compat plm.licensing_consolidation_plan;legacy_hash text;begin
 legacy_hash:=encode(extensions.digest(jsonb_build_object('source_system','disney_opa','capture_id','23360000-0000-0000-0000-000000000030','operations','[]'::jsonb)::text,'sha256'),'hex');
 insert into plm.licensing_consolidation_plan(source_system,capture_id,plan_hash,plan_schema_version,capture_complete,source_scope_checked,operations,rollback_operations,planned_by) values('disney_opa','23360000-0000-0000-0000-000000000030',legacy_hash,1,true,true,'[]','[]','schema1-existing-format-test') returning * into compat;
 compat:=plm.apply_licensing_consolidation(compat.id,compat.plan_hash);if compat.plan_status<>'applied' or compat.plan_schema_version<>1 or compat.applied_state is not null then raise exception 'existing disney_opa schema1 apply compatibility lost';end if;
 if (plm.apply_licensing_consolidation(compat.id,compat.plan_hash)).id<>compat.id then raise exception 'existing disney_opa schema1 applied retry lost';end if;
 end;
 raise notice 'OPA exact approved routes/actual hash/counts/licensed property namespace/physical inverse PASS';
 if baseline is distinct from jsonb_build_object('refs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.taxonomy_source_ref v where not (entity_id in ('23360000-0000-0000-0000-000000000002','23360000-0000-0000-0000-000000000004','23360000-0000-0000-0000-000000000005'))),'pairs',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_associations v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004')),'support',(select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from core.property_character_source_edge v where not (property_id='23360000-0000-0000-0000-000000000002' and character_id='23360000-0000-0000-0000-000000000004'))) then raise exception 'native engine changed unrelated baseline provenance/pair/support history';end if;
end $opa_native$;
rollback;

-- Preserve installed schema1 capture/scope/hash/audit capability in the same public routines.
begin;
do $legacy$
declare l uuid:=gen_random_uuid();p uuid:=gen_random_uuid();ch uuid:=gen_random_uuid();d uuid:=gen_random_uuid();w uuid:=gen_random_uuid();b uuid:=gen_random_uuid();s text;c uuid;q plm.licensing_consolidation_plan;r plm.licensing_consolidation_plan;before_count bigint;pair_before bigint;msg text;failed boolean;op jsonb;h text;ev text;constraint_name text;
begin
 insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'schema1-native-test',array['name','code','status'],clock_timestamp()+interval '1minute');
 insert into core.licensor(id,name,code,status) values(l,'ZZ Schema1 preservation','ZZ2336L1','active');
 insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at) values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'schema1-native-test',array['licensor_id','name','code','status'],clock_timestamp()+interval '1minute');
 insert into core.property(id,licensor_id,name,code,status) values(p,l,'Synthetic preserved property','ZZ2336L1P','potential');
 insert into core.character(id,licensor_id,name) values(ch,l,'Synthetic legacy canonical character');
 insert into plm.dcp_crawl(crawl_id,source_system,status,captured_on,portal_base_url,crawler_version,account_scope,line_of_business,started_at,finished_at,rows_received,distinct_assets_received,captured_by,private_source_commit)
 values(d,'disney_dcpvault','complete',date '2099-01-01','https://fixture.invalid','synthetic','synthetic','synthetic',now(),now(),0,0,'schema1-test',repeat('a',40));
 insert into plm.wildbrain_capture(id,capture_key,source_repository,source_commit_sha,source_manifest_sha256,portal_base_url,source_captured_at,load_completed_at,status,expected_counts,observed_counts,pagination_verified,reported_total,raw_summary,created_by)
 values(w,'zztest-2336-schema1','synthetic',repeat('a',40),repeat('b',64),'https://fixture.invalid',now(),now(),'complete','{}','{}',true,0,'{}','schema1-test');
 insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at,completed_at,loader_report)
 values(b,0,'wb_franchise','complete',date '2099-01-01',repeat('a',40),repeat('b',64),1,'schema1-test','https://fixture.invalid',now(),now(),'{}');
 -- Preserve the actually installed schema1 input contract, including native NULL failure.
 foreach s in array array['','   '] loop
  failed:=false;begin perform plm.plan_licensing_consolidation(s,d);exception when invalid_parameter_value then
   if sqlerrm<>'plan_licensing_consolidation requires a non-blank source_system and a capture_id' then raise;end if;failed:=true;
  end;if not failed then raise exception 'blank schema1 source accepted';end if;
 end loop;
 failed:=false;begin perform plm.plan_licensing_consolidation(null::text,d);exception when not_null_violation then
  if position('"source_system"' in sqlerrm)=0 then raise;end if;failed:=true;
 end;if not failed then raise exception 'NULL schema1 source behavior changed';end if;
 select count(*) into before_count from core.property_character_source_edge;
 select count(*) into pair_before from core.property_character_associations;
 foreach s in array array['disney_dcpvault','lucasfilm_dcpvault','marvel_dcpvault','twentieth_century_dcpvault','wildbrain','warner:wb_franchise'] loop
  c:=case when s='wildbrain' then w when s like 'warner:%' then b else d end;
  insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values(s,'property','synthetic-native-2336',p,'matched');
  insert into plm.licensing_source_scope(licensor_id,source_system,source_purpose,scope_axis,permitted_kind,authorized_at,authorized_by) values(l,s,'canonical_identity','entity','property',now(),'schema1-test');
  insert into plm.licensing_relationship_resolution(licensor_id,source_system,relationship_kind,source_left_id,source_right_id,resolution_status,core_property_id,core_character_id,evidence_kind,source_evidence) values(l,s,'property_character','synthetic-native-2336','synthetic-character','matched',p,ch,'direct_source_assertion','Invented exact synthetic legacy pair');
  insert into plm.licensing_source_scope(licensor_id,source_system,source_purpose,scope_axis,permitted_kind,authorized_at,authorized_by) values(l,s,'relationship_evidence','relationship','property_character',now(),'schema1-test');
  q:=plm.plan_licensing_consolidation(s,c,'synthetic-native-2336');
  if q.plan_schema_version<>1 or q.plan_status<>'preview' or q.entity_operation_count<>1 or q.relationship_operation_count<>1 or q.operations->0->>'op'<>'noop' then raise exception 'schema1 legacy positive lost for %: %',s,to_jsonb(q);end if;
  if not exists(select 1 from jsonb_array_elements(q.operations) x where x->>'op'='upsert_relationship_support' and x->>'relationship_kind'='property_character' and x->>'evidence_kind'='direct_source_assertion' and x->'after'->>'core_property_id'=p::text and x->'after'->>'core_character_id'=ch::text) then raise exception 'legacy exact direct relationship operation lost';end if;
  foreach ev in array array['inferred','co_occurrence'] loop
   failed:=false;begin
    update plm.licensing_relationship_resolution set evidence_kind=ev::core.relationship_evidence_kind where source_system=s and source_left_id='synthetic-native-2336';
   exception when check_violation then
    get stacked diagnostics constraint_name=CONSTRAINT_NAME;
    if constraint_name<>'licensing_relationship_resolution_matched_is_direct_chk' then raise;end if;
    failed:=true;
   end;
   if not failed then raise exception 'legacy matched non-direct decision accepted: %',ev;end if;
  end loop;
  h:=encode(extensions.digest(jsonb_build_object('source_system',s,'capture_id',c::text,'operations',q.operations)::text,'sha256'),'hex');
  if q.plan_hash<>h or q.capture_snapshot<>'{}' or q.applied_state is not null then raise exception 'legacy original hash/metadata changed';end if;
  r:=plm.plan_licensing_consolidation(' '||s||' ',c,'synthetic-native-2336');if r.id<>q.id then raise exception 'legacy replan idempotency lost';end if;
  failed:=false;begin perform plm.apply_licensing_consolidation(q.id,repeat('0',64));exception when serialization_failure then failed:=true;end;if not failed then raise exception 'legacy wrong hash accepted';end if;
  failed:=false;begin update plm.licensing_consolidation_plan set entity_operation_count=0 where id=q.id;exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'legacy planned counter mutable';end if;
  failed:=false;begin update plm.licensing_consolidation_plan set plan_schema_version=2 where id=q.id;exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'legacy schema dispatch mutable';end if;
  r:=plm.apply_licensing_consolidation(q.id,q.plan_hash);if r.plan_status<>'applied' or r.entity_operation_count<>1 or r.relationship_operation_count<>1 or r.applied_state is not null then raise exception 'legacy original audit lifecycle lost';end if;
  if (plm.apply_licensing_consolidation(q.id,q.plan_hash)).id<>q.id then raise exception 'legacy applied retry lost';end if;
  r:=plm.plan_licensing_consolidation(s,gen_random_uuid());if r.plan_schema_version<>1 or r.plan_status<>'refused' or r.capture_complete then raise exception 'legacy incomplete capture accepted';end if;
  delete from plm.licensing_source_scope where source_system=s and licensor_id=l;
  r:=plm.plan_licensing_consolidation(s,c);if r.plan_status<>'refused' or r.source_scope_checked then raise exception 'legacy missing scope accepted';end if;
 end loop;
 if (select count(*) from core.property_character_source_edge)<>before_count or (select count(*) from core.property_character_associations)<>pair_before then raise exception 'legacy audit path invented physical pair/support writes';end if;
 -- A schema1 payload built before replacement keeps the original hash/apply contract.
 s:='warner:wb_franchise';insert into plm.licensing_source_scope(licensor_id,source_system,source_purpose,scope_axis,permitted_kind,authorized_at,authorized_by) values(l,s,'canonical_identity','entity','property',now(),'schema1-test');
 op:=jsonb_build_object('op_key','entity:property:synthetic-native-2336','op','update_entity','entity_kind','property','source_system',s,'source_id','synthetic-native-2336','canonical_id',p,'target_table','core.property','before',jsonb_build_object('name','Synthetic preserved property','code','ZZ2336L1P','status','potential','licensor_id',l),'after',jsonb_build_object('name','Synthetic original-format renamed property','code','ZZ2336L1P','status','potential','licensor_id',l),'evidence_kind','direct_source_assertion');
 h:=encode(extensions.digest(jsonb_build_object('source_system',s,'capture_id',b::text,'operations',jsonb_build_array(op))::text,'sha256'),'hex');
 insert into plm.licensing_consolidation_plan(source_system,capture_id,plan_hash,plan_schema_version,capture_complete,source_scope_checked,operations,rollback_operations,planned_by,entity_operation_count) values(s,b,h,1,true,true,jsonb_build_array(op),'[]','schema1-test',1) returning * into q;
 r:=plm.apply_licensing_consolidation(q.id,q.plan_hash);if r.plan_status<>'applied' or (select name from core.property where id=p)<>'Synthetic original-format renamed property' then raise exception 'legacy protected canonical write lost';end if;
 if (plm.apply_licensing_consolidation(q.id,q.plan_hash)).id<>q.id then raise exception 'legacy real-write retry lost';end if;
 raise notice 'Six original legacy namespace families, schema1 original hash/plan/apply/audit/real protected write preservation PASS';
end $legacy$;
rollback;

-- Typed identity predicates are private, closed, and served by real existing
-- target-key indexes. The forced-index control proves usability, not a claim
-- about physical work or production performance on an empty fixture.
begin;
set local enable_seqscan=off;
do $typed_identity_contracts$
declare r record;op jsonb;predicate text;state jsonb;plan jsonb;bad jsonb;rejected boolean;identity_key text;
begin
 -- Restore the exact installed plan facts and verify formatting/trigger bits
 -- against the native database in CI; formatting assumptions are not proof.
 if not (true
and exists(select 1 from pg_class c where c.oid=to_regclass('plm.licensing_consolidation_plan') and c.relkind='r')
and (select count(*) from pg_policy p where p.polrelid=to_regclass('plm.licensing_consolidation_plan')
 and p.polname='licensing_consolidation_plan_authenticated_read' and p.polcmd='r' and p.polpermissive
 and p.polroles=array[(select oid from pg_roles where rolname='authenticated')]::oid[]
 and pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null)=1
and (select count(*) from pg_constraint c where c.conrelid=to_regclass('plm.licensing_consolidation_plan')
 and c.conname='licensing_consolidation_plan_hash_chk' and c.contype='c' and c.convalidated
 and pg_get_constraintdef(c.oid)='CHECK ((plan_hash ~ ''^[0-9a-f]{64}$''::text))')=1
and (select count(*) from pg_constraint c where c.conrelid=to_regclass('plm.licensing_consolidation_plan')
 and c.conname='licensing_consolidation_plan_identity_uq' and c.contype='u' and c.convalidated and not c.condeferrable and not c.condeferred
 and pg_get_constraintdef(c.oid)='UNIQUE (source_system, capture_id, plan_hash)')=1

 ) then raise exception 'exact installed plan relation/policy/hash/identity facts changed';end if;
 for r in select * from(values('core.property_character_associations'),('core.property_style_guide'),('core.property_franchise'),('core.style_guide_character'),('dam.asset_property'),('dam.asset_character'),('dam.asset_style_guide'),('dam.asset_franchise')) pairs(base) loop
  if pg_get_viewdef(to_regclass(r.base||'_current')) is distinct from format(E' SELECT %s\n   FROM %s\n  WHERE is_current'||chr(59),
    (select string_agg(quote_ident(a.attname),E',\n    ' order by a.attnum) from pg_attribute a where a.attrelid=to_regclass(r.base) and a.attnum>0 and not a.attisdropped),r.base) then raise exception 'native exact view rendering changed:%',r.base;end if;
 end loop;
 if (select count(*) from pg_trigger t where t.tgname='assert_canonical_edge_still_supported' and t.tgrelid in(
  'core.property_character_source_edge'::regclass,'core.property_style_guide_source_edge'::regclass,'core.property_franchise_source_edge'::regclass,'core.style_guide_character_source_edge'::regclass,
  'dam.asset_property_source_edge'::regclass,'dam.asset_character_source_edge'::regclass,'dam.asset_style_guide_source_edge'::regclass,'dam.asset_franchise_source_edge'::regclass)
  and t.tgtype=25 and t.tgconstraint<>0 and t.tgdeferrable and t.tginitdeferred and t.tgnargs=3)<>8 then raise exception 'native deferred constraint trigger type25 contract changed';end if;
 raise notice 'Exact restored4 plan facts/native25 bits/all8 view deparser assertions PASS';
 for r in select * from(values
('core.taxonomy_source_ref','{"source_id": "ZZ2336 bound '' OR true --", "source_system": "ZZ2336 bound '' OR true --", "source_table": "ZZ2336 bound '' OR true --"}'::jsonb),
('core.property','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_character_associations','{"character_id": "23360000-0000-0000-0000-000000000099", "property_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_style_guide','{"property_id": "23360000-0000-0000-0000-000000000099", "style_guide_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_franchise','{"franchise_id": "23360000-0000-0000-0000-000000000099", "property_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.style_guide_character','{"character_id": "23360000-0000-0000-0000-000000000099", "style_guide_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_property','{"asset_id": "23360000-0000-0000-0000-000000000099", "property_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_character','{"asset_id": "23360000-0000-0000-0000-000000000099", "character_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_style_guide','{"asset_id": "23360000-0000-0000-0000-000000000099", "style_guide_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_franchise','{"asset_id": "23360000-0000-0000-0000-000000000099", "franchise_id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_character_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_style_guide_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.property_franchise_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('core.style_guide_character_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_property_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_character_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_style_guide_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb),
('dam.asset_franchise_source_edge','{"id": "23360000-0000-0000-0000-000000000099"}'::jsonb)
) targets(target,identity) loop
  op:=jsonb_build_object('target',r.target,'identity',r.identity);
  predicate:=plm.licensing_operation_identity_predicate(op);
  if position('ZZ2336 bound' in predicate)>0 or predicate='' then raise exception 'identity value became interpolated SQL';end if;
  state:=plm.licensing_consolidation_operation_state(op);
  if state->'rows'<>'[]'::jsonb then raise exception 'typed identity matched unrelated row';end if;
  execute format('explain(format json) select 1 from %s t where %s',r.target,predicate) into plan using r.identity;
  -- An index name alone also permits a full index scan with a residual Filter.
  -- Every supplied identity key must constrain an actual indexed equality qual.
  for identity_key in select jsonb_object_keys(r.identity) loop
   if not exists (
    select 1 from jsonb_path_query(plan,'$.** ? (exists(@."Index Name") && exists(@."Index Cond"))') indexed(node)
    where node->>'Index Cond' ~ format('(^|[^[:alnum:]_])%s[[:space:]]*=',identity_key)
   ) then raise exception 'real target identity key is not an indexed equality qual: %.%',r.target,identity_key;end if;
  end loop;
 end loop;
 -- This deliberately non-sargable lookup exposes the former Index Name false positive.
 execute 'explain(format json) select 1 from core.property t where t.id::text || '''' = $1::text'
  into plan using '23360000-0000-0000-0000-000000000099';
 if not jsonb_path_exists(plan,'$.**."Index Name"')
    or not jsonb_path_exists(plan,'$.**."Filter"')
    or jsonb_path_exists(plan,'$.**."Index Cond"') then
  raise exception 'identity negative control no longer demonstrates an index scan without indexed quals';
 end if;
 rejected:=false;begin
  perform plm.licensing_consolidation_operation_state(jsonb_build_object('target','core.property;delete from core.property','identity',jsonb_build_object('id','23360000-0000-0000-0000-000000000099')));
 exception when invalid_parameter_value then rejected:=true;end;
 if not rejected then raise exception 'invalid closed operation-state identity did not use22023';end if;
 if position('operation identity is not unique'' using errcode=''21000''' in pg_get_functiondef(to_regprocedure('plm.licensing_consolidation_operation_state(jsonb)')))=0 then raise exception 'unique-key cardinality invariant lacks distinct21000';end if;
 foreach bad in array array[
  null::jsonb,'{}'::jsonb,'{"target":"core.property;delete from core.property","identity":{"id":"00000000-0000-0000-0000-000000000001"}}'::jsonb,
  '{"target":"core.property","identity":null}'::jsonb,'{"target":"core.property","identity":[]}'::jsonb,
  '{"target":"core.property","identity":{}}'::jsonb,'{"target":"core.property","identity":{"id":null}}'::jsonb,
  '{"target":"core.property","identity":{"id":1}}'::jsonb,'{"target":"core.property","identity":{"id":"not-a-uuid"}}'::jsonb,
  '{"target":"core.property","identity":{"id":"00000000-0000-0000-0000-000000000001","extra":"x"}}'::jsonb,
  '{"target":"core.taxonomy_source_ref","identity":{"source_id":"x","source_table":"x"}}'::jsonb
 ] loop
  rejected:=false;begin perform plm.licensing_operation_identity_predicate(bad);exception when others then rejected:=true;end;
  if not rejected then raise exception 'unsupported or malformed typed identity accepted';end if;
 end loop;
 raise notice '18 actual indexed typed identity targets and11 malformed/bound-value controls PASS';
end $typed_identity_contracts$;
rollback;
