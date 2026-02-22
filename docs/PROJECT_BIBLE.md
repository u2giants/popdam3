SYSTEM OVERRIDE: PROJECT POPDAM V3

1. OPERATING MODEL: You are a Senior Systems Architect. You are building a professional-grade Hybrid Digital Asset Manager.
2. MODEL LOCK: Always use GPT-5.2 for reasoning. Speed is secondary to accuracy.
3. KNOWLEDGE HIERARCHY: > - For database/table questions, refer to docs/SCHEMA.md.

For path mapping or "0 files found" bugs, refer to docs/PATH_UTILS.md.

For connectivity or Tailscale questions, refer to docs/ARCHITECTURE.md.
4. NO GUESSING: If you are unsure about a NAS path mapping or a Tailscale configuration, ask the user for clarification. Do not "hallucinate" a fix that breaks the networking.
5. RECOVERY: If the project state becomes corrupted or illogical, stop and perform a "Codebase Audit" against the .md files in the knowledge base before proceeding.

# PROJECT_BIBLE.md — PopDAM V2 (Non-Negotiables)

This is the single highest-authority document for PopDAM V2.  
If anything conflicts with this file, **this file wins**.

---
## Golden Rule: Never Change File Timestamps (Hard Stop)
PopDAM must **never** permanently change a file’s timestamps (created/modified).  
Before **any** operation that touches a file (thumbnail extraction, metadata read/write, sidecar creation, etc.), the worker must record the file’s original timestamps (mtime + birthtime/ctime where available). After the operation, the worker must verify timestamps are unchanged and, if the OS altered them, **restore them to the original values**.

If the worker cannot restore timestamps exactly, it must **STOP processing new files immediately** and report a critical error indicating which file(s) had modified timestamps and what changed.

## 0) Mission
Build **PopDAM** — a Digital Asset Manager for licensed consumer-product art (Disney/Marvel/etc.). Source design files (`.psd`, `.ai`) live on a **Synology NAS**. The system must reliably:

- scan & ingest files
- generate thumbnails (with fallbacks)
- upload thumbnails to **DigitalOcean Spaces**
- let users browse/search/filter/tag assets in a **dark-mode web app**
- avoid past failure modes: **config drift**, **silent scan failures**, **hard-coded paths**, **type drift**, **pagination bugs**, and "fix-on-fix" instability.

---

## 1) Architecture (Brain + Muscle)
### A) Brain = Cloud Web App + Cloud API
- UI for browsing/search/filter/tagging
- authentication & roles (invitation-only)
- admin config + monitoring + diagnostics
- AI tagging (cloud calls model using thumbnail URLs)
## Bridge Agent Scope + NAS Protection (Non-negotiable)
The Synology Bridge Agent is a minimal "appliance." It exists only to do the work that must be local to the NAS: **scan → read filesystem timestamps → quick-hash → thumbnail → upload to DigitalOcean Spaces → report to cloud API**. It must not host UI/DB, must not implement business logic, and must not transfer full PSD/AI files to the cloud. The cloud never reaches into the NAS (outbound polling only). The worker must be resource-bounded (CPU/memory limits + low concurrency). **Authoritative details are in `docs/WORKER_LOGIC.md` and must be followed exactly.**

### B) Muscle = Bridge Agent (Synology Docker "appliance")
- scans the NAS filesystem locally
- reads filesystem timestamps from disk (`mtime` + `birthtime` when available)
- computes **quick hash** for move detection
- generates thumbnails
- uploads thumbnails to DigitalOcean Spaces
- calls **agent-api** to ingest/update/move and report progress
- persists scan state incrementally (see scanning rules)

### C) Optional Muscle #2 = Windows Render Agent (Illustrator)
Only for `.ai` files that can't be thumbnailed reliably on NAS:
- claims render jobs
- renders via Illustrator ExtendScript API
- uploads to Spaces
- reports completion via agent-api

---

## 2) Networking Model (No inbound NAS dependencies)
Hard rule: The cloud does **not** reach into the NAS over IP.  
The NAS worker **polls outward** (HTTPS) to claim work and report status.

This avoids fragile "cloud → private network" requirements and keeps DevOps simpler.

---

## 3) Path Canonicalization (Eliminate Path Bugs Forever)
### Canonical DB Path
**Store only** `assets.relative_path`:
- POSIX style (`/`)
- no leading slash
- no trailing slash
- example: `Decor/Projects/Foo/bar.psd`

### Display/Conversion (derived from config)
Given `relative_path`, derive:
- Office UNC by name: `\\NAS_HOST\NAS_SHARE\...`
- Office UNC by IP: `\\NAS_IP\NAS_SHARE\...`
- Remote Synology Drive: `{USER_SYNC_ROOT}\NAS_SHARE\...`

**No hard-coded host/share strings anywhere in code.**  
All mapping comes from config (admin_config / env) and the shared path-utils library.

See: `docs/PATH_UTILS.md`.

---

## 4) Auth Boundaries (Critical)
There must be **two separate APIs** (or edge functions):

### agent-api
- `verify_jwt = false`
- Auth: `x-agent-key`
- Only agent routes
- Zod validation required for every request/response

