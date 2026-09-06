# Admin Operations Reference

This document is the complete reference for every route exposed by the `admin-api` Supabase Edge Function.  All routes are called as HTTP POST with a JSON body containing an `action` field, unless noted otherwise.

**Auth:** Every request must include a valid user JWT with the `admin` role. The edge function verifies the JWT and checks `user_roles`. Server-to-server calls may use the Supabase service role key as an `Authorization: Bearer` header instead.

**Endpoint:** `POST https://<project>.supabase.co/functions/v1/admin-api`

**Request shape:** `{ "action": "<action-name>", ...other fields }`

**Error shape:** `{ "error": "message" }` with appropriate HTTP status code.

---

## Configuration

### `get-config`
Returns admin config values for the given keys.

| Field | Type | Notes |
|-------|------|-------|
| `keys` | `string[]` | Config keys to retrieve |

Returns: `{ [key]: value }` for each requested key.

### `set-config`
Saves one or more admin config values.

| Field | Type | Notes |
|-------|------|-------|
| `updates` | `Record<string, unknown>` | Key/value pairs to set |

Returns: `{ ok: true }`.

---

## User & Invitation Management

### `invite-user`
Creates a new invitation that allows the specified email to sign up.

| Field | Type | Notes |
|-------|------|-------|
| `email` | `string` | Email address to invite |
| `role` | `string` | Role to grant (`user` or `admin`) |

### `list-invites`
Lists all invitations (pending and accepted). No body parameters.

Returns: `{ invitations: Invitation[] }`.

### `revoke-invite`
Deletes a pending invitation.

| Field | Type | Notes |
|-------|------|-------|
| `invitation_id` | `string` | UUID of invitation to revoke |

---

## Agent Management

### `generate-agent-key`
Generates and stores a new agent registration key. The raw key is returned **once** and never stored.

| Field | Type | Notes |
|-------|------|-------|
| `agent_name` | `string` | Human-readable name (e.g. "NAS-1") |
| `agent_type` | `string` | `bridge` or `windows-render` |

Returns: `{ agent_id, raw_key }`.

### `list-agents`
Lists all registered agents with their online/offline status (offline if last heartbeat > 2 minutes ago). No body parameters.

### `revoke-agent`
Deletes an agent registration, preventing further connections.

| Field | Type | Notes |
|-------|------|-------|
| `agent_id` | `string` | UUID of agent registration to revoke |

### `remove-agent-registration`
Alias for `revoke-agent`.

### `doctor`
Returns a full diagnostics bundle: effective config, agent statuses, last heartbeat counters, recent errors, render queue stats. No body parameters.

### `trigger-agent-update`
Tells one or all agents to pull the latest Docker image and restart.

| Field | Type | Notes |
|-------|------|-------|
| `agent_id` | `string` (optional) | If omitted, triggers all agents |

### `get-update-status`
Returns the current update status for all agents. No body parameters.

### `create-pairing-code`
Creates a one-time pairing code for agent bootstrap registration.

| Field | Type | Notes |
|-------|------|-------|
| `agent_type` | `string` | `bridge` or `windows-render` |
| `agent_name` | `string` | Name to pre-assign to the agent |
| `expires_in_minutes` | `number` (optional) | Default: 15 minutes |

Returns: `{ pairing_code, expires_at }`.

### `list-pairing-codes`
Lists all pairing codes (pending, consumed, expired). No body parameters.

### `generate-bootstrap-token`
Generates a short-lived bootstrap token for agent first-run setup. No body parameters.

### `generate-install-bundle`
Generates a downloadable ZIP file containing pre-configured agent startup files. For the Bridge Agent: `.env`, `docker-compose.yml`, `README`. For the Windows Agent: `install.ps1`, `README.txt`. Automatically creates a 15-minute pairing code embedded in the bundle.

