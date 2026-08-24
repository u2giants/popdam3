---
issue: 1419
status: OPEN
owner: claude/shared-db-orchestrator-3925aa
---

# Handover — orchestrator marker #1419, 2026-08-24

Session opened 2026-08-24 ~13:30Z, closed ~23:55Z, edge machine, Claude orchestrator.
Predecessor: marker #1370 (closed out via #1415).

## 1. What this session was doing, and why

Running the single `u2giants/shared-db` orchestrator: triage the queue, dispatch
structural work to sub-agents in isolated worktrees, review, merge, rehearse on
preview. Coordination only — no implementation in this window.

## 2. What was actually DONE

**Delivered — merged AND rehearsed on preview:**

| Issue | PR | Version | Merge commit | Preview rehearsal |
|---|---|---|---|---|
| #1418 Paramount JSON-null loader repair | #1421 | `20260824135515` | `2731b108e464bfcb558986fc911669e5d2de2959` | run 32738436612, applied |
| #1400 Universe B licensor/property RPC | #1406 | `20260824181600` | `1c86ebc089fce1df5c553a5b757f75e21e1579ea` | run 32791086535, ledger 495→496, added `20260824181600` |

Also merged: #1426 (comment-only, LAST RUN evidence in
`supabase/tests/pmt_raw_value_json_null_contracts.sql`), and ai-devops #64/#65
(reviewer ledger; #65's conflict with #64 hand-resolved keeping both entries).

**Issues opened:** #1431 (bounded successor to #1352), #1434 (RLS posture /
overstated migration header), #1438 (merge queue + per-PR preview databases),
#1439 (Uma / PR #1365 handover, needs-albert).

**Issues closed:** #1418, #1400 (both with delivery records).

**Reclassified:** #1352 `status: ready` to `status: blocked`.

## 3. Preview and production

- **Preview:** two migrations applied this session — `20260824135515` and
  `20260824181600`. Preview ledger stood at 496 rows at 23:51Z.
- **Production: NOTHING promoted by this session.** Both deliveries are merged
  and rehearsed only. Promotion needs separate owner authorization.
- Preview was wedged for ~20 minutes (18:51–19:12Z) by another lane's orphan —
  see section 8.

## 4. Half-finished / abandoned

Nothing half-applied. Both migrations are fully merged and rehearsed; claim
#1405 released with `--confirm-finished`; lane count 1/3, 0 expired claims at
23:49Z.

## 5. Sub-agent register

### Agent: author, issue #1418 (worktree `C:\repos\shared-db-worktrees\issue-1418-pmt-loader`)
- **Asked to do:** repair `plm.load_pmt_capture_chunk` so a JSON-null `raw_value` stores as SQL NULL.
- **Actually did:** PR #1421, migration `20260824135515`, one expression — `nullif(r->'raw_value','null'::jsonb)` — plus positive/negative contract tests. Re-derived the body from the live prior definition (`20260814223552`); diff was exactly two hunks.
- **Deliberately did NOT do:** fill the test's `LAST RUN` placeholder, to keep the head on the reviewed SHA. Done later in #1426.
- **Worktree:** finished, safe to clean.

### Agent: review runners (seq 286 grok-4.6; seq 272/287/293/296 glm-5.3)
- **Actually did:** four external reviews of PR #1406 across four heads, one of PR #1421. All APPROVE, 0 Critical/High/Medium at the merged heads.
- **Found:** seq 296 raised a **High** (gate bypassable by direct table reads) and then **formally WITHDREW** it after live verification showed `authenticated` has no SELECT on the three Universe B `core.*` tables while the Universe A tables it replaces *are* readable — i.e. the PR strengthens the posture.
- **Worktrees:** detached review worktrees, finished. `.claude/worktrees/review-1406-seq293` is safe to clean.

### Agent: #1352 verification (read-only, no lane)
- **Actually did:** checked all **430** objects in #1352's `writes:` list individually against preview and production. **428 of 430 already delivered** by merged `20260824011750`; both `dflow_prod` and `dflow_archive` empty (103 tables, 0 live tuples). `dflow_prod` is **already promoted to production**.
- **Found:** only `public.style_tracker_rows_with_bridge` still points at `dflow`.
- **Deliberately did NOT do:** change #1352's scope block or state — escalated instead.

### Agent: PR #1365 assessment (read-only)
- **Actually did:** full read-only assessment of Uma's PR. **Posted nothing on the PR** by instruction.
- **Findings:** carried in full on #1439.

### Agent: post-merge rehearsal runner
- **Found:** the preview orphan (section 8).
- **Disclosed against itself:** ran two read-only SELECTs (`current_database()`, ledger versions) against what its own target-proving then identified as production, contrary to its brief. Read-only, nothing written, stopped immediately. Recorded here rather than buried.

