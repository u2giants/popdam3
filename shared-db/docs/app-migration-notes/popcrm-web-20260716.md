# POP CRM crm.* direct-write grants — 2026-07-16

## crm.* operational tables were missing DML grants to `authenticated`

What changed:
New migration `20260715220500_grant_crm_write_dml_to_authenticated.sql` runs
`grant insert, update, delete` to `authenticated` on the ten `crm.*`
operational tables that carry the baseline `crm_write` RLS policy:
`department`, `opportunity`, `opportunity_product`, `email_message`,
`meeting_note`, `note`, `task`, `ignore_rule`, `ai_model_config`,
`licensor_approval_thread`. It ends with `notify pgrst, 'reload schema'`.

Why:
popcrm-web Triage failed to create a department with
`permission denied for table department (42501)`. The baseline
`20260621151155_api_rls_realtime.sql` created the permissive `crm_write`
policy on these tables (the intended design — popcrm-web writes them directly
via supabase-js; see the header of `20260621151359_crm_api_rpcs.sql`), but its
grants block only ran `grant select on all tables in schema crm to
authenticated`. It never granted INSERT/UPDATE/DELETE. An RLS policy does not
confer table privileges: Postgres checks the table-level GRANT first, so every
direct browser write to `crm.*` fails with 42501 — department was simply the
first one exercised. No later migration filled the gap (the 2026-07-10 parity
reconcile, `20260710135985_reconcile_permission_parity.sql`, touched
`service_role` only).

`crm.ingested_domain` is intentionally excluded: it also carries `crm_write`,
but popcrm-web writes it only through the `record_ingested_domain` /
`promote_ingested_domain` RPCs, so it keeps its select-only grant.

Future sessions should:
When adding a new `crm.*` (or any schema's) table that a browser client writes
**directly** via supabase-js, remember RLS ≠ privilege: pair the `crm_write`
(or equivalent) policy with an explicit `grant insert, update, delete ... to
authenticated`. The baseline `grant select on all tables in schema crm`
covers reads only and does **not** apply to tables created afterward. If a
supabase-js write returns SQLSTATE 42501 `permission denied for table ...`,
this is the cause — a missing table GRANT, not RLS (an RLS rejection instead
reads `new row violates row-level security policy`). No popcrm-web code change
was needed; the app's direct-write path (`insertReturning`/`updateRow` in
`src/features/crm/api.ts`) is correct.

Affected apps:
POP CRM (popcrm-web). PM/PIM, DAM, and PLM write their own schemas, but any app
that writes shared `crm.*` tables directly depends on these grants.

## Workstream — apply + promote the crm DML grant

Status:
partial — authored and PR-open; not yet applied to preview or production.

Done:
- Migration written and committed on branch `claude/grant-crm-write-dml`.
- PR #79 (`u2giants/shared-db`) open; `validate` CI green; `scripts/check-sql.sh`
  passes (static checks).

Next action:
Per AGENTS.md §5 + §9, from a credentialed session: link to the preview project
`xjcyeuvzkhtzsheknaiu`, `supabase db push --dry-run` and confirm it lists ONLY
`20260715220500_grant_crm_write_dml_to_authenticated.sql`, apply, verify
`has_table_privilege('authenticated','crm.department','insert')` is true, then
merge PR #79 to `main` and promote to production in an approved window. The
Triage bug is not fixed for users until the production `supabase db push` lands.

Risks / watchouts:
- If the preview dry-run wants to apply other migrations too, preview is behind
  `main` — stop and serialize per AGENTS.md §4; do not ride unrelated changes in.
- Additive and idempotent; safe to re-run. Does not touch the in-flight ERP
  mirror relocation.
- Verification against the app (creating a department in Triage) still needs a
  human with the preview/production popcrm-web instance.
