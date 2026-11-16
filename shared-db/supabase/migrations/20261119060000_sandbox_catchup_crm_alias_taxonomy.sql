-- Sandbox catch-up batch 13 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Copies production's existing structure for core.character_alias, core.taxonomy_source_ref (new columns and
-- rules), crm.contact_ext, crm.customer_ext archive columns, crm department/ingested-domain links, the CRM api
-- functions, and the contact/customer/relationship triggers, with production's exact grants.
-- Sandbox pre-check 2026-11-16: no orphan crm.department profiles or crm.ingested_domain customers; taxonomy
-- rules are NOT VALID as in production. Sandbox adaptation: production's dflow_prod.art_piece is the sandbox's
-- dflow.art_piece.
-- derived-from: none

set check_function_bodies = off;

alter table core.taxonomy_source_ref add column if not exists first_seen_at timestamp with time zone default now();
alter table core.taxonomy_source_ref add column if not exists last_seen_at timestamp with time zone default now();
alter table core.taxonomy_source_ref add column if not exists missing_since timestamp with time zone;
alter table core.taxonomy_source_ref add column if not exists source_licensor_id uuid;
alter table crm.customer_ext add column if not exists archived_at timestamp with time zone;
alter table crm.customer_ext add column if not exists archived_by uuid;

create table core.character_alias (
  alias text not null,
  character_id uuid not null,
  created_at timestamp with time zone default now() not null,
  created_by text,
  evidence_notes text,
  id uuid default gen_random_uuid() not null,
  licensor_id uuid not null,
  normalized_alias text generated always as (core.normalize_popsg_property_observation(alias)) stored,
  source_id text,
  source_system text not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text
);

-- grants as production
revoke all on table core.character_alias from public, anon, authenticated, service_role;
grant all on table core.character_alias to service_role;
grant select on table core.character_alias to authenticated;
alter table core.character_alias enable row level security;

comment on table core.character_alias is 'Observed character names resolving to a canonical core.character, with the source that said so (issue #2355, successor to #1090). Uniqueness is scoped to the licensor, and a guard trigger makes a cross-licensor alias unrepresentable. Normalization reuses core.normalize_popsg_property_observation (contract popsg-property-observation-v1) rather than adding a second normalizer. Browser roles are read-only. No rows are seeded by the creating migration: #2355 authorizes structure only.';

create table crm.contact_ext (
  archived_at timestamp with time zone,
  archived_by uuid,
  contact_id uuid not null,
  created_at timestamp with time zone default now() not null,
  defunct_at timestamp with time zone,
  defunct_by uuid,
  defunct_reason text,
  updated_at timestamp with time zone default now() not null
);

-- grants as production
revoke all on table crm.contact_ext from public, anon, authenticated, service_role;
grant all on table crm.contact_ext to service_role;
grant select, insert, update, delete on table crm.contact_ext to authenticated;
alter table crm.contact_ext enable row level security;

comment on table crm.contact_ext is 'CRM-owned 1:1 extension of core.contact. Missing row or null defunct_reason means the contact is current. defunct_reason marks a contact who quit, transferred or retired.';

alter table core.character_alias add constraint character_alias_alias_not_blank CHECK ((length(btrim(alias)) > 0));

alter table core.character_alias add constraint character_alias_normalized_not_blank CHECK ((length(core.normalize_popsg_property_observation(alias)) > 0));

alter table core.character_alias add constraint character_alias_pkey PRIMARY KEY (id);

alter table core.character_alias add constraint character_alias_source_id_not_blank CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));

alter table core.character_alias add constraint character_alias_source_system_not_blank CHECK ((length(btrim(source_system)) > 0));

alter table core.taxonomy_source_ref add constraint taxonomy_source_ref_first_seen_present CHECK ((first_seen_at IS NOT NULL)) NOT VALID;

alter table core.taxonomy_source_ref add constraint taxonomy_source_ref_last_seen_present CHECK ((last_seen_at IS NOT NULL)) NOT VALID;

alter table core.taxonomy_source_ref add constraint taxonomy_source_ref_missing_after_first_seen CHECK (((missing_since IS NULL) OR (first_seen_at IS NULL) OR (missing_since >= first_seen_at))) NOT VALID;

