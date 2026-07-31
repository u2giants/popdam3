# ColdLion Licensor/Property — TRUE production migration manifest (2026-07-31)

**Status:** re-derived from the live production ledger. Supersedes the migration
lists in `docs/coldlion-source-of-truth-plan.md` and in the Step 7 change package,
both of which are **incomplete and unsafe to promote from**.

**Derived at:** 2026-07-31, ~19:45–20:05 UTC
**Production project ref:** `qsllyeztdwjgirsysgai` (confirmed via `get_project_url`
before every database read; preview `rjyboqwcdzcocqgmsyel` was never touched)
**Repo commit the manifest is derived against:** `c7321b5f0633df80b266612f6adcd86a1cc07c41` (`origin/main`)

> This document is **read-only analysis**. Nothing here was applied. See
> "What was deliberately NOT done" at the bottom.

---

## 0. The headline

The cutover plan lists **four** migrations. The true ColdLion Licensor/Property
promotion set is **eighteen**.

Verified by grepping `docs/coldlion-source-of-truth-plan.md` for each of the
eighteen versions:

| In the plan doc | Absent from the plan doc |
| --- | --- |
| `20260729230000`, `20260729234500`, `20260729235500`, `20260730000500` | the other **14**, including `20260731163000`, `20260731190000` and `20260731200000` |

Anyone building a production promotion list from that document would ship
**4 of 18** — a partial fix that leaves the recurring promotion feed with known
defects (drop-dead failure recording, serialization lock, provenance coverage,
fan-in name tiebreak) still absent from production.

---

## 1. How the manifest was derived (never counted from a document)

1. Read the live production ledger:
   `select version from supabase_migrations.schema_migrations` against
   `qsllyeztdwjgirsysgai` — **358 rows**, max version `20260729210000`.
2. Enumerated `supabase/migrations/*.sql` at `origin/main` — **385 files**,
   zero duplicate versions.
3. Pending = local versions absent from the ledger → **27**.
4. Cross-check: `remote-not-local` is **empty** — production carries no ledger row
   without a matching repo file. The two sets differ only by the 27 pending.

385 − 358 = 27. ✅

---

## 2. The full pending manifest — 27 migrations

### (a) ColdLion Licensor/Property promotion set — **18**

In apply order. `[HARD-BLOCKED]` marks versions the general production lane
refuses (see §4).

| # | Version | Filename |
| --- | --- | --- |
| 1 | `20260724060000` | `20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql` |
| 2 | `20260724061000` | `20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql` |
| 3 | `20260726030000` | `20260726030000_coldlion_licensor_property_phase4_link_approved.sql` **[HARD-BLOCKED]** |
| 4 | `20260726031000` | `20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql` **[HARD-BLOCKED]** |
| 5 | `20260726032000` | `20260726032000_coldlion_licensor_property_phase4_browser_execute_revoke.sql` **[HARD-BLOCKED]** |
| 6 | `20260726180000` | `20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` **[HARD-BLOCKED]** |
| 7 | `20260727221500` | `20260727221500_coldlion_licensor_property_readiness_and_breaker.sql` |
| 8 | `20260727223000` | `20260727223000_coldlion_breaker_blocked_attempt_logging_fix.sql` |
| 9 | `20260727224500` | `20260727224500_coldlion_identity_verifier_reason_cast_fix.sql` |
| 10 | `20260728134500` | `20260728134500_coldlion_breaker_autotrip_and_gap_closure.sql` |
| 11 | `20260729230000` | `20260729230000_coldlion_licensor_property_recurring_promotion.sql` |
| 12 | `20260729234500` | `20260729234500_coldlion_recurring_promotion_collision_rule_fix.sql` |
| 13 | `20260729235500` | `20260729235500_coldlion_recurring_promotion_ambiguous_column_fix.sql` |
| 14 | `20260730000500` | `20260730000500_coldlion_recurring_promotion_absence_detection_fix.sql` |
| 15 | `20260731163000` | `20260731163000_coldlion_recurring_promotion_drop_dead_failure_recording.sql` |
| 16 | `20260731180000` | `20260731180000_coldlion_recurring_promotion_serialization_lock.sql` |
| 17 | `20260731190000` | `20260731190000_coldlion_promotion_crosscheck_provenance_coverage.sql` |
| 18 | `20260731200000` | `20260731200000_coldlion_recurring_promotion_fanin_name_tiebreak.sql` |

### (b) UNRELATED pending migrations — **9** — MUST NOT be swept along

These belong to four other workstreams. They are pending on production for their
own reasons and are **not** part of this promotion.

