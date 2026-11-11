---
summary: "Issue 5608 governed preview acceptance of forward resolver: 8.1 s rebuild, 3.2 s unchanged run, zero EXCEPT ALL differences, producer and run references."
kind: proof
status: done
read-when: checking 5608 preview acceptance numbers and producer provenance
---

# #5608: governed preview acceptance and production reference

The installed forward resolver passed real shared-preview execution: full rebuild
**8.103888793 seconds**, unchanged run **3.247661835 seconds**. Both actual calls
completed under separately verified 60-second/5-second session caps, including
connection/preflight overhead in those elapsed upper bounds. Exact semantic
`EXCEPT ALL` comparisons were **0 in both directions**. This completes preview
acceptance, not production delivery or three-night acceptance.

## Authoritative producer and source

- Source PR [#5649](https://github.com/popcre/shared-db/pull/5649), merged main
  `51c366fa534a7182e3318405e0aa49398c6ba827`; source PR author head
  `05a69e8b6fc472544f9d502104282066a8bf2930`.
- Governed merged-main preview run
  [41987714096](https://github.com/popcre/shared-db/actions/runs/41987714096) succeeded
  for forward version `20261105061627`; prerequisite `20261105044255` was already
  installed in preview. Forward SQL SHA-256:
  `81c273047daf80935a4d846d526573dd27fafa9a69fe101165365e98d165cbe7`.
- Original preview artifact **13397091481**, named
  `preview-migration-apply-51c366fa534a7182e3318405e0aa49398c6ba827`, digest
  `sha256:91730b63c6eb13a26dab411c4f654af30812f9f7eb1f40371707fd91f2033727`.
  Its ID/name/digest/workflow main head were independently read from GitHub;
  the source PR author head is recorded separately.
- Automatic review artifact **13397176861** is a different artifact and does not
  replace that original preview producer. The separate automatic production run
  [41988158724](https://github.com/popcre/shared-db/actions/runs/41988158724) refused
  at Hard guard preflight because base `20261105044255` is absent in production;
  the production apply job was skipped. The live selector also waits on #5619's
  production dependency rather than using a premature forward retry loop.

The ordinary required checks and full ephemeral database suite passed before merge.
Generated types had already landed, unmodified from their official producer, in
[#5645](https://github.com/popcre/shared-db/pull/5645), merge
`0521f60bc33079bae4f604391c1f478bb22a9c97`, producer
[41973827983](https://github.com/popcre/shared-db/actions/runs/41973827983), artifact
SHA-256 `91d815102f5e637d5a699cc8e962fe1d9e90e41358bcf2b554b1b4e13c609b2b`.
The forward repair changes no generated column or routine signature.

## Actual post-apply calls and exact output

The coordinator granted a fresh exclusive preview-rehearsal lease after governed
apply/cleanup. Each call freshly matched the configured preview identity to the
protected tenant and live parent, passed the task gate, and asserted the exact
lease immediately before launch. The approved direct runner used session-pooler
mode and one native psql session per invocation: separate autocommit SET, assertion,
and single top-level CALL commands. There was no transaction wrapper around CALL,
no role/global/cron timeout change, and no cap increase. The earlier read-only
probe established that transaction-pooler startup PGOPTIONS did not enforce the
requested cap; the actual route separately SET and verified the cap in-session.

- FULL completed **November 5, 2026, 2:41:39 AM EST**: 8.103888793 seconds,
  verified 60,000-ms session timeout, one `p_full=true` call.
- NOCHANGE completed **2:41:56 AM EST**: 3.247661835 seconds,
  verified 5,000-ms session timeout, one `p_full=false` call.
- One subsequent explicit read-only exact-output SELECT took 9.103563950 seconds.
  It materialized the original expected output and current nine semantic columns,
  counted both EXCEPT ALL directions, and retained only aggregates. It did not
  run a writing resolver to construct the oracle or raise a timeout.

Expected/current output: **334 rows**, both hash
`500a314ef7a2bb14d04c1e1a9b7d4aa9`; expected-minus-actual **0** and reverse **0**.
This exactly matches the before-apply output fingerprint. Portal inputs also
remain exactly unchanged: **565,210 observations**, hash
`8ba5ab3b33ce785fc65f8ed9c5c27c30`. Sheet/file inputs remain **3,953 observations**,
hash `54cc92cecc83c11ec23656562ed02d66`. Thus the comparison is on unchanged inputs,
not an unexplained difference between two ingestion snapshots. Time columns and
surrogate link IDs are excluded from the nine-column semantic comparison.

Final fresh state: **zero pending keys across all 17 source tables**, all **754**
progress rows resolved with one v3 portal fingerprint, **334** output rows, no
catchup job and no resolver session advisory lock. Existing nightly job **17**
remains active, postgres-owned and scheduled `30 4 * * *`, with exact command
`call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */`.
The actual three-night acceptance query correctly returned **false**. Manual
preview calls do not count as scheduled nights. The coordinator released the
preview lease at **2:45 AM EST**, after all proof reads finished.

Runner SHA-256 was
`e42321666a3f7d41e0290d43db08e7d76230b006b7184a976d345370cf3b5039`;
exact read-only parity runner
`8c3fb6bc615c9f797fa8403b262ae180581b0d33670d3b4a3cac0840c87083b3`;
exact parity SELECT
`ca3233256383cf8e6d82fef24ee21e070381c40295a07327f95f8a970942a979`.

The [forward-repair record](../20261105T061627Z/sku-style-guide-snapshot.md)
retains the failed real-preview implementation, five observed ~120s failed catchup invocations across setup/resolver work, failed preparation trials, local eight-portal parity and post-DML cancellation
recovery, real pg_cron identity tests, and seventeen acceptance-query cases. The [retained native-history subset](catchup-run-history.json) proves five failures;
the last two begin after zero-key checkpoints, while exact phase allocation of
the first three is not retained. The successful full resolver call above does not
turn that setup history into a zero-timeout claim. The original local stress corpus was concentrated in DCP; all eight portal
arms, duplicates, pending keys and NULL filenames were separately exercised by the
retained guarded fixtures.

## Pre-production reference: three separate read-only snapshots

Production has not received either source migration. The coordinator's initial
production read-only MCP reference attempt refused private normalization EXECUTE
with SQLSTATE **42501**. No grant changed. The exact combined aggregate query through
an already-supported protected postgres Management API route then returned HTTP
**400** after **55.109401 seconds**, under the same 55-second read-only cap. Its
response body was neither printed nor saved, and its SQLSTATE is not presumed.
Neither unsuccessful attempt is a completed baseline.

The coordinator then reviewed three reduced SELECTs preserving the exact original
encodings. Each ran once, sequentially, with fresh intended production identity,
explicit BEGIN READ ONLY/ROLLBACK, unchanged 55-second cap, strict aggregate response
validation, no privilege changes and no data writes. These are **separate snapshots**,
not an atomic baseline and not production parity or delivery proof:

- Stored output observed **2:56:10.127123 AM EST**: **10,680** rows, hash
  `a274ef271cb4c71363d5a14c3cfaed77`, elapsed **0.409557919 seconds**.
- Sheet/file inputs observed **2:56:16.922664 AM EST**: **39,517** rows, hash
  `86d968993e618c7f82c8ecc118696249`, elapsed **48.114843569 seconds**.
- Portal inputs observed **2:57:16.991646 AM EST**: **553,563** observations, hash
  `f7ee234473a394372dc9c29cfaddc7f2`, elapsed **47.001391151 seconds**.

Both source/forward migration booleans were **false in each snapshot**. Those
observations are future comparison context only; ingestion may change between
these snapshots and promotion. Compare input fingerprints before interpreting
later output differences. Only hashes, counts, observation times, migration booleans
and safe execution metadata are retained here; no licensed row values or credentials.

## Still required on #5608

- [ ] Implementation complete: existing automatic production delivery of the base
  and dependent forward migration, then production catchup/verification.
- [ ] live proof: latest three ALL scheduled runs must each carry the exact source
  tag, succeed under 60 seconds on consecutive dates and advance freshness. Current
  job metadata, forward ledger, no catchup and browser ACL checks must also pass.

The original coordinator retains delivery custody. The existing #5620 hold expiry
is **November 5, 2026, 11:08:11 PM EST**; expiry permits normal automatic selection,
not a manual production apply, cap increase or bypass of the missing-base guard.
