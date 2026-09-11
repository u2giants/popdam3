-- Issue #2177: ColdLion `/customers` and `/salespersons` field projections.
-- derived-from: none
--
-- OWNER RULING, AND WHY THIS FILE IS ASYMMETRIC.
-- Authority: issue #2081 comment 5519623574 (Albert Hazan, 2026-09-03).
--
--   * `/customers`     — INGEST EVERYTHING. Company-level business data; no
--                        personal-data concern was raised.
--   * `/salespersons`  — INGEST name, code, company, and ACTIVE STATUS ONLY.
--                        Every other property on that feed is DECLINED — not
--                        pending, not deferred. That explicitly includes
--                        `firstName` beyond the stored name, e-mail, telephone,
--                        home address, commission and quota. They are personal
--                        data about named people and there is no established
--                        business use for them.
--
-- Two sessions independently recommended a `/salespersons` projection and they
-- differed; the owner chose the narrower one. The discarded wider
-- recommendation is NOT the decision. Under owner decision D5 there is no raw
-- per-row archive, so an omission here is permanent — but permanence is not a
-- reason to over-ingest. WIDENING THIS PROJECTION REQUIRES A NEW OWNER RULING
-- RECORDED THE SAME WAY. No session may widen it by inference, by "it was in
-- the feed anyway", or by a later convenience argument. The verification block
-- at the end of this file FAILS THE APPLY if a declined field ever appears.
--
-- FORWARD MIGRATION ONLY. `coldlion.customer` was created by 20260825023430 and
-- `coldlion.salesperson` by 20260902054548. Neither applied file is edited.
-- This migration only ADDS columns; it drops nothing, renames nothing, and
-- loads no rows.
--
-- THE COLUMN LIST COMES FROM A LIVE SAMPLE, NOT FROM THE SPEC.
-- `GET /EhpApi/v2/api-docs` types the 200 response of both feeds as a bare
-- `{"type":"object"}` — 14 of 16 GET feeds are untyped, and where the spec DOES
-- type a feed (both history endpoints) it is wrong. The census in #2081 comment
-- 5519573718 recorded that. The projection below was therefore built from a
-- live read-only sample taken on 2026-09-03 immediately before authoring:
--
--   GET /EhpApi/customers?companyCode=EDGEHOME&size=25    → 39 distinct properties
--   GET /EhpApi/salespersons?companyCode=EDGEHOME&size=25 → 26 distinct properties
--
-- Only property NAMES and JSON value types were taken from that sample. No
-- customer identifier, no named person and no other row value appears in this
-- repository, which is PUBLIC.
--
-- The loader's unknown-field refusal must be keyed to that SAMPLED SHAPE, never
-- to `/api-docs`: a newly appearing property with no ruling has to make the
-- loader fail loudly rather than land silently. That is the mechanism by which
-- the declined `/salespersons` fields stay out over time.
--
-- CASING TRAP, RECORDED FOR THE LOADER. `/salespersons` returns `uDF01`/`uDF02`
-- (lower-then-upper) where every other feed returns `udf01`. Both are declined
-- here, so no column carries the trap — but a loader that lower-cases feed keys
-- to compare against a sampled shape must not be surprised by it.
--
-- LAYER RULES. One table per grain; columns named after the ColdLion field,
-- snake_cased, with no renaming into our vocabulary and no derived, resolved or
-- matched column. No foreign key leaves the `coldlion` schema. `source_hash`
-- stays a SHA-256 over the COMPLETE fetched record BEFORE projection, so a
-- declined field changing still shows up as a recorded change rather than as
-- silence — that property is why declining a field is not the same as being
-- blind to it.
--
-- SECURITY POSTURE IS UNCHANGED, AND RE-PROVEN. Raw landing: RLS enabled, NO
-- policy (closed to applications, not row-filtered), no grant to PUBLIC, `anon`
-- or `authenticated`, `service_role` only. This file creates no policy and
-- makes no grant; the verification block asserts the posture still holds.
--
-- Structure only. This migration loads no rows.

