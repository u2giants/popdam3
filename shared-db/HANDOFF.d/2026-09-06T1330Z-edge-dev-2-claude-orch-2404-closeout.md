---
issue: 2432
status: OPEN
owner: claude/shared-db-orchestrator-ed94bd
---

# Orchestrator closeout — marker #2404 (shared-db.orch edge-dev-2)

Session ended at owner instruction 2026-09-06 ~13:30Z. Facts below were re-verified
from `gh`/`git` at **2026-09-06 13:30Z**; `origin/main` = `cb085f37a68296ebe04ea25e5ee743d2c0a21f2e`.

## (a) Coordination state

- **Merge freeze LIFTED.** Issue #2424 ("the shared preview project has been deleted")
  was a **false alarm** and is resolved. The rehearsal branch `shared-db-schema-rehearsal`
  is alive and ACTIVE_HEALTHY. Only the machine-local `ai-private-config` overlay still
  held the ref retired in the 2026-08-18 rebuild. Fixed at source in
  `u2giants/ai-private-config` PR #1 (merged `f37e4119040dd9a6e91d60ef301566db4f3cd34e`),
  synced and verified. Follow-up filed as **#2429** so a stale ref fails loudly instead
  of masquerading as a deleted resource.
- **Supabase topology, now established and no longer guesswork:** production is the
  popdam project; the persistent rehearsal branch is `shared-db-schema-rehearsal`, whose
  parent is production; DesignFlow non-prod is a **separate project** (`designflow-nonprod`,
  created 2026-09-02), NOT a branch of production. popdam / popcrm / poppim have no
  dev/staging/sandbox — everything goes to production. Refs are resolved by
  `ai-private-config value ...`; they are deliberately not written here.
  1Password item `qbvfk7umc3n75ejekd65zwd4ty` documents the rehearsal branch, its
  credentials, the four places its ref must be updated, and the pooler-host gotcha
  (preview is on `aws-0`, production on `aws-1`). **Read it before touching preview.**
- **Preview state: NOT clean and NOT rehearsed this session.** No migration and no data
  row was applied to preview by this session or any agent it dispatched. PR #2423 merged
  to `main` **without** its preview rehearsal — see the merge-first note below. That
  rehearsal is outstanding and is issue **#2433**.
- **The repo is MERGE-FIRST** (AGENTS.md section 4 rule 2). The order is: green CI + durable
  review artifact, then guarded merge, then preview rehearsal, then production. A previous
  belief that preview comes first is wrong and cost this session an hour.
- **Queue is fully audited.** `--queue-audit` reached `fullyAudited: true` — every open
  issue classified, labelled and parseable.

## (b) Per-sub-agent blocks

### Agent: fix reviewer findings on PR #2415 — worktree `.claude/worktrees/issue-2355-character-alias`

- **Asked to do:** close the Medium finding the governed reviewer raised on the
  `core.character` alias / source-provenance migration, plus the Low `last_seen_at`
  finding, and add contract coverage for both.
- **Actually did:** commit `ec278b843ef781a996776baadeefe99d6d8edc3f`, which is the
  current head of `claude/issue-2355-character-alias` and of PR #2415. Two files, both
  new in this PR and therefore editable in place: migration `20260906034550_...` and its
  contract test. No new migration file (no reserved version). No database contact.
- **Found:** the guard refused a repointing UPDATE only when the row already carried a
  stamped licensor. Every pre-migration row has NULL there, so the FIRST cross-licensor
  collision on a legacy row was silently re-attributed — exactly the misattribution the
  migration claims to prevent. Now closed by a second branch that re-derives the licensor
  from the OLD entity and refuses on disagreement. It chose to ADVANCE `last_seen_at` in
  the trigger rather than document a loader obligation, because a dozen already-applied
  importer functions cannot name the column.
- **PR / branch:** #2415, OPEN, **all CI green at `ec278b84...` as of 13:30Z**.
- **Worktree:** live — resumable, but the code work is finished.
- **Deliberately did NOT do:** findings 3, 4 and 5 (all Low) were left alone; #2426 already
  tracks the licensor re-parent successor.

## What is outstanding

