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

## Microsoft SSO

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
