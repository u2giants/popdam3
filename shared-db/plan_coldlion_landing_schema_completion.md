# Implementation plan — complete and correct the ColdLion landing schema

**Written:** 2026-09-02 · **Tracker:** GitHub issue #2081 · **Repository:** `u2giants/shared-db`
**Handoff:** [`HANDOFF.d/2026-09-02T2245Z-edge-dev-codex-coldlion-schema-plan.md`](HANDOFF.d/2026-09-02T2245Z-edge-dev-codex-coldlion-schema-plan.md)

## STATUS

| # | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Production/catalog and live-API audit | done 2026-09-02 | Re-run the read-only queries in §5 and the live-spec census in §12 |
| 1 | Six master feeds: customers, vendors, merchandise-group headers/details, seasons, salespeople | partial | migrations `20260825023430` and `20260902054548`; all tables live but empty |
| 2 | Division reference feed | open | `/divisions` exists in the vendor API; no `coldlion.division` table exists |
| 3 | Item header, item detail, and item merchandise groups | open correction | existing tables predate the 2026-09-01 API shape and D14-D17 |
| 4 | Sales history | open redesign | existing key is superseded; production tables are empty |
| 5 | Production history | open redesign | current field projection and loader contract are stale |
| 6 | Inventory, prepacks, images metadata, pick tickets, receiving, production detail/tracking | open | no production landing tables |
| 7 | Loaders, backfill, monitoring, and consumer-safe contracts | open | no `coldlion` table contains rows |
| 8 | Documentation and tracker closeout | open | issue #2081 remains open |

**Fresh-session starting point:** Step 1 in §9. Do not modify the database from this planning session.

---

# Part 1 — Why

## 1. Ultimate goal

POP Creations needs a complete, trustworthy copy of every ColdLion API feed it has chosen to use. Each source fact must land once, at its real business grain, without losing newly added fields, merging separate order lines, multiplying assortment totals, or inventing relationships the ERP does not provide. The private landing layer must then support governed promotion into canonical/application tables without applications reading it directly.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A migration that applies successfully but can silently lose or misstate business data has failed.

## 2. What this application is

ColdLion is POP Creations' third-party ERP. Data endpoints are rooted at `http://x5.coldlion.com/EhpApi`; the specification is served separately at `http://x5.coldlion.com/EhpApi/v2/api-docs`. The shared Supabase/Postgres database is governed by the public GitHub repository `u2giants/shared-db`. Resolve environment identifiers through the protected configuration helper documented by the `codex-shared-db-change` skill; the repository's `AGENTS.md` remains the controlling runbook.

The `coldlion` schema is a private, source-aligned landing layer. It stores typed source fields, run provenance, hashes, and observation times. It does not resolve source rows to `core.*`, invent licensor/property relationships, or grant application roles direct access.

## 3. What triggered this work

The 2026-09-02 audit found that production has 17 `coldlion` tables but every one contains zero rows. The six master tables have sound natural keys, while item and history tables were created before ColdLion changed its payload on 2026-08-31. The live API now exposes `salesOrderLineNo`, paged history envelopes, returned `stageCode`, per-component quantities, descriptions, and other fields that the applied tables do not fully represent. Issue #2081 also retains 20 unresolved reviewer objections.

Reproduce the central problem read-only:

1. Resolve and quote the production ref.
2. Count rows in every `coldlion` table from `pg_stat_user_tables`.
3. Compare `information_schema.columns` and constraints with the live `/api-docs` definitions.
4. Observe that every table is empty and that `order_history_line` lacks `sales_order_line_no`.

## 4. Scope

In scope:

- correct landing structures for all feeds selected for ingestion;
- add the missing division reference table;
- repair item and history grains against the current API;
- add the remaining requested endpoint tables only after a live field census establishes their grain;
- loaders, paging, three-stage production-history pulls, backfill, monitoring, and completeness evidence;
- private source-to-canonical promotion contracts as separate per-feed decisions;
- reconcile all U1-U20 objections on issue #2081.

Not in this plan:

