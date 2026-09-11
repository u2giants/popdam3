-- Concurrency contract for issue #2008:
-- api.db_data_admin_decide_property_match, CONCURRENT idempotency branch.
--
-- The sequential branch is covered by property_match_decision_contracts.sql.
-- This file covers the OTHER branch: the in-function exception handler that
-- runs when a second caller commits first and this call's insert hits a unique
-- violation. That branch must apply the SAME test as the sequential one -- same
-- reviewed row, same decision, same member set -- and must raise rather than
-- hand back another caller's verdict as if it were this caller's own repeat.
-- Returning the wrong verdict there is a royalty-attribution error.
--
-- Reaching that branch REQUIRES a real committed race: an uncommitted row is
-- waited on, not conflicted with, so the winning decision has to be committed
-- by a second session while this one is already inside the function. dblink
-- cannot open that second session here (it refuses a connection that did not
-- authenticate with a password, and this harness authenticates by trust), so
-- the second session is a background psql started from this one. It holds its
-- transaction open for a few seconds, and that is the window this session runs
-- its own losing call inside.
--
-- Consequence, stated plainly: the winner's rows COMMIT and the decision ledger
-- is append-only by design, so those rows cannot be removed afterwards. Every
-- fixture is synthetic and negative-keyed, no licensed row is used, the raced
-- identities end APPROVED (never pending, so they can never appear in the
-- review queue), and the only cleanup possible -- the temporary role grants --
-- is performed at the end.

-- Values are generated here and handed to the background session, so both
-- sessions decide the same rows with the same client request ids.
select
  gen_random_uuid()::text as pm_pending_1,
  gen_random_uuid()::text as pm_pending_2,
  gen_random_uuid()::text as pm_request_1,
  gen_random_uuid()::text as pm_request_2,
  (-200800002001 - (abs(hashtext(gen_random_uuid()::text)) % 100000) * 10)::text as pm_opa_a,
  (-200800002002 - (abs(hashtext(gen_random_uuid()::text)) % 100000) * 10)::text as pm_opa_b,
  'Issue2008C-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) as pm_tag
\gset

select
  :'pm_tag' || '/1' as pm_src1,
  :'pm_tag' || '/2' as pm_src2,
  :'pm_tag' || ' One' as pm_nm1,
  :'pm_tag' || ' Two' as pm_nm2,
  :'pm_tag' || ' OPA A' as pm_opa_a_nm,
  :'pm_tag' || ' OPA B' as pm_opa_b_nm
\gset

select
  p.id::text as pm_profile,
  p.auth_user_id::text as pm_auth,
  (select r.id::text from app.role r where r.slug = 'licensing'::app.app_role) as pm_role
from app.profile p
where p.status = 'active' and p.auth_user_id is not null
order by p.created_at, p.id
limit 1
\gset

-- Committed setup, in its own session: the racing session cannot see anything
-- this test transaction writes.

-- \! hands its line to the shell verbatim -- psql does NOT interpolate
-- variables there -- so the values cross into the second session through the
-- environment instead.
\setenv PM_PROFILE :pm_profile
\setenv PM_ROLE :pm_role
\setenv PM_AUTH :pm_auth
\setenv PM_P1 :pm_pending_1
\setenv PM_P2 :pm_pending_2
\setenv PM_R1 :pm_request_1
\setenv PM_R2 :pm_request_2
\setenv PM_A :pm_opa_a
\setenv PM_B :pm_opa_b
\setenv PM_SRC1 :pm_src1
\setenv PM_SRC2 :pm_src2
\setenv PM_NM1 :pm_nm1
\setenv PM_NM2 :pm_nm2
\setenv PM_ANM :pm_opa_a_nm
\setenv PM_BNM :pm_opa_b_nm

\! psql -v ON_ERROR_STOP=1 -q --no-psqlrc -c "insert into app.user_role (profile_id, role_id) values ('$PM_PROFILE', '$PM_ROLE') on conflict do nothing; insert into app.app_access (profile_id, app) values ('$PM_PROFILE', 'plm') on conflict do nothing; insert into plm.opa_property (licensed_property_id, property_name) values ($PM_A, '$PM_ANM'), ($PM_B, '$PM_BNM'); insert into plm.dcp_property (source_system, source_id, display_name) values ('disney_dcpvault', '$PM_SRC1', '$PM_NM1'), ('disney_dcpvault', '$PM_SRC2', '$PM_NM2'); insert into plm.dcp_opa_property_resolution (resolution_id, source_system, source_table, source_property_id, decision_version, approval_status, evidence_reference, evidence_sha256, decision_reason) values ('$PM_P1', 'disney_dcpvault', 'plm.dcp_property', '$PM_SRC1', 1, 'pending', 'synthetic-race-1', repeat('d', 64), 'synthetic pending one'), ('$PM_P2', 'disney_dcpvault', 'plm.dcp_property', '$PM_SRC2', 1, 'pending', 'synthetic-race-2', repeat('e', 64), 'synthetic pending two');"

