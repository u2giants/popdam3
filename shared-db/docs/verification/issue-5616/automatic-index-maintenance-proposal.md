---
summary: "Issue 5616 controlled concurrent PopSG HNSW index maintenance capability: drills pass, operation policy empty, nothing enabled in preview or production."
kind: plan
status: open
read-when: working on 5616 automatic concurrent index maintenance for the PopSG HNSW
---

# Issue 5616: controlled concurrent SG index maintenance

STATUS: implementation and disposable PostgreSQL drills pass. The operation policy is empty. No preview or production operation is enabled or applied.

Owner: the coordinator of shared-db #5616 and PopDAM #663. This narrowly scoped capability preserves search during an identical physical index replacement. Keep it maintained here while required; consolidate into canonical maintenance tooling or retire it when superseded. It is not an arbitrary SQL executor.

## Why this route exists

The existing PopSG HNSW is 662 MB for approximately 56,454 current vectors after the earlier text-vector clear. A bounded synthetic experiment reproduced retained graph overhead: 56,454 original vectors, committed clear, then 13,500 new vectors produced a 286,539,776-byte index. An identical rebuild reduced it to 55,304,192 bytes. The write probe improved from 296.677 ms to 218.801 ms. This is local synthetic evidence, not production latency proof.

Building the fresh 56,454-vector fixture took 243.569 seconds with production-matching 128 MB maintenance memory. A transactional replacement would hold writers too long. The ordinary migration pipeline and atomic apply runner cannot execute concurrent index operations; their transaction and ledger behavior remains unchanged.

## Fixed operation and custody

Only public.style_guide_search_documents and its existing full-precision cosine HNSW are supported. Model identity, vectors, predicate, permissions, search behavior and source rows remain unchanged. No migration or migration-ledger entry is invented for physical maintenance.

The empty-default policy accepts a separately reviewed operation identity, exact source PR, work/claim issues, existing definition digest and bounded timeouts. The source PR must have authored the identical policy entry at its merge commit. An exact open claim must cover the table and all three deterministic index names. Foreign protected claims remain blocking; retired author-capacity rules are not reintroduced.

The operation builds an identical named index concurrently, swaps names in a transaction bounded to three seconds, then concurrently removes the exact retired index. The original valid index remains available throughout construction. Cleanup and completion require the replacement OID recorded in immutable evidence, not merely a matching name or definition.

## Existing automatic delivery integration

The existing automatic trigger selects preview first and production only after a successful exact preview operation. It reuses the migrations workflow and its existing target-qualified concurrency groups. A strict maintenance receipt namespace shares the existing migration_train_ref input; ordinary migration/train dispatches keep their existing validation and execution paths. No additional dispatch input or manual production route is introduced.

Preview maintenance takes the existing preview exclusion ref. Production takes the existing production ref and retains merge exclusion. The canonical automatic actor, current main, merged source, exact policy, target identity, native claim, finding hold and owned exclusive fence are re-proven before mutations. Protected credentials use the existing linked session-pooler path.

Immutable started/built/swapped/complete records bind source, policy, executor, target and OIDs. A completed preview also requires its successful exact workflow and maintenance job. Changed executor bytes or descriptor semantics require a new operation identity and explicit recovery custody; immutable evidence is never silently replaced. Failed builds preserve the old index and permit cleanup only of the exact owned incomplete replacement. Ambiguous catalog states refuse further writes.

## Verification and activation boundary

Offline coverage includes state/cancellation/replay/foreign-object cases, exact receipt and claim admission, existing exclusive controls and unchanged migration dispatch behavior. The coordinator also executed all three real PostgreSQL drills against a new isolated local database with pgvector 0.8.0: writers continue through replacement; cancelled construction preserves the old index and recovers; crash after the name swap recovers without rebuilding again. No Supabase database was used for these drills.

Before enabling an entry: resolve exact object custody, bind the measured budgets and definition digest in its own PR, rehearse against the configured preview target, and qualify automatic production delivery. No raw production command, paid capacity change, index precision change or capability removal is authorized by this document.

Acceptance remains on #5616: record the exact automatic preview/production evidence, index size, unchanged vectors/model/search capability and measured live write progress. A smaller graph alone does not prove all IO contention is cured. Keep residual performance work on the same issue. Application recovery evidence remains on PopDAM #663.
