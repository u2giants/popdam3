---
summary: "Issue 5608 local rehearsal of SKU-to-style-guide link keys: persisted keys, BEFORE triggers, disjoint view arms, disposable workload, recovery proof."
kind: proof
status: done
read-when: reviewing the original 5608 SKU style-guide link-key local rehearsal
---

# #5608 local rehearsal — November 4, 2026, 10:54 PM EST

Owner: the #5608 implementation session. These synthetic fixtures are retained as regression evidence for the nightly resolver; they add no shared runner or scheduled service. No licensed rows or credentials were used. They require a fresh disposable PostgreSQL 17 cluster and an explicit `app.sku_sg_disposable=yes` setting before any fixture DDL.

## Scope and decisions

Plain persisted keys avoid the exclusive-lock rewrite caused by generated columns. Source/key-sensitive BEFORE triggers compute keys on changed inputs; key-only backfill avoids unrelated PDF search/parser triggers. Existing DCP source-immutability and legacy-resolution guards remain active. DCP guards permit these added non-source keys and may stamp `updated_at`; the resolver fingerprint intentionally excludes that timestamp.

NULL stored keys mean pending backfill. Empty stored keys mean normalization legitimately returned NULL. Disjoint ready, pending and computed-NULL view arms preserve the original view multiset throughout catch-up and expose ready keys directly for btree lookups.

The portal fingerprint covers the complete direct-assertion multiset, including exact filename spelling, duplicates, guide labels, source identities and canonical guide IDs. Changed portal data rematches all current SKU inputs. Unchanged portal data rematches only changed SKU inputs or externally edited result semantics. Exact observed UUID membership refreshes current links while preserving stale quarantined history. Output fingerprints include UUIDs and semantic fields, excluding timestamps, so independent parsers and delete/reinsert operations cannot strand stale membership or non-minimum labels.

The nightly schedule is unchanged. A separate five-minute catch-up uses the same procedure and removes itself only after key and resolver work completes. A session advisory lock spans commits. Busy calls fail explicitly; canceled/error calls release the lock. Initial COMMIT rejects explicit-transaction misuse before acquiring it. The compatibility function keeps the existing full-derivation API and cooperates with the lock.

Function-level SET statement_timeout does not impose a new budget on an already-running outer SQL statement, demonstrated during fixture development. The revised helpers do not advertise it as a per-batch safety mechanism. The existing server outer budget remains unchanged; measured runtime is the acceptance gate.

## Measured disposable workload

`supabase/tests/fixtures/5608/sku-style-guide-links-volume-fixture.sql` reproduces the volume shape. The timed workload concentrated 553,600 direct portal rows in DCP, used 10,000 guide rows, 27,915 PDF samples containing about 3.4 KB synthetic text each, 11,600 file-use rows and 12,821 SKU inputs. The local scaffold does not reproduce production row width, source-guard cost, concurrency or hardware. Shared-preview timing remains required.

- Original full resolver: 23.535 seconds; 67,430 semantic result rows.
- Revised atomic metadata/index migration: 116.695 milliseconds summed statement time, largest statement 51.793 milliseconds. No generated-column table rewrite.
- First top-level CALL, including committed key backfill and complete resolver catch-up: 50.940 seconds under an independently set outer 60-second timeout.
- Original/new semantic output comparison: EXCEPT in both directions returned zero rows; identity, methods, labels, confidence, counts and canonical IDs included, timestamps excluded.
- Unchanged top-level CALL: 2.507 seconds. Updated-fingerprint preparation after adding output UUIDs: 2.118 seconds with zero queued SKUs.
- Full 100-SKU batch re-derivation: 130 calls including the empty final call; maximum 299.145 milliseconds, average 172.525 milliseconds, sum 22.428 seconds.
- Ready filename lookup: btree index condition on `sku_sg_file_key`; pending branch used the same index for NULL keys and found zero rows. EXPLAIN ANALYZE execution 0.190 milliseconds.

## Behavioral and recovery proof

`supabase/tests/fixtures/5608/sku-style-guide-links-eight-portals-fixture.sql` covers all eight portals independently of the concentrated volume case. Pending-view and ready-view EXCEPT ALL comparisons each returned zero differences, including a legitimately NULL normalized filename. All eight portals produced their filename and label links (16 links).

The SQL contracts pass for existing parsing/matching/grants, bounded incremental work, new-portal/old-sheet matches, exact filename changes, new file-use rows, independent parser timestamp updates, external non-minimum label correction, failed-batch custody, and upsert-only history. Nine Node tests and the SQL safety guards pass.

Actual top-level procedure tests additionally proved:

- Concurrent invocation was refused while the first invocation held its session lock across committed work.
- An outer 100-millisecond cancellation during preparation left no advisory lock on the same persistent connection.
- Explicit-transaction CALL failed before locking and left no session advisory lock.
- Injected failure after the first 100-SKU batch left those 100 progress records committed and the catch-up job installed; the next invocation resumed and finished all 201 inputs, then removed the catch-up job.

The committed read-only live-proof probe requires three consecutive scheduled nights under 60 seconds, completed catch-up, current observed output, and restricted resolver execution. It is intentionally not satisfied by publication or a single manual/local success.

## Delivery still required

Shared-preview real-data timing and equivalence; publication and automatic promotion; generated-type workflow artifact; actual catch-up; three consecutive successful nightly runs. Track all of these on #5608. These local observations do not claim production acceptance.

## Shared-preview read-only baseline — November 4, 2026, 11:05 PM EST

The configured preview target was resolved from the repository variable and matched against the live parent-project branch metadata immediately before each query. Approved privileged API requests explicitly used BEGIN READ ONLY, SET LOCAL statement_timeout='55s', EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) of only the extracted SELECT arm, and ROLLBACK. A preliminary transaction check confirmed role postgres and transaction_read_only=on. No resolver was invoked and no shared database row/schema was modified.

The three committed sku-arm-*-baseline.sql files are the original resolver's SELECT-only arm queries. Their corresponding JSON plans contain execution metadata, not returned licensed rows. Filename arm: 10,231.344 ms; sheet-declared arm: 404.224 ms; declared-label-to-portal arm: 13,315.944 ms. Planning times: 155.290 / 83.202 / 69.886 ms, respectively. Live count queries showed 565,210 portal-view rows and 3,132 PDF samples; this preview has realistic portal cardinality but substantially fewer PDF samples than production, so the separate synthetic full-PDF workload remains necessary.

These are pre-migration baselines, not revised preview acceptance. The unapplied source migration was routinely re-reserved as 20261105044255 to stay above the sibling migration landing first; SQL bytes and measured local behavior are unchanged. Its registered hash-bound sidecar pins the exact fixed-list key-only backfill function body.
