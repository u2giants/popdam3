---
issue: 143
status: BLOCKED
owner: codex/issue-92-direct-gemini-batch
---

# PopDAM open-issues closeout and direct Gemini Batch continuation

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking authorization to put in one reply

Before any structural database work, Albert must explicitly start or continue the
sole `popcre/shared-db` orchestrator in that task for the narrow definitive-provider-
rejection lease reset described in §6.2. A PopDAM session, delegation, open marker,
or this handoff is not authority to inherit the orchestrator. Recommendation:
authorize that exact structural request first; it blocks making the #92 WIP safe.

The next session must first select a fixed pilot cohort and one re-tag-safe asset
read-only, then attach the exact Style Group IDs and exact asset ID. It must put
this entire request to Albert in one message before any production write:

> Authorize production writes to `BULK_OPERATIONS.ai-tag-group-profiles` for the
> attached fixed list of exact Style Group IDs, then
> `BULK_OPERATIONS.ai-tag-groups` for that same attached list; after accepted
> human review, authorize `refresh-group-metadata`, the
> full `ai-tag-group-profiles` and `ai-tag-all` rollout, then resume
> `BULK_OPERATIONS.embed-dam-search` from run
> `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` at cursor 4298. Once issue #92's code
> passes review and deploys, also authorize temporarily selecting Direct Gemini
> Batch for Image Tagging, running the attached exact already-tagged asset ID
> across a controlled restart of the PopDAM Railway worker service, and restoring
> Muse 1.3 immediately after the proof.

This wording plus the attached fixed Style Group and asset ID lists is required because
`ai-task-gates check --before production` refused the earlier issue-level approval:
it requires exact production rows, operations and restart action. Recommendation:
approve the quoted actions only after the session supplies those immutable IDs; a
20-50 range or "one asset" description alone is not exact authorization. It blocks
#96 rollout, #97 index resumption and #92 live acceptance.

### Already settled — do not re-ask

- 2026-09-20: Albert approved the #96 pilot/rollout and resuming #97's existing
  index. The remaining ask above narrows that approval to the exact production
  resources required by the task gate; it does not reopen the business decision.
- 2026-09-20: POP does not control ColdLion's credential system and cannot rotate
  that credential. Do not create another rotation task or ask Albert again. Issue
  #115 was closed as not planned after the obsolete handoff was retired.
- Every LLM task must remain selectable in PopDAM Settings. No production function
  lacks a model chooser: file tagging and Style Group profiling both use
  `AI_TASK_MODELS.vision_tagging`, exposed as **Settings -> AI Models -> Image
  Tagging**. The direct batch work must remain an option in that same chooser.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed artwork at
`https://dam.designflow.app`; the same repository serves the PopSG style-guide
library at `https://sg.designflow.app`. The React frontend and Supabase edge
functions live in `u2giants/popdam3`; the persistent Node/TypeScript worker on
Railway runs AI tagging, group profiling, indexing and other bulk operations.
Production data is in Supabase project `qsllyeztdwjgirsysgai` (Virginia).

The relevant provider setting is `admin_config.AI_TASK_MODELS.vision_tagging`.
On the last verified read, it selected `meta-direct/muse-spark-1.3-contributor`;
PDF extraction and text classification used Muse 1.2 direct; the OpenRouter
provider pin and model fallback were blank. Re-verify before relying on these
runtime values because they can change in Settings.

## 2. What we set out to do this session, and why

Albert asked to pull the latest repository and resolve every open GitHub issue in
this repository only. He then approved the #96 pilot/rollout and #97 checkpoint
resume, removed impossible ColdLion credential rotation from scope, and asked what
"compatible provider route" meant. The immediate #92 goal became: expose a
vision-capable asynchronous provider through the existing Image Tagging chooser,
so the already-deployed restart-safe state machine can receive its required live
restart proof without a hidden model setting.

## 3. Current state — what is true right now

### Landed and verified

