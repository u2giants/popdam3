# #5608: real-preview snapshot forward repair

Owner: Codex child `sku_job`; coordination/delivery owner: original coordinator.
Source migration `20261105044255` is immutable and installed in preview only.
Forward migration `20261105061627` was reserved atomically from current upstream.
Production delivery and the existing three-night acceptance remain open on #5608.

## Failure reproduced on the real preview

The original local 553,600-row volume success did not predict the live eight-portal
query plan. Preview catchup reached the unchanged 120-second outer statement limit
four times. The first runs durably filled 721,410 missing keys; a later run with zero
remaining keys only advanced 300 SKUs (100 to 400), proving resolver failure after
bootstrap. No successful whole resolver or nightly run is claimed here.

Read-only actual first-100-SKU arm timings were 16,697.877 ms (filename), 231.610 ms
(declared label), and 12,118.151 ms (portal label). The global portal fingerprint
alone took 10,179.246 ms. The 565,210-observation corpus was repeatedly scanned for
each batch. Cardinality estimates were accurate; recent autoanalysis, zero dead
rows and populated key statistics ruled out missing statistics on the large arms.
NBCU and Warner selected wide heap rows through ordered primary-key scans.

Pure read-only thin materialized source projections took 19,519.075 ms, and a
transaction-local hash-join/128-MB-memory diagnostic took 18,114.577 ms. Neither
was adopted. Sorted-digest and seeded-text whole-source trials also failed to
establish the no-change budget; every negative result was retained privately.

## Exact rollback rehearsals

Each rehearsal re-proved the configured preview branch from the production parent,
checked the shared-db task gate and current exclusive preview lease immediately
before writing, and executed only its reviewed SHA-bound script. Each transaction
used `lock_timeout=5s`, a requested `statement_timeout=60s`, no ledger/cron/routine
mutation, and a final `ROLLBACK`. Fresh subsequent connections proved both proposed
indexes absent and zero matching temporary relations. No rehearsal changed production.

1. SHA `d60c2993607bb56456ce395a75a362c7af4891eb253a915c65b92a1862f95b76`:
   indexes built in 7,520.404/1,321.378 ms; eight-arm raw snapshot 3,282.643 ms;
   original numeric-digest fingerprint 3,696.655 ms; temp indexes/analyze 3,487.832 ms;
   100-SKU arm executions 149.996/30.574/9.166 ms. Snapshot plus hash still failed 5s.
2. SHA `3e69c0a83902a46eaeaa8d5080a3cfcdf496f629dcae4e2285a75acea20d09ed`:
   existing 24-branch private view plus dual seeded **text serialization** snapshot
   6,682.237 ms; cached hash 316.000 ms; input/output hashes 430.529 ms: **7,428.766 ms,
   failure**. Same frozen-corpus hash comparisons: original 3,750.002 ms; dual seeded
   text 2,985.953 ms; sorted digest 3,317.981 ms. No planner override was adopted.
3. SHA `6228a2dfff9852e834ee23922f4552208e2a4c2909b7fc44ad2dc56ec1476a6e`:
   eight CASE arms plus dual seeded **typed record** snapshot 2,688.611 ms;
   cached multiset hash 320.730 ms; input/output preparation 38.188 ms:
   **3,047.529 ms**, passing the preparation portion of the no-change budget.
   Actual CTAS plan: 2,514.671 ms; NBCU/Warner covering index-only scans had zero
   heap fetches. Temp indexes/analyze cost 3,414.663 ms and are omitted when no SKU
   is pending. Actual 100-SKU arms took 7.356/15.738/9.018 ms. The separate diagnostic
   with local merge/nestloop disabled took 2,461.751 ms; default planning was retained.

These are exact preparation/SELECT measurements, **not** installed full/no-change
procedure CALL success. Actual governed post-apply full and no-change CALLs remain
mandatory, followed by complete output comparison and three genuine nightly runs.

## Schema and operational tradeoff

Only two nonunique covering indexes are added:

- `plm.nbcu_asset(capture_id,asset_source_key) INCLUDE(file_name,sku_sg_file_key)`
- `plm.wb_asset_normalized(id) INCLUDE(file_name,sku_sg_file_key)`

Actual sizes were 121,610,240 and 13,631,488 bytes: 135,241,728 bytes (about 129 MiB)
of additional index storage and write maintenance. No existing index is removed.
Maximum projected source row sizes were 653/312 bytes, below btree tuple limits.
Latest ordinary builds measured 8,969.859/1,392.817 ms (10,362.676 ms combined).
The migration requests a 15-second statement timeout and a 5-second acquisition
timeout. The former is not advertised as independently resetting an already-armed
outer statement timer: the automatic executor retains its existing outer cap.

Preview visibility baseline was NBCU 133,509/133,509 all-visible pages and Warner
38,388/38,407. Independently read production visibility was NBCU 53,797/56,331 and
Warner 0/18,880; preview index-only timings do not promise production heap avoidance.
No manual vacuum or statistics override was performed.

