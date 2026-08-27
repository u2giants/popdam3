---
issue: 97
status: BLOCKED
owner: codex/hybrid-search-completion-97
---

# PopDAM hybrid search — deployed dark, awaiting governed search contracts

Canonical plan: [`../plan_hybrid_search_rollout.md`](../plan_hybrid_search_rollout.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message only when its stated gate is reached; do not re-ask early.

### Blocking later production actions

1. **Full embedding backfill.** Approve only after shared-db #1645 and #1703 are production-proven and a small bounded production sample reports throughput, duration, worker impact, categorized failures, residue, and rollback. This blocks plan Step 8. Recommendation: keep keyword mode and automatic embedding off during the sample.
2. **Turn on Smart search.** Approve `SEARCH_MODE=hybrid` only after final corpus coverage, two-user authorization, filter-before-pagination, facet/list parity, relevance-floor UX, fallback, performance, and rollback proof. This blocks plan Step 9. Recommendation: enable only after every gate passes and retain one-setting keyword rollback.

### Separate optional work

3. **Telemetry retention and scope.** Recommendation: keep telemetry off for initial launch; request a separate proposal after search works.
4. **Image embeddings.** Recommendation: keep them outside #97; they require a separate cost/model/storage decision.

### Already settled — do not re-ask

- 2026-08-24: no production delete-all search rebuild; maintenance is bounded and incremental.
- 2026-08-24: #96/#97 share one final active tag/character corpus and exactly one later embedding backfill.
- 2026-08-24: the worker is the sole embedding claimer; no unauthorized ID, rank, or count may leave the server.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager; PopSG is the style-guide mode served by the same app. Repository `u2giants/popdam3` is locally `/worksp/popdam`; production is `https://dam.designflow.app` and `https://sg.designflow.app`. The React frontend calls a Supabase edge function for search, and a Railway Node/TypeScript worker maintains embeddings. Shared database structure belongs in `u2giants/shared-db`, locally `/worksp/shared-db`.

Issue #97 adds safe keyword plus pgvector search over descriptions, tags, canonical characters, PDFs, and product metadata without leaking records or breaking filtered pagination/facets.

## 2. What we set out to do this session, and why

This replacement reconciles the 2026-08-24 planning handoff with the deployed dark implementation and current shared-db routing. The old file stated that no application implementation existed and that shared-db #1427 was the active schema step. That is superseded: #1427 is production-complete, dark indexing controls shipped, and the remaining database gates are #1645 then #1703.

## 3. Current state — what is true right now

- Plan Step 2 is production-complete through shared-db #1427 / PR #1482 / migration `20260825082910` / merge `8ae124a2`; final active asset/group tags plus canonical characters are in the corpus. No embedding backfill ran.
- PopDAM dark implementation shipped at `37cca5ca`: worker-only leased embedding, lease-only edge processing, a bounded off-by-default automatic loop, admin coverage/start-stop-resume controls, safe search-mode cache refresh, and caller-client edge search.
- Local evidence at that increment: 134 worker tests and build passed; focused frontend tests, frontend build, and lint passed. Edge deploy run `33120788198`, frontend publish `33120788225`, and a Railway successful descendant were recorded. Live DAM/SG returned HTTP 200 and frontend stamp `37cca5c` was observed.
- Plan Step 3 is routed to shared-db #1703 and depends on shared-db #1645. #1645 has an active claim (#1656); its first preview version `20260827183011` was refused at production and must not be retried. The required path is a fresh idempotent replacement, then production proof. #1703 has not begun because it depends on #1645.
- Steps 4–6 are deployed dark/implemented but still lack all named live proofs. Step 7 remains partial and database-blocked. Steps 8–11 remain open.
- `SEARCH_MODE` remains keyword; no production embedding sample/backfill has run, and automatic embedding is absent/off by default.
- Issue [#97](https://github.com/u2giants/popdam3/issues/97) is OPEN.

## 4. Everything we tried that did NOT work

1. **Service-role ranking followed by browser filtering.** Rejected because unauthorized IDs, ranks, and array length have already crossed the trust boundary.
2. **Securing only the edge function.** Rejected while direct keyword/security-definer wrappers could bypass the same rule.
3. **Filtering after ranked pagination.** Produces short/empty pages and facet counts that disagree with the grid.
4. **Delete-all document rebuild.** Rejected as outage/lock/compute risk; maintenance must be incremental and bounded.
5. **Two embedding claimers or hash-only concurrency.** Rejected because hash checks prevent stale commits but do not prevent duplicate compute.
6. **Embedding an intermediate corpus.** Rejected because #96 scoped metadata had to land first; the final corpus is now live and one backfill remains.
7. **Retired #1645 migration `20260827183011` and rehearsal reset.** The explicit-transaction migration cannot be safely replayed by the replacement loader, and deleting only its preview ledger row would worsen drift. Do not retry it or relax transaction-control refusal.
8. **Treating deployed dark controls as launch.** UI/worker code exists, but authorization-safe filtered ranked paging/facet parity, live restart/coverage proof, backfill, and mode flip remain gated.

## 5. Root causes and key findings

- Search safety is a single contract across authorization, ranking, active filters, pagination, counts, facets, and every direct callable path.
- The corpus and lease foundation is now live; the remaining structural gap is effective filtering (#1645) followed by authorization-safe ranked pagination/facets (#1703).
- Style-group search must preserve direct-group plus member-asset rollup consistently in keyword and hybrid modes.
- The browser's current 500-ID relevance handoff cannot provide honest deep paging; server-side filtered ranked paging is required.
- `SEARCH_MODE` caching needed invalidation for rollout/rollback; dark implementation added bounded refresh, but live flip/rollback proof still belongs to Step 9.
- Automatic freshness and full backfill use the same leases for different purposes; only the worker claims, and automatic work stays bounded/off until deliberately enabled.

## 6. Exact next steps

1. Re-read the plan STATUS table, issue #97, shared-db #1645/#1703, and current open handoffs; verify current PopDAM/shared-db HEADs and deployment/config state. **You'll know it worked when** every stale SHA/status in this file has been replaced by current evidence before edits.
2. Let the shared-db orchestrator finish #1645 using a fresh idempotent migration; never retry `20260827183011`. Require production apply evidence, effective tag/grouped identity behavior, facet parity, and cold `authenticated` timing under eight seconds. **You'll know it worked when** #1645 records the final callable shape, migration, production apply, cold timing, and generated-type implications.
3. Complete shared-db #1703 on top of #1645: authorization before return, active filters before ranked page boundaries, honest `has_more`/counts, matching facets, unified Style Group rollup, compatibility transition, weak-tail behavior, and two-user isolation. **You'll know it worked when** preview and production-scale cold tests pass and no direct RPC bypass remains.
4. Wire the final contracts into PopDAM and finish plan Steps 3–7. Prove caller authorization, filtered deep pages, facet/list parity, score-floor UX, fallback, eight-second headroom, operation-map equivalence, worker restart/resume, automatic-loop disable/overlap/expiry/retry, and authenticated desktop/mobile controls. **You'll know it worked when** every STATUS evidence cell for Steps 3–7 is complete with exact deployed SHAs.
5. Stop for Albert at §0 item 1. Run only the approved bounded sample; report throughput, duration, impact, categorized failures, residue, restart behavior, and rollback. **You'll know it worked when** Albert can approve or reject the full backfill from measured evidence.
6. Run the approved backfill, reach required eligible coverage, then stop for Albert at §0 item 2. Enable hybrid only after all launch gates pass; verify real user flows, fallback, authorization, performance, and one-setting rollback. **You'll know it worked when** live browsers use hybrid safely and switching back to keyword is proven.
7. Update durable docs and plan STATUS, close #97, and delete this handoff only after required Steps 1–9 and 11 are complete. Telemetry Step 10 remains optional/separate. **You'll know it worked when** issue #97 is CLOSED and no stale #97 handoff remains.

## 7. Constraints and gotchas in force

- All shared schema/RPC/index changes go through `/worksp/shared-db` branch, PR, preview, merge, and production proof. Never add app-local DDL.
- Coordinate #1645 then #1703; do not create competing projections or search-function replacements.
- No delete-all production rebuild, service-role result leak, post-pagination filtering, dual claimer, or intermediate-corpus embedding.
- Preserve rich-PDF/product/tag/character fields and 8,000-character ordering in the latest effective corpus builder.
- Keyword remains default and rollback until the complete launch gate passes.
- No full backfill or hybrid flip without Albert's explicit gated decision in §0.
- Telemetry and image embeddings remain separate.
- Protect concurrent work, use isolated worktrees where needed, and stage only owned files.

## 8. Access and environment

- PopDAM: `/worksp/popdam`, GitHub `u2giants/popdam3`, production `dam.designflow.app` / `sg.designflow.app`.
- Shared DB: `/worksp/shared-db`, GitHub `u2giants/shared-db`; production Supabase project `qsllyeztdwjgirsysgai`.
- GitHub CLI was authenticated during the 2026-08-27 reconciliation. Shared-db production/preview procedures and credential item names are in `/worksp/shared-db/AGENTS.md`.
- Secrets live in 1Password vault `vibe_coding`; reference locations only, never values.
- Railway deploys worker changes from PopDAM `main`; frontend freshness requires its own workflow/live stamp rather than the Railway environment badge.

## 9. Open questions and risks

- #1645's final idempotent replacement shape and production timing are not yet known; do not wire guessed types.
- #1703's final ranked cursor/filter/facet contract is not yet authored.
- Live embedding coverage, errors, current config, worker restart behavior, automatic freshness lag, and authenticated visual state must be re-proven before backfill.
- Weak semantic matches need a measured threshold and honest UI state; nearest-neighbor output always has a tail.
- A large backfill can consume worker/provider capacity; the bounded sample and owner gate are mandatory.
- Any authorization or facet mismatch is a launch blocker, not a known limitation to waive silently.

## Self-audit

Passed 2026-08-27. All sections 0–9 are present. §3 has exact implementation, deploy, config, and dependency state; §4 preserves rejected designs and the critical retired-migration dead end; §§5–7 preserve architecture and execution order; every §6 step has a verification gate; §8 names access without secrets; §9 states unresolved contracts and risks. A line-by-line sweep promoted every owner decision to §0.
