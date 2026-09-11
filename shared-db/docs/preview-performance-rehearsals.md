# Preview performance rehearsals

Performance fixtures must run inside one transaction that is always rolled back. This preserves immutable ledgers such as `dflow.sample_movement`, leaves planner statistics and application rows unchanged, and removes the old need to rebuild the shared preview branch merely to clear test data.

Use `scripts/run-preview-rehearsal-transaction.mjs` with a fixture ID shaped like `AI-PERF-YYYYMMDD-name`. Put the seed, `ANALYZE`, benchmark queries, and evidence queries in one SQL file. Refer to the ID inside SQL with `current_setting('app.fixture_id')` so every generated row remains visibly attributable during the run.

Provide the database URL only through `SUPABASE_DB_URL`; never put it in a command or file. The runner requires the URL to prove the requested preview project ref and hard-refuses production `qsllyeztdwjgirsysgai`, printing the safe ref as target proof before executing.

## What the connection check actually checks

libpq reads the whole URI, not only its authority, and `host`, `hostaddr`, `user`, `port`, `dbname`, `service` and `passfile` given as query parameters override the host and user a reader would see. Those parameters are therefore refused outright rather than interpreted, a URL with no host is refused so libpq cannot take one from the environment, a fragment is refused, and the identity the preview ref must appear in is built from the user, host, path and query together and casefolded before comparison.

The runner removes every inherited environment variable whose name begins with
`PG`, including `PGPASSWORD`, before starting the child process. Authentication
must therefore come from `SUPABASE_DB_URL`; ambient libpq settings are ignored.

## What the SQL check actually checks

Transaction control is refused, including PostgreSQL's own synonyms `END` and `ABORT`, which end the rehearsal transaction exactly as `COMMIT` and `ROLLBACK` do. Statements that cannot be rolled back are refused. Every backslash is refused, because psql honours a meta-command after a semicolon as readily as at the start of a line and `\connect` would open a new autocommit session this guard never inspected; a rehearsal fixture has no legitimate use for one.

Before rolling back, the wrapper reads a transaction-local setting it made after `BEGIN`. If the fixture ended that transaction by any means, the read raises and the run fails, so the success line cannot be printed for a rehearsal that was not still inside its transaction. Any SQL or connection failure closes the session with its transaction uncommitted.

These refusals are a gate only because CI runs them: `scripts/run-preview-rehearsal-transaction.test.mjs` runs in the SQL migration guards workflow.

This is a static check plus a runtime proof, not a sandbox. Every inherited `PG*` variable except the proved `PGDATABASE` is removed from the child environment, so the caller cannot redirect the connection that way either. It does not bound the cost of a fixture beyond the statement and lock timeouts.

Example invocation:

`node scripts/run-preview-rehearsal-transaction.mjs --project-ref <current-preview-ref> --fixture-id AI-PERF-20260830-inventory --sql-file <rehearsal.sql>`

Successful completion ends with `REHEARSAL_ROLLED_BACK`. Confirm representative fixture rows are absent with a separate read-only query before treating cleanup as proven. Never use branch deletion or rebuild as fixture teardown.
