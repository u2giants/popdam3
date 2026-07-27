# HANDOFF — shared-db current state

## FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-3 UI SHELL

**Date:** 2026-07-27
**Status:** PSG-3 pending-only UI shell deployed and healthy; stop before PSG-4
**Shared-db checkout:** `C:\repos\shared-db`, `main` at `78d0130`, with three verified
closeout files modified locally because this restricted session could not write `.git` and the
GitHub branch action was not approved
**PopDAM checkout:** `C:\repos\popdam3`, `main`, clean at `b4bf454b`
**Database writes / migrations / rebuilds / activation:** none

### What this work is

PopSG is POP's internal licensor style-guide library. Folder-derived Licensor and Property names
currently drive deterministic tags. This workstream reconciles those observed names to canonical
master data without cross-Licensor matches or silent tag loss. PSG-3 is the administrator review
screen only. PSG-5 owns future database contracts and preview rebuild behavior.

### Exact owner approval

Albert approved only `batch-01-exact-existing`, 51 rows covering 44,331 files, SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
The immutable record is
`docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json`.

This approval does not cover batch 02, canonical creates, the 6,961 at-risk removals, schema or
mapping activation, database writes, migrations, rebuilds, deployment, production, PSG-4, or any
later phase.

### Current state

PopDAM has the frozen 372-row / 216,417-file pending-only UI shell at Settings → File Tags →
Property reconciliation. It shows five separate business queues, filters, bounded redacted
path evidence, canonical candidate/parent proof, exact owner hash and exclusions, affected-file
preview, and a stable pending-decision export. Administrator preparation is restricted to
same-parent exact-existing rows in the approved batch. Viewer/designer cannot prepare or export.
All proposals stay in browser memory and disappear on refresh or role downgrade. No activate
action or backend adapter exists.

Verification passed: 19 focused tests, all 93 PopDAM tests, production build, seven
headed-Chromium screenshots, and zero browser console errors. The screenshots and complete
evidence are under `docs/verification/popsg-property-reconciliation-20260727-psg3/`.

Albert approved the pending-only UI deployment after the evidence PR merged. PopDAM commits are:

- `e72ec107`: PSG-3 pending-only UI shell;
- `8d8ce361`: direct `@testing-library/dom` test dependency;
- `b4bf454b`: Bun 1.3.14 lockfile regeneration.

CI run `30263977784` passed. Final publish/deploy run `30264180552` passed from
`b4bf454bd7d660dcc375001549324f418667663d`. The running Coolify container was healthy and used
image digest `sha256:a850c64f3a5ead1c26f5a20b405e1bb22697507516e333c10b628b26721a6684`,
which exactly matched the published GHCR `latest` digest. Both `https://dam.designflow.app` and
`https://sg.designflow.app` returned HTTP 200.

Two Grok reviews required corrections. The final Grok follow-up returned PASS with no Critical,
High, or Medium findings.

### Failed paths that must not be repeated

1. Windows CRLF made raw PSG-0/1 hashes look wrong. Canonical LF bytes match every signed manifest.
2. A no-write scan over the data fixture matched ordinary text. Scan executable source only.
3. The dev role switcher initially retained administrator memory after switching to designer.
   Pending memory now clears on downgrade and export disables.
4. The first create screenshot retained a search filter. The final screenshot shows both locked
   ColdLion Phase 5 candidates.
5. The first Grok review found overclaimed phase status, a dead ambiguity filter, unsafe
   mixed-Licensor export, incomplete signed-key enforcement, thin security tests, and hidden rows.
   The code now fails closed, derives the signed key set, tests the boundaries, and exposes all
   rows through paging.
6. The second Grok review found a stale prepare-dialog screenshot plus three hardening gaps.
   The screenshot now starts empty on Winnie the Pooh / 6,887 files; synthetic off-key rows fail
   closed; parent proof text is conditional; and a started set immediately locks other Licensors.
