# Implementation plan — normalize the repeated metadata-element headings in `plm.pmt_asset_metadata_value`

**Written:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Revised:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** grok-4.6
**Revision source:** Grok 4.6 review session `pmt-metadata-element-normalization` (session
`01a000d1-2173-7821-a968-293e348f3fe6`) · **Verdict:** REVISE
**Repo:** `u2giants/shared-db` · **Target branch:** a new branch off `main`, PR to `main`
**Issues:** implementation #965 · orchestrator #960
**Handoff that owns this plan:** [HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md](HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md)
**Sibling plans:** [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md) ·
[plan_pmt-duplicate-name-columns.md](plan_pmt-duplicate-name-columns.md)

**This revision does not author migrations.** Production promotion is not authorized.

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Serialization gate: wait for the duplicate-name plan’s first `plm.load_pmt_capture_chunk` rewrite | ✅ complete | 2026-08-14: #964 merged as PR #981, merge commit `b13b331`; this branch starts from that commit. |
| 1 | Measure headings and `data_type` with NULL-aware queries; record loader shape | ✅ complete | 2026-08-14 production read-only evidence, target proved immediately before each query by `supabase/.temp/project-ref = qsllyeztdwjgirsysgai`: 565,474 value rows; all six heading columns have 0 non-NULL rows and 0 NULL-aware disagreement groups; 21 distinct `(capture_id, metadata_element_id)` pairs across three captures with values (7 each; capture value-row counts 150,430 / 207,522 / 207,522); 0 element groups mix non-NULL `data_type` values. Current production `plm.load_pmt_capture_chunk` still writes the six headings and preserves its fixed allow-list-before-empty guard. Catalog readers: that loader only; no view. Repo readers outside migrations: this plan, loader, loader tests, and the new contract test only; zero readers in `poppim-web`, `popcrm-web`, or `popdam3`. Counts and object names only; no licensed values read or recorded. |
| 2 | Migration A — create `plm.pmt_metadata_element` with the full Paramount security contract, freeze trigger, and NULL-aware backfill | ✅ complete | Migration `20260814213043_pmt_metadata_element_normalization.sql`; exact-head ephemeral database test passed. |
| 3 | Migration B — second `plm.load_pmt_capture_chunk` rewrite plus client `LOAD_ORDER` (after Step 0) | ✅ complete | Migration and `tools/sync-paramount-creative-library.mjs`; #964 omissions retained; 67/67 loader tests passed. |
| 4 | Tests in `supabase/tests/` and the Paramount loader test file | ✅ complete | SQL contracts, privilege contracts, and loader contracts pass on PR #1006 exact head. |
| 5 | Migration C — FK from value rows to the element table, only after the loader writes the parent | ✅ complete | Migration creates/backfills the parent before validating the value-row foreign key. |
| 6 | Preview rehearsal: a real capture reaches `complete` after the FK exists | ⬜ open | — |
| 7 | Migration D — deprecate the six heading columns (not `data_type`) | ✅ complete | Migration stops writing the six headings, removes their obsolete checks, and retains per-value `data_type`. |
| 8 | Migration E — drop the six heading columns, only after a proven preview capture | ⬜ open | — |
| 9 | Skill + docs update | ⬜ open | — |

**A fresh session starts at Step 6.** Steps 0 through 5 and Step 7 are implemented on PR #1006.
Preview must prove the real capture and foreign-key behavior before Step 8 can remove the six
deprecated heading columns. Production promotion remains out of scope. Do not treat the empty
heading evidence as permission to move per-value `data_type`.

---

## 0. Review findings this revision locks (Grok 4.6, 2026-08-14)

Verified against the landing migration, the loader, the privilege tests, and both sibling plans.
Do not re-litigate these.

| # | Severity | Finding | Consequence in this plan |
|---|---|---|---|
| C1 | Critical | This plan and `plan_pmt-duplicate-name-columns.md` both replace `plm.load_pmt_capture_chunk` (whole-body `CREATE OR REPLACE`) and `tools/sync-paramount-creative-library.mjs`. The owning handoff called them independent. They are not. That is the 2026-07-31 collision class (`AGENTS.md` standing fact 5). The collision checker is blind to `CREATE TABLE` / `ALTER TABLE`. | The duplicate-name plan owns the **first** loader rewrite. This plan’s rewrite is the **second** and starts from that landed body. Never author both in parallel. |
| C2 | Critical | `data_type` is a per-value JSON-type fact (number vs string on that value), not a field heading. The table that created the column says so. Moving it discards mixed types under one field. The loader fixture already asserts `data_type` per value. | `data_type` stays on every value row. `pmt_amv_data_type_chk` stays on that table. The element table does **not** get a `data_type` column. |
| C3 | Critical | `plm.opa_link_ensure_entities()` last-write-wins on the name. Copied here, the last value row would overwrite the element, or later NULL headings would blank it. | Do not copy that trigger. Preferred path: loader writes the parent first. If a trigger is added, it is `ON CONFLICT DO NOTHING`, `RAISE` on disagreement, and if headings are absent the parent row must already exist. |
| C4 | Critical | The new-table sketch was a bare `CREATE TABLE`. Sibling landing tables set RLS, role grants, and revoke `TRUNCATE` / `REFERENCES` / `TRIGGER` / `MAINTAIN` from `service_role` in the same file, because default privileges hand `service_role` everything. `plm.pmt_asset_metadata_value` was also never added to the completed-capture freeze list. | Migration A ships the full security contract, privilege proof, and `trg_pmt_metadata_element_immutable`. It also attaches the missing freeze trigger to the existing value table. |
| H5 | High | `idx_pmt_amv_element_display` is `(capture_id, metadata_element_id, display_value)` for “which assets are tagged X.” It does not contain the six heading columns. The same migration forbids an `api` view over this table unless a consumer asks, and says exclude `raw_value`. | No `api.pmt_asset_metadata_value_expanded`. No `api` view at all unless a named consumer is recorded first. Join in `plm` only if a real reader is found. |
| H6 | High | Six of the original seven columns are empty on purpose today. Paramount’s current full-metadata response does not send name / category / domain / table / column. | Step 1 must record presence counts with `FILTER (WHERE col IS NOT NULL)`. A 565k-row rewrite is still the right shape for a future richer response, not because `data_type` is a heading. |
| H7 | High | `count(distinct …)` ignores NULLs, so `'Color'` vs `NULL` passes. The sketched `source_hash text not null` has no rule; value-row hashes are per value (`md5` of each payload). Copying one is arbitrary. | Backfill uses a NULL-aware disagreement check and hashes the **descriptor tuple**, never a value-row hash. Never `max()` a disagreement. |
| H8 | High | Adding `pmt_metadata_element` as a load target requires: add it to `c_targets`, add an `INSERT` branch, put it in `LOAD_ORDER` **before** value rows, and if finalization gains a new population, replace all of `plm.validate_pmt_capture` from the current body. | Step 3 names every one of those edits. Do not invent a second writer. |
| H9 | High | The original done list included a production apply. This review is not authorized to promote. The sibling plan’s Step 0 (`apply 20260802170000`) is separately blocked by `AGENTS.md` §6.5. | Production apply is out of scope. Do not apply `20260802170000` as a side door. |

---

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** Paramount sends us a large pile of descriptive information about
each piece of artwork. Today we write the *description of the field* (its heading: name,
category, domain, source table, source column) onto every single value, hundreds of thousands
of times. Nothing forces those copies to agree. If one batch spells a field “Color” and another
spells it “Colour”, the business sees one field split into two, quietly.

The goal: **describe each field heading once per capture, and point at it.** Then a field
cannot disagree with itself, and a rename is one row rather than a rewrite of half a million.

**What is not the goal:** collapsing the *type of an individual value*. Paramount sends some
values as a JSON number and others as a JSON string. That distinction belongs on the value,
because two values under the same field can legitimately differ. Moving it would lose a source
fact.

