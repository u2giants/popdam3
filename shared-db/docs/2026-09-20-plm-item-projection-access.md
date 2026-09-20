# Item-serving access investigation — issue 3329 (non-orchestrator)

Date: 2026-09-20. READ ONLY. Recommendation for parent decision: verified-not-required for a permission-tightening structural successor. Existing tests explicitly require authenticated projection access and deny direct item-detail access; production matches. This is stronger than merely finding no proven bug. Do not revoke authenticated access or change security_invoker merely because joined bases are restricted.

## Scope and provenance
- Isolated worktree D:/repos/.worktrees/item3329-read-20260920; branch codex/item3329-read-20260920; origin/main b1d4be2ef308. No commits, repository edits, claims, GitHub writes, credential fetching or database mutations.
- Task gate recorded prose (scratch report only); read-only is not a valid installed class.
- Live MCP target verified immediately before reads: https://qsllyeztdwjgirsysgai.supabase.co. current_user=supabase_read_only_user. Catalog metadata only; no row contents or impersonation.
- PopDAM current local origin/main f3fb0c943af7f216b74507b50c242555f65226b1.

## Controlling delivered contract
Issue 2466 explicitly requested preserving the exact 21-column application contract while changing the source to canonical ColdLion items. Issue 2644 required preserving api.plm_item_list.dismissed while restricting mutation to admin/service; no raw payload exposure was requested. Issue 2482 preserved frozen legacy UUID compatibility after ERP retirement.

Exact existing test evidence, supabase/tests/plm_item_list_repoint_contracts.sql:
- Lines 47-53: raises if view is not definer/barrier; raises '#2466: authenticated lacks SELECT on api.plm_item_list'; separately raises '#2466: authenticated can bypass the serving view and read coldlion.item_detail'. Thus the apparent grant mismatch IS an intentional tested boundary.
- Lines 158-165 test authenticated serving read and declare '21 columns, protected authenticated serving, legacy identity, canonical mappings, direct prepacks, source filter, null attribution and PopDAM-owned dismissal state.'
- Prior actual-user evidence: https://github.com/popcre/shared-db/issues/2466#issuecomment-5631189763 (2026-09-11T07:47:13Z): 'Actual sealed PopDAM viewer identity matched: HTTP206 in861ms, first50 rows all canonical, exact total19,362.' Historical evidence, not a fresh auth probe.

## Live field/role contract verified today
Live definition matches migration 20260911210844_retire_erp_items_to_archive.sql lines 79-144.
- Anonymous: SELECT denied.
- Authenticated (including ordinary signed-in browser users): USAGE on api and SELECT on whole 21-column view. No per-view application/role predicate; rows restricted to canonical source_system=coldlion.
- Service role: SELECT allowed; used in canonical server readers and controlled export.
- View: postgres owner; security_invoker=false, security_barrier=true.
- Output identity: id uses legacy UUID for designated legacy match, canonical UUID otherwise; source_id and style_number are canonical item_number. Consumers must not confuse compatibility id with canonical FK identity.
- Item summary: item_description; mg_category; mg01_code through mg06_code; size_code; licensor_code; property_code; division_code. Canonical foreign-key attribution joins, not raw arbitrary payload.
- Prepack projection: prepack_code=min(trimmed nonempty detail code), prepack_codes=distinct sorted codes; keyed by company, division and item number. Does not expose other coldlion.item_detail columns.
- Dismissal projection: coalesce(state.dismissed,false) only; no state actor, timestamp or write capability. Issue 2644 explicitly demanded preserved read behavior and admin/service mutation.
- Freshness/source: erp_updated_at from source modTime; synced_at from canonical updated_at; source_system.
- No full raw payload, cost/price, user profile, state actor or audit actor column exists in the output.
- Live plm.item SELECT policy item_popdam_read is USING(true) for authenticated. Other plm role policies are permissive alternatives; their presence does not negate the unconditional read policy.

## Actual consumer path
PopDAM origin/main:
- src/components/library/StyleGroupDetailPanel.tsx lines 502-516 directly uses normal browser supabase client: schema(api).from(plm_item_list).select('erp_updated_at, item_description'), filtered by style and division. This read has no isAdmin condition. The component separately calls useIsAdmin for other actions. Revoking SELECT breaks item descriptions/legacy-date behavior.
- supabase/functions/_shared/canonical-erp-items.ts canonicalItems provides the server serving path; identity resolution deliberately separately queries plm.item to avoid confusing compatibility IDs.
- supabase/functions/_shared/licensing-resolution.ts lines 61/104 reads canonical attribution.
- supabase/functions/_shared/admin-handlers/erp-browse-handlers.ts uses canonicalItems and explicit SQL over api.plm_item_list for review queues/counts.
- apps/worker/src/canonical-erp-items.ts and handlers/erp.ts use canonical serving rows for enrichment.
- supabase/functions/export-table/index.ts line 45 maps export to view; line 54 enforces requireAdmin(req,{parseMode:'loose',allowServiceRole:true}). Endpoint authorization is narrower than baseline field read and remains intact.
- Live pg_depend confirms nested relation public.style_tracker_rows_with_bridge. Its known definition projects item_description as canonical_description and style_number as erp_style_number. This nested access is part of bridge investigation 3328, not new view scope.

## Business authority and limits
Business rules master-data-access.md explicitly settles Styles editing for signed-in POP users, but states: 'Companywide view and edit permissions for other Master Data objects remain Unknown unless their business topic contains a dated decision.' Therefore do not generalize this delivered projection into permission to read every Master Data table or source payload. Product-items-and-identifiers.md distinguishes prepack membership from item identity and identifies ColdLion as source authority; none of those rules revokes this established summary projection.

No demonstrated unauthorized exposure found within this bounded contract. No newly required field/role restriction identified. A future business policy to restrict canonical summaries by app/role would require an explicit scoped policy decision and migration coordinated with the existing browser caller, not an automatic hardening patch. Non-inventory/product-catalog semantics are separate from this access question and were not re-adjudicated.

Parent next action: accept/reject recommendation; preserve this evidence in issue 3329 and use normal verified-not-required completion route if accepted. This agent did not open issue 3329 and must not close it. Fresh browser behavior was not exercised; live catalog and existing deployed consumer code were checked, with prior authenticated acceptance clearly dated above.
