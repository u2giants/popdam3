-- derived-from: 20261013130102, 20260906222338
-- Forward-only repair for trigger-owned last_seen_at in issue #2336 recovery.
-- Derived from the immutable body in 20261013130102_licensing_support_forward.sql;
-- the precondition pins its exact body and the exact base timestamp-trigger contract.
-- Only the trigger-owned timestamp expectation is normalized on qualifying updates.

-- Fail closed unless the frozen #2336 guard and the exact base trigger are present.
do $precondition$
begin
 if not exists (
  select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('plm.licensing_consolidation_plan_immutable()')
     and l.lanname='plpgsql'
     and p.prorettype='trigger'::regtype
     and p.pronargs=0
     and p.prosecdef
     and p.provolatile='v'
     and cardinality(p.proconfig)=2
     and exists(select 1 from unnest(p.proconfig) s where lower(s)='search_path=pg_catalog')
     and exists(select 1 from unnest(p.proconfig) s where lower(s)='timezone=utc')
     and md5(p.prosrc)='3097938f8dad64d35f35931967ef3b67'
     and not exists (
       select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')
     and not has_function_privilege('anon',p.oid,'EXECUTE')
     and not has_function_privilege('authenticated',p.oid,'EXECUTE')
     and not has_function_privilege('service_role',p.oid,'EXECUTE')
 ) then
  raise exception 'refusing licensing recovery repair: frozen plan-guard body or metadata differs';
 end if;
 if not exists (
  select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('core.bump_taxonomy_source_ref_last_seen()')
     and l.lanname='plpgsql'
     and p.prorettype='trigger'::regtype
     and p.pronargs=0
     and p.prosecdef
     and cardinality(p.proconfig)=1
     and exists(select 1 from unnest(p.proconfig) s where lower(s)='search_path=core, pg_catalog')
     and md5(p.prosrc)='ca5dce0da32de2a16c13cbe714365c3f'
 ) then
  raise exception 'refusing licensing recovery repair: base last-seen trigger body or metadata differs';
 end if;
 if not exists (
  select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_attribute a on a.attrelid=t.tgrelid and a.attnum=any(t.tgattr::smallint[])
   where t.tgrelid=to_regclass('core.taxonomy_source_ref')
     and t.tgname='b_taxonomy_source_ref_last_seen'
     and t.tgfoid=to_regprocedure('core.bump_taxonomy_source_ref_last_seen()')
     and not t.tgisinternal
     and t.tgtype=19
     and t.tgenabled='O'
     and t.tgnargs=0
     and t.tgargs=''::bytea
     and t.tgqual is null
     and not t.tgdeferrable
     and not t.tginitdeferred
   group by t.oid
  having array_agg(a.attname::text order by a.attname::text)=array[
   'entity_id','entity_schema','entity_table','missing_since',
   'source_id','source_licensor_id','source_system','source_table']::text[]
 ) then
  raise exception 'refusing licensing recovery repair: base last-seen trigger definition differs';
 end if;
end
$precondition$;

create or replace function plm.licensing_consolidation_plan_immutable()
returns trigger language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $immutable$
declare op jsonb;state jsonb;states jsonb:='[]';changes integer;entities integer:=0;relationships integer:=0;retirements integer:=0;expected_state jsonb;normalized_after jsonb;expected_row jsonb;
begin
 if old.plan_schema_version=1 then
  if new.plan_schema_version is distinct from old.plan_schema_version or new.capture_snapshot is distinct from old.capture_snapshot or new.applied_state is distinct from old.applied_state then raise exception 'schema1 plan metadata is immutable' using errcode='42501';end if;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'licensing consolidation plans are immutable audit facts and cannot be deleted';
  end if;

  -- Only the apply lifecycle may change, and only preview -> applied (or a recorded
  -- refusal that was never applied). Content and gate evidence are frozen.
  if new.id is distinct from old.id
     or new.source_system is distinct from old.source_system
     or new.capture_id is distinct from old.capture_id
     or new.plan_hash is distinct from old.plan_hash
     or new.capture_complete is distinct from old.capture_complete
     or new.source_scope_checked is distinct from old.source_scope_checked
     or new.collision_count is distinct from old.collision_count
     or new.entity_operation_count is distinct from old.entity_operation_count
     or new.relationship_operation_count is distinct from old.relationship_operation_count
     or new.retire_operation_count is distinct from old.retire_operation_count
     or new.operations is distinct from old.operations
     or new.rollback_operations is distinct from old.rollback_operations
     or new.refusal_reason is distinct from old.refusal_reason
     or new.planned_at is distinct from old.planned_at
     or new.planned_by is distinct from old.planned_by
     or new.created_at is distinct from old.created_at
     or new.rollback_of is distinct from old.rollback_of then
    raise exception using errcode = '42501',
      message = 'licensing consolidation plan content is immutable; only plan_status, applied_at and applied_by may change';
  end if;

  if old.plan_status = 'applied' and new.plan_status <> 'applied' then
    raise exception using errcode = '42501',
      message = 'an applied licensing consolidation plan cannot be un-applied; plan a rollback instead';
  end if;

  return new;
end;
 end if;
 if tg_op='DELETE' then raise exception 'consolidation plan audit facts cannot be deleted' using errcode='42501';end if;
 if (to_jsonb(new)-array['plan_status','applied_at','applied_by','applied_state','entity_operation_count','relationship_operation_count','retire_operation_count']) is distinct from (to_jsonb(old)-array['plan_status','applied_at','applied_by','applied_state','entity_operation_count','relationship_operation_count','retire_operation_count']) then raise exception 'consolidation immutable content changed' using errcode='42501';end if;
 if old.plan_status='applied' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'applied consolidation audit is immutable' using errcode='42501';end if;
 if old.plan_status<>'preview' or new.plan_status not in ('preview','applied') or new.plan_status='preview' and (new.applied_state is distinct from old.applied_state or new.entity_operation_count<>old.entity_operation_count or new.relationship_operation_count<>old.relationship_operation_count or new.retire_operation_count<>old.retire_operation_count) then raise exception 'invalid consolidation lifecycle transition' using errcode='42501';end if;
 if new.plan_status='applied' and (new.applied_state is null or new.applied_by is null or new.applied_at is null) then raise exception 'physical applied state and actor required';end if;
 if old.plan_status='preview' and new.plan_status='applied' then
  for op in select value from jsonb_array_elements(old.operations) order by value->>'op_key' loop
   state:=plm.licensing_consolidation_operation_state(op);
   -- Revalidate the closed target at the final security-definer interpolation boundary.
   perform plm.licensing_operation_identity_predicate(op);
   -- Normalize timestamp/UUID representations through the actual row type;
   -- only updated_at is owned by the pre-existing automatic timestamp trigger.
   execute format('select to_jsonb(jsonb_populate_record(null::%s,$1))',op->>'target') into normalized_after using op->'after';
   -- The existing re-appearance trigger owns last_seen_at only on this exact
   -- non-no-op update path. Normalize its one trigger-derived value while keeping
   -- every other planned after-state field (and all no-op/insert/retire paths) exact.
   if op->>'kind'='entity_source'
      and op->>'target'='core.taxonomy_source_ref'
      and op->'before'->'rows'->0 is not null
      and not ((op->'before'->'rows'->0) @> (op->'after'))
      and op->'after'->'missing_since'='null'::jsonb
      and (
       (op->'after'->>'last_seen_at')::timestamptz is not distinct from
        (op->'before'->'rows'->0->>'last_seen_at')::timestamptz
       or ((op->'before'->'rows'->0->>'last_seen_at') is null
           and (op->'after'->>'last_seen_at')::timestamptz is not distinct from
               (op->'after'->>'first_seen_at')::timestamptz)
      ) then
    normalized_after:=normalized_after||jsonb_build_object(
      'last_seen_at',greatest((op->'after'->>'last_seen_at')::timestamptz,transaction_timestamp()));
   end if;
   select coalesce(jsonb_object_agg(k,normalized_after->k),'{}') into expected_row
    from jsonb_object_keys(op->'after') k where k<>'updated_at';
   if state->'rows'->0 is null or not (state->'rows'->0 @> expected_row) then
    raise exception 'physical applied operation does not fulfill its planned after-state' using errcode='42501';
   end if;
   changes:=case when state->'rows' is distinct from op->'before'->'rows' then 1 else 0 end;
   if op->>'kind'='property_name' then
    -- The existing apply counter counts both the property UPDATE and an
    -- actually inserted retained alias; an already-present alias adds zero.
    changes:=changes+(select count(*) from jsonb_array_elements(state->'aliases') a
     where not exists(select 1 from jsonb_array_elements(op->'before'->'aliases') b where b->>'id'=a->>'id'));
   end if;
   states:=states||jsonb_build_array(jsonb_build_object('op_key',op->>'op_key','state',state,'changes',changes));
   if op->>'kind' in ('entity_source','property_name') then entities:=entities+changes;else relationships:=relationships+changes;end if;
   if op->'after'->>'is_current'='false' or op->'after'->>'missing_since' is not null then retirements:=retirements+changes;end if;
  end loop;
  expected_state:=jsonb_build_object('operations',states,'entity_changes',entities,'relationship_changes',relationships,'retire_changes',retirements);
  if new.applied_state is distinct from expected_state or new.entity_operation_count is distinct from entities
     or new.relationship_operation_count is distinct from relationships or new.retire_operation_count is distinct from retirements then
   raise exception 'physical applied evidence or counters differ from actual operation states' using errcode='42501';
  end if;
 end if;
 return new;
end $immutable$;
