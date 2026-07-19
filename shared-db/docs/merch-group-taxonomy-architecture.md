# Merch groups: the Coldlion → DesignFlow → Supabase taxonomy

**Status:** authoritative. Written 2026-07-19 from (a) live calls against the Coldlion ERP
API, (b) live queries against the shared Supabase backend `qsllyeztdwjgirsysgai`, and
(c) a full read of the six `popcre/designflow-*` repos on branch `sandbox-albert`.

**Who this is for:** an engineer who has never seen this system. Read this before touching
anything named licensor, property, merch group, big theme, little theme, style guide,
art type, art source, artist, age group, or `mgTypeCode`.

**Why it exists:** the single most expensive misunderstanding in this codebase is believing
that "licensor" and "property" are tables. They are not. They are *rows in one table*,
whose meaning changes depending on which division you are looking at. Every bug in this
area traces back to that.

---

## 0. The one-paragraph summary

Coldlion (the ERP) stores all classification data as **merch groups**: flat code→name
dictionaries, numbered `01`–`14`, defined **separately per division**. In the two licensed
divisions, type `05` means Licensor and type `06` means Property. Coldlion knows *which
licensors exist* and *which properties exist*, but **not which property belongs to which
licensor** — it has no field for that. DesignFlow PLM ingests those flat lists into a single
`merchGroup` table and adds the parent-child edge itself via a self-referencing `parent_id`
column, maintained outside the ETL. Our Supabase backend then imports DesignFlow's
already-related taxonomy into `core.licensor` / `core.property`. So: **Coldlion owns the
vocabulary, DesignFlow owns the relationships, Supabase is a downstream mirror of both.**

---

## 1. Vocabulary, in the three systems' own words

The same concept has three names depending on where you stand. Getting these confused is
the main source of error.

| Concept | Coldlion (ERP) | DesignFlow (PLM) | Supabase (ours) |
|---|---|---|---|
| The classification system | merch groups | `merchGroup` table | `core.*` taxonomy |
| Which kind of thing a row is | `mgTypeCode` (`"01"`–`"14"`, string) | `mgTypeCode` (string, opaque) | the table it landed in |
| What that kind *means* | `mgTypeDesc` on `/merchGroupHeaders` | `merchGroupHeaders.mgTypeDesc` | implicit |
| The code | `mgCode` | `mg_code` | `code` |
| The label | `mgDesc` | `mg_desc` | `name` |
| The business unit | `divisionCode` (`CW001`…) | `divisionCode_id_fk` (`1`/`8`/`9`) | **dropped** (§7) |
| Parent link | *(does not exist)* | `parent_id` → `mg_id` | `property.licensor_id` |

**Division identifiers differ between systems and this trips people constantly.** Coldlion
uses string codes; DesignFlow uses integers. The mapping is hard-coded in the ETL
(`designflow-data-syncing/helpers/utility.js:241-244`):

| Coldlion | DesignFlow `divisionCode_id_fk` | Business name | Licensed? |
|---|---|---|---|
| `CW001` | `1` | POP Lic | **Yes** |
| `SP001` | `8` | Spruce Lic | **Yes** |
| `EH001` | `9` | Spruce Non-Lic | No |
| `EP001` | *(none — never synced)* | Edge Products | No |

The strings `CW001`/`SP001`/`EH001`/`EP001` **do not appear anywhere in the DesignFlow
frontend**. The UI knows only `divCode_id` ∈ {1, 8, 9}, named at
`designflow-frontend/.../addNewProduct.component.ts:26-28`:

```ts
const POP_LIC_DIV_CODE_ID = 1;
const SPRUCE_LIC_DIV_CODE_ID = 8;
const SPRUCE_NON_LIC_DIV_CODE_ID = 9;
```

> **EP001 does not exist in DesignFlow at all.** The ETL's division list defaults to
> `["CW001", "SP001", "EH001"]` (`designflow-data-syncing/models/lib.model.js:873`). Edge
> Products is invisible to PLM and to us. If someone asks why an EP001 item has no
> taxonomy, this is why.

---

## 2. The critical rule: `mgTypeCode` means different things per division

**A merch group type number has no fixed meaning.** Its meaning is defined per division by
`mgTypeDesc` on `/merchGroupHeaders`. Verified live 2026-07-19:

