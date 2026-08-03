-- Keep Master Data's RFQ history lookup inside the authenticated 8-second
-- statement limit. The prior view pre-aggregated every legacy RFQ item before
-- applying the page's LIMIT, which made the browser's first 1,000-row request
-- time out in production. Use a small indexed lookup per displayed row instead.

create index if not exists idx_dflow_rfqitem_style_number_normalized
  on dflow."RFQItem" ((upper(trim("rfqItem_style_number"))))
  where "rfqItem_rfq_group" is not null
    and nullif(trim("rfqItem_style_number"), '') is not null;

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

grant select on public.style_tracker_rows_with_bridge to authenticated, service_role;
revoke all on table public.style_tracker_rows_with_bridge from anon;
revoke all on table public.style_tracker_rows_with_bridge from public;

do $$
declare
  v_groups jsonb;
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'dflow'
      and indexname = 'idx_dflow_rfqitem_style_number_normalized'
  ) then
    raise exception 'ASSERT: normalized RFQ item lookup index is missing';
  end if;

  if exists (
    select 1
    from public.style_tracker_rows_with_bridge
    where rfq_groups is null
  ) then
    raise exception 'ASSERT: rfq_groups must be [] instead of SQL NULL';
  end if;

  select rfq_groups into v_groups
  from public.style_tracker_rows_with_bridge
  where sku = 'MFZ88KMSC01'
    and row_data ->> 'rfq_code' = 'MFZ88-309'
  limit 1;

  if v_groups is not null
     and not (v_groups @> '[{"name":"Family Dollar July 2023"}]'::jsonb) then
    raise exception 'ASSERT: known RFQ history changed unexpectedly: %', v_groups;
  end if;
end
$$;
