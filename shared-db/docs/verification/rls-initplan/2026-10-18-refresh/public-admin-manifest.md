# public-admin: #4427 exact manifest

46 baseline identities on 39 tables. Every expression fingerprint matches the prior baseline. Disposition: eligible for qualification; none already repaired, removed, or silently added. This is not write authority.

Before authoring, claim every table below and every exact quoted policy on it, plus declared helper read dependencies. ALTER POLICY emits both table and policy identities. No claim was acquired for this preparation.

## Exact table coverage

- `table archive.erp_items_current`
- `table archive.erp_items_raw`
- `table plm.legacy_erp_item_identity`
- `table public.admin_config`
- `table public.agent_pairings`
- `table public.agent_registrations`
- `table public.ai_tag_bakeoff_results`
- `table public.ai_tag_bakeoff_reviews`
- `table public.ai_tag_bakeoff_runs`
- `table public.app_access`
- `table public.asset_characters`
- `table public.asset_tags`
- `table public.assets`
- `table public.characters`
- `table public.erp_enrichment_log`
- `table public.erp_sync_runs`
- `table public.hygiene_findings`
- `table public.invitations`
- `table public.licensors`
- `table public.pdf_text_samples`
- `table public.processing_queue`
- `table public.prod_order_headers_current`
- `table public.prod_order_headers_raw`
- `table public.prod_order_sync_runs`
- `table public.product_categories`
- `table public.product_category_predictions`
- `table public.product_subtypes`
- `table public.product_types`
- `table public.profiles`
- `table public.properties`
- `table public.render_queue`
- `table public.style_group_tags`
- `table public.style_groups`
- `table public.style_guide_crawl_runs`
- `table public.style_guide_files`
- `table public.style_guide_render_queue`
- `table public.style_tracker_rows`
- `table public.tiff_optimization_queue`
- `table public.user_roles`

## Per-policy before-test specification

For every identity, preserve OID, command, roles, permissive flag, USING, explicit/implicit WITH CHECK, grants, RLS flags, helper OID and the full applicable policy union. Record result row identities privately or as stable synthetic labels, and exact SQLSTATE. Fixtures belong only to a separately leased preview/local rollback transaction.

Run assigned administrator and ordinary authenticated user plus anonymous/missing/malformed subject; evaluate every applicable command listed below. Include simultaneous permissive ownership/app-access paths rather than expecting an admin-only deny. Revoke/grant role between statements, alternate admin/member request context, mixed-owner batches and errors. Wrap only the complete stable public.has_role(uuid, public.app_role) call after real before/after plans justify it. No changes to the helper or permissions.

| Table | Exact policy | Command | Roles | Fingerprint |
|---|---|---|---|---|
| public.assets | Admins can insert assets | INSERT | authenticated | 871431f621554a775f436516af6ab4fd |
| public.assets | Admins can update assets | UPDATE | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.licensors | Admin write licensors | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.properties | Admin write properties | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.characters | Admin write characters | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.product_categories | Admin write product_categories | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.product_types | Admin write product_types | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.product_subtypes | Admin write product_subtypes | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.asset_characters | Admin write asset_characters | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.processing_queue | Admin manage processing_queue | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.render_queue | Admin manage render_queue | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.agent_registrations | Admin manage agent_registrations | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.profiles | Admins read all profiles | SELECT | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.user_roles | Admins manage user_roles | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.invitations | Admin manage invitations | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.admin_config | Admin write admin_config | INSERT | authenticated | 871431f621554a775f436516af6ab4fd |
| public.admin_config | Admin update admin_config | UPDATE | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.admin_config | Admin delete admin_config | DELETE | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.style_groups | Admins can manage style_groups | ALL | public | aa60da9c00892d94ae69ce1095686ecf |
| public.agent_pairings | Admin manage agent_pairings | ALL | public | aa60da9c00892d94ae69ce1095686ecf |
| public.tiff_optimization_queue | Admin manage tiff_optimization_queue | ALL | public | aa60da9c00892d94ae69ce1095686ecf |
| public.erp_sync_runs | Admin manage erp_sync_runs | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| archive.erp_items_raw | Admin manage erp_items_raw | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| archive.erp_items_current | Admin manage erp_items_current | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.product_category_predictions | Admin manage product_category_predictions | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.erp_enrichment_log | Admin manage erp_enrichment_log | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.asset_tags | Admin manage asset_tags | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.hygiene_findings | Admin manage hygiene_findings | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.style_guide_crawl_runs | admin full access style_guide_crawl_runs | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.style_guide_files | admin full access style_guide_files | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.pdf_text_samples | admin full access pdf_text_samples | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.app_access | Admins manage app_access | ALL | authenticated | b46d9c3b7c1d4143bf5128b497368d12 |
| public.style_guide_render_queue | Admin manage style_guide_render_queue | ALL | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.prod_order_sync_runs | Admins manage prod_order_sync_runs | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.prod_order_headers_raw | Admins manage prod_order_headers_raw | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.prod_order_headers_current | Admins manage prod_order_headers_current | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.ai_tag_bakeoff_runs | Admin read ai tag bakeoff runs | SELECT | public | aa60da9c00892d94ae69ce1095686ecf |
| public.ai_tag_bakeoff_runs | Admin manage ai tag bakeoff runs | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.ai_tag_bakeoff_results | Admin read ai tag bakeoff results | SELECT | public | aa60da9c00892d94ae69ce1095686ecf |
| public.ai_tag_bakeoff_results | Admin manage ai tag bakeoff results | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.ai_tag_bakeoff_reviews | Admin read ai tag bakeoff reviews | SELECT | public | aa60da9c00892d94ae69ce1095686ecf |
| public.ai_tag_bakeoff_reviews | Admin manage ai tag bakeoff reviews | ALL | public | b46d9c3b7c1d4143bf5128b497368d12 |
| public.style_tracker_rows | Admins delete style tracker rows | DELETE | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.admin_config | Admin read all admin_config | SELECT | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| plm.legacy_erp_item_identity | legacy_erp_item_identity_admin_read | SELECT | authenticated | aa60da9c00892d94ae69ce1095686ecf |
| public.style_group_tags | Admin manage style_group_tags | ALL | authenticated | b46d9c3b7c1d4143bf5128b497368d12 |

## Performance and final acceptance

Preview/local tests: one, 100 and 10,000 synthetic rows, warmup followed by ten alternating original/candidate measurements; same non-bypass role, request context, plans, result sets and buffer settings. Record median and p95 in milliseconds. Actual production reads are bounded and read-only; production writes use only the owning application approved disposable-data route. No production fixture SQL or write EXPLAIN ANALYZE. A repeated >10% regression must be investigated. Do not close this child without live equal-access/performance/consumer proof.
