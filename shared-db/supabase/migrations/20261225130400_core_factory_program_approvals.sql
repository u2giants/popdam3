-- Re-issue of 20261225130100 (PR #7071) with identical executable SQL; its batch was refused at preview and never applied.
-- Issue #7070. Approvals for every factory (vendor) from two licensors,
-- Disney (FAMA form) and NBCUniversal (LMS form), and two retailers,
-- Dollar General and Walmart.
-- Disney and NBCU forms keep full upload history; Indra OCR fills the approved
-- name, facility/LMS number and expiration date. Licensing and production may
-- manage approvals and enter values by hand. Reminders go to both teams 6 weeks
-- (42 days) before an approval expires. Additive only.

insert into app.role (slug, name, description)
values ('production', 'Production', 'Production team: factory approvals and production workflow access.')
on conflict (slug) do nothing;

create table core.factory_approval (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references core.factory(id) on delete cascade,
  program text not null check (program in ('disney','dollar_general','nbcu','walmart')),
  is_approved boolean not null default false,
  approved_name text,
  facility_number text,
  issued_on date,
  expires_on date,
  form_reference text,
  value_source text not null default 'manual' check (value_source in ('manual','ocr')),
  current_form_id uuid,
  updated_by uuid default app.current_profile_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_id, program),
  constraint factory_approval_number_only_for_forms
    check (facility_number is null or program in ('disney','nbcu')),
  constraint factory_approval_expiry_only_for_forms
    check (expires_on is null or program in ('disney','nbcu')),
  constraint factory_approval_issued_only_for_forms
    check (issued_on is null and form_reference is null or program in ('disney','nbcu'))
);
comment on table core.factory_approval is
  'One row per factory and approval program. Licensors: disney = FAMA (facility number as printed, e.g. FAC-046111), nbcu = LMS (manufacturer code as printed, e.g. L-12813). Retailers: dollar_general and walmart carry approved name only. Licensing and production manage it; OCR of the newest uploaded form overwrites name/number/expiry.';

create table core.factory_approval_form (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references core.factory(id) on delete cascade,
  program text not null check (program in ('disney','nbcu')),
  storage_bucket text not null default 'factory-approval-forms',
  storage_path text not null,
  file_name text,
  uploaded_by uuid default app.current_profile_id(),
  uploaded_at timestamptz not null default now(),
  ocr_status text not null default 'pending'
    check (ocr_status in ('pending','processing','done','failed')),
  ocr_engine text,
  ocr_claimed_at timestamptz,
  ocr_attempts integer not null default 0,
  ocr_text text,
  extracted_name text,
  extracted_number text,
  extracted_issued_on date,
  extracted_expires_on date,
  extracted_form_reference text,
  extracted_aliases text[],
  ocr_error text,
  ocr_processed_at timestamptz,
  unique (storage_bucket, storage_path)
);
comment on table core.factory_approval_form is
  'Every Disney FAMA and NBCU LMS form ever uploaded for a factory; never deleted by the app. Indra OCR results are kept per form; the newest processed form drives core.factory_approval.';
create index factory_approval_form_factory_idx on core.factory_approval_form (factory_id, program, uploaded_at desc);
create index factory_approval_form_pending_idx on core.factory_approval_form (uploaded_at)
  where ocr_status in ('pending','processing');

alter table core.factory_approval
  add constraint factory_approval_current_form_fk
  foreign key (current_form_id) references core.factory_approval_form(id) on delete set null;

create trigger set_updated_at before update on core.factory_approval
  for each row execute function app.set_updated_at();

create table core.factory_approval_reminder (
  factory_id uuid not null references core.factory(id) on delete cascade,
  program text not null,
  expires_on date not null,
  sent_at timestamptz not null default now(),
  primary key (factory_id, program, expires_on)
);
comment on table core.factory_approval_reminder is
  'One row per approval expiry already reminded, so each expiry date is reminded once.';

-- Access: licensing, production and administrators manage; shared roles read.
alter table core.factory_approval enable row level security;
alter table core.factory_approval_form enable row level security;
alter table core.factory_approval_reminder enable row level security;

