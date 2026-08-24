---
issue: 949
status: OPEN
owner: codex/closeout-paramount-preview-capture
---

# Paramount full capture against repaired preview

## 0. Decisions only the owner can make

**None are required now.** The next action is a reversible preview-only capture using already-authorized licensed source data.

Already settled — do not re-ask:

- Albert approved retiring migrations `20260814233342` and `20260814233423` on 2026-08-24. They are hard-blocked and must never run.
- Albert authorized preview-only rehearsal of Paramount migrations `20260814193351`, `20260814213043`, and `20260814223552` and explicitly prohibited production. Those three rehearsals are complete.
- Production remains forbidden. Ask Albert about exact production promotion only after a brand-new full Paramount capture succeeds on preview and all verification gates pass.

## 1. What this application is

The Paramount Creative Library capture preserves licensed, account-entitled metadata and direct source relationships for POP Creations. Private source records live only in `C:\repos\licensor-source-data`. The public `u2giants/shared-db` repository owns the shared Supabase database shape and the Paramount loading functions, but licensed rows and allowlists must never be copied into it.

The capture writes application-owned rows into Paramount `plm.pmt_*` landing tables through the supported sync tool. Preview project `mvpkijzfmfcxhnzqogzs` is the only authorized database for this work. Production project `qsllyeztdwjgirsysgai` is a never-write target for this workstream.

## 2. What this session set out to do and why

This session investigated six migrations merged on 2026-08-14 but never applied anywhere. It established that Paramount captures were blocked because the current sync tool sends the normalized metadata shape while the live loader was older. Albert authorized the three exact Paramount migrations on preview only.

The session then documented the remaining real-capture job in `fix_Paramount_capture_against_preview.md` and merged that document through PR #1411. A later private source-data attempt exposed a second loader defect: valid optional `raw_value` content represented as JSON `null` was rejected by the database safety constraint. Structural issue #1418 and PR #1421 repaired that boundary and rehearsed it on preview. The remaining goal is a brand-new full capture against the repaired preview loader.

## 3. Current state — what is true now

- PR #1411 merged the durable execution brief as merge commit `1d70642d8405fbad3030bef4659ead7c02978dff`.
- Preview workflow run `32721695779` applied exactly:
  - `20260814193351_pmt_duplicate_name_columns_deprecated.sql`
  - `20260814213043_pmt_metadata_element_normalization.sql`
  - `20260814223552_pmt_collection_paramount_term_normalization.sql`
- The first private full capture passed completeness validation and the public sync tool passed 70/70 focused tests. The capture reached `pmt_metadata_element`, then failed closed on the first `pmt_asset_metadata_value` chunk. Its failed record was preserved for diagnosis; do not resume it.
- Root cause: the loader used `r->'raw_value'`. A present JSON `null` remains JSONB `null`, not SQL NULL, so `pmt_amv_raw_value_shape_chk` correctly rejected it.
- PR #1421 merged repair migration `20260824135515_pmt_loader_raw_value_json_null_normalization.sql` as merge commit `2731b108e464bfcb558986fc911669e5d2de2959`.
- The repair was independently approved at the exact reviewed SHA and applied only to preview by successful run `32738436612`. All production jobs were skipped.
- The loader constraint remains active; unsafe non-object values and objects containing blocked URL/header keys remain rejected.
- A new full capture after the repair has **not** run. This is the only open capability-verification step.
- Public tracking issue #949 remains open. Private continuation is tracked in `u2giants/licensor-source-data#43`; re-read its current state before acting.
- This closeout uses branch `codex/closeout-paramount-preview-capture`. The handoff and update to `fix_Paramount_capture_against_preview.md` must be merged before this handoff is considered durable.

## 4. Everything tried that did not work

1. **Treating green schema contracts as full proof.** The migrations and 70/70 focused tool tests passed, but the real capture still failed on a source shape the synthetic path did not exercise. Do not declare the capability repaired from migration or unit tests alone.
2. **The first post-migration full capture.** It failed safely because JSON `null` is not SQL NULL inside PostgreSQL JSONB. The failure was useful evidence, not permission to omit `pmt_asset_metadata_value`, weaken `pmt_amv_raw_value_shape_chk`, restore the old loader, or bypass normalization.
3. **Resuming the failed capture.** Do not do this. It is marked failed and preserved for diagnosis. The repair must be verified with a new capture identity so completion evidence is unambiguous.
4. **Broad migration commands.** Never use plain `supabase db push` or `--include-all`; the repo contains intentionally retired, held, and unrelated migrations.

## 5. Root causes and key findings

- The original production blockage is a contract mismatch: current `tools/sync-paramount-creative-library.mjs` sends `pmt_metadata_element`, while production still lacks the three previewed Paramount migrations.
- The first real preview capture found a separate loader-boundary bug. PR #1421 changed only `r->'raw_value'` to `nullif(r->'raw_value', 'null'::jsonb)` in the re-derived current function body.
- The constraint was doing its job. The correct repair normalized a valid absence at the loader boundary and preserved rejection of unsafe shapes.
- A successful schema apply is not a successful capture. Completion requires a brand-new capture to begin, load every target, finalize, and reconcile against the private authorized input.
- Source-data rows belong to the private source-data session under `AGENTS.md` section 0.0-B. The shared-db orchestrator owns structure, not this row-writing capture.

## 6. Exact next steps