| Field | Type | Notes |
|-------|------|-------|
| `agent_type` | `string` | `bridge` or `windows-render` |
| `agent_name` | `string` | Name to assign to the agent |
| `enable_watchtower` | `boolean` | Auto-update via Watchtower container |
| `update_channel` | `string` | `stable` or `edge` |
| `nas_host_path` | `string` | (Bridge) Host filesystem path to NAS mount |
| `container_mount_root` | `string` | (Bridge) Container internal mount path |
| `scan_roots` | `string[]` | (Bridge) Paths to scan within mount |
| `desired_drive_letter` | `string` | (Windows) Drive letter to map NAS share |
| `nas_host` | `string` | (Windows) NAS hostname or IP |
| `nas_share` | `string` | (Windows) SMB share name |

Returns: Binary ZIP file with `Content-Type: application/zip`.

---

## Scan Operations

### `trigger-scan`
Signals the Bridge Agent to start a scan immediately.

| Field | Type | Notes |
|-------|------|-------|
| `agent_id` | `string` (optional) | Target specific agent; omit for all |

### `stop-scan`
Signals the Bridge Agent to abort the active scan.

### `resume-scanning`
Clears a force-stop flag so the Bridge Agent resumes normal scanning.

### `reset-scan-state`
Resets all scan progress counters and state flags.

---

## Render Queue Management

### `render-queue-stats`
Returns counts of render jobs by status. No body parameters.

### `list-render-jobs`
Lists render jobs with optional filtering.

| Field | Type | Notes |
|-------|------|-------|
| `status` | `string` (optional) | Filter by status |
| `limit` | `number` | Default: 50 |
| `offset` | `number` | Default: 0 |

### `requeue-render-job`
Resets a single render job to `pending` so it will be claimed again.

| Field | Type | Notes |
|-------|------|-------|
| `job_id` | `string` | UUID of the render job |

### `clear-junk-render-jobs`
Deletes orphaned render jobs (jobs whose asset no longer exists). No body parameters.

### `clear-failed-renders`
Deletes all render jobs in `failed` status. No body parameters.

### `clear-failed-sg-renders`
Deletes all PopSG `style_guide_render_queue` rows in `failed` status. No body parameters. Uses the service role client to bypass RLS — the authenticated role's `has_role()` policy would time out at PostgreSQL's 8s statement limit when evaluated per-row on tens of thousands of rows.

### `send-test-render`
Queues a test asset for rendering to verify the Windows Render Agent is working. No body parameters.

### `check-render-job`
Checks the current status of a render job.

| Field | Type | Notes |
|-------|------|-------|
| `job_id` | `string` | UUID of the render job |

### `retry-failed-jobs`
Resets all failed render jobs to `pending`. No body parameters.

### `clear-completed-jobs`
Deletes all render jobs in `completed` status. No body parameters.

### `retry-failed-renders`
Alias for `retry-failed-jobs` for consistency.

### `requeue-all-no-preview`
Queues all assets that have a `thumbnail_error` set for re-rendering. No body parameters.

### `request-path-test`
Requests the Bridge Agent to run a path validation test and report back. No body parameters.

---

## Metadata Operations

### `reprocess-asset-metadata`
Re-derives path-based metadata (licensor_id, property_id, SKU fields, workflow_status) for all assets in batches of 200.

| Field | Type | Notes |
|-------|------|-------|
| `offset` | `number` | Cursor for batch resumption |

Returns: `{ updated, total, offset }`.

### `backfill-sku-names`
Fills in licensor/property code names from lookup tables for assets and style_groups. Processes 500 records per iteration, maximum 10,000 total.

### `get-filter-options`
Returns all available filter facets (licensors, properties, workflow_status values, etc.) for the library UI filter sidebar. No body parameters.

---

## Style Groups

> **Note:** `rebuild-style-groups`, `reconcile-style-group-stats`, `cleanup-mega-group-tags`, and `relink-orphaned-assets` are **not** admin-api routes. They are bulk operations handled entirely by the Railway worker (`apps/worker/`). Start them via the Diagnostics UI which writes `status: "running"` to `admin_config.BULK_OPERATIONS`. See `docs/BULK_JOBS.md`.

### `sync-group-tags`
Immediately propagates tags from the primary asset to all sibling assets in a specific group. (Inline operation — not batched through bulk-job-runner.)

| Field | Type | Notes |
|-------|------|-------|
| `style_group_id` | `string` | UUID of the group to sync |

---

## AI Tagging

