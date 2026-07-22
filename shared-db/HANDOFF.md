# HANDOFF — shared-db current state

Date: 2026-07-22
Repo: `u2giants/shared-db`
Target branch: `main`; all completed work described here is merged and synchronized unless
a section explicitly says it remains preview-only or pending.

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## Active workstream — DB Data Admin implementation (2026-07-22)

### 1. What this application is

DB Data Admin is POP Creations' administrator-only control room for shared Customers,
Vendors, Licensors, and Properties. Its canonical code and database migrations live in this
repo. The React/TypeScript frontend is in `apps/db-data-admin/`; the development deployment is
`https://data-dev.designflow.app`; the reserved production URL is
`https://data.designflow.app`. `DB_Data_Admin.md` is the authoritative product and delivery
specification, and `docs/db-data-admin-inventory.md` is the verified implementation inventory.

### 2. What this work set out to do, and why

The project replaces scattered SQL/manual maintenance with one guarded interface while
preserving shared Core identities, per-application status overrides, immutable audit history,
and safe merges. Delivery Steps 1–10 now establish the repository/runtime foundation,
authorization/storage schema, merge coverage, protected reads, extension tables, controlled
Customer Channels, read-only Customer/Vendor grids, guarded single-record editing, and
protected duplicate merges with immutable audit history, and a read-only Licensor → Property
hierarchy with dated reconciliation and loud orphan handling. Production writes remain off.

### 3. Current state

- Repository mirroring excludes top-level `apps/` centrally; all nine consumer sync jobs test
  that boundary. No workstation-specific setup is required.
- PR #127 scaffolded React 19 + TypeScript 6 + Vite 8.1.5, pinned RevoGrid Core 4.23.22,
  Vitest, Playwright, Docker, and CI in `apps/db-data-admin/`.
- PR #129 configured the immutable GitHub Actions → GHCR → Coolify development path.
  `https://data-dev.designflow.app/` returned HTTP 200 and live HTML reported Step 10 merge
  build `39c2af6c704c41c5361fbbe33bcc71a3fe6b1348` on 2026-07-22.
- Microsoft SSO on development was repaired on 2026-07-22. Azure already contained the
  preview callback URI, but preview Supabase could not exchange the returned Microsoft
  code because its Azure credential value was invalid. A dedicated additive Azure
  credential named `supabase-preview-data-admin` now supplies preview Supabase only;
  production authentication was not changed. The frontend now displays OAuth callback
  failures and uses a short commit plus build date instead of the full SHA in the header.
- PR #130 added migrations `20260722002500` through `20260722003500` for explicit admin access,
  immutable audit events, per-profile grid state, CRM/PM/DAM extensions, and controlled
  Customer Channels. All seven are applied and contract-tested on preview
  `rjyboqwcdzcocqgmsyel`; they are intentionally not applied to production.
- Steps 5 and 6 are merged and tested on preview. PR #138 corrected deterministic PLM
  tri-state behavior, protected detail reads, and the Customer list signature; six database
  suites passed. Production stayed unchanged.
- Kimi K3 reviewed the complete plan/repository context and debated the implementation with
  Codex until both explicitly reached consensus: serialized schema/UI PRs, read-only Step 7,
  public RevoGrid templates, explicit cursor loading, lazy details, and no Step 8+ leakage.
- PR #139 delivered Step 7 Customer/Vendor RevoGrid Core views. PR #142 corrected the exact
  saved-view RPC contract and loud optimistic-conflict handling. Main CI passed lint, 10 unit
  tests, build, 3 Chromium tests, image publication, and Coolify deployment. Visual evidence
  is under `docs/verification/db-data-admin-step7-*`.
- Kimi K3 implemented the Step 8 schema/API migration and database contract suite. PR #147
  merged migration `20260722170000_db_data_admin_single_record_updates.sql`: protected
  Customer/Vendor update RPCs, an off-by-default write gate, optimistic concurrency,
  operation-id idempotency, structured expected failures, and immutable audit projections.
  The full preview database suite passed. Kimi's paid CLI quota was exhausted while correcting
  its final test fixture, so Codex completed that correction and the companion frontend.
- PR #148 delivered the Step 8 editor and audit timeline. It permits only curated display name,
  global status, CRM/PM/DAM status, and Customer Channels; every save requires a reason and
  stale records fail loudly. Main CI passed 13 unit tests, 3 Chromium tests, lint, build,
  container publication, and Coolify deployment. Visual evidence is under
  `docs/verification/db-data-admin-step8-*`.
- The `single_record_write` feature gate is enabled only on preview. The Step 8 migration and
  gate were not promoted to production.
- PR #150 delivered the Step 9 database workflow in migrations `20260722194000` and
  `20260722194100`: protected Customer/Vendor previews, exact FK counts, field-level extension
  conflicts, SHA-256 stale-preview protection, ordered advisory locks, explicit resolutions,
  operation-id idempotency, and immutable success/failure audit evidence. All eight rollback-
  safe DB Data Admin suites passed on preview; the final preview dry-run reported no drift.
- PR #151 delivered the merge dialog. It fixes the selected detail record as survivor, requires
  a duplicate, shows the direction and affected counts, requires every conflict choice plus a
  reason and irreversible confirmation, and refreshes the survivor/audit after success. Main
  CI passed 15 unit tests, 4 Chromium tests, lint, build, image publication, and Coolify deploy.
  Visual evidence is `docs/verification/db-data-admin-step9-merge-preview.png`.
- The `merge_execute` feature gate is enabled only on preview. Neither Step 9 migration nor
  merge execution was promoted to production.
- GLM 5.2 implemented Step 10 under Codex supervision. PR #153 added the protected read-only
  hierarchy RPC in migrations `20260722203000` and corrective `20260722203100`; PR #154 added
  the accessible Licensors tab. The contract reads the edge only from
  `core.property.licensor_id`, shows division/type-qualified PLM context, returns every orphan
  separately, and always states that live upstream reconciliation is not claimed. All nine
  rollback-safe DB Data Admin suites passed on preview. Main CI passed 22 unit tests,
  5 Chromium tests, lint, build, container publication, and Coolify deployment. Evidence is
  under `docs/verification/db-data-admin-step10-*` and
  `docs/verification/db-data-admin-licensor-property-tree-20260722.md`.
- Albert's active preview profile had the Administrator role and now has one explicit,
  non-revoked **preview-only** `admin` access row. It was added only after verifying the
  profile and role. No production grant or production database change was made.
- Consumer enforcement, bulk operations, and production delivery remain Steps 11–13 and are
  not started.

### 4. What did not work

- The local Windows closeout could not run an `rsync` probe because `rsync` is not installed.
  The permanent answer is the real Ubuntu GitHub matrix test, which passed in all nine consumer
  repositories; do not add workstation setup for this.
- Playwright MCP left `.playwright-mcp/` logs in the repository root. They are generated
  scratch output, now ignored globally; durable screenshots belong under `docs/verification/`.
- The first closeout `npm` verification was mistakenly invoked from the repository root,
  which intentionally has no `package.json`, and returned `ENOENT`. Run frontend commands from
  `apps/db-data-admin/`; this was a working-directory error, not an application defect.
- Earlier handoff text said “PLAN ONLY” after PRs #127/#129/#130 had landed. This section
  supersedes that stale statement and records the actual verified state.
- The first Step 7 browser capture exposed a Customer column filter visually carrying into
  Vendors. Draft/applied filter state is now tab-isolated, and the final Vendor capture proves
  the input is cleared while rows remain visible.
- Mocked browser transport initially hid a saved-view RPC naming mismatch (`p_grid_key` versus
  real `p_entity_type`). Source-contract comparison caught it; PR #142 fixes it with a
  regression test and explicit version-conflict error.
- A synthetic HS256 user JWT made from the stored legacy JWT secret was rejected by current
  Supabase signing (`PGRST301`). Do not repeat that auth test; use real Microsoft SSO or
  current asymmetric signing tooling. The explicit preview grant itself was verified.
