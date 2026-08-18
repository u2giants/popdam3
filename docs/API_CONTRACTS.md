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
- Auth: user JWT + admin role, verified inside the function via `authenticateAdmin()`, now a thin adapter over the shared `requireAdmin()` in `supabase/functions/_shared/admin-auth.ts` (the single admin check for all six admin-gated functions — see `docs/AUTHENTICATION.md`)
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
    "abort_scan": false,
    "test_paths": null,
    "browse_dir": null,
    "apply_update": false,
    "force_apply_update": false
  }
}
```

Notes:
- **Secrets (`DO_SPACES_KEY`, `DO_SPACES_SECRET`, `AGENT_KEY`) are never in `admin_config` or returned by the API.** They live only in the agent's local `.env`.
- `do_spaces` contains only non-secret fields from `SPACES_CONFIG`. The agent uses its local `.env` for S3 credentials.
- `scanning.roots` from cloud overrides the agent's env `SCAN_ROOTS` when non-empty.
- `commands.force_scan` and `commands.abort_scan` are consumed once and cleared server-side.
- `commands.test_paths` — when non-null: `{ request_id: string; paths: string[] }`. Agent validates each path and calls `report-path-test` with results.
- `commands.browse_dir` — when non-null: `{ request_id: string; path: string }`. Agent lists directory contents and calls `report-dir-browse` with results. Empty `path` lists scan roots.
- `commands.apply_update` — when true: agent pulls latest Docker image and recreates its own container.
- `resource_guard` values reflect the active schedule (or defaults if no schedule matches).

### POST /agent/ingest

Purpose: idempotent ingest/update/guarded move detection for a single file

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
- `skip_move_detection` (optional boolean) — bridge sets this when the same `(quick_hash, filename)` has already been seen in the current scan-wide preflight/ingest phase, so duplicate copies insert/update by path instead of stealing a sibling row.

Move-detection contract:
- `quick_hash` is a sampled hash and is not content-unique.
- The server may treat a file as moved only when all of these are true:
  - `file_size > 0`
  - `skip_move_detection` is not true
  - there is no existing non-deleted row at the incoming `relative_path`
  - exactly one non-deleted existing row matches the same `(quick_hash, filename)` at a different path
- If two or more same `(quick_hash, filename)` candidates exist, the move is ambiguous and must be skipped.
- Same-hash but different-filename files are different assets, not moves.

Response:
- `action` — `created` | `updated` | `moved` | `noop`
- `asset_id`
- `ok`

### POST /agent/check-changed

Purpose: batch change detection before local hashing/thumbnail work, and scan-wide duplicate-copy seeding.

Request:
- `files[]` with `relative_path`, `modified_at`, `file_size`

Response:
- `changed` — relative paths that are new or have different filesystem metadata
- `needs_thumbnail` — unchanged paths whose thumbnail error should be retried
- `existing_content_identities` — unchanged existing rows as `{ relative_path, filename, quick_hash }`; bridge agents use this to seed scan-wide duplicate detection before ingesting changed/new paths.

Important:
- The server caps each request at 500 files; bridge agents chunk full-scan preflight calls.
- Bridge agents must preserve `existing_content_identities` across chunks for the whole scan, not per chunk.
- If `check-changed` fails, the bridge may process all candidates, but duplicate-copy detection is weaker because unchanged existing identities are unavailable.

### POST /agent/scan-progress

Purpose: progress reporting for UI display

Request:
- `session_id`
- `status` — `running` | `completed` | `completed_with_errors` | `failed`
- `counters` + `current_path` (optional)
- `error` — required for `status = "failed"` from current bridge agents. Older agents may omit it; `agent-api` must synthesize a useful counter-based fallback before writing `SCAN_PROGRESS` / `SCAN_REQUEST`.

Important:
- Failed scan records must be actionable. Do not write a terminal `failed` state that only says "unknown" or omits the cause.
- Root validation failures should include invalid/unreadable counts and, where the agent knows them, configured roots.
- Zero-file failures should point at likely scan filters/configuration (`SCAN_ROOTS`, `SCAN_ALLOWED_SUBFOLDERS`, `SCAN_MIN_DATE`).

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

### POST /agent/report-path-test

Purpose: bridge agent reports path validation results (response to `commands.test_paths`)

Request:
- `request_id` — must match the pending `PATH_TEST_REQUEST.request_id`
- `results` — array of `{ path, exists, readable, error? }`

Response: `{ ok: true }`

### POST /agent/report-dir-browse

Purpose: bridge agent reports directory listing results (response to `commands.browse_dir`)

Request:
- `request_id` — must match the pending `DIR_BROWSE_REQUEST.request_id`
- `path` — the directory that was listed
- `entries` — array of `{ name, type: "dir"|"file", size?, modified_at? }`

Response: `{ ok: true }`

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

### POST /admin/request-dir-browse

Purpose: request the bridge agent to list a directory on the NAS

Request: `{ path?: string }` — empty string or omitted = list scan roots

Response: `{ ok: true, request_id: string }`

The agent picks this up on its next heartbeat (within 30s) via `commands.browse_dir` and posts results back via `report-dir-browse`. Poll `get-dir-browse-result` until `result.request_id` matches.

### POST /admin/get-dir-browse-result

Purpose: retrieve the most recent directory browse result

Request: none

Response: `{ ok: true, result: { request_id, path, entries, browsed_at } | null }`

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

The companywide business rule is [Digital assets and file integrity](https://github.com/u2giants/shared-db/blob/main/docs/business-rules/digital-assets-and-file-integrity.md). This API reports the original filesystem values in `modified_at` and `file_created_at`; PopDAM enforcement and failure behavior are defined in `docs/PROJECT_BIBLE.md`.