**If any step conflicts with that goal, the goal wins — stop and flag it.** Specifically: the
table’s design promise is that *unknown future metadata elements land with no schema change at
all*. That promise is the reason the value table is shaped the way it is, and it must survive
this work intact. A design that requires a schema change when Paramount adds a new field is
wrong, however tidy it looks.

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for a shared Supabase (PostgreSQL 17)
database, project ref `qsllyeztdwjgirsysgai`, used by several POP Creations applications:
PM/PIM (`poppim-web`), CRM (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*`
PLM repos. Its contents are mirrored read-only into a `shared-db/` folder in every consumer repo
on each push to `main`.

**Business vocabulary.** POP Creations sells licensed merchandise. A **licensor** is the rights
holder (Paramount). A **property** is a title or brand. An **asset** is a piece of artwork or a
file in the licensor’s portal. Paramount calls a style guide a **Collection**.

**The schema.** `plm.pmt_*` is the landing area for data scraped from the Paramount Creative
Library portal (`stillsarchive.paramount.com`). It is **capture-versioned**: every scrape gets a
new `capture_id`, all rows carry it, completed captures are retained permanently, and only a
`status='complete'`, `capture_kind='full'` capture is served as current.

**The table in question.** `plm.pmt_asset_metadata_value` is described by its own comment as
“THE LOSSLESS STORE for Paramount asset metadata”
(`supabase/migrations/20260811030000_pmt_lossless_source_ids_and_asset_metadata_value.sql:371-381`).
Its design is deliberate and unusual, and you must understand it before changing it:

- **One row per metadata VALUE, not per field.** The source returns an *ordered array* per
  element, and `value_ordinal` preserves that order exactly.
- **Both `source_value` (machine) and `display_value` (human) are kept separately**, because
  they are different facts.
- **Two values are NEVER merged by display name.** Equal display text under different
  `metadata_element_id`s, or at different ordinals, are different rows on purpose.
- **Unknown future metadata elements land here with no schema change at all** — this is stated
  as “the whole reason this table is shaped this way instead of one column per heading”.
- **`data_type` records the JSON type of that value** (`string` / `number` / `boolean`). The
  source emits `FRANCHISE_ID` as a bare JSON number (25,116 of 150,430 values in the 2026-08-11
  capture) and the rest as strings. That distinction is a source fact
  (`20260811030000:279-284` and `:389-392`).
- Its comment also warns: this table, not the entity-level `raw` jsonb columns, is where
  lossless retention actually lives — those `raw` columns remain empty.
- It is marked **CONFIDENTIAL LICENSOR DATA — never commit a row to this PUBLIC repository.**

Primary key: `(capture_id, asset_id, metadata_element_id, value_ordinal)`.

**There is deliberately no `api` view over this table.** Spec section 8.7, restated at
`20260811030000:1221-1223`: add one only for a real consumer need, and do not expose
confidential metadata broadly by default. No consumer has asked. When one does, that view must
exclude `raw_value`.

---

## 3. What triggered this work

The Paramount schema audit of 2026-08-14 (Qwen 3.8 Max against a full schema dump, findings then
verified against production), requested by the owner: *“take another look at paramount to make
sure its schema is perfect and perfectly normalized.”*

Issue #965 tracks this plan. Orchestrator marker is #960.

**The finding, restated after review.** Six columns on `plm.pmt_asset_metadata_value` describe
the metadata *element heading*, not the *value*:

`metadata_element_name`, `metadata_category_id`, `metadata_category_name`, `domain_id`,
`source_table_name`, `source_column_name`

Those six depend on `(capture_id, metadata_element_id)` — a proper subset of the four-column
primary key. Nothing in the schema enforces that two rows sharing that pair agree on any of
the six.

**`data_type` is not in that set.** It is a per-value fact. The original plan listed it as the
seventh heading. That is the error this revision corrects.

**Estimated scale: 565,474 rows** (planner estimate, 2026-08-14, across all four captures
including the two failed ones that are retained by design). Treat as perishable
(`[SNAPSHOT 2026-08-14 — re-derive in Step 1]`).

**Why it has not bitten yet:** the six heading columns are reserved and currently unused.
`20260811030000:286-292` says they are “NULL FOR THIS CAPTURE AND ARE STILL HERE ON PURPOSE”
because Paramount’s current full-metadata response does not carry them. Step 1 must prove
whether that is still true.

**The concrete future failure.** A later richer response, or a second code path, writes
“Color” on some rows and “Colour” on others for the same `metadata_element_id`. Every grouping
or filter built on `metadata_element_name` then shows one field as two.

---

## 4. Scope — in and out

**In scope.** The six heading columns on `plm.pmt_asset_metadata_value`, a new capture-scoped
element table with the full Paramount security contract, a NULL-aware backfill, the second
rewrite of `plm.load_pmt_capture_chunk` (after the duplicate-name plan’s first rewrite), the
client `LOAD_ORDER`, tests, the completed-capture freeze on the new table **and** on the
existing value table, and the skill / docs.

**NOT in scope.**

- Moving or dropping `data_type`. It stays on each value row with `pmt_amv_data_type_chk`.
- Creating `api.pmt_asset_metadata_value_expanded` or any other `api` view over this table
  unless a named consumer is recorded in this file first.
- Copying `plm.opa_link_ensure_entities()` or any last-write-wins upsert.
- The value-level design: `value_ordinal`, `source_value` vs `display_value`, the
  never-merge-by-name rule, the `raw_value` key blocklist CHECK, `language`. **All of that is
  correct and deliberate — do not touch it.**
- The two duplicated property-name columns —
  [plan_pmt-duplicate-name-columns.md](plan_pmt-duplicate-name-columns.md). That plan owns the
  first `plm.load_pmt_capture_chunk` rewrite.
- The capture-scoped resolution defect —
  [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md). It may
  proceed in parallel on `plm.source_resolution` because it does not replace the Paramount
  loader. It must not take a migration version this plan needs, and it must **not** apply
  `20260802170000`.
- Removing capture-versioning, or purging the two failed captures’ rows. Retention is
  deliberate.
- The equivalent pattern in the Disney / NBCU / Warner metadata stores. Audit those separately.
- `plm.pmt_collection.paramount_term` (a constant stored on all 1,928 rows) — real but separate.
- Production promotion of any migration in this plan.

---

## 5. Current state of the code

**Full current column list of `plm.pmt_asset_metadata_value`** (from
`20260811030000:294-368`; production, 2026-08-14):

| # | Column | Type | Null | Role after this plan |
|---|---|---|---|---|
| 1 | capture_id | uuid | NO | stays |
| 2 | asset_id | text | NO | stays |
| 3 | metadata_element_id | text | NO | stays; gains FK to the new element table |
| 4 | **metadata_element_name** | text | YES | moves to `plm.pmt_metadata_element` |
| 5 | **metadata_category_id** | text | YES | moves |
| 6 | **metadata_category_name** | text | YES | moves |
| 7 | **domain_id** | text | YES | moves |
| 8 | **source_table_name** | text | YES | moves |
| 9 | **source_column_name** | text | YES | moves |
| 10 | data_type | text | YES | **stays on the value row** |
| 11 | value_ordinal | integer | NO | stays |
| 12 | source_value | text | YES | stays |
| 13 | display_value | text | YES | stays |
| 14 | language | text | YES | stays |
| 15 | source_path | text | YES | stays |
| 16 | raw_value | jsonb | YES | stays |
| 17 | source_hash | text | NO | stays (per-value hash; do not copy onto the element) |
| 18 | imported_at | timestamptz | NO | stays |

The six in bold are the subject of this plan. All six are already nullable.

**Constraints in force (do not break any of these):**

- PK `(capture_id, asset_id, metadata_element_id, value_ordinal)`
- FK `pmt_amv_asset_fkey (capture_id, asset_id) → plm.pmt_asset ON DELETE RESTRICT`
- FK `(capture_id) → plm.pmt_capture ON DELETE RESTRICT`
- `pmt_amv_data_type_chk CHECK (data_type IS NULL OR data_type IN ('string','number','boolean'))`
  — **this stays on the value table**
- `pmt_amv_element_id_chk CHECK (btrim(metadata_element_id) <> '')`
- `pmt_amv_has_a_value_chk CHECK (source_value IS NOT NULL OR display_value IS NOT NULL)`
- `pmt_amv_not_undefined_chk` — neither value may equal the literal string `'undefined'`
- `pmt_amv_ordinal_chk CHECK (value_ordinal >= 0)`
- `pmt_amv_source_hash_chk CHECK (btrim(source_hash) <> '')`
- `pmt_amv_raw_value_shape_chk` — `raw_value` must be a jsonb object and must NOT contain any of
  ~22 blocked keys. **This is a security control. Leave it exactly as it is.**

**Indexes:** `idx_pmt_amv_asset (capture_id, asset_id)`, `idx_pmt_amv_capture (capture_id)`,
`idx_pmt_amv_element (capture_id, metadata_element_id)`,
`idx_pmt_amv_element_display (capture_id, metadata_element_id, display_value)`.
The last index is for “which assets are tagged X”. It is **not** evidence that the heading
columns are read.

**There is no `metadata_element` entity table.** `metadata_element_id` has nothing to foreign-key
to. That absence is the heading defect.

**Security already on the value table** (`20260811030000:408-486`):

- `ENABLE` row level security, not `FORCE` (FORCE would silently filter the `SECURITY DEFINER`
  loader to zero rows).
- Policy `pmt_asset_metadata_value_read`: `SELECT` to `authenticated` using
  `app.has_any_role(array['administrator','sales','licensing','designer'])`.
- Policy `pmt_asset_metadata_value_service`: `ALL` to `service_role`.
- `REVOKE ALL` from `public` and `anon`.
- `GRANT SELECT` to `authenticated`.
- `GRANT SELECT, INSERT, UPDATE, DELETE` to `service_role`.
- `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` from `service_role`.
- In-migration privilege proof that fails the migration if any of those bits survive.

**Completed-capture freeze gap (verified).** `plm.pmt_reject_completed_capture_change()` is
attached in `20260810020000:972-986` to a hard-coded list that ends at
`pmt_property_capture_log`. `plm.pmt_asset_metadata_value` was created later and is **not**
on that list. A new element table would inherit the same hole unless this plan names the
trigger.

**The loader (database).** `plm.load_pmt_capture_chunk(uuid, text, jsonb)` in
`20260811030000:503-745`. Fixed allow list `c_targets` at `:518-526` currently ends with
`'pmt_asset_metadata_value'`. The value `INSERT` branch is at `:715-734` and still writes
the six heading columns plus `data_type`. Empty-chunk shortcut, 5000-row bound,
capture-must-be-`loading`, privilege check, loud unreachable-else, `SECURITY DEFINER` with
pinned `search_path`. After `CREATE OR REPLACE`, grants are restated at `:758-760`.

**The loader (client).** `tools/sync-paramount-creative-library.mjs`:

- `LOAD_ORDER` at `:474-498` lists `pmt_asset_metadata_value` **last**, after `pmt_asset`,
  because of the composite asset FK.
- `buildPayloads()` maps headings and `data_type` onto each value row at `:643-677`.
- Tests in `tools/sync-paramount-creative-library.test.mjs` assert `data_type` per value
  (`:521-531`) and that missing headings become `null` (`:533-543`).

**Validator.** `plm.validate_pmt_capture(uuid)` at `20260811030000:795+`. Its header
(`:766-780`) warns that `CREATE OR REPLACE` replaces the whole body and an earlier draft
dropped 12 of 13 checks. If this plan adds a `metadata_elements` population, the new body
must be built from the **then-current** function text, not rewritten to resemble it.

**Privilege contract test.** `supabase/tests/plm_maintain_revokes_and_default_privileges.sql`
`v_pmt` at `:110-121` is a mandatory-existence list. Naming `pmt_metadata_element` there
makes the test fail on any database that does not yet have the table. Add it in the same PR
as Migration A.

**Migration numbering.** `supabase/migrations/` is flat, `<UTC timestamp>_<slug>.sql`. Latest
merged as of this revision’s base (`origin/main` `658dbba`) is
`20260814060000_opa_link_ensure_entities.sql`. The curated-decisions plan **hard-codes**
`20260814070000` (`plan_curated-decisions-survive-syncs.md:469`). **Do not take that
version.** Before writing any file, re-derive:

```text
git fetch origin
git ls-tree origin/main --name-only supabase/migrations/
```

and continue after whatever you find **and** after any sibling-plan versions already on disk.
Never reuse a version number.

---

## 6. Key findings and root cause

**Root cause.** The loader flattened a two-level source structure (elements, each with values)
into one level (values), carrying the element’s headings down onto every value row. That is a
reasonable shortcut for a pure archive and a defect for anything that reads the headings.

**The design promise that constrains the fix.** The table’s comment states its shape exists so
“unknown future metadata elements land here with no schema change at all”. A per-capture element
table *preserves* that promise: a new element is a new **row** in the element table, never a new
column anywhere. Any solution that requires DDL when Paramount adds a heading fails the goal in
§1 and must be rejected.

**Why the element table must be capture-scoped.** Every table in `plm.pmt_*` carries
`capture_id`, and every FK is composite with it, so a link can never cross captures. Keeping
`plm.pmt_metadata_element` keyed `(capture_id, metadata_element_id)` matches that discipline
exactly and lets the value rows FK to it composite-with-capture like everything else.
**Note the deliberate contrast with the sibling resolution plan**, which moves data *out* of
capture scope: that is right there because a human *decision* is not an observation, and wrong
here because an element heading genuinely is an observation of one capture.

**Why `data_type` does not move.** The landing migration’s own comment
(`20260811030000:279-284`) records that `raw_value` arrives as a JSON number for one element
and a JSON string for the others, and that this distinction is the fingerprint of the precision
hazard the lossless store exists to keep. The client fixture already asserts
`future.data_type === "number"` on a value row
(`tools/sync-paramount-creative-library.test.mjs:530`). Collapsing it to one cell per element
would make a later mixed-type element impossible to represent.

**Why the OPA trigger is the wrong repair.** `20260814060000:31-38` upserts
`property_name = excluded.property_name` on conflict. That is last-write-wins. On this table
it would let the last value row in a chunk overwrite the heading, or let a later NULL heading
blank a real one. The goal of this plan is that headings cannot disagree. Last-write-wins
hides disagreement.

**Why both Paramount plans cannot ship independently.** Both do `CREATE OR REPLACE` of the
same function. The 2026-07-31 four-way collision used exactly that pattern, three of them
sharing one version. The handoff’s “Independent” cell at
`HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md:159-160` is
superseded by this plan’s Step 0.

---

## 7. Approaches considered and REJECTED, and why

1. **Leave it; the loader is careful. REJECTED.** Care is not a constraint. The owner’s
   instruction on 2026-08-14: “if it’s possible for a problem to happen, address it now.”
2. **Add a CHECK or trigger asserting all rows for one element agree. REJECTED.** A cross-row
   assertion on 565k rows is expensive and, more importantly, polices a defect rather than
   removing it — a band-aid under standing rule 10.
3. **One column per metadata heading. REJECTED, emphatically.** This is precisely what the
   table’s comment says it exists to avoid, and it breaks the no-schema-change-for-new-elements
   promise.
4. **A global (capture-independent) element table. REJECTED.** It breaks the schema’s uniform
   composite-with-capture FK discipline, and an element’s headings legitimately can change
   between captures.
5. **Move the headings into `raw_value`. REJECTED.** `raw_value` has a security CHECK
   blocking ~22 key names, is nullable, and is not the place for structured lookups.
6. **Drop the heading columns without a replacement. REJECTED.** Deprecate → replace → drop.
7. **Move `data_type` onto the element table. REJECTED by review, 2026-08-14.** It is a
   per-value JSON-type fact. The original plan left this OPEN; this revision locks it.
8. **Copy `plm.opa_link_ensure_entities()` so writers need not remember order. REJECTED by
   review, 2026-08-14.** Last-write-wins undoes the goal. Loader-first is the repair.
9. **Create `api.pmt_asset_metadata_value_expanded` as a drop-in. REJECTED by review,
   2026-08-14.** The landing migration forbids an `api` view without a named consumer.
10. **Ship this plan’s loader rewrite in parallel with the duplicate-name plan. REJECTED.**
    Same function, same collision class as 2026-07-31.
11. **Promote to production in this work. REJECTED.** Not authorized. Preview only.

---

## 8. Design decisions already made

**LOCKED.**

| Decision | Date | Reasoning |
|---|---|---|
| The lossless value-level design stays untouched | pre-existing | Stated in the table’s own comment |
| New metadata elements must never require a schema change | pre-existing | The table’s stated reason for existing |
| Capture-versioning stays; retention of failed captures stays | pre-existing | Load-integrity gates depend on it |
| `pmt_amv_raw_value_shape_chk` is a security control, untouched | pre-existing | Blocks creative bytes and credentials |
| Fix latent problems now rather than monitor them | 2026-08-14, owner | Explicit instruction |
| Deprecate → replace → drop, never drop first | 2026-08-14 | Same sequencing as `20260814050000` |
| `data_type` stays on each value row | 2026-08-14, review | Per-value JSON type; moving it loses mixed types |
| No `api` view without a named consumer | 2026-08-14, review + `20260811030000:1221-1223` | Confidential metadata is not exposed by default |
| Do not copy the OPA last-write-wins trigger | 2026-08-14, review | Would overwrite or blank headings |
| Duplicate-name plan owns the first loader rewrite; this plan follows | 2026-08-14, review + orchestrator | Collision class of 2026-07-31 |
| Full Paramount security contract on the new table, in the create file | 2026-08-14, review | Default privileges hand `service_role` everything |
| Completed-capture freeze on the new table (and the existing value table) | 2026-08-14, review | `20260810020000` list does not include either |
| Backfill is NULL-aware and hashes the descriptor tuple | 2026-08-14, review | `count(distinct)` ignores NULL; value hashes are per value |
| Production apply is out of scope | 2026-08-14, review | Not authorized; §6.5 also holds `20260802170000` |
| `20260802170000` stays held with the FR removal work | 2026-08-03, owner | `AGENTS.md` §6.5 |

**OPEN — your judgment.**

- **Whether to add a `metadata_elements` population to `plm.validate_pmt_capture`.**
  Recommendation: only if Step 1 shows a cheap integrity win. If you add it, copy the
  then-current function body in full (`20260811030000:766-780` warning). If you do not add
  it, do not touch that function.
- **Whether to backfill the two failed captures’ rows.** Recommendation: yes, for uniformity —
  the rows are retained deliberately and a half-migrated table is worse than either end state.
- **Whether to attach a non-OPA parent-ensure trigger in addition to loader-first.**
  Recommendation: no. Loader-first plus the new-element-id test is enough. If you add one,
  it must follow the contract in Step 3, not the OPA body.

**No new owner decision is required** for the element-table shape if `data_type` stays on the
value row and no `api` view is added.

---

## 9. The plan

### Serialization order (do not reorder)

```text
Step 0  duplicate-name plan’s first load_pmt_capture_chunk rewrite is on origin/main
        (or that plan records, with evidence, that it will not rewrite the function)
   │
   ├─ Step 1  measure (may start in parallel with Step 0; must finish before Migration A)
   │
   ▼
Migration A   create plm.pmt_metadata_element + RLS/grants/revokes/proof
              + trg_pmt_metadata_element_immutable
              + trg_pmt_asset_metadata_value_immutable
              + NULL-aware backfill
   │
   ▼
Migration B   CREATE OR REPLACE plm.load_pmt_capture_chunk
              starting from the Step-0 body
              + tools/sync-paramount-creative-library.mjs LOAD_ORDER + buildPayloads
              + loader tests
              + optional validate_pmt_capture only if a new population is added
   │
   ▼
Tests         pmt_metadata_element_contracts.sql
              + add pmt_metadata_element to v_pmt in plm_maintain_revokes_and_default_privileges.sql
   │
   ▼
Migration C   pmt_amv_element_fkey  (never before Migration B)
   │
   ▼
Step 6        preview capture to status = complete
   │
   ▼
Migration D   COMMENT DEPRECATED on the six heading columns
   │
   ▼
Migration E   DROP the six heading columns (separate PR; after a second proven capture)
   │
   ▼
Step 9        skill + docs
```

Curated-decisions may run in parallel on `plm.source_resolution` and its guard. It must not
take `20260814070000` if that version is still free when this plan needs a slot, and it must
not apply `20260802170000`.

#### Step 0. Serialization gate — the other plan owns the first loader rewrite

- **What:** prove that `plan_pmt-duplicate-name-columns.md` has either (a) merged its
  `CREATE OR REPLACE plm.load_pmt_capture_chunk` to `origin/main`, or (b) recorded in its
  STATUS table that it will not rewrite that function (for example because Step 1 of that
  plan judged both name columns to be distinct facts and no loader edit is needed).
- **How:**
  1. Read that plan’s STATUS table.
  2. `git fetch origin` and search `origin/main` for a migration that replaces
     `plm.load_pmt_capture_chunk` after `20260811030000`.
  3. If that rewrite exists, **this plan’s Migration B starts from that body**, not from
     `20260811030000`.
  4. If that rewrite is still open, **stop**. Do not author a competing `CREATE OR REPLACE`.
- **You will know it worked when:** the STATUS evidence cell names the sibling commit SHA or
  the sibling STATUS artifact that says “no loader rewrite”, plus the function’s current
  source migration version.

#### Step 1. Measure — NULL-aware, and keep `data_type` on the value

- **What:** establish whether the six headings actually disagree today, whether they are still
  all NULL, how many distinct elements exist, and whether `data_type` mixes inside one element.
  Mixing of `data_type` is **expected and allowed**. It is not a reason to move the column.

  ```sql
  -- Prove the connection target first (AGENTS.md §4.2). Read-only.

  -- (a) Presence: are the reserved headings still empty?
  select
    count(*) as value_rows,
    count(*) filter (where metadata_element_name  is not null) as named,
    count(*) filter (where metadata_category_id   is not null) as cat_ids,
    count(*) filter (where metadata_category_name is not null) as cat_names,
    count(*) filter (where domain_id              is not null) as domains,
    count(*) filter (where source_table_name      is not null) as src_tables,
    count(*) filter (where source_column_name     is not null) as src_cols,
    count(*) filter (where data_type              is not null) as typed
  from plm.pmt_asset_metadata_value;

  -- (b) NULL-aware disagreement on the SIX headings only.
  -- count(distinct x) ignores NULLs, so 'Color' vs NULL would pass a bare distinct check.
  select capture_id, metadata_element_id, heading, n_nonnull, n_null, n_distinct
  from (
    select capture_id, metadata_element_id, 'metadata_element_name' as heading,
           count(*) filter (where metadata_element_name is not null) as n_nonnull,
           count(*) filter (where metadata_element_name is null)     as n_null,
           count(distinct metadata_element_name)                     as n_distinct
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'metadata_category_id',
           count(*) filter (where metadata_category_id is not null),
           count(*) filter (where metadata_category_id is null),
           count(distinct metadata_category_id)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'metadata_category_name',
           count(*) filter (where metadata_category_name is not null),
           count(*) filter (where metadata_category_name is null),
           count(distinct metadata_category_name)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'domain_id',
           count(*) filter (where domain_id is not null),
           count(*) filter (where domain_id is null),
           count(distinct domain_id)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'source_table_name',
           count(*) filter (where source_table_name is not null),
           count(*) filter (where source_table_name is null),
           count(distinct source_table_name)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'source_column_name',
           count(*) filter (where source_column_name is not null),
           count(*) filter (where source_column_name is null),
           count(distinct source_column_name)
    from plm.pmt_asset_metadata_value group by 1, 2
  ) x
  where n_distinct > 1
     or (n_nonnull > 0 and n_null > 0);

  -- (c) Distinct elements per capture (size of the new table).
  select capture_id, count(distinct metadata_element_id) as elements
  from plm.pmt_asset_metadata_value group by 1 order by 1;

  -- (d) data_type mix inside one element — INFORMATIONAL ONLY.
  -- A non-zero result is NOT a defect and does NOT move the column.
  select count(*) as mixed_type_elements from (
    select capture_id, metadata_element_id
    from plm.pmt_asset_metadata_value
    group by 1, 2
    having count(*) filter (where data_type is not null) > 0
       and count(*) filter (where data_type is null)     > 0
        or count(distinct data_type) > 1
  ) x;
  ```

- **Report only counts and ids.** Never paste heading text, values, or licensed row contents
  into this plan, an issue, a PR, or a commit message.
- **Read the loader too:**
  `select pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc);`
  and `tools/sync-paramount-creative-library.mjs` `buildPayloads()` `:643-677`. Determine
  whether headings come from one authoritative element payload per capture (inconsistency
  currently impossible *by that loader*, but still unconstrained by the database) or are
  re-derived per asset.
- **Reader inventory (does not create a view):**
  ```sql
  select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where pg_get_functiondef(p.oid) ilike '%metadata_element_name%'
     or pg_get_functiondef(p.oid) ilike '%metadata_category_name%';
  select schemaname, viewname from pg_views
  where definition ilike '%metadata_element_name%';
  ```
  plus a repo search for `metadata_element_name|metadata_category_name` outside
  `supabase/migrations/`, and the same search in `poppim-web`, `popcrm-web`, `popdam3`.
  Record every reader. **Do not create an `api` view** because a reader might exist.
- **Judgment gate:** if (b) returns zero rows, the heading defect is latent. Proceed, because
  the database still permits it. If (b) returns rows, the defect is already real; stop and
  escalate as a data decision. Do not collapse with `max()`.
- **You will know it worked when:** (a)–(d), the loader paragraph, and the reader list are in
  the STATUS evidence column, dated, citing the query or file — no licensed values.

#### Step 2. Migration A — table + security + freeze + backfill

- **File:** `supabase/migrations/<next live timestamp>_pmt_metadata_element.sql`.
  Pick the version only after Step 0’s fetch and after checking the curated-decisions claim
  on `20260814070000`.
- **Gate:** Step 0 satisfied and Step 1 recorded. Do not author this file until both are
  done. It must ship in the **same PR** as Migration B so the table is not left without a
  writer.
- **Table (no `data_type` column):**

  ```sql
  create table plm.pmt_metadata_element (
    capture_id             uuid not null
      references plm.pmt_capture(capture_id) on delete restrict,
    metadata_element_id    text not null,
    metadata_element_name  text null,
    metadata_category_id   text null,
    metadata_category_name text null,
    domain_id              text null,
    source_table_name      text null,
    source_column_name     text null,
    source_hash            text not null,
    imported_at            timestamptz not null default now(),
    constraint pmt_metadata_element_pkey
      primary key (capture_id, metadata_element_id),
    constraint pmt_me_element_id_chk check (btrim(metadata_element_id) <> ''),
    constraint pmt_me_source_hash_chk check (btrim(source_hash) <> '')
  );
  ```

- **Table COMMENT is mandatory.** State: one row per Paramount metadata element per capture;
  the six headings live here and nowhere else; `data_type` stays on each value row because it
  is the JSON type of that value; value rows in `plm.pmt_asset_metadata_value` reference this
  table; a new metadata element is a new ROW here and never a schema change; confidential
  licensor data, never commit a row to this public repository.
- **Security — copy the value-table contract, names changed** (`20260811030000:431-486`):

  ```sql
  alter table plm.pmt_metadata_element enable row level security;
  -- ENABLE, not FORCE. FORCE would silently drop SECURITY DEFINER loader inserts.

  create policy pmt_metadata_element_read on plm.pmt_metadata_element
    for select to authenticated
    using (app.has_any_role(
      array['administrator','sales','licensing','designer']::app.app_role[]));

  create policy pmt_metadata_element_service on plm.pmt_metadata_element
    for all to service_role using (true) with check (true);

  revoke all on plm.pmt_metadata_element from public;
  revoke all on plm.pmt_metadata_element from anon;
  grant select on plm.pmt_metadata_element to authenticated;
  grant select, insert, update, delete on plm.pmt_metadata_element to service_role;
  revoke truncate, references, trigger, maintain
    on plm.pmt_metadata_element from service_role;
  ```

  Then the same `DO` privilege proof as `20260811030000:448-485`, failing the migration if
  `service_role` still holds `TRUNCATE` / `REFERENCES` / `TRIGGER` / `MAINTAIN`, if `anon`
  holds anything, or if `authenticated` holds any write bit or lost `SELECT`.

- **Completed-capture freeze:**

  ```sql
  create trigger trg_pmt_metadata_element_immutable
    before update or delete on plm.pmt_metadata_element
    for each row execute function plm.pmt_reject_completed_capture_change();

  -- Existing gap: the value table was created after 20260810020000's hard-coded list.
  create trigger trg_pmt_asset_metadata_value_immutable
    before update or delete on plm.pmt_asset_metadata_value
    for each row execute function plm.pmt_reject_completed_capture_change();
  ```

- **Backfill, asserted, NULL-aware.** Before insert, re-run Step 1(b) inside the migration
  and `raise exception` if it returns rows, naming the offending `(capture_id,
  metadata_element_id, heading)` — not the heading text. Then:

  ```sql
  insert into plm.pmt_metadata_element (
    capture_id, metadata_element_id,
    metadata_element_name, metadata_category_id, metadata_category_name,
    domain_id, source_table_name, source_column_name, source_hash)
  select
    v.capture_id,
    v.metadata_element_id,
    v.metadata_element_name,
    v.metadata_category_id,
    v.metadata_category_name,
    v.domain_id,
    v.source_table_name,
    v.source_column_name,
    md5(jsonb_build_object(
      'metadata_element_name',  v.metadata_element_name,
      'metadata_category_id',   v.metadata_category_id,
      'metadata_category_name', v.metadata_category_name,
      'domain_id',              v.domain_id,
      'source_table_name',      v.source_table_name,
      'source_column_name',     v.source_column_name
    )::text)
  from (
    select distinct on (capture_id, metadata_element_id)
      capture_id, metadata_element_id,
      metadata_element_name, metadata_category_id, metadata_category_name,
      domain_id, source_table_name, source_column_name
    from plm.pmt_asset_metadata_value
    order by capture_id, metadata_element_id
  ) v;
  ```

  `jsonb_build_object` keeps JSON `null` distinct from `""`, so the hash does not collapse a
  missing heading with a blank one. **Do not** `md5` a value-row `source_hash`. **Do not**
  `max()` any heading. After insert, assert:

  ```sql
  -- element rows == distinct value-table pairs, per capture
  ```

  If the assertion fails, the migration fails. Gotcha: `min(uuid)` / `max(uuid)` do not exist.

- **You will know it worked when:** on preview (`rjyboqwcdzcocqgmsyel`, proved immediately
  before apply) the table exists with both CHECKs, both policies, the four privilege revokes,
  both freeze triggers, a non-empty `obj_description`, the privilege-proof notice in the
  apply log, and the element row count equals Step 1(c).

#### Step 3. Migration B — second loader rewrite (after Step 0)

- **File:** `supabase/migrations/<next>_pmt_load_metadata_element.sql` plus
  `tools/sync-paramount-creative-library.mjs` and `.test.mjs`.
- **Start from the then-current function body** (the duplicate-name rewrite if it landed).
  Copy that body in full. Then make **only** these edits:
  1. Add `'pmt_metadata_element'` to `c_targets` (`20260811030000:518-526` in the original).
  2. Add an explicit `INSERT` branch for `pmt_metadata_element`. No dynamic SQL. Hash the
     descriptor tuple the same way as the backfill (`jsonb_build_object` of the six headings).
     Do **not** write `data_type` onto the element table.
  3. In the `pmt_asset_metadata_value` branch, **stop writing the six heading columns**. Keep
     writing `data_type` onto the value row.
  4. Keep the allow-list-before-empty-chunk ordering, the 5000-row bound, the
     capture-status check, the privilege check, the loud unreachable-else, `SECURITY DEFINER`,
     and the pinned `search_path`.
  5. After `CREATE OR REPLACE`, restate:
     ```sql
     revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb)
       from public, anon, authenticated;
     grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb)
       to service_role;
     ```
- **Client `LOAD_ORDER`** (`tools/sync-paramount-creative-library.mjs:474-498`): insert
  `"pmt_metadata_element"` **immediately before** `"pmt_asset_metadata_value"`. It still
  follows `pmt_asset` (value rows need the asset FK) and precedes value rows (value rows will
  need the element FK after Migration C).
- **`buildPayloads()`:** emit a `pmt_metadata_element` array: one object per distinct
  `metadata_element_id` in the capture, carrying the six headings (or null). Keep `data_type`
  on each value-row object. Stop sending the six heading keys on value-row objects once
  Migration D has deprecated them; until then sending null is acceptable because the columns
  stay nullable.
- **Do not add an OPA-style trigger.** If, and only if, a parent-ensure trigger is later
  judged necessary, it must be all three of:
  - `INSERT … ON CONFLICT (capture_id, metadata_element_id) DO NOTHING`
  - `RAISE` if an existing parent’s six headings are `IS DISTINCT FROM` the incoming headings
  - if all six incoming headings are NULL, require the parent row to already exist
  Never `DO UPDATE SET … = excluded.…`.
- **`plm.validate_pmt_capture`:** do not touch it unless you add a `metadata_elements`
  population. If you add one, copy the current body byte-for-byte and append, the same way
  `20260811030000:762-780` appended checks 14–16. A rewrite that “resembles” the current
  function is how 12 checks disappeared in a draft of that migration.
- **You will know it worked when:** the loader unit tests pass, including the existing
  `data_type === "number"` assertion on a value row, plus a new assertion that
  `pmt_metadata_element` is in `LOAD_ORDER` before `pmt_asset_metadata_value` and that value
  payloads no longer carry heading keys (or carry only null).

#### Step 4. Tests

Add `supabase/tests/pmt_metadata_element_contracts.sql`:

- **The regression guard, most important:** load a value row for a previously unseen
  `metadata_element_id` through the real loader path (`plm.load_pmt_capture_chunk` with
  target `pmt_metadata_element` first, then `pmt_asset_metadata_value`) and assert it
  succeeds. **This is the exact test that would have caught the 2026-08-14 OPA production
  break** — the case that only fails for a *new* id, which is why a backfill-covered schema
  looks healthy.
- Assert the same new-id path **fails** if the element parent is not loaded first, once
  Migration C’s FK exists. Before Migration C, assert the parent row is still created by the
  loader (so the later FK can land).
- Assert an element row cannot be created with a blank `metadata_element_id`.
- Assert `data_type` outside `('string','number','boolean')` is still rejected **on the
  value table**, not on the element table. Assert the element table has **no** `data_type`
  column (`information_schema.columns`).
- Assert `pmt_amv_raw_value_shape_chk` still rejects a `raw_value` containing a blocked key.
- Assert `service_role` holds none of `TRUNCATE` / `REFERENCES` / `TRIGGER` / `MAINTAIN` on
  `plm.pmt_metadata_element`, `anon` holds nothing, `authenticated` has `SELECT` only.
- Assert `trg_pmt_metadata_element_immutable` and `trg_pmt_asset_metadata_value_immutable`
  exist and call `plm.pmt_reject_completed_capture_change()`.
- Assert there is **no** `api.pmt_asset_metadata_value_expanded` (catalog check).
- Assert a completed capture refuses `UPDATE`/`DELETE` on `plm.pmt_metadata_element`.

Also add `'pmt_metadata_element'` to `v_pmt` in
`supabase/tests/plm_maintain_revokes_and_default_privileges.sql:110-121`.

Update `tools/sync-paramount-creative-library.test.mjs` in the same PR as Migration B.

**Existing suites that must stay green:** the whole `supabase/tests` job. **It is NOT a
required check** — read it before merging regardless. PR #954 merged on 2026-08-14 while it
was red and shipped a production regression.

#### Step 5. Migration C — the foreign key

- **What:**

  ```sql
  alter table plm.pmt_asset_metadata_value
    add constraint pmt_amv_element_fkey
    foreign key (capture_id, metadata_element_id)
    references plm.pmt_metadata_element (capture_id, metadata_element_id)
    on delete restrict;
  ```

- **Never before Migration B.** Adding this FK before the loader writes
  `plm.pmt_metadata_element` breaks the next Paramount capture. The 2026-08-14 OPA incident
  (`20260814040000` then `20260814060000`) is the same shape: backfill covered every existing
  row, so the schema looked healthy, and the next *new* id failed. Do not “fix” that here by
  copying the OPA trigger.
- Adding the FK will scan ~565k rows. Apply on preview first. Check
  `select status, count(*) from plm.pmt_capture group by 1;` and do not apply while a capture
  is `loading` / `validating`.
- **You will know it worked when:** Step 6’s preview capture reaches `complete` *after* the
  FK exists — not merely that the FK was created.

#### Step 6. Preview rehearsal

- Prove the CLI target immediately before apply:
  `Get-Content supabase/.temp/project-ref` must print `rjyboqwcdzcocqgmsyel`.
- Apply by explicit version (#901: preview is behind production).
- Run a real Paramount capture (credentials: 1Password `vibe_coding`, see the scrape skill).
  It must reach `plm.pmt_capture.status = 'complete'`.
- After it completes: new value rows have the six heading columns NULL (or unwritten);
  `data_type` is still populated on value rows where the source sent a type;
  `plm.pmt_metadata_element` has one row per distinct element in that capture.
- **You will know it worked when:** those three facts plus the capture id (not its contents)
  are in the STATUS evidence column.

#### Step 7. Migration D — deprecate the six heading columns

- `COMMENT ON COLUMN` each of the six (not `data_type`) with
  `'DEPRECATED 2026-08-__ — moved to plm.pmt_metadata_element. Join on
  (capture_id, metadata_element_id). data_type stays on this value row. See
  plan_pmt-metadata-element-normalization.md.'`
