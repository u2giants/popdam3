---
issue: 2267
status: OPEN
owner: codex/01a069d8-3c1a-7d03-bc9f-fd0e1c0577a2
---

# Post-cutover closeout for orchestrator #2249

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking security action

- Authorize rotation and revocation of the DesignFlow MCP proxy bearer credential and the NAS MCP proxy bearer credential recorded by issue #2284. A read-only process diagnostic printed both values into private Codex tool output. They were not copied into chat, files, commits, pull requests, or GitHub issues, but must be treated as compromised. Recommendation: approve rotation now; this blocks closing #2284, not the database queue.

### Already settled — do not re-ask

- On 2026-09-04 Albert told the outgoing session not to start new tasks during gaps and to complete a Path B handover. The predecessor complied and must not be reactivated as an orchestrator.
- The successor owns marker #2269 under route id `01a06a69-cbe3-7183-b029-8ce75153c7e1`. Never reopen marker #2249 or move #2269 back to the predecessor.
- No review, preview, merge, or production gate may be bypassed to increase throughput.

The next session must put the single unresolved security decision above to Albert in one message before handling #2284. No other owner decision is recorded here.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of POP Creations' shared Supabase database. One live orchestrator coordinates structural issues and isolated author worktrees while preview, merge, and production remain serialized. Repository-maintenance issues are owned by separate repository sessions, not by the structural orchestrator.

The authoritative queue is the set of open GitHub issues labelled `db-work`. The live routing target is resolved with `node scripts/check-orchestrator-marker.mjs --resolve`; handoff files and old marker comments are context, never live routing proof.

## 2. What this session set out to do, and why

The original objective was to pull current repository truth, open the shared-db orchestrator, prioritize work that unblocked the most downstream issues, then handle the requested priority set #2136, #2126, #2054, #1966, #2212, #2202, #2203, #2204 and #2169 with maximum safe concurrency.

The Path B cutover was completed in `HANDOFF.d/2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md`, PR #2268, issue #2267, and the closure note on marker #2249. This second write-once handoff exists because several important repository-maintenance and security facts arose after that cutover and were not consolidated in the first file.

## 3. Current state — verified 2026-09-04 11:08–11:10 UTC

- `origin/main` was `591b8951485c601dc2652b11e51aa1b2b366d854` when fetched. The maximum migration filename in this checkout was `20260903200951_coldlion_division_reference_table.sql`.
- Marker #2249 is closed. `check-orchestrator-marker --resolve` identified exactly one declared successor marker, #2269, route id `01a06a69-cbe3-7183-b029-8ce75153c7e1`. The successor task was active when last inspected.
- Handoff PR #2268 is merged at `5881cb35f91d4df607c9a0f8e02152f4411b1e43`. The original cutover issue #2267 remains open because the successor workstream remains open.
- Guarded-merge workflow repair PR #2276 is merged at `4ad84a354559bf2a3c8f95a0d6028c1b02d8da22`. It repaired the invalid workflow permission and the later fail-open review findings; its live guarded workflow run succeeded.
- Reviewer-pool repair PR #2266 remains open at `fd8a9ffe7e0f1d0660fc7fe9cc9bf57f6b564f9e`. All reported checks are green, including the targeted Cross-PR rerun and 1,162 tests, but it has no valid governed exact-head approval. Muse and Grok completed without recordable verdicts; the terminal failures were recorded and their leases released. GLM was the only remaining eligible reviewer and was legitimately occupied by #2207/PR #2260 at the last owner report.
- Issue #2280 remains open for the expired-claim expand/renew deadlock affecting #2175/claim #2184 and #2177/claim #2182. It is repository maintenance and must stay outside the structural orchestrator.
- Issue #2284 remains open with `needs-albert` for rotation of the two exposed bearer credentials. No values appear in this file.
- Issue #2285 remains open for upgrading the reviewer pool to a verified Muse Spark 1.3 Contributor. The installed wrapper was actually pinned to Spark 1.2, so it was excluded rather than misrepresented.
- Structural issues #2202, #2159, #2173, #2212, #2203, #2204 and #1966 remain open. PRs #2259, #2228 and #2186 remain open. #1966 remains intentionally frozen until 2026-09-17.
- Queue audit showed all eight author lanes protected/occupied and no dispatchable empty lane. Five claims were expired but still protected; expiry is not release.
- This outgoing session applied nothing to protected preview, wrote no preview rows, and applied nothing to production. It did not independently inspect the successor's shared preview state; the active successor must report its own preview truth.
- The canonical checkout was 36 commits behind before fetch/checkout alignment and contains two pre-existing untracked handoff files: `2026-08-30T1915Z-edge-dev-codex-non-orchestrator-sweep-continuation.md` and `2026-08-31T1051Z-edge-dev-codex-maintenance-sweep-fa05.md`. They are not owned by this session and must not be edited, staged, or deleted here.

## 4. Everything tried that did not work

