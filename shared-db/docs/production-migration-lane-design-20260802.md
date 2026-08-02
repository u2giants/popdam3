# Production migration promotion lane — design (2026-08-02)

**Status:** DESIGN ONLY. Nothing here was implemented. No workflow, guard script,
or migration file was modified. No production or preview mutation of any kind.

**Author:** sub-agent `prod-lane-design`, dispatched by the shared-db coordinator.
**Scope:** fix the blocker recorded as §5.3 of
`HANDOFF.d/20260731T231155Z-t16-coordinator-session-handover.md` — *the production
promotion lane cannot produce a plan.*

**Target proof (required by the owner rule ruled 2026-08-02):** `get_project_url`
was called before every database read and returned
`https://qsllyeztdwjgirsysgai.supabase.co` — **production**. Every statement issued
was a `select` / `to_regclass` / `to_regprocedure`. The preview project
`rjyboqwcdzcocqgmsyel` was never contacted.

---

## 0. HEADLINE — read this before anything else

There are **two** blockers, not one, and the second was not previously known.

1. **The known blocker (§5.3).** The lane's dry run fails because six of the
   fourteen promotable ColdLion migrations sort older than production's ledger
   head, and `supabase db push` refuses out-of-order files without
   `--include-all`. **This design fixes it**, safely and boundedly, and the fix is
   demonstrated below with a real, offline, zero-side-effect simulation that
   produces the exact plan.

2. **A NEW blocker found while designing the fix, and it is worse.**
   **The 14-migration "promotable" set cannot apply to production at all.** Two of
   the fourteen have hard, non-deferrable dependencies on database objects created
   by migration `20260726180000` — which is one of the four **HARD-BLOCKED**
   migrations. Verified against live production: those objects **do not exist**.
   Applying the 14 as currently listed aborts with `undefined_table`
   (SQLSTATE **42P01**), *after* partially applying earlier files in the batch.

   This means the manifest's claim in
   `docs/coldlion-production-migration-manifest-20260731.md` §3.4 — *"the chain's
   only external predecessor is `20260724030000`, which is already applied"* — is
   **incomplete and unsafe to promote from**. It is stated loudly here as the
   brief instructed. See §3.

**Consequence for the coordinator:** fixing the workflow makes the lane *able to
produce a plan*, which is genuine progress and is the acceptance gate the brief
asked for. It does **not** make the promotion runnable. The owner decision on the
four hard-blocked migrations is now on the critical path for Step 8, not a
side-quest.

---

## 1. The problem, stated precisely, with evidence

### 1.1 Live production state (re-verified at design time, 2026-08-02)

| Fact | Value | How |
| --- | --- | --- |
| Project ref | `qsllyeztdwjgirsysgai` | `get_project_url` |
| Ledger rows | **359** | `select count(*) from supabase_migrations.schema_migrations` |
| Ledger head | **`20260731230000`** | `select max(version) …` |
| Local migration files | **386** | `supabase/migrations/*.sql` at this branch's base |
| Pending (files − ledger) | **27** | set difference, computed offline |

386 − 359 = 27. ✅ This agrees exactly with handover §3.3 and confirms the "~15
unrelated" figure in older docs is wrong. The split is 18 ColdLion + 9 unrelated.

### 1.2 Why the lane cannot produce a plan

`.github/workflows/shared-supabase-migrations.yml`, step **"Run and verify bounded
dry-run"** (line 165) runs:

```bash
supabase db push --dry-run 2>&1 | tee "$RUNNER_TEMP/production-dry-run.txt"
```

Six of the fourteen promotable versions — `20260724060000`, `20260724061000`,
`20260727221500`, `20260727223000`, `20260727224500`, `20260728134500` — sort
**below** the ledger head `20260731230000`. The Supabase CLI refuses to plan them:

```
Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag to apply these migrations:
  supabase/migrations/20260724060000_…sql
  …
```

Exit code 1. The `verify-dry-run` guard step never runs, because the marker string
`Would push these migrations:` never appears. **The lane fails closed and emits no
plan.** This is not transient; it will never resolve by retrying.

### 1.3 Why the naive fix is unacceptable

Adding `--include-all` to the *repo* checkout would sweep **all 27** pending
migrations into production — including the 9 unrelated ones and the 4 hard-blocked
ones. That is precisely the accident the "never `--include-all`" rule exists to
prevent, and §5.4's `undefined_function` trap (`20260729120000` grants EXECUTE on
`public.sync_clickup_tasks`, which does not exist on production because
`20260728174500` is itself pending) would fire inside that sweep.

---

## 2. The design

### 2.1 The one-sentence idea

`--include-all` is only dangerous because of **what is in the directory** — so
constrain the directory, not the flag: run the push inside the guard's bounded
checkout, where by construction the only unapplied files present are exactly the
approved allowlist, and then re-prove that from the dry-run output before any apply.

### 2.2 Why this is bounded, not blanket

`scripts/production_migration_guard.py prepare` (lines 99–118) already:

