# Master Data and DesignFlow reference-data cutover handoff

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

The next session must show Albert this whole list in one message before the first irreversible change. None of these decisions blocks the read-only comparison work in Steps 1 through 6.

### Blocking before the first Depth and Size production cutover

1. **Who besides administrators may edit Product Depth values?** Recommendation: start with administrators only, then add named people through the database-managed `product_depth_admin` permission. This blocks enabling the editor for non-administrators, but does not block building or testing it.
2. **May inactive ColdLion MG04 sizes be chosen for new items?** Recommendation: always show them on existing items, but hide them from new selections unless Albert explicitly approves them. This blocks the final Size picker rule.
3. **How should PopDAM save Depth on a linked DesignFlow item?** Recommendation: use DesignFlow Item Master so its existing permission, validation, and audit rules remain in charge. Use a shared audited database function only if the comparison proves Item Master cannot support the write safely. This blocks the PopDAM write cutover.

### Blocking only before later Phase 2 field cutovers

4. **Ambiguous Packaging Type, Creative Designer, and Vendor mappings.** Recommendation: approve only the small exception list produced by the comparison reports. Exact ID-backed matches need no manual review. This does not block Carlos's Depth fix.

### Already settled, do not re-ask

- **2026-08-07:** `core.product_depth` is the canonical shared Depth table.
- **2026-08-07:** DesignFlow's current `itemDepth` data seeds `core.product_depth`; old IDs are preserved as source references.
- **2026-08-07:** Product Depth is maintained in DB Data Admin at `data-dev.designflow.app`, with database-enforced access and audit history.
- **2026-08-07:** A guarded server-side ColdLion importer populates `core.product_size` from MG04. It defaults to dry-run and stops on incomplete or dangerous changes.
- **2026-08-07:** DesignFlow sandbox's Supabase setup is the model for production. Production still requires the controlled Cloud SQL-to-Supabase migration gates.
- **2026-08-07:** The first release is Depth plus Size. Packaging Type, Creative Designer, and Vendor/Factory may be Phase 2.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager. Its Master Data screen holds SKU and style-tracker information. The React app is in `u2giants/popdam3`, locally `/worksp/popdam`, and production is `https://dam.designflow.app/styles`.

DesignFlow PLM is the operational item system. Item Library and Item Details hold the same products used by PopDAM. Its six private repositories are under the `popcre` GitHub organization: `designflow-frontend`, `designflow-item-master`, `designflow-backend`, `designflow-bff`, `designflow-tracking`, and `designflow-data-syncing`. Sandbox is `https://alsand.designflow.app`. DesignFlow work uses Albert's sandbox branch and PRs to `develop`; Uma reviews and merges.

The apps share hosted Supabase project `qsllyeztdwjgirsysgai`. The canonical database repository is `u2giants/shared-db`, locally `/worksp/shared-db`. It also contains DB Data Admin in `apps/db-data-admin/`; development is `https://data-dev.designflow.app`.

ColdLion is the ERP source for merchandise groups and vendors. MG04 means the merchandise-group field used for Product Size.

## 2. What we set out to do this session, and why

Carlos changed Depth in PopDAM from `0.5"` to `0.63"`, pressed Enter, and nothing changed. PopDAM currently treats Depth as if it were Product Size, so it validates the value against the wrong list. DesignFlow already has a separate `itemDepth` lookup. Both applications must use one shared Depth table so the same item cannot have conflicting values.

The task expanded into a comparison-and-cutover plan for five shared fields:

1. Packaging Type: compare DesignFlow's hard-coded list with `core.packaging_type`.
2. Product Size: compare DesignFlow MG04 with `core.product_size`, then populate it through a guarded ColdLion MG04 importer.
3. Creative Designer: compare DesignFlow creative-designer assignments with `core.creative_designer`.
4. Factory/Vendor: compare DesignFlow Vendor values with ColdLion-backed `core.factory`.
5. Depth: create `core.product_depth`, import DesignFlow `itemDepth`, add a restricted DB Data Admin editor, and point both apps at it.

This session wrote and refined the implementation plan. It did not change application code, shared database schema, production data, or deployments.

## 3. Current state, what is true right now

The authoritative plan is `/worksp/popdam/plan_master_data_designflow_reference_cutover.md`. Read its STATUS table first and begin at the first open step. All 11 steps remain open because this session was planning only.

The final plan is committed and pushed to `u2giants/popdam3` `main` at commit `2c2579ec248ce56afbb7ef7cdf7d2323fac2ded7`. GitHub checks passed:

- CI: `https://github.com/u2giants/popdam3/actions/runs/31182799614`
- Forbid Shared DB Bypass: `https://github.com/u2giants/popdam3/actions/runs/31182798842`
- Shared DB guard: `https://github.com/u2giants/popdam3/actions/runs/31182798845`

The plan records these verified facts:

- DesignFlow sandbox environments already use shared Supabase PostgreSQL through the managed pooler and a five-secret database setting set. Production still uses Cloud SQL. The sandbox setup is the proven production model, but production migration needs schema, connection, load, rollback, and deploy gates.
- DB Data Admin lives in `/worksp/shared-db/apps/db-data-admin/`, even though its URL is DesignFlow-branded.
- The first release boundary is Depth plus Size. See the plan section `Release boundary: required now versus Phase 2`.
- Product Depth maintenance uses DB Data Admin, not a second active administration screen in DesignFlow.

