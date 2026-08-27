---
issue: 1628
status: OPEN
owner: codex/orchestrator-1602-closeout
---

# Shared-db orchestrator #1602 closeout and continuation

## 0. Decisions only the owner can make

### Blocking security decision

- **Authorize rotation of the two MCP bearer tokens identified in issue #1629.** A closeout diagnostic printed their values into this private Codex task's tool output. Policy therefore treats them as compromised. Recommendation: authorize the ai-devops/security owner to rotate both exact tokens, update their authoritative `vibe_coding` 1Password items and dependent clients, prove the new tokens work, and prove the old tokens fail. This blocks closure of #1629, but does not block the structural queue.

### Already settled — do not re-ask

- #1599's Disney/Lucas OPA direct-scope and DCP exact-identity/supersession design was authorized and shipped on 2026-08-26.
- Marvel submissions remain under Disney OPA by business rule.
- Flow 4 does not include a release operation; removing the never-reachable `released` reservation state is not removal of an existing capability. This was independently confirmed by the exact-head GLM review of `e4205ac`.
- #1607 needs genuine overlapping concurrency proof, not sequential or textual proxies. That proof now exists at head `818b2381e9209f96c03443581772ea5aabeffcd6`.
- Do not bypass a failed required reviewer. Repair or use the governed failed-reviewer mechanism only when its contract permits it.

The successor must put the single open decision above to Albert once, not re-ask the settled decisions.

## 1. What this application is

`u2giants/shared-db` is the single source of truth for the shared Supabase database structure used by POP's PM/PIM, CRM, DAM, DB Data Admin, and DesignFlow PLM applications. One orchestrator owns structural queue coordination at a time. Authors work in isolated worktrees with exact object claims; preview, merge, and production promotion are serialized and guarded.

Production Supabase project ref: `qsllyeztdwjgirsysgai`, URL `https://qsllyeztdwjgirsysgai.supabase.co`. Preview project ref: `mvpkijzfmfcxhnzqogzs`. These identifiers are not write authorization; re-prove the exact target immediately before every write.

## 2. What we set out to do this session, and why

The session resumed predecessor marker #1579 under marker #1602, with four occupied author lanes and explicit priority for #1597. It was asked to continue those lanes through repair/review and serialized promotion, admit authorized #1599 after the first lane released, prioritize urgent #1610 ahead of #1607, then finish #1607 through production. GitHub Actions suffered a partial outage during the early sequence, so coordination remained fail-closed until fresh successful recovery evidence existed.

## 3. Current state — what is true right now

### Moving facts checked at 2026-08-27T00:30:00Z

- `origin/main`: `dfcb6b47ef49a968b47c62b38a6ba717a9aa37e6`.
- Maximum migration version on `origin/main`: `20260826200252` (`supabase/migrations/20260826200252_scraped_properties_evidence_contract.sql`).
- No author-acquisition mutex or preview/merge/production exclusive ref was present in `git ls-remote`.
- Marker #1602 is still open while this file is written. It must be closed only after this docs-only PR merges and the final queue/gate audit passes.
- The queue audit is fully audited: four active structural claims, one empty lane, dispatchable non-overlapping #1615, no malformed/unclassified/unlabelled issues.

### Finished and production-verified this session

1. **#1597 / PR #1604 / migration `20260826144047`.** Merged as `7da455b1ce7444f864f899d75007510c0ee21dd2`. Preview run `33001614126`; production dry run `33002978967`; immutable review `33003098770`; production apply `33003161743` SUCCESS. Direct production proof completed. Issue and claim closed.
2. **#1610 / PR #1618 / migration `20260826185548`.** Final reviewed head `658f1a53f6b721ec047af27339fd28af982b3790`; Muse, GLM 5.3, and Grok all approved. Preview `33006744708`; guarded merge `33006898071`, merge `7270316...`; production dry run `33007642125`; review `33007756578`; production apply `33007810225` SUCCESS. Direct production proof completed. Issue and claim closed.
3. **#1599 / PR #1614 / migration `20260826200252`.** Final reviewed head `3ceea44acecc2747c77ca69cb76b1cc333a67173`; preview `33015214423`; guarded merge `33019723926`, merge `97d3915c04b1bda38ece3c4ae16cde28106e7a56`; production dry run `33020021143`; review `33020102511`; production apply `33020128301` SUCCESS. Direct production proof confirmed `plm.opa_property_scope_membership`, `plm.dcp_property_licensor_resolution`, `api.db_data_admin_scraped_properties`, correct live `plm.dcp_property`, absent erroneous `plm.disney_dcp_property`, exact version/supersession constraints, grants, and API evidence logic. Issue and claim closed.

