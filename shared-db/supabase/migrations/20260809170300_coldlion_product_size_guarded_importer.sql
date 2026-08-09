-- =====================================================================================
-- Issue #597 Phase 1 — guarded ColdLion MG04 Size importer.
--
-- SHAPE OF THE IMPORT
-- -------------------
-- The network half lives in tools/import-coldlion-product-size.mjs. It pages the
-- ColdLion feed FULLY, writes every fetched row into a landing table under one
-- run id, and then calls exactly one of the two functions below. The database half
-- — everything that can corrupt shared data — is here, in SQL, where it can be
-- tested and where a Node bug cannot route around it.
--
-- DRY RUN IS THE DEFAULT AND APPLY IS A SEPARATE, EXPLICIT ACT
-- ------------------------------------------------------------
-- A run is created with mode 'dry_run' or 'apply'. `ingest.apply_coldlion_product_size`
-- refuses to write unless BOTH the run was created as 'apply' AND the caller passes
-- p_apply => true. Two independent statements of intent, because one flag flipped by
-- accident is how unattended importers eat master data.
--
-- THE GUARDS, AND WHAT EACH ONE IS FOR
-- ------------------------------------
--   ADVISORY LOCK   Two concurrent runs would interleave upserts and retirements and
--                   produce a set that matches neither feed. Taken with
--                   pg_try_advisory_xact_lock and a LOUD failure — never a wait, and
--                   never a silent skip.
--   COUNT GUARD     A truncated feed is the classic silent disaster: it looks like a
--                   successful import that retires most of the catalogue. The landing
--                   set must fall inside an explicit band and every Size division must
--                   be represented.
--   PAYLOAD GUARD   Blank codes/labels, a wrong company, a non-'04' slot, or ANY
--                   EP001 row aborts the whole run. EP001 MG04 is Pages, not Size.
--   DELETE GUARD    Retirements (active rows absent from the feed) are capped. The
--                   expected steady-state number is ZERO: the 530 active identities
--                   are exactly the 530-row direct feed. Anything above the cap stops
--                   the run for a human instead of retiring the catalogue.
--   IDEMPOTENCY     A completed run replays its recorded result and writes nothing.
--   LOUD FAILURE    Every refusal RAISES. There is no code path that returns
--                   "succeeded" with fewer rows than it should have written, and no
--                   fallback that quietly does less.
--
-- NOTHING IS EVER DELETED. Retirement means status -> 'inactive' with retired_at set,
-- which is precisely the owner's rule: inactive values stay resolvable on existing
-- items and are never offered for a new selection.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Run ledger and landing table
-- -------------------------------------------------------------------------------------

create table if not exists ingest.coldlion_product_size_run (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  status ingest.sync_status not null default 'pending',
  requested_by text not null,
  source_endpoint text,
  page_count integer,
  fetched_row_count integer,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error_detail text,
  constraint coldlion_product_size_run_mode_allowed
    check (mode in ('dry_run', 'apply')),
  constraint coldlion_product_size_run_requested_by_not_blank
    check (length(btrim(requested_by)) > 0),
  constraint coldlion_product_size_run_result_is_object
    check (jsonb_typeof(result) = 'object'),
  constraint coldlion_product_size_run_page_count_sane
    check (page_count is null or page_count >= 0),
  constraint coldlion_product_size_run_failed_has_detail
    check (status <> 'failed' or error_detail is not null)
);

create index if not exists coldlion_product_size_run_status_started_idx
  on ingest.coldlion_product_size_run (status, started_at desc);

comment on table ingest.coldlion_product_size_run is
  'One row per ColdLion MG04 Size importer invocation. Append-only operational ledger: mode, guard outcomes, counts, and the plan or applied result. Issue #597 Phase 1.';

