# TEMPORARY — status snapshot and change log for licensors and properties

> **This whole thing is scheduled for deletion.** Read "When this gets deleted" below
> before you build anything on it. Created 2026-08-03 at Albert Hazan's request.

- **Migrations:** `supabase/migrations/20260803200000_temp_status_watch_snapshot_and_change_log.sql`
  and `supabase/migrations/20260803201000_temp_status_watch_hardening.sql` (both are one
  artefact and share one teardown)
- **Schema it creates:** `temp_status_watch` (everything lives inside it)
- **Tests:** `tools/temp-status-watch.test.mjs`
- **Status:** applied and behaviour-proven on **preview** (`rjyboqwcdzcocqgmsyel`).
  **Not on production.** Promotion to production is an owner gate.

---

## What Albert asked for

> "do the snapshot of all 256 statuses and keep a running record of changes in a table.
> and mark that table as temporary and to be deleted once we're all moved over with no
> problems."
> — Albert Hazan, 2026-08-03

## Why it exists, in plain English

The **active / inactive / potential** setting on every licensor and property is set by
hand, by a person, on purpose. Nothing in the database has ever kept a record of those
decisions.

The Master Data import (`plm.import_master_data`) on production **forces every licensor
and property back to "active"** every time it runs. So if somebody deliberately switched
something off, the next import switches it back on, silently, and there is no way to find
out what it used to be. The only reason nothing has been lost yet is that the import has
not succeeded since **2026-07-08**. The fix for the import
(`20260802170000_plm_import_preserve_curated_licensor_property_status.sql`) is merged to
`main` but is **not applied to production**.

This creates two things, so the decisions survive whatever the import does next:

1. **A snapshot** — a photograph of every licensor's and property's setting, taken at the
   moment the migration lands.
2. **A running record** — from then on, every single change to one of those settings is
   written down: what it was, what it became, when, and what kind of connection did it.

It **captures and records**. It changes no setting and curates nothing.

## The question Albert can ask

> **"What did I have inactive before?"**

```sql
select * from temp_status_watch.what_was_inactive_before;
```

That lists everything that was *not* active when the snapshot was taken, beside what it
is right now. Two companions:

```sql
-- What has drifted since the snapshot (i.e. what an import may have reverted)
select * from temp_status_watch.status_changes_since_snapshot;

-- The running record, newest first, in UTC and New York time
select * from temp_status_watch.status_change_history;
```

## What the snapshot found

| Where | When | Licensors | Properties |
|---|---|---|---|
| **Production** (read-only check, 2026-08-03) | 2026-08-03 ~20:00 UTC / 16:00 New York | 21 active, 5 potential, **0 inactive** | **256 active, 0 inactive** |
| **Preview** (snapshot actually taken) | 2026-08-03 | 20 active, 5 potential, **1 inactive** (`FRIENDS TV`) | 256 active |

Two things worth noticing:

- Albert's "256" is exactly right — production has **256 properties**, and **every one of
  them is currently `active`**. There is no inactive property on production to recover.
  That is the state being preserved, and it is also the reason this record is needed
  going forward rather than retrospectively.
- **Preview and production disagree** on the very column being snapshotted (`FRIENDS TV`
  is inactive on preview, active on production). That divergence is why the snapshot is
  built the way it is — see the next section.

## How the snapshot gets the *real* production values

The migration does **not** contain a hard-coded list of statuses. It ends with

```sql
insert into temp_status_watch.status_snapshot (...)
select '2026-08-03-pre-import-fix', 'property', p.id, ... , p.status::text, ...
from core.property p ...;
```

— a `SELECT` from the live table, evaluated **when the migration is applied**. So it
captures whatever is true in the database it lands in: preview's values on preview, and
production's real values at the moment it is promoted.

A snapshot transcribed from a preview read would have been **wrong for production**, as
the `FRIENDS TV` divergence above proves. This is the only construction that is correct
in both.

The capture is labelled (`snapshot_label`) and uses `on conflict ... do nothing`, so the
migration is safely re-runnable and a later second capture can be added without
disturbing the first.

## How the running record catches changes from *every* path

The record is written by **row-level triggers on `core.property` and `core.licensor`
themselves** — not by a new function that callers would have to remember to use.

