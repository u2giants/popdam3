# Plan: enable Samba catia name mapping on edgesynology2 mac share (#382)

## Why
Render agent (windows-agent, PR #386) now opens names with forbidden Windows characters as Samba catia shows them (U+F022 for `"`). Live test after the agent update: 48 quote-named jobs still failed "Input file is missing", because edgesynology2 has no catia mapping. Inventory (Oct 13 2026, read-only, root via sudo block): neither edgesynology1 nor edgesynology2 has `vfs objects`, `catia` or `fruit` in /etc/samba or /usr/syno/etc. The mac share ([mac], path=/volume1/mac) is identical on both. So the match target is "no catia on either" today; this plan adds catia on edgesynology2 only, then compares with edgesynology1.

## Scope
- Only edgesynology2, [mac] share, option `vfs objects = catia`. No `fruit` (Mac clients unchanged). No global change. No file or ACL change.
- edgesynology1 stays as-is (its mac share is not read by the render agent). Compare afterwards.

## Steps
1. Open a sudo block on edgesynology2 with the ai service-account password piped via stdin (deploy/synology ritual: open per block, close at end with `sudo -k`).
2. Backup, with timestamp, on the NAS: `/etc/samba/smb.share.conf`, `/etc/samba/smb.conf`. Verify both backups exist and are non-empty.
3. Read the current [mac] block and confirm it has no `vfs objects` line. Stop if it does.
4. Insert `vfs objects = catia` as the last line of the [mac] block. Use a temp file and `mv`, not in-place sed.
5. Validate: `testparm -s` must succeed and show `vfs objects = catia` under [mac]. If it fails, restore the backup and stop.
6. Reload smbd: `smbcontrol smbd reload-config` (or `synoservice --restart` if smbcontrol is missing). Verify smbd is still running.
7. Verify: a catia-visible name for a known quote file appears as U+F022 in a directory listing from a client. Practical test: the render agent's next claim of a quote-named job must reach the file (see Verification).

## ShareSync impact check
- catia changes only how SMB clients see names. Drive's sync reads host paths, not SMB. No file on disk is renamed.
- Before and after: check `dscc_monitor.log` for new error lines and confirm `DoneEvent` lines still increase. Abort if the error count rises or the connection state changes.

## Verification
- `testparm -s` output shows catia under [mac] on edgesynology2.
- smbd running, and the Windows render agent still claims jobs (agent heartbeat, render_queue completions after the change).
- Requeued 48 quote-named rows: at least 40 complete with a thumbnail. Failures must not show "Input file is missing" for quote names.
- ShareSync: no new error class in dscc logs over 30 minutes.

## Rollback
1. Open the sudo block on edgesynology2.
2. Restore the saved smb.share.conf (copy back with `cp -p`).
3. `testparm -s` must succeed with no catia line. Reload smbd.
4. Close the sudo block with `sudo -k`.
Rollback leaves the requeued rows as they are; the render agent then reports missing again, which is the pre-change state.

## Not in scope
- Renaming any NAS file (designer files stay as they are).
- fruit/Mac options, global Samba settings, ACLs, ShareSync configuration.
