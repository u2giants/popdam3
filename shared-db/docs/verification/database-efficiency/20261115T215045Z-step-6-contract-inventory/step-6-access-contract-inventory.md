---
summary: "Step 6 inventory 2026-11-15: findings 1-2 resolved except matviews; remainder in #6415/#6416/#6418; leaked-password the one owner decision"
kind: proof
status: done
read-when: checking what Step 6 of plan_database_efficiency_and_api_security.md already resolved, what the three open hardening issues own, or the per-object access disposition
---

# Step 6 access-contract inventory — 2026-11-15

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 6 (Phase D) / #2326
**Recorded:** 2026-11-15 (4:50 PM EST)
**Session:** MiMo chat ses_ffe5e1ee on edge-dev

## What this document is

Step 6 hardens RLS, policies, views, functions and Auth **by contract, grouped by business
contract, not advisor rule**. This inventory is the dated grouping: which contract objects were
already remediated (with provenance), which remain open (now split into their own `db-work`
issues), and which advisor families are deliberately deferred with rationale. All live checks
below are Supabase Management API `database/query` with `read_only: true` on production,
2026-11-15; no row contents, no credentials, no preview ref.

Baseline for the comparison is the Step 2 access matrix
(`docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md`).

## Disposition by Step 2 finding

### Finding 1 — `rls_enabled_no_policy` over-broad grants: RESOLVED (live-verified)

The four `public` tables (`ai_sentinel_cleanup_log`, `dam_search_documents`,
`dam_search_synonyms`, `scanner_ai_ignores`) held full `anon`/`authenticated` DML behind an
empty policy set. Live catalog 2026-11-15: **zero** `anon`/`authenticated` privilege remains on
`SELECT`/`INSERT`/`UPDATE`/`DELETE` for all four (`has_table_privilege` re-check; the DEFENCE-IN-DEPTH
remedy the matrix proposed — revoke the grants — has landed at some point between 2026-09-10 and
2026-11-15). `dam_search_documents` also carries `fillfactor=75` (#2196 landed). No further issue.

### Finding 2 — security-definer views and materialized views: RESOLVED except the two matviews

The 2026-09-10 reproduced cross-app reads (PopDAM viewer → 826 CRM accounts/customers,
15,742 style-tracker rows, 22,045 file-group rows) have been closed object by object. Per-object
state re-verified live 2026-11-15:

| Object (2026-09-10 list) | Disposition | Provenance |
|---|---|---|
| `api.crm_account_list`, `api.crm_customer_list` | definer retained + `app.has_app_access('crm')` caller gate | `20260911124746_crm_definer_views_caller_gate.sql` (#2662 batch 1) |
| `api.crm_contact_list` | already definer + internal `has_app_access('crm')` gate | pre-existing |
| `api.crm_ingested_domain_list`, `api.crm_contact_segment_list`, `api.crm_contact_segment_counts`, `public.sg_archive_usage` | flipped to `security_invoker = true` | `20260911124746` |
| `api.crm_customer_picker_list`, `api.pm_customer_list`, `api.crm_factory_picker_list` | gated serving contracts (`has_explicit_app_access`), security-barrier definer by design | `20260723223000_protect_app_picker_serving_contracts.sql` |
| `api.dam_customer_list`, `api.dam_factory_list` | live definitions carry `has_app_access` gate (re-verified 2026-11-15) | later app-gate migration |
| `api.opa_disney_property`, `api.opa_lucasfilm_property`, `api.opa_marvel_property`, `api.pm_factory_list`, `api.source_capture_inventory` | `authenticated` SELECT grant **removed** (live: no `anon`/`authenticated` SELECT) | #2662 grant-boundary family (production apply `20261008211322`, live-verified in the #2662 completion record) |
| `public.style_tracker_audit_log_with_user` | accepted intentional (own-user/admin visibility preserved) | #3327 closed |
| `public.style_tracker_rows_with_bridge` | accepted intended projection, permissions unchanged | #3328 closed |
| `public.style_guide_folders`, `public.style_guide_file_groups` (matviews) | **OPEN** — see #6418 | this split |

The matviews cannot gate per caller (stored snapshot; RLS cannot apply). Live 2026-11-15: both
still grant `SELECT` to `authenticated` (and carry meaningless `INSERT` grants). Filed as
**#6418** with the census-first disposition rule (single-app ⇒ narrow grant / gated projection;
multi-app ⇒ explicit accepted contract raised as a business question).

### Finding 3 — function EXECUTE surface: OPEN, split into two issues

- **Trigger-returning functions** carrying `anon`/`authenticated` EXECUTE: live count **133**
  outside `auth`/`extensions` (was 78 on 2026-09-10 — the surface grew). Each grant is
  superfluous (a trigger function is not an RPC). Filed as **#6415** (revoke; rollback =
  re-grant list pinned in the implementing PR).
- **Security-definer functions** callable by `anon`/`authenticated`: live count **204**
  non-trigger (`prosecdef`) outside `auth`/`extensions` (was 38+111). Direct RPC behavior is
  still the Step 2 **NOT MEASURED** item (production is read-only for these sessions). Filed as
  **#6416** (preview-fixture measurement with per-function disposition: intended RPC / superfluous
  grant / unsafe-callable).

### Finding 4 — mutable function search paths: CLOSED (pre-existing)

Zero security-definer functions have a mutable search path (Step 2; unchanged since).

### Finding 5 — Auth leaked-password protection: RETAINED OWNER DECISION

A platform setting, not a migration. The plan reserves this exact change for Albert's explicit
authorization after plan-tier and user-impact evidence. Carried in the Step 7+ handoff as the
program's one business question — not raised as an approval request, and not actioned.

## Other Step 6 plan bullets

- **Request-constant auth helpers / RLS initplan repair:** DONE, out of scope here —
  `plan_rls_request_constant_checks.md` (#4421) closed 2026-11-05 with all six families
  live-proven (production certificate 40826924347). Do not redo.
- **Permissive-policy consolidation (125 `multiple_permissive_policies` notices):** deferred with
  date (2026-11-15), not dropped. The plan allows consolidation only where the OR-union of
  commands/roles/USING/WITH CHECK is provably identical; each consolidation needs an equivalence
  truth table. No measured cost driver remains after the #4421 repair (the initplan fix delivered
  the perf win this family was guarding). Re-opens only with a measured driver or a concrete
  correctness need.
- **RLS predicate-column indexes:** no change. The plan's criterion is "representative plans show
  repeated scanning"; neither pgss window (2026-09-04 top-300, 2026-11-06..13 top-80) shows such
  a scan pattern. Re-opens with plan evidence.

## Step 6 remainder, in dependency order

1. **#6415** — revoke 133 trigger-function EXECUTE grants (mechanical, rollback = pinned re-grant list).
2. **#6416** — preview-fixture RPC measurement of the 204 security-definer functions (private-evidence class; feeds follow-up revoke/remediate issues).
3. **#6418** — matview API surface contract (census first; needs-evidence until the app-reference census lands).

Each issue carries exact objects (or the pinning query), named rollback, and preview proof.
After these three land (and any follow-ups they spawn), Step 6's gate — every advisor finding
resolved or explicitly accepted with rationale; negative and positive access tests pass; no
application loses intended access — can be certified. Until then the STATUS row stays advanced,
not done.

## Anti-collision check performed 2026-11-15

No open `db-claim` names `public.style_guide_folders`, `public.style_guide_file_groups`, or the
function-grant surface; #6356's nine claim blocks and the `20261113223432` side_rows work
(#6335/#6346) are disjoint from these objects. The 133-function list moves — the implementing PR
must pin it fresh and claim before writing.
