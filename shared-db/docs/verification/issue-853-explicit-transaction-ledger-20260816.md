# Issue #853 explicit-transaction ledger safety proof

Date: 2026-08-16. Environment: disposable `postgres:15` container on hetz.
No preview or production database was contacted. The container and temporary
files were destroyed after each run.

The test used the repository-pinned Supabase CLI 2.105.0 with TLS enabled and a
successful CLI connection preflight. A valid migration shaped as
`BEGIN; CREATE TABLE ...; COMMIT;` was run while a `BEFORE INSERT` trigger
deliberately rejected only that migration's ledger row.

The CLI came from the same complete official 2.105.0 Linux release archive
qualified by issue #611. Its recorded binary hashes remain
`039206687deb55706063371d7452c0d2b18de1e530dbc783f10b39f5589c3414`
for the shim and
`445d502015f1c15627ef0597db7b188b6ad990bdd1c9e1a5df10c605310af3a3`
for `supabase-go`. The test deliberately used the transaction-control shape,
not the licensed or application-specific statements, because only the
transaction boundary can change the CLI's ledger atomicity.

Counts-only/result-only evidence:

```text
supabase_version=2.105.0
container_tls=on
cli_preflight=pass
push_exit=1
ledger_exception_seen=t
probe_table_present=t
ledger_row_present=f
VERDICT=EXPLICIT_COMMIT_SEPARATES_SQL_FROM_LEDGER
```

This disproves per-file ledger atomicity for migration 20260816045130 because
that file contains explicit transaction control. It must never be applied to
production. Version 20260816110750 is the safe fix-forward: it carries the same
database body but no `BEGIN` or `COMMIT` and is bound by exact SHA-256 in
`config/atomic-migration-allowlist.json`. Both governed preview and production
therefore select `scripts/atomic_migration_apply.py`, which places the lock, the
`ON COMMIT DROP` temporary safety snapshot, all schema changes, the preservation
proof, and the exact Supabase ledger insert inside one transaction.

A governed preview attempt before that policy entry existed failed before any
ledger change with `LOCK TABLE can only be used in transaction blocks`. Direct
CLI execution was not safe for this file because the lock requires a transaction
and the temporary snapshot must survive until the final preservation proof. The
exact policy binding prevents both preview paths from falling through to direct
CLI execution, while the atomic runner continues to reject transaction controls
inside the migration itself.
