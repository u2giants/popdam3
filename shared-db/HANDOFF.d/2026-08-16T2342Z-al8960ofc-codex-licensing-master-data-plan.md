---
issue: 1090
status: OPEN
owner: codex/licensing-master-data-plan-20260816
---

# HANDOFF: licensing Master Data implementation plan (2026-08-16 23:42Z, al8960ofc/codex)

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None are currently open.

Already settled, do not re-ask:

- 2026-08-16: authorized licensor scrapes control official Property spelling, owning Licensor, Characters, Style Guides, Asset metadata, Franchises, and direct relationships.
- 2026-08-16: ColdLion controls Property Active/Inactive only.
- 2026-08-16: the stale DesignFlow pull has no authority.
- 2026-08-16: authorized licensor scrapes run weekly.
- Character/Property and Style Guide/Character are many-to-many; co-occurrence alone is not a direct Franchise relationship.

The architecture is permanent documentation, not an issue. GitHub #1090 is only the implementation completion tracker required by the handoff system.

Section-0 sweep result: Sections 1–9 and the implementation plan contain no unresolved owner choice. A newly discovered conflict with the authority matrix must stop only the affected source and be raised as one plain-language owner question.

## 1. What this application is

`u2giants/shared-db` is the canonical PostgreSQL/Supabase schema repository used by PopDAM, PopPIM, PopCRM, DB Data Admin, and DesignFlow PLM services. DB Data Admin runs at `https://data.designflow.app` and is implemented under `apps/db-data-admin/`.

The official licensing catalogue will live in shared Supabase project `qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`. Licensed-source captures are maintained in four private local repos:

- `C:\repos\licensor-source-data-disney`
- `C:\repos\licensor-source-data-nbcu`
- `C:\repos\licensor-source-data-paramount`
- `C:\repos\licensor-source-data-warner`

## 2. What this session set out to do, and why

Albert asked for a fresh-session-ready implementation plan to start applying the settled licensing architecture to the database. The result is [`../plan_licensing_master_data_implementation.md`](../plan_licensing_master_data_implementation.md).

The plan covers canonical entity/relationship repairs, durable resolution, four source adapters, ColdLion status, DB Data Admin, weekly operations, consumers, testing, preview, and governed production landing.

## 3. Current state

- The settled architecture is already on `main` in `docs/core-master-data-consolidation-aim.md`.
- This session created the implementation tracker #1090, explicitly marked as execution-only.
- The plan was drafted from `main` commit `fa59fd151dcc233d81a752a1cb283c0026ff731c` on branch `codex/licensing-master-data-plan-20260816`.
- No migration, database, preview, production, application, source data, or deployment change was made.
- Implementation has not started. Every STATUS row in the plan is open; Phase 0 Step 0.1 is first.
- Production ledger run `31979756895` showed 14 merged-but-not-applied versions; durable source-resolution migrations are among the genuinely pending versions. The plan treats that as a prerequisite, not permission for a broad apply.
- The four inspected private source repos had no checked-in weekly GitHub workflow schedules. The plan includes weekly automation/failure evidence.

## 4. Everything tried that did not work

- The architecture was initially recorded as an issue. Albert correctly rejected that framing. Issue #1086 was closed; the decision was moved into permanent central documentation. Do not repeat that mistake.
- Existing Character/Style Guide and ColdLion plans were considered as direct execution plans. They contain superseded DesignFlow, ColdLion-name, and one-Property-per-Character assumptions, so this new plan treats them as historical evidence only.
- A live-catalog absence was not treated as proof that work never existed. The migration-ledger workflow showed real drift, including source-resolution SQL merged but not applied.
- No attempt was made to invent a second canonical table family. Existing `core.*` and `dam.asset` objects are the required base.

## 5. Root causes and key findings

- `core.character` still has scalar `property_id` while `core.property_character` already exists, creating two ownership shapes.
- `core.style_guide` still has scalar `property_id`; the settled architecture requires direct many-to-many source relationships.
- `core.franchise` does not exist, although all relevant source systems can carry Franchise/IP Family concepts.
- `dam.asset` is the established metadata home but lacks Property, Style Guide, and Franchise bridges with source/freshness evidence.
- `plm.source_resolution` is the right durable mapping mechanism, but currently supports only Property, Character, Style Guide, and Asset and is not yet applied to production.
- Source landing tables already exist for Disney, NBCU, Paramount, and Warner. The missing layer is safe canonical consolidation, not another capture schema.
- ColdLion has mature safety tooling, but its canonical write authority must be narrowed to Property Active/Inactive.

