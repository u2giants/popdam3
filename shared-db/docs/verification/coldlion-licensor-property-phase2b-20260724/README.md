# ColdLion Licensor/Property Phase 2B preview verification

**Environment:** preview `rjyboqwcdzcocqgmsyel` only
**Date:** 2026-07-24
**Mode:** `mirror_only`
**Production:** not connected or modified
**Schedule:** not created (0 matching jobs)

## Operational result

- Successful full snapshots: 2
- Run UUIDs: `a7eb9c1b-3868-46bc-8d9a-615c0b8c98e4`,
  `8a18acf5-0ce6-4be1-a522-85ba5478be43`
- Snapshot hash on both runs: `a69332e05d9064723ffa1dfbd870506c`
- Run 1: 560 inserted, 0 updated, 0 unchanged
- Run 2: 0 inserted, 0 updated, 560 unchanged
- Mirror rows: 44 Licensor + 516 Property
- Header coverage: 37 rows across CW001, SP001, EH001, and EP001
- Licensed pairs: CW001/05 Licensor, CW001/06 Property, SP001/05 Licensor,
  SP001/06 Property
- All four detail responses reached their terminal response
- Database review findings: 30

The first operator attempt used a misparsed 1Password CLI field rendering and ColdLion
rejected the request before import. Preview recorded durable failed run
`91f48764-47b9-4f80-8e5f-108eb3658828`. Reading the field's JSON `value` fixed the local
credential handoff; both complete snapshots then succeeded. One failed run does not meet the
two-consecutive-failure alert threshold, so no external alert was expected.

## Idempotency and canonical immutability

