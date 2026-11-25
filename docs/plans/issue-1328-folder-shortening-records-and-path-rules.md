---
summary: Plan for #1328 (with folded #1354), #979 (with folded #968), #970 and #1007's STATUS finding — make the folder-shortening plan, handoffs and evidence records tell the truth, and fix the two Phase 3 code leftovers (workflow folder map merge, tag-filter test). Read its STATUS first.
kind: plan
status: open
read-when: correcting folder-shortening (#963) records or STATUS, or changing WORKFLOW_FOLDER_MAP handling in metadata-derivation
---

# Plan: folder-shortening records and Phase 3 leftovers — u2giants/popdam3#1328, #979, #970, #1007 (finding 3)

Issues covered:
- https://github.com/u2giants/popdam3/issues/1328 — pilot run-log PR #1326 (findings 1–3 and 7 here; findings 4–6 are rename-tool features in the [issue-1310 plan](issue-1310-folder-rename-engine-and-executor.md) step 7). Folded in: #1354 (PR #1353: watch-pass claim not supported by the run log; watch was ~18.5 h; Synology Drive check missing; a time later than the clock).
- https://github.com/u2giants/popdam3/issues/979 — evidence PR #978 (summary line, 90 vs 400 days, proof timeline). Folded in: #968 (PR #966 Phase 0 baseline: impact estimate contradicts its table; Phase 0 status/handoff contradictions incl. the skipped 0.6 owner gate; only 4 of 50 longest paths).
- https://github.com/u2giants/popdam3/issues/970 — Phase 3 PR #967 (findings 3 and 4 still open; findings 1–2 fixed, see §5).
- https://github.com/u2giants/popdam3/issues/1007 — finding 3 only (stale STATUS paragraph); its other findings are in the issue-1310 plan.

Parent plan (this plan edits only its STATUS paragraph, summary line and the stale "90 days" sentences, as every executor is required to; it does not restructure it): [`plan_folder_shortening_snapshot_restore.md`](../../plan_folder_shortening_snapshot_restore.md)
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm; read the truncated finding 7 of #1328 | ⬜ open | |
| 2 | Parent plan: STATUS paragraph, summary line, Phase 5 row, 90-day sentences | ⬜ open | |
| 3 | `docs/deployment.md` retention; regenerate `docs/INDEX.md` | ⬜ open | |
| 4 | Pilot run log: append the watch record (with its gaps) | ⬜ open | |
| 5 | Errata on the live-proof and baseline records | ⬜ open | |
| 6 | Old handoffs: mark superseded via a pointer, not edits | ⬜ open | |
| 7 | Code: merge WORKFLOW_FOLDER_MAP over defaults | ⬜ open | |
| 8 | Code: tag-filter test for the new folder words | ⬜ open | |
| 9 | PR, CI, merge, comment and close issues | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

Project #963 (shortening NAS folder names so designers can open every file) is mid-way: the pilot rename is done and about 4,100 renames remain. Every future session starts by reading the plan's STATUS and the evidence files. Today those say things that are not true ("Nothing on the NAS has been renamed", "24-hour watch passed", "90 days"). The goal is that **every record a session reads is accurate**, so nobody redoes finished work or skips an unfinished check — and that two small code gaps from Phase 3 cannot quietly break the folder-stage meaning for a customised install.

**If a step conflicts with this goal, the goal wins — stop and flag it on #963.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) indexes POP Creations' design files on a Synology NAS (share `mac`, write on `edgesynology1`, read copy on `edgesynology2` via ShareSync). Data lives in Supabase project `qsllyeztdwjgirsysgai`; structure is owned by `popcre/shared-db` (read-only mirror in `shared-db/`). Folder shortening (#963) is governed by `plan_folder_shortening_snapshot_restore.md`; evidence is under `verification/folder-shortening/`; handoffs under `HANDOFF.d/` are write-once (never edit another session's file — AGENTS.md).

Relevant code:
- `supabase/functions/_shared/metadata-derivation.ts` derives `workflow_status` from folder names using `DEFAULT_WORKFLOW_FOLDER_MAP` (now including `in dev`, `cust adopted`), overridable by `admin_config.WORKFLOW_FOLDER_MAP`.
- `apps/worker/src/handlers/tag-finish.ts:82` `FORM_TEXT_TAGS` (junk AI tags), tests in `apps/worker/src/handlers/tag-finish.test.ts`. The Railway worker auto-deploys on merge of `apps/worker/**`.

## 3. What triggered this work

Advisory AI reviews of PRs #966, #967, #978, #1005, #1326, #1353; the fixer deferred. The coordinator folded #968 into #979 and #1354 into #1328 on 2026-11-25.

## 4. Scope

In: the record corrections and the two code fixes listed.

### NOT in this plan
- Rewriting the parent plan's phases or design. Only the stale sentences named in step 2.
- Running any rename or the remaining pilot checks (Synology Drive on a designer PC is recorded as "not checked"; the Phase 5 session may do it).
- Rename-tool log features (issue-1310 plan).
- Changing `infer_path_attrs` (already fixed in shared-db).

## 5. Current state (verified on `main` @ `787c20b8`, 2026-11-25)

Fixed / moot:
- #970 f1–f2: `infer_path_attrs` now maps `In Dev`, accepts `Cust Adopted`, skips `^20\d\d$` year folders — vendored `shared-db/supabase/migrations/20261225091204_dam_customer_folder_alias.sql:79,85,104`, matching `docs/PATH_ATTRIBUTES.md:34-46`. The `src/types/assets.ts:37-41` comment is therefore true.

Still present:
- **S1** (#1328 f1, #1007 f3) `plan_folder_shortening_snapshot_restore.md:16`: "Phases 0–3 are done … Next: Phase 4. Nothing on the NAS has been renamed." Truth: Phases 0–4 and 6 done, Phase 5.1–5.3 done, Desperate Signs renamed 2026-11-24 3:12 PM EST, next is 5.4 (Burlington) pending Albert's yes (see `HANDOFF.d/2026-11-25T1545Z-hetz-claude-close-nested-folder-shortening-batches.md` §0).
- **S2** (#979 f1) line 2 summary and `docs/INDEX.md:171`: "phases 1-4 landed, snapshot restore remains".
- **S3** (#1328 f2, #1354) Phase 5 row (`:25`) says "pilot passed … 2026-11-25 9:45 AM EST" and "5.1–5.3 done". Facts: the watch was run early at Albert's request ("can we do it manually now so we can move this forward?", 2026-11-25 9:40 AM EST, quoted in `HANDOFF.d/2026-11-25T1511Z-hetz-claude-folder-shortening-phase5-batches.md` §0), ~18.5 h after the rename; results are in #963 comments (2026-11-24T22:47Z, 2026-11-25T14:41Z), not in the run log; Synology Drive on a designer PC was **not checked**; 5.1–5.2 evidence files exist but are uncited (`verification/folder-shortening/rehearsal-2026-11-24.md`, `run-rehearsal-desperate-e971b33e.md`, `run-revert-rehearsal-desperate-e971b33e.md`, `tools/folder-rename/execute.mjs` + `execute.test.mjs`). The quoted 9:45 AM EST was later than the clock when written (#1354 f3).
- **S4** (#1328 f3) pilot ran 3:12 PM EST Tuesday 2026-11-24, not off-hours as 5.3 requires; Albert asked for it then ("do those renames right now", 2026-11-24 — quoted in the 1511Z handoff §0). Not recorded in the run log.
- **S5** (#1328 f7) truncated in the issue and in the PR #1326 comment; full text is in the ai-review workflow run 45478841150 log.
- **S6** (#979 f2) `docs/deployment.md:361` "older than 90 days"; plan `:137`, `:169`, `:185` say 90 days. Truth: 400 days (`shared-db/supabase/migrations/20261111205556_dam_folder_rename_log.sql:129`).
- **S7** (#979 f3) `verification/folder-shortening/snapshot-restore-live-proof-2026-11-11.md:3-5`: test "about 6:50 PM EST" vs production apply "~6:55 PM EST".
- **S8** (#968) `verification/folder-shortening/path-length-baseline-2026-11-11.md:16` impact estimate "~10,000–17,700 files" contradicts its own table (max 7,785 over 220); only 4 longest paths (`:19-23`) vs 50 asked; 0.6 owner gate (10% of sampled documents had absolute links) not raised, reasoning "targets already fail" not recorded as a deviation; Phase 0 handoff `HANDOFF.d/2026-11-11T1846Z-…` says "Not started"; `\\edgesynology1\mac\` called 19 chars (it is 20).
- **S9** (#1328 f1) old handoffs `HANDOFF.d/2026-11-13T1645Z-hetz-claude-folder-shortening-phase4-freeze.md:21` ("Nothing on the NAS renamed") and `…-close-nested-folder-shortening.md` (`status: OPEN`, pilot as future).
- **S10** (#970 f3) `metadata-derivation.ts:81` `workflowFolderMap = wfValue;` — an override replaces the defaults, so `in dev`/`cust adopted` vanish for any install with an override. Whether production has an override is unknown (read-only check in step 7).
- **S11** (#970 f4) `tag-finish.test.ts:118` junk list lacks `in dev`, `cust adopted`.

## 6. Key findings

The records drifted because each PR updated the STATUS table row it touched but not the "read this first" sentence, the summary line, or older handoffs. Evidence was posted to #963 comments rather than into the run log the plan names as the record.

## 7. Approaches considered and REJECTED

- **Editing other sessions' handoff files**: forbidden (write-once). Instead the new handoff for this plan and the parent plan's STATUS say which handoffs are superseded; frontmatter `status` of an old file may be flipped to `SUPERSEDED` only if the repo's handoff rules allow status-only edits — check `docs/agents-reference.md` handoff section; if not allowed, leave them.
- **Rewriting dated evidence files**: evidence is dated history; append an "Errata (date)" section instead of changing what was recorded.
- **Re-running the 24 h watch or Phase 0 baseline now**: the renames moved on; the 5.7 close-out proof re-runs 0.1 over the whole tree anyway. Record the gaps honestly instead.
- **Raising the 0.6 link question to Albert now**: the renames are authorised and the linked images already fail to resolve, so renaming does not make them worse; record the deviation and its reason. If the implementer finds a sampled link that *does* resolve today into a folder still to be renamed, stop and raise it on #963 as a plain business question.

## 8. Design decisions

Locked: records are corrected by additions (errata), never by deleting what was recorded. Albert's quoted authorisations stand as recorded (dates above). Open: none.

## 9. The plan

**Step 1 — Re-confirm.** Re-check S1–S11 on current `main` (the Phase 5 session may have updated STATUS since). Read finding 7 of #1328: `gh run view 45478841150 -R u2giants/popdam3 --log | grep -n "Minor" -A20` (or the run's review artifact). Add any still-true item to step 2 or 4. `lead-only` (judgment). Gate: finding 7 text noted in the PR description.

**Step 2 — Parent plan sentences (S1, S2, S3, S4, S6).** In `plan_folder_shortening_snapshot_restore.md`:
- Line 2 `summary:` → "Shorten NAS folder names (#963): phases 0–4 and 6 done, restore-from-snapshot live; Phase 5 renames in progress (pilot done 2026-11-24); read STATUS first."
- Line 16 paragraph → what is renamed (Desperate Signs subtree and its `_FINISHED` twin, 2026-11-24 3:12 PM EST, batch `6859574e…`), what is next (5.4 Burlington, waiting on Albert's yes per the 1545Z handoff), link to the current Phase 5 handoff.
- Phase 5 row → "5.1–5.2 done (cite the four files in S3); 5.3 pilot done: ran on owner request during working hours; watch run early at owner request (~18.5 h), scan/ShareSync/both Hyper Backup/Older copies fine, Synology Drive designer check not done — see run log watch section"; keep the times as originally observed but never later than the commit time.
- `:137`, `:169`, `:185`: "90 days" → "90 days before Phase 1; 400 days since (shared-db migration 20261111205556)".
`lead-only` (wording of status claims). Gate: `grep -n "Nothing on the NAS" plan_folder_shortening_snapshot_restore.md` returns nothing; table rule (row cites openable evidence) holds.

**Step 3 — Deployment doc and index (S6, S2).** `docs/deployment.md:361` → 400 days. Run `ai-doc-health --repo . --fix-index` (tool from `popcre/ai-devops`); if not installed, edit `docs/INDEX.md:171` by hand to match the new summary and note it. `helper-ok`. Stop-and-ask: if the index tool rewrites unrelated lines. Gate: `git diff docs/INDEX.md` shows only that entry (plus this plan set's entries).

**Step 4 — Pilot run log watch section (S3, S4, #1328 f4–f6 records).** Append to `verification/folder-shortening/run-pilot-desperate-6859574e.md` a section "Watch and notes (added <date> from #963 comments)": scan result (90 assets, 0 new, 0 retired, customer still "Desperate Signs"), ShareSync replayed as renames within a minute, Hyper Backup Backblaze 8:20–9:26 PM EST and edge1→bac 1:05 AM EST, Older copies shows pre-rename version, Synology Drive designer check **not done**, watch length ~18.5 h by owner request (quote), run time 3:12 PM EST weekday by owner request (quote), ShareSync idle pre-check **not recorded**, scan state before/after (from the 1511Z handoff: auto-scan on now), customer/program summary — run read-only `select customer, program, count(*) from public.assets where is_deleted is not true and relative_path like 'Decor/Character Licensed/____New Structure/In Development/Customer Adopted/%Desperate%' group by 1,2;` (escape `_` properly or use `left()` prefix as `execute.mjs` does) and paste the result. Link each fact to the #963 comment URL. `lead-only` (production read + record). Gate: the section exists with links; no time later than the commit time.

**Step 5 — Errata on older records (S7, S8).** Append "Errata (<date>)" to `snapshot-restore-live-proof-2026-11-11.md`: get the real apply time from the shared-db deploy run of PR #6078 (`gh run list -R popcre/shared-db …` / the run log timestamps) and state the restore test time relative to it; if the test was before the apply finished, say the function existed earlier in the run with the evidence. Append "Errata" to `path-length-baseline-2026-11-11.md`: corrected bracket (at a 35–50 char prefix, ~1,770–7,785 files fail, from the table), prefix length 20 not 19, only 4 longest listed (Phase 4 used the full listing instead — cite `verification/folder-shortening/summary.md`), 0.6 deviation and reason (§7), `.indd` half of the sample not done. `lead-only` (facts). Gate: both errata present with sources.

**Step 6 — Old handoffs (S9, S8 handoff).** Per §7: do not edit them. In this plan's handoff and the parent plan STATUS line, list `HANDOFF.d/2026-11-11T1846Z-…`, `2026-11-13T1645Z-…-phase4-freeze.md`, `2026-11-13T1645Z-…-close-nested-folder-shortening.md` as superseded by the 2026-11-25 1511Z/1545Z handoffs. If repo rules allow a frontmatter-only `status:` change, set them to `SUPERSEDED`. `helper-ok`. Stop-and-ask: if the rules are unclear. Gate: pointer lines present.

**Step 7 — Merge the workflow folder map (S10).** First read-only: `select value from admin_config where key='WORKFLOW_FOLDER_MAP';` on production. Then in `metadata-derivation.ts:75-81` use `{ ...DEFAULT_WORKFLOW_FOLDER_MAP, ...wfValue }` (override wins per key; defaults fill gaps). If production has an override that deliberately *removes* a default, stop and ask the lead (it would change behaviour). Add a test in the existing metadata-derivation test file (`supabase/functions/_shared/metadata-derivation*.test.ts`; create `metadata-derivation-workflow-map.test.ts` if none): override with one key still maps `In Dev` → `in_development`. `lead-only` (changes derived production data). Gate: test passes; PR notes the production override value (or "none").

**Step 8 — Tag-filter test (S11).** Add `"in dev"`, `"cust adopted"` (and `"in development"`, `"customer adopted"` if they are in `FORM_TEXT_TAGS`) to the junk-tag cases at `apps/worker/src/handlers/tag-finish.test.ts:118`. `helper-ok`. Stop-and-ask: if a case fails (means the code differs from the comment). Gate: worker tests green (`npm --prefix apps/worker test`).

**Step 9 — Land.** Branch `claude/issue-1328-folder-records`, PR to `main`, merge when required checks pass (worker auto-deploys — confirm the Railway deploy succeeded; edge functions via deploy-supabase). Comment on #1328, #979, #970, #1007 (signed `$AI_GH_SIGNATURE`) listing what was corrected and where; close #1328, #979, #970. #1007 closes when the issue-1310 plan finishes its other findings. `lead-only`.

## 10. Tests required

- New/extended metadata-derivation test: "custom WORKFLOW_FOLDER_MAP keeps default In Dev and Cust Adopted"; "override key wins over default".
- `apps/worker/src/handlers/tag-finish.test.ts`: `isJunkTag("in dev")`, `isJunkTag("cust adopted")` true.
- Must stay green: `npm test`, `npm run typecheck`, `npm --prefix apps/worker test`; doc-health advisory check.

## 11. Constraints and gotchas

- Never push to protected `main`; AI merges; reviews advisory.
- Never edit another session's handoff body; never delete recorded evidence — append errata.
- Every new Markdown file needs the four-key header; regenerate the index.
- Quote times in EST/EDT computed from the clock; never later than now.
- Read-only production queries only (Supabase MCP or psql under `op run`).
- Another session may be updating the parent plan STATUS for Phase 5 batches at the same time — rebase and keep their row content.

## 12. Access and environment

- `gh` as `u2giants` (for `popcre/shared-db` run logs too). Supabase read via MCP or psql (password in 1Password `vibe_coding`).
- `ai-doc-health` from `popcre/ai-devops` (installed by the `sync-dotfiles` skill).

## 13. Definition of done, risks, open questions

Done when: STATUS rows ✅ with evidence; PR merged; worker and edge deploys green; comments posted; #1328, #979, #970 closed; #1007 left for the issue-1310 plan.
Risks: a merge of the workflow map changes `workflow_status` for some assets if production has an override — step 7 checks first. Open: finding 7 text (step 1).

## Self-audit

1. *Fresh session without questions?* Yes — §5 lists every wrong sentence with its correct value and source; §9 gives the replacement text and gates.
2. *Background and rejected options?* Yes — §6, §7 (handoff and evidence edit rules, no re-runs, the 0.6 reasoning).
3. *Goal clear?* Yes — §1: every record a session reads is accurate.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issues #1328, #979, #970 and #1007 finding 3. Read AGENTS.md, then docs/plans/issue-1328-folder-shortening-records-and-path-rules.md (STATUS first), then the parent plan's STATUS.
Do steps 1, 2, 4, 5, 7, 9 yourself. Hand steps 3, 6, 8 to your helper, one at a time.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring every stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run the read-only production queries, write every status claim, review helper diffs, and run all tests. Update STATUS in the same PR.
```
