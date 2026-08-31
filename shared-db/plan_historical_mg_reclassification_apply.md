# Implementation plan: guarded historical MG01-MG03 production reclassification

## STATUS

| Step | Status | Date | Evidence / starting point |
|---|---|---|---|
| 0. Re-verify source, code, GitHub, and live targets | ⬜ open | — | Start with the commands in §9 Phase 0; never reuse this plan's dated measurements. |
| 1. Build the private, live-qualified candidate manifest | ⬜ open | — | The manifest and its SHA-256 digest are the approval object. |
| 2. Implement and test the guarded data-only executor | ⬜ open | — | Synthetic tests in §10 must pass before any database write. |
| 3. Rehearse the exact manifest on preview | ⬜ open | — | Requires Albert's new preview-write authorization and §4.2 target proof. |
| 4. Obtain exact production authorization | ⬜ open | — | Authorization must name the manifest digest and live reconciliation output. |
| 5. Apply, verify, and retain rollback evidence | ⬜ open | — | Production write and verification are one serialized operation. |
| 6. Finish all residual historical items | ⬜ open | — | Current partial and unresolved results remain withheld. |
| 7. Decide whether the temporary cutoff may retire | ⬜ open | — | The exhaustive gate in §13 must pass; otherwise the cutoff remains. |

**Fresh-session start:** Step 0. Re-read all downstream phases before beginning each phase because the source snapshot, production rows, preview project, active taxonomy, and orchestrator route can change.

