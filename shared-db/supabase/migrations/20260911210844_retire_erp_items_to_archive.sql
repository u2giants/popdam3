-- Issue #2482: retire the frozen DesignFlow item feed (public.erp_items_current and
-- public.erp_items_raw) on the recoverable path.
--
-- Nothing is dropped. The remaining readers (api.plm_item_list, the style-tracker bridge
-- refresh, the category-prediction identity trigger) and the bridge's legacy FK are moved
-- off the live tables, then both tables are moved into a private `archive` schema with
-- anon/authenticated access revoked. A later governed migration may drop them.
--
-- The legacy UUIDs PopDAM still carries (view ids, 13,700 bridge erp_item_id values,
-- prediction erp_item_id values) must keep resolving exactly as before, so the columns
-- those readers used are frozen into plm.legacy_erp_item_identity first. Every rewritten
-- body below is the current production body (pg_get_functiondef, byte-identical to the
-- latest migrations) with only the table reference changed. Production proof before
-- authoring: the view logic against this crosswalk returned 19,362 rows with the same md5
-- of (id|source_id|division_code ordered by id) as the live view,
-- 7f214c4a3178143a41d2741c8cad677a.
--
-- derived-from: 20260909220101, 20260816110750

begin;

-- Block writes to the retiring tables for the rest of this transaction, so the frozen copy
-- and its row-count guard below see one consistent snapshot.
lock table public.erp_items_current, public.erp_items_raw in share row exclusive mode;

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
comment on schema archive is
  'Retired tables kept for recovery only. Not exposed to API roles. Contents may be dropped by a later governed migration.';

create table plm.legacy_erp_item_identity (
  id uuid primary key,
  external_id text not null unique,
  style_number text,
  division_code text,
  item_description text,
  mg01_code text,
  mg02_code text,
  mg03_code text,
  mg04_code text,
  mg05_code text,
  mg06_code text,
  frozen_at timestamptz not null default now()
);

insert into plm.legacy_erp_item_identity (
  id, external_id, style_number, division_code, item_description,
  mg01_code, mg02_code, mg03_code, mg04_code, mg05_code, mg06_code
)
select
  id, external_id, style_number, division_code, item_description,
  mg01_code, mg02_code, mg03_code, mg04_code, mg05_code, mg06_code
from public.erp_items_current;

do $$
begin
  if (select count(*) from plm.legacy_erp_item_identity)
     is distinct from (select count(*) from public.erp_items_current) then
    raise exception '#2482: legacy identity crosswalk row count does not match public.erp_items_current';
  end if;
end;
$$;

comment on table plm.legacy_erp_item_identity is
  'Frozen copy (#2482) of the identity and matching columns of the retired DesignFlow item feed. Resolves legacy ERP item UUIDs still carried by api.plm_item_list ids, plm.style_tracker_item_bridge.erp_item_id and public.product_category_predictions.erp_item_id. No feed writes it.';

alter table plm.legacy_erp_item_identity enable row level security;
revoke all on plm.legacy_erp_item_identity from public, anon, authenticated;
grant select on plm.legacy_erp_item_identity to authenticated, service_role;

