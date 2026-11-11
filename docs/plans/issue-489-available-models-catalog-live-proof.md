---
summary: Issue #489 plan: Live proof: Available models catalog (capabilities, pricing, Google live list). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-489
---

# Plan: Live proof: Available models catalog (capabilities, pricing, Google live list) (u2giants/popdam3#489)
Issue: https://github.com/u2giants/popdam3/issues/489
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Related: [plan_ai_model_interaction_reliability.md](../../plan_ai_model_interaction_reliability.md) (all 9 steps ✅ complete 2026-08-16; historical — it established the capability-driven catalog this UI consumes), [docs/MODEL_RULES.md](../MODEL_RULES.md) (§ Model picker, lines 70-72 describe the Available models catalog, Google live list and pricing fallback), predecessor handoff [HANDOFF.d/2026-10-25T1537Z-edge-dev-mimo-ai-model-catalog-live-proof.md](../../HANDOFF.d/2026-10-25T1537Z-edge-dev-mimo-ai-model-catalog-live-proof.md) (to be retired by the closing commit).

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1. Confirm the three PRs are on main and the live frontend/edge serve them | ⬜ open | — |
| 2. Backend proof: `get-openrouter-vision-models` payload (admin session) | ⬜ open | — |
| 3. On-screen proof: Available models table (chips + pricing on every Gemini row) | ⬜ open | — |
| 4. On-screen proof: Google AI (direct) shows the live Gemini list | ⬜ open | — |
| 5. On-screen proof: task dropdowns show "Needs …" chips and only eligible, turned-on models with prices | ⬜ open | — |
| 6. Fix anything the proof contradicts (only if needed) | ⬜ open | — |
| 7. Tick live-proof boxes on #433/#435/#437, close #489, retire the handoff | ⬜ open | — |

**Where a fresh session starts:** step 1 (five minutes, read-only), then steps 2–5 in one authenticated browser session. Step 6 exists only if a check fails. This issue is **proof-only**: the code is already on `main`.

---

## 1. The ultimate goal

Albert asked (October 18, 2026) for a model-selection screen that is not counter-intuitive: he wants to see every AI model the program can reach, with the capabilities that matter (vision, tools, JSON output, batch) and what it costs through OpenRouter, switch models on or off for the whole program in one place, and have each task's dropdown say what it needs and offer only the models that qualify. The code for this was merged on October 18. What is not yet true: nobody has looked at the live Settings page and confirmed it shows what the code promises. Until that is done the work is not delivered.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A row that says "pricing n/a" where OpenRouter publishes a price, a Google filter that shows one model while a key is saved, or a dropdown that lists a model the task cannot use is a defect to fix, not a note to record.

## 2. What this application is

PopDAM (`u2giants/popdam3`, `main`) is POP Creations' licensed-artwork asset manager at https://dam.designflow.app (React/Vite frontend on Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`, image from `.github/workflows/publish-frontend.yml`; Supabase `qsllyeztdwjgirsysgai` edge functions deployed by `deploy-supabase.yml`; Railway worker). Settings → Processing → AI Tagging (`src/pages/SettingsPage.tsx:165-183`, sub-tab `ai-tagging` → `AiTaggingTab`) hosts `AiModelsConfigSection` (imported from `src/components/settings/ApisTab.tsx:614`, mounted by `AiTaggingTab.tsx:11`), which renders the **Available models** table (`ModelPoolEditor`, `src/components/settings/ModelPoolEditor.tsx:131-136`, `aria-label="Available models"`) and the per-task dropdowns with "Needs …" chips (`ApisTab.tsx:1002, :1086`).

## 3. What triggered this work

PRs #433 (merged 2026-10-18 20:28Z, `9d3e04d9`: catalog + per-task eligibility), #435 (23:14Z, `ff7df78b`: live Google list), #437 (23:59Z, `1c4b45e8`: Gemini pricing from OpenRouter public rates) each carry an unticked `- [ ] live proof on production Settings after deploy`. The October 25 handoff (edge-dev, MiMo) confirmed deploys ran but no one opened the page. Issue #489 was filed as the proof card.

## 4. Scope

In: verify the three claims on the live page, fix only what the proof contradicts, close with evidence.
NOT in this plan: changing model routing (`AI_TASK_MODELS`, worker handlers), adding/removing models from the catalog, pricing for non-OpenRouter providers (Meta/ScaleDown rows legitimately show no OpenRouter price), the Vision Bake-Off, any DB structure, retiring Gemini 2.0 Flash discussion (settled: retired models stay absent).

