-- Claim and work issue #5765 (u2giants/popcrm-web).
-- CRM-owned 1:1 extension of core.contact so POP CRM can mark a contact
-- defunct with a reason (quit / transferred / retired); undo deletes the row.
-- Mirrors 20260722003000_crm_customer_ext.sql. Additive only.
-- derived-from: none
create table crm.contact_ext (
  contact_id uuid primary key references core.contact(id) on delete cascade,
  defunct_reason text check (defunct_reason in ('quit','transferred','retired')),
  defunct_at timestamptz,
  defunct_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table crm.contact_ext is
  'CRM-owned 1:1 extension of core.contact. Missing row or null defunct_reason means the contact is current. defunct_reason marks a contact who quit, transferred or retired.';

create trigger set_updated_at before update on crm.contact_ext
for each row execute function app.set_updated_at();

alter table crm.contact_ext enable row level security;
create policy crm_read on crm.contact_ext for select to authenticated
  using (app.has_app_access('crm') or app.has_role('administrator'));
create policy crm_write on crm.contact_ext for all to authenticated
  using (app.has_app_access('crm') or app.has_role('administrator'))
  with check (app.has_app_access('crm') or app.has_role('administrator'));

grant select, insert, update, delete on crm.contact_ext to authenticated;
grant all on crm.contact_ext to service_role;
