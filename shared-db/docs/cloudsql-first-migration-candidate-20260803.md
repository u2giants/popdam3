# First table to move from Cloud SQL to Supabase — recommendation

**Date:** 2026-08-03
**Question asked (verbatim):** "what is the easiest / least disruptive table to move from Cloud SQL to supabase.com?"
**Status:** Analysis and recommendation only. Nothing was moved, no migration was authored, no database was written to.
**Databases read:** Supabase production `qsllyeztdwjgirsysgai` (proved by `get_project_url` →
`https://qsllyeztdwjgirsysgai.supabase.co` before every read). DesignFlow's production Cloud SQL
database was **not** reachable from this session — see "What only a Cloud SQL query can settle".

---

## 1. Plain-English recommendation

### The one table: **`age_group`** (the Adult / Juvenile list)

**What it is.** A two-row list — "Adult" and "Juvenile" — that DesignFlow uses to tag artwork.
That is the whole table. It has been unchanged since the day it was created in June 2025.

**Why it is the easy one.**

1. **Nothing depends on it in a way that can break.** The artwork table has an `age_group_id`
   column and 974 of its 981 rows use it, so the list is genuinely in use — but the database has
   **no enforced link** between the two. That means moving the list cannot break a database rule,
   because there is no rule to break.
2. **Nobody edits it.** There is no screen in DesignFlow where a user can add, rename, or delete
   an age group. The back-end has the plumbing for it, but the front-end never calls it. In over a
   year, nobody has.
3. **A perfect copy is already sitting in Supabase.** `core.age_group` already exists and its two
   rows are character-for-character identical to DesignFlow's — same names, same dates, same
   author. There is no data to reconcile, clean, or match up.
4. **It is not fed by ColdLion.** No sync job touches it, so moving it does not disturb any
   pipeline and does not have to wait for the broken master-data sync to be fixed.
5. **It is two rows.** If something did go wrong, the entire contents fit in one sentence.

**What would change for people using the applications.** Nothing visible. The Adult/Juvenile
dropdown in DesignFlow would look and behave exactly the same. Poppim, PopCRM and PopDAM are not
affected at all — they do not touch this table today.

**What could go wrong.** The realistic risk is a mismatch in the internal ID numbers. Today
"Adult" is 1 and "Juvenile" is 2 in both places, so this is already fine — but it must be
confirmed against the **production** Cloud SQL copy, not just the copy we can see. If production
happened to have extra rows or different numbering, artwork would show the wrong age group. That
is checkable in advance and is the single gate on this move.

**How hard is it to undo.** Trivially easy. The old table is not deleted as part of the move — it
is left in place and simply stops being read. Reversing means pointing one setting back. There is
no data loss path, because no new data is created in the meantime (nobody edits this list).

**How long.** This is a small piece of work: confirm the production rows match, point DesignFlow's
artwork screens at `core.age_group`, deploy to sandbox, check the dropdown, promote. It can be
done with no downtime — the read simply switches over on the next deploy.

**Why it is the right *first* domino and not a dead end.** Albert's R5 ruling says `core.*` in
Supabase becomes the source of truth for every application and the `dflow.*` tables get retired.
This move performs that exact manoeuvre — read from `core.*`, retire the `dflow.*` copy — end to
end, on the least dangerous table in the system. It establishes the pattern, the deployment
sequence, and the rollback drill, so that the second and third tables are a repeat of a proven
procedure rather than a first attempt. It is a rehearsal with real stakes but a tiny blast radius.

### Second choice: **`artist_types`**

Also two rows ("Internal Artists", "Freelancers"), also already identical in `core.artist_types`.
Slightly harder for two reasons: the artwork/artist table has a **real enforced database link** to
it, and DesignFlow **does** have an admin screen where a user can add or rename artist types — so
the switchover has to handle someone editing it mid-flight. Good as move number two, because it
adds exactly one new difficulty (a live editing screen) on top of a pattern already proven.

### Third choice: **`product_category`**

Seven rows, a `core.product_category` table already exists — but it is **empty**, so unlike the
first two this one needs an actual data load and a check that nothing was lost. It also has a
parent/child structure and a child table hanging off it. Still small, but it is the first one
where the move involves moving data rather than just moving a pointer.

### Deliberately ruled out

- **`ShippingPort` and `ProdPaymentTerms`** — technically the easiest possible move (zero rows,
  zero code references, completely dead). **Rejected**: moving dead tables proves nothing and
  advances R5 not one inch. If anything they should be deleted, not migrated.
