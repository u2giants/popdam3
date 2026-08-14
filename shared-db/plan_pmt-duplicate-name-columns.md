# Implementation plan — remove the two duplicated property-name columns in the Paramount landing schema

**Written:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Revised:** 2026-08-14 · codex (plan implementation editor), against `main` tip `9249140`.
Every repo-verifiable claim in this plan was re-checked against the tree; see §5a for what that
established, and the change log at the end of this section for what the revision fixed.
**Repo:** `u2giants/shared-db` · **Target branch:** a new branch off `main`, PR to `main`
**Handoff that owns this plan:** [HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md](HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md)
**Sibling plans:** [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md) ·
[plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md)

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 1 | Settle intent: duplicate attribute vs. distinct fact (both columns) | ⬜ open | Repo-side payload lineage already traced — see §5a. Live sampling + private-builder read still required |
| 2 | Migration A — drop `NOT NULL`, add deprecation comments (with the drift-refusal guard) | ⬜ open | — |
| 3 | Stop BOTH writers: client tool **and** `plm.load_pmt_capture_chunk` | ⬜ open | Both writers named in §5a; the DB-side function is the one the first draft missed |
| 4 | Migration B — replace reads with joins; drop `idx_pmt_atp_name` | ⬜ open | Repo grep already clean of readers outside migrations — §5a |
| 5 | Tests in `supabase/tests/` | ⬜ open | — |
| 6 | Migration C — drop the columns | ⬜ open | — |
| 7 | Skill + docs update | ⬜ open | — |

**A fresh session starts at Step 1.** Step 1 is a genuine fork: one of the two columns may not
be a duplicate at all, and getting that wrong deletes a real fact.

**What the 2026-08-14 revision changed** (full reasoning inline where it applies):

1. **Step 3 now names the SECOND writer the first draft missed.** `plm.load_pmt_capture_chunk`
   itself INSERTs both columns by name. Editing only the client tool is not enough: Step 6's
   `DROP COLUMN` leaves a live function whose INSERT list names a column that no longer exists,
   and PL/pgSQL resolves that at CALL time — **the next capture breaks**, the exact failure
   class this plan exists to prevent. Step 3 now includes a `create or replace function`
   migration, and Step 6 gained a pre-drop gate that proves the live function body no longer
   mentions either column.
2. **Step 2 now requires the drift-refusal guard** the NBCU precedent (`20260814050000`)
   actually carries — refuse to relax `NOT NULL` if the copies have already diverged or rows
   are orphaned. The first draft said "read that migration" but did not require its guard.
3. **§5a records the verified repo evidence** (loader names, payload lineage, zero readers,
   trigger safety, `text` ids) so the executor starts from facts instead of re-deriving them.
4. **§11 gained the sibling-plan coordination rule** — the metadata-element plan edits the same
   three files (client tool, its test, `load_pmt_capture_chunk`); serialize the two plans.
5. Corrected `ls supabase/migrations` to the `git ls-tree origin/main` form required by
   `AGENTS.md` §4.3, and recorded the CI wiring facts for Steps 3 and 5.

---

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** a property's name should be written down in exactly one place.
Right now Paramount's property name is stored three times — once properly, and twice more as
copies on other tables. The copies agree today. The first time Paramount renames a title, or a
loader formats a name slightly differently, they will stop agreeing, and two screens in the
business will show two different names for the same thing with no way to tell which is right.

The owner's instruction on 2026-08-14 was explicit: *"but what about the future. if it's
possible for a problem to happen, address it now."* This plan removes the possibility rather
than monitoring for the symptom.

