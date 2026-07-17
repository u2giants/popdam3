# fix_vendor_review — Vendor (core.factory) review, dedup & status curation

**Written:** 2026-07-17 · **Repo:** `u2giants/shared-db` · **DB:** shared Supabase `qsllyeztdwjgirsysgai`
**Scope:** do for **vendors** (`core.factory`) what was just completed for **customers**
(`core.customer`). The customer work is DONE and merged; the vendor work is NOT STARTED. This file
is the complete brief to execute the vendor pass from a cold start.

---

## 1. What this application is

`shared-db` is the single source of truth for the shared **Supabase Postgres** backend
(project ref `qsllyeztdwjgirsysgai`, region us-east-1) used by four POP Creations apps:

| App | Repo | Role |
|---|---|---|
| CRM | `u2giants/popcrm-web` | customer/vendor relationships, opportunities |
| PM / PIM | `u2giants/poppim-web` | product management |
| DAM | `u2giants/popdam3` | digital asset management |
| PLM | DesignFlow (`popcre/*`) | product lifecycle — **runs on its own Cloud SQL DB**, only mirrors some data into this Supabase |

All schema/DDL changes are authored HERE (branch → PR → preview → author-merges), never in the
app repos. Schemas: `core` (shared canonical entities), `crm`/`pim`/`dam`/`plm` (app-owned),
`ingest` (raw imports), `api` (browser-facing views).

**Coldlion ERP** (Edge Home) is the external system of record. Base URL
`http://x5.coldlion.com/EhpApi` (plain HTTP), auth header `X-API-Key`, tenant
`companyCode=EDGEHOME`. Full API map: [`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md).

**Vendors = "Factories".** The canonical hub is `core.factory` (a "factory" is renamed **Vendor**
in the data model). Customers are `core.customer`.

---

## 2. What we set out to do this session, and why

**Business goal:** the ERP has hundreds of customers and vendors; the apps' dropdowns showed all of
them (dormant ERP accounts + duplicates), making them unusable. Clean the shared hubs so apps show
a short, correct, de-duplicated, human-named list.

**This session completed the CUSTOMER half.** The VENDOR half is the remaining objective:
- Re-pull fresh Coldlion vendors, set each `core.factory.status` from Coldlion's (reclassified)
  active flag, then let Albert curate.
- De-duplicate vendors (Coldlion vs. the 6 pre-existing directus factories; Coldlion-vs-Coldlion
  same-name rows).
- Add short **display names** and an **alias** mechanism (neither exists for factories yet).
- Support fast autocomplete pickers (trigram index already added — see §5).

**Trigger:** Albert's directive to pull Coldlion customers + vendors "into the right place" and make
them usable in app dropdowns.

---

## 3. Current state — what is true right now (2026-07-17)

### Customers — DONE (context; do NOT redo)
- 836 Coldlion customers + all pre-existing imported → `core.customer` de-duplicated to **859**
  rows: **140 active / 12 potential / 707 inactive**.
- Shipped & merged (all on `main`, all applied to prod): PRs #83, #84, #85, #86, #88, #91, #94.
- Full ledger of every ruling + final state: [`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md).

### Vendors — NOT STARTED. Exact state:
- `core.factory`: **529 rows, ALL `status='active'`** (status defaulted active at import, never
  curated). Columns: `id, name, code, company_id, status, vendor_group, country, metadata,
  created_at, updated_at`. **No `display_name` column.** `code` is `UNIQUE NULLS NOT DISTINCT`;
  new Coldlion factories use `code = vendorCode`; the 6 pre-existing directus factories use
  `code = 'directus:<uuid>'`. `company_id` → `core.customer(id) ON DELETE SET NULL` (nullable,
  null for vendors).
- `core.factory_source_ref`: **531 `coldlion` rows**. Columns `id, factory_id, source_system,
  source_table, source_id, source_code, confidence, raw, created_at` — **no `source_name` column**
  (unlike `company_source_ref`). Unique on (source_system, source_table, source_id).
- `plm.erp_vendor` (typed Coldlion mirror, admin-RLS): 539 rows. Coldlion's fresh active flag now
  shows **~97 active / 442 inactive** — Coldlion reclassified vendors heavily too, but
  `core.factory.status` does NOT reflect this yet. **First real task: re-pull and seed status.**
