# Plan: Review finding: u2giants/popdam3#610 Style-group flyout: show licensor-scrape style guides (shared-db #5092) (u2giants/popdam3#611)
Issue: https://github.com/u2giants/popdam3/issues/611
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Re-verify the table and data exist in production (read-only) | ⬜ open | |
| 2. Surface query errors in both Style Guide Sources queries; drop `as any` | ⬜ open | |
| 3. Render an explicit "unavailable" state distinct from "empty" | ⬜ open | |
| 4. Component tests for the four rendering branches + error state | ⬜ open | |
| 5. Update `docs/POPSG.md` Style Guide Sources section | ⬜ open | |
| 6. PR, CI, merge, frontend deploy verified | ⬜ open | |
| 7. Live proof on dam.designflow.app + close #611 | ⬜ open | |

**Where a fresh session starts:** step 1. Nothing has been implemented; the finding is
partly fixed on `main` (the table now exists) and partly open (silent errors, `as any`,
no tests, stale docs). Verified against commit `01fcfc34` on 2026-11-04.

---

## 1. The ultimate goal (plain business English)

When a designer opens a licensed product's flyout in PopDAM and looks at "Style Guide
Sources", what they see must be true and must say when it cannot be shown. The panel
lists (a) the source-art file names from the licensing sheet and (b) the licensor style
guides the portal scrape says those files belong to. Today, if the lookup fails, the
panel claims "No source-art files or style guides recorded for this SKU" — a false
"nothing exists" instead of "we could not check". The goal is: a real answer, an honest
"unavailable" when the lookup fails, and tests so the next change cannot break it
silently.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product
art (see `AGENTS.md` → Project summary). Repo `u2giants/popdam3`, React/Vite/Tailwind
front end in `src/`, Supabase backend (project `qsllyeztdwjgirsysgai`, Virginia), deployed
as a Docker image via `.github/workflows/publish-frontend.yml` → GHCR → Coolify app
`qxj8a0j3tpa9lq4q5rs6pezy` at https://dam.designflow.app (PopSG mode at
https://sg.designflow.app, same image). Default branch `main`, protected; work goes on
a feature branch + PR.

The component in scope is the style-group detail flyout:
`src/components/library/StyleGroupDetailPanel.tsx` (opens when a user clicks a style
group / SKU in the library).

## 3. What triggered this work

PR #610 (`mimo/style-group-style-guides`, merged 2026-10-30 22:13 UTC, merge commit
`7853e217`) changed the "Style Guide Sources" block of the flyout to show source-art file
names from `public.sku_files_used` plus licensor style guides from the new table
`public.sku_style_guide_links` (shared-db migration `20261030043848`, shared-db issue
#5092). The advisory AI review of that PR (reviewer `deepseek`, run 41136126717) raised
three findings, filed as #611:

1. **High** — the query depends on a table that was not applied to production at the
   time, and errors are swallowed (`{ data }` only; `(supabase as any)`), so a missing
   table rendered as "no data".
2. **Medium** — no test covers the four new rendering branches.
3. **Low** — `docs/POPSG.md:191` still documents the old "resolved file (or
   'unresolved')" display that no longer exists.

The fixer bot deferred (`fixer-deferred`: source PR already closed). On 2026-11-04 a
review against `main 522e5722` and live data recorded: **table now exists (fixed)**;
still open: ignored query error and `as any` at `StyleGroupDetailPanel.tsx:155`, no
tests, stale `POPSG.md:191`.

## 4. Scope

**In:**
- Error handling and typing of the two Style Guide Sources queries in
  `StyleGroupDetailPanel.tsx` (`sku_files_used` at lines 137–149 and
  `sku_style_guide_links` at lines 151–172).
- An explicit "unavailable" rendering state.
- Component tests for the Style Guide Sources block.
- `docs/POPSG.md` Style Guide Sources section.
- Live proof and closing #611.

