---
issue: 912
status: BLOCKED
owner: codex/orchestrator-marker-910
---

# HANDOFF — orchestrator closeout (2026-08-14 04:00 UTC, al8960ofc/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

The next orchestrator must put this whole list to Albert in one message before resuming affected work. Do not reveal licensed row values in GitHub, public files, external tools, or logs.

### Blocking normalized licensing issue #912

1. **Connect the 19 old license-agreement rows to licensors.** Recommendation: let Albert review all 19 privately, one by one, and retain every old integer ID in the crosswalk. Text matching produces only 10 unique candidates, one ambiguous candidate, and eight unmatched rows; a matching name is not proof of the legal party. This blocks final schema design and migration mapping.
2. **Decide whether a reviewed source record may create a new master automatically.** Recommendation: require human approval for new canonical masters until the review system and audit trail are live. This blocks guarded migration-tool behavior.
3. **Choose the internal application that owns ongoing match review.** Recommendation: use DB Data Admin because it already owns shared master-data administration. This blocks the permanent review workflow, not the additive schema draft.
4. **Decide whether old table names need temporary read-only compatibility views.** Recommendation: keep compatibility until every reader and writer from the dependency audit has moved. This blocks the cutover design, not the additive first migration.
5. **Approve the exact production cutover and rollback window later.** Recommendation: decide only after the full preview rehearsal, row-count reconciliation, app cutovers, and rollback test pass. This blocks production only.

### Blocking Disney additive-field production issue #945

6. **Approve applying exactly migrations `20260813210000` and `20260813220000` to production after a fresh bounded dry-run and immutable review.** Recommendation: approve if the new run still lists only those two. Preview already passed. This blocks production promotion only.

### Already settled, do not re-ask

- 2026-08-13: `core.property` is the starting canonical property master.
- 2026-08-13: all 500 old mixed parent rows are reviewed individually; no bulk identity guess.
- 2026-08-13: all 26 current `core.licensor` rows keep their UUIDs during compatibility.
- 2026-08-13: Albert privately classified the 26 rows as 25 licensors and one property, with zero uncertain decisions.
- 2026-08-13: NBCU `source_kind` accepts any exact value containing a non-whitespace character; the private importer owns future-value review.
- 2026-08-13: Warner, NBCU, Disney, Paramount, and DCP licensed rows never belong in the public repository or outside-service prompts.
- 2026-08-14: DCP Vault Disney, Lucasfilm, Marvel, and 20th Century data use physically separate table families. Avatar remains unassigned and is rejected by all guarded studio loaders.

## 1. What this application is

`u2giants/shared-db`, checked out at `C:\repos\shared-db`, owns the structure of the shared Supabase database used by POP Creations applications. Production is Supabase project `qsllyeztdwjgirsysgai`; preview is branch project `rjyboqwcdzcocqgmsyel`. Structure changes are timestamped SQL migrations, rehearsed on preview, merged through GitHub pull requests, and promoted with bounded workflows that prove the target and exact migration list.

The private licensor-source repositories own licensed scrape rows and loaders. Shared-db owns only their landing-table shape, guarded database functions, access rules, and cross-application contracts.

This session was the sole active orchestrator under marker issue #910. It dispatched work to three isolated sub-agents and coordinated reviews, preview writes, merges, and production promotions.

## 2. What we set out to do this session, and why

The session began with two priority workstreams:

- **NBCU Scrape:** replace a closed three-value database check with a future-compatible non-whitespace rule without changing any other NBCU structure.
- **fix licensor tables:** audit and eventually replace mixed property/character/style-guide/licensor/agreement structures with normalized master data, preserving IDs and refusing guessed matches.

It later took on and completed:

- collision-tooling and drift-report fixes;
- stale production-contract and DROP-parser fixes;
- Disney additive fields and NBCU Asset-to-IP-Family preview repair;
- Warner normalized source schema issue #925 through production;
- DCP Vault studio separation issue #931 through production;
- a Grok second-opinion review of Warner, whose unverified follow-ups are now issue #946.

The goal at closeout is to leave every unfinished item in GitHub, preserve the full reasoning here, close marker #910 last, and make the next orchestrator able to resume without this chat.

## 3. Current state — what is true right now

### Live repository state, checked 2026-08-14 around 04:00 UTC

- `origin/main`: `9df7d1cb0be3de25a333112d7819cd317ba0d7c7`.
- Migration files on main: 449.
- Highest migration version: `20260814020000`.
- Open pull requests: none.
- Open orchestrator marker before final close: #910 only.
- Formal tracked open handoffs before this file: issue #943 dispatch collision Phase B and issue #900 licensor landing/loaders. Both issues are open.
- GitHub Issues are the live queue. `COORDINATOR_INTAKE.md` is retired and was not changed.

