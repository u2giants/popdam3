---
summary: Stop merged shared-db migrations from stranding unpromoted and unnoticed — the promotion selector marks every parked or long-held PR on the PR itself (comment + label, cleared on delivery), and sessions check those labels at start and before ending.
kind: implementation-plan
status: ready-for-implementation (revision 2, 2026-11-17)
read-when: implementing or reviewing the stranded-PR escalation in the automatic promotion trigger or the promotion-watch session rule; when a merged migration sits unpromoted and nobody knows.
---

# Plan: promotion-stranding watch (revision 2)

Implementation issue: popcre/shared-db#6561. Revision 2 replaces the first
draft (landed by PR #6560) after the review on that issue
(`issues/6561#issuecomment-6949048674`). What changed and why is in §8.

## STATUS

| Step | Status | Evidence / next action |
|---|---|---|
| 0. Plan landed | ✅ | PR #6560 (draft 1); revision 2 by the PR that carries this text |
| 1. Permission: trigger job `pull-requests: write` + guard test | ⬜ open | §9 step 1 |
| 2. Escalation code: parked + held-over-24h, comment + label | ⬜ open | §9 steps 2-4 |
| 3. Clearing on delivery | ⬜ open | §9 step 5 |
| 4. Roll-up shows per-PR notice outcome; loud annotation on failure | ⬜ open | §9 step 6 |
| 5. Tests | ⬜ open | §10 |
| 6. Live proof A (immediate): today's stranded PRs carry notice + label | ⬜ open | §9 step 8 — do not wait for a future park |
| 7. Session rule: rulebook pair | ⬜ open | §9 step 9 |
| 8. Session rule: skill sources | ⬜ open | §9 step 10 |
| 9. Live proof B: a labelled PR is cleared automatically on delivery | ⬜ open | §9 step 11 |

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
2. A defined reader looks: every shared-db session checks the labels when it
   starts structural work and before it ends, and a session that merged a
   migration does not end without a watch on its own delivery.
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
- **Stranded** — parked, or held longer than 24 hours.
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
two; revision 2 covers both kinds.

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

- How promotions are dispatched, retried, counted or refunded.
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
  is *incomplete*. Absence from `skipped` proves nothing. (This is why
  clearing in §9 step 5 is driven by positive evidence only.)
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
integration"). Draft 1 assumed no new permission was needed; that was wrong.

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
- **Clear a label when the PR is absent from this pass's `skipped`** —
  unsafe; `skipped` is incomplete on `wait` and `dispatch` passes (§5).
- **Idempotency by searching all PR comments for a marker** (draft 1) — needs
  pagination and still cannot tell a new episode from an old one. The label
  is the state; see D2.
- **Failing the trigger run when a notice cannot post** — a red trigger hides
  real lane alerts (#5558). Use a loud annotation plus the roll-up instead.

### 8. Design decisions (locked unless marked OPEN)

Revision 2 supersedes draft 1's L2026-11-17.1-.6.

- **D1.** Stranded PRs are marked on the PR: one comment + one label.
  Labels: `promotion-parked` (out of attempts) and `promotion-held` (held by
  review findings over 24 hours). The roll-up issue stays as the aggregate.
- **D2.** **The label is the episode state.** Escalate only when the label is
  absent. Order per PR: add label → post comment → if the comment fails,
  remove the label again so the next pass retries. No comment search.
- **D3.** Held PRs are in scope now (was OPEN in draft 1): draft 1's own
  adoption test — "a held PR demonstrably strands unowned" — was already met
  by six PRs in §3. Threshold constant `HELD_ESCALATE_AFTER = 24 hours`, age
  computed exactly as `overdue_holds` does. A held entry with unknown
  findings (`findings == []`) is **not** escalated — that is a failed read.
- **D4.** Labels are cleared only on positive evidence:
  `promotion-parked` and `promotion-held` when all the PR's versions are in
  `live`; additionally `promotion-held` when this pass positively evaluated
  the PR as not held (it is the dispatch pick, or it is in the parked list —
  in which case it gets `promotion-parked` instead). Never on absence. Skip
  all clearing when `live` is empty.
- **D5.** The trigger job gets `pull-requests: write`. This reverses draft
  1's "no new permissions". Guarded by a test like the existing
  `issues: write` guard.
- **D6.** Marking I/O never fails the run. But every PR whose notice could
  not be posted prints `::error title=Stranded-PR notice not delivered::…`
  (an annotation; it does not change the exit code) and is listed as
  `notice: FAILED` in the roll-up comment.
- **D7.** Comment text is public-surface safe: versions, counts, ages, run
  and issue links only. No database URLs, project refs, or secrets. It is
  signed as automation and points to this plan. It repeats the standing
  rules: never re-run a failed run; no manual production command; repair by
  fix-forward or retire-and-reissue.
- **D8.** The session rule has two halves: **look** (list labelled PRs when
  starting structural work and before ending) and **watch your own** (a
  session that merged a migration PR ends only with delivery proven, or a
  scheduled bounded self-check where the harness can schedule, or the exact
  re-check recorded in its HANDOFF.d file; the landing issue carries
  `- [ ] promotion delivered to production`, ticked only from a production
  ledger read).
- **OPEN (implementer):** label colours; exact comment wording.
- **OPEN (verify in step 5):** how the selector stops listing a
  retired-and-reissued original (see the "preserved retired original"
  comment in the selector). If such a PR never reaches `live`, its label
  stays; record what you find in STATUS and leave manual removal to the
  repair session that retires it — do not invent a retire detector here.

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
   `test_trigger_job_grants_issues_write`, same technique.
   *Done when:* the new test passes and fails if the line is reverted.

2. **Label plumbing.** Near `STUCK_ISSUE_TITLE` add
   `PARKED_LABEL = "promotion-parked"`, `HELD_LABEL = "promotion-held"`,
   `HELD_ESCALATE_AFTER = timedelta(hours=24)`. Add
   `ensure_label(repo, name, description) -> bool`: GET
   `/repos/{repo}/labels/{name}`; on 404 POST `/repos/{repo}/labels`; a 422
   on create (another run made it first) counts as success; any other
   failure → `::warning`, return False. Follow the file's existing `gh`
   helper and subprocess style.
   *Done when:* unit tests for exists / 404-then-create / 422 / failure pass.

3. **Stranded sets.** Add `stranded_holds(skipped, now)` returning held
   entries older than `HELD_ESCALATE_AFTER`, reusing the age rule in
   `overdue_holds` (refactor the shared age computation into one helper
   rather than copying it). Exclude entries with `exhausted`, `refunds`,
   `pending_dependencies`, or empty `findings`.
   *Done when:* a 23h hold is excluded, a 25h hold included, an
   unknown-findings entry excluded.

4. **Escalate.** Add `escalate_stranded(repo, parked, held, now) -> dict[int, str]`
   returning per-PR outcome: `posted`, `already`, or `FAILED`. For each PR
   and its label (D2):
   - Read the PR's labels (`/repos/{repo}/issues/{n}/labels`). Label present
     → `already`.
   - Else `ensure_label`, POST the label, then POST the comment. Parked body:
     heading `## Parked: automatic promotion out of attempts`, versions,
     attempt and refund counts, hours since merge, "NOT in production".
     Held body: heading `## Held over 24 hours by review findings`, versions,
     the finding issue numbers as links, hours held, "NOT in production".
     Both: the D7 rules and a link to this plan.
   - Comment POST fails → DELETE the label, outcome `FAILED`.
   - Any exception for one PR is caught for that PR only: `FAILED`, print the
     D6 `::error` annotation, continue with the next PR.
   *Done when:* a second pass with no state change makes zero POSTs.

5. **Clear.** Add `clear_delivered(repo, candidates, live, positively_not_held)`.
   If `live` is empty, return. List issues with each label
   (`/repos/{repo}/issues?labels=<label>&state=all&per_page=100`, all pages).
   For each labelled PR found in `candidates` whose versions are all in
   `live`: DELETE the label and post one short comment
   `Delivered: all versions are in the production ledger; label removed.`
   For `promotion-held` also clear when the PR number is in
   `positively_not_held` (D4), comment `No longer held by review findings.`
   A labelled PR not in `candidates` is left alone. Failures → `::warning`.
   Resolve the OPEN item about retired originals here and record it.
   *Done when:* tests in §10 for clearing pass, including "empty `live`
   clears nothing" and "absent from `skipped` clears nothing".

6. **Wire into `main()` and the roll-up.** When not `args.dry_run`:
   call `clear_delivered` every pass; compute `held = stranded_holds(skipped, now)`;
   call `escalate_stranded(repo, exhausted, held, now)` when either list is
   non-empty; pass the outcomes into `report_stuck_change` so each parked
   line ends with `— PR notice: posted|already|FAILED`. Do not change when
   the roll-up is commented (still only when `exhausted` is non-empty).
   Under `--dry-run`, print what would be escalated and cleared and write
   nothing.
   *Done when:* the whole suite is green and a `--dry-run` makes no writes
   (assert in a test that no POST/DELETE is issued).

7. **Gate.** `python -I scripts/test_automatic_promotion_candidates.py` green
   locally; "Promotion selector tests" green on the PR;
   `bash scripts/check-sql.sh` still exits 0 (no migrations added). Merge
   through the queue with plain `gh pr merge`.

8. **Live proof A — immediately, not "the next park".** After the merge,
   read the next trigger run's log and the PR pages. Expected, if the 11-17
   state still holds: #6263 and #6436 carry `promotion-parked` and the
   notice; the six held PRs in §3 that are still held carry `promotion-held`
   and the notice. If the stranded set has changed, prove on whatever is
   stranded then. If nothing at all is stranded, the proof is a trigger run
   log showing the clear pass ran with no error, and step 6 of STATUS stays
   open until the next real stranding. **If any notice shows `FAILED` or the
   `Stranded-PR notice not delivered` annotation appears, Phase 1 is not
   done** — read the refusal text and fix it. Link the evidence on #6561.
   Never run the selector's write path locally against the real repository.

**Phase 2 — session rule (context cut point; a fresh session re-reads §5 and
§8 D8 first).**

9. **Rulebook pair, one PR, class `reviewer-safety`.**
   - `AGENTS.md` "Session wrap-up convention": add one short paragraph —
     before ending, a shared-db session lists PRs labelled `promotion-parked`
     or `promotion-held`; it reports any it merged or can repair, and never
     ends silently with its own merged migration undelivered: delivery
     proven from the production ledger, or a scheduled bounded self-check
     (where the harness can schedule) that stops on delivery, or the exact
     re-check recorded in its HANDOFF.d file. Landing issues carry
     `- [ ] promotion delivered to production`.
   - `docs/agents/worktrees-and-handoffs.md` §2.1-H: the same rule in long
     form, with the two list queries spelled out and a link to this plan.
   - Section numbers do not change.
   *Done when:* documents checks pass on the PR head and it is merged.

10. **Skill sources, in the ai-devops configuration repository** (find them
    by searching that repository for the skill directory names in §5; do not
    edit installed copies). Add to the shared-db-change skill (and its Codex
    variant): at start, list the two labels and say what is stranded; after
    merging a migration PR, the D8 "watch your own" step. Add to the
    shared-db-handover skill: the pre-end list and the delivered checkbox.
    Land in that repository by its own rules, then run the dotfiles sync on
    this machine.
    *Done when:* the installed copies on this machine show the new steps and
    each variant carries the same wording (diff them).

11. **Live proof B.** When any labelled PR is delivered, confirm the label
    was removed and the "Delivered" comment posted without a human or
    session doing it. Link it on #6561 and tick the last checklist item.

### 10. Tests required

All in `scripts/test_automatic_promotion_candidates.py`, faking `gh` as the
existing block does.

| Hostile or boundary case | Test name |
|---|---|
| Workflow loses PR write permission | `test_trigger_job_grants_pull_requests_write` |
| Each parked PR gets label + comment once | `test_parked_pr_is_escalated_once` |
| Label already present → no POST | `test_escalation_skips_when_label_present` |
| Held 25h escalated; 23h not; unknown findings not | `test_held_pr_escalates_only_after_24h_with_known_findings` |
| Comment POST fails → label removed, outcome FAILED, next PR still done | `test_failed_notice_rolls_back_label_and_continues` |
| 403 "Resource not accessible by integration" on label POST → FAILED + `::error` annotation, no exception | `test_permission_refusal_is_loud_not_fatal` |
| Label missing → created once; 422 race tolerated | `test_missing_label_is_created_and_race_tolerated` |
| Delivered PR → label removed + comment | `test_delivered_pr_label_is_cleared` |
| Empty `live` → nothing cleared | `test_no_clearing_without_a_ledger_read` |
| PR absent from `skipped` but not delivered → not cleared | `test_absence_from_skipped_never_clears` |
| Held label cleared when PR becomes the dispatch pick | `test_held_label_cleared_when_positively_not_held` |
| More than 100 labelled PRs | `test_label_listing_is_paginated` |
| Roll-up line shows notice outcome | `test_rollup_reports_notice_outcome_per_pr` |
| Comment bodies carry no database URL or project ref | `test_notice_bodies_are_public_safe` |
| `--dry-run` writes nothing | `test_dry_run_issues_no_writes` |

The existing suite and `check-sql.sh` stay green.

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

- *Notice spam* if label add succeeds and the roll-back delete fails after a
  comment failure — bounded: the label then stays, so no repeat; the roll-up
  shows `FAILED` once.
- *Stale label* on a retired-and-reissued original — see the OPEN item in §8;
  removed by the repair session that retires it.
- *Sessions ignore the rule* — the labels and roll-up do not depend on
  obedience; the skill step puts the list in front of every structural
  session.
- *Wider token permission* — `pull-requests: write` on a job that already
  holds `contents: write` and `actions: write` adds no meaningful reach.

**Open questions:** label colours and wording; retired-original handling
(both in §8).

---

*Registered in `HANDOFF.d/20261117T124800Z-edge-dev-zcode-promotion-stranding-watch-plan.md`.*
