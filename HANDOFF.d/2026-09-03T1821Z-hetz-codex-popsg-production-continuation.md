---
issue: 107
status: OPEN
owner: codex/popsg-production-readiness-107-20260903
---

# HANDOFF — PopSG production-readiness implementation continuation (2026-09-03 18:21Z, hetz/codex)

Canonical plan: [`plan_popsg_production_readiness.md`](../plan_popsg_production_readiness.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking later, not now

- No owner decision blocks the next safe work. Shared-database issue [u2giants/shared-db#2212](https://github.com/u2giants/shared-db/issues/2212) is waiting behind the one active shared-db orchestrator marker, [#2193](https://github.com/u2giants/shared-db/issues/2193). The next session must wait for that marker to close and then use the shared-db orchestrator; it must not start a competing migration session.
- Before the first shared-database production promotion or PopSG data reconciliation, follow the exact approval gate in `/worksp/shared-db/AGENTS.md`. Albert's request in this task authorizes the complete plan through production acceptance, but if that runbook requires a fresh proof-bound approval, present one consolidated request containing the preview results, exact candidate count, target-project proof, rollback export, and stop conditions. Recommendation: proceed only when every gate is green; this blocks the first production database/data write, not preview implementation.

### Recoverable / not blocking

- Stopped pre-recovery bridge containers remain on both NAS hosts as rollback evidence. They consume storage but are harmless while stopped. Recommendation: retain them through the first accepted ordinary nightly crawl; any later targeted deletion is separate cleanup and is not authorized by this plan.

### Already settled — do not re-ask

- 2026-09-03: PopSG contains the eligible creative-file subset of the Style Guides share, not every raw NAS object. The shared allow-list is AI, PSD, EPS, PDF, TIF/TIFF, JPG/JPEG, and PNG.
- 2026-09-03: use `edgesynology2:/volume1/styleguides` as the read-side source. Do not write, move, rename, or delete NAS content.
- 2026-09-03: stale database rows are inactivated, never deleted; a later sighting reactivates the same path row.
- 2026-09-03: do not increase timeouts. Reconciliation must be bounded, checkpointed, idempotent, and truthful.
- 2026-09-03: PopSG PDFs require their own incremental text pipeline; the PopDAM asset PDF table is not comprehensive PopSG coverage.
- 2026-09-03: raw licensed filenames and paths stay only under git-ignored `.private/popsg-readiness/`; committed evidence contains aggregates and non-reversible hashes only.
- 2026-09-03: accepted Edge responses retain `ok: true` and add fields only, so old bridge clients remain compatible.
- 2026-09-03: do not start a competing crawl, render loop, PDF backfill, or database orchestrator. Three acceptance proofs must be ordinary nightly crawls.
- 2026-09-03: temporary passwordless Docker sudo has been removed from both NAS hosts. Do not restore it unless an active incident truly requires it, and remove it immediately afterward.

The next session should show Albert the whole blocking-later proof request in one message only when that gate is actually reached. Nothing in §§1–9 needs another owner ruling before then.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager. PopSG is its style-guide mode, served by the same React/Vite frontend at `https://sg.designflow.app`. PopSG inventories eligible creative files from the Style Guides share on the read-side Synology NAS, creates previews, and lets authenticated staff browse, filter, and search licensor material.

The application repository is `u2giants/popdam3`, checked out at `/worksp/popdam`, branch `main`. The canonical shared Supabase schema repository is `u2giants/shared-db`, checked out at `/worksp/shared-db`; all structural database work uses its branch/PR/preview workflow. Production Supabase is Virginia project `qsllyeztdwjgirsysgai`; retired Ohio project `ryltkzzernhwnojzouyb` must never be used. The frontend runs through Coolify at `dam.designflow.app` and `sg.designflow.app`. The bridge image is `ghcr.io/u2giants/popdam-bridge:stable`; NAS reads run on `edgesynology2`, while write-side PopDAM behavior belongs on `edgesynology1`.

## 2. What we set out to do this session, and why

Albert asked to execute every open phase of [`plan_popsg_production_readiness.md`](../plan_popsg_production_readiness.md), tracked by [popdam3#107](https://github.com/u2giants/popdam3/issues/107), through deployment, three ordinary nightly crawl proofs, signed-in production QA, issue closure, documentation, and handoff retirement.

The production-readiness investigation had shown that PopSG was not yet truthful or comprehensive: an unbounded stale-row update and aggregate refresh timed out, but the crawl was still recorded as complete; active database paths did not match the exact eligible NAS set; previews/PDF extraction were incomplete; and search did not span path, metadata, tags, and PopSG PDF text.

This session completed Phase A's baseline and routed database work, built application-side Phase B scaffolding, and then handled a bridge deployment incident caused by the new shared eligibility contract. The session is ending because its context became too long, not because issue #107 is finished.

## 3. Current state — what is true right now

### Plan status

The authoritative STATUS table is at [`plan_popsg_production_readiness.md:6`](../plan_popsg_production_readiness.md#status--read-this-first):

- Step 1 is complete. The exact-contract baseline artifact is `verification/popsg-readiness/baseline-2026-09-03T164944Z.json`; the reusable collectors are `scripts/popsg-readiness-baseline.mjs` and `scripts/popsg-readiness-nas-scan.py`.
- Step 2 is in progress. Shared-db issue #2212 is OPEN, labeled `db-work`, and unassigned. Active orchestrator marker #2193 is OPEN because it still has live sub-agents; do not compete with it. No migration, preview PR, merge, or production ledger proof exists yet.
- Step 3 is in progress. State/drop-guard helpers and bridge continuation compatibility are committed, but the production completion handler still uses the old false-green, unbounded RPC flow at `supabase/functions/agent-api/index.ts:2894-2980`. The helpers cannot be wired fully until #2212 supplies the governed database contract.
- Step 4 is open. No ghost row was inactivated or deleted.
- Step 5 is open. No Admin lifecycle/alert UI has shipped.
- Step 6 is partial. Only the aggregate baseline and wording correction landed; post-reconciliation classification/retry work remains.
- Steps 7–10 are open: dedicated PopSG PDF text, unified search/filters, production acceptance, documentation/closure/retirement.

### Baseline evidence

The 2026-09-03 exact-contract read found 216,332 eligible NAS files and 226,390 active database rows: 1,560 NAS-only and 11,618 database-only path keys, for a net database excess of 10,058. These counts replaced the older 8,309 estimate and are dated, not constants. The same artifact recorded 23,358 actionable PopDAM PDF items, 734 resolved and 87 unresolved source links, and no dedicated PopSG PDF extraction table/queue. No row set is safe to inactivate by age alone. Details and downstream drift are recorded at `plan_popsg_production_readiness.md:23-29`.

The 30-run guard artifact is `verification/popsg-readiness/crawl-guard-baseline-2026-09-03.json`. Across 2026-08-04 through 2026-09-02, ordinary `files_found` ranged 218,660–219,992; the recommended initial attention guard is a per-root accepted-row drop of either at least 1,000 or at least 1%. The shared-db implementation must evaluate accepted rows, not the bridge's pre-server `files_found` count.

### Landed code and commits

All work is on `main` and pushed to `origin/main` through `ef071689`:

- `546142fb`: shared eligibility JSON contract, exact-contract collectors, baseline artifact, evidence rules.
- `5740013c`, `112e1b26`: crawl lifecycle/drop-guard helpers and five focused state tests in `supabase/functions/_shared/sg-crawl-state.ts:1-58`.
- `c8f537df`: bridge bounded continuation support in `apps/bridge-agent/src/sg-crawl-continuation.ts:1-24` and `apps/bridge-agent/src/style-guide-crawler.ts:165-187`; legacy `{ok:true}` remains accepted.
- `624c906b`, `3c69f55a`: JSON ESM loader correction plus Docker runtime packaging/import verification.
- `751f0a5d`: 30-run crawl-guard evidence.
- `6ca879e7`: fail-safe bridge update behavior, v1.16.11, four deployment-safety regressions, and durable incident documentation.
- `cceeba10`, `ef071689`: production acceptance evidence for both NAS bridge recoveries.

The reference updater at `deploy/synology/update.sh:1-35` validates Compose, recreates only `bridge-agent`, waits 45 seconds, checks zero restarts plus Compose ownership, and restores the prior image if verification fails. `apps/bridge-agent/src/index.ts:1730-1806` no longer falls back to unmanaged `docker run`; a missing Compose file fails visibly and preserves the current container. Read-only mounts are reported without topology mutation at `apps/bridge-agent/src/index.ts:1812-1827`. Regression coverage is in `src/test/bridge-deployment-safety.test.ts:7-33`.

### Live deployment state

- `edgesynology1`: v1.16.11, build `6ca879e7e23d6e0eacec55f9e8e460afbbb4fca0`, Compose-managed, restart count zero during acceptance, consecutive heartbeats, production agent identity preserved. Its PopDAM mount is writable and Style Guides remains read-only.
- `edgesynology2`: the old detached bridge had reached 75 restarts on the broken JSON-loader image. It was stopped and preserved as `popdam-bridge-detached-20260903`; existing stopped rollback containers were not deleted. The replacement started at `2026-09-03T18:16:07Z` on v1.16.11/build `6ca879e7...`, Compose project `popdam`, restart count zero, successful cloud registration, and consecutive heartbeats. Outlook's last edge2 stop alert was at `18:15:40Z`, before the replacement started. Host uptime was 15 days, proving the NAS itself had not rebooted.
- Edge2 intentionally mounts `/volume1/mac` and `/volume1/styleguides` read-only. v1.16.11 logs a nonfatal read-only warning for the PopDAM mount, then registers and becomes ready. Do not “fix” the read-side NAS by making it writable. PopSG crawl roots come from cloud `STYLE_GUIDE_SCAN_ROOTS`, not the startup `SCAN_ROOTS` log.
- Temporary `/etc/sudoers.d/ahazan-docker` rules were removed from both NAS hosts. After invalidating sudo tickets, `sudo -n /usr/local/bin/docker ps` failed on both, which is the expected removal proof. Disabled backup copies under each PopDAM compose directory contain only the former sudo rule and are mode 600.

### Verification completed at closeout

- `apps/bridge-agent`: `npm test` — 9/9 passed; `npm run build` — passed.
- Root focused tests: `npm test -- --run src/test/bridge-deployment-safety.test.ts supabase/functions/_shared/sg-crawl-state.test.ts` — 9/9 passed across two files.
- Commit `6ca879e7` GitHub Actions: CI, shared-db guard, DB-bypass guard, frontend publication, and bridge publication all completed successfully. Bridge production runtime reports the exact build SHA.
- Documentation-only commit `ef071689` is pushed. Issue #107 contains the edge2 recovery evidence comment.

## 4. Everything we tried that did NOT work

1. The first eligibility-contract build (v1.16.7/v1.16.8) imported JSON as ESM without the required import attribute. Node 20 crashed at startup. The code worked in a source-tree test context but not in the actual runtime module loader.
2. v1.16.9 switched to `createRequire`, but the production Docker runtime omitted `sg-eligibility-contract.json`. The image then crashed with `Cannot find module './sg-eligibility-contract.json'`. The durable fix copies the JSON into `dist` and imports the built module during Docker build; do not remove that clean-image check.
3. The old in-agent updater fell back to creating an unmanaged `docker run` container when it could not find Compose. This detached the bridge from Compose labels and later produced name conflicts. That fallback is removed; missing Compose now stops visibly.
4. Repeated `docker compose up --force-recreate` against a detached container produced `container name /popdam-bridge is already in use`. Recovery required stopping and renaming the exact detached container first, then recreating only the Compose service. Never use `compose down` or delete rollback containers to resolve this.
5. The repository reference Compose initially included CPU controls that Synology's kernel exposes as unsupported NanoCPU/CFS settings. Container creation failed. The reference now omits `cpus`; do not reintroduce it.
6. The first edge1 recovery assumed `/volume1/docker/popdam` already existed and then used a stale February environment backup that pointed to obsolete Supabase project `vklanxwmaeqjbwtmnygj`. The live container had to be rebuilt with the preserved current production identity and Virginia endpoint. Never infer a host layout or endpoint from an old backup; inspect first and prove the target.
7. A read-only PopDAM bind caused the prior self-heal code to mutate container topology. The current code reports the condition and continues; it never strips `:ro`. Edge2 is deliberately read-only, while edge1 is the write side.
8. Initial incident attention remained on edge1 because the first report named it. Outlook later proved the continuing alerts were from edge2. Future incident diagnosis must identify the sender/hostname from the alert before changing a host.
9. A 45-second SSH verification command returned no output because the remote command path ended at the client's ordinary execution window. An immediate follow-up inspect showed the container stable. Do not increase production/NAS timeouts; use bounded polling or a fresh read.
10. The first attempt to remove the temporary sudo rule tested `/etc/sudoers.d` as the unprivileged user, falsely concluding the file was absent. The final removal used the already-authorized Docker command to mount the exact sudoers directory, move only `ahazan-docker`, invalidate credentials, and prove noninteractive sudo failed. On edge2 the first cleanup container accidentally used the image's application entrypoint; rerunning with `--entrypoint sh` completed the targeted removal.
11. The original raw NAS `find` baseline included Synology metadata and exposed one inaccessible `@eaDir`; it was not the acceptance oracle. The corrected collector reuses the exact eligibility contract, runs as a durable bounded read, and keeps raw paths private.
12. Starting the PopDAM PDF backfill was considered but not done because 119 ordinary Windows render jobs were already claimed. Starting another loop would violate the no-competing-backfill rule.

## 5. Root causes and key findings

- Production false-green behavior still exists at `supabase/functions/agent-api/index.ts:2894-2980`: it writes `completed` at lines 2932-2937 before calling unbounded `deactivate_stale_sg_files`, logs cleanup failure at 2944-2949 without changing status, writes the admin request as completed at 2954-2963, and treats aggregate refresh failure as best effort at 2965-2973. The Phase B helper is scaffolding, not the repair by itself.
- The database/NAS mismatch is larger than the initial investigation suggested. Same-window exact path keys, not age or latest crawl ID alone, must drive any reversible inactivation.
- Bridge discovered count and server accepted count are different. Server filtering drops noneligible rows, so lifecycle counters must persist discovered, received, accepted, rejected, stale candidates, deactivated, remaining, and aggregate freshness separately.
- `apps/bridge-agent/src/sg-ingest-filter.ts:16-33` and `apps/bridge-agent/src/style-guide-crawler.ts:40-55,95-159` now share one eligibility JSON contract. Keep the server and shared-db render contract synchronized with it.
- Bridge continuation is deliberately backward compatible: `apps/bridge-agent/src/sg-crawl-continuation.ts:13-23` treats missing state/legacy `{ok:true}` as complete, continues only bounded active states, caps retry delay at 30 seconds, and stops failed/attention-required responses.
- Production deployment success cannot be inferred from one green badge. The bridge required clean Docker-image publication plus live image SHA, Compose labels, restart count, heartbeats, and alert cessation on both NAS hosts.
- The continuing email “storm” was container-stop alerts, not NAS reboot alerts. Edge2 uptime was 15 days.
- Live NAS Compose files have host-specific differences. The repository reference uses `/volume1/nas-share`; edge1 actually uses `/volume1/mac`, and edge2 uses `/volume1/mac:ro`. Never copy the reference blindly onto either host.
- Edge2's `.env` does not set `SUPABASE_ANON_KEY`, so its bridge logs heartbeat-only mode with commands delayed up to 30 seconds. This was pre-existing and did not cause the restart loop.
- Shared-db issue #2212 remains unclaimed because orchestrator marker #2193 is still coordinating other live work. The absence of an assignee is not permission to create a migration directly.

## 6. Exact next steps

1. Start from `/worksp/popdam`: read `AGENTS.md`, the STATUS table and entire `plan_popsg_production_readiness.md`, this handoff, predecessor `HANDOFF.d/2026-09-03T1600Z-hetz-codex-popsg-production-readiness.md`, and only the extra documents those route. Run `git status --short` in PopDAM and `/worksp/shared-db`. **You'll know it worked when:** both worktrees and the current issue/marker states are recorded without overwriting another session's work.
2. Check shared-db marker #2193. While it is OPEN, do not start an orchestrator or author structural work; continue only independent, noncompeting app-test scaffolding that the plan explicitly permits. When #2193 closes, load `codex-shared-db-change` and `shared-db-orchestrator`, open the single orchestrator for issue #2212, and follow `/worksp/shared-db/AGENTS.md`. **You'll know it worked when:** one dedicated shared-db branch/PR owns the lifecycle, bounded reconciliation, aggregate, PopSG PDF, and search contracts, with no second orchestrator marker.
3. In shared-db preview, implement plan §§9.3 and 9.5 first: deterministic bounded stale candidates/inactivation, durable continuation state/counters, least-privilege grants, and the 1,000-or-1% accepted-per-root guard. Prove representative-volume indexes with `EXPLAIN (ANALYZE, BUFFERS)`, interruption/resume, retry no-op, forced timeout, and guarded-drop fixtures. **You'll know it worked when:** preview runs cannot become completed while work remains or aggregates are stale, every batch stays below ordinary limits, and a guarded run changes zero active rows.
4. Merge and promote the shared-db contract only through its preview-first production gate; immediately prove production project `qsllyeztdwjgirsysgai` and migration ledger before any write. Allow generated consumer types to sync back normally. **You'll know it worked when:** the merged migration is installed in Virginia production, the ledger SHA matches, and no app-side migration was created.
5. Re-read plan Phases C–E, record drift, then wire `supabase/functions/agent-api/index.ts` to the governed contract and the existing lifecycle helpers. Keep accepted responses additive with `ok:true`; add forced-failure and exact prior-client fixtures. **You'll know it worked when:** cleanup/refresh failure yields failed or attention-required, continuation resumes after interruption, and the prior production bridge client does not throw or loop.
6. Deploy Edge functions through the normal workflow, then verify bridge v1.16.11 or newer on both NAS hosts using the fail-safe updater path—never detached `docker run`. Do not start a crawl if one is queued/running. **You'll know it worked when:** Edge and bridge SHAs are recorded, both bridges remain Compose-managed with restart count zero, and heartbeats continue.
7. Let the next ordinary nightly PopSG crawl run. Capture same-window exact-contract NAS/database evidence and the full persisted lifecycle counters. If guarded, failed, or partial, diagnose without inactivation and wait for a later ordinary run. **You'll know it worked when:** one ordinary crawl reaches completed only after remaining=0 and aggregates are fresh, with zero inaccessible roots and no unexplained counter differences.
8. Execute plan §9.6's one-time reversible ghost-row repair only after the accepted same-window crawl and proof packet. Export exact candidate IDs/keys privately, prove target again, inactivate in bounded batches, and retain rollback evidence; never delete rows. **You'll know it worked when:** active DB paths equal eligible NAS paths except a documented moving-window ledger, and every changed row can be reactivated from the export.
9. Implement Admin lifecycle/drop visibility and preview classification/retries in plan §§9.7–9.8. Re-read downstream phases and update STATUS/evidence after each landed phase. **You'll know it worked when:** signed-in Admin distinguishes ingesting/reconciling/refreshing/completed/failed/attention-required, exposes every counter and excluded reason, and every active file has a preview, active queue/retry, or reviewed terminal exception.
10. Finish the existing PopDAM source/PDF work only after ordinary render claims drain, then build the separate serialized PopSG PDF extraction pipeline from #2212. Do not run competing crawls/backfills. **You'll know it worked when:** PopDAM and PopSG report separately, every active PopSG PDF has current extracted text or an accepted terminal reason, and source-resolution coverage meets plan §9.9.
11. Implement plan §9.10's authorized server-side search and filters across path/name, guide metadata, active tags, and dedicated PopSG PDF text, with filters before pagination and counts/facets from the same authorized result set. **You'll know it worked when:** contract/performance tests pass and signed-in production QA proves ranking, filter parity, pagination, zero-result, error, and fallback behavior.
12. Run plan §9.11 acceptance across three consecutive ordinary nightly crawls—no manual “proof” crawl. Verify no false-green state, unexplained ghosts, unsafe drops, or parallel work; verify signed-in production UI and deployed SHAs. Update `verification/popsg-readiness/final-acceptance.md`, `docs/POPSG.md`, relevant deployment/configuration/quirk docs, and the plan STATUS. **You'll know it worked when:** every checklist item at `plan_popsg_production_readiness.md:433-453` is backed by live evidence.
13. Close issue #107 only after full acceptance, commit/push all owned documentation, and retire both PopSG handoffs under the successor rule. **You'll know it worked when:** issue #107 is CLOSED, all STATUS rows are complete, production SHAs match, the two PopSG handoff files are deleted in the completing commit, and both repos are clean.

## 7. Constraints and gotchas in force

- Do not re-plan completed decisions. The plan STATUS and drift blocks are authoritative; after each phase update them, re-read every downstream phase, record drift, and continue while safe authorized work remains.
- Never delete NAS files or database rows, expose licensed paths, increase timeouts, or run competing crawls/backfills/render loops.
- Structural shared-database work belongs only in canonical `/worksp/shared-db` through its branch/PR/preview workflow and the one active orchestrator. The `shared-db/` folder inside PopDAM is a read-only mirror; PopDAM's `supabase/migrations/` is historical/inert.
- Prove production project `qsllyeztdwjgirsysgai` immediately before every database write. Never use retired `ryltkzzernhwnojzouyb` or the obsolete bridge endpoint found during recovery.
- Preserve unrelated dirty files and other sessions' work. PopDAM ships directly to `main`; stage owned paths only. Shared-db uses a branch and PR, and the AI owns merge unless its rules say otherwise.
- Use edge2 for broad reads and edge1 for write-side PopDAM operations. Style Guides stays read-only everywhere. Do not make edge2's PopDAM mount writable to silence v1.16.11's warning.
- Do not copy the repository reference Compose blindly onto a NAS. Inspect exact live mounts, environment identity, Compose labels, image SHA, and host-specific paths first.
- Do not use `docker compose down`, unmanaged `docker run`, blind container deletion, or unsupported Synology CPU controls for bridge updates. Preserve a rollback container/image and verify 45-second stability.
- Raw evidence under `.private/popsg-readiness/` is git-ignored. Never print or commit filenames, full paths, row IDs, tokens, passwords, `.env` values, or signed URLs.
- Green CI/Railway is not universal deployment proof. Verify frontend, Edge, bridge, Windows agent, database ledger, authenticated UI, and ordinary nightly outcomes separately when each is in scope.
- A stale unrelated handoff exists: `HANDOFF.d/2026-08-27T2258Z-hetz-codex-orderlist-count-indexes.md` declares issue #100, which is now CLOSED, owner `codex/orderlist-count-indexes-100`. Do not edit it from this workstream; its rightful successor should verify obligations and retire it.

## 8. Access and environment

- Working directory: `/worksp/popdam`; branch `main`; `origin/main` is the code truth. At handoff creation, `ef071689` was pushed and the worktree was clean before adding this file.
- Git identity verified as `Albert Hazan <u2giants@users.noreply.github.com>`. GitHub CLI is authenticated for `u2giants`; issue #107 and shared-db issues #2212/#2193 were read successfully.
- SSH aliases `edgesynology1` and `edgesynology2` work as user `ahazan`. Docker now requires an interactive sudo password on both; this is intentional. Do not ask Albert to re-enable passwordless sudo merely for convenience.
- Outlook connector access works and was used read-only to identify the edge2 sender and verify the stop-alert timeline. No messages were changed or deleted.
- Production PopDAM/PopSG Supabase: `qsllyeztdwjgirsysgai` in Virginia. Follow `/worksp/shared-db/AGENTS.md` for the protected CLI/database path; secrets live in 1Password vault `vibe_coding`, never in docs or command arguments.
- Private licensed-path artifacts: `/worksp/popdam/.private/popsg-readiness/` only. Commit-safe summaries: `/worksp/popdam/verification/popsg-readiness/`.
- Signed-in final QA requires a production administrator entitled to `styleguides`. Use the authenticated browser path named by the plan; do not substitute anonymous HTTP checks for customer-visible acceptance.
- No team sub-agents were spawned in this Codex session. Shared-db #2212 was routed to the external single-orchestrator queue, but no migration sub-agent/branch/PR was created by this session.

## 9. Open questions and risks

- **Shared-db scheduling, 2026-09-03:** #2212 is OPEN/unassigned while marker #2193 is OPEN coordinating four other agents. This is a queue state, not a design blocker. Starting another orchestrator would risk duplicate/conflicting migrations.
- **Moving source, 2026-09-03:** the 216,332/226,390 counts are a timestamped snapshot. Only same-window exact path reconciliation after an accepted crawl can authorize inactivation.
- **Database design choices, 2026-09-03:** batch size and aggregate maintenance method remain implementer judgment under preview performance evidence. Compare concurrent materialized-view refresh with required unique indexes versus incremental summaries; reject any option that cannot finish comfortably below ordinary limits.
- **Search design, 2026-09-03:** extend an existing RPC or add a PopSG-specific document/RPC based on the smallest governed shape that supports authorization, combined ranking, filter parity, facets, and bounded maintenance. Do not move filtering to the browser.
- **Preview policy, 2026-09-03:** terminal categories must be derived from representative current errors. Retry recoverable cases; do not infer corruption solely from retry count or loop forever on terminal files.
- **Capacity contention, 2026-09-03:** 119 ordinary Windows render jobs were already claimed when PDF backfill was considered. Recheck queue ownership before any PDF work and serialize the PopSG pipeline.
- **Bridge topology, 2026-09-03:** live NAS Compose configurations differ from the repository reference. Edge2's read-only warning is expected, but future self-update behavior must still be verified through Compose labels and restart counts.
- **Rollback evidence, 2026-09-03:** stopped bridge recovery containers remain by design. Deleting them too early removes the quickest incident rollback; leave them until the acceptance gate in §0.
- **Evidence exposure, 2026-09-03:** one failed early collector rendered a licensed relative path into the private Codex transcript. No licensed path was committed; `verification/popsg-readiness/evidence-handling-incident-2026-09-03.md` records the correction. Keep all future raw output in ignored files rather than tool/chat streams.

## Mandatory self-audit — final pass

1. **Yes — a brand-new developer can continue without asking a question.** §§1–3 define the product, repositories, production targets, exact implementation/deployment state, commits, and live evidence; §6 gives the ordered continuation from the shared-db queue through issue closure.
2. **Yes — the handoff preserves everything needed to continue as effectively as this session.** §4 records twelve failed approaches and their failure modes; §5 records the non-obvious database, eligibility, deployment, alert-source, Compose, and orchestrator findings; §§7–9 preserve constraints, access, and risks.
3. **Yes — background, goal, outcome, current state, failures, decisions, constraints, risks, exact actions, and verification are all present.** These map respectively to §§1–3, §4, §§0/5, §7, §9, §6, and §3's verification subsection. No gap remained after the final reread.
4. **Yes — Albert can read only §0 and see every decision needing him.** The line-by-line sweep of §§1–9 found one possible later approval: the shared-db production/data-write gate, which appears in §0 with a recommendation and what it blocks. The retained rollback containers, no-competing-work rule, NAS/database deletion bans, private evidence, API compatibility, and temporary-sudo removal are also explicitly settled in §0 so they are not re-asked. The shared-db queue, design tradeoffs, capacity risk, stale unrelated handoff, and read-only topology require implementer action under existing rules, not owner judgment.

All 10 required sections are present; every next step has a verification gate; commit/push/deploy status is explicit; secrets are referenced only by approved location; and no sub-agent appendix is required because this session spawned none.
