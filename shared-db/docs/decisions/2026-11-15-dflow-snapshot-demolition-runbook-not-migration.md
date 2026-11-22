---
summary: "Production-only retirement of the stale dflow seed schema is executed via merged runbook, not a migration (#6325)."
kind: decision
status: current
read-when: retiring environment-scoped schemas or touching dflow.* objects in migrations
---

# Production dflow seed schema retirement is a merged runbook, not a migration (#6325)

**Decided by:** Established 2026-11-15 (issue #6325)

## Decision

Retiring the stale production-only `dflow` seed schema is executed from a merged operational runbook (`docs/dflow-snapshot-demolition-runbook.md`), not a forward migration, because the migration suite deliberately builds and contract-tests `dflow` in CI/preview.

Sole documented exception to the rule against ad-hoc production SQL: must execute verbatim from the merged runbook.

## Why

Dropping `dflow` in a migration would break CI bootstrap and preview contract tests that intentionally test `dflow`.

## Rejected

Adding a `DROP SCHEMA dflow` migration to `supabase/migrations/`.

## Source

Original record (left in place): [`docs/dflow-snapshot-demolition-runbook.md`](../dflow-snapshot-demolition-runbook.md)