That means it fires for:

| Path | Recorded? |
|---|---|
| A direct `UPDATE` by an engineer in `psql` / Node | Yes — proven |
| `plm.import_master_data` (or any other function) | Yes — proven with a function-mediated write |
| PostgREST / the app / the Supabase dashboard | Yes — same trigger |
| A script or CI job | Yes — same trigger |
| Delete the curated row and insert a fresh "new" one | Yes — `INSERT` and `DELETE` are recorded too, not just `UPDATE` |
| A bulk loader running with `session_replication_role = 'replica'` | Yes — the triggers are `ENABLE ALWAYS`, so replica mode does not skip them |
| `TRUNCATE` of the whole table | Yes — a statement-level marker row is written (row triggers do not fire on `TRUNCATE`) |

That last row matters: AGENTS.md §6.4 names "we don't have this record, so I created it"
as a way an importer can defeat curation without ever issuing an `UPDATE`. Recording only
updates would have left that hole open.

An `UPDATE` that does not change the status writes nothing (`when (old.status is distinct
from new.status)`), so the record stays readable.

**The remaining ways to bypass it** — stated honestly: a privileged `ALTER TABLE ...
DISABLE TRIGGER`, a `DROP TRIGGER`, or dropping the column or table. Those are deliberate
acts on the recording machinery itself. The two routes that looked accidental —
replica-mode bulk loads and `TRUNCATE` — were found by the GLM 5.2 review and are closed
(see below).

## Actor honesty — why there is no "changed by" name field

This repository has been burned by this before: an audit trail carried a free-text
`reset_by` field, a sub-agent filled it in with its own name, and someone auditing the
table later read it as a human decision and reached the wrong conclusion.

So the change log has **no free-text actor field at all**. There is nowhere to type a
name. It records only facts the database itself can prove about the connection:

`db_current_user`, `db_session_user`, `jwt_uid` (`auth.uid()`), `jwt_role` (`auth.role()`),
`application_name`, and the first 100 characters of the statement.

`actor_kind` is **derived** from those, never supplied:

| `actor_kind` | Means |
|---|---|
| `claimed_jwt_on_admin_connection` | A JWT subject arrived on a `postgres`/`supabase_admin` connection — **treat as suspect**, not as a person. `request.jwt.claims` is a settable setting, so such a connection can mint any subject |
| `signed_in_user` | A real JWT subject on a normal app connection (i.e. it came through PostgREST) |
| `service_role_automation` | The connection held the `service_role` key — a machine credential |
| `anonymous` | The `anon` role |
| `privileged_or_service_connection` | `supabase_admin` / `authenticator` / similar |
| `direct_db_connection_unattributed` | A direct database connection with no identity — **not** presented as a person |

An automated actor therefore cannot be mistaken for a person, because it cannot claim to
be one.

## The two traps this migration was written to avoid

**A null-permissive guard.** The known failure mode here is a check shaped
`if not ( ... or auth.role() = 'service_role' ) then raise ...`. Inside a migration
`auth.role()` is `NULL`, so `not (NULL)` is `NULL`, the `if` never fires, and a guard that
reads strict is wide open. This migration avoids the entire class: **the append-only
guard raises unconditionally** — there is no role test, so there is no expression a NULL
can satisfy. `auth.role()` is captured for the record but never gates a decision, and a
NULL capture falls through to the *most conservative* label, never to "person".
Verified on preview: with `auth.role()` proven `NULL`, `UPDATE` and `DELETE` on both
temporary tables were **blocked**.

**A `BEFORE` trigger reading a `GENERATED ... STORED` column.** Postgres populates those
after before-triggers, so such a guard always reads `NULL` and does nothing — a migration
in this repo once installed perfectly and had no effect for exactly that reason. The
recording triggers here are **`AFTER`**. (The append-only guards are `BEFORE`, correctly,
because they must veto the write rather than observe it.)

## Corrections

The record is **append-only for everyone, including `postgres`**. `UPDATE` and `DELETE`
on `temp_status_watch.status_change_log` and `temp_status_watch.status_snapshot` both
raise. A correction is a new row. This is not an obstacle to teardown: `DROP SCHEMA` is
not blocked by a row trigger.

