-- Browser-facing API contracts, RLS scaffolding, grants, and realtime candidates.

create or replace view api.pm_product_board
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
  p.updated_at
from pim.product p
left join pim.project pr on pr.id = p.project_id
left join core.company c on c.id = p.company_id
left join core.contact ct on ct.id = p.buyer_contact_id
left join core.factory f on f.id = p.factory_id
left join core.licensor l on l.id = p.licensor_id
left join core.property prop on prop.id = p.property_id
left join core.product_type pt on pt.id = p.product_type_id
left join plm.item i on i.id = p.plm_item_id;

create or replace view api.pm_product_assets
with (security_invoker = true)
as
select
  p.id as product_id,
  p.code as product_code,
  p.name as product_name,
  d.id as design_id,
  d.title as design_title,
  a.id as asset_id,
  a.title as asset_title,
  a.filename,
  a.thumbnail_url,
  a.relative_path,
  sg.id as style_group_id,
  sg.sku as style_group_sku,
  sg.title as style_group_title,
  coalesce(da.confidence, psg.confidence) as link_confidence
from pim.product p
left join pim.design d on d.id = p.design_id
left join pim.design_asset da on da.design_id = d.id
left join dam.asset a on a.id = da.asset_id
left join pim.product_style_group psg on psg.product_id = p.id
left join dam.style_group sg on sg.id = psg.style_group_id;

create or replace view api.crm_account_overview
with (security_invoker = true)
as
select
  c.id as company_id,
  c.name as company_name,
  c.status as company_status,
  count(distinct cc.contact_id) as contact_count,
  count(distinct d.id) as department_count,
  count(distinct o.id) as opportunity_count,
  count(distinct pr.id) as project_count,
  count(distinct po.id) as production_order_count,
  max(o.updated_at) as latest_opportunity_at
from core.company c
left join core.contact_company cc on cc.company_id = c.id
left join crm.department d on d.company_id = c.id
left join crm.opportunity o on o.company_id = c.id
left join pim.project pr on pr.company_id = c.id
left join plm.production_order po on po.company_id = c.id
group by c.id, c.name, c.status;

create or replace view api.dam_asset_library
with (security_invoker = true)
as
select
  a.id,
  a.title,
  a.filename,
  a.relative_path,
  a.thumbnail_url,
  a.file_type,
  a.asset_type,
  a.workflow_status,
  a.sku,
  sg.id as style_group_id,
  sg.title as style_group_title,
  sg.sku as style_group_sku,
  c.name as company_name,
  l.name as licensor_name,
  prop.name as property_name,
  pst.name as product_subtype_name,
  a.updated_at
from dam.asset a
left join dam.style_group sg on sg.id = a.style_group_id
left join core.company c on c.id = a.company_id
left join core.licensor l on l.id = a.licensor_id
left join core.property prop on prop.id = a.property_id
left join core.product_subtype pst on pst.id = a.product_subtype_id;

create or replace view api.plm_item_status
with (security_invoker = true)
as
select
  i.id as item_id,
  i.item_number,
  i.style_number,
  i.name,
  i.status as item_status,
  c.name as company_name,
  l.name as licensor_name,
  prop.name as property_name,
  po.production_order_number,
  pol.id as production_order_line_id,
  pol.status as production_status,
  pol.quantity_ordered,
  pol.quantity_shipped,
  ls.status as licensing_status,
  ls.milestone as licensing_milestone,
  greatest(i.updated_at, coalesce(po.updated_at, i.updated_at), coalesce(ls.updated_at, i.updated_at)) as updated_at
from plm.item i
left join core.company c on c.id = i.company_id
left join core.licensor l on l.id = i.licensor_id
left join core.property prop on prop.id = i.property_id
left join plm.production_order_line pol on pol.item_id = i.id
left join plm.production_order po on po.id = pol.production_order_id
left join plm.licensing_status ls on ls.item_id = i.id;

