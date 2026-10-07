# Task for a shared-db session: revoke 11 legacy Gmail logins, grant `designer` to 5 @popcre.com staff

You are working in the canonical shared-DB repo `u2giants/shared-db`
(local checkout `/worksp/shared-db`). Follow `shared-db/AGENTS.md`: dedicated
branch, a new timestamped migration under `supabase/migrations/`, preview-first
verification, then open and merge the PR. **Do not** make these changes from an
app repo, from the Supabase Dashboard, or with a one-off `execute_sql`.

Target project: `qsllyeztdwjgirsysgai` (PopDAM/PopSG, Virginia). This is a
**data** migration — no DDL, no schema change, no RLS change.

---

## Background — why this is being asked for

PopDAM's permissions run on **three axes across two schemas**, and the two
schemas have drifted apart:

1. `public.user_roles.role` (enum `public.app_role` = `admin | user`) — privilege
   inside PopDAM's own tables and UI.
2. `public.app_access.app` (enum `public.app_name` = `popdam | styleguides`) —
   which app you may enter.
3. **The `app` schema** — `app.profile` → `app.user_role` → `app.role`
   (enum `app.app_role` = `administrator, sales, licensing, designer, viewer,
   vendor`). **This is what gates every `core.*`, `api.*` and `dam.*` object** —
   all 40 policies in those schemas are app-schema gated. Example:
   `core.customer.shared_read` is
   `app.has_any_role(ARRAY['administrator','sales','licensing','designer','viewer','vendor'])`.

The PopDAM frontend reads `core.*` / `api.*` **directly from the browser with the
user's own JWT** (`src/pages/StylesPage.tsx` has many `.schema("core")` /
`.schema("api")` calls; also `src/components/settings/PackagingTypesTab.tsx` and
`ApisTab.tsx`). So a user provisioned only in `public` gets an empty Styles page.

Measured 2026-07-26: of 35 users with `public.app_access('popdam')`, only 17 had
an active `app.user_role`. **18 saw empty `core.*` data.**

Albert has since moved all employees to Microsoft SSO (`@popcre.com`, Azure
provider). The old personal Gmail logins are legacy duplicates that should no
longer reach the app, and the staff accounts that never received an app-schema
role need one.

---

## What to change

### Part A — revoke PopDAM access for 11 legacy Gmail accounts

**Revoke access only. Do NOT delete the `auth.users` rows** — this is Albert's
explicit decision (2026-07-26). Deleting the auth user is irreversible and these
ids are referenced elsewhere (e.g. `asset_checkouts.user_id`,
`invitations.invited_by`, `created_by`-style columns).

For each of the 11 below: delete their `public.app_access` rows and their
`public.user_roles` rows. Leave `public.profiles` and `auth.users` intact.

| email | auth user id |
|---|---|
| adamsdweck@gmail.com | `89f0cd2a-d7ae-4140-98f9-b9be7c15052f` |
| deborah.asalles@gmail.com | `7f7699e8-cbb8-43b7-bdfe-38d7c3796960` |
| devopswithkube@gmail.com | `a3f77e70-188f-4d39-8a83-61d9de4a71ff` |
| ilonakereki93@gmail.com | `7402d4b2-ec59-474e-9f02-5a0c54ad124c` |
| jenniferchaffier@gmail.com | `74b9c565-9475-4c2e-ac0c-a0cd81df39d4` |
| jessi20036@gmail.com | `2733172b-5b3d-4a19-8fd4-a01427d66408` |
| jmilenacortazar@gmail.com | `0b2422fd-fe0e-4dec-b794-c703f7dcb324` |
| lizsmith1007@gmail.com | `385fda19-1a76-4dfa-96e0-8f64f1d54bd8` |
| malachicameron@gmail.com | `5523b46b-dcad-4343-bedb-4e472501817e` |
| marcelzabo@gmail.com | `a8361851-12b6-432b-966d-bb0e05b616b5` |
| musubishan@gmail.com | `6a562f74-d072-4c96-b444-9fa8903b55cc` |

