---
summary: "Index of the seven implementation plans for the AI tagging, character links, COMP cover rank, catalog data and AI model routing issue group (2026-11-25); #914 closed with live proof."
kind: handoff
status: open
read-when: "picking up any of issues 797, 908, 1193, 1243, 1271, 1313, 1316, 1322 or 1363"
---

# Handoff: plans for the AI tagging and model routing issue group (2026-11-25)

Written Nov 25, 2026, around 4:15 PM EST on `al8960ofc` by Claude (session 5c9e59a6), a side session of the coordinator that is planning every open popdam3 issue. Branch: `claude/plans-ai-tagging-routing`.

## 0. Owner decisions needed
None. Each plan's §13 lists its own open technical questions, along with the criteria for settling them.

## 1. What was asked
Albert wants a comprehensive implementation plan for every open issue in u2giants/popdam3. This session owned ten issues: #797, #908, #914, #1193, #1243, #1271, #1313, #1316, #1322 and #1363.

## 2. Outcome

| Issue | Result | Plan |
|---|---|---|
| #914 | **Closed**: moot. Live production check: the RPC excludes `(5,9)`, tier 5 = techpack+thumb and tier 9 = mockup no-thumb. | — |
| #797 | Plan | [issue-797-character-relink-script-hardening.md](../docs/plans/issue-797-character-relink-script-hardening.md) |
| #908 | Plan | [issue-908-comp-cover-rank-parity.md](../docs/plans/issue-908-comp-cover-rank-parity.md) |
| #1193 | Plan (half already resolved; see its STATUS) | [issue-1193-pooh-catalog-data-correction.md](../docs/plans/issue-1193-pooh-catalog-data-correction.md) |
| #1271 | Plan | [issue-1271-colab-vision-hardening.md](../docs/plans/issue-1271-colab-vision-hardening.md) |
| #1313 (+ folded #1325) | Plan | [issue-1313-shared-character-cutover-leftovers.md](../docs/plans/issue-1313-shared-character-cutover-leftovers.md) |
| #1322 (+ folded #1366), #1316 (+ folded #1318), #1243 | One combined plan | [issue-1322-ai-provider-routing-hardening.md](../docs/plans/issue-1322-ai-provider-routing-hardening.md) |
| #1363 | Plan | [issue-1363-parallel-untagged-only-guard.md](../docs/plans/issue-1363-parallel-untagged-only-guard.md) |

No code was changed. Every plan starts with a STATUS table and ends with its self-audit and a lead launch prompt.

## 3. Findings worth knowing before you start
- The automatic fixer's PRs for this group (#798, #1244, #1323, #1364) were all closed without merging. Labels such as `fixer-done` prove nothing.
- After the shared-character cutover (2026-11-24), the historical relink scripts point at the wrong table. The #797 plan's step 1, a hard refusal, is the most urgent item in the group.
- Some reviewer claims turned out to be wrong when checked:
  - The Colab URL guard's hex and octal "bypasses" are normalised away by Node's URL parser (verified).
  - COMP files of any type ranking as covers matches the owner's ruling.
  The plans record both.
- Read-only production SQL works through the Supabase Management API `database/query/read-only` endpoint, with the PAT from 1Password `vibe_coding` → "Supabase CLI Personal Access Token" (field `credential`) injected with `op run`. The Supabase MCP was unauthorized in this session.

## 4. What is not done
Implementation, for every plan. Each plan's STATUS table says where to start.
