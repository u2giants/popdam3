---
issue: 3306
status: OPEN
owner: claude/mimo-workflow-refactor-20260923
---

# Workflow-refactor closeout — unfinished landing queue

## 1. What we were doing and why

Albert asked to pull latest and complete
`HANDOFF.d/2026-09-22T2033Z-916-codex-workflow-refactor-closeout.md`
(the interrupted workflow-refactor implementation). He later said
"spin up a subagent to takeover PR 3279" and "proceed until this entire task is
100% complete". Tracker is issue #3306 (non-orchestrator repository maintenance).

This session is a **repository-maintenance session**, NOT the structural
orchestrator. Open orchestrator marker #3480 (`shared-db.orch edge-dev
mimo-queue`) belongs to another session — do not close it.

## 2. What we actually did (merged)

| PR | Outcome | Merge SHA |
|---|---|---|
| 3410 | #2758 merge-lane independent-main tip fix | `3a607c866` |
| 3363 | Step 1 evidence exclusions / canonical IDs | `6c687b70b` |
| 3386 | Step 1 scoped merged-PR evidence reader | `d7b3cad4c` |
| 3414 | Merged-PR prior-head approval vs merge parent | `d0f49c965` |
| 3430 | 3279 takeover: queue interlock through mutation | `5653b760e` |
| 3374 | Step 2 per-source throughput dispositions | `35a297190` |

Sub-agent `general-1` delivered the 3279 takeover (PR 3430). Sub-agent
`general-2` built PRs 3445 (#3380), 3447 (#3397), 3448 (plan STATUS).

**Also changed (settings, not code):** `required_status_checks.strict` on `main`
was observed **true** on 2026-09-24, contradicting owner ruling #1286 (strict is
FALSE on purpose). It was set back to **false** via the branch-protection API.
If strict is true again, that is drift — do not "fix" it by turning strict on.

## 3. Preview / production

Nothing. No migration, preview write, or production write was performed by this
session. No queue activation.

## 4. Half-finished / abandoned mid-way

- **PR 3366** (`codex/workflow-completion-stages-0920`): refreshed onto main
  (`35a297190`), evidence rebound at head `00b7da0f9`. Last CI still showed
  `Migration author lease`, `Tools offline tests`, and `Queue-sensitive checks`
  failures after the `files_changed` fix. Needs a green run and then guarded merge.
- **PR 3395**: conflict with main resolved and pushed at `0c8aae068` (16/16
  probe tests). Needs refresh confirmation, exact-head review, and merge.
- **PRs 3379, 3369, 3368**: reported APPROVE-ready by `general-2` before the
  strict-mode fix. Re-verify exact-head approval and CI, then merge serially.

## 5. What we own right now

- Branch `codex/workflow-completion-stages-0920` / worktree
  `C:/repos/shared-db-wt-3366` — 3366 refresh, last pushed `00b7da0f9`.
- Branch `codex/probe-lexer-repair-0920` / worktree `C:/repos/shared-db-wt-3395`
  — conflict resolution, last pushed `0c8aae068`.
- Other worktrees from this session (`C:/repos/shared-db-wt-3363-refresh`,
  `C:/repos/shared-db-wt-3386`, `C:/repos/shared-db-wt-3374`,
  `C:/repos/shared-db-wt-3279-takeover`, `C:/repos/shared-db-wt-2758-merge-freshness`,
  `C:/repos/shared-db-wt-3414`, `C:/repos/shared-db-3380-immutable-generations`)
  may be clean/merged; verify with `cleanup-worktree` before removing.
- Open PRs still needing work: **3445, 3447, 3448, 3371, 3394, 3390, 3396, 3366,
  3368, 3369, 3379, 3395** (see §7).

## 6. What we were about to do next

1. Get 3366 CI green and dispatch `guarded-migration-merge`.
2. Re-verify and merge 3379, 3369, 3368 (already had durable APPROVEs).
3. Land 3395 after review.
4. Fresh exact-head reviews for 3445, 3447, 3448, 3371, 3394, 3390, 3396.
5. Update `plan_shared_db_workflow_refactor.md` STATUS and close #3306 only
   after every step has an accepted artifact.

## 7. Blocked on

- **CI flakiness** on `Migration author lease` / `Tools offline tests` /
  `Queue-sensitive checks` for 3366 — re-run or fix; last error shape was
  `files_changed does not match Git` which was addressed at `00b7da0f9` but the
  run had not re-greened at wrap-up.
- **Reviewer capacity/timeouts**: Muse/Grok/Gemini often time out or fail with
  unrecognized wrapper stderr. Gemini was live-qualified this session
  (`ai-review-preflight qualify gemini`). Use `AI_MUSE_CALLER=claude` /
  `AI_GROK_CALLER=claude` / `AI_GEMINI_CALLER=claude`. Do **not** put a literal
  `VERDICT: APPROVE <sha>` example line in a review brief — Muse echoes it and
  the runner refuses multiple verdict lines.
- **assign-reviewer sometimes hangs** (5-minute tool timeout, no output).
  Retry; if stuck, `--replace-failed-reviewer` with a `--failed-sequence`.

## 8. What we tried that did NOT work (MANDATORY)

- **GHCR / apt rate limits** on ephemeral DB tests blocked every merge for hours
  (`toomanyrequests` pulling `ghcr.io/supabase/postgres`, apt mirror stall).
  Recovered later. Albert asked to route to ENVY then Blacksmith if needed;
  ENVY is `EDGE-RUNN-ENVY` (self-hosted Windows) and Blacksmith labels are
  `blacksmith-4vcpu-ubuntu-2404` / `blacksmith-4vcpu-windows-2025`. A later PR
  3466 already moved workflows onto Blacksmith.
- **`required_status_checks.strict: true`** made every merge refuse with
  "the head branch is not up to date with the base branch" even when the
  independent-main rule (#2758) would allow it. Fixed by setting strict back to
  false (owner ruling).
- **Bulk-regenerating throughput dispositions** destroyed historical identities
  and failed `context migration preserves every historical identity hash verdict
  and reason`. Correct approach: keep `HISTORICAL_AUDIT` entries exactly
  (match via `legacy_semantic_key`, same disposition and reason), only add new
  discovered sites.
- **Parallel `gh workflow run` / tool calls** caused duplicate merge dispatches
  and cancelled siblings. One mutation at a time.
- **Review briefs with a literal VERDICT line** made Muse refuse
  ("wrapper did not produce a recordable terminal verdict").
- **`--assign-reviewer` after an amend** does not carry approval forward —
  "this head has reviewer records of its own". A new head needs a new assignment
  and a fresh exact-head review.

## 9. Facts that may already be stale

- `main` tip at wrap-up check **2026-09-25T02:17Z**: `cb953a0151ce348b40fcdce5793725fccdf5ecfb`.
- Maximum migration version: not re-read at wrap-up; re-derive from
  `supabase/migrations/`.
- Exact-head approval status for 3379/3369/3368 was reported by sub-agent
  `general-2` earlier on 2026-09-23/24 — **re-verify before merge**.
- Orchestrator marker #3480 was open at wrap-up (other session).
- Untracked junk in the shared checkout (`.ai/queue-audit-*.txt`, `.tmp-*.md`,
  `.ai-devops/`, `.codex/`, `.ai/bin/`) predates or is unrelated to this
  workstream — leave it; do not `git clean`.

## Sub-agent blocks

### Agent: general-1 (3279 takeover)
- Asked to: take over PR 3279 and fix the queue interlock race.
- Actually did: PR **3430** merged `5653b760e`. Interlock now re-checks under
  the merge lane and holds it through the mutation. Status-reader class
  converted to paginated `/statuses` + newest-by-timestamp.
- Found: `completion.pr` was 3420 after supersession; fixed to 3430.
- Worktree: `C:/repos/shared-db-wt-3279-takeover` (branch `claude/3279-takeover-clean`).
- Deliberately did NOT: activate the merge queue.

### Agent: general-2 (remaining landing)
- Asked to: land remaining workflow-refactor PRs.
- Actually did: opened **3445** (#3380 lineage), **3447** (#3397 recovery),
  **3448** (plan STATUS). Left 3374/3366/3379/3369/3395/3368 APPROVE-ready
  or refreshed.
- Found: GHCR rate limit blocked every merge at that time; `plan_*.md` is
  rulebook so no admin-merge shortcut.
- Deliberately did NOT: close #3306 (plan not 100% complete).
