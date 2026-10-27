---
issue: 486
status: OPEN
owner: zcode/hetz image-similarity closeout (successor: any session; claim-first on shared-db work)
---

# HANDOFF — image-similarity #486 closeout + remaining repair chains (2026-10-27)

Written 2026-10-27 ~2:05 PM EDT on `hetz` by ZCode (session `cc9ac48437af0a37badeed50c52c2912`). Successor prompt is in the session's closing report; everything below is verifiable cold from GitHub.

## 1. What we were doing, and why

Executed the 2026-10-26 handoff (`HANDOFF.d/2026-10-26T0545Z-hetz-zcode-remaining-open-tracks.md`, since retired): image-similarity Steps 3–7 on u2giants/popdam3#486, the shared-db queue fix, and the transcript blocker. Then, on Albert's instruction, cleared every blocked item found along the way. The feature is LIVE and proven; two repair chains remain, both queued on shared-db merge order.

## 2. What was actually done (all verified on GitHub)

**Image-similarity product (u2giants/popdam3#486):**
- GPU poller `apps/image-embed-worker/` — PRs [#503](https://github.com/u2giants/popdam3/pull/503) `c0861eb2`, [#506](https://github.com/u2giants/popdam3/pull/506) `ceba6bdc`. Live on edge-dev as scheduled task `PopDAM-ImageEmbedWorker` (RTX 3060 Ti; DINOv3+SigLIP2 dual towers; queue drains; heartbeats fresh).
- Edge function `image-similarity` + LibraryTopBar drop zone + results card + tunables — PR [#505](https://github.com/u2giants/popdam3/pull/505) `068063bf`. Acceptance docs PR [#508](https://github.com/u2giants/popdam3/pull/508) `66055c26`: 40/40 degraded-upload pairs found, bands 0.98/0.94/0.90 confirmed. `- [x] live proof` ticked on #486 (comment 6420029612).
- Flags live since 2026-10-26: `IMAGE_EMBED_ENABLED`, `IMAGE_SIM_ENABLED` true; tunables per plan.
- Backfill op `rebuild-image-vectors` + `ImageEmbedCard` — PR [#510](https://github.com/u2giants/popdam3/pull/510) `a273bff8b`.
- Durable AGENTS.md rows (poller, credentials incl. `dam_image_embed_login` 1Password item, deploy path) — PR [#521](https://github.com/u2giants/popdam3/pull/521) `0c9fad4c`.

**Shared database (popcre/shared-db):**
- Wrapper `public.image_embed_stale_assets` — PR [#4819](https://github.com/popcre/shared-db/pull/4819), merged `c5cd0cfdd`, production applied 2026-10-26 9:20 PM EDT (run [40431336163](https://github.com/popcre/shared-db/actions/runs/40431336163), OWNER-OVERRIDE per workstream ruling).
- Scale fix (120 s budget + coalesce cursor) — PR [#4869](https://github.com/popcre/shared-db/pull/4869), merged `9c24d1ff`, preview [40508934766](https://github.com/popcre/shared-db/actions/runs/40508934766), production applied 2026-10-27 9:20 AM EDT (run [40510284474](https://github.com/popcre/shared-db/actions/runs/40510284474)). Verified live: wrapper 10.2 s over PostgREST (was 57 s timeout); real op enqueued all stale in ~100 s; drained. Evidence on #486 (~9:32 AM EDT).
- 4427 merge-group ejections root-caused as a PRE-EXISTING nondeterministic instrument flake on main (admin_config OR-policy plan-shape under malformed JWT subject; byte-identical trees pass/fail; pure main failed identically, run 40425757150). Fix on main via [#4866](https://github.com/popcre/shared-db/pull/4866) 10:18 PM EDT 10-26.
- Work issue [#4814](https://github.com/popcre/shared-db/issues/4814) CLOSED (terminal delivery). Claims #4818, #4868 released natively; worktrees removed; temp credential files deleted.
- Queue fix track: #4786 closed superseded (identical fix already on main via #4783); docs landed as [#4799](https://github.com/popcre/shared-db/pull/4799) `ac1a1307`; issue #4787 closed complete.
- Mirror doc-links fix — [#4904](https://github.com/popcre/shared-db/pull/4904) `24f879e9` (canonical link check 1516→0; consumer mirror contribution 1229→0). [#4861](https://github.com/popcre/shared-db/issues/4861) closed. popdam3-native 13 link lines fixed via [#543](https://github.com/u2giants/popdam3/pull/543) `f2b772bc` — link invariant now PASSES on popdam3 (once the next mirror sync vendors 24f879e9).

**Data operations (owner-directed, designed paths only):**
- 2026-10-27 ~2:20 PM EDT: Albert ruled "honor the 2024 delete marking and retire those three". Soft-deleted (`is_deleted: true`, `thumbnail_url: null`) assets `2b6ce228` (26GRAPHICSL…BTWHL.AI), `58071a73` (16GRAPHICSL…BTWHL.AI), `413b3920` (GOT_Dany_Shelter4.psd). NAS files untouched (their "todelete"-suffixed sources verified present on edgesynology1 — marking honored). Evidence on #486 (~1:26 PM EDT comment).
- `AVIS_0032.psd` scoped ai-tag pass done (marker set; marked rows now exactly 51).
- Backfill op re-run live 2026-10-27 ~9:30 AM (55/55 enqueued, drained; 55 embed failures all the known Spaces-thumbnail gap).

## 3. Preview / production state

- Production: migrations `20261026155459` and `20261027020503` APPLIED (runs above). No other DDL. App data writes: the 3 soft-deletes, 1 scoped ai-tag op, backfill/run op rows. NOTHING loaded into curated Master Data.
- Preview: both migrations rehearsed green (runs 40430137513, 40508934766). Preview also received other sessions' rehearsals since (e.g. #4437 stage-2 era) — not ours.
- Embed queue at closeout: done 46 / failed 110 (all 403-thumbnail-gap) / pending 0; stale 52 (51 repairable once #540's index lands + 1 SEGA row needing re-path).

## 4. Half-finished / parked mid-way

1. **Covering-index PR [#4901](https://github.com/popcre/shared-db/pull/4901)** (shared-db issue [#4870](https://github.com/popcre/shared-db/issues/4870)): migration `20261027143718` + contract tests authored and validated locally (PG16, negative test included); all checks green; GM authorized 3×; never merged — queue-order behind foreign #4888 (which merged 12:16 PM EDT) plus two foreign batch-mate ejections. **PARKED at closeout**: claim #4900 closed via the documented `--park` path (plain release refused with an open PR); PR #4901 CLOSED **reopenable** at head `e408ccf7ed9c72c75cb97ad4a555c70b278817e7`, branch kept on origin. Successor resume comment (exact commands): [#4901 comment 6449752859](https://github.com/popcre/shared-db/pull/4901#issuecomment-6449752859).
2. **Thumbnail repair chain (popdam #540 / shared-db #4905)**: `requeue-broken-thumbnails` times out (8 s cap; no index on `assets.thumbnail_error`, 3.3 GB scan — same disease #4869 fixed). Migration + contract tests DRAFTED at `/tmp/540_migration_draft.sql`, `/tmp/540_test_draft.sql` (machine-local scratch, no secrets; re-derive from issue #540 if gone). Claim attempt refused: object collision with #4900 (`table public.assets`). Exact retry commands on [#4905](https://github.com/popcre/shared-db/issues/4905) comment 6446726053. After the index lands: re-invoke requeue → renders 51 → `rebuild-image-vectors` → stale 52 → 1.
3. **SEGA row re-path**: asset `34d5b0ca-0cd6-4b8b-b8a9-5fc5fedd640e` (3FZ93SESC09 tech pack.ai) — source intact on edge1 at `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/B3M_3FZ - 3D Lenticular framed/13x19/SEGA/3FZ93SESC09/` but the row still carries the pre-rebase relative path; scanner does not auto-re-path it. Update the row's relative_path to the current-tree path, then the repair chain renders+embeds it.
4. **Bake-off pending Albert**: C-RADIOv4-H vs live dual-tower — full prompt was handed to Albert 2026-10-27; not started (his decision).

## 5. What this session owns at closeout

- NOTHING held: claims #4818/#4868 released; **#4900 closed via `--park`** (verified in the parking agent's final report; re-verify with `ai-shared-db-closeout-check` / `--audit` before acting). No locks, no leases.
- Worktrees deliberately LEFT for successors: `/worksp/shared-db/.wt-4870-covering-index` + `.wt-4870-handoff` (PR #4901 source + handoff PR), `/worksp/shared-db/.wt-540-thumb-requeue` (clean, no migration file — instant retry). All other shared-db worktrees and ALL popdam worktrees belong to other sessions.
- Untracked in popdam canonical (other sessions'): `.ai/`, `issue277-production-date-heading.png`, `.wt-4437-gpu-loop/`. Untouched by design.
- This file is the session's only repo artifact.

## 6. Exact next actions, in order

1. Reopen [#4901](https://github.com/popcre/shared-db/pull/4901) (head `e408ccf7`, branch `zcode/4870-covering-index` kept), take a FRESH claim (same objects: `index public.idx_assets_embed_stale_cover`, `table public.assets`, `index dam.dam_asset_image_vectors_stale_cover`, `table dam.dam_asset_image_vectors`), `--check-in-author` with `SHARED_DB_SESSION_ID=<new owner label>`, re-dispatch Guarded Merge on `e408ccf7` once checks finish; then merged-main preview (`merged_preview_source_pr=4901`, `preview_allowlist=20261027143718`), OWNER-OVERRIDE production apply (precedent run 40431336163/40510284474; note: local `ai-task-gates check --before production` prints STOP for class shared-db — the OWNER-OVERRIDE confirmation is the sanctioned mechanism per the workstream ruling), live PostgREST timing vs the 10.2 s warm baseline, evidence + close #4870. Full commands: the PR's resume comment.
2. Then execute [#4905](https://github.com/popcre/shared-db/issues/4905) comment 6446726053 (claim → land the thumbnail_error index → requeue-broken-thumbnails → 51 renders → rebuild-image-vectors → evidence on #486/#540 → close both).
3. Re-path the SEGA row (§4.3), re-render, embed; final coverage comment on #486.
4. shared-db [#4910](https://github.com/popcre/shared-db/issues/4910) (public-boundary vs vendored mirror design) and popdam trigger-scan server-caller uuid bug (on #486) — separate pickups, documented.
5. If Albert green-lights the bake-off, use the prompt he was given.

## 7. Blocked on

- Merge-queue order behind foreign PR #4888 (its owner session active 2026-10-27) — blocks #4901 → #4905 → thumbnails.
- Albert: C-RADIOv4-H bake-off start (decision only; nothing else waits on it).

## 8. What we tried that did NOT work (mandatory)

- **4427 "deterministic" failure**: first diagnosed as our migration's fault; three merge-group ejections "proved" it. WRONG — pre-existing plan-shape nondeterminism in the instrument (byte-identical trees pass/fail; pure main failed). Hours lost; fix was one cell-comparison change (#4866). Lesson: bisect with PURE MAIN before blaming the diff.
- **Preview dispatch with `source_pr`**: silently fails lane-acquire (exit 1, no message). Must use `merged_preview_source_pr` for merged-main rehearsals.
- **PR without `Closes #<work-issue>`**: preview lane refuses "must close exactly one structural work issue; found 0".
- **`--check-in-author` without env `SHARED_DB_SESSION_ID`**: refuses "must execute in the actual current owner session". The session id is the claim's owner label (read it from `refs/db-author-checkins/<claim>-*`).
- **Claim renewal after PR merge**: refused ("open pull request branch or exact head mismatch") — renew BEFORE merge; land preview+apply within the lease hour.
- **admin `trigger-scan` as service caller**: 500 `invalid input syntax for type uuid: "system"` (bug, documented on #486).
- **Background subagent self-reinvoke**: a completed subagent cannot wake itself; watchers must poll in-turn.
- **Subagent model quota**: exhausted overnight (reset 2026-10-30) and killed a watcher; coordinator finished inline. Budget for this.
- **ai-doc-safety baseline**: was failing on clean main from vendored-mirror links (1242) — now fixed both sides; boundary invariant still red from mirror content (issue #4910), so popdam docs PRs still need the evidence-comment pattern (precedents #528/#533/#543).
- **Direct `ls` of DB-expectation paths**: DB `relative_path` values pre/post scan-root rebase differ (`WALL ART/…` vs `Decor/Character Licensed/…/WALL ART/…`) — always resolve via current SCAN_ROOTS (`admin_config` = `/mnt/nas/mac/Decor` → host `/volume1/mac/Decor`).

## 9. Facts that may already be stale (checked ~2:00 PM EDT 2026-10-27)

- popdam main tip `f2b772bc` (post-#543); shared-db main includes `24f879e9` (#4904). Max image-sim migration version `20261027020503`.
- PR #4901 OPEN (updated 17:59Z), #4888 OPEN; claim #4900: released-or-parked at closeout — **verify** with `node scripts/manage-migration-author-lanes.mjs --audit` or the check-in refs before acting; run `ai-shared-db-closeout-check` for the authoritative zero-owned state.
- Embed counts (done 46 / failed 110 / pending 0 / stale 52) as of ~2 PM EDT; will move once repair chains land.
- 1Password items used (by title, never values): "Supabase Runtime Keys - shared POP database (production)", "Supabase DB Password - shared POP database", "dam_image_embed_login DB password (PopDAM image-embed worker, qsllyeztdwjgirsysgai)". Secrets sweep: swept, nothing new to store — all values came from the vault via protected files; every temp file deleted (verified).

## Sub-agent blocks (per shared-db handover §B)

### Agent: image-sim Steps 3–7 (popdam PRs #503/#505/#506/#508)
- Asked to: build poller, edge+UI, tunables, acceptance. Actually did: all, merged, live proof ticked. Found: acceptance harness bar-scale bug (fixed). Worktree: finished (removed). Deliberately did NOT: chase the 55 missing-thumbnail assets (known gap).

### Agent: Step 4b landing (shared-db #4819→#4869 + popdam #510)
- Asked to: land wrapper + backfill op. Actually did: both merged+applied; 4427 root-caused (instrument flake); perf fix-forward landed; live verification posted. Found: instrument flake (§8); enumeration 57 s cold at scale. Worktree: finished (removed; `.wt-4814b` deleted). Deliberately did NOT: land #4870 indexes (filed instead).

### Agent: queue-fix (shared-db #4786)
- Asked to: land PR #4786. Actually did: closed superseded (#4783 already on main), landed docs #4799, closed #4787. Worktree: finished (removed). Deliberately did NOT: merge the conflicting duplicate.

### Agent: doc-links (shared-db #4904 + popdam #543 assist)
- Asked to: fix #4861. Actually did: merged both sides, 1516→0 canonical. Worktree: finished (removed). Deliberately did NOT: touch the public-boundary design (filed #4910).

### Agent: thumbnail diagnosis (no repo writes)
- Asked to: repair 55. Actually did: full diagnosis (50 lost-at-Spaces + 1 marker + 4 source-absent), filed #540, marker pass for AVIS_0032. Found: requeue defect. Worktree: n/a (read-only + admin ops). Deliberately did NOT: improvise writes around the broken requeue.

### Agent: thumbnail chain (#540/#4905) — parked
- Asked to: land index + repair 51. Actually did: marker done (51 marked), migration+tests drafted (/tmp drafts), work issue #4905 with exact retry, worktree `.wt-540-thumb-requeue` kept clean. Found: object collision with claim #4900 (correct refusal). Deliberately did NOT: under-declare objects to dodge the collision.

### Agent: covering indexes (#4870) — parked
- Asked to: land #4901. Actually did: work issue + claim #4900 + migration `20261027143718` + contract tests (local PG16 validation incl. negative), PR green, GM authorized 3×; handoff-docs PR #4913 merged; parked per closeout: claim closed via `--park`, PR CLOSED reopenable at `e408ccf7` with resume comment 6449752859. Found: queue-order + two foreign batch-mate ejections (§8); `derived-from:` guard wants bare versions. Worktree: `.wt-4870-covering-index` kept live (pg4870 container + handoff worktree + temp files removed). Deliberately did NOT: touch foreign PRs; note its durability handoff file was retired via #4913 per the contract guard.

Posted by ZCode chat ${ZCODE_SESSION_ID:-unknown} on hetz
