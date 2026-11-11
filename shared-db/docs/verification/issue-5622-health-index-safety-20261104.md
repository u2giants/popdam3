---
summary: "Issue 5622 search-health index safety: preview fixture sizes for DAM and PopSG corpora, transaction timeout proof; runtime acceptance not yet done."
kind: proof
status: open
read-when: working on 5622 search health index safety and the alarm drill
---

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

The original delivery assumption about Supabase CLI 2.105.0 was false: normal
CLI execution did not preserve transaction-local budgets or atomic SQL/ledger
commit. PR5660 repaired the existing governed runner with exact hash/target
opt-ins and independent transactions per file. Actual production execution
subsequently proved first-file timeout rollback of both DDL and ledger; it did
not deliver these indexes. The app remains held until genuine production
indexes and the live RPC contract are proven.

No manual production DDL or concurrent-index bypass is authorized by this note.

- [ ] automatic promotion and all four production ledger rows
- [ ] real REST health response for both corpora, with non-null counts and measured latency
- [ ] tagging saves remain healthy after promotion
- [ ] monitor dashboard alert/clear drill
- [ ] one bounded reset and actual-thumbnail/persisted-vector proof

## Forward source re-reservation, November 5, 2026

Current source admission rejects unmerged migrations below main version 20261105061627. Approved read-only checks freshly found all four original versions 20261105043036, 20261105043042, 20261105043048, 20261105043054 absent from BOTH shared preview and production ledgers at 2:38 AM EST. Their original source commits and permanent reservation refs remain intact and will not be reused. Only the four unapplied file paths were renamed to 20261105073854, 20261105073903, 20261105073911, 20261105073920. Each SQL Git blob is byte-identical; lock/statement/transaction budgets remain 500ms/2500ms/3s. No old preview evidence was deleted and no database apply was performed.

- [ ] After normal promotion, the actual health REST response must finish within eight seconds and contain both corpora with non-NULL pending/error counts. Private SQL fixture timings are not this proof; existing request ceilings stay unchanged.


## Initial concurrent builder source candidate — not activated

The current candidate extends the existing exact-index maintenance framework;
its operation policy remains unchanged and contains no health activation. The
fixed registry permits only the DAM error index and DAM/PopSG last-write indexes.
Production uses their canonical names. Preview builds three fixed owner-5622
shadow names against the actual preview tables, verifies definition, table/OID,
owner, validity and readiness, and removes only its proven owned shadows. Existing
preview canonical indexes and all four historical preview ledger rows stay intact.

Admission requires both canonical and shadow index WRITE claims plus the actual
table READ dependency. Canonical foreign READ/WRITE collision rules remain active;
a foreign table WRITE blocks activation. Operation-specific source/digest binding
is separate from the unchanged existing SG operation. Both use native exclusive
target lanes and fencing; neither may adopt another operation's receipt or lease.

Immutable started/built/completed receipts bind exact target, project, source,
executor, definition and admitted owner scope. Only the same process
that successfully executes the exact CREATE may immediately capture its actual
OID and persist the built receipt. A crash after CREATE but before that receipt
leaves an ambiguous object: resumed execution refuses and preserves it, even if
name/definition/owner match. Existing immutable built-OID receipts permit bounded
cleanup recovery; prior absence or a started receipt alone never proves ownership. Changed OIDs, wrong targets,
foreign preimages, invalid/incomplete builds and missing ownership refuse safely.
An invalid interrupted index is preserved for governed investigation, never dropped
by name alone. Preview canonical OIDs are checked again after shadow cleanup.

Actual isolated PG17 tests passed nine build/crash/cleanup/concurrent-writer/target
drills, including started-then-foreign exact-valid index and crash-before-owned-OID
receipt preservation. Dedicated Python ownership/retirement tests passed 19 and
receipt/claim regression passed 23. A broader 623-test producer/guard/selector
regression passed before the final ownership tightening; native current-head CI
remains required.
These are disposable fixture proofs, not a shared-preview rehearsal or production
acceptance. No shared target was changed by these tests.

- [ ] Complete reviewed native production-only retirement of the four old pending versions, preserving immutable SQL and applied preview history.
- [ ] Author a fresh RPC-only successor with exact valid-index and expected function-prestate guards; preserve legacy reset overload and ACLs.
- [ ] Review and activate separately pinned operations only after genuine foreign-claim/source-pin reconciliation.
- [ ] Genuine shared-preview builder receipts, automatic production delivery, bounded REST proof and ordinary live pipeline acceptance.


## Source-only retirement, producer pin and permanent test routing

The candidate adds only the four own health versions to the native hard-block and
retirement catalogues, preserving every historical SQL/reservation/preview ledger
and all existing T1/T9 entries. It does not claim a replacement is delivered. The
new fixed registry receives one additive PREVIEW_PRODUCER_PATHS pin; foreign
reader exemptions and all upstream producer pins remain untouched.

A distinct named database-contract step runs the existing health PG17 test file
against a newly created localhost-only disposable database. It uses the existing
test role, grants no privilege, creates no new role/helper/extension, and cleans
only its exact newly owned database without FORCE or session termination. The
actual local same-harness nine-test run passed. Foreign HTS/browse/actor steps
and the existing SG operation policy remain unchanged.

The fresh RPC-only successor is still pending source work. No health operation
is enabled, and no shared target or production retirement has changed merely
because this candidate exists. Coordinator source review and current native CI
are required before any merge; live acceptance stays unchecked.