- During Kimi's non-interactive run, the Step 8 migration was unexpectedly applied to preview
  as timestamp `20260722170000` despite the prompt requesting no database mutation. Preview
  history was reconciled to the checked-in canonical file, the dry-run then reported no drift,
  and production was never linked or changed. Do not rename or edit that applied migration.
- Kimi's CLI remained blocked by its billing-cycle quota when Step 9 began, so its new read-only
  design check could not run. Codex proceeded from the previously Kimi-reviewed delivery plan.
- The first Step 9 preview test failed because hosted Supabase exposes pgcrypto under the
  `extensions` schema. The applied migration was not edited; corrective migration
  `20260722194100` qualified `extensions.digest`, after which all suites passed.
- GLM's first Step 10 preview execution used unsupported `max(uuid)` cursor aggregation. The
  applied migration was not edited; GLM added `20260722203100` using a deterministic text-cast
  UUID aggregate. The next run found a test-only nonexistent `jsonb_object_field_exists`
  helper; GLM corrected it to the native JSONB `?` operator. All nine suites then passed.

### 5. Root causes and key findings

- `shared-db` is both the canonical shared schema repo and the correct home for this app, but
  application source must never be mirrored into consumers. The checked-in sync exclusion is
  the automatic boundary.
- Production DesignFlow uses Cloud SQL for PLM Customer/Vendor status. DB Data Admin must use a
  protected DesignFlow operation and mirror the result back; it must not create a competing
  editable Supabase PLM status. See `docs/db-data-admin-inventory.md`.
- Merge engine coverage and the protected Step 9 workflow are complete. Production remains
  protected by the off-by-default database gates and the unpopulated production admin grant.

### 6. Exact next steps

1. Refresh `https://data-dev.designflow.app`, use Microsoft SSO, open Licensors, and expand a
   row. **Pass when** nested Properties, dated counts, source context, and the explicit live-
   reconciliation disclaimer appear. Any real orphan must appear in the red alert.
2. Start Step 11: consumer enforcement and safety audit across CRM, PM/PIM, DAM, and the six
   DesignFlow repos. Follow each repo's branch/review rules. **Pass when** inactive records
   disappear from exactly the intended pickers and no direct extension-table bypass remains.
3. Continue Steps 12–13 in order. Do not promote migrations or enable production status/merge
   writes before consumer enforcement and an approved production window.

### 7. Constraints and gotchas

Use a new shared-db branch and PR for each serialized schema tranche; preview first, additive
by default. Do not touch the separate ERP relocation objects. Do not seed a production admin
grantee without Albert's approval. Do not expose the `dam` schema through PostgREST. Keep
Licensor/Property read-only in v1. Do not delete `fix_impl_visual_admin_page.md` until every
final completion condition in `DB_Data_Admin.md` has passed.

### 8. Access and environment

GitHub CLI, Supabase CLI, Coolify orchestration, and Microsoft/Entra configuration paths have
been exercised. Database and deployment credentials belong only in the 1Password
`vibe_coding` vault or the documented GitHub/Coolify secret stores; no secret value belongs in
the repo. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.

### 9. Open questions and risks

The production admin-grantee list remains deliberately empty; Albert's explicit grant exists
only on preview. Vendor PLM status cannot ship
until DesignFlow exposes stable Factory identifiers and a reviewed mapping populates
`core.factory_source_ref`. The Coldlion `/vendors` feed may include non-factories, so the open
vendor-feed decision in AGENTS.md §6.2 still blocks further vendor curation. Production
promotion requires an approved window and completed consumer enforcement.

---

## HTS RAG rulings table — complete in preview and production

### What this application and change are

`u2giants/shared-db` is the migration source of truth for the hosted Supabase database
shared by POP Creations applications. DesignFlow's backend is adding an AI-assisted HTS
classification workflow. When a CBP customs ruling is a useful match, the backend will cache
the public ruling text and classification metadata so later classifications can reuse a fast,
grounded result.

