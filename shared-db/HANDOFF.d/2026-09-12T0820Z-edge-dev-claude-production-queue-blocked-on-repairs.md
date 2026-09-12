---
issue: 2482
status: BLOCKED
owner: claude/production-issues-automation-dfbb8c
---

# HANDOFF — production queue blocked on five unstarted repairs (2026-09-12 08:20 UTC, EDGE-DEV/Claude)

Orchestrator marker **#2758**, successor to #2714. Route id
`local_ceb221ac-1746-4836-9306-6839c18dbced`, session
`shared-db.orch EDGE-DEV production queue 2`, started 2026-09-11T12:20:00Z.
Predecessor briefing:
`HANDOFF.d/2026-09-11T1152Z-edge-dev-codex-production-queue-closeout.md`.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this **whole list to Albert in ONE message before starting work.** Do not
meet these one at a time.

### Blocking — the assigned queue cannot finish until these start

These are the five background task chips this session raised. All are
**unstarted**, and two sit directly upstream of the remaining work. None of them
is orchestrator work: repository maintenance and workflow permissions belong to a
separate repository session (AGENTS.md §0.0-C, REPO-SESSION exit).

1. **The automatic production promotion cannot write its own evidence.**
   One line in the promotion workflow grants read-only access where it needs
   write access. Every automatic promotion dies at that line *after* the preview
   step has already succeeded, so the run looks like a deliberate skip rather
   than a failure. It also kills the manual route, because the manual route needs
   the evidence the dead step would have produced. **One line blocks production
   by both routes, for every migration — not just the one in flight.**
   *Recommendation:* start this first; it is the single highest-value repair on
   the board. Blocks #2482 completely.
2. **The structural-admission gate refuses a valid migration.** A one-day-old
   safety check looks for schema keywords at the start of a statement. A
   migration that edits an existing routine safely — the pattern this change is
   *required* to use — has none, so the gate refuses it and no reviewer can be
   assigned. Eighteen already-merged migrations use the same pattern, and the
   gate's own tests never covered it. **This is a defect in the checker, not in
   the change.** *Recommendation:* start this second. Blocks #2744/#2818 and,
   behind it, #2579.
3. **A reviewer slot is stranded with no honest way to release it.** When a
   review's target moves, the recovery tool demands a reason code, and every
   available code blames a reviewer that did nothing wrong. *Recommendation:*
   add a "target superseded" code. Until then the slot stays stranded — I did
   not pick a lying code and did not hand-delete the record.
4. **A ledger fix is written and waiting** (PR #2849, mergeable). A related
   repair tool must not be run until it lands.
5. **One migration still needs its scope defined** before it can be queued.

### Not part of this work, and nobody is on it

6. **A database password was exposed and must be treated as compromised.**
   Rotating it needs your approval and has been waiting across several sessions.
   *Recommendation:* approve the rotation.
7. **#2662 Part A is finished and waiting for a production promotion** that the
   defect in item 1 currently prevents.
8. **#2179 — five ColdLion data feeds need an ingest-or-ignore decision.**
   Only you can make this call. *Recommendation:* decide ignore unless you know
   of a consumer.
9. **Twenty-nine of thirty-seven handoff files describe work that is already
   finished.** They belong to other sessions, so I did not delete them (see §3).
   *Recommendation:* authorise one cleanup session to retire all 29 in a single
   pull request.

### Already settled — do NOT re-ask

- Albert authorised completing the named queue through production, and
  self-merge outside DesignFlow, on 2026-09-11.
- Albert authorised autonomous operation: "don't stop until there are 0 open
  orchestrator Issues." Ask reviewers, not Albert, when a question arises.
- Report to Albert **only** when an issue fully closes to production, or when he
  must act. Merged is not applied; preview is not production.
- Never ask Albert to review or merge a pull request.
- Never ask Albert to sign off on technical risk (ruling 2026-08-18).
- Do not touch #2705, #2709, #2290, the #2543 residual, or #2678.
- #2481's nullable foreign key already settles cardinality; do not invent a
  historical crosswalk.

---

## 1. What this application is

`u2giants/shared-db` holds the **structure** of the shared Supabase database used
across POP Creations' applications — tables, views, functions, policies, grants.
Row data belongs to the applications that write it; this repository governs
shape only.

Every structural change is authored as a numbered SQL migration on its own
branch, reviewed by an independent AI reviewer, applied to a shared **preview**
database, merged, and only then promoted to **production**. Those are three
distinct states and the repository's rules turn on the difference:
**merged is not applied, and preview is not production.**

One **orchestrator** session runs at a time. It never writes migrations itself:
it triages, dispatches to sub-agents in isolated worktrees, assigns reviewers,
merges, and promotes. Its lock is an open GitHub issue labelled
`orchestrator-marker` carrying a `route_id` other sessions use to reach it.

---

## 2. What we set out to do this session, and why

Inherited from marker #2714 with a named list to deliver **through to
production**: 2506, 2507, 2509, 2497, 2501, 2481, 2482, 2496, 2576, 2579.

**Eight closed. Two remain open: #2482 and #2579.** Both are now blocked on
repairs outside orchestrator scope, which is what this handoff is about.

---

## 3. Current state — what is true right now

All facts below re-read at **2026-09-12 08:20 UTC** unless stated.

- `origin/main` = **`da9ff0c6`**
- Highest migration version on main = **`20260911221304`**
- Open pull requests = **14**; ten are `CONFLICTING`, all on the same
  `.agent` evidence pair, because main moved. This is routine in this repository
  and is resolved wholesale to the branch's own copy — it is not damage.
- Mergeable: **#2849**, **#2818**, **#2799**.
- Marker **#2758** is the sole open orchestrator marker (verified via
  `node scripts/check-orchestrator-marker.mjs --resolve`).
