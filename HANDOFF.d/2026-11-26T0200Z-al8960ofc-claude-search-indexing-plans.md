---
issue: none   # covers 16 open issues (#813 #1049 #1043 #876 #1050 #871 #868 #833 #781 #874 #995 #760 #945 #745 #1039 #1203); delete this file when all of them are closed
status: OPEN
owner: claude/plans-search-indexing-group
---

# Search indexing, embeddings, meaning search and scorecard — seven implementation plans (open)

Written November 25, 2026, about 9:00 PM EST, on `al8960ofc` by Claude (Opus), session 694bfdf3, as one group of a coordinator-led "every open issue gets a plan" sweep. **Plans only: no code, database or configuration was changed.**

## 0. Business decisions only the owner can make

None — nothing in this workstream needs the owner. Every plan's open choices are technical and carry decision criteria (e.g. keep or remove a speed-up, a query-prefix space, CPU thread count) that the implementing session settles by measurement.

Already settled — do not re-ask (with dates): reviews are advice only and never block (owner ruling 2026-10-29); only data-damage or secret-leak checks may be required (2026-10-30); no hold or retry delay over 30 minutes (2026-11-20); with the text-meaning search leg on, a missing text vector fails the search with Retry (#1037 decision D4, Nov 17–18, 2026).

## 1. What this application is

PopDAM (https://dam.designflow.app) is POP Creations' internal library of licensed consumer-product artwork; PopSG (https://sg.designflow.app) is the licensor style-guide library served by the same code. Repository: https://github.com/u2giants/popdam3 (public; protected `main`). Search combines exact words, picture similarity (SigLIP2 vectors written by a GPU poller on the edge-dev machine) and text meaning (Qwen3 vectors; query side from the `text-embed` CPU service at https://text-embed.designflow.app). The router is https://github.com/u2giants/popdam3/blob/main/AGENTS.md.

## 2. What this session set out to do, and why

Albert asked that every open GitHub issue without a comprehensive implementation plan get one. This session owned the group "search indexing, embeddings, meaning search and search evaluation": #743, #760, #781, #813, #868, #871, #874, #876, #995, #1043, #1049, #1050, #833, #745, #1039, #1203, #945 — all advisory AI-review findings on merged (or, for #760, unmerged) PRs.

## 3. Current state — what is true right now

Closed with evidence (no plan): **#743** — both visible findings fixed on `main` (PopSG lane grants migration `20261105005932`; filename vectors cleared and replaced, recorded in the #706 plan's Nov 4 checkpoint). Comment: https://github.com/u2giants/popdam3/issues/743

Plans written (every row ⬜ open), landing in the PR from branch `claude/plans-search-indexing-group` (intended URLs below become live on merge):

| Plan | Issues |
|---|---|
| [issue-813 GPU poller lane timing and failures](../docs/plans/issue-813-image-embed-poller-lane-timing-and-failures.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-813-image-embed-poller-lane-timing-and-failures.md | #813, #1049 |
| [issue-1043 text-embed service hardening](../docs/plans/issue-1043-text-embed-service-hardening.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1043-text-embed-service-hardening.md | #1043, #876, #1050, #871 (findings 3–4) |
| [issue-868 query-embedding edge hardening](../docs/plans/issue-868-query-embedding-edge-hardening.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-868-query-embedding-edge-hardening.md | #868, #871 (findings 1–2), #833 |
| [issue-781 search scorecard harness CI and cleanup](../docs/plans/issue-781-search-eval-harness-ci-and-cleanup.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-781-search-eval-harness-ci-and-cleanup.md | #781, #874, #995 |
| [issue-760 health card and bounded requeue](../docs/plans/issue-760-search-index-health-card-and-bounded-requeue.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-760-search-index-health-card-and-bounded-requeue.md | #760 (supersedes open PR #758) |
| [issue-945 PopSG crawl reply contract](../docs/plans/issue-945-popsg-crawl-rpc-contract.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-945-popsg-crawl-rpc-contract.md | #945 |
| [issue-745 search plan docs hygiene](../docs/plans/issue-745-search-plan-docs-hygiene.md) — https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-745-search-plan-docs-hygiene.md | #745, #1039, #1203 |

No duplicates were folded: #871's findings split across two plans, and each plan says #871 closes only when both land. Each issue gets a comment linking its plan after the PR merges.

## 4. What did NOT work / dead ends

- Supabase MCP `execute_sql` was refused (no valid access token) when reading admin_config search switches; the text-leg "on" state was taken from the #1037 plan's STATUS (row 6, live Nov 18, 8:20 PM EST) instead. Plans tell implementers to re-read live values first.
- Several review bodies are truncated by the reviewer ("[findings truncated]"); the matching PR comments are truncated the same way, so the missing tail of #743, #760, #871, #1043, #1049 and #745 is unrecoverable. Plans cover every visible finding.
- `node --test scripts/search-eval/` fails one assertion on Windows only (POSIX file mode); recorded as step 1 of the issue-781 plan, not a real bug.

## 5. Root causes and key findings

- Many findings were already fixed on `main` and are recorded as such inside the plans: #1049-2 (text-lane DB objects exist), #868-2 (per-item limit), #874-1 (tests exclude warm-ups), #945-1/2/3 and the re-queue half of 4, #1203-2/3/4, #1039-3, #760-1/2/4 in shape (DB functions landed; PR #758 never merged).
- The text-embed batch route 500s on any Qwen error, so turning the meaning leg off is not a real rollback (issue-1043 plan step 2).
- The admin "Requeue terminal errors" button on `main` still calls the unbounded legacy reset (issue-760 plan step 3).

## 6. Exact next steps

1. Merge the plans PR; then comment on each of the 16 issues with its plan link. You'll know it worked when every issue shows a signed comment linking a plan on `main`.
2. Implementers: open the plan for the issue, read STATUS first, and paste its "Lead launch prompt". You'll know a plan is done when its Definition-of-done boxes are ticked and its issues are closed.
3. Delete this file when all 16 issues are closed (successor rule).

## 7. Constraints and gotchas

Public repo: never write licensed names, product codes, file ids or product screenshots in plans, commits, issues or PRs (https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md). No DDL in this repo (shared-db gatekeeper). Workflow files are protected from the automatic fixer. Never run two scorecards at once or during a release.

## 8. Access and environment

`gh` as `u2giants`. Secrets by location only: 1Password vault `vibe_coding` (text-embed key, viewer/admin testers, read DSN). Supabase MCP needs a valid access token.

## 9. Open questions and risks

Per plan §13. The open search-speed workstream (https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-22T0217Z-edge-dev3-codex-popdam-search-speed.md) runs scorecards on the same production service; coordinate before the issue-1043/868 live proofs (Nov 25, 2026).

## Self-audit

1. Newcomer could continue: §1 app, §3 table of plans with links, §6 steps. 2. As effective as me: §4 dead ends and §5 findings carry what I verified. 3. Every detail: per-issue detail lives in the plans; this file routes to them. 4. §0: swept — no business-meaning decisions exist; settled rulings listed.