do $$
begin
  if to_regclass('coldlion.customer') is null then
    raise exception 'coldlion.customer (20260825023430) is required before this migration';
  end if;
  if to_regclass('coldlion.salesperson') is null then
    raise exception 'coldlion.salesperson (20260902054548) is required before this migration';
  end if;
end
$$;

-- =====================================================================================
-- coldlion.customer — the owner's ingest-everything ruling, made real.
--
-- Seven properties are already columns (company_code, customer_code,
-- created_time, mod_time, active, customer_desc, vendor_number). The 32 below
-- are the remainder of the 2026-09-03 sample. Types follow the sampled JSON
-- value types: the two commission percentages arrive as JSON numbers, the two
-- user-defined date fields as `YYYY-MM-DD`, everything else as a JSON string —
-- including `active` and `useConsolidatedInvoice`, which are single-character
-- flags in the feed and are landed verbatim rather than interpreted into a
-- boolean. Interpretation is a later layer's job.
-- =====================================================================================
alter table coldlion.customer
  add column if not exists address1                 text,
  add column if not exists address2                 text,
  add column if not exists address3                 text,
  add column if not exists ar_customer_code         text,
  add column if not exists city                     text,
  add column if not exists commission_perc1         numeric,
  add column if not exists commission_perc2         numeric,
  add column if not exists country_code             text,
  add column if not exists created_user             text,
  add column if not exists currency_code            text,
  add column if not exists customer_dba             text,
  add column if not exists customer_type_code       text,
  add column if not exists ds_cat                   text,
  add column if not exists factor_code              text,
  add column if not exists fax_no                   text,
  add column if not exists gl_code                  text,
  add column if not exists mod_user                 text,
  add column if not exists old_customer_code        text,
  add column if not exists parent_customer_code     text,
  add column if not exists phone_no                 text,
  add column if not exists region_code              text,
  add column if not exists sales_person_code1       text,
  add column if not exists sales_person_code2       text,
  add column if not exists state                    text,
  add column if not exists udf01                    text,
  add column if not exists udf02                    text,
  add column if not exists udf03                    text,
  add column if not exists udf04                    text,
  add column if not exists udf_date01               date,
  add column if not exists udf_date02               date,
  add column if not exists use_consolidated_invoice text,
  add column if not exists zip_code                 text;

comment on table coldlion.customer is
  'ColdLion /customers landed raw, one row per customer code per company. Owner ruling #2081 comment 5519623574: ingest everything — this feed is company-level business data. The column set is the 2026-09-03 live sample, not /api-docs, which types this feed as a bare object. Current-state: upsert on the natural key and bump last_seen_at; a changed source_hash writes coldlion.change_log. No grants to application roles.';

comment on column coldlion.customer.ar_customer_code is
  'ColdLion aRCustomerCode, snake_cased from the feed key as returned. Not resolved against anything.';
comment on column coldlion.customer.parent_customer_code is
  'ColdLion parentCustomerCode as returned. This layer records the string; it builds no parent/child hierarchy and follows no reference. Parent/child curation is hand-curated elsewhere and is not derivable from this column.';
comment on column coldlion.customer.sales_person_code1 is
  'ColdLion salesPersonCode1 as returned. No foreign key to coldlion.salesperson: a landing table records what the feed said, including a code that resolves to nothing.';
comment on column coldlion.customer.sales_person_code2 is
  'ColdLion salesPersonCode2 as returned. No foreign key, for the same reason as sales_person_code1.';
comment on column coldlion.customer.use_consolidated_invoice is
  'ColdLion useConsolidatedInvoice, landed as the feed''s own single-character flag. Deliberately not interpreted into a boolean at this layer.';
comment on column coldlion.customer.udf_date01 is
  'ColdLion udfDate01. A user-defined date whose business meaning is not established here and must not be assumed by a consumer.';
