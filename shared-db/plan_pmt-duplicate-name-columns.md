# Implementation plan — remove the two duplicated property-name columns in the Paramount landing schema

**Written:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Repo:** `u2giants/shared-db` · **Target branch:** a new branch off `main`, PR to `main`
**Handoff that owns this plan:** [HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md](HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md)
**Sibling plans:** [plan_curated-decisions-survive-syncs.md](plan_curated-decisions-survive-syncs.md) ·
[plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md)

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 1 | Settle intent: duplicate attribute vs. distinct fact (both columns) | ⬜ open | — |
| 2 | Migration A — drop `NOT NULL`, add deprecation comments | ⬜ open | — |
| 3 | Stop the loader writing them (`tools/sync-paramount-*`) | ⬜ open | — |
| 4 | Migration B — replace reads with joins; drop the two name indexes | ⬜ open | — |
| 5 | Tests in `supabase/tests/` | ⬜ open | — |
| 6 | Migration C — drop the columns | ⬜ open | — |
| 7 | Skill + docs update | ⬜ open | — |

**A fresh session starts at Step 1.** Step 1 is a genuine fork: one of the two columns may not
be a duplicate at all, and getting that wrong deletes a real fact.

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

**In scope.** The two named columns, the loader that writes them, the readers that read them,
the `idx_pmt_atp_name` index, the tests, and the Paramount scrape skill.

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

---

## 5. Current state of the code

- **Both columns exist on production and are `NOT NULL`**, each with a non-empty CHECK:
  - `pmt_authorized_title_property_name_chk CHECK (btrim(paramount_property_name) <> '')`
  - `pmt_pcl_name_chk CHECK (btrim(property_name) <> '')`
- **Both tables have the FK that makes the copy redundant:**
  - `pmt_authorized_title_property_property_fkey FOREIGN KEY (capture_id, property_source_id)
    REFERENCES plm.pmt_property(capture_id, property_source_id) ON DELETE RESTRICT`
  - `pmt_pcl_property_fkey FOREIGN KEY (capture_id, property_source_id)
    REFERENCES plm.pmt_property(capture_id, property_source_id) ON DELETE RESTRICT`
- **Row counts (all captures, 2026-08-14):** `pmt_authorized_title_property` 138,
  `pmt_property_capture_log` 138. Small tables; this is not a performance-sensitive change.
- **Index to remove with the column:** `idx_pmt_atp_name ON plm.pmt_authorized_title_property
  USING btree (paramount_property_name)`. `pmt_property_capture_log` has no index on its name
  column.
- **The loader.** `plm.load_pmt_capture_chunk` is the database-side load function; find the
  client-side Paramount tool with `ls tools/ | grep -i paramount`. Both must stop writing these
  columns before Step 6. Do not assume there is only one writer — check both.
- **Precedent for the exact sequence this plan follows:** migration
  `20260814050000_nbcu_link_labels_deprecated.sql` dropped `NOT NULL` on the equivalent NBCU
  columns and **deliberately did not drop them**, because dropping while the loader still wrote
  them would break the next capture. Read that migration before writing Step 2.
- **Migration numbering.** `supabase/migrations/` is flat, `<UTC timestamp>_<slug>.sql`. Latest
  merged as of 2026-08-14 is `20260814060000_opa_link_ensure_entities.sql`. Run
  `ls supabase/migrations | tail -3` and continue after whatever you find. **Never reuse a
  version number** — Supabase keys on the version alone and a duplicate silently skips one.

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
- **How, in order:**
  1. Read the loader. Find it with `ls tools/ | grep -i paramount` and
     `select pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc);`. Identify which
     payload field each column is written from. **This is the decisive evidence.**
  2. Sample the values against the property name:
     ```sql
     select l.property_source_id, l.property_name as log_name, p.property_name as entity_name,
            a.paramount_property_name as rights_list_name
     from plm.pmt_property_capture_log l
     join plm.pmt_property p using (capture_id, property_source_id)
     left join plm.pmt_authorized_title_property a using (capture_id, property_source_id)
     limit 50;
     ```
  3. Read `plm.pmt_property_capture_log`'s and `plm.pmt_authorized_title_property`'s table
     comments in full (`obj_description(...::regclass)`) — they are unusually detailed in this
     schema and may state the intent outright.
- **Judgment criteria:** if the loader writes the column from a *search-term* or *rights-list
  display* field rather than from the property record, it is a distinct fact → **rename and
  document, do not drop**. If it writes it from the same property record that feeds
  `pmt_property.property_name`, it is a duplicate → drop.
- **Dependencies:** none.
- **You'll know it worked when:** a one-paragraph written finding per column exists in this
  file's STATUS evidence column, citing the loader line or the sampled values, and stating
  "duplicate → drop" or "distinct fact → rename to `<name>`".

#### Step 2. Migration A — deprecate

