# DB Data Admin deployment

DB Data Admin follows the repository's standard release path:

1. GitHub Actions verifies the application.
2. GitHub Actions publishes `ghcr.io/u2giants/db-data-admin:sha-<commit>`.
3. The same workflow points Coolify at that immutable image and triggers deployment.
4. Coolify owns the domain, runtime environment, health check, restart behavior, and
   deployment history on the Hetzner VPS.

## Development runtime

- Coolify project: `DB Data Admin` (`x433rsji7hlmgpysautjpa1e`)
- Environment: `development` (`j126yiy9f14ikr3jxaor70jx`)
- Application: `db-data-admin-development` (`v6z1sveur7e32dub1dp3ao4v`)
- Domain: `https://data-dev.designflow.app`
- Health endpoint: `/health` on container port `80`
- Image: `ghcr.io/u2giants/db-data-admin:sha-<commit>`

Coolify stores `DB_DATA_ADMIN_SUPABASE_URL`, `DB_DATA_ADMIN_SUPABASE_ANON_KEY`, and
`DB_DATA_ADMIN_AUTH_REDIRECT_URL`. The container exposes those values to the static app at
startup through a non-cached `/config.js`; they are not baked into the image.

## Production runtime

- Coolify project: `DB Data Admin` (`x433rsji7hlmgpysautjpa1e`)
- Environment: `production` (`ly7550eqjkwyto8ehzo08hkh`)
- Application: `db-data-admin-production` (`zeoy8qfjqffu8ym533cc7dl4`)
- Domain: `https://data.designflow.app`
- Health endpoint: `/health` on container port `80`
- Image at launch: `ghcr.io/u2giants/db-data-admin:sha-991ecbea7b1ef8a8590e77d1746773ee25690d84`
- Database: production Supabase `qsllyeztdwjgirsysgai`

Coolify owns the same four runtime values it owns in development —
`DB_DATA_ADMIN_SUPABASE_URL`, `DB_DATA_ADMIN_SUPABASE_ANON_KEY`,
`DB_DATA_ADMIN_AUTH_REDIRECT_URL` — and one it must NOT own:
`DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN` is left **unset** in production. `envsubst`
renders an unset variable as the empty string, which `readConfig()` treats as
disabled, so production stays Microsoft SSO-only. Setting it to `true` would put an
email + password form on a public admin tool; never set it here.

### Production is live

