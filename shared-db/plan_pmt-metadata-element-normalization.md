# Implementation plan — normalize the repeated metadata-element descriptors in `plm.pmt_asset_metadata_value`

**Written:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Repo:** `u2giants/shared-db` · **Target branch:** a new branch off `main`, PR to `main`
**Handoff that owns this plan:** [HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md](HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md)
**Sibling plans:** [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md) ·
[plan_pmt-duplicate-name-columns.md](plan_pmt-duplicate-name-columns.md)

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 1 | Measure the actual disagreement in production | ⬜ open | — |
| 2 | Migration A — create `plm.pmt_metadata_element` | ⬜ open | — |
| 3 | Migration B — backfill it, and PROVE the source was consistent | ⬜ open | — |
| 4 | Migration C — FK the value rows to it | ⬜ open | — |
| 5 | Migration D — replacement read view | ⬜ open | — |
| 6 | Loader writes the element table | ⬜ open | — |
| 7 | Tests in `supabase/tests/` | ⬜ open | — |
| 8 | Migration E — deprecate then drop the seven descriptor columns | ⬜ open | — |
| 9 | Skill + docs update | ⬜ open | — |

**A fresh session starts at Step 1, and Step 1 may end this plan.** If production shows the
descriptors are already perfectly consistent AND the loader structurally cannot make them
inconsistent, the correct outcome may be a constraint rather than a new table. Measure first.

---

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** Paramount sends us a large pile of descriptive information about
each piece of artwork — what field it is, what category it belongs to, what type of value it
holds. Today we write the *description of the field* onto every single value, 565,000 times
over. Nothing forces those 565,000 copies to agree with each other. If one batch spells a field
"Color" and another spells it "Colour", the business sees one field split into two, quietly, in
every report and screen built on that data.

The goal: **describe each field once, and point at it.** Then a field cannot disagree with
itself, and a rename is one row rather than a rewrite of half a million.