1. Rejects an allowlist that is empty, non-14-digit, duplicated, **out of order**
   (`values != sorted(values)`), or that intersects `HARD_BLOCKED`.
2. Rejects versions unknown locally or **already applied** on production.
3. Creates a detached `git worktree` at the exact approved commit SHA.
4. Computes `keep = remote_ledger ∪ allowlist` and **deletes every migration file
   not in `keep`**.
5. Asserts the surviving file set equals the expected set, or raises.

Therefore, inside that directory:

```
files_present − ledger  ==  allowlist        (exactly, and in version order)
```

`--include-all` means *"apply every local file not in the remote ledger"*. In the
bounded checkout that set **is** the allowlist. The word "all" has been redefined
by deletion. This is the key property, and §5 proves it empirically.

### 2.3 The exact changes proposed (NOT made — implementation is a separate dispatch)

**Change A — workflow, one line.** In `.github/workflows/shared-supabase-migrations.yml`,
step "Run and verify bounded dry-run":

```diff
-          supabase db push --dry-run 2>&1 | tee "$RUNNER_TEMP/production-dry-run.txt"
+          # Safe ONLY because production_migration_guard.py prepare has already
+          # deleted every migration file that is neither already-applied nor
+          # allowlisted. In THIS directory, "all" == the approved allowlist.
+          # NEVER add this flag to a full repo checkout.
+          supabase db push --dry-run --include-all 2>&1 | tee "$RUNNER_TEMP/production-dry-run.txt"
```

The comment is part of the change, not decoration: the next reader must not be able
to copy the flag out of context.

**Change A also REQUIRES a test rewrite that this design initially missed.**
`scripts/test_production_migration_guard.py` line 96 currently asserts:

```python
self.assertNotIn("--include-all", production)
```

Change A **breaks this test**. It must be *rewritten, never deleted* — deleting it
removes the only automated statement of the rule. The replacement must assert the
narrower true invariant: that `--include-all` appears **only** on a `db push` line
that is preceded by a `cd "$RUNNER_TEMP/bounded-production"` in the same `run:`
block, and **never** on a `db push` executed from `$GITHUB_WORKSPACE` or in the
`preview` job. That test is what stops a future drive-by edit from moving the flag
out of the bounded directory, which §6 row 10 correctly identifies as this design's
weakest link.

**Change B — guard, a new `assert-bounded` subcommand (defence in depth).** After
`prepare`, before the push, assert the invariant directly rather than trusting it:

```
python scripts/production_migration_guard.py assert-bounded \
  --checkout "$RUNNER_TEMP/bounded-production" \
  --remote-ledger "$RUNNER_TEMP/production-ledger-before.txt" \
  --allowlist "$PRODUCTION_ALLOWLIST"
```

It recomputes `sorted(local_migrations(checkout) − remote)` and requires exact
list equality with the allowlist. This turns "safe by construction" into "safe and
checked", and it fails *before* the CLI is ever pointed at production.

**Change C — guard, a dependency-closure check (the §5.4 defence).** `prepare`
gains an assertion that the allowlist is **dependency-closed**: for every
allowlisted file, any migration version it textually references, and any
schema-qualified object it references in a non-deferrable position, must be either
already in the ledger or earlier in the allowlist. Non-deferrable positions are the
ones Postgres resolves at DDL time and cannot defer to first call:

- `references <schema>.<table>` in a `create table`
- `create trigger … on <schema>.<table>` and `drop trigger … on <schema>.<table>`
- `alter table <schema>.<table>`
- `create index … on <schema>.<table>`
- a function call inside a `generated always as … stored` expression or a
  `check` constraint
- `grant` / `revoke … on function <schema>.<fn>(…)` without an `if exists` guard