### Completed structure and tooling work

- NBCU source-kind PR #915 merged as `e448594fbec57ac03ba839ff4aac9c021c964bff`; migrations `20260813190000` and `20260813200000` are live in preview and production.
- Collision tooling PR #874 merged as `225d96a2899b42a72a2eb1a861e287f4533d64c1`.
- ColdLion alert tooling PR #864 merged as `96730a0a2d4975249782c79bf4c34533c7a82728`.
- Drift-report reasons PR #919 merged as `babd6ca5fed32278396f528b060e71bc1800dcee`.
- Production-contract/DROP-parser PR #920 merged as `e04676719dec25396204b071d21e14b30dbcf674`.
- Disney additive fields PR #924 merged as `96bf385aa5c0f703ec98f5730249f586964f5142`; preview has migrations `20260813210000` and `20260813220000`; production does not. Issue #945 tracks promotion and has `needs-albert`.
- NBCU Asset-to-IP-Family migration `20260811070000` was applied to preview in run `31732612322`; it was already live in production.
- Warner normalized source PR #929 merged as `fe3a888bba31802f2c53533de949bc5c5984bb8e`; migrations `20260813230000` and `20260813231000` are live in preview and production. All 11 normalized production tables were empty at final proof. Issue #946 tracks Grok follow-up verification.
- DCP studio separation PR #939 merged as `5cde35d71fcf578f02bf8038ff623922b9b37910`; migrations `20260814010000` and `20260814020000` are live in preview and production. Production run: https://github.com/u2giants/shared-db/actions/runs/31763981556. It added exactly those two versions. The 60 new tables were empty and access/FK/source guards passed read-only verification.
- Warner plan/handoff docs PR #926 merged as `f767238929a940e54615de33b8625eaa5aa18831`.

### Normalized licensing issue #912, unfinished

- Phase 1 dependency audit PR #914 merged; commit `5cc9f4885f1664031ae83e83bbfb7af393b10310`.
- Phase 2 count evidence PR #917 merged; commit `bf2749edcb79ab30823bbcb732698611edd789e0`.
- Owner-ruling/design evidence PR #918 merged; commit `33668cb3e803aadad791d9e65c0b210ac8e874a3`.
- Canonical public audit: `docs/normalized-licensing-master-dependency-audit-20260813.md`.
- Counts: mixed rows 10,122; old parents 500; old character appearances 9,622; direct old links 9,622; item links 1,924; canonical property/character/style-guide 256/0/0; current licensor/licenseList 26/19.
- All 500 old parent IDs were classified exactly once: 335 have direct structural evidence of style-guide use; 165 remain ambiguous. Two of the 335 have blank source IDs. All 22 parent nodes still referenced by item links are among the 165 ambiguous and must remain during compatibility.
- Albert completed the private 26-row review. The downloaded decision file validates as 26/26, zero invalid, 25 licensor, one property. Keep all 26 existing UUIDs. The property-classified licensor row needs a reversible mapping to `core.property`, not deletion or in-place type mutation.
- Private files, never commit or upload:
  - review page: `C:\Users\ahazan2\.codex\private-reviews\core-licensor-20260813\review.html`
  - decisions: `C:\Users\ahazan2\Downloads\core-licensor-decisions-private.json`
- No #912 schema, preview, production, app, or master-data write occurred.
- Issue #912 remains open and now has `needs-albert`. The next owner question is the 19 agreement-to-licensor mapping in section 0.

### Preview state

Latest direct evidence proves preview `rjyboqwcdzcocqgmsyel` has 445 applied ledger rows through DCP issue #931:

- run `31755612042` applied exactly `20260810190000`, `20260810190100`, `20260811050000`, `20260811060000` as two required atomic Disney prerequisite pairs;
- run `31755858026` applied exactly `20260814010000`, `20260814020000`;
- all DCP public synthetic suites passed with transaction rollback and zero persisted rows.

This does not prove full parity with all 449 main files because bounded workflows intentionally hide non-allowlisted files. Issue #901 remains open for a fresh complete ledger comparison. Its old “10 migrations behind” title/body is stale in detail.

### Local worktrees and untracked files

Issue #682 owns the safe worktree retirement audit; issue #884 covers previously dirty/unmerged housekeeping. Do not delete based only on Git ancestry because squash merges rewrite commits.

