# OpenRouter Batch Restart Recovery Implementation Plan

Linked handoff: [HANDOFF.d/2026-10-11T2300Z-hetz-codex-open-issues-coordinator-continuation.md](HANDOFF.d/2026-10-11T2300Z-hetz-codex-open-issues-coordinator-continuation.md)

Tracking issue: [u2giants/popdam3#92](https://github.com/u2giants/popdam3/issues/92)

## STATUS — read this first

**Updated October 11, 2026.** The direct-Gemini path and subsequent crash/receipt recovery code have merged, including #317. The September “unshipped branch” and reset-contract blockers are superseded; do not repeat that shipment. This session inspected production state but submitted no paid batch and recovered no protected job.

**Next session:** begin with Step 8: refresh current deployed code and protected job state, reconcile existing external jobs safely, then obtain the retained same-provider-ID restart/exactly-once proof. Keep Muse Spark 1.3 Contributor selected, with no substitution or fallback. Obtain the existing tagging owner’s separate paid-lane and main-merge/restart releases before conflicting work; an idle sample or another deployment is not release. Revalidate actual runtime and frozen review inputs after any deployment change. Existing failed receipts may be read/reconciled only through their exact reviewed protected contract; preserve the explicit user-stop hold. Four failed GET receipts do not prove successful restart acceptance. No new paid batch or convenient model switch is authorized by this plan. Follow current technical task/reviewer gates. Read [HANDOFF.d/2026-10-11T2300Z-hetz-codex-open-issues-coordinator-continuation.md](HANDOFF.d/2026-10-11T2300Z-hetz-codex-open-issues-coordinator-continuation.md) and current [#92](https://github.com/u2giants/popdam3/issues/92) comments. Evidence: [issue #143 closeout receipt](https://github.com/u2giants/popdam3/issues/143#issuecomment-6112766070); #92 latest acceptance comment October 11, 2026 at 11:58 AM EDT.

**Settled decision:** malformed batch answers use JSON repair on the SAME model; do not substitute a different model. Historical September implementation detail remains in the plan body for rationale, not as current deployment status.

| Step | Status | Date | Evidence |
|---|---|---|---|
| 1. Add typed durable external-job state | ✅ done | 2026-08-20 | Worker types and bounded-state test |
| 2. Split Batch API client into stateless submit/read helpers | ✅ done | 2026-08-20 | Provider helper tests |
| 3. Extract image-tag preparation and replay-safe application | ✅ done | 2026-08-20 | Durable handler and result-ID validation |
| 4. Implement submit/wait/resume/apply state machine | ✅ done | 2026-08-20 | Restart simulation proves one POST and same-ID GET |
| 5. Integrate yielding, stops, polling, and stale-run safety | ✅ done | 2026-08-20 | Receipt-gated worker path and 10-second cadence |
| 6. Complete recovery/failure test matrix | ✅ done | 2026-08-24 | 63 worker tests, worker build, frontend build, and lint pass |
| 7. Update operating documentation and diagnostics | ✅ done | 2026-08-20 | Four operating docs updated; waiting-state visual proof captured |
| 8. Land, deploy, and prove a controlled production restart | 🟨 partial | 2026-10-11 | Current recovery implementation and receipt-loss fix #317 (cbc31d36) shipped. Live same-provider-ID batch crossing an ordinary restart and exactly-once clear remain unproven; protected historical jobs require governed reconciliation. |
| 9. Add a settings-exposed compatible provider route | ✅ code shipped; live acceptance remains in Step 8 | 2026-10-11 | Direct Gemini Batch implementation has merged. Old unshipped WIP/reset-contract descriptions below are historical; do not deploy the rejected branch. |


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

## 3. What triggered this work — historical, fixed by Steps 1-7

On 2026-08-18 `google/gemini-3.7-flash:batch` exposed two earlier bugs:

1. Catalog validation removed `:batch`; commit `57b60673` fixed exact-ID lookup.
2. Normal chat completion returned OpenRouter 404 requiring `/api/beta/batches`; commit `c1ac8443` added true batch submission/polling.

At that time, the second fix remained process-bound. `runOpenRouterBatch()` held
`created.id`, `custom_id` mappings and promise resolvers only in memory, while
`batchChatCompletion()` queued them in `pendingBatchQueues`. A deploy/crash could
discard them while OpenRouter still finished and billed the job. Steps 1-7 replaced
this design with the deployed durable state machine described in §5; do not recreate
the old process-bound path.

The original reproduction was to restart Railway after submission and observe that
the new process had no saved ID. That reproduction is historical and no longer
describes current main.

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

Deployed and verified as of 2026-09-22:

- The restart-safe OpenRouter state machine shipped at `1c042fb9`; the permanent
  preparation/starvation repairs shipped at `f6714b1a` and `1b065171`; public-URL
  batch media handling shipped at `25232c60`. All four commits are ancestors of
  current `origin/main`.
- Provider identity, deterministic `custom_id` mapping, cursor position, phases,
  polling times and compact per-item state now persist in `BULK_OPERATIONS`.
- The shared-db guarded updater enforces revision/lease ownership, protects an
  unbound expired lease as ambiguous, and protects terminal provider pointers.
- Worker restart simulations prove one POST followed by same-ID GET after state
  reconstruction. Waiting-state diagnostics and safe stop/stale handling are live.
- Three bounded production attempts durably saved provider IDs without replacement
  submission, but OpenRouter terminally rejected all before a Railway restart could
  prove recovery. The final one used a public URL and established that the account's
  only advertised vision batch route rejects image input in its actual batch path.

Remaining acceptance and historical gaps:

- Step 8 still lacks the required live same-ID-across-Railway-restart and
  exactly-once application artifact.
- **Historical September WIP, superseded by the merged implementation recorded in STATUS:** the remote direct Gemini Batch alternative at
  `/worksp/popdam-issue92-gemini-batch` commit `653cb150` passes its local tests/
  builds but is not shippable. A definitive provider POST rejection consumes the one-use receipt,
  and the current shared-db contract has no narrow safe reset for that known-not-
  accepted outcome. Those WIP/reset-contract blockers are historical; do not resume or ship that branch. Current protected recovery and acceptance gates are in the linked continuation.
- Production Image Tagging remains on Muse, not a batch route. Re-verify the exact
  saved model before acting because Settings can change it.

## 6. Historical root cause and locked design findings

1. Original root cause, now fixed: submission, polling and resolution were one long
   promise, so the provider ID never crossed the operation-state boundary.
2. The old `pendingBatchQueues` memory was necessarily lost on restart; current main
   no longer relies on it for durable recovery.
3. `BULK_OPERATIONS` is already the correct durable store (`docs/BULK_JOBS.md:111-130`) and is atomically updated.
4. Production batch work therefore uses a handler state machine that returns after
   submit and each poll; this is implemented and must be preserved.
5. External state belongs top-level in `OpState`, not inside progress that strips unknown fields.
6. Persisting each poll prevents false 10-minute stale failures.
7. Keep the original cursor fixed while pending; advance once only when all page results are reconciled.
8. Official OpenRouter batch material documents POST, GET-by-ID, terminal `completed/failed/cancelled/expired`, and 30-day retention; it does not document idempotent submit/search.
9. Writes are replay-safe through overwrites/delete-upserts and tested result-ID
   reconciliation; new provider routes must extend the recovery replay tests.
10. `p_only_if_status="running"` remains mandatory so stale saves cannot overwrite user stop.
11. Every UI/admin writer must continue preserving or deliberately refusing to
    clear a live external job; this deployed protection is part of restart safety.
12. Per-item persisted terminal/applied state keeps additive progress counters
    replay-safe; preserve it for every provider route.
13. Every pending/not-due/applying return must keep the unchanged `nextOffset`,
    including numeric `0`.
14. Submission ownership and returned batch IDs require a hard-checked guarded save
    containing the expected revision, owner and ID; never restore the old fail-open
    behavior.

## 7. Approaches considered and rejected

- **Keep awaiting inside `chatCompletion()`:** pre-fix design; could not persist ID,
  reconnect or avoid stale risk.
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

Steps 1–7 and provider-route implementation in Step 9 retain dated implementation history; do not repeat completed work. Current remaining execution is Step 8 under the continuation’s exact ownership/review/runtime gates. At every phase or acceptance boundary, re-read **all remaining phases and steps through Step 9**, report assumption/interface/file-name/provider/authority drift, update STATUS and downstream instructions, and only then cut context or continue.

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

Preserve the deployed recovery test matrix: injected clock/fetch/DB/state writer; same-ID restart with zero replacement POST; shuffled/duplicate/missing result mapping; stop/stale/lease/ambiguity handling; receipt/reset refusal; replay-safe counters and cursor zero. Run the current repository’s existing test commands; no real sleeps or provider calls.

**You'll know it worked when** worker tests/build, current CI-equivalent root commands and `git diff --check` pass.

### Step 7. Update docs and diagnostics

Update `docs/BULK_JOBS.md`, `INFRASTRUCTURE.md`, `MODEL_RULES.md`, and a prescribed-shape `KNOWN_QUIRKS.md` entry: external state/phases, cadence, 30-day retention, cursor/restart/stop/ambiguity/operator diagnosis. Change `TaggingProgress`/`StatusBadge` so the UI explicitly shows “Waiting for OpenRouter batch {short ID}; last checked {time}” rather than only “Running.” Update this plan and handoff as execution lands.

**You'll know it worked when** an operator can distinguish pending/failure, identify batch ID and exact recovery path without source; any UI change has screenshot proof.

### Step 8. Land, deploy and prove restart

- **Historical initial cutover; current deployments require explicit owner restart-window release and fresh exact-input review.** First deployment is a cutover: drain any old in-memory batch and do not start a large batch during the deploy window. Confirm no old worker can keep processing before enabling new batch runs.
- Verify commit identity, stage only owned files, create a current-main feature
  branch and pull request, pass required checks/review, then merge through the
  repository's protected-main workflow. Never push directly to protected `main`.
- Verify Railway exact-SHA deployment success.
- **Unmet successful batch acceptance criterion, not current paid/model-switch authority:** a controlled production test would use a tiny, already-tagged, re-tag-safe asset set via normal UI, never the whole library. Under current Muse-only authority, do not fabricate a batch or switch models to manufacture this proof. Proceed only if an actually authorized compatible route exists; otherwise keep this criterion open. Record operation key, run ID, batch ID, asset IDs and pre-state in a secrets-free ignored artifact.
- Once batch ID is durable, restart only Railway through normal owner. Prove after restart: same ID GET, zero replacement POST/ID for same run/page, each asset applied once, cursor once.
- Prove production logs show one submitted ID followed by GETs for that same ID. Update/close issue #92 only with commit, CI, deployment and restart artifacts. Retire handoff only when complete.

**You'll know it worked when** exact SHA is green/deployed and controlled restart proves same ID/no duplicate/correct mapping.

### Step 9. Historical settings-exposed direct Gemini Batch implementation — shipped, superseded

The following records the historical implementation branch `codex/issue-92-direct-gemini-batch`; STATUS supersedes its former shipment/reset blockers. Do not resume the rejected WIP or repeat this shipment. The
governed reset contract (shared-db #3418 / PR #3426) is used for parsed 400/422
rejections; terminal provider states, transient polling, batch-model scope,
cached catalogs, same-model JSON repair for batch results, pre-POST receipt
handling and the missing-RPC (PGRST202) failure are covered by worker and
settings tests. The former remaining instructions required exact review/reset deployment and a temporary Direct Gemini selection followed by Muse restoration. Those instructions are historical and **not authorized continuation actions**. Current code is merged; current production authority is Muse Spark 1.3 Contributor without substitution/fallback. Refresh runtime/provider pointers under the current owner holds, reconcile only the exact reviewed saved jobs, and leave successful same-ID restart/exactly-once acceptance open until genuinely proved without changing settled authority.

### Legacy OpenRouter route — completed Steps 1-7

- [x] Shared-db revision/lease contract is preview-tested, merged, applied, and backward-compatible before dependent app code.
- [x] STATUS evidence current; typed/validated per-item state; stateless helpers; two-tick intent/lease/ID protocol.
- [x] Automated restart simulation GETs the saved ID with zero normal replacement POST.
- [x] Legacy OpenRouter pending runs/yields/no false stale; its stop/failure/expiry/
  malformed/missing/ambiguity paths are proven.
- [x] Replay-safe writes; cursor/counters once; non-batch unchanged.
- [x] Legacy-route tests/build/CI-equivalent commands green; original docs deployed.
- [x] Legacy-route commits are on `main`; CI and Railway exact-SHA deployment passed.

### Direct Gemini route — historical implementation checklist; remaining acceptance is Step 8

- [x] Provider-route and guarded reset implementation merged; September WIP/review/reset-contract shipment blockers are superseded by STATUS. Reconfirm current deployed contract before any recovery rather than repeating implementation or opening another structural issue.
- [x] Terminal states, transient polling, catalog/model scope and receipt/reset handling are covered by the deployed tests; preserve them.
- [ ] Fresh exact-runtime recovery receipts and successful same-ID restart/exactly-once proof remain required on #92. Failed historical receipt accounting is not successful acceptance. No temporary Gemini selection or new paid submission is authorized; current Muse authority and both owner holds remain binding.

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

1. **Can a zero-context new session execute perfectly without questions?** Yes. §§1-4 define goal/system/trigger/scope; §§5-8 capture code state/findings/dead ends/decisions; §9 gives ordered file/function steps and gates; §9 contains the current test matrix, landing/acceptance gates, risks and rollback; current access and custody are in the linked continuation.
2. **Does it carry all current background, nuance and rejected reasoning?** Yes. §§3,5-7 record both earlier bugs, deployed evidence, memory/stale/progress traps, provider contract limits, and every rejected approach; §8 locks resulting decisions.
3. **Is the goal clear enough for judgment if a step is wrong?** Yes. §1 states business truth and goal-wins rule; invariants in §§8,11,13 guide choices.

Checklist: §§1–9 and current linked continuation; plain goal; zero-context detail; rejected attempts; concrete steps/gates; locked/open decisions; explicit out-of-scope; named tests; defined identifiers/paths/URLs/SHAs; secret locations only; commit/CI/deploy definition; reciprocal handoff links. **Self-audit passed.**

## Grok 4.6 review

Grok 4.6 reviewed this plan three times in the same `openrouter-batch-recovery-plan` session. Its first two passes found material gaps in writer safety, submission ownership, counter replay, rollback, cursor handling, output parity, Bake-Off behavior, UI visibility, provider-contract evidence, and tests. Those findings are incorporated above. Final verdict: **SAFE FOR ZERO-CONTEXT IMPLEMENTATION**. Total reported Grok cost: **$0.54548818**.
