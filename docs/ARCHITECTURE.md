# HYBRID SYSTEM ARCHITECTURE (Brain + Muscle)

This system is intentionally split so:
- the cloud never needs access to your NAS filesystem
- the browser never needs VPN routing to the NAS
- the NAS worker can run as a reliable “appliance”
- DevOps stays invisible for the human admin

---

## 1) Components

### A) Brain (Cloud)
Responsibilities:
- Web UI (browse/search/filter/tag)
- Authentication + roles (invitation-only)
- Admin config + diagnostics
- API endpoints for agents and admins
- AI tagging orchestration (cloud calls model using thumbnail_url)

Runs on managed hosting (no SSH, no servers to maintain).

### B) Muscle (Bridge Agent on Synology NAS)
Responsibilities:
- Scan configured roots on disk
- Read timestamps from filesystem (mtime + birthtime when available)
- Compute quick hash for move detection
- Generate thumbnails
- Upload thumbnails to DigitalOcean Spaces
- Call agent API to ingest/update/move assets
- Send scan progress counters and logs

Runs as a Docker container on Synology.

### C) Optional Muscle #2 (Windows Render Agent)
Only used when `.ai` thumbnails can’t be reliably generated on the NAS.
- Claims render jobs
- Renders via Illustrator API (ExtendScript)
- Uploads thumbnail to Spaces
- Reports completion via agent API

---

## 2) Communication Model (No Inbound NAS Networking)
Hard rule: The cloud backend does NOT “reach into” the NAS by IP.
Outbound Only: The Bridge Agent polls outward to the cloud. The Cloud never initiates a connection to the NAS.
- Tailscale Role: Tailscale is for user file access (Synology Drive) and human admin, not for the app's internal data flow.

Instead:
- The cloud sets work flags / queues work (DB)
- The Bridge Agent polls outward (HTTPS) to claim work
- The Bridge Agent reports progress outward (HTTPS)

This avoids:
- browser VPN routing requirements
- cloud-to-NAS networking complexity
- fragile Tailscale “cloud talks to 100.x” assumptions

Tailscale may still be used for:
- user remote access to NAS files (Synology Drive)
- optional future locked-down management service
But it is not required for the core worker-to-cloud workflow.

---

## 3) API Boundaries (Critical)
Two separate APIs (or edge functions):

### agent-api (verify_jwt = false)
- Auth: `x-agent-key`
- Routes for: ingest/update/move, progress, heartbeat, claim jobs, complete jobs
- Strict request/response validation (Zod)

### admin-api (verify_jwt = true)
- Auth: user JWT + admin role
- Routes for: config, invites, diagnostics, key generation
- Strict validation (Zod)

Hard rule: never mix admin + agent routes in one function.

---

## 4) Security Rules (Hard)
- No endpoint accepts arbitrary shell commands or raw command strings.
- If any Docker controls exist, they must be strict allowlists with fixed templates.
- Agent keys:
  - store only hashes
  - raw key shown once on creation
  - raw key never returned again

---

## 5) Deployment (Non-Negotiable)
Publish the bridge agent as a pre-built Docker image to Docker Hub or GitHub Container Registry (docker pull ghcr.io/u2giants/popdam-bridge), so the entire heredoc section collapses down to just creating the .env file and a three-line docker-compose.yml. That removes the need to copy source code entirely.

Heartbeat Rule: The cloud API must track the last_heartbeat from the Agent. If it is older than 2 minutes, the Admin Config page must display a "Check Tailscale Connection" warning.

Image Appliance Mode: Reiterate that the Bridge Agent is a read-only appliance. It should never have "Write" permissions to your source art folders unless explicitly configured for metadata embedding.