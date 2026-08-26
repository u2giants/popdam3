---
issue: 1579
status: OPEN
owner: codex/orchestrator-1579
---

# Orchestrator #1579 fresh-session handoff

## 0. Decisions only the owner can make

### Blocking

1. **DesignFlow production cutover (#1353): do not ask yet.** Albert must eventually authorize the exact production data copy, secret rebinding, and Cloud Run switch, but only after timed rehearsal #771 supplies measured duration, live services/secrets are re-derived, rollback is concrete, and writers are proven stopped. Recommendation: finish those engineering prerequisites first, then present one exact cutover action for approval. This is owner-only security/infrastructure work and is not an orchestrator lane.

### Already settled — do not re-ask

- 2026-08-26: production change #1575 / migration `20260826035157` was authorized, applied, verified, and closed.
- 2026-08-26: #1589 OPA studio presentation split was authorized, applied, authenticated-live verified, and closed.
- 2026-08-26: #1592 evidence-backed DCP presentation structure and the private 325-row load were authorized, applied, authenticated-live verified, and closed.
- 2026-08-24: the isolated production schema remains `dflow_prod`, not `dflow_plm`.
- 2026-08-23: keep the latest 24 months of AuditLog live; archive older history indefinitely with searchable/exportable retrieval.
- 2026-08-23: Sunday is the preferred one-time cutover window, but it is scheduling guidance rather than current authorization.
- 2026-08-19: build ColdLion phases 2–6 before the historical backfill. #1204 was later proven already completed by #1184/#1456 and closed; do not duplicate it.

The next orchestrator must put the whole current owner-decision list to Albert in one message only if a decision is actually actionable. Do not re-ask the settled list above.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared Supabase database structure used by DB Data Admin, PopDAM, PopCRM, PIM, and DesignFlow. The sole orchestrator does triage, isolated author dispatch, independent exact-head review, guarded merge, preview rehearsal, production promotion, and live reconciliation. It does not author structural work in its own context and does not own ordinary application row writes.

The active orchestrator marker is GitHub issue #1579. The working coordinator checkout is `C:\repos\shared-db-worktrees\orchestrator-1579`. This handoff deliberately keeps marker #1579 open because the next fresh session is a continuation, not a completed shutdown.

## 2. What we set out to do this session, and why

Albert asked the successor to issue #1576 to reconcile all owner decisions once and fill all five author lanes from a fully audited queue. The session did that, then handled three owner-authorized production changes while preserving the queued author work:

1. #1575: repair the replay contract for the already-live `core.mg_category` comment.
2. #1589: split the production OPA presentation into Disney, Marvel, Lucasfilm / Star Wars, Pixar, ambiguous, and unresolved groups.
3. #1592: add a private DCP licensor resolution structure and make Scraped Properties fail closed rather than infer licensor from table family.

The remaining objective is to finish the four still-open author PRs through review, serialized merge, preview, and production; keep the fifth lane available for the next fully audited dispatchable structural issue; and continue auditing the queue without taking repo-maintenance work into the orchestrator.

## 3. Current state — true at 2026-08-26T14:08Z unless noted

### Coordinator and queue

- Marker #1579 is OPEN. It is the single-orchestrator lock.
- `origin/main` was `deac67d7f405674dc6995ed1b64b0c3463859835`.
- The highest migration filename version on current `origin/main` is `20260826130049`. Always re-derive it before allocating a new version.
- `node scripts/manage-migration-author-lanes.mjs --queue-audit` returned `fullyAudited: true`, with no malformed, unclassified, unlabelled issues or dependency cycles. Four lanes are occupied and lane 5 is empty; `dispatchable` is empty. Do not invent a fifth task just to fill the lane.
- No preview, merge, or production lock is held. The #1592 production freeze was explicitly released on marker #1579.
- Preview contains every migration rehearsed by completed runs described below, including `20260826123102` and `20260826130049`. It is a shared mutable rehearsal database, not clean or disposable.

### Completed production work

- #1575 closed: migration `20260826035157_harden_mg_category_replay_contract.sql`; production run `32967965575`; direct production ledger/comment verification passed.
- #1589 closed: PR #1593, reviewed head `0da50131974a2dc3d339f25a770777d6d50545c1`, merge `f80586c8d916e74b7156fe68ec8be8dc613b1ab4`, migration `20260826123102`, preview `32971782240`, dry-run `32972187387`, production `32972316394`. Authenticated production counts: OPA Disney 244, Marvel 205, Lucasfilm / Star Wars 2, Pixar 64, ambiguous 20, unresolved 910; unsplit absent.
- #1592 closed: PR #1595, reviewed head `db86f6f994cd64c287c2ecbb13fd41a14ef71e6f`, merge `deac67d7f405674dc6995ed1b64b0c3463859835`, migration `20260826130049`, preview `32976383674`, dry-run `32976578619`, production `32976750348`. Private loader commit `b31d871` inserted exactly 325 rows, 0 missing/orphan. Authenticated DCP groups: Disney 130, Marvel 6, Star Wars 9, authority conflict 1, unresolved 179. Page total 2,809/2,809; no fallback/loading/error state.

### Four live author claims and PRs

1. **#1467 / claim #1580 / PR #1585** — version `20260826120036`, branch `codex/issue-1467-drop-normalization-index-1579`, worktree `C:\repos\shared-db-worktrees\issue-1467-1579`, head `6917724d2c6be6e3fbedc98b0b84264e16a190d4`. All author checks were green. It drops `public.asset_tags_pending_metadata_normalization_idx`. It has not received the current orchestrator's external exact-head review, merge, preview, or production promotion.
2. **#1259 / claim #1581 / PR #1586** — version `20260826120056`, branch `codex/issue-1259-fr-hardening-1579`, worktree `C:\repos\shared-db-worktrees\issue-1259-1579`, head `1c7612011adec7cb7ec73affbff449615c1df359`. PR is mergeable but blocked by ephemeral run `32967160937`. Relevant failures include `licensing_write_authority_guard_contracts.sql` and `coldlion_active_status_contracts.sql`: the changed guard raises `coldlion_status authorization may change only Property status to active or inactive`. The author must reconcile the intended FR hardening with existing ColdLion status contracts, rerun exact-head CI, and not weaken unrelated contracts.
3. **#1453 / claim #1583 / PR #1588** — version `20260826120132`, branch `codex/issue-1453-attachment-index-1579`, worktree `C:\repos\shared-db-worktrees\issue-1453-1579`, head `4fda42aac36c890b278244082b23e34da2005da3`. Ephemeral DB and other checks pass, but lease run `32968301917` fails because the PR writes undeclared `index dflow.itemattachment_item_num_id_fk_idx` and quoted table `dflow."itemattachment"`. Expand the active claim from the issue using the guarded tool after correcting the issue scope to the exact quoted table/index identities; then rerun exact-head CI.
4. **#1452 / claim #1584 / PR #1587** — version `20260826120144`, branch `codex/issue-1452-notification-index-1579`, worktree `C:\repos\shared-db-worktrees\issue-1452-1579`, head `b9614b918e8ecfed93d6b93a2d3ba694995a9538`. All author checks were green. It indexes unread notification queries. It has not received the current orchestrator's external exact-head review, merge, preview, or production promotion.

Claim #1582 / version `20260826120113` was released and closed after live/main audit proved #1204's requested history tables already landed through #1184, PR #1456, migration `20260825023430`, preview `32802353986`, and production `32802595923`. Version `20260826120113` remains permanently reserved and must never be reused.

### Repository state

- The shared root `C:\repos\shared-db` was already dirty/stale and remains untouched.
- The coordinator worktree contains untracked `.ai/` review briefs, downloaded run artifacts, and verification helpers from this session. They contain no secret values and are not product work. Leave them until the successor decides whether to retain locally; do not broad-clean.
- Author worktrees above were clean when checked at handoff. Finished #1589 and #1592 worktrees remain on disk and are safe candidates for later cleanup only through `cleanup-worktree`, after respecting the open marker rule.
- Many older worktrees exist. They were not created or adjudicated by this session. Do not infer abandonment from age or use forced removal.

## 4. Everything tried that did not work

1. The installed `ai-grok-review` shim pointed at retired `C:/repos/ai-devops-worktrees/phase-d-main/bin/ai-grok-review`. Calling it failed. The maintained wrapper at `C:/repos/ai-devops/bin/ai-grok-review` worked with Git Bash and preserved all protected-review controls.
2. The first Grok review call looked for the prompt in the #1592 author worktree while the prompt had been created only in the coordinator worktree. It failed before a paid session was retained. Copying the brief into the author worktree and starting the same named review succeeded.
3. #1592 initially granted service_role UPDATE/DELETE. Existing `dcp_vault_landing_contracts.sql` correctly rejected that. A later correction still had incomplete privilege assertions. The final exact head explicitly revokes UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN while preserving SELECT/INSERT.
4. #1592's first scope text used a comma-bearing function signature that the claim CLI parsed badly, plus `return_to: n/a`. The issue scope was corrected to machine-readable exact objects and the claim was expanded through the guarded command.
5. `node scripts/manage-migration-author-lanes.mjs --coordination-audit` and `--status` are not valid arguments. Use `--queue-audit` and the documented specific claim/lock commands.
6. #1588's author assumed claiming the table covered the created index; the lease guard treats the index as a separate written object and failed closed.
7. #1204 looked ready from stale issue prose, but implementation audit proved the requested outcome already existed. No duplicate migration was authored; claim #1582 was released.

## 5. Root causes and key findings

- The queue is correct only after live audit. Issue prose and handoffs can be stale within an hour; #1204 was the concrete example.
- A table claim does not imply ownership of indexes on that table. Claims must enumerate every created/dropped index and exact quoted identifiers.
- DCP presentation now derives only from accepted evidence in `plm.dcp_property_licensor_resolution`; missing/conflicting mappings fail closed into explicit review groups. Service-role loading is intentionally INSERT-only/first-write-wins.
- The four original PRs remained open while urgent #1589/#1592 were serialized through production. Their old green checks are author evidence, not current-main independent-review proof.
- Grok sequence 389 approved #1592 at exact head. Its review artifact is in the finished #1592 worktree under `.ai/reviews/` and the full report is posted on PR #1595.
- `main` advanced twice after the original four PRs opened. Exact-head reviews and guarded merges must re-prove ancestry/current main rather than trusting old merge state.

## 6. Exact next steps

1. Re-open marker #1579 and read this file plus `AGENTS.md` and the complete `shared-db-orchestrator` operating manual. Re-run `git fetch`, queue audit, open PR/claim/lock inventory, current main, and migration ledger drift before action. **Gate:** exactly one marker (#1579), fully audited queue, and no unexplained exclusive lock.
2. Send PR #1586 back to its author lane with the exact ephemeral failures above. Require a focused correction that preserves ColdLion status behavior and the FR authority goal. **Gate:** every required check, including ephemeral DB, passes on a new exact head.
3. Correct #1453's machine-readable scope and use `--expand-active-claim-from-issue` for claim #1583 to include `index dflow.itemattachment_item_num_id_fk_idx` and exact table spelling. **Gate:** Migration Author Lease passes on PR #1588 exact head without bypassing the guard.
4. Recheck PRs #1585 and #1587 against current main. If their exact heads and full checks remain valid, allocate independent reviewers one at a time with `--assign-reviewer`; use only the returned reviewer/wrapper and post the full review artifacts. **Gate:** APPROVE on each exact head with full coverage and no material objection.
5. Process each approved PR through the guarded merge workflow one at a time. Release its claim only after GitHub proves it merged. **Gate:** PR merged, merge commit recorded, reviewed head is contained in the merge, claim closed with exact owner proof.
6. After each merge, run the bounded post-merge preview rehearsal for only that migration at exact current main. Do not batch unrelated migrations unless the governance rules explicitly allow it. **Gate:** successful preview run plus pinned artifact digest and verified ledger delta.
7. For each production candidate, run exact-main immutable review evidence and production dry-run, announce a merge freeze, then dispatch the authorized apply with exact allowlist, confirmation, source PR, preview run/digest, and review run/digest. **Gate:** production workflow succeeds through catalog verification; direct read-only live reconciliation matches the migration; freeze is explicitly released.
8. Close the source issue only after its application/live outcome is proven, not merely after schema deployment. **Gate:** issue comment names PR, migration, preview, dry-run, production run, and live proof.
9. Re-run the fully audited queue after every claim release. Lane 5 is currently empty because there is no dispatchable structural issue; keep it empty until a valid non-overlapping ready issue appears. **Gate:** no malformed/unclassified/unlabelled issue and any new claim is conflict-free.
10. At the end of the next phase, re-read every downstream step 5–9 through plan-end and report any assumption invalidated by new merges, failures, queue changes, or production evidence. Carry all remaining obligations into the next handoff before cutting context again. **Gate:** the successor can identify every remaining phase and no new fact exists only in chat.

## 7. Constraints and gotchas in force

- One orchestrator only; marker #1579 stays open during the immediate fresh-session continuation.
- The orchestrator coordinates only. Structural authoring happens in isolated agent worktrees. Repo maintenance/documentation is listed for visibility but belongs to separately started repo sessions.
- Never fill a lane with non-dispatchable work merely to reach five occupied lanes.
- Independent review is separate from tests. Exact-head APPROVE is required before guarded merge.
- Preview, reviewer allocation locks, merge, and production are serialized. Freeze merges before each production apply and explicitly release afterward.
- Migration versions are permanent even when a claim is released. Never reuse `20260826120113` or any other reserved version.
- Preview is shared and mutable; prove its current ledger before rehearsal. Production is read-only except through the owner-authorized governed workflow.
- Never copy private licensed rows, property names, contract text, or source evidence into this public repo, issue, review prompt, or log.
- Do not broad-stage, broad-clean, force-remove worktrees, or overwrite the dirty shared root.
- Migrations `20260814223552` and `20260825094455` remain hard-blocked. Do not apply them through drift repair.

## 8. Access and environment

- GitHub CLI is authenticated as `u2giants` for `u2giants/shared-db`.
- Coordinator: `C:\repos\shared-db-worktrees\orchestrator-1579` on EDGE-DEV.
- Production Supabase project ref comes from protected private config key `supabase_shared_prod_ref`; Supabase Management API token is in 1Password vault `vibe_coding`, item id `3t2xoqk5luyz7ffgdhj24gvtpq`. Never print either value.
- Authenticated UI verification used Albert's existing signed-in Chrome session at `https://data.designflow.app`; no personal identifier is required in this public handoff.
- Canonical Grok wrapper is currently `C:\repos\ai-devops\bin\ai-grok-review`; use Git Bash and `AI_GROK_CALLER=codex`.
- Secrets sweep: checked session diffs, untracked helpers, prompts, and outputs; no new credential or secret value was introduced or needs storing.
- Documentation pass: no standing document outside this handoff became false. The durable behavior is already encoded in migrations/tests and issue evidence; no extra AGENTS.md edit is warranted.

## 9. Open questions and risks

- #1353's exact production cutover authorization is still future and owner-gated; prerequisites are not complete. This is the only current owner decision found by the live queue audit.
- PR #1586 may expose a real compatibility defect between its FR authorization hardening and existing ColdLion status semantics. Do not dismiss the test as baseline noise without isolating the exact changed behavior.
- PR #1588's quoted/case-sensitive `dflow."itemattachment"` identity must be reconciled exactly. PostgreSQL identifier folding makes approximate scope text unsafe.
- PRs #1585/#1587 were green before later main merges. Their semantic compatibility and exact-head review are still outstanding.
- Counts, SHAs, PR states, queue occupancy, and preview ledger are moving facts. Everything above is stamped at 2026-08-26T14:08Z and must be refreshed before action.

# Part B — sub-agent records

### Agent: #1467 author / `C:\repos\shared-db-worktrees\issue-1467-1579`
- **Asked to do:** remove the temporary asset-tag normalization index after completion proof.
- **Actually did:** authored version `20260826120036`, pushed head `6917724d2c6be6e3fbedc98b0b84264e16a190d4`, opened PR #1585; author CI green.
- **Found:** the index-retirement change is structurally bounded.
- **PR / branch:** #1585 / `codex/issue-1467-drop-normalization-index-1579`.
- **Worktree:** live and resumable; clean at handoff.
- **Deliberately did NOT do, and why:** no external review, merge, preview, or production; those belong to the orchestrator gates.

### Agent: #1259 author / `C:\repos\shared-db-worktrees\issue-1259-1579`
- **Asked to do:** harden FR authorization metadata and recovery behavior.
- **Actually did:** authored version `20260826120056`, pushed head `1c7612011adec7cb7ec73affbff449615c1df359`, opened PR #1586.
- **Found:** ephemeral contracts expose a conflict with ColdLion status authorization behavior.
- **PR / branch:** #1586 / `codex/issue-1259-fr-hardening-1579`.
- **Worktree:** live and resumable; clean at handoff.
- **Deliberately did NOT do, and why:** did not weaken failing contracts or promote a red head.

### Agent: #1204 audit / `C:\repos\shared-db-worktrees\issue-1204-1579`
- **Asked to do:** build three ColdLion history tables under claim #1582.
- **Actually did:** audited main/production, proved all requested structures already existed from #1184/#1456, authored no migration, released claim #1582, and closed #1204.
- **Found:** the issue was stale completed work; duplicate DDL would have been wrong.
- **PR / branch:** no PR / `codex/issue-1204-coldlion-history-1579`.
- **Worktree:** finished; clean and safe for later governed cleanup.
- **Deliberately did NOT do, and why:** no duplicate migration; version `20260826120113` remains reserved.

### Agent: #1453 author / `C:\repos\shared-db-worktrees\issue-1453-1579`
- **Asked to do:** add the Item Library attachment lookup index.
- **Actually did:** authored version `20260826120132`, pushed head `4fda42aac36c890b278244082b23e34da2005da3`, opened PR #1588; ephemeral DB passes.
- **Found:** lease scope omitted the created index and exact quoted table identity.
- **PR / branch:** #1588 / `codex/issue-1453-attachment-index-1579`.
- **Worktree:** live and resumable; clean at handoff.
- **Deliberately did NOT do, and why:** no merge/promotion while the lease guard is red.

### Agent: #1452 author / `C:\repos\shared-db-worktrees\issue-1452-1579`
- **Asked to do:** add bounded unread-notification indexes.
- **Actually did:** authored version `20260826120144`, pushed head `b9614b918e8ecfed93d6b93a2d3ba694995a9538`, opened PR #1587; author CI green.
- **Found:** the change is ready for current-main recheck and independent review.
- **PR / branch:** #1587 / `codex/issue-1452-notification-index-1579`.
- **Worktree:** live and resumable; clean at handoff.
- **Deliberately did NOT do, and why:** no external review, merge, preview, or production; those are coordinator gates.

### Agent: #1589 author / `C:\repos\shared-db-worktrees\issue-1589-1579`
- **Asked to do:** split OPA presentation groups in Scraped Properties.
- **Actually did:** PR #1593 / migration `20260826123102`; merged, previewed, promoted, and authenticated-live verified as recorded in §3.
- **Found:** OPA source rows were already populated; only presentation grouping needed repair.
- **PR / branch:** merged #1593 / `codex/issue-1589-opa-studio-groups-1579`.
- **Worktree:** finished; safe for later governed cleanup.
- **Deliberately did NOT do, and why:** did not alter private source rows or merge DCP groups into OPA.

### Agent: Hume, #1592 author / `C:\repos\shared-db-worktrees\issue-1592-1579`
- **Asked to do:** add the private DCP resolution table/policy and fail-closed Scraped Properties presentation.
- **Actually did:** PR #1595 / migration `20260826130049`; final head `db86f6f994cd64c287c2ecbb13fd41a14ef71e6f`; merged, previewed, promoted, catalog-verified, then handed back for the private 325-row load and authenticated UI proof.
- **Found:** service_role must be SELECT/INSERT-only; existing DCP contracts correctly rejected UPDATE/DELETE.
- **PR / branch:** merged #1595 / `codex/issue-1592-dcp-licensor-resolution-1579`.
- **Worktree:** finished; safe for later governed cleanup.
- **Deliberately did NOT do, and why:** no licensed names, rows, or contract text were copied into shared-db; private load stayed in `u2giants/licensor-source-data`.

## Fresh-session self-audit

1. **Could a newcomer continue without asking a question? Yes.** §§1–3 define the system and exact live state; §6 gives ordered commands/outcomes; Part B separates every dispatched agent.
2. **Could they continue as effectively as this session? Yes.** §§4–5 preserve failed approaches and non-obvious findings; §§7–8 preserve governance, access, and secret boundaries.
3. **Is every execution-critical detail present? Yes.** §§2–9 cover purpose, current SHAs/versions/runs, failures, constraints, risks, next gates, and verification evidence.
4. **Would Albert see every decision by reading only §0? Yes.** The only live owner-only item found in §§1–9/Part B is #1353's future exact cutover authorization, and it is indexed in §0 with prerequisites and a recommendation. Every other owner ruling mentioned later is in the settled list.

Whole-plan check passed: the remaining author repair/review, guarded merges, preview rehearsals, production promotions, issue closeouts, lane refill, and later handoff obligations are all covered through plan-end. Step 10 contains the required reciprocal instruction to re-read downstream phases and report drift at the end of the next phase.
