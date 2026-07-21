-- Make PopDAM Master Data's "Originally Designed For" a durable customer FK.
--
-- This migration also establishes the DAM-owned customer serving contract. The
-- browser reads api.dam_customer_list; dam.customer_ext remains private to DAM
-- and is intentionally not added to PostgREST's exposed schemas.

create table dam.customer_ext (
  customer_id uuid primary key references core.customer(id) on delete cascade,
  status app.entity_status not null default 'active',
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dam.customer_ext is
  'DAM-owned 1:1 extension of core.customer. Missing row means DAM-enabled; app-specific settings never alter canonical customer identity.';

create trigger set_updated_at before update on dam.customer_ext
  for each row execute function app.set_updated_at();

alter table dam.customer_ext enable row level security;

create policy dam_read on dam.customer_ext
  for select to authenticated
  using (app.has_app_access('dam') or app.has_role('administrator'));

create policy dam_write on dam.customer_ext
  for all to authenticated
  using (app.has_role('administrator') or app.has_any_role(array['designer', 'licensing']::app.app_role[]))
  with check (app.has_role('administrator') or app.has_any_role(array['designer', 'licensing']::app.app_role[]));

grant select on dam.customer_ext to authenticated;
grant all on dam.customer_ext to service_role;

create or replace view api.dam_customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.display_name,
  c.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as dam_status,
  x.status_reason as dam_status_reason,
  x.status_changed_at as dam_status_changed_at,
  x.updated_at as dam_settings_updated_at,
  c.updated_at
from core.customer c
left join dam.customer_ext x on x.customer_id = c.id
where c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_customer_list is
  'DAM picker-safe Customer list. Stable id comes from core.customer; display_name/name are shared identity; DAM status/settings come only from dam.customer_ext. Excludes globally or DAM-inactive rows.';

grant select on api.dam_customer_list to authenticated;

alter table public.style_tracker_rows
  add column customer_id uuid references core.customer(id) on delete set null;

comment on column public.style_tracker_rows.customer_id is
  'Canonical Customer selected by Originally Designed For. Durable relationship; UI labels come from api.dam_customer_list and are never stored here.';

create index style_tracker_rows_customer_id_idx
  on public.style_tracker_rows (customer_id)
  where customer_id is not null;

-- Preserve verified/manual bridge work first.
update public.style_tracker_rows r
set customer_id = b.company_id
from plm.style_tracker_item_bridge b
where b.style_tracker_row_id = r.id
  and b.company_id is not null
  and r.customer_id is null;

-- Then backfill only exact, unambiguous legacy-name matches. Ambiguous/unmatched
-- text remains visible for manual selection; it is never guessed.
with candidates as (
  select
    r.id as row_id,
    (array_agg(c.id))[1] as customer_id
  from public.style_tracker_rows r
  join core.customer c
    on lower(regexp_replace(trim(r.customer), '\s+', ' ', 'g')) in (
      lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')),
      lower(regexp_replace(trim(coalesce(c.display_name, c.name)), '\s+', ' ', 'g'))
    )
  where r.customer_id is null
    and nullif(trim(r.customer), '') is not null
  group by r.id
  having count(distinct c.id) = 1
)
update public.style_tracker_rows r
set customer_id = candidates.customer_id
from candidates
where r.id = candidates.row_id;

-- Keep the established view output stable and append customer_id. The canonical
-- customer label now prefers the explicit style-row FK over the legacy bridge.
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
  r.customer_id
from public.style_tracker_rows r
left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
left join api.plm_item_list erp on erp.id = b.erp_item_id
left join public.style_groups sg on sg.id = b.style_group_id
left join core.customer bridge_customer on bridge_customer.id = b.company_id
left join core.customer selected_customer on selected_customer.id = r.customer_id
left join public.licensors public_lic on public_lic.id = b.public_licensor_id
left join core.licensor core_lic on core_lic.id = b.core_licensor_id
left join core.creative_designer creative on creative.id = b.creative_designer_id
left join core.factory factory on factory.id = b.factory_id;

-- Audit a Customer-ID selection even though the UI no longer writes a copied
-- customer name into row_data.E.
create or replace function public.log_style_tracker_row_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    insert into public.style_tracker_audit_log (
      event_type, style_tracker_row_id, source_sheet, source_row_number, metadata, changed_by
    ) values (
      'row_added', new.id, new.source_sheet, new.source_row_number,
      jsonb_build_object('tracker_type', new.tracker_type), auth.uid()
    );
    return new;
  end if;

  for v_key in
    select distinct key
    from (
      select jsonb_object_keys(coalesce(old.row_data, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.row_data, '{}'::jsonb)) as key
    ) keys
    where key ~ '^[A-Z]{1,2}$'
    order by key
  loop
    if (old.row_data -> v_key) is distinct from (new.row_data -> v_key) then
      insert into public.style_tracker_audit_log (
        event_type, style_tracker_row_id, source_sheet, source_row_number,
        column_letter, old_value, new_value, metadata, changed_by
      ) values (
        'cell_update', new.id, new.source_sheet, new.source_row_number,
        v_key, old.row_data -> v_key, new.row_data -> v_key,
        jsonb_build_object('tracker_type', new.tracker_type), auth.uid()
      );
    end if;
  end loop;

  if old.customer_id is distinct from new.customer_id then
    insert into public.style_tracker_audit_log (
      event_type, style_tracker_row_id, source_sheet, source_row_number,
      field_key, column_letter, old_value, new_value, metadata, changed_by
    ) values (
      'cell_update', new.id, new.source_sheet, new.source_row_number,
      'customer', 'E', to_jsonb(old.customer_id), to_jsonb(new.customer_id),
      jsonb_build_object('tracker_type', new.tracker_type, 'value_type', 'core.customer.id'), auth.uid()
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_style_tracker_row_audit on public.style_tracker_rows;
create trigger trg_style_tracker_row_audit
  after insert or update of row_data, customer_id on public.style_tracker_rows
  for each row execute function public.log_style_tracker_row_audit();

notify pgrst, 'reload schema';
