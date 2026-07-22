# fix_vendor_sync.md — Plan for a RECURRING Coldlion vendor → `core.factory` sync

**Written:** 2026-07-22 · **Repo:** `u2giants/shared-db` · **DB:** shared Supabase `qsllyeztdwjgirsysgai`
**Status:** ✅ **Phase A DONE + prod-verified 2026-07-22** (migration `20260722213000`, PR #160) —
guarded importer + tables + wrappers live; first real sync run executed. 📋 **Phase B (scheduled Edge
Function + alerting) not built** — see §6/§8. Read top to bottom before writing any Phase B code.
**Prereq done:** OPEN #1 (mirror `plm.erp_vendor` reconciled to the corrected 97, applied to prod) —
migration `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql`.
**Independently reviewed** by GLM (glm-5.2) 2026-07-22; findings incorporated below. Full review:
`.ai/reviews/vendor-sync-plan-glm-2026-07-22.md`.

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

### The end goal (why any of this matters)
`core.factory` is the **single curated vendor/factory hub** every POP app shares. The end state this
sync serves:
- **One clean, deduped, human-curated factory list** that the **DB Data Admin** app
  (`https://data.designflow.app`, code in `apps/db-data-admin/`) manages and that PopCRM/PopDAM/PopPIM
  read for vendor pickers — never showing service-providers, dead vendors, or duplicate rows.
- **Curation that survives forever.** Human decisions (status, merges, exclusions, `display_name`,
  aliases) are **app-owned** and must outlive every future ERP re-pull. Coldlion is upstream of the
  *vocabulary*, never of the *curation*.
- **App-specific vendor attributes live in per-app extension tables**, not on `core.factory`
  (AGENTS §4.1 / `docs/per-app-extension-tables-plan.md`: `crm/pim/dam.factory_ext`). This sync only
  ever touches the shared canonical hub + its provenance; it must not learn about per-app fields.
- **A recurring sync so the hub stays fresh without a human in the loop** — picking up genuinely new
  factories and refreshed contact/address data automatically, while the guards below make it impossible
  for that automation to erode curation.

### The layered data model this sync moves data through
This follows the same bronze→silver→gold→serving pattern as the customer and item pipelines
(`docs/unified-supabase-schema-map.md`, `fix_schema_for_api.md`):
- **Bronze** `ingest.raw_record` — every pulled row, exact payload, keyed
  `(source_system, source_table, source_id)`. Immutable landing; nothing is ever lost here.
- **Silver** `plm.erp_vendor` — typed faithful mirror of the Coldlion `/vendors` snapshot.
- **Gold** `core.factory` (+ `core.factory_source_ref`, `core.factory_alias`) — the curated canonical
  hub. **Curation lives only here and is app-owned.**
- **Serving** the DB Data Admin app + each app's picker read `core.factory` (and their own
  `*.factory_ext`). This sync writes bronze/silver freely and gold **only through the guards**.

### `core.factory` shape (verified 2026-07-22 — do not assume other columns)
`id, name, code, company_id, status, vendor_group, country, metadata, created_at, updated_at,
display_name`. **There is no `address` column.** `status` is enum `app.entity_status`
(`active | inactive | archived | deleted`). `code` has **`unique nulls not distinct`** — at most one row
may have a NULL `code`, so the importer MUST set `code` on every INSERT (see §4 M-notes).
`core.factory_source_ref` carries `unique (source_system, source_table, source_id)`, `factory_id` is
NOT NULL with `on delete cascade`. Coldlion payload field names are in
`docs/coldlion-erp-api-reference.md`; the exact extraction (vendorCode/vendorDesc/active/countryCode/
address*/phoneNo/…) is already implemented in `20260715234500_erp_coldlion_customer_vendor_import.sql`.

### Current live state (measured 2026-07-22)
- `core.factory`: **93 rows** (91 active / 2 inactive). Factories only.
- `plm.erp_vendor` (silver mirror): **97 rows** after OPEN #1 (was 539).
- Corrected Coldlion `/vendors`: **97 records, all `active='Y'`**. Verified live 2026-07-22.
- The 97 codes collapse to fewer `core.factory` rows because `core.merge_factory` merged exact-name
  duplicates; a survivor carries **multiple** codes as `core.factory_source_ref` rows.