- direct writes back to ColdLion;
- image bytes or thumbnails; PopDAM remains the image source;
- invented licensor-to-property relationships;
- application access to raw landing tables;
- automatic promotion into `core.*` without a separately reviewed authority rule;
- editing an applied migration; every correction is a new forward migration;
- placing customer identifiers, licensed descriptions, or raw API rows in this public repository.

---

# Part 2 — What we already know

## 5. Current state

Production was verified read-only on 2026-09-02 against the resolved shared production ref.

- Applied spine: `coldlion.sync_run`, `window_ledger`, and `change_log`.
- Applied masters: `customer`, `vendor`, `merch_group_header`, `merch_group_detail`, `season`, and `salesperson`.
- Applied but stale/unloaded: `item_header`, `item_detail`, `item_merch_group`, two sales-history tables, and three production-history tables.
- All 17 tables have RLS enabled and no application-facing access policy.
- Every table has zero rows.
- Current-state tables have primary keys. History tables use unique constraints but no primary key; their only foreign key is `run_id`, so component rows are not relationally tied to their parent line version.
- Migrations `20260818232639`, `20260825023430`, `20260825225510`, and `20260902054548` are applied. Never edit their bytes.
- The old plan status table is not delivery evidence. Issue #1184 was closed after structural creation, while #2081 correctly tracks redesign and loading.

> **SETTLED — do not re-open.** All 29 `/vendors` fields were ruled by the owner on
> 2026-08-19 (10 ingest, 19 **DECLINED**) in
> `docs/coldlion-field-decisions-20260819.csv`, and the ruling was **re-verified against
> the live feed on 2026-09-03 with an identical field-name set**. Vendor addresses,
> `zipCode`, `state`, `email` and `phoneNo` are **DECLINED** — not pending, not undisposed,
> and not an open owner decision.
>
> **SETTLED — `/seasons` too (owner ruling 2026-09-03).** All eight currently-unstored
> `/seasons` fields are **DECLINED**: `seasonDesc`, `startDate`, `endDate`,
> `shipStartDate`, `shipEndDate`, `active`, `createdUser`, `modUser`. **Nothing new is to
> be added to `coldlion.season`** — the five stored columns (`company_code`,
> `division_code`, `season_code`, `created_time`, `mod_time`) are the complete approved
> projection. Ruled from a full live read of 21 of 21 rows: the description duplicates the
> code, all four dates are the `1900-01-01` empty-date sentinel on every row, `active` is
> constant, and the two user stamps are record-audit personal data. Not pending, not
> undisposed. Revisit only if ColdLion begins populating them.
>
> **⛔ VENDOR DEFECT — never use the unfiltered `/seasons` call. The other divisions'
> records are MISSING, not mislabelled.** A company-wide `/seasons` query returns the
> **CW001 record in place of every other division's record entirely** — division code,
> description and all four audit stamps come from the CW001 row. **All 13 non-CW001 records
> (4 SP001, 1 EP001, 8 EH001) are ABSENT.** The row *count* is right (8 + 4 + 1 + 8 = 21)
> but the row *content* is duplicated from CW001, byte-identical, as though the lookup were
> keyed on `seasonCode` alone and ignored division. **There is no workaround — the division
> code cannot be re-derived from elsewhere, because the data is not in the response at all.**
> Per-division queries return the correct records (CW001 = 8, SP001 = 4, EP001 = 1,
> EH001 = 8). **Any `/seasons` loader MUST query per division.** The failure is silent:
> nothing in the envelope signals it and paging is not involved (single page, 21 of 21,
> size 50). Confirmed against the live feed 2026-09-03, re-verified three times, with a
> positive control that fires. It is a `/seasons` fault, not the API's general behaviour —
> unfiltered `/merchGroupHeaders` returns 37 rows correctly spanning all four divisions.

Feed readiness at plan creation:

