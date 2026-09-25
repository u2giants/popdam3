# Plan — ColdLion automatic order intake (replacing Adam's manual OrderList rows)

**Created:** 2026-09-17 (ZCode session that ran the live ColdLion investigation).
**Revised:** 2026-09-17, 2026-09-18, and 2026-09-25 (three audit rounds plus governed-review fixes). (1) Qwen audit of v1 — verdict REJECT; record:
`.ai/reviews/qwen-order-intake-plan-audit-5a2fd8b6ac9b199946cc14b3895d00b870e0746a04180c4f5ef58073e9fe6c4f.md` (session-local evidence, never committed to this repository).
(2) Grok 4.6 audit of v2 — verdict "not ready" (blocking + major findings F1–F22, 11
contradiction claims); record:
`.ai/reviews/grok-order-intake-plan-audit-v2-20260918T003208Z-368754.md` (session-local evidence, never committed to this repository)
(1,826,087 tokens, $0.56). Every load-bearing claim in both audits was independently
re-verified against the repository before incorporation — including one case where the Grok
audit corrected a Qwen finding (the sealed landing tables DO `grant all … to service_role`;
`20260905105038:780-782`). (3) Muse audit of v3 — verdict "not ready" (4 blocking + 9 major);
record: `.ai/reviews/muse-order-intake-plan-audit-v3-20260918T011029Z-606747-3631.md` (session-local evidence, never committed to this repository).
Its blocking findings included a genuine authority-file defect — the business-rules topic
still carried the pre-2026-08-31 "bare list" description of `/orderHistory` — which was
fixed in the authority file itself the same day (superseded paragraph, live re-verified).
**Handoff entry:** retired — the session handoff
`HANDOFF.d/2026-09-17T1440Z-edge-dev-zcode-order-intake-plan.md` is already absent from the
tree (not present on `main` and not in this change set), per `scripts/check-handoff-contract.mjs`
rule 2b (a handoff pointing at a closing issue is retired with it). This plan is the durable artifact.

**Business authority:** [`docs/business-rules/erp-orders-and-source-meaning.md`](docs/business-rules/erp-orders-and-source-meaning.md),
section *How a new order enters the system (OrderList intake)*. That section, this plan, the
`application-map.md` routing row, and the registration row in
[`docs/agents/active-contracts-and-plans.md`](docs/agents/active-contracts-and-plans.md)
landed together on `main` in PR #3248 (Step 0 — issue #3481 moved the active-contracts list
out of `AGENTS.md`, which that PR leaves byte-identical to `main`). If a checkout is missing
the section, it predates the landing — fetch current `main` before relying on any §8 locked
decision.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Land the business-rules + plan docs (one governed PR; the `.agent` evidence-pair `.json` files are not prose, so the change set is classified code and rides the guarded checks — `scripts/lib/documents-only-change.mjs` treats standalone `plan_*.md` as documents) | ✅ done | PR #3248 |
| A0. db-work issue + author lane + reserved version (governance dispatch) | ⬜ open | — |
| A. Migration: intake staging + routing-code map + quarantine | ⬜ open | — |
| A2. Verify item case-pack landing (verify-only — already landed) | ⬜ open | — |
| C0. Owner ruling: salesOrderNo↔production_order cardinality + placeholder key | ✅ ruled 2026-09-17 (1:N; placeholder per sales order) | `docs/business-rules/erp-orders-and-source-meaning.md` intake section; sheet measurement 434/4,005 |
| B. Poller tool (windows, paging, staging upsert, novelty detection) | ⬜ open | — |
| B0. Bounded bootstrap mode (limit + claim-only + cron disabled until live proof) | ⬜ open | — |
| B1. Poller entry point + window/fetch/stage/detect (Phase B detail) | ⬜ open | — |
| C. Routing decode + canonical placeholder writer | ⬜ open | — |
| C1. Routing decode step (post-poll join + quarantine) | ⬜ open | — |
| C2. Canonical writer (placeholder create/claim + source refs) | ⬜ open | — |
| D. Hourly GitHub Actions workflow + failure alerting | ⬜ open | — |
| E. Offline unit tests (flat `tools/*.test.mjs` names) | ⬜ open | — |
| F. Live proof: sample-week comparison vs the Google sheet | ⬜ open | — |