- They are already nullable, so no `ALTER` is needed to allow the loader to stop.
- **You will know it worked when:** `col_description` returns the deprecation text for all
  six and `data_type` still has its original comment.

#### Step 8. Migration E — drop the six heading columns

- **Drop only after** the loader change is deployed **and proven by a real capture**
  (Step 6), not merely merged. Separate PR from Migrations A–C.
- Drop only the six heading columns. **Do not drop `data_type`.** **Do not drop
  `pmt_amv_data_type_chk`.**
- **You will know it worked when:** those six names are absent from
  `information_schema.columns`, `data_type` is still present, and a fresh capture completes
  on preview afterwards.

#### Step 9. Skill and docs

- **Skill:** `paramount-creative-library-scrape` —
  `C:\Users\ahazan2\.claude\skills\paramount-creative-library-scrape\SKILL.md` on this
  machine, canonically `skills/shared/paramount-creative-library-scrape/SKILL.md` in
  `u2giants/ai-devops`. Add: the six headings are written **once per capture** to
  `plm.pmt_metadata_element`; value rows carry `metadata_element_id`, `data_type`, and the
  value fields; a new metadata element is a new row, never a schema change; there is no
  `api` view over the lossless store unless a named consumer asks, and that view must
  exclude `raw_value`.
- **Edit BOTH copies and push `ai-devops`.** If `ai-devops` has uncommitted work from
  another session, use a detached worktree from `origin/main`. Never stash or rebase over
  another session’s files.