- Main was fetched repeatedly. At handoff-writing time, the documentation branch
  started from `origin/main` commit `08ae2351`; moving facts must be fetched again.
- #107 frontend work landed at `d5459f9e` and was verified signed-in on DAM and
  PopSG: relevance control, truthful Matching file preview label, empty state,
  zero console errors and zero failed network requests. #107 remains open for
  PDF/nightly acceptance gates.
- #115 documentation landed at `269b208e`; issue #115 is closed as not planned.
  No credential changed or appeared. The ColdLion fallback had already been
  removed at `d2bdbe6d`; the accepted residual risk is documented.
- The superseded issue-92 handoff from 2026-08-27 was retired in this docs-only
  closeout after all four commits it named were proven on `origin/main` and every
  open obligation, decision and failed attempt was carried into this file.
- The superseded broad open-issues handoff from 2026-09-07 was also retired. Its
  current PopDAM obligations are carried here and in the linked issue/plan STATUS
  tables; its accidental shared-db coordination remains durably owned by shared-db
  issue #2534. Its provider-choice and direct-main instructions were superseded by
  Albert's 2026-09-20 direction and the current protected-main policy.
- #96 read-only production proof found 72 effective Style Group tag rows and an
  exact count of 72, returning in 86 ms and 58 ms. No production write ran.
- #97 read-only production proof found embedding run
  `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` interrupted at cursor 4298, batch size 3:
  146,151 total documents, 5,206 embedded, 140,945 pending, zero leased/errors/
  exhausted. `SEARCH_MODE` and `SEARCH_AUTO_EMBED_ENABLED` were absent/default,
  so production remains keyword-only.

### #92 direct Gemini Batch work — preserved, not shipped

- Worktree: `/worksp/popdam-issue92-gemini-batch`
- Branch: `codex/issue-92-direct-gemini-batch`
- WIP preservation commit: `653cb150dc99ec2c5c09b82f523f916d91304870`.
  The worktree is clean and the commit is retrievable from remote branch
  `codex/issue-92-direct-gemini-batch`. The rejected implementation must not receive
  a PR, merge or deployment until review approves it.
- The work adds Direct Gemini Batch to the existing Image Tagging chooser using
  the existing protected Google AI key. It does not add a hidden model setting.
  It also filters direct batch from PDF and bake-off consumers, prepares images
  before claiming the one-use submission lease, avoids secrets in UI cache keys,
  and resumes saved provider job IDs after worker restart.
- Verification passed locally on 2026-09-22: 190/190 worker tests, worker TypeScript
  build, 10/10 focused settings tests, and the production frontend build. Diff
  checks passed. The Vite bundle-size warning was pre-existing/non-fatal.
- Independent review report preserved in the local worktree at
  `/worksp/popdam-issue92-gemini-batch/.ai/reviews/codex-diff-review-20260922T211610-1298229-16323.md`
  rejected shipment.
  Do not open a PR or deploy until every finding is fixed and a new exact-head
  review returns APPROVE. The actionable findings are also durable in §4 and the
  2026-09-22 comment on issue #92; the raw local report is supporting evidence only.

### #97 rejected experiment — preserved, not shipped

- Worktree: `/tmp/popdam-issue97-score`
- Branch: `codex/issue-97-search-score`
- Four modified files are intentionally uncommitted. The experiment tried to use
  the current database `min_rank` argument as `SEARCH_MIN_SEMANTIC_SCORE`.
- Independent review proved `min_rank` filters blended rank, not semantic score;
  a nonzero value drops valid keyword-only hits and client-side filtering breaks
  governed pagination. Issue #97 records this. Do not ship this patch. A real
  semantic floor needs a governed server/database contract, or an explicitly
  redefined and tested blended-rank threshold.

### Other open issues

- #95 remains externally blocked: production is currently safe (11 active
  AAH62NBEX01 assets, zero NBC attribution, no guessed links), but the canonical
  Exorcist property row is absent. Continue only after the governed Master Data
  prerequisite and approved admission land.
