# Bridge 1.16.12 adoption — 2026-09-16

The PopDAM/PopSG bridge on `edgesynology1` now runs `1.16.12`.

## What was wrong

The fail-safe self-updater refuses to recreate the container unless it can see a
Compose project definition, and deliberately never falls back to `docker run`.
The on-NAS `docker-compose.yml` was missing both additions that repo commit
`fc7bfa91` made to `deploy/synology/docker-compose.yml`:

- the `POPDAM_COMPOSE_PATH: /app/compose/docker-compose.yml` environment entry
- the `/volume1/docker/popdam:/app/compose:ro` volume

Two corrections to earlier sessions' notes: the live bridge is on
**`edgesynology1`**, not `edgesynology2`; and these containers are **not**
Container Manager projects — they were deployed from the command line, so a
project refresh was never the right instruction.

## How it was applied

A staged, re-runnable script patched the compose file in place, preserving
edge1's own host paths, then pulled the published image and recreated the
Compose-owned service. It took a timestamped backup of the compose file and
recorded the previous image id before changing anything. The owner ran it once
with `sudo`; an AI session could not, because `ahazan` cannot reach the Docker
socket and the passwordless sudo it used to have was deliberately disabled on
2026-09-03.

## Result — PASS

| Check | Result |
|---|---|
| Reported version | `1.16.12` |
| Build | `edcd8341bb8e3b054a3ff55601f4c61aeb4f39d9` |
| Container state | running |
| Restart count | 0 |
| Compose ownership | `com.docker.compose.project.working_dir` = `/volume1/docker/popdam` |
| Agent identity | `synology-bridge-1`, same id as before — no re-pair, no duplicate registration |
| `paired` | true |
| Heartbeat | continuous, ~15 s old at verification |
| `last_error` | none |
| NAS mount | `/mnt/nas/mac` exists, scan roots readable, marker check ok |
| NAS content | unchanged — nothing was written to either share |
| Rollback | compose backup retained; previous image id in `previous-image-before-1.16.12.txt` |

One benign startup warning: the AWS SDK notes that versions published after
early 2027 will require Node 22 and the image runs Node 20.20.2. Not an error
and not urgent, but worth scheduling before 2027.