**NOT in this plan:**
- Populating or re-running `backfill_pdf_files_used_v2()` / `resolve_sku_style_guide_links()`
  (shared-db data jobs; #5092 is closed).
- Any schema change (shared-db only; the table already exists).
- The `(supabase as any)` on `prod_order_headers_current` at line 178 (different
  feature; it already checks `error`).
- Removing the per-row trigger `trg_fn_resolve_sku_file_used` (named as a follow-up in
  `docs/POPSG.md:207`; separate work).
- Any redesign of the flyout layout.

## 5. Current state of the code (verified 2026-11-04 at `01fcfc34`)

- `src/components/library/StyleGroupDetailPanel.tsx`
  - 137–149: `sourceFiles` query — `supabase.from("sku_files_used").select("id, file_name")`
    destructures `{ data }` only; error ignored; returns `[]` on failure.
  - 151–172: `styleGuideLinks` query — `(supabase as any).from("sku_style_guide_links")`
    destructures `{ data }` only; error ignored; `as any` cast.
  - 41–50: `MATCH_METHOD_LABELS` / `matchMethodLabel()` (labels for `match_method`).
  - 984–1041: rendering. Line 986 is the combined empty check that prints
    "No source-art files or style guides recorded for this SKU"; 990–998 source files;
    1000–1037 licensor style guides with ambiguity (`matched_asset_count > 1`) and
    confidence (`match_confidence < 1`) badges.
- `src/integrations/supabase/types.ts:2842` — **`sku_style_guide_links` IS now in the
  generated types** (columns: `id, sku, source_system, source_style_guide_key,
  style_guide_label, file_name, match_method, match_confidence, matched_asset_count,
  core_style_guide_id, first_seen_at, last_seen_at, created_at, updated_at`). The types
  file is regenerated by `deploy-supabase.yml`, so this is evidence the migration is
  applied to production. The `as any` cast is therefore no longer needed.
- `shared-db/supabase/migrations/20261030043848_sku_style_guide_links.sql` is present in
  the vendored mirror. shared-db #5092 (the table) and #5141 (the failed-apply recovery
  lane) are both CLOSED.
- Tests: only `src/components/library/StyleGroupDetailPanel.mockup.test.tsx` exists
  (mockup button; renders the panel with the real client, no supabase mock).
- `docs/POPSG.md:182–208`: section "Style Guide Sources (`sku_files_used`)". Line 191
  says "panel shows the resolved file (or 'unresolved')" — stale. Line 207 already
  carries a SUPERSEDED note about the fuzzy resolver and names `sku_style_guide_links`.
- `HANDOFF.d/20261030T1735Z-EDGE-DEV-mimo-style-group-panel-style-guides.md` is the
  original implementer's handoff; its §4 "Blocked on" (migration not applied) is now
  resolved.

## 6. Key findings and root cause

- The "silent empty" is structural: TanStack `useQuery` with a `queryFn` that never
  throws can never enter `isError`, so the UI has no way to distinguish failure from
  absence. Fix = throw on `error` and branch on `isError`.
- The `as any` existed only because the generated contract lacked the table at the PR's
  head SHA `28275bf7`; the contract now has it (`types.ts:2842`), so the typed client call
  compiles.
- `sourceFiles` has the identical defect (unchecked error) even though the review only
  called out the new query; fixing one and not the other would leave the same false
  "no data" message reachable.
- Both queries are `enabled` only when `group.sku && group.is_licensed`, so the block is
  hidden for unlicensed groups (line 985 `group.is_licensed &&`). Keep that.

## 7. Approaches considered and REJECTED

- **Only remove `as any` and check `error` by throwing, with no UI change.** Rejected:
  a thrown error with no `isError` branch still renders the "No source-art files…" text
  (line 986 checks `!sourceFiles`), so the false message survives.
- **Show a toast on error.** Rejected: toasts vanish; the panel text must itself say
  "unavailable" so a screenshot/live proof is unambiguous.
- **Merge both queries into one RPC.** Rejected: needs a shared-db change for a UI
  defect; out of scope and slower.
- **Rendering the fuzzy PopSG document pointer (`sku_files_used.style_guide_file_id`)
  again.** Rejected and LOCKED by the 2026-10-30 handoff + `docs/POPSG.md:207`: the fuzzy
  match is not a licensor statement; it was unscheduled for manufacturing false claims.

## 8. Design decisions

- **LOCKED (2026-10-30, handoff §3):** source-file names are shown verbatim; licensor
  style guides come only from `sku_style_guide_links`; a row with
  `matched_asset_count > 1` is shown as ambiguous; never show the fuzzy pointer as fact.
- **LOCKED (this plan):** a failed lookup renders an explicit "unavailable" line
  (wording below) and never the "No source-art files…" text.
- **LOCKED (this plan):** both Style Guide Sources queries check `error` and use the
  typed client (no `as any`).
