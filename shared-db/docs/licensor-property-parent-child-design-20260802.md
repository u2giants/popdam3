# Licensor → Property parent-child logic: where it lives, what is missing, and the correct home

**Status:** DESIGN AND DISCOVERY ONLY. No migration authored, no database written, no app repo changed.
**Author:** sub-agent `parent-child-design`, dispatched by the shared-db coordinator.
**Date:** 2026-08-02 / 2026-08-03.
**Reviewed by:** Kimi K3 (see §9).

---

## 0. The headline, before anything else

**The Licensor → Property parent-child *structure* is already in the shared database, and it is already
live in production.** It is not a bridge table, not a proposal, not a plan — it is a scalar `NOT NULL`
foreign key on `core.property`, enforced with `ON DELETE RESTRICT`, and it currently holds 256
properties under 26 licensors with **zero** unparented rows.

Anyone briefed as "bring the dflow parent-child logic into Supabase" should stop and re-read that
sentence. The structure landed on 2026-07-24. What is genuinely missing is **not the relationship —
it is the human curation path for it.** Today there is no screen, no API, no RPC and no grant that
lets a person set or change a property's licensor. The edge can only be changed by someone with
`service_role` or `postgres` running raw SQL.

That is the change this document designs.

### Proof of the claims above (production, read-only)

Target proof, per `AGENTS.md` §4.2: `get_project_url` returned
`https://qsllyeztdwjgirsysgai.supabase.co` — **production** `qsllyeztdwjgirsysgai`. Every statement
run for this document was a `SELECT`. No `INSERT`, `UPDATE`, `DELETE`, `DDL` or migration was run
against either database.

| Question | Production answer |
|---|---|
| `core.property.licensor_id` nullable? | **NO** — `NOT NULL` |
| FK delete action | `r` = **ON DELETE RESTRICT** |
| Licensors | **26** (21 `active`, 5 `potential`) |
| Properties | **256** (all `active`) |
| Unparented properties | **0** |
| Any licensor↔property bridge/junction table anywhere | **0** |
| Write path for the edge (function) | **none** — only two READ RPCs exist: `api.db_data_admin_licensor_property_list`, `api.db_data_admin_licensor_property_tree` |
| `core.property` grants to `authenticated` | **`SELECT` only** |
| `core.property` RLS policies | `shared_read` (SELECT), `admin_write` (ALL) |

The last two rows together are the crux. `admin_write` exists as a policy but `authenticated` has no
`INSERT`/`UPDATE` **grant** on `core.property`. Per `AGENTS.md` §11, an RLS policy is not a grant, so
the policy is currently unreachable from any browser session. The write path is dead on arrival at the
privilege check, before RLS is ever consulted.

---

## 1. Where the logic actually lives in DesignFlow PLM

### 1.1 It is one self-referencing table, discriminated by type code

There is no `licensor` table and no `property` table in DesignFlow. Both are rows in a single
`merchGroup` table, told apart by `mgTypeCode`, and the parent edge is a bare nullable integer
`parent_id` pointing back at the same table.

`C:\repos\dflow\designflow-backend\models\db\merchGroup.js` L59-66:

```js
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    parent_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
```

There is **no FK constraint, no unique constraint and no cascade** on `parent_id` in the model
(L75-88 declares only the `merchGroup_pkey` index). The real database constraints, if any exist beyond
the model, could not be verified from the repos — DesignFlow has no migration directory and no SQL DDL
outside the vendored `shared-db` copy.

The type codes are named in exactly one place,
`C:\repos\dflow\designflow-item-master\services\item_library.service.js` L20-21:

```js
const LICENSOR_MERCH_GROUP_TYPE = '05';
const PROPERTY_MERCH_GROUP_TYPE = '06';
```

`mgTypeCode` is resolved to a human label through `merchGroupHeaders`
(`C:\repos\dflow\designflow-backend\models\db\merchGroupHeaders.js` L3-46), keyed on
`(companyCode, divisionCode, mgTypeCode)`. This is the same division-scoped resolution `AGENTS.md`
§6.1 rule 1 demands, and it is why `05` cannot be trusted to mean "Licensor" outside CW001/SP001.

Do **not** confuse any of the above with `licenseList` or `properties_and_characters` — those are a
separate royalty/character layer keyed to `licenseList_id`, not to `merchGroup`. Two prior sessions
have already been corrupted by reading those table names literally (`AGENTS.md` §6.1).

### 1.2 Where the edge is WRITTEN — nowhere in application code

This is the most important discovery on the dflow side, and it is a discovery by exhaustive absence.

**No API endpoint, controller, service, job or admin screen in any of the six DesignFlow repos creates
or edits a Licensor → Property link.**

The only writer of `merchGroup.parent_id` anywhere outside `node_modules` and the vendored `shared-db`
folder is `AdminService.updateMerchGroup`,
`C:\repos\dflow\designflow-backend\services\admin.service.js` L510-554:

```js
        if (!productSubType.parent_id && productSubType.is_active === false) {
          await sql.merchGroup.update(
            {
              parent_id: productType.id,
              is_active: true,
```

Its UI, `designflow-frontend/src/app/pages/editor/merch-group-dialog/merch-group-dialog.component.ts`,
has a `switch` at L193-205 containing only `Material` / `Construction` / `Feature` cases, and `onSave()`
(L248-275) submits only product-type fields. **There is no Licensor or Property branch.** That code path
is Product Type → Sub-Type → Sub-Sub-Type only.