- **`merchGroup` / licensor / property** — tempting because they are the ColdLion-fed heart of the
  business, but they are the hub everything hangs off, three live applications depend on them, and
  the DesignFlow master-data sync that feeds them has been dead since 2026-07-08. Not a first
  domino; a later, carefully staged one.
- **`itemSize`, `itemDepth`, `deliveryLocation`, `RFQItemStatus`** — all have live admin screens,
  are loaded by an external Airbyte pipeline, and are wired into DesignFlow's *dynamic* table-
  linking mechanism (see §3), which makes their true dependencies invisible to code inspection.
- **`divisionCode`, `companyCode`** — no writers, but multiple enforced links point at them from
  artwork, art types and artists. Cheap-looking, entangled in practice.
- **`licensingStatus`** — 13,089 rows and heavy transactional traffic. Not a candidate.

---

## 2. Important correction to the framing

The brief stated "DesignFlow PLM runs on Google Cloud SQL, NOT Supabase." That is **true only for
production**. Verified in the connection contract that all four database-owning DesignFlow
services carry verbatim:

`C:\repos\dflow\designflow-backend\config\database-connection-contract.js`

```
:78  if (metadata.provider !== 'cloud-sql') throw new Error('Production DB_PROVIDER must be cloud-sql');
:82  if (!['private-ip', 'cloud-sql-socket'].includes(hostClass)) { throw new Error('Production DB_HOST must be a private Cloud SQL address or socket'); }
:87  if (metadata.provider !== 'supabase') throw new Error(`${environment} DB_PROVIDER must be supabase`);
:88  if (values.PORT !== '6543') throw new Error(`${environment} Supabase pooler must use DB_PORT 6543`);
```

So: **production = Cloud SQL Postgres (private VPC). `develop` / `staging` / `sandbox-albert` /
`albert-2sandbox` = Supabase pooler on port 6543.**

This materially changes the shape of the answer, in the migration's favour:

- The `dflow` schema in Supabase is **not a dead mirror** — it is DesignFlow's live non-production
  database. There is therefore already a working, exercised path for DesignFlow code to run
  against Supabase. The migration is not "can it work?", it is "flip production".
- It also means the earlier `dflow.merchGroup` frozen-snapshot observation is explained: the
  `dflow` schema is a *sandbox environment*, not a sync target. `ingest.sync_run` confirms this —
  it contains only three sources and **none** of them targets any `dflow.*` lookup table:

| source_system | source_name | status | runs | last_run |
|---|---|---|---|---|
| coldlion | coldlion_vendors_api | succeeded | 8 | 2026-07-22 19:10:49 |
| coldlion | coldlion_customers_api | succeeded | 3 | 2026-07-17 12:20:42 |
| designflow_plm | plm_master_data_api | succeeded | 15 | **2026-07-08 03:30:19** (dead, silent) |

Which services share that database: `designflow-backend`, `designflow-item-master`,
`designflow-tracking`, `designflow-data-syncing`. `designflow-bff` has **no** database access (no
`models/` directory, no `sequelize` dependency in its `package.json`) — it is an HTTP proxy.
`designflow-frontend` is Angular, no database.

---

## 3. Evidence table — every candidate considered

