---
issue: 97
status: OPEN
owner: codex/hybrid-search-plan-97
---

# Handoff — safely finish and enable PopDAM hybrid search

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking

1. **Production database promotion:** approve the exact shared-db migration only after preview tests/timing are reported. This blocks production Step 2. Recommendation: approve only the bounded incremental design; reject any delete-all rebuild.
2. **Full embedding backfill:** approve after a small production sample reports throughput, projected duration, worker impact, and rollback. This blocks Step 8. Recommendation: keep keyword mode active and automatic embedding disabled during the measured sample.
3. **Turn on Smart search:** approve `SEARCH_MODE=hybrid` only after full eligible coverage, authorization isolation, fallback, pagination, and rollback proof. This blocks Step 9.

### Recoverable but must be explicit

4. **Telemetry retention and fields:** no telemetry is needed for launch. If later desired, approve the fields and retention first; recommended starting position is off, 30-day retention, and no raw query text unless expressly approved.
5. **Image embeddings:** explicitly outside this plan. A separate costed proposal may be written, but no implementation starts without approval.

### Already settled — do not re-ask

- 2026-08-24: keyword mode remains the default/rollback until launch gates pass.
- 2026-08-24: no production delete-all search rebuild.
- 2026-08-24: no unauthorized IDs, ranks, or counts may leave the edge function; browser RLS alone is insufficient.
- 2026-08-24: telemetry is a separate optional phase; image embeddings are not part of implementation.

## 1. What this application is

PopDAM/PopSG is POP Creations’ shared digital-asset library for licensed consumer-product art. The React frontend is in `/worksp/popdam` (`u2giants/popdam3`, `main`) and runs at `dam.designflow.app` / `sg.designflow.app`. Search uses a Supabase edge function and the shared Supabase project `qsllyeztdwjgirsysgai`; schema is owned only by `/worksp/shared-db`. The persistent batch worker runs on Railway from `apps/worker/`.

## 2. What this session set out to do, and why

Albert supplied a detailed prompt to finish keyword + pgvector search, asked for an assessment, then asked to incorporate all recommended improvements and use the implementation-plan standard. This session wrote the durable, standalone plan rather than implementing application/database behavior.

Canonical plan: [../plan_hybrid_search_rollout.md](../plan_hybrid_search_rollout.md).

## 3. Current state

- Planning is complete; implementation has not started.
- PopDAM issue [#97](https://github.com/u2giants/popdam3/issues/97) tracks the work.
- The plan incorporates incremental no-delete indexing, asset + style-group refresh, real embedding leases/retries, authorization-safe search responses, bounded pagination/score behavior, separate telemetry approval, and image-embedding exclusion.
- Repository inspection on 2026-08-24 confirmed substantial foundation code and stale `fix_search.md` relevance wording. Exact observations and file lines are in plan §§5–6.
- No production/live database state was queried, no schema/data/config was changed, and no deployment was triggered.
- At session start PopDAM was clean on `main`; the plan, this file, and router/topic links are the intended owned changes. The final commit/push evidence must be added to the closing report/issue after landing.

## 4. What did not work / rejected paths

No implementation was attempted. The plan rejects unsafe approaches so the successor does not repeat them: production delete-all rebuild, row-level refresh thrash, asset-only refresh, hash-only concurrency, parallel cron/worker claimers, service-role result leakage, UI-only weak-tail treatment, arbitrary result-limit increase, launch-coupled telemetry, and direct/app-repo DDL. See plan §7 for full reasoning.

## 5. Root causes and key findings

1. Search documents omit AI tags and linked character names.
2. Style-group search needs aggregation across member assets and refresh of old/new affected groups.
3. Existing rebuild deletes the complete search-document table.
4. Existing embedding “claim” selects without a lease; hash checking prevents stale commits but not duplicate compute.
5. Embedding errors can be excluded forever without retry metadata.
6. The edge function authenticates manually but performs search with service role, so unauthorized IDs/ranks/result length can leave the server before browser RLS filtering.
7. Relevance ordering is already preserved in the hooks; the remaining hard problem is the 500-result ceiling and honest pagination.
8. Telemetry is useful but unnecessary for launch and requires an owner retention decision.

Evidence and line references are in plan §§5–6.

## 6. Exact next steps

1. Open [the plan](../plan_hybrid_search_rollout.md) and read its STATUS table plus §§1–13. You’ll know this is done when no planning-chat context is needed.
2. Execute Step 1 read-only verification and update STATUS with private artifacts/current SHAs/counts. You’ll know it worked when every live assumption has target proof and no write occurred.
3. Dispatch the precisely scoped structural work to the single shared-db orchestrator; do not author it in PopDAM. You’ll know it worked when the merged, preview-proven incremental migration is promoted only with Albert’s exact approval.
4. Continue Steps 3–7, then take the marked fresh-session cut before production work. You’ll know it worked when security, worker, automatic freshness, UI, paging, score-floor, and fallback tests pass.
5. Report measured sample throughput and obtain Albert’s approval before Step 8; report coverage/security evidence and obtain approval before Step 9. You’ll know launch worked only after deployed SHA, live UX, fallback, and rollback proof.
6. Keep STATUS current and delete this handoff only when issue #97 is genuinely complete and all obligations have landed in durable docs/history.

## 7. Constraints and gotchas

- Canonical shared-db only for DDL/RPC/trigger/RLS/index/lease structure; branch + PR + preview first.
- Consumer session routes to the shared-db orchestrator and stops; no direct SQL/Dashboard/app migration.
- Prove target immediately before every write.
- PopDAM commits directly to `main`; stage owned paths only and preserve concurrent handoffs.
- Do not edit generated Supabase types manually.
- `verify_jwt=false` is paired with manual edge authentication; preserve and test it.
- Service role may maintain embeddings but may not return unfiltered user search results.
- No production delete-all rebuild, parallel schedulers, raw licensed text in logs, or silent error suppression.
- Frontend, edge, worker, schema, config, and database coverage each require separate proof.

## 8. Access and environment

This session verified GitHub CLI sufficiently to create issue #97. It did not certify current Supabase, Railway, Coolify, or browser authentication. At execution time use:

- 1Password vault `vibe_coding`.
- `Supabase CLI Personal Access Token` and the shared production/preview DB password items named in `/worksp/shared-db/AGENTS.md`.
- Protected refs through `ai-private-config`; production project is `qsllyeztdwjgirsysgai`.
- Railway-held `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; never output values.
- Production URLs `https://dam.designflow.app` and `https://sg.designflow.app`.

Repair broken canonical access rather than using a workaround.

## 9. Open questions and risks

- Transition-table trigger versus durable stale queue is a measured preview choice; criteria are in plan §8.
- Authorization implementation may be security-invoker RPC or an internal-candidate/authorized-filter wrapper; behavioral isolation is locked.
- Paging may use cursor or an explicit product limit, but UI/counts must be honest.
- Initial semantic score floor and freshness SLO come from measured dark-mode evidence, then are reported before launch.
- Principal risks are DB load, result leakage, duplicate embeddings, permanent error residue, weak semantic tails, concurrent work, and false deployment evidence. Mitigations and rollback are in plan §13.
