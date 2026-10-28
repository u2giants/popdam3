# Implementation Plan — shared-db CI and merge-lane speedup

## STATUS

| Step | Status | Evidence |
|---|---|---|
| 1. Widen author check-in freshness window | done 2026-10-23 | landed with the first batch (A1) |
| 2. Auto-rerun Migration author lease after check-in | done 2026-10-25 | #4742 lane watchdog auto-restarts stuck lane checks |
| 3. Fold production risk assessment into the first review | done 2026-10-25 | #4741 |
| 4. Auto-fill PR number in evidence completion | done 2026-10-23 | landed with the first batch (B1 tooling) |
| 5. Rebind migration version without a new review generation | done 2026-10-25 | #4736 |
| 6. Auto-trigger required CI on PR open | done 2026-10-23 | landed with the first batch (D1) |
| 7. Speed up check-in / lease claim commands | done 2026-10-25 | #4736 (quota sleeps 900s to 120s, aggregate patience 50m to 15m) |

Verified 2026-10-28 via gh: #4736, #4741 and #4742 are all MERGED. Still open elsewhere:
the merge-queue timeout paired PR and the rls ephemeral flake live on their own issues.
Related and landed after this plan: the pure-prose fast CI route now covers the
merge-queue and push events too (#4960, PR #4970), so a prose-only change skips the
engineering suites on every event.

Fresh session starts at Step 1. Read this STATUS table first — do not re-derive or re-plan.

Related handoff: [20261023T1555Z-edge-dev-mimo-ci-speedup-plan.md](HANDOFF.d/20261023T1555Z-edge-dev-mimo-ci-speedup-plan.md)

---

## 1. Ultimate goal

Make a shared-db schema change go from "code written and tests green" to "merged, applied to production, live proof recorded" in minutes, not an hour.

Today the SQL and reviews are fine. The hour is lost to process: expired check-ins, lease checks that need manual reruns, a second review just for production risk, evidence files that must be rewritten when a version is re-reserved, and required CI that sometimes never starts.

If a step conflicts with this goal — faster, safer promotion of reviewed schema changes — the goal wins. Stop and flag it.

## 2. What this application is

`popcre/shared-db` is the shape-of-database source of truth for POP Creations' shared Supabase project. It holds timestamped migrations, schema/API contracts, the business-rule library, and the operating rules every AI session must follow when changing shared structure. CRM, DAM, PM/PIM, and DesignFlow PLM all read the same tables.

- Repo: https://github.com/popcre/shared-db
- Default branch: `main`
- Stack: SQL migrations, Node.js gate scripts (`scripts/`), GitHub Actions
- Production Supabase project: `qsllyeztdwjgirsysgai` (do not write a preview ref down)
- Preview Supabase branch: repository variable `PREVIEW_PROJECT_REF`

There is no application runtime in this repository. "Shipping" means: branch + PR + guarded merge into `main`, then the bounded production apply lane.

## 3. What triggered this work

Albert Hazan (owner), 2026-10-23, during RLS InitPlan work on issues #4427–#4430:

> "how can it take 1 hour just to merge and apply 4429 to production? something's wrong with our process."
>
> "the 1 hour was JUST for merge and apply to production after main stopped moving."
>
> "after this is all done we need the merge lane to accept an author check-in older than 10 minutes old. what other part of the process can be truncated?"

Observed on machine `edge-dev` (Windows), session `ses_ffe5ea037df8fffe3G25lkMmEh`. Reproduce by running a normal shared-db structural change end-to-end and timing the post-green-CI merge+apply path.

## 4. Scope

**In scope**
- The post-green-CI path: author check-in, migration author lease check, guarded merge, production risk assessment, production apply dispatch.
- Evidence-pair bookkeeping that forces full rewrite when a migration version is re-reserved.
- CI triggering reliability on PR open.

**NOT in this plan**
- Changing what the reviews judge (policy correctness, SQL safety).
- Changing production apply SQL semantics or the migration ledger model.
- App-repo deployment pipelines.
- The RLS InitPlan program itself (#4427–#4430) — that work is separate and nearly done.
- Reviewer provider reliability (StepFun/DeepSeek skips) — tracked in `ai-reviewer-issue` record `20261023T142309Z-edge-dev-stepfun-124126`.

## 5. Current state of the code

All of the following is in `popcre/shared-db` on `main` or in `scripts/` + `.github/workflows/`:

- **Author check-in** (`scripts/manage-migration-author-lanes.mjs`, `checkInAuthor`): writes `refs/db-author-checkins/<claim>-<version>-<hash>`. The merge lane refuses when the confirmation is "missing, future or older than ten minutes" (`AUTHOR_CHECKIN_INTERVAL_MINUTES = 10`). File: `scripts/manage-migration-author-lanes.mjs` near the `validateAuthorCheckin` function (~line 4335).
- **Migration author lease check** (`.github/workflows/migration-author-lease.yml` → `scripts/check-migration-pr-lease.mjs`): runs `--check-in-author` validation. Fails on expired lease or stale check-in. Re-runs are manual (`gh run rerun --failed`).
- **Guarded merge** (`.github/workflows/guarded-migration-merge.yml`): two jobs — `Prepare` (required-check preflight, self-service boundary) and `Protected merge` (merge lease, re-prove head, merge). Prepare refuses when any required check is failing/pending. Protected merge refuses on stale check-in, merge freeze, or backdated migration version.
- **Production apply** (`.github/workflows/shared-supabase-migrations.yml`, jobs `Production apply review` + `Production apply`): the review job re-derives business risk and refuses unless a durable exact-head APPROVE carries a `production-risk-assessment` block. That block is produced by a **second** governed review (slot 2) on the merged PR head (`scripts/run-governed-review.mjs` with `--production-risk-*` flags, `scripts/prove-production-risk-acceptance.mjs`).
- **Evidence pair** (`.agent/work/<issue>/<gen>/{contract,completion}.json`): `completion.json` records `pr`, `head_sha`, `migration_versions`, `files_changed`. Any version supersession (`--reversion-active-claim`) or PR re-open forces a new generation or a pair rewrite.
- **CI triggering**: `pr-guards.yml`, `tools-offline-tests.yml`, `shared-supabase-migrations.yml`, `migration-author-lease.yml` trigger on `pull_request`. Observed on 2026-10-23 (PR #4682) that only `Documents-*` workflows ran; required checks never started until manual `workflow_dispatch`.

## 6. Key findings and root cause

1. **Check-in freshness (10 min) is shorter than CI + human/agent latency.** `AUTHOR_CHECKIN_INTERVAL_MINUTES = 10` in `scripts/manage-migration-author-lanes.mjs`. The merge lane's protected job re-reads it. Ephemeral DB tests alone take ~7 minutes; by the time all required checks pass and the merge job starts, the check-in taken before CI is stale. Evidence: merge run 39970394727, "author check-in confirmation is missing, future or older than ten minutes" at 2026-10-23T14:34:33Z after check-in at 14:23:59Z.
2. **Lease check fails once, then needs a manual rerun.** `migration-author-lease.yml` runs on PR synchronize; it fails when the lease is expired at that moment. After `--check-in-author`, the already-failed check must be re-run by hand. Evidence: PR #4680 job 120464882429 failed, job 120469254384 passed after rerun.
3. **Production risk assessment is a separate paid review.** The first review (slot 1) approves the code. The production apply gate requires a `production-risk-assessment` JSON block that only a slot-2 review on the merged head produces. Evidence: production run 39972517357 refused with "no durable allocator-assigned exact-head APPROVE for PR #4680 ... review slot 1 has no durable APPROVE for its latest exact-head assignment" — then a slot-2 GLM review with `--production-risk-*` produced the block and the apply succeeded (run 39975696968).
4. **Evidence pair rewrite on version re-reserve.** `--reversion-active-claim` renames the migration file and creates a new head. `completion.json` `head_sha` / `files_changed` and the contract's `allowed_paths` then mismatch, forcing a new contract generation + pair commit + often a fresh PR (review-budget ancestry). This loop repeated 7+ times on #4428 alone.
5. **Required CI sometimes never starts on PR open.** On 2026-10-23 PR #4682, only Documents-* workflows ran for the head commit. `pr-guards.yml` / `tools-offline-tests.yml` / `shared-supabase-migrations.yml` / `migration-author-lease.yml` did not appear until manual dispatch. Root cause not yet proven (runner routing vs. event delivery).

## 7. Approaches considered and REJECTED

- **Delete the check-in entirely.** Rejected: it is the live proof that the claim owner is still the session doing the merge. Widening the window is enough.
- **Let the author merge with `gh pr merge` bypassing the lane.** Rejected: the guarded merge lane re-proves head, lease, and collisions under a lock. Bypassing it is how PR #1809 merged unreviewed bytes.
- **Skip production risk assessment entirely.** Rejected for the default path: owner ruling 6.23 makes the AI reviewer accept those classes. But Albert instructed 2026-10-23 "don't do a second review for #4430" — so the plan must support a **folded** risk assessment in the first review, and an explicit owner-authorized skip path, not a silent omission.
- **Keep forcing a new PR on every force-push.** Rejected as the only path: it burns review budget and time. Prefer allowing the same PR to carry a rebind when the PR diff is unchanged (already partially exists via `.agent/` equivalence in `scripts/lib/pr-content-equivalence.mjs`).
- **Manually re-run lease checks forever.** Rejected: it is pure toil. Auto-rerun is a workflow change.

## 8. Design decisions already made

**Locked (do not relitigate)**
- Guarded merge stays the only path to `main` for migrations (owner rulings; AGENTS.md §5). [locked 2026-09-28]
- One independent exact-head APPROVE is enough for code review (owner ruling 2026-10-14). [locked]
- Database writes skip the human approval gate; the AI reviewer is the gate (owner ruling 2026-09-28). [locked]
- Never reuse a migration version. [locked — incident 2026-07-31]

**Open for the implementer**
- Exact new value for the check-in window (proposal: 60 minutes, or "valid until claim lease expires").
- Whether production risk folds into slot 1 always, or only when the owner marks `unreviewed-week`.
- Whether version rebind keeps the same PR or always opens a new one.

## 9. The plan

### Phase A — Check-in and lease (biggest win, low risk)

**Step A1. Widen the author check-in freshness window.**
- Change `AUTHOR_CHECKIN_INTERVAL_MINUTES` from `10` to `60` in `scripts/manage-migration-author-lanes.mjs` (find via `rg AUTHOR_CHECKIN_INTERVAL_MINUTES`).
- Update `validateAuthorCheckin` in the same file so the bound is `min(60, minutes until lease expires)`.
- Update any test that asserts 10 minutes (`scripts/manage-migration-author-lanes.test.mjs`, `rg "ten minutes|10 minutes|AUTHOR_CHECKIN"`).
- Intent: a check-in taken before CI is still valid when the merge job starts.
- Verification gate: `node --test scripts/manage-migration-author-lanes.test.mjs` passes; a claim checked in 30 minutes ago is accepted by `check-migration-pr-lease.mjs` in a local dry run.

**Step A2. Auto-rerun the Migration author lease check after check-in.**
- In `.github/workflows/guarded-migration-merge.yml`, `Prepare` job: when the only failing required check is `Migration author lease` and the claim has a fresh check-in, trigger `gh run rerun <run> --failed` and wait, instead of refusing.
- Alternatively: make `migration-author-lease.yml` itself listen for a `check-in` commit/comment and re-run.
- Verification gate: a PR whose lease check failed on a stale check-in goes green without a human `gh run rerun` after `--check-in-author`.
- Judgment call: bounded wait (proposal 3 minutes) then still refuse — do not loop forever.

### Phase B — Production risk without a second full review

**Step B1. Allow the first review to carry the production-risk block.**
- Extend `scripts/run-governed-review.mjs` so `--production-risk-*` is accepted on an open PR (today it refuses: "production-risk request applies only to a merged source pull request").
- Change `scripts/prove-production-risk-acceptance.mjs` to accept a block recorded at the PR head before merge, not only at the merged head.
- Update `shared-supabase-migrations.yml` production review job to read the block from the pre-merge verdict when present.
- Verification gate: a PR reviewed once with `--production-risk-classes expected_downtime,material_access_change,permanent_data_rewrite_or_loss` reaches production apply with no slot-2 review.
- Adversarial cases (trust boundary — production risk acceptance):

| External input | Hostile case | Test that proves it |
|---|---|---|
| `production-risk-assessment` JSON | missing fields / extra fields | `scripts/prove-production-risk-acceptance.test.mjs` parse rejection |
| assessment text | empty or <40 chars | same test file, `not substantive` case |
| `main_sha` in block | does not match the apply target | `prove-production-risk-acceptance` binding check |
| `ordered_allowlist` | includes a version not in the apply | production review job allowlist compare |
| two blocks in findings | duplicates | `parseRiskAssessment` count==1 assertion |
| block on a REVISE/REJECT verdict | non-APPROVE with risk block | verdict-word check before risk acceptance |

**Step B2. Owner-authorized skip path (for `unreviewed-week`).**
- When the PR carries label `unreviewed-week` and `ai-task-gates` prints `MERGE-UNREVIEWED`, the production apply review may proceed using the owner no-reviewer rule + this plan as the documented exception, recording `owner-authorized-skip` in the evidence JSON.
- Do **not** make this the default. It is the escape hatch Albert already used on 2026-10-23.
- Verification gate: a labelled PR applies to production without any slot-2 review; an unlabelled PR still refuses.

### Phase C — Evidence pair and version rebind

**Step C1. Auto-fill `pr` in `completion.json` on PR create.**
- Add a small script `scripts/bind-completion-pr.mjs` (or extend `agent-work-contract.mjs`) that, given `--pr <n>`, updates `completion.json` `pr` and commits only that file.
- Wire it into the PR-create path the session already uses (document the one-liner in `docs/agents/current-workflow.md`).
- Verification gate: `node scripts/agent-work-contract.mjs --validate-completion ... --expected-pr <n>` passes without a manual JSON edit.

**Step C2. Rebind migration version in place when the PR diff is unchanged.**
- When `--reversion-active-claim` renames only the migration file and updates version strings, allow the same contract generation to be re-published with a `version_rebind` note instead of a full new generation — or at least allow the same PR to carry the rename commit without review-budget ancestry failure.
- Touch: `scripts/manage-migration-author-lanes.mjs` (`reversionActiveClaim`), `scripts/lib/pr-content-equivalence.mjs`, `scripts/agent-work-contract-git-evidence.mjs`.
- Verification gate: a version re-reserve on an open PR keeps the same PR and the existing APPROVE if the non-migration diff is identical.

### Phase D — CI reliability

**Step D1. Ensure required CI runs on every PR open/synchronize.**
- Root-cause why PR #4682 saw only Documents-* workflows. Check `runner-route.yml` / Blacksmith routing and the `pull_request` triggers on `pr-guards.yml`, `tools-offline-tests.yml`, `shared-supabase-migrations.yml`, `migration-author-lease.yml`.
- If a required workflow is skipped when no paths match, remove that skip (the comments already say "NO `paths:` FILTER, ON PURPOSE").
- Verification gate: opening a PR with a new migration always produces a `Migration author lease` and `SQL migration guards` check run within 2 minutes without manual dispatch.

**Step D2. Prepare-job bounded wait already exists; make it report what it is waiting on.**
- In `guarded-migration-merge.yml` `Prepare`, when required checks are pending, print the list of pending contexts so the operator knows what is stuck.
- Verification gate: a stuck prepare job's log names the pending check contexts.

## 10. Tests required

- `scripts/manage-migration-author-lanes.test.mjs` — update the 10-minute assertions; add a case for a 30-minute-old check-in being valid and a lease-expired check-in being refused.
- `scripts/prove-production-risk-acceptance.test.mjs` — extend for the adversarial table in Step B1.
- `scripts/check-migration-pr-lease.test.mjs` — lease + fresh check-in happy path; stale check-in path after the window change.
- `scripts/agent-work-contract-git-evidence.test.mjs` — version-rebind equivalence if Step C2 changes it.
- Existing suites that must stay green: `node --test scripts/manage-migration-author-lanes.test.mjs scripts/check-migration-pr-lease.test.mjs scripts/agent-work-contract.test.mjs`.

## 11. Constraints, standing rules, and gotchas

- Database structure changes go through `popcre/shared-db` only — never app-repo migrations.
- Never reuse a migration version; never edit an applied migration.
- Branch + PR + guarded merge for this repo; never push directly to `main`.
- One independent exact-head APPROVE is enough; do not reintroduce a two-review minimum.
- Reviewer recording is fragile on `edge-dev` (see reviewer-issue `20261023T142309Z-edge-dev-stepfun-124126`); do not block a speedup plan on StepFun/DeepSeek.
- `ai-gh` is the shared GitHub throttle on this machine; do not bypass it with raw hot-loop `gh` polls.
- Signed comments: `Posted by MiMo chat <id> on <machine>`.
- Secrets live only in 1Password vault `vibe_coding`; never by value in code or plans.

## 12. Access and environment

- CLIs: `gh` / `ai-gh` authenticated as `u2giants`; `supabase` CLI; `node` (repo scripts).
- Target repo: `popcre/shared-db`, branch `main`.
- Worktrees used for authoring: `D:/repos/shared-db-worktrees/*`.
- Supabase CLI token and DB password: 1Password vault `vibe_coding` (items "Supabase CLI Personal Access Token", "Supabase DB Password - shared POP database"). Never copy values into files.
- Local test command: `node --test scripts/<name>.test.mjs` from a worktree of `popcre/shared-db`.

## 13. Definition of done + risks and open questions

**Done when**
- [ ] Check-in window widened and tests updated (Step A1).
- [ ] Lease check auto-reruns or self-heals after check-in (Step A2).
- [ ] Production risk can be carried by the first review; slot-2 is optional (Step B1).
- [ ] `unreviewed-week` skip path exists and is recorded (Step B2).
- [ ] Completion `pr` auto-fill exists (Step C1).
- [ ] Version rebind does not force a new PR when the diff is unchanged (Step C2).
- [ ] Required CI runs on every PR open within 2 minutes (Step D1).
- [ ] Each step's verification gate is green on a real PR.
- [ ] Plan STATUS table updated with artifact citations (CI run ids, SHAs).
- [ ] HANDOFF.d file updated to point at the finished plan.

**Risks**
- Widening the check-in window slightly reduces "is the owner still here?" signal. Mitigate by still expiring at claim lease end.
- Folding risk into slot 1 concentrates more judgment in one review. Mitigate with the adversarial tests in B1.
- Auto-rerun could loop if the lease is genuinely expired. Mitigate with one retry then hard refuse.

**Open questions**
- Is 60 minutes the right check-in window, or should it simply equal the remaining claim lease?
- Should version rebind ever require a new review if the migration SQL body changed (not just the filename)? (Yes — treat body change as a new review.)
- Does the owner want `unreviewed-week` to skip production risk permanently, or only during reviewer outages?

---

## Self-audit

1. **Could a brand-new AI session execute this plan without asking anything?** Yes — Sections 5–9 name the exact files, functions, and current values (`AUTHOR_CHECKIN_INTERVAL_MINUTES = 10`, the 10-minute message string, the workflow job names), and every step has a verification gate. Section 12 covers auth and paths.
2. **Does the plan carry every piece of background, nuance, and reasoning?** Yes — Section 6 records the four observed failure modes with run ids and timestamps; Section 7 records rejected approaches (delete check-in, bypass lane, skip risk silently, always-new-PR, manual reruns); Section 8 labels locked vs open decisions.
3. **Is the ultimate goal clear enough for judgment calls?** Yes — Section 1 states the business goal (minutes not hours) and the "goal wins" rule. Section 8's open list names the criteria for the remaining choices.

All three answers are supported by the sections above. No checklist item is open.