| API feed | Table state | Has everything needed? |
|---|---|---|
| `/customers` | correct table and owner-reviewed projection | **Yes, structurally**; loader/load still missing |
| `/vendors` | correct table and owner-reviewed projection | **Yes, structurally**; loader/load still missing |
| `/merchGroupHeaders` | correct division-scoped key | **Yes, structurally**; loader/load still missing |
| `/merchGroupDetails` | correct four-part key and `active` | **Yes, structurally**; loader/load still missing |
| `/seasons` | five-column table, and that projection is **SETTLED** | **Yes, structurally — the projection is CLOSED.** Owner ruling 2026-09-03 DECLINED all eight unstored fields (`seasonDesc`, `startDate`, `endDate`, `shipStartDate`, `shipEndDate`, `active`, `createdUser`, `modUser`). **No seasons field is to be added.** Loader/load still missing, and it **MUST query per division** — see Step 2 and Step 7 |
| `/salespersons` | minimal table based on documented fields | **Not proven**; live field census/owner projection review missing |
| `/divisions` | no table | **No** |
| `/items` and `/itemDetails` | tables exist from old projection | **No**; current live fields and D14-D17 are not fully represented |
| `/orderHistory` | old split and superseded key | **No** |
| `/prodHistory` | stale field projection/loader assumptions | **No** |
| `/inventory`, `/prepackDetail`, `/pickticket`, `/receiving`, `/proddetails`, `/prodtracking` | no tables | **No** |
| `/itemImages` | intentionally excluded except possible metadata | **No ingestion planned for bytes** |
| `POST /order` and vendor PUT operations | write APIs | **Out of scope** |

Thus, four feeds have a complete structural destination, but none has end-to-end ingestion because no landing loader has populated production.

## 6. Key findings and root causes

1. ColdLion changes shape. A green or applied design measured against an older payload is not current proof.
2. The correct sales component identity is `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)`, verified in `docs/business-rules-erp-data.md` §10. The pair `(salesOrderNo,salesOrderLineNo)` is only a grouping candidate, not a unique source key, because ColdLion reassigns line numbers across documents. A parent version therefore includes its line-grain hash. The existing `(salesOrderNo,itemNo,labelCode)` design is superseded.
3. Assortments are exploded into component rows. Licensor/property and per-design quantities belong to components; a single master-level licensor/property is meaningless.
4. Both history feeds are now paged and silently cap pages at 200. Completion means walking until `last=true`, not trusting requested page size.
5. `prodHistory` must be fetched for `ISS`, `INTRAN`, and `REC`; no-stage requests are incomplete. Returned `stageCode` must equal the requested stage.
6. `orderHistory` blends Sales Order, Prepack Detail, Pick Ticket, and Invoice facts without a source-document marker, but the 2026-09-01 API additions resolved the practical duplicate-row problem. Additive reporting may use the approved per-design quantities. Fulfilment state comes from quantities, never document-number presence; do not re-request a document marker.
7. Because owner decision D5 rejects a per-row raw archive, omitted typed fields are unrecoverable without re-pulling history. Field census and owner disposition are therefore required before table finalization.
8. The existing history child tables have no parent foreign keys. Proper split-grain tables need a stable parent-version identifier and enforced child ownership.
9. A raw landing layer is source-aligned, not a canonical business model. Normalize repeated/mixed grains mechanically here; interpret them only in governed promotion views/tables.

## 7. Rejected approaches

- **Keep the existing history key.** Rejected: it collided after the vendor exposed the actual line number.
- **Use one requested 2,000-row history page.** Rejected: the server silently returns at most 200.
- **Fetch production history once without stage.** Rejected: it omits real `INTRAN` and `REC` facts.
- **Flatten parent totals onto every assortment component and sum them.** Rejected: it multiplies totals and misstates royalties.
- **Add every API property blindly.** Rejected: the owner deliberately chose ingest/ignore fields, and some fields contain sensitive or useless data.
- **Drop sparse fields because a small sample is empty.** Rejected: sparse source facts have later proved meaningful.
- **Store image bytes in Postgres.** Rejected by owner decision; images belong in PopDAM.
- **Put raw payloads or real examples in this public repo.** Rejected for privacy/licensing reasons.
- **Repair applied migration files.** Rejected: migration ledger identity is immutable; use forward migrations.
- **Let applications read `coldlion.*` directly.** Rejected: promotion must encode authority, matching, and stable consumer contracts.

## 8. Design decisions

Locked:

