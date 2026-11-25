---
summary: Issue #1304 plan: show production-PO lookup failures, fix docs about the retired sync, prove old credentials gone. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-1304, or changing the style panel's Production POs section
---

# Plan: production orders read path — follow-ups (u2giants/popdam3#1304)

Issue: https://github.com/u2giants/popdam3/issues/1304 — advisory review of PR #1296 ("refactor(#1272): read production orders from the shared database").
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md)
Related: [`plan_shared_data_no_copies.md`](../../plan_shared_data_no_copies.md) (the overall "read, don't copy" plan; its P2/T1 credential list is the source for step 4). Parent issue #1272, stage issues #1298–#1300 (closed).

Written 2026-11-25 (about 4:20 PM EST) by Claude on `al8960ofc`, plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Confirm the read function and the copy-table drop are live in production | ⬜ open | — |
| 1. Style panel shows a lookup failure, not "No production POs" | ⬜ open | — |
| 2. Router docs: agents-reference rows and quirk title | ⬜ open | — |
| 3. Schema and ERP docs: retired sync marked retired | ⬜ open | — |
| 4. Prove every retired credential name is gone (read-only) | ⬜ open | — |
| 5. Tests: lookup failure and panel error | ⬜ open | — |
| 6. PR, CI, merge, deploy verified | ⬜ open | — |
| 7. Live proof, close #1304 | ⬜ open | — |

**Where a fresh session starts:** Step 0, then Steps 1–5 in any order.

---

## 1. The ultimate goal

On each design's detail panel in PopDAM, staff see the production orders (POs) that contain that design. Since 2026-11-23 PopDAM reads them straight from the shared database instead of keeping its own copy (owner ruling: one shared database, apps don't copy data). When this plan is done, **a failed lookup is shown as a failure ("Could not load production POs"), never as "No production POs recorded"; every guide an AI session reads first points at the real read path, not at deleted code; and every credential the old copy used is proven gone.**

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopDAM (repo `u2giants/popdam3`; React + Vite web app `src/`; edge functions `supabase/functions/`; shared Supabase project `qsllyeztdwjgirsysgai`, schema owned by `popcre/shared-db`, read-only mirror `shared-db/`). Production: https://dam.designflow.app.

