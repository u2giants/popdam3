# 2026-11-04 — PopPIM (`pm`) for three SSO hires; signup hook; repeat sign-out

Issue: https://github.com/u2giants/popdam3/issues/545

Owner rule (Albert Hazan, verbatim, 2026-10-27): "all users that login using microsoft SSO and have an @popcre.com email address should have access to popdam and poppim"

## Done

- `pm` granted, 2026-11-04 about 4:47 PM EST, to mwilliams, dmoreno and lherrera (@popcre.com). All three hold azure identities. `granted_by_profile_id` is 0301af81-… (albert@popcre.com). Result: 28 of 28 SSO employees hold `dam` and `pm`.
- Revoked login 7f7699e8-… had signed back in on 2026-10-30. Its one session was deleted under the 2026-10-27 sign-out decision. Result: 0 sessions, 0 live tokens, login row kept, no ban.
- Signup hook: `app.handle_new_auth_user()` grants `pm` when the address is @popcre.com and the provider is azure (popcre/shared-db#5587).

## Hook and the DesignFlow sole-writer contract

No conflict. The Oct 28 contract makes DesignFlow the sole writer of later role and access changes. The hook sets only the first-login default, as it already does for `crm` and `dam`, and `on conflict do nothing` keeps a revocation in place. Phase 5 of the cutover must keep these defaults, or move them into DesignFlow, when it retires duplicate write paths.

Known limit: the hook reads the provider at account creation. A password account that later links Microsoft does not get `pm` automatically; it is granted in Settings.

## Rollback

```sql
update app.app_access set revoked_at = now()
 where app = 'pm' and revoked_at is null
   and profile_id in (select id from app.profile where lower(email::text) in
     ('mwilliams@popcre.com', 'dmoreno@popcre.com', 'lherrera@popcre.com'));
```
