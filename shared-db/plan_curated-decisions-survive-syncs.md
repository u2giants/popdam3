# Implementation plan — Paramount/NBCU curated decisions must survive every sync

**Written:** 2026-08-14 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Repo:** `u2giants/shared-db` · **Target branch:** a new branch off `main`, PR to `main`
**Handoff that owns this plan:** [HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md](HANDOFF.d/2026-08-14T1700Z-al8960ofc-claude-curation-persistence-plans.md)
**Sibling plans:** [plan_pmt-duplicate-name-columns.md](plan_pmt-duplicate-name-columns.md) ·
[plan_pmt-metadata-element-normalization.md](plan_pmt-metadata-element-normalization.md)

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Keep the owner-held `20260802170000` bundle out of this work | ✅ done | `AGENTS.md` §6.5 requires `20260802170000`, `20260802171000`, and the FR-removal migration to move together; #963 has no production authority. |
| 1 | Inventory + writer census; fail-closed design agreed | ✅ done | `rg` census at `origin/main` `8553b49`: Paramount and NBCU loaders insert only unresolved/null defaults; no runtime writer updates the six legacy resolution column sets. Durable writes will use one command; legacy columns become fail-closed. |
| 2 | Migration A — create `plm.source_resolution` (capture-independent) | ✅ implemented | migration `20260814224937`, claim #1033 |
| 3 | Migration B — backfill from the 6 capture-scoped tables | ✅ implemented | PR #1018, deterministic backfill |
| 4 | Migration C — views that read resolution from the new home | ✅ implemented | PR #1018, established Paramount views plus `api.source_resolution` |
| 5 | Migration D — guards on six capture-scoped tables | ✅ implemented | PR #1018, six named triggers |
| 6 | Migration E — deprecate the in-table resolution columns | ✅ implemented | PR #1018, comments and guards |
| 7 | Tests in `supabase/tests/` | 🟡 verification pending | PR #1018 checks |
| 8 | Docs: `AGENTS.md` §6.4 cross-reference and consolidation aim | ✅ implemented | PR #1018 |

**A fresh session starts at Step 1.** Step 0 is deliberately excluded. `AGENTS.md` §6.5
forbids applying `20260802170000` alone, and this issue has no production authority.

---

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** when a person at POP Creations makes a decision in this
database — "this Paramount title is the same thing as our FROZEN", "this character belongs
here", "this licensor is inactive" — that decision must still be there tomorrow, and next
month, no matter how many times we re-pull data from ColdLion, DesignFlow, or any of the four
licensor portals. A refresh may add things we do not have. It may never undo a human decision.

Today that is not true, and it is not true in two different ways:

1. **The obvious way** — an importer overwrites a curated value. This is already ruled on
   (`AGENTS.md` §6.4, Albert Hazan, 2026-08-03) and there is a merged corrective migration
   that has never been applied to production. See Step 0.
2. **The quiet way, which nobody has addressed** — the importer overwrites nothing, but the
   curated decision is attached to a row that the next capture replaces. Nothing is
   overwritten; the decision is simply *bypassed*. An audit looking for overwrites sees a
   clean bill of health while the mapping is gone. This is the defect found in the Paramount
   audit on 2026-08-14 and it affects six tables across two licensors.

**If any step in this plan conflicts with that goal, the goal wins — stop and flag it.**
Specifically: if you find a cheaper way to make decisions durable than the one described here,
take it, and write down why. If you find that a step would make decisions *less* durable in
some edge case, do not implement that step; raise it.