Exact evidence and line references are in plan Sections 5–7.

## 6. Exact next steps

1. Open `plan_licensing_master_data_implementation.md` and read the STATUS table plus Sections 1, 8, 9, and 11. You will know this is done when the fresh-session starting point is Phase 0 Step 0.1 and no prior phase is marked complete without an artifact.
2. Use `shared-db-orchestrator`, verify the active marker, and route implementation tracker #1090. You will know it worked when exact objects are classified and no second coordinator exists.
3. Execute Phase 0 Step 0.1, producing `docs/verification/licensing-master-data-phase0-<date>/`. You will know it worked when preview/production ledgers, live catalog, dependencies, source inventory, and row counts are all evidenced with target proof.
4. Claim exact-object author lanes and reserved migration versions. You will know it worked when GitHub-backed claims succeed and no migration filename was chosen manually.
5. Follow the plan phase by phase, updating its STATUS/current-state sections after every completed step. Each step already contains its verification gate.

## 7. Constraints and gotchas

- Structure goes through shared-db branch, preview, independent review, PR, guarded merge, and governed production lane.
- Outside-sourced writes into curated `core.*` remain separately governed.
- Prove the project immediately before every data write.
- Never copy licensed values/files into this public repo or external AI prompts.
- DesignFlow is historical evidence only; ColdLion writes status only.
- Never infer direct relationships from names, folders, paths, or co-occurrence.
- Never hard-delete canonical entities during refresh.
- Use existing landing tables, `plm.source_resolution`, `dam.asset`, and reusable grid filters.
- Fetch 1Password secrets serially. On Windows, do not expect injected environment values to cross into WSL `bash`.
- Do not broadly apply the current production migration backlog.

## 8. Access and environment

- GitHub CLI was authenticated during planning.
- Supabase CLI and 1Password CLI are installed.
- Supabase token: vault `vibe_coding`, item `Supabase CLI Personal Access Token`, field `SUPABASE_ACCESS_TOKEN`.
- Preview password: vault `vibe_coding`, item `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`, field `password`.
- Production password: vault `vibe_coding`, item `Supabase DB Password - shared POP database`, field `password`.
- Use source-specific scrape skills for portal credentials and procedures.
- Correct commit identity: `Albert Hazan <u2giants@users.noreply.github.com>`.

## 9. Open questions and risks

No business question is open. Technical judgments are bounded in plan Section 8.

Main risks are wrong source-to-canonical mapping, short pulls retiring edges/status, stale DesignFlow writes reappearing, scalar-to-bridge consumer breakage, co-occurrence becoming false truth, broad production promotion, licensed-data leakage, and silent missed weekly runs. Plan Section 13 pairs every risk with controls and recovery.

## Self-audit

1. **Can a street-new developer continue without asking a question? Yes.** Sections 1–3 define the system, purpose, exact repo/environment state, branch, commit, and first step. Sections 6–8 provide executable next actions, rules, and access.
2. **Can they continue as effectively as this session? Yes.** Sections 4–5 preserve the failed issue framing, stale-plan trap, ledger-drift finding, exact schema gaps, and reusable foundations; the linked plan contains the complete evidence and build specification.
3. **Are failed attempts included? Yes.** Section 4 records every rejected path and why it failed; the plan's Section 7 expands them.
4. **Does every next step have a verification gate? Yes.** Section 6 ends each action with an observable result and points to the per-step gates in plan Section 9.
5. **Are terms, identifiers, paths, URLs, projects, SHAs, and access defined? Yes.** Sections 1, 3, and 8 define them; secrets are named by location only.
6. **Was the Section-0 owner-decision sweep completed? Yes.** Every sentence in Sections 1–9 and the plan was checked. No open owner decision exists; all settled decisions are indexed in Section 0.

Final synthesis:

1. **Is this handoff comprehensive enough for a brand-new developer to continue without skipping a beat? Yes.** Sections 1–9 and the linked 13-section plan contain the full context, state, execution sequence, and evidence gates.
2. **Could they continue as well as this session with all relevant background? Yes.** Sections 3–5 preserve current truth and dead ends; the plan preserves schema lines, source tables, ledger state, and decisions.
3. **Is every relevant background, goal, state, failure, decision, constraint, risk, next action, and verification fact present? Yes.** Handoff Sections 1–9 map directly to those categories; plan Sections 1–13 provide the implementation detail.
4. **If Albert read only Section 0, would he see every decision needed? Yes.** The line-by-line sweep found no open decision. Section 0 lists every locked owner ruling and explains that #1090 is execution-only.