create policy approval_manage on core.factory_approval for all to authenticated
  using (app.has_any_role(array['administrator','licensing','production']::app.app_role[]))
  with check (app.has_any_role(array['administrator','licensing','production']::app.app_role[]));
create policy approval_read on core.factory_approval for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','production','designer','viewer']::app.app_role[]));

create policy form_read on core.factory_approval_form for select to authenticated
  using (app.has_any_role(array['administrator','licensing','production']::app.app_role[]));
create policy form_upload on core.factory_approval_form for insert to authenticated
  with check (app.has_any_role(array['administrator','licensing','production']::app.app_role[])
              and ocr_status = 'pending');

grant select, insert, update on core.factory_approval to authenticated;
grant select on core.factory_approval_form to authenticated;
grant insert (factory_id, program, storage_path, file_name) on core.factory_approval_form to authenticated;
grant all on core.factory_approval, core.factory_approval_form, core.factory_approval_reminder to service_role;

-- Private bucket for the PDFs.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('factory-approval-forms', 'factory-approval-forms', false, array['application/pdf'])
on conflict (id) do nothing;

create policy factory_approval_forms_read on storage.objects for select to authenticated
  using (bucket_id = 'factory-approval-forms'
         and app.has_any_role(array['administrator','licensing','production']::app.app_role[]));
create policy factory_approval_forms_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'factory-approval-forms'
              and app.has_any_role(array['administrator','licensing','production']::app.app_role[]));

-- A newly uploaded form marks the factory approved for that program.
create function core.factory_approval_form_uploaded()
returns trigger language plpgsql security definer set search_path = pg_catalog, core, app as $$
begin
  insert into core.factory_approval (factory_id, program, is_approved, updated_by)
  values (new.factory_id, new.program, true, new.uploaded_by)
  on conflict (factory_id, program) do update set is_approved = true;
  return new;
end $$;
create trigger factory_approval_form_uploaded after insert on core.factory_approval_form
  for each row execute function core.factory_approval_form_uploaded();

