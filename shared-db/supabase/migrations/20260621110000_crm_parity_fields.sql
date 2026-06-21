-- CRM parity fields for the popcrm-web Directus -> Supabase migration.
--
-- Adds the explicit columns the CRM frontend/worker query, filter, display, or edit,
-- onto the canonical shared tables (no duplicate crm.company / crm.contact tables).
-- Low-value/import-only Directus fields are intentionally left in `metadata`.
-- All changes are additive and nullable so they are safe for the shared preview
-- branch and the other apps (DAM/PM/PLM) that share these tables.
--
-- Source of truth for field shapes: u2giants/directus pm-system/crm-schema.mjs.

-- ---------------------------------------------------------------------------
-- core.company  <-  Directus `retailer` / `ingested_domains`
-- customer_status / chain_type / routing_aliases / so_patterns are CRM-owned
-- account attributes that drive CRM UI badges, filters, and email routing.
-- ---------------------------------------------------------------------------
alter table core.company
  add column if not exists customer_status text,
  add column if not exists chain_type text,
  add column if not exists routing_aliases text,
  add column if not exists so_patterns text,
  add column if not exists primary_salesperson_profile_id uuid references app.profile(id) on delete set null,
  add column if not exists account_owner_profile_id uuid references app.profile(id) on delete set null;

comment on column core.company.customer_status is
  'CRM account triage status: ACTIVE_CUSTOMER | POTENTIAL_CUSTOMER | OTHER | UNASSIGNED (null/UNASSIGNED = New Company).';
comment on column core.company.routing_aliases is 'CRM email-routing alias domains/strings, newline or comma separated.';
comment on column core.company.so_patterns is 'CRM sales-order number patterns used by the email-routing worker.';

create index if not exists core_company_customer_status_idx on core.company (customer_status);

-- ---------------------------------------------------------------------------
-- core.contact_company  <-  Directus `buyer` CRM relationship attributes
-- contact_type / scope are CRM routing attributes; crm_department_id ties a
-- contact to a CRM department. Kept on the relationship row, not core.contact,
-- so the same person can relate differently to different companies.
-- ---------------------------------------------------------------------------
alter table core.contact_company
  add column if not exists contact_type text,
  add column if not exists scope text,
  add column if not exists crm_department_id uuid references crm.department(id) on delete set null;

comment on column core.contact_company.contact_type is 'CRM contact type (BUYER, PLANNER, ...). See directus crm-schema choices.contactType.';
comment on column core.contact_company.scope is 'CRM email-routing scope: DEPARTMENT | COMPANY_WIDE | IGNORED.';

create index if not exists core_contact_company_crm_department_idx on core.contact_company (crm_department_id);

-- ---------------------------------------------------------------------------
-- crm.department  <-  Directus `crm_department`
-- ---------------------------------------------------------------------------
alter table crm.department
  add column if not exists category text,
  add column if not exists division text,
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order integer;

create index if not exists crm_department_company_idx on crm.department (company_id);

-- ---------------------------------------------------------------------------
-- crm.opportunity  <-  Directus `crm_opportunity`
-- Existing baseline already has estimated_value, close_date, production_po_number,
-- sales_order_number, project_id, production_order_id, company/contact/department/factory.
-- ---------------------------------------------------------------------------
alter table crm.opportunity
  add column if not exists program_type text,
  add column if not exists season_year text,
  add column if not exists division text,
  add column if not exists directive_source text,
  add column if not exists origin_country text,
  add column if not exists licensed boolean,
  add column if not exists import_po_number text,
  add column if not exists customer_incoterms text,
  add column if not exists factory_incoterms text,
  add column if not exists hard_delivery_date date,
  add column if not exists sample_required boolean,
  add column if not exists sample_approval_method text,
  add column if not exists requires_new_pricing boolean,
  add column if not exists probability integer,
  add column if not exists ai_summary text,
  add column if not exists ai_state text,
  add column if not exists owner_profile_id uuid references app.profile(id) on delete set null;

comment on column crm.opportunity.ai_state is 'Serialized worker AI conversation/summary state for the opportunity chat endpoint.';
create index if not exists crm_opportunity_stage_idx on crm.opportunity (stage);

