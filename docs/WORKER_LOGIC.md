# WORKER LOGIC (Bridge Agent on Synology) — The “Muscle” Contract

This document defines what the Synology Bridge Agent MUST do and MUST NOT do.
Primary goal: keep the NAS workload bounded and prevent silent failures.

The Bridge Agent exists to do the work that is cheapest/fastest **only when done locally**:
touching huge PSD/AI files and producing thumbnails near the storage.

---

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

### 3.2 Checkpoint Rule
- The worker MUST NOT advance its “last scanned” checkpoint unless the Cloud API acknowledges ingest success.
- If ingest fails mid-batch, the worker must retry and/or stop, but never “skip ahead.”
- Checkpointing is allowed:
  - after each successfully acknowledged batch, OR
  - after every N files (N default 100) as long as each file was successfully acknowledged.

---

## 4) Filesystem Scanning Rules (No Silent Failures)

### 4.1 Fail-Fast Root Validation
At startup:
- `stat()` every configured scan root.
- If any root is missing, not a directory, or not readable:
  - log a loud error
  - increment `roots_invalid` / `roots_unreadable`
  - refuse to scan (exit non-zero or mark scan failed)

### 4.2 Symlink Prevention
- The scanner MUST NOT follow symbolic links.

### 4.3 “0 Files Checked” is an Error
If a scan completes with `files_checked = 0`, treat it as a failure unless:
- roots were validated OK AND
- the directories truly contain zero files.

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

## 9) Golden Rule: File Date Preservation (Non-Negotiable)
**The Bridge Agent must NEVER modify the created or modified date of any source file.**

Before any file operation (read for hashing, read for thumbnailing):
1. `stat()` the file and record `mtime` + `birthtime`.
2. After the operation, `stat()` again.
3. If timestamps changed, immediately restore them via `utimes()`.
4. If restoration fails: **STOP processing**, report a critical error to the cloud API, and refuse to process further files until an admin resolves the issue.

This is a hard stop — not a warning. File dates are sacred for licensor compliance and version tracking.