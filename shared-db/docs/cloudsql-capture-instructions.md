# Capturing the DesignFlow production schema from Cloud SQL

**Who this is for:** whoever administers the DesignFlow **production Cloud SQL**
database (Uma, per issue #696). You do not need to know this repository.

**Why:** DesignFlow production runs on Cloud SQL; the `dflow` schema in the shared
Supabase project is only develop/staging/sandbox. Nobody has ever compared the two,
so every estimate of migration effort, downtime and risk is currently a guess. This
capture is the comparison input.

## What the script does — and does not do

The script is [`scripts/capture-postgres-schema.sql`](../scripts/capture-postgres-schema.sql).

It **prints** an inventory of one schema: tables, columns, constraints, indexes,
views and materialized views, functions, triggers, sequences, installed extensions,
roles, grants, RLS policies, row counts, and on-disk sizes.

It does **not** change anything, and it does **not** print any business data.
Only names, types, definitions, counts and byte sizes come out.

### Why it is safe on production

- Its third executable line is `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;`
  — after that the **server itself** rejects any write on that connection. The setting
  is session-scoped and disappears when psql exits. Nothing stored is changed.
- Every other statement is a plain `SELECT` against `pg_catalog` / `information_schema`.
  No DDL, no DML, no temp tables, no `DO` blocks. You can confirm this in seconds:

  ```bash
  grep -inE '^[^-]*\b(insert into|update |delete from|create |alter |drop |truncate |grant |revoke |copy )' capture-postgres-schema.sql
  ```

  That should print **nothing**.
- `statement_timeout = 120s` and `lock_timeout = 5s` are set, so nothing can hang or
  queue behind a lock.
- The only potentially expensive part is the exact `count(*)` per table. It is capped:
  tables larger than `exact_count_max_bytes` (default 2 GB) get a planner **estimate**
  instead, and the output labels which is which. Set the cap to `0` to skip exact
  counts entirely.

## What to run

One command. Plain `psql` — no Docker, no Node, no Supabase CLI.

```bash
psql "<your production connection string>" -X -f capture-postgres-schema.sql \
     -v target_schema=designflow > designflow-capture.txt 2>&1
```

Notes:

- `-X` ignores your `~/.psqlrc` so the output format is exactly what we expect.
- **The schema name is a parameter on purpose.** We believe it is `designflow` in
  Cloud SQL, but Supabase has both a `dflow` and a `designflow` schema with different
  row counts, and nobody has resolved which mirrors production. **Section 02 of the
  output lists every schema on the server with its table count and size**, so the
  answer will be in the file regardless of which name you pass.
- Connecting as a superuser or the schema owner gives the most complete picture of
  grants and roles. A read-only login still works, but may show fewer rows in the
  privileges sections.

**How long:** a minute or two for a schema of this size. Almost all of it is catalog
reads; the row counts are the only part that touches table data, and they are capped.

## What to send back

The whole `designflow-capture.txt` file, unedited. It is safe to paste into a GitHub
issue: it contains no data rows and no credentials.

Post it on **[u2giants/shared-db issue #696](https://github.com/u2giants/shared-db/issues/696)**
— as an attachment if it is large.

If any section prints an error instead of rows, **leave the error in the file and send it
anyway.** The script deliberately continues past a failed section, so one unsupported
catalog view does not cost the whole capture.

## Things we could not verify without running it

We have no access to Cloud SQL, so the script was written and reviewed but **never
executed**. These are the specific lines most likely to need a tweak on your server.
None of them can cause harm — the worst case is that section prints an error and the
rest of the capture continues.

| What | Needs | If it fails |
|---|---|---|
| `\if :{?target_schema}` at the top | **psql client** 10 or newer | Upgrade psql, or delete the two `\if` blocks and hard-code the schema name |
| Section 10 (`prokind`, `pg_get_functiondef`) | **server** PostgreSQL 11+; also errors if the schema contains an aggregate | Ignore it — **Section 10b** prints the same signatures using only portable catalogs |
| Section 12 (`pg_sequences`) | **server** PostgreSQL 10+ | Ignore it — **Section 12b** is the portable fallback |
| Section 20 exact counts (`query_to_xml`) | server built with libxml (normal, but not guaranteed) | Ignore it — `estimated_rows` in the same section still works |
| `aclexplode` in sections 16–19 | long-standing built-in, not formally documented | Tell us and we will rewrite those against `information_schema` |

If you would rather sanity-check one line before running the whole thing, run this
first — it is the single most version-sensitive query in the file:

```sql
select proname, prokind from pg_proc limit 1;
```

## Optional companion (also read-only)

If you are willing, a `pg_dump --schema-only` is the restore-grade complement to this
capture, which is comparison-grade:

```bash
pg_dump "<connection string>" --schema-only --no-owner --no-privileges \
        --schema=designflow > designflow-schema.sql
```

`pg_dump` takes only shared locks and writes nothing to the database. It is optional;
the capture above is the thing we actually need.

## For shared-db sessions reading this

The output is pipe-separated, one record per line, with stable ordering in every
section, so two captures **diff cleanly**. Run the same script against the shared
Supabase project with `-v target_schema=dflow` and `diff` the two files to get the
real divergence list — including whether the thirteen Sample Tracking migrations
(`20260721201500` … `20260724040000`) and `20260810160000` exist in Cloud SQL at all.
The shared-db side of that comparison starts from
`20260710135950_reconcile_dflow_baseline.sql` plus the 18 `dflow` migrations that
landed after it.