7. The first GitHub CI run failed because npm had supplied `@testing-library/dom` indirectly but
   Bun's frozen install did not. Declaring it directly fixed dependency ownership.
8. Hand-editing only the Bun root dependency was insufficient. Bun rejected the missing package
   record. Regenerating `bun.lock` with the same Bun 1.3.14 used by CI fixed the lock permanently.

### Exact next steps

1. From a normal-authority session, create branch
   `codex/popsg-psg3-deploy-closeout-20260727`, commit `HANDOFF.md`,
   `fix_popsg_property_taxonomy_reconciliation.md`, and
   `docs/verification/popsg-property-reconciliation-20260727-psg3/source-hashes.json`, then open,
   check, and merge the docs-only shared-db PR.
   **Pass when:** `main` contains the closeout and the shared-db consumer-sync workflow is green.
2. Obtain Albert's explicit instruction to start PSG-4.
   **Pass when:** the current chat says to start PSG-4.
3. Execute PSG-4 as decision-package work only: preserve the frozen proposal hash, add reviewer
   and timestamp evidence, and keep canonical creates at zero unless separately named.
   **Pass when:** every proposed approved row has disposition, reason, parent evidence, reviewer,
   and timestamp, with no changed proposal bytes.
4. Do not activate mappings or write either database in PSG-4. Database contracts, RLS, RPCs,
   persistence, and preview rebuild proof remain PSG-5 work under separate authority.
   **Pass when:** PSG-4 produces no migration, database write, rebuild, or deployment.
5. Stop at PSG-4's exact-hash owner decision gate.
   **Pass when:** Albert receives one business-readable package and no later phase has started.

### Constraints and moving state

- The accelerated ColdLion plan still shows Steps 1–10 open. Production Phase 7 is forbidden.
- CHEERS and THE EXORCIST remain locked and routed to ColdLion Phase 5.
- `the lion king` remains ambiguous and locked.
- The 6,961-row signed risk file remains evidence only.
- PSG-5 must decide all eight hard-coded Licensor aliases and take a fresh worker behavior baseline.
- PSG-6 still needs the moving ColdLion checkpoint, Albert sign-off, and a named production window.
- ColdLion Phase 6 does not block PSG-4 decision-package work. It blocks later preview/production
  cutover gates.
- The PSG-3 plan text names RLS/RPC/preview proof in its full gate, while PSG-5 owns those objects.
  Treat that proof as a PSG-5 entry/exit obligation, not permission to add backend work to PSG-4.

### Access and environment

No new secret value was encountered. GitHub and Coolify used their existing stored credentials.
Canonical database refs remain preview `rjyboqwcdzcocqgmsyel` and production
`qsllyeztdwjgirsysgai`; PSG-3 did not connect to either.

### Self-audit

The fresh-developer handoff audit passes:

1. A newcomer can continue with no questions because this section records the application,
   approval, deployed commits, CI/deploy evidence, current gate, and exact next action.
2. A newcomer can continue as effectively as this session because the frozen hashes, role and
   activation limits, ColdLion boundary, and every PSG-4 verification condition are explicit.
3. Failed attempts are preserved with causes and permanent fixes, including both Grok correction
   rounds and the two Bun/CI dependency failures.
4. Every next step is concrete and has a pass condition.
5. Every path, URL, phase boundary, commit, run, and digest needed to resume is named.

---

## FRESH-SESSION BOUNDARY — PopSG Property reconciliation PSG-2 AT OWNER GATE

### 1. What this application is

PopSG is the style-guide library at `https://sg.designflow.app`, served by
`u2giants/popdam3`. NAS crawlers record folder-derived Licensor and Property observations in the
shared Supabase production project. `u2giants/shared-db` owns the canonical Licensor and Property
catalogue used by PopSG and every other POP application.

### 2. What this session set out to do, and why

The session executed PSG-2 only from
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
It had to turn every signed PSG-1 observation into one deterministic proposal, preserve the
6,961-row at-risk set unchanged, prove parent scoping and strict rule order, prepare an immutable
owner decision package, and stop before schema, UI, activation, or PSG-3.