1. Direct reviewer wrappers produced useful feedback but not durable governed verdicts. Only the governed review lifecycle counts.
2. Two Grok attempts on #2202 reached their turn limit without verdicts. Repeating unchanged attempts was stopped and each failure was durably released.
3. PR #2272 merged an invalid `administration: read` workflow permission. GitHub then could not parse the guarded-merge workflow. PR #2276 repaired this and also fixed fail-open behavior found during review.
4. The first #2276 review result was `REVISE`, not approval. It identified incomplete fallback check coverage, reading the fallback mirror from a mutable PR head, a possible empty-mirror pass, tests writing the real mirror, and missing exact-context/stale-subset cases. Those findings were repaired before merge.
5. A duplicate repository-maintenance owner was accidentally created for the #2276/#2266 chain. It was stopped before remote edits after the existing sole owner was identified. Do not revive the duplicate task `01a06ab6-d569-7d71-91f5-8b3f0569f457`.
6. #2266's first Cross-PR collision failure was stale because it ran before colliding PRs #2237 and #2245 were moved to draft. A targeted rerun after the state changed passed.
7. Muse and Grok each ran governed replacement reviews for #2266 but returned no recordable verdict. Silence was not treated as approval; both terminal failures were recorded and released.
8. Expired claims #2184 and #2182 cannot be renewed because their PRs reveal legitimate child-column writes not listed individually, while the existing expansion command refuses expired leases. Manual ref edits or release would weaken protection and were rejected. Issue #2280 owns an atomic expand-and-renew repair.
9. Broad process inspection exposed two bearer credentials in private tool output. Further broad process inspection was stopped. Do not reproduce the command or print process environments.
10. The repository labels Muse as 1.2 and live wrapper inspection confirmed it was not the requested Spark 1.3. It was excluded; do not rename 1.2 evidence as 1.3.

## 5. Root causes and key findings

- The original priority queue was blocked more by governed reviewer capacity and protected object collisions than by failing code.
- #2202 is still the highest requested structural unlock because it releases #2203 and #2204. #2212 is separately blocked by lane-3 object overlap with #2159.
- #2203 and #2204 can be authored concurrently after #2202 from the same fresh main because their writes are disjoint. Merge #2204 first, then refresh and retest #2203 against the final notification schema.
- The guarded-merge failure was a repository workflow defect, not a database change. PR #2276 restored the capability without bypassing it.
- #2266 is repository maintenance and cannot be worked inside the structural orchestrator. Its exact-head reviewer scarcity remains the last merge gate.
- Expired leases remain protective locks. #2280 must preserve this behavior while adding a single atomic validation/expansion/renewal route.
- The two exposed credentials require rotation even though exposure was limited to private tool output. Issue #2284 is the durable owner-facing record.
- No structural task completed through production in the outgoing session. Merge, green CI, and handoff completion are not production acceptance.

## 6. Exact next steps

1. Re-resolve marker #2269 before sending anything to the successor. Success: exactly one live marker prints route id `01a06a69-cbe3-7183-b029-8ce75153c7e1`, or a new current route if a later handover occurred.
2. Ask Albert once to approve rotation/revocation of both credentials named in issue #2284. Success: issue #2284 contains a fresh explicit authorization; then rotate through the approved 1Password-backed setup without exposing values and verify the old values are revoked.
3. Let the independent repository owner finish #2266: draw GLM only after its legitimate existing lease clears, obtain a durable exact-head approval for `fd8a9ffe...` or its refreshed successor head, merge through the repaired guarded workflow, verify `origin/main`, close #2106, and notify marker #2269. Success: PR #2266 is merged, issue #2106 is closed with evidence, and no live reviewer lease was bypassed.
4. Route #2280 only through its separate repository-maintenance owner. Implement atomic PR-derived child-object validation, expired protected-claim expansion, and renewal with behavioral tests for both #2175/#2184 and #2177/#2182. Success: its guarded PR is merged and both claims can recover without manual ref editing or loss of protection.
5. The active successor should continue the structural queue, not this predecessor: finish #2202 first; clear #2159 to free lane 3; start #2212 when its objects are legitimately free; then start #2203 and #2204 concurrently, merging #2204 before the refreshed #2203. Success: each issue has exact-head review, preview evidence, guarded merge, production evidence where separately authorized, completion records, and released claims.
6. Preserve #1966's observation freeze until 2026-09-17. Success: no structural change or counter reset occurs before the scheduled delta reading.
7. When the successor eventually closes, it must write its own Path B handoff, report actual preview state, merge its docs-only handoff PR, close marker #2269 last, and open a new marker only through a verified successor handshake. Success: no dead route remains open.

## 7. Constraints and gotchas

