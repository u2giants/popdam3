---
issue: 489
status: OPEN
owner: mimo/ai-model-catalog-489
---

# HANDOFF — AI model catalog UX: Available models, Google live list, Gemini pricing

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. Live Settings proof is a technical verification step for the next AI session (issue #489), not a business ruling.

**Already settled — do NOT re-ask**
- 2026-10-18: Model selection must show every model with capabilities and OpenRouter pricing, per-dropdown capability requirements, and a broad on/off list (Albert request this session).
- 2026-10-18: Retired models (e.g. Gemini 2.0 Flash) stay out of the catalog on purpose.
- 2026-10-18: Application ship path is feature branch → PR → squash merge; Albert does not merge.

## 1. What this application is

**PopDAM** (`u2giants/popdam3`) is POP Creations' internal Digital Asset Manager for licensed product art. Same codebase serves **PopSG** (style-guide library) by hostname. Dark-mode React web app on Coolify (`dam.designflow.app` / `sg.designflow.app`), Supabase edge functions, Railway worker, NAS/Windows agents.

This workstream is the **Settings → AI Models / Processing** model-selection UI: which AI models the program can use and which appear in each task dropdown.

## 2. What we set out to do this session, and why

Albert said the model pool was counter-intuitive and hard to use. Required: see every model per endpoint with relevant capabilities (vision, structured JSON) and OpenRouter pricing; choose which are available broadly; each AI dropdown should describe required capabilities and list only narrowed eligible models.

Follow-ups in-session: Google direct showed only one model (why?); Gemini 2.0 Flash missing (retired); pricing missing on almost all Gemini (bad OpenRouter twin match).

## 3. Current state — what is true right now

### Shipped and merged (code on main)

| Change | PR | Merged |
|---|---|---|
| Available models catalog + per-task eligibility UI | [#433](https://github.com/u2giants/popdam3/pull/433) | 2026-10-18 |
| Live Google Gemini list for google-direct | [#435](https://github.com/u2giants/popdam3/pull/435) | 2026-10-18 |
| Gemini pricing from OpenRouter public rates | [#437](https://github.com/u2giants/popdam3/pull/437) | 2026-10-18 |

Docs updated on main:
- [docs/MODEL_RULES.md](https://github.com/u2giants/popdam3/blob/main/docs/MODEL_RULES.md) — Available models catalog, Google live list, pricing fallback
- [docs/configuration.md](https://github.com/u2giants/popdam3/blob/main/docs/configuration.md) — same operational detail

Key code (on `main`):
- [src/lib/ai-model-catalog.ts](https://github.com/u2giants/popdam3/blob/main/src/lib/ai-model-catalog.ts) — capability chips, pricing labels, task requirements
- [src/components/settings/ModelPoolEditor.tsx](https://github.com/u2giants/popdam3/blob/main/src/components/settings/ModelPoolEditor.tsx) — Available models table (switches, filters, pricing column)
- [src/components/settings/ApisTab.tsx](https://github.com/u2giants/popdam3/blob/main/src/components/settings/ApisTab.tsx) — task dropdowns with capability chips + eligible lists
- [supabase/functions/admin-api/index.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/admin-api/index.ts) — `handleGetOpenrouterVisionModels`, `mapGoogleDirectModels`, `loadOpenRouterPublicPricing`, `findOpenRouterPricing`

### Deploys

- Edge functions: Deploy Supabase Edge Functions has succeeded on later main pushes (e.g. run 40027501960). Pricing/live-Google code should be live.
- Frontend: Publish Frontend Image succeeded on later pushes. Available models UI should be live on Coolify.
- **On-screen proof in Settings has NOT been done.** Issue [#489](https://github.com/u2giants/popdam3/issues/489). PR checklists still have `- [ ] live proof`.

### Not done

- Live Settings walk-through (issue #489)
- No worker/routing changes were made — presentation only. `admin_config.AI_MODEL_POOL` / `AI_TASK_MODELS` semantics unchanged.

## 4. Everything we tried that did NOT work

1. **Original Model Pool two-list UI** (shown vs available-to-add + "include future models") — pre-existing, replaced. Too hard to understand; Albert rejected it.
2. **Exact OpenRouter twin `google/${bareId}` only** for Gemini pricing — almost every row showed "pricing n/a" even though OpenRouter publishes prices for all Gemini IDs. Fixed in #437 with `:batch` / `-001` candidates + public catalog fallback.
3. **Hardcoded single Google model** (`google-direct/gemini-3.8-flash:batch`) — only one Google row until #435 loaded Google's live list.
4. **Local `ai-task-gates check --before ship`** on this shared dirty checkout — refused as `deployment` because other sessions left hundreds of dirty files. GitHub Task Gates `verify` on the PR heads passed. Did not treat local dirty-tree refusal as a veto on a clean green PR.
5. **`gh run approve`** — not available in this `gh` build. Workaround: `gh run rerun` on `action_required` runs after push.
6. **Rebase of feature/google-direct-live-catalog onto main after squash merge** — conflict because the first commit was already squashed onto main. Aborted; cherry-picked only the pricing commit onto a fresh branch (`feature/gemini-pricing`).

## 5. Root causes and key findings

- **Google direct ≠ full Google AI product list in other apps.** PopDAM's `google-direct/*:batch` path is the Image Tagging direct Batch API only (`isDirectGeminiBatchModel` requires `google-direct/` + `:batch`). The catalog should list Google generateContent Gemini models as those batch options.
- **Google's listModels** (`generativelanguage.googleapis.com/v1beta/models?key=…`) is the live source when `GOOGLE_AI_API_KEY` is saved. Filter: name matches `/gemini/i`, has `generateContent` if methods listed, exclude embedding/aqa/imagen/learnlm.
- **OpenRouter account catalog `/api/v1/models/user`** may omit or alter pricing vs the public `https://openrouter.ai/api/v1/models` list. Always fall back to the public list for prices.
- **Retired models vanish from both Google and OpenRouter** (Gemini 2.0 Flash, 2026-10). Correct to hide them.
- **`modelInPool`**: missing endpoint key = all models available (including future); array = explicit allow-list. Reset deletes endpoint keys.
- **Batch models** (any `:batch`) only allowed for primary Image Tagging (`modelAllowedForTask` in [src/lib/ai-model-options.ts](https://github.com/u2giants/popdam3/blob/main/src/lib/ai-model-options.ts)).

## 6. Exact next steps

1. Open Settings → Processing → AI Tagging on `dam.designflow.app` (admin).
2. Confirm **Available models** lists OpenRouter + Google + Meta + ScaleDown rows with capability chips and `$in/$out` pricing on Gemini rows (not "pricing n/a" except true unknowns).
3. With a saved Google key, confirm **Google AI (direct)** filter shows many Gemini models, not one.
4. Confirm Image Tagging / ERP / PDF dropdowns show "Needs …" chips and only eligible, turned-on models with prices.
5. Tick live-proof boxes on [#433](https://github.com/u2giants/popdam3/pull/433), [#435](https://github.com/u2giants/popdam3/pull/435), [#437](https://github.com/u2giants/popdam3/pull/437) and close [#489](https://github.com/u2giants/popdam3/issues/489).
6. Successor may delete this handoff file in the commit that closes #489 (successor rule).

You'll know it worked when every check above is true on the live page and #489 is closed.

## 7. Constraints and gotchas in force

- Never push app changes directly to protected `main`; feature branch + PR + squash merge.
- Shared DB changes only in `popcre/shared-db` — this workstream had none.
- Do not edit `src/integrations/supabase/types.ts` (generated).
- `AI_MODEL_POOL` is presentation allow-list only — do not change worker routing when "fixing" dropdowns.
- Concurrent sessions share this checkout: stage only your own files; do not `git add -A`.
- GitHub Actions often starts `action_required` on new PRs from this machine — `gh run rerun` the held runs.
- Sign GitHub comments/PR bodies with `Posted by MiMo chat <id> on <machine>`.

## 8. Access and environment

- Machine nickname: **edge-dev**. Repo: `https://github.com/u2giants/popdam3`. Local path on this machine only: `C:\repos\popdam3` (do not put that path in handoffs as the only ref).
- `gh` authenticated as `u2giants`. No secrets in this session. OpenRouter/Google keys live in `admin_config` (Settings); 1Password vault `vibe_coding` for credential storage — values never in chat or git.
- Tests: `npm test` (vitest). Typecheck: `npx tsc --noEmit`. Build: `npm run build`.

## 9. Open questions and risks

- (2026-10-25) Live Settings proof not yet done — if Coolify serves a stale image, check Publish Frontend Image + live build stamp (see AGENTS.md stale-site note).
- (2026-10-25) Google listModels coverage depends on the saved key's API enablement; if the list is empty, UI falls back to the single known batch model — expected, not a bug.
- (2026-10-25) Pricing "n/a" can still appear for models OpenRouter does not list; that is honest, not a lookup failure.