- `coldlion` remains the private landing schema.
- No foreign keys from landing into `core.*`.
- Every row references `coldlion.sync_run`; current-state rows retain source hash and first/last seen times.
- EP001 is deliberately excluded by loaders and constraints.
- Merchandise-group identity is company + division + type + code.
- Item identity includes company + division + item number.
- All 14 merchandise-group slots are supported as rows where the endpoint represents slots.
- No image bytes.
- Empty sentinel dates normalize to NULL.
- Backfill begins 2019-01-01 on a fixed seven-day grid; ongoing version history starts after initial backfill and retains the newest three versions.
- D14-D17 control assortment/component identity and quantities.

Plan decisions (recorded here so implementation does not need a new owner choice):

- Keep split history grains, but add a surrogate parent-version UUID to each line table and a mandatory foreign key from each component/lookup row. This preserves normalization and makes synthesized parent ownership explicit.
- Store returned `stageCode` and assert it matches the requested production-history stage.
- Treat document type in sales history as unknown, not inferred. This does not block reporting from approved per-design quantities; it forbids only provenance claims the feed cannot support.
- Add `coldlion.division`; do not hardcode a durable division dictionary in loaders.

Open only where evidence is genuinely absent:

- exact natural keys for pick-ticket, receiving, production-detail, and tracking rows must come from a fresh live census;
- the complete projection for **salespeople** and remaining feeds requires owner field disposition because D5 makes omissions permanent. **`/seasons` is NOT on this list: its projection is SETTLED by owner ruling on 2026-09-03** — the five stored columns are complete and all eight unstored fields are DECLINED. Do not treat a seasons field disposition as work to be done, and do not re-ask the owner for one;
- the loader runtime is this repository's Node tooling executed by GitHub Actions; any move to an Edge or Google Cloud runtime requires an owner-approved plan amendment.

---

# Part 3 — How to build it

## 9. Ordered execution plan

### Step 1 — refresh evidence and split the tracker into governed units

From an isolated current-`origin/main` worktree, read `AGENTS.md`, `docs/coldlion.md`, the open-question register, this plan, and issue #2081. Resolve the active orchestrator marker and queue audit. Fetch the live OpenAPI document and record a sanitized field-name-only census in a private artifact; retrieve U1-U20 from the protected location named in the existing ColdLion handoff.

Create one exact-object structural issue per migration unit: division/masters correction, items, sales history, production history, remainder tables, and promotion contracts. Keep #2081 as the tracker.

**Gate:** every U1-U20 item has a disposition owner and each structural issue has an exact `writes:` list with no overlap.

### Step 2 — complete master/reference structures

> **SETTLED — do not re-open.** All 29 `/vendors` fields were ruled by the owner on
> 2026-08-19 (10 ingest, 19 **DECLINED**) in
> `docs/coldlion-field-decisions-20260819.csv`, and the ruling was **re-verified against
> the live feed on 2026-09-03 with an identical field-name set**. Vendor addresses,
> `zipCode`, `state`, `email` and `phoneNo` are **DECLINED** — not pending, not undisposed,
> and not an open owner decision.
>
> **SETTLED — `/seasons` too (owner ruling 2026-09-03).** All eight currently-unstored
> `/seasons` fields are **DECLINED**: `seasonDesc`, `startDate`, `endDate`,
> `shipStartDate`, `shipEndDate`, `active`, `createdUser`, `modUser`. **Nothing new is to
> be added to `coldlion.season`** — the five stored columns (`company_code`,
> `division_code`, `season_code`, `created_time`, `mod_time`) are the complete approved
> projection. Ruled from a full live read of 21 of 21 rows: the description duplicates the
> code, all four dates are the `1900-01-01` empty-date sentinel on every row, `active` is
> constant, and the two user stamps are record-audit personal data. Not pending, not
> undisposed. Revisit only if ColdLion begins populating them.
>
> **⛔ VENDOR DEFECT — never use the unfiltered `/seasons` call. The other divisions'
> records are MISSING, not mislabelled.** A company-wide `/seasons` query returns the
> **CW001 record in place of every other division's record entirely** — division code,
> description and all four audit stamps come from the CW001 row. **All 13 non-CW001 records
> (4 SP001, 1 EP001, 8 EH001) are ABSENT.** The row *count* is right (8 + 4 + 1 + 8 = 21)
> but the row *content* is duplicated from CW001, byte-identical, as though the lookup were
> keyed on `seasonCode` alone and ignored division. **There is no workaround — the division
> code cannot be re-derived from elsewhere, because the data is not in the response at all.**
> Per-division queries return the correct records (CW001 = 8, SP001 = 4, EP001 = 1,
> EH001 = 8). **Any `/seasons` loader MUST query per division.** The failure is silent:
> nothing in the envelope signals it and paging is not involved (single page, 21 of 21,
> size 50). Confirmed against the live feed 2026-09-03, re-verified three times, with a
> positive control that fires. It is a `/seasons` fault, not the API's general behaviour —
> unfiltered `/merchGroupHeaders` returns 37 rows correctly spanning all four divisions.