The ColdLion ERP sync never touches it either:
`C:\repos\dflow\designflow-data-syncing\models\lib.model.js` L245-287 and L343-424 `findOrCreate` on a
natural key of `mgTypeCode + mg_desc + mg_code + ItemNoCode + divisionCode_fk + companyCode_fk`, with
zero references to `parent_id` in the entire file.

**Conclusion: in DesignFlow, the Licensor → Property edge is hand-curated directly in the database by a
human with SQL access. There is no "logic" to port, because there is no application logic. There is a
column and a convention.**

This is consistent with, and independently confirms, the owner ruling that parentage must be curated —
and it explains why: nothing has ever inferred it, in either system.

### 1.3 Where it is VALIDATED — it is not

DesignFlow does **not** check that a chosen Property actually belongs to the chosen Licensor.
`C:\repos\dflow\designflow-item-master\helpers\itemReferenceGuard.js` L123-130:

```js
    await requireMerchGroup(sql, body.selectedLicensor, 'Licensor',
      isNewItemFieldRequired('licensor', divisionId), false);
    await requireMerchGroup(sql, body.selectedProperty, 'Property',
      isNewItemFieldRequired('property', divisionId));
```

Both calls check only *existence* (and, for Property, the active flag — the trailing `false` on
Licensor deliberately disables the active check, because per L94-95 `is_active` on MG05 is a legacy
flag that does not mean "unselectable"). **Nothing compares the property's `parent_id` to the submitted
licensor.** The UI filters the dropdown, but a direct API call can submit any pair it likes.

### 1.4 Where it is CONSUMED — a client-side cascading dropdown

`designflow-frontend/src/app/pages/itemLibrary/newItem-dialog/newItem-dialog.component.ts` L1227-1228:

```ts
this.filteredOptions.propertyOptions = this.propertyOptions
    .filter(feature => feature.parent_id === Number(licenseId))
```

with the licensor/property option lists built at L776-795 and the Property control reset when Licensor
is cleared at L536-544. That filter is the entire user-visible behaviour of the parent-child
relationship in DesignFlow. It is presentation logic running in the browser, over a list already
fetched in full.

### 1.5 The master-data sync — and exactly where it drops rows

`designflow-item-master/services/item_library.service.js` L71-138, served at
`GET /api/item_master/lib/getLicensorsWithProperties`, consumed by
`shared-db/tools/sync-plm-master-data.mjs` L16-17. It drops rows in **three independent places**:

```js
    const propertyWhereClause = {
      is_active: true,                              // (a) inactive properties dropped
      mgTypeCode: PROPERTY_MERCH_GROUP_TYPE,
    };
```

```js
      if (property.parent_id === null || property.parent_id === undefined) {
        return;                                     // (b) unparented properties dropped
      }
```

```js
      .filter((licensor) => licensor.properties.length);  // (c) childless licensors dropped
```

Note the asymmetry: **licensors are selected with no `is_active` filter at all** (L102-112), properties
with one. And because the payload is *nested* JSON — properties inside their licensor — a property that
has no parent is not merely flagged, it is structurally unrepresentable. `plm.import_master_data()`
derives the property's licensor from the nesting itself
(`20260723140000_...sql` L448, `parent_core_licensor_id := core_licensor_id`).

**This feed has been dead since 2026-07-08 (502, silently).** The most recent `ingest.sync_run` row of
any kind on production is `2026-07-22 19:10:49-04`. So the 256 parented properties in production are a
frozen snapshot, and the claim "0 unparented properties" describes only what the feed was ever capable
of delivering. It is not evidence that DesignFlow has no unparented properties — the feed cannot
express one.

---

## 2. What already exists in shared-db

### 2.1 `core.property` — the parent edge, already canonical

`supabase/migrations/20260621150815_app_core.sql` L191-201 created it, and
`20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` L69-77 hardened it:

```sql
alter table core.property drop constraint if exists property_licensor_id_fkey;

alter table core.property
  alter column licensor_id set not null;

alter table core.property
  add constraint property_licensor_id_fkey
  foreign key (licensor_id)
  references core.licensor(id)
  on delete restrict;
```

The column comment at L79 is already the architectural ruling in writing:

> ENFORCED neutral cross-app authority (Phase 1, 20260724030000): every Property has exactly one
> Licensor via this scalar NOT NULL FK to core.licensor(id) ON DELETE RESTRICT. Never model as a
> many-to-many bridge or app-code map. ColdLion does not own this edge…

Both of those, I verified, are **live on production**.

`unique nulls not distinct (licensor_id, code)` scopes the property code to its licensor — the
schema already respects the "codes are unique only within a scope" rule rather than treating a code as
globally unique.

> **CONFIRMED AS AN OWNER RULING — 2026-08-06.** Albert Hazan ruled that licensor→property is a
> parent-child relationship and that **property codes are NOT globally unique**; the same code may
> exist under many licensors. The schema was already right; the *sessions* were not. See `AGENTS.md`
> §6.10 ruling 3, which also records that `tools/validate-licensing-answers.mjs` (property lookup,
> ~lines 86–92) still resolves by `code` alone and **must be scoped before the feed is repaired**,
> or it will bind rows to the wrong licensor silently.
>
> Same date, related ruling: **the code alone is meaningless — the DESCRIPTION decides the
> licensor.** The live `CC` case proves it: one `CC` row named `COCO` sits under licensor `ZZ`
> (DTR - NO LICENSE) and all 14 items filed there are Coca-Cola merchandise by description.