| `mgTypeCode` | CW001 (POP Lic) | SP001 (Spruce Lic) | EH001 (Spruce Non-Lic) | EP001 (Edge Products) |
|---|---|---|---|---|
| `01` | Type | Type | Type | Type |
| `02` | Sub-Type | Sub-Type | Sub-Type | Sub-Type |
| `03` | Sub-Sub-Type | Sub-Sub-Type | Sub-Sub-Type | Sub-Sub-Type |
| `04` | Size | Size | Size | **Pages** |
| **`05`** | **Licensor** | **Licensor** | **Big Theme** | **Product Line** |
| **`06`** | **Property** | **Property** | **Little Theme** | **Product Type** |
| **`07`** | **Style Guide** | **Style Guide** | **Art Type** | **Character** |
| `08` | Art Source | Art Source | Art Source | — |
| `09` | Artist | Artist | Artist | — |
| `10` | Demographic | Demographic | Demographic | — |
| `11`–`14` | *(no header defined)* | | | |

> ### ⚠️ The single most dangerous assumption in this system
>
> Several existing documents state flatly that **`merchGroup05` = licensor** and
> **`merchGroup06` = property**. That is true for **two of the four divisions only**.
> In EH001 those same slots are Big Theme and Little Theme; in EP001 they are Product Line
> and Product Type.
>
> **Any sync that keys on the numeric `mgTypeCode` without also checking division will
> import "Big Theme" values into the licensor table and silently corrupt the taxonomy.**
> Always resolve meaning through `(divisionCode, mgTypeCode) → mgTypeDesc`.

Live row counts per division/type, 2026-07-19:

| Type | CW001 | SP001 | EH001 | EP001 |
|---|---|---|---|---|
| 01 | 20 | 20 | 20 | 20 |
| 02 | 100 | 106 | 105 | 9 |
| 03 | 203 | 207 | 216 | 9 |
| 04 | 187 | 187 | 156 | 14 |
| **05** | **22** | **22** | 18 | 7 |
| **06** | **258** | **258** | 50 | 10 |
| 07 | **0** | **0** | 2 | 0 |
| 08 | 3 | 3 | 3 | 0 |
| 09 | 68 | 68 | 68 | 0 |
| 10 | 3 | 3 | 3 | 0 |
| 11–14 | 0 | 0 | 0 | 0 |

Note **Style Guide is empty in Coldlion for both licensed divisions**. Style guides are
therefore entirely DesignFlow-owned; nothing flows in from the ERP.

---

## 3. What Coldlion actually gives you

- **Base URL:** `http://x5.coldlion.com/EhpApi` (plain HTTP)
- **Swagger UI:** `http://x5.coldlion.com/EhpApi/swagger-ui.html#/`
- **OpenAPI spec:** `http://x5.coldlion.com/EhpApi/v2/api-docs` (Swagger 2.0, v1.5.1)
- **Auth:** `X-API-Key` header on every call. Key at
  `op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`.
- Full endpoint map: [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md).

### 3.1 The merch group endpoints

`GET /merchGroupHeaders?companyCode=EDGEHOME` — the **dictionary of meanings**. Returns
`{companyCode, divisionCode, mgTypeCode, mgTypeDesc, createdTime/User, modTime/User}`.
This is the only place the semantics live. 37 rows.

`GET /merchGroupDetails?companyCode=EDGEHOME&divisionCode=X&mgTypeCode=NN` — the **values**.
Returns a **plain JSON array** (not a paged envelope — unlike most Coldlion endpoints):

```json
{
  "companyCode": "EDGEHOME", "divisionCode": "CW001", "mgTypeCode": "05",
  "mgCode": "DY", "mgDesc": "DISNEY", "itemNoCode": "DY",
  "mgCategory": "", "mgCode2": "DY",
  "createdTime": "...", "createdUser": "...", "modTime": "...", "modUser": "..."
}
```

Not typed in the Swagger spec — the response schema is declared as bare `{"type":"object"}`
and only five models exist in the whole spec (`ItemDetail`, `ItemHeader`, `ItemImageDTO`,
`OrderDetail`, `OrderHeader`). The merch group shape above was derived from live responses.

### 3.2 Three hard facts about Coldlion merch groups

**(a) There is no parent-child link. At all.**
`mgCategory` is the only field that could plausibly carry one, and it is **empty on every
row** — verified across all 22 licensors and all 258 properties in CW001. `mgCode2` and
`itemNoCode` are near-duplicates of `mgCode` (identical on all 22 licensors; they differ on
11 of 258 properties, e.g. `CHR`/`CH`, `EBB`/`BB`). **The licensor→property relationship
does not exist in the ERP and cannot be recovered from `/merchGroupDetails`.**

