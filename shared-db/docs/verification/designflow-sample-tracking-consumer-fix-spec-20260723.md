# DesignFlow Sample Tracking — consumer fix SPEC (2026-07-23)

**Status:** SPEC only. No DesignFlow repository is modified from `shared-db`.

**Owner of the work described here:** `popcre/designflow-tracking` and
`popcre/designflow-frontend` under their normal branch / PR / Uma-review rules
(`sandbox-albert` → PR to `develop`; AI does **not** merge those PRs).

**Owner of the database contract:** `u2giants/shared-db` (this repo). The
completion-semantics repair that this consumer work depends on is authored here
as migration `20260723230000_sample_tracking_completion_semantics.sql`.

**Do not** implement any of the file changes below from a shared-db session.
**Do not** add app-repo migrations or startup DDL. Schema already lives (or
lands) in shared-db; this document only tells DesignFlow how to match it.

**Evidence basis:** contract mismatches below were verified against production
`qsllyeztdwjgirsysgai` CHECKs / columns (read-only). Line anchors point at the
DesignFlow codebases as they existed when this audit was taken; re-confirm
before editing if those branches have moved.

**Stale mirror note:** `designflow-tracking`'s local `shared-db/` mirror still
says Sample Tracking "implementation has not started". That folder is a
read-only sync from this repo's `main` and will refresh on the next main sync
after the completion-semantics PR merges. Do not hand-edit the mirror.

---

## Sequencing (read this first)

1. **Land shared-db completion-semantics** (`20260723230000`) on preview →
   prove `supabase/tests/sample_tracking_completion_semantics.sql` → merge →
   promote under the normal shared-db checklist. Consumers must not assume the
   old false-complete global status.
2. **designflow-tracking P0 hard contract fixes** (items 1–7 below). Without
   these, new tracking APIs will raise CHECK / NOT NULL / FK errors against
   the live database.
3. **designflow-tracking P1 adoption** (items 8–14) so the ledger becomes the
   daily authority instead of legacy scalar columns.
4. **designflow-frontend** after tracking P0 (vocab alignment + closeout
   watermark + create/custody UI). Frontend adoption can partially overlap
   tracking P1 once the API no longer rejects the correct vocabulary.

---

## Shared completion-semantics dependency (plan §15 Q4 — CONFIRMED 2026-07-23)

Product confirmed the completion rule on **2026-07-23**. Shared-db migration
`20260723230000` implements it. This is no longer an open question and is not
the earlier conservative "customer blocks complete" interpretation.

| Balance location | Global effect |
|---|---|
| `terminal` (incl. `*_office_inventory`) | **resolved** |
| `customer` | **resolved** (delivered / out of tracking flow) |
| `factory` / `office` | blocks complete → `outstanding` |
| `in_transit` | `in_transit` status |

### Automatic office inventory (database-enforced)

Each office has its **own** inventory bucket:

- Ningbo leftovers → `terminal` / `ningbo_office_inventory` (label e.g. "Ningbo Ofc Inventory")
- New York leftovers → `terminal` / `nyc_office_inventory` (label e.g. "NY Ofc Inventory")

**Automatically, with no extra user step:** the moment some pieces ship **onward**
out of an office (to `in_transit` heading elsewhere, or directly to `customer`),
whatever quantity **remains** at that office is moved into that office's inventory
bucket and **exits** the main tracking flow. Pieces stay fully conserved and
auditable in the ledger — inventory is a **terminal disposition**, not a deletion.

This is implemented as an `AFTER INSERT` trigger on `dflow.sample_movement`
(`sample_movement_auto_office_inventory_trigger`) so **every** caller is covered.
The consumer app must **not** re-implement or skip this step.

### Canonical four-piece end state

Factory makes 4 → Ningbo receives 4, keeps 1, ships 3 → NY receives 3, keeps 2,
ships 1 to customer:

```text
terminal/ningbo_office_inventory = 1
terminal/nyc_office_inventory    = 2
customer                         = 1
in_transit = 0, office balances = 0
derived_status = complete
```

Local stop closeout still does **not** make a sample globally complete while
pieces remain at unresolved `factory` / `office` locations (Defect B fix).

