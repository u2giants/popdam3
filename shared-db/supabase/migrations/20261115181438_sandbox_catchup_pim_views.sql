-- #6356 sandbox catch-up batch 8: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports pim AI activity triage tables and plm/api/dflow current-state views from production (crm.contact_ext and the dam-backed api views are deferred).
-- Not ported: the two pm_jev_triage_worker policies (that production runtime login does not exist on the sandbox).
-- derived-from: none

set check_function_bodies = off;

create table if not exists pim.ai_activity_triage (
  "id" uuid default gen_random_uuid() not null,
  "eligibility_id" uuid not null,
  "comment_id" uuid not null,
  "requester_profile_id" uuid not null,
  "product_id" uuid not null,
  "source_body_revision" integer not null,
  "live_comment_id" uuid,
  "live_product_id" uuid,
  "live_requester_profile_id" uuid,
  "created_record_table" text,
  "created_record_id" uuid,
  "input_digest" text not null,
  "input_key_version" text not null,
  "model" text not null,
  "contract_version" text not null,
  "state" text default 'queued'::text not null,
  "action_label" text,
  "result_payload" jsonb default '{}'::jsonb not null,
  "usage_payload" jsonb default '{}'::jsonb not null,
  "error_code" text,
  "lease_token_hash" text,
  "lease_expires_at" timestamp with time zone,
  "lease_acquired_at" timestamp with time zone,
  "attempt_count" integer default 0 not null,
  "provider_started_at" timestamp with time zone,
  "timeout_count" integer default 0 not null,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_profile_id" uuid,
  "accepted_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "first_impression_at" timestamp with time zone,
  "request_limit_window_start" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table pim.ai_activity_triage add constraint "ai_activity_triage_action_label_check" CHECK (((action_label IS NULL) OR (action_label = ANY (ARRAY['routine_update'::text, 'blocker_dependency'::text, 'decision'::text, 'follow_up_reminder'::text, 'unclear'::text]))));
alter table pim.ai_activity_triage add constraint "ai_activity_triage_eligibility_id_key" UNIQUE (eligibility_id);
alter table pim.ai_activity_triage add constraint "ai_activity_triage_pkey" PRIMARY KEY (id);
alter table pim.ai_activity_triage add constraint "ai_activity_triage_state_check" CHECK ((state = ANY (ARRAY['queued'::text, 'claimed'::text, 'leased'::text, 'succeeded'::text, 'failed'::text, 'accepted'::text, 'dismissed'::text, 'source_changed'::text, 'expired'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS ai_activity_triage_comment_idempotency_key ON pim.ai_activity_triage USING btree (comment_id, input_digest, input_key_version, model, contract_version);
CREATE INDEX IF NOT EXISTS ai_activity_triage_requester_idx ON pim.ai_activity_triage USING btree (requester_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_activity_triage_state_idx ON pim.ai_activity_triage USING btree (state, reviewed_at);
CREATE INDEX IF NOT EXISTS ai_activity_triage_live_comment_idx ON pim.ai_activity_triage USING btree (live_comment_id) WHERE (live_comment_id IS NOT NULL);
alter table pim.ai_activity_triage enable row level security;
create policy "pm_ai_activity_triage_admin_audit" on pim.ai_activity_triage as permissive for select to authenticated using (app.has_role('administrator'::app.app_role));
create policy "pm_ai_activity_triage_select_own" on pim.ai_activity_triage as permissive for select to authenticated using ((requester_profile_id = app.current_profile_id()));
comment on table pim.ai_activity_triage is 'Redacted provider/result metadata only. Never stores comment text, titles, emails, URLs, or credentials.';
create table if not exists pim.ai_activity_triage_eligibility (
  "id" uuid default gen_random_uuid() not null,
  "requester_profile_id" uuid not null,
  "client_operation_id" uuid not null,
  "eligibility_version" integer default 1 not null,
  "comment_id" uuid,
  "product_id" uuid not null,
  "source_body_revision" integer not null,
  "cohort" text default 'pilot'::text not null,
  "eligibility_state" text default 'reserved'::text not null,
  "reservation_token_hash" text,
  "recovery_handle_mac" text,
  "reserved_at" timestamp with time zone default now() not null,
  "submitted_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  "expires_at" timestamp with time zone default (now() + '7 days'::interval) not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table pim.ai_activity_triage_eligibility add constraint "ai_activity_triage_eligibilit_requester_profile_id_client_o_key" UNIQUE (requester_profile_id, client_operation_id, eligibility_version);
alter table pim.ai_activity_triage_eligibility add constraint "ai_activity_triage_eligibility_cohort_check" CHECK ((cohort = ANY (ARRAY['validation'::text, 'pilot'::text])));
alter table pim.ai_activity_triage_eligibility add constraint "ai_activity_triage_eligibility_eligibility_state_check" CHECK ((eligibility_state = ANY (ARRAY['reserved'::text, 'submitted'::text, 'canceled'::text, 'expired'::text, 'queued'::text, 'source_changed'::text])));
alter table pim.ai_activity_triage_eligibility add constraint "ai_activity_triage_eligibility_pkey" PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS ai_activity_triage_eligibility_token_idx ON pim.ai_activity_triage_eligibility USING btree (reservation_token_hash) WHERE (reservation_token_hash IS NOT NULL);
CREATE INDEX IF NOT EXISTS ai_activity_triage_eligibility_comment_idx ON pim.ai_activity_triage_eligibility USING btree (comment_id);
alter table pim.ai_activity_triage_eligibility enable row level security;
create policy "pm_ai_activity_triage_eligibility_admin_audit" on pim.ai_activity_triage_eligibility as permissive for select to authenticated using (app.has_role('administrator'::app.app_role));
create policy "pm_ai_activity_triage_eligibility_select_own" on pim.ai_activity_triage_eligibility as permissive for select to authenticated using ((requester_profile_id = app.current_profile_id()));
comment on table pim.ai_activity_triage_eligibility is 'Append-only-during-pilot eligibility/reservation ledger. No raw comment text.';
alter table pim.ai_activity_triage add constraint "ai_activity_triage_live_comment_id_fkey" FOREIGN KEY (live_comment_id) REFERENCES app.comment(id) ON DELETE SET NULL;
alter table pim.ai_activity_triage add constraint "ai_activity_triage_live_product_id_fkey" FOREIGN KEY (live_product_id) REFERENCES pim.product(id) ON DELETE SET NULL;
alter table pim.ai_activity_triage add constraint "ai_activity_triage_live_requester_profile_id_fkey" FOREIGN KEY (live_requester_profile_id) REFERENCES app.profile(id) ON DELETE SET NULL;
-- view plm.asset_file_style_guide_index options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwd/postgres}
create or replace view plm.asset_file_style_guide_index with (security_invoker=true) as
 SELECT 'disney_dcpvault'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.dcp_asset a
     JOIN plm.dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'disney_dcpvault'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.dcp_asset a
     JOIN plm.dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'disney_dcpvault'::text AS source_system,
    NULL::text AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.dcp_asset a
     JOIN plm.dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'lucasfilm_dcpvault'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.lucasfilm_dcp_asset a
     JOIN plm.lucasfilm_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'lucasfilm_dcpvault'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.lucasfilm_dcp_asset a
     JOIN plm.lucasfilm_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'lucasfilm_dcpvault'::text AS source_system,
    NULL::text AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.lucasfilm_dcp_asset a
     JOIN plm.lucasfilm_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'marvel_dcpvault'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.marvel_dcp_asset a
     JOIN plm.marvel_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'marvel_dcpvault'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.marvel_dcp_asset a
     JOIN plm.marvel_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'marvel_dcpvault'::text AS source_system,
    NULL::text AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.marvel_dcp_asset a
     JOIN plm.marvel_dcp_style_guide g ON g.id = a.style_guide_id
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'marvel_asgard'::text AS source_system,
    o.sku_sg_file_key AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_key, ''::text), g.source_identity_key) AS source_style_guide_key,
    g.exact_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    o.exact_filename AS matched_file_name
   FROM plm.marvel_asgard_node_asset_observation o
     JOIN plm.marvel_asgard_guide_node n ON n.id = o.guide_node_id
     JOIN plm.marvel_asgard_style_guide g ON g.id = n.style_guide_id
  WHERE btrim(o.exact_filename) <> ''::text AND o.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'marvel_asgard'::text AS source_system,
    file_name_norm(o.exact_filename) AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_key, ''::text), g.source_identity_key) AS source_style_guide_key,
    g.exact_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    o.exact_filename AS matched_file_name
   FROM plm.marvel_asgard_node_asset_observation o
     JOIN plm.marvel_asgard_guide_node n ON n.id = o.guide_node_id
     JOIN plm.marvel_asgard_style_guide g ON g.id = n.style_guide_id
  WHERE btrim(o.exact_filename) <> ''::text AND o.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'marvel_asgard'::text AS source_system,
    NULL::text AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_key, ''::text), g.source_identity_key) AS source_style_guide_key,
    g.exact_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    o.exact_filename AS matched_file_name
   FROM plm.marvel_asgard_node_asset_observation o
     JOIN plm.marvel_asgard_guide_node n ON n.id = o.guide_node_id
     JOIN plm.marvel_asgard_style_guide g ON g.id = n.style_guide_id
  WHERE btrim(o.exact_filename) <> ''::text AND o.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'nbcu'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    g.style_guide_key AS source_style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.nbcu_asset a
     JOIN plm.nbcu_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_key = a.asset_source_key
     JOIN plm.nbcu_style_guide g ON g.capture_id = l.capture_id AND g.style_guide_key = l.style_guide_key
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'nbcu'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    g.style_guide_key AS source_style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.nbcu_asset a
     JOIN plm.nbcu_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_key = a.asset_source_key
     JOIN plm.nbcu_style_guide g ON g.capture_id = l.capture_id AND g.style_guide_key = l.style_guide_key
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'nbcu'::text AS source_system,
    NULL::text AS file_name_norm,
    g.style_guide_key AS source_style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.nbcu_asset a
     JOIN plm.nbcu_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_key = a.asset_source_key
     JOIN plm.nbcu_style_guide g ON g.capture_id = l.capture_id AND g.style_guide_key = l.style_guide_key
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'warner_starlabs'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    COALESCE(NULLIF(g.source_id, ''::text), g.fallback_key) AS source_style_guide_key,
    g.label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.wb_asset_normalized a
     JOIN plm.wb_asset_style_guide_normalized l ON l.asset_id = a.id
     JOIN plm.wb_style_guide_normalized g ON g.id = l.style_guide_id
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'warner_starlabs'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    COALESCE(NULLIF(g.source_id, ''::text), g.fallback_key) AS source_style_guide_key,
    g.label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.wb_asset_normalized a
     JOIN plm.wb_asset_style_guide_normalized l ON l.asset_id = a.id
     JOIN plm.wb_style_guide_normalized g ON g.id = l.style_guide_id
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'warner_starlabs'::text AS source_system,
    NULL::text AS file_name_norm,
    COALESCE(NULLIF(g.source_id, ''::text), g.fallback_key) AS source_style_guide_key,
    g.label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.wb_asset_normalized a
     JOIN plm.wb_asset_style_guide_normalized l ON l.asset_id = a.id
     JOIN plm.wb_style_guide_normalized g ON g.id = l.style_guide_id
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'peanuts_tenovos'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.peanuts_asset a
     JOIN plm.peanuts_style_guide g ON g.capture_id = a.capture_id AND g.value_key = a.style_guide_key
  WHERE a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'peanuts_tenovos'::text AS source_system,
    file_name_norm(a.file_name) AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.peanuts_asset a
     JOIN plm.peanuts_style_guide g ON g.capture_id = a.capture_id AND g.value_key = a.style_guide_key
  WHERE a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'peanuts_tenovos'::text AS source_system,
    NULL::text AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name
   FROM plm.peanuts_asset a
     JOIN plm.peanuts_style_guide g ON g.capture_id = a.capture_id AND g.value_key = a.style_guide_key
  WHERE a.sku_sg_file_key = ''::text
