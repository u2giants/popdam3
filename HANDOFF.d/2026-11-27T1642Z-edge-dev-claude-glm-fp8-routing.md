# Handoff — GLM 5.3 Flash routed to cheapest fp8 OpenRouter hosts (unverified live)

> **Superseded 2026-11-27 3:05 PM EST.** Albert lifted the fp8-only rule: "take out any fp8 requirement from anywhere i may have put it". Quality probe (https://github.com/u2giants/popdam3/pull/1486#issuecomment-7226969319) found fp4 tags no worse. Live allowlist is now `{"z-ai/glm-5.3-flash": ["morph/fp8","wafer/us","wafer/nvfp4","deepinfra/fp4"]}`. Do not restore an fp8-only list.

## 1. Goal
Albert (2026-11-27 11:36 AM EST): "change it to choose the cheapest fp8 models from openrouter." Vision tagging model `z-ai/glm-5.3-flash`, OpenRouter overflow traffic only.

## 2. Done
- PR https://github.com/u2giants/popdam3/pull/1479 merged: desktop sessions now start the supabase, devops-mcp and synology-monitor MCP servers (1Password managed launcher; supabase wrapper loads the op service account). Verified in a fresh headless session on main 71fa811f7.
- Live `admin_config.OPENROUTER_PROVIDER_ALLOWLIST` changed (data, not schema) from `["wafer/us","pareto-inference/nvfp4","wafer/nvfp4","deepinfra/fp4"]` to `["tenstorrent/fp8","near-ai/fp8","siliconflow/fp8","morph/fp8"]` — the four cheapest fp8 endpoints on https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints at 16:37 UTC. Worker cache TTL 60 s (https://github.com/u2giants/popdam3/blob/main/apps/worker/src/provider-api-key.ts#L7).

## 3. Not done / open
- No live proof that calls land on fp8 hosts: the Railway worker (project popdam, service popdam3) logs no per-call provider; `ai-tag: received structured tags` with providerInfo did not appear in deploy logs.
- The four fp8 hosts were not quality-tested (old list was "tested providers").
- Straitly (`STRAITLY_ROUTING="share:48"`) still takes up to 48 in-flight calls; allowlist affects only overflow.
- Side issue: NAS disk-space check (synology-monitor) returns empty volume data; unowned.

## 4. Next action
Prove routing: query OpenRouter generation records (https://github.com/u2giants/popdam3/blob/main/apps/worker/src/openrouter.ts#L23) for recent glm-5.3-flash calls, or run one test call with `provider.only` = the list, and confirm `provider_name` is fp8. Rollback = restore the old list above.

## 5. Verify
Recent GLM OpenRouter generations show only tenstorrent/near-ai/siliconflow/morph; tagging error rate not worse than before 16:38 UTC.

## 6. Tried / failed
Supabase log tables hold no GLM call rows; Railway log filters "provider"/"fp8" returned nothing.

## 7. Risks
fp8 hosts cost slightly more and are untested; "invalid structured tag sample" warnings were already frequent before the change.

## 8. Ownership
No claims or locks held. No shared-db structure touched.

## 9. Pointers
https://github.com/u2giants/popdam3/blob/main/AGENTS.md