**(b) There is no active/inactive flag.**
The payload has no `status`, `active`, `isActive`, or `deleted` field. A discontinued
licensor is byte-for-byte indistinguishable from a current one. **Coldlion is structurally
incapable of telling you a license has lapsed.** Deactivation is therefore *necessarily* a
DesignFlow-side concern — see §6.

**(c) Codes are only unique within `(division, mgTypeCode)`.**
The same code means different things in different slots. Real example: **`FR` is a
*property* in Coldlion meaning "1ST ORDER TROOPER"** (Star Wars), while in our
`core.licensor` `FR` is **"FRIENDS TV"**. Any lookup keyed on `mgCode` alone will collide.
There is a live instance of exactly this bug — see §9.3.

### 3.3 Where items point at merch groups

Every item header carries `merchGroup01` … `merchGroup14` as **flat text codes**. In the
licensed divisions `merchGroup05` holds the licensor code and `merchGroup06` the property
code. Because both sit on the same item row, **licensor→property pairs are derivable by
co-occurrence** — this is the only place in Coldlion where the relationship is implicitly
present. Nothing currently exploits it. (See §10.2.)

---

## 4. What DesignFlow does with it

### 4.1 One table for everything

There is **no licensor table, no property table, no style guide table**. All ten merch group
types live in a single Cloud SQL table `merchGroup`, discriminated by `mgTypeCode`
(`designflow-item-master/models/db/merchGroup.js:3-88`):

| Column | Type | Role |
|---|---|---|
| `mg_id` | INTEGER PK | surrogate key |
| `mg_code` | STRING | the Coldlion `mgCode` |
| `mg_desc` | STRING | the Coldlion `mgDesc` (display label) |
| `ItemNoCode` | STRING | item-number segment |
| `mgTypeCode` | STRING | **discriminator**, `"01"`–`"10"` |
| `divisionCode_fk` | STRING | `CW001` / `SP001` / `EH001` |
| `divisionCode_id_fk` | INTEGER | `1` / `8` / `9` |
| `companyCode_fk`, `companyCode_id_fk` | STRING / INTEGER | company (hard-coded `1`) |
| `is_active` | BOOLEAN, nullable, DB default `false` | **DesignFlow-owned**, not from ERP |
| `parent_id` | INTEGER | **self-reference to `mg_id`** — the hierarchy |
| `mgCode2`, `mgCategory` | STRING | secondary code / category |
| `createdTime`, `createdUser`, `modTime`, `modUser` | STRING | audit (strings, not timestamps) |

**`merchGroup` has exactly one constraint — the primary key on `mg_id`. It has ZERO foreign
keys.** Not on `parent_id`, not on `divisionCode_id_fk`, not on `companyCode_id_fk`. The
entire taxonomy hierarchy is application-enforced only, and no Sequelize self-association is
declared either. There is also **no cycle protection** — a row can legally be its own parent.

Production orphans are documented and real: an MG03 orphan (1 row, excluded from migration)
and 54 inactive MG02 orphans.

Note `is_active` defaults to **`false`**, so ERP-synced rows arrive inactive until something
explicitly enables them.

### 4.2 The relationship graph the code actually implements

Derived from the frontend cascade logic, which is the most reliable evidence of intent:

```
Division (1 POP-Lic · 8 Spruce-Lic · 9 Spruce-Non-Lic)
│
├── MG Category (mgCategory — allowlisted per division by substring match)
│
├── PRODUCT AXIS — 3-level parent_id chain, identical in all divisions
│     MG01 Product Type ──▶ MG02 Product Sub-Type ──▶ MG03 Product Sub-Sub-Type
│     (internal names: Material ──▶ Construction ──▶ Feature)
│
├── LICENSED AXIS — divisions 1 and 8 only
│     MG05 Licensor ──parent_id──▶ MG06 Property
│     MG07 Style Guide  (FLAT — no parent, and zero rows in Coldlion)
│
├── GENERIC AXIS — division 9, same columns, different labels
│     MG05 Big Theme      MG06 Little Theme      MG07 Art Type
│     (NOT cascaded — Big/Little Theme are loaded as flat unfiltered lists)
│
└── FLAT ATTRIBUTES — parent_id unused
      MG04 Size · MG08 Art Source · MG09 Artist · MG10 Age Group
      MG15 For Customer · Season (separate table)
```

Three points that contradict common assumptions:

1. **Style Guide is not hierarchical.** No code anywhere filters style guides by property or
   licensor.
2. **Big Theme → Little Theme is NOT cascaded**, even though it occupies the exact same
   MG05/MG06 slots as the cascaded Licensor → Property.
