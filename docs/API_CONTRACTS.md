\# API CONTRACTS (Agent + Admin)



This file is the single source of truth for request/response shapes.

All endpoints must have Zod validation that matches this.



---



\## 1) Auth Boundaries



\### agent-api

\- `verify\_jwt = false`

\- Auth: `x-agent-key`

\- Used only by Bridge Agent + Windows Render Agent



\### admin-api

\- `verify\_jwt = true`

\- Auth: user JWT + admin role



---



\## 2) Agent API (High-Level Contracts)



\### POST /agent/register

Purpose: activate an agent using a pre-generated key

Request:

\- agent\_name

\- agent\_type (bridge | windows-render)

\- agent\_key (raw)  (only sent by agent, never returned)

Response:

\- agent\_id

\- ok



\### POST /agent/heartbeat

Purpose: liveness + counters + **config sync** (returns full config payload)

Request:

\- agent\_id

\- counters (files\_checked, ingested\_new, moved\_detected, updated\_existing, errors, roots\_invalid, roots\_unreadable)

\- last\_error (optional)

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
\- **Secrets (DO\_SPACES\_KEY, DO\_SPACES\_SECRET, AGENT\_KEY) are NEVER stored in admin\_config or returned by the API.** They exist only in the agent's local `.env` on the NAS.
\- `do\_spaces` contains only non-secret fields from the `SPACES_CONFIG` admin\_config key. The agent uses its local `.env` for S3 credentials.
\- `scanning.roots` from cloud override the agent's env `SCAN\_ROOTS` when non-empty.
\- `commands.force\_scan` and `commands.abort\_scan` are consumed once and cleared server-side.
\- `resource\_guard` values reflect the active schedule (or defaults if no schedule matches).



\### POST /agent/ingest

Purpose: idempotent ingest/update/move detection

Request (per file):

\- relative\_path

\- filename

\- file\_type

\- file\_size

\- modified\_at (filesystem)

\- file\_created\_at (filesystem)

\- quick\_hash + version

\- thumbnail\_url (optional)

\- thumbnail\_error (optional)

Response:

\- action (created | updated | moved | noop)

\- asset\_id

\- ok



\### POST /agent/scan-progress

Purpose: progress reporting for UI

Request:

\- session\_id

\- status (running | completed | failed)

\- counters + current\_path (optional)

Response: ok



\### POST /agent/queue-render

Purpose: queue AI render job for Windows agent

Request:

\- asset\_id

\- reason (no\_pdf\_compat etc.)

Response:

\- job\_id

\- ok



\### POST /agent/claim-render

Purpose: windows agent claims next job (skip-locked style)

Request:

\- agent\_id

Response:

\- job | null

\- ok



\### POST /agent/complete-render

Purpose: windows agent completes job

Request:

\- job\_id

\- success

\- thumbnail\_url or error

Response: ok



---



\## 3) Admin API (High-Level Contracts)



\### GET /admin/assets

Must be server-side paginated and apply centralized visibility logic.

Query:

\- page, page\_size, search, filters...

Response:

\- assets\[], total, page, page\_size



\### PUT /admin/assets/:id

Manual edits + admin review resolution.



\### GET/PUT /admin/config

Stores THUMBNAIL\_MIN\_DATE, SCAN\_MIN\_DATE, NAS mapping, Spaces base URL, taxonomy endpoints, AI provider selection.



\### POST /admin/invitations

Create invite.



\### GET /admin/doctor

Return diagnostics bundle (effective config, agent statuses, last counters, last errors).

