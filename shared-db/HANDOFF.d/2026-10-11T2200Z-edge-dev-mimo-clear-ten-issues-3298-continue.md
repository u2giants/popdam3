---
issue: 3298
status: OPEN
owner: mimo/3298-jev-activity-triage-migration-a
---

# HANDOFF — clear-ten-issues coordinator burn-down → finish #3298 migration A

Written 2026-10-11 6:00 PM EST (2026-10-11T2200Z) on machine `edge-dev` by MiMo Desktop session `ses_ffe5ed3a27f19ffeUIx4jDB76S` (env `MIMO_SESSION_ID` was empty; GitHub signatures used `unknown` or that session id).

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None blocking this workstream.** Finishing #3298 / PR #4205 is technical: claim-first migration A, tests, AI review, merge. Assigned AI reviewers gate the merge; never ask Albert to approve.

**Outside this workstream (already tracked — do not re-open or re-ask):**

| Item | Recommendation | Blocks |
|---|---|---|
| #1941 Laura/Ilona human Property reconciliation still OPEN | Leave it; do not contact them. Resume licensing Step 4.1 (#2601) only after that issue resolves membership outcomes. | ColdLion authority apply (closed as deferred) |
| Disney DCP withdrawal answer (settled 2026-09-25, Ilona via Albert) | Do not reopen. Lifecycle publication (#3347) closed until a qualified full capture exists. | DCP publication only |

**Already settled — do NOT re-ask:** never ask a human to approve (2026-09-28); never contact Disney (2026-09-20); pilot-v1 writes are administrator-only (poppim-web#9 ruling); product-type columns land on `plm.item` not `coldlion.item_header` (2026-09-16).

Next session: put any **new** business questions to Albert in ONE message before starting work. None are required to resume #3298.

## 1. What this application is

`popcre/shared-db` is the shared PostgreSQL/Supabase schema repo for POP Creations apps (CRM, DAM, PM/PIM `plm.*` / `pim.*` / `app.*`, DesignFlow). All apps read the same database. Structure (shape) changes are authored here via branch + PR; application row data belongs to app repos. Live designflow.app duty research and Poppim Jev pilot sit on top of this schema.

## 2. What we set out to do this session, and why

Albert (owner) asked the coordinator to **clear** ten open `popcre/shared-db` issues using subagents, max three at once:

`3347, 3306, 3298, 3218, 3024, 2605, 2604, 2603, 2601, 2600`

Goal: burn down the open list with real completion or durable close-with-resume-condition — not another "still blocked" poll.

## 3. Current state — what is true right now

### Issue clear-list (verified `gh issue list` ~2026-10-11 22:00Z)

| Issue | Final state | Disposition |
|---|---|---|
| 3306 workflow-refactor tracker | **CLOSED** | Audit track complete; remaining steps owned by #2530, #3779, #3781, #3397 |
| 3218 hts_rag prod schema | **CLOSED** | Misdiagnosed; schema exists. Remaining work is DesignFlow Cloud Run `HTS_RAG_DB_*` config only |
| 2600 Step 3.5 preview proof | **CLOSED** not_planned | Deferred to `plan_licensing_master_data_implementation.md` STATUS; resume after #2336 merges + prod-verified |
| 2601 Step 4.1 ColdLion authority | **CLOSED** not_planned | Resume after #1941 membership outcomes |
| 2603 Step 6.2 freshness monitor | **CLOSED** not_planned | Resume after Step 6.1 (u2giants/licensor-source-data#86) delivers weekly captures |
| 2604 Step 7.2 retire scalars | **CLOSED** not_planned | Resume after Step 7.1 consumer cutover |
| 2605 Step 8.3 retire superseded paths | **CLOSED** not_planned | Resume after 8.2 promotion + sustained verified operation + failure recovery |
| 3347 DCP lifecycle publication | **CLOSED** not_planned | Resume when one zero-failure authenticated full capture + current qualified baseline exist |
| 3024 product-type reader | **CLOSED** not_planned | Columns already landed via #3036 / PR #3108 / migration `20260916231639`. Home: `plan_product_type_reader.md`; resume at plan step 5 after gold-key rework |
| **3298 PM Jev activity-triage contract** | **OPEN** | **The only unfinished item.** Migration A in PR #4205 (8 commits). |

### #3298 / PR #4205 (the live work)

- **PR:** https://github.com/popcre/shared-db/pull/4205
- **Title:** Migration A: PM Jev activity-triage least-privilege contract (#3298)
- **Branch:** `mimo/3298-jev-activity-triage-migration-a` → `main`
- **Claim:** issue body `db-work-scope` reconciled; claim noted as `#4204` in first commit message
- **Worktree (live, resumable):** `C:/repos/shared-db/.ai/worktrees/3298-migration-a` at `16343ba54`
- **State (checked 2026-10-11 ~22:00Z):** OPEN, `mergeStateStatus: BLOCKED`, **0 reviews**, 21 check successes
- **Failing checks (latest head):** `supabase/tests against anephemeral database`, `Documents-only merge authorization` (the latter is a routing false-friend on a non-docs PR — fix tests first; do not strip code to force docs-only)
- **Commit history (8):**
  1. `697e12d` Add PM Jev activity-triage migration A (#3298 claim #4204)
  2. `e355b1b` Fix worker RLS/ownership, vault access, and accept record ids
  3. `c4309e5` Use grants-plus-worker-policy pattern instead of table ownership
  4. `68ab296` migration: re-reserve 20261011194103 as **20261011205205**
  5. `b6a627b` Harden envelope binding, tests, and validation parity
  6. `b576b3c` Fix reservation gate in tests, control-char class, envelope expiry
  7. `2a0c0ad` Fix comment validator control-char check and RLS test role
  8. `16343ba` Enforce lease expiry and align fail-path envelope binding
- **Migration version on the branch:** `20261011205205` (re-reserved). Max migration on `origin/main` at write time: `20261010033616_drop_frozen_designflow_schema.sql`
- **Preview:** nothing applied by this coordinator session.
- **Production:** nothing applied. Never touched.
- **Not started / not done:** AI reviewer APPROVE, green ephemeral SQL tests, merge, live preview acceptance evidence (12 items in the issue).

### `main` tip (checked 2026-10-11T22:00Z)

`bc08e15dc0928c0620f647c37eeedf0efabc2a89` — Merge pull request #4193 from popcre/codex/3536-finite-silence (2026-10-11T21:24:48Z)

## 4. Everything we tried that did NOT work

- **`for n in ...` bash loop** in PowerShell → `ParserError: Missing opening '(' after keyword 'for'`. Use one `gh` command or separate calls.
- **`ai-task-gates start --class repository-maintenance`** → `unknown change class`. Correct class for this coordinator burn-down: `shared-db`.
- **Assuming `#2336` is closed** because `pop-ai-watchers` said so (2026-10-11). It is **REOPENED** (`stateReason: REOPENED`). Always `gh issue view` the issue state; watcher text can be stale.
- **`gh issue close --comment` with a multi-line body** can fail silently on this shell; use a single-line comment or `gh issue comment` then `gh issue close`.
- **Half-shipping migration A** — subagent correctly refused to close #3298 with an incomplete contract. Acceptance is one contract (tables, trigger, ~25 functions, HMAC/NOLOGIN/RLS + live preview list). Do not call a partial PR "cleared."
- **CI churn on PR #4205:** several rounds of ephemeral `supabase/tests` failures (RLS role, control-char class, reservation gate, envelope expiry/lease). Latest head still red on that suite — do not assume green from an older commit's checks.

## 5. Root causes and key findings

- Ten issues were **not** ten implementations. Nine were trackers, external-lane items, or later plan steps whose entry conditions fail. Closing with a **resume condition** pointed at `plan_licensing_master_data_implementation.md` STATUS is the durable home for Steps 3.5/4.1/6.2/7.2/8.3.
- #3298 was **actually unblocked** when #3398 closed (2026-10-06). Prior "qualification hold" text is superseded by that close + the reconciled `db-work-scope` in the issue body (updated this session). Evaluation-dataset RPCs and the Deno gateway are **out of scope** for migration A.
- Claim-first is the structural route (§0.0-D). Claim session needs `SHARED_DB_SESSION_ID` and `SHARED_DB_AUTHOR_ENGINE`.
- Product-type reader columns already exist (`plm.item`, migration `20260916231639`, PR #3108). #3024 is the remaining algorithm/gold-key program, not a missing column.
- Production already has `hts_rag` schema; DesignFlow app config is the only remaining #3218 work — never reopen a shared-db successor for `HTS_RAG_DB_*`.
- `git branch --merged` cannot see squash merges; ask GitHub whether the PR merged before retiring worktrees.

## 6. Exact next steps

1. **Resume #3298 migration A on PR #4205** (worktree `.ai/worktrees/3298-migration-a`, branch `mimo/3298-jev-activity-triage-migration-a`).
   - Open the failing `supabase/tests against an ephemeral database` run log on head `16343ba` (or newer). Fix until that suite is green.
   - Re-check `Documents-only merge authorization`: if it stays red on a code PR, read the job log for the "offending file" name — it is a route classification issue, not a reason to drop migrations.
   - Verification gate: **you'll know it worked when** `gh pr checks 4205 --repo popcre/shared-db --required` is green on the latest head.
2. **Get allocator-assigned AI reviewer APPROVE of the exact head** (`ai-review` / rotation rules). Batch any fixes into ONE new head (§5.0-C). Never ask Albert to approve.
   - Verification gate: review decision APPROVE bound to the current head SHA (exact-head rule).
3. **Merge PR #4205** (squash, never `--admin`) after APPROVE + required checks.
   - Verification gate: PR state MERGED and `git fetch` shows the squash commit on `origin/main`.
4. **Post evidence comment on #3298** and close the issue if migration A + tests satisfy the contract. If live preview acceptance (the 12 items) is not yet run, leave `- [ ] live proof` on **the same issue** and name it in the closing note — do not open a second ticket.
5. **At end of the finishing phase, re-read this file through section 9 and report any drift** (reciprocal instruction).
6. When #3298 is fully done, **delete this `HANDOFF.d/` file** in the same PR that closes the issue (successor rule).

## 7. Constraints and gotchas in force

- Worktree-only edits; shared checkout is fetch/read + landing only (§2.1-W).
- Never push directly to protected `main`. Feature branch + PR; AI merges (except DesignFlow).
- Exact-head reviewer APPROVE is mandatory; `.agent/`-only equivalence is the sole exception (#2758).
- `ai-task-gates start --class shared-db` then `ai-task-gates check --before <action>` before review / pr-wait / ship / database.
- Sign GitHub comments: `Posted by MiMo chat <id> on <machine>`.
- Secrets: 1Password vault `vibe_coding` only; never values in chat/commits. No new secrets appeared this session.
- Pilot v1: administrator-only writes; no broad table grants; no LOGIN role; NOLOGIN worker owns private functions.
- Do not contact Disney, Laura, Ilona, or any human on Albert's behalf.
- `COORDINATOR_INTAKE.md` is retired. GitHub issues with `db-work` are the queue.

## 8. Access and environment

- Machine: `edge-dev`. Shell: PowerShell (pwsh). Repo: `C:\repos\shared-db`.
- `gh` authenticated to `popcre/shared-db`.
- `ai-task-gates` installed (class `shared-db` recorded this session).
- Subagents used the `actor` tool (`general-1` … `general-5`). `general-5` was still **running** at cutover (implement 3298). If its PR head has advanced past `16343ba`, trust GitHub over this file.
- Secrets: none introduced. Credential names only if needed later — vault `vibe_coding`.
- Bundled tools via `MIMO_*` env vars if needed (`MIMO_PYTHON`, etc.).

## 9. Open questions and risks

- **PR #4205 ephemeral SQL tests still failing on last observed head** (2026-10-11). Risk: next session must fix tests, not just re-run. Do not merge red.
- **Zero AI reviews on #4205** — merge is blocked until exact-head APPROVE.
- **Migration version `20261011205205`** is reserved on the branch; if the branch is abandoned, reclaim/re-reserve carefully per lane tool — do not stampede the same version from two sessions.
- **Live preview acceptance for #3298 not started.** Keep as checklist on the same issue.
- **#2336 licensing consolidation is REOPENED and active** (work contract `refs/db-contracts/2336/1`). Deferred licensing steps must not be reopened without entry conditions.
- Stale facts risk: `main` SHA, PR checks, and max migration go stale within the hour — re-derive from `git`/`gh` before acting (dated 2026-10-11).

---

## Part (b) — every sub-agent this session

### Agent: general-1 (clear 3306 + 3218)
- **Asked to do:** Close or complete #3306 and #3218 with signed dispositions.
- **Actually did:** Both **CLOSED** with signed comments (no code).
  - 3306: https://github.com/popcre/shared-db/issues/3306#issuecomment-6112717807
  - 3218: https://github.com/popcre/shared-db/issues/3218#issuecomment-6112718324
- **Found:** 3306 audit track fully ticked; remaining homes #2530, #3779, #3781, #3397. 3218 is DesignFlow Cloud Run config only.
- **PR / branch:** none
- **Worktree:** finished (none created)
- **Deliberately did NOT do:** no migrations, no Cloud Run changes, no new issues.

### Agent: general-2 (clear 3298 triage)
- **Asked to do:** Clear #3298 now that #3398 closed.
- **Actually did:** Reconciled `db-work-scope` on the issue (status ready, route claim-first, depends_on 3398 removed). Comment https://github.com/popcre/shared-db/issues/3298#issuecomment-6112778234. Did **not** close — full migration A too large to half-ship.
- **Found:** Admin-only pilot v1; evaluation RPCs + Deno gateway out of scope; execution brief in poppim-web.
- **PR / branch:** none from this agent
- **Worktree:** finished
- **Deliberately did NOT do:** no migration files; left implementation to the next agent.

### Agent: general-3 (clear 2600–2605)
- **Asked to do:** Clear the five licensing plan-step issues.
- **Actually did:** All five **CLOSED** not_planned with resume-condition comments pointing at plan STATUS. No repo file edits.
- **Found:** #2336 REOPENED (watcher text stale); #1941 still human-open; 6.1 still open in source repos; 7.1 cutover not delivered.
- **PR / branch:** none
- **Worktree:** finished
- **Deliberately did NOT do:** did not implement any plan step; did not contact Laura/Ilona.

### Agent: general-4 (clear 3347 + 3024)
- **Asked to do:** Clear DCP lifecycle publication and product-type reader.
- **Actually did:** Both **CLOSED** not_planned with signed resume conditions.
  - 3347: https://github.com/popcre/shared-db/issues/3347#issuecomment-6112759356
  - 3024: https://github.com/popcre/shared-db/issues/3024#issuecomment-6112759710
- **Found:** #3036 columns already done (PR #3108). Phase A blind check failed (71 wrong, 482 abstentions). 3347 has no qualified full capture yet.
- **PR / branch:** none
- **Worktree:** finished
- **Deliberately did NOT do:** no structural DCP work; no gold-key rework; did not contact Disney.

### Agent: general-5 (implement 3298 migration A) — **LIVE at cutover**
- **Asked to do:** Claim and ship migration A end-to-end (tests, PR, AI review, merge).
- **Actually did:** Opened **PR #4205** on branch `mimo/3298-jev-activity-triage-migration-a` (claim #4204). Eight commits including migration re-reserve to `20261011205205` and multiple test/RLS/envelope fixes. Worktree `.ai/worktrees/3298-migration-a` at `16343ba54` when last checked.
- **Found:** Persistent ephemeral `supabase/tests` failures across several heads; no AI review yet; merge blocked.
- **PR / branch:** https://github.com/popcre/shared-db/pull/4205 / `mimo/3298-jev-activity-triage-migration-a`
- **Worktree:** **live (resumable)** — do not delete
- **Deliberately did NOT do:** did not merge red; did not ask a human to approve; did not apply preview/production.
- **Note:** Agent status was `running` at handoff write time. Re-check `gh pr view 4205` for newer commits before editing.

---

## Self-audit (handoff-writer Mode A)

1. **Comprehensive for a brand-new developer?** Yes — §3 has issue table + PR/commit state; §6 is ordered next steps with gates; §4 lists dead ends; part (b) covers every agent including the live one.
2. **As effective as this session right now?** Yes — includes reconciled #3298 scope, failing check names, reserved migration id, live worktree path, and that #2336 is REOPENED.
3. **Every relevant detail?** Yes — background (§1–2), goals (§2), state (§3), failures (§4), findings (§5), constraints (§7), access (§8), risks (§9), next actions (§6).
4. **Section 0 complete and free of technical approvals?** Yes — no owner decision blocks #3298; outside-workstream human licensing review listed without asking Albert to approve anything technical.

**Reciprocal instruction:** §6 step 5 tells the finishing session to re-read this file through §9 and report drift to plan-end.
