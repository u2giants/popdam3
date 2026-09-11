# Step 2 — Data API access boundary, proven by catalog and HTTP

**Plan:** `plan_database_efficiency_and_api_security.md`, Step 2
**Tracking:** #2209 (closed after planning), executed under #2326
**Project (proved read-only immediately before every probe):** `https://qsllyeztdwjgirsysgai.supabase.co` (production shared Supabase)
**Captured:** 2026-09-10T00:29:17Z
**Privacy:** no row contents, no column values, and no credential values appear in this report. Every HTTP probe used `select=*&limit=0` with `Prefer: count=exact`, so each response body was the literal `[]` and only the `Content-Range` total was read. No write of any kind was issued.

---

## Layer 1 — exposed schemas (the fact Step 1 could not obtain)

Step 1 recorded that the PostgREST exposed-schema setting "was not visible through the SQL session" (`current_setting` returned NULL). It is obtainable directly from the API boundary instead: a request carrying an unexposed `Accept-Profile` is refused with `PGRST106`, and the refusal names the full list.

```
GET /rest/v1/sku_human_description?select=*&limit=0   Accept-Profile: dam    -> 406
{"code":"PGRST106", "hint":"Only the following schemas are exposed: public, graphql_public, api, crm, pim, core, app", "message":"Invalid schema: dam"}
```

**Exposed:** `public`, `graphql_public`, `api`, `crm`, `pim`, `core`, `app`.
**Not exposed, therefore unreachable over the Data API at any privilege:** `dam`, `dflow`, `dflow_prod`, `plm`.

Controls: `Accept-Profile: public` returns 200; `Accept-Profile: graphql_public` returns 404 `PGRST205` (schema exposed, table absent). The three answers are distinguishable, so a 406 is a real exposure refusal and not a malformed header.

**This retires a Step 1 open item.** The 2026-09-03 plan counted three RLS-disabled tables and described them as carrying `authenticated` DML privilege, without naming them. Step 1's own scan did **not** reproduce them (it found zero) and deferred the question to Step 2; the corrected `has_table_privilege` method used here is what surfaces them, which is itself an instance of the `information_schema` false negative recorded in Layer 2. All three — `dam.sku_human_description`, `dflow.item_user_assignment`, `dflow.item_workflow_action` — sit in unexposed schemas. Only `dam.sku_human_description` was probed over HTTP (406, below); the two `dflow` tables rest on the catalog fact that `dflow` is not in the exposed list, which is the same fact the 406 demonstrates. On that basis they are **not** a Data API exposure, but the HTTP demonstration covers one of the three, not all three. The census predicate recorded here is `SELECT`, and on that predicate all three carry `authenticated` `SELECT` and no `anon` privilege; this report does not present evidence of `INSERT`/`UPDATE`/`DELETE` on them, so the plan's "DML" wording is not carried forward as a finding of this step.

## Layer 2 — catalog grants (method correction)

`information_schema.role_table_grants` is the wrong source and fails silently: it shows only grants in which the querying identity is grantor, grantee, or a member. Queried that way, production appears to grant `anon`/`authenticated` nothing at all. The grants were therefore read with `has_table_privilege(role, oid, priv)` against `pg_class`.

Positive control: the corrected query returns 437 relations across nine schemas carrying `anon` or `authenticated` table privilege, against zero rows from `information_schema` for the same roles. The two sources disagree on the same question, and only one of them returns objects that HTTP probing then confirms are reachable, so the empty `information_schema` result is a false negative rather than a finding. **Limitation:** the querying role, its memberships, and a per-object granted/empty pair are not recorded here, so a later reader must re-run both queries rather than check the correction from this document alone.

Census, re-derived so that every figure below comes from one predicate — any `SELECT` privilege held by `anon` or `authenticated`, read with `has_table_privilege` against `pg_class`:

- **517** relations project-wide, across 14 schemas.
- **217** of those sit in the seven exposed schemas: 145 tables, 70 views (5 `public` + 65 `api`), 2 materialized views.
- **51** of those 217 carry `anon` `SELECT`.
- **4** are RLS-enabled with zero policies (all `public`, named in finding 1).
- **3** are the RLS-disabled tables above, all in unexposed schemas and therefore outside the 217.

An earlier draft of this section reported 437 relations of which 8 were views, from a query whose exact predicate was not recorded; those two figures are superseded by the census above and should not be cited.

