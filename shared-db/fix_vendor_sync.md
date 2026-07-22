# fix_vendor_sync.md — Plan for a RECURRING Coldlion vendor → `core.factory` sync

**Written:** 2026-07-22 · **Repo:** `u2giants/shared-db` · **DB:** shared Supabase `qsllyeztdwjgirsysgai`
**Status:** 📋 PLAN (not yet built). This is the design a future session implements as one or more
additive shared-db migrations plus a Supabase **Edge Function + `pg_cron`** sync (§6). Read it top to
bottom before writing any code.
**Prereq done:** OPEN #1 (mirror `plm.erp_vendor` reconciled to the corrected 97) —
migration `20260722170000_refresh_erp_vendor_mirror_to_corrected_vendors.sql`.

---

## 1. Why this exists (for a developer with zero context)

`core.factory` is the shared **canonical "Vendor" (factory) hub** that PopCRM, PopDAM, PopPIM and the
DB Data Admin app all read. It is fed from Coldlion ERP's `/vendors` endpoint. Coldlion owns the
*vocabulary* (which vendor codes exist); the humans at POP own the *curation* (which are genuinely
merchandise factories, which are active/inactive, which duplicates were merged).

Two curation passes happened as **one-off manual runs**: the 2026-07-15 initial load, and the
2026-07-20/22 dedup + status-seed + reconcile to Coldlion's corrected 97-record feed
(`fix_vendor_reconcile.md`, migration `20260722140000`). **There is currently NO scheduled vendor
sync.** If someone later wires a naive recurring pull, it will silently undo that curation — reactivate
records humans marked inactive, re-add records humans purged, re-split merged duplicates, and inject
nameless placeholder rows. This document specifies a recurring sync that **cannot** do any of those.

### Current live state (measured 2026-07-22)
- `core.factory`: **93 rows** (91 active / 2 inactive). Factories only.
- `plm.erp_vendor` (silver mirror): **97 rows** after OPEN #1 (was 539).
- Corrected Coldlion `/vendors`: **97 records, all `active='Y'`**. Verified live 2026-07-22.
- The 97 codes collapse to fewer `core.factory` rows because `core.merge_factory` merged exact-name
  duplicates; a survivor carries **multiple** codes as `core.factory_source_ref` rows.

---

## 2. The two MANDATORY guards (Albert, 2026-07-22 — non-negotiable)

### Guard 1 — Reject blank / nameless records (quarantine loudly, never insert)
A vendor whose `vendorDesc` is empty/whitespace (today: **`CNWAH`**, live-confirmed blank on
2026-07-22) must **never** be inserted into `core.factory`. It must not be silently dropped either —
it is **quarantined loudly**: written to a quarantine table and counted in the run's `rows_failed`, so
a human can see it was skipped and why. The bronze `ingest.raw_record` landing still keeps the raw
payload (nothing is lost).

### Guard 2 — Persist "not a factory" exclusions (status is app-owned, set on INSERT only)
Human decisions that a Coldlion record is **not a merchandise factory** must be stored durably in a
table the importer consults on **every** run, so a re-pull can **never** reactivate or re-add them.

- **Status is app-owned.** The importer may set `status` only when it **INSERTs a brand-new**
  `core.factory` row. On a **match/update** it must **never overwrite** the curated `status`.
  > ⚠️ The existing `plm.import_coldlion_vendors(jsonb)` (migration `20260715234500`) **violates this**:
  > on a matched vendor it runs `update core.factory set status='active' …`. That is exactly the
  > curation-clobbering behavior this plan forbids. The new importer must NOT carry it forward, and the
  > old function should be dropped or superseded so no one calls it by mistake.
- **Seed exclusions** (from `fix_vendor_reconcile.md` §3):
  - `ANT001` ANTHONY'S WAREHOUSE & DISTRIBUTION — **excluded / inactive** (Albert's ruling: warehouse,
    not a manufacturer). Already present in `core.factory` as `status='inactive'`.
  - **Re-review before first recurring run** (decide factory vs not-a-factory, record the ruling):
    Buildasign LLC, May Group USA Deco Sign, Floor Gardens (`FLGDS`), TUFKO INTERNATIONAL (`INTUF`),
    Royal Packers, Royal Union. Until ruled, an importer that only *updates* curated status (never
    overwrites) is already safe; the exclusion table makes the ruling explicit and re-pull-proof.

---

## 3. Anti-regression rules (fold in — also non-negotiable)

1. **Upsert by `(source_system, source_table, source_id)`.** Resolve every incoming code through
   `core.factory_source_ref` first. Because a merged survivor holds BOTH codes as source-refs (e.g.
   Sunway survivor holds `CNDWG` + `CNHUS`), keying on source id maps both codes to the **one**
   survivor — so the sync **cannot re-split** an already-merged duplicate.
2. **Never re-create purged rows.** A code that resolves to no `core.factory` row AND is on the
   exclusion list (Guard 2) is skipped — not re-inserted.
3. **Only create for genuinely-new, non-excluded, named codes.** A brand-new factory code (not in
   `factory_source_ref`, not excluded, has a non-blank name) is the only case that INSERTs a new
   `core.factory` row (status defaulted on insert, e.g. `active`).
