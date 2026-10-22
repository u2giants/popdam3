# #179 — Rotate NAS user `popdam` (edgesynology1 + edgesynology2)

Owner request (Albert, quoted verbatim from his chat by the coordinator
session local_24a4f673, 2026-10-21; the coordinator relays owner words, and
the owner rule is that no human approval is requested): "change the NAS password for user 'popdam' and record it in 1password".
This lifts the earlier "Not rotated, per Albert" hold for this credential only.

## Credential and provider
- Credential: Synology local user `popdam` (administrators) on edgesynology1
  (100.107.131.35) and edgesynology2 (100.107.131.36). Same value on both (owner
  decision 2026-10-01).
- Provider: DSM on each unit, self-service change from the unit itself over
  `https://localhost:5001`: `SYNO.Core.User.PasswordConfirm` v2 then
  `SYNO.Core.NormalUser` v2 `set`, authenticated as `popdam` with the current
  value; secret fields only as `--data-urlencode name@file`, never argv.
- 1Password (vibe_coding): `edgesynology2 NAS - popdam service account`
  (fkyspggk…) and `edgesynology1 NAS - popdam service account` (gtwd6lf6…).
  Live value verified by digest comparison only (digests are not recorded here).

## Consumers (inventory 2026-10-21, value-match scan as root over /volume1/docker,
/volume1/@docker/containers, /etc, /usr/syno/etc, homes, @appstore,
/usr/local/etc on both units; hetz /etc /opt /srv /worksp /root docker volumes
and all running container env; Supabase Vault digests)
1. `synology-monitor-agent` on both units: `/volume1/docker/synology-monitor-agent/.env`
   `DSM_PASSWORD` (root 0600) and the running container env. **Only live consumer.**
2. AI maintenance: key SSH as `popdam` + `sudo -S` (interactive, reads 1Password).
- Not consumers: Supabase Vault `popdam_render_z_nas_password` and
  `popdam_sg_nas_password` both hold the popdam-render value (digest-verified);
  admin_config NAS PASS rows were deleted Oct 13/14. Windows render agent uses
  popdam-render for Z: and Y:.
- Dead copies of the pre-Oct-1 value (already refused): `.env.bak*`,
  `.env.pre_drive`, old container configs, edge2 `monitor-start.sh`, edge1
  `~ahazan/run.sh`, hetz synology-monitor-web env `NAS_EDGE*_PASSWORD` (not read
  by any code: `git grep NAS_EDGE` in u2giants/synology-monitor finds nothing).
  Left as-is; follow-up issue to scrub.

