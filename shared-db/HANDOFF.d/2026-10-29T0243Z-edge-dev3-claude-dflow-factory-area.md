---
issue: 4708
status: OPEN
owner: claude/factory-area-handoff
---

# Handoff — DesignFlow factory area (issue #4708)

Written 2026-10-28 10:43 PM EDT by Claude chat 499ab0d0 on edge-dev3. The owner
ruled the session too long; a NEW session builds the factory area.

## 0. Business decisions only the owner can make

None remaining — every factory ruling is settled. **Already settled, do NOT re-ask:**

- 2026-10-25: a factory record needs a party type (factory vs trading company) and a
  link from a trading company to the factories it represents; blank "represented by"
  means POP deals directly.
- 2026-10-25: future fields "orders completed" and "problem on order" (empty now).
- 2026-10-25: delete Friends TV (FR). Product categories come from the owner's
  22-category list (stored privately, see §8).
- 2026-10-27: the owner's review workbook (Kelly and Billy edition) is the truth:
  73 factories kept, 103 dropped, 70 logins kept; 8 logins of dropped factories and
  the Tufko factory inactivated. Party types for Floor Gardens and Hangzhou Before &
  Future = factory; KanKan Merchandising, Kaya Home, Ningbo Reho = trading company.
- 2026-10-28: Ningbo Wahfay Group = ColdLion vendor CNWAH (production PO D3501).

Waiting on (not a decision): Jamielynn (POP staff) to type the name into ColdLion
vendor CNWAH; it was still blank at the 2026-10-28 6:40 PM EDT pull. Do not block on it.

## 1. What this is

popcre/shared-db is the shared Supabase database for POP Creations' apps. DesignFlow
(the product-development app, Google Cloud SQL, schema mirrored read-only as
`dflow_prod`) is being moved into shared Supabase, area by area, under umbrella issue
#4248. Plan: https://github.com/popcre/shared-db/blob/main/docs/designflow-cloudsql-to-supabase-plan.md
(section "Value-mapping decisions (owner rulings)").

**"Factory area" explained.** `core.factory` already exists (93 rows, built from an
older ColdLion import). The area is NOT a new factory table. It is: (a) adding the
new columns/tables the owner ruled (party type, represented-by, product categories,
order counters, vendor-login links, reps) to the existing one, and (b) loading the
owner's reviewed data into it, so DesignFlow can stop using its own vendor table.

## 2. Goal

Done when, on production: `core.factory` holds exactly the owner's 73 kept factories
with party type, ColdLion code, trading-company links, product categories, reps and
logins as in the workbook, and issue #4708 shows the live proof.

## 3. Current state (verified 2026-10-28)

- Nothing built yet. Claim issue #4749 ("CLAIM: #4708 DesignFlow factories", owner
  "Claude chat 499ab0d0 on edge-dev3") reserves: core.factory, core.factory_rep,
  core.factory_vendor_login, core.factory_representation,
  core.factory_product_category, core.product_category. Its branch name
  `claude/dflow-factories` was never pushed.
- Owner workbook (private, NOT in git): owner's Dropbox `ai/Factory-review_kelly_and_billy.xlsx`.
  Tabs: Factories (176 rows; YOUR columns I–T; "Keep? (Y/N)" in O; cleanup notes U),
  DesignFlow logins, ColdLion vendors (98 after 2026-10-28 cleanup), Lists, hidden _ids.
- ColdLion (`coldlion.vendor`, refreshed nightly 05:20 UTC by
  https://github.com/popcre/shared-db/blob/main/.github/workflows/coldlion-landing-sync.yml):
  101 rows; CNHUS, CNMHA, CNXFA were deleted at source on 2026-10-28 (last_seen stays
  07:28 EDT — treat as gone); CNTTY now active='N'. Kept factories using CNMHA were
  repointed to CNTMWA in the workbook.
- `core.factory` gaps vs ColdLion: missing 8 vendors (incl. CNWAH); still holds old
  codes 147, 457, 472 which are now SKSMB, CNSHAO, CNXJY.
- Findings log: comments on issue #4708.

## 4. Dead ends

- Putting supplier names/CSV in this public repo: blocked by the public data venue
  guard. Private data goes to u2giants/licensor-source-data (see
  https://github.com/popcre/shared-db/blob/main/docs/private-data-artifacts.md).
- Excel re-saves drop the workbook dropdowns; rebuild all validations (Factories 5,
  logins 2) whenever writing the file with openpyxl.
- Docs PR naming two issues was routed to guarded merge and refused; use `Refs #4248` only.
- Claim titles without `#N` were rejected; titles must start `CLAIM: #N`.

## 5. Key findings

- Same company twice in ColdLion is common; ColdLion is the code authority, the
  workbook's ColdLion column is the mapping to use.
- DesignFlow factory 165 = Wahfay = CNWAH (ColdLion has no name; use the workbook name).
- DesignFlow party data lives in `dflow_prod` vendor/login tables; logins map to
  factories via the workbook's logins tab column I (shown as "nickname (ID)").

## 6. Next steps

1. Take over claim #4749: `node scripts/manage-migration-author-lanes.mjs
   --transfer-claim-author` with `--old-owner "Claude chat 499ab0d0 on edge-dev3"
   --new-owner "<you>"` (check the script's required flags). Load the
   `shared-db-change` skill first; declare `ai-task-gates start --class shared-db`.
   Done when #4749's lease names you.
2. Write the migration for the claimed objects (columns + tables from §0). Done when
   it passes preview and an in-rotation AI reviewer APPROVEs the exact head.
3. Export the workbook's kept rows to the private repo as the load source; write the
   curated Master Data load. Done when preview shows 73 factories, every kept row
   has a party type, CNWAH named "Ningbo Wahfay Group".
4. Promote; prove on production with counts posted to #4708. Release #4749 with
   `--confirm-finished`; delete this file.

## 7. Constraints

Claim-first; own worktree from origin/main; never put supplier names in this repo;
production write only via the reviewed promotion path; sign GitHub posts.

## 8. Access

Supabase MCP (read), `gh` as u2giants, workbook in owner Dropbox. Product category
list: owner Dropbox `ai/product_categories.csv` (22 rows). Secrets: 1Password vault
`vibe_coding`.

## 9. Risks

- If ColdLion changes again before the load, re-pull (dispatch the sync workflow,
  operation=refresh) and re-check the workbook codes against `coldlion.vendor`.
- Other DesignFlow area claims held by the same old owner (#4719, #4720, #4721,
  #4722, #4723) are untouched and also need transfer by whoever takes them.

Self-audit: §0 sweep done (only Jamielynn wait, non-decision); dead ends §4; state §3; gated steps §6.
