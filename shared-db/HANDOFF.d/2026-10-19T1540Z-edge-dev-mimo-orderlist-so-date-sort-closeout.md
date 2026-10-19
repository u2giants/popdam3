---
issue: 4336
status: OPEN
owner: MiMo chat ses_ffe5eaf8f125dffeE9Y9GlP9JY on edge-dev
---

# OrderList SO Date sorting — parked source, app mapping ready, review recording blocked

> **SUPERSESSION, 2026-10-19 (this session, after wrap-up re-check).** A Claude session landed the companion work. **Do not follow section 6 step 1 as written.** Corrections:
> - **Live already:** `sales_order_received_date` and `order_window_date` on `api.dam_order_list` — https://github.com/popcre/shared-db/pull/4485 merged, migration `20261019113819`, production run `39292906357`.
> - **Live already:** PopDAM 12-month window / Show old — https://github.com/u2giants/popdam3/pull/417 merged.
> - **Obsolete:** reopening https://github.com/popcre/shared-db/pull/4489 or reusing version `20261019140024`. The live view column is already shipped; that parked PR is not the path.
> - **Still open (correct path):** https://github.com/popcre/shared-db/pull/4499 (claim #4498 / version `20261019183716`) only replaces `public.find_dam_order_list_row` for sort-only SO Date in Find. Then finish app sort mapping in https://github.com/u2giants/popdam3/pull/438 (main still has no `sortField`). Then live proof on https://github.com/popcre/shared-db/issues/4336.

## 0. Business decisions only the owner can make

None. Albert asked for SO Date sorting on OrderList and told this chat to finish it. He also said "keep both" (SO Date sort and the 12-month Show old window) and "take off the database lock". The Find correction is already live and must not be redone. Never ask Albert for technical approval.

## 1. What this application is

PopDAM is POP Creations' artwork library with an OrderList for production orders. React/Vite frontend at https://github.com/u2giants/popdam3 (production https://dam.designflow.app and https://sg.designflow.app). Shared PostgreSQL structure lives in https://github.com/popcre/shared-db. Production project is Virginia `qsllyeztdwjgirsysgai`. Read https://github.com/u2giants/popdam3/blob/main/AGENTS.md, https://github.com/u2giants/popdam3/blob/main/docs/ORDER_LIST.md, and https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md before resuming.

## 2. Goal and reason