### Frontend display note (office inventory buckets)

Surface `*_office_inventory` terminal buckets (e.g. "Ningbo Ofc Inventory",
"NY Ofc Inventory") as **out-of-flow / resolved locations** — not as outstanding
work. They should appear in history and conservation views as terminal
dispositions, similar to delivered/disposed, not as open office handling.

---

## `popcre/designflow-tracking`

### P0 — hard-fails (new APIs will error against live DB)

#### 1. Lifecycle action vocabulary: `correction` vs `correct`

| | |
|---|---|
| **Why** | Live CHECK on `dflow.sample_movement.lifecycle_action` allows only `create\|pack\|ship\|receive\|retain\|repack\|deliver\|return\|dispose\|loss\|correct\|reopen\|closeout`. App posts `correction`. |
| **Anchors** | `models/sampleMovement.model.js` ~:388; `helpers/sampleMovement.js` ~:43 |
| **Change** | Emit and accept DB value `correct` everywhere. Keep a one-release alias map from `correction` → `correct` on *inbound* requests if external clients already send `correction`, but never write `correction` to the DB. Mirror the same constant list the migration uses. |

#### 2. Discrepancy codes

| | |
|---|---|
| **Why** | Live CHECK allows only `short\|over\|damaged\|wrong_item\|lost\|other`. App uses `quantity_short`, `quantity_over`, `missing_documentation`, `quality_fail`. |
| **Anchors** | `config/sampleVocabulary.js` ~:43–51 (and any re-exports) |
| **Change** | Align exported enums to the DB set. Map legacy app codes at the API boundary if needed (`quantity_short`→`short`, `quantity_over`→`over`, quality/docs failures → `other` or `damaged` with details text). Never insert a non-CHECK value. |

#### 3. In-transit movements require `box_id_fk` + `shipment_line_id`

| | |
|---|---|
| **Why** | Live CHECK: when either side is `in_transit`, both `box_id_fk` and `shipment_line_id` are NOT NULL (plus transit box-identity hardening). App receive/repack paths allow null shipment line. |
| **Anchors** | `models/sampleMovement.model.js` ~:260, ~:281 |
| **Change** | Require a real `sample_shipment_line` row before ship/receive/repack that touches transit. Create the intent line at pack time; pass both FKs into `post_sample_movement`. Reject the request early with a clear 400 if either is missing. |

#### 4. Stop closeout `movement_watermark` is NOT NULL

| | |
|---|---|
| **Why** | Live column `dflow.sample_stop_closeout.movement_watermark bigint NOT NULL` (FK to `sample_movement.movement_id`). App inserts null. |
| **Anchors** | `models/sampleStopCloseout.model.js` ~:95–107 |
| **Change** | Always stamp `movement_watermark = max(movement_id)` for that sample at close time (or the movement id that justifies the close). Fail closed if the sample has no movements. Do not invent watermarks. |

#### 5. Durable import models do not match production

| | |
|---|---|
| **Why** | Sequelize models describe a different state machine and column set than live `dflow.sample_import_job` / `dflow.sample_import_row`. |
| **Live job states** | `uploaded\|validated\|confirmation_pending\|confirmed\|failed` |
| **Live job columns (material)** | `private_object_key`, `failure_details`, `confirmation_request_hash`, `warning_count`, `error_count`, `updated_at` (not `storage_ref` / `failure_detail` / `confirmed_at` / preview-applied states) |
| **Live row columns (material)** | `normalized_values jsonb`, `validation_errors`, `validation_warnings`, `image_state` |
| **Anchors** | `models/db/sample_import_job.js`, `models/db/sample_import_row.js`, `models/sampleImport.model.js` ~:128–165, ~:291 |
| **Change** | Rewrite model field maps and state transitions to the live contract. Drop or rename phantom columns. Keep preview→confirm idempotent against `confirmation_idempotency_key` / `confirmation_request_hash`. |

#### 6. Shipment line pack must supply origin/destination type+id

| | |
|---|---|
| **Why** | Live `dflow.sample_shipment_line` requires NOT NULL origin/destination type and id. App pack path can insert nulls. |
| **Anchors** | `models/sampleShipment.model.js` ~:94–97 |
| **Change** | Require origin and destination typed locations at pack. Derive from the authorized actor location + chosen route leg; refuse pack without them. |

