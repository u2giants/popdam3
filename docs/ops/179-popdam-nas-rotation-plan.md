# #179 — Rotate NAS user `popdam` (edgesynology1 + edgesynology2)

Owner request (Albert, relayed verbatim from his chat by the coordinator session,
2026-10-21): "change the NAS password for user 'popdam' and record it in 1password".
This lifts the earlier "Not rotated, per Albert" hold for this credential only.

## Credential and provider
- Credential: Synology local user `popdam` (administrators) on edgesynology1
  (100.107.131.35) and edgesynology2 (100.107.131.36). Same value on both (owner
  decision 2026-10-01).
- Provider: DSM on each unit. Set via `SYNO.Core.User` `method=set` over
  `https://localhost:5001` from the unit itself, authenticated as `popdam` with
  the current value; all secret fields sent as `--data-urlencode name@file`
  (POST body read from a 0600 file), never argv.
- 1Password (vibe_coding): `edgesynology2 NAS - popdam service account`
  (fkyspggk…) and `edgesynology1 NAS - popdam service account` (gtwd6lf6…).
  Current live value digest sha256[:12] = 7454b34da002.

## Consumers (inventory 2026-10-21, value-match scan as root over /volume1/docker,
/volume1/@docker/containers, /etc, /usr/syno/etc, homes, @appstore,
/usr/local/etc on both units; hetz /etc /opt /srv /worksp /root docker volumes
and all running container env; Supabase Vault digests)
1. `synology-monitor-agent` on both units: `/volume1/docker/synology-monitor-agent/.env`
   `DSM_PASSWORD` (root 0600) and the running container env. **Only live consumer.**
2. AI maintenance: key SSH as `popdam` + `sudo -S` (interactive, reads 1Password).
- Not consumers: Supabase Vault `popdam_render_z_nas_password` and
  `popdam_sg_nas_password` both hold the popdam-render value (digest b798dac8…);
  admin_config NAS PASS rows were deleted Oct 13/14. Windows render agent uses
  popdam-render for Z: and Y:.
- Dead copies of the pre-Oct-1 value (6c928f86…, already refused): `.env.bak*`,
  `.env.pre_drive`, old container configs, edge2 `monitor-start.sh`, edge1
  `~ahazan/run.sh`, hetz synology-monitor-web env `NAS_EDGE*_PASSWORD` (not read
  by any code: `git grep NAS_EDGE` in u2giants/synology-monitor finds nothing).
  Left as-is; follow-up issue to scrub.

## Executable: `deploy/synology/rotate-popdam-password.sh` (v3)
All NAS steps are in that one reviewed script (modes `rehearse`, `rotate`,
`rollback`), run as root via `sudo -S` by the `ai` account. The caller copies
the script and 0600 secret files (`old`, `new`; bare values, no newline) into a
0700 dir `/var/services/homes/ai/.r179`, pipes only the ai sudo value to
`sudo -S -p ''`, and deletes the dir afterwards in the same ssh command. The
script reads secrets only from files (`curl --data-urlencode name@file`,
`cat`, `printf` builtin); no secret is in argv, stdout, stderr or xtrace.
Output is status words only (`STEP …`, `OK …`, `FAIL: …`, DSM error codes).
Binaries: `/usr/local/bin/docker`,
`/var/packages/ContainerManager/target/usr/bin/docker-compose`; service and
container name `synology-monitor-agent` (one container per unit, compose
project dir `/volume1/docker/synology-monitor-agent`, verified both units).

## Preflight evidence (2026-10-21, no change)
- Local, not AD, on both units: `wbinfo -t` fails (not domain-joined),
  `wbinfo -u` has no popdam, `synouser --get popdam` finds the local user
  (uid 1038 edge2 / 1039 edge1). DSM login `account=popdam` with the current
  1Password value succeeds on both. `fix_admin_config_secret_rotation.md` is
  corrected in this PR.