---

## Independent review — GLM 5.2, 2026-08-03

The migration was reviewed by GLM 5.2 (report: `.ai/reviews/glm-report.md`, brief:
`.ai/reviews/glm-brief.md`). Every finding was checked against the actual SQL and, where
adopted, **proven on preview before and after the fix**. GLM's words are quoted verbatim.

### Adopted — findings 1–4 (all real; all fixed in `20260803201000`)

**1. `session_replication_role = 'replica'` skipped the record entirely.** GLM: *"these
triggers are default `ENABLE ORIGIN`; a replica-role session skips them. A bulk-import job
often holds that privilege."*
**Agree — and this was the most important finding in the review.** Confirmed on preview:
the triggers were created with `tgenabled = 'O'`. A bulk loader setting replica mode — an
ordinary ETL habit — would have walked straight past the record, defeating the entire
purpose. Fixed with `ENABLE ALWAYS` on all six triggers (`tgenabled = 'A'` verified), and
proven: an `UPDATE` under `session_replication_role = 'replica'` now produces a log row.

**2. `TRUNCATE` bypassed everything.** GLM: *"`TRUNCATE core.property` / `core.licensor` —
row-level DELETE triggers do not fire on TRUNCATE and there is no `truncate` trigger.
Mass-wipe = mass status loss, unlogged. Primary bypass."* And separately: *"`TRUNCATE` of
`status_change_log`/`status_snapshot` evades append-only."*
**Agree on both.** Fixed asymmetrically on purpose: a truncate of a *curated* table is now
**recorded** (statement-level `AFTER TRUNCATE` marker) rather than blocked, because
blocking `TRUNCATE` on shared master data would be a policy change to tables this work does
not own; a truncate of the *temporary* tables is **blocked**, because append-only that a
`TRUNCATE` can empty is not append-only. Both proven on preview.

**3. The actor could be forged on a direct connection.** GLM: *"`auth.uid()`/`auth.role()`
read the `request.jwt.claims` GUC — a two-part custom setting with no superuser
restriction. Any session can `set local request.jwt.claims='{"role":"service_role","sub":"<real
user uuid>"}'`. Then `auth.uid()` returns the forged uuid, the CASE labels the row
`'signed_in_user'` […] An auditor reads it as a specific human."*
**Agree, and this was the single most serious defect**, because it is exactly the failure
the schema exists to prevent. Verified on preview: setting that GUC on a `postgres`
connection did produce a `signed_in_user` row. The fix is structural, not another
heuristic: a genuine end-user request arrives through PostgREST as
`authenticator`/`authenticated`, never as `postgres`/`supabase_admin`, so a JWT subject
presented on an admin connection now gets its own loud label,
**`claimed_jwt_on_admin_connection`** — and the claimed subject is still recorded, so the
forgery is visible rather than hidden. Proven on preview.
GLM also correctly noted the brittleness that *"if Supabase ever ships a uuid `sub`"* for
`service_role`, automation would mis-label; the admin-connection branch now covers that
case too for direct connections.

**4. The record was readable by every signed-in user.** GLM: *"`grant select … on
status_change_log … to authenticated` exposes […] to every signed-in app user. Too broad
for a security log"* and *"`statement_prefix` leaks SQL (first 100 chars, may contain
UUIDs/values)."*
**Agree.** Worth noting the exposure was theoretical — `temp_status_watch` is not in
`pgrst.db_schemas` (AGENTS.md §8.1), so `authenticated` could never have reached it through
PostgREST — which means the grant bought nothing and cost surface. Revoked.

**5 (adopted as documentation).** GLM: *"`application_name` and `statement_prefix` are
caller-controlled free text. The 'no free-text changed-by column' claim is partially
undermined."*
**Partly agree.** True as stated, but weaker than it sounds: neither column is presented as
identity, and `actor_kind` — the field an auditor reads for "who" — cannot be written by the
caller at all. Rather than argue it, both columns now carry a `COMMENT` saying
**CALLER-CONTROLLED … NEVER identity**, so the warning lives in the database.

### Not adopted

**"The trigger's INSERT is not wrapped in its own `begin … exception`. If it ever fails
[…] the exception propagates and aborts the import statement."**
**Disagree — this is the correct behaviour and must not be changed.** Swallowing the error
would let a status change succeed with no record, which is precisely the outcome this
schema exists to prevent, and it would be a silent failure. Failing loudly and aborting the
write is the right trade: a broken recorder should stop the change, not quietly permit it.

**"`status_changes_since_snapshot` shows NULL rather than the sibling view's `'(row no
longer exists)'` marker for deleted rows."**
**Disagree — factually incorrect.** That view's select list is
`coalesce(p.status::text, l.status::text, '(row no longer exists)') as status_now`; it
carries the same marker. GLM appears to have read the `WHERE` clause (which does use a bare
`coalesce`, correctly, so that a deleted row registers as differing) as the output.