Known clean finished worktrees from this session include `nbcu-scrape-911`, `collision-tooling`, `disney-fields-812`, `fix-licensor-tables-912`, `wb-scrape-schema-925`, `wb-scrape-schema-925-impl`, `dcp-studio-separation-931`, `preview-observer-910`, and `startup-docs-910`. Some are not ancestors of main because their PRs were squash-merged. Verify PR state before cleanup.

The shared checkout contains pre-existing untracked `.ai/*`, `HANDOFF.d/start-phase-7a-prompt.md`, and `claim-931.md`. They were not created or staged by this handoff branch. Do not delete them without the cleanup procedure.

## 4. Everything we tried that did NOT work

1. **NBCU used `btrim(source_kind) <> ''`.** It rejected spaces but allowed tab/newline-only values. An independent review caught it after preview. We fixed forward with `20260813200000` using a POSIX non-whitespace predicate instead of editing the applied migration.
2. **The first NBCU preview run tried only the NBCU migration.** The hard guard stopped before dry-run because preview lacked security prerequisite `20260810180000`. We applied that merged prerequisite separately, then reran NBCU exact-only.
3. **NBCU tests initially called `begin_nbcu_capture` with the wrong argument count.** CI caught it; only the synthetic test call changed.
4. **The first DCP issue #931 preview dry-run omitted four merged Disney prerequisites.** The hard guard stopped before write. A separate bounded repair applied `20260810190000`, `20260810190100`, `20260811050000`, `20260811060000`, then #931 remained exact-only.
5. **DCP #931 initially documented Disney-only without enforcing it and left inherited direct INSERT access.** Independent review blocked preview. Forward branch fixes added exact Disney constraints, revoked inherited INSERT, strengthened FK allowlists, and expanded zero-write tests.
6. **Copied DCP tests initially used generic table names and malformed quoted SQL.** Migrations replayed successfully, but ephemeral tests failed. The fixtures/inventory were corrected until all four full studio suites passed.
7. **The first DCP production apply supplied the correct review digest without the literal `sha256:` prefix.** Run `31763643433` stopped before write. The corrected run `31763981556` applied successfully.
8. **One DCP post-apply read-only query had an ORDER BY alias typo.** Its read-only transaction aborted. A corrected full audit passed; no production state changed.
9. **Warner #925 first guessed the preview pooler tenant name.** Connection failed before any query or write. Verification moved to the linked CLI’s actual connection contract.
10. **Warner #925 had several review-found design bugs before preview:** newest-validating capture lookup, wrong shrink math, incomplete fallback identity handling, unsafe cast errors, over-broad function grants, missing route tests, false-positive exception tests, and a NULL manifest hole. Each was fixed before preview; repeated ephemeral database runs caught several test-only fixture errors.
11. **Grok’s first Warner review consumed about $4.47 and ended cancelled before a verdict.** Continuing the same session with a short no-tools request cost about $0.26 and produced `APPROVE WITH FOLLOW-UPS`. Do not start a duplicate Grok session for those findings; issue #946 exists for independent local verification.
12. **The first private licensor review dropdown offered Brand and Sub-brand.** Albert corrected the business vocabulary. The local page now offers only Licensor, Franchise, Property, and Uncertain. Any invalid saved choice was cleared before the final 26-row download.
13. **Pasting private licensor rows into chat was refused.** A local ACL-limited review page preserved privacy while letting Albert make row-level decisions.

## 5. Root causes and key findings

- The old licensing structure mixes business record types and levels of detail. The 500 rows labelled PROPERTY are not automatically canonical properties; direct structural evidence proves style-guide use for 335, while 165 remain ambiguous.
- `core."licenseList"` is agreement-shaped: 18 of 19 rows contain royalty terms. It cannot be the licensor master.
- Name equality is candidate evidence only. It cannot approve a master identity or legal contracting party.
- Compatibility matters: 1,924 item links still reference the old mixed model, including 825 links to 22 ambiguous parent nodes.
- The database/source split is deliberate. Landing databases accept reviewed source shapes; private importers decide whether a newly observed source value is approved.
- DCP Vault being one portal does not justify one landing family. Disney, Lucasfilm, Marvel, and 20th Century now have physically separate Phase 1 and Phase 2 families. Avatar is still unassigned.
- Preview is persistent shared state. Exact bounded pushes and full ledger comparison are both necessary; one does not replace the other.
- Default table privileges can silently grant direct writes to newly created tables. Explicit revokes and catalog tests are necessary even when migrations only grant SELECT.

## 6. Exact next steps

