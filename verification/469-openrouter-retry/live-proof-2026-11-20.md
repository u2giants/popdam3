---
summary: Issue #469 production PDF retry proven through OpenRouter — DEEPSEEK_BASE_URL override shipped (PR #1242), Railway env routed to OpenRouter, saved-failure retry cleared parse_error with catalog model id; fixtures cleaned.
kind: verification-record
status: current
read-when: closing or resuming #469 production-PDF-retry live-proof checkbox
---

# Issue #469 production PDF retry via OpenRouter — live proof 2026-11-20

Owner decision 2026-11-20 (verbatim, from his chat): "use deepseek through
openrouter". This pass finishes the cancelled run's remaining work: ship the
`DEEPSEEK_BASE_URL` override, route the production worker's rich-PDF DeepSeek
calls through OpenRouter, and prove the saved-failure retry live.

## Task gates (recorded verbatim outcomes)

- `ai-task-gates start --class production` — recorded for u2giants/popdam3 at
  base `59e1870bfc48`.
- `check --before deploy` — **allowed by owner authorization** (scoped
  delegation text recorded in the gate log).
- `check --before database` — **allowed by owner authorization**.
- `check --before production` — **allowed by owner authorization**.

No schema changes. No real design files touched. No NAS files placed.

## 1. PR #1242 — merged, CI green

`feat(worker): route rich-PDF DeepSeek calls through OpenRouter (#469)`,
branch `fix/469-deepseek-via-openrouter`, commit `2269ac12` (4 files:
`config.ts`, `deepseek.ts`, `deepseek.test.ts`, `handlers/rich-pdf.ts`).

- Local checks on the head: root `npm run typecheck` exit 0; root
  `npm run lint` 0 errors (359 warnings, pre-existing); worker suite
  **542/543 pass** — the one failure is `worker-heartbeat` #836, the
  documented pre-existing timing flake (fails identically on clean
  `origin/main`).
- CI on the PR: `lint-test-build` SUCCESS; task-gates, shared-db guard,
  forbid-shared-db-bypass, ai-review all SUCCESS/NEUTRAL.
- Merged 2026-11-20 11:29:56 AM EST, merge commit
  `5f2934e81f8248d962e6c791375f0adcdc335c18`.
- Railway auto-deploy from `main` (`/apps/worker/**` watch): deployment
  `55933a39-2937-42fc-b7e5-e3c360f578eb` **SUCCESS** 11:30 AM EST on that
  merge commit. `WORKER_HEARTBEAT` reports `status: running`, sha
  `5f2934e81f8248d962e6c791375f0adcdc335c18` (same build).

## 2. Railway worker env routed through OpenRouter — DONE

Service `popdam3` (`f777713f-d0f8-4f9b-9685-37c9090c98ef`), environment
`production` (`70aef28e-b9f8-4aa6-b902-c9a06aec08d5`), project
`8645c5fe-ae60-413e-8464-508456c65365`. Values verified by fingerprint only;
never printed.

- `DEEPSEEK_BASE_URL` = `https://openrouter.ai/api/v1/chat/completions`
  (readback exact). Previously **unset** — the cancelled run never made the
  env switch.
- `DEEPSEEK_API_KEY` = the production OpenRouter key from
  `admin_config.OPENROUTER_API_KEY` (the key the app's model catalog already
  uses): len 73, sha256-16 `da8b115ed72519de` (readback matches). Previously
  the DeepSeek-direct key (fp `e5fd6dec8b65dcd0`, the 2026-11-18 reviewer
  key) — that key is no longer on the worker path.
- Catalog model id: `admin_config.AI_TASK_MODELS.rich_pdf_extraction` set to
  `deepseek/deepseek-v4.1-flash-1017` (jsonb_set, sibling keys preserved).
  Previously absent (worker fell back to `deepseek-chat`).
- Pre-flight benign call 11:27 AM EST: `POST
  https://openrouter.ai/api/v1/chat/completions` with the admin_config key and
  model `deepseek/deepseek-v4.1-flash-1017` returned **HTTP 200**, response
  model `deepseek/deepseek-v4.1-flash-1017` — key and catalog id both resolve
  on OpenRouter.
