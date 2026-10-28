---
issue: 4956
status: OPEN
owner: zcode chat (unknown id) on hetz — successor must claim claim-first on the issue below
---

# Master Data live auto-flow — delivered; assortment-exclusion defect open

## 1. What we were doing, and why

Albert asked (2026-10-27, ZCode chat on hetz) that items created in DesignFlow appear in Master Data automatically, then (same night) that it be LIVE rather than a scheduled copy, then (2026-10-28) that auto-created lines be pre-filled with every ColdLion field. All three shipped to production. At wrap-up Albert identified a real defect: BRG6206 is an assortment, and assortments must not appear in Master Data.

## 2. What was actually done — with PRs, SHAs, versions

All merged to `popcre/shared-db` main and applied to PRODUCTION (verified live on qsllyeztdwjgirsysgai):

- **#4909 / PR #4912** (merge 299aea3f, 2026-10-27 8:40 PM EST): nightly auto-flow. `public.sync_new_items_into_style_tracker` + cron `nightly-style-tracker-item-autoflow` 05:50 UTC. Migration **20261027185232** (superseded 20261027153934 after a base-branch move). Governed review: round 1 REJECT (batch-internal duplicate SKU; nondeterministic cap) fixed, round 2 APPROVE.
- **#4941 / PR #4943** (merge a0b77d71, 2026-10-27 11:48 PM EST): live flow. `plm.import_item_master_data` re-derived (derived-from 20261002224520) to run the sync in-transaction, exception-isolated so a sync fault cannot fail the item feed. Migration **20261028025244**. New workflow `coldlion-item-sweep.yml` every 30 min at :05/:35 (the heavy landing pipeline stays nightly — round 1 REJECT caught that). Review APPROVE with v2 pre-merge risk fold.
- **#4951 / PR #4954** (merge 8f5ef1c2, 2026-10-28 8:47 AM EST): ColdLion pre-fill. Function re-derived again: description (itemDisplayDesc→itemDesc→description), licensor when merch-group resolution exists, itemDiscontinued flag, itemNote as notes, provenance keys in row_data. Migration **20261028130227**. Backfilled BRG6206.
- Live proofs on production: BRG6206 auto-created+linked (05:35 UTC), pre-filled (≈9:00 AM EST).

Claims #4911, #4942 (withdrawn trigger variant, version 20261028024037 never applied anywhere), #4944, #4952 — all CLOSED.

## 3. Applied to preview / production

Preview: rehearsals for 20261027185232 (runs 40613300993 + recovery 40620309393), 20261028025244 (40634470933 + recovery 40637225972), 20261028130227 (40699857547). Production: all three versions in the production ledger. No preview-only rows left behind by me.

## 4. Half-finished or abandoned

- **OPEN defect → issue #4956**: the auto-flow creates Master Data lines for assortments. Evidence-based marker: `coldlion.item_detail.pre_pack_code` (BRG6206→PPK2943; components in `coldlion.prepack_detail`). Also remove the one wrongly created line (BRG6206). CAUTION: the business-rules doc maps pre_pack_code as marking prepack MEMBERS, but live CW001 data has it on the multi-brand head — verify semantics on known assortments before writing the skip. Successor: claim claim-first on #4956; the function object is `public.sync_new_items_into_style_tracker`.
- Trigger-based variant abandoned (version 20261028024037 withdrawn): CREATE TRIGGER claims `table plm.item`, protected by expired-but-open claim #4723 (#4707 DesignFlow canonical move, on edge-dev3). If that claim is ever released, a trigger remains an option but the import-time design already delivers live semantics.

## 5. What I own right now

Nothing open. Worktrees `.wt-4909-md-item-autoflow`, `.wt-4941-md-live-autoflow`, `.wt-4951-autoflow-prefill` — clean, PRs merged, retired at wrap-up. No open PRs, no held claims/leases/freezes (promotion freeze released; verified). Issue #4956 is the successor's card.

## 6. What I was about to do next (for the successor)

Claim #4956 → verify the assortment marker semantics on a few known heads/members → re-derive the sync function's eligibility CTE to skip assortments on both paths → delete the BRG6206 Master Data line in the same migration (one row; pure-data declared) → contract tests for assortment skip → full pipeline. Optional business question for Albert (recorded on #4956): pre-cutoff item SNM57WBFT01 (created 2026-10-26) has no line by the no-backfill design — manual add or one-time sweep?

## 7. Blocked on

Nothing mechanical. #4956 needs the marker-semantics verification; the only coordination hazard is the shared merge queue / serial production lane congestion seen all night (multiple sibling sessions merging).

## 8. What we tried that did NOT work — MANDATORY

- **Trigger on plm.item** — correct design, impossible today: object claim #4723 (idle Claude session on edge-dev3) protects `table plm.item`; the abandonment audit is REPORT_ONLY and will not release it. Do not retry without that claim resolving.
- **Scheduling the whole coldlion-landing-sync every 30 min** — reviewer REJECT (correct): that pipeline is ~118 min worst case (prepack refresh ~43 min alone); it would queue unboundedly and multiply API load ~48×. The dedicated item-sweep workflow is the fix; keep heavy steps nightly.
- **`??` as a null-coalescing SQL operator** — does not exist in Postgres; use `coalesce(a, b, c)`.
- **pg_get_functiondef output pasted into a migration** — its closing `$function$` has no trailing semicolon; add it or the verify block breaks parse.
- **Merged-PR promotion pins**: a v1 risk block binds one main SHA; any sibling merge under you invalidates it and production evidence must be re-minted at the new tip (historical-recovery lane: `historical_preview_source_pr` + `historical_preview_original_run_map`). The v2 pre-merge risk fold (`--production-risk-classes/--production-risk-allowlist` without `--production-risk-main`) survives main moves — always use it.
- **ai-task-gates promotion gate** needs the report from the worktree at the reviewed head AND a lifecycle-recorded APPROVE with tests (`ai-review muse final-check --tests "bash scripts/check-sql.sh" --base <merge-base> --implementer glm`); without `--base` the toolkit review judges the whole inherited delta and will REJECT on other sessions' work.
- **Merge-queue version order**: an open PR with an older migration version blocks all later ones ("migration queue order refused"). Relief that worked twice: verify the blocker PR is green with a durable exact-head APPROVE, then dispatch ITS guarded merge yourself with a coordination comment (its session may be idle).
- **prod history test for assortments** is transaction-attested: brand-new assortments have no history and are invisible to it. `coldlion.item_detail.pre_pack_code` is present for new items (BRG6206, day old).

## 9. Facts that may already be stale

main tip 8f5ef1c29a02328726e753f65af6bac2ba743b3f; max migration on main 20261028041540 (checked 2026-10-28T14:26Z — a sibling PR can move both within the hour). Counts quoted in this file (28 new items / 9 assortments / 19 real / 18 covered / 1 gap) measured 2026-10-28 ~9:20 AM EST. Issue #4956 freshly created. The three feature issues (#4909/#4941/#4951) are closed with live-proof evidence.

## Sub-agents

None were dispatched this session; no sub-agent blocks.
