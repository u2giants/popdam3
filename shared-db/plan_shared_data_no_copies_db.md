---
summary: "Shared-db stages for removing app copies of shared data: production-order read function, drop PopDAM copy tables, move PopDAM image character tags to core.character, retire public licensor/property/character lists, derived style-group names, externalCustomer from the ColdLion feed"
kind: plan
status: current
read-when: "Working any child issue of the 'read shared data instead of copying it' effort (parent in u2giants/popdam3)"
---

# Plan — Shared-database stages: read shared data instead of copying it

Handoff: [HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md](HANDOFF.d/2026-11-23T2010Z-hetz-claude-shared-data-no-copies.md)
Coordinator plan (dependency graph, other repos): `u2giants/popdam3` → `plan_shared_data_no_copies.md`.

## STATUS (read first)

Child issues (parent u2giants/popdam3#1298): S1 popcre/shared-db#6992 · P1 u2giants/popdam3#1299 · P2 u2giants/popdam3#1300 · T1 popcre/designflow-tracking#239 · S2 popcre/shared-db#6993 · C1 popcre/shared-db#6994 · C2 popcre/shared-db#6995 · C3 u2giants/popdam3#1301 · C4 popcre/shared-db#6996 · N1 popcre/shared-db#6997 · D2 popcre/designflow-data-syncing#192 · D1 popcre/shared-db#6998

| Stage | What | State | Evidence |
|---|---|---|---|
| S1 | Read function: DesignFlow production orders for a style SKU | ✅ done 2026-11-23 4:20 PM EST | #6987 + #6990 (56068c2); production apply run "DB production apply c8c0dc1 PR6987 20261225090701" success; proven as `authenticated` (3 orders for AA062VMAT03) |
| S2 | Drop PopDAM production-order copy tables + `dam` placeholders | ⬜ open (after popdam3 P2) | — |
| C1 | Build + review PopDAM→`core.character` map | ⬜ open | — |
| C2 | Re-point `public.asset_characters` at `core.character` | ⬜ open (after C1; with popdam3 C3) | — |
| C4 | Retire `public.characters`, `public.properties`, `public.licensors` | ⬜ open (after C2/C3) | — |
| N1 | Style-group names derived from linked shared records | ⬜ open | — |
| D1 | `core."externalCustomer"` served from `coldlion.customer` | ⬜ open (after designflow-data-syncing D2) | — |

Fresh session starts at the lowest open stage whose prerequisite is met; S1, C1, N1 have none (D1 waits for designflow-data-syncing D2).

---

## Part 1 — Why

### 1. Ultimate goal
POP runs one shared Supabase database so apps never copy each other's data. Apps still keep copies (PopDAM's production orders, characters, licensor/property lists, copied style-group names; DesignFlow's second ERP customer download). This repo supplies the structure that lets each app read the shared record instead, then removes the copies. **If a step conflicts with that goal, the goal wins — stop and flag it on the child issue.** A "copy" that is the only home of some data is not a copy: keep it and say why.

### 2. The application
`popcre/shared-db` is the shape-of-database source of truth (migrations, contracts, rules) for the shared project, production ref from `ai-private-config value supabase_shared_prod_ref` (`qsllyeztdwjgirsysgai`), preview from `ai-private-config value supabase_shared_preview_ref`. Consumers: PopDAM/PopSG (`u2giants/popdam3`), CRM, PIM, DesignFlow PLM (`popcre/designflow-*`). Read `AGENTS.md` and `docs/agents/current-workflow.md` before any stage.

### 3. Trigger
2026-11-23: while fixing PopDAM's production-order download (u2giants/popdam3#1272), Albert asked why PopDAM copies data that is already in the shared database, then ordered an audit and a fix for every copy found.

### 4. Scope
In: stages S1, S2, C1, C2, C4, N1, D1 below.
**Not in this plan:** DesignFlow `dflow_prod`↔`plm`/`app` move and its drift (owned by #4248/#4707 — users 64 vs 53 and notifications 110,896 vs 105,241 differ as of 2026-11-23; note it there); vendors / `core."externalVendor"` (owned by u2giants/popdam3#1273 — `coldlion.vendor` has 101 rows and lacks address/phone/payment fields that `externalVendor`'s 628 rows carry); app code changes (owned by the app plans); external ingests (`coldlion.*`, `plm.*_observation`).

## Part 2 — What we know

### 5. Current state (2026-11-23)
- `plm.production_order` (3,678; `source_system IS NULL` = 3,442 DesignFlow production orders; `'coldlion'` = 236 ColdLion sales orders `COLDLION-SO-*`) and `plm.production_order_line` (25,162; `sku`, `sku_normalized`, `quantity_ordered`, `cancel_date`, `start_ship_date`, `customer_po_number`, `customer_suffix`, `voided_at`, …). `authenticated` has SELECT; RLS policies `production_order_popdam_read` / `production_order_line_popdam_read` (`USING true`) exist. `plm` is **not** in `pgrst.db_schemas` (`public, graphql_public, api, crm, pim, core, app`).
- PopDAM copy tables: `public.prod_order_headers_current` (479), `public.prod_order_headers_raw` (939), `public.prod_order_sync_runs`; empty placeholders `dam.production_order_snapshot`, `dam.erp_item_snapshot`.
- Characters: `public.characters` (9,622; cols `id, property_id, name, external_id, usage_count, is_priority, created_at, updated_at`), FK `public.asset_characters.character_id → public.characters ON DELETE CASCADE` (49,485 links), `public.characters.property_id → public.properties → public.licensors`; `plm.style_tracker_item_bridge.public_licensor_id → public.licensors ON DELETE SET NULL`; views `public.dam_character_catalog`, `public.style_tracker_rows_with_bridge`. `core.character` (15,117; `id, licensor_id, name, code, status, metadata`), `core.character_alias`, `core.taxonomy_source_ref` (no rows match `public.characters.external_id`).
- Match quality: ~5,713 PopDAM characters match exactly one `core.character` with the same licensor+name; ~1,357 match several; ~2,550 match none.
- `public.style_groups` carries ids (`licensor_id`, `property_id`, `customer_id`) and copied names/codes (`licensor_name/code`, `property_name/code`, `division_code/name`, `mg01..03_code/name`, `customer`); ~114 migration functions reference the name columns.
- `core."externalCustomer"` (839, camelCase ColdLion fields) is written by designflow-data-syncing `getExternalCustomer`; `coldlion.customer` (838, snake_case, every same field, refreshed daily) is the main ERP feed. View `api.dam_order_customer_settings` reads `externalCustomer`.

### 6. Findings
See § 5 numbers. Reading `plm` directly would give PopDAM orders for 5,695 style groups (copy covered 278). `plm.production_order.company_id` is a `core.customer` for only 7 orders.

### 7. Rejected
- Exposing `plm` in `pgrst.db_schemas` (too broad). - Name-only character mapping (ambiguous; licensing correctness). - Dropping style-group name columns (breaks ~114 functions, cold-statement ceiling). - Replacing `externalVendor` now (feed lacks fields; #1273 owns it). - Fixing PopDAM's copy sync (owner rejected copying, 2026-11-23).

### 8. Decisions
Locked: claim-first per stage on its child issue; version via `node scripts/check-dispatch-collision.mjs --objects "<objects>" --reserve-version --future-minutes 1` (main holds future-dated versions, plain reservation is refused as backdated); PR → merge queue → automatic merged-main preview → automatic production; **PR body must contain `Closes #<child issue>`** so the production lane finds the linked work issue (a link added after merge does not register). Never apply to production by hand. Preview work via CLI/psql with `supabase/.temp/project-ref` checked.
Open: S1 customer/due-date source (criteria in S1); C1 acceptance (criteria in C1).

## Part 3 — Stages

**S1 — production orders for a SKU** (`lead-only`: new API surface)
- Migration: `create or replace function api.dam_production_orders_for_sku(p_sku text) returns table (production_order_id uuid, production_order_number text, status text, order_date date, due_date date, quantity numeric, customer text, updated_at timestamptz)` `language sql stable security invoker set search_path = ''` selecting `plm.production_order o join plm.production_order_line l` on `l.production_order_id = o.id` where `o.source_system is null and o.voided_at is null and l.voided_at is null and l.sku_normalized = lower(trim(p_sku))`, grouped per order (sum quantity, min due date). Due date = `coalesce(l.cancel_date, l.start_ship_date, o.requested_ship_date)`. Customer: take the value DesignFlow's tracking grid shows (inspect designflow-tracking `models/lib.model.js` `getProdOrderHeader`); if no reliable column, return null. `grant execute … to authenticated`.
- Gate: in preview, `select * from api.dam_production_orders_for_sku('<sku>')` for a SKU from `select sku from public.style_groups … limit 5` (query in popdam3 plan § 12) returns rows equal to a hand-written join; `supabase/tests` contract test added; after promotion the same query works in production as `authenticated`.

**S2 — drop copy tables** (`lead-only`: destructive) — after popdam3 P2 is live.
- `drop table public.prod_order_headers_raw, public.prod_order_headers_current, public.prod_order_sync_runs;` `drop table dam.production_order_snapshot, dam.erp_item_snapshot;` Recoverable first: confirm each is unread (`pg_stat_user_tables.seq_scan/idx_scan` unchanged over a day, and `grep` in all consumer repos), and keep a pg_dump of the three `public.prod_order_*` tables attached to the child issue's private artifact location (not GitHub).
- Gate: tables absent in production; PopDAM and DesignFlow smoke checks pass.

**C1 — character map** (`lead-only`: licensing judgment)
- Create `dam.character_core_map(public_character_id uuid primary key, core_character_id uuid not null references core.character, method text, confidence text, reviewed_at timestamptz)` (migration). Fill it with a reviewed data load: (1) licensor via `public.dam_character_catalog.core_property_id → core.property.licensor_id`, then exact case/space-insensitive name match to exactly one `core.character` of that licensor; (2) `core.character_alias`; (3) source refs; else unmapped. Never map across licensors. Licensing ownership comes from licensor scrapes/shared records (owner rulings; DC and Harry Potter are Warner properties).
- Deliverable: a report (counts by method; every ambiguous/unmapped character with its asset-link count) stored in the issue's private artifact location; unmapped characters that still have links get a new `core.character` row created **only** with a licensor proven by shared records, else stay unmapped and are listed.
- Gate (acceptance): ≥ 99% of `asset_characters` links map; every remaining link listed by character; a second AI reviewer (different model) agrees with 30 random mapped samples.

**C2 — re-point image character tags** (`lead-only`: production data) — with popdam3 C3 in the same release window.
- Migration: snapshot `public.asset_characters` into `archive.asset_characters_before_core_character_<date>`; add `core_character_id` via the map; move `usage_count`/`is_priority` to `dam.character_usage(core_character_id pk, usage_count, is_priority)`; switch the FK to `core.character(id)`; keep a temporary compatibility view `public.characters` over `core.character` + `dam.character_usage` for one release if any reader remains.
- Gate: `select count(*) from public.asset_characters ac left join core.character c on c.id = ac.character_id where c.id is null` = 0; PopDAM tagging (popdam3 C3 gate) writes core ids.
- Rollback: restore from the archive snapshot.

**C4 — retire PopDAM's lists** (`lead-only`: destructive) — after C2/C3 live.
- Re-point `plm.style_tracker_item_bridge.public_licensor_id` to `core.licensor` (map via `public.dam_character_catalog` logic: code with `DS→DY`, `WWE→WW`, else name); update `public.style_tracker_rows_with_bridge`; drop `public.dam_character_catalog`, the compatibility view, `public.characters`, `public.properties`, `public.licensors` (pg_dump kept privately first).
- Gate: objects absent; PopDAM Styles page and DesignFlow style tracker load.

**N1 — derived style-group names** (`lead-only`: touches search performance)
- Migration: trigger on `public.style_groups` (before insert/update of the id columns) filling names/codes from `core.licensor`, `core.property`, `core.customer`, and the merchandise-group/division source used by `apply-erp-enrichment` (find it in popdam3 `supabase/functions/_shared/admin-handlers/*erp*`); plus statement-level triggers on `core.licensor/property/customer` name changes that update affected style groups in batches (≤ 20k rows per statement). One-time backfill in batches.
- Gate: in preview, renaming a licensor updates its style groups; production read-only check `… where sg.licensor_name is distinct from l.name` = 0; existing search performance checks unchanged (`docs/` cold-statement ceiling).

**D1 — `externalCustomer` from the ERP feed** (`lead-only`: DesignFlow readers)
- Migration: rename table `core."externalCustomer"` → `archive."externalCustomer_before_view_<date>"`; create view `core."externalCustomer"` over `coldlion.customer` with the exact same column names and types (`"companyCode"` ← `company_code`, …, `id` ← stable surrogate, e.g. the archived id joined on `customerCode`, else `row_number` is **not** acceptable — ids must stay stable for readers); grants unchanged. Compare row-by-row first: report customers present in one source only.
- Prerequisite: designflow-data-syncing D2 is live (nothing writes `core."externalCustomer"` any more — a view cannot be written).
- Gate: designflow-item-master and designflow-tracking customer pickers/grids show the same customers on the sandbox; `api.dam_order_customer_settings` returns the same rows.

## 10. Tests
- S1: `supabase/tests/dam_production_orders_for_sku.test.sql` (pgTAP): voided rows excluded, ColdLion SO excluded, multi-line order aggregated.
- C2: pgTAP asserting FK target and zero orphans.
- N1: pgTAP for the trigger (insert, id change, upstream rename).
- D1: pgTAP asserting column names/types of the view equal the archived table's.
- Repo checks: `scripts/check-sql.sh`, required checks `SQL migration guards`, `supabase/tests against an ephemeral database`, `Destructive SQL outside migrations`.

## 11. Constraints
Claim-first; one PR per stage; `Closes #<child>` in PR body; prove target before every write; reviews advisory; no production apply by hand; destructive steps recoverable first (archive/pg_dump privately); batch large updates (~20k); times in EST; private licensor data never in GitHub.

## 12. Access
`gh` (u2giants) works for popcre; Supabase CLI authed; `op` on `vibe_coding`; Supabase MCP bound to production. Preview DB password: 1Password `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`.

## 13. Done / risks
Done: every row ✅ with SHA/run evidence, each child issue closed with production proof, `docs/database-design-and-schema.md` updated (copies retired). Risks: wrong character remap (C1 review + archive rollback); DesignFlow readers on D1 (identical column contract + sandbox check); N1 trigger cost (batched, perf gate).

### Self-audit (2026-11-23)
1. New session can execute without asking: yes — §5 objects and counts, per-stage migration shape, gates, locked process incl. the `Closes #` and future-version gotchas found 2026-11-23.
2. All background incl. rejections: §3, §5–§7.
3. Goal clear for judgment calls: §1 with the "only home of data" rule; open decisions carry criteria.

### Lead launch prompt
```
You run one shared-db stage of "read shared data instead of copying it". Read AGENTS.md, docs/agents/current-workflow.md, then this plan (plan_shared_data_no_copies_db.md) fully, then the child issue you were given.
Claim the stage's exact objects on that child issue, reserve the version with scripts/check-dispatch-collision.mjs --reserve-version --future-minutes 1, write the migration, run scripts/check-sql.sh, open a PR whose body starts with "Closes #<child>", let the merge queue and automatic promotion run (ai-pr-wait; never apply by hand), and prove the result in production with a read-only query quoting the project URL.
Lead-only steps are yours. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md . Helpers may draft pgTAP tests and reports; they return finished work or an evidenced blocker, make no design decisions, never merge or write to a database, and you take work back after 30 minutes stuck.
Update this plan's STATUS row with evidence and post live proof on the child issue before reporting done to the coordinator.
```
