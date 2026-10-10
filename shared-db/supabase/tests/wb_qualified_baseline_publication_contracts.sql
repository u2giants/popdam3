-- #3682: Warner qualified-baseline publication contracts. Synthetic, rollback-only.
--
-- Scope of the claim, exactly: plm.sync_wb_normalized_target is the only body
-- that marks a Warner entity withdrawn, and it refuses unless the logical header
-- (chunk_number = 0) for the same target is 'validating'. No client or service
-- role may write plm.wb_capture directly, and plm.finalize_wb_capture is the only
-- function that sets 'validating' -- inside its own transaction, after taking the
-- serialized import lock and before proving chunk contiguity, the declared row
-- count and the digest chain. So, for every role except the database owner,
-- withdrawal is published only from a complete, authenticated, same-target
-- capture. finalize then clears chunk payloads, which is why a separate
-- after-the-fact publish function could not re-derive membership and is absent.
--
-- What this file does NOT execute, stated plainly:
--  * Cross-backend serialization. One session cannot observe contention and the
--    ephemeral lane has no dblink; the file proves at runtime that begin and
--    finalize both hold the one shared transaction-level lock key.
--  * The in-function authentication branch. SET ROLE does not change
--    session_user, and the harness connects as postgres, which the predicate
--    admits. As in wb_grants_rls_and_dam_order_list_invoker.sql section D, the
--    predicate is proven by its truth table, and client roles by the EXECUTE /
--    schema-USAGE denial they actually hit.
--  * wb_validate_normalized_row volatility (IMMUTABLE but TimeZone-dependent) is
--    tracked separately in #3725; it is structural and out of scope here.
--  * Index choice. The loader's identity OR-join cannot use the partial source
--    indexes; that is pre-existing loader shape, not changed or relied on here.

-- 1. Exact objects this contract depends on.
do $catalog$
declare
  v_fn regprocedure;
  v_col text;
  v_role text;
  v_privilege text;
  v_expected_config text[];
  v_wrappers text[];
