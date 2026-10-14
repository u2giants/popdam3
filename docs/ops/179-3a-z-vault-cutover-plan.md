# #179 item 3a: Z: NAS password in Vault and popdam-render cutover

Status: revised after Muse REJECT #2 (restorable rollback backup, non-empty guards, credential/ACL/deploy pre-verifications, digest-only queries, reordered steps). Status: draft for final-check. Owner: Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 on hetz.
Times in EDT.

## Goal
Windows render agent (EDGE-ALIEN) reads the Z: (mac share) password from Vault and uses
the least-privilege DSM account `popdam-render` (RW on `mac`, RO on `styleguides`) instead
of `ahazan`. No plaintext NAS password remains in admin_config.

## Preconditions (all must hold before step 1)
1. shared-db migration `20261014043757_render_z_nas_password_vault` merged and applied to
   production by the promotion workflow (popcre/shared-db PR #4284).
2. popdam3 PR #392 (agent-api serves the Z: password from the RPC) merged **and deploy-verified**
   before step 1: the `deploy-supabase.yml` run for the #392 merge commit is green, AND a live
   probe of agent-api confirms the post-#392 Vault-backed behavior (not just the merge checkbox).
   If the live function is stale, stop and redeploy — a stale function would pair the new
   `popdam-render` user with the old ahazan password still served from the row, breaking Z:.
3. `ai-task-gates check --before production --reviewer-approval <report>` passes for each production step.
4. psql connects as role `service_role` — the setter/getter RPCs (`set_render_z_nas_password`,
   `set_sg_nas_password`, `get_*`) are service_role-only; a session without the grant fails
   mid-cutover. pgcrypto `digest()` is available (the migrations already use it).
5. **Credential pre-verification:** the `popdam-render` password in the 1Password vibe_coding
   item `edgesynology2 NAS - popdam-render service account` is proven to authenticate BEFORE
   any credential switch: run the runbook-required `net use` test against the mac share from
   EDGE-ALIEN (password read from the protected file at the interactive prompt — never in
   argv, logs, or xtrace) or a DSM login test. If it fails, abort before step 1; a stale or
   wrong value would break both mounts at the restart.
6. **ACL pre-verification:** on edgesynology2, confirm `popdam-render` is already in the share
   ACLs — RW (`write list`) on `mac`, RO (`valid users`, no write) on `styleguides` — BEFORE
   any removal of `ahazan`. If either grant is missing, stop and fix the ACL first; step 10
   must never run without it or the shares are left with no working login.

## Secret-handling script (the only sanctioned file for this cutover)
The exact reviewed script for all secret movement is the command block below, saved verbatim
as `/root/.popdam/179-3a-cutover-secrets.sh` on hetz, created with `umask 077` (mode 600),
before step 0. Every secret touch runs through this file — no ad-hoc variants, no interactive
psql, no improvisation by the executor.

- Session setup: `set +o history; set +x` (shell history and xtrace off). psql runs only
  non-interactively (`-f`), so no psql history file is written.
- Value path: 1Password → protected file (umask 077) → psql `\set` reading that file.
  Never in argv, stdout, stderr, or xtrace.
- Protected files: rollback backup `/root/.popdam/179-3a-rollback.env`; working secret
  files under `/root/.popdam/179-3a-secrets/` (both directories umask 077).
- Exact command patterns:

```sh
# Non-empty guard — run before EVERY psql setter call; never prints the value.
# If empty/missing: abort (an empty setter call would DELETE/blank the live secret).
SECRET_FILE=/root/.popdam/179-3a-secrets/z_nas.pass
[ -s "$SECRET_FILE" ] || { echo "ABORT: secret file empty or missing: $SECRET_FILE" >&2; exit 1; }

# 1Password → protected file, exact bytes only (no trailing newline — M8)
printf '%s' "$(op read 'op://vibe_coding/<item>/password')" > "$SECRET_FILE"

# 1Password → digest comparison over the exact password bytes (no trailing newline)
OP_DIGEST=$(printf '%s' "$(op read 'op://vibe_coding/<item>/password')" | sha256sum | awk '{print $1}')

# Setter via \set: value loaded from the guarded file into a psql variable, then
# passed as a parameter (:'var') — never inlined into SQL text, argv, or output.
psql ... -f - <<'SQL'
\set zpass `cat /root/.popdam/179-3a-secrets/z_nas.pass`
SELECT set_render_z_nas_password(:'zpass');
SQL

# Digest-only verification queries — the password is NEVER printed:
#   SELECT encode(digest(get_render_z_nas_password(),'sha256'),'hex');
#   SELECT encode(digest(get_sg_nas_password(),'sha256'),'hex');

# After all writes and digest checks: destroy the working secret files
shred -u /root/.popdam/179-3a-secrets/*   # rollback file is destroyed last, see Done when
```

## Steps
0. Record a **restorable** rollback state before any change — not digests alone.
   Write a protected backup file `/root/.popdam/179-3a-rollback.env` (umask 077, chmod 600,
   on hetz) containing the actual current values needed to restore the system:
   - admin_config `WINDOWS_AGENT_NAS_PASS` value,
   - existing Vault values for `popdam_render_z_nas_password` (if present) and
     `popdam_sg_nas_password`.
   Values are copied client-side: open a psql session as `service_role` with
   `\o /root/.popdam/179-3a-rollback.env` so query output lands in the protected file —
   never on stdout. Record next to them the SHA-256 digest of each value (digest-only
   queries above) and the DSM tasks 9/10 prior assignment (written here in step 9).
   **Restore from this file:** `\set` from the file → `set_render_z_nas_password` /
   `set_sg_nas_password`, and guarded re-insert of the `WINDOWS_AGENT_NAS_PASS` row
   (exact statements in Rollback). Secondary restore source if the file is lost:
   1Password vibe_coding items `Synology 192.168.3.101 - mac SMB share` (ahazan) and
   `Synology edgesynology2 - styleguides SMB share` (popdam).
1. Load the Z: password into Vault with `set_render_z_nas_password` (called from psql as
   `service_role`; the RPC has no admin-api caller by design). Source: 1Password vibe_coding
   item `edgesynology2 NAS - popdam-render service account`. Move it through the script above
   (1Password → guarded protected file → `\set`). Run the non-empty guard immediately before
   the setter call; abort if the file is empty. Verify by SHA-256 of the value against the
   1Password digest (exact bytes, no trailing newline), never by printing it.
2. Verify through the RPC only, digest-only:
   `SELECT encode(digest(get_render_z_nas_password(),'sha256'),'hex');` must equal the
   1Password digest. Never call `get_render_z_nas_password()` bare — that prints the password.
3. Guarded transaction (same script run, immediately after step 2): set admin_config
   `WINDOWS_AGENT_NAS_USER` = `popdam-render`. Exact guarded statements — one transaction,
   aborts automatically on any mismatch:

   ```sql
   DO $$ DECLARE n integer; BEGIN
     SELECT count(*) INTO n FROM admin_config WHERE key = 'WINDOWS_AGENT_NAS_USER';
     IF n <> 1 THEN RAISE EXCEPTION 'pre-count %, expected 1', n; END IF;
     UPDATE admin_config SET value = 'popdam-render' WHERE key = 'WINDOWS_AGENT_NAS_USER';
     GET DIAGNOSTICS n = ROW_COUNT;
     IF n <> 1 THEN RAISE EXCEPTION 'update affected % rows, expected 1', n; END IF;
   END $$;
   ```

   **Heartbeat window:** steps 1–3 run back-to-back with no intervening pauses so the
   mismatch window (Vault password already new, user row still ahazan) is seconds long;
   the agent applies the pair on its next heartbeat. Do not insert breaks between 1, 2, 3.
4. Y: (styleguides). Note: agent-api's SG read blanks on empty and the SG secret has no
   admin_config fallback — the plan never relies on an empty fallback, so the non-empty
   guard and post-write digest match are mandatory here. Order (write Vault first, then
   the user row, back-to-back):
   a. Write Vault secret `popdam_sg_nas_password` with `set_sg_nas_password` — non-empty
      guard immediately before; verify with
      `SELECT encode(digest(get_sg_nas_password(),'sha256'),'hex');` against the 1Password
      digest of the same account's password. Never print it.
   b. Immediately set admin_config `WINDOWS_AGENT_SG_NAS_USER` = `popdam-render` with the
      same guarded-transaction pattern as step 3.
5. Restart the agent through the admin path as ai-admin@designflow.app (force_restart).
   Credentials from 1Password, never typed into commands.
6. Verify from the agent log: preflight "NAS access OK"; Z: and Y: mounts use popdam-render.
7. Live render proof: one Z: job and one Y: job complete with a thumbnail upload.
8. Delete plaintext `WINDOWS_AGENT_NAS_PASS` from admin_config (guarded transaction,
   count 1 → 0, same DO-block pattern with `DELETE` and post-count 0).
   Why it is safe: agent-api uses the Vault value when it is non-empty, and the row is not
   needed after this step. Undo is re-inserting the row with the value from the step 0
   rollback file.
   **Point of no fallback:** after step 8 there is no safety net — any Vault/RPC outage
   serves an empty password. Rollback values (step 0 file + the two 1Password items) must
   stay at hand until the Done-when checklist passes.
9. Reassign DSM scheduled tasks 9 and 10 away from `ahazan` — **before** any ACL removal.
   Record their prior assignment (which account each task runs as) into the step 0 rollback
   file first; that record is the rollback source. If DSM access is not available to the AI,
   report Blocked with the exact error; do not work around it.
10. Remove `ahazan` from edgesynology2 share ACLs (smb.share.conf write list and valid users).
    Only after preconditions 5 and 6 pass and step 9 has reassigned the DSM tasks.
    Backup first: copy `/etc/samba/smb.share.conf` to `/etc/samba/smb.share.conf.179-3a.bak`.
    Rollback is restoring that file to `/etc/samba/smb.share.conf` and running
    `smbcontrol all reload-config`.

## Done when
- Live render completes on Z: and on Y: under popdam-render.
- admin_config has no WINDOWS_AGENT_NAS_PASS row.
- No ahazan login is used by the render agent (log shows popdam-render only).
- Live Vault digests (Z and Y) match the 1Password digests exactly
  (`encode(digest(get_*(),'sha256'),'hex')` comparison, values never printed).
- All working protected files under `/root/.popdam/179-3a-secrets/` are shredded and
  confirmed absent; the step 0 rollback file is present through this checklist, then
  shredded (`shred -u`) and confirmed absent as the final item.

## Rollback
Restore sources: the step 0 file `/root/.popdam/179-3a-rollback.env` (actual prior values +
digests, including the SG-secret digest and the DSM task prior assignment), and — if that
file is unusable — 1Password vibe_coding items `Synology 192.168.3.101 - mac SMB share`
(ahazan) and `Synology edgesynology2 - styleguides SMB share` (popdam). Verify every restored
value against the step 0 digests (digest-only queries).

Restore order (share access first, so a working login always exists):
1. Copy `/etc/samba/smb.share.conf.179-3a.bak` back to `/etc/samba/smb.share.conf` and run
   `smbcontrol all reload-config` — restores ahazan's share access.
2. Reassign DSM scheduled tasks 9 and 10 to the prior owner recorded in the step 0 file.
3. Restore Vault secrets via the script (non-empty guard before each setter): `\set` from
   the rollback file → `set_sg_nas_password`, then `set_render_z_nas_password`; confirm
   digests equal the step 0 digests.
4. Restore admin_config in guarded transactions: set `WINDOWS_AGENT_NAS_USER` and
   `WINDOWS_AGENT_SG_NAS_USER` back to `ahazan` (pre-count 1, update, rowcount 1), and
   re-insert `WINDOWS_AGENT_NAS_PASS` with the rollback file's value (pre-count 0, insert,
   rowcount 1).
5. Restart the agent (admin path, force_restart) and confirm the mounts come back under ahazan.
