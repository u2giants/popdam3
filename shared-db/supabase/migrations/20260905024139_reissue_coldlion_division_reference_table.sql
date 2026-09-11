-- Issue #2171 — ColdLion landing unit 1: add the `coldlion.division` reference table.
-- derived-from: none
--
-- WHAT THIS FILE CREATES
--
-- Exactly one new object: table `coldlion.division`. Nothing else in the
-- `coldlion` schema is created, altered or dropped. The four already-complete
-- master tables (`customer`, `vendor`, `merch_group_header`,
-- `merch_group_detail`) and the two added by 20260902054548 (`season`,
-- `salesperson`) are deliberately untouched — see #2081 comment 5519633711.
--
-- WHY IT EXISTS
--
-- plan_coldlion_landing_schema_completion.md §8: "Add `coldlion.division`; do
-- not hardcode a durable division dictionary in loaders." Division codes were
-- hard-coded in ColdLion tooling until the vendor built us the `/divisions`
-- endpoint (docs/coldlion-open-questions.md, Issue 3, JamieLynn 2026-08-28).
-- This table is where that dictionary lands so no loader carries it in code.
--
-- FIELD DISPOSITION — FROM A LIVE SAMPLE, NOT FROM `/api-docs`.
--
-- `/api-docs` types 14 of its 16 GET feeds — `/divisions` included — as a bare
-- `{"type":"object"}`, and where it does type a feed it is wrong. There is no
-- schema to compare against, so the projection below comes from a live
-- field-name census taken 2026-09-03, immediately before this file was written:
--
--   * both `active=Y` and `active=N` passes (the feed defaults to `active=Y`
--     and silently hides inactive rows — #2081 comment 5520060138 §2).
--     Y = 10 rows, N = 0 rows.
--   * 26 distinct properties across those rows, identical to the 2026-09-02
--     census recorded in #2171, every one returned as a JSON string:
--     accDivCode, active, address1, address2, city, companyCode, countryCode,
--     createdTime, createdUser, currencyCode, divisionCode, divisionDesc,
--     dunsNo, ediDivisionCode, faxNo, generalLedgerCode, itemNoCode,
--     manuFacturerCode, modTime, modUser, phoneNo, state, upcCurrent, upcEnd,
--     upcStart, zipCode.
--
-- DISPOSITION OF ALL 26 SAMPLED PROPERTIES
--
--   * 24 are INGESTED, one column each, snake_cased from the vendor's own name
--     with no renaming into our vocabulary. This is company-level business data
--     about our own operating divisions — addresses, GL code, DUNS, UPC range,
--     EDI code — the same character as `/customers`, which the owner ruled
--     "ingest everything" on 2026-09-03 (#2081 comment 5519623574).
--   * 2 are NOT landed: `createdUser` and `modUser`. On 2026-09-03 the owner
--     ruled those two exact field names DECLINED on `/seasons` as
--     "record-audit personal data" (AGENTS.md, the `/seasons` SETTLED note),
--     and ruled `/salespersons` down to name/code/company/active for the same
--     reason. Landing a named person's username here would run against both
--     rulings, so this file follows them. `createdTime` and `modTime` — the
--     record timestamps, not the person — ARE landed, exactly as
--     `coldlion.season` and `coldlion.salesperson` land them.
--     This is a projection choice, not a data loss: no ColdLion loader exists
--     yet and this table stays empty until plan §9 Step 7, so if the owner
--     rules the two audit users IN, a forward migration adds them before any
--     row is ever landed. Widening this projection by inference is not
--     permitted; it takes an owner ruling recorded the way #2081 comment
--     5519623574 was.
--
-- NATURAL KEY — (company_code, division_code), AND WHY IT IS NOT division ALONE.
--
-- The live sample returns 10 rows over 3 company codes and 4 in-scope division
-- codes: CW001 appears under three companies, EH001 under three, SP001 under
-- two, and EP001 (out of scope, below) under two. A division-code-only key
-- would collapse ten real records into five and silently lose half of them.
-- This is the same collision shape the four-part merch-group key exists for.
--
-- EP001 IS EXCLUDED BY CONSTRAINT, NOT BY LOADER CONVENTION.
--
-- Owner ruling, Albert Hazan 2026-08-28 (docs/coldlion-open-questions.md,
-- Issue 3): EP001 (Edgeucational Publishing) is active in the ERP but
-- permanently out of scope, and must be filtered at ingestion. Plan §8 restates
-- it as a locked decision. `coldlion.season` already enforces it with a check
-- constraint; this table does the same, so a loader that forgets the filter
-- fails loudly instead of landing an out-of-scope division into the dictionary
-- everything downstream reads.
--
-- LAYER RULES, RE-STATED BECAUSE THIS FILE IS BOUND BY THEM.
--   * This layer NEVER interprets. One table per grain, vendor field names
--     snake_cased, no derived / resolved / matched columns.
--   * No foreign key leaves `coldlion`. `run_id` references
--     `coldlion.sync_run`, inside this schema, like every other landing table.
--   * Current-state behaviour: the common landing columns plus first/last seen,
--     and `source_hash` computed over the COMPLETE fetched record before
--     projection (SHA-256). A field this table does not land still changes the
--     hash, so `createdUser`/`modUser` movement surfaces as a recorded change
--     rather than as silence.
--   * No per-row `raw` archive (owner decision D5).
--   * `active` is landed as the vendor's own Y/N string, NOT as a boolean and
--     NOT as a lifecycle flag of our own. Interpreting it is a promotion-step
--     concern (#2176).
--
-- SECURITY POSTURE. Raw landing: RLS ENABLED and NO policy — closed to
-- applications, not row-filtered for them. All privileges revoked from PUBLIC,
-- `anon` and `authenticated`; `service_role` only. The verification block at
-- the end fails the apply if any of that is missing.
--
-- Structure only. This migration loads no rows.

-- The `coldlion` schema itself is NOT created here. It already exists on `main`
-- (20260818232639) and `schema coldlion` is the declared write surface of a
-- different unit (#2176), so even an idempotent `create schema if not exists`
-- would be an undeclared write from this lane. The guard below proves the
-- schema and its spine are present instead of asserting them into existence.

do $$
begin
  if to_regnamespace('coldlion') is null then
    raise exception
      'schema coldlion is required before coldlion.division and is not created by this migration';
  end if;

  if to_regclass('coldlion.sync_run') is null then
    raise exception
      'ColdLion landing spine (coldlion.sync_run) is required before coldlion.division';
  end if;
end
$$;

-- =====================================================================================
-- coldlion.division — grain: one division, within one company.
-- Natural key: (company_code, division_code).
-- =====================================================================================
create table if not exists coldlion.division (
  company_code         text        not null,
  division_code        text        not null,
  division_desc        text            null,
  acc_div_code         text            null,
  edi_division_code    text            null,
  general_ledger_code  text            null,
  item_no_code         text            null,
  manu_facturer_code   text            null,
  duns_no              text            null,
  currency_code        text            null,
  country_code         text            null,
  address1             text            null,
  address2             text            null,
  city                 text            null,
  state                text            null,
  zip_code             text            null,
  phone_no             text            null,
  fax_no               text            null,
  upc_current          text            null,
  upc_start            text            null,
  upc_end              text            null,
  active               text            null,
  created_time         timestamptz     null,
  mod_time             timestamptz     null,
  run_id               uuid        not null references coldlion.sync_run(id),
  fetched_at           timestamptz not null,
  source_hash          text        not null,
  first_seen_at        timestamptz not null,
  last_seen_at         timestamptz not null,
  constraint coldlion_division_pkey
    primary key (company_code, division_code),
  constraint coldlion_division_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint coldlion_division_seen_order_chk
    check (last_seen_at >= first_seen_at),
  constraint coldlion_division_not_ep001_chk
    check (division_code <> 'EP001')
);

comment on table coldlion.division is
  'ColdLion /divisions landed raw, one row per division per company. This is the durable division dictionary: no loader may hardcode division codes. Current-state: upsert on (company_code, division_code) and bump last_seen_at; a changed source_hash writes coldlion.change_log. No grants to application roles.';

comment on column coldlion.division.company_code is
  'ColdLion companyCode. Part of the natural key: the live feed returns the same division code under several companies, so a division-code-only key would collapse ten real records into five.';
comment on column coldlion.division.division_code is
  'ColdLion divisionCode, landed as the vendor returns it. EP001 (Edgeucational Publishing) is permanently out of scope by owner ruling 2026-08-28 and is excluded by check constraint, not merely by loader convention.';
comment on column coldlion.division.division_desc is
  'ColdLion divisionDesc, the vendor label. This layer does not normalise or translate it.';
comment on column coldlion.division.active is
  'ColdLion active, landed as the vendor Y/N string. Not a boolean and not our own lifecycle flag: the feed defaults to active=Y and silently omits inactive rows, so a loader must fetch active=Y and active=N as separate passes and union them. Interpretation belongs to the promotion step.';
comment on column coldlion.division.manu_facturer_code is
  'ColdLion manuFacturerCode, snake_cased from the vendor name including its irregular casing. This layer never corrects a vendor field name; renaming it here would break the sampled-shape check the loader keys its unknown-field refusal to.';
comment on column coldlion.division.upc_start is
  'ColdLion upcStart. The UPC range fields returned empty on every sampled row; they are landed anyway so that a value appearing later lands rather than being silently dropped.';
comment on column coldlion.division.source_hash is
  'SHA-256 over the COMPLETE fetched record before projection, not over the columns kept here. The two deliberately unlanded properties (createdUser, modUser) still move this hash, so a shape or content change is recorded rather than invisible.';
comment on column coldlion.division.first_seen_at is
  'When this natural key was first landed. Never moves forward.';
comment on column coldlion.division.last_seen_at is
  'When this natural key was last returned by ColdLion. A sighting, not a lifecycle flag.';

-- =====================================================================================
-- Security posture, applied to exactly the one table this migration creates.
-- =====================================================================================
alter table coldlion.division enable row level security;

revoke all on table coldlion.division from public;
revoke all on table coldlion.division from anon;
revoke all on table coldlion.division from authenticated;

grant all on table coldlion.division to service_role;

-- =====================================================================================
-- POST-APPLY VERIFICATION — fails the apply if the #2171 contract is missing.
-- Scoped to coldlion.division; this unit's write surface is that one table.
-- =====================================================================================
do $verify$
declare
  v_role   text;
  v_priv   text;
  v_keydef text;
  v_col    text;
  v_expected_key constant text := 'PRIMARY KEY (company_code, division_code)';
  v_projection constant text[] := array[
    'company_code','division_code','division_desc','acc_div_code','edi_division_code',
    'general_ledger_code','item_no_code','manu_facturer_code','duns_no','currency_code',
    'country_code','address1','address2','city','state','zip_code','phone_no','fax_no',
    'upc_current','upc_start','upc_end','active','created_time','mod_time'
  ];
begin
  if to_regnamespace('coldlion') is null then
    raise exception 'VERIFY FAILED: schema coldlion does not exist after apply';
  end if;

  if has_schema_privilege('anon', 'coldlion', 'USAGE')
     or has_schema_privilege('authenticated', 'coldlion', 'USAGE') then
    raise exception 'VERIFY FAILED: an application role holds USAGE on schema coldlion';
  end if;

  if to_regclass('coldlion.division') is null then
    raise exception 'VERIFY FAILED: coldlion.division is missing';
  end if;

  -- 1. The natural key is company + division, not division alone.
  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint
  where conrelid = 'coldlion.division'::regclass and contype = 'p';

  if v_keydef is distinct from v_expected_key then
    raise exception 'VERIFY FAILED: coldlion.division natural key is %, expected %',
      coalesce(v_keydef, '<none>'), v_expected_key;
  end if;

  -- 2. Every approved projection column is present.
  foreach v_col in array v_projection loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'division' and column_name = v_col
    ) then
      raise exception 'VERIFY FAILED: coldlion.division is missing approved column %', v_col;
    end if;
  end loop;

  -- 3. The common current-state landing columns are present.
  if exists (
    select 1
    from unnest(array['run_id','fetched_at','source_hash','first_seen_at','last_seen_at']) needed
    where not exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'division' and column_name = needed
    )
  ) then
    raise exception 'VERIFY FAILED: coldlion.division is missing a common landing column';
  end if;

  -- 4. The two properties the owner rulings decline are ABSENT, and no curation
  --    or invented archive column crept in.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'division'
      and (column_name in ('created_user','mod_user','createduser','moduser',
                           'resolution_status','resolved_by','resolved_at','match_status',
                           'licensor_id','property_id','core_id','is_active','active_flag','raw')
           or column_name like 'resolved%'
           or column_name like 'match\_%')
  ) then
    raise exception 'VERIFY FAILED: coldlion.division carries a declined audit-user column, a curation column, or an invented archive column';
  end if;

  -- 5. EP001 is refused by the table itself, not only by the loader.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.division'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%EP001%'
  ) then
    raise exception 'VERIFY FAILED: coldlion.division does not exclude EP001 by constraint';
  end if;

  -- 6. Security posture: RLS on, no policy, no application grant, loader can write.
  if not (select relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'coldlion' and c.relname = 'division') then
    raise exception 'VERIFY FAILED: row level security is not enabled on coldlion.division';
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'coldlion' and tablename = 'division') then
    raise exception 'VERIFY FAILED: coldlion.division carries an RLS policy; this layer is closed, not filtered';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_role, 'coldlion.division', v_priv) then
        raise exception 'VERIFY FAILED: % holds % on coldlion.division', v_role, v_priv;
      end if;
    end loop;
  end loop;

  -- PUBLIC is not a role and cannot be asked with has_table_privilege.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'coldlion' and c.relname = 'division' and a.grantee = 0
  ) then
    raise exception 'VERIFY FAILED: coldlion.division carries a grant to PUBLIC';
  end if;

  foreach v_priv in array array['SELECT','INSERT','UPDATE'] loop
    if not has_table_privilege('service_role', 'coldlion.division', v_priv) then
      raise exception 'VERIFY FAILED: service_role lacks % on coldlion.division', v_priv;
    end if;
  end loop;

  -- 7. No foreign key leaves the coldlion schema.
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

  raise notice 'VERIFY PASSED: coldlion.division exists with the company+division key, the 24 approved columns, EP001 excluded, and closed to applications.';
end
$verify$;
