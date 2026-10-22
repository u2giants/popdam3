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

## Facts checked before execution (v2)
- **Local, not AD.** `/etc/passwd` on both units has a local `popdam` entry
  (uid 1039 edge1, 1038 edge2, home /var/services/homes/popdam). The agent logs
  in with `account=popdam` (no domain prefix) using the current 1Password
  value, which is the value set locally on Oct 1. `fix_admin_config_secret_rotation.md`
  predates that and is wrong on this point; this PR corrects it.
- **Break-glass:** the separate local admin `ai` (key SSH works on both units,
  sudo password in its own 1Password item, rotated Oct 14) can reset `popdam`
  with `/usr/syno/sbin/synouser --setpw` independent of popdam's own state.
  Step P1 proves `ai` sudo works on each unit before anything changes.
- **2FA:** step P2 reads `SYNO.Core.OTP` / user settings for popdam; any OTP
  enrolment → stop.
- **Coordination:** step P3 checks linked sessions / open #179 comments for a
  competing claim; posts a start notice on #179. hetz `ai` rotation is already
  done (Oct 13), so no ordering conflict.

## Preflight (no change)
- P1. On each unit: `sudo -S -k -v` as `ai` succeeds (ai value from file).
- P2. As popdam with the current value: DSM API login (POST body from file,
  `curl -sk`, `https://localhost:5001/webapi/entry.cgi`, `SYNO.API.Auth` v7)
  succeeds → this is the same call the agent makes; logout. No OTP.
- P3. Coordination as above. Record agent container name via
  `docker ps --filter label=com.docker.compose.project` and compose project of
  `/volume1/docker/synology-monitor-agent/compose.yaml`
  (`docker-compose config --services`); they must match one container.
- P4. Rehearsal of the write shape: `SYNO.Core.User set` with
  `name=popdam`, `password=<current value>` (no-op); require `success:true`,
  then DSM login with current value still succeeds.
- Failed-login budget: zero DSM failures planned. The only negative probe
  (old value) uses `sudo -S -k -v` over popdam key SSH, which uses PAM, not DSM
  auto-block. If any DSM login fails unexpectedly: stop, read auto-block list.

## Steps (edgesynology2 first, then edgesynology1; stop on any failure)
0. Generate the new value (32 chars, `[A-Za-z0-9]` only) with the 1Password
   generator into a NEW item `NAS popdam staging 179-<UTC timestamp>` (unique
   per attempt; old items untouched). Record its digest
   (`printf %s | sha256sum`, no trailing newline). A crash at any point leaves
   old value in the canonical items and new value in the staging item, so both
   are always recoverable.
1. Per unit, one reviewed script file; secrets only in 0600 files under ai's
   home (old, new, ai sudo), xtrace off, output to a file read only for
   status words and counts; files shredded at the end:
   a. `docker stop <agent>` (from P3), so no stale-value DSM logins happen.
   b. `cp -p .env .env.bak.179-<ts>` (root 0600).
   c. DSM login as popdam (old) → SID; `SYNO.Core.User set name=popdam
      password=@newfile`; logout. Require `"success":true`.
   d. Accept/refuse proof: DSM login with NEW succeeds (then logout);
      `sudo -S -k -v` as popdam with NEW succeeds, with OLD fails.
   e. `.env` rewrite: require exactly one `^DSM_PASSWORD=` line and no
      `export`/quotes/CRLF on it first; then `grep -v '^DSM_PASSWORD='` +
      `printf 'DSM_PASSWORD=%s\n'`; check: other lines byte-identical
      (`diff` of the two files with that line removed is empty), exactly one
      DSM_PASSWORD line whose value digest = new digest; mode 0600 root;
      `docker-compose config -q` passes.
   f. `docker-compose up -d --force-recreate <service>`; proof within 3 min:
      one agent container running, log "Connected to DSM API", 0
      "Failed to login"; auto-block list unchanged from P-snapshot.
2. 1Password (after BOTH units pass): `item_edit` / `password_update` of field
   `password` on both canonical items (same IDs), value from the staging item
   via op_run (never argv/transcript); remove the 2026-10-01 PENDING-APPLY
   paragraph; verify both digests = new digest; rename staging to
   `RETIRED …`.
3. Canary: 2 hours after step 1f, DSM Log Center/connection log on both units
   shows no failed popdam login; agents still connected. Post #179 result.

## Rollback
- Fail in P1–P4 or 1a–1b: restart the agent if stopped; nothing else changed.
- Fail at 1c (no success): agent restart with old `.env`; stop.
- Fail at 1d–1f on a unit: set password back to OLD via the same API call
  authenticated with NEW; if that login fails, break-glass `ai` +
  `synouser --setpw popdam` from the old-value file; restore `.env.bak.179-<ts>`;
  `up -d --force-recreate`; prove agent connected.
- **Split-brain:** if edge2 passed and edge1 fails anywhere, roll edge1 back
  (above) **and** roll edge2 back to OLD the same way, so both units and
  1Password stay on one value. Staging item is then renamed `ABANDONED …`.

## Follow-ups (not in this run)
- Scrub dead pre-Oct-1 copies listed above; edge2 `monitor-start.sh` is
  world-writable and embeds a dead password — open a separate issue.
- Watch for leftover Windows remembered credentials for `popdam` on the render
  host (render agent now uses popdam-render); stale entries simply fail.

## Done when
Both units accept the new value (DSM login + sudo) and refuse the old (sudo);
both agents connected with 0 login failures after 2 h; both 1Password items
hold the new value (digest match); staging item retired; #179 updated.