| Version | Filename | Workstream |
| --- | --- | --- |
| `20260727230000` | `20260727230000_core_style_guide_axis.sql` | Characters & style guides, Phase 2 |
| `20260728171500` | `20260728171500_db_data_admin_tree_plm_division_names.sql` | DB Data Admin tree |
| `20260728174500` | `20260728174500_clickup_incremental_task_import_reissue.sql` | ClickUp import |
| `20260728181500` | `20260728181500_clickup_incremental_task_import_fixes.sql` | ClickUp import |
| `20260729120000` | `20260729120000_lock_down_public_security_definer_execute.sql` | public-schema EXECUTE lockdown |
| `20260731150000` | `20260731150000_popsg_property_resolution_contracts.sql` | PSG-5 PopSG property reconciliation |
| `20260731153000` | `20260731153000_popsg_property_alias_redundancy_trigger_fix.sql` | PSG-5 corrective |
| `20260731210000` | `20260731210000_core_licensor_alias.sql` | Licensor alias / owner gate |
| `20260731220000` | `20260731220000_licensor_alias_owner_approval_remaining_five.sql` | Licensor alias / owner gate |

> The brief estimated "~15 unrelated". The live count is **9**. 18 + 9 = 27. ✅
> Note `20260731210000` / `20260731220000` concern *Licensor aliases* and read as
> ColdLion-adjacent by name. They are **not** ColdLion: they belong to the PopSG
> property-taxonomy reconciliation plan and depend on `20260731150000`, not on any
> ColdLion object. Do not fold them in.

---

## 3. Ordering constraints — verified against live production

Each dependency was verified by asking production whether the required object
actually exists, not by reading a ledger row.

### 3.1 REQUIRED: `20260729120000` with-or-after `20260728174500`

**Confirmed.** `20260729120000_lock_down_public_security_definer_execute.sql`
contains, at lines 243–247, *unqualified* privilege statements:

```sql
revoke execute on function public.sync_clickup_tasks(jsonb, text) from public, anon, authenticated;
grant  execute on function public.sync_clickup_tasks(jsonb, text) to service_role;
revoke execute on function pim.sync_clickup_tasks(jsonb, text) from public, anon, authenticated;
grant  execute on function pim.sync_clickup_tasks(jsonb, text) to service_role;
```

There is no `if exists` guard. Live production check:

```sql
select to_regprocedure('public.sync_clickup_tasks(jsonb,text)'),  -- NULL
       to_regprocedure('pim.sync_clickup_tasks(jsonb,text)');     -- NULL
```

Both are **NULL** — the function does not exist on production, because
`20260728174500` (which creates it) is itself still pending. Applying
`20260729120000` first therefore aborts the whole transaction with
`undefined_function` (SQLSTATE 42883).

**Both migrations are in the UNRELATED set**, so this constraint does not bind the
ColdLion promotion — but it absolutely binds anyone who later promotes the
unrelated backlog, and it is the reason `--include-all` over the whole repo is
dangerous.

### 3.2 ALSO REQUIRED (newly found): `20260731210000` after `20260731150000`

`20260731210000_core_licensor_alias.sql` calls
`core.normalize_popsg_property_observation(text)` inside a
`GENERATED ALWAYS ... STORED` column (line 133) and a `CHECK` constraint (line 163),
plus several function bodies. Live production check:

```sql
select to_regprocedure('core.normalize_popsg_property_observation(text)');  -- NULL
```

**NULL.** That function is created by `20260731150000`. Promoting `20260731210000`
without it aborts with `undefined_function` in exactly the same way.

### 3.3 ALSO REQUIRED: `20260731220000` after `20260731210000`

`20260731220000` is owner-approval DML against `core.licensor_alias`.
`select to_regclass('core.licensor_alias')` on production returns **NULL** — the
table is created by `20260731210000`. Strict predecessor.
(`20260731153000` is likewise a corrective forward migration for `20260731150000`.)

### 3.4 The ColdLion chain is strictly linear and self-contained

Every one of the 18 ColdLion files references only ColdLion versions **earlier than
itself** (checked by scanning each file for 14-digit version references). The chain's
only external predecessor is `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`,
which **is already applied on production** (present in the ledger). ✅

No ColdLion migration depends on any of the 9 unrelated migrations, and no unrelated
migration depends on any ColdLion migration. **The two sets are cleanly separable.**

---

## 4. Two blockers that stop the general production lane today

### 4.1 Four ColdLion migrations are HARD-BLOCKED by the guard

`scripts/production_migration_guard.py` carries a `HARD_BLOCKED` set. Four of the
eighteen are in it:

```
20260726030000, 20260726031000, 20260726032000, 20260726180000
```

Feeding the full 18-version allowlist to the lane is rejected outright:

```
$ python scripts/production_migration_guard.py prepare --allowlist "<all 18>" ...
BLOCKED: general production lane blocks: 20260726030000, 20260726031000, 20260726032000, 20260726180000
```

**The general `production-dry-run` lane can therefore never carry the whole ColdLion
set.** Those four need a dedicated lane or an explicit, owner-approved change to
`HARD_BLOCKED`. That decision is not this document's to make.

