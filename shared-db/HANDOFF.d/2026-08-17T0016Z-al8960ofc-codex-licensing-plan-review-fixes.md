---
issue: 1090
status: OPEN
owner: codex/licensing-master-data-plan-review-fixes-20260817
---

# HANDOFF: licensing Master Data plan review corrections (2026-08-17 00:16Z, al8960ofc/codex)

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None are currently open.

Already settled, do not re-ask:

- 2026-08-16: authorized licensor scrapes control official Property spelling, owning Licensor, Characters, Style Guides, Asset metadata, Franchises, and direct source-published relationships inside their licensed scope.
- 2026-08-16: ColdLion controls Property Active/Inactive only. It may propose an unmatched operational Property, but a Licensing user must confirm canonical name and owning Licensor before creation.
- 2026-08-16: the stale DesignFlow pull and DesignFlow PLM API are not licensing authorities.
- 2026-08-16: authorized licensor scrapes run at least weekly.
- Character/Property and Style Guide/Character are many-to-many; co-occurrence alone is not a direct Franchise relationship.
- The architecture is permanent documentation, not an unresolved issue. GitHub #1090 tracks implementation completion only.

Section-0 sweep result: Sections 1–9 and the revised 13-section plan contain no unresolved owner choice. Performance thresholds are bounded technical measurements, not business decisions. A newly discovered conflict with the authority matrix stops only the affected source and becomes one plain-language owner question.

## 1. What this application is

`u2giants/shared-db` is the canonical PostgreSQL/Supabase structure repository shared by PopDAM, PopPIM, PopCRM, DB Data Admin, and DesignFlow PLM services. DB Data Admin runs at `https://data.designflow.app` from `apps/db-data-admin/`.

The official licensing catalogue will use preview Supabase project `rjyboqwcdzcocqgmsyel` before governed production project `qsllyeztdwjgirsysgai`. Authorized licensed-source capture logic remains in four private repositories:

- `C:\repos\licensor-source-data-disney`
- `C:\repos\licensor-source-data-nbcu`
- `C:\repos\licensor-source-data-paramount`
- `C:\repos\licensor-source-data-warner`

The executable plan is [`../plan_licensing_master_data_implementation.md`](../plan_licensing_master_data_implementation.md). Read its STATUS table first.

## 2. What this session set out to do, and why

Albert asked to rewrite the licensing Master Data implementation plan using the implementation-plan standard, fix every GLM 5.3 finding, and then run the corrected plan by Grok 4.6.

The GLM review covered merged plan commit `1e7daffd7ac6d1507a76dc8452462bef6f876d0a`. It found four High, six Medium, and four Low gaps. This session corrected the plan, the paired handoff, the central architecture clarification, and the narrow `AGENTS.md` rule conflict. No database or application implementation is part of this session.

## 3. Current state