No shared-db migration or app implementation was started. No secrets were read, created, changed, or printed.

The `/worksp/popdam` working copy contains many unrelated changes from concurrent sessions. Do not stage, discard, rewrite, or commit them as part of this work. The root `HANDOFF.md` is a legacy full handoff and is currently modified by another session, so this session deliberately did not migrate or edit it.

## 4. Everything we tried that did not work

1. **Assuming `core.product_size` and an MG04 importer already existed.** Kimi's detailed review found that the canonical migration and importer had not been proven. The corrected plan now requires inventorying the production migration ledger, creating the table if absent, and proving the direct ColdLion feed before applying data.
2. **Treating DesignFlow's MG04 mirror as proof of the ColdLion feed.** DesignFlow contained MG04 rows, but that does not prove the direct ColdLion endpoint is complete or paginated correctly. The corrected plan compares the direct feed with the mirror and all live item references before the first write.
3. **Leaving the Depth table name and administration home open.** That would let implementation sessions re-debate the architecture or create two writers. Albert settled `core.product_depth` and DB Data Admin as the one maintenance UI.
4. **Treating production Supabase use as a single connection-setting change.** Sandbox proves the model, but production currently uses Cloud SQL. A one-setting flip could break connection limits, transactions, or missing schemas. The plan now requires the wider controlled database migration gate.
5. **Writing the session closeout into root `HANDOFF.md`.** The root file is legacy and already modified by another session. Editing it could overwrite concurrent work, so this write-once file was created instead.

## 5. Root causes and key findings

1. PopDAM has no true Depth field. Its current edit path mixes dimensions and depth into Product Size, so `0.63"` can be rejected even though it is a valid Depth. The business fix is a distinct canonical Depth identity, not looser text validation.
2. DesignFlow Item Details has a dedicated Depth picker backed by its `itemDepth` contract and stores a legacy `item_depth_size` label. The migration must preserve every referenced legacy value and ID before switching consumers.
3. Names are labels, not safe identities. Depth and Size need stable canonical UUIDs plus old-source references. Legacy text stays temporarily as a compatibility shadow.
4. A ColdLion importer can damage valid sizes if the API returns a partial page or changed payload. It must default to dry-run, prove pagination and counts, record source snapshots, reject unknown payloads, enforce delete/deactivate thresholds, lock to one run, and be idempotent.
5. DB Data Admin already supplies the right model for protected reference-data editing: database role checks, protected functions, expected-update checks, and audit history. Product Depth should reuse those patterns.
6. The DesignFlow BFF remains an HTTP proxy. Production's Supabase migration must not turn it into a new database layer.
7. Packaging Type, Creative Designer, and Vendor/Factory findings are important but do not block Carlos's Depth fix if their cutovers are explicitly deferred to Phase 2.

## 6. Exact next steps

1. Read `/worksp/popdam/AGENTS.md`, the root `HANDOFF.md` pointer/legacy state, all OPEN files in `/worksp/popdam/HANDOFF.d/` newest-first, and `/worksp/popdam/plan_master_data_designflow_reference_cutover.md` in full. **You'll know it worked when you can name the first open STATUS row and the required-now versus Phase 2 boundary.**
2. Show Albert all four decision groups in section 0 in one message. Do not ask them one at a time. Continue read-only inventory while waiting because none blocks Steps 1 through 6. **You'll know it worked when each decision is recorded or clearly marked deferred to its stated gate.**
3. Follow Step 1 of the plan. Check dirty state in PopDAM, `/worksp/shared-db`, and all six DesignFlow repositories before edits. Do not touch another session's files. Verify authenticated GitHub, Supabase CLI, and read-only database access. Serialize any 1Password reads. **You'll know it worked when the baseline names the exact database, schema, table, writer, consumer, row count, and query for every source.**
4. Prove whether `core.product_size` and its source-reference contract exist in the canonical shared-db production migration ledger. Do not infer from docs or generated types. **You'll know it worked when the verification artifact cites the exact applied migration or records that creation is required.**
5. Run the six read-only comparisons in plan Steps 2 through 6. For MG04, call ColdLion through server-side tooling, prove all pagination, and compare the direct response with DesignFlow's MG04 mirror and every live item reference. For Depth, compare authoritative production `itemDepth`, its Supabase copy, and every stored item label. **You'll know it worked when every input row and every live reference resolves exactly once or appears in a named exception list.**
6. Stop for a fresh session at Natural Context Cut Point A. Present Albert only ambiguous mappings, with usage counts and one recommendation each. **You'll know it worked when the approved mapping fixtures are dated, versioned, and contain no undocumented fuzzy match.**
7. Start shared-db implementation only on a dedicated `/worksp/shared-db` branch, following its AGENTS.md preview-first workflow. Create/repair `core.product_size`, guarded MG04 ingestion, `core.product_depth`, source references, audit history, protected functions, item links, and the DB Data Admin Product Depth grid. **You'll know it worked when preview tests prove allowed and denied users, audit history, importer safety, complete source references, and rollback.**
8. Merge and apply shared-db through its branch, PR, preview, production path before dependent app code. Then cut DesignFlow on Albert's sandbox branch, obtain Uma's merge to `develop`, and verify sandbox and production SHAs. **You'll know it worked when existing items retain Size and Depth labels and production parity has no missing values.**
9. Cut PopDAM over last. Reproduce Carlos's exact `0.5"` to `0.63"` Depth edit, reload both applications, and verify the same stable Depth identity appears in both. **You'll know it worked when the value survives reload in PopDAM and DesignFlow, and failed saves visibly restore the old value.**
10. Run the parity soak before deleting legacy fields or endpoints. Phase 2 fields may begin only when their own mapping gates pass. **You'll know it worked when the full soak has zero unexplained mismatches and no retired path receives writes.**

