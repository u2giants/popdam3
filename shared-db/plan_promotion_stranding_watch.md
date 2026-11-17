---
summary: Stop merged shared-db migrations from stranding unpromoted and unnoticed — the promotion selector marks every parked or long-held PR on the PR itself (comment + label, cleared on delivery), and sessions check those labels at start and before ending.
kind: implementation-plan
status: ready-for-implementation (revision 3, 2026-11-17)
read-when: implementing or reviewing the stranded-PR escalation in the automatic promotion trigger or the promotion-watch session rule; when a merged migration sits unpromoted and nobody knows.
---

# Plan: promotion-stranding watch (revision 3)

Implementation issue: popcre/shared-db#6561. Revision 3 follows a review of
the first draft (`issues/6561#issuecomment-6949048674`) and a debate of
revision 2 with an independent reviewer (record on the issue). What changed
and why is in §7 and §8.

## STATUS

| Step | Status | Evidence / next action |
|---|---|---|
| 0. Plan landed | ✅ | PR #6560 (draft 1), PR #6562 (revision 2); revision 3 by the PR that carries this text |
| 1. Permission: trigger job `pull-requests: write` + guard test | ✅ | PR #6589 (merged da185c26f) |
| 2. Shared per-PR classifier (pure refactor) | ✅ | PR #6589 (merged da185c26f) |
| 3. Reconciler: mark parked + held-over-8h, repair, clear | ✅ | PR #6589 (merged da185c26f) |
| 4. Durable failure reporting | ✅ | PR #6589 (merged da185c26f) |
| 5. Tests | ✅ | PR #6589 (merged da185c26f) |
| 6. Live proof A (immediate): today's stranded PRs carry notice + label; real API responses recorded | 🟡 partial | clean reconciler pass, run 44146394316; R5 write responses await first real park (issue #6561 comment 6956941560) |
| 7. Session rule: rulebook pair | ✅ | PR #6597 |
| 8. Session rule: skill sources | ✅ | popcre/ai-devops#2585; installed and verified on edge-dev3 2026-11-17 |
| 9. Live proof B: a labelled PR is cleared automatically on delivery | ⬜ waits on first real park or 8h hold | record on #6561 |

A fresh session starts at §9 step 1 after re-deriving current state (§5).

---

## Part 1 — Why

### 1. The ultimate goal

**A merged database change must never sit undelivered to production with
nobody who knows and nobody who will act.** When the automatic promotion lane
parks a merged migration PR (out of automatic attempts) or holds it (open
review finding) for a long time:

1. The stranded PR itself says so, durably and queryably (comment + label),
   and stops saying so when it is delivered.
2. Anyone can find every stranded change with one query, and sessions are
   told to run it (best-effort — see R9; the marking in point 1 is the only
   guarantee).
3. If the marking itself breaks, that is visible somewhere durable — it must
   never fail quietly.

If a step conflicts with this goal, the goal wins — stop and flag it. The goal
does NOT include making promotions succeed or auto-repairing them.

### 2. What this system is

`popcre/shared-db` is the structure source of truth for the one shared
Supabase project behind all POP Creations apps. Migrations merge to `main`
through a GitHub merge queue. The **automatic production promotion lane** then
delivers each merged migration: `.github/workflows/automatic-production-trigger.yml`
(hourly cron + push/nudge triggers) runs `scripts/automatic_promotion_candidates.py`
("the selector"), which picks the oldest merged migration PR not yet in
production, dispatches a preview rehearsal through
`.github/workflows/shared-supabase-migrations.yml`, and that run dispatches the
production apply. Owner rulings: the automatic workflow is the only route to
production; no manual production command; AI reviews are advisory; the owner
(Albert Hazan) is not a programmer and is never asked to act on mechanics.

Vocabulary used below:

- **Parked** — the selector counted `MAX_ATTEMPTS` failed automatic attempts
  (or the refund cap) for a PR and passes over it. In code: an entry in
  `skipped` carrying `exhausted` or `refunds`.
