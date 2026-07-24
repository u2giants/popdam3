# Handoff — ColdLion licensor/property Phase 2A

## 1. What this application is

`u2giants/shared-db` is the schema and data-integration source of truth for the hosted
Supabase database shared by POP Creations' CRM, DAM, PM/PIM, DB Data Admin, PopSG, and
DesignFlow-adjacent workflows. Licensors and Properties are stable canonical records in
`core.licensor` and `core.property`; every Property has exactly one Licensor through
`core.property.licensor_id`.

Phase 2A adds a guarded ColdLion lane that can mirror source identities and descriptions into
`plm.erp_licensor` / `plm.erp_property`. It does not make ColdLion authoritative for
canonical UUIDs, lifecycle status, or Property parent edges.

## 2. What this session set out to do, and why

The task was to implement Phase 2A only, after completing the residual Phase 0 baseline.
The importer had to be ready for a separate Phase 2B preview operation while avoiding the
first real preview pull, all production work, scheduling, canonical/source-reference writes,
and DesignFlow cutover.

## 3. Current state

- Branch: `codex/coldlion-licensor-property-phase2a-20260724`
- Preview project: `rjyboqwcdzcocqgmsyel`
- Production project: untouched
- Preview migrations applied:
  - `20260724060000`
  - `20260724061000`
- Preview mirror rows: 0 Licensors / 0 Properties
- Preview Phase 2 sync runs: 0
- Preview Phase 2 schedules: 0
- DesignFlow: enabled and unchanged
- Local tests: 35 combined runner/static tests plus repository SQL checks pass
- Rolled-back preview SQL contracts: pass

The complete Phase 0 baseline is
[`docs/verification/coldlion-licensor-property-phase0-20260724/README.md`](docs/verification/coldlion-licensor-property-phase0-20260724/README.md).
Phase 2A verification is
[`docs/verification/coldlion-licensor-property-phase2a-20260724.md`](docs/verification/coldlion-licensor-property-phase2a-20260724.md).

## 4. Everything tried that did not work

1. The 1Password connector lacked its service-account bootstrap. The established local
   1Password CLI bootstrap was used instead; secrets remained environment-only.
2. A proposed production read-only baseline query was rejected because the user said not to
   run against production. It was not retried. Fresh row-level database evidence came from
   preview, while production facts remain the earlier dated snapshot.
3. The first SQL contract execution found two malformed JSONB fixture casts. They were test
   syntax errors, not migration errors, and were corrected.
4. Stronger pair/page completeness guards exposed three intentionally small fixtures that
   were not complete snapshots. The fixtures were expanded; the production guard was not
   weakened.
5. The first preview migration apply preceded final review corrections. Applied migrations
   are immutable, so a new correction migration `20260724061000` was added and applied
   instead of rewriting preview history.
6. GLM repeatedly edited files outside its assigned Phase 2 scope. The run was stopped, the
   unrelated UI change was removed, and every remaining diff was reviewed.
7. Independent review found three runner defects: an unverified linked-project target, a
   warning fallback that disabled the prior-count guard, and duplicate durable-failure
   writes. All three were corrected; the full local suite and rolled-back preview SQL
   contract passed afterward.

## 5. Root causes and key findings

1. Raw detail payloads must remain exact ColdLion evidence. The early draft stamped
   `mgTypeDesc` onto each row; the final runner carries meaning separately in `pairs`.
2. The early mirror hash covered only identity/name, so a change to another source field
   would appear unchanged. The final database hash covers the full JSON payload.
3. Runner validation originally ignored `snapshot.config` and always used process defaults.
   It now honors the payload configuration and optional explicit test overrides.
4. Suspicious short pulls were warnings in the early runner even though the plan requires
   them to block. Configured floors and count drops now abort in both runner and database.
5. The early database function did not independently prove all configured header divisions,
   unique header keys, or one page record per pair. The correction migration does.
