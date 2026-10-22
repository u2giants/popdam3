# Architecture

This repository is the **schema and contract** layer of one shared Supabase
project. It is not an application. Consumer apps (CRM, DAM, PM/PIM, DesignFlow
PLM) read and write the same database; this repo owns the *shape* of that
database and the rules that keep apps from breaking each other.

Read `AGENTS.md` first for operating rules. Read
[`docs/unified-supabase-schema-map.md`](unified-supabase-schema-map.md) for the
full entity map and [`docs/unified-supabase-relationships.md`](unified-supabase-relationships.md)
for crossover relationships. This file is the short design picture.

## System context

```text
  popcrm-web     popdam3     poppim-web     designflow-* 
       \            |            |              /
        \           |            |             /
         v          v            v            v
              Supabase project qsllyeztdwjgirsysgai
              (schemas: app, core, api, crm, pim, dam, plm, ingest, public)
                              ^
                              |
                     popcre/shared-db
                     migrations · contracts · rules
                              |
                              v
                     sync.yml mirrors tree into
                     each consumer's shared-db/ folder
```

## Schemas and ownership

| Schema | Owns | Browser / PostgREST |
|---|---|---|
| `app` | Users, profiles, roles, app access, audit, notifications | selective RLS / RPC |
| `core` | Shared master data: customers, contacts, licensors, properties, characters, factories, taxonomy | yes (RLS) |
| `api` | Stable browser-facing views and RPC contracts | yes |
| `crm` | Opportunities, departments, email, notes, tasks | yes |
| `pim` | Products, projects, designs, submissions, samples, orders | yes |
| `dam` | Assets, style groups, style guides, processing queues | **not** in `pgrst.db_schemas` (intentional) |
| `plm` | Item master, production orders, licensing status, ERP mirrors | restricted / service role |
| `ingest` | Raw imports and sync staging | no |
| `public` | Compatibility views/functions; PopDAM live base; lockdown defaults | careful — anon lockdown since 2026-07-29 |

Exposed PostgREST schemas today: `public, graphql_public, api, crm, pim, core, app`.
`dam` is omitted on purpose (AGENTS.md quirk / runbook §8.1).

## Data flow (high level)

1. **Source systems** (ColdLion ERP, licensor portals, ClickUp, email) land in
   `ingest` / typed mirrors under `plm` / `core` via loader tools in `tools/` and
   scheduled workflows.
2. **Canonical shared rows** live in `core` (and selected `plm` operational
   tables). Curated Master Data (`core.licensor`, `core.property`,
   `core.character`, `core.customer`, `core.factory` and `*_ext`) is gated.
3. **App-owned rows** stay in `crm` / `pim` / `dam` / `plm` as declared by the
   entity map. Ordinary row writes are application work, not structural work
   (§0.0-B).
4. **Browser apps** read through `api` views and RLS-gated tables, typed by
   `types/database.types.ts`.

## Migration model

- Every shape change is a **new** file `supabase/migrations/<14-digit-UTC>_<name>.sql`.
- Versions are reserved through `scripts/manage-migration-author-lanes.mjs` so
  two authors cannot collide (duplicate versions silently skip).
- Applied migrations are immutable. Fix forward.
- The ledger is **not** a clean-slate replay: empty marker migrations align with
  objects created before this repo was canonical. `supabase/ci-bootstrap/` is
  the CI-only bootstrap; it is deliberately not a migration.
- Preview apply and production apply are separate, exclusive lanes. Preview and
  production **diverge in both directions** — never treat preview as a subset of
  production (AGENTS.md quirks / standing fact 11).

## Contracts

| Contract | Where |
|---|---|
| Generated TypeScript DB types | `types/database.types.ts` (regenerate; never hand-edit) |
| SQL lint / shape checks | `scripts/check-sql.sh` |
| Production migration guard | `scripts/production_migration_guard.py` |
| Self-service additive boundary | `scripts/check-self-service-additive-lane.mjs` (`{crm, pim, dam, plm}`) |
| Business meaning | `docs/business-rules/` |
| Schema ownership map | `docs/unified-supabase-schema-map.md` |
| Implementation notes / gaps | `docs/implementation/schema-implementation-notes.md`, `docs/unified-supabase-migration-gaps.md` |

## Constraints that shape the design

- **One shared database** — no "just this app" isolation (AGENTS.md §3).
- **Structure vs data** — this repo changes shape; apps change rows
  (§0.0-B), except curated Master Data.
- **Claim-first structural work** — exact object claims, version reservation,
  independent review, guarded merge, serial production lane (§0.0-D).
- **Security defaults** — `public` function EXECUTE is revoked from `PUBLIC`/`anon`
  by event trigger since 2026-07-29; new functions need explicit grants.
- **Property identity** — property codes are unique only per licensor.

## Where *not* to look for architecture

- `docs/verification/` is evidence of past runs, not the design.
- `plan_*.md` / `fix_*.md` at repo root are historical work records.
- `docs/archive/` is history.
