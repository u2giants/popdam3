# Handoff — ColdLion licensor/property Phase 2B

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts used by
CRM, DAM/PopSG, PM/PIM, DB Data Admin, and DesignFlow-adjacent workflows. Licensors and
Properties remain canonical in `core.licensor` and `core.property`; ColdLion Phase 2 only
mirrors source evidence into `plm.erp_licensor` and `plm.erp_property`.

## 2. What this session set out to do

Execute Phase 2B only against preview `rjyboqwcdzcocqgmsyel`: capture baselines, run two
complete `mirror_only` snapshots, prove idempotency and canonical immutability, reconcile
every source/canonical row, audit preview consumers, and perform the forward-impact audit.

## 3. Current state

- Production was not connected to or modified.
- DesignFlow remains enabled.
- No schedule was created.
- No canonical row, source reference, mirror canonical link, status, name, UUID, or parent
  edge changed.
- Successful run 1: `a7eb9c1b-3868-46bc-8d9a-615c0b8c98e4`.
- Successful run 2: `8a18acf5-0ce6-4be1-a522-85ba5478be43`.
- Both snapshot hashes: `a69332e05d9064723ffa1dfbd870506c`.
- Mirror state: 44 Licensor + 516 Property rows.
- Run 2: 0 inserted, 0 updated, 560 unchanged.
- Canonical hashes and 505-row source-reference hash are unchanged.
- Reconciliation artifacts:
  `docs/verification/coldlion-licensor-property-phase2b-20260724/`.

## 4. Everything tried that did not work

1. The first command assigned the human-formatted 1Password CLI field output directly to
   `COLDLION_API_KEY`. ColdLion rejected it as invalid before import. Preview correctly
   recorded failed run `91f48764-47b9-4f80-8e5f-108eb3658828`. Parsing the field's JSON
   `value` produced the real credential and both full runs succeeded.
2. The first baseline query used psql `\pset` directives, unsupported by
   `supabase db query`; they were removed.
3. The baseline query initially used two stale column names (`category`, `completed_at`);
   it was corrected to the applied review/sync-run schema.
4. The rolled-back DB Data Admin tree test tries to insert a Property with no Licensor.
   Phase 1 intentionally made that impossible, so the fixture now fails and must be updated.

## 5. Root causes and key findings

1. The Phase 2 runner has a live prior-count guard defect. `parsePriorCounts` understands
   psql table text, but the installed Supabase CLI returns JSON. Run 2 therefore recorded
   `metadata.prior_run=null` instead of 44/516. Absolute floors still ran, but the
   cross-run percentage-drop guard did not receive its baseline.
2. The full typed reconciliation matches the Phase 0 ledger: 542 exact compatible-code
   source rows, 2 NASA name-only rows, 14 ColdLion-only rows, 10 canonical-only rows, and
   2 true unmatched FRIDA KAHLO Licensor-to-Property collisions.
3. The database opened 30 conservative conflict findings for 15 codes used by both entity
   types in both divisions. Most still have an exact same-entity canonical match. Phase 3
   must not treat those 30 findings as 30 unmatched collisions.
4. Latest DesignFlow success is still 2026-07-08. It is stale evidence; the Phase 6 clock
   is not running.

## 6. Exact next steps

1. Start a fresh Phase 2 correction session, not Phase 3.
2. Update `parsePriorCounts` to accept the captured Supabase CLI JSON shape while retaining
   psql compatibility.
3. Add a regression test proving 44/516 parses from that JSON.
4. Update `supabase/tests/db_data_admin_licensor_property_tree.sql` so its fixture obeys the
   exact-one-Licensor rule.
5. Run all local/static and rolled-back preview tests.
6. Run one more identical preview `mirror_only` snapshot.
7. Verify `metadata.prior_run` contains 44/516 and all snapshot/canonical/source-reference
   hashes remain identical.
8. Obtain a fresh trustworthy DesignFlow snapshot before declaring Phase 3 entry ready.

## 7. Constraints and gotchas

- Preview only; no production access.
- No schedule before Phase 6.
- No canonical linking before Phase 4.
- No canonical creation before Phase 5.
- Never classify or link across entity types by code alone.
- DesignFlow remains enabled and remains the comparison source for lifecycle/parents.

## 8. Access and environment

- Preview: `rjyboqwcdzcocqgmsyel`.
- Secrets: 1Password vault `vibe_coding`; no values in git.
- Linked Supabase CLI target was explicitly verified.
- Preview pooler queries use Node `pg` from `C:\repos\oracle\node_modules`.
- Production credentials/URLs were not used.

## 9. Open questions and risks

- The prior-count parser correction is mandatory before later phases trust the short-pull
  percentage guard.
- DesignFlow staleness blocks the later parallel-run clock.
- Phase 3 must assign human dispositions to all 28 blocking ledger rows and interpret the
  30 conservative database findings with typed context.

## Forward-impact audit

Phases 3–8 are updated in `fix_coldlion_licensor_property_cutover.md`. No schema, key,
permission, function signature, source-reference encoding, or schedule changed. Later entry
tests now explicitly require the repaired prior-count guard and the updated DB Data Admin
fixture.

## Handoff self-audit

Passed: a fresh developer can reproduce the environment, identify every run/artifact, avoid
production, understand the failed attempt and live guard defect, execute the correction with
verification gates, and proceed without this conversation.
