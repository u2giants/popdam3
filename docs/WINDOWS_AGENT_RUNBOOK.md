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
The agent has a built-in janitor that cleans temp files hourly. If it's not keeping up:

```powershell
.\cleanup-temp.ps1
```

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
