# #179 3b: rotate the NAS `ai` account password (edgesynology1 and edgesynology2)

Owner: Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 (hetz). Values are never written here.

## Why
- The current `ai` password was exposed in this session's tool output on 2026-10-14 (issue #179 leak record). Treated as compromised.
- Both units hold the same value (vault items `edgesynology1 NAS - ai service account` and `edgesynology2 NAS - ai service account`; matching digest prefix).

## Consumer inventory (done 2026-10-14, read-only)
- Password use: `sudo` prompts for user `ai` on both units only. Nothing in ai-devops, popdam3, synology-monitor or the Windows host reads the item or passes it to `sudo -S`.
- No cron entries or scheduled tasks for `ai` on either unit.
- Key login as `ai` (the hetz `916-alien` key, used by the SSH aliases in `~/.ssh/config`) does NOT use the password. It is the recovery path and is not changed.
- Not affected: NAS `popdam` (Not rotated, per Albert); NAS `ahazan`; the `hetzner_vps` token.

## Steps
1. Preflight: confirm key login as `ai` and `sudo -n -l` state on both units. Record `sshd` password-auth setting per port (read only).
2. Generate the new value on the hetz host into a protected file (umask 077, `openssl rand`, 32 characters, no shell expansion in argv). Never print it.
3. Stage: create a new vault item `NAS ai rotation staging (179) - edgesynology1/2` holding the new value, via `op` with the value read from the protected file (stdin or file, never argv). Verify by digest only.
4. Apply on edgesynology2 first, then edgesynology1: set the password for `ai` using the Synology account tool, feeding the value by stdin from the protected file. Verify: `sudo -S -v` succeeds with the new value (via stdin file) and FAILS with the old value.
5. Verify every consumer: sudo as `ai` on both units with the new value; key login as `ai` on both units; the hetz SSH aliases still connect.
6. Promote: update the two canonical items in place (same IDs) with the new value via the protected file; verify digest matches the staging item; diff the item to confirm only the password field changed.
7. Retire: rename the staging item with a retired suffix (do not delete). The old value is not stored anywhere after step 6.
8. Record evidence on issue #179 (no values): time, units, verification results.

## Recovery
- If step 4 fails on a unit: the change did not apply; key login is unchanged, so access is kept. Retry once after a read-only re-check. If sudo cannot be verified after the change, the staging item still holds the new value and the unit can be reset with the same protected-file procedure. The old value is not restored (it is exposed).
- Stop immediately if key login as `ai` fails on either unit; do not continue to the second unit.

## Done when
- Sudo as `ai` works with the new value on both units; the old value is refused on both.
- Both canonical vault items hold the new value (digest match); the staging item is retired.
- Evidence posted on #179, signed.

## Not in scope
- NAS `popdam`, NAS `ahazan`, the `hetzner_vps` token, DSM task owners, Samba write list (those are in the 3a plan).
