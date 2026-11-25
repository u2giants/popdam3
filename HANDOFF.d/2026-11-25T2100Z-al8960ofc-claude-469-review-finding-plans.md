---
summary: Open plans for the #469 / shared-db #2421 live-proof review findings (#1000, #1027, #1067, #1246); four sibling findings were closed as moot or fixed. Start from the plan STATUS tables.
kind: handoff
status: open
read-when: implementing #1000, #1027, #1067 or #1246
---

# Handoff — #469 live-proof review findings: three plans to implement

Written November 25, 2026, 4:15 PM EST on `al8960ofc` by Claude (session b5bcb2fd). Planning only; no code, data or settings were changed.

## Open work (each plan is self-contained; read its STATUS first)

- [docs/plans/issue-1000-watermark-proof-vacuous-pass.md](../docs/plans/issue-1000-watermark-proof-vacuous-pass.md) — #1000: the 2421 live proof passes on an empty watermark.
- [docs/plans/issue-1027-redact-licensed-filename-469-heavy.md](../docs/plans/issue-1027-redact-licensed-filename-469-heavy.md) — #1027: one real licensed filename in a verification log.
- [docs/plans/issue-1246-1067-rich-pdf-openrouter-docs-and-401-rows.md](../docs/plans/issue-1246-1067-rich-pdf-openrouter-docs-and-401-rows.md) — #1246 and #1067: docs contradict the owner's 2026-11-20 OpenRouter routing; check for leftover 401 rows.

The three plans touch different files and can run in parallel.

## Closed in this session (evidence comments on each issue)

#1020 (moot: synthetic probe input, closed audit), #1074 (workflow deleted in c395c09a), #1076 with folded #1120 (redacted by PR #1118; history left per owner ruling), #1251 (format nits on a closed audit's blocked record).

## Not verified

The read-only count of 401 rich-PDF failures (plan #1246/#1067 step 6) was not taken: the Supabase MCP was unauthorized on this machine.

Close this file (status: closed) when all three plans are done.