- **8 factories carry >1 Coldlion code** (same-name merges the importer already did — verify each
  is truly one vendor, exactly like the customer `GORDON BROTHERS` case).
- **`core.factory_alias` table: does NOT exist. `core.merge_factory()` function: does NOT exist.**
  Both must be built (mirror the customer equivalents).
- Autocomplete: `core_factory_name_trgm_idx` (trigram on `lower(name)`) **already added** this
  session (migration `20260717124807`).

### Uncommitted files in the working tree
- `fix_connection_pool.md` + `HANDOFF.md` — a DIFFERENT active workstream (DesignFlow connection
  pool). **Do NOT touch them.**
- This `fix_vendor_review.md` — commit it.

---

## 4. Everything we tried on the customer pass that did NOT work (same traps apply to vendors)

1. **1Password MCP `op_run` `env` delivered empty vars.** Root cause (memory
   `op-run-mcp-wsl-env-trap.md`): `argv: ["bash", ...]` on Windows routes to **WSL**, which drops
   injected Windows env. **Fix:** real `op` CLI via Bash tool + a real temp env-file:
   `op run --env-file file -- node script.js` (node is native Windows, gets the env). Do NOT use
   bash process substitution `<(...)` with native `op.exe` (fails on `/proc/<pid>/fd`).
2. **`psql` is NOT installed here.** Use **Node + `pg`** (installed in scratchpad) against the
   pooler: host `aws-1-us-east-1.pooler.supabase.com`, port `6543`, user
   `postgres.qsllyeztdwjgirsysgai`, db `postgres`, `ssl:{rejectUnauthorized:false}`. Or the
   **Supabase MCP** (preferred for DDL).
3. **`merge_customer` v1 tripped CRM integrity triggers.** `core.contact_company.crm_department_id`
   and `crm.opportunity.department_id` must always reference a `crm.department` whose `company_id`
   equals the row's `company_id`. **Fix:** resolve the loser's departments onto the survivor FIRST,
   then repoint company_id. See `core.merge_customer` in migration `20260717125626` and copy its
   ordering for `merge_factory` (factories have fewer dependents, but keep the principle).
4. **`ALTER TYPE ... ADD VALUE` cannot be used in the same txn that then uses it** — separate
   migration required (see `20260717122237` for `potential`). Not needed for vendors unless you add
   a new status value.
5. **Generated-column dependency blocked a column drop** on customers (`normalized_name` depended
   on `legal_name`). `core.factory` has no generated column today, but check before dropping.
6. **Coldlion's `active` flag is unreliable / reclassified** (customers went 834→153 active on
   re-pull; vendors similarly). **Always re-pull immediately before curating**; treat
   `core.*.status` as OUR app-owned signal (importers set status on INSERT only, never overwrite on
   re-pull — preserve that).
7. **Name-similarity is unreliable BOTH ways** — false positives (`Michael's`↔`MICHAEL S ROTOLO`)
   and false negatives (`Bed Bath`↔`BED BATH & BEYOND` = 0.62). Report **top-N candidates with
   city/state**, never top-1. Address beats name.
8. **`RESTRICT` foreign keys block deletes.** For vendors, enumerate FKs into `core.factory`
   (query in §6) and clear/repoint any RESTRICT ones before deleting.

---

## 5. Root causes & key findings (reusable machinery)

- **Three-layer vendor pipeline already exists:** `ingest.raw_record`
  (source_system='coldlion', source_table='vendors') → `plm.erp_vendor` → `core.factory` +
  `core.factory_source_ref`. Importer **`plm.import_coldlion_vendors(jsonb)`** is live and
  idempotent (migration `20260715234500`; status made app-owned in `20260716140000`). Promotes only
  `active='Y'` vendors to canonical.
- **Re-pull** (operational, not a migration): page all vendors from
  `GET /vendors?companyCode=EDGEHOME&size=200&page=N`, then
  `select * from plm.import_coldlion_vendors('<json-array>'::jsonb)`. Adapt scratchpad `repull.js`
  (currently customers) to `/vendors`.
