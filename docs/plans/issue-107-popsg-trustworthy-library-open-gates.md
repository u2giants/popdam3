# Plan: PopSG complete trustworthy searchable library — open gates 7–10 (u2giants/popdam3#107)
Issue: https://github.com/u2giants/popdam3/issues/107
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Parent plan: [plan_popsg_production_readiness.md](../../plan_popsg_production_readiness.md) — its STATUS table owns gates 1–6 (✅ complete) and the history; this plan covers only its open gates **7 (searchable PDF/source coverage), 8 (comprehensive search), 9 (full production acceptance) and 10 (land, document, retire)**. Semantic search is split out as [#706](https://github.com/u2giants/popdam3/issues/706) → [issue-706 plan](issue-706-popsg-semantic-search-restart-and-acceptance.md); gate 8 here covers only the keyword/Guides live proof and treats #706 as a dependency for the semantic half.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 7a. Refresh PDF/source partition and classify the 24 row-less PDFs | ⬜ open | — |
| 7b. Review the 311 terminal skips (223 size-limit, 88 no-text) as accepted terminal reasons | ⬜ open | — |
| 7c. Resolve the Meta credential question and finish the PDF recovery route | ⬜ open | — |
| 7d. Source resolution: run/verify the fuzzy resolver, review 9,226 unresolved rows | ⬜ open | — |
| 7e. PopDAM licensing/tech-pack PDF backfill: prove actionable count is zero | ⬜ open | — |
| 8a. Verify which Guides repair body is live; signed-in broad Guides proof | ⬜ open | — |
| 8b. Second-slice filters (modified-date, content availability) wired in the UI | ⬜ open | — |
| 8c. Semantic half (depends on #706) | ⬜ open | #706 plan |
| 9a. Changed-night proof from the 8 consecutive ordinary crawls | ⬜ open | — |
| 9b. Same-window NAS/DB comparison with explained-difference ledger | ⬜ open | — |
| 9c. Signed-in role/filter/page journeys, desktop + mobile, both modes | ⬜ open | — |
| 9c2. Observation, keyword rollback, saved-data freshness | ⬜ open | — |
| 9d. `verification/popsg-readiness/final-acceptance.md` | ⬜ open | — |
| 10. Docs, STATUS, close #107, retire handoffs | ⬜ open | — |

**Where a fresh session starts:** 7a (read-only) and 9a (read-only) in parallel; 8a next; 7c/7d and 8b are code or operations work on branches; 9b–9d after 7 and 8 land; 10 last. Each gate's evidence is a file under `verification/popsg-readiness/` (public, aggregate only) with private raw evidence under `.private/popsg-readiness/` (git-ignored, mode 0600).

---

## 1. The ultimate goal

Every style-guide file on the NAS that staff are allowed to see is in PopSG, exactly once, with a preview or an honest reason why not, searchable by name, folder, licensor, property, tag and the words inside its PDFs, with filters that give true counts, and the library stays that way every night without anyone touching it. When this is done Albert can trust that "it's not in PopSG" means "it's not on the NAS", and that a search that finds nothing truly has nothing.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Nothing here may hide a gap behind a green badge: a count is accepted only when it is reproduced from live data, and a crawl counts only when it is an ordinary unattended night.

## 2. What this application is

- PopSG is the style-guide library mode of the PopDAM codebase (`u2giants/popdam3`, `main`), served at https://sg.designflow.app from Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`. Files live read-only on Synology `edgesynology1` (`/volume1/mac` → `/mnt/nas/mac` in the bridge container); the bridge (`apps/bridge`, image `ghcr.io/u2giants/popdam-bridge:stable`) crawls nightly via pg_cron `nightly-sg-crawl` → `agent-api`; previews and PDF text are produced by the Windows render agent (`apps/windows-agent`, machine `edge-alien`).
- Database: Supabase `qsllyeztdwjgirsysgai` (Virginia); structure owned by `popcre/shared-db` (`/worksp/shared-db`), app mirror `shared-db/` read-only. Key objects: `style_guide_files`, `style_guide_crawl_runs`, `style_guide_pdf_text` (+ `_v`), `style_guide_search_documents`, `search_style_guide_library_v2`, `get_sg_preview_stats`, `sku_files_used` (+ `resolve_sku_files_used_fuzzy`).
- Edge functions deploy via `.github/workflows/deploy-supabase.yml`; worker on Railway; bridge via `publish-bridge-agent.yml`; Windows agent via `publish-windows-agent.yml` (channel `windows-agent-latest`).
- Docs routed by `AGENTS.md`: `docs/POPSG.md` (crawl/render/PDF/sources, §"Style Guide Sources" at :182-211), `docs/KNOWN_QUIRKS.md`, `verification/popsg-readiness/README.md`.

## 3. What triggered this work

#107 (opened September 2026) asked for a complete, trustworthy, searchable PopSG. The parent plan delivered gates 1–6 (contract, crawl truthfulness, ghost reconciliation, guard, preview classification). The November 4 audit split the semantic half into #706. Remaining checklist lines on #107 (October 11 and 18 comments): search corrective review/release + Virginia live proof + signed-in checks in both modes; provider credential/PDF recovery; two qualifying ordinary changed-night windows; final acceptance and closure.

Live facts verified 2026-11-04 (read-only SQL, this planning session):
- Crawls: the last **8 ordinary nightly runs (Oct 27 – Nov 3, 9–10 PM EST starts) all `completed` / `lifecycle completed` / `guard ok`**, `files_found` 221,113 → 221,114 → 221,358 → 221,453 ×4 → 221,459 — i.e. at least three nights where the NAS changed (the "changed-night" the parent gate requires), none manual.
- Active files 221,459; 219,226 with a thumbnail; **0** active rows with neither thumbnail nor `thumbnail_error` (no unexplained bucket).
- PDFs: 4,402 active `.pdf`; `style_guide_pdf_text` rows for active files: 4,067 `extracted` + 311 `skipped` (223 "File exceeds the bounded extraction size limit", 88 "no extractable text after bounded AI vision"); **24 active PDFs have no row at all**.
- Sources: `sku_files_used` 11,567 rows; 2,341 resolved, 9,226 unresolved (9,024 `pdf_text`, 116 `ai_tag`, 86 `legacy_ungated`); 818 `legacy_ungated` total. (The parent plan's "87 unresolved" was the legacy cohort; the 9,024 are rows written by the PopDAM licensing-PDF backfill since and have never passed the resolver gate.)
- `admin_config` has **no** `META_API_KEY` row (the Meta route reads a server-owned secret elsewhere — see 7c).
- Migration ledger: max version `20261104073606`; `20261023184940` present; **`20261022032116` (the MiMo Guides repair, "believed live") is NOT in `supabase_migrations.schema_migrations`**. The live `search_style_guide_library_v2` is the single 17-arg overload from stage 2 (`20261027183509`, present), pinned `statement_timeout=30s`.

## 4. Scope

### In this plan
Gates 7–10 as listed in STATUS: PDF/source coverage acceptance, keyword search live proof and second-slice filters, production acceptance evidence, closure.

### NOT in this plan
- Semantic search (worker fix, UI wiring, relevance, activation) — #706.
- Crawl mechanics, guard thresholds, preview renderer fixes (gates 2–6 are closed; a regression reopens the parent plan row, not this one).
- Any DB structure change (shared-db claim-first on the owning issue; #4437 for search, a new shared-db issue for a PDF/source contract gap).
- Archival state for old style guides (AGENTS.md "Style Guide Sources archival readiness" row, separate).
- Deleting `legacy_ungated` rows or acting on `sg_archive_usage` (parent plan §9.9 forbids until match quality is reviewed; the review is 7d, the delete is a later owner decision).
- Credential rotation beyond what the standing rule requires (see 7c).
- PopDAM Library UI showing 0 groups / 0 files for a fresh user (defect 2 in the October 28 drill): closed separately as #564; 9c does not re-prove it.
- Semantic outage fallback, rollback rehearsal, broad-query latency, the meter nuance and tester deletion from that drill: #706 steps 7, 9, 10.
- Shared-db contracts #2506, #2507, #2509 named on #107: all CLOSED (checked 2026-11-04 6:05 PM EST); cite them in 9d, no work remains.

## 5. Current state of the code (main `01fcfc34`)

- PDF pipeline: Windows agent claims PopSG PDFs through `agent-api` (`supabase/functions/agent-api/index.ts`, `handleClaimStyleGuidePdfText` ~`:3331`; serialized behind the PopDAM asset backfill); completion writes `extracted|failed|skipped` + method + bounded `terminal_reason` via the v2 completion RPC (shared-db #2507). Coverage card "PDF Search Coverage" on `src/pages/popsg/PopSGSettingsPage.tsx:1058`. AI-vision last resort for PopSG PDFs goes through the server-owned Meta route added by PR #347 (`46dd7856`), which needs the server-side Meta key installed as a function secret (not `admin_config`).
- Sources: parsing + `resolve_sku_files_used_fuzzy(threshold 0.6)` nightly, quarantine model (`docs/POPSG.md:205-208`); UI "Files Used" panel shows resolved file or "unresolved".
- Search: `src/pages/popsg/PopSGLibraryPage.tsx:130-172` calls `search_style_guide_library_v2` (keyword) for Files and Guides when `canUsePopSGV2` (`src/pages/popsg/popsgSearchV2.ts:111-126`) allows; otherwise the legacy summary view. `buildPopSGV2Args` (`popsgSearchV2.ts:163-186`) sends `p_licensors, p_properties, p_extensions, p_preview_states, p_sort, p_limit, p_offset` only — **`p_style_guides`, `p_tags`, `p_render_exception_states`, `p_pdf_content_states`, `p_modified_after/before` exist in the RPC but are not exposed by the UI** (the parent plan's "second slice": modified-date and content-availability; also tags/render-exception are RPC-ready).
- Evidence tooling: `scripts/popsg-readiness-baseline.mjs` (exact-contract DB collector, tested by `src/test/popsg-readiness-collector.test.ts`), `scripts/popsg-readiness-nas-scan.py` (NAS side, run on `edgesynology2` low-priority), outputs under `verification/popsg-readiness/baseline-<ts>.json` (public aggregate) and `.private/popsg-readiness/` (raw). Prior QA artifacts: `admin-console-qa-2026-09-15.md`, `library-qa-2026-09-07.md`, `search-qa-2026-09-15.json`.
- Handoffs still open for this workstream: `HANDOFF.d/2026-10-11T2258Z-hetz-codex-popsg-live-recovery.md`, `2026-10-18T1737Z-hetz-codex-popsg-coordinator.md`, `20261025T1624Z-edge-dev-mimo-popsg-107-resume.md`, `20261026T1600Z-hetz-zcode-popsg-4437-stage1-parked.md` (superseded by stage-1 merge, shared-db PR #4849).

## 6. Key findings

1. The changed-night gate is already satisfiable from existing ordinary runs (8 consecutive, three with changed `files_found`); it only needs the same-window NAS comparison and a written ledger (9a/9b).
2. The "Guides repair" provenance is muddled: version `20261022032116` is absent from the ledger, yet stage 2 (present) rewrote the function with its own body and a 30 s pin, and the October 28 drill measured broad Guides `disney` at 5.9–8.6 s warm with no 57014. Gate 8a must verify the live body md5 against the stage-2 mirror (`shared-db/supabase/migrations/20261027183509_popsg_semantic_search_stage2.sql`) rather than trust either handoff, then prove it signed-in.
3. The PDF partition is nearly closed: 4,378 of 4,402 have a terminal row; the 24 row-less PDFs are the only unexplained items (likely files that arrived after the last extraction run — confirm by `modified_at`/`created_at` vs the last claim).
4. The Meta credential block from October 11 is resolved by the standing rule, not by rotation: the value was exposed only in process output **on this computer** (hetz) and was never published off it, and the standing rules say such a value is **never rotated** — redact where it appeared and leave it. Also the Muse Spark key is in active use today (customs matching, owner-chosen model). So 7c is: confirm the key is installed as the agent-api function secret the PR #347 route reads, run the bounded recovery for the 88 "no extractable text" + 24 row-less PDFs only if the route is functional, and record outcomes; no 100-row reset of extracted rows.
5. Source resolution never caught up with the PopDAM licensing backfill: 9,024 `pdf_text` rows unresolved. Either the nightly resolver is not running or the names in those PDFs do not reach 0.6 similarity. 7d measures which.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Repeat the controlled crawl (Oct 11) as the changed-night proof | Parent plan: "do not repeat this controlled proof or count it as an ordinary changed night". Ordinary runs exist now. |
| Raise statement timeouts to make broad Guides pass | Forbidden; the pin is 30 s on the function and 8 s on the role by design. |
| Rotate the Meta key before PDF recovery | Standing rule: a value exposed only on this computer is never rotated. (If evidence shows it was published off-machine, rotate per the skill — that is the only trigger.) |
| Lower the fuzzy threshold below 0.6 to resolve more sources | Parent plan: "no unresolved row was guessed below the approved fuzzy threshold". Measure first; a threshold change is a business/quality decision backed by sampled match quality. |
| Delete `legacy_ungated` rows now | Parent §9.9 forbids until coverage and per-row match quality are reviewed. |
| Mark the 223 size-limit skips as "failed" to force retries | They are terminal by contract (bounded extraction size); surfacing them as a labelled terminal category is the acceptance, not re-running them. |
| Build the second-slice filters as browser-side filtering | Parent plan: filters apply before pagination server-side; the RPC already has the parameters. |

## 8. Design decisions

**LOCKED** (parent plan §8, September 2026; owner rulings):
- PDF extraction cascade native text → local OCR → AI last resort; PopSG and PopDAM PDF totals never combined; one Windows workload at a time.
- Every active file is exactly one of: useful preview / queued / reviewed terminal exception. Every active PDF: current extracted text or reviewed terminal reason.
- Must-have filters: licensor, property, guide/folder, file type, preview state, render exception, tags; second slice (modified-date, content availability) must land before final acceptance.
- Evidence: public aggregates only; licensed names/paths stay private; three consecutive ordinary nights + same-window comparison with zero unexplained differences.
- Ordinary-night acceptance is never satisfied by a controlled run.

**OPEN** (implementer judgment):
- Whether the 24 row-less PDFs are queued by the normal nightly path or by one bounded manual claim: queue manually only if they are older than the last extraction run (i.e. the pipeline skipped them), otherwise wait one night and re-check.
- Fuzzy-resolver follow-up: if ≥ 90% of a 50-row private sample of unresolved `pdf_text` rows have an obvious NAS match below 0.6, write the finding for Albert as a business question (lower threshold vs. manual review); otherwise record them as legitimately unresolvable and move on.

## 9. The plan

### Gate 7 — searchable PDF/source coverage

**7a. Refresh and classify (read-only).** Reproduce the §3 PDF counts with `scripts/popsg-readiness-baseline.mjs` extended with a `pdf-partition` section (active PDFs by `style_guide_pdf_text.status`, terminal reasons, row-less count, `max(claimed_at)`), writing `verification/popsg-readiness/pdf-partition-<ts>.json`. List the 24 row-less PDFs privately with `created_at`/`modified_at` and whether they post-date the last extraction claim. Gate: the JSON totals sum to the active PDF count exactly (4,402 at planning time) and every PDF is in exactly one bucket.

**7b. Terminal-reason acceptance.** Confirm the UI shows both terminal categories distinctly: PopSG Settings "PDF Search Coverage" (`PopSGSettingsPage.tsx:1058` region) must display extracted / skipped-by-size / skipped-no-text / waiting counts, and the file detail sheet must label a skipped PDF's reason. If the card only shows one "skipped" number, extend it to read the `terminal_reason` facet from the status RPC (check the RPC's return shape in `shared-db/types/database.types.ts` before adding UI; if the facet is missing, that is a shared-db request on the PDF contract issue, not an app workaround). Test: `src/test/popsg-pdf-coverage-card.test.tsx` "renders size-limit and no-text skips as separate labelled terminal counts". Gate: screenshot of the card (never the Setup tab) with counts equal to 7a's JSON.

**7c. Meta route and bounded recovery.** (i) Verify `supabase secrets list` (CLI token from 1Password `vibe_coding`) shows the secret name the PR #347 route reads (grep `META_API_KEY` in `supabase/functions/agent-api/index.ts` to get the exact env name) — names only. (ii) If absent, install it from 1Password item "Meta ai Muse Spark API Key" (`czggiabkpo7dt7ojep4btdvq5i`) via `op run` → `supabase secrets set` (value never in chat/logs); record on #107 that the standing rule applies (local-only exposure, no rotation) and remove the "Compromised" tag only if the item's notes confirm no off-machine publication; otherwise leave the tag and note it. (iii) With the Windows agent healthy (heartbeat in PopSG Settings → Agent), queue only the 88 no-text PDFs + the row-less 24 that 7a shows the pipeline skipped, through the normal admin route; one controlled workload; watch the agent log for the `agent-api` 2xx on the Meta call. Gate: each queued PDF ends `extracted` or `skipped` with a terminal reason; counts in 7a's JSON re-run match; no `failed` rows remain.

**7d. Source resolution.** Read-only: `select max(last_match_attempt_at), count(*) filter (where match_attempts=0) from sku_files_used where style_guide_file_id is null` — if `match_attempts=0` dominates, the nightly resolver is not reaching them (check the pg_cron job that calls `resolve_sku_files_used_fuzzy`; if it is missing/failed, that is a shared-db cron fix on a new shared-db issue referencing #107). If attempts exist with `match_best_score` < 0.6, sample 50 privately and apply the OPEN rule in §8. Gate: `verification/popsg-readiness/sources-<ts>.json` with resolved/unresolved by `source`, attempt coverage 100% (every unresolved row has ≥ 1 attempt), and a written disposition for the remainder; the PopDAM "Files Used" panel opens the correct PopSG file for 5 sampled resolved rows (private evidence).

**7e. PopDAM PDF backlog.** The issue body lists 23,353 eligible licensing/tech-pack PDFs needing extraction, and the September comments left that backlog running (22,311 at last report); parent §9.11 gate 5 requires actionable backfill to be zero. Nothing above measures it, since 7a–7c count PopSG PDFs only. Read it through admin-api `get-pdf-backfill-status` (`supabase/functions/admin-api/index.ts:1576`, card `PdfBackfillCard.tsx`) with the administrator login, and cross-check against a direct count of the same predicate. Report it separately; never add it to PopSG totals. If actionable is above zero and the job is idle, resume through the normal admin route, one Windows workload at a time, and do this before 7c. Gate: `verification/popsg-readiness/popdam-pdf-<ts>.json` shows actionable 0, with failed rows carrying a stored error (the September false-completion check: no failed row with a null error and null page count).

### Gate 8 — comprehensive search

**8a. Which Guides body is live + signed-in proof.** `select md5(prosrc) from pg_proc where proname='search_style_guide_library_v2'` and compare with the md5 the stage-2 mirror pins (`20261027183509…sql` contract section; the parked handoff cites `1dfc9194a2288feb3a0feace89487f78` for the draft — recompute from the mirror). Then, signed in as the user-role tester on sg.designflow.app, run broad `disney` in Guides and Files, `logo`, a tag-only phrase, a PDF-text phrase (from a private known-extracted PDF), and a no-match: record HTTP status, total, elapsed, console errors. Pass: 200s, totals equal direct RPC totals, Guides broad ≤ 8 s (role ceiling) with no 57014; note the 3 s target is #706's latency gate. Post the result on shared-db #4210 (closes MiMo's outstanding item) and #107. Artifact: `verification/popsg-readiness/search-qa-<date>.json` (aggregate).

**8b. Second-slice filters.** Extend `PopSGSearchFilters` (`popsgSearchV2.ts:6-12`) with `modifiedAfter/modifiedBefore` and `pdfContentStates` (and, since the RPC supports them, `tags` and `renderExceptionStates`), map them in `buildPopSGV2Args` (`:163-186`), add controls on `PopSGLibraryPage.tsx` beside the existing licensor/property/type/preview filters (`:1080-1100` region), include them in the query keys (`:776, :826`) and the `hasActiveFilters` logic (`:886`). Facets returned by the RPC drive counts. Tests in `popsgSearchV2.test.ts`: "maps modified-date range and content-availability to the RPC", "keeps tag and render-exception filters off the guide summary path when unsupported" (mirror of the existing `canUsePopSGV2` rules). Gate: lint/typecheck/test/build green; signed-in check that combining licensor + modified-date + content=extracted returns the same total across pages 1..n (parent gate "combined filters retain correct totals/facets").

**8c. Semantic half** — tracked by #706; this gate is done when #706's live proof is ticked.

### Gate 9 — full production acceptance

**9a. Changed-night proof.** From `style_guide_crawl_runs` (read-only) write `verification/popsg-readiness/ordinary-nights-<date>.md`: the 8 runs with start (EST), status, lifecycle, guard, `files_found`, accepted/reconciled counts, `stale_remaining`, aggregate refresh timestamp; mark the nights where `files_found` changed. Pass: ≥ 3 consecutive completed/guard-ok nights including ≥ 2 changed nights, zero manual intervention (no `update-bulk-op`/manual crawl in the window — check `admin_config` audit or crawl `trigger` column).

**9b. Same-window NAS/DB comparison.** Run `scripts/popsg-readiness-nas-scan.py` on `edgesynology2` (low priority; load `synology-long-running-operations`; SSH as `ahazan` with key `916-alien`; no sudo needed for reads) and `scripts/popsg-readiness-baseline.mjs` within the same window after a nightly crawl; compare path sets with the deterministic-ID paging the September collector uses. Produce `baseline-<ts>.json` (public: counts, zero missing/extra or the explained-difference count) and the private ledger (path, timestamps, reason, disposition) + its SHA256 in the public file. Pass: zero **unexplained** eligible-path differences.

**9c. Signed-in journeys.** Playwright MCP with the user-role tester, then the administrator item (`ai-admin@designflow.app`) for Settings: browse guide → switch Files/Guides → each filter alone → combined filters → search by filename/path/tag/PDF phrase → paginate/sort → open preview → observe a terminal-exception file → Admin health (crawl, preview, PDF cards). Desktop 1440×900 and mobile 390×844; console/network must show 0 errors and 0 4xx/5xx (known-quirk admin-api 403s for the user role are allowed only on the user-role pass, per `docs/KNOWN_QUIRKS.md`). Artifact: `verification/popsg-readiness/journeys-<date>.md` with screenshots (never Setup tab; no licensed names in filenames).

**9c2. Observation, rollback, saved data.** The October 18 checklists on #107 require these on top of the journeys; the semantic half is #706 step 9, this is the rest. Observation: at least one ordinary nightly crawl after the 8b frontend deploy, re-running the 9a row and one signed-in search. Rollback: name the previous frontend image in the acceptance file and confirm it is still pullable from GHCR; confirm inactive rows are retained (count of inactive `style_guide_files`, none deleted) so the parent's reactivation route still works. Saved-data freshness: after a changed night, the aggregate refresh timestamp is later than that crawl's reconcile time, and the Library totals, Guides count and filter facets match direct counts. Gate: `verification/popsg-readiness/observation-<date>.md` with all three, times in EST.

**9d. Final acceptance file.** `verification/popsg-readiness/final-acceptance.md` per parent §9.11: timestamp (EST), deployed SHAs (frontend header, edge run id, worker Railway SHA, bridge heartbeat build, Windows release), project URL, links to 7a–9c2 artifacts and the private ledger hash, and the eight parent gates each marked with its evidence.

### Gate 10 — land and retire

Update `docs/POPSG.md` (PDF terminal reasons, second-slice filters, sources disposition), `docs/KNOWN_QUIRKS.md` if any quirk was added, the parent plan STATUS rows 7–10 (✅ with artifact paths), `AGENTS.md` pending-work row "PopSG production readiness (#107)" → done, and `plan_semantic_search_popdam_popsg.md` SG rows via #706. Retire the four handoffs listed in §5 in the closing PR (successor rule: each obligation is either delivered here or carried to #706). Close #107 with the signed closing comment linking `final-acceptance.md`; leave `- [ ] live proof` unticked until 9d exists, then tick it in the same comment.

## 10. Tests required

New: `popsg-pdf-coverage-card.test.tsx` (7b, 1 test), `popsgSearchV2.test.ts` (8b, 2 tests), `popsg-readiness-collector.test.ts` extension "pdf-partition section sums to the active PDF count" (7a). Existing suites green: root `npm run lint && npm run typecheck && npm run test && npm run build`; `apps/worker` build/test; `apps/windows-agent` test (CI); bridge tests if the bridge is touched (it should not be).

Adversarial cases (trust boundary: NAS scan and PDF text are external input):

| Input | Hostile case | Test |
|---|---|---|
| NAS path listing | Path with newline/quote/unicode normalization difference vs DB | collector test "normalizes path keys identically on both sides" (exists in `popsg-readiness-collector.test.ts`; extend if NFC/NFD is not covered) |
| PDF terminal reason | > 200 chars or control characters from the agent | "coverage card truncates and escapes terminal reasons" (7b test) |
| Filter values from the URL/UI | Date strings that are not ISO; arrays > 50 | "buildPopSGV2Args drops invalid dates and caps array filters" (8b test) |

## 11. Constraints, standing rules, gotchas

- Branch + PR to `main`; AI merges; `ai-pr-wait` in the background; sign with `$AI_GH_SIGNATURE`.
- DB structure only via `popcre/shared-db` claim-first; production DB read-only here except through the app's own admin routes and the normal queue actions.
- Never raise timeouts; never run a manual crawl as acceptance; never combine PopSG and PopDAM PDF totals; one Windows workload at a time (PopDAM asset backfill must be idle before queueing PopSG PDFs).
- Secrets: 1Password `vibe_coding` only; `op run`; never print `supabase secrets` values; the Meta key stays un-rotated under the local-only-exposure rule unless off-machine publication is shown.
- NAS reads over 25 s: load `synology-long-running-operations`; the `edgesynology2` scan runs at low priority and must not touch `edgesynology1`'s live bridge; docker sudo on the NASes is intentionally disabled (`ahazan-docker.sudoers-disabled`) — reads do not need it.
- Do not screenshot PopSG Settings → Setup (NAS password visible) or the render-error list (licensed paths).
- Known quirk: admin-api returns 403 for aggregate endpoints to user-role accounts; use the administrator item for Settings QA.
- Times for humans in EST.

## 12. Access and environment

- Machine hetz; `gh` as `u2giants`; Supabase MCP read-only SQL; Supabase CLI token in 1Password `vibe_coding` ("Supabase CLI token" item per `docs/1password.md`); DB password item "Supabase DB Password - shared POP database" (pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`) for the collector.
- Test identities: `vibe_coding` "PopSG / PopDAM AI tester login" (user) and administrator `ai-admin@designflow.app` item (`7s5uzpbjenka4fpvrqogh44bre`); anon key in item `3hhxwrljnaq2tykxi7hplq5ryi`; session-injection recipe in memory `project_popsg_tester_login.md`.
- NAS: SSH `ahazan@edgesynology2` with the `916-alien` key; scan script `scripts/popsg-readiness-nas-scan.py`.
- Local: `npm ci && npm run dev` (set the SG hostname per `docs/development.md` to get PopSG mode).

## 13. Definition of done, risks, open questions

Done: all STATUS rows cite artifacts; 7a–7e files exist and reconcile; 9c2 file exists; 8a posted on #4210 and #107; 8b merged, deployed (frontend SHA verified) and journey-tested; #706 live proof ticked; 9a–9d files exist with zero unexplained differences; docs/plan/AGENTS rows updated; four handoffs retired; #107 closed with `live proof` ticked.

Risks: (1) Windows agent offline (`edge-alien`) blocks 7c — report `Blocked —` with the last heartbeat time, do not run extraction elsewhere. (2) The 24 row-less PDFs may be new nightly arrivals — then 7c is a wait, not a defect. (3) 9b NAS scan collides with the nightly crawl window — run it in the afternoon EST after the previous night's crawl, same as September. (4) Second-slice filters change query keys — verify no cache leakage between filter states (8b test).

Open: fuzzy-threshold question (§8 OPEN) may become a business question for Albert; the exact env name of the Meta secret (resolved in 7c step i).

## Self-audit

1. *Executable without questions?* Yes — §3 carries fresh live numbers, §5 the file:line map, §9 per-gate commands/artifacts/gates, §12 credentials by location.
2. *All background and dead ends?* Yes — §6 (ledger discrepancy, Meta rule, source backlog), §7 (seven rejected paths incl. the controlled-crawl trap), §11 (NAS/sudo/screenshot traps).
3. *Goal clear enough to steer?* Yes — §1 defines trust as reproducible counts and unattended nights; §8 marks locked acceptance semantics so no step can be "passed" by a badge.
