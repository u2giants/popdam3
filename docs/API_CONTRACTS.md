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

Purpose: liveness + counters

Request:

\- agent\_id

\- counters (files\_checked, ingested\_new, moved\_detected, updated\_existing, errors, roots\_invalid, roots\_unreadable)

\- last\_error (optional)

Response: ok



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

