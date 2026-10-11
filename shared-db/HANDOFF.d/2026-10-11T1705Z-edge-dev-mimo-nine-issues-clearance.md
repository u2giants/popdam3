---
issue: 2326
status: OPEN
owner: mimo/nine-issues-20261011
---

# Nine-issue clearance batch + promotions (2026-10-11)

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

- **#2290 ColdLion health-lane baseline:** Ilona Kereki + Laura Arevalo must confirm the production licensor/property list is correct (owner hold 2026-09-07/09-10; #1941 ColdLion reconciliation half still open). Until they answer, do not activate any taxonomy baseline and do not reset the breaker.
- No other owner decision is pending from this session.

## 1. What this application is

`popcre/shared-db` — the shared Supabase database (structure, migrations, anti-collision, promotion) used by CRM, DAM, PM/PIM, and DesignFlow.

## 2. What we set out to do this session, and why

Albert asked to pull latest `main` and clear GitHub issues **1431, 1403, 1275, 2357, 2336, 2326, 2290, 2204, 2110** one at a time via individual subagents, without parallelizing.

Later he asked whether waiting items were being actively cleared; we then finished production promotion + live proof for #2110 and #2336.

## 3. Current state — what is true right now

Checked **2026-10-11 1:05 PM EDT** (17:05Z):

