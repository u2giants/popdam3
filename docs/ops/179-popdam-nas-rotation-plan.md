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

## Steps (edgesynology2 first, then edgesynology1; stop on any failure)
0. Generate new value (32 chars, letters+digits, no shell-special chars) into a
   NEW 1Password item `NAS popdam staging 2026-10-21` (old items untouched).
   Record new digest. Non-empty guard (`[ -s file ]`) before every use.
1. Per unit, one reviewed script file, secrets only in 0600 files under ai's
   home (old value, new value, ai sudo value), xtrace off, output to a file
   inspected only by line count/status words:
   a. `cp -p .env .env.bak.179-20261021` (root 0600) — rollback copy.
   b. DSM login as popdam with old value → SID; `SYNO.Core.User set
      name=popdam password=<new>`; logout. Require `"success":true`.
   c. Verify: `ssh popdam@unit` (key) + `sudo -S -k -v` with new value succeeds,
      with old value fails (sudo failure does not touch DSM auto-block).
   d. Rewrite `.env` `DSM_PASSWORD=` line with new value via shell builtins
      (`grep -v` + `printf`), keep mode 0600 root; diff line count equals old.
   e. `docker-compose up -d` in the agent dir (recreates with new env).
   f. Proof: within 3 min container running, log has "Connected to DSM API",
      0 "Failed to login" lines; DSM auto-block list unchanged.
   g. Shred the secret files.
2. 1Password: write new value into both canonical popdam items in place (same
   IDs); remove the 2026-10-01 PENDING-APPLY paragraph; verify digests match
   the new value; rename staging item to `RETIRED …` (not deleted).
3. Post result on #179 (no values).

## Rollback
- If 1b fails: nothing changed on that unit; stop.
- If 1c–1f fail after 1b succeeded: set password back to old value with the
  same API call (new→old), restore `.env.bak.179-20261021`, `docker-compose up -d`,
  prove agent logs "Connected to DSM API". Old value stays in 1Password until
  step 2, so it is always recoverable.
- edgesynology1 is only touched after edgesynology2 fully passes 1f.

## Done when
Both units accept the new value and refuse the old; both agents connected with
0 login failures; both 1Password items hold the new value (digest match);
staging item retired; #179 updated.