create table if not exists ingest.coldlion_product_size_landing (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references ingest.coldlion_product_size_run(id) on delete cascade,
  company_code  text not null,
  division_code text not null,
  mg_type_code  text not null,
  code          text not null,
  label         text not null,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  constraint coldlion_product_size_landing_company_not_blank
    check (length(btrim(company_code)) > 0),
  constraint coldlion_product_size_landing_division_not_blank
    check (length(btrim(division_code)) > 0),
  constraint coldlion_product_size_landing_mg_type_not_blank
    check (length(btrim(mg_type_code)) > 0),
  constraint coldlion_product_size_landing_code_not_blank
    check (length(btrim(code)) > 0),
  constraint coldlion_product_size_landing_label_not_blank
    check (length(btrim(label)) > 0),
  constraint coldlion_product_size_landing_raw_is_object
    check (jsonb_typeof(raw) = 'object'),
  constraint coldlion_product_size_landing_identity_unique
    unique (run_id, company_code, division_code, mg_type_code, code)
);

create index if not exists coldlion_product_size_landing_run_idx
  on ingest.coldlion_product_size_landing (run_id);

comment on table ingest.coldlion_product_size_landing is
  'Raw ColdLion MG04 rows for one importer run. Written by tools/import-coldlion-product-size.mjs BEFORE any guard runs, so a refused run still leaves the exact payload that was refused.';

alter table ingest.coldlion_product_size_run     enable row level security;
alter table ingest.coldlion_product_size_landing enable row level security;

revoke all on table ingest.coldlion_product_size_run     from public, anon, authenticated;
revoke all on table ingest.coldlion_product_size_landing from public, anon, authenticated;

grant all on table ingest.coldlion_product_size_run     to service_role;
grant all on table ingest.coldlion_product_size_landing to service_role;

-- -------------------------------------------------------------------------------------
-- 2. Authority assertion
-- -------------------------------------------------------------------------------------
--
-- Written the SAFE way round, and this repo has the scar to explain why. A guard
-- shaped `if not ( ... or auth.role() = 'service_role' ) then raise` is
-- NULL-PERMISSIVE: on a psql/pooler connection and inside a migration auth.role() is
-- NULL, every arm of the OR is NULL, `not (NULL)` is NULL, and the IF NEVER FIRES.
-- It reads strict and behaves wide open.
--
-- This one demands a NON-NULL effective role AND a POSITIVE allow-list match, and
-- REFUSES when it cannot determine a role at all.
--
-- current_user, not session_user: session_user does not follow SET ROLE, so a
-- connection that had done `SET ROLE service_role` still resolved as postgres and
-- escaped the binding (reproduced on preview 2026-08-02, fixed by 20260802160000).
-- This is only correct while the calling functions are SECURITY INVOKER, which they
-- are; under SECURITY DEFINER current_user becomes the owner and this would pass for
-- everyone.

create or replace function ingest.assert_coldlion_product_size_authority()
returns text
language plpgsql
stable
set search_path = ingest, public, auth
as $$
declare
  v_jwt_role  text;
  v_effective text;
  v_allowed   text[] := array['postgres', 'service_role', 'supabase_admin'];
begin
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  -- A PostgREST request arriving as anon or authenticated is refused here even
  -- though its session_user would be `authenticator`. Positive match, never a
  -- NULL-tolerant negation.
  if v_jwt_role is not null and not (v_jwt_role = any (v_allowed)) then
    raise exception
      'coldlion product size import is not permitted for request role %', v_jwt_role
      using errcode = 'P0001';
  end if;

  v_effective := coalesce(v_jwt_role, nullif(btrim(current_user::text), ''));

  if v_effective is null then
    raise exception
      'coldlion product size import requires a determinable database role; none was resolved'
      using errcode = 'P0001';
  end if;

  if not (v_effective = any (v_allowed)) then
    raise exception
      'coldlion product size import is not permitted for role %', v_effective
      using errcode = 'P0001';
  end if;

  return v_effective;
end;
$$;

