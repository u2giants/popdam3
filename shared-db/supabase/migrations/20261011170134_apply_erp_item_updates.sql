-- =====================================================================================
-- Issue #4167 - PopDAM ERP apply: update an item's assets and style group in one call
-- (PopDAM u2giants/popdam3#204; app-side batching landed in popdam3 PR #309).
-- Claim #4179 reserves version 20261011170134 and exactly one object:
--
--   function public.apply_erp_item_updates(jsonb)   (new)
--
-- derived-from: none
--
-- WHAT IT DOES
-- ---------------------------------------------------------------------------------
-- The PopDAM worker (apps/worker/src/handlers/erp.ts) today sends, per ERP item, one
-- PATCH to public.assets and one to public.style_groups, both matched on
-- (sku, division_code) and, for assets, is_deleted = false. The two writes are not
-- atomic and cost two round trips per item, 100 items per page.
--
-- This function takes the whole page as a JSON array and applies every item's asset
-- and style-group update inside the caller's single transaction, so either the whole
-- page lands or none of it does. It returns one result object per input item, in
-- input order: {asset_count, group_count, asset_id, group_id}, where *_id is one
-- matched row id (or null), which the worker uses as the audit-log target exactly as
-- it used the first returned row before.
--
-- Input element shape: {"sku": text, "division_code": text, "updates": {field: text}}.
-- Only these fields may appear in "updates" (every one is a text column on both
-- tables): mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code,
-- division_code, product_category, cover_description. Any other key, a missing sku,
-- an empty updates object, a non-array payload or more than 500 items raises, and the
-- whole call is rolled back. Matching keeps the worker's semantics: plain equality on
-- sku and division_code, no trimming (a null division_code matches nothing); sku must
-- be a non-empty JSON string and division_code a string or null. Each UPDATE's SET
-- names only the keys the item carries, so column-list triggers fire exactly as they
-- did for the worker's per-key PATCH. Matched ids are returned lowest-first.
--
-- Concurrency: the page runs in one transaction, so two overlapping pages applied
-- concurrently in different orders could deadlock; Postgres then aborts one page as a
-- unit and the worker retries it (values are absolute, so a retry is idempotent).
-- PopDAM runs one ERP apply at a time. lock_timeout 10s bounds any row-lock wait.
--
-- The erp_enrichment_log insert stays in the worker: it needs the ids this returns.
-- Execute is service_role only (the worker's client).
-- =====================================================================================

create function public.apply_erp_item_updates(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
set lock_timeout to '10s'
as $function$
declare
  c_allowed constant text[] := array[
    'mg01_code','mg02_code','mg03_code','size_code','licensor_code',
    'property_code','division_code','product_category','cover_description'];
  v_item     jsonb;
  v_u        jsonb;
  v_sku      text;
  v_div      text;
  v_bad      text;
  v_a_ids    uuid[];
  v_g_ids    uuid[];
  v_set      text;
  v_results  jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'p_items has % items; the limit is 500', jsonb_array_length(p_items)
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each item must be a JSON object' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'sku') is distinct from 'string' or v_item ->> 'sku' = '' then
      raise exception 'item sku is required and must be a non-empty string' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'division_code') not in ('string', 'null') then
      raise exception 'item % division_code must be a string or null', v_item ->> 'sku' using errcode = '22023';
    end if;
    v_sku := v_item ->> 'sku';
    v_div := v_item ->> 'division_code';
    v_u   := v_item -> 'updates';
    if v_u is null or jsonb_typeof(v_u) <> 'object' or v_u = '{}'::jsonb then
      raise exception 'item % updates must be a non-empty JSON object', v_sku using errcode = '22023';
    end if;
    select k into v_bad from jsonb_object_keys(v_u) as k where k <> all (c_allowed) limit 1;
    if v_bad is not null then
      raise exception 'item % updates field % is not allowed', v_sku, v_bad using errcode = '22023';
    end if;
    select k into v_bad from jsonb_each(v_u) as e(k, v)
     where jsonb_typeof(v) not in ('string', 'null') limit 1;
    if v_bad is not null then
      raise exception 'item % updates field % must be a string or null', v_sku, v_bad using errcode = '22023';
    end if;

    -- SET names only the keys this item carries (H1, issue #4167 review): column-list
    -- triggers such as trg_sync_cover_description_to_style_group and the search
    -- refresh then fire exactly as they did for the worker's per-key PATCH. Keys are
    -- whitelisted above, quoted with %I, and values bound through $3.
    select string_agg(format('%I = ($3 ->> %L)', k, k), ', ' order by k)
      into v_set
      from jsonb_object_keys(v_u) as k;

    execute format(
      'with upd as (update public.assets a set %s
                     where a.sku = $1 and a.division_code = $2 and a.is_deleted = false
                     returning a.id)
       select coalesce(array_agg(id order by id), ''{}''::uuid[]) from upd', v_set)
      into v_a_ids
      using v_sku, v_div, v_u;

    execute format(
      'with upd as (update public.style_groups g set %s
                     where g.sku = $1 and g.division_code = $2
                     returning g.id)
       select coalesce(array_agg(id order by id), ''{}''::uuid[]) from upd', v_set)
      into v_g_ids
      using v_sku, v_div, v_u;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'asset_count', cardinality(v_a_ids),
      'group_count', cardinality(v_g_ids),
      'asset_id',    v_a_ids[1],
      'group_id',    v_g_ids[1]));
  end loop;

  return v_results;
end;
$function$;

revoke all on function public.apply_erp_item_updates(jsonb) from public;
revoke all on function public.apply_erp_item_updates(jsonb) from anon;
revoke all on function public.apply_erp_item_updates(jsonb) from authenticated;
grant execute on function public.apply_erp_item_updates(jsonb) to service_role;

comment on function public.apply_erp_item_updates(jsonb) is
  'shared-db#4167: apply a page of ERP item updates to public.assets and public.style_groups '
  'atomically; returns per-item {asset_count, group_count, asset_id, group_id} in input order.';