### admin-api
- `verify_jwt = true`
- Auth: user JWT + admin role
- Only admin routes (config, invites, doctor)
- Zod validation required for every request/response

Hard rule: **Never mix admin routes with agent routes in one function.**

---

## 5) Security (No "remote shell" footguns)
Hard rule: **No endpoint accepts arbitrary shell commands** or user-provided command strings.

If Docker management exists:
- strict allowlist of fixed operations (restart logs etc.)
- fixed directories only (no arbitrary paths)
- no arbitrary arguments

---

## 6) Storage Rule (Thumbnails)
- **Do NOT use Supabase Storage**
- Thumbnails are uploaded by the Bridge Agent to **DigitalOcean Spaces**
- DB stores a full public URL in `assets.thumbnail_url`

Example:
`https://popdam.nyc3.digitaloceanspaces.com/thumbnails/{asset_id}.jpg`

---

## 7) Dates + Visibility Logic (Non-Negotiable)
Two independent dates:
- `SCAN_MIN_DATE` default `2010-01-01`
- `THUMBNAIL_MIN_DATE` default `2020-01-01`

Ingest all files that match `SCAN_MIN_DATE` into DB (metadata tracking).

UI visibility uses centralized logic:
Visible if ANY is true:
- `file_created_at >= THUMBNAIL_MIN_DATE`
- `modified_at >= THUMBNAIL_MIN_DATE`
- `thumbnail_url IS NOT NULL`

Important:
- `modified_at` and `file_created_at` must come from filesystem timestamps.
- `assets.modified_at` is **NOT NULL** and has **NO DEFAULT** (agent must supply it).

---

## 8) Scanner Reliability Rules (No Silent "Success")
Bridge Agent must:
- `stat()` every configured scan root at startup
- if any root missing / not a directory:
  - log a loud error
  - increment counters
  - refuse to scan (fail fast)

Never swallow ENOENT/EACCES silently.

If a scan reports `files_checked = 0`, treat as an **error** unless roots were validated and truly empty.

UI must show these counters prominently:
- roots_invalid, roots_unreadable
- dirs_skipped_permission
- files_stat_failed
- files_checked, candidates_found, ingested_new, moved_detected, updated_existing, errors

Also: UI must label counts correctly ("files checked" vs "assets ingested").

---

## 9) Quick Hash + Move Detection
Quick hash is not a full file hash:
- first 64KB + last 64KB + file size (optionally include mtime), hashed together
Store:
- `assets.quick_hash`
- `assets.quick_hash_version`

Move detection:
- same quick_hash + different relative_path → treat as **move**
- preserve tags/metadata
- write to `asset_path_history`

---

## 10) Pagination + Performance
- Never fetch all assets into memory.
- All filtering/searching must be server-side queries or DB functions.
- Supabase default row limits must not break pagination.
- All counts and lists must share the same visibility logic.

---

## 11) Invitation-Only Auth (Must)
Create `handle_new_user()` trigger:
- checks invitations for email
- creates profiles + user_roles
- marks invitation accepted
- rejects signup if not invited

---

## 12) Docs-as-Contracts (Anti-Drift)
The following docs are authoritative appendices:
- `docs/SCHEMA.md` — tables, constraints, indexes, RLS
- `docs/API_CONTRACTS.md` — endpoints + payloads + errors
- `docs/PATH_UTILS.md` — parsing + normalization + conversions
- `docs/DEPLOYMENT.md` — how this runs in reality

If code changes schema or API shape, it must update the corresponding doc in the same commit.

---

## 13) Deployment Rule (DevOps Invisible)
Bridge Agent must be distributed as a **pre-built Docker image**:
- Docker Hub or GitHub Container Registry
- example: `docker pull ghcr.io/u2giants/popdam-bridge:latest`

Goal: Synology setup is only:
1) create `.env`
2) create a minimal `docker-compose.yml`
3) deploy via Synology Container Manager

No copying source code to NAS; no building on NAS.

---

## 14) "No Fix-on-Fix" Development Rule
When implementing changes:
- make small diffs
- show what changed
- run checks/tests you claim were run
- if the same bug persists after two attempts: stop, re-read this doc + relevant appendices, and propose a different approach

---

## 15) Golden Rule: File Date Preservation (Non-Negotiable)
**This DAM must NEVER modify the created or modified date of any source file on the NAS.**

The Bridge Agent operates in **read-only** mode against source art. If any operation (thumbnail generation, hashing, scanning) causes the OS to update a file's `mtime` or `birthtime`:

1. **Record the original timestamps** (via `stat()`) **before** touching the file.
2. **Restore the original timestamps** (via `utimes()`) **immediately after**.
3. If restoration fails:
   - **STOP all processing** (do not continue to the next file).
   - Report a **critical error** to the cloud API with details: which file, what the timestamps were before/after, and why restoration failed.
   - The agent must remain stopped until an admin acknowledges/resolves the issue.

This rule exists because design teams rely on file dates for version tracking, audit trails, and licensor compliance. A DAM that silently alters file dates is worse than no DAM at all.