-- ----------------------------------------------------------------------
-- RACE 1 -- DIVERGENT. The background session approves and holds its
-- transaction open; this session reuses the same client request id for a
-- REJECT and must be refused rather than handed the approval.
-- ----------------------------------------------------------------------
\! (psql -v ON_ERROR_STOP=1 -q --no-psqlrc -c "select set_config('request.jwt.claim.sub', '$PM_AUTH', false); select api.db_data_admin_decide_property_match('$PM_P1', 'approve', array[$PM_A, $PM_B]::bigint[], 'race winner approval', '$PM_R1'); select pg_sleep(4);" > /dev/null 2>&1) &

begin;

select set_config('pm_race.auth', :'pm_auth', true),
       set_config('pm_race.pending_1', :'pm_pending_1', true),
       set_config('pm_race.request_1', :'pm_request_1', true);

do $t$
declare
  v_raised boolean := false;
  v_message text;
  v_result jsonb;
  v_status text;
  v_version bigint;
begin
  perform set_config('request.jwt.claim.sub', current_setting('pm_race.auth'), true);

  -- The winner is inside its open transaction; this call must get past its own
  -- pre-check while the winning row is still invisible, and then collide.
  perform pg_sleep(1.5);

  begin
    v_result := api.db_data_admin_decide_property_match(
      current_setting('pm_race.pending_1')::uuid, 'reject', '{}'::bigint[],
      'race loser rejection', current_setting('pm_race.request_1')::uuid);
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  if not v_raised then
    raise exception
      'the concurrent branch returned % instead of refusing a different decision on a spent client request id',
      v_result;
  end if;
  if position('already recorded a different decision' in v_message) = 0 then
    raise exception 'the concurrent branch refused for the wrong reason: %', v_message;
  end if;

  -- The winner's decision must stand, untouched by the refused loser.
  select r.approval_status, r.decision_version into v_status, v_version
  from plm.dcp_opa_property_resolution r
  where r.resolution_id = current_setting('pm_race.request_1')::uuid;
  if v_status is distinct from 'approved' or v_version is distinct from 2 then
    raise exception 'the winning decision was not preserved: % / %', v_status, v_version;
  end if;
  if (select count(*) from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = current_setting('pm_race.request_1')::uuid) <> 2 then
    raise exception 'the winning decision lost its members';
  end if;
  if (select count(*) from plm.dcp_opa_property_resolution r
      where r.supersedes_resolution_id = current_setting('pm_race.pending_1')::uuid) <> 1 then
    raise exception 'the refused loser still appended a version';
  end if;
end $t$;

rollback;

-- ----------------------------------------------------------------------
-- RACE 2 -- IDENTICAL. The same guard must NOT turn a genuine retry into a
-- failure: an identical losing call is still an idempotent repeat.
-- ----------------------------------------------------------------------
\! (psql -v ON_ERROR_STOP=1 -q --no-psqlrc -c "select set_config('request.jwt.claim.sub', '$PM_AUTH', false); select api.db_data_admin_decide_property_match('$PM_P2', 'approve', array[$PM_A]::bigint[], 'race winner approval two', '$PM_R2'); select pg_sleep(4);" > /dev/null 2>&1) &

begin;

select set_config('pm_race.auth', :'pm_auth', true),
       set_config('pm_race.pending_2', :'pm_pending_2', true),
       set_config('pm_race.request_2', :'pm_request_2', true),
       set_config('pm_race.opa_a', :'pm_opa_a', true);

do $t$
declare
  v_raised boolean := false;
  v_message text;
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', current_setting('pm_race.auth'), true);
  perform pg_sleep(1.5);

  begin
    v_result := api.db_data_admin_decide_property_match(
      current_setting('pm_race.pending_2')::uuid, 'approve',
      array[current_setting('pm_race.opa_a')::bigint]::bigint[],
      'race winner approval two', current_setting('pm_race.request_2')::uuid);
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  if v_raised then
    raise exception 'an identical concurrent retry was refused: %', v_message;
  end if;
  if not coalesce((v_result ->> 'idempotent_repeat')::boolean, false) then
    raise exception 'an identical concurrent retry was not reported as a repeat: %', v_result;
  end if;
  if (v_result ->> 'resolution_id') <> current_setting('pm_race.request_2') then
    raise exception 'an identical concurrent retry returned the wrong decision: %', v_result;
  end if;
  if (select count(*) from plm.dcp_opa_property_resolution r
      where r.supersedes_resolution_id = current_setting('pm_race.pending_2')::uuid) <> 1 then
    raise exception 'an identical concurrent retry appended an extra version';
  end if;
end $t$;

rollback;

-- Cleanup of everything that CAN be cleaned. The ledger is append-only, so the
-- raced identities remain -- approved, never pending.
\! psql -v ON_ERROR_STOP=1 -q --no-psqlrc -c "delete from app.app_access where profile_id = '$PM_PROFILE' and app = 'plm'; delete from app.user_role where profile_id = '$PM_PROFILE' and role_id = '$PM_ROLE';"

begin;
rollback;
