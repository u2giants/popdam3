---
summary: Two upgrades that stop merged shared-db migrations from stranding unpromoted — a mandatory pre-end promotion watch for authoring sessions, and automatic per-PR escalation when the promotion queue parks a change.
kind: implementation-plan
status: draft-for-implementation
read-when: implementing or reviewing the promotion-watch wrap-up rule or the parked-PR escalation in the automatic promotion trigger; when a merged migration sits unpromoted and nobody knows.
---

# Plan: promotion-stranding watch (2 upgrades)

## STATUS

| Step | Status | Evidence / next action |
|---|---|---|
| 1. Land this plan + HANDOFF.d registration | ⬜ open | this file is the artifact; not yet committed |
| 2. Upgrade B code: per-PR escalation in `report_stuck_change` | ⬜ open | `scripts/automatic_promotion_candidates.py:816-862` today only updates the shared tracking issue |
| 3. Upgrade B tests | ⬜ open | `scripts/test_automatic_promotion_candidates.py:1197-1294` (existing `report_stuck_change` tests) |
| 4. Upgrade A rulebook pair (AGENTS.md wrap-up + docs/agents chapter) | ⬜ open | `AGENTS.md` "Session wrap-up convention"; `docs/agents/worktrees-and-handoffs.md` §2.1-H |
| 5. Upgrade A skill copies (pre-end watch step) | ⬜ open | `C:\Users\ahazan\.agents\skills\codex-shared-db-change\SKILL.md` + `C:\Users\ahazan\.zcode\skills\codex-shared-db-change\SKILL.md` (step 5 of its procedure) |
| 6. Landing-issue checklist line (promotion delivered) | ⬜ open | folds into step 4's rule text |
| 7. Live proof on a real future park | ⬜ open | must stay open until a real parked PR receives the escalation comment + label |

A fresh session starts at §9 Phase 1 after re-deriving current state (§5). Nothing here is implemented yet.

---

## Part 1 — Why

### 1. The ultimate goal

**A merged database change must never sit undelivered to production with nobody
who knows and nobody who will act.** When a session merges a migration PR in
`popcre/shared-db` and the automatic promotion lane later parks it (three failed
attempts) or holds it (review finding), two things must be true that are false
today:

1. Someone — the authoring session while it still exists, or a scheduled
   check it left behind — learns the promotion stalled and acts.
2. The stranded PR itself carries its stranded state loudly (comment + label),
   so any coordinator session, owner, or successor triages it without
   archaeology on a shared tracking issue.

If a step in this plan conflicts with that goal, the goal wins — stop and flag
it. The goal does NOT include making promotions succeed (the lane already
handles that), only that stalls become known and owned.

### 2. What this system is

`popcre/shared-db` is the shape-of-database source of truth for the one shared
Supabase project behind all POP Creations apps (CRM, DAM, PM/PIM, DesignFlow
PLM). Migrations merge to `main` through a GitHub merge queue; an **automatic
production promotion lane** then delivers each merged migration to the preview
branch for rehearsal and on to production: the workflow
`.github/workflows/automatic-production-trigger.yml` (hourly cron + push/nudge
triggers) runs `scripts/automatic_promotion_candidates.py`, which picks the
oldest merged migration PR not yet in production, dispatches the rehearsal via
`.github/workflows/shared-supabase-migrations.yml`, and that run's promotion job
dispatches the production apply. Owner rulings: no session or person starts
production promotion by hand; the automatic workflow is the only route; AI
reviews are advisory and never gate merges; the human owner (Albert Hazan) is
not a programmer and never runs steps himself.

Sessions authoring changes are ephemeral AI CLI sessions (ZCode, Claude, MiMo,
etc.) that **all share one GitHub identity (`u2giants`)**. There is no per-session
GitHub account, so GitHub @mentions and notification emails cannot reach a
specific session. Sessions live minutes-to-hours and do not come back on their
own.

### 3. What triggered this work (the incident history, with evidence)

