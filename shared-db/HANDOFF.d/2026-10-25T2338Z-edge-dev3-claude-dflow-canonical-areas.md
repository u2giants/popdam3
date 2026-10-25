---
issue: 4248
status: OPEN
owner: Claude chat 499ab0d0 on edge-dev3
---

# DesignFlow legacy → canonical: area issues claimed, factory review pending (2026-10-25)

Supersedes the handoff on unmerged branch `claude/licensor-royalty-rates-columns-53a904`
(`HANDOFF.d/2026-10-23T2021Z-edge-dev3-claude-designflow-value-mapping.md`). That
file was deliberately NOT merged: it names suppliers, and this repo is public.

## 1. Background

POP Creations' product-lifecycle app DesignFlow is moving off legacy-shaped
tables (`dflow_prod`, a 1:1 copy of its old Cloud SQL database) onto the
canonical shared tables (`core.*`, `plm.*`, `app.*`) in production Supabase.
Parent issue #4248. ColdLion (the ERP) is the authority for items, licensors,
divisions, vendors and merch groups.

## 2. Done (all on `main`)

- Docs: PR #4697 (merged 2026-10-23 5:36 PM EDT), #4754 (2026-10-25 10:00 AM EDT),
  #4769 (2026-10-25 2:43 PM EDT).
  - `docs/verification/cloudsql-piecemeal-cutover-20261002/designflow-legacy-column-gap-analysis.md`
  - `docs/verification/cloudsql-piecemeal-cutover-20261002/designflow-legacy-column-crosswalk.md`
    (dispositions: covered 122, add 263, reshape 153, not needed 382, do not move 3 = 923)
  - The 923-row crosswalk CSV lives in the PRIVATE repo `u2giants/licensor-source-data`
    under `shared-db-relocated/2026-10-23/...` (linked from `docs/private-data-artifacts.md`).
    The public data venue guard fails any PR that adds a data CSV to this repo.
  - Every owner ruling is in `docs/designflow-cloudsql-to-supabase-plan.md`,
    section "Value-mapping decisions (owner rulings)".
- Area issues opened under #4248 and claimed (claim issue in brackets):
  license agreements #4705 (#4719) → `core.merch_group` load #4706 (#4722) →
  items + child tables #4707 (#4723) → factories #4708 (#4749) → RFQ #4709 (#4720)
  → production orders #4710 (#4721). Each issue body lists its exact objects
  and `depends_on`.
- 38 unmatched item size codes: resolved without owner review. They are
  written-out dimensions (`15X15`) that match an active `core.product_size` label;
  `12X12` → active code `21` (not inactive `TT`).

## 3. Owner rulings this session (2026-10-23/25, Albert; recorded in the plan)

- Factory party type: factory / trading company / both; link table
  `core.factory_representation` (trading company ↔ factories it represents).
- Future quality metrics on factories: orders completed, orders with a problem
  (unused at first).
- Product categories per factory: `core.factory_product_category` → existing,
  empty `core.product_category`, to be loaded from Albert's 22-category list
  (`/home/ahazan/Dropbox/ai/product_categories.csv`, private).
- Friends TV (`FR`) deleted: already absent from `core.licensor`; its 2
  DesignFlow items map to no licensor.
- Nickname: `core.factory.display_name`. DesignFlow `factory_name` → new
  `trade_name`; `core.factory.name` keeps the ColdLion legal name.

## 4. Open / blocked

- **Factory review workbook — waiting on Albert.**
  `/home/ahazan/Dropbox/ai/factory-review.xlsx` (private; copy in worktree
  `.private/`, gitignored). Tabs: Factories (ColdLion vendor, party type,
  representing trading co., trade name, nickname, reps, keep, 5 product
  categories — all dropdowns), DesignFlow logins (171 logins → factory, keep).
  Labels are "nickname (DesignFlow ID)". When editing it with openpyxl:
  Excel re-saves dropdowns in an extension openpyxl DROPS — rebuild every data
  validation after saving and verify the count (Factories 5, logins 2). Always
  carry Albert's entered cells across; back up his copy first.
- Structural work in each area issue has not started. Claim leases expire;
  `--renew-claim` needs a PR. If a lease expired, release and re-claim with
  `--task "#<issue> …"` (claim titles must start `CLAIM: #<issue>`).
- Production orders need a ColdLion production-order load first; none exists.

## 5. Next steps

1. When Albert returns the workbook: record per-factory decisions privately
   (never supplier rows in this repo); done when every DesignFlow factory has a
   ColdLion code or "not in ColdLion", a party type and a keep flag.
2. Work the area issues in order (#4705 first), following `shared-db-change`.
   Done per issue when its claimed objects exist in production with live proof.

## 6. Traps learned

- Docs PRs must say a single `Refs #4248`. A PR body naming two issues was
  routed to the guarded-migration merge and refused for lack of an evidence
  pair; reopening fresh fixed it.
- `ai-pr-wait` refuses on docs-only branches (pre-existing broken link check);
  use a Monitor on the PR's merge state.
- The `ai-task-gates` class escalates to `code` if a CSV is in the diff.
- `core.merch_group` is empty; the loaded list is legacy `core."merchGroup"`.

Written 7:38 PM EDT, 2026-10-25.

## Completeness check

- Fresh developer could continue? Yes: §1 background, §2 exact issue/claim
  numbers and file paths, §5 ordered steps with done-when.
- As well as this session? Yes: §3 rulings, §4 tooling quirks (workbook
  validation loss, lease renewal), §6 merge traps.
- Every detail? Yes; gap found and fixed during writing: claim-title format
  and lease-expiry recovery (§4).