**If any step conflicts with that goal, the goal wins — stop and flag it.** Specifically: the
table's design promise is that *unknown future metadata elements land with no schema change at
all*. That promise is the reason the table is shaped the way it is, and it must survive this
work intact. A design that requires a schema change when Paramount adds a new field is wrong,
however tidy it looks.

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for a shared Supabase (PostgreSQL 17)
database, project ref `qsllyeztdwjgirsysgai`, used by several POP Creations applications:
PM/PIM (`poppim-web`), CRM (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*`
PLM repos. Its contents are mirrored read-only into a `shared-db/` folder in every consumer repo
on each push to `main`.

**Business vocabulary.** POP Creations sells licensed merchandise. A **licensor** is the rights
holder (Paramount). A **property** is a title or brand. An **asset** is a piece of artwork or a
file in the licensor's portal. Paramount calls a style guide a **Collection**.

**The table in question.** `plm.pmt_asset_metadata_value` is described by its own comment as
"THE LOSSLESS STORE for Paramount asset metadata". Its design is deliberate and unusual, and
you must understand it before changing it:

- **One row per metadata VALUE, not per field.** The source returns an *ordered array* per
  element, and `value_ordinal` preserves that order exactly.
- **Both `source_value` (machine) and `display_value` (human) are kept separately**, because
  they are different facts.
- **Two values are NEVER merged by display name.** Equal display text under different
  `metadata_element_id`s, or at different ordinals, are different rows on purpose.
- **Unknown future metadata elements land here with no schema change at all** — this is stated
  as "the whole reason this table is shaped this way instead of one column per heading".
- Its comment also warns: this table, not the entity-level `raw` jsonb columns, is where
  lossless retention actually lives — those `raw` columns remain empty.
- It is marked **CONFIDENTIAL LICENSOR DATA — never commit a row to this PUBLIC repository.**

Primary key: `(capture_id, asset_id, metadata_element_id, value_ordinal)`.

---

## 3. What triggered this work

The Paramount schema audit of 2026-08-14 (Qwen 3.8 Max against a full schema dump, findings then
verified against production), requested by the owner: *"take another look at paramount to make
sure its schema is perfect and perfectly normalized."*

**The finding, stated precisely.** Seven columns on `plm.pmt_asset_metadata_value` describe the
metadata *element*, not the *value*:

`metadata_element_name`, `metadata_category_id`, `metadata_category_name`, `domain_id`,
`source_table_name`, `source_column_name`, `data_type`

All seven depend on `(capture_id, metadata_element_id)` — a **proper subset** of the four-column
primary key. That is a textbook second-normal-form partial dependency. Nothing in the schema
enforces that two rows sharing `(capture_id, metadata_element_id)` agree on any of the seven.

**Estimated scale: 565,474 rows** (planner estimate, 2026-08-14, across all four captures
including the two failed ones that are retained by design).

**The concrete failure.** A loader that normalizes inconsistently — trailing whitespace, case,
a renamed heading mid-capture, a second code path — writes "Color" on some rows and "Colour" on
others for the same `metadata_element_id`. Every grouping, filter, or UI built on
`metadata_element_name` or `metadata_category_name` then shows one field as two. There is an
index `idx_pmt_amv_element_display (capture_id, metadata_element_id, display_value)` that makes
such grouping the natural query, so this would surface in the product, not just in the data.

**Why it has not bitten yet:** unmeasured. **Step 1 exists to measure it** rather than assume.

---

## 4. Scope — in and out

**In scope.** The seven descriptor columns on `plm.pmt_asset_metadata_value`, a new element
table, the FK, the read path, the Paramount loader, tests, and the skill.

**NOT in scope.**

- The value-level design: `value_ordinal`, `source_value` vs `display_value`, the
  never-merge-by-name rule, the `raw_value` key blocklist CHECK. **All of that is correct and
  deliberate — do not touch it.**
- The two duplicated property-name columns —
  [plan_pmt-duplicate-name-columns.md](plan_pmt-duplicate-name-columns.md).
- The capture-scoped resolution defect —
  [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md).
- Removing capture-versioning, or purging the two failed captures' rows. Retention is
  deliberate.
- The equivalent pattern in the Disney / NBCU / Warner metadata stores, if any exists. Audit
  those separately; do not generalize blind.
- `plm.pmt_collection.paramount_term` (a constant stored on all 1,928 rows) — real but separate;
  open a follow-up issue.

---

## 5. Current state of the code

**Full current column list of `plm.pmt_asset_metadata_value`** (production, 2026-08-14):

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | capture_id | uuid | NO | |
| 2 | asset_id | text | NO | |
| 3 | metadata_element_id | text | NO | |
| 4 | **metadata_element_name** | text | YES | |
| 5 | **metadata_category_id** | text | YES | |
| 6 | **metadata_category_name** | text | YES | |
| 7 | **domain_id** | text | YES | |
| 8 | **source_table_name** | text | YES | |
| 9 | **source_column_name** | text | YES | |
| 10 | **data_type** | text | YES | |
| 11 | value_ordinal | integer | NO | |
| 12 | source_value | text | YES | |
| 13 | display_value | text | YES | |
| 14 | language | text | YES | |
| 15 | source_path | text | YES | |
| 16 | raw_value | jsonb | YES | |
| 17 | source_hash | text | NO | |
| 18 | imported_at | timestamptz | NO | now() |

The seven in bold are the subject of this plan. **All seven are already nullable**, which makes
the deprecation step cheaper than it was for the property-name columns in the sibling plan.

**Constraints in force (do not break any of these):**

- PK `(capture_id, asset_id, metadata_element_id, value_ordinal)`
- FK `pmt_amv_asset_fkey (capture_id, asset_id) → plm.pmt_asset ON DELETE RESTRICT`
- FK `(capture_id) → plm.pmt_capture ON DELETE RESTRICT`
- `pmt_amv_data_type_chk CHECK (data_type IS NULL OR data_type IN ('string','number','boolean'))`
  — **note this moves with the column**
- `pmt_amv_element_id_chk CHECK (btrim(metadata_element_id) <> '')`
- `pmt_amv_has_a_value_chk CHECK (source_value IS NOT NULL OR display_value IS NOT NULL)`
- `pmt_amv_not_undefined_chk` — neither value may equal the literal string `'undefined'`
- `pmt_amv_ordinal_chk CHECK (value_ordinal >= 0)`
- `pmt_amv_source_hash_chk CHECK (btrim(source_hash) <> '')`
- `pmt_amv_raw_value_shape_chk` — `raw_value` must be a jsonb object and must NOT contain any of
  ~22 blocked keys (`url`, `href`, `download_url`, `preview`, `thumbnail`, `content`, `bytes`,
  `cookie`, `authorization`, `token`, `headers`, …). **This is a security control preventing
  creative bytes and credentials being stored. Leave it exactly as it is.**

**Indexes:** `idx_pmt_amv_asset (capture_id, asset_id)`, `idx_pmt_amv_capture (capture_id)`,
`idx_pmt_amv_element (capture_id, metadata_element_id)`,
`idx_pmt_amv_element_display (capture_id, metadata_element_id, display_value)`.

**There is no `metadata_element` entity table.** `metadata_element_id` has nothing to foreign-key
to. That absence is the defect.

**The loader:** `plm.load_pmt_capture_chunk` (database side) plus a client-side tool — find it
with `ls tools/ | grep -i paramount`. Read both before Step 6.

**Migration numbering:** `supabase/migrations/` is flat, `<UTC timestamp>_<slug>.sql`; latest
merged as of 2026-08-14 is `20260814060000_opa_link_ensure_entities.sql`. Check
`ls supabase/migrations | tail -3` and continue after it. **Never reuse a version number** —
Supabase keys on the version alone and a duplicate silently skips one.

---

## 6. Key findings and root cause

**Root cause.** The loader flattened a two-level source structure (elements, each with values)
into one level (values), carrying the element's descriptors down onto every value row. That is a
reasonable shortcut for a pure archive and a defect for anything that reads the descriptors —
which the `idx_pmt_amv_element_display` index shows is expected.

**The design promise that constrains the fix.** The table's comment states its shape exists so
"unknown future metadata elements land here with no schema change at all". A per-capture element
table *preserves* that promise: a new element is a new **row** in the element table, never a new
column anywhere. Any solution that requires DDL when Paramount adds a heading fails the goal in
§1 and must be rejected.

**Why the element table must be capture-scoped.** Every table in `plm.pmt_*` carries
`capture_id`, and every FK is composite with it, so a link can never cross captures. Keeping
`plm.pmt_metadata_element` keyed `(capture_id, metadata_element_id)` matches that discipline
exactly and lets the value rows FK to it composite-with-capture like everything else.
**Note the deliberate contrast with the sibling resolution plan**, which moves data *out* of
capture scope: that is right there because a human *decision* is not an observation, and wrong
here because an element descriptor genuinely is an observation of one capture.

**Storage, as a secondary benefit, not the justification.** Seven text columns removed from
~565k rows. Do not lead with this — correctness is the reason.

---

## 7. Approaches considered and REJECTED, and why

1. **Leave it; the loader is careful. REJECTED.** Care is not a constraint. The owner's
   instruction on 2026-08-14: "if it's possible for a problem to happen, address it now."
2. **Add a CHECK or trigger asserting all rows for one element agree. REJECTED.** A cross-row
   assertion on 565k rows is expensive and, more importantly, polices a defect rather than
   removing it — a band-aid under standing rule 10.
3. **One column per metadata heading. REJECTED, emphatically.** This is precisely what the
   table's comment says it exists to avoid, and it breaks the no-schema-change-for-new-elements
   promise.
4. **A global (capture-independent) element table. REJECTED.** It breaks the schema's uniform
   composite-with-capture FK discipline, and an element's descriptors legitimately can change
   between captures — collapsing them would lose that history. Contrast with the sibling
   resolution plan, where capture-independence is exactly right; the distinction is
   observation vs. decision.
5. **Move the descriptors into `raw_value`. REJECTED.** `raw_value` has a security CHECK
   blocking ~22 key names, is nullable, and is not the place for structured lookups. It would
   also hide the data from the index.
6. **Drop the descriptor columns without a replacement. REJECTED.** They are read (see the
   `idx_pmt_amv_element_display` index). Deprecate → replace → drop.

---

## 8. Design decisions already made

**LOCKED.**

| Decision | Date | Reasoning |
|---|---|---|
| The lossless value-level design stays untouched | pre-existing | Stated in the table's own comment; ordered arrays, machine/human values, never-merge-by-name |
| New metadata elements must never require a schema change | pre-existing | The table's stated reason for existing |
| Capture-versioning stays; retention of failed captures stays | pre-existing | Load-integrity gates depend on it |
| `pmt_amv_raw_value_shape_chk` is a security control, untouched | pre-existing | Blocks creative bytes and credentials |
| Fix latent problems now rather than monitor them | 2026-08-14, owner | Explicit instruction |
| Deprecate → replace → drop, never drop first | 2026-08-14 | Same sequencing as `20260814050000` |

**OPEN — your judgment.**

- **Whether this plan is needed at all.** Step 1 may show perfect consistency and a loader that
  structurally cannot break it. If so, the honest outcome may be a cheaper fix (a validation
  assertion at finalization) rather than a new table. **Say so and stop, rather than building
  the table because the plan exists.**
- **Whether `data_type` moves to the element table or stays on the value.** It is *described* as
  an element property, but a source that returns mixed types under one element would make it a
  value property. Settle it with the Step 1(c) query. Recommendation: move it, and let Step 1(c)
  veto that.
- **Whether to backfill the two failed captures' rows.** Recommendation: yes, for uniformity —
  the rows are retained deliberately and a half-migrated table is worse than either end state.

---

## 9. The plan

#### Step 1. Measure — and be willing to stop here

- **What:** establish whether the descriptors actually disagree today, and whether `data_type`
  is an element property.

  ```sql
  -- (a) Do any two rows for one element disagree on a descriptor?
  select capture_id, metadata_element_id,
         count(distinct metadata_element_name)  as names,
         count(distinct metadata_category_id)   as cat_ids,
         count(distinct metadata_category_name) as cat_names,
         count(distinct domain_id)              as domains,
         count(distinct source_table_name)      as src_tables,
         count(distinct source_column_name)     as src_cols,
         count(distinct data_type)              as data_types
  from plm.pmt_asset_metadata_value
  group by 1,2
  having count(distinct metadata_element_name)  > 1
      or count(distinct metadata_category_id)   > 1
      or count(distinct metadata_category_name) > 1
      or count(distinct domain_id)              > 1
      or count(distinct source_table_name)      > 1
      or count(distinct source_column_name)     > 1
      or count(distinct data_type)              > 1;

  -- (b) How many distinct elements are there, i.e. how big is the element table?
  select capture_id, count(distinct metadata_element_id) as elements
  from plm.pmt_asset_metadata_value group by 1 order by 1;

  -- (c) Is data_type an element property or a value property?
  select count(*) from (
    select capture_id, metadata_element_id
    from plm.pmt_asset_metadata_value
    group by 1,2 having count(distinct data_type) > 1
  ) x;
  ```

- **Read the loader too:** `select pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc);`
  and the client-side tool. Determine whether the descriptors come from one authoritative
  element payload per capture (in which case inconsistency is currently impossible *by that
  loader*, but still unconstrained by the database) or are re-derived per asset (in which case
  it is a live hazard).
- **Judgment gate:** if (a) returns zero rows AND the loader reads one element payload per
  capture, the defect is latent, not active — proceed, because the database still permits it and
  the owner's instruction is to remove the possibility. If (a) returns rows, the defect is
  **already real** and this plan becomes urgent; record how many.
- **You'll know it worked when:** all three result sets and a one-paragraph loader finding are
  in the STATUS evidence column, dated.

#### Step 2. Migration A — `plm.pmt_metadata_element`

- **File:** `supabase/migrations/<next timestamp>_pmt_metadata_element.sql`.
- **What:**

  ```sql
  create table plm.pmt_metadata_element (
    capture_id            uuid not null references plm.pmt_capture(capture_id) on delete restrict,
    metadata_element_id   text not null,
    metadata_element_name text null,
    metadata_category_id  text null,
    metadata_category_name text null,
    domain_id             text null,
    source_table_name     text null,
    source_column_name    text null,
    data_type             text null,          -- omit if Step 1(c) says value-level
    source_hash           text not null,
    imported_at           timestamptz not null default now(),
    primary key (capture_id, metadata_element_id)
  );
  ```

- **Carry the constraints across:**
  `CHECK (btrim(metadata_element_id) <> '')` and
  `CHECK (data_type IS NULL OR data_type IN ('string','number','boolean'))` — the latter moves
  from `pmt_amv_data_type_chk`.
- **Table COMMENT is mandatory.** State: one row per Paramount metadata element per capture;
  the element's descriptors live here and nowhere else; value rows in
  `plm.pmt_asset_metadata_value` reference it; **a new metadata element is a new ROW here and
  never a schema change** (the original design promise, preserved); confidential licensor data,
  never commit a row to this public repository.
- **You'll know it worked when:** the table exists on preview with both CHECKs and a non-empty
  `obj_description`.

#### Step 3. Migration B — backfill, and prove the source was consistent

- **What:** populate one row per `(capture_id, metadata_element_id)`, taking each descriptor
  from the value rows.
- **The migration must ASSERT, not assume, consistency.** Before inserting, re-run Step 1(a)
  inside the migration and `raise exception` if it returns rows, naming the offending element.
  Silently collapsing disagreeing values with `max()` would destroy exactly the evidence this
  plan exists to protect. If it does raise, the resolution is a human decision, not a default.
- **Gotcha:** `min()`/`max()` on `uuid` does not exist in PostgreSQL — a previous session lost a
  preview run to `function min(uuid) does not exist`. Cast through text if you need it. (The
  descriptors here are all `text`, so this should not arise; noted because it has bitten before.)
- **You'll know it worked when:** the element row count equals Step 1(b)'s distinct-element
  count per capture, asserted inside the migration and visible in the workflow log.

#### Step 4. Migration C — the foreign key

- **What:** `ALTER TABLE plm.pmt_asset_metadata_value ADD CONSTRAINT pmt_amv_element_fkey
  FOREIGN KEY (capture_id, metadata_element_id)
  REFERENCES plm.pmt_metadata_element (capture_id, metadata_element_id) ON DELETE RESTRICT;`
- **⚠️ THE TRAP THAT ALREADY BROKE PRODUCTION ONCE IN THIS EXACT SITUATION.** On 2026-08-14,
  migration `20260814040000` added foreign keys from `plm.opa_property_character` to new entity
  tables. The backfill covered every existing row, so it looked fine — but
  `plm.sync_opa_property_character()` inserted link rows directly, knew nothing about the entity
  tables, and **every new property or character would have failed on the next capture.** It was
  caught by contract tests in CI, not by review, and the PR merged while that job was red
  because it is not a required check.

  **This plan is the same shape.** Adding this FK before the loader writes
  `plm.pmt_metadata_element` breaks the next Paramount capture. Therefore:
  **Step 6 (loader) must ship BEFORE or WITH Step 4, never after.** If you prefer the trigger
  approach that repaired the OPA case, model it on `plm.opa_link_ensure_entities()` in
  `supabase/migrations/20260814060000_opa_link_ensure_entities.sql` — a `BEFORE INSERT OR UPDATE`
  trigger that upserts the parent row from the values on the incoming row, so no writer has to
  remember ordering. Read that migration's comment block in full first; it explains why a trigger
  beat editing the loader.
- **You'll know it worked when:** a full Paramount capture runs to `complete` on preview *after*
  the FK exists — not merely that the FK was created.

#### Step 5. Migration D — read path

- **What:** create a view that reproduces today's shape by joining, so existing readers have a
  drop-in target:
  `api.pmt_asset_metadata_value_expanded` (or `plm.`, matching whatever the existing readers
  use) selecting the value columns plus the element descriptors via the join.
- **Find the readers first:**
  ```sql
  select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where pg_get_functiondef(p.oid) ilike '%metadata_element_name%'
     or pg_get_functiondef(p.oid) ilike '%metadata_category%';
  select schemaname, viewname from pg_views where definition ilike '%metadata_element_name%';
  ```
  plus `rg -n "metadata_element_name|metadata_category_name" --glob '!supabase/migrations/*'`
  across this repo, and the same grep in `poppim-web`, `popcrm-web`, `popdam3` — this repo is
  mirrored into all of them.
- **You'll know it worked when:** every reader found either uses the view/join or is listed in
  the migration comment as intentionally unchanged, with the reason.

#### Step 6. Loader writes the element table

- **What:** the Paramount loader must insert `plm.pmt_metadata_element` rows for the capture
  before (or via the trigger, during) the value rows, and stop writing the seven descriptors onto
  value rows.
- **Dependencies:** must land **before or with** Step 4. See the trap in Step 4.
- **Tests:** update the loader's own test file alongside it (pattern:
  `tools/sync-warner-starlabs.mjs` + `tools/sync-warner-starlabs.test.mjs`).
- **You'll know it worked when:** a preview capture completes and every new value row has all
  seven descriptor columns NULL while `plm.pmt_metadata_element` is populated for that capture.

#### Step 7. Tests

Add `supabase/tests/pmt_metadata_element_contracts.sql`:

- **The regression guard, most important:** load a value row for a previously unseen
  `metadata_element_id` through the real loader path and assert it succeeds. **This is the exact
  test that would have caught the 2026-08-14 OPA production break** — the case that only fails
  for a *new* id, which is why a backfill-covered schema looks healthy.
- Assert an element row cannot be created with a blank `metadata_element_id`.
- Assert `data_type` outside `('string','number','boolean')` is rejected on the element table.
- Assert the replacement view returns the same descriptors the old columns did for a known
  element.
- Assert `pmt_amv_raw_value_shape_chk` still rejects a `raw_value` containing a blocked key —
  proving the security control survived the change.

**Existing suites that must stay green:** the whole `supabase/tests` job. **It is NOT a required
check** — read it before merging regardless.

#### Step 8. Migration E — deprecate, then drop

- **Deprecate first:** `COMMENT ON COLUMN` each of the seven with
  `'DEPRECATED 2026-08-__ — moved to plm.pmt_metadata_element. Join on
  (capture_id, metadata_element_id). See plan_pmt-metadata-element-normalization.md.'`
  They are already nullable, so no `ALTER` is needed to allow the loader to stop.
