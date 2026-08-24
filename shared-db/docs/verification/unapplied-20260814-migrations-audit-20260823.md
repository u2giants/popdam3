# The six 2026-08-14 migrations that were never applied anywhere — audit

**Date:** 2026-08-23 · **Scope:** investigation only. **Nothing was applied, promoted or pushed.**
**Evidence:** the SQL on `main`, the merged PRs and their issues, the guard scripts under `scripts/`,
and read-only queries against the **production** ledger and catalog
(`supabase_migrations.schema_migrations`, `information_schema`, `pg_get_viewdef`, row counts).
**Independently reviewed by GLM 5.3** (session `unapplied-20260814-migrations`, report under
`.ai/reviews/`); four of its corrections were verified against the tree and are incorporated below.

---

## Bottom line for the owner

**One business capability is switched off right now: a new Paramount capture cannot succeed.** The
Paramount scraper on `main` already sends the new metadata shape, while the database still runs the
old loader that does not accept it. A capture run today fails at the door. It fails *loudly and
safely* — nothing is corrupted, nothing is half-written — but Paramount cannot be re-captured until
the three Paramount migrations land. That is the item to schedule first.

Everything else is latent risk: work that was reviewed, approved and merged, then never switched on.

**The Warner item is a stale contract, not a visible defect.** Two API feeds
(`api.wb_property_character`, `api.wb_property_reconciliation`) still read retired, now-empty tables
and answer "no Warner property/character relationships exist", while **4,158 real relationships** sit
in the current table next to them. But nothing consumes those feeds — verified: zero references in
`types/`, `apps/` or `tools/`, matching the 2026-08-13 dependency audit. So it is wrong only for an
ad-hoc query someone runs by hand. Worth fixing; not an outage.

**A seventh migration is in the same state and was not on the list:**
`20260814224937_source_resolution_durable_home`. It is **already formally retired** in this repo's
own guard scripts (`RETIRED_VERSION_REASONS`, `HARD_BLOCKED`) — a recorded ruling that it must never
run. Item 4 below depends on it and inherits that ruling.

