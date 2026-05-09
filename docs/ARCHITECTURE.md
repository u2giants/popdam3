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
- Authentication + roles (Authentik SSO for AD users; invitation-only for all other paths)
- Admin config + diagnostics
- API endpoints for agents and admins (`admin-api`, `agent-api` Supabase edge functions)

Runs on managed hosting (Supabase + Coolify on VPS). No SSH, no servers to maintain.

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

### D) POP DAM Helper (Desktop App)
Electron app for Windows and macOS. Enables the checkout/check-in workflow — designers lock a file, edit it locally, and check it back in without manually browsing the NAS.

**How it fits into the system:**
- Users click "Check Out & Open" in the web DAM. The web app calls `helper-api` to generate a short-lived `popdam://` token, which opens the Helper via OS protocol handler.
- The Helper validates the token, downloads the file from the Synology NAS, copies it to a local workspace, and opens it in the native app.
- On check-in, the Helper uploads the modified file back to Synology, records a snapshot, and updates the cloud checkout record via `helper-api`.
- On the same machine, the directory browser at `/files` sends a `/status` probe to `http://127.0.0.1:47380` on page load. If the Helper is running, all directory listings go directly to it via `GET /browse?path=...` — no cloud roundtrip. If not, the request falls back to the bridge agent path.

**Local HTTP server (port 47380):**
The Helper listens on `127.0.0.1:47380` from app launch. Two endpoints:
- `GET /status` — `{ ok, version, roots[] }`
- `GET /browse?path=X` — directory listing; `path=""` returns configured roots, `path="root_id/sub/dir"` resolves via root mappings

CORS is restricted to `*.designflow.app` and `localhost`. The port is fixed so the web app always knows where to probe.

**Distribution:** GitHub Releases, built by `publish-popdam-helper.yml` (electron-builder). Windows: NSIS installer (x64 + ia32). macOS: DMG (x64 + arm64).

### E) Railway Worker (Bulk Operation Runner)
Persistent Node.js process running on Railway. Handles all batch operations that are too long-lived for edge functions.

Responsibilities:
- AI image tagging (`ai-tag-untagged`, `ai-tag-all`, `ai-tag-groups`)
- Style group rebuild, reconcile, cleanup-mega-group-tags, relink-orphaned-assets
- Tag propagation (`propagate-group-tags`)
- ERP enrichment and ERP AI classification

How it works: polls `admin_config.BULK_OPERATIONS` every 5 seconds. When it finds an operation with `status: "running"`, it claims a batch, processes it, writes progress back, and loops. It has no timeout constraint.

**See `apps/worker/src/` for the implementation and `docs/BULK_JOBS.md` for the full operation reference.**

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
Two separate edge function APIs plus the Railway worker:

### agent-api (verify_jwt = false)
- Auth: `x-agent-key`
- Routes for: ingest/update/move, progress, heartbeat, claim jobs, complete jobs
- Strict request/response validation (Zod)

### admin-api (verify_jwt = true)
- Auth: user JWT + admin role, **or** the Supabase service role key as Bearer token
- Routes for: config, invites, diagnostics, key generation, per-batch operations called by the Railway worker
- Strict validation (Zod)
- Service role key auth maps to `userId: "system"` — used by the Railway worker for server-to-server calls (no user JWT in a background process)

### Railway worker (server process, no HTTP listener)
- Auth: uses `SUPABASE_SERVICE_ROLE_KEY` env var to create a service role Supabase client directly
- For operations it cannot execute via DB RPC, it calls `admin-api` with the service role key as Bearer token
- Bypasses RLS entirely (service role)

Hard rule: never mix admin + agent routes in one function.

---

## 4) Security Rules (Hard)
- No endpoint accepts arbitrary shell commands or raw command strings.
- If any Docker controls exist, they must be strict allowlists with fixed templates.
- Agent keys:
  - store only hashes
  - raw key shown once on creation
  - raw key never returned again

### Edge function CORS
All edge functions must use `corsServe()` from `supabase/functions/_shared/http.ts` instead of importing `serve` + static `corsHeaders` directly. `corsServe()`:
- Handles OPTIONS preflights automatically
- Validates the request `Origin` against an allowlist (`*.designflow.app`, `*.lovable.app`, localhost)
- Rewrites `Access-Control-Allow-Origin` on every response with the specific allowed origin (not `*`)
- Rejects unauthorized origins by omitting CORS headers entirely

```typescript
import { corsServe, json, err } from "../_shared/http.ts";

corsServe(async (req: Request) => {
  // no OPTIONS check needed
  return json({ ok: true });
});
```

### Admin query endpoint security
The `run-query` action in admin-api restricts queries to `SELECT` only (no `WITH` CTEs — the `execute_readonly_query` DB function enforces read-only at the transaction level, but removing the CTE prefix at the gateway prevents any bypass attempts).

---

## 5) Deployment (Non-Negotiable)
Publish the bridge agent as a pre-built Docker image to Docker Hub or GitHub Container Registry (docker pull ghcr.io/u2giants/popdam-bridge), so the entire heredoc section collapses down to just creating the .env file and a three-line docker-compose.yml. That removes the need to copy source code entirely.

Heartbeat Rule: The cloud API must track the last_heartbeat from the Agent. If it is older than 2 minutes, the Admin Config page must display a "Check Tailscale Connection" warning.

Image Appliance Mode: Reiterate that the Bridge Agent is a read-only appliance. It should never have "Write" permissions to your source art folders unless explicitly configured for metadata embedding.

---

## 6) Golden Rule: File Date Preservation
The Bridge Agent must NEVER modify file timestamps (mtime/birthtime) on source art files. Before any file read, record original timestamps; after, verify and restore if changed. If restoration fails, halt processing and report a critical error. See PROJECT_BIBLE.md §15.