- **Drop only after** the loader change is deployed **and proven by a real capture**, not merely
  merged. Drop `pmt_amv_data_type_chk` with its column.
- **You'll know it worked when:** the seven columns are absent from
  `information_schema.columns`, and a fresh capture completes on preview afterwards.

#### Step 9. Skill and docs

- **Skill:** `paramount-creative-library-scrape` — `C:\Users\ahazan2\.claude\skills\paramount-creative-library-scrape\SKILL.md`
  on this machine, canonically `skills/shared/paramount-creative-library-scrape/SKILL.md` in
  `u2giants/ai-devops`. Add: element descriptors are written **once per capture** to
  `plm.pmt_metadata_element`; value rows carry only `metadata_element_id` and the value fields;
  a new metadata element is a new row, never a schema change.
- **Edit BOTH copies and push `ai-devops`.** If `ai-devops` has uncommitted work from another
  session, use the detached-worktree pattern: temporary detached worktree from `origin/main`,
  cherry-pick, push, remove. **Never stash or rebase over another session's files.**
- **Docs:** record the change in `docs/core-master-data-consolidation-aim.md`.
- **You'll know it worked when:** `git log origin/main -1` in `ai-devops` shows your commit and
  both skill copies carry the new wording.

---

## 10. Tests required

`supabase/tests/pmt_metadata_element_contracts.sql` with the five assertions in Step 7 — above
all the **new-element-id** case, which is the shape of failure that already reached production
once in this schema family and which a backfill hides. Plus the Paramount loader's own test file
updated in Step 6, and the whole `supabase/tests` suite staying green.

