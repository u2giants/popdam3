# DEPLOYMENT (DevOps Invisible)

Goal: You should never have to copy source code to the NAS or “build on Synology.”
The NAS runs prebuilt images like an appliance.

---

## 1) Bridge Agent Distribution (Non-Negotiable)
Publish the bridge agent as a pre-built Docker image to Docker Hub or GitHub Container Registry (docker pull ghcr.io/u2giants/popdam-bridge), so the entire heredoc section collapses down to just creating the .env file and a three-line docker-compose.yml. That removes the need to copy source code entirely.

Required tags:
- `latest`
- commit SHA tag (for rollback)

Optional:
- Watchtower for auto-updates

---

## 2) Synology Install (Target UX)
The target install should be:
1) Create `.env` (copy/paste)
2) Create minimal `docker-compose.yml`
3) Click “Deploy” in Synology Container Manager (Project)

No local builds on NAS.

---

## 3) CI/CD Requirement
On push to main:
- build bridge-agent image
- push to registry (latest + sha)
- publish release notes / changelog entry

---

## 4) Secrets Handling
- Never commit secrets to git.
- `.env.example` is required for all components.
- Raw agent keys must never be stored in DB or returned by APIs.

