# Implementation plan — transfer `shared-db` to `popcre` and activate a safe GitHub merge queue

Tracking issue: [#2530](https://github.com/u2giants/shared-db/issues/2530)

Previous investigation: [issue #1435](https://github.com/u2giants/shared-db/issues/1435) and closed [PR #1950](https://github.com/u2giants/shared-db/pull/1950)

Paired handoff: [`HANDOFF.d/2026-09-07T1651Z-edge-dev-codex-popcre-transfer-merge-queue.md`](HANDOFF.d/2026-09-07T1651Z-edge-dev-codex-popcre-transfer-merge-queue.md)

## STATUS — read first

| Step | State | Date | Evidence / next gate |
|---|---|---|---|
| 0. Obtain the exact owner authorization and reserve a change window | ⬜ open | 2026-09-07 | #2530 is planning authority only; it does not authorize the transfer or settings writes. |
| 1. Re-capture the live transfer baseline and prove a safe stop point | ⬜ open | 2026-09-07 | Produce the redacted preflight artifact and pass its tests against live GitHub. |
| 2. Land transfer-compatible repository identity handling | ⬜ open | 2026-09-07 | Code PR merged with all current required checks; the existing direct guarded merge remains operational. |
| 3. Freeze repository movement and create the final recovery pack | ⬜ open | 2026-09-07 | No active repository mutation, exact source SHA recorded, settings snapshot complete, local Git bundle verified. |
| 4. Transfer `u2giants/shared-db` to `popcre/shared-db` | ⬜ open | 2026-09-07 | The same repository ID and exact `main` SHA read at the new URL; old URL redirects; visibility remains public. |
| 5. Reconcile access, settings, integrations, and secrets | ⬜ open | 2026-09-07 | Post-transfer comparison has no unexplained delta and all credential-using workflows pass without exposing values. |
| 6. Land canonical identity and external-reference updates | ⬜ open | 2026-09-07 | Operational references use `popcre/shared-db`; historical evidence remains unchanged; consumer sync passes for every target. |
| 7. Rebuild the merge-queue implementation on current `main` | ⬜ open | 2026-09-07 | Queue implementation PR merged while the old direct merge path still works. |
| 8. Activate the queue with fail-closed settings | ⬜ open | 2026-09-07 | Ruleset read-back exactly matches the approved one-PR queue and every required context remains present. |
| 9. Prove the queue with a harmless live PR | ⬜ open | 2026-09-07 | One synthetic merge group, all required checks green, one GitHub-performed merge, no bypass. |
| 10. Prove the migration/preview hold with the next genuine migration | ⬜ open | 2026-09-07 | Exact-head migration review, queued merge, exact-merge preview rehearsal, and next-group release all proven live. |
| 11. Close out, document recovery, and retire the handoff | ⬜ open | 2026-09-07 | Final evidence is on `main`; #2530 closed; paired handoff deleted in the closing change. |

**Fresh implementation starts at Step 0.** Use a fresh isolated worktree at each natural cut: after Step 2, after Step 6, after Step 7, and after Step 9. Before every phase, re-read this STATUS table and all remaining steps, fetch current `main`, inspect live issue #2530, and re-run the relevant read-only GitHub inventory. Never treat the 2026-09-07 baseline as current after execution begins.

---

## 1. Ultimate goal

Move the public, company-critical `shared-db` repository from Albert's personal `u2giants` account into the `popcre` GitHub organization without losing access, automation, history, protections, open work, or consumer synchronization. Then replace first-come-first-served merges with GitHub's native serialized merge queue while preserving every existing database safety gate, exact-head review requirement, production freeze, and post-merge preview rehearsal.

When complete, an approved pull request cannot lose a merge race to another session: GitHub will test the exact queued combination against current `main`, admit only one pull request at a time, and prevent the next migration merge until the preceding migration's exact merge commit has passed preview rehearsal.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular, do not obtain a queue by weakening or bypassing the existing guarded merge capability.

## 2. What this application is

`shared-db` is POP Creations' public canonical repository for the schema, migrations, policies, contracts, and coordination machinery of one Supabase/Postgres database shared by CRM, DAM, PM/PIM, and six DesignFlow applications. GitHub `main` is the source of truth. A push to `main` mirrors the shareable repository root into nine consumer repositories through `.github/workflows/sync.yml`.

Current source repository: `https://github.com/u2giants/shared-db`

Required destination: `https://github.com/popcre/shared-db`

Default branch: `main`

Database environments referenced by workflows: Supabase `preview` and `production`

Local Windows canonical checkout: `C:\repos\shared-db` (landing-only; do not edit there)

Implementation work: isolated current-upstream worktrees only.

The repository contains Node.js, Python, Bash, SQL, and GitHub Actions. GitHub Actions carries the guarded merge, preview, production, consumer-sync, and required-check workflows. This transfer and queue program is repository maintenance; it authorizes no database schema or row change.

## 3. What triggered this work

On 2026-08-24, one small approved migration lost repeated merge races. Every base update invalidated its exact-head review and sometimes its reserved migration version; three versions and multiple external reviews were consumed before it merged. Issue #1435 proposed a native GitHub merge queue.

The first implementation attempt, closed PR #1950 at commit `3792a9688da076923d38c34c32f395ac097e61a4`, stopped because `u2giants/shared-db` is owned by a personal account. GitHub's native merge queue is available to public repositories owned by organizations. The same attempt also changed the guarded merge command to `gh pr merge --auto` before a queue existed, which would have stopped all merges because auto-merge was disabled.

Albert selected `popcre` and public visibility on 2026-08-25. The repository still has not moved, and issue #1435 was closed on 2026-09-03 because it did not authorize a transfer. Issue #2530 now tracks this complete workstream, but its creation still does not authorize the ownership transfer itself.

## 4. Scope

### In this plan

- Transfer the existing repository object—not a copy—from `u2giants` to `popcre`, keeping the name `shared-db` and visibility `public`.
- Preserve repository ID, Git history and refs, issues, pull requests, releases, settings, branch protections, Actions, secrets, variables, environments, collaborators, integrations, and redirects, then verify each category.
- Make runtime repository identity transfer-safe before the transfer and canonicalize documentation afterward.
- Verify the nine-target consumer synchronization path after the first post-transfer `main` push.
- Rebuild the useful concepts from closed PR #1950 against current `main`, without importing its stale reversions.
- Add `merge_group` handling for every required GitHub Actions check.
- Keep one pull request per queue group, one group building at a time, merge-commit history, exact-head review, migration ordering, object collision checks, production freezes, and post-merge preview serialization.
- Provide queue-only recovery that restores the pre-queue guarded merge path without reversing the organization transfer.
- Update this plan's STATUS table after every landed step.

### NOT in this plan

- No database schema change, migration, preview write, production write, data load, or production release.
- No visibility change; the repository remains public.
- No move of consumer repositories between owners or organizations.
- No change to the nine sync destinations or their default branches.
- No reduction of required checks, exact-head review, object claims, migration-version ordering, or exclusive preview/production lanes.
- No custom queue and no ordinary auto-merge fallback; GitHub's native queue is the target.
- No invented migration solely to test the queue. Migration-specific proof waits for the next genuine authorized migration.
- No rewriting of archived plans, verification artifacts, old issue/PR comments, or other historical evidence merely to replace the old URL.
- No assumption that transferring back to `u2giants/shared-db` is available. GitHub may retire the old owner/name combination after a heavily used repository is transferred.

## 5. Current state of the code and GitHub repository

This baseline was read live on 2026-09-07 at `origin/main` commit `85015041f660bdebc5474751e63e12618d275b03`. It is orientation only; Step 1 must reproduce it.

### GitHub state

- Repository: `u2giants/shared-db`; owner type `User`; public; default branch `main`; auto-merge disabled.
- Tracking issue #2530 is open with the required `db-work` label and a valid documentation/repo-maintenance scope block.
- `popcre/shared-db` did not resolve, so the destination name appeared available to the authenticated account.
- `popcre` is an organization; its default repository permission is `read`; members may create public repositories.
- There are no repository rulesets and `main` has no required merge queue.
- `main` enforces administrators, deliberately has `strict: false`, and requires 11 contexts:
  `Promotion contract tests (offline)`, `Cross-PR object collision`, `Tools offline tests`, `SQL migration guards`, `Domain ownership`, `Intake pointer guard`, `Handoff contract`, `Migration author lease`, `Migration guarded merge authorization`, `Orchestrator marker guard`, and `Cancelled work guard`.
- Actions are enabled for all actions; SHA pinning is not required; the workflow token default is read-only and cannot approve pull-request reviews.
- Repository secrets: eight names exist—`ANTHROPIC_API_KEY`, `COLDLION_API_KEY`, `COOLIFY_TOKEN`, `DESIGNFLOW_API_KEY`, `SUPABASE_ACCESS_TOKEN`, both Supabase database-password secrets, and `SYNC_TOKEN`. Values were not and cannot be read from GitHub.
- Repository variables: six names exist—two schedule/feature flags, two Coolify application IDs, the Coolify URL, and `PREVIEW_PROJECT_REF`. Step 1 captures names and safe values in the redacted baseline.
- Environments `preview` and `production` exist. Both currently have no environment secrets, variables, branch policy, or protection rules.
- Direct collaborators are `u2giants` (admin) and `devopswithkube` (write). The repository has no webhook or deploy key.
- GitHub's current transfer documentation says issues, pull requests, releases, settings, repository secrets, webhooks, services, and deploy keys remain associated; old repository and Git URLs redirect. Therefore, restore only proven deltas—never blindly recreate settings or secrets.

### Repository implementation state

- `.github/workflows/guarded-migration-merge.yml:75-162` is the only authorized direct merge lane. It re-runs coordination checks, acquires the exclusive merge lease, posts the exact-head authorization, merges directly, revokes failed authorization, and releases the lease.
- That workflow still hard-codes `u2giants/shared-db` in its live API and merge calls at lines 96, 104, 124, 135, 144, and 156.
- `.github/workflows/shared-supabase-migrations.yml:1344-1662` has live hard-coded repository API paths in the production-freeze authorization handling.
- `scripts/manage-migration-author-lanes.mjs:34`, `scripts/check-orchestrator-marker.mjs:86`, `scripts/update-required-checks.mjs:44`, and several other operational scripts default to the old slug.
- `scripts/run-governed-review.mjs:186-253` posts review evidence to hard-coded old-owner API paths.
- `AGENTS.md:3,71,1026`, `HANDOFF.md:27`, and `COORDINATOR_INTAKE.md:13` point workers to the old canonical owner.
- `.github/workflows/sync.yml:39-47` names nine consumer destinations. It authenticates with `SYNC_TOKEN`; moving the source repository must not change those targets.
- `docs/verification/main-required-status-checks.json` is the committed mirror of the live required contexts and must not shrink during this work.
- No current required workflow declares the `merge_group` trigger.
- The closed branch `origin/codex/issue-1435-merge-queue` still exists at `3792a968...`. Its queue contract, one-PR ruleset shape, and operation notes are design input only.
- No transfer code, queue workflow, queue ruleset, or live settings mutation is currently on `main`.

## 6. Key findings and root cause

1. **Eligibility is the primary blocker.** GitHub documents native merge queues for public organization-owned repositories. The current repository is public but personally owned; code alone cannot enable the feature.
2. **Transfer is broader than a URL change.** Organization defaults affect access. Workflows, scripts, local clones, skills, external automation, and consumer sync may keep following redirects while silently retaining the wrong canonical identity.
3. **The transfer should preserve secrets, but preservation must be proved.** Current GitHub documentation supersedes the 2026-08-25 assumption that all repository secrets must be recreated. A fresh baseline and post-transfer comparison are safer than unconditional secret writes.
4. **The old URL is not a guaranteed rollback target.** GitHub warns that frequently used repositories can have their old owner/name combination permanently retired at transfer. The recovery design must prefer fix-forward operation in `popcre` and queue-only rollback.
5. **Required checks do not automatically run for a merge queue.** Every required Actions check must handle `merge_group`; otherwise GitHub waits forever for a context that no workflow reports.
6. **A merge-group SHA is not the reviewed PR SHA.** Review and author-lane evidence remain pinned to the PR head. The queue gate must identify exactly one PR, prove its reviewed head is an ancestor of the synthetic merge commit, and re-run the safety gates against the synthetic commit.
7. **Queue serialization must include preview.** GitHub can serialize merges, but it does not know that a migration's exact merge commit must rehearse on shared preview before another migration merges. A required queue gate must hold the next group until the preceding migration-bearing `main` commit carries a successful, exact-SHA preview status.
8. **The existing guarded merge command can bridge activation.** Current GitHub CLI documentation says `gh pr merge` adds a PR to the queue when the target requires one. The implementation must decide from live ruleset state whether it is directly merging or queueing; it must not unconditionally use `--auto` before activation.
9. **Closed PR #1950 is stale.** Its useful queue files were built before later transport, freshness, production-freeze, review, and test repairs. Its diff visibly removes later safety work when compared with current `main`. Cherry-picking it would regress current safeguards.

## 7. Approaches considered and rejected

### Rejected: ordinary GitHub auto-merge on the personal repository

It is not a serialized merge queue and does not remove the race. On the current repository, auto-merge is disabled; the closed attempt's unconditional `--auto` would have broken the only merging path.

### Rejected: merge PR #1950 before transferring

The workflow changes are not inert. They rely on queue eligibility and modify direct merge behavior. The branch also predates later fixes and now reverses current protections. Reuse concepts and tests selectively; do not cherry-pick or merge the branch.

### Rejected: transfer and activate the queue in one unverified mutation

That combines two failure domains. If Actions, access, or secrets drift during transfer, a newly required queue could make diagnosis and recovery harder. Transfer first, prove normal guarded merges still work, then build and activate the queue.

### Rejected: blindly recreate every secret and setting after transfer

GitHub says repository secrets and settings remain associated. Blind writes can overwrite valid state, use the wrong source credential, or conceal a transfer defect. Snapshot, compare, and repair only a demonstrated difference.

### Rejected: replace hard-coded `u2giants/shared-db` with hard-coded `popcre/shared-db` before transfer

That creates a window where `main` points operational tools at a repository that does not exist. Runtime code must derive the repository identity from `GITHUB_REPOSITORY`, an explicit `--repo`, or the verified `origin` remote. Canonical documentation changes after transfer.

### Rejected: use redirects as the permanent design

Redirects are migration aid, not source-of-truth configuration. GitHub warns that creating a repository or fork at the old location deletes redirects. Operational references must be updated, and the old slug must never be reused.

### Rejected: batch multiple pull requests in one merge group

It complicates PR identity, review binding, migration attribution, and post-merge preview evidence. Queue build concurrency and merge group size stay at one.

### Rejected: weaken exact-head review to approve the synthetic merge SHA

No independent reviewer reviewed the generated merge commit as a standalone head. Retain approval on the PR head and prove that exact head is contained in the one-PR synthetic merge group.

### Rejected: invent a harmless database migration to test preview serialization

A fabricated migration permanently consumes a version and creates database history for infrastructure testing. Use the next genuine authorized migration and leave Step 10 open until that evidence exists.

### Rejected: assume transfer-back is the primary rollback

The old owner/name may be retired, and another ownership mutation can compound access or integration failures. Keep the repository in `popcre` and roll back only the queue whenever possible. Transfer-back requires a new exact owner authorization and a live eligibility check.

## 8. Design decisions

### Locked decisions

- **2026-08-25 owner ruling:** destination is `popcre`, repository name remains `shared-db`, visibility remains `public`.
- Transfer the existing repository object; do not create a replacement, mirror, or fork.
- Preserve merge commits (`MERGE`) because migration ancestry and existing evidence depend on current history shape.
- Queue one PR at a time: `ALLGREEN`, one entry building, one entry merging, minimum one, zero batching wait.
- Every existing required context remains required. `Merge queue gate` is additive.
- Existing `strict: false` remains unchanged; queue validation supplies current-base testing.
- The guarded workflow remains the sole admission path. It continues to prove the exact head, review, claims, collisions, required checks, and production lock before invoking `gh pr merge`.
- GitHub becomes the sole merger only after the queue ruleset is proven active. Before that, the same guarded lane merges directly.
- Queue validation runs against `merge_group`; PR-head authorization remains bound to the reviewed head.
- A migration-bearing base SHA blocks the next queue group until exact-SHA `Post-merge preview rehearsal` status is successful.
- No database mutation is authorized by this plan.

### Open only for bounded implementation judgment

- The helper API and module boundaries for repository identity may change if current code already has a reusable facility. Criteria: one source of truth per language, explicit override for tests, fail closed on unreadable or non-GitHub remotes, and no hard-coded owner in live execution paths.
- The queue's check-response timeout may be raised from the prior draft's 30 minutes only if current required-check p95 evidence demonstrates 30 minutes is unsafe. It may never be shortened below observed legitimate runtime.
- If GitHub's current ruleset API schema has changed, adapt the exact payload to current official documentation while preserving the locked behavior above. Save the dry-run and read-back JSON.

## 9. Numbered implementation plan

### Phase A — authority, baseline, and transfer-compatible code

#### Step 0 — obtain exact authorization and schedule the repository-wide change window

**Dependencies:** none. This blocks the first ownership or settings mutation, not read-only preparation.

1. Re-read #2530 and this STATUS table. Post one consolidated owner request naming the exact action: transfer public `u2giants/shared-db` to organization `popcre` without renaming it, followed later by a repository ruleset that requires the native merge queue on `main`.
2. Ask the owner to confirm the post-transfer access model in the same response: retain `u2giants` as admin and `devopswithkube` as write; organization members retain the organization's existing read default. Because the repository is public, read visibility is not newly exposed, but repository roles still matter.
3. Record the owner's exact authorization and date on #2530 and in §8. Do not infer authorization from the 2026-08-25 destination preference.
4. Select a bounded window when no production promotion, preview apply, guarded merge, sync push, or repository-settings session is active. Coordinate with the live orchestrator marker; this is repo-maintenance outside the structural orchestrator, but the orchestrator must be quiescent for the transfer.

**Verification gate — you'll know it worked when:** #2530 contains one unambiguous owner comment authorizing the exact source, destination, visibility, access model, and settings program; the planned window is recorded; no action listed as active overlaps it.

#### Step 1 — build and run a repeatable, redacted transfer baseline

**Dependencies:** Step 0 may remain pending for read-only work.

1. Add `scripts/capture-repository-transfer-baseline.mjs` and `scripts/capture-repository-transfer-baseline.test.mjs`. The command defaults to read-only, requires an explicit repository, and writes stable JSON under `docs/verification/` only when `--output` is supplied.
2. Capture: immutable repository ID; owner/type; name; visibility; default branch and SHA; topics/features; merge methods; auto-merge; branch protection and all required contexts; rulesets; Actions policy and workflow-token permissions; variables; environment names/configuration; secret **names only**; collaborators/teams and roles; webhooks; deploy-key names; releases; open PR count; open issue count; Actions workflow names/states; and all Git refs.
3. Add a `redactionAudit()` test that refuses fields named `value`, `encrypted_value`, token/password/key material, authorization headers, or secret-looking payloads. The committed artifact may contain secret names and safe repository variables but never secret values or 1Password item identifiers.
4. Add a target preflight: `popcre/shared-db` must not exist; `popcre` must be an organization; the authenticated user must have source admin and destination repository-creation rights; Actions policy must allow every action currently used.
5. Add operational-state checks using `scripts/check-orchestrator-marker.mjs --resolve`, queue/lease read-only reports, active Actions runs, and open production/preview/merge refs. The baseline reports `readyToTransfer: false` if any mutation lane or relevant run is active.
6. Generate `docs/verification/shared-db-popcre-transfer-preflight-<UTC>.json` against current GitHub and record its generating command, source SHA, and schema version in the file.

**Verification gate — you'll know it worked when:** the focused test suite passes; the artifact contains every required category, contains no secret values, matches live spot checks, says the destination is absent, and either proves `readyToTransfer: true` or names every exact blocker.

#### Step 2 — land transfer-compatible repository identity without changing ownership or queue behavior

**Dependencies:** Step 1 design and current-upstream worktree.

1. Add `scripts/lib/repository-identity.mjs` plus tests. Resolution order: explicit CLI/API argument; `GITHUB_REPOSITORY`; verified GitHub `origin` URL. Refuse ambiguity, malformed slugs, non-GitHub remotes, or disagreement between explicit and detected identity. Tests cover HTTPS, SSH, redirects/old slug, destination slug, malformed input, and disagreement.
2. Replace live workflow hard-codes with `${GITHUB_REPOSITORY}` or `${{ github.repository }}` in `.github/workflows/guarded-migration-merge.yml` and `.github/workflows/shared-supabase-migrations.yml`. Preserve `scripts/gh-read.mjs`, current freshness checks, bounded retry behavior, freeze revocation/restoration, and every permission.
3. Route operational JavaScript through the helper in:
   `scripts/manage-migration-author-lanes.mjs`, `scripts/check-orchestrator-marker.mjs`, `scripts/check-dispatch-collision.mjs`, `scripts/check-handoff-contract.mjs`, `scripts/update-required-checks.mjs`, `scripts/run-governed-review.mjs`, `scripts/repair-voided-findings.mjs`, `scripts/reap-merged-worktrees.mjs`, `scripts/report-stale-handoffs.mjs`, and `scripts/orchestrator-flow/read-preview-ledger.mjs`.
4. Make the equivalent explicit/env/verified-remote resolution in active Python entry points:
   `scripts/historical_preview_recovery.py`, `scripts/production_apply_review_evidence.py`, `scripts/production_business_risk_gate.py`, and `scripts/production_owner_decision_evidence.py`.
5. Treat one-off historical repair scripts and test fixtures deliberately. If executable, make them accept explicit repo identity; if retained only as history, add them to a documented allowlist. Never silently alter old expected URLs inside archived evidence.
6. Add `scripts/check-repository-identity-conformance.mjs` and tests. It scans active workflows/scripts for the old slug and fails unless the occurrence is an approved historical/negative-test fixture. Run it from `Tools offline tests` without adding a new required context.
7. Do **not** change `AGENTS.md`, `HANDOFF.md`, `COORDINATOR_INTAKE.md`, or canonical hyperlinks to the destination yet. They must stay correct until the transfer completes.
8. Do **not** change the guarded merge's final behavior in this step. It must still merge directly with `--match-head-commit` while no queue exists.
9. Run all focused repository-identity tests, workflow/source contract tests, the complete Node and Python suites, and every repository-required offline check. Inspect the actual diff for any removal of current safeguards.
10. Commit, push, open a code PR linked to #2530, obtain the required exact-head review, wait for all required checks, and merge through the existing guarded path. Verify the merge commit and post-merge `main` checks.

**Verification gate — you'll know it worked when:** the compatibility commit is on `main`; all required checks pass; both old and destination identity fixtures pass; no active execution path requires the old owner; and one ordinary guarded merge has succeeded before transfer using unchanged direct-merge behavior.

**Fresh-session cut:** update this STATUS table with the merge SHA and CI artifact. Start a fresh isolated session for Phase B and re-run Step 1 against current GitHub.

### Phase B — quiesce, transfer, and reconcile

#### Step 3 — freeze movement and create the final recovery pack

**Dependencies:** Steps 0–2 complete.

1. Re-resolve the orchestrator marker, all author/reviewer/preview/merge/production leases, active Actions runs, open PR heads, and `origin/main`. Announce the bounded transfer freeze on #2530. Do not close PRs, delete refs, or cancel another session's work.
2. Wait boundedly for active mutation workflows to finish. If a production, preview, or merge lane remains active, stop; do not force release it.
3. Run the baseline tool again and save the final pre-transfer JSON outside the repository first. Commit the redacted copy only if it passes the redaction audit.
4. Create a local `git bundle` containing all refs and verify it with `git bundle verify`. Record its protected local path and SHA-256 on #2530 without uploading the bundle. The public code is recoverable; the bundle protects Git refs, not GitHub issues/settings.
5. Export separate redacted JSON for branch protection, rulesets, Actions settings, variables, environments, collaborators/teams, hooks, deploy-key names, and workflow states. Secret recovery information stays private in 1Password vault `vibe_coding`; use the existing secret-name inventory and #1435's prior mapping only if a post-transfer test proves a secret was lost.
6. Record the immutable repository ID, exact `main` SHA, ref digest, issue #2530 URL, open PR count, and source URL. Confirm again that `popcre/shared-db` is absent.
7. Check [GitHub Status](https://www.githubstatus.com/) for active incidents affecting Git Operations, API Requests, Issues, Pull Requests, or Actions. Stop during an incident.

**Verification gate — you'll know it worked when:** the live baseline says transfer-ready; no mutation lane/run is active; the bundle verifies; the redacted recovery pack is complete; destination remains absent; source ID/SHA/ref digest are recorded; and GitHub has no relevant incident.

#### Step 4 — transfer the existing repository

**Dependencies:** Step 3 and the exact owner authorization in Step 0. This is the first ownership mutation.

1. Use the authenticated GitHub API, never a copy or new repository:
   `POST /repos/u2giants/shared-db/transfer` with `new_owner=popcre` and no rename. Do not pass secrets in command arguments or output.
2. Expect HTTP `202 Accepted`. Poll boundedly—no more than 30 seconds per read and 10 minutes total—until `repos/popcre/shared-db` returns the same immutable repository ID, exact `main` SHA, public visibility, and default branch.
3. Prove the old web/API/Git URL redirects to the new repository. Do not create any repository or fork at `u2giants/shared-db`; doing so can destroy redirects.
4. Update the active isolated worktree's `origin` to `https://github.com/popcre/shared-db.git`; fetch and prove its `origin/main` equals the pre-transfer SHA. Do not mass-edit unrelated local clones yet.
5. If the destination never becomes readable, the ID differs, visibility changes, or `main` moves unexpectedly, stop all work and report the exact state. Do not assume transfer-back is possible. A transfer-back attempt requires a new explicit owner authorization and proof the old slug is eligible.

**Verification gate — you'll know it worked when:** the destination returns the same repository ID, `main` SHA, history, refs, issues, and PRs; visibility is public; old URLs redirect; the current worktree fetches from the new canonical URL; and no database or consumer repository changed.

#### Step 5 — compare and repair post-transfer state before reopening work

**Dependencies:** Step 4.

1. Run the same baseline tool against `popcre/shared-db` and produce a machine-readable pre/post comparison keyed by immutable repository ID.
2. Require exact equality for repository visibility/features, branch protection, all 11 required contexts, `strict: false`, administrator enforcement, Actions policy, workflow permissions, variables, environments, workflow enabled states, hooks, deploy keys, and refs.
3. Compare collaborator and team permissions against the owner-approved model. Organization defaults are not accepted as proof of write/admin roles.
4. Compare the eight repository secret **names**. Since GitHub does not expose values, do not call names-only equality credential proof. Restore a secret from `vibe_coding` only when a real workflow proves it missing/invalid; pipe it privately into `gh secret set` and never print it.
5. Verify integration access, including GitHub Apps visible in repository settings, the reviewer/comment path, Supabase CLI setup, Docker actions, Coolify build/deploy authentication, and consumer sync authentication. Use read-only or non-deploy diagnostics first. Do not trigger production deployment.
6. If any branch protection or Actions setting is missing, save the current post-transfer state, apply only the missing delta, and read it back. Never replace the full protection object from stale JSON if the live baseline has changed.
7. Keep the transfer freeze until repository checks can run, the guarded workflow can read/write statuses, and access is correct. Record every repaired delta on #2530.

**Verification gate — you'll know it worked when:** the pre/post comparison has no unexplained delta; all 11 required contexts remain configured; all workflows remain enabled; owner-approved roles are exact; each credential-dependent capability has a safe live proof; and no secret value appears in logs or artifacts.

#### Step 6 — make `popcre/shared-db` canonical everywhere and prove consumer sync

**Dependencies:** Step 5.

1. In a fresh `popcre/shared-db` worktree, update canonical operational documentation: `AGENTS.md`, `HANDOFF.md`, `COORDINATOR_INTAKE.md`, `.github/workflows/sync.yml` comments, active instruction docs, and examples that tell workers which repository to operate on.
2. Update defaults that intentionally remain textual after Step 2 to `popcre/shared-db`, while retaining runtime detection. Preserve old URLs in archived evidence, immutable verification records, and historical incident narratives.
3. Update the repository-identity conformance allowlist so an old slug in active instructions fails CI. The allowlist must name exact historical files and reasons, not a broad directory wildcard.
4. Search all POP repositories and the canonical source of Codex/shared-db skills for execution-bearing references to `u2giants/shared-db`. Open separately owned worktrees/PRs for any references that dispatch workflows, call APIs, clone/push, or direct new issues. Mere historical links may remain because GitHub redirects them.
5. Update active local clones/remotes that automation uses. Record a copy-paste owner command for other developer clones: `git remote set-url origin https://github.com/popcre/shared-db.git`.
6. Merge the shared-db identity PR through the still-working guarded lane. Its push to `main` will run `.github/workflows/sync.yml`.
7. Inspect the sync run and require a successful job for all nine matrix targets. Confirm at least one resulting consumer commit names `popcre/shared-db` in the sync commit message and that every consumer's `shared-db/AGENTS.md` matches canonical bytes.
8. Re-run GitHub code search for execution-bearing old-slug references and record every allowed survivor.

**Verification gate — you'll know it worked when:** `popcre/shared-db` is the canonical live identity in active code/docs/skills; all nine sync jobs pass; consumer copies match; local automation remotes use the new URL; and every remaining old URL is documented historical evidence rather than an operational dependency.

**Fresh-session cut:** update STATUS with transfer SHA, comparison artifact, identity PR merge SHA, and sync run ID. Re-read Phase C against current `main`.

### Phase C — rebuild and activate the native queue

#### Step 7 — rebuild the queue implementation from current `main`

**Dependencies:** Steps 4–6 complete. Do not work from PR #1950's branch.

1. Create a fresh worktree from current `popcre/shared-db@main`. Read closed PR #1950 only as design history. Port no diff without comparing it line-by-line to current `main`.
2. Add `scripts/merge-queue-contract.mjs` and focused tests that:
   - resolve exactly one PR from the `merge_group` ref and confirm through the live API that it is open and targets `main`;
   - refuse zero, multiple, malformed, closed, or wrong-base PR identities;
   - prove the exact reviewed PR head is an ancestor of the synthetic group SHA;
   - re-run exact-head approval, migration lease, object collision, SQL/order, and production-sidecar gates against the correct identities;
   - enforce ascending earliest migration version among open non-draft migration PRs;
   - reject GitHub's 3,000-file API coverage ceiling rather than treating truncation as complete;
   - detect whether the preceding `main` commit contains migrations and, if so, require its exact `Post-merge preview rehearsal: success` status.
3. Add `.github/workflows/merge-queue-gate.yml` with `pull_request`, `merge_group: checks_requested`, and manual test triggers. It owns the cross-event work that PR-only workflows cannot safely perform. Use `GITHUB_REPOSITORY`, current shared read transport, bounded waits, explicit permissions, and `cancel-in-progress: false`.
4. Update every workflow that emits one of the 11 required contexts so it also emits that same context for `merge_group`. Start with the 12 files touched by PR #1950, but derive the authoritative list from the current live contexts and workflow job names. For PR-payload-only operations, make the job report a tested neutral result on `merge_group` only when `Merge queue gate` performs the equivalent proof; never skip the whole required job.
5. Add `scripts/check-merge-queue-workflows.test.mjs`. It maps every live required context plus `Merge queue gate` to a workflow/job, proves both `pull_request` and `merge_group` coverage, rejects path-filtered required workflows that could remain pending, and rejects `cancel-in-progress: true` for queue checks.
6. Extend `.github/workflows/shared-supabase-migrations.yml` so a successful post-merge preview rehearsal posts `Post-merge preview rehearsal: success` to the exact rehearsed `main` SHA with the run URL. Failure must never post success. Preserve all current multi-PR binding, transport, freshness, production-freeze, and artifact behavior.
7. Modify `.github/workflows/guarded-migration-merge.yml` only after preserving its current direct path. It must read live queue state under the merge lock. When the queue is inactive, use the current direct `gh pr merge --merge --match-head-commit`. When the exact approved queue rule is active, invoke `gh pr merge` without `--admin`; GitHub CLI will enqueue or arm auto-merge as documented. Re-prove head/review/locks immediately before the call in both modes.
8. Add `scripts/configure-merge-queue.mjs` and tests. Default is dry-run. It refuses unless owner type is `Organization`, repo is public `popcre/shared-db`, destination ID matches the transfer baseline, queue workflows are on `main`, every required context has merge-group coverage, no mutation lane is active, and the current main migration tip has the required preview status when applicable.
9. Desired ruleset is exact and minimal: target `refs/heads/main`; active merge queue; `ALLGREEN`; `MERGE`; `max_entries_to_build=1`; `max_entries_to_merge=1`; `min_entries_to_merge=1`; zero minimum wait; check timeout justified by current runtime evidence. Do not replace existing branch protection or required checks.
10. Write `docs/merge-queue-operation.md` covering admission, queue observation, removal through the GitHub UI, preview hold, bounded failures, queue-only rollback, and recovery without `--admin` bypass.
11. Run focused queue tests, workflow parse/tests, every modified workflow's source-contract tests, full Node/Python suites, and all current required checks. Confirm no test or guard from current `main` disappeared.
12. Commit, push, open a code PR linked to #2530, obtain exact-head independent review, pass all required checks, and merge through the pre-queue guarded path. Do **not** activate the ruleset from the branch.

**Verification gate — you'll know it worked when:** implementation is on current `main`; all old and new tests pass; direct guarded merge still works with no queue; every required context has tested merge-group coverage; and the dry-run activation refuses or proposes exactly the approved additive ruleset.

**Fresh-session cut:** record merge SHA and CI artifacts in STATUS. Start a fresh session for live activation.

#### Step 8 — activate the queue fail-closed

**Dependencies:** Step 7 on `main`, Step 0's settings authorization, transfer freeze window reopened for queue activation.

1. Re-run the transfer baseline, required-context inventory, queue workflow coverage test, lane/Actions checks, and GitHub Status check. Confirm no unrelated repository settings session is active.
2. Add `Merge queue gate` to required contexts using the additive-only required-check updater. Read back all prior 11 contexts plus the new one; `strict` remains false.
3. Run `node scripts/configure-merge-queue.mjs` in dry-run mode and save the redacted JSON. Independently inspect the proposed API payload.
4. Apply only the named `main merge queue` ruleset. Read it back by ID and compare every field with the dry-run. Confirm no organization-level ruleset adds different behavior.
5. Confirm branch protection still contains all 12 contexts and the guarded workflow now detects queue-active mode. Do not use `--admin`, delete branch protection, or disable any check to force admission.
6. If read-back differs or a required workflow cannot start on `merge_group`, immediately disable/delete only the newly created ruleset by its recorded ID. Keep the extra trigger support and additive required context; the `pull_request` form of `Merge queue gate` must keep ordinary guarded merges viable. Prove direct mode again.

**Verification gate — you'll know it worked when:** the exact ruleset is active and read back; all 12 contexts remain required; `strict: false` and admin enforcement are unchanged; guarded admission detects queue mode; and the saved rollback operation targets only the new ruleset ID.

#### Step 9 — live non-migration canary

**Dependencies:** Step 8.

1. Create a harmless documents-only PR that adds only `docs/verification/merge-queue-canary-<UTC>.md`, stating its canary purpose and containing no code, workflow, configuration, script, test, migration, or rulebook file. Do not edit this plan, `AGENTS.md`, or another `plan_*.md` in the canary: those are rulebooks and require the full exact-head reviewer path.
2. Use the normal guarded admission path with its exact head; do not use the web bypass or `--admin`.
3. Observe one `merge_group` event. Record the synthetic SHA, base SHA, PR head SHA, queue ref, and workflow run IDs.
4. Require every one of the 12 required contexts to complete successfully on the synthetic SHA. Prove the group contains exactly one PR and the PR head is its ancestor.
5. Confirm GitHub, not the guarded workflow's direct path, performed the merge; `main` advanced once to the expected merge commit; no second PR was grouped; the source head did not move; and queue/build concurrency remained one.
6. Re-run the normal post-merge checks and consumer sync for the new verification note. After the canary evidence exists, update this plan's STATUS in a separate rulebook PR using the normal exact-head review and guarded queue-admission path.
7. Exercise queue-only rollback in dry-run/read-only mode and verify it names only the new ruleset. Do not actually disable a healthy queue.

**Verification gate — you'll know it worked when:** the canary is merged through one green synthetic group with all contexts, exact identity/ancestry evidence, no bypass, no direct-merge race, and healthy post-merge Actions.

**Fresh-session cut:** update STATUS with the canary PR, merge-group run IDs, synthetic SHA, merge SHA, and required-context evidence. Normal non-migration queue operation is accepted; migration-specific acceptance remains Step 10.

#### Step 10 — prove migration ordering and the shared-preview hold

**Dependencies:** Step 9 and the next genuine authorized migration. Never create one for this test.

1. Select the next real migration PR that already satisfies its structural issue, author-lane, version, object-claim, exact-head review, and preview prerequisites. Re-resolve all evidence at its current head.
2. Queue it through the guarded path. Prove the queue contract chose the oldest eligible migration version and refused any later version that attempted to jump it.
3. Prove the one-PR synthetic group contains the exact approved head, all required contexts pass, and GitHub merges it once.
4. Before dispatching the mandated post-merge preview rehearsal, introduce no unrelated test migration or direct merge. Dispatch the bounded rehearsal against the exact migration merge SHA under the existing preview lock.
5. Prove the rehearsal posts `Post-merge preview rehearsal: success` only after the exact SHA succeeds on the verified preview project.
6. Queue the next suitable harmless PR or genuine successor while the status is absent/pending and prove its merge-group gate waits or fails closed. After the successful status appears, re-run/admit and prove it proceeds.
7. If the rehearsal fails, the next queue group must remain blocked. Recover preview through existing governed procedures; never bypass the queue or mark the status manually.

**Verification gate — you'll know it worked when:** a genuine migration has exact-head review and one queued merge, its exact merge SHA has successful preview evidence, and the following group is demonstrably held before that evidence and released afterward.

### Phase D — closeout

#### Step 11 — final reconciliation and handoff retirement

**Dependencies:** Steps 0–10 complete.

1. Re-run the baseline/comparison, repository-identity conformance, queue workflow coverage, required-check inventory, and sync verification from current `main`.
2. Update every STATUS row with dated, openable artifacts: commit SHA, CI/run ID, verification file, or exact rerunnable command. Never use a bare issue/PR number as proof.
3. Update `AGENTS.md` queue operation routing and `docs/merge-queue-operation.md` with any live behavior that differed from the plan. Preserve reasoning/history rather than rewriting it as though no drift occurred.
4. Confirm no temporary transfer freeze, active lease, synthetic authorization, or test branch remains. Do not delete another session's work.
5. Close #2530 only after the destination, transfer integrity, settings, identity, sync, canary, real migration, preview hold, rollback, and documentation gates all pass.
6. Delete the paired handoff in the same closing PR; keep this completed plan as the historical implementation record unless repository policy directs archival.

**Verification gate — you'll know it worked when:** every definition-of-done item in §13 has direct evidence, #2530 is closed with a final proof comment, and the paired open handoff no longer exists on `main`.

## 10. Tests required

### Repository identity and transfer baseline

- `scripts/capture-repository-transfer-baseline.test.mjs`: complete inventory schema; deterministic ordering; pagination; API refusal; target collision; destination owner type; immutable ID/SHA capture; redaction positive controls; active-lane/readiness classification.
- `scripts/lib/repository-identity.test.mjs`: explicit input, Actions environment, HTTPS remote, SSH remote, old redirected URL, new URL, malformed/non-GitHub URL, absent remote, and disagreement refusal.
- `scripts/check-repository-identity-conformance.test.mjs`: positive control for a live hard-code, precise historical allowlist, workflow interpolation acceptance, and no broad directory exemption.

### Merge queue contract

- `scripts/merge-queue-contract.test.mjs`: queue ref parsing; zero/multiple PR refusal; live PR identity; base/head ancestry; pagination and 3,000-file refusal; migration ordering; non-migration classification; prior-main migration detection; exact preview-status matching; wrong/absent/pending status refusal.
- `scripts/configure-merge-queue.test.mjs`: dry-run default; organization/public/ID requirements; absent workflow/context refusal; active-lane refusal; exact payload; idempotent existing-rule update; unrelated-rule preservation; read-back mismatch refusal; queue-only rollback target.
- `scripts/check-merge-queue-workflows.test.mjs`: every required context maps to both PR and merge-group execution; event-specific delegation is explicit; no path-filtered pending context; no cancel-in-progress queue check; status publishers use the event SHA they claim.
- Extend current guarded-merge source-contract tests to cover direct mode before activation, queue admission after activation, exact-head match in both modes, no `--admin`, and authorization revocation on failure.
- Extend preview workflow tests so success is posted only for the exact successfully rehearsed merge SHA and never on failed/cancelled/wrong-project/wrong-SHA paths.

### Existing suites that must stay green

- All Node tests used by `Tools offline tests`, `Migration author lease`, `Cross-PR object collision`, `SQL migration guards`, and other modified workflows.
- All Python tests, including production business-risk, evidence, and historical-preview recovery suites touched by repository identity.
- Workflow syntax/source-contract tests and `actionlint` if present.
- `node scripts/check-required-checks-preflight.mjs` against the committed mirror and live admin-readable list.
- Every current required GitHub check on each code PR; no unchanged deterministic failure is rerun without repair.

### Live acceptance tests

- Same repository ID and `main` SHA immediately after transfer.
- Pre/post settings comparison with no unexplained delta.
- Safe credential-dependent workflow proofs, including all nine consumer-sync jobs.
- One documents-only live queue canary with all required contexts on its synthetic SHA.
- One genuine migration queue proof plus exact-SHA preview hold and successor release.

## 11. Constraints, standing rules, and gotchas

- The exact repository transfer and GitHub settings mutations require current owner authorization. #2530 alone is not authorization.
- Work in isolated current-upstream worktrees. Preserve the dirty canonical checkout and other sessions' files.
- Before every commit, verify `Albert Hazan <u2giants@users.noreply.github.com>` as committer and stage only owned files.
- This is repository maintenance outside the schema orchestrator. It changes no database structure or data, but must coordinate with the live orchestrator because ownership and merge settings affect every lane.
- No production, preview, or shared-cloud mutation is authorized. Do not run a database rehearsal except Step 10 under its separate genuine migration authority.
- Preserve capability. A failed queue activation rolls back the named queue rule and proves direct guarded merge still works; it does not disable checks, merges, reviewers, sync, or preview.
- Never print, commit, or paste secret values. Use 1Password vault `vibe_coding`, piping directly into the authenticated command only when a proven restore is required. Serialize 1Password access.
- The repository is public. Transfer artifacts must be redacted and may not contain licensed rows, application rows, private contracts, secret identifiers, tokens, or local private paths beyond generic instructions.
- Do not create `u2giants/shared-db` or a fork at the old location after transfer; it can destroy redirects.
- Do not assume old URLs prove correct configuration merely because redirects work.
- Preserve current `scripts/gh-read.mjs` transport, current main-freshness gates, production freeze restoration, exact-head reviewer semantics, multi-PR preview binding, and every later repair absent from closed PR #1950.
- Required status context names are exact strings. A renamed job can silently leave the old required context pending.
- A skipped required workflow remains pending. Every required context must report on `merge_group`.
- `merge_group` uses a synthetic SHA/ref. Never substitute `github.event.pull_request` fields when that payload does not exist.
- Queue size/build concurrency remains one. Do not optimize throughput by grouping PRs.
- Never use `--admin` to make a queue canary pass.
- Do not delete branches automatically during queue admission; branch cleanup can misreport a successful merge and is separate housekeeping.
- GitHub feature/API behavior is drift-prone. Recheck current official documentation immediately before Steps 4 and 8.

## 12. Access and environment

- GitHub CLI is authenticated as Albert's `u2giants` identity and currently has repository administration access to `u2giants/shared-db`. Step 1 must re-prove source admin and destination creation/administration rights.
- Destination organization: `popcre`.
- Secrets contingency source: 1Password vault `vibe_coding`; locate items through the private mapping already verified in issue #1435. Do not reproduce item IDs or secret values in this public plan or artifacts.
- Current repository-level secrets and variable names are recorded in §5. Environment-level secret/variable sets are currently empty.
- Local work must use a project-owned Node/Python environment and existing repository commands. Do not replace operating-system binaries.
- GitHub API transfer endpoint: `POST /repos/{owner}/{repo}/transfer`; expected response `202`. Use current official API version and send `new_owner=popcre` through protected input.
- Official references:
  - [Transferring a repository](https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/transferring-a-repository)
  - [REST transfer endpoint](https://docs.github.com/en/rest/repos/repos#transfer-a-repository)
  - [Managing a merge queue](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
  - [Merge-group workflow event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)
  - [GitHub CLI merge behavior](https://cli.github.com/manual/gh_pr_merge)
- GitHub.com, GitHub API, and Actions are the live environments. There is no local UI or application server for this repository-maintenance program.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] Exact owner authorization is recorded for the transfer, access model, and queue settings.
- [ ] Redacted pre-transfer baseline and verified local Git bundle exist.
- [ ] Transfer-compatible identity handling is tested, merged, and proven before transfer.
- [ ] `popcre/shared-db` is the same immutable repository ID with the same transfer-time `main` SHA, refs, issues, PRs, and public visibility.
- [ ] Old GitHub/Git URLs redirect and the old owner/name has not been reused.
- [ ] Branch protection, all original required checks, Actions settings, variables, environments, workflows, integrations, roles, secret names, hooks, and deploy keys have no unexplained delta.
- [ ] Credential-dependent workflows pass without secret exposure.
- [ ] Active operational code/docs/skills use `popcre/shared-db`; historical evidence is not rewritten.
- [ ] All nine consumer sync targets pass after a post-transfer `main` push and mirror canonical bytes.
- [ ] Queue implementation is rebuilt from current `main`; all focused/full tests and exact-head review pass.
- [ ] `Merge queue gate` is additive; all 12 contexts report successfully for `merge_group`.
- [ ] Exact one-PR `ALLGREEN` queue ruleset is active and read back; merge method is `MERGE`.
- [ ] Documents-only canary merges through one synthetic group without bypass.
- [ ] Next genuine migration proves ordering, exact-head ancestry, exact-merge preview status, and successor hold/release.
- [ ] Queue-only rollback is documented and dry-run verified; direct guarded merge capability is preserved.
- [ ] Plan STATUS and operating docs cite final artifacts; #2530 is closed; paired handoff is retired.

### Primary risks and controls

| Risk | Consequence | Control / recovery |
|---|---|---|
| Old owner/name retired | Exact transfer-back may be unavailable | Treat transfer as owner-gated; keep local bundle; fix forward in `popcre`; never create old-name replacement. |
| Organization defaults alter roles | Maintainer loses write/admin or unintended role appears | Pre/post role comparison; explicit approved access model; repair only exact delta. |
| Secret exists by name but is unusable | Sync/build fails silently later | Safe credential-dependent live tests; restore only failed secret from `vibe_coding` through a pipe. |
| Required check lacks `merge_group` | Queue waits forever | Machine mapping test plus live canary requiring all contexts on synthetic SHA. |
| Synthetic group mixes PRs | Review/migration attribution becomes ambiguous | Build and merge maxima one; group ref parser and live API identity; refuse multiple identities. |
| Queue bypasses preview serialization | Two migrations merge before shared preview proves the first | Required gate examines preceding base commit and exact-SHA preview status. |
| Closed PR #1950 overwrites later repairs | Current safety fixes regress | Fresh branch; concept-only port; full current diff/test audit; no cherry-pick. |
| Activation breaks all merges | Repository delivery stops | Direct/queue dual-mode admission; additive context; ruleset-only rollback by recorded ID. |
| Redirect masks stale automation | Future old-name reuse breaks clients | Conformance scan, cross-repo code search, explicit remote updates, survivor register. |
| Transfer happens during active lane | Running workflow writes inconsistent state | Quiescence gate and bounded wait; never force-release another owner. |

### Owner-only decisions

1. **Blocking Step 4:** authorize transfer of public `u2giants/shared-db` to `popcre/shared-db`, understanding that the old owner/name may be retired and exact transfer-back is not guaranteed. **Recommendation: authorize after Steps 1–3 pass.**
2. **Blocking Step 5 access reconciliation:** approve `u2giants=admin`, `devopswithkube=write`, and the existing `popcre` organization default for everyone else. **Recommendation: approve; public readability already exists, while explicit admin/write preserves operations.**
3. **Blocking Step 8:** authorize the exact one-PR `ALLGREEN` queue ruleset and additive `Merge queue gate` context. **Recommendation: authorize only after transfer integrity and direct guarded merging are proven.**

No other open design decision should be put back to the owner. Runtime timeout adjustment and API-shape drift are bounded engineering judgments under §8.

### Rollback order

1. **Queue defect:** disable/delete only the recorded `main merge queue` ruleset; retain `merge_group` support and additive tests; prove guarded direct merge mode. Remove the additive queue context later only through a reviewed settings change if it blocks direct mode.
2. **Post-transfer configuration defect:** fix forward in `popcre` from the pre-transfer comparison. Restore only the proven missing setting/secret/integration.
3. **Repository/history defect:** stop mutations, verify the local bundle, and escalate with repository ID/SHA/ref evidence. Do not create a replacement repository.
4. **Transfer-back:** last resort only, with new exact owner authorization and live proof the old owner/name can accept it.

---

## Mandatory self-audit — 2026-09-07

1. **Could a brand-new AI session execute this plan without asking the planner anything? — Yes.** Sections 1–8 define the business goal, system, trigger, current live baseline, root causes, rejected paths, and locked/open decisions. Section 9 supplies exact phases, files, dependencies, commands/endpoints, stop conditions, and verification gates. Sections 10–13 supply tests, constraints, access, owner asks, recovery, and completion proof.
2. **Does the plan carry every relevant background detail and ruled-out approach? — Yes.** Sections 3, 5, 6, and 7 preserve the #1435/#1950 history, personal-owner eligibility blocker, current hard-codes/settings, secret-transfer correction, stale-branch regressions, redirect trap, preview serialization, and rejected fallbacks.
3. **Is the ultimate goal clear enough to guide a correct judgment if a step drifts? — Yes.** Section 1 states the owner/business outcome and explicitly makes the goal controlling. Sections 4 and 8 bound what may change and lock the safety properties that cannot be traded away.

Checklist result: **PASS — all 13 required sections are present; all steps have concrete targets and verification gates; locked versus open decisions, explicit exclusions, named tests, secret-safe access, commit/CI/live acceptance, rollback, paired handoff, router registration, and artifact-backed STATUS maintenance are included.**