comment on column coldlion.customer.udf_date02 is
  'ColdLion udfDate02. Same caution as udf_date01.';

-- =====================================================================================
-- coldlion.salesperson — ONE column, and that is the whole of it.
--
-- The approved projection is name, code, company, active status. Name
-- (`last_name`), code (`salesperson_code`) and company (`company_code`) are
-- already columns from 20260902054548. `active` is the only approved field that
-- was missing. Twenty-two other sampled properties are DECLINED and no column
-- is created for any of them.
-- =====================================================================================
alter table coldlion.salesperson
  add column if not exists active text;

comment on table coldlion.salesperson is
  'ColdLion /salespersons landed raw, one row per sales rep per company. Keyed on company and code only, because the endpoint is not division-scoped. DELIBERATELY NARROW BY OWNER RULING (#2081 comment 5519623574): name, code, company and active status only. E-mail, telephone, home address, commission, quota and every other property on that feed are DECLINED as personal data about named people with no established business use — declined, not pending. Widening requires a NEW owner ruling recorded the same way, and this migration''s verification block fails the apply if a declined field appears. No grants to application roles.';

comment on column coldlion.salesperson.active is
  'ColdLion active, landed as the feed''s own single-character flag and not interpreted into a boolean. One of the four fields the owner approved for this feed.';

-- =====================================================================================
-- POST-APPLY VERIFICATION — FAILS THE APPLY if the ruling is not honoured.
--
-- Part 2 is the declined-field gate the issue requires. It is written to be
-- ABLE TO FAIL: it asks the catalog for columns matching the declined
-- categories and raises if it finds any, and it separately asserts that the
-- salesperson column set is EXACTLY the approved one, so a declined field with
-- a name nobody thought to pattern-match is caught as well.
-- =====================================================================================
do $verify$
declare
  v_missing    text;
  v_offending  text;
  v_unexpected text;
  v_role       text;
  v_priv       text;
  v_table      text;

  -- Every property of the 2026-09-03 /customers sample, mapped exactly once.
  v_customer_expected constant text[] := array[
    'company_code','customer_code','created_time','mod_time','active',
    'customer_desc','vendor_number',
    'address1','address2','address3','ar_customer_code','city',
    'commission_perc1','commission_perc2','country_code','created_user',
    'currency_code','customer_dba','customer_type_code','ds_cat','factor_code',
    'fax_no','gl_code','mod_user','old_customer_code','parent_customer_code',
    'phone_no','region_code','sales_person_code1','sales_person_code2','state',
    'udf01','udf02','udf03','udf04','udf_date01','udf_date02',
    'use_consolidated_invoice','zip_code'
  ];

  -- The COMPLETE permitted salesperson column set: the four approved business
  -- fields, the two ColdLion master timestamps already applied by 20260902054548,
  -- and the common landing provenance columns. Anything else is a widening.
  v_salesperson_allowed constant text[] := array[
    'company_code','salesperson_code','last_name','active',
    'created_time','mod_time',
    'run_id','fetched_at','source_hash','first_seen_at','last_seen_at'
  ];
