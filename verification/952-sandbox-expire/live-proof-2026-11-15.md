# Issue #952 sandbox no-login removal — execution and live proof (2026-11-15)

summary: Ran expire-sandbox-login.sh on hetz; sandbox now requires login and serves the preview DB
kind: verification-record
status: current
read-when: reviewing #952 removal or restoring sandbox auto-login

## Owner authority

2026-11-15 owner chat (quoted from coordinator session): "spin up subagents to
unblock everything and clear everything" — treated as the go-ahead to execute
the removal now (issue #952, owner had reserved timing on 2026-11-11).

## What ran

`~/.local/share/popdam-sandbox/expire-sandbox-login.sh` on hetz (user `ai`),
read in full before execution. It:

1. Deletes the preview test user `sandbox-tester@designflow.app` from the
   preview database (pooler `aws-0-us-east-1.pooler.supabase.com:6543`, db
   `postgres.mvpkijzfmfcxhnzqogzs`): rows in `public.user_roles`,
   `auth.users`, `public.invitations` (1 row each, script log shows DELETE 1 ×3).
   DB password sourced from 1Password `vibe_coding` item `qbvfk7umc3n75ejekd65zwd4ty`
   (field `DB_PASSWORD`; value never printed).
2. Deletes GitHub repo variables `SANDBOX_AUTO_LOGIN_EMAIL` and
   `SANDBOX_AUTO_LOGIN_PASSWORD` (u2giants/popdam3).
3. Rebuilds the sandbox: `gh workflow run publish-sandbox.yml` (run
   43775961898, completed success).
4. Comments on and closes #952.

Script log: `~/.local/share/popdam-sandbox/expire.log` on hetz.

## Verification (after rebuild)

- **Login gate up:** https://dam-sandbox.designflow.app shows the login screen
  ("Sign in to access your assets", email/password + Microsoft) — headless
  Chromium snapshot, no session. Deployed bundle contains no
  `sandbox-tester@designflow.app` literal (Vite env values are baked at build;
  absent ⇒ built after variable deletion). `version.json`:
  `git_sha 470e711afbc02d8c884fc3c919a2f09848856247`.
- **Preview database:** deployed bundle references preview project
  `mvpkijzfmfcxhnzqogzs`; authenticated session issued 17 REST/RPC requests to
  it (user_roles, admin_config, assets, get_filter_counts, get_path_facets).
- **App works behind login:** established admin-tester path — 1Password
  `vibe_coding` item `7s5uzpbjenka4fpvrqogh44bre`
  ("DAM AI tester login - PopDAM (administrator, dam.designflow.app,
  production)", user `ai-admin@designflow.app`) via Supabase password-grant
  against the preview project, session injected into
  `localStorage['sb-popdam-auth-token']`. Library loaded: 10,628 style groups,
  126,790 files. No writes.

## Recovery note (restore no-login access if ever needed)

Re-create preview user `sandbox-tester@designflow.app` in the preview project
(`auth.users` + `public.user_roles` + `public.invitations`, with the `dam`
app_access row — see docs/deployment.md → Sandbox site), re-add repo variables
`SANDBOX_AUTO_LOGIN_EMAIL` / `SANDBOX_AUTO_LOGIN_PASSWORD`, re-run
`publish-sandbox.yml`. That account's credentials remain in 1Password
`vibe_coding` item "PopDAM sandbox auto-login (dam-sandbox.designflow.app,
preview DB only, expires 2026-11-12)".

Posted by MiMo chat unknown on desktop