> **Note:** `bulk-ai-tag`, `bulk-ai-tag-all`, and `ai-tag-groups` are **not** admin-api routes. They are bulk operations handled entirely by the Railway worker (`apps/worker/`). See `docs/BULK_JOBS.md`.

### `count-untagged-assets`
Returns the count of assets that have a thumbnail URL but no `ai_tagged_at`. No body parameters.

### `create-ai-tag-bakeoff-run`
Creates a non-destructive Vision Bake-Off run. The UI passes five OpenRouter
model IDs and a sample size; the route stores the selected random/deduped asset
IDs in `ai_tag_bakeoff_runs`. The Railway worker processes the run through the
same shared Image Tagging contract used by production tagging.

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` optional | Defaults to a generated bake-off name |
| `sample_size` | `number` | Number of assets to sample |
| `model_ids` | `string[]` | Five distinct OpenRouter model IDs |
| `asset_ids` | `string[]` optional | Explicit asset sample override |

### `list-ai-tag-bakeoff-runs`
Returns recent bake-off run headers for the Settings → AI Tagging run selector.
No body parameters.

### `get-ai-tag-bakeoff-run`
Returns one run plus ordered assets, results, and human reviews. It also marks
stale `running` result rows older than 10 minutes as `failed`.

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | `string` | UUID of the bake-off run |

### `score-ai-tag-bakeoff-field`
Stores human review choices for one asset/field. The UI can store multiple
winner slots in `scores.winner_slots`; `winner_slot` is kept as the first winner
for compatibility.

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | `string` | UUID of the bake-off run |
| `asset_id` | `string` | UUID of the sampled asset |
| `field` | `string` | `tags`, `description`, `characters`, `property`, or `overall` |
| `winner_slots` | `string[]` | Any of `a` through `e` |
| `notes` | `string` optional | Human notes |

### `bulk-propagate-group-tags`
Propagates AI tags, characters, and metadata from the primary (best-tagged) asset in each style group to all sibling assets. Calls the `propagate_group_tags_batch` PostgreSQL function directly via RPC.

| Field | Type | Notes |
|-------|------|-------|
| `offset` | `string` (UUID cursor, optional) | Resume from this group |
| `batch_size` | `number` | Default: 200 |

### `count-groups-for-propagation`
Returns the total number of style groups (used to calculate propagation progress). No body parameters.

---

## ERP Operations

> **Retired 2026-09-06.** The DesignFlow ERP feed is no longer the item master.
> ColdLion (`plm.item`) is canonical per `docs/core-master-data-consolidation-aim.md` §4
> in `u2giants/shared-db`. The `trigger-erp-sync` / `erp-sync-runs` actions and the
> `erp-sync` Edge Function have been removed. `erp_items_current` is now frozen data
> (last successful sync 2026-05-21) and is still read by the enrichment/classification
> pipelines below until they are repointed.

### `erp-enrichment-stats`
Returns counts and statistics for ERP enrichment: total ERP items, matched assets, enriched counts, category distribution. No body parameters.

### `erp-review-queue`
Returns the paginated list of product category predictions awaiting admin review.

| Field | Type | Notes |
|-------|------|-------|
| `status` | `string` | `pending`, `low_confidence`, `auto_applied`, `approved`, `rejected`, `unclassifiable`, or `all` |
| `page` | `number` | 1-based page number |
| `page_size` | `number` | Default: 50 |

### `erp-review-action`
Takes an action on one or more product category predictions.

| Field | Type | Notes |
|-------|------|-------|
| `review_action` | `string` | `approve`, `reject`, `revert`, `bulk-reject`, or `bulk-dismiss` |
| `prediction_id` | `string` | UUID (for single-item actions) |
| `prediction_ids` | `string[]` | UUIDs (for bulk actions) |

### `apply-erp-enrichment`
Applies approved ERP enrichment data to assets and style_groups (licensor, property, category fields).

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `string` | `dry-run` (returns counts only) or `apply` (writes to DB) |
| `offset` | `number` | Cursor for batch resumption |

### `classify-erp-categories`
Uses Claude Haiku (AI) to classify ERP items that have no `mg_category` into one of 7 product categories: Wall, Tabletop, Clock, Storage, Workspace, Floor, Garden.

| Field | Type | Notes |
|-------|------|-------|
| `offset` | `number` | Cursor for batch resumption |

Processes 5 items per batch. Inter-call delay: 1000ms to avoid API rate limits.

### `erp-items-browse`
Returns a paginated, searchable list of ERP items from `erp_items_current`.

| Field | Type | Notes |
|-------|------|-------|
| `page` | `number` | 1-based |
| `page_size` | `number` | Default: 50 |
| `search` | `string` (optional) | Free-text search on style_number and description |
| `sort_by` | `string` | Column to sort by |
| `sort_asc` | `boolean` | Sort direction |
| `max_digits_style` | `number` (optional) | Filter by style number digit count |
| `max_digits_desc` | `number` (optional) | Filter by description digit count |
| `show_dismissed` | `boolean` | Include dismissed items |

### `erp-items-dismiss`
Marks ERP items as dismissed (excluded from enrichment pipeline).

| Field | Type | Notes |
|-------|------|-------|
| `ids` | `string[]` | UUIDs from erp_items_current |

---

## TIFF Pipeline

### `trigger-tiff-scan`
Signals the Bridge Agent to scan for TIFF files and populate `tiff_optimization_queue`.

### `list-tiff-files`
Returns TIFF files from the optimization queue with summary counts.

| Field | Type | Notes |
|-------|------|-------|
| `status` | `string` (optional) | Filter by status |
| `compression` | `string` (optional) | Filter by compression_type |
| `limit` | `number` | Default: 100 |
| `offset` | `number` | Default: 0 |

### `queue-tiff-jobs`
Queues scanned TIFF files for processing by the Bridge Agent.

| Field | Type | Notes |
|-------|------|-------|
| `ids` | `string[]` | UUIDs from tiff_optimization_queue |
| `mode` | `string` | `test` (dry run, no changes) or `process` (compress + replace) |

### `delete-tiff-originals`
Marks processed TIFF files for original deletion by the Bridge Agent.

| Field | Type | Notes |
|-------|------|-------|
| `ids` | `string[]` | UUIDs from tiff_optimization_queue |

### `clear-tiff-scan`
Deletes all rows from `tiff_optimization_queue`. Resets the entire TIFF scan state.

### `refresh-tiff-dates`
Re-reads filesystem timestamps for the specified TIFF files from the Bridge Agent.

| Field | Type | Notes |
|-------|------|-------|
| `ids` | `string[]` | UUIDs from tiff_optimization_queue |

---

## File Hygiene

### `trigger-hygiene-scan`
Requests the Bridge Agent to run file hygiene checks.

| Field | Type | Notes |
|-------|------|-------|
| `check_types` | `string[]` | Checks to run: `ai_embedded_raster`, `tiff_uncompressed`, `psd_oversized_layer` |

### `list-hygiene-findings`
Returns hygiene findings from `hygiene_findings`.

| Field | Type | Notes |
|-------|------|-------|
| `status` | `string` (optional) | `open`, `dismissed`, or `resolved` |
| `check_type` | `string` (optional) | Filter by check type |
| `limit` | `number` | Default: 200 |

### `update-hygiene-findings`
Changes the status of one or more findings.

| Field | Type | Notes |
|-------|------|-------|
| `ids` | `string[]` | UUIDs from hygiene_findings |
| `status` | `string` | `open`, `dismissed`, or `resolved` |

### `stop-hygiene-scan`
Signals the Bridge Agent to abort the active hygiene scan.

---

## Sibling Image Discovery

Sibling files are JPG/PNG/eligible PDF files that sit in the same NAS folder as a PSD or AI design file. They represent approved product photography, renders, mockups, or PDFs that should be linked to the same style group.

Scan requests are lightweight `admin_config` rows named `sibling_scan_request_*`. The web UI creates them through `list-sibling-images`, the Bridge Agent claims them through `claim-sibling-scan`, and the agent finishes them through `complete-sibling-scan`.

Important: `claimed` is a lease, not a terminal state. A Bridge Agent can restart or throw after claiming a request; without expiry, the UI will wait forever and future scans for the same folder will keep reusing the stuck row. Keep the 10-minute stale-claim handling in both places:
- `supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts` expires old claimed rows as a retryable failure for the UI.
- `supabase/functions/agent-api/index.ts` lets the Bridge Agent reclaim stale claimed rows.
- `apps/bridge-agent/src/index.ts` reports a failed scan if a per-request worker throws after claiming.

### `list-sibling-images`
Lists potential sibling files for a folder or style group.

| Field | Type | Notes |
|-------|------|-------|
| `folder_path` | `string` | NAS relative path of the folder |
| `style_group_id` | `string` (optional) | Scope to a specific group |

### `get-sibling-scan-result`
Retrieves the results of a previously-requested sibling scan by request ID.

| Field | Type | Notes |
|-------|------|-------|
| `request_id` | `string` | ID returned by the scan request |

### `get-sibling-scan-by-folder`
Retrieves the most recent sibling scan result for a given folder path.

| Field | Type | Notes |
|-------|------|-------|
| `folder_path` | `string` | NAS relative path |

### `ingest-sibling-images`
Ingests selected sibling files as assets and links them to the specified style group.

| Field | Type | Notes |
|-------|------|-------|
| `style_group_id` | `string` | UUID of the target style group |
| `images` | `object[]` | Array of `{ relative_path, filename, thumbnail_url }` |

Maximum 50 images per call.

---

## ColdLion Integration

ColdLion (`http://x5.coldlion.com/EhpApi`) is an external API used for merchandise group code lookups.