- **File:** `supabase/migrations/<next timestamp>_pmt_duplicate_name_columns_deprecated.sql`.
- **What:** for each column judged a duplicate in Step 1:
  - `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL;`
  - `COMMENT ON COLUMN ... IS 'DEPRECATED 2026-08-__ — duplicates plm.pmt_property.property_name.
    Join through the existing foreign key on (capture_id, property_source_id) instead. The loader
    stops writing it in <step 3 commit>; the column is dropped in <step 6 migration>. See
    plan_pmt-duplicate-name-columns.md.'`
  - Leave the `btrim(...) <> ''` CHECKs in place — they still hold for non-null values.
  For any column judged a distinct fact, do the rename here instead
  (`ALTER TABLE ... RENAME COLUMN ... TO ...`) plus a comment stating what the fact is, and
  remove it from the remaining steps.
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

#### Step 3. Stop the loader writing them

- **What:** edit the Paramount loader(s) identified in Step 1 to stop sending these columns.
- **Dependencies:** Step 2 must be applied to production first, or the loader breaks on the
  `NOT NULL`.
- **Tests:** the loader has a test file next to it (the Warner loader pattern is
  `tools/sync-warner-starlabs.mjs` + `tools/sync-warner-starlabs.test.mjs`); update the
  Paramount equivalent so it asserts the columns are no longer written.
- **You'll know it worked when:** a capture run on preview completes with both columns NULL on
  all new rows, and the loader's own test suite passes.

#### Step 4. Migration B — move readers to the join, drop the name index

- **What:** find every reader and repoint it.
  ```sql
  select n.nspname, p.proname from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where pg_get_functiondef(p.oid) ilike '%paramount_property_name%'
     or (pg_get_functiondef(p.oid) ilike '%pmt_property_capture_log%'
         and pg_get_functiondef(p.oid) ilike '%property_name%');

  select schemaname, viewname from pg_views
  where definition ilike '%paramount_property_name%';
  ```
  Also grep the repo: `rg -n "paramount_property_name" --glob '!supabase/migrations/*'`.
  Repoint each to join `plm.pmt_property` on `(capture_id, property_source_id)`.
- **Then** `DROP INDEX plm.idx_pmt_atp_name;`.
- **You'll know it worked when:** both catalog queries and the repo grep return nothing outside
  `supabase/migrations/` and this plan, and the index is gone from `pg_indexes`.

#### Step 5. Tests

Add `supabase/tests/pmt_no_duplicate_property_name_contracts.sql`:

- Assert neither `plm.pmt_authorized_title_property` nor `plm.pmt_property_capture_log` has a
  column whose value duplicates `plm.pmt_property.property_name` — after Step 6 this is a
  catalog assertion that the columns do not exist; before Step 6, assert they are nullable and
  that no reader references them.
- Assert the property name is reachable by join from both tables (the replacement path works).
- **Regression guard, the important one:** assert that no `plm.pmt_*` table other than
  `pmt_property` has a column named `property_name` or `%_property_name`. This is what stops
  the defect being reintroduced by the next table someone adds.

**Existing suites that must stay green:** the whole `supabase/tests` job. Note that
`supabase/tests against an ephemeral database` is **not** a required check — read it before
merging anyway; PR #954 merged on 2026-08-14 while it was red.

#### Step 6. Migration C — drop the columns

- **Dependencies:** Steps 2–5 done, and the loader change from Step 3 **deployed and proven by
  a real capture**, not merely merged.
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

`supabase/tests/pmt_no_duplicate_property_name_contracts.sql`, with the three assertions in
Step 5 — including the forward-looking one that no future `pmt_*` table reintroduces a
property-name column. Plus the Paramount loader's own test file updated in Step 3. The whole
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
- **`supabase/tests against an ephemeral database` is NOT a required check.** Read it anyway.
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
- [ ] Loader stopped writing them; loader tests updated and passing.
- [ ] All readers repointed; `idx_pmt_atp_name` dropped; repo grep clean.
- [ ] New contract test added, including the reintroduction guard; `supabase/tests` read and green.
- [ ] Columns dropped, and a fresh capture completes on preview afterwards.
- [ ] Skill updated in both copies; `ai-devops` pushed.
- [ ] Committed, pushed, PR merged, CI green, production apply verified by reading
      `supabase_migrations.schema_migrations`.
- [ ] STATUS table updated with artifacts; handoff updated.

**Risks and rollback.**

- *A reader outside this repo consumes the column.* The repo is mirrored into consumer repos, so
  grep `poppim-web`, `popcrm-web`, `popdam3` for `paramount_property_name` before Step 6.
  Rollback before the drop is trivial; after the drop it is a re-add plus backfill from the join.
- *Step 1 is decided from the column name instead of the loader.* This is the real risk. The
  step names the loader as the decisive evidence for that reason.
- *Dropping while a capture is mid-flight.* Apply Step 6 when no capture is running; check
  `select status, count(*) from plm.pmt_capture group by 1;` for `loading` / `validating`.

**Open questions.**

1. **Is `pmt_property_capture_log.property_name` the searched term or the property name?**
   Settled by Step 1. Highest-stakes question in this plan.
2. **Does `paramount_property_name` ever legitimately differ from the property record's name?**
   Same evidence path. If yes → rename to `rights_list_display_name` and keep.
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
