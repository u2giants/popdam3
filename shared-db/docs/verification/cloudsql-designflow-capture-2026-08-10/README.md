# DesignFlow production Cloud SQL — first schema capture, and divergence vs Supabase `dflow`

**Date:** 2026-08-10 · **Captured at:** 2026-08-10 23:29:49 UTC · **Branch:** `docs/cloudsql-designflow-capture`

This is the **first time anyone has read inside the DesignFlow production database.** Every
Cloud SQL to Supabase migration plan in this repo up to today was reasoning from Sequelize models,
a stale 2026-05-07 snapshot, and inference. This document replaces inference with measurement.

---

## 0. What was run, and the safety envelope

| | |
|---|---|
| Instance | `creatiflow-database`, GCP project `lithe-breaker-323913`, PostgreSQL **17.9**, region us-central1 |
| Reached via | public IP, port 5432, `sslmode=require`, authorized-networks allowlist. Connected first try — this machine's egress IP is already allowlisted. |
| Account | `albert_read_only`, `SELECT` only inside `designflow` |
| Database / schema | database `postgres`, schema **`designflow`** (NOT `dflow` — see §1) |
| Script | `scripts/capture-postgres-schema.sql`, unmodified, already reviewed |
| Variables | `target_schema=designflow`, **`exact_count_max_bytes=0`** |
| Duration | 1.3 seconds |
| Exit code | 0, zero errors, zero permission-denied lines |

### Authorisation, stated plainly

`AGENTS.md` §0.1-A normally requires proving a credential is read-only before use. Issue #705
established that `albert_read_only` carries `rolcreatedb`, `rolcreaterole` and `cloudsqlsuperuser`
membership, which failed that gate and stopped the capture earlier today. **Albert ruled twice on
2026-08-10** — first "ignore the 'read only is not read only' issue", then, asked explicitly whether
that permitted using the account to read, **"yes, use it to read production"**. That ruling waived the
gate **for this capture only**. It is not a general waiver, and #705 stays open: the four `REVOKE`
statements in that issue are still the correct fix and still belong to the instance owner.

### Why this run could not have written anything

1. The script contains **no** `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER`/`DROP`/`TRUNCATE`/`GRANT`/
   `COPY`, no temp tables and no `DO` blocks. Confirmed by reading it before running.
2. `scripts/capture-postgres-schema.sql:66` is
   `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;` — **confirmed present before the run.**
   The capture's own §01 output proves it took effect: `default_transaction_read_only | on | session`.
   The *server* would have refused a write, not just the script.
3. `exact_count_max_bytes=0` was passed deliberately. It suppresses **every** `count(*)`, so not one
   table's data pages were read. Section 20's `exact_rows` column is `(null)` on all 103 tables;
   only planner estimates appear. **No production row was touched.**
4. Nothing in GCP was mutated. No replica, no export, no backup restore, no Cloud Build trigger, no
   change to authorized networks, no `gcloud` call at all.

### The raw file

`designflow-capture.txt` (4,006 lines) is committed **raw and unedited**.

**I read it before committing and confirm:** it contains no table rows and no credential values. The
only strings that match a secret-shaped grep are *column and table names* — `auth_token.token`,
`users.passw`, `customers.customers_passw`, `ai_cache_events.prompt_tokens` — names, never values.
`pg_authid` was never queried; §14 lists role attributes only, and no password hash appears.

---

## 1. The single most useful fact: the schema name

| | Cloud SQL production | Supabase production |
|---|---|---|
| DesignFlow schema | **`designflow`** | **`dflow`** |

Five non-system schemas exist on Cloud SQL: `designflow` (542 MB), `designflow_dev` (708 MB),
`designflow_sandbox` (20 MB), `rfq_backoffice13_prod` (4 MB), `public` (824 kB). **`dflow` does not
exist on Cloud SQL at all.** Any past session that queried `dflow.*` there and concluded the box was
empty was wrong for this reason. Total database: 1,294 MB.

**Surprise, recorded for whoever plans the cutover:** the Supabase production project *also* carries a
schema literally named `designflow` (35 relations). It is **not** the Cloud SQL production schema and
must not be confused with it. Supabase has 21 non-system schemas including both `dflow` and
`designflow`. Somebody should establish what that 35-relation `designflow` schema on Supabase is for
before cutover naming decisions get made.

