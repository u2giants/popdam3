# Verification — ColdLion licensor/property Phase 2A

**Date:** 2026-07-24  
**Environment:** preview `rjyboqwcdzcocqgmsyel` only  
**Scope:** mirror-only importer implementation and schema/contracts; no operational pull

## Delivered

- `20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql`
- `20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql`
- `tools/sync-coldlion-licensors-properties.mjs`
- `tools/sync-coldlion-licensors-properties.test.mjs`
- `tools/coldlion-licensor-property-phase2a.test.mjs`
- `supabase/tests/coldlion_licensor_property_phase2_contracts.sql`
- completed Phase 0 evidence under
  `docs/verification/coldlion-licensor-property-phase0-20260724/`

The second migration is intentionally separate. The first preview rehearsal applied
`20260724060000`; review then found additional independent database guards were required.
Rather than rewrite applied preview history, `20260724061000` re-declares the idempotent
functions with the final guard body.

## Final contract

- default and only accepted mode: `mirror_only`;
- raw ColdLion rows remain exact source payloads—entity meaning travels separately in the
  header-derived pair list;
- natural key: `company/division/type/code`;
- full raw JSON contributes to row and snapshot hashes;
- runner and database independently enforce configured header divisions, unique header keys,
  exactly one Licensor and Property pair per required licensed division, one terminal page
  record per pair, nonempty licensed sets, nonblank codes/names, duplicate conflicts,
  configurable absolute floors, and prior-run count-drop threshold;
- advisory transaction lock serializes overlapping imports;
- durable runner failures use the existing separate-transaction/two-consecutive-alert path;
- apply mode is physically limited to preview `rjyboqwcdzcocqgmsyel`; production,
  unknown, missing, or ambiguous database targets abort before the ColdLion fetch;
- failure to read prior successful-run counts aborts instead of silently disabling the
  count-drop guard, and each failed invocation records at most one durable failure row;
- writes are restricted to raw/mirror/review/run evidence;
- no `core.*`, source-reference, canonical link, status, UUID, or parent mutation path exists;
- no scheduler is created.

## Local evidence

Commands:

```text
C:\Program Files\Git\bin\bash.exe scripts/check-sql.sh
node --test tools\sync-coldlion-licensors-properties.test.mjs
node --test tools\coldlion-licensor-property-phase2a.test.mjs
git diff --check
```

Results:

- SQL static checks: passed
- combined runner/static tests: 35/35 passed
- Phase 2A static contract: passed
- diff whitespace check: passed

## Preview evidence

The CLI was explicitly linked to `rjyboqwcdzcocqgmsyel`. Dry-runs showed only the intended
Phase 2A migration at each step. Both migrations applied successfully.

`supabase/tests/coldlion_licensor_property_phase2_contracts.sql` ran as one rolled-back
transaction against the final function. Post-test catalog/data evidence:

```json
{
  "migrations": ["20260724060000", "20260724061000"],
  "licensor_mirror_rows": 0,
  "property_mirror_rows": 0,
  "phase2_runs": 0,
  "schedules": 0,
  "final_guard_loaded": true
}
```

Zero mirror rows and zero Phase 2 run rows are required at this boundary. The first real
preview import belongs to Phase 2B.

## Independent review corrections

The post-GLM review found and fixed three operational safety defects before acceptance:

1. `--apply --linked` trusted whichever project happened to be linked. It now verifies the
   exact preview ref and rejects the production ref or any unknown target.
2. A database error while reading prior-run counts previously downgraded to a warning and
   disabled the count-drop guard. It now aborts and records the failure.
3. Validation failures were recorded once inside validation and again by the outer failure
   handler, which could falsely trigger the two-consecutive-failures alert. The inner write
   was removed so one invocation produces one failure row.

After these corrections, the 35-test suite and the rolled-back preview SQL contract were
rerun independently and passed.

## Explicitly not done

- no Phase 2 runner invocation against preview;
- no production connection, dry-run, migration apply, or data run;
- no schedule;
- no canonical/source-reference/link/status/parent mutation;
- no DesignFlow disablement.

## Phase 2B evidence fields

The next session must capture:

- target project ref and redacted target;
- pre/post canonical Licensor/Property counts;
- sorted canonical UUID hash;
- status hash;
- Property parent-edge hash;
- source-reference count/hash;
- mirror/review/run counts before each run;
- both sync-run UUIDs and snapshot hashes;
- per-division/type source counts and page accounting;
- inserted/updated/unchanged accounting;
- raw payload/hash spot checks;
- every reconciliation category, including NASA, ZAG, FRIDA KAHLO, FRIENDS TV/`FR`,
  ColdLion-only, canonical-only, and cross-entity collisions;
- failure/alert exercise evidence;
- application smoke evidence;
- proof that the second run is idempotent apart from last-seen/run linkage.

