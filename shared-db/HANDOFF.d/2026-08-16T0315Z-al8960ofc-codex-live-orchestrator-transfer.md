---
issue: 1050
status: BLOCKED
owner: codex/orchestrator-live-transfer-20260816
---

# HANDOFF — live shared-db orchestrator transfer (2026-08-16 03:45 UTC, al8960ofc/Codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### No new decision blocks this transfer

Albert explicitly ordered the outgoing orchestrator to empty all three migration-author queues and let the fresh orchestrator rebuild them. That is complete: 0/3 author claims are open. Do not re-ask.

Albert explicitly approved applying exactly Disney migrations `20260813210000` and `20260813220000` together. Do not re-ask the business decision. The apply did not happen because the governed workflow lacked a safe way to bind an explicit owner risk decision and lacked historical preview evidence. Issue #1042 and closed PR #1043 preserve the fix.

### Existing owner decisions, all visibly labelled

The following 27 open issues have `db-work-scope state: owner-decision` and now carry `needs-albert`. The incoming orchestrator must present their narrowed questions in plain English, not code, and must not silently decide them. Recommendation for each is to follow the exact recommendation already recorded in its issue after first rechecking whether later work made it stale:

- #817 Paramount capture incompleteness: finish the already-assigned recapture; do not invent missing assets.
- #816 Paramount global asset count: do not sum overlapping brand facets; accept unavailable until an authoritative total exists.
- #810 B5 verification: run the real application smoke test and non-admin acknowledgement.
- #815 Paramount names in public docs: correct the inaccurate blanket claim rather than pretending the already-public names are absent.
- #644 production admin bypass: decide only after #643's separate-agent identity is resolved; avoid locking out emergency access meanwhile.
- #643 production credential hole: give agents a separate identity without approval rights.
- #645 vendor contact details in public history: remove them from the current tree and decide private history remediation with legal/business input.
- #511 `core.character` cascade delete: prefer a fail-loud relationship that does not silently destroy characters.
- #768 DesignFlow database destination: verify deployed configuration rather than infer it from database traffic.
- #875 and #906 ColdLion plain HTTP: obtain and verify an HTTPS endpoint; do not rotate or switch blindly.
- #879 ColdLion property universe: use the verified 48-unmatched count and keep canonical curation authoritative.
- #551 ColdLion alert dedupe: verify the monitor is safely deduplicated before closing historical duplicates.
- #516 remaining licensor/property cutover choices: answer the issue's six bounded questions together.
- #515 ownerless properties: use the issue's recommended explicit representation rather than inventing a fake licensor.
- #906 ColdLion HTTPS question: send the single clean vendor question recorded there.
- #769 alleged R5 ruling: require an actual source or withdraw the unsupported ruling.
- #1031 ColdLion history puller: send the prepared vendor question and choose the historical start date before implementation.
- #903 division questions for Uma: send the prepared questions unchanged.
- #503 four older owner decisions: recheck for stale answers, then answer the remaining bounded choices together.
- #865 two property universes: reconcile against the complete universe, not the smaller legacy subset.
- #559 branch protection: retain the documented required-review protection unless a replacement is proven.
- #898 DELETE privileges: review actual consumers before retaining or removing them.
- #539 five ColdLion property-code questions: answer using the corrected 48-unmatched evidence.
- #711 promotion decisions: recheck which remain live after the automated risk gate; do not re-ask satisfied ones.
- #521 Disney Coco property: query by licensor plus code and use private evidence; never guess from code alone.
- #732 NBCU rights: obtain amendment evidence and decide scope/typo/restriction treatment before loading.
- #531 orchestrator skill size: recommendation on record is leave the rationale intact unless measured context cost justifies a careful split.

## 1. What this application is

`u2giants/shared-db` is the public source of truth for the structure of POP Creations' shared Supabase database. It governs tables, columns, functions, views, triggers, policies, indexes, constraints, structural reference rows and cross-application contracts used by PopDAM, PopPIM, PopCRM and DesignFlow. Preview is Supabase project `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.

