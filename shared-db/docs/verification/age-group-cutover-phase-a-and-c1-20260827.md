# `age_group` cutover — Phase A gates and step C1, executed 2026-08-27

**Date:** 2026-08-27
**Plan this executes:** [`docs/age-group-cloudsql-migration-plan-20260804.md`](../age-group-cloudsql-migration-plan-20260804.md)
**Authorized by:** owner instruction in session, "do the age group cutover".
**Status:** Phase A complete. Step C1 implemented and deployed to sandbox. **Phase D not started
and not approved.** Nothing was written to any database by this work.

**Database identity proved before every read:** `get_project_url` →
`https://qsllyeztdwjgirsysgai.supabase.co` (production Supabase). All queries were read-only; the
connection rejected DDL with `25006: cannot execute CREATE TABLE in a read-only transaction`, which
is itself evidence the session could not have written.

---

## 1. What was done, in one paragraph

DesignFlow's backend used to look up the Adult/Juvenile list in its own private copy of the table,
whichever environment it happened to be running in. It now looks it up in the shared `core` copy
instead. That is the whole change — one option on one model file. The old table was left exactly
where it is. Nothing about the change is visible to anyone using DesignFlow, for a reason that is
worth reading section 3 for.

---

## 2. Phase A — the gates

### Step A1 — `core.age_group` exists and holds the right rows — **PASS**

```
select to_regclass('core.age_group');   -->  core.age_group

select id, name, is_active from core.age_group order by id;
 id |   name   | is_active
----+----------+-----------
  1 | Adult    | t
  2 | Juvenile | t
```

Exactly as the plan required: `1 = Adult`, `2 = Juvenile`, both active. The rows, not the count.

### Step A2 — nothing depends on it — **PASS**

- **Foreign keys pointing at `core.age_group`:** none. A `pg_constraint` sweep on `confrelid =
  'core.age_group'::regclass` returned **zero rows** — including none for the `created_by` /
  `updated_by` audit columns the plan expected to find. Publishing the empty result as instructed.
- **Views, materialized views and functions referencing `age_group`:** none. A sweep of
  `pg_get_viewdef` across all `relkind in ('v','m')` and of `pg_proc.prosrc` returned zero rows.
- **Columns named `age_group%` anywhere in the database:** three, all of them
  `art_piece.age_group_id`, in schemas `designflow`, `dflow` and `dflow_prod`. No others.
- **Tables named `age_group%`:** three — `core.age_group` (2 rows), `dflow.age_group` (2 rows),
  `dflow_prod.age_group` (**0 rows**).

### Step A3 — re-confirm the DesignFlow code finding against current code — **CONFIRMED**

Checked against `designflow-backend` commit `1ccda6a0b213b06904108edf5d212b15b6a6de1d`
(2026-08-26) and the current `designflow-frontend` working tree — the plan's §8 finding came from a
2026-07-14 checkout and was three weeks stale.

**Confirmed, no screen reads `age_group`.** Specifically:

- `getAgeGroups()` is defined in `designflow-frontend/src/app/helpers/services/admin.service.ts:157`
  and is **called from nowhere**. A repository-wide search for `getAgeGroups(` returns exactly one
  hit: the definition itself.
- The "Age Group" dropdown on the art piece screens is filled from **merch groups**, in
  `art-piece-detail.component.ts` — the branch `else if (mgTypeDesc === "Age Group")` pushes
  `merchGroup.mg_id` / `mg_desc` into `ageGroupOptions`. `newArtPiece.component.ts:112` makes this
  unambiguous: the form control is declared as `new FormControl({ value: new merchGroup() })`.

The plan said: if this is corrected, stop and re-plan. It was **not** corrected. It holds.

---

## 3. New finding — the column was never an `age_group` reference at all

The plan predicted at step D2 that production `art_piece.age_group_id` would fail to match
`core.age_group`. That can now be stated as measured fact in sandbox, without production access:

| `age_group_id` | art pieces |
|---|---|
| 3761 | 563 |
| 3808 | 270 |
| 3810 | 123 |
| 3762 | 94 |
| 3809 | 50 |
| 3760 | 8 |
| *(null)* | 8 |