begin
  -- 1. /customers: every sampled property is a column, exactly once.
  select string_agg(needed, ', ' order by needed) into v_missing
  from unnest(v_customer_expected) needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'customer' and column_name = needed
  );
  if v_missing is not null then
    raise exception 'VERIFY FAILED: coldlion.customer is missing sampled /customers field(s): %', v_missing;
  end if;

  -- 2. THE DECLINED-FIELD GATE. Owner ruling #2081 comment 5519623574.
  --    2a. The named personal-data categories, by pattern.
  select string_agg(column_name, ', ' order by column_name) into v_offending
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name = 'salesperson'
    and (
         column_name like '%email%'
      or column_name like '%e_mail%'
      or column_name like '%mail%'
      or column_name like '%phone%'
      or column_name like '%fax%'
      or column_name like '%mobile%'
      or column_name like '%address%'
      or column_name like '%addr%'
      or column_name like '%city%'
      or column_name like '%state%'
      or column_name like '%zip%'
      or column_name like '%postal%'
      or column_name like '%commission%'
      or column_name like '%quota%'
    );
  if v_offending is not null then
    raise exception
      'VERIFY FAILED: coldlion.salesperson carries DECLINED personal-data column(s): %. Owner ruling #2081 comment 5519623574 permits name, code, company and active status only. Widening requires a NEW owner ruling recorded the same way.',
      v_offending;
  end if;

  --    2b. And the exact set, so a declined field under an unanticipated name
  --        cannot slip past the patterns above.
  select string_agg(column_name, ', ' order by column_name) into v_unexpected
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name = 'salesperson'
    and not (column_name = any (v_salesperson_allowed));
  if v_unexpected is not null then
    raise exception
      'VERIFY FAILED: coldlion.salesperson carries column(s) outside the owner-approved projection: %. Owner ruling #2081 comment 5519623574 permits name, code, company and active status only.',
      v_unexpected;
  end if;

  --    2c. The approved four are actually present, so the gate cannot pass by
  --        the table being empty of columns.
  select string_agg(needed, ', ' order by needed) into v_missing
  from unnest(array['company_code','salesperson_code','last_name','active']) needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'salesperson' and column_name = needed
  );
  if v_missing is not null then
    raise exception 'VERIFY FAILED: coldlion.salesperson is missing owner-approved field(s): %', v_missing;
  end if;

  -- 3. Nothing curated, resolved or archived crept onto either table.
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
    into v_offending
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name in ('customer', 'salesperson')
    and (column_name in ('resolution_status','resolved_by','resolved_at','match_status',
                         'licensor_id','property_id','core_id','raw')
         or column_name like 'resolved%'
         or column_name like 'match\_%');
  if v_offending is not null then
    raise exception 'VERIFY FAILED: a curation or archive column appeared on the landing layer: %', v_offending;
  end if;

  -- 4. Natural keys unchanged by this migration.
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'coldlion.customer'::regclass and contype = 'p')
     is distinct from 'PRIMARY KEY (company_code, customer_code)' then
    raise exception 'VERIFY FAILED: coldlion.customer natural key changed';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'coldlion.salesperson'::regclass and contype = 'p')
     is distinct from 'PRIMARY KEY (company_code, salesperson_code)' then
    raise exception 'VERIFY FAILED: coldlion.salesperson natural key changed';
  end if;

  -- 5. Security posture unchanged: closed to applications, loader only.
  if has_schema_privilege('anon', 'coldlion', 'USAGE')
     or has_schema_privilege('authenticated', 'coldlion', 'USAGE') then
    raise exception 'VERIFY FAILED: an application role holds USAGE on schema coldlion';
  end if;

  foreach v_table in array array['customer','salesperson'] loop
    if not (select relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'coldlion' and c.relname = v_table) then
      raise exception 'VERIFY FAILED: row level security is not enabled on coldlion.%', v_table;
    end if;

    if exists (select 1 from pg_policies
               where schemaname = 'coldlion' and tablename = v_table) then
      raise exception 'VERIFY FAILED: coldlion.% carries an RLS policy; this layer is closed, not filtered', v_table;
    end if;

    foreach v_role in array array['anon','authenticated'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(v_role, format('coldlion.%I', v_table), v_priv) then
          raise exception 'VERIFY FAILED: % holds % on coldlion.%', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;

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

  -- 6. No foreign key leaves the coldlion schema.
  if exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class fc on fc.oid = con.confrelid
    join pg_namespace fn on fn.oid = fc.relnamespace
    where con.contype = 'f' and n.nspname = 'coldlion' and fn.nspname <> 'coldlion'
  ) then
    raise exception 'VERIFY FAILED: a coldlion foreign key points outside the schema';
  end if;

  raise notice 'VERIFY PASSED: /customers fully projected, /salespersons narrow by owner ruling, landing layer closed.';
end
$verify$;
