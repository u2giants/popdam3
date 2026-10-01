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

## 9. Moving the agent to another machine (lessons from edge-alien → edge-dev, 2026-10-01)

The agent was moved from **edge-alien** to **edge-dev** on 2026-10-01 so edge-alien could be reformatted. It is due to move back to edge-alien on a fresh Windows install. Every problem hit on the first move is listed here with the fix, so the move back is quick.

### Order that worked

1. Install the five tools on the new machine (below).
2. Create a pairing code (below), keeping the agent name `windows-render-agent`.
3. Stop **and disable** the agent on the old machine.
4. Install the agent on the new machine, then start it.
5. Check that the NAS maps, then queue one test job and confirm `render_queue.claimed_by` is the new agent and `status=completed`.

Only one machine should run the agent at a time. Pairing uses the same agent name (`windows-render-agent`). The pair route upserts on `agent_name`, so the new pairing replaces the old machine's key and keeps the same `agent_registrations.id`. The old machine then fails to authenticate. That is expected, but stop it first anyway so it doesn't keep retrying.

### Problems hit, and what to do

| # | Problem | Cause | Do this next time |
|---|---------|-------|-------------------|
| 1 | `winget install ArtifexSoftware.GhostScript` reports "No package found" | Ghostscript is not in winget | Download `gs*w64.exe` from the GitHub releases of `ArtifexSoftware/ghostpdl-downloads` and run it with `/S`. It installs to `C:\Program Files\gs\gs<ver>\bin\gswin64c.exe`. |
| 2 | The agent logs "Poppler not found" | The winget Poppler package (`oschwartz10612.Poppler`) puts `pdftoppm.exe` under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-<ver>\Library\bin\`, a folder the agent does not search | Add `POPPLER_PATH=<full path to pdftoppm.exe>` to the install-dir `.env`. Note that this path is per-user. |
| 3 | Writes to `C:\Program Files\PopDAM` are denied | The Claude session is not elevated | Run each admin step as a script through `Start-Process pwsh -Verb RunAs -Wait`. Every run shows a UAC prompt that someone at the console has to accept. One prompt was cancelled; retrying worked. Batch the admin steps into as few scripts as possible. |
| 4 | `install-scheduled-task.ps1` fails with a parse error ("string is missing the terminator") | The file is UTF-8 without a BOM and contains box and em-dash characters, which Windows PowerShell 5.1 misreads | Run it with **pwsh 7**, not `powershell.exe`. |
| 5 | The agent crashes at start with `Cannot find module '@popdam/path-filters'` | A manual install copied `package.json` and ran `npm ci`. The `file:../../packages/path-filters` dependency became a junction pointing to `C:\Program Files\packages\path-filters`, which does not exist. | Build `packages/path-filters` in a scratch copy (`npm i typescript@5`, then `tsc`). Delete the junction and copy `package.json` plus `dist\` into `node_modules\@popdam\path-filters`. **Better:** use the release installer `popdam-windows-agent-setup.exe`, which bundles it. The installer is GUI-only (its NSIS custom page asks for the server URL and pairing code). |
| 6 | `npm` fails with `EEXIST ... _cacache\tmp` | The local npm cache was corrupt or in use | Pass `--cache <scratch folder>`. |
| 7 | The scheduled task shows result **255** and "Ready" after the first start | On first run the agent self-updated from 0.16.4 to the release build. The swap restart ended that first run. | Start the task again. The second start stayed up (result 267009 while running). Check the heartbeat in `agent_registrations`, not the process list. A non-elevated shell cannot see the elevated `node.exe` command line. |
| 8 | The NAS map fails with `System error 86` (wrong password) on both Z: and Y: | `admin_config.WINDOWS_AGENT_NAS_USER/PASS` still held an old pre-rotation login. The NAS passwords had been rotated that day. | Use the current NAS service-account login from 1Password (`vibe_coding` vault). First test it with `net use` against the main share from the new machine, then update `WINDOWS_AGENT_NAS_USER`, `WINDOWS_AGENT_NAS_PASS` and `WINDOWS_AGENT_SG_NAS_PASS` in `admin_config`. The agent picks them up on its next heartbeat. |
| 9 | SSH commands to edge-alien broke on quoting | The remote shell is Windows PowerShell, so `&` and `\"` get mangled | Send scripts with `powershell -NoProfile -EncodedCommand <base64 UTF-16>`. |
| 10 | `Get-ScheduledTask` over SSH found no PopDAM task, although `schtasks /query` did | Quoting and filtering differences in the SSH session | Use `schtasks /end` and `schtasks /change /disable` with `/tn 'PopDAM Windows Render Agent'` inside an encoded script. Then kill any leftover `node.exe` under `C:\Program Files\PopDAM` and the `popdam-launcher` `cmd` process. |
| 11 | A long log grep over SSH on edge-alien hung for more than 120 s | Large log files read over SSH | Use `-Tail` on the logs. Don't run `Select-String` over whole log files remotely. |
| 12 | The agent's cmd window floods with JSON logs it never showed on edge-alien | The release installer's launcher redirects stdout/stderr to `%ProgramData%\PopDAM\logs\agent.log` and `agent-error.log`. The manual-install `scripts/windows-agent/popdam-launcher.bat` used to print to the console instead. | Use the fixed launcher (redirects like the installer), or prefer `popdam-windows-agent-setup.exe`. The visible window is normal for the interactive task; it should stay almost empty. |

