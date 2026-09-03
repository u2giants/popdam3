# PopSG Production Readiness and NAS Fidelity Plan

Issue: [u2giants/popdam3 #107](https://github.com/u2giants/popdam3/issues/107)
Handoff: [HANDOFF.d/2026-09-03T1600Z-hetz-codex-popsg-production-readiness.md](HANDOFF.d/2026-09-03T1600Z-hetz-codex-popsg-production-readiness.md)

## STATUS — read this first

| Step | Status | Evidence |
|---|---|---|
| 1. Freeze the acceptance contract and baseline | ✅ complete | `verification/popsg-readiness/baseline-2026-09-03T164944Z.json`; reusable exact-contract collector; edge2 job exit 0 with zero inaccessible paths; private path evidence remains git-ignored |
| 2. Route and ship the shared-database contract | 🟨 in progress | Routed as `u2giants/shared-db#2212` to active orchestrator marker #2193; migration/preview/merge/production proof pending |
| 3. Make crawl completion truthful and restart-safe | 🟨 in progress | Lifecycle/drop-guard helpers, restart run reuse, additive old/new response handling, and 14 focused tests; bridge v1.16.10 is production-stable after clean-image packaging repair; 30-run guard evidence in `verification/popsg-readiness/crawl-guard-baseline-2026-09-03.json`; dependent RPC orchestration and forced-failure integration pending shared-db #2212 |
| 4. Reconcile the current ghost rows safely | ⬜ open | Before/after candidate export and live NAS/database parity report |
| 5. Add crawl regression protection and operator visibility | ⬜ open | Admin screenshots and alert/failure tests |
| 6. Finish and classify preview coverage | 🟨 in progress | Preliminary aggregate-only classification in `verification/popsg-readiness/preview-classification-baseline-2026-09-03.json`; misleading format copy fixed; post-reconciliation classification/retries pending |
| 7. Finish searchable PDF/source coverage | ⬜ open | Backfill completion and source-resolution coverage artifact |
| 8. Build comprehensive PopSG search and filters | ⬜ open | Search contract tests plus signed-in production browser evidence |
| 9. Run full production acceptance | ⬜ open | `verification/popsg-readiness/final-acceptance.md` |
| 10. Land, document, and retire the workstream | ⬜ open | Merged commits, deployed SHAs, updated docs, closed #107, deleted handoff |

**Fresh-session start:** begin at step 1. No implementation has started. Before each phase, re-read all downstream phases and update this table; at each marked context cut, use the `fresh-session` skill.

**Execution drift — 2026-09-03 16:49Z:** the first exact-contract re-baseline found 216,332 eligible NAS files and 226,390 active database rows, with 1,560 NAS-only and 11,618 database-only path keys. This is a 10,058 net excess, 1,749 above the earlier dated estimate, and 3,190 database-only rows were recorded by the latest crawl. Therefore no current row set is safe to inactivate from age alone; Phase C remains gated on the new bounded contract plus a fresh accepted same-window crawl. The baseline also confirmed 23,358 actionable PopDAM PDF items remaining, 734 resolved/87 unresolved source links, and no dedicated PopSG PDF pipeline in the current schema. One failed collector attempt rendered one licensed relative path in the private Codex transcript; the committed incident note records the streaming fix. All downstream phases were re-read after this finding; their order and gates remain valid.

**Execution drift — 2026-09-03 17:50Z:** bridge v1.16.7/1.16.8 entered a production restart loop because the first shared eligibility contract used a JSON ESM import; v1.16.9 fixed the loader but the clean runtime image omitted the JSON artifact. v1.16.10 now copies and imports the contract during the Docker build, and all nine bridge tests pass. The failed self-update also removed the prior unmanaged container configuration on `edgesynology1`; it was rebuilt from the preserved environment, re-registered as the existing production `synology-bridge-1`, corrected from an obsolete Supabase URL to Virginia, and restored with `/volume1/mac` mounted at `/mnt/nas/mac`. At acceptance, it was Compose-managed with restart count zero and consecutive production heartbeats on build `3c69f55a692672582d43d9d6c863ea8097f9a713`, with no reported agent error. Recoverable stopped container/config backups remain; no NAS or database records were deleted. The downstream order and database gates are unchanged.

## 1. The ultimate goal

PopSG must be a trustworthy, current production library of every **eligible creative file** in POP Creations' canonical Style Guides NAS share. A user must be able to browse, filter, and search that library without seeing files that no longer exist, silently missing eligible files, or being told a crawl succeeded when reconciliation failed. Every technically previewable file must either have a useful preview or a visible, classified exception. Search must cover paths, guide metadata, curated tags, and text extracted directly from active PopSG PDF files.

“Comprehensive copy” does **not** mean copying file bytes into PopSG or indexing every NAS object. The locked eligible set is the existing creative-file allow-list: AI, PSD, EPS, PDF, TIF/TIFF, JPG/JPEG, and PNG. System folders, hidden files, shortcuts, fonts, archives, video, 3D, office documents, and other non-previewable formats remain excluded, but Admin must expose excluded counts by reason so the boundary is measurable rather than invisible.

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopSG is the style-guide mode of `u2giants/popdam3`, locally `/worksp/popdam`. It is a React/Vite frontend with Supabase Edge Functions, a Synology bridge crawler, a Windows render agent, and a shared hosted Supabase PostgreSQL database. The same frontend image serves PopDAM and PopSG; hostname selects mode.

- Production UI: `https://sg.designflow.app`
- Application repo and default branch: `u2giants/popdam3`, `main`
- Canonical shared schema repo: `u2giants/shared-db`, locally `/worksp/shared-db`; it uses branch + PR
- Production Supabase ref: `qsllyeztdwjgirsysgai` (Virginia). Never use retired `ryltkzzernhwnojzouyb`.
- Canonical read-side NAS: `edgesynology2`, `/volume1/styleguides`; the bridge sees it as `/mnt/nas/styleguides`
- Production frontend: Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`
- Bridge image: `ghcr.io/u2giants/popdam-bridge:stable`
- Windows agent: manually installed Windows render/PDF agent

Read `AGENTS.md`, `docs/POPSG.md`, `docs/KNOWN_QUIRKS.md` #23 and #46–#48, this plan’s linked handoff, and the STATUS table before editing. For schema/RPC/view/index work, also load `codex-shared-db-change` and `/worksp/shared-db/AGENTS.md`; non-orchestrator sessions route a fresh `db-work` issue rather than authoring structural work themselves.

## 3. What triggered this work

On 2026-09-03 Albert asked whether PopSG was production-ready and a comprehensive, filterable, searchable copy of the Style Guides NAS folder. Read-only production investigation found it was not.

The latest crawl (`979cb20f-ce82-4c6a-aba5-0818ff823e98`, 2026-09-02 22:00–22:09 America/New_York) reported completed with 219,992 files and no inaccessible roots. Production logs then recorded both:

- `Staleness cleanup failed: canceling statement due to statement timeout`
- `Matview refresh failed: canceling statement due to statement timeout`

Despite those failures, `handleCompleteStyleGuideCrawl()` wrote `status: completed`. The live database exposed 226,390 active files, of which 8,428 were not in the latest crawl. A direct, read-only crawler-equivalent inventory on `edgesynology2` found 218,081 currently eligible files. The latest crawl had indexed 217,962 of those; the 119 difference was files added after the nightly crawl. Therefore the current UI had 8,309 net ghost records relative to the live NAS.

Other live gaps at the same observation time:

- 218,712 active rows had previews; 7,677 were classified as render errors; one was queued without a preview.
- 23,353 eligible licensing/tech-pack PDFs still needed text extraction.
- 734 `sku_files_used` rows were resolved and 87 were unresolved.
- 226,298 active files had non-empty tag search text; 92 did not.
- Library search used guide/folder names in Guides mode and `relative_path` in Files mode, not a unified content search.

Counts are a dated baseline, not constants. Re-measure before implementation and preserve the new output as an artifact.

## 4. Scope

### In this plan

- Safe evaluation and inactivation of current ghost rows, with rollback evidence.
- A bounded, restart-safe stale cleanup contract that cannot exceed an Edge request timeout.
- Truthful crawl states: ingest, reconciliation, aggregate refresh, complete, failed/attention-required.
- Low-count/drop regression guards that prevent unsafe mass inactivation.
- Reconciliation counters, alerts, and Admin visibility.
- Preview-error classification, retries for recoverable errors, and explicit terminal exceptions.
- Completion of licensing/tech-pack PDF text extraction and source-file resolution.
- A separate incremental text-extraction pipeline for active PopSG PDFs, keyed to `style_guide_files`; the existing PopDAM asset backfill is not this corpus.
- Unified server-side PopSG search across path/name, guide metadata, active tags, and extracted PDF text where available.
- Filter parity, database-side pagination, ranking, counts/facets, signed-in browser verification, performance gates, deployment, documentation, and rollback.

### NOT in this plan

- Copying NAS file bytes into Supabase or replacing the NAS as source of truth.
- Indexing fonts, archives, video, 3D, office documents, hidden/system files, shortcuts, or Synology metadata as library items.
- Moving, deleting, renaming, or archiving any NAS file.
- Using `sg_archive_usage` to archive guides; archival remains blocked until source-resolution coverage is accepted separately.
- PopDAM asset search, Style Group metadata redesign, ERP, OrderList, Master Data, Seafile, or Helper behavior.
- Raising statement/Edge timeouts, disabling safety checks, direct production DDL, or a one-off dashboard SQL fix.
- Forcing all terminally corrupt or technically unsupported creative files to produce previews; those require honest exception labels.

## 5. Current state of the code

All code described here was on `main` at `f76c91ed0ded318afe4de3a9c01516b6a9f5d4ec` when investigated. Production frontend ran application commit `f82089bd71605b6a788146ebec0f7fa443622ba7`; the only later app-repo commit was generated Supabase types, so the PopSG UI source was current. Recheck both before implementation.

- `apps/bridge-agent/src/style-guide-crawler.ts:40-64` skips hidden/system names; `:88-123` recursively walks without following symlinks and admits only eligible extensions; `:125-167` emits normalized metadata.
- `apps/bridge-agent/src/sg-ingest-filter.ts:13-27` owns the client-side extension allow-list. Keep it synchronized with the server and database render contract.
- `supabase/functions/agent-api/index.ts:2789-2874` accepts crawl batches, filters again server-side, upserts by `(root_label, relative_path)`, preserves existing preview fields, and queues renders.
- `supabase/functions/agent-api/index.ts:2876-2962` marks a run complete **before** calling the single large `deactivate_stale_sg_files()` update; it logs cleanup/refresh errors but still writes the request as completed and returns success.
- Live `public.deactivate_stale_sg_files(text, uuid)` performs one unbounded update of all active rows not in the current run. It timed out in production.
- `src/pages/popsg/PopSGLibraryPage.tsx:566-613` holds current filters; `:615-656` queries grouped guides; `:658-703` queries active files. Search is direct `ILIKE` on guide/path fields.
- `src/pages/popsg/PopSGLibraryPage.tsx:710-805` exposes licensor, property, file type (Files mode only), preview status, sort, and paging.
- `src/pages/popsg/PopSGSettingsPage.tsx:790-805` loads preview statistics; `:994-1106` displays preview coverage; `:1108-1145` displays only coarse crawl status; `:1154-1160` exposes render errors/history.
- `style_guide_file_groups` and `style_guide_folders` are database-backed aggregates refreshed after a crawl. Their refresh also timed out.
- Nightly `nightly-sg-crawl` queues a crawl at 02:00 UTC. The crawl’s empty-root guard exists, but no low/nonzero regression guard exists.
- PDF extraction and source resolution already exist as described in `docs/POPSG.md:178-210`, but the backfill is incomplete.
- The existing `pdf_text_samples`/Windows backfill is keyed to PopDAM `assets`. The PopSG render path in `apps/windows-agent/src/index.ts:572-602` only uploads thumbnails; PopSG files do not yet have their own extracted-text store or extraction job.

No fix, cleanup, shared-db issue, migration, or application implementation has started. This plan, handoff, and issue #107 are documentation/tracking artifacts only.

## 6. Key findings and root cause

1. **Primary root cause:** stale cleanup is an unbounded database update inside an Edge completion request. Production statement timeout cancels it. Evidence: live function definition and 2026-09-03 Edge logs; call site at `agent-api/index.ts:2921-2933`.
2. **False-success root cause:** cleanup and aggregation refresh are treated as best-effort after the run is already marked complete. Errors are logged but never change run/request status; see `agent-api/index.ts:2913-2955`.
3. **The 8,309 are not merely “old-looking” rows:** 8,428 active rows had a different crawl ID; the live NAS contained 119 eligible files newer than last crawl. `226,390 - 218,081 = 8,309` net excess. Exact path reconciliation is still required before changing rows.
4. **`files_found` is misleading:** the bridge counted 219,992 candidates, while only 217,962 eligible rows bore the latest crawl ID. Server logs show many “Dropped unrenderable files” batches. Persist separate discovered, accepted/upserted, rejected, stale-candidate, deactivated, and aggregate-refresh counts.
5. **A raw `find` is not the acceptance oracle:** it includes `@eaDir`, hidden/system content, shortcuts, and unsupported formats. Use the crawler’s exact eligibility rules and path keys.
6. **Preview coverage and search coverage are different:** a missing preview should not make a file undiscoverable; extracted text and tags must remain searchable when available.
7. **A nightly delay is normal:** files added after the latest completed crawl are not ghosts. Acceptance compares the database to a same-window snapshot or a just-completed crawl, not a later moving NAS.
8. **The production target is confirmed:** all database findings came from `https://qsllyeztdwjgirsysgai.supabase.co`, not the retired Ohio project.
9. **PopSG PDF content search needs its own source:** joining PopDAM `pdf_text_samples` through the small `sku_files_used` set would cover only linked source references, not the active PopSG PDF corpus. The plan therefore creates an incremental PopSG PDF-text pipeline rather than pretending the existing backfill provides comprehensive coverage.

## 7. Approaches considered and rejected

- **Delete the 8,309 rows. Rejected.** Absence must be proven against the same successful crawl; inactivation is reversible and preserves thumbnails, tags, links, and audit history if a path returns.
- **Run the current cleanup RPC once more. Rejected.** The same unbounded update can time out again and provides no checkpoint or reliable completion evidence.
- **Increase the statement or Edge timeout. Rejected.** It masks an unbounded operation, violates standing rules, and does not make retries/restarts safe.
- **Treat cleanup and aggregate refresh as best-effort. Rejected.** Customer-visible truth depends on both. A crawl cannot be “completed” while ghosts or stale folder aggregates remain.
- **Trust `files_found` alone. Rejected.** It counts pre-server candidates and does not equal accepted/indexed rows.
- **Compare against every raw NAS file. Rejected.** PopSG intentionally excludes non-creative and non-previewable content; raw counts create false deficits.
- **Put new migrations in PopDAM or use Dashboard SQL. Rejected.** Shared database structure is governed by `u2giants/shared-db`.
- **Use browser-side filtering/search over downloaded rows. Rejected.** The corpus is over 200,000 rows; filters, authorization, ranking, counts, and paging must happen server-side.
- **Call PopDAM `pdf_text_samples` comprehensive PopSG content search. Rejected.** That table is keyed to PopDAM assets and only a small linked subset reaches PopSG through `sku_files_used`; it cannot search the PopSG PDF corpus.
- **Declare all render errors blockers. Rejected.** Some files are corrupt, missing, or technically terminal. Classify them and set an accepted exception policy; do not endlessly retry terminal cases.
- **Archive guides using current `sg_archive_usage`. Rejected.** The PDF/source backfill is incomplete, so apparent non-use is not reliable.

## 8. Design decisions

### Locked — do not relitigate

- **2026-09-03:** `edgesynology2:/volume1/styleguides` is the read-side source for inventory; never write to edge2 or move NAS content in this work.
- **2026-09-03:** stale records are marked inactive, not deleted. A new sighting reactivates the same `(root_label, relative_path)` row.
- **2026-09-03:** a crawl is complete only after ingest, guarded reconciliation, and aggregate refresh all succeed. A cleanup/refresh timeout is failure or attention-required, never green.
- **2026-09-03:** cleanup is bounded, checkpointed/idempotent, and restart-safe. No timeout increase.
- **2026-09-03:** preserve the existing eligible creative extensions and excluded system-name rules. Excluded formats are counted in Admin but do not become library rows.
- **2026-09-03:** database structure changes go through shared-db branch/PR/preview-first workflow; application row cleanup remains PopSG-owned data work after target proof.
- **2026-09-03:** search and filter before pagination; counts/facets describe the same authorized result set.
- **2026-09-03, GLM review incorporated:** PopSG gets a dedicated incremental PDF-text pipeline for every active PDF in `style_guide_files`. Store extraction text/status/error/content identity against the PopSG file; use the existing Windows extraction cascade where practical, but do not overload PopDAM `pdf_text_samples` or widen the PopDAM licensing/tech-pack backfill.
- **2026-09-03, GLM review incorporated:** licensed filenames, path inventories, and candidate-row exports live only under local git-ignored `.private/popsg-readiness/`. Committed `verification/popsg-readiness/` artifacts contain aggregate counts, hashes, commands, timestamps, redacted examples, and links/descriptions—never licensed paths.
- **2026-09-03, GLM review incorporated:** Edge/agent API changes are backward-compatible. Responses retain `ok: true` on accepted calls and add fields without changing/removing old ones. New Edge behavior must be proven against the prior production bridge client, and rollout must not expose an old agent to an incompatible response.
- **2026-09-03:** missing previews never remove otherwise eligible files from browsing/search.
- **2026-09-03:** do not archive NAS style guides under this plan.

### Open for implementer judgment

- Batch size for cleanup and aggregate maintenance technique. For aggregates, explicitly compare `REFRESH MATERIALIZED VIEW CONCURRENTLY` after adding/proving the required unique indexes versus incremental summary maintenance; reject the current blocking full refresh if it cannot meet the preview load/lock budget. Each operation must finish comfortably below production limits and resume safely.
- Search implementation shape: extend an existing RPC or add PopSG-specific search documents/RPCs. Choose the smallest governed design that supports combined path/metadata/tag/PDF-text ranking, authorization, filter parity, and bounded incremental maintenance.
- Alert transport. Reuse an existing PopDAM operational alert path if one exists; otherwise make Admin status unmistakable and open a separately scoped alert-integration issue rather than hard-coding a new provider.
- Terminal preview classification thresholds. Derive them from current error codes and representative files; never infer corruption solely from retry count.

No owner decision is required before reversible preview implementation and testing. Production data cleanup and any production database promotion require the exact proof/approval gates in §9 and `/worksp/shared-db/AGENTS.md`.

## 9. Executable plan

### Phase A — contract, governance, and reproducible evidence

#### 9.1 Freeze the acceptance contract and baseline

Create committed `verification/popsg-readiness/README.md` and a timestamped **summary** artifact. Create local `.private/popsg-readiness/` for raw licensed-path/candidate evidence; `.gitignore` already excludes `.private/`. Add a project-owned read-only script under `scripts/` that emits:

- confirmed project ref/URL;
- latest crawl ID, roots, status, start/end, inaccessible roots;
- bridge candidates, accepted rows for that crawl, server-rejected count/reasons;
- active rows not in latest successful crawl;
- active rows, current eligible NAS paths, exact missing/extra path counts;
- counts by extension, licensor, property, preview status/error code, tag coverage;
- PDF extraction and source-resolution coverage;
- aggregate-view row counts/freshness.

The script must send filenames, full paths, row IDs, and candidate exports only to `.private/popsg-readiness/`; it may commit only counts, extension/category summaries, timestamps, non-reversible hashes, and redacted examples under `verification/popsg-readiness/`. The NAS inventory must reuse/export the same skip/extension contract as `sg-ingest-filter.ts`; do not maintain an undocumented second allow-list. Run broad NAS reads as a detached, low-priority, durable read with recorded PID/start/end/exit/error evidence and no NAS user-data writes (the behavior required by `synology-long-running-operations`, even when that named skill is unavailable).

Dependency: none. This baseline gates all later data changes.
**You’ll know it worked when** a reviewer can re-run one documented command and derive every readiness count from saved, timestamped summaries with zero permission errors and a confirmed `qsllyeztdwjgirsysgai` target; `git check-ignore .private/popsg-readiness/probe` succeeds; and `git grep` plus a staged secret/path review finds no licensed path export.

#### 9.2 Route the shared-database work

Classify the required database objects from scratch and open a `db-work` issue in `u2giants/shared-db` naming at least: `style_guide_crawl_runs`, the cleanup RPC(s), aggregate refresh contract, PopSG PDF extraction rows/status/claim-complete contract, search RPC/documents/indexes, and any status/metrics fields. The replacement cleanup/continuation RPCs must be service-role-only unless a narrowly authorized user-facing wrapper is proven necessary; explicitly remove/reject the baseline function’s broad `authenticated` grant. Do not assume issue #107 grants a migration-author lane. The shared-db orchestrator authors the migration on a dedicated branch, tests it in preview, merges the PR, and—only with the production promotion gate satisfied—applies it to production. App code must not depend on the new contract until production structure exists. If `codex-shared-db-change` is unavailable, the invariant is still: inspect read-only freely, but route all structure through the one shared-db orchestrator and never write app-side DDL.

Dependency: 9.1 defines the behavior and baseline.
**You’ll know it worked when** the shared-db issue is dispatched, its PR is merged, preview behavior/performance evidence is attached, production migration ledger is verified, and generated consumer types have synced back without app-side migration files.

### Phase B — truthful, bounded crawl reconciliation

#### 9.3 Build a bounded cleanup contract

In canonical `/worksp/shared-db/supabase/migrations/`, replace the operational use of the unbounded cleanup with a restart-safe contract. The exact RPC design may vary, but it must:

- identify candidates by `root_label`, latest accepted crawl ID, and `is_active=true`;
- return candidate count before mutation;
- process deterministic batches with a durable cursor or repeated `LIMIT` contract;
- set `is_active=false` only for candidates proven absent from the accepted crawl;
- return processed/deactivated/remaining counts;
- be idempotent and safe after retry/restart;
- retain rows and associated metadata;
- expose failure without committing a false-complete run;
- have supporting indexes proven by `EXPLAIN (ANALYZE, BUFFERS)` in preview on representative volume.

If status fields are added, model explicit stages such as `ingesting`, `reconciling`, `refreshing`, `completed`, `failed`, and `attention_required`; do not overload one coarse boolean.

Dependency: 9.2 dispatch. Can be developed in parallel with app-side unit-test scaffolding, not with dependent production code.
**You’ll know it worked when** preview fixtures containing more stale rows than one batch reconcile over multiple calls, an interrupted run resumes without double-counting, a retry is a no-op after completion, and every query stays below the agreed performance budget.

#### 9.4 Make Edge completion orchestrate truthfully

Refactor `handleCompleteStyleGuideCrawl()` in `supabase/functions/agent-api/index.ts:2789-2962`; extract orchestration into testable helpers under `supabase/functions/_shared/` if needed. Required behavior:

1. Track received candidates separately from accepted/upserted/rejected records.
2. At `done=true`, evaluate the regression guard before any inactivation.
3. Move status to reconciling; call bounded cleanup until complete or persist a resumable pending state.
4. Refresh folder/guide aggregates only after reconciliation completes.
5. Mark completed only after refresh succeeds and persisted counts agree.
6. On any error, persist failed/attention-required status, error category, remaining work, and retry guidance; return a non-success response where safe.
7. A retry must resume reconciliation/refresh rather than ingesting or invalidating correct rows.

Update `apps/bridge-agent/src/api-client.ts` and `style-guide-crawler.ts` so the agent understands an accepted-but-reconciling response, retries safely, and does not start a competing crawl. Do not keep an Edge invocation open indefinitely; use a durable follow-up mechanism already present in the system or short bounded continuation calls.

Compatibility is mandatory: `complete-style-guide-crawl` continues returning `ok: true` for every accepted old-agent request, with only additive response fields. Add a contract fixture for the exact prior production bridge client behavior (`callApi` treats missing/false `ok` as failure). Publish and verify a bridge build that tolerates the new additive states before activating any Edge behavior that depends on the client understanding them; because additive `ok: true` responses remain old-client-safe, the Edge may deploy first only if that compatibility test passes. Record both deployed versions and perform a heartbeat/crawl smoke after each rollout step.

Dependency: 9.3 contract.
**You’ll know it worked when** automated tests force cleanup timeout, refresh timeout, dropped records, duplicate completion, and process restart; none produce a completed status until parity is reached, and the next invocation resumes rather than restarts.

#### 9.5 Add the low-count regression guard

Compare accepted current-crawl rows per root with the prior trustworthy completed crawl and/or current active baseline. Guard both absolute and percentage drops. A suspicious drop must create `attention_required`, preserve existing active rows, display the proposed stale count and root, and require a new healthy crawl or explicit reviewed override. The empty/inaccessible-root protection remains.

Do not hard-code a guess silently. Start with a conservative documented default in `admin_config` or the shared contract, derived from historical daily variance. The live ten-crawl series observed on 2026-09-03 was stable around 219,843–219,992 before server filtering; use a longer history query before setting the threshold.

Dependency: 9.4.
**You’ll know it worked when** a normal small delta auto-reconciles; an empty root, inaccessible root, and synthetic large nonzero drop preserve active rows and show attention-required; an explicit recovery crawl clears the condition.

**Natural context cut 1:** update STATUS/evidence, use `fresh-session`, and re-read Phases C–E.

### Phase C — safe one-time repair and operational visibility

#### 9.6 Reconcile today’s ghost rows

After the new contract is deployed, run a fresh crawl during a stable comparison window. Export candidate rows (`id`, root/path, crawl IDs, last seen, preview/tag/link presence) only to `.private/popsg-readiness/`; commit only redacted counts/hashes. Prove the target immediately before each data write. Preview candidate count and representative existence checks, then use the bounded application-owned cleanup to mark confirmed absences inactive. Do not delete rows or NAS content.

After cleanup, refresh aggregates through the supported contract and verify exact path parity. Account separately for files created during the comparison window. Confirm a returned path reactivates its prior row and metadata safely.

Dependency: 9.3–9.5 deployed.
**You’ll know it worked when** current eligible NAS paths and active database paths have zero unexplained difference at the same snapshot boundary, every explained difference is recorded privately with path, observation timestamps, reason, and disposition, ghost rows remain recoverable as inactive, and Guides/Files counts reflect the reconciled active set.

#### 9.7 Build Admin health and alerts

Extend the admin API/status contract and `src/pages/popsg/PopSGSettingsPage.tsx` around `:790-805` and `:1108-1145` to show:

- last crawl stage and whether it is fully reconciled;
- discovered, accepted, rejected, active, stale-candidate, deactivated, and remaining counts;
- comparison with prior trustworthy run and guard threshold;
- inaccessible roots and dropped/rejected reasons;
- aggregate refresh state/time;
- current mismatch age and exact next action;
- a bounded retry/resume action, not a destructive “force complete.”

Use existing notification infrastructure if available. Notify only on meaningful failure, attention-required, recovery, or persistent mismatch; remain quiet on healthy unchanged runs.

Dependency: 9.4–9.5.
**You’ll know it worked when** desktop and mobile signed-in screenshots show healthy, reconciling, failed, and attention-required fixtures; operators cannot mistake partial ingestion for completed parity; one-click retry resumes bounded work.

### Phase D — previews and searchable content

#### 9.8 Classify and remediate preview failures

Use `get_sg_preview_stats`, render queue history, `thumbnail_error`, and representative files to produce counts by stable error category. Fix systemic renderer defects in `apps/windows-agent/src/` and queue/RPC contracts where evidence supports a code defect. Retry only recoverable categories in bounded batches; preserve terminal categories (corrupt, missing on disk, unsupported renderer capability) with explicit labels visible in Admin and file detail.

Correct misleading UI copy at `PopSGSettingsPage.tsx:1055-1100`: the current allow-list includes image formats and EPS, so do not say JPG/PNG are inherently unsupported. Ensure error filters distinguish “waiting,” “recoverable error,” and “terminal exception.”

Dependency: reconciled active set from 9.6 so inactive ghosts do not inflate failures.
**You’ll know it worked when** every active eligible file is exactly one of: useful preview, actively queued/retrying, or reviewed terminal exception; there are zero unexplained/no-status files; recoverable error counts stop recurring on a clean ordinary run.

#### 9.9 Finish PopDAM source resolution and build PopSG PDF extraction

First finish the existing **PopDAM asset** Windows-agent PDF backfill; do not start a parallel loop or widen it beyond licensing/tech-pack PDFs. Expose durable remaining/succeeded/failed/skipped counts and last progress time. Diagnose terminal failures without deleting evidence. After extraction reaches zero actionable remaining, run/verify the nightly fuzzy resolver and review the 87 unresolved baseline rows using existing quarantine rules.

Separately implement the dedicated **PopSG PDF** pipeline locked in §8:

1. Shared-db provides rows/status and bounded claim/complete RPCs keyed to `style_guide_files.id`, with content identity (`size_bytes`, `modified_at`, and a safe hash/version where available), extracted text, method, page/character counts, terminal error/skip reason, attempts, and timestamps. Inactive files are not claimable; content changes invalidate prior extraction safely.
2. Add agent-api claim/complete/progress actions using agent authentication and least privilege.
3. Extend `apps/windows-agent/src/api-client.ts`, `pdf-text-sampler.ts`, and the polling/orchestration code to reuse the existing native-text → local OCR → AI-last-resort cascade for PopSG PDFs. Serialize/schedule it with ordinary renders and the PopDAM asset backfill so only one controlled workload owns capacity at a time.
4. Maintain search documents incrementally when extraction completes or a file becomes inactive/reactivated; never perform a full-corpus rebuild inside an Edge request or migration.
5. Expose PopSG PDF extraction coverage/failures separately in Admin; never combine them with the PopDAM asset backfill totals.

Do not delete `legacy_ungated` source rows or act on `sg_archive_usage` until coverage and per-row match quality are reviewed. Preserve `file_name` when links are absent.

Dependency: shared-db extraction contract from 9.2 and reconciled files from 9.6. PopDAM source resolution and PopSG extraction may be developed separately, but Windows execution is serialized to avoid starvation.
**You’ll know it worked when** both corpora report independently: actionable PopDAM backfill remaining is zero; every active PopSG PDF has current extracted text or a reviewed terminal reason; content changes requeue; inactive files disappear from content search; resolver metrics are current; representative “Files Used” panels open the correct PopSG file; and no unresolved row was guessed below the approved fuzzy threshold.

#### 9.10 Build comprehensive server-side search and filters

Create a governed PopSG search contract that combines:

- filename, relative path, directory, licensor, property, and guide name;
- active curated `tag_names` / `tag_search_text`;
- text from the dedicated PopSG PDF extraction rows linked directly by `style_guide_file_id`;
- synonym/separator expansion already used by `expandFallbackTerms`;
- authorization, active-state filtering, deterministic ranking, and stable pagination.

Update `src/pages/popsg/PopSGLibraryPage.tsx:610-703` to call that contract in Guides and Files modes. Preserve guide grouping while making a guide match if any active child matches; explain why it matched when feasible. **Must-have launch filters** are licensor, property, guide/folder, file type, preview state, render exception, and tags. Modified-date range and content-availability are a second slice that may land separately but must complete before final production-ready acceptance. Apply filters before pagination; return total/facets for the same result set. Avoid N+1 queries and browser-side corpus filtering. Use incremental/indexed maintenance; do not rebuild the entire corpus inside a migration.

Dependency: search DB contract from 9.2 and stable active/content state from 9.6/9.9.
**You’ll know it worked when** contract tests find fixtures by each searchable field and extracted text, excluded/inactive rows never appear, combined filters retain correct totals/facets across pages, and production p95 queries meet the agreed budget on the full corpus.

**Natural context cut 2:** update STATUS/evidence, use `fresh-session`, and re-read Phase E.

### Phase E — acceptance and landing

#### 9.11 Run production acceptance

Create `verification/popsg-readiness/final-acceptance.md` with current timestamp, exact deployed SHAs/Edge versions, confirmed production project URL, and links to private licensed-path evidence without copying licensed filenames into the public repo. Verify:

1. Three consecutive ordinary nightly crawls finish ingest + reconciliation + aggregate refresh without manual intervention, timeouts, unexplained mismatch, or false-green status.
2. A same-window NAS/database comparison has zero unexplained eligible-path differences and includes a private explained-difference ledger with path, timestamps, reason, and disposition plus a committed redacted summary/hash.
3. Regression-guard synthetic/preview evidence proves mass inactivation is blocked.
4. Every active file has preview/queue/terminal status; no unexplained bucket remains.
5. Actionable PDF backfill is zero and unresolved source rows are explained/reviewed.
6. Signed-in production browser journeys: browse guide, switch Files/Guides, filter each dimension, combine filters, search by filename/path/tag and a phrase extracted from a known active PopSG PDF, paginate/sort, open preview, observe terminal exception, inspect Admin health.
7. Desktop and mobile layouts work; browser console/network contain no unexpected errors.
8. Direct URLs return HTTP 200 and live build/deployment identifiers match merged commits.

Dependency: all prior phases.
**You’ll know it worked when** the acceptance file contains re-runnable evidence for all eight gates, not only green CI or a deployment badge.

#### 9.12 Land and retire

Update `docs/POPSG.md`, `docs/KNOWN_QUIRKS.md`, relevant configuration/deployment docs, and this plan’s STATUS after each landed phase. Shared schema lands through shared-db branch/PR/merge; PopDAM app changes go to `main` with owned paths staged only. Verify CI, Supabase deployment, bridge image/self-update, Windows release/install if changed, frontend image/Coolify deployment, and live SHAs. Close #107 only after §9.11 passes. Delete the linked handoff in the completing commit; retain the plan as historical operating context or mark it complete according to repository convention.

Dependency: 9.11.
**You’ll know it worked when** issue #107 is closed with final evidence, no open obligation remains, the handoff is removed, both repos are clean, and production still passes the acceptance checks.

## 10. Tests required

### Bridge crawler

Extend `apps/bridge-agent/src/style-guide-crawler.test.ts` and `sg-ingest-filter` tests for:

- all eligible extensions, mixed case, dotfiles, system prefixes, shortcuts, symlinks, unreadable directories;
- candidate/accepted/rejected counters;
- completion retry, reconciling response, process restart, and no competing crawl;
- files added/moved/deleted during a crawl are handled according to the documented snapshot rule.

Run from `apps/bridge-agent`: `npm test` and `npm run build` (build `packages/path-filters` first if required).

### Edge functions

Add focused Deno tests for `complete-style-guide-crawl` helpers:

- zero/inaccessible and low-nonzero regression guards;
- cleanup timeout and aggregate-refresh timeout produce non-complete status;
- bounded continuation and idempotent duplicate completion;
- old agent submitting unsupported extensions;
- exact prior bridge client consuming the new additive `ok: true` completion response without throwing/crash-looping;
- counter accuracy and error persistence.

Run the repository’s Edge typecheck/test command documented in `docs/development.md` and the deployment workflow’s exact checks.

### Shared database

In `u2giants/shared-db`, add migration behavior tests for:

- candidate preview with no mutation;
- multi-batch cleanup, interruption/resume, idempotency, multiple roots;
- returned-path reactivation and metadata preservation;
- regression guard preserving active rows;
- search authorization, active filtering, ranking, combined filters, facets/counts, stable paging;
- aggregate freshness and representative-volume query plans.
- replacement cleanup/continuation RPC grants exclude `authenticated` unless a narrowly tested wrapper is required.
- PopSG PDF claim/complete idempotency, content-change invalidation, inactive exclusion, terminal retry policy, and search-document maintenance.

Run `/worksp/shared-db/scripts/check-sql.sh`, repository tests, preview apply, and preview load/performance checks named in its `AGENTS.md`.

### Frontend

Add Vitest/React Testing Library coverage for:

- healthy/reconciling/failed/attention-required Admin status;
- all new filters and combined filter request shape;
- Guides/Files search result rendering, counts, empty/error states, pagination reset;
- preview states and terminal exceptions;
- mobile filter controls.

Run at repo root: `npm test`, `npm run lint`, and `npm run build`.

### Human production QA

Use authenticated browser testing and preserve screenshots/network evidence for §9.11. CI and HTTP 200 alone are insufficient.

## 11. Constraints, standing rules, and gotchas

- Read and obey `/worksp/popdam/AGENTS.md`; stage only owned paths and preserve `.claude/` and other sessions’ work.
- Before the first commit, `git var GIT_COMMITTER_IDENT` must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- PopDAM app work goes to `main`. Shared-db uses its single orchestrator, dedicated branch, PR, preview-first workflow, and AI-owned merge.
- Prove `qsllyeztdwjgirsysgai` immediately before every production data write. Never use the default/retired Ohio project.
- Never add migrations under PopDAM’s `supabase/migrations/`; its mirror is read-only.
- Production/shared infrastructure is read-only unless exact current-chat authority exists. Do not live-edit servers or increase timeouts.
- NAS is read-only in this plan. Use `edgesynology2` for broad reads; do not write to it. Use the long-running NAS skill for broad inventories.
- Never log, commit, or put licensed filenames/private exports into public issues or verification files. Raw evidence lives only in git-ignored `.private/popsg-readiness/`; committed verification contains redacted summaries/hashes only.
- Do not print secrets. Use 1Password vault `vibe_coding` and protected injection.
- Do not use `files_found` as accepted coverage. Separate every lifecycle count.
- Do not call a partial/timed-out scan complete. Three ordinary nightly runs are part of acceptance.
- Do not run parallel PDF backfills, crawls, cleanup loops, or render retries.
- Preserve backward compatibility across staggered agent deployments: accepted Edge responses keep `ok: true` and add fields only; verify the prior client and record bridge/Edge rollout order.
- Do not delete style-guide rows or NAS files; inactivate rows reversibly.
- Keep PopDAM and PopSG tenant behavior separate despite the shared image/database.
- Filter/authorize before pagination; browser-side RLS after service-role ranking is not sufficient.
- A green Railway deployment proves the worker only; verify frontend, Edge, bridge, Windows agent, and database separately.
- Update this plan immediately when any step executes. A stale plan is a defect.

## 12. Access and environment

- Working directory: `/worksp/popdam`; expected app branch `main`.
- Canonical DB directory: `/worksp/shared-db`; do not update its currently behind checkout casually—follow its startup/concurrency rules.
- GitHub CLI was authenticated for `u2giants`; verify with `gh auth status` before use.
- Supabase CLI/MCP can reach production, but verify with project URL/ref before each write. The local `supabase` MCP is pinned to `qsllyeztdwjgirsysgai` in `.mcp.json`; still call `get_project_url`.
- NAS SSH alias: `edgesynology2`; expected hostname `edgesynology2`; read root `/volume1/styleguides`. Broad reads must be detached, low-priority, durable, checked to completion, and record permission errors rather than weakening access.
- Private evidence: `/worksp/popdam/.private/popsg-readiness/` (local, git-ignored). It may contain licensed path/candidate exports and must never be committed. Commit-safe redacted summaries go in `/worksp/popdam/verification/popsg-readiness/`.
- Production UI: `https://sg.designflow.app`; signed-in QA needs an account with `app_access='styleguides'` and administrator rights for Settings.
- Authentication/secrets: 1Password vault `vibe_coding`; use the existing PopDAM/Supabase, GitHub, NAS, and test-user items documented by repository runbooks. Never put values in this plan, shell arguments, logs, or commits.
- Local frontend: follow `docs/development.md`; normally install dependencies and run the documented Vite development command, then root tests/lint/build.
- Agent development: use each app’s `package.json` and README; do not replace operating-system binaries.

## 13. Definition of done, risks, and open questions

### Definition of done

- [ ] All STATUS rows are complete and cite reproducible artifacts.
- [ ] Exact eligible-file contract is documented and shared by inventory/crawler/server/render/search layers.
- [ ] Current ghost rows are safely inactive, not deleted; same-window NAS/database path parity has zero unexplained differences.
- [ ] Bounded reconciliation survives timeout/restart and never reports false success.
- [ ] Regression guard blocks empty, inaccessible, and suspicious low-nonzero crawls.
- [ ] Admin exposes lifecycle counts, mismatch age, failures, and safe resume action; meaningful alerts work.
- [ ] Every active file has preview, active queue/retry, or reviewed terminal exception; zero unexplained preview states.
- [ ] Actionable PopDAM licensing/tech-pack extraction remaining is zero; every active PopSG PDF has current extracted text or a reviewed terminal reason; source resolution is current and unresolved records are reviewed without unsafe guesses.
- [ ] Unified server-side search covers path/name/metadata/tags/extracted text with filter/facet/paging parity and authorization.
- [ ] Required test suites/builds pass in both repos.
- [ ] Shared-db migration is preview-tested, merged, production-applied under the correct gate, and consumer types sync.
- [ ] App changes are committed/pushed; all relevant CI/deployments pass; live SHAs/versions match.
- [ ] Three ordinary nightly crawls and full signed-in production QA pass with saved evidence.
- [ ] Docs are current; #107 is closed; handoff is deleted; both worktrees are clean/handoff-safe.

### Risks and rollback

- **False mass inactivation:** guard with same-window accepted-crawl membership, candidate preview, private export, conservative drop threshold, and batch stop. Roll back by reactivating exported IDs or completing a healthy crawl; never delete rows.
- **Concurrent NAS changes:** record snapshot boundaries and classify later-created files separately; require a fresh crawl for final parity.
- **Edge/runtime limits:** keep calls bounded and resumable; do not raise timeouts.
- **Search migration load:** preview representative plans, add indexes first, backfill incrementally, retain the existing path search as visible fallback until acceptance.
- **Render/PDF capacity contention:** serialize or schedule workloads; do not starve ordinary rendering or start parallel loops.
- **Licensed data exposure:** keep filenames/path exports out of public artifacts and external services.
- **Cross-app database impact:** use shared-db preview and authorization tests before production.

### Open questions and decision criteria

- Exact cleanup batch size: choose the largest preview-tested batch that remains comfortably below production limits under concurrent load.
- Drop threshold: derive from at least 30 trustworthy historical crawls; favor preserving rows and attention-required over automatic mass inactivation.
- Search architecture: choose the least complex governed option meeting ranking, authorization, dedicated PopSG PDF content, facets, and incremental maintenance; retain a visible fallback during rollout.
- Alert transport: reuse an authenticated existing operational channel; if none exists, Admin visibility is mandatory and external alert integration becomes a separately tracked dependency.
- Terminal preview acceptance: approve categories only after representative file inspection proves retries or alternate renderers cannot help.

## Mandatory self-audit

1. **Could a brand-new AI session execute this plan without asking a question? Yes.** Sections 1–4 define the business outcome, system, trigger, and boundary; sections 5–8 preserve code state, evidence, rejected paths, and locked/open decisions—including the dedicated PopSG PDF source, exact private-evidence location, and Edge/agent compatibility rule added after GLM 5.3 review; §9 gives ordered file/function-level steps with dependencies and gates; §§10–13 define tests, rules, access, completion, rollback, and decision criteria.
2. **Does the plan carry all current background, nuance, and rejected reasoning? Yes.** The dated live counts and log root cause are in §§3 and 6; existing code contracts and line references are in §5; failed/dead-end approaches are explicit in §7; eligibility, reversible inactivation, same-window comparison, false-success prevention, preview exceptions, separate PopDAM/PopSG PDF scopes, private evidence, backward compatibility, least privilege, and archive prohibition are preserved throughout.
3. **Is the ultimate goal sufficient for correct judgment if a step is wrong? Yes.** §1 defines trustworthy eligible-file fidelity, honest state, preview exception semantics, and content search, and explicitly says the goal wins over conflicting steps. §8 distinguishes locked decisions from implementation judgment calls, and §13 gives decision criteria and rollback.

### Checklist result

All 13 sections are present; the plan is standalone; every implementation step names concrete targets and a verification gate; rejected approaches, locked/open decisions, out-of-scope work, named tests, environment/access, secret-safe references, landing/deployment proof, STATUS tracking, and reciprocal plan/handoff links are included. GLM 5.3’s three required changes and six non-blocking improvements were integrated: dedicated PopSG PDF text, precise private evidence, backward compatibility/deploy order, aggregate-refresh options, explained-difference ledger, phased filters, portable skill behavior, least-privilege grants, and refreshed line-reference caution. **Self-audit: PASS (2026-09-03, post-GLM integration).**
