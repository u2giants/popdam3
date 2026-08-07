# Design — landing the Disney OPA property→character extract

**Status:** DESIGN ONLY. **No migration was written. No database write was made.
Nothing under `supabase/` was touched.** This document is the input to a future
migration, not the migration itself.

**Author:** sub-agent dispatched by the shared-db coordinator (session
`774f5010`, machine `t16`, coordinator marker: issue #473).
**Branch:** `agent/opa-lookup-design-20260807`, cut from `origin/main` at
`105c2ecfb39363f23353216a9cc0d805b58260eb` (re-verified at time of writing).
**Date:** 2026-08-07.

**Database reads:** read-only `select` and catalog queries only, against Supabase
project **`qsllyeztdwjgirsysgai` — PRODUCTION**. Target proved before the first
query via `get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co`. The
Supabase MCP takes no project argument; it is bound to production, **not**
preview (`rjyboqwcdzcocqgmsyel`). No `insert`, `update`, `delete`, or DDL was
issued.

Read `README.md` in this folder first. This document assumes it.

---

## 0. Decisions that were already settled before this design started

These are recorded so a fresh reader does not reopen them.

**Albert (owner) ruled:**

- **Scope:** build from the Home line-of-business extract we already have. Do
  **not** ask him to log back into OPA for other lines of business. The design
  must record plainly that the data is Home-only and Albert-entitlement-only, so
  nobody mistakes it for all of Disney.
- **Refresh:** one-off snapshot, no schedule. Stamp the capture date in the data
  and document the two-minute manual refresh ritual (`README.md` §4).
  Automation is impossible: MFA, no API.
- **Likeness variants:** the `- No Likeness` / `- With Likeness` distinction must
  be available as a **base name plus a likeness flag**, not only as two opaque
  property names.

**Coordinator ruled:**

- **Landing pattern:** raw vendor source table + a consumable view on top,
  following the established vendor/source-owned pattern in this repo (identified
  in §1.3 below).
- **Likeness, how:** the **raw table keeps Disney's exact string untouched** —
  that is what a source table is for. The **split lives in the view**, clearly
  marked as our interpretation rather than Disney's. Both are delivered.
- **No FK to `core.property` in this first landing.** Joining OPA to
  `core.property` makes this a cross-app data contract (PopCRM and DesignFlow
  both read licensor/property data) and drags in that whole review. Land it
  standalone. Reconciliation is separate, later work — recommended in §7, not
  delivered here.
- **Dedupe is done, do not redo it.** PR #468 overlaps but does not duplicate:
  its finding is that `core.character` has 0 rows, and its diff contains no
  table design. The datasets count different things.

---

## 1. Proving the live schema

Everything in `README.md` §6a was read from documents and never measured. It has
now been measured. Below, "measured" means a `select count(*)` against
production on 2026-08-07.

### 1.1 Row counts — measured vs. what the documents claimed

| Object | README §6a said | **Measured** | Verdict |
| --- | ---: | ---: | --- |
| `core.character` | 0 | **0** | ✅ correct — the table exists and is genuinely empty |
| `core.property` | (not stated) | **256** | — |
| `core.licensor` | (not stated) | **26** | — |
| `public.characters` | 9,622 | **9,622** | ✅ correct |
| `dflow.properties_and_characters` | 10,122 | **10,122** | ✅ correct |
| `core.properties_and_characters` | (not mentioned) | **10,122** | ⚠️ **the document misses this object entirely** |
| `core.property_character_associations` | (not mentioned) | **9,622** | ⚠️ **also missed** |
| `public.properties` | (not stated) | **500** | — |
| `public.licensors` | (not stated) | **10** | — |
| `plm.property_import` | (not stated) | **468** | — |
| `plm.licensor_import` | (not stated) | **37** | — |

**Where the documents are wrong or incomplete:**

1. **The counts themselves are right.** README §6a's three headline numbers
   (0 / 9,622 / 10,122) all hold up. Credit where due — the disproved-lineage
   retraction in §6a was the right call and the surviving numbers survive.
2. **README §6a is incomplete, not wrong.** It names
   `dflow.properties_and_characters` as the 10,122-row table and
   `public.characters` as the 9,622-row table. Both are true, but each of those
   two shapes exists **twice** in the live database:
   `core.properties_and_characters` is also 10,122 rows, and
   `core.property_character_associations` is also 9,622 rows. A future session
   reading only §6a will not know those exist and may "discover" them and
   re-litigate the lineage question. **This is exactly the trap §6a was written
   to close, and it is still half-open.**
3. **`pg_stat_user_tables` is stale on this database and must not be trusted.**
   `n_live_tup` reported `dflow.properties_and_characters` as 0 and
   `public.characters` as 0 when both actually hold rows. Any future session
   measuring row counts here must use `count(*)`, never the statistics views.
   This is a live hazard: the fastest query gives the wrong answer.

### 1.2 `core.property` and `core.character` — real shape

Both were read from `information_schema.columns` on production.

`core.property` (256 rows):

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` |
| `licensor_id` | `uuid` | **no** | — (FK → `core.licensor(id)` `on delete restrict`) |
| `name` | `text` | no | — |
| `code` | `text` | yes | — |
| `status` | `app.entity_status` | no | `'active'` |
| `metadata` | `jsonb` | no | `'{}'` |
| `created_at` / `updated_at` | `timestamptz` | no | `now()` |

`core.character` (**0 rows**) has the identical shape with `property_id uuid`
**nullable** in place of `licensor_id`. It is the intended home for distinct
characters parented to a property, and it has never been populated. That gap is
real and is the strongest argument for landing the OPA file — but filling it is
**not** part of this deliverable (see §7).

### 1.3 Where vendor/source-owned landing data actually lives

**There is no `coldlion` schema.** Confirmed against `pg_namespace`: the schemas
on this database are `api`, `app`, `auth`, `core`, `crm`, `cron`, `dam`,
`designflow`, `dflow`, `extensions`, `graphql`, `graphql_public`, `ingest`,
`net`, `pim`, `plm`, `public`, `realtime`, `storage`, `supabase_migrations`,
`vault`. Anyone searching for `coldlion.*` will find nothing and may wrongly
conclude there is no precedent.

The established pattern, read out of
`supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`
and confirmed against the live catalog, is a **three-part** one:

| Layer | Where | Live examples |
| --- | --- | --- |
| **Raw typed mirror** of the vendor's own rows, keyed on the vendor's natural key, carrying the untouched payload in `raw jsonb` plus `source_hash`, `first_seen_at`, `last_seen_at` | schema **`plm`** | `plm.erp_licensor`, `plm.erp_property` |
| **Nullable resolution columns** on the mirror (`<canonical>_id`, `resolution_status`, `resolution_reason`, `resolved_at`, `resolved_by`) so reconciliation is recorded on the mirror row and never mutates canonical rows | same table | `plm.erp_property.property_id` etc. |
| **Read-only consumable view** | schema **`api`** | `api.coldlion_property_reconciliation`, `api.coldlion_licensor_reconciliation` |

`plm.erp_property`'s full column list, measured:
`company_code`, `division_code`, `mg_type_code`, `mg_code`, `mg_type_desc`,
`name`, `property_id`, `resolution_status`, `resolution_reason`, `resolved_at`,
`resolved_by`, `erp_created_at`, `erp_updated_at`, `raw`, `source_hash`,
`first_seen_at`, `last_seen_at`, `last_sync_run_id`, `imported_at`,
`updated_at`.

**This design follows that pattern exactly:** raw mirror in `plm`, view in
`api`. It invents nothing new.

The `ingest` schema (`ingest.sync_run`, `ingest.raw_record`,
`ingest.dedupe_candidate`) is the *run-tracking* layer for automated importers.
OPA has no automated importer and never will (MFA, no API), so this design does
**not** create an `ingest.sync_run` row. That is a deliberate deviation and is
called out in §4.

### 1.4 The current RLS and grants posture — measured, not assumed

Read from `pg_class` / `pg_policy`:

| Object | RLS enabled | Force RLS | Policies | ACL |
| --- | --- | --- | ---: | --- |
| `core.property` | yes | no | 2 | `authenticated=r`, `service_role=arwdDxtm` |
| `core.character` | yes | no | 2 | `authenticated=r`, `service_role=arwdDxtm` |
| `plm.erp_property` | yes | no | 1 | `authenticated=r`, `service_role=arwdDxtm` |
| `plm.erp_licensor` | yes | no | 1 | `authenticated=r`, `service_role=arwdDxtm` |
| `plm.property_import` | yes | no | 1 | `authenticated=r`, `service_role=arwdDxtm` |
| `api.coldlion_property_reconciliation` | n/a (view) | n/a | 0 | `authenticated=r`, `service_role=arwdDxtm` |

**The posture is consistent and unambiguous:** RLS on, exactly one read policy,
`select` to `authenticated` and full rights to `service_role`, and **`anon`
appears nowhere.** The anon-read lockdown is real and holds across every object
checked. This design matches it and grants nothing to `anon`.

---

## 2. §7 Q3 — how is Disney identified as a licensor?

**This is an owner decision. I am presenting the options and stopping.**

### 2.1 What is actually there

`core.licensor` holds **26 rows**. Exactly **one** is named for Disney:

| `id` | `name` | `code` | `status` |
| --- | --- | --- | --- |
| `7d141a6f-e229-46a2-b3f5-0ba0c97dd820` | `DISNEY` | `DY` | `active` |

There is no second Disney row, no `Walt Disney`, no misspelling. On the face of
it, unambiguous.

### 2.2 Why it is **not** unambiguous

Three separate problems, each with evidence.

**(a) Disney-owned brands are filed as *sibling* licensors, not under Disney.**
`core.licensor` also contains, as peers of `DISNEY`:

- `MARVEL` (`MV`) — Disney has owned Marvel since 2009
- `STAR WARS` (`SW`) — Disney has owned Lucasfilm since 2012

But the OPA portal these 10,262 rows came from is **Disney's own portal**, and it
serves Marvel and Star Wars properties through it. Measured in the CSV: property
names beginning `Marvel`, `MS `, `X-Men`, `Deadpool`, `Avengers`, `Iron Man`,
`Black Panther`, `Eternals`, `Guardians of the Galaxy` and similar are all
present, and the single largest cluster of character names in the file carries a
`( Marvel Comics (Retro) )` suffix. **If every OPA row is stamped
`licensor = DISNEY`, we assert something our own `core.licensor` currently
denies.** If OPA rows are split across `DISNEY` / `MARVEL` / `STAR WARS`, we
need a splitting rule Disney never gave us, and we would be inventing it.

**(b) A second, different Disney identity already exists in the database.**
`public.licensors` (10 rows, the PopDAM-side table) has:

| `id` | `name` | `external_id` |
| --- | --- | --- |
| `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` | `Disney` | **`DS`** |
| `144f375d-69c5-4ba0-86d5-ffd7bfa2d4cd` | `Marvel` | `MV` |

So Disney's code is **`DY` in `core.licensor` and `DS` in `public.licensors`.**
Two tables, two codes, same company. Any OPA landing that hard-codes a Disney
code will be wrong in one of the two worlds. This is a genuine conflict that
nobody has recorded before, and it is not this design's to resolve.

**(c) The `NO LICENSE` history is live, not historical.**
`core.licensor` contains `DTR - NO LICENSE` (`ZZ`, `active`). PR #468's open
question 4 records that Coco's style guide sits under code `CC` parented to
`DTR - NO LICENSE` while the style guide is Disney, and Albert ruled on
2026-08-06 that **"Coco IS a Disney license."** That ruling has not been applied
to the data. So at least one property that OPA would call Disney is, in our
database today, filed under a licensor that says it has no licence.

### 2.3 The options, for Albert

| Option | What it means | Consequence |
| --- | --- | --- |
| **A. Stamp every OPA row `core.licensor` `DISNEY` (`DY`)** | One licensor for the whole file | Simplest. Contradicts our own `MARVEL` and `STAR WARS` licensor rows and will collide the moment reconciliation starts |
| **B. Stamp nothing; store no licensor at all in this landing** | The raw table records only "source = OPA, Disney portal" as free text provenance | Safest. Defers the whole question to reconciliation. **This is what §3's DDL does by default** |
| **C. Split OPA rows across `DISNEY` / `MARVEL` / `STAR WARS` by a name rule** | We author a classification Disney did not give us | Invents data. Not recommended without Albert's explicit rule |
| **D. Treat Disney as a *parent* of Marvel/Star Wars and add hierarchy to `core.licensor`** | Structural change | Real cross-app data contract. Large. Out of scope here |

**Recommendation:** land with **option B** — no licensor column, provenance only
— because it is the only option that stores no claim we cannot defend. Options A,
C and D are all Albert's to choose, and the choice is better made during
reconciliation (§7) when the evidence is in the database rather than in a CSV.

**Additionally owed to Albert, separately:** is `DY` or `DS` the correct Disney
code, and should `core.licensor` and `public.licensors` be reconciled? That
question is older than this work and this design does not answer it.

---

## 3. The design

### 3.1 Object inventory — the coordinator's collision-check declaration

Every object this design would create, schema-qualified and exhaustive:

| # | Object | Kind |
| ---: | --- | --- |
| 1 | `plm.opa_property_character` | table |
| 2 | `plm.opa_property_character_pkey` | primary key constraint (on 1) |
| 3 | `plm.opa_property_character_uq_name_pair` | unique constraint (on 1) |
| 4 | `plm.opa_property_character_property_name_chk` | check constraint (on 1) |
| 5 | `plm.opa_property_character_character_name_chk` | check constraint (on 1) |
| 6 | `plm.opa_property_character_option_source_chk` | check constraint (on 1) |
| 7 | `plm.opa_property_character_lob_chk` | check constraint (on 1) |
| 8 | `idx_opa_property_character_property_name` | index (on 1) |
| 9 | `idx_opa_property_character_character_name` | index (on 1) |
| 10 | `idx_opa_property_character_character_id` | index (on 1) |
| 11 | `idx_opa_property_character_base_property_name` | index (on 1) |
| 12 | `opa_property_character_read` | RLS policy (on 1) |
| 13 | `api.opa_property_character` | view |

**No other object is created, altered, or dropped.** In particular: nothing in
`core.*` is touched, no foreign key is added, `core.character` is not populated,
and no existing table, view, policy, grant, or constraint is modified.

Suggested migration filename:
`supabase/migrations/20260807HHMMSS_opa_property_character_landing.sql`.
The highest migration version on `origin/main` at the time of writing is
`20260804120100_taxonomy_breaker_environment_and_provenance.sql`. **Re-derive
the maximum version at the moment the migration is authored** — this figure goes
stale within the hour and another agent may have landed one since.

### 3.2 The natural key — verified against the CSV, and README §3 is partly wrong

README §3 states, emphatically, that the natural key is the **(property,
character) pair** and that "roughly 670 names appear under more than one
property." I measured this directly against `opa-characters.csv`.

| Measurement | README says | **Measured** |
| --- | ---: | ---: |
| Rows (excl. header) | 10,262 | **10,262** ✅ |
| Distinct property **names** | 1,445 | **1,444** ❌ |
| Distinct `licensedPropertyID` | — | **1,445** |
| Distinct character **names** | 9,591 | **9,591** ✅ |
| Character names under >1 property | "roughly 670" | **609** ❌ |
| Distinct **(property name, character name)** pairs | implied 10,262 | **10,240** ❌ |
| Distinct **(`licensedPropertyID`, `characterID`)** pairs | — | **10,262** ✅ **fully unique** |

**Three corrections to README §3:**

1. **There are 1,444 distinct property names but 1,445 distinct property IDs.**
   `Davy Crockett` appears twice, as `licensedPropertyID` **216** and **425**.
   Disney reuses a display name for two different properties.
2. **"Roughly 670" is wrong; the real number is 609.** The 670 figure appears to
   have been inferred from `10,262 − 9,591 = 671`, which is arithmetic on row
   counts, not a count of recurring names. The measured answer is 609.
3. **The name pair is NOT unique.** There are only **10,240** distinct
   (property name, character name) pairs across 10,262 rows — **22 collisions**.
   The **ID pair is unique** at exactly 10,262.

The 22 collisions are real data, not import noise. Examples:

- `Davy Crockett` / `Fess Parker` — two different properties share a name (see
  correction 1), so the same actor appears under both.
- `Marvel Cross-Franchise Art Packs` / `Wolverine ( … )` — one property, one
  character name, **two different `characterID` values** (`1159368165` and
  `1159368821`).
- `Deadpool Classic` / `Piratepool ( … )`, `Marvel Comics (Retro)` / `Ultron`,
  `Eternals Movie - No Likeness` / `Eternals Movie (General)`, and similar.

> **The natural key is `(licensed_property_id, character_id)` — Disney's ID
> pair — not the name pair.** README §3's warning is directionally right (a
> character-name-only key would be catastrophic) but its stated key would still
> silently drop 22 rows. This design keys on the ID pair, and carries the name
> pair as a **separate, non-unique** index.

### 3.3 The Disney ID columns

Preserved exactly as OPA supplies them, with no reinterpretation.

| CSV column | Stored as | Notes |
| --- | --- | --- |
| `licensedPropertyID` | `licensed_property_id bigint` | 1,445 distinct. Part of the key |
| `characterID` | `character_id bigint` | 9,613 distinct. Part of the key. See §5 |
| `brandPropertyID` | `brand_property_id bigint` | 1,345 distinct. Meaning not established |
| `optionSourceID` | `option_source_id bigint` | **`1007` on all 10,262 rows without exception.** Meaning unknown |

> **Do not build any logic on `option_source_id`.** It is a constant in this
> extract. It is stored only so a future extract can prove whether it ever
> varies. A check constraint pins it to `1007` so that a future load carrying a
> different value fails loudly instead of landing silently — see §3.6 on why
> that is the right kind of loudness.

**All four ID columns are integers, and all four go negative on exactly one
row.** The row `Special Projects` carries
`licensedPropertyID = -9999`, `characterID = -9998`, `brandPropertyID = -9999`.
This is a Disney sentinel, not corrupt data. `bigint` handles it; any unsigned
or `text`-with-digit-check typing would reject it. It is the reason the DDL
below does **not** constrain the IDs to be positive.

### 3.4 Provenance columns

Per Albert's ruling: capture date stamped in the data, plus the scope caveats,
so nobody can read a row without seeing what it is and is not.

| Column | Purpose |
| --- | --- |
| `captured_at date` | The snapshot date. `2026-08-06` for this load |
| `source_url text` | The full OPA product-create URL including `lob=200` / `lobName=Option.Lob.Home` |
| `line_of_business text` | `'Home'` — pinned by check constraint |
| `entitlement_scope text` | Free text recording that the extract shows only what POP Creations' licensee account is contractually entitled to see |
| `raw jsonb` | The untouched source row, matching the `plm.erp_*` mirror convention |
| `source_hash text` | Hash of the source row, matching the `plm.erp_*` convention |
| `first_seen_at` / `last_seen_at` / `imported_at` / `updated_at` | Same convention as `plm.erp_property` |

### 3.5 DDL — the raw table

Ready to become a migration. **This is not a migration and must not be applied
as one.** It has never been executed anywhere.

```sql
-- ---------------------------------------------------------------------------
-- Raw vendor landing: Disney OPA (Online Product Approval) property→character
-- picker, Home line of business, captured 2026-08-06.
--
-- This is a SOURCE table. Disney's strings are stored EXACTLY as OPA supplies
-- them. Nothing is normalised, split, trimmed, or corrected here. Our
-- interpretation lives in api.opa_property_character, never in this table.
-- ---------------------------------------------------------------------------

create table plm.opa_property_character (
  -- Disney's identity. The natural key.
  licensed_property_id  bigint not null,
  character_id          bigint not null,

  -- Disney's strings, byte-for-byte as extracted. Do not normalise.
  property_name         text   not null,
  character_name        text   not null,

  -- Further Disney IDs, preserved but not interpreted.
  brand_property_id     bigint not null,
  option_source_id      bigint not null,

  -- Provenance. Every row carries its own scope caveat by design.
  captured_at           date   not null,
  source_url            text   not null,
  line_of_business      text   not null default 'Home',
  entitlement_scope     text   not null
    default 'POP Creations licensee entitlement only; NOT Disney''s full catalogue',

  -- Mirror convention, matching plm.erp_licensor / plm.erp_property.
  raw                   jsonb  not null,
  source_hash           text   not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  imported_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint opa_property_character_pkey
    primary key (licensed_property_id, character_id),

  -- The NAME pair is NOT unique (22 real collisions in the 2026-08-06 extract).
  -- It is therefore deliberately NOT a unique constraint. See DESIGN.md §3.2.

  constraint opa_property_character_property_name_chk
    check (btrim(property_name) <> ''),
  constraint opa_property_character_character_name_chk
    check (btrim(character_name) <> ''),

  -- option_source_id was 1007 on all 10,262 rows. Its meaning is UNKNOWN.
  -- Pinned so a future extract carrying a different value fails loudly rather
  -- than landing silently under an assumption nobody has verified.
  constraint opa_property_character_option_source_chk
    check (option_source_id = 1007),

  constraint opa_property_character_lob_chk
    check (line_of_business = 'Home')
);

comment on table plm.opa_property_character is
  'RAW Disney OPA (opa.disney.com) property->character picker extract. '
  'SCOPE WARNING: Home line of business ONLY (lobName=Option.Lob.Home), and '
  'ONLY the properties POP Creations'' licensee account is entitled to see. '
  'This is NOT all of Disney and NOT all lines of business. Point-in-time '
  'snapshot, no change feed; refresh is a full manual re-extract requiring '
  'Albert to complete MFA in his own browser (see '
  'docs/verification/opa-characters-20260806/README.md section 4). '
  'Disney''s strings are stored verbatim; interpretation belongs in '
  'api.opa_property_character. Business-confidential Disney data under a '
  'commercial licensing relationship - do not publish, do not send to any '
  'third-party service.';

comment on column plm.opa_property_character.option_source_id is
  'Disney''s optionSourceID. Was 1007 on ALL 10,262 rows of the 2026-08-06 '
  'extract. Its meaning is NOT understood. DO NOT BUILD LOGIC ON THIS COLUMN.';

comment on column plm.opa_property_character.property_name is
  'Disney''s exact property display name, verbatim. NOTE: not unique - '
  '1,444 distinct names across 1,445 distinct licensed_property_id values '
  '("Davy Crockett" is both 216 and 425). Also note Disney writes many '
  'character names surname-first ("Watson, Anna") and uses a BACKTICK (`) '
  'where an apostrophe is expected ("Man`s"). Matching code must handle both.';

comment on column plm.opa_property_character.character_id is
  'Disney''s characterID. In the 2026-08-06 extract it is a STABLE character '
  'identity: 9,613 distinct values, never mapping to more than one name, and '
  '609 of them recur across multiple properties. It is NOT property-scoped. '
  'See DESIGN.md section 5.';

comment on column plm.opa_property_character.entitlement_scope is
  'Records that this row is visible only because of POP Creations'' licensee '
  'entitlements. A different Disney licensee account would see a different set.';

-- Lookup paths. None of these is unique.
create index idx_opa_property_character_property_name
  on plm.opa_property_character (property_name);

create index idx_opa_property_character_character_name
  on plm.opa_property_character (character_name);

create index idx_opa_property_character_character_id
  on plm.opa_property_character (character_id);

-- Supports the view's base-name lookup without recomputing the split.
create index idx_opa_property_character_base_property_name
  on plm.opa_property_character (
    btrim(regexp_replace(property_name, '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'))
  );

-- Posture matches plm.erp_property / plm.erp_licensor exactly, measured
-- 2026-08-07: RLS on, exactly one read policy, select to authenticated,
-- full rights to service_role, NOTHING to anon.
alter table plm.opa_property_character enable row level security;

create policy opa_property_character_read
  on plm.opa_property_character
  for select
  to authenticated
  using (true);

grant select on plm.opa_property_character to authenticated;
grant select, insert, update, delete on plm.opa_property_character to service_role;

revoke all on plm.opa_property_character from anon;
```

### 3.6 The privilege guard — and the trap to avoid

If the migration includes a guard that the loader is running with sufficient
privilege, **it must require a non-null role and a positive match.** The
following shape is a null-permissive guard and is forbidden:

```sql
-- WRONG. Never fires. Do not use this shape.
if not ( current_user = 'postgres' or auth.role() = 'service_role' ) then
  raise exception 'insufficient privilege';
end if;
```

Inside a migration `auth.role()` is **NULL**. `NULL = 'service_role'` evaluates
to `NULL`, `false or NULL` is `NULL`, and `if not NULL then` never executes the
body. The guard silently passes for everyone, forever. Correct shape:

```sql
do $$
declare
  v_role text := coalesce(auth.role(), '');
  v_user text := coalesce(current_user, '');
begin
  -- Require a NON-NULL role AND a positive match. Never `not (... or ...)`.
  if not (v_role = 'service_role' or v_user in ('postgres', 'supabase_admin')) then
    raise exception
      using message = format(
        'OPA landing refused: effective role %L / user %L is not permitted to '
        'load plm.opa_property_character. Run this migration through the '
        'shared-db apply workflow.', v_role, v_user),
      errcode = 'P0001';
  end if;
  raise notice 'OPA landing privilege check OK (user=%).', v_user;
end $$;
```

The same rule applies to the `option_source_id = 1007` check constraint: it is
there so a **future** extract that disagrees with our assumption **fails loudly**
rather than landing quietly. That is deliberate. If a later extract legitimately
carries a different value, the correct response is a new migration that widens
the constraint with a recorded reason — not dropping it.

### 3.7 DDL — the consumable view

Per Albert's ruling, the view exposes a base property name plus a likeness flag.
Per the coordinator's ruling, the split is **clearly marked as our
interpretation**, not Disney's.

Measured against the CSV: **147 of the 1,444 distinct property names mention
likeness** — 67 end in `- No Likeness`, 71 end in `- With Likeness`, and **9 do
not match either clean pattern.** The stragglers are real and must not be
silently mangled. They include:

- `Guardians of the Galaxy Movie - Without Likeness` — spelled **`Without`**,
  not `No`
- `X-Men: First Class - With Likeness - Discontinued as of 1-Aug-12` — the
  likeness marker is **mid-string**, followed by a discontinuation note
- `Iron Man Movie - No Likeness - Discontinued as of 9/1/2012` — a **different
  date format** in the same family of names
- `No Likeness` — a property whose entire name is the marker

The view therefore emits a **three-valued** flag plus an explicit
`likeness_parse_confident` boolean, so a consumer can tell a clean split from a
guess. It never throws information away: `property_name` is always carried
through verbatim alongside the interpretation.

```sql
-- ---------------------------------------------------------------------------
-- Consumable view over the raw OPA landing.
--
-- EVERY derived column below is OUR INTERPRETATION, not Disney's. Disney
-- supplies ONE string per property. The base-name/likeness split is inferred
-- by us from that string. Where the inference is not clean,
-- likeness_parse_confident is false and callers must fall back to
-- property_name. Disney's verbatim strings are always carried through.
-- ---------------------------------------------------------------------------

create view api.opa_property_character
with (security_invoker = true) as
select
  -- Disney's own values, verbatim. Trust these.
  o.licensed_property_id,
  o.character_id,
  o.brand_property_id,
  o.property_name,
  o.character_name,

  -- OUR INTERPRETATION from here down. -------------------------------------
  btrim(regexp_replace(
    o.property_name,
    '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'
  )) as base_property_name_interpreted,

  case
    when o.property_name ~* '-\s*With\s+Likeness\s*$'              then 'with'
    when o.property_name ~* '-\s*(No|Without)\s+Likeness\s*$'      then 'without'
    when o.property_name ~* 'Likeness'                             then 'unparsed'
    else null
  end as likeness_interpreted,

  (o.property_name !~* 'Likeness'
   or o.property_name ~* '-\s*(No|With|Without)\s+Likeness\s*$')
    as likeness_parse_confident,
  -- ------------------------------------------------------------------------

  -- Provenance, so no consumer can read a row without its caveats.
  o.captured_at,
  o.line_of_business,
  o.entitlement_scope,
  o.source_url
from plm.opa_property_character o;

comment on view api.opa_property_character is
  'Consumable read-only view over the raw Disney OPA landing. '
  'base_property_name_interpreted, likeness_interpreted and '
  'likeness_parse_confident are OUR INTERPRETATION of Disney''s single '
  'property string - Disney does not supply a likeness field. When '
  'likeness_parse_confident is false, use property_name and do not rely on '
  'the split. SCOPE: Home line of business only, POP Creations entitlement '
  'only, snapshot dated captured_at. This is NOT all of Disney. '
  'NO join to core.property exists by design - see DESIGN.md section 7.';

comment on column api.opa_property_character.likeness_interpreted is
  'OUR interpretation, three-valued: with | without | unparsed | NULL. '
  'NULL means the property name does not mention likeness at all. '
  '"unparsed" means it mentions likeness in a shape we could not split '
  'cleanly (9 of 1,444 names in the 2026-08-06 extract, e.g. '
  '"X-Men: First Class - With Likeness - Discontinued as of 1-Aug-12"). '
  'Disney spells it "Without Likeness" on at least one property.';

grant select on api.opa_property_character to authenticated;
grant select on api.opa_property_character to service_role;
revoke all on api.opa_property_character from anon;
```

**On `security_invoker = true`:** the view is declared invoker-security so it
cannot become a privilege-escalation path around the base table's RLS. The
existing `api.coldlion_*_reconciliation` views should be checked for the same
setting when this is implemented; if they are definer-security, that is a
pre-existing finding to raise separately, not something to copy.

---

## 4. How the CSV actually gets loaded

10,262 rows have to arrive. The options, honestly compared.

| Option | How | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| **A. Seed migration** with 10,262 generated `insert ... values` rows | Generate the SQL from the CSV with a script, commit it as a data migration under `supabase/migrations/` | Reproducible; travels with the schema; preview-then-production works exactly as for every other change; version-controlled and reviewable | Adds roughly 1.5–2 MB of SQL to the repo; puts business-confidential Disney data into git history permanently; a large single-statement migration is slow and awkward to review in a PR diff | **Recommended, with the caveat in §4.1** |
| **B. `\copy` from the CSV via psql** | Load out of band against preview then production | Fast; keeps the data out of git | **Requires direct psql against the shared DB, which is forbidden by standing rule.** Not reproducible; not reviewable; leaves no record of what landed | **Rejected** |
| **C. Tool script in the repo** that reads the CSV and inserts via the service role | e.g. `tools/load-opa-extract.*`, run once by the apply workflow | Data stays as a CSV, not SQL; re-runnable for the next snapshot; the loader is reviewable even though the data is not | Introduces a second way to change the database besides migrations; ordering versus migrations must be handled; needs the service-role credential | **Viable second choice** |
| **D. Supabase MCP `apply_migration`** | — | — | The MCP available to this session is **read-only and bound to production**. Not an option | **Rejected** |

### 4.1 The confidentiality trade-off, stated plainly

`opa-characters.csv` is **business-confidential Disney data obtained through a
commercial licensing relationship.** It must not be published and **must not be
sent to any third-party service** — no external formatter, no cloud spreadsheet,
no AI service other than the one already operating inside this repo, no paste
into an issue or a chat that leaves this environment.

Both option A and option C put the data somewhere durable. Note that **the CSV is
already committed to this repository** (merged in PR #466), so option A does not
newly expose it — the repository is already the custody boundary, and
`u2giants/shared-db` is private. That materially weakens the main argument
against option A.

**Recommendation: option A, a seed migration generated from the committed CSV**,
because it keeps a single mechanism for changing the database, and because the
confidentiality boundary the seed would cross has already been crossed by the
CSV itself. The generator script should be committed alongside so the seed can
be regenerated from a future snapshot rather than hand-edited.

### 4.2 Refresh, per Albert's ruling

One-off snapshot. **No schedule. No automation.** Automation is impossible: OPA
requires MFA and exposes no API. `captured_at` is stamped on every row so a
second snapshot is distinguishable from the first.

The refresh ritual is already written in `README.md` §4 and takes about two
minutes: Albert logs into OPA in his own Chrome and completes MFA himself; the
product-create page is opened; `showAllProperties()` is called; the jsTree model
is flattened to CSV by the snippet in §4; the file is downloaded. **No
credential, password, or MFA code passes through any AI session.** Note the
snippet's own warning that the jsTree element id (`jstree_741` in the recorded
run) is generated per page load and must be re-read with
`document.querySelector('.jstree').id`.

A refresh replaces the snapshot; it does not merge into it. If two snapshots
ever need to coexist, `captured_at` must be added to the primary key — a change
this design deliberately does **not** make, because there is exactly one
snapshot and speculative keys are a cost with no current benefit.

---

## 5. Is OPA's `characterID` a usable identity key?

README §6a flags this as unverified and worth testing early. **Tested, against
the CSV. The answer is more encouraging than README §3 implies — and it
contradicts README §3.**

| Test | Result |
| --- | --- |
| Distinct `characterID` values | **9,613** |
| Distinct character names | 9,591 |
| Rows | 10,262 |
| `characterID` values mapping to **more than one distinct name** | **0** |
| `characterID` values appearing under **more than one property** | **609** |
| Character **names** mapping to more than one `characterID` | **21** |
| `(licensedPropertyID, characterID)` pairs | **10,262 — perfectly unique** |

**What this means:**

1. **`characterID` is a stable character identity, not a per-row surrogate.**
   Not one of the 9,613 IDs maps to two different names. That is a strong
   signal: Disney is assigning an ID to a character, and reusing it.
2. **It is NOT property-scoped.** 609 `characterID` values appear under more than
   one property — the *same* ID, not different IDs for the same name.
3. **README §3 states the opposite and is wrong on this point.** It says "the
   same character name recurs under many different properties, **with different
   `characterID` values**." Measured, the recurrence is the *same* ID reused
   across properties. This matters enormously: it means the 609 recurrences are
   Disney telling us "this is one character appearing in several properties",
   which is precisely the **many-to-many** relationship
   `docs/style-guides-characters-and-royalties.md` describes — and it is
   independent corroboration of Laura's round-2 answer recorded in PR #468, where
   all 11 dual-code rows came back `NONE` because *"the character appears on both
   universes."*
4. **21 names carry more than one `characterID`.** These are genuine duplicates
   or homonyms in Disney's own data, e.g. `Beagle Boys` has **three** IDs (`510`,
   `512`, `518031315`), `Wolverine ( Marvel Universe )` has two (`1159148491`,
   `518033482`), and `Ant-Man ( Marvel Universe )` has two. Note the shape: an
   old short numeric ID alongside a long modern one. This looks like a Disney
   system migration that left both generations live. **Do not dedupe these
   without asking Disney** — we cannot tell from outside which is authoritative.

**Verdict on feeding `core.character`:** `characterID` is a *usable* identity key
and is materially better than a name. But `core.character.property_id` is a
single scalar parent, and 609 OPA characters have several properties. **OPA
cannot feed `core.character` in its current shape without either picking one
parent per character (losing Disney's information) or changing
`core.character`'s model.** That is a real design decision, it belongs to Albert
and the coordinator, and it is **explicitly out of scope here** (§7).

---

## 6. Disagreements with our existing character data — reported, not resolved

Per the brief: **where OPA and our data disagree, the disagreement is the
finding.** Nothing below has been "fixed".

### 6.1 Method

Comparison is on a normalised base name: the trailing
` ( Something )` style-guide suffix stripped, whitespace collapsed, lower-cased.
On that basis OPA's 9,591 raw character names reduce to **6,564 distinct base
names** — meaning **5,904 of OPA's names carry a parenthesised suffix.**

That number is directly relevant to PR #468's hazard, which reports that only
**4,519 of 9,622** appearance rows in our legacy data carry a `( style guide )`
suffix. Measured on production for this design: `public.characters` holds 9,622
rows, **8,370 distinct names**, of which **3,973 carry a parenthesised suffix.**
So the suffix convention is **inconsistent on both sides** — 61% of OPA names
have it, 41% of ours do. Any matching built on the suffix will fail on roughly
half the data in each direction. **This confirms and extends PR #468's hazard;
it does not resolve it.**

### 6.2 OPA vs `canonical-character-identities.csv`

`docs/verification/character-identity-rules-20260728/canonical-character-identities.csv`
holds 6,538 rows / 5,913 distinct normalised identity names across five legacy
`licensorId` values. Overlap with OPA, by licensor:

| legacy `licensorId` | distinct names | also in OPA | % |
| ---: | ---: | ---: | ---: |
| 3 | 2,266 | 2,088 | **92.1%** |
| 1 | 795 | 765 | **96.2%** |
| 2 | 2,407 | 51 | 2.1% |
| 12 | 591 | 4 | 0.7% |
| 13 | 5 | 0 | 0.0% |

**This is a clean, self-validating result and is itself a finding.** Legacy
licensors **1 and 3 are the Disney family** (Disney and Marvel) — they overlap
OPA at 92–96%. Licensors 2, 12 and 13 are Warner Bros, WWE and another
non-Disney licensor, and overlap OPA at under 3%, exactly as they should since
OPA is a Disney-only portal. **The extract is behaving like genuine Disney data.
That is meaningful independent corroboration that this file is what it claims to
be.**

Restricted to the Disney family (legacy licensors 1 + 3): **2,951 distinct
canonical names, of which 2,743 (93.0%) are found in OPA and 208 are not.**

### 6.3 The 208 misses — and what they actually are

The misses are mostly **not** disagreements about which characters exist. They
are disagreements about **how a name is written.**

| Cause | Count | Example |
| --- | ---: | --- |
| **Surname-first ordering** — OPA writes `Watson, Anna`; we write `Anna Watson` | **147** | `agatha harkness` → OPA `Harkness, Agatha`; `arnim zola` → OPA `Zola, Arnim`; `amadeus cho` → OPA `Cho, Amadeus` |
| Genuinely absent from OPA, or differing beyond ordering | **61** | `agony (symbiote` (note: **our** value has an unclosed parenthesis — a defect on our side), `baxter building` (a location, not a character), `alpha primitives` |

**663 of OPA's base names use the `Lastname, Firstname` form.** This is a
systematic Disney convention, not sporadic. Any reconciliation that does not
handle it will report roughly 150 false mismatches on the Disney family alone
and will look like a data problem when it is a formatting problem.

Separately: **250 OPA base names contain a backtick (`` ` ``) where an
apostrophe is expected** — `O`Hara, Miguel`, `Man`s`, `Emperor`s`. Measured, this
accounts for none of the 208 misses (our side apparently uses the same character
or the affected names are absent for other reasons), but any future
string-matching code must normalise it or it will silently fail.

### 6.4 OPA vs `public.characters` directly

`public.characters` was measured on production: 9,622 rows, 8,370 distinct
names, 3,973 with a parenthesised suffix. Joined through
`public.properties` → `public.licensors`, the distribution is:

| Licensor | Appearances | Distinct names |
| --- | ---: | ---: |
| Warner Bros | 4,090 | 3,030 |
| Marvel | 3,824 | 3,667 |
| Disney | 1,097 | 1,066 |
| WWE | 604 | 603 |
| Coca Cola | 6 | 6 |
| Strawberry Shortcake | 1 | 1 |

Restricted to Disney + Marvel (`external_id` `DS` and `MV`), `public.characters`
holds **3,366 distinct base names**. OPA holds **6,564**.

> **OPA knows roughly twice as many Disney-family character names as our
> database does — from a single line of business, on one licensee's
> entitlements.** That is the size of the gap, and it is the most useful number
> in this document.

**An exact set intersection between OPA and `public.characters` was NOT
computed.** Doing it properly means having both sets in the same place, which is
exactly what this landing is for. Computing it now would mean either shipping
thousands of names through a tool boundary or sampling, and the sampled answer
would be less useful than the exact one available the day after this lands. It
is listed in §7 as deferred work, with the query shape ready to run.

### 6.5 The disagreements, summarised — all left unresolved

1. Suffix convention is inconsistent on **both** sides (61% vs 41%). Extends PR
   #468's hazard. **Not resolved.**
2. OPA uses `Lastname, Firstname` for 663 names; we use `Firstname Lastname`. A
   canonical form must be chosen. **Not chosen.**
3. OPA uses backticks for apostrophes on 250 names. **Not normalised.**
4. 61 Disney-family canonical names have no OPA counterpart, including at least
   one defect on **our** side (`agony (symbiote` — unclosed parenthesis) and at
   least one row that is a location rather than a character (`baxter building`).
   **Not corrected.**
5. 21 OPA character names carry multiple `characterID`s, apparently from a Disney
   system migration. **Not deduped** — we cannot tell which is authoritative.
6. `Davy Crockett` is two different Disney properties with one name. **Not
   disambiguated.**

---

## 7. What I did NOT do, and what is left

### 7.1 Explicitly not done

- **No migration written.** No file was created, modified, or deleted anywhere
  under `supabase/`.
- **No database write of any kind.** No `insert`, `update`, `delete`, `create`,
  `alter`, `drop`, or `apply_migration`. Every database call was a read-only
  `select` or catalog query against production `qsllyeztdwjgirsysgai`.
- **No `supabase` CLI command and no `psql`.**
- **No preview contact at all** (`rjyboqwcdzcocqgmsyel` was never touched).
- **No background task chip created.**
- **The shared checkout `C:\repos\shared-db` was never touched.** All work was
  done in an isolated worktree on branch `agent/opa-lookup-design-20260807`.
- **`HANDOFF.md`, `AGENTS.md`, `COORDINATOR_INTAKE.md` and `supabase/**` were not
  edited.** The only file added is this one.
- **No commit to `main`, no merge, no PR merge.**
- **The canonical Disney licensor value was NOT chosen** — see §2. That is
  Albert's decision and it is presented, not made.

### 7.2 Left for later, in priority order

1. **Albert's decision on the Disney licensor identity (§2).** Blocks
   reconciliation, not the landing. Also owed: is Disney's code `DY`
   (`core.licensor`) or `DS` (`public.licensors`), and should the two be
   reconciled?
2. **Reconciliation against `core.property` — deliberately deferred by the
   coordinator.** This is the big one. Recommended shape, following the
   `plm.erp_property` precedent exactly: add nullable resolution columns
   (`property_id uuid`, `resolution_status`, `resolution_reason`, `resolved_at`,
   `resolved_by`) to `plm.opa_property_character`, plus an
   `api.opa_property_reconciliation` view. **It is a cross-app data contract**
   (PopCRM and DesignFlow both read licensor/property data) and needs that
   review. It must not be bolted onto the landing migration.
3. **The exact OPA ↔ `public.characters` intersection (§6.4).** Trivial once
   both sets are in the same database. Run it the day after this lands, and
   compare with the 93.0% figure §6.2 established against the canonical CSV.
4. **A decision on name canonicalisation** — surname ordering, backticks, and the
   parenthesised suffix (§6.5 items 1–3). Needed before any automated matching.
5. **Whether OPA can ever feed `core.character` (§5).** Blocked on a model
   decision: 609 OPA characters have multiple properties, but
   `core.character.property_id` is a single scalar parent.
6. **Verify whether other lines of business expose a different property set.**
   Albert has ruled this out for now. `README.md` §5 records how to check:
   load the same screen with a different `lob` value and compare against 1,445.
7. **Establish what `optionSourceID` means.** Constant `1007` today. Until
   somebody asks Disney, the check constraint keeps us honest.
8. **Check whether `api.coldlion_*_reconciliation` are definer- or
   invoker-security views (§3.7).** If definer, that is a pre-existing finding to
   raise separately — not something this design should copy.
9. **Consider recording the `core.properties_and_characters` /
   `core.property_character_associations` duplicates (§1.1 item 2) in
   `AGENTS.md` §6.1**, so the next session does not rediscover them and
   re-litigate the lineage question §6a already closed. `AGENTS.md` is a
   single-writer file owned by the coordinator; this is a recommendation, not an
   edit.

---

## 8. Corrections this design makes to existing documents

Collected in one place so they are not lost in the detail. **None of these
documents was edited by this session** — `README.md` in this folder is not owned
by this task.

| Document | Claim | Correction |
| --- | --- | --- |
| `README.md` §3 | "Distinct properties: 1,445" | **1,444 distinct property names**; 1,445 distinct IDs. `Davy Crockett` is two properties |
| `README.md` §3 | "roughly 670 names appear under more than one property" | **609** |
| `README.md` §3 | "The natural key is the (property, character) pair" | The **name** pair is not unique (10,240 vs 10,262 rows). The key is the **ID** pair, `(licensedPropertyID, characterID)`, which is exactly unique |
| `README.md` §3 | "the same character name recurs under many different properties, **with different `characterID` values**" | **Wrong.** The *same* `characterID` recurs across properties (609 of them). No `characterID` ever maps to two names |
| `README.md` §6a | Names `dflow.properties_and_characters` (10,122) and `public.characters` (9,622) | Counts correct, but **incomplete**: `core.properties_and_characters` is also 10,122 and `core.property_character_associations` is also 9,622 |
| `README.md` §7 Q1 | "the ColdLion pattern" | There is **no `coldlion` schema**. The pattern is `plm.erp_*` mirrors + `api.*` views |
| — | (general) | `pg_stat_user_tables.n_live_tup` is **stale on this database** and reports 0 for tables holding thousands of rows. Use `count(*)` |
