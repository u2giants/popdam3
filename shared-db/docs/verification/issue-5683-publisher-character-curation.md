# Publisher-backed missing characters — issue 5683

Application need: [PopDAM #680](https://github.com/u2giants/popdam3/issues/680). Governed canonical claim: [shared-db #5683](https://github.com/popcre/shared-db/issues/5683).

## STATUS

Authoring only. No preview, merge, automatic promotion or production release has been authorized for this packet. The first source review found a preflight/insert race; the original eight row tests alone did not establish concurrency safety. Current reserved version 20261105142616 follows the coordinator's lower ordered train. Keep the existing lower-version verification repair and ordered migration dependencies visible; this source PR cannot leapfrog them. No canonical row or relink has been written by this task.

The packet inserts exactly Chase under the existing PP licensor and Cheer Bear under the existing CB licensor, plus one auditable source reference each. It creates no property edges, aliases or parents; it never updates a matched row. Codes remain NULL because the public roster supplies no business code. Existing unrelated Chase identities remain unchanged.

## Source admission

The coordinator independently admitted these two outside-source identities under the company licensing authority, for authoring only:

- [Paramount / Nickelodeon PAW Patrol character roster](https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/) names Chase. Protected capture SHA-256: `aaa02545232ed4de09829b582f9e9c7396fcea13c8796ced112ccc08e0f8c08a`.
- [Official Care Bears roster](https://www.carebears.com/) names Cheer Bear. Protected capture SHA-256: `7f010a2a3750014f845eaf35709189358042c034a27e339942ceab875b251cdb`.

The `#chase` and `#cheer-bear` fragments in source-reference identities distinguish the named entry within its actual roster page; they do not assert that the publisher implements anchor navigation. The underlying URLs above are the captured sources. Raw HTML and source rows remain private. Publisher identity does not supply POP licensing ownership or a property edition. The existing active licensors were independently qualified by two ColdLion references each. Exact opaque hashes bind the unchanged full parent and its ColdLion witnesses; any change abstains the entire packet. DesignFlow-only property candidates have no authority here and are unused.

## Guards and isolated evidence

The existing curated SQL inspector is unchanged and accepts writes only to `core.character` and `core.taxonomy_source_ref`; reads are limited to core character/alias/licensor/source references. Every identity probe includes all statuses: scoped normalized names/codes, alias values, source names/codes, direct metadata source identities, global source identities and planned IDs. Any match/conflict aborts the complete transaction before either insert. No conflict update or partial fallback exists. A bounded live READ ONLY probe using the same conditions found both identities absent and both parent/authority witnesses unchanged.

`T2_CURATION_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/t2_curation python3 scripts/tests/test_publisher_character_curation_5683.py` requires a dedicated disposable local PostgreSQL 17 database; it refuses any remote URL. Nine tests passed: exact two inserts and repeat abstention, inactive normalized-name collision, inactive code collision, alias collision, global source identity conflict, source-name/code/metadata identity conflicts, changed parent/source witness, preservation of an unrelated same-name character, and execution of all four native typed checks against an actual app.entity_status enum column. A text-descriptor mutant fails 42883, proving the fixture catches enum incompatibility. Every refusal compares complete before/after fixture state. Fictional parent/source rows replace only opaque authority hashes in the fixture; no private production rows are committed.

Four hash-bound native typed sidecar checks assert each exact character singleton and its exact source singleton. The sidecar integrity checker passed. These assertions prove the two admitted rows; they do not claim authenticated PopDAM relink delivery.

## Remaining delivery

- [ ] Coordinator review of exact source, source admission, identity guards and preserved authority.
- [ ] Qualified ordered preview and automatic promotion through the canonical workflow; no manual production SQL.
- [ ] Native production catalog proof: all four sidecar checks pass; parents, unrelated identities, aliases and property edges remain unchanged.
- [ ] Rebuild the bounded historical relink packet from current live canonical state using the actual application resolver; preserve genuine AI source, NULL models and original timestamps.
- [ ] Ordinary authenticated PopDAM examples show Chase and Cheer Bear, alongside Chucky, Michael Myers and Dwight on the same application issue. No model calls or blanket retagging establish that proof.

## Exact admission barrier — source preparation only

The existing atomic runner and its typed allowlist now opt this one exact version and SQL SHA-256 into named contract `curated-character-admission-5683-v1`. The runner, before the unchanged curated DO body, transactionally acquires SHARE ROW EXCLUSIVE on exactly core.licensor, core.character, core.character_alias and core.taxonomy_source_ref. It sets UTC and local 500ms lock / 2500ms statement / 3s transaction limits. No caller-selected identifiers, mode, budgets or SQL LOCK permission are accepted. No RPC or schema change exists. Other atomic/health/HTS wrappers remain byte-identical, with regression checks for every existing allowlisted version. The claim includes the two additional lock dependencies; they receive no row writes.

The unchanged curated SQL allowlist still accepts the original body. The atomic policy and native wrapper independently reject wrong version, SQL hash, contract, extra tables/mode, and missing required contract. All 31 native atomic unit tests passed. Four additional genuine two-connection PostgreSQL17 tests cover four competing character/alias/source/witness mutations after actual preflight, ordinary/FK-style reads remaining available, a preexisting writer causing exact 55P03 bounded rollback with no rows/ledger, the source mutant without its barrier wrongly committing a duplicate after preflight, and real statement/total-transaction timeout rollback with lock release. Existing parent/source rows remain exact in the protected cases. Tests use the same dedicated local fixture and synthetic authority hashes, with no production data.

Current version 20261105125335 was proven absent from both live ledgers before this runner-only transition; the SQL bytes were not edited. The coordinator has identified a new lower-train ordering dependency, so any later forward reservation/SQL change requires fresh both-ledger absence and claim custody first. Production pool checkout is currently failing with ECHECKOUTTIMEOUT; this is not evidence of ledger absence. The global source-ID worst-miss plan/footprint and actual current schema compatibility remain unproved until bounded read capability returns. No source approval or release is inferred from local fixtures.

## Forward source transition

The same owner/claim/PR forward-renamed the everywhere-unapplied125335 source to142616 after fresh native both-ledger absence proof, clear foreign-owner collision accounting and unique reservation after VA142040. Original source SHA0b14189a4bdb1dfab6e8488f0454cc5583afaf12b131e3a32f1babe15a0a3f6b remains in Git history; only the actor-version marker changes SQL bytes. New exact binding SHA256 `0abddd08f3abd50c3470b4d3347c949ca1796c5334bf355650b26ed2bf8ddc5e`. The same two character IDs, primary source receipts, parent/witness hashes, guards and fixed barrier remain. Current main83ddd is incorporated. No serial preview/merge/apply release is implied.

Actual native PG17 constraints/indexes were read successfully after recovery. The original complete global guard worst-miss EXPLAIN completed1092ms execution plus258ms planning under2500ms/3s budgets; it honestly uses global sequential scans over15117 characters and15769 source references twice, alongside existing indexed alias/parent witnesses. Exact source-key miss used the existing triple-identity index in1.37ms. A subsequent full predicate read timed out57014 at2500ms, so qualification stability still requires a successful current read; no absence is inferred from that timeout.

## Current release candidate — forward142616

The current SQL binding is SHA256 `faa341b2e472907f1e31275068b4c258272f6e0df782401cfaaec000faeb9059`. Under the unchanged four-table transaction barrier, identical global metadata/source-ID checks now examine both admitted source IDs together once before the per-character loop. Only their duplicate per-character OR terms were removed. Every scoped ID/name/code/alias/source-name/code and parent/witness guard remains unchanged. Additional negatives prove either global ID still aborts across unrelated licensors, inactive characters and foreign source systems.

The exact current full parents and four ColdLion witnesses were recaptured through the actual fixed-UTC native route. Comparison with immutable original rows shows zero field changes after exact timestamp-instant comparison; only timestamp text rendering differed between native and management sessions. Only opaque complete-row authority hashes were refreshed, under coordinator source authority. No guard was weakened and no source/parent row was edited. The fresh actual native predicate returns both identities absent and both parent/witness hashes true. The optimized actual worst-miss plan completed303ms execution plus47ms planning, against1092ms+258ms before removing duplicate reads, under unchanged2500ms/3s budgets. The independent exact source-key miss used the existing unique source index in1.37ms.

Current source is draft while the owner completes concrete checks; it must not block the next VA serial delivery. Source-only readiness does not authorize merge, preview or production. Broader historical normalization is bounded by the actual731 merge cutoff `2026-11-05T11:46:05Z`, while preserving the original3009-pair packet. The separate185-asset/212-tag follow-up has now passed the actual unchanged current application resolver:207 missing pairs on184 assets,205 unknown models, with zero changed/after-cutoff source tags. Its immutable private packet hash is `055c2c253d5c443d1cfac0bb61f329144083ebe747fd050008cf2940703f8f2d`. Wider normalized discovery remains in progress and no production relink has run.
