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

GitHub stores only the Coolify API token needed to orchestrate releases. The application UUID
and Coolify base URL are non-secret repository variables.

## Verification and rollback

After deployment, verify `/health`, TLS, Microsoft sign-in routing, and the
`<meta name="build-sha">` value in live HTML. Roll back by selecting the prior successful
`sha-<commit>` image in Coolify and redeploying it; do not run containers directly on the VPS.
