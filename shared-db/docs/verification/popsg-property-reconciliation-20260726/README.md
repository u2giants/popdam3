# PopSG Property reconciliation PSG-0 evidence

**Phase:** PSG-0 only  
**Business approval:** Albert Hazan approved the §14 plan-entry checklist on 2026-07-26.  
**Measured:** 2026-07-26 EDT / 2026-07-27 UTC  
**Shared-db branch:** `codex/popsg-property-psg0-20260726`  
**Shared-db base:** `b2737c3ab9e64fc0a7bd158acb49be9d65a538f2`  
**PopDAM source:** `u2giants/popdam3` `main` at `4e0e5d7e`  
**Preview:** `rjyboqwcdzcocqgmsyel`  
**Production:** `qsllyeztdwjgirsysgai`

## Authorities frozen

The authority files and their SHA-256 hashes are in `authority-source-hashes.json`.

1. `shared-db/AGENTS.md`
2. `shared-db/HANDOFF.md`
3. `shared-db/fix_popsg_property_taxonomy_reconciliation.md`
4. `shared-db/fix_coldlion_licensor_property_cutover.md`
5. `shared-db/fix_coldlion_licensor_property_phase6_handoff.md`
6. `shared-db/docs/style-guides-characters-and-royalties.md`
7. `popdam3/AGENTS.md`
8. `popdam3/docs/POPSG.md`
9. `popdam3/apps/worker/src/handlers/popsg-tags.ts`

The unified PopSG plan controls execution. The ColdLion document controls source-cutover state.
The style-guide document controls the business meaning of Licensor, Property, Character, and
Style Guide.

## Repository and migration preflight

- Shared-db had no uncommitted work after the GitHub fast-forward.
- PopDAM had no uncommitted work and PSG-0 changed no PopDAM file.
- The only open shared-db PR was docs-only PR #238, `docs/retire-tester-login-handoff`.
- No duplicate 14-digit migration version exists.
- Production has 318 ledger versions and the repo has 336 migration files.
- Eighteen repo migrations are pending on production.
- The exact backlog is in `migration-backlog.json`.
- PSG-0 added no migration and did not use `supabase db push`, `--include-all`, or Dashboard SQL.

## Newly measured production baseline

The production snapshot was taken in one PostgreSQL `REPEATABLE READ READ ONLY` transaction and
ended with `ROLLBACK`.

| Measure | Result |
|---|---:|
| All PopSG file rows | 279,783 |
| Active PopSG files | 216,417 |
| Active files with a raw Property value | 216,201 |
| Raw Property fields unresolved by current global exact-name behavior | 165,274 |
| Unresolved rate | 76.4446% |
| Canonical Licensors | 26 |
| Canonical Properties | 256 |
| Deterministic state rows | 279,783 |
| Deterministic completed rows | 279,783 |
| Deterministic failed rows | 0 |

These figures exactly reproduce the 2026-07-26 plan baseline. There is no dated count
difference to explain.

The relevant completed deterministic rebuild is `tag-popsg-files` run
`37lo38wrj6d`, started `2026-07-26T18:12:29.858Z` and completed
`2026-07-26T21:18:07.216Z`. It processed 216,417 active files, saw 216,201 raw Property values,
left 165,274 unresolved, wrote 1,062,452 direct relationships plus 56 consensus relationships,
and recorded zero failures. The full operation state is in `production-baseline.json`.

## Property relationship rollback baseline

The snapshots contain relationship and canonical tag identifiers but no file paths, filenames,
or secret values.

| Snapshot | Rows |
|---|---:|
| Accepted Property relationships | 111,011 |
| Manual Property relationships | 0 |
| Rejected Property relationships | 0 |

Files:

- `property-relationships-accepted.csv`
- `property-relationships-manual.csv`
- `property-relationships-rejected.csv`
- `property-relationship-ids-manual.json`
- `property-relationship-ids-rejected.json`

The empty manual and rejected ID arrays are immutable baseline sets. Their emptiness is measured
evidence, not an assumption. PSG-6 must take the same snapshots again immediately before any
approved production rebuild and abort if either immutable set differs unexpectedly.

## Eight live Licensor aliases

The complete observation distribution and accepted-tag blast radius are in
`licensor-alias-blast-radius.json`.

