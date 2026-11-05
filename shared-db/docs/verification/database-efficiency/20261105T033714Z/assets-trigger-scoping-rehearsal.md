# Issue #5609 isolated rehearsal

Synthetic PostgreSQL 17.6 database in a dedicated container, isolated from production, preview, and the existing local stack. Seed: schema-only read from the existing local stack, with the exact image-embedding migration's feature objects installed. The cron scheduler at that dependency's end cannot be installed in a database other than `postgres`; cron scheduling is unrelated to these scoped trigger tests. No shared database was changed.

The old and new databases share the same schema, feature functions, and invented fixtures; only the five trigger definitions differ. The checked-in SQL next to this document reproduces the 1,000-asset rehearsal. Tuple identity is tested with `ctid`, since `xmin` and `now()` are transaction-stable and cannot prove a no-op inside one transaction.

Measured no-op re-scan, second run after initial warmup:

| Trigger definitions | Duration | Total WAL bytes | Search/designer/primary trigger calls |
|---|---:|---:|---:|
| Original | 670.199 ms | 10,662,584 | 1,000 each |
| Scoped | 63.981 ms | 4,636,408 | 0 each |

Duration fell 90.45%; total WAL fell 56.52%. Total WAL uses the difference of `pg_current_wal_insert_lsn()` immediately before/after the batch, including trigger side effects, in this otherwise idle isolated container. EXPLAIN's main-node WAL alone excludes some trigger effects and must not be mistaken for total WAL.

Identical mixed workload results (rename, thumbnail replacement, regroup, soft delete/revive, designer change, cover change, no-op):

- Group semantic checksum, old and new: `15ee334765b9b72c66c14c75c91f1df2`.
- Search document semantic checksum, old and new: `93d9953e1463eb72b4d12bb94e15344b`.

Checksums exclude creation/refresh timestamps and tuple identity, include final searchable text/hash/metadata, embedding presence, and all other group values. Newly covered metadata-only and deleted-designer changes are tested separately because the original trigger column lists missed them.

`assets_update_trigger_scoping_contracts.sql` fails against original triggers with `no-op PATCH rewrote derived search/group tuples`, and passes against the migration. It also verifies enabled trigger event/predicate catalogs; INSERT/hard DELETE; rename; NULL no-ops and NULL-to-value metadata, designer and thumbnail changes; BEFORE-derived path attributes; precise ungrouped licensor/property metadata and hash; first thumbnail on an existing asset with an empty group primary; primary cache URL/error synchronization; enabled image embedding enqueue; rendering; designer deletion/conflict; soft delete/revive; primary cover/fallback including deleted primary; regroup counts; multi-row update isolation.

The retired licensor redirect function is unchanged; its fixed DC/HP-to-WB identity mapping is outside this trigger-only migration. No real licensor identities or licensed content are inserted into the synthetic tests. The path test confirms final BEFORE-trigger customer/program values reach search documents.

Live production acceptance is still pending. The 24-hour observation requirement is preserved on #5609; synthetic performance is not presented as live acceptance.
