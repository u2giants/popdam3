# Plan v14: rotate the hetz OS-user `ai` password (#179)

Supersedes v13 (commit 157a1572). Amends step 2d: the console/rescue requirement is replaced by three independent recovery proofs, because a password change cannot lock out key-based access. Reviews on record: GLM 20261013T233759-3326759-1761, 20261013T234438-3485893-11289; Gemini 20261013T235505-3728866-4419, 20261014T000451-3886229-19465, 20261014T001840-4074085-28799; DeepSeek 20261013T235105-3638091-26324, 20261014T000019-3807599-14958, 20261014T001352-4037250-9191. No secret values appear here.

## STATUS
Not executed. v14 final-check requested on the plan commit; step 2d proven read-only (see #179). No host, vault, or NAS change has happened.

## Scope
- Host hetz (public 178.156.180.212; Tailscale IPv4 recorded in step 0a), OS user `ai`, this one password only. Not NAS popdam (at the time not rotated, per Albert; Albert asked for it on 2026-10-21 — see `docs/ops/179-popdam-nas-rotation-plan.md`), not the hetzner_vps token (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Its password field is edited in place; the item is never re-created.
- Staging items: `hetz-ai-ssh - pending rotation - <ATTEMPT_ID>`. ATTEMPT_ID = UTC timestamp plus 6 random hex, computed before the item is created. Items are never overwritten. Notes marker `STAGED` is set in the creation step. Retirement changes only the title suffix to `- retired <ATTEMPT_ID>`, after step 11.
- Privilege evidence: on 2026-10-13 `sudo -n -l` as `ai` on hetz listed `(ALL) NOPASSWD: ALL`. Step 5 repeats this check and records it; discovery and setter checks rely on it.
- Task class: `production` (`ai-task-gates start --class production`).
- Reviewer approval (settled by Albert's standing rules): a `final-check` APPROVE on the exact plan commit, from an in-rotation reviewer whose engine differs from the implementer (Claude), run with `ai-review <engine> final-check --implementer claude`. The executor verifies it by hand before steps 7 and 9: the report exists, its verdict line is APPROVE, and its reviewed commit equals the executing commit (`git rev-parse HEAD` in the execution worktree). Only then is it passed as `--reviewer-approval <REPORT>`. The gate tool is NOT relied on to enforce this (a separate helper is fixing the gate bug); the hand check is the control.
- Gate output for steps 7 and 9 is pasted into #179.
- Execution location: execution runs in a fresh worktree checked out at the exact reviewed plan commit (detached HEAD at that SHA). Any change to the plan after approval requires a new review.
- Executor: its own shell and pts. Its tty and session ID are recorded in step 0a and it is never terminated.

## Budget (failure-based)
- The budget counts FAILED password logins only; successful probes do not count.
- Budget = (faillock deny N) - (current `faillock --user ai` failure tally) - 1, further capped by (fail2ban sshd maxretry) - 1 when fail2ban is active.
- Failures planned per run: crash-recovery probe (at most 1 failure), old-refused probes (at most 1 failure per path tested). Step 0a reserves these failures; if the reservation exceeds the budget, the old-refused probes are reduced to the budget (or dropped and recorded "not tested"). The run STOPS only if the crash-recovery reservation alone does not fit.

## Probe mechanics
- Probe command (one shape, parameterized): `timeout 20 sshpass -f "$F" ssh -F /dev/null -p <PORT> -o PreferredAuthentications=password -o PubkeyAuthentication=no -o IdentitiesOnly=yes -o IdentityAgent=none -o NumberOfPasswordPrompts=1 ai@<HOST> true`.
- Paths: public = HOST 178.156.180.212 with the port recorded password-enabled for public probes; Tailscale = HOST <Tailscale IPv4 from 0a> with port 1904 only if 0a shows it password-enabled there. Each path is recorded separately; no path is assumed to behave like another.
- `sshd -T -C` is run with the source address that the probe's own auth-log line shows; if no such line exists, the probe is not used as evidence for that address.
- $F is created as `F="$(mktemp -p "$TMPDIR")"` then `chmod 600 "$F"`, written with `umask 077`, and removed with `shred -u "$F"` after each probe.
- Key login (step 8): `ssh -F /dev/null -i <ADMIN_KEY_PATH> -p <PORT> ai@<HOST> true` must succeed after the change.

## Carried requirements
- Throwaway rehearsal of every vault write shape (create, edit, field-only change) before any canonical edit. The `op` shapes that are argv-free and produce the required result are recorded in #179. Shapes not proven are not used; if none is proven for a needed write, STOP Blocked.
- Full-item diff before and after the canonical write: title, tags, URLs, notes, field labels, field types, passkey presence. Only the password field may change.
- Discovery, paths and names only: value grep (pattern from a 0600 file, `grep -rlF -f`) over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify /worksp /tmp /var/tmp /dev/shm (run with the `sudo -n` privilege from Scope); docker inspect env by value for running containers; vault LOGIN password sha256 comparison (titles only listed); cron; systemd user units; sshd logs of successful ai password logins (90 days); shell history paths. Remote machines, Coolify UI, GitHub and off-host backups are Blocked with owner.
- Value checks: the value is counted with `tr -d '\n' < "$F" | wc -c` (must be 32) and its charset with `grep -c '^[A-Za-z0-9]\{32\}$'` on the same stripped stream. The apply strips the newline before adding its own.
- Secret transport: the value reaches ssh only through a 0600 file piped into ssh stdin; to `op` only through rehearsed argv-free shapes; never argv, env, logs, or chat. Temp files are removed with `shred -u`; any surviving file is reported.
- Plaintext copies found by discovery are scrubbed and shredded; unreadable backups are listed Blocked.

## Ordered steps
0a. Record `sshd -T -C user=ai,host=hetz,addr=<each probe source>` per port (1904, 22), faillock deny N and tally, fail2ban sshd maxretry, the Tailscale IPv4 (`tailscale ip -4` on hetz), the session list, the known admin set (Tailscale admin accounts and the executor's source address), and the failure reservation. Ports with password auth enabled are fixed here. Record the executor tty and session ID.
0. Crash-window reconciliation and coordination. (a) Read #179 comments and the coordinator thread; a competing claim STOPS the run. (b) List vault items titled `hetz-ai-ssh - pending rotation - *` not retired. Read only each item's notes marker (never its value). Items not marked STAGED are abandoned: retire them, never probe them. Two or more STAGED items: STOP Blocked for the owner. Exactly one STAGED item: compare its sha256 with the canonical field's sha256.
   - Equal sha256: promotion already happened. Run steps 1, 2b, 2c, 2d, 4, 5, then the gate, then step 8 (verify and terminate sessions), then steps 10 and 11. Step 9 is not repeated.
   - Different sha256: probe the STAGED value once (password-enabled ports from 0a; none: STOP Blocked), and the canonical value once.
     - Staged logs in, canonical does not: the host changed and promotion is missing. Run steps 1, 2b, 2c, 2d, 4, 5, then the gate, then step 8 (verify, terminate sessions), then the gate, then step 9 with the staged value, then steps 10 and 11. Step 3 is replaced by this staged-login proof.
     - Neither logs in: STOP Blocked, Hetzner console (2d).
     - Both log in with different values: STOP Blocked (ambiguous).
   - No STAGED item: continue to step 1.
1. Discovery (classified, paths and names only). Any successful ai password login from a source outside the known admin set STOPS the run and triggers a persistence check (authorized_keys, cron, systemd user units, shell rc files, Coolify env) before continuing.
2b. Setter check: grep all of /worksp/ansible (all file types) plus `crontab -l` for root and ai, systemd units, /etc/cron.d, /etc/cron.hourly, /etc/cron.daily, /etc/cron.weekly, /etc/cron.monthly, and /etc/crontab for password-setting patterns referencing ai or the managed user. Any match STOPS the run as Blocked. Output paths and pattern names only. Claim scope: no Ansible or host-scheduled password setter for ai found by these patterns in these locations; not a claim about other systems.
2c. Other sessions: inspect each other ai session (tty, start time, processes, uncommitted work in its checkout). A session with in-flight work is NOT killed; the run stops Blocked for its owner.
2d. Independent recovery paths, each proven read-only before any change (replaces the console/rescue requirement; a password change cannot remove key-based access):
   (1) Key login as ai: `ssh -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 -p <PORT> ai@127.0.0.1 true` succeeds.
   (2) Second key path that does not use the ai password: key `~/.ssh/916-alien` (public key present in ai's authorized_keys) logs in and passes `sudo -n -l chpasswd`. Root login is disabled by sshd (PermitRootLogin no), so the second path is a second key for ai.
   (3) Held session: before step 7, one key-based session is opened with ~/.ssh/id_ed25519 running a bounded command (`sleep 14400`) and is kept open throughout the change. Its PID and start time are recorded in #179; step 8 never terminates it.
   Failure of any proof: STOP before step 7 and report the failing proof verbatim.
3. Live proof (normal path only): the stored canonical value authenticates on each password-enabled port from 0a. Failure: STOP Blocked.
4. Rehearsal on a throwaway vault item: field-only edit, round trip, interruption recovery, full-item diff, and the argv-free create and edit shapes; record the proven shapes in #179. Check that `op read` output has no trailing newline (the stripped count handles either case).
5. Re-run the step 2d proofs (1) and (2) immediately before step 7 and record the output; record the sudo list (must include chpasswd).
6. Compute ATTEMPT_ID = `$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)`. ITEM="hetz-ai-ssh - pending rotation - $ATTEMPT_ID". Create ITEM ONCE in vault vibe_coding with the rehearsed create shape: value generated by the op CLI with `--generate-password` (32 letters and digits, never printed), username ai, URL ssh://178.156.180.212:1904, notes marker STAGED. If the rehearsed shape cannot set the marker in the same command, a second rehearsed command sets it before any other step. Checks use the stripped count and charset.
7. Gate: `ai-task-gates check --before production --reviewer-approval <REPORT>`; paste output into #179; must pass. Then the apply, in this exact form:
   - `set -o pipefail; F="$(mktemp -p "$TMPDIR")"; chmod 600 "$F"; umask 077`
   - `op read "op://vibe_coding/$ITEM/password" > "$F"`
   - `[ "$(tr -d '\n' < "$F" | wc -c)" = 32 ] || { shred -u "$F"; STOP Blocked; }` and the charset check the same way (failure: shred, STOP Blocked).
   - `{ printf 'ai:'; tr -d '\n' < "$F"; printf '\n'; } | ssh -F /dev/null -p <PORT_PASSWORD_ENABLED> -i <ADMIN_KEY_PATH> ai@178.156.180.212 'sudo -n chpasswd'`
   - `shred -u "$F"`. Break-glass is declared in #179 before this step.
8. Snapshot session list. Verify the new value is accepted on each enabled path (public and Tailscale, per the probe mechanics), and that key login works (probe mechanics). Old refused: tested once per path only where the reserved budget allows; otherwise recorded "not tested". Then terminate only ai sessions cleared in step 2c; record before/after counts, with probe sessions identified by start times.
9. Gate again: `ai-task-gates check --before production --reviewer-approval <REPORT>`; paste output. Promote the staged value to the canonical password field (id 5xukphmemjyt6cp67qo5qdawby) with the rehearsed argv-free edit shape and the full-item diff proof. Check: sha256 of the canonical field equals sha256 of the STAGED item.
10. Scrub only confirmed plaintext copies; shred them; list unreadable backups under Blocked. Check each consumer with its own check; consumers are the discovery hits and the sessions from step 8. Open the PR in u2giants/ansible recording (no password values) the sshd port and password-auth settings for `ai` and that the ai password is not Ansible-managed. Run scripts/test-task-gates.sh in the execution worktree as the repo's gate-routing fixture check (not as a rotation check).
11. Retire the staging item (title suffix per Scope) only when every consumer is verified or Blocked with owner, and the canonical sha256 equals the STAGED sha256. Record counts in #179.

## Rollback
No rollback to the old value. Wrong new value: a new attempt from step 6 through the gates. Key path lost: Blocked with owner via Hetzner console (2d).

## Approval record (filled in by the executor)
- Final-check report path: <path under .ai/reviews/>
- Verdict line: <APPROVE>
- Reviewed commit: <SHA>, equal to `git rev-parse HEAD` at execution: <yes/no>

## Blocked (expected at completion)
Remote machines, Coolify UI, GitHub, off-host backups, and any consumer without its own check. Each with an owner.

## Answers (cumulative)
- Gate class, execution worktree, REPORT path: see Scope.
- Step 3 deadlock in case (iv): replaced by the staged-login proof (see step 0).
- Case (ii) and (iv) completeness: session termination (step 8), promotion (step 9 where needed), and retirement (step 11) all run.
- Apply pseudo-code: replaced by the exact shell in step 7.
- Privilege: `sudo -n -l` scope recorded (Scope and step 5).
- Budget math: failures counted, successes not (Budget).
- sshd -T address and Tailscale probe: Probe mechanics.
- Vault generation: the op CLI generates the value with --generate-password; the value is never printed.
- Post-rotation key login: step 8.
- test-task-gates.sh: labeled as the gate-routing fixture check.