- **The customer dedup harness** is scratchpad `dedup.js`: loads a snapshot, resolves each ruling to
  UUIDs (by Coldlion code or name), **rehearses in a rolled-back transaction** (fails on any
  unresolved selector), reports final counts, then applies with `COMMIT=1`. Reuse for vendors.
- **`core.merge_customer(loser, survivor, alias_loser_name)`** exists and repoints all FK tables +
  aliases the loser's name. Build `core.merge_factory` the same way.
- **Serving:** customers got `display_name` + `status` in `api.crm_customer_list` /
  `api.crm_account_list` (migration `20260717125909`). There is **no `api` vendor view** — apps read
  `core.factory` directly (SELECT granted to `authenticated`). Decide: add
  `api.factory_list`/`api.plm_vendor_list` with status+display_name, or keep direct reads.
- **Per-app extension-table rule (2026-07-17, Albert + Kimi K3 concur):** app-specific vendor
  attributes go in per-app extension tables (`crm.factory_ext`, PK=FK to `core.factory`,
  `on delete cascade`, app-schema RLS), NOT columns on shared `core.factory`.

---

## 6. Exact next steps (in order; each has a "done when")

1. **Re-pull fresh Coldlion vendors.** Adapt scratchpad `repull.js` → `/vendors` +
   `plm.import_coldlion_vendors`. Run via `op run --env-file` + node (§8).
   *Done when:* active/inactive counts printed; a `succeeded` `coldlion_vendors_api` row in
   `ingest.sync_run`.
2. **Add the missing schema** (one migration via `mcp__supabase__apply_migration`, then local file
   with recorded timestamp per §7):
   - `core.factory.display_name text` + trigram index on `lower(display_name)`.
   - `core.factory_alias` (mirror `core.customer_alias`: `factory_id` FK cascade, `alias`, generated
     `normalized_alias`, `alias_type` check, `source_system`, trigram index, RLS mirroring
     `core.factory` `admin_write`/`shared_read`).
   - `core.merge_factory(loser, survivor, alias_loser_name boolean)` — model on `core.merge_customer`
     (`20260717125626`), repointing only FKs that reference `core.factory`. Enumerate first:
     ```sql
     select con.conrelid::regclass::text, att.attname, con.confdeltype
     from pg_constraint con join pg_attribute att
       on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
     where con.contype='f' and con.confrelid='core.factory'::regclass order by 1;
     ```
   *Done when:* applied, `list_migrations` shows it, local file committed with identical timestamp,
   CI `validate` green.
3. **Seed `core.factory.status` from the fresh Coldlion active flag** for Coldlion-mapped factories
   (active→active, inactive→inactive); leave the 6 directus factories for Albert.
   *Done when:* `select status, count(*) from core.factory group by 1` shows a realistic active
   count (~97, not 529).
4. **Produce dedup review CSVs for Albert** (as for customers):
   - Sheet A: the 8 multi-code factories — confirm one vendor each.
   - Sheet B: the 6 directus factories + fuzzy top-3 Coldlion candidates (city/state).
   - Sheet C: Coldlion-vs-Coldlion same-name pairs.
   Use `similarity()`; include address; give columns `DECISION_status`
   (active/inactive/potential), `DECISION_merge_into`, `notes`.
   *Done when:* Albert returns rulings.
5. **Apply rulings** via the `dedup.js` harness: encode merges/status/deletes, REHEARSE rolled-back
   (fail on unresolved selectors), show final counts, `COMMIT=1`.
   *Done when:* rehearsal clean, applied, spot-checks pass. Re-verify tricky cases: any multi-code
   splits, and **post-check for duplicate names** the merges may create (the customer pass hit a
   duplicate-"TJX" name collision + a missed Amazon split — watch for vendor analogues).
6. **Serving/exposure decision** (`api` vendor view with status+display_name filter, or documented
   direct reads). Coordinate with the frontend picker work (Kimi is doing customer/vendor pickers).
7. **Document:** update `docs/coldlion-customers-vendors-20260715.md`; add
   `docs/coldlion-vendor-dedupe-review.md` ledger. Delete this file when vendor work is done.

---

## 7. Constraints & gotchas in force

