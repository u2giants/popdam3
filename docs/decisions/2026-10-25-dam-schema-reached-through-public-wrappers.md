---
summary: The dam schema is not exposed to PostgREST; edge and worker calls use public SECURITY DEFINER wrappers (D2).
kind: decision
status: current
read-when: adding dam to the exposed schemas or calling dam.* directly from an edge function
---

# dam schema is reached through public wrappers

**Decided:** D2 in the vector consolidation plan, 2026-10-25 (image plan); recorded in `docs/idiosyncrasies.md` 2026-07-15.

**Decision:** reach `dam.*` through `public` SECURITY DEFINER functions granted to `service_role`. Structure changes go through `popcre/shared-db`.

**Why:** exposing `dam` broadens the shared API surface for every app and would need RLS on every `dam` table.

**Rejected:** adding `dam` to the exposed schema list; app-repo DDL or dashboard SQL.

## Source

- [docs/idiosyncrasies.md, The dam schema is NOT exposed to PostgREST](../idiosyncrasies.md)
- [plan_vector_consolidation.md section 8](../../plan_vector_consolidation.md)
