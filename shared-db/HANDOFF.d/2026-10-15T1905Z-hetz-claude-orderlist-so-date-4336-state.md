---
issue: 4336
status: OPEN
owner: claude/issue4336-orderlist-so-filter
---

# Handoff (state update): OrderList 12-month window, issue #4336, claim #4337

Written 2026-10-15 19:05 UTC on machine `hetz` by Claude session `250902fb-e85f-45d3-a62c-9c18cb217d1e`. This supersedes the earlier handoff `HANDOFF.d/2026-10-15T1616Z-hetz-claude-orderlist-so-date-4336.md` (still open; keep both until the successor retires them). All facts were checked at the time written; re-check before use.

## 0. Business decisions only the owner can make

None pending. Settled 2026-10-15 by the owner:
- Prod PO Date is the **fourth** fallback for the window date (SO date → Sent PO → Start Ship → Prod PO Date). Done in commit `d9efb0ab` on PR popcre/shared-db#4339.
- Orders with no window date at all stay **visible** in the main list. Implemented.
- The 12-month window uses the New York calendar. "Show old" / "Hide old" toggles the older orders in the same table.
- **Technical questions go to Muse, not to the owner** (owner ruling 2026-10-15). Use `ai-muse` with caller `claude`.

Separate task, not in this handoff: removing retired-orchestrator references is written up as its own prompt (attached to the session, not in the repo).

## 1. What this application is

PopDAM (`u2giants/popdam3`) shows production orders in the OrderList grid at `/orders`. Its database lives in `popcre/shared-db`, which owns all schema and promotes changes to production through a gated workflow. The owner asked for `/orders` to show only orders from the last 12 months by SO date, falling back to Sent PO, then Start Ship, then Prod PO Date, with a "Show old" button for the older orders.

## 2. Goal this session

Make the 12-month window live: a database view column (`order_window_date`) plus the app filter and button. The database change is written and tested but is **not in production**. The app change is written and waits for the database change.

## 3. Current state (as of the time written)

### Shared database (popcre/shared-db)
- **PR #4339 (OPEN, not merged).** Migration `20261015154023_orderlist_sales_order_received_date.sql`. Head `d9efb0ab` on branch `claude/issue4336-orderlist-so-filter`. Earlier heads: `61702d66` (feature), `659e4a1d` (`derived-from` header, cleared the SQL migration guards check), `d9efb0ab` (fourth fallback). Migration file: https://github.com/popcre/shared-db/blob/claude/issue4336-orderlist-so-filter/supabase/migrations/20261015154023_orderlist_sales_order_received_date.sql
  - Its reviewer approval was drawn on the old head `61702d66` (Muse, slot 1). It must be re-reviewed on `d9efb0ab`.
  - Its "Migration author lease" check was failing because claim #4337's owner label does not match the check-in rule (see §4 item 6). The "Tools offline tests" check depends on main being green.
- **Claim #4337 (OPEN lease, expired 16:10 UTC).** It still protects `view api.dam_order_list` and `function dam.orderlist_sales_order_received_date`. Expiry does not release them. Owner label on the claim: `claude-chat-250902fb-e85f-45d3-a62c-9c18cb217d1e@hetz`.
- **Issue #4336 (OPEN).** Closing note added. Its scope block names the objects above.
- **PR #4344 (OPEN, head `5844f66bcf952532375c4ba0cf94ddf4f03e8aa6`, branch `claude/fix-truth-audit-baseline`, issue #4343).** It re-records the one reviewed entry that the main-branch offline audit test rejects (`docs/verification/throughput-dispositions/scripts~check-exact-head-approval.mjs.json`). Every check passes, including Tools offline tests. The assigned reviewer is deepseek-v4.1-flash (sequence 6555). It returned APPROVE in a local report, but **no durable verdict artifact was recorded**, so the guarded merge refused it (run 38775314666). The reviewer lease expired, so the governed runner refuses to start a new review (see §4).
- **PR #4346 (OPEN, head `392eb6da35655450d99bbc4aa00da232bbfb8c49`, branch `claude/accept-claude-chat-owner-label`, issue #4345).** Accepts the `claude-chat-<session>@<machine>` owner label, bound to the exact session UUID, so the claim can be checked in. Assigned reviewer stepfun-step-5-preview returned APPROVE in a local report; **no durable verdict artifact was recorded**. The guarded merge refused it because its branch predates the #4344 baseline fix (Tools offline tests fails there). After #4344 merges it must be rebased onto main and re-reviewed.
- **Issue #4343** (repo maintenance for #4344) and **issue #4345** (for #4346): both OPEN, each with a `db-work-scope` block.
- **Merged this session:** PR #4340 (handoff), PR #4342 (handoff: strike orchestrator task), PR #4347 (handoff correction: the blocker is a claim owner label, not a retired role).