### 2.2 `core.licensor`

`20260621150815_app_core.sql` L180-189. Never altered structurally — only data migrations and column
comments since. Production: 26 rows, 21 `active`, 5 `potential`.

### 2.3 `core.licensor_alias` — and the surprise about it

`20260731210000_core_licensor_alias.sql` L118-198. Two approval states via CHECK constraint:
`'inherited_unverified'` and `'owner_approved'`, with `licensor_alias_approval_requires_evidence`
forcing `approved_by` + `approved_at` + `approval_evidence` to all be present before a row may claim
approval, and `licensor_alias_unverified_has_no_approval` forcing them all absent otherwise.

**It is NOT on production.** `to_regclass('core.licensor_alias')` returns `null`. Nor is
`plm.coldlion_promotion_audit`. Both exist only in migration files / preview.

**What it is for, and how it relates to this design:** `core.licensor_alias` resolves *observed name
strings* (PopSG folder names like `NBCU`, `NBCUniversal`) to a canonical `core.licensor`. It is a
**naming** table — "these words mean this licensor". It is **not** a parentage table and does not
overlap with the edge. But its *approval mechanics* are exactly the pattern this design needs, and they
are already owner-blessed and already regression-tested. Reuse the shape; do not reuse the table.

### 2.4 What does NOT exist

- **No bridge table.** Confirmed by search and by production query. Explicitly forbidden by
  `20260724030000_...` L30: "No EAV, no many-to-many licensor↔property bridge."
- **No write path for the edge.** No RPC, no grant, no policy that a real user can reach.
- **No representation of an unparented property.** `NOT NULL` makes it impossible by construction.
- **No audit trail for edge changes.** `plm.coldlion_promotion_audit` exists in files, is append-only,
  and is *explicitly barred from recording the edge*: "ColdLion can never be recorded as the author of
  a canonical id, status, parent edge, or code" (`20260729230000_...sql` L89-131). Nothing records a
  *human* changing it either.
- **No conflict surface for a proposed link.** `plm.taxonomy_resolution_review` maps ColdLion source
  keys to canonical rows; it does not propose parentage.

---

## 3. The gap, in the three requested categories

### (a) Genuinely missing structure

1. **A curation write path.** No RPC, no grant. A person cannot change a property's licensor from any
   application. This is the whole of the real gap.
2. **An audit record of who re-parented what, when, and on what evidence.** The edge is a
   cross-application fact that four apps read; today it can change with no trace.
3. **A representation for "this property has no confirmed parent yet."** `NOT NULL` means a property
   that arrives without a ruling cannot be stored at all. Today that is invisible because the only
   inbound feed drops such rows before they arrive — and that feed is dead.
4. **A suspected-link queue.** Co-occurrence audit output (permitted as an audit tool only) has nowhere
   to land for a human to rule on.

### (b) Logic that exists but lives in the wrong layer

5. **The cascade filter is client-side only** — `newItem-dialog.component.ts` L1227-1228 filters an
   already-downloaded list in the browser. Every other app that wants a licensor-scoped property picker
   must reimplement it. It belongs in a shared `api.*` view, once.
6. **Pair validation is absent everywhere.** DesignFlow's `itemReferenceGuard` checks existence but
   never that the property belongs to the licensor. Any app can persist a mismatched pair via a direct
   API call. Integrity of a cross-app fact belongs in the database, not in one app's guard.

### (c) Things that only LOOK missing because the dead sync hides them

7. **"There are no unparented properties" is unproven.** Production reads 0, but the feed that
   populates it structurally cannot transmit one (§1.5b), has been dead since 2026-07-08, and last ran
   anything at all on 2026-07-22. **Do not design on the assumption that 0 is the true number.** Before
   any `NOT NULL` decision is finalised, someone must count unparented `merchGroup` type-`06` rows
   directly in the DesignFlow database, bypassing the endpoint.
8. **"There are no inactive properties" is likewise unproven** — production shows 256/256 `active`,
   but filter (a) drops inactive properties at source, and ColdLion has no active flag at all.
9. **Childless licensors are invisible.** Filter (c) drops them. A real licensor with no properties yet
   — precisely a *prospective* licensor, the only kind ruling 2 permits creating — cannot arrive
   through this feed.

---

## 4. The correct place — the actual question Albert asked

**Answer: the relationship itself is already in the correct place and must not be moved. The curation
of it belongs in `core`, as an RPC plus an audit table, not in any app schema and not in a bridge
table.**

### 4.1 Why the edge stays exactly where it is

A scalar `NOT NULL` FK on `core.property` is correct because the relationship is genuinely 1-to-many
and genuinely cross-application. `core` is the schema for identity and classification facts that more
than one app needs (`AGENTS.md` §4.1), and licensor→property is read by all four. A bridge table would
permit a property under two licensors, which is not a thing that exists in the business and which the
Phase 1 migration comment explicitly forbids. The per-app extension-table rule (§4.1) does **not**
apply: this is not an app-specific attribute.

### 4.2 Why curation belongs in `core`, not in an app

The edge is written rarely, by a small number of authorised people, and every app depends on the
result. If PopDAM owned the write path, the other three would be depending on PopDAM's availability and
PopDAM's role model for a fact none of them can get anywhere else. Putting the write path in `core` as
a `SECURITY DEFINER` RPC gives one implementation, one set of invariants, one audit trail, and lets any
app call it under its own role check.