-- ---------------------------------------------------------------------------
-- crm.email_message  <-  Directus `crm_email_message`
-- Explicit routing columns. Raw bodies stay out: body_preview (curated) is the
-- only body exposed; full payloads belong in body_storage_ref / ingest.raw_record.
-- ---------------------------------------------------------------------------
alter table crm.email_message
  add column if not exists department_id uuid references crm.department(id) on delete set null,
  add column if not exists sender text,
  add column if not exists recipients text,
  add column if not exists routing_status text,
  add column if not exists routing_method text,
  add column if not exists detected_so_numbers text,
  add column if not exists detected_po_numbers text,
  add column if not exists outlook_message_id text,
  add column if not exists mailbox_owner_profile_id uuid references app.profile(id) on delete set null;

create index if not exists crm_email_message_routing_status_idx on crm.email_message (routing_status);
create index if not exists crm_email_message_received_at_idx on crm.email_message (received_at desc);

-- ---------------------------------------------------------------------------
-- crm.meeting_note  <-  Directus `crm_meeting_note`
-- name->title, date->meeting_at, summary->body already exist in baseline.
-- ---------------------------------------------------------------------------
alter table crm.meeting_note
  add column if not exists department_id uuid references crm.department(id) on delete set null,
  add column if not exists participants text,
  add column if not exists action_items text,
  add column if not exists source text,
  add column if not exists fireflies_transcript_id text;

create index if not exists crm_meeting_note_meeting_at_idx on crm.meeting_note (meeting_at desc);

-- ---------------------------------------------------------------------------
-- crm.note  <-  Directus `crm_note`
-- baseline only had body (not null) + company/opportunity. Relax body and add
-- the title/action_items/source/relations the UI shows.
-- ---------------------------------------------------------------------------
alter table crm.note
  add column if not exists title text,
  add column if not exists action_items text,
  add column if not exists source text,
  add column if not exists fireflies_transcript_id text,
  add column if not exists contact_id uuid references core.contact(id) on delete set null,
  add column if not exists department_id uuid references crm.department(id) on delete set null;

alter table crm.note alter column body drop not null;

-- ---------------------------------------------------------------------------
-- crm.task  <-  Directus `crm_task`
-- ---------------------------------------------------------------------------
alter table crm.task
  add column if not exists body text,
  add column if not exists contact_id uuid references core.contact(id) on delete set null,
  add column if not exists department_id uuid references crm.department(id) on delete set null;

-- Directus task statuses are TODO/IN_PROGRESS/DONE (+ UI CANCELED). Align default.
alter table crm.task alter column status set default 'TODO';
create index if not exists crm_task_status_idx on crm.task (status);

-- ---------------------------------------------------------------------------
-- crm.ignore_rule  <-  Directus `crm_ignore_rule`
-- UI provides name/pattern/match_type; keep rule_type for back-compat with a default.
-- ---------------------------------------------------------------------------
alter table crm.ignore_rule
  add column if not exists name text,
  add column if not exists match_type text,
  add column if not exists emails_skipped integer not null default 0;

alter table crm.ignore_rule alter column rule_type set default 'email';

-- ---------------------------------------------------------------------------
-- crm.ai_model_config  <-  Directus `crm_ai_model_config`
-- Directus stores one row with four per-feature model columns. Add those columns
-- and relax the baseline feature/provider/model NOT NULLs so that shape fits.
-- ---------------------------------------------------------------------------
alter table crm.ai_model_config
  add column if not exists name text,
  add column if not exists email_routing_model text,
  add column if not exists fireflies_routing_model text,
  add column if not exists transcript_split_model text,
  add column if not exists opportunity_summary_model text;

alter table crm.ai_model_config alter column feature drop not null;
alter table crm.ai_model_config alter column provider drop not null;
alter table crm.ai_model_config alter column model drop not null;

-- ---------------------------------------------------------------------------
-- crm.licensor_approval_thread  <-  Directus `crm_licensor_approval_thread`
-- stage stays free-form text (no enum) to match the frontend's keyword tone logic.
-- ---------------------------------------------------------------------------
alter table crm.licensor_approval_thread
  add column if not exists name text,
  add column if not exists property_name text,
  add column if not exists stage text,
  add column if not exists submitted_date date,
  add column if not exists response_date date,
  add column if not exists due_date date,
  add column if not exists licensor_comments text,
  add column if not exists opportunity_id uuid references crm.opportunity(id) on delete set null;

comment on column crm.licensor_approval_thread.stage is 'Free-form approval stage label (not an enum); CRM UI derives tone from keywords.';
