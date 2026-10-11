---
issue: 2326
status: OPEN
owner: mimo/batch-remaining-clearance
---

# HANDOFF — 2026-10-11 batch remaining-issue clearance (2026-10-11 17:49Z, edge-dev/mimo)

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

### BLOCKING
- **#2290 ColdLion health-lane baseline (also blocks taxonomy activation):** Ilona Kereki + Laura Arevalo must confirm the production licensor/property list is correct (owner hold 2026-09-07/09-10; tracked on #1941). Until they answer, do **not** activate any taxonomy baseline and do **not** reset the breaker. **Recommendation:** Albert asks Ilona/Laura for the confirm on #1941; then a migration-author session can proceed.

### RECOVERABLE
- None pending from this session.

### NOT PART OF THIS WORK, AND NOBODY IS ON IT
- None discovered this session.

### Already settled — do NOT re-ask
- Never ask a human to approve technical actions (Albert, 2026-09-28). Allocator-assigned AI reviewer is the gate.
- Do not repoint `style_tracker_rows_with_bridge` before DesignFlow cutover (#770 / #1431).
- Do not activate taxonomy baseline without Ilona/Laura (2026-09-07/09-10 hold).

## 1. What this application is

`popcre/shared-db` — the shared Supabase database (structure, migrations, anti-collision, promotion) used by CRM, DAM, PM/PIM, and DesignFlow. GitHub: https://github.com/popcre/shared-db. Host machine for this session: **edge-dev** (Windows). Shared checkout: `C:/repos/shared-db` (do not edit in place; worktree-only).

## 2. What we set out to do this session, and why

Albert asked to resume the 2026-10-11 batch and clear remaining open issues (1275/2357/2204/2336/2110 already closed). Remaining: **#2326, #1431, #2290, #1403**. He directed the coordinator to spin up subagents (max two at once) to do the work. Goal: advance everything that is not externally blocked, and leave accurate status on what is.

## 3. Current state — what is true right now

Checked **2026-10-11 1:49 PM EDT** (17:49Z):

| Fact | Value |
|---|---|
| `origin/main` tip | `5c50ee4a9cb228f868a0322b7e7385b404832950` (merge of PR #4187) |
| Max migration version | `20261010033616` (drop frozen schema) |
| Next version below | `20261009224453` (hash-pinned licensing consolidation) |
| Host checkout branch | `mimo/2336-live-proof` (not this session's work; leave it) |

### Issue outcomes this session

| Issue | Outcome | Evidence |
|---|---|---|
| #2326 | **ADVANCED, still OPEN** — Step 3 residuals closed by source; PopDAM owns Steps 4–8 | PR #4187 merged; comment https://github.com/popcre/shared-db/issues/2326#issuecomment-6111852459 |
| #1403 | **ADVANCED, still OPEN** — 16 `objects:` issues migrated; Switch 2 census gate green; alias parser retirement remains | Comment https://github.com/popcre/shared-db/issues/1403#issuecomment-6111730710 |
| #1431 | **OPEN, blocked** — waits on #770 DesignFlow row copy | Comment https://github.com/popcre/shared-db/issues/1431#issuecomment-6111624838 |
| #2290 | **OPEN, blocked** — waits on Ilona/Laura (#1941) | Comment https://github.com/popcre/shared-db/issues/2290#issuecomment-6111625026 |

### PRs this session

- **#4187** merged `5c50ee4a9` — docs-only: Step 3 residual source reconciliation + plan STATUS update (branch `mimo/2326-step3-residual`).

### Preview / production

- **Nothing applied** to preview or production this session. Repo/docs and GitHub issue bodies only. No database writes.

### Batch context (from prior handoff)

Prior handoff `HANDOFF.d/2026-10-11T1705Z-edge-dev-mimo-nine-issues-clearance.md` (PR #4183) remains OPEN and is the record of the nine-issue batch plus promotions for #2110/#2336. Do not edit that file. Successor review candidate only when #2326 closes and that workstream is proven done.

## 4. Everything we tried that did NOT work

- **`ai-task-gates start --class repo-maintenance` / `documentation`** → `unknown change class`. Valid classes live in `C:\repos\ai-devops\config\task-gates.json`: prose, code, installation, reviewer-safety, ui-live-workflow, shared-db, deployment, infrastructure, production, private-evidence, private-tooling. Used `prose` for this session.
- **`ai-task-gates --help`** is not supported; use bare `ai-task-gates` for usage.
- **`gh search issues ... 'objects:'`** matches body prose mentioning the word, not the `db-work-scope` alias field. Real census must read open issue bodies for `(?m)^objects:` (general-2 finding).
- **Handoff count of 15 `objects:` issues was stale**; real count was 16 (7 claims + 9 work). Always re-census.

## 5. Root causes and key findings

- **`clear_style_group_batch` cannot rewrite unchanged rows by construction** — batch filter requires `style_group_id IS NOT NULL`, UPDATE sets NULL. popdam3#295's "skip unchanged writes" half is a no-op; only `cleared_count` volume measurement remains. Evidence: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261011T172423Z/step-3-residual-source-reconciliation.md
- **Matview reader lock-wait is a dead deployment shape** — both REFRESHes are CONCURRENTLY since #2212 (`20260905104802`). Do not spend time measuring exclusive-lock wait for matview readers.
- **Per-statement matview split already exists** via the #3458 step overload (`p_step in all|file_groups|folders|search`); only per-step timings are unmeasured.
- **Migrating claim `objects:` → `writes:` with the identical list is semantic-preserving** (`LEGACY_OBJECTS_MEANS_WRITES`); safe and unblocks Switch 2 without weakening write-locks.
- **Switch 1 was already enforced** (`mode: "enforced"` since 2026-09-07); no flip was needed. 15 open PRs still lack contract+completion pairs and are blocked at merge-queue admission (contract check runs on `merge_group`/`workflow_dispatch` only, #3536).
- **`docs/verification/main-required-status-checks.json` is intentionally stale** vs live branch protection (cut via #3774); do not treat as truth.
- **popdam3#294 app half landed today** (PR popdam3#325); DB half is shared-db #4174 (claim-first structural).

## 6. Exact next steps

1. **#1403 alias parser retirement** — open a code PR removing `objects:` from `parseQueueScope` / `parseClaimBlock` / `claimBody` once docs have used `writes:`/`reads:` for ≥14 days (already 49 d). Verify: queue audit reports `legacyObjects: 0` and no open issue body matches `^objects:`. Then consider closing #1403.
2. **#2326 Steps 4–8** — PopDAM sessions own application reductions: popdam3#293 (matview cadence), #294 (counts coalescing; DB half #4174), #295 (clear volume), #97 (hybrid search). Re-measure runtime items (write-side plans, WAL delta, per-step matview timings, `cleared_count` volume) before claiming Step 3 done. Verify: plan STATUS rows move only with openable evidence artifacts.
3. **#1431** — after #770 DesignFlow row copy into `dflow_prod`, repoint `public.style_tracker_rows_with_bridge` and update `dflow_prod_contract.sql`. Do **not** repoint early. Verify: view definition references `dflow_prod` only; contract SQL matches.
4. **#2290** — after Ilona/Laura confirm on #1941, a migration-author session authors a production-derived `baseline_key` as a governed migration; AI reviewer APPROVE for activation. Verify: health lane clean and original capability still works. Do **not** reset the breaker or activate baseline before the confirm.

## 7. Constraints and gotchas in force

- Claim-first structural work; no orchestrator marker. Scope is SHAPE (or curated Master Data), never proofs/docs/tooling.
- Worktree-only for edits. Host `C:/repos/shared-db` is landing/reading only. Do not clean another session's worktree.
- Never ask Albert to approve technical actions; allocator AI reviewer is the gate.
- Sign GitHub posts: `Posted by MiMo chat $MIMO_SESSION_ID on edge-dev`.
- Docs-only PRs: merge promptly via Documents-only path; never `--admin`; never Guarded Merge for prose.
- `db-work-scope` must use real fenced ` ```db-work-scope ` blocks (write via file).
- Do **not** repoint style_tracker before cutover; do **not** activate taxonomy baseline without Ilona/Laura.
- `git branch --merged` cannot see squash merges; ask GitHub (`gh pr view --json mergedAt`).
- Scope freeze after wrap-up: no new work; deferred items live in this file.

## 8. Access and environment

- Machine: **edge-dev** (Windows). Host shared checkout: `C:/repos/shared-db` (pre-existing untracked `.ai/scratch-2110/`, `.ai/tmp-3536-*`, `.ai/tmp-3999-body.txt` — leave them; not this session's).
- Supabase Management API reads work via 1Password `op://vibe_coding/Supabase CLI Personal Access Token` when psql pooler fails (not used this session).
- `SHARED_DB_AUTHOR_ENGINE=zcode` for MiMo reviewer draws.
- Qwen needs credits (insufficient_quota historically); StepFun Windows shell spawn is broken (reviewer issue `20261011T170320Z-edge-dev-stepfun-2035063`).
- ai-task-gates classes: see §4. This session declared `prose`.

## 9. Open questions and risks

- #2290 cannot proceed without Ilona/Laura (business) — listed in §0 BLOCKING.
- Main moves frequently under promotion; always freeze or re-pin SHA if promoting.
- Peanuts lifecycle production apply still open on #3684 (from #1275 closeout, not this session).
- 15 open PRs without contract pairs will fail at merge-queue admission until they supply pairs or are grandfathered (Switch 1 is already enforced).

---

## Sub-agent work (separated)

### Agent: general-1 (2326 efficiency program)
- **Asked to do:** Advance #2326 from shared-db; check PopDAM #293–#295; close Step 3 residuals if source-provable; post status; optional docs-only PR.
- **Actually did:** Closed two Step 3 residuals by source (no-op clear semantics; matview lock-wait retired); confirmed PopDAM ownership table; merged docs-only PR #4187 (`5c50ee4a9`); posted #2326 comment. Files: plan STATUS + `docs/verification/database-efficiency/20261011T172423Z/step-3-residual-source-reconciliation.md`.
- **Found:** popdam3#294 app half landed (PR #325); DB half is #4174. Runtime measurements still open.
- **PR / branch:** #4187 merged, branch `mimo/2326-step3-residual`.
- **Worktree:** `.ai/worktrees/2326-step3-residual` — finished (safe to clean after this handoff merges).
- **Deliberately did NOT do:** Steps 4–8 application reductions (PopDAM-owned); no DB writes.

### Agent: general-2 (1403 objects: alias gates)
- **Asked to do:** Re-audit #1403 gates; migrate open `objects:` issues; post census; do not retire alias early.
- **Actually did:** Migrated 16 open issues (7 claims `objects:`→`writes:`, 9 work issues empty `objects:`→`writes:`+`reads:`); posted census comment on #1403. Switch 1 found already enforced. Switch 2 census gate now MET.
- **Found:** stale handoff count (15 vs 16); `--audit` cannot census `objects:`; contract check only on merge_group/workflow_dispatch.
- **PR / branch:** none (issue-body edits only).
- **Worktree:** none created.
- **Deliberately did NOT do:** alias parser retirement (code change, needs its own worktree+PR+review); did not close #1403.

### Coordinator (this session, parent)
- **Asked to do:** Coordinate remaining batch; max two subagents; post blocked status on #1431/#2290.
- **Actually did:** Declared `prose` task class; posted status comments on #1431 and #2290; spawned general-1 and general-2; wrote this handoff.
- **PR / branch:** this handoff PR only.
- **Deliberately did NOT do:** did not close any remaining issue; did not touch DB; did not clean other sessions' worktrees.

---

## Self-audit gate (preserved)

1. **Street-newcomer continue without questions?** Yes — §1–§9 name repo, state, evidence URLs, exact next steps, constraints.
2. **As effectively as I can?** Yes — PopDAM ownership, census results, dead ends, and stale-fact warnings are all recorded.
3. **Failed attempts included?** Yes — §4 (task-gates class names, gh search false positives, stale count).
4. **Next steps concrete with verification?** Yes — §6 each step has a verify line.
5. **Terms/paths explained?** Yes — §1, §7, §8; GitHub URLs for evidence.
6. **File/commit refs as GitHub URLs?** Yes for durable evidence; local worktree paths are environment facts in §8.
7. **Section-0 sweep run?** Yes — BLOCKING is only Ilona/Laura (#2290/#1941). Technical items (alias parser PR, PopDAM steps) are tracked work, not owner approvals.

Synthesis:
1. **Comprehensive for a brand-new developer?** Yes — §0–§9 + per-agent blocks + next-session prompt in closing report.
2. **Detailed enough to continue as well as I can?** Yes.
3. **Every relevant detail present?** Yes — background, goals, state, failures, decisions, constraints, risks, next actions, verification.
4. **If Albert read only §0, would he see every business decision?** Yes — only the Ilona/Laura confirm is blocking; no technical approvals listed.

**Self-audit: PASS.**
