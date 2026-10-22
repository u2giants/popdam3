# PopSG coordinator baseline — October 18, 2026

Observed October 18, 2026, 1:05–1:08 PM EDT. Delivery cards remain [PopSG #107](https://github.com/u2giants/popdam3/issues/107), [canonical semantic work #4437](https://github.com/popcre/shared-db/issues/4437), and [existing repair #4210](https://github.com/popcre/shared-db/issues/4210). This is refreshed evidence, not completed semantic delivery.

## Source and scope

Application worktree starts from current upstream [5e6430f5](https://github.com/u2giants/popdam3/commit/5e6430f5). Canonical inspection starts from [e5e6245e7](https://github.com/popcre/shared-db/commit/e5e6245e7). Dedicated worktrees preserve unrelated files and older source. The user authorizes sequential database and application implementation workers; the second worker must wait for independently verified live database delivery and native custody release/accepted transfer. The coordinator retains design, security, review, merge, production and final-verification decisions.

## Production target and method

Read-only Supabase management requests explicitly target Virginia `qsllyeztdwjgirsysgai` using `/database/query/read-only`. Identity proof returned `supabase_read_only_user`, `transaction_read_only=on`. Existing 1Password token was injected into a protected process environment; no value was printed or saved. Aggregate/catalog queries only; no source rows, licensed filenames, authentication traffic or credentials are reproduced here.

## Refreshed database prerequisite

Migration `20261012005136` is **absent** from the production ledger. The live `public.search_style_guide_library_v2` definition has MD5 `e561c83438e3fb53261b9925f337c3a8`, `search_path=pg_catalog, auth`, and `work_mem=64MB`. No embedding/lease columns exist on `public.style_guide_search_documents` (catalog predicate `column_name like '%embed%' or column_name like '%lease%'`). GitHub reports [PR #4213](https://github.com/popcre/shared-db/pull/4213) exact head `c208d24c8592ba51a310bf6e10fb014c64498ba0`, merge `47e46b74260a33f6ef22d1e5c59a05d828fb3c1b`, merged October 11, 2026, 11:01 PM EDT. **Correction after deeper inspection:** ledger absence does not prove the function body is absent; see the independent source comparison below. Neither the merge nor the body comparison proves real search acceptance.

Claim #4212 remains protected. [Native recovery audit #4442](https://github.com/popcre/shared-db/issues/4442) records the original identity, exact source, remote custody, source preservation and current authority. It is a required custody-recovery artifact, not a replacement application/delivery issue. An audit or expired lease alone does not transfer ownership. The original chat was inspected read-only and its closing turn states execution stopped; that does not prove current remote process absence or original worktree cleanliness. Native accepted recovery and subsequent reissue are recorded below.

## Refreshed library and PDF aggregates

- Active files: **220,676**; non-null thumbnail URLs: **218,457**. The difference, **2,219**, is not yet independently classified in this session; do not label it accepted exceptions from arithmetic alone.
- Active filenames ending `.pdf`: **4,391**, partitioned by left join to `style_guide_pdf_text`: **4,077 extracted**, **312 skipped**, **2 missing**; no other status bucket returned. This does not prove content identity, quality or valid terminal classification. The older plan's 100 failed/33 missing snapshot is stale and must not authorize resets, rotations or duplicate paid runs.
- Seven ordinary 10:00 PM EDT crawls, October 11–17, report completed, guard `ok`, zero stale remainder. October 13 inactivated 109 rows; October 14's file count differs from October 13, and October 15's differs from October 14. These are candidates for changed-night acceptance, not a substitute for the required same-window/source/freshness evidence.
- Latest run `f0f661eb-40a6-412f-981b-b7f60f3cd444` started October 17, 2026, 10:00:08 PM EDT and completed October 17, 2026, 11:07:29 PM EDT after recorded refresh. It found/upserted 220,676 rows, deactivated/reactivated zero, with zero stale remainder.

## Limits and next gate

No schema, production setting, data, tagging operation or deployment changed during these reads. No signed-in relevance/permission/paging claim is made. The first PDF query used a nonexistent `extension` column, returned a read-only SQL error, and was corrected to a filename-suffix predicate; only the successful aggregate above is evidence. No capability was removed or timeout raised.

- [ ] Existing repair reaches production through its native protected route and passes live keyword/permission checks.
- [ ] Native original and successor custody receipts are verified and released/accepted before new semantic work.
- [ ] Canonical semantic contract is implemented, reviewed, rehearsed, merged, automatically promoted and independently live-proven.
- [ ] A different application worker completes all remaining #107 obligations, followed by deployment, saved-data/signed-in evidence, observation and rollback checks.

## Accepted native custody and newly discovered live behavior

October 18, 2026, approximately 1:14–1:20 PM EDT:

1. Initial native adoption was refused by a foreign reviewer-assignment mutex at `5ff471f2192fae901bd3726774661e5cc32e1fbb`, tied to #4395/#4396. It cleared normally; this session did not recover or delete it. The retry accepted actual database worker `01a14ffa-6ae0-75c1-b984-2135cc659938`. Root independently read receipt `refs/db-merged-claim-author-adoptions/4212-816032fc4950d26b1ebff45e` at `48713b946f79aa6b5efc4ed79ee67b51b66f74e2` and matched current claim identity/custody/version. Source and permanent version protection remained intact.
2. Independent production `md5(prosrc)` is `9d5dd045810fa3fce5cc3d508e1210ff`, exactly the function body in approved merged `20261012005136`. Old migration asserts preimage `3547b0f7d28d044ff6d6e031dcbeebbb`, so blindly replaying it is unsafe. Historical production apply provenance remains unverified; no manual ledger repair or invented historical receipt was performed. Canonical `.github/live-proofs/4210.sql` was independently executed through the explicit Virginia read-only endpoint and returned `passed=true`, including exact body, owner, stability, security-definer, configuration, authenticated/anon execute privileges and relation/column contracts.
3. Root repeated the retained signed-in request-correlated browser journey using the dedicated SG tester account and protected credential injection. Login, default Guides (60 rows), default Files (60 rows), Guides no-match (zero), and Files matching search (60 rows) succeeded. **Common matching Guides search failed HTTP 500 / SQLSTATE 57014.** There was one request error and one console error. The script then stopped on an uncompleted final empty-Files assertion; overall acceptance failed. No raw authenticated traffic or licensed results were retained in public evidence. This proves matching Guides remains broken even with the expected repair body; shape proof is insufficient.
4. Native merged-stranded reissue reserved **20261018171808**, preserving old reservation and recording supersession receipt `ba3bd2d9f87205def604e551c1591f10b211df20`. Claim #4212 stays with the actual worker on a fresh current-upstream branch. A proposed identical-definition provenance recovery was paused after the real Guides timeout was observed. It cannot be shipped as a complete repair. Current work is bounded read-only diagnosis before a coordinator-approved correction; no preview or production schema write occurred.

The updated issue comments on #107/#4210/#4437 explicitly correct the earlier ledger inference and retain all live gates. The application worker has not started. No DAM switch or protected tagging job changed.