- OTP: `SYNO.Core.NormalUser get` → `OTP_enable:false`, `OTP_enforced:false`,
  `disallowchpasswd:false`.
- Password policy (edge1): min 6, must include a digit, excludes common and
  username, `exclude_history:false`. New value: 32 chars `[A-Za-z0-9]` with
  at least one digit.
- `.env` on both: exactly one `DSM_PASSWORD=` line, unquoted, no CR, no
  `export`; its digest equals the 1Password value; `DSM_USERNAME=popdam`.
- Write shape: `SYNO.Core.User.PasswordConfirm` v2 `auth` (→
  `SynoConfirmPWToken`) then `SYNO.Core.NormalUser` v2 `set`
  (`old_password`, `password`, JSON-quoted) over a `session=webui` SID with
  SynoToken. `rehearse` (set to the same value) → `success:true` on edge2;
  edge1 returned DSM 3101 (same-value refusal at validation), so the shape
  is accepted there too. `SYNO.Core.User set` returns 105 for this account and
  is not used.
- Auto-block list: 1 entry on edge2, 2 on edge1 (recorded; must not grow).
- Only live consumer: the monitor agent on each unit (value scan above).

## Steps
0. Coordination: re-read #179 and linked sessions for a competing NAS claim;
   post a start notice on #179. `ai-task-gates check --before production`
   with this plan's reviewer APPROVE (exact head).
1. Generate the new value with the 1Password generator into a NEW item
   `NAS popdam staging 179-<UTC ts>` (unique per attempt). Canonical items
   keep the old value until step 4, so a crash always leaves both values in
   the vault.
2. edgesynology2: `rotate`. The script: stops the agent (no stale-value
   logins), backs up `.env` to `.env.bak.179-<ts>` (root 0600), confirms +
   sets the new password, proves DSM login with NEW succeeds and with OLD
   fails (one planned failure per unit, agent stopped; auto-block default is
   far above 1), rewrites `DSM_PASSWORD` (exactly-one-line check, other lines
   byte-identical via `cmp`, value digest check, root 0600, `compose config
   -q`), recreates the agent with `up -d --force-recreate`, waits up to 3 min
   for "Connected to DSM API" with 0 "DSM login attempt N failed" lines, and
   checks the running container env digest. Any failure after the password
   change rolls the unit back automatically (password → old, `.env` restored,
   agent recreated and proven).
3. edgesynology1: same, only after step 2 printed `OK rotate`.
   **Split-brain:** if edge1 fails, run `rollback` on edge2 so both units and
   the vault stay on the old value; staging item → `ABANDONED …`.
4. 1Password: write the staging value into field `password` of both
   canonical popdam items (same IDs) via op_run (`op item edit` reading the
   value from env, never argv/transcript); remove the 2026-10-01 PENDING-APPLY
   paragraph; verify both digests equal the staging digest; rename staging to
   `RETIRED …`. Rehearsed first on a throwaway item.
5. Post-checks: auto-block counts unchanged; 2 h later both agents still
   connected with no failed popdam DSM logins in the agent logs. Post the
   result on #179.

## Break-glass
If a unit refuses both values: `ai` (independent local admin, sudo proven in
preflight) runs `synouser --setpw popdam` from the old-value file. This is
the only step that would put a value in argv; it is used only in that
emergency and the value is then rotated again.

## Not in scope / follow-ups
- Dead copies of the pre-Oct-1 value (already refused): `.env.bak*`,
  `.env.pre_drive`, old container configs, edge2 `monitor-start.sh`
  (world-writable boot script that embeds that dead value), edge1
  `~ahazan/run.sh`, hetz synology-monitor-web env `NAS_EDGE*_PASSWORD`. Scrub
  under a separate follow-up; they cannot authenticate.
- Leftover Windows remembered credentials for `popdam` on the render host
  would only fail (the agent uses popdam-render).

## Done when
Both units accept the new value and refuse the old (DSM login); both agents
connected with 0 login failures; both 1Password items hold the new value
(digest match); staging item retired; #179 updated.