- **shared-db discipline:** DDL via migrations only (branch → PR → preview/rehearse → **author
  merges the PR**; Albert cannot). After `apply_migration`, run `list_migrations`, capture the
  recorded timestamp, create the local `supabase/migrations/<ts>_<name>.sql` with the **identical**
  timestamp. Never edit an applied migration.
- **Rehearse every destructive data op in a rolled-back transaction first** (the `dedup.js` harness
  does this). Merges delete canonical rows referenced by FKs.
- **status is app-owned** — never let a Coldlion re-pull overwrite a curated status.
- **Merges preserve the losing name as an alias** (`factory_alias`) so nothing becomes unsearchable.
- **Git author:** `Albert Hazan <u2giants@users.noreply.github.com>`; end commits with the
  `Co-Authored-By: Claude ...` trailer. Branch naming: `claude/<topic>`.
- **CI:** `.github/workflows/shared-supabase-migrations.yml` runs `scripts/check-sql.sh`; the
  `validate` check must be green before merge.
- **Do NOT touch `HANDOFF.md` / `fix_connection_pool.md`** (separate active workstream).
- **Project refs — never mix:** shared backend `qsllyeztdwjgirsysgai`; shared-db preview branch
  `xjcyeuvzkhtzsheknaiu`; popdam prod `ryltkzzernhwnojzouyb`; oracle `eqccjfbyrywsqkxxpjvg`.

## 8. Access & environment

- **Coldlion API key:** `op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`.
- **Supabase DB password:** `op://vibe_coding/Supabase DB Password - shared POP database/password`.
- **Supabase MCP** (`mcp__supabase__*`) connected + authenticated — preferred for SQL/DDL.
- **`op`, `gh`, `supabase` CLIs** authenticated; `supabase` linked to prod.
- **Node + `pg`** in scratchpad:
  `C:\Users\ahazan2\AppData\Local\Temp\claude\C--repos-shared-db\47a8c8ae-99f1-484c-be31-03be46cf4f10\scratchpad`
  — has `repull.js`, `dedup.js`, `snapshot.js`, `db.env`, `load.env` from the customer pass; adapt
  them. `db.env` holds only the `op://` reference, not the secret.
- **Kimi K3 CLI:** `~/.kimi-code/bin/kimi.exe`, model `kimi-code/k3`. Non-interactive:
  `kimi -p "<prompt>" -m kimi-code/k3`.
- **Secrets rule:** reference by 1Password location only; never paste values.

## 9. Open questions & risks

- **Which of the 8 multi-code factories are truly one vendor** vs. separate accounts — needs
  Albert's ruling (customer precedent `GORDON BROTHERS`: merge + inactive).
- **The 6 directus factories are named after people** (`Bill`, `Chloe`, `Jerome`, `Lucy`, `Tom`,
  `Wendy Sunway`) — likely test/placeholder data, not real vendors. Confirm delete vs. keep.
- **Serving layer decision unresolved** (api vendor view vs direct reads). "Hide inactive from
  pickers" is a per-app FRONTEND change (in progress via Kimi for customers/vendors).
- **Vendor active-count (low risk):** `plm.erp_vendor` shows ~97 active though vendors imported
  once — Coldlion computes `active` live and reclassified. Re-pull for current truth.
- **Risk:** a merge renaming a survivor to an existing name creates a duplicate (customer pass hit
  this with "TJX"). Post-check `select name, count(*) from core.factory group by 1 having count(*)>1`.

---

## Self-audit (handoff-writer gate) — all three YES

1. **Comprehensive for a cold-start developer?** YES — §1 app/stack/ERP, §5 machinery, §6 exact
   ordered steps with done-gates, §8 access.
2. **As effective as the author now?** YES — §4 carries every dead end (op_run/WSL, CRM trigger
   ordering, enum-in-txn, RESTRICT FK, name-similarity, Coldlion reclassification) with the fix;
   §5 names exact functions/migrations by number.
3. **Every relevant detail for flawless execution?** YES — background (§1–2), exact current state
   with numbers/columns (§3), failures (§4), findings (§5), numbered next steps with verification
   (§6), constraints (§7), access/secrets-by-location (§8), risks/decisions (§9). Gaps found &
   fixed in audit: added the FK-enumeration query, the `GORDON BROTHERS` multi-code precedent, and
   the duplicate-name post-check.
