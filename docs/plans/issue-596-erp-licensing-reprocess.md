# Plan: Review finding: u2giants/popdam3#595 fix(licensing): ERP decides product licensing; resolve codes via taxonomy (u2giants/popdam3#596)
Issue: https://github.com/u2giants/popdam3/issues/596
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Measure the live damage (read-only count of "unlicensed but has a licensor") | ⬜ open | |
| 2. Full `reprocess-metadata` honours ERP's `is_licensed` (finding 1) | ⬜ open | |
| 3. Non-licensed-division branch returns `is_licensed: false` (finding 2) | ⬜ open | |
| 4. Stale contract comments and docs corrected (finding 3) | ⬜ open | |
| 5. Recover / re-derive the truncated finding 4 | ⬜ open | |
| 6. Regression tests | ⬜ open | |
| 7. PR, CI, merge, edge-function deploy verified | ⬜ open | |
| 8. Live proof: run reprocess, re-measure step 1 → 0, close #596 | ⬜ open | |

**Where a fresh session starts:** step 1. **Nothing in this finding is fixed on `main`**
(verified at `01fcfc34`, 2026-11-04): `metadata-handlers.ts:159–166` still writes the
folder value, `licensing-resolution.ts:169–171` still returns no `is_licensed`, and every
stale comment/doc line the review listed is still there.

---

## 1. The ultimate goal (plain business English)