- **OPEN (implementer's judgment):** whether to surface the raw error message text in the
  unavailable line. Criterion: show a short generic sentence to users; put the message in
  a `title` attribute for admins debugging. Do not log to console in production paths.

## 9. The plan — ordered steps

### Step 1 — Re-verify table and data in production (read-only)
- Run, read-only, against the production project (see §12 for access):
  `select count(*) from public.sku_style_guide_links;` and
  `select sku, count(*) from public.sku_style_guide_links group by sku order by 2 desc limit 5;`
  and the same for `sku_files_used`. Record the counts and one SKU that has rows in each
  table — that SKU is the live-proof target in step 7.
- Also confirm `src/integrations/supabase/types.ts` on current `main` still contains
  `sku_style_guide_links` (grep); if `main` moved and it vanished, stop — the contract
  regressed and the `as any` removal would break typecheck.
- Gate: you'll know it worked when you have a SKU with ≥1 `sku_style_guide_links` row and
  ≥1 `sku_files_used` row written down for step 7.

### Step 2 — Check errors and drop the cast (`StyleGroupDetailPanel.tsx:137–172`)
- `sourceFiles` (137–149): change to `const { data, error } = await supabase.from("sku_files_used")...;
  if (error) throw error;`. Keep the explicit array type.
- `styleGuideLinks` (151–172): replace `(supabase as any).from(...)` with
  `supabase.from("sku_style_guide_links")`, destructure `{ data, error }`, `if (error) throw error;`.
  The local row type can be replaced by `Pick<Tables<"sku_style_guide_links">, ...>` from
  `@/integrations/supabase/types` (the file already imports `Constants` from there at
  line 24) or kept as the inline type — either compiles.
- Capture `isError` from both `useQuery` calls (e.g. `const { data: sourceFiles, isError: sourceFilesError } = useQuery(...)`).
- Set `retry: 1` is NOT required; default retry behaviour is fine for a read.
- Dependencies: step 1 (contract present).
- Gate: `npm run typecheck` passes with the cast removed; `grep -n "as any" src/components/library/StyleGroupDetailPanel.tsx` shows only the `prod_order_headers_current` cast (line ~178).

### Step 3 — Explicit unavailable state (rendering at 984–1041)
- Before the empty check at line 986, add a branch: if `sourceFilesError || styleGuideLinksError`,
  render `<p className="text-[12px] text-destructive/80">Style guide sources unavailable — lookup failed</p>`
  (same text size as the empty line). Only when neither errored fall through to the
  existing empty / populated branches.
- Behaviour: a failed table read or an RLS denial shows the unavailable line; an empty
  result still shows the existing "No source-art files or style guides recorded for this SKU".
- Dependencies: step 2.
- Gate: the step-4 test `shows the unavailable state when the style-guide link lookup fails` passes and the empty-state test still passes.

### Step 4 — Component tests
- New file `src/components/library/StyleGroupDetailPanel.style-guide-sources.test.tsx`
  (vitest + @testing-library/react, pattern from `StyleGroupDetailPanel.mockup.test.tsx`
  for the `group` fixture and `QueryClientProvider` wrapper).
- Mock `@/integrations/supabase/client` with `vi.mock` (pattern:
  `src/test/coldlion-triage.test.tsx:22–27`): a `from(table)` dispatcher returning a
  thenable chain supporting `select/eq/order/in/limit/maybeSingle` whose resolution is
  controlled per table by the test (`sku_files_used`, `sku_style_guide_links`; every other
  table resolves `{ data: [], error: null }`). Also `schema()` returning the same
  builder (the panel's ERP query at line 83 uses `.schema(...)`), `rpc` resolving
  `{ data: null, error: null }`, and `auth.getSession` resolving a null session.
- Tests (names are the behaviours):
  1. `shows source art files only when no style-guide links exist` — assert the file name
     text and absence of "Licensor style guides".
  2. `shows licensor style guides only when no source files exist` — assert
     `style_guide_label`, the `source_system · <label> · via <file_name>` line.
  3. `shows the empty state when both lookups return nothing` — assert the exact text
     "No source-art files or style guides recorded for this SKU".
  4. `marks a link with more than one portal match as ambiguous and shows confidence under 100%`
     — row with `matched_asset_count: 3, match_confidence: 0.8` → badges
     `ambiguous — 3 portal matches` and `80% confidence`.
  5. `shows the unavailable state when the style-guide link lookup fails` — the
     `sku_style_guide_links` chain resolves `{ data: null, error: { message: "PGRST205" } }`
     → text "Style guide sources unavailable" present, empty text absent.
  6. `shows the unavailable state when the source-file lookup fails` — same for
     `sku_files_used`.
  7. `hides the block for an unlicensed group` — `is_licensed: false` → no "Style Guide Sources" label.
- Gate: `npx vitest run src/components/library/StyleGroupDetailPanel` passes all 7 plus the 2 existing mockup tests.

### Step 5 — Docs (`docs/POPSG.md:182–208`)
- Rewrite the data-flow block (lines 185–191): the panel shows `sku_files_used.file_name`
  verbatim under "Source art files" and `sku_style_guide_links` rows under "Licensor
  style guides" (label, source system, match method, via file, ambiguity/confidence
  badges). State that `style_guide_file_id` is no longer displayed (quarantined, not
  deleted) and that a failed lookup shows "Style guide sources unavailable".
- Keep the scoping rule, provenance and SUPERSEDED paragraphs (194–208) as they are.
- Gate: `grep -n "resolved file (or" docs/POPSG.md` returns nothing.

### Step 6 — PR, CI, merge, deploy
- Branch `fix/611-style-guide-sources-errors` from current `main` in a fresh worktree.
- Commit as Albert's verified identity (`git var GIT_COMMITTER_IDENT`), stage only the
  three files above.
- Open PR to `main`; body: finding-by-finding mapping (1 → steps 2–3, 2 → step 4, 3 → step 5)
  and "Closes #611" is NOT used — the issue closes only after live proof (step 7).
- Wait with `ai-pr-wait <pr>` in the background (never a sleep loop). CI = `.github/workflows/ci.yml`:
  lint, typecheck, vitest, worker build/test, windows-agent test, `npm run build`.
- Merge yourself (Albert does not merge). Then `publish-frontend.yml` builds and Coolify
  deploys; confirm the deployed image SHA matches the merge commit (procedure in
  `docs/deployment.md`; the `deploy-and-verify` skill covers it).
- Gate: PR merged; frontend workflow green; dam.designflow.app serves the new build.

### Step 7 — Live proof and close
- On https://dam.designflow.app (admin tester login, §12) open the style group for the SKU
  recorded in step 1; screenshot the "Style Guide Sources" block showing both lists.
- Open a licensed SKU with no rows → the empty text.
- Post the screenshot(s), the read-only counts from step 1, and the test names on #611,
  signed with `$AI_GH_SIGNATURE`; tick the `- [ ] live proof` checklist item (add it to
  #611 if absent — on the SAME issue), then close #611.
- Gate: #611 closed with the evidence comment.

## 10. Tests required

- New: the 7 tests in step 4 (file `StyleGroupDetailPanel.style-guide-sources.test.tsx`).
- Existing that must stay green: `StyleGroupDetailPanel.mockup.test.tsx`, full
  `npm run test` (vitest, root), `npm run lint`, `npm run typecheck`, `npm run build`.
- No trust-boundary parser is touched (data arrives through the typed PostgREST client
  from our own tables), so no adversarial-cases table is required; the error-path tests
  (5, 6) are the hostile cases for this UI.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`. AI merges.
- No DB changes in this repo; `shared-db-guard.yml` fails any DDL outside `shared-db/`.
- Never re-introduce the fuzzy `style_guide_file_id` display (`docs/POPSG.md:207`).
- `src/integrations/supabase/types.ts` is generated — never hand-edit it.
- Keep the "Style Guide Sources" block gated on `group.is_licensed` (line 985).
- UI change → visual verification (screenshot) is part of done.
- Reviews are advisory; do not wait on or request one.
- Times quoted to humans in EST (America/New_York).

## 12. Access and environment

- Repo worktree: create your own under `/worksp/popdam/.claude/worktrees/`; run from there.
- Local run: `npm ci && npm run dev` (see `docs/development.md`).
- Production read-only SQL: Supabase MCP (`execute_sql`, project `qsllyeztdwjgirsysgai`)
  or the Management API; credentials in 1Password vault `vibe_coding` — "Supabase DB
  Password - shared POP database" / "Supabase CLI Personal Access Token". Read only.
- Browser proof: 1Password `vibe_coding` item "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)". Use the Chrome/Playwright MCP; never
  ask Albert to click.
- `gh` is authenticated as the owner; `$AI_GH_SIGNATURE` is in the environment.
- CI waiter: `ai-pr-wait` (on PATH at `/usr/local/bin/ai-pr-wait`).

## 13. Definition of done, risks, open questions

Done when: steps 2–5 merged to `main`; CI green; frontend image deployed and SHA verified;
step-7 screenshot and counts posted on #611; `- [x] live proof` ticked; #611 closed;
this plan's STATUS rows cite the PR number, CI run id and test file; the plan file is
then deleted and its link removed from the handoff.

Risks: (a) `main` moves and the types file loses the table → typecheck fails on cast
removal (step 1 guard). (b) `sku_style_guide_links` RLS could deny the browser role —
would now show "unavailable" (correct behaviour) but means a shared-db grant is needed;
report on #611 as `Blocked —` with the exact error, do not work around.
Rollback: revert the merge commit; the previous behaviour returns.

Open questions: none business-meaning. The OPEN decision in §8 (showing raw error text)
is the implementer's.

## Self-audit

1. **Could a brand-new session execute this without asking anything?** Yes — §5 gives
   exact line ranges, §9 gives per-step edits, test names and mock pattern references,
   §12 gives every login location and tool.
2. **Does it carry all background and what was ruled out?** Yes — §3 (review findings and
   the Nov 4 re-check), §6 (why the silent empty exists; why `as any` existed), §7
   (rejected toast/RPC/fuzzy-pointer options), §8 (locked quarantine rule).
3. **Is the goal clear enough to steer by?** Yes — §1 states the business outcome
   ("honest unavailable, never a false nothing") with the goal-wins instruction.
