---
issue: 4508
status: BLOCKED
owner: zcode/4508-search-rpc-plan-cost
---

# Handoff — spiderman coir search: stability LIVE, DB speed fix parked at the merge queue

Supersedes `HANDOFF.d/2026-10-29T1805Z-hetz-zcode-spiderman-coir-search.md` (merged as PR #588). Machine-local paths appear only where the successor must know a worktree location on hetz; every artifact is named by GitHub URL below.

## 1. What this is

Albert's "spiderman coir" search (a) showed too few results, (b) showed off-topic products, (c) flipped between those states without a re-search, and (d) showed "140+" estimated counts. Continuation of the [spiderman-coir handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-29T1416Z-hetz-claude-spiderman-coir-search.md).

## 2. What is DONE and live

- **Diagnosis (production, read-only, 2026-10-29):** the 13 groups · 105 files were NOT the complete truth — Albert's yardstick (Item Master `vd*mvsp`) shows **9 active items; search finds 8; VDP83MVSP01 is missing**. Flipping came from per-variant RPC runtimes of 2.6–8.5 s (≈2.2 s PostgreSQL planning) straddling the 8 s timeout, with the edge function silently merging surviving variants; plus a failed anchor silently removing the picture-match floor (live-measured junk flood: 288 groups).
- **Shipped to popdam3 main and deployed:** [#582](https://github.com/u2giants/popdam3/pull/582) (per-variant retry; ANY failed variant fails the whole search; embed retried; floor margin 0.045→0.035 with evidence in `semantic-floor.ts`; frontend sticky search mode + hybrid retry) and [#586](https://github.com/u2giants/popdam3/pull/586) (anchor failure fails the search instead of disabling the floor). Live battery after deploy: 6 consecutive identical responses for the exact query (15 rows, exact totals, ~7 s). [#587](https://github.com/u2giants/popdam3/pull/587) (counts agent) fixed the merged-total inconsistency. Staged and correctly HELD: [#589](https://github.com/u2giants/popdam3/pull/589) removes the "+" estimate display — merge only after the RPC exact-totals change is live in production.

## 3. What is PARKED (shared-db) — the exact resume path

The database half of the fix (planning 2.2 s → 14 ms) is finished, approved, preview-applied, fully green, and blocked only by a merge-queue wiring gap. Full nine-point handover with timestamps: [issue #4508 comment](https://github.com/popcre/shared-db/issues/4508#issuecomment-6514345290). Summary:
- PR [popcre/shared-db#5075](https://github.com/popcre/shared-db/pull/5075) (closed-resumable, branch `zcode/4508-search-rpc-plan-cost`, worktree `/worksp/shared-db/.wt-4508-searchfix` on hetz, clean at `2a0f16d2f4152374d10acd972c07b799fdfcee4a`), migration `20261030014205`.
- Blocker: the queue's `Post-merge preview rehearsal` commit status never lands on main `565ea646`/`22227a6c2` (the historical-recovery lane produces evidence but only the `merged_preview_source_pr` lane posts the status, and that lane refuses for already-applied versions). Needs the merge-queue machinery owner; see `scripts/merge-queue-contract.mjs` `awaitPreviewRehearsal` and workflow line ~1024.
- Along the way this session also took over two idle lanes per Albert's instruction and landed them: [#5045](https://github.com/popcre/shared-db/pull/5045) (merged 00:37Z, audit [#5061](https://github.com/popcre/shared-db/issues/5061)) and [#5066](https://github.com/popcre/shared-db/pull/5066) (merged 01:41Z, audit [#5073](https://github.com/popcre/shared-db/issues/5073)). Their production promotions wait on the same hold.
- Claims all released; `ai-shared-db-closeout-check` ok (zero owned).

## 4. The recall gap Albert must know about (found via his Item-Master yardstick)

`VDP83MVSP01` (real Spider-Man coir mat, 14 files, under "Forman Mills/2026/Floor 2026") cannot be found by "spiderman coir": its folder says nothing textual about Spider-Man or coir, its **style-group embedding scores 0.0** (broken primary image — likely a licensing/packaging text page, worth its own fix in group primary selection), and its member artwork scores 0.116–0.157 — the same band as off-topic Spider-Man products (first junk at 0.151). Picture-only search cannot both include it and exclude lookalikes; the bands overlap. Durable cures: (a) fix group primary selection so the group vector isn't a text page, (b) let the existing ERP/AI category pipeline reach these SKUs (`product_category` is still NULL for VDP83MVSP01, VDDS2MVSP01, VDCS2MVSP02, VDE86MVSP01). Do NOT pattern-match SKUs in the search (Albert's explicit instruction).

## 5. In flight at wrap-up (not started by me after the freeze)

- Exact-counts work: design + measured migration draft by the counts subagent on [popcre/shared-db#5053](https://github.com/popcre/shared-db/issues/5053) (comment with full artifacts); real numbers verified ("spiderman" groups = 1,325 exact, not "98+"). Its shared-db execution was gated on #5075 and inherits the same queue blocker. [#589](https://github.com/u2giants/popdam3/pull/589) held open until that lands.

## 6. What we tried that did NOT work (condensed; full list on the #4508 note)

Full-history preview push (sibling's preview-only version refuses it — atomic allowlist binding fixed it); four Muse review rounds (all findings fixed: `a.modified_at`→`p_asset.modified_at` pin, dead `reverse(needle-in-forward-haystack)` assertion, quoted-key coverage, opacity mechanism + SET pin); squash-merging in the queue (it is MERGE-method); reopening a force-pushed PR (GitHub refuses — new PR each rename); leaving the claim idle >1 h (watchdog parks it — keep `--check-in-author` current every ≤30 min while active).

## 7. Facts that may be stale

Main tip `22227a6c2` at 03:55Z 2026-10-30; max migration on main `20261029213845`; group counts drift hour-to-hour via `trg_dam_search_assets_refresh` (two groups lost the `spiderman` lexeme between 16:00 and 17:30 on 10-29 — that churn is live NAS data, not a defect). Deployed frontend build from #582 (17:17Z); #586/#587 are edge-function deploys.

## 8. Success check for the whole job

"spiderman coir" in the live app: identical results on every refresh (TRUE today), only Spider-Man coir mats with all 9 Item-Master vd*mvsp items eventually findable (8/9 today; VDP83MVSP01 needs §4), calls comfortably under timeout (needs #5075 merged + promoted), no "+" estimates (needs #5053 + #589).

## 9. Self-audit

A cold session can: verify live stability (query the app), resume PR #5075 via the #4508 note's exact steps, decide/execute the rehearsal-status wiring question, then merge #589 and execute #5053's drafted migration. All three lanes (4508 search, 5053 counts, 5064/5037 promoted takeovers) have named issue cards with owners or parked branches.
