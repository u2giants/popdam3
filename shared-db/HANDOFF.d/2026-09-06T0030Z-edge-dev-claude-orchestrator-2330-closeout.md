---
issue: 2400
status: OPEN
owner: claude/shared-db-orchestrator-8ca8f3
---

# Orchestrator closeout — marker #2330 (shared-db.orch local priority-blockers)

Written 2026-09-06T00:30Z. Every SHA, version and PR state below was re-derived
from `git fetch origin main` and `gh` at that time.

## 1. What this session was doing, and why

Albert's standing instruction: report which five issues block the most others,
treat #2202, #2212, #2213, #2214, #2215, #2203, #2204 as high priority, and
"start with 2202 and don't stop until they are all complete through to
production, always making sure you are engaging as many concurrent agents as
possible."

Scope was strictly database STRUCTURE. Non-structural blockers were forked to
separate sessions or filed as issues, never worked in this context.

## 2. What was actually done

`origin/main` tip at close: `22b6c2341169819491af8a18961b13bc4afb7b09`
Highest migration version on main: `20260905143005`

All seven priority issues are CLOSED. The three this session personally drove
from authoring through review, merge, preview rehearsal and production apply:

| Issue | PR | Migration version | Merge commit | Reviewer verdict |
|---|---|---|---|---|
| #2174 | 2398 | `20260905142150` | `103ee42546b1b0162139626c0d7f223352c852cb` | muse-spark-1.2-contributor APPROVE (seq 1455), after grok-4.6 REVISE (seq 1453) |
| #2214 | 2397 | `20260905142725` | `da2335d6603a41e36119113b128a5a3323a134cd` | grok-4.6 APPROVE (seq 1457) |
| #2213 | 2399 | `20260905143005` | `22b6c2341169819491af8a18961b13bc4afb7b09` | glm-5.3 APPROVE (seq 1458) |

Merge order was forced ASCENDING BY RESERVED VERSION, not by approval order.
#2397 was approved first but had to merge second, because Guard B refuses a
branch whose reserved version sorts before main's newest. Merging #2397 first
would have stranded #2398 permanently.

The #2398 review returned REVISE with four real findings, all fixed before merge:

1. **(High, blocking)** `coldlion.prod_history_component.prepack_item_no` was
   NOT NULL, so genuine non-prepack `/prodHistory` rows (empty `prepackItemNo`,
   `subItemNo` still present) could never be stored. Made nullable, blank-string
   refusal re-scoped to `prepack_item_no is null or length(btrim(...)) > 0`. The
   unique index already used `NULLS NOT DISTINCT` and already included
   `sub_item_no`, so it needed no change.
2. **(Medium)** The emptiness refusal guard took only `AccessShareLock`, so a
   `service_role` writer could INSERT and commit between the `exists` check and
   `DROP TABLE`. Fixed with `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`, re-check,
   then DROP inside the same `DO` block with the lock held.
3. **(Medium)** Contract tests could not have caught finding 1 — every component
   insert used a non-blank prepack. Added NULL-prepack store case, blank-prepack
   refusal case, `company_code` NOT NULL and `prepack_item_no` nullability
   catalog assertions, and an `is_backfill_baseline` fixture.
4. **(Low)** Comments claimed the retention guard protects the backfill baseline
   but the code only protected it incidentally via the keep-newest-three floor.
   Enforced rather than softened: the guard now refuses outright when
   `old.is_backfill_baseline`, proven on a four-version partition.

## 3. Preview and production

**All three migrations are applied to BOTH preview and production.** Nothing is
half-applied. No data rows were written to preview by this session — migrations
only.

| Version | Preview apply run | Review-evidence run | Production apply run |
|---|---|---|---|
| `20260905142150` | 33977343140 | 33977783079 | 33977917094 |
| `20260905142725` | 33977493283 | 33978048442 | 33978092534 |
| `20260905143005` | 33977659389 | 33978243638 | 33978256772 |

