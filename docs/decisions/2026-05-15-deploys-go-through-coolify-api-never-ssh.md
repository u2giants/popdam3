---
summary: Frontend deploy is triggered through the Coolify API; CI never SSHes into the production server.
kind: decision
status: current
read-when: adding or changing a deploy step in GitHub Actions
---

# Deploys use the Coolify API, never SSH

**Decided:** migrated 2026-05-15 under the owner's CI/CD operating rules.

**Decision:** `publish-frontend.yml` triggers the Coolify deploy API. Never add SSH-based deploy steps; all production deploy triggers go through Coolify. The `VPS_SSH_KEY` secret was removed.

**Why:** the CI/CD rules prohibit GitHub Actions from SSHing into production, and Coolify already manages the container.

**Rejected:** SSH deploys.

## Source

- [docs/deployment.md](../deployment.md)
- private memory note project_cicd (outside this repo)
