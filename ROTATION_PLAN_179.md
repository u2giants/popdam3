# Plan v3: rotate the hetz OS-user `ai` password (#179)

Supersedes v2. Answers DeepSeek round-2 review (20261013T213144-2053311-6213) H1-H2, M1-M8, and restores every v1 answer it says v2 dropped. No secret values appear in this file.

## Scope and credential
- Host hetz (178.156.180.212), OS user `ai`, one password only. Not NAS popdam (Not rotated, per Albert), not the hetzner_vps token (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Edited in place, never re-created.
- Staging item: `hetz-ai-ssh - pending rotation` (vault vibe_coding), write-once, deleted at the end.
- Task class: `deployment` (declared, gate start recorded). Production gate: `ai-task-gates check --before production --reviewer-approval <APPROVE report>` immediately before step 7.
- Executor: runs from its own shell on its own pts. Records `$(tty)` and its session ID at step 0; it is never terminated.

## Answers to round-2 findings
H1 production gate: restored as a hard precondition of step 7 (host change) and step 9 (vault promotion).
H2 dropped answers restored:
  - throwaway rehearsal of the vault write (step 3): field-only edit on a throwaway item, round trip, interruption recovery, fingerprint equality.
  - before and after the canonical write, the full item is diffed (title, tags, URLs, notes, field labels, field types, passkey presence) and the diff must show only the password field changed.
  - staging is write-once with a state marker (`STAGED`, `APPLIED`); a retry reads the marker and never overwrites a staged value.
M1/M2 ordering and per-port auth: `sshd -T -C user=ai,host=<h>,addr=<a>` is read per port (1904, 22) BEFORE the live proof (step 2), so a port disabling password auth is recorded, not treated as a stored-value failure.
M3 self-termination: step 8 terminates every `ai` login session EXCEPT the executor's own pts recorded at step 0. Count before/after.
M4 lockout: `faillock --user ai` read first; deny value N recorded. Total failed probes per source across all probes is capped at N-1. If N-1 is less than the probes needed, the old-refused probe is skipped on that path and recorded as "not tested", never as a pass.
M5 consumer completeness: discovery adds (a) every vault LOGIN item's password field compared by sha256 fingerprint to the stored value (titles listed only), (b) hetz value grep and docker env as in v2, (c) remote machines, GitHub, Coolify UI, and backups are NOT searchable from here and are listed under Blocked with owner; they are not counted as clean.
M6 scrub backup: backups are removed with `shred -u` after the scrub is verified; no copy of the old value remains.
M7 askpass: a 0600 helper in $TMPDIR returns the value from a 0600 FIFO that `op read ... >` fills through a pipe; no value in argv, env, or logs. The helper is removed after step 2.
M8 1Password serialization: a single writer; the executor takes a lock file in $TMPDIR; no other item edits run during steps 3-9.

## Ordered steps
0. Record executor tty and session ID. Declare task class `deployment` and the break-glass declaration for the `chpasswd` change, in #179.
1. Discovery (paths and names only, classified): value grep over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify; `docker inspect` env by value for running containers; vault LOGIN password fingerprints; cron; systemd user units; sshd logs of successful `ai` password logins (90 days); shell histories (paths only).
2. Live proof: stored vault value authenticates to 1904 with the askpass helper. Must succeed; else STOP and report Blocked (stored value is not live).
3. Throwaway rehearsal of the vault write (M8 lock held). Diff proof.
4. Record `sshd -T` per port, faillock deny, fail2ban state, session list.
5. Prove key login and key-based `sudo -n true` for `ai`.
6. Generate a new 32-char [A-Za-z0-9] value via `op`; assert length and charset; stage in `hetz-ai-ssh - pending rotation` as STAGED.
7. Gate: `ai-task-gates check --before production --reviewer-approval <report>` must pass. Then apply with `chpasswd` from the staged value through a pipe (break-glass, declared).
8. Verify: 1904, 22 (where password auth enabled), Tailscale path: new accepted, old refused, each probe within the M4 cap. Then terminate all `ai` sessions except the executor's own pts; count before/after.
9. Gate again before promotion. Promote the staged value to the canonical password field with the diff proof (step 3 procedure) and fingerprint equality to the host-applied value.
10. Scrub each copy from discovery per its own rule; shred backups; update each consumer and check it. Open the Ansible PR for the sshd/password-auth state in u2giants/ansible.
11. Delete the staging item only when every consumer is verified or listed under Blocked with its owner, and the canonical fingerprint equals the host fingerprint. Record counts.

## Verification per consumer
Each consumer has its own check. A consumer without a check is listed under Blocked with its owner; never counted as passed.

## Rollback
No rollback to the old value. If the new value is wrong, set a fresh third value through the key path. If the key path is lost, report Blocked; no reset to the exposed value.

## Blocked
Remote machines, Coolify UI, GitHub, backups not on hetz, and any consumer without a check. Each with owner.
