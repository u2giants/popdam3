---
summary: The GPU poller on edge-dev with its own database login is the durable embedding runner for both DAM and PopSG (D3, O1).
kind: decision
status: current
read-when: changing where embeddings are computed, or its database credentials
---

# GPU poller is the durable embedding runner

**Decided:** D3 on 2026-11-02 (#646) for DAM; O1 on 2026-11-04 (#706) for the PopSG lane.

**Decision:** the GPU poller on `edge-dev` with its own login `dam_image_embed_login` is the durable runner and must never depend on the shared `postgres` password. PopSG gets a lane in the GPU poller. Failures are shown, never masked as empty results (D4, 2026-11-01, #564).

**Why:** the Railway operation embedded file names through the text tower, and nonsense outscored real searches. Railway has no GPU; 150k thumbnails at CPU speed is days per pass. A nightly one-shot Task Scheduler runner already failed twice.

**Rejected:** a Railway CPU embedder for DAM documents; a nightly one-shot job; the original rule of keeping the Railway `sg-embed-search` operation if it hit 2,000 pages per hour (superseded).

## Source

- [plan_vector_consolidation.md sections 7 and 8](../../plan_vector_consolidation.md)
