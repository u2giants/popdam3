# fix_vendor_reconcile.md — Reconcile `core.factory` to the corrected Coldlion `/vendors` table

**Written:** 2026-07-22 · **Repo:** `u2giants/shared-db` · **DB:** shared Supabase `qsllyeztdwjgirsysgai`
**Status:** ✅ EXECUTED 2026-07-22 (migration `20260722140000_vendor_reconcile_to_corrected_vendors_table.sql`,
applied + verified on prod). Anthony's ruling: **inactivate** (Albert). Result: `core.factory` **510 → 93
rows (91 active / 2 inactive)**, factories only; 418 stale old-feed rows purged; Anthony's re-added
inactive with its mirror relinked; CNWAH skipped. **Mirror refresh DONE 2026-07-22** — migration
`20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` (PR #145) reconciled the silver
`plm.erp_vendor` from 539 → **97** on preview + prod (deleted 442 stale inactive rows; live feed verified
= 97). Steps 3–4 (persist "not a factory" exclusions; confirm importer keys on source id) are now
specified in [`fix_vendor_sync.md`](fix_vendor_sync.md) (HANDOFF OPEN #2), the recurring-sync plan.

## 1. What changed (the trigger)

Coldlion **fixed the `/vendors` endpoint**. It previously served **539** records — a mixed
population of merchandise vendors (factories) AND general/AP service-providers (freight, government,
banks, couriers, real-estate). As of **2026-07-22** `/vendors` serves **97 records, all active**, and
the service-providers are gone. This confirms the 2026-07-21 wrong-table hypothesis
(`docs/coldlion-erp-api-reference.md`). The 97 are the correct merchandise-vendor (factory) universe.

## 2. Where `core.factory` stands vs the corrected table (measured 2026-07-22)

`core.factory` today = **510 rows** (curated 2026-07-20/21 from the OLD 539-row mixed feed). Against
the corrected 97-code table:

| Bucket | Count | Meaning |
|---|---|---|
| Correct table codes | 97 | The right factory universe (all active upstream) |
| → already in `core.factory` | 92 rows | Real factories, already curated. (97 codes collapse to 92 rows because earlier `merge_factory` dedup put multiple codes on one survivor.) |
| → genuinely new codes | 2 | `ANT001` = ANTHONY'S WAREHOUSE & DISTRIBUTION (purged 2026-07-21 as "not a factory"); `CNWAH` = a **blank, nameless** placeholder record (empty desc/city/country) |
| Stale `core.factory` rows | 418 | Coldlion-mapped but NOT in the corrected table = the old-feed service-providers. **All 418 are already `status='inactive'`** (the 2026-07-21 status seed), and have **ZERO** downstream references (0 products / 0 style bridges / 0 production orders / 0 RFQs / 0 opportunities / 0 vendor_contacts — verified 2026-07-22). |

92 + 418 = 510 ✓.

## 3. The reconcile plan

### Step 0 — Refresh the mirror
Re-pull the corrected `/vendors` (97 rows) into `plm.erp_vendor`, replacing the old 539-row mirror.
Record an `ingest.sync_run` (`source_system='coldlion'`, `source_name='coldlion_vendors_api'`) with
row counts and a durable failure path (the PR #107 pattern — failures must survive rollback). Keep the
old mirror rows only if any are still referenced; otherwise the mirror should match the source (97).

### Step 1 — Purge the 418 stale non-factories (destructive, but safe)
They are inactive, unreferenced, and absent from the corrected table. Delete them from `core.factory`
(cascades `factory_alias` / `factory_source_ref` / `vendor_contact`; the set-null FK tables have zero
references here). Guard the DELETE by "coldlion-mapped AND no source_code in the corrected 97" so it
can only hit stale rows. **Expected result: `core.factory` drops from 510 → 92 rows** (all active).

### Step 2 — Handle the 2 new codes
- **`ANT001` (Anthony's Warehouse & Distribution)** — **needs Albert.** Coldlion still classifies it as
  a merchandise vendor, but Albert ruled it "not a factory" on 2026-07-21 and it was deleted. Options:
  (a) keep it excluded and add a **durable exclusion rule** so it doesn't silently return on future
  syncs (recommended); (b) accept it back as an active factory. **Do not proceed without this ruling.**
- **`CNWAH` (blank/nameless)** — skip. The importer must **reject blank `vendorDesc`** so placeholder
  records never enter `core.factory`. Flag it, don't import it.

### Step 3 — Persist the "not a factory" exclusions (anti-regression)
The borderline non-manufacturers Coldlion still lists in the 97 should not silently reappear on
re-sync. Besides Anthony's, eyeball: **Buildasign LLC, May Group USA Deco Sign, Floor Gardens (FLGDS),
TUFKO INTERNATIONAL (INTUF), Royal Packers, Royal Union**. Decide which are genuinely not factories and
record the exclusions (a small `metadata` flag or an exclusion list the importer consults) so the
decision is durable, not re-litigated every sync.

### Step 4 — Confirm the importer won't re-split merged dups or re-add deletes
The corrected source still contains the exact-name duplicate pairs already merged in `core.factory`
(Taizhou Meihua, Xianju Sunway, Yiwu TaoYe, Xianju Fenda). Because the survivors carry BOTH codes as
`factory_source_ref` rows (e.g. Sunway survivor holds `CNDWG`+`CNHUS`), an upsert **by
`(source_system, source_table, source_id)`** resolves both codes to the survivor — no re-split. Verify
the vendor importer keys on source id and updates the existing factory rather than inserting a new row.
Likewise the importer must not re-create purged rows (Anthony's) — hence Step 3's exclusion rule.

### Step 5 — Serving/exposure + docs
Serving is folded into `DB_Data_Admin.md` (the admin app reads `core.factory`). After the reconcile:
update `docs/app-migration-notes/coldlion-customers-vendors-20260715.md` with the new counts, mark
`fix_vendor_review.md` fully done, and retire both `fix_vendor_review.md` and this file.

## 4. Net effect if executed (pending the Anthony's ruling)
`core.factory`: **510 → ~92 rows, all active, factories only** — matching the corrected Coldlion table,
with the curated merges/aliases preserved and the old-feed service-provider noise gone. Status stays
app-owned (future re-pulls never clobber curation).

## 5. Open decision blocking execution
**Anthony's Warehouse & Distribution (`ANT001`)** — exclude (recommended) or accept as a factory?
Everything else in the plan is mechanical and safe once that's answered.