create or replace view api.global_search
with (security_invoker = true)
as
select 'company'::text as entity_type, id, name as title, domain as subtitle, 'core.company'::text as source_table, updated_at
from core.company
union all
select 'contact', id, coalesce(full_name, concat_ws(' ', first_name, last_name), email::text), email::text, 'core.contact', updated_at
from core.contact
union all
select 'product', id, name, code, 'pim.product', updated_at
from pim.product
union all
select 'project', id, title, status, 'pim.project', updated_at
from pim.project
union all
select 'opportunity', id, name, stage, 'crm.opportunity', updated_at
from crm.opportunity
union all
select 'asset', id, coalesce(title, filename), sku, 'dam.asset', updated_at
from dam.asset
union all
select 'plm_item', id, coalesce(name, item_number), style_number, 'plm.item', updated_at
from plm.item;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'app.profile'::regclass,
    'app.user_role'::regclass,
    'app.app_access'::regclass,
    'app.file_object'::regclass,
    'app.comment'::regclass,
    'app.activity'::regclass,
    'app.notification'::regclass,
    'core.company'::regclass,
    'core.company_source_ref'::regclass,
    'core.contact'::regclass,
    'core.contact_source_ref'::regclass,
    'core.contact_company'::regclass,
    'core.licensor'::regclass,
    'core.property'::regclass,
    'core.character'::regclass,
    'core.taxonomy_source_ref'::regclass,
    'core.product_category'::regclass,
    'core.product_type'::regclass,
    'core.product_subtype'::regclass,
    'core.merch_group'::regclass,
    'core.factory'::regclass,
    'core.factory_source_ref'::regclass,
    'core.vendor_contact'::regclass,
    'core.sku_ref'::regclass,
    'dam.style_group'::regclass,
    'dam.asset'::regclass,
    'dam.asset_character'::regclass,
    'dam.asset_tag'::regclass,
    'dam.asset_path_history'::regclass,
    'dam.asset_checkout'::regclass,
    'dam.agent_registration'::regclass,
    'dam.helper_device'::regclass,
    'dam.processing_queue'::regclass,
    'dam.style_guide_file'::regclass,
    'dam.sku_style_guide_source'::regclass,
    'dam.erp_item_snapshot'::regclass,
    'dam.production_order_snapshot'::regclass,
    'pim.design_collection'::regclass,
    'pim.project'::regclass,
    'pim.design'::regclass,
    'pim.product'::regclass,
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
    'pim.design_asset'::regclass,
    'pim.product_style_group'::regclass,
    'crm.department'::regclass,
    'crm.opportunity'::regclass,
    'crm.opportunity_product'::regclass,
    'crm.email_message'::regclass,
    'crm.meeting_note'::regclass,
    'crm.note'::regclass,
    'crm.task'::regclass,
    'crm.ignore_rule'::regclass,
    'crm.ai_model_config'::regclass,
    'crm.licensor_approval_thread'::regclass,
    'plm.item'::regclass,
    'plm.item_detail'::regclass,
    'plm.item_attachment'::regclass,
    'plm.art_piece'::regclass,
    'plm.production_order'::regclass,
    'plm.production_order_line'::regclass,
    'plm.licensing_status'::regclass,
    'plm.licensing_feedback'::regclass,
    'plm.rfq_group'::regclass,
    'plm.rfq_item'::regclass,
    'plm.rfq_vendor'::regclass,
    'plm.reference_value'::regclass,
    'ingest.sync_run'::regclass,
    'ingest.raw_record'::regclass,
    'ingest.dedupe_candidate'::regclass
  ]
  loop
    execute format('alter table %s enable row level security', t);
  end loop;
end $$;

create policy profile_select_self_or_admin on app.profile
  for select to authenticated
  using (id = app.current_profile_id() or app.has_role('administrator'));

create policy profile_admin_write on app.profile
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

create policy notification_select_own on app.notification
  for select to authenticated
  using (profile_id = app.current_profile_id() or app.has_role('administrator'));