- **8 pre-existing mislabeled provenance rows** exist: `core.factory_source_ref` rows tagged
  `source_system='coldlion'` but holding **numeric legacy IDs** (415, 99, 147, 403, 244, 457, 476, 472)
  that were never real Coldlion vendorCodes. They are harmless duplicates on factories that also carry
  their real alphanumeric code, and they will never match an incoming Coldlion payload. Cleanup is
  HANDOFF OPEN #5; the importer must not be confused by them (it keys on the real `source_id`).

---

## 2. The two MANDATORY guards (Albert, 2026-07-22 — non-negotiable)

### Guard 1 — Reject blank / nameless records (quarantine loudly, never insert)
A vendor whose `vendorDesc` is empty/whitespace (today: **`CNWAH`**, live-confirmed blank on
2026-07-22) must **never** be inserted into `core.factory`. It must not be silently dropped either —
it is **quarantined loudly**: written to `plm.vendor_quarantine` and counted in the run's `rows_failed`,
so a human can see it was skipped and why. The bronze `ingest.raw_record` landing still keeps the raw
payload (nothing is lost). **Observability caveat (S6):** `plm`/`ingest` are not PostgREST-exposed, so
"a human can see it" requires surfacing quarantine + recent runs through an `api.*` view or a `public`
SECURITY DEFINER RPC (see §4) — otherwise "loud" is SQL-only and invisible to the admin app.

### Guard 2 — Persist "not a factory" exclusions (status is app-owned, set on INSERT only)
Human decisions that a Coldlion record is **not a merchandise factory** must be stored durably in a
table the importer consults on **every** run, so a re-pull can **never** reactivate or re-add them.

- **"Excluded" means "the sync's gold-touching logic skips this code"** — it does NOT mean "delete from
  gold." ANT001 is deliberately *both* in `plm.vendor_exclusion` *and* present in `core.factory` as
  `status='inactive'`; that is consistent, not contradictory. Exclusion just guarantees the sync never
  re-activates or re-creates it.
- **Status is app-owned.** The importer may set `status` only when it **INSERTs a brand-new**
  `core.factory` row. On a **match/update** it must **never overwrite** the curated `status`.
  > ⚠️ The existing `plm.import_coldlion_vendors(jsonb)` (migration `20260715234500`) **violates this**:
  > on a matched vendor it runs `update core.factory set status='active' …`. That is exactly the
  > curation-clobbering behavior this plan forbids. The new importer must NOT carry it forward, and the
  > old function should be dropped or superseded so no one calls it by mistake.
- **Seed exclusions — TWO groups, both required:**
  1. **The 418 purged old-feed service-providers (REQUIRED — makes §9 durable).** The reconcile deleted
     418 non-factory rows from `core.factory` (their `factory_source_ref` cascade-deleted). Their
     Coldlion vendorCodes are **not** currently excluded, so §9's "no re-add of a purged service-
     provider" is only true *because today's 97-row feed omits them*. If Coldlion ever re-serves one it
     would be re-added. **Seed all 418 purged codes into `plm.vendor_exclusion`** (reason e.g.
     `'purged 2026-07-22: service-provider, not a factory'`) in the same migration. The exact 418 codes
     are recoverable from `ingest.raw_record` (coldlion/vendors source_ids) minus the corrected 97.
  2. **The curated not-a-factory rulings.** `ANT001` ANTHONY'S WAREHOUSE & DISTRIBUTION — excluded /
     inactive (warehouse, not a manufacturer). The six borderline vendors (Buildasign LLC, May Group
     USA Deco Sign, Floor Gardens `FLGDS`, TUFKO INTERNATIONAL `INTUF`, Royal Packers, Royal Union) were
     **ruled VALID FACTORIES by Albert 2026-07-22 — NOT excluded.**

---

## 3. Anti-regression rules (fold in — also non-negotiable)

1. **Upsert by `(source_system, source_table, source_id)`.** Resolve every incoming code through
   `core.factory_source_ref` first. Because a merged survivor holds BOTH codes as source-refs (e.g.
   Sunway survivor holds `CNDWG` + `CNHUS`), keying on source id maps both codes to the **one**
   survivor — so the sync **cannot re-split** an already-merged duplicate.
