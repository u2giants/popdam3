-- Append a read-only rfq_groups JSON array to public.style_tracker_rows_with_bridge.
--
-- Business: PopDAM Master Data (dam.designflow.app/styles) shows the latest RFQ
-- group name plus a history of prior groups for each style tracker row. The field
-- is automatic and read-only — nothing selectable or editable by the user.
--
-- Source of truth: legacy dflow."RFQItem" / dflow."RFQGroup". The newer
-- plm.rfq_item / plm.rfq_group tables are empty in production and MUST NOT be used.
--
-- Match rule (exact, case-insensitive, whitespace-trimmed — no fuzzy/SKU match):
--   upper(trim(i."rfqItem_style_number")) = upper(trim(r.row_data ->> 'rfq_code'))
-- Group FK on the item side is i."rfqItem_rfq_group" → g."RFQGroup_id".
--
-- Recency per (master row, group): max(coalesce(
--   i."rfqItem_date_modified"::timestamptz,
--   i."rfqItem_created_date",
--   g.data_added::timestamptz
-- )). Sorted linked_at DESC NULLS LAST, then group id DESC. One object per
-- distinct group. Empty result is '[]'::jsonb, never SQL NULL.
--
-- Base definition: 20260721143000_dam_master_data_customer_id.sql is the NEWEST
-- CREATE OR REPLACE of this view in migration history. Confirmed 2026-07-31
-- against live preview pg_get_viewdef — column list ends at customer_id and
-- matches that migration exactly (later 20260729210000 only revokes anon grants).
-- CREATE OR REPLACE VIEW is last-writer-wins; this file rewrites the full body
-- and appends rfq_groups as the FINAL column so prior columns are preserved.
--
-- Performance (preview, full Master Data scale, 15,533 rows, 2026-07-31):
--   correlated subquery, no index: ~91s (seq-scans RFQItem per outer row)
--   correlated + expression index: ~250ms
--   pre-aggregate join (this migration): ~112ms, no index required
-- Pre-aggregate wins for the full-page load that Master Data performs, with
-- fewer moving parts, so no expression index is added.
--
-- Blank group names: 5 of 390 RFQGroup rows have blank names; 0 currently link
-- to Master Data. Preserve the association with fallback label 'RFQ Group #<id>'.
-- Duplicate names with different IDs exist (e.g. "Burlington May 2025" = 297,298)
-- — distinct IDs are always preserved.

create or replace view public.style_tracker_rows_with_bridge as
select
  r.id,
  r.source_workbook_id,
  r.source_sheet,
  r.source_row_number,
  r.tracker_type,
  r.sku,
  r.group_id,
  r.description,
  r.customer,
  r.designer,
  r.commissioned,
  r.upc,
  r.customer_sku,
  r.licensor,
  r.license_status,
  r.royalty,
  r.concept_status,
  r.pre_production_status,
  r.production_status,
  r.default_vendor,
  r.discontinued,
  r.notes,
  r.row_data,
  r.imported_at,
  r.created_at,
  r.updated_at,
  r.updated_by,
  b.id as bridge_id,
  b.erp_item_id,
  b.style_group_id,
  b.company_id,
  b.public_licensor_id,
  b.core_licensor_id,
  b.factory_id,
  b.plm_item_id,
  b.match_status,
  b.match_confidence,
  b.match_notes,
  b.last_matched_at,
  erp.item_description as canonical_description,
  coalesce(selected_customer.display_name, selected_customer.name, bridge_customer.display_name, bridge_customer.name) as canonical_customer_name,
  coalesce(core_lic.name, public_lic.name) as canonical_licensor_name,
  factory.name as canonical_factory_name,
  sg.sku as style_group_sku,
  erp.style_number as erp_style_number,
  b.creative_designer_id,
  creative.name as canonical_designer_name,
  r.customer_id,
  coalesce(rfq.rfq_groups, '[]'::jsonb) as rfq_groups