comment on function ingest.assert_coldlion_product_size_authority() is
  'Defence-in-depth role assertion for the ColdLion MG04 Size importer. Requires a NON-NULL effective role AND a positive allow-list match, and REFUSES when no role can be resolved. Deliberately NOT written as `if not (... or auth.role() = ''service_role'')`, which never fires when auth.role() is NULL. The primary guard remains the total absence of ingest.* grants for browser roles.';

revoke all on function ingest.assert_coldlion_product_size_authority() from public, anon, authenticated;
grant execute on function ingest.assert_coldlion_product_size_authority() to service_role;

-- -------------------------------------------------------------------------------------
-- 3. The importer
-- -------------------------------------------------------------------------------------

create or replace function ingest.apply_coldlion_product_size(
  p_run_id           uuid,
  p_apply            boolean default false,
  p_min_rows         integer default 500,
  p_max_rows         integer default 700,
  p_max_retirements  integer default 10
)
returns jsonb
language plpgsql
volatile
set search_path = ingest, core, app, public, auth
as $$
declare
  v_size_divisions constant text[] := array['CW001', 'EH001', 'SP001'];
  v_company        constant text   := 'EDGEHOME';
  v_lock_key       constant bigint := hashtext('ingest.coldlion_product_size');

  v_actor       text;
  v_run         ingest.coldlion_product_size_run%rowtype;
  v_landing_n   integer;
  v_divisions   integer;
  v_bad_payload integer;
  v_ep001       integer;
  v_new_n       integer;
  v_label_n     integer;
  v_reactivate_n integer;
  v_retire_n    integer;
  v_plan        jsonb;
  v_applied     jsonb;
  v_now         timestamptz := now();
