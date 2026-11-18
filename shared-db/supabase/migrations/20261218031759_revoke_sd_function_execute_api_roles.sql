-- #6455: revoke superfluous anon/authenticated EXECUTE on the 17 security-
-- definer function signatures the #6416 measurement dispositioned `revoke`.
-- Part of the #2326 program (database efficiency & Data API security).
--
-- Evidence: docs/verification/database-efficiency/20261116T050000Z-step6-
-- 6416-sd-rpc-matrix/sd-rpc-matrix.md (2026-11-16).
--
-- WHY
-- ---
-- The #6416 disposition rule ("not-in-pgrst.db_schemas -> API-role grant is
-- superfluous") is mechanical and missed the deliberate SQL-consumer contracts
-- on the plm/dam functions (see CARVE-OUT below). What IS superfluous and is
-- revoked here:
--   * PUBLIC/anon EXECUTE everywhere in scope (the function-default ACL is the
--     real grant on most of these — revoking `from anon, authenticated` alone
--     is a NO-OP, same trap as #6415 and the 2026-07-29 lockdown);
--   * authenticated EXECUTE on the 6 dflow_prod.* signatures and on
--     public.lock_down_new_public_function_execute — their creating migrations
--     grant only to service_role / designflow_prod_*_grants roles, so the
--     API-role grant is pure surface (and lock_down is an event-trigger
--     function, not an RPC — same class as #6415);
--   * net.http_get / net.http_post are attempted but land on the platform
--     boundary (below) — their anon grant is a landmine if `net` ever enters
--     pgrst.db_schemas.
--
-- CARVE-OUT — deliberate `to authenticated, service_role` grants (8 signatures)
-- -----------------------------------------------------------------------
-- dam.orderlist_sales_order_received_date(text) (20261019113819:57),
-- plm.coldlion_merch_group_candidates(text,text) (20261011224904:681,
--   issue #2176 unit 6),
-- plm.latest_sesame_capture() (20260819212002:2343-2344),
-- plm.prepack_role(text,text,text) (20260917081048:74),
-- plm.set_source_resolution x2 overloads (20260814224937:282,
--   20260902024541:390, 20260907051735:413),
-- plm.source_resolution_target_missing x2 overloads (20260902024541:149,
--   20260911045438:70).
-- Each creating migration does `revoke all ... from public, anon` then
-- `grant execute ... to authenticated, service_role` — `authenticated` is an
-- intended SQL consumer (exercised as `set local role authenticated` in
-- supabase/tests/source_resolution_coherence_contracts.sql and required by
-- supabase/tests/coldlion_unit6_consumer_contracts.sql). For these 8 the
-- revoke is `from public, anon` ONLY (their public/anon is already revoked by
-- the creating migrations, so this is an idempotent re-assertion) and
-- `authenticated` is kept. The #6416 mechanical disposition missed this
-- caller class; the contract tests caught it on the ephemeral lane.
--
-- PLATFORM-OWNED BOUNDARY — net.http_get / net.http_post (live-proven
-- 2026-11-17 on preview, read-back after REVOKE as `postgres`): both are
-- owned by `supabase_admin` and their PUBLIC EXECUTE is granted BY
-- supabase_admin (proacl after REVOKE: {=X/supabase_admin, ...};
-- has_function_privilege('anon'|'authenticated', ...) stays TRUE). A REVOKE
-- from a role that neither owns the object nor made the grant is ACCEPTED as
-- a statement and is a SILENT NO-OP: it strips only grants made by the
-- migration role and raises no error, so no exception can be caught. This is
-- the same boundary class #6415 recorded for the platform-owned trigger
-- functions: the Prime Directive keeps this repo out of vendor/platform
-- objects, and `postgres` is not a member of supabase_admin. Environments
-- where the migration role does own the functions still get the revoke.
-- The post-loop classification therefore keys on OWNERSHIP, not on errors:
-- any in-scope signature that still carries API EXECUTE and is NOT owned by
-- the migration role is recorded as the platform boundary (NOTICE, named);
-- any such signature that IS owned by the migration role aborts the
-- migration. A wrong migration role (owns nothing in scope while functions
-- are present) also aborts — an unrevocable apply must not read green.
--
-- WHY `from public, anon, authenticated` AND NOT JUST `from anon, authenticated`
-- -----------------------------------------------------------------------
-- Most of these functions carry no explicit role grant at all: their ACL is
-- the function default (PUBLIC EXECUTE). Revoking the named roles alone is a
-- no-op — anon/authenticated still hold EXECUTE through PUBLIC and the census
-- query would never drop. The PUBLIC pseudo-role is the real grant here (same
-- trap as #6415 and the 2026-07-29 public EXECUTE lockdown). postgres /
-- service_role / admin-role / designflow_prod_*_grants grants are untouched.
--
-- SCOPE (pinned at authoring time 2026-11-18 12:40 AM EST)
-- -----
-- The 17 exact signatures in the VALUES list below — 15 function names, with
-- plm.set_source_resolution and plm.source_resolution_target_missing each
-- carrying two overloads. NOT in scope: the api.set_source_resolution /
-- dflow.record_item_workflow_action / dflow.set_item_user_assignment
-- same-named functions (their schemas differ and are dispositioned
-- separately) and public.rls_auto_enable (#6456, another agent's object).
--
-- Existence-guarded loop (repository pattern 20260729130000_production_safe_
-- public_execute_lockdown.sql): each signature is resolved through
-- to_regprocedure and skipped when absent, so this migration cannot abort on
-- an environment where one of the functions has not been created (preview and
-- production have diverged in both directions — standing fact 11). REVOKE of
-- an unheld privilege is a silent no-op, so re-running is harmless.
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration re-granting EXECUTE on exactly these signatures.
-- Full-revoke signatures (restore `to public, anon, authenticated`):
--   grant execute on function dflow_prod.claim_sample_shipment_notice(bigint) to public, anon, authenticated;
--   grant execute on function dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text) to public, anon, authenticated;
--   grant execute on function dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb) to public, anon, authenticated;
--   grant execute on function dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) to public, anon, authenticated;
--   grant execute on function dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text) to public, anon, authenticated;
--   grant execute on function dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb) to public, anon, authenticated;
--   grant execute on function public.lock_down_new_public_function_execute() to public, anon, authenticated;
-- Carve-out signatures (this migration only re-asserts `from public, anon`;
-- their pre-change state is `to authenticated, service_role` per the creating
-- migrations above — the rollback restores that exact grant set and does NOT
-- re-grant public/anon):
--   grant execute on function dam.orderlist_sales_order_received_date(text) to authenticated, service_role;
--   grant execute on function plm.coldlion_merch_group_candidates(text,text) to authenticated, service_role;
--   grant execute on function plm.latest_sesame_capture() to authenticated, service_role;
--   grant execute on function plm.prepack_role(text,text,text) to authenticated, service_role;
--   grant execute on function plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone) to authenticated, service_role;
--   grant execute on function plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid) to authenticated, service_role;
--   grant execute on function plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid) to authenticated, service_role;
--   grant execute on function plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated, service_role;
-- net.http_* re-grants are refused on the same ownership boundary as the
-- revoke (supabase_admin-owned) and need platform action to restore. The event
-- trigger that installs lock_down_new_public_function_execute is unaffected:
-- trigger creation checks EXECUTE at CREATE TRIGGER time and the event trigger
-- itself fires as its owner.