-- Mirrors the retired "Admin manage erp_items_current" policy for reads, so the
-- security-invoker prediction identity trigger resolves for the same admins as before.
create policy legacy_erp_item_identity_admin_read
  on plm.legacy_erp_item_identity
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace view api.plm_item_list
with (security_invoker = false, security_barrier = true) as
with canonical_items as (
  select
    item.*,
    legacy.id as legacy_id,
    row_number() over (
      partition by item.item_number
      order by
        case
          when legacy.division_code is not null
           and legacy.division_code = item.raw ->> 'divisionCode' then 0
          else 1
        end,
        item.source_id,
        item.id
    ) as legacy_rank
  from plm.item item
  left join plm.legacy_erp_item_identity legacy
    on legacy.external_id = item.item_number
  where item.source_system = 'coldlion'
)
select
  case when i.legacy_id is not null and i.legacy_rank = 1
    then i.legacy_id else i.id end                        as id,
  i.item_number                                           as source_id,
  i.item_number                                           as style_number,
  i.description                                           as item_description,
  i.raw ->> 'mGCategory'                                  as mg_category,
  i.raw ->> 'merchGroup01'                                as mg01_code,
  i.raw ->> 'merchGroup02'                                as mg02_code,
  i.raw ->> 'merchGroup03'                                as mg03_code,
  i.raw ->> 'merchGroup04'                                as mg04_code,
  i.raw ->> 'merchGroup05'                                as mg05_code,
  i.raw ->> 'merchGroup06'                                as mg06_code,
  i.raw ->> 'sizeRangeCode'                               as size_code,
  licensor.code                                           as licensor_code,
  property.code                                           as property_code,
  i.raw ->> 'divisionCode'                                as division_code,
  prepacks.prepack_code,
  prepacks.prepack_codes,
  coalesce(state.dismissed, false)                        as dismissed,
  nullif(i.raw ->> 'modTime', '')::timestamptz            as erp_updated_at,
  i.updated_at                                            as synced_at,
  i.source_system
from canonical_items i
left join core.licensor licensor on licensor.id = i.licensor_id
left join core.property property on property.id = i.property_id
left join public.popdam_item_state state on state.item_id = i.id
left join lateral (
  select
    min(btrim(detail.pre_pack_code)) as prepack_code,
    to_jsonb(
      array_agg(distinct btrim(detail.pre_pack_code) order by btrim(detail.pre_pack_code))
    ) as prepack_codes
  from coldlion.item_detail detail
  where detail.company_code = i.raw ->> 'companyCode'
    and detail.division_code = i.raw ->> 'divisionCode'
    and detail.item_no = i.item_number
    and nullif(btrim(detail.pre_pack_code), '') is not null
) prepacks on true;

comment on view api.plm_item_list is
  'Canonical ColdLion-backed 21-column item list. PopDAM dismissal now comes only from public.popdam_item_state; no raw source payload is exposed. Legacy UUID compatibility is served from the frozen plm.legacy_erp_item_identity crosswalk (#2482).';

grant select on api.plm_item_list to authenticated;