## Executable: `deploy/synology/rotate-popdam-password.sh` (v3)
All NAS steps are in that one reviewed script (modes `rotate`, `rollback`),
run as root via `sudo -S` by the `ai` account, driven from hetz by
`deploy/synology/rotate-popdam-caller.sh <host> <mode> <staging-item-id>`:
`op read -n` writes old/new/ai-sudo values straight into 0600 files in a 0700
temp dir; `scp` copies old, new and the script into a fresh 0700
`/var/services/homes/ai/.r179`; only the ai sudo file is the remote sudo's
stdin; the remote dir is removed in the same ssh command and again by an EXIT
trap. The caller prints only lines that start with a status word and a count
of any other lines. The script enforces: 0700 dir, 0600 files, no newline,
no `"`/`\`, new != old, new is 32 chars `[A-Za-z0-9]` with a digit, a
`flock` against concurrent runs, `curl --max-time 30`, and an EXIT trap that
removes its temp files. The
script reads secrets only from files (`curl --data-urlencode name@file`,
`cat`, `printf` builtin); no secret is in argv, stdout, stderr or xtrace.
Output is status words only (`STEP …`, `OK …`, `FAIL: …`, DSM error codes).
Binaries: `/usr/local/bin/docker`,
`/var/packages/ContainerManager/target/usr/bin/docker-compose`; service and
container name `synology-monitor-agent` (one container per unit, compose
project dir `/volume1/docker/synology-monitor-agent`, verified both units).

## Rehearsal evidence (2026-10-21)
- **Mutating DSM path, both units:** `selftest` on a throwaway local user
  `r179test` (random non-secret test values; created with `synouser --add`,
  deleted after): set old→new `success`, new accepted, old refused, reset
  new→old, old accepted → `OK selftest` on edgesynology2 and edgesynology1;
  user gone afterwards (`/etc/passwd` count 0), no staging dir left.
- **probe** via the caller on both units: `old=accepted new=refused`
  (`new` was a dummy item; one failed DSM login per unit).
- **agentcheck** via the caller on both units (non-mutating): running
  container env digest = current value; agent recreated with the unchanged
  `.env` and logged "Connected to DSM API" → `OK agentcheck`. This proves
  `container_env_is`, `agent_up`, compose recreate and log reading.
- **Auto-block** (`/etc/synoinfo.conf`, both units): 10 attempts in 5 min,
  `autoblock_expriedday=0` (blocks never expire). Budget per unit per run:
  rotate ≤ 2 failed DSM logins (old-refused probe, plus one in a rollback
  probe); probe ≤ 1; agent stopped during the change so it adds none, and
  `agent_up` stops the agent after its 2nd failed attempt. Total stays well
  below 10. If a block appears, remove only the 127.0.0.1 row from
  `/etc/synoautoblock.db` (`sqlite3 … "delete from AutoBlockIP where IP='127.0.0.1'"`).
- Password policy read on edge1 (min 6, needs a digit, `exclude_history:false`
  = reuse allowed, so rollback to OLD is permitted); edge2 is covered by the
  `selftest` (32-char alnum-with-digit value accepted).

## Preflight evidence (2026-10-21, no change)
- Transport proven end to end on both units with the committed caller:
  `rollback` with a dummy item stopped at "no backup holding old" (before any
  change) after root took ownership of the staged dir and verified the
  script hash; `rc=1 other_lines=0`; no `.r179*` dir left on either unit.
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
- Current value shape (both canonical items, `op read -n`, checked locally
  without printing): non-empty, contains no `"`, `\` or newline, so it is a
  valid JSON string body and passes the script's input checks.
- `.env` on both: exactly one `DSM_PASSWORD=` line, unquoted, no CR, no
  `export`; the script re-checks the line count, quoting/CR and trailing
  newline before the password is changed; its digest equals the 1Password value; `DSM_USERNAME=popdam`.
- Write shape: `SYNO.Core.User.PasswordConfirm` v2 `auth` (→
  `SynoConfirmPWToken`) then `SYNO.Core.NormalUser` v2 `set`
  (`old_password`, `password`, JSON-quoted) over a `session=webui` SID with
  SynoToken. A same-value probe returned `success:true` on edge2 and DSM 3101
  (same-value refusal at validation) on edge1; both prove the call is
  authorised and parsed. `SYNO.Core.User set` returns 105 and is not used.
- Agent logs: json-file driver, `docker logs --since` works on both units;
  edge2 shows the startup "Connected to DSM API" line; edge1's has rotated
  out, so proof always reads logs since the recreate. Restart policy
  `always`. `docker-compose config -q` passes on both; `sha256sum`, `curl`,
  `cmp`, `mktemp`, `flock`, `stat` present.