**The cheapest and highest-value fix in this whole audit touched no database and is already done
(PR #1402):** two of these versions — `20260814233342` and `20260814233423` — appeared **nowhere** in
the guard scripts, so both classified as `genuinely-pending` and the promotion allowlist would have
accepted them. One of the two ([item 3](#3)) would have silently damaged production if promoted.
Both are now retired and hard-blocked.

**Also true, and normal:** two migrations from 2026-08-19 (`popdam_bulk_operation_revision_lease`,
`wildbrain_inventory_classification_and_finalize_extra_key_sweep`) are applied to preview and are
waiting for a production window. That is the process working. They are not part of this problem.

**Why nobody noticed.** The drift alarm (issue #949, opened 2026-08-14) is deliberately *throttled*:
while it is open, no further alarm issues are filed. It went red the same day these merged, was left
open, and every drift since has been silent. All six issues (#958, #964, #965, #969, #970, #999) were
closed the moment their PR merged, so nothing tracked "merged" separately from "switched on". A
separate session is repairing the checker; this report does not touch it.

---

## Ordered by urgency

### 0. Do this first, regardless of any window: guard the two unguarded versions

**Shipped as PR #1402.** `20260814233342` and `20260814233423` were absent from `RETIRED_VERSION_REASONS`
(`scripts/post_batch_app_verification.py:343`) and `HARD_BLOCKED`
(`scripts/production_migration_guard.py:59`). Both were added in the shape already used for
`20260814224937`, with the pinned set tests updated and a refusal test added for each. Guard scripts
only — no database, no window — and it is what makes an accidental `--include-all` promotion
impossible.

### 1. The three Paramount migrations — a capture is blocked today; apply as an ordered set

All three rewrite the same loader function, `plm.load_pmt_capture_chunk`, each starting from the
previous one's body. Production still runs the 2026-08-11 version and **no later applied migration
has touched it**, so the chain is intact. It is **all three or none** — #970's loader body already
assumes #964's omissions and #965's new table. Applying a subset would silently drop the earlier
fixes.

**Why this is now first, not last.** `tools/sync-paramount-creative-library.mjs` (lines 497, 686,
704) already sends `pmt_metadata_element` rows and already omits the deprecated duplicate name
columns. The live loader's allow list has no `pmt_metadata_element` and its inserts still expect the
copies. A Paramount capture run today is **refused** — fail-closed, no partial write, no corruption,
but no capture either. Paramount has exactly one complete capture (2026-08-13) and none since.

**3.1 `20260814193351_pmt_duplicate_name_columns_deprecated` (issue #964, PR #981).** Stops storing a
second copy of the Paramount property name on two tables that already link to the real property
record. The copies agree today (zero mismatches measured), which is the safe moment to stop writing
them — before a future capture makes them disagree and nobody can say which is right.
*Destructive elements:* makes the two copy columns nullable (`DROP NOT NULL`), drops one index
(`plm.idx_pmt_atp_name`). **No column dropped, no data rewritten.** Nothing reads the copies.

**3.2 `20260814213043_pmt_metadata_element_normalization` (issue #965, PR #1006).** Paramount repeats
the same six metadata heading labels on every value row — 207,522 rows in production carry them.
This creates one row per heading per capture and points the value rows at it. *Additive:* new table
`plm.pmt_metadata_element` with full security, backfill, immutability triggers, a foreign key, and
deprecation comments. **Deliberately does not drop the six heading columns** — staged to wait for a
proven preview capture.

**3.3 `20260814223552_pmt_collection_paramount_term_normalization` (issue #970, PR #1032).** Paramount
calls something a "Collection"; POP presents it as a "Style Guide". That word was being stored on
1,928 rows; this states it once in the view instead. *Destructive element:* `DROP COLUMN
plm.pmt_collection.paramount_term`, and `api.pmt_style_guides` is dropped and recreated. The
consumer-visible column name is unchanged — the view still returns `paramount_term`, now as a fixed
label. Nothing else has redefined that view since.

**Recommendation: apply all three, in version order, in one window**, after a preview rehearsal that
includes an actual Paramount capture (which also unblocks the deferred heading-column drop).

### 2. Warner legacy cleanup — `20260814170749_wb_retire_legacy_capture_paths` (issue #958)

**What it does.** Finishes retiring the first-generation Warner (STARLABS) tables after the data was
moved to the normalized tables. It tightens the capture contract so a new Warner scrape can only
write to the current tables, deletes the eight retired empty tables and their old loader functions,
and drops the two API views that read them.

**Additive or destructive?** **Destructive, but only of empty objects.** Verified in production today:
all eight tables hold **0 rows**; the 4,158 property→character rows live in
`plm.wb_property_character_normalized`, exactly as the repinning policy expects. It drops tables
`plm.wb_asset`, `wb_style_guide`, `wb_character`, `wb_franchise_property`, `wb_property_character`,
`wb_asset_character`, `wb_asset_style_guide`, `wb_asset_franchise_property`; functions
`public.sync_wb_*` and `plm.sync_wb_*` (eight each), plus the two legacy capture functions; and views
`api.wb_property_character`, `api.wb_property_reconciliation`. No data rewrite.

**Degraded today by its absence?** Mildly, and with no consumer. The two views return zero rows from
an emptied table, so an ad-hoc query through them is silently wrong; zero code references them. The
sixteen old loader functions are still callable and the capture guard still accepts retired target
names, so a stale script could land a fresh Warner scrape into tables nothing reads.

**Safe now?** Yes. Its own safety check (refuse if any legacy row or in-flight legacy capture exists)
passes on today's production: zero legacy rows, no legacy-target capture in flight. Nothing after it
redefines the Warner capture functions.

**The replacement-view question — recommendation reversed after review.** After the drop, the only
API view of Warner property→character is `api.wb_inferred_property_character` (2026-08-16), which is
inferred from asset co-occurrence and explicitly is **not** the direct assertions. My first instinct
was to ship a replacement view over `plm.wb_property_character_normalized` in the same window. That
is scope creep on a cleanup: the 08-16 migration states in terms that the direct assertions *remain*
in the `plm` table, `plm` is not browser-reachable by design, and no consumer exists. **Apply #958
as-is.** If the owner later wants direct assertions on the API surface, that is a new structure
change with its own issue and claim, shipped as a separate migration after #958 — never as an edit to
the merged file (`tools/sync-warner-starlabs.test.mjs` asserts that file's contents).

**Recommendation: apply as-is**, after preview rehearsal. Owner input needed only on the optional
follow-up view.

### 3. Source-capture inventory counts {#3} — `20260814233342_source_capture_inventory_latest_complete` (issue #969)

**What it does.** Adds the columns that separate "rows we have ever retained" from "rows in the
latest complete capture" on `api.source_capture_inventory` — the report used to answer "how much of
this licensor have we actually captured?"

**Superseded? Yes, completely.** Later migrations that *are* applied (Sega 08-19, Peanuts 08-19,
WildBrain 08-19 and 08-20) each rebuild the whole view including this body. Production already has
`latest_complete_row_count`, `count_basis`, `latest_complete_status`, `count_note` and
`carries_resolution`. The business benefit is already live.

**⚠️ Applying it now would cause silent damage.** It is a whole-view `create or replace` carrying the
08-14 body, which has no Sega, Peanuts or WildBrain branches. The later rebuilds deliberately kept
the same ten output columns, so the old body would replace the view **cleanly, with no error**,
downgrading those licensors to "retained only" coverage reporting. Post-apply catalog verification
cannot catch it: the view still exists — only its body regressed.

**Recommendation: retire. Do not apply.** The correct mechanism in this repo is to add the version to
`RETIRED_VERSION_REASONS` and `HARD_BLOCKED` (see item 0) — **not** to insert a row into the
migration ledger. A ledger row would assert that the 08-14 view body ran when it did not, and would
make a clean-slate replay diverge from production. The `-- catalog-verification: no-op` marker is a
different thing entirely (it declares that an *applied* file contains no catalog DDL) and is not a
precedent here.

**What retirement buys:** the drift checker reads the retirement sets directly
(`check-migration-ledger-drift.mjs:109`). A retired version is still listed for visibility, labelled
`[RETIRED]` with its reason, but is moved to `intentionallyExcluded` and **does not make the check
fail** (line 323). The promotion guard also refuses it in any allowlist. So retiring these two
shrinks the actionable drift list rather than merely relabelling it.

### 4. Durable source resolutions — `20260814233423_remaining_source_resolution_durable_home` (issue #999, PR #1038)

**What it does.** Moves human "this source record means this POP record" decisions out of the
capture-snapshot tables (where the next scrape wipes them) into one permanent home, and installs
triggers that refuse any future attempt to write a decision back onto a landing row.

**Already ruled on, in part.** The migration that creates the permanent table,
`20260814224937_source_resolution_durable_home` (issue #963), is **already recorded as retired and
hard-blocked** in this repo — `scripts/post_batch_app_verification.py:352` and
`scripts/production_migration_guard.py:111`, on the grounds that it would recreate an obsolete
`core.character` foreign key after issue #1374 retired the empty Universe A character tables.
`core.character` was in fact dropped from production today (2026-08-23, `20260823133150`). So that
file must never run, and `20260814233423` cannot run without it — its first insert into
`plm.source_resolution` would fail outright.

**The rework is additive supersession, not an edit.** Do not edit the merged SQL. Author a new
migration carrying the 224937 content minus the `core.character` foreign key (that single line is the
only hard break — every other `core_character_id` reference is a plain uuid column), plus the 233423
content, following the `20260816045130 → 20260816110750` precedent. Keep `core_character_id` as a
plain uuid with no foreign key, matching what `20260823133150` did to the `nbcu`/`opa`/`pmt`
character tables — it kept the columns and dropped only the constraints.

**⚠️ One more trap for whoever does that rework.** The same table also declares
`core_property_id uuid references core.property(id)`. Under AGENTS.md §6.15, `core.property` is
itself slated for deletion — so a replacement that keys to it will break again the same way, and any
stored property decision would dangle. The rework session must put that question to the owner
explicitly (plain uuids with no canonical foreign keys, versus foreign keys only where the target's
survival is settled) rather than deciding it silently.

**Anything else broken underneath it?** Checked: `20260823133150` dropped `core.character`,
`core.property_character`, five `*_core_character_id_fkey` constraints, and rewrote two DB Data Admin
RPC bodies. `20260814233423` intersects only at `plm.opa_character.core_character_id`, where the
**column survives**, so the rest of its logic still stands.

**Lost data today?** None. Production holds **zero** resolved rows in every landing table checked.
The exposure is that the guard rails are not installed, so the *first* human decision anyone records
can still be written into a capture snapshot, where the next scrape erases it.

**Additive or destructive?** Mostly additive (staging, inserts into the new table, a rebuilt
`api.opa_property_reconciliation` view, twenty refusal triggers). It does **rewrite data**: it blanks
the resolution columns on the OPA and Warner landing tables after copying them across — harmless
today only because those columns are empty.

**Recommendation: retire this version too (item 0) and route the replacement to a fresh workstream**
with its own issue and claim. Until it ships, treat "record a source-to-POP decision" as not yet
supported.

---

## What I recommend, in order

1. **Done — PR #1402, no window needed:** `20260814233342` and `20260814233423` are now in the
   retirement and hard-block sets, so neither can be promoted by accident.
2. Rehearse and apply the **three Paramount migrations in version order** in one window — this is the
   only item restoring a capability that is currently off.
3. Rehearse and apply **Warner #958 as-is**; treat a replacement API view as a separate, optional
   change only if the owner wants direct assertions on the API surface.
4. Open a fresh issue for the **source-resolution replacement**, including the `core.property`
   question above. Do not schedule the merged pair.
5. Close issue #949 only when the checker is repaired, so the alarm stops being throttled shut.

## Limits of this audit

Preview was not queried from this session (the database connection here is production-bound); the
statement that none of the six reached preview is taken from the task brief and is consistent with
the absence of any preview-rehearsal evidence for them under `docs/verification/`. The production
findings above are first-hand. GLM 5.3's review was verified line-by-line against the tree before
being incorporated; its remaining disagreement with an earlier draft — whether the Warner views
constitute a live defect — was resolved in its favor after confirming zero consumers.