1. **Resume issue #912 and ask Albert the 19-agreement question from section 0.** If he chooses individual review, build another ACL-limited local page that shows each agreement and the approved 25 licensor choices, preserves the old agreement ID, includes Uncertain, and exports a private JSON file. You will know it worked when the export has 19 valid decisions and zero missing IDs.
2. **Record only safe decision metadata in #912 and the public plan.** Use IDs, destination type, counts, and timestamps; never labels or agreement terms. You will know it worked when no licensed value appears in the diff, PR, issue, or logs.
3. **Collect the remaining #912 owner rulings in section 0, then finish the Phase 3 design before SQL.** Define one canonical table per record type, source-identity governance, reversible approvals, typed link tables, compatibility, app ownership, retirement, and access rules. You will know it worked when a fresh reviewer can point to one canonical table for every business record type and no decision is left implicit.
4. **Implement #912 additively only after the design is approved.** Use new migrations above the then-current max, synthetic tests, guarded tools, and app-by-app cutover. Do not delete or rewrite old rows. You will know it worked when preview rehearses the full migration twice with zero new rows on repeat, zero lost records, no guessed relationships, and rollback proof.
5. **Handle issue #945 separately.** Recheck current main and production ledger, bounded-dry-run only `20260813210000,20260813220000`, generate immutable review evidence, and ask Albert for exact production approval. You will know it worked when production ledger adds only those versions and the nullable fields/FK match preview.
6. **Handle issue #946 as a verification task, not an assumed defect list.** Reproduce each Grok finding against current main and live read-only catalog. Fix only proven issues with forward migrations and focused tests. You will know it worked when every finding is marked proven-fixed or disproven with evidence, and no licensed value reaches Grok or GitHub.
7. **Refresh issue #901 with a full preview ledger comparison.** Do not infer parity from bounded runs. You will know it worked when every main version is classified applied, deliberately pending, or guarded, with zero unknown drift.
8. **Use issue #682 and the cleanup-worktree skill to retire finished worktrees after marker #910 is closed.** Never force-remove dirty/locked trees. You will know it worked when each removed tree has a merged PR proof and no unique changes.
9. **Start the next orchestrator by opening a new marker before dispatching schema work.** Read this handoff newest-first, then live GitHub issues. You will know it worked when exactly one orchestrator-marker issue is open.

## 7. Constraints and gotchas in force

- `COORDINATOR_INTAKE.md` is retired. GitHub `db-work` issues are the queue.
- Shared checkout is read/fetch only. Every session uses its own worktree from current `origin/main`.
- One schema writer and one preview writer at a time. Run the collision gate before work and create/close a `db-claim` for migrations.
- Never reuse a migration version or edit an applied migration.
- Prove preview or production project ref immediately before every write.
- Production uses a bounded checkout and exact migration allowlist. Never broad-push pending work.
- Licensed rows, labels, paths, rights text, and source payloads stay in approved private locations. Public tests use invented values only.
- Do not infer relationships from asset co-occurrence. Source IDs are stronger than labels. Ambiguous records remain unresolved.
- Do not delete old mixed licensing tables until every reader and writer is moved and rollback evidence exists.
- Use the cleanup-worktree skill for worktree retirement. Squash-merged branches are not reliably detected by ancestry.

## 8. Access and environment

- Machine: Windows 11 `al8960ofc`; user `ahazan2`.
- Canonical checkout: `C:\repos\shared-db`.
- Authenticated tools used: `gh`, `supabase`, `op`; secrets live in 1Password vault `vibe_coding`. No secret value belongs in this file.
- Preview: `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`).
- Production: `qsllyeztdwjgirsysgai`.
- Private licensor review files are listed in section 3 and must stay local.
- Private source repos used only under their scrape skills include `C:\repos\licensor-source-data-disney` and the NBCU private source checkout. Never copy their rows into shared-db.
- This handoff branch/worktree: `codex/orchestrator-handover-20260814-035644` at `C:\repos\shared-db\.claude\worktrees\orchestrator-handover-20260814-035644`.

## 9. Open questions and risks

- All owner questions are consolidated in section 0.
- #912 is a multi-application cutover. The largest risk is silently dropping or guessing destinations for old rows while apps still depend on the mixed tables.
- The one licensor row classified as Property cannot be deleted from `core.licensor` until compatibility consumers and FKs move.
- The 165 ambiguous parent rows and two blank-source-ID style-guide-use rows cannot auto-map.
- Preview parity remains unproven beyond the exact bounded runs; #901 owns this risk.
- Grok findings are a second opinion, not verified truth. #946 must reproduce them locally before any change.
- Issue #945 is production-pending and must remain separate from other migrations.
- Worktree cleanup is intentionally deferred to #682 after marker closure because many branches were squash-merged and several unrelated trees are dirty.

# Part (b) — sub-agent records

## Agent: Lorentz / `fix-licensor-tables-912`