The additive migration
`supabase/migrations/20260721203000_hts_rag_rulings.sql` creates
`public.hts_rag_rulings`. It was merged through
[PR #128](https://github.com/u2giants/shared-db/pull/128) in commit
`be0162221fa3f952118abd6e13142f965fffc50e`. It was promoted to production on
2026-07-21 after the DesignFlow Sequelize model and upsert passed local preview testing.

### Current verified state

- Preview is project `rjyboqwcdzcocqgmsyel`, Supabase branch
  `shared-db-schema-rehearsal`. This persistent preview was rebuilt as a production data clone
  because legacy DAM objects predate replayable repository migration history.
- Preview now reports latest migration `20260721203000`; the table exists there.
- Production project `qsllyeztdwjgirsysgai` reports migration `20260721203000`; the table
  exists there. The production push was bounded to this migration only. Seven newer DB Data
  Admin migrations remained unpromoted by using a clean temporary checkout ending at the
  approved migration.
- The 1Password `vibe_coding` item
  `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`
  contains the working preview pooler tuple. Use `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
  `DB_NAME`, and `DB_PORT`; SSL is required. Never copy the password into Git or chat.
- The preview database password was deliberately reset on 2026-07-21 and the matching
  GitHub Actions secret `SUPABASE_DB_PASSWORD_PREVIEW` was updated.
- A Node `pg` connection using the exact 1Password pooler tuple completed transactional
  INSERT, UPDATE, SELECT, and DELETE against `public.hts_rag_rulings`, then rolled back.
  The connected `postgres` role owns the table, has direct CRUD privilege, has
  `BYPASSRLS`, and saw RLS inactive for that session. No test row persisted.
- The deployed DesignFlow services `popcre-albert-core-sandbox` and
  `popcre-albert-core-sandbox2` deliberately remain connected through the canonical
  `*_SANDBOX` GCP secret tuple to shared production Supabase project
  `qsllyeztdwjgirsysgai`. **Do not repoint those secrets to preview.** Preview is only for
  local model/upsert testing and may be rebuilt or reset. The production verification used
  this unchanged GCP sandbox connection tuple and successfully reached the new table.
- Production verification confirmed the expected primary/unique/date/revocation indexes,
  `service_role` CRUD privilege, revoked `anon`/`authenticated` access, enabled non-forced
  RLS, table ownership by `postgres`, JSONB arrays, unique enforcement, and direct CRUD.
  The `set_updated_at` trigger advanced the timestamp across separate committed statements.
  All verification rows were deleted; none remain.

### What failed and why

1. The old preview project had irreconcilable migration history, so it was replaced with
   `rjyboqwcdzcocqgmsyel`. A data clone was required because a schema-only replay could not
   reproduce legacy objects absent from repository migrations.
2. `supabase branches get` displays database passwords as the literal masked value `******`.
   An initial credential refresh mistakenly persisted that placeholder, making pooler login
   fail with PostgreSQL error `28P01`. The preview password was reset through the Supabase
   Management API, then the real value was written directly to 1Password and GitHub Actions
   without printing it.
3. After valid pooler authentication was restored, a direct query showed preview stopped at
   migration `20260717163500` and lacked `hts_rag_rulings`. Running preview dry-run exposed
   eight pending migrations; all eight were applied in repository order. The final migration
   is now `20260721203000`, and the CRUD proof passes.
4. Investigation confirmed deployed sandbox points to production, not preview. This is the
   intended architecture, not a defect: local tests use preview; approved migrations then
   move to production, where deployed sandbox sees them with zero secret changes.

### Exact next steps and verification gates

The shared-db portion is complete. Continue in `popcre/designflow-backend` under its normal
DesignFlow sandbox/Uma-review workflow. **Pass when:** the already preview-tested model and
upsert service are committed, pushed, reviewed, and deployed, then a backend-level smoke test
uses the production table through the unchanged `*_SANDBOX` connection tuple.

### Constraints, access, questions, and risks

- No shared-db production promotion remains for this HTS table.
- This is additive; do not edit the applied migration. Any correction must be a new timestamped
  migration and must follow preview-first workflow.
- `service_role` grants cover API/JWT access. Direct Sequelize pooler access uses the database
  `postgres` role, which was verified to own the table and bypass RLS.
- Authenticated tools exercised this session: `gh`, `gcloud`, `supabase`, and 1Password.
  Runtime secrets remain in 1Password vault `vibe_coding` and GCP Secret Manager; no secret
  value belongs in repository files.
- No open shared-db question remains. Application deployment belongs to the DesignFlow backend
  workflow and must not introduce startup DDL or change database secrets.

---

## 📌 Session 2026-07-20/22 — data/schema work (COMPLETED + OPEN ITEMS)

Full narrative: [`docs/app-migration-notes/session-2026-07-21.md`](docs/app-migration-notes/session-2026-07-21.md).

### Completed + deployed to prod this session (all verified)
- **PLM sync failure-logging** (PR #107) — the host wrapper now writes a committed `status='failed'`
  `ingest.sync_run` row + `systemd OnFailure` alert. **Merged to repo but NOT yet deployed on the hetz
  box** (see OPEN #4).
- **Vendor/factory schema** (PR #102) — `core.factory.display_name`, `core.factory_alias`,
  `core.merge_factory(p_loser, p_survivor, p_alias_loser_name)`. Was merged-but-unapplied; deployed.
- **Item→taxonomy Phase 2a/2b foundation** (PRs #110/#115) — `plm.merch_group_header`,
  `plm.item_import`, `plm.item_import_staging`, `plm.item_import_unresolved`,
  `plm.item_taxonomy_disagreement`, `plm.import_item_master_data(jsonb)`,
  `plm.import_merch_group_headers(jsonb)` + tooling. **`plm.item` is LIVE but 0 rows** — Phase 3 not run.
- **Vendor curation + dedup** (PRs #113/#115/#118) — status seed, 4 not-a-factory purges, directus
  reassignment (33 products + 20 style bridges, 0 orphans), 9 exact-name dup merges.
- **Coldlion `/vendors` wrong-table — RESOLVED.** Coldlion fixed it 2026-07-22: `/vendors` now serves
  **97 factory-only records** (was 539 mixed with freight/gov/bank/courier service-providers).
- **Vendor reconcile EXECUTED** (PRs #140/#141, migration `20260722140000_...`). **`core.factory` is now
  93 rows (91 active / 2 inactive)** — factories only. 418 stale old-feed rows purged; Anthony's
  Warehouse (`ANT001`) re-added **inactive** per Albert (kept, not excluded), mirror relinked; the blank
  `CNWAH` record skipped. Plan: [`fix_vendor_reconcile.md`](fix_vendor_reconcile.md) (marked executed).

### 🔵 OPEN ITEMS — exact next actions (data/schema side)

**OPEN #1 — Refresh the `plm.erp_vendor` mirror to the corrected 97. ✅ DONE 2026-07-22.**
- *Done:* migration `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` (PR #145,
  merged, applied to preview then **production**). The live `/vendors` feed was pulled and verified = 97
  (all active) before authoring; the mirror's own 97 *active* rows were already exactly those codes, so
  rather than a risky ad-hoc service-role re-pull, the migration deterministically **deletes the 442
  stale inactive service-provider rows** (guarded: asserts the allowlist = 97 and **aborts if any active
  mirror row falls outside it**) and records a completed `ingest.sync_run` (`mode=mirror_reconcile`).
  `core.factory` and bronze `ingest.raw_record` were untouched.
- *Prod verified:* `plm.erp_vendor` = **97**; `core.factory` unchanged at **93 (91/2)**; ANT001 still
  inactive; 0 factories lost mirror representation; prod sync_run `05d09a73-...` succeeded (before=539,
  deleted=442, after=97).
- *Known benign leftover (small follow-up, folded into OPEN #5):* **8 `core.factory_source_ref` rows**
  are mislabeled `source_system='coldlion'` with **numeric legacy IDs** (415, 99, 147, 403, 244, 457,
  476, 472) that were never real Coldlion vendorCodes. Their old mirror rows were correctly deleted, so
  these refs now point at no mirror row — but every one of the 8 factories still carries its **real**
  Coldlion code (CNJAM, SKPHL, CNHDL, CNRPH, CNDWG, …), which IS mirrored. Harmless; cleanup = either
  delete these duplicate numeric refs or relabel them `source_system='directus'`/`legacy`.

**OPEN #2 — Plan for a RECURRING vendor sync (two mandatory guards). ✅ DONE 2026-07-22 (plan written).**
- *Done:* [`fix_vendor_sync.md`](fix_vendor_sync.md) (PRs #145/#156/#157, merged; GLM-reviewed, review at
  `.ai/reviews/vendor-sync-plan-glm-2026-07-22.md`). Full design for the scheduled vendor sync: **weekly
  cadence on a Supabase Edge Function + scheduled invocation** (NOT the hetz systemd host — that box's PLM
  sync is broken/undeployed, OPEN #4), `ingest.sync_run` accounting with the **PR #107 durable-failure**
  pattern + empty/short-pull guard, **upsert by `(source_system, source_table, source_id)`** (prevents
  re-splitting merged dups / re-adding purged rows), and both mandatory guards:
  1. **Reject blank/nameless** (`CNWAH`, live-confirmed still blank) → loud `plm.vendor_quarantine`
     table + `rows_failed`; never into `core.factory`.
  2. **Persist "not a factory" exclusions** in a durable `plm.vendor_exclusion` table the importer
     consults every run — **seed the 418 purged service-provider codes too** (GLM S1: otherwise "no
     re-add" is only true because today's feed omits them), plus ANT001 and the re-review rulings
     (Buildasign, May Group Deco Sign, `FLGDS`, `INTUF`, Royal Packers, Royal Union). **Status is
     app-owned — set on INSERT only, never overwritten on re-pull.**
  The plan also **flags that the existing `plm.import_coldlion_vendors` VIOLATES guard 2** (it force-sets
  `status='active'` on matched rows) and must be superseded/dropped when the guarded importer is built.
- ⚠️ **Twin bug (record so it's not lost):** `plm.import_coldlion_customers` has the SAME status-clobbering
  flaw (`status='active'`, `is_potential=false` on matched rows). Customers are marked "done" but run on
  this flawed importer — open a twin fix when the guarded vendor importer lands.
- *Not yet built:* the importer/tables/Edge Function. `fix_vendor_sync.md` §8 splits it into **Phase A**
  (guarded importer + tables + `public`/`api` wrappers — provable now via a one-off Node/`pg` dry-run;
  needs the 418-code seed + Albert's ruling on the 6 borderline vendors) and **Phase B** (scheduled Edge
  Function + alerting — first verify pg_net/Vault are actually available; build the overdue/failed-run
  alert BEFORE enabling the schedule).

**OPEN #3 — Item→taxonomy Phase 3+ (backfill then cutover).**
- *What/why:* `plm.item` is built but empty; items are still served from `public.erp_items_current`
  with text licensor/property codes (no FK). Coldlion `/items` is back to HTTP 200 (19,066 items /
  9,533 pages), so Phase 3 is unblocked.
- *Next step:* Phase 3 — run the item sync to backfill `plm.item` via `plm.import_item_master_data`
  (pull `/merchGroupHeaders` for ALL divisions first — the resolver needs the per-division dictionary).
  Then Phase 4 cutover: repoint `api.plm_item_list` from `public.erp_items_current` → `plm.item`, keep
  the legacy pull refreshed through the deprecation window, defer the style-bridge FK repoint to Phase 5.
- *Gate before Phase 4:* row-parity check + grants/RLS on the new `plm.*` tables + an **app-repo grep**
  (`erp_items_current`, `licensor_code`, `property_code`, name-based lookups) in popdam/popcrm/dflow/
  poppim. Full spec + locked decisions: [`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) §7b.