Compare live `/customers`, `/vendors`, `/merchGroupHeaders`, `/merchGroupDetails`, `/seasons`, `/salespersons`, and `/divisions` definitions with production columns and the owner decision register. Add `coldlion.division` with the vendor's stable company/division identity. Add only approved missing typed fields to **salesperson**. **Add NOTHING to `coldlion.season`:** its projection is SETTLED by owner ruling on 2026-09-03 — the five stored columns (`company_code`, `division_code`, `season_code`, `created_time`, `mod_time`) are complete and all eight remaining fields are DECLINED. A seasons field disposition is not open work, and the owner is not to be re-asked for one. Do not recreate the four already-complete master tables.

Use a new forward migration under `supabase/migrations/`; extend the SQL contract test created for #2094.

**Gate:** field-name census has a disposition for every live property; natural-key replay is idempotent; same codes in different divisions remain distinct; RLS/grants match the closed landing posture.

### Step 3 — correct item structures

Create a forward migration that updates the item landing contract to the current `ItemHeader` and `ItemDetail` definitions and D14-D17. Keep one `item_header` row per company/division/item. Keep one `item_detail` row per stable vendor `itemPkey` under its parent item unless live evidence proves `itemPkey` is not stable; retain the parent FK. Store item merchandise groups in rows and reconcile cleared slots transactionally.

Do not copy item-level taxonomy onto component designs as a fallback. Store descriptions inline only when approved; descriptions are evidence, not keys.

**Gate:** two identical item numbers in different divisions survive; a cleared slot disappears; every approved live field maps once; ignored fields map nowhere; unknown fields make the loader fail loudly.

### Step 4 — redesign sales history

First repair history completion evidence. Add `stage_code` and nullable division scope to the window identity, requiring ISS/INTRAN/REC for production history, and add `coldlion.history_page_ledger` keyed by endpoint, company, division scope, stage scope, window, and page number. Every nullable identity constraint uses PostgreSQL `NULLS NOT DISTINCT`, so replaying an unscoped null stage/division cannot duplicate a page or window. Store page row count, reported totals, `last`, run, state, and error. A window may become loaded only when pages are contiguous from zero through the witnessed last page, every page succeeded, and summed page counts equal the window/API totals. One `sync_run` row never proves a multi-page window complete.

Then replace the obsolete empty tables by forward migration, preserving their names only if compatibility benefits outweigh a clean v2 name. Preferred design:

- `order_history_line`: `id uuid` primary key, company, order number, line number, master item number, line-grain facts, line hash, run/fetch provenance; unique order + line number + master item + line hash. Do not describe order + line alone as business identity.
- `order_history_component`: parent `line_id` FK, master item, component item, per-design quantities/prices, component taxonomy/descriptions, component hash; unique parent + component identity + hash.
- `order_history_invoice_ref`: parent/component ownership as proven by the payload, ordinal, invoice-number token as text, and aligned date token only where alignment is provable.
- `order_history_pick_ticket_ref`: parent/component ownership as proven by the payload, ordinal, and pick-ticket token as text.

