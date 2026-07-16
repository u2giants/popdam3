-- Grant DML on the crm.* operational tables to the authenticated role.
--
-- Root cause: the baseline (20260621151155_api_rls_realtime.sql) created a
-- permissive `crm_write` RLS policy on the crm.* operational tables so that
-- administrator/sales/licensing users can write them directly from popcrm-web
-- (that is the stated design — see the header of 20260621151359_crm_api_rpcs.sql),
-- but the grants section only ran:
--
--   grant select on all tables in schema crm to authenticated;
--
-- An RLS policy alone does not confer table privileges: Postgres checks the
-- table-level GRANT first, so every direct write from the browser fails with
-- `permission denied for table ...` (SQLSTATE 42501). Reported in production
-- on 2026-07-15 when popcrm-web Triage tried to create a crm.department row.
--
-- Fix: grant INSERT/UPDATE/DELETE on exactly the tables that carry the
-- baseline `crm_write` policy. RLS still gates every row (crm_write limits
-- writes to administrator/sales/licensing); this only supplies the table
-- privilege the policy assumes. Additive and idempotent.
--
-- crm.ingested_domain is intentionally excluded: it also carries crm_write,
-- but the app writes it only through the record/promote RPCs, so it keeps
-- its select-only grant.

grant insert, update, delete on
  crm.department,
  crm.opportunity,
  crm.opportunity_product,
  crm.email_message,
  crm.meeting_note,
  crm.note,
  crm.task,
  crm.ignore_rule,
  crm.ai_model_config,
  crm.licensor_approval_thread
to authenticated;

-- PostgREST caches table privileges in its schema cache.
notify pgrst, 'reload schema';
