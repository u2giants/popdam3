# AI Operating Rules

## Purpose

These rules exist so AI tools can safely assist with this repo without creating production drift.

## System of truth

- GitHub is the source of truth for code, Docker Compose, Dockerfiles, and workflows.
- Coolify is the source of truth for production runtime environment variables and deployment target settings.
- The production server is only a runtime host, not a configuration source.

## Branch policy

- This repo uses one branch only: `main`
- Do not propose or create feature branches
- Do not suggest branch-based workflows
- Do not assume there is a staging branch
- All approved changes should target `main`

## Approved deployment path

The only normal deployment path is:

1. change files in this repo
2. commit to `main`
3. GitHub Actions builds the Docker image and pushes to GHCR
4. GitHub Actions SSHes to the VPS and runs `docker pull` + `docker run` directly
5. GitHub Actions injects the Traefik file-provider config into the `coolify-proxy` container via `docker cp`

The VPS runs Coolify (which provides the Docker network and Traefik proxy), but the `popdam-frontend` container is managed directly by CI — not through Coolify's application lifecycle. Do not propose alternate routine deployment methods.

See [SELFHOST.md](../SELFHOST.md) for the full pipeline and operational runbook.

## Allowed AI actions

AI may help with:

- editing application code
- editing `docker-compose.yml`
- editing Dockerfiles
- editing GitHub Actions workflows
- editing documentation
- recommending GitHub Secrets usage for CI/CD
- recommending Coolify runtime environment variable changes
- triggering deployment through the approved GitHub -> Coolify path

## Forbidden AI actions

AI must not:

- use SSH *manually* to deploy or hotfix the production server (automated SSH via GitHub Actions is the approved path)
- hand-edit files directly on the production server outside of CI
- assume the server contains the source of truth
- create undocumented hotfixes on the live machine
- introduce additional branches
- create a second deployment system
- recommend storing production runtime configuration only in ad hoc server files

## Secrets rule

- GitHub Secrets are for CI/CD and build-time secrets
- Coolify stores production runtime environment variables
- Do not move all runtime secrets into GitHub if the running app is managed by Coolify

## Compose rule

- The repo copy of `docker-compose.yml` is authoritative
- If a service exists, it should be declared in the repo
- Do not assume server-side Compose changes are valid unless they are committed

## Change discipline

When making changes:

- prefer small, explicit edits
- preserve the single-branch workflow
- keep deployment logic simple
- avoid introducing tools or processes that require manual server babysitting

## Decision preference

When multiple valid options exist, prefer the option that:

- keeps `main` as the single source of truth
- keeps production behavior reproducible
- reduces hidden state on the server
- is easier for a non-developer owner to understand and audit