- #96 awaits the exact production authorization above, then the fixed 20-50-group
  pilot and human scorecard before any full rollout.
- #97 may resume the existing embedding checkpoint only after #96 acceptance.
  Hybrid activation remains separately blocked by the semantic-floor contract.
- #107 awaits its PDF/nightly gates; do not redo the already-deployed frontend.
- #141 (`agent-api` 401s every roughly 30 seconds) opened on 2026-09-22 during
  wrap-up. Scope freeze forbade starting it; no diagnosis was attempted.
- #142 (production canary: `windows-render` heartbeat 14 minutes stale) opened
  during wrap-up at 2026-09-22T21:43:13Z. Scope freeze forbade starting a new
  incident; no diagnosis, restart or production mutation was attempted.
- #143 is the umbrella tracker for retiring this multi-issue handoff. Closing any
  one child issue, including #92, is not authority to delete this file.

No production mutation, database migration, shared-db branch, provider-setting
change, Railway restart or credential change occurred in this session.

## 4. Everything we tried that did NOT work

1. The authenticated OpenRouter account catalog exposes only one eligible vision
   batch route, `google/gemini-3.7-flash:batch`; it previously rejected image URLs.
   OpenRouter therefore cannot currently supply #92's live proof.
2. Reading a masked Google key back through admin configuration and using it as a
   real key produced an HTTP 400. That did not prove the stored key invalid; the
   read API intentionally returns a mask. Never repeat that test or log a key.
3. The first direct Gemini implementation burned the one-use lease on fallible
   image preparation, leaked direct batch into incompatible consumers, hid catalog
   warnings and used secrets in cache keys. Two reviewer rounds found and the
   worktree fixed those problems.
4. The 2026-09-20 review was polluted because the branch was behind main and
   reported unrelated shared-db/ColdLion reversions. Rebasing onto current main
   removed those false positives; always review against the exact current base.
5. The latest exact-base review still rejected shipment:
   - definitive provider submission rejection occurs after the lease receipt is
     consumed, but the current database contract cannot reset that receipt safely;
   - failed/cancelled/expired provider batches keep polling forever;
   - OpenRouter `:batch` variants can still leak into unsupported fallback/bake-off
     selections;
   - temporary Gemini polling failures can become permanent operation failures;
   - PDF and bake-off screens discard a cached catalog when a warning accompanies it.
6. The #97 app-only semantic threshold was rejected for confusing blended rank
   with semantic score. Do not revive it without changing the governed contract.

## 5. Root causes and key findings

- There is no missing LLM setting. `AI_TASK_MODELS.vision_tagging` is the shared
  selector for production asset tagging and Style Group profiling. #92 is a
  provider transport/restart-proof problem, not a chooser omission.
- OpenRouter does not expose a reliable failed-provider-leg identity. Pinning a
  provider is the only reliable diagnostic route, while Exacto is the default.
- The shared database deliberately mints only one receipt before a provider ID is
  bound, preventing duplicate paid submissions after a crash. That safety rule
  also means a known definitive HTTP rejection needs a narrow, governed reset
  contract; app code cannot invent one safely.
- Provider terminal states must transition to a durable operation failure once,
  not remain `pending` and poll forever. Temporary network/5xx polling errors must
  remain resumable and retain the same provider job ID.
- #96 sequencing is fixed: group-profile the pilot cohort, then file-tag that same
  cohort, score identity/manual preservation and sibling leakage, then—only after
  acceptance—refresh group metadata, profile all groups and re-tag all files.
- #97 must continue run `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` from cursor 4298;
  restarting at zero wastes work. Embedding continuation is distinct from hybrid
  activation.

## 6. Exact next steps

1. Fetch current `origin/main`; inspect this handoff and
   `plan_openrouter_batch_restart_recovery.md` STATUS first. Verify success when
   all quoted SHAs/statuses have been refreshed and no protected worktree was altered.