CREATE OR REPLACE FUNCTION plm.refresh_style_tracker_item_bridge()
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm', 'core', 'extensions'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM plm.style_tracker_item_bridge;

  WITH erp_matches AS (
    SELECT upper(trim(style_number)) AS normalized_sku, CASE WHEN count(*) = 1 THEN min(id::text)::uuid END AS id, count(*) AS candidate_count
    FROM plm.legacy_erp_item_identity
    WHERE style_number IS NOT NULL AND trim(style_number) <> ''
    GROUP BY upper(trim(style_number))
  ),
  style_group_matches AS (
    SELECT upper(trim(sku)) AS normalized_sku, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.style_groups
    WHERE sku IS NOT NULL AND trim(sku) <> ''
    GROUP BY upper(trim(sku))
  ),
  company_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.customer
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  public_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.licensors
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  core_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.licensor
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  factory_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.factory
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  plm_item_matches AS (
    SELECT upper(trim(coalesce(style_number, item_number))) AS normalized_sku, CASE WHEN count(*) = 1 THEN min(id::text)::uuid END AS id, count(*) AS candidate_count
    FROM plm.item
    WHERE coalesce(style_number, item_number) IS NOT NULL AND trim(coalesce(style_number, item_number)) <> ''
    GROUP BY upper(trim(coalesce(style_number, item_number)))
  ),
  row_values AS (
    SELECT
      r.*,
      plm.normalize_style_tracker_value('sku', r.sku) AS sku_norm,
      plm.normalize_style_tracker_value('customer', r.customer) AS customer_norm,
      plm.normalize_style_tracker_value('licensor', r.licensor) AS licensor_norm,
      plm.normalize_style_tracker_value('factory', r.default_vendor) AS factory_norm
    FROM public.style_tracker_rows r
    WHERE r.source_sheet IN ('License.Style', 'Generic.Style')
  ),
  customer_values AS (
    SELECT DISTINCT customer_norm, customer
    FROM row_values
    WHERE customer_norm IS NOT NULL
  ),
  licensor_values AS (
    SELECT DISTINCT licensor_norm, licensor
    FROM row_values
    WHERE licensor_norm IS NOT NULL
  ),
  factory_values AS (
    SELECT DISTINCT factory_norm, default_vendor
    FROM row_values
    WHERE factory_norm IS NOT NULL
  ),
  fuzzy_customers AS (
    SELECT DISTINCT ON (v.customer_norm)
      v.customer_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM customer_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('customer', v.customer, 1) c
    ORDER BY v.customer_norm, c.score DESC
  ),
  fuzzy_licensors AS (
    SELECT DISTINCT ON (v.licensor_norm)
      v.licensor_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM licensor_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('licensor', v.licensor, 1) c
    ORDER BY v.licensor_norm, c.score DESC
  ),
  fuzzy_factories AS (
    SELECT DISTINCT ON (v.factory_norm)
      v.factory_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM factory_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('factory', v.default_vendor, 1) c
    ORDER BY v.factory_norm, c.score DESC
  ),
  resolved AS (
    SELECT
      r.*,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'erp_items_current' THEN sku_res.target_id ELSE erp.id END AS erp_item_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'style_groups' THEN sku_res.target_id ELSE sg.id END AS style_group_id,
      CASE WHEN customer_res.resolution_type = 'canonical' AND customer_res.target_schema = 'core' AND customer_res.target_table = 'customer' THEN customer_res.target_id ELSE company.id END AS company_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'public' AND licensor_res.target_table = 'licensors' THEN licensor_res.target_id ELSE public_lic.id END AS public_licensor_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'core' AND licensor_res.target_table = 'licensor' THEN licensor_res.target_id ELSE core_lic.id END AS core_licensor_id,
      CASE WHEN factory_res.resolution_type = 'canonical' AND factory_res.target_schema = 'core' AND factory_res.target_table = 'factory' THEN factory_res.target_id ELSE factory.id END AS factory_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'plm' AND sku_res.target_table = 'item' THEN sku_res.target_id ELSE coalesce(plm_item.id, content_item.id) END AS plm_item_id,
      sku_res.local_value AS local_sku_value,
      customer_res.local_value AS local_customer_value,
      licensor_res.local_value AS local_licensor_value,
      factory_res.local_value AS local_factory_value,
      coalesce(erp.candidate_count, 0) AS erp_candidates,
      coalesce(sg.candidate_count, 0) AS style_group_candidates,
      coalesce(company.candidate_count, 0) AS company_candidates,
      coalesce(public_lic.candidate_count, 0) AS public_licensor_candidates,
      coalesce(core_lic.candidate_count, 0) AS core_licensor_candidates,
      coalesce(factory.candidate_count, 0) AS factory_candidates,
      coalesce(nullif(content_item.candidate_count, 0), plm_item.candidate_count, 0) AS plm_item_candidates,
      fuzzy_customer.suggestion AS fuzzy_customer_suggestion,
      fuzzy_licensor.suggestion AS fuzzy_licensor_suggestion,
      fuzzy_factory.suggestion AS fuzzy_factory_suggestion
    FROM row_values r
    LEFT JOIN erp_matches erp ON erp.normalized_sku = r.sku_norm
    LEFT JOIN style_group_matches sg ON sg.normalized_sku = r.sku_norm
    LEFT JOIN company_matches company ON company.normalized_name = r.customer_norm
    LEFT JOIN public_licensor_matches public_lic ON public_lic.normalized_name = r.licensor_norm
    LEFT JOIN core_licensor_matches core_lic ON core_lic.normalized_name = r.licensor_norm
    LEFT JOIN factory_matches factory ON factory.normalized_name = r.factory_norm
    LEFT JOIN plm_item_matches plm_item ON plm_item.normalized_sku = r.sku_norm
    LEFT JOIN plm.style_tracker_item_bridge existing_bridge ON existing_bridge.style_tracker_row_id = r.id
    LEFT JOIN plm.legacy_erp_item_identity existing_erp ON existing_erp.id = existing_bridge.erp_item_id
    LEFT JOIN LATERAL (
      WITH scored AS (
        SELECT p.id,
          ((nullif(trim(existing_erp.item_description), '') is not null and upper(trim(existing_erp.item_description)) = upper(trim(p.description)))::int +
           (nullif(trim(existing_erp.mg01_code), '') is not null and upper(trim(existing_erp.mg01_code)) = upper(trim(p.raw ->> 'merchGroup01')))::int +
           (nullif(trim(existing_erp.mg02_code), '') is not null and upper(trim(existing_erp.mg02_code)) = upper(trim(p.raw ->> 'merchGroup02')))::int +
           (nullif(trim(existing_erp.mg03_code), '') is not null and upper(trim(existing_erp.mg03_code)) = upper(trim(p.raw ->> 'merchGroup03')))::int +
           (nullif(trim(existing_erp.mg04_code), '') is not null and upper(trim(existing_erp.mg04_code)) = upper(trim(p.raw ->> 'merchGroup04')))::int +
           (nullif(trim(existing_erp.mg05_code), '') is not null and upper(trim(existing_erp.mg05_code)) = upper(trim(p.raw ->> 'merchGroup05')))::int +
           (nullif(trim(existing_erp.mg06_code), '') is not null and upper(trim(existing_erp.mg06_code)) = upper(trim(p.raw ->> 'merchGroup06')))::int) AS score
        FROM plm.item p
        WHERE existing_erp.id is not null
          AND upper(trim(p.item_number)) = upper(trim(existing_erp.external_id))
      ), ranked AS (
        SELECT id, score, dense_rank() over (order by score desc) AS score_rank
        FROM scored
      )
      SELECT CASE WHEN count(*) = 1 AND max(score) > 0 THEN min(id::text)::uuid END AS id,
             CASE WHEN max(score) > 0 THEN count(*)::bigint ELSE 0::bigint END AS candidate_count
      FROM ranked
      WHERE score_rank = 1
    ) content_item ON plm_item.candidate_count > 1
    LEFT JOIN plm.style_tracker_value_resolution sku_res ON sku_res.field_key = 'sku' AND sku_res.normalized_value = r.sku_norm
    LEFT JOIN plm.style_tracker_value_resolution customer_res ON customer_res.field_key = 'customer' AND customer_res.normalized_value = r.customer_norm
    LEFT JOIN plm.style_tracker_value_resolution licensor_res ON licensor_res.field_key = 'licensor' AND licensor_res.normalized_value = r.licensor_norm
    LEFT JOIN plm.style_tracker_value_resolution factory_res ON factory_res.field_key = 'factory' AND factory_res.normalized_value = r.factory_norm
    LEFT JOIN fuzzy_customers fuzzy_customer ON fuzzy_customer.customer_norm = r.customer_norm AND company.id IS NULL AND customer_res.id IS NULL
    LEFT JOIN fuzzy_licensors fuzzy_licensor ON fuzzy_licensor.licensor_norm = r.licensor_norm AND public_lic.id IS NULL AND core_lic.id IS NULL AND licensor_res.id IS NULL
    LEFT JOIN fuzzy_factories fuzzy_factory ON fuzzy_factory.factory_norm = r.factory_norm AND factory.id IS NULL AND factory_res.id IS NULL
  ),
  upserted AS (
    INSERT INTO plm.style_tracker_item_bridge (
      style_tracker_row_id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer_name,
      designer_name,
      commissioned,
      upc,
      customer_sku,
      licensor_name,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor_name,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      match_status,
      match_confidence,
      match_notes,
      raw_row_data,
      last_matched_at
    )
    SELECT
      id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer,
      designer,
      commissioned,
      upc,
      customer_sku,
      licensor,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'needs_review'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'needs_review'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN CASE WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL THEN 'matched' ELSE 'partial' END
        WHEN local_sku_value IS NOT NULL OR local_customer_value IS NOT NULL OR local_licensor_value IS NOT NULL OR local_factory_value IS NOT NULL
          THEN 'partial'
        ELSE 'unmatched'
      END,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'conflict'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'possible'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN 'probable'
        WHEN company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL
          THEN 'possible'
        ELSE 'possible'
      END,
      jsonb_strip_nulls(jsonb_build_object(
        'erp_candidates', erp_candidates,
        'style_group_candidates', style_group_candidates,
        'company_candidates', company_candidates,
        'public_licensor_candidates', public_licensor_candidates,
        'core_licensor_candidates', core_licensor_candidates,
        'factory_candidates', factory_candidates,
        'plm_item_candidates', plm_item_candidates,
        'fuzzy', jsonb_strip_nulls(jsonb_build_object(
          'customer', fuzzy_customer_suggestion,
          'licensor', fuzzy_licensor_suggestion,
          'factory', fuzzy_factory_suggestion
        )),
        'master_data_values', jsonb_strip_nulls(jsonb_build_object(
          'sku', local_sku_value,
          'customer', local_customer_value,
          'licensor', local_licensor_value,
          'factory', local_factory_value
        ))
      )),
      row_data,
      now()
    FROM resolved
    ON CONFLICT (style_tracker_row_id) DO UPDATE SET
      source_workbook_id = EXCLUDED.source_workbook_id,
      source_sheet = EXCLUDED.source_sheet,
      source_row_number = EXCLUDED.source_row_number,
      tracker_type = EXCLUDED.tracker_type,
      sku = EXCLUDED.sku,
      description = EXCLUDED.description,
      customer_name = EXCLUDED.customer_name,
      designer_name = EXCLUDED.designer_name,
      commissioned = EXCLUDED.commissioned,
      upc = EXCLUDED.upc,
      customer_sku = EXCLUDED.customer_sku,
      licensor_name = EXCLUDED.licensor_name,
      license_status = EXCLUDED.license_status,
      royalty = EXCLUDED.royalty,
      concept_status = EXCLUDED.concept_status,
      pre_production_status = EXCLUDED.pre_production_status,
      production_status = EXCLUDED.production_status,
      default_vendor_name = EXCLUDED.default_vendor_name,
      discontinued = EXCLUDED.discontinued,
      notes = EXCLUDED.notes,
      erp_item_id = coalesce(plm.style_tracker_item_bridge.erp_item_id, EXCLUDED.erp_item_id),
      style_group_id = EXCLUDED.style_group_id,
      company_id = EXCLUDED.company_id,
      public_licensor_id = EXCLUDED.public_licensor_id,
      core_licensor_id = EXCLUDED.core_licensor_id,
      factory_id = EXCLUDED.factory_id,
      plm_item_id = coalesce(plm.style_tracker_item_bridge.plm_item_id, EXCLUDED.plm_item_id),
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_notes = EXCLUDED.match_notes,
      raw_row_data = EXCLUDED.raw_row_data,
      last_matched_at = EXCLUDED.last_matched_at
    RETURNING (xmax = 0)::integer AS inserted_flag
  )
  SELECT
    coalesce(sum(inserted_flag), 0)::integer,
    (count(*) - coalesce(sum(inserted_flag), 0))::integer,
    count(*)::integer
  INTO inserted_count, updated_count, total_count
  FROM upserted;

  SELECT count(*) INTO v_after FROM plm.style_tracker_item_bridge;
  inserted_count := greatest(v_after - v_before, 0);

  RETURN NEXT;