**Tracking issue:** [#1984](https://github.com/u2giants/shared-db/issues/1984). **Session handoff:** [HANDOFF.d/2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md](HANDOFF.d/2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md).

## 1. Ultimate goal

Every item created before May 14, 2025 must eventually carry a verified, current, division-qualified MG01, MG02, and MG03 classification produced from its description under the approved three-axis method. Until that is true for the complete live population, ambiguous or unsupported rows stay untouched and `api.resolve_item_mg_category(integer)` continues to withhold `mgCategory` from historical items.

This plan's first write phase is intentionally narrower: apply only complete level-3 triplets that still match one unambiguous live production item and one active MG01→MG02→MG03 hierarchy in that item's authoritative division. Level-2, level-1, unresolved, stale-source, ambiguous-identifier, and live-taxonomy-conflict rows are abstentions, not failures to force through.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

`u2giants/shared-db` is the public source of truth for the shared Supabase structure and the reusable historical classifier. The classifier is file-based Python under `docs/verification/item-mg-reclassification-20260814/`; it separates physical form (MG01), family-specific subtype/material (MG02), and explicit embellishment (MG03).

The internal Item Master export, definition workbook, reviewed dictionary, generated row output, and final workbook live privately in `u2giants/licensor-source-data` under `shared-db-relocated/2026-08-30/`. Do not copy them back into this public repository. The production target for this plan is the shared Supabase `dflow."itemHeader"` mirror. The temporary category read contract is `api.resolve_item_mg_category(integer)`.

This is application-data work under `AGENTS.md` §0.0-B, not structural orchestrator work. A future change to a table, function, constraint, policy, or the cutoff is structural and must be handed to the current shared-db orchestrator after re-running `node scripts/check-orchestrator-marker.mjs --resolve`.

## 3. What triggered this work

PR #1651 merged the three-axis matcher and its reproducible final distribution. Issue #1662 later shipped the temporary item-level `mgCategory` cutoff and is applied in production. Albert asked for an independent audit and a guarded route from proposals to approved historical row updates, with no row write and no cutoff retirement in this planning session.

The 2026-08-31 audit established:

- the committed matcher and all 37 tests reproduce the final workbook distribution;
- replacing every historical stored MG01-MG03 value with a sentinel produces byte-identical proposals and evidence, proving old codes are not teaching data;
- the workbook is a historical source snapshot, while production has since changed;
- item numbers are not globally safe write keys, and the workbook does not carry production `item_id_pk` values;
- some proposals do not form an active hierarchy in their live division, including retired `EP001` proposals and specific parent/child discrepancies;
- only a guarded subset of complete level-3 rows currently reaches one unique production item, the same division, a pre-cutoff production date, and an active three-level hierarchy;
- the live cutoff function is present, its migration is applied, and its body uses division-qualified MG01 only, with MG02 and MG03 absent.

These are findings, not frozen counts. Re-run §9 and use its artifacts for current numbers.

## 4. Scope

### In scope

- Reproduce the matcher from the private source artifacts and public committed code.
- Build a private manifest of complete, approved level-3 candidates joined to live production by stable primary key.
- Validate every candidate against its live division and active MG parent chain.
- Write and test a data-only executor, verifier, backup, and conditional rollback.
- Rehearse the exact manifest on preview after explicit preview-write authorization.
- Apply the exact approved manifest to production only after a separate explicit production authorization.
- Reconcile all attempted, changed, unchanged, skipped, and failed rows.
- Keep the cutoff until the exhaustive retirement gate passes.

### Not in this plan

- Applying level-2 or level-1 proposals as though they were complete reclassifications.
- Guessing an MG code, division, or production item identity.
- Treating historical stored MG values as evidence.
- Correcting the source workbook, dictionary, Item Master export, or `core."merchGroup"` taxonomy.
- Creating a database migration for ordinary item-row updates.
- Changing `api.resolve_item_mg_category(integer)` or removing its cutoff without a separately routed structural issue and Albert's explicit authorization.
- Writing preview or production rows merely because this plan or its pull request is approved.

## 5. Current state of the code and data

### Implemented and merged

- `docs/verification/item-mg-reclassification-20260814/hierarchical_item_taxonomy.py` implements the three independent maps and deepest-first matcher.
- `docs/verification/item-mg-reclassification-20260814/test_hierarchical_item_taxonomy.py` carries the contamination, date-boundary, code-validity, fallback, and old-code exclusion tests.
- `docs/item-description-mg-classification-process.md` is the permanent interpretation contract.
- `supabase/migrations/20260827213024_resolve_item_mg_category_cutoff.sql` defines the temporary production cutoff and MG01-only category derivation.

### Private artifacts

Resolve the private repository root rather than assuming a machine path. Under `shared-db-relocated/2026-08-30/` it contains the former paths for:

- `docs/verification/item-mg-reclassification-20260814/data/full_item_master.csv`;
- `docs/verification/item-mg-reclassification-20260814/data/MerchGroup_Rework.xlsx`;
- `docs/verification/item-mg-reclassification-20260814/product_type_dictionary.csv`;
- `outputs/issue-1113-taxonomy/item_mg_taxonomy_final.xlsx`.

Generated runs and row-level evidence must remain in that private repository or an ignored `.private/` workspace. Public commits may contain only code, synthetic fixtures, sanitized aggregate evidence, and documentation.

### Missing implementation

No guarded production manifest builder, data executor, backup format, verifier, or rollback command exists yet. The final workbook is a review artifact, not a runnable update file. Production identity and taxonomy qualification must be added live; the workbook alone is insufficient.

## 6. Key findings and root cause

1. **Snapshot drift:** the workbook describes the source export used by PR #1651; it does not account for every current production row and cannot prove that an item number still identifies one row.
2. **Identifier weakness:** `(Division, Item #)` is unique in the source export, but production contains duplicate or differently represented item identities. `ShortItemNo` is not the production primary key. The final manifest must resolve and freeze `dflow."itemHeader".item_id_pk` from a fresh, unique live join.
3. **Division authority:** ColdLion's division code is authoritative. The live mirror may require `dflow."divisionCode"` to resolve older numeric division links. `EP001` is a real retired division and must not be rewritten as another division; its proposals currently lack a live active taxonomy and therefore abstain.
4. **Hierarchy qualification:** an MG code is meaningful only within its division, type, and parent. Code-only lookup is unsafe because the same MG02 or MG03 code can appear under multiple parents. Qualification must walk active MG01 → MG02 → MG03 rows by `parent_id`.
5. **Evidence strength:** complete level-3 assignments meet the matcher support/share gates and have all three proposed codes. Partial assignments are useful audit evidence but are not complete reclassifications.
6. **Category capability:** the category function reads normalized MG01 ID, not only the raw MG text. A successful row update must keep raw MG01-MG03 codes and `udf_merchgroup01_id` through `udf_merchgroup03_id` consistent.
7. **Cutoff denominator:** production contains rows with null creation dates. Such rows cannot be silently classified as post-cutoff; they block retirement until their date/status is authoritatively resolved.

## 7. Approaches considered and rejected

- **Apply the workbook wholesale — rejected.** It contains stale/ambiguous identities and live division-hierarchy failures.
- **Join by item number alone — rejected.** Item number is not guaranteed unique in production.
- **Join by the source's `ShortItemNo` — rejected.** It is sparse and does not map to `item_id_pk`.
- **Use existing historical MG codes to resolve ambiguity — rejected.** Those codes predate the method and are comparison fields only; the negative-control run proves they are unnecessary.
- **Apply level 2 or level 1 and retain old lower levels — rejected.** That creates a mixed classification whose MG03 can appear approved when it is not.
- **Clear unsupported lower levels automatically — rejected for the first batch.** Clearing is a destructive decision distinct from applying an approved triplet and needs its own reviewed policy.
- **Treat `EP001` as `EH001` or another live division — rejected.** `EP001` is a real retired division; substitution invents evidence.
- **Validate codes globally or by code prefix only — rejected.** The active live division and exact parent chain are required.
- **Use a migration for the data batch — rejected.** Ordinary `dflow` item rows are application data under §0.0-B. Any structural prerequisite discovered later is a separate orchestrator task.
- **Remove the cutoff after the first approved batch — rejected.** Partial completion cannot satisfy issue #1662's explicit complete-population gate.

## 8. Design decisions

### Locked

- May 14, 2025 remains the item-method boundary.
- Historical MG values have zero classification weight.
- The first write batch contains complete level-3 assignments only.
- Every candidate requires an exact live division-qualified active parent chain.
- Every write targets `item_id_pk` and uses compare-and-swap predicates on the backed-up before-state.
- Preview and production require separate, explicit authorizations.
- Production authorization names one manifest SHA-256 digest; any regenerated manifest invalidates it.
- The cutoff remains until §13 passes and its removal is separately routed as structural work.

### Open only where stated

- Whether later phases may apply partial level-2/level-1 classifications or clear unsupported old lower levels is an owner decision after the complete-triplet batch.
- How `EP001` historical items should be represented against a retired/no-longer-active taxonomy is an owner/business-taxonomy decision; do not infer it.
- Rows with null or conflicting creation dates require authoritative source resolution before the final cutoff gate.

## 9. Ordered implementation plan

### Phase 0 — re-derive current truth (read-only)

1. From a clean worktree at current `origin/main`, read `AGENTS.md`, this plan, `docs/item-description-mg-classification-process.md`, and `plan_mg_taxonomy_three_axis_repair.md`. Verify PR #1651 and issues #1662/#1984 live on GitHub. Resolve the current orchestrator and run the queue audit. **Gate:** record current SHAs, issue states, clean status, and a declared/none/unsafe orchestrator result; do not use a remembered route.
2. Resolve the private `licensor-source-data` checkout and verify the source, workbook, dictionary, and preserved final workbook by SHA-256. Run the 37 classifier tests, regenerate the row outputs and eight-sheet workbook with the commands in the permanent process document, and visually inspect every sheet. **Gate:** tests pass, the summary reconciles to the row CSV, no workbook formula errors exist, and all outputs stay private.
3. Run the historical-code negative control: replace pre-cutoff MG01-MG03 comparison values with sentinels, rerun, and compare proposal/evidence columns. **Gate:** byte-identical digests; otherwise stop because historical codes influence the result.
4. Query production read-only through the Management API with `read_only: true`, quoting the observed project ref in the report. Re-read the cutoff migration ledger/object, live item population, division resolution, active MG hierarchy, and source-to-production identifier reconciliation. **Gate:** target is the protected production ref, the cutoff contract is present, and no write-capable call is made.

**Natural context cut:** start a fresh session before Phase 1 and re-read Phases 1–7.

### Phase 1 — build the private candidate manifest (read-only)

5. Add `scripts/historical-item-mg-reclassification/build-manifest.mjs`. It reads the private level-3 output and live production metadata, but never descriptions into a public artifact. Resolve production division from authoritative ColdLion-backed fields/links, then require exactly one production row for the source identity. Freeze `item_id_pk`, resolved division, production creation date, all six current raw/ID MG fields, proposed raw codes, proposed MG IDs, evidence level/support/share, source hashes, and the live taxonomy-row IDs/parents.
6. Fail/abstain each row with a machine-readable reason: not level 3; blank proposal; non-unique or missing target; source/production division mismatch; non-historical or null production date; inactive/missing MG row; wrong parent chain; inconsistent duplicate active taxonomy rows; or source/output digest drift. Never emit a writable candidate with a warning.
7. Write the full manifest, abstention ledger, and backup-plan metadata under the private repository. Produce only sanitized counts and SHA-256 digests publicly. **Gate:** candidate + abstention + no-op totals reconcile exactly to regenerated historical rows, every candidate has one `item_id_pk`, and re-running against unchanged inputs produces the same manifest digest.

### Phase 2 — implement the guarded executor and rollback

8. Add `scripts/historical-item-mg-reclassification/apply.mjs`, `verify.mjs`, and `rollback.mjs`, plus synthetic fixtures. The executor accepts `--target preview|production`, `--manifest`, `--expected-manifest-sha256`, and `--mode plan|apply`; default is `plan`. It refuses unknown targets, production without a separate production-authorization artifact, any digest mismatch, any non-level-3 row, and any live drift from the manifest's before-state.
9. In one transaction, create no permanent table. Lock candidate item rows, revalidate date/division/current values and the active parent chain, then update raw MG01-MG03 and normalized MG01-MG03 IDs together. Use `WHERE item_id_pk = ...` plus all before-state comparisons; affected-row count must equal the exact planned change count or the transaction rolls back.
10. Before applying, export a private backup containing the stable primary key, six before fields, six intended after fields, target proof, manifest digest, and timestamp. The conditional rollback updates only rows whose six current values still equal this batch's after-state; intervening edits cause abstention and manual review, never overwrite.
11. `verify.mjs` re-reads every candidate and every abstention aggregate. It proves raw/ID consistency, exact division hierarchy, unchanged non-candidates, no null IDs for applied triplets, no unexpected row count, and the category function's MG01-only behavior. **Gate:** all unit/integration tests in §10 pass with a disposable local database or transaction-rollback fixture before preview.

### Phase 3 — preview rehearsal

12. Obtain Albert's explicit authorization for preview row writes in the new implementation session. Resolve the live preview project from repository configuration; never copy a literal ref from this document. Immediately before connecting and immediately before the write, verify `supabase/.temp/project-ref` and quote it.
13. Generate a preview-specific manifest from preview's own current rows using the same approved source digest and logic. First run `--mode plan`; reconcile candidates/abstentions. Apply inside the guarded transaction, run `verify.mjs`, exercise `api.resolve_item_mg_category` on sanitized fixtures/IDs, then run and verify the conditional rollback. Re-apply only if the rehearsal definition requires durable preview state and Albert authorized that exact action.
14. Store the preview before/after/rollback evidence privately. **Gate:** exact planned count changed, no non-candidate changed, rollback restores the digest, and all abstentions remain untouched. Any mismatch invalidates the production path.

**Natural context cut:** start a fresh session before production authorization; re-run Phase 0 and re-read Phases 4–7.

### Phase 4 — production authorization boundary

15. Regenerate the production manifest from fresh live reads after the preview rehearsal. Any changed source, code, taxonomy, target rows, or manifest digest requires another preview plan/rehearsal as appropriate.
16. Give Albert one concise approval request naming: production target, manifest digest, exact live candidate/change/no-op/abstention counts, backup path/digest, preview evidence, rollback behavior, and the exact six fields to update. **Do not write production rows until Albert explicitly authorizes this exact manifest in that new session.** General approval of the plan, PR, preview, or historical project is insufficient.

### Phase 5 — production apply and reconciliation

17. Announce/coordinate a short data-write window with the owning application session. Immediately before the connection and again immediately before the write, prove `supabase/.temp/project-ref` is the protected production ref. No intervening tool call, reconnect, or turn may separate proof from write.
18. Run `--mode plan` against the approved digest. If counts or before-state changed, stop and return to Phase 4. Otherwise run the single transaction, then immediately run `verify.mjs` against production.
19. Reconcile attempted = changed + already-equal + abstained + failed, and candidate = changed + already-equal. Verify non-candidate aggregate digests and category behavior. Store private backup/evidence; report only safe counts, field presence, digests, timing, and target proof publicly.
20. If verification fails, stop consumers if necessary without altering capability, run conditional rollback against the exact batch after-state, verify restoration, and preserve both failure and rollback evidence. Do not use broad restore, unconditional update, or cutoff removal.

### Phase 6 — residual completion

21. Work residual classes separately: ambiguous/missing production identity; live hierarchy conflicts; retired `EP001`; partial level-2/level-1 evidence; no usable product; readable product without MG01; null/conflicting dates; and items added since the source export. Each successor needs its own evidence and owner decisions where listed in §8.
22. Regenerate the complete-population ledger after every residual batch. Never relabel an abstention as approved merely to lower the count.

### Phase 7 — cutoff retirement gate

23. Run the exhaustive gate in §13 against the current production population. If any row fails, the cutoff remains with no structural issue opened merely for elapsed time or partial progress.
24. Only after the gate passes and Albert explicitly authorizes retirement, re-resolve the live shared-db orchestrator, open a new `db-work` structural issue naming `function api.resolve_item_mg_category(integer)`, and stop. The orchestrator owns migration authoring, preview, reviews, merge, and production promotion. The data session must not edit the function.

## 10. Tests required

Add `scripts/historical-item-mg-reclassification/*.test.mjs` with synthetic data only:

1. old-code sentinel mutation leaves proposals unchanged;
2. duplicate item number refuses both candidates unless the approved source identity resolves exactly one `item_id_pk`;
3. source/production division mismatch abstains;
4. null, post-cutoff, or changed creation date abstains;
5. inactive or missing MG01/MG02/MG03 abstains;
6. duplicate code under different parents selects only the exact parent chain;
7. `EP001` with no active taxonomy abstains and is never remapped;
8. partial levels never enter the writable manifest;
9. manifest digest mismatch refuses apply;
10. target mismatch refuses connection before DML;
11. compare-and-swap drift rolls back the entire batch;
12. raw codes and normalized IDs update atomically;
13. no-op rows are counted but not changed;
14. non-candidate rows remain byte-equivalent;
15. reconciliation equations fail closed on any mismatch;
16. rollback restores only exact batch after-state and refuses intervening edits;
17. preview authorization cannot satisfy production authorization;
18. production authorization for one digest cannot authorize another;
19. cutoff-retirement checker fails for every residual class and passes only for an exhaustive complete population.

Run the existing classifier suite as well. If a structural successor is opened, its orchestrator-owned tests must prove the function still derives category only from active, division-qualified MG01.

## 11. Constraints and gotchas

- No row write in the planning session. No preview or production write without new explicit authorization.
- The repository is public. Keep item descriptions, row manifests, backups, and review workbooks private.
- Do not hardcode the preview ref; read the repository variable and prove the live link.
- Production target proof expires after any intervening tool call, reconnect, or turn.
- Code values are not globally unique; division, MG type, and `parent_id` are all required.
- Historical `EP001` is real and retired; do not convert it to another division.
- Source and production dates can disagree. The production row must independently satisfy the cutoff.
- Do not infer success from migration ledger presence or a workbook headline; verify live rows and function behavior.
- Do not stage unrelated files. Check `git var GIT_COMMITTER_IDENT` before the first commit.
- A structural need, including cutoff removal, is not absorbed into this data plan; route it fresh through the current orchestrator.

## 12. Access and environment

- Public repo: `u2giants/shared-db`, branch from current `origin/main`, pull request required.
- Private artifacts: `u2giants/licensor-source-data`, `shared-db-relocated/2026-08-30/`; preserve private handling.
- Production read-only audit: Supabase Management API with the personal access token from 1Password vault `vibe_coding`, item `Supabase CLI Personal Access Token`; never print the value.
- Database connection credentials: use the canonical preview/production items named in `docs/agents/runbooks-credentials-cli-and-gotchas.md`; values travel only through protected environment injection.
- Python/Node: use the bundled workspace runtimes returned by the Codex workspace dependency loader.
- Windows Git Bash checks: use `C:\Program Files\Git\bin\bash.exe`, not bare `bash`.

## 13. Definition of done, risks, rollback, and open questions

### First approved batch is done only when

- public executor code and synthetic tests are committed, pushed, reviewed, and merged;
- the private candidate/abstention manifest is reproducible and digest-bound;
- preview plan/apply/verify/rollback passed under explicit authorization;
- Albert explicitly authorized the exact production manifest digest;
- production target proof was quoted immediately before the write;
- candidate, change, no-op, abstention, failure, and non-candidate counts reconcile;
- private before/after/rollback evidence is retained;
- capability still works: applied items have consistent raw/ID triplets and category resolution remains MG01-only;
- residual rows remain explicitly open and untouched.

### Cutoff retirement is allowed only when a fresh production query proves all of the following

1. Every live item is unambiguously classified as post-cutoff or historical; no unresolved/null creation date remains.
2. Every historical production item is represented exactly once in the completion ledger by stable `item_id_pk`.
3. Every historical item has non-null raw and normalized MG01, MG02, and MG03 values that agree.
4. Every triplet resolves through active rows in the item's authoritative division with exact MG01→MG02→MG03 parentage.
5. No unresolved, partial, ambiguous-identity, taxonomy-conflict, stale-source, failed, or rollback-pending row remains.
6. Row totals reconcile to the current live population, not to the August source snapshot.
7. Independent review confirms the evidence and Albert explicitly authorizes the structural retirement.

If any condition is false, the cutoff remains. Passing this gate does not itself authorize a function change.

### Risks and mitigations

- **Concurrent application edits:** compare-and-swap and row locks; drift aborts the whole transaction.
- **Wrong target:** immediate project-ref proof before connection and write.
- **Stale taxonomy/source:** fresh manifest generation and digest-bound authorization.
- **Identifier collision:** stable `item_id_pk` only after unique live resolution.
- **Mixed raw/normalized state:** six fields updated and verified atomically.
- **Bad rollback:** conditional rollback only when current state equals this batch's after-state.
- **Private-data exposure:** private artifacts remain outside the public repo and public logs show aggregates/digests only.

### Open owner decisions

- Whether a later phase may apply partial level-2/level-1 results or clear unsupported old lower levels.
- The approved treatment of historical `EP001` against the retired/no-active taxonomy.
- The authoritative resolution route for null/conflicting creation dates.

## Mandatory self-audit

1. **Could a brand-new session execute this without asking the planner anything? Yes.** Sections 2, 5, 9, 10, and 12 identify the repositories, artifacts, exact phases, commands/contracts, tests, access, and authorization boundaries. Genuine business decisions are isolated in §§8 and 13 rather than hidden as implementation guesses.
2. **Does the plan preserve the investigation, rejected paths, and reasoning? Yes.** Sections 3, 6, and 7 carry the reproduced matcher proof, production drift/identity/division findings, capability constraint, and every rejected shortcut that could corrupt rows.
3. **Is the goal clear enough for a correct judgment call? Yes.** Section 1 makes complete, defensible classification the controlling goal and explicitly makes abstention preferable to an unsupported write; §13 defines the exhaustive cutoff gate.

All 13 required sections are present; locked/open decisions, explicit exclusions, concrete files, verification gates, tests, secrets-by-location, rollback, landing, and the handoff backlink are included.
