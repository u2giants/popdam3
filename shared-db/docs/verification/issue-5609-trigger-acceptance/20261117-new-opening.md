---
summary: "Issue 5609 November 17 complete 226-entry opening invalidated by statement eviction; original criteria and failed source preserved."
kind: proof
status: open
read-when: "continuing the November 17 assets trigger acceptance window or verifying its source and counter bindings"
---

# November 17 first complete opening — INVALIDATED

Owner: Codex coordinator 01a1eb75 on [#5609](https://github.com/popcre/shared-db/issues/5609). This is an observation opening, not completed acceptance. The same issue retains its unchecked live-proof item.

## Authoritative invalidation

At **November 17, 2026, 5:36:03.763737 PM EST**, independent target-proved diagnosis found deallocation **75** against opening **74**. Postmaster/reset identities and all observed family identities still matched; genuine surviving call delta was **0**, post-opening metadata count **0**. Endpoint survival cannot exclude an intermediate new family tuple being created then evicted. This opening is INVALID and its former November 18 full-day date is WITHDRAWN. No successor opening is selected. Preserve the exact original [failed opening probe](5609-20261117-failed-window.sql), SHA256 `f588afb03d66cd7fdb369f5f9fb385df641a310b54162814b3a4ca5dfb72ab6d`.

A further target-proved capacity read found `pg_stat_statements.max=5000`, 4777 current entries and deallocation75; its context is `postmaster`. This is an actual finite-capacity eviction, not a missing original tuple or a reason to weaken the global guard. PostgreSQL documents that a capacity change takes effect only at server start; Supabase's supported Management API exposes the setting. A restart would invalidate #5610's remaining valid fourteen-day observation. The coordinator therefore preserves that observation and serializes any justified controlled capacity/restart repair after its eligible index decisions/delivery, using an authorized infrastructure route, never ad-hoc production SQL. No restart/configuration/statistics mutation is performed here. This technical dependency is not complete delivery.

Sources: [PostgreSQL17 capacity rules](https://www.postgresql.org/docs/17/pgstatstatements.html#PGSTATSTATEMENTS-CONFIG-PARAMS), [Supabase supported configuration API](https://supabase.com/docs/reference/api/v1-update-postgres-config), [Supabase configuration/restart guidance](https://supabase.com/docs/guides/database/custom-postgres-config).

The coordinator's concrete continuity-repair target is to increase capacity from5000to40000through Supabase's supported configuration control, with current permission/target proof, rehearsal and the applicable infrastructure/production task gates. The official API lists `pg_stat_statements.max`, accepts100through45000, and requires `database_config_write`; the earlier50000draft exceeded the supported maximum and was corrected to40000before any request. it is not a session SET parameter. Do not apply it by ad-hoc SQL or silently restart now. No configuration request has been sent, no restart has occurred and no new release route is activated by this document.

Execution order owned by this coordinator: (1) complete #5610's unchanged-index observation and final refresh/decisions on or after November20,2026 11:25:52.885243AM EST; (2) deliver any justified removals normally; (3) run the supported qualified capacity/restart repair after those observation decisions are safely preserved; (4) verify effective40000, current target/role/postmaster/reset and capability, then open BOTH the required post-removal no-regression interval and a newly predeclared #5609 complete-family interval after the restart, so neither subtracts across it; (5) obtain the required real-day/call/cost/correctness evidence and official artifacts. If no drop is justified, preserve the complete no-safe-drops decision explicitly and still repair #5609 continuity. Preview ownership, applicable current infrastructure rules and supported permission/settings limits must be rechecked before any mutation. A route the AI cannot authorize remains a named blocker on #5609; it is never bypassed or handed to Albert for technical approval.

The selection and snapshot below remain the immutable historical opening record. Its conditional date never became acceptance. All unchanged original savings/correctness requirements, including the hosted WAL deficit, remain pending. Existing source/fixtures still fail closed.

## Selection and actual live qualification

The coordinator [predeclared the first complete selection](https://github.com/popcre/shared-db/issues/5609#issuecomment-6962109907) before capture: after actual delivery of the metadata-selector correction and independent source/functional verification, use the first complete unfiltered snapshot, without selecting on favorable cost or traffic. No performance-based recapture occurred.

[PR #6617](https://github.com/popcre/shared-db/pull/6617) actually merged as `924d24a14dac7e563ad2b2e0b5ba3c7315847765`. Freshly fetched main's probe SHA256 matched the reviewed correction, `4ebc6ddcacbb3b2e1ae885472a2c6659405a2ffdd4e23137d6e83de4c0239a9e`. A target-proved production functional SELECT using its exact CTEs/predicates returned three matching metadata records, all original exact trigger/image/read-access checks true, and zero primary-thumbnail mismatches at **November 17, 2026, 5:15:40.628397 PM EST**. Those records precede this opening and are not the required future three post-opening samples.

The FIRST complete capture was **November 17, 2026, 5:16:02.552460 PM EST**. Conditional earliest full-day eligibility is **November 18, 2026, 5:16:02.552460 PM EST**. Elapsed time alone cannot pass: authentic calls, costs, current metadata, counter/identity continuity and all other original conditions still must pass. The separate #5610 fourteen-day observation remains unchanged.

The protected configured identity was compared with the fresh connected production identity immediately before each read. Reader: `supabase_read_only_user`. Only catalog/statistics and aggregate boolean correctness observations were collected. No application row export, DDL/DML, statistics reset, synthetic workload, fixture, application deployment or configuration change occurred in this opening. Earlier fixture disclosure remains in the [diagnosis](20261117-current-diagnosis.md).

## Lossless snapshot and source binding

[Capture SQL](20261117-opening-capture.sql) is one SELECT over the complete original prefix, with no role/database/top-level restrictions or LIMIT. Numeric counters are text-valued in JSON. [Exact opening JSON](20261117-new-opening.json) contains all 226 tuples, table counters, reset identities and read role. Its SHA256 is `82b328601d52d99c3525bb171e12d116b18b5ae4fd657b900e7ab5c5760f3450`.

- Family count: **226**; typed sorted MD5: **8431240c38706c96991024f40198899c**.
- Postmaster: November 6, 2026, **11:20:19.434455 AM EST**; statement reset: **11:20:19.263334 AM EST**; database reset NULL; statement deallocation **74**.
- Assets OID **17809**, update counter **668116**; search documents OID **713489**, update counter **1271402**.

Python's lossless decoder and an independent isolated PostgreSQL 17 VALUES-only query reproduced the same 226-entry typed hash. No production fixture was used for that verification. The generator now quotes the signed bigint query identifier, fixing its demonstrated minimum-bigint cast overflow without changing any numeric value or hash. The existing minimum-value fixture now compiles in PostgreSQL and matches Python's typed hash.

The exact archived failed-opening probe SHA256 is `f588afb03d66cd7fdb369f5f9fb385df641a310b54162814b3a4ca5dfb72ab6d`. Its entire `query_stats`-through-final acceptance suffix is byte-identical to #6617; all three PRE-reference lines are byte-identical. Only opening identity/counter values and the complete family vector changed. Twelve Python tests and isolated PostgreSQL selector 2/2, family 26/26, trigger 19/19 and metadata 104/104 cases pass. The qualified repository read-only lexer accepts it. Actual target-proved execution before a full day returned `passed=false`, correctly. No official successful production live-proof artifact is claimed.

## Preserved failure and exact completion contract

The November 6 window remains INVALID because observed deallocation reached 74 against its pinned zero. Its selector-corrected exact source is archived as [5609-third-failed-window-corrected.sql](5609-third-failed-window-corrected.sql), SHA256 `4ebc6ddcacbb3b2e1ae885472a2c6659405a2ffdd4e23137d6e83de4c0239a9e`. Its earlier source and the first two failed windows remain preserved. This opening does not repair, re-label or average away those failures.

The authentic original PRE references remain frozen and their stricter LEAST remains binding: weighted mean runtime strictly below **81.80826627638924305 ms/call**, WAL strictly below **29548.5825136248835 bytes/call**, and document-update rate below **8829/5050.846546 per second**. At least 24 real hours and 100 genuine calls across the COMPLETE original prefix family are required, with every opening tuple, query hash/start/counter and table identity intact, unchanged postmaster/reset/deallocation, and valid genuinely new tuple timing. Three current post-opening metadata matches, ten exact bindings, original image/read access and zero thumbnail drift remain required. The hosted **33.08% versus required 50%** WAL deficit and all historical invalid/interim deficits remain unresolved.

The former full-day time is withdrawn after the invalidation above. After an actual supported continuity repair and a new explicitly selected full capture, the coordinator freshly verifies target/source, runs the exact committed probe through the existing Shared DB Live Proof workflow for issue 5609, and examines every failed predicate if it refuses. The active probe has typed empty opening fields and an empty family vector until a separate eligible capture. Its acceptance suffix and the frozen comparison thresholds remain unchanged. A successful functional fragment is insufficient. If continuity fails, retain the failure and diagnose it before explicitly selecting any successor. If genuine calls or savings remain insufficient, keep the same issue open and investigate actual attributable workload; never generate traffic, change thresholds, or take a favorable subset. Current deployed relevant ingestion/licensing files were independently source-hash verified on [the same issue](https://github.com/popcre/shared-db/issues/5609#issuecomment-6962080787); no additional producer repair was proved.
