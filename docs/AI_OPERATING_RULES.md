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
3. GitHub Actions verifies the change
4. GitHub Actions builds the production Docker image and pushes it to GHCR, using a package-write `GHCR_PAT` only when GitHub's user-scoped package permissions reject `GITHUB_TOKEN` writes
5. GitHub Actions explicitly triggers the Coolify deploy API
6. Coolify pulls the published image and replaces the production container

The VPS runs Coolify, and Coolify owns the `popdam-frontend` application lifecycle, health checks, restart policy, domain bindings, and runtime deployment settings. Do not propose alternate routine deployment methods.

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
- triggering deployment through the approved GitHub Actions -> GHCR -> Coolify path

## Forbidden AI actions

AI must not:

- use SSH to deploy or hotfix the production server as a routine path
- add GitHub Actions steps that SSH into production and run Docker commands
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
- Do not keep or reintroduce routine production SSH deploy credentials in GitHub Actions

## Compose rule

- Coolify's application settings and generated compose are the source of truth for frontend runtime deployment.
- Repo Dockerfiles and workflows are the source of truth for the built image and deploy orchestration.
- Do not hand-edit server-side compose as a normal deployment mechanism.

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
