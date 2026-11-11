---
summary: Issue #681 plan: Activate stale-record retirement: update NAS bridge agent after Indra rescan. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-681
---

# Plan: Activate stale-record retirement: update NAS bridge agent after Indra rescan (u2giants/popdam3#681)
Issue: https://github.com/u2giants/popdam3/issues/681
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started by this plan — but another session was mid-proof at 4:13 PM EST, see §5).

Absorbs #684 (per the issue comment of Nov 4, 3:33 PM EST). Source handoffs this plan supersedes once the work closes: `HANDOFF.d/2026-11-03T2209Z-hetz-claude-stale-retirement-activation.md` and `HANDOFF.d/2026-11-03T2210Z-hetz-claude-missing-pdf-records.md`.

## STATUS (read first)

| # | Step | State | Evidence / date |
|---|------|-------|-----------------|
| 1 | Gate: PDF rescan completed | ⬜ open (fact true, not yet recorded on issue by this plan) | `admin_config.PDF_BACKFILL.status = completed`, remaining 0 (DB read 2026-11-04 4:46 PM EST) |
| 2 | NAS bridge runs a build containing #677 | ⬜ open (fact true) | `agent_registrations` synology-bridge-1 version `1.16.21`, build `522e5722`, heartbeat 4:46 PM EST |
| 3 | Two corrected assets show `replaced` | ⬜ open (fact true) | both ids `indra_rescan_outcome = replaced` (DB read 4:46 PM EST) |
| 4 | Moved-file proof: old record retired with marker | ⬜ open | fixture placed by another session; see trap in §6 (name has no PDF keyword) |
| 5 | Lookup after the full scan shows no new stale duplicates | ⬜ open | |
| 6 | Fixture removed; evidence posted; #681 and #684 closed; both handoffs deleted via PR | ⬜ open | |

**Where a fresh session starts:** Step 0 (coordination check) then Step 4. Steps 1-3 are already true in live data; the implementer only re-reads and records them.

---

## 1. The ultimate goal