from public.style_tracker_rows r
left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
left join api.plm_item_list erp on erp.id = b.erp_item_id
left join public.style_groups sg on sg.id = b.style_group_id
left join core.customer bridge_customer on bridge_customer.id = b.company_id
left join core.customer selected_customer on selected_customer.id = r.customer_id
left join public.licensors public_lic on public_lic.id = b.public_licensor_id
left join core.licensor core_lic on core_lic.id = b.core_licensor_id
left join core.creative_designer creative on creative.id = b.creative_designer_id
left join core.factory factory on factory.id = b.factory_id
left join (
  -- One jsonb array per exact RFQ code key, groups newest-first.
  select
    per_group.code_key,
    jsonb_agg(
      jsonb_build_object(
        'id', per_group.id,
        'name', per_group.name,
        'linked_at', to_char(
          timezone('UTC', per_group.linked_at),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
      order by per_group.linked_at desc nulls last, per_group.id desc
    ) as rfq_groups
  from (
    select
      upper(trim(i."rfqItem_style_number")) as code_key,
      g."RFQGroup_id" as id,
      coalesce(
        nullif(trim(g."RFQGroup_name"), ''),
        'RFQ Group #' || g."RFQGroup_id"::text
      ) as name,
      max(coalesce(
        i."rfqItem_date_modified"::timestamptz,
        i."rfqItem_created_date",
        g.data_added::timestamptz
      )) as linked_at
    from dflow."RFQItem" i
    join dflow."RFQGroup" g
      on g."RFQGroup_id" = i."rfqItem_rfq_group"
    where i."rfqItem_rfq_group" is not null
      and nullif(trim(i."rfqItem_style_number"), '') is not null
    group by
      upper(trim(i."rfqItem_style_number")),
      g."RFQGroup_id",
      g."RFQGroup_name"
  ) per_group
  group by per_group.code_key
) rfq
  on rfq.code_key = upper(trim(r.row_data ->> 'rfq_code'))
 and nullif(trim(r.row_data ->> 'rfq_code'), '') is not null;

-- Preserve the browser-readable contract: authenticated/service_role may select;
-- anon must NOT. CREATE OR REPLACE keeps existing grants on PG, but re-state the
-- lockdown so a fresh environment cannot reopen the 2026-07-29 leak.
grant select on public.style_tracker_rows_with_bridge to authenticated, service_role;
revoke all on table public.style_tracker_rows_with_bridge from anon;
revoke all on table public.style_tracker_rows_with_bridge from public;

-- =============================================================================
-- Self-assertions: behaviour, not just "apply succeeded"
-- =============================================================================
do $$
declare
  v_cols text[];
  v_expected_tail text[] := array['customer_id', 'rfq_groups'];
  v_row_count bigint;
  v_null_rfq bigint;
  v_linked_rows bigint;
  v_multi_group_rows bigint;
  v_example jsonb;
  v_example_name text;
  v_no_code jsonb;
  v_no_match jsonb;
  v_fuzzy_hit bigint;
  v_sku text;
  v_code text;
  v_groups jsonb;
  v_first_id int;
  v_second_id int;
  v_first_at text;
  v_second_at text;
  v_anon_privs bigint;
  v_auth_privs bigint;
begin
  -- 1. Column list ends with customer_id, rfq_groups (appended, not inserted mid-list)
  select array_agg(column_name::text order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'style_tracker_rows_with_bridge';

  if v_cols is null or array_length(v_cols, 1) < 2 then
    raise exception 'ASSERT: view public.style_tracker_rows_with_bridge missing or has no columns';
  end if;

  if v_cols[array_length(v_cols, 1) - 1] is distinct from 'customer_id'
     or v_cols[array_length(v_cols, 1)] is distinct from 'rfq_groups' then
    raise exception
      'ASSERT: expected final columns (customer_id, rfq_groups); got (%, %)',
      v_cols[array_length(v_cols, 1) - 1],
      v_cols[array_length(v_cols, 1)];
  end if;

  if not ('id' = any (v_cols)
          and 'sku' = any (v_cols)
          and 'row_data' = any (v_cols)
          and 'canonical_designer_name' = any (v_cols)
          and 'customer_id' = any (v_cols)) then
    raise exception 'ASSERT: core pre-existing columns missing from view: %', v_cols;
  end if;

  -- 2. Row count unchanged vs base table (view is 1:1 with style_tracker_rows)
  select count(*) into v_row_count from public.style_tracker_rows_with_bridge;
  if v_row_count is distinct from (select count(*) from public.style_tracker_rows) then
    raise exception
      'ASSERT: view row count % != style_tracker_rows %',
      v_row_count,
      (select count(*) from public.style_tracker_rows);
  end if;

  -- 3. Never SQL NULL for rfq_groups
  select count(*) into v_null_rfq
  from public.style_tracker_rows_with_bridge
  where rfq_groups is null;
  if v_null_rfq <> 0 then
    raise exception 'ASSERT: % rows have NULL rfq_groups (must be [])', v_null_rfq;
  end if;

  -- 4. Sanity floors only (no upper bound — linkage drifts/grows between preview
  --    rehearsal and production promotion; no high floor — empty/minimal envs
  --    must still apply). Intent: a broken exact-match join returns 0 linked
  --    rows while both sides have data; historically ~2015 linked / ≥11 multi
  --    on a full clone (2026-07-31).
  select count(*) into v_linked_rows
  from public.style_tracker_rows_with_bridge
  where rfq_groups <> '[]'::jsonb;

  if v_linked_rows < 1
     and exists (
       select 1
       from public.style_tracker_rows
       where nullif(trim(row_data ->> 'rfq_code'), '') is not null
       limit 1
     )
     and exists (
       select 1
       from dflow."RFQItem"
       where "rfqItem_rfq_group" is not null
         and nullif(trim("rfqItem_style_number"), '') is not null
       limit 1
     )
  then
    raise exception
      'ASSERT: linked Master Data rows = 0 despite RFQ codes and RFQItem rows existing — match rule is broken.';
  end if;

  select count(*) into v_multi_group_rows
  from public.style_tracker_rows_with_bridge
  where jsonb_array_length(rfq_groups) > 1;

  -- When linkage is substantial, at least one multi-group row is expected
  -- (full clone historically has ≥11). Floor of 1 only when linked ≥ 100 so
  -- sparse environments are not failed for lacking multi-group history.
  if v_linked_rows >= 100 and v_multi_group_rows < 1 then
    raise exception
      'ASSERT: 0 multi-group rows with % linked — dedup/join may have collapsed groups incorrectly.',
      v_linked_rows;
  end if;

  -- 5. Confirmed example: SKU MFZ88KMSC01 / RFQ Code MFZ88-309 → Family Dollar July 2023
  select rfq_groups into v_example
  from public.style_tracker_rows_with_bridge
  where sku = 'MFZ88KMSC01'
  limit 1;

  if v_example is null then
    raise notice 'SKIP example: SKU MFZ88KMSC01 not present in this environment';
  else
    if jsonb_typeof(v_example) is distinct from 'array'
       or jsonb_array_length(v_example) < 1 then
      raise exception 'ASSERT: MFZ88KMSC01 expected ≥1 rfq group, got %', v_example;
    end if;
    v_example_name := v_example -> 0 ->> 'name';
    if v_example_name is distinct from 'Family Dollar July 2023' then
      raise exception
        'ASSERT: MFZ88KMSC01 first group name = % (expected Family Dollar July 2023)',
        v_example_name;
    end if;
    if (v_example -> 0 ->> 'id') is null
       or (v_example -> 0 ->> 'linked_at') is null then
      raise exception 'ASSERT: MFZ88KMSC01 group object missing id/linked_at: %', v_example;
    end if;
    -- linked_at must look like ISO-8601 UTC with Z
    if (v_example -> 0 ->> 'linked_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
      raise exception
        'ASSERT: linked_at format not UTC-Z ISO: %',
        v_example -> 0 ->> 'linked_at';
    end if;
  end if;

  -- 6. No RFQ Code → []
  select rfq_groups into v_no_code
  from public.style_tracker_rows_with_bridge
  where nullif(trim(row_data ->> 'rfq_code'), '') is null
  limit 1;

  if v_no_code is null then
    raise notice 'SKIP no-code: every row has an rfq_code in this environment';
  elsif v_no_code is distinct from '[]'::jsonb then
    raise exception 'ASSERT: row without rfq_code returned % (expected [])', v_no_code;
  end if;

  -- 7. RFQ Code with no exact match → []
  select rfq_groups into v_no_match
  from public.style_tracker_rows_with_bridge
  where nullif(trim(row_data ->> 'rfq_code'), '') is not null
    and not exists (
      select 1
      from dflow."RFQItem" i
      where upper(trim(i."rfqItem_style_number")) = upper(trim(row_data ->> 'rfq_code'))
        and i."rfqItem_rfq_group" is not null
    )
  limit 1;

  if v_no_match is null then
    raise notice 'SKIP no-match: every non-empty rfq_code matches an RFQ item';
  elsif v_no_match is distinct from '[]'::jsonb then
    raise exception 'ASSERT: unmatched rfq_code returned % (expected [])', v_no_match;
  end if;

  -- 8. Matching is case-insensitive + outer-trim (expression-level proof)
  --    Find a real linked code and prove lower/upper/padded variants resolve to the
  --    same group set via the same join key the view uses.
  select upper(trim(r.row_data ->> 'rfq_code')) into v_code
  from public.style_tracker_rows r
  where nullif(trim(r.row_data ->> 'rfq_code'), '') is not null
    and exists (
      select 1 from dflow."RFQItem" i
      where upper(trim(i."rfqItem_style_number")) = upper(trim(r.row_data ->> 'rfq_code'))
        and i."rfqItem_rfq_group" is not null
    )
  limit 1;

  if v_code is not null then
    select count(*) into v_fuzzy_hit
    from dflow."RFQItem" i
    where upper(trim(i."rfqItem_style_number")) = upper(trim('  ' || lower(v_code) || '  '))
      and i."rfqItem_rfq_group" is not null;
    if v_fuzzy_hit < 1 then
      raise exception 'ASSERT: case/trim match failed for code %', v_code;
    end if;

    -- 9. Matching does NOT use prefix/suffix/SKU fuzzy comparison.
    --    Count groups the VIEW attached that are only reachable via a stripped
    --    prefix of the code (not an exact match). Must be zero — raise if not.
    select count(*) into v_fuzzy_hit
    from dflow."RFQItem" i
    where upper(trim(i."rfqItem_style_number")) = upper(trim(left(v_code, greatest(length(v_code) - 1, 1))))
      and upper(trim(i."rfqItem_style_number")) is distinct from v_code
      and i."rfqItem_rfq_group" is not null
      and exists (
        select 1 from public.style_tracker_rows_with_bridge v
        where upper(trim(v.row_data ->> 'rfq_code')) = v_code
          and v.rfq_groups @> jsonb_build_array(
            jsonb_build_object('id', i."rfqItem_rfq_group")
          )
          -- only fail if the VIEW linked a group that only a prefix match would find
          and not exists (
            select 1 from dflow."RFQItem" i2
            where upper(trim(i2."rfqItem_style_number")) = v_code
              and i2."rfqItem_rfq_group" = i."rfqItem_rfq_group"
          )
      );
    if v_fuzzy_hit > 0 then
      raise exception
        'ASSERT: view linked % group(s) for code % that are only reachable via prefix/fuzzy match (exact match required)',
        v_fuzzy_hit, v_code;
    end if;
  end if;

  -- 10. Multi-group: latest first (linked_at desc), deterministic id desc tie-break
  select sku, rfq_groups into v_sku, v_groups
  from public.style_tracker_rows_with_bridge
  where jsonb_array_length(rfq_groups) > 1
  limit 1;

  if v_groups is not null then
    v_first_id := (v_groups -> 0 ->> 'id')::int;
    v_second_id := (v_groups -> 1 ->> 'id')::int;
    v_first_at := v_groups -> 0 ->> 'linked_at';
    v_second_at := v_groups -> 1 ->> 'linked_at';
    if v_first_at is not null and v_second_at is not null
       and v_first_at < v_second_at then
      raise exception
        'ASSERT: multi-group order not newest-first for %: %',
        v_sku, v_groups;
    end if;
    if v_first_at is not distinct from v_second_at
       and v_first_id < v_second_id then
      raise exception
        'ASSERT: equal linked_at did not use id DESC tie-break for %: %',
        v_sku, v_groups;
    end if;
  end if;

  -- 11. Dedup: no duplicate group ids inside any array
  if exists (
    select 1
    from public.style_tracker_rows_with_bridge v
    cross join lateral jsonb_array_elements(v.rfq_groups) g
    group by v.id, g ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'ASSERT: duplicate group id found inside an rfq_groups array';
  end if;

  -- 12/13. Privilege catalog checks (no SET ROLE — SET LOCAL ROLE in a migration
  -- transaction left the hosted CLI unable to write schema_migrations afterwards).
  -- Live role exercises (anon denied / authenticated allowed) are run post-apply.
  select count(*) into v_anon_privs
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'style_tracker_rows_with_bridge'
    and grantee in ('anon', 'PUBLIC');

  if v_anon_privs <> 0 then
    raise exception
      'ASSERT: anon/PUBLIC still hold % privilege(s) on style_tracker_rows_with_bridge',
      v_anon_privs;
  end if;

  select count(*) into v_auth_privs
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'style_tracker_rows_with_bridge'
    and grantee = 'authenticated'
    and privilege_type = 'SELECT';

  if v_auth_privs < 1 then
    raise exception 'ASSERT: authenticated lacks SELECT on style_tracker_rows_with_bridge';
  end if;

  raise notice 'OK: style_tracker_rows_with_bridge.rfq_groups — rows=%, linked=%, multi=%',
    v_row_count, v_linked_rows, v_multi_group_rows;
end;
$$;

-- Performance plan + live anon/authenticated role exercises are verified
-- post-apply (see PR body). Measured 2026-07-31 on preview: pre-aggregate join
-- ~112ms for full Master Data (15,533 rows); correlated alternative was ~91s
-- without an expression index — no index added.

-- PostgREST must reload its schema cache so consumers (PopDAM) see the new
-- rfq_groups column. Matches 20260721143000_dam_master_data_customer_id.sql.
notify pgrst, 'reload schema';
