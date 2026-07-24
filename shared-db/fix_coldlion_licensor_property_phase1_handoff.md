# Handoff — neutral Licensor/Property architecture and ColdLion cutover

## 1. What this application and repository are

`u2giants/shared-db` is the schema source of truth for the shared hosted
Supabase database used by POP Creations' CRM, DAM, PM/PIM, PopSG, and DesignFlow
PLM applications. All of those applications share canonical business entities
under `core.*`. Database changes are authored here as timestamped migrations,
rehearsed against preview project `rjyboqwcdzcocqgmsyel`, merged through a
GitHub pull request, and promoted to production project
`qsllyeztdwjgirsysgai` only in an approved window.

The business entities in this work are:

- Licensor: `core.licensor`
- Property: `core.property`
- Neutral parent relationship: `core.property.licensor_id`

The apps should consume the canonical `core.*` contract or app-facing views
derived from it. DesignFlow is not the permanent owner of the parent edge.

## 2. What this session set out to do, and why

The confirmed business rule is: **every Property has exactly one Licensor**.
Historically, DesignFlow supplied the relationship and ColdLion was believed
not to expose the underlying Licensor/Property records. Live API investigation
corrected part of that understanding: ColdLion does expose Licensor and Property
merch-group identities, but it still does not supply the Licensor→Property
parent edge or lifecycle status.

The staged architecture therefore separates authority:

- ColdLion: source identity and description evidence.
- Supabase `core.*`: stable canonical UUIDs, lifecycle status, and the single
  Property→Licensor relationship.
- DesignFlow: temporary comparison/curation input until a later cutover.

Grok was delegated the implementation. Codex independently reviewed and tested
it, found several architecture defects, and required Grok revisions before
preview.

## 3. Current state

### Git and PR

- Repository: `u2giants/shared-db`
- Branch: `codex/grok-neutral-taxonomy-phase1`
- PR: https://github.com/u2giants/shared-db/pull/208
- Commits:
  - `192ae61` — Phase 1 neutral mirror/review foundation
  - `8624a5b` — schema-qualify review-index comments after preview finding
- GitHub `validate` check: passed
- Merge state at last verification: clean
- Production: **not applied**

### Preview database

Migration `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`
is applied to preview project `rjyboqwcdzcocqgmsyel`.

Verified preview state:

- `core.property`: 256 rows
- Null `core.property.licensor_id`: 0
- `core.property.licensor_id`: `NOT NULL`
- `property_licensor_id_fkey`: `ON DELETE RESTRICT`
- `plm.erp_licensor`: exists, 0 rows
- `plm.erp_property`: exists, 0 rows
- `plm.taxonomy_resolution_review`: exists
- Three read-only `api.coldlion_*` reconciliation views: exist
- Authenticated browser mutation privileges: absent
- Phase 1 write RLS policies: 0
- Migration ledger version `20260724030000`: recorded
- Rollback-safe SQL contracts: passed

Zero mirror rows is correct for Phase 1 because no ColdLion importer exists yet.

### Implemented schema

- Enforced exact-one parent using scalar
  `core.property.licensor_id NOT NULL REFERENCES core.licensor(id)
  ON DELETE RESTRICT`.
- Reused `plm.merch_group_header` as the division-aware type dictionary.
- Added semantic header FKs so a division/type code cannot be mislabeled
  (for example, EH001 type `05` cannot be treated as Licensor).
- Added typed `plm.erp_licensor` and `plm.erp_property` mirrors.
- Added typed review IDs instead of polymorphic entity UUIDs.
- Preserved review history with partial unique active-finding indexes.
- Enforced a coherent review status/resolution/resolver matrix.
- An `approved_link` review requires the correctly typed resolved ID, nonblank
  `resolved_by`, and a resolution timestamp; non-approved states cannot carry
  that resolved package.
- Required raw source payloads with no silent `{}` default.
- Allowed service-role writes but authenticated browser reads only.
- Added reconciliation views without exposing raw payloads.

## 4. Everything tried that did not work

### First Grok draft

The first draft did not enforce the true business rule in the database:
`core.property.licensor_id` remained nullable with `ON DELETE SET NULL`.
It also allowed mirror rows to claim a semantic type without a header FK,
used untyped review UUIDs, permitted browser-facing write policies, allowed
missing raw payloads, and used a future migration timestamp. Codex rejected
that draft and had Grok revise it.

### Stalled Grok resume

One resumed Grok process produced no output and appeared inert. It was stopped
after bounded waits. Its partial edits were inspected rather than trusted, and
Grok was relaunched with captured output and a narrower brief.

### Grok's false clean-whitespace report

Grok reported `git diff --check` clean while all files were still untracked.
After staging, Git found Markdown trailing whitespace. Codex removed only that
formatting and reran all checks before committing.