### Preview database (shared; protected)
- Nothing applied as a recorded migration. A push would apply about 25 older migrations that preview's ledger lacks (latest on preview: `20261014043757`). The migration was tested only inside a transaction that was rolled back, twice (before and after the fourth fallback). Preview counts: 24,020 rows; 3,370 in window; 17,915 older; 2,735 no window date. Preview has no ColdLion data (`coldlion.order_history_line` has 0 rows) and no `order_date`, so real values cannot be checked there.

### Production
- Nothing applied.

### App (u2giants/popdam3)
- Branch `claude/orderlist-12-month-filter-74714f`, commits `ff817faa` (feature) and a docs commit that adds the fourth fallback to `docs/ORDER_LIST.md`. Draft PR #417: https://github.com/u2giants/popdam3/pull/417 . **Do not merge until the database change is live**; the grid reads `order_window_date`.
- Tests: 59 pass in the order-list, block-count, grid and OrdersPage integration suites.

### Review tooling
- Muse design answer (report): https://github.com/popcre/shared-db/blob/claude/handoff-state-2/.ai/reviews/ is **not** tracked; the report lives only on hetz. Its finding: the governed-review runner `scripts/run-governed-review.mjs` is the only production path that records a verdict. It posts a findings comment and then calls `recordReviewVerdict`. DeepSeek (`ai-deepseek-agent`) and StepFun (`ai-stepfun review`) can emit the required governed verdict line. The external `ai-review` launcher writes only a local report.
- Reviewer failure recorded: `20261015T190328Z-hetz-deepseek-178206`, saved at /worksp/ai-devops/.ai/reviewer-issues/20261015T190328Z-hetz-deepseek-178206 (on hetz only).

## 4. What did NOT work (mandatory)

1. **Claim owner label.** The claim was created with `--owner claude-chat-<session>@hetz`. The claim path accepts that form, but the check-in rule (`resolveSessionAuthority` in `scripts/lib/session-authority.mjs`) accepted only `Claude chat <session> on <machine>`. Every check-in refused with "must execute in the actual owner session". This was **my mistake**; an earlier note calling it a "retired orchestrator marker" was wrong. Fixed in PR #4346 (the label form is accepted only with the same session UUID). Note: `resolveMarker()` is just the session check; there is no live orchestrator in that path.
2. **Main's offline audit test failed** (`scripts/throughput-guard/check-throughput-truth-audit.test.mjs:153`): stale semantic site `check-exact-head-approval.mjs:283`, now at line 271 after the 2026-10-14 wording change. Fixed in PR #4344 by re-recording that one entry. The other 11 failures in that directory were only because this sandbox has no `python` command; with a `python` alias all 72 pass.
3. **Migration needed a `derived-from` header** (the view body comes from `20261009073649`). Added in `659e4a1d`; SQL migration guards now pass.
4. **Preview push** (`supabase db push --linked --dry-run`) lists about 25 older migrations; not pushed (see Preview section).
5. **Supabase CLI** npm shim could not find `supabase-go`. Fixed by installing the matching release tarball into the user-local share directory on hetz.
6. **External `ai-review` launcher for the assigned reviews**: writes a local report only. The merge gate ignores it. Also logged "reviewer event recording: sandbox evidence requirement is missing" and "required report is not durably published".
7. **Governed runner** (`node scripts/run-governed-review.mjs ...`): first refused with "SHARED_DB_AUTHOR_ENGINE is not set"; with that set, "no held reviewer lease matches this review; no reviewer was started". The 4344 draw was about 17:10 UTC. The lease appears to have expired (not confirmed from the lease rule).
8. **Muse, first session `fix-4344-approval-record`**: interrupted by my own 110-second command timeout. State `provider_outcome_uncertain`, failure `interrupted-local-observer`. `ai-muse reconcile` refused (no retained process). **Leave it fenced; do not replay.** Second session `fix-4344-approval-record-2` completed (answer above). Third session `verdict-recording-design` completed (design answer).
9. **Direct merges** of #4344 and #4346: refused by the base branch policy (merge queue + required context `Migration guarded merge authorization`, which only the guarded workflow posts). Guarded workflow dispatch refused both for lack of a durable APPROVE. **Never use `--admin`.**
10. **Auto-merge enabled on #4344** (`gh pr merge --auto`) to test the queue; it stays BLOCKED. Disable it if it is not needed: `gh pr merge 4344 --disable-auto`.

## 5. Root causes and key findings

- The claim-label mismatch (item 4.1) is why every check-in failed. Its fix is PR #4346.
- The main baseline failure is a stale reviewed catalogue entry. Its fix is PR #4344.
- Reviewer approvals are not recorded because the reviews were run outside the governed runner. The governed runner is the supported path, and it needs a held reviewer lease. Leases expire.
- `git ls-remote origin` showed no stale locks left by the interrupted Muse run.

## 6. Exact next steps (in order)