3. **A property has exactly one licensor.** `parent_id` is a scalar integer; there is no
   bridge table. To place a property under two licensors you must duplicate the row — which
   is precisely what the division dimension does today.

The cascade itself is client-side, in-memory, and hand-copied into at least six components.
The canonical form (`newItem-dialog.component.ts:1154-1171`):

```ts
getPropertyByLicense(selectedTitle) {
    const selectedLicense = this.filteredOptions.licensorOptions.find(
        option => option.title === selectedTitle
    );
    if (selectedLicense) {
        const licenseId = selectedLicense.id;
        this.filteredOptions.propertyOptions = this.propertyOptions
            .filter(feature => feature.parent_id === Number(licenseId))
    }
}
```

### 4.3 Division-conditional validation — the cleanest statement of the model

`designflow-item-master/helpers/itemReferenceGuard.js:62-70`:

```js
if (divisionId === 9) {
  await requireMerchGroup(sql, body.selectedbigtheme,     'Big Theme',  true);
  await requireMerchGroup(sql, body.selectedLittleTheme,  'Little Theme', true);
  await requireMerchGroup(sql, body.selectedArtType,      'Art Type',   true);
} else {
  await requireMerchGroup(sql, body.selectedLicensor,     'Licensor',   true);
  await requireMerchGroup(sql, body.selectedProperty,     'Property',   true);
  await requireMerchGroup(sql, body.selectedStyleGuide,   'Style Guide', true);
}
```

**But division scoping is convention, not constraint.** There is exactly **one** place in
the entire codebase where licensor is restricted to the licensed divisions —
`designflow-tracking/models/lic.model.js:225-229`, a bare array literal with no named
constant:

```js
where: { mgTypeCode: '05', divisionCode_id_fk: { [Op.in]: [1, 8] } }
```

Everywhere else it is optional or absent. `getLicensorsWithProperties` skips the division
filter entirely when the caller omits the parameter, so **division-9 Big Theme / Little Theme
rows are returned to the client labelled as Licensor / Property**. `getMerchGroup` falls back
to `[1, 8, 9]` with only a `console.warn`. Art Type creation hard-codes `divisioncode_id: 9`.
Nothing in the schema constrains any of it.

One more trap: the `merchGroup ↔ merchGroupHeaders ↔ divisionCode` Sequelize associations are
**not declared statically**. They are built at boot from rows in a `UDFTable` table
(`init-models.js:97-131`), so the ORM relationship graph is data-driven and changes if that
table changes.

### 4.4 Items and art pieces both point back at `merchGroup`

- **Items** (`itemHeader`): MG01–04 use `udf_merchgroupNN` + `udf_merchgroupNN_id`;
  MG05–10 use `udf_merchgroupNN_fk` + `udf_merchgroupNN_fk_id`. Slots exist up to
  `udf_merchgroup25_fk`.
- **Art pieces** (`artPiece`): `licensor_id`, `property_id`, `style_guide_id`,
  `big_theme_id`, `little_theme_id`, `art_type_id`, `art_source_id`, `artist_id`,
  `age_group_id` — **all nine reference `merchGroup.mg_id`**.

### 4.5 A second, independent licensor spine exists

Separate from merch groups, the legacy `dflow` schema carries a **licensing-agreement**
system that also has "licensor" and "property":

- `dflow."licenseList"` — the license agreements (royalty rates, status). Airbyte-sourced.
- `dflow.properties_and_characters` (10,122 rows) — FKs to `licenseList`, **not** to
  `merchGroup`.
- `dflow.property_character_associations` (9,622 rows) — a genuine many-to-many bridge,
  composite PK `(property_id, character_id, licensor_id)`.

**This is the only place a true property↔character many-to-many exists, and it is a
different licensor spine from the merch-group one.** Do not join them naively. The
merch-group "Licensor" is a *classification code*; `licenseList` is a *contract*.

Side by side:

| | System A — `merchGroup` | System B — `licenseList` |
|---|---|---|
| Licensor | row where `mgTypeCode='05'` | `licenseList` table |
| Property | row where `mgTypeCode='06'` | `properties_and_characters` `type='PROPERTY'` |
| Character | *(none)* | `properties_and_characters` `type='CHARACTER'` |
| Source | Coldlion ERP sync | manual + Airbyte |
| FK enforcement | **none** | full graph, CASCADE/RESTRICT |
| Division-scoped | yes | **no** |
| Read by | Item Library, RFQ, Licensing Tracking | `item_character_associations` only |

**There is no join, no FK, and no reconciliation code between them.** A licensor created in
`licenseList` is invisible to every screen that reads MG05.

### 4.6 A fully-designed v2 hierarchy exists and is completely unused

