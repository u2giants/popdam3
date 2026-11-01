---
issue: 4931                           # popcre/shared-db#4931 (cross-repo; this file lives in u2giants/popdam)
status: OPEN
owner: claude/orderlist-data-merge-055b0c (coordinator session) + child "Fix ColdLion component identity; repair 61 orders"
---

# ColdLion ↔ OrderList merge — coordinator handoff (2026-11-01 00:05 UTC / 2026-10-31 8:05 PM EDT)

This one file covers BOTH the coordinator session (popdam worktree `orderlist-data-merge-055b0c`)
and its child session "Fix ColdLion component identity; repair 61 orders", which grew too long.
Both are being retired; a fresh coordinator continues from here.

## 0. ⚠️ Business decisions only the owner can make

**None blocking.** Nothing in this workstream needs Albert.

Not Albert's — a human reviewer's (Yuchen): the live OrderList "To reconcile" page holds
~167 ColdLion↔Google pairs the system deliberately will not merge on its own (double matches,
ambiguous matches). Albert said 2026-10-30: "i can't, only yuchen can". The coordinator only
reports progress on this; it never asks Albert to reconcile.

**Already settled — do NOT re-ask:**
- 2026-10-28, Albert: "Yes, automatically" — ColdLion lines merge automatically into the single
  matching Google OrderList line on the same Import PO, no per-row confirmation.
- Triage rule (owner, recorded by child session ~2026-10-29/30): double matches are NEVER merged
  automatically; they always land on the "To reconcile" page.
- 2026-09-17 (plan C0): one ColdLion sales order can map to many Import POs; never merge headers,
  only move lines.