## 5. Current state of the code (main `01fcfc34`, 2026-11-04)

- Backend: `supabase/functions/admin-api/index.ts` action `get-openrouter-vision-models` (`:2307` → `handleGetOpenrouterVisionModels` `:1181-1235`): reads `admin_config` keys incl. `GOOGLE_AI_API_KEY` (`:1189`), fetches `https://openrouter.ai/api/v1/models/user` (`:1200`), `loadOpenRouterPublicPricing` (`:1045`, public `openrouter.ai/api/v1/models`), `findOpenRouterPricing` (`:1066`, twin candidates `google/<id>`, `:batch`, `-001`), `fetchGoogleDirectModels` (`:1146-1178`, Google `generativelanguage.googleapis.com/v1beta/models?key=…` at `:1163`, falls back to `FALLBACK_GOOGLE_DIRECT_MODELS` when the key is absent or the list is empty), `mapGoogleDirectModels` (`:1115`). Returns `{ok, models:[{id,name,supports_tools,supports_structured_outputs,supports_response_format,tool_choice_modes,input_modalities,image_input,context_length,capability_source,pricing}], catalog_warning?}`.
- Frontend: `ApisTab.tsx:754` calls that action; `:757` drops rows with unavailable OpenRouter pricing via `hasUnavailableOpenRouterPricing` (`src/lib/openrouter-pricing.ts`); `src/lib/ai-model-catalog.ts` (130 lines): `modelCapabilityChips` (`:84`), `modelPricingLabel` (`:109`), `modelMeetsTaskRequirements` (`:117`), `taskRequirementChips` (`:124`); `src/lib/ai-model-options.ts` `modelAllowedForTask` / `modelInPool` (batch models only for primary Image Tagging; ScaleDown only PDF Text).
- Tests on main: `src/test/model-pool-editor.test.tsx` (9 cases, e.g. "shows every model with capabilities and pricing"), `src/test/ai-model-settings-pool.test.tsx` (4), `src/test/ai-model-options.test.ts` (14), `src/test/ai-model-config-save.test.ts`.
- Docs on main: `docs/MODEL_RULES.md:70-72`, `docs/configuration.md:123, :132`.
- Live config (read-only, 2026-11-04): `GOOGLE_AI_API_KEY` row present (updated 2026-10-07), `OPENROUTER_API_KEY` present, `AI_MODEL_POOL` present (updated 2026-10-20 09:18 EDT), `AI_TASK_MODELS` present (updated 2026-11-04 4:37 PM EST — another session changed task models today; do not touch them).
- Deploys: latest `publish-frontend.yml` success run `41862508278` on `522e5722` (2026-11-04 11:30 AM EST); latest `deploy-supabase.yml` success `41918266071` on `b19fac79` (4:41 PM EST). Both are far after the three merges, so the code is deployed **unless** Coolify serves a stale image — step 1 checks the live header commit (`__APP_COMMIT__` defined in `vite.config.ts:44`).

## 6. Key findings

1. All three changes are landed and deployed by every available signal; the only missing artifact is on-screen evidence. (`git log --oneline main | grep -E "9d3e04d9|ff7df78b|1c4b45e8"` confirms the merge commits are ancestors of `01fcfc34`.)
2. The Google list depends on the saved key's API enablement; an empty live list falls back to the single `google-direct/gemini-3.8-flash:batch` row by design (handoff §9). If the page shows one Google row, step 2's raw payload tells whether Google returned nothing (`capability_source` = fallback) or the UI filtered rows (`:757` drops rows whose OpenRouter pricing is marked unavailable — a Gemini model with no public price would vanish, which would be a real defect against claim 1 "pricing on every row including all Gemini").
3. "pricing n/a" is honest for models OpenRouter does not list (Meta direct, ScaleDown); it is a defect only on Gemini/OpenRouter rows.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Treat green CI + deploy runs as proof | Standing rule: live proof is required before an outcome is closed; the PR checklists explicitly demand on-screen proof. |
| Screenshot with the user-role tester | Settings → Processing requires the admin role; the admin-api returns 403 to user-role accounts (known quirk). Use the administrator identity. |
| Re-implement or "polish" the table while proving it | Scope creep; only contradictions found by the proof are fixed. |
| Ask Albert to open the page | Never ask Albert to click; the AI signs in with the stored admin identity. |

## 8. Design decisions

