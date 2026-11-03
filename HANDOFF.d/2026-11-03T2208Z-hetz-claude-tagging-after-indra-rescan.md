---
issue: 680
status: OPEN
owner: claude session 5b6c9046-f7e2-4211-9963-9991fb92e509 (closed); next session takes over
---
# Handoff — full AI tagging after the Indra PDF rescan


## 0. Business decisions only the owner can make
**Already answered by Albert's "wait until the rescan finishes":** the run starts once the rescan and steps 2-5 in section 6 are done. His go for the run was not separately stated beyond that. Tell him before starting.

**A wrong guess is recoverable:**
- Asset-type words: use Albert's list in section 2 exactly. Recommendation: "costing sheet / licensing sheet" stays one paired label.
- Should a real designer whose first name is not on the known-names list be added? 31 files await this. Recommendation: show him the distinct names once in one message.

**Already settled, do not re-ask:** GLM (`z-ai/glm-5.3-flash`) over Muse ("GLM is better than Muse in every case"). Sheet designer names replace existing ones. Missing files get a nested session that uses SSH to `edgesynology1`. Tag pairing is after the model call, to save tokens. One model call does characters, tags and descriptions together.

## 1. What this application is
PopDAM is POP Creations' digital asset library for product art, tech packs and licensing sheets. Staff search it by character, product and tag. Code: https://github.com/u2giants/popdam3. Database: Supabase project `qsllyeztdwjgirsysgai`. Tagging runs in the Railway worker. PDF reading runs on the Windows agent `windows-render-agent` (edge-alient) against files on the NAS.

## 2. Goal and trigger
Albert wants trustworthy tags before spending on about 110,500 files. He asked (2026-11-03) for:
- More than 3 characters: name the most prominent character plus the words "group shot".
- Every selected character appears in the description and tags. Example: GFZ52SWMD06 Mando.ai missed Grogu.
- Licensed styles: "licensing sheet" also adds "costing sheet", and the reverse. Do this after tagging, in code, not in the prompt.
- Clear asset types, partly from file names: product photography (close-up, front view, 3/4 view, back view etc., and not "product photo"), product mockup, art, tech pack, costing / licensing sheet, size scale image, lifestyle photo.
- Use sheet text: product description goes into the description; material when known (coir); no invented phrases like "collage product". Metadata: files used, creative and technical designers, packaging type, original customer.

## 3. Current state (checked 2026-11-03, 5:08 PM EST)
**Live:** Indra rescan with field extraction (PRs 667-679, all merged and deployed). Stale duplicates retired: 5,683, with NAS backup; active PDFs 19,094. Sheet designers overwrite existing values, with undo table `asset_designer_sheet_backup` (212 files changed by 1:14 PM EST). Character load is live (shared-db PRs 5539, 5544, 5546). Tagger model is GLM.

**Running:** rescan, config `admin_config.PDF_BACKFILL`, mode `indra_rescan`, status running, 6,700 processed, 12,696 remaining, 618 failed, about 20 files a minute, expected finish about 5:30 AM EST Nov 4. None of the files read has used Tesseract.

**Not started:** every request in section 2 is unbuilt. The full run has not started; `AI_TAG_PARALLEL_RUN` is `{"enabled":false}`.

**Committed:** only this handoff is new in this session's closeout. No database claims held; closeout check passed at 5:08 PM EST.

## 4. What did NOT work
- First designer backfill accepted any text, so junk like "BATTERY BOX" and "MOCK UP" overwrote names. Restored 7 creative and 8 technical values; added the known-first-name rule.
- First rescan trial ran as ordinary backfill before deploy, and junk text was stored. Removed and re-run after parser fixes. Pressing start clears rescan mode, so never press it.
- "10 files a minute, slowed down" was a short-sample error. Hourly counts are 850-1,230. Do not investigate it.
- Re-running 24 Muse files replaced their Muse text live. Muse text survives only on a scratch comparison page that was sent to Albert.
- Over 8 tagging calls at once: 20 overloaded saves.