On 2026-11-16 the owner tasked a repair session with the queue's "ENGINEER
ACTION REQUIRED" report naming three merged-but-undelivered migrations. The
investigation found a delivery problem wrapped inside a **notification** problem.
Full timeline, all times EST derived from GitHub UTC headers:

**The delivery repairs (all resolved, evidence recorded):**

- **PR #6203 / version 20261112225250** — burned its three automatic attempts
  11-13/11-14, then a later automatic retry succeeded on its own
  (production apply run 43695272013, 11-15 3:36 AM). No session was ever told
  of the park or the recovery; the only record was the automation's comment on
  shared tracking issue #6352.
- **PR #6245 / version 20261113145056** — permanently unpromotable producer
  provenance: its original preview evidence (run 43498082051, dispatched at
  `eccd0c13`) was produced with a different `scripts/production_migration_guard.py`
  than its merge commit `b51e474e`, so qualification refused
  (run 43676605573); its do-block body is high-risk so the ephemeral route
  cannot substitute. A successor session had silently reissued it as
  20261115031325 (PR #6314) — in production — but PR #6245 itself sat
  unannotated until the repair session posted the evidence comment
  (11-16, `pull/6245#issuecomment-6921857284`).
- **PR #6260 / version 20261113223432** — real migration defect: the edge
  insert collided on `property_character_source_edge_current_claim_key`
  (SQLSTATE 23505; preview runs 43539890705, 43541656623, 43543125049,
  43672079740); the owning MiMo session's fix PR **#6335 was opened 11-15
  3:41 AM and then sat untouched for 36 hours** — nobody woke it. The repair
  session finished the chain: landed #6335 (re-stamped twice for backdate tip
  races), resolved review finding #6496 (three findings) via PR #6542, and
  delivered as 20261202120000 — production apply run 44013113008, 11-16
  11:05 PM, evidence comment `pull/6260#issuecomment-6937947095`.

**The verification that nobody knows (2026-11-17 ~7:30 AM EST, live checks):**

- The promotion trigger had gone silent: last trigger 04:54 UTC, and the hourly
  cron (`automatic-production-trigger.yml` line 34-35, `'23 * * * *'`) never
  fired through 12:15 UTC — GitHub skips schedules under load (known pattern).
  A manual wake (run 44081893674) restored evaluation.
- The selector's verdict: `idle: ENGINEER ACTION REQUIRED: PR #6263 (3 attempts),
  PR #6436 (3 attempts) out of automatic attempts`, plus six PRs held by open
  review findings: #6317 by #6324; #6447 by #6448; #6433 by #6437; #6444 by
  #6445; #6454 by #6458; #6529 by #6533.