**REVISED after review (§11 finding R4 — the review's strongest point).** The
text-scanning specification above is **not a sound algorithm** and must not be
shipped as if it were. It repeats the class of mistake that produced the incomplete
manifest §3.4: a regex over the same files, with a list of DDL positions someone
remembered on the day. It both false-positives (a version in a prose comment) and
false-negatives (`create view`, `create type`, `language sql` bodies, dynamic
`execute format(...)`, and `create table if not exists` where the table already
exists so the new FK is silently skipped).

The sound version is **catalogue-based, not text-based**, and it is the one to
implement:

> For the allowlisted batch, apply it **to a scratch database seeded to
> production's exact ledger state** — the preview project or an ephemeral branch,
> never production — and require it to complete. Then assert the §7 object
> checks there. A batch that cannot apply to a production-shaped database is not
> promotable, whatever a static scan says.

Text scanning is retained only as a **fast pre-filter that can reject, never
approve**: cheap enough to run on every dispatch, and it does catch the §3 case.
The authoritative gate is the rehearsal. Anything less is paper closure.

**Change D — post-apply object verification (see §7).** A ledger row is not
evidence. The apply step must be followed by an object-existence assertion.

### 2.4 What the design deliberately does NOT do

- **Does not add `--include-all` to the preview lane or to any full-repo checkout.**
  Only to the bounded checkout, guarded on both sides.
- **Does not touch `HARD_BLOCKED`.** The four phase4/phase6 versions stay blocked.
  That is an owner gate and is explicitly not this design's call — even though §3
  shows the promotion cannot proceed without resolving it. The correct escalation
  is to hand the owner the finding, not to edit the set.
- **Does not enable CI apply-to-production.** The workflow's "Refuse production
  apply" step (line 111) stays exactly as it is. Production apply remains the
  local, manual, bounded procedure of `AGENTS.md` §5.1.
- **Does not promote the 9 unrelated migrations,** and does not propose an order
  for them beyond restating the manifest's constraints.
- **Does not arm `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`.** Owner-only.
- **Does not widen the allowlist to include the 4 hard-blocked versions** as a
  workaround for §3.
- **Does not weaken `verify-dry-run`'s exact-ordered-equality check** to accommodate
  anything.

---

## 3. NEW FINDING — the 14-set is not applicable (SQLSTATE 42P01)

This was found by checking object dependencies rather than version-number
references. The manifest checked the latter only, which is why it was missed.

### 3.1 The dependencies

`20260726180000_coldlion_licensor_property_phase6_parallel_run.sql`
(**HARD-BLOCKED**) creates, among other things:

- table `plm.taxonomy_sync_alert` (line 98)
- table `plm.taxonomy_parallel_observation` (line 22)
- function `plm.record_taxonomy_sync_alert(…)` (line 258)

Two allowlisted migrations depend on those **at DDL time**:

| Allowlisted file | Line | Statement | Failure |
| --- | --- | --- | --- |
| `20260727221500_…readiness_and_breaker.sql` | 53 | `alert_id uuid references plm.taxonomy_sync_alert(id) on delete set null,` inside `create table if not exists plm.taxonomy_circuit_breaker` | `undefined_table` 42P01 |
| `20260728134500_…autotrip_and_gap_closure.sql` | 104–106, 145–147 | `drop trigger if exists coldlion_autotrip_on_critical_alert on plm.taxonomy_sync_alert;` / `create trigger … after insert on plm.taxonomy_sync_alert` (and the same pair on `plm.taxonomy_parallel_observation`) | `undefined_table` 42P01 |

`create table if not exists` does **not** save the first case: the table
`plm.taxonomy_circuit_breaker` does not exist, so the `create` executes and the
foreign-key target is resolved immediately. `drop trigger if exists` does **not**
save the second: `if exists` covers a missing *trigger*, not a missing *table*.

### 3.2 Verified against live production (read-only)

```sql
select to_regclass('plm.taxonomy_sync_alert'),            -- NULL
       to_regclass('plm.taxonomy_parallel_observation'),  -- NULL
       to_regclass('plm.taxonomy_circuit_breaker'),       -- NULL
       -- signature-independent, so a wrong signature cannot fake a NULL:
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'plm' and p.proname = 'record_taxonomy_sync_alert');  -- 0
```

All **NULL** / **0**.

> **Correction (found by the Grok 4.5 review, §11 finding R1).** An earlier draft
> of this section probed
> `to_regprocedure('plm.record_taxonomy_sync_alert(text,text,text,text,jsonb)')`.
> That is the **wrong signature** — the real one is
> `(text, text, text, uuid, uuid, date, boolean, jsonb)`
> (`20260726180000` lines 258–266). A wrong signature returns NULL whether or not
> the function exists, so that probe proved nothing. It has been replaced with a
> `pg_proc` count, which cannot be fooled by a signature error. The finding is
> unaffected: the count is **0**. **The load-bearing evidence for the 42P01 claim
> is the two `to_regclass` NULLs on the tables, not the function probe.**

And the ledger confirms why:

```sql
select version from supabase_migrations.schema_migrations
where version in ('20260726030000','20260726031000','20260726032000',
                  '20260726180000','20260726190000','20260726200000','20260724030000');
-- returns only: 20260724030000, 20260726190000, 20260726200000
```

So production carries `20260726190000` and `20260726200000` — which is why they sit
in `HARD_BLOCKED` but not in the pending 18 — while phase4 and phase6 are absent.

### 3.3 What actually happens if the fixed lane is run to apply today

The dry run **succeeds and prints the correct plan** (dry run does not execute the
SQL). The apply then proceeds file by file and aborts on file 3 of 14. Supabase
applies each migration in its own transaction and records the ledger row on
success, so the outcome is a **partially promoted production database**:
`20260724060000` and `20260724061000` applied and recorded, the rest not. That is a
worse state than today, and it is why §7's object verification and §8's rollback
story exist.

### 3.4 A second, quieter hazard in the same family

`20260729230000` creates `plm.taxonomy_breaker_enforcement_status()` (line 820),
whose body enumerates eleven expected triggers including
`('coldlion_autotrip_on_critical_alert', 'plm.taxonomy_sync_alert')` and casts
`table_ident::regclass`. Even if it installs, it can never report `all_enforced =
true` while phase6 is absent — readiness is supposed to block on that.

> **Correction (Grok 4.5 review, §11 finding R2 — accepted).** An earlier draft
> called this a *silent* failure. It is not. `'plm.taxonomy_sync_alert'::regclass`
> **raises** `undefined_table` 42P01 at call time when the relation is missing; it
> does not quietly return `all_enforced = false`. So the correct characterisation is
> **a loud runtime failure of the readiness watchdog**, not a silent one. The
> genuinely silent variant of this failure mode is a trigger that is *dropped or
> disabled* while its table still exists — which is exactly what this watchdog was
> built to catch, and which a ledger row would still report as success. The
> verification requirement in §7 is unchanged and is the right control for both.
>
> (Under the broken 14-set path you never reach `20260729230000` anyway — the batch
> aborts at file 3. This hazard becomes live only if phase6 is unblocked and
> something later removes those objects.)

---

## 4. The exact ordered promotion list

Order is **ascending version**, which is the order `supabase db push` applies files
and the order `parse_allowlist` enforces (`values != sorted(values)` → reject).
Dependency correctness and sort order coincide for this set *provided* the closure
check of §2.3-C passes — which today it does **not**, per §3.

**Allowlist string (14 versions), for the `production_allowlist` dispatch input:**

```
20260724060000,20260724061000,20260727221500,20260727223000,20260727224500,20260728134500,20260729230000,20260729234500,20260729235500,20260730000500,20260731163000,20260731180000,20260731190000,20260731200000
```

| # | Version | File | Note |
| --- | --- | --- | --- |
| 1 | `20260724060000` | `…_coldlion_licensor_property_phase2a_mirror_importer.sql` | sorts below ledger head |
| 2 | `20260724061000` | `…_coldlion_licensor_property_phase2a_guard_corrections.sql` | sorts below ledger head |
| 3 | `20260727221500` | `…_coldlion_licensor_property_readiness_and_breaker.sql` | **blocked by §3 — needs `20260726180000`** |
| 4 | `20260727223000` | `…_coldlion_breaker_blocked_attempt_logging_fix.sql` | sorts below ledger head |
| 5 | `20260727224500` | `…_coldlion_identity_verifier_reason_cast_fix.sql` | sorts below ledger head |
| 6 | `20260728134500` | `…_coldlion_breaker_autotrip_and_gap_closure.sql` | **blocked by §3 — needs `20260726180000`** |
| 7 | `20260729230000` | `…_coldlion_licensor_property_recurring_promotion.sql` | see §3.4 |
| 8 | `20260729234500` | `…_coldlion_recurring_promotion_collision_rule_fix.sql` | |
| 9 | `20260729235500` | `…_coldlion_recurring_promotion_ambiguous_column_fix.sql` | |
| 10 | `20260730000500` | `…_coldlion_recurring_promotion_absence_detection_fix.sql` | |
| 11 | `20260731163000` | `…_coldlion_recurring_promotion_drop_dead_failure_recording.sql` | |
| 12 | `20260731180000` | `…_coldlion_recurring_promotion_serialization_lock.sql` | |
| 13 | `20260731190000` | `…_coldlion_promotion_crosscheck_provenance_coverage.sql` | |
| 14 | `20260731200000` | `…_coldlion_recurring_promotion_fanin_name_tiebreak.sql` | |

**Excluded and staying excluded:** the 4 hard-blocked
(`20260726030000`, `20260726031000`, `20260726032000`, `20260726180000`) and all 9
unrelated (`20260727230000`, `20260728171500`, `20260728174500`, `20260728181500`,
`20260729120000`, `20260731150000`, `20260731153000`, `20260731210000`,
`20260731220000`).

**If and only if the owner unblocks phase4/phase6**, the corrected list becomes 18
versions in the manifest §2(a) order, with `20260726030000`, `20260726031000`,
`20260726032000`, `20260726180000` inserted at positions 3–6 — ahead of
`20260727221500`, which is exactly what §3 requires. Sort order already places them
correctly; only `HARD_BLOCKED` keeps them out.

---

## 5. Dry run — performed, offline, zero side effects

The brief asked for a dry run demonstrating a plan is produced, *if it can be done
safely*. A full CI dispatch was **not** run, for two reasons: it would leave a
production dispatch record and a live `supabase link` against production during a
session in which five other agents are active, and it is unnecessary — the property
being demonstrated is a pure set computation over the ledger and the file list.

Instead the guard's own functions (`local_migrations`, `parse_allowlist`,
`validate_candidates`) were imported and the bounded checkout's file set computed
**without creating a git worktree, deleting any file, or contacting any database**.
The ledger was the one read from production above.