**OPEN #4 — Deploy PR #107 on the hetz box + the upstream PLM 502.**
- *What/why:* the PLM master-data sync (`getLicensorsWithProperties`) has returned HTTP 502 since
  2026-07-08 — licensors/properties can't refresh. PR #107 fixes the silent-failure logging but must be
  deployed where the sync runs.
- *Next step:* on hetz — `cd /worksp/shared-db && git pull && sudo systemctl daemon-reload` (deploys the
  wrapper + `plm-sync-alert.service`). Separately, the upstream 502 is a DesignFlow/Cloud Run problem
  (api.designflow.app), not ours — raise it. *Verify:* force a failed run and confirm a `status='failed'`
  `ingest.sync_run` row + the alert fire.

**OPEN #5 — Residual fuzzy vendor duplicates + mislabeled source-refs (low priority).**
- The fuzzy-dup sheet (`docs/vendor-review/vendor_fuzzy_dupes.csv`) is mostly MOOT now — most of its 69
  pairs were the service-providers Coldlion removed. But a few genuine Chinese-factory dups may remain
  among the clean 93 (Taizhou Meihua / Xianju Fenda variants etc.). Optional: re-run exact + fuzzy
  detection on the 93 and merge any confirmed pairs via `core.merge_factory`.
- *Added 2026-07-22 (from OPEN #1):* clean up the **8 mislabeled `core.factory_source_ref` rows** with
  numeric legacy IDs (415, 99, 147, 403, 244, 457, 476, 472) recorded as `source_system='coldlion'` but
  which were never real Coldlion vendorCodes. Either delete them (each factory keeps its real Coldlion
  code) or relabel `source_system='directus'`/`legacy`. Benign — no factory lost mirror representation.

**OPEN #6 — Carried-forward security item.** Production DB password possibly exposed 2026-07-10; rotation
status unverified. Confirm and close.

> **Cross-workstream note:** the **DB Data Admin** app (its own workstream at the top of this file) is the
> serving/UI layer for these curated Customers/Vendors/Licensors/Properties. The **DesignFlow production
> DB-port incident** (its own section) is a separate infra workstream with its own open steps.

---

## 🔴 DesignFlow production DB-port incident — remediation state 2026-07-20

**Read the comprehensive incident record first:**
[`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md).
Detailed GCP source-of-truth and operations live in `popcre/infrastructure`:
`popcre/gcp/live/production-database-safety-plan.md` and
`popcre/gcp/live/production-db-secret-break-glass.md`.

### What happened and why

`fix_connection_pool.md` generalized a sandbox hosted-Supabase pooler design to
production without first inventorying each environment. A later Codex session
changed unsuffixed production `DB_PORT` from Cloud SQL port `5432` to Supabase
pooler port `6543`. Production used the correct Cloud SQL host with the wrong
port and failed. The plan-writing failure mattered as much as the later command:
no provider-by-environment inventory, complete-tuple comparison, production
approval gate, numeric version pin, negative build fixture, startup rejection,
or zero-traffic connection proof stopped the error.

### Correct contract and ownership

- Develop/staging/sandbox: hosted Supabase pooler, `6543`, SSL on, complete
  `_DEV`/`_STAGING`/`_SANDBOX` tuple.
- Production: Cloud SQL, `5432`, SSL off under the current contract, private VPC,
  complete unsuffixed tuple, numeric versions only.
- `shared-db` owns schema/migrations/data contracts. `popcre/infrastructure`
  owns GCP Secret Manager IAM, Cloud Build triggers, Cloud Run bindings, VPC
  routing, and version pins. App repos own startup validation/readiness/tests.
  `ai-devops` owns universal external-state rules and pointers.

### What is complete and live

- Infrastructure PRs #12–#14: machine-readable connection contract; nine
  passing positive/negative fixtures; explicit five-secret substitutions;
  numeric production version pins; four production triggers disabled; sandbox
  secret boundary repaired; critical secret-version alert enabled.
- A deliberate Cloud SQL + `6543` build
  (`c266a112-eaea-4dd9-997a-a7f66ac3d310`) failed in step 0 before image or
  deploy.
- Corrected application commits: Backend `1a28265` PR #62, Item Master
  `1afb25b` PR #37, Tracking `ed2ff6d` PR #25, Data Syncing `a48b8a7` PR #16.
  Combined proof: 109 suites / 741 tests. All four PRs are green, open, and now
  request review from Uma's GitHub user `devopswithkube`.
- Production reused its known images in zero-traffic candidates, proved Cloud
  SQL `10.75.208.4:5432`, SSL off, private VPC, and numeric DB secret version
  `1`, then moved 100% traffic to `core-00010-bof`, `item-00010-ben`,
  `tracking-00010-riv`, and `sync-00007-suh`. `https://designflow.app` returned
  HTTP 200.
- Infrastructure PRs #15–#17 culminated in `9ad06f1`. Terraform applied 24
  additions, zero changes, zero destroys: scoped nonproduction and reserved
  production writers, 20 secret IAM bindings, one nonproduction impersonation
  binding, and critical access-control alert `10443910794556794963`. Final plan:
  no changes.
- Read-only IAM tests prove the nonproduction writer can version `DB_PORT_DEV`
  but not production `DB_PORT`; the production writer has no impersonator.
- 1Password vault `vibe_coding` contains a non-secret recovery note titled
  `DesignFlow production DB secret approval gate`, ID
  `iwmlvzmx3acqknbktnwuu5x5bi`. Runtime values remain in GCP Secret Manager;
  recovery values/notes belong in 1Password, never Git or chat.

### What failed and why

The first hard-gate design planned a project deny policy plus a one-hour PAM
entitlement. Google rejected the temporary `roles/iam.denyAdmin` bootstrap
binding before Terraform apply because Deny Admin can be granted only at
organization level. The project has no parent and the authenticated account
sees no Google Cloud organization. PAM also requires an organization-level
service agent. No temporary role remained, no partial deny/PAM resource was
created, and no secret or workload changed. PR #16 removed the undeployable
resources before safely applying the 24 foundations.

The first acceptance-script run also exposed a PowerShell representation issue:
an empty denied permission response arrived as `null`, not an empty array. PR
#17 fixed null/empty handling. The script now proves the scoped identities, then
intentionally returns `BLOCKED` because Albert's project Owner role still grants
direct secret-version mutation.

### Exact remaining steps and verification gates

1. Create/select the company-controlled Google Cloud organization and move
   `lithe-breaker-323913` beneath it without changing project ID, billing,
   services, data, or secret values. **Pass:** project parent is the intended
   organization and production remains HTTP 200 on the same revisions.
2. Configure organization Deny Admin and Google's PAM service agent through
   infrastructure Terraform. **Pass:** plan contains only intended IAM/PAM
   additions, zero unrelated changes/destroys.
3. Restore the deny policy and one-hour entitlement: Albert requester, Uma
   (`devopswithkube@gmail.com`) sole approver, mandatory reasons, Token Creator
   restricted to the exact production break-glass writer. **Pass:**
   `Test-DbSecretGuardrails.ps1` reports every check passed instead of the
   intentional Owner blocker.
4. Conduct a no-secret-change request/approve/expire exercise. **Pass:** Albert
   cannot impersonate before/after; can during the approved window; both alerts
   identify the actors; no secret version is added.
5. Uma reviews the four application PRs. **Pass:** Uma—not an AI—merges approved
   changes to `develop`. Production continues using Cloud SQL/`5432`; these PRs
   add safe pool/readiness behavior, not a provider migration.

### Non-negotiable constraints

Do not self-approve, make Albert a deny exception, create a service-account key,
grant standing production impersonation, put database values in GitHub inputs,
re-enable production triggers early, or follow the historical production steps
inside `fix_connection_pool.md`. Unsuffixed secrets are production-only and no
schema task or sandbox task implicitly authorizes touching them.

---

## 🟠 Two live outages found 2026-07-19 — `/items` + alerting FIXED; PLM upstream 502 still open

Both were discovered while answering a documentation question. **Neither has been repaired,
and neither is alerting.** They are the highest-priority items in this file.

### Outage 1 — the PLM master-data sync has been dead since 2026-07-08

**What is broken.** `tools/sync-plm-master-data.mjs` runs nightly at 03:30 via
`systemd/plm-sync.timer` on the `hetz` VPS. It pulls licensor/property master data from
DesignFlow PLM and loads it through `plm.import_master_data()` into `core.licensor` /
`core.property`. Its last successful run was **2026-07-08**. As of 2026-07-19 that is
**11 days stale**.

**Why it is broken.** The upstream endpoint is down:

```
GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties
→ HTTP 502 after ~31 seconds  (retried; consistent)
```

The ~31s latency before the 502 looks like the origin timing out rather than a bad key or a
gateway rejection. The API key at
`op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key` was used and is not
implicated — a bad key returns a fast 401/403, not a slow 502.

**Why nobody noticed — this is the more serious bug.** `ingest.sync_run` holds 15 runs for
`source_system='designflow_plm'` and **every single one has `status='succeeded'`**. There
are zero failure rows. The sync did not record an error; it simply stopped appearing.
Verify with:

```sql
select now()::date as today, max(started_at)::date as last_sync,
       (now()::date - max(started_at)::date) as days_since,
       count(*) filter (where status <> 'succeeded') as non_success_runs
from ingest.sync_run where source_system='designflow_plm';
```

This violates the house "no silent failures" rule. **A failed run must write a row with
`status <> 'succeeded'` and a populated `error` column, and must alert.** Fixing the
alerting matters more than fixing the outage — the outage is visible once alerting exists.

> **UPDATE 2026-07-20 — the alerting half is FIXED (PR #107, merged).** Root cause found:
> `plm.import_master_data()` set `status='failed'` then re-raised, so the aborted
> transaction rolled the failed row back; and the 502 fails in `fetchJson()` before the
> import transaction even starts — so failed runs left **no** row (not a false success).
> The host wrapper (`tools/sync-plm-master-data.mjs`) now writes a **committed**
> `status='failed'` row (separate transaction) capturing error + stage, and
> `systemd/plm-sync.service` gained `OnFailure=plm-sync-alert.service` (journal +
> `/home/ai/plm-sync-failures.log`). Unit tests in `tools/sync-plm-master-data.test.mjs`.
> **Remaining:** (a) the upstream 502 itself is still unfixed — the sync still cannot pull;
> (b) the fix must be deployed on the `hetz` sync box (`cd /worksp/shared-db && git pull &&
> sudo systemctl daemon-reload`) before it takes effect there.

**A second thing to look at while you are in there.** Every historical run recorded
`rows_seen=560, rows_inserted=560, rows_updated=0`. A daily reconciling sync that has
*never once* recorded an update strongly suggests wholesale re-insert rather than
reconciliation. Worth understanding before trusting the loader.

**Where to start.** Check whether `api.designflow.app` is up at all, then the Cloud Run
service behind it. Note DesignFlow runs on **Cloud SQL, not Supabase** — do not go looking
for this in the Supabase dashboard.

### Outage 2 — Coldlion `GET /items` returns a server-side 500

```
GET http://x5.coldlion.com/EhpApi/items?companyCode=EDGEHOME&divisionCode=CW001&size=5
→ 500  {"exception":"java.lang.NullPointerException","path":"/EhpApi/items"}
```

Reproduced with and without `divisionCode`, with `modifiedFrom`, with `merchGroup05`, and at
several page sizes. **It is server-side and unconditional.** It was working 2026-07-15 per
`docs/coldlion-erp-api-reference.md`, so it broke within four days.

> **UPDATE 2026-07-20 — FIXED upstream.** `GET /items` now returns **HTTP 200** (verified
> live: 19,066 items across 9,533 pages, `size=2&page=0`). The NullPointerException is gone.
> This **unblocks the item→taxonomy wiring** (Phase 2+ of `fix_schema_for_api.md`), which is
> now the active build (see the new item→taxonomy plan referenced below).

Every other read endpoint was verified healthy the same day — `/customers`, `/vendors`,
`/inventory`, `/merchGroupHeaders`, `/merchGroupDetails`, `/seasons`, `/itemDetails` all
200. (`/salespersons` returns 400 without extra params; that is a parameter issue, not an
outage.)

**Impact.** `/items` is the only endpoint carrying `hasImage` and the `merchGroup01–14`
pointers on each item. It also blocks the co-occurrence approach described in
`docs/merch-group-taxonomy-architecture.md` §10.2. **This is Coldlion's server, not ours —
it likely needs to be raised with them rather than fixed here.**

---

## Merch-group taxonomy — now fully documented (2026-07-19)

**Read [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md)
before touching anything named licensor, property, big theme, little theme, style guide, art
type, art source, artist, age group, or `mgTypeCode`.** It was written from live Coldlion API
calls, live Supabase queries, and a full read of all six `popcre/designflow-*` repos.
Shipped in [PR #103](https://github.com/u2giants/shared-db/pull/103).

**The short version.** Coldlion owns the *vocabulary*, DesignFlow owns the *relationships*,
Supabase is a downstream mirror of both. Coldlion does have explicit licensors and properties
(22 and 258 in CW001) — what it lacks is any link between them and any active/inactive flag.

**Three rules that cause real damage when ignored:**

1. `mgTypeCode` has **no fixed meaning**. `05` is Licensor in CW001/SP001 but "Big Theme" in
   EH001 and "Product Line" in EP001. Resolve through `(divisionCode, mgTypeCode) → mgTypeDesc`.
2. Coldlion has **no hierarchy and no active flag**. Both are DesignFlow-owned. A direct
   Coldlion sync cannot reproduce either, and would resurrect dead licenses.
3. Codes are unique **only within `(division, mgTypeCode)`**. `FR` is a licensor in our DB and
   a *property* in Coldlion. Never look up by `mg_code` alone.

### Corrections this made to earlier docs

Prior documentation was wrong on two points, both now fixed in-place:

- `coldlion-erp-to-supabase-field-mapping.md` said "Coldlion has no explicit licensor." It
  does. The gap is the relationship, not the entity.
- Several docs stated `merchGroup05 = licensor` / `merchGroup06 = property` flatly. True for
  two of four divisions only.
- The "partial licensor import (37 PLM vs 20 core)" was **not** partial. 37 staging rows hold
  20 distinct codes; `core.licensor`'s `unique nulls not distinct (code)` deliberately
  collapses the division dimension. Nothing is dropped.

### Open decision that needs a human — `FR` / FRIENDS TV

`core.licensor` carries `FR` = FRIENDS TV (1 property), from `plm.licensor_import` id 199,
division 1. **Coldlion has no `FR` licensor** in either licensed division — there, `FR` is a
*property* meaning "1ST ORDER TROOPER."

Because the ETL has no delete or tombstone path, either it was created directly in PLM or it
was removed from Coldlion after an earlier sync. **The data cannot distinguish these.** It is
the only licensor in our canonical table with no upstream ERP anchor. Someone who knows the
licensing history needs to decide whether it stays.

### Open design question — the division collapse

`core.licensor` merges POP Lic and Spruce Lic into one row per code. That is correct if a
licensor is a company (Disney is Disney). It is **wrong the moment division 9 is imported**,
because MG05 there means "Big Theme," not "Licensor." Decide before importing EH001.

### What was NOT done

- Neither outage fixed (see above).
- **15 defects catalogued in §9 of the taxonomy doc are documented, not fixed.** Notable:
  a `vendor`-role authorization gap letting external vendors create/soft-delete taxonomy;
  a dedup key including `mg_desc` so renames create duplicate rows; the merch-group *header*
  sync hard-coded to `divisionCode=EH001` so the CW001/SP001 definitions are never fetched.
- The co-occurrence approach for deriving the hierarchy from Coldlion alone is **untested** —
  `/items` was down.

### Gotchas that cost time this session

- **The six `designflow-*` repos are at `C:\repos\dflow\designflow-*`**, not siblings of
  `shared-db`. All on branch `sandbox-albert`.
- **Do not route Coldlion calls through `bash` on Windows.** A bare `bash` resolves to WSL,
  which does not inherit injected env, so the API key arrives empty and Coldlion answers
  `400 Missing request header 'X-API-Key'` — which looks like a broken tool but is not. Use
  `op_run` with `shell: powershell` and `$env:VAR`.
- **`cmd.exe` cannot expand `%%VAR%%` loops** outside a batch file. Use PowerShell for any
  loop over divisions or type codes.
- `/merchGroupDetails` returns a **plain JSON array**, not the paged `{content:[...]}`
  envelope most Coldlion endpoints use. Parsers written for the envelope will break.

---

## RETRACTED workstream — DesignFlow database connection architecture

> **STOP — the remainder of this section is an incident artifact, not a current
> implementation guide.** It incorrectly generalized the sandbox hosted-Supabase
> connection to production, which remains on Cloud SQL. A Codex session then
> changed the unsuffixed production `DB_PORT` from `5432` to `6543` and broke the
> live site. Do not merge any historical PR head based on this section's old
> evidence, do not follow the production steps below, and do not mutate
> unsuffixed GCP DB secrets. The current PR heads have since been revalidated and
> are assigned to Uma; the authoritative current state is at the top of this
> handoff and in the incident record.

### What this is

DesignFlow is POP Creations' product-lifecycle-management system used by staff to manage RFQs,
items, licensing/tracking, and ERP synchronization. Its Angular frontend and BFF call four Node.js
/ Express / Sequelize services (Core Backend, Item Master, Tracking, and Data Syncing), deployed
to Google Cloud Run. The app repos are the six `popcre/designflow-*` repositories under
`C:/repos/dflow`; their sandbox branches serve `https://sandbox-albert.designflow.app`. All four
services share application data governed by this `u2giants/shared-db` repo, but
their database provider is environment-specific: sandbox/develop/staging use
hosted Supabase while production uses Cloud SQL.

The durable portion separates schema control from runtime connections:
shared-db migrations own all DDL, and applications use small validated
per-process pools. Supavisor transaction mode applies to hosted-Supabase
nonproduction environments; production remains Cloud SQL.

### What we set out to do, and why

Implement [`fix_connection_pool.md`](fix_connection_pool.md) v3.0: move Core's legacy startup
DDL under shared-db ownership, use transaction pooling for Cloud Run, bound and validate every
client pool, gate traffic on readiness, label connections, and drain owned connections cleanly.

### Current state

Schema, code, automated tests, transaction-mode compatibility, and sandbox acceptance are
complete. Uma's normal PR review/merge and post-merge production verification remain.

- Migration `20260717163500_reconcile_dflow_backend_startup_contract.sql` was checked,
  dry-run/applied to preview, proven compatible with the old Core boot, merged in shared-db PR
  [#97](https://github.com/u2giants/shared-db/pull/97), applied to production by successful run
  `29611459054`, and audited live. Merge SHA: `293fd90697bb0a0024e196d6b4a2da2e298dbd15`.
- App heads are pushed on `sandbox-albert`: Item Master `bca5f16`
  ([PR #37](https://github.com/popcre/designflow-item-master/pull/37)), Tracking `a14afc1`
  ([PR #25](https://github.com/popcre/designflow-tracking/pull/25)), Data Syncing `509c010`
  ([PR #16](https://github.com/popcre/designflow-data-syncing/pull/16)), and Core `b4a015a`
  ([PR #62](https://github.com/popcre/designflow-backend/pull/62)). Uma has not merged them;
  the AI must not merge DesignFlow PRs.
- All four full unit suites passed: 693 tests. Preview port-6543 checks passed for all four
  services, including a real Sequelize transaction.
- Historical incident evidence includes an unsafe unsuffixed `DB_PORT` version
  containing `6543`; do not use it. Production is pinned to numeric version `1`
  and Cloud SQL/`5432`. The four corrected sandbox builds use the complete
  `_SANDBOX` tuple and deployed ready transaction-mode revisions. Each emitted a validated application name and
  `db_ready` before HTTP listen. Login, token, Item Library, and Tracking checks returned 200;
  logs had zero acquire-timeout, ceiling, or startup-fatal matches.
- Exact builds, revisions, and timings are in
  [`docs/verification/supabase-pooler-idle-connection-drop-20260623.md`](docs/verification/supabase-pooler-idle-connection-drop-20260623.md).

### Everything tried that did not work

- `api.sandbox-albert.designflow.app` did not resolve from this machine. The deployed smoke test
  used the canonical public Cloud Run BFF URL instead; all checks passed. This was a DNS-name
  issue, not an application failure.
- A local preview `supabase db push --dry-run` listed ten migrations because preview lagged
  production. The GitHub preview workflow applied the backlog plus reconciliation cleanly. No
  applied migration was edited.
- Cloud Run rejected two attempts to change `DB_PORT` from a secret reference to
  a literal in the same revision. The later unsuffixed secret-version approach
  was not a safe atomic solution—it crossed the environment boundary and caused
  the production outage. The corrected route uses `_SANDBOX` outside production
  and keeps production on its pinned unsuffixed Cloud SQL tuple.

### Root causes and key findings

- Core boot previously launched `sequelize.sync()` plus 43 unawaited DDL/data statements against
  its max-5 pool. That block is gone and a regression test prevents its return.
- Session-mode clients unnecessarily reserved database backends across idle Cloud Run sessions.
  Transaction mode now shares backends only while queries/transactions are active.
- Live preview/production audit found every expected Core model table, column, and index already
  present, no lowercase orphan, and no pending factory-country backfill. The migration therefore
  reconciles/asserts canonical state without a destructive drop.
- All services now use validated max-5/min-0 pools, bounded deadlines, application labels,
  readiness gates, ceiling-aware retry, and graceful owned-pool shutdown. The code audit found no
  prepared statements or session-local features that would require session affinity.

### Exact next steps

1. Uma (`devopswithkube`) reviews the four corrected PRs already assigned to
   her. **Pass when** Uma merges each to `develop`; the AI does not merge them.
2. Watch each normal production deployment. **Pass when** the latest revision is ready, carries
   its production application name, and logs `db_ready` before HTTP listen.
3. Run production login, token, Item Library, and Tracking smoke checks. **Pass when** all return
   200 and logs contain no acquire timeout, ceiling, startup fatal, forced shutdown, or relevant
   5xx.
4. Review Cloud SQL/Cloud Run connection telemetry after real production
   traffic. **Pass when** backend/client pressure stays within platform capacity
   and pool snapshots show no sustained waiters.
5. Complete the organization-backed IAM Deny + PAM gate described at the top of
   this handoff. **Pass when** the read-only acceptance script fully passes and
   an approval/expiry exercise changes no secret value.

### Constraints and gotchas

Keep transaction mode for hosted-Supabase nonproduction traffic, and keep the
current Cloud SQL production provider unless a separate migration is explicitly
approved. Pool max 5/min 0, idle 10s, evict 5s, keep-alive, and BFF normal
timeout 30s remain the guarded application settings. Never add app-repo/startup
DDL, broad session termination, unbounded pools, or session-local features
without an architecture review.

### Access and environment

`gh`, `gcloud`, `supabase`, and `op` were exercised successfully on this Windows machine.
Secrets and the test login are in 1Password vault `vibe_coding`; no value was logged or
committed. shared-db is on `main`; DesignFlow repos are on `sandbox-albert`. Preview ref:
`xjcyeuvzkhtzsheknaiu`; production ref: `qsllyeztdwjgirsysgai`; Cloud project:
`lithe-breaker-323913`, region `us-east4`.

### Open questions and risks

Open risks are (1) Albert's project Owner role retains direct secret-version
mutation until organization-backed Deny/PAM is active, and (2) a future feature
could silently depend on session affinity (prepared statements, temp tables,
session `SET`, advisory locks, LISTEN/NOTIFY, or cross-request state). Such a
feature must trigger an explicit connection-architecture review. No schema
rollback is needed: the reconciliation migration is additive/assertive.

---

## Active workstream — ERP mirror relocation (`fix_schema_for_api.md`)

### What this is
The Coldlion ERP data (items + production orders) is pulled from an external API and
mirrored into this database. Today the mirror sits in seven `public.*` tables with an
`erp_*` / `prod_order_*` name prefix — the legacy PopDAM location. We are relocating it
into the database's designed layers: raw pulls → `ingest.*`, typed authoritative mirror →
`plm.*`, browser/read contracts → `api.*`. This mirrors the already-proven customer path
(`plm.customer_import` → `plm.import_master_data()` → `core.customer` → `api.crm_customer_list`).

**The complete, detailed, 5-phase plan is [`fix_schema_for_api.md`](fix_schema_for_api.md)
(repo root).** It contains: exact current state (tables, row counts, columns, every inbound
dependency), what is correct vs. incorrect about the current design, the target design and
why, and the phase-by-phase migration with reversibility and risk notes. **Do not start ERP
schema work without reading it, and continue the phases in order.**

**The drill-down for the item→taxonomy resolver (Phases 2–4) is
[`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) (repo root).** This is the "items
aren't joined to the taxonomy" fix: `erp_items_current` stores `licensor_code`/`property_code`
as text with no FK, while the correct FK table `plm.item` exists but is empty. The plan is under
Kimi-K3 review → Codex implementation as of 2026-07-20 (now unblocked because `/items` returns 200
again). It carries the `(division, mg_type, code)` composite-key rule and the lapsed-license guard.

### Status
| Phase | State |
|---|---|
| 1 — Serving layer (`api.plm_item_list` + repoint `style_tracker_rows_with_bridge`) | ✅ **DONE, live in production 2026-07-15** |
| 2 — Stand up `ingest.*` + `plm.item_import` / `plm.production_order_import` + resolver (additive, no cutover) | ⏳ not started |
| 3 — Dual-write + backfill items (**first phase that touches live data**) | ⏳ not started |
| 4 — Cutover reads + repoint bridge FK to `plm.item` | ⏳ not started |
| 5 — Retire legacy `public.erp_*`/`prod_order_*` + build prod-orders native | ⏳ not started |

### Phase 1 — what shipped (done)
- Migration `supabase/migrations/20260715193000_erp_phase1_api_plm_item_list.sql`, PR
  [#70](https://github.com/u2giants/shared-db/pull/70) (merged), applied to preview then
  production (prod apply run 29445431196, success).
- Added `api.plm_item_list` (`security_invoker` view over `public.erp_items_current`,
  `external_id` exposed as `source_id`). Repointed `public.style_tracker_rows_with_bridge`
  to read ERP columns through it. **No behavior change** — pure decoupling.
- **Intentionally NOT done:** `plm.refresh_style_tracker_item_bridge()` still reads
  `public.erp_items_current` directly (it writes the physical ERP `id` into FK
  `plm.style_tracker_item_bridge.erp_item_id`; a view buys no decoupling). It moves in Phase 4.
- Evidence: [`docs/verification/erp-phase1-api-plm-item-list-20260715.md`](docs/verification/erp-phase1-api-plm-item-list-20260715.md).

### Next action (Phase 2)
Author a new additive migration creating `plm.item_import` and `plm.production_order_import`
(typed ERP mirrors modeled field-for-field on the existing `plm.customer_import`), confirm
`ingest.raw_record` / `ingest.sync_run` cover the item payload, and write
`plm.import_item_master_data(p_sync_run_id uuid)` modeled on `plm.import_master_data()`.
Additive only — nothing reads the new tables yet. Follow the shared-db protocol below.
**Verification gate for Phase 2:** the new objects exist on preview, `check-sql.sh` passes,
preview dry-run lists only the new migration, and no existing reader changes behavior.

### Open decision that blocks Phase 3 (not Phase 2)
The live item pipeline is **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API →
Supabase** (`source_system = 'designflow'`), **not** a direct Coldlion pull — the raw payload
is DesignFlow's shape, not Coldlion's `CLAPIServerEhp` shape. Phase 3 must choose: keep
sourcing through dflow (free merch-group → licensor/property enrichment) or pull Coldlion
`/items` directly (fresher, no dflow dependency, but re-implement enrichment). This also fixes
the `source_system` label choice. Analysis:
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md).

**DECIDED 2026-07-15 — Option B (direct Coldlion).** The full build plan, the item→taxonomy
wiring, and the taxonomy-table de-duplication analysis are in
**[`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md)**.
Highlights the next session must know:
- Sync becomes a Supabase **Edge Function in shared-db + `pg_cron`** (no Google Cloud), key in
  **Vault**, **data-only (no images — DesignFlow owns images)**, plus a new **weekly full
  reconciliation** to stop silent incremental drift.
- The strict parent-child **taxonomy already exists** in `core.*` (sourced from DesignFlow);
  the real work is wiring items to it with **FKs** (Coldlion `merchGroup05`=licensor,
  `merchGroup06`=property — confirmed). Coldlion does **not** expose the hierarchy.
- ⚠️ **Taxonomy "empty duplicate" cleanup is NOT a blind delete.** The empty snake_case tables
  (`core.merch_group`, `core.product_category/type/subtype`) are the *planned canonical target*
  per [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md), not strays.
  The genuinely-redundant set is the `dflow.*` taxonomy island (0 external FKs), pending a
  Sequelize-model check in the 6 `designflow-*` repos. **Open decisions block build — see
  Part F of the plan.**

---

## Active workstream — Coldlion customer/vendor hub cleanup + extension-table design (2026-07-17)

### What this is
The Coldlion ERP customers (836) and vendors (539) were imported into the shared hubs, then the
**customer** side was de-duplicated and status-curated. `core.customer` is now 859 rows
(**140 active / 12 potential / 707 inactive**) with short `display_name`s, a `core.customer_alias`
table, and `core.merge_customer()`. Status is app-owned (survives Coldlion re-pulls). CRM pickers
now show `display_name` and hide inactive customers.

### Reference docs (read these before continuing)
- **[`DB_Data_Admin.md`](DB_Data_Admin.md)** — **approved 2026-07-21 product and
  implementation plan** for the shared administrator application at
  `https://data.designflow.app`. The application is owned and developed in this repo
  (frontend: `apps/db-data-admin/`) and initially manages Customers, Vendors,
  Licensors, and Properties. It standardizes DB Data Admin on MIT RevoGrid Core with our
  own always-visible header filtering. DesignFlow keeps AG Grid; PopCRM's custom DataTable
  is legacy and should not become a third shared grid platform. **This plan supersedes the
  older direction below that placed the admin page in PopCRM. Implementation is underway;
  development is live at `https://data-dev.designflow.app`, while production remains gated.**
- **[`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md)** — the
  full customer dedup ruling ledger + final state (what merged, statuses, aliases, the Amazon
  1P/3P split, defects found).
- **[`docs/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md)**
  — the import/pipeline app-migration note.
- **[`fix_vendor_review.md`](fix_vendor_review.md)** (repo root) — detailed cold-start handoff to do
  the **vendor** (`core.factory`) equivalent (schema merged; curation pass pending, see Status below).
- **[`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md)** (repo root) — historical
  PopCRM-hosted admin-page proposal. **Do not implement its PopCRM ownership/location.** Its
  database-surface and cutover-safety research may still be useful, but
  [`DB_Data_Admin.md`](DB_Data_Admin.md) is now authoritative for product ownership, URL, grid,
  architecture, and delivery.
- **[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md)** —
  implementation plan for per-app extension tables (`crm/pim/dam/plm.customer_ext` etc.) so
  app-specific attributes never bloat the shared `core.*` tables. Decision made 2026-07-17,
  reviewed by Kimi K3.

### Status
- **Customers: DONE + merged** (shared-db PRs #83, #84, #85, #86, #88, #91, #94, #96; all applied
  to prod). CRM picker frontend (`picker-autocomplete-display-name`) is **MERGED** — there is no
  open popcrm-web PR (an earlier note here referencing "popcrm-web PR #3, open" was stale).
- **Vendors: SCHEMA MERGED, curation pending.** **shared-db PR #102 is MERGED** (commit `14da5c5`)
  — `factory.display_name`, `core.factory_alias`, `core.merge_factory` are all live. What remains
  is the **curation pass** (`fix_vendor_review.md` §6 steps 5–7): apply Albert's CSV rulings.
  Rulings received 2026-07-20:
    - `docs/vendor-review/vendor_multicode.csv` — statuses set (Action Printing INACTIVE, MIRAE
      ACTIVE, XIANJU SHAOFENG INACTIVE, XIANJU YINTAI ACTIVE, all "one vendor Y").
    - **"Not a factory" rows → PURGE from `core.factory` entirely:** ABF FREIGHT SYSTEM (205, 206),
      DIGITAL PHOTOGRAPHIC (16, 207), ANTHONY'S WAREHOUSE & DISTRIBUTION (458, ANT001), WALMART
      (369, 459 — actually a customer).
    - `docs/vendor-review/vendor_directus.csv` — **all 6 rows are garbage** (Directus test data:
      Bill, Chloe, Jerome, Lucy, Tom, Wendy Sunway); exclude all from `core.factory`.
  Next action: author one migration doing status-seed + purge, apply preview-first, merge.
  Full spec: [`fix_vendor_review.md`](fix_vendor_review.md).
- **Extension tables: DAM/CRM/PM implemented on preview; PLM uses a separate single-writer path.** Migration
  `20260721143000_dam_master_data_customer_id.sql` creates `dam.customer_ext`,
  `api.dam_customer_list`, the `/styles` “Originally Designed For” canonical Customer FK,
  safe backfill, and audit coverage. Migrations `20260722003000` through `20260722003400`
  add CRM/PM Customer and Vendor extensions plus DAM Vendor on preview. PLM stays Cloud-SQL-owned
  and must use the protected single-writer integration in `docs/db-data-admin-inventory.md`.
- **DB Data Admin: FOUNDATION IMPLEMENTED, FEATURE WORK PENDING.** The scaffold, development
  deployment, SSO routing, and preview-only foundation schema are complete as recorded in the
  dedicated active-workstream section above. Target production URL: `https://data.designflow.app`.
- Frontend "hide inactive" for **poppim-web / popdam3** pickers: not started (same pattern as
  popcrm-web PR #3).

---

## How to ship a shared-db schema change (the sanctioned flow, proven this session)

Full rules in [`AGENTS.md`](AGENTS.md) §4–§9. The mechanics that worked on 2026-07-15:

1. New timestamped file under `supabase/migrations/`. Never edit an applied migration.
2. `bash scripts/check-sql.sh` — needs `rg` on PATH (Git Bash lacks it; a bundled ripgrep
   exists at `.../AppData/Local/OpenAI/Codex/bin/*/rg.exe` — prepend its dir to `PATH`).
3. Branch + PR to `main`. PR CI runs only static SQL checks.
4. Apply to **preview** first, via GitHub Actions:
   `gh workflow run shared-supabase-migrations.yml -r <branch> -f target=preview -f mode=dry-run`
   then `... -f mode=apply`. (There is no auto-apply on merge; apply is always a manual
   `workflow_dispatch`.)
5. Merge PR → `main` (auto-syncs `shared-db/` into all consumer repos).
6. Apply to **production**: `gh workflow run ... -r main -f target=production -f mode=apply`.
7. Verify on production (Supabase MCP is bound to prod `qsllyeztdwjgirsysgai`).

Project refs: preview `xjcyeuvzkhtzsheknaiu`, production `qsllyeztdwjgirsysgai`.

---

## Completed earlier workstream — production schema reconciliation (2026-07-10)

Done and verified. The eight `20260710135*_reconcile_*` migrations are confirmed present in
the **production** `supabase_migrations.schema_migrations` history (checked 2026-07-15), so the
prior handoff's "promote reconciliation to production" loose end is **resolved**. Durable audit
note: [`docs/verification/production-schema-reconciliation-20260710.md`](docs/verification/production-schema-reconciliation-20260710.md).

## Carried-forward security item (verify, then close)

**Production DB password possible exposure.** During the 2026-07-10 reconciliation audit, a
Supabase CLI command printed the production DB password into local tool output (never
committed). It was flagged for rotation. **Status unverified as of 2026-07-15.** Action: check
the 1Password item `Supabase DB Password - shared POP database` (vault `vibe_coding`)
last-changed date; if it predates 2026-07-10, rotate it and update the item. If already rotated
after 2026-07-10, delete this section. Do not rotate the 1Password service-account token.

---

## Documentation completeness self-audit — 2026-07-22

### 1. Could a brand-new developer with no project or session context continue without questions?

**Yes.** The incident section at the top explains the business impact, the exact
Cloud SQL/`5432` versus Supabase/`6543` boundary, why the planning process failed,
which repo owns each layer, every live safeguard, every relevant PR/commit/build/
revision/alert identifier, Uma's two identities, the still-open Owner risk, and
five ordered next steps with explicit pass conditions. It routes to the full
incident record and the two canonical infrastructure documents rather than
requiring chat history.

The customer/vendor section also records the completed DAM customer-reference
migration, the still-pending app extension work, and routes the developer to the
authoritative `DB_Data_Admin.md` implementation plan. That plan contains the
product scope, data ownership rules, security model, audit/merge semantics,
delivery order, verification gates, repository boundaries, and the required
eventual deletion of the superseded visual-admin planning file.

The dedicated DB Data Admin workstream now records the actual post-implementation state:
merged PRs, preview-only migrations, live development SHA, failed attempts, exact next steps,
security/deployment boundaries, and remaining production risks. It replaces the stale
“plan only” statement that would otherwise send a fresh developer backward.

### 2. Could that developer continue as effectively as the current session?

**Yes.** They have the implementation evidence (9 infrastructure fixtures; 109
suites / 741 tests; deliberate failed build; zero-traffic production revisions;
24-resource IAM apply; zero-drift plan; HTTP 200), the exact identities and
scopes of both writer service accounts, the 1Password note identifier, the
current PR-review owner, and the precise organization/PAM/Deny acceptance test.
They also know which tempting shortcuts are forbidden and why the hard gate was
not forced through a standalone project.

For DB Data Admin, they also have the decisions reviewed by Kimi K3, the completed
first prerequisite (the centralized mirror excludes and purges top-level `apps/`,
with an automated boundary check on every consumer sync), and
an ordered implementation sequence that distinguishes completed schema work
from planned work.

### 3. Is every relevant detail needed for flawless execution present?

**Yes, after revision.** The first audit found and corrected four gaps: the
handoff still described all environments as hosted Supabase, still treated the
unsafe unsuffixed version as a valid atomic transition, omitted the 24 live IAM
resources and alert evidence, and did not explain the Deny Admin/PAM
organization constraint. The current top section and linked incident/runbook now
include background, goal, intended outcome, current live state, failed attempts,
root causes, ownership, constraints, risks, access boundaries, exact next
actions, and a verification gate for every remaining action. No secret value is
present.