### 3. Current state

The corrected proposal package passed its second Grok review with no Critical, High, or Medium
findings. PSG-2 remains draft and incomplete at Albert's exact-hash gate:

[`docs/verification/popsg-property-reconciliation-20260727-psg2/`](docs/verification/popsg-property-reconciliation-20260727-psg2/README.md)

- All eight PSG-1 artifact Git blobs match their signed manifest.
- The immutable at-risk input remains 6,961 rows with SHA-256
  `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- Every one of 372 inventory rows has exactly one proposed disposition.
- All 216,417 active file occurrences are represented exactly once.
- Proposed rows/files are: exact existing 51/44,331; non-Property 36/20,309; create candidate
  2/293; ambiguous 43/33,416; deferred 239/118,067; Licensor unresolved 1/1.
- Approved-alias, Disney Classics, and documented no-code exact proposals are each zero.
- There are zero cross-parent proposals, fuzzy-selected targets, unresolved-Licensor Property
  proposals, and activated/effective decisions.
- Every proposal requires owner activation. Automatic classification is recorded separately.
- Every existing target is checked against authoritative parent edges and includes canonical code
  and parent ID. Missing or wrong parent/name/code proof fails closed.
- Proposal ledger SHA-256:
  `cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4`.
- Owner batch-index SHA-256:
  `78afa12f5edf4ac56f00d8fad592b6c6c2bcb128730ed5c837ad29270931976d`.
- Recommended first bounded decision:
  `batch-01-exact-existing`, 51 rows / 44,331 files, SHA-256
  `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
- The owner index includes non-approvable `batch-06-at-risk-observation`, which points to the
  immutable 6,961-row PSG-1 risk file and signed hash. It cannot approve removals.
- Two proposed create candidates, `CHEERS` / `CHR` and `THE EXORCIST` / `EX`, are exact
  overlaps with the existing ColdLion Phase 5 ledger. No create is approved.
- `the lion king` affects 521 files but remains open because the approved owner-list text is
  `lion king`; it also has multiple same-parent reviewer candidates, so it is `ambiguous`.
- ColdLion Phase 6 remains IN PROGRESS on preview. Accelerated readiness Steps 1–10 remain open.
- PSG-1's PopDAM worker hash used raw CRLF working-tree bytes:
  `1fe0f7214cabf15bd0cd5035c95897d40f18c8990172fa394bfb654c796f2ce3`.
  The current canonical LF hash is
  `76579ecba08ae1a5207bbe2f2d3a4e23a8979ad050ceb69cff11dba29c75d255`;
  reconstructed CRLF reproduces PSG-1 exactly, so no behavior drift is present.
- PSG-2 made no database query/write, migration, rebuild, deployment, canonical creation,
  proposal activation, fuzzy automatic mapping, or PopDAM UI/code change.

### 4. Everything tried that did not work

- Direct working-tree hashes failed because Git checked text files out with Windows CRLF endings.
  The exact Git blobs matched every PSG-1 hash. The final engine canonicalizes CRLF to LF before
  verifying immutable inputs.
- The first summary inferred at-risk removals from an inventory aggregate and got 7,182 instead
  of 6,961. That aggregate includes accepted relationships beyond the signed removal set. The
  final engine counts rows in the immutable at-risk CSV.
- The first deterministic rerun test used the wrong in-memory shape. The corrected test reruns
  the generator from the signed files and compares output bytes.
- The first Grok review found that parent safety was asserted as a constant, create candidates
  accepted bare codes, the copied normalizer changed ampersand behavior, activation authority was
  unclear, and fixture/hash coverage was too weak. All are corrected in the current draft.
- After PR #256 merged, a clean Windows checkout exposed a test-only CRLF mismatch: the source
  comparison normalized PSG-1 but not the loaded normalizer. The follow-up canonicalizes both
  strings. Proposal rows, owner batches, and their frozen hashes did not change.