Read path today:
- `src/lib/productionOrders.ts:48-54` `fetchStyleProductionOrders(sku)` calls RPC `api.dam_production_orders_for_sku({ p_sku })` and throws on error; `toStyleProductionOrders` maps and sorts.
- Database function: `shared-db/supabase/migrations/20261225090701_dam_production_orders_for_sku.sql` (popcre/shared-db#6986; production proof popcre/shared-db#6992 comment 7114472875). It aggregates lines into one row per production order.
- `src/components/library/StyleGroupDetailPanel.tsx:183-188` `useQuery` reads only `data`; `:945-946` renders "No production POs recorded for this SKU" when `data` is empty **or undefined** — which includes the error state.
- Existing test: `src/lib/productionOrders.test.ts` (mapping and sort only).

Retired: the PLM-feed copy (`prod_order_sync_runs`, `prod_order_headers_raw`, `prod_order_headers_current`), its edge handler `supabase/functions/_shared/admin-handlers/prod-order-handlers.ts`, worker schedule, admin actions, settings card. Tables dropped by `shared-db/supabase/migrations/20261225091103_drop_popdam_prod_order_copy_and_dam_snapshots.sql:288-290`.

## 3. What triggered this work

Advisory review issue on merged PR #1296. Labels are not proof of a fix. Its finding 6 is truncated on GitHub at "No test covers the changed beh…"; the fixer's analysis completes it: "A test covers mapping and sorting. Lookup failures and the panel's error display lack coverage."

## 4. Scope

In: the open findings below. NOT in: changing what the function returns; ColdLion sales orders in the panel; the OrderList page; deleting the historical app migration `supabase/migrations/20260615183000_add_prod_order_headers.sql` (this repo's legacy migrations folder is frozen history — the tables are dropped by shared-db; leave the file, note it in SCHEMA.md).

## 5. Current state

PR #1296 merged; read path live and proven 2026-11-23 4:25 PM EST on design AA062VMAT03 (D3401/D3402/D3731) per #1272. Credentials retired per #1300 (comment by the #1272 session, ~3:30 PM EST 2026-11-23). Nothing in this plan has started.

## 6. Findings — current status

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Read function not in repo; failure is silent | **Partly resolved** | Function is in the mirror (`20261225090701_…`) and proven live (shared-db#6992). Still open: silent failure at `StyleGroupDetailPanel.tsx:183-188,945-946` |
| f2 | Router points at the deleted handler; old quirk title; stale ERP doc route | **Open** | `docs/agents-reference.md:61` (routes "production PO sync" to stale `docs/ERP_ENRICHMENT_PLAN.md`), `:204` (routes to deleted `prod-order-handlers.ts`, browser-JWT advice), `:294` (old title "PLM production PO sync has two auth layers…"; the entry at `docs/idiosyncrasies.md:70` is now "Production orders are read from the shared database, never copied") |
| f3 | Schema and ERP docs describe the sync as live | **Open** | `docs/SCHEMA.md:257-279` "synced from the PLM API"; `docs/ERP_ENRICHMENT_PLAN.md:150-197` section 8 incl. UI card and secret-storage instructions |
| f4 | Credentials left with no consumer | **Mostly resolved** | #1300: edge secrets `PROD_ORDER_API_TOKEN_2`, `PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON` unset; `admin_config` `PROD_ORDER_API_TOKEN_2_HEADER`, `PROD_ORDER_API_ENDPOINT` deleted; GCP service account `popdam-po-sync` deleted; two 1Password items archived. Not yet shown: the other names the reviewer listed — edge secrets `PROD_ORDER_API_TOKEN_1`, `PROD_ORDER_API_AUTH_HEADERS`, `PROD_ORDER_CLOUD_RUN_AUDIENCE`, and any other `admin_config` key starting `PROD_ORDER_` |
| f5 | Duplicate React keys if one row per line | **Resolved** | Function aggregates to one row per order (fixer analysis on #1304; function body in mirror) |
| f6 | Tests for lookup failure / panel error | **Open** | `src/lib/productionOrders.test.ts` covers mapping only |

## 7. Approaches considered and rejected

- **Return `[]` from `fetchStyleProductionOrders` on error.** Rejected: that is the silent failure the finding is about.
- **Toast on error.** Rejected: the panel opens often; an inline message in the section is enough and does not nag.
- **Deleting `docs/ERP_ENRICHMENT_PLAN.md` section 8.** Rejected: the doc is `status: stale` history by design; replace the section body with a short "Retired 2026-11-23" note and a pointer instead, so history survives in git and readers aren't misled.

## 8. Design decisions

Locked: owner ruling 2026-11-23 (#1272) — read from the shared database, never reintroduce a PLM-feed sync. Credential deletion is reversible only by re-issuing; deleting a still-present unused secret is in scope (step 4) because its consumer is gone. Open: none.

## 9. The plan

### Step 0 — Production check (lead-only; read-only)
Supabase MCP `execute_sql` (read-only) on `qsllyeztdwjgirsysgai`:
```sql
select version from supabase_migrations.schema_migrations where version in ('20261225090701','20261225091103');
select to_regclass('public.prod_order_headers_current');
```
You'll know it worked when both versions are listed and `to_regclass` is null. If the drop is not applied, SCHEMA.md in step 3 must say "being dropped (shared-db migration 20261225091103)" instead of "dropped".

### Step 1 — Show lookup failures (helper-ok; edit named)
`StyleGroupDetailPanel.tsx:183-188`: `const { data: productionOrders, isError: productionOrdersFailed, isLoading: productionOrdersLoading } = useQuery(…)`. At `:945`: if `productionOrdersLoading` render "Loading production POs…"; else if `productionOrdersFailed` render, in the same small text style but amber/destructive, "Could not load production POs. Try again later." with a "Retry" link calling `refetch()`; else the existing empty/list branches.
You'll know it worked when panel tests 2–3 (section 10) pass.
Stop-and-ask trigger: the panel's query uses a shared wrapper that already handles errors.

### Step 2 — Router docs (helper-ok; wording given)
`docs/agents-reference.md`:
- `:61`: change the task text to "Work on ERP sync / MG codes / category classification" and add a separate row "Production POs on the style panel | `src/lib/productionOrders.ts`, `src/components/library/StyleGroupDetailPanel.tsx`, `docs/idiosyncrasies.md` → Production orders are read from the shared database | `docs/ERP_ENRICHMENT_PLAN.md` (retired sync history)".
- `:204`: replace the "Fix production PO sync" row with "Fix production POs on the style panel | `src/lib/productionOrders.ts`, `src/components/library/StyleGroupDetailPanel.tsx`; database function `api.dam_production_orders_for_sku` in `popcre/shared-db` | This repo's `supabase/migrations/`; never reintroduce a PLM feed sync".
- `:294`: "Production orders are read from the shared database, never copied" (must match `docs/idiosyncrasies.md:70` exactly — that file's rule at `:10` requires the index to mirror entry titles).
You'll know it worked when `git grep -n "prod-order-handlers\|two auth layers" docs/agents-reference.md` returns nothing.

### Step 3 — Schema and ERP docs (helper-ok; wording given)
- `docs/SCHEMA.md:257-279` section "2.15 Production PO Tables": replace with a short section: "Retired 2026-11-23 (popdam3#1272). The `prod_order_*` copy tables were dropped by shared-db migration `20261225091103`. Production orders are read from `plm.production_order*` through `api.dam_production_orders_for_sku`. The old app migration `supabase/migrations/20260615183000_add_prod_order_headers.sql` is history only." Fix the sentence at `:281` ("does not use the `prod_order_*` tables above") to "The `/orders` screen reads …".
- `docs/ERP_ENRICHMENT_PLAN.md:150-197` section 8: keep the heading, replace the body with "Retired 2026-11-23. See `docs/idiosyncrasies.md` → Production orders are read from the shared database, never copied. The secrets and settings this section described were deleted (popdam3#1300)." Never leave the secret-storage instructions.
- Regenerate the index: `ai-doc-health --repo . --fix-index` (tool in `popcre/ai-devops` `bin/`).
You'll know it worked when `git grep -n "synced from the PLM API\|PROD_ORDER_" docs/SCHEMA.md docs/ERP_ENRICHMENT_PLAN.md` returns nothing.

### Step 4 — Credential proof (lead-only; touches production secrets)
Read-only listing, names only, never values:
- `supabase secrets list --project-ref qsllyeztdwjgirsysgai` (prints names and digests) → grep `PROD_ORDER_`.
- Read-only SQL: `select key from public.admin_config where key like 'PROD_ORDER_%';`
- 1Password `vibe_coding`: `item_list` and search titles containing "PO sync" / "production-order feed"; expect only archived items.
- `gcloud iam service-accounts list --project lithe-breaker-323913 | grep popdam-po-sync` → empty.
If any name remains: `git grep -rn "<NAME>" src supabase/functions apps` must be empty, then unset it (`supabase secrets unset <NAME> --project-ref qsllyeztdwjgirsysgai`) or delete the `admin_config` row (show the row's key first; delete by exact key). Removing an unused secret needs no rotation (it was never published off the machine).
You'll know it worked when all four checks show nothing; post the (names-only) outputs as a signed comment on #1304.

### Step 5 — Tests (helper-ok; names below)

### Step 6 — Land it (lead-only)
Fresh worktree branch, PR to `main`, required checks green, the AI merges, verify the deployed bundle (`docs/deployment.md`).

### Step 7 — Live proof (lead-only)
On https://dam.designflow.app, open design AA062VMAT03: Production POs lists D3401/D3402/D3731. In the browser devtools, block the request to `rpc/dam_production_orders_for_sku` and reopen: the section shows "Could not load production POs". Screenshots + SHA on #1304; close it with a signed comment.

## 10. Tests required

`src/lib/productionOrders.test.ts`:
1. `fetchStyleProductionOrders` throws when the RPC returns `{ error }` (mock `supabase.schema().rpc`).

New `src/test/style-group-production-orders.test.tsx` (render the panel section with the query mocked — reuse mocks from an existing `StyleGroupDetailPanel` test if one exists: `git grep -ln "StyleGroupDetailPanel" src/test`):
2. Query error → "Could not load production POs" and a Retry control; not "No production POs recorded".
3. Empty success → "No production POs recorded for this SKU".
4. Two orders → two rows with distinct keys, soonest due first.

Must stay green: `npm run lint`, `npm run typecheck`, `npm run test`.

## 11. Constraints and gotchas

- Feature branch + PR; the AI merges; no DDL here (shared-db only).
- Secrets: names only in any output, comment or commit; values never. Vault `vibe_coding`.
- `docs/idiosyncrasies.md` titles must match the index lines in `docs/agents-reference.md` exactly.
- New docs need the four-key header; regenerate `docs/INDEX.md` after doc edits.
- Not a trust-boundary change; no adversarial table needed.

## 12. Access and environment

`gh` as `u2giants`. Supabase CLI/MCP for project `qsllyeztdwjgirsysgai` (token from 1Password `vibe_coding`, see `docs/1password.md`). `gcloud` with access to project `lithe-breaker-323913` for the service-account check; if not authenticated on this machine, report that check `Blocked —` with the machine name rather than skipping it. Production login: Google SSO with a POP staff account. Local `npm ci && npm run test`.

## 13. Definition of done, risks, open questions

Done when: steps 0–7 complete with artifacts; f1 (silent failure), f2, f3, f6 fixed; f4 proven by names-only listings; CI green; merged; deployed SHA verified; live proof posted; #1304 closed; STATUS rows cite artifacts; handoff entry marked done. Risk: deleting a secret still used elsewhere — guarded by the `git grep` before deletion. Open: none.

## Self-audit (2026-11-25)

1. *Fresh session can execute without asking?* Yes — sections 2, 6, 9 give file:line, wording, commands and gates; section 3 reconstructs the truncated finding.
2. *All background, including rejections?* Yes — section 7 (return `[]`, toast, delete the ERP section) and section 8 (owner ruling).
3. *Goal clear?* Yes — section 1: failure shown as failure, guides point at real code, credentials proven gone.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 plan docs/plans/issue-1304-production-orders-read-path-followups.md (issue #1304).
Read AGENTS.md, then this plan's STATUS and sections 1, 6, 11. Work in your own worktree on a new branch from origin/main.
You do Steps 0, 4, 6, 7 yourself (lead-only). Hand Steps 1, 2, 3 and 5 to your helper, one at a time.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; when a stop-and-ask trigger fires, bring it to you; if stuck 30 minutes, you take the step back.
Rules sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run yourself: npm run lint, npm run typecheck, npm run test, the production read-only checks, the credential listings (names only) and the live proof. Update STATUS with artifacts.
```