- Replication: ShareSync edge2←edge1 authenticates as `ahazan` (#179 Oct 1),
  not popdam; no Hyper Backup / Snapshot Replication task uses popdam (value
  scan of `/usr/syno/etc` and `@appstore` found only the agent).
- Auto-block list: 1 entry on edge2, 2 on edge1 (recorded; must not grow).
- Only live consumer: the monitor agent on each unit (value scan above).

## Steps
0. Reconcile first (also after any crash): for each unit and each
   unarchived `NAS popdam staging 179-*` item, run
   `rotate-popdam-caller.sh <unit> probe <staging-id>` (reports old/new
   accepted/refused; at most one failed DSM login per value, far under the
   auto-block threshold). Converge: unit on a staging
   value and the other on canonical → run `rotate` on the other with that
   staging value, or `rollback` on the first; both on staging → finish step 4.
   Never generate a new staging item while an older one is accepted anywhere.
   Coordination: re-read #179 and linked sessions for a competing NAS claim;
   post a start notice on #179. `ai-task-gates check --before production`
   with this plan's reviewer APPROVE (exact head).
1. Generate the new value with the 1Password generator into a NEW item:
   `op item create --vault vibe_coding --category Password
   --title "NAS popdam staging 179-<UTC ts>-<4 random hex>"
   --generate-password=32,letters,digits --format json | jq -r .id`
   (value never displayed; at most 3 attempts); then `op read -n` into a 0600 file and check 32 chars,
   `[A-Za-z0-9]`, at least one digit; otherwise archive it and generate again.
   Canonical items
   keep the old value until step 4, so a crash always leaves both values in
   the vault.
2. edgesynology2: `rotate` (edge2 first: it is the read replica, so a
   failure there touches the less critical unit). The script: proves OLD is
   accepted, stops the agent (no stale-value
   logins), backs up `.env` to `.env.bak.179-<ts>` (root 0600), confirms +
   sets the new password, proves DSM login with NEW succeeds and with OLD
   fails (one planned failure per unit, agent stopped; auto-block default is
   far above 1), rewrites `DSM_PASSWORD` (exactly-one-line check, other lines
   byte-identical via `cmp`, value digest check, root 0600, `compose config
   -q`), recreates the agent with `up -d --force-recreate`, waits up to 3 min
   for "Connected to DSM API" (the agent is stopped at its 2nd failed attempt), and
   checks the running container env digest. If `set` reports an error the
   script probes whether NEW is now accepted before claiming "unchanged". Any
   failure after the password may have changed runs the state-aware restore
   (whichever value DSM accepts → OLD, `.env` backup restored by temp+rename,
   agent recreated, container env digest = OLD).
3. edgesynology1: same, only after step 2 printed `OK rotate`.
   **Split-brain:** if edge1 fails, run `rollback` on edge2 so both units and
   the vault stay on the old value; staging item → `ABANDONED …`. If that
   edge2 rollback also fails, `probe` edge2 first; if it accepts the staging
   value, copy that into the edge2 canonical item only, mark edge1/edge2
   values as different in both item notes, and report Blocked on #179.
4. 1Password: for each canonical item (edge2 fkyspggk…, then edge1
   gtwd6lf6…): `op read -n op://vibe_coding/<staging>/password > $T/v` (0600);
   `op item get <id> --format json > $T/before.json`;
   `jq --rawfile v $T/v '(.fields[] | select(.id=="password") | .value) = $v
   | .fields |= map(if .id=="notesPlain" then .value |= sub("STATUS 2026-10-01: PENDING-APPLY[^\n]*\n\n"; "") else . end)'
   $T/before.json | op item edit <id>` (stdin only). Before and after: a full-item diff of everything except the
   password value and notes must be empty, and `op read -n` digest must equal
   the staging digest. Rehearsed first on a throwaway item. Staging → renamed
   `RETIRED …`. A crash mid-step leaves the staging item as the source; rerun.
5. Post-checks: auto-block counts unchanged; 2 h later both agents still
   connected with no failed popdam DSM logins in the agent logs. Post the
   result on #179.

## Break-glass
If a unit refuses both values (script prints `BREAK-GLASS needed`): `ai`
(independent local admin, sudo proven in preflight) runs
`synouser --setpw popdam "$(cat old)"` as root, restores the newest
`.env.bak.179-*` and runs `docker-compose up -d --force-recreate
synology-monitor-agent`, then proves "Connected to DSM API". This is the only
step that would put a value in argv (visible for milliseconds in `/proc`); it
is used only in that emergency, and the value is then rotated again.
Account protection: after each unit, the auto-block count and DSM account
protection state for popdam are read; growth → stop and clear the entry for
127.0.0.1 only.

## Not in scope / follow-ups
- Dead copies of the pre-Oct-1 value (already refused): `.env.bak*`,
  `.env.pre_drive`, old container configs, edge2 `monitor-start.sh`
  (world-writable boot script that embeds that dead value), edge1
  `~ahazan/run.sh`, hetz synology-monitor-web env `NAS_EDGE*_PASSWORD`. Scrub
  under a separate follow-up; they cannot authenticate.
- Old-value clients: the only known one, the render host's former Y:/Z:
  mapping, moved to popdam-render on Oct 14 and its agent shows no popdam
  sessions. Post-check 5 watches for failed popdam logins and auto-block
  growth for 2 h; any hit → find that client, update it, clear the block.

## Done when
Both units accept the new value and refuse the old (DSM login); both agents
connected with 0 login failures; both 1Password items hold the new value
(digest match); staging item retired; #179 updated.