All nine runs are `completed success`. Preview project ref `mvpkijzfmfcxhnzqogzs`,
production `qsllyeztdwjgirsysgai`.

## 4. Half-finished or abandoned

Nothing. Every migration this session touched reached production.

## 5. What this session owns

- Orchestrator worktree `C:/repos/shared-db/.claude/worktrees/shared-db-orchestrator-8ca8f3`
  — this handover PR only; safe to clean after merge.
- `C:/repos/shared-db-wt-2174`, `-wt-2213`, `-wt-2214` — all three PRs MERGED.
  **Safe to retire.**
- Review clones `C:/repos/rev2397`, `C:/repos/rev2398`, `C:/repos/rev2399` —
  throwaway detached clones used only to run reviewers at the exact PR head.
  **Safe to delete.**
- All eight author lanes are FREE. Claims #2394, #2395, #2396 released.
- No open PR is owned by this session except the docs-only handover PR.

## 6. What was next

Nothing in the priority set. `--queue-audit` reports `emptyLanes: 8` and
`dispatchable: []` — no eligible structural work is waiting. The next
orchestrator's first act should be to re-run `--queue-audit`, not to assume this.

## 7. Blocked on

Only owner decisions — see section 10.

## 8. What was tried that did NOT work [MANDATORY]

- **`-f source_pr=2398` on a post-merge preview rehearsal is the wrong input.**
  The correct one is `merged_preview_source_pr`. Run 33977330247 was dispatched
  with the wrong key and cancelled.
- **Production apply refuses without preview evidence, and the error names the
  wrong cause.** Run 33977807550 failed with a message about
  `PREVIEW_PROJECT_REF is not set`. That variable IS set
  (`mvpkijzfmfcxhnzqogzs`, since 2026-08-18). The actual failing assertion was
  `test -n "$PREVIEW_RUN_ID"` immediately above it — the echo line is script
  text, not the diagnosis. Production apply requires BOTH `preview_run_id` and
  `preview_artifact_digest` in addition to `review_run_id` /
  `review_artifact_digest`. Do not chase the variable.
- **Never retype a 40-character SHA by hand.** Three dispatches (33978067742,
  33978069242, 33978078786) were fired with corrupted `commit_sha` values and had
  to be cancelled. Always `MAIN=$(git rev-parse origin/main)` and interpolate.
- **Artifact digests must be canonical `sha256:<64 lowercase hex>`.** A bare hex
  digest fails production apply.
- **`git branch -f main <sha>` fails while `main` is checked out.** Detach first.
- **The shared checkout's local `main` was stale** at
  `9cf554c182afeb80c857aa9d819b832e017f8df4`. Every review clone had to have
  `main` force-set to the real tip, or the reviewer diffs main's newer commits
  as deletions.