LOCKED (owner, 2026-10-18): every model with capabilities and pricing; per-dropdown requirements; broad on/off list; retired models stay absent; ship path branch → PR → squash merge, Albert does not merge. LOCKED (standing): no screenshots containing secret values — the API-key fields render masked ("Saved values are never shown", `ApisTab.tsx:864`), so the AI Tagging sub-tab is safe to capture; never capture PopSG Settings → Setup.
OPEN: whether to post screenshots to GitHub or only the aggregate observations — post cropped screenshots of the table and one dropdown (no keys visible); if the environment cannot upload images, post the text observations with counts.

## 9. The plan

**Step 1 — Deployment identity (read-only).** `git merge-base --is-ancestor 1c4b45e8 origin/main` (and the other two SHAs). Open https://dam.designflow.app, read the header commit; compare with the newest successful Publish Frontend Image run (`gh run list --workflow publish-frontend.yml --limit 1`). Confirm the latest `deploy-supabase.yml` run is newer than `ff7df78b`. Gate: header commit ≥ `522e5722` (or whatever the latest success run built) and both runs green; otherwise follow AGENTS.md:443 stale-site check (inspect Coolify deploy log, redeploy the latest image) before any screen proof.

**Step 2 — Backend payload (admin session).** Sign in as the administrator (1Password `vibe_coding` item `ai-admin@designflow.app`, id `7s5uzpbjenka4fpvrqogh44bre`; password-grant via `op run`, inject into `localStorage['sb-popdam-auth-token']` per memory `project_popsg_tester_login.md`). Call `admin-api` `{"action":"get-openrouter-vision-models"}` with that JWT; save the JSON to `$TMPDIR` (contains no secrets — the fingerprint is a hash). Record: total rows; rows per endpoint (`openrouter/*`, `google-direct/*`, `meta-direct/*`, `scaledown/*`); Gemini rows (`id` matches `/gemini/i`) with `pricing` null vs present; `capability_source` values for Google rows (live vs fallback); `catalog_warning`. Gate: Google rows > 1 with `capability_source` indicating the live list, and every Gemini row has `pricing.prompt`/`completion` numbers. If a Gemini row has null pricing, note its id for step 6.

**Step 3 — Available models table.** Settings → Processing → AI Tagging. In the "Available models" section (`aria-label="Available models"`): count rows; verify each row shows capability chips (Vision / Tools / JSON schema / JSON mode / Batch labels from `CAPABILITY_CHIP_LABELS`) and the pricing column (`$x in / $y out per 1M`); filter the endpoint selector to OpenRouter, Google AI (direct), Meta, ScaleDown in turn and record counts; search "gemini" and confirm no Gemini row says "pricing n/a". Screenshot desktop (1440×900) and mobile (390×844) of the table. Gate: row counts equal step 2's payload after the `:757` filter; zero Gemini "n/a"; zero console errors.

**Step 4 — Google live list.** With the endpoint filter on Google AI (direct) (the key is saved — `GOOGLE_AI_API_KEY` row exists, 2026-10-07), confirm the list has many Gemini `generateContent` models (not only `gemini-3.8-flash:batch`), no embedding/aqa/imagen/learnlm entries, and no Gemini 2.0 Flash. Screenshot. Gate: count > 1 and matches step 2's Google rows.

**Step 5 — Task dropdowns.** For Image Tagging (primary and fallback), ERP classification, PDF Text Extraction: confirm the "Needs …" chips (`taskRequirementChips`), that each list contains only models (a) turned on in Available models and (b) meeting the chips, each with its price, and that batch (`:batch`) models appear only in Image Tagging primary and ScaleDown only in PDF Text. Toggle one model off in Available models **without saving**, observe it leave the dropdown (or show "· off in Available models" on the current selection), then reload to discard. Do **not** press "Save available models" or change any task model (`AI_TASK_MODELS` was changed by another session today). Gate: all observations true; screenshot of one dropdown with chips.

**Step 6 — Fix only on contradiction.** Likely candidates and where: Gemini row missing pricing → `findOpenRouterPricing` twins (`admin-api/index.ts:1066`) or `googleTwinCandidates`; Google rows collapsed to one → `fetchGoogleDirectModels` (`:1146`) error path (check Supabase function logs for the Google HTTP status); a non-eligible model in a dropdown → `modelMeetsTaskRequirements`/`modelAllowedForTask`. Each fix: feature branch, failing test first in the matching suite (§10), PR, CI, merge, redeploy, re-run the failed step. Gate: the step that failed now passes on the live page.