One orchestrator coordinates up to three unrelated migration authors in isolated worktrees. Authoring can be concurrent; preview application, merges and production promotion are serialized. Ordinary application-owned row changes are not orchestrator work. Outside-sourced writes into curated Master Data remain gated.

## 2. What we set out to do this session, and why

This session recovered work performed outside a properly opened orchestrator, rebuilt the production and issue queues, introduced safe three-lane author concurrency, added external reviewer rotation, and processed schema work through preview/merge/production gates. Albert later asked that every open issue be classified, all three author queues remain continuously busy, reviewer models rotate, and safe reviewed work promote automatically.

At closeout Albert changed the immediate instruction: empty every queue so the fresh orchestrator, not this long-context session, deliberately rebuilds them. The outgoing session therefore paused work instead of rushing migrations through.

## 3. Current state — what is true right now

### Authoritative moving facts

- GitHub `main` at 2026-08-16 03:45 UTC: `2421b1ba4dd1464e096e152528cf6ecf7100915e` (`Publish reusable historical item MG analysis (#1041)`). Recheck immediately; it will go stale.
- Highest known merged migration version: `20260814233423`. Recheck from current `main` before reserving or promoting anything.
- Open migration-author claims: **0/3**. Claims #1045 and #1046 were safely released and closed; their reserved versions remain permanently unavailable.
- Open shared-db work PRs from this session: none. PRs #1043, #1047 and #1048 were intentionally closed for transfer, not abandoned.
- Orchestrator marker: #960 remains open until this handoff PR is merged and is then closed as the final external action.
- Overall transfer issue: #1050. Restricted GitHub-access repair: #1051.

### Paused work that the fresh orchestrator must re-adopt

1. **#1042, production owner-risk evidence.** Closed PR #1043, branch `codex/issue-1042-owner-risk-evidence`, last exact head `8b4946999180b1f626852d9bc4d53571ee45c93f`, worktree `C:\repos\shared-db-worktrees\issue-1042-owner-risk-evidence`. All GitHub checks were green. Local evidence: 40/40 coordination tests and 11/11 risk/evidence tests passed. Grok found three issues on an earlier head; the last head fixed all three. A GLM exact-head review was started but no durable final approval was received before pause. Nothing from #1042 was applied to preview or production.
2. **#555, preserve curated master data.** Closed PR #1048, branch `codex/issue-555-import-policy`, last head `6f7c2bebd5c4b473c1d1017eeababd20f4e559de`, worktree `C:\repos\shared-db-worktrees\issue-555-import-policy`. Old claim #1045 and version `20260816014042` were released; that version is permanently reserved and must not be reused. The PR's ephemeral database test failed. The fresh session must diagnose that failure before re-claiming or rotating the migration.
3. **#764, repair two stale DesignFlow sequences.** Closed PR #1047, branch `codex/issue-764-sequence-repair`, head `e88a568c79754f7b2d5de5efc2c14b2bce488b35`, worktree `C:\repos\shared-db-worktrees\issue-764-sequence-repair`. All checks, including ephemeral database tests, were green. Qwen review was running but produced no durable verdict before pause. Claim #1046 and version `20260816014103` were released; that version is permanently reserved.
4. **#941, upstream-correction tracking.** No branch, migration, PR, preview or production work started. It was changed from eligible to blocked only for transfer.
5. **#853 + #868, PopDAM OrderList.** Both remain blocked. Division mapping is proven, but full ColdLion 19,302 versus legacy 17,703 reconciliation is not. The earlier automatic-ownership comment was superseded by a transfer-pause comment. No author claim exists. The work must first prove a unique and total mapping, extra/missing/EP001 handling, and preservation of every style bridge link without exposing item values. Then route application-owned data work to PopDAM and only structural changes through shared-db.
6. **Production Disney pair.** Albert approved exactly `20260813210000` + `20260813220000`. They were not applied because #1042 is not merged and no valid historical preview evidence artifact exists. Do not bypass the gate.
7. **Restricted GitHub access.** ai-devops PR #25 remains open at `975dd3704644cbd82cf724e8a81c9326633b7ec6`. Independent review found a High issue: the script grants read access to the whole GitHub CLI settings folder without first rejecting a token-bearing `hosts.yml`; it also lacks idempotent and early-return tests. Shared-db issue #1051 tracks the fix.