```
local files:              386
ledger rows:              359
pending:                  27
bounded checkout files:   373        ( = 359 applied + 14 allowlisted )
bounded pending (what --include-all would apply, in order):
   20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql
   20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql
   20260727221500_coldlion_licensor_property_readiness_and_breaker.sql
   20260727223000_coldlion_breaker_blocked_attempt_logging_fix.sql
   20260727224500_coldlion_identity_verifier_reason_cast_fix.sql
   20260728134500_coldlion_breaker_autotrip_and_gap_closure.sql
   20260729230000_coldlion_licensor_property_recurring_promotion.sql
   20260729234500_coldlion_recurring_promotion_collision_rule_fix.sql
   20260729235500_coldlion_recurring_promotion_ambiguous_column_fix.sql
   20260730000500_coldlion_recurring_promotion_absence_detection_fix.sql
   20260731163000_coldlion_recurring_promotion_drop_dead_failure_recording.sql
   20260731180000_coldlion_recurring_promotion_serialization_lock.sql
   20260731190000_coldlion_promotion_crosscheck_provenance_coverage.sql
   20260731200000_coldlion_recurring_promotion_fanin_name_tiebreak.sql
MATCHES ALLOWLIST EXACTLY: True
```

**373, not 386.** The 13 absent files are exactly the 4 hard-blocked + the 9
unrelated. Not one unrelated version can be reached by `--include-all` in that
directory, because not one of them is in it. That is the proof.

