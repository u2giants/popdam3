# API Contracts — Agent + Admin

This file is the single source of truth for request/response shapes. All endpoints must have Zod validation that matches this.

---

## 1) Auth Boundaries

### agent-api

- `verify_jwt = false` (see quirk #4 in KNOWN_QUIRKS.md for why admin-api also uses this)
- Auth: `x-agent-key` header (SHA-256 hashed, compared against stored hash)
- Used only by Bridge Agent + Windows Render Agent

### admin-api

- `verify_jwt = false` at gateway level (CORS preflight workaround — see KNOWN_QUIRKS.md #4)
- Auth: user JWT + admin role, verified inside the function via `authenticateAdmin()`
- Also accepts Supabase service role key as Bearer token for Railway worker calls (see KNOWN_QUIRKS.md #8)

---

## 2) Agent API Contracts

### POST /agent/register

Purpose: activate an agent using a pre-generated pairing code

Request:
- `agent_name`
- `agent_type` — `bridge` | `windows-render`
- `agent_key` (raw) — only sent by agent, never returned

Response:
- `agent_id`
- `ok`

### POST /agent/heartbeat

Purpose: liveness + counters + **config sync** (returns full config payload on every call)

Request:
- `agent_id`
- `counters` — `files_checked`, `ingested_new`, `moved_detected`, `updated_existing`, `errors`, `roots_invalid`, `roots_unreadable`
- `last_error` (optional)

Response (Config Sync Payload):

```json
{
  "ok": true,
  "config": {
    "do_spaces": {
      "bucket": "string",
      "region": "string",
      "endpoint": "string",
      "public_base_url": "string"
    },
    "scanning": {
      "roots": ["string"],
      "batch_size": 100,
      "adaptive_polling": {
        "idle_seconds": 30,
        "active_seconds": 5
      }
    },
    "resource_guard": {
      "cpu_percentage_limit": 50,
      "memory_limit_mb": 512,
      "concurrency": 2
    }
  },
  "commands": {
    "force_scan": false,
    "abort_scan": false
  }
}
```

Notes:
- **Secrets (`DO_SPACES_KEY`, `DO_SPACES_SECRET`, `AGENT_KEY`) are never in `admin_config` or returned by the API.** They live only in the agent's local `.env`.
- `do_spaces` contains only non-secret fields from `SPACES_CONFIG`. The agent uses its local `.env` for S3 credentials.
- `scanning.roots` from cloud overrides the agent's env `SCAN_ROOTS` when non-empty.
- `commands.force_scan` and `commands.abort_scan` are consumed once and cleared server-side.
- `resource_guard` values reflect the active schedule (or defaults if no schedule matches).

### POST /agent/ingest

Purpose: idempotent ingest/update/move detection for a single file

Request:
- `relative_path`
- `filename`
- `file_type`
- `file_size`
- `modified_at` — filesystem timestamp
- `file_created_at` — filesystem timestamp
- `quick_hash` + `quick_hash_version`
- `thumbnail_url` (optional)
- `thumbnail_error` (optional)

Response:
- `action` — `created` | `updated` | `moved` | `noop`
- `asset_id`
- `ok`

### POST /agent/batch-ingest

Purpose: batch version of ingest (up to 100 files per call)

Request: array of ingest payloads (same shape as single ingest)

Response: array of per-file results with `action`, `asset_id`, `ok`

### POST /agent/scan-progress

Purpose: progress reporting for UI display

Request:
- `session_id`
- `status` — `running` | `completed` | `failed`
- `counters` + `current_path` (optional)

Response: `{ ok: true }`

### POST /agent/queue-render

Purpose: queue an AI render job for the Windows Render Agent

Request:
- `asset_id`
- `reason` (e.g., `no_pdf_compat`)

Response:
- `job_id`
- `ok`

### POST /agent/claim-render

Purpose: Windows agent claims the next pending render job (skip-locked)

Request:
- `agent_id`

Response:
- `job` | `null`
- `ok`

### POST /agent/complete-render

Purpose: Windows agent reports job completion

Request:
- `job_id`
- `success`
- `thumbnail_url` or `error`

Response: `{ ok: true }`

### POST /agent/bootstrap

Purpose: returns bootstrap data needed by agent on startup (roots, config, active jobs)

Request:
- `agent_id`

Response: combined config + scan state + any pending commands

### POST /agent/pairing-codes/generate

Purpose: generate a one-time pairing code for a new agent (admin-initiated)

Request: `{ agent_type, label }`

Response: `{ code, expires_at }`

---

## 3) Admin API Contracts

### GET /admin/assets

Must be server-side paginated and apply centralized visibility logic.

Query params: `page`, `page_size`, `search`, filters

Response: `{ assets[], total, page, page_size }`

### PUT /admin/assets/:id

Manual field edits + admin review resolution.

### GET|PUT /admin/config

Stores: `THUMBNAIL_MIN_DATE`, `SCAN_MIN_DATE`, NAS mapping, Spaces base URL, taxonomy endpoints, AI provider selection.

### POST /admin/invitations

Create a new invitation for a user email.

### GET /admin/doctor

Return diagnostics bundle: effective config, agent statuses, last counters, last errors.

### POST /admin/update-bulk-op

Start, stop, queue, or update a bulk operation. Returns HTTP 409 if a conflicting job is already running.

---

## 4) File Date Preservation Rule

All timestamps reported by the agent (`modified_at`, `file_created_at`) must be the original filesystem values. The agent must never cause these to change on disk. If a file operation inadvertently modifies timestamps, the agent must restore them and report a critical error if restoration fails. See `docs/PROJECT_BIBLE.md`.
