---
summary: "Registers seven implementation plans for the Helper, Windows agent, SeaDrive installer copy and retired-handoff group (#1087, #1116, #1131, #1146, #1166, #1231, #1272)."
kind: handoff
status: open
read-when: "picking up any of #1087, #1116, #1131, #1146, #1166, #1231 or #1272"
---

# HANDOFF — Helper / Windows agent / SeaDrive plan group

Written 2026-11-25 3:58 PM EST by a Claude Code session on al8960ofc (side session of the issue-planning coordinator). Plans only — no fix was implemented.

## 1. Goal
Every open issue in this group has a complete implementation plan a fresh session can run.

## 2. Plans (read each plan's STATUS first; do not re-plan)

| Issue | Plan |
|---|---|
| #1087 (+ folded #1128, #1148) Helper retry list | [docs/plans/issue-1087-helper-upload-queue-failure-paths.md](../docs/plans/issue-1087-helper-upload-queue-failure-paths.md) |
| #1116 check-in confirmation retry | [docs/plans/issue-1116-complete-checkin-idempotent-retry.md](../docs/plans/issue-1116-complete-checkin-idempotent-retry.md) |
| #1131 TIFF swap safety | [docs/plans/issue-1131-tiff-swap-backup-safety.md](../docs/plans/issue-1131-tiff-swap-backup-safety.md) |
| #1146 agent update screen | [docs/plans/issue-1146-agent-update-scope-and-confirmation.md](../docs/plans/issue-1146-agent-update-scope-and-confirmation.md) |
| #1166 SeaDrive installer copy | [docs/plans/issue-1166-seadrive-mirror-save-failures.md](../docs/plans/issue-1166-seadrive-mirror-save-failures.md) |
| #1231 Windows Open Folder launcher | [docs/plans/issue-1231-windows-folder-launcher-followups.md](../docs/plans/issue-1231-windows-folder-launcher-followups.md) |
| #1272 item 3 Brazil Mac pilot | [docs/plans/issue-1272-helper-brazil-mac-pilot.md](../docs/plans/issue-1272-helper-brazil-mac-pilot.md) |

## 3. What was found while planning
- All seven issues still had open work on main 787c20b8; none was closed.
- #1231's main finding (UNC paths rejected) is false — tested under `cscript` on Windows 11; recorded in that plan's STATUS.
- #1087 and #1116 are two halves of the same retry (desktop list vs server reply); independent files, can be built in parallel.
- No production database read was possible from this session (Supabase MCP unauthorized), so #1087 live proof is still unchecked.

## 4. Next step
Pick any plan and run its lead launch prompt. #1272 is blocked on a physical Brazil Mac.

## 5. Retention
Delete this file when all seven plans are marked done.
