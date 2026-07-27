# PopSG Property reconciliation PSG-1 evidence

**Phase:** PSG-1 only  
**Measured:** 2026-07-27T02:31:33.846Z  
**Production:** `qsllyeztdwjgirsysgai`  
**Preview:** `rjyboqwcdzcocqgmsyel`

## Result

- All 216,417 active file occurrences appear exactly once in the 2×2 matrix.
- The inventory contains 372 normalized observation rows.
- 1 inventory row is `licensor_unresolved` and has no Property candidate or proposal.
- Parent-scoped exact name/code matching resolves 44,331 file occurrences.
- Parent scoping would remove 6,961 currently accepted global Property relationships.
- The signed at-risk file is SHA-256 `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- No fuzzy evidence row is allowed to map automatically.
- No full path or filename is exported. Examples contain only a hash, depth, and extension.

## 2×2 matrix

The Licensor axis reproduces the current worker resolver: exact canonical name/code plus the
eight frozen hard-coded aliases. The Property axis reproduces the current worker's global exact
canonical-name behavior. This matrix describes current observations, not proposed behavior.

| Licensor | Property | Active files |
|---|---|---:|
| Resolved | Resolved | 50,927 |
| Resolved | Unresolved | 165,489 |
| Unresolved | Resolved | 0 |
| Unresolved | Unresolved | 1 |

## Files

- `inventory.csv`: one row per resolved-Licensor and normalized Property tuple, or one
  `licensor_unresolved` row per normalized unresolved-parent observation.
- `summary.json`: counts, safeguards, migration ledger count, and the moving ColdLion checkpoint.
- `top-unresolved.csv`: the first 500 unresolved rows by active-file impact.
- `candidate-evidence.csv`: same-parent evidence only. Shared-token rows are review evidence,
  have `automatic_mapping_allowed=false`, and are not proposals.
- `currently-tagged-at-risk.csv`: every accepted current global exact match that parent scoping
  would remove. Its SHA-256 above is the signed PSG-1 delta.
- `licensor-alias-blast-radius.csv`: all eight hard-coded aliases, including zero-use aliases.
- `licensor-property-resolution-matrix.json`: machine-readable 2×2 counts and axis definitions.
- `source-hashes.json`: hashes and byte sizes for every PSG-1 artifact and source input.

## Inventory field guide

- `observation_key`: stable grouping key.
- `licensor_resolution`: `resolved` or `licensor_unresolved`.
- `resolved_licensor_*`: canonical parent identity, blank when unresolved.
- `normalized_*`: output of frozen contract `popsg-property-observation-v1`.
- `raw_*_variants`: counted raw spellings for the grouped observation.
- `representative_examples`: at most three redacted path/filename shapes.
- `current_global_*`: current worker global canonical-name result.
- `scoped_exact_*`: canonical name or code match under the resolved parent.
- `candidate_property_ids`: same-parent review evidence only.
- `coldlion_exact_evidence_count`: exact ColdLion name/code evidence linked to the same canonical row.
- `designflow_exact_evidence_count`: exact DesignFlow comparison evidence while that lane remains active.
- `structural_folder_hint`: text looks like collection/style-guide/workflow structure.
- `currently_tagged_at_risk`: an accepted global match would be removed by parent scoping.
- `licensor_alias`: one of the eight frozen hard-coded aliases, if used.
- `cross_parent_flag`: global Property parent differs from resolved Licensor.
- `ambiguity_flag`: the current global input has more than one canonical match.
- `proposal_eligible`: false for every unresolved Licensor.
- `proposal_exclusion_reason`: `licensor_unresolved` when Property work is forbidden.

## Reproduction

1. Install `pg@8.16.3` in a scratch folder outside the repo.
2. Set `PG_MODULE` to that scratch module path.
3. Inject the production DB password and preview `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
   `DB_NAME`, and `DB_PORT` from the named 1Password items.
4. Run:

```powershell
node scripts/popsg-property-psg1-inventory.test.cjs
node scripts/popsg-property-psg1-inventory.cjs docs/verification/popsg-property-reconciliation-20260727-psg1
```

Both connections start `REPEATABLE READ READ ONLY` and finish with `ROLLBACK`. PostgreSQL
rejects writes inside these transactions.

## Boundaries

- No database write, migration, canonical creation, rebuild, deployment, or UI change occurred.
- No alias or Property proposal was produced.
- Every unresolved Licensor is excluded from candidate evidence and future Property proposals.
- PSG-2 has not started.