`dflow."merchGroupMaster"` and `dflow."merchGroupRelations"` externalize the hierarchy into a
proper edge table — real FKs with `ON DELETE CASCADE`, `is_active DEFAULT true`, proper
timestamp types, a `CHECK (parent_mg_id <> child_mg_id)` anti-cycle guard, and two unique
indexes covering the grandparent/parent/child triple.

**Neither table has a Sequelize model in any of the six repos, and no application code
references them.** They hold ~1,389 edges and 2,017 master rows. This is a correct
replacement for `merchGroup.parent_id` that was built and never adopted. Anyone fixing the
hierarchy should look here first rather than designing a third scheme.

### 4.7 Who can create what

| Entity | Create | Update | Delete | Who |
|---|---|---|---|---|
| **Licensor (MG05)** | ❌ no route | ❌ | ❌ | ERP sync only |
| **Property (MG06)** | ❌ no route | ❌ | ❌ | ERP sync only |
| **Style Guide (MG07)** | ❌ no route | ❌ | ❌ | — |
| Merch group re-parent | ❌ | ✅ orphan repair only | ❌ | admin |
| `licenseList` licensor | ✅ | ✅ | ❌ | admin, sourcing_manager |
| Art Type / Artist Type / Artist / Age Group | ✅ | ✅ | soft | **every role incl. `vendor`** |

Merch-group licensors and properties are **strictly read-only, ERP-sourced**. The only
taxonomy write in the whole app is an orphan-adoption routine that re-parents an existing
Product Type triple. All deletes elsewhere are soft (`is_active = false`); no hard-delete
path exists, so the schema's CASCADE/RESTRICT rules are effectively unexercised.

---

## 5. What Supabase does with it

### 5.1 The pipeline

```
Coldlion /merchGroupDetails
   │  (Cloud Scheduler `getMerchgroupDetailFromCL`, daily 02:00,
   │   GCP project lithe-breaker-323913 → Cloud Run popcre-sync-prod)
   ▼
DesignFlow Cloud SQL  `merchGroup`  ← parent_id added HERE, outside the ETL
   │  (GET api.designflow.app/api/item_master/lib/getLicensorsWithProperties)
   ▼
shared-db  tools/sync-plm-master-data.mjs   (systemd plm-sync.timer, daily 03:30)
   │  → plm.import_master_data(jsonb, jsonb)
   ▼
plm.licensor_import / plm.property_import   (source-shaped staging)
   ▼
core.licensor / core.property               (canonical)
   + core.taxonomy_source_ref               (provenance)
   + ingest.raw_record                      (raw snapshot)
```

### 5.2 The canonical tables

`supabase/migrations/20260621150815_app_core.sql:180-213`:

```sql
create table core.licensor (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (code)          -- ← see §7
);

create table core.property (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid references core.licensor(id) on delete set null,
  name text not null, code text,
  status app.entity_status not null default 'active',
  ...
  unique nulls not distinct (licensor_id, code)
);

create table core.character (
  id uuid primary key ...,
  property_id uuid references core.property(id) on delete cascade,
  ...
);
```

Provenance lands in `core.taxonomy_source_ref` — `source_system='designflow_plm'`,
`source_table='merchGroup'`, `source_id=mg_id`. **No `coldlion` value appears in taxonomy
provenance anywhere**, because we receive this data via DesignFlow, not directly.

### 5.3 The dflow schema is not migration-managed

There are **no `.sql` migration files in any of the six DesignFlow repos.** The Sequelize
models are `sequelize-auto`-generated reflections of a Cloud SQL database whose schema was
changed out of band. The only authoritative DDL artifact for the `dflow` schema is
[`supabase/migrations/20260710135950_reconcile_dflow_baseline.sql`](../supabase/migrations/20260710135950_reconcile_dflow_baseline.sql)
— a 4,000-line after-the-fact snapshot, wrapped in idempotent `execute $ddl_N$ … $ddl_N$`
guards. It is a reconstruction, not creation history.

Consequence: **model/DDL drift is routine and unpoliced.** Known instances include
`merchGroupHeaders.js` missing `companyCode_id_fk`; `ArtTypes.js` declaring `code` as
`STRING(10)` against a `varchar(255)` column; `divisionCode.js` marking
`external_divisoncode` NOT NULL when the DDL does not; and `itemSize.js` / `SeasonCode.js`
omitting `schema:` entirely.

### 5.4 `public.licensors` / `public.properties` are a different thing entirely

