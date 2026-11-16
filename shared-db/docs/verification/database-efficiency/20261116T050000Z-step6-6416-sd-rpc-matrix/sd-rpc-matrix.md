---
summary: "#6416 SD-RPC matrix on preview: 201 functions dispositioned (76 intended, 17 revoke, 1 remediate, 107 revoke-candidates); authenticated leg blocked by preview GoTrue"
kind: proof
status: done
read-when: checking the #6416 security-definer RPC measurement, per-function dispositions, or the Step 2 NOT MEASURED closure in plan_database_efficiency_and_api_security.md
---

# #6416 security-definer RPC measurement — preview — 2026-11-15/16

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 6 / popcre/shared-db #6416 (claim on the issue)
**Recorded:** 2026-11-15 11:45 PM EST – 2026-11-16 12:40 AM EST
**Session:** MiMo chat ses_ffe5e1ec on edge-dev
**Scope:** every SECURITY DEFINER non-trigger function carrying `anon`/`authenticated` EXECUTE
(live pin 2026-11-15: **201** — the issue pinned 204; the list moves). Measurement only: preview
Data API, status codes only, no row contents, no production call, no credentials in this artifact.

## Method

1. **Catalog pin** (read-only, Management API): the issue's query. 201 functions —
   `api` 94, `public` 86, `plm` 7, `dflow_prod` 6, `app` 5, `net` 2, `dam` 1;
   16 carry `anon` EXECUTE, 185 `authenticated` only. Raw: `q-sd-census.json`.
2. **HTTP probe matrix (anon identity)** — `POST /rest/v1/rpc/<name>` with `{}` against the
   preview Data API (publishable key; status codes only) for the **185** functions in
   PostgREST-exposed schemas (`pgrst.db_schemas` live: `public, graphql_public, api, crm, pim,
   core, app`). Raw: `q-sd-probe-anon.json`. Outcomes: 150 × 404 (signature/no-match for empty
   args), 30 × 401, 4 × 300 (overload-ambiguous: `cleanup_mega_group_tags_batch`,
   `retry_sg_render_errors`), 1 × 400 (**`rls_auto_enable()` — executes and errors with empty
   args**).
3. **Application-reference search** — `.rpc('<name>')` call sites in popdam3 (94 names),
   poppim-web (20), popcrm (18), pop-mock (9), popdam (0), dflow_plm (0).
