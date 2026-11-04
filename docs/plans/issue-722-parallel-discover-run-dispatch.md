# Plan: Review finding: u2giants/popdam3#717 Tagging: full run pages through files and steps aside for nightly grouping (#680) (u2giants/popdam3#722)
Issue: https://github.com/u2giants/popdam3/issues/722
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

**Drift note (Nov 4, 2026, 5:00 PM EST):** PR #727 merged to `main` at 4:53 PM EST as `4720dd2e` (guard at `apps/worker/src/handlers/ai-tagging.ts` now skips the asset-ID check for discover runs). Treat any step that says "merge #727" as done pending worker heartbeat SHA ≥ `4720dd2e`; re-verify the remaining findings against that commit.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Confirm each finding is still open on `main` | ⬜ open | Checked 2026-11-04 4:45 PM EST on `origin/main` 4409e2d3 (PR #717 merged 4:41 PM EST): all four findings still present, see §5. No fixer-bot PR for #722 exists |
| 1 | Finding 1 — discover run passes the explicit-ID guard (`ai-tagging.ts:1191`) | ⬜ open | |
| 2 | Finding 2 — one `acceptedModels` list for both paths (`:1211`, `:1337`) | ⬜ open | |
| 3 | Finding 3 — `discover` type-checked; `max_cursor` rejected clearly in discover mode (`ai-tag-parallel.ts:10,15`) | ⬜ open | |
| 4 | Finding 4 — refused yield falls through to promotion (`operation-loop.ts:1226-1229`) | ⬜ open | |
| 5 | Tests (handler-level discover dispatch, accepted models, validator, yield) | ⬜ open | |
| 6 | Docs: `docs/MODEL_RULES.md:38` | ⬜ open | |
| 7 | PR, CI, merge, Railway worker deployed | ⬜ open | |
| 8 | Live proof: a discover run tags its first page in production; close #722 | ⬜ open | |

Where a fresh session starts: Step 0, then Steps 1-4 in order (they are independent edits in three files; do them in one branch).

---

## 1. The ultimate goal

Albert wants the whole PopDAM library tagged by the chosen vision models in one run that does not have to be fed a list of file IDs, that pays for no file twice, and that steps aside each night so the 1:00 AM style-group rebuild still happens. PR #717 added that "whole-library" (`discover`) mode, but as merged it cannot run at all: the first page fails with "Single-asset tag operation has no asset ID". When this plan is done, a whole-library run starts, tags page after page, skips files already tagged by any accepted model (including the Meta-direct model), rejects a mistyped configuration with a clear message, and the nightly yield never wastes a worker tick.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Spending money twice on a file, or a run that silently dies, are both worse than a slower run.

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product art; staff use https://dam.designflow.app. Bulk AI work runs in the **Railway worker** (`apps/worker/`, Node + TypeScript, auto-deploys from `main` on every push; identifiers in `docs/INFRASTRUCTURE.md:52-60`). Operations are rows in `admin_config.BULK_OPERATIONS`, ticked by `apps/worker/src/operation-loop.ts`; file tagging lives in `apps/worker/src/handlers/ai-tagging.ts`; the parallel-run configuration is `admin_config.AI_TAG_PARALLEL_RUN`, validated by `apps/worker/src/handlers/ai-tag-parallel.ts`. Operations are started from the web UI's Settings → Diagnostics panel (`src/components/settings/diagnostics/types.ts:69` names `ai-tag-parallel` "Parallel File Tagging"). Repo `u2giants/popdam3`, branch `main`. Model rules: `docs/MODEL_RULES.md`.

## 3. What triggered this work

PR #717 (head `23a612a1`, merged into `main` as 4409e2d3 at 4:41 PM EST Nov 4) added `discover: true` to `AI_TAG_PARALLEL_RUN` and a yield rule in the tick loop. The advisory review (GLM, run 41915003364) found:

1. **Critical** — a discover run has no `params.asset_ids` by definition (`ai-tag-parallel.ts:10`), but the only dispatcher (`operation-loop.ts:904`) calls `handleBulkAiTag(opState, true, {}, true, true)` with `requireAssetIds = true`, and `ai-tagging.ts:1191-1193` fails the operation when `assetIds` is empty. The tick loop's `!result.ok` branch (`operation-loop.ts:1665-1699`) classifies that message as non-transient → status `failed`. No asset is ever tagged.
2. **Secondary** — the discovered-candidates path (`ai-tagging.ts:1337`) builds `acceptedModels` without `"meta-direct/muse-spark-1.3-contributor"`, unlike the explicit path (`:1211`). The skip check in `tagSingleAsset` (`:983`) only skips when the saved `ai_model` is accepted, so a discover run re-tags (paid calls) every file the Meta-direct model already finished.
3. **Minor** — `max_cursor` with `discover: true` throws "Invalid parallel tagging trial cursor" because the bound becomes 0 (`ai-tag-parallel.ts:15`); `discover` is not type-checked (`:10`), so `discover: "yes"` silently runs as an explicit run and then fails on the explicit-ID rule.
4. **Minor** — `operation-loop.ts:1229` `return`s even when the yield's compare-and-swap write was refused, so that tick promotes nothing.

Reproduce (production, read-only): there is no discover run in `BULK_OPERATIONS` yet; the bug is proven by the test in Step 5 (`handleBulkAiTag` with `requireAssetIds = true` and a discover config returns `ok: false, error: "Single-asset tag operation has no asset ID"` on `main`).

## 4. Scope

In: the four findings, their tests, one doc line, deploy, live proof.

**NOT in this plan:**
- Changing how operations are started from the UI, or adding a UI control for `discover`.
- The Meta-direct (`meta-responses`) durable path (`ai-tagging.ts:1142-1182`) — a discover run never enters it because `parallel` is set (`!parallel` in the condition at `:1142`).
- The failover-to-backup behaviour from PR #710 / open PR #724 (`claude/backup-catalog-failover`) — different code (`tagSingleAsset` retry loop). If #724 merges first, rebase; no overlap in the lines this plan edits.
- Re-tagging policy, prompt wording, `finishTagResult` rules (see `docs/plans/issue-715-tag-finish-designer-name-guard.md`).
- Any DB change (none is needed; `get_ai_tag_candidates` is unchanged).

## 5. Current state (verified on `origin/main` @ 4409e2d3, 2026-11-04 4:45 PM EST; the worktree this plan was written in is behind `main`, so cite `main` line numbers)