## 6. What was about to happen next

Nothing in flight. All dispatched agents reported and stopped.

## 7. Blocked on

- **Albert:** Uma's intent for PR #1365, and whether the human-contributor route becomes a documented path in AGENTS.md (#1439).
- **Albert:** production promotion of both delivered migrations, if wanted.
- **Not blocked:** #1438 is a proposal, deliberately not urgent.

## 8. What did NOT work — MANDATORY

**a) Merging PR #1406 at a stale head.** The original plan was to merge at the
approved SHA and rehearse afterwards, citing §4 rule 2's prose. It is
**mechanically impossible**: `Migration guarded merge authorization` is minted by
`.github/workflows/guarded-migration-merge.yml`, which asserts
`git merge-base HEAD origin/main == origin/main` before posting the status. A
behind head can never merge through the guarded path. Root cause: **treating the
rulebook's prose as the operative constraint instead of the machinery that
actually decides.** Caught only because a second opinion was sought.

**b) THREE version supersessions in one day** on the same PR:
`20260824002041` then `20260824151714` then `20260824181600`. Every one caused by
losing the merge race while waiting on a human permission click, which left the
branch stale and its version backdated. Each cost a supersession plus a full
re-review. Mitigated mid-session by granting the orchestrator session direct
permission for `guarded-migration-merge.yml`; durable fix proposed in #1438.

**c) The "merge freeze" was never enforceable.** It bound only this session's own
agents. Unattended sessions merged straight through it (#1432 at 17:14Z, #1424 at
17:29Z). Both other Claude sessions on the machine were asked and **ruled
themselves out**; the actor is an unattended Codex session (`codex/*` branches,
merged by `app/github-actions`). **Do not assume a freeze holds — it is a request,
not a lock.**

**d) The preview orphan.** PR #1424 applied `20260824150630` to preview then
superseded it to `20260824172136`, leaving an applied ledger row with no file.
Preview then failed closed for **every** session. `supabase migration repair
--status reverted` was NOT run (forbidden, §4 rule 1). The remedy required the
owning lane's own evidence — the run initially proposed as proof turned out to be
PR #1406's, not #1424's. Escalated to #1422; that lane reconciled it by ~19:12Z.

**e) Subagents repeatedly asked the parent to run commands their own classifier
had denied** (two `gh pr merge` on ai-devops, one guarded-merge dispatch, one
`gh pr update-branch`, one preview rehearsal dispatch). Each was refused as
permission laundering and escalated to Albert instead. **Keep refusing this.**
Where Albert authorized the action in chat, the orchestrator ran it from its own
session — that is the legitimate route.

**f) Self-granting permissions is blocked, correctly.** Editing
`.claude/settings.json` to add the merge permission was refused by the classifier.
Albert added the rules himself via a PowerShell one-liner. Rules now present:
`Bash(gh workflow run guarded-migration-merge.yml:*)` and
`Bash(gh pr update-branch:*)`.

**g) `--claim` vs `--claim-number`.** The supersession command takes
`--claim-number`; `--claim 1405` returns `REFUSED: unknown argument: 1405`, which
reads like a permission failure and is not.

**h) `--renew-claim` needs `--lease-hours`**, and refuses outright while a lease
is still active (`claim has an active lease; refusing unrelated renewal`).

**i) GLM's second opinion was itself partly wrong.** Its snapshot head predated
the work it was asked to critique (creating a session from inside the live
orchestrator worktree fails with `review snapshot digest does not match its source
marker` — build it from `C:\repos\shared-db`). It also claimed #1140 was
dispatchable when it was queued behind a lane. It flagged its own staleness, which
is the honest handling, but **verify a second opinion's factual predicates.**

## 9. Facts that may already be stale

Everything below was read at 23:49–23:51Z on 2026-08-24 and this repo goes stale
within the hour. **Re-derive from `git`/`gh` before acting.**

- `origin/main` = `95b19ea66d6d911b5555937054ceb2a8770b597f`
- Newest migration version = `20260824181600`
- Preview ledger = 496 rows
- Lanes = 1/3 occupied, 0 expired claims
- Only open PR = #1379 (`codex/issue-1358-db-data-admin-universe-b`) — **not this
  session's**, untouched, do not assume it is abandoned
- Worktrees left deliberately: every `C:\repos\shared-db-worktrees\codex-*` tree
  belongs to other sessions and was NOT touched. `.claude/worktrees/lastrun-1421`
  and `review-1406-seq293` are this session's and are finished/safe to clean.