- Railway access: CLI session refreshed via `railway whoami` (OAuth token in
  `%USERPROFILE%\.railway\config.json`; the stored 1Password "Railway API"
  tokens remain dead, gap #551). `variableUpsert` with `skipDeploys: true`
  (the merge-triggered deploy carried both code and env).

## 3. Saved-failure retry via OpenRouter — PROVEN (11:35 AM EST)

Fixture re-created per the documented method
(`verification/469-deepseek-retry/live-proof-2026-11-18.md`): asset id
`00004690-4690-4000-8000-000000000001` (`toytest_tech_pack_469probe.pdf`,
sorts at the front of the `pdf_text_samples` scan), 150-char harmless filler
(sha256 `ba621d0e526b761177d81b3e488fdfffab2625e9fb345bd80bfbd8a576c15de0`,
verified before insert), failure row via `upsert_pdf_rich_extraction`
(`p_parse_error="probe-induced failure for 469 retry verification"`,
`p_data={}`). No leftover fixture rows from the cancelled run were found
(pre-check: 0 rows).

- **Leg 1:** `get_pdf_rich_extraction_hashes` returned `parse_error`
  non-null, sha `ba621d0e…`. Cooldown seeded (fixture row only):
  `extracted_at = now() - interval '25 hours'` → `2026-11-19 10:34:46-05:00`
  via the documented Management-API SQL route. 24h cooldown elapsed.
- **Retry triggered** 11:35:42 AM EST: `admin_config.BULK_OPERATIONS`
  `rich-pdf-extract` set `status=running`, `cursor=0` (jsonb_set). Worker
  picked up immediately.
- **Retry observed 11:35:48 AM EST** — 6 seconds after trigger:
  - `parse_error: null` (success cleared the saved failure) ✓
  - `extracted_at: 2026-11-20 11:35:48.80267-05:00` (fresh) ✓
  - `model: deepseek/deepseek-v4.1-flash-1017` — the OpenRouter catalog id,
    returned by the provider. The direct DeepSeek API cannot return this id;
    this is the OpenRouter-routing proof. ✓
  - `source_text_sha256` unchanged (`ba621d0e…`) — same-hash cooldown retry,
    not a changed-text retry. ✓

This is the 2026-11-05 live-proof criterion ("one production saved failure
followed by a rich-pdf extraction run that retries it… a successful extraction
with `parse_error` cleared") — now satisfied **through OpenRouter** per the
owner's 2026-11-20 decision.

## 4. Cleanup — DONE

- Fixture rows deleted (asset / `pdf_text_samples` /
  `dam.pdf_rich_extraction` for `00004690-…`): 1/1/1 deleted, post-cleanup
  reads **0/0/0 remain**. No partial fixture from the cancelled run existed.
- `rich-pdf-extract` op set `interrupted` / `user_stop` at ~11:36 AM EST after
  the proof (bounds provider spend on the wider backlog; cursor persisted,
  resumable normally).

## Disclosed writes

1. Railway service `popdam3` env: `DEEPSEEK_BASE_URL` added,
   `DEEPSEEK_API_KEY` replaced (DeepSeek-direct key → production OpenRouter
   key fp `da8b115ed72519de`). No redeploy from the upserts; the PR merge
   deploy `55933a39` carries code + env.
2. `admin_config.AI_TASK_MODELS.rich_pdf_extraction` =
   `deepseek/deepseek-v4.1-flash-1017` (sibling keys preserved).
3. `admin_config.BULK_OPERATIONS.rich-pdf-extract`: run 11:35–11:36 AM EST
   (normal extraction output on pending production rows plus the fixture
   retry); op row left `interrupted`/`user_stop`.
4. Fixture rows created and deleted (0 remain).
5. PR #1242 merged to `main` (merge commit `5f2934e8`).

## Live-proof checkbox

- [x] production PDF retry — **PROVEN 2026-11-20 11:35:48 AM EST** through
  OpenRouter (`model: deepseek/deepseek-v4.1-flash-1017`, key fp
  `da8b115ed72519de`, base URL `https://openrouter.ai/api/v1/chat/completions`).
  Saved failure row retried after the 24h cooldown; success cleared
  `parse_error` to null. Supersedes the "dedicated DeepSeek credential"
  wording: the owner's 2026-11-20 decision routes DeepSeek through OpenRouter
  with the production OpenRouter catalog key.

Posted by MiMo chat unknown on desktop