begin
  foreach v_fn in array array[
    'plm.begin_wb_capture(text,date,text,text,integer,text,text,text)'::regprocedure,
    'plm.load_wb_chunk(uuid,integer,text,text)'::regprocedure,
    'plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure,
    'plm.fail_wb_capture(uuid,text)'::regprocedure,
    'plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception 'Warner capture function is no longer SECURITY DEFINER: %', v_fn;
    end if;
    if (select provolatile from pg_proc where oid = v_fn) <> 'v' then
      raise exception 'Warner capture function is no longer VOLATILE: %', v_fn;
    end if;
    v_expected_config := case when v_fn in ('plm.load_wb_chunk(uuid,integer,text,text)'::regprocedure,
                                            'plm.fail_wb_capture(uuid,text)'::regprocedure)
                              then array['search_path=plm, core, app, public, extensions']
                              else array['search_path=pg_catalog, extensions'] end;
    if (select proconfig from pg_proc where oid = v_fn) is distinct from v_expected_config then
      raise exception 'Warner capture function search_path changed: %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or exists (select 1 from pg_proc p2 cross join lateral aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                   where p2.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'Warner capture function is executable by a client role: %', v_fn;
    end if;
  end loop;

  -- Capture-layer authentication predicate.
  if (select provolatile from pg_proc where oid = 'plm.wb_loader_privilege_ok(text,text)'::regprocedure) <> 'i'
     or plm.wb_loader_privilege_ok(null, null)
     or plm.wb_loader_privilege_ok('authenticated', 'authenticator')
     or plm.wb_loader_privilege_ok('anon', 'authenticator')
     or not plm.wb_loader_privilege_ok('service_role', 'authenticator') then
    raise exception 'Warner loader authentication predicate changed';
  end if;

  -- Exact inventory, not a single-name absence check: every function in a
  -- non-system schema whose comment-stripped body references plm.wb_capture, or
  -- that mentions a withdrawn state together with a plm.wb_ table, is exactly
  -- these five. A new writer or a second publication path fails here by name.
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) into v_wrappers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral (select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '/\*.*?\*/', '', 'g') as src) b
   where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg\_%'
     and (b.src ~* 'plm\.wb_capture\M' or (b.src ~* 'withdrawn' and b.src ~* 'plm\.wb_'));
  if v_wrappers is distinct from array[
       'plm.apply_licensing_consolidation(uuid,text)',
       'plm.begin_wb_capture(text,date,text,text,integer,text,text,text)',
       'plm.fail_wb_capture(uuid,text)',
       'plm.finalize_wb_capture(uuid,text,numeric)',
       'plm.load_wb_chunk(uuid,integer,text,text)',
       'plm.plan_licensing_consolidation(text,uuid,text)',
       'plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)'] then
    raise exception 'Warner capture/withdrawal function inventory changed: %', v_wrappers;
  end if;
  -- Within that exact set (comments stripped), only sync marks withdrawals and
  -- no function other than finalize moves a wb_capture header to validating.
  if exists (select 1 from unnest(v_wrappers) w
              cross join lateral (select regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '/\*.*?\*/', '', 'g') as src
                                    from pg_proc where oid = w::regprocedure) b
              where (b.src ~* 'update\s+plm\.wb_\w+[^;]*status\s*=\s*''withdrawn''')
                    <> (w = 'plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)')
                 or (b.src ~* 'update\s+plm\.wb_capture\M[^;]*status\s*=\s*''validating'''
                     and w <> 'plm.finalize_wb_capture(uuid,text,numeric)')) then
    raise exception 'Warner withdrawal or validating writer moved inside the capture function set';
  end if;
  if position('status=''validating''' in (select prosrc from pg_proc where oid = 'plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure)) = 0 then
    raise exception 'finalize no longer sets the validating header state';
  end if;
  foreach v_role in array array['public','anon','authenticated','service_role'] loop
    foreach v_privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if (v_role = 'public' and exists (select 1 from aclexplode(coalesce((select relacl from pg_class where oid = 'plm.wb_capture'::regclass), '{}'::aclitem[])) a
                                        where a.grantee = 0 and a.privilege_type = v_privilege))
         or (v_role <> 'public' and has_table_privilege(v_role, 'plm.wb_capture', v_privilege)) then
        raise exception '% may % plm.wb_capture directly', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  -- Shape the direct inserts in section 2 depend on (20260810130000:195-239).
  if (select count(*) from pg_constraint
       where conrelid = 'plm.wb_capture'::regclass and contype = 'c' and convalidated
         and conname in ('wb_capture_header_shape_chk','wb_capture_chunk_shape_chk')) <> 2 then
    raise exception 'plm.wb_capture header/chunk shape checks changed';
  end if;
  foreach v_col in array array['capture_id','chunk_number','target','status','payload','payload_row_count','chunk_sha256','snapshot_sha256','expected_row_count','payload_cleared_at'] loop
    if not exists (select 1 from pg_attribute
                   where attrelid = 'plm.wb_capture'::regclass and attname = v_col and not attisdropped) then
      raise exception 'plm.wb_capture lost column %', v_col;
    end if;
  end loop;

  -- The eleven plm and eleven public per-target wrappers reach the loader; none is open to a client role.
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) into v_wrappers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('plm','public') and p.proname like 'sync\_wb\_%'
     and p.proname <> 'sync_wb_normalized_target' and p.proname <> 'sync_wb_canonical_relationship_edges';
  if coalesce(array_length(v_wrappers,1),0) <> 22 then
    raise exception 'Warner per-target wrapper inventory changed: %', coalesce(array_length(v_wrappers,1),0);
  end if;
  if exists (select 1 from unnest(v_wrappers) w
              where has_function_privilege('anon', w::regprocedure, 'execute')
                 or has_function_privilege('authenticated', w::regprocedure, 'execute')
                 or exists (select 1 from pg_proc p2 cross join lateral aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                             where p2.oid = w::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')) then
    raise exception 'a Warner per-target wrapper is executable by a client role';
  end if;

  -- Lifecycle invariants the publication assertions read as fact.
  if (select count(*) from pg_constraint
       where conrelid = 'plm.wb_franchise'::regclass and contype = 'c' and convalidated
         and conname in ('wb_franchise_lifecycle_status_chk','wb_franchise_withdrawn_at_chk')) <> 2
     or not exists (select 1 from pg_trigger
                     where tgrelid = 'plm.wb_franchise'::regclass and tgname = 'trg_wb_franchise_lifecycle'
                       and tgfoid = 'plm.enforce_wb_entity_lifecycle()'::regprocedure and not tgisinternal) then
    raise exception 'plm.wb_franchise lifecycle constraints or trigger changed';
  end if;

  foreach v_col in array array['source_namespace','source_id','fallback_key','status','withdrawn_at','first_withdrawn_at'] loop
    if not exists (select 1 from pg_attribute
                   where attrelid = 'plm.wb_franchise'::regclass and attname = v_col and not attisdropped) then
      raise exception 'plm.wb_franchise lost lifecycle column %', v_col;
    end if;
  end loop;
  if not (select contract_ok from api.wb_durable_entity_lifecycle_verification) then
    raise exception 'the #1881 durable lifecycle contract no longer holds';
  end if;

  if not exists (
    select 1 from pg_index i
     where i.indexrelid = to_regclass('plm.uq_wb_capture_one_in_flight_per_target')
       and i.indrelid = 'plm.wb_capture'::regclass
       and i.indisunique and i.indisvalid
       and pg_get_expr(i.indpred, i.indrelid) = '((chunk_number = 0) AND (status = ANY (ARRAY[''loading''::text, ''validating''::text])))'
  ) then
    raise exception 'one-in-flight-capture-per-target index changed';
  end if;
end
$catalog$;

-- 2. Runtime locking: begin and finalize both take the shared import lock.
-- Each probe runs in a subtransaction that is deliberately aborted. The harness
-- wraps this file in one top-level transaction, so the probes depend on a
-- transaction-level advisory lock taken inside a PL/pgSQL exception block being
-- released when that block aborts. That is not assumed: step 0 proves it on a
-- private key in this same transaction before either probe relies on it, and
-- docs/advisory-lock-registry.md rule 2 records the semantic.
do $locking$
declare
  c uuid := '99999999-9999-4999-8999-000000003682';
  p text := jsonb_build_array('{"source_namespace":"q3682","source_id":"lock","label":"Synthetic Lock","identity_method":"source_id","source_url":"https://example.invalid"}'::jsonb)::text;
  h text; m text; v_held boolean;
  v_lock_sql constant text := $q$select exists (
    select 1 from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1 and granted
      and classid::bigint = ((hashtext('plm.wb_capture_import')::bigint >> 32) & 4294967295)
      and objid::bigint = (hashtext('plm.wb_capture_import')::bigint & 4294967295))$q$;
begin
  h := encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex');
  m := encode(extensions.digest(convert_to(h,'UTF8'),'sha256'),'hex');

  -- Step 0: prove subtransaction-abort release on a private key (#3691 review B1).
  begin
    perform pg_advisory_xact_lock(3682, 3691);
    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                     and classid = 3682 and objid = 3691 and objsubid = 2 and granted) then
      raise exception 'semantic probe did not take its private lock';
    end if;
    raise exception using errcode = 'QA682', message = 'q3682 semantic probe rollback';
  exception when sqlstate 'QA682' then null;
  end;
  if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
               and classid = 3682 and objid = 3691 and objsubid = 2) then
    raise exception 'transaction-level advisory lock survived subtransaction abort; the lock probes cannot be trusted';
  end if;

  execute v_lock_sql into v_held;
  if v_held then raise exception 'import lock already held before the begin probe'; end if;
  begin
    perform plm.begin_wb_capture('wb_franchise',date '2099-03-10','q3682-lock-begin',m,1,'synthetic','https://example.invalid',null);
    execute v_lock_sql into v_held;
    if not v_held then raise exception 'begin_wb_capture did not take the import lock'; end if;
    raise exception using errcode = 'QA682', message = 'q3682 probe rollback';
  exception when sqlstate 'QA682' then null;
  end;

  execute v_lock_sql into v_held;
  if v_held then raise exception 'import lock still held before the finalize probe'; end if;
  begin
    insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
    values (c,0,'wb_franchise','loading',date '2099-03-11','q3682-lock-finalize',m,1,'synthetic','https://example.invalid',now());
    insert into plm.wb_capture(capture_id,chunk_number,payload,payload_row_count,chunk_sha256)
    values (c,1,p::jsonb,1,h);
    execute v_lock_sql into v_held;
    if v_held then raise exception 'direct header insert unexpectedly holds the import lock'; end if;
    perform plm.finalize_wb_capture(c,m,1);
    execute v_lock_sql into v_held;
    if not v_held then raise exception 'finalize_wb_capture did not take the import lock'; end if;
    raise exception using errcode = 'QA682', message = 'q3682 probe rollback';
  exception when sqlstate 'QA682' then null;
  end;
end
$locking$;

-- 3. Publication behavior.
begin;
do $publication$
declare
  r1 jsonb := '{"source_namespace":"q3682","source_id":"one","label":"Synthetic One","identity_method":"source_id","source_url":"https://example.invalid"}';
  r2 jsonb := '{"source_namespace":"q3682","source_id":"two","label":"Synthetic Two","identity_method":"source_id","source_url":"https://example.invalid"}';
  rp jsonb := '{"source_namespace":"warner_product_catalogue","source_id":"q3682-property","label":"Synthetic Property","identity_method":"source_id","source_url":"https://example.invalid"}';
  p_both text; p_one text; p_prop text; h_both text; h_one text; h_prop text; m_both text; m_one text; m_prop text;
  c uuid; rejected boolean; v_state text;
begin
  p_both := jsonb_build_array(r1, r2)::text;
  p_one := jsonb_build_array(r1)::text;
  p_prop := jsonb_build_array(rp)::text;
  h_both := encode(extensions.digest(convert_to(p_both,'UTF8'),'sha256'),'hex');
  h_one := encode(extensions.digest(convert_to(p_one,'UTF8'),'sha256'),'hex');
  h_prop := encode(extensions.digest(convert_to(p_prop,'UTF8'),'sha256'),'hex');
  m_both := encode(extensions.digest(convert_to(h_both,'UTF8'),'sha256'),'hex');
  m_one := encode(extensions.digest(convert_to(h_one,'UTF8'),'sha256'),'hex');
  m_prop := encode(extensions.digest(convert_to(h_prop,'UTF8'),'sha256'),'hex');

  -- Baseline: both identities active; payload cleared once published.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-01','q3682-base',m_both,2,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_both,h_both);
  perform plm.finalize_wb_capture(c,m_both,1);
  if (select count(*) from plm.wb_franchise where source_namespace='q3682' and status='active') <> 2 then
    raise exception 'baseline did not publish both identities';
  end if;
  if exists (select 1 from plm.wb_capture where capture_id=c and chunk_number>=1 and (payload is not null or payload_cleared_at is null)) then
    raise exception 'published capture kept its chunk payload';
  end if;

  -- Digest convention: chunk_sha256 is sha256 of the UTF-8 payload text and
  -- load_wb_chunk recomputes it; a wrong digest is refused.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-09','q3682-chunkhash',m_one,1,'synthetic','https://example.invalid',null);
  rejected := false;
  begin perform plm.load_wb_chunk(c,1,p_one,h_both);
  exception when sqlstate 'P0001' then rejected := position('failed its integrity check' in sqlerrm) > 0; end;
  if not rejected then raise exception 'load_wb_chunk accepted a chunk whose digest does not match its payload'; end if;
  perform plm.fail_wb_capture(c,'synthetic chunk digest mismatch');

  -- Partial run: declared two rows, streamed one.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-02','q3682-partial',m_one,2,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_one,h_one);
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_one,1);
  exception when sqlstate 'P0001' then rejected := position('incomplete chunk set' in sqlerrm) > 0; end;
  if not rejected then raise exception 'partial chunk set was published'; end if;
  perform plm.fail_wb_capture(c,'synthetic partial run');

  -- Digest mismatch: the chunk chain does not authenticate against the manifest.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-03','q3682-digest',m_both,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_one,h_one);
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_both,1);
  exception when sqlstate 'P0001' then rejected := position('manifest digest mismatch' in sqlerrm) > 0; end;
  if not rejected then raise exception 'mismatched manifest was published'; end if;
  perform plm.fail_wb_capture(c,'synthetic digest mismatch');

  -- Shrink bound enforced through finalize, not only on the direct loader.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-04','q3682-shrink',m_one,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_one,h_one);
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_one,0);
  exception when sqlstate 'P0001' then rejected := position('approved shrink bound' in sqlerrm) > 0; end;
  if not rejected then raise exception 'shrink bound was not enforced by finalize'; end if;
  perform plm.fail_wb_capture(c,'synthetic shrink refusal');

  -- Unauthenticated callers cannot publish.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-05','q3682-auth',m_one,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_one,h_one);
  foreach v_state in array array['anon','authenticated'] loop
    execute format('set local role %I', v_state);
    if current_user <> v_state then raise exception 'role switch to % did not take effect', v_state; end if;
    rejected := false;
    begin
      perform plm.finalize_wb_capture(c,m_one,1);
    -- anon has no USAGE on plm, so its denial names the schema; authenticated's names the function.
    exception when insufficient_privilege then
      rejected := position(case when v_state = 'anon' then 'schema plm' else 'function finalize_wb_capture' end in sqlerrm) > 0;
    end;
    reset role;
    if not rejected then raise exception '% was not refused at finalize', v_state; end if;
  end loop;

  -- A manifest other than the one declared at begin cannot certify the stream.
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_both,1);
  exception when sqlstate 'P0001' then rejected := position('invalid capture state or retired target' in sqlerrm) > 0; end;
  if not rejected then raise exception 'finalize accepted a manifest other than the declared one'; end if;
  if (select status from plm.wb_capture where capture_id=c and chunk_number=0) <> 'loading' then
    raise exception 'refused manifest changed the header state';
  end if;

  -- A failed capture can never be published afterwards.
  perform plm.fail_wb_capture(c,'synthetic failure');
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_one,1);
  exception when sqlstate 'P0001' then rejected := position('invalid capture state or retired target' in sqlerrm) > 0; end;
  if not rejected then raise exception 'failed capture was published'; end if;
  if (select status from plm.wb_capture where capture_id=c and chunk_number=0) <> 'failed' then
    raise exception 'failed capture changed state';
  end if;

  -- Every refusal above left lifecycle untouched.
  if exists(select 1 from plm.wb_franchise where source_namespace='q3682' and status<>'active')
     or (select count(*) from plm.wb_franchise where source_namespace='q3682') <> 2 then
    raise exception 'a refused run changed Warner lifecycle state';
  end if;

  -- Incompatible run: a qualified property capture does not touch franchise lifecycle.
  c := plm.begin_wb_capture('wb_property',date '2099-03-06','q3682-property',m_prop,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_prop,h_prop);
  perform plm.finalize_wb_capture(c,m_prop,1);
  if exists(select 1 from plm.wb_franchise where source_namespace='q3682' and status<>'active') then
    raise exception 'a property capture changed franchise lifecycle';
  end if;

  -- Qualified full baseline without "two": marked withdrawn, never deleted.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-07','q3682-withdraw',m_one,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_one,h_one);
  perform plm.finalize_wb_capture(c,m_one,1);
  if not exists(select 1 from plm.wb_franchise where source_namespace='q3682' and source_id='two'
                and status='withdrawn' and withdrawn_at is not null and first_withdrawn_at is not null)
     or not exists(select 1 from plm.wb_franchise where source_namespace='q3682' and source_id='one' and status='active') then
    raise exception 'qualified baseline did not mark exactly the absent identity withdrawn';
  end if;

  -- A completed capture cannot be published again or re-labelled.
  rejected := false;
  begin perform plm.finalize_wb_capture(c,m_one,1);
  exception when sqlstate 'P0001' then rejected := position('invalid capture state or retired target' in sqlerrm) > 0; end;
  if not rejected then raise exception 'completed capture was republished'; end if;
  rejected := false;
  begin perform plm.fail_wb_capture(c,'synthetic relabel');
  exception when sqlstate 'P0001' then rejected := position('is complete' in sqlerrm) > 0; end;
  if not rejected or (select status from plm.wb_capture where capture_id=c and chunk_number=0) <> 'complete' then
    raise exception 'a completed capture was re-labelled';
  end if;

  -- Reappearance in a later qualified baseline reactivates and keeps first withdrawal,
  -- and that history stays immutable.
  c := plm.begin_wb_capture('wb_franchise',date '2099-03-08','q3682-reappear',m_both,2,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,p_both,h_both);
  perform plm.finalize_wb_capture(c,m_both,1);
  if not exists(select 1 from plm.wb_franchise where source_namespace='q3682' and source_id='two'
                and status='active' and withdrawn_at is null and first_withdrawn_at is not null) then
    raise exception 'reappearance lost lifecycle history';
  end if;
  rejected := false;
  begin
    update plm.wb_franchise set first_withdrawn_at = first_withdrawn_at + interval '1 second'
     where source_namespace='q3682' and source_id='two';
  exception when sqlstate 'P0001' then rejected := position('immutable' in sqlerrm) > 0; end;
  if not rejected then raise exception 'first withdrawal history became mutable'; end if;
end
$publication$;
rollback;
