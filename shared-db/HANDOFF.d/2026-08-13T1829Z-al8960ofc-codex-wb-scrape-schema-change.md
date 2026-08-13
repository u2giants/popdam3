# Warner STARLABS schema change handoff

Status: OPEN

Issue: u2giants/shared-db #925

Plan: [`../docs/warner-starlabs-normalized-source-schema-plan-20260813.md`](../docs/warner-starlabs-normalized-source-schema-plan-20260813.md)

## 1. What this application is

`u2giants/shared-db`, checked out canonically at `C:\repos\shared-db`, owns the structure of the shared Supabase database used by POP Creations applications. Warner STARLABS source metadata is captured privately and may later be loaded into `plm.wb_*` landing tables. This public repository may contain structure, synthetic tests, and safe object-level evidence. It must never contain licensed Warner rows, labels, file names, or paths.

Production is Supabase project `qsllyeztdwjgirsysgai`. Preview is `rjyboqwcdzcocqgmsyel`. Schema changes use a worktree, branch, pull request, preview rehearsal, and later exact production approval.

## 2. What we set out to do, and why

Issue #925 corrects a source landing design that combines Franchise and Property identities and their asset relationships. Labels also participate in identity keys, missing IDs are represented as empty strings, and most source links lack endpoint foreign keys.

This session performed Phase 1 only: read the authoritative request and rulebook, reconcile main with the production ledger, inspect the live Warner catalog and row counts read-only, find every code dependency, and write an implementation plan. No schema or data change was authorized.

## 3. Current state

Phase 1 is complete in [`../docs/warner-starlabs-normalized-source-schema-plan-20260813.md`](../docs/warner-starlabs-normalized-source-schema-plan-20260813.md).

- Worktree: `C:\repos\shared-db\.claude\worktrees\wb-scrape-schema-925`
- Branch: `codex/wb-scrape-schema-plan-925`
- Starting main: `e04676719dec25396204b071d21e14b30dbcf674`
- Starting max migration: `20260813200000`
- Writer blocker: PR #924, Disney issue #812, owns `supabase/migrations`.
- All Warner migrations on main are applied in production.
- All nine live Warner tables exist and each has zero rows.
- Live catalog totals: 131 columns, 37 constraints, 1 foreign key, 24 indexes, 9 policies, 0 user triggers, 21 functions, 2 API views.
- Clean consumer searches found no active Warner reference outside shared-db and mirrored shared-db folders.

The only production drift is unrelated: retired `20260729120000` and deliberately held FR versions `20260802170000` and `20260802171000`.

## 4. Everything tried that did not work

- A first broad repository search included nested mirrored `shared-db/` folders and produced repeated, truncated matches. It was discarded. Clean searches were rerun with nested mirrors, worktrees, packages, builds, and Git metadata excluded. Those searches found zero non-mirrored consumer reference.
- `information_schema.role_table_grants` returned no rows for the Management API session. It was not treated as proof of no grants. The audit read `pg_class.relacl` instead and confirmed the live ACLs without reading source data.
- The current combined names can look normalized because `source_term` distinguishes values. That does not solve the type-safe endpoint, identity-key, or foreign-key problems. The authoritative contract rejects that approach.
- Production being empty makes an additive transition safer, but it does not authorize editing applied migrations, dropping old objects, or skipping preview.

## 5. Root causes and key findings

- `plm.wb_franchise_property` stores two business meanings and keys identities with mutable labels.
- `plm.wb_asset_franchise_property` cannot enforce whether its endpoint is a Franchise or Property.
- `plm.wb_character` also includes mutable label text in its primary key.
- `plm.wb_style_guide.source_id` is required and constrained to `''`; that confuses absence with identity.
- Only one live foreign key exists across the nine tables, and it points from `wb_property_character` to later curated `core.property` resolution. The source relationship links have no Warner endpoint foreign keys.
- The existing guarded capture protocol is valuable and should be extended, not bypassed.
- The runtime dependency is `tools/sync-warner-starlabs.mjs`, its focused tests, verification scripts, immutable migrations, and Warner docs. No app cutover is currently required.
- All production calls proved `qsllyeztdwjgirsysgai` immediately beforehand and used read-only mode. No row values were selected or reported.

## 6. Exact next steps