## 5. Key findings
- GLM spot-check: 31 of 35 right. Errors: Pluto for Donald, Marvel Logo as a label, Grogu missed. On 24 Muse files GLM was better, with new errors: Jack and Pooh taken from example photos, shell called a trident, Anna and Elsa missed.
- "Grogu" and "Child" are duplicate Star Wars character entries. Star Wars has no ships in the character list (an X-wing cannot be tagged as a character).
- Prompt: https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/tag-asset-contract.js . Tagger: https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/ai-tagging.ts and https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/ai-tagging-shared.ts . OCR: https://github.com/u2giants/popdam3/blob/main/packages/agent-common/src/indra-ocr.ts . Rescan loop: https://github.com/u2giants/popdam3/blob/main/apps/windows-agent/src/pdf-backfill.ts (one file at a time).
- Results: `public.pdf_text_samples` columns `extracted_fields`, `ocr_engine`, `indra_rescan_outcome`, `indra_rescan_error`.
- Failures so far: about 556 missing files, 63 over 100 MB (skipped by rule).

## 6. Exact next steps
1. Confirm rescan done: `PDF_BACKFILL.remaining` is 0. Do not press start. If paused or stale over 30 minutes, check the Windows agent heartbeat. You'll know when status is finished.
2. Start one nested session for missing files, SSH to `edgesynology1`, and correct paths, then re-read those files. Reconcile the 414 versus 474 prior counts. Done when each failure is relocated or proven gone.
3. Clean misreads with no undo copy ("aMEo", "BUYER") that filled blank designers, and list the 31 review names to Albert. Done when a query finds none.
4. Check the older bridge agent's update (reported 1.16.19). Done when its heartbeat shows the expected version.
5. Build section 2 on a branch with tests, merge, deploy. Merge "Grogu"/"Child" via `popcre/shared-db` (claim-first). Done when a re-run of the 35 sample files plus the 24 ex-Muse files shows each rule working, with results sent to Albert as a review page.
6. Tell Albert, then start the full run with `AI_TAG_PARALLEL_RUN` at concurrency 8 and `update_bulk_operation('ai-tag-parallel')`, about 6.5 days. Set it back to `{"enabled":false}` when finished. Done when all files have a tagged timestamp and a live sample passes.

## 7. Constraints and gotchas
Never restart tagging during nightly grouping at 1:00 AM EST. Heavy jobs slow search. Feature branch and PR; Albert does not merge, the AI does. PopDAM has no reviewer gate. Character and licensor data come from licensing records, never guesses. Replies to Albert follow his global format, 120 words maximum. Times in EST.

## 8. Access
Supabase MCP (confirm the URL contains `qsllyeztdwjgirsysgai` first). Secrets in 1Password vault `vibe_coding`. Railway connector failed to start on hetz this session. This machine is hetz, not edge-dev3.

## 9. Open risks (2026-11-03)
Numbers above go stale within the hour. Indra's misreads could feed bad text into descriptions, so check sample descriptions in step 5. Other handoff `2026-11-03T0021Z-hetz-claude-dam-tagging-coordinator` belongs to the coordinator; its task B is this work.

## Part (b): sub-agents and sessions
### Agent: Build Indra PDF rescan with fields
- **Asked:** rescan all PDFs with field extraction; later overwrite designers. **Did:** PRs 667-679, live. **Worktree:** finished. **Did NOT:** clean pre-rule misreads with no undo copy (step 3).
### Session: find-missing-files (PR 675) and retire-stale-duplicates (PR 677)
- **Did:** relocated and retired records. **Finished.** **Did NOT:** resolve the remaining missing files (step 2).

## Self-audit
1-3. Yes: sections 1-3 give background and state, 4-5 the failures and findings, 6 the actions and gates. 4. Yes: walked sections 1-9 and part (b); the two owner items are in section 0, and no technical approval is there.