---

## 11. Constraints, standing rules, and gotchas in force

- **All structure changes are authored here in `u2giants/shared-db`, branch + PR.** Claude merges
  its own PRs. Never write a shared-DB migration from an app repo.
- **Worktrees only** — no session works directly in the shared `shared-db` checkout
  (`AGENTS.md` §2.1-W).
- **The Supabase MCP is READ-ONLY** and may be bound to production; no DDL or DML through it.
- **Prove which database you are pointed at before any write, and quote the proof**
  (`AGENTS.md` §4.2).
- **Never reuse a migration version number.**
- **A foreign key added ahead of its writer breaks the next capture** — Step 4's trap, with the
  production precedent.
- **`min(uuid)` / `max(uuid)` do not exist.** Cast through text.
- **`supabase/tests against an ephemeral database` is NOT a required check.** Read it anyway;
  PR #954 merged on 2026-08-14 while it was red and shipped a production regression.
- **Never edit a migration that may already be applied** without first proving it applied nothing.
- **`pmt_amv_raw_value_shape_chk` is a security control** blocking creative bytes, URLs and
  credentials. Do not weaken it; test that it survives.
- **This table is CONFIDENTIAL LICENSOR DATA.** Never paste a row into an issue, PR, commit
  message, log, or this plan. Licensed source data never leaves its approved private repo.
