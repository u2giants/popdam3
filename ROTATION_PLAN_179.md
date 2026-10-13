# Plan: rotate the hetz OS-user `ai` password (#179, consolidated v1)

Answers every objection in the Codex plan-review reports
codex-plan-review-20261011T183411/183721/184039/184340 (v1-v4) and the
earlier v1-v24 / v1-v13 / v1-v6 / v1-v3 rounds recorded in the #179 thread.

## Scope and credential
- Target: Linux user `ai` on host hetz (178.156.180.212). Only this one password. Not the NAS `popdam` or `ai` NAS values, not `1Password Service Account Token - hetzner_vps` (standing no-rotation directive, untouched).
- Canonical 1Password item: `hetz-ai-ssh` (id 5xukphmemjyt6cp67qo5qdawby, vault vibe_coding, category LOGIN, fields username / password / notesPlain, URL ssh://178.156.180.212:1904). The item ID is never replaced or re-created.
- Task class: declared with `ai-task-gates start --class <class>` before any step; `ai-task-gates check --before production --reviewer-approval <report>` before the host change.

## Objection-by-objection answers
1. Rollback restores the exposed password. There is NO rollback to the old value. Recovery path is SSH key login plus sudo with the key account; a key login is proven (step 2) before the password changes, and any failed step is recovered by a fresh third password, never the old one.
2. Vault replacement changes the item ID / duplicates names. The canonical item is edited in place (password field only). No new item is created. Method is proven on a throwaway test item first (step 4); if the field-only write cannot be proven, the plan stops rather than full-item template editing.
3. Localhost testing does not exercise the exposed network path. Verification uses the real network path: a password login from a non-localhost address to port 1904 AND port 22 (both listen per sshd config), and the Tailscale path.
4. SSH is not forced to password-only. Not needed for rotation; the change makes password auth fail for the old value. Password auth stays enabled (other consumers depend on it) unless step 6 proves no consumer needs it; that decision is a separate reviewed step, not part of this rotation.
5. "Every consumer" relied on logs and name searches. Consumer discovery now searches by VALUE: `grep -rlF -f <pipe of the stored value>` over /home /etc /opt /srv /var/lib/docker/volumes /var/log /root and /data/coolify, printing PATHS only; plus sshd logs of successful logins for 90 days, cron/systemd user units, shell histories (paths only), Coolify env stores, and the 1Password consumers listed in the vault index. Each hit is classified (consumer / stale copy / backup) and reported by path.
6. Remote machines, backups, inactive clients, plaintext copies. Each classified hit gets an action: update, scrub, or document as out of reach. Backups containing the old value are listed; they are not restored.
7. Leaves reused credential exposed. The old value is revoked by the change itself (password replaced). No other host credential reuses it; if a reuse is found it is in the consumer list and handled as its own item.
8. Restart reconciliation and key+sudo recovery proof before change. Before the password change: (a) SSH key login as `ai` works from the admin path; (b) `sudo -n true` works with key session; (c) the new value is staged, not applied, and a fingerprint (sha256 first 16) is recorded.
9. Port 22 and 1904 both exposed; only 1904 tested. Both ports are tested with the new value (pass) and the old value (refused).
10. Safe character set, pipeline failure checks, secret-safe atomic promotion undefined. Generated password: 32 chars from [A-Za-z0-9] via `op`, length and charset asserted before use. Promotion order: stage value -> set host password via `chpasswd` from a pipe -> verify both ports -> write vault field via op -> verify by fingerprint -> discard staged value. Any pipeline stage non-zero halts with no partial write.
11. Full-item template edits erase passkeys; concurrent edits overwrite. Field-only write; before and after the write, the item's notes and URL are compared, and the item's full field list is diffed (labels and types), not values.
12. Retry overwrites pending_password before the host change; interruption leaves the live password absent. Staging writes to a separate non-canonical item `hetz-ai-ssh - pending rotation` only; the canonical field is changed only after host verification. A retry reads the staged item, never overwrites it blindly. Interrupt after host change but before vault promotion: the staged value is used to fix the vault field; if the staged item is missing, a fresh recovery through the key path changes the password again.
13. Existing sessions not terminated; persistence using the password not inspected. After the change, existing password-authenticated sessions for `ai` are listed (`who`, `ss -tnp` on 1904/22) and terminated; cron, systemd user units and the Coolify env are inspected for the old password by value.
14. Failure tests lack timeouts, prompt limits, lockout. Each login test uses `timeout 20`, a single attempt per value, and a 1-minute gap; no retries on failure.
15. Four old-password failures contradict one per source. Verification: old value refused on each network path once; new value accepted once per path; results recorded as counts per path.
16. No evidence the template round-trip, retry interruption or lockout behavior is tested. Round-trip and interruption tests run on the throwaway item and a dry-run harness before the live change.

## Ordered steps
0. Declare the task class. Confirm the value fingerprint: `sha256sum` first 16 chars of the stored value (not printed).
1. Consumer discovery (value grep, log review, cron/systemd, Coolify env) -> classified list of paths in a scratch file. Output: paths and classes only.
2. Prove key login and key-based sudo for `ai` from the admin path.
3. Prove write method on throwaway item: field-only edit, round-trip, interruption recovery, fingerprint match.
4. Generate new 32-char value via `op`, assert length and charset, stage in the pending item.
5. Pre-check: both ports, key login ok.
6. Set host password from the staged value via pipe to `chpasswd`. Verify the new value accepted and the old value refused on ports 1904 and 22.
7. Promote: write the new value into canonical `hetz-ai-ssh` password field via the proven field-only method. Verify fingerprint equals staged.
8. Terminate old sessions; update or scrub each classified consumer; verify each by its own check.
9. Delete the staged pending item only after step 7 and 8 pass; record counts.

## Verification per consumer
- SSH 1904 and 22, new password accepted, old refused: each run once with `timeout 20`.
- Sudo via key: `sudo -n true` succeeds.
- Vault: `op read` fingerprint equals host-applied fingerprint.
- Every classified consumer: its own check (service still authenticates).

## Rollback
No rollback to the old value. If the new password is wrong, set a fresh third value via the key path; if the key path is lost, Blocked and report, not a password reset to the old value.

## Not in this plan
NAS popdam (Not rotated, per Albert), hetzner_vps token (standing no-rotation), render account, admin_config plaintext, scripts moved off ahazan (separate items on #179).