(The manifest recorded 372 on 2026-07-31; it is 373 now because the ledger grew by
one row — the `20260731230000` RFQ-groups promotion. The arithmetic still closes.)

**What the real CI dry run must show**, when the coordinator dispatches it after
Change A lands:

1. `DRY RUN: migrations will *not* be pushed to the database.`
2. The marker `Would push these migrations:` **present** — this is the thing that is
   missing today and the whole point of the fix.
3. Under it, exactly the 14 filenames of §4, in that order, and nothing else.
4. `verify-dry-run` exits 0 (it asserts exact ordered equality, lines 132–135).
5. No occurrence of any of the 9 unrelated or 4 hard-blocked version strings.
6. Ledger unchanged afterwards: `count(*) = 359`, `max(version) = 20260731230000`.

---

## 6. Failure modes and how each is prevented

| # | Failure mode | Prevention |
| --- | --- | --- |
| 1 | `--include-all` sweeps the 9 unrelated migrations | The flag runs only in the bounded checkout, from which those files were deleted by `prepare`. Demonstrated: 373 files, none of the 9 present. |
| 2 | `--include-all` sweeps the 4 hard-blocked | `parse_allowlist` rejects any allowlist intersecting `HARD_BLOCKED` (line 38–40); `prepare` then deletes them from the checkout as non-`keep`. Two independent barriers. |
| 3 | Out-of-order application (`undefined_function` 42883, §5.4) | `parse_allowlist` requires ascending order; `db push` applies in version order; the new closure check (2.3-C) requires every non-deferrable predecessor to be applied-or-earlier. |
| 4 | **Missing predecessor outside the allowlist (`undefined_table` 42P01, §3)** | The closure check of 2.3-C. **This is currently a real, live failure — it is not hypothetical.** Without 2.3-C the lane would produce a clean plan for an inapplicable batch. |
| 5 | A stale ledger snapshot lets an unintended file survive into `keep` | The ledger is captured in the same job, immediately before `prepare` (workflow line 144). The new `assert-bounded` (2.3-B) recomputes the invariant against that same snapshot. |
| 6 | Ledger parsing under-reads | A file that is applied on production is deleted from the checkout. Fails closed: the CLI reports remote versions with no local file. |
| 6b | **Ledger parsing OVER-reads** — a *pending* version is falsely parsed as applied | **CORRECTED after review (§11 finding R3).** The file stays in the checkout, and a real `db push --include-all` — which resolves pending against the **live** ledger, not the snapshot — **applies it**. `assert-bounded` does **NOT** catch this: it computes `local − remote_snapshot`, and the same faulty snapshot that kept the file also removes it from the pending set, so equality with the allowlist still holds. **The control that does catch it is `verify-dry-run`** (guard lines 121–135), because the real dry run lists the extra filename and exact ordered equality fails. **Therefore `verify-dry-run` is mandatory before every apply and must never be skipped** — including in the manual `AGENTS.md` §5.1 procedure. The realistic trigger is `parse_remote_versions`' JSON branch (guard lines 61–64), which harvests **any** nested key named `version` or `remote` holding a 14-digit string. |
| 7 | The dry run passes but the apply is run against a different commit | `Check exact confirmation` + `Verify exact main commit` (workflow lines 116–133) pin `HEAD == origin/main == inputs.commit_sha`, and `prepare` builds the worktree from that same SHA. |
| 8 | Partial batch application leaves production half-promoted | Not preventable by the lane (each migration is its own transaction). Mitigated by 2.3-C making the abort impossible in the first place, and by §8. |
| 9 | "It applied successfully" is believed on the strength of a ledger row | §7. Objects are asserted, not inferred. |
| 10 | Someone copies `--include-all` into the preview lane or a local `db push` | The inline comment in Change A, plus the guard's own docstring. A social control, honestly labelled as one — it is the weakest link in this design. |