### Active lane 1 — #1607 / claim #1621 / PR #1623

- Purpose: DesignFlow Sample Tracking Flow 4 remote requests and reservations.
- Branch: `codex/issue-1607-flow4-remote-request-1602`.
- Worktree: `C:/repos/shared-db-worktrees/issue-1607-1602`.
- Migration: `20260826200419_sample_tracking_flow4_remote_requests.sql`.
- Exact head: `818b2381e9209f96c03443581772ea5aabeffcd6`; GitHub reports MERGEABLE and every required exact-head check green.
- Exact contract run `33025937692` SUCCESS. The required runner-side concurrency step used two ordinary authenticated `psql` clients: the event replay blocked 1,244 ms and returned committed history ID 11; reservation replay blocked 1,244 ms and returned the exact committed reservation ID. Required migrations run `33025937694`; collision `33025937719`; lease `33025937680`; remaining guards all green.
- Migration code locks before idempotency lookup in `post_sample_remote_request_event` and `reserve_sample_remote_request_item`; `released` state is removed; fresh/packed line replay compares full identity; `dflow.sample_movement` remains untouched.
- **Not previewed, not merged, not production-applied.** Claim #1621 remains open.
- Blocker: required fresh immutable GLM 5.3 exact-head review could not complete because the local GLM permission endpoint repeatedly disappeared. Incident `20260827T002811Z-edge-dev-GLM-4171081`; GitHub issue #1627.
- A manager-assigned independent review was attempted but did not yield a proved assignment/verdict before closeout. Re-run the exact manager command after confirming no durable assignment ref already exists.

### Active lane 2 — #1452 / claim #1584 / PR #1587

- Branch `codex/issue-1452-notification-index-1579`; worktree `C:/repos/shared-db-worktrees/issue-1452-1579`; migration version `20260826145345`; head `9f6ac1f7336f07d9c27269a118140d5d18b7c37c`.
- Objects: `dflow.user_notification`, `dflow.user_notification_unread_user_created_idx`.
- PR is open, MERGEABLE, and its recorded exact-head required checks are green. It has not been previewed, merged, or promoted by marker #1602.

### Active lane 3 — #1259 / claim #1581 / PR #1586

- Branch `codex/issue-1259-fr-hardening-1579`; worktree `C:/repos/shared-db-worktrees/issue-1259-1579`; migration version `20260826144708`; head `ae40661b91e9fc13f6c74d2f000c2bccb7cdbc68`.
- Objects: `plm.licensing_write_authorization`, `app.enforce_licensing_write_authority`.
- PR is open, MERGEABLE, and its recorded exact-head required checks are green. It has not been previewed, merged, or promoted by marker #1602.

### Active lane 4 — #1467 / claim #1580 / PR #1585

- Branch `codex/issue-1467-drop-normalization-index-1579`; worktree `C:/repos/shared-db-worktrees/issue-1467-1579`; migration version `20260826145150`; head `ae36d2ce4100efeaa95da710ea04af510a7cb4d6`.
- Object: `public.asset_tags_pending_metadata_normalization_idx`.
- PR is open, MERGEABLE, and its recorded exact-head required checks are green. It has not been previewed, merged, or promoted by marker #1602.

### Empty lane 5 / dispatchable #1615

