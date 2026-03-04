# DEPLOYMENT (DevOps Invisible)

Goal: You should never have to copy source code to the NAS or “build on Synology.”
The NAS runs prebuilt images like an appliance.

---

## 1) Bridge Agent Distribution (Non-Negotiable)
Publish the bridge agent as a pre-built Docker image to Docker Hub or GitHub Container Registry (docker pull ghcr.io/u2giants/popdam-bridge), so the entire heredoc section collapses down to just creating the .env file and a three-line docker-compose.yml. That removes the need to copy source code entirely.

Required tags:
- `latest`
- commit SHA tag (for rollback)

Optional:
- Watchtower for auto-updates

---

## 2) Synology Install (Target UX)
The target install should be:
1) Create `.env` (copy/paste)
2) Create minimal `docker-compose.yml`
3) Click “Deploy” in Synology Container Manager (Project)

No local builds on NAS.

---

## 3) CI/CD Requirement
On push to main:
- build bridge-agent image
- push to registry (latest + sha)
- publish release notes / changelog entry

---

## 4) Updating the Bridge Agent on Synology
Any time Lovable pushes changes to `apps/bridge-agent/`, GitHub Actions automatically builds a new Docker image and publishes it to `ghcr.io/u2giants/popdam-bridge:latest`.

To apply the update on the NAS, run the convenience script:

```bash
ssh admin@nas "bash /volume1/docker/popdam/update.sh"
```

Or copy `deploy/synology/update.sh` to the NAS and run it locally. The script pulls the latest image, restarts the container, and verifies the agent is running.

---

## 4) Secrets Handling
- Never commit secrets to git.
- `.env.example` is required for all components.
- Raw agent keys must never be stored in DB or returned by APIs.

---

## 5) Golden Rule: File Date Preservation
The Bridge Agent volume mount should be `:ro` (read-only) whenever possible. The agent must never modify file timestamps on source art. Before reading a file for hashing or thumbnailing, it must record original `mtime`/`birthtime` and restore them if changed. If restoration fails, the agent must halt and report a critical error. See PROJECT_BIBLE.md §15.

### 5.1) TIFF Compression Timestamp Preservation (Windows Agent)
The Windows Render Agent's TIFF optimizer preserves **three** timestamp categories:

1. **mtime** (modified time) — restored via `fs.utimes()`
2. **atime** (access time) — restored via `fs.utimes()`
3. **Windows CreationTime** — restored via PowerShell: `(Get-Item $path).CreationTimeUtc = <original>`

**Capture**: Before any file operation, all three timestamps are captured. CreationTime is read via PowerShell `Get-Item` for authoritative Windows metadata, with `stat().birthtime` as fallback.

**Restore**: After file swap (rename pattern), timestamps are restored with bounded retries (default 3 attempts, configurable via `TIFF_RESTORE_MAX_RETRIES`). Each attempt includes a small backoff.

**Verification**: After restoration, mtime and CreationTime are re-read and compared against originals within a configurable tolerance (`TIFF_TIMESTAMP_TOLERANCE_MS`, default 2000ms).

**Rollback semantics**:
- **Process mode**: If ANY timestamp verification fails after all retries, the compressed file is deleted and the original backup is renamed back. The job reports `success: false` with an explicit error code (`MTIME_RESTORE_FAILED`, `CREATION_RESTORE_FAILED`, `MTIME_VERIFY_FAILED`, `CREATION_VERIFY_FAILED`, or `ROLLBACK_FAILED`).
- **Test mode**: Same verification is enforced. If verification fails, the `_big` backup is restored as the original and the job reports failure (no false positive success).

**Config knobs** (via admin_config):
- `TIFF_TIMESTAMP_TOLERANCE_MS` — verification tolerance in ms (default: 2000)
- `TIFF_RESTORE_MAX_RETRIES` — max retry attempts for restore (default: 3)
- `TIFF_FAIL_ON_CREATION_RESTORE` — whether CreationTime restore failure is fatal (default: true)