- **Asked to do:** audit and advance normalized licensing #912; later repair drift reporting (#907), stale production contract/DROP parsing (#881/#882), and implement Warner #925.
- **Actually did:** merged PRs #914, #917, #918 for #912 evidence; #919 for drift reasons; #920 for parser/contracts; #926 plan docs and #929 Warner normalized schema. Production for #925 applied only `20260813230000` and `20260813231000`.
- **Found:** 335/500 parent rows have direct style-guide-use evidence, 165 ambiguous; 26 private decisions are 25 licensor/one property; 19 licenseList rows are agreements and require private licensor assignment.
- **PR / branch:** #912 branch `codex/fix-licensor-tables-phase2`; worktree clean. Warner branch `codex/wb-scrape-schema-impl-925`; worktree clean. Remote branches were deleted after merge.
- **Worktree:** finished code/evidence, but #912 workstream remains live and resumable; safe cleanup only through #682 after verifying merged PRs.
- **Deliberately did NOT do, and why:** no #912 schema/data/app/production change because the design and owner decisions are incomplete; no licensed values published.

## Agent: Euclid / `nbcu-scrape-911`

- **Asked to do:** NBCU source-kind #915, NBCU Asset-to-IP-Family preview #921, collision PR #874, Disney #812, and DCP studio separation #931.
- **Actually did:** merged #915, #874, #924, #939; applied NBCU and DCP exact migrations to preview/production; applied #921 preview repair; applied Disney #812 to preview only.
- **Found:** `btrim` was not a true whitespace rule; preview required several separately bounded prerequisites; DCP default privileges could preserve inherited direct INSERT unless explicitly revoked.
- **PR / branch:** final heads/merge SHAs and runs are recorded in sections 3 and 4. Clean worktrees remain for nbcu, collision, Disney, and DCP.
- **Worktree:** finished and safe to audit for cleanup via #682; do not infer merge from ancestry alone.
- **Deliberately did NOT do, and why:** no licensed rows/importers; no Disney #812 production promotion; no Avatar routing; no unrelated migrations bundled.

## Agent: Meitner / `preview-observer-910`

- **Asked to do:** read-only preview/production ledger observation, independent PR/design reviews, prerequisite analysis, and final queue/worktree audit.
- **Actually did:** caught NBCU whitespace weakness, Warner/DCP security and test defects, proved exact prerequisite sets, approved corrected heads, and delivered the 2026-08-14 live closeout audit.
- **Found:** bounded preview evidence reaches `20260814020000` but cannot prove all-main parity; two tracked handoffs both have open issues; no open PRs; worktree cleanup must be issue #682 work.
- **PR / branch:** no PR or branch; detached read-only worktrees only.
- **Worktree:** finished; safe to clean after marker closure under #682.
- **Deliberately did NOT do, and why:** no edits, database writes, GitHub mutations, or cleanup; independence required read-only review.

# Closeout self-audit

1. **Could a street-new developer continue without questions? Yes.** Sections 1–3 identify the system, projects, exact live state, completed PRs/migrations, local private files, and unfinished #912 state. Section 6 gives ordered actions with success gates.
2. **Could they continue as effectively as this session? Yes.** Sections 4–5 preserve failed paths, why they failed, identity/capture/security findings, and the database-versus-private-loader split. Part (b) preserves each agent separately.
3. **Are failed attempts included? Yes.** Section 4 lists 13 concrete failures/dead ends and their safe resolutions.
4. **Is every next step executable and verifiable? Yes.** Each of section 6’s nine steps ends with an observable success condition.
5. **Are terms, paths, URLs, SHAs, projects, and versions explained? Yes.** Sections 1, 3, and 8 define repositories, environments, paths, versions, commits, runs, and secret location without values.
6. **Did the section-0 sweep cover every owner ask in sections 1–9 and part (b)? Yes.** The five #912 decisions and #945 production approval are all in section 0. No other sentence requires Albert; #946 and #901 are engineering verification, #682 is cleanup, and Avatar is explicitly held rather than presented as a current owner question.

Final synthesis:

1. **Comprehensive enough for a brand-new developer? Yes.** Supported by sections 1–9 and each sub-agent block.
2. **Detailed enough to continue with all current knowledge? Yes.** Supported by exact state/evidence in section 3, failures in section 4, findings in section 5, and agent records.
3. **Every relevant background, goal, outcome, state, failure, decision, constraint, risk, action, and proof present? Yes.** The fixed checklist maps directly to sections 0–9.
4. **Would Albert see every needed decision by reading only section 0? Yes.** The line-by-line sweep found six owner decisions: five for #912 and one for #945; all six appear in section 0 with recommendations and what they block.
