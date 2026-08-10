# Four answers on licensor → property parent-child

**Status:** ANSWERS ONLY. Read-only investigation. No migration authored, no database written, no app repo changed.
**Author:** sub-agent `answers-verification`, dispatched by the shared-db coordinator.
**Date:** 2026-08-03.
**Companion document:** [`docs/licensor-property-parent-child-design-20260802.md`](licensor-property-parent-child-design-20260802.md) (merged 2026-08-02). This document
**verifies, corrects and extends** it; it does not replace it.

---

## Target proof (AGENTS.md §4.2)

`get_project_url` returned `https://qsllyeztdwjgirsysgai.supabase.co` — **production `qsllyeztdwjgirsysgai`**.
Every statement run for this document was a `SELECT` against the system catalogs or the canonical tables.
No `INSERT`, `UPDATE`, `DELETE`, `DDL`, RPC call, migration or workflow dispatch was run against either
database. `plm.check_taxonomy_sync_health()` was **not** called (it writes alert rows).

Server timezone is `America/New_York`. Both UTC and server-local are given wherever a date matters.

---

## Q1. Where does Albert go to see new unassigned properties and assign them to a licensor?

### The answer for today: **nowhere. There is no such screen in any application.**

This is not "we could not find it". It is a verified absence, and one of the applications says so in its
own user-facing text.

#### 1.1 The database itself has exactly one writer, and it is a machine

Queried across every non-system schema on production, for any function whose body contains
`UPDATE core.property`, `INSERT INTO core.property`, `UPDATE core.licensor` or `INSERT INTO core.licensor`:

```sql
select n.nspname||'.'||p.proname as fn,
  (pg_get_functiondef(p.oid) ~* 'update\s+core\.property')       as writes_property,
  (pg_get_functiondef(p.oid) ~* 'insert\s+into\s+core\.property') as inserts_property,
  (pg_get_functiondef(p.oid) ~* 'update\s+core\.licensor')        as writes_licensor,
  (pg_get_functiondef(p.oid) ~* 'insert\s+into\s+core\.licensor') as inserts_licensor
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prokind = 'f'
  and n.nspname not in ('pg_catalog','information_schema','extensions','graphql','pgbouncer',
                        'vault','realtime','storage','auth','net','cron','pgsodium')
  and pg_get_functiondef(p.oid) ~* '(update|insert\s+into)\s+core\.(property|licensor)\M';
```

**Exactly one row: `plm.import_master_data` (SECURITY DEFINER).** That is the DesignFlow master-data
importer — a machine feed, not a person. There is no human-callable RPC of any kind.

The privilege position confirms it independently. `information_schema.role_table_grants` for
`core.property` and `core.licensor`:

| Grantee | Privileges |
|---|---|
| `authenticated` | **`SELECT` only** |
| `service_role` | full |
| `postgres` | full |

An `admin_write` RLS policy (`app.has_role('administrator')`) exists on both tables, but per AGENTS.md §11
**an RLS policy is not a GRANT** — with no `INSERT`/`UPDATE` grant to `authenticated`, that policy is
unreachable from any browser session. The write path fails at the privilege check before RLS is consulted.

#### 1.2 DB Data Admin (`data.designflow.app`) — the closest thing, and it is read-only *by design*

There **is** a Licensor → Property tree screen and a Property table there
(`apps/db-data-admin/src/LicensorTree.tsx`, `PropertyTable.tsx`), served by two read RPCs that exist on
production: `api.db_data_admin_licensor_property_tree` and `api.db_data_admin_licensor_property_list`.

There is even an **orphan alert** in that screen — the exact feature Q1 asks about
(`LicensorTree.tsx` L149-152):

```tsx
{orphans.length > 0 && (
  <div className="orphan-alert" role="alert">
    <h2>… {orphans.length} orphan propert{…} — no Licensor</h2>
    <p>Every canonical Property is expected to sit under exactly one Licensor. These have a null
       <code>licensor_id</code>. The relationship is DesignFlow-owned; do not repair it here.</p>
```

Two things follow:

1. **The product's own copy answers Q1 in the negative** — "do not repair it here."
2. **That list can never be non-empty.** `core.property.licensor_id` is `NOT NULL` (verified on
   production, `pg_attribute.attnotnull = true`), so a null-licensor property cannot be stored. The
   orphan panel is dead code against the current schema.

The Step 8 write RPCs in DB Data Admin (`api.db_data_admin_update_customer`,
`api.db_data_admin_update_vendor`) explicitly exclude licensor and property. From the header of
`supabase/migrations/20260722170000_db_data_admin_single_record_updates.sql` L36-38:

```text
-- Refused here: name/code (source vocabulary), is_potential (trigger-owned), PLM
-- status (DesignFlow single writer; Vendor PLM has no Factory mapping), aliases,
-- source refs, related Customer, Licensor/Property, merge, bulk, deletion.
```

#### 1.3 DesignFlow PLM — the prior finding is CONFIRMED, and strengthened

The design document's claim was that no endpoint, controller, service, job or admin screen in any of the
six DesignFlow repos writes a licensor/property parent link, and that the only `parent_id` writer handles
Product Type → Sub-Type. **An independent exhaustive re-search of `C:\repos\dflow` VERIFIES it.**

The search that makes the absence credible: `parent_id` across `*.js|*.ts|*.mjs|*.html` in all six repos.
**57 non-test hits outside exclusions; only 4 are writes, all inside one function.** Exclusions were
714 hits in the six vendored `<repo>/shared-db/` mirrors (spot-checked — those files operate on `core.*`
and several do not contain the string `parent_id` at all, so excluding them hides no writer), 176 hits in
a stale duplicate worktree copy of designflow-frontend under `C:\repos\dflow\.agent-work\`, and 0 in
`node_modules`.

**The only `merchGroup.parent_id` writer in existence** —
`C:\repos\dflow\designflow-backend\services\admin.service.js` L510-554:

```js
    if (productSubType && productType) {
      if (!productSubType.parent_id && productSubType.is_active === false) {
        await sql.merchGroup.update({ parent_id: productType.id, is_active: true, … })
```

Note the guard `!parent_id && is_active === false`: it can only *establish a first link on an inactive
row*. **It can never re-parent or unlink an existing row** — so it is not even a general parent-link
writer, let alone a licensor/property one.

Only **three** writers touch the `merchGroup` table at all across all six repos: those two
`sql.merchGroup.update` calls, and the ColdLion sync's `findOrCreate` /`findOrCreateWithSSE` paths in
`designflow-data-syncing/models/lib.model.js` L266, L278, L390, L414. Raw
`INSERT INTO "merchGroup"` / `UPDATE "merchGroup"`: **zero matches repo-wide.** `designflow-bff` writes
nothing.

The merch-group editor screen,
`designflow-frontend/src/app/pages/editor/merch-group-dialog/merch-group-dialog.component.ts`, is the only
screen that edits merch groups. Its type list is a hard-coded three-case switch (L193-205) on `'Material'`
/ `'Construction'` / `'Feature'`. **The words "Licensor" and "Property" do not appear in the file.** It is
further narrowed at L179 to rows created in 2025 only, and it only ever *links* — no
`merchGroup.create` is reachable from any HTTP route.

**Where licensors and properties actually come from, and the finding that matters most for Q3.** The
ColdLion ERP sync is the only creator, and its field mapper —
`designflow-data-syncing/helpers/utility.js` L279-301 `remapMGDetail()` — maps `mg_code`, `mg_desc`,
`mgTypeCode`, `ItemNoCode`, company/division keys, audit fields, `mgCode2`, `mgCategory`. **There is no
`parent_id` key.** Both `findOrCreate` paths write only `Object.keys(record)`, so a key absent from the
mapped object is never written.

> **So ColdLion creates `mgTypeCode='05'` and `'06'` rows with `parent_id = NULL`, and no code path in
> any of the six repos ever fills it in.** This is strong evidence — though not yet proof — that
> DesignFlow **does** hold unparented type-`06` merch groups today, and therefore that the "0 unparented"
> reading in Supabase (§Q3) is an artefact. It raises the priority of the open measurement.

Two confusables that have to be named so nobody re-finds them and thinks the gap is closed:

- **`designflow-frontend/src/app/pages/editor/license-list/license-list.component.ts` is a genuine
  create/edit admin screen** (`startEdit`/`saveEdit` L86-102, `addNew` L104+). It writes the
  **`licenseList` table** — a separate royalty-rate table
  (`designflow-backend/models/db/licenseList.js` L45; columns `licenseList_code/_title/_royalty_rate/_status`)
  with no `mgTypeCode` and no `parent_id`. **This is the single most likely thing to be mistaken for a
  Licensor editor. It is not one.**
- **`properties_and_characters` / `property_character_associations`** are Airbyte-fed and read-only in app
  code (only `SELECT`s, in `designflow-backend/services/autofill.service.js`). AGENTS.md §6.1 already
  warns their names are misleading.

The licensor/property cascade the user sees is **browser-side presentation only** —
`newItem-dialog.component.ts` L1228 and `newArtPiece.component.ts` L531 both
`.filter(x => x.parent_id === Number(licenseId))` over an already-downloaded list, and neither ever sends
`parent_id` back. The Licensor/Property controls in the item dialog write the **item's**
`udf_merchgroup05_fk` / `udf_merchgroup06_fk` on `itemHeader` — an item→licensor assignment, never a
change to the `merchGroup` row.

#### 1.4 PopDAM / PopCRM / PopPIM

At the database level all three are read-only consumers: their only route to `core.property` is
`SELECT`-granted views, and none appears in the §1.1 writer query, which is exhaustive over production.

Repo availability on this machine was checked directly: **`C:\repos\popcrm-web` exists**;
**`C:\repos\popdam3`, `C:\repos\poppim-web`, `C:\repos\poppim`, `C:\repos\popcrm` and `C:\repos\popdam`
do not.** Poppim in particular is not checked out here, so its frontend could not be read — see
§"What I could not verify". `popcrm-web` was checked and has no `merchGroup` reference at all.

### The answer for the merged design: DB Data Admin becomes the curator screen

The design proposes (its §5.2-§5.5) a `core.property_parent_audit` table, a
`core.set_property_licensor(...)` `SECURITY DEFINER` RPC, a `core.property_parent_proposal` queue, and an
`api.licensor_property_picker` view. §6 names DB Data Admin's existing licensor/property tree as "the
natural home for the curator UI". Nothing in that design is built; it is a design.

### Plain English

> Today, changing which licensor a property belongs to is not something anyone can do through any screen.
> It requires a database engineer running SQL by hand with the highest level of database access. The one
> screen that comes closest — the Licensor/Property tree in DB Data Admin — shows you the structure and
> explicitly tells you not to edit it there. There is also no such thing as an "unassigned property" list,
> because the database physically refuses to store a property that has no licensor.

---

## Q2. Is DesignFlow ready to use our Supabase licensor → property parent-child structure?

### **NO.** Not today, and the gap is bigger than a query change.

**DesignFlow does not read the shared Supabase database at all.** It cannot honour
`core.property.licensor_id` today because it has never seen that column, that table, or that schema.

Evidence, from an exhaustive read-only search of all six `designflow-*` repos:

| Check | Result |
|---|---|
| `@supabase/supabase-js` / PostgREST in any of the six `package.json` | **zero matches** — deps are `pg` + `sequelize` only |
| Any Supabase URL, anon key or service-role key in app code | **none** |
| Any executed query schema-qualified to `core.`, `api.` or `plm.` | **none** — every hit is inside the vendored read-only `shared-db/` mirror, or a prose comment |
| Is the vendored `shared-db/` folder executed by the apps? | **no** — no `require()`/`import` of anything under it from any route, service, model, job or npm script |
| Does DesignFlow write anything to the shared Supabase DB? | **no** — the flow is the reverse: DesignFlow *exposes* read-only master-data export endpoints that shared-db tooling pulls |

What DesignFlow actually reads is **its own `merchGroup` table, self-joined on `parent_id`**, in its own
schema (`designflow` / `designflow_dev`, from the `SCHEMA` env var). The endpoint that feeds the item
dialog is `GET /api/item_master/lib/getLicensorsWithProperties`
(`designflow-item-master/services/item_library.service.js` L71-138), which queries
`sql.merchGroup.findAll({ where: { is_active: true, mgTypeCode: '06' } })` and groups by `parent_id`.

A confusing detail worth stating plainly so nobody misreads it: **in sandbox/dev/staging, DesignFlow does
connect to a hosted Supabase pooler** (`designflow-item-master/config/database-connection-contract.js`
L87-92 enforces `DB_PROVIDER=supabase`, `DB_PORT=6543`, a `.pooler.supabase.com` host). Production
enforces Cloud SQL on 5432 (L78-81). But in every environment, every model is bound to the `SCHEMA` env
value, and **nothing in the code ever names `core`, `api` or `plm`.** Being on a Supabase pooler is not
the same as reading the shared canonical schema. There is a frontend badge that says "Supabase powered"
(`designflow-frontend/src/app/config/database-provider.config.ts`) — it is cosmetic and has misled at
least one reading of this question.

### What would have to change, and what blocks it

1. **A read path that does not exist.** DesignFlow would need a Supabase client or a cross-schema query
   route. Adding it to production also means production DesignFlow (Cloud SQL, private VPC, port 5432)
   reaching the hosted Supabase project — a network and secrets change owned by `popcre/infrastructure`,
   not by shared-db (AGENTS.md §0.1). This is the real blocker, and it is an infrastructure decision.
2. **An identity mapping that does not exist as a lookup.** DesignFlow keys on integer `mg_id`; Supabase
   keys on uuid. The bridge exists as data (`core.taxonomy_source_ref`) but no DesignFlow code reads it.
3. **A direction-of-truth decision.** Today DesignFlow is the *source* for this edge and Supabase is the
   *mirror* (`plm.import_master_data` derives the Supabase edge from DesignFlow's nesting). Having
   DesignFlow read Supabase's edge reverses that. Until that is ruled on, "ready" is not a technical
   question.

### Plain English

> No. DesignFlow has never talked to the shared database — not one line of its code mentions it. It reads
> its own copy of the licensor/property list from its own table. Right now DesignFlow is the *original*
> and the shared database is the *copy*, so asking DesignFlow to follow the shared database means
> reversing which one is in charge. That is a business decision first and an IT-plumbing job second, and
> the plumbing part sits with the infrastructure team, not with us.

---

## Q3. The two facts, settled against production

**Both claims are TRUE as stated about the Supabase production database — and both are far less
meaningful than they look. The design document's scepticism was correct.**

### Query 1 — parentage

```sql
select
 (select count(*) from core.property)                                          as properties,
 (select count(*) from core.property where licensor_id is null)                as unparented_properties,
 (select count(*) from core.licensor)                                          as licensors,
 (select a.attnotnull from pg_attribute a
   where a.attrelid = 'core.property'::regclass and a.attname = 'licensor_id') as licensor_id_not_null,
 (select count(*) from core.property p
   left join core.licensor l on l.id = p.licensor_id where l.id is null)       as dangling_licensor;
```

| properties | unparented | licensors | `licensor_id` NOT NULL | dangling FK |
|---|---|---|---|---|
| **256** | **0** | **26** | **true** | **0** |

**The `0` is a tautology, not a measurement.** `licensor_id` is `NOT NULL` with an `ON DELETE RESTRICT`
FK to `core.licensor` (`property_licensor_id_fkey`, verified in `pg_constraint`). A non-zero answer is
impossible by construction. This number can never tell you anything about DesignFlow.

### Query 2 — status across every value of `app.entity_status`

```sql
with s as (select unnest(enum_range(null::app.entity_status))::text as st)
select s.st,
 coalesce((select count(*) from core.property p where p.status::text = s.st), 0) as properties,
 coalesce((select count(*) from core.licensor l where l.status::text = s.st), 0) as licensors
from s order by 1;
```

| `app.entity_status` | `core.property` | `core.licensor` |
|---|---|---|
| `active` | **256** | **21** |
| `archived` | 0 | 0 |
| `deleted` | 0 | 0 |
| `inactive` | **0** | **0** |
| `potential` | 0 | **5** |
| **total** | **256** | **26** |

So **256/256 properties are `active`** — confirmed. And there is not one `inactive` row in either table.

### Why that number is also not evidence of anything

Three independent proofs that this is a frozen, filtered snapshot:

1. **Nothing has changed since 8 July.** `max(updated_at)` on `core.property` is
   **2026-07-08 07:30:19 UTC / 03:30:19 America/New_York**. `max(created_at)` is 2026-06-25.
2. **The feed that writes it is dead, and it died silently.** `ingest.sync_run` grouped by source:

   | source_system | source_name | status | runs | last run (UTC) | last run (local) |
   |---|---|---|---|---|---|
   | `designflow_plm` | `plm_master_data_api` | `succeeded` | **15** | 2026-07-08 07:30:19 | 2026-07-08 03:30:19 |
   | `coldlion` | `coldlion_customers_api` | `succeeded` | 3 | 2026-07-17 16:20:42 | 2026-07-17 12:20:42 |
   | `coldlion` | `coldlion_vendors_api` | `succeeded` | 8 | 2026-07-22 23:10:49 | 2026-07-22 19:10:49 |

   **15 runs, every one recorded `succeeded`, zero `failed` rows** — the failure mode is invisible in the
   ledger. The most recent `ingest.sync_run` of any kind on production is 2026-07-22.
3. **The feed structurally cannot deliver a counter-example.** The source endpoint filters
   `is_active: true` on properties and drops any property whose `parent_id` is null, and the payload is
   *nested* (properties inside licensors) so an unparented property has no shape to arrive in.

**Conclusion: production is internally consistent and says nothing about the world.** The open measurement
— how many `mgTypeCode='06'` merch groups in the DesignFlow database are inactive or have a null
`parent_id` — still has not been taken. It requires querying the DesignFlow database directly and is
outside a read-only Supabase scope. See §"What I could not verify".

**New this session, and it shifts the expected answer.** §1.3 establishes from the DesignFlow source that
the ColdLion sync creates every `mgTypeCode='05'`/`'06'` row with `parent_id = NULL` (its field mapper has
no `parent_id` key), and that **no code path in any of the six repos ever fills it in** — the one writer
is hard-scoped to Material/Construction/Feature. Whatever parentage exists in DesignFlow was therefore
put there by hand, historically, outside the application. Every merch group ColdLion has created since
then is unparented unless someone hand-edited it. **The honest expectation is now that DesignFlow holds a
non-zero, probably growing, number of unparented type-`06` rows** — which is exactly what the feed cannot
transmit and what `NOT NULL` cannot store. Step 5 of the merged design should be treated as likely
needed, not likely unnecessary, until counted.

### Extra findings from the same reads

- **Licensor `FR` "FRIENDS TV" is still `active` on production with 1 property.** The 2026-08-02 owner
  ruling that FR was never a real licensor (migration `20260802171000_owner_ruling_friends_tv_frida_kahlo.sql`)
  is **not promoted to production** — `supabase_migrations.schema_migrations` has no row for `20260802171000`.
- **Six licensors have zero properties:** `X-NASA` (NASA), which is `active`, plus the five `potential`
  ones (`X-ANHEUSERBUSCH`, `X-FORD`, `X-MILLERCOORS`, `X-NCAA`, `X-NFL`). **None of these could have
  arrived through the DesignFlow feed**, which drops childless licensors — so they were created by
  another route, consistent with them being the prospective licensors that ruling 2 permits.
- **Five migrations in this family are absent from production.** `to_regclass` and the ledger both
  confirm: `20260726180000`, `20260729230000`, `20260731210000`, `20260802170000`, `20260802171000` — none
  present. Consequently `core.licensor_alias`, `plm.coldlion_promotion_audit`,
  `plm.taxonomy_parallel_observation` and `plm.taxonomy_circuit_breaker_event` **do not exist on
  production**, and neither does the `parent_edge_hash` / `property_status_hash` drift detector.

---

## Q4. "Am I wrong that the only downside of forcing every property back to 'active' is crowded dropdowns?"

### Short verdict

**Albert is essentially right — but for a reason that should worry him more than the question did, and
with two real exceptions he has not been told about.**

He is right that in the **shared Supabase database**, `core.property.status` is close to cosmetic. He is
wrong in one direction and one direction only: **in DesignFlow — the system where he actually does the
inactivating — the flag is not cosmetic at all. It hard-blocks item creation.** And separately, the thing
that makes "I'll go back and inactivate again later" risky is not the status column; it is that a broken
importer will silently undo his work the moment it is repaired.

### 4.1 What `status` actually controls — the empirical audit

I enumerated **every** view, materialized view and function on production whose body references
`core.property` or `core.licensor` (15 objects), then extracted every `status` reference in each. This is
the whole surface, not a sample.

| Object | Kind | What it does with licensor/property `status` | Consequence |
|---|---|---|---|
| `api.db_data_admin_licensor_property_list` | function | **FILTERS**: `l.status in ('active','potential')`, `p.status in ('active','potential')` | Real. An `inactive` row disappears from the DB Data Admin property list. |
| `api.db_data_admin_licensor_property_tree` | function | **FILTERS**: same predicate, 5 occurrences | Real. Same screen, tree view. |
| `plm.import_master_data` | function | **WRITES** `status = 'active'` (both branches) | Real, and the big one — see §4.3 |
| `plm.import_item_master_data` | function | **NO status predicate at all** — see §4.2 | Real, and the important one |
| `public.search_style_tracker_link_candidates` | function | `order by (r.status = 'active') desc` — a **tie-break**, not a filter | Cosmetic (ranking only) |
| `api.coldlion_licensor_reconciliation` | view | `cl.status IS DISTINCT FROM 'active'` used as a **divergence flag** | Reporting only, and see §4.4 |
| `api.coldlion_property_reconciliation` | view | `cp.status IS DISTINCT FROM 'active'` + exposes `parent.status` | Reporting only, and see §4.4 |
| `api.pm_product_board` | view | `LEFT JOIN core.licensor l` / `LEFT JOIN core.property prop`, **no WHERE, no status filter**. The `p.status` in its body is `pim.product`, not property. | None |
| `api.pm_pipeline_page` / `_count` | function | `p.status` is `pim.product`; `lifecycle_status`/`clickup_status` are unrelated | None |
| `api.plm_item_status` | view | `status` references are item / licensing / production status | None |
| `api.dam_asset_library` | view | only `workflow_status` | None |
| `public.dam_character_catalog` | view | no status reference | None |
| `public.style_tracker_rows_with_bridge` | view | concept/license/match/pre-production/production status — none of them property status | None |
| `plm.refresh_style_tracker_item_bridge` | function | concept/license/match/production status only | None |

**And the structural surface is completely empty.** On `core.property` and `core.licensor`, production has:

- **No CHECK constraint** referencing `status`. (Only `property_licensor_id_code_key`,
  `property_licensor_id_fkey`, the two primary keys and `licensor_code_key`.)
- **No index** with a status predicate. (Only the PKs and the two unique code indexes.) A repo test
  string about an "active-status predicate" refers to `plm.taxonomy_resolution_review`'s workflow
  statuses, not `app.entity_status` — checked, not assumed. **So forcing rows to `active` cannot cause a
  unique-constraint violation.**
- **No trigger** except `set_updated_at`.
- **No RLS policy** referencing `status` — both policies gate on `app.has_role(...)` only.

### About the "~63 filters" figure

I could not reproduce 63 as a count of licensor/property status filters, and **it is not one.** In this
repo, `status … = 'active'` appears **113 times across 42 SQL migration files plus app code**, spanning
`core.customer`, `core.factory`, `core.creative_designer`, CRM user lists, ClickUp, style-tracker
designer resolution and more. It is a house style, not a property-status surface. **Filtered to
licensor/property status on live production, the true count of read filters is two RPCs — both of them
the DB Data Admin curator screen, and both using `in ('active','potential')`, not `= 'active'`.**

### 4.2 The status-blind WRITE path — VERIFIED

The claim was that `plm.import_item_master_data` matches `core.property` by `code` with no status
predicate. **Confirmed verbatim from `pg_get_functiondef` on production:**

```sql
left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
  (array_agg(licensor_id order by id))[1] parent_id from core.property where code = b.merch_group_06) pc on true
left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
  (array_agg(licensor_id order by id))[1] parent_id from core.property
  where code = b.merch_group_06 and licensor_id = lc.candidate_id) sp on true