- `apps/worker/src/handlers/ai-tag-parallel.ts:2` interface has `discover?: boolean`; `:10` `const discover = v.discover === true && explicitIds == null;` (no type check: a non-boolean truthy value falls to the explicit rule at `:12`); `:15` `max_cursor` upper bound is `explicitIds.length` or `0`; `:16` `force` is type-checked; `:17` returns `discover: true` only when computed.
- `apps/worker/src/handlers/ai-tagging.ts:1113-1119` `handleBulkAiTag(opState, tagAll, dependencies = {}, requireAssetIds = false, requireParallel = false)`; `:1130-1136` reads `AI_TAG_PARALLEL_RUN` when `requireParallel` and no injected config, then `parallelTagRun(setting, opState.run_id, opState.params?.asset_ids)`; `:1139` `if (parallel?.discover) BATCH_SIZE = parallel.concurrency;`; `:1141` requireParallel guard; `:1189` `assetIds` from params; **`:1191-1193` the fatal guard**; `:1196-1237` explicit-ID page; `:1211` explicit `acceptedModels` = `[...parallel.models, fallback?, "meta-direct/muse-spark-1.3-contributor"]` unless `force`; `:1239-1262` discovery via RPC `get_ai_tag_candidates` with `p_limit: BATCH_SIZE`; `:1308-1322` empty page → `done: true`; **`:1336-1338` discovered `acceptedModels` = `[...parallel.models, fallback?]`** (no Meta-direct).
- `apps/worker/src/handlers/ai-tagging.ts:983-987` skip rule: `parallelModel && asset.ai_tagged_at && asset.ai_description && asset.ai_model && acceptedModels.includes(asset.ai_model)` and an active same-model AI tag exists → `skipped`.
- `apps/worker/src/operation-loop.ts:903-904` dispatcher; `:1221-1230` yield block (`return` unconditional at `:1229`); `:1232-1250` promotion loop; `:1665-1699` failure classification.
- Tests on `main`: `ai-tag-parallel.test.ts:62-66` validates discover config only; `parallel-tag-conflicts.test.ts:79-106` proves the yield with a fake `fetch` (pattern to copy for Step 5's yield test); `ai-tagging.test.ts:249-279` parallel handler tests, all with `params.asset_ids`; `fakeClient(responses, calls)` at `ai-tagging.test.ts:25-30` answers `get_ai_tag_candidates` from a queue of responses — usable for a discover test.
- Docs: `docs/MODEL_RULES.md:38` (on `main`) now documents `discover?` in the shape and the yield.
- Commit, push, deploy state: PR #717 merged; Railway builds on every push to `main`, so the broken discover path is what production runs now. Nothing from this plan exists yet.

## 6. Key findings and root cause

- Root cause of Finding 1: `requireAssetIds` was introduced for single-asset re-tag operations and reused for `ai-tag-parallel` before discover existed; PR #717 added discover without revisiting the dispatcher's argument. Only `ai-tag-parallel` passes `requireParallel`, so there is no other route for a discover run.
- The worker treats the message as permanent (`isTransientInterruption` false → `failed`), so the operator sees a failed operation, not a retry loop. Cheap to detect, but the headline feature is dead.
- Finding 2 doubles spend only for assets whose saved `ai_model` is the Meta-direct model; that is the production primary of record (memory: Muse Spark 1.3 Contributor), so it is most of the already-tagged library.
- Finding 4's cost: during contention the yield write is refused only when another writer changed the op's revision in the same tick; falling through promotes *other lanes'* queued ops (the grouping rebuild itself still waits because the stale in-memory `parallelRun` is `running` and `runningTagConflict` blocks it until the next tick).
- Discover pages are `BATCH_SIZE = concurrency` (`:1139`), so each page is one concurrent chunk and every chunk is checkpointed.

## 7. Approaches considered and rejected

- **Pass `requireAssetIds = false` for `ai-tag-parallel` at the dispatcher** — would also lift the explicit-ID requirement for non-discover parallel runs, weakening the "exact run" contract (`MODEL_RULES.md:38`). Rejected; guard at the handler with `!parallel?.discover`.
- **Support `max_cursor` in discover mode as "stop after N discovered files"** — would need a processed-count in op state and a new yield reason; more than the finding asks. Rejected for now (OPEN in §8 for a follow-up if a trial of a discover run is wanted).
- **Make the failure message transient so it retries** — hides the bug. Rejected.
- **Drop the Meta-direct model from the explicit path instead** — would re-tag Meta-finished files in explicit runs too, the opposite of the documented contract. Rejected.

## 8. Design decisions

- **LOCKED** 2026-11-04: the explicit-ID guard becomes `if (requireAssetIds && !parallel?.discover && (!assetIds || assetIds.length === 0))`.
- **LOCKED**: one helper `acceptedModelsFor(parallel, configuredModels): string[] | undefined` (undefined when `parallel.force`) used at both call sites; the list is `[...parallel.models, fallback?, "meta-direct/muse-spark-1.3-contributor"]`. The Meta-direct id is already a literal at `:1211`; move it to a named constant next to `isMetaDirectModel`.
- **LOCKED**: validator — `discover` must be `undefined` or boolean (throw "Invalid parallel tagging discover flag"); when `discover` is true and `explicitIds == null`, `max_cursor !== undefined` throws "A whole-library run does not take a trial cursor". A discover flag with explicit IDs present keeps today's behaviour (explicit run; `discover` ignored) — document it in the error-free path's comment.
- **LOCKED**: yield block — `return` only inside the `if (await persistOpState(...))`; on refusal log `tick: parallel tagging yield refused; promoting this tick` and fall through.
- **OPEN**: a discover trial mode (`stop_after`) — not in this plan.

## 9. The plan

Branch `claude/722-discover-run-dispatch` from `origin/main`. Declare class `code` with `ai-task-gates`. Run worker tests with `npm test --prefix apps/worker` (needs `npm ci --prefix apps/worker` once; the test script sets fake Supabase env).

**Step 1 — Finding 1.** `apps/worker/src/handlers/ai-tagging.ts:1191`: add `!parallel?.discover &&` to the guard. Intent: a discover run reaches the discovery branch at `:1239` with no explicit IDs; a non-discover parallel run with no IDs still fails with the same message. Gate: new test `a whole-library parallel run dispatches discovered candidates without explicit IDs` passes and fails on unmodified `main` (run it once before the edit to see the red).

**Step 2 — Finding 2.** Add `function acceptedModelsFor(parallel: ParallelTagRun, configuredModels: { fallback?: string | null }): string[] | undefined` near `handleBulkAiTag`; replace the inline arrays at `:1211` and `:1337`. Gate: test `a discover run accepts a file saved by the Meta-direct model as complete` asserts the injected `tagAsset` receives an `acceptedModels` array containing `meta-direct/muse-spark-1.3-contributor` on the discovered path; existing test at `:249` still passes.

**Step 3 — Finding 3.** `ai-tag-parallel.ts`: after `:9` add `if (v.discover !== undefined && typeof v.discover !== "boolean") throw new Error("Invalid parallel tagging discover flag");`; at `:15` add the discover-specific `max_cursor` rejection before the numeric bound. Gate: tests `discover must be a boolean` and `a whole-library run rejects a trial cursor with its own message` in `ai-tag-parallel.test.ts`.

**Step 4 — Finding 4.** `operation-loop.ts:1224-1230`: move `return;` inside the `if`. Gate: test `a refused yield still promotes other queued work in the same tick` (fake `update_bulk_operation` returns `false` for the yield write once; a queued op in an unrelated lane, e.g. `erp-enrichment` if it is a separate lane per `getLane`, must be promoted to `running` within the same `tick()`; copy the harness from `parallel-tag-conflicts.test.ts:79-106`). If no unrelated lane exists in the registry, assert instead that `persistOpState` was called for the promotion (the `calls` list) — judgement call; say which in the PR.

**Step 5 — Tests.** As named in §10. Gate: `npm test --prefix apps/worker` green; `npm run build --prefix apps/worker` green.

**Step 6 — Docs.** `docs/MODEL_RULES.md:38`: add "`discover` must be boolean; `max_cursor` is not accepted with `discover`; a discover run accepts the same completed models as an explicit run (its models, the saved fallback, and the Meta-direct model)". Gate: `grep -n "discover" docs/MODEL_RULES.md`.

**Step 7 — Land.** Commit as the verified identity, push, PR "fix(tagging): whole-library parallel run can dispatch, skips Meta-tagged files, rejects a trial cursor (#680)" with `Closes #722`, wait with `bin/ai-pr-wait <pr>` in the background, merge. Gate: Railway shows a deployment for the merge SHA (worker service `f777713f-d0f8-4f9b-9685-37c9090c98ef`); the worker's startup log reports that SHA.

**Step 8 — Live proof (class `production`; recheck the gate).** Configure `admin_config.AI_TAG_PARALLEL_RUN = {run_id, models: [the model Albert chose for the full run — read it from the latest #680 comment, never guess], concurrency: 8, discover: true}` (force **false**, so already-complete files are skipped and the proof costs only the untagged files on the first page); start `ai-tag-parallel` from Settings → Diagnostics with no asset IDs and the same `run_id`. Evidence: within two ticks the operation is `running` with `progress.tagged + progress.skipped > 0` and no `Single-asset` error; the first page's `skipped` count is non-zero if the first candidates are Meta-tagged (proves Finding 2). Then pause the operation from the same panel unless #680 says the full run should continue; disable the config with `{enabled:false}` if paused (`MODEL_RULES.md:38`). Post the op state excerpt and the deployed SHA on #722 and #680 (signed), tick live proof, close #722.

### Adversarial cases (trust boundary: `admin_config.AI_TAG_PARALLEL_RUN` is operator-typed JSON)

| Input | Hostile case | Test |
|---|---|---|
| `discover: "yes"` | silently explicit | `discover must be a boolean` |
| `discover: true, max_cursor: 12` | opaque "Invalid trial cursor" | `a whole-library run rejects a trial cursor with its own message` |
| `discover: true` with `asset_ids` present | explicit run, discover ignored | `discover is ignored when explicit IDs are present` |
| `discover: true`, no `run_id` | throws (exists at `:11`) | existing `a whole-library run needs no explicit IDs, only its discover flag` |
| discover run, `requireAssetIds = true` | fails before dispatch | `a whole-library parallel run dispatches discovered candidates without explicit IDs` |
| discover run, candidate saved by Meta-direct | re-tagged (paid) | `a discover run accepts a file saved by the Meta-direct model as complete` |
| `force: true` discover | `acceptedModels` undefined → re-tag everything (intended) | `a forced discover run passes no accepted models` |

## 10. Tests required

- `apps/worker/src/handlers/ai-tagging.test.ts`: `a whole-library parallel run dispatches discovered candidates without explicit IDs` (call `handleBulkAiTag({run_id:"r", status:"running", params:{}}, true, {client: fakeClient([candidatePage], calls), parallelConfig:{run_id:"r", models:["z-ai/glm-5.3-flash"], concurrency:4, discover:true}, tagAsset}, true, true)`; assert `result.ok`, `tagAsset` called once per candidate, `calls[0].p_limit === 4`); `a discover run accepts a file saved by the Meta-direct model as complete`; `a forced discover run passes no accepted models`; `a non-discover parallel run with no asset IDs still fails closed`.
- `apps/worker/src/handlers/ai-tag-parallel.test.ts`: `discover must be a boolean`; `a whole-library run rejects a trial cursor with its own message`; `discover is ignored when explicit IDs are present`.
- `apps/worker/src/parallel-tag-conflicts.test.ts`: `a refused yield still promotes other queued work in the same tick`.
- Must stay green: `npm test --prefix apps/worker`, `npm run build --prefix apps/worker`, root `npm run lint && npm run typecheck && npm run test`, `src/test/operation-registry-sync.test.ts` (registry unchanged).

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges; reviews advisory only.
- No DB change; `get_ai_tag_candidates` and `update_bulk_operation` are shared-db objects and stay as they are.
- `AI_TAG_PARALLEL_RUN` is an exact-run setting: disable with `{enabled:false}` after the run; a `null` upsert is unsupported (`MODEL_RULES.md:38`).
- Model names are configured in several places (`AGENTS.md:142`); do not hard-code a new model anywhere except the existing Meta-direct constant.
- The worker test script needs `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` dummies — it sets them itself (`apps/worker/package.json:9`).
- Railway auto-deploys on push to `main`; a deployment proves the worker only.
- Secrets by 1Password location only (`vibe_coding`: OpenRouter and Meta API items); never print `admin_config` rows wholesale.
- Sign GitHub posts with `$AI_GH_SIGNATURE`; times in EST; no sleep loops.
- If open PR #724 lands first, rebase; it edits `tagSingleAsset`'s retry loop, not these lines.

## 12. Access and environment

- hetz; `gh` as `u2giants`; Supabase MCP project `qsllyeztdwjgirsysgai` (verify ref; the default MCP may hit the old Ohio project); Railway identifiers in `docs/INFRASTRUCTURE.md:58`. The Railway MCP server failed to connect in the planning session — use the Railway dashboard/CLI path documented there if it is still down.
- Web UI https://dam.designflow.app, Settings → Diagnostics (admin login: 1Password `vibe_coding`, PopDAM admin tester item named in `docs/1password.md`).
- Local: `npm ci --prefix apps/worker && npm test --prefix apps/worker`.

## 13. Definition of done, risks, open questions

Done when: four edits + eight tests merged; CI green; Railway deployment for the merge SHA live; a discover run observed `running` with progress in production and then paused or left running per #680; `MODEL_RULES.md` updated; #722 closed with evidence; live-proof item ticked on #680; HANDOFF.d entry updated.

Risks: a discover run with `force: false` on a mostly tagged library spends one DB read per file on skips — cheap; with `force: true` it would re-tag the library — never set `force` for the proof. Rollback: revert the PR; the yield and guard changes are self-contained.

Open: discover trial mode (`stop_after`) — not planned; whether the Step 4 test can use a second lane (judgement call stated in Step 4).

## Self-audit

1. **Brand-new session, no questions?** Yes — §5 pins every line on `main` 4409e2d3, §9 gives exact edits, test shapes with the existing fakes to copy, and the production proof recipe with the money guard (`force: false`).
2. **All background and rejections?** Yes — §3 restates the four findings with the trace, §6 explains why `requireAssetIds` exists and the spend impact, §7 lists four rejected fixes with reasons, §8 labels LOCKED/OPEN.
3. **Goal clear enough to steer?** Yes — §1: no double spend, no silent death, nightly rebuild protected; §13 turns it into the `force: false` rule for the proof.

Self-audit passed.
