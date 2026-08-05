# HANDOFF — coordinator session handover (2026-08-05T18:27Z, hetz/coordinator)

> **Read this if you are the next coordinator for `u2giants/shared-db`.**
> It is written for someone who walked in off the street this morning and knows
> nothing about this repository, this session, or what has already been tried.
> It is long on purpose. A short handover costs the next session a whole day.

---

## 1. What this application is

`u2giants/shared-db` is the **single source of truth for the shared Supabase
database** (project ref `qsllyeztdwjgirsysgai`) used by several of Albert
Hazan's applications: PopDAM (`popdam3`), PopCRM (`popcrm-web`), PopPIM
(`poppim-web`), DesignFlow (`dflow`), a monitor, a DB Data Admin tool, and
various reports and spreadsheets.

The rule that makes this repo matter: **every schema change lives here first.**
Any column, table, view, function, trigger, row-level-security policy, seed, or
cross-application data contract is authored in this repo — on a branch, through
a pull request, tested against the preview database first — **before** any
application repository is touched. Application repositories are forbidden from
carrying their own migrations (no Sequelize startup `ALTER`, no inline
`CREATE`). Nobody runs `ALTER` / `CREATE` / `DROP` by hand against the shared
database. If an application's own documentation still teaches an inline
migration pattern, that documentation is stale and this repo wins.

The repo is not just SQL. It also holds:

- `supabase/migrations/` — the numbered migration files (399 of them right now).
- `AGENTS.md` — the router document and the home of **standing owner rulings**.
  Read it first in any session.
- `HANDOFF.md` — a static pointer plus the **BACKLOG** list (items `B1`…`B14`).
- `HANDOFF.d/` — one write-once handover file per session. This file is one of
  those. You never edit someone else's; you add your own.
- `COORDINATOR_INTAKE.md` — the work queue. It is how sessions hand work to each
  other. Explained in section 7.
- `scripts/` — guard scripts that run in CI, including the production migration
  guard and the backlog/queue sync checker.
- `.claude/worktrees/` — one isolated git worktree per agent session.

**The coordinator role.** A coordinator session does not normally write
migrations itself. It reads the queue, decides what should happen, dispatches
sub-agents to do the work in their own worktrees, reviews what they produce,
and hands the state forward. This session was a coordinator session.

---

## 2. What we set out to do this session, and why

The session began as a **session-start hygiene sweep**: confirm what is actually
true in the repository right now, compare it against the briefing the session
was started with, and then decide what work to dispatch.

It ended without dispatching any implementation work, for a good reason: **the
briefing turned out to be about 41 hours stale, and nine pull requests had
landed inside that window from sessions outside this coordinator's control.**
Acting on the briefing's numbers would have meant re-doing work that was already
merged. So the session's entire output became this handover plus a set of new
queue entries.

**This session dispatched no implementation work, wrote no migration, made no
database call, and deleted nothing.** That is a complete and accurate statement
of what it did.

---

## 3. Current state — what is true right now

Everything in this section was **measured**, not inherited. Each fact carries the
time it was checked. Facts age fast in this repository — see section 9.

### 3.1 The ground truth, measured 2026-08-05 18:18–18:27 UTC