6. Fresh baseline comparison found 542 exact-compatible-code source rows, two NASA name-only
   rows, two FRIDA KAHLO cross-entity collisions, 14 unmatched source rows, and 10
   canonical-only rows. These are Phase 3 evidence, not Phase 2A link decisions.
7. The operational runner is now physically preview-only: apply mode accepts only
   `rjyboqwcdzcocqgmsyel` and rejects production, unknown, absent, or ambiguous targets.

## 6. Exact next steps

1. Start a fresh Phase 2B session and reread `AGENTS.md`, this handoff, and the full cutover
   plan.
   Gate: the session explicitly states preview `rjyboqwcdzcocqgmsyel` and no production
   credential/URL is present.
2. Capture every pre-run count/hash listed in the Phase 2A verification document.
   Gate: canonical UUID, status, parent, and source-reference baselines are saved before any
   import.
3. Invoke the runner once in `mirror_only` mode against preview.
   Gate: complete page/type coverage, successful run accounting, expected raw/mirror rows,
   and zero canonical/source-reference mutation.
4. Invoke the identical full snapshot again.
   Gate: no duplicates, stable snapshot/source hashes, expected unchanged accounting, and
   only last-seen/run linkage changes.
5. Produce the full reconciliation artifact and application smoke evidence required by
   §15.2.
   Gate: every row is categorized or explicitly blocks Phase 3.
6. Re-run the forward-impact audit before handing off to Phase 3.

Do not start the 14-day parallel-run clock if DesignFlow evidence is stale or unavailable.

## 7. Constraints and gotchas

- `mirror_only` is the only supported mode.
- Do not run against production in Phase 2B.
- Do not create a schedule.
- Do not add ColdLion source refs or mirror canonical links.
- Do not mutate canonical UUIDs, names, statuses, or parents.
- Do not infer parent edges from item co-occurrence.
- Do not classify by `mgTypeCode` or `mgCode` alone.
- DesignFlow remains the parent/status comparison source.
- Both Phase 2A migrations are required; `20260724061000` is the final function body.

## 8. Access and environment

- Authenticated CLIs: `gh`, `supabase`, `op`
- Secrets: 1Password vault `vibe_coding`; no secret values are in git
- Preview credentials item ID was used because parentheses in its title are not valid in a
  direct `op://` title reference
- PostgreSQL contracts use Node `pg` from `C:\repos\oracle\node_modules`
- `psql` is not installed

## 9. Open questions and risks

- Phase 2B must determine whether the live result matches the dated 560-row baseline.
- FRIDA KAHLO's Licensor code collides with an existing canonical Property code and must
  remain quarantined across entity types.
- NASA is active canonical `X-NASA` but ColdLion `NA`; matching is a later human-reviewed
  decision.
- ZAG and six ColdLion Property identities are source-only in the baseline.
- FRIENDS TV remains curated-only unless later evidence and approval change that.

## Forward-impact audit

The implementation changes later-phase assumptions in three explicit ways:

1. Phases 2B–7 must treat `20260724061000` as the final function contract after
   `20260724060000`.
2. Phase 3 must include the FRIDA KAHLO cross-entity collision and the complete baseline
   exception ledger, not only NASA/ZAG/FRIENDS TV.
3. Phase 4 replay/immutability evidence can use full raw row hashes and snapshot hashes;
   later tests must verify non-name source-field changes are detected.

No later phase may treat mirror resolution status as an approved canonical link. Scheduling
still begins only in Phase 6, production only in Phase 7, and DesignFlow deprecation only in
Phase 8.

## Handoff self-audit

Passed on 2026-07-24:

1. A new developer can identify the repository, entities, authority split, branch,
   environments, applied migrations, and exact next session without this chat.
2. Every failure and correction that could otherwise be repeated is recorded.
3. Every next step has a concrete verification gate.
4. Production, scheduling, canonical mutation, and DesignFlow boundaries are explicit.
5. The forward impact on Phases 2B–8 is named.
