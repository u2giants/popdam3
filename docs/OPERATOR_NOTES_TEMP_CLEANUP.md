# Operator Notes: Temp File Cleanup (Windows Render Agent)

## What Was Happening

The Windows Render Agent creates temporary files and directories during thumbnail rendering:

| Prefix | Source | Contents |
|---|---|---|
| `popdam-gs-*` | Ghostscript renderer | Intermediate PNG output |
| `popdam-ink-*` | Inkscape renderer | Intermediate PNG output |
| `popdam-im-*` | ImageMagick renderer | Intermediate JPEG output |
| `magick-*` | ImageMagick internal | Pixel buffer temp files |

These are created in `%TEMP%` (typically `C:\Users\<user>\AppData\Local\Temp`).

Normally each renderer cleans up in a `finally` block. However, when the agent crashes, restarts, or a file is locked by Windows (antivirus, indexer), these temp artifacts are **not removed**. Over weeks of operation with thousands of renders, this can accumulate **tens of GB** of stale temp data, eventually filling the system drive and stopping the agent.

## How This Fix Prevents Recurrence

### Automatic Janitor (built into the agent)

The agent now includes a **temp janitor** module (`janitor.ts`) that:

1. **Runs at startup** — cleans up anything left from a previous crash
2. **Runs every hour** — catches any artifacts from mid-session failures
3. **Only deletes stale items** — files/dirs older than 24 hours (safe margin)
4. **Only targets known prefixes** — will never touch unrelated temp files
5. **Tolerates locked files** — logs a debug message and moves on
6. **Logs a summary** — items removed, bytes freed, duration

No configuration needed. The janitor starts automatically when the agent starts.

### One-Time Manual Cleanup

For machines that already have accumulated temp files, run:

```powershell
.\scripts\windows-agent\cleanup-temp.ps1
```

This script:
- Stops the agent task
- Deletes all stale PopDAM/ImageMagick temp artifacts
- Truncates oversized log files (keeps last 1000 lines)
- Restarts the agent task
- Prints before/after free disk space

Use `-StaleHours 0` to delete ALL matching temp files regardless of age.

## What Users Can Safely Delete If Disk Fills Again

If the system drive fills up before the janitor can run, manually delete:

1. **Temp directories** in `%TEMP%` starting with:
   - `popdam-gs-*`
   - `popdam-ink-*`
   - `popdam-im-*`

2. **Temp files** in `%TEMP%` starting with:
   - `magick-*`

3. **Log files** in `%ProgramData%\PopDAM\logs\` — safe to delete entirely; the agent will recreate them.

**Do NOT delete** other files in `%TEMP%` unless you know what they are.

## Rollback

If the janitor causes issues (unlikely):

1. The janitor is a standalone module with no side effects on rendering
2. To disable: revert the two lines in `index.ts` that import/call `startJanitor()`
3. The agent will continue to function normally without the janitor — temp files will just accumulate as before
