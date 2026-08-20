# OpenRouter Batch Restart Recovery Implementation Plan

Linked handoff: [`HANDOFF.d/2026-08-18T1409Z-hetz-codex-openrouter-batch-recovery.md`](HANDOFF.d/2026-08-18T1409Z-hetz-codex-openrouter-batch-recovery.md)

Tracking issue: [u2giants/popdam3#92](https://github.com/u2giants/popdam3/issues/92)

## STATUS

Implementation is active in PopDAM issue #92. The shared database lease contract
is live; its narrow terminal-clear follow-up is tracked in shared-db #1211.

| Step | Status | Date | Evidence |
|---|---|---|---|
| 1. Add typed durable external-job state | ✅ done | 2026-08-20 | Worker types and bounded-state test |
| 2. Split Batch API client into stateless submit/read helpers | ✅ done | 2026-08-20 | Provider helper tests |
| 3. Extract image-tag preparation and replay-safe application | ✅ done | 2026-08-20 | Durable handler and result-ID validation |
| 4. Implement submit/wait/resume/apply state machine | ✅ done | 2026-08-20 | Restart simulation proves one POST and same-ID GET |
| 5. Integrate yielding, stops, polling, and stale-run safety | ✅ done | 2026-08-20 | Receipt-gated worker path and 10-second cadence |
| 6. Complete recovery/failure test matrix | ✅ done | 2026-08-20 | 57 worker tests, worker build, frontend build, and lint pass |
| 7. Update operating documentation and diagnostics | ✅ done | 2026-08-20 | Four operating docs updated; waiting-state visual proof captured |
| 8. Land, deploy, and prove a controlled production restart | ⬜ open | 2026-08-18 | Pending commit, CI, Railway, and restart artifacts |

## 1. The ultimate goal

Large discounted image-tagging runs must survive a Railway worker restart without losing the OpenRouter job, submitting the same normal work again, charging twice during ordinary recovery, or applying results to the wrong assets. While OpenRouter is processing, PopDAM must visibly remain waiting rather than call the delay a failure.

After restart, the worker must load the saved batch ID, continue checking that same provider job, validate and apply each result once, advance the PopDAM cursor only after the complete candidate page is reconciled, then continue the run.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed consumer-product artwork. Designers and administrators use `https://dam.designflow.app`; the same React application serves PopSG at `https://sg.designflow.app`. Files originate on Synology, thumbnails live in DigitalOcean Spaces, shared metadata lives in Supabase project `qsllyeztdwjgirsysgai`, and a persistent Node.js/TypeScript worker under `apps/worker/` runs on Railway.

Repository: `https://github.com/u2giants/popdam3`; canonical local path `/worksp/popdam`; default branch `main`. GitHub is code truth. Railway watches `main` and reports deployments under GitHub environment `popdam / production`.

Runtime flow:

1. UI/admin API writes an operation into the `admin_config` row `BULK_OPERATIONS`.
2. `apps/worker/src/operation-loop.ts` polls it, calls `handleBulkAiTag()`, and atomically saves state with database function `update_bulk_operation`.
3. `apps/worker/src/handlers/ai-tagging.ts` fetches candidates, thumbnails and prompt context, validates AI output, then writes asset metadata and relationships.
4. For `:batch`, `apps/worker/src/openrouter.ts` uses `POST /api/beta/batches` and `GET /api/beta/batches/{id}`.

“Durable” means saved in Supabase inside the existing operation object, not held only in Railway process memory.

## 3. What triggered this work

On 2026-08-18 `google/gemini-3.7-flash:batch` exposed two earlier bugs:

1. Catalog validation removed `:batch`; commit `57b60673` fixed exact-ID lookup.
2. Normal chat completion returned OpenRouter 404 requiring `/api/beta/batches`; commit `c1ac8443` added true batch submission/polling.

The second fix remains process-bound. `runOpenRouterBatch()` holds `created.id`, `custom_id` mappings and promise resolvers only in memory (`apps/worker/src/openrouter.ts:433-533`); `batchChatCompletion()` queues them in `pendingBatchQueues` (`:543-555`). A deploy/crash discards them while OpenRouter may still finish and bill the job. Auto-resume can then submit the same assets again.

Reproduce: select the batch model; start enough image tags to create a pending job; capture `openrouter batch: submitted`; restart Railway before completion. The new process has no saved ID and no reconnect path.

## 4. Scope

### In scope

- `ai-tag-untagged`, `ai-tag-all`, `ai-tag-groups`, and dynamic `ai-tag-single-*` when primary/fallback ends in `:batch`.
- Durable batch ID, model, output stage, candidate-page boundary, `custom_id` → asset mapping, timestamps and recovery/error metadata.
- Stateless provider submit/read helpers; restart polling; result reconciliation; replay-safe application; fallback/repair stages; stop/stale behavior; tests/docs/diagnostics.
- Unchanged synchronous behavior for non-batch models.
- Every operation-state writer, including `src/hooks/usePersistentOperation.ts`, `AssetDetailPanel.tsx`, `StyleGroupDetailPanel.tsx`, `QueueManagerDialog.tsx`, `ConflictDialog.tsx`, admin API `update-bulk-op` and `handleSetConfig`, worker stale/auto-resume handling, Start, Queue, Stop, Resume, Dismiss/reset, and Start Fresh.
- A backward-compatible compare-and-swap/lease extension to canonical `update_bulk_operation` if current shared-db inspection confirms there is no existing equivalent. This structural function change must be authored first in `/worksp/shared-db` through branch, PR, preview and AI merge.

### NOT in this plan

- No new table, column, RLS policy, or index. A backward-compatible `update_bulk_operation` compare-and-swap/lease contract is now in scope because an operation `run_id` is not a lock and Railway deploy overlap is normal. It must be authored in canonical `/worksp/shared-db`, never in this app's historical migrations.
- No guardrail, key, credit, pricing, prompt, taxonomy, schema, tag-quality, thumbnail, ERP or PDF changes. The only Vision Bake-Off change is to reject `:batch` until Bake-Off has its own durable design.
- No provider cancellation promise. Reviewed OpenRouter material establishes submit/read, not cancellation. Stop means no more PopDAM submission/application; already-accepted provider work may finish and bill.
- No claim of mathematical exactly-once submission in the tiny crash window after provider POST acceptance but before saving its returned ID. No documented idempotency or list/search recovery contract was found. Minimize and surface this ambiguity; never hide it.
- No manual production database writes except normal app behavior in final controlled proof.

## 5. Current state of the code

Committed, pushed and deployed:

- `57b60673`: exact batch-variant guardrail lookup.
- `c1ac8443`: Batch API support. CI run `32144096107` passed; Railway deployment `5964010747` succeeded.
- Planning baseline after fetch: `bbfaeee7` on 2026-08-18. Use then-current `origin/main` during implementation.

Working pieces:

- `model-capabilities.ts:getModelCapabilities()` accepts the exact variant and detects image/structured output.
- `structured-output.ts:executeStructuredOutput()` builds JSON-schema/JSON-object/tool fallback plans.
- `openrouter.ts:433-533` submits, polls, maps by `custom_id`, parses results; `:543-555` combines concurrent calls; `:560-567` routes `:batch`.
- `openrouter.test.ts:29-85` proves concurrent requests combine and map.
- `ai-tagging.ts:140-311` prepares/writes one asset; writes at `:205-276` update asset, replace AI tags, upsert characters and conditional source rows.
- `operation-loop.ts:349-364` atomically saves an operation; `:632-647` saves after a handler page returns.
- `src/hooks/usePersistentOperation.ts` Start and Queue construct replacement operation objects rather than spreading all live state; Resume can erase a future `external_job`. Stop currently spreads state.
- The admin API and UI writers ultimately replace an operation object. Every writer must be audited, not just the Railway loop.

Half-done/gaps:

- Provider identity/mapping exists only in process memory.
- `updated_at` cannot advance during a long await; another worker can invoke the 10-minute stale detector at `operation-loop.ts:84-89`.
- `OpState` (`types.ts:22-42`) has no external-job field.
- AI `mergeProgress()` (`operation-loop.ts:93-112`) keeps only counters/samples, silently dropping arbitrary state.
- `persistOpState()` currently treats RPC error or missing response as success (`operation-loop.ts:358-360`). That fail-open behavior is unacceptable when saving a newly accepted provider batch ID.
- If a pending handler return omits `nextOffset`, numeric cursor `0` becomes `1` (`operation-loop.ts:625-630`), and `decodeAiTagCursor(1)` later rejects it as legacy.
- Current running UI displays only “Running”; a waiting batch message requires an explicit UI change.
- `railway.toml` does not pin a single replica and a deploy can overlap worker processes. `run_id` alone is not compare-and-swap ownership.

No restart-safety implementation has begun. Every STATUS row is open. The shared-db function contract described in Step 1 is expected unless inspection proves equivalent protection already exists.

## 6. Key findings and root cause

1. Root cause: submission, polling and resolution are one long promise; provider ID never crosses the operation-state boundary.
2. `pendingBatchQueues` is necessarily lost on restart.
3. `BULK_OPERATIONS` is already the correct durable store (`docs/BULK_JOBS.md:111-130`) and is atomically updated.
4. Since operation state saves only after `dispatch()` returns, production batch work must be a handler state machine that returns after submit and each poll.
5. External state belongs top-level in `OpState`, not inside progress that strips unknown fields.
6. Persisting each poll prevents false 10-minute stale failures.
7. Keep the original cursor fixed while pending; advance once only when all page results are reconciled.
8. Official OpenRouter batch material documents POST, GET-by-ID, terminal `completed/failed/cancelled/expired`, and 30-day retention; it does not document idempotent submit/search.
9. Existing writes appear replay-safe (overwrites, delete/upsert, upsert, ignore duplicates) but tests must prove recovery replay.
10. `p_only_if_status="running"` remains mandatory so stale saves cannot overwrite user stop.
11. UI Start/Queue/Resume replacement is a second loss path independent of Railway restart. A restart-safe worker is insufficient until every writer preserves or deliberately refuses to clear a live external job.
12. Row writes can converge on replay, but progress counters are additive. Per-item persisted terminal/applied state is required so only newly terminal items emit counters.
13. Every pending/not-due/applying handler return must explicitly return the unchanged `nextOffset`, including numeric `0`.
14. Current `persistOpState` is fail-open. Saving submission ownership and returned batch IDs requires a hard checked result whose returned row contains the expected revision/owner/ID.

## 7. Approaches considered and rejected

- **Keep awaiting inside `chatCompletion()`:** current design; cannot persist ID, reconnect or avoid stale risk.
- **Module-global map:** lost exactly like current memory.
- **Resubmit every interrupted page:** abandons already-billed work and may double charge/results.
- **Hide state in progress:** AI `mergeProgress()` silently discards it.
- **Persist base64/prompts/full requests:** bloats a lightweight shared config row and duplicates provider-retained inputs; persist compact identifiers only.
- **New shared table now:** unjustified complexity; existing atomic JSON is sufficient until measured otherwise.
- **Treat deterministic `custom_id` as idempotency:** it maps known results but provider does not document cross-batch submit deduplication.
- **Treat stop as provider cancellation:** unsupported contract; stop local work honestly.
- **Silently POST again after an unresolved pre-submit intent:** can rebill; ambiguous submission must interrupt loudly for reconciliation.
- **Rely on `run_id` as a worker lock:** the updater does not compare it and overlapping workers can both POST. Use a real version/lease compare-and-swap.
- **Let old code run after rollback with `status: running` and `external_job`:** old code ignores that field and refetches/resubmits the unchanged cursor. Rollback must stop/drain first.
- **Keep `:batch` in Vision Bake-Off after removing the coordinator:** Bake-Off calls synchronous `chatCompletion()`. Until Bake-Off gets its own durable state machine, filter batch-only models there and make direct synchronous calls throw a clear error.

## 8. Design decisions

### Locked, do not relitigate

1. **2026-08-18, revised after Grok review:** use existing `BULK_OPERATIONS` JSON as the durable owner, with a backward-compatible compare-and-swap/lease enhancement to canonical `update_bulk_operation`. No new table/column unless the measured 100 KB external-state bound is exceeded.
2. **2026-08-18:** production batch tagging becomes a handler-level state machine; low-level client does no multi-hour process-bound loop.
3. **2026-08-18:** persist only IDs/metadata, never images, prompts, keys or full requests.
4. **2026-08-18:** deterministic `custom_id`, mapped authoritatively to asset ID; never array position.
5. **2026-08-18:** cursor never advances while external work/application is unresolved.
6. **2026-08-18:** pending is not failure; persist next poll and yield. Poll no faster than OpenRouter's documented 10-second example unless a retry hint says otherwise.
7. **2026-08-18:** rows are replay-safe and per-item terminal/applied flags make counters replay-safe; cursor/counters commit only for newly terminal items and page cursor advances once after all items finish.
8. **2026-08-18:** non-batch behavior stays synchronous and unchanged.
9. **2026-08-18:** unresolved POST/save ambiguity fails loudly; never silently rebills.
10. **2026-08-18, Grok review:** submit uses a durable two-tick protocol and real lease: tick A saves prepared intent; tick B atomically claims a time-bounded submission lease, then POSTs; all other workers yield. A lease that expires without a batch ID becomes `ambiguous_submission`, never an automatic resubmit.
11. **2026-08-18, Grok review:** every operation writer preserves `external_job` on Resume/Queue and refuses Start Fresh/new Start while a live or ambiguous job exists. Clearing requires a separately designed explicit abandonment flow, out of this implementation.
12. **2026-08-18, Grok review:** durable stages exactly follow `buildStructuredOutputPlan()` plus one JSON repair, `SAME_MODEL_STRUCTURED_RETRY_COUNT`, and existing model-specific fallback eligibility. Batch path does not call today's multi-call `executeStructuredOutput()` as a black box.
13. **2026-08-18, Grok review:** after unsafe coordinator removal, `chatCompletion(:batch)` throws “use asynchronous Batch API”; Vision Bake-Off filters `:batch` until it has its own durable design.
14. **2026-08-18, Grok review:** waiting UI is mandatory, not optional.

### Open implementation judgments

- Field shape/name: recommend versioned `external_job`; must be compact, validated, JSON-serializable and no more than 100 KB at maximum page size.
- State-machine file: add `handlers/ai-tagging-batch.ts` if focused code exceeds about 250 lines; keep reusable preparation/application shared.
- Poll cadence: 10-30 seconds; start at 10, bound/configure only with evidence.
- Single-asset batch: support consistently unless provider rejects one-request batches; then give a clear error requiring non-batch model, never silently change pricing/model.

## 9. The implementation plan

### Phase A: contract and provider client

Natural fresh-session cut after Step 2. Re-read downstream phases before continuing.

### Step 1. Add typed durable external-job state

First inspect `/worksp/shared-db/AGENTS.md`, its clean status, and the canonical `update_bulk_operation` definition. If it has no equivalent compare-and-swap lease, implement a backward-compatible extension in `/worksp/shared-db` first: dedicated branch, timestamped migration, behavior tests, preview proof, PR, AI merge, then production apply through the governed workflow. Preserve existing callers. The new guarded path must compare `state_revision`, atomically claim `submission_owner` plus `lease_expires_at`, and return the saved row. An expired submission lease without a batch ID becomes ambiguity, not permission to submit again.

Change `apps/worker/src/types.ts`: add versioned `OpenRouterBatchJobState` and optional top-level `external_job` on `OpState`. Include `state_revision`, lease fields, phase (`prepared|submitting|pending|applying|ambiguous_submission`), run/cursors, model, batch ID, polling times, and compact per-item records. Each item has deterministic `custom_id`, asset/path identity, method, attempt, and status `prepared|submitted|valid|invalid|applied|failed_terminal`. Never store secrets, images, prompts, results, or request bodies. Runtime-validate every phase and required field; malformed state is a non-transient `contract_error`.

Change `operation-loop.ts`: explicitly set/clear external state, yield only after a hard-checked save, and explicitly return the unchanged `nextOffset` on every unresolved path, including `0`. Replace the fail-open submission-state save with a checked response containing the expected revision, owner, and batch ID.

Audit every full-state writer: `src/hooks/usePersistentOperation.ts`; `src/components/library/AssetDetailPanel.tsx`; `StyleGroupDetailPanel.tsx`; `QueueManagerDialog.tsx`; `ConflictDialog.tsx`; admin API `update-bulk-op`; and `handleSetConfig`. No unguarded replace may drop/regress a live or ambiguous `external_job` or higher `state_revision`. Ban `set-config` for `BULK_OPERATIONS`, or route it through the same server-side compare-and-swap updater. Resume, Queue, Stop, and any accepted reset send the last-seen revision and fail closed if the stored row moved. Start/Start Fresh and a second single-asset click refuse while live/ambiguous. Single-asset completion must not write `idle` over a live job. Dismiss/reset is also a clear and must refuse while live/ambiguous. Old updater callers may remain compatible only when they cannot clobber protected state; the server checks its stored row, never trusts the client's copy. Do not expose a generic clear button.

**You'll know it worked when** shared-db preview tests prove only one worker can claim a revision/lease, app tests prove all writers preserve/refuse correctly, cursor `0` survives, and no provider POST can follow an unproved save.

### Step 2. Make the provider client stateless

Change `openrouter.ts`, preferably extracting `openrouter-batch.ts`:

- Before coding, capture one real secrets-scrubbed POST/GET fixture from the beta API and record whether completed output is inline or file-backed. Probe a documented/list endpoint for crash reconciliation only if the official contract or captured response supports it; never invent search behavior.
- Pure builder converts `:batch` to base model, strips unsupported temperature, preserves messages/schema/provider, uses `popdam:<run_id>:<asset_id>:<method>:<attempt>` as caller `custom_id`, and caps a provider batch at 100 requests.
- `submitOpenRouterBatch()` performs one POST and returns ID/status; never polls.
- `getOpenRouterBatch()` performs one GET and handles the observed inline/file result contract.
- Reuse/export one-item success/error parser; sanitize logs/errors.
- Unknown nonterminal statuses remain pending. A completed batch without mappable results is a loud `contract_error`.
- Remove the unsafe in-memory coordinator. `chatCompletion()` with `:batch` throws a clear “use asynchronous Batch API” error, and Vision Bake-Off filters/rejects batch-only variants until it has durable state.

**You'll know it worked when** fixture-backed tests prove exact POST/GET, result retrieval, base conversion, temperature removal, terminal normalization, shuffled mapping/error parsing, malformed bodies, the 100-item bound, synchronous rejection, and no helper sleeps/polls.

### Phase B: tagging state machine

Natural fresh-session cut after Step 5. Update STATUS/current state, then re-read Phase C.

### Step 3. Extract preparation and replay-safe application

Change `handlers/ai-tagging.ts` and `ai-tagging-shared.ts`:

- Extract `prepareTagAsset(assetId, force)` for fetch/skip/thumbnail/prompt/prepared request.
- Extract `applyTagAssetResult(prepared, tagData, model)` preserving every write/guard currently at `ai-tagging.ts:205-276`.
- Keep `tagSingleAsset()` using these helpers so synchronous behavior is identical.
- Make replay converge after a crash midway through application.

**You'll know it worked when** existing synchronous tests stay green and applying the same result twice produces identical final fake DB rows and no duplicate reported counters.

### Step 4. Implement submit/wait/resume/apply

In `ai-tagging.ts` or new `ai-tagging-batch.ts`:

- Detect batch model before current per-asset promises.
- With no external state: fetch the existing keyset page; prepare eligible assets bounded-concurrently; record normal skips/failures; build deterministic mappings and requests for the first method from `buildStructuredOutputPlan()`.
- Tick A persists prepared intent and yields without POST. Tick B atomically claims its revision/lease, POSTs once, and immediately hard-saves the returned ID before yielding. If that save cannot be proved, persist/raise `ambiguous_submission`; never POST again automatically.
- On saved state, branch before candidate fetch. Before next poll, yield with unchanged cursor/state. When due, issue one GET.
- Pending/validating/running updates timestamps and remains running. Terminal failure/cancel/expiry fails clearly retaining batch ID/status.
- Completion maps every result by persisted `custom_id`; reject unknown/duplicate/missing IDs; validate using the current tag contract. Ambiguous or malformed completed output is a non-transient `contract_error`.
- Follow the live output ladder exactly: every method from `buildStructuredOutputPlan()`, one JSON repair, `SAME_MODEL_STRUCTURED_RETRY_COUNT`, then only the existing model-specific fallback when eligible. Every provider submission in this batch-only path uses the Batch API. Valid peers are never resubmitted.
- On restart or repair, re-fetch/re-prepare only unfinished items from asset IDs; persisted state deliberately contains no image or prompt.
- Apply valid results with Step 3. Mark each item `applied` durably. Emit counters only for items newly made terminal in that successful state revision; additive progress never replays. Clear state and advance once only after every item is terminal.
- Restart reads saved state and GETs before any fetch/POST.
- `ambiguous_submission` never auto-POSTs; interrupt with run/page/timestamp identifiers.

**You'll know it worked when** process A submits/saves ID, all module memory is discarded, process B receives only serialized `OpState`, GETs the same ID, performs zero POSTs, maps/applies results, clears state and advances once.

### Step 5. Integrate polling, stops and stale safety

Change `operation-loop.ts` and tagging tests:

- Honor yield after guarded persistence, keeping other lanes responsive.
- Pending state is running. Persist on a real GET or at most one heartbeat per 60 seconds; an early/not-due tick does no GET and no write. Fake clocks advance by the configured poll interval, not tiny loop increments. Healthy pending state never ages past the 10-minute stale threshold.
- Check fresh status before poll and before apply. Stop means no more provider calls/retries/writes; do not overwrite it.
- Auto-resume with saved pending state performs GET, never new candidate fetch/POST. Overlapping workers use the real revision/lease guard, not `run_id` as a lock.
- Pending never increments failures.

**You'll know it worked when** fake-clock tests pass >10 minutes without stale interruption, enforce cadence/fairness, and prove stop-before-apply produces no tag writes.

### Phase C: tests, docs, landing

### Step 6. Complete the test matrix

Implement every named §10 test with injected clock/fetch/DB/state writer; no real sleeps.

**You'll know it worked when** worker tests/build, current CI-equivalent root commands and `git diff --check` pass.

### Step 7. Update docs and diagnostics

Update `docs/BULK_JOBS.md`, `INFRASTRUCTURE.md`, `MODEL_RULES.md`, and a prescribed-shape `KNOWN_QUIRKS.md` entry: external state/phases, cadence, 30-day retention, cursor/restart/stop/ambiguity/operator diagnosis. Change `TaggingProgress`/`StatusBadge` so the UI explicitly shows “Waiting for OpenRouter batch {short ID}; last checked {time}” rather than only “Running.” Update this plan and handoff as execution lands.

**You'll know it worked when** an operator can distinguish pending/failure, identify batch ID and exact recovery path without source; any UI change has screenshot proof.

### Step 8. Land, deploy and prove restart

- First deployment is a cutover: drain any old in-memory batch and do not start a large batch during the deploy window. Confirm no old worker can keep processing before enabling new batch runs.
- Verify commit identity, stage only own files, commit directly to `main`, reconcile concurrent pushes, push, await CI.
- Verify Railway exact-SHA deployment success.
- Controlled production test on a tiny, already-tagged, re-tag-safe asset set via normal UI, never the whole library. Record operation key, run ID, batch ID, asset IDs and pre-state in a secrets-free ignored artifact.
- Once batch ID is durable, restart only Railway through normal owner. Prove after restart: same ID GET, zero replacement POST/ID for same run/page, each asset applied once, cursor once.
- Prove production logs show one submitted ID followed by GETs for that same ID. Update/close issue #92 only with commit, CI, deployment and restart artifacts. Retire handoff only when complete.

**You'll know it worked when** exact SHA is green/deployed and controlled restart proves same ID/no duplicate/correct mapping.

## 10. Tests required

Provider tests (`openrouter.test.ts` or new `openrouter-batch.test.ts`):

1. `submit performs one POST and returns without polling`.
2. `get performs one GET for supplied ID`.
3. `builder strips :batch and unsupported temperature but preserves messages/schema`.
4. `parser maps custom_id regardless of order`.
5. `parser rejects duplicate unknown missing malformed and per-item failed results`.
6. `normalizes completed failed cancelled canceled expired`.
7. `errors/logs omit key and base64`.
8. `captured inline or file-backed fixture is decoded exactly`.
9. `unknown nonterminal remains pending; completed without results is contract error`.
10. `batch builder rejects more than 100 items`.
11. `chatCompletion batch variant throws asynchronous-only guidance`.

Tagging tests (`handlers/ai-tagging.test.ts`):

12. `pending durable batch survives process restart and resumes GET without POST`.
13. `persist error after POST becomes ambiguity and produces zero second POSTs`.
14. `pending/validating yield with explicit unchanged cursor including numeric zero`.
15. `next_poll_at prevents early GET and early persistence`.
16. `healthy pending cannot go stale after ten minutes with at most 60-second heartbeat`.
17. `completion maps shuffled results by persisted custom_id not order`.
18. `cursor advances once after every item terminal`.
19. `restart during application converges rows and emits counters once`.
20. `repair restart re-prepares unfinished items only`.
21. `invalid subset enters durable JSON repair; valid peers not resubmitted`.
22. `full live method/same-model/fallback ladder survives restart and remains bounded`.
23. `failed/cancelled/expired retain batch ID and interrupt loudly`.
24. `malformed or ambiguous state is contract error and never resubmits`.
25. `stop before poll makes no provider call`.
26. `stop after completion before apply makes no writes`.
27. `single dynamic operation uses the same durable state machine`.
28. `non-batch stays synchronous`.

Operation-loop tests (create `operation-loop.test.ts` if needed):

29. `external_job persists outside progress and clears explicitly`.
30. `yield returns only after hard-checked persistence`.
31. `guarded save cannot overwrite stop or a newer revision`.
32. `auto-resume retains external state/original cursor`.

UI/API and shared-db tests:

33. `Resume and Queue preserve external job through hook and admin API`.
34. `Start and Start Fresh refuse a live or ambiguous external job`.
35. `only one worker can claim a prepared revision and lease`.
36. `expired submission lease without batch ID becomes ambiguity`.
37. `existing update_bulk_operation callers remain compatible`.
38. `Vision Bake-Off rejects batch-only variants clearly`.
39. `second single-asset click cannot replace a live or ambiguous job`.
40. `set-config cannot clobber BULK_OPERATIONS protected state`.
41. `stale Resume/Queue/Stop/reset cannot overwrite a newer revision or batch ID`.
42. `single-asset completion cannot write idle over a live external job`.

Commands:

```bash
cd /worksp/popdam/apps/worker
npm test
npm run build
cd /worksp/popdam
git diff --check
```

Also run current commands from `.github/workflows/ci.yml`; workflow wins if this plan becomes stale.

## 11. Constraints, standing rules and gotchas

- Plain business English for user errors/reporting.
- Main-only. Correct identity: `Albert Hazan <u2giants@users.noreply.github.com>`. Never stage unrelated files.
- Production/shared infrastructure read-only except normal authorized GitHub→Railway app deployment and controlled normal app behavior.
- Shared DB structure only through `/worksp/shared-db`; the backward-compatible revision/lease function enhancement must land there first unless inspection proves an equivalent already exists.
- Prove project `qsllyeztdwjgirsysgai` before any manual production data write; controlled proof should avoid ad hoc SQL.
- OpenRouter key is Railway `OPENROUTER_API_KEY`; never print/persist it. 1Password vault `vibe_coding`, search existing AI provider item; never invent/record values.
- Never persist/log keys, auth headers, images, prompts or full bodies.
- Batch API is beta and retains data 30 days; unknown contracts fail loudly.
- Pending is not failure. Cursor fixed until reconciliation. `custom_id` authoritative. Guard status writes.
- Healthy polling must avoid 10-minute stale rule and yield to other lanes.
- Preserve batch temperature removal and synchronous non-batch behavior.
- No silent fallback on ambiguity/malformed/missing/unknown state.
- Audit every full-state writer. Preserve external state on Resume/Queue and refuse new starts while live/ambiguous.
- Keep serialized external state under 100 KB at the maximum 100-item page; exceeding it stops implementation for a separate governed storage design.
- Keep this plan current as steps execute.

## 12. Access and environment

- `/worksp/popdam`, `u2giants/popdam3`, `main`; fetch before work.
- `/worksp/shared-db`, `u2giants/shared-db`; read its `AGENTS.md`, require a clean checkout, then use its branch/PR/preview/merge workflow for the lease contract.
- `gh` authenticated on this machine; verify with `gh auth status` and real read.
- Railway deploys worker from `main`, environment `popdam / production`.
- URLs: `https://dam.designflow.app`, `https://sg.designflow.app`.
- Supabase prod `qsllyeztdwjgirsysgai`; reads allowed, structure governed separately.
- Worker commands in `apps/worker/package.json`; CI in `.github/workflows/ci.yml`.
- Official Batch endpoints: `POST https://openrouter.ai/api/beta/batches`; `GET .../batches/{id}`; results/inputs retained 30 days.
- Secrets: 1Password `vibe_coding`, existing AI-provider/OpenRouter item; Railway owns runtime key.
- Final controlled test needs existing PopDAM admin session. Ask for access to do it yourself before asking Albert to click.

## 13. Definition of done, risks and open questions

### Done checklist

- [ ] Shared-db revision/lease contract is preview-tested, merged, applied, and backward-compatible before dependent app code.
- [ ] STATUS evidence current; typed/validated per-item state; stateless helpers; two-tick intent/lease/ID protocol.
- [ ] Restart GETs saved ID with zero normal replacement POST.
- [ ] Pending runs/yields/no false stale; stop/failure/expiry/malformed/missing/repair/fallback/ambiguity proven.
- [ ] Replay-safe writes; cursor/counters once; non-batch unchanged.
- [ ] Tests/build/CI-equivalent commands green; docs/plan/handoff current.
- [ ] Correct commit pushed to `main`; CI green; Railway exact SHA success.
- [ ] Controlled restart proof linked on #92; issue closed only then; handoff retired under successor rule.

### Risks/mitigations

1. POST accepted before ID saved: minimize gap, persist intent, ambiguous restart stops rather than rebills. Adopt future documented idempotency/search only with contract test.
2. JSON size: store compact IDs; measure maximum. If unsafe, stop and create separate shared-db plan.
3. Concurrency/stale writes: compare-and-swap revision plus expiring submission lease; `run_id` is identity, not a lock.
4. Beta drift: defensive normalization and actionable batch IDs.
5. Crash during apply: replay-safe writes; counters/cursor after all writes.
6. Stop may not cancel bill: state/docs say so.
7. Starvation: yield every submit/poll and honor next poll.
8. Repair cost: retry failed subset only.

### Open questions and criteria

- Provider idempotency/search remains undocumented. Use only if official contract appears and is tested; otherwise ambiguity handling stays.
- Measure maximum serialized mapping. Existing JSON stays if comfortably bounded; otherwise structural work is a new governed plan.
- One-request batch: support unless provider rejects; then clear non-batch-model requirement, never silent pricing change.

### Rollback

Before deploying old code, stop/drain every operation with an external job and confirm no provider batch remains running or ambiguous. Old code ignores `external_job` and must never receive a running operation at an unchanged cursor. Capture ID/mapping in a secrets-free incident artifact, finish/reconcile it with the new code where possible, then revert through GitHub and let Railway deploy the prior SHA. The backward-compatible shared-db function may remain. Never let rollback silently submit replacement work.

## Mandatory self-audit

1. **Can a zero-context new session execute perfectly without questions?** Yes. §§1-4 define goal/system/trigger/scope; §§5-8 capture code state/findings/dead ends/decisions; §9 gives ordered file/function steps and gates; §§10-13 give exact tests/rules/access/landing/risks/rollback.
2. **Does it carry all current background, nuance and rejected reasoning?** Yes. §§3,5-7 record both earlier bugs, deployed evidence, memory/stale/progress traps, provider contract limits, and every rejected approach; §8 locks resulting decisions.
3. **Is the goal clear enough for judgment if a step is wrong?** Yes. §1 states business truth and goal-wins rule; invariants in §§8,11,13 guide choices.

Checklist: all 13 sections; plain goal; zero-context detail; rejected attempts; concrete steps/gates; locked/open decisions; explicit out-of-scope; named tests; defined identifiers/paths/URLs/SHAs; secret locations only; commit/CI/deploy definition; reciprocal handoff links. **Self-audit passed.**

## Grok 4.6 review

Grok 4.6 reviewed this plan three times in the same `openrouter-batch-recovery-plan` session. Its first two passes found material gaps in writer safety, submission ownership, counter replay, rollback, cursor handling, output parity, Bake-Off behavior, UI visibility, provider-contract evidence, and tests. Those findings are incorporated above. Final verdict: **SAFE FOR ZERO-CONTEXT IMPLEMENTATION**. Total reported Grok cost: **$0.54548818**.
