---
issue: 4336
status: OPEN
owner: claude/issue4336-orderlist-so-filter
---

# Correction to the #4336 handoffs (Claude session 250902fb on hetz)

Written 2026-10-16 about 01:20 UTC (9:20 PM EDT, 2026-10-15) by Claude session 250902fb-e85f-45d3-a62c-9c18cb217d1e. This corrects the two earlier handoffs for this issue (2026-10-15T1616Z and 2026-10-15T1905Z). Both are now out of date. Keep them until their successors retire them, but do not act on their next steps.

## 0. Business decisions only the owner can make

None pending from this session. The owner decided: Prod PO Date is the fourth fallback; no-date orders stay visible; the owner ordered the claim released and PR #4339 closed (both done).

## 1. What changed after the earlier handoffs (verified on GitHub at 01:1x UTC)

- **Claim #4337 is CLOSED** by an owner-confirmed release (`--release-claim`). Its migration version `20261015154023` remains unavailable. Issue comment: https://github.com/popcre/shared-db/issues/4336#issuecomment-6200330529 (relinquish) and the release shows on issue #4337.
- **PR #4339 is CLOSED, not merged.** Closed by the owner's order. Branch `claude/issue4336-orderlist-so-filter` is kept at `d9efb0ab`. https://github.com/popcre/shared-db/pull/4339
- **PR #4344 is MERGED** (the baseline audit fix; merge commit `0d9a7fdd`, merged by the merge queue at 21:44 UTC). The reviewer approval reached the merge gate; the earlier blocker is gone.
- **PR #4349 (state handoff) and the correction PRs #4340, #4342, #4347 are MERGED.**
- **PR #4346 is still OPEN** (owner-label fix; head `392eb6da`; branch `claude/accept-claude-chat-owner-label`). Its stepfun approval was never recorded. It predates main, so it needs a rebase and a fresh review. https://github.com/popcre/shared-db/pull/4346
- **Issues #4343 (for #4344) and #4345 (for #4346)** are open. #4343 can probably close now that #4344 is merged; confirm first.
   Its continuation prompt is in its latest comment on #4336 (the comment beginning "Blocked delivery / preserved recovery record"). Its handoff is PR #4369: https://github.com/popcre/shared-db/pull/4369 . **Do not start a second database claim for this work while #4359 is open.**

## 2. The app side (u2giants/popdam3)

- Draft PR #417 is open (branch `claude/orderlist-12-month-filter-74714f`, head `d050e858`). It reads `order_window_date`, which does not exist on production. It must not merge until the database work is live. Whether it is still wanted, given Codex's work, is an owner decision.

## 3. Reviewer tooling

- ai-devops PR #1770 landed on main (merge `c7a5c322`, 5:33 PM EDT). It repairs retained Muse failure recovery and reviewer event custody. It is **not installed** on hetz (the installed checkout is at `3de446a4`). A plain pull is blocked by the installer's rule; use the supported sync.
- The reviewer failure I recorded is `20261015T190328Z-hetz-deepseek-178206`, saved only on hetz under `/worksp/ai-devops/.ai/reviewer-issues/` (git-ignored). **There is no central store.** The owner asked how to add one; this session did not answer that (Muse was asked to design it; not done).

## 4. Remaining work for Claude (this session's own items)

1. Decide with the owner whether PR #417 and PR #4346 are still wanted, or superseded by Codex's PR #4360.
2. If #4346 is wanted: rebase it onto main, get a governed APPROVE on the new head, merge it.
3. Sync the installed ai-devops tools to include #1770 on hetz, then retry the fenced Muse review `fix-4344-approval-record`. Do not replay it blindly.

## 5. What did not work (summary)

- The claim could only be released after its pull request was closed. Relinquish froze the capacity but left the object writes held until release.
- The earlier "orchestrator marker" explanation was wrong. The real cause was the owner label form (fixed in PR #4346, not yet merged).
- Reviews run through the external `ai-review` launcher never produce the merge-gate artifact. The governed runner is the supported path and needs a held reviewer lease.

## 6. Next-session prompt

```
Repo: popcre/shared-db. This is the Claude workstream for issue #4336. Read first: https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-16T0112Z-hetz-claude-orderlist-so-date-4336-correction.md and issue https://github.com/popcre/shared-db/issues/4336 (latest comments; the Codex successor's continuation prompt is there).
Do not open a new database claim for the window work while claim #4359 (Codex, PR #4360) is open.
Remaining Claude items: (1) ask the owner whether popdam3 PR #417 and popcre/shared-db PR #4346 are still wanted; (2) if #4346 is wanted, rebase onto main and get a governed APPROVE; (3) sync the installed ai-devops tools to include ai-devops PR #1770.
Never --admin. Never hand-write a verdict ref. Sign GitHub posts "Posted by Claude chat <id> on <machine>".
```
