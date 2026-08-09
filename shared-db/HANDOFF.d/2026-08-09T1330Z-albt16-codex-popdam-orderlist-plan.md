# PopDAM OrderList plan handoff

## 1. What this application is

PopDAM is POP Creations' digital asset and product-data application at `https://dam.designflow.app`. The planned `/orders` page will replace the operational Google OrderList sheet while preserving the business columns staff know. `u2giants/shared-db` owns the shared Supabase schema used by PopDAM, PopPIM, PopCRM, and DesignFlow PLM. PopDAM application code lives in the separate `u2giants/popdam-web` repository.

The canonical product list is `plm.item`. There is no `core.item`. Master Data is stored in `public.style_tracker_rows` and reaches the final PLM item through `plm.style_tracker_item_bridge`. Production-order lines already have the final relationship `plm.production_order_line.item_id -> plm.item.id`.

## 2. What this session set out to do, and why

Albert asked for a detailed implementation plan for a PopDAM replica of Google OrderList linked to Master Data. He clarified that Google OrderList rows and future Coldlion API production orders describe the same orders, that `plm.item` should be the ultimate product list, and that every spreadsheet formula must be inspected and documented. This phase performed the read-only spreadsheet investigation and revised the plan. It deliberately did not start database or application implementation.

## 3. Current state

Phase 0 is complete. The authoritative plan is `plan_popdam_order_list.md`; its STATUS table marks Step 0 done on 2026-08-09 and makes Step 1 the next action. The detailed row and field contract is `docs/app-migration-notes/popdam-order-list.md`. The complete 16-tab formula census is `docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md` and was refreshed against the 2026-08-08 workbook version.

The audit found 12,328 populated Order rows: 8,412 direct-SKU-only rows, 3,899 assortment-only rows, 3 rows with both shapes, and 14 with neither. Valid assortment rows contain 15,816 component SKUs. Direct and valid component SKUs had zero unmatched Master Data values, but 449 matches are ambiguous because Master Data itself contains duplicate normalized SKUs. No universal Google-only key can safely prove that a future Coldlion row is the same line. The plan therefore requires separate header and line source-reference tables so Google and Coldlion IDs can point to the same canonical records.

No schema, database, production, or PopDAM code changes were made. Documentation commit `00c5e9cb764ec23b630b18c5b061ea84f4224f01` passed all GitHub checks and was merged to `main` through PR `#598` at merge commit `d81606766fc9c8c67d24c8f0bb83c2468bd5dfde`. This follow-up sentence is the only post-merge documentation correction; its own final merge is recorded in the closing task report and Git history.

## 4. Everything tried that did not work

- A previously proposed reference importer, `scripts/import-style-tracker-xlsx.py`, does not exist here. The plan now states the required import-safety behavior directly.
- A single `(source_system, source_id)` on each order row cannot preserve both Google and later Coldlion identities. Dedicated many-to-one source-reference tables are required.
- `PO + SKU`, `PO + SKU + quantity`, and similar Google-only combinations are not unique enough to claim Coldlion rows safely. The real Coldlion payload must be profiled before its exact claim key is locked.
- Treating every mixed Licensed/Generic discriminator as invalid is wrong. Many are valid assortments whose newline-aligned components span both Master Data tabs.
- Choosing the first or most frequent repeated PO header value is unsafe. Vendor, customer, status, and ordering-company conflicts must be quarantined.
- The sheet's `Order Tab Line#` helper cannot be used as an ID. It is blank for 12,327 populated rows and contains one `#REF!`.

## 5. Root causes and key findings

