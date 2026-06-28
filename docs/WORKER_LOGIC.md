# WORKER LOGIC (Bridge Agent on Synology) — The “Muscle” Contract

This document defines what the Synology Bridge Agent MUST do and MUST NOT do.
Primary goal: keep the NAS workload bounded and prevent silent failures.

The Bridge Agent exists to do the work that is cheapest/fastest **only when done locally**:
touching huge PSD/AI files and producing thumbnails near the storage.

---
## Golden Rule: Timestamp Preservation (Stop-The-World)
The Bridge Agent must never leave a file with modified timestamps due to processing.

### Required behavior
1) **Before touching a file**, record:
   - `mtime` (modified time)
   - `birthtime` when available
   - and any other filesystem creation timestamp the OS exposes (platform-dependent)

2) Perform the operation (thumbnailing, metadata writes, sidecar files, etc.).

3) **Immediately re-stat the file** and compare timestamps to the originals.

4) If any timestamp changed:
   - attempt to restore the original timestamps exactly (save + restore)
   - re-stat and verify restoration succeeded

### Hard stop rule
If restoration fails for any file:
- set worker state to **CRITICAL_ERROR_TIMESTAMP_MUTATION**
- **stop processing new files** (do not continue scanning/thumbnailing)
- emit a critical error report to the cloud with:
  - file path (relative_path)
  - original timestamps
  - observed timestamps after mutation
  - whether restoration succeeded/failed
 
  - 
## 1) Scope Fence (What Runs Where)

### 1.1 The Bridge Agent MUST do
- Scan configured NAS roots on disk (no cloud filesystem access)
- Read filesystem timestamps from disk: `mtime` and `birthtime` (when available)
- Compute quick hash (first 64KB + last 64KB + file size, hashed)
- Generate thumbnails for PSD/AI using the fallback strategies below
- Upload thumbnails to DigitalOcean Spaces (S3-compatible)
- Call the Cloud agent-api to ingest/update/move assets and report progress + counters
- Persist scan state safely to resume after crashes

### 1.2 The Bridge Agent MUST NOT do
- MUST NOT run the web UI
- MUST NOT host the database
- MUST NOT implement search/filter/count logic (that belongs in the cloud DB)
- MUST NOT do AI tagging inference locally (unless explicitly added as a future phase)
- MUST NOT require inbound networking from the cloud into the NAS
- MUST NOT transfer full PSD/AI files to the cloud

---

## 2) NAS Load Control (Hard Limits)

### 2.1 Concurrency
- Default thumbnail concurrency: **2**
- Must be configurable via env: `THUMB_CONCURRENCY` (default 2)
- For very large files or on busy NAS: allow setting it to 1

