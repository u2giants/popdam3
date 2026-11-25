-- popcre/shared-db#6996 (stage C4 of plan_shared_data_no_copies_db.md)
-- derived-from: 20261116120100, 20261225091306, 20261225120101
-- Retire PopDAM's copied lists: public.dam_character_catalog, dam.character_core_map,
-- public.characters, public.properties, public.licensors. Apps read core.* instead.
-- Recoverable: archive.*_before_c4_20261124 snapshots below, plus a private pg_dump
-- of the five objects (Albert's Dropbox ai/shared-db-6996, not GitHub).
-- plm.style_tracker_item_bridge.public_licensor_id is re-pointed to core.licensor
-- (code with DS->DY, WWE->WW, else name; production 8/8 distinct ids mapped by code).

begin;

create schema if not exists archive;

create table archive.characters_before_c4_20261124 as table public.characters;
create table archive.properties_before_c4_20261124 as table public.properties;
create table archive.licensors_before_c4_20261124 as table public.licensors;
create table archive.dam_character_catalog_before_c4_20261124 as table public.dam_character_catalog;
create table archive.dam_character_core_map_before_c4_20261124 as table dam.character_core_map;
create table archive.style_tracker_item_bridge_public_licensor_before_c4_20261124 as
  select id, public_licensor_id from plm.style_tracker_item_bridge where public_licensor_id is not null;

alter table archive.characters_before_c4_20261124 enable row level security;
revoke all on archive.characters_before_c4_20261124 from public, anon, authenticated;
alter table archive.properties_before_c4_20261124 enable row level security;
revoke all on archive.properties_before_c4_20261124 from public, anon, authenticated;
alter table archive.licensors_before_c4_20261124 enable row level security;
revoke all on archive.licensors_before_c4_20261124 from public, anon, authenticated;
alter table archive.dam_character_catalog_before_c4_20261124 enable row level security;
revoke all on archive.dam_character_catalog_before_c4_20261124 from public, anon, authenticated;
alter table archive.dam_character_core_map_before_c4_20261124 enable row level security;
revoke all on archive.dam_character_core_map_before_c4_20261124 from public, anon, authenticated;
alter table archive.style_tracker_item_bridge_public_licensor_before_c4_20261124 enable row level security;
revoke all on archive.style_tracker_item_bridge_public_licensor_before_c4_20261124 from public, anon, authenticated;

-- 1. Re-point the bridge licensor column to core.licensor.
create temporary table c4_licensor_map on commit drop as
select l.id as public_id,
  coalesce(
    (select min(c.id::text)::uuid from core.licensor c
      where lower(c.code) = lower(case l.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else l.external_id end)
      having count(*) = 1),
    (select min(c.id::text)::uuid from core.licensor c
      where lower(btrim(c.name)) = lower(btrim(l.name))
      having count(*) = 1)
  ) as core_id
from public.licensors l
where l.id in (select public_licensor_id from plm.style_tracker_item_bridge);

do $gate$
declare v_unmapped int;
begin
  select count(*) into v_unmapped from c4_licensor_map where core_id is null;
  if v_unmapped > 0 then
    raise exception 'C4: % bridge licensor id(s) have no unique core.licensor match', v_unmapped;
  end if;
end $gate$;

alter table plm.style_tracker_item_bridge
  drop constraint style_tracker_item_bridge_public_licensor_id_fkey;

update plm.style_tracker_item_bridge b
set public_licensor_id = m.core_id
from c4_licensor_map m
where b.public_licensor_id = m.public_id;

alter table plm.style_tracker_item_bridge
  add constraint style_tracker_item_bridge_public_licensor_id_fkey
  foreign key (public_licensor_id) references core.licensor(id) on delete set null;

create index if not exists style_tracker_item_bridge_public_licensor_id_idx
  on plm.style_tracker_item_bridge (public_licensor_id);

-- 2. View: licensor fallback name now comes from core.licensor (same columns).
-- Rewrite only the licensor join in the installed definition so each database
-- keeps its own RFQ schema binding.
do $view$
declare
  current_definition text := pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass);
  old_join constant text := 'LEFT JOIN licensors public_lic ON';
  new_join constant text := 'LEFT JOIN core.licensor public_lic ON';
begin
  if array_length(string_to_array(current_definition, old_join), 1) is distinct from 2 then
    raise exception 'C4: unexpected licensor join in public.style_tracker_rows_with_bridge';
  end if;
  execute 'CREATE OR REPLACE VIEW public.style_tracker_rows_with_bridge AS '
    || replace(current_definition, old_join, new_join);
  if strpos(pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass), new_join) = 0 then
    raise exception 'C4: core.licensor join was not installed';
  end if;
end;
$view$;

grant select on public.style_tracker_rows_with_bridge to authenticated, service_role;

-- 3. Bridge refresh matches licensors in core.licensor only.
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
    FROM core.licensor
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
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'core' AND licensor_res.target_table = 'licensor' THEN licensor_res.target_id ELSE public_lic.id END AS public_licensor_id,
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