UNION ALL
 SELECT 'sesame_netx'::text AS source_system,
    a.sku_sg_file_key AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.original_file_name AS matched_file_name
   FROM plm.sesame_asset a
     JOIN plm.sesame_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_id = a.asset_source_id
     JOIN plm.sesame_style_guide g ON g.capture_id = l.capture_id AND g.value_key = l.value_key
  WHERE btrim(a.original_file_name) <> ''::text AND a.sku_sg_file_key <> ''::text
UNION ALL
 SELECT 'sesame_netx'::text AS source_system,
    file_name_norm(a.original_file_name) AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.original_file_name AS matched_file_name
   FROM plm.sesame_asset a
     JOIN plm.sesame_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_id = a.asset_source_id
     JOIN plm.sesame_style_guide g ON g.capture_id = l.capture_id AND g.value_key = l.value_key
  WHERE btrim(a.original_file_name) <> ''::text AND a.sku_sg_file_key IS NULL
UNION ALL
 SELECT 'sesame_netx'::text AS source_system,
    NULL::text AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.original_file_name AS matched_file_name
   FROM plm.sesame_asset a
     JOIN plm.sesame_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_id = a.asset_source_id
     JOIN plm.sesame_style_guide g ON g.capture_id = l.capture_id AND g.value_key = l.value_key
  WHERE btrim(a.original_file_name) <> ''::text AND a.sku_sg_file_key = ''::text;
