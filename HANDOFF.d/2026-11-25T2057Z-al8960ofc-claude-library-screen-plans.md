---
summary: Index of five open implementation plans for Library and app-screen issues (#763, #925, #1361, #901, #855); no implementation started.
kind: handoff
status: open
read-when: picking up any of popdam3 issues 763, 925, 1361, 901, 855
---

# Handoff: Library and app-screen issue plans (written 2026-11-25)

Written Nov 25, 2026, about 4:00 PM EST on `al8960ofc` by Claude, as one
group of the "plan every open issue" coordinator run. Plans only — no code
changed.

## 0. Business decisions only the owner can make
None. Owner ruling relied on: Albert, 2026-11-10, "make find sibling files
available to all users" (#901 keeps it).

## 1. What this application is
PopDAM / PopSG — see `AGENTS.md`. Repo `u2giants/popdam3`.

## 2. Plans (each opens with a STATUS table; every row open)
| Issue | Plan |
|---|---|
| #763 Download all token expiry + all-or-nothing; Styles refresh catch | [issue-763-group-download-all-and-styles-refresh.md](../docs/plans/issue-763-group-download-all-and-styles-refresh.md) |
| #925 mock.designflow.app art links get the web page instead of the image | [issue-925-mockups-host-image-links.md](../docs/plans/issue-925-mockups-host-image-links.md) |
| #1361 wide Style Group flyout fixes | [issue-1361-style-group-flyout-split-layout.md](../docs/plans/issue-1361-style-group-flyout-split-layout.md) |
| #901 Find sibling files safeguards | [issue-901-sibling-files-safeguards.md](../docs/plans/issue-901-sibling-files-safeguards.md) |
| #855 mockup auto-match plan record + screenshots | [issue-855-mockup-plan-status-reconcile.md](../docs/plans/issue-855-mockup-plan-status-reconcile.md) |

## 3. Current state
Already-fixed parts noted in the plans' STATUS row 0: #763 finding 1 and
#925 finding 1. No issue in the group was a duplicate or fully moot.

## 4. Next step
Any session picks one plan, reads its STATUS, and follows its lead launch
prompt. #1361 and #763 both edit `StyleGroupDetailPanel.tsx` — land them one
after the other, not in parallel.
