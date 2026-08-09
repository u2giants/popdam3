# A2 — The rebuilt production apply set, and the first rehearsal of the bounded lane

**Plan item:** `plan_orchestrator-workflow-gaps.md` § A2 (rebuilt; the original 11-only allowlist was wrong)
**Measured:** 2026-08-09, by a dispatched sub-agent of orchestrator session `5e1ab3af` (marker issue #601).
**Input:** `docs/verification/orphan-migrations-classification-20260809.md` (A1, PR #604) — **verified, not inherited.**
**Nothing was written to any database.** Every production statement below is a `select`. The
rehearsal used the existing dry-run job, whose first step refuses `mode: apply`.

---

## 0. Headline

Three things, in order of how much they matter.

1. **The apply set is 50 migrations, not 11 and not 44.** **47 APPLY + 1 RETIRE + 2 HELD.**

   ⚠️ **CORRECTED 2026-08-09 (second pass).** The first version of this document listed
   `20260802170000` and `20260802171000` as **APPLY** and gave the promotable count as 49.
   **That was policy-illegal and it is the most dangerous error this document ever
   contained.** `AGENTS.md` **§6.5** is a standing OWNER RULING (Albert Hazan, 2026-08-03):
   *neither of those two versions may reach production by ANY route* until the `FR`
   "FRIENDS TV" removal work is ready to ship with them, as one bounded apply in dependency
   order. No FR removal migration exists in the repository, so the one legal event cannot
   currently be assembled at all. Anyone who pasted the 49-entry allowlist into the
   production lane would have promoted a batch the owner has forbidden — and at the time
   nothing in the code would have stopped them. **This is now enforced**, not documented:
   `parse_allowlist` in `scripts/production_migration_guard.py` carries a §6.5 co-presence
   rule (see §4.3), and it refuses the published 49-entry allowlist outright.

   **The promotable allowlist is 47 entries.**
2. **`20260729120000` must be RETIRED, and the reason is stronger than "superseded":
   applying it would REGRESS a security control that is live on production today.**
   It sorts *below* `20260729180000`, which is already in the ledger and will therefore
   never re-run to repair the damage. This is the one place where pure version order is
   actively wrong, and it is the single most valuable finding here.
3. **The rehearsal could not reach the Supabase CLI. It failed on a defect in
   `scripts/production_migration_guard.py` — a parsing fault, not a migration fault.**
   The defect is fixed in this PR with regression tests. **A second, structural blocker
   sits behind it** (§6.2) and is NOT fixed here.
4. **Nothing here proves the batch can RUN.** A dry-run prints a plan; it executes no SQL, and
   `supabase db push` wraps each *file*, not the batch — so a data-dependent assertion failing
   at file 45 of 47 leaves production **partially promoted with no undo**. The whole-batch
   rehearsal against a production-shaped scratch database (§7) is the real gate and has **not**
   been done. Treat it as a hard precondition of A4, not a formality.

---

## 1. Target confirmed before any measurement

`AGENTS.md` §12 standing fact 6: the Supabase MCP takes no project parameter, so the target
is confirmed first, every time.

```
mcp__supabase__get_project_url  ->  https://qsllyeztdwjgirsysgai.supabase.co
```

**Production ref: `qsllyeztdwjgirsysgai`.** Preview (`rjyboqwcdzcocqgmsyel`) was not touched.

## 2. Counts, re-derived from scratch

The plan and A1 both say counts go stale within the hour and no document wins by date, so
nothing below is quoted from either.

| Measure | A1 (2026-08-09, earlier) | This pass | Note |
|---|---|---|---|
| Production ledger rows | 361 | **361** | unchanged |
| Ledger head | `20260802194100` | **`20260802194100`** | unchanged — production last received a migration **2026-08-02** |
| Migration files on `main` | 405 | **411** | **+6**: PR #606 merged `20260809170000`…`20260809170500` |
| Missing below the head ("orphans") | 33 | **33** | unchanged |
| Missing above the head ("pending") | 11 | **17** | 11 + the 6 new |
| **Total missing** | 44 | **50** | |
| Ledger rows with no file on `main` | 0 | **0** | no phantom ledger entries |

`origin/main` tip at measurement: `77c15acf8840f275c56c2a2199b860f1776cafe7`.

Re-derive:

```sql
select count(*), min(version), max(version) from supabase_migrations.schema_migrations;
-- 361 | 20260220125350 | 20260802194100
select string_agg(version, E'\n' order by version) from supabase_migrations.schema_migrations;
```

```bash
git ls-tree -r --name-only origin/main supabase/migrations | sed 's#.*/##' | cut -c1-14 | sort
# 411 versions; set-difference against the ledger gives the 50 below.
```

**The plan's §A2 allowlist of 11 is wrong twice over:** it omits the 33 that several of the
11 depend on, *and* it predates the 6 migrations merged today.

## 3. The ordered apply set — 50 migrations, of which 47 are promotable

**47 APPLY + 1 RETIRE + 2 HELD (§6.5).** Order is **version order**, and version order is
correct for all 47 APPLY rows (proved in §5). The one row where version order would do damage
is retired rather than reordered, because reordering cannot fix it (§4.1). The two HELD rows
are not a technical judgement at all — they are an owner ruling, and the guard now enforces it
(§4.3).

| # | Version | vs head | Action | File |
|---|---|---|---|---|
| 1 | `20260724060000` | below | APPLY | `coldlion_licensor_property_phase2a_mirror_importer.sql` |
| 2 | `20260724061000` | below | APPLY | `coldlion_licensor_property_phase2a_guard_corrections.sql` |
| 3 | `20260726030000` | below | APPLY | `coldlion_licensor_property_phase4_link_approved.sql` |
| 4 | `20260726031000` | below | APPLY | `coldlion_licensor_property_phase4_null_shape_guard.sql` |
| 5 | `20260726032000` | below | APPLY | `coldlion_licensor_property_phase4_browser_execute_revoke.sql` |
| 6 | `20260726180000` | below | APPLY | `coldlion_licensor_property_phase6_parallel_run.sql` |
| 7 | `20260727221500` | below | APPLY | `coldlion_licensor_property_readiness_and_breaker.sql` |
| 8 | `20260727223000` | below | APPLY | `coldlion_breaker_blocked_attempt_logging_fix.sql` |
| 9 | `20260727224500` | below | APPLY | `coldlion_identity_verifier_reason_cast_fix.sql` |
| 10 | `20260727230000` | below | APPLY | `core_style_guide_axis.sql` |
| 11 | `20260728134500` | below | APPLY | `coldlion_breaker_autotrip_and_gap_closure.sql` |
| 12 | `20260728171500` | below | APPLY | `db_data_admin_tree_plm_division_names.sql` |
| 13 | `20260728174500` | below | APPLY | `clickup_incremental_task_import_reissue.sql` |
| 14 | `20260728181500` | below | APPLY | `clickup_incremental_task_import_fixes.sql` |
| **15** | **`20260729120000`** | below | **RETIRE** | `lock_down_public_security_definer_execute.sql` |
| 16 | `20260729230000` | below | APPLY | `coldlion_licensor_property_recurring_promotion.sql` |
| 17 | `20260729234500` | below | APPLY | `coldlion_recurring_promotion_collision_rule_fix.sql` |
| 18 | `20260729235500` | below | APPLY | `coldlion_recurring_promotion_ambiguous_column_fix.sql` |
| 19 | `20260730000500` | below | APPLY | `coldlion_recurring_promotion_absence_detection_fix.sql` |
| 20 | `20260731150000` | below | APPLY | `popsg_property_resolution_contracts.sql` |
| 21 | `20260731153000` | below | APPLY | `popsg_property_alias_redundancy_trigger_fix.sql` |
| 22 | `20260731163000` | below | APPLY | `coldlion_recurring_promotion_drop_dead_failure_recording.sql` |
| 23 | `20260731180000` | below | APPLY | `coldlion_recurring_promotion_serialization_lock.sql` |
| 24 | `20260731190000` | below | APPLY | `coldlion_promotion_crosscheck_provenance_coverage.sql` |
| 25 | `20260731200000` | below | APPLY | `coldlion_recurring_promotion_fanin_name_tiebreak.sql` |
| 26 | `20260731210000` | below | APPLY | `core_licensor_alias.sql` |
| 27 | `20260731220000` | below | APPLY | `licensor_alias_owner_approval_remaining_five.sql` |
| 28 | `20260802140000` | below | APPLY | `acknowledge_taxonomy_sync_alert_rpc.sql` |
| 29 | `20260802141000` | below | APPLY | `taxonomy_alert_ack_comment_correction.sql` |
| 30 | `20260802150000` | below | APPLY | `taxonomy_alert_actor_heuristic_word_anchors.sql` |
| 31 | `20260802160000` | below | APPLY | `taxonomy_alert_ack_effective_role_is_current_user.sql` |
| **32** | **`20260802170000`** | below | **HELD (§6.5)** | `plm_import_preserve_curated_licensor_property_status.sql` |
| **33** | **`20260802171000`** | below | **HELD (§6.5)** | `owner_ruling_friends_tv_frida_kahlo.sql` |
| 34 | `20260803150000` | above | APPLY | `itemdetail_coldlion_item_identity_and_upc_contract.sql` |
| 35 | `20260803200000` | above | APPLY | `temp_status_watch_snapshot_and_change_log.sql` |
| 36 | `20260803201000` | above | APPLY | `temp_status_watch_hardening.sql` |
| 37 | `20260804120000` | above | APPLY | `taxonomy_baseline_pins_table.sql` |
| 38 | `20260804120100` | above | APPLY | `taxonomy_breaker_environment_and_provenance.sql` |
| 39 | `20260807030000` | above | APPLY | `owner_ruling_coco_is_a_disney_license.sql` |
| 40 | `20260807170000` | above | APPLY | `opa_property_character_landing.sql` |
| 41 | `20260807170100` | above | APPLY | `opa_property_character_importer.sql` |
| 42 | `20260807180000` | above | APPLY | `opa_sync_reentrancy_fix.sql` |
| 43 | `20260807190000` | above | APPLY | `opa_security_and_view_corrections.sql` ← **security fix, not optional** |
| 44 | `20260807200000` | above | APPLY | `opa_comment_corrections.sql` |
| 45 | `20260809170000` | above | APPLY | `core_product_size_and_depth_foundation.sql` |
| 46 | `20260809170100` | above | APPLY | `core_product_depth_seed_from_designflow.sql` |
| 47 | `20260809170200` | above | APPLY | `core_product_size_seed_from_legacy_mg04.sql` |
| 48 | `20260809170300` | above | APPLY | `coldlion_product_size_guarded_importer.sql` |
| 49 | `20260809170400` | above | APPLY | `api_product_size_and_depth_pickers.sql` |
| 50 | `20260809170500` | above | APPLY | `db_data_admin_product_depth_mutations.sql` |

**The allowlist string** (**47 entries**) is rows 1–14, 16–31 and 34–50 above, comma-separated
in this order — i.e. the 50 minus the RETIRED `20260729120000` and minus the two **HELD**
versions `20260802170000` and `20260802171000`.

⚠️ The earlier "49 entries, rows 1–14 and 16–50" string is **policy-illegal — do not use it.**
It carries both §6.5-held versions. `parse_allowlist` now rejects it with a §6.5 error, and that
rejection is covered by a negative-path test in `scripts/test_production_migration_guard.py`.

### 4.3 `20260802170000` and `20260802171000` — **HELD, by owner ruling `AGENTS.md` §6.5.**

Neither may reach production by ANY route until the `FR` "FRIENDS TV" removal work is ready to
ship with them. The permitted event is exactly one: a single bounded production apply carrying
`20260802170000`, `20260802171000` **and** the removal migrations together, in dependency order.

Why holding matters more than it looks. `20260802171000` sets `core.licensor` `FR` to
`status = 'inactive'`. The owner's later ruling is that `FR` was never a real licensor and must
be **REMOVED**. Promoting the pair alone would therefore change production master data twice —
first into `inactive`, a state the owner has explicitly rejected, and again later into removed —
and every production change on this lane is forward-only with no undo. Inside the one combined
push, `FR` passes through `inactive` without ever being an observable steady state.

**Current status: the legal event cannot be assembled.** No FR removal migration exists anywhere
in `supabase/migrations/` as of 2026-08-09. Until one does, any allowlist containing either
version is refused.

**This is enforced in code, not merely written down here.** `parse_allowlist` in
`scripts/production_migration_guard.py` carries a **co-presence rule** in the same shape as the
§6.8 all-four-or-none bundle rule: if either held version is present, the full FR ship set must
be present too, or it raises a `GuardError` naming §6.5. It sits in `parse_allowlist` — the one
function every entry point (`prepare`, `preflight`, `verify-dry-run`) must call — so no
subcommand routes around it.

**Deliberately NOT `HARD_BLOCKED`.** `HARD_BLOCKED` means *never, by any route*. §6.5 is not
that: it names a legal future event. Putting these versions in `HARD_BLOCKED` would force a
**guard edit** to perform a promotion the owner has already authorised, which is exactly the
kind of edit that gets made carelessly under deadline. Unblocking is instead a **data** change:
register the removal versions in `FR_REMOVAL_VERSIONS` in the same commit that adds the files,
and the combined promotion parses. Never delete the co-presence check to unblock a push.

**Negative-path tests** (`scripts/test_production_migration_guard.py`) prove the rule FIRES, not
that it exists: either held version alone errors; the pair alone errors; the pair inside a
realistic batch errors and the message names both versions; an allowlist with neither still
parses; and with removal versions registered, the complete ship set is accepted while every
proper subset that still holds a §6.5 version is rejected.

## 4. The three delegated decisions

### 4.1 `20260729120000` — **RETIRE.** Confirmed, and for a bigger reason than A1 gave.

A1 recommended retire because the migration's end state is already on production, produced
by `20260729130000` and `20260729180000`. **That attribution is correct and I re-derived it
independently rather than inheriting it.** Live, read-only:

```sql
select md5(p.prosrc), length(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='lock_down_new_public_function_execute';
-- 735985606362e0321231dc77a5863ec4 | 750
```

Against the repo, CRLF-normalised (`scripts/verify/migration_body_md5.py`, added by A1 —
**the CRLF trap is real; an LF md5 mismatches every applied function**):

| File | body md5 | len |
|---|---|---|
| `20260729120000` | `fdbf72e787af65ac139c40b1fed4f6d2` | 722 |
| `20260729180000` | **`735985606362e0321231dc77a5863ec4`** | **750** |

The live body is `20260729180000`'s, byte for byte. And the `alter default privileges`
end state:

```sql
select array_to_string(d.defaclacl,' | ') from pg_default_acl d
 join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and d.defaclobjtype='f';
-- postgres=X/postgres | service_role=X/postgres      <- anon + authenticated already gone
```

`20260729130000` (in the ledger) carries that identical statement at its line 52.

**The new and decisive finding.** A1 stopped at "superseded". The stronger fact is that
applying `20260729120000` would **actively regress production security**:

| | `20260729120000` (would apply) | `20260729180000` (live now) |
|---|---|---|
| event-trigger `when tag in` | `('CREATE FUNCTION')` | `('CREATE FUNCTION', 'CREATE PROCEDURE')` |
| loop filter | `command_tag = 'CREATE FUNCTION'` | `command_tag in ('CREATE FUNCTION','CREATE PROCEDURE')` |
| revoke statement | `revoke execute on function` | `revoke execute on routine` |

Both statements are `create or replace` / `drop event trigger ... create event trigger`, so
they overwrite unconditionally. `20260729120000` sorts **below** `20260729180000`, which is
already in the ledger and therefore **will not re-run to repair it**. Applying it in version
order would permanently narrow the public-schema execute lockdown so that newly created
**procedures** are no longer locked down at all.

Note that A1's own supporting argument — "its revokes target `sync_clickup_tasks`, which does
not exist, so it would abort" — **does not survive the full batch.** `20260728174500` (row 13)
creates `pim./public.sync_clickup_tasks` earlier in the same run, so in this batch the file
would *succeed*, and cause the regression quietly. The abort argument holds only for an
11-only or lone promotion. **This is exactly the kind of conclusion that must not be inherited.**

*Systematic check that this is the only one of its kind.* For every one of the 50, I listed
the objects it creates or replaces and looked for an **already-applied ledger migration with a
higher version** that writes the same object:

```
20260729120000 -> public.lock_down_new_public_function_execute  also written by applied ['20260729180000']
total hits: 1
```

**Exactly one hit.** (Limit of the scan, stated honestly: it cannot see objects created inside
`do $$` blocks via dynamic `execute`. The two known such cases —
`20260728171500` → `api.db_data_admin_licensor_property_tree` and `20260802170000` →
`plm.import_master_data` — were checked by hand and are *forward* moves over lower-versioned
applied creators (`20260727154500`, `20260723140000`), so they are intended, not regressions.)

### 4.2 `20260724060000` and `20260724061000` — **APPLY.** A1 left these UNKNOWN.

The measurement A1 could not make is a judgement, so here is the judgement with its reasoning.

**What they contribute to the end state: exactly nothing.** `20260726030000` (row 3, in the
same batch) re-issues every single object, grant and comment:

| Object | 060000 / 061000 | `20260726030000` |
|---|---|---|
| `plm.sync_coldlion_licensors_properties(jsonb,text)` | create | **`drop function if exists`** (L674), re-created at `(jsonb,text,jsonb)` |
| `public.sync_coldlion_licensors_properties(jsonb,text)` | create + wrapper | **`drop function if exists`** (L673), re-created at `(jsonb,text,jsonb)` |
| `api.coldlion_licensor_property_run_list(integer)` | create + revoke + grant | `create or replace`, **same signature**, same revoke + grant (L1402–1421) |

So retiring them loses nothing, and applying them costs two function bodies that are dropped
seconds later in the same push.

**Decision: APPLY. Three reasons, worst-case first.**

1. **Retiring them would manufacture two brand-new permanent ledger orphans** — two holes
   below the head, in a ledger whose 33 existing holes are the entire reason this plan exists.
   Fixing an orphan problem by creating orphans is the wrong direction.
2. **There is no retire mechanism yet.** A3 has not been built. `20260729120000` *forces* one
   to be invented, because it must never be applied. These two do not: they can simply run.
   Inventing an exception for files that need none adds a mechanism with no requirement.
3. **Skipping is the `--include-all`-shaped decision, not applying.** A1 says this itself.
   "Everything in version order" needs no judgement; "everything except these two" is a
   curated subset that a future reader has to re-justify.

**And unlike `20260729120000`, there is no regression risk.** Nothing already applied to
production is overwritten by them; their replacement is *inside the same batch*, so the
intermediate state never outlives the run. The one transient effect is that
`public.sync_coldlion_licensors_properties(jsonb,text)` exists for the duration of a few
files, granted to `service_role` only — and the live event trigger
`lock_down_new_public_function_execute_trg` fires on its creation and revokes execute from
`public`/`anon` immediately.

`20260726030000`'s drops are `drop function if exists`, so the batch is correct whichever way
this is decided. **This is a preference for ledger fidelity, not a correctness requirement**,
and it should be recorded as such.

## 5. Dependency order vs version order — they agree

⚠️ **Read with §4.3.** The preflight below was run over the **49** (50 minus the retired one),
which is what this document proposed before the §6.5 correction. The promotable set is now
**47**. The 47 is a prefix-and-suffix subset of the 49 — the two removed versions,
`20260802170000` and `20260802171000`, are rows 32 and 33, and nothing later in the batch
depends on either — so the ordering conclusion carries. **Re-run the preflight on the 47 before
any promotion anyway; do not inherit this.**

Run against the live ledger with the repo's own whole-batch checker (the same code path
`prepare` uses), after the fix in §6.1:

```
PREFLIGHT OK: 49 migrations, no missing non-deferrable dependency.
```

The 50-entry variant (i.e. `20260729120000` kept) also passes, which is the point: **the
static checker cannot see the `20260729120000` problem at all**, because a regression is not a
missing dependency. §4.1 is the only thing standing between that file and production.

Two orderings the plan calls out are satisfied by plain version order and were re-checked:
`20260728174500` before `20260729120000`; `20260807180000` before `20260807190000`.

⚠️ The preflight is a **pre-filter that may REJECT and must never be read as APPROVAL** — the
script says so itself, and that framing is correct.

## 6. The rehearsal

**Run:** https://github.com/u2giants/shared-db/actions/runs/31327934569
`workflow_dispatch` · `target: production` · `mode: dry-run` · `commit_sha`
`77c15acf8840f275c56c2a2199b860f1776cafe7` · `confirmation: DRY-RUN 77c15ac…` ·
`production_allowlist` = the 49. **That allowlist is now known to be policy-illegal (§4.3) and
must not be reused.** The record below is history, not a recipe.

**Result: `validate` succeeded; `production-dry-run` FAILED at "Build bounded checkout".**
The gate — "the dry-run output lists exactly the allowlist and nothing else" — was **not
reached**, so it is neither passed nor failed. It is untested. Nothing was written.

What the run *does* prove, and it is not nothing:

- `Refuse production apply` behaved (skipped, `mode` was `dry-run`).
- `Check exact confirmation` and `Verify exact main commit` both passed.
- **`Capture production migration record` succeeded** — the production credentials, the
  `supabase login`, and the `supabase link` all work. That was previously unproven.
- `parse_allowlist` accepted the 49: no `HARD_BLOCKED` collision, correct order, and the
  AGENTS.md §6.8 four-version ColdLion bundle is present in full.
  ⚠️ **It accepted the 49 because the §6.5 rule did not exist yet.** That acceptance is the
  defect §4.3 fixes: the same allowlist is now rejected, and a test asserts it.

### 6.1 Blocker 1 — a PARSING fault, fixed in this PR

The prompt warned the verifier is coupled to the Supabase CLI's output wording and that such a
failure would *look* like a migration fault. **This failure is of that family but at a
different site**, and the distinction matters:

```
BLOCKED: whole-batch preflight failed; the batch cannot run end to end:
  20260728174500 references missing pim.sync_clickup_tasks (query target);
  created by 20260728181500 which is not applied and not earlier in the batch
```

**This is false. `20260728174500` creates `pim.sync_clickup_tasks` itself, at its own line
216.** The batch is correctly ordered; the scanner is wrong.

**Root cause.** `strip_sql` ran three independent regex passes, and stripped dollar-quoted
bodies *before* comments. `20260728174500` line 46 contains, inside a `--` comment:

```sql
-- `create index if not exists`, `create or replace function`, guarded `do $$` block)
```

Postgres never sees that `$$`. The regex did: it became the opening half of a pair, matched
the next genuine `$$` at line 235, and **deleted every statement in between** — including the
`create or replace function pim.sync_clickup_tasks` at line 216. `created_objects()` returned
an **empty set** for a file that creates three functions.

**Blast radius: 8 of 411 files.** The worst is `20260727154500`, which is **already applied**;
its 17 objects were invisible in the `available` set that every later file is judged against.

**Fix (this PR):** `strip_sql` is now a single left-to-right lexer using Postgres's own token
precedence — line comments, nestable block comments, single-quoted literals, then dollar
quotes. String literals are skipped over but **kept**, because `REFERENCE_RES` deliberately
matches `'plm.seq'::regclass` inside a literal. 8 regression tests added
(`scripts/test_production_migration_guard.py`), including the exact false rejection above and
the real migration file. Suite: **32 tests, all pass.** A false REJECT was the safe direction,
but it blocked the lane completely.

### 6.2 Blocker 2 — STRUCTURAL, not fixed here, and it needs an owner/orchestrator decision

⚠️ **Even with §6.1 fixed, this rehearsal cannot pass as the workflow is written today**, and
this should be stated plainly rather than discovered on the next attempt.

31 of the 47 sort **below** the ledger head (33 of the 49 as originally run). `supabase db push --dry-run` refuses out-of-order
files without `--include-all`, and the workflow's dry-run step does not pass it. This is
**already documented and already observed**:
`docs/coldlion-production-migration-manifest-20260731.md` §4.2 and §5 record run
**30660298837** (2026-07-31) failing at the push step for exactly this reason.

**Two corrections to the plan follow from that:**

- The plan's "**nobody has ever run it**" is **stale.** It has been run, and it failed
  structurally. That is a stronger and more useful statement.
- That manifest also argues — correctly, in my reading — that `--include-all` **inside the
  guard's bounded checkout** is safe *by construction*, because `prepare` has already deleted
  every file that is neither already-applied nor allowlisted, so in that directory "all"
  means exactly the allowlist, and `verify-dry-run` then demands an exact match anyway.

**I did not act on that.** Adding `--include-all` anywhere is outside this task's hard limits,
and it is a change to the production lane that belongs to A3 and to the owner. It is
**recommended and flagged, not decided.**

⚠️ **Correction, after review (§8).** My first draft of this section said two things that were
wrong, and both are corrected here rather than quietly edited away:

- I wrote that adding `--include-all` was an undecided policy question. **It is already decided
  and written down.** `AGENTS.md` §5.1 step 4 says, verbatim, that in a bounded temp checkout
  *"that flag is the correct and safe way to finish"* and that *"the §5.1 prohibition is on
  `--include-all` against the **full repo set**, never against a verified bounded set."*
  So A3 is **implementing existing repo policy in the workflow**, not making a new ruling.
  I still did not implement it — that is outside this task's limits — but the framing
  "flagged, not decided" understated how settled it is.
- I wrote that the bounded checkout "deletes nothing". **Off by one, and the one matters.**
  `keep = remote | allowlist` = 361 + 47 = **408 of 411**. The three files it deletes are
  `20260729120000` (retired) and the two §6.5-HELD versions. So the pruning is doing exactly one
  job: enforcing the retirement and the hold. (As originally written against the 49 it was
  361 + 49 = 410 of 411, deleting only the retired file.)

That last point is why the retirement is no longer prose-only (§6.3).

### 6.3 The retirement is now MECHANICAL, not prose

**Kimi K3's blocking finding, accepted.** As first written, "RETIRE `20260729120000`" lived only
in this document. Any future session that assembled the allowlist from the 50 missing versions —
the obvious, natural thing to do — would have included it and regressed production.

`20260729120000` is now in `HARD_BLOCKED` in `scripts/production_migration_guard.py`, so
`parse_allowlist` refuses any allowlist containing it, from every entry point (`prepare`,
`preflight`, `verify-dry-run`). It is a **third kind** of entry there and is commented as such:
the existing pair is *already applied, never re-run*; this one is *never applied, and must never
be applied*. Both kinds are "never put this in an allowlist", which is what the set enforces.

This is a change to production-lane policy made by a sub-agent, so it is called out here and in
PR #608 for the orchestrator and owner to accept or revert deliberately. It is **fail-closed**:
it can only ever refuse more, never permit more.

## 7. The whole-batch rehearsal has NOT been done, and it is the real gate

**Kimi K3's second blocking finding, accepted in full — this is the most important open risk.**

Nothing in this document proves the 47 can actually *run*. A dry-run prints a plan; it executes
no SQL. The guard's own preflight says of itself that it "may REJECT but must never be read as
APPROVAL", and names the authoritative gate: **a rehearsal of the whole batch against a
production-shaped scratch database** (`production_migration_guard.py`, and
`docs/production-migration-lane-design-20260802.md` §2.3, Change C).

**Why this is not a formality.** `supabase db push` wraps each *file* in a transaction, not the
batch. A failure at file 45 of 47 leaves **44 migrations applied and production partially
promoted, with no undo.** Several files in this batch carry `do $$` blocks with `raise
exception` guards and seeded DML (`20260731220000` approves five aliases; `20260802171000`
performs an owner-ruling update; `20260809170100`/`20260809170200` seed from external sources)
— assertions that pass or fail on *data*, which no static scan and no dry-run can predict.

**Nothing may be applied to production until that rehearsal has been run and has passed.** It
requires creating a scratch database, which this task was explicitly forbidden to do
(no `--create`). It belongs to A3/A5 and it should be treated as a hard precondition of A4,
not as a nice-to-have.

## 7a. Corrections the plan file needs — for the orchestrator, who owns it

This sub-agent may not edit `plan_orchestrator-workflow-gaps.md`. These are the specific places
it now contradicts measured reality:

| Where | Says | Should say |
|---|---|---|
| §A2 and its gate | allowlist = "the **11**"; gate = "lists exactly those 11" | the **47** (50 minus the retired one and the two §6.5-HELD ones) |
| §A4 owner-gate sentence | "Apply the **11** pending migrations … **without** `--include-all`" | the **47**; and *with* a bounded `--include-all`, which `AGENTS.md` §5.1(4) already sanctions. **As written, the owner would be authorising something that cannot run.** |
| Constraint 4 | "Never `--include-all` against production" | never against the **full repo set**; permitted against a verified bounded set (`AGENTS.md` §5.1(4)) |
| §A "Measured starting position" | 405 files, 44 behind | **411** files, **50** behind |
| §A2 preamble | "nobody has ever run it" | it **has** been run: run 30660298837 (2026-07-31) failed structurally, and run 31327934569 (today) failed on the guard defect |
| §A5 | verifies "each of the 11" | must verify the 47, and must include the post-apply checklist that `20260804120100` carries in its own text |

## 8. The Kimi K3 review — where it moved me, and where it did not

Continued in the warm session `intake-to-issues-plan`, which already held five rounds of this
repo's context. It was asked "**what did I miss, and where is this ordering wrong?**" rather
than "review this".

**Where it changed the work (all accepted, all fixed in this PR):**

1. **The retirement was prose-only.** Correct and blocking. → `HARD_BLOCKED` (§6.3).
2. **The whole-batch rehearsal is unevidenced, and a mid-batch assertion failure leaves
   production partially promoted.** Correct and blocking. → §7. I had treated "preflight OK +
   dry-run" as most of the way there; it is not, and the guard's own header says so.
3. **`AGENTS.md` §5.1(4) already licenses bounded `--include-all`.** I checked; it does,
   verbatim. My "flagged, not decided" framing was too weak. → §6.2.
4. **My "deletes nothing" caveat is off by one.** It deletes exactly one file: the retired one,
   which is the only enforcement there was. → §6.2. This is what made finding 1 blocking rather
   than tidy.
5. **Lexer gaps: `E'...\'...'` backslash escapes and double-quoted identifiers.** Both real.
   A plain `'...'` honours only `''`, but `E'...'` honours backslashes, so `E'it\'s'` was
   mis-terminated. `"weird--name"` could inject a phantom comment. → both fixed, both tested.
6. **Delete the dead regex constants.** Agreed — a leftover `DOLLAR_QUOTE_RE` is an invitation
   to reintroduce the defect. Removed, with a note saying why they are gone.

**Where we agreed from the start** (it called these "NO OBJECTION", having verified them against
the files itself): RETIRE for `20260729120000`, including that my regression table is accurate
and that my demolition of A1's "would abort" argument is correct in-batch; APPLY for
`20260724060000`/`20260724061000`, on the convergent-replacement evidence at
`20260726030000:673-674,1402-1421` and on 411-files/411-rows being the right end state; and the
root-cause diagnosis of the rehearsal failure.

**Where I did not follow it.**

- It suggested **neutralising `20260729120000`'s body** in addition to blocking it. I declined:
  editing `supabase/migrations/` is forbidden to this task, and rewriting a historical migration
  file to make it inert is a heavier, more surprising act than refusing it at the gate. The
  `HARD_BLOCKED` entry plus the bounded checkout's deletion are two independent enforcements
  already. **Recorded as a live disagreement**, not as settled — if the owner prefers the
  stronger form, it is a small change.
- It asked for a **catalog-sweep scan** and a **phantom-creator diff-scan** over the apply set. The
  second I had already done and simply had not shown: it is the 8-file blast-radius measurement
  in §6.1, produced by diffing `created_objects()` old-vs-new across all 411 files. Re-run after
  the lexer changes, only the two whole-file `do $migration$`-wrapped migrations
  (`20260707171500`, `20260708183000`) still yield an empty set, which is the documented
  dynamic-`execute` blind spot and not a defect. The broader catalog sweep I did **not** do; it
  is subsumed by §7's rehearsal, which is the honest gate, and I would rather name that than
  add another static scan that also cannot approve.
- It flagged `20260803200000`'s snapshot DML as unexamined. **True, and I am leaving it that
  way** rather than pretending otherwise — it is exactly the class of data-dependent behaviour
  that only §7's rehearsal can settle.

## 9. What was NOT done

- **No production apply, no DDL, no DML, no ledger insert, no `--include-all`, no `--create`.**
  Every production statement was a `select`. The only workflow run was `mode: dry-run`.
- **`supabase/migrations/` was not touched.** No migration was added, edited, retired or deleted.
  "RETIRE" here is a *recommendation about the allowlist*, not an action on a file.
- `AGENTS.md`, `HANDOFF.md`, `HANDOFF.d/**` and `plan_orchestrator-workflow-gaps.md` were not
  touched — the orchestrator owns the plan file and records drift itself.
- Preview (`rjyboqwcdzcocqgmsyel`) was not queried or modified.
- **No PR was merged.**
- **Blocker 2 (§6.2) was not fixed.** The lane still cannot complete a dry-run of this set.
- **The whole-batch rehearsal (§7) was not run.** It needs a scratch database, which this task
  was forbidden to create. It is a hard precondition of A4.
- The A2 gate — "the dry-run output lists exactly the allowlist" — is **still unproven.**
- **The rehearsal was not re-run after the Kimi fixes, and could not be.** The
  `production-dry-run` job asserts `HEAD == origin/main == commit_sha`, so it can only ever
  test `main`. It cannot test PR #608's branch. A re-run today would reproduce the same
  failure byte for byte, because `main` still carries the guard defect. **The first action
  after #608 merges must be to re-run the dispatch at the new `main` SHA with the **47**-entry
  allowlist** — at which point it should get past "Build bounded checkout" and fail instead
  at the Supabase CLI on blocker 2 (§6.2). That prediction is recorded here so the next
  session can falsify it.

---

## 10. Second pass, 2026-08-09 — what this revision changed

A follow-up sub-agent of the same orchestrator session reviewed this document against two AI
reviews (Kimi K3, folded in above; Grok 4.5, `.ai/reviews/20260809-pr608-apply-set-grok45.md`).

**Changed here:**

- `20260802170000` and `20260802171000` moved from **APPLY** to **HELD (§6.5)**; the promotable
  count moved from 49 to **47**; every total, allowlist string and derived count restated (§0,
  §3, §4.3, §5, §6, §7).
- New **§4.3** records the ruling, why the hold is a co-presence rule rather than
  `HARD_BLOCKED`, and how it is unblocked when the FR removal migrations exist.

**Changed in code (same commit):** a §6.5 co-presence rule in `parse_allowlist`
(`scripts/production_migration_guard.py`) with negative-path tests
(`scripts/test_production_migration_guard.py`).

**Considered and deliberately NOT done: neutralizing `20260729120000`'s body.** Grok argued the
`HARD_BLOCKED` entry guards only one script, so the harmful body still sits on disk for an
unguarded full-tree push, and that §4 rule 4 does not apply because the migration "was never
applied". **The premise is wrong.** It was never applied to *production*, but it **was** applied
to the hosted preview branch on 2026-07-29 —
`docs/security/public-schema-execute-audit.md` §5 records a live preview measurement taken
"immediately after `20260729120000`", and §9 says only production skipped it. Rule 4 says
"applied **anywhere**". GLM 5.2 was asked to adjudicate
(`.ai/reviews/glm-pr608-blocker2-neutralize-vs-gate-*.md`) and reached the same conclusion:
neutralizing manufactures exactly the file/ledger desync rule 4 exists to prevent — the preview
ledger row would point at on-disk text that never ran — while the threat it addresses
(unbounded `--include-all`) is already banned outright by §5.1. **Refuse at the gate; keep the
`HARD_BLOCKED` entry; do not edit the file.**

**Open recommendation, not implemented here** (out of this task's scope, for the orchestrator to
schedule): GLM's third point. The path-independent fix for "a harmful body sits on disk and only
one code path refuses it" is a **new forward migration**, timestamped above `20260729180000`,
that re-asserts the broad lockdown (`CREATE PROCEDURE` coverage, `revoke ... on routine`). Then
`20260729120000` is inert on every path, including a replay, with no edit and no desync. The
`HARD_BLOCKED` entry stays regardless — that is the gate defence; the new migration is the
path-independent one.
