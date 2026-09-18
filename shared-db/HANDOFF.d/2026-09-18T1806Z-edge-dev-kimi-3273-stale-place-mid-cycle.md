---
issue: 3273
status: OPEN
owner: kimi/issue-3273-stale-place-rule
---

# Handoff — stale-place rule for the protected-source queue (issue #3273, PR #3274), mid-cycle

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**Blocking:** none. Every gate left in this workstream is mechanical (checks, a
non-GLM governed review, the guarded merge) and is fully specified in §6.

**Not part of this work, already has an owner — no action needed:**

- Five test files fail locally on this machine **identically on a clean
  `origin/main` checkout** (`check-issue-505-licensor-code-forward-repair` ×1,
  `check-sql` ×1, `check-workflow-automatic-promotion-source` ×4,
  `orchestrator-snapshot` ×5, `refresh-code-pr-branch` ×1). These are
  pre-existing environment/fixture issues, consistent with open issue #3255
  ("required checks fail after transfer — test fixtures pin the old repository
  name"). Recommendation: leave to #3255's owner; do not let PR #3274 be blamed
  for them.

**Already settled — do NOT re-ask:**

- 2026-09-17 owner ruling (issue #3232, PR #3247): **"I never want GLM reviewing
  GLM code."** This change counts as authored by a ZCode/GLM-lineage session, so
  the exact-head reviewer of PR #3274 must NEVER be `glm-5.3` or `glm-5.2`.
- 2026-09-18: the repository transferred; `popcre/shared-db` is canonical
  (`u2giants/shared-db` redirects). Use `popcre/shared-db` in every `gh` call.
- Issue #2830 (settled 2026-09-17): repo-maintenance work publishes its
  `.agent` contract pair BEFORE implementation, per
  `docs/agents/agent-work-contract-repo-maintenance-evidence.md`. Followed here.

**Next session: put this whole list to the owner in ONE message before starting
work** — there is nothing in it that should trickle out one gate at a time.

## 1. What this application is

`popcre/shared-db` is POP Creations' governed shared Supabase database
repository: the schema, migrations, and the coordination machinery (author
lanes, reviewer rotation, guarded merges) that every app (DesignFlow PLM,
popcrm, popdam, etc.) depends on. It is the most heavily gated repo in the
fleet — an orchestrator session governs structural work, and every other
session (like this one) does either read-only work or `repo-maintenance`
(defect fixes to the repo's own scripts, no migration, no database object).
Where it runs: GitHub + Supabase project `qsllyeztdwjgirsysgai` (production).

## 2. What we set out to do this session, and why

Implement the **stale-place rule** (issue #3273) in
`scripts/check-pr-source-collisions.mjs`. Today any non-draft open PR editing
`scripts/manage-migration-author-lanes.mjs` serializes every newer PR touching
that file behind it **forever**. Evidence, 2026-09-18: PRs #3215, #3217 and
#3228 sat 8+ hours ahead of #3247 in that queue. The rule: such a PR no longer
precedes a newer PR when **ALL** of (a) no activity for 24+ hours, (b) latest
checks failing OR conflict with main, (c) the newer PR's session posted a dated
nudge comment on it naming the stale state. It reclaims its place automatically
once refreshed and green. Repo-maintenance only: two script/test files (+ one
shared test file, see §5), no migration, no database write.

## 3. Current state — what is true right now (verified 2026-09-18 ~18:05 UTC)

- Worktree `C:/repos/shared-db-wt-3273`, branch
  `kimi/issue-3273-stale-place-rule`, cut from `bd647f6ad701f51b8d0263614b1d73763f2f6f2d`.
- **Pushed:** `37cbdedd` (implementation v1: `scripts/check-pr-source-collisions.mjs`
  + its `.test.mjs`), `b687df8d` (evidence pair gen 1). **PR #3274 is open.**
- **Published immutable contracts:** `refs/db-contracts/3273/1` (hash
  `29b63f652b5aa505f5ac82ad0beaa21b2654021137c705b49ec67daf3d0c39df`) and
  `refs/db-contracts/3273/2` (sha `0fa53aa9d2a3104275e57338956c66219e4218e4`,
  hash `31966749165f6bb8393be15c0de77dabe3776db47cf1c2afe06136f5751e3522`).
  Gen 2 widens `allowed_paths`/`file_writes` by exactly
  `scripts/lib/open-pr-files.test.mjs` (reason in §4/§5).
- **Uncommitted in the worktree (both ready, both tested):**
  - `.agent/contract.json` — generation 2 content, already published (above).
  - `scripts/lib/open-pr-files.test.mjs` — the CI fix: the two `gather()`
    coupling tests now inject `detail`/`commits`/`comments`/`checkRuns` fakes
    and assert the same quota discipline for the stale-place reads.
  - Test results: `node --test scripts/lib/open-pr-files.test.mjs` → 6 pass/0
    fail; `node --test scripts/check-pr-source-collisions.test.mjs` → 16
    pass/0 fail; `node scripts/check-cancelled-work.mjs` → OK.
- CI on `37cbdedd`: everything green EXCEPT (1) `Agent work contract` —
  expected, that run predated the evidence-pair push; (2) `Cross-PR Object
  Collision` — the real failure fixed by the uncommitted test edit (§4). Runs
  for `b687df8d` had only just started when this session paused; `Database
  Contract Tests` was still `in_progress`.
- The implementation itself: `openProtectedCollisions` skips a preceding PR
  only via `stalePlaceYield` (all three conditions, fail closed on any
  unreadable signal); helpers `parseStalePlaceNudge`, `stalePlaceNudgeLine`,
  `lastActivityAt`, `latestChecksFailing`, `conflictsWithMain`,
  `stalePlaceSkips` are exported and unit-tested; `gather()` enriches ONLY
  overlapping predecessors with the stale signals; `main()` prints
  `STALE-PLACE SKIP:` audit lines.

## 4. Everything we tried that did NOT work

- **`node --test scripts/*.test.mjs` as one command times out locally** (>5 min,
  72 files). Fix: run in chunks (we used 5 batches of ≤24 files); the only
  failures reproduce on a clean `origin/main` worktree — see §0.
- **Contract generation 1 was too narrow.** CI's `Cross-PR Object Collision`
  job runs `scripts/lib/open-pr-files.test.mjs`, whose coupling test
  "source collisions are unchanged, and timelines are read only for overlapping
  PRs" calls `gather()` with only `load`/`timeline` fakes — my `enrich()` then
  shelled out to real `gh` and died ("set the GH_TOKEN environment variable").
  Published refs are immutable, so the fix was a NEW generation (`/3273/2`)
  adding the shared test file to `allowed_paths`, published BEFORE editing it.
  Never try to replace a published generation.
- **`gh` is not on PATH** for Git Bash or for Node child processes on this
  machine. Every command touching GitHub needs
  `export PATH="/c/Program Files/GitHub CLI:$PATH"` first (this also fixes
  `spawnSync gh ENOENT` from repo scripts).
- **Git Bash mangles `git show origin/main:.agent/completion.json`** into a
  Windows path. Prefix with `MSYS_NO_PATHCONV=1`.
- First evidence-pair validation failed with "pull request validation requires
  the exact 40-character head SHA" — `--validate-completion` needs
  `--expected-head-sha` alongside `--expected-pr`.

## 5. Root causes and key findings

- **The evidence gate** (`scripts/agent-work-contract-git-evidence.mjs`,
  `verifyGitEvidence`): after `report.head_sha`, ONLY `.agent/contract.json` and
  `.agent/completion.json` may change; `files_changed` must equal
  `git diff --name-only <merge-base> <head_sha>` exactly; the checked-in
  contract must hash-match the immutable published ref. Because the test fix
  adds a third implementation file, `head_sha` MUST move to a new implementation
  commit and `files_changed` must list all three files — see §6.
- **The reviewer machinery:** `node scripts/manage-migration-author-lanes.mjs
  --assign-reviewer --issue 3273 --pr 3274 --head-sha <sha>` draws from
  `ACTIVE_REVIEWERS` (Grok 4.6, GLM 5.3, Kimi K3, Qwen 3.8 Max, Muse Spark 1.3
  Contributor, Gemini 3.8 Flash High, minus the live orchestrator's engine);
  `scripts/run-governed-review.mjs --issue --pr --head-sha --reviewer <name>
  --wrapper <wrapper> --worktree <path> -- <args>` runs the reviewer, posts the
  findings comment, and creates the durable create-only verdict artifact.
  Scripts/docs/CI-only work needs ONE independent reviewer (AGENTS.md §4 rule 1).
  ⚠️ The glm exclusion in `reviewersForOrchestrator` keys off the LIVE
  ORCHESTRATOR's engine — this session is not the orchestrator, so **the draw
  can still return a glm reviewer; the 2026-09-17 ruling binds regardless. If
  the draw returns `glm-5.3`/`glm-5.2`, do NOT run it** — use the machinery's
  exclusion/return path (`--exclude-reviewer`, documented in the same script's
  error text) and re-draw. Suggested first choice: Grok via the `ai-grok-review`
  wrapper (skill `grok-cli`).
- **The merge gate:** `scripts/check-exact-head-approval.mjs` requires an
  APPROVE pinned to the exact merged head. A refresh from main keeps the
  APPROVE only if the PR's own diff is byte-identical ignoring `.agent/`
  (rule #2758) — main has moved (`bd647f6a` → `5b9b301f3`+); before merging,
  check whether main touched the three changed files since `bd647f6a`.
- **Nudge pollution (the subtle design point):** a nudge comment bumps the stale
  PR's `updated_at`, which would instantly defeat condition (a). So
  `lastActivityAt` never uses `updated_at` and excludes nudge-marker comments;
  everything else (commits, reviews, labels, ordinary comments) counts.
- **Nudge marker format** (machine-readable line in a comment on the stale PR):
  `stale-place-nudge: pr=#<newerPR> date=<YYYY-MM-DD> state=inactive-24h+checks-failing`
  (states ∈ `inactive-24h`, `checks-failing`, `conflicts-with-main`, `+`-joined).
  The gate cannot bind a comment to a session, so the marker naming the newer
  PR's number is the enforceable proxy — documented in the rule header comment.
- **`mergeable` is null while GitHub computes it** → treated as NOT conflicting
  (fail closed toward no-skip). Check health = latest run per check NAME;
  failing conclusions: `failure`, `cancelled`, `timed_out`, `action_required`.

## 6. Exact next steps

Do these in order. **At the end of each step, re-read every later step (to
step 8) and report any drift** — anything you did or learned that changes a
downstream assumption (new head SHA, new CI failure, main touching our files).

1. **Commit the test fix as implementation v2.** In `C:/repos/shared-db-wt-3273`:
   `git add scripts/lib/open-pr-files.test.mjs` (NOT `.agent/` yet),
   `git commit -m "fix(#3273): inject stale-place readers in the shared snapshot coupling test"`.
   Gate: `git show --name-only --format= HEAD` lists exactly
   `scripts/lib/open-pr-files.test.mjs`. Record the new SHA as `<IMPL2>`.
2. **Rewrite `.agent/completion.json` for generation 2:** `contract_ref:
   refs/db-contracts/3273/2`, `contract_sha256:
   31966749165f6bb8393be15c0de77dabe3776db47cf1c2afe06136f5751e3522`,
   `head_sha: <IMPL2>`, `files_changed: [scripts/check-pr-source-collisions.mjs,
   scripts/check-pr-source-collisions.test.mjs, scripts/lib/open-pr-files.test.mjs]`
   (verify with `git diff --name-only bd647f6ad701f51b8d0263614b1d73763f2f6f2d <IMPL2>`),
   `pr: 3274`, refreshed `checks` evidence (16/6 test counts, cancelled-work OK,
   chunked full-suite note), and add a resolved assumption naming the gen-2
   widening. Gate: `node scripts/agent-work-contract.mjs --validate-completion
   --report-file .agent/completion.json --contract-file .agent/contract.json
   --expected-pr 3274 --expected-head-sha <IMPL2>` exits 0.
3. **Commit the evidence pair and push:** stage ONLY `.agent/contract.json` and
   `.agent/completion.json`; commit `chore(#3273): work contract evidence pair
   (refs/db-contracts/3273/2)`; push. Gate:
   `node scripts/agent-work-contract-git-evidence.mjs --contract-file
   .agent/contract.json --report-file .agent/completion.json --pr-base-sha
   bd647f6ad701f51b8d0263614b1d73763f2f6f2d --pr-head-sha <new head>` prints
   "Git evidence matches…" and exits 0.
4. **Watch CI on the new head.** Gate: `gh pr checks 3274 -R popcre/shared-db`
   shows `Agent work contract` and `Cross-PR Object Collision` (and everything
   else) passing; no failure may be explained away without proving it also
   fails on clean `origin/main` (`node scripts/triage-gate.mjs <guard>` first
   per §4 rule 1 of AGENTS.md).
5. **Exact-head independent review — NEVER glm.** Run
   `--assign-reviewer --issue 3273 --pr 3274 --head-sha <evidence-pair head>`.
   If the draw is `glm-5.3`/`glm-5.2`, refuse it via the machinery's exclusion
   path and re-draw (§5). Then `node scripts/run-governed-review.mjs --issue
   3273 --pr 3274 --head-sha <head> --reviewer <drawn> --wrapper <wrapper>
   --worktree C:/repos/shared-db-wt-3273 -- <wrapper args>` (Grok first choice).
   Gate: a durable create-only APPROVE verdict artifact pinned to the exact head
   plus the findings comment on PR #3274. Silence or a coverage-less verdict is
   NOT approval (issue #1220) — replace the reviewer, never pause the queue.
6. **Guarded merge.** Read AGENTS.md §5 and
   `.github/workflows/guarded-migration-merge.yml` before dispatching; scripts-only
   PRs need one independent APPROVE at the exact head. If main moved, refresh
   only when the PR's own diff stays byte-identical (rule #2758) and main did
   not touch the three files; otherwise re-review the new head. Gate: PR #3274
   merged; `git log origin/main --oneline -3` shows the merge commit.
7. **Close out:** verify the merged files on `origin/main`; delete THIS handoff
   file in the commit/PR that closes issue #3273 (successor rule: its status
   line says committed+pushed, all obligations carried, nothing unique lost);
   close issue #3273; `git worktree remove C:/repos/shared-db-wt-3273`.
   Gate: `gh issue view 3273` shows closed and `HANDOFF.d/` no longer lists
   this file.

## 7. Constraints and gotchas in force

- **Worktree-only** (AGENTS.md §2.1-W): never work in the shared
  `C:/repos/shared-db` checkout. This handoff file is the one exception — it
  lives there so the worktree can be deleted.
- Only the three `allowed_paths` (contract gen 2) may change in PR #3274; only
  the two `.agent` files may follow `<IMPL2>`.
- Never edit another session's handoff/worktree/branch/claim; never hand-edit
  fenced blocks in governed issues.
- Fail closed everywhere: an unreadable signal means NO stale-place skip; a
  guard failure is a stop, not a prompt to widen the gate.
- `gh` needs `export PATH="/c/Program Files/GitHub CLI:$PATH"` in every new
  shell; use `-R popcre/shared-db` (canonical) though the old slug redirects.
- `MSYS_NO_PATHCONV=1` for `git show origin/main:<path>` in Git Bash.
- The reviewer of THIS PR is never glm (owner ruling 2026-09-17) — the
  machinery's auto-exclusion does not cover us (§5), so enforce it manually.

## 8. Access and environment

- Machine `edge-dev`; Git Bash; `gh.exe` at `C:\Program Files\GitHub CLI\gh.exe`,
  authenticated as `u2giants` (keyring). No other credentials were needed this
  session; secrets, if ever needed, live in the `vibe_coding` 1Password vault
  (never copy values anywhere).
- Repo remote `https://github.com/popcre/shared-db.git`; worktree
  `C:/repos/shared-db-wt-3273` (branch above); shared checkout
  `C:/repos/shared-db` (do not work in it).

## 9. Open questions and risks

- **2026-09-18:** `Database Contract Tests` was still running at handoff; if it
  fails on the new head, triage before assuming it is ours (it was queued on
  `37cbdedd`, before the evidence pair).
- **2026-09-18:** the five pre-existing local test failures (§0) reproduce on
  clean `origin/main`; if CI shows them too, that is a repository-level problem
  owned by #3255, not this PR — but prove it per-guard, never assert it.
- **2026-09-18:** main is moving quickly tonight; the exact-head APPROVE +
  refresh-equivalence rule (#2758) decides whether a refresh keeps the verdict.
  When in doubt, re-review the new head — a stale APPROVE is worthless.
- **2026-09-18:** the reviewer draw may return glm despite the ruling (§5);
  running that review anyway would violate the owner's explicit 2026-09-17
  instruction. This is the single easiest mistake for the next session to make.

---

### Self-audit answers (handoff-writer gate)

1. **Newcomer pickup without missing a beat?** Yes — §1–§3 give the repo, the
   goal, the exact commit/branch/worktree/ref state; §6 is executable without
   judgment calls, each step gated.
2. **As effectively as this session?** Yes — every non-obvious discovery (nudge
   pollution, mergeable-null semantics, the glm-draw gap, gh PATH, MSYS path
   mangling, gen-2 immutability mechanics) is in §4/§5 with identifiers.
3. **Every relevant detail?** Yes — background (§1–2), state with SHAs (§3),
   failures (§4), findings (§5), next actions + gates (§6), constraints (§7),
   environment (§8), risks dated (§9).
4. **§0 complete vs §1–§9?** Yes — the sweep found: the five pre-existing
   failures (§3/§4/§9 → §0 "not part of this work"), the never-glm ruling
   (§5/§6/§7 → §0 "already settled"), the transfer canonical slug (§5/§7 → §0
   "already settled"), the contract-before-work convention (§5 → §0 "already
   settled"). No other sentence in §1–§9 requires the owner's judgement.
