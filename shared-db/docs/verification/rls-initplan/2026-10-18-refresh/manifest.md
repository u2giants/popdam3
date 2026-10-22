# Refresh and test specification for #4426

October 18, 2026 EDT. Verified production API: https://qsllyeztdwjgirsysgai.supabase.co . Snapshot source main: 977eec03bf3504646efb738b6e523793e2066333. Original candidate: 61517ebd5d682bdc5844bfd90d33e23ba2f9876d. No database mutation, migration reservation, structural claim or stage lease occurred.

## Inventory reconciliation

All 69 original identities match live catalog and original expression fingerprints exactly; 49 distinct tables, 93 total overlapping policies. No removed, already-fixed, changed or new matching identity. Advisor independently returned the same 69 targeted auth_rls_initplan notices. The four family manifests cover 46/17/4/2 policies without duplication. Full metadata, grants, RLS flags, implicit checks and helper definitions are in [catalog](catalog.md); transitive JWT helper and advisor metadata are in [advisor evidence](advisors-helpers.md).

## Actual role-enforced baseline

The MCP inspection identity refused SET ROLE authenticated with SQLSTATE 42501. Its elevated expression timings are not a security/performance baseline. The documented direct pooler route was then used with protected environment injection, the provider CA from its official dashboard source, certificate/hostname verification enabled, and read-only transactions. There were no credential or permission changes.

Existing administrator and nonadministrator subjects were selected internally; no subject identifiers, emails, tokens or row values are published. Request claims include only the selected subject and role=authenticated, with no email or app-role arrays. These minimal database contexts are reproducible baseline cases, not full application tokens. Every sample verified current_user=authenticated, rolsuper=false, rolbypassrls=false, transaction_read_only=on. The target tables are owned by postgres, not authenticated. One warmup plus ten measured count-only EXPLAIN ANALYZE samples for each of four query shapes and both contexts produced 88 successful plans, zero errors. Every transaction rolled back.

| Context | Actual relation | Median execution ms | p95 execution ms |
|---|---|---:|---:|
| admin | public.profiles | 0.8115 | 0.9920 |
| admin | public.order_list_user_views | 0.0580 | 0.1460 |
| admin | public.style_guide_tags | 121.5630 | 126.1560 |
| admin | core.packaging_type | 65.7880 | 85.1140 |
| member | public.profiles | 1.0485 | 1.9290 |
| member | public.order_list_user_views | 0.0585 | 0.2330 |
| member | public.style_guide_tags | 114.6850 | 152.8470 |
| member | core.packaging_type | 59.9765 | 70.2840 |

Raw plans/buffers, SQL and exact role proofs: [actual plans](actual-query-plans.md). Identity constants in plan text use subject labels; numbers/plan structure remain unchanged. These are existing-data SELECT counts, not UI latency, write throughput, a before/after improvement, or the mandatory preview cardinality matrix. Empty/restricted result paths and OR-composed policies are retained, not mistaken for positive permission coverage. Real production write acceptance remains with each repair child.

## Consumer and query mapping

[Current local source references](consumer-references.md) bind the inspected app commits, exact paths and lines for 38 table names. [Database consumer references](database-consumers.md) bind 41 function/view references by definition fingerprint, without invoking unknown RPCs. References alone do not prove current runtime use.

PopDAM covers assets, checkouts, tagging, queues, user devices/tokens, admin configuration, saved order/style views and packaging. Poppim/DesignFlow references are recorded where actually found. PopSG tag tables are additionally routed by the current canonical [PopSG file-tag contract](../../../app-migration-notes/popsg-file-tags-20260723.md): browser app_access(styleguides), definer worker RPCs/service role, and the style_guide_file_tags_display view must be tested separately. No global service-role test may substitute for the browser policy tests.

Legacy ERP mirrors/identity belong to the governed ERP relocation route; archive.erp_items_current/raw are not assumed to be public query targets. Product category/type/subtype tables and erp_sync_runs are read by PopDAM’s dynamic export-table and export-sql-dump routes: supabase/functions/export-table/index.ts lines 32–49 declare the allowlist and tableSource, line 87 invokes tableSource(db, table).select; the matching export-sql-dump route includes the same names. These admin-gated service-role exports are consumer paths, but bypass-RLS reads do not qualify the authenticated policy tests. Archived ERP raw tables have no active direct application caller established by this scan; retain their policy metadata/role tests and re-check indirect/dynamic callers at each repair. Absence of a static reference is not a removal or permission-change authorization.

## Exact collision and dependency map

All four family manifests require fresh table+policy claims at implementation; public.app_access, public.profiles and public.user_roles overlap admin/ownership work, so #4428 follows #4427. PopSG and packaging follow their recorded issue dependencies. No predecessor claim transfers.

Open claim #4158 holds table public.assets, public.style_groups and public.style_group_tags. Its recorded owner is codex/01a12d90-cce8-7131-b1eb-eff6becc806e-2421; capacity is relinquished and worktree clean, blocked_on issue:#2421. Expiry does not release the lock. #2421 remained open when checked, with latest activity October 18, 2026, 9:59 AM EDT; claim last changed October 12, 2026, 7:58 AM EDT. No active worker was verified. Preserve that owner’s objects. #4107 concerns dflow.user_roles, not public.user_roles, and is not an exact collision.

The first repair cannot take the complete 46-policy family while #4158 remains protected. Keep its three tables out of any claim until supported custody transfer/release or the existing owner completes it. No automatic cleanup or live-owner assumption is made.

## Before-test handover and limits

Each family manifest names its full exact policy list and command/role fixture cases. Required named trust-boundary tests are those in the existing implementation plan §9: malformed/missing subject, unassigned admin, ownership/reassignment/mixed batch, next-statement revocation, pooled context, packaging email and role union, unrelated app, permissive/restrictive composition, migration drift, null/empty/prepared queries, bypass detection and short-circuit errors. Preview fixtures, local SQL implementation, migration and application smoke tests have not started; those are explicitly implementing-child duties, not claimed as preparation completion.

This evidence releases only read-only preparation, not any blocked custody or repair gate. Parent #4421 and all four repairs remain open.