- Worktree: `C:\repos\shared-db-licensing-plan-revision-20260817`.
- Branch: `codex/licensing-master-data-plan-review-fixes-20260817`, based on `origin/main` commit `b262a9fd698b60ab0e455d63b8b97a965eb9bfbb`.
- Revised file: `plan_licensing_master_data_implementation.md`.
- Rule clarification: `AGENTS.md` §6.4-D. It permits only the future guarded, authorized, complete-capture consolidator to update matched authoritative fields. Ad-hoc external loads remain fully blocked on matched rows.
- Architecture clarification: `docs/core-master-data-consolidation-aim.md` now says scrape-created Properties start Potential and ColdLion-only create-new requires Licensing confirmation.
- No migration, database, preview, production, source data, application, deployment, secret, or schedule was changed.
- Every plan STATUS row remains open. Phase 0 Step 0.1 is still the implementation start.
- GLM 5.3's four High, six Medium, and four Low findings are all corrected and indexed in plan §6.1.
- Grok 4.6's first pass found four High, five Medium, and four Low items. All were corrected and indexed in plan §6.2. The same Grok session reread the complete revision and returned **Ready**.
- Grok review usage: first pass 1,814,332 tokens, $0.21711448; final pass 952,104 tokens, $0.15495568; total $0.37207016.
- Local review record: `.ai/reviews/grok-licensing-master-data-plan-revised-final.md` (ignored by Git).
- Changed-file checks passed, including 31 STATUS/step matches, owned local links, `git diff --check`, and 22 handoff-contract tests. The general link scan also found an older unrelated broken `orchestrator_take_over.md` link in `AGENTS.md`; this session did not change or rely on it.
- Revision commit: `5a0e16d` (`docs: harden licensing master data plan`).
- Pull request: [#1094](https://github.com/u2giants/shared-db/pull/1094). Verify its final MERGED state and merge SHA before beginning implementation.
- No database or application implementation has begun.

## 4. Everything tried that did not work

- The first GLM attempt reused an older licensing session pinned to GLM 5.2. That could not satisfy Albert's GLM 5.3 request, so it was stopped and replaced with a verified GLM 5.3 session.
- GLM's first read attempted internet search and the read-only permission guard rejected it. The exact merged plan was copied into the local review area and the same task was rerun safely.
- GLM reported `manage-migration-author-lanes.mjs --queue-audit` as nonexistent from its stale checkout. Verification on revised base `b262a9f` proved the flag exists at script lines 749/819 and is required by `AGENTS.md:668-670`. The revised plan correctly retains both queue and lane audits.
- GLM suggested allowing ColdLion spelling for ColdLion-only rows based on a stale interpretation. The settled architecture says ColdLion has no spelling or ownership authority. The correction keeps create-new but requires a Licensing user to confirm both facts; a later portal scrape still wins.
- The original plan assumed ColdLion mappings, omitted the DesignFlow PLM importer overwrite route, allowed new rows to inherit Active, left legacy resolution columns as a second truth, and did not define duplicate merge or real-volume timing. Each is now an explicit step and test.

## 5. Root causes and key findings

- `core.property.status` defaults to Active, so authorized scrape inserts must explicitly use Potential and leave matched status unchanged.
- `core.property.licensor_id` is already `NOT NULL` with `ON DELETE RESTRICT` in `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql:69-78`.
- `plm.import_master_data(jsonb,jsonb)` reads DesignFlow PLM API payloads and can overwrite Property ownership/status even though it does not read `dflow.*`. `systemd/plm-sync.timer` must remain stopped until an early forward guard lands.
- Existing approved portal mappings live in landing-resolution columns. Step 2.1 migrates those portal decisions into `plm.source_resolution` with count/target parity, then freezes only portal resolution writes. Step 4.0 separately retargets every ColdLion matching function, tool, and screen before freezing the `erp_*` decision columns.
- `core.property_character` currently cannot store two independent source observations for one canonical pair. Step 1.4 preserves its existing pair key and adds a companion source-support table. Step 2.3 replaces the old scalar axis invariant only after the audited relationship queue exists.
- Warner's normalized tables were empty in dated 2026-08-13 evidence. Step 3.0 now requires a real complete Warner preview capture before its adapter runs.
- Duplicate canonical rows need one whole-graph, reversible merge operation. Partial manual repointing is forbidden.
- Weekly freshness now escalates: first missed deadline alerts; second consecutive deadline disables source scope and pages a human; reviewed recovery is required.

The plan's §6.1 maps every GLM finding to its exact correction.

## 6. Exact next steps

1. Verify pull request [#1094](https://github.com/u2giants/shared-db/pull/1094) is MERGED and record its merge SHA in the implementing session's evidence. You will know it worked when GitHub reports `state: MERGED` and all required checks are successful.
2. Start implementation at Phase 0 Step 0.1 through `shared-db-orchestrator`, not from an older licensing plan. You will know it worked when the new session produces `docs/verification/licensing-master-data-phase0-<date>/`, refreshes the migration ledger/live catalog, and updates the plan STATUS row with evidence.
3. Complete Step 0.2's exact-object claim before Phase 1 Step 1.0. You will know it worked when the migration lane records name the protected tables, guard, DesignFlow importer, ColdLion promotion functions, grants, tools, services, and workflows listed in the plan.

## 7. Constraints and gotchas

- Shared-db uses branch, preview proof, review, pull request, merge, and governed production promotion for structure.
- No database mutation is authorized by this documentation task.
- Licensed values never enter this public repository, issues, pull requests, logs, or external AI prompts.
- ColdLion automation controls status only. A reviewed ColdLion-only create-new is a human licensing decision, not ColdLion authority.
- `plm.import_master_data` and `systemd/plm-sync.timer` are named early blockers, not cleanup work for the end.
- New scraped Properties start Potential; existing status is untouched by scrape consolidation.
- Phase 1 is additive. Scalar removals wait for Step 7.2 after deployed-reader proof.
- Production merge freeze and held versions `20260802170000`/`20260802171000` are explicit gates.
- Fetch 1Password secrets serially; never print or store values. Bare WSL does not inherit injected Windows environment values.
- Never edit another session's handoff. This file replaces the predecessor only because all obligations and decisions are carried forward and the predecessor commit is on main.

## 8. Access and environment

- GitHub CLI `gh` is authenticated.
- Node.js and PowerShell are available on Windows machine `al8960ofc`.
- Grok review must use `ai-grok-review` with `AI_GROK_CALLER=codex`, never direct `grok` commands.
- Supabase CLI and 1Password CLI are installed but are not needed for this documentation-only revision.
- Supabase token location: vault `vibe_coding`, item `Supabase CLI Personal Access Token`, field `SUPABASE_ACCESS_TOKEN`.
- Preview password location: vault `vibe_coding`, item `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`, field `password`.
- Production password location: vault `vibe_coding`, item `Supabase DB Password - shared POP database`, field `password`.
- Correct commit identity: `Albert Hazan <u2giants@users.noreply.github.com>`.

## 9. Open questions and risks

No business question is open.

Risks now controlled in the plan include DesignFlow importer overwrite, Active-by-default inserts, unresolved ColdLion mappings, legacy resolution dual truth, Warner missing capture, incomplete edge identity, unsafe duplicate merges, weekly silent failure, production merge drift, held migration contamination, and unbounded apply time/locks.

No material GLM or Grok objection remains. The main future risk is implementation discovering a source fact that conflicts with the settled authority matrix. If that happens, stop only the affected source, preserve private evidence, and ask Albert one plain-language question.

## Self-audit

1. **Can a street-new developer continue without asking a question? Yes.** Sections 1–3 identify the product, repositories, environments, branch/base, exact files, completed edits, and untouched systems. Section 6 gives ordered actions with proof.
2. **Can they continue as effectively as this session? Yes.** Sections 4–5 preserve the failed GLM routing, invalid command, stale ColdLion interpretation, every structural gap, and the corrective reasoning.
3. **Are failed attempts included? Yes.** Section 4 records what failed, how it failed, and what replaced it.
4. **Does every next step have a verification gate? Yes.** Every numbered item in Section 6 ends with an observable result.
5. **Are terms, identifiers, paths, URLs, SHAs, and access defined? Yes.** Sections 1, 3, 5, and 8 define them; secrets are locations only.
6. **Was the Section-0 owner-decision sweep completed? Yes.** Sections 1–9 were checked line by line. No open owner decision exists; every settled decision is indexed in Section 0.

Final synthesis:

1. **Is this handoff comprehensive enough that a brand-new developer could continue without skipping a beat? Yes.** Sections 1–9 and the linked plan contain the full context, state, correction ledger, actions, and evidence gates.
2. **Could they continue as well as this session with all relevant background? Yes.** Sections 3–5 preserve exact state, failures, and findings; Sections 6–8 preserve the remaining workflow and access.
3. **Is every relevant background, goal, intended outcome, state, failure, decision, constraint, risk, action, and verification fact present? Yes.** Those categories map directly to Sections 1–9 and plan Sections 1–13.
4. **If Albert read only Section 0, would he see every decision needed? Yes.** The line-by-line sweep found none open and Section 0 lists every settled owner ruling that must not be re-asked.