PopDAM's own legacy taxonomy (10 and 500 rows). **No importer, no sync, no feed.**
Hand-maintained inside popdam3, predates shared-db. Unrelated to everything above. Do not
confuse them with `core.licensor` / `core.property`.

---

## 6. How a lapsed license actually disappears — the full answer

This is worth spelling out because it is counter-intuitive and was previously documented
wrongly.

**Coldlion never removes anything and cannot flag anything inactive** (§3.2b). NASA (`NA`),
ZAG (`ZG`) and FRIDA KAHLO (`FK`) are still returned by `/merchGroupDetails` today, looking
completely normal, years after those licenses ended.

**DesignFlow's `merchGroup.is_active` is the only deactivation mechanism in the entire
chain.** It is DesignFlow-owned — the ETL never writes it (`remapMGDetail` does not emit the
key), so it is set by humans/other services in PLM. It is also **not** in the ETL's update
field-whitelist, meaning curated values survive syncs — but only incidentally, because the
mapper happens not to emit the column.

**The filtering happens in `getLicensorsWithProperties`**
(`designflow-item-master/services/item_library.service.js:70-137`), and its logic is
asymmetric in a way that matters:

- **Properties (MG06) are filtered `is_active: true`.**
- **Licensors (MG05) are NOT filtered by `is_active` at all.** They are selected by
  `mg_id IN (parent_ids of active properties)`, then a final
  `.filter(l => l.properties.length)` drops any licensor with no surviving children.

Net effect: **a licensor disappears when its last active property is deactivated**, not when
the licensor itself is flagged. An inactive licensor with one active property still appears.

So the answer to "are NASA/ZAG/FRIDA KAHLO stale in our DB, or filtered by DesignFlow?" —
**DesignFlow is filtering them, correctly, and it is the only layer that could.** Our data
is not stale. The 20-vs-22 gap is the system working as designed.

---

## 7. The division collapse — why 37 becomes 20

Previously documented as a "partial import" caused by API-side filtering. **That is wrong.**
Measured live 2026-07-19:

| | staging rows | distinct codes | `core.*` rows |
|---|---|---|---|
| Licensors | 37 | **20** | **20** |
| Properties | 468 | **256** | **256** |

`plm.licensor_import` holds 20 rows for division `1` and 17 for division `8`. The counts
match distinct codes exactly. **Nothing is being dropped by the API.** `core.licensor`'s
`unique nulls not distinct (code)` deliberately collapses the division dimension, merging
POP Lic and Spruce Lic into one canonical licensor per code.

**Whether that collapse is correct is a genuine open design question.** It is right if a
licensor is a company (Disney is Disney regardless of division). It is wrong if the same
code can mean different things per division — which is exactly the situation for MG05 across
CW001 vs EH001. Today only divisions 1 and 8 reach `core.licensor`, so the collapse is safe;
**it stops being safe the moment division 9 is imported.**

---

## 8. Current live status (2026-07-19)

Two independent outages, neither alerting:

| Symptom | Detail |
|---|---|
| **PLM sync dead 11 days** | Last success in `ingest.sync_run`: **2026-07-08**. `getLicensorsWithProperties` returns **HTTP 502 after ~31s**. 15 runs recorded, **zero non-success rows** — it stopped logging entirely rather than recording a failure. |
| **Coldlion `/items` down** | **HTTP 500 `java.lang.NullPointerException`** on every parameter combination. Server-side. Was working 2026-07-15. All other read endpoints healthy (`/customers`, `/vendors`, `/inventory`, `/merchGroupDetails`, `/merchGroupHeaders`, `/seasons`, `/itemDetails` all 200). |

Also note every historical sync recorded `rows_inserted=560, rows_updated=0` — a daily sync
that has never once recorded an update, suggesting wholesale re-insert rather than
reconciliation.

---

## 9. Known defects

### 9.1 The merch-group header sync only ever fetches EH001

`designflow-data-syncing/models/lib.model.js:847` hard-codes the URL with no division loop
and no pagination:

```js
url: `http://x5.coldlion.com/EhpApi/merchGroupHeaders?companyCode=EDGEHOME&divisionCode=EH001`
```

**The CW001 and SP001 type definitions — the ones where 05=Licensor and 06=Property — are
never ingested.** The dictionary that gives merch groups their meaning is fetched for the
one division where those slots mean something else entirely.

### 9.2 `mgTypeDesc` is ingested and then read by nothing

It exists as a column on `merchGroupHeaders` and is referenced nowhere else in the ETL.
The semantic layer is imported and abandoned; every consumer re-hardcodes the meanings.

### 9.3 The dedup key includes `mg_desc`, so renames create duplicates

`findOrCreate` matches on six columns including `mg_desc`
(`designflow-data-syncing/models/lib.model.js:206-217`). **Renaming a licensor in Coldlion
produces a second row instead of updating the first.** This is the most likely explanation
for `merchGroup` (3,645 rows) vs `merchGroupMaster` (2,017). The stable key would be
`(companyCode, divisionCode, mgTypeCode, mg_code)`.

### 9.4 Picker/validator `is_active` mismatch

`getLicensorsWithProperties` does not filter licensors on `is_active`, but
`requireMerchGroup` (`itemReferenceGuard.js:27`) requires `is_active: true` for the licensor
the user picks. **The picker can offer a licensor that item creation then rejects** with
"The selected Licensor no longer exists or is inactive."

### 9.5 Division filter is one-sided

In `getLicensorsWithProperties`, `divisionCode_id_fk` constrains properties only; parent
licensors are fetched by id with no division predicate. A division-filtered call can return
a licensor from outside the requested division.

### 9.6 `licensingTimeline` looks licensors up by code with no type filter

`designflow-item-master/helpers/licensingTimeline.js:330-334` queries
`where: { mg_code: item.udf_merchgroup05_fk }` with **no `mgTypeCode` and no `is_active`
filter** — so it can match a *property* row that happens to share the code, across any
division. This is §3.2c's collision made real.

### 9.7 Types 11–14 are never synced but items reference them

The ETL's default type list is `01`–`10`, yet items map `merchGroup13`/`merchGroup14`.
Items can point at merch-group codes whose dictionary rows were never pulled.

### 9.8 Silent per-pair error swallowing

The ETL catches errors per `(division, mgType)` pair and only `console.error`s them
(`lib.model.js:909-911`). **A failing type is skipped and the endpoint still returns 200.**

### 9.9 Style Guide options are never populated on item detail

The Style Guide branch in `itemDetail.component.ts:391-400` is entirely commented out, so
`styleGuideOptions` stays empty and the field always renders blank.

### 9.10 Any role — including `vendor` — can create and soft-delete taxonomy

`designflow-backend/routes/admin.router.js:19-77` gates Art Type, Artist Type, Artist and
Age Group CRUD on `['designer','sourcing_manager','vendor','sales','production','admin']`.
**External vendors can create and soft-delete master-data taxonomy rows.** By contrast
`licenseList` writes are correctly restricted to `['admin','sourcing_manager']`. This looks
like an oversight rather than a decision.

### 9.11 `addLicenseList` forges Airbyte lineage on hand-created rows

`designflow-backend/models/lib.model.js:276-289` stamps
`licenseList_airbyte_emitted_at: new Date()` when a user creates a licensor manually,
making an invented row indistinguishable from an ELT-synced one. There is also no uniqueness
check on `licenseList_code` and no DB unique index behind it, so duplicate licensors are
structurally permitted.

### 9.12 `item_character_associations` is a 1:1 wearing a junction table's name

`UNIQUE (item_header_id)` means an item can have **exactly one** character, despite the
plural name and surrogate `id`. Probable design defect.

### 9.13 The `artists` table has no consumer

`art_piece.artist_id` points at `merchGroup(mg_id)` (an MG09 row), **not** at `artists.id`.
The `artists` table is writable through the admin API and read by nothing. Same pattern for
`art_types`, `artist_types`, `age_group` — all duplicate MG07–MG10 semantics while the
ownership doc declares `merchGroup` canonical. `itemSize` likewise duplicates MG04.

### 9.14 Touching `modTime` locally permanently shadows ERP updates

`designflow-backend/services/admin.service.js:537` carries this warning:

```js
//  modTime: format(new Date(), ...) - never enable this else it will break sync for new items
```

`modTime` is the sync's change-detection field. A local write newer than the ERP's value
makes every subsequent ERP update look stale and be skipped forever. Respect it.

### 9.15 `FR` / FRIENDS TV has no Coldlion parent

`core.licensor` carries `FR` = FRIENDS TV (1 property), sourced from
`plm.licensor_import` id `199`, division `1`. **Coldlion has no `FR` licensor in CW001 or
SP001** — there, `FR` is a *property* meaning "1ST ORDER TROOPER". Because the ETL has no
delete or tombstone path, a licensor removed from (or never present in) Coldlion persists in
DesignFlow indefinitely. Either it was created directly in PLM, or it was removed from
Coldlion after an earlier sync. Both are unresolvable from data alone — **it needs a human
decision**, and it is the one licensor in our canonical table with no upstream ERP anchor.

---

## 10. If you are building the direct Coldlion → Supabase sync

The decided plan ("Option B", 2026-07-15) is a Supabase Edge Function + `pg_cron` pulling
Coldlion directly. It does not exist yet. Non-negotiables:

### 10.1 Rules

1. **Never key on `mgTypeCode` alone.** Resolve `(divisionCode, mgTypeCode) → mgTypeDesc`
   via `/merchGroupHeaders` and branch on the *description*. Fetch headers for **all**
   divisions — do not repeat §9.1.
2. **Never key on `mgCode` alone.** The natural key is
   `(companyCode, divisionCode, mgTypeCode, mgCode)`. Do not include `mgDesc` (§9.3).
3. **You cannot get the hierarchy from Coldlion.** Either keep sourcing it from DesignFlow,
   or derive it (§10.2). A direct Coldlion sync alone produces two disconnected flat lists.
4. **You cannot get active/inactive from Coldlion.** `is_active` must keep coming from
   DesignFlow, or become ours to own. If it becomes ours, someone must maintain it — a
   direct sync would otherwise resurrect NASA, ZAG and FRIDA KAHLO.
5. **Decide the division question before importing division 9** (§7).
6. **Fail loudly.** Per house rules, no silent per-pair skips, and the run must record a
   non-success row — the 11-day outage in §8 was invisible precisely because nothing did.

### 10.2 Deriving the hierarchy from item co-occurrence

Every licensed item carries both `merchGroup05` (licensor) and `merchGroup06` (property).
Sweeping `/items` yields the observed licensor→property pairs directly. This is the only
path to reconstructing the hierarchy without DesignFlow.

**Untested as of 2026-07-19** — `/items` is returning 500 (§8), so this could not be
validated. Treat as a promising approach, not a proven one. Caveats: it can only discover
pairs that have at least one item, and it cannot distinguish a genuine relationship from a
data-entry error on a single item.

### 10.3 The actual root-cause bug this all points at

`erp_items_current` stores `licensor_code` / `property_code` as **plain text with no foreign
key into `core.property`**. The taxonomy exists and is correct; the item rows simply are not
joined to it. That disconnect — not a missing or broken taxonomy — is the likely
"the whole system falls apart" symptom. **The fix is a wiring job against tables that
already exist. It is not a taxonomy rebuild and not something to source from Coldlion.**

---

## 11. Reproducing every measurement in this document

```bash
# Coldlion — merch group meanings, all divisions
op run --env-file /tmp/cl.env -- curl -s \
  -H "X-API-Key: $K" \
  "http://x5.coldlion.com/EhpApi/merchGroupHeaders?companyCode=EDGEHOME"