END;
$function$;

create or replace function public.resolve_product_category_prediction_item_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, plm
as $$
declare
  v_match_count integer;
  v_item_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.plm_item_id is not null
     and new.plm_item_id is null
     and new.external_id is not distinct from old.external_id
     and new.erp_item_id is not distinct from old.erp_item_id then
    new.item_identity_status := 'unresolved';
    return new;
  end if;

  if new.plm_item_id is not null then
    if not exists (
      select 1
      from plm.item item
      where item.id = new.plm_item_id
        and (
          length(new.external_id) - length(replace(new.external_id, '|', '')) <> 2
          or (
            item.source_system = split_part(new.external_id, '|', 1)
            and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
            and item.item_number = split_part(new.external_id, '|', 3)
          )
        )
    ) then
      raise exception 'plm_item_id does not identify a canonical item' using errcode = '23503';
    end if;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if length(new.external_id) - length(replace(new.external_id, '|', '')) = 2 then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.item item
    where item.source_system = split_part(new.external_id, '|', 1)
      and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
      and item.item_number = split_part(new.external_id, '|', 3);

    if v_match_count <> 1 then
      raise exception 'canonical prediction identity must resolve exactly once: % (matches=%)',
        new.external_id, v_match_count using errcode = 'P0001';
    end if;

    new.plm_item_id := v_item_id;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if new.erp_item_id is not null then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.legacy_erp_item_identity legacy
    join plm.item item
      on item.source_system = 'coldlion'
     and item.item_number = legacy.external_id
     and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
    where legacy.id = new.erp_item_id;

    if v_match_count = 1 then
      new.plm_item_id := v_item_id;
      new.item_identity_status := 'resolved';
    else
      new.item_identity_status := 'unresolved';
    end if;
  else
    new.item_identity_status := 'unresolved';
  end if;

  return new;
