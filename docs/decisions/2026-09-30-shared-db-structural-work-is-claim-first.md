---
summary: Shared-db structural work is claim-first on the existing issue; there is no db coordinator or orchestrator to wait on.
kind: decision
status: current
read-when: about to report shared-db work as blocked on a coordinator or marker
---

# Shared-db work is claim-first

**Decided by:** Albert, 2026-09-30: "there is no longer a db coordinator. Shared-db structural work is now claim-first: claim exact objects on the existing issue and start; no orchestrator chat or marker."

**Decision:** claim the exact objects on the existing issue and start. Never mark structural work blocked on an orchestrator. If lane tooling still demands a marker, repair the tooling.

**Why:** sessions twice reported work as blocked on a coordinating session that no longer exists.

**Rejected:** waiting on an orchestrator chat.

## Source

- private memory note feedback_shared_db_claim_first_no_coordinator (outside this repo)