1. **Get #4344 approved and recorded durably.** Re-draw the reviewer for #4344 (`--assign-reviewer --issue 4343 --pr 4344 --head-sha 5844f66... --review-slot 1`, with `SHARED_DB_AUTHOR_ENGINE=claude` and `SHARED_DB_SESSION_ID` set). Then run the governed runner (see Muse's design report on hetz). Verify a ref `refs/db-review-verdicts/4343-4344-5844f66...-slot1` exists (`git ls-remote origin 'refs/db-review-verdicts/*'`).
   - You'll know it worked when guarded-migration-merge.yml passes its pre-flight for #4344, then merge #4344.
2. **Merge #4344**, then **rebase #4346 onto main** (main is past `e72b6e13`), push, and get a fresh governed APPROVE on the new head.
   - You'll know it worked when #4346's Tools offline tests pass and its guarded merge is accepted.
3. **Merge #4346.** Then run the check-in for claim #4337 from a clean worktree of merged main, as this session, with owner `claude-chat-250902fb-e85f-45d3-a62c-9c18cb217d1e@hetz`. Use the supported command `--check-in-author` (do not hand-edit the claim body).
   - You'll know it worked when the check-in returns a renewed lease and #4339's "Migration author lease" check passes.
4. **Get #4339 approved on head `d9efb0ab`** (governed route, as in step 1). Then rehearse on preview through the lane's exclusive preview lease (not a raw `db push`), and record it.
   - You'll know it worked when preview's ledger records `20261015154023` and `api.dam_order_list` has `order_window_date`.
5. **Merge #4339** through the guarded workflow, then promote to production with the existing workflow (`ai-task-gates check --before shared-db-promotion`).
   - You'll know it worked when production lists `20261015154023` and `select count(*) from api.dam_order_list where order_window_date is not null` runs.
6. **Only then**: mark popdam3 PR #417 ready, merge it, and check `/orders` (default shows the last 12 months; Show old adds the older orders; Hide old removes them).

## 7. Constraints and gotchas in force

- Technical questions go to Muse (owner ruling 2026-10-15). Do not put technical questions to the owner.
- Never `--admin`. Never forge a check-in, edit a claim body by hand, or write a verdict ref by hand.
- Preview is shared and not clean. Check the target before any write: `cat supabase/.temp/project-ref` must equal the preview ref.
- Sign GitHub posts with `Posted by Claude chat <id> on <machine>`.
- Do not edit another session's `HANDOFF.d/` file.

## 8. Access and environment

- `gh` is authenticated for popcre/shared-db and u2giants/popdam3.
- 1Password vault `vibe_coding`, referenced by item ID only: Supabase CLI personal access token `3t2xoqk5luyz7ffgdhj24gvtpq`; preview branch database password `qbvfk7umc3n75ejekd65zwd4ty` (field `DB_PASSWORD`).
- The preview project reference comes from `ai-private-config value supabase_shared_preview_ref` (protected; never copy it).
- Supabase CLI v2.105.0 is installed on hetz; `supabase/.temp` in the shared-db worktree is linked to preview and is gitignored.
- Muse: `AI_MUSE_CALLER=claude ai-muse ...`.

## 9. Open questions, risks, stale facts

- **Stale (checked around 17:00 UTC):** origin/main was `e72b6e13` (later commits may have landed). PR #4339 head `d9efb0ab`; #4344 head `5844f66`; #4346 head `392eb6da`.
- **Risk:** the reviewer lease expires quickly, so re-draws may be needed before every governed review.
- **Risk:** the Ctrl+F find path in the app does not apply the window. It can locate a hidden old row. Known gap, not fixed.
- **Risk:** if the governed route does not record a verdict for DeepSeek or StepFun, the next fix is the reviewed change Muse designed (report on hetz): add a report-ingest step to `scripts/run-governed-review.mjs`, with new tests. Do not weaken the existing pins: `scripts/manage-migration-author-lanes.test.mjs` (no `--record-review-verdict` CLI) and the ordering pins in `scripts/run-governed-review.test.mjs`.
- **Open:** the orchestrator-reference removal is a separate task (attached prompt, not in the repo).

## Part (b): sub-agents

No sub-agents of this session hold claims. The reviewers were drawn by the allocator for PRs #4344 (deepseek) and #4346 (stepfun). Their verdicts are not recorded (see §4 items 6-7). Muse sessions: `fix-4344-approval-record` (fenced), `fix-4344-approval-record-2` (complete), `verdict-recording-design` (complete).

## Next-session prompt

```
Repo: popcre/shared-db. Start from this handoff (on main once merged): https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-15T1905Z-hetz-claude-orderlist-so-date-4336-state.md
Goal: get the 12-month OrderList window live (issue popcre/shared-db#4336, claim #4337).
Do in order: §6 steps 1-6. Do not merge anything with --admin. Technical questions go to Muse (caller claude), not to the owner.
Do not edit another session's HANDOFF.d files.
```