revoke all on plm.asset_file_style_guide_index from public, anon;
grant all privileges on plm.asset_file_style_guide_index to service_role;
-- view plm.asset_file_style_guide_keys options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwd/postgres}
create or replace view plm.asset_file_style_guide_keys with (security_invoker=true) as
 SELECT 'disney_dcpvault'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.folder_name)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.dcp_asset a
     JOIN plm.dcp_style_guide g ON g.id = a.style_guide_id
UNION ALL
 SELECT 'lucasfilm_dcpvault'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.folder_name)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.lucasfilm_dcp_asset a
     JOIN plm.lucasfilm_dcp_style_guide g ON g.id = a.style_guide_id
UNION ALL
 SELECT 'marvel_dcpvault'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_id, ''::text), g.id::text) AS source_style_guide_key,
    g.folder_name AS style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.folder_name)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.marvel_dcp_asset a
     JOIN plm.marvel_dcp_style_guide g ON g.id = a.style_guide_id
UNION ALL
 SELECT 'marvel_asgard'::text AS source_system,
        CASE
            WHEN o.sku_sg_file_key IS NULL THEN file_name_norm(o.exact_filename)
            ELSE NULLIF(o.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    COALESCE(NULLIF(g.source_guide_key, ''::text), g.source_identity_key) AS source_style_guide_key,
    g.exact_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    o.exact_filename AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.exact_label)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.marvel_asgard_node_asset_observation o
     JOIN plm.marvel_asgard_guide_node n ON n.id = o.guide_node_id
     JOIN plm.marvel_asgard_style_guide g ON g.id = n.style_guide_id
  WHERE btrim(o.exact_filename) <> ''::text
