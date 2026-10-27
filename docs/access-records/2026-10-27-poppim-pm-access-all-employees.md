# 2026-10-27 — grant PopPIM (`pm`) app access to all Microsoft-SSO @popcre.com employees

Issue: https://github.com/u2giants/popdam3/issues/545

## Owner instruction (Albert Hazan, verbatim from his chat, 2026-10-27)

"all users that login using microsoft SSO and have an @popcre.com email address should have access to popdam and poppim"

PopPIM gates reads on `app.has_app_access('pm') or administrator` and its
picker views on `has_explicit_app_access('pm')`. The 2026-10-07 fleet grant
(#185) covered PopDAM (`dam`) only; no employee held PopPIM access.

## What was granted

`app.app_access(app='pm', granted_by_profile_id=0301af81-…[albert@popcre.com])`
for exactly these 24 active @popcre.com employees with azure Microsoft-SSO
identities, at run timestamp **2026-10-27 19:07:46.522729+00 (3:07:46 PM EDT)**:

aagudelo, adweck, albert, amanoel, apinilla, asilva, ccorral, dsmith,
eparkin, eperestrelo, ftello, ikereki, jchaffier, jmelho, jsafdieh, larevalo,
mcameron, mzabo, nschuchman, umeka, vavouac, vdionisio, yzhou, zcalderon
(all @popcre.com) — verified by the post-write audit listing (24 rows,
`granted_at` = run date, output quoted in issue #545).

- jcortazar@popcre.com already held `pm` (untouched).
- mcardoso@ and vbarot@ are the only @popcre.com logins WITHOUT azure SSO
  identities (password-only); deferred pending owner confirmation on #545.
- Originally five were deferred on stale app-metadata; the first execution
  attempt failed closed and showed 3 of them (aagudelo, eperestrelo,
  vdionisio) hold live azure identities — reclassified into the grant per
  the owner rule. `auth.identities` is the authoritative SSO signal.
- Service accounts excluded: DAM AI tester (per the 2026-10-07 record's own
  exclusion list); poppim-production-ai-test (own-lane `pm` row, verified
  untouched).

## Execution evidence

- 16 plan revisions; independent AI reviewer (muse, implementer glm) APPROVE
  by final-check, report
  `shared-db-wt-pm-access/.ai/reviews/muse-final-check-20261027T185935-2390796-21543.md`
  (sha256 43eb99ebb746b42a693d3dbd12ea7eb262f31714255afa41f036ef8eba21e763);
  gate: `ai-task-gates check --before database` → allowed.
- Executed script sha256
  `65f78a14bd909fd487ce3263fecfd010edb955177692c2199808c42c41202e0e`;
  DSN identity `postgres.qsllyeztdwjgirsysgai` (pooler 6543); pooler
  preflight `postgres|postgres|t`.
- Dockerized postgres rehearsal before execution: success path (24 rows,
  exact attribution) plus 7 fail-closed paths (re-run, population drift,
  deferred-azure, missing dam, email mismatch, revoked-pm, invariance).
- In-transaction guards all passed on live data (population exactly 27 =
  24 + 2 deferred + jcortazar; every grantee azure-by-identity and holding
  active `dam`; exact non-pm invariance; service rows untouched).
- Post-write verification (2026-10-27): under eparkin's claims
  `has_explicit_app_access('pm')`=t, `dam`=t, core.customer=826 rows,
  pm picker=139 rows; under a role-less grantee `pm`=t and picker works
  (direct core reads = 0 — see delivery note); deferred vbarot `pm`=f;
  exact-set check = 24; audit listing matches this record.

## Honest delivery note

The 8 role-less grantees (amanoel, asilva, ftello, jmelho, umeka, vavouac,
yzhou, zcalderon) get PopPIM's picker views but not direct `core.*` reads or
PopPIM writes until the role-tier decision on #545 lands (role tiers are the
documented ask-first decision; Albert chose `designer` in the equivalent
2026-07-26 case).

## Rollback (soft revocation; count-asserted)

```sql
begin;
do $$ declare n int; begin
  update app.app_access set revoked_at = now()
   where app='pm' and granted_by_profile_id='0301af81-7aa9-4655-8746-61bccd93a78e'
     and granted_at='2026-10-27 19:07:46.522729+00'::timestamptz and revoked_at is null;
  get diagnostics n = row_count;
  if n <> 24 then raise exception 'rollback revoked % rows, expected 24', n; end if;
end $$;
commit;
```

## Diagnosis that triggered this (PopDAM search outage)

Elizabeth Parkin's @popcre.com account was fully provisioned and returns live
search + facets under her claims; her browser was signed into her pre-SSO
personal Google login (revoked of all access 2026-07-26 but sessions live
through 2026-10-27), whose identity fails exactly the dam-gated RPCs —
"can't search, empty filter dropdowns". Interim fix with no database write:
sign out of the personal login, sign in with @popcre.com Microsoft SSO.
The forced sign-out (and a second revoked login active the same day) awaits
explicit owner authorization on #545.