- Google OrderList is an operational order model. The two Master Data tabs are product catalogs. Their relationship is normalized SKU plus Licensed/Generic type, not row number or description.
- One Google assortment row is a staging parent that expands into several canonical production-order lines. Component ordinal belongs in its source key. The sheet has no reliable component-quantity helper, so quantities must never be guessed.
- Google and Coldlion are two identities for the same canonical orders. The plan adds `plm.production_order_source_ref` and `plm.production_order_line_source_ref`, each unique on `(source_system, source_id)`.
- `plm.item` is the ultimate product list. Master Data is conceptually linked already, but the active ERP relocation plan still owns populating `plm.item` and repointing the bridge from `public.erp_items_current` to `plm.item`.
- The exact 48-column A:AV map, invalid-value inventory, PO conflicts, duplicate-key measurements, and source-ID rules are in `docs/app-migration-notes/popdam-order-list.md`.

## 6. Exact next steps

1. Read the STATUS table in `plan_popdam_order_list.md`, both audit documents, then Sections 1, 8, 9, 11, and 13. Success means Step 0 is not repeated and the source-reference and assortment rules are understood.
2. Coordinate with active `fix_schema_for_api.md` before writing `plm.production_order*`, `plm.item`, or bridge objects. Success means ownership and order of overlapping changes are explicit.
3. Run the collision command exactly as written in plan Step 1.1 from a clean current-main worktree and inspect open PRs manually. Success means it exits 0, the claim is open, the migration version is unique, and no overlapping writes exist.
4. Execute Phase 1, including the additive schema, source-reference tables, API view or RPC rules, and SQL tests. Success means `scripts/check-sql.sh` and contract tests pass.
5. At each phase end, follow its end-of-phase rule: re-read every remaining phase and Section 13, then record drift. Each phase's own verification gate defines success through production and cleanup.

## 7. Constraints and gotchas

- `shared-db` uses branch plus PR. Schema is preview first. Production promotion needs a separately approved window.
- Prove the live database target immediately before every write. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.
- Do not create app-repo schema migrations. Shared schema belongs here.
- Do not add a permanent FK from order lines to `style_tracker_rows`; use `item_id -> plm.item` and the bridge for live Master Data display.
- Do not fuzzy-match SKUs, choose among duplicates, guess assortment quantities, hard-delete orders, expose the page in PopSG, or commit raw workbook/customer order data.
- The active ERP plan is a dependency. Coordinate object ownership, then follow the planned sequence.

## 8. Access and environment

The Google Drive/Sheets connection can read the sources. OrderList spreadsheet ID is `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, tab gid `0`. Master Data spreadsheet ID is `1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214`; Licensed gid is `381648817` and Generic gid is `2144577418`. GitHub CLI supports the shared-db PR flow. Secrets belong only in the `vibe_coding` 1Password vault; none were read or written.

The audit was read-only. No database target was connected and no proof authorizes a future write. A new session must perform its own immediate proof.

## 9. Open questions and risks

- 2026-08-09: the exact Coldlion line-claim key remains open until a real API payload exists. Attach only on an exact unique candidate; otherwise quarantine without creating a duplicate.
- 2026-08-09: the ERP relocation plan owns bridge repointing and the native Coldlion feed. OrderList must not create competing versions.
- 2026-08-09: 449 direct or component matches are ambiguous because Master Data has duplicate normalized SKUs. This is visible data quality, not permission to choose the first row.
- 2026-08-09: 10 assortment rows have misaligned component lists, 14 rows lack both SKU shapes, and 3 have both. Preserve their evidence but do not create automatic canonical lines until reviewed.

## Self-audit

1. **Yes, a brand-new developer can continue without questions.** Sections 1 and 2 explain the applications, goal, repositories, and data relationship. Sections 3 and 6 give the exact state, files, next action, and verification gates.
2. **Yes, the developer can continue with this session's full knowledge.** Sections 4 and 5 preserve failed approaches, profile conclusions, identity design, assortment behavior, and ERP dependency. The linked plan and audits carry every formula and the field map.
3. **Yes, every execution-critical detail is present.** Sections 7 through 9 cover branch and database safety, exact source IDs and environments, access boundaries, risks, and the fact that must wait for a real Coldlion payload. No secrets or raw business rows are included.
