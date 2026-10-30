-- derived-from: 20260824011750
-- #5037 (claim #5044): DAM Master Data first-load timeouts.
--
-- public.style_tracker_rows_with_bridge joined api.plm_item_list per tracker
-- row. The item list exposes its id through a window function, so no index can
-- serve that join and the planner rescanned all 19,878 item rows per tracker
-- row: ~19.9M join-filter comparisons per 1,000-row page request (measured
-- 2026-10-29; 3.7-6.8 s warm, cold runs over the shared 8 s statement cap,
-- surfacing in PopDAM as "Master Data could not be loaded.").
--
-- This resolves the same identity through indexed base tables instead:
-- plm.item primary key, plm.legacy_erp_item_identity unique external_id, and
-- the existing plm.item expression index item_upper_trim_item_number_idx
-- (probe predicates pair the sargable upper(trim(...)) equality with the exact
-- item_number equality, so semantics stay exactly those of a plain equality
-- join). The identity rule reproduced here is exactly api.plm_item_list's
--   id = case when legacy_id is not null and legacy_rank = 1
--             then legacy_id else item.id end
-- with rank ordering (division match, source_id, id) within an item_number.
-- Value-preserving: read-only full-view comparison against production on
-- 2026-10-29 returned 0 differences across all rows of both sheets. No new
-- objects are created and nothing outside the view is written.

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
-- Indexed equivalent of `left join api.plm_item_list erp on erp.id = b.erp_item_id`.
-- Branch 1: the bridge id is an item id exposed under its own id (the item is
-- not the rank-1 item of its item_number carrying a legacy id). Branch 2: the
-- bridge id is a legacy id, exposed for the rank-1 item of that item_number.
left join lateral (
  (
    select i.description as item_description, i.item_number as style_number
    from plm.item i
    where i.id = b.erp_item_id
      and i.source_system = 'coldlion'
      and not (
        exists (select 1 from plm.legacy_erp_item_identity l where l.external_id = i.item_number)
        and i.id = (
          select p.id
          from plm.item p
          left join plm.legacy_erp_item_identity lp on lp.external_id = p.item_number
          where p.source_system = 'coldlion'
            and upper(trim(p.item_number)) = upper(trim(i.item_number))
            and p.item_number = i.item_number
          order by (case when lp.division_code is not null and lp.division_code = p.raw ->> 'divisionCode' then 0 else 1 end), p.source_id, p.id
          limit 1
        )
      )
  )
  union all
  (
    select r1.description, r1.item_number
    from plm.legacy_erp_item_identity l2
    join lateral (
      select p2.id, p2.description, p2.item_number
      from plm.item p2
      where p2.source_system = 'coldlion'
        and upper(trim(p2.item_number)) = upper(trim(l2.external_id))
        and p2.item_number = l2.external_id
      order by (case when l2.division_code is not null and l2.division_code = p2.raw ->> 'divisionCode' then 0 else 1 end), p2.source_id, p2.id
      limit 1
    ) r1 on true
    where l2.id = b.erp_item_id
  )
  limit 1
) erp on true
left join public.style_groups sg on sg.id = b.style_group_id
left join core.customer bridge_customer on bridge_customer.id = b.company_id
left join core.customer selected_customer on selected_customer.id = r.customer_id
left join public.licensors public_lic on public_lic.id = b.public_licensor_id
left join core.licensor core_lic on core_lic.id = b.core_licensor_id
left join core.creative_designer creative on creative.id = b.creative_designer_id
left join core.factory factory on factory.id = b.factory_id
left join lateral (
  select jsonb_agg(
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
    where upper(trim(i."rfqItem_style_number")) = upper(trim(r.row_data ->> 'rfq_code'))
      and nullif(trim(r.row_data ->> 'rfq_code'), '') is not null
      and i."rfqItem_rfq_group" is not null
    group by g."RFQGroup_id", g."RFQGroup_name"
  ) per_group
) rfq on true;

do $verify$
begin
  -- Catalogue-only shape check. The data equivalence of this identity
  -- resolution against api.plm_item_list is validated outside the apply
  -- transaction: read-only full-view proof against production (0 differences
  -- across all rows, 2026-10-29, work issue #5037) and the preview apply
  -- rehearsal.
  if 2 <> (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'style_tracker_rows_with_bridge'
      and column_name in ('canonical_description', 'erp_style_number')
  ) then
    raise exception 'ASSERT: style_tracker_rows_with_bridge must keep canonical_description and erp_style_number';
  end if;
end
$verify$;