Let an ordinary user click SO Date to sort the entire matching OrderList, ascending and descending, missing dates last, stable ties, with Find using the same order beyond the first loaded block. The displayed virtual date had no server-side sortable field. Do not rewrite existing order dates to fake sorting. The 12-month window date (`order_window_date`) is a separate companion change (PopDAM #417) and is not this delivery.

## 3. Current state and coordination

### Backend source (parked)

- Branch: `codex/4336-orderlist-so-date-sort`
- PR: https://github.com/popcre/shared-db/pull/4489 (CLOSED/parked; reopen and resume)
- Head: `af65855d32db99e28d5d25e0a8c4b9179b946a87`
- Claim #4488 (CLOSED, released with `--park`) reserved version **`20261019140024`** permanently.
- Migration: https://github.com/popcre/shared-db/blob/codex/4336-orderlist-so-date-sort/supabase/migrations/20261019140024_orderlist_so_date_sort.sql
- SQL body is the recovered `f52ccad` implementation (header names claim #4488 / version `20261019140024`).
- Sidecar: https://github.com/popcre/shared-db/blob/codex/4336-orderlist-so-date-sort/scripts/production-verification-sidecars/20261019140024.json
- SQL test: https://github.com/popcre/shared-db/blob/codex/4336-orderlist-so-date-sort/supabase/tests/dam_order_list_sales_order_date_sort.sql
- Find harness: https://github.com/popcre/shared-db/blob/codex/4336-orderlist-so-date-sort/scripts/test_order_list_find_position.py
- Evidence generation **16** (parent gen 12) at `refs/db-contracts/4336/16`. Do not reuse gens 13–15; those belong to the foreign window-date session.

### App mapping (draft, blocked on backend production)

- PR: https://github.com/u2giants/popdam3/pull/438 (DRAFT)
- Branch: `mimo/4336-so-date-sort`
- Maps UI `sales_order_date` to server `sales_order_received_date` for sorting only. Filters/edit stay disabled. Unknown backend aliases rejected. Find uses the same mapping plus `order_line_id` tie-break.
- 47 OrderList/Find tests and production build passed.

### Already live (do not redo)

Find priority correction, https://github.com/u2giants/popdam3/pull/420 merged `5a4f2777e28a3846b72db29f5f1f6f34c0a88c15`, Coolify `gsnmpka41hceqihehabev8cf`. Compound Start Ship-desc / Prod PO-asc Find verified live for a non-admin viewer.

### Companion work (other session)

Window-date / `order_window_date` for PopDAM #417: claim #4482 / PR #4483 / branch `claude/4336-order-window-date` (Claude chat `82c83760-6e83-478d-b345-dca386a37cea` on hetz). Albert said "keep both". Serialize: one of the two view changes must land first; both write `api.dam_order_list` and `dam.orderlist_sales_order_received_date`.

### Reviewer incidents (edge-dev)

`20261018T234621Z-edge-dev-glm-729916`, `20261018T234747Z-edge-dev-deepseek-730500`, `20261018T234801Z-edge-dev-stepfun-730599`, `20261019T151933Z-edge-dev-stepfun-2359513`, `20261019T151955Z-edge-dev-muse-2360423`, `20261019T152022Z-edge-dev-stepfun-2361561`. Root theme: packet seal / durable store refuses completed provider reports after sandbox writes; doors also refuse reports with extra decision-word lines.

## 4. Failed attempts and dead ends

1. GLM wrapper: "governed source root is not a repository top level" when `--worktree` was a git worktree. Full clone at `4336-review-src` was required.
2. DeepSeek twice hung after tool calls (JSONL stopped growing; process alive). Killed and recorded `turn_limit_cancelled`.
3. StepFun produced `VERDICT: APPROVE` text but the door refused the report (5 extra decision lines / no valid `## Verdict`). Second StepFun run exit 124 timeout.
4. Muse completed a full report ending `## Verdict` + `APPROVE` for head `26847893`, then "final source receipt could not be published"; `ai-review-packet verify-retained` reports packet hash mismatch after reviewer sandbox writes. Later Muse launch stalled empty.
5. Evidence generation fights on issue #4336: foreign session published gens 13–15 for window-date. Gen 16 (parent 12) is the sort/Find pair. Only one evidence pair may sit on the PR head.
6. `manage-migration-author-lanes.mjs` attribution regex rejected `ses_` tokens; a one-line fix was repeatedly reverted to avoid a same-file collision with PR https://github.com/popcre/shared-db/pull/4477. PR body signature must use a token without underscores (e.g. `ses-ffe5eaf8f125dffeE9Y9GlP9JY`) until that fix lands.
7. PR #4360 could not be reopened after park; successor PR is #4489.
8. Mutex `refs/db-coordination/author-acquisition` repeatedly stuck; recovered via workflow `Recover Stranded Author Mutex` with exact SHA + `RECOVER <sha>`.
9. Sidecar hash must be the **LF-normalized** migration bytes, not the CRLF working-copy hash.

## 5. Root causes and design

- UI column `sales_order_date` stays `queryable: false, virtual: true` and gains `sortField: "sales_order_received_date"`.
- `isOrderListFieldSortable` allows queryable non-virtual fields **or** an explicit `sortField`. Unknown raw backend names are rejected.
- `buildOrderListSort` maps colId -> trusted server alias and always ends with `order_line_id` ascending. Default remains `start_ship_date` desc when no sort.
- Filters and edit stay off for SO Date. Count must not order; compact selects must omit the helper.
- Date rule is unchanged: exact primary ColdLion reference, EDGEHOME, one consistent timestamp, America/New_York, blank when missing/conflicting.

## 6. Exact continuation steps and gates

1. **See SUPERSESSION at the top of this file — do not reopen #4489.** Fetch current `popcre/shared-db` and `u2giants/popdam3`. Continue from https://github.com/popcre/shared-db/pull/4499 (Find sort-only) and https://github.com/u2giants/popdam3/pull/438 (app sort UI). Live view columns are already in production via https://github.com/popcre/shared-db/pull/4485.
2. If the reviewer recording defect is still open, repair it first (see incidents above) or run review from a machine where `ai-review-packet` retains seals. Then `--assign-reviewer` and a governed exact-head APPROVE.
3. Pre-merge preview: dry-run, apply only the new migration, prove full-result SO-date ordering both directions, nulls last, stable ties, Find parity, ordinary-load performance, compact projection still prunes the helper.
4. Guarded merge of the shared-db PR; merged-main preview rehearsal; automatic production promotion; generated types.
5. Only after backend production: un-draft and merge https://github.com/u2giants/popdam3/pull/438 (do not redo Find PR #420). Verify publisher/GHCR/Coolify and both-domain build headers.
6. Live proof as a non-admin viewer: click SO Date both ways across all matching rows with exhaustion, blank-last, tie stability, displayed-date parity, Find highlight beyond 500 with compound priority.
7. Update OrderList docs after live truth. Close #4336 only after acceptance. Leave `- [ ] live proof` on the same issue until then.

## 7. Constraints and custody

No new issue for a phase or proof gap. Never force-push `codex/4336-orderlist-so-date-sort`. Never delete that branch. Do not merge popdam3#438 before backend production. Do not redo popdam3#420. Do not rewrite the 12-month window contract in this delivery. Do not hand-edit generated Supabase types. Sign GitHub posts `Posted by MiMo chat ses_ffe5eaf8f125dffeE9Y9GlP9JY on edge-dev` (or your own session id). Secrets stay in 1Password vault `vibe_coding` only.

## 8. Access and private evidence

GitHub CLI authenticated. 1Password vault `vibe_coding` items (IDs only): production DB `246sf23gymd64yudpmhswcnyle`; preview `qbvfk7umc3n75ejekd65zwd4ty`; DAM QA login `mbspkosvp2rf25qxhqufipxqca`; Coolify `c44ghscsnug2xvvrzzp3on7mme`. Use `op run` injection; never print values. Reviewer incidents under `C:/repos/ai-devops/.ai/reviewer-issues/` (local machine; sync via `ai-reviewer-logs-sync`). Local worktrees: `D:/repos/shared-db-worktrees/4336-so-date-sort`, `D:/repos/popdam3-worktrees/4336-so-sort`. Review clone `C:/Users/ahazan/AppData/Local/Temp/4336-review-src`. Disposable PostgreSQL used for the harness on port 55439 (local only).

## 9. Open risks, ownership, and audit

SO Date sorting is **not** delivered live. Claim #4488 is released; version `20261019140024` stays reserved. PR #4489 is parked, not merged. App PR popdam3#438 is draft. Reviewer recording on edge-dev is defective (see incidents). Window-date session may still hold or retake the same objects. Untracked leftover `.agent/work/4336/{10,11,12,13}/` in the shared-db worktree are failed generation experiments and are not part of the PR — leave them; do not commit. No subagents were spawned. No preview or production writes. No false completion claim.

### Mandatory self-audit

1. Sections 1–3 define the app, goal, and exact committed/parked/unstarted state; sections 6 and 8 give portable URLs and access so a new developer can start cold.
2. Sections 3–5 and 4 preserve authentic source/PR/claim numbers, reviewer incidents, and every failed path so the successor does not repeat them.
3. Sections 0–9 cover background, outcome, failures, design, gated next actions, custody, secrets locations, and stale facts. Live proof remains an open checklist item on #4336.
4. Every file reference is a GitHub URL or an explicitly labeled local-only evidence path. No sentence asks Albert for technical approval.
