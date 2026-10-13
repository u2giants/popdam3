# Plan v5: rotate the hetz OS-user `ai` password (#179)

Supersedes v4 (commit cd889ce8, rejected by GLM plan-review 20261013T233131-3172856-4770). Earlier rounds (v3 by Gemini and DeepSeek final-check, v1-v2 by DeepSeek) are answered in the findings section below. Based on origin/main 9b8c1efe. No secret values appear here.

## Scope
- Host hetz (178.156.180.212), OS user `ai`, this one password only. Not NAS popdam (Not rotated, per Albert), not the hetzner_vps token (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Its password field is edited in place; the item is never re-created.
- Staging item: `hetz-ai-ssh - pending rotation - attempt N` (vault vibe_coding). N starts at 1 and increments for every new staging attempt; an existing attempt is never overwritten, so a retry or a fresh value always gets a new item. Staging items are deleted only after step 11.
- Task class: `production` (`ai-task-gates start --class production`, verified in this worktree). Gate: `ai-task-gates check --before production --reviewer-approval <APPROVE report>` before step 7 (host change) and again before step 9 (vault promotion). The required gates are `exact-resource-and-action-ai-reviewer-approval` plus direct-main reconciliation.
- Executor: its own shell and pts. Its tty and session ID are recorded at step 0 and it is never terminated.
- Break-glass: the `chpasswd` change is a user-shadow change owned by /worksp/ansible. It is declared in #179 before step 7, and an Ansible PR capturing sshd/password-auth state is opened after step 10.

## Findings answered
- Stale base (Gemini critical): this plan is a fresh single commit on origin/main 9b8c1efe, touching only this file plus one AGENTS.md link line.
- Production gate forbidden under `deployment` (DeepSeek High 1): the class is `production`, which the central policy accepts. Verified: `start --class production` recorded, `check --before production` reports the required reviewer-approval gate.
- Order of sshd recording vs live proof (DeepSeek Medium 2): sshd recording is step 2 (before any login test). Live proof is step 3.
- Old value still exists in 1Password item history (DeepSeek Medium 3): stated as fact. The old value is not destroyed by this plan; it is revoked on the host. The plan does not claim history is cleared.
- Gate-class evasion by naming (DeepSeek Low 4): the file is named plan_hetz_ai_password_rotation_179.md (matches the plan_ prefix routed to reviewer-safety) and is linked from AGENTS.md active plans.
- Write-once staging vs recovery (DeepSeek Low 5): replacement values use a new attempt number; the defined procedure is: stage attempt N+1, gate, apply, verify, promote, then delete attempts <= N.
- Durability (DeepSeek Low 6): every finding and requirement is restated in this file; no external review IDs are needed to read it.
- Orphan document (DeepSeek Low 7): linked from AGENTS.md.


## GLM round-1 findings (cd889ce8) answered
- H1 (Ansible shadow revert): checked. /worksp/ansible/roles/users/tasks/main.yml ensures user `ai` exists (state present) and sets NO password key (zero `password:` keys in that file; no password_hash or hetz_ai pattern in the repo). A later Ansible apply therefore does not restore an old password hash. Step 2b records this check result and repeats it at execution. Ansible PR (step 10) changes only what the plan says, and /worksp/ansible is added to the Blocked inventory as a local checkout reviewed, not changed.
- M1 (misuse evidence): decision rule: if step 1 finds a successful ai password login from a source outside the known admin set (Tailscale admin, local hetz, known operator IPs recorded in step 1), STOP, report Blocked to the owner with the source and timestamps, and run a persistence check (authorized_keys, cron, systemd user units, shell rc files, Coolify env) before any further step.
- M2 (lockout budget): cap per source = min(faillock deny, fail2ban sshd maxretry) - 1. If fail2ban is active and its maxretry is less than or equal to faillock deny, the probe count is reduced accordingly and any probe that would be skipped is recorded as not tested.
- M3 (coordination): step 0 checks #179 comments and the coordinator thread for a competing rotation claim; any competing claim stops the run. Before step 8, every other ai session is inspected (tty, start time, running processes, uncommitted work in its checkout) and recorded; a session with in-flight work is NOT killed; the run reports Blocked for that session's owner.
- M4 (out-of-band recovery): before step 7, Hetzner console/rescue access is verified (or listed under Blocked with owner) so a bad password is recoverable without the exposed value.
- M5 (discovery paths): /worksp, /tmp, /var/tmp, /dev/shm added to the discovery grep.
- L1 (shred scope): shred applies only to confirmed plaintext copies found by discovery; unreadable backup artifacts go to Blocked.
- L2 (gate output): step 7 and step 9 paste the actual `ai-task-gates check` output into #179 before proceeding.
- L3 (temp dirs): covered by M5.
- L4 (tests): scripts/test-task-gates.sh is run in this worktree before the PR is opened.

## Requirements carried from earlier rounds (restated in full)
- Throwaway rehearsal of the vault write (field-only edit, round trip, interruption recovery, fingerprint equality) before any canonical edit.
- Full-item diff before and after the canonical write: title, tags, URLs, notes, field labels, field types, passkey presence. Only the password field may change.
- Discovery, paths and names only: value grep over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify /worksp /tmp /var/tmp /dev/shm; docker inspect env by value for running containers; vault LOGIN password fingerprints; cron; systemd user units; sshd logs of successful ai password logins (90 days); shell history paths. Remote machines, Coolify UI, GitHub and off-host backups are not searchable from here and are listed under Blocked with owner.
- Lockout: read faillock deny (N) first. Total failed probes per source <= N-1. If N-1 is too small for the probes, the old-refused check is skipped for that path and recorded as "not tested".
- Per-port auth: `sshd -T -C user=ai,host=<h>,addr=<a>` per port (1904, 22). A port with password auth disabled is recorded as such, never as a stored-value failure.
- Askpass: value reaches ssh only through a 0600 file via `sshpass -f`, or a 0600 FIFO; never argv, env, or logs. Files shredded after use.
- Sessions: terminate every ai login session except the executor's own pts. Count before and after.

## Ordered steps
0. Record executor tty and session ID. Confirm `ai-task-gates start --class production` in this worktree.
1. Discovery (classified, paths and names only), per the carried list.
2. Record sshd -T per port, faillock deny, fail2ban state, session list. (Before any login test.)
3. Live proof: the stored value authenticates to 1904 (already observed on localhost on 2026-10-13; repeat per port via the protected-file method). If it fails, STOP and report Blocked.
4. Rehearse the vault write on a throwaway item (carried procedure). Diff proof.
5. Prove key login and key-based `sudo -n true` for ai from the admin path.
6. Generate a new 32-character [A-Za-z0-9] value via `op`; assert length and charset; stage in `hetz-ai-ssh - pending rotation - attempt 1` as STAGED.
7. Gate: `ai-task-gates check --before production --reviewer-approval <report>` must pass. Apply the staged value with `chpasswd` via pipe (break-glass declared).
8. Verify new accepted, old refused on 1904, 22 (where password auth is enabled), and the Tailscale path, each within the lockout cap. Then terminate all ai sessions except the executor's pts; count before/after.
9. Gate again before promotion. Promote the staged value to the canonical password field with the full-item diff proof and fingerprint equality to the host-applied value.
10. Scrub each discovered copy by its own rule; shred backups; update and check each consumer. Open the Ansible PR in u2giants/ansible for the sshd/password-auth state.
11. Delete the staging item(s) only when every consumer is verified or listed under Blocked with its owner, and the canonical fingerprint equals the host fingerprint. Record counts.

## Rollback
No rollback to the old value. If the new value is wrong, stage attempt N+1 and repeat from step 6 through the gate. If the key path is lost, report Blocked; no reset to the exposed value.

## Blocked (expected at completion)
Remote machines, Coolify UI, GitHub, off-host backups, and any consumer without its own check. Each is listed with an owner.