| Item | Issue |
|---|---|
| PR #2415 — governed review at the NEW head, guarded merge, preview rehearsal | #2432 |
| Preview rehearsal for the already-merged PR #2423 | #2433 |
| PR #2409 — review, guarded merge, preview rehearsal | #2434 |
| ColdLion send date for #1031 (Albert) | #2435 |
| Governed review runner can destroy a verdict it recorded | #2430 |
| Stale project ref indistinguishable from a deleted project | #2429 |
| #2403 — DesignFlow non-prod schema, blocked on the DesignFlow session decision | #2403 |

## What we tried that did NOT work — MANDATORY

1. **The governed review of PR #2415 at head `0fab4ace...` was destroyed by our own tooling.**
   The reviewer (glm-5.3) produced a careful APPROVE. `recordReviewVerdict` created the
   create-only verdict ref successfully — it exists on the remote and holds a well-formed
   APPROVE commit. Then the **readback disagreed**, the recorder threw
   `create-only verdict readback disagrees with the created object`, and the failure path
   **edited the findings comment** to void its verdict lines. That edit changed the bytes
   whose digest was already committed into the artifact, so the artifact can never validate
   again. Recorded digest `ec6195f6...`; live digest `d49915a5...`.
   **Do not try to escape this with `--replace-failed-reviewer`** — it requires
   `--confirm-no-artifact`, and an artifact *does* exist, so that assertion would be a lie.
   The only honest exit is a new head SHA. Filed as **#2430**. We took the honest exit by
   fixing the reviewer's Medium finding, which produced head `ec278b84...` legitimately.
2. **`--prepare-preview-dispatch` refused with "matching live sole-orchestrator marker is
   required"** despite a healthy marker. Cause: `resolveMarker()` compares the environment
   variable `ORCHESTRATOR_ROUTE_ID` against the marker's `route_id`. Export it before every
   mutating lane command. Not a bug.
3. **`--prepare-preview-dispatch` then refused on the `Migration guarded merge authorization`
   context.** Also not a bug — that status is posted only by the Guarded Merge workflow, and
   the repo is merge-first. Our assumed ordering was simply wrong.
4. **Scope blocks posted as issue COMMENTS are invisible.** `manage-migration-author-lanes.mjs`
   parses the `db-work-scope` fence from the issue **BODY** only. Several classifications sat
   unread as comments and silently stalled their issues. Move the fence into the body.
5. **Review wrappers are not on PATH in the Bash tool but are in PowerShell**, and they need a
   caller variable (`AI_GLM_CALLER`, `AI_MUSE_CALLER`, `AI_GROK_CALLER` set to `claude`). A
   missing caller variable is misreported as a local dependency fault.
6. The reviewer reviews **your working directory**, not the PR. Every review this session ran
   from a fresh clone detached at the exact PR head, in the scratchpad.

## Facts that may already be stale

- `origin/main` = `cb085f37...`, checked 13:30Z. It moves several times an hour.
- PR #2415 CI green at `ec278b84...`, checked 13:30Z. Any push or main merge voids that.
- PR #2409 head `99f5b8055f417a2d42cbf3fa9686c8249a01d610`, CI green, checked 13:26Z.
  It has **not** been reviewed.
- Reviewer pool is five and **two are dead** (deepseek fabricates reviews; codex-review
  returns no verdict). Review **one PR at a time** — two concurrent PRs exhaust the pool.
- The shared checkout `C:\repos\shared-db` is stale and can be locally diverged. Read
  verification facts from `origin/main` in a fresh clone, not from it.

## Secrets sweep

Swept. **Nothing new.** No credential appeared in chat, in a commit, in a scratch file, or in
any diff this session. The 1Password rehearsal-credentials item was read for its
non-concealed fields only and is referenced here by item ID, never by value. Two standing
items remain open from earlier sessions: **#2389**, the preview database password in
1Password is stale and `psql` auth fails; and **#2284**, two exposed proxy credentials that
are still unrotated — rotation needs Albert and has not been authorized.

## Docs pass

`AGENTS.md` is not made wrong by anything this session did. The merge-first ordering it
already states is correct, and it was our belief, not the document, that was wrong. Nothing
outside this handover file is stale.