| Alias | Canonical parent | Active files | Distinct raw Property values | Accepted Property relationships | Files with an accepted Property tag |
|---|---|---:|---:|---:|---:|
| NBC Universal | NBC | 25,731 | 55 | 14,931 | 12,557 |
| Marvel Style Guide | Marvel | 14,636 | 11 | 7,474 | 6,765 |
| One Piece | TOEI - ONE PIECE | 8,383 | 4 | 2,471 | 2,469 |
| Peanuts | Peanuts Worldwide | 3,509 | 98 | 3,705 | 3,509 |
| Sesame Workshop | Sesame Street | 1,630 | 6 | 77 | 74 |
| Paramount | Viacom Multi | 9,052 | 26 | 5,524 | 5,326 |
| Nickelodeon | Viacom Multi | 0 | 0 | 0 | 0 |
| Viacom | Viacom Multi | 0 | 0 | 0 | 0 |

All eight targets resolve to active canonical Licensors. Zero current files for Nickelodeon and
Viacom does not make those aliases approved or removable. PSG-1 must still treat all eight as
load-bearing code inputs and enumerate the signed parent-scoped delta.

`PROPERTY_ALIASES` is an empty array. Its separate frozen artifact is `property-aliases.json`.

## Normalization contract

`normalization-contract-v1.md` freezes the current TypeScript behavior as
`popsg-property-observation-v1`. `normalization-fixtures-v1.json` is the canonical
machine-readable corpus and `normalization-fixtures-v1.csv` is its review copy. They cover:

- Unicode NFKC;
- case folding and camel-case boundaries;
- leading, trailing, tab, newline, and repeated whitespace;
- ampersands;
- straight and curly apostrophes;
- ASCII hyphens, en dashes, and em dashes;
- underscores, slashes, and backslashes;
- punctuation runs;
- compatibility ligatures;
- accented non-ASCII letters;
- punctuation-only inputs.

This is specification evidence only. PSG-5 must prove SQL and TypeScript byte parity before the
contract can control a generated column, unique key, mapping, or rebuild.

## ColdLion Phase 6 checkpoint

Phase 6 remains **IN PROGRESS** on preview. Production is untouched by Phase 6.

- Preview canonical counts remain 26 Licensors and 256 Properties.
- Preview mirror counts are 44 Licensor rows and 516 Property rows.
- Six append-only comparison observations and six drill alerts exist.
- The latest non-drill observation, `16373e68-6f72-43ad-8219-7c999799675d`, passed every
  baseline, source, immutability, and link gate with zero unexplained differences.
- The later failed observation `ca8d6615-5fcd-4243-ab7a-de1db23842a1` is explicitly
  `is_drill=true` and records the intended forced-failure proof.
- Preview schedules remain documented as active, but PSG-0 did not alter or invoke them.
- The accelerated readiness work is still open. Phase 7 remains forbidden.

The read-only live snapshot is `coldlion-phase6-preview-status.json`.

Production confirms the Phase 6 boundary:

- `plm.erp_licensor` and `plm.erp_property` exist but each has zero rows.
- The Phase 6 comparison object does not exist in production.
- No PSG-0 or ColdLion Phase 6 production data write occurred.

## Reproduction

Prerequisites:

- Node.js;
- a scratch install of `pg@8.16.3`;
- 1Password vault `vibe_coding`;
- production item `Supabase DB Password - shared POP database`;
- preview item `Supabase Preview Branch Credentials - shared POP database
  (shared-db-schema-rehearsal)`.

Production connection facts:

```text
host=aws-1-us-east-1.pooler.supabase.com
port=6543
user=postgres.qsllyeztdwjgirsysgai
database=postgres
ssl=require
```

Exact safety wrapper used for every database export:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- SELECT-only measurements and exports
ROLLBACK;
```

The snapshot queries select:

```sql
select count(*) from public.style_guide_files;
select count(*) from public.style_guide_files where is_active;
select count(*) from public.style_guide_files
 where is_active and nullif(btrim(property_folder), '') is not null;
select count(*) from core.licensor;
select count(*) from core.property;
select count(*) from public.style_guide_tagging_state
 where pipeline = 'deterministic' and status = 'failed';
