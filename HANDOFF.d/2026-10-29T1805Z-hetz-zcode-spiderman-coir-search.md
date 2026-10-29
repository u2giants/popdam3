# Handoff — spiderman coir search: stability shipped, DB planning fix one step from landing

Supersedes `2026-10-29T1416Z-hetz-claude-spiderman-coir-search.md` (read that for
the original evidence; everything it listed as "next steps" is done or in flight here).

## What Albert reported and what it actually was

- (a) "too few results (13 groups · 105 files)" — the 13 groups ARE the complete
  truth: every Spider-Man coir door-mat group in the index (their member count is
  exactly 105 files). Nothing is hidden. The one other spider+coir group
  (VDE83ANWAN01) is a generic white spider-WEB mat, not Spider-Man, and is
  deliberately excluded.
- (b) "results inconsistent with search terms" — when the per-query picture-match
  floor was lost, weak picture matches flooded in (live-measured: 288 groups for
  "spiderman coir"). Two causes: the anchor RPC failing made the floor silently
  null, and the floor margin left only 0.005 between real mats (≥0.173) and the
  first off-topic product (0.151).
- (c) "results switch without re-running" — each query variant's search RPC took
  2.6–8.5 s (≈2.2 s of that PostgreSQL planning), straddling the 8 s statement
  timeout; the edge function silently merged only the variants that survived, so
  any auto-refresh re-rolled the result set. A single 4 s text-embed timeout had
  the same effect (silent keyword-only downgrade).

## Shipped and live (merged to popdam3 main, deployed)

- PR #582: per-variant RPC retry; after the retry ANY failed variant fails the
  whole search (503) — partial merges are impossible; embed retried once;
  picture floor margin 0.045 → 0.035 (evidence in `semantic-floor.ts`);
  frontend retries hybrid once before keyword fallback and sticky-returns the
  last good search mode.
- PR #586: when the semantic leg is active the anchor is REQUIRED (retried once,
  then the search fails) — a failed anchor can no longer remove the floor and
  flood results. Found by live probing after #582.
- PR #584 (another session, same area): "outdoor mat" coir variant word matching.
- Live battery after both deploys (service-role, 6 consecutive calls,
  "spiderman coir", style groups): identical responses every time — 15 rows,
  total 10, exact, siglip2, ~7 s each. The junk-flood state is gone.
- Known benign residual: the RPC still costs ~7 s per call until the shared-db
  migration below promotes; group counts drift a little hour-to-hour because
  `trg_dam_search_assets_refresh` rewrites group search keys as NAS files change
  (index tracks reality; e.g. two groups lost the 'spiderman' lexeme between
  16:00 and 17:30 on 2026-10-29).

## One step from landing: shared-db PR #5036 (claim #5041, issue #4508)

- Migration `20261029161104_dam_search_plan_cost_dedupe.sql`: factors the
  per-asset visibility predicate into planner-opaque
  `public.dam_asset_matches_filters` (its per-function SET search_path blocks
  inlining — that opacity is the mechanism). Parse+plan measured 2,256/2,076 ms
  → 14.7/13.5 ms; results byte-identical to the live function across six cases
  (money query ×2, asset leg, broad truncated probe, deep paging, fileType
  filter). Muse review APPROVE at head e169d753 (three REJECT rounds fixed
  first). Contract tests updated (`popdam_ranked_filter_parity_contracts.sql`).
  Evidence pair `.agent/work/4508/8/` + published ref `refs/db-contracts/4508/8`.
- BLOCKED ON: PR #5045 (another session, Master Data #5037) applied migration
  20261029160047 to preview ahead of merge; the preview workflow refuses while
  preview's ledger holds a version absent from main. A coordination note is on
  #5045. When it merges: re-run the preview dispatch (command in the PR
  discussion), merge #5036, then the production promotion flow
  (`ai-task-gates check --before shared-db-promotion` first).
- Claim lease: 1 h; keep `--check-in-author` current (next due ~19:05Z). Owner
  label: `ZCode chat e0cd8b5b-7ad0-4808-8171-b61d90f08b82 on hetz`, worktree
  `/worksp/shared-db/.wt-4508-searchfix`.

## In flight: exact counts (no more "N+")

A subagent owns eliminating estimated counts end-to-end: shared-db exact totals
(replacing the 1001-asset lower-bound probe) + popdam3 `formatCount` "+"
removal + the merged-total-vs-union consistency fix (live example: 15 rows,
total 10). It is gated on #5036 merging (same objects) and inherits the full
lane recipe in its brief.

## Done-when

"spiderman coir" in the live app: same result set every refresh, only Spider-Man
coir/floor mats, all known ones present, calls comfortably under timeout after
#5036 promotes, and no "+" estimates anywhere.