**If any step conflicts with that goal, the goal wins — stop and flag it.** In particular: if
Step 1 establishes that one of these columns records a genuinely *different* fact from the
property's name, then deleting it would destroy information and the correct outcome is to
**rename and document it**, not drop it. That is a success, not a failure of this plan.

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for a shared Supabase (PostgreSQL 17)
database, project ref `qsllyeztdwjgirsysgai`, used by several POP Creations applications:
PM/PIM (`poppim-web`), CRM (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*`
PLM repos. Its contents are mirrored read-only into a `shared-db/` folder in every consumer
repo on each push to `main`.

**Business vocabulary.** POP Creations sells licensed merchandise. A **licensor** is the rights
holder (Paramount). A **property** is a title or brand under it. A **character** belongs to
properties. Paramount's portal calls a style guide a **Collection**.

**The schema in question.** `plm.pmt_*` is the landing area for data scraped from the Paramount
Creative Library portal (`stillsarchive.paramount.com`). It is **capture-versioned**: every
scrape gets a new `capture_id`, all rows carry it, completed captures are retained permanently,
and only a `status='complete'`, `capture_kind='full'` capture is served as current. The entity
tables are `pmt_property`, `pmt_character`, `pmt_collection`, `pmt_franchise`, `pmt_brand`,
`pmt_asset`; the rest are link tables, logs, and capture-integrity tables.

---

## 3. What triggered this work

A schema audit of `plm.pmt_*` was run on 2026-08-14 (by Qwen 3.8 Max against a full schema
dump, with its findings then verified against production). Paramount had been called "the model
the other three licensors are being normalized toward" on the strength of a single passing
observation, and had never actually been audited. The audit was requested by the owner:
*"take another look at paramount to make sure its schema is perfect and perfectly normalized."*

Two of its four findings are the subject of this plan. Both are the **same defect already found
and fixed in the NBCUniversal schema**: a table storing a label that already lives on the entity
table it foreign-keys to.

**Finding 1 — `plm.pmt_authorized_title_property.paramount_property_name text NOT NULL`.**
The row already carries `(capture_id, property_source_id)` with a foreign key to
`plm.pmt_property`, where `property_name` lives. There is also an index
`idx_pmt_atp_name ON plm.pmt_authorized_title_property (paramount_property_name)`, which
actively invites lookups against the copy.

**Finding 2 — `plm.pmt_property_capture_log.property_name text NOT NULL`.**
Identical shape: the row foreign-keys to `plm.pmt_property` on
`(capture_id, property_source_id)` and stores the name anyway.

**Current data state, verified on production 2026-08-14:**

```sql
select
 (select count(*) from plm.pmt_authorized_title_property a
    join plm.pmt_property p using (capture_id, property_source_id)
  where a.paramount_property_name is distinct from p.property_name) as atp_name_mismatches,
 (select count(*) from plm.pmt_property_capture_log l
    join plm.pmt_property p using (capture_id, property_source_id)
  where l.property_name is distinct from p.property_name) as log_name_mismatches;
-- atp_name_mismatches = 0, log_name_mismatches = 0
```

**Nothing is broken today.** Every copy agrees. That is exactly why this is cheap now.

**How it will break.** The two names are written from *different payloads* by the loader —
`pmt_property.property_name` from the property record, `paramount_property_name` from the
rights-list response. Any of these produces a divergence: Paramount renames a title between the
two calls in one capture; the two endpoints format the name differently (trailing whitespace,
case, punctuation); a partial re-load refreshes one table and not the other. Once they diverge,
`idx_pmt_atp_name` means someone is searching the wrong copy and getting the wrong answer, and
nothing in the schema flags the disagreement.

---

## 4. Scope — in and out

**In scope.** The two named columns, **both writers** (the client tool
`tools/sync-paramount-creative-library.mjs` *and* the database-side
`plm.load_pmt_capture_chunk`), the readers that read them, the `idx_pmt_atp_name` index, the
tests, and the Paramount scrape skill.

**NOT in scope.**

- The capture-scoped resolution defect — that is
  [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md).
- The metadata element descriptors — that is
  [plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md).
- `plm.nbcu_property_character.property_label` / `character_label` — the same defect in the
  NBCU schema, already made nullable by migration `20260814050000` and awaiting the NBCU
  loader change. Do not fold it in; it has its own writer to coordinate with.
- `plm.pmt_asset.content_type` vs `mime_type` — flagged by the audit as a possible duplicate,
  but production shows **24 distinct `(content_type, mime_type)` pairs**, so they are two
  different facts. Confirmed not a defect; do not touch.
- `plm.pmt_collection.paramount_term` — a real, separate finding (a single distinct value
  across all 1,928 rows, i.e. a constant stored per row). Deliberately left out so this plan
  stays small; note it as a follow-up issue instead.
- The stored derived counts (`pmt_authorized_title.resolved_property_count` etc.) — audit
  concern-level only, not addressed here.

**Coordination with the sibling plan.**
[plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md) edits
the SAME three files this plan edits: `tools/sync-paramount-creative-library.mjs`, its
`tools/sync-paramount-creative-library.test.mjs`, and `plm.load_pmt_capture_chunk` (its Step 6
replaces the same function). **Serialize the two plans end to end** — do not have both in
flight against the same files, and do not let both ship function replacements that each
silently omit the other's changes. Whichever lands second must rebase its function body on the
live one, never on its own copy of the first draft's body.

---

## 5. Current state of the code

- **Both columns exist on production and are `NOT NULL`**, each with a non-empty CHECK:
  - `pmt_authorized_title_property_name_chk CHECK (btrim(paramount_property_name) <> '')`
  - `pmt_pcl_name_chk CHECK (btrim(property_name) <> '')`
- **Both tables have the FK that makes the copy redundant** (both constraint names re-verified
  in the tree; both were dropped and rebuilt with the same names by `20260811030000` when the
  source ids were re-typed):
  - `pmt_authorized_title_property_property_fkey FOREIGN KEY (capture_id, property_source_id)
    REFERENCES plm.pmt_property(capture_id, property_source_id) ON DELETE RESTRICT`
  - `pmt_pcl_property_fkey FOREIGN KEY (capture_id, property_source_id)
    REFERENCES plm.pmt_property(capture_id, property_source_id) ON DELETE RESTRICT`
- **`property_source_id` is `text`, not `bigint`**, on every `plm.pmt_*` table since
  `20260811030000` (pinned `^[0-9]+$` by CHECK). Any query or backfill you write must not
  assume a numeric type.
- **Row counts (all captures, production, measured by the auditing session 2026-08-14):**
  `pmt_authorized_title_property` 138, `pmt_property_capture_log` 138 — re-derive with
  `select count(*) from plm.<table>;` before relying on them; they are small and this is not a
  performance-sensitive change.
- **Index to remove with the column:** `idx_pmt_atp_name ON plm.pmt_authorized_title_property
  USING btree (paramount_property_name)`. `pmt_property_capture_log` has no index on its name
  column (only `idx_pmt_pcl_incomplete`, a partial index on incomplete captures).
- **The writers — there are TWO, and both must stop before Step 6:**
  1. **Client side:** `tools/sync-paramount-creative-library.mjs`, function `buildPayloads`
     (≈ lines 555–563 for the atp rows, ≈ 610–619 for the capture-log rows). Its tests are
     `tools/sync-paramount-creative-library.test.mjs` (`node:test`; CI auto-globs
     `tools/*.test.mjs` in the **required** `Tools offline tests` check, so an updated test is
     enforced, not optional).
  2. **Database side:** `plm.load_pmt_capture_chunk(uuid, text, jsonb)` — a `security definer`
     PL/pgSQL function whose INSERT lists name both columns
     (`... property_source_id, paramount_property_name, ...` selecting
     `r->>'paramount_property_name'`, and `... property_source_id, property_name, ...`
     selecting `r->>'property_name'`). Its **authoritative current body is the
     `create or replace` in `20260811030000`**; the bodies in `20260810020000` and
     `20260810090000` are history — never copy from them. PL/pgSQL resolves column references
     at CALL time, so a function that names a dropped column still "compiles" and then breaks
     the next capture. Replacing this function is part of Step 3, not an optional tidy.
- **Precedent for the exact sequence this plan follows:** migration
  `20260814050000_nbcu_link_labels_deprecated.sql` dropped `NOT NULL` on the equivalent NBCU
  columns and **deliberately did not drop them**, because dropping while the loader still wrote
  them would break the next capture. Read that migration before writing Step 2 — including its
  `do $$` refusal guard, which Step 2 reproduces.
- **Migration numbering.** `supabase/migrations/` is flat, `<UTC timestamp>_<slug>.sql`.
  Highest version on `main` at this plan's revision: `20260814060000_opa_link_ensure_entities.sql`
  [SNAPSHOT 2026-08-14, `git ls-tree origin/main --name-only supabase/migrations/ | sort | tail -n 3`
  at `9249140`. RE-DERIVE BEFORE ACTING]. **Never `ls supabase/migrations/`** — the shared
  checkout is usually parked on another branch and `ls` silently reports that branch's files
  (`AGENTS.md` §4.3). **Never reuse a version number** — Supabase keys on the version alone and
  a duplicate silently skips one.

### 5a. Verified repo evidence — recorded 2026-08-14 at `main` tip `9249140` so nobody re-derives it

Everything in this subsection was read out of the tree, not assumed. It does **not** settle
Step 1 by itself — the live sampling query and the private-repo builder read remain the
decisive evidence — but it fixes the starting facts.

**Payload lineage — the three names come from three different capture files.** In
`buildPayloads` (`tools/sync-paramount-creative-library.mjs`):

| Column | Built from | Capture file | Line |
|---|---|---|---|
| `plm.pmt_property.property_name` | `cap.properties[].name` | `properties.csv` | ≈ 520–523 |
| `plm.pmt_authorized_title_property.paramount_property_name` | `cap.titleScope[].paramount_property_name` | `licensed-title-scope.csv` | ≈ 555–563 |
| `plm.pmt_property_capture_log.property_name` | `cap.captureLog[].property_name` | `capture-log.csv` | ≈ 610–619 |

The three CSVs are produced by the capture builder in the **private** repo
`u2giants/licensor-source-data` (`paramount/`). Whether that builder copies one string into
three files or records three genuinely different portal payloads is exactly what Step 1 must
read it to determine. **The repo-side evidence leans "duplicate, written from three hands":**
the loader's own test fixture uses the identical string `"Fixture Property Alpha"` for all
three (`tools/sync-paramount-creative-library.test.mjs`, `properties` / `titleScope` /
`captureLog` fixtures) — the loader's author modelled them as one fact.

**Two structural observations that bear on Step 1's judgment:**

- `pmt_property_capture_log` is keyed `(capture_id, property_source_id)` with an FK to
  `pmt_property`. The "search" it logs is an **exact property selection carrying a source id**,
  not a free-text query — a typed search term would have no guaranteed FK to the entity table.
  So its `property_name` is most plausibly "the name the portal displayed for that selection",
  which is the property's name seen from a second endpoint. Confirm against the builder.
- `pmt_authorized_title_property` is populated only from `titleScope` rows **that carry a
  `property_id`** (`cap.titleScope.filter((r) => r.property_id)`); the fixture's one
  empty-name row (title not present in the portal view) is filtered out before insert. The
  column therefore never holds a free-text miss — it holds the name that travelled with a
  resolved property id.

**Zero readers in this repository.** A repo-wide search for `paramount_property_name` finds
only: the landing DDL (`20260810020000`), the three loader-function bodies
(`20260810020000`, `20260810090000`, `20260811030000`), the client tool, the test fixture,
and this plan. No `api.*` view, no `apps/` code, no script reads either copy — the Paramount
serving views built in `20260811030000` all read `p.property_name` from `pmt_property`
itself. Step 4's live-catalog double-check still runs (the databases may hold objects no
longer in the tree), but the expected repo-side answer is "nothing to repoint; drop the
index".

**Dropping the columns breaks no trigger.** The immutability triggers attached to both tables
(`trg_pmt_authorized_title_property_immutable`, `trg_pmt_property_capture_log_immutable`)
fire the GENERIC `plm.pmt_reject_completed_capture_change()`, which references no columns.
The narrower `pmt_reject_completed_source_field_change()` does reference `new.property_name`,
but it fires only on `pmt_property` and `pmt_character` — tables this plan does not touch.
Nothing else in the tree (validation, shrink check, finalize) reads either copy;
`plm.validate_pmt_capture` touches `pmt_property_capture_log` only through `complete`.

**CI wiring.** Loader tests: `tools/*.test.mjs` auto-globbed by the required
`Tools offline tests` check. Contract tests: `supabase/tests/*.sql` auto-globbed by
`supabase/tests against an ephemeral database`, which replays every migration from empty —
so a contract test merged in the same PR as a migration sees that migration already applied.
That job is **not** a required check; read it anyway (PR #954 merged while it was red).

---

## 6. Key findings and root cause

**Root cause:** the loader had two payloads in hand and wrote the name from whichever one it was
holding, instead of writing it once on the entity and referencing it. The foreign key that makes
the copy unnecessary was added, but the copy was never removed.

**Why "they agree today" is not a defence.** The schema has no constraint that makes them agree.
Agreement is currently a property of the loader's behaviour, not of the database. Any change to
either payload, either call, or either code path breaks it silently, and the index on the copy
guarantees somebody is reading it.

**Why Finding 2 might not be a defect at all.** `pmt_property_capture_log`'s table comment says
it records "one row per exact Property search performed during the capture, with the portal's
reported total against what was actually collected". If `property_name` records **the search
string that was actually typed into the portal**, it is a distinct fact — evidence of what was
searched — and it belongs on that row. As written, it is indistinguishable from a copy of the
property name. **Step 1 settles this and it is the highest-value step in the plan.** Getting it
wrong in the deleting direction destroys audit evidence.

The same question applies more weakly to Finding 1: if the rights list displays different
wording than the property record, `paramount_property_name` is "the name as it appeared on the
rights list" and should be renamed, not dropped.

---

## 7. Approaches considered and REJECTED, and why

1. **Add a CHECK or trigger forcing the copies to match. REJECTED.** It keeps two copies and
   adds machinery to police them. The duplicate is the defect; a guard around a defect is a
   band-aid under standing rule 10.
2. **Leave it, because zero mismatches today. REJECTED by the owner on 2026-08-14:** "if it's
   possible for a problem to happen, address it now."
3. **Drop the columns in a single migration. REJECTED.** The loader still writes them and both
   are `NOT NULL`; dropping first breaks the next capture. This is precisely the trap
   `20260814050000` avoided for NBCU. Deprecate → stop writing → drop, in three changes.
   **And "the loader" is two things:** even after the client tool stops sending the fields, the
   database-side `plm.load_pmt_capture_chunk` still names both columns in its INSERT lists.
   PL/pgSQL resolves those references at CALL time, so dropping the columns without first
   replacing that function leaves a function that fails on its next invocation — the same
   broken-next-capture outcome, arrived at from the other side.
4. **Fold the NBCU equivalent into this plan. REJECTED.** Different loader, different session
   owns it, and issue coordination is already in flight for it. Keeping the plans separate lets
   each ship the moment its own loader is ready.
5. **Keep the copies but stop indexing them. REJECTED.** Removing the index hides the symptom
   (people querying the copy) while leaving the divergence.

---

## 8. Design decisions already made

**LOCKED.**

| Decision | Date | Reasoning |
|---|---|---|
| Duplicated labels on link/log tables are a defect | 2026-08-13/14 | Established with NBCU; `20260814050000` acted on it |
| Deprecate → stop writing → drop, never drop first | 2026-08-14 | Dropping a still-written `NOT NULL` column breaks the next capture |
| "The writer" = client tool AND `plm.load_pmt_capture_chunk`; both must be rewritten | 2026-08-14 (revision) | The function's INSERT lists name the columns; PL/pgSQL resolves at CALL time, so a stale body breaks the first capture after the drop |
| Identity is the source id; names are never identity | pre-existing | Stated in `pmt_property`'s own table comment |
| Fix latent problems now rather than monitor them | 2026-08-14, owner | Explicit instruction |

**OPEN — your judgment, and Step 1 exists to inform it.**

- Whether either column is a distinct fact (rename + document) or a duplicate (drop). Decide
  from evidence, not from the column's name.
- Whether to drop `idx_pmt_atp_name` in Step 4 or with the column in Step 6. Recommendation:
  Step 4, so nobody is reading the copy during the window before the drop.

---

## 9. The plan

#### Step 1. Settle intent for both columns — evidence, not assumption

- **What:** determine whether each column records the property's name or a different fact.
- **Start from §5a — half of this step is already done.** The repo-side lineage is traced
  there: all three names are written from three different capture CSVs
  (`properties.csv`, `licensed-title-scope.csv`, `capture-log.csv`) by `buildPayloads` in
  `tools/sync-paramount-creative-library.mjs`, and the loader's own test fixture carries the
  identical string for all three. What §5a cannot see is what the PRIVATE builder put in those
  CSVs — that is the remaining work:
  1. Read the builder in `u2giants/licensor-source-data` (`paramount/`) — the script that
     writes `properties.csv`, `licensed-title-scope.csv` and `capture-log.csv` — and identify
     which portal payload each name is taken from. **This is the decisive evidence**, and it
     lives outside this public repo (licensed data; read it there, cite line numbers, never
     paste values).
  2. Sample the values against the property name on production (read-only):
     ```sql
     select l.property_source_id, l.property_name as log_name, p.property_name as entity_name,
            a.paramount_property_name as rights_list_name
     from plm.pmt_property_capture_log l
     join plm.pmt_property p using (capture_id, property_source_id)
     left join plm.pmt_authorized_title_property a using (capture_id, property_source_id)
     limit 50;
     ```
     Run it per capture (`where capture_id = '…'`), not across captures pooled — the names are
     only expected to agree WITHIN one capture.
  3. Read `plm.pmt_property_capture_log`'s and `plm.pmt_authorized_title_property`'s table
     comments in full (`obj_description(...::regclass)`) — they are unusually detailed in this
     schema and may state the intent outright.
- **Judgment criteria:** if the builder writes the column from a *search-term* or *rights-list
  display* field that the property record never sees, it is a distinct fact → **rename and
  document, do not drop**. If it copies the same property record that feeds
  `pmt_property.property_name`, it is a duplicate → drop. Weigh the two structural
  observations in §5a: the capture log's "search" is an exact selection carrying an FK'd
  source id (a free-text term would have no such FK), and the rights-list name only ever
  travels with a resolved `property_id`.
- **Dependencies:** none.
- **You'll know it worked when:** a one-paragraph written finding per column exists in this
  file's STATUS evidence column, citing the builder line and the sampled values, and stating
  "duplicate → drop" or "distinct fact → rename to `<name>`".

#### Step 2. Migration A — deprecate

- **File:** `supabase/migrations/<next timestamp>_pmt_duplicate_name_columns_deprecated.sql`.
- **First, reproduce the refusal guard from `20260814050000`** (the NBCU precedent this step
  models — its guard is the part not to omit): a `do $$` block that counts, per column being
  relaxed, (a) rows whose copy `is distinct from` the joined `pmt_property.property_name` and
  (b) rows with no matching `pmt_property` row, and **raises** if either is non-zero. Rationale:
  relaxing `NOT NULL` over already-drifted or orphaned copies would quietly bless the bad
  state; the right response to drift is reconcile-first. The zero-mismatch precondition was
  measured on production 2026-08-14 (§3) — the guard turns that snapshot into an
  at-apply-time fact.
- **What:** for each column judged a duplicate in Step 1:
  - `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL;`
  - `COMMENT ON COLUMN ... IS 'DEPRECATED 2026-08-__ — duplicates plm.pmt_property.property_name.
    Join through the existing foreign key on (capture_id, property_source_id) instead. The loader
    stops writing it in <step 3 commit>; the column is dropped in <step 6 migration>. See
    plan_pmt-duplicate-name-columns.md.'`
  - Leave the `btrim(...) <> ''` CHECKs in place — they still hold for non-null values.
  For any column judged a distinct fact, do the rename here instead
  (`ALTER TABLE ... RENAME COLUMN ... TO ...`) plus a comment stating what the fact is, and
  remove it from the remaining steps. **If renaming, pick a name that does NOT end in
  `property_name`** — Step 5's reintroduction guard fails any `pmt_*` column matching
  `%_property_name`, by design.
- **Behaviour when done:** the loader may stop sending the value without violating a constraint.
- **You'll know it worked when:**
  ```sql
  select column_name, is_nullable from information_schema.columns
  where table_schema='plm'
    and (table_name,column_name) in
        (('pmt_authorized_title_property','paramount_property_name'),
         ('pmt_property_capture_log','property_name'));
  ```
  returns `YES` for both, and `col_description` returns the deprecation text.

#### Step 3. Stop BOTH writers — the client tool and the database-side function

The first draft of this step said "edit the Paramount loader(s)" and left the second writer
implicit. It is explicit now, because omitting it is what would break the first capture after
Step 6.

- **What, in three parts landing as ONE PR:**
  1. **Client tool** `tools/sync-paramount-creative-library.mjs`, `buildPayloads`: delete the
     `paramount_property_name` mapping from the `pmt_authorized_title_property` block and the
     `property_name` mapping from the `pmt_property_capture_log` block. Once the keys are
     absent from the row objects, `JSON.stringify` omits them and the DB-side
     `r->>'…'` reads NULL — legal after Step 2, harmless to `source_hash` (it is per-capture).
  2. **New migration — `create or replace function plm.load_pmt_capture_chunk`** with both
     columns removed from the two INSERT lists. Copy the body from the **live function**
     (`select pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc);`), which at this
     plan's revision equals the `create or replace` in `20260811030000` — never from the older
     bodies in `20260810020000`/`20260810090000`, and never from a stale local copy if the
     sibling metadata-element plan has already replaced the function (see §4 coordination).
     Preserve everything else verbatim: the allow list, the status guard, the chunk bound, the
     `security definer` + `search_path` settings.
  3. **Tests** `tools/sync-paramount-creative-library.test.mjs`: assert the built payloads for
     both targets contain no `paramount_property_name` / `property_name` key at all, and keep
     the fixture's CSV rows (the source files may still carry the columns; the loader must
     simply not forward them). `node --test tools/sync-paramount-creative-library.test.mjs`
     must pass — CI runs it under the required `Tools offline tests` check.
- **Dependencies:** Step 2 must be applied to **production** first (the loader writes
  production captures too; a NULL into a still-`NOT NULL` column aborts the load mid-capture),
  and to preview before the rehearsal.
- **You'll know it worked when:** `pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc)`
  mentions neither column, the repo grep for `paramount_property_name` hits nothing outside
  `supabase/migrations/` and this plan, a dry run of the tool
  (`node tools/sync-paramount-creative-library.mjs` with no `--apply`) succeeds, and a capture
  run on preview completes with both columns NULL on all new rows.

#### Step 4. Migration B — move readers to the join, drop the name index

- **What:** find every reader and repoint it. **Expected answer, already verified in the tree
  (§5a): there are none in this repository** — no view, app, or script reads either copy; the
  only references are the DDL, the loader writes, and this plan. This step is therefore
  expected to reduce to the catalog double-check plus the index drop, but RUN THE CHECKS —
  the live databases can hold objects the tree no longer shows:
  ```sql
  select n.nspname, p.proname from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where pg_get_functiondef(p.oid) ilike '%paramount_property_name%'
     or (pg_get_functiondef(p.oid) ilike '%pmt_property_capture_log%'
         and pg_get_functiondef(p.oid) ilike '%property_name%');

  select schemaname, viewname from pg_views
  where definition ilike '%paramount_property_name%';
  ```
  Also grep the repo (either tool works; `rg` if installed, else plain grep):
  `rg -n "paramount_property_name" --glob '!supabase/migrations/*'` /
  `grep -rn paramount_property_name --exclude-dir=supabase .`. **Exclude nothing else** — after
  Step 3 the loader and its tests are supposed to be clean too, so hits there mean Step 3 is
  incomplete. Repoint any real reader to join `plm.pmt_property` on
  `(capture_id, property_source_id)`.
- **Then** `DROP INDEX plm.idx_pmt_atp_name;` — plain `DROP INDEX`, never
  `CONCURRENTLY` (a migration file cannot carry it; `AGENTS.md` §5.1-A).
- **You'll know it worked when:** both catalog queries and the repo grep return nothing outside
  `supabase/migrations/` and this plan, and the index is gone from `pg_indexes`.

#### Step 5. Tests

Add `supabase/tests/pmt_no_duplicate_property_name_contracts.sql`, following the suite's
conventions (read `supabase/tests/nbcu_landing_contracts.sql` first): assertions check objects
and behaviour via the catalog — never `supabase_migrations.schema_migrations`; every fixture
value invented (`ZZTEST-*`, `example.invalid`); one `do $$` block per section with a
pass/fail counter; and note the pooler trap — run each `do $$` block as a separate statement,
never the whole file as one batch.

- Assert neither `plm.pmt_authorized_title_property` nor `plm.pmt_property_capture_log` has a
  column whose value duplicates `plm.pmt_property.property_name` — after Step 6 this is a
  catalog assertion that the columns do not exist; before Step 6, assert they are nullable and
  that no reader references them. **Mind the CI semantics:** the contract-test job replays
  every merged migration from empty, so the file merged in the same PR as Migration C must
  assert the post-drop state, and a file merged earlier must assert the interim state — write
  the version that matches the migrations it ships with.
- Assert the property name is reachable by join from both tables (the replacement path works).
- Assert the duplicate-writing spots are gone from
  `pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc)`: no `paramount_property_name`
  anywhere, and no `property_name, reported_asset_count` adjacency (that pairing occurs only
  in the capture-log INSERT list — the entity branch's `property_name, is_licensed_selection`
  is legitimate and must remain). This is the regression guard for the exact trap Step 3
  closes; see Step 6's gate for why the naive `%property_name%` check is wrong.
- **Regression guard, the important one:** assert that no `plm.pmt_*` table other than
  `pmt_property` has a column named `property_name` or `%_property_name`. This is what stops
  the defect being reintroduced by the next table someone adds. (If Step 1 renamed a column,
  the rename target must not match these patterns — Step 2 already says so.)

**Existing suites that must stay green:** the whole `supabase/tests` job. Note that
`supabase/tests against an ephemeral database` is **not** a required check — read it before
merging anyway; PR #954 merged on 2026-08-14 while it was red.

#### Step 6. Migration C — drop the columns

- **Dependencies:** Steps 2–5 done, and the loader change from Step 3 **deployed and proven by
  a real capture**, not merely merged.
- **Pre-drop gate, run on BOTH preview and production immediately before applying:** prove the
  live writer is the new one. Careful: the function's `pmt_property` branch legitimately
  writes `property_name` — the entity column stays — so a bare `%property_name%` check
  false-positives. Assert the two DUPLICATE-writing spots are gone:
  ```sql
  select
    position('paramount_property_name' in d) as atp_name,
    position('property_name, reported_asset_count' in d) as log_name_adjacency
  from (select pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc) as d) f;
  ```
  Both must be `0`. The adjacency test is precise: `property_name, reported_asset_count`
  occurs only in the capture-log INSERT list; the entity branch writes
  `property_name, is_licensed_selection`. Also confirm the client tool on the machine that
  runs captures is the Step 3 revision. **This gate is the difference between dropping a
  column nobody writes and dropping one a live function still names** — PL/pgSQL would not
  complain at `DROP` time, only at the next capture.
- **What:** `ALTER TABLE ... DROP COLUMN ...` for each duplicate, plus the matching
  `btrim` CHECK constraints, which drop with the column automatically.
- **You'll know it worked when:** `information_schema.columns` returns no rows for either
  column, and a fresh Paramount capture completes on preview.

#### Step 7. Skill and docs

- **Skill:** `paramount-creative-library-scrape`, at
  `C:\Users\ahazan2\.claude\skills\paramount-creative-library-scrape\SKILL.md` on this machine
  and canonically at `skills/shared/paramount-creative-library-scrape/SKILL.md` in
  `u2giants/ai-devops`. Add to its landing section: write the property name **only** to
  `plm.pmt_property.property_name`; `pmt_authorized_title_property` and
  `pmt_property_capture_log` carry ids and counts only; read names by joining.
- **Edit BOTH copies and push `ai-devops`.** If `ai-devops` has uncommitted work from another
  session, use the detached-worktree pattern: create a temporary detached worktree from
  `origin/main`, cherry-pick your commit there, push, remove the worktree. **Never stash or
  rebase over another session's files.**
- **Docs:** add a line to `docs/core-master-data-consolidation-aim.md` recording that Paramount
  was audited on 2026-08-14 and what was found.
- **You'll know it worked when:** `git log origin/main -1` in `ai-devops` shows your commit and
  both skill copies contain the new wording.

---

## 10. Tests required

`supabase/tests/pmt_no_duplicate_property_name_contracts.sql`, with the four assertions in
Step 5 — including the forward-looking one that no future `pmt_*` table reintroduces a
property-name column, and the one that pins `load_pmt_capture_chunk` to the duplicate-free
body. Plus the Paramount loader's own test file updated in Step 3. The whole
`supabase/tests` suite must stay green.

---

## 11. Constraints, standing rules, and gotchas in force

- **All structure changes are authored here in `u2giants/shared-db`, branch + PR.** Claude
  merges its own PRs. Never write a shared-DB migration from an app repo.
- **Worktrees only** — no session works directly in the shared `shared-db` checkout
  (`AGENTS.md` §2.1-W).
- **The Supabase MCP is READ-ONLY** and may be bound to production; it cannot run DDL/DML.
- **Prove which database you are pointed at before any write and quote the proof**
  (`AGENTS.md` §4.2).
- **Never reuse a migration version number.**
- **Never drop a column the loader still writes** — the whole reason this is three migrations.
  And "the loader" includes `plm.load_pmt_capture_chunk` itself: a stale function body names
  the columns at CALL time. The function exists in THREE migration files
  (`20260810020000`, `20260810090000`, `20260811030000`); **always copy the LIVE body** via
  `pg_get_functiondef`, never an older file's, and never edit an applied migration.
- **Serialize against [plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md).**
  It edits the same client tool, the same test file, and replaces the same function. Two
  in-flight function replacements that each omit the other's changes produce a silent
  regression at the second merge.
- **`supabase/tests against an ephemeral database` is NOT a required check.** Read it anyway.
- **`Tools offline tests` IS a required check** and auto-globs `tools/*.test.mjs`, so the
  Step 3 test edits are enforced on every PR.
- **`property_source_id` is `text`** on every `pmt_*` table since `20260811030000` — do not
  write numeric literals or casts against it.
- **Workflow argument traps:** `review_artifact_digest` must be `sha256:<64 hex>` (the log
  prints bare hex); `reviewed_main_sha` must be the LIVE main SHA from
  `gh api repos/u2giants/shared-db/commits/main --jq .sha`, not a stale local `origin/main`.
- **Preview is behind production** (#901) — apply by explicit version, re-verify on production.
- **No band-aids, no silent failures.**
- **Licensed source data never leaves its approved private repo.** Do not paste Paramount
  property names into issues, PRs, or commit messages.
- **This repo is PUBLIC with a PII forward guard** — no personal emails; refer to people by
  `app.profile` UUID.
- **Whoever executes a step updates this file's STATUS table with an artifact**, never a bare
  number (`AGENTS.md` §4.3).

---

## 12. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | `qsllyeztdwjgirsysgai` | Read via Supabase MCP; write via workflow / Management API |
| Shared Supabase PREVIEW | `rjyboqwcdzcocqgmsyel` | A Supabase *branch*; absent from `supabase projects list` |
| Supabase Management API token | 1Password `vibe_coding` → "Supabase CLI Personal Access Token", field `credential` | For writes the MCP cannot do |
| Paramount portal | `stillsarchive.paramount.com` | Credentials in 1Password `vibe_coding`; see the `paramount-creative-library-scrape` skill |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills in `skills/shared/` |

**Secrets** via `op_run` with `op://` references only, never pasted values, and **serialized** —
never fan out 1Password reads in parallel.

**Applying a migration:**

```bash
gh workflow run "Shared Supabase Migrations" --repo u2giants/shared-db --ref main -f target=preview -f mode=apply -f preview_allowlist=<version>
```

then production dry-run → `Production Apply Review Evidence` (live main SHA) → production apply
with `review_artifact_digest=sha256:<hex>`.

---

## 13. Definition of done, risks, open questions

**Done means:**

- [ ] Step 1's written finding recorded for both columns, with evidence.
- [ ] Columns deprecated (or renamed, if Step 1 says distinct fact).
- [ ] BOTH writers stopped — client tool mappings deleted AND `load_pmt_capture_chunk`
      replaced without the two columns; loader tests updated and passing.
- [ ] All readers repointed (expected: none found); `idx_pmt_atp_name` dropped; repo grep clean.
- [ ] New contract test added, including the reintroduction guard and the function-body guard;
      `supabase/tests` read and green.
- [ ] Pre-drop gate run on both environments; columns dropped, and a fresh capture completes
      on preview afterwards.
- [ ] Skill updated in both copies; `ai-devops` pushed.
- [ ] Committed, pushed, PR merged, CI green, production apply verified by reading
      `supabase_migrations.schema_migrations`.
- [ ] STATUS table updated with artifacts; handoff updated.

**Risks and rollback.**

- *A reader outside this repo consumes the column.* The repo is mirrored into consumer repos, so
  grep `poppim-web`, `popcrm-web`, `popdam3` for `paramount_property_name` before Step 6.
  (In-repo readers were verified absent at `9249140` — §5a — but the mirror check covers apps
  whose code is not here.) Rollback before the drop is trivial; after the drop it is a re-add
  plus backfill from the join.
- *Step 1 is decided from the column name instead of the builder.* This is the real risk. The
  step names the private builder and the per-capture sampling as the decisive evidence for
  that reason.
- *Step 6 drops the columns while a stale `load_pmt_capture_chunk` body is live.* PL/pgSQL
  resolves the INSERT-list references at CALL time, so nothing fails at `DROP` — the first
  failure is the next capture, mid-load. Mitigated twice: Step 3 replaces the function, and
  Step 6's pre-drop gate proves the live body is the new one on BOTH environments.
- *Dropping while a capture is mid-flight.* Apply Step 6 when no capture is running; check
  `select status, count(*) from plm.pmt_capture group by 1;` for `loading` / `validating`.

**Open questions.**

1. **Is `pmt_property_capture_log.property_name` the searched term or the property name?**
   Settled by Step 1. Highest-stakes question in this plan. Repo-side evidence (§5a) leans
   duplicate — the row's "search" is an exact selection carrying an FK'd source id, and the
   loader fixture reuses one string for all three names — but the private builder is the
   deciding witness.
2. **Does `paramount_property_name` ever legitimately differ from the property record's name?**
   Same evidence path. If yes → rename to `rights_list_display_name` and keep. (Note the
   rename-name rule in Step 2: the new name must not end in `property_name`, or Step 5's
   reintroduction guard will reject it.)
3. **Should `plm.pmt_collection.paramount_term` be folded in?** It holds one distinct value
   across 1,928 rows — a constant stored per row. Out of scope here; open a follow-up issue.

---

## Self-audit (required by the implementation-plan-writer standard)

**1. Could a brand-new session execute this without asking anything?** Yes. §2 defines the
application, the vocabulary, and the capture-versioned model for someone who has never seen the
repo. §3 gives the exact columns, their constraints, the verification query proving zero
mismatches today, and the concrete mechanism by which they will diverge. §5 gives the current
state including constraint names, row counts, the index name, and the precedent migration to
model Step 2 on. §9's seven steps each name files or catalog queries and end in a verification
gate. §12 names every credential by location.

**2. Does it carry every piece of reasoning, including what was ruled out?** Yes. §7 records five
rejected approaches, including the two that a hurried implementer would otherwise take: adding a
CHECK to police the copies, and dropping the columns in one migration (which would break the next
capture — the exact trap `20260814050000` avoided for NBCU). §6 records the root cause and, more
importantly, the reason Finding 2 may not be a defect at all. §4 records that
`content_type`/`mime_type` was investigated and cleared with the measurement (24 distinct pairs),
so nobody re-opens it.

**3. Is the goal clear enough to support a correct judgment call?** Yes. §1 states it in business
terms, and states explicitly that if Step 1 finds a distinct fact, renaming rather than dropping
is the correct outcome — the judgment call is anticipated and its right answer is pre-authorised.
§4's out-of-scope list keeps the work from expanding into the NBCU equivalent or the sibling plans.

**Gap found during the audit and fixed:** the first draft treated both columns as duplicates and
went straight to deprecation. `pmt_property_capture_log`'s table comment describes a search log,
which makes a search-term interpretation plausible; Step 1 was added as a blocking evidence step
ahead of any migration, and the possibility is now carried in §1, §6, §8 and §13.

---

## Self-audit of the 2026-08-14 revision (codex, plan implementation editor)

**What was verified, and how.** Every repo-verifiable claim was re-read out of the tree at
`main` tip `9249140`: the DDL, CHECK, index and FK names in `20260810020000`; the bigint→text
re-typing and FK rebuild in `20260811030000`; all three copies of the `load_pmt_capture_chunk`
body; `buildPayloads` in `tools/sync-paramount-creative-library.mjs` and its test fixture; the
NBCU precedent `20260814050000` in full; the immutability triggers and the validation function
for column references; a repo-wide search for readers of either copy; the CI wiring in
`tools-offline-tests.yml` and `database-contract-tests.yml`; and the Paramount loader's test
suite, executed (`node --test tools/sync-paramount-creative-library.test.mjs` — 53 pass, 0
fail). Live-database claims (row counts, zero mismatches, current catalog state) were NOT
re-derived — no database was contacted — and are kept as dated snapshots with re-derive
instructions, per `AGENTS.md` §4.3.

**Gap found during this revision and fixed:** the first draft's Step 3 named only the
client-side tool. The database-side `plm.load_pmt_capture_chunk` INSERTs both columns by name,
so Step 6 would have left a live function that breaks the next capture at CALL time — the exact
failure class the plan's own §7 rejects. The revision makes the function replacement an
explicit part of Step 3, adds a pre-drop gate to Step 6 that proves the live body is the new
one (written so it does not false-positive on the `pmt_property` entity branch's legitimate
`property_name`), and adds the matching contract-test assertion to Step 5. It also promotes
the NBCU precedent's drift-refusal guard from "read that migration" to a required part of
Step 2, and records the verified zero-readers finding so Step 4 starts from knowledge rather
than a search.

**What this revision deliberately did NOT do:** settle Step 1. The repo-side lineage is
recorded as evidence, but the decisive witness — the private builder that writes the three
capture CSVs — lives in `u2giants/licensor-source-data` and was not read. Pre-deciding
"duplicate" from the fixture alone would repeat the plan's own named risk: judging from the
name (or the fixture) instead of the source.