## Layer 3 — RLS, policies, view semantics, function exposure

| Property | Result |
|---|---|
| RLS enabled, zero policies, API privilege | 4 tables (all `public`) |
| Views reachable by `anon`/`authenticated` | 5 in `public` and 65 in `api` (both exposed, so 70 — the figure in the Layer 2 census); 1 more in `dflow`, which is unexposed and therefore outside that census |
| `api` views by semantics | 49 `security_invoker=true`; 9 `security_invoker=false`; 7 unset (definer default) — 65 in total, matching the row above |
| Materialized views in an exposed schema | 2 (`public.style_guide_folders`, `public.style_guide_file_groups`) — RLS cannot apply to a materialized view |
| Functions executable by `anon` | 107 (38 of them `SECURITY DEFINER`) |
| Functions executable by `authenticated` | 205 (111 `SECURITY DEFINER`) |
| `SECURITY DEFINER` functions with a mutable search path | **0** |
| Trigger-returning functions carrying an `anon`/`authenticated` EXECUTE grant | 78 |

The 2026-09-03 advisor `function_search_path_mutable` family is **closed for security-definer functions**: every one of them pins `search_path`.

## Layer 4 — HTTP behaviour, three identities

Identities: anonymous (publishable key only); a CRM application test identity; and a **PopDAM viewer** — the lowest-privilege identity of a *different* application on the same project. Counts are totals reported by `Content-Range`; no row was fetched.

| Object | Class | anon | CRM test identity | DAM viewer |
|---|---|---|---|---|
| `public.properties` | control (RLS + policies) | 200, 0 | 206, 500 | 206, 500 |
| `public.no_such_table_xyz` | negative control | 404 | 404 | — |
| `public.dam_search_documents` | RLS on, 0 policies | 200, **0** | 200, **0** | — |
| `public.scanner_ai_ignores` | RLS on, 0 policies | 200, **0** | 200, **0** | — |
| `public.ai_sentinel_cleanup_log` | RLS on, 0 policies | 200, **0** | 200, **0** | — |
| `public.dam_search_synonyms` | RLS on, 0 policies | 200, **0** | 200, **0** | — |
| `public.style_guide_folders` | materialized view | 401 denied | 206, **384** | — |
| `public.style_guide_file_groups` | materialized view | 401 denied | 206, **22,045** | 206, **22,045** |
| `public.sg_archive_usage` | definer view | 401 denied | 206, **780** | — |
| `public.style_tracker_rows_with_bridge` | definer view | 401 denied | 206, **15,742** | 206, **15,742** |
| `public.style_tracker_audit_log_with_user` | definer view | 401 denied | 206, **12** | — |
| `public.dam_character_catalog` | invoker view | 401 denied (`42501` on `core.licensor`) | — | — |
| `api.crm_account_list` | definer view | — | 206, **826** | 206, **826** |
| `api.crm_customer_list` | definer view | — | — | 206, **826** |
| `api.crm_contact_list` | definer view, filters internally | — | 206, **8,783** | 200, **0** |
| `api.crm_opportunity_list` | invoker view | — | 200, **0** | — |
| `dam.sku_human_description` | unexposed schema | 406 | 406 | — |

---

## Findings against the 2026-09-03 advisor families

### 1. `rls_enabled_no_policy` — confirmed harmless today; the over-broad grant is retained as a finding

`public.ai_sentinel_cleanup_log`, `public.dam_search_documents`, `public.dam_search_synonyms`, and `public.scanner_ai_ignores` each hold RLS with no policy and full `SELECT/INSERT/UPDATE/DELETE` for **both** `anon` and `authenticated`. Every read returns count 0 for the **two identities tested** — anonymous and the CRM test identity — because RLS with no policy denies all. The DAM viewer was not probed against these four. **No unauthorized path was found on the identities tested**, and RLS-with-no-policy denies all by definition, so a third identity is not expected to differ; it was not demonstrated.

The grant itself is still wrong. The only thing between an anonymous caller and full DML on four tables is a policy set that happens to be empty; adding one permissive policy for an unrelated reason would open all four at once.

- Intended role: service/internal only. Intended operation: none from the browser.
- Current catalog state: `anon` + `authenticated` full DML, RLS on, zero policies.
- Actual HTTP outcome: denied (count 0) for every identity tested.
- Business owner: PopDAM and platform hygiene. Severity: **Medium** (defence in depth).
- Proposed remedy: revoke the `anon` and `authenticated` DML grants. Do not rely on the empty policy set as the control.