### 4.3 Why not extend `core.licensor_alias`

Different question entirely. The alias table answers "what strings name this licensor". This design
answers "which licensor owns this property". Overloading one table with both would produce a table
where half the rows have no `licensor_id` semantics in common with the other half. **Copy its approval
grammar; do not extend it.** Specifically, copy: the two-state `approval_status` CHECK, the
"approved rows must carry approver + timestamp + evidence" constraint, and the "unapproved rows must
carry none of them" mirror constraint. Those three constraints are what make it impossible to record an
approval that nobody actually gave, which is exactly the guarantee ruling 1 requires.

### 4.4 Why the status quo is not acceptable

Leaving it as-is means the only way to correct a wrong parent is raw SQL under `service_role`. That is
how the 2026-07-31 production incident happened — a correct action that was indistinguishable from an
accident because nothing recorded it. Ruling 4 says do not harden Master Data writes; it does not say
leave a cross-app structural fact with no write path and no audit at all.

---

## 5. The design

### 5.1 Principles this design is built to satisfy

- **P1.** No code path may create or change a parent-child link without a named human and recorded
  evidence. Enforced by CHECK constraints, not by convention.
- **P2.** Co-occurrence and any other automated signal may only *propose*. Proposals live in a separate
  table that has no privilege to write `core.property.licensor_id`.
- **P3.** Nothing here creates a licensor. Ruling 2 stands: discontinued licensors are never created;
  only prospective ones may be non-ColdLion.
- **P4.** No lookup anywhere keys on a code alone. All source keying is
  `(company, division, mg_type_code, mg_code)`.
- **P5.** Additive only. No existing column changes type, nullability or meaning in step 1 or 2.

### 5.2 Step 1 — `core.property_parent_audit` (append-only)

The first migration, and safe on its own. Records every change to `core.property.licensor_id`.

- `id uuid pk`
- `property_id uuid not null references core.property(id) on delete restrict`
- `previous_licensor_id uuid null references core.licensor(id) on delete restrict`
- `new_licensor_id uuid not null references core.licensor(id) on delete restrict`
- `decided_by text not null` (CHECK non-blank)
- `decided_at timestamptz not null default now()`
- `decision_evidence text not null` (CHECK non-blank — a sentence, a ticket, a quote from Albert)
- `source_channel text not null` CHECK in `('owner_ruling','curator_ui','migration_backfill')`
- `created_at timestamptz not null default now()`

Append-only, in the same family as `plm.coldlion_promotion_audit` and covered by the §6.3 scope note
that keeps evidence tables undeletable. **No `UPDATE`/`DELETE` grant to anyone but `postgres`.**

`previous_licensor_id` is nullable because the very first row for a property (and any backfill of the
existing 256) has no predecessor.

### 5.3 Step 2 — `core.set_property_licensor(...)`, a `SECURITY DEFINER` RPC

The only supported way to change the edge.

Signature (illustrative):
`core.set_property_licensor(p_property_id uuid, p_new_licensor_id uuid, p_decided_by text, p_decision_evidence text) returns uuid`

It must, in one transaction:

1. Reject unless the caller passes the app-schema role check (`app.has_any_role(...)`) — the same axis
   PopDAM access already runs on. **Do not gate on `public.app_role`**; that enum is `admin | user`
   only and cannot express a curator.
2. Reject a blank `p_decided_by` or blank `p_decision_evidence`. No anonymous, unevidenced re-parenting.
3. Reject if `p_new_licensor_id` does not exist or is `deleted`/`archived`.
4. Reject if it would collide with `unique nulls not distinct (licensor_id, code)` — i.e. the target
   licensor already has a different property with the same code. Return a plain-English error naming
   both properties, not a raw constraint violation.
5. No-op cleanly (and record nothing) if the new licensor equals the current one.
6. `UPDATE core.property SET licensor_id = ...`.
7. `INSERT` the audit row with `source_channel = 'curator_ui'`.
8. **Record `auth.uid()` alongside the claimed decider.** Add `decided_by_uid uuid null` to the audit
   table and populate it from the session. `p_decided_by` is a human-readable label; it is not
   identity, and §4.3 must not be read as claiming otherwise. (Added after Kimi review.)

**Audit completeness must be structural, not conventional.** Add a trigger on `core.property` that
fires when `licensor_id` changes and writes an audit row unconditionally. The RPC supplies decider and
evidence through a transaction-local setting; any change arriving by another route is recorded with
`source_channel = 'out_of_band'` and a null decider. Without this trigger, a direct `service_role`
UPDATE leaves no trace — which is precisely the evidence gap §4.4 exists to close. (Added after Kimi
review; `'out_of_band'` joins the `source_channel` CHECK list in §5.2.)

**Standing prohibition to state in the migration comment:** `authenticated` must never be granted
`INSERT`/`UPDATE`/`DELETE` on `core.property`. This repo has shipped exactly that "RLS ≠ grant" fix
for `crm.*` tables before (`AGENTS.md` §11), and doing it here would route writes around the RPC and
around the audit trail. Curation goes through the RPC or it does not happen.

Then, per `AGENTS.md` §10.2:
`revoke execute … from public, anon; grant execute … to authenticated, service_role;`
— stated explicitly in the migration, because the event trigger will strip `anon` and PUBLIC anyway and
silence is not a grant.

### 5.4 Step 3 — `core.property_parent_proposal` (the audit tool's landing pad)