Row counts are from Supabase production project `qsllyeztdwjgirsysgai` (i.e. the `dflow` schema =
DesignFlow's sandbox data; the `core` schema = the shared production data).

| Table | Rows (dflow) | Rows (core) | App write paths | Admin UI | Inbound FKs | Outbound FKs | ColdLion-fed | Verdict |
|---|---|---|---|---|---|---|---|---|
| **age_group** | 2 | **2, identical** | API exists, **UI never calls it** | **none** | **none** (soft `art_piece.age_group_id`, unenforced) | `app.users` (audit) | no | **RECOMMENDED** |
| **artist_types** | 2 | **2, identical** | create + 2 updates | **yes** | `designflow.artists` (enforced) | `app.users` | no | 2nd choice |
| **product_category** | 7 | **0 (empty)** | none | none | `core.product_type`, self-parent | `app.users` | no | 3rd choice |
| art_types | 2 | 2 | create + 2 updates | yes | none | `plm."divisionCode"`, `app.users` | no | entangled outbound |
| ShippingPort | **0** | — | **zero** | none | none | none | no | dead — delete, don't migrate |
| ProdPaymentTerms | **0** | — | **zero** | none | none | none | no | dead — delete, don't migrate |
| licensingMilestone | — | — | zero | none | `itemHeader.hasMany` (code) | — | no | plausible, but zero value |
| OrderLeadTime | — | — | **no model at all** | none | none | none | no | orphan; investigate/drop |
| SeasonCode | 8 | — | zero | read-only | `dflow.art_piece` (enforced) | — | no | FK-blocked |
| companyCode | 5 | — | zero | none | `art_piece_attachment` | — | no | FK-blocked |
| divisionCode | 5 | — | zero | none | `art_piece`, `art_piece_attachment`, `art_types`, `artists` | — | no | hub |
| FOBCountry | 11 | — | create + update | **yes** | none | none | no | live editing, no core home |
| RFQWhse | 1 | — | update (singleton) | none | none | none | no | price singleton, odd |
| RFQItemStatus | 3 | — | zero | read-only | dynamic (UDFTable) | — | Airbyte | dynamic-assoc risk |
| deliveryLocation | 19 | — | create + update | yes | dynamic (UDFTable) | — | Airbyte | dynamic-assoc risk |
| itemDepth | 121 | — | create + destroy | yes | dynamic (UDFTable) | — | Airbyte | dynamic-assoc risk |
| itemSize | 495 | — | create + destroy + 2 updates | yes | dynamic (UDFTable) | — | Airbyte | dynamic-assoc risk |
| itemType | 1 | — | create | yes | `itemHeader` (enforced) | — | no | FK-blocked |
| licensingStatus | **13,089** | — | create ×2, destroy | n/a | many both ways | many | no | transactional hub |
| merchGroup | 3,645 | `core.merch_group` = 0 | (sync) | via DB Data Admin | `plm.item`, self-parent | — | **yes** | later, staged |

### Key supporting evidence

**`age_group` — the recommendation.**

- Model: `C:\repos\dflow\designflow-backend\models\db\AgeGroup.js:4` `sequelize.define(...)`,
  `:54` `tableName: 'age_group',`. Duplicated at `designflow-item-master\models\db\AgeGroup.js:4/:54`.
- Back-end write endpoints exist but are unreferenced by the UI:
  `designflow-backend\services\admin.service.js:420` `const newAgeGroup = await sql.AgeGroup.create({`,
  plus `ageGroup.save()` at `:449` and `:472`.
- Front-end is **read-only**: the only client method is
  `designflow-frontend\src\app\helpers\services\admin.service.ts:157 getAgeGroups()`. No
  create/update/delete method exists in the Angular service, and there is no
  `pages\editor\age-group` component (the editor folder contains `fob-country`,
  `delivery-location`, `item-size-aggrid`, `item-depth-aggrid`, `license-list`, `merch-group-dialog`
  and others — but no age group screen).
- No enforced inbound FK. The full FK sweep over `pg_constraint` for the candidate set returned,
  for `age_group`, only `age_group_created_by_fkey` and `age_group_updated_by_fkey` — both
  outbound to a users table. `dflow.art_piece.age_group_id` and `designflow.art_piece.age_group_id`
  exist as columns but appear in **no** foreign-key constraint.
- Usage is real, not dead: `dflow.art_piece` 981 rows / 974 with `age_group_id` set;
  `designflow.art_piece` 1,114 rows / 1,106 set.
- `core.age_group` contents (queried) are identical to `dflow.age_group`: id 1 "Adult", id 2
  "Juvenile", both `is_active: true`, both `created_at 2025-06-20T00:54:09.187493-04:00`,
  `created_by: 34`, `updated_at: null`.
- `core.age_group`'s own FKs point at `app.users(id)` — i.e. the Supabase-side audit columns are
  already correctly re-parented to the shared user table, not to `dflow.users`. This is the one
  piece of migration work that is normally fiddly, and it is **already done**.

**Why `artist_types` is second, not first.**
`core.artist_types` already has a live enforced dependant: `designflow.artists` →
`artists_artist_type_id_fkey`. That is a point in favour of `core.artist_types` being real and
trusted, but it means the cutover has an enforced constraint to respect. It also has a working
admin screen: `designflow-frontend\src\app\helpers\services\admin.service.ts:72,80,88`
(`createArtistType`/`updateArtistType`/`deleteArtistType`), backed by
`designflow-backend\services\admin.service.js:177` `const newArtistType = await sql.ArtistTypes.create({`.

**Why `art_types` is not in the top three despite looking identical.**
`core.art_types` carries `art_types_divisioncode_id_fkey → plm."divisionCode"("divCode_id")`. Moving
it drags a second table's identity into scope.

**The dynamic-association trap (rules out four otherwise-small tables).**
`C:\repos\dflow\designflow-backend\models\db\init-models.js:99-130` builds Sequelize associations
**at boot from rows in the `UDFTable` metadata table** — `:119` calls
`models[...][jointTables[i].UDFTable_associate_type](models[...], { foreignKey: ... })`. This is how
`RFQItemStatus`, `deliveryLocation`, `itemDepth` acquire the aliases used in `rfqListQuery.js`.
**Static code search cannot prove those tables are unassociated**, so their true blast radius is
unknown without reading `UDFTable` rows in the live database. `age_group` is not in this mechanism.

**Airbyte ownership signal.** Several lookup tables carry replication columns proving an external
pipeline loads them, e.g. `designflow-data-syncing\models\db\itemSize.js:27` `itemSize_airbyte_emitted_at`
and `:31` `itemSize_airbyte_sizes_hashid`; same shape on `deliveryLocation.js:27,31`,
`itemDepth.js:27,31`, `RFQItemStatus.js:31`. `age_group`, `artist_types`, `art_types`,
`product_category`, `ShippingPort`, `ProdPaymentTerms`, `companyCode`, `divisionCode` and `RFQWhse`
have **no** Airbyte columns.

**No ColdLion involvement in any candidate.** `designflow-data-syncing` has **zero** write
operations against any candidate table (write-op regex over the whole repo: no matches). Its
apparent references are ColdLion payload field names, not tables — e.g.
`designflow-data-syncing\helpers\utility.js:58` `const divCode = DIVISION_CODE_MAP[item.divisionCode];`
and `:86` `"compan_code_fk": item.companyCode === 'EDGEHOME' ? 1 : 2,`.

---

## 4. What only a Cloud SQL query can settle

> **UPDATE 2026-08-10.** Owner ruling `AGENTS.md` §0.1-A now permits read-only queries against
> production Cloud SQL from this repo, so the questions below are answerable. The production
> **secrets** are still off-limits — §0.1 is unchanged. Use the read-only credential from
> 1Password vault `vibe_coding`, prove it read-only first, and never report row contents.

Production DesignFlow secrets are off-limits per `AGENTS.md` §0.1 and were not requested. Every
row count above is from Supabase — i.e. from DesignFlow's **sandbox** data, not production. The
following are **NOT VERIFIED** and must be closed before any move:

1. **The production `age_group` rows.** Are they exactly `1 = Adult`, `2 = Juvenile`, matching
   `core.age_group`? This is the single gate on the recommendation.
   *Closes with:* `SELECT * FROM "<prod_schema>".age_group ORDER BY id;` on production Cloud SQL.
2. **The production `art_piece.age_group_id` distribution.** Do any production rows reference an id
   that does not exist in `core.age_group`?
   *Closes with:* `SELECT age_group_id, count(*) FROM "<prod_schema>".art_piece GROUP BY 1;`
3. **Whether production has a foreign key on `art_piece.age_group_id`** that the sandbox lacks.
   Sandbox has none; production schema drift is possible.
   *Closes with:* a `pg_constraint` sweep on production.
4. **`UDFTable` rows in production** (`container_id = 'rfq'`), which define the dynamic
   associations. Needed to properly rule in/out `itemSize`, `itemDepth`, `deliveryLocation` and
   `RFQItemStatus` — not needed for the `age_group` recommendation.
5. **Whether anything outside the six DesignFlow repos writes these tables** — e.g. the Airbyte
   pipeline's own configuration, or `OrderLeadTime`, which has no Sequelize model anywhere yet
   exists as a table. *Closes with:* Airbyte connection config plus a production write-audit.
6. **Production row counts generally.** Sandbox counts (e.g. `itemType` = 1 row) are implausible as
   production values and should not be used for sizing.

---

## 5. Suggested sequence (not authored, not executed)

1. Close gate 1 and 2 above against production Cloud SQL.
2. Point DesignFlow's artwork read path at `core.age_group` behind the existing environment
   configuration; deploy to `sandbox-albert`, which already runs on Supabase.
3. Visually verify the Adult/Juvenile dropdown and the artwork grid.
4. Promote. Leave `dflow.age_group` in place, unread, for one release as the rollback.
5. Only then repeat with `artist_types`, adding the admin-screen handling.
6. Separately, propose **deleting** `ShippingPort`, `ProdPaymentTerms` and `OrderLeadTime` rather
   than migrating them.
