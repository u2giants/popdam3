# Licensing Master Data Phase 0 reconciliation — 2026-09-04

## Scope and identity

This is a sanitized read-only reconciliation summary for tracker #1090. It authorizes no database or data change. The repository base was `origin/main` at `f462a411801973371a7dff8b21ae9dd326d191e3`. The production query target was proved by the repository's protected configuration as Supabase project `qsllyeztdwjgirsysgai`. No licensed row values were read or recorded.

The live orchestrator marker was re-resolved immediately before routing on 2026-09-04. Its number is historical evidence only and must never be reused as a routing target. #1090 itself remains `work_type: documentation`, `route: repo-maintenance`, `status: blocked`; it is not an author assignment.

This directory does not yet satisfy the full Step 0.1 gate: it contains no saved preview ledger, source-capture freshness census, complete dependency/row-count output, or machine-readable command/exit-code artifacts. Those omissions keep Step 0.1 partial.

## Production migration ledger

Command:

`node scripts/check-migration-ledger-drift.mjs --target production --json`

Result: 613 versions on current main, 589 applied in production, 24 merged but not applied, and zero applied-but-not-merged. Nineteen of the 24 are explicitly retired or deliberately held by the production guard. Five are genuinely pending:

- licensing-related: `20260902222649` (Property uniqueness and reviewed promotion), `20260903125728` (Tier-2 Character promotion contract);
- other workstreams: `20260903200951`, `20260904121037`, `20260904143518`.

The two licensing-related pending versions are not counted as delivered. A migration file or merged pull request is not production proof.

> **Superseded 2026-09-05 (issue #2377).** The reading above is the measurement as taken
> on 2026-09-04 and is left unedited as a record. `20260903200951` is no longer pending: it
> was permanently hard-blocked and retired, and reissued byte-for-byte as `20260905024139`
> under issue #2349 (merge commit `cafeedb32a4a09fb617d54ac0594c61410a33942`). The three
> other-workstream versions have since been applied, and `Migration Ledger Drift` run
> 33944448666 reports a genuinely-pending count of zero.

## Live catalog findings

Each object was checked with `node scripts/catalog-truth.mjs --target production <typed-object>`. The tool reads the production migration ledger and catalog through the Management API with `read_only: true`.

Present and applied:

- `plm.licensing_write_authorization` — present; guard foundation version `20260817124545` and the FRIENDS/FRIDA bundle are applied;
- `plm.source_resolution` — present; supported replacement `20260902024541` and browser setter `20260902031743` are applied;
- `core.character` — present; separate Character replacement `20260829004145` is applied;
- `core.property_character_associations` — present;
- Warner-specific evidence bridges, guarded sync, and candidate view — production proof #1380, PR #1385, run 32659028280. This is not proof of the full canonical Warner adapter.

Absent from both current migration truth and the production catalog:

- `core.franchise`;
- `core.property_style_guide` and `core.property_franchise`;
- `dam.asset_property`, `dam.asset_style_guide`, and `dam.asset_franchise`;
- `plm.licensing_source_scope`;
- `plm.licensing_relationship_resolution`.

Repository search also found no general `plm.plan_licensing_consolidation`, `plm.apply_licensing_consolidation`, `plm.plan_licensing_canonical_merge`, `plm.apply_licensing_canonical_merge`, or `plm.licensing_canonical_change_history` definition.

## Evidence-backed completed foundations

- #1140 completion record: PR #1256, merge `e66ad50300281a07ef20a4633b4922038af2ee28`, production verification in governed bundle run 32483394133.
- #1339: FRIENDS/FRIDA six-migration bundle applied and live-verified in run 32483394133 from merge `080cf00df958ef47ec93df30160ba0dd9dabf5d1`.
- #1684 completion record: PR #1712, merge `20ec217fa0f4d3777cf245b9fd2414d53bb1a456`, migration `20260829004145`; live catalog confirms separate `core.character`.
- #1380: PR #1385, merge `fccae7ea54284fe74aa7028a6a3e9ca33b6fa1a2`, production run 32659028280.
- Durable resolution: live ledger/catalog confirms `20260902024541` and `20260902031743` applied and `plm.source_resolution` present.

## Bounded successors and routing

- #2333, ready: canonical Franchise and Franchise alias only.
- #2334, blocked on #2333: general canonical relationship bridges and their source-support tables. It preserves and audits the live Property/Character association contract.
- #2335, blocked on #2333/#2334: extend the live durable entity-resolution vocabulary and add source scope and relationship decisions.
- #2336, blocked on #2333/#2334/#2335: hash-pinned consolidation only.
- #2355, blocked on #2333: Character alias and canonical source-provenance facts.
- #2356, blocked on #2334/#2355: canonical Asset freshness/current-state facts only.
- #2357, blocked on #2335: browser-safe licensing candidate and review API views.
- #2358, blocked on #2336: reversible canonical merge functions and immutable history.

All eight carry the `db-work` label, `work_type: structural`, `route: shared-db-orchestrator`, explicit object scopes, and no data-load authority. They were announced only after a fresh marker resolution. Claims and versions remain unproven until the live orchestrator accepts each unit; Step 0.2 therefore stays partial.

## Still unproven and therefore open

- curated Property review #1941;
- one current complete validated source cycle for every source required by this plan;
- two weekly cycles plus one injected failure per source;
- full ColdLion resolution parity in the durable home;
- every consumer deployed on canonical APIs;
- a normal business cycle with zero compatibility readers;
- retirement of compatibility fields/views and sustained production monitoring.

These are not all structural work. Curated data stays under its governed exception; source automation stays with private source sessions; application cutover stays with each application session. None may be marked complete from this tracker without direct end-to-end evidence.