- **Docs:** record the change in `docs/core-master-data-consolidation-aim.md`. Coordinate
  with the sibling plans so three sessions do not rewrite the same paragraph.
- **You will know it worked when:** `git log origin/main -1` in `ai-devops` shows your
  commit and both skill copies carry the new wording.

---

## 10. Tests required

`supabase/tests/pmt_metadata_element_contracts.sql` with the assertions in Step 4 — above all
the **new-element-id** case and the catalog assertion that `data_type` remains on the value
table. Plus:

- `'pmt_metadata_element'` added to `v_pmt` in
  `supabase/tests/plm_maintain_revokes_and_default_privileges.sql`
- `tools/sync-paramount-creative-library.test.mjs` updated in the same PR as Migration B,
  keeping the existing `data_type === "number"` value-row assertion
- the whole `supabase/tests` suite staying green (read it; it is not a required check)

---

## 11. Constraints, standing rules, and gotchas in force

- **All structure changes are authored here in `u2giants/shared-db`, branch + PR.** Never
  write a shared-DB migration from an app repo.
- **Worktrees only** — no session works directly in the shared `shared-db` checkout
  (`AGENTS.md` §2.1-W). This revision is already in an isolated worktree.
- **The Supabase MCP is READ-ONLY** and may be bound to production; no DDL or DML through it.
- **Prove which database you are pointed at before any write, and quote the proof**
  (`AGENTS.md` §4.2). One proof covers the next tool call only.