2. **Never re-create purged rows.** A code that resolves to no `core.factory` row AND is on the
   exclusion list (Guard 2) is skipped — not re-inserted. (This is why §2's 418-code seed matters.)
3. **Only create for genuinely-new, non-excluded, named codes.** A brand-new factory code (not in
   `factory_source_ref`, not excluded, has a non-blank name) is the only case that INSERTs a new
   `core.factory` row (status defaulted to `active` on insert only, `code := v_code`).
4. **Silver mirror is a faithful replica.** `plm.erp_vendor` mirrors every pulled row (including
   blank/excluded ones) and `factory_id` is set only when a canonical link exists. Refreshing the
   mirror must never promote a curated-inactive/excluded row.

### 3a. Snapshot semantics — upstream removal & deactivation must NOT erode gold
`/vendors` is a **full snapshot** (~97 rows, no `modifiedFrom` incremental), so each run must reconcile
the snapshot against the mirror, but the effect on **curation** is strictly bounded:

- **A code that DISAPPEARS from Coldlion** (dropped upstream, as the 442 service-providers were):
  - Silver: its `plm.erp_vendor` row is removed so the mirror stays a faithful snapshot.
  - Gold: **`core.factory` is NOT deleted or inactivated.** Status is app-owned; upstream disappearance
    is not a human de-curation decision. Its `core.factory_source_ref` row still points at a valid
    factory (the FK is NOT NULL + cascade, so it cannot dangle at the FK level) — it just becomes
    **orphaned relative to the live feed**. That is the benign state OPEN #1 produced; a human cleans it
    (OPEN #5), never the sync.
- **A code that returns as `active='N'`** (Coldlion deactivates it): the importer **must not** flip a
  curated `core.factory.status`. The upstream active flag drives the canonical status **only on the
  initial INSERT of a brand-new factory**; after that, status is app-owned (Guard 2). Record the
  upstream flag in silver/metadata for visibility, but never let it overwrite gold.
- **Net rule:** the sync may freely ADD new factories and REFRESH non-status fields, but it can only
  ever *propose* removals/deactivations to a human — it never enacts them on gold. This is the single
  most important safety property: an upstream data change can never silently shrink or deactivate the
  curated hub.

> **Same flaw exists on the customer side.** `plm.import_coldlion_customers` (migration `20260715234500`)
> also force-sets `status='active'` and `is_potential=false` on matched rows — the identical
> curation-clobbering pattern. Customers are marked "done" in the handoff but run on this flawed
> importer. When the guarded vendor importer lands, open a **twin fix for customers** (out of scope
> here). HANDOFF now carries a "customer sync has the same status-clobbering bug" note so it is not lost.

---

## 4. Proposed schema (additive — Phase A migration, preview-first)

Two small tables + one guarded importer + thin `public` wrappers so the whole thing is reachable
without a raw production DB password. All additive; nothing existing is dropped except (recommended)
the curation-clobbering `plm.import_coldlion_vendors` once its replacement lands.

```sql
-- 4a. Durable "not a factory" exclusions (Guard 2). One row per excluded Coldlion code.
create table plm.vendor_exclusion (
  source_system text not null default 'coldlion',
  source_table  text not null default 'vendors',
  source_id     text not null,               -- Coldlion vendorCode, e.g. 'ANT001'
  reason        text not null,               -- human ruling / 'purged 2026-07-22: service-provider'
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

**Importer `plm.sync_coldlion_vendors(vendors_payload jsonb)` (SECURITY DEFINER), per row, in order:**

0. **Concurrency + empty guards at entry (S7/S8):**
   - `perform pg_advisory_xact_lock(hashtext('plm.sync_coldlion_vendors'))` so overlapping runs
     serialize instead of racing the post-loop mirror delete / new-factory INSERT.
   - If `jsonb_array_length(payload) = 0` → **raise** (never proceed). The empty guard lives **inside**
     the function, not only in the caller — a direct `select plm.sync_coldlion_vendors('[]')` must not be
     able to wipe the mirror.
1. `v_code := nullif(vendorCode,'')`; if null → quarantine ('missing vendorCode'), `rows_failed++`,
   continue. Always write bronze `ingest.raw_record` first (nothing is lost).
2. **Guard 1:** `v_name := nullif(vendorDesc,'')`; if null → quarantine ('blank vendorDesc'),
   `rows_failed++`, still upsert the **silver** `plm.erp_vendor` mirror row, but **do not** touch
   `core.factory`. Continue.
3. **Guard 2:** if `(source_system, source_table, v_code)` is in `plm.vendor_exclusion` → skip
   `core.factory` entirely (mirror only). Continue.
4. Resolve canonical: (a) by `core.factory_source_ref (source_system,source_table,source_id=v_code)`;
   else (b) by normalized name. If found → **update `country` and `metadata` ONLY** (M1: there is no
   `address` column; and never `status`/`name`/`display_name` — those are app-owned). Upsert the
   `factory_source_ref` row.
5. If not found AND not excluded AND named → **INSERT** a new `core.factory` with **`code := v_code`**
   and `status := 'active'` (M2: `code` must be set or the 2nd NULL-code insert in a run violates
   `unique nulls not distinct`). Wrap in `exception when unique_violation → match existing by code`
   (same fallback the old importer used). Insert the `factory_source_ref` row **after** obtaining the
   new `factory_id` (`factory_id` is NOT NULL). *(N3 consideration:* a name-match-only hit with **no**
   prior source_ref is an automatic soft-merge of a new code onto a same-named factory without human
   review — consider quarantining those for review instead of auto-merging.)
6. Always upsert the silver `plm.erp_vendor` mirror (faithful replica; `factory_id` = resolved id or
   null). Never delete a mirror row mid-loop; after the loop, delete mirror rows whose code was not in
   this payload. (The step-0 empty guard already makes the "wipe on empty payload" case impossible.)
7. `ingest.sync_run` accounting on success: `rows_seen`, `rows_inserted` (new factories), `rows_updated`
   (matched), `rows_failed` (quarantined), plus a metadata breakdown. **The function owns the SUCCESS
   record**; the caller inserts nothing on success (N6) — the caller only writes the separate committed
   `failed` row on error (§5).

**Reaching non-exposed schemas without a prod DB password (S5/S6 — use the §8.1 wrapper pattern):**
`plm` **and** `ingest` are not in `pgrst.db_schemas` (AGENTS **§8.1**, not §9), so neither the importer
nor the failed-run insert is reachable through PostgREST directly, and a raw service-role DB connection
would force the **production DB password** into the Edge Function (avoid — AGENTS §0.1 treats prod DB
secrets as high-sensitivity). Instead follow the established pattern already used for `plm.*`/`dam.*`
(`public.refresh_style_tracker_item_bridge`, `public.upsert_pdf_rich_extraction`, …):
- `public.sync_coldlion_vendors(jsonb)` — SECURITY DEFINER wrapper calling `plm.sync_coldlion_vendors`,
  granted `execute` to `service_role`. The Edge Function calls it via supabase-js `rpc()` with its
  service-role key — **no raw DB password**.
- `public.record_failed_sync_run(source_name text, err text, stage text)` — SECURITY DEFINER, inserts
  the committed `failed` `ingest.sync_run` row (the §5 durable-failure path can't use PostgREST on
  `ingest` without this).
- `api.vendor_quarantine_list`, `api.vendor_exclusion_list`, `api.vendor_sync_run_list` (or `public`
  SECURITY DEFINER RPCs) so the DB Data Admin app can actually *see* quarantined rows, exclusions, and
  recent/overdue runs (precedent: `db_data_admin_licensor_property_tree` surfaces `feeder_days_stale`).
- RLS/grants: importer + wrappers `execute` to `service_role` only (revoke from `public`); read views
  admin-scoped, matching the existing `plm.erp_*` / DB Data Admin grant pattern.

---

## 5. Durable-failure recording (the PR #107 pattern — mandatory)

A `raise` inside the importer aborts its transaction, rolling back the `status='running'` sync_run row
— so a failure would leave **no trace**, violating the house "no silent failures" rule. Therefore the
**caller** (the Edge Function, §6) — not the DB function — records failures. This is the PR #107
pattern; the closest in-repo analog is `tools/coldlion-sync-common.mjs` (Coldlion-specific, already has
a `pg_notify('coldlion_sync_alert')` channel), **not** `tools/sync-plm-master-data.mjs` (whose
`buildFailedSyncRunSql` shells to `psql`/`supabase db query` and cannot be copy-pasted into a Deno Edge
Function — only the *pattern* transfers). Concretely:

- **Success:** the Edge Function calls `public.sync_coldlion_vendors(payload)`; that function inserts its
  own `status='succeeded'` `sync_run` row. The caller writes nothing on success (N6 — avoids a double
  success row).
- **Failure (any stage — fetch, HTTP non-200, RPC error):** the caller calls
  `public.record_failed_sync_run('coldlion_vendors_api', <message>, <stage>)`, which INSERTs a
  **committed** `status='failed'` row in its own transaction (survives the aborted import), and returns
  non-2xx so the invocation itself is marked failed. A crash/timeout that kills the function mid-import
  leaves **no** DB row (the import transaction rolls back) — which is exactly why the overdue-run alert
  (§6) is mandatory, not optional.
- **Empty / short-pull guard (two layers):** the caller refuses to invoke the importer on a **0-row**
  pull (records a failed run instead); the importer *also* raises on empty payload (§4 step 0). A
  **short** pull (e.g. `< 50` when we expect ~97) is a logged **warning**, not a hard abort — a hard
  floor would make the sync refuse forever if Coldlion legitimately shrinks. Make the floor configurable.

---

## 6. Cadence & wiring — Supabase Edge Function + scheduled invocation (Phase B)

**Decision:** run this as a standalone **Supabase Edge Function** in the shared project, invoked on a
schedule, aligning with the item sync's direction (`docs/coldlion-direct-sync-and-taxonomy-plan.md`,
Option B). This is what Edge Functions are for: a scheduled outbound API pull that writes to the DB,
serverless, secret out of git. Do **not** put this on the hetz host/systemd path — it would add load and
a single point of failure to the very box whose PLM sync is currently broken and undeployed
(HANDOFF OPEN #4).

**⚠️ Honest state of the mechanism (do not treat as an established house pattern — S2/S3/S4):**
- **pg_cron** is installed/proven but the project runs **exactly one** pg_cron job today
  (`refresh-sku-human-description`, and it calls a SQL function directly). The "already runs ~9 nightly
  jobs" claim (copied from the item plan) is **false** — correct it there too.
- **pg_net (`net.http_post`) has zero usage** in this repo and may not be enabled. Enabling it is a
  dashboard/config step, **not** a SQL migration — so a migration cannot deliver the schedule that
  depends on it. **Before** choosing `pg_cron → net.http_post → function`, verify pg_net is enabled;
  otherwise use **Supabase's native scheduled Edge Functions** (cron built into the function config), no
  pg_net required. Pick one and prove it in a spike before relying on it.
- **Supabase Vault has zero usage**; the active secret store is **1Password via `op`**
  (`tools/coldlion-sync-common.mjs`). A Deno Edge Function **cannot** read 1Password the way the hetz
  Node wrapper does. Provisioning the Coldlion `X-API-Key` for the function is a **new operational step**
  — decide: Supabase **function secret/env** (populated at deploy) or **Vault** (read at runtime) — and
  record who provisions it, in which project/branch. Never in git.

- **Function:** `supabase/functions/coldlion-vendor-sync/` — reads the key (function secret/Vault), pulls
  `/vendors`, runs the §5 empty/short guards, calls `public.sync_coldlion_vendors(payload)` via
  service-role `rpc()`, and calls `public.record_failed_sync_run(...)` on error.
- **Schedule:** **weekly** is enough (vendors change rarely; the importer is idempotent so daily is safe
  too) — via native scheduled functions, or a `pg_cron` job *if* pg_net is confirmed enabled.
- **Alerting (replaces `systemd OnFailure=`; the ONLY net for a serverless crash — S9):** a scheduled
  check (small `pg_cron` job or second tiny function) that fires a loud signal when the latest
  `coldlion_vendors_api` run is `status='failed'` **or** older than the cadence window. A stale/missing
  run matters as much as a failed one — that overdue blind spot is exactly what hid the 2026-07-08 PLM
  outage for 11 days. **Resolve the channel and build this checker BEFORE enabling the schedule.**
  Consider extending the existing `coldlion_sync_alert` NOTIFY channel. Channel (webhook / email /
  alerts-table row an ops view surfaces) to be agreed with Albert.

> **Local/dev testing:** `supabase functions serve` against the live feed; on Windows read the Coldlion
> key with `op run` (PowerShell/cmd, **never** bare bash — it is WSL and drops the injected env).
> Unit-test the pure helpers (guards, payload shaping, failed-run call) per house rule 13.

---

## 7. Verification gate (dry-run must prove the guards hold)

Before enabling the schedule, run the importer/function in a **dry-run** mode against the **live 97**
and confirm:
1. **0 new `core.factory` rows** (`rows_inserted = 0`) — every code resolves to an existing survivor.
2. **0 status flips** — snapshot `core.factory (id,status)` before/after; must be identical
   (ANT001 stays `inactive`; the 91 active stay active).
3. **0 blank inserts** — `CNWAH` lands in `plm.vendor_quarantine`, not `core.factory`; `rows_failed ≥ 1`.
4. **0 re-splits** — merged survivors still carry both codes; `core.factory` row count unchanged (93).
5. **No re-add of purged rows** — inject one of the 418 purged codes into a test payload; confirm it is
   skipped via `plm.vendor_exclusion` (not re-inserted).
6. **Upstream-removal safety** — feed a payload with one existing code *removed* and one flipped to
   `active='N'`; confirm the matching `core.factory` rows are **unchanged** (not deleted, not
   inactivated) while the silver mirror reflects the change.
7. **Empty-payload cannot wipe** — `select public.sync_coldlion_vendors('[]'::jsonb)` **raises** and
   deletes nothing.
8. A **forced failure** (bad key / unreachable DB) writes a committed `status='failed'` `sync_run` row,
   and an **overdue run** (no successful run within the cadence window) also fires the alert.

---

## 8. Ordered build steps — split into two shippable phases (GLM verdict)

**Phase A — the guarded importer + tables. ✅ DONE + PROD-VERIFIED 2026-07-22.**
Migration `20260722213000_vendor_sync_guarded_importer.sql` (PR #160, merged) +
`tools/sync-coldlion-vendors.mjs` (+ tests). `plm.vendor_exclusion` seeded with **435** codes (434
purged 2026-07-22, computed from `raw_record`; + ANT001), `plm.vendor_quarantine`,
`plm.sync_coldlion_vendors(jsonb)` (M1/M2/S7/S8 fixes), `public.sync_coldlion_vendors` +
`public.record_failed_sync_run` + `api.vendor_{quarantine,exclusion,sync_run}_list`, grants; old
`plm.import_coldlion_vendors` dropped. Validated on preview inside a rolled-back transaction (full §7
gate + upstream-removal safety, all pass). Applied to prod (bounded, only this migration) and a first
real sync run executed: `seen=97, inserted=0, updated=95, failed=1 (CNWAH quarantined), skipped=1
(ANT001), deleted=0`; `core.factory` unchanged at 93 (91/2). Evidence: PR #160 comment.

**Phase B — scheduled serverless execution + alerting (separate, after Phase A is proven):**
4. Spike-verify the mechanism: is **pg_net** enabled? If not, use native scheduled Edge Functions.
   Decide + provision the Coldlion key (function secret vs Vault). Correct the false "9 nightly jobs"
   claim here and in the item plan.
5. Build the Edge Function + unit tests; build the **overdue/failed-run alert checker and resolve its
   channel FIRST**; force a failure to confirm alerting fires; **then** enable the schedule.
6. Update `docs/app-migration-notes/coldlion-customers-vendors-20260715.md`, HANDOFF, and
   `coldlion-direct-sync-and-taxonomy-plan.md` (the "9 jobs" correction); retire `fix_vendor_reconcile.md`
   / `fix_vendor_review.md` once fully done.

**Open question (N5):** does the DB Data Admin app get UI to *manage* exclusions/quarantine (add/remove
an exclusion, resolve a quarantined row), or is that SQL-only in v1? Affects whether the tables also
need write-RPCs, not just read views.

---

## 9. What must NOT happen (the failure modes this plan prevents)
- A re-pull flipping ANT001 (or any curated-inactive/excluded record) back to active. ❌
- A nameless placeholder (`CNWAH`) silently entering `core.factory`. ❌
- A re-pull re-splitting a merged duplicate or re-adding a purged service-provider (durable only once the
  418 codes are seeded — §2). ❌
- A failed/empty pull deleting the mirror or silently recording success (guarded in the function itself,
  not just the caller — §4 step 0). ❌
- An upstream removal/deactivation deleting or inactivating a curated `core.factory` row. ❌
- A serverless crash passing unnoticed because only the overdue-run alert would catch it — so that alert
  must exist before the schedule is enabled. ❌
- Anyone calling the old `plm.import_coldlion_vendors`, which overwrites curated status. ❌
