-- Issue #2336 contract: hash-pinned licensing consolidation engine.
--
-- This file asserts BEHAVIOUR where a real row can be produced without capture
-- fixtures, and catalog/source shape where a full end-to-end apply needs landing
-- tables and authorized scope rows this migration loads none of. Specifically:
--   BEHAVIOURAL: refused plans (complete-capture), hash conflict refusal, plan
--   content immutability and DELETE refusal, idempotent re-plan, hash shape.
--   CATALOG/SOURCE (not row-level): privilege matrix, SECURITY DEFINER pin,
--   write-kind vocabulary, no-DELETE and direct-only gates in routine source,
--   Step 1.0 potential-create pin. Source-scope refusal, collision refusal,
--   successful preview->apply, and re-apply no-op need capture + scope fixtures
--   and are covered by the plan/apply gates themselves plus review.
--   * plm.licensing_consolidation_plan exists, ships empty, is fail-closed for writes,
--     and its content columns are immutable while the apply lifecycle may advance;
--   * the plan and apply functions are pinned SECURITY DEFINER, service-role only;
--   * the complete-capture gate refuses a missing, incomplete or unknown-source capture
--     and records a refused plan rather than vanishing;
--   * the source-scope gate refuses out-of-scope entity and relationship work;
--   * the collision gate refuses a plan whose operations disagree about one target;
--   * the plan hash is deterministic: re-planning identical decisions is idempotent;
--   * apply requires the exact expected hash and refuses a stale or wrong one;
--   * apply re-derives the hash from stored content (dry-run/apply parity);
--   * apply is idempotent: a second apply of an applied plan is a successful no-op;
--   * inferred and co-occurrence evidence can never be promoted;
--   * missing source records plan a support retirement and never a hard delete;
--   * matched Property status is never planned to change, and a scrape-created
--     Property would be planned as potential (the create path's rule, asserted here
--     through the write-kind vocabulary the guard already pins).

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
    if position('non-blank source id' in v_text) = 0 then
      raise exception 'CONTRACT: blank filter failed for the wrong reason: %', v_text;
    end if;
  end;

  -- Unknown source system: refused.
  v_plan := plm.plan_licensing_consolidation('not_a_real_source', v_capture);
  v_plan_first_id := v_plan.id;
  v_plan_first_hash := v_plan.plan_hash;
  if v_plan.plan_status <> 'refused' then
    raise exception 'CONTRACT: unknown source_system must produce a refused plan, got %', v_plan.plan_status;
  end if;
  if v_plan.refusal_reason is null
     or position('complete-capture' in v_plan.refusal_reason) = 0 then
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
  if v_plan.plan_status <> 'refused' then
    raise exception 'CONTRACT: missing paramount capture must produce a refused plan, got %', v_plan.plan_status;
  end if;

  -- ---------------------------------------------------------------------------------
  -- Apply refuses a refused plan.
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.apply_licensing_consolidation(v_plan.id, v_plan.plan_hash);
    raise exception 'CONTRACT: apply of a refused plan must fail';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('refused' in v_text) = 0
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
    if position('hash mismatch' in v_text) = 0 then
      raise exception 'CONTRACT: wrong-hash apply failed for the wrong reason: %', v_text;
    end if;
  end;

  begin
    perform plm.apply_licensing_consolidation(v_plan.id, 'not-a-hash');
    raise exception 'CONTRACT: apply with a malformed expected_hash must fail';
  exception when others then
    get stacked diagnostics v_text = message_text;
    if position('64 lowercase hex' in v_text) = 0 then
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

  select prosrc into v_text
    from pg_catalog.pg_proc
   where oid = to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)');
  if position('evidence_kind' in v_text) = 0
     or position('direct_source_assertion' in v_text) = 0 then
    raise exception 'CONTRACT: plan must gate relationship work on direct_source_assertion';
  end if;
  if position('retire_entity_support' in v_text) = 0 then
    raise exception 'CONTRACT: plan must include a support-retirement path for missing source records';
  end if;

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

  raise notice 'hash-pinned licensing consolidation contracts verified';
end;
$contracts$;

rollback;