- **Never reuse a migration version number.** Re-derive from `git ls-tree origin/main`. Do
  not take `20260814070000` (claimed by the curated-decisions plan).
- **A foreign key added ahead of its writer breaks the next capture** — the 2026-08-14 OPA
  precedent. Repair is loader-first, not the OPA trigger.
- **`CREATE OR REPLACE` of `plm.load_pmt_capture_chunk` replaces the whole body.** Two plans
  must not do this in parallel. This plan is second.
- **`CREATE OR REPLACE` of `plm.validate_pmt_capture` can silently drop 13 checks.** Do not
  touch it unless adding a population, and then copy the current body.
- **`min(uuid)` / `max(uuid)` do not exist.** Cast through text. Do not `max()` headings.
- **`count(distinct x)` ignores NULLs.** Backfill assertions must be NULL-aware.
- **`ENABLE` RLS, never `FORCE`,** on landing tables the `SECURITY DEFINER` loader writes.
- **Default privileges grant `service_role` ALL** on new `plm` tables. Revoke
  `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` in the create file and prove it.
- **`supabase/tests against an ephemeral database` is NOT a required check.** Read it anyway.
- **Never edit a migration that may already be applied** without first proving it applied
  nothing.
- **`pmt_amv_raw_value_shape_chk` is a security control.** Do not weaken it; test that it
  survives.
