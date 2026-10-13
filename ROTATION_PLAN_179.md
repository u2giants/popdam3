# Plan v2: rotate the hetz OS-user `ai` password (#179)

Supersedes v1. Answers DeepSeek plan-review round-1 findings (report 20261013T212802-1988457-31193, findings 1-14) and the earlier Codex objection set. No secret values appear in this file.

## Scope and credential
- Target: Linux user `ai` on host hetz (178.156.180.212). Only this password. Not NAS popdam (Not rotated, per Albert), not `1Password Service Account Token - hetzner_vps` (standing no-rotation), not the render account.
- Canonical vault item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding). Edited in place, never re-created. Staging item: `hetz-ai-ssh - pending rotation` (vault vibe_coding, deleted at the end).
- Task class: `ai-task-gates start --class <class>` with the exact class name confirmed from `ai-task-gates --help` before any step.

## Findings answered
F1 (Ansible boundary): The `chpasswd` change is a user/shadow change, a host change owned by /worksp/ansible. It is declared as BREAK-GLASS in the gate record and in the #179 thread before execution, and an Ansible PR capturing the sshd/password-auth state is opened in u2giants/ansible as the follow-up. Step 10 below.
F2 (stored value may not be live): Step 2 proves the stored vault value authenticates to ssh 1904 BEFORE any change. If it does not, STOP: the consumer grep and the old-value check are meaningless until the live value is known; reported Blocked.
F3 (session termination unverifiable): Terminate ALL sessions of user `ai` (not a filter). Count before/after with `who` and `loginctl list-sessions`; sshd restart is the fallback if sessions survive.
F4 (concurrent vault edit): Promotion writes the password field only, with a guard: read the item's `version`, write the field, then re-read and compare the field fingerprint. A version change between read and write aborts and retries from the read.
F5 (Tailscale untested): Step 7 adds the Tailscale path test: login via the hetz Tailscale address on the sshd port, new value accepted, old refused.
F6 (scrub undefined): Scrub = replace the exact matched line in the matched file, keep a 0600 backup of the file under $TMPDIR, verify the file parses. Targets are the paths listed by the discovery step only; no other files.
F7 (lockout): Before the verification probes, check pam_faillock and fail2ban state on hetz (`faillock --user ai`, `fail2ban-client status sshd` if present) and record it. Probes are one attempt per value per port; if a lockout appears, stop and report, do not clear it by changing config.
F8 (per-port auth): Read effective `sshd -T` per port (1904 and 22, including Match blocks for user ai) before testing. A port without PasswordAuthentication yes is recorded as "password auth disabled", not "old refused".
F9 (container env): Discovery also runs `docker inspect` on every running container and greps its environment by value (paths/names only). Coolify /data/coolify search is included.
F10 (step 9 gating): Staged item deleted only when: canonical field fingerprint == host-applied fingerprint AND every consumer is either verified or listed in the Blocked section with its owner. Unverified-out-of-reach consumers keep the staged item until the owner resolves them.
F11 (task class): Exact class from `ai-task-gates --help`, confirmed in step 0.
F12 (ephemeral evidence): The Codex reports are not cited as evidence in this file; the objection list is restated here in full in the #179 thread comment.
F13 (password history): The 1Password item password history is listed as a backup containing the old value; the old value cannot be deleted from history by this plan, so the old value is treated as exposed and revoked by the host change.
F14 (old refused): "Old refused" is only counted when port auth is enabled (F8), and the refusal is checked as a failed authentication, not a connection error.

## Ordered steps
0. Declare the exact task class and the break-glass declaration on #179.
1. Discovery (paths only, classified): value grep over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root /data/coolify; `docker inspect` env by value; cron, systemd user units, sshd logs of successful `ai` password logins for 90 days, shell history paths.
2. Pre-change live proof: authenticate to ssh 1904 with the stored vault value (via a pipe to the protected askpass helper, never argv). Must succeed; otherwise STOP (F2).
3. Record `sshd -T` per port, faillock and fail2ban state, session count.
4. Prove key login and key-based `sudo -n true` for `ai` from the admin path.
5. Generate a new 32-char [A-Za-z0-9] value via `op`; assert length and charset; stage in `hetz-ai-ssh - pending rotation`.
6. Apply on host from the staged value via pipe to `chpasswd` (break-glass, declared).
7. Verify: ports 1904 and 22 (where auth enabled) and the Tailscale path: new accepted, old refused (F14). Each probe once, timeout 20 s.
8. Terminate all `ai` sessions; count before/after (F3).
9. Promote the staged value to the canonical item's password field with the version guard (F4); verify fingerprint equals the host-applied fingerprint.
10. Scrub each discovered copy per F6; update each consumer per its own check; open the Ansible PR for the sshd/password-auth state (F1).
11. Delete the staging item only when the F10 condition holds; record counts.

## Verification per consumer
Each classified consumer has its own check (the service still authenticates or runs). Any consumer without a check is listed under Blocked with its owner; it is not counted as passed.

## Rollback
None to the old value. If the new value is wrong, set a fresh third value through the key path. If the key path is lost, Blocked and reported; no reset to the exposed value.

## Blocked section
Anything not verified at step 11 is listed here with its owner and the exact missing check.