### 2. `security_definer_view` and `materialized_view_in_api` — **REPRODUCED**

Definer-semantics views and materialized views bypass RLS entirely. A **PopDAM viewer** — an identity belonging to a different application, holding the lowest role that application issues — reads across the application boundary:

- `api.crm_account_list` — **826** CRM accounts
- `api.crm_customer_list` — **826** CRM customers
- `public.style_tracker_rows_with_bridge` — **15,742** PLM style-tracker rows
- `public.style_guide_file_groups` — **22,045** style-guide file-group rows

The same identity gets **0** from `api.crm_contact_list`, a definer view that gates internally on `app.has_app_access('crm')`. (`api.crm_opportunity_list` returned 0 to the CRM test identity and was **not probed** with the DAM viewer; it is an invoker view, a different mechanism, and is not part of this comparison.) The boundary is therefore not merely permissive — it is **inconsistent**, and that inconsistency is what proves the probe discriminates rather than always succeeding.

Sixteen `api` views carry definer semantics while granting `SELECT` to `authenticated`: `crm_account_list`, `crm_contact_list`, `crm_contact_segment_counts`, `crm_contact_segment_list`, `crm_customer_list`, `crm_customer_picker_list`, `crm_factory_picker_list`, `crm_ingested_domain_list`, `dam_customer_list`, `dam_factory_list`, `opa_disney_property`, `opa_lucasfilm_property`, `opa_marvel_property`, `pm_customer_list`, `pm_factory_list`, `source_capture_inventory`. In `public`, five objects are in the same class: three definer views — `sg_archive_usage`, `style_tracker_audit_log_with_user`, `style_tracker_rows_with_bridge` — and the two materialized views `style_guide_folders` and `style_guide_file_groups`. (`public.dam_character_catalog` and `public.style_guide_file_tags_display` are reachable but carry invoker semantics, so RLS applies to them.)

- Intended role: each application's own users. Intended operation: `SELECT` scoped to that application.
- Current catalog state: definer semantics (or materialized, where RLS cannot apply) plus a blanket `authenticated` grant.
- Actual HTTP outcome: full-table counts returned to an out-of-application identity.
- Business owner: **Albert** for the access contract; CRM, PLM, and DAM for the implementation. Severity: **High**.
- Proposed remedy: per-object decision — set `security_invoker=true` and let the underlying RLS apply, add an explicit in-view caller filter as `crm_contact_list` already does, or narrow the grant to an application-specific role. Each is a shape change and goes through the orchestrator as its own governed claim.

Whether this is *unauthorized* is a business judgement about who should see CRM customer lists. The technical fact is settled: any authenticated identity on this project can.

### 3. Anonymous/authenticated security-definer execution — catalogued, not exercised

38 `SECURITY DEFINER` functions are executable by `anon` and 111 by `authenticated`. 78 trigger-returning functions carry an `anon`/`authenticated` EXECUTE grant; a trigger function is not meant to be an RPC, and each such grant is superfluous.

**NOT MEASURED, with cause:** exercising an RPC is a write-shaped call against production, and this session is read-only there. It needs preview fixtures. Carried forward explicitly rather than reported as clear.

### 4. `function_search_path_mutable` — closed for security-definer functions

Zero `SECURITY DEFINER` functions have a mutable search path.

### 5. Auth leaked-password protection

Untouched here. It is a platform setting rather than a migration and remains a separate owner decision, as the plan requires.

## Verification gate

- Every alleged exposure **that this report presents as a live finding** has both catalog and HTTP evidence — met. This does not extend to the function-execution grants in finding 3, which are catalog-only and are reported as NOT MEASURED rather than as exposures.
- Negative controls denied: unexposed schema 406; absent table 404; zero-policy tables count 0 on the two identities tested; anonymous access denied 401 on every `public` definer view and materialized view listed above. The `api` views were not probed anonymously, so no claim is made about anonymous access to them.
- Positive controls still work: `public.properties` returns the same non-zero count (500) to both authenticated identities while returning 0 to anonymous, so the probe distinguishes identities rather than always succeeding. No independent service-role count was taken, so 500 is the authenticated-visible count, not a demonstrated table cardinality. `Accept-Profile: public` succeeds.
- The report contains no row data and no credential values — met.
