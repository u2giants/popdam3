# ColdLion approved mapping gate — Paramount five

This artifact widens the frozen Phase 4 mapping only for the five exact Property codes Albert
approved under Paramount on issue #539: `AM1`, `AM2`, `MGM`, `WND`, and `EP`. Each code has one
typed identity in `CW001` and one in `SP001`, both pointing to the same new canonical Property.

The original 542 mappings remain present. The widened contract is:

- schema: `coldlion_phase4_approved_mapping_input/v2`
- mappings: **552** (542 original plus 10 typed rows)
- distinct canonical UUIDs: **276** (271 original plus five)
- md5: `09e18e47d67181b06483d6cf4454e053`
- approval: Albert Hazan, 2026-08-18, issue #539
- implementation: issue #1177, migration `20260825050407`

The fingerprint uses the established Phase 4 encoding: sorted
`<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>` rows joined by newline,
then MD5 over UTF-8. The readiness tool recomputes the fingerprint and refuses any difference.

The same atomic migration captures the live pre-state, proves the exact authorized +5 canonical /
+10 reference / +10 link deltas with unrelated metrics unchanged, then supersedes the seven
affected `phase4_preview` health pins with that environment's truthful post-state and updates
the recurring promotion function to this exact 552/276 fingerprint. The generated emergency
rollback withdraws only the approved links, clears only their typed mirrors, marks the five
#1177-created canonical Properties inactive (it never deletes their identity or parent), proves
the environment-specific withdrawal delta, re-pins the exact post-rollback snapshot, and restores
the promotion function's historical 542/271 gate.

No other formerly excluded code is admitted. The migration also applies §6.4 matched-row
abstention: any existing canonical code/name, Property alias, or taxonomy source reference aborts
the transaction instead of updating a possible match or creating a duplicate.

The two EDGEHOME CW001/SP001 type-06 Property headers and the ten typed `plm.erp_property`
identities use exact insert-or-validate semantics. An absent header or approved identity key is
established from this fingerprinted authority with explicit #539/#1177 provenance. An existing
row is never overwritten: each header must already mean Property, and each identity must have the
exact type, normalized name, unresolved state, and null canonical link, or the transaction refuses.