### First preview apply

The first real preview apply failed with SQLSTATE `42P01` at:

```text
comment on index plm_taxonomy_resolution_review_source_uidx
```

The indexes lived in schema `plm`, but their comments used unqualified names;
the migration search path resolved the bare name under `public`. The migration
transaction rolled back completely. Grok fixed all three statements to use
`plm.plm_taxonomy_resolution_review_*_uidx` and added a static regression test.
The next dry-run and apply succeeded.

### Wrong Windows bash

Bare `bash` resolved to an unsuitable Windows/WSL path and failed on shell
options. The reliable check command is:

```text
C:\Program Files\Git\bin\bash.exe scripts/check-sql.sh
```

## 5. Root causes and key findings

1. The architecture problem was not merely where code lived. The database
   allowed an invalid state: a Property with no Licensor. The durable fix is the
   `NOT NULL` scalar FK plus `ON DELETE RESTRICT`.
2. ColdLion merch-group type codes are division-dependent. The mirror tables
   must reference the header's semantic key; `mg_type_code` alone is unsafe.
3. ColdLion exposes identity records but does not own the parent edge or active
   status. Importers must never infer the edge from item co-occurrence or revive
   inactive canonical rows based on ColdLion presence.
4. Review history needs at most one active finding, not one finding forever.
   Active statuses are `open`, `quarantined`, and `conflict`; terminal rows
   remain as audit history.
5. Cross-schema object comments require schema-qualified object names when the
   migration search path does not contain that schema.

Primary implementation:

- `supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`
- `supabase/tests/coldlion_licensor_property_phase1_contracts.sql`
- `tools/coldlion-licensor-property-phase1.test.mjs`
- `docs/verification/coldlion-licensor-property-phase1-20260724.md`

## 6. Exact next steps

1. Re-run `gh pr checks 208 --repo u2giants/shared-db`.
   Gate: `validate` is successful and merge state is clean.
2. Merge PR #208 into `main`.
   Gate: GitHub reports the PR merged and returns the merge commit SHA.
3. Do **not** promote migration `20260724030000` to production without Albert's
   explicit approval for that production window.
   Gate: the user has clearly approved this exact production migration.
4. Once approved, isolate the migration from unrelated historical ledger drift,
   run a production dry-run, confirm the preflight still reports 0 null parents,
   apply, and rerun the same catalog/contract evidence.
   Gate: production records `20260724030000`, has 0 null parents, the FK is
   restrictive, and the SQL contracts pass/rollback.
5. Start Phase 2 only after Phase 1 production verification. Implement the
   mirror-only ColdLion fetch/importer with no canonical writes.
   Gate: parallel-run mirror counts and reconciliation reports are stable while
   canonical UUIDs, statuses, and parent links remain unchanged.

## 7. Constraints and gotchas

- One shared schema change in flight at a time.
- Preview before production.
- Never edit migration `20260724030000` after it is applied/merged; corrections
  after that point require a new timestamped migration.
- Do not create a Licensor↔Property bridge. The business rule is one scalar FK.
- Do not key merch groups by `mg_code` or `mg_type_code` alone.
- Do not infer parent links from item co-occurrence.
- Do not let a ColdLion repull reactivate inactive canonical rows.
- `dam` schema is not browser-exposed through PostgREST.
- Preserve unrelated historical migration-ledger drift; do not repair or apply
  unrelated versions as part of this work.

## 8. Access and environment

- Authenticated CLIs used: `gh`, `supabase`
- Secrets: 1Password vault `vibe_coding`; values were never printed or committed
- Preview project: `rjyboqwcdzcocqgmsyel`
- Production project: `qsllyeztdwjgirsysgai`
- Local isolated worktree:
  `C:\tmp\shared-db-grok-neutral-taxonomy-phase1`
- `psql` is not installed. SQL contracts were executed with Node `pg` from the
  existing Oracle workspace dependency against the preview pooler.

## 9. Open questions and risks

- Production promotion is intentionally pending explicit approval.
- Phase 2 must decide importer batching, failure alerts, and sync-run evidence
  without expanding ColdLion's authority beyond identity/description.
- DesignFlow cutover is a later phase. It must not be disabled merely because
  the empty mirror schema exists.
- Deleting a Licensor that owns Properties will now fail. That is intended;
  reassignment or deliberate archival is required instead.

## Handoff self-audit

Passed on 2026-07-24:

1. A fresh developer can identify the apps, repository, branch, PR, database
   environments, migration, and business rule without prior context.
2. Current committed, preview, CI, merge, and production states are explicit.
3. Failed approaches and their causes are recorded.
4. Every next step has a verification gate.
5. Terms, paths, project references, and access boundaries are explained.