### 4.2 `supabase db push` will not apply the set without `--include-all`

Six of the fourteen promotable ColdLion versions (`20260724060000` … `20260728134500`)
are **older than production's ledger head** `20260729210000`. Supabase's push refuses
out-of-order files. From the real CI dry-run (§5):

```
Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag to apply these migrations:
  supabase/migrations/20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql
  supabase/migrations/20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql
  supabase/migrations/20260727221500_coldlion_licensor_property_readiness_and_breaker.sql
  supabase/migrations/20260727223000_coldlion_breaker_blocked_attempt_logging_fix.sql
  supabase/migrations/20260727224500_coldlion_identity_verifier_reason_cast_fix.sql
  supabase/migrations/20260728134500_coldlion_breaker_autotrip_and_gap_closure.sql
```

This is the crux, and it is why the blanket "never `--include-all`" rule needs a
precise restatement:

- `--include-all` **in the full repo checkout** is catastrophic — it sweeps all 27
  pending migrations, including the 9 unrelated and the 4 hard-blocked.
- `--include-all` **inside the guard's bounded checkout** is the *only* way this set
  can ever apply, and is safe **by construction**, because `prepare` has already
  deleted every migration file that is neither already-applied nor allowlisted. In
  that directory "all" means exactly the allowlist.

The workflow's dry-run step does not pass `--include-all`, so the lane currently
**fails closed** on this promotion set. It cannot even produce a plan. Fixing that
is a change to `.github/workflows/shared-supabase-migrations.yml` and is out of
scope here; it is flagged for the coordinator.

---

## 5. Dry-run evidence — the unrelated migrations stay out

### 5.1 Local bounded-checkout proof (`prepare`, fully offline)

Ran `scripts/production_migration_guard.py prepare` with the 14 promotable ColdLion
versions and the live production ledger:

```
bounded checkout file count: 372   ( = 358 already applied + 14 allowlisted )
UNRELATED pending present in bounded checkout?  NONE
  20260727230000 20260728171500 20260728174500 20260728181500 20260729120000
  20260731150000 20260731153000 20260731210000 20260731220000   -> all absent
HARD_BLOCKED ColdLion present?                 NONE
all 14 allowlisted versions present:           ok (14/14)
```

The arithmetic is the proof: 372 files, not 385. The 13 excluded files are exactly
the 9 unrelated + the 4 hard-blocked.

### 5.2 Real CI production-dry-run lane

Dispatched the read-only `production-dry-run` lane
(`target=production`, `mode=dry-run`) against commit `c7321b5`:

**Run:** https://github.com/u2giants/shared-db/actions/runs/30660298837
**Result:** `validate` succeeded; `production-dry-run` **failed at the push step**,
for the `--include-all` reason in §4.2 — *not* for any allowlist violation.

What it proves, from the log:

- The lane linked to `qsllyeztdwjgirsysgai` and printed
  `DRY RUN: migrations will *not* be pushed to the database.`
- The guard accepted the 14-version allowlist and built the bounded checkout.
- The push step listed **only ColdLion migrations**. Not one of the 9 unrelated
  versions appears anywhere in its output. ✅
- Exit code 1, nothing applied.

**Production was verified unchanged after the run:** `count(*) = 358`,
`max(version) = 20260729210000` — byte-identical to the reading taken before it.

---

## 6. Recommended promotion order (for the coordinator — NOT executed)

1. Resolve §4.1 (the 4 hard-blocked phase4/phase6 versions) — owner decision.
2. Resolve §4.2 (bounded `--include-all`) — workflow change.
3. Promote the ColdLion 18 in the table order of §2(a). No interleaving with §2(b).
4. Keep the 9 unrelated migrations as a **separate** promotion, and when that day
   comes honour §3.1–§3.3: `20260728174500` before `20260729120000`;
   `20260731150000` before `20260731210000` before `20260731220000`.
5. Arming the recurring feed (`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`) is an
   **Albert-only owner gate** and is not part of the migration promotion.

---

## What was deliberately NOT done

- **No production mutation.** No `supabase db push`, no promotion, no apply, no
  hand-run migration command, no DDL. Every database call was a `SELECT` /
  `to_regclass` / `to_regprocedure` read.
- **Never `--include-all`** was executed anywhere. §4.2 documents it; it was not run.
- **The preview database `rjyboqwcdzcocqgmsyel` was never contacted** (a rehearsal
  agent is live on it).
- `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` was **not** set, and nobody was
  asked to set it.
- **No file under `supabase/migrations/` was created, edited or deleted** in the repo.
  (The guard's bounded checkout is a throwaway detached worktree outside the repo
  tree; it was removed afterwards.)
- `docs/verification/`, `HANDOFF.md` and `AGENTS.md` were **not** touched — other
  owners this session.
- The PR carrying this document was **not merged**; the coordinator merges.