#### 7. Box ownership FK is `dflow.vendor(vendor_id)` (NOT VALID)

| | |
|---|---|
| **Why** | `sample_box.owner_factory_id_fk` references `dflow.vendor(vendor_id)`. App stamps a Factory-portal `factory_id`. If those id spaces diverge, ownership inserts fail. |
| **Anchors** | `models/sampleGroup.model.js` ~:306–333 |
| **Change** | **Must-verify before shipping ownership writes:** prove `vendor_id` equals the id the Factory portal uses (or introduce an explicit mapping table/lookup). Document the proof in the tracking PR. Do not assume name equality. Until verified, keep ownership_state `unassigned`/`internal` rather than writing a wrong FK. |

---

### P1 — dual-authority / adoption (ledger stays empty in daily use)

#### 8. `Sample.create` must post an opening `create` movement

| | |
|---|---|
| **Why** | Create writes only `sample.quantity` + a `sample_event`. Import confirm already posts create-movements — inconsistent. Without an opening movement, Defect A leaves the sample `uninitialized` forever and the ledger is empty. |
| **Anchors** | `models/sample.model.js` ~:334–373 |
| **Change** | In the same DB transaction as the sample insert, call `dflow.post_sample_movement` with lifecycle `create` (terminal:`created` → factory/source) for the declared quantity when `quantity_migration_state='known'`. Never fabricate quantity for legacy `unknown` rows. |

#### 9. Demote scalar quantity/status/office/box to compatibility

| | |
|---|---|
| **Why** | `quantity` remains in the editable field list; grid treats it as authority. Plan decision 4: movement history is the only physical-quantity authority. |
| **Anchors** | `models/sample.model.js` ~:95–100 |
| **Change** | Remove `quantity`, `status`, `office_location`, `box_id_fk` from unrestricted edit paths. Keep columns readable for compatibility; updates should flow from derived balances / movements only (or be rejected with 409 for quantity). |

#### 10. Check-in/out must post receive/ship/retain movements

| | |
|---|---|
| **Why** | `Sample.recordEvent` (~:466–537) mutates status/office_location only. Physical custody never enters the ledger. |
| **Anchors** | `models/sample.model.js` ~:466–537 |
| **Change** | Map each check-in/out intent to the correct lifecycle action + locations and post through `post_sample_movement` (with shipment_line when transit is involved). Keep the event row as audit UI history if needed, but do not let it be the custody authority. |

#### 11. `Box.addSamples` must create shipment intent + movement metadata

| | |
|---|---|
| **Why** | Adds bare membership + sets `sample.box_id_fk` with no `sample_shipment_line`, no movement, no `quantity_intended`. Membership model omits the new column. |
| **Anchors** | `models/sampleGroup.model.js` ~:505–517; `models/db/sample_shipment_item.js` |
| **Change** | On add: create/update membership with `quantity_intended`, create `sample_shipment_line` intent, and only post ship when the box actually ships. Align Sequelize model columns with live `sample_shipment_item` (including `quantity_intended`). |

#### 12. Map UNIQUE(sample, box) to clean 409

| | |
|---|---|
| **Why** | DB already has `UNIQUE(sample_id_fk, box_id_fk)`. Code still treats 23505 as a "future" concern. |
| **Anchors** | `models/sample.model.js` ~:43; `models/sampleGroup.model.js` ~:456–461 |
| **Change** | Catch Postgres `23505` on that constraint and return HTTP 409 with body meaning "already in this box" (idempotent-friendly for retries). |

#### 13. Retain / office-inventory semantics (do NOT hand-roll terminal retain)