- #1615 is fully audited, structural, non-overlapping, and dispatchable. It adds an explicit clear-domain contract to `api.crm_update_customer` while reading `core.customer`.
- It was deliberately not claimed during the #1607 review repair. Re-audit immediately before claiming.

### Preview state

- This session applied #1597 (`20260826144047`), #1610 (`20260826185548`), and #1599 (`20260826200252`) to protected shared preview through runs `33001614126`, `33006744708`, and `33015214423` respectively. Those migrations were later merged and production-applied.
- #1607, #1452, #1259, and #1467 were not applied to preview by this session.
- Preview is shared and mutable. This is the last verified contribution from marker #1602, not a claim that no other session changed preview. Re-derive its live ledger before the next preview action.

### Worktree state owned by this session

- `issue-1607-1602`: clean tracked tree at `818b238...`, with six untracked `.ai/review-1607-*.md` prompt artifacts. Preserve until #1607 completes; do not commit them.
- `issue-1597-1602`: merged/finished branch, but one untracked `.ai/review-1597-seq391.md` remains. Safe cleanup requires the cleanup-worktree procedure after marker closure.
- `issue-1599-1602`: merged/finished branch, with four untracked `.ai/review-1599-*.md` prompt artifacts. Safe cleanup requires the cleanup-worktree procedure after marker closure.
- `issue-1610-1602`: clean and finished. Safe cleanup requires the cleanup-worktree procedure after marker closure.
- `issue-1259-1579`, `issue-1452-1579`, `issue-1467-1579`: clean live worktrees; preserve.
- `orchestrator-1602-closeout`: owns only this handoff file and its docs-only PR until merged.
- Numerous other historical worktrees exist and were deliberately not touched because this closeout cannot prove their ownership/finished status. Do not bulk-clean them.

## 4. Everything we tried that did not work

1. GitHub Actions entered a partial outage. Recovery run `32984017709` remained queued with zero jobs. The orchestrator correctly did not cancel, mutate, or duplicate it merely to work around the outage. Fresh recovery run `32996624036` later succeeded and restored governed progress.
2. The first #1599 branch topology used merge commits, making the reviewer packet's first-parent diff incomplete. Muse exposed the wrong review boundary. That approval was rejected; the author rewrote the branch linearly and the final exact six-file head was reviewed anew.
3. #1607 GLM initially found two Medium issues: idempotency lookup before row lock, and an advertised but unreachable `released` state. Lock ordering was fixed. The original Flow 4 specification had no release capability, so the unreachable state was removed rather than inventing a function outside scope.
4. The first #1607 test repair asserted function-definition ordering plus sequential replay. GLM correctly ruled that it did not behaviorally prove the overlap window.
5. A server-side `dblink` harness with `dbname=current_database()` failed because PostgreSQL requires non-superusers to prove supplied credentials. Adding the standard postgres password still failed: the in-container `127.0.0.1:5432` pg_hba path was `trust`, so libpq did not actually use the supplied password.
6. Creating a purpose-built passworded test role did not fix the same pg_hba invariant. That entire dblink/test-role approach was removed.
7. The successful replacement is a runner-side shell harness using two ordinary authenticated `psql` TCP clients through the Supabase CLI host-mapped endpoint. It is a required workflow step and fails closed.
8. Several GLM sessions were stale because the PR head moved. They were not counted. Fresh full-base packets were explicitly bound with `--base`.
9. Final GLM attempts built the correct immutable packet for `97d3915... -> 818b238...` but repeatedly failed when the local permission endpoint returned status `000`. Health/start/restart/doctor attempts only restored service transiently. This is recorded in incident `20260827T002811Z-edge-dev-GLM-4171081` and issue #1627; do not pretend a verdict exists.
10. The closeout secrets sweep used an overly broad process listing that printed two MCP bearer tokens into private task output. Values are omitted everywhere durable. Issue #1629 now requests owner-authorized rotation.

## 5. Root causes and key findings