Whether a product is "licensed" (Marvel, Disney…) is decided by the company's ERP
(ColdLion) whenever ERP knows the style number — not by which NAS folder the file sits
in. PR #595 made ingest and file moves obey that rule, but the bulk "reprocess
metadata" job still obeys the folder, so every time someone runs it, assets ERP says are
licensed flip back to "unlicensed" (while keeping a licensor). Those products then vanish
from the Licensed filter and the licensing team's counts are wrong. The goal: **every
write path agrees that ERP decides**, the one hole in the rule is closed, the written
contract says so, and a test stops it regressing.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`): Digital Asset Manager for licensed product art; see
`AGENTS.md`. Relevant parts here are the Supabase edge functions in
`supabase/functions/` (Deno; deployed by `.github/workflows/deploy-supabase.yml` on
changes under `supabase/functions/**`, project `qsllyeztdwjgirsysgai`) and the Railway
worker in `apps/worker/` that drives bulk operations by calling the `admin-api` edge
function. Business docs for licensing live in `docs/ERP_ENRICHMENT_PLAN.md`,
`docs/KNOWN_QUIRKS.md` (quirk 72) and `docs/BULK_JOBS.md`.

## 3. What triggered this work

PR #595 (`fix/erp-licensing`, merged 2026-10-30 02:09 UTC, commit `fbb6f3ba`) changed
`supabase/functions/_shared/licensing-resolution.ts`, its test, and
`supabase/functions/agent-api/index.ts` so that `resolveAuthoritativeLicensing()` returns
ERP's `is_licensed` and the three agent-api call sites override the folder flag. The
advisory review (reviewer `stepfun`, run 40989969957) filed four findings as #596:

1. **High** — `_shared/admin-handlers/metadata-handlers.ts:159–166`: full-mode
   `reprocess-metadata` still writes the folder-derived `is_licensed` and discards
   `licensing.is_licensed`.
2. **Medium** — `licensing-resolution.ts` non-licensed-division branch returns no
   `is_licensed`, so the folder flag survives even though ERP knows the item.
3. **Medium** — stale comments/docs claiming path-authoritative `is_licensed`.
4. **Truncated** — the GitHub issue body itself ends at
   "`**4. supabase/functions/_shared/licensi` [findings truncated]"; the review run log
   (40989969957) does not carry the text either. See step 5.

**Why the fixer failed:** run 40990232428 shows
`remote: Permission to u2giants/popdam3.git denied to github-actions[bot]` → `403` →
`push of review-fix/596 failed`. This repo's caller workflow
`.github/workflows/review-fixer.yml:26–27, 36–37` grants `contents: read`, so the bot
could not push its branch. Later fixer runs in this repo succeeded (#614, #625, #711 are
`fixer-done`), so the shared fixer's push path has since been changed upstream; no
workflow change is needed here. The finding itself was never applied — fix it by hand.

PR #597 (`1174a544`, after #595) added the style-number-only ERP fallback; it did not
touch any of the lines above.

## 4. Scope

**In:**
- `supabase/functions/_shared/admin-handlers/metadata-handlers.ts` full-mode ordering.
- `supabase/functions/_shared/licensing-resolution.ts:169–171` branch.
- Comment/doc corrections in `agent-api/index.ts`, `metadata-derivation.ts`,
  `docs/KNOWN_QUIRKS.md` quirk 72, `docs/BULK_JOBS.md`, `docs/ADMIN_OPERATIONS.md`.
- Tests in `licensing-resolution.test.ts` and a new reprocess test.
- One production `reprocess-metadata` run as live proof (via the normal admin UI /
  worker path, not SQL).

**NOT in this plan:**
- `fill-missing-licensing` mode (`metadata-handlers.ts:18–97`) — guarded on NULLs and
  already correct per the review.
- Changing which divisions count as licensed (`["CW001","SP001"]`, line 169) — business
  rule from #595, LOCKED.
- Style-group licensing propagation beyond what `agent-api/index.ts:902–915` already does.
- Any shared-db change (none needed).
- The review-fixer workflow permissions (upstream popcre/ai-devops; working again).

## 5. Current state of the code (verified 2026-11-04 at `01fcfc34`)

- `supabase/functions/_shared/licensing-resolution.ts`
  - 17–30 `LicensingResolution` with optional `is_licensed?: boolean | null` ("null leaves
    the folder rule in charge").
  - 133–171 `resolveAuthoritativeLicensing(db, isLicensed, parsed, maps?)`: 141 no SKU →
    folder rule; 143–166 ERP lookup by style+division then style-only (PR #597);
    167 not in mirror → folder rule; **168 no licensor code → `is_licensed: false`**;
    **169–171 division not in CW001/SP001 → `emptyResolution("coldlion_item_is_not_in_a_licensed_division", true)` with NO `is_licensed`** (finding 2);
    173–230 licensor/property resolution, all returning `is_licensed: true`.
- `supabase/functions/_shared/admin-handlers/metadata-handlers.ts`
  - 99–108 `handleReprocessAssetMetadata(body)`; full mode when `mode` absent.
  - 157 `derived = await deriveMetadataFromPath(...)`; **159–161 writes
    `updates.is_licensed = derived.is_licensed` from the folder**; 166
    `licensing = await resolveAuthoritativeLicensing(db, derived.is_licensed, parsed, licensingMaps)`
    — `licensing.is_licensed` is never read (finding 1). 167–168 write
    `licensor_id`/`property_id` from ERP.
- `apps/worker/src/handlers/metadata-reprocess.ts:19–22` — full mode sends
  `{ action: "reprocess-asset-metadata", offset, batch_size: 25 }` (no `mode`), so the
  Settings bulk op hits the broken path.
- `supabase/functions/agent-api/index.ts` — correct override at 1064–1066 (ingest),
  1127 (hash-move), 1464–1465 (move); **stale comments at 902** ("aligned with
  path-authoritative rule") and **1056–1057** ("is_licensed is intentionally EXCLUDED…
  Path-derived is_licensed… is the authoritative source").
- `supabase/functions/_shared/metadata-derivation.ts:4` ("Single source of truth for
  workflow_status and is_licensed") and `:64` ("is_licensed is path-authoritative") — stale.
- `docs/KNOWN_QUIRKS.md:1033–1070` quirk 72: line 1050 "Path metadata derives only
  `is_licensed` and `workflow_status`", 1055 "Canonical IDs come through exact
  `core.taxonomy_source_ref` rows", 1063–1064 "Do not change because: adding path or
  fuzzy-name fallback…" — stale: #595 added `core.licensor.code` /
  `core.property.code` fallbacks (`licensing-resolution.ts:69–83`, `184`, `220`) and
  flipped `is_licensed` authority.
- `docs/BULK_JOBS.md:35` lists `reprocess-metadata` writing `is_licensed`;
  `docs/ADMIN_OPERATIONS.md:216` says "Re-derives path-based metadata (licensor_id,
  property_id, …)" — both need the ERP-authority wording.
- Tests: `supabase/functions/_shared/licensing-resolution.test.ts` (4 cases, map-based,
  no DB); `admin-handlers/metadata-fill-licensing.test.ts` (fill mode + unknown-mode;
  mocks `licensing-resolution.ts` with `resolveAuthoritativeLicensing: async () => ({})`
  and `deriveMetadataFromPath: async () => ({})` at file top, lines 6–7). Edge-function
  tests run under root vitest (`vitest.config.ts:29` includes `supabase/functions/**/*.test.ts`).

## 6. Key findings and root cause

- Root cause of finding 1: in `metadata-handlers.ts` the folder-vs-ERP decision is made
  (159) before ERP is consulted (166); the agent-api sites were migrated to "resolve
  first, then override `derived.is_licensed`" and this site was not.
- Effect on data: an asset ERP marks licensed but stored under `Decor/Generic Decor/**`
  (or anywhere outside `Decor/Character Licensed/**`, `metadata-derivation.ts:64–68`)
  gets `is_licensed=false` + `licensor_id=<ERP licensor>` after each full reprocess.
  Step 1 measures how many rows are in that state today.
- Finding 2 is a rule gap, not a crash: `emptyResolution()` (line 48) does not set
  `is_licensed`, so callers fall back to the folder. Line 168 (no licensor code) already
  returns `is_licensed: false`; line 169–171 is the only ERP-known branch that stays silent.
- The full-mode handler cannot be unit-tested through `handleReprocessAssetMetadata`
  without a fake `serviceClient` — `metadata-fill-licensing.test.ts:4` mocks
  `serviceClient: () => ({})`. The cleanest testable fix is to extract the per-asset
  decision into a pure function (step 2).

## 7. Approaches considered and REJECTED

- **Make `deriveMetadataFromPath` itself consult ERP.** Rejected: it is a pure path
  function used by the bridge counters and by `workflow_status`; mixing in DB reads
  changes its contract and every caller's error handling.
- **Return `is_licensed: isLicensed` (the folder value) from the division branch to
  "document" the current behaviour.** Rejected: contradicts the stated rule at lines
  139–140 and keeps the item counted as unresolved licensing forever.
- **Drop `is_licensed` from `reprocess-metadata` entirely (leave it to ingest).**
  Rejected: existing production rows were never bulk-repaired (quirk 72 "Existing
  production data was not bulk repaired"); the reprocess job is the only repair path.
- **Fix the fixer workflow permissions in this repo.** Rejected: later fixer runs
  succeeded unchanged; the failure was upstream and is past.

## 8. Design decisions

- **LOCKED (PR #595, 2026-10-30):** ERP decides `is_licensed` whenever it knows the style
  number; folder rule only for items ERP lacks; licensed divisions are `CW001`, `SP001`.
- **LOCKED (this plan):** the non-licensed-division branch returns
  `{ ...emptyResolution("coldlion_item_is_not_in_a_licensed_division", false), is_licensed: false }`
  — ERP answered ("not a licensed division"), so the item is unlicensed and NOT counted
  as an unresolved licensor (consistent with line 168). Reason string is kept for
  diagnostics. Rationale: the review offered "return `is_licensed: false` OR explain why
  the folder survives"; no business reason for the folder to survive exists, and an
  unlicensed item with `unresolved_licensor: true` would inflate the bridge's
  missing-licensor counters (quirk 72) for products that are simply generic.
- **LOCKED (this plan):** full reprocess resolves ERP first and derives the effective
  flag as `licensing.is_licensed ?? derived.is_licensed`, mirroring
  `agent-api/index.ts:1066`.
- **OPEN (implementer):** whether to also write `licensor_code/licensor_name/
  property_code/property_name` to `style_groups` from the reprocess job. Criterion: do
  NOT — keep scope to the finding; style-group alignment is `rebuild-style-groups`'s job.

## 9. The plan — ordered steps

### Step 1 — Measure the live damage (read-only)
- Production SQL, read-only:
  `select count(*) from public.assets where is_deleted = false and is_licensed = false and licensor_id is not null;`
  and the inverse `is_licensed = true and licensor_id is null and sku is not null` for context.
  Record both numbers with the EST time on #596 (signed). This is the "before" for step 8.
- Gate: numbers posted on #596.

### Step 2 — Full reprocess honours ERP (`metadata-handlers.ts:153–170`)
- Extract a pure helper in the same file, e.g.
  `export function effectiveIsLicensed(derived: { is_licensed: boolean }, licensing: { is_licensed?: boolean | null }): boolean { return licensing.is_licensed ?? derived.is_licensed; }`
- Reorder the loop body: call `resolveAuthoritativeLicensing(db, derived.is_licensed, parsed, licensingMaps)`
  immediately after `deriveMetadataFromPath` (move line 166 above 159), compute
  `const isLicensed = effectiveIsLicensed(derived, licensing)`, then
  `if (asset.is_licensed !== isLicensed) updates.is_licensed = isLicensed;`.
  Everything else (workflow_status, licensor/property writes, SKU fields) unchanged.
- Behaviour: an asset under a Generic folder whose ERP row carries a licensor in a
  licensed division gets `is_licensed = true`; one ERP marks unlicensed gets `false`;
  one ERP does not know keeps the folder value.
- Dependencies: none (parallel with step 3).
- Gate: test `reprocess full mode writes ERP's is_licensed over the folder value` (step 6) passes.

### Step 3 — Close the division hole (`licensing-resolution.ts:169–171`)
- Change the return to `{ ...emptyResolution("coldlion_item_is_not_in_a_licensed_division", false), is_licensed: false }`.
- Update the comment at 139–140 to spell out the three ERP-known outcomes: no licensor
  code → unlicensed; non-licensed division → unlicensed; otherwise licensed and resolved.
- Gate: test `marks an ERP item outside the licensed divisions unlicensed and resolved` passes;
  the existing 4 tests still pass.

### Step 4 — Comments and docs
- `agent-api/index.ts:902` → "Keep style_groups licensing aligned with the ERP-authoritative rule (resolveAuthoritativeLicensing)".
- `agent-api/index.ts:1056–1057` → "NOTE: is_licensed is set below from ERP (resolveAuthoritativeLicensing); the folder value is only the fallback when ERP lacks the style number."
- `metadata-derivation.ts:4` → "Derives workflow_status and the folder FALLBACK for is_licensed (ERP outranks it; see licensing-resolution.ts)". `:64` → "is_licensed folder fallback (ERP decides when it knows the style number):".
- `docs/KNOWN_QUIRKS.md` quirk 72: amend the "fixed contract" bullets — path derives
  `workflow_status` and the fallback `is_licensed`; ERP decides `is_licensed` when it
  knows the item (PR #595, #596); canonical IDs come from `core.taxonomy_source_ref`
  **or** an exact, unique `core.licensor.code` / `core.property.code` match scoped to the
  resolved licensor (`licensing-resolution.ts:69–83`); the "Do not change" paragraph
  keeps forbidding PATH or FUZZY-NAME fallbacks (exact code match is neither). Add a
  dated amendment line "Amended 2026-11-… (#596)".
- `docs/BULK_JOBS.md:35` → note "(is_licensed from ERP when known, folder otherwise — same rule as ingest)".
- `docs/ADMIN_OPERATIONS.md:216` → "Re-derives metadata: workflow_status from path; is_licensed, licensor_id, property_id from the ColdLion item mirror (folder only as fallback); SKU fields from the filename."
- Gate: `grep -rn "path-authoritative\|intentionally EXCLUDED" supabase/functions docs` returns nothing.

### Step 5 — Recover or re-derive truncated finding 4
- Try, in order: `gh api repos/u2giants/popdam3/issues/596 --jq .body` (already known
  truncated); the ai-review run's artifacts `gh run download 40989969957 -R u2giants/popdam3`
  (if any artifact exists); the reviewer's PR comment on #595 (`gh pr view 595 --comments`).
- If the text is not recoverable: re-review `licensing-resolution.ts:173–230` yourself
  for the most likely candidates and record the verdict on #596: (a) `licensorByCode`
  fallback (line 184) ignores `erp.division_code` — codes are global in `core.licensor`,
  so this is by design (`uniqueByKey` makes duplicates ambiguous → null); (b) the
  `maps` branch at 206–209 silently drops a property whose `licensor_id` mismatches
  while the no-maps branch at 211–220 does the same via the `.eq("licensor_id")` filter
  — consistent; (c) `loadAuthoritativeLicensingMaps` loads ALL `core.property` /
  `core.licensor` rows per batch (lines 98–99) — acceptable at current sizes (hundreds).
  Post the three verdicts; fix only if you find a real defect, with a test.
- Gate: a signed comment on #596 stating finding 4 is unrecoverable and the re-review result.

### Step 6 — Tests
- `supabase/functions/_shared/licensing-resolution.test.ts` add:
  - `marks an ERP item outside the licensed divisions unlicensed and resolved` — maps with
    `division_code: "EH001"`, licensor code present → `{ is_licensed: false, licensor_id: null, unresolved_licensor: false, reason: "coldlion_item_is_not_in_a_licensed_division" }`.
  - `keeps the folder flag only when ERP lacks the style number` already exists as
    "falls back to the folder rule only when ERP lacks the item" — leave it.
- New `supabase/functions/_shared/admin-handlers/metadata-reprocess-licensing.test.ts`:
  - `effectiveIsLicensed prefers ERP's answer and falls back to the folder` (table: ERP
    true/false/null/undefined × folder true/false).
  - `reprocess full mode writes ERP's is_licensed over the folder value` — mock
    `../service-client.ts` with a fake `db` modelled on `metadata-fill-licensing.test.ts:13–60`
    (`from("assets").select(...).eq().range().order()` thenable returning one asset with
    `is_licensed: false, licensor_id: null`; `update().eq()` capturing values), mock
    `../metadata-derivation.ts` → `{ is_licensed: false, workflow_status: "approved" }`,
    mock `../sku-parser.ts` → a parsed SKU, mock `../licensing-resolution.ts` →
    `loadAuthoritativeLicensingMaps: async () => ({})`, `resolveAuthoritativeLicensing: async () => ({ is_licensed: true, licensor_id: "marvel", property_id: null, licensor_code: "MV", licensor_name: "MARVEL", property_code: null, property_name: null, unresolved_licensor: false, unresolved_property: true, reason: null })`.
    Assert the captured update has `is_licensed: true` and `licensor_id: "marvel"`.
  - `reprocess full mode keeps the folder value when ERP does not know the item` —
    resolve returns `{ is_licensed: null, ... }` → no `is_licensed` key in the update when
    the stored value already equals the folder value.
- Gate: `npx vitest run supabase/functions/_shared` green; full `npm run test` green.

### Step 7 — PR, CI, merge, deploy
- Branch `fix/596-reprocess-erp-licensing` from `main` in a fresh worktree; stage only the
  files in steps 2–6; commit as Albert's verified identity.
- PR to `main` listing finding → step mapping; wait with `ai-pr-wait <pr>` in the
  background; merge yourself. `deploy-supabase.yml` deploys the edge functions; confirm
  the run is green and the deployed `admin-api` version serves the merge SHA (the
  workflow logs the deploy; `docs/deployment.md`).
- Gate: PR merged, CI + deploy-supabase green.

### Step 8 — Live proof and close
- Run the `reprocess-metadata` bulk op from Settings (admin tester login, §12) or by
  enqueueing it the documented way (`docs/BULK_JOBS.md`); it runs via the Railway worker
  in batches of 25 and may take a long time over ~140k assets — do NOT poll in a loop;
  wait on the bulk-operation status with a bounded check at meaningful transitions.
- Re-run the step-1 counts. Expected: "unlicensed but has a licensor" = 0 (or only rows
  whose ERP division is non-licensed AND licensor_id was set by an older path — list
  them if > 0 and explain).
- Post before/after counts, bulk-op id, test names and the deploy run id on #596
  (signed), tick `- [x] live proof` (add the item to #596 if absent), close #596.
- Gate: #596 closed with evidence.

Adversarial cases (external input = ERP mirror rows and folder paths):

| Input | Hostile case | Test |
|---|---|---|
| ERP row with licensor code but division `EH001` | folder says licensed | `marks an ERP item outside the licensed divisions unlicensed and resolved` |
| ERP row with null licensor code | folder says licensed | existing `lets ERP mark an item unlicensed even when the folder says licensed` |
| Style number absent from mirror | folder says anything | existing `falls back to the folder rule only when ERP lacks the item` |
| Duplicate style number across divisions, parsed division wrong | ambiguity | existing `matches by style number alone…` (returns null → folder) |
| Reprocess asset whose stored flag equals ERP's | no-op expected | `reprocess full mode keeps the folder value when ERP does not know the item` |

## 10. Tests required

Named in step 6. Existing suites that must stay green: root `npm run test` (includes
`supabase/functions/**`), `npm run lint`, `npm run typecheck`, worker build/test
(`apps/worker`), `npm run build`.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; AI merges; never push to `main`.
- No DB structure change here; none is needed. The live proof writes production
  `assets` rows **only** through the existing admin bulk operation — never ad-hoc SQL.
  Declare the task with `ai-task-gates` (class: code for steps 2–7; the step-8 bulk run
  is production, read the gate output before running it).
- Edge functions are Deno: keep `.ts` import suffixes; run `deno fmt` expectations
  (`edge-functions-format.yml`).
- `fill-missing-licensing` mode must remain untouched (its tests pin it).
- Never add path or fuzzy-name licensor/property inference (quirk 72).
- Reviews are advisory; do not wait on one. Sign GitHub posts with `$AI_GH_SIGNATURE`.
- Quote times in EST.

## 12. Access and environment

- Worktree under `/worksp/popdam/.claude/worktrees/`; `npm ci` at root; tests `npm run test`.
- Production read-only SQL: Supabase MCP `execute_sql` on `qsllyeztdwjgirsysgai`, or the
  pooler with 1Password `vibe_coding` "Supabase DB Password - shared POP database".
- Admin UI for the bulk op: 1Password `vibe_coding` "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)".
- Railway worker logs: Railway MCP (note: it failed to connect in the planning session;
  fall back to the bulk-operation rows in the DB, `docs/BULK_JOBS.md`).
- `gh` authenticated; `ai-pr-wait` on PATH.

## 13. Definition of done, risks, open questions

Done when: steps 2–6 merged; CI and `deploy-supabase.yml` green with the merge SHA; one
full `reprocess-metadata` run completed after deploy; step-8 counts show the
contradiction class at 0 (or explained); evidence and `- [x] live proof` on #596; #596
closed; STATUS rows cite PR, run ids, test file; plan file deleted afterwards.

Risks: (a) a full reprocess also rewrites SKU fields for all assets — it has run before
(PR #359 era) and is offset-paged; if it stalls > 30 min with no progress treat it as
broken per standing rules and report. (b) Flipping `is_licensed` changes the Licensed
facet counts visibly — expected; mention on #596. Rollback: revert the merge; data
flipped by the run can be re-flipped by running the job again on the reverted code
(it is idempotent either way).

Open questions: none business-meaning. Finding 4's text is lost (step 5 handles it).

## Self-audit

1. **Executable by a fresh session without questions?** Yes — §5 pins every line, §9
   gives exact edits, mock shapes and test names, §12 lists access by vault item.
2. **All background carried?** Yes — §3 (findings, fixer 403 root cause, PR #597
   context), §6 (why the ordering bug exists, why unit testing needs a helper), §7
   (rejected designs), §8 (locked rule choice with reasoning).
3. **Goal clear enough to steer by?** Yes — §1 states "every write path agrees that ERP
   decides" with the goal-wins instruction; the division decision in §8 derives from it.
