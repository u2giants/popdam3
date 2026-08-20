---
issue: 93
status: BLOCKED
owner: codex/single-tag-safety-93
---

# HANDOFF — Single-asset AI tagging safety (2026-08-20 16:55 UTC, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

The next session must show Albert this whole section in one message before trying an alternate deployment path.

- **BLOCKING:** Railway did not create a deployment for pushed commit `380edffb8e3bae5149a1214e93f75d16c85add05`. Recommendation: use Railway's normal PopDAM worker redeploy control for that exact commit; do not invent a server-side deployment path. This blocks production verification and closing issue #93.
- **Already settled, do not re-ask:** Albert authorized committing and pushing the fix on 2026-08-20. The commit is on `main`; do not rewrite or replace it.

The section-0 sweep of sections 1–9 found no other owner decision. Root handoff migration is engineering housekeeping and must wait until the shared working copy is no longer being edited by another session.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed artwork. The React website is served at `https://dam.designflow.app`, while a Node/TypeScript worker under `apps/worker/` runs on Railway and performs paid AI image tagging and other long-running jobs. The GitHub repository is `u2giants/popdam3`; the normal local checkout is `/worksp/popdam`.

Single-image retag requests are stored under operation keys shaped like `ai-tag-single-<asset UUID>`. A UUID is the database's unique identifier for one asset. The worker must never turn a malformed one-image request into a paid full-library run.

## 2. What we set out to do this session, and why