### `debug-coldlion-lookup`
Performs a test lookup against the ColdLion API and returns the raw response. Used for diagnosing integration issues.

| Field | Type | Notes |
|-------|------|-------|
| `mg_type` | `string` | MG category type |
| `division` | `string` | Division code |
| `search_code` | `string` | Code to search |

### `repair-invalid-property-names`
Scans assets and style_groups for property names that don't match the canonical values in the `properties` table and repairs them.

---

## Utility Operations

### `run-query`
Executes a read-only SELECT SQL query against the database. Useful for admin diagnostics. Non-SELECT statements are rejected.

| Field | Type | Notes |
|-------|------|-------|
| `sql` | `string` | SELECT statement to execute |

Returns: `{ rows: object[], count: number }`.

### `update-bulk-op`
Updates the state of a bulk operation in `admin_config.BULK_OPERATIONS`. Used by both the UI and `bulk-job-runner` to start, stop, and track operations.

| Field | Type | Notes |
|-------|------|-------|
| `op_key` | `string` | Operation key (e.g. `ai-tag-untagged`) |
| `op_state` | `object` | New state object (status, cursor, progress, etc.) |
| `only_if_status` | `string` (optional) | Optimistic lock: only write if current status matches |

Returns HTTP 409 if the operation conflicts with a currently running operation in the cross-lane conflict map (see `docs/BULK_JOBS.md`).

### `rebuild-character-stats`
Rebuilds usage counts and rankings for all characters in the `characters` table.

| Field | Type | Notes |
|-------|------|-------|
| `threshold` | `number` (optional) | Minimum asset count to include |

This operation computes `characters.usage_count` from `asset_characters` joined
to non-deleted assets. It also resets every character to `is_priority=false`,
then sets `is_priority=true` only for characters whose usage count is greater
than or equal to the threshold. `is_priority` therefore means "common enough to
show in compact prompts", not "valid/licensor-approved character".

### `get-latest-agent-build`
Returns the latest available version/tag for the specified agent type from GitHub Container Registry.

| Field | Type | Notes |
|-------|------|-------|
| `agent_type` | `string` | `bridge` or `windows-render` |

### `trigger-windows-update`
Sends an update trigger to one or all Windows Render Agents.

| Field | Type | Notes |
|-------|------|-------|
| `agent_id` | `string` (optional) | Target specific agent; omit for all |

### `purge-old-assets`
Soft-deletes assets whose `file_created_at` or `modified_at` falls before the cutoff date, and removes any style groups that become empty as a result.

| Field | Type | Notes |
|-------|------|-------|
| `cutoff_date` | `string` | ISO date string |
