# Plan v7: rotate the hetz OS-user `ai` password (#179)

Supersedes v6 (commit 79785769, GLM plan-review 20261013T234438-3485893-11289). Based on origin/main 9b8c1efe. No secret values appear here.

## Scope
- Host hetz (178.156.180.212), OS user `ai`, this one password only. Not NAS popdam (Not rotated, per Albert), not the hetzner_vps token (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Its password field is edited in place; the item is never re-created.
- Staging items: `hetz-ai-ssh - pending rotation - <ATTEMPT_ID>`, where ATTEMPT_ID is the UTC timestamp `YYYYMMDDTHHMMSSZ` taken at step 6 (unique per attempt, never reused). A staging item is never overwritten or edited after it is marked STAGED. Retirement of an item only changes its title suffix to `- retired <ATTEMPT_ID>` after it is no longer needed; it is never deleted before step 11.
- Task class: `production`. Gate `ai-task-gates check --before production --reviewer-approval <APPROVE report>` runs at step 7 and again at step 9, and its output is pasted into #179.
- Executor: its own shell and pts. Its tty and session ID are recorded in step 0 and it is never terminated.

## Answers to GLM round 3 (v6) and self-review
- Attempt numbering: staging uses a timestamp ATTEMPT_ID, not a counter. A retry generates a new ID; an existing item is never reused (fixes the overwrite risk).
- Crash-window reconciliation: step 0 converges any leftover staging item before anything else (see steps).
- Step 2b claim vs check: the check now covers all of /worksp/ansible (every file, every line), for password-setting patterns (`password`, `password_hash`, `chpasswd`, `usermod -p`, `shadow`, `password_lock`) that reference ai or the managed user; and the host check covers cron, systemd units, /etc/cron.d, root and ai crontabs for the same patterns. The claim is narrowed accordingly: "no Ansible or host-scheduled password setter for ai found by these patterns in these locations". It is not a claim about other systems.
- Self-review, idempotency: every step is safe to repeat. Step 1 discovery is read-only. Step 2 reads state. Step 6 stages a new ID each run. Step 8 is verification plus a session kill whose list is re-derived each run. Step 10 scrubs re-scan each run.
- Self-review, crash windows: (a) after step 7 and before step 9 the host holds the staged value; step 0 detects it and converges. (b) during step 6 a partial staging item may exist without STAGED; step 0 treats it as not usable and abandons it (marked retired, never reused). (c) during step 9 a partial canonical write is detected by the fingerprint check and retried from the full-item diff. (d) during step 10 a partial scrub is re-scanned next run.
- Self-review, claim vs check: each "verified" claim in steps is matched by a concrete check; any consumer with no concrete check is Blocked, never passed.

## Carried requirements
- Throwaway rehearsal of the vault write (field-only edit, round trip, interruption recovery, fingerprint equality, full-item diff) before any canonical edit. The rehearsal also proves an argv-free input form for `op` writes.
- Full-item diff before and after the canonical write: title, tags, URLs, notes, field labels, field types, passkey presence. Only the password field may change.
- Discovery, paths and names only: value grep over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify /worksp /tmp /var/tmp /dev/shm; docker inspect env by value for running containers; vault LOGIN password fingerprints; cron; systemd user units; sshd logs of successful ai password logins (90 days); shell history paths. Remote machines, Coolify UI, GitHub and off-host backups are not searchable from here and are Blocked with owner.
- Lockout: per-source failed-probe cap = min(faillock deny, fail2ban sshd maxretry) - 1; total probes in this plan stay within that cap.
- Per-port auth: sshd -T -C user=ai,host=<h>,addr=<a> per port (1904, 22). Port with password auth disabled is recorded as such.
- Secret transport: the value reaches ssh only through a 0600 file via `sshpass -f`, or a 0600 FIFO; to `chpasswd` only through a pipe into ssh's stdin; to `op` only through the argv-free form proven in the rehearsal; never argv, env, logs, or chat. Template and temp files are shredded after use.
- Plaintext copies found by discovery are scrubbed and shredded; unreadable backups are listed Blocked.

## Ordered steps
0. Crash-window reconciliation and coordination. (a) Read #179 comments and the coordinator thread for a competing claim; a competing claim STOPS the run. (b) List vault items titled `hetz-ai-ssh - pending rotation - *` not yet retired. For each, compare its fingerprint to the canonical field fingerprint. If none exist, continue to step 1. If any exists, test each candidate with one login each on 1904 (staged value, then canonical value; within the probe cap): (i) canonical logs in, staged does not: the host was not changed; mark that staging item retired and continue. (ii) staged logs in, canonical does not: the host changed and promotion is missing; go to step 9 with that staged value after its gates. (iii) neither logs in: STOP Blocked, Hetzner console (step 2d). (iv) both log in: STOP Blocked (ambiguous). (c) Record executor tty, session ID, and `ai-task-gates start --class production` output.
1. Discovery (classified, paths and names only). Any successful ai password login from a source outside the known admin set STOPS the run and triggers a persistence check (authorized_keys, cron, systemd user units, shell rc files, Coolify env) before continuing.
2. Record `sshd -T -C user=ai,host=<h>,addr=<a>` per port (1904, 22), faillock deny N, fail2ban sshd maxretry, the probe cap, and the session list.
2b. Setter check (scope as stated in Answers): grep all of /worksp/ansible (all file types) plus the host cron, systemd, and /etc/cron.d locations for password-setting patterns referencing ai or the managed user. Any match STOPS the run as Blocked (the next apply or job would revert the rotation). Output paths and pattern names only.
2c. Other sessions: inspect each other ai session (tty, start time, processes, uncommitted work in its checkout) and record. A session with in-flight work is NOT killed; the run stops Blocked for its owner.
2d. Hetzner console/rescue access verified, or the run stops Blocked with owner.
3. Live proof: the stored canonical value authenticates to 1904 and 22 (where enabled). If it fails, STOP Blocked.
4. Rehearsal on a throwaway vault item (field-only edit, round trip, interruption recovery, fingerprint equality, full-item diff, argv-free write form). If no argv-free write form is proven, STOP Blocked.
5. Prove key login and key-based `sudo -n true` for ai from the admin path.
6. Generate a new 32-character [A-Za-z0-9] value via `op`; assert length and charset. Compute ATTEMPT_ID = current UTC timestamp. Create `hetz-ai-ssh - pending rotation - <ATTEMPT_ID>` through the proven argv-free form, state STAGED. Shred any template file.
7. Gate: `ai-task-gates check --before production --reviewer-approval <report>`; paste output into #179; must pass. Apply: the staged item's value piped into ssh whose remote command is `chpasswd`. Break-glass declared in #179 before this step.
8. Verify new accepted and old refused on 1904, 22 (where enabled), and the Tailscale path, within the probe cap. Then terminate only ai sessions cleared in step 2c; record before/after counts.
9. Gate again: `ai-task-gates check --before production --reviewer-approval <report>`; paste output. Promote the staged value to the canonical password field with the proven argv-free form, full-item diff proof, and fingerprint equal to the host-applied value.
10. Scrub only confirmed plaintext copies; shred them; list unreadable backups under Blocked. Check each consumer with its own check. Open the Ansible PR in u2giants/ansible for sshd and password-auth state. Run scripts/test-task-gates.sh in this worktree.
11. Retire the staging item for this ATTEMPT_ID (rename suffix, per Scope) only when every consumer is verified or Blocked with owner, and the canonical fingerprint equals the host fingerprint. Record counts in #179.

## Rollback
No rollback to the old value. Wrong new value: a new attempt from step 6 through the gates. Key path lost: Blocked with owner via Hetzner console (2d).

## Blocked (expected at completion)
Remote machines, Coolify UI, GitHub, off-host backups, and any consumer without its own check. Each with an owner.