- Idempotent retry correctness depends on lock acquisition before the replay lookup under READ COMMITTED; uniqueness alone prevents duplication but can still return a false business rejection.
- A single-session SQL test cannot prove visibility after an overlapping transaction commits. #1607 now owns a genuine two-client harness wired into required CI.
- `dblink` credential enforcement depends on the server's pg_hba path; supplying a password string is not evidence it was used.
- Flow 4's original contract does not include reservation release. An unreachable enum/check state is misleading schema, not latent capability.
- Reviewer evidence is exact-head evidence. A verdict on a previous SHA or wrong base is not transferable.
- Direct OPA branch membership is authoritative scope evidence for Disney/Lucas; table family and property-name keywords are not.
- DCP exact identity and version supersession must be structurally constrained against the real `plm.dcp_property` table.

## 6. Exact next steps

1. Closeout successor handshake: after marker #1602 closes, open a new marker with a new route ID and run `node scripts/check-orchestrator-marker.mjs --resolve`. Gate: exactly one marker resolves to the successor's own route ID.
2. Re-derive `origin/main`, all open claims/PR heads/checks, author mutex, exclusive refs, queue audit, preview ledger, and production ledger. Gate: fully audited queue and no conflicting lock.
3. Repair GLM through issue #1627 or use only the manager's documented failed-reviewer path if its exact criteria are satisfied. Resolve the immutable incident only after complete live proof. Gate: a brand-new GLM 5.3 session produces an exact-head verdict for the then-current #1623 head, or a governed replacement record explicitly authorizes the alternative.
4. Re-run `node scripts/manage-migration-author-lanes.mjs --assign-reviewer --issue 1607 --pr 1623 --head-sha <current-head>` and follow the returned wrapper. First inspect whether an assignment ref was created by the interrupted attempts. Gate: independent verdict is bound to the exact current head and has no C/H/M findings.
5. If either review finds C/H/M, route fixes to the existing #1607 worktree and restart exact-head CI and both reviews. Gate: all findings resolved on one immutable head.
6. Acquire the preview lock and apply only migration `20260826200419` for PR #1623 with exact claim/head binding. Gate: preview run SUCCESS and direct preview catalog/function tests pass, including a one-time real overlap drill if required by review.
7. Acquire merge lock; guarded-merge PR #1623. Record immutable completion evidence but release claim #1621 only after merge proof. Gate: PR merged and migration exists on current `origin/main`.
8. Run current-main preview rehearsal/recovery, production dry run, immutable production review, and production apply. Gate: each exact run succeeds in order; never treat queued/cancelled as passing.
9. Directly verify production target `qsllyeztdwjgirsysgai`: four tables, three functions, constraints/grants, no unintended movement writes, and idempotent behavior. Gate: catalog/API proof matches migration contract. Close #1607 and release its lane.
10. Re-audit and claim #1615 if still dispatchable/non-overlapping. Preserve the five-lane cap.
11. Continue #1452, #1259, and #1467 through fresh-head review, preview, guarded merge, and production one at a time. Their recorded greens predate current main; refresh/rebase and re-review as governance requires.
12. After marker closure, use `cleanup-worktree` to retire only finished #1597/#1599/#1610 and the merged closeout worktree. Gate: GitHub PR state proves merged and every target is clean/unlocked or its untracked artifacts are deliberately preserved.
13. Obtain Albert's authorization on #1629, then route token rotation to the security/ai-devops owner. Gate: new credentials work and old credentials fail without exposing either value.

## 7. Constraints and gotchas in force

- One open `orchestrator-marker` is the only authority signal. Zero means no owner; more than one means fail closed.
- Structural authors never work in the orchestrator's context. Use exact claims and isolated worktrees.
- Preview, merge, and production are serialized. Re-prove current refs and target before each action.
- Never treat queued, cancelled, skipped, stale-head, or wrong-base checks/reviews as passing.
- Never expose licensed OPA/DCP rows, names, account data, reviewer secrets, process environments, or credentials.
- Migrations `20260814223552` and `20260825094455` remain hard-blocked. Never broad-apply drift.
- Production write authority is only through the governed workflow named in the issue/owner authorization. Direct production inspection is read-only.
- Do not remove/disable GLM to suppress the failure. Preserve and repair the capability.
- Do not change application repositories as part of #1607 database promotion.
- Current PR bases are behind the now-current doc-only main tip. Do not infer semantic conflict, but re-derive and refresh before promotion.

