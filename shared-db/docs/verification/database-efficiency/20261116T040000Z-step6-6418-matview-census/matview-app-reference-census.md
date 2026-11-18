---
summary: "#6418 app-reference census: only PopDAM reads the style-guide matviews directly (browser as authenticated); single-app, gated projection prescribed"
kind: proof
status: done
read-when: checking who reads public.style_guide_folders / public.style_guide_file_groups across application repos, or the #6418 disposition decision
---

# #6418 app-reference census — style-guide matviews — 2026-11-15

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 6 / popcre/shared-db #6418 (claim #6450)
**Recorded:** 2026-11-15 9:00 PM EST – 11:30 PM EST
**Session:** MiMo chat ses_ffe5e1ec on edge-dev
**Scope:** direct reads of `public.style_guide_folders` and `public.style_guide_file_groups`
(materialized views in an exposed schema) across every application repository available on
edge-dev and on GitHub. No credentials, no preview project ref in this artifact.

## Method

1. Local ripgrep of every application checkout on edge-dev — `popdam3`, `popdam`, `poppim-web`,
   `popcrm`, `dflow_plm`, `pop-mock`, `oracle`, `monitor` — for `style_guide_file_groups` /
   `style_guide_folders`, excluding each repo's `shared-db/` mirror and `node_modules`.
2. GitHub code search (`gh search code`) across `popcre` for the same names (results were
   shared-db's own migrations/docs and their consumer-repo mirrors).
3. Live catalog (read-only, Management API): which functions/views reference the two names
   (`prosrc` / `pg_get_viewdef` search) — exactly one function, no views.
4. Prior HTTP probe evidence: `docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md`
   Layer 4 (identities: anon / CRM test identity / PopDAM viewer).

## Findings

| Repo | Direct reads? | Evidence |
|---|---|---|
| **popdam3** | **YES — the only application** | `src/pages/popsg/PopSGLibraryPage.tsx` lines 214, 779, 816: `.from("style_guide_file_groups")` and `.from("style_guide_folders")` — browser PostgREST reads as `authenticated`. Also `scripts/popsg-readiness-baseline.mjs` lines 69–70 (Node script, `SUPABASE_SERVICE_ROLE_KEY` — service role, unaffected by authenticated grant narrowing). |
| popdam | no | zero hits outside nothing |
| poppim-web | no | only `src/lib/database.types.ts` (generated types; no query) |
| popcrm | no | only generated `database.types.ts` for OTHER relations (`pmt_style_guides`, `style_guide` table) |
| dflow_plm, pop-mock, oracle, monitor | no | zero hits |
| shared-db (migrations/docs) | n/a | the owner repo: `20260618143000`, `20260905104802`, `20260917005221`, `20260928003740`, `20260929040458`, `20260930185929`, `20261027012301` — all about the matviews themselves / the refresh function |

**Live reference graph (production, read-only 2026-11-15):** exactly one function references the
names — `public.refresh_style_guide_matviews` (SECURITY DEFINER; its two `REFRESH MATERIALIZED
VIEW CONCURRENTLY` statements). No view references either name.

**Cross-app reads are possible but not application reads.** The 2026-09-10 HTTP probe (Layer 4)
shows a **CRM test identity** reading 384 `style_guide_folders` rows and 22,045
`style_guide_file_groups` rows — that is any `authenticated` identity crossing the app boundary
(the finding), **not** the CRM application reading them. The probe's own narrative treats the
matviews as cross-app readable "through definer semantics or materialized views", the same class
as `api.crm_account_list`.

## Disposition (the issue's rule, applied)

- **Single application reads them** (PopDAM) → grant narrowing.
- **PopDAM's browser reads them directly as `authenticated`** → replace the direct read with a
  caller-gated projection over the matview (the #2662 pattern) and narrow the matview grant.
- Because the gated projection takes over the **exact REST relation names**, PopDAM's code does
  not change and no application loses intended access (the issue's acceptance).

Owner question NOT raised: the census did not find a genuine multi-app consumer, so the
conditional "who may see DAM style-guide structure cross-app" business call does not trigger
(the handoff's conditional second question self-resolves to a grant narrowing).

## The change (implemented in the same PR)

Rename both matviews to `*_snapshot` (OID-preserving; the REFRESH unique index follows),
revoke all anon/authenticated grants on the snapshots, recreate the original names as
definer-semantics views with `where (select app.has_app_access('dam'::app.app_name))`
(the exact `20260911124746_crm_definer_views_caller_gate.sql` pattern), and re-point
`public.refresh_style_guide_matviews(uuid,integer,text)` at the renamed snapshots. Migration
`20261117020002_style_guide_matviews_gated_projection.sql`.