Define the line-grain projection as every approved field proven constant across components, excluding `sub*`, component item, per-design quantities/prices, component taxonomy, and document-list tokens. The loader hashes that canonical projection, then synthesizes one parent per distinct `(salesOrderNo,salesOrderLineNo,masterItemNo,line_source_hash)`. It asserts constancy only within that full group; differing line projections remain separate versions rather than being merged. It never sums repeated parent totals. It pages until `last=true`. It preserves each original list string and also splits comma-delimited invoice numbers, invoice dates, and pick-ticket numbers into ordered child rows. If number/date cardinalities differ, preserve both ordered lists, record the mismatch, and refuse to invent pairings. It stores no inferred document type.

Neither sales-history table may have a foreign key to `coldlion.item_header`: discontinued historical items may be absent from the current item master. The component's FK is only to its history parent version. Apply the same deterministic newest-three maintenance contract described in Step 5 to sales-history versions; initial backfill retains its single baseline version.

**Gate:** re-run the corpus procedure in `docs/business-rules-erp-data.md` §10 and obtain zero four-part component-key collisions; every component has exactly one parent version; repeated line fields pass full-group constancy checks; per-design quantities reconcile; document-list tokens survive round-trip; a forced 201st row proves page 1 is recorded and the window cannot complete with page 0 alone.

### Step 5 — redesign production history

Re-derive the complete current `ProdHistory` property list from `/api-docs` before writing SQL; do not copy a dated count into the migration. Use the same parent-version pattern:

- `prod_history_line`: parent purchase line/version with returned and requested stage agreement.
- `prod_history_component`: mandatory parent FK and component-level prepack facts.
- `prod_history_last_lookup`: mandatory parent FK; never expose `lastProdCost` as current-order cost.

Fetch every seven-day window separately for ISS, INTRAN, and REC and page each request to completion through the repaired ledger. Treat `salesOrderNo=0` as no link.

Implement retention as a separate restartable maintenance operation. Partition versions by full source identity, order newest by a deterministic observation/version timestamp plus stable tie-breaker, retain the newest three, and refuse pruning when ordering or identity is ambiguous. Initial backfill writes one baseline version and is never mistaken for reconstructed change history.

**Gate:** multi-line orders remain distinct; all three stage-specific windows and every page land; returned stage mismatch aborts; component quantity assertions pass; cost tests prove `extCost` and `lastProdCost` cannot be confused; a four-version fixture prunes only the oldest and a one-version backfill fixture remains untouched.

### Step 6 — design the remaining endpoint tables from live evidence

For `/inventory`, `/prepackDetail`, `/itemImages` metadata, `/pickticket`, `/receiving`, `/proddetails`, and `/prodtracking`, capture field names, nullability, paging, and collision measurements privately. Obtain the owner ingest/ignore disposition before creating columns. Add one table per proven grain; use child tables for repeated groups. Add no image-content table.

Where the vendor exposes no stable line/event identity, use a surrogate row UUID plus a uniqueness contract over the smallest proven source identity and source hash. Never label a guessed key as natural.

**Gate:** each endpoint has a documented grain proof, complete field disposition, idempotent replay test, and no unexplained duplicate collapse.

### Step 7 — build loaders and controlled initial loads

Implement the loaders in this repository under `tools/coldlion-landing/`: `sync-masters.mjs`, `backfill-history.mjs`, and `sync-history.mjs`, with shared HTTP, projection, hashing, paging, ledger, retry, and alert code under `tools/coldlion-landing/lib/`. Deploy them through `.github/workflows/coldlion-landing-sync.yml` for scheduled masters/ongoing history and `.github/workflows/coldlion-history-backfill.yml` for the manual resumable backfill. This deliberately uses the repository's existing GitHub Actions/secret pattern; do not introduce a Supabase Edge Function or Google Cloud runtime without an owner-approved plan amendment.

Implement separate current-state, history-backfill, and ongoing-history paths. All loaders:

- validate the response shape and reject unknown properties;
- record request and wire/body status in `sync_run`;
- write parent and children atomically;
- update `window_ledger` only after complete-page and assertion success;
- hash the complete fetched record before projection for change detection;
- alert on every terminal failure;
- use bounded retry only for transient failures;
- never log source rows or secrets;
- **query `/seasons` PER DIVISION, never unfiltered.** The unfiltered call is a confirmed
  vendor defect: it returns the CW001 record in place of every other division's record, so
  all 13 non-CW001 records (4 SP001, 1 EP001, 8 EH001) are ABSENT while the row count still
  reads 21 of 21. The failure is silent, nothing in the envelope signals it, and there is no
  workaround — the missing divisions' data is simply not in the response and cannot be
  re-derived. Per-division queries return the correct records (CW001 = 8, SP001 = 4,
  EP001 = 1, EH001 = 8). Confirmed live 2026-09-03; see `docs/coldlion-open-questions.md` §5.

