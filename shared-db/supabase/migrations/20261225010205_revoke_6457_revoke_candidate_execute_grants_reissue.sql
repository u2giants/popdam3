-- #6457: revoke superfluous anon/authenticated EXECUTE on security-definer
-- functions dispositioned revoke-candidate by the #6416 SD-RPC matrix.
-- Part of the #2326 program (plan Step 6).
--
-- REISSUE of 20261218062459 (#6657 retirement note: "deliver separately
-- qualified grants under a fresh version"). That version is retired in
-- RETIRED_VERSION_REASONS (never applied anywhere) and this file carries its
-- FINAL qualified content: 36 revokes / 70 keeps, including the
-- public.resolve_coldlion_triage carve-out (guided-triage contract #5004).
--
-- WHY
-- ---
-- The #6416 measurement classified 107 "revoke-candidate" SD functions (no
-- application .rpc() caller). Contract-test analysis (2026-11-17) revealed
-- that most are exercised as authenticated by supabase/tests contract tests
-- (direct SQL calls, not supabase-js .rpc()). Only 36 have NO test coverage,
-- NO .rpc() caller, NO RLS/invoker chain, and NO contract-test privilege pin.
--
-- KEEP (70 unique names): 7 RLS/invoker-reachable + 62 contract-test-called/pinned
-- + `public.resolve_coldlion_triage` (carve-out, issue #6657: its creating
-- migration 20261029023554 deliberately revokes public/anon and grants
-- `to authenticated, service_role` for the guided-triage journey, pinned by
-- .github/live-proofs/5004.sql — the supabase/tests-only caller scan missed it).
-- REVOKE (36): truly unused surface.
--
-- ROLLBACK (named): forward migration re-granting for exactly the revoked
-- signatures listed in the evidence artifact.

begin;

do $$
declare
  r record;
  n integer := 0;
  remaining integer;
  leftover text;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'api.clickup_task_sync_run_list',
      'api.coldlion_parallel_observation_list',
      'api.coldlion_promotion_audit_list',
      'api.coldlion_promotion_quarantine_list',
      'api.crm_email_routing_segment_counts',
      'api.crm_overview_counts',
      'api.crm_overview_email_counts',
      'api.crm_overview_email_volume',
      'api.crm_overview_pending_approvals',
      'api.crm_overview_pipeline_stages',
      'api.crm_overview_recent_meetings',
      'api.crm_overview_recent_unrouted',
      'api.crm_update_account',
      'api.pm_cancel_product_comment_reservation',
      'api.pm_dismiss_activity_triage',
      'api.pm_get_activity_triage',
      'api.pm_list_active_jev_triage',
      'api.pm_list_reviewed_jev_triage',
      'api.pm_record_jev_suggestion_impression',
      'api.pm_recover_product_comment_handle',
      'api.pm_repair_comment_triage_queue',
      'api.pm_update_reminder_status',
      'api.pm_verify_jev_runtime_fence',
      'api.taxonomy_baseline_pin_list',
      'api.taxonomy_sync_alert_list',
      'api.vendor_exclusion_list',
      'api.vendor_quarantine_list',
      'api.vendor_sync_run_list',
      'public.add_style_guide_manual_tag',
      'public.bulk_assign_style_groups',
      'public.get_style_guide_deterministic_tag_batch',
      'public.rebuild_dam_search_documents',
      'public.reject_style_guide_auto_tag',
      'public.remove_style_guide_manual_tag',
      'public.replace_style_guide_deterministic_tags',
      'public.replace_style_guide_folder_consensus_tags'
    )
      and p.prosecdef
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))
    order by 1
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;

  raise notice 'revoked EXECUTE on % function(s) in the #6457 revoke set', n;

  select count(*), string_agg(format('%I.%I', n.nspname, p.proname), ', ')
    into remaining, leftover
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname in (
    'api.clickup_task_sync_run_list',
      'api.coldlion_parallel_observation_list',
      'api.coldlion_promotion_audit_list',
      'api.coldlion_promotion_quarantine_list',
      'api.crm_email_routing_segment_counts',
      'api.crm_overview_counts',
      'api.crm_overview_email_counts',
      'api.crm_overview_email_volume',
      'api.crm_overview_pending_approvals',
      'api.crm_overview_pipeline_stages',
      'api.crm_overview_recent_meetings',
      'api.crm_overview_recent_unrouted',
      'api.crm_update_account',
      'api.pm_cancel_product_comment_reservation',
      'api.pm_dismiss_activity_triage',
      'api.pm_get_activity_triage',
      'api.pm_list_active_jev_triage',
      'api.pm_list_reviewed_jev_triage',
      'api.pm_record_jev_suggestion_impression',
      'api.pm_recover_product_comment_handle',
      'api.pm_repair_comment_triage_queue',
      'api.pm_update_reminder_status',
      'api.pm_verify_jev_runtime_fence',
      'api.taxonomy_baseline_pin_list',
      'api.taxonomy_sync_alert_list',
      'api.vendor_exclusion_list',
      'api.vendor_quarantine_list',
      'api.vendor_sync_run_list',
      'public.add_style_guide_manual_tag',
      'public.bulk_assign_style_groups',
      'public.get_style_guide_deterministic_tag_batch',
      'public.rebuild_dam_search_documents',
      'public.reject_style_guide_auto_tag',
      'public.remove_style_guide_manual_tag',
      'public.replace_style_guide_deterministic_tags',
      'public.replace_style_guide_folder_consensus_tags'
  )
    and p.prosecdef
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('public', p.oid, 'EXECUTE'));

  if remaining > 0 then
    raise exception 'revoke-set functions still exposed after revoke: %', leftover;
  end if;

  raise notice 'kept (RLS/invoker + contract-test + triage carve-out): 70 names; revoke set: 36 names';
end
$$;

commit;
