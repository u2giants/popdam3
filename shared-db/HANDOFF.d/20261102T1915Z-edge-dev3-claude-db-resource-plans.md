---
issue: 4664, 5188
status: OPEN
owner: unowned — next session claims
---

# Database resource usage — two speed-up plans, not started

Albert (2026-11-02) asked to investigate database load. Findings: connections 37/90, apps already pooled through Supavisor, so pooling is not the lever. Two slow jobs dominate. No database change was made.

- DAM embedding claim (~23 s/call, root cause found: sort key not in index) → [plan_dam-embedding-claim-speed.md](../plan_dam-embedding-claim-speed.md)
- HTS ruling search (~24 s/call, root cause NOT yet found; may already be fixed by #5283) → [plan_hts-ruling-search-speed.md](../plan_hts-ruling-search-speed.md)

Correction to the chat summary: the "vector step reads a 103k-row table" observation came from a synthetic query; the function skips that step without an embedding. Treat it as unproven.

Start at each plan's STATUS table.