Backfill history from 2019-01-01 using the fixed grid. A window completes only through the stage/page-aware ledger contract from Step 4. Do not manufacture change history during backfill. Run data loads from the application/loader session after proving the target immediately before each write; structural issues own only migrations.

**Gate:** master counts reconcile to API totals, every history window/stage/page is complete, change log is empty immediately after initial backfill, and a controlled changed row creates exactly one forward version.

### Step 8 — publish safe consumer contracts

For each feed, separately decide whether promotion belongs in `plm.*`, `core.*`, or an application-owned schema. Keep licensor/property authority rules intact. Expose views/functions rather than grants on landing tables. Sales-history reporting may aggregate approved per-design quantities, but must not infer fulfilment from document-number presence or claim a source-document type.

**Gate:** application roles cannot query `coldlion.*`; authorized consumers can read only reviewed fields through stable contracts; authority and duplicate-abstention tests pass.

### Step 9 — land and close

For every structural unit: preview rehearsal, exact-head review, required checks, guarded merge, bounded production promotion only with exact authorization, and direct production catalog verification. Update this STATUS table after each unit. Reconcile #1031, close #2081 only after every feed in scope is loaded and verified, and retire the paired handoff only then.

**Gate:** exact migration versions are applied, production rows and constraints are directly verified, monitoring has a witnessed failure alert, and no requested feed remains without a proven destination.

Natural context cut points: end after Steps 2, 3, 4, 5, 6, and 7. Start each successor in a fresh session, re-read this plan's STATUS table, and re-resolve live API/main/database state.

## 10. Tests required

- `coldlion_master_landing_contracts.sql`: extend field, key, RLS, grant, and replay assertions.
- `coldlion_item_landing_contracts.sql`: cross-division identity, stable SKU identity, 14 slots, cleared-slot deletion, unknown-field refusal.
- `coldlion_order_history_contracts.sql`: parent/component FK, corrected key including master item, exact line-projection contract, parent constancy, nullable component `NULLS NOT DISTINCT` replay, version replay.
- `coldlion_prod_history_contracts.sql`: line sequence, three stages, stage match, component FK, last-lookup isolation.
- `coldlion_history_page_ledger_contracts.sql`: stage-aware window identity, `NULLS NOT DISTINCT` replay safety, contiguous-page proof, totals agreement, and incomplete-window refusal.
- `coldlion_remainder_landing_contracts.sql`: one grain/key/privacy contract per endpoint.
- `coldlion-history-pagination.test.mjs`: 200-row cap, multi-page completion, duplicate/missing page refusal.
- `coldlion-window-arithmetic.test.mjs`: fixed seven-day grid from 2019-01-01.
- `coldlion-error-classification.test.mjs`: wire status controls retry class.
- `coldlion-field-projection.test.mjs`: every live field is approved, ignored, or causes refusal.
- `coldlion-prepack-reconciliation.test.mjs`: component quantities and no multiplied parent totals.
- `coldlion-history-document-lists.test.mjs`: ordered invoice/date/pick-ticket splitting, original-string preservation, and mismatch refusal to pair.
- `coldlion-history-retention.test.mjs`: deterministic newest-three pruning for both sales and production history, newest protection, ambiguity refusal, and one-version backfill preservation.
- `coldlion-loader-alerting.test.mjs`: witnessed terminal alert and no secret/row leakage.
- Run the repository's complete required SQL/script test suite; do not weaken existing checks.

## 11. Constraints and gotchas