### 5. Root causes and key findings

- Same-parent deterministic evidence settles only 51 rows. Similarity hints cannot settle the
  remaining observations.
- The strict approved Classics list produces no exact proposal. Owner review must decide whether
  `the lion king` is the same approved title as `lion king`; code must not assume it.
- Fifteen blank Property observations are explicit non-Property candidates rather than silent
  gaps. Twenty-one more rows came from PSG-1 structural-pattern evidence.
- The two PopSG create candidates already exist in ColdLion's Phase 5 candidate set. A separate
  PopSG create ledger would duplicate authority and violate the plan.
- Phase 5 create candidates now match exact normalized names only. Codes are metadata.
- None of the 6,961 at-risk removals is approved. The signed file remains risk evidence only.
- The eight hard-coded Licensor aliases remain unresolved future authority work for PSG-5.
- PSG-5 must take a new worker behavior baseline if the canonical content hash changes.

### 6. Exact next steps

1. Present the exact owner batch index to Albert.
   **Pass when:** he names an exact batch ID and SHA-256 and explicitly approves or rejects it.
2. Recommended first decision: review `batch-01-exact-existing.csv`.
   **Pass when:** Albert accepts or rejects SHA-256
   `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
3. Keep `batch-02-non-property` separate because it needs business review.
   **Pass when:** each approved row is covered by an unchanged human-approved hash.
4. Route `batch-03-create-candidates` through ColdLion Phase 5 only.
   **Pass when:** no second ledger exists and no create occurs without separate owner approval
   plus an approved parent.
5. Do not start PSG-3 until the plan's owner gate passes.
   **Pass when:** approval is durable and bound to an unchanged batch hash.

### 7. Constraints and gotchas

No proposal activation, schema, migration, canonical creation, preview/production write, rebuild,
deployment, fuzzy automatic mapping, or PopDAM UI change is authorized. Do not treat
`batch-04-open-review` as mappings. Do not approve mixed dispositions in one bulk action. PSG-5
still needs the Licensor-alias decisions. PSG-6 cannot overlap ColdLion Phase 7.

### 8. Access and environment

Shared-db branch: `codex/popsg-property-psg2-20260727`. Phase-start shared-db base:
`f530c424b00ddd91eef4c0f8d172eeb451551f82`. PopDAM main was clean and fast-forwarded to
`c8ce9624`; PSG-2 changed no PopDAM source. Production ref: `qsllyeztdwjgirsysgai`. Preview ref:
`rjyboqwcdzcocqgmsyel`. No secret was read, printed, or committed.

### 9. Open questions and risks

Albert has not approved any PSG-2 batch. The most important open title is `the lion king`
(521 files). The 36 non-Property candidates need business confirmation. Cheers and The Exorcist
need the existing ColdLion Phase 5 create/parent decision if they are ever to become canonical.
ColdLion accelerated readiness remains a moving parallel workstream and must be rechecked before
every later PSG phase.

### PSG-3 through PSG-7 forward-impact audit

- PSG-3 must show the five immutable queues separately, route create candidates to Phase 5, and
  keep `the lion king` ambiguous. It must separate automatic classification from owner activation.
- PSG-4 must approve exact unchanged hashes.
- PSG-5 has no approved at-risk removal subset, must keep batch-06 non-approvable, and still owns
  all eight Licensor aliases. It must rebaseline if PopDAM worker behavior changes.
- PSG-6 remains blocked by ColdLion checkpoint/sign-off and a production window.
- PSG-7 must report zero alias/Classics/no-code proposal categories honestly.
- No other later-phase assumption, sequence, rollback, or production boundary drifted.

### Handoff self-audit

Passed after the second Grok review on 2026-07-27. Residual notes are non-blocking owner/phase
gates, not code findings. A developer with no chat context can identify the application, goal,
signed inputs, exact proposal state, failed attempts, root findings, owner gate, constraints,
access boundary, downstream impact, and next verifiable action.

## Prior boundary — PopSG Property reconciliation PSG-1 COMPLETE

### 1. What this application is

PopSG is the style-guide library at `https://sg.designflow.app`, served by the PopDAM codebase
`u2giants/popdam3`. NAS crawlers record folder-derived Licensor and Property observations in the
shared Supabase production project. `u2giants/shared-db` owns the canonical Licensor and Property
catalogue used by PopSG and every other POP application.

