---
summary: "Issue #5426 note: retired contract refs moved to refs/db-evidence/contracts, same commit SHAs; coordinator CLI is the surviving migration tool."
kind: living
status: current
read-when: locating historical contract storage after author-lane retirement
---

# Historical contract storage after author-lane retirement

Owner: shared-db issue #5426. This completes the repository-maintenance follow-up
to ai-devops #2172 and partial retirement #5409. It creates no author admission,
review assignment, schema change or new production route.

The surviving migration CLI is `scripts/manage-migration-coordination.mjs`.
Preview, production, merge interlocks, ownership fencing, recovery, promotion
freezes and train verification keep their existing implementation. Active
workflow callers and recovery dependency roots use the coordinator directly;
the retired author-lane entrypoint is removed, without a compatibility launcher.

The retired remote `refs/db-contracts/<issue>/<generation>` namespace is replaced
by `refs/db-evidence/contracts/<issue>/<generation>`. Each preserved ref points
at the **same commit SHA**, retaining the immutable contract bytes and history.
Existing completion reports keep their original logical `contract_ref` strings;
rewriting those records would invalidate their historical evidence. The shared
`scripts/lib/contract-storage.mjs` mapping translates that logical identity at
Git/API transport boundaries. Publication, generation planning, validation and
historical recovery use the preserved storage, not the removed namespace.

`scripts/retire-contract-refs.mjs` is the bounded migration/verification tool
owned by #5426. Its only shared purpose is this retirement and later verification
of its recovery manifest; it is not a second coordination system. Preparation
preserves every original SHA in an independent Git bundle and JSON manifest,
copies absent archive refs atomically, refuses conflicting archive refs and
verifies the complete result. Originals remain during preparation and until the
archive-aware coordinator is merged.

Application refuses any original/archived SHA change or a new unbacked original
ref. It deletes only the recorded original refs in bounded 50-record atomic
batches, with per-ref compare-and-swap protection. GitHub's unchanged secret
scanner can time out on a bulk deletion as well as a bulk copy. All records
are preserved before deletion begins; a retry accepts a partially retired
snapshot only when every recorded SHA is still preserved and every remaining
original is unchanged and backed up. It then verifies the original namespace is empty
and all archived SHAs still match. Other coordination refs are untouched.
Keep the bundle and manifest until the issue's live migration proof is recorded;
the remote evidence refs remain the durable recovery copy afterward. A restore
uses the manifest's exact original-to-SHA mapping or the bundle, never rebuilt
contracts or a forced overwrite of another holder.

Historical operating documents and immutable audit snapshots may retain old
names as evidence. They do not make retired commands available again. Real
post-merge preview/production migration proof and the preserved ref count belong
on #5426; test or archive success alone is not live migration proof.