Where co-occurrence output, ColdLion divergence, or a curator's hunch goes to await a ruling. It has
**no** ability to change `core.property`.

- `id uuid pk`
- `property_id uuid not null references core.property(id) on delete restrict`
- `proposed_licensor_id uuid not null references core.licensor(id) on delete restrict`
- `evidence_kind text not null` CHECK in `('product_co_occurrence','coldlion_divergence','curator_note','popsg_folder_observation')`
- `evidence_detail jsonb not null default '{}'::jsonb`
- `confidence numeric null`
- `status text not null default 'open'` CHECK in `('open','accepted','rejected','superseded')`
- `ruled_by text null`, `ruled_at timestamptz null`, `ruling_evidence text null`
- CHECK: `status = 'open'` ⇒ all three ruling columns NULL
- CHECK: `status in ('accepted','rejected')` ⇒ all three ruling columns NOT NULL and non-blank
- `unique (property_id, proposed_licensor_id) where status = 'open'`

The last two CHECKs are lifted directly from `core.licensor_alias`. They are what make ruling 1
structurally true rather than aspirational: a proposal cannot be marked accepted without a named human,
a timestamp and evidence, and accepting it still does not move the edge — only
`core.set_property_licensor` does that, and only when called separately.

**Deliberately NOT built:** any trigger that promotes an accepted proposal into `core.property`. That
would be exactly the auto-population ruling 1 forbids, wearing a review queue as a disguise.

### 5.5 Step 4 — `api.licensor_property_picker`, the cascade in one place

A `security_invoker = true` view exposing `(licensor_id, licensor_name, licensor_status, property_id,
property_name, property_code, property_status)`, so every app's cascading picker is one filtered read
instead of four client-side reimplementations of `newItem-dialog.component.ts` L1227.

`security_invoker = true` is mandatory here — `AGENTS.md` §10.2 records three views that leaked ~16,600
rows to `anon` precisely by omitting it.

**It must not filter on `status` internally.** Callers filter. `core.licensor` legitimately holds
`potential` rows (5 of them today) and a picker that silently hides them would break prospective-licensor
workflows — the one non-ColdLion case ruling 2 allows.

### 5.6 Step 5 (SEPARATE, GATED) — representing an unparented property

**Do not bundle this with steps 1-4.** It is the only part that touches an existing constraint, it is
the only part with real blast radius, and it depends on a fact nobody currently knows (§3c item 7).

Two options, and the recommendation depends on a measurement:

- **Option A — keep `NOT NULL`, add a sentinel `UNASSIGNED` licensor row.** Every unparented property
  points at a single reserved licensor. Pros: no constraint change, no app breaks, orphans are trivially
  listable. Cons: a fake licensor row that every app's licensor picker must learn to hide, and ruling 2
  is uncomfortably adjacent — though a sentinel is not a discontinued licensor, it is a tombstone, and
  that distinction needs an owner ruling before it is built.
- **Option B — relax to nullable.** Honest modelling. But it breaks the Phase 1 invariant, changes the
  meaning of every `left join` versus `inner join` across four apps, and invalidates the
  `parent_edge_hash` drift detector in `20260726180000_...`.

**Recommendation: do nothing here until the count is known.** If DesignFlow genuinely has zero
unparented type-`06` merch groups, this step is unnecessary and `NOT NULL` is simply correct. If it has
some, Option A, subject to an explicit owner ruling on the sentinel.

### 5.6a Step 0 (BLOCKING) — disarm the live auto-writer in `plm.import_master_data()`

**This step was added after Kimi K3's review and it takes precedence over everything above. Nothing
else in this design enforces ruling 1 while this function exists as written.**

`plm.import_master_data(jsonb, jsonb)` is live on production and, for every property already known to
it, unconditionally overwrites both the parent edge and the status. Verbatim from
`pg_get_functiondef` on production `qsllyeztdwjgirsysgai`, lines 472-478:

```sql
        update core.property
        set licensor_id = parent_core_licensor_id,
            name = v_source_name,
            code = coalesce(v_source_code, code),
            status = 'active',
            metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
        where id = core_property_id;
```

Two things follow, both bad:

1. **The parent edge is machine-written today.** `parent_core_licensor_id` comes from the JSON nesting
   of the DesignFlow feed (§1.5), which is derived from `merchGroup.parent_id` — a column that, per
   §1.2, no human can edit through any DesignFlow screen. So the edge is set by a machine, from a
   value no reviewed process produces, with no audit row. Every hand-curated ruling would be silently
   reverted the next time this function runs.
2. **`status = 'active'` is still being force-set on production.** Migration
   `20260802170000_plm_import_preserve_curated_licensor_property_status.sql` was written specifically
   to remove that line from both the licensor and property branches. It is clearly **not promoted to
   production** — the line is still there in the live function body. That is the same migration family
   as commit `3501973` ("make curated licensor/property status durable"). The durability Albert was
   told he has, he does not have in production.

It is only harmless right now because the feed has been dead since 2026-07-08. §7 item 5 proposes
reviving it — **reviving the feed before this step would destroy curated parentage on the first
successful run.**

Required, before or in the same PR as step 2:

- Remove the `licensor_id = parent_core_licensor_id` assignment from the *existing-property* UPDATE
  branch. Keep it on the INSERT branch only, where the property is new and there is no curated value
  to destroy. Add a comment naming ruling 1.
