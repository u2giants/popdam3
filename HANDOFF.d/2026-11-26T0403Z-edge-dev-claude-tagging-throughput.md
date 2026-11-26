# Handoff — AI tagging throughput (find and fix the bottleneck)

## 1. Goal
Tag the ~51k untagged files much faster. The model stays GLM 5.3 Flash (owner ruling: "we are not changing models"). Done when the sustained rate is far above today's ~14 files a minute and the run is still healthy.

## 2. Current state (verified 2026-11-25 10:55 PM EST)
- Bulk job is `BULK_OPERATIONS` key `ai-tag-parallel`, run_id `untagged-20261125`, and its status is running.
- 72 files were tagged in 5 minutes, about 14 a minute. 50,971 are still untagged.
- Worker heartbeat sha is c75951032e, so PR #1397 (the GLM missing-tag-name fix) is deployed.
- `AI_TAG_PARALLEL_RUN` is `{models:[z-ai/glm-5.3-flash], concurrency:32, discover:true, untagged_only:true}`. 32 is the code's maximum (allowed range is 2–32).
- `STRAITLY_ROUTING="share:48"`: up to 48 calls in flight go to Straitly, and the rest go to OpenRouter (PR #1400). `OPENROUTER_ROUTING="cheapest"`.

## 3. Done this session
- PR #1395 added a sliding worker pool (`settledPool`) and discovery pages of concurrency×4, in [ai-tagging.ts](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/ai-tagging.ts).
- PR #1400 added the Straitly share cap, in [provider-api-key.ts](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/lib/provider-api-key.ts) and openrouter.ts.
- PR #1397 is the missing-tag fix; it came from session "Fix GLM missing tag name".
- Straitly capacity test, Growth plan, short prompts:
  - 50 in flight gives about 1,500 a minute with no refusals.
  - 100 in flight brings 429s, even though they advertise 200 in flight.

## 4. Tried and failed
- I set concurrency to 80. The job refused it ("must be between two and thirty-two") and stopped at 10:49 PM EST; it is reset to 32.
- An earlier stop ran from 5:35 to 10:50 PM EST: the job auto-stopped after 20 identical "asset_tags must contain…" failures. #1397 fixes this.

## 5. Suspected bottleneck (unproven)
At 32 in flight, 14 a minute means each file takes about 2+ minutes end to end. The provider is far from its limit. Places to check:
- The per-file pipeline before the AI call: fetching or rendering the image or thumbnail, likely the slowest step.
- The time spent in `candidate_fetch` (the stage named in `last_stage`).
- Database writes.
- Whether only one worker replica processes the job.
- Whether there is a hidden sequential step per discovery page.

## 6. Next action
1. Add or read timing for each stage per file from the Railway worker logs: `timeout 40 railway logs --lines 500` in apps/worker.
2. Find where the 2 minutes go.
3. Fix it permanently through a branch and a PR. Raise the 32 cap only if the work is truly bound by calls in flight.

## 7. Verify
Count `assets.ai_tagged_at` over the last 15 minutes. The job must stay running with an empty `error` field, and there must be no Straitly 429 floods in the logs.

## 8. Access
- Database: 1Password `vibe_coding` item 246sf23gymd64yudpmhswcnyle, pooler aws-1-us-east-1:5432, user postgres.qsllyeztdwjgirsysgai.
- Straitly key: item pwgjqcigt4mzv7lzmom2ocvrki.
- Restart a stopped job with `update_bulk_operation(key, state, only_if_status, expected_revision)`.

## 9. Risks
- Concurrency above 32 kills the job.
- The job auto-stops after 20 identical failures, so always check its status after a change.