-- 4. Search: drop the legacy-character legs; keep the old key as a no-op.
create or replace function public.get_dam_search_named_rows(p_keys text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  -- Two 500-character inputs contain at most 3,944 contiguous one-to-eight-word phrases.
  if p_keys is null or cardinality(p_keys) > 4000 or coalesce(array_ndims(p_keys), 1) <> 1 then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase list';
  end if;
  if exists (
    select 1 from unnest(p_keys) as phrases(phrase)
    where phrase is null or octet_length(phrase) > 500
      or phrase collate pg_catalog."C" !~ '^[a-z0-9]+( [a-z0-9]+){0,7}$'
  ) then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase';
  end if;

  return (
    with properties as materialized (
      select p.id, p.name
      from core.property p
      where btrim(regexp_replace(lower(replace(replace(p.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    ), licensors as (
      select i.name
      from core.licensor i
      where btrim(regexp_replace(lower(replace(replace(i.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      union all
      select a.alias
      from core.licensor_alias a
      where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    )
    select jsonb_build_object(
      'characters', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
        from core.character c
        where btrim(regexp_replace(lower(replace(replace(c.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'aliases', coalesce((
        select jsonb_agg(jsonb_build_object('characterId', a.character_id, 'alias', a.alias))
        from core.character_alias a
        where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      -- C4 (#6996): the legacy character list is retired; the key stays (always empty) for
      -- PopDAM builds that still read it.
      'legacyCharacters', '[]'::jsonb,
      'properties', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)) from properties p
      ), '[]'::jsonb),
      'propertyCharacters', coalesce((
        select jsonb_agg(jsonb_build_object('propertyId', a.property_id, 'characterId', a.character_id))
        from core.property_character_associations_current a
        join properties p on p.id = a.property_id
      ), '[]'::jsonb),
      'licensorNames', coalesce((select jsonb_agg(i.name) from licensors i), '[]'::jsonb)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.dam_search_named_scope(p_filters jsonb, p_need_asset_sets boolean, OUT character_groups uuid[], OUT character_assets uuid[], OUT property_groups uuid[], OUT property_assets uuid[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_characters uuid[] := public.dam_search_uuid_list(p_filters->'requiredCharacterIds');
  v_names tsquery[] := public.dam_search_name_queries(p_filters->'requiredCharacterNames');
  v_properties uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyIds');
  v_property_characters uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds');
  v_tag_ids uuid[];
begin
  -- C4 (popcre/shared-db#6996): the legacy character list and its id map are
  -- retired. requiredLegacyCharacterIds is accepted and ignored; tags hold core ids.
  if v_characters is not null then
    v_tag_ids := v_characters;
  end if;
  if v_characters is not null or v_names is not null then
    -- style groups: a non-deleted member file is tagged, or the group's own text names it
    select coalesce(array_agg(distinct x.id), '{}') into character_groups from (
      select a.style_group_id id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is not null
      union all
      select a.style_group_id
      from public.asset_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is not null
      union all
      select k.entity_id
      from unnest(v_names) q
      join public.dam_search_keys k on k.search_tsv @@ q
      where k.document_type = 'style_group'
    ) x where x.id is not null;
    -- ungrouped asset documents: the file itself is tagged. (Name matching runs on style-group
    -- text only: on 171k asset texts a common name reads ~10k rows, 13 s cold on production.)
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into character_assets from (
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is null
        union all
        select a.id
        from public.asset_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
  if v_properties is not null or v_property_characters is not null then
    select coalesce(array_agg(distinct x.id), '{}') into property_groups from (
      select g.id from public.style_groups g where g.property_id = any(v_properties)
      union all
      select a.style_group_id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is not null
      union all
      select a.style_group_id
      from public.asset_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is not null
    ) x where x.id is not null;
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into property_assets from (
        select a.id from public.assets a
        where a.property_id = any(v_properties) and a.style_group_id is null and not a.is_deleted
        union all
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is null
        union all
        select a.id
        from public.asset_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
end;
$function$;

-- 5. Drop the copies (dependents first).
drop view public.dam_character_catalog;
drop table dam.character_core_map;
drop table public.characters;
drop table public.properties;
drop table public.licensors;

do $post$
begin
  if to_regclass('public.characters') is not null or to_regclass('public.properties') is not null
     or to_regclass('public.licensors') is not null or to_regclass('public.dam_character_catalog') is not null
     or to_regclass('dam.character_core_map') is not null then
    raise exception 'C4: a retired object still exists';
  end if;
  if (select confrelid from pg_constraint
      where conname = 'style_tracker_item_bridge_public_licensor_id_fkey'
        and conrelid = 'plm.style_tracker_item_bridge'::regclass) <> 'core.licensor'::regclass then
    raise exception 'C4: bridge FK does not target core.licensor';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.dam_search_named_scope(jsonb,boolean)'::regprocedure)
     or has_function_privilege('anon', 'public.dam_search_named_scope(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_named_scope(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.dam_search_named_scope(jsonb,boolean)', 'execute') then
    raise exception 'C4: dam_search_named_scope security/grants changed';
  end if;
end $post$;

commit;