4. **Silver mirror is a faithful replica.** `plm.erp_vendor` mirrors every pulled row (including
   blank/excluded ones) and `factory_id` is set only when a canonical link exists. Refreshing the
   mirror must never promote a curated-inactive/excluded row.

---

## 4. Proposed schema (additive — one migration, preview-first)

Two small tables + one new guarded importer function. All additive; nothing existing is dropped except
(recommended) the curation-clobbering `plm.import_coldlion_vendors` once its replacement lands.

```sql
-- 4a. Durable "not a factory" exclusions (Guard 2). One row per excluded Coldlion code.
create table plm.vendor_exclusion (
  source_system text not null default 'coldlion',
  source_table  text not null default 'vendors',
  source_id     text not null,               -- Coldlion vendorCode, e.g. 'ANT001'
  reason        text not null,               -- human ruling, e.g. 'warehouse/distributor, not a manufacturer'
  excluded_by   text not null default 'curation',
  created_at    timestamptz not null default now(),
  primary key (source_system, source_table, source_id)
);

-- 4b. Loud quarantine for rejected records (Guard 1). Blank-name / unusable rows land here.
create table plm.vendor_quarantine (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid references ingest.sync_run(id) on delete set null,
  source_id     text,                        -- vendorCode if present
  reason        text not null,               -- e.g. 'blank vendorDesc'
  payload       jsonb not null,
  created_at    timestamptz not null default now()
);
```

The new importer `plm.sync_coldlion_vendors(vendors_payload jsonb)` does, per row, in order:
1. `v_code := nullif(vendorCode,'')`; if null → quarantine ('missing vendorCode'), `rows_failed++`,
   continue. Always write bronze `ingest.raw_record` first (nothing is lost).
2. **Guard 1:** `v_name := nullif(vendorDesc,'')`; if null → quarantine ('blank vendorDesc'),
   `rows_failed++`, still upsert the **silver** `plm.erp_vendor` mirror row, but **do not** touch
   `core.factory`. Continue.
3. **Guard 2:** if `(source_system, source_table, v_code)` is in `plm.vendor_exclusion` → skip
   `core.factory` entirely (mirror only). Continue.
4. Resolve canonical: (a) by `core.factory_source_ref (source_system,source_table,source_id=v_code)`;
   else (b) by normalized name. If found → **update non-status fields only** (country, address,
   metadata); **leave `status` untouched** (app-owned). Upsert the `factory_source_ref` row.
5. If not found AND not excluded AND named → **INSERT** a new `core.factory` (status defaulted on
   insert only) + its `factory_source_ref`.
6. Always upsert the silver `plm.erp_vendor` mirror (faithful replica; `factory_id` = resolved id or
   null). Never delete a mirror row mid-loop; after the loop, delete mirror rows whose code was not in
   this payload (guarded: refuse if payload is empty — see §5).
7. `ingest.sync_run` accounting: `rows_seen`, `rows_inserted` (new factories), `rows_updated`
   (matched), `rows_failed` (quarantined), plus a metadata breakdown.

Grants/RLS: mirror the existing `plm.erp_*` pattern (admin-read, `service_role` write; `execute` on
the function to `service_role` only, revoke from `public`). `plm` is **not** PostgREST-exposed, so the
Edge Function (§6) calls it over a direct service-role DB connection, not a PostgREST RPC (see AGENTS §9).

---

## 5. Durable-failure recording (the PR #107 pattern — mandatory)

A `raise` inside the importer aborts its transaction, rolling back the `status='running'` sync_run row
— so a failure would leave **no trace**, violating the house "no silent failures" rule. Therefore the
**caller** (the Edge Function, §6) — not the DB function — records failures. This is the PR #107
pattern (`tools/sync-plm-master-data.mjs` / `buildFailedSyncRunSql`), relocated from the old host
wrapper into the Edge Function:

- The function pulls `/vendors`, then calls `plm.sync_coldlion_vendors(payload)` over a service-role
  **direct DB connection** (`plm` is not PostgREST-exposed, so this cannot be a PostgREST RPC).
- On ANY error (fetch error, HTTP non-200, DB error), it opens a **separate** connection/transaction
  and INSERTs a committed `ingest.sync_run` with `status='failed'`, `error=<message>`, and metadata
  `{recorded_by:'coldlion-vendor-sync edge fn', stage:'fetch'|'apply'}`. This survives the aborted
  import transaction, and the function returns non-2xx so the invocation itself is marked failed.
- **Empty-payload guard:** if the pull returns 0 rows (or fewer than a sane floor, e.g. `< 50` when we
  expect ~97), treat it as a **failure** and do NOT call the importer — a zero/short pull must never be
  interpreted as "delete everything from the mirror".

---

## 6. Cadence & wiring — Supabase Edge Function + `pg_cron` (the standard Coldlion mechanism)

