# `supabase/ci-bootstrap/` — what a from-empty replay needs that the migrations do not supply

**Nothing in this directory is a migration. Nothing in it is ever applied to preview or
production.** It exists for one consumer: the throwaway Supabase stack that
`.github/workflows/database-contract-tests.yml` creates inside a GitHub runner.

## The problem this closes (issue #754)

This repository was adopted on top of an already-populated database. So a set of
relations — `public.assets`, the legacy popdam tables, the `plm.*` legacy mirrors —
exist in preview and production with **no migration here that creates them**.

Measured on the first-ever CI execution of `supabase/tests/` (PR #741, issue #731):
replaying all 429 migrations into an empty database applied **363** and failed **66**.
Everything downstream of those 66 was missing from the ephemeral schema, so **26 of the
40 contract test files were quarantined** — they ran, their output was published, and
they could not pass. The lane proved only the subset of the contract provable from the
repository alone.

Two artifacts were missing. They are here, and with them **15 of those 26 files now
pass** and the pass-1 replay failures fall from **66 to 10** (measured, run 31500417400).
The 11 that remain each carry the actual error they fail with in
`supabase/tests/ci-quarantine.txt`; three of them are candidate real defects in the tests
themselves, exposed for the first time now that the schema is complete enough to reach
the failing line.

## `010_pre_adoption_baseline.sql`

The **schema only** of every relation, function, trigger, policy and grant that exists in
production but that no migration in this repository creates: 126 tables, 1 view, 157
primary/unique/check constraints, 151 indexes, 54 foreign keys, 60 functions, 25 triggers
and 509 access-rule statements.

Functions, triggers and grants are not optional extras, and each was learned the hard way
from a measured run:

* Without `public.has_role()` the very first reconcile migration aborts and the eighteen
  migrations downstream of it never create their own tables. Adding the functions is what
  took the failures from 41 to 11.
* Without the triggers, `20260723113000` aborts on
  `trigger set_assets_updated_at for table assets does not exist`.
* Without the grants, three tests fail on `permission denied` with every object present.

The functions are emitted **twice**. `pg_proc` returns them in name order, which is not
dependency order, and a SQL-language function is validated when it is created:
`claim_pdf_backfill_batch` calls `is_style_guide_source_pdf`, and `c` sorts before `i`.
`CREATE OR REPLACE` is idempotent, so a second pass resolves every forward reference
without anyone hand-maintaining an ordering.

The job summary reports the baseline's statement-error count on every run. **Two are
expected**: the first pass of the function block cannot create
`claim_pdf_backfill_batch` or `count_pdf_backfill_remaining` before
`is_style_guide_source_pdf` exists, and the second pass lands them. More than two usually
means a migration has started creating an object the baseline also creates — delete it
from the baseline rather than leaving both.

**No rows. Not one.** No production data, no personal data, no licensed data. Test data
belongs in `020_test_fixture_seed.sql` and is synthetic.

### Why it is not a migration, and must not become one

A new migration inserted at the **front** of an already-applied sequence cannot re-run
against preview or production: their ledgers are long past this point, and a back-dated
version is exactly what the Guard B backdating check exists to stop. The deployed
databases already contain every object in the file — applying it there would be a no-op
at best and a conflict at worst. The only consumer that needs it is a from-empty replay,
which only ever happens inside the CI runner. So it lives outside
`supabase/migrations/`, owns no version, and is applied only by the workflow.

### How to re-capture it

Read-only, from production, schema only. Nothing below writes anything.

1. **Compute the object set — do not hand-pick it.** Parse every
   `CREATE TABLE|VIEW <schema>.<name>` out of `supabase/migrations/*.sql`. The baseline
   set is every relation in `public`, `plm`, `dam`, `dflow`, `core` and `api` that this
   parse does **not** name.
2. **Generate the DDL** with a single `SELECT` against production that assembles
   `CREATE TABLE` from `pg_attribute` + `pg_attrdef`, `pg_get_constraintdef` for
   constraints, `pg_get_indexdef` for indexes and `pg_get_viewdef` for views — ordered
   tables → keys/checks → indexes → foreign keys → views.
3. **Run it read-only.** Use the Supabase Management API query endpoint
   (`POST /v1/projects/{ref}/database/query`) with `read_only: true`, authenticated with
   the *Supabase CLI Personal Access Token* item in the `vibe_coding` 1Password vault.
   Never `psql` into production, never `apply_migration`, never `supabase db push`.
4. **Emit only foreign keys whose target is also in the baseline set.** A key pointing at
   a table that a *migration* creates would be added twice.
5. **Emit nothing a migration also creates** — not a column it `ADD`s, not an index,
   constraint or policy name it creates on the same table. This file is the *pre*-adoption
   shape. A duplicate makes the migration abort and, because migrations apply in a single
   transaction, loses every other statement in that file.
6. **Scan the result before committing**: no `INSERT`/`COPY`, no email addresses, and
   read the distinct string literals — they must be nothing but column names and enum
   labels.

### When it is wrong

It is a snapshot of production's *current* shape for these objects, which is the shape a
from-empty replay must reach. If a future migration starts creating one of these objects
itself, **delete it from the baseline** — otherwise the workflow reports a duplicate. Every
run prints the baseline's statement-error count, so that drift is visible, never silent.

## `020_test_fixture_seed.sql`

Four active authenticated profiles, one Licensor, one Property, one Customer, one
Factory, one ColdLion source ref. That is the whole of it.

**Two rules this file learned by breaking things.**

* **Give every fixture row an explicit `code`.** `core.licensor` is declared
  `unique nulls not distinct (code)`, so at most one row in the table may have a null
  code. A fixture that omits it silently consumes that single slot and the next test to
  insert a licensor dies on `duplicate key value violates unique constraint
  licensor_code_key`. That is exactly what happened to
  `clickup_task_import_contracts.sql` — a passing test broken by fixture data, which is
  the worst way for a seed to fail. `core.property` and `core.factory` carry the same
  rule. `core.customer` is `core.company` renamed and has no `code` column at all.
* **Go in through the real front door.** `public.handle_new_user()` is a real
  pre-adoption trigger on `auth.users` and refuses any signup with no open invitation.
  The seed creates the invitation and lets the trigger run. Do **not** disable a guard to
  make a fixture load — a seed that switches off the thing under test is worse than no
  seed at all.

**Every row is invented.** Names are prefixed `ZZ Fixture` so that a row escaping into a
real database is instantly recognisable as test scaffolding. Email addresses use the
RFC 2606 reserved `.invalid` top-level domain, which cannot resolve and cannot belong to
anyone. The workflow **fails the job** if any address outside `fixture.invalid` appears
in the file.

If you need another fixture row, **invent it**. Do not copy one from preview or
production "just to get the shape right" — the shape is in `supabase/migrations`, and the
PII forward guard will catch you.

Roles are not seeded here: `20260621150815_app_core.sql` already inserts all six.
`app.app_access` is not seeded here either: each test grants and revokes its own inside
its own transaction, which is the behaviour under test.

## How the workflow uses them

```
start empty stack
  PASS 1   replay all 429 migrations, record failures        <- unchanged
  BASELINE apply 010_pre_adoption_baseline.sql
  PASS 2   re-run ONLY the pass-1 failures
  SEED     apply 020_test_fixture_seed.sql
  TESTS    run every supabase/tests/*.sql
```

The baseline lands **between** the passes, not before pass 1. Some of its columns are
typed with enums that `20260621150714_foundation.sql` creates (`app.entity_status`).
Applied first, the baseline would have to create those types itself, and foundation's
unguarded `CREATE TYPE` would then fail — trading one gap for a worse one.

Both passes print their counts in the job summary, so what is still missing is a number
on every run rather than a footnote in a file nobody opens.