```

No `status` anywhere in the property resolution. An item can bind to an `inactive`, `archived` or
`deleted` property.

**I searched for other status-blind write paths and found no additional ones** — because there are no
additional write paths at all. `plm.import_master_data` is the only function on production that writes
`core.property`/`core.licensor` (§1.1), and it is status-blind on match too (it resolves by
`taxonomy_source_ref`, then by code, then by lower(name)).

**This cuts in Albert's favour.** Because the only write paths already ignore status entirely, **making
everything `active` cannot change any write behaviour.** Nothing starts binding that was not already
binding. It also means the reverse: inactivating a property in Supabase never stopped anything from
attaching to it, so the inactivations were never doing the protective work they might appear to.

### 4.3 The thing that actually matters, and it is not the crowded dropdown

`plm.import_master_data` on production, verbatim, in the *existing-property* branch:

```sql
update core.property
set licensor_id = parent_core_licensor_id,
    name = v_source_name,
    code = coalesce(v_source_code, code),
    status = 'active',
    metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
where id = core_property_id;
```

and the same `status = 'active'` in the licensor branch.

**The system already forces everything back to `active` on every successful import — and it overwrites
the parent link at the same time.** Migration
`20260802170000_plm_import_preserve_curated_licensor_property_status.sql` was written specifically to
remove that, and **it is not on production** (no ledger row; confirmed). Commit `3501973` promised
"durable curated licensor/property status". On production, that durability does not exist.

The only reason this is not biting today is that the feed has been dead since 2026-07-08.

### 4.4 Does status touch anything financial, royalty, reporting or audit?

- **Financial / royalty: no.** Royalty logic lives on the style-guide/character axis
  (`core.licenseList`, `core.properties_and_characters`, `core.property_character_associations`,
  `plm.licensing_status`). None of the 15 objects that touch `core.property`/`core.licensor` performs a
  rate, fee or royalty calculation, and no royalty object filters on `app.entity_status`.
- **Reporting: yes, mildly, in one place.** The two `api.coldlion_*_reconciliation` views compute
  `status IS DISTINCT FROM 'active'` as a **divergence flag**. Forcing everything to `active` would make
  those flags read "no divergence" — i.e. it would erase a signal, not create a bad number. Nobody is
  currently consuming them for a business decision.
- **Audit: no.** There is no audit table for licensor/property status or parentage on production.
  `plm.coldlion_promotion_audit` does not exist there, and it is barred from recording the edge anyway.
  **A status change today leaves no trace at all** other than `updated_at`.
- **Drift alarms: no, on production.** The `property_status_hash` / `parent_edge_hash` snapshot guard
  lives in `20260726180000`, which is **not on production**. On preview it *does* hash every property's
  status, so a mass status change there would trip a baseline mismatch. Production has no such alarm.

### 4.5 Is re-inactivating later actually easy?

**Mechanically: yes, and no easier or harder than it is now** — a `service_role` UPDATE. It is exactly as
awkward before and after, because there is no screen either way (Q1).

**But three things make it less clean than "just flip it back":**

1. **Rows attach and stay attached.** Production already has **49,309 rows in `public.assets` bound to
   179 distinct properties**, and **2,720 rows in `public.style_groups` bound to 101 properties**
   (`dam.asset`, `dam.style_group`, `pim.product`, `plm.item` and `core.character` currently hold zero
   property bindings). Since §4.2 proves nothing checks status on write, anything that attaches while a
   property is `active` keeps pointing at it after you inactivate it. There is no cleanup and no warning.
   Making everything active for a while means more of these bindings can accumulate.
2. **You will not be able to tell which ones you changed.** No audit trail (§4.4). If you force all 256 to
   `active` today, there is no record of which ones were `inactive` beforehand. **If you do this, capture
   the current status of all 256 rows to a file first** — that snapshot is the only way back to your
   original curation, and today it costs nothing to take.
3. **The importer will undo it for you, in the wrong direction.** Per §4.3, whenever the DesignFlow feed
   is repaired, it will force every property it knows about back to `active` and overwrite the parent
   link. Re-inactivating before that fix lands is work that gets thrown away.

### 4.6 The exception Albert has not been told about: DesignFlow

Everything above is about the shared Supabase database. **In DesignFlow — where the dropdown Albert is
thinking of actually lives — `is_active` is a hard gate, not a display preference.**

`designflow-item-master/helpers/itemReferenceGuard.js` L36-46:

```js
async function requireMerchGroup(sql, value, label, required = false, requireActive = true) {
  …
  const where = requireActive ? { mg_id: id, is_active: true } : { mg_id: id };
  const row = await sql.merchGroup.findOne({ where });
  if (!row) throw validationError(`The selected ${label} no longer exists or is inactive.`);
```

and L123-130:

```js
    await requireMerchGroup(sql, body.selectedLicensor, 'Licensor',
      isNewItemFieldRequired('licensor', divisionId), false);   // active check DISABLED
    await requireMerchGroup(sql, body.selectedProperty, 'Property',
      isNewItemFieldRequired('property', divisionId));          // active check ON (default true)
```

So in DesignFlow:

- **Property**: inactive ⇒ dropped from the dropdown **and rejected on save** with "no longer exists or is
  inactive". Reactivating it re-enables item creation against it.
- **Licensor**: the active check is deliberately switched off, with an explicit comment (L94-95) that
  MG05's `is_active` is a legacy flag that does not mean "unselectable". So licensor status there is
  already close to meaningless.

Note also that DesignFlow does **not** validate that the chosen property actually belongs to the chosen
licensor — both calls check existence only. The cascade is browser-side filtering, so a direct API call
can submit any pair.

### The direct answer, in plain business English

> **You are basically right, and here is the precise version.**
>
> **In the shared database, yes — status is very close to cosmetic.** I checked every screen, report,
> view and rule in that database that touches licensors or properties. Only one place hides an inactive
> property: the Licensor/Property screen in DB Data Admin. Everywhere else — the PopPIM product board,
> the PopDAM asset library, the PLM item views, the search — shows them regardless. There is no
> royalty, invoice or financial number that changes. There is no rule, no safety check and no index
> that depends on it. So the crowded-dropdown reading of the shared database is correct.
>
> **But three things you should know before you do it.**
>
> **One — the dropdown you are actually thinking of is probably DesignFlow's, and there it is not
> cosmetic.** In DesignFlow, an inactive property is not just hidden from the list; the system refuses
> to save a new item against it. Making everything active there does not only crowd the list, it
> re-opens every one of those properties for new items to be created against. That may be exactly what
> you want while sorting the data out — just know it is a real change in behaviour, not a display
> tweak. (Licensors are different: DesignFlow already ignores the active flag on licensors entirely.)
>
> **Two — inactivating never protected anything in the shared database, and it still won't.** I checked
> the import routines that attach items to properties: they match purely on the property code and never
> look at whether it is active. So an inactive property could always still pick up new items. Today
> there are already 49,309 asset records and 2,720 style-group records pointing at properties, and
> nothing cleans those up or warns you when you inactivate. Anything that attaches while a property is
> active stays attached afterwards.
>
> **Three — and this is the one that would cost you the work.** The DesignFlow import routine that
> refreshes licensors and properties *already forces every property back to "active" every time it
> runs*, and it also overwrites which licensor each property belongs to. A fix for that was written on
> 2 August, but I verified it has **not** been applied to the live database. The only reason it is not
> hurting you is that this feed has been broken since 8 July and has not run since. So: your
> inactivations are not durable today, and the moment someone repairs that feed, both your inactivations
> **and any parent links you have curated by hand** get wiped. That fix should go live before the feed
> is repaired.
>
> **My recommendation.** Forcing everything to active is a low-risk, reversible thing to do in the
> shared database — with one cheap precaution: **have me save a snapshot of the current status of all
> 256 properties to a file first.** There is no history table, so without that snapshot there is no
> record of which ones you had turned off, and "go back and inactivate again" becomes guesswork.
> Separately, and more importantly than this question: get that 2 August fix applied to the live
> database, because right now nothing you curate by hand is safe from the next import.

---

## What I could not verify, and what it would take

| Not verified | Why | What would close it |
|---|---|---|
| **How many `mgTypeCode='06'` merch groups in the DesignFlow database are inactive or have a null `parent_id`.** This is the single most important open number — it gates step 5 of the merged design. | It requires querying the DesignFlow database directly. That is Cloud SQL on a private VPC in production, whose secrets are unsuffixed production secrets that AGENTS.md §0.1 puts off-limits without an explicit owner request. **UPDATE 2026-08-10:** owner ruling AGENTS.md §0.1-A now permits a read-only connection to that database from this repo using the read-only credential in 1Password vault `vibe_coding` (the production *secrets* remain off-limits), so this count can now be measured directly — counts only, never row contents. The endpoint that would otherwise answer it structurally cannot represent either case, and has been dead since 2026-07-08. | Owner authorisation to read the DesignFlow **sandbox** database (hosted Supabase pooler, `_SANDBOX` secret tuple, schema `designflow_dev`) — read-only — or a one-off count run by whoever holds production DesignFlow DB access. Two `SELECT count(*)` statements. |
| **Whether PopPIM or PopDAM frontend code filters property/licensor status client-side.** | Neither repo is checked out on this machine — `C:\repos\poppim-web`, `C:\repos\poppim`, `C:\repos\popdam3` and `C:\repos\popdam` all do not exist. (`C:\repos\popcrm-web` does exist and was checked.) Database-side I proved there is no filter, so any browser-side filter would be an additional cosmetic-only surface. | Clone `u2giants/poppim-web` and `u2giants/popdam3` and grep for `status` near `property`/`licensor`. It cannot change the verdict — a client-side filter is by definition cosmetic — so this is completeness, not risk. |
| **Whether PopPIM stores licensor/property ids in its own tables** (a residual risk the merged design flagged and could not close). | I closed this one from the database side instead: `pim.product`, `pim.product_submission` and `pim.project` all carry real FKs to `core.licensor` and `core.property`. **`pim.product.property_id` currently holds 0 rows**, so the coupling exists but is unused today. | Nothing further — this is now answered. |
| **Whether DesignFlow's real database has any FK, unique or cascade on `merchGroup.parent_id` beyond the Sequelize model.** | DesignFlow has no migration directory and no SQL DDL outside the vendored mirror; the model declares only `merchGroup_pkey`. | The same DesignFlow database read as row 1 — one `pg_constraint` query. |

## What was deliberately NOT done

- No migration authored, and none proposed as a deliverable.
- No database write of any kind, to preview or production. Every statement was a `SELECT`.
- `plm.check_taxonomy_sync_health()` was **not** called — it inserts alert rows.
- No alert acknowledged, no circuit breaker reset. Preview's unacknowledged alerts and tripped breaker
  were left exactly as found.
- No change to any dflow repo — read-only, no branch switched, no file touched, no commit.
- No merge. PR opened and stopped.
