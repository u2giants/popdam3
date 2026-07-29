# PopDAM access provisioning — the three axes, and the trap

**Read this before granting, revoking, or debugging access to PopDAM
(`dam.designflow.app`).** Written 2026-07-26 after a reconciliation found that
**18 of 35 PopDAM users saw an empty Styles page** — not because of a bug, but
because they were provisioned on only one of the three axes below.

## The trap, in one sentence

**Giving someone `public.app_access('popdam')` lets them log in and see
nothing.** It is necessary but not sufficient. Without an **app-schema role**
they get an empty Styles page, an empty Library filter, and empty pickers, with
no error message anywhere.

## The three axes

Permissions live in **two schemas that have drifted apart**. All three axes are
independent; granting one does not imply the others.

| # | Where | Values | What it actually controls |
|---|---|---|---|
| 1 | `public.user_roles.role` (enum `public.app_role`) | `admin`, `user` | Privilege inside PopDAM's *own* `public.*` tables and its UI chrome. Note there is no "editor" tier — see AGENTS §0.4. |
| 2 | `public.app_access.app` (enum `public.app_name`) | `popdam`, `styleguides` | Which app you may enter at all. This is the login gate. |
| 3 | `app.profile` → `app.user_role` → `app.role` (enum `app.app_role`) | `administrator`, `sales`, `licensing`, `designer`, `viewer`, `vendor` | **Every `core.*`, `api.*` and `dam.*` object.** All 40 policies in those schemas are app-schema gated. |

Axis 3 is the one people forget. Example — the policy behind essentially all
shared reads:

```sql
-- core.customer.shared_read
app.has_any_role(ARRAY['administrator','sales','licensing','designer','viewer','vendor'])
```

`app.has_any_role` is `STABLE SECURITY DEFINER` and resolves the caller through
`app.profile.auth_user_id`. A user with **zero active `app.user_role` rows fails
every one of those policies**, so PostgREST returns `HTTP 200` with an empty
array. Success-shaped, data-free — which is exactly why this is hard to spot.

## Why the frontend can't paper over it

The PopDAM frontend reads `core.*` and `api.*` **directly from the browser with
the user's own JWT** — see the many `.schema("core")` / `.schema("api")` calls in
`src/pages/StylesPage.tsx`, plus `src/components/settings/PackagingTypesTab.tsx`
and `ApisTab.tsx`. There is no server-side service-role hop to mask a missing
role. The user's own RLS result is what reaches the screen.

## Provisioning checklist

To give a person working access to PopDAM, all three must be true:

1. `public.app_access` row with `app = 'popdam'`.
2. `public.user_roles` row (`user` unless they genuinely administer PopDAM).
3. `app.profile` with `status = 'active'` **and** an `app.user_role` row with
   `revoked_at is null`.

To verify a *specific* person rather than trusting counts, evaluate the real
predicate:

```sql
select app.has_any_role(
  array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]
)
from (select set_config('request.jwt.claims',
        json_build_object('sub','<auth user id>','role','authenticated')::text, true)) s;
```

`false` means an empty Styles page, regardless of what `public.*` says.

## Fleet health query

```sql
with anyrole as (
  select p.auth_user_id from app.user_role ur
  join app.profile p on p.id = ur.profile_id
  where ur.revoked_at is null and p.status='active' and p.auth_user_id is not null
)
select count(*) as popdam_users,
       count(*) filter (where aa.user_id in (select auth_user_id from anyrole)) as with_app_role,
       count(*) filter (where aa.user_id not in (select auth_user_id from anyrole)) as still_blind
from public.app_access aa where aa.app='popdam';
```

- **2026-07-26 before:** 35 / 17 / 18
- **2026-07-26 after:** 24 / 22 / 2

## What the 2026-07-26 reconciliation did

