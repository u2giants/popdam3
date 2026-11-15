-- #6356 sandbox catch-up batch 4: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports item assignment/workflow-action history, legacy ERP identity, production PO reservation, ColdLion property sync run and licensor submission PDF tables, with their guard functions and triggers.
-- derived-from: none

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION plm.reject_item_assignment_history_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'item assignment history is append-only' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.rfq_item_id is distinct from old.rfq_item_id
     or new.function_key is distinct from old.function_key
     or new.user_id is distinct from old.user_id
     or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.effective_from is distinct from old.effective_from
     or new.assignment_context is distinct from old.assignment_context
     or new.created_at is distinct from old.created_at
     or old.effective_to is not null
     or new.effective_to is null then
    raise exception 'assignment facts are immutable; only close an active assignment once' using errcode = '55000';
  end if;
  return new;
end
$function$
;
revoke all on function plm.reject_item_assignment_history_rewrite() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.reject_item_workflow_action_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
begin
  raise exception 'workflow action history is append-only' using errcode = '55000';
end
$function$
;
revoke all on function plm.reject_item_workflow_action_rewrite() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.guard_production_po_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  next_po text := plm.normalize_production_po_number(new.production_order_number);
  claimed_po text;
  admitted_id uuid;
begin
  if next_po is null or next_po = '' then
    raise exception 'A production PO number is required.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'An existing order identity cannot be changed.' using errcode = '23514';
    end if;
    -- Existing historical reuse is grandfathered by identity, never by date or role.
    if next_po = plm.normalize_production_po_number(old.production_order_number) then
      return new;
    end if;
    raise exception 'An existing production PO number cannot be changed.' using errcode = '23514';
  end if;

  -- An exact-ID INSERT ... ON CONFLICT UPDATE can update the same existing order.
  -- A deleted order no longer qualifies, so its number cannot be recycled.
  if exists (select 1 from plm.production_order p
             where p.id = new.id and plm.normalize_production_po_number(p.production_order_number) = next_po) then
    return new;
  end if;

  -- The primary key waits on concurrent reservations and permits only one winner.
  insert into plm.production_po_reservation(normalized_po) values (next_po)
  on conflict (normalized_po) do nothing returning normalized_po into claimed_po;
  if claimed_po is not null then return new; end if;

  update plm.production_po_legacy_admission
     set used_at = clock_timestamp()
   where order_id = new.id and normalized_po = next_po and used_at is null
   returning order_id into admitted_id;
  if admitted_id is not null then return new; end if;

  raise exception 'This production PO number has already been used. Enter a new number.'
    using errcode = '23505', constraint = 'production_po_no_reuse';