### 2.2 Resource Limits
The deployment MUST support container-level limits (Synology Container Manager / docker-compose):
- **cpu_shares** (not `cpus`/NanoCPUs — Synology kernel doesn't support CFS NanoCPUs):
  - 256 shares ≈ 20% priority
  - 1024 shares = default
  - 8192 shares ≈ 80% priority
- Memory limit via `mem_limit` (example target: 1–2 GB)
- Low process priority (nice/priority) where supported

These are not optional “nice to have” — they are required to avoid the worker starving other NAS workloads.

### 2.3 Scheduling / Scan Modes
The worker supports two scan modes:
- **Manual trigger** (admin requests scan)
- **Scheduled scan** (optional, off by default)

If scheduled scans exist, they must be configurable and throttle-friendly.
Tunable Resource Guard (User-Defined Scheduling)

Custom Percentages: The agent must respect exact CPU and Memory percentage caps set by the user in the Admin Panel (e.g., "Limit to 35% CPU").

Flexible Scheduling: The Admin UI must allow the user to define custom time blocks and days for different performance tiers (e.g., "Monday-Friday, 9:00 AM to 6:00 PM: 15% CPU limit").

Real-Time Throttling: The agent must check these settings via the heartbeat response and immediately adjust its thread count or processing speed to stay under the active limit.

Memory Hard Limit: A user-set cap (e.g., 1GB) must be respected; if a file exceeds this, the worker must abort and flag it for the Windows Render Agent.
---

## 3) Batch Processing & Checkpointing (Crash-Safe)

### 3.1 Batch Size
- Default batch size: **100 files**
- Configurable env: `INGEST_BATCH_SIZE` (default 100)

### 3.2 Scan Phases
The Bridge Agent scan is intentionally split into two phases:

1. **Discovery phase** — validate roots, walk the filesystem, stat candidate files, and collect candidate metadata in memory.
2. **Ingest phase** — call `check-changed`, hash/process only changed/new/retry files, generate/upload thumbnails, and call `ingest`.

This is required because duplicate-copy move detection needs scan-wide context. The bridge seeds a per-scan `(quick_hash, filename)` seen set from `check-changed.existing_content_identities`; if a later changed/new file has the same identity, it sends `skip_move_detection=true` so the cloud creates/updates the path-specific row instead of stealing a sibling asset row.

Because discovery materializes the full candidate list, memory use scales with candidate count. The bridge logs `Scan memory checkpoint` records at scan start, discovery completion, `check-changed` preflight, and ingest completion. Monitor `max_rss_mb` from real-world scans before changing this flow; if peak RSS approaches the lowest shipped memory cap, prefer either storing only minimal candidate fields or a two-pass streaming scan that trades memory for a second metadata walk.

### 3.3 Checkpoint Rule
- Checkpoints are for **discovery-phase resume only**.
- A checkpoint may record the last completed top-level directory while walking the filesystem.
- A new scan MUST NOT resume from a checkpoint saved by a different `session_id`; discard it and start fresh.
- Before ingest starts, the bridge MUST clear the checkpoint. If clearing fails after retry, the scan MUST fail instead of ingesting after a checkpoint that could cause the next run to skip already-discovered-but-not-ingested paths.
- Once ingest begins, a crash/restart should restart discovery from the beginning, then `check-changed` will skip unchanged rows safely.
- If ingest fails mid-run, stop or retry; never mark the scan successful with skipped changed files.

---

## 4) Filesystem Scanning Rules (No Silent Failures)

### 4.1 Fail-Fast Root Validation
At startup:
- `stat()` every configured scan root.
- If any root is missing, not a directory, or not readable:
  - log a loud error
  - increment `roots_invalid` / `roots_unreadable`
  - refuse to scan (exit non-zero or mark scan failed)
  - report a specific failure message through `scan-progress.error` / `SCAN_REQUEST.error`; a terminal failed scan with no diagnostic text is not an acceptable final state.

### 4.2 Symlink Prevention
- The scanner MUST NOT follow symbolic links.

### 4.3 “0 Files Checked” is an Error
If a scan completes with `files_checked = 0`, treat it as a failure unless:
- roots were validated OK AND
- the directories truly contain zero files.

When reporting this failure, include the likely configuration causes in the error text: `SCAN_ROOTS`, `SCAN_ALLOWED_SUBFOLDERS`, and `SCAN_MIN_DATE`.

### 4.4 `quick_hash` Is a Move Hint, Not a Unique Content Key
`quick_hash` is `SHA-256(first 64KB + last 64KB + file size)`. It is intentionally cheap and sampled. It can collide for different template-derived files and is identical for byte-identical duplicate copies.

Bridge Agent requirements:
- Call `check-changed` across the collected scan candidates before ingesting files.
- Seed a scan-wide `(quick_hash, filename)` seen set from `existing_content_identities`.
- Compute `quick_hash` only for files that need processing.
- If the same `(quick_hash, filename)` has already been seen in the current scan, send `skip_move_detection=true` in the ingest payload.

Cloud/API requirements:
- Never dedupe or move by `quick_hash` alone.
- Move detection requires: nonzero file size, no existing row at the incoming path, no bridge skip flag, and exactly one non-deleted candidate with the same `(quick_hash, filename)` at a different path.
- Ambiguous same-hash/same-name candidates must fall through to create/update by path, not flip a shared asset row.

This guard was added in bridge v1.16.2 and the matching `agent-api` after duplicate copies caused asset rows to "flip-flap" between paths and bloated `asset_path_history`. See `docs/KNOWN_QUIRKS.md` #51.

---

## 5) Thumbnail Generation Strategy

### 5.1 PSD Thumbnail Fallback Chain
PSD files may be multi-gigabyte; avoid loading the entire file into memory.

Preferred order:
1) **Embedded composite preview**: extract the precomputed preview image stored inside the PSD (via a PSD parser library).
2) **Chunked/tiled reading**: if no preview exists, use a library/approach that reads in tiles/blocks to limit RAM use.
3) **Last resort rendering**: ImageMagick/Ghostscript or similar (if applicable).
4) If all fail: set `thumbnail_error = "no_preview_or_render_failed"` and queue for Windows Render Agent if enabled.