## 7. Constraints and gotchas in force

- Shared database changes belong only in canonical `/worksp/shared-db`, on a branch with preview, PR, AI merge, and production ledger proof. Never add shared migrations under PopDAM.
- DesignFlow work stays on `sandbox-albert` or `albert-2sandbox`, targets `develop`, and is merged by Uma. Never work on or merge to DesignFlow `main`.
- PopDAM app work normally lands on `main`.
- Before the first commit in any repo, `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>`.
- Do not edit, stage, discard, or commit unrelated dirty files. Several concurrent workstreams share `/worksp/popdam`.
- Never edit another session's `HANDOFF.d/` file. Never rewrite the legacy root handoff while another session may be changing it.
- Production and shared cloud infrastructure are read-only unless Albert explicitly authorizes the exact mutation. Normal shared-db production apply is allowed only through the repository's approved workflow after preview and PR gates.
- Secrets live only in 1Password vault `vibe_coding`. Serialize reads. Never print or commit values.
- Do not silently fall back to hard-coded lookup lists after cutover. A failed shared lookup must show a clear error.
- Additive migration first, backfill second, consumer cutover third, retirement after soak.
- Existing inactive MG04 values must remain visible on items even if they cannot be selected for new items.
- DB Data Admin write access must be enforced by the database, not only by hidden buttons or hard-coded emails.

## 8. Access and environment

- Current machine: `hetz`.
- PopDAM repository: `/worksp/popdam`, GitHub `u2giants/popdam3`, production `https://dam.designflow.app/styles`.
- Shared database repository: `/worksp/shared-db`, GitHub `u2giants/shared-db`.
- Shared Supabase production project: `qsllyeztdwjgirsysgai` in Virginia. Do not use the decommissioned Ohio project `ryltkzzernhwnojzouyb`.
- DB Data Admin source: `/worksp/shared-db/apps/db-data-admin/`; development URL `https://data-dev.designflow.app`.
- DesignFlow sandbox: `https://alsand.designflow.app`.
- GitHub CLI was authenticated and successfully read/pushed `u2giants/popdam3` during this session. Reverify before use.
- Supabase and ColdLion credentials were not read in this session. Their location is 1Password vault `vibe_coding`; the ColdLion item is `Coldlion ERP API key x5.coldlion.com`.
- Exact Supabase CLI, pooler, preview, and production credential commands are in `/worksp/shared-db/AGENTS.md`, section `Supabase CLI and database credential runbook`.
- The plan's read-only DesignFlow evidence used the `develop` snapshots listed in its Current State section. Recheck current `develop` before implementation.

## 9. Open questions and risks

1. **Authoritative first Depth snapshot, open 2026-08-07.** Current evidence says production `itemDepth` is in Cloud SQL while sandbox uses Supabase. Step 1 must prove the live writer and exact snapshot time before import.
2. **Direct ColdLion MG04 completeness, open 2026-08-07.** The endpoint, request shape, division coverage, and pagination must be proven against DesignFlow's mirror. A partial response must stop the importer.
3. **Production DesignFlow migration scope, open 2026-08-07.** Sandbox proves Supabase works, but production migration may expose schema or connection differences. Do not narrow this to a credential swap.
4. **Product Depth maintainer list, owner decision.** Administrators-only is the safe default until Albert names additional people.
5. **Inactive MG04 selection policy, owner decision.** Existing items must display them. New selection should default to active/approved values only.
6. **PopDAM linked-item write path, owner decision.** DesignFlow Item Master is recommended to keep its rules and audit trail.
7. **Concurrent workspace risk.** The local PopDAM working copy is heavily dirty from unrelated sessions. Use file-specific staging or a clean temporary worktree and never clean/reset broad paths.

## Self-audit

Passed on 2026-08-07. All sections 0 through 9 are present. Section 0 consolidates every owner decision and records settled choices. Sections 3 and 8 give exact commits, checks, repositories, URLs, and access state. Section 4 records every failed assumption and why it failed. Section 5 preserves the non-obvious findings. Every action in section 6 has a verification gate. Sections 7 and 9 capture branch, database, security, concurrency, and rollout risks. No secret value is included. A new session can begin read-only Step 1 without asking for missing context.
