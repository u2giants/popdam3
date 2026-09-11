-- Issue #2094: ColdLion raw landing Step 2 — the six master landing tables.
-- derived-from: none
--
-- WHAT THIS FILE ACTUALLY CREATES, AND WHY IT IS SMALLER THAN THE ISSUE.
--
-- Issue #2094 asks for the `coldlion` schema and the six master landing tables
-- of docs/coldlion-raw-landing-schema-design.md §3.1. Four of the six, and the
-- schema itself, are ALREADY ON main and were verified before this file was
-- written:
--
--   * schema `coldlion`               — 20260818232639 (issue #1184 phase 1)
--   * coldlion.merch_group_header     — 20260825023430 (issue #1184 phases 2-6)
--   * coldlion.merch_group_detail     — 20260825023430, already carrying the
--                                       mandatory FOUR-part natural key
--   * coldlion.customer               — 20260825023430
--   * coldlion.vendor                 — 20260825023430
--
-- `coldlion.season` and `coldlion.salesperson` were explicitly deferred by
-- docs/plan_coldlion-landing-phases-2-6.md §"NOT in this plan" ("seasons,
-- salespersons ... phase 6 as consumers ask"). #2094 is that ask. This file
-- therefore ADDS exactly those two tables, re-asserts the schema idempotently,
-- and then verifies all six as one set so the six-table contract of #2094 is
-- enforced by the apply rather than assumed. Nothing pre-existing is altered
-- or dropped.
--
-- LAYER RULES RE-STATED, BECAUSE THIS FILE IS BOUND BY THEM.
--   * This layer NEVER interprets. One table per grain; columns are named after
--     the ColdLion endpoint fields, snake_cased, with no renaming into our own
--     vocabulary and no derived, resolved or matched columns.
--   * NO foreign key leaves the `coldlion` schema, and in particular none
--     reaches `core.*` or any curated table. `run_id` references
--     `coldlion.sync_run`, which is inside this schema, exactly as every other
--     landing table already does.
--   * Current-state behaviour: the common landing columns plus `first_seen_at`
--     / `last_seen_at`, and `source_hash` computed over the COMPLETE fetched
--     record before projection (SHA-256; one hash algorithm across the schema).
--   * No per-row `raw` archive (owner decision D5). Complete before/after
--     payloads live only in `coldlion.change_log` when a row actually changes.
--
-- COLUMN PROJECTION — DELIBERATELY MINIMAL, AND WHY.
-- docs/coldlion-erp-api-reference.md documents `/seasons` by companyCode,
-- divisionCode, seasonCode and `/salespersons` by companyCode,
-- salesPersonCode, lastName. Neither endpoint appears in
-- docs/coldlion-field-decisions-20260819.csv, so there is no owner-reviewed
-- field census for them. Rather than invent plausible columns, this file lands
-- only the documented fields plus the two ColdLion master timestamps that every
-- other landing master carries. Additional columns are additive and belong to
-- the loader step, once a live probe produces a field census the owner has
-- reviewed. Guessing here would launder invention into something that reads as
-- authoritative, which is the one failure this layer exists to prevent.
--
-- SECURITY POSTURE — STATED, THEN ENFORCED BELOW.
-- This is a raw landing layer and NO application may read it directly. Row
-- level security is ENABLED on both new tables and NO policy is created: the
-- layer is CLOSED to applications, not row-filtered for them. All privileges
-- are revoked from PUBLIC, `anon` and `authenticated`; only `service_role`
-- (the loader, the DB admin tool and audits) is granted access. The verification
-- block at the end fails the apply if that posture is missing or regressed on
-- any of the six master tables.
--
-- Structure only. This migration loads no rows.

create schema if not exists coldlion;

do $$
begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception
      'ColdLion landing spine (coldlion.sync_run) is required before the master landing tables';
  end if;
end
$$;

-- =====================================================================================
-- coldlion.season — grain: one season code, within one division, within one company.
-- Natural key: (company_code, division_code, season_code).
-- =====================================================================================
create table if not exists coldlion.season (
  company_code   text        not null,
  division_code  text        not null,
  season_code    text        not null,
  created_time   timestamptz     null,
  mod_time       timestamptz     null,
  run_id         uuid        not null references coldlion.sync_run(id),
  fetched_at     timestamptz not null,
  source_hash    text        not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null,
  constraint coldlion_season_pkey
    primary key (company_code, division_code, season_code),
  constraint coldlion_season_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint coldlion_season_seen_order_chk
    check (last_seen_at >= first_seen_at),
  constraint coldlion_season_division_not_ep001_chk
    check (division_code <> 'EP001')
);

comment on table coldlion.season is
  'ColdLion /seasons landed raw, one row per season code per division. Current-state: upsert on the natural key and bump last_seen_at; a changed source_hash writes coldlion.change_log. No grants to application roles.';
comment on column coldlion.season.source_hash is
  'SHA-256 over the COMPLETE fetched record before projection, not over the columns kept here. A field this table does not land still changes the hash, so a shape change shows up as a recorded change rather than as silence.';
comment on column coldlion.season.first_seen_at is
  'When this natural key was first landed. Never moves forward.';
comment on column coldlion.season.last_seen_at is
  'When this natural key was last returned by ColdLion. This is a sighting, not a lifecycle flag: ColdLion has no active marker on this endpoint and none is invented here.';
comment on column coldlion.season.division_code is
  'Division identity is the letter code as ColdLion returns it. EP001 is excluded from the landing layer.';

-- =====================================================================================
-- coldlion.salesperson — grain: one sales rep, within one company.
-- Natural key: (company_code, salesperson_code). NOT division-scoped: the
-- endpoint takes companyCode and salesPersonCode only.
-- =====================================================================================
create table if not exists coldlion.salesperson (
  company_code      text        not null,
  salesperson_code  text        not null,
  last_name         text            null,
  created_time      timestamptz     null,
  mod_time          timestamptz     null,
  run_id            uuid        not null references coldlion.sync_run(id),
  fetched_at        timestamptz not null,
  source_hash       text        not null,
  first_seen_at     timestamptz not null,
  last_seen_at      timestamptz not null,
  constraint coldlion_salesperson_pkey
    primary key (company_code, salesperson_code),
  constraint coldlion_salesperson_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint coldlion_salesperson_seen_order_chk
    check (last_seen_at >= first_seen_at)
);

comment on table coldlion.salesperson is
  'ColdLion /salespersons landed raw, one row per sales rep per company. Keyed on company and code only, because the endpoint is not division-scoped. No grants to application roles.';
comment on column coldlion.salesperson.source_hash is
  'SHA-256 over the COMPLETE fetched record before projection, not over the columns kept here.';
comment on column coldlion.salesperson.last_name is
  'ColdLion lastName, landed under its own name. This layer does not compose a display name; that is interpretation and belongs to a later promotion step.';
comment on column coldlion.salesperson.first_seen_at is
  'When this natural key was first landed. Never moves forward.';
comment on column coldlion.salesperson.last_seen_at is
  'When this natural key was last returned by ColdLion. A sighting, not a lifecycle flag.';

-- =====================================================================================
-- Security posture, applied to exactly the two tables this migration creates.
-- RLS on, no policy (closed, not filtered), no application grant, loader only.
-- =====================================================================================
alter table coldlion.season enable row level security;
alter table coldlion.salesperson enable row level security;

revoke all on table coldlion.season from public;
revoke all on table coldlion.season from anon;
revoke all on table coldlion.season from authenticated;
revoke all on table coldlion.salesperson from public;
revoke all on table coldlion.salesperson from anon;
revoke all on table coldlion.salesperson from authenticated;

grant all on table coldlion.season to service_role;
grant all on table coldlion.salesperson to service_role;

-- =====================================================================================
-- POST-APPLY VERIFICATION — this block FAILS THE APPLY if the #2094 contract is
-- missing or regressed. It checks all six master tables, not just the two
-- created here, because #2094's deliverable is the set.
-- =====================================================================================
do $verify$
declare
  v_table   text;
  v_role    text;
  v_priv    text;
  v_keydef  text;
  v_masters constant text[] := array[
    'customer', 'vendor', 'merch_group_header', 'merch_group_detail',
    'season', 'salesperson'
  ];
  v_expected_key constant jsonb := jsonb_build_object(
    'customer',           'PRIMARY KEY (company_code, customer_code)',
    'vendor',             'PRIMARY KEY (company_code, vendor_code)',
    'merch_group_header', 'PRIMARY KEY (company_code, division_code, mg_type_code)',
    'merch_group_detail', 'PRIMARY KEY (company_code, division_code, mg_type_code, mg_code)',
    'season',             'PRIMARY KEY (company_code, division_code, season_code)',
    'salesperson',        'PRIMARY KEY (company_code, salesperson_code)'
  );
begin
  if to_regnamespace('coldlion') is null then
    raise exception 'VERIFY FAILED: schema coldlion does not exist after apply';
  end if;

  if has_schema_privilege('anon', 'coldlion', 'USAGE')
     or has_schema_privilege('authenticated', 'coldlion', 'USAGE') then
    raise exception 'VERIFY FAILED: an application role holds USAGE on schema coldlion';
  end if;

  foreach v_table in array v_masters loop
    -- 1. The table exists.
    if to_regclass('coldlion.' || v_table) is null then
      raise exception 'VERIFY FAILED: coldlion.% is missing', v_table;
    end if;

    -- 2. Its natural key is exactly the designed one. A collapsed key on
    --    merch_group_detail is the specific defect this catches: mg_code
    --    collides across mg_type_code inside one division.
    select pg_get_constraintdef(oid) into v_keydef
    from pg_constraint
    where conrelid = ('coldlion.' || v_table)::regclass and contype = 'p';

    if v_keydef is distinct from (v_expected_key ->> v_table) then
      raise exception 'VERIFY FAILED: coldlion.% natural key is %, expected %',
        v_table, coalesce(v_keydef, '<none>'), (v_expected_key ->> v_table);
    end if;

    -- 3. The common current-state landing columns are present.
    if exists (
      select 1
      from unnest(array['run_id','fetched_at','source_hash','first_seen_at','last_seen_at']) needed
      where not exists (
        select 1 from information_schema.columns
        where table_schema = 'coldlion' and table_name = v_table and column_name = needed
      )
    ) then
      raise exception 'VERIFY FAILED: coldlion.% is missing a common landing column', v_table;
    end if;

    -- 4. Security posture: RLS on, no policy, no application grant, loader can write.
    if not (select relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'coldlion' and c.relname = v_table) then
      raise exception 'VERIFY FAILED: row level security is not enabled on coldlion.%', v_table;
    end if;

    if exists (select 1 from pg_policies
               where schemaname = 'coldlion' and tablename = v_table) then
      raise exception 'VERIFY FAILED: coldlion.% carries an RLS policy; this layer is closed, not filtered', v_table;
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(v_role, format('coldlion.%I', v_table), v_priv) then
          raise exception 'VERIFY FAILED: % holds % on coldlion.%', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;

    -- PUBLIC is not a role and cannot be asked with has_table_privilege.
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname = 'coldlion' and c.relname = v_table and a.grantee = 0
    ) then
      raise exception 'VERIFY FAILED: coldlion.% carries a grant to PUBLIC', v_table;
    end if;

    foreach v_priv in array array['SELECT','INSERT','UPDATE'] loop
      if not has_table_privilege('service_role', format('coldlion.%I', v_table), v_priv) then
        raise exception 'VERIFY FAILED: service_role lacks % on coldlion.%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  -- 5. No foreign key leaves the coldlion schema, from any table in it.
  if exists (
    select 1
    from pg_constraint con
    join pg_class c   on c.oid  = con.conrelid
    join pg_namespace n  on n.oid  = c.relnamespace
    join pg_class fc  on fc.oid = con.confrelid
    join pg_namespace fn on fn.oid = fc.relnamespace
    where con.contype = 'f' and n.nspname = 'coldlion' and fn.nspname <> 'coldlion'
  ) then
    raise exception 'VERIFY FAILED: a coldlion foreign key points outside the schema';
  end if;

  -- 6. No curation or invented structure on the two tables this file adds.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion'
      and table_name in ('season', 'salesperson')
      and (column_name in ('resolution_status','resolved_by','resolved_at','match_status',
                           'licensor_id','property_id','core_id','is_active','active_flag','raw')
           or column_name like 'resolved%'
           or column_name like 'match_%')
  ) then
    raise exception 'VERIFY FAILED: the new landing tables carry curation or an invented archive column';
  end if;

  raise notice 'VERIFY PASSED: six ColdLion master landing tables, designed natural keys, closed to applications.';
end
$verify$;