| Fact | Measured value | How it was measured |
|---|---|---|
| `origin/main` tip | `e5afaf0049413bbf6560a5918a881d1c10d0e882` | `git rev-parse origin/main` after `git fetch --all` |
| Migration files on `origin/main` | **399** | `git ls-tree -r --name-only origin/main supabase/migrations/` |
| Highest migration version | **`20260804120100`** | same listing, sorted |
| Duplicate migration versions | **0** | version prefixes counted for collisions |
| Open pull requests | **ZERO** | `gh pr list --state open` |
| Worktrees under `.claude/worktrees/` | **16** pre-existing (17 including this handover's own) | directory listing |
| Branch protection on `main` | **ENABLED** | `gh api repos/u2giants/shared-db/branches/main/protection` |
| Open issues | **1** (issue #444) | `gh issue list --state open` |

Note the migration count is measured **against `origin/main`**, not against a
working tree. Working trees in this repo are frequently dirty or parked on old
branches, so counting files on disk gives a wrong answer.

### 3.2 Coordination state — half (a)

- **Live workstreams: NONE.** Nothing is in flight.
- **File ownership: nobody owns anything.**
  - `supabase/migrations/` — **NONE**
  - `HANDOFF.md` — **NONE**
  - `AGENTS.md` — **NONE**
  - No write locks are held by any session.
- **Open pull requests: ZERO.** Nothing is waiting to be reviewed or merged.
- **PR #441** is **MERGED**, at 2026-08-04T00:15:42Z, merge commit
  `2243032b00dfb03b80be95a0afd5e2947f2b0e42`. **No merge is owed to anyone.**
- **The preview database `rjyboqwcdzcocqgmsyel` was NOT inspected this session.**
  This session was forbidden from making database calls, and it made none.
  **The next coordinator must NOT assume the preview is clean.** Its state is
  genuinely unknown. Check it before using it for a rehearsal.

### 3.3 Per-sub-agent blocks — half (b)

**NONE. Zero sub-agents were dispatched.**

This is a **factual zero, not an omission**. There is no missing section here and
nothing was left out. One read-only `Explore` agent was used, which read
`HANDOFF.md` and `COORDINATOR_INTAKE.md` and nothing else. It **wrote nothing
and owns nothing.** No worktree, branch, file, or lock traces back to it.

### 3.4 Branch protection — the measured configuration

Albert's ask #1 was "turn on branch protection for `main`". **That ask is
largely already satisfied.** Protection is **ENABLED**. The briefing this
session started from claimed "there is **NO** branch protection on `main`."
**That claim is now FALSE.** The guards are real gates, not advisory.

Measured configuration:

| Setting | Value |
|---|---|
| `enforce_admins` | **true** (admins cannot bypass) |
| `allow_force_pushes` | **false** |
| `allow_deletions` | **false** |
| Required status checks | **six**, listed below |
| `required_status_checks.strict` | **false** ← gap 1 |
| `required_pull_request_reviews` | **null / absent** ← gap 2 |
| `required_signatures` | false |
| `required_linear_history` | false |
| `required_conversation_resolution` | false |

The six required checks are: **Promotion sync (offline)**, **Backlog / queue
sync**, **Cross-PR object collision**, **Tools offline tests**, **SQL guards**,
and **Domain ownership**.

Corroborating record: `COORDINATOR_INTAKE.md` line 137 already records
**ANSWERED 2026-08-04 12:00 UTC — DONE by Albert Hazan**, written up as a
standing ruling in `AGENTS.md` §6.7. That entry also explains a subtlety worth
keeping: originally only **one** check could be required, because three separate
workflows (`backlog-queue-sync`, `pr-object-collision`, `tools-offline-tests`)
all exposed a status check with the same name, `verify`. An agent named
`ci-check-names` made the names unique, which is what allowed all six to be
required.

**The two remaining gaps, and why they matter:**

1. **`strict: false`.** This allows a pull request to be merged even when its
   base is out of date with `main`. In most repositories that is a minor risk.
   **Here it is a real one**, because migrations use `CREATE OR REPLACE`, which
   is last-writer-wins. Two pull requests that each replace the same function,
   both merged from a stale base, silently lose one of the two changes. Nothing
   errors. You find out later.
2. **`required_pull_request_reviews` is absent.** No human or agent review is
   forced before merge.

### 3.5 The 16 worktrees, and why there used to be 52

The briefing described **52** worktrees. There are now **16**.

**This session deleted nothing.** Not one worktree, branch, file, or queue
block. The drop is fully explained: **nine pull requests (#441–#450) merged on
2026-08-04**, from sessions outside this coordinator's control, and those
sessions' worktrees were retired at that time.

All 11 branches still checked out across the 16 worktrees are **merged into
`origin/main` and are `ahead=0`**. None of them is carrying unmerged commits.

**Albert's standing instruction, which remains in force: do NOT sweep worktrees
or branches.** A previous sweep deleted a live agent's workspace. That incident
is backlog item **B11**. Leaving a stale worktree costs disk space; deleting a
live one costs a session's work. Never trade the second for the first.

### 3.6 The one dirty worktree

`/worksp/shared-db/.claude/worktrees/coordinator-handoff-intake-7e55cb` holds
**two untracked files** and nothing else:

- `.ai/reviews/glm-pr448-coldlion-unblock-guard-20260804T141125Z.md` (5,502 bytes)
- `.ai/reviews/glm-pr449-phase6-baseline-breaker-20260804T141306Z.md` (7,411 bytes)

Both were written 2026-08-04 (10:11 and 10:13 local), and they sit alongside 15
already-tracked review files dated 2026-08-03. They are GLM code reviews of
pull requests #448 and #449, which have both since merged.

**The decision someone needs to make:** commit them as review evidence
(consistent with the 15 tracked ones next to them), or discard them as
disposable scratch. Either is defensible. Nobody has decided.

**Until that decision is made, this worktree must NOT be removed.**
Uncommitted work inside a worktree is the only copy of that work. There is no
backup and no reflog entry for an untracked file.

---

## 4. Everything we tried that did NOT work

This section is mandatory and it is the part future sessions actually need.
Read it before you repeat any of it.

1. **`git fetch --all --prune=false` — INVALID on this machine's git.**
   The `shared-db-orchestrator` skill prescribes exactly this command as
   session-start step 1. This version of git rejects `--prune=false`. The
   failure is quiet in practice: the session-start fetch simply does not happen,
   and the session then reasons about a stale `origin/main` without knowing it.
   **Use `git fetch --all`.** The skill itself needs fixing, at
   `/home/ai/.claude/skills/shared-db-orchestrator/SKILL.md`. That is queue
   entry #8 below; this session did not fix it, because the skill file is
   outside the two files this session was permitted to write.

2. **Trusting the first `gh api .../protection` output — produced a false
   "drift" alarm.** The first call's output came back reformatted by a context
   compression layer: the worktree list was flattened onto one line and the
   required check names came back shortened ("Backlog sync", "SQL guards",
   "Cross-PR collision"). None matched the briefing's names, and it looked like
   the protection config had changed underneath us. It had not. Re-running with
   narrow `--jq` selectors
   (`.required_status_checks.checks[].context`, `.required_status_checks.contexts[]`)
   returned the full, correct names, identical to the briefing.
   **The lesson, which cost real time: when tool output looks reformatted,
   flattened, or truncated, re-query narrowly before recording a discrepancy.
   The mangling is in the display layer, not in the data.** This is not a
   hypothetical; it nearly went into this handover as a finding.

3. **Looking for pull request #444 — it does not exist, and now we know why.**
   `gh pr view 444` returns `Could not resolve to a PullRequest with the number
   of 444`. This is not a deleted or hidden pull request. **Number 444 was
   consumed by an ISSUE**, not a pull request: issue #444, "ColdLion taxonomy
   alert — 18 undelivered (breaker: tripped)", created 2026-08-04T01:10:15Z.
   GitHub draws issues and pull requests from one shared number sequence.
   **The "nine PRs" are #441, #442, #443, #445, #446, #447, #448, #449, #450.**
   Do not go hunting for #444.

4. **Reading the working tree to count migrations — gives a wrong answer.**
   Worktrees here are routinely dirty or parked on old branches. Migrations must
   be counted against the branch:
   `git ls-tree -r --name-only origin/main supabase/migrations/`.

5. **Assuming the backlog/queue CI guard actually proves what it claims.**
   It does not. See section 5.1. The guard reports green while the condition it
   describes is false for three items.

6. **Assuming PR #448's title told the whole story.** The briefing said decision
   #4 "appears done" based on the pull request title alone. That was not good
   enough to rely on, and this session read the merged diff instead. The title
   was accurate — but the check also surfaced a materially different fact about
   the ColdLion migration count that the title concealed. See section 5.4.

---

## 5. Root causes and key findings

### 5.1 A real defect in the backlog/queue CI guard

**File:** `scripts/check-backlog-queue-sync.mjs` (333 lines). It is one of the
six required status checks, exposed as **"Backlog / queue sync"**.

**What it is supposed to do:** make sure every backlog item `B1`…`B14` in
`HANDOFF.md` has a corresponding request entry in one of the tracked sections of
`COORDINATOR_INTAKE.md`.

**What it actually does:** it extracts a whole section's body — every line from a
`## ` heading to the next `## ` heading — and then searches that entire body for
the bare pattern `\bB(\d{1,3})\b`. Any loose mention of `B8` anywhere in the
section's prose satisfies the requirement for backlog item B8. It never checks
that a real `### REQUEST — Backlog B8` heading exists.

The relevant lines:

```js
const B_REFERENCE = /\bB(\d{1,3})\b(?!\s*\.\s*\d)/g
...
for (const match of text.matchAll(B_REFERENCE)) found.add(Number(match[1]))
```

**This is not a theory — it is currently firing.** The `## REQUEST QUEUE`
preamble contains this sentence:

> `(rehearsal → #362, manifest → #360, EX/LB/JL framing → #369, B8 → #358, B13 → done, B14 → #367)`

and as a direct result the guard prints:

```
OK      B8 — found in `## REQUEST QUEUE`
OK      B13 — found in `## REQUEST QUEUE`
OK      B14 — found in `## REQUEST QUEUE`
```

**All three of those statements are false.** B8, B13, and B14 have no entry in
`## REQUEST QUEUE` at all. Their real entries are in `## COMPLETED`. The guard
is passing them on a passing mention in a parenthetical.

The practical damage: a genuinely missing backlog entry can be masked by any
sentence that happens to mention its number. Because this is a **required**
check, it now carries authority it has not earned.

**The fix direction** (not implemented this session): match on the actual
heading form the guard's own error message already prescribes —
`### REQUEST — Backlog B<n>` — rather than on a bare number anywhere in the
body. The guard already prints that exact template at line 271, so the intended
shape is not in doubt. Keep the existing `no-queue-entry-needed:` opt-out marker
working.

### 5.2 Backlog/queue coverage — the question is answered, and a previous verdict is corrected

A previous session's verdict was that some backlog items needed queue entries
seeded. **That verdict was wrong.** Measured coverage:

- **In `## REQUEST QUEUE`:** B1, B2, B3, B4, B5, B6, B7, B9, B10, B11, B12 —
  eleven real `### REQUEST — Backlog B<n>` entries.
- **In `## COMPLETED`:** B8, B13, B14 — three real entries, correctly filed as
  finished work.
  - **B8** → shipped as PR #358.
  - **B13** → shipped as `.github/workflows/backlog-queue-sync.yml` plus
    `scripts/check-backlog-queue-sync.mjs`.
  - **B14** → shipped as PR #367.

**Coverage is complete. Seed no `B<n>` items.** Every backlog item is accounted
for, and the three in `## COMPLETED` are correctly placed, not misfiled.

**Do not "clean up" the B6 and B7 entries** even though both are annotated
SATISFIED. Both blocks carry an explicit in-file warning — *"DO NOT DELETE THIS
BLOCK: the `Backlog / Queue Sync` CI guard requires every `B<n>` in
`HANDOFF.md`'s BACKLOG to remain referenced from a queue section"* — at lines
1392 and 1419. Removing them turns the required check red.

Also note: the caveat inside the B6 block still says *"the guard is ADVISORY
only, because `main` has NO branch protection."* **That caveat is now out of
date** — see section 3.4. The guard is a gate.

### 5.3 The unlocated "92-row question" — FOUND, and it needs no further work

The briefing flagged an unlocated question about "92 rows" and warned against
inventing its content. **It has been located.** The lead pointed at PR #447 /
branch `docs/style-guide-rows-stay-whole-20260804`, and the answer is recorded
in `fix_characters_style_guides.md` at **line 495**.

What it says, in plain terms: the free-text names column in the round-2 style
guide workbook is dead. The resolver `tools/resolve-character-identity.mjs`
never consumed it. Rows where the reviewer simply echoed the row label back into
that column need no further work and **must not be re-asked**. Measured on the
returned round-2 workbook: **126 `REAL CHARACTERS` rows, 13 echoing the row
label exactly, 109 echoing it under a loose match.**

> *"A '92 echoed rows' figure quoted in session notes does not reproduce from
> the file under either definition; the count is moot now, since none are
> re-asked."*

**Conclusion: the 92 figure is not reproducible and does not matter.** Nobody
needs to chase it. This closes the question rather than carrying it forward.

Related and already settled: on **2026-08-04** Albert ruled **rows stay whole** —
*"When a style guide row lists characters together, leave it as one row."* A
combination row is **never** split into component characters. That reduced round
3 from 154 rows to **8**.

### 5.4 The ColdLion "six versus four" discrepancy — RESOLVED

`COORDINATOR_INTAKE.md` line 170 carries a loud warning: *"the count is SIX, not
four … the documentation said four; PR #407 found SIX `HARD_BLOCKED` entries …
Confirm the real scope before acting — a promotion list built from the old count
ships a partial fix."*

Meanwhile PR #448 is titled *"unblock the **four** ColdLion migrations."* That
looks like exactly the partial fix the warning predicted.

**It is not.** Reading the merged guard on `origin/main`
(`scripts/production_migration_guard.py`) resolves it cleanly:

**Six total `HARD_BLOCKED` versions = four unblocked + two permanently blocked.**

Unblocked 2026-08-04 under `AGENTS.md` §6.8, as `BUNDLE_20260804`:

- `20260726030000` — ColdLion phase 4, the approved 542-link machinery
- `20260726031000` — phase 4 empty-input guard correction
- `20260726032000` — phase 4 REVOKE of browser-role EXECUTE
- `20260726180000` — ColdLion phase 6 parallel-run (creates
  `plm.taxonomy_sync_alert` and `plm.taxonomy_parallel_observation`, which
  `20260727221500` and `20260728134500` need to exist or they fail 42P01)

Still blocked, **permanently, and deliberately** — the source calls them "a
different animal":

- `20260726190000` — the Master Data lockdown that restricted editing
  `public.style_tracker_rows` to admins. **This was WRONG**: it locked all 33
  plain `user` accounts out of the Styles grid, which is open **BY DESIGN**
  (`AGENTS.md` §0.4). It was applied to production and then reversed. **Never
  re-apply it.**
- `20260726200000` — the reversal of the above. Already applied to production,
  so listing it is inert; it is kept so the pair stays legible together.

These two are listed **to stop anyone from re-running a known mistake**. Do not
"tidy" them out of the set.

**The important caveat, quoted from the guard's own comments** — it was written
specifically so nobody launders an assumption into a fact:

> *"PROVENANCE OF 'already applied', stated so nobody launders it into a fact I
> checked. The agent that unblocked the four (2026-08-04) was forbidden to read
> production and did NOT verify it itself."*

That claim rests on two independent production-ledger reads recorded
2026-08-02, in `docs/production-migration-lane-design-20260802.md` §3.2 and
`docs/hard-blocked-migrations-dossier-20260802.md` §7.
**Re-verify against the live production ledger before any promotion.** If either
version turns out NOT to be applied, the count in `AGENTS.md` §6.8 changes and
the whole set must be revisited before anything is promoted.

**One more property of the guard, and it is enforced in code, not just
documented:** `parse_allowlist` requires the allowlist to contain **all four**
of the bundle or **none** of them. `AGENTS.md` §6.8 forbids unblocking them "one
at a time, a few at a time, or just the safe ones — no subset is allowed."
A partial set hands a half-composable batch into a forward-only lane and leaves
production **partially promoted with no undo.**

### 5.5 Decision #4 is done, and this session verified the diff

Decision #4 was: the ColdLion unblock must be bundled with a **negative test**
and a **whole-batch pre-flight**, never shipped alone.

**Verified by reading the merged diff**, not the title. PR #448 merged
2026-08-04T14:22:49Z, merge commit
`8c6f62ed85521368dd705c7f793fb14cd99ee723`, touching exactly two files:

- `scripts/production_migration_guard.py`
- `scripts/test_production_migration_guard.py`

The diff contains a real `preflight_batch(...)` function, a `preflight`
sub-command wired into the CLI, and a test class literally named
`PreflightNegativeTests` with cases asserting the pre-flight **fails before any
worktree is created**. The whole-batch pre-flight is documented in the source as
satisfying `AGENTS.md` §6.8 requirement 2.

The source is admirably honest about its own limits, and you should carry this
forward rather than over-trusting the check: it states that the pre-flight is a
whole-**batch** check and **must not be read as approval**; the authoritative
gate remains the rehearsal of the whole batch against a real database.

**Decision #4 needs no further work.**

### 5.6 The ColdLion alert monitor — the situation has materially changed

The queue entry at line 1561 asks Albert to *"stop the ColdLion alert monitor,
then build dedupe, then close 25 duplicate issues"*, in that order.

**Measured today, that request is largely overtaken by events:**

- **44 issues were closed on 2026-08-04.** The duplicate pile is gone.
- **Exactly one issue is open:** #444, *"ColdLion taxonomy alert — 18
  undelivered (breaker: tripped)"*, created 2026-08-04T01:10:15Z and **not
  updated since**.
- The title says **the circuit breaker tripped**. The monitor stopped emitting
  **on its own**, rather than being deliberately stopped.

So the "close 25 duplicates" step is done, and the "stop the monitor" step
happened by accident rather than by decision. **What is left is different from
what the queue entry asks for**, and someone should re-scope it:

1. Dedupe was never proven to be built. If the breaker is ever reset without
   dedupe in place, the flood returns.
2. **18 alerts are undelivered and unhandled.** Nobody has looked at what they
   say. That is real signal sitting in a stopped pipe.
3. The breaker's trip condition and reset procedure are not documented anywhere
   this session could find.

### 5.7 The shared checkout is broken again

`/worksp/shared-db` — the shared checkout, not a worktree — is parked on branch
`docs/clickup-handoff` at commit `cac0c3e`, **9 commits behind `main`**.

This exact condition was raised as queue entry **#7** and marked **SATISFIED**
on 2026-08-03 at 23:57 UTC. **It has re-broken within about 43 hours.** The root
cause was never established the first time, only the symptom fixed.

Because it recurred, fixing the symptom again is not enough. **Find out what
parks it.** The likely candidate is a session that clones or checks out in the
shared directory instead of creating a worktree, but that is a hypothesis this
session did not test. Never work directly in `/worksp/shared-db`.

### 5.8 The nine pull requests that landed outside coordinator control

All merged 2026-08-04, all from sessions this coordinator did not dispatch and
did not review:

**#441, #442, #443, #445, #446, #447, #448, #449, #450.** (There is no #444 —
see section 4, item 3.)

**The next coordinator must read these nine diffs BEFORE re-doing any backlog
work.** This is the single highest-value thing to do first. This session's whole
reason for existing is that a 41-hour-old briefing nearly caused duplicate work;
reading the diffs is how you avoid repeating that. Of specific note:

- **PR #446** must be read before any re-planning of the `age_group` migration.
- **PR #447** carries the style-guide "rows stay whole" ruling (section 5.3).
- **PR #448** is the ColdLion guard bundle (sections 5.4, 5.5).
- **PR #449** is the phase 6 baseline breaker.

### 5.9 The falsified ground truth — what 41 hours did to the briefing

| # | Fact | Briefed 2026-08-04 00:08 UTC | Measured 2026-08-05 18:18 UTC | Verdict |
|---|---|---|---|---|
| 1 | `origin/main` tip | `9265986…` | `e5afaf0049413bbf6560a5918a881d1c10d0e882` | **CHANGED** |
| 2 | Migration files | 397 | **399** | **CHANGED** |
| 3 | Max migration version | `20260803201000` | **`20260804120100`** | **CHANGED** |
| 4 | Duplicate versions | 0 | **0** | Holds |
| 5 | Open pull requests | 0 | **0** | Holds |
| 6 | Worktrees | 52 | **16** | **CHANGED** (nine PRs merged; nothing swept) |
| 7 | Branch protection | "there is NO branch protection" | **ENABLED**, six required checks | **FALSE — reversed** |
| 8 | Decision #4 | "appears done, unverified" | **Done, diff verified** | **CONFIRMED** |
| 9 | ColdLion blocked count | "four appear done" | **6 total = 4 unblocked + 2 permanent** | **REFINED** |
| 10 | Alert monitor | "close 25 duplicates" | 44 closed; 1 open; breaker tripped | **OVERTAKEN** |

**The lesson, in one line: the briefing was about 41 hours old and nine pull
requests landed inside that window. Re-verify before acting. Never inherit a
number.**

---

## 6. Exact next steps

In priority order. Numbers 1 and 2 correspond to queue entries added by this
session.

1. **Read the diffs of PRs #442–#450** before touching any backlog item.
   Nine merged changes are not yet reflected in anyone's mental model.
   (Queue entry #5.)
2. **Close the two branch-protection gaps.** Set
   `required_status_checks.strict: true`. Leave required reviews off.
   (Queue entry #1, recommendation in section 8.)
3. **Fix `scripts/check-backlog-queue-sync.mjs`** so it matches the real
   `### REQUEST — Backlog B<n>` heading instead of a bare number anywhere in a
   section body. Verify afterwards that B8, B13, and B14 are reported against
   `## COMPLETED`, not `## REQUEST QUEUE`. (Queue entry #2.)
4. **Un-park `/worksp/shared-db` and find the root cause.** Symptom-only fixes
   have already failed once. (Queue entry #3.)
5. **Dispose of the two untracked GLM review files** in
   `coordinator-handoff-intake-7e55cb` — commit as evidence or discard, then the
   worktree is safe to retire. (Queue entry #4.)
6. **Check 1Password vault `vibe_coding`** for read-only Cloud SQL credentials
   for the Cloud SQL → Supabase workstream. **Serialize all 1Password reads —
   never fan them out in parallel** — and search **vault `vibe_coding` only**.
   (Queue entry #7. This is Albert's ask #3 and is NOT STARTED.)
7. **Fix the `shared-db-orchestrator` skill's invalid fetch command** at
   `/home/ai/.claude/skills/shared-db-orchestrator/SKILL.md`. (Queue entry #8.)
8. **Re-scope the ColdLion alert monitor request** given section 5.6, and
   surface the 18 undelivered alerts.

**Albert's top priority, in his own words, which outranks all housekeeping:**

> *"I REALLY want to move Licensors and Properties over. the current setup has
> so many problems and bandaids all over it."*

The `age_group` migration is the **low-risk rehearsal** for that move. **Read PR
#446 before re-planning it.**

---

## 7. Constraints and gotchas in force

### 7.1 Settled owner rulings — DO NOT RE-LITIGATE

Six standing rulings live in `AGENTS.md`: **§4.2, §6.3, §6.4, §6.4-C, §6.5,
§6.6.** Read them; do not reopen them; do not ask Albert about them again.

Three more were added on **2026-08-04** and are equally settled:

- **§6.7** — branch protection is ON. Done by Albert 2026-08-04 12:00 UTC.
- **§6.8** — the ColdLion unblock rules: all four of the bundle or none;
  bundled with the negative test and whole-batch pre-flight.
- **§6.9** — the 33 unmatched ColdLion property codes: **DECLINED AS ASKED**,
  and it is now a **standing DO-NOT**. They must **not** be admitted until the
  status-blind resolver is fixed **first** — *"fix the attachment logic first,
  then admit the codes"* — in that order, in **one reviewed change**, never the
  admission alone. When they are admitted they go in as **`potential`**, not
  `inactive`. The combined resolver-fix-plus-admission is a **new** request; do
  not reopen the old block.

Also settled and easy to trip over:

- **`AGENTS.md` §0.4 — Master Data open writes are INTENTIONAL. Never restrict
  them.** This is exactly what migration `20260726190000` got wrong: it locked
  33 plain `user` accounts out of the Styles grid. That migration is
  permanently blocked because of it.
- **Six licensor-alias rulings are settled in PR #352.** Do not re-ask them.
- **Two applied migrations carry stale comments. Do not edit them.**

### 7.2 The `COORDINATOR_INTAKE.md` protocol

The file has parts: **Part 0** (how requesters file work, including the request
template you must copy verbatim), **Part A** (handover), **Part B**
(ingestion), and **Part B2** (lifecycle, retention, hygiene). Work moves through
sections: `## REQUEST QUEUE` → `## IN PROGRESS` → `## COMPLETED` or
`## TAKEN OVER`, with `## WAITING ON OTHER PEOPLE` for externally blocked items.

Rules that will bite you:

- **Never move a `B<n>` backlog entry out of `## REQUEST QUEUE`**, even when it
  is annotated SATISFIED. The 2026-08-03 refresh note requires every `B<n>`
  entry to stay there for the CI guard. This is why B6 and B7 look like stale
  completed work but must not be filed away.
- **Do not touch** the block marked *"DO NOT DELETE THIS BLOCK — CI guard needs
  it"* (lines 1392 and 1419).
- **Do not action or delete** the block titled *"INTAKE — EXAMPLE TEMPLATE BLOCK
  (not real work — do not action, do not delete)"*. It is documentation shaped
  like a request. It is at roughly line 2756.
- **Never duplicate detail into the queue.** A queue entry states the outcome
  needed and points at the document holding the detail. Detail in two places
  goes out of sync.

### 7.3 Session hygiene rules

- **Never work in `/worksp/shared-db`.** Always create a worktree under
  `/worksp/shared-db/.claude/worktrees/`.
- **Never merge on the way out.** A departing session leaves its pull request
  **OPEN** for the next session to review. This handover's own pull request
  follows that rule.
- **Never sweep worktrees or branches.** See section 3.5 and backlog B11.
- **A dirty worktree is never removed.** Uncommitted work is the only copy.
- **Commit identity must be `Albert Hazan
  <u2giants@users.noreply.github.com>`.** Run `git var GIT_COMMITTER_IDENT`
  **before** your first commit. Git does not fail when identity is unset — it
  silently invents one from the OS account. That mistake has already put 231
  wrong-identity commits into merged history in other repositories, which cannot
  be corrected without force-pushing shared history.
- **Use `git fetch --all`.** Not `--prune=false`; see section 4, item 1.
- **Never write a credential value into any file, document, or commit.**

---

## 8. Access and environment

- **Repository:** `u2giants/shared-db`. Default branch `main`, protected.
- **Shared Supabase project:** `qsllyeztdwjgirsysgai` (production).
- **Preview database:** `rjyboqwcdzcocqgmsyel`. **State unknown — not inspected
  this session.**
- **Applying changes:** the Supabase MCP connection is **read-only**. Changes go
  in through the GitHub workflow or the Management API query endpoint. **The
  preview ledger is unreliable** — do not treat it as authoritative.
- **Secrets:** 1Password, **vault `vibe_coding` only**. **Serialize all reads —
  never fan out `op read`, `op run`, or 1Password MCP calls in parallel.** Fetch
  a shared environment once and reuse it. Vault and item IDs can be re-keyed
  mid-session by an MCP reconnect, so look items up by title plus vault rather
  than reusing a cached ID.
- **This session's worktree:**
  `/worksp/shared-db/.claude/worktrees/u2giants-shared-db-coordinator-d1b0c6`,
  branch `claude/u2giants-shared-db-coordinator-d1b0c6`.
- **This handover's worktree:**
  `/worksp/shared-db/.claude/worktrees/handover-20260805`, branch
  `docs/coordinator-handover-20260805`.
- **Machine:** `hetz`.

---

## 9. Open questions and risks

### 9.1 Open decisions for Albert — one recommendation each, no menus

1. **Branch protection: turn on `strict: true`?**
   **Recommendation: yes, turn it on. Leave required reviews off.**
   `strict: true` forces a pull request to be up to date with `main` before it
   can merge. In this repository that prevents a real and silent failure:
   migrations use `CREATE OR REPLACE`, which is last-writer-wins, so two changes
   to the same function merged from stale bases lose one of the two with no
   error. Required **reviews** are a different matter — with agents doing most of
   the work, forcing a reviewer adds a blocking human step without adding much
   safety, so leave that off.

2. **The ColdLion alert monitor.**
   **Recommendation: re-scope the request before acting on it.** The original
   ask (stop → dedupe → close 25) is largely overtaken: 44 issues were closed
   2026-08-04, one remains, and the breaker tripped on its own. What genuinely
   remains is to build dedupe **before** anyone resets the breaker, and to read
   the **18 undelivered alerts**. **Re-check the live issue list before acting**
   — this area moved a lot in 24 hours and may move again.

3. **The 33 unmatched property codes.**
   **Recommendation: nothing to decide. Already ruled.** `AGENTS.md` §6.9,
   answered 2026-08-04 12:00 UTC: **DECLINED AS ASKED**, standing DO-NOT. Fix
   the resolver first, then admit the codes, in one reviewed change, as
   `potential`. Do not reopen the old block; file the combined change as a new
   request.

4. **The ColdLion migrations.**
   **Recommendation: treat the unblock as done, but re-verify before promoting.**
   Four are unblocked and two are permanently blocked by design (section 5.4).
   The guard's own comments say the "already applied" status of the two
   permanent ones was **not** verified against live production — it rests on two
   document reads from 2026-08-02. **Re-verify against the live production
   ledger before any promotion.** If either turns out not to be applied, the
   count in `AGENTS.md` §6.8 changes and the set must be revisited.

### 9.2 Blocked on Albert — the three ⛔ queue entries still standing

- **#32** — stop the ColdLion alert monitor, then build dedupe, then close the
  duplicate issues. *(See section 5.6 — needs re-scoping first.)*
- **#33** — is the property `Coco` correctly filed under a licensor named
  **"NO LICENSE"**?
- **#34** — the five remaining ColdLion property-code contract questions, marked
  **READY TO ASK**.

Two other ⛔ entries have since been answered and should not be re-asked:
branch protection (line 139, done) and the 33 property codes (line 200,
declined as asked).

### 9.3 Waiting on other people

1. **ai-devops PR #1** — not merged by its owner.
2. **Laura's round-2 xlsx reply** — outstanding.
3. **The ColdLion Step 8 production decision** — marked **⛔ NOT YET ASKABLE**.
   It cannot be put to Albert until the questions ahead of it are answered.

### 9.4 Facts that may already be stale by the time you read this

Treat every one of these as needing re-measurement, not as inherited truth. This
is the same mistake that made this session necessary.

- `origin/main` tip, the migration count, and the maximum migration version.
  These changed three times in 41 hours.
- The open pull request count. Zero right now; other sessions open PRs without
  telling this one.
- The worktree count and which worktrees are dirty.
- The branch protection configuration, if anyone acts on decision 1.
- The open issue list — this moved by 44 issues in a single day.
- The state of `/worksp/shared-db` — it re-broke once in 43 hours and may
  re-break again.
- **The preview database `rjyboqwcdzcocqgmsyel`. It was never inspected. Assume
  nothing about it.**

### 9.5 Known risks

- **The backlog/queue guard is a required check that reports false passes**
  (section 5.1). Until it is fixed, its green does not mean what it says.
- **`strict: false` permits stale-base merges** into a repository where
  `CREATE OR REPLACE` silently loses changes.
- **Two untracked files exist in exactly one place** (section 3.6). Any sweep
  destroys them permanently.
- **The `shared-db-orchestrator` skill's session-start fetch does not run**
  (section 4, item 1), so any session following the skill literally begins on a
  stale view of `origin/main` without being told.