**Decision:** run this as a standalone **Supabase Edge Function** in the shared project, scheduled by
**`pg_cron`**, with the Coldlion `X-API-Key` in **Supabase Vault** — the *same* mechanism the item sync
already committed to (`docs/coldlion-direct-sync-and-taxonomy-plan.md`, Option B, 2026-07-15). This is
what Edge Functions are designed for: a scheduled outbound API pull that writes to the DB, serverless,
with the secret in Vault and scheduling inside the database. Do **not** put this on the hetz host/systemd
path — it would add load and a single point of failure to the very box whose PLM sync is currently
broken and undeployed (HANDOFF OPEN #4), and would diverge from the item-sync architecture.

- **Function:** `supabase/functions/coldlion-vendor-sync/` — reads the key from Vault, pulls `/vendors`,
  runs the §5 empty-pull guard, opens a service-role DB connection, calls
  `plm.sync_coldlion_vendors(payload)`, and records a committed failed `ingest.sync_run` on error.
- **Schedule:** a `pg_cron` job (this project already runs ~9 nightly jobs) invoking the function via
  `net.http_post` (pg_net) — **weekly** is enough (vendors change rarely; the importer is idempotent so
  daily is safe too). e.g. `cron.schedule('coldlion-vendor-sync-weekly','0 9 * * 0', $$ select
  net.http_post(<fn-url>, headers, body) $$)`. Function URL + invoke secret come from Vault, never git.
- **Secret:** Coldlion `X-API-Key` in Supabase **Vault**, read at runtime. Never hard-coded, never in
  git. Reuse/agree the Vault secret name with the item-sync function.
- **Alerting (replaces `systemd OnFailure=`):** serverless has no `OnFailure` hook, so alerting is its
  own **scheduled check**, not an afterthought — a small `pg_cron` job (or a second tiny Edge Function)
  that fires a loud signal when the latest `coldlion_vendors_api` run is `status='failed'` **or older
  than the expected cadence**. A stale/missing run matters as much as a failed one — that overdue-run
  blind spot is exactly what hid the 2026-07-08 PLM outage for 11 days. Channel (webhook / email / an
  alerts-table row an ops view surfaces) to be agreed with Albert; the non-negotiable is that a failed
  **or** overdue run cannot pass silently.

> **Local/dev testing:** `supabase functions serve` against the live feed; on Windows read the Coldlion
> key with `op run` (PowerShell/cmd, **never** bare bash — it is WSL and drops the injected env).
> Unit-test the pure helpers (guards, payload shaping, failed-run SQL) per house rule 13.

---

## 7. Verification gate (dry-run must prove the guards hold)

Before enabling the `pg_cron` schedule, run the Edge Function in a **dry-run** mode against the
**live 97** and confirm:
1. **0 new `core.factory` rows** (`rows_inserted = 0`) — every code resolves to an existing survivor.
2. **0 status flips** — snapshot `core.factory (id,status)` before/after; must be identical
   (ANT001 stays `inactive`; the 91 active stay active).
3. **0 blank inserts** — `CNWAH` lands in `plm.vendor_quarantine`, not `core.factory`; `rows_failed ≥ 1`.
4. **0 re-splits** — merged survivors still carry both codes; `core.factory` row count unchanged (93).
5. **No re-add of purged rows** — nothing in the old 442 service-provider set reappears.
6. A **forced failure** (bad key / unreachable DB) writes a committed `status='failed'` `sync_run` row
   and fires the alert.

---

## 8. Ordered build steps (for the implementing session)

1. Get Albert's ruling on the 6 re-review borderline vendors (§2). Seed `plm.vendor_exclusion`
   accordingly (ANT001 + any ruled not-a-factory).
2. Author ONE additive migration: `plm.vendor_exclusion`, `plm.vendor_quarantine`,
   `plm.sync_coldlion_vendors(jsonb)`, grants/RLS; and drop/deprecate `plm.import_coldlion_vendors`.
   `check-sql.sh` clean; PR to `main`; apply to **preview**; prove it there.
3. Build the Edge Function `supabase/functions/coldlion-vendor-sync/` (pull + guards + call importer +
   PR #107 failed-run record) + unit tests for its pure helpers. Store the Coldlion key in Vault.
4. Run the §7 dry-run gate against production data (read-only pull; apply only after Albert approves
   the first real run, since it can write `core.factory`).
5. Merge; apply migration to prod; deploy the Edge Function; create the `pg_cron` schedule + the
   overdue/failed-run alert check; force a failure to confirm alerting fires; then enable the schedule.
6. Update `docs/app-migration-notes/coldlion-customers-vendors-20260715.md` and the HANDOFF; retire
   `fix_vendor_reconcile.md` / `fix_vendor_review.md` once fully done.

---

## 9. What must NOT happen (the failure modes this plan prevents)
- A re-pull flipping ANT001 (or any curated-inactive/excluded record) back to active. ❌
- A nameless placeholder (`CNWAH`) silently entering `core.factory`. ❌
- A re-pull re-splitting a merged duplicate or re-adding a purged service-provider. ❌
- A failed/empty pull deleting the mirror or silently recording success. ❌
- Anyone calling the old `plm.import_coldlion_vendors`, which overwrites curated status. ❌