### Pairing code without the UI

Insert a row into `agent_pairings` (application row data, not a schema change) with the production service-role key from 1Password. Use the fields `pairing_code` (format `XXXX-XXXX-XXXX-XXXX` from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), `agent_type='windows-render'`, `agent_name='windows-render-agent'`, `status='pending'` and `expires_at`. Write the code straight into the install-dir `.env` as `POPDAM_PAIRING_CODE`, next to `SUPABASE_URL=https://qsllyeztdwjgirsysgai.supabase.co` and `AGENT_NAME=windows-render-agent`. Never print the code in chat. After pairing, the code is removed from config and `agent_key` is saved to `%ProgramData%\PopDAM\agent-config.json`.

### Do not

- Don't install Illustrator. It is not used.
- Don't pair under a new agent name unless you mean to keep two agents. A second name creates a second registration.
- Don't leave the old machine's task enabled. It restarts at logon.
- Don't run `install-scheduled-task.ps1` with Windows PowerShell 5.1.
- Don't trust `admin_config` NAS credentials without testing them first with `net use`.

### Moving back to edge-alien (fresh Windows)

1. On edge-alien, install the tools: winget `Inkscape.Inkscape`, `ImageMagick.ImageMagick`, `oschwartz10612.Poppler` and `UB-Mannheim.TesseractOCR`, plus Ghostscript from Artifex. Also install Node and pwsh 7.
2. Enable OpenSSH Server so the next session can reach it.
3. On edge-dev, run `schtasks /end` and `/change /disable` for the task.
4. Pair edge-alien, preferably with the release installer, so problem 5 doesn't happen. Then test the NAS and queue a test job (steps 2–5 of "Order that worked").

## 8. Compat-thumbnail audit (fix `.ai` warning-page thumbnails in bulk)

Some `.ai` thumbnails render Adobe's "saved without PDF Content" warning page instead of artwork (an earlier render used the PDF layer). **Settings → Windows Agent → "Audit AI Compat Thumbnails"** OCR-detected these — but as of 2026-07-03 it uses a **perceptual hash** (`compat-audit.ts`, `COMPAT_REF_HASHES`), because the old OCR looked for "compatibility" while the page says "Compatible" (flagged 0). The audit hashes every `.ai` thumbnail, clears the warning ones (`thumbnail_url=null`), and re-queues them for **native (Inkscape) render**, which recovers the real artwork. Triggers: `COMPAT_AUDIT_PREVIEW_REQUEST` (read-only report) and `COMPAT_AUDIT_REQUEST` (clear + re-render) in `admin_config`. A full ~46k scan takes ~8 min. **Do not** use the ".ai Sentinel Cleanup" delete flow for these — the files contain real artwork (see AGENTS.md `.ai` quirk).
