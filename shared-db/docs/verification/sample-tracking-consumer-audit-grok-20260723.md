# Sample Tracking consumer gap analysis (Grok, 2026-07-23)

> **Provenance:** Independent read-only audit by **Grok (grok-4.5, Grok CLI)**, run 2026-07-23 with file-read/grep only (no edits, no shell, no DB). Its schema claims were independently re-verified against live production (`qsllyeztdwjgirsysgai`) by the calling engineer; the highest-impact findings (movement CHECK vocab, in-transit line requirement, closeout watermark NOT NULL, owner FK target, and the two completion-logic view defects) were confirmed true. Findings are Grok's wording, filed verbatim for the record.

---

# Sample Tracking gap analysis (read-only)

**Canonical DB:** `C:\repos\shared-db` migrations `20260722221000`–`20260722221700` are applied to production. Physical quantity authority is `dflow.sample_movement` via `post_sample_movement`; membership is `UNIQUE(sample_id_fk, box_id_fk)`; box tenancy is `owner_factory_id_fk` / `ownership_state`.

**Local mirror:** `C:\repos\dflow\designflow-tracking\shared-db\` is **stale**. Its `fix_sample_tracking_schema.md` still says “implementation has not started”, and there are **no** `20260722221*.sql` files under that mirror. Consumer code must be compared to `C:\repos\shared-db`, not the in-repo mirror.

---

## 1. designflow-tracking

### a) Current-state summary: **hybrid — new model partially built, legacy still primary**

The tracking service already has a substantial new stack:

| Area | Present? | Evidence |
|------|----------|----------|
| Sequelize models for movement / shipment_line / closeout / import | Yes | `models/db/sample_movement.js`, `sample_shipment_line.js`, `sample_stop_closeout.js`, `sample_import_job.js`, `sample_import_row.js` |
| RPC bridge `post_sample_movement` | Yes | `helpers/sampleMovement.js:145-188` |
| Movement actions + view reads | Yes | `models/sampleMovement.model.js`, `routes/sample.router.js:25-105` |
| Shipment intent pack/ship | Yes | `models/sampleShipment.model.js` |
| Stop closeout | Yes | `models/sampleStopCloseout.model.js` |
| Durable import upload/confirm | Yes (but schema-mismatched) | `models/sampleImport.model.js` |
| Box ownership stamp | Yes | `models/sampleGroup.model.js:306-333` |

**But the everyday write path is still legacy scalar:**

- Create writes `sample.quantity` / `status` / `office_location` / `box_id_fk` and a `sample_event` — **no** `post_sample_movement`  
  (`models/sample.model.js:334-373`)
- Update allows direct edit of `quantity` and location-ish fields  
  (`models/sample.model.js:95-100`, `382-429`)
- Check-in/out still advances `sample.status` + `office_location` only  
  (`models/sample.model.js:466-537`)
- Box packing still creates bare `sample_shipment_item` membership and updates `sample.box_id_fk` — **no** shipment_line, **no** movement, **no** `quantity_intended`  
  (`models/sampleGroup.model.js:505-517`)

So: **not “legacy only”**, and **not “fully on the new movement model”**. Dual-path.

---

### b) Required changes (ordered, with severity)

#### P0 — Correctness / will break against live DB

1. **Import tables Sequelize model ≠ production contract**  
   - Migration (`20260722221500`):  
     - Job states: `uploaded|validated|confirmation_pending|confirmed|failed`  
     - Columns: `private_object_key`, `failure_details`, `confirmation_request_hash`, `warning_count`, `error_count`, `updated_at`  
     - Row: `import_job_id`, `normalized_values jsonb`, `validation_errors/warnings jsonb`, `image_state`  
   - App model (`models/db/sample_import_job.js:17-33`, `sample_import_row.js:15-34`):  
     - States `preview` / `applied`, columns `storage_ref`, `failure_detail`, `confirmed_at`, flattened row fields, `import_job_id_fk`  
   - Service writes those wrong shapes (`models/sampleImport.model.js:128-165`, `291-294`).  
   - **Severity: P0** — upload/confirm against production will fail CHECK / missing column / FK name.

2. **`lifecycle_action = 'correction'` is invalid in DB**  
   - DB CHECK: `…'correct'…` (`20260722221400` line 16)  
   - App posts `action: 'correction'` (`models/sampleMovement.model.js:388`, `helpers/sampleMovement.js:43`)  
   - **Severity: P0** — every correction RPC fails constraint.

3. **Discrepancy code vocabulary ≠ DB**  
   - DB: `short|over|damaged|wrong_item|lost|other` (`20260722221400` line 19)  
   - App vocab: `quantity_short|quantity_over|…|missing_documentation|quality_fail` (`config/sampleVocabulary.js:43-51`)  
   - **Severity: P0** — receive/dispose/loss with UI codes rejected.

4. **In-transit movements require `shipment_line_id`**  
   - DB: if either side is `in_transit`, both `box_id_fk` and `shipment_line_id` are NOT NULL (`20260722221400` line 33).  
   - `Movement.receive` allows null shipment line (`models/sampleMovement.model.js:260`).  
   - `Movement.repack` same (`:281`).  
   - **Severity: P0** — common receive path fails unless line is always supplied.

5. **Stop closeout `movement_watermark` is NOT NULL in DB**  
   - Migration: `movement_watermark bigint NOT NULL`  
   - App inserts `null` when omitted (`models/sampleStopCloseout.model.js:95-107`)  
   - Detail UI never sends watermark (`frontend` closeStop body — see frontend section)  
   - **Severity: P0** — closeout create fails.

6. **Shipment pack can insert NULL origins/destinations**  
   - DB: origin/destination type+id NOT NULL (`20260722221300` lines 9-12)  
   - App: `entry.origin_location?.type ?? null` (`models/sampleShipment.model.js:94-97`)  
   - **Severity: P0** — pack without full locations fails.

#### P1 — Dual authority / incomplete adoption

7. **`Sample.create` must post opening movement (or refuse quantity as authority)**  
   - Today: `quantity: body.quantity` only (`sample.model.js:339`); no `callPostMovement`.  
   - Import confirm *does* post create-movement (`sampleImport.model.js:264-282`) — inconsistent.  
   - **Severity: P1** — declared qty never enters ledger; balances empty; ship immediately 422.

8. **Stop writing `sample.quantity` as editable truth**  
   - `EDITABLE` includes `quantity` (`sample.model.js:95-96`).  
   - Plan: movements are sole authority; legacy scalar is compatibility only.  
   - **Severity: P1** — UI grid can invent quantities that views ignore (or worse, operators trust).

9. **`Sample.recordEvent` remains parallel lifecycle authority**  
   - Updates `status`/`office_location` only (`sample.model.js:507-514`).  
   - Does not receive/ship/post movements.  
   - **Severity: P1** — offices can “check in” with zero movement truth; global status stays `legacy_unknown` / empty.

10. **Box membership path not integrated with intent + movements**  
    - `Box.addSamples` only membership + `sample.box_id_fk` (`sampleGroup.model.js:505-517`).  
    - No `quantity_intended` on membership (column exists in DB from `221300`; model omits it: `models/db/sample_shipment_item.js:1-46`).  
    - No auto `sample_shipment_line` pack.  
    - **Severity: P1** — factory pack/ship workflow still legacy membership.

11. **Map UNIQUE `(sample_id_fk, box_id_fk)` to clean 409**  
    - Code still describes uniqueness as “future” (`sample.model.js:43-44`, `sampleGroup.model.js:456-461`).  
    - Catch path is generic (`Box.addSamples` catch → raw err). Concurrent race now throws 23505 instead of “already in this box”.  
    - **Severity: P1**.

12. **Retain semantics vs plan**  
    - Plan §5.4: retention is balance *at physical location* + closeout, not a fake terminal (unless product explicitly chooses terminal).  
    - App moves to `terminal:retained` (`sampleMovement.model.js:288-300`, `helpers/sampleMovement.js:32-38`).  
    - That zeros open-stop work and can make `sample_global_status` look complete while pieces are “retained”.  
    - **Severity: P1** (product decision + code change).

13. **Sample delete vs RESTRICT FKs**  
    - `Sample.remove` deletes events/attachments/comments/membership only (`sample.model.js:440-451`).  
    - Movements/lines/closeouts FK RESTRICT on sample.  
    - **Severity: P1** — delete of any sample with movement history fails.

14. **Closeout balance precondition vs plan**  
    - Plan: close when received qty fully *allocated* (onward / retain / etc.).  
    - App requires physical balance == 0 at location (`sampleStopCloseout.model.js:79-86`).  
    - With retain-as-terminal this can work; with retain-as-physical-balance it never closes with retained stock. Depends on #12.  
    - **Severity: P1**.

15. **Align import confirm job state machine** after model fix (`preview`/`applied` → `confirmation_pending`/`confirmed`).  
    - **Severity: P1** once P0 model fix lands.

16. **Wire create/update list responses to read views** for operational fields (balance, `derived_status` from `sample_global_status`) so clients stop treating `sample.status` as global completion.  
    - **Severity: P2** for API ergonomics; P1 if frontend grid keeps showing wrong truth.

17. **Refresh stale docs / local shared-db mirror**  
    - `docs/sample-quantity-schema-design.md:3` still “design only; no migration”.  
    - `shared-db/` mirror plan + migrations missing.  
    - **Severity: P2** (process risk, not runtime).

---

### c) Backward-compatible / still OK as-is

| Behavior | Why it still works |
|----------|--------------------|
| Restored `sample_shipment_item` reads/writes for membership | Table restored; bare membership rows still valid; `quantity_intended` nullable |
| `UNIQUE(sample_id_fk, box_id_fk)` for clean single-box membership | Tightens race already partially handled in app; no duplicate groups in prod inventory |
| `sample_box.owner_factory_id_fk` nullable + app stamp on create | Additive; vendors stamped; legacy unassigned still use carried-sample bridge (`sampleGroup.model.js:39-46`) |
| `sample.quantity` / `status` / `office_location` / `box_id_fk` remaining on table | Plan: additive / compatibility; no DB ban on writing them yet |
| `quantity_migration_state` default `unknown` | Model has field (`models/db/sample.js:79-83`); existing rows stay unknown |
| Direct factory→NYC proof via membership `leg_type` | Still valid pattern (`sample.model.js:47-80`) |
| Read-only movement history / balance / dashboard *if* movements exist | RPC + views already queried correctly in `sampleMovement.model.js:430-541` |
| Box create ownership stamp from auth identity | Matches plan tenancy (`sampleGroup.model.js:306-333`) |

---

### d) Immediate risks if left as-is (DB already live)

1. **Two truths:** operators use Events + Qty column; ledger/views empty or diverge.  
2. **Import endpoints live but unsafe** against production CHECKs — first real import fails loudly.  
3. **Ship/receive/repack/correction/closeout** partial APIs will 422/23514/NOT NULL depending on body.  
4. **Concurrent add-to-box** hits UNIQUE → unmapped 500 instead of “already in this box”.  
5. **Deleting samples** with any movement history fails FK RESTRICT.  
6. **Tenancy bridge still dual:** owned column preferred, but empty legacy boxes still creator-based — fine short-term if all new boxes stamp ownership.  
7. **Vendor `owner_factory_id_fk` → `dflow.vendor(vendor_id)`** while app uses Factory portal `factory_id` — verify ID identity or FK inserts fail (`221200` FK).

---

## 2. designflow-frontend

### a) Current-state summary: **hybrid UI — movement surfaces added; primary UX still legacy**

Already present:

- Movement dialog + body builder:  
  `pages/sample_tracking/movement-dialog/*`, `helpers/sample.movement.ts`  
- Service wrappers for movements, balances, shipment-lines, closeouts, imports, dashboard:  
  `helpers/services/tracking.service.ts:237-354`  
- Detail flyout loads balances / movements / discrepancies / closeouts:  
  `detail-dialog.component.ts:44-126`  
- Dashboard dialog on views: `dashboard-dialog.component.ts`  
- Import CSV preview/confirm: `import-dialog.component.ts`  
- Parent wires “Record Movement” / Import / Dashboard:  
  `sample_tracking.component.ts:269-314`

Still primary / legacy:

- **New sample** posts only `createSample` with scalar `quantity` — no `postSampleMovement('create')`  
  (`sample_tracking.component.ts:188-223`, `create-dialog.component.ts:55-69`)  
- **Check-in/out** still `recordSampleEvent` / Event dialog (`:245-267`, `event-dialog.component.ts`)  
- **Grid Status + Office + Qty** from legacy columns; Qty **editable**  
  (`sample.tracking.config.ts:54-58, 81-84`; cell save `:329-338`)  
- **Box pack** uses `addSamplesToBox` membership only (`box-group-dialog.component.ts`);  
  **`packShipmentLines` / `shipShipmentLine` never called from any component** (only defined in service)

---

### b) Required changes (ordered, severity)

#### P0 / P1 (depends on tracking fixes first)

1. **Create flow: after sample create (or instead of trusting qty), call movement `create`** when quantity > 0  
   - Today: `createSample(result)` only (`sample_tracking.component.ts:202`).  
   - **Severity: P0 for usable quantity accounting** once backend create-without-movement is fixed or UI owns the movement.

2. **Stop treating grid `quantity` as authority**  
   - Column editable (`sample.tracking.config.ts:81-84` → `updateSample`).  
   - Prefer derived physical/total from balance API, or read-only display of migration-safe fields.  
   - **Severity: P1**.

3. **Expose pack → ship → receive as the main custody path**  
   - Service has pack/ship (`tracking.service.ts:283-318`) but **no UI calls pack/ship line**.  
   - Movement ship requires `shipment_line_id` (`sample.movement.ts:87-88`); without pack UI, ship is blocked.  
   - Box dialog only membership (`box-group-dialog` + `addSamplesToBox`).  
   - **Severity: P1** — end-to-end 4-piece scenario cannot be operated from UI.

4. **Closeout must send `movement_watermark`** (max movement id for sample) once backend enforces NOT NULL  
   - `detail-dialog.component.ts:151-155` omits watermark.  
   - **Severity: P0 against live DB**.

5. **Align discrepancy codes + correction action token with DB** (mirror backend vocab)  
   - `helpers/sample.vocabulary.ts:29-36` uses non-DB codes.  
   - Correction action string `correction` vs DB `correct`.  
   - **Severity: P0** once those actions are used.

6. **Grid / list: show derived global status** (from `global-status` or list enrichment), not only `sample.status`  
   - Status chip uses legacy (`sample-cell-renderers.ts:104-112`, config Status column).  
   - **Severity: P1** for “is this batch done?”.

7. **Event dialog vs movements**  
   - Keep events for audit/backbone status only if product still wants them, but label clearly “status, not quantity”;  
   - Or deprecate office check-in in favor of receive/retain/ship movements.  
   - **Severity: P1** product/UX.

8. **Import UI** will work only after tracking import schema alignment; confirm should surface confirmation idempotency key optionally.  
   - **Severity: P1** after backend P0.

9. **Office location strings** (`Ningbo`/`NYC`) still drive events and receive to_location; plan wants normalized office ids. Acceptable as labels if server maps them, but both sides must agree on `location_id` tokens.  
   - **Severity: P2** until office identity is fixed.

---

### c) Backward-compatible / still OK as-is

| Behavior | Why |
|----------|-----|
| Listing samples, photos, comments, mobile link | Independent of movement ledger |
| Create sample metadata (name, factory, courier, tracking) | Scalar sample row still valid |
| Event recording for status timeline | Still updates legacy columns; table still exists |
| Box create/list/add membership | Works with restored membership table + UNIQUE (with better error mapping preferred) |
| Movement/detail/dashboard/import *UI scaffolding* | Correct direction; fails only where backend contract mismatches or paths unused |
| Tracking service method surface | Ready once backend contract is fixed and UI wires pack/ship |

---

### d) Immediate risks if left as-is

1. Users declare qty on create/grid → **ledger empty** → ship/receive 422; dashboard empty.  
2. Users keep using **Events** as “received in NYC” → status chip looks right, **balances wrong**.  
3. Users open Movement dialog → correction/discrepancy/receive without line → **hard DB errors**.  
4. Users try closeout from detail → **watermark NOT NULL fail**.  
5. Import dialog appears complete → **fails at upload** on production CHECK/columns.  
6. Operators assume “Qty” column = conserved physical truth → **false inventory**.

---

## Bottom line

| Repo | Code change needed to *use* the new movement model? | Size |
|------|------------------------------------------------------|------|
| **designflow-tracking** | **Yes** | **Large.** New stack is ~60–70% present (RPC, routes, models, tests) but **not the sole authority**. Must (1) align Sequelize/import/closeout/action/vocab with live DB (P0 contract bugs), (2) funnel create / pack / ship / receive through movements + shipment lines, (3) demote `sample.quantity`/`status`/`office_location`/`box_id_fk` to compatibility, (4) map UNIQUE/FK failures cleanly. Not a greenfield rewrite; more like a **multi-PR adoption + contract-hardening** pass. |
| **designflow-frontend** | **Yes** | **Medium–large.** Surfaces exist (movement dialog, detail balances, dashboard, import), but **primary UX is still create+qty, events, box membership, editable Qty**. Needs create→movement, pack/ship UI, closeout watermark, vocab alignment, derived status, and de-emphasis of legacy status/qty. Dependent on tracking P0 fixes first. |

**Neither repo is “legacy-only” anymore; neither is fully on the new authority.** Shared-db is ahead of both consumers. Leaving apps as-is does not silently corrupt the ledger (constraints reject bad writes), but **day-to-day Sample Tracking still behaves on the old scalar model** while the new APIs are partial and several of them will **hard-fail** against the production constraints already live.
