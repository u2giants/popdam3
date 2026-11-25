---
summary: "Coordinator + PopDAM plan: stop apps copying data that already lives in the shared database (production orders, characters, licensor/property lists, style-group names, ERP customers)"
kind: plan
status: current
read-when: "Working on any copy of shared data in PopDAM, or coordinating the cross-repo 'no copies' effort (parent issue in u2giants/popdam3)"
---

# Plan — Read shared data instead of copying it (coordinator + PopDAM)

Handoff for this plan: [HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md](HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md)

Sibling plans (one per repository; each stands alone):
- Shared database: `popcre/shared-db` → `plan_shared_data_no_copies_db.md`
- DesignFlow sync service: `popcre/designflow-data-syncing` → `plan_stop_coldlion_customer_copy.md`
- DesignFlow tracking service: `popcre/designflow-tracking` → `plan_retire_prod_order_feed_key.md`

Parent issue: u2giants/popdam3#1298; child issues listed under § STATUS.

## STATUS (read first)

Child issues (parent u2giants/popdam3#1298): S1 popcre/shared-db#6992 · P1 u2giants/popdam3#1299 · P2 u2giants/popdam3#1300 · T1 popcre/designflow-tracking#239 · S2 popcre/shared-db#6993 · C1 popcre/shared-db#6994 · C2 popcre/shared-db#6995 · C3 u2giants/popdam3#1301 · C4 popcre/shared-db#6996 · N1 popcre/shared-db#6997 · D2 popcre/designflow-data-syncing#192 · D1 popcre/shared-db#6998

| Stage | Repo | What | State | Evidence |
|---|---|---|---|---|
| S1 | shared-db | Read function for production orders by SKU | ✅ done 2026-11-23 4:20 PM EST | popcre/shared-db#6987 + #6990 (56068c2); production apply run "DB production apply c8c0dc1 PR6987 20261225090701" success; proven as `authenticated` |
| P1 | popdam3 | Design panel reads shared production orders | ✅ done 2026-11-23 4:25 PM EST | #1296 (d4810b7) live; dam.designflow.app panel for AA062VMAT03 shows D3401/D3402/D3731 |
| P2 | popdam3 | Retire PopDAM's production-order copy pipeline + its credentials | ✅ done 2026-11-23 4:25 PM EST | #1296 removed sync/schedule/admin actions/settings; secrets, admin_config rows, GCP SA popdam-po-sync deleted, 1Password items archived (~3:30 PM EST) |
| T1 | designflow-tracking | Remove the production-order feed service key | ✅ done 2026-11-23 — migration `20261225091103` (popcre/shared-db PR #7018; original 20261225090902 retired), production apply run 45314731038; re-check: 0 of the 5 tables in `information_schema.tables` |
| S2 | shared-db | Drop the production-order copy tables and two empty placeholders | ✅ done 2026-11-23 9:50 PM EST | migration 20261225091103 (popcre/shared-db PR #7018), production apply run 45314731038; proof on popcre/shared-db#6993 |
| C1 | shared-db + popdam3 | Build and review the PopDAM→shared character map | ✅ live 2026-11-23 7:15 PM EST | popcre/shared-db #7000 + #7004; 99.11% of links mapped; proof on popcre/shared-db#6994 |
| C2 | shared-db | Point image character tags at shared characters | ✅ live 2026-11-24 | popcre/shared-db#6995 |
| C3 | popdam3 | PopDAM code uses shared characters | ✅ live 2026-11-24 (#1324, #1333) | #1301 |
| C4 | shared-db | Retire PopDAM's character, property and licensor lists | ✅ live 2026-11-24 (old lists dropped in production) | popcre/shared-db#6996 |
| N1 | shared-db + popdam3 | Style-group names derived from the linked shared records | ✅ live 2026-11-23 8:40 PM EST | popcre/shared-db #7001; drift 0 (was 254/2,565); proof on popcre/shared-db#6997 |
| D2 | designflow-data-syncing | Stop the second ERP customer download | ✅ done 2026-11-23 4:15 PM EST | proof on popcre/designflow-data-syncing#192 |
| D1 | shared-db | ERP customer list served from the main ERP feed | ✅ live 2026-11-23 | popcre/shared-db #7008 (+#7013), apply run 45290818081; proof on popcre/shared-db#6998 |

Fresh session starts at: **§ Coordinator procedure**; only C2+C3 (together) then C4 remain.

---

## Part 1 — Why

### 1. Ultimate goal

POP Creations runs one shared database for all its apps (PopDAM, PopSG, CRM, PIM, DesignFlow PLM, monitor) **so that apps do not copy each other's data**. Several apps still keep their own copies: they download or duplicate records that already exist in the shared database, and those copies go stale, disagree, break when credentials expire, and cost money to keep in sync.

When this plan is done:
- PopDAM shows production orders, characters, licensors, properties and customers straight from the shared records — always current, with nothing to re-sync.
- No app downloads ERP customers a second time.
- The temporary credentials created only to feed a copy are gone.
- Every removed copy is replaced by a read of the shared record, and every screen that used it still works.

**If a step conflicts with this goal, the goal wins — stop and flag it on the parent issue.** A copy that turns out to be the *only* home of some data is not a copy: keep it and record why.

### 2. The applications

- **PopDAM** (`u2giants/popdam3`, this repo): the digital asset manager for POP Creations' design files. React/Vite frontend (`src/`), Supabase edge functions (`supabase/functions/`), Railway worker (`apps/worker/`), on-site agents (`apps/bridge-agent/`, `apps/windows-agent/`). Live at the PopDAM site served by Coolify (see `AGENTS.md` → Deployment). Merges to `main` deploy automatically: frontend via `publish-frontend.yml`, edge functions via `deploy-supabase.yml`, worker via Railway on `apps/worker/**`.
- **Shared database**: one Supabase project, production ref `qsllyeztdwjgirsysgai` (resolve with `ai-private-config value supabase_shared_prod_ref`). Its shape is owned by `popcre/shared-db`; app repos never change structure themselves.
- **DesignFlow PLM**: six `popcre/designflow-*` repos (Angular→BFF→Express→Sequelize on Cloud Run, GCP project `lithe-breaker-323913`). Its production orders live in the shared database in `plm.production_order` / `plm.production_order_line` (canonical) and `dflow_prod."ProdOrderHeader"` (legacy runtime).
- **ColdLion**: POP's ERP. Its feed lands in schema `coldlion` (e.g. `coldlion.customer`, refreshed daily — last seen 2026-11-23 11:07 AM EST).

### 3. What triggered this work

On 2026-11-23 issue u2giants/popdam3#1272 item 1 ("production PO sync never ran") was worked by building a durable login for PopDAM to download DesignFlow's production-order feed into its own tables. Albert asked: *"we have 1 shared database among all apps so that apps don't have to copy data into their apps. why is popdam not just referring to the table in the central database?"* The orders were already in the shared database. He then asked for an audit of every such copy across all apps, and this plan fixes everything the audit found.

### 4. Scope

In scope (exactly the audit findings, 2026-11-23):
1. PopDAM production-order copy (`public.prod_order_headers_current`, `_raw`, `prod_order_sync_runs`) and its download pipeline and credentials.
2. PopDAM's own character list `public.characters` (9,622 rows) that all image character tags point at, instead of `core.character` (15,117 rows).
3. PopDAM's old `public.licensors` (10) and `public.properties` (500) lists, which exist only to hang `public.characters` off.
4. Copied names on `public.style_groups` (licensor/property/division/merchandise-group/customer names and codes) that duplicate the linked shared records.
5. Two never-used empty placeholders: `dam.production_order_snapshot`, `dam.erp_item_snapshot`.
6. DesignFlow's second download of ERP customers into `core."externalCustomer"` (designflow-data-syncing), while `coldlion.customer` already holds them.

**NOT in this plan:**
- The DesignFlow legacy→canonical move (`dflow_prod` ↔ `plm`, `app`), including the drift found 2026-11-23 (users 64 vs 53, notifications 110,896 vs 105,241). It is planned and in flight under `popcre/shared-db#4248`/`#4707`; record the drift there, do not fix it here.
- DesignFlow's hourly Microsoft 365 staff-list update (designflow-backend `helpers/m365-user-sync-scheduler.js`) — external source; belongs to the users/roles move above.
- **Vendors** (`core."externalVendor"`): `coldlion.vendor` holds only 101 vendors and lacks address/phone/payment fields that `externalVendor` (628 rows) has, and vendor unification is already owned by u2giants/popdam3#1273 (`HANDOFF.d/2026-11-23T1905Z-hetz-claude-1273-master-data-cutover.md`). Leave vendors to #1273; mention this on its issue.
- Legitimate ingest from systems outside the database (ColdLion API → `coldlion`, licensor portal scrapes → `plm.*_observation`), CRM's contact-company builder (reads `core.customer`, writes shared `core`), PopDAM's `style_tracker_rows` (PopDAM is its source of truth; `plm.style_tracker_item_bridge` points at it).
- Raster tagging and Helper pilot (other #1272 items).

---

## Part 2 — What we already know

### 5. Current state (as of 2026-11-23 3:20 PM EST, `main` @ `da9b807e`)

Production-order copy pipeline — **all merged and live**, built earlier the same day and now to be retired:
- `supabase/functions/_shared/admin-handlers/prod-order-handlers.ts` — `handleTriggerProdOrderSync` (chunked, 3 pages per call, lease), `handleProdOrderSyncRuns`, `handleProdOrderStats`; `prod-order-paging.ts` (+ `.test.ts`).
- `supabase/functions/admin-api/index.ts:88` import and `:2160-2165` routes `trigger-prod-order-sync`, `prod-order-sync-runs`, `prod-order-stats`.
- `apps/worker/src/handlers/prod-order-sync-schedule.ts` (+ test), called from `apps/worker/src/operation-loop.ts:36,817`; `apps/worker/package.json` test script sets `PROD_ORDER_SYNC_SCHEDULE=off`. The worker starts a sync every 6 h.
- Settings UI: `src/components/settings/erp-enrichment/ProductionPoSyncSection.tsx`, mounted in `src/components/settings/ErpEnrichmentTab.tsx:1,12`.
- Only real reader: `src/components/library/StyleGroupDetailPanel.tsx:176-198` (query `prod_order_headers_current` by `style_number = group.sku`), rendered around `:971`.
- Data: 479 lines / 182 orders / 278 styles copied; last run failed with a statement timeout (rows are ~28 KB each).
- Credentials created for it (all must be retired in P2/T1): Supabase edge secrets `PROD_ORDER_API_TOKEN_2`, `PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON`; `admin_config` keys `PROD_ORDER_API_TOKEN_2_HEADER`, `PROD_ORDER_API_ENDPOINT`; GCP service account `popdam-po-sync@lithe-breaker-323913.iam.gserviceaccount.com` (key id `d4a0a1c20acacf65e177a06639957817d1c81e01`, `roles/run.invoker` on Cloud Run `popcre-tracking-prod` us-east4); GCP secret `PROD_ORDER_FEED_TOKEN`; 1Password items `DesignFlow PLM production-order feed service token - PopDAM PO sync (production)` and `Google service account key - PopDAM PO sync invoker for popcre-tracking-prod (production)` (vault `vibe_coding`). DesignFlow side: `popcre/designflow-tracking` PR #236 (merged to main, live) and PR #235 (open to develop).

Characters:
- `public.characters(id, property_id → public.properties, name, external_id, usage_count, is_priority, …)`; `public.asset_characters.character_id → public.characters(id) ON DELETE CASCADE` (49,485 of 50,405 links).
- `public.dam_character_catalog` view maps PopDAM characters to `core.property` by licensor code/name + property name.
- `docs/SCHEMA.md:71-74`: character identity was deliberately not migrated in the 2026-07-23 licensor/property cutover because `core.character` was empty; "a separate approved migration is required". `core.character` now has 15,117 rows.
- Code touching characters: `supabase/functions/admin-api/index.ts:655-700` (`rebuild-character-stats`, reads/upserts `characters`), `apps/worker/src/handlers/ai-tagging.ts` and `apps/worker/src/handlers/group-metadata-refresh.ts` (write/read `asset_characters`), `apps/worker/src/handlers/ai-tag-bakeoff.ts` (`dam_character_catalog`), `supabase/functions/agent-api/index.ts`, exports (`supabase/functions/export-table/index.ts:21`, `export-sql-dump/index.ts:51`, `_shared/export-pagination.ts`), `src/components/settings/ApisTab.tsx:1091-1092`, test `src/test/core-licensor-property-contract.test.ts`.
- Match quality (2026-11-23 read-only query): of 9,622 PopDAM characters, ~5,713 match exactly one `core.character` with the same licensor and name; ~1,357 match several; the rest (~2,550) match none. `public.characters.external_id` (e.g. `8447`) does **not** match any `core.taxonomy_source_ref` row.

Licensor/property lists: `public.properties.licensor_id → public.licensors`, `public.characters.property_id → public.properties`, and `plm.style_tracker_item_bridge.public_licensor_id → public.licensors ON DELETE SET NULL`; view `public.style_tracker_rows_with_bridge` depends on them. Last change 2026-03-13. No app code queries them directly.

Style-group names: `public.style_groups` has `licensor_id`, `property_id`, `customer_id` (links) **and** copied `licensor_name/code`, `property_name/code`, `division_code/name`, `mg01..03_code/name`, `customer`. The names are read by ~19 app files and ~114 shared-db migration functions (search/filter RPCs).

ERP customers: designflow-data-syncing `models/lib.model.js:1335` (`getExternalCustomer`) downloads `x5.coldlion.com/EhpApi/customers` into `core."externalCustomer"` (839 rows); route `routes/lib.controller.js` `GET /getExternalCustomer`. Readers: designflow-item-master (`routes/item_library.router.js`, `routes/item_detail.router.js`, `models/db/externalCustomer.js`), designflow-tracking (`models/lib.model.js`, `models/lic.model.js`, `services/overdue-notify.service.js`, `services/grid-cell-notes.service.js`), and shared view `api.dam_order_customer_settings`. `coldlion.customer` (838 rows) has every `externalCustomer` field in snake_case.

### 6. Key findings and root cause

- The copies predate the shared database or were built before the shared tables were populated (characters: `core.character` empty in July). Nobody went back once the shared records existed.
- The production-order feed is paged 0-based with an exclusive end (designflow-tracking `helpers/gridPage.js:86-113`); its rows are ~28 KB, so a single edge call cannot copy the 3,283-row feed. Reading the shared table avoids all of that.
- Reading the shared orders directly covers **5,695** style groups (vs 278 in the copy) — the copy was badly incomplete.
- `plm.production_order` mixes DesignFlow production orders (`source_system IS NULL`, 3,442) with ColdLion sales orders (`source_system = 'coldlion'`, `COLDLION-SO-*`, 236). Only the former are production orders. Lines match style groups by `plm.production_order_line.sku_normalized = lower(style_groups.sku)`; exclude rows with `voided_at`.
- Access: `authenticated` has SELECT on `plm.production_order[_line]` and RLS policies `production_order_popdam_read` / `production_order_line_popdam_read` (`USING true`) already exist. But PostgREST exposes only `public, graphql_public, api, crm, pim, core, app` — **not `plm`** — so the frontend needs a read function/view in an exposed schema (stage S1).
- Customer on a production order: `plm.production_order.company_id` is a `core.customer` id for only 7 of 3,442 orders; the customer must come from elsewhere (see § 8 open decision).

### 7. Approaches considered and REJECTED

- **Keep copying, but fix the sync** (chunking, batching, scheduling) — done and partly shipped on 2026-11-23 (popdam3 #1289, #1290; #1294 closed unmerged). Rejected by the owner: the data is already shared; copying needs credentials, schedules, a second store, and was 95% incomplete.
- **Expose schema `plm` to the API** — rejected: widens the whole PLM schema to every app; use a narrow function/view instead.
- **Delete `public.licensors`/`properties` first** — rejected: `public.characters` and `plm.style_tracker_item_bridge` still reference them (found 2026-11-23; an earlier chat message wrongly said "nothing reads them").
- **Map characters by name only** — rejected: ~1,357 names are ambiguous; licensing ownership must come from licensor scrapes/shared records (owner rulings: licensing from scrapes, never ask Albert; DC and Harry Potter are properties of Warner Bros., never licensors).
- **Drop the copied style-group name columns outright** — rejected: ~114 search/filter functions and the cold-statement performance ceiling (see memory "Cold/warm statement ceiling") depend on them; replace with automatically derived values instead (N1).
- **Replace `externalVendor` with `coldlion.vendor`** — rejected for now: the ERP feed lacks most vendor fields; owned by #1273.

### 8. Decisions

Locked (2026-11-23, owner direction "read the shared table, don't copy"):
- Apps read shared records; copies are removed, not repaired.
- Structural changes go only through `popcre/shared-db` (claim-first on the child issue, migration via `scripts/check-dispatch-collision.mjs --reserve-version [--future-minutes 1]`, PR, merge queue, automatic preview→production promotion; never apply by hand).
- Production orders shown are DesignFlow production orders only (`source_system IS NULL`), non-voided.
- The production-order pipeline's credentials are deleted, not kept "just in case".
- Style-group names stay as columns for search speed but become derived from the linked shared records (no manual copies).

Open (implementer's judgment, with criteria):
- **Customer on a production order** (S1/P1): use whatever DesignFlow's own production tracking grid shows as the customer (inspect designflow-tracking `models/lib.model.js` `getProdOrderHeader` and the line fields `customer_po_number`, `customer_suffix`, `metadata`). If no reliable source, omit the column rather than guess.
- **"Due date"** (S1/P1): prefer the line's `cancel_date`, else `start_ship_date`, else order `requested_ship_date`; confirm against the tracking grid's "Dlvy" column.
- **Character mapping rules** (C1): exact licensor+name first; then alias tables (`core.character_alias`), then source refs; anything still ambiguous is reported, not guessed. The acceptance bar is in C1.

---

## Part 3 — How to build it

### Coordinator procedure

One **coordinator** (lead session, opened on the parent issue) runs the whole effort. It:
1. Reads this STATUS table and the three sibling plans' STATUS tables.
2. For each child issue whose prerequisites are done, starts **one subagent per stage** (Agent tool, or a separate session per repo when the stage needs its own worktree/PR), handing it: the child issue URL, the owning repo's plan path, and the stage id. Stages in different repos with no dependency run in parallel; two stages that touch the same files never run at once.
3. Verifies each returned stage itself against the stage's gate before marking it done (a subagent's report is not proof).
4. Updates the STATUS rows (with evidence: SHA, PR, run id, or a re-runnable query) in the owning repo's plan and ticks the parent checklist.
5. Escalates a blocked stage on its child issue with owner, impact and next safe action; never waits more than 30 minutes on a stuck helper or check.

Dependency graph:
```
S1 ──► P1 ──► P2 ──┬─► T1
                   └─► S2
C1 ──► C2 ⇄ C3 ──► C4          (C2 and C3 land together)
N1                              (independent)
D2 ──► D1                       (independent; DesignFlow stops writing before the table becomes a view)
```

### Stages owned by THIS repo (popdam3)

**P1 — Design panel reads shared production orders** (`lead-only`: changes what users see as production data)
- Prerequisite: S1 merged and live (function exists in production).
- Change `src/components/library/StyleGroupDetailPanel.tsx:176-198` to call the S1 function (`supabase.schema("api").rpc(...)` or `public` per S1's final name) with `group.sku`; keep the same returned field names where possible so the render at ~`:960-990` needs minimal change. Regenerate `src/integrations/supabase/types.ts` for the new function.
- Behaviour: a design with production orders lists each DesignFlow production order (number, status, quantity, customer if S1 provides it, due date); a design without orders shows the existing empty state.
- Gate: on the live site, open the detail panel for SKU `MTC6XDYCR01`-style designs that have orders in `plm.production_order_line` (pick one with the query in § 12) and confirm the numbers match `select … from plm.production_order …` for that SKU; screenshot attached to the child issue. Vitest for the mapping helper (below) green.

**P2 — Retire the production-order copy pipeline** (`helper-ok` for code deletion; `lead-only` for credential removal)
- Delete: `prod-order-handlers.ts`, `prod-order-paging.ts`, `prod-order-paging.test.ts`, the import at `admin-api/index.ts:88` and routes `:2160-2165`; `apps/worker/src/handlers/prod-order-sync-schedule.ts` + test and its call at `operation-loop.ts:36,817`; the `PROD_ORDER_SYNC_SCHEDULE=off` prefix in `apps/worker/package.json`; `ProductionPoSyncSection.tsx` and its mount in `ErpEnrichmentTab.tsx`. Remove "production PO sync" text from `docs/agents-reference.md:61`, `docs/configuration.md:127`, `docs/idiosyncrasies.md:70-76` (replace with one line: "PopDAM reads production orders from `plm` via the S1 function; no sync").
- Credentials (lead): `supabase secrets unset PROD_ORDER_API_TOKEN_2 PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON --project-ref qsllyeztdwjgirsysgai`; delete `admin_config` rows `PROD_ORDER_API_TOKEN_2_HEADER`, `PROD_ORDER_API_ENDPOINT` (prove target first); `gcloud iam service-accounts delete popdam-po-sync@lithe-breaker-323913.iam.gserviceaccount.com --project lithe-breaker-323913`; archive the two 1Password items (`item_archive`), noting why in their notes.
- Stop-and-ask trigger (helper): any other file imports the deleted modules, or a test outside the deleted ones fails.
- Gate: `grep -rn "prod_order_headers\|prod-order-sync\|PROD_ORDER_" src supabase/functions apps` returns only S2-pending type definitions; worker `npm test` and root `npx vitest run` green; `supabase secrets list` shows no `PROD_ORDER_*`; `gcloud iam service-accounts list --project lithe-breaker-323913 | grep popdam-po-sync` is empty.

**C3 — PopDAM code uses shared characters** (`lead-only`: tagging writes production data)
- Lands in the same release window as C2. Change every `characters`/`asset_characters` user listed in § 5 to the shared ids: `admin-api/index.ts:655-700` (`rebuild-character-stats` — usage count and priority move to wherever C2 puts them; see shared-db plan C2), `apps/worker/src/handlers/ai-tagging.ts` and `group-metadata-refresh.ts` (character resolution must look up `core.character`), `ai-tag-bakeoff.ts`, `ApisTab.tsx:1091-1092`, exports' table lists, and `src/test/core-licensor-property-contract.test.ts`.
- Gate: tag one real asset through the production tagger; its new `asset_characters` row references a `core.character` id; Settings → APIs shows character counts from the shared list; worker and vitest suites green.

**N1 (PopDAM part) — derived style-group names** (`helper-ok` after the shared-db trigger exists)
- Remove any PopDAM code that writes those name columns from ERP data (`supabase/functions/_shared/admin-handlers/*erp*`, `apply-erp-enrichment` handler, `apps/worker/src/handlers/*metadata*`) — it must write only the ids. Stop-and-ask trigger: a writer sets a name with no id available.
- Gate: change a test licensor's display name in **preview** and see the style-group name update; production check is read-only (`select count(*) from style_groups sg join core.licensor l on l.id=sg.licensor_id where sg.licensor_name is distinct from l.name` returns 0).

### 10. Tests required

- P1: vitest `src/components/library/__tests__/production-orders.test.ts` — maps the S1 rows into the panel model (empty list, one order with several lines, voided lines absent).
- P2: existing suites stay green after deletion (`apps/worker npm test`, root `npx vitest run`); no new tests.
- C3: worker test that tagging resolves a character name to a `core.character` id; contract test `core-licensor-property-contract.test.ts` updated to assert no `public.characters` usage.
- N1: vitest/worker test that ERP enrichment writes ids only.

### 11. Constraints and gotchas

- Never change database structure from this repo; no migrations here (`AGENTS.md`). Shared-db child issues own all DDL.
- Branch + PR to protected `main`; the AI merges (advisory "Supabase Preview" check failure is not blocking). Use `bin/ai-pr-wait <pr>` (or `ai-pr-wait`), never sleep loops.
- Prove the database target (`get_project_url` → `qsllyeztdwjgirsysgai`) before every write; quote it in the issue.
- Supabase MCP may point at production; SQL through it is read-only unless you mean to write ops data.
- Secrets: never print; use `op run`/`op_run` or `supabase secrets set --env-file`.
- Times in EST.
- The worker test script disables the schedule via env; removing the schedule removes that prefix too.
- Licensing ownership: from licensor scrapes, never ask Albert; DC and Harry Potter are Warner properties.

### 12. Access and environment

- `gh` authenticated as `u2giants` (works for `popcre/*`). `gcloud` as `u2giants@gmail.com` with project `lithe-breaker-323913`. `supabase` CLI authenticated; `op` service account on vault `vibe_coding`. Supabase MCP bound to production `qsllyeztdwjgirsysgai`.
- Service-role key: 1Password `Supabase Runtime Keys - shared POP database (production)` (item id `3hhxwrljnaq2tykxi7hplq5ryi`), fields `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- PopDAM tester logins: see memory `project_popsg_tester_login` (1Password per-role items).
- Pick a design with production orders: `select sg.sku from style_groups sg join plm.production_order_line l on l.sku_normalized=lower(sg.sku) join plm.production_order o on o.id=l.production_order_id where o.source_system is null and o.voided_at is null and l.voided_at is null limit 5;`

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when every STATUS row in all four plans is ✅ with evidence, the parent issue checklist is complete, each child issue carries live proof, and docs (`AGENTS.md` router, `docs/SCHEMA.md` character section, this plan) are updated; then delete or archive the plans.

Risks: (1) Character remap mis-tags images — mitigated by C1 review gate and keeping a snapshot table for rollback (shared-db C2). (2) Search slowdowns if N1 triggers are heavy — gate with the existing performance checks. (3) DesignFlow readers of `externalCustomer` break if the view's column names differ — D1 keeps identical names and types. Rollback for each stage is in its owning plan.

Open: customer/due-date source for production orders (§ 8 criteria); exact character-map acceptance (C1).

### Self-audit (2026-11-23)

1. *Could a new session execute this without asking?* Yes — goal (§1), apps and URLs (§2, §12), exact files and lines (§5, stages), dependencies (coordinator graph), gates per stage, credentials by location (§5, §12).
2. *Does it carry all background, including what was ruled out?* Yes — trigger (§3), findings with numbers (§5–6), rejected approaches incl. the day's abandoned sync fixes and the wrong "unused lists" claim (§7).
3. *Is the goal clear enough for judgment calls?* Yes — §1 states the outcome and the "a copy that is the only home of data is not a copy" rule; open decisions carry criteria (§8).

### Lead launch prompt

```
You are the coordinator for "read shared data instead of copying it" (parent issue in u2giants/popdam3; see the plan's STATUS for its number).
Read first: u2giants/popdam3 plan_shared_data_no_copies.md (all of it), then the STATUS tables of popcre/shared-db plan_shared_data_no_copies_db.md, popcre/designflow-data-syncing plan_stop_coldlion_customer_copy.md, popcre/designflow-tracking plan_retire_prod_order_feed_key.md.
Start every stage whose prerequisites are done (initially S1, C1, N1, D2) — one subagent per stage, each in its own worktree of the owning repo, given the child issue URL, the plan path and the stage id. Do lead-only steps yourself or in a full-strength subagent you then verify; give helper-ok steps to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, posts or production writes; bring every stop-and-ask trigger back to you; you take the work back after 30 minutes stuck.
You verify every gate yourself (live screens, queries with the proven database target, CI runs) before marking a STATUS row done with evidence, and you post live proof on each child issue. Stop only when every child issue is closed with proof, or a stage is genuinely blocked with its exact state recorded on the child issue.
```