`core.age_group` contains ids **1 and 2**. The column contains ids in the **3760–3810** range.
**Zero of 1,116 art pieces reference this table.** The values are not merch-group *header* or
*relation* ids either — neither `dflow."merchGroupHeaders"` nor `dflow."merchGroupRelations"` holds
any of those six ids. What they do point at was not established here and does not need to be for
this cutover; the point is that `age_group` is not it.

**Consequence for the plan.** §7's claims should be graded with this in hand. Moving this table
cannot break anything, because nothing was ever attached to it. That is a stronger safety result
and a weaker rehearsal result than the plan assumed.

---

## 4. Step C1 — the cutover

**Change:** `designflow-backend`, `models/db/AgeGroup.js`, commit
[`1506639`](https://github.com/popcre/designflow-backend/commit/1506639). The model gained
`schema: 'core'`. It previously resolved `age_group` through the connection's schema — `dflow` in
sandbox/dev/staging, `dflow_prod` in production, per
`config/database-connection-contract.js`.

**Proof of target, not of output.** The plan is emphatic that a correct-looking result proves
nothing here, because both tables hold identical rows. The generated SQL was captured with
`process.env.schema` deliberately set to `dflow`:

```
SELECT * FROM "core"."age_group" AS "AgeGroup"
WHERE "AgeGroup"."is_active" = true
ORDER BY "AgeGroup"."created_at" DESC;
```

The target is `core`, and it is not `search_path`-dependent. This is a stronger proof than the
rename-the-old-table trick the plan suggested, and it required touching nothing.

**The cross-schema join was checked too.** `getAgeGroups` includes `sql.users` for the
`created_by` name, and `users` is bound to `process.env.schema`. The exact resulting query runs
correctly against production:

```
select ag.id, ag.name, ag.created_at, u.name as created_by
from core.age_group ag left join dflow.users u on u.id = ag.created_by
where ag.is_active = true order by ag.created_at desc;

 id |   name   |          created_at           |    created_by
----+----------+-------------------------------+------------------
  1 | Adult    | 2025-06-20 00:54:09.187493-04 | Umamaheswararao
  2 | Juvenile | 2025-06-20 00:54:09.187493-04 | Umamaheswararao
```

Column shapes match the model exactly: `id, name, is_active, created_at, created_by, updated_at,
updated_by`.

**Deployed.** Cloud Build `a12b46f0-329c-40ac-8027-f9bd3781989a` (`us-east4`, repo
`designflow-backend`, commit `1506639`) — SUCCESS at 15:51:40Z, deploying
`popcre-albert-core-sandbox`, ready revision `popcre-albert-core-sandbox-00173-8ff`.

**Not proved: a live authenticated call.** `GET /api/admin/getAgeGroups` is behind `authRole([...])`
and returns 403 without a session token. The deployed service was confirmed reachable and running
(403, not a connection failure), but no authenticated round-trip was made. Marking this NOT TESTED
rather than claiming it.

**Review route.** The commit is on `sandbox-albert` and rides the standing PR
[popcre/designflow-backend#75](https://github.com/popcre/designflow-backend/pull/75) to `develop`,
with the evidence posted as a PR comment. Not self-merged, per DesignFlow policy.

---

## 5. Open items, stated plainly

- **C2 (develop and staging) is blocked on review of PR #75.** DesignFlow changes are not
  self-merged, so this genuinely waits on someone else.
- **C3 grading** should be written once C2 lands, and §3 above guarantees at least one row of §7
  grades NOT PROVED.
- **Phase D remains not approved and not scheduled.** It additionally needs production Cloud SQL
  reads, which `dflow_prod` cannot substitute for — `dflow_prod.age_group` and
  `dflow_prod.art_piece` are both **empty**. That schema is a prepared shell from
  `20260824011750_create_dflow_prod_and_audit_archive`, not a copy of production data.
- **A design question for whoever reviews PR #75.** `createAgeGroup` / `updateAgeGroup` /
  `deleteAgeGroup` now target `core` as well. They are unreachable from the UI, but if they were
  ever wired up an application write would land in the shared `core` schema. Worth deciding whether
  this model should be read-only from DesignFlow's side.
- **Permissions note.** No role grants exist on `core.age_group` at all. The backend connects
  through the Supabase pooler as `postgres.<ref>`, which maps to `postgres` and can read it, so this
  works today without a grant migration. It works by role privilege, not by explicit grant — worth
  knowing before any future least-privilege tightening.