2. Ask Albert to explicitly start or continue the sole `popcre/shared-db`
   orchestrator for this exact request; do not infer authority from this handoff.
   Once authorized, route the narrow structural change: allow the original receipt
   holder to reset an unbound submission
   lease only when the provider response proves the POST was definitively rejected,
   while preserving ambiguity for timeouts/disconnects. Include behavior tests for
   no duplicate POST, no receipt remint to another caller, and expired-lease
   ambiguity. Success is a guarded shared-db PR merged through preview-first
   workflow; never add a migration in PopDAM.
3. Rebase WIP commit `653cb150` from remote branch
   `codex/issue-92-direct-gemini-batch` in
   `/worksp/popdam-issue92-gemini-batch` onto then-current main. Implement the
   governed reset contract and the remaining
   exact review findings listed in §4. Success is tests covering database-round-trip
   reset, provider failed/cancelled/expired states, transient poll 5xx/timeouts,
   non-Google batch rejection, and cached-catalog warnings.
4. Run worker tests/build, focused UI tests, frontend build, diff/secret scan, then
   `ai-codex-review diff-review --base origin/main`. Fix findings and repeat until
   verdict APPROVE. Rebase again if main moved, then run an exact-head final check.
5. Ship #92 through PopDAM's current branch policy and verify CI plus Railway/live
   frontend SHA. Success is the reviewed commit on main and all required checks/
   deployments green.
6. Obtain Albert's exact production authorization from §0. For #92, first prove
   both AI tagging and Style Group profiling lanes are idle because they share
   `vision_tagging`. Select Direct Gemini Batch only for Image Tagging, wait more
   than the worker's 60-second model-config cache, and verify the effective model
   before submitting the exact authorized asset. Capture the saved provider batch
   ID, restart Railway while pending, prove the restarted worker GETs the same ID
   without another POST and applies once, then restore Muse 1.3. Wait past the same
   cache and verify Muse is effective before releasing either lane. Close #92 only
   with that artifact.
7. Execute #96's fixed cohort pilot and human scorecard under the approved exact
   actions. Full rollout only after 100% manual/identity preservation and zero
   sibling leakage. Then resume #97's existing embedding run at cursor 4298.
8. Start separate sessions for #142, #141, #95, #107 and the #97 semantic-floor
   contract; do not bundle them into the #92 implementation. Treat #142 as the
   production incident priority. Each issue closes only on its own customer-visible
   acceptance evidence. Close umbrella #143 and retire this handoff only after all
   child issues are closed or explicitly removed by an owner ruling.

## 7. Constraints and gotchas in force

- PopDAM shared-database structure changes belong only in canonical
  `/worksp/shared-db` / `popcre/shared-db`, never this repo's migrations.
- Production and shared cloud infrastructure are read-only unless Albert names
  the exact resource and action in the current chat and the task gate passes.
- Preserve worktrees; never reset, clean or force-remove them. Stage only owned
  files. #92 is safely preserved in remote WIP commit `653cb150`; #97 remains
  a unique uncommitted rejected experiment.
- Keep every LLM task settings-controlled. Direct Gemini Batch belongs only in the
  primary Image Tagging selector; it is not a PDF model, bake-off candidate or
  fallback until those consumers have their own durable batch design.
- Never persist images, prompts, provider request bodies, API keys or raw signed-in
  evidence in operation state, logs, issues, commits or handoffs.
- A green build or deployment is not #92 acceptance. Required proof is the same
  saved provider batch ID across a real Railway restart, no replacement POST and
  exactly-once application, followed by restoration of Muse.
- Do not rotate or reopen ColdLion credential work. Work around the accepted
  external limitation without weakening the credential path.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/popdam3`.
- Repository: `/worksp/popdam`; remote `https://github.com/u2giants/popdam3.git`.
- #92's clean, remotely recoverable WIP worktree and branch are named in §3. #97's dirty
  rejected-experiment worktree is also named.