Albert asked to address GitHub issue [#93](https://github.com/u2giants/popdam3/issues/93). The issue showed that a single-image operation with missing `params.asset_ids` fell through to the force-retag-all path, which could resend every library asset to the vision model at full cost.

The objective was to make the operation key itself authoritative, stop invalid requests safely, add regression tests, push the fix, verify deployment, and close the issue only after production proof.

## 3. Current state — what is true right now

- The fix is committed and pushed to `main` as `380edffb8e3bae5149a1214e93f75d16c85add05` (`fix: keep single-asset AI tagging scoped`), authored by `Albert Hazan <u2giants@users.noreply.github.com>`.
- `apps/worker/src/operation-loop.ts:305-325` extracts and validates the UUID from the operation key, overwrites any conflicting saved asset list with that one UUID, and rejects malformed keys.
- `apps/worker/src/handlers/ai-tagging.ts:316-337` has a second guard that returns a completed error before the whole-library lookup when a caller requires one-asset scope but supplies none.
- Regression coverage is in `apps/worker/src/operation-loop.test.ts:1-24` and `apps/worker/src/handlers/ai-tagging.test.ts:134-147`. The worker test command passed all 46 tests, and the TypeScript build passed.
- GitHub Actions run `32391697383` passed lint, tests, and build. Shared-database guard runs `32391697375` and `32391697419` also passed.
- Supabase's separate preview check failed with `Remote migration versions not found in local migrations directory`. This commit changes only worker code and tests; the failure is the repository's known read-only migration-copy mismatch, not evidence against issue #93's fix.
- Railway had not created a GitHub deployment for `380edffb` by 16:55 UTC. The newest recorded `popdam / production` deployment remained prior commit `9130f6ff8762010e695725f2143722e8ddd3b2eb` from 15:38 UTC.
- Issue #93 remains open. It must stay open until Railway reports `380edffb` active and healthy.
- Work was isolated at `/worksp/popdam-issue93-ts7fMR`, detached at the new commit. The ordinary `/worksp/popdam` checkout is 37 commits behind `origin/main` and contains extensive unrelated modified and untracked work. None of that work was edited, staged, discarded, or committed by this session.
- The root `HANDOFF.md` is a locally modified legacy document in the shared checkout. It was not migrated because another session may still be editing it; the handoff standard explicitly forbids migration under that condition.

## 4. Everything we tried that did NOT work

1. `gh issue view 93 --comments` failed because GitHub's old project-card query is being retired. Reading the issue through `gh api repos/u2giants/popdam3/issues/93` worked and returned the full issue safely.
2. The first isolated worker test attempt failed because the clean worktree had no installed test tools. `npm ci` in `/worksp/popdam-issue93-ts7fMR/apps/worker` installed the locked dependencies; the same test then ran successfully.
3. One verification command was accidentally run from the repository root, which selected the website's test command and found no website test tool in the isolated copy. Running it from `apps/worker/` executed the correct worker suite and passed all 46 tests.
4. Repeated read-only checks for a GitHub deployment record for `380edffb` returned none. The previous worker commits normally received a `popdam / production` deployment record within seconds, so production cannot be claimed current and the issue cannot be closed yet.
5. The legacy root handoff was not migrated. The normal checkout contains another session's modification to `HANDOFF.md`, so moving or replacing it could destroy concurrent work.

## 5. Root causes and key findings

- The original dispatcher sent every `ai-tag-single-*` operation to `handleBulkAiTag(opState, true)`. The `true` value means force retagging. Scope depended only on optional saved parameters, even though the operation key already held the correct asset UUID.
- Without `params.asset_ids`, the handler called `get_ai_tag_candidates` in `all` mode. That widened one missing input into every asset in the library—the dangerous behavior reported in issue #93.
- The permanent fix uses two independent protections. The dispatcher derives exactly one asset ID from the key, while the handler can be told that an asset ID is mandatory and then fails before querying candidates.
- The operation key is authoritative even if saved parameters disagree. This prevents stale or damaged saved state from expanding a one-image job to a different or larger set.
- A valid UUID is required. A malformed `ai-tag-single-*` key returns a finished, visible error and does not attempt any AI work.
- Pushing `apps/worker/` normally triggers Railway automatically, but this push produced no deployment record. There is no Railway command or connected tool in this Codex session, so direct verification or a safe manual trigger was unavailable.

## 6. Exact next steps

1. Open Railway's PopDAM worker service and inspect its deployment list for commit `380edffb8e3bae5149a1214e93f75d16c85add05`. If absent, use the normal **Redeploy** control for that exact commit; do not change source, secrets, or service settings. **You'll know it worked when** Railway shows that exact commit as `Active`/healthy.
2. Confirm GitHub has a `popdam / production` deployment record for the same full SHA and that its newest status is `success`. The read-only command is `gh api 'repos/u2giants/popdam3/deployments?per_page=20'`; select the entry whose `sha` is the full commit above, then read its `statuses_url`. **You'll know it worked when** the deployment and its successful status both name `380edffb8e3bae5149a1214e93f75d16c85add05`.
3. Reconfirm issue #93 is still open, then add a closing comment with commit SHA, the 46-test result, GitHub Actions run `32391697383`, and the successful Railway deployment evidence. Close the issue through GitHub. **You'll know it worked when** `gh api repos/u2giants/popdam3/issues/93 --jq .state` prints `closed`.
4. Delete this handoff file in the same commit that records any necessary closeout documentation; if no further project documentation is needed, delete it in a focused closeout commit. Push only that file change and verify it reached `main`. **You'll know it worked when** this file is absent from `origin/main`, while its history remains in Git.
5. Do not alter the dirty shared checkout. When its `HANDOFF.md` owner has finished, a later safe housekeeping session should migrate the legacy document verbatim and install the standard pointer. **You'll know it worked when** line 1 of root `HANDOFF.md` contains `handoff-pointer: v1` and no concurrent modification was overwritten.

## 7. Constraints and gotchas in force

- PopDAM normally ships directly to `main`. Do not rewrite pushed commit `380edffb`.
- Do not close issue #93 from local test evidence alone; production deployment proof is required.
- Railway owns the worker deployment. Do not SSH to a server, edit a live container, or create an alternate deployment route.
- Do not touch any unrelated files in `/worksp/popdam`; that checkout contains several concurrent workstreams. Never run a broad reset, cleanup, stage-all, or pull over those changes.
- Stage exact paths only. Confirm `git var GIT_COMMITTER_IDENT` shows Albert's required identity before any further commit.
- No shared database change is part of issue #93. Do not create migrations or try to repair the unrelated Supabase preview check in this workstream.
- Never edit another session's `HANDOFF.d/` file. Delete this file only after issue #93 is proven complete.
- Do not expose secrets in commands, logs, issues, or documentation.

## 8. Access and environment

- GitHub CLI is authenticated and successfully read issues, pushed `main`, and read checks/deployments for `u2giants/popdam3`.
- Clean isolated worktree: `/worksp/popdam-issue93-ts7fMR`; current commit `380edffb8e3bae5149a1214e93f75d16c85add05` in detached state.
- Shared normal checkout: `/worksp/popdam`; branch `main`, 37 commits behind `origin/main` at closeout, with unrelated local work that must be preserved.
- Worker folder: `/worksp/popdam-issue93-ts7fMR/apps/worker`.
- Production worker is hosted by Railway. This session had no Railway command or connected tool.
- GitHub issue: `https://github.com/u2giants/popdam3/issues/93`.
- GitHub CI: `https://github.com/u2giants/popdam3/actions/runs/32391697383`.
- No credential, token, connection string, password, private authenticated URL, `.env` value, or new secret was read, created, changed, printed, or committed. Existing durable secrets remain in 1Password vault `vibe_coding`; none was needed for this fix.

## 9. Open questions and risks

- Why Railway skipped or delayed this push is unknown. Do not assume the worker is current until the exact deployed SHA is visible.
- The code fix is safe on `main`, but production remains exposed to the old behavior until Railway activates the new commit. Existing stored single-tag operations were idle when issue #93 was written; this session did not query or mutate production operation rows.
- Supabase's failed preview check can make the commit page look partly red. It is unrelated to worker behavior, but a future migration-copy workstream should reconcile it separately; do not mix that work into issue #93.
- The shared checkout's legacy root handoff and extensive local work create overwrite risk. Continue from the isolated worktree or another clean copy for issue #93 closeout.

## Mandatory self-audit

1. **Could a street-new developer continue without asking a question? Yes.** Sections 1–3 define PopDAM, the worker, the risk, the exact commit, tests, checks, deployment gap, issue state, and both checkout paths. Section 6 supplies the continuation commands and proof gates.
2. **Could they continue as effectively as this session can? Yes.** Sections 4–5 preserve the failed GitHub read, missing dependencies, wrong-folder test, absent Railway record, handoff migration constraint, root cause, two-layer fix, and authoritative-key design.
3. **Are failed attempts and their reasons included? Yes.** Section 4 records every failed or blocked route and the successful alternative where one existed.
4. **Is every next step executable without guessing and verifiable? Yes.** Each numbered action in section 6 names the exact commit, control or command, safety boundary, and success condition.
5. **Are newcomer terms, identifiers, paths, and URLs explained? Yes.** Sections 1, 3, 5, and 8 define PopDAM, Railway, the operation key, UUID, repositories, paths, issue, checks, and commit identifiers.
6. **Did the section-0 sweep capture every owner decision? Yes.** Reviewing sections 1–9 found one owner-only action: use Railway's normal control to deploy the exact commit because this session lacks Railway access. It is listed first in section 0 with the recommended safe path. Handoff migration, issue closure, and evidence collection are executable engineering actions, not owner judgements.

Final synthesis:

1. **Is this file comprehensive enough for a brand-new developer to continue without losing a beat? Yes.** Sections 1–9 contain the complete business context, exact implementation, verification evidence, blocker, and safe continuation.
2. **Can they continue as effectively as this session can? Yes.** The exact source lines, SHA, failed routes, tooling boundary, deploy evidence gap, dirty-checkout risk, and closing procedure are all preserved.
3. **Is every relevant detail present for flawless execution? Yes.** Background, goal, intended outcome, state, failures, decisions, constraints, risks, access, actions, and verification gates appear in sections 1–9.
4. **Would Albert see every needed decision by reading only section 0? Yes.** A line-by-line sweep found only the Railway deployment action requiring him; section 0 states it, its consequence, and the recommended exact commit. No other section asks Albert to choose or approve anything.
