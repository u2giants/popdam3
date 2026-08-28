---
issue: 1735
status: OPEN
owner: codex/orchestrator-1725-resume-closeout
---

# Resumed orchestrator #1725 Path B handover

## 0. Decisions only the owner can make

### Blocking

- **#1671 non-production database identity:** authorize a read of only the develop and staging database host/user identity fields, not passwords, or provide an approved non-secret project-reference assertion. Recommendation: authorize the identity-only read. This blocks the already-authored DesignFlow copy-column migration. #1671 retains `needs-albert`.

### Already settled — do not re-ask

- #1353 was de-escalated: production is Cloud SQL; the shared Supabase project is non-production.
- #1609's FK design was settled; its remaining Universe B target question is carried by #1238.
- Never expose licensed rows or private source evidence, and never replay a non-replayable migration or delete its ledger row.

No other item in this handover requires Albert. The next session should raise the one #1671 question in a single message before attempting that issue.

## 1. What this application is

`u2giants/shared-db` is the public source of truth for shared database structure. One orchestrator owns structural routing at a time. Exact object claims isolate five author lanes; preview, merge and production remain serialized. Ordinary application rows are not orchestrator work, and outside-sourced curated Master Data follows its separate governed route.

## 2. What we set out to do this session, and why

Albert resumed the same Codex task after its 09:58 UTC Path B closeout and asked it to keep five lanes full, prioritizing #1658, #1662/#1736, #1684, #1669, #1645, #1722, #1692, #1656 and #1703. The session reopened marker #1725 with its still-live route, restored the five-minute heartbeat, reran live claim and queue audits, and dispatched read-only monitoring of the blocked structural chains. It did not implement or dispatch repository-maintenance work.

## 3. Current state — what is true right now

Moving facts were checked at `2026-08-28T10:44:45Z`. `origin/main` was `1eacdacd52a5d6bbd212f718967391df1381138d`; maximum migration was `20260828030532`. Marker #1725 was the sole resolved marker. Audit showed 5/5 author lanes occupied, two expired claims still protective, no current preview/merge/production run, and no dispatchable structural refill.

### Finished during the brief resumed run

- No migration, PR, preview, production or claim lifecycle completed during this resumed interval.
- The marker and heartbeat were restored safely, and all requested issues were reconciled against live GitHub.
- Every outstanding item already had an open `db-work` issue. The earlier missing #1662 production continuation remains #1736. No duplicate issue was opened because the handover standard requires refreshing existing issues.

### Outstanding structural work

- **#1720 / claim #1726:** migration `20260828021051` is already applied in production, but catalog verification failed after apply. #1732 must add exact-byte read-only recovery. Never replay.
- **#1646 / claim #1730:** migrations `20260827095753` and `20260828030532` remain unpromoted; production stopped before any write. #1733 must repair governed supersession evidence validation.
- **#1684 Phase 2 / PR #1712 / claim #1711:** head `95e298f538f3243fe1f0dae89d277ef7ec55f186`, old version `20260827224649`; blocked on #1729's atomic supersession repair.
- **#1658 / PR #1660 / claim #1659:** head `8a3657828686155694f02f18e60e1a1169bedd9b`, version `20260827214517`; blocked on #1709 and an invalid dependency reference to PR #1655 rather than a work issue.
- **#1645 / claim #1656:** version `20260827183011` must never be promoted or rehearsal-reset. #1692 must provide atomic reissue and hard retirement. #1703 overlaps and waits behind it.
- **#1736:** production continuation of closed implementation #1662; migration `20260827213024` was merged and previewed but lacks production proof. It is queued behind active lane 2.
- **#1669:** waits on #1658 production and private loader/coverage proof. Never publish licensed values.
- **#1722:** scope-correct covering-index follow-up; waits for a genuinely free lane.
- **#1671:** waits on the section 0 owner decision.

### Separately owned repository-maintenance blockers

#1692, #1709, #1729, #1732 and #1733 remain open and are not orchestrator assignments. Their dependent structural claims stay locked.

### Preview and checkout state

Preview is not clean. It retains the known rehearsals and #1658 orphan ledger version `20260827134155`; re-derive the live ledger before action. The shared checkout remains heavily dirty with other sessions' files and historical worktrees. This session touched only its marker scratch body and its isolated closeout worktree. No broad cleanup was attempted.

## 4. Everything we tried that did not work

- A fresh Codex project task was attempted so the resumed orchestrator could use a new route ID. Direct creation timed out; worktree creation returned a temporary client ID but never produced a routable task and its temporary worktree disappeared. No duplicate marker was opened during that uncertainty.
- Forking the current task failed because the thread history projection reported an ordinal mismatch. The same still-live task was therefore explicitly resumed, and marker #1725 was reopened rather than fabricating an address.
- Three existing sub-agent identities were sent read-only monitoring follow-ups, but no durable report returned before closeout; no structural or database mutation resulted.
- Queue audit remains `fullyAudited: false` because #1658 depends on PR #1655 instead of a work issue and because older non-orchestrator queue debt remains visible. It still proved zero empty lanes and zero dispatchable structural work.