UNION ALL
 SELECT 'nbcu'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    g.style_guide_key AS source_style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.style_guide_label)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.nbcu_asset a
     JOIN plm.nbcu_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_key = a.asset_source_key
     JOIN plm.nbcu_style_guide g ON g.capture_id = l.capture_id AND g.style_guide_key = l.style_guide_key
UNION ALL
 SELECT 'warner_starlabs'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    COALESCE(NULLIF(g.source_id, ''::text), g.fallback_key) AS source_style_guide_key,
    g.label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.label)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.wb_asset_normalized a
     JOIN plm.wb_asset_style_guide_normalized l ON l.asset_id = a.id
     JOIN plm.wb_style_guide_normalized g ON g.id = l.style_guide_id
UNION ALL
 SELECT 'peanuts_tenovos'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.value_label)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.peanuts_asset a
     JOIN plm.peanuts_style_guide g ON g.capture_id = a.capture_id AND g.value_key = a.style_guide_key
UNION ALL
 SELECT 'sesame_netx'::text AS source_system,
        CASE
            WHEN a.sku_sg_file_key IS NULL THEN file_name_norm(a.original_file_name)
            ELSE NULLIF(a.sku_sg_file_key, ''::text)
        END AS file_name_norm,
    g.value_key AS source_style_guide_key,
    g.value_label AS style_guide_label,
    NULL::uuid AS core_style_guide_id,
    a.original_file_name AS matched_file_name,
        CASE
            WHEN g.sku_sg_label_key IS NULL THEN style_guide_label_norm(g.value_label)
            ELSE NULLIF(g.sku_sg_label_key, ''::text)
        END AS style_guide_label_key
   FROM plm.sesame_asset a
     JOIN plm.sesame_asset_style_guide l ON l.capture_id = a.capture_id AND l.asset_source_id = a.asset_source_id
     JOIN plm.sesame_style_guide g ON g.capture_id = l.capture_id AND g.value_key = l.value_key
  WHERE btrim(a.original_file_name) <> ''::text;
