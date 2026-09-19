---
issue: 3024
status: OPEN
owner: claude/product-description-extraction-118fbe
---

# Product-type reader — plan written, implementation not started

Plan: [`../plan_product_type_reader.md`](../plan_product_type_reader.md). Read its STATUS table first;
start at step 1. Issue: popcre/shared-db#3024 (labelled `db-work` + `non-orchestrator`; live scope
`status: ready` — corrected 2026-09-18; this file originally said `blocked`).

Owner ruling 2026-09-16: the new value lives on `plm.item`, not `coldlion.item_header`.
Columns LANDED via orchestrator issue popcre/shared-db#3036 — closed COMPLETED 2026-09-17
(PR #3108 merged 2026-09-16, migration `20260916231639`). See plan STATUS step 7.

Nothing else was changed in the original 2026-09-16 session besides this handoff, the plan, and an
AGENTS.md pointer (commit `638a61ef`). The 2026-09-18 correction session changed only the status
lines above and carries the `.agent` evidence pair on its pull request (#3281).