---

## 7. Post-promotion verification — objects, not ledger rows

A ledger row records that a file ran to completion. It says nothing about whether
the objects exist, whether a trigger is enabled, or whether a guard can fire. This
repo has already been bitten: a migration installed cleanly while its guard never
fired, because a `BEFORE` trigger read a `GENERATED … STORED` column that Postgres
populates *after* before-triggers. And §3.4 above is a live second instance.

Verification must therefore assert, read-only, after any apply:

```sql
-- (a) every object the batch claims to create actually exists
select to_regclass('plm.taxonomy_circuit_breaker')            is not null as t_breaker,
       to_regclass('plm.taxonomy_circuit_breaker_event')      is not null as t_breaker_evt,
       to_regclass('plm.coldlion_promotion_audit')            is not null as t_audit,
       to_regclass('plm.coldlion_promotion_quarantine')       is not null as t_quarantine;

-- (b) every trigger is INSTALLED and ENABLED (tgenabled <> 'D'), by name and table
select t.tgname, c.relname, t.tgenabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and t.tgname like 'coldlion_%'
order by 1;

-- (c) the enforcement watchdog's own verdict, which is the point of it existing
select plm.taxonomy_breaker_enforcement_status();
--   require: all_enforced = true, missing_or_disabled = []

-- (d) any view the batch replaces: compare pg_get_viewdef BEFORE and AFTER,
--     and assert the column count did not shrink
select pg_get_viewdef('<schema>.<view>'::regclass, true);

-- (e) function signatures the apps call, resolved not guessed
select to_regprocedure('plm.promote_coldlion_source_owned(…)') is not null;
```

**Acceptance for (c) is `all_enforced = true`.** Per §3.4 that cannot be true today,
which is a second, independent confirmation of the §3 finding — arrived at from the
verification side rather than the dependency side.

Additionally, capture the ledger `count(*)` and `max(version)` before and after, and
assert the delta equals the allowlist length exactly. A delta smaller than the
allowlist is the partial-application signature of §3.3.

---

## 8. Rollback story

**There is no automatic rollback, and the design does not pretend otherwise.**

- Each migration applies in its own transaction, so a mid-batch abort leaves earlier
  files applied and recorded. There is no batch-level undo.
- Several of these migrations are DDL-plus-data (trigger installation, registry
  seeding). A reverse migration would have to be written by hand, per file,
  and would itself be a production change requiring the same lane.
- **The real rollback control is the dry run plus the closure check** — refusing to
  start a batch that cannot finish. Prevention is the mechanism; there is no cure.
- If a partial application does occur, the recovery is **forward**: fix the missing
  predecessor, promote it through the same bounded lane, then re-run the remainder
  of the allowlist (the guard's `validate_candidates` will reject the already-applied
  ones, so the operator must trim the allowlist to what is still pending — that is
  correct behaviour, not an obstacle).
- Supabase PITR exists but restoring the whole production database to undo a
  partial migration batch would discard every application write since the restore
  point across all four apps. **It is not an acceptable rollback for this and should
  not be proposed as one.**

---

## 9. Acceptance gate

The implementation dispatch is done when, and only when:

1. `python -m unittest scripts/test_production_migration_guard.py` passes, with new
   cases covering: bounded-pending equality, an allowlist with a missing
   non-deferrable predecessor (must be **rejected**), and an allowlist containing an
   unrelated version (must be **rejected**).
2. A real `production-dry-run` dispatch at the exact `origin/main` SHA produces the
   six observations listed at the end of §5 — above all, the marker
   `Would push these migrations:` followed by exactly the 14 filenames of §4.
3. `verify-dry-run` exits 0.
4. Production is re-read after the dry run and is **unchanged**: 359 rows, head
   `20260731230000`.
5. No apply is attempted. The lane's "Refuse production apply" step is intact.

Note that gate 2 is achievable today with Change A alone. Gate 1's second case will
**fail against the current 14-version allowlist** until the owner resolves the four
hard-blocked migrations — and that failing test is the correct, desired outcome. The
lane should refuse a batch it cannot finish.

---

## 10. Open questions for the coordinator / owner

1. **Owner gate (blocking Step 8).** Do the four hard-blocked migrations
   `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000` get
   unblocked? Per §3 the ColdLion promotion is impossible without at least
   `20260726180000`. This is now on the critical path, not adjacent to it.
   *Why they were blocked in the first place is not recorded anywhere I could find
   — that reason needs recovering before the decision is made.*
2. Should `HARD_BLOCKED` gain a documented reason-per-version, so a future session
   can tell "blocked pending review" from "blocked forever"? Right now it is a bare
   set of six strings.
3. Should the closure check (2.3-C) be advisory-with-loud-failure or hard-fail on
   first release? Recommendation: **hard-fail**. A silent-failure fallback here is
   exactly what global rule 11 forbids.
