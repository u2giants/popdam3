---
issue: 1984
status: OPEN
owner: codex/mg-historical-implementation-plan
---

# 0. Decisions only Albert can make

- No preview or production item row may be written until Albert explicitly authorizes that environment in the new implementation session.
- Production authorization must name the exact candidate-manifest SHA-256 digest after preview succeeds.
- Later treatment of partial MG01/MG02 proposals, unsupported old lower levels, retired `EP001`, and null/conflicting dates remains an owner decision.
- The May 14 cutoff may retire only after the complete live-population gate passes and Albert separately authorizes the structural change.

# 1. What this application is

`u2giants/shared-db` holds the public three-axis historical merchandise-group classifier and the shared Supabase contract. Private source spreadsheets, row outputs, backups, and the preserved final workbook live in `u2giants/licensor-source-data` under `shared-db-relocated/2026-08-30/`.

# 2. What this session set out to do

Independently verify PR #1651, issue #1662, the current matcher/workbook, identifiers, evidence, divisions, and production state; then write a guarded plan for approved historical MG01-MG03 row updates without writing database rows or retiring the cutoff.

# 3. Current state

- Current `origin/main` was fetched at `bff443d2`; the shared main checkout could not fast-forward because another session's untracked document would be overwritten, so this clean isolated worktree was created from exact `origin/main`.
- PR #1651 is merged. Issue #1662 is closed, its migration is applied in production, and the live function still contains the cutoff and MG01-only derivation.
- All 37 classifier tests pass. The ignored eight-sheet workbook was regenerated privately and visually inspected.
- The final workbook distribution reproduces exactly. A sentinel mutation of all historical MG01-MG03 comparison fields produced byte-identical proposal/evidence digests.
- Production/source identity drift and live division-hierarchy conflicts prove the workbook cannot be applied wholesale. The safe first scope is complete level-3 triplets that pass fresh identity, date, division, and hierarchy gates.
- No preview or production row was written. No structural change was made.
- The executable plan is [`../plan_historical_mg_reclassification_apply.md`](../plan_historical_mg_reclassification_apply.md).

# 4. What did not work

- Pulling the shared main checkout was safely refused because `docs/db-data-admin-scraped-properties.md` is untracked there and now tracked on current main. The file was preserved; do not delete or move it casually.
- The public source paths named by older docs are now absent because sensitive/internal artifacts were relocated to the private repository in PR #1871. Use the private preserved paths.
- Item number, source `(division,item)` and `ShortItemNo` are not universally safe production primary keys. The implementation must resolve a unique live `item_id_pk` and abstain otherwise.
- A first division audit keyed one active row per code and falsely reported many parent failures because child codes repeat under different parents. The corrected audit treats code matches as sets and validates whether any exact parent chain exists.

# 5. Key findings and evidence

- Regenerated output: ignored `.private/mg-historical-audit-20260831/` in this worktree; do not commit it.
- Preserved private source: `licensor-source-data/shared-db-relocated/2026-08-30/`.
- Negative control: proposals and evidence remained byte-identical after historical stored codes were replaced with sentinels.
- Live production proof was obtained read-only through the Supabase Management API with project ref `qsllyeztdwjgirsysgai` and `read_only: true`.
- Live failures include retired `EP001` proposals, an SP001 `F→01` parent gap, and `H→S1→R1` child gaps. Counts must be regenerated; never copy this session's measurements into an authorization.
- `api.resolve_item_mg_category(integer)` uses normalized MG01 ID, so a row update must keep raw code fields and normalized ID fields consistent.

# 6. Rejected approaches

Do not apply the workbook wholesale; join by item number alone; use `ShortItemNo` as the production key; teach from historical codes; remap `EP001`; validate codes globally; apply partial results as complete; clear old lower levels without a ruling; use a migration for ordinary row data; or retire the cutoff after a partial batch.

# 7. Files and ownership

This session owns only:

- `plan_historical_mg_reclassification_apply.md`
- this handoff file
- the small router links in `AGENTS.md` and `docs/item-description-mg-classification-process.md`

Ignored `.private/` audit scripts and outputs are local evidence, not public deliverables. Preserve all unrelated changes in the shared checkout and other worktrees.

# 8. Exact next steps

1. Open the plan and start at STATUS Step 0 in a fresh session.
2. Re-derive current GitHub, source, production, preview, taxonomy, and orchestrator state.
3. Implement the read-only manifest builder and synthetic tests first.
4. Stop for Albert's preview-write authorization before any preview DML.
5. After preview succeeds, regenerate production truth and request authorization for one exact manifest digest.
6. Keep all residuals open; route only a later cutoff/function change through the freshly resolved orchestrator.

# 9. Definition of done

The first batch is complete only after the plan's private manifest, executor tests, authorized preview rehearsal, exact-digest production authorization, production apply, live verification, and recoverable backup all pass. The overall project is complete only when every live historical item passes the exhaustive gate; only then may a separately authorized structural issue consider removing the cutoff.