- **This table is CONFIDENTIAL LICENSOR DATA.** Never paste a row into an issue, PR, commit
  message, log, or this plan.
- **This repo is PUBLIC with a PII forward guard** — no personal emails; use `app.profile`
  UUIDs.
- **`20260802170000` stays held** with the FR removal work (`AGENTS.md` §6.5). Not this
  plan’s work.
- **Production apply is out of scope.** Preview only.
- **Workflow argument traps:** `review_artifact_digest` must be `sha256:<64 hex>`;
  `reviewed_main_sha` must be the LIVE main SHA from
  `gh api repos/u2giants/shared-db/commits/main --jq .sha`.
- **Whoever executes a step updates this file’s STATUS table with an artifact**, never a
  bare number (`AGENTS.md` §4.3).

---

## 12. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | `qsllyeztdwjgirsysgai` | Read via Supabase MCP; **no writes in this plan** |
| Shared Supabase PREVIEW | `rjyboqwcdzcocqgmsyel` | A Supabase *branch*; absent from `supabase projects list` |
| Supabase Management API token | 1Password `vibe_coding` → “Supabase CLI Personal Access Token”, field `credential` | For preview apply the MCP cannot do |
| Paramount portal | `stillsarchive.paramount.com` | Credentials in 1Password `vibe_coding`; see the scrape skill |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills in `skills/shared/` |