- Where the feed's nesting disagrees with the curated edge, insert a
  `core.property_parent_proposal` row with `evidence_kind = 'designflow_feed_divergence'` (add that
  value to the CHECK) — so divergence is surfaced for a human instead of applied.
- Promote `20260802170000` so the `status = 'active'` force-set actually goes away, or reissue its
  effect forward. Do not edit the applied migration.

Order: **step 0 before step 5, and before any feed revival.** Steps 1 and 3 may land first, since the
audit and proposal tables are what step 0 writes into.

### 5.7 Conflict with ColdLion

Unchanged, and this design must not weaken it. ColdLion has no parent edge to conflict with
(`20260724030000_...` L287: "ColdLion has no parent edge: core.property.licensor_id remains
Supabase-curated"), and `plm.coldlion_promotion_audit`'s field CHECK already restricts ColdLion to
four name/code fields and can never author the edge. Ruling 3 — ERP wins on conflict — has no
application here because there is nothing on the ColdLion side to win with. **Any future promotion tool
that proposes to write `licensor_id` should be treated as a defect.**

If ColdLion's data ever *suggests* a different parent, that is an
`evidence_kind = 'coldlion_divergence'` row in `core.property_parent_proposal` and nothing more.

### 5.8 Migration order and mechanics

Strictly: **1** audit table → **2** RPC (depends on the audit table) → **3** proposal table
(independent, may run in parallel with 2) → **4** picker view (independent) → **5** gated, later,
separate PR.

Mechanics to observe, stated here so the implementing agent does not have to rediscover them:

- Every version must be a 14-digit timestamp sorting **strictly above** the current maximum in
  `supabase/migrations/`. Re-check at authoring time; `main` moves.
- **A duplicate version silently skips a migration while the ledger reports success** (`AGENTS.md`
  §4 rule 5). CI's `scripts/check-sql.sh` catches it; do not rely on memory.
- **Never edit an applied migration.** Every fix is a new forward migration.
- **"It applied successfully" proves nothing about behaviour.** Verify the objects with `to_regclass` /
  `pg_get_functiondef` / `pg_constraint`, then exercise the RPC.
- Preview (`rjyboqwcdzcocqgmsyel`) first, production (`qsllyeztdwjgirsysgai`) only in an approved
  window, and per §5.1 **never `--include-all` against the full repo set** — production currently
  carries a backlog (`core.licensor_alias` and `plm.coldlion_promotion_audit` are both absent from
  production, so at minimum `20260731210000` and `20260729230000` are unpromoted).

---

## 6. Blast radius across the four applications

Steps 1-4 are **purely additive**: a new table, a new function, a new table, a new view. No existing
column, constraint, view or policy changes. The expected impact on all four apps is **zero** until they
opt in.

The reason this matters is what steps 1-4 deliberately avoid touching. The following already read the
edge and would be the blast radius of any change to it:

| App | Reads the edge via | Effect of steps 1-4 | Effect of step 5 (Option B) |
|---|---|---|---|
| **PopPIM** (`poppim-web`) | `api.pm_product_board` (joins `core.licensor` + `core.property`), `api.pm_product_assets` | none | licensor column becomes nullable in the board; `inner join` assumptions would silently drop rows |
| **PopCRM** (`popcrm-web`) | no direct licensor/property dependency found; reaches it only through `api.global_search` | none | minimal — search results could show a property with a blank licensor |
| **PopDAM** (`popdam-web`) | `api.dam_asset_library`, `public.style_tracker_rows_with_bridge`, and **hard FKs** `dam.asset.licensor_id/property_id`, `dam.style_guide.licensor_id/property_id` (`20260723112930`, `20260723113000`) | none | highest risk of the four — DAM has real FK coupling, not just joins |
| **DesignFlow PLM** | `api.plm_item_list`, `api.plm_item_status`; and separately its own `merchGroup.parent_id` for the item dialog | none | the client-side cascade at `newItem-dialog.component.ts` L1227 is unaffected either way — it reads DesignFlow's own DB, not Supabase |
| **DB Data Admin** (`apps/db-data-admin`, in this repo) | `api.db_data_admin_licensor_property_tree` / `_list` — the natural home for the curator UI | none until the UI is built | the tree RPC's orphan-count logic would need to handle a real non-zero orphan set |

One cross-cutting note: `api.db_data_admin_licensor_property_tree` filters on
`status in ('active','potential')`, **not** `active` alone. Any new view or RPC should match that
predicate rather than the `= 'active'` habit found in 63 places elsewhere, or the 5 `potential`
licensors vanish.

---

## 7. What needs an owner decision (plain business English)

The coordinator puts these to Albert. I am not asking them.

1. **Who is allowed to change which licensor a property belongs to?** Right now nobody can, without a
   database engineer. Should this be a handful of named people (a "licensing curator"), or admins only?
   Everything else in this design follows from the answer.
2. **When someone changes it, must they type a reason?** The design assumes yes — a sentence explaining
   why, stored forever. This is what makes a correct change distinguishable from a mistake later. It
   costs the curator about ten seconds per change.
3. **What should happen to a property whose licensor we genuinely do not know yet?** Today the database
   refuses to store one at all. Options: (a) park it under a placeholder "Unassigned" holder so it is
   visible and listable, or (b) allow it to have no licensor, which is more honest but changes what
   every screen shows. Recommendation: decide only after we count how many such properties actually
   exist in DesignFlow — the answer may be zero, in which case nothing needs to change.
4. **Is a placeholder "Unassigned" entry acceptable?** It would appear in the licensor list unless every
   screen is taught to hide it. It is not a real or a discontinued licensor — it is a holding pen — but
   it does sit close to the standing rule against inventing licensors, so it needs an explicit yes/no.
5. **The master-data feed from DesignFlow has been dead since 8 July.** Nothing has updated licensors
   or properties in Supabase for roughly four weeks, and the last activity of any kind was 22 July.
   Should fixing that feed be scheduled before this work, so curation happens on current data rather
   than a month-old snapshot?
6. **Two approved pieces of work are sitting unpromoted on production** — the licensor-alias table and
   the ColdLion promotion audit table. The FRIENDS TV / FRIDA KAHLO ruling recorded on 2 August also
   does not appear to have reached production (FR still reads as active there). Should those be
   promoted before or alongside this change?

---

7. **A DesignFlow import routine is currently able to overwrite hand-curated parent links, and it also
   still forces every property back to "active".** It is only harmless because that feed is broken. The
   fix is small and should be done before anything else — and definitely before the feed is repaired.
   Confirming: the intent is that once a person has ruled who owns a property, no automatic import may
   change it. Correct?
8. **When a curator moves a property to a different licensor, existing artwork and style-guide records
   in PopDAM keep the old pairing.** Should the system (a) just warn the curator and list what is now
   inconsistent, or (b) update those records automatically? Recommendation: warn only — automatically
   rewriting historical records is how audit trails become fiction.
9. **There is an alarm that watches for the parent links changing.** Once curators can legitimately
   change them, that alarm will fire on every correct change unless it is taught to recognise a ruled
   change. Should it be taught, or switched off for curated changes?

## 8. What was deliberately NOT done

- **No migration authored.** Not in this branch, not anywhere.
- **No database write of any kind**, to preview or production. Every statement was a `SELECT`.
- **No change to any dflow repo.** Read-only, no branch switched, no file touched.
- **No co-occurrence analysis run.** It is an audit tool and this was a design task; running it would
  have produced numbers that read as findings.
- **No promotion, no merge.** PR opened and stopped, per instruction.
- **The unparented-property count in DesignFlow was not measured.** It requires querying the DesignFlow
  database directly (bypassing the dead endpoint), which was outside this task's read-only Supabase
  scope. It is the single most important open measurement and it gates step 5.
- **No app repo type regeneration**, since no schema changed.

---

## 9. Independent review — Kimi K3

Reviewed by Kimi Code CLI 0.27.0, read-only, given the four rulings and the four required questions.
Kimi's findings are quoted verbatim below. Each is followed by my position, **verified against the
actual code or the live production database before agreeing**, not accepted on Kimi's say-so.

### Q1 — can a link be created without a human ruling?

> "**Mostly no, but there is one large loophole the document itself documents and then ignores:
> `plm.import_master_data()`.** … §1.5 states plainly that `plm.import_master_data()` 'derives the
> property's licensor from the nesting itself (`parent_core_licensor_id := core_licensor_id`)'. That
> is an automated code path that writes the edge with no human ruling — exactly what P1 (§5.1) says
> may not exist. The design never says to change it, gate it, or route its output into
> `core.property_parent_proposal` … §5.3's claim that the RPC is 'the only supported way to change the
> edge' is false while that function exists"

**AGREE, and it is worse than Kimi could see from the document.** I verified it directly against the
live function body on production. Lines 472-478 of `pg_get_functiondef` do exactly what Kimi says —
and they also still force `status = 'active'`, which means migration `20260802170000` (the "make
curated status durable" work) is **not promoted to production**. This was my design's most serious
omission. Fixed as new blocking **§5.6a step 0**, which now precedes everything else, and it converts
§7 item 5 (revive the feed) from a suggestion into something that must not happen first.

> "**Audit completeness is by convention, not structure.** … Nothing on `core.property` forces an
> audit row when `service_role`/`postgres` runs a direct UPDATE — which §4.4 itself identifies as the
> failure mode that made the 2026-07-31 delete indistinguishable from an accident."

**AGREE.** This is a direct hit on my own stated rationale. I verified the grant position on
production — `authenticated` has `SELECT` only, so the realistic write path today *is* `service_role`,
which is exactly the unaudited route. Fixed: §5.3 now requires a trigger on `core.property` writing
the audit row unconditionally, with `source_channel = 'out_of_band'` for anything not arriving through
the RPC.

> "**`p_decided_by` is self-asserted.** … That makes §4.3's claim — 'impossible to record an approval
> that nobody actually gave' — overstated."

**AGREE.** The claim was too strong. Fixed: §5.3 step 8 now records `auth.uid()` alongside the
free-text label, and §4.3's guarantee is explicitly narrowed to "cannot record an approval without
claiming a named human and evidence."

> "**`source_channel = 'migration_backfill'` … legitimizes bulk edge writes via a migration script**"

**AGREE in principle, partially.** Its intended use was recording the existing 256 rows, which is a
statement of current state, not a change. But Kimi is right that nothing enforces that. Accepted as a
constraint to add at implementation time: `source_channel = 'migration_backfill'` requires
`previous_licensor_id is null or previous_licensor_id = new_licensor_id`.

### Q2 — property with no parent

> "**Handled correctly — this is the strongest part of the document.** … Given `NOT NULL` with 0 nulls
> today, steps 1–4 are fully coherent without resolving it."
>
> "Two small nits … §8 lists the count as 'not measured' but no owner question or step assigns anyone
> to run it — it gates step 5 yet floats"

**AGREE with the verdict and with the nit.** The floating measurement is a real process gap. It is now
called out to the coordinator as a concrete next dispatch rather than a note in §8.

### Q3 — per-(division, type) code uniqueness

> "**Yes, it survives.** … every new object keys on uuids, never codes … no CHECK or unique constraint
> in any new object involves a bare code."
>
> "One implementation caveat … machine-generated proposals must resolve a source
> `(company, division, type, code)` tuple to a canonical property uuid before inserting … The hand-off
> between those two is assumed, not designed."

**AGREE with both.** I re-checked the schema before agreeing: the only code-bearing constraint in
scope is the pre-existing `unique nulls not distinct (licensor_id, code)` on `core.property`, which is
licensor-scoped, not global. The caveat is fair — proposal ingestion must resolve through
`plm.taxonomy_resolution_review`'s source-key machinery and that hand-off is unspecified. Noted as an
implementation requirement, not a design change.

### Q4 — blast radius

> "**Honest about the DDL, understated about the semantics.**"
>
> "**Stale pairs after re-parenting.** … the moment one fires, every `dam.asset`/`dam.style_guide` row
> holding the old (licensor, property) pair becomes an internally inconsistent pair. The doc
> *identifies* this gap — §3b item 6 — and then §5 contains no step that builds it … A gap is raised
> and silently dropped."

**AGREE.** This is the correct criticism of §6. I verified the FK coupling exists as described
(`20260723112930`, `20260723113000` finalize `dam.asset.licensor_id/property_id` and
`dam.style_guide.licensor_id/property_id` onto `core.*`). Scoped out explicitly rather than papered
over: the RPC must, in the same transaction, list affected `dam.asset` / `dam.style_guide` rows whose
stored licensor no longer matches, and return that list to the caller so the curator sees the
consequence. Repairing them is a separate decision, not this design's to make silently.

> "**The drift detector is missing from §6 entirely.** … if that detector compares Supabase edges
> against the DesignFlow snapshot, every legitimate curation will read as drift — either paging
> falsely or training everyone to ignore it."

**AGREE.** `parent_edge_hash` (`20260726180000`) is designed to detect exactly the thing this RPC is
built to do deliberately. Accepted: the detector needs a "ruled divergence" allowance keyed to the
audit table, or its alerts become noise the first week the RPC is used. Added to the owner-decision
list as item 7.

> "**The feed-revival interaction** … would re-activate the auto-edge-writer of §1.5 across all four
> apps — while §6 claims 'none' for every row."

**AGREE** — subsumed by step 0.

> "the PopPIM row rests on PopPIM reading the edge only through views … if any PIM table stores
> licensor/property ids, understatement #1 applies there too. That claim is unverifiable from this
> document alone."

**AGREE, and I could not close it.** `poppim-web` is not a sibling checkout on this machine, so I
could not confirm whether PopPIM stores licensor/property ids anywhere. **Marked unverified** rather
than asserted. This is a real residual risk in my §6 table.

### Kimi's remaining defects — my position

| # | Kimi's defect | My position |
|---|---|---|
| 7 | Proposal mechanics underspecified — `'superseded'` has no CHECK grammar, grants unstated, no `deleted`/`archived` licensor rejection at proposal time | **AGREE.** Implementation detail, folded in. `'superseded'` should follow the accepted/rejected grammar. |
| 8 | Licensor status vocabulary assumed | **AGREE — and I verified it.** Production holds only `active` (21) and `potential` (5). The enum does contain `archived`/`deleted`, so the RPC check is valid but currently vacuous. Whether a `potential` licensor is a legal RPC target is genuinely unstated; it should be **yes** (prospective licensors are the one non-ColdLion case ruling 2 allows). |
| 9 | Grants on the new tables unstated | **AGREE.** Audit table: `INSERT` via the definer function only, `SELECT` to the curator role. Proposal table: `SELECT` + `INSERT` to curator/service_role. Must be stated per `AGENTS.md` §10.2, since the event trigger strips `anon`/PUBLIC and silence is not a grant. |
| 10 | §5.5 wording overshoots — "must not filter on status" also obliges showing `deleted` rows | **AGREE.** The intended rule is "do not hard-code `= 'active'`; match `in ('active','potential')`", as §6's closing note already says correctly. §5.5 wording to be corrected at implementation. |
| 11 | §9 was circular ("reviewed by Kimi, see §9" → "see the coordinator report") | **AGREE.** Fixed — this section now carries the review inline. |

### Where I do not simply defer

Kimi's bottom line calls the architecture right and names one fatal omission plus two high-severity
gaps. I checked all three against live evidence rather than accepting them, and all three held. I have
no disagreement to record on any substantive point — which is itself worth noting: the review caught a
production-live auto-writer that would have silently reverted every curated ruling, and my original
draft would have shipped a curation design whose central promise was false.

> "the architecture (edge stays put, curation in `core`, proposals structurally separated, step 5
> gated on measurement) is right, and the ruling-compliance intent is visible in the CHECK grammar
> rather than just asserted. But it ships one fatal omission — the live auto-writer it discovered in
> §1.5 and forgot to defuse — plus two high-severity gaps (audit completeness, dropped pair-validation)
> that must be closed before this is implemented as written."

Session id for follow-up: `session_47b18ce7-dcfa-4da6-ad3f-ae37c2be1eb2`.
