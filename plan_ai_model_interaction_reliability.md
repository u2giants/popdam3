# AI Model Interaction Reliability Implementation Plan

Linked handoff: [`HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md`](HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md)

GitHub tracking issue: [`u2giants/popdam3#90`](https://github.com/u2giants/popdam3/issues/90)

## STATUS

Fresh sessions start at **Step 1**. Read this table first and do not re-derive or
re-plan completed steps. Whoever executes any step must update this table in the
same commit, citing the test, verification artifact, commit, or CI run that proves
the new status.

| Step | Status | Date | Evidence / fresh-session start |
|---|---|---|---|
| 1. Freeze the behavior contract with failing tests | ✅ complete | 2026-08-16 | Executor tests cover recoverable invalid output and terminal authentication failure; worker suite 31/31 passed. |
| 2. Build the shared capability profile and strategy planner | ✅ complete | 2026-08-16 | `model-capabilities.test.ts` proves variant lookup, override merge, ordering, and unsupported-method exclusion. |
| 3. Make the structured-output executor exhaust compatible methods | ✅ complete | 2026-08-16 | Worker tests and TypeScript build passed; attempt history and terminal stopping are verified. |
| 4. Move tagging and Vision Bake-Off to the shared executor | ✅ complete | 2026-08-16 | Both paths use `callTagAssetModel`; bake-off records `_popdam_output_attempts`. |
| 5. Move ERP classification to the shared executor and remove silent skips | ✅ complete | 2026-08-16 | ERP validates schema/tool/JSON results and returns an explicit `failed` counter. |
| 6. Align bridge and Windows PDF vision fallback | ✅ complete | 2026-08-16 | Both agent TypeScript builds pass with identical OpenRouter-first selection and refusal handling. |
| 7. Make the model catalog and settings UI capability-complete | ✅ complete | 2026-08-16 | Admin API normalizes capabilities/overrides; both screens consume that endpoint; frontend tests/build pass. |
| 8. Run end-to-end verification and document the final contract | ✅ complete | 2026-08-16 | Frontend 109/109, worker 31/31, lint (0 errors), all four builds, and authenticated production run `53cbb6e7-718a-418a-8832-158bd74d3626` passed 5/5. |
| 9. Commit, push, deploy, verify, and retire this plan/handoff | ✅ complete | 2026-08-16 | CI and Railway are green through `f5bcba80`; production smoke passed without changing asset tags; issue #90 closed. Plan retained as historical evidence because its linked handoff belongs to a different session and must not be deleted here. |

Natural context cut points are after Steps 3, 6, and 8. At each cut, use the
`fresh-session` skill. Before starting the next phase, re-read all downstream
steps and update this STATUS table for drift.

---

## 1. The ultimate goal

PopDAM must be able to use any eligible AI model without knowing that model's
private quirks in advance. The system should choose only output methods the model
claims to support, continue safely when one method returns malformed data, record
exactly what failed, and never report success while silently skipping work.

When this is complete:

- Production image tagging and Vision Bake-Off will use the same reliable,
  capability-driven behavior.
- A model that fails tool calling but can return valid schema JSON will still
  succeed without being falsely disqualified.
- ERP classification will either save a validated classification or record an
  explicit failure. It will never quietly move past an item.
- Bridge and Windows PDF text extraction will interpret the same model setting in
  the same way and will expose empty/refused model responses as failures.
- Model selection will show the actual capabilities used by the runtime.
- Every important compatibility branch will be protected by automated tests.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Do not
preserve a listed edit merely because it is written here if repository or provider
reality has changed and that edit would reintroduce guessing, silent failure, or
different behavior between production and the bake-off.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed consumer-
product artwork. Designers and sales staff use `https://dam.designflow.app` to
browse, search, tag, and manage source art. PopSG is the style-guide mode at
`https://sg.designflow.app`; both domains use one frontend image and one hosted
Supabase backend.

Repository and delivery facts:

- Repository: `https://github.com/u2giants/popdam3`, local canonical checkout
  `/worksp/popdam`.
- Branch policy: this `u2giants` app repository ships directly from `main`; do
  not create a feature branch.
- Frontend: React/Vite under `src/`, published to GHCR and run by Coolify.
- Cloud worker: Node/TypeScript under `apps/worker/`, automatically rebuilt by
  Railway on every push to `main`.
- Bridge agent: Node/TypeScript under `apps/bridge-agent/`, packaged as the
  Synology container image.
- Windows agent: Node/TypeScript under `apps/windows-agent/`, packaged by the
  Windows-agent GitHub workflow.
- Shared contracts: `supabase/functions/_shared/`.
- Shared database project: Supabase `qsllyeztdwjgirsysgai`. This plan requires no
  database structure change and no migration.

AI workloads in scope:

1. Production image tagging, `apps/worker/src/handlers/ai-tagging.ts`.
2. Vision Bake-Off, `apps/worker/src/handlers/ai-tag-bakeoff.ts`.
3. Their shared tag contract, `apps/worker/src/handlers/ai-tagging-shared.ts` and
   `supabase/functions/_shared/tag-asset-contract.js`.
4. ERP product-category classification, `apps/worker/src/handlers/erp.ts`.
5. PDF image-to-text fallback in
   `apps/bridge-agent/src/pdf-text-sampler.ts` and
   `apps/windows-agent/src/pdf-text-sampler.ts`.
6. Direct DeepSeek rich-PDF extraction, `apps/worker/src/deepseek.ts` and
   `apps/worker/src/handlers/rich-pdf.ts`, regression verification only.
7. Model configuration and selection in `src/components/settings/ApisTab.tsx`,
   `src/components/settings/AiTagBakeoffTab.tsx`, and
   `supabase/functions/admin-api/index.ts`.

## 3. What triggered this work

On 2026-08-15, Vision Bake-Off ran `meta/muse-spark-1.2` and failed with this
sequence:

1. OpenRouter returned HTTP 400 because Muse's provider accepts only
   `tool_choice: "auto"`, while PopDAM sent `"required"`.
2. The JSON-schema leg returned no parsable schema result.
3. JSON-object mode returned no parsable JSON.
4. The repair retry also failed.

Commit `c3f133b5` is already on `main` and deployed to Railway. It makes Muse
Spark schema-first and recognizes tool-choice compatibility errors returned as
either HTTP 400 or 404. GitHub CI run `31921541662` passed, and Railway marked
that exact commit successful.

The follow-up audit found that Muse was a symptom of a broader design problem:
the runtime mostly guesses model behavior from model-name patterns, malformed
tool output can stop the fallback cascade, ERP can silently skip a normal text
response after falling back to automatic tool choice, and the two PDF agents do
not use the same provider path.

Reproduction after Step 1 adds fixtures:

- Feed the tag executor a successful HTTP response containing malformed tool
  arguments. Current code throws before JSON schema is attempted.
- Feed it valid tool JSON missing `content_type`. Current validation throws
  before the JSON-schema leg is attempted.
- Make ERP receive ordinary JSON/prose after `tool_choice` downgrades to `auto`.
  Current code sees no `toolCalls[0]` and uses `continue`, recording no explicit
  item failure.
- Give Windows and bridge agents the same `AI_TASK_MODELS.pdf_extraction` value
  with OpenRouter available. Windows uses OpenRouter, while bridge resolves the
  older direct-provider catalog.

## 4. Scope

### In scope

- A single capability vocabulary for vision, tools, tool-choice modes, strict
  JSON schema, and JSON-object mode.
- Live OpenRouter model metadata with bounded caching and loud stale/fallback
  behavior.
- A small, explicit override mechanism for facts OpenRouter does not publish,
  such as a provider supporting only automatic tool choice.
- One structured-output strategy planner and executor used by image tagging,
  Vision Bake-Off, and ERP classification.
- Continuing after malformed or semantically invalid model output when another
  compatible output method remains.
- Stopping immediately on authentication, authorization, billing, and exhausted
  rate-limit failures that another output format cannot repair.
- Full per-attempt diagnostics without storing prompts, images, API keys, or
  licensed source content.
- Matching PDF vision configuration and error behavior across bridge and Windows.
- Settings and bake-off UI capability labels that match runtime behavior.
- Automated unit, integration-style, build, and visual checks.
- Documentation updates in `AGENTS.md`, `docs/MODEL_RULES.md`,
  `docs/KNOWN_QUIRKS.md`, `docs/configuration.md`, and relevant agent docs.

### NOT in this plan

- Changing the `tag_asset` business taxonomy, prompt wording, required output
  fields, or tag normalization rules.
- Choosing a new production model, changing prices, or running a large paid
  bake-off. A minimal post-deploy smoke run is allowed and required.
- Re-tagging existing assets or rewriting historical bake-off rows.
- Creating or altering Supabase tables, columns, views, functions, policies, or
  migrations. If implementation unexpectedly requires structure, stop and use
  canonical `/worksp/shared-db` branch + PR workflow before changing app code.
- Recreating the deleted `supabase/functions/ai-tag` function.
- Removing direct DeepSeek rich-PDF extraction. Its provider-prefix caching is
  intentional and currently sound.
- Removing `GOOGLE_AI_API_KEY` or direct Google/Anthropic PDF fallback. Those
  remain supported as a compatibility path when OpenRouter is unavailable on an
  installed agent.
- General search-pipeline, embedding, ERP taxonomy, or UI redesign work.
- Provider performance tuning that is not necessary for correct capability
  routing.

## 5. Current state of the code

This section describes `main` at planning baseline commit `c3f133b5`. The
implementer must `git pull --ff-only origin main` only after confirming the
checkout has no unrelated uncommitted files. If `main` has moved, re-check the
named functions and update line references, but keep the stated behavior goals.

### What works

- `apps/worker/src/openrouter.ts::chatCompletion()` centralizes OpenRouter calls
  for tagging and ERP, retries network/429/5xx failures, applies Exacto routing,
  and downgrades rejected named/required `tool_choice` values through `required`
  and `auto`.
- Commit `c3f133b5` makes that downgrade recognize HTTP 400 and 404.
- `apps/worker/src/handlers/ai-tagging-shared.ts::callTagAssetModel()` has tool,
  JSON-schema, JSON-object, and one JSON-repair mechanisms.
- `callTagAssetModel()` validates `tags`, `ai_description`,
  `scene_description`, and `content_type` before returning.
- Production tagging and Vision Bake-Off share `callTagAssetModel()`.
- `apps/worker/src/deepseek.ts::deepSeekChat()` uses bounded retries, a two-minute
  timeout, JSON mode, and stable-prefix caching for rich-PDF extraction.
- The model settings and bake-off screens already read OpenRouter's model list
  and display coarse support for tools, structured outputs, and response format.

### Half-done or defective behavior

- `apps/worker/src/handlers/ai-tagging-shared.ts:74-99` contains model-name
  regular expressions for Gemma, Llama Scout, MiniMax M3, and Muse Spark. Every
  other model is assumed to support the default tool path.
- `apps/worker/src/handlers/ai-tagging-shared.ts:350-362` validates tool output
  inside the tool try/catch, then rethrows any error not recognized as a narrow
  capability error. `Malformed tool call JSON` and `Model returned invalid tool
  tag data` do not qualify, so the schema and JSON legs never run.
- `apps/worker/src/handlers/ai-tagging-shared.ts:368-414` always attempts JSON
  schema and JSON-object legs after a recognized tool capability failure,
  regardless of the model metadata. This creates avoidable calls and confusing
  errors for tools-only models.
- `apps/worker/src/handlers/erp.ts:398-407` requests the named
  `classify_product` tool and silently continues if `toolCalls[0]` is absent or
  the category is invalid. That item is neither classified nor counted as an
  explicit failure.
- `apps/windows-agent/src/pdf-text-sampler.ts:74-110` prefers OpenRouter when a
  key exists and uses `AI_TASK_MODELS.pdf_extraction`.
- `apps/bridge-agent/src/pdf-text-sampler.ts:73-139` uses the legacy direct
  provider catalog and has no OpenRouter path. Both agents return empty strings
  for several configuration failures, and both accept an empty successful model
  response without a diagnostic that distinguishes refusal from no readable text.
- `supabase/functions/admin-api/index.ts:862-892` exposes only
  `supports_tools` from `/models/user`, while the React screens independently
  parse additional capability fields. The server and browser can disagree.
- `apps/worker/src/openrouter.test.ts` tests the Muse name rule and 400/404 helper
  only. No test executes the complete structured-output cascade.

### Untouched state

- No database migration or schema work has started.
- No implementation for issue #90 has started.
- No production configuration has been changed for this plan.
- The existing checkout may contain unrelated work from concurrent sessions.
  Preserve it and stage only files named by the step being implemented.
- The external `Supabase Preview` GitHub check currently fails on ordinary app
  commits with `Remote migration versions not found in local migrations
  directory.` The same failure is present on pre-plan commit `c3f133b5` and plan
  commit `563c802a`; it is caused by this app's historical migration folder not
  containing canonical `/worksp/shared-db` history. Do not copy migrations into
  this repo or add a bypass. Required PopDAM CI and both shared-database guards
  must still be green. If `admin-api` changes, verify the normal Supabase edge
  deployment workflow separately.

## 6. Key findings and root cause

1. **The system confuses advertised support with exact behavior.** OpenRouter's
   `supported_parameters` tells us whether a model advertises `tools`,
   `tool_choice`, `structured_outputs`, and `response_format`, but it does not
   state whether a particular provider accepts named, required, or only automatic
   tool choice. Muse advertised tools and tool choice but rejected required mode.

2. **Capabilities are collected in the UI but discarded at execution time.**
   `src/components/settings/AiTagBakeoffTab.tsx` filters candidate models using
   OpenRouter metadata, while `callTagAssetModel()` receives only a model ID and
   guesses the strategy from its name.

3. **Output-format failure and terminal provider failure are not separated.** A
   malformed tool response is repairable by another format and should continue.
   An invalid API key is not repairable by asking for JSON instead and should stop.

4. **The cascade is nested control flow rather than a planned list of attempts.**
   This makes it difficult to test, record, reorder by capability, or reuse for
   ERP.

5. **ERP has no validated non-tool completion path.** The shared client may
   legitimately downgrade to `tool_choice: auto`, but the ERP handler understands
   only a tool call and silently continues otherwise.

6. **PDF agent behavior drifted because provider logic is duplicated.** Windows
   gained an OpenRouter-first path; bridge retained direct Google/Anthropic logic.
   Documentation now describes one path while production has two.

7. **The public catalog is heterogeneous.** The 2026-08-15 public OpenRouter
   catalog contained image models across tools+schema, schema-without-tools,
   tools-without-schema, JSON-only, and no-structured-output groups. Counts are
   intentionally not frozen into implementation because the catalog changes;
   the re-runnable evidence command is:

   ```bash
   curl -fsSL https://openrouter.ai/api/v1/models \
     | jq '[.data[] | select((.architecture.input_modalities // []) | index("image")) | {id, supported_parameters}]'
   ```

Root cause: there is no runtime capability contract shared by catalog discovery,
strategy selection, execution, diagnostics, and UI. Handwritten exceptions and
nested fallback logic filled that gap until provider differences exposed it.

## 7. Approaches considered and rejected

1. **Keep adding model-name exceptions. Rejected.** The Muse fix was necessary
   for immediate production recovery, but one regular expression per model does
   not scale and becomes stale when an upstream provider changes behavior.

2. **Change every tool call from `required` to `auto`. Rejected.** Automatic mode
   lets a model answer in prose without calling the tool. That is exactly what
   makes ERP's current silent skip possible.

3. **Make tool calling the universal first choice. Rejected.** Schema-native
   models pay for a request that may always fail, and models such as Muse can
   advertise tools without accepting forced tool choice.

4. **Make strict JSON schema the universal first choice without checking
   metadata. Rejected.** Some models are tools-only or JSON-object-only. The
   strategy must follow capabilities and retain controlled compatibility fallbacks.

5. **Trust `supported_parameters` as proof of named/required tool choice.
   Rejected.** Muse proves the field is not granular enough. Provider-specific
   facts require observed overrides and runtime downgrade handling.

6. **Stop on any malformed output. Rejected.** A malformed tool call says that
   one method failed, not that the model cannot satisfy the contract through
   schema or JSON mode.

7. **Cascade after every error. Rejected.** Authentication, authorization,
   billing, invalid-image, and exhausted rate-limit failures will not be repaired
   by changing output format. Continuing would multiply cost and hide the cause.

8. **Copy a third provider implementation into each PDF agent. Rejected.** More
   duplicated code would create the same drift again. Use a small shared package
   for request/response handling and keep agent-specific file work in each agent.

9. **Move rich-PDF extraction from direct DeepSeek to OpenRouter. Rejected.** The
   direct path intentionally preserves DeepSeek prefix-cache savings and was not
   implicated by the audit.

10. **Add a database capability table. Rejected for this plan.** Capabilities are
    provider metadata plus a small runtime configuration overlay. `admin_config`
    can hold the overlay without a shared database structure change.

## 8. Design decisions already made

### Locked decisions, do not relitigate

- **2026-08-15: capability-driven, not name-driven.** Runtime strategy uses live
  OpenRouter metadata plus explicit overrides. Model-name regexes are removed
  after equivalent profiles exist.
- **2026-08-15: strict schema first when genuinely supported.** For a model with
  `structured_outputs`, use strict `json_schema` before tools. Then use
  `response_format: json_object`, then compatible tool mode. Tools-only models
  begin with their strongest known tool mode.
- **2026-08-15: adaptive downgrade remains bounded.** If a provider rejects a
  tool-choice form, try the next compatible form without consuming the ordinary
  transient retry budget. Never loop back to a previously attempted form.
- **2026-08-15: malformed or semantically invalid output continues.** Record the
  failed attempt and move to the next compatible method. One final JSON repair is
  allowed only after a JSON-producing method returns malformed/invalid content.
- **2026-08-15: terminal provider failures stop.** 401/403, billing/credit errors,
  invalid image/media download/content-policy rejection, and exhausted 429/5xx
  retries are returned immediately with their original evidence.
- **2026-08-15: one executor for tagging and ERP.** The schema and validator are
  task-specific; routing, attempts, retry classification, and diagnostics are shared.
- **2026-08-15: no silent success.** ERP and PDF failures must increment an
  explicit failure/skip reason and surface in logs/result status.
- **2026-08-15: PDF provider behavior matches.** Both agents use OpenRouter first
  when configured and preserve direct Google/Anthropic as an explicit fallback.
- **2026-08-15: DeepSeek rich-PDF stays direct.** Regression tests only.
- **2026-08-15: no DB structure change.** Use `admin_config` key
  `AI_MODEL_CAPABILITY_OVERRIDES` for observed exceptions. Example shape, with no
  secrets:

  ```json
  {
    "meta/muse-spark-1.2": {
      "tool_choice_modes": ["auto"],
      "prefer": ["json_schema", "json_object", "tool_auto"]
    },
    "minimax/minimax-m3": {
      "tools": false,
      "prefer": ["json_schema", "json_object"]
    }
  }
  ```

### Open implementation judgment, with criteria

- **Shared package name and build form:** Prefer
  `packages/ai-model-routing/`, matching the existing local package pattern used
  by `packages/path-filters`. If Windows module compatibility makes that package
  materially larger than the request logic, keep worker routing in
  `apps/worker/src/` and create only `packages/ai-vision-client/` for the agents.
  The acceptance criterion is one source of truth for agent request/response
  semantics without changing their packaging format.
- **Catalog cache duration:** choose 5–15 minutes. It must support last-known-good
  stale use with a warning during catalog outages, and it must not call
  `/models/user` once per asset.
- **Attempt telemetry storage:** reuse existing
  `raw_output._popdam_*` JSON for bake-off. Do not add database columns. Production
  logs may contain model ID, method, status, latency, and sanitized error only.

## 9. Numbered implementation plan

### Phase A: contract and shared routing

#### Step 1. Freeze current failures in tests

Files:

- Extend `apps/worker/src/openrouter.test.ts`.
- Add `apps/worker/src/structured-output.test.ts` or
  `apps/worker/src/handlers/ai-tagging-shared.test.ts`.
- Extend `apps/worker/src/handlers/ai-tagging.test.ts` for operation accounting.
- Add/extend an ERP handler test near `apps/worker/src/handlers/erp.ts`.

Add fetch-driven fixtures that prove:

1. HTTP 400 and 404 tool-choice rejections downgrade once and do not consume the
   transient retry count.
2. Malformed tool arguments continue to strict schema.
3. Valid tool JSON missing a required field continues to strict schema.
4. Strict-schema invalid output continues to JSON-object mode.
5. JSON-object invalid output gets one repair attempt.
6. A terminal 401, 403, billing error, invalid image, content-policy refusal, or
   exhausted 429 does not cascade.
7. The final error contains all attempted methods and sanitized reasons.
8. ERP receiving text/JSON instead of a tool call does not silently disappear.

Use dependency injection for `fetch`/transport rather than making paid live model
calls in unit tests.

Dependencies: none. This step must precede implementation.

**You'll know it worked when:** the new tests fail against baseline `c3f133b5`
for the expected reasons, and the existing worker suite still executes. Record
the failing test names in this STATUS table before Step 2.

#### Step 2. Build the shared capability profile and strategy planner

Files:

- Add `apps/worker/src/model-capabilities.ts` or the selected shared package.
- Update `apps/worker/src/openrouter.ts` to export the bare model-ID normalizer
  and transport error classification needed by the planner.
- Update `apps/worker/src/config.ts` and configuration loading for
  `AI_MODEL_CAPABILITY_OVERRIDES`.
- Add `apps/worker/src/model-capabilities.test.ts`.

Define:

- `ModelCapabilities`: model ID, image input, tools, tool-choice parameter,
  known tool-choice modes, strict structured outputs, JSON-object response
  format, source (`live`, `stale_cache`, `override`, `unknown`), and fetched time.
- `StructuredOutputMethod`: `json_schema`, `json_object`, `tool_named`,
  `tool_required`, `tool_auto`, and `json_repair`.
- `getModelCapabilities(apiKey, modelId, overrides)`: fetch `/api/v1/models/user`,
  strip routing variants for lookup, cache the account-filtered catalog, merge
  explicit overrides, and retain last-known-good data during a transient catalog
  outage with a loud warning.
- `buildStructuredOutputPlan(capabilities, taskNeeds)`: return a deduplicated,
  bounded ordered list. Never include an unsupported method unless capabilities
  are `unknown`; the unknown cold-start plan must be conservative, marked as
  inferred, and still bounded.

Remove the behavior represented by `NON_TOOL_CALLING_MODEL_PATTERNS` and
`JSON_SCHEMA_FIRST_MODEL_PATTERNS` only after tests prove the new profile gives
Muse and MiniMax the same or safer plan.

Dependencies: Step 1.

**You'll know it worked when:** pure tests cover tools+schema, schema-only,
tools-only, JSON-only, Muse override, MiniMax override, explicit routing variant,
missing model, catalog timeout with stale cache, and cold-start catalog failure.
No test depends on the live OpenRouter catalog.

#### Step 3. Implement one bounded structured-output executor

Files:

- Add `apps/worker/src/structured-output.ts`.
- Refactor only reusable transport pieces in `apps/worker/src/openrouter.ts`.
- Complete `apps/worker/src/structured-output.test.ts`.

The executor accepts messages, schema, validator, task name, model capability
profile, timeout, token limit, and optional provider pin. It must:

1. Execute the planned methods exactly once each.
2. Accept either tool arguments or parsable content when `tool_auto` is used.
3. Validate semantic requirements after parsing.
4. Record method, request tool-choice form, HTTP/provider status, parse outcome,
   validation outcome, latency, usage, and sanitized error for every attempt.
5. Continue after capability rejection, missing tool call, malformed JSON, and
   failed semantic validation.
6. Stop after terminal transport/provider errors.
7. Allow one repair attempt using the previous validation/parse error, without
   echoing asset content into logs.
8. Return the successful method and attempts or one terminal aggregate error.

Do not let `chatCompletion()` secretly reorder methods. It may downgrade a
single tool request's choice form, but the executor remains the visible owner of
the overall output plan.

Dependencies: Steps 1–2.

**You'll know it worked when:** all Step 1 tests pass, including malformed tool
JSON continuing to schema and terminal failures stopping immediately. Run:

```bash
cd /worksp/popdam/apps/worker
npm ci
npm test
npm run build
```

**Fresh-session cut:** update the STATUS table, use `fresh-session`, and re-read
Steps 4–9 before continuing.

### Phase B: migrate every workload

#### Step 4. Move production tagging and Vision Bake-Off to the executor

Files:

- `apps/worker/src/handlers/ai-tagging-shared.ts`
- `apps/worker/src/handlers/ai-tagging.ts`
- `apps/worker/src/handlers/ai-tag-bakeoff.ts`
- `src/components/settings/AiTagBakeoffTab.tsx`
- Tagging/bake-off tests under `apps/worker/src/handlers/`.

Replace the nested `callTagAssetModel()` cascade with a thin adapter around the
shared executor and `TAG_ASSET_SCHEMA`. Keep `validateTagAssetData()` as the
business validator. Preserve endpoint pinning and Exacto behavior unless the
capability plan or an explicit model variant says otherwise.

Return `outputMode`, total repair count, and full sanitized attempt history.
Vision Bake-Off must store that history under
`raw_output._popdam_output_attempts`; production tagging logs it at warning level
only when a fallback method was needed. Do not overwrite production tags from a
bake-off.

Dependencies: Step 3.

**You'll know it worked when:** fixtures for schema-first, tools-only,
JSON-only, Muse, MiniMax, malformed tool arguments, and repair success all return
validated `tag_asset` data; bake-off result fixtures contain ordered attempts;
production and bake-off call the same adapter.

#### Step 5. Move ERP classification to the executor

Files:

- `apps/worker/src/handlers/erp.ts`
- New or existing ERP handler test file.
- `docs/ERP_ENRICHMENT_PLAN.md` if its behavior description changes.

Create a JSON schema and validator for `category`, `confidence`, and `rationale`.
Use the same capability lookup and executor. A valid tool call, schema response,
or JSON-object response is acceptable. Validate that category is one of
`CATEGORIES`, confidence is finite and within 0–1, and rationale is a non-empty
string.

Replace `continue` on missing/invalid output with explicit counters and bounded
diagnostics: `classified`, `failed`, and `skipped_unclassifiable` must be distinct.
Keep the existing 0.65 human-review threshold.

Dependencies: Step 3. May run in parallel with Step 4 in a separate session only
if both sessions avoid editing shared executor files simultaneously.

**You'll know it worked when:** tests prove named-tool success, auto-tool content
success, schema success, invalid category rejection, invalid confidence rejection,
terminal provider failure accounting, and no branch can leave an attempted ERP
item absent from all three counters.

#### Step 6. Align bridge and Windows PDF vision fallback

Files:

- Add `packages/ai-vision-client/` unless Step 2's chosen shared package cleanly
  owns this code.
- `apps/bridge-agent/package.json`
- `apps/windows-agent/package.json`
- `apps/bridge-agent/src/pdf-text-sampler.ts`
- `apps/windows-agent/src/pdf-text-sampler.ts`
- Agent API/config types that deliver OpenRouter, Google, Anthropic, and task
  model configuration.
- Add shared client tests and agent adapter tests.

The shared PDF vision client must send one rendered page and the existing literal
transcription prompt. Both agents use this order:

1. OpenRouter model from `AI_TASK_MODELS.pdf_extraction` when an OpenRouter key
   and model are configured.
2. Explicit direct-provider catalog fallback for Google/Anthropic when OpenRouter
   is unavailable, not after content refusal or invalid media.
3. A typed failure when no usable provider exists.

An empty model response is a valid "no legible text" outcome only when the
provider returned a normal completion with no refusal/safety/error signal. Capture
finish/refusal metadata where providers expose it. Never infer or repair text,
because faithfulness is more important than fluency for OCR fallback.

Preserve the 100 MB file-size guard and source-file timestamp invariants.

Dependencies: Step 2. May run in parallel with Steps 4–5 if shared files are
coordinated.

**You'll know it worked when:** the same fixture/config chooses the same provider
and model in both agents; tests distinguish empty transcription from refusal,
missing key, unsupported provider, timeout, and malformed response; both agent
builds pass:

```bash
cd /worksp/popdam/apps/bridge-agent && npm ci && npm run build
cd /worksp/popdam/apps/windows-agent && npm ci && npm run build
```

**Fresh-session cut:** update the STATUS table, use `fresh-session`, and re-read
Steps 7–9.

#### Step 7. Make catalog and settings UI capability-complete

Files:

- `supabase/functions/admin-api/index.ts::handleGetOpenrouterVisionModels()`
- `src/components/settings/ApisTab.tsx`
- `src/components/settings/AiTagBakeoffTab.tsx`
- Relevant frontend tests.

Make the authenticated admin API return one normalized model shape: input
modalities, tools, tool-choice parameter, structured outputs, response format,
pricing, and applied override summary. Both settings screens must consume this
server-normalized shape instead of independently interpreting provider JSON.

Show compact labels for `schema`, `json`, `tool auto`, and forced/named tool
support when known. Warn when capability detail is inferred or comes from stale
cache. Prevent selection only when required image input is definitely absent;
allow unknown capability models with a visible warning so a provider metadata
gap does not become an unexplained disappearance.

Do not expose API keys in logs, test snapshots, capability payloads, or attempt
history. Do not redesign the page.

Dependencies: Step 2.

**You'll know it worked when:** frontend tests cover each badge/warning state,
the admin endpoint contract test matches the worker capability vocabulary, and a
local screenshot of Settings → APIs and Vision Bake-Off shows readable capability
labels without layout clipping at 1440×900.

### Phase C: full verification and delivery

#### Step 8. Run end-to-end verification and update durable documentation

Files:

- `AGENTS.md`
- `docs/MODEL_RULES.md`
- `docs/KNOWN_QUIRKS.md`
- `docs/configuration.md`
- `docs/WORKER_LOGIC.md`
- PDF agent docs where current provider behavior is described.
- This plan's STATUS and current-state sections.

Run all local suites and builds. Add a small authenticated smoke script or
documented command that runs one known-safe test image against:

- Current production vision model.
- Muse Spark 1.2.
- One schema-only model.
- One tools-only model.
- Current ERP classification model with a non-production fixture.

The smoke run must be bounded, must not overwrite production asset tags, and must
store sanitized evidence under a new ignored or documented verification path,
for example `docs/verification/ai-model-routing-<UTC>/summary.json`. Never store
the image, prompts containing licensed context, or credentials.

Verify direct DeepSeek rich-PDF tests remain green; do not alter its provider.
Update docs to remove the now-false model-name exception and split-agent claims.

Dependencies: Steps 3–7.

**You'll know it worked when:** all commands below are green and the verification
summary proves each capability family selected the expected method or explicit
failure:

```bash
cd /worksp/popdam
npm ci && npm test && npm run lint && npm run build
cd apps/worker && npm ci && npm test && npm run build
cd ../bridge-agent && npm ci && npm run build
cd ../windows-agent && npm ci && npm run build
git diff --check
```

Visually serve the frontend and capture Settings → APIs and Vision Bake-Off at
1440×900. Confirm no console error and no clipped labels.

**Fresh-session cut:** update the STATUS table, use `fresh-session`, then execute
only landing Step 9.

#### Step 9. Commit, push, deploy, verify, and retire

Before committing:

1. Run `git status --short` and separate unrelated concurrent work.
2. Run `git var GIT_COMMITTER_IDENT`; it must show
   `Albert Hazan <u2giants@users.noreply.github.com>`.
3. Update this plan's STATUS table with evidence for every completed step.
4. Update or replace this session's handoff according to the handoff standard.
5. Stage only files belonging to issue #90.

Push `main`. Verify:

- GitHub CI is green for the exact commit.
- Railway reports success for the exact worker commit.
- Relevant Supabase edge deployment is green if `admin-api` changed.
- Frontend image workflow is green and live
  `https://dam.designflow.app` contains that build SHA if frontend files changed.
- Bridge and Windows release workflows are green if their paths changed. Do not
  claim installed agents updated until their live version/build identity confirms it.
- Run one post-deploy Vision Bake-Off smoke sample including Muse, without writing
  production tags.

Rollback is a normal revert of the issue #90 commit(s), followed by the same CI
and deployment verification. Preserve `c3f133b5` behavior during rollback so Muse
does not return to forced tool choice.

Close GitHub issue #90 only after every relevant deployment is proven. In the
same final commit, delete this plan and its linked handoff only if their entire
workstream is complete and the durable contract lives in topic docs. Git history
preserves both.

Dependencies: Step 8.

**You'll know it worked when:** issue #90 is closed by a commit on `main`, all
required CI/deploy checks are green for that SHA, live build/deployment identities
match, the smoke bake-off succeeds across capability families, and no untracked or
modified issue #90 file remains.

## 10. Tests required

### Worker capability and executor tests

- `model-capabilities: merges live metadata with explicit override`
- `model-capabilities: variant model resolves against bare catalog ID`
- `model-capabilities: stale last-known-good cache warns and remains usable`
- `model-capabilities: cold-start catalog failure produces bounded unknown plan`
- `strategy: strict schema precedes other methods when supported`
- `strategy: schema-only model never receives tools`
- `strategy: tools-only model never receives response_format`
- `strategy: Muse permits tool_auto but starts with strict schema`
- `strategy: MiniMax provider override disables tool leg`
- `executor: malformed tool JSON continues to schema`
- `executor: semantically invalid tool data continues to schema`
- `executor: schema parse failure continues to JSON object`
- `executor: JSON validation failure receives one repair attempt`
- `executor: terminal authentication and billing errors stop immediately`
- `executor: invalid image and content refusal stop immediately`
- `executor: attempt history is ordered, bounded, and sanitized`

### Tagging and bake-off tests

- `tag_asset succeeds through each supported output method`
- `tag_asset never returns without all required business fields`
- `bakeoff stores output method and every sanitized attempt`
- `bakeoff never writes production asset tags`
- `production tagging retains configured fallback-model behavior`

### ERP tests

- `ERP accepts named tool, strict schema, JSON object, and auto-tool content`
- `ERP rejects unknown category and out-of-range confidence`
- `ERP counts every attempted item as classified or failed`
- `ERP preserves 0.65 human-review threshold`

### PDF tests

- `bridge and Windows choose identical provider/model for identical config`
- `PDF client returns literal transcription without JSON/tool requirements`
- `PDF client distinguishes empty text, refusal, timeout, missing key, and bad response`
- `direct Google and Anthropic fallback remains available`
- `100 MB guard and source timestamps remain unchanged`

### Existing suites that must remain green

Use the exact commands in Steps 3, 6, and 8. Do not omit frontend lint/build or
either agent build because this plan changes shared types and UI.

## 11. Constraints, standing rules, and gotchas

- App repository work lands on `main`; no feature branch.
- Check for concurrent uncommitted work before pull, stage, commit, or push. Never
  use `git add -A` in the shared checkout.
- Verify Albert's git identity before the first commit.
- No database structure change from this repo. If structure becomes necessary,
  stop and use canonical `/worksp/shared-db` branch + PR workflow first.
- Do not attempt to fix the external `Supabase Preview` migration-history warning
  by copying canonical migrations into this app or using `db-change-approved`.
  It predates this plan and is outside issue #90.
- Do not edit generated `src/integrations/supabase/types.ts`.
- No hard-coded model behavior that should be configuration or provider metadata.
  Explicit overrides are allowed only for unreported provider facts and must be
  visible in Settings.
- No silent fallback. Every fallback records method and reason; every exhausted
  operation reports a failure.
- Preserve production tagging and bake-off parity by keeping one shared adapter.
- Keep endpoint pinning and explicit model variants functional.
- OpenRouter reports the serving endpoint, not reliably every failed route. Do
  not promise unavailable provider evidence.
- Exacto is currently applied centrally. Do not remove it casually; preserve
  explicit variants and the known MiniMax override. If the strategy changes
  Exacto use for schema requests, prove behavior with smoke evidence first.
- Never log API keys, raw images, full licensed prompts, taxonomy lists, or PDF
  text. Sanitized attempt history contains method/status/reason only.
- `GOOGLE_AI_API_KEY` remains live for direct PDF fallback. Do not delete it.
- Direct DeepSeek rich-PDF extraction stays direct for cache economics.
- PDF extraction must never invent unreadable text.
- The DAM must never change source-file timestamps.
- UI changes require local visual verification and a screenshot.
- GPT-5.6 coding sessions run only at low or medium reasoning effort.
- Update this plan as soon as any step is executed. A stale plan is a defect.

## 12. Access and environment

Expected authenticated tools on this machine:

- `git` and `gh` for `u2giants/popdam3`.
- `gh run` and `gh api` for CI/deployment evidence.
- `supabase` CLI for read-only status and normal edge deployment verification if
  the existing workflow needs investigation. Do not bypass GitHub deployment.
- `op`/1Password when toggled. Serialize all reads.

Secrets, by location only:

- Vault: `vibe_coding`.
- OpenRouter/other AI provider collection: item referenced in project docs as
  `ai-provider-api-keys`; confirm the exact item through `op item list` rather
  than guessing.
- Direct DeepSeek: `ai-provider-api-keys/deepseek` per
  `docs/RICH_PDF_EXTRACTION.md`.
- Production Supabase and deployment credentials: use the canonical items named
  in `/worksp/shared-db/AGENTS.md` and `docs/deployment.md`. Never copy values into
  files or test fixtures.

Runtime configuration:

- Supabase `admin_config.AI_TASK_MODELS` holds selected task models.
- New `admin_config.AI_MODEL_CAPABILITY_OVERRIDES` holds non-secret behavior
  overrides; this is a data/config update, not a schema change.
- Railway owns the worker's `OPENROUTER_API_KEY` and `DEEPSEEK_API_KEY` environment.
- Agent API passes approved AI config to agents.

Local setup:

```bash
cd /worksp/popdam
npm ci
npm run dev -- --host 127.0.0.1
```

Use `?mode=popsg` only when checking PopSG. Settings requires a PopDAM admin login;
obtain it from the existing `vibe_coding` item referenced by `docs/AUTHENTICATION.md`.
Do not create a new credential.

## 13. Definition of done, risks, and open questions

### Definition of done

- [ ] All nine STATUS rows are marked done with artifact-backed evidence.
- [ ] Handwritten model-name routing rules are replaced by live capabilities plus
      visible explicit overrides.
- [ ] Tagging and ERP use one bounded structured-output executor.
- [ ] Malformed and invalid outputs continue to compatible methods.
- [ ] Terminal provider failures stop without multiplying calls.
- [ ] ERP has no silent `continue` after an attempted model call.
- [ ] Bridge and Windows use the same PDF provider-selection contract.
- [ ] Settings and bake-off display runtime-relevant capabilities.
- [ ] Every test named in Section 10 exists and passes.
- [ ] Frontend, worker, bridge, and Windows builds pass.
- [ ] UI screenshots prove readable model capability labels.
- [ ] Bounded smoke evidence covers current production vision, Muse, schema-only,
      tools-only, and ERP fixture behavior.
- [ ] Durable docs describe the implemented behavior and known provider limits.
- [ ] Git identity is correct; only issue #90 files are committed.
- [ ] Commit is pushed to `main`; CI is green.
- [ ] Railway, frontend, edge, and agent delivery paths touched by the change are
      verified against the exact SHA.
- [ ] Post-deploy Muse bake-off smoke succeeds without overwriting production tags.
- [ ] Issue #90 is closed only after deployment proof.
- [ ] Plan/handoff are retired only when all obligations are carried into durable docs.

### Risks and mitigations

- **Catalog outage can block cold starts.** Keep a bounded last-known-good cache;
  allow a marked conservative unknown plan only on cold start and warn loudly.
- **Provider metadata can overstate capability.** Explicit overrides and runtime
  downgrade remain necessary; never treat metadata as proof of named/required modes.
- **More fallback legs can increase cost.** Plan only supported methods, stop on
  terminal errors, cap attempts, and record usage per attempt.
- **Schema-first can change output quality for current models.** Use the same
  business validator and bounded smoke comparisons before deploy.
- **Shared package can complicate Windows packaging.** Use the decision criterion
  in Section 8 and verify the real Windows build workflow before landing.
- **Agent release success does not prove installation.** Report build publication
  separately from live agent version identity.
- **Concurrent sessions can overwrite work.** Use isolated clean worktrees when
  the shared checkout is dirty and stage exact files only.

### Open questions for implementation, not owner decisions

- Exact granular tool-choice support is not published for every provider. The
  implementer must rely on explicit override + runtime evidence, not invent data.
- Confirm whether OpenRouter's account-filtered `/models/user` response supports
  cache validators. If not, use time-based caching.
- Confirm the smallest shared-package form that builds under both agent module
  systems using the criteria in Section 8.

No Albert decision is required before implementation. If implementation discovers
a change to model selection, paid bake-off scope, database structure, or production
credentials, stop and ask once with the exact consequence and recommendation.

---

## Mandatory plan self-audit

### Objective checklist

- [x] All 13 required sections are present.
- [x] The ultimate goal appears first in plain business English and states that
      the goal wins over a conflicting step.
- [x] A fresh session can execute without this chat or an unanswered question.
- [x] Failed and rejected approaches are recorded with reasons.
- [x] Every numbered step names files/functions, dependencies, behavior, and a
      verification gate.
- [x] Locked and open decisions are labeled.
- [x] In-scope and out-of-scope lists are explicit.
- [x] Tests are named by behavior and exact commands are supplied.
- [x] Application, paths, URLs, project ID, issue, commit, CI run, and deployment
      roles are defined.
- [x] Secrets are referenced only by vault/item location.
- [x] Definition of done includes commit, push, CI, deploy, SHA, smoke, docs, and
      handoff retirement.
- [x] This plan links to its handoff and the handoff links back. `HANDOFF.md` was
      not edited because the shared checkout contains a concurrently modified
      legacy handoff.

### Required three questions

1. **Could a brand-new AI session with no project knowledge and no context from
   this conversation execute this plan to perfection, without asking Albert
   anything?** Yes. Sections 1–4 define the business goal, application, trigger,
   reproduction, and boundaries. Sections 5–8 carry the exact current state,
   evidence, root cause, dead ends, and locked/open decisions. Section 9 gives
   file-level steps with dependencies and verification gates; Sections 10–13
   provide tests, rules, access, delivery, rollback, and decision criteria.

2. **Does the plan carry every piece of background, nuance, and reasoning held by
   the planning session, including what was ruled out and why?** Yes. Sections
   3, 5, and 6 preserve the Muse incident and all audit findings. Section 7 lists
   ten rejected approaches. Section 8 preserves the routing, fallback, PDF,
   DeepSeek, database, diagnostics, and configuration decisions with dates.

3. **Is the ultimate goal clear enough for a correct judgment call if a step is
   wrong?** Yes. Section 1 defines observable business outcomes and explicitly
   makes the goal authoritative. Sections 4 and 8 bound permissible alternatives,
   while Section 13 states when the implementer must stop rather than expand scope.

The first audit found one missing environment gotcha: the pre-existing external
`Supabase Preview` failure. Sections 5 and 11 now record its exact message,
evidence commits, correct interpretation, and prohibited bypass. The full audit
was re-run after that correction; no gap remains.