- **Nothing was applied to preview or promoted to production by this session.**
  Stated explicitly because "nothing" is a real answer and matters here.

### The two remaining issues

**#2744 / PR #2818 — blocked by a defective gate.**
The migration `20260911222514_scraped_properties_narrow_asset_style_map.sql`
fixes a measured performance regression (a query went from ~4.3s to 5–8s and was
being cancelled at 8.4s; after the fix, ~2.5–3.3s, with results proven
byte-identical at 1,311,298 bytes). Head is
`93d3544538cb5c532053a97666c5aea52c68a298`.

**Both earlier blocking review findings are cured at this head** — verified
directly, not assumed. Muse's pin finding was cured in an earlier session;
grok's sidecar finding is cured here, the sidecar now naming a real contract
that is a strict superset of the one it replaced.

It cannot be reviewed because the admission gate refuses it. See §5 for why that
is the tool's defect and not the branch's.

**#2579 — queued behind #2818**, because both write the same routine.

**#2482 — blocked by workflow permissions.** The promotion job declares
read-only repository access at line 977 of the migrations workflow and needs
write. Re-read on main this session: **unchanged, no fix has landed.** The job
dies *before* it writes the review evidence, so the manual governed route is
blocked by the same line.

### Handoff directory — 29 of 37 files are stale

The file **count** is explicitly not a problem (owner ruling, 2026-08-13) and no
cap may be added. **Stale** files are the problem, and the target is zero.
Twenty-nine files describe issues that are already closed:

`2026-08-14T2236Z-al8960ofc-claude-coldlion-history-endpoints.md` (#1031) ·
`2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md` (#1090) ·
`2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md` (#1984) ·
`2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md` (#1031) ·
`2026-09-03T1750Z-edge-dev-claude-orchestrator-2193-closeout.md` (#2218) ·
`2026-09-04T0030Z-edge-dev-claude-orchestrator-2224-closeout.md` (#2247) ·
`2026-09-04T0129Z-edge-dev-claude-coldlion-reply-20260903-ready-to-send.md` (#1031) ·
`2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md` (#2267) ·
`2026-09-04T1103Z-edge-dev-codex-priority-orchestrator-2269-closeout.md` (#2283) ·
`2026-09-04T1108Z-edge-dev-codex-post-cutover-closeout.md` (#2267) ·
`2026-09-04T1109Z-edge-dev-claude-non-orchestrator-queue.md` (#2258) ·
`2026-09-04T1109Z-edge-dev-codex-expired-claim-recovery.md` (#2280) ·
`2026-09-04T1303Z-edge-dev-codex-orchestrator-2288-closeout.md` (#2293) ·
`2026-09-04T1625Z-edge-dev-2-claude-orch-2297-closeout.md` (#2297) ·
`2026-09-04T2010Z-edge-dev-codex-unauthorized-orchestrator-handover.md` (#2317) ·
`2026-09-04T2053Z-edge-dev-codex-priority-12-orchestrator.md` (#2323) ·
`2026-09-06T0030Z-edge-dev-claude-orchestrator-2330-closeout.md` (#2400) ·
`2026-09-06T1330Z-edge-dev-2-claude-orch-2404-closeout.md` (#2432) ·
`2026-09-07T0620Z-edge-dev-claude-orchestrator-blocker-issues.md` (#2494) ·
`2026-09-07T1634Z-edge-dev-codex-five-issue-closeout.md` (#1090) ·
`2026-09-07T2224Z-edge-dev-codex-orchestrator-transfer.md` (#2552) ·
`2026-09-08T1650Z-edge-dev-claude-four-blocked-issues.md` (#2572) ·
`2026-09-08T1735Z-edge-dev-codex-orchestrator-queue-handoff.md` (#2586) ·
`2026-09-09T0620Z-EDGE-DEV-2-claude-orchestrator-2597-closeout.md` (#2597) ·
`2026-09-09T1141Z-edge-dev-codex-orchestrator-2625-closeout.md` (#2580) ·
`2026-09-10T0614Z-EDGE-DEV-codex-orchestrator-2629-closeout.md` (#2439) ·
`2026-09-10T1930Z-EDGE-DEV-claude-orchestrator-2669-closeout.md` (#2669) ·
`2026-09-11T0350Z-EDGE-DEV-claude-orchestrator-2689-closeout.md` (#2689) ·
`20260906T205200Z-edge-dev-shared-db-orch-5e0e7c81-orchestrator-closeout.md` (#2469)

**I deliberately did not delete them.** They belong to other sessions, and the
successor rule only lets a session retire the file of a workstream whose next
step **it** finished. I finished none of these. Deleting them would also destroy
the only record of decisions I have not verified are recorded elsewhere. Queued
as §0 item 9 instead.

**My predecessor's file is NOT stale and I kept it:** its issue #2704 is still
open, and I ended blocked rather than finishing its next step, so two of the
three retirement conditions fail.

---

## 4. Everything we tried that did NOT work

**[MANDATORY SECTION — read this before re-attempting anything above.]**

1. **Assigning a reviewer to #2818 — refused twice, for two different reasons.**
   The first attempt failed on *my own shell error*: an unset variable made the
   output redirect fail before the command ever ran. I verified this was harmless
   rather than assuming — checked that no lease and no mutex entry existed — but
   the lesson is the important part: **a wrong invocation refuses in the
   reviewer's name and reads exactly like a dead reviewer.** Check your command
   before suspecting the pool.
   The second attempt genuinely ran and returned
   `REFUSED: the pull request migration files contain no statement-leading schema
   DDL`. That is the gate defect in §5.
2. **Trusting an exit code.** That refusal was reported by the background task as
   **"completed (exit code 0)"**. The command had refused. **Exit 0 never proves
   a lane command succeeded** — read the output and verify the actual refs.
3. **Believing the reviewer pool was dead.** An earlier session recorded all
   eight providers failing. That was a wrong script path. Through the correct
   wrapper (`/c/Users/ahazan/.local/bin/ai-review-preflight`), **six providers
   are healthy** — glm, grok, muse, codex, claude, deepseek; qwen and kimi are
   not. **The pool is fine.**
4. **Three bypasses I considered and rejected.** Adding cosmetic schema keywords
   to the migration so the gate passes; rewriting it as a full routine
   replacement; hunting for a flag that skips the gate. All three defeat a safety
   check instead of repairing it, and the second is forbidden by the branch's own
   contract. **Do not revisit these.** Repair the gate.
5. **A conclusion I got wrong twice, and retracted.** I first read this as one
   fact tripping two guards, then swung to "the branch must be rewritten." Both
   were wrong. The evidence in §5 settled it the other way. Recorded so the next
   session does not re-walk the same reversal.
6. **I overstated the blast radius** of a gate fix before measuring it, then
   corrected: see §5.

---

## 5. Root causes and key findings

**The admission gate is the defect — four independent pieces of evidence.**

1. **The gate is one day old.** `scripts/orchestrator-flow/admission.mjs` first
   entered the tree on 2026-09-11 and was amended five times the same day.
2. **The pattern it rejects is long-standing.** Of **673 merged migrations, 205
   contain no schema keyword at all, and 18 use exactly this pattern.** All
   predate the gate.
3. **The gate was never tested against it.** Its test file contains **zero**
   occurrences of the pattern's keywords.
4. **The branch's own contract makes the pattern mandatory.** The contract
   forbids re-introducing the whole-catalog approach and requires byte-identical
   results — which is precisely what deriving from the existing routine achieves.

**The fix is narrow, contrary to my first assessment.** The keyword-inventory
function has exactly **one** non-test consumer. I initially warned that widening
it could weaken collision detection; having measured it, a targeted fix is
feasible. Recorded because the routed brief carries my original, wider warning.

**The blast radius is one pull request.** Of the seven open PRs carrying
migrations, six have statement-leading keywords and pass. **#2818 is the only one
stranded**, and behind it #2579. The defect is real but is not choking the queue.

**Two verdicts exist for #2818 but both bind a superseded head**, as do two older
ones. **Nothing at the current head has been reviewed**, so a fresh round is
legitimate and is not verdict-shopping. I checked this specifically before
drawing, twice.

**The stranded lease is ~12 hours old** and bound to a twice-superseded head.
There is no honest verb to release it: every available failure code blames a
reviewer that did nothing wrong. I left it alone.

---

## 6. Exact next steps

1. **Open your OWN marker** with your own `route_id` — never reuse
   `local_ceb221ac-1746-4836-9306-6839c18dbced`. Then run
   `node scripts/check-orchestrator-marker.mjs --resolve`.
   *You'll know it worked when* it prints exactly one marker and **your** id.
   Dispatch nothing until it does.
2. **Put §0 to Albert in one message.** *Worked when* he has answered the five
   blocking items, or told you to proceed without them.
3. **Repair the workflow permissions** (§0 item 1) in a separate repository
   session. *Worked when* the promotion job's own qualification step completes
   and writes its evidence on a real run.
4. **Repair the admission gate** (§0 item 2) in a separate repository session,
   with a test covering the do-block pattern. *Worked when* the new test fails
   against today's gate and passes after the fix — prove the test can fail.
   **Never widen the gate to make one PR pass.**
5. **Then, and only then, assign a reviewer to #2818** — use **glm**. Not claude
   (my own engine, so not independent), and not muse or grok (both already
   reviewed it; repeat review degrades independence). Read
   `gh pr view 2818 --json headRefOid` **immediately** before the draw and assign
   against that exact SHA. *Worked when* a lease ref appears at the current head.
6. **Land the `.agent` evidence pair BEFORE assigning, never during.** A commit
   landing mid-review moves the head and voids the review after the reviewer has
   already done the work.
7. **Guarded merge #2818, then promote to production.** Then #2579 behind it.
8. **Re-dispatch #2482** from a fresh selector read with a **freshly announced
   merge freeze** — the previous freeze is void.

---

## 7. Constraints and gotchas in force

- **Never weaken, bypass, or delete a guard to make a check pass**, and never
  route a refused write through a different surface to defeat it.
- **Never fabricate a review or a verdict.** Never use a failure code that blames
  a healthy reviewer.
- **Never kill or `timeout` a lane command** — it orphans the shared mutex and
  freezes the lane for every session. Run it in the background and let it finish;
  an empty log means buffered output, not a dead process.
- **Never hand-delete** a lease, claim, contract ref, or a coordination comment.
- **Never use bare `git stash`** — the stack is shared across worktrees.
- The canonical checkout is **landing-only**; work in worktrees.
- `--admin` merge is for **docs-only** pull requests only.
- Retirement means archive, never drop. No direct production schema changes.
- **Do not run the ledger repair tool until PR #2849 lands.**
- Do not touch expired claims #2778/#2774, the six FORK issues (#2601, #2600,
  #2599, #2598, #2541, #1941), or #2846 (owned by another session).
- `git branch --merged` **cannot see a squash-merged branch** — ask GitHub
  whether the pull request merged.

---

## 8. Access and environment

- `gh` is authenticated as `u2giants`. **Never re-authenticate on a failure**,
  and never reroute around a GitHub refusal via another API surface.
- Reviewer preflight wrapper: `/c/Users/ahazan/.local/bin/ai-review-preflight`.
  Using `node scripts/ai-review-preflight.mjs` instead is the mistake that
  produced a false "all reviewers dead" reading.
- Lane commands need `ORCHESTRATOR_ROUTE_ID` set to the **live** marker's id.
- Secrets live in 1Password vault `vibe_coding`, referenced by item ID only.
  **Secrets sweep: run, nothing new.** No credential appeared in this session's
  chat, diff, scratch files, or untracked files.
- **Docs pass: nothing outside this handoff is stale.** The findings in §5 are
  recorded on issues #2744 and #2579 and in session memory; no rulebook statement
  was disproved.

---

## 9. Open questions and risks

- **The stranded reviewer lease** (~12h) cannot be honestly released until a
  "target superseded" failure code exists.
- **A reviewer slot leak** tracked as #2711 remains open.
- **Ten of fourteen open PRs conflict** on the `.agent` pair. Expected; resolve
  wholesale to the branch's own copy.
- **PR #2750 is in draft**; #2846 belongs to another session.
- **Untracked `scope-2611.txt` / `scope-2611.new`** are another session's
  residue in the canonical checkout. **Left untouched deliberately** — not mine
  to delete. Next action: their owner removes them.
- **Dead worktree `issue-2611-prepack-exclusion`**, and 257+ worktrees overall.
  Left deliberately: `reap-merged-worktrees.mjs` refuses while any marker is
  open, which is correct, because a clean worktree on a merged branch is
  indistinguishable from one a live sub-agent just pushed from.
- **Risk if §0 items 1–2 are not started:** #2482, #2744/#2818 and #2579 stay
  blocked indefinitely. There is no orchestrator-side workaround; every
  workaround I could find was a safety bypass.
- **Facts most likely to be stale first:** the main SHA, the conflict states, and
  the 29-file stale list. Re-derive from `git`/`gh` rather than trusting this
  document — and where this document and an issue disagree, believe neither:
  re-derive.

---

## (b) PER-SUB-AGENT BLOCKS

### Agent: handoff staleness auditor (read-only, no worktree)
- **Asked to do:** determine which `HANDOFF.d/` files name a closed issue.
- **Actually did:** read 37 contract blocks, batch-queried issue states, and
  reported 29 stale, 8 open, 0 missing contract blocks.
- **Found:** the bulk closed-issue query only reached back to #1953, so absence
  from it would have been **false evidence of "open"** for four older issues. It
  queried those four directly instead — #1031 and #1090 are closed and counted;
  #770 and #1403 are open. This is the finding that makes the verdict
  trustworthy; a lazier audit would have under-reported by two.
- **PR / branch:** none — read-only.
- **Worktree:** none.
- **Deliberately did NOT do, and why:** did not delete or edit any file. Not its
  call, and not mine either (§3).

### Agent: #2744/#2818 performance author (earlier sessions)
- **Asked to do:** fix the Scraped Properties style-guide performance regression
  without changing behaviour.
- **Actually did:** authored migration `20260911222514`, with measured before and
  after timings and a byte-identical result proof, at head `93d35445`.
- **Found:** the regression came from resolving style guides against the whole
  61MB asset table (187,487 rows) with temporary disk spill. Recorded two
  rejected alternatives that bought nothing — removing double evaluation alone,
  and a twelvefold memory increase. **Those are already ruled out; do not retry
  them.**
- **PR / branch:** PR #2818, head `93d3544538cb5c532053a97666c5aea52c68a298`.
- **Worktree:** live and resumable —
  `C:/repos/shared-db/.claude/worktrees/wt2818-refresh`.
- **Deliberately did NOT do, and why:** did not rewrite the migration as a full
  routine replacement. Its own contract forbids re-introducing the retired
  whole-catalog approach, so deriving from the existing routine is the correct
  pattern — the gate is what is wrong.

### Sub-agents: none others dispatched this session
This session dispatched no migration authors. Its work was triage, verification,
and routing the five repairs; the five chips are the output.

---

## Self-audit — the four questions

1. **Could a brand-new developer continue without skipping a beat?** Yes. §1
   explains the repository from zero, §3 gives the state with timestamps, §6
   gives ordered next steps each with a verification gate, and §8 names the exact
   wrapper path whose absence caused a false conclusion this session.
2. **As effectively as I could right now?** Yes. The four pieces of gate evidence
   (§5) and the narrow blast radius are written down rather than held in my head,
   as is the reviewer-independence reasoning in §6 step 5 — glm, and why not the
   other three.
3. **Is every relevant detail present?** Yes. §4 carries the dead ends including
   two of my own wrong conclusions and my own shell error; §5 the root causes;
   §7 the standing constraints; §9 the risks and the facts likeliest to be stale.
4. **If Albert read ONLY §0, would he see every decision I need — including ones
   outside this workstream?** Yes, and I checked it the hard way rather than from
   memory. Walking §1–§9 and part (b): the five chips (§3, §5, §6) appear as
   items 1–5; the compromised password, #2662 Part A, and #2179 (§0 only — they
   appear nowhere else in my operational text, which is exactly the category that
   goes missing) appear as items 6–8; the 29 stale files (§3) appear as item 9.
   Every item has a recommendation and names what it blocks.