alter table core.taxonomy_source_ref add constraint taxonomy_source_ref_seen_order CHECK (((first_seen_at IS NULL) OR (last_seen_at IS NULL) OR (last_seen_at >= first_seen_at))) NOT VALID;

alter table crm.contact_ext add constraint contact_ext_defunct_reason_check CHECK ((defunct_reason = ANY (ARRAY['quit'::text, 'transferred'::text, 'retired'::text])));

alter table crm.contact_ext add constraint contact_ext_pkey PRIMARY KEY (contact_id);

alter table crm.contact_ext add constraint crm_contact_ext_defunct_fields_check CHECK (((defunct_reason IS NULL) OR ((defunct_at IS NOT NULL) AND (defunct_by IS NOT NULL))));

alter table core.character_alias add constraint character_alias_character_id_fkey FOREIGN KEY (character_id) REFERENCES core."character"(id) ON DELETE RESTRICT;

alter table core.character_alias add constraint character_alias_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

alter table core.character_alias add constraint character_alias_parent_matches_character FOREIGN KEY (character_id, licensor_id) REFERENCES core."character"(id, licensor_id) ON UPDATE CASCADE ON DELETE RESTRICT;

alter table core.taxonomy_source_ref add constraint taxonomy_source_ref_source_licensor_id_fkey FOREIGN KEY (source_licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

alter table crm.contact_ext add constraint contact_ext_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES core.contact(id) ON DELETE CASCADE;

alter table crm.department add constraint department_salesperson_profile_id_fkey FOREIGN KEY (salesperson_profile_id) REFERENCES app.profile(id) ON DELETE SET NULL;

alter table crm.department add constraint department_secondary_salesperson_profile_id_fkey FOREIGN KEY (secondary_salesperson_profile_id) REFERENCES app.profile(id) ON DELETE SET NULL;

alter table crm.ingested_domain add constraint ingested_domain_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES core.customer(id) ON DELETE SET NULL;

alter table plm.art_piece_attachment add constraint art_piece_attachment_art_piece_id_fkey FOREIGN KEY (art_piece_id) REFERENCES dflow.art_piece(id) NOT VALID;

create index if not exists character_alias_character_idx ON core.character_alias USING btree (character_id);

create index if not exists character_alias_licensor_idx ON core.character_alias USING btree (licensor_id);

create unique index if not exists character_alias_licensor_norm_key ON core.character_alias USING btree (licensor_id, normalized_alias);

create unique index if not exists character_alias_licensor_source_key ON core.character_alias USING btree (licensor_id, source_system, source_id) WHERE (source_id IS NOT NULL);

create index if not exists taxonomy_source_ref_current_idx ON core.taxonomy_source_ref USING btree (source_system, source_table) WHERE (missing_since IS NULL);

create index if not exists taxonomy_source_ref_entity_idx ON core.taxonomy_source_ref USING btree (entity_schema, entity_table, entity_id);

create index if not exists taxonomy_source_ref_source_licensor_idx ON core.taxonomy_source_ref USING btree (source_licensor_id);

create index if not exists crm_department_salesperson_profile_idx ON crm.department USING btree (salesperson_profile_id);

create index if not exists crm_department_secondary_salesperson_profile_idx ON crm.department USING btree (secondary_salesperson_profile_id);

create index if not exists crm_ingested_domain_customer_id_idx ON crm.ingested_domain USING btree (customer_id) WHERE (customer_id IS NOT NULL);

CREATE OR REPLACE FUNCTION api.crm_admin_access_history(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  with ev as (
    select ur.granted_at as at, 'role'::text as kind, 'granted'::text as action,
           r.slug::text as value, ur.profile_id, ur.granted_by_profile_id as actor_id
    from app.user_role ur join app.role r on r.id = ur.role_id
    union all
    select ur.revoked_at, 'role', 'revoked', r.slug::text, ur.profile_id, null::uuid
    from app.user_role ur join app.role r on r.id = ur.role_id
    where ur.revoked_at is not null
    union all
    select aa.granted_at, 'app', 'granted', aa.app::text, aa.profile_id, aa.granted_by_profile_id
    from app.app_access aa
    union all
    select aa.revoked_at, 'app', 'revoked', aa.app::text, aa.profile_id, null::uuid
    from app.app_access aa
    where aa.revoked_at is not null
  ), top as (
    select * from ev order by at desc nulls last, profile_id, kind, value, action limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', t.at,
           'kind', t.kind,
           'action', t.action,
           'value', t.value,
           'profile_id', t.profile_id,
           'profile_name', coalesce(p.display_name, p.email::text),
           'actor_name', coalesce(a.display_name, a.email::text)
         ) order by t.at desc nulls last, t.profile_id, t.kind, t.value, t.action), '[]'::jsonb)
  into result
  from top t
  left join app.profile p on p.id = t.profile_id
  left join app.profile a on a.id = t.actor_id;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_admin_assign_departments(p_department_ids uuid[], p_profile_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_count integer;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_profile_id is not null and not exists (
    select 1
    from app.profile p
    join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
    join app.role r on r.id = ur.role_id and r.slug = 'sales'
    where p.id = p_profile_id and p.status = 'active'
  ) then
    raise exception 'crm: salesperson must be an active user with the sales role'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_department_ids is null or cardinality(p_department_ids) = 0 then
    return 0;
  end if;

  update crm.department d
     set salesperson_profile_id = p_profile_id,
         updated_at = now()
   where d.id = any(p_department_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_admin_department_assignments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  result jsonb;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'name', d.name,
           'division', d.division,
           'category', d.category,
           'status', d.status,
           'is_active', d.is_active,
           'customer_id', c.id,
           'customer_name', c.name,
           'customer_display_name', c.display_name,
           'customer_status', c.status::text,
           'salesperson_profile_id', d.salesperson_profile_id,
           'secondary_salesperson_profile_id', d.secondary_salesperson_profile_id
         ) order by lower(c.name), c.id, d.sort_order nulls last, lower(d.name), d.id), '[]'::jsonb)
  into result
  from crm.department d
  join core.customer c on c.id = d.company_id;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_archive_contact(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_role('sales'))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from core.contact ct where ct.id = p_contact_id) then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;

  insert into crm.contact_ext (contact_id, archived_at, archived_by)
  values (p_contact_id, now(), auth.uid())
  on conflict (contact_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_archive_customer(p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  v_open_programs integer;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from core.customer c where c.id = p_customer_id) then
    raise exception 'crm: customer % not found', p_customer_id using errcode = 'no_data_found';
  end if;

  select count(*) into v_open_programs
  from crm.opportunity o
  where o.company_id = p_customer_id
    and coalesce(o.status, '') <> 'archived';
  if v_open_programs > 0 then
    raise exception 'crm: customer still has % active program(s); archive them first', v_open_programs
      using errcode = 'check_violation';
  end if;

  insert into crm.customer_ext (customer_id, archived_at, archived_by)
  values (p_customer_id, now(), auth.uid())
  on conflict (customer_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_archive_opportunity(p_opportunity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from crm.opportunity o where o.id = p_opportunity_id) then
    raise exception 'crm: program % not found', p_opportunity_id using errcode = 'no_data_found';
  end if;

  update crm.opportunity set status = 'archived', updated_at = now()
  where id = p_opportunity_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_create_contact(p_full_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_crm_department_id uuid DEFAULT NULL::uuid, p_scope text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_scope text := upper(coalesce(btrim(coalesce(p_scope, '')), ''));
  v_scope_db text;
  v_contact_id uuid;
  v_dup text;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: contact name required' using errcode = 'check_violation';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'crm: valid contact email required' using errcode = 'check_violation';
  end if;
  if v_scope not in ('', 'COMPANY_WIDE', 'DEPARTMENT', 'IGNORED') then
    raise exception 'crm: contact scope must be COMPANY_WIDE or DEPARTMENT'
      using errcode = 'check_violation';
  end if;
  v_scope_db := nullif(v_scope, '');

  if p_company_id is not null
     and not exists (select 1 from core.customer c where c.id = p_company_id) then
    raise exception 'crm: customer % not found', p_company_id using errcode = 'no_data_found';
  end if;
  if p_crm_department_id is not null
     and not exists (select 1 from crm.department d where d.id = p_crm_department_id) then
    raise exception 'crm: department % not found', p_crm_department_id using errcode = 'no_data_found';
  end if;

  if v_email is not null then
    select coalesce(ct.full_name, nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.email::text)
      into v_dup
      from core.contact ct
      where ct.email = v_email
      limit 1;
    if found then
      raise exception 'crm: a contact with email % already exists (%)', v_email, v_dup
        using errcode = 'unique_violation';
    end if;
  end if;

  insert into core.contact (full_name, email, phone, title, status)
  values (v_name, v_email::extensions.citext, v_phone, v_title, 'active')
  returning id into v_contact_id;

  if p_company_id is not null then
    insert into core.contact_company
      (contact_id, company_id, relationship_type, title, scope, crm_department_id)
    values (v_contact_id, p_company_id, 'buyer', v_title, v_scope_db, p_crm_department_id);
  end if;

  return v_contact_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_create_opportunity(p_name text, p_company_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_estimated_value numeric DEFAULT NULL::numeric, p_close_date date DEFAULT NULL::date)
 RETURNS crm.opportunity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  result crm.opportunity;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: program name required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from core.customer c where c.id = p_company_id) then
    raise exception 'crm: customer % not found', p_company_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from crm.customer_ext xe
             where xe.customer_id = p_company_id and xe.archived_at is not null) then
    raise exception 'crm: customer is archived; restore it before adding a program'
      using errcode = 'check_violation';
  end if;
  if p_contact_id is not null
     and not exists (select 1 from core.contact ct where ct.id = p_contact_id) then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;
  if p_department_id is not null
     and not exists (select 1 from crm.department d where d.id = p_department_id) then
    raise exception 'crm: department % not found', p_department_id using errcode = 'no_data_found';
  end if;
  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'crm: program amount cannot be negative' using errcode = 'check_violation';
  end if;

  insert into crm.opportunity
    (name, company_id, contact_id, department_id, stage, estimated_value, close_date,
     external_source, external_id)
  values (v_name, p_company_id, p_contact_id, p_department_id, p_stage, p_estimated_value, p_close_date,
          'crm', 'crm-' || gen_random_uuid()::text)
  returning * into result;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION api.crm_merge_contacts(p_keep_id uuid, p_drop_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  v_drop core.contact;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_role('sales'))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_keep_id = p_drop_id then
    raise exception 'crm: cannot merge a contact into itself' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from core.contact ct where ct.id = p_keep_id) then
    raise exception 'crm: contact % not found', p_keep_id using errcode = 'no_data_found';
  end if;
  select * into v_drop from core.contact ct where ct.id = p_drop_id;
  if not found then
    raise exception 'crm: contact % not found', p_drop_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from crm.contact_ext xe
             where xe.contact_id in (p_keep_id, p_drop_id)
               and xe.archived_at is not null) then
    raise exception 'crm: cannot merge archived contacts; restore them first'
      using errcode = 'check_violation';
  end if;

  -- Fill blank fields on the kept contact from the dropped one.
  update core.contact ct set
    first_name = coalesce(ct.first_name, v_drop.first_name),
    last_name = coalesce(ct.last_name, v_drop.last_name),
    full_name = coalesce(ct.full_name, v_drop.full_name),
    email = coalesce(ct.email, v_drop.email),
    phone = coalesce(ct.phone, v_drop.phone),
    title = coalesce(ct.title, v_drop.title)
  where ct.id = p_keep_id;

  -- core.contact_company: drop rows the kept contact already has, move the rest.
  delete from core.contact_company cc
   where cc.contact_id = p_drop_id
     and exists (select 1 from core.contact_company k
                 where k.contact_id = p_keep_id
                   and k.company_id = cc.company_id
                   and k.relationship_type = cc.relationship_type);
  update core.contact_company set contact_id = p_keep_id where contact_id = p_drop_id;

  update core.contact_source_ref set contact_id = p_keep_id where contact_id = p_drop_id;

  -- core.vendor_contact: unique (factory_id, contact_id, role) — drop collisions.
  delete from core.vendor_contact vc
   where vc.contact_id = p_drop_id
     and exists (select 1 from core.vendor_contact k
                 where k.factory_id = vc.factory_id
                   and k.contact_id = p_keep_id
                   and k.role is not distinct from vc.role);
  update core.vendor_contact set contact_id = p_keep_id where contact_id = p_drop_id;

  update crm.department set primary_contact_id = p_keep_id where primary_contact_id = p_drop_id;
  update crm.email_message set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.meeting_note set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.note set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.opportunity set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.task set contact_id = p_keep_id where contact_id = p_drop_id;
  update pim.product set buyer_contact_id = p_keep_id where buyer_contact_id = p_drop_id;
  update pim.project set primary_contact_id = p_keep_id where primary_contact_id = p_drop_id;

  -- Hide the dropped contact from CRM lists; undo = clear archived_at.
  insert into crm.contact_ext (contact_id, archived_at, archived_by)
  values (p_drop_id, now(), auth.uid())
  on conflict (contact_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;

  return p_keep_id;
end;
$function$
;

revoke all on function api.crm_admin_access_history(integer) from public, anon, service_role;
grant execute on function api.crm_admin_access_history(integer) to authenticated;

revoke all on function api.crm_admin_assign_departments(uuid[], uuid) from public, anon, service_role;
grant execute on function api.crm_admin_assign_departments(uuid[], uuid) to authenticated;

revoke all on function api.crm_admin_department_assignments() from public, anon, service_role;
grant execute on function api.crm_admin_department_assignments() to authenticated;

revoke all on function api.crm_archive_contact(uuid) from public, anon, service_role;
grant execute on function api.crm_archive_contact(uuid) to authenticated;

revoke all on function api.crm_archive_customer(uuid) from public, anon, service_role;
grant execute on function api.crm_archive_customer(uuid) to authenticated;

revoke all on function api.crm_archive_opportunity(uuid) from public, anon, service_role;
grant execute on function api.crm_archive_opportunity(uuid) to authenticated;

revoke all on function api.crm_create_contact(text, text, text, text, uuid, uuid, text) from public, anon, service_role;
grant execute on function api.crm_create_contact(text, text, text, text, uuid, uuid, text) to authenticated;

revoke all on function api.crm_create_opportunity(text, uuid, uuid, uuid, text, numeric, date) from public, anon, service_role;
grant execute on function api.crm_create_opportunity(text, uuid, uuid, uuid, text, numeric, date) to authenticated;

revoke all on function api.crm_merge_contacts(uuid, uuid) from public, anon, service_role;
grant execute on function api.crm_merge_contacts(uuid, uuid) to authenticated;

create policy shared_read on core.character_alias as PERMISSIVE for SELECT to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));