The private keys view is reduced from 24 branches to eight CASE arms, preserving
all columns, multiplicity, pending normalization fallback and computed-NULL empty
sentinels. The original externally used 24-branch public filename-index view is
unchanged. Preparation rebuilds an explicitly qualified `pg_temp` snapshot, safely
replacing incompatible caller-created tables/views and preserving it across commits.
Every batch and the portal fingerprint consume that same frozen relation. Nonunique
temporary indexes are built only when work remains. No permanent tracking table,
new exposed helper or global planner setting is added. The existing nightly command
receives only an inert source-version comment; job ID, schedule, owner, active state
and CALL behavior are preserved, without rescheduling or creating a job. A migration-first
`pg_try_advisory_xact_lock(5608,2)` fences replacement against an in-flight old
procedure/wrapper and remains held until the atomic file commits; busy fails 55P03
before either index is created. A real old procedure with its session lock refused
the atomic forward migration; after that procedure completed, the same whole file
applied successfully inside an explicit BEGIN/COMMIT on the owned volume database.

The cache format is `v3:` plus MD5 of count and numeric sums of two seeded
`hash_record_extended` values over the original six typed fields. All five text
inputs explicitly use deterministic `C` collation. NULLs, exact spelling, field
boundaries and duplicate multiplicity remain significant. This is an invalidation
fingerprint, not security evidence; the prefix invalidates the previous cache once.

## Local behavioral proof

All complete WB, NBCU, Sesame and SKU contracts passed on the owned full-schema
PostgreSQL 17 clone. The existing nine Node contracts passed. New SQL contracts
prove duplicate/NULL preservation, frozen portal evidence after source insert,
rename and delete, next-invocation invalidation, twice-per-transaction compatibility
calls and service-owned hostile temporary view replacement. Ten independent hash
properties passed: reordered rows stable; duplicate add/remove, NULL versus empty,
exact filename/label case, UUID, comma field boundaries, quote and newline changes
all invalidate the fingerprint. No collision is claimed impossible.

The retained disposable eight-portal snapshot fixture proves ready and pending
`EXCEPT ALL` equality, all-three-arm semantic output equality against the previous
resolver, and extension-only filenames whose normalized NULL keys still participate
in all eight label-match arms. Its session harness proves a separate connection's
portal rename after preparation commit cannot change current batches but invalidates
the next invocation. The initial cancellation trial paused before batch-two DML, proving entry cancellation
only. The strengthened trial executes batch-two progress and filename-link DML before
a post-DML sleep. A real 150-ms timeout rolls those 100 pending SKU/link writes back
while preserving exactly 100 committed SKU/link pairs from batch one, releases the
session advisory lock and retains catchup. The same
session resumes all 201 SKUs; repeated same-session and fresh-session CALLs converge.

The original source PR and forward repair must reach production in order through
the existing automatic workflow. The closed NOT_PLANNED finding's existing hold
expires November 5, 2026, 11:08:11 PM EST; expiry permits normal automatic selection,
not a manual production apply. The original coordinator retains delivery custody.

## Source-bound three-night acceptance

The earlier acceptance query could combine pre-repair successes with a single new
night. The forward migration now requires exactly one existing named nightly job
and calls `cron.alter_job` only for its command, adding the inert comment
`/* shared-db:20261105061627 */`. The read-only proof selects the latest three ALL
runs first, then requires each recorded command and the current job command to
match that exact source tag. It also requires the forward ledger version and
retains success, <60s duration, consecutive-date, catchup, freshness and ACL checks.
Untagged failures are never filtered away before selecting those three runs.

A hash-bound typed sidecar proves the exact single cron row: name, unchanged
`30 4 * * *` schedule, `postgres` owner, active true and exact tagged command.
Actual pg_cron 1.6.4 tests on the full-schema native fixture proved command tagging
preserves job ID/schedule/owner/active/database and rejects duplicate names; all
fixture row changes rolled back. A fresh raw extension fixture lacked the standing
postgres EXECUTE grant, so no grant was added. The canonical full-schema fixture,
fresh read-only preview check and coordinator's fresh read-only production check
all confirmed the existing grant. The synthetic fixture's minimal alter_job shim
has the real signature and was tested in a newly created, network-isolated local
cluster; no cron worker or background job was enabled for that shim.

Ten cases execute the actual live-proof SQL over isolated synthetic relations:
two historical plus one tagged false, three tagged consecutive successes true,
intervening failure/untagged command false, an untagged failure before three older
successes false, three latest tagged successes after older history true, duplicate
current job false, current command mismatch false, missing forward ledger false,
and over-budget nightly false. A complete fresh replay of the eight-portal fixture,
forward snapshot fixture, post-DML cancellation/session harness and live-proof
fixture passed after this acceptance correction.

The final current-job assertion additionally requires active true, postgres username
and the unchanged schedule, while run durations must be nonnegative. Four additional
actual-probe negatives (disabled job, changed schedule/owner and negative duration)
passed, bringing the isolated proof fixture to fourteen cases.

A final native-catalog check showed `cron.job_run_details.command` is nullable.
The actual proof initially failed a new negative case: two tagged successes plus
a NULL-command success passed because bool_and ignores NULL. Both all-run and
current-job predicates now coalesce unknown values to false. The actual-proof
fixture passes seventeen cases, including NULL historical/current commands.
