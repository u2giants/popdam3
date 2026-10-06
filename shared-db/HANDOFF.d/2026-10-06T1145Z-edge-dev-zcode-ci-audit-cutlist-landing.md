---
issue: 3541
status: OPEN
owner: zcode sess_636fe0d9 on edge-dev (this session; work continues via any successor session)
---

# CI-audit cut list landing + abandonment-audit repair — handoff

Written 2026-10-06 11:45 AM EST by the ZCode session that ran the whole chain. All
facts below were re-verified against GitHub at 11:38 AM EST 2026-10-06 unless
stamped otherwise.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs the owner.** Sweep performed
(§1–§9 and part (b) walked line by line): every open item is technical and is
gated by repo checks, an assigned AI reviewer, or another named session. The one
semi-commercial fact (Blacksmith runner outage, §4) is informational; the
provider relationship decision is Albert's only if he wants to pursue credits —
recommended only if outages recur.

**Already settled — do NOT re-ask:** "finish everything here yourself" (Albert,
2026-09-28) authorized this session to take over and land other sessions' in-flight
CI repairs through the governed lane; "there is no orchestrator anymore… claim-first"
(Albert, 2026-09-28) governs routing.

## 1. What this application is

`popcre/shared-db` is the single shared Supabase Postgres repository that every POP
Creations app (CRM, DAM, PM/PIM, DesignFlow PLM) reads and writes. Its CI, merge
lane (guarded merge, reviewer rotation, evidence contracts under `.agent/work/`),
and scheduled loaders protect that database. This session's workstream was
**CI/merge-machinery maintenance**, not schema: a 60-day evidence audit of all
workflows/checks, then landing agreed cuts and repairing the Author Lane
Abandonment Audit.

## 2. What we set out to do, and why

Albert asked (2026-09-24): audit every workflow/check/merge rule, evidence-based,
and produce a cut list. Then: "run your findings by Muse", "debate this out with
Grok 4.6 and then make the best decision and proceed", and finally (2026-09-28)
"there is no orchestrator anymore… do the database changes yourself, according to
the new rules. finish everything here yourself." Goal: remove CI waste that catches
nothing, keep everything that protects the database, and leave the broken
abandonment audit working end-to-end.

## 3. Current state — what is true right now

**Landed and verified (all PRs MERGED, checked 11:38 AM EST 2026-10-06):**
- **PR #3537** (merge 3839dd5a, 2026-09-25): deleted two dead one-off workflows
  (verify-production-ledger-recovery-1750, shared-db-2870-observation + proofs);
  added `actions: read` to the abandonment audit (necessary, not sufficient).
  Issues #3538 (closed by merge), #3536 (umbrella tracker, REOPENED today — a bot
  closed it mechanically on 2026-09-28 while its deferred checklist was live).
- **PR #3625** (merge 5deadd04, 2026-09-30, taken over from another session per
  owner instruction): rebuilt the audit's required-check derivation. Insufficient
  alone — see §4.
- **PR #3858** (merge c51e10a3, 2026-10-01): the finishing repair —
  `AUTHORITY_TOKEN: ${{ secrets.SYNC_TOKEN }}` in the audit step env with a named
  absence guard, scoped swap-and-restore reads (`scripts/lib/authority-token-read.mjs`),
  invalidator registration. Work issue #3857 (closed today with landing comment).
- **Audit report delivered to Albert:**
  `C:\Users\ahazan\Downloads\shared-db-ci-audit-2026-09-24.md` (with Muse + Grok
  opinions and the 2026-09-25 outcome section appended).

**Open proof card: #3541** (non-orchestrator). Criterion: the audit's next
SCHEDULED run on main must exit 0 (clean) or 2 (truthful expired-lane report).
Status as of the 2026-10-06 03:03 AM EST run (37407185068): the token fix WORKS
(AUTHORITY_TOKEN resolved; zero 403s; the audit runs to full reconciliation for
the first time since 2026-09-16), but it exits 3 because it fail-closes on
genuinely broken lane state: expired claims with no live pull request, e.g.
**claim #3738** (owner "Claude chat 626c9036… on edge-dev3", expired 2026-09-29,
`pr: null`), plus siblings ("claim #3739…"). So the original machinery bug is
FIXED; what remains is hygiene on abandoned lanes the audit now correctly names.