### Production and preview

- Migration `20260814220838` (#961 additive licensing status catalog) was applied to production and independently verified. Production ledger rose 449 to 450; the full 12 expected schema/status pairs were verified without printing row values.
- Last proven production drift after that apply: 14 unapplied migrations: retired `20260729120000`; held `20260802170000` and `20260802171000`; pending `20260813210000`, `20260813220000`, `20260814130000`, `20260814170749`, `20260814193351`, `20260814193402`, `20260814213043`, `20260814223552`, `20260814224937`, `20260814233342`, `20260814233423`. This is dated evidence, not current truth. Re-run the ledger.
- The approved Disney pair has not been applied to preview through the governed historical-proof path. #555 and #764 were never applied to preview. Preview is a shared mutable rehearsal environment and must be treated as not clean until a fresh exact ledger comparison proves its state.

### Queue state

Before the transfer pause the audit classified every open `db-work` issue. It closed stale/duplicate #507, #720 and #902. The latest reconciled totals before creating #1050/#1051 were 103 open `db-work`: 3 eligible, 17 structural-blocked, 27 owner-decision, 8 data-only and 48 non-structural, with zero unclassified/malformed. The three eligible issues (#555, #764, #941) are now blocked for transfer. Re-run the complete queue audit; do not copy these totals forward.

### Local checkout and worktrees

The shared checkout is intentionally dirty with pre-existing user/session files, including `.ai/*`, `HANDOFF.d/start-phase-7a-prompt.md`, `claim-931.md`, `docs/verification/item-mg-reclassification-20260814/`, and a modified `.gitignore`. Do not stage, delete or reset them.

Relevant live worktrees are named above. There are many old worktrees owned by issue #682 and earlier sessions. Do not remove any dirty, locked or live worktree. The attempted local handoff worktree `C:\repos\shared-db-worktrees\orchestrator-live-transfer-20260816-0230` is clean at old main and was not used for this remote handoff; inspect before cleanup. A second creation attempt under `.agents/worktrees/orchestrator-handoff-20260816` failed before a branch was created because the managed task could not write `.git`.

## 4. Everything we tried that did NOT work

1. Qwen 3.8 Max initially failed #963 before edits because Windows had no Docker/Podman sandbox and the launcher double-quoted `qwen.cmd`. It was canceled cleanly; later work used supported isolated/manual paths.
2. The first concurrency SOP shipped real flaws found by Grok: non-atomic claim races, expired leases dropping protection, legacy claims bypassing limits, missing PR-object checks, prose-only preview/merge serialization, broken skill-drift CI and fail-open collision checks. Corrective PRs #983, #985, #986 and #987 fixed the observed defects.
3. GitHub custom refs can return a transient 404 immediately after successful creation, stranding mutexes. PR #1044 merged at `44df6685c2b6c0cd4d3dd24dd38157c005921dee` and added bounded not-found retries with fail-closed ownership checks.
4. #975 was applied to preview under an older migration body than the file later merged. The ledger said applied while required tables were absent. Fix-forward #992 reconciled it; never repair/delete ledger rows to hide this class of drift.
5. Reviewer wrappers failed when asked to inspect linked worktrees whose Git metadata lived outside their allowed path. Clean standalone clones worked. Use persistent named sessions, but do not carry approval across a changed head.
6. The production risk gate correctly refused the Disney pair because it could classify risk but could not bind Albert's explicit approval, and the original PR lacked preview proof. #1042 is the fail-closed repair. Do not bypass it.
7. Restricted Codex tasks repeatedly could not read `C:\Users\ahazan2\AppData\Roaming\GitHub CLI`. `gh auth status` then claimed the token was invalid even though GitHub itself and the connected GitHub app were healthy. ai-devops PR #25's first fix is unsafe until #1051's token-bearing-file guard and tests are added.
8. During this closeout, the managed profile also denied `.git` writes, so local worktree/branch creation failed. The handoff branch, file, PR and issue mutations were completed through the authenticated GitHub app instead. Do not call this a repository or GitHub outage.
9. A guessed queue-audit script path did not exist on the older local checkout. The authoritative audit is on current `main`; fetch and read current tooling before invoking it.

## 5. Root causes and key findings

- Three concurrent authors are safe only when exact object claims, atomic version reservations and serialized preview/merge/production locks are enforced by tools, not prose.
- A review approval belongs to one exact commit. Rebases, conflict fixes or later commits require the durable rotation to assign/review the new head.
- Automatic production is allowed only when immutable evidence proves all five business risks absent. If material risk exists, Albert answers one plain business question; his answer must be pinned to the exact ordered migration set, target and workflow.
- shared-db governs structure, not ordinary application data. #853 will require both lanes: application-owned item refresh in PopDAM and structural bridge work here.
- The ColdLion-to-legacy item mapping cannot be guessed from the legacy mirror because all 17,703 legacy division values are null. The DesignFlow-to-ColdLion division translation is proven, but full unique/total reconciliation is not.
- GitHub CLI configuration access is a task-permission problem on this machine, not an authentication or network fact. The connected GitHub app remains a safe fallback for repository operations while #1051 is open.

## 6. Exact next steps

1. Start a fresh task with the prompt at the end of this handoff. Open `shared-db-orchestrator`, verify marker #960 is closed, and adopt handover #1050. **Worked when:** the new task reports current `main`, 0/3 claims, current open PRs and current ledger from live sources.
2. Fetch current main and run the author-lane, queue, PR-object, preview-ledger and production-ledger audits. Do not requeue from this document alone. **Worked when:** every open issue is classified and every remote-applied migration is explained by current main or a documented recovery path.
3. Repair #1051 / ai-devops PR #25 first or use the connected GitHub app. Add the token-bearing `hosts.yml` refusal and idempotent/early-return tests, obtain fresh review, merge and install from the durable primary checkout. **Worked when:** a restricted task can run authenticated `gh` reads and the synthetic plaintext-token test refuses access grants.
4. Re-adopt #1042 from closed PR #1043, update from current main, obtain a fresh exact-head reviewer verdict, merge, create immutable owner-decision evidence for Albert's already-approved exact Disney pair, run governed historical preview proof, then apply only those two migrations to production and verify. **Worked when:** ledger and live catalog show both exact versions, no extra version was applied, locks are released, and evidence digests are recorded.
5. Requeue #555 and #764 deliberately. Because old claims were released, follow current recovery rules for already-authored migration files and never reuse/reserve versions manually. Diagnose #555's failing ephemeral test. Obtain fresh exact-head reviews for both. **Worked when:** each has one valid claim, current-main migration version, green tests and no object collision.
6. Requeue #941 into the third non-overlapping lane only after the complete audit still finds it eligible. **Worked when:** 3/3 lanes are full or the audit proves fewer eligible items.
7. After #1042 and the Disney pair finish, take #868/#853 end-to-end: counts-only full reconciliation, application-owned data refresh where appropriate, structural bridge migration if needed, PopDAM `/orders` build, visual test, deploy and closure. **Worked when:** all 17,703 legacy identities are uniquely accounted for against the 19,302 feed, every prior style link is preserved or explicitly resolved, `/orders` works for an authenticated user, and both issues close with evidence.
8. Process the remaining production drift through the governed risk gate one exact package at a time. Never infer approval from technical review. **Worked when:** each production run has exact target, allowlist, immutable evidence, ledger/catalog proof and released lock.
9. Present the 27 `needs-albert` issues as one concise business-decision digest, remove stale decisions first, and clear labels immediately after answers. **Worked when:** Albert can answer without code knowledge and no decided question is re-asked.

## 7. Constraints and gotchas in force

- One orchestrator only. Never create a second marker while #960 is open; this outgoing session closes #960 last.
- Maximum three unrelated migration authors. Preview, merge and production remain one-at-a-time.
- Claims and migration versions come only from the manager; expiry never releases collision protection; released versions remain permanently unavailable.
- Never edit an applied migration. Fix forward.
- Never expose licensed rows, internal item identifiers, emails, phones, addresses or secret values in public issues, PRs, logs or external model prompts.
- Use the external reviewer rotation and debate findings to agreement. A review of an older head is not approval of a newer one.
- Prove the database target immediately before every data write. Production Cloud SQL remains read-only from shared-db.
- Do not clean the dirty shared checkout or legacy worktrees during intake. Issue #682 owns cleanup.
- `COORDINATOR_INTAKE.md` is retired and must remain a short pointer.

## 8. Access and environment

- Machine: `al8960ofc`, Windows 11, PowerShell 7.
- Canonical repo: `C:\repos\shared-db`; ai-devops: `C:\repos\ai-devops`.
- Git identity was previously verified as `Albert Hazan <u2giants@users.noreply.github.com>`.
- The managed closeout task could read/write the workspace but could not read the GitHub CLI config or write `.git`. GitHub mutations were performed through the authenticated connected GitHub app.
- Preview Supabase project: `rjyboqwcdzcocqgmsyel`. Production Supabase project: `qsllyeztdwjgirsysgai`.
- Secrets live only in 1Password vault `vibe_coding`. No secret value was read, written, logged or added during closeout.
- Secrets sweep result: nothing new to store. The GitHub token was never displayed or copied.
- Documentation pass: the handoff and #1050/#1051 are the durable records. No unrelated standing document was edited. ai-devops PR #25 owns the access-rule correction.

## 9. Open questions and risks

- All current owner questions are consolidated in section 0 and carry `needs-albert`. Some are probably stale; the incoming orchestrator must re-derive before asking.
- #1043's latest head fixed Grok's findings but lacks a durable exact-head approval. Treat it as unapproved.
- #1048 has a real failing database test. Do not preview or merge until diagnosed.
- #1047's code/tests were green, but Qwen produced no durable final verdict before pause.
- Preview and production ledger facts are dated. A fresh ledger is mandatory before any apply.
- The local shared checkout is 119 commits behind and contains unrelated changes. Never use it as current truth or reset it.
- The connected GitHub app worked while `gh` did not. #1051 must fix the restricted CLI path safely rather than granting broad access.

## Part B — dispatched agent blocks

### Agent: `issue_953_disney_opa_function` / production queue

- **Asked to do:** finish #953, process production drift, and apply safe packages.
- **Actually did:** merged #953 PR #1014; applied `20260814210518` to preview and production with verification; later applied #961 migration `20260814220838` to production and verified all 12 expected catalog pairs.
- **Found:** the Disney pair needed explicit owner-risk evidence and historical preview recovery, not a bypass.
- **PR / branch:** #1014 merged; #1043 later created by its child and now closed for transfer.
- **Worktree:** earlier #953 worktree is finished; #1042 worktree remains resumable.
- **Deliberately did NOT do:** did not apply the approved Disney pair because the governed proof path was incomplete.

### Agent: `production_owner_risk_override`

- **Asked to do:** implement #1042 and then apply exactly the approved Disney pair; afterwards own #868/#853.
- **Actually did:** authored closed PR #1043 at head `8b494699...`; 40/40 coordination and 11/11 risk/evidence tests passed; fixed three Grok findings; posted durable comments to #1042, #960, #868 and #853.
- **Found:** owner evidence must bind the unedited OWNER comment, exact current main, exact ordered pair, accepted risk classes, original PR/merge and exact workflow; historical preview proof must verify original PR authorship.
- **PR / branch:** closed #1043, branch `codex/issue-1042-owner-risk-evidence`.
- **Worktree:** live and resumable.
- **Deliberately did NOT do:** no preview or production write; #853/#868 ownership was superseded by the transfer pause.

### Agent: `issue_555_import_master_data`

- **Asked to do:** implement #555 while also repairing the transient GitHub coordination-ref race.
- **Actually did:** merged bootstrap PR #1044; opened now-closed #1048 with migration `20260816014042`; claim #1045 later released.
- **Found:** GitHub can create a custom ref yet return 404 on immediate read-back; bounded retry is necessary but must fail immediately on a different owner.
- **PR / branch:** #1044 merged; #1048 closed; branch preserved.
- **Worktree:** live and resumable.
- **Deliberately did NOT do:** no preview/production; #1048 remains blocked by a failing ephemeral database test and no final exact-head review.

### Agent: `issue_764_sequence_repair`

- **Asked to do:** repair two stale DesignFlow sequences.
- **Actually did:** authored migration `20260816014103`, opened now-closed PR #1047, and passed all CI including ephemeral database tests; claim #1046 later released.
- **Found:** exact case-sensitive sequence `dflow."LicensingTime_id_seq"` and `dflow.properties_and_characters_id_seq` need a lock-and-raise-never-lower repair.
- **PR / branch:** #1047 closed, branch preserved.
- **Worktree:** live and resumable.
- **Deliberately did NOT do:** no preview/production; no durable Qwen verdict.

### Agent: `issue_963_codex_implementation` / queue audit

- **Asked to do:** classify every open issue and fill three non-overlapping lanes.
- **Actually did:** classified the complete board, closed stale/duplicate #507, #720 and #902, and identified #555/#764/#941 as the only immediately eligible set before transfer.
- **Found:** most open issues were owner decisions, data-only, non-structural or dependency-blocked; placeholder claims would be unsafe.
- **PR / branch:** none for the audit.
- **Worktree:** finished.
- **Deliberately did NOT do:** did not claim on behalf of authors; claims must belong to implementing agents.

### Agent: `issue_995_warner_truthful_nulls` / GitHub access

- **Asked to do:** permanently repair restricted Codex GitHub access.
- **Actually did:** opened ai-devops PR #25 at `975dd370...` and documented the task-profile diagnosis.
- **Found:** GitHub config is outside workspace roots; independent review found unsafe whole-folder exposure if `hosts.yml` contains a plaintext token and missing idempotent/early-return tests.
- **PR / branch:** ai-devops PR #25 remains open; shared-db #1051 tracks completion.
- **Worktree:** preserve until PR is fixed or superseded.
- **Deliberately did NOT do:** repair was not merged because review found material safety gaps.

## Mandatory self-audit

1. **Can a new developer continue without asking a question? Yes.** Sections 1–3 define the system and exact live state; section 6 gives ordered actions with success gates; Part B separates every live agent.
2. **Can they continue as effectively as this session? Yes.** Sections 3–5 preserve exact PRs, branches, heads, versions, ledgers, failures and non-obvious root causes.
3. **Are failures included? Yes.** Section 4 records launcher, concurrency, ref-race, preview-drift, reviewer-path, production-gate, permission-profile and missing-script failures with why.
4. **Are next steps executable and verifiable? Yes.** Every numbered step in section 6 ends with a concrete proof condition.
5. **Are terms, paths and environments defined? Yes.** Sections 1, 3, 7 and 8 define repos, projects, worktrees, claims, locks and access boundaries.
6. **Did the section-0 sweep include every owner decision? Yes.** The only current-session decision was the Disney pair, listed as already settled. All 27 open owner-decision issues are listed with recommendations and labelled `needs-albert`; no owner judgement is hidden in sections 1–9 or Part B.

Final synthesis: this handoff is comprehensive enough for a brand-new developer, detailed enough to continue with the outgoing session's knowledge, includes background/goals/state/failures/decisions/constraints/risks/evidence, and exposes every owner decision in section 0.

## Exact fresh-session prompt

> You are the new orchestrator for `C:\repos\shared-db`. Open the `shared-db-orchestrator` skill and adopt GitHub handover issue #1050. Read `HANDOFF.d/2026-08-16T0315Z-al8960ofc-codex-live-orchestrator-transfer.md` completely, then rebuild all facts from current GitHub/main and live preview/production ledgers. The outgoing session intentionally emptied the migration queue and closed its work PRs while preserving branches/worktrees. Requeue only after a complete collision/dependency audit. Start with #1051 access repair and #1042 production-proof recovery, then deliberately re-adopt #555/#764/#941 and finally #868/#853. Do not re-ask Albert's approval for exactly `20260813210000` + `20260813220000`; implement the governed evidence path and apply only after every gate passes.

