---
issue: 121
status: BLOCKED
owner: codex/grid-loading-phase-a-121
---

# Grid loading performance — Phase A shipped, remaining gates

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

1. **Blocking security action:** authorize rotation/revocation of the production browser test account session/credentials exposed by a diagnostic response on 2026-09-10. Recommendation: invalidate its active sessions and rotate its password/credential through the approved identity path, then confirm a fresh signed-in test session works. This blocks further signed-in production QA only; no user data was changed.
2. **Blocking database promotion:** when shared-db #2665 is preview-proven and merged, approve applying that exact `find_dam_order_list_row` function migration to production. This blocks OrderList Find integration and final plan closure, not the already-live Master Data improvement.

Already settled — do not re-ask: Albert authorized the three performance improvements in PopDAM #121 on 2026-09-10; Master Data may ship independently while the shared-db function waits. The next session must raise both decisions together before its next production action.

## 1. What this application is

PopDAM is POP Creations’ internal licensed-art library. The Master Data screen at `https://dam.designflow.app/styles` mirrors the style tracker; the OrderList screen at `/orders` uses the same shared Supabase backend. PopDAM code is in `/worksp/popdam` and ships directly to `main`; database structure belongs only to `/worksp/shared-db` through its orchestrator.

## 2. What we set out to do this session, and why

Implement PopDAM #121’s approved loading-performance plan: release the first 4,000 Master Data rows immediately, stop fetching unused view fields, and replace the OrderList Find ID scan with a database lookup. The customer problem is waiting for rows that have already arrived and an unnecessarily expensive Find path.

## 3. Current state — what is true right now

Phase A is committed, pushed, checked, and live as PopDAM `main` commit `1d17075ebe0c0283bebfaa20cb73ce4295e2077a` (`Improve Master Data progressive loading`). GitHub checks `verify`, `lint-test-build`, `build-and-push`, `guard`, and `forbid-shared-db-bypass` succeeded. Production `/styles` returned healthy HTML and bundle `index-DLksYwlD.js`; the served bundle contains build `1d17075` and the new partial-loading wording.

`src/pages/StylesPage.tsx` now uses TanStack infinite pages. Each page requests four non-overlapping 1,000-row ranges, gives those 4,000 rows to the grid immediately, and fetches the next page in the background. The header truthfully says partial Find/filters cover only loaded rows until loading completes. `src/lib/master-data-loading.ts` owns the explicit select projection and page/flatten helpers. `src/test/master-data-loading.test.ts` checks range boundaries, no duplicate IDs, required fields, and absent unused metadata. `docs/MASTER_DATA.md` and the plan STATUS table reflect it.

All local tests passed: 54 files / 319 tests. `npm run build` passed. Focused lint had no errors; its 30 warnings are pre-existing `any` and two unrelated hook-dependency warnings in `StylesPage.tsx`.

The production Licensed baseline is sanitized at `docs/verification/grid-loading-performance/2026-09-10T1514Z/README.md`. Step 1 is deliberately marked partial: Generic and OrderList baselines remain pending after credential rotation. Steps 2–3 are locally complete; their live before/after measurement remains Step 6.

## 4. Everything we tried that did NOT work

The active shared-db worker did not author the OrderList function. Shared-db marker #2669 resolves to a live Claude orchestrator, and the local GitHub CLI’s missing `gh api --slurp` option makes its queue audit fail closed. Creating a migration, preview, PR, or production change without that owner would violate the single structural lane, so none was attempted.

Signed-in production browser tracing stopped after one low-level network diagnostic returned an authorization header. Do not repeat that request-inspection method; it exposes credentials in tool output. No secret was committed or saved in the sanitized evidence file.

## 5. Root causes and key findings

Before `1d17075`, `fetchRows` in `src/pages/StylesPage.tsx` waited through every four-request wave before resolving, even though the first 4,000 rows had already arrived. It also selected every view field. The new `STYLE_TRACKER_ROW_SELECT` keeps the page’s editable data, row JSON, link/match identifiers, canonical display names, and RFQ history while omitting confirmed-unused view metadata.

