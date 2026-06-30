# CRM live test login — 2026-06-30

## Codex browser verification account

What changed:
A dedicated Supabase Auth user was created/rotated for Codex browser checks of
the live CRM frontend. Its credentials are stored only in 1Password as
`POP CRM live test login - Codex` in the `vibe_coding` vault.

Backend records:

- Supabase project: `qsllyeztdwjgirsysgai`
- Auth email: `codex.crm.verify@designflow.app`
- Auth user id: `09f90b17-0544-495b-9ed4-07bb208782ec`
- `app.profile.id`: `c1dd20ba-2bc1-462c-9738-26ac7fd4841f`
- `app.app_access`: active `crm` access (`revoked_at is null`)

Why:
The Data Admin table overflow fix needed verification against
`https://crm.designflow.app` with real CRM data and the deployed build stamp.
Unauthenticated local Playwright checks only reached the login page and could not
verify the table layout.

Verification:

- Logged into `https://crm.designflow.app/data-admin` with the 1Password test
  login.
- Confirmed the deployed app was still `#61615cd`.
- Measured live `DataTable` state before the frontend fix was deployed:
  table class `w-max border-collapse`; table wrapper `clientWidth 704`,
  `scrollWidth 1234`, overflow delta `530`.
- Ran local `popcrm-web` against the same production Supabase project and logged
  in with the same account.
- Measured fixed local source: table class `min-w-full border-collapse`; table
  wrapper `clientWidth 1304`, `scrollWidth 1304`, overflow delta `0`.

Future sessions should:
Use this login for browser smoke tests that require real CRM data. Do not put the
password in docs, shell history, commits, screenshots, or logs; retrieve it from
1Password when needed. If access stops working, verify the Auth user,
`app.profile.auth_user_id`, and `app.app_access` row before debugging frontend
filters.
