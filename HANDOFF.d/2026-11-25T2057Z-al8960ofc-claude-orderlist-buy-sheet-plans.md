---
summary: Registry of the four open implementation plans for the OrderList, customer buy-sheet (Burlington HFC, Bamboo Rose) and production-orders review-finding issues (#905, #918, #927, #932, #939, #947, #1032, #1034, #1304).
kind: handoff
status: open
read-when: picking up any of issues #905, #918, #927, #932, #939, #947, #1032, #1034 or #1304
---

# Handoff: OrderList / buy-sheet / production-orders plans (written 2026-11-25)

Written Nov 25, 2026, about 4:30 PM EST on `al8960ofc` by Claude (plan-writing side session of the "plan every open issue" coordinator). Branch `claude/serene-rubin-e56867`. No application code was changed.

## 0. Business decisions only the owner can make
None. Albert decided 2026-11-25 that the buy-sheet import is Burlington-only (only Burlington has the HFC system); recorded in [issue-947 plan](../docs/plans/issue-947-burlington-menu-bamboo-rose.md) sections 7–8 and step 3.

## 1. What this application is
PopDAM — see `AGENTS.md`. Repo u2giants/popdam3; OrderList is `/orders` (`docs/ORDER_LIST.md`).

## 2. What we set out to do
Give every open issue in this group a self-standing implementation plan (implementation-plan-writer standard), or close it with evidence.

## 3. Current state — plans (all STATUS rows open)

| Plan | Issues |
|---|---|
| [docs/plans/issue-905-buy-sheet-import-hardening.md](../docs/plans/issue-905-buy-sheet-import-hardening.md) | #905, #927, #939, #1032 |
| [docs/plans/issue-947-burlington-menu-bamboo-rose.md](../docs/plans/issue-947-burlington-menu-bamboo-rose.md) | #947, #932, #1034 |
| [docs/plans/issue-918-orderlist-voided-lines-everywhere.md](../docs/plans/issue-918-orderlist-voided-lines-everywhere.md) | #918 |
| [docs/plans/issue-1304-production-orders-read-path-followups.md](../docs/plans/issue-1304-production-orders-read-path-followups.md) | #1304 |

No issue in the group was fully fixed, so none was closed. No two were true duplicates (each covers a different merged PR's findings); related ones share a combined plan instead. Each plan's section 6 marks which findings are already resolved on `main` (`787c20b8`) with evidence, so implementers do not redo them.

## 4. What did not work
N/A — planning only. GitHub truncated two reviews (#939 finding 6, #1304 finding 6); the plans reconstruct them from the code and the fixer's analysis.

## 5. Findings
See each plan's section 6. One needs another repository: the Clear tool's "only your latest upload" guard is a `popcre/shared-db` function change (issue-905 plan step 6).

## 6. Exact next steps
1. Pick a plan; read its STATUS; follow its lead launch prompt.
2. Update STATUS rows with artifacts as steps land; close the issues with live proof.
3. When all four plans are done, mark this handoff done.

## 7. Constraints
`AGENTS.md` standing rules; each plan's section 11.

## 8. Access
Each plan's section 12.

## 9. Open questions and risks
The two buy-sheet plans both edit `docs/ORDER_LIST.md` and `src/components/orders/BuySheetImportDialog.tsx`; run them one after the other or rebase carefully.
