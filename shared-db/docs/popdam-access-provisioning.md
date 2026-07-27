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

## Related

- AGENTS §0.4 — `public.style_tracker_rows` open writes are **intentional**; a
  read-only DAM tester must be expressed with app-schema roles, never by
  narrowing that policy.
- AGENTS §8.1 — `dam` is **not** exposed through PostgREST; `core`, `api`,
  `public` are. That is why axis 3 matters for `core.*`/`api.*` but `dam.*` is
  reached through `public` SECURITY DEFINER functions instead.
