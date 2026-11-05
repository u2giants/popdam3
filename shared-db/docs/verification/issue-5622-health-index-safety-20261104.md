# Search health index safety — issue #5622

Owner: Codex V-A child of the PopDAM search/tagging coordinator.

This is fixture and transaction-safety evidence. It is **not production delivery
or the two-hour alarm drill**. Runtime acceptance stays on shared-db #5622 and
u2giants/popdam3 #706/#663.

## Representative preview fixture

On November 4, 2026, the canonical preview identity was freshly matched to the
repository variable before connecting. Private session-local copies retained all
source columns, bounded to 250,000 rows each. No source row left the preview
project. Only temporary objects were written; they were dropped or removed on
session close. Existing public writers were not locked by fixture index builds.

| Corpus | Preview rows | Source heap bytes | Compact temporary heap bytes | Production heap bytes |
|---|---:|---:|---:|---:|
| DAM | 137,421 | 312,549,376 | 216,006,656 | 394,985,472 |
| PopSG | 217,193 | 457,400,320 | 231,211,008 | 481,886,208 |

Temporary index build times varied with load:

| Run | DAM error index | DAM last-write index | PopSG last-write index |
|---|---:|---:|---:|
| 1 | 1,243 ms | 1,004 ms | 186 ms |
| 2 | 146 ms | 180 ms | 1,047 ms |
| 3 | 1,180 ms | 945 ms | 2,591 ms |

The smaller compact heaps and private-table/no-WAL behavior make these timings a
lower bound, not a promise about production. Run 3 exceeds the 2.5-second
statement budget for one index: a loaded promotion can fail safely and must not
be reported as delivered.

After fixture ANALYZE and visibility-map maintenance, the proposed health query
completed in 1,843 ms and 2,123 ms. Both runs returned non-null pending/error
counts, including 136,518 eligible DAM documents and 209,516 eligible PopSG
documents. A fresh unanalyzed fixture exceeded five seconds; statistics and
visibility matter. Existing pending indexes were retained. No additional DAM
pending index is shipped.

## Actual transaction timeout proof

A separate private preview temporary fixture set transaction_timeout=3s and then
attempted a deliberately delayed query. PostgreSQL terminated that transaction
with SQLSTATE 25P04 after 2,995 ms. An independent connection found zero locks for
that backend and zero remaining temporary fixture objects. The timeout was
exercised, not merely declared. PostgreSQL 17 documents this transaction-wide
session termination in [Client Connection Defaults](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-TRANSACTION-TIMEOUT).

## Governed delivery

The source PR splits indexes and RPCs into four centrally reserved files:

- 20261105073854: DAM error index.
- 20261105073903: DAM last-write index.
- 20261105073911: PopSG last-write index.
- 20261105073920: health and bounded reset RPCs.

Each uses transaction-local lock_timeout=500ms, statement_timeout=2500ms and
transaction_timeout=3s. Normal RPC request ceilings are unchanged. Existing reset
overloads, eligible pending semantics, live leases and missing-thumbnail
exclusions remain preserved.

The automatic preview/production workflow still pins Supabase CLI 2.105.0. Its
[recorded atomicity experiment](issue-611-db-push-atomicity-20260810.md) proves each
file's SQL and ledger row commit together, and earlier files remain committed if
a later file fails. Separate files therefore release write-blocking locks
between index builds. A partial batch must be reported exactly; the app is held
until all four ledger versions and the live RPC contract are proven.

No manual production DDL or concurrent-index bypass is authorized by this note.

- [ ] automatic promotion and all four production ledger rows
- [ ] real REST health response for both corpora, with non-null counts and measured latency
- [ ] tagging saves remain healthy after promotion
- [ ] monitor dashboard alert/clear drill
- [ ] one bounded reset and actual-thumbnail/persisted-vector proof

## Forward source re-reservation, November 5, 2026

Current source admission rejects unmerged migrations below main version 20261105061627. Approved read-only checks freshly found all four original versions 20261105043036, 20261105043042, 20261105043048, 20261105043054 absent from BOTH shared preview and production ledgers at 2:38 AM EST. Their original source commits and permanent reservation refs remain intact and will not be reused. Only the four unapplied file paths were renamed to 20261105073854, 20261105073903, 20261105073911, 20261105073920. Each SQL Git blob is byte-identical; lock/statement/transaction budgets remain 500ms/2500ms/3s. No old preview evidence was deleted and no database apply was performed.

- [ ] After normal promotion, the actual health REST response must finish within eight seconds and contain both corpora with non-NULL pending/error counts. Private SQL fixture timings are not this proof; existing request ceilings stay unchanged.
