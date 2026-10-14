# Plan: #179 items 3c and 3d (Oct 13 2026)

## 3d: remove the plaintext PopSG NAS password from admin_config

Proof already done (Oct 13 2026, 9:41-9:43 PM EDT): admin-api `set-agent-command force_restart` was sent to windows-render-agent (id d287e3f9). After restart, preflight passed with "NAS access OK". A PopSG render job (fileId 43487bed) on the y: share completed and uploaded its thumbnail at 9:42:46 PM EDT. The job was requeued through the UI retry RPC.

Step 1 (delete): inside one guarded transaction, delete the single row `admin_config.key = 'WINDOWS_AGENT_SG_NAS_PASS'`, asserting row count = 1 before and 0 after. Target project: qsllyeztdwjgirsysgai (Virginia), proved first.

Why this is safe: agent-api (supabase/functions/agent-api/index.ts line ~390) overwrites `configMap.WINDOWS_AGENT_SG_NAS_PASS` with `get_sg_nas_password()` (Vault) on every config poll, so deleting the row does not change what the agent receives.

Rollback: the value lives in Supabase Vault (popcre/shared-db#4182). Re-insertion is not needed unless Vault is missing.

Verify after: agent heartbeat still served with sg_nas_password; a new PopSG job completes on y:.

## 3c: move ahazan-dependent NAS and hetz items to the ai account

Inventory (read-only, Oct 13 2026):
- hetz: no ahazan OS user, cron, systemd or process. The ahazan references are SSH client aliases in /home/ai/.ssh/config for edgesynology1, edgesynology2, edge1-direct and edge2-direct (User ahazan).
- edgesynology2: /volume1/docker/popdam/ai-docker-sudo-enable.sh grants ahazan NOPASSWD docker. /etc/samba/smb.share.conf lists ahazan in write and valid users for the mac share. /etc/sudoers.tmp is a stale file; it is not active.
- The Z: SMB credential (WINDOWS_AGENT_NAS_PASS) is ahazan's. Moving that credential is the render-account plan, which is out of scope for this step.

Steps in this plan (in order):
1. Set the hetz SSH client aliases for edgesynology1, edgesynology2, edge1-direct and edge2-direct to `User ai`. Key login as ai is verified on both NAS (port 22 and port 1904).
2. Prove each alias works: `ssh <alias> 'id -un'` prints `ai`.
3. Do NOT change samba, DSM scheduled tasks or sudoers in this plan; they need a sudo session and belong in the render-account plan.

Verification: each alias returns `ai`. Rollback: restore the saved ssh config backup.

Not in scope: the Z: credential, DSM task owners (not readable without root), NAS ai password rotation.

Owner: plan owner. Reviewer: final-check.