## 5. Root causes and key findings

- A Codex task cannot honestly claim a new route ID when it is the same resumed thread. Reopening its original marker was more accurate than inventing a successor.
- All five author slots are protective, not necessarily actively coding: four priority chains depend on separately owned maintenance or recovery gates.
- Closed implementation is not production proof; #1736 remains required for #1662.
- Queue dependency success cannot be inferred from a pull request number.

## 6. Exact next steps

1. A successor opens its own marker with a new route ID and resolves it. Success: exactly one marker names the successor.
2. Start independent repository sessions for #1732 and #1733. Success: fail-closed recovery contracts land without replay or verifier bypass.
3. Recover #1720 verification, close #1720 and release #1726. Success: exact production constraint and ledger proof.
4. Recover and promote ordered #1646 migrations after #1733. Success: production function proof and claim #1730 released.
5. After #1729, atomically supersede #1684 and resume exact-head review through production. Success: claim #1711 released after production verification.
6. After #1709 and dependency repair, reconcile #1658's orphan and finish PR #1660. Success: no ledger deletion and claim #1659 released.
7. After #1692, reissue #1645; then unblock #1703. Success: new production version and claim #1656 released.
8. Promote #1662 through #1736. Success: production ledger and function behavior proven.
9. Dispatch #1722 into the first free structural lane. Success: covering index production-verified.
10. Finish #1669 only with private loader/coverage proof. Success: public structure verified without licensed disclosure.
11. Obtain #1671's section 0 decision before applying anywhere. Success: exact non-production target identity proven.

## 7. Constraints and gotchas in force

- One marker only; zero markers means queue, not permission to dispatch.
- Structural work only in author lanes; repository maintenance is neither implemented nor dispatched by the orchestrator.
- Keep claims locked while separately owned recovery is outstanding.
- Serialize preview, merge and production; refresh main, PR head, claim, target and ledger before action.
- Never replay, manually rename a claimed/applied migration, delete ledger rows, bypass failed-closed gates, or expose licensed data.
- Preserve unrelated dirty files and worktrees.

## 8. Access and environment

Git and GitHub CLI were authenticated. Machine: `edge-dev`; canonical checkout: `C:\repos\shared-db`. Secrets remain in 1Password vault `vibe_coding`; no values are present here. Secrets sweep inspected this session's scratch marker body and closeout diff: nothing new was found.

## 9. Open questions and risks

- #1671 is the only owner decision and appears in section 0.
- All main, PR, claim, workflow and ledger facts move; refresh them before action.
- #1720 is already applied despite a red run; replay would be an incident.
- The same route ID was reused only because Albert explicitly resumed the same still-live task; a true successor must use a new task and route.
- Docs pass: nothing outside this handover was made false. No implementation plan was executed or invalidated by this brief resumed run.

# Part B — sub-agent state

### Agent: Pascal / #1646 monitoring

- **Asked to do:** re-derive #1646 and #1733 state read-only.
- **Actually did:** no durable report returned before closeout.
- **Found:** no new verified fact beyond the live claim and blocker audit above.
- **PR / branch:** PR #1731 remains merged; claim #1730 and its worktree remain live.
- **Worktree:** live and resumable after #1733.
- **Deliberately did NOT do, and why:** no maintenance, preview or production action was authorized.

### Agent: Planck / #1658 and #1669 monitoring

- **Asked to do:** re-derive the dependency chain without licensed disclosure.
- **Actually did:** no durable report returned before closeout.
- **Found:** live queue audit still cannot prove dependency #1655.
- **PR / branch:** PR #1660 remains open; claim #1659 remains protective.
- **Worktree:** live and resumable after #1709 and dependency repair.
- **Deliberately did NOT do, and why:** no maintenance implementation or licensed-data publication was authorized.

### Agent: Averroes / #1720 and #1684 monitoring

- **Asked to do:** re-derive both recovery chains read-only.
- **Actually did:** no durable report returned before closeout.
- **Found:** #1732 and #1729 remain open blockers.
- **PR / branch:** #1720 PR merged with claim #1726 held; #1684 PR #1712 open with claim #1711 held.
- **Worktree:** both remain live.
- **Deliberately did NOT do, and why:** replay, manual supersession and maintenance work are forbidden here.

# Self-audit

1. **Yes:** sections 1–9 provide purpose, live state, failures, findings, exact next actions, constraints, access and risks for a new developer.
2. **Yes:** every priority issue, PR, claim, blocker, migration and material failed attempt from this resumed run is explicit, with separate agent blocks.
3. **Yes:** production/preview status, intended outcomes, privacy boundaries, decisions and verification gates are included.
4. **Yes:** the only owner-dependent sentence is #1671's identity-only authorization, indexed in section 0 with a recommendation and consequence.

Secrets sweep: completed, nothing new. Docs pass: nothing outside this handover is stale. Queue seed: every outstanding item has an open `db-work` issue; #1671 retains `needs-albert`. Sweep: live claims and PRs were checked, no finished worktree was misrepresented, and unrelated dirty state was untouched.