Migration `20260726210000_popdam_access_reconcile_legacy_gmail_and_designer_grants.sql`
(PR [#255](https://github.com/u2giants/shared-db/pull/255)):

- **Revoked 11 legacy personal-Gmail logins.** Deleted their `public.app_access`
  and `public.user_roles` rows only. Albert moved all staff to Microsoft SSO
  (`@popcre.com`, Azure provider), making these duplicates.
- **Granted `designer` to 5 `@popcre.com` staff** who had an active
  `app.profile` but no `app.user_role` — the empty-Styles population.

### Two decisions worth not re-litigating

- **Do NOT delete the `auth.users` rows for revoked accounts** (Albert, 2026-07-26).
  Deleting is irreversible and those ids are referenced by
  `public.asset_checkouts.user_id`, `public.invitations.invited_by`, and
  `created_by`-style columns. Revoke access; leave identity and history intact.
- **Match on the auth user id, never the email string**, so a later email change
  cannot retarget a revocation statement.

`u2giants@gmail.com` is Albert's own account, holds `public.user_roles.role =
'admin'`, and is the one Gmail address that keeps access. Any bulk statement
touching `%@gmail.com` must exclude it — the migration above carries an explicit
`raise exception` guard for this.

## Still open (as of 2026-07-27)

- **`u2giants@gmail.com` has no app-schema role**, so its Styles page is empty.
  Albert's SSO account `albert@popcre.com` already holds `administrator` and
  works. Undecided: give the Gmail admin a role, or retire it in favour of SSO.
- **`derricksmith21@comcast.net`** (Derrick Smith; SSO counterpart
  `dsmith@popcre.com`) looks like a twelfth legacy login. It was deliberately
  left alone because it is not a Gmail address and was outside the approved
  batch. Flagged, not actioned.
- **13 `@popcre.com` accounts hold `viewer`** (aagudelo, adweck, apinilla, dsmith,
  eperestrelo, jchaffier, jcortazar, mcameron, mcardoso, mzabo, nschuchman,
  vbarot, vdionisio). They can read everything via `shared_read`. Whether to
  upgrade them to `designer` is an open decision — **ask, do not assume**.

## The three user tables now have real foreign keys (2026-07-28)

Until 2026-07-28, `public.profiles`, `public.user_roles` and `public.app_access`
had **no foreign key constraints at all** — not to each other, not to
`auth.users`. They merely shared a `user_id` column. Consequences:

- PostgREST could not resolve the embed the admin user-management screen uses
  (`profiles?select=...,user_roles(role),app_access(app)`), so `admin-api`
  action `list-users` returned HTTP 500 *"Could not find a relationship between
  'profiles' and 'user_roles' in the schema cache"* (PGRST200). The Settings →
  user management screen could not load at all.
- Deleting an auth user left orphaned profile/role/app-access rows behind.

Migration `20260728160000_popdam_user_tables_foreign_keys.sql` adds:

| Table | Constraint | References |
|---|---|---|
| `public.profiles` | `profiles_user_id_fkey` | `auth.users(id)` `on delete cascade` |
| `public.user_roles` | `user_roles_user_id_fkey` | `public.profiles(user_id)` `on delete cascade` |
| `public.app_access` | `app_access_user_id_fkey` | `public.profiles(user_id)` `on delete cascade` |

**`user_roles`/`app_access` point at `public.profiles`, not at `auth.users`, on
purpose.** PostgREST resolves an embed only along a foreign key *between the two
tables being embedded*. Pointing them at `auth.users` would restore integrity
but leave the admin screen broken. Do not "correct" this later.

What makes it safe, and what would break it:

- `public.handle_new_user` (trigger `on_auth_user_created_popdam`, **AFTER**
  INSERT on `auth.users`) inserts `profiles` FIRST, then `user_roles`, then
  `app_access`, in **both** branches (SSO and invitation). It is the only
  database function that writes `public.user_roles`. **If any future writer
  inserts a role or app access before the profile row, signup starts failing.**
- POP CRM (`popcrm-web`) and PM/PIM (`poppim-web`) contain **zero** references
  to these three tables — they are PopDAM-only. Re-check that before assuming a
  new consumer is safe.
- Preview rehearsal (2026-07-28) proved all three: the PostgREST embed returns
  HTTP 200, an Azure-provider signup still creates all three rows, and deleting
  the `auth.users` row cascades all three away.
- Preview needed two throwaway PopSG test profiles deleted first (their
  `auth.users` rows were already gone). Production had **zero** orphans in all
  three tables, so no backfill was required there.

## Related

- AGENTS §0.4 — `public.style_tracker_rows` open writes are **intentional**; a
  read-only DAM tester must be expressed with app-schema roles, never by
  narrowing that policy.
- AGENTS §8.1 — `dam` is **not** exposed through PostgREST; `core`, `api`,
  `public` are. That is why axis 3 matters for `core.*`/`api.*` but `dam.*` is
  reached through `public` SECURITY DEFINER functions instead.