**Local machine state:** no worktrees of mine remain; my local branches deleted
(both PRs merged). `fix/3536-phase6-cron` local branch exists but is NOT mine
(another session's — untouched). Scratch data: `C:\Users\ahazan\AppData\Local\Temp\sdb-ci-audit\`
(audit evidence + this session's logs; safe to delete anytime).

## 4. Everything we tried that did NOT work

1. **`actions: read` alone (PR #3537)** — did not fix the audit; the failing call
   was branch protection, which workflow tokens can NEVER read (no administration
   scope for GITHUB_TOKEN).
2. **PR #3625's derivation alone** — still exit 3 live: `readRequiredCheckContexts`
   requires the admin-gated main-branch protection readback even after tolerating
   the 403 on the first provider.
3. **My first token-scoping helper (round 1 of #3858)** — a custom executor for
   the two authority reads. Qwen's review proved it (a) disabled the host-wide
   quota latch (`quotaLatch: executor===execFileSync ? … : null`) and (b)
   double-charged the review wire budget. Fixed by the swap-and-restore
   (`tokenScopedRead`) shape; keep that lesson.
4. **Generation-1 contract for #3858** — published with a truncated 10-char
   `base_sha`; git-evidence refused. Contracts are immutable → had to publish
   generation 2. ALWAYS write full 40-char SHAs in contracts.
5. **`git stash --keep-index` during pair restructure** — corrupted the worktree
   (UU conflicts on untouched files). Never stash mid-recipe; reset and recommit.
6. **`git checkout origin/main -- .agent` does NOT delete files absent from main**
   — my stale pair survived into the impl head and the gates caught it. `git rm`
   the pair explicitly during a refresh.
7. **The branch-refresh helper** (`scripts/refresh-code-pr-branch.mjs`) refuses
   when a contract lists a check it cannot re-run — regenerate the pair by hand
   then (recipe in §6).
8. **Windows CRLF trap** — worktrees default `autocrlf=true`; tests that split on
   exact `\n` read CRLF and fail phantom. `git config core.autocrlf false` AND
   force-rewrite files (`rm` + checkout) before trusting a "failure".
9. **Reviewers:** Grok cancelled twice (provider_cancelled); Muse twice failed to
   durably publish its verdict on this machine ("required report is not durably
   published") but succeeded the third time; Gemini never failed. The
   replacement-ref naming trap: the replacement ref is named with the FAILED
   sequence — check `git ls-remote origin "refs/db-review*"`; the GitHub
   matching-refs API hides coordination refs.
10. **Blacksmith runner pool outage 2026-10-01** (≈8:15 AM–3:00 PM EST): every
    `blacksmith-2vcpu` job queued for hours while `ubuntu-latest` ran fine;
    repo-wide, other sessions' PRs too. Cancel+rerun helped only after pool
    recovery. Also: mystery cancellations of the audit's own runs on 2026-10-01
    (concurrency `cancel-in-progress`, no successor run visible) — a rerun
    worked; if it recurs, investigate who/what dispatches into that group.

## 5. Root causes and key findings

- **The audit's chronic exit 3 had three stacked causes**, each peeled in turn:
  missing `actions: read` (fixed #3537) → admin-gated branch-protection readback
  (fixed #3625+#3858 via AUTHORITY_TOKEN) → genuinely unreadable lane state
  (OPEN: dead claims). Audit numbers and per-run evidence: agentA-D reports in
  the temp scratch dir; headline: 4 required checks = 120 catches / 9 false
  blocks; documents-only auth was 70% of PR red with 0 catches; reviewer draws
  failed 29%; ~44% of merges maintained the machinery itself.
- **The guarded-merge AUTHORITY_TOKEN pattern** (`secrets.SYNC_TOKEN`, classic PAT)
  is the repo's sanctioned way to do admin-gated reads; reuse it, scoped, never
  a second mechanism.
- **Landing recipe** (db-work-scope issue → publish contract → impl commit +
  pair-only commit → draw → governed review → guarded merge) is fully encoded in
  `C:\Users\ahazan\.zcode\cli\memories\projects\shared-db-857a166c40ec37ea\memory\shared-db-evidence-pair-and-governed-merge-mechanics.md` — read that first on any future landing.
- **ai-blocker-watch wait registration is retired** (2026-09-30): leave the
  issue/PR as the card; the bounded janitor re-surfaces stuck state.

## 6. Exact next steps

1. **Retire the dead lanes the audit names** so it can return exit 0/2. From the
   2026-10-06 03:03 run log: claim #3738 (owner Claude chat 626c… on edge-dev3,
   expired 2026-09-29, `pr: null`), claim #3739, and siblings — run
   `node scripts/manage-migration-author-lanes.mjs --abandonment-audit` for the
   live list, open the abandonment-audit evidence issue per the template, then the
   guarded `--relinquish-author-lease` command the report prints (worktrees for
   those claims are other sessions'; check `clean`/`absent` before retiring —
   `dirty`/`remote` work is potentially recoverable and stays parked with evidence).
   Gate: the audit's next scheduled run exits 0 or 2.
2. **Then close #3541** with the run ID as proof (criterion is written in its body),
   and delete this handoff file in that same PR (successor rule).
3. **The deferred CI cuts** live on REOPENED issue #3536's checklist — merge-queue
   pair (needs runner-lanes registry surgery; was blocked by in-flight #3520/#3521,
   re-check), historical-MG tests (needs truth-audit registry + disposition
   retirement in one change), Phase 6 crons (needs tools/phase6-schedule-map +
   workflow case arms together; someone's local branch `fix/3536-phase6-cron`
   suggests another session started this — check open PRs before starting),
   start-reroute canary (imported by reviewer-start-watch.mjs), agent-work-contract
   gate cost (belongs to the #3380/#3383 evidence program), ColdLion backfill
   retirement (needs pending=0 row-count confirmation), reviewer-rotation relief
   (circuit-breaker first, then scheduled credit checks — Grok/Muse debate order,
   recorded on #3536).
   Gate per item: PR merged through the lane + its checklist box ticked on #3536.
4. **Docs discrepancy** (from the audit): AGENTS.md/§6.7-era text still teaches
   six required contexts; live branch protection has four. Fix belongs to a
   rulebook PR with its own evidence pair; noted here so it is not lost.
   Gate: a prose PR updating the count lands.

## 7. Constraints and gotchas in force

- Claim-first structural work; no orchestrator, no marker (owner ruling 2026-09-28).
  Repo-maintenance/CI work keeps `route: repo-maintenance` + `db-work-scope` fence.
- Never push to main directly; guarded merge lane only; docs-only handoff PRs take
  the fast-close squash route (this file rides one).
- Contracts are immutable once published; a scope change = new generation.
- Windows: `autocrlf false` in worktrees before trusting test failures.
- Reviewer draws bind the exact head; pushing after a draw strands it (re-draw).
- Quote human-facing times in EST, named.

## 8. Access and environment

gh authenticated (u2giants); 1Password CLI available (no secrets were created or
exposed this session — the sweep result is in §9-adjacent closeout report);
reviewer wrappers installed at `/c/repos/ai-devops/bin/` (ai-grok-review, ai-muse,
ai-gemini, ai-qwen). The elevated read secret is repo secret `SYNC_TOKEN`
(referenced by name only). Machine: edge-dev, Windows, Git Bash.

## 9. Open questions and risks

- Who/what cancelled the audit's own runs on 2026-10-01 (twice) is unexplained;
  benign so far (rerun worked) but worth one look if it recurs.
- The audit may exit 2 naming MORE expired lanes as other sessions' work ages —
  that is success, not failure; retire lanes, don't "fix" the audit.
- Stale-facts stamp: main tip 9b07fdf36934 and all PR/issue states above were
  checked 11:38 AM EST 2026-10-06; re-derive before acting.

## Part (b) — sub-agents

### Agent: audit analysis fan-out (4 read-only general-purpose agents, 2026-09-24)
- **Asked to do:** classify every workflow's catches/costs from 33k live runs.
- **Actually did:** produced agentA_pr_checks.md, agentB_reviewers.md,
  agentC_sched_dispatch.md, agentD_mergelane.md (temp scratch dir). No commits.
- **Found:** the headline numbers in §5; the reviewer-failure table (muse 23% …
  qwen 45%); canary/phase6/registry couplings.
- **PR / branch:** none. **Worktree:** none (read-only). **Deliberately did NOT
  do:** change anything — audit was read-only by instruction.

### Agent: #3625 executor (2026-09-28)
- **Asked to do:** execute the task prompt on #3536 (the audit fix).
- **Actually did:** stopped correctly at the in-flight gate (PR #3625 already
  existed), re-verified the diagnosis, built and offline-proved a full fallback
  fix in its own worktree, then removed it; registered a watcher (superseded).
- **Found:** PR #3625's existence; one real expired lane (#3378-era state).
- **PR / branch:** none pushed. **Worktree:** removed by the agent. **Deliberately
  did NOT do:** land a competing PR (serialization rule); the fallback design
  informed the later manual repair.

### Background waiters/automations (mine)
One-shot verifications for #3536/#3541 all completed; one off-peak completion task
finished the #3858 landing chain; nothing scheduled remains of mine.