revoke all on plm.asset_file_style_guide_keys from public, anon;
grant all privileges on plm.asset_file_style_guide_keys to service_role;
-- view plm.item_missing_attribution options={security_invoker=false,security_barrier=true} acl={postgres=arwdDxtm/postgres,service_role=arwd/postgres,authenticated=r/postgres}
create or replace view plm.item_missing_attribution with (security_invoker=false,security_barrier=true) as
 SELECT id,
    item_number,
    raw ->> 'companyCode'::text AS company_code,
    raw ->> 'divisionCode'::text AS division_code,
    licensor_id,
    property_id
   FROM plm.item item
  WHERE (licensor_id IS NULL OR property_id IS NULL) AND (COALESCE(raw ->> 'divisionCode'::text, ''::text) <> ALL (ARRAY['EH001'::text, 'EP001'::text])) AND plm.prepack_role(item_number, raw ->> 'companyCode'::text, raw ->> 'divisionCode'::text) IS NULL;
revoke all on plm.item_missing_attribution from public, anon;
grant all privileges on plm.item_missing_attribution to service_role;
grant select on plm.item_missing_attribution to authenticated;
-- view plm.opa_property_current_compliance options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=r/postgres}
create or replace view plm.opa_property_current_compliance with (security_invoker=true) as
 WITH eligible AS (
         SELECT m.membership_id,
            m.licensed_property_id,
            m.region_code,
            m.branch_code,
            m.line_of_business_id,
            m.product_type_code,
            m.template_id,
            m.workflow_id,
            m.capture_id,
            m.source_captured_at,
            m.approval_status,
            m.evidence_reference,
            m.evidence_sha256,
            m.approved_at,
            m.approved_by,
            m.created_at,
            m.compliance_status,
            m.compliance_capture_id,
            c.account_scope_sha256,
            row_number() OVER (PARTITION BY m.licensed_property_id, m.region_code, m.branch_code, m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id, c.account_scope_sha256 ORDER BY m.source_captured_at DESC, m.created_at DESC, m.membership_id DESC) AS observation_rank
           FROM plm.opa_property_scope_membership m
             LEFT JOIN plm.opa_property_compliance_capture c ON c.compliance_capture_id = m.compliance_capture_id
          WHERE m.approval_status = 'approved'::text AND (m.compliance_capture_id IS NULL OR c.status = 'complete'::text AND c.approval_status = 'approved'::text)
        )
 SELECT licensed_property_id,
    region_code,
    branch_code,
    line_of_business_id,
    product_type_code,
    template_id,
    workflow_id,
    account_scope_sha256,
    compliance_status,
    source_captured_at,
    capture_id,
    compliance_capture_id,
    membership_id,
    compliance_status = 'compliant'::text AS eligible_for_new_styles,
    compliance_status = 'compliant'::text AS eligible_for_new_coldlion_entry,
    (EXISTS ( SELECT 1
           FROM plm.opa_property_compliance_capture c
          WHERE c.status = 'complete'::text AND c.approval_status = 'approved'::text AND c.source_captured_at > e.source_captured_at AND c.region_code = e.region_code AND c.branch_code = e.branch_code AND c.line_of_business_id = e.line_of_business_id AND c.product_type_code = e.product_type_code AND c.template_id = e.template_id AND c.workflow_id = e.workflow_id AND c.account_scope_sha256 = e.account_scope_sha256 AND NOT (EXISTS ( SELECT 1
                   FROM plm.opa_property_scope_membership m
                  WHERE m.compliance_capture_id = c.compliance_capture_id AND m.licensed_property_id = e.licensed_property_id)))) AS absent_from_newer_complete_capture
   FROM eligible e
  WHERE observation_rank = 1;
revoke all on plm.opa_property_current_compliance from public, anon;
grant select on plm.opa_property_current_compliance to service_role;
-- view dflow.factory_canonical_identity options={security_invoker=true} acl=None
create or replace view dflow.factory_canonical_identity with (security_invoker=true) as
 SELECT f.id AS legacy_factory_id,
    r.factory_id AS core_factory_id
   FROM dflow."Factory" f
     LEFT JOIN core.factory_source_ref r ON r.source_system = 'designflow_plm'::text AND r.source_table = 'Factory'::text AND r.source_id = f.id::text;
