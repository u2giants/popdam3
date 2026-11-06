# #5608 production failure and v4 input snapshot

Recorded November 6, 2026. This is implementation/diagnostic evidence, **not completed production acceptance**. Original issue [#5608](https://github.com/popcre/shared-db/issues/5608) stays open with implementation/live proof unchecked.

## Actual delivery and actual failure

Base `20261105044255` actually reached production through [automatic run42241380486](https://github.com/popcre/shared-db/actions/runs/42241380486), following [fresh historical-preview recovery42240703300](https://github.com/popcre/shared-db/actions/runs/42240703300). Forward `20261105061627` followed through [automatic run42243380012](https://github.com/popcre/shared-db/actions/runs/42243380012) / [recovery42242713557](https://github.com/popcre/shared-db/actions/runs/42242713557). Both ledger entries and unchanged job17 identity/current tagged command were freshly read at10:33 AM EST. No manual production CALL, DDL, timeout increase or historical SQL replay occurred.

Five scheduled production catch-up invocations used approximately120s while703641 persisted keys were filled durably. At10:47:34 AM EST, pending keys were0 and resolved SKUs0. The **next**10:50 AM EST invocation therefore exercised resolver work after that zero-key checkpoint: it failed at120.035070s, with only3400 SKUs committed and12702 total links at10:52:49 AM EST. Catch-up stayed installed and the session lock was released. This is a real full-resolution performance failure, not a calendar-only blocker or passing bootstrap. Each checkpoint is retained in `production-delivery-and-failed-catchup.json`; its historical filename containing “final” does not mean completion.

The original November5 preview full8.103889s / unchanged3.247662s and334-row parity remain valid historical preview evidence only. The three genuine final-source nights have not happened. The later restart means promotion must freshly recheck actual target/ledger/catch-up state; no earlier cache or statistics baseline is assumed current.

## Read-only diagnosis

The exact eligible input multiset has8050 distinct SKUs and21861 observations:11602 files and10259 declarations. Production assets had156339 estimated rows/292282368 heap bytes; PDFs27915 estimated rows. Only the partial assets SKU index with predicate `is_deleted=false` exists. Original semantics include deleted assets, so narrowing that predicate would be wrong.

Bounded read-only `EXPLAIN (ANALYZE false)` for a server-selected100-SKU array shows arm2 scanning PDF observations then looking up asset PKs and filtering SKU; arm3's declaration source uses seven filename-trigram bitmap scans followed by SKU filtering and PDF lookups. These are estimates, not measured inner-query durations. `pg_stat_statements.track=top`, function tracking is off, and the matching successful-CALL aggregate was empty. Full metadata/plans contain no exported SKU values or licensed rows; see `production-readonly-diagnostics.json`.

## Minimum v4 change

One raw `pg_temp.sku_sg_inputs` CTAS retains the original single-statement UNION ALL snapshot, duplicates, NULLs, strings and row hashes. Fingerprinting and all three arms consume it. After unchanged SKUs are pruned, only pending rows receive normalized filename/label fields and a nonunique temporary index. Deleted inputs, blank file SKUs, numeric-only declaration asymmetry, quarantine, confidence, original upserts and durable commits stay intact. No permanent table/view/index or grant is added. v4 invalidates potentially incoherent old v3 progress once without deleting its history. Only the existing nightly command marker changes; an existing catch-up is left unchanged and the original self-removing job is ensured only if absent.

## Disposable proof; remaining live work

The production-shaped fixture has8050 eligible SKUs,21861 inputs,156339 padded assets and600000 portal observations, with the same partial SKU-index limitation. New whole top-level CALL full:2.965543s under a60s server cap; same-session unchanged:0.884081s; fresh-session unchanged wall:0.892607s under5s. All32120 synthetic output rows equal the original43848 resolver across the nine semantic columns (`EXCEPT ALL` both directions0). The unchanged61627 local baseline14.794741s **does not reproduce** production's120s failure and is not presented as such. These are disposable measurements, not hosted or production timings.

Separate eight-portal parity, duplicate/NULL/deleted/numeric/blank behavior, true post-batch2-DML cancellation with100 durable SKUs and201-SKU resume, file/PDF/asset edits after preparation, next-invocation convergence, lazy no-change fields, hostile temporary sources and reused sessions passed. The actual live-proof SQL passed24 synthetic positive/negative cases; this does not create a real night. A second fresh database ran the committed portable fixture successfully: full2.975465s, unchanged0.920149s and fresh-session wall1.028000s, with8050 progress rows and0 differences. Results are in `disposable-results.json`; executable owned-container fixtures are under `supabase/tests/fixtures/5608/`.

Still required: governed realistic hosted rehearsal, automatic delivery of the v4 source, actual production full/catch-up and unchanged matching output, then three consecutive genuine final-source nightly successes under60s with current evidence. Do not reset budgets, restamp applied predecessors, manually CALL production, raise caps or close the issue early.

## Unapplied source ordering renewal

A newer unrelated migration landed before this source. Fresh read-only preview evidence at12:18:13 PM EST and production evidence at12:18:17 PM EST on November6 proved version20261106161310 absent on both targets; no apply for it was active. Its reservation, original SHA8c2d8dccb310214382901db13279123720504b5b521d493e2656e624f6e205d2 and original test records are preserved. Atomic reservation assigned the unapplied replacement version20261106171924. Only the nightly source comment changes inside the SQL; both routine bodies remain byte-identical (MD5d59eab95461811d644d1ce3a0f5bc07a and9e14ef0dd7ea8c92529c806b46f5637a). The renewed full-file SHA is1e8e96db3fb0be84c782be815d76a3e34539f2d2f23bd5c32f87cbef652f0c4a. No applied predecessor changed.

A new empty owned database reran the complete portable8050-SKU/600000-portal fixture against that exact renewed file: full5.638229s under60s, same-session unchanged0.932501s and fresh-session unchanged wall1.039087s under5s. Nine-column differences remain0 with32120 synthetic links and8050 progress rows. Earlier measurements remain historical, not overwritten. Current required hosted/production/nights acceptance is unchanged.
