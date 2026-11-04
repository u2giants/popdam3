# Plan: Review finding: u2giants/popdam3#710 fix(tagging): parallel runs fail over to the saved backup during an outage (u2giants/popdam3#711)
Issue: https://github.com/u2giants/popdam3/issues/711
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Finish the predicate on a branch cut from current `origin/main` (findings 2 and 3; finding 1's phrase landed in #724) | ⬜ open | #716 is closed unmerged; see the correction below |
| 2 | Move the predicate tests into the worker's real test suite (`.ts`, not `.mjs`) | ⬜ open | `apps/worker/package.json:9` only globs `*.test.ts` |
| 3 | Add the end-to-end catalog-miss test that drives `tagSingleAsset` to the backup | ⬜ open | Finding 1 asked for it; none exists |
| 4 | Update `docs/MODEL_RULES.md` wording if behavior text changes | ⬜ open | |
| 5 | Open PR to `main`, CI green, merge | ⬜ open | #716 already closed |
| 6 | Live proof on Railway worker log (fallback line after a forced catalog miss) | ⬜ open | `- [ ] live proof` stays on #711 until done |

Where a fresh session starts: Step 1. Nothing from this plan is on `main` yet. Verified 2026-11-04 against `origin/main` = `4409e2d3` and fixer branch `origin/review-fix/711` = `f4d60098`.

**Correction (verified on `origin/main` `e037dd7a` (Nov 4, 2026, 6:05 PM EST)):** PR #724 (`ef8ca260`) added `/not available in the OpenRouter account catalog/` to `isModelOutageError` and one row to the scope test, so finding 1's predicate is fixed. PR #716 is CLOSED. Still open on `main`: finding 1's handler-level test (Step 3), finding 2 (both `^OpenRouter` anchors), finding 3 (bare `network` and `aborted`). Do not cherry-pick `f4d60098`: edit the function by hand to the behaviour listed in Step 1, keeping #724's line. No `.mjs` file arrives, so Step 2's delete, the §13 `.mjs` line and Step 5's `gh pr close 716` do not apply. Line numbers below are from `4409e2d3`; re-grep. §3, §4 and §7 describe #716 as it stood before this.

---

## 1. The ultimate goal

When POP Creations runs AI tagging across the library (the ~110,500-file run tracked on #680), a tagging model that is rate-limited, down, timed out, or **retired by OpenRouter** must not silently stop tagging. The worker must fall over to the saved backup model (`vision_tagging_fallback`) so the run keeps producing tags and no paid work is lost. Account faults (bad key, no credit) must *not* trigger the backup, because the backup would fail the same way and only add spend.

Today the "retired model" promise in `docs/MODEL_RULES.md` is **not true in the real call path** (see §6). This plan makes it true and proves it.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product artwork (Disney, Marvel, etc.). Source files live on a Synology NAS; the system ingests, thumbnails, and lets the team browse, search and tag art. Repo `u2giants/popdam3`, default branch `main`.

The part touched here is the **Railway worker** (`apps/worker/`, Node.js + TypeScript, deployed automatically on every push to `main` — see `AGENTS.md` → Deployment and `docs/INFRASTRUCTURE.md` → Railway Worker). It runs AI image tagging through OpenRouter (`OPENROUTER_API_KEY`) with an optional direct-Meta path. Model choice lives in `admin_config.AI_TASK_MODELS.vision_tagging` with optional `vision_tagging_fallback` (`docs/MODEL_RULES.md:38-39`).

Frontend: dam.designflow.app. Supabase project `qsllyeztdwjgirsysgai` (Virginia). This plan does not touch the frontend or edge functions.

## 3. What triggered this work

PR #710 (merged to `main` as `01fcfc34`, "let parallel runs fail over to the saved backup during an outage") added `isModelOutageError()` so the explicit-file parallel tagging run (`AI_TAG_PARALLEL_RUN`) uses the backup on outages. The advisory AI review (DeepSeek, run 41912540481) filed #711 with three findings against head `65befeae`:

1. **Blocking** — a *retired model* never fails over once the 10-minute capability catalog refreshes, because the catalog-miss error text `Model <id> is not available in the OpenRouter account catalog` (`apps/worker/src/model-capabilities.ts:90`) matches neither predicate.
2. **Correctness** — the `^OpenRouter ...:` anchors never match non-terminal 400/404/408/425 errors, which arrive wrapped as `Structured output failed: <method>: OpenRouter 404: ...` (`apps/worker/src/structured-output.ts:81`).
3. **Low** — bare `/network|aborted/i` is over-broad; a policy message containing those words would trigger a paid backup call.

The review-fixer bot opened PR #716 (`review-fix/711`, head `f4d60098`) and labelled the issue `fixer-done`. The PR is open, mergeable, CI green — **but its base is `claude/cool-leavitt-cb46c1`, the already-merged source branch of #710, not `main`.** Merging it as-is lands nothing on `main`.

## 4. Scope

**In:**
- The predicate change from #716 (`isModelOutageError` in `apps/worker/src/handlers/ai-tagging.ts`), re-landed on `main`.
- Predicate unit tests inside the worker's real suite.
- One handler-level test proving a catalog-miss error on the primary model leads to an attempt on the fallback model.
- Closing #716 as superseded and #711 with evidence.

**NOT in this plan:**
- Changing which errors count as *model-specific* (`isModelSpecificError`, `ai-tagging.ts:134-144` on `origin/main`).
- Changing the 10-minute capability cache (`model-capabilities.ts`) or adding catalog pre-validation at run start.
- Batch (`:batch`) or Google-direct paths; the fallback is already skipped for batch-only models (`ai-tagging.ts:1099`).
- Anything about the whole-library parallel run paging (#717) or tag content rules (#680, #698, #721).
- Shared database changes — none needed.

## 5. Current state of the code

All line numbers below are on `origin/main` `4409e2d3` unless stated. **This worktree's branch is behind `origin/main`** (it predates #717/#721); the implementer must branch from a fresh `origin/main`, not from this worktree's HEAD.

- `apps/worker/src/handlers/ai-tagging.ts:152-156` — `isModelOutageError` as reviewed (anchored `^OpenRouter`, bare `network|aborted`, no catalog phrase). **Unchanged since the finding.**
- `apps/worker/src/handlers/ai-tagging.ts:134-144` — `isModelSpecificError` (data-inspection, media download, `No endpoints found`).
- `apps/worker/src/handlers/ai-tagging.ts:1070-1086` — `attemptTag` catch block: any thrown error from the model call (including the capability-catalog throw, since `callTagAssetModel` calls `getRuntimeModelCapabilities` at `ai-tagging-shared.ts:526` inside the same try) becomes `{ outcome: "failed", _rawMsg: msg }`.
- `apps/worker/src/handlers/ai-tagging.ts:1096-1106` — fallback decision: `fallbackModel && !fallbackModel.endsWith(":batch") && (isModelSpecificError(rawMsg) || isModelOutageError(_rawMsg))`.
- `apps/worker/src/model-capabilities.ts:90` — the catalog-miss throw: `` `Model ${selected || bare} is not available in the OpenRouter account catalog` ``. Thrown as a plain `Error`, **not wrapped** by structured-output (it happens before any completion), so an anchored `^Model ... catalog$` regex is safe for it.
- `apps/worker/src/structured-output.ts:81` — non-terminal errors are joined into `Structured output failed: json_schema: <err>; json_object: <err>`.
- `apps/worker/src/handlers/ai-tagging-scope.test.ts:9,268-283` — existing predicate test (`"a model outage triggers the backup; account faults and bad input do not"`). It imports `isModelOutageError` from the compiled handler, so new predicate cases belong here.
- `apps/worker/package.json:9` — `test` script: `tsx --test src/*.test.ts src/**/*.test.ts`. **A `.test.mjs` file is never executed by CI.**
- `docs/MODEL_RULES.md:38-39` — states fallback happens on "rate limit, 5xx, timeout, retired model".

Fixer branch `origin/review-fix/711` (`f4d60098`), diff vs its own base:
- `ai-tagging.ts` predicate: `^OpenRouter` → `\bOpenRouter`; adds `^Model .+ is not available in the OpenRouter account catalog$`; narrows transport words to `AbortError|request (was )?aborted|operation (was )?aborted|timed out|fetch failed|econnreset|econnrefused|enotfound|socket hang up|network (error|connection|request failed)`.
- New `apps/worker/src/handlers/ai-tagging-errors.test.mjs` — regex-extracts the function from source text and evals it. Clever for an offline fixer, **but** it is `.mjs` (not run by `npm test`) and tests source text rather than the built module.
- Branch is 14 files behind `origin/main` (it lacks #717/#721). It cannot be fast-forwarded; cherry-pick is the right move.

Nothing is committed on `main` for this issue. Nothing is deployed.

## 6. Key findings and root cause

- **Finding 1 root cause (verified):** `getRuntimeModelCapabilities` (`model-capabilities.ts`, 10-minute cache at `:38`) throws before any completion when the configured model vanishes from the OpenRouter account catalog. That text contains none of `OpenRouter 4xx`, `No endpoints`, `not a valid model`, or transport words. So after the cache refreshes, a retired primary model fails every asset with `AI call error: Model x/y is not available...` and the backup is never tried. Inside the cache window the stale catalog still lists the model and the eventual `404 No endpoints found` *does* trip `isModelSpecificError` — so behavior changes 10 minutes into an outage, exactly as the reviewer said.
- **Finding 2 root cause (verified):** `isTerminalOpenRouterError` (`apps/worker/src/openrouter.ts:331-336`) treats only 401/403/429/5xx/policy/billing as terminal. Everything else is collected by `executeStructuredOutput` and rethrown with the `Structured output failed:` prefix (`structured-output.ts:81`). The existing unit test (`ai-tagging-scope.test.ts:273`) feeds a bare `OpenRouter 400: ...` string, which is not the shape the handler sees — false confidence.
- **Finding 3 (verified, low):** `network` and `aborted` as bare substrings would match e.g. `OpenRouter 400: generation aborted by content policy`.
- The handler-level path (`attemptTag` → `_rawMsg` → fallback) is correct once the predicate is; no structural change needed.
- `ai-tagging.ts` is also imported by `ai-tag-parallel.ts` (added in #717); the predicate is shared, so one fix covers both the normal and the parallel run.

## 7. Approaches considered and rejected

- **Merge PR #716 as-is.** Rejected: its base is the merged feature branch; merging would not touch `main`. Re-targeting with `gh pr edit --base main` is possible but the branch is 14 files behind and carries the untested `.mjs` file; a clean cherry-pick onto a fresh branch is simpler and avoids a merge-commit on `main` with stale history.
- **Keep the `.mjs` source-text test.** Rejected: never runs in CI (`package.json:9` glob), and asserts on a regex-extracted copy of the function, so a refactor that moves the function silently makes the test vacuous.
- **Pre-validate the model against the catalog when the run starts and refuse to start.** Rejected for this issue: the owner note in `MODEL_RULES.md:38` already makes the run owner validate capabilities; a retirement *mid-run* is the case that matters and fail-over is the documented behavior. Could be a later improvement; out of scope.
- **Drop the anchor entirely (`/OpenRouter 40[0-4]:/` anywhere).** Rejected in favor of `\bOpenRouter` — same reach, but a word boundary avoids matching inside an unrelated token.
- **Treat every `Structured output failed:` as an outage.** Rejected: that wrapper also carries "no parsable JSON" and schema-validation failures, which are same-model retries, not outages.

## 8. Design decisions

- **LOCKED (2026-11-04, #710 + MODEL_RULES.md:38):** fallback fires on model-specific or outage errors only; never on account faults (401/402/403, insufficient credits, user not found).
- **LOCKED:** the catalog-miss message is matched exactly as produced by `model-capabilities.ts:90`; if that message ever changes, the test in Step 3 must fail (that is its purpose).
- **LOCKED:** predicate tests live in `ai-tagging-scope.test.ts` next to the existing outage test; no new test runner, no `.mjs`.
- **LOCKED:** no change to the fallback skip for `:batch` models (`ai-tagging.ts:1099`).
- **OPEN (implementer's judgment):** whether to extract the fixer's narrowed transport regex into a named constant for readability. Either is fine; keep behavior identical to the fixer's regex.
- **OPEN:** whether the handler-level test in Step 3 drives `tagSingleAsset` directly or the smaller `attemptTag` closure. Prefer `tagSingleAsset` if its dependencies can be stubbed in under ~40 lines (look at how `ai-tag-parallel.test.ts` and `ai-tagging-contract-repair.test.ts` stub `callTagAssetModel`/`fetchImageData`); otherwise test the fallback decision through the exported predicates plus a minimal fake of the attempt sequence.

## 9. The plan

Prerequisite: `git fetch origin && git switch -c fix/711-outage-predicate origin/main` in a fresh worktree (canonical checkouts are landing-only). Confirm `git log -1 --format=%h origin/main` is `4409e2d3` or newer.

### Step 1 — Re-land the predicate change (depends on nothing)
- `git cherry-pick f4d60098` (the single commit on `origin/review-fix/711`). Expect a clean apply on `ai-tagging.ts`; if it conflicts because #717/#721 moved lines, apply the three-line hunk by hand to `isModelOutageError` (`ai-tagging.ts:152-156`).
- Resulting function must:
  - match `\bOpenRouter (408|425|429|5\d\d):` anywhere in the message;
  - match `\bOpenRouter 40[0-4]:` anywhere **when** the body also says `not a valid model|no endpoints|model.*(not found|does not exist)`;
  - match `^Model .+ is not available in the OpenRouter account catalog$`;
  - match transport words only in narrowed form: `AbortError`, `request (was )?aborted`, `operation (was )?aborted`, `timed out`/`timeout`, `fetch failed`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `socket hang up`, `network error|network connection|network request failed`.
- Keep the docblock above the function; add one line: "The capability-catalog miss is raised before any completion and is never wrapped."
- **Gate:** `npm run build --prefix apps/worker` passes; `grep -n "account catalog" apps/worker/src/handlers/ai-tagging.ts` shows the new branch.

### Step 2 — Move the tests into the real suite (depends on Step 1)
- Delete `apps/worker/src/handlers/ai-tagging-errors.test.mjs` (came with the cherry-pick).
- In `apps/worker/src/handlers/ai-tagging-scope.test.ts`, extend the existing test at `:268` and add two new `test(...)` blocks:
  - `"a retired model's catalog miss counts as an outage before any completion"` — `isModelOutageError("Model retired/vision is not available in the OpenRouter account catalog") === true`.
  - `"outage statuses are still detected inside the structured-output wrapper"` — for each of `OpenRouter 408: Request expired`, `OpenRouter 425: Too early`, `OpenRouter 400: {"error":{"message":"x/y is not a valid model ID"}}`, `OpenRouter 404: Model x/y does not exist`, `OpenRouter 429: ...`, `OpenRouter 502: ...`: both the bare string and `` `Structured output failed: json_schema: ${e}; json_object: ${e}` `` return true.
  - `"incidental policy wording is not an outage"` — `OpenRouter 400: network policy rejected this image`, `OpenRouter 400: generation aborted by content policy`, `OpenRouter 401: User not found`, `OpenRouter 402: Insufficient credits`, `OpenRouter 400: invalid image`, `No parsable JSON` → false, bare and wrapped.
  - Transport positives: `AbortError: This operation was aborted`, `The operation was aborted due to timeout`, `request aborted`, `fetch failed`, `network error`, `network connection lost`, `ECONNRESET`, `socket hang up` → true.
- **Gate:** `npm test --prefix apps/worker` lists the three new test names as passing; `ls apps/worker/src/handlers/*.mjs` returns nothing.

### Step 3 — Handler-level proof of the catalog-miss fail-over (depends on Step 1; can be written in parallel with Step 2)
- New test in `apps/worker/src/handlers/ai-tagging-scope.test.ts` (or a new `ai-tagging-fallback.test.ts` in the same folder — it is picked up by the glob):
  `"a catalog miss on the primary model attempts the saved backup"`.
- Arrange: stub the model call so the first model throws `new Error("Model primary/x is not available in the OpenRouter account catalog")` and the second model returns a valid `tag_asset` result. Look at `ai-tagging-contract-repair.test.ts:25-40` and `character-reference-validation.test.ts:60-75` for the existing pattern of passing a `completion`/`capabilities` stub to `executeStructuredOutput`/`callTagAssetModel`; the simplest route is to stub `getRuntimeModelCapabilities` via the `capabilities` option or by making the stubbed completion throw. If `tagSingleAsset` cannot be driven without network, test `attemptTag`'s decision via a thin extracted helper `shouldTryFallback(primaryResult, fallbackModel)` — **but only if** you extract it with zero behavior change and keep `ai-tagging.ts:1096-1106` calling it.
- Assert: the models attempted are `[primary, fallback]` in that order, and the final outcome is `tagged` with `model === fallback`.
- Also assert the negative: with `OpenRouter 402: Insufficient credits` on the primary, only `[primary]` is attempted.
- **Gate:** test passes; temporarily reverting Step 1's catalog branch makes exactly this test fail (do this once locally to prove it is not vacuous, then restore).

### Step 4 — Docs (depends on Steps 1–3)
- `docs/MODEL_RULES.md:38` already says "retired model". Add a parenthetical after it: "(a model missing from the OpenRouter account catalog is detected before the first call and fails over the same way)". No other doc change.
- **Gate:** `git diff docs/MODEL_RULES.md` is one line.

### Step 5 — PR, CI, merge (depends on 1–4)
- Commit as Albert's verified identity (`git var GIT_COMMITTER_IDENT`), message `fix(tagging): detect retired-model catalog misses and wrapped outages for backup fail-over (#711)`, ending with the attribution line required in this session.
- `gh pr create --base main --title ... --body "Closes #711. Supersedes #716. ..."`; sign the body with `$AI_GH_SIGNATURE`.
- `bin/ai-pr-wait <pr>` in the background; do other work; rerun on exit 2.
- Merge when the required checks pass (reviews are advisory and never block). Then `gh pr close 716 --comment "Superseded by #<new>; landed on main as <sha>. $AI_GH_SIGNATURE"`.
- **Gate:** `git log origin/main -1` shows the merge; Railway shows a new deployment for that SHA (`docs/INFRASTRUCTURE.md` → Railway Worker identifiers; read-only check).

### Step 6 — Live proof (depends on Step 5)
- Production is read-only by default; do **not** change `AI_TASK_MODELS` in production. Live proof options, in order of preference:
  1. If a tagging run is already configured with a fallback, grep the Railway worker log (read-only) for `ai-tag: primary model failed with model-specific or outage error — trying fallback` with `error: "Model ... account catalog"` after deploy. Any natural occurrence is proof.
  2. Otherwise, the unit + handler tests in CI on the merged SHA are the proof of logic, and the deployed-SHA check is the proof of delivery; record both on #711 and leave `- [ ] live proof (fallback line observed in worker log)` unchecked on #711 for the next real outage. Never open a second issue for it.
- **Gate:** comment on #711 names the merged SHA, the CI run id, and either the log line or the unchecked checklist item.

## 10. Tests required

New (names are behaviors; all in `apps/worker/src/handlers/`):
- `a retired model's catalog miss counts as an outage before any completion`
- `outage statuses are still detected inside the structured-output wrapper`
- `incidental policy wording is not an outage`
- `a catalog miss on the primary model attempts the saved backup`
- (negative, same test or sibling) `an account fault on the primary never attempts the backup`

Existing that must stay green:
- `npm test --prefix apps/worker` (whole worker suite, incl. `ai-tagging-scope.test.ts`, `ai-tag-parallel.test.ts`, `model-capabilities.test.ts:29` which pins the catalog-miss message text).
- Root `npm run lint && npm run typecheck && npm run test`, `npm run build` (CI workflow `.github/workflows/ci.yml`).

### Adversarial cases (external input = error strings from OpenRouter / Meta / Node transport)

| Input | Hostile case | Test |
|---|---|---|
| OpenRouter error body | contains "network"/"aborted" in a policy sentence | `incidental policy wording is not an outage` |
| OpenRouter 401/402/403 | account fault must not spend on backup | `incidental policy wording is not an outage` (401/402 rows) + negative handler test |
| Wrapped non-terminal 4xx | prefix `Structured output failed:` hides status | `outage statuses are still detected inside the structured-output wrapper` |
| Catalog refresh after retirement | plain `Error` with no status | `a retired model's catalog miss counts as an outage before any completion` |
| Schema/JSON failure | must stay a same-model retry, not a backup | `No parsable JSON` row → false |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`. Merge is done by the AI after required checks pass; Albert does not merge. Reviews are advisory only.
- No database changes in this repo; none are needed here. If one becomes necessary, stop — it goes through `popcre/shared-db`.
- Commit only as Albert's verified identity; stage only your own files (concurrently edited checkout).
- Wait on CI with `bin/ai-pr-wait <pr>` in the background; never sleep-loop.
- Sign every GitHub comment/PR body with `$AI_GH_SIGNATURE`.
- **Gotcha:** `apps/worker` tests run with `tsx --test` over `*.test.ts` only. `.mjs`, `.vitest.ts` (root vitest) and `.test.js` are not picked up by the worker script.
- **Gotcha:** the worker test script sets `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` dummies; tests must not hit the network.
- **Gotcha:** `isRetryableStructuredOutputError` (`ai-tagging.ts:1072`) runs before the outage path; a message that it classifies retryable is retried twice on the same model first. A `404` body with "does not exist" is **not** retryable there, so it reaches `_rawMsg` on the first failure.
- **Gotcha:** this worktree is behind `origin/main`; cite and branch from `origin/main`.
- Production worker is read-only for you: never change `admin_config` in production to manufacture an outage.
- Times for humans in EST (America/New_York).

## 12. Access and environment

- Machine: hetz (production VPS). `gh` is authenticated as `u2giants`. Railway MCP is **not** connected in this session (connection failure reported); use `docs/INFRASTRUCTURE.md` identifiers with `gh`/Railway dashboard read-only or the `op_run`-wrapped Railway CLI if present.
- Target: branch cut from `origin/main`, PR to `main`, deploy = Railway worker auto-deploy on merge.
- Secrets: 1Password vault `vibe_coding` (worker `OPENROUTER_API_KEY` lives in Railway env, not needed locally for tests). Test logins: `docs/1password.md` (not needed — no UI in this plan).
- Run locally: `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm test --prefix apps/worker`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Predicate change on `main` (SHA recorded on #711).
- [ ] Five tests above in `apps/worker/src/handlers/*.test.ts`, green in CI run id recorded on #711.
- [ ] `ai-tagging-errors.test.mjs` does not exist on `main`.
- [ ] `docs/MODEL_RULES.md` parenthetical landed.
- [ ] PR #716 closed as superseded with a signed comment.
- [ ] Railway deployment for the merged SHA observed (read-only).
- [ ] `- [ ] live proof` checklist item on #711 either checked with the log line or left for the next outage, named in the closing note.
- [ ] Handoff `HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md` STATUS row for #711 updated; this file's STATUS table updated.

Risks:
- Over-matching `\bOpenRouter 5\d\d:` inside a long Meta-direct error is harmless (5xx is an outage anywhere).
- Narrowing transport words could miss a new Node error phrasing; mitigated by keeping `fetch failed`/`ECONN*`/`socket hang up`. Rollback: revert the single commit.

Open questions: none that block. If the handler-level test proves impractical without a larger refactor, land Steps 1–2 first and record Step 3 as a follow-up checklist item on #711 (same issue), not a new issue.

## Self-audit

1. **Could a brand-new session execute this without asking?** Yes — §5 gives every file:line on `origin/main` and the fixer branch, §9 names the exact commit to cherry-pick, the exact regex behaviors, test names and stub patterns to copy, §12 names auth and commands.
2. **Does it carry every piece of background and what was ruled out?** Yes — §6 explains both root causes with the catalog-cache timing, §7 records why #716 cannot be merged as-is and why the `.mjs` test is rejected, §8 labels locked vs open.
3. **Is the goal clear enough for judgment calls?** Yes — §1 states the business outcome (library run keeps tagging on a retired/down model, never on account faults) and the goal-wins rule; §8 OPEN items give criteria.