- **Do the owning sessions know? No.** Verified live: every one of the six
  findings' last comment is the review-fixer's deferral ("deferred to
  @u2giants…") dated 11-15/11-16 — and @u2giants is the shared login, so the
  mention reaches no session. PR #6263 had been parked **82 hours** (per the
  automation's own #6352 comment) with zero owning-session response. Nine
  stranded promotions, zero notified owners.

**Root cause, precisely:**

1. Sessions share one GitHub identity — GitHub's notification model cannot
   address a session (`docs/agents/owner-rulings.md`; memory
   `shared-db-repo-moved-to-popcre`).
2. Sessions end without leaving any wake on their own promotion outcome. The
   tool that exists for dependency wake-ups, `ai-blocker-watch`, has its `wait`
   registration **retired and inert** ("legacy records only… New work leaves
   the issue/PR as the card" — `C:/repos/ai-devops/bin/ai-blocker-watch`
   header, ruling #1183 child 3), so it cannot be the mechanism either.
3. The lane's only park output is a comment on ONE shared tracking issue
   (#6352, `report_stuck_change`, `scripts/automatic_promotion_candidates.py:794,816-862`)
   that no session is obligated to read, plus a log annotation that vanishes
   with the run. The parked PR itself stays clean-looking.
4. The hourly selector can itself sleep for hours (schedule skipping), so even
   the shared-issue comment ages quietly.

**Proof the cures are feasible (all already exercised in this environment):**
ZCode sessions can schedule bounded self-check automations that act and stop
themselves (queue-watch automation 2026-11-13; the repair session's 30-minute
delivery check 2026-11-16; memory `zcode-single-automation-per-session`: one
per session, a successor session may create its own). The trigger job already
holds `issues: write` for stuck reporting
(`automatic-production-trigger.yml` line 53, added for #5771), so per-PR
escalation comments and labels need no new permissions. The review-fixer
workflow already posts machine-signed comments on findings, establishing the
"automation comments on the card" pattern this plan extends.

### 4. Scope — in and out

**IN:**
- Upgrade A (process/rulebook): a mandatory pre-end "promotion watch" step for
  any session that merges a migration PR — rulebook pair + skill copies text.
- Upgrade B (code): `report_stuck_change` gains one-time per-PR escalation
  (comment + `promotion-parked` label), fail-open as warnings, with tests.

**NOT in this plan (out of scope):**
- Changing how promotions are dispatched, retried, or counted (`MAX_ATTEMPTS`,
  refunds, freezes — the lane's own machinery, recently hardened by #5532/#5937).
- Making the promotion trigger's schedule more reliable (schedule skipping is
  a GitHub platform behavior; the lane already self-heals on pushes/nudges).
- Auto-repair of parked migrations (repair needs judgment; escalation is this
  plan's ceiling — a follow-up coordinator session or owner decides the repair).
- Extending escalation to review-finding HELD PRs (Phase 2 open decision, §8).
- Any DesignFlow/app-repo change, any database schema change (this plan ships
  zero migrations), any change to `ai-blocker-watch` itself (retired mechanism,
  do not revive).

---

## Part 2 — What we already know

### 5. Current state of the code

- `scripts/automatic_promotion_candidates.py` (on `origin/main` at planning
  time, merge `856d8d26db`-era):
  - `STUCK_ISSUE_TITLE = "Automatic promotion: stuck migrations need repair"`
    at line 794.
  - `report_stuck_change(repo, entries, now)` at lines 816-862: builds one
    markdown block listing each exhausted PR (`PR #N (versions …): failed N
    automatic attempts… merged Xh ago and not live`), then either comments on
    the found open tracking issue or creates it. **It never touches the parked
    PRs themselves.** Failures downgrade to a `::warning` (never fail the run).
  - `main()` calls it at lines 716-717 with the `exhausted` entries.
  - Escalation-relevant context already in each entry: `number`, `versions`,
    `exhausted` count, `refunds`, `merged_at`.
  - `overdue_holds()` (lines 581-595) already computes held-PR age for
    annotations — reuse its age math if Phase 2 is taken.
- `.github/workflows/automatic-production-trigger.yml`: job `trigger` has
  `issues: write` (line 53). Comment + label calls from the selector inherit it.
- Tests: `scripts/test_automatic_promotion_candidates.py` — `report_stuck_change`
  tests at lines ~1197-1294 already fake `gh`, subprocess runners and the
  tracking issue; extend the same fakes for PR comment/label calls.
  CI wiring: `.github/workflows/promotion-selector-tests.yml`.
- Rulebook: `AGENTS.md` "Session wrap-up convention" (unnumbered section,
  kept in the router file itself) and `docs/agents/worktrees-and-handoffs.md`
  (§2.1-H handoff convention). Repo rule: rulebook files are NOT
  "documents-only" changes — AGENTS.md and the matching `docs/agents/`
  chapter must change **together** (AGENTS.md "Task-to-file navigation").
- Skill copies (outside the repo, user-level, both must be edited identically):
  `C:\Users\ahazan\.agents\skills\codex-shared-db-change\SKILL.md` and
  `C:\Users\ahazan\.zcode\skills\codex-shared-db-change\SKILL.md` — procedure
  step 5 ends at "Merge the shared-db PR yourself… Merging syncs the
  shared-db/ folder… it does NOT apply to the DB". The watch step goes right
  there. (If a repo-canonical skill copy exists under `skills/` at implement
  time, it wins; verify with `ls skills/` — none known at planning time.)
- Nothing of this plan exists anywhere yet; worktree
  `C:\Users\ahazan\.zcode\worktrees\898e\shared-db` is clean on a fresh
  `origin/main`.

### 6. Key findings and root cause (investigation results)

1. **Sessions cannot be addressed by GitHub notifications** — one shared login
   (`u2giants`); all mention-classes of "notify the owner" are dead ends
   (verified 2026-11-17: every held finding ends in a `@u2giants` deferral that
   nobody read).
2. **`ai-blocker-watch wait` is retired/inert** (#1183 child 3): registering
   waits is no longer required and wakes nothing; the issue/PR is the card.
   Any design built on wait-registration is building on a removed mechanism.
3. **What DOES wake a session's work:** a self-scheduled bounded automation
   created before the session ends (proven three times; see §3 evidence), or
   the owner pasting a successor prompt. The automation route is the only one
   that needs no human.
4. **The park signal is structurally quiet:** one comment on shared issue
   #6352 + a run annotation (lines cited §5); the parked PR page shows
   nothing. 82-hour stale parks observed.
5. **The lane is otherwise healthy** — last-witnessed parks recovered through
   it once repaired (6263-chain: production apply 44013113008); idles are
   passed-over-by-design states, not hangs (selector idle line quoted §3).

### 7. Approaches considered and REJECTED

- **Register `ai-blocker-watch` waits on merged PRs** — rejected: mechanism is
  retired and inert (finding #2); would add dead ritual, and reviving it
  contradicts ruling #1183 child 3 ("never trusted sessions to record" — the
  system's direction is automation-carried, not session-carried).
- **Email/chat webhook to the owner on every park** — rejected: owner ruling
  2026-09-28/2026-10-29: never ask a human to approve or act on routine
  mechanics; Albert is not an on-call operator. Escalation must land on cards
  AI sessions read.
- **Auto-dispatch a repair session from the trigger** — rejected for this plan:
  repair requires judgment (defect classification, re-stamp racing, evidence
  rules) the trigger must not own; also the trigger is the thing that measured
  the exhaustion. Escalate, don't repair. (A future plan may add a coordinator
  dispatch; out of scope per §4.)
- **Re-running failed promotion runs to "unstick"** — prohibited by lane rules
  and the tasking convention ("never re-run a failed run; the queue dispatches
  fresh runs"); not a notification mechanism anyway.
- **Browsing-based detection (scraping PR pages)** — rejected: selector works
  through the API with bounded retries; add no scraping.

### 8. Design decisions already made (locked unless flagged OPEN)

- **L2026-11-17.1 (locked):** Upgrade B escalates ON the parked PR: one
  markdown comment + apply label `promotion-parked`. Rationale: the PR is the
  card (ruling #1183 c3); #6352 stays as the aggregate roll-up only.
- **L2026-11-17.2 (locked):** Escalation is **idempotent per park episode** —
  skip if a prior escalation comment by the automation exists on that PR
  (marker string in the comment body). Re-escalate only after the PR later
  leaves and re-enters the exhausted list (new episodes have a later
  `merged_at`-independent trigger: absence of the label OR a
  later-dated failure set; implementer picks the simplest correct test).
- **L2026-11-17.3 (locked):** Escalation failures are **warnings, never run
  failures** — identical posture to the existing tracking-issue warning path
  (§5), because a red trigger hides real alerts (queue-hygiene idiom, #5558).
- **L2026-11-17.4 (locked):** The escalation comment is **machine-signed** the
  way existing automation comments are, states the failure classification
  inputs (run links), the cure pointer (this plan's sibling memory
  `shared-db-promotion-lane-repair-mechanics` and the repair pattern of
  2026-11-16), and "never re-run failed runs; repair via fix-forward".
  No database instructions in the comment (comments are public surface).
- **L2026-11-17.5 (locked):** Upgrade A's watch = a **bounded self-check
  automation scheduled before session end** (ZCode-family sessions) with a
  written stop condition, PLUS a `- [ ] promotion delivered to production`
  checklist item on the landing issue (mirrors the live-proof rule), PLUS the
  exact re-check command recorded in the session's HANDOFF.d if it cannot
  schedule. Non-ZCode harnesses: HANDOFF.d + issue checklist item only.
- **L2026-11-17.6 (locked):** No new workflow permissions, no new workflows.
  Everything rides the existing trigger job (`issues: write` already present).
- **OPEN (implementer judgment):** Label color; exact marker wording.
- **OPEN (Phase 2, decide after Phase 1 lands):** extend the same one-time
  escalation to review-finding-HELD PRs older than 24h (data available via
  `overdue_holds`; held PRs already have finding issues as cards, so the gain
  is smaller). Default: do not, until a held PR demonstrably strands unowned.

---

## Part 9 will reference: Part 3 — How to build it

### 9. The plan — ordered steps

**Phase 1 — Upgrade B: per-PR escalation (code, lands first so the net exists
before the rulebook asks sessions to rely on the pattern).**

Worktree from fresh `origin/main`; task class already `shared-db` (redeclare if
a new session: `ai-task-gates start --class shared-db`).

1. **Create label plumbing** in `scripts/automatic_promotion_candidates.py`:
   - Add `PARKED_LABEL = "promotion-parked"` near `STUCK_ISSUE_TITLE` (line ~794).
   - Add a helper `ensure_parked_label(repo)` — `gh api` GET
     `/repos/{repo}/labels/promotion-parked`; on 404, POST
     `/repos/{repo}/labels` `{"name":"promotion-parked","color":"b60205","description":"Automatic promotion exhausted its attempts; repair needed"}`.
     Any failure → return False + `::warning` (never raise).
   - *Done when:* helper returns True on an existing label; creates on 404;
     warns-not-raises on API failure (unit-tested with faked `gh`).
2. **Escalation comment + label application** — extend `report_stuck_change`
   (lines 816-862) after the tracking-issue update, per exhausted entry:
   - Read the PR's existing comments (`gh api /repos/{repo}/issues/{n}/comments?per_page=100`);
     if any comment body contains the marker
     `<!-- promotion-parked-escalation -->`, skip (idempotency, L.2).
   - Else POST one comment to `/repos/{repo}/issues/{n}/comments` with body:
     marker HTML comment, `## Parked: automatic promotion exhausted`, the
     entry's facts (`versions`, attempts, refunds, `merged_at` age in hours),
     "This PR's migrations are NOT in production", the classification pointer
     ("classify each failed run via `gh run view <id> --log-failed`; transient
     → fresh dispatch per the lane's forms; defect/unpromotable → fix-forward
     or retire-and-reissue; see memory
     `shared-db-promotion-lane-repair-mechanics` and PR #6260's chain for the
     worked pattern"), and the standing rules (never re-run a failed run;
     never manual production commands; plain `gh pr merge` queue).
   - Apply the label: POST `/repos/{repo}/issues/{n}/labels`
     `["promotion-parked"]` (after `ensure_parked_label` succeeded).
   - Each PR's failures are independent: catch per-PR, `::warning` and
     continue (L.3).
   - *Done when:* for every exhausted entry, exactly one comment + label per
     episode; a second selector pass with no state change posts nothing new.
3. **Wire into `main()`** — no signature changes; `report_stuck_change`
   already receives `entries` (it must also receive `repo`, which it has).
   Verify no call-site changes needed beyond behavior.
   - *Done when:* `python -c "import ast,sys; ast.parse(open('scripts/automatic_promotion_candidates.py').read())"` passes and the suite (step 4) is green.
4. **Tests** — in `scripts/test_automatic_promotion_candidates.py` extend the
   existing `report_stuck_change` test block (lines ~1197-1294) with, by name:
   - `test_stuck_change_escalates_each_parked_pr_once` (comment + label POSTed per entry).
   - `test_stuck_change_escalation_is_idempotent_on_marker` (existing marker comment → zero POSTs).
   - `test_stuck_change_escalation_failure_warns_and_continues` (first PR's comment POST raises; second PR still escalated; no exception escapes).
   - `test_stuck_change_creates_missing_parked_label_once` (404 → label create → apply; existing → no create).
   - `test_stuck_change_escalation_omits_database_secrets` (body contains versions/links; contains no `postgres://`, no project refs — matches the repo's public-boundary rule §8 #4910).
   - Existing suite must stay green: `python -I scripts/test_automatic_promotion_candidates.py` (and CI job "Promotion selector tests").
5. **Adversarial-cases table (trust boundary: GitHub API inputs):**

   | External input | Hostile case | Test that proves it |
   |---|---|---|
   | PR comments listing | API error mid-read | `..._failure_warns_and_continues` (skip + warn, other PRs still escalate) |
   | Prior escalation comment | marker present → must not re-post | `..._idempotent_on_marker` |
   | Comment listing pagination | >100 comments hides an old marker | read ALL pages before judging (implement in step 2; test: fake two pages, marker on page 2 → no re-post) — name it `test_escalation_marker_search_is_paginated` |
   | Label endpoint | label missing (404) | `..._creates_missing_parked_label_once` |
   | Label endpoint | rate-limited 403 | warn-not-raise (same warning test) |
   | PR state | PR closed/deleted mid-park | per-PR catch covers 404 → warn, continue (fold into `..._failure_warns_and_continues`) |
   | Comment body surface | secrets/project refs leak | `..._escalation_omits_database_secrets` |

6. **Verification gate (Phase 1):** all new tests green locally AND
   "Promotion selector tests" green on the PR; `bash scripts/check-sql.sh`
   untouched-pass (no migrations added — it must stay exit 0).

**Phase 2 — Upgrade A: the pre-end watch rule (rulebook + skills; context cut
point — a fresh session should re-read §5 and this phase before starting).**

7. **Rulebook pair edit (single PR, both files, verbatim-moved rule):**
   - `AGENTS.md` → "Session wrap-up convention" section: append one bullet —
     after a migration PR merges, the session does not end without: (a) a
     bounded self-check automation scheduled (ZCode family) with stop
     condition "version in production ledger → post evidence comment +
     pause; parked/held → escalate per plan_promotion_stranding_watch.md",
     or (b) if the harness cannot schedule, the HANDOFF.d file carries the
     exact re-check command; and always (c) the landing issue gains
     `- [ ] promotion delivered to production` ticked only by a production
     ledger read.
   - `docs/agents/worktrees-and-handoffs.md` §2.1-H: same rule in long form
     (this is the paired chapter; AGENTS.md stays the router summary).
   - Cross-link this plan file from both.
   - *Done when:* `ai-doc-safety`/documents checks pass on the PR head;
     guard `scripts/check-*.mjs` unaffected (no script contract changed).
8. **Skill copies edit (both, identically):** in
   `codex-shared-db-change/SKILL.md` procedure step 5, after "it does NOT
   apply to the DB (apply is the … workflow_dispatch step above)", add the
   pre-end watch step (same wording as the rulebook bullet, plus: link the
   tracking issue #6352 and this plan). These files are user-level, outside
   the repo — commit them in the dotfiles/skills repo if one tracks them
   (verify; otherwise edit in place and note it in the plan STATUS).
   - *Done when:* both copies contain identical text (diff them) and the
     next session loading the skill sees the step.
9. **Memory entry:** add `promotion-watch-wrapup-rule` memory pointing at this
   plan (STATUS-first rule).
   - *Done when:* memory file + MEMORY.md index line exist.

**Phase 3 — landing and live proof.**

10. Land Phase 1 and Phase 2 as **two PRs** through the merge queue (plain
    `gh pr merge`; re-arm after any promotion-freeze ejection; re-stamp rule
    not applicable — no migrations). Phase 1 first.
    - *Done when:* both merged; `sync.yml` mirrored; CI green.
11. **Live proof (stays open on the tracking issue until real):** the next
    real park must produce the PR comment + label automatically. Until one
    occurs, leave `- [ ] live proof: first automatic per-PR escalation` on the
    implementation issue (same-issue rule; never a second ticket).
    - *Done when:* a real parked PR shows the escalation comment + label,
      linked in the issue.

### 10. Tests required

Named in step 4/5 (five new unit tests + pagination test; existing selector
suite + `check-sql.sh` must stay green; "Promotion selector tests" CI job).
Rulebook PR: documents checks (`ai-doc-safety`, Documents-only merge
authorization route) must pass; no code tests.

### 11. Constraints, standing rules, gotchas

- Rulebook changes are never "documents-only" (AGENTS.md rule); the pair must
  move together; section numbers never change.
- Never `--admin`/`--squash` merges; queue only. Freeze ejections need re-arm.
- No secrets/project refs in comments or committed text (public boundary,
  #4910); comment bodies are public surface.
- Warnings-not-failures for all escalation I/O (L.3; #5558 idiom).
- Windows/MSYS: use `MSYS2_ARG_CONV_EXCL="*"` for `git show origin/main:path`;
  gh transient 403 ≠ quota death; derive EST from GitHub `Date:` header
  minus 5h, never the local clock.
- The selector test file runs fast locally; the full trigger dry-run does NOT
  (minutes of API pagination) — don't gate local dev on it.
- Do not touch `ai-blocker-watch` (retired `wait` — §7).
- GitHub schedules can skip entirely — never rely on "the cron will do it" as
  a verification.

### 12. Access and environment

- Repo `popcre/shared-db`; worktree-per-session from `origin/main`; git
  identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- `gh` authenticated (u2giants). Trigger job token does the GitHub writes in
  production; local runs of `report_stuck_change` must NEVER be executed
  against the real repo (it writes issues) — tests fake `gh` entirely.
- Secrets: none needed beyond 1Password vault `vibe_coding` item "Supabase
  CLI Personal Access Token" (location only) for optional read-only ledger
  verification in live proof.
- Plan + HANDOFF.d land as a prose PR (fast documents route).

### 13. Definition of done + risks

**Done when:** Phase 1 merged with tests green; Phase 2 rulebook/skill/memory
landed; a real future park produces the per-PR escalation automatically
(live-proof item ticked with run/issue links); this plan's STATUS table fully
`✅` with artifacts; HANDOFF.d retired when the live proof lands.

**Risks:** (a) escalation comment spam if idempotency misjudges episodes —
mitigated by marker test + pagination test; (b) label creation raced by two
trigger runs — both create-or-use, worst case a 422 on one → warn path;
(c) rulebook bullet ignored by future sessions (process risk inherent to
rules) — mitigated by the skill step (sessions load it before merging) and by
Upgrade B being the systemic net that doesn't depend on obedience; (d) held-PR
stranding remains un-instrumented if Phase 2 escalation is declined — accepted
(OPEN L.8) with the finding-issue-as-card doctrine covering it.

**Open questions:** label color/wording (open); held-PR escalation adoption
(open, criteria in L.8); whether skill copies are dotfiles-tracked (verify in
step 8).

---

*Plan registered in `HANDOFF.d/` — see backlink below. Root `HANDOFF.md`
remains the static pointer.*

## Mandatory self-audit (recorded)

1. **Could a brand-new session execute without asking anything?** Yes — §2/§3
   define every term, login and ruling cited; §9 names files, line anchors,
   exact API endpoints, test names and gates; §11 carries the MSYS/queue
   traps; §12 covers auth and the "never run report_stuck_change against the
   real repo" guard.
2. **Every piece of background held?** Yes — full incident history with run
   ids and comment permalinks (§3), the retired-mechanism discovery (§6-#2,
   §7), all rejected designs with reasons (§7), locked/open decisions dated
   (§8).
3. **Goal clear enough for judgment calls?** Yes — §1's two-sentence goal plus
   the "goal wins" instruction; §13's risks name where judgment is expected
   (episode idempotency, Phase-2 adoption).

Checklist: 13 sections present; goal up top with override instruction;
rejected approaches §7; per-step files+gates §9; adversarial table §9.5 with a
test per row; locked/open labeled §8; out-of-scope §4; tests named §10; terms
defined §2-§3/§5; secrets by location §12; DoD includes commit/CI/live-proof
§13; STATUS table with artifact column at top; HANDOFF.d backlink required
(mechanics below).
