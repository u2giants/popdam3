# PopDAM Windows Agent — Operator Runbook

This guide covers how to uninstall, reinstall, and verify the Windows Render Agent.
All commands must be run in **PowerShell as Administrator**.

---

## 1. Standard Uninstall (keeps config for reinstall)

Use this when you plan to reinstall immediately and want to keep your pairing code and settings.

```powershell
cd "C:\path\to\scripts\windows-agent"
.\uninstall-service.ps1 -KeepConfig
```

**What it removes:**
- Scheduled task
- Legacy service (if present)
- Install directory (`C:\Program Files\PopDAM\WindowsAgent`)
- Temp artifacts, shortcuts, registry entries

**What it keeps:**
- `%ProgramData%\PopDAM\agent-config.json` (your pairing code & settings)
- `%ProgramData%\PopDAM\logs\` (your log history)

---

## 2. Deep-Clean Uninstall (removes everything)

Use this when the agent is misbehaving after a reinstall, or you want a completely fresh start.

```powershell
cd "C:\path\to\scripts\windows-agent"
.\uninstall-service.ps1
```

That's it — deep-clean is the **default**. Everything PopDAM-related is removed:
- Scheduled task
- Legacy service
- Install directory
- Config, logs, and all settings
- Temp files left by rendering tools
- Start Menu shortcuts
- Add/Remove Programs entry

**After deep-clean, you will need to re-enter your pairing code during reinstall.**

### If files are locked

If the uninstall reports "LOCKED" items, it means the agent is still running:

1. Reboot the computer
2. Run the uninstall script again before logging in to PopDAM

---

## 3. Reinstall

### Option A: Using the installer (.exe)

1. Run the deep-clean uninstall first (see above)
2. Download the latest `popdam-windows-agent-setup.exe` from GitHub Releases
3. Run the installer as Administrator
4. Enter your server URL and pairing code when prompted
5. The installer will create the scheduled task and start the agent

### Option B: Manual install with scripts

1. Run the deep-clean uninstall first
2. Copy the new agent files to `C:\Program Files\PopDAM\WindowsAgent\`
3. Create your `.env` file or `agent-config.json` with your pairing code
4. Run the install script:

```powershell
.\install-scheduled-task.ps1
```

The install script automatically performs a **preflight scrub**:
- Removes any existing scheduled task
- Removes any legacy service
- Cleans stale temp files
- Recreates config/log directories

---

## 4. Post-Install Verification

After installing (or any time you want to check health):

```powershell
.\verify-agent.ps1
```

This checks and reports:
- **Scheduled task**: exists, running state, last result code, trigger configuration
- **Install directory**: all required files present, agent version
- **Config**: agent-config.json exists and has required keys
- **Logs**: last 20 lines of each log file
- **Legacy service**: warns if the old service is still registered

### What "Last Result" codes mean

| Code | Meaning |
|------|---------|
| 0 | Success — agent is running normally |
| 267009 | Task hasn't run yet — start it or log out/in |
| 1 | Generic error — check `agent-error.log` |
| 267014 | Task was stopped by a user |

---

## 5. Troubleshooting

### Agent won't start after reinstall
1. Run `.\verify-agent.ps1` to identify what's wrong
2. If "Last Result: 1", check `%ProgramData%\PopDAM\logs\agent-error.log`
3. Common causes:
   - Invalid or expired pairing code → get a new one from PopDAM Settings
   - NAS drive not mapped → check `drive-map.log`
   - Files locked from previous install → reboot, deep-clean, reinstall

### Agent keeps restarting (crash loop)
1. Stop the task: `Stop-ScheduledTask -TaskName "PopDAM Windows Render Agent"`
2. Check logs: `Get-Content "$env:ProgramData\PopDAM\logs\agent-error.log" -Tail 50`
3. Deep-clean and reinstall if needed

### Temp disk space filling up

The agent creates temp files in `%TEMP%` during rendering:

| Prefix | Source | Contents |
|--------|--------|----------|
| `popdam-gs-*` | Ghostscript | Intermediate PNG output |
| `popdam-ink-*` | Inkscape | Intermediate PNG output |
| `popdam-im-*` | ImageMagick | Intermediate JPEG output |
| `magick-*` | ImageMagick internal | Pixel buffer temp files |

Each renderer cleans up in a `finally` block normally. When the agent crashes or files are locked by Windows (antivirus, indexer), cleanup doesn't run. Over weeks this can accumulate tens of GB.

**Built-in janitor** (`janitor.ts`): runs at startup and every hour; only deletes items older than 24 hours with known prefixes; logs bytes freed.

If the janitor isn't keeping up or the disk is already full:

```powershell
.\cleanup-temp.ps1
```

This script stops the agent task, deletes all stale PopDAM/ImageMagick temp artifacts, truncates oversized log files (keeps last 1000 lines), restarts the agent, and prints before/after free disk space. Use `-StaleHours 0` to delete all matching temp files regardless of age.

**If you need to clean manually** (e.g., disk full before script can run), delete from `%TEMP%`:
- Directories starting with `popdam-gs-*`, `popdam-ink-*`, `popdam-im-*`
- Files starting with `magick-*`
- `%ProgramData%\PopDAM\logs\` — safe to delete entirely; agent recreates on start

**Do not** delete other files in `%TEMP%`.

---

## 6. Quick Reference

| Action | Command |
|--------|---------|
| Deep-clean uninstall | `.\uninstall-service.ps1` |
| Uninstall (keep config) | `.\uninstall-service.ps1 -KeepConfig` |
| Install | `.\install-scheduled-task.ps1` |
| Verify | `.\verify-agent.ps1` |
| Start agent now | `Start-ScheduledTask -TaskName "PopDAM Windows Render Agent"` |
| Stop agent | `Stop-ScheduledTask -TaskName "PopDAM Windows Render Agent"` |
| View error log | `Get-Content "$env:ProgramData\PopDAM\logs\agent-error.log" -Tail 50` |
| Clean temp files | `.\cleanup-temp.ps1` |

## 7. Self-update pointer (`WINDOWS_LATEST_BUILD`) — read this if the agent is stuck on an old version

The agent's self-updater (`apps/windows-agent/src/updater.ts`) checks on startup + every 10 min, compares its version to `admin_config.WINDOWS_LATEST_BUILD.version` (component-wise), downloads `download_url`, **verifies `checksum_sha256`**, hot-swaps `dist/`, and restarts. If that pointer is stale, the agent never updates even though publishes "succeed".

**2026-07-03 incident:** the pointer was frozen at `0.16.1.147` since the **2026-06-20 Virginia cutover**. `publish-windows-agent.yml` had notified the cloud via the `notify-build` edge function using `DEPLOY_WEBHOOK_KEY`, which wasn't set in the new project — and the step was `continue-on-error: true`, so it 401'd silently. Fixed by writing the pointer via **PostgREST + `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`** (same as `publish-bridge-agent.yml`) with `curl -sf` and no `continue-on-error`. Do **not** revive the `notify-build`/`DEPLOY_WEBHOOK_KEY` path — it is still unset in prod.

**Manually unblock a stuck agent** (upsert against prod `qsllyeztdwjgirsysgai`, not the decommissioned Ohio project):
```sql
insert into admin_config (key, value, updated_at) values ('WINDOWS_LATEST_BUILD', jsonb_build_object(
  'version','<new version>',
  'download_url','https://github.com/u2giants/popdam3/releases/download/windows-agent-latest/popdam-windows-agent-dist.zip',
  'installer_url','https://github.com/u2giants/popdam3/releases/download/windows-agent-latest/popdam-windows-agent-setup.exe',
  'checksum_sha256','<sha256 of that exact zip>',  -- REQUIRED to match, or the update aborts
  'commit_sha','<git sha>', 'published_at', now()::text), now())
on conflict (key) do update set value=excluded.value, updated_at=now();
```
Get the checksum by downloading the release zip and running `sha256sum`. The agent picks it up within ~10 min.

## 8. Compat-thumbnail audit (fix `.ai` warning-page thumbnails in bulk)

Some `.ai` thumbnails render Adobe's "saved without PDF Content" warning page instead of artwork (an earlier render used the PDF layer). **Settings → Windows Agent → "Audit AI Compat Thumbnails"** OCR-detected these — but as of 2026-07-03 it uses a **perceptual hash** (`compat-audit.ts`, `COMPAT_REF_HASHES`), because the old OCR looked for "compatibility" while the page says "Compatible" (flagged 0). The audit hashes every `.ai` thumbnail, clears the warning ones (`thumbnail_url=null`), and re-queues them for **native (Inkscape) render**, which recovers the real artwork. Triggers: `COMPAT_AUDIT_PREVIEW_REQUEST` (read-only report) and `COMPAT_AUDIT_REQUEST` (clear + re-render) in `admin_config`. A full ~46k scan takes ~8 min. **Do not** use the ".ai Sentinel Cleanup" delete flow for these — the files contain real artwork (see AGENTS.md `.ai` quirk).
