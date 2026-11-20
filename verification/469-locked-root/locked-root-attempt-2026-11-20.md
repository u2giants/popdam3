# #469 locked-root marker backoff — lock attempt BLOCKED (2026-11-20)

Goal (last open #469 box): `Live proof — hourly marker retry on a naturally write-failing production root.`
Owner authorization (verbatim from his chat): "lock a test folder". Task class `production`,
`ai-task-gates check --before production` allowed by owner authorization (scoped delegation recorded verbatim in the gate log).

## Outcome: BLOCKED at the lock step — no root registration, no marker attempt, no backoff proof.

The prescribed lock (SMB ACL deny-write for the bridge service account) cannot be made
effective on this share with the available credentials. Per the delegated instruction
("If ACL changes are impossible with the available credentials, report Blocked — with the
verbatim failure — do NOT hack around it"), no alternative lock mechanism was attempted and
no proof is claimed.

## What was done (all writes rolled back)

1. SMB map `\\192.168.3.100\mac` as service account `popdam`
   (1P vault `pimcaogmxxzoafh7lsluj6uxkq`, item `edgesynology1 NAS - popdam service account`;
   values moved only through pipes/protected temp files, deleted after use).
2. Created test folder `\\192.168.3.100\mac\_469_rotest\` (= host `/volume1/mac/_469_rotest`)
   with one file `readtest.txt` for the read-check.
3. Applied ACL deny-write. Verification FAILED.

## Verbatim failures

- `icacls F:\_469_rotest /deny "*S-1-5-21-825338834-1085883014-4274235744-3078:(W)"` (the
  creating/service-account SID) →
  `Successfully processed 0 files; Failed processing 1 files` /
  `*S-1-5-21-825338834-1085883014-4274235744-3078: No mapping between account names and security IDs was done.`
- `icacls F:\_469_rotest /deny "popdam:(W)"` (by name) →
  `popdam: No mapping between account names and security IDs was done.`
- `icacls F:\_469_rotest /deny "*S-1-1-0:(W)"` (well-known Everyone SID) → applied;
  stored ACE `Everyone:(NP)(DENY)(WD,AD,WEA,WA)` — **but not enforced**:
  - write as `popdam` immediately after: `WRITE_UNEXPECTEDLY_OK` (`probe.txt` created 2:28 PM EST)
  - write as `popdam` on a **fresh** SMB session (new mapping): `FRESH_SESSION_WRITE_UNEXPECTEDLY_OK` (`probe2.txt`)
  - read check: `READ_OK: [readable-before-lock]` (read works; the required "write fails" did not)
- POSIX state via SSH `edgesynology1` after the deny: `drwxrwxrwx+ 1 popdam users` — mode 777
  unchanged. The share enforces POSIX mode; Windows DENY ACEs are stored but ignored.
- `sudo -n true` as `ahazan` (SSH, administrators group) → `sudo: a password is required` —
  no root-capable credential in scope for any root-respecting lock (immutable flag,
  read-only mount, share ACL mode) or for a chmod of a `popdam`-owned folder.

## Structural finding (why a service-account lock cannot prove this box anyway)

The bridge's marker write is not a service-account SMB write. The installed bridge
(synology-bridge-1, 1.16.33 build `afc06d55e8eb319e51b18a7fd0da2016b6b4db16`, healthy,
`marker_statuses` for `Decor` = ok) runs **as root** in Docker with the share bind-mounted:

- `apps/bridge-agent/Dockerfile`: `# Run as root to access Docker socket for self-update.` (no `USER` directive)
- `deploy/synology/docker-compose.yml`: `- /volume1/mac:/mnt/nas/mac` (no `user:` override)

`ensureRootMarkers` writes `<root>/pop-root.json` through that root bind mount
(`apps/bridge-agent/src/index.ts:529`), and the Docker fallback runs
`docker run -v <hostPath>:/w alpine ...` as root (`index.ts:496`). Root bypasses POSIX
DAC and this share ignores Windows DENY ACEs, so a service-account SMB ACL lock cannot
produce the required "marker write rejected → permission failure" condition even if it
were enforced for `popdam`.

## State restored

- Test folder `_469_rotest` deleted (SSH read-back: no matching entry under `/volume1/mac/`);
  `readtest.txt`, `probe.txt`, `probe2.txt` and the deny ACE are gone with it.
- Temporary SMB mappings (`F:`, `G:`) removed; the pre-existing `W:` mapping (not ours) untouched.
- Protected credential temp files deleted.
- `SCAN_ROOTS` **unchanged** (never modified; still `["/mnt/nas/mac/Decor"]`) — no root
  registration was made, so no bridge config change to undo.
- No follow-up cron armed (no first marker attempt exists to follow up).

## What would unblock this box

A write-failure mechanism that binds the **root-running bridge**: e.g. a genuinely
read-only mount for a test root, or `chattr +i` on the test folder — both need a
root/NAS-admin credential this delegation does not hold (`sudo: a password is required`),
or a deliberate deployment-level change (out of this delegation's authorized writes).
Alternatively an owner decision to accept a different proof target.

Posted by MiMo chat unknown on desktop