When staff move or reorganise design files on the NAS, PopDAM must stop keeping an old "ghost" record alive at the old location. The code for this shipped on Nov 3 (PR #677) and the NAS agent that runs it was updated on Nov 4. What is left is to **prove on the real NAS** that a moved file retires its old record, confirm the Nov 3 cleanup held (no new ghosts after a full scan, the two hand-corrected PDFs were re-read), and close the two issues and their handoffs.

Business meaning: the paid AI tagging run (#680) should not spend money on ghost records, and search should not show files that are not there. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' digital asset library (dam.designflow.app). Source files live on Synology NAS `edgesynology1`, share `/volume1/mac`; library paths are relative to that root (`Decor/...`). A bridge agent (Docker on the NAS, `apps/bridge-agent/`) scans files and calls edge function `agent-api` (Supabase project `qsllyeztdwjgirsysgai`). A Windows agent reads PDF text ("Indra OCR" rescan). Repo https://github.com/u2giants/popdam3, branch `main`; feature branch + PR; the AI merges. Machine: hetz. Today 2026-11-04.

## 3. What triggered this work

On Nov 3 a NAS file index showed 6,137 of 24,777 live PDF records were not at their recorded path; 5,683 were stale duplicates left by folder reorganisations (`docs/KNOWN_QUIRKS.md` #81, line 1301). PR #675 added the lookup query (`scripts/list-missing-pdfs.sql`), PR #677 added retirement + prevention and bridge 1.16.20, and all 5,683 were retired with a NAS backup (`/volume1/docker/popdam/manual-scans/pdf-index-20261103/stale-retirement-backup/`, start with `UNDO.sql`). The running NAS agent only changes on an in-app update, which was deliberately withheld during the Indra rescan. #681 = "update the agent after the rescan and prove a moved file retires its old record". #684 = "after that update, confirm the 2 corrected assets show replaced and a full scan leaves no new stale duplicates"; #684 was absorbed into #681 on Nov 4.

## 4. Scope

In scope: record the three already-true gates, run the moved-file proof on the NAS, run the post-scan lookup, clean up, close #681 and #684, delete the two Nov 3 handoffs through a PR.

**NOT in this plan:**
- Any code change. If the proof fails because of a bug, stop, record exact evidence on #681, and open the fix as its own PR referencing #681 (the fix is code; this plan is proof).
- The 493 live PDF records still carrying an `ENOENT` read error (count at 4:46 PM EST; was 474/414 by other counting rules on Nov 3). They are "moved copies needing judgement, gone files" and belong to the missing-files task (#680 section 6 step 2 in the coordinator handoff), not here.
- Starting the AI tagging run (#680) or touching `AI_TAG_PARALLEL_RUN`.
- Resetting or pressing start on `PDF_BACKFILL` (clears rescan mode).
- Restarting NAS containers; modifying the self-updater.
- Review findings #678 (own plan in this folder) and #687.

## 5. Current state (live reads 2026-11-04, 4:46 PM EST, read-only)

- `PDF_BACKFILL`: `status completed`, processed 19,434, remaining 0. **Gate open.**
- `agent_registrations` bridge `synology-bridge-1`: version `1.16.21`, `build_sha 522e5722…`, last heartbeat 4:46 PM EST. `522e5722` is PR #703's merge, which is after #677 on `main`, so prevention code is running. **No update request is needed** (a second update is explicitly forbidden by the coordinator handoff §5: "Run it once only").
- The 2 corrected assets `60ee62d9-8b13-4510-b4b4-66c6794593c9` and `4ea328c8-95ad-4388-b416-0b3f18523949`: `indra_rescan_outcome = replaced`, no error (read Nov 3, 4:40 PM and 5:50 PM EST). **#684 item done.**
- Marker rows (`asset_path_history.new_relative_path like 'retired-stale-duplicate:%'`): 5,683, newest Nov 3 12:53 PM EST. **None written by the agent yet.**
- A full scan `SCAN_REQUEST` was claimed at 1:48 PM EST Nov 4 (`request_id 41e79a01-…`); `SCAN_PROGRESS.status running`, 127,543 files checked of ~431,612 encountered, `ingested_new 1`, `updated_existing 8,723`, `rejected_wrong_type 262,824`, `moved_detected 0`, current path under `Decor/Character Licensed/...` at 4:45 PM EST. A full scan takes hours; do not request another while it runs.
- `INGESTION_RULES.rules = []` (temporary proof rules were added at 1:48 PM and removed 1:51 PM EST by a #703 session; the running scan loaded rules at its start, 1:48:35 PM, so it may hold those two proof rules — irrelevant to this plan).
- `SCAN_ALLOWED_SUBFOLDERS = ["generic decor", "character licensed"]`, `SCAN_MIN_DATE = 2020-01-01`.
- Another session posted on #681 at 4:13 PM EST: it placed two copies at `Decor/Generic Decor/Unused/_ai_test_681/{a,b}/ai-test-681-moved-file.pdf` and is waiting for the scan. **No asset row exists for `%_ai_test_681%`** (DB read 4:46 PM EST) — and none will, see §6.

## 6. Key findings and root cause

- **Fixture trap (decisive).** A PDF is only ingested when its name contains a built-in keyword — `tech pack`, `tech_pack`, `techpack`, `tech-pack`, `licensing sheet`, `licensing-sheet`, `licensing_sheet`, `_comp view`, `_compview` (`packages/agent-common/src/ingestion-rules.ts:17-27`, applied in `apps/bridge-agent/src/scanner.ts:43` via `matchesPdfRules`). `ai-test-681-moved-file.pdf` contains none, so the scanner counts it under `rejected_wrong_type` and the proof can never complete. The fixture must be renamed, e.g. `ai-test-681 tech pack.pdf`, or use `.psd` copies (always ingested, `scanner.ts:203`). LOCKED: use a PDF name containing `tech pack` so the proof stays PDF-realistic.
- **Why two copies are required.** With a single copy, moving it is detected as a move (`agent-api/index.ts:1109-1121`: exactly one same-hash+name live row → `moved`, no `stale_candidates`). With two copies, the second (or the moved one) is `created` either because the bridge sets `skip_move_detection` for a repeated content identity in the same scan (`apps/bridge-agent/src/index.ts:1226-1227`) or because two candidates are ambiguous. Only a `created` response carries `stale_candidates` (`agent-api/index.ts:1291-1306`), which the bridge checks on disk (`stale-record-retirement.ts:24-42`) and retires through `retire-stale-asset` (`agent-api/index.ts:1315-1386`). The surviving copy `a` must keep existing or the candidate check `stat(top-level folder)` and `stat(survivor)` still pass but `a` is not absent → kept (correct).
- **Scan ordering.** The fixture is under `Decor/Generic Decor/Unused/...`; `generic decor` is an allowed subfolder, `Unused` and `_ai_test_681` are not in any blocklist (`packages/path-filters/index.ts:20-49`; `_`-prefixed names are not skipped, only `. $ @ #`). The scan currently running (started 1:48 PM) walked `Generic Decor` before `Character Licensed` only if that is its traversal order; `current_path` at 4:45 PM was in `Character Licensed`, so the fixture folder has most likely already been passed (while misnamed). A new scan is needed after renaming anyway.
- **Scan requests.** The in-app trigger is admin-api `trigger-scan` (`supabase/functions/admin-api/index.ts:2115`, `agent-handlers.ts` writes `SCAN_REQUEST {status: pending}`); the bridge picks it up over realtime (`apps/bridge-agent/src/realtime-watcher.ts`). The AI does this through the app (Settings → Scanning / Scan Diagnostics) with the tester login, never Albert. A scan of the whole library is slow; there is no documented path-scoped scan, so each proof round costs one full scan. Plan for two rounds after the rename: (1) ingest both copies, (2) move `b` → `c`, scan, verify. A third round is needed only for #678's revive proof (optional here).
- **Agent update mechanics (for the record).** `AGENT_UPDATE_REQUEST {action:"apply"}` via admin-api `trigger-agent-update` (`admin-api/index.ts:2153`, `agent-handlers.ts:715-735`); the bridge consumes it on heartbeat (`agent-api/index.ts:558-569`). Not needed now.
- **Lookup for "no new stale duplicates."** `scripts/list-missing-pdfs.sql` lists live PDFs whose last read hit `ENOENT`. New ghosts created by moves after Nov 3 would show up only after the Windows agent tries to read them, which is not happening (rescan completed). The practical post-scan check is therefore: (a) marker-row count grew only by the fixture retirement (5,683 + 1), (b) no live asset pair shares `(filename, quick_hash, file_size)` where one path is absent — approximated by the SQL in Step 5, (c) `SCAN_PROGRESS.counters.moved_detected` and `ingested_new` after the scan are small and explained.

## 7. Approaches considered and REJECTED

- **Requesting a second agent update "to be sure"** — rejected: the running build already contains #677 (§5) and the coordinator rule is one update only; an update restarts the container mid-scan.
- **Proving with a single moved file** — rejected: that path is handled by the #51 move guard as `moved`, never exercising retirement (§6).
- **Server-only absence detection** (stamping `last_seen_at`) — rejected on Nov 3: unchanged files are not stamped and stamping fires heavy triggers (2209Z handoff §4).
- **Retiring the remaining 493 ENOENT records by rule** — rejected: they are not all duplicates; "never guess a match" (2210Z handoff §9).
- **Scoped scan of one folder** — not available in the product; rejected rather than building one for a proof.
- **Keeping the fixture misnamed and adding a temporary `pdf_include` rule** — rejected: rule changes take effect only at the next scan start, leave history entries in `INGESTION_RULES`, and the #703 session already cleaned its proof rules; renaming the file is simpler and leaves no trace in settings.

## 8. Design decisions

LOCKED (2026-11-04):
- D1. No agent update request in this work (§5, §7).
- D2. Fixture: two identical copies of a small real tech-pack PDF (pick any existing `*tech pack*.pdf` under `Decor/Generic Decor/` with `file_size > 0`; copy with `cp` inside an SSH session; `scp` is disabled) at `Decor/Generic Decor/Unused/_ai_test_681/a/ai-test-681 tech pack.pdf` and `.../b/ai-test-681 tech pack.pdf`. Identical bytes guarantee the same `quick_hash` and `file_size`. The other session's misnamed copies are renamed (not duplicated) so no extra junk remains.
- D3. Success criterion for Step 4: after the move `b → c` and a full scan, the record for path `.../b/...` has `is_deleted = true` and its newest `asset_path_history` row has `new_relative_path = 'retired-stale-duplicate:<id of the c record>'`; records `a` and `c` are live.
- D4. Fixture cleanup: delete the `_ai_test_681` folder on the NAS after the proof; the three asset rows stay (two live, one retired). Then, in the **next** full scan, `a` and `c` disappear from disk but nothing retires them (retirement fires only on a `created` ingest) — they remain live ghosts. To avoid leaving exactly the problem this work fixes, soft-delete those two rows by the normal admin path (asset detail → delete, or `admin-api` purge of the folder) and note the ids on #681. If the only tool is a direct DB write, it is a production write: do it through the app instead; never a raw `update` from a chat session.
- D5. Closing: one evidence comment on #681 (and a short one on #684 pointing to it), both closed by the AI; the two Nov 3 handoff files deleted in a docs-only PR (`chore(handoff): retire stale-retirement and missing-pdf handoffs (#681 #684)`); `docs/KNOWN_QUIRKS.md` #81 gets one sentence: "Proven live on <date> with fixture `_ai_test_681` (issue #681)."

OPEN:
- O1. Whether to also run #678's revive proof (move the file back) in the same fixture while it exists. Do it if #678's edge fix has already deployed (check `gh run list --workflow deploy-supabase.yml`), because it saves a full scan later; otherwise skip and tell #678.
- O2. Whether the two live fixture rows should be purged (D4) or left; default purge via app.

## 9. The plan

**Step 0 — Coordination check (5 min).** Read #681's latest comments (`gh issue view 681 --comments`). If the other session (last seen 4:13 PM EST) posted progress after this plan was written, continue from its state instead of redoing. Check `SCAN_PROGRESS.status` (read-only SQL: `select value->>'status', value->'counters', value->>'updated_at' from public.admin_config where key='SCAN_PROGRESS'`). Never request a scan while one is running; do independent work (Step 1-3 recording, Step 5 SQL drafting) until it finishes. A scan that reports no `updated_at` movement for 30 minutes is treated as broken: check the agent's `last_error` on Settings → Agents and report, do not restart containers.
Gate: you know whether the fixture was already renamed/ingested and whether a scan is running.

**Step 1-3 — Record the open gates.** Post one comment on #681 with the three live facts from §5 re-read at execution time (EST), signed with `$AI_GH_SIGNATURE`.
Gate: the comment is on #681 with fresh timestamps.

**Step 4 — Moved-file proof.**
4a. On `edgesynology1` (SSH, read-only account; the `/volume1/mac` share is the same one the bridge writes markers into, so file operations under `Decor/Generic Decor/Unused/` are expected to work — if `cp`/`mv` are denied, record it `Blocked —` with the exact error and stop): rename both misnamed copies to `ai-test-681 tech pack.pdf` (or, if absent, create them per D2 from a real tech-pack PDF). Verify `ls -l` shows two identical sizes.
4b. Request a full scan from the app (Settings → Scan). Wait for `SCAN_PROGRESS.status` to leave `running` (check at transitions, not on a timer loop; use `Monitor`-style waiting, no Bash sleep loops). Verify both rows exist: `select id, relative_path, is_deleted, file_size, quick_hash from public.assets where relative_path ilike '%_ai_test_681%'` → two live rows, same hash/size.
4c. On the NAS: `mv .../b/ai-test-681\ tech\ pack.pdf .../c/` (create `c`). Request a full scan. When finished, run the same query → `b` row `is_deleted = true`, `a` and `c` live; and `select * from public.asset_path_history where asset_id = '<b id>' order by detected_at desc limit 1` → `new_relative_path = 'retired-stale-duplicate:<c id>'`. Also confirm `c` inherited nothing wrong (AI fields empty on all three).
4d. If `b` is still live: read `SCAN_PROGRESS.counters`, Settings → Agents `last_error`, and the `c` ingest outcome; capture the exact state on #681; this is a bug report for a code fix in its own PR (out of scope here).
Gate: D3 satisfied; the SQL output pasted on #681.

**Step 5 — No new stale duplicates after the full scan.**
Run (read-only):
```sql
-- live same-identity pairs (candidates for ghosts); expect only known cases
select a.filename, a.quick_hash, a.file_size, count(*) as copies, array_agg(a.relative_path order by a.relative_path) as paths
from public.assets a where a.is_deleted = false and a.file_type = 'pdf' and a.file_size > 0
group by 1,2,3 having count(*) > 1 order by copies desc limit 50;
-- marker rows since Nov 3 cleanup
select count(*), max(detected_at) from public.asset_path_history where new_relative_path like 'retired-stale-duplicate:%' and detected_at > '2026-11-03 18:00+00';
-- the original lookup
\i scripts/list-missing-pdfs.sql   -- or paste its body
```
Pairs of live copies are legitimate when both files exist (genuine duplicates); the proof is that none of them is a Nov 3-style ghost: spot-check up to five pairs by `ls` on the NAS. The marker count since Nov 3 should be exactly the fixture (1) plus any genuine retirements the scan performed (list them; each must have a `retired-stale-duplicate:` survivor whose file exists).
Gate: a short table of results on #681 and a sentence "no new stale duplicates after full scan <request_id> finished <time> EST".

**Step 6 — Cleanup, close, delete handoffs.**
6a. Remove `_ai_test_681` on the NAS (`rm -r`), handle the two live fixture rows per D4.
6b. PR: delete `HANDOFF.d/2026-11-03T2209Z-hetz-claude-stale-retirement-activation.md` and `HANDOFF.d/2026-11-03T2210Z-hetz-claude-missing-pdf-records.md`; add the one sentence to `docs/KNOWN_QUIRKS.md` #81; update the coordinator handoff `HANDOFF.d/2026-11-05T0100Z-hetz-claude-search-and-tagging-coordinator.md` §6 tasks 2 and 3 to "done, see #681" (do not delete it; other tasks remain). `bin/ai-pr-wait` in background; merge.
6c. Close #681 and #684 with the evidence links. If Step 4 or 5 could not be finished, leave `- [ ] live proof` on #681 and do not close.
Gate: both issues closed, PR merged, `ls HANDOFF.d | grep 2026-11-03T22` shows only the coordinator file.

### Adversarial cases (trust boundary: files on the NAS drive DB writes through the agent)

| Input | Hostile / edge case | Proof or test |
|---|---|---|
| Fixture name | no PDF keyword → never ingested | §6 trap; Step 4a rename; verify two rows exist (4b) |
| Fixture copies | different bytes (e.g. one re-saved) → hash mismatch → `hash_mismatch` refusal | `ls -l` sizes equal + `md5sum` both before scanning |
| Survivor | copy `a` also moved → no live survivor at a readable path → kept | keep `a` in place during 4c |
| Share | unmounted/offline during scan → `stat` fails → record kept (by design) | existing bridge test `keeps the record on an unmounted share`; live: agent heartbeat healthy during 4c |
| Scan | requested while another runs → request ignored or queued | Step 0 rule: only one at a time |
| 0-byte copy | refused (`size_mismatch`/0-byte rule) | pick a PDF with `file_size > 0` |
| Open checkout on `b` | `open_checkout` refusal | none expected; check `asset_checkouts` for the id if 4d triggers |

## 10. Tests required

No code changes, so no new unit tests. Existing suites that cover the mechanism and must stay green on `main`: `supabase/functions/_shared/stale-asset-retirement.test.ts`, `apps/bridge-agent/src/stale-record-retirement.test.ts` (CI "CI" workflow). The live proof in Step 4 is the acceptance test; its SQL outputs on #681 are the artifact.

## 11. Constraints, standing rules, gotchas

- No code change in this plan; a discovered bug becomes its own PR. Branch + PR for the docs/handoff deletion; never push `main`; the AI merges.
- Production DB is read-only from sessions; all writes happen through the app or the agents. No raw `update`/`delete` SQL.
- Do not press start/reset on `PDF_BACKFILL`; do not request a second agent update; do not restart NAS containers; do not modify the self-updater.
- One scan at a time; wait at transitions, never a Bash sleep loop; thirty minutes without progress is broken (report, do not "still waiting" twice).
- NAS SSH alias `edgesynology1`: read-only account, no sudo, `scp` disabled. Long reads follow the `synology-long-running-operations` skill. Docker sudo ritual per memory `feedback_nas_sudo_block_ritual.md` only if logs are indispensable.
- Times in EST; sign posts with `$AI_GH_SIGNATURE`; Albert is never asked to click or type.
- Live proof stays on the same issue as a checklist item if unfinished; never a new issue.
- `#snapshot`, `Old`, `Archive`, `#recycle` are not live locations (quirk 81).

## 12. Access and environment

- `gh` authenticated on hetz; commit identity Albert's verified (`git var GIT_COMMITTER_IDENT`).
- Supabase MCP `execute_sql` works read-only (URL contains `qsllyeztdwjgirsysgai`; confirmed 4:46 PM EST). psql fallback: 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database", through `op run` with the pooler form.
- App admin login for scan requests and purge: 1Password vault `vibe_coding`, PopDAM admin tester item (see `docs/1password.md` and memory `project_popsg_tester_login.md`); never values.
- NAS: `ssh edgesynology1`; share root `/volume1/mac`; fixture folder `Decor/Generic Decor/Unused/_ai_test_681/`.
- Scan status: Settings → Scan Diagnostics (`src/pages/ScanDiagnosticsPage.tsx`) or `admin_config` keys `SCAN_REQUEST` / `SCAN_PROGRESS`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1-3 facts posted on #681 with EST times.
- [ ] Step 4 SQL shows `b` retired with marker to `c`; posted on #681.
- [ ] Step 5 results posted; no unexplained new ghosts.
- [ ] Fixture removed; fixture rows handled per D4.
- [ ] Docs/handoff PR merged (two handoffs deleted, quirk 81 sentence, coordinator handoff rows updated).
- [ ] #681 and #684 closed; this plan's STATUS table updated with the artifacts (comment URLs, PR number).

Risks and rollback: the fixture adds three asset rows; worst case they are purged through the app. A failed proof is information, not damage: nothing in this plan changes code or data outside the fixture. If retirement misfires on a real file during the full scan, the Nov 3 backup procedure (`UNDO.sql` on the NAS) is the documented recovery and the 2209Z handoff §5 describes it — copy that paragraph into #681 before deleting the handoff.

Open questions: O1, O2 (§8). Nothing requires Albert.

## Self-audit

1. **Executable without questions?** Yes: §5 gives the live state with timestamps and §9 Step 0 tells the implementer how to reconcile with the concurrent session; §6 explains the keyword trap that would otherwise stall the proof forever; every step has SQL or an observable gate; §12 names access by location.
2. **All background and dead ends?** Yes: §3 and §6 carry the Nov 3 history, the one-update rule, the two-copies requirement and why; §7 lists six rejected approaches including the temporary-rule shortcut.
3. **Goal clear for judgment calls?** Yes: §1 states the business outcome (no ghosts, cleanup held, issues closed) and the goal-wins rule; D4 anticipates the one place where the proof itself could create ghosts and says what to do.