end;
$function$
;
revoke all on function plm.guard_production_po_number() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.normalize_production_po_number(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select lower(regexp_replace(value, U&'^[[:space:]\00A0]+|[[:space:]\00A0]+$', '', 'g'));
$function$
;
revoke all on function plm.normalize_production_po_number(value text) from public, anon, authenticated;
create table if not exists plm.item_user_assignment (
  "id" bigint generated always as identity not null,
  "rfq_item_id" integer not null,
  "function_key" text not null,
  "user_id" integer not null,
  "assigned_by_user_id" integer not null,
  "effective_from" timestamp with time zone default clock_timestamp() not null,
  "effective_to" timestamp with time zone,
  "assignment_context" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default clock_timestamp() not null
);
alter table plm.item_user_assignment add constraint "item_user_assignment_context_object_check" CHECK ((jsonb_typeof(assignment_context) = 'object'::text));
alter table plm.item_user_assignment add constraint "item_user_assignment_effective_window_check" CHECK (((effective_to IS NULL) OR (effective_to > effective_from)));
alter table plm.item_user_assignment add constraint "item_user_assignment_function_key_shape_check" CHECK (((function_key = lower(btrim(function_key))) AND (function_key ~ '^[a-z][a-z0-9_-]*$'::text)));
alter table plm.item_user_assignment add constraint "item_user_assignment_pkey" PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS item_user_assignment_active_lookup ON plm.item_user_assignment USING btree (rfq_item_id, function_key, effective_from, id) INCLUDE (user_id) WHERE (effective_to IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS item_user_assignment_one_active ON plm.item_user_assignment USING btree (rfq_item_id, function_key, user_id) WHERE (effective_to IS NULL);
CREATE INDEX IF NOT EXISTS item_user_assignment_rfq_item_id_idx ON plm.item_user_assignment USING btree (rfq_item_id);
alter table plm.item_user_assignment enable row level security;
CREATE TRIGGER item_user_assignment_immutable_history BEFORE DELETE OR UPDATE ON plm.item_user_assignment FOR EACH ROW EXECUTE FUNCTION plm.reject_item_assignment_history_rewrite();
comment on table plm.item_user_assignment is 'Final plm item-master home for dflow.item_user_assignment (issues #3498, #3595). Item function-role assignment history; append-only enforced (only closing an active assignment once is allowed). Column shapes, indexes and append-only behavior match the dflow source. Row movement is a separate DesignFlow migration. User-id foreign keys and backend grants are still pending on #3595; deny-by-default until then.';
create table if not exists plm.item_workflow_action (
  "id" bigint generated always as identity not null,
  "rfq_item_id" integer not null,
  "actor_user_id" integer not null,
  "actor_auth_user_id" uuid,
  "actor_identity_source" text default 
CASE
    WHEN (NULLIF(current_setting('request.designflow.actor_id'::text, true), ''::text) IS NOT NULL) THEN 'designflow_jwt'::text
    ELSE 'supabase_auth'::text
END not null,
  "actor_identity_email" text default lower(NULLIF(btrim(COALESCE(NULLIF(current_setting('request.designflow.actor_email'::text, true), ''::text), (auth.jwt() ->> 'email'::text))), ''::text)),
  "prior_step_id" integer,
  "new_step_id" integer not null,
  "action_key" text not null,
  "correlation_key" uuid not null,
  "routing_context" jsonb default '{}'::jsonb not null,
  "occurred_at" timestamp with time zone default clock_timestamp() not null,
  "source_action_id" bigint,
  "fallback_recipient_user_id" integer,
  "fallback_reason" text,
  "requires_admin_review" boolean default false not null
);
alter table plm.item_workflow_action add constraint "item_workflow_action_action_key_shape_check" CHECK (((action_key = lower(btrim(action_key))) AND (action_key ~ '^[a-z][a-z0-9_-]*$'::text)));
alter table plm.item_workflow_action add constraint "item_workflow_action_actor_provenance" CHECK ((((actor_identity_source = 'supabase_auth'::text) AND (actor_auth_user_id IS NOT NULL)) OR ((actor_identity_source = 'designflow_jwt'::text) AND (actor_auth_user_id IS NULL) AND (actor_identity_email IS NOT NULL))));
alter table plm.item_workflow_action add constraint "item_workflow_action_correlation_key_key" UNIQUE (correlation_key);
alter table plm.item_workflow_action add constraint "item_workflow_action_fallback_is_labeled" CHECK ((((fallback_recipient_user_id IS NULL) AND (fallback_reason IS NULL)) OR ((fallback_recipient_user_id IS NOT NULL) AND (fallback_reason IS NOT NULL) AND (btrim(fallback_reason) <> ''::text) AND (source_action_id IS NOT NULL))));
alter table plm.item_workflow_action add constraint "item_workflow_action_id_rfq_item_key" UNIQUE (id, rfq_item_id);
alter table plm.item_workflow_action add constraint "item_workflow_action_pkey" PRIMARY KEY (id);
alter table plm.item_workflow_action add constraint "item_workflow_action_return_names_its_source" CHECK ((((routing_context ->> 'return_to_original_handoff'::text) IS DISTINCT FROM 'true'::text) OR (source_action_id IS NOT NULL)));
alter table plm.item_workflow_action add constraint "item_workflow_action_routing_context_object_check" CHECK ((jsonb_typeof(routing_context) = 'object'::text));
alter table plm.item_workflow_action add constraint "item_workflow_action_source_action_not_self" CHECK (((source_action_id IS NULL) OR (source_action_id <> id)));
CREATE INDEX IF NOT EXISTS item_workflow_action_admin_review ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at) WHERE requires_admin_review;
CREATE INDEX IF NOT EXISTS item_workflow_action_item_time ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS item_workflow_action_new_step_id_idx ON plm.item_workflow_action USING btree (new_step_id);
CREATE UNIQUE INDEX IF NOT EXISTS item_workflow_action_one_return_per_source ON plm.item_workflow_action USING btree (source_action_id) WHERE (source_action_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS item_workflow_action_open_handoff_lookup ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at DESC, id DESC) INCLUDE (actor_user_id);
CREATE INDEX IF NOT EXISTS item_workflow_action_prior_step_id_idx ON plm.item_workflow_action USING btree (prior_step_id);
CREATE INDEX IF NOT EXISTS item_workflow_action_rfq_item_id_idx ON plm.item_workflow_action USING btree (rfq_item_id);
CREATE INDEX IF NOT EXISTS item_workflow_action_source_action_rfq_item_idx ON plm.item_workflow_action USING btree (source_action_id, rfq_item_id);
alter table plm.item_workflow_action enable row level security;
CREATE TRIGGER item_workflow_action_immutable BEFORE DELETE OR UPDATE ON plm.item_workflow_action FOR EACH ROW EXECUTE FUNCTION plm.reject_item_workflow_action_rewrite();
comment on table plm.item_workflow_action is 'Final plm item-master home for dflow.item_workflow_action (issues #3498, #3595). Workflow action history; append-only enforced (UPDATE and DELETE refused). A return names source_action_id and never rewrites the original actor. Actor identity source is supabase_auth or designflow_jwt; backend email is normalized. Column shapes, indexes and append-only behavior match the dflow source. Row movement is a separate DesignFlow migration. User-id foreign keys and backend grants are still pending on #3595; deny-by-default until then.';
create table if not exists plm.legacy_erp_item_identity (
  "id" uuid not null,
  "external_id" text not null,
  "style_number" text,
  "division_code" text,
  "item_description" text,
  "mg01_code" text,
  "mg02_code" text,
  "mg03_code" text,
  "mg04_code" text,
  "mg05_code" text,
  "mg06_code" text,
  "frozen_at" timestamp with time zone default now() not null
);
alter table plm.legacy_erp_item_identity add constraint "legacy_erp_item_identity_external_id_key" UNIQUE (external_id);
alter table plm.legacy_erp_item_identity add constraint "legacy_erp_item_identity_pkey" PRIMARY KEY (id);
alter table plm.legacy_erp_item_identity enable row level security;
create policy "legacy_erp_item_identity_admin_read" on plm.legacy_erp_item_identity as permissive for select to authenticated using (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role));
comment on table plm.legacy_erp_item_identity is 'Frozen copy (#2482) of the identity and matching columns of the retired DesignFlow item feed. Resolves legacy ERP item UUIDs still carried by api.plm_item_list ids, plm.style_tracker_item_bridge.erp_item_id and public.product_category_predictions.erp_item_id. No feed writes it.';
create table if not exists plm.production_po_legacy_admission (
  "order_id" uuid not null,
  "normalized_po" text not null,
  "source_evidence_sha256" text not null,
  "review_receipt_sha256" text not null,
  "admitted_at" timestamp with time zone default now() not null,
  "used_at" timestamp with time zone
);
alter table plm.production_po_legacy_admission add constraint "production_po_legacy_admission_pkey" PRIMARY KEY (order_id);
alter table plm.production_po_legacy_admission add constraint "production_po_legacy_admission_review_receipt_sha256_check" CHECK ((review_receipt_sha256 ~ '^[0-9a-f]{64}$'::text));
alter table plm.production_po_legacy_admission add constraint "production_po_legacy_admission_source_evidence_sha256_check" CHECK ((source_evidence_sha256 ~ '^[0-9a-f]{64}$'::text));
alter table plm.production_po_legacy_admission enable row level security;
comment on table plm.production_po_legacy_admission is 'Postgres-owner-only, one-use exact-order historical admissions requiring private evidence and review digests. Application roles and service_role have no access. Never a general import/date-based exemption.';
create table if not exists plm.production_po_reservation (
  "normalized_po" text not null,
  "reserved_at" timestamp with time zone default now() not null
);
alter table plm.production_po_reservation add constraint "production_po_reservation_normalized" CHECK (((normalized_po <> ''::text) AND (normalized_po = plm.normalize_production_po_number(normalized_po))));
alter table plm.production_po_reservation add constraint "production_po_reservation_pkey" PRIMARY KEY (normalized_po);
alter table plm.production_po_reservation enable row level security;
comment on table plm.production_po_reservation is 'Permanent case/outer-whitespace normalized production PO reservations. No cascade: cancellation, voiding and deletion never release a number. Historical duplicate headers remain intact.';
create table if not exists plm.coldlion_property_sync_run (
  "id" bigint generated always as identity not null,
  "ran_at" timestamp with time zone default clock_timestamp() not null,
  "applied" boolean not null,
  "counts" jsonb not null,
  "skipped" jsonb default '[]'::jsonb not null
);
alter table plm.coldlion_property_sync_run add constraint "coldlion_property_sync_run_pkey" PRIMARY KEY (id);
alter table plm.coldlion_property_sync_run enable row level security;
comment on table plm.coldlion_property_sync_run is '#6194: one row per run of plm.sync_core_property_from_coldlion (counts of created, renamed, coded, status changes, skips).';
create table if not exists plm.licensor_submission_pdf (
  "id" bigint generated always as identity not null,
  "capture_id" uuid not null,
  "nas_path" text not null,
  "file_size_bytes" bigint not null,
  "licensor_folder" text not null,
  "submission_year" integer,
  "style_code" text,
  "portal_system" text not null,
  "properties" text[] default '{}'::text[] not null,
  "sub_properties" text[] default '{}'::text[] not null,
  "characters" text[] default '{}'::text[] not null,
  "style_guides" text[] default '{}'::text[] not null,
  "text_length" integer not null,
  "created_at" timestamp with time zone default now() not null
);
alter table plm.licensor_submission_pdf add constraint "licensor_submission_pdf_capture_id_nas_path_key" UNIQUE (capture_id, nas_path);
alter table plm.licensor_submission_pdf add constraint "licensor_submission_pdf_file_size_bytes_check" CHECK ((file_size_bytes >= 0));
alter table plm.licensor_submission_pdf add constraint "licensor_submission_pdf_pkey" PRIMARY KEY (id);
alter table plm.licensor_submission_pdf add constraint "licensor_submission_pdf_text_length_check" CHECK ((text_length >= 0));
CREATE INDEX IF NOT EXISTS licensor_submission_pdf_style_idx ON plm.licensor_submission_pdf USING btree (style_code, capture_id);
alter table plm.licensor_submission_pdf enable row level security;
create policy "licensor_submission_pdf_staff_read" on plm.licensor_submission_pdf as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role]));
comment on table plm.licensor_submission_pdf is 'Per-PDF readings from licensor submission confirmation pages: the licensor-side properties, sub-properties, characters and style guides printed on the page, keyed to our style number taken from the file name. Evidence only; ColdLion stays authoritative for MG05/MG06 (popcre/shared-db#5952).';
create table if not exists plm.licensor_submission_pdf_capture (
  "id" uuid default gen_random_uuid() not null,
  "capture_key" text not null,
  "source_root" text not null,
  "year_from" integer not null,
  "year_to" integer not null,
  "reader" text not null,
  "extractor_commit" text,
  "expected_file_count" integer not null,
  "loaded_file_count" integer default 0 not null,
  "status" text default 'loading'::text not null,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "notes" text
);
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_capture_key_key" UNIQUE (capture_key);
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_check" CHECK ((year_from <= year_to));
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_check1" CHECK (((status = 'complete'::text) = (completed_at IS NOT NULL)));
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_expected_file_count_check" CHECK ((expected_file_count >= 0));
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_loaded_file_count_check" CHECK ((loaded_file_count >= 0));
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_pkey" PRIMARY KEY (id);
alter table plm.licensor_submission_pdf_capture add constraint "licensor_submission_pdf_capture_status_check" CHECK ((status = ANY (ARRAY['loading'::text, 'complete'::text, 'rejected'::text])));
alter table plm.licensor_submission_pdf_capture enable row level security;
create policy "licensor_submission_pdf_capture_staff_read" on plm.licensor_submission_pdf_capture as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role]));
comment on table plm.licensor_submission_pdf_capture is 'One run of reading licensor submission confirmation PDFs from the NAS (popcre/shared-db#5952). A capture is usable only when status is complete; its rows in plm.licensor_submission_pdf are never edited, a new run is a new capture.';
alter table plm.item_user_assignment add constraint "item_user_assignment_rfq_item_id_fkey" FOREIGN KEY (rfq_item_id) REFERENCES plm."RFQItem"("rfqItem_id") ON DELETE CASCADE;
alter table plm.item_workflow_action add constraint "item_workflow_action_new_step_id_fkey" FOREIGN KEY (new_step_id) REFERENCES plm."RFQStep"("RFQStep_id");
alter table plm.item_workflow_action add constraint "item_workflow_action_prior_step_id_fkey" FOREIGN KEY (prior_step_id) REFERENCES plm."RFQStep"("RFQStep_id");
alter table plm.item_workflow_action add constraint "item_workflow_action_rfq_item_id_fkey" FOREIGN KEY (rfq_item_id) REFERENCES plm."RFQItem"("rfqItem_id") ON DELETE RESTRICT;
alter table plm.item_workflow_action add constraint "item_workflow_action_source_action_id_fkey" FOREIGN KEY (source_action_id, rfq_item_id) REFERENCES plm.item_workflow_action(id, rfq_item_id) ON DELETE RESTRICT;
alter table plm.production_po_legacy_admission add constraint "production_po_legacy_admission_normalized_po_fkey" FOREIGN KEY (normalized_po) REFERENCES plm.production_po_reservation(normalized_po);
alter table plm.licensor_submission_pdf add constraint "licensor_submission_pdf_capture_id_fkey" FOREIGN KEY (capture_id) REFERENCES plm.licensor_submission_pdf_capture(id) ON DELETE RESTRICT;
