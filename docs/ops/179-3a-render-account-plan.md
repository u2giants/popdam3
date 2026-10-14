# #179 3a: popdam-render least-privilege account, Z:/Y: switch, live render proof

Owner: Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 (hetz). No secret values in this file.

## Why
- The Windows render agent (EDGE-ALIEN, 100.112.207.98, task `PopDAM Windows Render Agent`, now build 0.16.7.175 which includes the remount fix from PR #383) maps the NAS shares as user `ahazan` (Albert's personal account) through admin_config `WINDOWS_AGENT_NAS_USER` / `WINDOWS_AGENT_NAS_PASS`.
- Target: a dedicated non-admin DSM user `popdam-render` with the minimum share rights. Z: = share `mac` (read and write, TIFF jobs write there). Y: = share `styleguides` (read).

## Facts (read-only inventory, 2026-10-14, edgesynology2)
- `mac` (/volume1/mac) ACL: owner admin; `user:ahazan` rwx; `group:ReadOnlyDesign` read; `group:administrators` full; `everyone` NOT present.
- `styleguides` (/volume1/styleguides) ACL: owner admin; `user:ahazan` rwx; `everyone` rwx; `group:administrators` full.
- Samba share file (/etc/samba/smb.share.conf) shows placeholder `nobody` in write/valid lists. The effective rights are the DSM ACLs above, not that file.
- DSM scheduled tasks owned by `ahazan`: ID 9 "Stop SMB" (disabled) and ID 10 "Start SMB" (disabled). All other tasks are root-owned.
- Group `ReadOnlyDesign` (GID 65540) has no members listed.
- Docker sudo grant script (/volume1/docker/popdam/ai-docker-sudo-enable.sh) grants ahazan NOPASSWD docker; it is a manual ritual and is not active unless run.

## Scope (same plan, per coordinator)
1. Create DSM user `popdam-render` (not in `administrators`, no DSM admin privilege).
2. Add `popdam-render` to the ACLs: `mac` read-write, `styleguides` read-only. Keep `ahazan` until step 8 (no removal before proof).
3. Switch admin_config `WINDOWS_AGENT_NAS_USER` and `WINDOWS_AGENT_NAS_PASS` (and the styleguides credential if it is separate) to `popdam-render`. Store the new password in vault item `edgesynology2 NAS - popdam-render service account`.
4. The agent remaps Z: and Y: on the next claim-gate cycle (remount-on-credential-change, PR #383). Verify the agent logs a successful remap with `popdam-render`, not `ahazan`.
5. Live render proof: a render job by agent d287e3f9 on a mac asset completes after the switch. Record job id and result.
6. Y: check: a styleguides PopSG job or read check via the agent completes with `popdam-render`.
7. Re-point the docker sudo grant from `ahazan` to `ai` (remains manual; no change while idle).
8. After steps 4 to 6 pass: remove `ahazan` from the `mac` and `styleguides` ACLs, and reassign or disable DSM tasks 9 and 10 (owner `ahazan`) to root. Re-verify the render proof after the removal.
9. Post evidence on #179 (no values).

## Accepted risks
- `synouser --add` and `--setpw` take the password as an argument. The value is in that command's argument list for its duration. Same accepted risk as 3b, on units whose local users are admin accounts only.
- Values reach remote commands only through a protected file used as stdin, with the script passed as an argument. No secret is placed inside a script body.

## Rollback
- Before step 8: re-point admin_config to the previous values (the ahazan credential still works). Remove `popdam-render` from the ACLs and delete the user if needed.
- After step 8: re-add `ahazan` to the ACLs (its ACL entry is recorded here: `mac` rwx; `styleguides` rwx) before any other change.
- Stop if the agent cannot claim any render job for 30 minutes after step 3.

## Done when
- Live render completes with `popdam-render` as the Z: user; Y: read works; `ahazan` is off both ACLs; DSM tasks 9 and 10 have owner root; evidence posted on #179.

## Not in scope
- NAS popdam (Not rotated, per Albert); `hetzner_vps` token; NAS `ahazan` password (not rotated in this plan); edgesynology1 shares (not changed).
