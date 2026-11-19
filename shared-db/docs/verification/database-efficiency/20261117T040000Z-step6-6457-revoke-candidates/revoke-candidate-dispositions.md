---
summary: "#6457 dispositions: 36 revoke, 70 keep (RLS/invoker + contract-test-called + triage carve-out); authenticated probe leg obtained"
kind: proof
status: done
read-when: checking #6457 revoke-candidate dispositions or the contract-test KEEP rationale
---

# #6457 revoke-candidate disposition table — 2026-11-17 (final)

**Migration:** `20261225010205` (reissue; earlier `20261218062459` — Guard B re-date of the authored `20261218035022` — is retired, never applied) · **Claim:** #6652 (closed)

## Summary

| disposition | count |
|---|---|
| revoke | **36** |
| keep | **70** |
| total | **106 unique names / 107 signatures** |

## Method

1. Application `.rpc()` call-site search (from #6416 matrix).
2. SQL-internal caller analysis: pg_policies, pg_proc.prosrc, pg_views, ACLs.
3. **Contract-test scan** (the decisive step): grep `has_function_privilege` + function-call sites in `supabase/tests/` for each revoke target. **43 of 80 candidates are exercised as `authenticated` by contract tests** (direct SQL calls — the `.rpc()` grep missed these). These are intended RPCs.
4. Authenticated probe leg obtained 2026-11-17 (GoTrue invitation-seed + password grant).
5. Disposition: revoke ONLY if no `.rpc()` caller AND no RLS/invoker chain AND no contract-test call/pin.

## KEEP — three classes (70 names)

### RLS/invoker-reachable (7): `app.current_profile_id`, `app.has_role`, `app.has_any_role`, `app.has_explicit_app_access`, `public.has_role`, `public.assets_thumbnail_min_date`, `public.refresh_style_group_primaries`

### Contract-test-called or pinned (62): every function exercised by `supabase/tests` as `authenticated` or asserted to keep EXECUTE. Includes all CRM CRUD/admin RPCs, all `pm_*` triage RPCs, all `db_data_admin_*` RPCs, DAM order RPCs, semantic-anchor RPCs, `source_capture_inventory_exact`, `approve_licensor_alias`, and the `popsg`/`alias`/`filter`/`expand` set.

### Live-proof-pinned carve-out (1): `public.resolve_coldlion_triage` — its creating migration 20261029023554 deliberately does `revoke all … from public, anon` then `grant execute … to authenticated, service_role` for the guided-triage journey (`v_actor := auth.uid()`), and `.github/live-proofs/5004.sql` asserts `authenticated` can execute and `anon` cannot. The supabase/tests-only caller scan missed it because the pin lives in live-proofs (issue #6657); removed from the revoke set by the 2026-11-18 fix-forward.

## REVOKE (36 names)

Truly unused surface — no `.rpc()` caller, no RLS/invoker chain, no contract-test or live-proof coverage:

`api.clickup_task_sync_run_list`, `api.coldlion_parallel_observation_list`, `api.coldlion_promotion_audit_list`, `api.coldlion_promotion_quarantine_list`, `api.crm_email_routing_segment_counts`, `api.crm_overview_counts`, `api.crm_overview_email_counts`, `api.crm_overview_email_volume`, `api.crm_overview_pending_approvals`, `api.crm_overview_pipeline_stages`, `api.crm_overview_recent_meetings`, `api.crm_overview_recent_unrouted`, `api.crm_update_account`, `api.pm_cancel_product_comment_reservation`, `api.pm_dismiss_activity_triage`, `api.pm_get_activity_triage`, `api.pm_list_active_jev_triage`, `api.pm_list_reviewed_jev_triage`, `api.pm_record_jev_suggestion_impression`, `api.pm_recover_product_comment_handle`, `api.pm_repair_comment_triage_queue`, `api.pm_update_reminder_status`, `api.pm_verify_jev_runtime_fence`, `api.taxonomy_baseline_pin_list`, `api.taxonomy_sync_alert_list`, `api.vendor_exclusion_list`, `api.vendor_quarantine_list`, `api.vendor_sync_run_list`, `public.add_style_guide_manual_tag`, `public.bulk_assign_style_groups`, `public.get_style_guide_deterministic_tag_batch`, `public.rebuild_dam_search_documents`, `public.reject_style_guide_auto_tag`, `public.remove_style_guide_manual_tag`, `public.replace_style_guide_deterministic_tags`, `public.replace_style_guide_folder_consensus_tags`

## Key finding

The #6416 matrix's `.rpc()` call-site search **under-signaled**: contract tests exercise ~43 of the 107 revoke-candidates as `authenticated` via direct SQL (`perform api.fn(...)`), not via supabase-js `.rpc()`. A `.rpc()` grep alone is insufficient for dispositioning; the contract-test scan is the decisive evidence class.

Posted by MiMo chat ses_ffe5e136 on edge-dev