- **This repo is PUBLIC with a PII forward guard** — no personal emails; use `app.profile` UUIDs.
- **Workflow argument traps:** `review_artifact_digest` must be `sha256:<64 hex>`;
  `reviewed_main_sha` must be the LIVE main SHA from
  `gh api repos/u2giants/shared-db/commits/main --jq .sha`.
- **Whoever executes a step updates this file's STATUS table with an artifact**, never a bare
  number (`AGENTS.md` §4.3).

---

## 12. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | `qsllyeztdwjgirsysgai` | Read via Supabase MCP; write via workflow / Management API |
| Shared Supabase PREVIEW | `rjyboqwcdzcocqgmsyel` | A Supabase *branch*; absent from `supabase projects list` |
| Supabase Management API token | 1Password `vibe_coding` → "Supabase CLI Personal Access Token", field `credential` | For writes the MCP cannot do |
| Paramount portal | `stillsarchive.paramount.com` | Credentials in 1Password `vibe_coding`; see the scrape skill |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills in `skills/shared/` |

**Secrets** via `op_run` with `op://` references only, never pasted, and **serialized** — never
fan out 1Password reads in parallel. `op_run`'s `cwd` does not accept `/tmp`-style Git Bash
paths; use a Windows path.

**Applying a migration:**

