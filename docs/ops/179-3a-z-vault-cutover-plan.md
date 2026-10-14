# #179 item 3a: Z: NAS password in Vault and popdam-render cutover

Status: draft for final-check. Owner: Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 on hetz.
Times in EDT.

## Goal
Windows render agent (EDGE-ALIEN) reads the Z: (mac share) password from Vault and uses
the least-privilege DSM account `popdam-render` (RW on `mac`, RO on `styleguides`) instead
of `ahazan`. No plaintext NAS password remains in admin_config.

## Preconditions (all must hold before step 1)
1. shared-db migration `20261014043757_render_z_nas_password_vault` merged and applied to
   production by the promotion workflow (popcre/shared-db PR #4284).
2. popdam3 PR #392 (agent-api serves the Z: password from the RPC) merged and deployed.
3. `ai-task-gates check --before production --reviewer-approval <report>` passes for each production step.

## Steps
1. Load the Z: password into Vault. Source: 1Password vibe_coding item
   "edgesynology2 NAS - popdam-render service account". Value moves 1Password -> protected
   file (umask 077) -> psql `\set` reading that file. Never in arguments, stdout, stderr or xtrace.
   Verify by SHA-256 of the value against the 1Password digest, never by printing it.
2. Verify through the RPC only: `get_render_z_nas_password()` returns the same digest.
3. Guarded transaction: set admin_config `WINDOWS_AGENT_NAS_USER` = `popdam-render`.
   Assert row count 1 before and after.
4. Y: (styleguides): set `WINDOWS_AGENT_SG_NAS_USER` = `popdam-render` and update the Vault
   secret `popdam_sg_nas_password` with the same account's password (same digest check).
5. Restart the agent through the admin path as ai-admin@designflow.app (force_restart).
   Credentials from 1Password, never typed into commands.
6. Verify from the agent log: preflight "NAS access OK"; Z: and Y: mounts use popdam-render.
7. Live render proof: one Z: job and one Y: job complete with a thumbnail upload.
8. Delete plaintext `WINDOWS_AGENT_NAS_PASS` from admin_config (guarded transaction, count 1 -> 0).
   Rollback: the value is still in Vault, so the RPC path keeps working.
9. Remove `ahazan` from edgesynology2 share ACLs (smb.share.conf write list and valid users).
   Backup the file first; rollback is restoring it and reloading smbd.
10. Reassign DSM scheduled tasks 9 and 10 away from `ahazan`. If DSM access is not available
    to the AI, report Blocked with the exact error; do not work around it.

## Done when
- Live render completes on Z: and on Y: under popdam-render.
- admin_config has no WINDOWS_AGENT_NAS_PASS row.
- No ahazan login is used by the render agent (log shows popdam-render only).

## Rollback
Restore admin_config WINDOWS_AGENT_NAS_USER and WINDOWS_AGENT_SG_NAS_USER to `ahazan`, restore the
Vault secrets to the previous values, restart the agent, restore the smb.share.conf backup.