### 2. What this session set out to do, and why

Albert asked for PSG-1 evidence work only from
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
The goal was to build a reproducible read-only inventory, balance every active file in the
required 2×2 matrix, enumerate the accepted tags threatened by safe parent scoping, measure the
eight Licensor aliases, and stop before proposals or implementation.

### 3. Current state

PSG-1 is complete. The authoritative package is
[`docs/verification/popsg-property-reconciliation-20260727-psg1/`](docs/verification/popsg-property-reconciliation-20260727-psg1/README.md).

- Production still has 216,417 active files. The count did not drift from PSG-0.
- The 2×2 current-behavior matrix balances exactly to all 216,417 active files.
- Cells are 50,927 resolved/resolved, 165,489 resolved/unresolved, 0 unresolved/resolved, and
  1 unresolved/unresolved.
- The inventory has 372 normalized rows. One row has an unresolved Licensor and no candidates.
- Parent-scoped exact name/code matching safely resolves 44,331 file occurrences in 51 rows.
- `currently-tagged-at-risk.csv` contains all 6,961 accepted global exact-name relationships
  that parent scoping would remove. All are cross-parent matches.
- The signed at-risk SHA-256 is
  `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- All eight Licensor alias counts reproduce PSG-0. None contributes an at-risk relationship.
- The extractor has a unit test and exports no full path or filename.
- `source-hashes.json` verifies every PSG-1 output plus the extractor, test, normalizer, and
  PopDAM worker source.
- ColdLion Phase 6 remains IN PROGRESS on preview. The latest non-drill comparison passed.
  Forced-failure drill rows are correctly marked. Production remains untouched by Phase 6.
- PSG-1 changed no PopDAM file and caused zero database writes.

### 4. Everything tried that did not work

- The first preview secret reference used the long item title. Parentheses made that reference
  fail parsing. The final run used the stable 1Password item ID and printed no secret.
- The first preview query assumed parent columns on `plm.erp_property`. ColdLion does not supply
  the parent relationship, so those columns do not exist. The final extractor uses only an
  already-linked canonical Property to obtain parent evidence.
- The first status query used friendly field names instead of the real Phase 6 column…29724 tokens truncated… does not merge them.
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
  own header filtering — since 2026-07-23 a per-column **Multi Filter (Text + Set)**, see
  [`docs/db-data-admin-column-multi-filter.md`](docs/db-data-admin-column-multi-filter.md).
  DesignFlow keeps AG Grid; PopCRM's custom DataTable
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

### Sample Tracking workstream self-audit (2026-07-22)

1. **Is this handoff comprehensive enough for a brand-new developer with no project knowledge or
   chat context? Yes.** The active Sample Tracking section explains the application and four-piece
   split scenario, names the authoritative plan, states the exact plan-only status, identifies the
   omitted table and concurrent-insert defect, and gives the first verification gate. The linked
   plan's Sections 1–4 provide complete background and decisions.
2. **Could that developer continue as effectively as the originating session? Yes.** The handoff
   preserves both failed publication paths and the eventual clean GitHub path; the plan's Sections
   5–13 preserve the data contract, conservation rules, tenancy, legacy policy, migration sequence,
   preview procedure, tests, rollback, and observability knowledge.
3. **Is every relevant detail needed for flawless execution present? Yes.** The plan's Section 14
   gives ordered next steps with a success gate for each; Sections 15–16 preserve open decisions and
   definition of done; the handoff names environments, the exact restore migration and runtime
   error, access location without secret values, and explicitly distinguishes a merged plan from
   authorization to mutate preview or production.

