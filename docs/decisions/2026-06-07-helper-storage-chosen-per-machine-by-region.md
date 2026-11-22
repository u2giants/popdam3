---
summary: Helper checkout transport is chosen per machine by region (Brazil Seafile, USA Synology SMB), not by a global flag.
kind: decision
status: current
read-when: touching Helper checkout or storage-provider logic
---

# Helper storage provider is per-machine by region

**Decided:** design recorded with the Helper Seafile rollout (seeded 2026-06-07).

**Decision:** Brazil users use Seafile/SeaDrive; USA users use Synology `edgesynology1` over SMB. The Helper's local `preferredProvider` is the lever, set at install. The library catalog and fallback policy come from `admin_config` through `helper-api /config`. A library is matched by longest path-prefix on `relative_path`. Brazil keeps a Synology fallback over Tailscale SMB (an earlier "no fallback" assumption was reversed).

**Why:** the transport topology is not obvious from the code and breaks under a single global flag.

**Rejected:** a global `HELPER_SEAFILE_PREFERRED` switch for all designers.

## Source

- [docs/idiosyncrasies.md, Helper storage provider is per-machine/region](../idiosyncrasies.md#helper-storage-provider-is-per-machineregion-not-a-global-flag)
- [docs/SEAFILE_INTEGRATION.md](../SEAFILE_INTEGRATION.md)
- private memory note project_helper_storage_regions (outside this repo)