- **Held** — a PR passed over because an open blocking `review-finding` issue
  names it. In code: an entry in `skipped` with a non-empty `findings` list
  and no `exhausted`/`refunds`/`pending_dependencies`.
- **Stranded** — parked, or held longer than 8 hours.
- **Production ledger** — the set of migration versions applied in
  production; `production_ledger()` in the selector, passed around as `live`.
- **Roll-up** — the single open tracking issue titled
  `Automatic promotion: stuck migrations need repair` (currently #6352).

Sessions that author changes are short-lived AI sessions (ZCode, Claude,
Codex, MiMo) that **all share one GitHub login (`u2giants`)**. GitHub mentions
and notification mail cannot reach a particular session, and sessions do not
come back on their own.

### 3. What triggered this work (evidence)

On 2026-11-16/17 nine merged migrations sat undelivered and no owning session
knew. Times EST.

- **PR #6203** burned three attempts 11-13/14, then a later automatic retry
  succeeded (production apply run 43695272013, 11-15 3:36 AM). No session was
  told of the park or the recovery. *Lesson: a park can end by itself, so any
  mark must be cleared automatically.*
- **PR #6245** was permanently unpromotable (evidence produced with a
  different production guard than its merge commit; run 43676605573). A
  successor silently reissued it as PR #6314; #6245 sat unannotated until a
  repair session commented (`pull/6245#issuecomment-6921857284`).
- **PR #6260** had a real defect (duplicate key, SQLSTATE 23505; runs
  43539890705, 43541656623, 43543125049, 43672079740). Its fix PR #6335 sat
  untouched for 36 hours until a repair session finished the chain
  (production apply run 44013113008, 11-16 11:05 PM).
- **2026-11-17 ~7:30 AM live check:** selector verdict
  `ENGINEER ACTION REQUIRED: PR #6263 (3 attempts), PR #6436 (3 attempts)`,
  plus **six PRs held by open review findings**: #6317 by #6324, #6447 by
  #6448, #6433 by #6437, #6444 by #6445, #6454 by #6458, #6529 by #6533. Every
  finding's last comment was the fixer's deferral to `@u2giants` — the shared
  login, reaching no session. #6263 had been parked 82 hours.

So the incident was **2 parked + 6 held**. Draft 1 covered only the parked
two; this plan covers both kinds.

**Root cause:**

1. One shared GitHub login — nothing can notify a specific session.
2. Sessions end without leaving any watch on their own delivery.
   (`ai-blocker-watch wait` is retired and inert by ruling #1183 child 3 — do
   not build on it or revive it.)
3. The lane's only park output is a comment on the roll-up issue, which no
   session is obliged to read, plus run annotations that vanish. The stranded
   PR's own page shows nothing. Held PRs get only a 30-minute run annotation.

### 4. Scope

**IN:**

- Code (selector + trigger workflow permission + tests): mark stranded PRs,
  clear the mark on delivery, make marking failures visible.
- Session rule (rulebook pair + skill sources): check the labels at start and
  before ending; watch your own merged migration.

**OUT:**

- How promotions are dispatched, retried, counted or refunded. (Step 2's
  classifier extraction is a behaviour-preserving refactor, proven by the
  unedited existing tests; any behaviour change is out of scope.)
- Reliability of the hourly schedule.
- Automatic repair of a stranded change (needs judgment).
- How often the roll-up issue is commented (it is commented every selector
  pass today; leave that cadence alone).
- Any migration, any app repo, any change to `ai-blocker-watch`.
- Emailing or messaging the owner on a park (owner rulings 2026-09-28 and
  2026-10-29: never route routine mechanics to a human).

---

## Part 2 — What we already know

### 5. Current state of the code (verified 2026-11-17 at `4483a86cf`)