4. **(from the review, R6)** Should the lane gain an optional
   `--expected-set <name>` binding an allowlist to a named, committed promotion
   manifest, so "approved" is more than a typed string? My position is that the
   human-readable enumerated list is the design intent, but the coordinator may
   want the stronger form for ColdLion specifically.
5. **(from the review, R10)** The CI lane and the manual `AGENTS.md` §5.1 lane
   share **no** mutual exclusion — `concurrency.group` scopes to this workflow only.
   Should production promotion take a Postgres advisory lock, registered in
   `docs/advisory-lock-registry.md`? Recommendation: yes.
6. `20260726190000` and `20260726200000` are applied on production while
   `20260726180000` is not. Is production already in a partially-applied phase6
   state from an earlier promotion, and does anything there depend on the absent
   objects? Worth one read-only probe before the owner decides.

---

## 11. Independent review — Grok 4.5

Reviewed by **Grok 4.5** (`grok 0.2.111`, model `grok-4.5`) in a read-only headless
run (`--allow Read --allow Grep --deny Edit --deny Bash --no-subagents --no-memory
--disable-web-search`), given the design, the guard, the workflow and the manifest,
and asked adversarially for (1) any path to promoting a non-allowlisted file,
(2) whether the out-of-order fix weakens the bound, (3) whether ordering
enforcement is sound, and (4) the worst outcome of running at the wrong moment.

**Every finding below was re-verified against the actual code before being
accepted.** Second-opinion models in this repo have previously raised
confidently-wrong findings; two of Grok's own intermediate drafts contradicted its
final answer (an early pass asserted "no, it cannot promote a non-allowlisted file"
with no caveat, and wrongly claimed `20260727221500` and `20260728134500` are
themselves HARD_BLOCKED — they are not; they are allowlisted). Only its final
answer is reported and assessed.

### Grok's verdict, verbatim

> **Verdict:** The bounded-`--include-all` idea is sound for the *out-of-order plan*
> problem. The design correctly discovers a real hard dependency hole in the
> 14-set. It still overclaims safety in a few places, under-specifies the closure
> check, and leaves real promote-wrong-file paths if you treat "allowlist" as more
> than "whatever the dispatcher typed."

> **1** | **Not via a correct bounded dry-run against a faithful ledger and the
> allowlist string as ground truth.** **Yes** via (a) putting non-ColdLion versions
> in the dispatch allowlist, (b) ledger over-read + apply without verify, (c)
> `--include-all` outside the bounded tree, (d) bypassing the lane.
> Seeds/config/non-sql are not a `db push` promotion path here.
> **2** | **Yes** — bounded directory + `--include-all` fixes out-of-order planning
> **without expanding the file set**, assuming `prepare` integrity.
> **3** | **No** — ascending order is not a dependency proof; the live 14-set is the
> counterexample. Proposed closure check is the right idea but **not sound as
> specified**.
> **4** | **Partial production apply** (files 1–2 committed, abort on 3) or a
> **wrong allowlist / full-tree include-all** partial apply with no batch
> rollback—plus organizational misuse of a green dry-run.
> **§3 42P01** | **Agree** on both files and the HARD_BLOCKED predecessor; verified
> against SQL. Fix the function signature in the probe; soften §3.4's "silent"
> wording.

> I would **not** approve implementation of Change A alone as "promotion-ready." I
> would approve Change A **only** coupled with Change B + a **hard-failing,
> object-level** Change C that rejects today's 14, plus an explicit rewrite of the
> test that currently bans `--include-all`.

### Finding-by-finding, with my assessment