-- Indra worker (service_role): claim pending forms.
create function core.claim_factory_approval_form_ocr(p_limit integer default 10)
returns setof core.factory_approval_form
language sql security definer set search_path = pg_catalog, core as $$
  update core.factory_approval_form f
     set ocr_status = 'processing', ocr_claimed_at = now(), ocr_attempts = f.ocr_attempts + 1
   where f.id in (
     select id from core.factory_approval_form
      where ocr_status = 'pending'
         or (ocr_status = 'processing' and ocr_claimed_at < now() - interval '30 minutes')
      order by uploaded_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning f.*;
$$;

-- Indra worker (service_role): record the result. The newest processed form
-- for a factory and program overwrites the approval's name, number and expiry.
create function core.record_factory_approval_form_ocr(
  p_form_id uuid, p_ocr_text text, p_name text, p_number text, p_expires_on date,
  p_error text default null, p_engine text default 'indra',
  p_issued_on date default null, p_form_reference text default null, p_aliases text[] default null)
returns void language plpgsql security definer set search_path = pg_catalog, core as $$
declare f core.factory_approval_form;
begin
  update core.factory_approval_form
     set ocr_status = case when p_error is null then 'done' else 'failed' end,
         ocr_engine = p_engine, ocr_text = p_ocr_text,
         extracted_name = nullif(btrim(p_name), ''),
         extracted_number = nullif(upper(btrim(p_number)), ''),
         extracted_issued_on = p_issued_on,
         -- FAMA prints no expiry: it lapses 1 year after issuance.
         extracted_expires_on = coalesce(p_expires_on,
           case when program = 'disney' and p_issued_on is not null
                then (p_issued_on + interval '1 year')::date end),
         extracted_form_reference = nullif(btrim(p_form_reference), ''),
         extracted_aliases = p_aliases,
         ocr_error = p_error, ocr_processed_at = now()
   where id = p_form_id
  returning * into f;
  if not found then raise exception 'factory approval form % not found', p_form_id; end if;
  if p_error is not null then return; end if;

  if not exists (select 1 from core.factory_approval_form n
                  where n.factory_id = f.factory_id and n.program = f.program
                    and n.ocr_status = 'done' and n.uploaded_at > f.uploaded_at) then
    update core.factory_approval a
       set is_approved = true,
           approved_name = coalesce(f.extracted_name, a.approved_name),
           facility_number = coalesce(f.extracted_number, a.facility_number),
           issued_on = coalesce(f.extracted_issued_on, a.issued_on),
           expires_on = coalesce(f.extracted_expires_on, a.expires_on),
           form_reference = coalesce(f.extracted_form_reference, a.form_reference),
           value_source = 'ocr', current_form_id = f.id, updated_by = null
     where a.factory_id = f.factory_id and a.program = f.program;
  end if;
end $$;

revoke all on function core.claim_factory_approval_form_ocr(integer) from public, anon, authenticated;
revoke all on function core.record_factory_approval_form_ocr(uuid, text, text, text, date, text, text, date, text, text[]) from public, anon, authenticated;
grant execute on function core.claim_factory_approval_form_ocr(integer) to service_role;
grant execute on function core.record_factory_approval_form_ocr(uuid, text, text, text, date, text, text, date, text, text[]) to service_role;

-- Approvals expiring within 6 weeks (or already expired).
create view core.factory_approval_renewal_due with (security_invoker = true) as
select a.factory_id, fa.name as factory_name, a.program,
       case a.program when 'disney' then 'FAMA' else 'LMS' end as form_name,
       a.approved_name, a.facility_number, a.expires_on,
       a.expires_on - current_date as days_left
  from core.factory_approval a
  join core.factory fa on fa.id = a.factory_id
 where a.is_approved and a.program in ('disney','nbcu')
   and a.expires_on is not null
   and a.expires_on <= current_date + 42;
grant select on core.factory_approval_renewal_due to authenticated, service_role;

-- Daily: notify every licensing and production user once per expiry date.
create function core.queue_factory_approval_reminders()
returns integer language plpgsql security definer set search_path = pg_catalog, core, app as $$
declare v_count integer := 0; v_rows integer; r record;
begin
  for r in
    select d.* from core.factory_approval_renewal_due d
     where not exists (select 1 from core.factory_approval_reminder s
                        where s.factory_id = d.factory_id and s.program = d.program
                          and s.expires_on = d.expires_on)
  loop
    insert into app.notification (profile_id, app, target_schema, target_table, target_id, title, body, payload)
    select distinct ur.profile_id, 'plm'::app.app_name, 'core', 'factory', r.factory_id,
           format('Updated %s form needed: %s', r.form_name, r.factory_name),
           format('The %s approval for %s expires %s. Please obtain and upload an updated %s form.',
                  case r.program when 'disney' then 'Disney' else 'NBCUniversal' end,
                  r.factory_name, to_char(r.expires_on, 'Mon DD, YYYY'), r.form_name),
           jsonb_build_object('kind','factory_approval_renewal','program',r.program,'expires_on',r.expires_on)
      from app.user_role ur join app.role ro on ro.id = ur.role_id
     where ro.slug in ('licensing','production') and ur.revoked_at is null;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
    insert into core.factory_approval_reminder (factory_id, program, expires_on)
    values (r.factory_id, r.program, r.expires_on);
  end loop;
  return v_count;
end $$;
revoke all on function core.queue_factory_approval_reminders() from public, anon, authenticated;
grant execute on function core.queue_factory_approval_reminders() to service_role;

select cron.schedule('factory-approval-renewal-reminders', '0 12 * * *',
                     'select core.queue_factory_approval_reminders()');

-- Every factory starts with all four programs answered "No".
insert into core.factory_approval (factory_id, program, is_approved, updated_by)
select f.id, p.program, false, null
  from core.factory f
 cross join (values ('disney'),('dollar_general'),('nbcu'),('walmart')) p(program)
on conflict do nothing;

create function core.factory_seed_approvals()
returns trigger language plpgsql security definer set search_path = pg_catalog, core as $$
begin
  insert into core.factory_approval (factory_id, program, updated_by)
  select new.id, p.program, null
    from (values ('disney'),('dollar_general'),('nbcu'),('walmart')) p(program)
  on conflict do nothing;
  return new;
end $$;
create trigger factory_seed_approvals after insert on core.factory
  for each row execute function core.factory_seed_approvals();