---

## 2. Headline divergence numbers

Comparing `designflow` (Cloud SQL production) against `dflow` (Supabase production, read live via the
Management API query endpoint, pure `pg_catalog` SELECTs, 2026-08-10).

| Object | Cloud SQL `designflow` | Supabase `dflow` | Difference |
|---|---:|---:|---|
| Tables | **103** | **108** | +5 on Supabase |
| Views | **0** | **5** | +5 on Supabase |
| Materialized views | 0 | 0 | none |
| Functions / procedures | **2** | **6** | +4 on Supabase |
| Triggers | **0** | **3** | +3 on Supabase |
| RLS policies | **0** | **0** | none |
| Constraints | 171 | 242 | +71 on Supabase |
| Indexes | 186 | 213 | +27 on Supabase |
| Sequences | 97 | — | — |
| Tables on Cloud SQL only | — | — | **ZERO** |

### The corrected divergence count that #707 asked for

Issue #707 (owner ruling) says the Sample Tracking block is **absent from Cloud SQL deliberately** and
is not drift. Attributing every difference to Sample Tracking or not:

| | Sample Tracking (excluded per #707) | Genuine divergence |
|---|---:|---:|
| Tables Supabase-only | 5 | **0** |
| Views Supabase-only | 5 | **0** |
| Functions Supabase-only | 4 | **0** |
| Triggers Supabase-only | 3 | **0** |
| Columns Supabase-only | 4 | **0** |
| Constraints Supabase-only | 5 | **1** |
| Indexes Supabase-only | 8 | **2** |
| Indexes Cloud SQL-only | 3 (renamed equivalents) | **0** |

> ### **Corrected divergence count: 3.**
> Excluding Sample Tracking, the entire structural difference between DesignFlow production on
> Cloud SQL and the `dflow` schema on Supabase is **one unique constraint and two indexes.**
> The estimate circulating before today was 18 migrations. The measured, Sample-Tracking-excluded
> answer is three objects.

**This is the good news of the whole capture.** The two schemas are not drifting apart. They are
essentially the same 103 tables, table-for-table, with one testing feature deliberately living only
on the destination platform.

---

## 3. The three genuine divergences, in full

All three are **present on Supabase, absent on Cloud SQL**, and all three are performance or
data-integrity additions rather than feature schema.

| # | Object | Kind | Table |
|---|---|---|---|
| 1 | `productUserAssignment_item_role_key` | UNIQUE constraint | `productUserAssignment` |
| 2 | `idx_dflow_rfqitem_style_number_normalized` | index | `RFQItem` |
| 3 | `RFQVendor_item_vendor_summary_idx` | index | `RFQVendor` |

**What this means in practice.** DesignFlow production is missing a uniqueness guarantee on
`productUserAssignment (item, role)` that sandbox/staging has, and is missing two query indexes that
sandbox/staging has. Nothing here breaks production today. The unique constraint is the one worth a
second look: if production data contains duplicate `(item, role)` pairs, that constraint will fail to
apply during any lift-and-shift and must be reconciled first. **The capture cannot tell you whether
duplicates exist — it holds no row data.** That is a `count(*)` question for a separate, authorised read.

---

## 4. The Sample Tracking block, itemised (NOT drift — do not reconcile)

Per **OWNER RULING #707**: *"Sample Tracking doesn't exist in Cloud SQL. It is a feature in testing and
I didn't want to go through all the trouble building it on Cloud SQL only to move it."* Listed here for
completeness so nobody re-discovers it as a defect.

**Important nuance the earlier assessment missed:** the base `sample`, `sample_box`,
`sample_shipment_item`, `sample_attachment`, `sample_event` and `sample_comments` tables **do exist on
Cloud SQL.** What is absent is the *movement/ledger layer* built on top of them.

- **Tables (5, Supabase only):** `sample_import_job`, `sample_import_row`, `sample_movement`,
  `sample_shipment_line`, `sample_stop_closeout`
- **Views (5, Supabase only — all of them):** `sample_balance_by_location`, `sample_global_status`,
  `sample_in_transit`, `sample_open_stop_work`, `sample_receipt_discrepancy`
- **Functions (4, Supabase only):** `post_sample_movement(...)`, `reject_sample_movement_mutation()`,
  `sample_movement_auto_office_inventory()`, `sample_movement_guard()`
- **Triggers (3, Supabase only — all of them):** `sample_movement_auto_office_inventory_trigger`,
  `sample_movement_guard_trigger`, `sample_movement_immutable_trigger`
- **Columns (4, Supabase only):** `sample.quantity_migration_state`, `sample_box.owner_factory_id_fk`,
  `sample_box.ownership_state`, `sample_shipment_item.quantity_intended`
- **Constraints (5, Supabase only):** `sample_quantity_migration_state_check`,
  `sample_box_owner_factory_fkey`, `sample_box_ownership_state_check`,
  `sample_shipment_item_quantity_positive`, `sample_shipment_item_sample_box_uniq`
- **Indexes (8, Supabase only):** `sample_quantity_migration_state_idx`, `sample_box_owner_factory_idx`,
  `sample_shipment_item_sample_box_uniq`, `sample_shipment_item_box_id_fk_idx`,
  `sample_shipment_item_sample_id_fk_idx`, `sample_attachment_sample_id_fk_idx`,
  `sample_event_sample_id_fk_idx`, `sample_box_id_fk_idx`

### Cosmetic-only: three renamed indexes

Not drift, not Sample Tracking — the **same three indexes** exist on both sides under different names.
Recorded so a naive name-based diff does not report them as missing:

| Cloud SQL name | Supabase name | Table / column |
|---|---|---|
| `idx_sample_attachment_sample_id_fk` | `sample_attachment_sample_id_fk_idx` | `sample_attachment.sample_id_fk` |
| `idx_sample_event_sample_id_fk` | `sample_event_sample_id_fk_idx` | `sample_event.sample_id_fk` |
| `idx_sample_box_id_fk` | `sample_box_id_fk_idx` | `sample.box_id_fk` |

One constraint is Cloud SQL-only: `sample_comments_user_id_fkey` (FK on `sample_comments.user_id`).
Supabase's `sample_comments` has no such FK. Minor, and inside the sample family.

---

## 5. Issue #696 — settled as fact

> **The `office_location` and `preferred_language` columns from migration `20260810160000` are
> NOT present on Cloud SQL production.**

Evidence — `designflow-capture.txt` §05 lines 1857–1877. `designflow.users` has exactly **21 columns**:
`id, name, email, level, notes, passw, expire, status, adddate, auditlog, lastname, phonenum,
subscription, subleveladmin, notificationsms, notificationemail, _airbyte_emitted_at,
_airbyte_users_hashid, profile_photo, graph_photo, graph_photo_synced_at`.

Neither `office_location` nor `preferred_language` appears. `designflow.users` carries exactly one
constraint (`users_pkey`) — so `users_office_location_check` and `users_preferred_language_check` are
absent too. This is no longer an assumption. It is measured.

### The surprise inside #696

**Those columns are not on Supabase production either.** `dflow.users` on project
`qsllyeztdwjgirsysgai` has the *same 21 columns* and neither new one. The highest applied migration
version in `supabase_migrations.schema_migrations` is **`20260810140000`** — and
`20260810160000_dflow_users_office_location_preferred_language.sql` is merged to `main` but **has not
been applied to production**. (`20260810170000` and `20260810180000` are unapplied too.)

So #696 as written — "shared-db reaches sandbox, Cloud SQL never gets it" — describes a real
structural gap, but today the feature has reached *neither* production database. Whoever picks up #696
needs to apply the migration to Supabase production **and** hand the Cloud SQL DDL to Uma. Fixing only
the Cloud SQL half would leave PopDAM/PLM production still missing the columns.

---

## 6. What the capture CANNOT tell you

State this plainly wherever these numbers get quoted.

- **It proves schema, not content.** `exact_count_max_bytes=0` skipped every `count(*)` by design.
  Every figure in §20 of the raw file is a **planner estimate**, and planner estimates go stale. `-1`
  means "never analysed", not "empty". `AuditLog` shows ~554,592 estimated rows; `art_piece` ~1,368.
  Treat both as order-of-magnitude only.
- **It cannot tell you whether the data matches.** Two schemas can be structurally identical and hold
  completely different rows. `dflow` on Supabase is DesignFlow's **develop/staging/sandbox** data and
  is *not* a mirror of production. Row-level differences there are expected and are not drift.
- **It cannot answer any "how many rows" question** — orphan counts, duplicate `(item, role)` pairs,
  `modUser` distributions, `age_group` row equality. Those all need a separate authorised read.
- **It only saw `designflow`.** `designflow_dev`, `designflow_sandbox` and `rfq_backoffice13_prod`
  were sized but not inspected; the credential holds no `USAGE` on them.
- **It says nothing about application behaviour.** Sequelize builds associations at boot from
  `UDFTable` rows (see §7); the catalog cannot show you what the app does with them.
- **It is a point-in-time snapshot** taken 2026-08-10 23:29 UTC.

---

## 7. What this closes in the three stalled plans

**Do not edit those documents from this branch.** This section states only what is now answerable.

### `docs/cloudsql-first-migration-candidate-20260803.md`

| Line(s) | Open question | Now answerable? |
|---|---|---|
| **:20-23** | "The artwork table has an `age_group_id` column … the database has **no enforced link** between the two … moving the list cannot break a database rule, because there is no rule to break." | **CLOSED — and the plan is WRONG.** The table is `art_piece`, and `art_piece.age_group_id` carries a **real, validated foreign key**: `art_piece_age_group_id_fkey FOREIGN KEY (age_group_id) REFERENCES designflow."merchGroup"(mg_id)`. There *is* a rule, it is enforced, and it points at **`merchGroup`, not `age_group`** — which independently confirms the plan's own §8 suspicion that those ids are merch-group ids. The stated central justification for age_group being the safest first move does not survive contact with production. |
| **:24-26** | "Nobody edits it … no screen in DesignFlow" | **Not answerable.** Application behaviour, not catalog. Unchanged. |
| **:27-29** | "A perfect copy is already sitting in Supabase … two rows character-for-character identical" | **Not answerable — and now unverifiable from here.** `designflow.age_group` exists (7 columns: `id, name, is_active, created_at, created_by, updated_at, updated_by`, 56 kB) but the row count is `-1` (never analysed). Row equality needs the separate read the plan calls Step D1. |
| **:207** | "true blast radius is unknown without reading `UDFTable` rows in the live database" | **Half closed.** `designflow.UDFTable` **exists** (32 kB, 11 columns of association metadata) so the mechanism is real and the question is well-posed. Its *rows* were deliberately not read. |
| **:148-157** | The "FK-blocked" column for `SeasonCode`, `companyCode`, `itemType` | **Now checkable.** Section 06 of the capture lists all 171 constraints with `pg_get_constraintdef` text; every FK claim in that table can be verified or refuted against it without another connection. |

### `docs/age-group-cloudsql-migration-plan-20260804.md`

| Line(s) | Open question | Now answerable? |
|---|---|---|
| **:295-296** | "Prove the credential is read-only before use" | **Superseded by owner ruling.** See §0 above. The gate was waived for this capture; #705 remains open for the instance owner. |
| **:192-193 (Step D1)** | "Read the real production `age_group` rows … confirm they match `core.age_group` exactly" | **Still open — deliberately.** The table exists; its rows were not read. This is a `select *` on a 2-row table, trivially cheap, and needs one authorised read. |
| **:196-200 (Step D2)** | "Read the production `art_piece.age_group_id` distribution … **expect this to fail**, because those ids appear to be merch-group ids" | **Effectively closed — the expectation was right.** The FK at §7 above proves `age_group_id` references `merchGroup(mg_id)`, not `age_group(id)`. The plan's own words: "that is not a blocker on the pointer move; it is the discovery that the column was never really an `age_group` reference." That discovery is now made. **Record it and re-plan**, exactly as the plan instructs. |
| **:275** | "You cannot measure a change against an unknown baseline" | **Closed for schema.** This file is that baseline. Still open for row data. |
| **:289 — §5.3 "DEPENDENCY, NOT YET SATISFIED — read access to production DesignFlow Cloud SQL"** | The whole dependency | **CLOSED.** Read access obtained, used, and evidenced. The heading is stale. |

### `docs/licensor-property-cloudsql-cutover-plan-20260806.md`

| Line(s) | Open question | Now answerable? |
|---|---|---|
| **:435-441 (Track 3B, Q1)** | "`pg_trigger` / `pg_proc` for anything inside the database writing `parent_id`" | **CLOSED, definitively.** The `designflow` schema has **ZERO triggers** (§11 of the capture is empty) and exactly **two functions**, `get_parent_id(...)` and `get_child_id(...)` — both `plpgsql`, both `SECURITY INVOKER`, and both pure `SELECT` lookups that *return* an id and write nothing. **Nothing inside the database writes `parent_id`.** By the plan's own decision rule, this points at application code or human SQL as the author of the 503 parent edges. |
| **:435-441 (Track 3B, Q2)** | "live counts plus `modUser` distribution" | **Still open.** Row data. `merchGroup` is 912 kB, `merchGroupMaster` 360 kB, `merchGroupRelations` 408 kB — all cheap to count when authorised. |
| **:738 (row 3 of §9)** | "Whether DesignFlow's real database has any FK, unique or cascade on `merchGroup.parent_id` beyond the Sequelize model" | **CLOSED.** `merchGroup` has **exactly one constraint: `merchGroup_pkey` (PRIMARY KEY (mg_id))** and **exactly one index**, that primary key. `merchGroup.parent_id` (integer, column 23) has **no FK, no unique, no cascade, no index — nothing.** It is a bare integer column. The Sequelize model is the only thing enforcing anything. **However**, `merchGroupRelations` — a different table the plan barely discusses — is heavily constrained: three cascading FKs to `merchGroupMaster`, a `CHECK (parent_mg_id <> child_mg_id)`, and two partial unique indexes (`uniq_grand_parent_parent_child`, and `uniq_parent_child_no_grand` `WHERE grand_parent_mg_id IS NULL`). Anyone planning the parenting cutover needs to look there, not only at `merchGroup.parent_id`. |
| **:736 (row 1 of §9)** | "The live count of unparented and inactive `mgTypeCode='06'` merch groups" (the stale 111/51 figures) | **Still open.** Row data. Connection proven to work; this is now a five-minute job for an authorised read. |
| **:739 (row 4)** | "How many properties (not products) are the 9 wrong parents" | **Still open.** Row data. |
| **:741 (row 6)** | "What each application actually breaks on" | **Not answerable — and never was.** The plan already says it "needs a person reading four repositories, not a query". Unchanged. |

---

## 8. Things that surprised me

1. **The two schemas are far closer than anyone believed.** Zero Cloud SQL-only tables. Three genuine
   divergent objects, not eighteen migrations' worth.
2. **`art_piece.age_group_id` has an enforced FK — pointing at `merchGroup`, not `age_group`.** This
   contradicts the stated foundation of the age_group-first plan.
3. **Zero triggers and zero RLS policies in the whole production schema**, and only two trivial
   read-only functions. Almost all business logic lives in the application. That materially simplifies
   a lift-and-shift and settles Track 3B's Q1 on the spot.
4. **Migration `20260810160000` has not reached Supabase production either** — #696 is bigger than it
   looks.
5. **A schema named `designflow` also exists on Supabase production** (35 relations), distinct from
   Cloud SQL's. A naming collision waiting to confuse a cutover.
6. **`merchGroup.parent_id` is completely unconstrained** — no FK, no index, nothing — while
   `merchGroupRelations` next door is rigorously constrained.
7. **The connection worked first try.** No allowlist change was needed or made.
8. **`AuditLog` is 400 MB of the schema's 542 MB.** Roughly three-quarters of DesignFlow production by
   size is audit log. Worth a conversation before anyone plans a full data copy.

---

## 9. What was NOT done

No write of any kind against Cloud SQL. No mutation anywhere in `lithe-breaker-323913` — no replica,
no export, no backup restore, no Cloud Build trigger touched, no authorized-network change, no
`gcloud` call. No mutating statement against Supabase; the Supabase side is pure `pg_catalog` SELECTs
through the Management API query endpoint with an explicit non-default User-Agent. The Supabase MCP
was not used. No row data was read from either database. No credential value appears in any file,
commit or comment. The three plan documents in §7 were not edited. `AGENTS.md` was not edited.
