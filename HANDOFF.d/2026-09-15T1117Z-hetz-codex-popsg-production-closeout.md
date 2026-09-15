---
issue: 107
status: BLOCKED
owner: codex/popsg-production-readiness-107-20260915
---

# HANDOFF — PopSG production-readiness closeout (2026-09-15 11:17Z, hetz/codex)

Canonical plan: [`plan_popsg_production_readiness.md`](../plan_popsg_production_readiness.md). Read it after `AGENTS.md`, including its STATUS table and every execution-drift entry. Read this file and its direct predecessor, [`2026-09-03T1821Z-hetz-codex-popsg-production-continuation.md`](2026-09-03T1821Z-hetz-codex-popsg-production-continuation.md), before touching this workstream.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking

- The SSH private key held in 1Password item `916-alien` was unexpectedly rendered in this session while metadata was being inspected. Treat it as compromised, but Albert explicitly declined rotation on 2026-09-15 because roughly 50 dependent uses would break. Do **not** use that key again from this session lineage. Recommendation: authorize and schedule a dependency-aware replacement separately; this blocks direct bridge administration here.
- Final administrator-console acceptance needs an account with PopSG Admin rights. The protected signed-in QA account can browse and search but returned four expected authorization failures when opening the Admin-only preview-health area. Recommendation: provide a protected Admin-capable test identity only when the final Admin phase is reached; this blocks only the final Admin proof, not governed database work.

### Already settled — do not re-ask

- Do not increase timeouts, delete NAS/database records, expose licensed paths, run competing crawls/backfills, or start a competing shared-db orchestrator.
- Shared database structure remains exclusively in `u2giants/shared-db` through its active orchestrator. This session was a non-orchestrator consumer: it made no migration, schema edit, database write, or shared-db branch.
- `edgesynology2` is read-side only; never write its Style Guides content. Bridge updates must preserve Compose ownership, recreate only the bridge service, and retain rollback capability.
- #2506 is closed as completed. The signed-in production browse/search proof is valid for its app-outcome closure, but it does not settle #2860's default-v2 performance defect.

The next session must put both blocking items above to Albert in one message before attempting the respective blocked actions; do not ask again about the already-settled constraints.

## 1. What this application is

PopSG is the authenticated style-guide library within POP Creations' PopDAM application. It inventories eligible creative files from the read-side Style Guides NAS share, provides previews and search, and is served at `https://sg.designflow.app`. The repository is `u2giants/popdam3` at `/worksp/popdam` on `main`; the shared PostgreSQL schema is governed separately in `u2giants/shared-db`. Production Supabase is Virginia project `qsllyeztdwjgirsysgai`; never use retired Ohio project `ryltkzzernhwnojzouyb`.

## 2. What we set out to do this session, and why