```bash
gh workflow run "Shared Supabase Migrations" --repo u2giants/shared-db --ref main -f target=preview -f mode=apply -f preview_allowlist=<version>
```

then production dry-run → `Production Apply Review Evidence` (live main SHA) → production apply
with `review_artifact_digest=sha256:<hex>`.

**Preview is behind production** (#901) — apply by explicit version and re-verify on production.

---

## 13. Definition of done, risks, open questions

**Done means:**

- [ ] Step 1's three measurements and loader finding recorded, dated.
- [ ] `plm.pmt_metadata_element` created with constraints and a table comment.
- [ ] Backfilled, with an in-migration assertion that the source was consistent (or a recorded
      human decision if it was not).
- [ ] Loader writes the element table; FK added **without** breaking a capture, proved by a real
      preview capture completing after the FK exists.
- [ ] Replacement view created; every reader repointed or explicitly exempted in writing,
      including greps of the three consumer repos.
- [ ] New contract test added, including the new-element-id case; `supabase/tests` read and green.
- [ ] Seven columns deprecated, then dropped, with a capture completing afterwards.
- [ ] Skill updated in both copies; `ai-devops` pushed.
- [ ] Committed, pushed, PR merged, CI green, production apply verified by reading
      `supabase_migrations.schema_migrations`.
- [ ] STATUS table updated with artifacts; handoff updated.

**Risks and rollback.**

- ***The Step 4 trap — highest risk in this plan.*** An FK added before its writer breaks the
  next capture and looks perfectly healthy until then, because the backfill covers every existing
  row. Mitigations: ship the loader first or use the trigger pattern; make the new-element-id
  test mandatory; run a full preview capture *after* the FK exists rather than trusting the DDL.
  Rollback is `alter table ... drop constraint` — immediate.
- *A consumer repo reads a descriptor column.* Grep all three consumer repos in Step 5 before
  the drop. The replacement view is the migration path.
- *The backfill assertion fires because descriptors genuinely disagree.* Not a failure — it is
  the plan working. Escalate as a data decision; do not resolve it with `max()`.
- *Dropping mid-capture.* Check `select status, count(*) from plm.pmt_capture group by 1;` for
  `loading` / `validating` before Step 8.

**Open questions.**

1. **Is the defect active or latent?** Step 1(a). Changes urgency, not direction.
2. **Is `data_type` element-level or value-level?** Step 1(c). Decides one column's home.
3. **Does the same flattening exist in the Disney / NBCU / Warner metadata stores?** Out of scope
   here; worth one query each once this pattern is proven, then a separate plan.
4. **Should the element table also be checked against `pmt_capture_expectation` at finalization?**
   That table already compares expected vs actual per population; adding `metadata_element` as a
   population would extend the existing integrity gate. Recommendation: yes, if it is cheap;
   record the decision either way.

---

## Self-audit (required by the implementation-plan-writer standard)

**1. Could a brand-new session execute this without asking anything?** Yes. §2 explains the
application, the vocabulary, and — critically — the deliberate and unusual design of this
specific table, so an implementer does not "tidy up" the parts that are correct on purpose. §5
gives the complete 18-column table, all nine constraints by name, all four indexes, and flags
which constraint moves with which column. §9's nine steps each name files, exact SQL, or catalog
queries, and each ends in a verification gate. §12 names every credential by location.

**2. Does it carry every piece of reasoning, including what was ruled out?** Yes. §7 records six
rejected approaches, including the one an implementer is most likely to reach for (one column per
heading) with the reason it is emphatically wrong, and the global-element-table option with the
observation-vs-decision distinction that separates this plan from its sibling. §6 states the
design promise that constrains every acceptable solution. §5 and Step 4 carry the production
break of 2026-08-14 in full — the FK-before-writer trap, why the backfill hid it, that CI caught
it rather than review, and that the PR merged anyway because the test job is not a required
check. That is the single most transferable piece of context in this document and it is placed
directly on the step that would repeat it.

**3. Is the goal clear enough to support a correct judgment call?** Yes. §1 states it in business
terms and names the constraint that outranks tidiness: new metadata elements must never require
a schema change. §8's first OPEN item explicitly authorises the implementer to **stop and not
build this** if Step 1 shows a cheaper fix is right — the plan does not demand its own execution.
§4 bounds scope away from the value-level design and the sibling plans.

**Gap found during the audit and fixed:** the first draft ordered the FK (Step 4) before the
loader change (Step 6), which is exactly the sequence that broke production on 2026-08-14. The
dependency was inverted, the precedent written into the step itself, and the new-element-id test
made the headline assertion in Step 7.