| | |
|---|---|
| **Why** | App currently moves retained pieces to `terminal:retained` (`sampleMovement.model.js` ~:288–300). That fights the confirmed 2026-07-23 rule: the **database** automatically moves an office's remaining pieces into that office's inventory bucket (`terminal/{office_id}_office_inventory`, lifecycle `retain`) the moment some pieces ship **onward** out of the office. Hand-rolling `terminal:retained` would invent a competing disposition and double-count or skip conservation. |
| **Anchors** | `models/sampleMovement.model.js` ~:288–300 |
| **Change** | **Do not** post retain-as-`terminal:retained` from the app for office remainders. Let the DB auto-inventory trigger handle office remainders on onward ship/deliver. The app should post genuine terminal dispositions only for true exit events (`deliver` / `dispose` / `loss` / `return`). Surface auto-generated office-inventory movements **read-only** in UI/history (idempotency keys like `auto-ofc-inv-{source_movement_id}`). Do not invent a second retain write path. |

#### 14. `Sample.remove` vs RESTRICT FKs

| | |
|---|---|
| **Why** | Remove deletes events/attachments/comments/membership only. Movements, shipment lines, and closeouts FK-RESTRICT on sample, so delete fails once history exists. |
| **Anchors** | `models/sample.model.js` ~:440–451 |
| **Change** | Decide product policy: **block** delete when movement history exists (recommended default; return 409 with reason), or soft-archive. Do not cascade-delete audit movements. |

---

## `popcre/designflow-frontend`

Frontend work is medium-large and should follow tracking P0 so the API accepts
the corrected vocabulary and required fields.

### P0 (with tracking P0)

| Change | Anchors / notes |
|---|---|
| Align lifecycle action vocab with DB (`correct`, not `correction`) | `helpers/sample.vocabulary.ts`, `helpers/sample.movement.ts` |
| Align discrepancy codes with DB set | `helpers/sample.vocabulary.ts` ~:29–36 |
| Closeout dialog must send `movement_watermark` | `detail-dialog.component.ts` ~:151–155 (today omits it) |
| Surface API 400/409 messages for missing shipment_line / already-in-box | wherever movement and box membership errors are toasted |

### P1 / adoption (after tracking adoption APIs exist)

| Change | Anchors / notes |
|---|---|
| Create flow posts a `create` movement (or relies on tracking create that does) | sample create components/services |
| Stop treating grid Qty as editable authority | `sample.tracking.config.ts` ~:81–84 — demote Qty/status/office/box to read-only compatibility or derived display |
| Expose pack → ship → receive as the main custody path | Tracking service already has `packShipmentLines` / `shipShipmentLine` but **no component calls them**; movement ship requires `shipment_line_id` |
| Show derived global status from `sample_global_status` (or a tracking BFF field that reads it) instead of legacy `sample.status` | status column / filters / badges |
| Display `*_office_inventory` terminal buckets as out-of-flow resolved locations (e.g. "Ningbo Ofc Inventory", "NY Ofc Inventory"), not as outstanding work; show auto-generated retain movements read-only in history | inventory / location / history UI |
| Do **not** hand-roll retain-to-`terminal:retained`; rely on DB auto-inventory on onward ship | retain action handlers |

---

## Out of scope for this document

- Authoring or editing shared-db migrations beyond what already landed /
  is in flight for completion semantics.
- Editing any file under `C:\repos\dflow` or any `popcre/designflow-*` repo
  from the shared-db worktree.
- Raw audit report files (filed separately by the calling engineer).
- Production promotion windows, Coolify/Cloud Build, or secret changes.
- Opening / merging shared-db PRs or applying migrations (calling engineer).

---

## Suggested PR split (DesignFlow-owned)

1. **tracking-p0-contract** — items 1–7 only; unit tests assert CHECK-safe
   payloads; no UI redesign.
2. **tracking-p1-ledger-adoption** — items 8–14; integration tests for create
   movement, check-in/out movements, 409 already-in-box; **no** hand-rolled
   `terminal:retained` for office remainders.
3. **frontend-vocab-and-closeout** — vocab + watermark + error surfacing.
4. **frontend-custody-ux** — pack/ship/receive path, derived global status,
   demoted Qty column, office-inventory buckets as out-of-flow locations.

Each PR targets `develop` from `sandbox-albert` (or the active sandbox branch)
and waits for Uma review. shared-db completion-semantics should be merged and
visible on the environment those PRs test against before relying on
`uninitialized` / fixed Defect B / auto office-inventory / customer-resolved
complete behavior.