## 8. Access and environment

- Machine: EDGE-DEV, Windows PowerShell.
- Canonical repo: `C:/repos/shared-db`; closeout worktree: `C:/repos/shared-db-worktrees/orchestrator-1602-closeout`.
- `gh` is authenticated as the `u2giants` owner context. Git committer identity was verified as `Albert Hazan <u2giants@users.noreply.github.com>` before the closeout commit.
- Supabase CLI/MCP target identifiers are in §1. Secrets belong in 1Password vault `vibe_coding`; never copy values into commands, issues, handoffs, or chat.
- GLM wrapper is `ai-glm`; incident evidence is under `C:/repos/ai-devops/.ai/reviewer-issues/20260827T002811Z-edge-dev-GLM-4171081`.
- Queue manager: `node scripts/manage-migration-author-lanes.mjs`; marker resolver: `node scripts/check-orchestrator-marker.mjs --resolve`.

## 9. Open questions and risks

- Owner decision: token rotation in #1629, duplicated in §0.
- GLM service may appear healthy briefly while its permission callback remains unavailable. A health check alone is not repair proof.
- The interrupted manager reviewer assignment commands may or may not have created a durable ref before they were stopped. Inspect live refs before assigning again.
- Preview is shared; its complete current ledger was not exhaustively enumerated during closeout. Re-derive before write.
- Main advanced to `dfcb6b4...` via documentation while #1623 and the predecessor PRs remained open. Their code may still be mergeable, but reviews/promotions must bind current facts.
- Numerous historical worktrees remain. Their presence is not proof they are abandoned; no broad cleanup is authorized.

# Part B — per-agent state

### Agent: Lovelace / `issue_1597_author`

- **Asked to do:** author #1597's structural migration and tests.
- **Actually did:** the resulting work landed through PR #1604 and production migration `20260826144047`; final author head `2615c279de97f453fb32bea8ded8277fb4e349e8`.
- **Found:** the durable Kimi review completed cleanly and was independently qualified before promotion.
- **PR / branch:** PR #1604 merged; `codex/issue-1597-propagate-tags-1602`.
- **Worktree:** finished, but contains one untracked review prompt; safe cleanup only through `cleanup-worktree` after marker closure.
- **Deliberately did NOT do, and why:** no cleanup during active orchestration, to preserve reviewer evidence.

### Agent: Sartre / `issue_1599_author`

- **Asked to do:** implement the authorized Disney/Lucas OPA scope-membership and DCP exact-identity evidence contract.
- **Actually did:** rewrote the branch to a linear exact six-file diff; final head `3ceea44acecc2747c77ca69cb76b1cc333a67173`; PR #1614 merged and migration `20260826200252` production-applied.
- **Found:** live table is `plm.dcp_property`; direct OPA branch identity is authoritative; Disney/Lucas scopes overlap and must be many-to-many.
- **PR / branch:** PR #1614 merged; `codex/issue-1599-opa-dcp-scope-1602`.
- **Worktree:** finished with untracked review prompt artifacts; cleanup deferred.
- **Deliberately did NOT do, and why:** did not expose licensed rows/names and did not encode absence of hierarchy evidence as a business fact.

### Agent: #1610 author / `issue-1610-1602`

- **Asked to do:** repair DesignFlow Flow 3 approval trigger contract.
- **Actually did:** PR #1618 final head `658f1a53f6b721ec047af27339fd28af982b3790`; migration `20260826185548` merged, production-applied, directly verified.
- **Found:** the NYO pending(false) to approved(true) QC decision needed the narrow governed trigger correction.
- **PR / branch:** PR #1618 merged; `codex/issue-1610-flow3-qc-decision-1602`.
- **Worktree:** finished and clean; cleanup deferred until marker closure.
- **Deliberately did NOT do, and why:** no application-repository mutation; scope was shared database structure only.