- **`codex-gpt-5.6-sol` returned no recordable terminal verdict twice**
  (seq 1452 on PR #2398, seq 1456 on PR #2397) — the known broken read-only
  sandbox, `popcre/ai-devops#290`. It was run honestly each time rather than
  skipped on reputation, then replaced with
  `--failure-code reviewer_cannot_read_repository`. Replacement is idempotent per
  failed sequence.
- **Two ephemeral-DB NOT NULL failures were investigated, not patched.**
  `sync_run.requested_by` and `prod_history_line.company_code` constraints were
  both correct and pre-existing; the FIXTURES were stale and one whole test block
  was still written against a retired table shape. `requested_by` has been NOT
  NULL since 2026-08-18 with 26 compliant writers and 0 production rows;
  `company_code` is 100% filled on `/prodHistory` — the blank-companyCode problem
  is specific to `/inventory`.
- **A new production-verification sidecar must ALSO be registered in the
  `PREVIEW_PRODUCER_PATHS` tuple** in `scripts/production_business_risk_gate.py`
  (~line 1864), or `test_preview_producer_paths_cover_the_whole_executed_closure`
  fails.
- **`--expand-active-claim-from-pr` requires all seven of** `--issue`,
  `--claim-number`, `--pr`, `--owner`, `--branch`, `--worktree`, `--head-sha`;
  it derives the uncovered object set from the PR itself and refuses if there is
  nothing to add.
- **`run-governed-review.mjs` does NOT derive `--reviewer`, `--wrapper` or
  `--worktree`** from the assignment. Omitting them gives
  `REFUSED: reviewer preflight requires an approved reviewer and its exact wrapper`.

## 9. Facts that may already be stale

Everything below was checked at 2026-09-06T00:28Z and can move within the hour:
the `main` tip, the maximum migration version, every PR state, the worktree
list, and the `--queue-audit` result. Re-derive from `git`/`gh` before acting.

The 1Password MCP was DOWN all session (`CONNECTION_CLOSED`). The `op` CLI
worked. That may or may not still be true.

## 10. Owner decisions outstanding

- **#2317** — DesignFlow HTS acceptance. REJECT with NO RETURN ADDRESS. Needs
  `return_to: owner/repo` before it can be forwarded.
- **#2178** — ColdLion `/pickticket`. REJECT with NO RETURN ADDRESS. Same. The
  drafted vendor report is also still unsent.
- **#2284** — exposed DesignFlow and NAS MCP proxy credentials.
- **#2389** — stale preview credential rotation.
- **#2290** — RETURN-TO-OWNER, breaker reset.

`--queue-audit` exits 2 until #2317 and #2178 each carry a return address.

## 11. Deliberately left alone

- **~100 worktrees across the machine.** They belong to other sessions and to
  predecessors. `scripts/reap-merged-worktrees.mjs` refuses to run while any
  `orchestrator-marker` issue is open, which was correct for the whole session.
  This is a decision, not an oversight. It is filed as its own issue.
- **Six stale `HANDOFF.d/` files** whose issues are CLOSED. They are not this
  session's workstreams, so they were reported rather than deleted:
  - `2026-09-03T1750Z-edge-dev-claude-orchestrator-2193-closeout.md` (issue 2218) — owner `claude/shared-db-orchestrator-4d089e`
  - `2026-09-04T0030Z-edge-dev-claude-orchestrator-2224-closeout.md` (issue 2247) — owner `claude/orchestrator-2224-closeout`
  - `2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md` (issue 2267) — owner `codex/orchestrator-2249-handoff`
  - `2026-09-04T1103Z-edge-dev-codex-priority-orchestrator-2269-closeout.md` (issue 2283) — owner `successor-orchestrator`
  - `2026-09-04T1108Z-edge-dev-codex-post-cutover-closeout.md` (issue 2267) — owner `codex/01a069d8-...`
  - `2026-09-04T1625Z-edge-dev-2-claude-orch-2297-closeout.md` (issue 2297) — owner `claude/handover-orch-2297-closeout`
- **Open PRs #2278, #2264, #2260, #2205 and drafts #2245, #2237** — all
  `route: repo-maintenance`. NOT orchestrator work; a separate repo session owns
  them. Not touched, not dispatched.
- **`popcre/designflow-tracking` PR #38** — DesignFlow goes to `develop` and is
  never self-merged. It needs Albert's own merge.

## 12. Secrets sweep

Swept. Nothing new. The Supabase access token was read from 1Password through a
pipe into an environment variable and never appeared in chat, arguments, logs or
commits. No credential was created or changed this session.

## 13. Documentation pass

Nothing outside this handover is stale. No standing fact in `AGENTS.md` was
disproved. No rehearsal or evidence artifact was voided — all three migrations
were rehearsed on preview from merged `main` and then promoted, in that order.

## 14. Successor

None lined up. The marker is closed and the board left empty deliberately, so
`check-orchestrator-marker.mjs --resolve` reports "no active orchestrator" and
other sessions queue their work rather than delegating to a dead address.