- Never reopen #2249 or edit marker #2269 from this predecessor.
- Never route from this handoff; resolve the live marker every time.
- Repository maintenance (#2106, #2280, #2285) remains outside the structural orchestrator.
- Never hand-edit reviewer or migration-author refs, invent a verdict, reclaim a legitimate live lease, or treat silence as approval.
- Preview, merge, and production are serialized. Production authorization is separate and cannot be inferred from a merged PR.
- Never edit a migration version already previewed or applied; use a new forward migration.
- Preserve the two untracked handoff files owned by other sessions.
- Do not expose licensed data, credentials, process environments, or bearer values in commands, chat, logs, commits, or issues.
- Use Grok 4.6 and GLM 5.3 only while Muse remains unverified as Spark 1.3; Kimi K3 was excluded for the owner's stated 12-hour window beginning 2026-09-04.

## 8. Access and environment

- Repository: `C:\repos\shared-db`; GitHub repository: `u2giants/shared-db`.
- GitHub CLI and Git fetch were authenticated during this closeout.
- Machine: EDGE-DEV. Time zone: America/New_York; evidence above is stamped in UTC.
- Secrets belong in 1Password vault `vibe_coding`. This file contains no secret values or item contents.
- This closeout performed read-only GitHub/repository checks plus this documentation change. It performed no Supabase preview or production operation.

## 9. Open questions and risks

- Owner decision: credential rotation authorization remains outstanding under #2284. This is duplicated in §0.
- #2266 may require refresh if main advances before GLM becomes available; all CI and review evidence must then bind to the new head.
- The active successor's preview state was not inspected by this predecessor. The successor must state it from current evidence before any promotion.
- Queue snapshots, PR heads, reviewer leases, and main SHA can change within minutes. Re-run live checks before action.
- Issue #2267 and #2284 intake blocks were malformed at closeout start. This closeout repairs their metadata; rerun `--queue-audit` and require that neither remains under `malformed`.

## Coordinator appendix — post-cutover agents/tasks

### Agent: successor orchestrator `01a06a69-cbe3-7183-b029-8ce75153c7e1`
- **Asked to do:** take marker ownership after #2249, maximize safe parallel work, and continue the structural priority queue.
- **Actually did:** opened marker #2269; resumed structural lanes; discovered the invalid guarded-merge workflow, expired-claim deadlock, unverified Muse version, and credential exposure; opened #2280, #2284, and #2285; kept structural claims protected.
- **Found:** reviewer and author-lease capacity defects were blocking several otherwise-ready lanes.
- **PR / branch:** successor owns its own active workstreams; see current GitHub issues and its future Path B handoff rather than assuming a single branch.
- **Worktree:** live and resumable; declared route is #2269.
- **Deliberately did NOT do, and why:** did not bypass reviewer gates, reclaim live leases, apply production changes, or mislabel Muse 1.2 as 1.3.

### Agent: sole repository-maintenance owner `01a06ab5-cb6e-75b1-abfc-0822f90757b9`
- **Asked to do:** repair PR #2276, then continue #2106/PR #2266 independently of the structural orchestrator.
- **Actually did:** repaired all substantive #2276 review findings, passed 1,160 tests, obtained approval, and merged #2276 at `4ad84a35...`; refreshed #2266 to `fd8a9ffe...`, added atomic race-safety coverage, passed 1,162 tests and all CI, and recorded/released terminal Muse and Grok failures.
- **Found:** #2266's remaining blocker is a valid independent exact-head reviewer, not code or CI.
- **PR / branch:** #2276 merged; #2266 open at `fd8a9ffe...`.
- **Worktree:** task ended idle after reporting the reviewer-capacity blocker; treat its branch/worktree as live until PR #2266 is merged and verified.
- **Deliberately did NOT do, and why:** did not merge #2266 without approval or reclaim GLM while it held legitimate work.

### Agent: duplicate repository-maintenance task `01a06ab6-d569-7d71-91f5-8b3f0569f457`
- **Asked to do:** initially duplicate repair work due to an ownership-detection mistake.
- **Actually did:** stopped before remote edits after the existing sole owner was found.
- **Found:** task ownership must be checked before creating a second worker on the same PR.
- **PR / branch:** no owned PR or remote change.
- **Worktree:** stopped; do not resume.
- **Deliberately did NOT do, and why:** made no remote edits to avoid racing the sole owner.

## Mandatory self-audit

1. **Fresh-developer continuity: yes.** §§1–3 define the repository, objective, live marker, exact PR/issue/SHA state, environment status, and ownership; §6 gives ordered continuation gates.
2. **Equivalent working knowledge: yes.** §§4–5 preserve the failed approaches, root causes, reviewer/claim constraints, priority ordering, and the difference between merged and production-complete work; the coordinator appendix separates every post-cutover task.
3. **Every execution detail: yes.** §§0–9 cover background, goals, intended outcome, current state, failures, decisions, constraints, risks, access, exact next actions, and verification evidence. The older comprehensive pre-cutover agent inventory remains referenced rather than copied and allowed to drift.
4. **Owner-decision sweep: yes.** A line-by-line pass over §§1–9 and the appendix found one owner judgment: rotation/revocation of the two exposed credentials in §§3, 5, 6 and 9. It is consolidated with a recommendation and consequence in §0. All other items are existing worker actions or settled instructions.