select value from public.admin_config where key = 'BULK_OPERATIONS';
select ft.id, ft.style_guide_file_id, ft.tag_id, t.tag, t.normalized_tag,
       t.display_name, ft.source, ft.facet, ft.confidence, ft.status,
       ft.inherited, ft.source_file_id, ft.rule_version, ft.created_by,
       ft.confirmed_by, ft.confirmed_at, ft.created_at, ft.updated_at
  from public.style_guide_file_tags ft
  join public.style_guide_tags t on t.id = ft.tag_id
 where ft.facet = 'property'
   and (ft.status in ('accepted', 'rejected') or ft.source = 'manual')
 order by ft.id;
```

The unresolved count uses the exact `normalizePopSGTag` algorithm frozen in
`normalization-contract-v1.md`, compared only with normalized `core.property.name`, because the
current worker loads Property names but not Property codes.

The alias blast-radius query groups active files by raw `licensor_name` and `property_folder`,
matches the eight aliases using the same normalizer, and counts accepted Property relationships
per file. It never selects a path or filename.

Preview reproduction uses the `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT`
fields from the preview 1Password item and runs SELECT-only queries against
`plm.taxonomy_parallel_observation`, `plm.taxonomy_sync_alert`, `plm.erp_licensor`,
`plm.erp_property`, and `ingest.sync_run` inside the same read-only transaction wrapper.

Hash verification:

```powershell
Get-ChildItem docs\verification\popsg-property-reconciliation-20260726 -File |
  ForEach-Object { Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName }
```

The canonical file-by-file hash manifest is `source-hashes.json`.

## Zero-write proof

- Both database sessions began with PostgreSQL-enforced `READ ONLY`.
- Both sessions ended with `ROLLBACK`.
- PostgreSQL would reject any attempted write inside those sessions.
- No write RPC, rebuild RPC, migration command, Supabase push, schedule call, or Dashboard SQL
  was invoked.
- Shared-db changes are documentation and exported evidence only.
- PopDAM has no changed file.

## Failures and corrections

- The first attempt followed the pasted Linux paths literally. This Windows session uses the
  equivalent `C:\repos\shared-db` and `C:\repos\popdam3` checkouts.
- The first local check preceded a GitHub pull, so the reviewed plan and worker file appeared
  absent. Pulling `origin/main` supplied both without conflict.
- The first aggregate draft multiplied file counts when a file had multiple accepted Property
  relationships. The final exporter uses one pre-aggregated row per file. The corrected count
  exactly matches 216,201 present and 165,274 unresolved.
- The preview 1Password item is a Secure Note whose password field is `DB_PASSWORD`, not
  `password`. The final read used the named `DB_*` fields without printing their values.

## PSG-0 result and PSG-1 entry gate

PSG-0 is complete. No mapping batch, schema, canonical row, preview write, production write,
deployment, or rebuild was performed.

PSG-1 must start in a fresh session and:

1. Pull `u2giants/shared-db` and `u2giants/popdam3`.
2. Read the nine authority files listed above and this README completely.
3. Verify every artifact against `source-hashes.json`.
4. Recheck shared-db PRs, branch state, migration versions, and the moving ColdLion Phase 6
   header.
5. Build the read-only PSG-1 inventory only.
6. Reconcile every active file occurrence exactly once in the required 2×2 matrix.
7. Exclude unresolved Licensors from every Property proposal.
8. Produce `currently-tagged-at-risk.csv` containing every accepted global match that parent
   scoping would remove.
9. Stop before PSG-2.

Copy-paste prompt:

> Work in `C:\repos\shared-db` and `C:\repos\popdam3`. Execute PSG-1 only from
> `fix_popsg_property_taxonomy_reconciliation.md`. First read the nine authority files named in
> the PSG-0 README and verify
> `docs/verification/popsg-property-reconciliation-20260726/source-hashes.json`. Recheck current
> Git/PR/migration and ColdLion Phase 6 status. Build the reproducible read-only inventory and
> required 2×2 matrix, alias blast-radius, candidate evidence, source hashes, and signed
> `currently-tagged-at-risk.csv`. Exclude every unresolved Licensor from Property proposals.
> Make no database write, migration, canonical creation, rebuild, deployment, fuzzy automatic
> mapping, or PopDAM UI change. Update the plan and comprehensive handoff, complete the proper
> shared-db docs branch/PR/merge workflow, verify CI, and stop before PSG-2.
