---
summary: Long-running batch operations are Railway worker handlers; Supabase edge functions are request-response only.
kind: decision
status: current
read-when: deciding where a background or bulk job should run
---

# Batch operations live in the Railway worker

**Decided:** recorded 2026-07-29 (and in `docs/idiosyncrasies.md`).

**Decision:** every long-running batch or bulk operation is a handler in `apps/worker/src/handlers/` on the Railway worker. Edge functions hold only the registry entry. `supabase/functions/bulk-job-runner` is a deployed no-op, and PopSG file tagging (`tag-popsg-files`) also runs in the worker.

**Why:** the large `supabase/functions/` tree makes "where does this job run?" pattern-match to the wrong answer; a session once misattributed a resume cursor to an edge function.

**Rejected:** running bulk operations in edge functions.

## Source

- [docs/idiosyncrasies.md, bulk-job-runner edge function is a deployed no-op](../idiosyncrasies.md#bulk-job-runner-edge-function-is-a-deployed-no-op)
- private memory note project_batch_ops_live_in_worker (outside this repo)
