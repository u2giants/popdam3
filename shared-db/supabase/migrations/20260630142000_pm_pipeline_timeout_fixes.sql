-- Fix PM pipeline timeouts under authenticated/RLS access.
--
-- The PM board reads thousands of rows at a time. Bare policy helper calls are
-- evaluated as row filters, so wrapping them in scalar subqueries lets Postgres
-- plan them as statement-level initplans.

create index if not exists pim_product_updated_at_desc_idx
  on pim.product (updated_at desc);

create index if not exists pim_product_clickup_parent_updated_idx
  on pim.product (clickup_parent_id, updated_at desc);

create index if not exists pim_product_licensor_updated_idx
  on pim.product (licensor_id, updated_at desc);

create index if not exists pim_product_stage_idx
  on pim.product (stage);

create index if not exists pim_checklist_item_product_id_idx
  on pim.checklist_item (product_id);

create index if not exists pim_product_file_product_id_created_idx
  on pim.product_file (product_id, created_at);

create index if not exists pim_product_field_product_id_idx
  on pim.product_field (product_id);

create index if not exists pim_product_assignee_product_id_idx
  on pim.product_assignee (product_id);

create index if not exists pim_product_link_from_product_id_idx
  on pim.product_link (from_product_id);

create index if not exists pim_product_link_to_product_id_idx
  on pim.product_link (to_product_id);

create index if not exists pim_product_time_entry_product_id_idx
  on pim.product_time_entry (product_id);

create index if not exists pim_product_update_product_id_created_idx
  on pim.product_update (product_id, created_at);

drop view if exists api.pm_product_board;

create view api.pm_product_board
with (security_invoker = true)
as
select
  p.id,
  p.code,
  p.name,
  p.status,
  p.stage,
  p.lifecycle_status,
  p.cover_url,
  p.project_id,
  pr.title as project_title,
  p.company_id,
  c.name as company_name,
  p.buyer_contact_id,
  coalesce(ct.full_name, concat_ws(' ', ct.first_name, ct.last_name)) as buyer_name,
  p.factory_id,
  f.name as factory_name,
  p.licensor_id,
  l.name as licensor_name,
  p.property_id,
  prop.name as property_name,
  p.product_type_id,
  pt.name as product_type_name,
  p.plm_item_id,
  i.item_number as plm_item_number,
  p.clickup_task_id,
  p.updated_at,
  p.clickup_parent_id,
  p.clickup_status,
  coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type') as clickup_status_type,
  p.metadata ->> 'clickup_status_color' as clickup_status_color,
  nullif(p.metadata ->> 'clickup_status_order', '')::numeric as clickup_status_order,
  p.metadata ->> 'clickup_space_id' as clickup_space_id,
  p.metadata ->> 'clickup_space_name' as clickup_space_name,
  p.metadata ->> 'clickup_folder_id' as clickup_folder_id,
  p.metadata ->> 'clickup_folder_name' as clickup_folder_name,
  p.metadata ->> 'clickup_list_id' as clickup_list_id,
  p.metadata ->> 'clickup_list_name' as clickup_list_name,
  p.metadata ->> 'clickup_creator_id' as clickup_creator_id,
  p.metadata ->> 'clickup_creator_name' as clickup_creator_name,
  nullif(p.metadata ->> 'clickup_time_estimate_ms', '')::bigint as clickup_time_estimate_ms,
  p.metadata ->> 'clickup_orderindex' as clickup_orderindex,
  coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department') as business_unit,
  p.metadata ->> 'department' as department,
  p.metadata ->> 'next_action' as next_action,
  p.metadata ->> 'next_owner_name' as next_owner_name,
  p.metadata ->> 'next_owner_role_name' as next_owner_role_name,
  p.metadata ->> 'waiting_on' as waiting_on,
  p.metadata ->> 'blocker_reason' as blocker_reason,
  p.metadata ->> 'risk_level' as risk_level,
  p.metadata ->> 'pps_requested_date' as pps_requested_date,
  p.metadata ->> 'on_shelf_date' as on_shelf_date,
  p.metadata ->> 'pi_status' as pi_status,
  p.metadata ->> 'brand_assurance_number' as brand_assurance_number,
  p.metadata ->> 'closure_reason' as closure_reason,
  p.metadata ->> 'description' as description,
  p.created_at
from pim.product p
left join pim.project pr on pr.id = p.project_id
left join core.customer c on c.id = p.company_id
left join core.contact ct on ct.id = p.buyer_contact_id
left join core.factory f on f.id = p.factory_id
left join core.licensor l on l.id = p.licensor_id
left join core.property prop on prop.id = p.property_id
left join core.product_type pt on pt.id = p.product_type_id
left join plm.item i on i.id = p.plm_item_id;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'pim.product'::regclass,
    'pim.project'::regclass,
    'pim.design'::regclass,
    'pim.design_collection'::regclass,
    'pim.design_asset'::regclass,
    'pim.stage'::regclass,
    'pim.stage_history'::regclass,
    'pim.product_submission'::regclass,
    'pim.product_sample'::regclass,
    'pim.revision_request'::regclass,
    'pim.customer_order'::regclass,
    'pim.checklist_item'::regclass,
    'pim.product_assignee'::regclass,
    'pim.product_file'::regclass,
    'pim.product_update'::regclass,
    'pim.product_tag'::regclass,
    'pim.product_field'::regclass,
    'pim.product_link'::regclass,
    'pim.product_time_entry'::regclass,
    'pim.saved_view'::regclass,
    'pim.view_pref'::regclass,
    'pim.product_style_group'::regclass
  ]
  loop
    execute format(
      'alter policy pm_read on %s using ((select app.has_app_access(''pm'') or app.has_role(''administrator'')))',
      t
    );
    execute format(
      'alter policy pm_write on %s using ((select app.has_role(''administrator'') or app.has_any_role(array[''licensing'', ''designer'', ''sales'']::app.app_role[]))) with check ((select app.has_role(''administrator'') or app.has_any_role(array[''licensing'', ''designer'', ''sales'']::app.app_role[])))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'app.comment'::regclass,
    'app.activity'::regclass,
    'app.file_object'::regclass
  ]
  loop
    if exists (select 1 from pg_policies where schemaname = split_part(t::text, '.', 1) and tablename = split_part(t::text, '.', 2) and policyname = 'shared_read') then
      execute format(
        'alter policy shared_read on %s using ((select app.has_any_role(array[''administrator'', ''sales'', ''licensing'', ''designer'', ''viewer'', ''vendor'']::app.app_role[])))',
        t
      );
    end if;
    if exists (select 1 from pg_policies where schemaname = split_part(t::text, '.', 1) and tablename = split_part(t::text, '.', 2) and policyname = 'admin_write') then
      execute format(
        'alter policy admin_write on %s using ((select app.has_role(''administrator''))) with check ((select app.has_role(''administrator'')))',
        t
      );
    end if;
  end loop;
end $$;

comment on view api.pm_product_board is 'RLS-safe PM board contract for the Poppim pipeline, including ClickUp parity metadata needed for filtering/grouping without reading product.metadata in the browser.';

grant select on api.pm_product_board to authenticated;
