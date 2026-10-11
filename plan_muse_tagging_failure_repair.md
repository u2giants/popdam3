# Muse tagging failure: exact production diagnostic action

STATUS: DIAGNOSIS VERIFIED, REPAIR OPEN (October 11, 4:29 PM EDT). Five protected synthetic diagnostics passed from the operator host at 4:03 PM EDT (four Contributor, one Standard control). Actual native worker canary failed at 4:23 PM EDT with seven 404 model_not_found responses and no AI writes. Current runtime process key matches vault, URL correct, Node v20.20.2. Worker GET /v1/models returns HTTP 200 with ZERO models; same-key local Node/Python return EIGHT models. Header variations, IPv4 versus IPv6 and same Meta edge-address comparisons did not change that origin-specific result. Worker public connection is reported as Railway, Virginia, US; no proxy variables present. This is not proved to be billing, quota, capacity or request-shape failure. No key/model/timeout changed. Next: plan_muse_worker_connection_repair.md. Previous exact-asset diagnostic plans and receipts remain in protected session scratch; they are not public source artifacts.

Owner authorization from this chat verbatim: "do deeper research. fix the problem"; earlier: "tag the untagged PopDAM assets using Muse Spark 1.3 contributor". Existing issue: https://github.com/u2giants/popdam3/issues/96. This plan authorizes diagnosis only; production tagging stays Muse Spark 1.3 Contributor.

## Exact target and known evidence

PopDAM Railway project 8645c5fe-ae60-413e-8464-508456c65365 / production environment 70aef28e-b9f8-4aa6-b902-c9a06aec08d5 / service f777713f-d0f8-4f9b-9685-37c9090c98ef; database qsllyeztdwjgirsysgai. Existing protected Meta key, no key rotation, account/terms change, schema, licensed input, deployment or row write.

The October 11 canary operation RUN_ID d022a0f3-e688-4df9-8cdd-f7d62ba263b1 exhausted the worker's existing initial attempt plus six-entry retry ladder, all model_not_found, and persisted no tags. The worker's retry/cap mitigation operated as designed. This tests whether the documented September23 upstream condition is still active; it does not presume a new worker bug.

Engage previous evidence explicitly: docs/idiosyncrasies.md Muse404 entry, meta-model-api.ts, and https://github.com/popcre/ai-devops/issues/683 record same-key Contributor failures with Standard successes, both protocols sometimes returning404, occasional byte-identical Responses success, and parallel12->3 success. The issue's September23 follow-up records eight sequential404s while PopDAM idle and revises the concurrency-only explanation to a usage-cap hypothesis. That is a lead, not proof of today's cause. A September30 handoff mentions an open Meta support ticket; ticket status has not been live verified, and sending support messages is excluded.

Current primary documentation contradicts the dated code comment claiming Contributor only supports Responses: https://dev.meta.ai/docs/models and https://dev.meta.ai/docs/protocols state all MuseSpark models support Responses, ChatCompletions and Messages. https://dev.meta.ai/docs/protocols/messages says the formats share routing/auth/billing; https://dev.meta.ai/docs/error-handling distinguishes402 billing,404 model missing,429 limits,503 overload. https://dev.meta.ai/docs/pricing-rate-limits documents Contributor100RPM/3MTPM per team, with no five-hour cap documented. The single Chat probe re-verifies the dated protocol evidence against today's documentation; it is not predestined to404 solely from the old comment.

Read-only checks in this chat: models list and exact model GET both200/list Contributor; captured Railway variables confirm key equal to protected vault key and URL correct; latest successful deployed SHA cbb1de825c65ef31362bf8d0bbd023a18ec3c682. Before inference, REPEAT runtime key equality, URL and deployment success/SHA verification, print only booleans/IDs/SHA, and stop if mismatch. No raw vars/headers/logs may be returned.

## Completed five-request diagnostic specification (historical; do not repeat)

At most FIVE requests, existing key via protected op_run, api.meta.ai, each deadline60 seconds, NO retries, no simultaneous requests, max20,384 outputtokens (production4000+16384). Synthetic prompts only. Abort remaining on401/402/403, safety/refusal, billing/payment/region errors. No application writes, restarts, variables or shipment.

1. POST /v1/responses model muse-spark-1.3-contributor, input string "Reply OK", max_output_tokens20384, no sampling/schema.
2. Identical Responses body except model muse-spark-1.3: exactly ONE diagnostic control to distinguish account-wide failure. This is NOT a production model substitution and must never tag an asset or change configured models.
3. POST Responses Contributor, system/user message array requesting an object with boolean ok=true, max_output_tokens20384, no sampling/schema. This isolates the array from minimal input, while success differences can still reflect intermittent routing.
4. POST /v1/chat/completions Contributor, one user message "Reply OK", max_tokens20384, no sampling/schema. One format comparison under current official docs, no route/model change on its own.
5. POST Responses Contributor, system plus user input_text requesting boolean ok=true and a tiny synthetic PNG input_image; text.format json_schema(name probe, strict=false, schema object boolean ok required/additionalProperties=false), max_output_tokens20384, no sampling. This exercises image/schema path without licensed data.

## Pre-registered interpretation and next gate

- Contributor404 on all calls + Standard200: key/account can perform inference; Contributor-specific upstream availability/access remains failing. Does NOT by itself prove capacity, balance, five-hour cap or support-ticket status. Preserve provider failure, investigate account/ticket read-only before claiming resolution.
- All models404: cannot distinguish account/team or shared service failure; stop, no tagging and no invented cause.
- Auth/billing/security response: abort all remaining; diagnose canonical credential/account path under a separately reviewed action, no key rotation.
- Minimal Contributor200 but array/image404: intermittent upstream vs shape remain ambiguous; no patch based solely on one differential. Obtain a separately reviewed bounded repeat of byte-identical comparisons before routing changes.
- Chat200 and Responses404: candidate protocol difference, still may be intermittent; requires separately reviewed identical comparisons and supported repair preserving schemas/tools before production change.
- Contributor calls200 with schema/image usable: connectivity exists today but not yet production repair; separately reviewed real-worker canary must persist tags, description and exact requested model before bulk resume.
- HTTP200 incomplete/empty/invalid output: report separately from transport; do not call it success, do not increase timeout or weaken validation. Token use may explain truncation of a tiny synthetic answer only if reported output evidence supports it.

Output allowlist: status, duration, response model/status, usage totals, completion-valid boolean, sanitized error code/message and x-ratelimit headers only. Never key, raw traffic, full headers, licensed data or account details. Private scratch records only. No further calls after five without new explicit action approval.

## Historical diagnostic reviewer decision (already completed; no new inference requested)

Review and explicitly authorize the exact FIVE PRODUCTION INFERENCE ACTIONS above, not document shipment. APPROVE must cover the finite same-account control test and four Contributor synthetic requests under the stated bounds. Source-only/inert-document approval is insufficient. Separately gated real asset canary, concrete code repair, production shipment, and remaining12176-file tagging are excluded from THIS action approval. Preview recovery for493 active missing-tag files measured without thumbnails in this chat remains unfinished; unrelated group cohorts are excluded.