| ID | Grok's finding (verbatim excerpt) | Verified? | My position |
| --- | --- | --- | --- |
| **R1** | "Actual signature … is `(text, text, text, uuid, uuid, date, boolean, jsonb)`. That probe returns NULL even if the function existed. **Tables** via `to_regclass` are the right evidence for the 42P01 claim; the procedure probe as written is not trustworthy." | **Yes** — `20260726180000` lines 258–266. | **AGREE, corrected.** Real defect in my evidence hygiene. Re-probed production with a signature-independent `pg_proc` count: **0**. The finding is unaffected because it never rested on that probe, but Grok is right that a NULL from a wrong signature proves nothing. §3.2 rewritten. |
| **R2** | "If `plm.taxonomy_sync_alert` … are missing, **`::regclass` raises 42P01** at call time. It does not quietly return `all_enforced = false`. So 'installs cleanly while guard silently never fires' is the wrong failure mode for *missing tables*; it is a loud error." | **Yes** — Postgres `regclass` input conversion raises on a missing relation. | **AGREE, corrected.** My §3.4 framing was wrong. Corrected in place, and I kept the *genuinely* silent variant (dropped/disabled trigger on an existing table) because that is what the watchdog exists for and what §7 must still check. |
| **R3** | "`assert-bounded` as specified (`local − remote_snapshot == allowlist`) **does not catch it** … Design is wrong on that point." | **Yes** — traced the logic: a false-"applied" entry both keeps the file (`keep = remote ∪ allowlist`, guard 111) and removes it from the computed pending set, so equality still holds. | **AGREE — this is the best catch in the review.** My §6 row 6 was straightforwardly wrong. Replaced with rows 6/6b naming `verify-dry-run` as the actual control and making it mandatory before every apply, including the manual §5.1 path. |
| **R4** | "Closure check is not implementable as written … 'Textual references + a few DDL regexes' will both false-positive (comments) and false-negative (views, runtime bodies, IF NOT EXISTS)." | **Yes** — the listed gaps are real; `create view`, `create type`, `language sql` bodies and dynamic SQL are all absent from my position list. | **AGREE.** Change C rewritten: text scan demoted to a reject-only pre-filter, authoritative gate becomes a rehearsal apply against a production-shaped scratch database. Grok is right that a richer regex over the same files repeats the manifest's mistake. |
| **R5** | "Change A **breaks this test** unless rewritten carefully … Design never mentions updating this assertion." | **Yes** — `scripts/test_production_migration_guard.py` line 96, `self.assertNotIn("--include-all", production)`. | **AGREE.** A genuine omission — my design would have failed CI on first commit. Added to Change A, with the rewrite specified as *narrowed*, never deleted. |
| **R6** | "**No code constraint** that production allowlist ⊆ ColdLion promotion set; HARD_BLOCKED is the only denylist. … 'approved' is only a typed string." | **Yes** — `parse_allowlist` enforces shape, order, and the denylist, nothing else. | **AGREE that it is true; PARTLY DISAGREE that it is a defect.** It is the design intent stated in requirement 1 of the brief: the lane promotes an explicit enumerated list a **human reads and approves**. Hard-coding one workstream's set into a general lane would make the next promotion require a code change. The right mitigation is the §9 gate plus R4's rehearsal — an operator who types the wrong list gets a plan they can read and a rehearsal that fails, not a silent apply. Recorded as open question 5. |
| **R7** | Seeds/`supabase/seed.sql`/config/non-`.sql`/`supabase/tests` are **not** promotion paths; `local_migrations` globs only `*.sql` (guard 78). | **Yes.** | **AGREE.** Useful negative result — it closes a surface I had not explicitly ruled out. |
| **R8** | "Symlinks / hardlinks (exotic, low probability) … `prepare` only `path.unlink()`s migration paths. Not a practical threat from a clean `git worktree add --detach`." | Not separately tested. | **AGREE with Grok's own low weighting.** `git worktree add --detach` reproduces tracked repo content; a symlink would have to be committed to this repo to matter. Recorded, not actioned. |
| **R9** | "W1 — Partial production promotion of the 14 … worse than 'lane can't plan': production has moved, other agents' pending arithmetic changes, and operators may believe ColdLion 'started.'" | Consistent with §3.3. | **AGREE, and it sharpens my §3.3.** The organisational half — other agents' pending counts silently changing — was not in my draft and is a real hazard in a five-agent session. |
| **R10** | "W3 — Workflow concurrency … **does not serialize** with another human's §5.1 apply, preview agents, or direct SQL." | **Yes** — `concurrency.group` (workflow 44–46) scopes to this workflow only. | **AGREE.** Real gap. The `AGENTS.md` §5.1 manual lane and this CI lane share no lock. Recorded as open question 6; an advisory lock is the obvious fix and the repo already has `docs/advisory-lock-registry.md`. |
| **R11** | "Change A without Change C is a plan-factory for a batch that must not apply — design admits this; still a foot-gun if acceptance gate 2 is celebrated without gate 1." | n/a — judgement. | **AGREE, and it is the single most important thing for the coordinator to hear.** Promoted into §0. |

**Net:** no finding was rejected as wrong. Five (R1, R2, R3, R4, R5) were real
defects and are corrected in this document; one (R6) I accept as fact but disagree
is a defect, with reasoning recorded. Grok's bottom line — *Change A alone is not
promotion-ready* — is now this design's own position.

---

## What was deliberately NOT done

- **No production or preview mutation.** No `db push`, no apply, no DDL, no writes.
  Every database call was a `select` / `to_regclass` / `to_regprocedure` against
  `qsllyeztdwjgirsysgai`, confirmed by `get_project_url` first. Preview
  `rjyboqwcdzcocqgmsyel` was never contacted.
- **`--include-all` was never executed anywhere**, in any directory.
- **No git worktree was created** by the §5 simulation, and **no migration file was
  deleted** — the bounded checkout was computed in memory, not materialised.
- **No file was modified except this one.** Not the workflow, not
  `scripts/production_migration_guard.py`, not any migration, not `AGENTS.md`, not
  `HANDOFF.md`, not `COORDINATOR_INTAKE.md` — all owned by other live agents.
- **No CI dispatch was triggered.**
- **No PR was merged.** The coordinator merges.
- No restore of the 442 `ingest.raw_record` rows was proposed; that delete is ruled
  intended and correct (`AGENTS.md` §6.3).