| Fact | Value |
|---|---|
| `origin/main` tip | `9c69796e58c128dd79f9e1f2b65dde270dead1ba` (merge of PR #4169) |
| Max migration version | `20261010033616` (drop frozen schema) |
| Next version below | `20261009224453` (hash-pinned licensing consolidation) |

### Issue outcomes (this batch)

| Issue | Outcome | Evidence |
|---|---|---|
| #1275 | **CLOSED** — lifecycle already live across five licensor families | comment + close |
| #2357 | **CLOSED** — APIs already shipped | PR #2835, live proof 37999963931 |
| #2204 | **CLOSED** — notification contract already live | PR #2386 / `20260905072856` |
| #2336 | **CLOSED** — implemented, promoted, proved | PR #4153 → apply 38152128943 → live proof 38157558630 |
| #2110 | **CLOSED** — drop migrated, promoted, proved | PR #4156 → apply 38148868512 → live proof 38149261740 |
| #2326 | **OPEN** — Steps 1+partial 3 landed | PR #4154; Steps 4–8 remain (PopDAM #293–#295) |
| #1431 | **OPEN** — blocked on cutover | `dflow_prod` empty; waits on #770 row copy |
| #1403 | **OPEN** — Switch 2 unmet | 15 open issues still use `objects:` |
| #2290 | **OPEN** — blocked on Ilona/Laura + migration author | no active taxonomy baseline |

### PRs this session

- **#4153** merged `73720713` — hash-pinned licensing consolidation (`20261009224453`)
- **#4154** merged `e0c942b8` — efficiency/API security program docs (Steps 1+3)
- **#4156** merged `01b08a85` — drop `designflow_frozen_20260710` (`20261010033616`)
- **#4169** merged `9c69796e5` — live proof probe `.github/live-proofs/2336.sql` (issue #4173)

### Preview / production

- Preview: both `20261009224453` and `20261010033616` applied (historical-recovery runs 38147738877, 38140871380).
- Production: both applied and live-proved (see table above). No other DB writes this session.

## 4. Everything we tried that did NOT work

**Promotion / evidence race (burned many runs):**
- Merged-preview apply without `preview_allowlist` → refused empty allowlist. Always pass exact 14-digit versions.
- Re-dispatching preview when the version was already applied → `BLOCKED: already applied on preview`. Use **historical-recovery** lane: `historical_preview_source_pr` + `historical_preview_original_run_map=version:runId`.
- Production apply after a non-inert `main` change (e.g. `production_migration_guard.py`) → preview evidence stale. Gate requires preview checkout whose guard script matches **exact current main**.
- Production-risk APPROVEs naming an older main SHA → refused. Risk assessment must name the **exact promoted main SHA**. Use `--acquire-promotion-freeze` so main cannot move under you.
- Auto-merge alone never posts `Migration guarded merge authorization`. Must dispatch **Guarded Merge** workflow (`pull_request`, `head_sha`).

**PR #4169 probe merge (many refusals):**
- No `Closes #<issue>` → "must close exactly one work issue".
- Closing a **structural** issue (#2336) from a maintenance PR → "not deterministic ready repository-maintenance". Needed a **separate repo-maintenance issue** (#4173).
- `change_type: live-proof` invalid. Allowed: `documentation`, `ci`, `reviewer-tooling`, `workflow`, `repo-maintenance`.
- `db-work-scope` fences mangled by shell backticks → parser found no scope. Use a body file (`--body-file`).
- Self-held `promotion-freeze` blocked Guarded Merge. Release before merging.
- StepFun review: shell dead on Windows (`NotFound: ChildProcess.spawn`), zero bytes inspected, REVISE. Logged as reviewer issue `20261011T170320Z-edge-dev-stepfun-2035063`.
- Qwen 3.8 Max: exit 4 `insufficient_quota` (needs credits at Alibaba Model Studio). Rotate away; do not retry.
- Muse findings with a decision line besides the terminal VERDICT → runner voided the verdict. Keep findings free of extra REVISE/APPROVE words.
- First 2336 live-proof probe had real bugs: `tgisenabled` (column is `tgenabled`), inverted EXECUTE grants (functions are **service_role only**). DeepSeek APPROVED the fix.

**Reviewer tooling:**
- `run-governed-review.mjs` needs `--wrapper`, `--worktree`, and for DeepSeek `-- send "<prompt>" --review`. `ai-stepfun` is not in VERDICT_CONTRACT_FLAG_WRAPPERS.
- `SHARED_DB_AUTHOR_ENGINE=zcode` required for MiMo sessions when assigning reviewers.

## 5. Root causes and key findings

- Live-proof SQL must be a **single statement** ending `as passed`. Trigger checks use `NOT tgisinternal AND tgenabled = 'O'` (never `tgisenabled`).
- `plm.plan_licensing_consolidation` / `plm.apply_licensing_consolidation` are **service_role EXECUTE only**; authenticated/anon must not execute.
- Production apply of a DROP is high-risk and needs a durable `production-risk-assessment` block on an exact-head APPROVE naming the promoted main SHA.
- `git branch --merged` cannot see squash merges; ask GitHub (`gh pr view --json mergedAt`).

## 6. Exact next steps

1. **#1431** — wait for #770 DesignFlow row copy into `dflow_prod`; then repoint `public.style_tracker_rows_with_bridge` and update `dflow_prod_contract.sql`. Do not repoint early.
2. **#2290** — Albert: get Ilona/Laura confirm on licensor list (#1941). Then a migration-author session authors a production-derived `baseline_key` as a governed migration; AI reviewer APPROVE for activation.
3. **#2326** — PopDAM sessions own Steps 4–8 (`u2giants/popdam3` #293, #294, #295; embedding is popdam3#97). Re-measure before starting Step 5.
4. **#1403** — Switch 2 unblocks only when the 15 open `objects:` issues close or migrate to `writes:`/`reads:`.
5. Reviewer issue `20261011T170320Z-edge-dev-stepfun-2035063` — maintenance when someone repairs Windows shell spawn for StepFun.

## 7. Constraints and gotchas in force

- Claim-first structural work; no orchestrator marker.
- Worktree-only for edits. Do not clean another session's worktree.
- Never ask Albert to approve technical actions; allocator AI reviewer is the gate.
- Sign GitHub posts: `Posted by MiMo chat $MIMO_SESSION_ID on this machine`.
- Docs-only PRs: merge promptly via Documents-only path; never `--admin`; never Guarded Merge for prose.
- `db-work-scope` must use real fenced ` ```db-work-scope ` blocks (write via file).

## 8. Access and environment

- Machine: **edge-dev** (Windows). Host shared checkout: `C:/repos/shared-db` (has many pre-existing untracked files — leave them).
- Supabase Management API reads work via 1Password `op://vibe_coding/Supabase CLI Personal Access Token` when psql pooler fails.
- Qwen needs credits; StepFun shell is broken on this host (see reviewer issue).
- `SHARED_DB_AUTHOR_ENGINE=zcode` for reviewer draws.

## 9. Open questions and risks

- #2290 cannot proceed without Ilona/Laura (business).
- Main moves frequently under promotion; always freeze or re-pin SHA.
- Peanuts lifecycle production apply still open on #3684 (from #1275 closeout, not this session's work).

## Sub-agent work (separated)

### Agent: general-1..general-9 (serial issue clearance)
- **Asked to do:** clear one GitHub issue each, serially.
- **Actually did:** closed 1275/2357/2204; landed 2336/2110/2326 PRs; status comments on 1431/1403/2290.
- **PR / branch:** #4153, #4154, #4156 (merged).
- **Worktree:** finished (safe to clean for 2110-drop-mi5e3a, 2336-consolidation after PR-merge check).
- **Deliberately did NOT do:** no production apply (done later); no new tickets for live proof (used same issue / #4173).

### Agent: general-10 (promotions + live proof)
- **Asked to do:** risk-assess and promote 2110 then 2336; live proof; close.
- **Actually did:** risk assessments (Muse/Grok/DeepSeek); production applies 38148868512 + 38152128943; live proofs green; both issues closed. PR #4169 for missing 2336 probe.
- **Found:** promotion SHA-pinning race; Qwen quota; StepFun shell death.
- **Worktree:** finished for consolidation work; 2336-lp2 holds merged probe branch.
- **Deliberately did NOT do:** did not start 1431/2290/2326 remaining work (externally blocked).