create policy notification_update_own_read_state on app.notification
  for update to authenticated
  using (profile_id = app.current_profile_id() or app.has_role('administrator'))
  with check (profile_id = app.current_profile_id() or app.has_role('administrator'));

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'app.file_object'::regclass,
    'app.comment'::regclass,
    'app.activity'::regclass,
    'core.company'::regclass,
    'core.contact'::regclass,
    'core.contact_company'::regclass,
    'core.licensor'::regclass,
    'core.property'::regclass,
    'core.character'::regclass,
    'core.product_category'::regclass,
    'core.product_type'::regclass,
    'core.product_subtype'::regclass,
    'core.merch_group'::regclass,
    'core.factory'::regclass,
    'core.vendor_contact'::regclass,
    'core.sku_ref'::regclass
  ]
  loop
    execute format(
      'create policy shared_read on %s for select to authenticated using (app.has_any_role(array[''administrator'', ''sales'', ''licensing'', ''designer'', ''viewer'', ''vendor'']::app.app_role[]))',
      t
    );
    execute format(
      'create policy admin_write on %s for all to authenticated using (app.has_role(''administrator'')) with check (app.has_role(''administrator''))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'pim.design_collection'::regclass,
    'pim.project'::regclass,
    'pim.design'::regclass,
    'pim.product'::regclass,
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
    'pim.design_asset'::regclass,
    'pim.product_style_group'::regclass
  ]
  loop
    execute format(
      'create policy pm_read on %s for select to authenticated using (app.has_app_access(''pm'') or app.has_role(''administrator''))',
      t
    );
    execute format(
      'create policy pm_write on %s for all to authenticated using (app.has_role(''administrator'') or app.has_any_role(array[''licensing'', ''designer'', ''sales'']::app.app_role[])) with check (app.has_role(''administrator'') or app.has_any_role(array[''licensing'', ''designer'', ''sales'']::app.app_role[]))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'crm.department'::regclass,
    'crm.opportunity'::regclass,
    'crm.opportunity_product'::regclass,
    'crm.email_message'::regclass,
    'crm.meeting_note'::regclass,
    'crm.note'::regclass,
    'crm.task'::regclass,
    'crm.ignore_rule'::regclass,
    'crm.ai_model_config'::regclass,
    'crm.licensor_approval_thread'::regclass
  ]
  loop
    execute format(
      'create policy crm_read on %s for select to authenticated using (app.has_app_access(''crm'') or app.has_role(''administrator''))',
      t
    );
    execute format(
      'create policy crm_write on %s for all to authenticated using (app.has_role(''administrator'') or app.has_any_role(array[''sales'', ''licensing'']::app.app_role[])) with check (app.has_role(''administrator'') or app.has_any_role(array[''sales'', ''licensing'']::app.app_role[]))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'dam.style_group'::regclass,
    'dam.asset'::regclass,
    'dam.asset_character'::regclass,
    'dam.asset_tag'::regclass,
    'dam.asset_path_history'::regclass,
    'dam.style_guide_file'::regclass,
    'dam.sku_style_guide_source'::regclass
  ]
  loop
    execute format(
      'create policy dam_read on %s for select to authenticated using (app.has_app_access(''dam'') or app.has_role(''administrator''))',
      t
    );
    execute format(
      'create policy dam_write on %s for all to authenticated using (app.has_role(''administrator'') or app.has_any_role(array[''designer'', ''licensing'']::app.app_role[])) with check (app.has_role(''administrator'') or app.has_any_role(array[''designer'', ''licensing'']::app.app_role[]))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'dam.asset_checkout'::regclass,
    'dam.agent_registration'::regclass,
    'dam.helper_device'::regclass,
    'dam.processing_queue'::regclass,
    'dam.erp_item_snapshot'::regclass,
    'dam.production_order_snapshot'::regclass,
    'app.user_role'::regclass,
    'app.app_access'::regclass,
    'core.company_source_ref'::regclass,
    'core.contact_source_ref'::regclass,
    'core.taxonomy_source_ref'::regclass,
    'core.factory_source_ref'::regclass,
    'ingest.sync_run'::regclass,
    'ingest.raw_record'::regclass,
    'ingest.dedupe_candidate'::regclass
  ]
  loop
    execute format(
      'create policy admin_only on %s for all to authenticated using (app.has_role(''administrator'')) with check (app.has_role(''administrator''))',
      t
    );
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'plm.item'::regclass,
    'plm.item_detail'::regclass,
    'plm.item_attachment'::regclass,
    'plm.art_piece'::regclass,
    'plm.production_order'::regclass,
    'plm.production_order_line'::regclass,
    'plm.licensing_status'::regclass,
    'plm.licensing_feedback'::regclass,
    'plm.rfq_group'::regclass,
    'plm.rfq_item'::regclass,
    'plm.rfq_vendor'::regclass,
    'plm.reference_value'::regclass
  ]
  loop
    execute format(
      'create policy plm_read on %s for select to authenticated using (app.has_app_access(''plm'') or app.has_role(''administrator'') or app.has_any_role(array[''sales'', ''licensing'']::app.app_role[]))',
      t
    );
    execute format(
      'create policy plm_admin_write on %s for all to authenticated using (app.has_role(''administrator'')) with check (app.has_role(''administrator''))',
      t
    );
  end loop;
end $$;

grant usage on schema app, core, dam, pim, crm, plm, api to authenticated;
grant select on all tables in schema api to authenticated;
grant select on all tables in schema core to authenticated;
grant select on all tables in schema dam to authenticated;
grant select on all tables in schema pim to authenticated;
grant select on all tables in schema crm to authenticated;
grant select on all tables in schema plm to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'app.comment',
      'app.notification',
      'app.activity',
      'pim.product',
      'pim.stage_history',
      'pim.product_submission',
      'pim.product_sample',
      'pim.revision_request',
      'pim.customer_order',
      'pim.product_assignee',
      'crm.opportunity',
      'crm.task',
      'crm.note',
      'crm.email_message',
      'dam.asset',
      'dam.style_group'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = split_part(table_name, '.', 1)
          and tablename = split_part(table_name, '.', 2)
      ) then
        execute format('alter publication supabase_realtime add table %s', table_name);
      end if;
    end loop;
  end if;
end $$;

comment on view api.pm_product_board is 'RLS-safe PM board contract joining product workflow with shared core and PLM item context.';
comment on view api.crm_account_overview is 'CRM account summary across company, contacts, departments, opportunities, PM projects, and PLM orders.';
comment on view api.dam_asset_library is 'DAM browser asset library metadata with shared taxonomy names.';
comment on view api.global_search is 'First-pass shared search surface across core, PM, CRM, DAM, and PLM.';