### 5.2 AI Thumbnail Strategy (NAS-side)
If `.ai` thumbnailing fails due to PDF-compat issues:
- set `thumbnail_error = "no_pdf_compat"`
- queue render job for Windows agent (if enabled)

---

## 6) Upload Requirements (DigitalOcean Spaces)

### 6.1 Cache Headers
All thumbnails uploaded to Spaces MUST include:
- `Cache-Control: public, max-age=31536000, immutable`

### 6.2 URLs
The UI must always use the CDN-backed URL stored in the DB (`assets.thumbnail_url`).

The worker never uploads to Supabase Storage.

---

## 7) Heartbeat & Health

### 7.1 Heartbeat Interval
- Worker sends heartbeat every **30 seconds**
- Heartbeat must run on its own timer and not be blocked by scanning or thumbnailing.

### 7.2 Offline Rule
If the cloud misses 3 heartbeats, it marks the worker Offline in the UI.

---

## 8) Polling Behavior (Outward-Only)
- The Bridge Agent polls outward to the cloud (HTTPS) to learn if work is requested.
- Poll intervals:
  - idle: 30–60 seconds
  - when scan requested / active: 2–5 seconds

---

## 10) PDF Text Extraction Pipeline

Both the Bridge Agent (`apps/bridge-agent/src/pdf-text-sampler.ts`) and the Windows Render Agent (`apps/windows-agent/src/pdf-text-sampler.ts`) implement an identical cascade for sampling text from PDF assets.

### Trigger

The cloud sends a `claim-pdf-text-sample` response (via heartbeat). The agent claims it, processes all listed assets, and calls `complete-pdf-text-sample` when done. Only one agent runs a given sample at a time — the first to claim wins.

### Per-file cascade

| Step | Method | Success threshold | On failure |
|------|--------|-------------------|------------|
| 1 | **mupdf text extraction** — structured-text parser | ≥ 100 chars | fall through |
| 2 | **Render page 0 to PNG** — mupdf pixmap at 2× scale | PNG produced | skip steps 3–4 |
| 3 | **OCR via tesseract.js** — English language model | ≥ 100 chars | fall through |
| 4 | **AI vision** — OpenRouter (configurable model, default `google/gemini-2.0-flash-001`) or direct Gemini/Anthropic API | any text returned | mark as `likely_scanned` or `failed` |

If step 2 succeeds (PNG rendered), a **thumbnail is uploaded to DigitalOcean Spaces** under `pdf-pages/{assetId}_p0.jpg` via `uploadPdfPage()`. The URL is stored in `pdf_text_samples.thumbnail_url` and shown in the UI as a preview for scanned/placeholder PDFs.

### File size guard

Files > **100 MB** are skipped (`extraction_method = "skipped"`) without loading into memory. The limit is `PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024`.

### Results upload

All results are sent to the edge function in a single call to `bulk_insert_pdf_text_samples(p_rows jsonb)` — a PostgreSQL RPC that bypasses the per-row `trg_pdf_text_samples_parse_files` trigger during the bulk INSERT, then calls `parse_pdf_files_used()` once per unique asset_id. This avoids the statement timeout that would occur if the trigger ran 25 times within one request. See quirk #40 in [docs/KNOWN_QUIRKS.md](KNOWN_QUIRKS.md).

### Extraction methods recorded

| `extraction_method` | Meaning |
|---------------------|---------|
| `pdf_text` | mupdf yielded ≥ 100 chars |
| `ocr_text` | tesseract yielded ≥ 100 chars |
| `ai_vision` | AI returned any text |
| `likely_scanned` | Cascade exhausted; < 100 chars found |
| `failed` | Cascade exhausted; 0 chars found |
| `skipped` | File > 100 MB size limit |

---

## 9) Golden Rule: File Date Preservation (Non-Negotiable)
**The Bridge Agent must NEVER modify the created or modified date of any source file.**

Before any file operation (read for hashing, read for thumbnailing):
1. `stat()` the file and record `mtime` + `birthtime`.
2. After the operation, `stat()` again.
3. If timestamps changed, immediately restore them via `utimes()`.
4. If restoration fails: **STOP processing**, report a critical error to the cloud API, and refuse to process further files until an admin resolves the issue.

This is a hard stop — not a warning. File dates are sacred for licensor compliance and version tracking.