All 11 currently hold `public.app_access('popdam')` and `public.user_roles` role
`user`. None holds `admin`.

**`u2giants@gmail.com` is explicitly EXCLUDED — do not touch it.** It is
Albert's own account and holds `public.user_roles.role = 'admin'`. It is the only
Gmail address that keeps access.

Match on the **auth user id**, not the email string, so a later email change
can't retarget the statement.

Six of the eleven have a confirmed SSO counterpart by full name
(adamsdweck→adweck, lizsmith1007→eparkin, jenniferchaffier→jchaffier,
malachicameron→mcameron, marcelzabo→mzabo, jmilenacortazar→jcortazar). The other
five (deborah.asalles, devopswithkube/"Umamaheswararao Meka", ilonakereki93,
jessi20036/"Jessica Pinilla", musubishan/"Luz Silva") have **no name match** in
`@popcre.com`. Albert reviewed this and chose to revoke all of them anyway
(2026-07-26). Do not silently skip them — but if the migration reveals any of
them holds something the others don't (an `admin` role, an active checkout, a
`styleguides` grant), stop and report before proceeding.

### Part B — grant the `designer` app role to 5 @popcre.com accounts

These five already have an **active** `app.profile` but **zero** `app.user_role`
rows, which is why they see nothing in `core.*`:

| email | `app.profile.id` |
|---|---|
| ai-tester@popcre.com | `36750823-430b-4fa7-88ac-771993381196` |
| ccorral@popcre.com | `a88e8c06-4787-47d9-a37a-2c3929f4c15a` |
| eparkin@popcre.com | `6e9a19b4-e070-460d-9178-b4dfc5cac5a9` |
| jsafdieh@popcre.com | `5240da36-549f-4511-8fd3-b433530c35af` |
| larevalo@popcre.com | `8f383a14-f303-4890-90a2-80306a2d4665` |

Insert one `app.user_role` row each with the **`designer`** role:
`app.role.id = d6a73086-8f57-48a1-99ee-4f6b22ea1744` (slug `designer`,
name "Designer"). Albert chose `designer` over `viewer` on 2026-07-26.

Set `granted_at` to now and leave `revoked_at` null. Set `granted_by_profile_id`
to Albert's profile (resolve from `app.profile` where `auth_user_id` is the owner
of `albert@popcre.com`) if the column is not nullable; otherwise leave it null.

Make the insert **idempotent** — `on conflict do nothing`, or guard with
`where not exists (... revoked_at is null)` — so a re-run doesn't create
duplicate active grants.

### Explicitly NOT in scope

- **Do not change the 13 `@popcre.com` accounts that already hold `viewer`**
  (aagudelo, adweck, apinilla, dsmith, eperestrelo, jchaffier, jcortazar,
  mcameron, mcardoso, mzabo, nschuchman, vbarot, vdionisio). They already have
  read access to everything via `shared_read`. Whether to upgrade them from
  `viewer` to `designer` is a separate decision Albert has not made — ask, don't
  assume.
- **Do not touch `albert@popcre.com`** (already `administrator`) or the three
  `@designflow.app` test accounts (`ai-admin`, `ai-designer`, `ai-viewer`).
- **Do not delete any `auth.users` row.**
- **Do not change any RLS policy, enum, table, or function.** See the open item
  below — it is NOT part of this task.
- `derricksmith21@comcast.net` (Derrick Smith, counterpart `dsmith@popcre.com`)
  is **not** a Gmail address and is **not** in this task. Flag it to Albert as a
  likely twelfth legacy login, but leave it alone.

---

## Verification (run before AND after; put the results in the PR)

