---
summary: "Registers the three open plans for the search ranking, spelling and dam-search-ai review-finding group (#795/#835, #935/#930/#1127/#1052, #1174); #1056 and #1214 were closed with evidence."
kind: handoff
status: open
read-when: "picking up issue #795, #935, #930, #1127, #1052 or #1174, or any dam-search-ai spelling, anchor, timing or library-refresh follow-up"
---

# Search group review-finding plans (Nov 25, 2026)

Written November 25, 2026, 3:58 PM EST on `al8960ofc` by Claude Code (worktree `modest-wu-eadf20`), checked against `origin/main` `787c20b8`. Planning only: no code, database or setting changed.

## 1. Purpose

Albert asked that every open popdam3 issue get a comprehensive implementation plan or be closed with evidence. This session owned the "search ranking, spelling and dam-search-ai behaviour" group: #795, #930, #935, #1056, #1127, #1052, #1174, #1214.

## 2. Outcome

| Issue | Result |
|---|---|
| #795 (+ folded #835) | Plan: [docs/plans/issue-795-spelling-vocabulary-retired-names.md](../docs/plans/issue-795-spelling-vocabulary-retired-names.md) |
| #935, #930, #1127, #1052 | One combined plan (same code block): [docs/plans/issue-935-dam-search-anchor-timing-lookup-hardening.md](../docs/plans/issue-935-dam-search-anchor-timing-lookup-hardening.md) |
| #1174 | Plan: [docs/plans/issue-1174-library-refresh-cache-tests.md](../docs/plans/issue-1174-library-refresh-cache-tests.md) |
| #1056 | Closed: budget, test and timer fixes are on `main`; named rule live again ([comment](https://github.com/u2giants/popdam3/issues/1056#issuecomment-7174427399)) |
| #1214 | Closed as moot: switch pinned by a named test; naming was cosmetic ([comment](https://github.com/u2giants/popdam3/issues/1214#issuecomment-7174428456)) |

## 3. Things a fresh session should know

- #1052's original review text was never saved (issue body and workflow log hold only the closing paragraph). The combined plan §6 re-derives its four themes from the reviewer's summary.
- The #795 plan delivers Steps 2–3 of the older [issue-725 plan](../docs/plans/issue-725-search-spelling-canonical-vocabulary.md) (#725 is outside this group and still open). Tell #725's owner when #795 lands.
- The #935 and #795 plans both edit `supabase/functions/dam-search-ai/index.ts`; whichever lands second rebases. The #1174 plan touches the caches that [issue-1200-08](../docs/plans/issue-1200-08-ranked-search-cache.md) also reworks.
- Live measurements needed by the plans (junk-name counts, largest property character list) were not taken: the Supabase MCP was unauthorized in this session. Each plan's Step 1 takes them.

## 4. Next step

Pick any plan and start at its STATUS table. All three are independent apart from the rebase notes above.