begin
  v_actor := ingest.assert_coldlion_product_size_authority();

  -- GUARD: serialization. try_ (not blocking) so a second run fails loudly and
  -- immediately instead of queueing behind the first and then applying to a database
  -- the first one has already changed underneath it.
  if not pg_try_advisory_xact_lock(v_lock_key) then
    raise exception
      'coldlion product size import refused: another import is already running (advisory lock % is held)',
      v_lock_key
      using errcode = 'P0001';
  end if;

  select * into v_run from ingest.coldlion_product_size_run where id = p_run_id for update;
  if not found then
    raise exception 'coldlion product size import refused: run % does not exist', p_run_id
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENCY: a finished run replays its recorded outcome and writes nothing.
  if v_run.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object(
      'run_id', v_run.id,
      'mode', v_run.mode,
      'status', v_run.status::text,
      'idempotent_replay', true,
      'result', v_run.result,
      'error_detail', v_run.error_detail
    );
  end if;

  if v_run.status = 'running' then
    raise exception
      'coldlion product size import refused: run % is already marked running', p_run_id
      using errcode = 'P0001';
  end if;

  -- Two independent statements of intent are required to write.
  if p_apply and v_run.mode <> 'apply' then
    raise exception
      'coldlion product size import refused: p_apply was true but run % was created in mode %',
      p_run_id, v_run.mode
      using errcode = 'P0001';
  end if;

  update ingest.coldlion_product_size_run set status = 'running' where id = p_run_id;

  -- ---------------------------------------------------------------------------------
  -- COUNT GUARD
  -- ---------------------------------------------------------------------------------
  select count(*), count(distinct division_code)
    into v_landing_n, v_divisions
    from ingest.coldlion_product_size_landing
    where run_id = p_run_id;

  if v_landing_n < p_min_rows or v_landing_n > p_max_rows then
    raise exception
      'coldlion product size import refused: landing holds % rows for run %, outside the accepted band %..%. A truncated or runaway feed must never be applied.',
      v_landing_n, p_run_id, p_min_rows, p_max_rows
      using errcode = 'P0001';
  end if;

  if v_divisions <> array_length(v_size_divisions, 1) then
    raise exception
      'coldlion product size import refused: landing covers % divisions for run %, expected all of %. A feed missing a whole division would retire that division wholesale.',
      v_divisions, p_run_id, v_size_divisions
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- PAYLOAD GUARD
  -- ---------------------------------------------------------------------------------
  select
    count(*) filter (
      where btrim(company_code) <> v_company
         or btrim(mg_type_code) <> '04'
         or not (btrim(division_code) = any (v_size_divisions))
    ),
    count(*) filter (where upper(btrim(division_code)) = 'EP001')
    into v_bad_payload, v_ep001
    from ingest.coldlion_product_size_landing
    where run_id = p_run_id;

  if v_ep001 > 0 then
    raise exception
      'coldlion product size import refused: % EP001 rows in run %. MG04 in EP001 means Pages, not Size, and must never enter core.product_size.',
      v_ep001, p_run_id
      using errcode = 'P0001';
  end if;

  if v_bad_payload > 0 then
    raise exception
      'coldlion product size import refused: % rows in run % have an unexpected company, merch-group slot, or division',
      v_bad_payload, p_run_id
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- PLAN — computed identically for dry run and apply, so the dry run is honest.
  -- ---------------------------------------------------------------------------------
  create temporary table tmp_cl_feed on commit drop as
  select btrim(company_code)  as company_code,
         btrim(division_code) as division_code,
         btrim(mg_type_code)  as mg_type_code,
         btrim(code)          as code,
         label
    from ingest.coldlion_product_size_landing
   where run_id = p_run_id;

  select count(*) into v_new_n
    from tmp_cl_feed f
    left join core.product_size ps
      on ps.company_code = f.company_code and ps.division_code = f.division_code
     and ps.mg_type_code = f.mg_type_code and ps.code = f.code
   where ps.id is null;

  select count(*) into v_label_n
    from tmp_cl_feed f
    join core.product_size ps
      on ps.company_code = f.company_code and ps.division_code = f.division_code
     and ps.mg_type_code = f.mg_type_code and ps.code = f.code
   where ps.label is distinct from f.label;

  select count(*) into v_reactivate_n
    from tmp_cl_feed f
    join core.product_size ps
      on ps.company_code = f.company_code and ps.division_code = f.division_code
     and ps.mg_type_code = f.mg_type_code and ps.code = f.code
   where ps.status <> 'active';

  select count(*) into v_retire_n
    from core.product_size ps
    left join tmp_cl_feed f
      on ps.company_code = f.company_code and ps.division_code = f.division_code
     and ps.mg_type_code = f.mg_type_code and ps.code = f.code
   where ps.status = 'active'
     and ps.division_code = any (v_size_divisions)
     and f.code is null;

  -- DELETE GUARD. Expected steady state is 0 retirements.
  if v_retire_n > p_max_retirements then
    raise exception
      'coldlion product size import refused: the feed would retire % active Size identities in run %, above the cap of %. Investigate the feed before re-running.',
      v_retire_n, p_run_id, p_max_retirements
      using errcode = 'P0001';
  end if;

  v_plan := jsonb_build_object(
    'landing_rows', v_landing_n,
    'divisions', v_divisions,
    'new_identities', v_new_n,
    'label_corrections', v_label_n,
    'reactivations', v_reactivate_n,
    'retirements', v_retire_n,
    'max_retirements_allowed', p_max_retirements,
    'guards_passed', jsonb_build_array(
      'advisory_lock', 'count_band', 'division_coverage', 'payload_shape',
      'ep001_exclusion', 'retirement_cap'
    )
  );

  -- ---------------------------------------------------------------------------------
  -- DRY RUN — stop here. Nothing in core.* has been touched.
  -- ---------------------------------------------------------------------------------
  if not p_apply then
    update ingest.coldlion_product_size_run
       set status = 'succeeded',
           finished_at = v_now,
           fetched_row_count = coalesce(fetched_row_count, v_landing_n),
           result = jsonb_build_object('dry_run', true, 'actor', v_actor, 'plan', v_plan)
     where id = p_run_id;

    return jsonb_build_object(
      'run_id', p_run_id, 'mode', v_run.mode, 'applied', false,
      'idempotent_replay', false, 'plan', v_plan
    );
  end if;

  -- ---------------------------------------------------------------------------------
  -- APPLY
  -- ---------------------------------------------------------------------------------

  -- New identities from the live feed. Labels are ColdLion's, and say so.
  insert into core.product_size (
    company_code, division_code, mg_type_code, code,
    label, label_source, status, last_seen_in_source_at, metadata
  )
  select f.company_code, f.division_code, f.mg_type_code, f.code,
         f.label, 'coldlion', 'active', v_now,
         jsonb_build_object('imported_by_run', p_run_id)
    from tmp_cl_feed f
  on conflict (company_code, division_code, mg_type_code, code) do update
  set label = excluded.label,
      label_source = 'coldlion',
      status = 'active',
      retired_at = null,      -- reactivation: the feed is offering it again
      last_seen_in_source_at = v_now,
      metadata = core.product_size.metadata || excluded.metadata,
      updated_at = now();

  -- Retirement. NEVER a delete: status flips to inactive and retired_at is stamped,
  -- so existing items keep resolving and pickers stop offering the value.
  update core.product_size ps
     set status = 'inactive',
         retired_at = v_now,
         updated_at = now()
   where ps.status = 'active'
     and ps.division_code = any (v_size_divisions)
     and not exists (
       select 1 from tmp_cl_feed f
        where f.company_code = ps.company_code and f.division_code = ps.division_code
          and f.mg_type_code = ps.mg_type_code and f.code = ps.code
     );

  -- Provenance for the live feed, one ref per identity per source system.
  insert into core.product_size_source_ref (
    product_size_id, source_system, source_table, source_id,
    source_code, source_label, source_is_active, metadata
  )
  select ps.id, 'coldlion', 'merchGroupDetails',
         f.company_code || '|' || f.division_code || '|' || f.mg_type_code || '|' || f.code,
         f.code, f.label, true,
         jsonb_build_object('last_run_id', p_run_id)
    from tmp_cl_feed f
    join core.product_size ps
      on ps.company_code = f.company_code and ps.division_code = f.division_code
     and ps.mg_type_code = f.mg_type_code and ps.code = f.code
  on conflict (source_system, source_table, source_id) do update
  set product_size_id = excluded.product_size_id,
      source_label    = excluded.source_label,
      source_is_active = true,
      metadata        = core.product_size_source_ref.metadata || excluded.metadata,
      captured_at     = v_now;

  v_applied := v_plan || jsonb_build_object('applied', true, 'actor', v_actor, 'applied_at', v_now);

  update ingest.coldlion_product_size_run
     set status = 'succeeded',
         finished_at = v_now,
         fetched_row_count = coalesce(fetched_row_count, v_landing_n),
         result = v_applied
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id, 'mode', v_run.mode, 'applied', true,
    'idempotent_replay', false, 'plan', v_plan
  );
end;
$$;

comment on function ingest.apply_coldlion_product_size(uuid, boolean, integer, integer, integer) is
  'Guarded ColdLion MG04 Size importer. Dry-run by default; writing requires BOTH run.mode=''apply'' AND p_apply=true. Takes a non-blocking advisory lock, enforces a landing-row count band, full division coverage, payload shape, absolute EP001 exclusion, and a retirement cap. Retirement sets status=inactive and never deletes. Completed runs replay idempotently. Every refusal RAISES; there is no path that reports success having written less than planned. Issue #597 Phase 1.';

revoke all on function ingest.apply_coldlion_product_size(uuid, boolean, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function ingest.apply_coldlion_product_size(uuid, boolean, integer, integer, integer)
  to service_role;
