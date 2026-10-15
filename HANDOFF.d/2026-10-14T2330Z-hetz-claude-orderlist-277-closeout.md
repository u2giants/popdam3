---
issue: 277
status: OPEN
owner: claude/dc613850-0af2-4c30-bad4-7e2dfc9f24de
---

# OrderList #277 close-out — dates, exceptions, assortment pairs (2026-10-14)

Written 2026-10-14 ~7:30 PM EDT on machine `hetz` by Claude chat
`dc613850-0af2-4c30-bad4-7e2dfc9f24de`. Card: https://github.com/u2giants/popdam3/issues/277.
It replaces the retired predecessor handoff (deleted in
https://github.com/u2giants/popdam3/pull/407).

## 1. Application

PopDAM is POP Creations' internal artwork and order browser; the OrderList screen
(https://dam.designflow.app/orders) merges Google "Order" sheet rows and ColdLion
ERP lines. Shared Supabase production: Virginia project `qsllyeztdwjgirsysgai`.
Structure lives in https://github.com/popcre/shared-db. Read
https://github.com/u2giants/popdam3/blob/main/AGENTS.md and
https://github.com/u2giants/popdam3/blob/main/docs/ORDER_LIST.md.

## 2. What is DONE and proven live (do not replay)

- **Source55** (55 settled Google corrections): applied once via
  https://github.com/u2giants/popdam3/pull/373 (executor trust-anchor fix 227d420,
  Muse APPROVE). 40 headers / 253 lines inserted, 0 deletes. Authenticated UI and
  screen Refresh retention proven (comment on #277).
- **PO no-reuse guard** shared-db version 20261013201822: in production
  (run https://github.com/popcre/shared-db/actions/runs/38652075902). A rolled-back
  probe reusing D3682 was refused. Claim #4258 released.
- **SO Date**: shared-db version 20261013211042 in production
  (https://github.com/popcre/shared-db/actions/runs/38638382542); frontend
  https://github.com/u2giants/popdam3/pull/377 deployed (build 4ae26ca); both
  tooltips proven live. Claim #4269 released.
- **Yuchen's answers** (workbook received 2026-10-14): Q1/Q2 (Ross D3705/D3706)
  are separate orders — no change; D3705/D3706 will be entered in ColdLion this
  week by Yuchen. Q3: all 20 assortment pairs are one purchase each.
- **20 assortment pairs**: https://github.com/u2giants/popdam3/pull/405
  (https://github.com/u2giants/popdam3/blob/main/scripts/apply-orderlist-assortment-pairs.py)
  applied once: 20 ColdLion lines moved under Google headers D3682–D3689, Google
  line refs `order:row:<n>` added, Google line dates set, 0 deletes, total lines
  24,837 unchanged; live screen proof after Refresh.

## 3. What is NOT done

1. **Live Google check of the 20 pairs' dates.** The Google Sheets connector
   loaded spreadsheet metadata but every cell read returned "service unavailable".
   Dates came from stored Google lines for the same customer POs (refreshed
   2026-10-13 3:01 PM EDT), which equal Yuchen's 2026-10-13 sheet check. The
   regular Google importer SKIPS these special-assortment rows, so it will not
   refresh them. Next step: read sheet `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`
   tab `Order` rows 12456–12460, 12469–12473, 12482–12486, 12495–12499 (Import PO,
   customer PO, assortment ID, quantity, start ship, cancel, cargo forecast) and
   compare with `api.dam_order_list` where `production_order_number` in D3682..D3689.
   If any differ, fix only those fields through a reviewed guarded change like #405.
2. **Claim #4152** (licensing, version 20261013130102, PR #4206 merged by MiMo on
   WIN-DEV-2): still owned by this chat in `relinquished` state with ready receipt
   `refs/db-author-handoff-ready/4152-20261013130102-de692d40fb08f2c559c55870`.
   Not in the production ledger at 7:23 PM EDT. That licensing workstream's owner
   (see https://github.com/popcre/shared-db/issues/2336) accepts it natively
   (`--handoff-claim-author`) or releases it after promotion. Do not touch otherwise.
3. **Work issues** https://github.com/popcre/shared-db/issues/4257 and
   https://github.com/popcre/shared-db/issues/4268 remain open with live-proof
   comments; record completion with the lane's `--complete-work` report and close.
4. **ColdLion re-intake caveat** (same as the 308 #367 merges): if ColdLion re-sends
   a modified SO (7128043–7128046), its writer may update those lines' fields.
   Acceptance of ordinary intake preservation stays an open #277 item.
5. Obsolete: https://github.com/popcre/shared-db/pull/4301 (closed by MiMo's
   collision hold; superseded by #4294). Branch `claude/owner-restricted-reviewer-reuse`
   and its worktree on hetz can be deleted.

## 4. What did not work

- Muse-only allowlist on #4206 blocked slot 2; owner-widening hit the review
  circuit breaker. Resolved by the other session's #4294.
- `prepare-preview-dispatch` needs `SUPABASE_ACCESS_TOKEN` (1Password item
  "Supabase CLI Personal Access Token", field `SUPABASE_ACCESS_TOKEN`) and the
  preview apply run linked from the work issue as an `actions/runs/<id>` URL.
- Automatic production needs a post-merge `production-risk-assessment` block from
  an allocator slot (3, 4, …) naming the exact main SHA; if main moves, redo it.
  Hold `--acquire-promotion-freeze` while promoting.
- Google Sheets connector cell reads failed repeatedly (2026-10-14 ~7:20 PM EDT).

## 5. Access

DB password: 1Password vault `vibe_coding` item `246sf23gymd64yudpmhswcnyle`
(pipe via stdin only; TLS verify-full with
https://github.com/u2giants/popdam3/blob/main/shared-db/scripts/certs/supabase-root-2021.crt).
Admin UI tester: item `7s5uzpbjenka4fpvrqogh44bre`. Protected private inputs and
receipts live in this machine's popdam recovery collection
`20261013-yuchen-responses` (`assortment20/plan.json` sha aa3fd43a…), never in Git.

## Self-audit

A newcomer knows what is live, what is left (items 1–4), how to do each, and what
failed before. Yes.