The live pre-change Licensed page was build `6296708`. It sent four initial `select=*` requests at offsets 0/1000/2000/3000 and then continued to 15000; its first 1,000-row request took 1.67 seconds. This fact and the redaction method are in the evidence README, not any licensed row content.

OrderList normal browsing is intentionally infinite and bounded. Its Find-position function must wait for shared-db #2665’s `public.find_dam_order_list_row` contract; app-side SQL or a PopDAM migration is forbidden.

## 6. Exact next steps

1. Rotate/revoke the exposed production test-session credential using the approved identity path, then open a new signed-in test session. You’ll know it worked when the old session no longer authenticates and a new session can load `/styles` without revealing a credential in any captured artifact.
2. Repeat sanitized cold-cache production baselines for Generic Master Data and a late OrderList Find; capture only timings, URL shapes, counts, bytes, and screenshots with all row data/headers redacted. You’ll know it worked when the Step 1 evidence README has both baselines without secrets.
3. Follow shared-db #2665 and marker #2669. The active orchestrator must repair its GitHub CLI audit issue, claim `public.find_dam_order_list_row`, dispatch in an isolated worktree, preview/test/review/merge under shared-db rules. You’ll know it worked when the issue records a merged SHA and preview proof; do not promote production without Albert’s item 2 approval.
4. After the exact production function is applied and verified, update `src/hooks/useOrderList.ts` and `src/pages/OrdersPage.tsx` per plan Step 5: one RPC for position, current scan only for verified missing-function deployment skew, no fallback for real errors. You’ll know it worked when late Find makes one position RPC plus the destination grid request and highlights the right row.
5. Repeat live signed-in QA and before/after evidence, then update the plan, close #121 only after all acceptance criteria pass, and retire this handoff under the successor rule. You’ll know it worked when the plan links production proof and no open obligation remains.

## 7. Constraints and gotchas in force

Never make shared database structure changes from PopDAM or apply direct production SQL. Production is read-only except the exact shared-db migration after owner authorization. Keep Master Data client-side when complete, retain all required JSON/link fields, preserve OrderList’s infinite grid and split row/count queries, and never increase timeouts. Do not expose or copy tokens into logs, files, commits, prompts, or chat. PopDAM is direct-to-main; stage only owned paths and preserve other sessions’ work.

## 8. Access and environment

GitHub CLI is authenticated; production is Virginia Supabase project `qsllyeztdwjgirsysgai`. Secrets live only in 1Password vault `vibe_coding`; do not retrieve or print values. The live frontend deploy is driven by `Publish Frontend Image`; its successful run for this release is `34494565951`. The current shared-db routing comment is on issue #2665 at `https://github.com/u2giants/shared-db/issues/2665#issuecomment-5620942492`.

## 9. Open questions and risks

No code-design question remains for Phase A. The only business/authority gates are section 0’s credential remediation and exact production migration approval. Until production measurements repeat, do not claim a byte or end-to-end timing improvement; the code and served bundle are proven, but the final customer acceptance is not. The shared-db active owner’s CLI incompatibility is an external workflow blocker, not authority to bypass the lane.

## Sub-agent record — `/root/shared_db_rpc`

The sub-agent was asked to implement only shared-db plan Step 4. It read the governed route, confirmed #2665 is ready structural work with exact write claim `public.find_dam_order_list_row` and read claim `api.dam_order_list`, resolved marker #2669 to the live Claude orchestrator, and posted the dispatch request linked in section 8. It did not create a migration, preview, PR, merge, or production change because the queue audit failed closed on the installed GitHub CLI incompatibility. Its worktree is finished; it made no PopDAM edits.

## Handoff self-audit — PASSED

1. Yes: sections 1–6 identify the product, committed/live state, exact files, evidence, blockers, and executable gates.
2. Yes: sections 4–5 preserve the two non-obvious failures and the loading/database findings needed to continue without rediscovery.
3. Yes: sections 0–9 cover background, outcome, verification, failures, decisions, constraints, access, risks, and next actions; no secret value is included.
4. Yes: the only owner judgements in sections 1–9 are credential rotation and exact migration promotion, both consolidated with recommendations in section 0.