The owner has stated this requirement repeatedly and considers it settled and non-negotiable:
"the database / structure has to be set up so changes are NOT overwritten by refreshes/syncs.
not a DesignFlow refresh or a Coldlion API sync. our changes need to be persistent"
(Albert Hazan, 2026-08-14). Do not treat it as a preference or design it away.

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for a **shared Supabase (PostgreSQL 17)
database**, project ref `qsllyeztdwjgirsysgai`, used by several POP Creations applications:
PM/PIM (`poppim-web`), CRM (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*`
PLM repos. The repo's whole contents are mirrored read-only into a `shared-db/` folder inside
every consumer repo on each push to `main`.

**Business vocabulary you need.** POP Creations sells licensed merchandise. A **licensor** is
the rights holder (Disney, Warner Bros., Paramount, NBCUniversal). A **property** is a title
or brand under a licensor (FROZEN, BATMAN). A **character** belongs to one or more properties.
A **style guide** is a pack of approved artwork for a property; Paramount's portal calls the
same concept a **Collection**. **ColdLion** is the ERP that runs the actual business.
**DesignFlow** is the PLM system. Both are internal bookkeeping systems. The licensor portals
are the authority on what a property actually *is*.

**Schemas that matter here.**

- `core.*` — the canonical master data. `core.licensor`, `core.property`, `core.character`,
  `core.customer`, `core.factory`. This is what humans curate. It is the thing being protected.
- `plm.*` — landing tables. Raw data captured from the licensor portals and mirrored from
  ColdLion, kept separate from `core.*` on purpose. Prefixes: `opa_*` and `dcp_*` (Disney),
  `nbcu_*` (NBCUniversal), `pmt_*` (Paramount), `wb_*` (Warner Bros.), `erp_*` (ColdLion).
- `api.*` — the read surface the applications call.
- `app.*` — profiles, roles, access gates.

**Where it runs.** There is one production project (`qsllyeztdwjgirsysgai`) and one preview
branch (`rjyboqwcdzcocqgmsyel`). Migrations are applied through a GitHub Actions workflow, not
by hand — see §12.

---

## 3. What triggered this work

On 2026-08-14 an audit of the Paramount landing schema (`plm.pmt_*`) was run — the audit the
previous session's handoff asked for, at
[HANDOFF.d/2026-08-14T1346Z-al8960ofc-claude-scrape-schema-normalization.md](HANDOFF.d/2026-08-14T1346Z-al8960ofc-claude-scrape-schema-normalization.md) §6 step 4.
The audit was performed by Qwen 3.8 Max against a schema dump, and its four principal findings
were then verified directly against production.

Its top finding was not a normal-form violation. It was this: **`plm.pmt_property` and
`plm.pmt_character` are keyed by `(capture_id, <source_id>)`.** Every scrape inserts a
completely new set of rows. The resolution columns on those new rows are defined
`resolution_status text NOT NULL DEFAULT 'unresolved'` with `core_property_id` /
`core_character_id` NULL. Nothing carries a prior resolution forward.

**Verified, not assumed:**

```sql
-- The loader never touches the resolution columns.
select (pg_get_functiondef(p.oid) ilike '%resolution_status%') as mentions_resolution,
       (pg_get_functiondef(p.oid) ilike '%core_property_id%')  as mentions_core_ptr,
       p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'plm'
  and p.proname in ('load_pmt_capture_chunk','validate_pmt_capture',
                    'pmt_reject_completed_source_field_change');
-- load_pmt_capture_chunk    -> false, false
-- validate_pmt_capture      -> false, false
```

The serving rule (only a `status='complete'`, `capture_kind='full'` capture is served) then
points every reader at the newest capture, where the mapping is `unresolved`.

**Reproduction, once anybody starts mapping** (nobody has yet — all 254 `pmt_property` rows
across all four captures are `unresolved`, which is why this has never bitten):

1. Set `plm.pmt_property.core_property_id` and `resolution_status='matched'` for some property
   in the current capture.
2. Run a new Paramount capture to `complete` / `full`.
3. Read the property back through the "latest capture" rule. It is `unresolved` again, and no
   `UPDATE` statement ever touched the curated row.

**Scope of the same defect beyond Paramount.** Measured on production 2026-08-14 — six tables
carry resolution state on a capture-scoped primary key:

| Table | Primary key | Licensor |
|---|---|---|
| `plm.pmt_property` | `(capture_id, property_source_id)` | Paramount |
| `plm.pmt_character` | `(capture_id, character_source_id)` | Paramount |
| `plm.nbcu_property` | `(capture_id, property_key)` | NBCUniversal |
| `plm.nbcu_character` | `(capture_id, character_key)` | NBCUniversal |
| `plm.nbcu_style_guide` | `(capture_id, style_guide_key)` | NBCUniversal |
| `plm.nbcu_asset` | `(capture_id, asset_source_key)` | NBCUniversal |

Disney (`opa_*`, `dcp_*`, and the `marvel_/lucasfilm_/twentieth_century_` studio splits) and
Warner (`wb_*`) key their entity tables on the **source id alone**, so their rows survive a
refresh structurally. They are exposed to the *other* half of the problem instead — a loader
upsert that clobbers the resolution columns. Issue #999 owns that separate writer-by-writer
hardening; Step 5 here protects only the six capture-scoped Paramount/NBCU tables.

---

## 4. Scope — in and out

**In scope.**

- Documenting, but not applying, the owner-held `20260802170000` bundle (Step 0).
- A capture-independent home for source→canonical resolution decisions, covering all six
  capture-scoped tables above.
- A structural guard on the six proven capture-scoped Paramount/NBCU tables that refuses
  loaders from writing their deprecated resolution fields. Source-ID-keyed Disney, Warner,
  OPA and ColdLion resolution contracts require a separate writer-by-writer rollout because
  several of those functions legitimately write workflow state today; issue #999 tracks that
  broader hardening without pretending an untested global trigger is safe.
- Backfill of existing resolution state (currently zero rows resolved in `pmt_*`; verify
  `nbcu_*` before assuming the same).
- Tests and shared-db docs updated so loaders are told the new contract. Portable scrape-skill
  updates remain separate from this schema pull request.

**NOT in scope — do not do these in this plan.**

- Actually resolving any Paramount/NBCU/Disney/Warner property or character to `core.*`. That
  is the master-data consolidation programme, tracked separately in
  `docs/core-master-data-consolidation-aim.md` §7. This plan makes resolution *durable*; it
  does not perform any.
- The two duplicated property-name columns and the metadata element descriptors — those are
  the sibling plans, deliberately separate so each can ship alone.
- Warner's retired legacy tables (`plm.wb_property_character`, `plm.wb_character`,
  `plm.wb_franchise_property` and their three legacy functions). That is the Warner
  workstream's own cleanup; the prompt for it is in the previous handoff §6 step 1.
- Any change to `core.*` table structure. Resolution pointers read `core.*`; they never write
  it, and `AGENTS.md` forbids an import creating, renaming, merging, re-parenting,
  deactivating or deleting a canonical record.
- The `dflow.*` Supabase mirror (seven weeks stale as of 2026-08-13) — not touched here.

---

## 5. Current state of the code

**Everything below is committed and pushed on `main` unless stated.**

- `supabase/migrations/` — flat directory, one file per migration, named
  `<UTC timestamp>_<slug>.sql`. Most recent eight, for the naming pattern:

  ```
  20260813231000_wb_normalized_loaders_and_capture.sql
  20260814000000_licensing_manager_gate.sql
  20260814010000_dcp_studio_separated_landing.sql
  20260814020000_dcp_studio_separated_loaders.sql
  20260814030000_source_capture_inventory.sql
  20260814040000_opa_property_character_normalize.sql
  20260814050000_nbcu_link_labels_deprecated.sql
  20260814060000_opa_link_ensure_entities.sql
  ```

  The implemented migration is `20260814224937`. **Never reuse a version number** — Supabase
  keys on the version alone, so a duplicate makes one migration silently skip.

- **`20260802170000_plm_import_preserve_curated_licensor_property_status.sql` is merged to
  `main` and NOT applied to production.** Verified 2026-08-14:

  ```sql
  select version, name from supabase_migrations.schema_migrations
  where version in ('20260802170000','20260814050000','20260814060000');
  -- returns only 20260814050000 and 20260814060000
  ```

  This is the corrective migration for the §6.4 violation described in `AGENTS.md` around
  line 1422. Until it is applied, `plm.import_master_data(jsonb, jsonb)` on production
  force-sets `core.property.licensor_id`, `core.licensor.status='active'` and
  `core.property.status='active'` on **every matched row of every re-pull**. Read the
  migration file before applying it; do not assume its contents from this description.

- **The resolution columns as they exist today.** Two shapes are in use across `plm`, and you
  must handle both:

  - Shape A (status-based, 5 columns): `core_<entity>_id`, `resolution_status`,
    `resolution_reason`, `resolved_at`, `resolved_by`. Used by `pmt_property`,
    `pmt_character`, `nbcu_property`, `nbcu_character`, `nbcu_style_guide`, `nbcu_asset`,
    `opa_property`, `opa_character`, `opa_property_character`, `dcp_portal_tile`,
    `dcp_style_guide`, `erp_licensor`, `erp_property`, `wb_property_character_normalized`,
    and the studio-split `*_dcp_portal_tile` / `*_dcp_style_guide` tables.
  - Shape B (note-based, 4 columns): `core_<entity>_id`, `resolved_at`, `resolved_by`,
    `resolution_note` — no `resolution_status`. Used by `dcp_property`, `dcp_character` and
    their `marvel_`, `lucasfilm_`, `twentieth_century_` variants.

  Shape A carries a coherence CHECK that Shape B does not, e.g. on `pmt_property`:
  `CHECK ((resolution_status = 'matched') = (core_property_id IS NOT NULL))`. Preserve that
  invariant in the new home.

- **`plm.pmt_property` / `plm.pmt_character` resolution state today: all `unresolved`.**
  Verified 2026-08-14, all four captures, 254 property rows and 228 character rows. This is
  why the migration is cheap right now and expensive later — there is nothing to lose yet.
  **Re-verify before you start; do not trust this number, re-run the query.**

- **`plm.opa_link_ensure_entities()`** (migration `20260814060000`, applied) is a worked
  example of the pattern Step 5 generalizes: a `BEFORE INSERT OR UPDATE` trigger whose upsert
  is deliberately **column-scoped** —
  `on conflict (licensed_property_id) do update set property_name = excluded.property_name,
  last_seen_at = now(), updated_at = now()` — so it cannot touch resolution columns even
  though it writes to a table that has them. Read `supabase/migrations/20260814060000_opa_link_ensure_entities.sql`
  in full before writing Step 5; its comment block explains why a trigger beat editing the loader.

- **`api.source_capture_inventory`** (migration `20260814030000`, applied) gives live per-source
  row counts straight from the catalog. Use it instead of guessing which table a loader writes:

  ```sql
  select * from api.source_capture_inventory order by source_system, row_count desc;
  ```

- **The Warner loader EXISTS**, contrary to what issue #900 and the previous handoff say:
  `tools/sync-warner-starlabs.mjs` (36,746 bytes) with `tools/sync-warner-starlabs.test.mjs`
  alongside, committed in `696dc42` ("the missing Warner loader") and revised by `fe3a888`
  (#929). What is true is narrower: **Warner has landed zero rows.** Correct issue #900 rather
  than repeating the stale claim.

- `supabase/tests/` — a flat directory of `*_contracts.sql` files run by CI. **The job
  `supabase/tests against an ephemeral database` is NOT in the required-checks list.** It
  caught a production regression on 2026-08-14 and PR #954 merged anyway while it was red.
  **Always read that job's result before merging, even when GitHub lets you merge.**

---

## 6. Key findings and root cause

**6.1 The root cause is that a decision is attached to the wrong thing.**

A resolution — "Paramount property `12345` is our `core.property` X" — is a fact about the
*source identity* `12345`. It is not a fact about the *observation* of `12345` in capture
`51cf81d5`. Storing it on the capture-scoped row makes its lifetime the capture's lifetime.
Every capture-versioned design that puts curated state on the versioned row has this bug,
regardless of how careful the loader is.

That is why the fix is not "make the loader copy values forward". Carry-forward inside the
loader is a band-aid: it works until someone writes a second loader, a manual backfill, or an
external import path. Move the decision to a table whose key is the source identity, and the
question stops existing.

**6.2 There are two distinct failure modes and both need closing.**

| | Capture-scoped tables (6) | Source-id-keyed tables (the rest) |
|---|---|---|
| Failure | New capture ⇒ fresh `unresolved` row; decision bypassed | Loader upsert overwrites the resolution columns |
| Visible as an overwrite? | **No** — nothing is UPDATEd | Yes |
| Fixed by | Steps 2–4 (new home) | Step 5 (guard trigger) |

Step 5 is the one that makes this general and future-proof, and it is the part the owner is
actually asking for. Steps 2–4 fix the six tables that are broken today; Step 5 stops the
seventh from ever being written.

**6.3 `AGENTS.md` §6.4 already states the required behaviour and already names the missing
mechanism.** Lines 1399–1405, verbatim in part: absence is not a licence; "the 'deliberately
set' state must be **recorded**, not inferred from the current value: a value that happens to
equal the default is not evidence that nobody chose it." And lines 1416–1420: "No per-field
curation record exists in this database, and no importer can currently tell curated from
untouched."

**This plan builds the record that §6.4 says is missing.** That framing matters: you are not
inventing policy, you are implementing a ruling made on 2026-08-03 that has been unimplemented
for eleven days and is currently violated in production.

**6.4 The measured facts, so nobody re-derives them.** All read from production 2026-08-14.

- Four Paramount captures exist: two `failed`, two `complete`, all four retained with all rows.
- The whole-table counts everyone quotes are **sums across all four captures, including the
  failed ones**. `plm.pmt_asset` = 119,304 total; the current good capture (`51cf81d5`) holds
  **33,862**. Same trap for properties (187 vs 67), characters (166 vs 62), collections
  (1,928 vs 538). Arithmetic checks out exactly: 25,790 + 25,790 + 33,862 + 33,862 = 119,304.
- In the latest complete capture: 0 characters appear under more than one property in
  `pmt_property_character`, but **17** co-occur with more than one property via asset
  metadata. The link table is correctly refusing to manufacture pairs from co-occurrence.
- 5 duplicate character display names, 0 duplicate property display names — harmless, because
  identity is the source id everywhere.

---

## 7. Approaches considered and REJECTED, and why

1. **Make each loader copy resolutions forward from the previous capture. REJECTED.**
   It is a per-writer rule, and per-writer rules are exactly what failed on 2026-08-14 when
   `plm.sync_opa_property_character()` was broken by foreign keys it knew nothing about. There
   are already at least four loader entry points across four licensors plus manual/backfill
   paths; each new one is a fresh chance to forget. The trigger-not-loader reasoning is
   written out in the comment block of `20260814060000_opa_link_ensure_entities.sql` — read it.

2. **A `curated boolean` flag column on each landing table. REJECTED.**
   It records *that* something was curated but not *what* was decided, so it still dies with
   the capture-scoped row. It also has to be added to ~47 tables and kept in sync by hand.

3. **Add a marker before each known re-seed** (the recommendation in the previous session's
   handoff §0 item 5, for the COCO ruling). **REJECTED by the owner on 2026-08-14**: "I went
   over this 1000 times ... our changes need to be persistent." A per-sync reminder is a
   band-aid under the standing no-band-aids rule; the structure must carry the guarantee.

4. **Drop `capture_id` from the six primary keys so entity rows are shared across captures.
   REJECTED.**
   Capture-versioning is deliberate and valuable — `plm.pmt_capture`'s comment states every
   completed capture is retained permanently and a refresh never overwrites an older one, and
   the whole finalization gate (`pmt_capture_expectation`, `pmt_capture_batch` SHA-256 ID-set
   equality, `pmt_shrink_override` two-person rule) depends on it. Removing capture scope
   would destroy an audit trail to fix an unrelated problem. Keep the versioning; move only
   the curated decision out of it.

5. **Put resolution pointers directly on `core.*`. REJECTED.**
   `core.*` is the canonical model; it must not carry per-source scrape plumbing, and
   `AGENTS.md` forbids an import mutating a canonical row at all. The pointer must live on the
   landing side, pointing inward.

6. **Do nothing because no rows are resolved yet. REJECTED.**
   That is the argument that makes it expensive. Every hour of mapping done before the fix is
   an hour that has to be redone or migrated. The owner's instruction on 2026-08-14 was
   explicit: "if it's possible for a problem to happen, address it now."

---

## 8. Design decisions already made, and their reasoning

**LOCKED — do not relitigate.**

| Decision | Date | Reasoning |
|---|---|---|
| Curated/owner decisions must survive every refresh from every source | 2026-08-14 (restated; originally 2026-08-03 as §6.4) | Owner ruling, stated many times. Structural, not per-sync. |
| The mechanism must be structural, not a reminder or a convention | 2026-08-14 | Owner rejected the per-sync-marker proposal explicitly. |
| Capture versioning stays | pre-existing | Load-integrity gates depend on it (§7 item 4). |
| Resolution never mutates a `core.*` row | 2026-08-03, `AGENTS.md` §6.4 | Canonical promotion is a separate reviewed workstream. |
| `core.property.licensor_id` stays a single FK, no junction table | 2026-08-13 | Measured true one-to-many: 513 parent edges over 266 properties, zero properties with two licensors. |
| Scrapes outrank internal systems (ColdLion/DesignFlow) as the authority on what a property is | 2026-08-13 | Portals are the source. |
| A ColdLion pull writes name/code only, never `licensor_id` or `status`, and never deletes | 2026-08-13 | Column-scoped by ruling. |
| COCO belongs under DISNEY; `ZZ` is an upstream mistake; not pushed upstream | 2026-08-13 | `core.property` already correct. This plan is what stops a re-seed reverting it. |

**OPEN — your judgment, decide and write down what you chose.**

- **One resolution table or one per entity kind?** A single `plm.source_resolution` keyed by
  `(source_system, entity_kind, source_id)` is proposed below because the guard and the tests
  are then written once. Per-entity tables give stronger typing on the `core_*` foreign key.
  Recommendation: the single table, with a CHECK that exactly one `core_*_id` column is
  non-null. If you disagree, say why in the migration comment.
- **Whether Shape B (note-based, no `resolution_status`) tables migrate now or later.** They
  are not capture-scoped, so they are not losing data today. Recommendation: bring them into
  the same home for uniformity, but if it doubles the work, do Shape A first and leave Shape B
  behind an explicit follow-up issue rather than half-doing it.
- **Whether the guard trigger is deny-by-default or warn-first.** Recommendation: deny. A
  fallback that only warns is a silent failure under the standing rules.

---

## 9. The plan

Phases are marked. **Re-read the remaining phases before starting each one** — a plan goes
stale the moment someone executes part of it, and whoever executes a step owns updating the
STATUS table at the top of this file with an artifact (a commit SHA, a CI run, a test path, or
the exact command to re-run — never a bare number).

### PHASE 0 — Close the live violation (independent, do this first)

#### Step 0. Keep `20260802170000` in its owner-held bundle

Do not apply `20260802170000` from this workstream. `AGENTS.md` §6.5 requires it to remain
bundled with `20260802171000` and the missing forward migration that removes the FR record.
This issue may neither split that bundle nor write to production.

- **What:** the migration file
  `supabase/migrations/20260802170000_plm_import_preserve_curated_licensor_property_status.sql`,
  merged to `main`, absent from `supabase_migrations.schema_migrations` on production.
- **Read it first, in full.** Do not apply from this plan's description of it. Confirm what it
  changes about `plm.import_master_data(jsonb, jsonb)`.
- **Then** check whether it is on preview, and apply preview → production through the workflow
  in §12, by explicit version.
- **Why first:** until it lands, one re-run of the Master Data import silently reverts
  `core.property.licensor_id` and forces `status='active'` on every matched row. That includes
  the COCO ruling.
- **Judgment call:** if reading the file shows it has been superseded by a later migration,
  do not apply it — record which migration superseded it and mark this step N/A with that
  evidence.
- **You'll know it worked when:**
  ```sql
  select version, name from supabase_migrations.schema_migrations
  where version = '20260802170000';
  ```
  returns one row on production, AND `pg_get_functiondef` for `plm.import_master_data` no
  longer force-sets `core.property.licensor_id` / `status` on matched rows.

### PHASE 1 — Design and inventory

#### Step 1. Confirm the blast radius and freeze the design

**Codex takeover result (2026-08-14).** The repository-wide writer census found the
Paramount loader bodies in `20260810020000`, `20260810090000`, and `20260811030000`; each
inserts `pmt_property` and `pmt_character` without naming any resolution field. NBCU capture
loading likewise uses unresolved/null defaults. Direct writes in
`supabase/tests/nbcu_landing_contracts.sql` are synthetic fixtures and also omit resolution
fields. No application, script, or current function updates the six legacy resolution column
sets. Therefore there is no valid legacy writer to allowlist. New capture rows may only take
unresolved/null defaults, legacy resolution fields may never change, and all human decisions
go through the durable command.

- **What:** re-run the two inventory queries below and record the results in this file's
  STATUS evidence column. Do not proceed on the numbers quoted in §5 — they are from
  2026-08-14 and this plan may be executed much later.

  ```sql
  -- (a) Which resolution-carrying tables are capture-scoped?
  with res as (
    select distinct table_name from information_schema.columns
    where table_schema='plm'
      and (column_name like 'core_%_id' or column_name='resolution_status')
  )
  select c.relname, pg_get_constraintdef(k.oid) as pk,
         (pg_get_constraintdef(k.oid) ilike '%capture%') as capture_scoped
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  join res on res.table_name=c.relname
  left join pg_constraint k on k.conrelid=c.oid and k.contype='p'
  where n.nspname='plm'
  order by capture_scoped desc, c.relname;

  -- (b) How much resolution state actually exists to migrate?
  select 'pmt_property' t, resolution_status, count(*) from plm.pmt_property group by 1,2
  union all select 'pmt_character', resolution_status, count(*) from plm.pmt_character group by 1,2
  union all select 'nbcu_property', resolution_status, count(*) from plm.nbcu_property group by 1,2
  union all select 'nbcu_character', resolution_status, count(*) from plm.nbcu_character group by 1,2
  union all select 'nbcu_style_guide', resolution_status, count(*) from plm.nbcu_style_guide group by 1,2
  union all select 'nbcu_asset', resolution_status, count(*) from plm.nbcu_asset group by 1,2
  order by 1,2;
  ```

- **Dependencies:** none. Can run in parallel with Step 0.
- **You'll know it worked when:** both result sets are pasted into the STATUS evidence column
  with the date, and the count of capture-scoped resolution tables is stated explicitly. If it
  is no longer 6, the rest of the plan's table lists need updating before you continue.

### PHASE 2 — The durable home (natural context cut point after this phase)

#### Step 2. Migration A — `plm.source_resolution`

- **File:** `supabase/migrations/20260814224937_source_resolution_durable_home.sql`
- **What to create:**

  ```sql
  create table plm.source_resolution (
    source_system   text not null,   -- 'paramount' | 'nbcu' | 'disney_opa' | 'warner' | ...
    entity_kind     text not null,   -- 'property' | 'character' | 'style_guide' | 'asset'
    source_id       text not null,   -- the licensor's own identifier, NEVER a display name
    core_property_id    uuid null references core.property(id)      on delete restrict,
    core_character_id   uuid null references core."character"(id)   on delete restrict,
    core_style_guide_id uuid null references core.style_guide(id)   on delete restrict,
    dam_asset_id        uuid null references dam.asset(id)           on delete restrict,
    resolution_status text not null default 'unresolved',
    resolution_reason text null,
    resolved_at  timestamptz null,
    resolved_by  text null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (source_system, entity_kind, source_id)
  );
  ```

  **Note `core.style_guide` may not exist or may be empty** — the previous handoff §5.5 says
  `core.style_guide` and `dam.asset` are both empty. Verify the table exists before adding
  that FK; if it does not, omit that column and the `style_guide` entity kind, and say so in
  the migration comment.

- **Constraints it must carry:**
  - `resolution_status` domain CHECK covering every existing source state:
    `IN ('unresolved','matched','ambiguous','no_match','rejected','deferred')`.
  - The coherence invariant, preserved from `pmt_property_resolution_coherent_chk`:
    `(resolution_status = 'matched') = (num_nonnulls(core_property_id, core_character_id,
    core_style_guide_id, dam_asset_id) = 1)`.
  - A CHECK that the non-null `core_*_id` matches `entity_kind`, so a character cannot be
    resolved into `core.property`.
  - `source_id` non-empty: `btrim(source_id) <> ''`.
- **Table and column COMMENTs are mandatory,** not optional. `AGENTS.md` and the previous
  session's §4.1 lesson both turn on this: an unexplained table is what causes a future session
  to write into the wrong one. State in the comment: this table is capture-INDEPENDENT by
  design; it is the durable record of a human decision; no sync, loader, or import may write
  it; it is the mechanism `AGENTS.md` §6.4 (lines 1416–1420) says is missing.
- **Security and mutation contract:** enable row security; revoke direct
  INSERT/UPDATE/DELETE from `anon`, `authenticated`, and `service_role`; and expose one
  audited `plm.set_source_resolution(...)` command. Grant execution only to
  `authenticated` and `service_role`. The command validates caller identity, stamps
  `resolved_by` and `resolved_at`, and never accepts caller-supplied audit values. It uses an
  expected `updated_at` value for conflicting changes. Repeating the identical decision is a
  successful no-op that returns the existing row; replacing a different decision without the
  expected version fails loudly. Tests must inspect the function/table grants, row-security
  posture, comments, conflict rejection, and no-op behaviour.
- **Behaviour when done:** a resolution recorded here is keyed by the licensor's own id and is
  therefore unaffected by any capture, refresh, or re-scrape.
- **You'll know it worked when:** the table exists on preview with all CHECKs present
  (`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid =
  'plm.source_resolution'::regclass;`) and `obj_description('plm.source_resolution'::regclass)`
  returns a non-empty comment.

#### Step 3. Migration B — backfill

- **File:** `..._source_resolution_backfill.sql`.
- **What:** copy every row from the six capture-scoped tables where
  `resolution_status <> 'unresolved'` OR any `core_*_id IS NOT NULL`, taking the value from the
  **most recent** capture that has one, into `plm.source_resolution`.
- **Expected volume: possibly zero.** As of 2026-08-14 every `pmt_*` row is `unresolved`;
  `nbcu_*` was not measured. A zero-row backfill is a success, not a failure — but the
  migration must still assert what it found rather than passing silently.
- **Gotcha — `min()`/`max()` on `uuid` does not exist in PostgreSQL.** A previous session lost
  a preview run to `function min(uuid) does not exist`. If you need an extreme of a uuid, cast
  through text, or better, order by `completed_at` on `plm.pmt_capture` and take the first row.
- **Behaviour when done:** no curated decision that exists today is lost.
- **You'll know it worked when:** row counts into `plm.source_resolution` equal the counts of
  non-`unresolved` rows found in Step 1(b), proved by a `DO $$ ... raise exception ... $$`
  assertion inside the migration itself, and the migration's notice output is captured in the
  workflow log.

#### Step 4. Migration C — read path

- **What:** the writer census found no application/API reader of the six deprecated resolution
  column sets. Add `api.source_resolution` as the authenticated, security-invoker read path.
  Consumers join it to the current source row on `(source_system, entity_kind, source_id)`.
  Contract tests must perform that join after a later capture, rather than merely selecting
  the durable table directly.
- **Find the readers first, do not assume there are none:**
  ```sql
  select n.nspname, p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api','plm','core')
    and (pg_get_functiondef(p.oid) ilike '%resolution_status%'
      or pg_get_functiondef(p.oid) ilike '%core_property_id%');

  select schemaname, viewname from pg_views
  where schemaname in ('api','plm','core')
    and (definition ilike '%resolution_status%' or definition ilike '%core_property_id%');
  ```
- **Dependencies:** Steps 2 and 3.
- **You'll know it worked when:** every reader found by those two queries either reads the new
  table or is explicitly listed in the migration comment as intentionally unchanged, with the
  reason.

### PHASE 3 — The general guard (this is the part that makes it permanent)

#### Step 5. Migration D — refuse sync writes on the six capture-scoped tables

- **What:** first complete and record a census of every function, script and application that
  writes the legacy resolution columns. Then install a `BEFORE INSERT OR UPDATE` trigger on
  every affected landing table. New capture rows may use only the unresolved/null defaults;
  updates may not change any legacy resolution field. No session flag or role bypass exists.
  Human curation writes only through the dedicated `plm.source_resolution` command, whose
  grants, row-security posture, conflict behaviour and audit fields are explicit and tested.
  A repeated identical command is a successful no-op; a conflicting decision is rejected
  unless the caller explicitly supplies the current decision version.
- **Model it on `plm.opa_link_ensure_entities()`** (`20260814060000`) — same trigger shape,
  same `security definer`, same `set search_path to 'plm','pg_temp'`, same habit of raising an
  actionable message naming the offending id rather than failing generically.
- **Loud failure, no silent fallback.** Standing rule 11. The exception message must name the
  table, the column, and the id, and say what to do instead.
- **Behaviour when done:** it is structurally impossible for a sync, import, backfill script,
  or future loader to write a curated decision on the six scoped Paramount/NBCU landing rows.
  The durable command is the only mutation path and records who decided and when. Issue #999
  extends this protection to the other source families.
- **You'll know it worked when:** a test (Step 7) proves that an UPDATE to `core_property_id`
  outside the curation path raises, while the durable command succeeds.

#### Step 6. Migration E — deprecate the in-table resolution columns

- **What:** on the six capture-scoped tables, make the resolution columns nullable where they
  are not already, add `COMMENT ON COLUMN ... IS 'DEPRECATED — read plm.source_resolution.
  Retained until <loader> stops writing it. See plan_curated-decisions-survive-syncs.md.'`,
  and open a follow-up issue to drop them.
- **DO NOT DROP THEM IN THIS PLAN.** Precedent: `20260814050000` made the NBCU duplicate
  labels nullable and deliberately left the columns in place because dropping them while the
  loader still wrote them would break the next capture. Same reasoning applies. Dropping is a
  separate change, after every writer has stopped.
- **Dependencies:** Steps 2–5 shipped and applied.
- **You'll know it worked when:** `\d+ plm.pmt_property` shows the deprecation comment on
  `core_property_id` and `resolution_status`, and the follow-up issue exists with a link back
  to this plan.

### PHASE 4 — Prove it and write it down

#### Step 7. Tests

Add to `supabase/tests/`, following the existing `*_contracts.sql` style. Name them:

- `source_resolution_durability_contracts.sql` — the core proof. Record a resolution for a
  source id; insert a new capture containing that same source id; assert the resolution is
  still readable and still `matched`. **This test failing is the bug returning.**
- `source_resolution_guard_contracts.sql` — assert that an UPDATE of `core_property_id` /
  `resolution_status` outside the curation path raises, with the expected SQLSTATE; assert the
  same UPDATE inside the curation path succeeds.
- `source_resolution_coherence_contracts.sql` — assert `resolution_status='matched'` with all
  `core_*_id` NULL is rejected; assert two non-null `core_*_id` on one row is rejected; assert
  a `character` entity_kind with `core_property_id` set is rejected.
- `source_resolution_backfill_contracts.sql` — assert no pre-existing non-`unresolved` row was
  lost by the backfill.

**Existing suites that must stay green:** the whole `supabase/tests` job, and specifically
`opa_property_character_importer_contracts.sql` and
`opa_property_character_landing_contracts.sql`, which are the two that caught the last
production regression in this area.

**Run them before merging, and read the result even though the job is not a required check.**

#### Step 8. Documentation

- **`AGENTS.md`** — add a cross-reference in §6.4 pointing at `plm.source_resolution` as the
  per-field curation record that §6.4 lines 1416–1420 say does not exist. Do not rewrite the
  ruling; add the pointer.
- **`docs/core-master-data-consolidation-aim.md`** — note that resolution is now recorded in
  `plm.source_resolution`, not on the landing rows.
- **The four scrape skills**, canonically at `skills/shared/<name>/SKILL.md` in
  `u2giants/ai-devops` and mirrored on this machine at
  `C:\Users\ahazan2\.claude\skills\<name>\SKILL.md`:
  `disney-source-data-scrape`, `nbcu-creative-assets-scrape`,
  `paramount-creative-library-scrape`, `wb-starlabs-scrape`. Each needs one paragraph: loaders
  must never write resolution columns; resolution lives in `plm.source_resolution`; the guard
  will refuse the write.
- **Edit BOTH copies** (machine and `ai-devops`) and push `ai-devops`. **If `ai-devops` has
  uncommitted work from another session, use the detached-worktree push pattern:** create a
  temporary detached worktree from `origin/main`, cherry-pick your commit there, push, remove
  the worktree. Never stash or rebase over another session's files.
- **You'll know it worked when:** `git log origin/main -1` in `ai-devops` shows your commit,
  and both copies of each edited skill contain the new wording.

---

## 10. Tests required

Specified by name and behaviour in Step 7 above — four new `*_contracts.sql` files, plus the
existing `supabase/tests` suite staying green. The single most important assertion in the
whole plan is the one in `source_resolution_durability_contracts.sql`: **a resolution recorded
before a new capture is still there after it.** If you write only one test, write that one.

---

## 11. Constraints, standing rules, and gotchas in force

- **All structure changes are authored here, in `u2giants/shared-db`, branch + PR.** Claude
  merges its own PRs; Albert cannot. Never write a shared-DB migration from an app repo, and
  never run `ALTER`/`CREATE`/`DROP` directly against the shared database.
- **This repo uses worktrees. No session works directly in the shared `shared-db` checkout**
  (`AGENTS.md` §2.1-W, standing since 2026-08-12).
- **The Supabase MCP is READ-ONLY and may be bound to production.** It cannot run DDL or DML.
  Writes go through the GitHub promotion workflow or the Management API query endpoint.
- **Prove which database you are pointed at before any write, and quote the proof**
  (`AGENTS.md` §4.2). Owning your rows is not permission to be unsure where they land.
- **Never reuse a migration version number.** Supabase keys on the version alone; a duplicate
  makes one migration silently skip.
- **Never edit a migration that may already be applied.** If you truly must, first *prove* it
  applied nothing — check `supabase_migrations.schema_migrations` and check that its objects
  are absent — then say so in the commit message.
- **`min(uuid)` / `max(uuid)` do not exist.** Cast through text or order by a timestamp.
- **`supabase/tests against an ephemeral database` is NOT a required check.** Read it anyway.
- **Two workflow argument traps that each cost a failed run:**
  - `review_artifact_digest` must be canonical `sha256:<64 hex>`. The log prints the bare hex.
  - `reviewed_main_sha` must be the **live** `main` SHA, not your possibly-stale local
    `origin/main`. Get it with
    `gh api repos/u2giants/shared-db/commits/main --jq .sha`.
- **No band-aids, no silent failures, nothing hard-coded** (global standing rules 10–12). A
  fallback that does not alert loudly is a defect in itself.
- **Licensed source data never leaves its approved private repo** — not in issues, PRs, commit
  messages, or logs.
- **This repo is PUBLIC and has a PII forward guard.** Never put a personal email in it; refer
  to people by `app.profile` UUID. This failed PR #932 once.
- **Do not edit another session's `HANDOFF.d/` file**, and never rewrite the root `HANDOFF.md`
  — it is a static pointer.
- **Whoever executes a step owns updating this file's STATUS table**, citing an artifact, never
  a bare number (`AGENTS.md` §4.3: issues, handovers and plans point at the LIVE reading).

---

## 12. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | project ref `qsllyeztdwjgirsysgai` | Read via Supabase MCP; write via workflow / Management API |
| Shared Supabase PREVIEW | project ref `rjyboqwcdzcocqgmsyel` | A Supabase *branch*, so it does not appear in `supabase projects list` |
| Supabase Management API token | 1Password vault `vibe_coding` → item "Supabase CLI Personal Access Token", field `credential` | For writes the MCP cannot do |
| ColdLion ERP API | `http://x5.coldlion.com/EhpApi` | 1Password `vibe_coding` → "Coldlion ERP API key x5.coldlion.com", field `credential`; header `X-API-Key` |
| DesignFlow PRODUCTION (live) | Cloud SQL `creatiflow-database`, GCP project `lithe-breaker-323913`, host `104.198.220.200:5432`, db `postgres`, **schema `designflow`** | 1Password → "DesignFlow PRODUCTION Cloud SQL - read-only (albert_read_only, creatiflow-database)". Read-only, IP-allowlisted. **Schema is `designflow`, not `dflow`** — `dflow` is the Supabase-side mirror name and is seven weeks stale. |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills live in `skills/shared/` |
| Authenticated CLIs on this machine | `gh`, `gcloud`, `az`, `supabase`, `vercel`, `op` | Verify with a real call before claiming a capability is missing |

**Secrets:** always via `op_run` with `op://` references, never pasted values. **Serialize
1Password reads** — never fan out `op read` / `op run` / 1Password MCP calls in parallel.
`op_run`'s `cwd` does not accept `/tmp`-style Git Bash paths; use a Windows path.

**Working pattern that has worked well here:** write a small `.mjs` script in the scratchpad
and run it through `op_run` with the secret injected as an env var.

**Applying a migration end to end:**

```bash
gh workflow run "Shared Supabase Migrations" --repo u2giants/shared-db --ref main -f target=preview -f mode=apply -f preview_allowlist=<version>
```

then the production dry-run, then `Production Apply Review Evidence` (needs the LIVE `main`
SHA), then the production apply with `review_artifact_digest=sha256:<hex>`. Both argument
traps are in §11.

**Preview is materially behind production** (issue #901 — 10 migrations behind at last count),
which makes preview rehearsals weaker evidence than they look. The previous session worked
around it by applying each migration to preview explicitly by version. Do the same.

---

## 13. Definition of done, risks, and open questions

**Done means all of:**

- [ ] `20260802170000` applied to production, or documented as superseded with the evidence.
- [ ] `plm.source_resolution` exists on production, with CHECKs and table/column comments.
- [ ] Backfill run, with an in-migration assertion of what it moved (zero is a valid result).
- [ ] Every reader found by the Step 4 queries updated or explicitly exempted in writing.
- [ ] The guard trigger installed on all six capture-scoped Paramount/NBCU tables, failing
      loudly. Issue #999 owns the source-ID-keyed Disney, Warner, OPA and ColdLion families.
- [ ] Deprecation comments on the old columns; follow-up issue opened to drop them.
- [ ] Four new test files added; whole `supabase/tests` job read and green.
- [ ] `AGENTS.md`, `docs/core-master-data-consolidation-aim.md`, and all four scrape skills
      updated; `ai-devops` pushed.
- [ ] Committed, pushed, PR merged to `main`, CI green, production apply verified by reading
      `supabase_migrations.schema_migrations` — not by assuming the workflow succeeded.
- [ ] This file's STATUS table updated with artifacts, and the handoff file updated.

**Risks and rollback.**

- *The guard trigger blocks a legitimate loader path nobody knew about.* Most likely failure
  mode. Mitigate by running Step 5 on preview and exercising every loader against it before
  production. Rollback is `drop trigger` — cheap and immediate.
- *A reader is missed in Step 4 and silently reads a now-empty column.* Mitigate with the two
  catalog queries, and by NOT dropping the old columns (Step 6 deliberately keeps them).
- *Preview drift makes the rehearsal unrepresentative* (#901). Mitigate by applying by explicit
  version and re-checking on production.
- *This plan is executed months later against a changed schema.* Mitigate: Step 1 re-derives
  the table list from the catalog rather than trusting the list in §3.

**Open questions, with how to settle them.**

1. **Does `core.style_guide` exist and is it usable as an FK target?** Settle with
   `select count(*) from core.style_guide;` and a catalog check. The previous handoff says it
   is empty. If absent, drop that column and entity kind from Step 2.
2. **Do the `nbcu_*` tables have real resolution state to preserve?** Never measured. Step 1(b)
   settles it. If they do, the backfill is no longer trivially zero and needs care.
3. **Is there an existing role separation between loaders and humans?** Settles the choice
   between guard mechanism (a) and (b) in Step 5. `select rolname from pg_roles;`.
4. **Are the Shape B (note-based) tables worth unifying now?** See §8 OPEN. Decide by how much
   Shape A work actually costs once Steps 2–5 exist.
5. **Should `plm.taxonomy_resolution_review` fold into this?** Issue #941 proposes adding
   notification/upstream-fix columns to it; it was de-prioritised on 2026-08-14 because its
   only motivating item (COCO) closed without an upstream push. It is arguably the same
   problem. Recommendation: leave separate; note the overlap on #941.

---

## Self-audit (required by the implementation-plan-writer standard)

**1. Could a brand-new AI session with no project knowledge and no context from this
conversation execute this plan to perfection, without asking anything?**
Yes. §2 defines the application, the business vocabulary (licensor / property / character /
style guide / ColdLion / DesignFlow) and every schema involved, for a reader who has never seen
the repo. §3 gives the trigger with the verification query that established it and a concrete
three-step reproduction. §5 states the exact current state including the migration naming
sequence, the two different resolution column shapes in use, and a worked example
(`20260814060000`) to model Step 5 on. §9 gives eight numbered steps, each naming target files
and functions and each ending in a verification gate. §12 names every credential by location.
The only genuinely undecided items are isolated in §8 OPEN and §13, each with a recommendation
and a query that settles it.

**2. Does the plan carry every piece of background, nuance and reasoning currently held —
including what was ruled out and why?**
Yes. §7 records six rejected approaches, including the two that matter most: loader-side
carry-forward (rejected because per-writer rules are what already failed here on 2026-08-14)
and the per-sync marker (rejected by the owner explicitly). §6 records the root-cause insight —
that the decision is attached to the observation rather than to the identity — plus the
measured facts so they are not re-derived, including the failed-capture count trap that makes
`count(*)` misleading. §8 separates locked rulings from open judgment. §5 corrects two stale
claims that would otherwise mislead: the Warner loader exists, and `20260802170000` is merged
but unapplied. §11 carries every trap that has cost a real session time, including the two
workflow argument traps and `min(uuid)`.

**3. Is the ultimate goal stated clearly enough that the implementer could make a correct
judgment call if a step turns out to be wrong?**
Yes. §1 states the goal in plain business English before any technical wording, gives the
owner's own words and the date, distinguishes the two failure modes, and carries the explicit
instruction that the goal outranks the steps. §4's out-of-scope list bounds the work so a
judgment call cannot quietly expand it.

**Gap found during the audit and fixed:** the first draft assumed `core.style_guide` exists as
an FK target. The previous handoff records it as empty and its existence was never verified, so
Step 2 now carries an explicit check-before-use instruction and it is listed as open question 1.