Continue PopSG production-readiness issue [#107](https://github.com/u2giants/popdam3/issues/107) through production acceptance without repeating completed baseline/bridge incidents. The work needed a trustworthy NAS-library crawl, classified previews, PDF search coverage, comprehensive v2 search, three ordinary nightly crawl proofs, signed-in production QA, documentation, issue closure, and handoff retirement.

This session confirmed live app search after the shared-db #2506 production change, closed #2506, tracked newly moved governed performance work, and investigated the remaining bridge version-adoption block. It is ending because the remaining work is externally serialized or needs owner authority; #107 is not complete.

## 3. Current state — what is true right now

### Completed and verified

- Plan steps 1–4 are complete: three ordinary September 11–13 crawls accepted 216,702 files, reconciled safely, refreshed aggregates, and the protected exact-contract comparison proved 216,702 active Virginia rows match the eligible edge2 inventory with zero missing/extra paths. The first run reversibly inactivated the earlier 11,618 proven ghosts; later runs changed zero rows.
- Preview phase 6 is complete: 214,694 active files have previews and 2,008 have classified exceptions, with no unexplained rows. The protected signed-in UI rendered the 216,702 Preview Coverage total.
- Commit `b1f8621c` is on `main` and records sanitized signed-in production search evidence. In that QA, Guides loaded, Files loaded in 6,536 ms, a real Files search completed in 3,008 ms, and no HTTP/browser-console errors occurred. No licensed path, result, cookie, or screenshot was retained.
- Shared-db [#2506](https://github.com/u2giants/shared-db/issues/2506) is closed as completed at 2026-09-15 01:18:49Z after its production migration proof and the app QA above. This session added the closure evidence comment and closed the issue.

### Still open / not accepted

- Plan step 5 needs healthy and reconciling production Admin proof. Step 7 is blocked: the existing PopDAM PDF job has an authoritative remainder of 2, but `claim_pdf_backfill_batch(1)` previously timed out at the normal ceiling; PopSG PDF extraction is serialized behind its repair and that PopDAM terminal drain.
- #2792 is OPEN under active shared-db marker [#2927](https://github.com/u2giants/shared-db/issues/2927). PR [#2933](https://github.com/u2giants/shared-db/pull/2933) is merged, but required historical-ledger restoration is still claimed in #2937 and this session did not obtain production performance/acceptance evidence. It covers bounded stale reconciliation and the PDF claim/count performance defect.
- #2860 is OPEN. Its default-v2 Files-search timeout has a live orchestrator claim [#2945](https://github.com/u2giants/shared-db/issues/2945) under #2927. The current frontend remains on direct `style_guide_files` / `style_guide_file_groups` reads in `src/pages/popsg/PopSGLibraryPage.tsx:617-705`; do not claim v2 app cutover until the governed contract is live and the app uses it.
- The current edge2 bridge heartbeat reports version `1.16.11`, build `6ca879e7e23d6e0eacec55f9e8e460afbbb4fca0`; desired `1.16.12` was published earlier. The safe in-agent update stopped because the running container cannot access its Compose file. `fc7bfa91` added the reference read-only Compose mount, but edge2 requires one Container Manager project refresh to establish it before automatic adoption can work.
- Final issue #107 acceptance, final documentation, and retirement of this and predecessor PopSG handoffs remain open.

At closeout `main` equals `origin/main`, the worktree is clean, and `git var GIT_COMMITTER_IDENT` reports `Albert Hazan <u2giants@users.noreply.github.com>`. This session's durable changes are `b1f8621c`, the drift note in the canonical plan, and this handoff; no uncommitted application code exists.

## 4. Everything we tried that did NOT work

1. A natural default-v2 Files search still cancelled at the normal database statement ceiling. A successful user-visible legacy search is not evidence that the v2/default contract is healthy. #2860/#2945 owns the governed repair; do not raise the timeout or replace it with a manual query.
2. Calling the PopDAM PDF claim at batch size one still timed out. Shrinking the caller alone did not cure the bounded-function defect, so no competing PDF runner was started. #2792 owns the repair; PopSG extraction remains idle.
3. The normal bridge self-update could pull the published image but stopped safely because its running container lacks a visible Compose definition. It intentionally did not fall back to unmanaged Docker topology; do not bypass that guard with `docker run` or `compose down`.
4. The bridge sub-agent found `ahazan` lacks noninteractive Docker-socket/sudo access. Attempting to solve this by using the 1Password SSH item exposed the key in the tool transcript despite `reveal:false`; the agent was interrupted before any SSH connection or NAS change. Do not retry with that key.
5. The signed-in non-Admin QA account was able to prove customer browsing/search but received four 403 responses for the Admin-only preview-health API. Do not suppress those errors or call it final Admin acceptance; use a proper Admin identity later.

## 5. Root causes and key findings

- The remaining database defects are independent of #2506: #2792 is a bounded reconciliation/PDF-claim performance lane; #2860 is the natural/default v2 Files-search performance lane. They share `style_guide_files` and must remain serialized in the sole governed lane.
- Browser source confirms the deployed page still uses legacy PostgREST filtering and exact counts, not the new v2 search function: `src/pages/popsg/PopSGLibraryPage.tsx:617-705`. The 3-second QA validates the present customer experience but cannot be relabeled as v2 acceptance.
- Bridge self-update safety is deliberate: `apps/bridge-agent/src/index.ts:1730-1805` discovers a Compose file and otherwise preserves the running container. The supported reference mount and path are in `deploy/synology/docker-compose.yml:11-26`. A host/project refresh, not an ad hoc container rewrite, is the missing adoption prerequisite.
- The production project and all committed evidence are sanitized. Licensed filenames, full paths, credentials, raw browser payloads, cookies, and screenshots must never enter chat, commits, or public issue comments.
- Because this session only observed/routed shared-db work, no shared-db `HANDOVER:` issue is required. The existing active orchestrator owns all structural work.

## 6. Exact next steps

1. Start by reading `AGENTS.md`, the complete plan and STATUS table, this handoff, then the predecessor handoff and only its routed documents. Run `git status --short --branch`, fetch, and compare issue states. **You'll know it worked when:** the current `main`, #107, #2792, #2860, #2927, #2937, and #2945 states are written into a new status/drift note without overwriting another session's work.
2. Do not author shared-db changes. Watch orchestrator #2927's outcomes for #2792 and #2860; verify any merged/prod claim against its normal preview-first ledger and a natural service-role call under the existing ceiling. **You'll know it worked when:** the issues themselves carry production proof that bounded reconciliation, PDF claim/count, and default-v2 search all finish under the normal limit, with no timeout increase or row deletion.
3. After #2792 acceptance, resume only the existing authenticated PopDAM PDF job and wait for its terminal authoritative remaining count of zero. Then start exactly one authenticated PopSG PDF extraction job and wait for its terminal result. **You'll know it worked when:** both corpora have separate terminal extracted/failed/skipped accounting and no concurrent/duplicate worker.
4. After #2860 production proof, implement the smallest app cutover from the direct legacy reads at `PopSGLibraryPage.tsx:617-705` to the governed v2 search contract. Test filters-before-pagination, ranking, counts/facets, zero results, errors, and authorization; deploy normally. **You'll know it worked when:** signed-in production QA proves v2 search and filter parity without console/HTTP errors and records the deployed SHA.
5. Obtain the owner-approved protected Admin test identity, then prove healthy, reconciling, completed, failed/attention states and preview/PDF cards in Settings. **You'll know it worked when:** the Admin page returns no unexpected authorization or application errors and records only aggregate/sanitized evidence.
6. For bridge `1.16.12`, do not use the exposed key. When a protected, approved administrator path exists, refresh the Container Manager project so the read-only Compose mount is present, invoke the normal update, and verify image/version, Compose ownership, zero restart growth, heartbeat continuity, and rollback preservation. **You'll know it worked when:** edge2 reports `1.16.12` through its production heartbeat and the bridge remains Compose-managed; no NAS content changes occur.
7. Re-read downstream plan phases after each accepted phase and append dated drift/evidence. Preserve the three existing ordinary crawl proofs; after structural changes requiring it, wait for the plan-required fresh ordinary nightly crawl rather than triggering one. **You'll know it worked when:** every plan STATUS row has current evidence and no manual crawl is counted as acceptance.
8. Complete final acceptance, update `verification/popsg-readiness/final-acceptance.md` and only affected operating docs, close #107, then retire the predecessor handoffs and this handoff in the finishing commit under the successor rule. **You'll know it worked when:** #107 is closed, every delivered behavior has live evidence, and no PopSG readiness handoff remains.

## 7. Constraints and gotchas in force

- No timeout increase, destructive NAS/database action, raw licensed evidence, competing crawls/backfills, or competing shared-db orchestrator.
- Read broad NAS data only on edge2; write-side PopDAM activity belongs on edge1. Style Guides content is never written by this workstream.
- Shared-db changes are branch/PR/preview-first in `/worksp/shared-db`; PopDAM's mirrored `shared-db/` and historical `supabase/migrations/` are not authoring locations.
- Preserve concurrent work: stage only owned paths, fetch before push, never broad-reset/pull/delete another session's state. App commits go directly to `main`; shared-db follows its own branch/PR rules.
- Treat green CI, a deployment stamp, and HTTP 200 as signals only. Required proof is behavior in production plus correct live backend/bridge state.
- Do not reuse or disclose the compromised SSH key. Do not rotate it without Albert's explicit authorization; do not invent a workaround that changes the NAS directly.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants`; Git identity is verified as Albert Hazan. GitHub issue reads and ordinary app commits/pushes work.
- The protected signed-in production browser QA path works for ordinary PopSG browsing/search. Its credentials are kept in 1Password vault `vibe_coding`; never extract them to commands, chat, logs, or files.
- Production bridge heartbeat reads were available through protected application access. The desired bridge image is `ghcr.io/u2giants/popdam-bridge:stable`; no direct NAS write/update was performed in this closeout.
- SSH direct administration is intentionally unavailable to this session after the key exposure. The failed sub-agent accessed no NAS state beyond its initial safe checks and made no production mutation.
- Shared-db worktree was not edited. No shared-db migration, preview environment, production promotion, or data write was initiated here.

## 9. Open questions and risks

- **Key exposure (2026-09-15):** the user declined rotation because the key has approximately 50 dependencies. This remains a security risk. A later owner-approved migration plan must enumerate dependents, add a replacement credential, prove each consumer, and only then revoke the old key; until then, do not use or echo it.
- **Governed production proof:** PR #2933 is merged but #2792 remains open with #2937; never infer production repair from merge status. #2860's #2945 claim was dispatched moments before this closeout and has no outcome yet.
- **Search scope:** app source is still legacy search. Even once #2860 succeeds, a deployment and production customer QA are still required before search phase 8 is complete.
- **Bridge adoption:** v1.16.12 is published but edge2 remains v1.16.11. The missing Compose mount must be established through a protected, supported project update; direct container surgery would repeat the incident class the updater prevents.
- **Final Admin proof:** the non-Admin account's 403s are expected for its role but mean the Admin acceptance is genuinely missing, not a cosmetic gap.

## Part (b) — dispatched sub-agent record

### `/root/edge2_bridge_update`

- **Asked:** SSH to edge2 and update the PopSG bridge to 1.16.12 using the safe Compose-owned mechanism.
- **Actually did:** performed initial capability checks and identified that `ahazan` did not have the Docker socket/noninteractive sudo capability required for the update. It did not recreate, stop, rename, delete, or modify a container, Compose project, NAS file, database row, or service.
- **Security outcome:** while reading 1Password item metadata to locate the user-directed SSH key, the tool rendered its private key material despite a non-reveal request. The agent was immediately interrupted; it made no SSH connection after that exposure. No branch, PR, worktree, or external issue was created by the sub-agent.
- **Deliberately did not do:** it did not bypass Compose, enable sudo, change host access, use unmanaged Docker, or attempt the update after the exposure. Those actions remain prohibited unless the owner supplies a new protected authorization path.

## Mandatory self-audit — final pass

1. **Yes.** A new developer can continue without asking for missing technical context: §§1–3 identify the product, scope, production state, evidence, code locations, and issue/claim states; §6 gives ordered gates.
2. **Yes.** It preserves the session's material knowledge: §4 records failed paths, §5 explains the separate database/legacy-app/Compose causes, and §§7–9 preserve safety, access, and risk context.
3. **Yes.** Background and intent are in §§1–2; current deployed state/evidence in §3; dead ends in §4; findings in §5; executable verified actions in §6; constraints/access/risks in §§7–9; and the dispatched-agent outcome is in part (b).
4. **Yes.** A line-by-line owner-decision sweep found only the compromised-key handling and final Admin identity. Both are consolidated in §0 with recommendations, what each blocks, and the explicit instruction not to re-ask settled constraints.

All ten required sections are present, every next step has a verification gate, secrets are location-only, and the sub-agent record includes scope, findings, termination, and deliberate non-actions.