- Production Supabase project is `qsllyeztdwjgirsysgai`; the retired Ohio project
  must not be used. This session performed read-only production checks only.
- Secrets belong in 1Password vault `vibe_coding` or existing protected runtime
  settings. No secret value appeared in chat, diffs or handoff; do not retrieve a
  masked config value as though it were usable credential material.

## 9. Open questions and risks

- The exact safe database shape for definitive-rejection reset must be designed by
  the shared-db workstream. Recommendation: require the current receipt, current
  revision, no bound provider ID, a narrow reason enum, and a still-live lease;
  never allow reset after timeout/disconnect or by a new owner.
- Direct Gemini API field/state behavior has local contract tests but no live paid
  call yet. The controlled one-asset proof is the final authority.
- Counts, runtime settings, main SHA and issue states in §3 are time-sensitive;
  re-read them before acting.
- #141 may be a credential/configuration mismatch or a stale agent. It was not
  investigated because it appeared after wrap-up scope freeze.
- #142 reports a 14-minute-old `windows-render` heartbeat. Its live state may have
  changed since the canary; the incident session must recheck before any action.

## Sub-agent records

### Agent: issue_107 / `/tmp/popdam-issue107-v2`

- Asked to do: finish the scoped PopSG frontend portion of #107.
- Actually did: implementation landed at `d5459f9e`; production signed-in checks
  passed as recorded in #107.
- Found: PDF/nightly acceptance remains; frontend must not be replayed.
- Branch/worktree: `codex/issue-107-v2-cutover`; clean and safe to remove only after
  re-proving `d5459f9e` is on current main.
- Deliberately did not do: the PDF/shared-db/nightly gates, because they are
  separate remaining acceptance work.

### Agent: issues_92_115 / `/worksp/popdam-issue92-gemini-batch`

- Asked to do: close the impossible ColdLion rotation work and build a compatible
  restart-safe provider route for #92.
- Actually did: #115 docs landed at `269b208e` and issue closed; #92 direct Gemini
  implementation is preserved in remote WIP commit `653cb150` with the test
  evidence in §3.
- Found: the current lease contract lacks a safe definitive-rejection reset; the
  latest review findings are in §4.
- Branch/worktree: `codex/issue-92-direct-gemini-batch`; live, clean, resumable and
  pushed only as a WIP preservation branch.
- Deliberately did not do: PR, merge, deployment, production settings or restart
  proof, because independent review rejected shipment. The remote WIP commit is
  preservation only.

### Agent: issue_107 reused for #97 / `/tmp/popdam-issue97-score`

- Asked to do: implement a semantic search threshold in Settings.
- Actually did: produced a four-file local experiment; nothing committed or shipped.
- Found: the database argument is blended rank, not semantic score; app-only
  filtering is unsafe.
- Branch/worktree: `codex/issue-97-search-score`; live, dirty, preserved only as
  rejected evidence.
- Deliberately did not do: commit or activation, because independent review found
  the contract mismatch.

## Self-audit

1. **Yes, a brand-new developer can continue without chat context.** Sections
   1-3 define the app, goal, runtime setting, repositories, production state,
   branches, worktrees, SHAs and issue-by-issue outcome.
2. **Yes, the developer has the full working knowledge.** Sections 4-5 preserve
   every material dead end and the non-obvious lease, provider, ranking and rollout
   findings; the sub-agent blocks distinguish landed work from rejected work.
3. **Yes, execution is complete and gated.** Section 6 provides ordered commands/
   outcomes; sections 7-9 contain constraints, access, risks and time-sensitive
   facts. No secret values are present.
4. **Yes, section 0 contains every owner-held decision.** It lists both remaining
   owner actions: explicit authorization to start/continue the shared-db orchestrator
   for the narrow lease reset, and exact-ID production authorization. Already-settled
   #96/#97 and ColdLion rulings are indexed so they are not re-asked; #141 and #142
   require separate technical/incident sessions, not another business choice.