**Step 7 — Close.** Post one signed comment on #489 with the numbers from steps 2–5, the header commit, run ids, and cropped screenshots; tick `live proof` on #433, #435, #437 (edit the PR body checklists) and the `- [ ] live proof` line on #489; close #489. Delete `HANDOFF.d/2026-10-25T1537Z-edge-dev-mimo-ai-model-catalog-live-proof.md` in a small docs PR (successor rule) and add a line to `docs/MODEL_RULES.md:72` "Live-verified <date> (#489)". Gate: #489 closed; three PR checklists fully ticked; handoff removed on `main`.

## 10. Tests required

No new tests unless step 6 triggers a fix; then: `src/test/model-pool-editor.test.tsx` ("shows OpenRouter pricing for a Gemini row matched through its -001 twin"), `src/test/ai-model-settings-pool.test.tsx` ("lists every live Google generateContent model when the key is configured"), `src/test/ai-model-options.test.ts` ("keeps a model that fails a task's requirements out of that dropdown"). Suites that must stay green: root `npm run lint && npm run typecheck && npm run test && npm run build`; CI also runs `apps/worker` and `apps/windows-agent` tests.

Adversarial cases (trust boundary: provider catalogs are external input) — relevant only for a step-6 fix:

| Input | Hostile case | Test |
|---|---|---|
| OpenRouter `/models/user` | Missing `pricing`, string prices, duplicate ids | "normalizes missing or string pricing without dropping the row" (`ai-model-options.test.ts`) |
| Google `models` list | Non-Gemini entries, missing `supportedGenerationMethods`, HTTP 403 | "filters to generateContent Gemini and falls back on error" (`ai-model-settings-pool.test.tsx`) |
| `AI_MODEL_POOL` value | Endpoint key with non-array value | "treats a malformed pool entry as all-models, not none" (`model-pool-editor.test.tsx`) |

## 11. Constraints, standing rules, gotchas

- Proof needs the admin role; the user-role tester gets 403s from admin-api (known quirk) — use the administrator item.
- Never type or paste credentials in chat; never screenshot a page region that could show a key (the AI Tagging sub-tab masks keys; the ERP/Taxonomy sub-tab also masks, but stay on AI Tagging).
- Do not save any Settings form during the proof; `AI_TASK_MODELS` was modified today by another session and `AI_MODEL_POOL` is the production allow-list.
- Branch + PR for any fix; AI merges; `ai-pr-wait` in the background; sign posts with `$AI_GH_SIGNATURE`; times in EST.
- Frontend freshness is proven by the header commit, not by the Railway badge (AGENTS.md:443, docs/deployment.md:65).
- `src/integrations/supabase/types.ts` is generated — never edit.

## 12. Access and environment

- hetz; `gh` as `u2giants`; Playwright MCP or Chrome for the signed-in session; Supabase MCP read-only SQL (used for the §5 config facts; no values read).
- Identities: 1Password `vibe_coding` administrator item `7s5uzpbjenka4fpvrqogh44bre` (`ai-admin@designflow.app`), anon/publishable key item `3hhxwrljnaq2tykxi7hplq5ryi` for the password grant.
- URLs: https://dam.designflow.app/settings (Processing → AI Tagging); admin-api at `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api`.
- Local run if a fix is needed: `npm ci && npm run dev`; Deno for the edge function.

## 13. Definition of done, risks, open questions

Done: steps 1–5 pass on the live page with artifacts (JSON summary, four screenshots), posted on #489; three PR checklists ticked; #489 closed; handoff retired on `main`; any step-6 fix merged, deployed and re-proven.
Risks: Google key lacks `generativelanguage` API enablement → single fallback row (then it is a key-scope question: report `Blocked —` with the Google HTTP status from function logs; do not create a key). OpenRouter public list temporarily unreachable → "n/a" on Gemini rows (retry once after 10 minutes before calling it a defect).
Open: none for Albert.

## Self-audit

1. *Executable without questions?* Yes — §5 names every handler/component with lines, §9 gives the exact clicks, calls, identities (by 1Password id) and gates, §12 the URLs.
2. *All background and dead ends?* Yes — §3/§6 carry the deploy evidence and the two honest-"n/a"/fallback cases that look like bugs but are not; §7 lists what not to do (CI as proof, user-role tester, polishing).
3. *Goal clear enough to steer?* Yes — §1 states Albert's request and the three concrete defects that would violate it, so a failing check maps directly to step 6.