**"`txid_current()` is deprecated (prefer `pg_current_xact_id()`)."**
**Noted, not adopted.** `txid_current()` is soft-deprecated but fully supported and not
scheduled for removal; changing it would alter the column type (`bigint` → `xid8`) for no
behavioural gain on a table that is scheduled for deletion.

**"Partition/inheritance edge — only if `core.property` is partitioned."**
**Not applicable.** Verified against `information_schema`: both are plain tables.

**"The snapshot + trigger assume `core.property(id, name, code, status, updated_at,
licensor_id)` […] If the real schema differs, it errors. (Couldn't verify.)"**
**Verified — the assumption is correct.** Both tables were read from
`information_schema.columns` on production before the migration was written.

### Bypasses that remain, stated honestly

After the hardening, the only remaining ways to change a status without leaving a record
are deliberate privileged acts on the trigger machinery itself: `ALTER TABLE … DISABLE
TRIGGER`, `DROP TRIGGER`, or dropping the column/table. `ENABLE ALWAYS` closes the
replica-role route, and the truncate markers close the mass-wipe route.

---

## When this gets deleted

Albert's instruction is that this is deleted "once we're all moved over with no problems".
A deferral without a written trigger becomes "never", so here is the trigger. It is
repeated in the migration header and in the `COMMENT ON SCHEMA`, so it survives inside the
database itself.

**Drop the schema when ALL THREE are true:**

1. **The import can no longer force status.** `plm.import_master_data` on **production**
   (`qsllyeztdwjgirsysgai`) no longer writes `core.property.status` or
   `core.licensor.status` on a matched row — verified by reading `pg_get_functiondef()`,
   **not** by a ledger row. (This is what `20260802170000` does; it is not applied to
   production as of 2026-08-03.)
2. **The cut-over is done.** The transitional Master Data catch-up import (AGENTS.md
   §6.4) has been retired, and has not run for **30 consecutive days**.
3. **This is no longer the only record.** A durable per-field curation record exists on
   `core.property` / `core.licensor` — the "deliberately set" record AGENTS.md §6.4 says
   does not exist today — so dropping this loses no unique evidence.

**Teardown, when all three hold:**

```sql
drop schema temp_status_watch cascade;
```

That is the entire teardown. Nothing outside the schema depends on it: no `core.*` object
references it, no view outside it selects from it, and the four triggers it installs on
`core.property` / `core.licensor` are removed by the `CASCADE` because their function
lives inside the schema. A test asserts that every object the migration creates is inside
`temp_status_watch`, so this stays true.

**REVIEW DATE: 2026-11-03.** If all three conditions are not met by then, report that to
Albert. Do not silently extend it.

---

## Notes for whoever promotes this to production

- Promotion is an **owner gate**. It had not happened as of 2026-08-03.
- The snapshot populates itself from production's live data at apply time — so **the
  sooner it is applied, the more faithful the "before" picture is.** Applying it *after*
  a revived import has forced everything to `active` captures the damage, not the truth.
- Ideally this lands **before** `20260802170000` is applied, and certainly before the
  `systemd/plm-sync.timer` lane is re-enabled. AGENTS.md §6.4 already forbids running,
  re-enabling or repairing that lane before the import fix is applied.
- Verify objects, not the ledger: `to_regclass('temp_status_watch.status_change_log')`,
  and `select tgname, tgrelid::regclass from pg_trigger where tgname like '%status_change_log%'`
  should show four triggers on the two `core` tables.