Anchors are **function names**, not line numbers — the file moves often
(draft 1's line numbers were already stale by ~330 lines). Re-read before
editing.

`scripts/automatic_promotion_candidates.py`:

- `main()` builds `skipped` via `decide(...)`, then
  `exhausted = [e for e in skipped if e.get("exhausted") or e.get("refunds")]`,
  prints one `::error title=ENGINEER ACTION REQUIRED…` per entry, and calls
  `report_stuck_change(repo, exhausted, now)` when `exhausted and not args.dry_run`.
- `report_stuck_change` comments on (or creates) the roll-up issue found by
  `find_stuck_issue`. It never touches the PRs. Any failure is a `::warning`.
- `overdue_holds(skipped, now)` computes held age: from the later of the
  merge and the oldest blocking finding. `ALERT_AFTER` is 30 minutes; it only
  prints annotations.
- `live = production_ledger()` in `main()`; `decide` skips a PR whose
  `versions` are all in `live`. `live` can be empty/None when the read fails.
- **`decide` returns at the first dispatchable PR, and returns `wait`
  immediately while any lane run is in progress.** So on most passes `skipped`
  is *incomplete*. Absence from `skipped` proves nothing, and nothing may
  be marked or cleared from it (R1, R6).
- `main()` prefetches holds for every candidate not already in `live`
  (`prefetch_holds`) before `decide`, then re-decides the pick with fresh
  reads inside the dispatch loop; a pick can be withdrawn there.
- Candidate discovery (`merged_migration_prs`) drops PRs whose versions are
  foreign-target, hard-blocked retired originals, deleted from main, or
  registered orphans — such a PR silently stops being a candidate.
- Every entry has `number`, `versions`, `merged_at`; parked entries add
  `exhausted`, `refunds`; held entries add `findings` (each with `number`,
  `created_at`). When the finding query fails, `findings` is `[]` — unknown,
  not held-by-nothing.

`.github/workflows/automatic-production-trigger.yml`, job `trigger`:

```
permissions:
  contents: write
  actions: write
  issues: write
  pull-requests: read
env:
  GH_TOKEN: ${{ github.token }}
```

**The job token cannot write to pull requests.** Commenting on or labelling a
PR through `/repos/{repo}/issues/{n}/comments` and `/issues/{n}/labels` with
the job token requires `pull-requests: write`; `issues: write` covers plain
issues only (the call is refused with "Resource not accessible by
integration"). This is the author's reading of GitHub's documented
behaviour and is not yet proven in this repository — see R5 and live proof A.

Tests: `scripts/test_automatic_promotion_candidates.py` has the
`report_stuck_change` block (fakes `gh` and `subprocess.run`) and
`test_trigger_job_grants_issues_write`, which reads the workflow text — the
model for the new permission guard. CI: `.github/workflows/promotion-selector-tests.yml`.

Rulebook: `AGENTS.md` "Session wrap-up convention" and its paired chapter
`docs/agents/worktrees-and-handoffs.md` §2.1-H. Rulebook files change
together and are task class `reviewer-safety`, never documents-only.

Skills: the installed copies under each user home (for example
`~/.claude/skills/shared-db-change`, `~/.claude/skills/shared-db-handover`,
`~/.codex/skills/codex-shared-db-change`, `~/.codex/skills/shared-db-handover`;
Windows machines have the same names under the user profile) are **installed
by the dotfiles sync and overwritten by it**. Edit the source in the
ai-devops configuration repository, never the installed copy.

### 6. Key findings

1. GitHub notification cannot address a session (one login).
2. Nothing wakes an ended session except a schedule it left behind or the
   next session looking. So the system needs a durable mark **and** a rule
   that makes sessions look.
3. The mark must live where a query finds it: a label on the PR. A comment on
   a shared issue is not queryable per PR.
4. Parks and holds can end without anyone acting (#6203), so marks must be
   cleared by the same automation, or the label stops meaning anything.
5. A notification path that fails as a warning, behind faked tests, is
   invisible when broken. The permission error in draft 1 would have shipped
   green and never posted.

### 7. Approaches rejected

- **`ai-blocker-watch` waits** — retired and inert (#1183 child 3).
- **Notify the owner** — against owner rulings; he is not on call.
- **Trigger dispatches a repair session** — repair needs judgment.
- **Re-running failed runs** — prohibited by lane rules.
- **Escalating from `skipped`** (revision 2) — `skipped` is only the prefix
  before the first dispatchable PR and is empty on `wait` passes, so a
  stranded PR behind a healthy one would never be marked. Reconcile over all
  candidates instead (R1).
- **"Positively not held = the dispatch pick"** (revision 2) — the pick is
  re-decided twice after `skipped` is built and can be withdrawn; nothing
  records per-PR hold evidence. Clear on a fresh hold read instead (R6).
- **Clearing `promotion-parked` when a pass does not list the PR as parked** —
  attempt, refund and stale classification read run logs and fail safe, so a
  PR can flap between passes and spam comments. Parked clears only on
  delivery or when the lane stops tracking the PR (R6).
- **A repeated `decide()` loop to survey every parked PR** — re-reads the same
  run evidence once per candidate and can classify the same run differently
  across calls. Use one shared, memoised per-PR classifier (R3).
- **Comment first, then label** — a persistent label failure would post a new
  comment every pass. Label first, with marker repair (R4).
- **A weekly audit or report job** — one more output with no reader, which is
  the original defect. The labels are the audit: one query.
- **A separate reconcile workflow** — it would have to rebuild the ledger,
  hold and attempt evidence the selector already has in hand.
- **Failing the trigger run when a notice cannot post** — a red trigger hides
  real lane alerts (#5558).

### 8. Design decisions (locked unless marked OPEN)

Revision 3 (2026-11-17) supersedes revision 2's D1-D8 after a debate with an
independent reviewer (Muse); the record is on issue #6561.

- **R1. One level-triggered reconciler.** `reconcile_stranded_marks(...)`
  runs once per selector pass in `main()`, after the dispatch loop, over
  **all candidates** — never over `skipped`. It compares what should be
  labelled with what is labelled and fixes the difference. It is wrapped in
  its own exception guard and can never change the run's exit code.
- **R2. Two labels on the PR.** `promotion-parked` (out of automatic attempts
  or refunds) and `promotion-held` (held by review findings longer than
  `HELD_ESCALATE_AFTER = 8 hours`, age by the `overdue_holds` rule). Each
  comes with one notice comment carrying a hidden marker
  `<!-- promotion-stranded:<label> -->`. Both labels may sit on one PR.
  Eight hours, not 24: the label is cheap, clears itself, and the only
  earlier signal is a run annotation nobody reads. A hold whose finding read
  failed or returned unknown is UNKNOWN: neither marked nor cleared.
- **R3. Parked status comes from one shared classifier.** Extract the
  per-PR classification inside `decide()` (findings → dependencies →
  attempts/refunds) into a helper that `decide()` itself calls, and have the
  reconciler call the same helper for every candidate. This is a pure
  refactor: every existing `decide()` test must pass unchanged. Evidence
  callables (`applied`, `refused`, `stale`, `refunded`) are memoised by
  `(run id, run attempt)` for the pass. On a `wait` pass (a lane run in
  flight) parked status is not evaluated — no parked label is added or
  cleared — and the log line says so with the run id.
- **R4. Add and repair.** For a PR that should carry a label:
  not labelled and no marker comment → add label, then post the notice; if
  the notice fails, remove the label (outcome `FAILED`). Not labelled but a
  marker comment exists (someone removed the label) → re-add the label only.
  Labelled but no marker comment (killed between the two calls, or labelled
  by hand) → post the notice (outcome `repaired`). Labelled with marker →
  nothing. Two overlapping selector passes can post at most one extra notice
  on a true read race; accepted.
- **R5. Permission.** The trigger job gets `pull-requests: write`
  (`issues: write` stays). That GitHub refuses PR comments and labels to a
  job token holding only `issues: write` is the author's reading of
  GitHub's documented behaviour, **not proven in this repository**; live
  proof A must capture the real response for label add, notice post and
  label removal on a real PR.
- **R6. Clearing, on positive evidence only.**
  (a) Either label: the PR is a candidate and all its versions are in
  `live` → remove, comment "Delivered". Never when `live` is None or empty;
  never on a partial version set.
  (b) `promotion-held`: a **fresh** hold read made by the reconciler itself
  (not the pre-dispatch prefetch) succeeds and is empty → remove, comment
  "No longer held by review findings".
  (c) Either label: the PR is no longer a candidate at all, and candidate
  discovery this pass was complete (`discovery_ok`: no exception, no cache
  fallback) → remove, comment "No longer tracked by the automatic lane
  (versions retired, removed from main, or superseded)". This settles
  revision 2's open question about retired originals.
  `promotion-parked` is never cleared merely because a pass does not
  classify the PR as parked.
- **R7. Failures are durable.** Any `FAILED` outcome — parked or held, add
  or clear — prints `::error title=Stranded-PR notice not delivered::…`,
  is written to `$GITHUB_STEP_SUMMARY`, and is posted to the roll-up issue
  by the reconciler's own write (not through `report_stuck_change`, which
  returns early when nothing is parked). That write is itself non-fatal.
- **R8. Public-safe text.** Notices carry versions, counts, ages, run and
  issue links only; no database URLs, project refs or secrets. They are
  signed as automation, link this plan, and repeat: never re-run a failed
  run; no manual production command; repair by fix-forward or
  retire-and-reissue.
- **R9. The session rule is best-effort.** Phase 1 is the only guarantee.
  Phase 2 puts the label list in front of sessions (at start of structural
  work and before ending) and asks a session that merged a migration to
  leave its delivery check behind (scheduled self-check where the harness
  can, else the exact re-check in its HANDOFF.d file and
  `- [ ] promotion delivered to production` on the landing issue). Nothing
  enforces it and the plan does not pretend otherwise.
- **OPEN (implementer):** label colours; exact notice wording.

---

## Part 3 — How to build it

### 9. Ordered steps

Worktree from fresh `origin/main`. Claim the files on issue #6561 first
(claim-first). Task class for the code PR: `shared-db`; for the rulebook PR:
`reviewer-safety`.

**Phase 1 — code (one PR).**

1. **Permission.** In `automatic-production-trigger.yml` job `trigger`,
   change `pull-requests: read` to
   `pull-requests: write  # stranded-PR notices and labels (#6561)`.
   Add `test_trigger_job_grants_pull_requests_write` beside
   `test_trigger_job_grants_issues_write`.
   *Done when:* the test passes and fails if the line is reverted.

2. **Shared classifier (R3).** Extract the per-PR classification from
   `decide()` into a helper returning one of: delivered, held (with
   findings), unknown-hold, waiting-on-dependency, parked (with attempt and
   refund counts), dispatchable. `decide()` calls it and behaves exactly as
   before. Add a memoising wrapper for the four evidence callables keyed by
   `(run id, run attempt)`.
   *Done when:* the entire existing suite passes with no test edited.

3. **Label plumbing.** Constants `PARKED_LABEL`, `HELD_LABEL`,
   `HELD_ESCALATE_AFTER = timedelta(hours=8)`, and the marker format.
   `ensure_label(repo, name, description) -> bool`: GET the label; 404 →
   create; 422 on create counts as success; anything else → warning, False.
   `labelled_prs(repo, label)`: paginated `issues?labels=…&state=all`,
   keeping **only** items that have a `pull_request` key.
   `has_marker(repo, n, label)`: paginated comment read.

4. **Desired sets.** For every candidate not fully in `live`, using the
   shared classifier: desired-held when held with known findings and hold
   age over `HELD_ESCALATE_AFTER` (share the age computation with
   `overdue_holds`; do not copy it); desired-parked when parked, skipped
   entirely on a `wait` pass. Use the post-dispatch run snapshot when the
   dispatch loop produced one.

5. **Reconcile (R4, R6).** Implement `reconcile_stranded_marks` returning a
   per-PR outcome: `posted`, `repaired`, `relabelled`, `already`,
   `cleared`, `FAILED`, or `unknown`. Thread a `discovery_ok` boolean out of
   candidate discovery; if it cannot be established, rule R6(c) is skipped
   that pass. For R6(b) make one fresh hold read per PR that currently
   carries `promotion-held`. Each PR is handled in its own try/except.
   *Done when:* a second pass with no state change performs zero writes.

6. **Wire in and report (R1, R7).** Call the reconciler from `main()` after
   the dispatch loop, inside a guard that catches everything and prints a
   warning. Under `--dry-run`, print the intended adds and clears and write
   nothing. Add the `— PR notice: <outcome>` suffix to each parked line of
   the existing roll-up comment, and add the reconciler's own roll-up write
   for any `FAILED` outcome (R7). Do not change when `report_stuck_change`
   itself comments.

7. **Gate.** `python -I scripts/test_automatic_promotion_candidates.py` green
   locally; "Promotion selector tests" green on the PR;
   `bash scripts/check-sql.sh` still exits 0. Merge through the queue with
   plain `gh pr merge`.

8. **Live proof A — immediately, not "the next park".** After the merge,
   read the next trigger run's log and step summary, and the PR pages. Every
   PR stranded at that moment (on 11-17: parked #6263 and #6436; held #6317,
   #6447, #6433, #6444, #6454, #6529 where still held) carries its label
   and notice. Record on #6561 the actual success or refusal responses for
   label add and notice post (this is the proof of R5), and for label
   removal as soon as the first clear happens. If nothing is stranded, the
   proof is a clean reconciler log line and STATUS step 6 stays open.
   **Any `FAILED` outcome means Phase 1 is not done.** Never run the write
   path locally against the real repository.

**Phase 2 — session rule (context cut point; re-read §5 and R9 first).**

9. **Rulebook pair, one PR, class `reviewer-safety`.**
   - `AGENTS.md` "Session wrap-up convention": one short paragraph — before
     ending, a shared-db session lists PRs labelled `promotion-parked` or
     `promotion-held`, reports any it merged or can repair, and leaves the
     delivery check for its own merged migration as R9 describes.
   - `docs/agents/worktrees-and-handoffs.md` §2.1-H: the same rule in long
     form with the two list queries and a link to this plan.
   - Section numbers do not change.
   *Done when:* documents checks pass on the PR head and it is merged.

10. **Skill sources, in the ai-devops configuration repository** (search it
    for the skill directory names in §5; never edit installed copies). The
    shared-db-change skill and its Codex variant: list the two labels at
    start; the R9 delivery check after merging a migration PR. The
    shared-db-handover skill: the pre-end list and the delivered checkbox.
    Land by that repository's rules, then run the dotfiles sync here.
    *Done when:* installed copies on this machine show the steps and the
    variants carry the same wording.

11. **Live proof B.** When a labelled PR is delivered, confirm the label was
    removed and "Delivered" posted with no session doing it. Link on #6561.

### 10. Tests required

All in `scripts/test_automatic_promotion_candidates.py`, faking `gh` as the
existing block does.

| Hostile or boundary case | Test name |
|---|---|
| Workflow loses PR write permission | `test_trigger_job_grants_pull_requests_write` |
| Classifier refactor changes nothing | the whole existing suite, unedited |
| Parked PR gets label + notice once | `test_parked_pr_is_marked_once` |
| Held PR **behind a dispatchable PR** is still marked | `test_held_pr_behind_dispatch_pick_is_marked` |
| Parked PR behind a dispatchable PR is still marked | `test_parked_pr_behind_dispatch_pick_is_marked` |
| `wait` pass: held reconciled, parked untouched | `test_wait_pass_reconciles_holds_only` |
| Held 9h marked; 7h not; unknown read neither marked nor cleared | `test_held_threshold_and_unknown_read` |
| `overdue_holds` (30 min) and the 8h rule deliberately differ | `test_alert_and_escalation_thresholds_differ` |
| Labelled + marker → zero writes | `test_marked_pr_is_left_alone` |
| Labelled, no marker → notice posted (`repaired`) | `test_label_without_notice_is_repaired` |
| Marker, label removed by hand → label re-added, no new notice | `test_removed_label_is_restored_without_duplicate_notice` |
| Notice POST fails → label removed, `FAILED`, next PR still handled | `test_failed_notice_rolls_back_label_and_continues` |
| 403 "Resource not accessible by integration" on label add, notice post and label removal → `FAILED` + `::error`, no exception, exit code unchanged | `test_permission_refusal_is_loud_not_fatal` |
| Held-only `FAILED` still reaches roll-up and step summary | `test_held_only_failure_is_recorded_durably` |
| Roll-up write failure is non-fatal | `test_rollup_failure_does_not_fail_run` |
| Label missing → created once; 422 race tolerated | `test_missing_label_is_created_and_race_tolerated` |
| Delivered → cleared with comment | `test_delivered_pr_is_cleared` |
| `live` None and `live` empty both clear nothing | `test_no_clearing_without_a_ledger_read` |
| Only some versions live → not cleared | `test_partial_delivery_is_not_cleared` |
| Held cleared only on a fresh empty read; stale prefetch alone does not clear | `test_held_cleared_only_on_fresh_read` |
| Withdrawn dispatch does not clear `promotion-held` | `test_withdrawn_dispatch_clears_nothing` |
| Parked not cleared when a pass classifies it otherwise | `test_parked_label_does_not_flap` |
| Non-candidate labelled PR cleared only when `discovery_ok` | `test_untracked_pr_cleared_only_on_complete_discovery` |
| Label listing ignores plain issues; listing and comment reads paginate | `test_label_listing_is_prs_only_and_paginated` |
| Reconciler exception never changes exit code | `test_reconciler_crash_is_contained` |
| Notice bodies carry no database URL or project ref | `test_notice_bodies_are_public_safe` |
| `--dry-run` issues no POST, PATCH or DELETE | `test_dry_run_issues_no_writes` |

`check-sql.sh` stays green.

### 11. Constraints and gotchas

- Queue only: plain `gh pr merge`; never `--admin`; re-arm after a
  promotion-freeze ejection. No migrations here, so no re-stamp concerns.
- Never push to `main`; one worktree per write task.
- Nothing in comments or committed text may contain secrets or project refs.
- The selector's local test file is fast; a full trigger dry-run pages the
  API for minutes — do not gate local work on it.
- Do not rely on the hourly cron for verification; GitHub skips schedules.
  A push or nudge trigger also runs the selector.
- All human-facing times are quoted in EST from the system clock.
- Sign anything posted to GitHub with `$AI_GH_SIGNATURE`.

### 12. Access

- Repository `popcre/shared-db`, `gh` authenticated as the shared login; the
  trigger job's own token performs the writes in production.
- No secret is needed to build or test. Optional read-only ledger check for
  live proof: 1Password vault `vibe_coding`, item "Supabase CLI Personal
  Access Token" (location only).

### 13. Definition of done and risks

**Done when:** Phase 1 merged and live proof A linked on #6561 with no
`FAILED` notice; Phase 2 rulebook PR merged and skill sources landed and
synced; live proof B linked; the STATUS table is all ✅ with artifacts; the
HANDOFF.d registration is retired by its own session or its successor.

**Risks:**

- *Label without notice* after a kill between the two calls — repaired on
  the next pass by the marker check (R4).
- *One duplicate notice* when two selector passes race — accepted (R4).
- *Parked label outlives a recovery in progress* — it stays until delivery
  by design, to avoid flapping (R6); the notice text says attempts may have
  resumed.
- *Classifier refactor alters dispatch* — guarded by the unedited existing
  suite (step 2).
- *Sessions ignore the rule* — the labels and roll-up do not depend on
  obedience; the skill step puts the list in front of every structural
  session.
- *Wider token permission* — `pull-requests: write` on a job that already
  holds `contents: write` and `actions: write` adds no meaningful reach.

**Open questions:** label colours and wording (§8).

---

*Registered in `HANDOFF.d/20261117T124800Z-edge-dev-zcode-promotion-stranding-watch-plan.md`.*