A fresh session starts at the first `⬜ open` row in order (currently **A0**), after reading
[`docs/business-rules/erp-orders-and-source-meaning.md`](docs/business-rules/erp-orders-and-source-meaning.md)
(the intake section) and this whole file. As of 2026-09-25 every row except Step 0
(✅ landed, PR #3248) and C0 (✅ ruled 2026-09-17) is open.

---

## Part 1 — Why

### 1. The ultimate goal

Today, every time Adam (sales) receives a customer order, three manual things happen: Adam
emails the PDF to JamieLynn at ColdLion, JamieLynn keys it into the ColdLion ERP, and Adam then
types a row into the Google OrderList sheet (columns 10, 11, 12, 14, 15-or-16, 21, 22, 24, 25,
26). **When this plan is done, the third step no longer exists**: within the business day after
JamieLynn keys an order, the canonical order rows exist in our Supabase (`plm.production_order`
/ `plm.production_order_line`) with every field Adam used to type, sourced from the ColdLion
API — plus description and licensing status projected from Master Data, which the sheet only
copied. Adam reviews exceptions in a queue instead of typing rows. The Google OrderList sheet
moves one step closer to retirement (its remaining unique job is Yuchen's production-PO side).

JamieLynn's manual ERP entry is explicitly NOT automated (owner ruling 2026-09-17).

**If any step in this plan conflicts with that goal, the goal wins — stop and flag it.**

### 2. What this system is

- **Repo:** `popcre/shared-db` (canonical; this repo; the former `u2giants/shared-db` slug redirects). Consumer repos mirror it read-only.
  This repo has **no `package.json`** — tooling runs with plain `node` (`node --test`), never
  yarn/npm workspaces.
- **Database:** Supabase Postgres, production project ref `qsllyeztdwjgirsysgai`. The `coldlion`
  schema is the ERP landing layer; `plm.*` holds canonical orders (customers live in
  `core.customer` — hard-renamed from `core.company` in `20260625153000`; order tables reference
  it via `plm.production_order.company_id`). Database changes go through this repo's guarded
  migrations — never app-repo migrations.
- **Existing sync infrastructure:** `tools/coldlion-landing/*.mjs` (Node ESM) run by GitHub
  Actions. The daily `coldlion-landing-sync.yml` (05:20 UTC) runs history windows → masters →
  prepack detail → prod-details in one job (`:110-125`; prod-details must run after history); manual backfills exist as
  `coldlion-history-backfill.yml`, `coldlion-prepack-backfill.yml`,
  `coldlion-prod-detail-backfill.yml`. The daily job reads **exactly two secrets**
  (`SUPABASE_DB_URL_PRODUCTION` — a pooler URL; a direct URL fails from Actions because
  GitHub-hosted runners have no IPv6 — and `COLDLION_API_KEY`); `COLDLION_EXPECTED_PROJECT_REF`
  is a literal in the workflow env (`coldlion-landing-sync.yml:86,98`), and
  `assertExpectedTarget`/`proveTarget` (`tools/coldlion-landing/lib/db.mjs:108-152`) refuse to
  run unless the connection string names it.
- **ColdLion API:** `http://x5.coldlion.com/EhpApi`, `X-API-Key` header; we are its only
  consumer. Reference: [`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md)
  — ⚠️ its `/orderHistory` table row (`:224`) still says "59 fields, not paged" and is
  superseded by the ⚠️ block at `:143-157` and the 2026-09-17 probe (63 fields, paged, cap 200)
  recorded in the business-rules intake section. Where they disagree, the probe wins.
- **Users:** Adam (sales) and, later, Yuchen (production) — neither uses this pipeline
  directly; they consume canonical rows through future DesignFlow UI (out of scope here).

### 3. What triggered this work

A 2026-09-17 investigation session (Albert + ZCode) that: profiled the live OrderList workbook,
mapped Adam's typed columns to the `/orderHistory` feed field-by-field, discovered the routing
code (`warehouseCode`) that carries Order Type + Ship To, proved the window filter keys on
start date, and found the "missing" orders through the production side. Albert then approved
the automation as a Settled rule (2026-09-17) and the forward-horizon ruling ("API calls are
cheap; never economise call volume at the cost of missing data"). Everything is recorded in
the business-rules topic named above; this plan is the build order for it.

### 4. Scope

**In scope:**
1. Landing the 2026-09-17 business-rules edits + this plan (Step 0 — the authority must be on
   `main` before any code session starts).
2. A new unsealed landing/staging area in the `coldlion` schema for current + forward window
   polling (completely separate from the sealed `window_ledger` machinery).
3. A poller tool that runs intra-day, detects newly entered sales orders, and stages them.
4. A routing-code decode (curated table + quarantine for genuinely unknown codes; COS/stock
   is production-side meaning, out of scope here — intake performs no COS/stock
   recognition).
5. A canonical writer that claims existing or creates new `plm.production_order(_line)` rows
   with `coldlion` source refs, per the reconciliation design in
   [`docs/app-migration-notes/popdam-order-list.md`](docs/app-migration-notes/popdam-order-list.md)
   §*Google-to-Coldlion identity proof* (see §8 for how the intake's claim tuple adapts it —
   that design leads with the production-order number, which does not exist yet at intake
   time).
6. An hourly GitHub Actions workflow with failure alerting.
7. Offline unit tests for all new logic.
8. Verification of the item case-pack landing (A2 — verify-only; see §6 finding 6).
9. The sample-week live-proof reconciliation report under
   `docs/verification/coldlion-order-intake-<date>/` (F1), counts and deterministic refs only.

**NOT in scope (do not build these here):**
- Any DesignFlow UI screen (no OrderList screen exists yet; separate project).
- Writing anything back into the Google OrderList or MasterData sheets (settled direction:
  the sheets are being replaced, not fed).
- Landing `/prodtracking` (Phase-2 candidate). **`/proddetails` is already landed** as
  `coldlion.prod_detail` by `tools/coldlion-landing/sync-prod-details.mjs` (issue #3180, daily
  in `coldlion-landing-sync.yml:12-18`); intake must not re-fetch it.
- Automating JamieLynn's ERP entry (`POST /order` exists but is ruled out for now).
- Any vendor request to ColdLion (Albert handles the `shipPortCode` ask verbally).
- Yuchen's production-PO columns (Import PO#, vendor, seal date, sent-PO date) — including
  **promoting an intake placeholder header to a real Import PO#**, which stays the production
  side's job.
- Any change to the sealed-window history sync (`sync-history.mjs`) or its ledger.

---

## Part 2 — What we already know

### 5. Current state of the code

- **Sealed history sync — works, deployed, do not touch:** `tools/coldlion-landing/sync-history.mjs`
  loads only CLOSED 7-day windows; loading a window seals it via `coldlion.window_ledger` +
  page-evidence constraints. `tools/coldlion-landing/lib/project-order-history.mjs` holds the
  `/orderHistory` row **projection** (`projectLine`, `projectComponent`,
  `splitInvoiceTokens`, `splitPickTicketTokens`, `projectOrderHistoryWindow`) into
  `coldlion.order_history_line` / `_component` / invoice/pick refs;
  `tools/coldlion-landing/lib/load-window.mjs` builds the single-transaction **load SQL**
  around it (and also writes page evidence and ledger state, which this plan forbids here).
  Reuse the projection functions; write new load SQL.
- **Canonical order contract — merged and live:** migrations
  `20260810010000_popdam_order_list_contract.sql` (tables, `plm.production_order_source_ref` /
  `production_order_line_source_ref` — identity uniqueness `unique (source_system, source_id)`
  at `:233`/`:245`, one-primary-per-order-per-system partial uniques at `:254-260` — RPCs `public.create_dam_order` / `update_dam_order` /
  `link_dam_order_line`, allowed-key contracts), `20260810060000` (nulls-distinct fix),
  `20260831045020_popdam_orderlist_input_only_write_contract.sql` (issue #1772 input-only
  contract; col B Import PO# → `header.production_order_number`, needed to create, immutable
  after), `20260905042713` (plm-scoped service_role privilege sweep). The historical Google
  import ran 2026-08-13 (12,354 populated source rows → 3,225 planned canonical order headers,
  source system `google_order_list`) — see `docs/verification/popdam-order-list-production-2026-08-13/`.
  Its blank-Import-PO precedent stamps deterministic placeholders
  (`GOOGLE-ROW-<sheet-row>`, `scripts/import-order-list-xlsx.py:870-873`) — reused below.
- **Item case pack is already landed:** `coldlion.item_detail` carries `carton_qty` and
  `inner_pack_qty` (`20260825023430:89-90`) and the master sync already projects them
  (`tools/coldlion-landing/lib/master-specs.mjs` `f("cartonQty","carton_qty","num")`,
  `f("innerPackQty","inner_pack_qty","num")`). A2 is a verify-only step, not a migration.
- **Importer precedent for direct-SQL canonical writes:** `scripts/import-order-list-xlsx.py`
  writes canonical rows + source refs as the DB owner. The intake writer follows this
  precedent (the browser RPCs require `auth.uid()` and enforce the #1772 input-only contract;
  a service poller must not weaken that contract).
- **Governance machinery the migration must use (details in §9 A0):** db-work issues + author
  lanes + centrally reserved 14-digit versions (`docs/agents/anti-collision-summary.md`, rule 1), the mandatory
  `.github/live-proofs/<work-issue>.sql` probe (`docs/agents/active-contracts-and-plans.md`,
  the live-proof blockquote), and the
  `database-contract-tests.yml` gate (`supabase/tests/*.sql` glob). `supabase db reset` is not
  a gate in this repo.
- **Uncommitted at plan time:** the 2026-09-17 business-rules edits (see Step 0).

### 6. Key findings and root cause (all live-verified 2026-09-17)

1. `/orderHistory` returns 63 fields; **no created/entry timestamp exists** — only `startDate`,
   `cancelDate`, `invoiceDateString`. Detection must be `salesOrderNo` novelty, not a date cursor.
2. **The `fromDate`/`toDate` window filter keys on the ERP start date** (proven: November and
   December 2026 windows return live rows today; every row's `startDate` falls inside its
   window). Newly entered orders with future ship dates — the norm — are invisible to a
   current-week-only poll. Hence: trailing re-read + forward scan.
3. **The ERP's `startDate` is its own value, not the sheet's Start Ship Date** (e.g. ERP
   2026-12-04 vs sheet 2026-11-21). Expected divergence; map ERP values, never sheet values.
4. **`poNumber` zero-padding is inconsistent** (a 10-digit zero-padded value and an 8-digit value both observed live 2026-09-17; synthetic shapes `"0001234567"` / `"87654321"`).
   Normalize by stripping leading zeros before any join.
5. **Order Type and Ship To are one field**: the routing code in `warehouseCode`/`warehouseDesc`
   — `FOB`, `POECA`/POE CALIFORNIA, `POEGA`/POE GA Savannah, `POEVA`/POE GA Norfolk, bare `POE`,
   `DDPNJ`/DDP New Jersey, `DDPMD`/`DDPPA`/`DDPOH`/`DDPNC`/`DDPCA`/`DDPGA`, `MDDP`, `DES001`
   (Deco Signs), `ANT001` (Anthony's Warehouse), `WMFC`. POE vs DDP definitions and the
   Forman-Mills/Shoppers-World-are-DDP correction are Settled in the business-rules doc.
   `warehouseCode` — NOT `prodTypeCode` — matches the business meaning.
6. **Case Pack is item-grain and already landed**: `coldlion.item_detail.carton_qty` /
   `inner_pack_qty` (real varying values: 1, 4, 7 observed). Line-level exceptions stay human.
7. **FOB Ship To maps from `/prodtracking`'s `shipPortCode`** (Albert's ruling; JamieLynn will
   start populating it). Today it is empty on all sampled orders — the writer leaves FOB Ship
   To NULL (human) when the code is absent. `/prodtracking` is a Phase-2 landing candidate.
8. **Every field Adam types is available on `/orderHistory`** except the FOB origin port and
   line-level case-pack overrides: Order Person `salesPersonCode1` (100%), Customer
   `customerCode`/`customerDesc` (100%), Customer PO# `poNumber` (100%), Assortment/Style
   `itemNo` + `prePackCode`/`prepackQty`/`subItemNo` (assortments explode; the real SKU is
   `COALESCE(NULLIF(subItemNo,''), itemNo)` at read time; `salesOrderLineNo=0` marks component
   rows), Quantity `orderQty` (per-SKU quantity; `lineQty` is a PARENT LINE TOTAL, repeated on every exploded component —
   never summed), Start/Cancel `startDate`/`cancelDate` (100%).
9. Amazon stock orders legitimately have no customer PO; CONTRACTUAL SAMPLE / DAVID SAMPLE /
   C STOCK / STOCK order types correspond to the settled `COS` and stock-order rules and are
   **recognised separately, not via the routing code**; `EP001` (Edgeucational) is excluded at
   ingestion; negative quantities are valid corrections and load as-is; `1900-01-01` is the
   empty-date marker → NULL.
10. Endpoint mechanics: paged envelope, **undocumented page-size cap 200** (loop until
    `last=true`); `companyCode`, `fromDate`, `toDate` are **required** params (a `salesOrderNo`-only query without dates returns HTTP 400 — `salesOrderNo` is reliable only combined
    with its start-date window); calls are fast but must be serial with the repo-standard pause;
    window dates are inclusive. Shared constants exist and must be imported, not restated:
    `COMPANY_CODE`, `PAGE_SIZE`, `EXCLUDED_DIVISION` in `tools/coldlion-landing/lib/scopes.mjs`,
    and `REQUEST_PAUSE_MS` (3000 ms) in `tools/coldlion-landing/lib/http.mjs:19`.
11. The daily sealed-window sync stays the authority for historical/corrected rows; the intake
    poller's forward+trailing scan is idempotent by identity + source hash, so the two
    pipelines converge without conflict *provided the poller never writes to the sealed
    tables*.

### 7. Approaches considered and REJECTED

- **Ask ColdLion for a changed-since/created-after filter.** Rejected by Albert 2026-09-17:
  vendor programming takes time and may never happen. We poll on our side.
- **Current-week-only polling.** Disproved by finding 2 above — new orders with future start
  dates are invisible in the current week. The poll MUST scan forward windows.
- **Cursor/checkpoint resume by created date.** No created timestamp exists in the payload
  (finding 1). Rolling re-read with identity dedup instead.
- **Writing new rows back into the Google sheet.** Inverts the settled migration direction and
  reintroduces sheet drift. Never.
- **Using `prodTypeCode` for Order Type.** It disagrees with `warehouseCode` on exactly the
  orders we care about (POE vs DDPNJ). `warehouseCode` is authoritative (Albert 2026-09-17).
- **Loading the open week through the sealed window ledger.** Would seal a permanently
  incomplete week — the exact failure `sync-history.mjs`'s header comment warns about. The
  intake staging area is deliberately outside the ledger.
- **Fuzzy item/order matching.** House rule from the OrderList contract: exact match after
  normalization only; ambiguity → quarantine, never a best guess.
- **Treating empty `pickTicketNoString`/`invoiceNoString` as the new-order test.** Presence of
  document numbers does not mean fulfilled; novelty is decided by `salesOrderNo`.
- **Blaming ERP-entry lag for "missing" orders.** Withdrawn 2026-09-17: the orders were in the
  ERP all along; the misses were zero-padding + wrong window (findings 2, 4).
- **Tests in a `tests/` subdirectory.** `tools-offline-tests.yml:187` globs `tools/*.test.mjs`
  flat and non-recursively; PR #331 is the recorded cost of getting this wrong (green tests
  that CI never ran). Test files live directly in `tools/`.
- **A `--dry-run` that writes to staging on production.** Every other tool's `--dry-run`
  writes nothing (`tools/coldlion-landing/README.md` §Running it;
  `coldlion-landing-sync.yml:44-45`), and production writes happen only from the workflow.
  Intake's `--dry-run` writes nothing anywhere.
- **`supabase db reset` as the migration gate.** Not a gate anywhere in `.github/workflows/`;
  the gate is `database-contract-tests.yml` plus the live-proof probe (§9 A0).

### 8. Design decisions

**Locked (do not relitigate):**
- Unsealed current-window + forward-horizon poll on our side; no vendor dependency
  (Albert 2026-09-17).
- Forward horizon: enumerate 7-day grid windows forward from the window containing today
  (`lib/grid.mjs`), stopping after **two consecutive `from_date`-months that staged zero new
  rows** — implemented as per-month counters of fetched/staged/EP001-excluded rows (a grid
  window straddles month boundaries; a window belongs to the month of its `from_date`; only
  *staged* rows count, not fetched and not excluded). The stop rule IS the settled ruling
  ("until consecutive empty months, not a fixed short horizon"). The **18-month hard cap is
  this plan's own bounded-cost decision, not part of the ruling**: the ruling says never
  economise call volume at the cost of missing data, so an order whose ERP `startDate` lies
  beyond the cap is missed by design until a **later forward scan** includes its start date as
  today advances (the trailing re-read — last 3 closed windows + open week — does not catch
  it). Both constants live in one place with a comment naming the ruling.
- Detection = `salesOrderNo` values not previously observed in `coldlion` landings/staging.
- Routing decode from `warehouseCode` via `coldlion.routing_code_map` (curated table, unknown
  codes → quarantine). **No COS/stock detection at intake:** the settled COS identity is a
  production-PO suffix with `salesOrderNo = 0` on *production* lines — it is not on the
  `/orderHistory` payload, and inventing a sales-side detector is forbidden. Rows with
  `salesOrderNo = 0` are quarantined and must never mint `COLDLION-SO-0` (that source_id would
  collapse every such row onto one header under `unique (source_system, source_id)`).
- `poNumber` normalized (leading zeros stripped) for all matching; stored raw + normalized.
- **Intake idempotency is source-ref-only, and intake never claims an Import-PO header.**
  Under the 1:N ruling (below), attaching `coldlion:so-header:<salesOrderNo>` to an existing
  Import-PO header would pin one sales order onto one production header and break every later
  line claim. So: on a miss of `source_system='coldlion'` +
  `source_id='coldlion:so-header:<salesOrderNo>'` in `plm.production_order_source_ref`,
  **create the placeholder header**; on a hit, update it. Customer-PO matching is NOT a
  header-claim path at intake — a multi-match on customer PO is expected under 1:N and is not
  a quarantine reason. Every `google_order_list` header ref stays untouched. (The
  `popdam-order-list.md` §*Google-to-Coldlion identity proof* tuple leads with the
  production-order number and governs the future **production-side** claims, not intake.)
- The poller runs as the DB owner from GitHub Actions using the two existing secrets; the
  expected-project-ref is a literal env var, not a secret.
- Grants follow the **append-only evidence precedent** (`20260812020000_revoke_service_role_truncate_on_append_only_evidence_tables.sql`),
  not the bare sealed-history `grant all`: `enable row level security` on every new table,
  `revoke all … from public, anon, authenticated`, `grant all … to service_role`, **then
  `revoke truncate, references, trigger, maintain on … from service_role`**. The intake
  staging tables are append-only by design (version rows never deleted or rewritten except
  the run FKs), and `TRUNCATE` bypasses row triggers — the exact defect class that migration
  records. The sealed-history tables themselves still carry bare `grant all`
  (`20260905105038:780-782`); that is a known gap there, not authority to repeat it.
  `20260905042713` is only a `plm`-scoped revoke of four privilege bits, not a colder policy.
  The live-proof probe asserts RLS on, no public/anon/authenticated grants, service_role
  `arwd`, **and the absence of `truncate`/`references`/`trigger`/`maintain`** — `arwd` alone
  cannot detect `TRUNCATE`.
- Reuse `coldlion.sync_run` (do **not** add a parallel run table): `endpoint='/orderHistory'`,
  `requested_by='coldlion-order-intake'`, grid-aligned `window_from`/`window_to`, counts, and
  the run summary in `notes` (the shape `lib/run-history.mjs` `notesFor` produces).
  `first_seen_run`/`last_seen_run` are FKs to `coldlion.sync_run(id)`. Failure handling
  writes a **sibling** of `recordFailure()` that inserts the failed `sync_run` row and fires
  `pg_notify('coldlion_sync_alert', …)` but **never mentions `window_ledger`**. The insert
  carries every NOT-NULL and window rule of `coldlion.sync_run` (`20260818232639`):
  `endpoint='/orderHistory'`, `company_code`, `request_params`, grid-aligned `window_from`/
  `window_to` (both or neither), `status='failed'`, `requested_by='coldlion-order-intake'`
  (blank is refused), `error_message` NOT NULL on failed, wire/body statuses —
  `recordFailure()` itself (`lib/db.mjs:178-184`) also marks `window_ledger` rows
  `state='failed'`, which §11 forbids here and which would poison sealed-window resume.
- `EP001` filtered at ingestion AND enforced by the nullable exclusion
  `check (division_code is null or division_code <> 'EP001')` on `coldlion.intake_order_line`
  (the sealed tables' exact form, `20260905105038:593-594` / `20260825023430:119`), not just
  performed.
- Serial requests, ≥60 s timeout; required params on every request; constants imported from
  `lib/scopes.mjs`; pause defaults to `REQUEST_PAUSE_MS` (3000 ms, `lib/http.mjs:19`) — never
  below 2000 ms without the budget-arithmetic comment pattern the 2026-09-17
  `coldlion-landing-sync.yml` prepack hunk uses for its documented 1000 ms exception.
- Empty `poNumber` (Amazon stock orders): skip the customer-PO tuple entirely and key the
  placeholder only on `salesOrderNo` — an empty PO must neither false-claim a blank-PO Google
  row nor quarantine the order.
- FOB Ship To ← `shipPortCode` (Phase 2); NULL + human until then. Case Pack ←
  `coldlion.item_detail.carton_qty` default; line-level overrides stay human.
- Description and License Status are **projections** from the linked item / Master Data —
  never copied values (48-column contract, columns S/T).
- Tests live flat in `tools/` (discovered by the `tools/*.test.mjs` glob), run offline with no
  secrets and no database contact; the decode/claim logic is exported as pure functions from
  `tools/coldlion-landing/lib/order-intake-*.mjs` modules (SQL as text, database access
  injected) so the tests can exercise them — the pattern `lib/load-window.mjs` +
  `tools/coldlion-landing-history.test.mjs` already use.

**Ruled by the owner (C0, Albert, 2026-09-17):**
- **One sales order maps to many production orders** — a customer order is regularly fulfilled
  by multiple production POs, and the reverse also occurs (verified on the live sheet: 434 of
  4,005 customer POs carry 2–12 distinct Import POs; customer PO differs inside 806 Import-PO
  groups; ruling recorded in the business-rules intake section). Therefore a ColdLion
  `salesOrderNo` is **never** the identity of a canonical `production_order` header; the
  header grain stays one per Import PO.
- **Header key at intake:** the writer stamps the deterministic placeholder
  `COLDLION-SO-<salesOrderNo>` on a header that represents the **customer order before
  production exists** (following the importer's blank-PO precedent `GOOGLE-ROW-<n>`,
  `scripts/import-order-list-xlsx.py:870-873`), records
  `{"production_order_number_origin":"coldlion_intake_placeholder"}` in header `metadata`,
  and never overwrites a non-placeholder value. The column is not unique-constrained
  (`20260810010000:317` is a plain index), so placeholders cannot collide.
- **Claim shape under 1:N:** the placeholder's header source ref is
  `coldlion:so-header:<salesOrderNo>` (one per sales order, satisfying the
  unique-per-source-system index); line refs are
  `coldlion:so:<salesOrderNo>:line:<salesOrderLineNo>:component:<ordinal>` (unique per line).
  When production orders are later written against the same customer order — future,
  production-side work, out of scope here — they **claim the placeholder's lines
  line-by-line** — claiming an unsplit line **moves** the existing `production_order_line`
  (update `production_order_id`), it does not insert a second source_ref; a quantity split
  mints `coldlion:so:<so>:line:<n>:component:<ord>:po:<prodOrderNo>` — reserved now so the
  `unique (source_system, source_id)` line index never blocks a split. Production headers use
  their own source_id family (`coldlion:po:<prodOrderNo>`), never `coldlion:so-header:<so>`;
  placeholder header refs stay on the retired placeholder. They never merge headers, and a
  fully claimed placeholder is retired as evidence, never deleted.

**Open (implementer's judgment, criteria given):**
- Exact staging-table shape — mirror the `order_history_line`/`_component` projection minus
  the ledger machinery. **Identity keys are the sealed identities verbatim** — line:
  `unique nulls not distinct (sales_order_no, sales_order_line_no, master_item_no,
  line_source_hash)`; component: `unique nulls not distinct (line_id, sub_item_no,
  sub_label_code, component_source_hash)` — so a `source_hash` change INSERTS a new version
  row and no projection field is ever rewritten. The run FKs (`first_seen_run`/`last_seen_run`)
  are the only mutable columns: an identical re-observation (same identity, same hash) updates
  `last_seen_run` to the observing run and nothing else; a changed hash inserts a new version.
  The winner rule (§9 C2 step 0) therefore picks the most recently observed version — this is
  deliberate, and the two-key tiebreak (`last_seen_run`, then `*_source_hash`) exists so two
  runs can never disagree about which version wins.
- Whether decode + canonical write run in the same process as the poll or as a second step of
  the same workflow job (recommend same job, separate transaction, so a writer bug never
  blocks staging) — either way the logic lives in importable `lib/` modules per the locked
  test decision.
- Review-queue surface: minimum viable = a database view + counts in the run summary.
- Cadence detail: hourly is the working assumption; 30 min–4 h all satisfy the goal, but no
  cadence faster than 3× the measured full-scan duration (a ~80-window serial scan at the
  3000 ms standard pause is already several minutes) so the `cancel-in-progress: false` queue
  cannot grow unbounded.

---

## Part 3 — How to build it

### 9. The plan

**Step 0 — land the authority (DONE — one governed PR, #3248).** The landing is a single PR
carrying the 2026-09-17 business-rules edits (`erp-orders-and-source-meaning.md`,
`application-map.md`, `master-data-access.md`), this plan, the
registration row in `docs/agents/active-contracts-and-plans.md` (issue #3481 moved the
active-contracts list out of `AGENTS.md`, which the PR leaves byte-identical to `main`), and
the generation-keyed `.agent/work/3262/` evidence pair. It did **not** use the
documents-only lane, and the reason is the classifier, not a rulebook label:
`scripts/lib/documents-only-change.mjs` treats standalone `plan_*.md` as documents (its own
header and `standalone implementation plans are documents` test say so), but the evidence
pair's `.json` files are not prose extensions, so the change set lands in the classifier's
code bucket and CI reports *"Not applicable: code change; guarded code checks required"*.
PR #3248 merged before any code session starts. Verify with
`git log --oneline -- docs/business-rules/erp-orders-and-source-meaning.md`.

**Phase A — database migration.**

- **A0 (prerequisite — before any migration file is opened).** Open the `db-work` issue with
  this exact `db-work-scope` block (the grammar of `docs/agents/section-4-anti-collision-rules.md`
  for `status`/`priority`/writes, plus the `application_return_to` key documented in the
  live-proof blockquote at `docs/agents/active-contracts-and-plans.md:115-125` —
  `status` and `priority` are required, and structural work must declare writes):

```text
db-work-scope
status: ready
work_type: structural
route: shared-db-orchestrator
application_return_to: popcre/shared-db
priority: 100
depends_on:
writes:
  - table coldlion.intake_window_state
  - table coldlion.intake_order_line
  - table coldlion.intake_order_component
  - table coldlion.intake_new_order
  - table coldlion.routing_code_map
  - table coldlion.intake_quarantine
  - table coldlion.sync_run
reads:
  - table plm.production_order
  - table plm.production_order_line
  - table plm.production_order_source_ref
  - table plm.production_order_line_source_ref
  - table coldlion.item_detail
  - table core.company_source_ref
  - table plm.erp_customer
```

  Then claim the lane and reserve the version in one operation:
  `node scripts/manage-migration-author-lanes.mjs --claim --admit-issue <work-issue> --task
  "<issue and outcome>" --owner "<agent/session>" --branch "<branch>" --worktree "<absolute
  isolated worktree>" --objects "<the six new tables above (excluding pre-existing
  `coldlion.sync_run`)"`. Use **only** the reserved
  14-digit version in the filename; never derive a timestamp (`docs/agents/anti-collision-summary.md`,
  rules 1, 4–5).
  Read `docs/agents/section-4-anti-collision-rules.md` in full first (routed from
  `docs/agents/anti-collision-summary.md`).
- **A1. New migration** `supabase/migrations/<reserved-version>_coldlion_order_intake_staging.sql`
  creating:
  - `coldlion.intake_window_state` — one row per scanned window per track (`track` ∈
    {trailing, forward}, `from_date`, `to_date`, last-run state, counts). Upserted, never
    locked; no ledger coupling.
  - `coldlion.intake_order_line` / `coldlion.intake_order_component` — same projection grain
    and identity keys as `order_history_line`/`_component` (`20260905105038:547-662`),
    plus `first_seen_run`/`last_seen_run` FKs to `coldlion.sync_run`, **plus the nullable
    EP001 exclusion `check (division_code is null or division_code <> 'EP001')`** (the sealed
    tables' exact form — `20260905105038:593-594`, `20260825023430:119` — so NULL-division
    rows the sealed pipeline legitimately lands are not refused), with the grants policy of §8
    (RLS on, revoke all from public/anon/authenticated, `grant all … to service_role` then
    `revoke truncate, references, trigger, maintain` — see §8), **plus two explicit
    winner-selection indexes** the C2.0 rule needs:
    `(sales_order_no, sales_order_line_no, master_item_no, last_seen_run DESC, line_source_hash)`
    at line grain and `(line_id, sub_item_no, sub_label_code, last_seen_run DESC, component_source_hash)`
    at component grain — the identity uniques do not contain `last_seen_run`, so they cannot
    serve `greatest last_seen_run` per identity prefix, and the second tiebreak key must ride
    the same index or it forces a sort. Also index the run FKs as the sealed tables do
    (`20260905105038:666-669`): a leading-key index on `first_seen_run` and a leading-key
    index on `last_seen_run` (or the run FK column) for run-FK lookups — a btree trailing key
    is not a leading key and does not serve `WHERE last_seen_run = $run_id`, matching how
    sealed tables index `run_id` as a leading column.
  - `coldlion.intake_new_order` — the novelty queue: `sales_order_no`, first-seen run, decoded
    routing code, claim state (`pending`, `claimed`, `created`, `quarantined`), claim evidence.
  - `coldlion.routing_code_map` — curated decode: `code`, `description`, `order_type`,
    `ship_to`, `is_poe_ddp_family`, `notes`, **with `PRIMARY KEY (code)`** (C1 joins staged
    `warehouseCode` to this table; without a unique key on `code` the decode is ambiguous);
    seeded with the full observed vocabulary from the business-rules routing table.
  - `coldlion.intake_quarantine` — failed decode/claim rows with reason and raw JSON.
  - *Verification gate:* the same PR commits `.github/live-proofs/<work-issue>.sql` — one
    read-only `WITH` returning one row with a boolean aliased `passed`. It must assert
    **objects, not names**: for each of the six **new** tables `pg_class.relkind = 'r'` (excluding pre-existing `coldlion.sync_run`), plus the
    load-bearing `pg_constraint` rows **by name** — the nullable EP001 check, both identity
    uniques, the `PRIMARY KEY`/`UNIQUE` constraint on `routing_code_map.code` (the C1 decode
    key), and the `coldlion.sync_run` FKs — following the pattern at
    `20260905105038:113` (`conname = 'coldlion_window_ledger_identity_unique'`);
    **plus the two winner-selection indexes and the `first_seen_run` and `last_seen_run` indexes by name**
    (a `pg_constraint` check does not cover indexes — a migration that silently drops an
    index must fail the gate); also assert `coldlion.window_ledger` is content-untouched by
    the intake path, not merely count-unchanged — e.g. no `window_ledger` row joins a
    `coldlion.sync_run` with `requested_by = 'coldlion-order-intake'`, because a bare
    `count(*)` cannot detect the in-place `state` updates `lib/db.mjs:178-184` performs;
    and RLS on with the §8 grant pattern (service_role `arwd`, **no** `truncate`,
    `references`, `trigger`, or `maintain` — `arwd` alone cannot detect `TRUNCATE`) —
    because `scripts/check-live-proof-probe.mjs` refuses the merge without it
    (`docs/agents/active-contracts-and-plans.md`, live-proof blockquote). Offline: `Database Contract Tests` green, plus a new
    `supabase/tests/coldlion_order_intake_staging_contracts.sql` (auto-discovered by the
    `supabase/tests/*.sql` glob). Do not cite `supabase db reset`.
- **A2. Verify item case-pack landing (verify-only, no migration):** confirm
  `coldlion.item_detail.carton_qty`/`inner_pack_qty` are populated on production
  (`select count(*) … where carton_qty is not null` — non-zero expected after any master
  sync). The C2 case-pack lookup must name its predicate — the table's primary key is
  `(company_code, division_code, item_no, item_pkey)` (`20260825023430:97`), so a lookup
  that omits `company_code`/`division_code` is unserved; the writer queries
  `where company_code = $1 and division_code = $2 and item_no = $3 and item_pkey = $4`
  (the serving index is that primary key; `item_detail` is SKU-grained by `item_pkey`, so
  multiple `item_pkey` rows per `item_no` would make `carton_qty` ambiguous — the predicate
  must include `item_pkey`, or the query must assert uniqueness of `item_pkey` per
  `item_no` before using `carton_qty`). No projection extension is needed; both are landed and projected (§5).

**Phase B — poller tool.**

- **B0 (build before the cron ever fires).** The tool supports `--limit <n>` (process at most
  n new orders) and `--claim-only` (stage and decode, write no canonical rows), and the
  scheduled trigger stays **disabled** until F1's live proof passes. The first enablement is a
  bounded event, never an unbounded mass write — the sealed side shipped the same way
  (`backfill-history.mjs --from … --limit 50`).
- **B1. New entry point** `tools/coldlion-landing/order-intake.mjs` (logic in
  `tools/coldlion-landing/lib/order-intake-*.mjs`):
  - Window math: trailing track = last 3 grid windows + the open current week; forward track =
    next grid window after today, advancing until two consecutive empty calendar months or the
    18-month cap (§8 locked wording). Grid arithmetic from `lib/grid.mjs` styles; no ledger
    functions.
  - Fetch: every request carries `companyCode` (required) + dates; `PAGE_SIZE` imported from
    `lib/scopes.mjs` and `REQUEST_PAUSE_MS` from `lib/http.mjs`; loop until `last=true`; serial
    with the repo-standard pause, ≥60 s timeout; **scope is `ORDER_HISTORY` only
    (`lib/scopes.mjs:14`) — never `allScopes()`, and no `stageCode` is ever sent on this
    path**;
    expected-target proof; wire-status/body-status distinction (a 400 with body-status 500 is
    permanent — never retried).
  - Stage: upsert into `coldlion.intake_order_*` by identity + `source_hash`; a changed
    projection becomes a new version row. `--dry-run` writes nothing anywhere.
  - Detect: insert into `coldlion.intake_new_order` every `salesOrderNo` in the staged range
    with **no canonical coldlion identity** — no `source_system='coldlion'` +
    `source_id='coldlion:so-header:<so>'` in `plm.production_order_source_ref` and no line ref
    with the `coldlion:so:<so>:` prefix. **Presence in `coldlion.order_history_line` is
    irrelevant to novelty** — the sealed daily sync already lands closed windows there, so a
    "not in order_history_line" test would suppress every order whose week has closed and been
    loaded, and the very first live-proof week would find nothing. Index note: the
    `LIKE 'coldlion:so:<so>:%'` prefix predicate only rides the existing
    `unique (source_system, source_id)` b-tree when the column's collation supports LIKE
    optimisation (C/POSIX). **Default to the range-scan rewrite** (`>= prefix AND <
    prefix || chr(1)`), which rides the existing unique b-tree at `20260810010000:245` and
    needs no new index. Only if the range scan is rejected should an implementer add
    `(source_system, source_id text_pattern_ops)` on `plm.production_order_line_source_ref` —
    and that is a write on a `plm` object A0 declares under `reads:`, so it requires
    redeclaring A0's `writes:` list first. Name whichever is chosen, because the 3×-cadence
    rule must never absorb an unindexed scan.
  - *Gate (staged dispatch ladder — no production write before its turn):* (1) preview
    `--dry-run --limit 5` from a laptop prints the windows it would fetch and the orders it
    would detect, touching nothing; (2) preview workflow-dispatch stages real preview windows;
    (3) ONE bounded production dispatch with `--limit` stages real windows and creates
    placeholders; only then does F1 run and enable the cron. Record each dispatch run id. One
    detected order is cross-checked by hand through `orderHistory?salesOrderNo=` inside its
    start-date window.

**Phase C — decode + canonical writer.**

- **C0. ✅ Ruled 2026-09-17 (Albert): one sales order maps to many production orders.**
  The ruling and the placeholder/line-claim design are recorded in §8 and in the
  business-rules intake section; C2 implements them.
- **C1. Decode step** (same job, post-poll): join staged `warehouseCode` to
  `coldlion.routing_code_map`; unknown code → `coldlion.intake_quarantine` and exclusion from
  canonical creation; rows with `salesOrderNo = 0` quarantined (§8 — no `COLDLION-SO-0`);
  **no COS/stock attempt at all** (that meaning lives on the production side); new-code counts
  logged in the run summary.
- **C2. Canonical writer** `tools/coldlion-landing/order-intake-write.mjs`: for each
  `intake_new_order` in state `pending`:
  0. **Resolve grain and version before mapping any field.** The winning version of every
     staged line = greatest `last_seen_run`, then `line_source_hash`, per `(sales_order_no,
     sales_order_line_no, master_item_no)`; the winning component = greatest `last_seen_run`,
     then `component_source_hash`, per `(line_id, sub_item_no, sub_label_code)` — served by
     the two winner-selection indexes A1 declares (the identity uniques omit `last_seen_run`
     and cannot serve this sort); the same
     two-key tiebreak on both grains, so two runs can never mint different winners, ordinals,
     or `source_id`s for the same logical line or component. Never sum across versions or
     components. Quarantine applies only to variation **within one hash group** of exploded
     rows (the sealed loader's constancy rule: every projected field except the hash and run
     FKs must be constant across rows that share one `line_source_hash`/`component_source_hash`).
     Cross-version forks — rows with different hashes — are resolved by winner-selection,
     not quarantined. A hash change IS a projected-field change and is expected across
     versions; the settled rule that differing projections are separate versions, never
     merged, is honoured by selecting the winner, not by refusing the order. The component ordinal for `source_id` determinism = order of
     first appearance sorted by `(sub_item_no NULLS LAST, sub_label_code NULLS LAST)` —
     stable across runs. One canonical line per winning
     component: direct line → `sku = COALESCE(NULLIF(sub_item_no,''), master_item_no)`,
     `assortment_id = NULL`; prepack component → `assortment_id = master_item_no`,
     `sku = COALESCE(NULLIF(sub_item_no,''), master_item_no)`, `assortment_component_ordinal`
     = the component's stable ordinal; line source ref
     `source_id = 'coldlion:so:<salesOrderNo>:line:<salesOrderLineNo>:component:<ordinal>'`.
     `quantity_ordered = order_qty` (the per-SKU quantity ColdLion added 2026-08-31 —
     "per-SKU quantities, precomputed — use these"); `line_qty` (the parent total repeated on
     every exploded component) is stored in line metadata and never used as a per-line
     quantity, per `20260905105038:604` and the 48-column contract.
  1. **Idempotency check only** (§8): `source_system='coldlion'` +
     `source_id='coldlion:so-header:<salesOrderNo>'` present → update that placeholder; absent
     → create below. Never attach that source_id to a non-placeholder header; never touch a
     `google_order_list` header ref. Rows with empty normalized `poNumber` (Amazon stock) skip
     the customer-PO tuple entirely — the placeholder is keyed on `salesOrderNo` alone.
  2. **Create** the placeholder header `COLDLION-SO-<salesOrderNo>` with
     `metadata.production_order_number_origin = 'coldlion_intake_placeholder'`. The writer's
     UPDATE path touches `production_order_number` **only when**
     `metadata->>'production_order_number_origin' = 'coldlion_intake_placeholder'` and refuses
     otherwise in SQL — direct writes bypass the #1772 RPC immutability, so the guard lives in
     the writer SQL itself. Volatility: read-only helpers (C1 routing decode, winner-selection
     helper, run-summary/notes helper) are `STABLE` — never `IMMUTABLE` — because they read
     tables that change; anything that writes (the UPDATE guard, failure-recorder inserts,
     any routine that updates `plm.production_order` or inserts source refs) is `VOLATILE`.
     This rule applies to **every** new routine the intake adds. Customer resolution:
     `core.company_source_ref` (`source_system='coldlion'`, `source_table='customers'`,
     `source_id = customerCode`) → `company_id` → `core.customer.id` FIRST;
     `plm.erp_customer.customer_code` (requiring the importer's `active = true` filter)
     SECOND; either miss or a disagreement between the two → quarantine (never insert
     `core.customer`, never pick silently). Line fields:
     `order_person` ← `salesPersonCode1`, `order_type` + `ship_to` ← decoded map,
     `customer_po_number` ← raw `poNumber` (text), `quantity_ordered`/`assortment_id`/`sku` per
     step 0, `case_pack` ← `coldlion.item_detail.carton_qty` default,
     `start_ship_date`/`cancel_date` ← ERP dates (NULL on `1900-01-01`). Customer →
     `plm.production_order.company_id` → `core.customer` via customer code map; unmatched
     customer → quarantine (never a new company). `order_depth_inches` stays NULL: Albert's
     2026-09-17 input-column list omits col 18 — do not "complete" it from the #1772
     inspection. Description/license status: projection only, no copied text.
  3. Write `coldlion` source refs for header and every line — `is_primary = true` on exactly
     one header ref and one ref per line; never touch a `google_order_list` ref (overwriting a
     Google ref with a Coldlion ref is forbidden, `20260810010000:222-223`). Set
     `intake_new_order` state; raw JSON evidence stays in the staging version rows.
  - *Gate:* for a quarantine-free test order on preview: the canonical row exists exactly
    once; its `production_order_line` count equals the number of **winning-version** staged
    components for that order; source refs exist with correct `is_primary`; a second
    `--write` run changes nothing.

**Phase D — workflow.**

- **D1.** `.github/workflows/coldlion-order-intake.yml`: schedule + `workflow_dispatch`
  **only** — never `pull_request`/`push`, so a branch cannot make it write
  (`coldlion-landing-sync.yml:20-24`). `permissions: contents: read`; `timeout-minutes`;
  concurrency group `coldlion-order-intake`, `cancel-in-progress: false`. **First job step
  runs the new offline tests by name** (`node --test tools/coldlion-order-intake-*.test.mjs`),
  then missing-secret refusal, then the declared-target env block with
  `COLDLION_EXPECTED_PROJECT_REF: qsllyeztdwjgirsysgai` beside the two credentials — the same
  order as `coldlion-landing-sync.yml:74-95`. Reporting goes to `$GITHUB_STEP_SUMMARY` and
  `coldlion.sync_run.notes`, not to PR comments (a scheduled run has no PR, and any `gh` call
  must go through the sanctioned transport module —
  `scripts/check-github-transport-conformance.mjs`). Failure alerting = the **sibling
  failure recorder** of §8 (failed `sync_run` row + `pg_notify('coldlion_sync_alert', …)`, no
  `window_ledger` writes) — do NOT call `recordFailure()` itself, which also marks sealed
  ledger rows failed.
  - *Gate:* two consecutive scheduled runs green; a deliberately bad key on preview fails the
    alert path once, then is reverted; the PR-trigger audit shows no `pull_request`/`push`
    triggers.

**Phase E — tests (names are binding; flat `tools/` placement is binding).**

- `tools/coldlion-order-intake-window-arithmetic.test.mjs` — trailing + forward window
  enumeration on the grid, empty-month stop rule, 18-month cap, inclusive bounds.
- `tools/coldlion-order-intake-decode.test.mjs` — routing map join, unknown-code quarantine,
  POE-vs-DDP family tagging, and **COS/stock absence proven**: no sales-side COS detector
  exists; `salesOrderNo = 0` rows route to quarantine and never mint a `COLDLION-SO-0`
  header.
- `tools/coldlion-order-intake-claim.test.mjs` — poNumber normalization (both padding
  shapes), winning-version selection with the constancy assertion and deterministic ordinal,
  source-ref-only idempotency (miss → create placeholder), **multi-match on customer PO
  alone → expected under 1:N, never quarantine** (quarantine only on unresolvable customer,
  unknown routing code, or `salesOrderNo = 0`), version fan-out, idempotent
  second run, `EP001` exclusion, `1900-01-01` → NULL, negative quantity preserved,
  `is_primary` placement, placeholder header key.
- All are auto-discovered by the `FILES=(tools/*.test.mjs)` glob (`tools-offline-tests.yml:187`)
  and must pass offline with no secrets and no database contact; never place them in a
  subdirectory. Existing suites stay green under `node --test tools/*.test.mjs`.

**Phase F — live proof.**

- **F1.** Pick the most recent full business week. **Week membership is defined per side**
  (ERP `startDate` diverges from the sheet's Start Ship Date — finding 3): sheet side by
  sheet Start Ship Date, intake side by ERP `startDate`; cross-week drift is reported as its
  own divergence class. Compare, order by order: the Google sheet's rows for that week vs the
  intake-created canonical rows (customer PO normalized, item as a normalized SKU token — no
  raw SKU text in the report, quantity, order type/ship-to). Produce `docs/verification/coldlion-order-intake-<date>/README.md`
  (counts and deterministic refs only — no customer/SKU text). Record both expected divergence
  classes: orders in the sheet not yet in the ERP, and ERP orders whose sheet Order Type is
  wrong (POE-labelled DDP) — the latter is the system being *more* correct, not a bug. The
  cron stays disabled until this passes; open exactly one live-proof owner issue if any proof
  is deferred.

### 10. Tests required

Named in Phase E. Every assertion quoting real counts in docs/verification must cite the
command or query that reproduces it (STATUS-table evidence rule). No test may embed real
customer names, PO numbers, or SKUs — synthetic fixtures shaped like the live ones.

### 11. Constraints, standing rules, and gotchas

- **DB changes go through shared-db governance** — db-work issue + author lane + reserved
  version + live-proof probe + `database-contract-tests` (§9 A0). Never app-repo migrations;
  never edit a consumer repo's `shared-db/` mirror.
- **Never touch the sealed-window machinery:** no writes to `coldlion.window_ledger`,
  page-evidence tables, or the sealed `order_history_*`/`prod_history_*` tables from the intake
  path. `coldlion.sync_run` is the one shared table, and writing it is safe (§8).
- **The #1772 input-only contract stays intact.** No widening of `dam_order_allowed_*_keys()`,
  no new `plm` privileges, no writes through the browser RPCs.
- No band-aids, no silent failures: every quarantine is a visible row with a reason; every run
  writes its `coldlion.sync_run` record with counts.
- Nothing hard-coded: routing codes from the map table; `COMPANY_CODE`/`PAGE_SIZE`/
  `EXCLUDED_DIVISION` imported from `lib/scopes.mjs`; the horizon constants in one place with
  a comment naming the ruling.
- This repo has **no `package.json`** — never yarn/npm; `node --test` only. Workflows that
  write to the shared DB: schedule/dispatch only, offline tests first in the same job.
- Licensed/customer content stays out of public venues: verification docs carry counts and
  refs, not row contents.
- Politeness to ColdLion: serial requests, pauses; a `400` with body-status 500 is permanent.
- **STATUS-table duty:** whoever executes a step updates this plan's STATUS row the same day,
  citing an artifact (file path, CI run, command) — never a bare number.

### 12. Access and environment

- ColdLion key: 1Password vault `vibe_coding`, item "Coldlion ERP API key x5.coldlion.com"
  (`op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`), or env
  `COLDLION_API_KEY`. Value never appears in code, logs, or docs.
- Database: GitHub secrets — exactly two — `SUPABASE_DB_URL_PRODUCTION` (pooler URL for
  `qsllyeztdwjgirsysgai`) and `COLDLION_API_KEY`. `COLDLION_EXPECTED_PROJECT_REF` is a literal
  in the workflow env (`coldlion-landing-sync.yml:86`), and `proveTarget()` refuses mismatched
  connections. Production writes happen only from the workflow; local runs target a preview
  project.
- Branch: feature branch → PR through the guarded merge workflows. The docs PR (Step 0)
  merges first. Local runs: `node tools/coldlion-landing/order-intake.mjs --dry-run
  --limit 5` with `DATABASE_URL` (preview) + `COLDLION_API_KEY`.

---

## Part 4 — Landing it

### 13. Definition of done + risks + open questions

**Done when:** Step 0's docs PR is merged (verify with git log); Phases A–F green under the
governed workflow (live-proof probe present, contract tests green); two consecutive scheduled
runs succeed **after** F1 enables the cron; the sample-week reconciliation report exists and
every divergence in it is explained; STATUS rows cite artifacts; the business-rules intake
section reflects the C0 ruling; a live-proof owner issue is open if any proof was deferred.
Rollback = disable the workflow; staging tables are additive and harmless; canonical rows
created by the writer are ordinary `plm` rows correctable through existing paths.

**Risks:** ColdLion payload/vocabulary drift (quarantine + run summaries); double-writer
races (workflow concurrency queue + identity uniqueness); a future production-side writer
ignoring the move-not-copy claim semantics of §8 (the split-suffix reservation prevents
the worst case); forward-scan cost growth (bounded by the empty-month rule + cap; beyond-cap
orders surface via later forward scans as today advances).

**Open questions:** preview-project name for safe dry-runs (check with the orchestrator before
first production write); exact review-queue surface; whether Phase 2 lands `/prodtracking` (recommended after intake stabilises — brings `shipPortCode`,
`containerNo`, deposits, real `createdTime`).

---

## Self-audit (mandatory gate — preserved per skill)

1. **Could a brand-new session execute this without asking anything?** Yes — Step 0 lands the
   authority before any code session starts; §5–§6 carry the full current state with file:line
   refs including the governance dispatch (§9 A0); §9 gates every step with the repo's actual
   mechanisms (live-proof probe, contract tests, flat test glob, workflow rules); §12 gives
   access by location; §7 prevents the known dead ends including PR #331's. The C0 cardinality question is ruled (2026-09-17); no mid-build
   escalation remains on it.
2. **Does it carry all background and reasoning?** Yes — every ruling from the 2026-09-17
   session is in the business-rules topic or §6–§8; the withdrawn entry-lag claim, the
   POE/DDP correction, the two-vocabulary discrepancy, the forward-horizon ruling with the
   cap honestly labeled as the plan's own bounded decision, and the Qwen audit's 15
   contradiction findings folded in with their evidence.
3. **Is the goal clear enough to steer a wrong step?** Yes — §1 states the business outcome
   and the explicit "goal wins over steps" instruction.