begin;

do $$
declare
  r record;
  n integer := 0;
  absent integer := 0;
  owner_oid oid;
  owned_count integer;
  boundary_count integer;
  boundary text;
  leftover_count integer;
  leftover text;
  carve_out constant text[] := array[
    'dam.orderlist_sales_order_received_date(text)',
    'plm.coldlion_merch_group_candidates(text,text)',
    'plm.latest_sesame_capture()',
    'plm.prepack_role(text,text,text)',
    'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)',
    'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)',
    'plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)',
    'plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)'
  ];
begin
  select oid into owner_oid from pg_roles where rolname = current_user;

  for r in
    select t.sig
    from (values
      ('dam.orderlist_sales_order_received_date(text)'),
      ('dflow_prod.claim_sample_shipment_notice(bigint)'),
      ('dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)'),
      ('dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)'),
      ('dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)'),
      ('dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)'),
      ('dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)'),
      ('net.http_get(text,jsonb,jsonb,integer)'),
      ('net.http_post(text,jsonb,jsonb,jsonb,integer)'),
      ('plm.coldlion_merch_group_candidates(text,text)'),
      ('plm.latest_sesame_capture()'),
      ('plm.prepack_role(text,text,text)'),
      ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)'),
      ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
      ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'),
      ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)'),
      ('public.lock_down_new_public_function_execute()')
    ) as t(sig)
  loop
    if to_regprocedure(r.sig) is null then
      absent := absent + 1;
      raise notice 'signature absent on this database, skipped: %', r.sig;
    else
      begin
        execute format(
          case when r.sig = any (carve_out)
            then 'revoke execute on function %s from public, anon'
            else 'revoke execute on function %s from public, anon, authenticated'
          end, r.sig);
        n := n + 1;
      exception
        when insufficient_privilege then
          raise notice 'REVOKE refused (insufficient privilege) - classified by ownership below: %', r.sig;
      end;
    end if;
  end loop;

  raise notice 'revoked EXECUTE on % of 17 in-scope signatures (% absent)', n, absent;

  -- Wrong-role guard: if in-scope functions exist but the migration role owns
  -- none of them, this is not the role the postgres-owned functions belong to
  -- (live pin 2026-11-17) — an unrevocable apply must not read green.
  select count(*) into owned_count
  from (values
    ('dam.orderlist_sales_order_received_date(text)'),
    ('dflow_prod.claim_sample_shipment_notice(bigint)'),
    ('dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)'),
    ('dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)'),
    ('dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)'),
    ('dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)'),
    ('dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)'),
    ('net.http_get(text,jsonb,jsonb,integer)'),
    ('net.http_post(text,jsonb,jsonb,jsonb,integer)'),
    ('plm.coldlion_merch_group_candidates(text,text)'),
    ('plm.latest_sesame_capture()'),
    ('plm.prepack_role(text,text,text)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.lock_down_new_public_function_execute()')
  ) as t(sig)
  where to_regprocedure(t.sig) is not null
    and (select p.proowner from pg_proc p where p.oid = to_regprocedure(t.sig)) = owner_oid;

  if owned_count = 0 and absent < 17 then
    raise exception
      'migration role % owns none of the % in-scope functions present on this database - wrong role?',
      current_user, 17 - absent;
  end if;

  -- Platform boundary: in-scope signatures that still carry API EXECUTE and
  -- are NOT owned by the migration role (the REVOKE was a silent no-op on a
  -- grant the migration role did not make). Recorded, named, not silent.
  select count(*), string_agg(t.sig, ', ')
    into boundary_count, boundary
  from (values
    ('dam.orderlist_sales_order_received_date(text)'),
    ('dflow_prod.claim_sample_shipment_notice(bigint)'),
    ('dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)'),
    ('dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)'),
    ('dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)'),
    ('dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)'),
    ('dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)'),
    ('net.http_get(text,jsonb,jsonb,integer)'),
    ('net.http_post(text,jsonb,jsonb,jsonb,integer)'),
    ('plm.coldlion_merch_group_candidates(text,text)'),
    ('plm.latest_sesame_capture()'),
    ('plm.prepack_role(text,text,text)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.lock_down_new_public_function_execute()')
  ) as t(sig)
  where to_regprocedure(t.sig) is not null
    and (has_function_privilege('anon', to_regprocedure(t.sig)::oid, 'EXECUTE')
      or has_function_privilege('authenticated', to_regprocedure(t.sig)::oid, 'EXECUTE'))
    and (select p.proowner from pg_proc p where p.oid = to_regprocedure(t.sig)) <> owner_oid;

  if boundary_count > 0 then
    raise notice
      'platform-owned boundary - % signature(s) still API-executable, grant belongs to a non-migration owner: %',
      boundary_count, boundary;
  end if;

  -- Assert: no in-scope signature OWNED BY THE MIGRATION ROLE still grants
  -- what this migration means to remove: anon EXECUTE anywhere, or
  -- authenticated EXECUTE outside the carve-out (whose deliberate
  -- authenticated grant is kept).
  select count(*), string_agg(t.sig, ', ')
    into leftover_count, leftover
  from (values
    ('dam.orderlist_sales_order_received_date(text)'),
    ('dflow_prod.claim_sample_shipment_notice(bigint)'),
    ('dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)'),
    ('dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)'),
    ('dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)'),
    ('dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)'),
    ('dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)'),
    ('net.http_get(text,jsonb,jsonb,integer)'),
    ('net.http_post(text,jsonb,jsonb,jsonb,integer)'),
    ('plm.coldlion_merch_group_candidates(text,text)'),
    ('plm.latest_sesame_capture()'),
    ('plm.prepack_role(text,text,text)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)'),
    ('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'),
    ('plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.lock_down_new_public_function_execute()')
  ) as t(sig)
  where to_regprocedure(t.sig) is not null
    and (has_function_privilege('anon', to_regprocedure(t.sig)::oid, 'EXECUTE')
      or (not (t.sig = any (carve_out))
          and has_function_privilege('authenticated', to_regprocedure(t.sig)::oid, 'EXECUTE')))
    and (select p.proowner from pg_proc p where p.oid = to_regprocedure(t.sig)) = owner_oid;

  if leftover_count > 0 then
    raise exception
      'in-scope signatures owned by migration role % still API-executable after revoke: %',
      current_user, leftover;
  end if;
end
$$;

commit;
