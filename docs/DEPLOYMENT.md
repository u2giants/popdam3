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

## 3) CI/CD — Bridge Agent Image Tags
On push to `main` when `apps/bridge-agent/**` changes, `publish-bridge-agent.yml` builds and pushes three tags:

| Tag | Use |
|-----|-----|
| `:latest` | What `docker compose pull` gets by default |
| `:stable` | What the in-app self-update pulls (same commit, explicit tag) |
| `:v{version}` | Pinned rollback target (e.g. `:v1.9.6`) |

Version is tracked in `apps/bridge-agent/package.json`. Bump it in the same commit as your changes (patch for bug fixes, minor for features, major for breaking changes). After publishing, `BRIDGE_LATEST_BUILD` is written to `admin_config` so the admin UI can show the new version and offer an update.

---

## 4) Updating the Bridge Agent on Synology

### Primary path — remote update via admin UI

Settings → Agents (Bridge) → Update button. The UI calls `apply-update` on admin-api, which sets an `UPDATE_REQUEST` key in `admin_config`. The bridge agent picks this up on its next heartbeat, pulls `:stable`, and recreates its own container using the Docker socket. No SSH required.

**Requires**: `restart: unless-stopped` in docker-compose.yml **and** `/var/run/docker.sock:/var/run/docker.sock` mounted. Both are set in the reference `deploy/synology/docker-compose.yml`.

### Fallback — manual pull on the NAS

If the remote update fails or the container is dead:

```bash
sudo docker compose pull && sudo docker compose down && sudo docker compose up -d
```

Run this in the directory containing your `docker-compose.yml` (typically `/volume1/docker/popdam/`). After the container starts, wait ~30 seconds for the first heartbeat before checking the version in the admin UI.

---

## 5) POP DAM Helper — Build and Distribution

The Helper is an Electron desktop app built with electron-vite and packaged by electron-builder. It is distributed via GitHub Releases, not via any app store.

### CI build

Triggered by `publish-popdam-helper.yml` on every push to `main` that touches `apps/popdam-helper/**`.

Two parallel jobs:
- **Build Mac** (`macos-latest`): produces `POP-DAM-Helper-Mac-arm64.dmg` and `POP-DAM-Helper-Mac-x64.dmg`
- **Build Windows** (`windows-latest`): produces `POP-DAM-Helper-Windows-Setup.exe` (x64 only)

Both jobs run `npm run build` (electron-vite) then `electron-builder`. Code signing is disabled in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `SKIP_NOTARIZATION=true`). The artifacts are uploaded to the GitHub Release tagged `popdam-helper-latest`.

The Windows job caches `%APPDATA%\Local\electron\Cache` to avoid re-downloading the Electron binary on every run (~150 MB). Building ia32 on a 64-bit runner causes the Electron binary download to be incomplete (`ffmpeg.dll` is missing from the ia32 archive), so only x64 is built.

### Auto-update

**Not yet implemented.** The `publish` block in `electron-builder.yml` is present for future use. Auto-update via `electron-updater` requires a code-signed build:
- **macOS**: Apple Developer account ($99/yr); notarization is free via `notarytool`.
- **Windows**: OV code signing certificate (≈$60–$150/yr, e.g. Certum). Without it, SmartScreen shows a warning on every install including auto-updates. EV certificate (≈$300–$500/yr) removes the SmartScreen warning immediately.

Until signing is in place, users must manually download and reinstall from GitHub Releases to update.

### Local development

```bash
cd apps/popdam-helper
npm install
npm run dev        # electron-vite dev server + Electron
npm run typecheck  # tsc on both main (node) and renderer (web) tsconfigs
```

The main process tsconfig is `tsconfig.node.json`; the renderer is `tsconfig.web.json`. They are self-contained (no `extends`) to avoid CI issues with missing `@electron-toolkit/tsconfig` devDep resolution order.

### Installing for end users

1. Download the installer from GitHub Releases → `popdam-helper-latest`.
2. Run the `.exe` (Windows) or `.dmg` (macOS).
3. On first launch (no root mappings configured yet), the Helper automatically opens the Settings panel. Configure the DAM URL, local workspace folder, and at least one NAS root mapping.
4. The `popdam://` protocol is registered with the OS automatically by the installer (NSIS / macOS plist).

---

## 6) Secrets Handling
- Never commit secrets to git.
- `.env.example` is required for all components.
- Raw agent keys must never be stored in DB or returned by APIs.

---

## 6) Golden Rule: File Date Preservation
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