# Coldlion — licensor values for CW001
... "http://x5.coldlion.com/EhpApi/merchGroupDetails?companyCode=EDGEHOME&divisionCode=CW001&mgTypeCode=05"
```

On Windows use the 1Password MCP `op_run` tool with a **native** child process — a bare
`bash` resolves to WSL, which does not inherit injected Windows env, so the key arrives
empty and Coldlion answers `400 Missing request header 'X-API-Key'`:

```
op_run  shell: powershell
        command: 'curl.exe -s -H "X-API-Key: $env:K" "http://x5.coldlion.com/..."'
        env:     { K: "op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential" }
```

Note `cmd.exe` (the default) cannot expand `%%VAR%%` loops outside a batch file — use
`shell: powershell` for any loop over divisions/types.

Supabase checks:

```sql
-- the division collapse (§7)
select (select count(*) from plm.licensor_import)                as lic_rows,
       (select count(distinct mg_code) from plm.licensor_import) as lic_codes,
       (select count(*) from core.licensor)                      as core_lic;

-- sync health (§8)
select source_name, status, started_at, rows_seen, rows_inserted, rows_updated, error
from ingest.sync_run where source_system='designflow_plm'
order by started_at desc limit 10;
```

---

## 12. Related documents

- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — Coldlion endpoint map, auth, paging
- [`coldlion-direct-sync-and-taxonomy-plan.md`](coldlion-direct-sync-and-taxonomy-plan.md) — the Option B plan
- [`coldlion-erp-to-supabase-field-mapping.md`](coldlion-erp-to-supabase-field-mapping.md) — item field mapping
- [`designflow-master-data-migration/README.md`](designflow-master-data-migration/README.md) — PLM migration detail
- [`unified-supabase-schema-map.md`](unified-supabase-schema-map.md) — where every table lives
- [`../fix_schema_for_api.md`](../fix_schema_for_api.md) — the `erp_items_current` relocation plan
