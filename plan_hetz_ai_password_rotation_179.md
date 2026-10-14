# Plan v11: rotate the hetz OS-user `ai` password (#179)

Supersedes v9 (commit 9b490c66). Reviews on record: GLM 20261013T233759-3326759-1761 and 20261013T234438-3485893-11289; Gemini 20261013T235505-3728866-4419 and 20261014T000451-3886229-19465; DeepSeek 20261013T235105-3638091-26324, 20261014T000019-3807599-14958, 20261014T001352-4037250-9191. No secret values appear here.

## STATUS
Not executed. v11 under review. No host, vault, or NAS change has happened.

## Scope
- Host hetz (public 178.156.180.212; Tailscale address recorded in step 0a), OS user `ai`, this one password only. Not NAS popdam (not rotated, per Albert), not the hetzner_vps token (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Its password field is edited in place; the item is never re-created.
- Staging items: `hetz-ai-ssh - pending rotation - <ATTEMPT_ID>`. ATTEMPT_ID = UTC timestamp plus 6 random hex, computed before the item is created. Items are never overwritten; the notes marker is `STAGED` once the value is set. Retirement changes only the title suffix to `- retired <ATTEMPT_ID>`, after step 11.
- Task class: `production`. Evidence: `ai-task-gates start --class production` recorded the class in a worktree with no plan file, and `check --before production` there reported the required gate `exact-resource-and-action-ai-reviewer-approval`. The gate runs at step 7 and again at step 9; its output is pasted into #179.
- Execution location: this plan is merged to main through its normal docs-only PR first. Execution runs in a fresh worktree at origin/main whose change set contains no plan or prose file (a `plan_*.md` file classifies the worktree as reviewer-safety, which forbids production; reproduced by DeepSeek).
- Executor: its own shell and pts. Its tty and session ID are recorded in step 0 and it is never terminated.

## Carried requirements
- Throwaway rehearsal of every vault write shape (create, edit, field-only change) before any canonical edit: the exact `op` command shapes that are argv-free and produce the required result are proven and recorded in #179. Shapes not proven are not used; if none is proven for a needed write, STOP Blocked.
- Full-item diff before and after the canonical write: title, tags, URLs, notes, field labels, field types, passkey presence. Only the password field may change.
- Discovery, paths and names only: value grep (pattern read from a 0600 file, `grep -rlF -f`) over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify /worksp /tmp /var/tmp /dev/shm; docker inspect env by value for running containers; vault LOGIN password sha256 comparison (titles only listed); cron; systemd user units; sshd logs of successful ai password logins (90 days); shell history paths. Remote machines, Coolify UI, GitHub and off-host backups are not searchable from here and are Blocked with owner.
- Probes: every probe uses `timeout 20 sshpass -f $F ssh -F /dev/null -p <PORT> -o PreferredAuthentications=password -o PubkeyAuthentication=no -o IdentitiesOnly=yes -o IdentityAgent=none -o NumberOfPasswordPrompts=1 ai@178.156.180.212 true`, so no key or agent can satisfy a password probe. $F is a 0600 file (umask 077; `install -m 600 /dev/null $F` before the write), shredded after each probe.
- Budget: remaining budget = (faillock deny N) - (current `faillock --user ai` failure tally) - 1, further capped by fail2ban sshd maxretry - 1 when fail2ban is active. The full planned probe count for the run is reserved in step 0a; if it exceeds the budget, STOP Blocked before any probe.
- Secret transport: the value reaches ssh only through a 0600 file piped into ssh stdin; to `op` only through rehearsed argv-free shapes; never argv, env, logs, or chat. Every temp file is removed with `shred -u`; any surviving file is reported.
- Value checks (vault and host): length 32 and charset [A-Za-z0-9] are checked with `tr -d '\n' < $F | wc -c` (must be 32) and `grep -c '^[A-Za-z0-9]\{32\}$'` on the same stripped stream. The apply strips the newline before adding its own.
- Plaintext copies found by discovery are scrubbed and shredded; unreadable backups are listed Blocked.

## Ordered steps
0a. Compute the reserved probe count (crash recovery plus steps 3 and 8) against the budget; STOP if it does not fit. Record `sshd -T -C user=ai,host=hetz,addr=<executor source address from $SSH_CLIENT>` per port (1904, 22), faillock deny N, the faillock tally, fail2ban sshd maxretry, the Tailscale IPv4 (`tailscale ip -4` on hetz), the session list, and the known admin set (Tailscale admin accounts and the executor's source address). Ports with password auth enabled are fixed here.
0. Crash-window reconciliation and coordination. (a) Read #179 comments and the coordinator thread; a competing claim STOPS the run. (b) List vault items titled `hetz-ai-ssh - pending rotation - *` not retired. Read only each item's notes marker (never its value). Items whose marker is not STAGED are abandoned: retire them, never probe them. Two or more STAGED items: STOP Blocked for the owner. Exactly one STAGED item: compare its sha256 with the canonical field's sha256. Equal: promotion already happened; run steps 1, 2b, 2c, 2d, 3, 4, 5, then the gate, then step 10. Different: probe the newest STAGED value and then the canonical value, one probe each, on the password-enabled ports from 0a (none: STOP Blocked). Staged logs in and canonical does not: the host changed and promotion is missing; run steps 1, 2b, 2c, 2d, 3, 4, 5, then the gate, then step 9 with that staged value. Neither logs in: STOP Blocked, Hetzner console (2d). Both log in with different values: STOP Blocked (ambiguous). If no STAGED item exists, continue to step 1.
1. Discovery (classified, paths and names only). Any successful ai password login from a source outside the known admin set STOPS the run and triggers a persistence check (authorized_keys, cron, systemd user units, shell rc files, Coolify env) before continuing.
2b. Setter check: grep all of /worksp/ansible (all file types) plus `crontab -l` for root and ai, systemd units, /etc/cron.d, /etc/cron.hourly, /etc/cron.daily, /etc/cron.weekly, /etc/cron.monthly, and /etc/crontab for password-setting patterns referencing ai or the managed user. Any match STOPS the run as Blocked. Output paths and pattern names only. Claim scope: no Ansible or host-scheduled password setter for ai found by these patterns in these locations; not a claim about other systems.
2c. Other sessions: inspect each other ai session (tty, start time, processes, uncommitted work in its checkout) and record. A session with in-flight work is NOT killed; the run stops Blocked for its owner.
2d. Hetzner console/rescue access verified, or the run stops Blocked with owner.
3. Live proof: the stored canonical value authenticates on each password-enabled port from 0a (probe command above). Failure: STOP Blocked.
4. Rehearsal on a throwaway vault item: field-only edit, round trip, interruption recovery, full-item diff, and the argv-free shapes for create and edit, plus a check that `op read` output has no trailing newline (the stripped count handles either case). Record the proven shapes in #179.
5. Prove key login and `sudo -n -l chpasswd` for ai from the admin path (the exact command, not `true`). Record the admin key path.
6. Compute ATTEMPT_ID = `$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)`. Create `hetz-ai-ssh - pending rotation - <ATTEMPT_ID>` ONCE in vault vibe_coding with the rehearsed create shape: value generated inside the vault (32 letters and digits), username ai, URL ssh://178.156.180.212:1904, notes marker STAGED. If the rehearsed shape cannot set the marker in the same command, a second rehearsed command sets it before any other step. The value is never printed; checks use the stripped count and charset.
7. Gate: `ai-task-gates check --before production --reviewer-approval <report>`; paste output into #179; must pass. Apply: `umask 077`; `install -m 600 /dev/null $F`; `op read "op://vibe_coding/<staging title>/password" > $F`; checks pass; then `set -o pipefail; { printf 'ai:'; tr -d '\n' < "$F"; printf '\n'; } | ssh -F /dev/null -p <PORT_PASSWORD_ENABLED> -i <ADMIN_KEY_PATH> ai@178.156.180.212 'sudo -n chpasswd'`; then `shred -u "$F"`. The break-glass is declared in #179 before this step.
8. (Budget reserved in 0a.) Snapshot session list. Verify the new value is accepted on each enabled path (1904, 22, Tailscale IP from 0a). Old refused: tested at most once per path, only where the reserved budget allows; otherwise recorded "not tested". Then terminate only ai sessions cleared in step 2c; record before/after counts, with probe sessions identified by their start times.
9. Gate again: `ai-task-gates check --before production --reviewer-approval <report>`; paste output. Promote the staged value to the canonical password field (id 5xukphmemjyt6cp67qo5qdawby) with the rehearsed argv-free edit shape and the full-item diff proof. Vault-to-vault check: sha256 of the canonical field equals sha256 of the STAGED item.
10. Scrub only confirmed plaintext copies; shred them; list unreadable backups under Blocked. Check each consumer with its own check; consumers are the discovery hits and the sessions from step 8. Open the PR in u2giants/ansible that records (no password values) the sshd port and password-auth settings for `ai` and documents that the ai password is not Ansible-managed. Run scripts/test-task-gates.sh in the execution worktree.
11. Retire the staging item (title suffix per Scope) only when every consumer is verified or Blocked with owner, and the canonical sha256 equals the STAGED sha256. Record counts in #179.

## Rollback
No rollback to the old value. Wrong new value: a new attempt from step 6 through the gates. Key path lost: Blocked with owner via Hetzner console (2d).

## Blocked (expected at completion)
Remote machines, Coolify UI, GitHub, off-host backups, and any consumer without its own check. Each with an owner.

## Answers (cumulative, one line each)
- Gate class and execution worktree: see Scope.
- Stale-base and staging ordering, crash-window cases (ii) and (iv) running the safety steps: see step 0.
- Sudo proof: step 5 uses `sudo -n -l chpasswd`.
- Placeholders: 0a and step 7 fix every value (178.156.180.212 public, ports from 0a, admin key from step 5).
- Probe key masking: the probe command above.
- ps-visible values: rejected; the discovery pattern is read from a file, so process listings show the path only.
- Cron directories: step 2b covers them.
- Budget: reserved in 0a.