```sql
-- 1. The 11 revoked accounts must have no access rows left, but must still exist.
select p.email,
       (select count(*) from public.app_access a where a.user_id = p.user_id) as app_access_rows,
       (select count(*) from public.user_roles r where r.user_id = p.user_id) as role_rows,
       (select count(*) from auth.users u where u.id = p.user_id)             as auth_user_still_exists
from public.profiles p
where p.email like '%@gmail.com' and p.email <> 'u2giants@gmail.com'
order by p.email;
-- expect: app_access_rows = 0, role_rows = 0, auth_user_still_exists = 1 for all 11

-- 2. u2giants@gmail.com must be UNTOUCHED (still admin, still has popdam).
select (select count(*) from public.user_roles r
        join public.profiles p on p.user_id = r.user_id
        where p.email='u2giants@gmail.com' and r.role='admin') as still_admin,
       (select count(*) from public.app_access a
        join public.profiles p on p.user_id = a.user_id
        where p.email='u2giants@gmail.com' and a.app='popdam') as still_has_popdam;
-- expect: 1, 1

-- 3. Every remaining popdam user must now have an active app-schema role.
with anyrole as (
  select p.auth_user_id from app.user_role ur
  join app.profile p on p.id = ur.profile_id
  where ur.revoked_at is null and p.status='active' and p.auth_user_id is not null
)
select count(*) as popdam_users,
       count(*) filter (where aa.user_id in (select auth_user_id from anyrole)) as with_app_role,
       count(*) filter (where aa.user_id not in (select auth_user_id from anyrole)) as still_blind
from public.app_access aa where aa.app='popdam';
-- BEFORE: 35 / 17 / 18
-- AFTER : 24 / 23 / 1   (the 1 is u2giants@gmail.com — see the note below)

-- 4. No duplicate active designer grants were created.
select ur.profile_id, count(*) from app.user_role ur
where ur.revoked_at is null and ur.role_id='d6a73086-8f57-48a1-99ee-4f6b22ea1744'
group by 1 having count(*) > 1;
-- expect: zero rows
```

**Then verify in the live app, not just in SQL:** sign in as one of the five
(e.g. `larevalo@popcre.com`, or `ai-tester@popcre.com` whose credentials are in
1Password vault `vibe_coding`) and confirm the **Styles page now shows data**
where it was previously empty. A green SQL result is not proof the user's
experience changed.

---

## Two things to report back to Albert (do not act on them here)

1. **`u2giants@gmail.com` will be the last remaining PopDAM user with no
   app-schema role**, so his Styles page stays empty. His SSO account
   `albert@popcre.com` already holds `administrator` and works fine. Ask whether
   the Gmail admin account should get a role too, or whether he simply uses the
   SSO account from now on.
2. **Open security gap, verified 2026-07-26 and still unfixed:**
   `public.style_tracker_rows` has `SELECT using(true)`, `INSERT with check(true)`
   and `UPDATE using(true) with check(true)` — **any authenticated user can edit
   Master Data rows.** Only DELETE checks `has_role(auth.uid(),'admin')`. By
   contrast `assets` and `style_groups` correctly require admin. This is a real
   RLS change and belongs in its own reviewed shared-db migration — mention it,
   do not fold it into this one.

---

## Access notes

- The `app` schema is **not exposed through PostgREST** (only `public` and
  `api`), so ad-hoc reads go through the Management API:
  `POST https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/database/query`
  with the PAT in 1Password vault `vibe_coding`, item
  **"Supabase CLI Personal Access Token"**, field `SUPABASE_ACCESS_TOKEN`.
  Use `op run --env-file=...` so the token is never printed.
- Trap: the 1Password item "Supabase Runtime Keys - shared POP database
  (production)" holds the **legacy** `service_role` JWT, while deployed edge
  functions use the new `sb_secret_…` key. The legacy JWT still works against
  PostgREST, so it looks fine — but it will 401 against edge functions. Not
  needed for this task; noted so it doesn't send you debugging a non-problem.
- All figures in this brief were measured live on 2026-07-26. Re-run query 3
  before starting; if the BEFORE numbers don't match, the data moved and you
  should re-derive the user lists rather than trusting the ids above.