1. Start a fresh task in `C:\repos\licensor-source-data`. Read private issue #43, `C:\repos\shared-db\fix_Paramount_capture_against_preview.md`, and the `paramount-creative-library-scrape` skill. If re-scraping or refreshing the portal, also load `licensor-incremental-capture`. **Gate:** the task can state the authorized private input, current capture completeness, and exact preview-only boundary without exposing any licensed row.
2. Before any write, prove the linked database is preview project `mvpkijzfmfcxhnzqogzs`, independently prove it is not production `qsllyeztdwjgirsysgai`, and verify the preview ledger contains the original three Paramount versions plus `20260824135515`. Confirm retired versions `20260814233342` and `20260814233423` remain absent. **Gate:** exact target and ledger proof are recorded without credentials or licensed values.
3. Re-run the private completeness validator and the focused public Paramount tool tests. Use the current supported tool invocation from checked-in help/tests; do not guess flags. **Gate:** private completeness passes and the public focused suite passes before loading.
4. Run a **brand-new** full Paramount capture against preview. Do not resume the failed capture. **Gate:** a new capture identity begins, every expected target loads, and finalization reports complete.
5. Verify `pmt_metadata_element` is accepted; JSON-null and omitted `raw_value` store as SQL NULL; real safe objects round-trip; unsafe shapes remain rejected; metadata values retain type and links; `plm.pmt_collection.paramount_term` remains absent; and `api.pmt_style_guides.paramount_term` still exposes `Collection`. Reconcile aggregate counts and ID-set hashes privately. **Gate:** all checks pass and no licensed value appears in public evidence.
6. Add a sanitized result to issue #949 and update `fix_Paramount_capture_against_preview.md` STATUS. Delete this handoff in the same finishing PR under the successor rule. **Gate:** durable public status says complete or names the exact new failure, while detailed evidence remains private.
7. Only after successful preview proof, present Albert one plain-English production decision for the exact required migration set, including repair version `20260824135515`. **Gate:** no production action occurs without a new explicit authorization naming the exact production action.

## 7. Constraints and gotchas in force

- Production is forbidden. No production workflow, database write, capture, dry-run promotion, or secret use is authorized.
- Prove the database target immediately before every write; an earlier proof is not enough.
- Licensed Paramount rows, allowlists, names, extracts, screenshots, and reconciliation evidence remain only in the approved private repository. Public evidence is identifiers, aggregate counts where permitted, hashes, and pass/fail status only.
- Use the user's already-authenticated Chrome session for portal access. Albert handles login and MFA. Never inspect or record credentials, cookies, browser storage, bearer tokens, or raw request headers.
- Capture metadata only; never download media, art, PDFs, videos, previews, or originals.
- Do not infer relationships. Preserve only direct source relationship pairs and reject malformed values.
- Do not remove, weaken, disable, bypass, or replace the normalized metadata capability or its safety constraint to make the capture pass.
- Use a new capture identity. A failed capture is evidence, not a resumable success record.
- This is source-data/application-row work, not orchestrator schema work, unless a new failure proves another structural change is needed.

## 8. Access and environment

- Public repo: `C:\repos\shared-db`, GitHub `u2giants/shared-db`.
- Private source repo: `C:\repos\licensor-source-data`, GitHub `u2giants/licensor-source-data`.
- Preview project identifier: `mvpkijzfmfcxhnzqogzs`.
- Production never-write identifier: `qsllyeztdwjgirsysgai`.
- Secrets belong in 1Password vault `vibe_coding`; reference them through approved protected tooling and never print values.
- Portal access uses Albert's authenticated Chrome tab. Login/MFA may require Albert, but no owner decision is otherwise pending.
- Relevant public evidence:
  - PR #1411: <https://github.com/u2giants/shared-db/pull/1411>
  - First three-version preview run: <https://github.com/u2giants/shared-db/actions/runs/32721695779>
  - Structural repair issue #1418: <https://github.com/u2giants/shared-db/issues/1418>
  - Repair PR #1421: <https://github.com/u2giants/shared-db/pull/1421>
  - Repair preview run: <https://github.com/u2giants/shared-db/actions/runs/32738436612>
  - Public umbrella issue #949: <https://github.com/u2giants/shared-db/issues/949>

## 9. Open questions and risks

- The repaired loader has not yet processed a complete real capture. Another source-shape defect may surface; diagnose and preserve the capability rather than suppressing the symptom.
- The exact private capture state and source-data issue #43 may move after this handoff. Re-read the private issue and repository before acting.
- Production still lacks the original three Paramount migrations and the JSON-null repair. Paramount production capture remains unavailable until a later governed production authorization and promotion.
- `supabase/tests/pmt_raw_value_json_null_contracts.sql` carried a `LAST RUN` placeholder when issue #1418 closed. This is a small repository-maintenance documentation follow-up and does not block the new private preview capture; verify current `main` before filing duplicate work.

## Self-audit

1. **Yes — a brand-new developer can continue without chat context.** Sections 1–3 define the application, repositories, business purpose, exact current commits, preview runs, failure, repair, and unfinished state; section 6 gives ordered executable steps with a verification gate for each.
2. **Yes — the handoff preserves the session's non-obvious knowledge.** Sections 4–5 record why the first real capture failed, why green tests were insufficient, why the failed capture must not be resumed, and why the constraint must survive.
3. **Yes — every execution dimension is covered.** Background and goal are in sections 1–2; current state and evidence in section 3; failed attempts in section 4; root cause in section 5; exact actions in section 6; constraints in section 7; access in section 8; and remaining risks in section 9.
4. **Yes — section 0 contains every owner matter found by a line-by-line sweep of sections 1–9.** No owner decision is required now. The only future owner decision is exact production authorization after preview success, and section 0 records that settled timing and prohibition. Login/MFA is an access action, not a business ruling, and is also named in sections 7–8.