### Agent: Galileo / `issue_1607_author`

- **Asked to do:** author Flow 4 remote-request/reservation schema, repair all exact-head review findings, and add real concurrency proof.
- **Actually did:** final candidate head `818b2381e9209f96c03443581772ea5aabeffcd6`; migration plus sequential pgTAP contracts plus required runner-side two-client concurrency script/workflow step. All exact-head CI green.
- **Found:** lock-before-lookup is required; dblink cannot prove password use through the local trust pg_hba path; runner-side `psql` is deterministic.
- **PR / branch:** PR #1623 open; `codex/issue-1607-flow4-remote-request-1602`.
- **Worktree:** live/resumable with untracked GLM prompt artifacts.
- **Deliberately did NOT do, and why:** no preview/merge/production because required GLM and independent exact-head review gates were not complete.

### Agent/worktree: predecessor #1452 / `issue-1452-1579`

- **Asked to do:** index bounded unread DesignFlow notification queries.
- **Actually did:** PR #1587 at `9f6ac1f...`, required checks green.
- **Found:** exact index/table claim remains isolated.
- **PR / branch:** PR #1587 open; `codex/issue-1452-notification-index-1579`.
- **Worktree:** live, clean, preserve.
- **Deliberately did NOT do, and why:** no promotion under marker #1602 because higher-priority serialized work occupied the gate.

### Agent/worktree: predecessor #1259 / `issue-1259-1579`

- **Asked to do:** harden FR transaction-bound authorization contracts.
- **Actually did:** PR #1586 at `ae40661b...`, required checks green.
- **Found:** exact table/function claim remains isolated.
- **PR / branch:** PR #1586 open; `codex/issue-1259-fr-hardening-1579`.
- **Worktree:** live, clean, preserve.
- **Deliberately did NOT do, and why:** no promotion under marker #1602 because higher-priority serialized work occupied the gate.

### Agent/worktree: predecessor #1467 / `issue-1467-1579`

- **Asked to do:** drop the completed temporary asset-tags normalization index after ledger proof.
- **Actually did:** PR #1585 at `ae36d2ce...`, required checks green.
- **Found:** exact index-only claim remains isolated.
- **PR / branch:** PR #1585 open; `codex/issue-1467-drop-normalization-index-1579`.
- **Worktree:** live, clean, preserve.
- **Deliberately did NOT do, and why:** no promotion under marker #1602 because higher-priority serialized work occupied the gate.

## Closeout sweeps

- **Secrets sweep:** completed. It found the redacted token exposure described in #1629; no values were copied into durable artifacts. No other new secret was found in owned diffs/untracked review prompts.
- **Docs pass:** nothing outside this handoff became stale from the structural work. The reviewer incident and token decision have separate GitHub issues; no standing rule needs rewriting here.
- **Queue seed:** existing #1607, #1452, #1259, #1467, and #1615 remain open; new #1627, #1628, and #1629 cover reviewer repair, orchestration continuity, and owner-only token rotation.
- **Sweep:** finished worktrees were deliberately not removed while marker #1602 remained open; live worktrees are named above; unrelated historical worktrees were not touched.

## Mandatory self-audit

1. **Yes, a brand-new developer can continue without questions.** Sections 1–3 define the system and exact live state; §6 gives ordered commands/gates; Part B separates every author lane.
2. **Yes, they can continue as effectively as this session.** §4 preserves every failed approach and why; §5 records the non-obvious findings; §7–§9 capture governance, environment, and risk.
3. **Yes, every execution-critical detail is included.** Exact issues, claims, PRs, heads, migrations, run IDs, worktrees, preview/production status, blockers, and verification gates appear in §§3–8.
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of §§1–9 and Part B found only the token-rotation authorization; it is listed in §0 with recommendation and consequence. All other owner decisions are explicitly settled and listed to prevent re-asking.