1. Wait until PR #924 merges and releases the migration writer lane. Verify by checking open PRs and the orchestrator's ownership map.
2. Fetch current `origin/main`. Recheck worktrees, claims, open PRs, and the maximum migration. Success means the branch base and next versions are current.
3. Run `scripts/check-dispatch-collision.mjs` with every object in the plan's exact write set. Exit 1 or 2 means stop. Success means exit 0 plus manual review of items the gate cannot check.
4. Choose consecutive migration versions above the then-current maximum. Do not reuse the Phase 1 maximum.
5. Author the additive normalized identities and relationships described in the plan. Keep every legacy object. Success means every normalized link has correct endpoint foreign keys and labels are not real-ID keys.
6. Extend the controlled loaders and capture target list. Do not add a direct Franchise-to-Property row from asset co-occurrence. Success means every new stream uses the capture protocol and repeated synthetic loads are no-ops.
7. Add synthetic tests for identity changes, same-label/different-ID separation, missing-ID fallback, wrong endpoints, direct evidence rules, retry safety, shrink guard, permissions, and safe errors. Success means all required checks exit zero and no licensed value appears in output.
8. Obtain the exclusive preview lane. Prove `rjyboqwcdzcocqgmsyel` immediately before each write and apply only the intended versions. Success means catalog, permission, retry, failure, and rollback checks pass with synthetic data.
9. Open the implementation PR, wait for exact-head CI, independently review the diff, and assemble the production approval package. Success means no unrelated migration or licensed value is present.
10. Ask Albert for one yes-or-no approval for the exact production versions and bounded workflow. Stop until he approves.
11. After approval only, prove `qsllyeztdwjgirsysgai` before each write, apply only the approved versions, and verify ledger and catalog. Schema promotion must not load Warner rows.

## 7. Constraints and gotchas

- Do not access STARLABS or any private Warner checkout for this schema task.
- Never place licensed source values in this repo, GitHub, logs, chat, or outside-model prompts.
- Franchise, Property, Character, Style Guide, and Asset remain distinct.
- Source namespace plus real ID is stronger than a label. Missing-ID fallback must be explicit and exact.
- Never infer a direct relationship from asset co-occurrence.
- Existing migrations are immutable. The first migration is additive and drops nothing.
- Preview is shared. Serialize its use through the orchestrator.
- Never sweep unrelated pending migrations into preview or production.
- Prove the exact project immediately before every database write.
- Production needs Albert's explicit approval after preview and PR verification.

## 8. Access and environment

- Canonical repo: `C:\repos\shared-db`
- Phase 1 worktree: `C:\repos\shared-db\.claude\worktrees\wb-scrape-schema-925`
- GitHub repo: `u2giants/shared-db`
- Authenticated tools: `gh`, `supabase`, and `op`
- Supabase token and passwords: 1Password vault `vibe_coding`; never print or store values
- Production project: `qsllyeztdwjgirsysgai`
- Preview project: `rjyboqwcdzcocqgmsyel`
- Git identity verified before Phase 1 commit: `Albert Hazan <u2giants@users.noreply.github.com>`

## 9. Open questions and risks

- No owner design question remains. The authoritative request fixes the model and evidence rules.
- Exact migration versions remain intentionally unallocated until Disney #812 releases the lane.
- Existing-name table repairs may require additive columns or explicit `_v2` successors. Choose only after PostgreSQL dependency analysis proves which path preserves all current functions and views.
- Consumer searches are a time-bound result. Repeat them before preview in case an app adds a Warner dependency.
- Production promotion is blocked until Albert approves the exact verified migration.
- Private loader and licensed-data loading are separate work and are not authorized here.

## Mandatory self-audit

1. Can a new developer continue without questions? **Yes.** Paths, projects, branch, current state, blocker, target, and steps are explicit.
2. Can they continue as effectively as this session? **Yes.** Live counts, ledger state, dependency results, dead ends, and design traps are preserved.
3. Did this include what failed and why? **Yes.** The noisy mirror search and incomplete grant view are documented with their corrected methods.
4. Is every next step concrete and verifiable? **Yes.** Each numbered step states its proof or stop condition.
5. Is every term, path, and environment explained? **Yes.** Repo, worktree, projects, secrets location, and ownership boundaries are named.

Self-audit result: **PASS, all five answers are yes.**