| Evidence | Before run 1 | After run 2 | Result |
|---|---:|---:|---|
| Canonical Licensors | 26 | 26 | unchanged |
| Canonical Properties | 256 | 256 | unchanged |
| Licensor UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` | `590ea83ea6df1487fcfc1e18b3ef6a0d` | unchanged |
| Property UUID hash | `e0e6c36eb02bb2d320c0deaff7aa8f8c` | `e0e6c36eb02bb2d320c0deaff7aa8f8c` | unchanged |
| Canonical status hash | `5960fa4c08b5da2d0880c138e3e32ef7` | `5960fa4c08b5da2d0880c138e3e32ef7` | unchanged |
| Property parent-edge hash | `7459f6826cc59468779e7ead33ec0edc` | `7459f6826cc59468779e7ead33ec0edc` | unchanged |
| Null Property parents | 0 | 0 | unchanged |
| Source-reference rows | 505 | 505 | unchanged |
| Source-reference hash | `5f7221c29bca6e755c448200da1a88c5` | `5f7221c29bca6e755c448200da1a88c5` | unchanged |
| ColdLion source references | 0 | 0 | unchanged |
| Mirror canonical links | 0 | 0 | unchanged |
| Matching schedules | 0 | 0 | unchanged |

The final mirror key hashes are `7170df2831fd3b4ff74f62ef262f8256` (Licensor) and
`a02670389f7e5b15c12ba667a23e1905` (Property). Full-source hashes are
`18a03fb0e09c244b7b9699342a966b08` and
`161212e047a4fe7b2f8cb4e17b9813c2`. Run 2 changed only last-seen/run linkage.

## Coverage and reconciliation

Every one of the 560 ColdLion rows and 282 canonical rows is represented in
`licensors.csv` or `properties.csv`:

- exact compatible code match: 542
- exact normalized-name match: 2 (NASA in both divisions)
- ColdLion-only candidate: 14
- canonical-only curated/legacy record: 10
- true unmatched entity-type collision: 2 (FRIDA KAHLO Licensor in both divisions)

This ledger flags 28 rows for Phase 3 review. It is evidence, not an approval ledger, and
does not write mirror links, source references, canonical rows, statuses, names, or parents.

The database also opened 30 conservative conflict findings for 15 codes repeated across
entity types in both licensed divisions: `1P`, `CB`, `CC`, `DC`, `DY`, `FK`, `HP`, `MV`,
`PN`, `PP`, `SE`, `SM`, `SS`, `SW`, and `WW`. Most have an exact same-entity canonical
match and are classified as compatible in the CSVs. Only the two `FK` Licensor rows lack a
same-entity candidate. Phase 3 must preserve this distinction.

Named cases:

- NASA: ColdLion `NA`, canonical `X-NASA`; normalized-name evidence only, no link.
- ZAG: ColdLion-only Licensor in both divisions; no canonical activation or creation.
- FRIDA KAHLO: ColdLion Licensor `FK` collides with canonical Property `FK`; quarantined.
- FRIENDS TV: canonical-only Licensor `FR`; preserved.
- `FR` / 1ST ORDER TROOPER: typed Property match; never cross-linked to FRIENDS TV.

## DesignFlow comparison

- Staging: 37 Licensor rows / 20 distinct codes; 468 Property rows / 256 distinct codes.
- Latest successful DesignFlow run:
  `4bc12131-bef5-4740-8734-275ee6b33196`, 2026-07-08T07:30:19.321Z.

The DesignFlow snapshot is stale. It remains dated comparison evidence only, and the Phase 6
parallel-run clock does not start.

## Preview consumer smoke evidence

Read-only preview queries succeeded for DB Data Admin, DAM/PopSG, PM/PIM, CRM FK consumers,
DesignFlow staging, item taxonomy, and style-tracker contracts:

- 44/516 ColdLion reconciliation rows and 3 cutover-summary rows;
- 161 DAM character-catalog rows;
- 17,909 PM/PIM product-board rows;
- 15,533 style-tracker rows;
- both DB Data Admin list/tree functions present;
- DesignFlow staging/import function present;
- zero unvalidated FKs into `core.licensor` or `core.property`.

The rolled-back `db_data_admin_licensor_property_tree.sql` fixture is stale: it inserts an
orphan Property, which the Phase 1 `core.property.licensor_id NOT NULL` rule now correctly
rejects. This is test maintenance, not a live read-contract failure.

Local verification passed: 34/34 runner tests, the Phase 2A static contract, and
`scripts/check-sql.sh`.

## Commands

The operational command was:

```text
node tools/sync-coldlion-licensors-properties.mjs --apply --linked
```

The target guard read `supabase/.temp/project-ref` and printed preview
`rjyboqwcdzcocqgmsyel`. `DATABASE_URL` and `SUPABASE_DB_URL` were explicitly absent.
The ColdLion key and preview pooler tuple came from 1Password vault `vibe_coding`; no value
was printed or written to git.

Supporting checks used:

```text
supabase db query --linked --file tools/coldlion-licensor-property-phase2b-snapshot.sql
supabase db query --linked --file tools/coldlion-licensor-property-phase2b-smoke.sql
node --test tools/sync-coldlion-licensors-properties.test.mjs
node --test tools/coldlion-licensor-property-phase2a.test.mjs
C:\Program Files\Git\bin\bash.exe scripts/check-sql.sh
```

## Forward-impact audit and readiness ruling

The two-snapshot, idempotency, coverage, and canonical-immutability gates pass. Phase 3 must
not start yet because live execution exposed a count-drop guard defect: run 2 recorded
`metadata.prior_run = null` even though run 1 succeeded. The parser expects psql table text,
while `supabase db query` returns JSON, so prior successful counts were not loaded.

A fresh Phase 2 correction session must:

1. parse the real Supabase CLI JSON output;
2. add a regression fixture using captured JSON-shaped output;
3. update the stale DB Data Admin orphan fixture;
4. run another identical preview snapshot;
5. prove `prior_run` contains 44/516 while snapshot and canonical/source-reference hashes
   remain unchanged.

Later-phase impact:

- Phase 3 starts from all CSVs here and distinguishes the 30 conservative findings from the
  two true unmatched `FK` collisions.
- Phase 4 must prioritize typed same-entity matches before cross-entity code reuse.
- Phase 6 cannot start its 14-day clock until DesignFlow has a fresh trustworthy success.
- Phases 4–8 require the repaired prior-run guard and updated DB Data Admin fixture in their
  entry checks.

No table, key, function signature, source-reference encoding, permission, schedule,
canonical record, or DesignFlow behavior changed during Phase 2B.
