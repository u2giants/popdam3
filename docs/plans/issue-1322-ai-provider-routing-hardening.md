---
summary: "Issues 1322/1316/1243: AI calls use the right provider, key and model name per route, with loud, accurately labelled failures."
kind: plan
status: open
read-when: "changing how the worker or agents route AI calls to OpenAI direct, Straitly, OpenRouter or DeepSeek; fixing review findings 1322, 1316, 1243, 1366 or 1318"
---

# AI provider routing hardening (issues #1322, #1316, #1243)

Issues covered:
- [#1322](https://github.com/u2giants/popdam3/issues/1322): the Straitly route. This plan also carries folded [#1366](https://github.com/u2giants/popdam3/issues/1366), the `STRAITLY_ROUTING=off` switch.
- [#1316](https://github.com/u2giants/popdam3/issues/1316): OpenAI direct. This plan also carries folded [#1318](https://github.com/u2giants/popdam3/issues/1318), the agent sampler tests and comments.
- [#1243](https://github.com/u2giants/popdam3/issues/1243): the rich-PDF DeepSeek call through OpenRouter.

Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Route resolver module | ⬜ open | — |
| 2. Batch repair stays on its batch provider | ⬜ open | — |
| 3. Key gates name the right key per route | ⬜ open | — |
| 4. Capability source for Straitly models | ⬜ open | — |
| 5. Errors and logs name the real provider | ⬜ open | — |
| 6. OpenAI direct: parameter-drop allowlist and bounded retries | ⬜ open | — |
| 7. Agent PDF OpenAI path: catalog check and tests | ⬜ open | — |
| 8. `STRAITLY_ROUTING` switch tests and wording | ⬜ open | — |
| 9. Rich-PDF DeepSeek endpoint/key/model pairing | ⬜ open | — |
| 10. Docs and quirks | ⬜ open | — |
| 11. Land and live proof | ⬜ open | `- [ ] live proof` stays on each issue |

A fresh session starts at step 1. Steps 6–7 (OpenAI direct) and step 9 (DeepSeek) do not depend on steps 1–5 and can be done in either order.

## 1. Ultimate goal

Every AI call PopDAM makes goes to the provider that the owner's settings say it should use. It uses that provider's key and a model name that provider understands. When something is missing or wrong, the call fails loudly with a message that names the real provider and the real setting to fix. Nothing is quietly re-routed to a different provider, silently weakened (for example, by dropping the structured-output request), or reported as "OpenRouter" when it was really Straitly or OpenAI. Albert can then trust that the routing switches in Settings do what they say, and that a failure message tells whoever reads it what to fix.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed consumer-product artwork (Disney, Marvel and others). Design files on a Synology NAS are scanned, thumbnailed and tagged by AI, then browsed and searched in a web app. PopSG is a style-guide mode served from the same code.

- Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3). The release branch is `main`, which is protected: open a pull request, and the AI merges it.
- AI calls happen in three places:
  - The **Railway cloud worker** (`apps/worker/`). It deploys automatically when a `main` change touches `apps/worker/**`. It does image tagging, Vision Bake-Off, style-group profiles, item short descriptions and rich-PDF extraction.
  - The **NAS bridge agent** (`apps/bridge-agent/`) and the **Windows render agent** (`apps/windows-agent/`). Both sample PDF pages through `packages/agent-common/src/pdf-ai-vision.ts`.
  - **Edge functions** (`supabase/functions/`). They hand keys and routing settings to the agents (`agent-api`).
- Settings live in the shared database table `public.admin_config` (project `qsllyeztdwjgirsysgai`).

## 3. What triggered this work

The advisory AI reviewer filed findings on three merged routing changes and two follow-ups:
- [PR #1321](https://github.com/u2giants/popdam3/pull/1321) (2026-11-24) sends every non-OpenAI, non-Anthropic chat model through Straitly (`api.straitly.ai`), which is an OpenAI-compatible gateway. Finding: [#1322](https://github.com/u2giants/popdam3/issues/1322).
- [PR #1365](https://github.com/u2giants/popdam3/pull/1365) (2026-11-25) adds `admin_config.STRAITLY_ROUTING = "off"` to send those models back to OpenRouter. Finding: #1366, folded into #1322.
- [PR #1315](https://github.com/u2giants/popdam3/pull/1315) (2026-11-24) sends `openai/*` models straight to `api.openai.com`, with the switch `admin_config.OPENAI_ROUTE` (`direct` by default, or `openrouter`). Finding: [#1316](https://github.com/u2giants/popdam3/issues/1316).
- [PR #1317](https://github.com/u2giants/popdam3/pull/1317) fixed the agent builds after that change. Finding: #1318, folded into #1316.
- [PR #1242](https://github.com/u2giants/popdam3/pull/1242) (2026-11-20) lets rich-PDF DeepSeek calls point at OpenRouter through `DEEPSEEK_BASE_URL`. Finding: [#1243](https://github.com/u2giants/popdam3/issues/1243).

The automatic fixer's PRs (#1323, #1244) were closed without merging. A `fixer-done` label is **not** proof of a fix. Every finding below was re-checked against `main` at `787c20b8` on 2026-11-25 and is still present.

## 4. Scope

**In:**
- Worker `chatCompletion` routing (`apps/worker/src/openrouter.ts`).
- Batch-result repair routing (`apps/worker/src/batch-result-repair.ts`).
- Per-route key gates in the handlers.
- The capability lookup for Straitly-routed models.
- Error and log labels.
- The OpenAI-direct parameter drop and retry budget.
- The agent PDF OpenAI-direct path and its tests.
- `STRAITLY_ROUTING` tests and comments.
- Rich-PDF DeepSeek endpoint, key and model pairing.
- The matching docs.

**NOT in this plan:**
- Changing which provider is the default for any model family. Those are owner decisions; see §8.
- Moving the agents' non-OpenAI PDF calls onto Straitly. The owner decision named worker chat calls; see §13, open question.
- Colab routing and its security, which is [#1271](issue-1271-colab-vision-hardening.md).
- The parallel tagging run flags, which is [#1363](issue-1363-parallel-untagged-only-guard.md).
- New providers.
- Any database schema change.
- Rotating any key.

## 5. Current state of the code (`main` @ `787c20b8`)

> **Drift note (2026-11-25, after this plan was written):** [PR #1384](https://github.com/u2giants/popdam3/pull/1384) (`0a0efc86`) added `admin_config.OPENROUTER_ROUTING=cheapest`, which sorts OpenRouter providers by price (`openRouterCheapestRouting()` in `provider-api-key.ts`). It shifts `openrouter.ts` line numbers by about +4, so find code by function name, not by line. Step 1's resolver must keep this setting on the OpenRouter route. Step 8's flag tests should cover `OPENROUTER_ROUTING` the same way they cover `STRAITLY_ROUTING`.

- `apps/worker/src/openrouter.ts:20-24`: URL constants for OpenRouter, OpenRouter batch, OpenAI direct (`OPENAI_DIRECT_URL`) and Straitly (`STRAITLY_URL`).
- `openrouter.ts:26-38`: `isStraitlyModel(model)` returns true for anything that does not start with `openai/` or `anthropic/`. Its comment says "Batch jobs stay on OpenRouter … No silent fallback".
- `openrouter.ts:595-723`: `chatCompletion()`. It routes as follows:
  - `openAiRouting` comes from `getOpenAiRouting()` (`apps/worker/src/openai-route.ts`) for OpenAI models.
  - `straitlyKey` is set when the model is not OpenAI, `isStraitlyRoutingEnabled()` is true, and the key is non-empty. When routing is enabled and the key is empty, the call throws `OpenRouterError(401, "STRAITLY_API_KEY is not configured")`.
  - `label` is "OpenAI", "Straitly" or "OpenRouter".
  - Every HTTP failure is thrown as `OpenRouterError`, whose message starts `OpenRouter <status>:` (class at `:49-54`).
  - The 5xx log (`:685`) and the unsupported-parameter log carry no `via`. Only the 429 log has `via: label`.
  - The unsupported-parameter retry (`:695-701`) and the tool_choice fallback (`:705-715`) both do `attempt--`, so neither counts against `MAX_RETRIES = 2`.
- `openrouter.ts:734-738`: `unsupportedOpenAiParam()` returns any parameter named in a 400 `unsupported parameter/value: '<name>'` error, except `model` and `messages`.
- `apps/worker/src/batch-result-repair.ts:63-70`: `sameModelRepairCompletion(model)` returns `chatCompletion` for OpenRouter `:batch` models, with the suffix stripped. Because `chatCompletion` now routes non-OpenAI models to Straitly, the repair of an **OpenRouter** batch goes to **Straitly**.
- Key gates name only OpenRouter:
  - `apps/worker/src/handlers/ai-tagging.ts:1043-1051`: "No AI API key configured (set OPENROUTER_API_KEY in Settings)".
  - `handlers/item-short-description.ts:116-121`.
  - `handlers/ai-style-group-profile.ts:420-421`.
- `apps/worker/src/model-capabilities.ts:59-91`: `getModelCapabilities()` reads only OpenRouter's account catalog (`/api/v1/models/user`). It throws "not available in the OpenRouter account catalog" when the model is absent.
- `apps/worker/src/handlers/ai-tagging.ts:152-154`: `isModelOutageError()` matches the text `^OpenRouter (408|425|429|5\d\d):` and "not available in the OpenRouter account catalog". These strings are therefore load-bearing: changing the error prefix without changing this matcher breaks failover.
- `apps/worker/src/provider-api-key.ts:70-79`: `isStraitlyRoutingEnabled()` returns true whenever the test key override is set, so the "off" branch cannot be tested. Only the exact value `off` (case-insensitive) disables routing.
- `packages/agent-common/src/pdf-ai-vision.ts:126-151`: the OpenAI-direct branch for agent PDF sampling. It has no tests, and it skips the `capabilities.includes("vision")` catalog check that the legacy path does (`:185-193`).
- Agents default an absent `openai_route` to `direct`: `apps/bridge-agent/src/index.ts:731` and `apps/windows-agent/src/index.ts:355`.
- `apps/windows-agent/src/pdf-text-sampler.ts:52-63`: the OpenAI field comment sits between the ScaleDown doc comment and its field. `openRouterApiKey` keeps its comment; `scaleDownApiKey` lost its own.
- `apps/bridge-agent/src/pdf-text-sampler.test.ts:60-79`: the test titled "a non-ScaleDown selection still routes through OpenRouter" uses an `openai/` model. It passes only because no OpenAI key is set.
- Rich PDF:
  - `apps/worker/src/config.ts:52-60`: `deepSeekApiKey` comes from `DEEPSEEK_API_KEY`, and `deepSeekBaseUrl` from `DEEPSEEK_BASE_URL`, defaulting to `https://api.deepseek.com/chat/completions`.
  - `apps/worker/src/handlers/rich-pdf.ts:25`: `DEFAULT_RICH_PDF_MODEL = "deepseek-chat"`, a bare DeepSeek ID.
  - `rich-pdf.ts:163`: the model comes from `AI_TASK_MODELS.rich_pdf_extraction`.
  - `rich-pdf.ts:200-207`: the key gate uses only `DEEPSEEK_API_KEY`.
  - `rich-pdf.ts:303-308`: calls `deepSeekChat({ baseUrl: config.deepSeekBaseUrl, … })`.
  - `apps/worker/src/deepseek.ts:80-96`: only 429 and 5xx are retryable.
- Production settings, read-only on 2026-11-25 at ~3:55 PM EST: `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and `STRAITLY_API_KEY` are set; `STRAITLY_ROUTING` = `"on"`; there is no `OPENAI_ROUTE` row, so the route is `direct`.

## 6. Key findings and root cause

One root cause runs through all five issues. Routing was added as **branches inside one OpenRouter-shaped function**. Everything around that function still assumes OpenRouter: the error class and its text, the capability catalog, the key gates, and the batch-repair helper. Each new route therefore leaks OpenRouter assumptions into places where they are now wrong.

The individual findings, verified:
1. **Batch repair re-route (#1322 finding 1).** An OpenRouter batch's malformed answer is repaired on Straitly. That is a different provider and key, and the batch provider pin is dropped. A Straitly 400/404 there is not an infrastructure error, so the item becomes `failed_terminal` (`ai-tagging.ts:945-949`). A missing Straitly key stops the whole operation with `repair_not_authorized` for a batch that never used Straitly. This breaks the promise in `batch-provider.ts:44-51` that a job never re-routes its repair.
2. **Key gates (#1322 finding 2).** Tagging, short descriptions and profiles refuse to start when the OpenRouter key is blank, even though Straitly or OpenAI direct would be used.
3. **Capabilities (#1322 finding 2).** A model that Straitly serves but OpenRouter's account catalog lacks is unusable. The tool and JSON plan also reflects OpenRouter's support, not Straitly's.
4. **Labels (#1322 finding 3).** Straitly and OpenAI failures are recorded as "OpenRouter …" in `attempts[].error` and in bake-off `raw_output`. Because `isModelOutageError` keys off that text, a fix must change the matcher and the text together.
5. **#1366.** When `STRAITLY_ROUTING=off`, the fallback to OpenRouter is an owner-chosen switch, not a silent fallback. But the comment at `openrouter.ts:31-33` and the test name in `openai-route.test.ts:74` claim an unconditional rule. The off path also has no test, and the exact-`off` semantics are untested.
6. **OpenAI parameter drop (#1316 finding 1).** The generic drop can remove `tools`, `tool_choice` or `response_format` and turn a structured call into free text without any error.
7. **Retry budget (#1316 finding 2).** `attempt--` on two paths makes the retry count unbounded, limited only by how many parameters there are.
8. **Agent OpenAI path (#1316 finding 3, #1318).** It has no tests and no vision-capability check.
9. **Agent default `direct` (#1316 finding 4).** This is the owner's decision (§8). The key is present in production, and the edge function that sends `openai_route` ships from the same `main`. What remains is proof that a missing key fails loudly; it must not fall back.
10. **DeepSeek (#1243).** Pointing `DEEPSEEK_BASE_URL` at OpenRouter still sends the bare `deepseek-chat` (OpenRouter needs `deepseek/deepseek-chat`) and still uses the DeepSeek key. A 401 is terminal and parks each file for 24 hours (`RICH_PDF_RETRY_AFTER_HOURS`). The docs still say "direct API, do not change" (`docs/MODEL_RULES.md`, `docs/idiosyncrasies.md:259-264`, `docs/RICH_PDF_EXTRACTION.md:19,209-214`).

## 7. Approaches considered and rejected

- **Merging the fixer's closed PRs (#1323, #1244).** Rejected. They were closed unmerged, and `main` has moved since (PR #1365). Re-derive the fix from this plan.
- **Renaming `OpenRouterError` everywhere in one go.** Rejected. Persisted error text and `isModelOutageError` rely on the `OpenRouter <status>:` prefix, and historical rows keep the old text. Instead, add a `provider` field and put the real provider in the message, while keeping the class name. Then widen the matcher to accept `(OpenRouter|Straitly|OpenAI) <status>:`. Old rows still match.
- **Making Straitly fall back to OpenRouter when the Straitly call fails.** Rejected. The owner decision says no silent fallback.
- **Using the Straitly `/models` endpoint as the capability catalog.** This is open, not rejected; see §8 decision D4. Do not pick it without checking that the endpoint exists and returns modality and parameter data.
- **Auto-prefixing `deepseek/` silently whenever the base URL contains "openrouter".** Partly rejected. It is acceptable only as an explicit, tested pairing rule with a startup validation that refuses a mismatched pair; see step 9. A substring guess on the URL alone is not acceptable.
- **Removing `unsupportedOpenAiParam` entirely.** Rejected. Reasoning models really do reject `temperature` and similar parameters. Keep the retry, but restrict it to an allowlist.

## 8. Design decisions

Locked (owner decisions; do not relitigate):
- **D1 (2026-11-24, PR #1321):** interactive chat models that are not OpenAI or Anthropic go through Straitly. Batch stays on OpenRouter's Batch API. No silent fallback; a missing key is an error.
- **D2 (2026-11-24, PR #1315):** `openai/*` goes direct to OpenAI by default. `OPENAI_ROUTE=openrouter` switches it back. Direct mode with no key fails loudly. This covers the worker and the agent PDF path.
- **D3 (2026-11-25, PR #1365):** `STRAITLY_ROUTING=off` sends Straitly-routed models back to OpenRouter. This is an explicit switch, not a fallback.
- **D5 (2026-11-20, PR #1242 commit message):** rich-PDF may run through OpenRouter when configured. The owner's stated reason for direct DeepSeek (prefix-cache billing) must be recorded as superseded when the route is OpenRouter, not deleted.

Open (the implementer decides, using these criteria):
- **D4, the capability source for Straitly models.** Prefer the Straitly model list if `GET https://api.straitly.ai/v1/models` returns per-model input modalities and supported parameters. Otherwise, use the OpenRouter catalog entry when present, and a bounded compatibility plan (the existing `source: "unknown"` path) when absent, instead of throwing. Record which you chose in `docs/MODEL_RULES.md`.
- **D6, the shape of the route resolver** (step 1). Any shape is fine if one pure function returns `{provider, url, key, modelId, label}` from the model ID plus settings, and every caller uses it.

## 9. The plan

### Phase A: the worker route resolver (steps 1–5)

**Step 1. Add one route resolver.** `lead-only`: it reshapes the logic that decides where production calls go.
- In `apps/worker/src/openrouter.ts`, or a new `apps/worker/src/ai-route.ts`, add `resolveChatRoute(model, { purpose: "interactive" | "batch_repair" })`. It returns `{ provider: "openai" | "straitly" | "openrouter", url, apiKey, label }` and throws a provider-named `OpenRouterError` with a `provider` field when a key is missing.
- It encodes D1–D3, plus the rule that `purpose: "batch_repair"` never selects Straitly; step 2 depends on that.
- `chatCompletion()` calls the resolver instead of computing `openAiDirect` and `straitly` inline (`:617-642`). Add an optional `options.purpose` to `chatCompletion`, defaulting to `"interactive"`.
- When done: the routing behaviour for interactive calls is byte-for-byte the same as today.
- Gate: the existing `openai-route.test.ts` and `openrouter.test.ts` stay green, and the new tests `resolveChatRoute` routes openai/anthropic/other × each switch value pass (§10).

**Step 2. Keep batch repair on the batch provider.** `lead-only`: it touches production failure classification.
- In `batch-result-repair.ts:63-70`, return a completion bound to `purpose: "batch_repair"` for OpenRouter batches, so the repair goes to OpenRouter with the OpenRouter key and the batch's provider pin.
- Correct the comments at `:77-82` and `:133`.
- Gate: the new test "OpenRouter batch repair calls openrouter.ai, never api.straitly.ai, even with Straitly routing on and no Straitly key" passes.

**Step 3. Make the key gates follow the route.** `helper-ok`: these are mechanical edits once step 1 exists.
- Replace the OpenRouter-only gates at `handlers/ai-tagging.ts:1043-1051`, `handlers/item-short-description.ts:116-121` and `handlers/ai-style-group-profile.ts:420-421` with a check that the resolver yields a key for the selected model. The message names the right setting: `OPENAI_API_KEY`, `STRAITLY_API_KEY` or `OPENROUTER_API_KEY`.
- Gate: there is one test per handler, "blank OpenRouter key + Straitly model + Straitly key → proceeds", and "blank Straitly key → error names STRAITLY_API_KEY".
- Stop-and-ask trigger: a handler that calls a provider other than through `chatCompletion`.

**Step 4. Capability source for Straitly models.** `lead-only`: this is decision D4.
- Change `model-capabilities.ts:59-91` so that a Straitly-routed model missing from the OpenRouter catalog does not throw. It uses the D4 source, or the bounded compatibility plan.
- Keep the throw for OpenRouter-routed models.
- Gate: the tests "Straitly model absent from the OpenRouter catalog → profile with source !== live, no throw" and "OpenRouter-routed absent model → still throws".

**Step 5. Errors and logs name the real provider.** `lead-only`: the matcher text is load-bearing.
- Give `OpenRouterError` a `provider` field and build its message as `${label} ${status}: …`.
- Add `via: label` to the logs at `:685` and the unsupported-parameter log.
- Widen `isModelOutageError` (`handlers/ai-tagging.ts:152-154`) to `^(OpenRouter|Straitly|OpenAI) (408|425|429|5\d\d):`, and add the Straitly and OpenAI equivalents of the catalog message only if step 4 introduces any.
- Grep `apps/worker/src` for every other `/OpenRouter \d/` or `"OpenRouter "` matcher (for example `isTerminalOpenRouterError` at `openrouter.ts:354`, and `ai-tagging-scope.test.ts:279-281`) and update them together.
- Gate: the tests "Straitly 503 → message starts 'Straitly 503:' and isModelOutageError true" and "historical 'OpenRouter 503:' text still true".

### Phase B: OpenAI direct (steps 6–7). These can run in parallel with Phase A.

**Step 6. Allowlist for the parameter drop, and bounded retries.** `lead-only`: this is safety logic.
- In `openrouter.ts:734-738`, have `unsupportedOpenAiParam` return a name only if it is in `DROPPABLE_OPENAI_PARAMS = ["temperature", "top_p", "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs", "seed", "stop"]`. Anything else (`tools`, `tool_choice`, `response_format`, `max_completion_tokens`) is thrown as the error.
- Replace both `attempt--` lines (`:700`, `:714`) with a separate counter, `compatRetries`, capped at `toolChoiceFallbacks.length + DROPPABLE_OPENAI_PARAMS.length`, and drop each parameter at most once.
- Gate: the tests "400 unsupported 'response_format' → throws, no retry", "400 unsupported 'temperature' → one retry without temperature", and "a server that rejects every allowlisted param → terminates after a bounded number of calls".

**Step 7. Agent PDF OpenAI path: catalog check and tests (#1316 finding 3, #1318).** `helper-ok`: the files and tests are named exactly.
- In `packages/agent-common/src/pdf-ai-vision.ts:126-151`, before the fetch, when `aiConfig.models` holds an entry for the selected ID, require `capabilities.includes("vision")`, or throw `PDF AI model <id> does not support vision`. When there is no catalog entry, proceed (OpenAI IDs are not always in the legacy catalog), but reject an ID that is empty after stripping.
- Add `packages/agent-common/src/pdf-ai-vision.test.ts` with these cases, using a mocked global `fetch`:
  - direct route with key → `api.openai.com`, model with `openai/` and `:variant` stripped;
  - `openAiRoute: "openrouter"` → `openrouter.ai`;
  - no key, direct → throws, with no fetch;
  - refusal → throws;
  - malformed body → throws;
  - non-vision catalog entry → throws.
- Rename the bridge test at `apps/bridge-agent/src/pdf-text-sampler.test.ts:60-79` to describe what it actually tests, or switch it to a non-OpenAI model. Add the same three route cases to the Windows sampler tests.
- In `apps/windows-agent/src/pdf-text-sampler.ts:52-63`, put the ScaleDown doc comment back directly above `scaleDownApiKey`, and keep the OpenAI comment above the OpenAI fields.
- Gate: `npm test` in `packages/agent-common`, `apps/bridge-agent` and `apps/windows-agent` is green, including the new cases.
- Stop-and-ask trigger: the agents' `models` catalog lacks a `capabilities` field.

### Phase C: switches and DeepSeek (steps 8–9)

**Step 8. `STRAITLY_ROUTING` (#1366).** `helper-ok`.
- Add `setStraitlyRoutingForTests(value: string | null)` to `provider-api-key.ts`, so the flag can be tested apart from the key override.
- Add these tests:
  - a missing row → enabled;
  - `"off"`, `"OFF"` and `" off "` → disabled;
  - `"false"`, `"0"` and `"disabled"` → still enabled;
  - off + blank Straitly key → `chatCompletion` posts to `openrouter.ai` with the OpenRouter bearer and an `:exacto` model.
- Reword the comment at `openrouter.ts:26-34` and the test title at `openai-route.test.ts:74` to say "no silent fallback; `STRAITLY_ROUTING=off` is the explicit owner switch back to OpenRouter".
- Document the exact-`off` semantics in `docs/configuration.md`.
- Gate: the worker `npm test` is green, including the new cases.
- Stop-and-ask trigger: the Settings UI writes a value other than `on` or `off` (check `src/components/settings/`).

**Step 9. Rich-PDF endpoint, key and model pairing (#1243).** `lead-only`: it is production cost and correctness.
- In `apps/worker/src/handlers/rich-pdf.ts`, derive the route from `config.deepSeekBaseUrl`'s **host**: the host equals `openrouter.ai`, or anything else is DeepSeek direct.
- For OpenRouter:
  - use `config.openRouterApiKey`, or the admin_config OpenRouter key through the existing `openrouter-key.ts` resolver;
  - send `deepseek/<id>` when the configured ID has no `/`, and send it unchanged when it is already namespaced;
  - make the key gate message name `OPENROUTER_API_KEY`.
- For DeepSeek direct, reject a namespaced ID (`deepseek/…`) with a clear error.
- Validate the pair once, at the start of the op, before any file is touched, so a bad pair fails the operation. It must not write `parse_error` rows that park files for 24 hours.
- Update the comment at `config.ts:52-60`.
- Gate: the tests in `apps/worker/src/deepseek.test.ts` or `handlers/rich-pdf.test.ts` all pass:
  - OpenRouter URL + bare id → payload model `deepseek/deepseek-chat` with the OpenRouter key;
  - OpenRouter URL + no OpenRouter key → the op fails up front and writes zero rows;
  - DeepSeek URL + `deepseek/x` → it fails up front.
- Stop-and-ask trigger: the live Railway `DEEPSEEK_BASE_URL` is unset. Then there is nothing to switch now; still land the validation.

**Step 10. Docs.** `helper-ok`.
- `docs/MODEL_RULES.md`: the routing table per family, the capability source (D4), and the rich-PDF route options.
- `docs/idiosyncrasies.md:259-264`: change the rich-PDF quirk to "direct by default; OpenRouter allowed (owner 2026-11-20), loses DeepSeek prefix-cache discount".
- `docs/RICH_PDF_EXTRACTION.md:19,209-214` and `docs/configuration.md` (the `STRAITLY_ROUTING` and `OPENAI_ROUTE` semantics).
- Then run `ai-doc-health --repo . --fix-index`.
- Gate: no doc on `main` still claims rich-PDF is direct-only or that batch repair can use Straitly.
- Stop-and-ask trigger: a doc contradicts a locked decision in §8.

**Step 11. Land and live proof.** `lead-only`.
- Use one or more PRs to `main`. The AI merges once required checks pass.
- The worker auto-deploys. Bridge agent changes need an `apps/bridge-agent/package.json` version bump and a publish. The Windows agent goes out through a GitHub Release.
- Live proof, in Railway logs or the `ai_tag_bakeoff_results.raw_output` rows:
  - (a) one Straitly-routed tagging call succeeds with `via: Straitly`;
  - (b) one OpenRouter batch repair goes to OpenRouter;
  - (c) one OpenAI-direct call succeeds;
  - (d) the worker version deployed on Railway matches the merge SHA.
- Record the evidence on each issue, then close #1322, #1316 and #1243.

## 10. Tests required

These are new; the names are suggestions, but the behaviour is required:
- `resolveChatRoute`: openai/* × {direct+key, direct+no key → throw, openrouter}; anthropic/* → openrouter; other × {Straitly on+key, on+no key → throw, off → openrouter}; `purpose: batch_repair` + other → openrouter.
- `sameModelRepairCompletion`: an OpenRouter batch repair posts to `openrouter.ai`.
- Handler key gates: tagging, short description and profile, each with the cases from step 3.
- `getModelCapabilities`: the Straitly-absent and OpenRouter-absent cases from step 4.
- Error labels and the `isModelOutageError` cases from step 5.
- `unsupportedOpenAiParam` allowlist and the bounded compatibility retries from step 6.
- `pdf-ai-vision.test.ts`: the six cases from step 7, plus the bridge and Windows sampler route cases.
- `STRAITLY_ROUTING` flag parsing and the off-route payload from step 8.
- Rich-PDF pairing: the three cases from step 9.

These existing suites must stay green: `npm test` and `npm run build` in `apps/worker`, `packages/agent-common`, `apps/bridge-agent` and `apps/windows-agent`, plus the root `npm test` (vitest) for anything under `src/`.

## 11. Constraints and gotchas

- Never push to `main`. Use a feature branch and PR, and the AI merges. Reviews are advisory and never block.
- No silent fallback between providers (D1). Every missing key is a loud, provider-named error.
- `isModelOutageError` and other matchers read the error **text**. Change the text and the matchers in the same commit, and keep matching the historical `OpenRouter <status>:` rows.
- Never print or log a key. In tests, use the placeholder keys the existing suites use.
- No schema change is needed. If one appears necessary, it goes through `popcre/shared-db` (load `shared-db-change`), never this repo.
- Bridge agent releases need a version bump; the Windows agent ships through a GitHub Release (see `AGENTS.md` → Deployment).
- A full tagging run may be active (see [issue-680 full tagging run](issue-680-full-ai-tagging-run.md)). Worker deploys restart the worker, but in-flight batches resume from durable receipts. Do not change batch receipt formats.
- Times shown to humans use EST.

## 12. Access and environment

- `gh` is authenticated as `u2giants`.
- Read-only production SQL goes through the Supabase Management API, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token" (field `credential`) injected with `op run`. Never print it. See `docs/MCP_SERVERS.md`.
- Provider keys are in `public.admin_config` (`OPENAI_API_KEY`, `STRAITLY_API_KEY`, `OPENROUTER_API_KEY`) and in 1Password `vibe_coding` → `ai-provider-api-keys`.
- Railway worker env: `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`. Read them with the Railway MCP or CLI; never echo the values.
- Local: run `npm ci` at the root, then `npm test` in each package.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–10 are merged to `main` with every test in §10 passing in CI.
- [ ] The Railway worker runs the merge SHA, and the bridge and Windows agent releases are published.
- [ ] Live proof (a)–(d) from step 11 is recorded on the issues.
- [ ] #1322, #1316 and #1243 are closed with that evidence. The folded #1366 and #1318 are already closed.
- [ ] This plan's STATUS table is updated, and the handoff file is closed.

Risks and rollback:
- A routing regression stops tagging. Roll back with `STRAITLY_ROUTING=off` or `OPENAI_ROUTE=openrouter` (no redeploy needed), or redeploy the previous worker SHA on Railway.
- Matcher changes can stop failover. Step 5's tests guard against that.

Open questions:
- D4, the capability source; the criteria are in §8.
- Should the agents' non-OpenAI PDF calls also go through Straitly? This is out of scope. If wanted, it is a business-meaning question for Albert, and a new issue.

## Self-audit

1. *Could a brand-new session execute this without asking?* Yes. §2 and §5 give the application and the exact code locations. §9 gives the files, behaviour and a gate for every step. §12 gives the access. The gap I found in an earlier draft was that the load-bearing error text was not called out; §5, §6 and step 5 now cover it.
2. *Does it carry all background, including what was ruled out?* Yes. §3 covers the source PRs and the closed fixer PRs, §6 every verified finding, and §7 the rejected approaches. §8 separates the owner decisions from the open ones.
3. *Is the goal clear enough for judgment calls?* Yes. §1 states the outcome in business terms (the right provider, key and model name, with loud and accurate failures) and says the goal wins over a step.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1322-ai-provider-routing-hardening.md in u2giants/popdam3. Read AGENTS.md, then this plan top to bottom (STATUS first). Do steps 1, 2, 4, 5, 6, 9 and 11 yourself. Hand steps 3, 7, 8 and 10 to your helper, in that order, after step 1 has merged locally. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring a stop-and-ask trigger back to you. If stuck for 30 minutes, the step is taken back. Yourself: re-run every gate, run the full test suites listed in §10, open the PR, merge when required checks pass, verify the Railway deploy SHA, collect the step 11 live proof, update STATUS, and close the issues with evidence.
```