revoke all on dflow.factory_canonical_identity from public, anon;
-- view api.licensing_entity_candidates options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
create or replace view api.licensing_entity_candidates with (security_invoker=true) as
 WITH opa AS MATERIALIZED (
         SELECT licensing_opa_observation_count.evidence_readable,
            licensing_opa_observation_count.licensed_property_id,
            licensing_opa_observation_count.observation_count
           FROM plm.licensing_opa_observation_count() licensing_opa_observation_count(evidence_readable, licensed_property_id, observation_count)
        ), opa_state AS (
         SELECT COALESCE(bool_or(o_1.evidence_readable) FILTER (WHERE o_1.licensed_property_id IS NULL), false) AS readable
           FROM opa o_1
        ), candidate AS (
         SELECT sr.source_system,
            sr.entity_kind,
            sr.source_id,
            sr.core_property_id,
            sr.core_character_id,
            sr.core_style_guide_id,
            sr.dam_asset_id,
            sr.resolution_status,
            sr.resolution_reason,
            sr.resolved_at,
            sr.resolved_by,
            sr.created_at,
            sr.updated_at,
            sr.core_licensor_id,
            sr.core_franchise_id,
                CASE
                    WHEN sr.source_system = 'disney_opa'::text AND sr.entity_kind = 'property'::text AND sr.source_id ~ '^-?[0-9]{1,19}$'::text AND sr.source_id::numeric >= '-9223372036854775808'::bigint::numeric AND sr.source_id::numeric <= '9223372036854775807'::bigint::numeric THEN sr.source_id::bigint
                    ELSE NULL::bigint
                END AS opa_property_id
           FROM plm.source_resolution sr
        )
 SELECT c.source_system,
    c.entity_kind,
    c.source_id,
    c.resolution_status,
    c.resolution_reason IS NOT NULL AS has_resolution_reason,
    c.core_property_id,
    c.core_character_id,
    c.core_style_guide_id,
    c.core_licensor_id,
    c.core_franchise_id,
    c.dam_asset_id,
    c.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text, 'deferred'::text]) AS is_open,
    c.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text]) AS needs_decision,
    c.resolution_status = 'ambiguous'::text AS is_ambiguous,
    scope.source_scope_by_licensor,
    c.opa_property_id IS NOT NULL AND s.readable AS opa_evidence_readable,
        CASE
            WHEN c.opa_property_id IS NOT NULL AND s.readable THEN COALESCE(o.observation_count, 0::bigint)
            ELSE NULL::bigint
        END AS opa_observation_count,
    c.resolved_at,
    c.resolved_by,
    c.created_at,
    c.updated_at
   FROM candidate c
     CROSS JOIN opa_state s
     LEFT JOIN opa o ON o.licensed_property_id = c.opa_property_id
     LEFT JOIN LATERAL ( SELECT COALESCE(jsonb_agg(jsonb_build_object('licensor_id', lss.licensor_id, 'source_purpose', lss.source_purpose, 'authorized', lss.authorized_at IS NOT NULL AND lss.authorized_by IS NOT NULL) ORDER BY lss.licensor_id, lss.source_purpose), '[]'::jsonb) AS source_scope_by_licensor
           FROM plm.licensing_source_scope lss
          WHERE lss.source_system = c.source_system AND lss.scope_axis = 'entity'::text AND lss.permitted_kind = c.entity_kind) scope ON true;
