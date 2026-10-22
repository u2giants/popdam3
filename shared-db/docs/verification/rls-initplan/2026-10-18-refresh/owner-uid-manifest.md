# owner-uid: #4428 exact manifest

17 baseline identities on 7 tables. Every expression fingerprint matches the prior baseline. Disposition: eligible for qualification; none already repaired, removed, or silently added. This is not write authority.

Before authoring, claim every table below and every exact quoted policy on it, plus declared helper read dependencies. ALTER POLICY emits both table and policy identities. No claim was acquired for this preparation.

## Exact table coverage

- `table public.app_access`
- `table public.asset_checkouts`
- `table public.helper_devices`
- `table public.helper_tokens`
- `table public.order_list_user_views`
- `table public.profiles`
- `table public.style_tracker_user_views`

## Per-policy before-test specification

For every identity, preserve OID, command, roles, permissive flag, USING, explicit/implicit WITH CHECK, grants, RLS flags, helper OID and the full applicable policy union. Record result row identities privately or as stable synthetic labels, and exact SQLSTATE. Fixtures belong only to a separately leased preview/local rollback transaction.

For each applicable command below, create two synthetic users and own/other/null-owned rows in preview. Test visible row IDs, foreign-owner INSERT, UPDATE ownership reassignment, mixed batch rejection, zero rows, malformed subject, prepared execution and next-statement revocation. Keep user_id correlated; wrap auth.uid() only. A different permissive policy may still grant access.

| Table | Exact policy | Command | Roles | Fingerprint |
|---|---|---|---|---|
| public.profiles | Users read own profile | SELECT | authenticated | 5eebdfba311617743b110b29a41f23a0 |
| public.profiles | Users update own profile | UPDATE | authenticated | 5eebdfba311617743b110b29a41f23a0 |
| public.app_access | Users read own app_access | SELECT | authenticated | 5eebdfba311617743b110b29a41f23a0 |
| public.helper_devices | users see own devices | SELECT | public | 5eebdfba311617743b110b29a41f23a0 |
| public.helper_devices | users insert own devices | INSERT | public | f2ddbc79e24daf371a14e31c92b8402a |
| public.helper_devices | users update own devices | UPDATE | public | 5eebdfba311617743b110b29a41f23a0 |
| public.helper_tokens | users see own tokens | SELECT | public | 5eebdfba311617743b110b29a41f23a0 |
| public.helper_tokens | users insert own tokens | INSERT | public | f2ddbc79e24daf371a14e31c92b8402a |
| public.asset_checkouts | users insert own checkouts | INSERT | public | f2ddbc79e24daf371a14e31c92b8402a |
| public.asset_checkouts | users update own checkouts | UPDATE | public | 5eebdfba311617743b110b29a41f23a0 |
| public.style_tracker_user_views | Users update their own style tracker views | UPDATE | authenticated | 7ea2326acd7022f54ccb7566a1d93f26 |
| public.style_tracker_user_views | Users read their own style tracker views | SELECT | authenticated | 5eebdfba311617743b110b29a41f23a0 |
| public.style_tracker_user_views | Users insert their own style tracker views | INSERT | authenticated | f2ddbc79e24daf371a14e31c92b8402a |
| public.order_list_user_views | order_list_user_views_owner_select | SELECT | authenticated | 5eebdfba311617743b110b29a41f23a0 |
| public.order_list_user_views | order_list_user_views_owner_insert | INSERT | authenticated | f2ddbc79e24daf371a14e31c92b8402a |
| public.order_list_user_views | order_list_user_views_owner_update | UPDATE | authenticated | 7ea2326acd7022f54ccb7566a1d93f26 |
| public.order_list_user_views | order_list_user_views_owner_delete | DELETE | authenticated | 5eebdfba311617743b110b29a41f23a0 |

## Performance and final acceptance

Preview/local tests: one, 100 and 10,000 synthetic rows, warmup followed by ten alternating original/candidate measurements; same non-bypass role, request context, plans, result sets and buffer settings. Record median and p95 in milliseconds. Actual production reads are bounded and read-only; production writes use only the owning application approved disposable-data route. No production fixture SQL or write EXPLAIN ANALYZE. A repeated >10% regression must be investigated. Do not close this child without live equal-access/performance/consumer proof.