`db-data-admin-production` (`zeoy8qfjqffu8ym533cc7dl4`) was launched on 2026-08-12.
The launch workflow run
[#31622123286](https://github.com/u2giants/shared-db/actions/runs/31622123286)
completed successfully. `https://data.designflow.app/health` returned HTTP 200 and
the live page reported build SHA
`991ecbea7b1ef8a8590e77d1746773ee25690d84`.

Two things to know if you touch it:

- **Coolify assigns a public `sslip.io` hostname on creation whether you ask for one or
  not.** The create call returned
  `http://<uuid>.178.156.180.212.sslip.io`. It was removed immediately by PATCHing
  `domains` to an empty string, and the hostname now returns `404` because Traefik has no
  route for it. Anyone re-creating this application must check the fqdn afterwards rather
  than assuming an unset domain stayed unset.
- **`POST /envs` returned HTTP 422 and created the record anyway** when the body carried
  extra fields. That produced duplicate variables that had to be cleaned up. Send only
  `key` and `value`, and always re-read `/envs` afterwards instead of trusting the status
  code.

The production application intentionally has only three variables:
`DB_DATA_ADMIN_SUPABASE_URL`, `DB_DATA_ADMIN_SUPABASE_ANON_KEY`,
`DB_DATA_ADMIN_AUTH_REDIRECT_URL`. `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN` is absent, which
is what keeps production SSO-only.

### DNS is already in place

`data.designflow.app` resolves to the Coolify VPS `178.156.180.212`, the same A record as
`data-dev`. The production application now owns that route and its TLS certificate.
There is no wildcard record on `designflow.app`.

### Production launch trigger (dispatch only)

`deploy-production` in `.github/workflows/db-data-admin.yml` is **dispatch-only**. It
never runs on an ordinary push to `main`, so merging the workflow (or any code) can
never by itself publish the admin tool. A launch is a deliberate
`workflow_dispatch` from `main` with two typed inputs:

- `project_ref` — must be exactly `qsllyeztdwjgirsysgai`;
- `confirmation` — must be exactly `launch-data-designflow-app`.

After `verify` and `container` build and publish the `sha-<commit>` image on the same
dispatch SHA, the job checks out that SHA, fetches `origin/main`, and **fails unless
the checked-out SHA equals the current tip of `origin/main`** before any exposure — a
commit that is not the tip of `main` cannot be launched.

It then runs a **read-only** Supabase evidence query (Management API
`/v1/projects/qsllyeztdwjgirsysgai/database/query` with `read_only:true`, using
`SUPABASE_ACCESS_TOKEN`) and fails closed unless ALL of the following hold:

- migration-ledger membership for batch **B8** (`20260809170000`–`20260809170500`)
  and batch **B9** (`20260810010000`–`20260810170000`; the exact version set is
  enumerated in the workflow and in `scripts/check-data-admin-launch-readiness.mjs`);
- `core.product_size` and `core.product_depth` exist;
- the Product Depth picker/mutation functions exist —
  `api.db_data_admin_product_depth_list`, `api.db_data_admin_upsert_product_depth`,
  `api.db_data_admin_set_product_depth_status`, and the
  `app.require_db_data_admin_product_depth_access` guard;
- at least one active `app.app_access` row for app `admin` (someone can administer it).

The evidence query returns counts and object names only — never row identities or
values. The gate (`scripts/check-data-admin-launch-readiness.mjs`, with offline tests
under `scripts/tests/`) also requires the Coolify application uuid to be exactly
`zeoy8qfjqffu8ym533cc7dl4`, and records the prior `sha-<commit>` image tag for
rollback.

Only then does it PATCH the application to attach **exactly**
`https://data.designflow.app` and set the exact `sha-<commit>` image. It re-reads the
application and **rejects** any extra or `sslip.io` domain (Coolify auto-assigns an
`sslip.io` host on creation; the launch refuses to deploy if one is present), deploys
through Coolify, then polls `https://data.designflow.app/health` for `200` and the
live `<meta name="build-sha">` until both equal the deployed commit. It fails — and
tells you to roll back — rather than reporting a green deploy it did not observe.

The GitHub `production` environment is retained for audit and deployment history, but
launch safety does **not** depend on a manual reviewer: the typed confirmation plus
the read-only evidence gate are the control.


### Rollback

Set the production application's `docker_registry_image_tag` back to the previous
`sha-<commit>` in Coolify and redeploy. Every published image is immutable, so the
previous tag is an exact rebuild-free restore. Never run containers directly on the VPS
and never edit the VPS to roll back.

## Microsoft SSO

Production Microsoft login and password login were both owner-verified on 2026-08-12
after B9 restored the missing DesignFlow user columns. Issue
[#841](https://github.com/u2giants/shared-db/issues/841) is closed. DB Data Admin
production remains Microsoft SSO-only because its password-login setting is absent;
the password check applied to the DesignFlow login incident, not this admin screen.

The Azure app registration `POP CRM — Supabase Auth` uses the Supabase callback,
not the application domain, as its OAuth redirect URI. Both callbacks are registered:

- Preview: `https://rjyboqwcdzcocqgmsyel.supabase.co/auth/v1/callback`
- Production: `https://qsllyeztdwjgirsysgai.supabase.co/auth/v1/callback`

Preview Supabase then redirects the completed login to `https://data-dev.designflow.app`.
Its Auth `site_url` is that origin, and the allowlist contains the bare origin,
trailing-slash origin, and `/**` wildcard. Preview uses an Azure credential named
`supabase-preview-data-admin`, created 2026-07-22 and expiring 2027-07-22. Its value
exists only in Azure and preview Supabase Auth configuration; production uses its
existing credential and was not changed.

The frontend renders OAuth callback failures visibly. Its header displays the short
commit plus UTC build date while retaining the full immutable commit in the element
title and HTML build metadata for deployment verification.

GitHub stores only the Coolify API token needed to orchestrate releases. The application UUID
and Coolify base URL are non-secret repository variables.

## Verification and rollback

After deployment, verify `/health`, TLS, Microsoft sign-in routing, and the
`<meta name="build-sha">` value in live HTML. Roll back by selecting the prior successful
`sha-<commit>` image in Coolify and redeploying it; do not run containers directly on the VPS.