- DDPVA = DDP ship-to Virginia (recorded in business rules, shared-db PR #5014).

## 1. What this application is

PopDAM (u2giants/popdam) is POP Creations' internal app; its **OrderList** page is the order
tracking grid (replaces a Google Sheet). Order data lives in the shared Supabase database
(project `qsllyeztdwjgirsysgai`), whose structure and ColdLion ingestion code live in
**popcre/shared-db** (synced read-only copy under `shared-db/` in popdam). ColdLion is the ERP;
an hourly "ColdLion order intake" job stages ColdLion sales orders and writes them as lines in
`plm.production_order_line`. Orders that exist only in ColdLion sit on placeholder headers named
`COLDLION-SO-<salesOrderNo>`; Google-sheet orders sit on real Import PO headers (e.g. `D3691`).

## 2. What we set out to do, and why

Albert reported (2026-10-27) customer PO 62004433 showing 3 ColdLion rows + 4 Google rows,
unmerged, with ColdLion's 4th item missing. He asked: why, fix it, and make sure it never
happens again. Scope grew (with his approval) to automatic merging and a review page.

## 3. Current state — what is true right now (verified 2026-10-31)

All merged in popcre/shared-db and live:
- https://github.com/popcre/shared-db/pull/4934 — component lines keyed on item identity, not
  position; repair of affected orders; loud failure on mismatch.
- https://github.com/popcre/shared-db/pull/4972 — automatic merge of ColdLion placeholder lines
  onto the single matching Google line (PR #4945 was its closed predecessor).
- https://github.com/popcre/shared-db/pull/4989 — disagreeing pairs merge and OrderList shows
  both values in a red box (e.g. PO D3708 "Google 1603 | ColdLion 1610").
- https://github.com/popcre/shared-db/pull/5032 — "To reconcile" page can link a ColdLion line to
  a Google line with no customer (Spencer Gifts, item 29).
- https://github.com/popcre/shared-db/pull/5008 + https://github.com/popcre/shared-db/pull/5014 —
  DDPVA routing code; the 5 quarantined Lidl/Burlington orders are now created. Verified: 0
  quarantined orders in `coldlion.intake_new_order`.
- https://github.com/popcre/shared-db/pull/5010 — merge queue waits (≤15 min) for a busy merge
  lane instead of dropping the PR; proved live with two real waits (~1 and ~2 min).

Verified by direct SQL: PO 62004433 = exactly 4 rows on D3691, each linked to the correct
ColdLion component ref; 185 ColdLion lines remain on `COLDLION-SO-*` placeholders (no single
matching Google line — expected; ambiguous ones are on "To reconcile").

Open: tracking issue https://github.com/popcre/shared-db/issues/4931 is still OPEN.
The coordinator's popdam worktree has no code changes; only this handoff file.

## 4. What did NOT work (dead ends)

- Repeatedly re-queueing a PR when the merge queue dropped it: the drops were lock contention, not
  the PR. Fixed permanently by PR #5010; don't hand-time dispatches anymore.
- Child sessions "waiting" by ending their turn: they never woke. Always keep a background waiter
  (`bin/ai-pr-wait <pr>`) or a timer; the coordinator had to nudge them several times.
- Reviews: DeepSeek reviewer failed on its own side once (logged; GLM substituted). A review
  rejected PR #5010 only because the branch was stale vs main — rebase before review.
- The merge gate refused PR #5010 twice over the ticket label (missing, then a disallowed
  category). Check the allowed label set before merging.
- My first diagnosis to Albert (2026-10-27) said the D3691 row had the wrong item; wrong — it
  was an ordinal renumbering, corrected in the next reply.

## 5. Root causes and key findings

- Root cause: `coldlion:so:<so>:line:<n>:component:<ordinal>` used a positional ordinal
  (row_number over sorted components) in
  https://github.com/popcre/shared-db/blob/main/tools/coldlion-landing/lib/order-intake-write.mjs .
  When numbering changed, an existing ref pointing at a line already moved to an Import PO was
  skipped silently, and an item was minted twice. Measured scope at the time: 61 sales orders.
- ColdLion already sends `prod_reference_no` (the Import PO), which the auto-merge now uses.
- Line source refs live in `plm.production_order_line_source_ref`, not only in the line's own
  `source_id` column — check both when verifying.

## 6. Exact next steps (for the new coordinator — open one sub-session per item)

1. **Close out issue #4931** (sub-session in popcre/shared-db): confirm each acceptance item in
   the issue against live data (the recurring mismatch guard passes; 0 missing/duplicated
   component refs vs staging), post signed evidence, close the issue, and retire any shared-db
   HANDOFF.d file for #4931 per the successor rule. Done when #4931 is CLOSED with evidence.
2. **Explain the 5 "extra" live ColdLion lines** (sub-session, read-first): on 2026-10-28 a check
   found 5 live coldlion-source lines whose (sales order, line, SKU) has no match in the latest
   staging observation. Determine whether they are stale versions, cancellations, or a bug; fix
   via the normal governed path if a bug. Done when each of the 5 is explained with evidence.
3. **Child-session closeouts**: confirm the child sessions ("Fix ColdLion component identity",
   "Land ColdLion auto-merge", "Show ColdLion vs Google disagreements", "Unblock 5 ColdLion
   orders", "Make shared-db merge step wait") each pass `ai-shared-db-closeout-check` and that
   their worktrees are clean/removed via `cleanup-worktree`. Done when every check reports ok.
4. **Report Yuchen's progress** on "To reconcile" (count remaining) to Albert once per
   coordinator turn; never ask Albert to act on it.

## 7. Constraints and gotchas

- shared-db: claim-first, exact-head AI review required, merge queue; load `shared-db-change`.
- popdam: branch + PR, never push main; no reviewer needed.
- Coordinator must verify sub-session claims itself (SQL / `gh`) before telling Albert "done".
- Albert reads plain English, ≤120 words, `Still open` block; times in EDT.

## 8. Access and environment

Host Hetz; checkouts `popdam` and `shared-db` under the workspace root. Supabase MCP on project
`qsllyeztdwjgirsysgai`; `gh` authenticated as u2giants. Secrets in 1Password `vibe_coding`.

## 9. Open questions and risks

- 185 placeholder lines stay unmerged until Google rows exist or Yuchen links them (expected).
- The coordinator's own `ai-shared-db-closeout-check` hit a GitHub timeout on 2026-10-31; it held
  no claims (read-only SQL only), but re-run it to get a clean receipt.

## Self-audit (handoff-writer)

1. Newcomer can continue: yes — §1 app, §3 state with PR URLs, §6 steps with done-gates.
2. As well as me: yes — §4 dead ends, §5 root cause and the source-ref table gotcha.
3. Every detail: yes — goals §2, decisions §0, constraints §7, risks §9, verification in §3/§6.
4. Owner sweep: walked §1–§9; only owner-facing item is Yuchen's queue (not Albert's); §0 says so.