**Secrets** via `op_run` with `op://` references only, never pasted, and **serialized** — never
fan out 1Password reads in parallel. `op_run`’s `cwd` does not accept `/tmp`-style Git Bash
paths; use a Windows path.

**Applying a migration (preview only):**

```bash
gh workflow run "Shared Supabase Migrations" --repo u2giants/shared-db --ref main -f target=preview -f mode=apply -f preview_allowlist=<version>
```

Do **not** dispatch production dry-run or production apply for this work.

**Preview is behind production** (#901) — apply by explicit version and re-verify objects, not
just the ledger.

---

## 13. Definition of done, risks, open questions

**Done means:**

- [ ] Step 0 recorded: sibling loader rewrite SHA, or sibling “no rewrite” artifact.
- [ ] Step 1’s four measurements, loader finding, and reader list recorded, dated, no
      licensed values.
- [ ] `plm.pmt_metadata_element` created with constraints, comments, RLS, grants, privilege
      revokes, privilege proof, and freeze trigger.
- [ ] `trg_pmt_asset_metadata_value_immutable` attached to the existing value table.
- [ ] Backfilled with a NULL-aware in-migration assertion (or a recorded human decision if
      headings already disagree).
- [ ] `data_type` still on every value row; element table has no `data_type` column.
- [ ] Loader (second rewrite) writes the element table first; six headings no longer written
      onto value rows; `data_type` still written onto value rows.
- [ ] `LOAD_ORDER` places `pmt_metadata_element` immediately before `pmt_asset_metadata_value`.
- [ ] No `api` view created.
- [ ] FK added **without** breaking a capture, proved by a real preview capture completing
      after the FK exists.
- [ ] New contract test added, including the new-element-id case and the privilege / freeze
      assertions; `v_pmt` updated; `supabase/tests` read and green.
- [ ] Six heading columns deprecated, then dropped in a later PR, with a capture completing
      afterwards. `data_type` not dropped.
- [ ] Skill updated in both copies; `ai-devops` pushed.
- [ ] Committed, pushed, PR merged, required CI green. **No production apply.**
- [ ] STATUS table updated with artifacts; this plan’s current-state section de-staled.

**Risks and rollback.**

- ***Two loader rewrites in flight — highest process risk.*** Mitigated by Step 0. If you
  find a competing unmerged `CREATE OR REPLACE` of `plm.load_pmt_capture_chunk`, stop.
- ***The FK-before-writer trap.*** Mitigated by Migration B before C, the new-element-id
  test, and a real preview capture. Rollback of the FK is
  `alter table plm.pmt_asset_metadata_value drop constraint pmt_amv_element_fkey`.
- ***Last-write-wins trigger.*** Do not add one. If someone adds the OPA pattern, headings
  silently drift. Rollback is `drop trigger`.
- ***Leaky backfill.*** A bare `count(distinct)` will green-light `'Color'` vs `NULL`. Use
  the Step 1(b) predicate inside the migration.
- ***`FORCE` RLS.*** Would make the loader insert zero rows with no error the caller sees as
  a privilege failure. Use `ENABLE`.
- ***Default privileges.*** A create file that forgets the four revokes ships
  `service_role` `TRUNCATE` on a confidential table. The in-migration proof is the gate.
- ***Dropping `data_type` by habit.*** The original plan listed it among “the seven”. This
  revision’s drop step names the six. A test asserts the column still exists.
- ***A consumer reads a heading column.*** Grep the three consumer repos in Step 1. There is
  no `api` view to hide behind.
- ***Dropping mid-capture.*** Check `plm.pmt_capture.status` for `loading` / `validating`
  before Migrations C and E.
- ***Version collision with curated-decisions.*** That plan claims `20260814070000`. Re-derive
  live; do not copy either plan’s number.

**Open questions.**

1. **Are the six headings still all NULL?** Step 1(a). Changes urgency, not direction.
2. **Does `data_type` mix inside one element?** Step 1(d). Informational. The column stays.
3. **Should `metadata_elements` join `pmt_capture_expectation`?** Only if cheap; copy the
   validator body if yes.
4. **Does the same flattening exist in Disney / NBCU / Warner?** Out of scope here.
5. **When is production apply authorized?** Not in this plan. A later session needs an
   explicit owner authorization and the §5.1 lane.

---

## Exact objects this revised plan would write

| Action | Object |
|---|---|
| CREATE TABLE | `plm.pmt_metadata_element` |
| PK | `(capture_id, metadata_element_id)` |
| FK | `plm.pmt_metadata_element.capture_id → plm.pmt_capture(capture_id)` |
| CHECKs | `pmt_me_element_id_chk`, `pmt_me_source_hash_chk` |
| RLS | `ENABLE`; policies `pmt_metadata_element_read`, `pmt_metadata_element_service` |
| GRANT / REVOKE | `authenticated` SELECT; `service_role` SELECT/INSERT/UPDATE/DELETE; revoke ALL from `public`/`anon`; revoke `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` from `service_role` |
| Privilege proof | in-migration `DO` block, same shape as `20260811030000:448-485` |
| CREATE TRIGGER | `trg_pmt_metadata_element_immutable` → `plm.pmt_reject_completed_capture_change()` |
| CREATE TRIGGER | `trg_pmt_asset_metadata_value_immutable` → same function (existing gap) |
| INSERT (backfill) | one row per `(capture_id, metadata_element_id)`; hash = `md5(jsonb_build_object(six headings)::text)` |
| CREATE OR REPLACE | `plm.load_pmt_capture_chunk(uuid, text, jsonb)` — **second** rewrite, after the duplicate-name plan |
| Function grants | revoke execute from `public`/`anon`/`authenticated`; grant to `service_role` |
| Possible CREATE OR REPLACE | `plm.validate_pmt_capture(uuid)` — only if a `metadata_elements` population is added |
| ALTER | `plm.pmt_asset_metadata_value` add `pmt_amv_element_fkey` |
| COMMENT / later DROP | `metadata_element_name`, `metadata_category_id`, `metadata_category_name`, `domain_id`, `source_table_name`, `source_column_name` |
| Client | `tools/sync-paramount-creative-library.mjs` (`LOAD_ORDER`, `buildPayloads`), `.test.mjs` |
| Tests | `supabase/tests/pmt_metadata_element_contracts.sql`; add the new table to `plm_maintain_revokes_and_default_privileges.sql` `v_pmt` |
| Docs | `paramount-creative-library-scrape` skill (both copies), `docs/core-master-data-consolidation-aim.md` |

**Do not create:** `api.pmt_asset_metadata_value_expanded` or any other `api` view over this
store; a `data_type` column on `plm.pmt_metadata_element`; `plm.opa_link_ensure_entities()`-shaped
trigger; any drop of `data_type` or `pmt_amv_data_type_chk`.

**Leave untouched:** value-level design (`value_ordinal`, `source_value`/`display_value`,
never-merge-by-name, `pmt_amv_raw_value_shape_chk`), `language`, `raw_value`.

---

## Overlap with the other two plans

| Shared object | This plan | Duplicate-name plan | Curated-decisions plan |
|---|---|---|---|
| `plm.load_pmt_capture_chunk` | **second** rewrite | **first** rewrite (owns it) | read only |
| `tools/sync-paramount-creative-library.mjs` + test | rewrite after sibling | rewrite first | no |
| `paramount-creative-library-scrape` skill | edit | edit | edit |
| `docs/core-master-data-consolidation-aim.md` | edit | edit | edit |
| `supabase/migrations/` versions | after live max **and** after `20260814070000` if that file exists | same band | hard-codes `20260814070000` |
| Preview capture / `plm.pmt_capture` | required rehearsal | required rehearsal | inventory reads |
| `plm.pmt_asset_metadata_value` | FK, freeze trigger, later drop six headings | no | no (no resolution columns) |
| `plm.pmt_authorized_title_property` / `pmt_property_capture_log` | no | yes | no |
| `plm.source_resolution` + guard triggers | no | no | yes |
| `20260802170000` production apply | **no** | no | Step 0, **blocked by §6.5** |

---

## Remaining implementation gates

1. **Step 0 must pass** before Migration B is authored.
2. **Step 1 measurements must be recorded** before Migration A backfill is written.
3. If Step 1(b) returns disagreement rows, **stop for a human data decision**. Do not `max()`.
4. Migrations A, B, C and the tests ship together, in that file order, on preview only.
5. Migration C’s FK lands only after Migration B is applied.
6. A preview capture must reach `complete` after the FK exists before Migration E is written.
7. `cat supabase/.temp/project-ref` (or `Get-Content`) must be `rjyboqwcdzcocqgmsyel`
   immediately before every preview apply.
8. `supabase/tests against an ephemeral database` must be read before merge even though it is
   not a required check.
9. **No production apply** until a later session has explicit owner authorization.
10. **Do not apply `20260802170000`.**

---

## Self-audit (required by the implementation-plan-writer standard)

**1. Could a brand-new session execute this without asking anything?** Yes. §2 explains the
application, the vocabulary, the capture-versioned model, and the deliberate value-table
shape, including why `data_type` is a value fact and why there is no `api` view. §5 gives the
complete 18-column table with post-plan role, all constraints by name, the security contract
to copy (file:line), the freeze-list gap, the loader allow list and INSERT branch (file:line),
`LOAD_ORDER`, and the validator rewrite warning. §9’s steps each name files, exact SQL, or
catalog queries, and each ends in a verification gate. §0 names the sibling serialization.
§12 names every credential by location and forbids production apply.

**2. Does it carry every piece of reasoning, including what was ruled out?** Yes. §7 records
eleven rejected approaches, including the three this revision exists to stop: moving
`data_type`, copying the OPA trigger, and creating an `api` view. §0 tables every Grok 4.6
Critical/High finding with its file anchor. §6 states why last-write-wins undoes the goal and
why the two Paramount plans cannot ship independently. The original Step 4 trap (FK before
writer) is still in Step 5, without the OPA “equivalent” option.

**3. Is the goal clear enough to support a correct judgment call?** Yes. §1 states the goal
in business terms and names the constraint that outranks tidiness: new metadata elements must
never require a schema change. It also states what is *not* the goal: collapsing per-value
JSON types. §8’s locked table tells the implementer not to reopen `data_type`, the `api`
view, the OPA trigger, or production apply. §4 keeps the work off the sibling plans’ objects
except for the sequenced second loader rewrite.

**Gaps found during this revision and fixed:**

- `data_type` was an OPEN column-home question; it is now locked on the value row.
- The OPA trigger was offered as equivalent to loader-first; it is now forbidden.
- The create-table sketch had no RLS, grants, revokes, privilege proof, or freeze trigger.
- The backfill used `count(distinct)`, which ignores NULL, and had no `source_hash` rule.
- The read path invented an `api` view the landing migration forbids.
- The loader step did not name `c_targets`, the INSERT branch, `LOAD_ORDER`, or the
  validator-rewrite hazard.
- The two Paramount plans were marked independent; Step 0 now serializes them.
- Done criteria included a production apply; that is removed.

**Checklist**

- [x] All 13 sections present.
- [x] Ultimate goal in plain business English, with “if a step conflicts, the goal wins”.
- [x] A fresh session can implement without asking and without the planning chat.
- [x] Rejected approaches and failed attempts written down, with why.
- [x] Every step names concrete files/functions and has a verification gate.
- [x] Locked vs. open decisions labeled.
- [x] Explicit out-of-scope list.
- [x] Tests specified by name/behavior.
- [x] Terms, paths, identifiers, and SHAs defined or referenced.
- [x] Secrets referenced by location only.
- [x] Definition of done includes commit/push/CI; production apply explicitly excluded.
- [x] Plan links to the existing handoff; that handoff already links back. No new handoff
      file (this revision is constrained to this one path).