4. **Disposition rules (dated, mechanical):** not-in-exposed-schema → `revoke` (superfluous
   API-role grant; same class as #6415); event-trigger function → `revoke`; probe 400 →
   `remediate`; app `.rpc()` caller found → `intended` (app named); otherwise → `revoke-candidate`
   (no caller found in the searched repos).

## Results

| disposition | count |
|---|---|
| intended RPC (application caller named) | **76** |
| revoke (non-exposed schema or event-trigger fn) | **17** |
| remediate (empty-arg callable, errors) | **1** (`rls_auto_enable()`) |
| revoke-candidate (no application caller found) | **107** |

## Boundaries (explicit)

1. **The `authenticated` HTTP leg is NOT obtained.** Preview GoTrue refuses admin user creation
   with HTTP 500 `P0001` (a raise from the preview `auth.users` trigger chain — itself worth a
   separate look), the stored preview test logins pin a previous preview project
   (`invalid_credentials`), and a minted JWT is rejected at the auth layer (the 1Password item's
   JWT secret appears stale). The catalog layer covers the privilege fact for both roles; the
   107 `revoke-candidate` dispositions are therefore dated as "no caller found + authenticated
   leg not obtained" and the follow-up issue re-runs the matrix when an `authenticated` identity
   is obtainable.
2. **Empty-args probing under-signals.** A 404 means no PostgREST signature match for `{}` —
   NOT a refusal proof for a correctly-argued call. The `intended`/`revoke-candidate` split is
   driven by the application-reference search, not the status code.
3. **The 16 non-exposed-schema functions** (`plm`, `dflow_prod`, `dam`, `net`) cannot be reached
   through the Data API at all (`pgrst.db_schemas`); their API-role grants are superfluous but
   SQL-level callers (service_role/postgres) are unaffected by an API-role revoke.

## Follow-up issues (filed from this artifact)

- Revoke class (17 + the event-trigger function): one `db-work` issue, same shape as #6415.
- Remediate class (`rls_auto_enable()`): one `db-work` issue.
- Revoke-candidate class (107): one `db-work` issue gated on re-running the matrix with an
  `authenticated` identity, then per-function revoke/keep with named callers.

## Per-function disposition table

| function | schema | anon | auth | anon probe | disposition | why |
|---|---|---|---|---|---|---|
| `api.clickup_task_sync_run_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.coldlion_licensor_property_run_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.coldlion_parallel_observation_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.coldlion_promotion_audit_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.coldlion_promotion_quarantine_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_access_history(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_assign_departments(uuid[],uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_department_assignments()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_role_list()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_set_app_access(uuid,text,boolean)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_set_department_salespeople(uuid[],uuid[])` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_set_user_roles(uuid,text[])` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.crm_admin_set_user_status(uuid,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_admin_user_directory()` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.crm_admin_user_list()` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_archive_contact(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_archive_customer(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_archive_opportunity(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_create_contact(text,text,text,text,uuid,uuid,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_create_customer(text,text,text,text,text,text)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_customer_segment_counts()` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_customer_segment_list(text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_email_routing_recent(integer)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_email_routing_segment_counts()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_email_routing_stage_counts()` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_email_routing_stage_page(text,integer,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_merge_contacts(uuid,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_counts()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_email_counts()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_email_volume(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_pending_approvals(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_pipeline_stages()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_recent_meetings(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_overview_recent_unrouted(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_set_customer_logo(uuid,text)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_set_opportunity_stage(uuid,text)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_update_account(uuid,text,text,text,text,text,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.crm_update_contact(uuid,text,text,text,text,text,text,uuid,uuid,text,text,boolean,boolean,boolean,boolean)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_update_customer(uuid,text,text,text,text,text,text,text,boolean)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.crm_update_ingested_domain(uuid,text)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.current_user_profile()` | api | no | yes | 404 | **intended** | application RPC caller: poppim_web, popcrm |
| `api.db_data_admin_audit_list(text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_channel_list()` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_customer_detail(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_grid_state_get(text,text)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_grid_state_upsert(text,text,jsonb,bigint)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_licensor_property_list(text,boolean,text,integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_licensor_property_tree(text,boolean,text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_preview_customer_merge(uuid,uuid)` | api | no | yes | 404 | **intended** | application RPC caller: popcrm |
| `api.db_data_admin_preview_vendor_merge(uuid,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_product_depth_list(text,boolean,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_property_match_queue(text,text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_scraped_properties(text,text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_scraped_source_inventory(text,text,text,integer)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_set_product_depth_status(uuid,text,uuid,text,timestamp with time zone)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamp with time zone)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_update_customer(uuid,timestamp with time zone,uuid,text,text,text,text,text,uuid[])` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_update_vendor(uuid,timestamp with time zone,uuid,text,text,text,text,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_upsert_product_depth(uuid,text,text,text,uuid,timestamp with time zone)` | api | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `api.db_data_admin_vendor_detail(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.db_data_admin_vendor_list(text,text,text,text,boolean,text,text,text,integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_accept_activity_triage(uuid,text,text,text,date)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_add_product_comment(uuid,text,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_begin_activity_triage(uuid,text,text,text,text,jsonb,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_cancel_product_comment_reservation(text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_complete_activity_triage(uuid,text,text,jsonb,jsonb,jsonb,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_create_decision(uuid,text,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_create_dependency(uuid,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_create_reminder(uuid,text,date)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_dismiss_activity_triage(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_fail_activity_triage(uuid,text,text,jsonb,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_get_activity_triage(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_list_active_jev_triage()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_list_reviewed_jev_triage()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_record_jev_suggestion_impression(uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_recover_product_comment_handle(text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_repair_comment_triage_queue()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_reserve_product_comment_operation(uuid,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_update_dependency_status(uuid,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_update_reminder_status(uuid,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.pm_verify_jev_runtime_fence(uuid,text,text,integer,timestamp with time zone,text,text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.source_capture_inventory_exact(text)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.taxonomy_baseline_pin_list(text,boolean)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.taxonomy_sync_alert_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.vendor_exclusion_list()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.vendor_quarantine_list()` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `api.vendor_sync_run_list(integer)` | api | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `app.current_profile_id()` | app | yes | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `app.has_any_role(app.app_role[])` | app | yes | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `app.has_app_access(app.app_name)` | app | yes | yes | 404 | **intended** | application RPC caller: popdam3 |
| `app.has_explicit_app_access(app.app_name)` | app | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `app.has_role(app.app_role)` | app | yes | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `dam.orderlist_sales_order_received_date(text)` | dam | no | yes | n/a | **revoke** | schema dam is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.claim_sample_shipment_notice(bigint)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)` | dflow_prod | yes | yes | n/a | **revoke** | schema dflow_prod is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `net.http_get(text,jsonb,jsonb,integer)` | net | yes | yes | n/a | **revoke** | schema net is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `net.http_post(text,jsonb,jsonb,jsonb,integer)` | net | yes | yes | n/a | **revoke** | schema net is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.coldlion_merch_group_candidates(text,text)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.latest_sesame_capture()` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.prepack_role(text,text,text)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)` | plm | no | yes | n/a | **revoke** | schema plm is not in pgrst.db_schemas - not Data-API reachable; API-role grant is superfluous |
| `activate_popsg_property_decision_batch(text,text,integer)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `add_style_guide_manual_tag(uuid,text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `add_style_tracker_rows(text,text,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `approve_licensor_alias(text,text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `assets_thumbnail_min_date()` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `bulk_assign_style_groups(jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `bulk_insert_pdf_text_samples(jsonb)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `claim_jobs(text,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `claim_pdf_backfill_batch(integer)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `claim_render_jobs(text,integer,integer,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `claim_tiff_jobs(text,integer,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `cleanup_mega_group_tags_batch()` | public | no | yes | 300 | **intended** | application RPC caller: popdam3 |
| `cleanup_mega_group_tags_batch(uuid,integer,integer)` | public | no | yes | 300 | **intended** | application RPC caller: popdam3 |
| `clear_style_group_batch(uuid,integer)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `count_pdf_backfill_remaining()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `create_dam_order(jsonb,jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `dam_resolve_customer(text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `dam_search_semantic_anchor(extensions.vector,text[])` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[])` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `dam_search_semantic_anchors(extensions.vector,extensions.vector,text[])` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `delete_style_tracker_rows(uuid[])` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `expand_dam_search_queries(text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `find_ai_pdf_duplicates()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_ai_sentinel_stats()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_dam_asset_taxonomy_counts()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_dam_customer_facets()` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `get_dam_order_assortment_quantities(uuid[])` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `get_dam_order_sales_order_dates(uuid[])` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `get_dam_order_vendor_ids(uuid[])` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `get_dam_style_group_asset_count(jsonb,timestamp with time zone,uuid[],text[])` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `get_effective_filter_counts(jsonb)` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `get_filter_counts(jsonb)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3, pop_mock |
| `get_path_facets(uuid)` | public | no | yes | 401 | **intended** | application RPC caller: pop_mock |
| `get_sg_preview_stats()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_sg_render_queue_stats()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_style_guide_deterministic_tag_batch(uuid,integer,boolean)` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `get_style_guide_deterministic_tag_batch_v2(uuid,integer,boolean)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `get_style_guide_tagging_stats()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `has_app_access(uuid,app_name)` | public | yes | yes | 404 | **intended** | application RPC caller: popdam3 |
| `has_role(uuid,app_role)` | public | yes | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `link_dam_order_line(uuid,uuid,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `list_licensor_aliases()` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `lock_down_new_public_function_execute()` | public | yes | yes | 401 | **revoke** | event-trigger function (not an RPC); same class as #6415 trigger-function grants |
| `promote_property_alias_batch(uuid,text,text,boolean,text,text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `propagate_group_tags_batch(uuid,integer)` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `rebuild_dam_search_documents()` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `rebuild_style_groups_batch(uuid,integer)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `reconcile_style_group_stats_batch(uuid,integer,text)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `refresh_dam_search_asset_document(uuid)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `refresh_dam_search_style_group_document(uuid)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `refresh_style_group_counts()` | public | no | yes | 401 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `refresh_style_group_counts_batch(uuid[])` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `refresh_style_group_primaries(uuid[])` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `refresh_style_group_rich_metadata(uuid)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `refresh_style_guide_folder_consensus_batch(text,integer,text)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `refresh_style_tracker_item_bridge()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `reject_style_guide_auto_tag(uuid,uuid)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `remove_style_guide_manual_tag(uuid,uuid)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `replace_style_guide_deterministic_tags(uuid,jsonb,text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `replace_style_guide_folder_consensus_tags(uuid,jsonb,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `requeue_all_failed_sg_jobs(integer)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `require_dam_access()` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `reset_stale_jobs(integer)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `resolve_coldlion_triage(uuid,text,uuid)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `resolve_licensor_alias(text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `retry_sg_render_errors(uuid[])` | public | no | yes | 300 | **intended** | application RPC caller: popdam3 |
| `retry_sg_render_errors(uuid[],integer)` | public | no | yes | 300 | **intended** | application RPC caller: popdam3 |
| `rls_auto_enable()` | public | yes | yes | 400 | **remediate** | callable with empty args and errors (400) - review what an unauthenticated/empty-arg call does |
| `search_assets_full_text(text,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3, pop_mock |
| `search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `search_dam_image_similarity(extensions.halfvec,extensions.halfvec,numeric,numeric,integer,integer,text[])` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `search_style_groups_full_text(text,integer)` | public | no | yes | 404 | **intended** | application RPC caller: pop_mock |
| `search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamp with time zone,timestamp with time zone,text,integer,integer,extensions.vector,real,text,boolean)` | public | no | yes | 401 | **intended** | application RPC caller: popdam3 |
| `search_style_tracker_link_candidates(text,text,integer,text)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `set_popdam_item_dismissed(text[],boolean)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |
| `set_style_group_cover(uuid,uuid)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3, pop_mock |
| `update_bulk_operation(text,jsonb,text,bigint,text,integer)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3, pop_mock |
| `update_bulk_operations_batch(jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `update_dam_order(uuid,jsonb,jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `update_dam_order_tracking(uuid,jsonb)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `upsert_dam_order_customer_settings(text,text)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `upsert_dam_order_sample_depth(text,text,numeric)` | public | no | yes | 404 | **revoke-candidate** | no application .rpc() caller found in the searched repos; HTTP matrix leg (authenticated) not obtained |
| `upsert_style_tracker_value_resolution(text,text,text,text,text,uuid,text,text)` | public | no | yes | 404 | **intended** | application RPC caller: popdam3 |

Posted by MiMo chat ses_ffe5e1ec on edge-dev