create policy crm_read on crm.contact_ext as PERMISSIVE for SELECT to authenticated using ((app.has_app_access('crm'::app.app_name) OR app.has_role('administrator'::app.app_role)));

create policy crm_write on crm.contact_ext as PERMISSIVE for ALL to authenticated using ((app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role]))) with check ((app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role])));

CREATE TRIGGER character_alias_licensor_guard BEFORE INSERT OR UPDATE ON core.character_alias FOR EACH ROW EXECUTE FUNCTION core.guard_character_alias_licensor();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.character_alias FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER contact_attach_customer_by_email AFTER INSERT OR UPDATE OF email ON core.contact FOR EACH ROW EXECUTE FUNCTION core.contact_attach_customer_by_email();

CREATE TRIGGER customer_attach_contacts_by_domain AFTER INSERT OR UPDATE OF domain ON core.customer FOR EACH ROW EXECUTE FUNCTION core.customer_attach_contacts_by_domain();

CREATE TRIGGER customer_link_ingested_domains AFTER INSERT OR UPDATE OF domain ON core.customer FOR EACH ROW EXECUTE FUNCTION crm.customer_domain_link_ingested();

CREATE TRIGGER a_taxonomy_source_ref_identity_guard BEFORE INSERT OR UPDATE ON core.taxonomy_source_ref FOR EACH ROW EXECUTE FUNCTION core.guard_taxonomy_source_ref_identity();

CREATE TRIGGER b_taxonomy_source_ref_last_seen BEFORE UPDATE OF entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_licensor_id, missing_since ON core.taxonomy_source_ref FOR EACH ROW EXECUTE FUNCTION core.bump_taxonomy_source_ref_last_seen();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm.contact_ext FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER crm_department_salesperson_guard BEFORE INSERT OR UPDATE OF salesperson_profile_id, secondary_salesperson_profile_id ON crm.department FOR EACH ROW EXECUTE FUNCTION crm.enforce_department_salesperson();

CREATE TRIGGER ingested_domain_link_customer BEFORE INSERT OR UPDATE OF domain ON crm.ingested_domain FOR EACH ROW EXECUTE FUNCTION crm.ingested_domain_link_customer();