end;
$$;

-- Keep erp_item_id and every stored value; only the constraint to the retired table goes.
alter table plm.style_tracker_item_bridge
  drop constraint style_tracker_item_bridge_erp_item_id_fkey;

do $$
declare
  v_blockers text;
begin
  select string_agg(distinct rw.ev_class::regclass::text, ', ')
  into v_blockers
  from pg_depend dep
  join pg_rewrite rw on rw.oid = dep.objid
  where dep.classid = 'pg_rewrite'::regclass
    and dep.refobjid in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass)
    and rw.ev_class not in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass);
  if v_blockers is not null then
    raise exception '#2482: views still depend on the retiring tables: %', v_blockers;
  end if;

  select string_agg(conname || ' on ' || conrelid::regclass::text, ', ')
  into v_blockers
  from pg_constraint
  where contype = 'f'
    and confrelid in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass)
    and conrelid not in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass);
  if v_blockers is not null then
    raise exception '#2482: foreign keys still reference the retiring tables: %', v_blockers;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
  into v_blockers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prokind in ('f', 'p')
    and p.prosrc ~* '(from|join|into|update|table)\s+("?public"?\.)?"?erp_items_(current|raw)\M';
  if v_blockers is not null then
    raise exception '#2482: routines still read or write the retiring tables: %', v_blockers;
  end if;

  select string_agg(pol.polname || ' on ' || pol.polrelid::regclass::text, ', ')
  into v_blockers
  from pg_policy pol
  where pol.polrelid not in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass)
    and concat_ws(' ', pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid))
        ~* 'erp_items_(current|raw)\M';
  if v_blockers is not null then
    raise exception '#2482: policies still reference the retiring tables: %', v_blockers;
  end if;

  select string_agg(pub.pubname, ', ')
  into v_blockers
  from pg_publication_rel pr
  join pg_publication pub on pub.oid = pr.prpubid
  where pr.prrelid in ('public.erp_items_current'::regclass, 'public.erp_items_raw'::regclass);
  if v_blockers is not null then
    raise exception '#2482: publications still include the retiring tables: %', v_blockers;
  end if;
end;
$$;

alter table public.erp_items_current set schema archive;
alter table public.erp_items_raw set schema archive;

revoke all on archive.erp_items_current from public, anon, authenticated;
revoke all on archive.erp_items_raw from public, anon, authenticated;

comment on table archive.erp_items_current is
  'RETIRED (#2482). Frozen DesignFlow item snapshot, moved from public for recovery only. Readers use plm.item and plm.legacy_erp_item_identity.';
comment on table archive.erp_items_raw is
  'RETIRED (#2482). Frozen DesignFlow raw item payloads, moved from public for recovery only.';

commit;