- This is shared database structure work: use the single orchestrator, isolated worktrees, exact-object claims, preview first, and branch/PR workflow.
- Read-only inspection is allowed; every database write requires immediate target proof.
- Production/shared-cloud mutation needs exact current-chat authorization.
- Never edit applied migrations or reuse versions.
- This repository is public. Commit only schemas, sanitized field names, synthetic fixtures, and aggregate evidence. A prior audit found roughly 68 existing public `docs/` files with real customer identifiers and commercial details. Albert has not decided whether to redact them or move that evidence to a private repository; making this repository private is a cancelled option because it removed branch protection. Until that owner decision is made, add no new customer or licensed row detail here.
- Preserve other sessions' dirty files; stage only owned changes.
- `mgTypeCode` meaning is division-scoped; `mgCode` alone is not identity.
- No licensor/property parent relationship may be inferred from item co-occurrence.
- Do not interpret zero, blank, or sparse as absent without the registered business rule.
- A completed API call is not a complete feed: page, stage, window, assertions, and ledger must all agree.

## 12. Access and environment

- GitHub CLI: authenticated as `u2giants`; repository `u2giants/shared-db`.
- Production ref: resolve through the protected configuration helper documented by the `codex-shared-db-change` skill, then prove it again by the repository runbook immediately before any write.
- Supabase access token: 1Password vault `vibe_coding`, item `Supabase CLI Personal Access Token`.
- Shared production DB password: vault `vibe_coding`, item `Supabase DB Password - shared POP database`.
- ColdLion key: vault `vibe_coding`, item `Coldlion ERP API key x5.coldlion.com`, field `credential`; pass only as `X-API-Key` through protected environment/state.
- Live spec: `GET http://x5.coldlion.com/EhpApi/v2/api-docs`.
- U1-U20 ledger: protected Muse transcript `coldlion-plan-review-2065` or the private EDGE-DEV artifact named in issue #2081. Never copy source examples into this repo.

---

# Part 4 — Landing it

## 13. Definition of done, risks, and open questions

Done means all of the following are true:

- every selected GET feed has a live, current-shape, normalized-by-grain landing destination;
- every approved field is stored and every ignored field is intentionally absent;
- no loader silently truncates a page, stage, division, window, or component;
- masters and histories are loaded, counts reconcile, and ongoing sync is observed working;
- parent/child history integrity is enforced;
- RLS/grants keep landing private and consumer contracts are separately governed;
- U1-U20 are implemented, refuted with evidence, or explicitly escalated;
- migrations are merged, checks green, exact versions applied, and production verified;
- this plan's STATUS table, `docs/coldlion.md`, issue #2081, and the paired handoff are updated/retired correctly.

Primary risks:

- vendor shape changes after design: mitigate with unknown-field refusal and recurring spec drift checks;
- silent partial history: mitigate with page/stage/window completeness proofs;
- wrong empirical keys: mitigate with collision refusal and surrogate parent-version IDs;
- privacy leakage: keep evidence private and fixtures synthetic;
- report double-counting: use only approved component quantities and prohibit document-presence fulfilment inference.

Open questions that do not block the already-ready four master feeds:

1. ColdLion does not expose source-document type. Do not re-ask: the practical duplication problem is resolved; preserve only the narrower limitation against provenance claims.
2. Remaining endpoint grains and owner field dispositions must be proven from live samples before their migrations.
3. Loader runtime is settled for this plan: repository-owned Node tools executed by the two named GitHub Actions workflows. Changing runtime requires an explicit plan amendment and owner ruling; it may not silently change the loader contract.

## Mandatory self-audit

1. **Could a brand-new session execute this without chat context? Yes.** §§1–5 define the business, systems, trigger, exact production state, and feed readiness; §9 gives ordered file/object-level work and a verification gate for every step; §12 provides access locations without secrets.
2. **Does it preserve all relevant reasoning and rejected paths? Yes.** §§6–8 capture the payload changes, assortment grain, paging/stage hazards, privacy constraint, immutable migrations, locked decisions, and rejected approaches.
3. **Is the goal strong enough to steer when a step is wrong? Yes.** §1 states the business outcome and explicitly makes it controlling; §§8 and 13 define the invariants and completion test.

Checklist result: all 13 required sections are present; scope, rejected approaches, locked/open decisions, concrete steps, named tests, constraints, access, risks, deployment verification, STATUS, and reciprocal handoff links are included.
