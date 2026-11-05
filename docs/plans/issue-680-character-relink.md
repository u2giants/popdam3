# Issue 680: relink existing AI character tags

Owning application issue: https://github.com/u2giants/popdam3/issues/680

## STATUS

November 5, 2026: production is NOT released. The initial REST repair design was rejected for a check/write race and incomplete custody after a successful insert. Its packets and read-only rehearsals are evidence of preparation only. The only proposed delivery path is a bounded native per-asset pure-DML transaction with concurrency, rollback and recovery proofs. No production append has been executed by this task. Resume with the latest signed Track T2 comment on the owning issue; private manifests and recovery material are never committed.

- [x] Dependency: source-backed character records and the application alias resolver delivered by Track T1.
- [x] Prepare bounded read-only discovery, actual application resolver checks, private exact preimages, append-only repair support and preservation tests.
- [x] Account for the admitted 2,194 historical snapshots, including unknown models; broader normalization coverage remains to verify.
- [x] Implement native atomic runner and commit reproducible isolated PostgreSQL 17 proofs; coordinator source review remains pending.
- [ ] Apply only the exact coordinator-released packet/hash after the independent search baseline.
- [ ] Prove all five requested examples through ordinary authenticated file access and preserve every prior tag, asset, association and history row.
- [ ] live proof

## Scope and authority

Relink genuine existing active AI tags to newly delivered source-backed character identities. This is application row repair; it creates no canonical licensing records, schemas, migrations, models, configuration or worker deployment. The company licensing authority remains [Licensing Master Data](https://github.com/popcre/shared-db/blob/main/docs/business-rules/licensing-master-data.md).

The full tagging run remains running unchanged. This task never stops, restarts, requeues or retags it. Existing accepted and inflight provider receipts, in every operation status, exclude their assets. Track T1's already delivered sample remains preserved and is skipped when its link already exists.

## Repair contract

The read-only planner imports the delivered application resolver and licensing scope rules. It independently requires one active exact canonical/alias identity within the current licensor; ambiguity and failed reads abstain. Group licensing takes precedence under the application contract. Private snapshots include the complete asset, tags, current and legacy links, relevant group and source-backed character. No source path, licensed row or recovery image belongs in the public repository or issue.

Execution defaults to read-only. The initial REST write design is not released and must never be used to apply a packet. The native transactional successor must pass isolated PostgreSQL 17 concurrency and custody proofs before any root release. A released native apply names the exact private manifest hash, rechecks original rows, current scope, character identity and all-status receipt ownership, and appends only missing canonical associations. An unknown original model stays NULL. The original AI tag timestamp is retained; a deterministic relink never claims a fresh AI assessment. Existing tags, descriptions, model attribution, manual and legacy evidence, history, checkpoints and operation controls remain intact. Changed candidates abstain rather than overwrite concurrent work.

## Evidence and verification

The first model-recorded population contained 4,738 candidate assets. Independent bounded reads confirmed 45 deleted assets, leaving 4,693 live snapshots. The initial immutable planner packet held 136 missing pairs on 118 assets. A concurrent outcome-label bug affected only labels, never the pairs; a new version corrected its accounting to 118 append candidates, 2,962 without a missing unambiguous new identity, 1,607 scope abstentions and six receipt exclusions. Both versions remain private.

A controlled overlapping resolver regression proves an asset with no match cannot inherit another asset's append outcome. Additional tests cover every receipt status, exact preimages, preservation of manual/legacy evidence and NULL-model/original-timestamp attribution. A fresh read-only rehearsal checked all 118 first-packet assets: 117 ready and one transient resolver abstention; a separate fresh diagnostic resolved that asset successfully. This is preparation, not delivery.

Discovery including unknown models initially found 47,510 exact-name candidate assets before current licensing qualification. That population is still under bounded independent accounting; it is not accepted repair coverage. Whole-task completion requires every admitted candidate's outcome and genuine live proof of all five requested examples. The same issue remains open for the full tagging run and other independently owned tasks.

## Current bounded packet and atomic proofs

The expanded 47,510-asset population partitions into 2,194 current-licensor candidates, 39,874 without an exact current-licensor match, 4,402 deleted/missing assets and 1,040 explicitly unlicensed assets. All 35 initially failed candidate reads were recovered within the original bounded budgets. The latest immutable private packet has SHA-256 `a53f21a968f9ef575a7c9cff87ceed62cfbedcb0349d3406c9b4a6573e05ba43`: 3,009 missing pairs on 2,188 assets, including 2,873 unknown-model pairs, plus six no-op outcomes. Earlier packets remain preserved. This is preparation only; broader punctuation/normalization discovery still requires a coverage check.

The native runner uses SERIALIZABLE per-asset transactions, existing bulk-operation advisory/config locks, asset and existing child-row locks, group share locks and brief core-taxonomy share locks. It never locks all child tables. A separate fresh READ COMMITTED read-only connection, under those held locks and before insertion, compares the entire guarded input set and actual resolver trace with both reviewed preimage and owning snapshot. This catches the reproduced snapshot-before-asset-lock phantom. Lock/statement/transaction budgets remain 500 ms / 2,500 ms / 3 seconds. UTC and microseconds are preserved, as is JSON array order.

Reproducible tests are committed at `scripts/tests/atomic-ai-character-relink.pg17.test.mjs`; run with a dedicated disposable localhost PostgreSQL 17 database using `T2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/postgres tsx --test scripts/tests/atomic-ai-character-relink.pg17.test.mjs`. The test refuses remote databases. All 24 cases passed, including genuine READ COMMITTED receipt/tag/link/group/taxonomy races, lock/statement/transaction timeouts, rollback, disk/post-read failures, reader cleanup and lost COMMIT responses before and after server commit. Phantom rejection checks require the exact changed-input reason and prove the competing rows survive unchanged; a source mutant removing the fresh-read guard wrongly commits the same reproduced race. Nine additional pure safety/adapter tests passed. Unknown commit outcomes require fresh point-read reconciliation; no blind retry or automatic restore exists.

Chase and Cheer Bear remain genuinely absent from the admitted canonical target set. Their separately governed, authoring-only two-character proposal is [shared-db #5683](https://github.com/popcre/shared-db/issues/5683), reserved version `20261105125335`. It uses primary publisher identity and existing ColdLion-backed licensors, with no property edges, aliases, parent edits or matched-row updates. That proposal has no merge/apply release. Both independent BEFORE evaluation partitions and coordinator exact source/manifest review remain prerequisites to any relink release.

A bounded native production READ ONLY smoke checked three existing assets/four pairs (three unknown models) against the actual PostgreSQL 17 schema: all three were ready with no abstentions. This used the unchanged TS resolver through the native adapter and preserved exact timestamp semantics, without row/table/advisory locks, inserts, search calls or model calls. The full reviewed packet was unchanged and a create-only private journal retains the evidence.
