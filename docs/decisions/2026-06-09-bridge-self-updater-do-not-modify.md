---
summary: Do not modify the bridge agent Docker self-update logic; detect drift by build SHA instead.
kind: decision
status: current
read-when: about to edit anything under apps/bridge-agent update or recreate code
---

# Do not modify the bridge self-updater

**Decided:** owner warning, with the drift-detection alternative built 2026-06-09.

**Decision:** default stance is do not modify the self-update path (about 50 iterations to stabilize; re-broken by later edits). Any change under `apps/bridge-agent/**` publishes a new `:stable` image and forces every agent through the risky update. Make failures observable instead; the admin panel compares the agent's `build_sha` to the published one. The updater is now Compose-only through a detached one-shot helper container.

**Why:** the agent runs in a container with only the Docker socket, so the recreate ordering and canonical naming are brittle.

**Rejected:** reworking the recreate logic, and comparing version strings (which falsely showed "up to date").

## Source

- [docs/idiosyncrasies.md, Agent reported version can lie](../idiosyncrasies.md)
- private memory note project_bridge_self_updater (outside this repo)