revoke all on api.licensing_entity_candidates from public, anon;
grant all privileges on api.licensing_entity_candidates to service_role;
grant select on api.licensing_entity_candidates to authenticated;
-- view api.licensing_relationship_candidates options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
create or replace view api.licensing_relationship_candidates with (security_invoker=true) as
 SELECT lrr.licensor_id,
    lrr.source_system,
    lrr.relationship_kind,
    lrr.source_left_id,
    lrr.source_right_id,
    lrr.resolution_status,
    lrr.resolution_reason IS NOT NULL AS has_resolution_reason,
    lrr.evidence_kind,
    lrr.is_direct_source_relationship,
    lrr.source_evidence IS NOT NULL AS has_source_evidence,
    lrr.core_property_id,
    lrr.core_character_id,
    lrr.core_style_guide_id,
    lrr.core_franchise_id,
    lrr.dam_asset_id,
    lrr.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text, 'deferred'::text]) AS is_open,
    lrr.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text]) AS needs_decision,
    lrr.resolution_status = 'ambiguous'::text AS is_ambiguous,
    lrr.evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind AND COALESCE(scope.relationship_evidence_permitted, false) AS eligible_for_match,
    scope.scope_row_count,
    scope.relationship_evidence_permitted,
    scope.source_purposes,
    lrr.resolved_at,
    lrr.resolved_by,
    lrr.created_at,
    lrr.updated_at
   FROM plm.licensing_relationship_resolution lrr
     LEFT JOIN LATERAL ( SELECT count(*) AS scope_row_count,
            COALESCE(bool_or(lss.source_purpose = 'relationship_evidence'::text AND lss.authorized_at IS NOT NULL AND lss.authorized_by IS NOT NULL), false) AS relationship_evidence_permitted,
            COALESCE(array_agg(DISTINCT lss.source_purpose ORDER BY lss.source_purpose), '{}'::text[]) AS source_purposes
           FROM plm.licensing_source_scope lss
          WHERE lss.licensor_id = lrr.licensor_id AND lss.source_system = lrr.source_system AND lss.scope_axis = 'relationship'::text AND lss.permitted_kind = lrr.relationship_kind) scope ON true;
revoke all on api.licensing_relationship_candidates from public, anon;
grant all privileges on api.licensing_relationship_candidates to service_role;
grant select on api.licensing_relationship_candidates to authenticated;
-- view api.licensing_resolution_queue options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
create or replace view api.licensing_resolution_queue with (security_invoker=true) as
 WITH entity_queue AS (
         SELECT 'entity'::text AS scope_axis,
            NULL::uuid AS licensor_id,
            sr.source_system,
            sr.entity_kind AS item_kind,
            sr.resolution_status,
            count(*) AS item_count,
            min(sr.created_at) AS oldest_created_at,
            max(sr.updated_at) AS latest_updated_at
           FROM plm.source_resolution sr
          WHERE sr.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text, 'deferred'::text])
          GROUP BY 'entity'::text, NULL::uuid, sr.source_system, sr.entity_kind, sr.resolution_status
        ), relationship_queue AS (
         SELECT 'relationship'::text AS scope_axis,
            lrr.licensor_id,
            lrr.source_system,
            lrr.relationship_kind AS item_kind,
            lrr.resolution_status,
            count(*) AS item_count,
            min(lrr.created_at) AS oldest_created_at,
            max(lrr.updated_at) AS latest_updated_at
           FROM plm.licensing_relationship_resolution lrr
          WHERE lrr.resolution_status = ANY (ARRAY['unresolved'::text, 'ambiguous'::text, 'deferred'::text])
          GROUP BY 'relationship'::text, lrr.licensor_id, lrr.source_system, lrr.relationship_kind, lrr.resolution_status
        )
 SELECT scope_axis,
    licensor_id,
    source_system,
    item_kind,
    resolution_status,
    item_count,
    resolution_status = 'ambiguous'::text AS is_ambiguous,
    oldest_created_at,
    latest_updated_at
   FROM ( SELECT entity_queue.scope_axis,
            entity_queue.licensor_id,
            entity_queue.source_system,
            entity_queue.item_kind,
            entity_queue.resolution_status,
            entity_queue.item_count,
            entity_queue.oldest_created_at,
            entity_queue.latest_updated_at
           FROM entity_queue
        UNION ALL
         SELECT relationship_queue.scope_axis,
            relationship_queue.licensor_id,
            relationship_queue.source_system,
            relationship_queue.item_kind,
            relationship_queue.resolution_status,
            relationship_queue.item_count,
            relationship_queue.oldest_created_at,
            relationship_queue.latest_updated_at
           FROM relationship_queue) q;
revoke all on api.licensing_resolution_queue from public, anon;
grant all privileges on api.licensing_resolution_queue to service_role;
grant select on api.licensing_resolution_queue to authenticated;
-- view api.pim_item_picker options={security_invoker=true} acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
create or replace view api.pim_item_picker with (security_invoker=true) as
 SELECT id AS item_id,
    source_system,
    source_id,
    item_number,
    description,
    raw ->> 'companyCode'::text AS company_code,
    raw ->> 'divisionCode'::text AS division_code
   FROM plm.item i
  WHERE source_system = 'coldlion'::text;
revoke all on api.pim_item_picker from public, anon;
grant all privileges on api.pim_item_picker to service_role;
grant select on api.pim_item_picker to authenticated;



