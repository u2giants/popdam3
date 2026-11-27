# Handoff — PopDAM whole-library AI tagging run: monitor to completion

## 1. Goal
Keep the PopDAM untagged-files tagging run going at full speed until no taggable untagged files remain, with model `z-ai/glm-5.3-flash` (owner-mandated; never switch models).

## 2. Current state (verified 6:40 PM EST 2026-11-26)
- Worker heartbeat sha `bd2c5b681ffbbfdcd55b6c2444d79c915e0b7725`.
- `admin_config.BULK_OPERATIONS` → `ai-tag-parallel`: status `running`, run_id `untagged-20261125`, fresh pass started 6:31 PM EST; 224 files tagged in the 5 minutes before 6:40 PM EST.
- `admin_config.AI_TAG_PARALLEL_RUN` = `{models:["z-ai/glm-5.3-flash"], run_id:"untagged-20261125", discover:true, untagged_only:true, concurrency:48}`.
- Routing: `STRAITLY_ROUTING = "share:48"`, `OPENROUTER_ROUTING = "cheapest"`, GLM OpenRouter allowlist wafer/us, pareto-inference/nvfp4, wafer/nvfp4, deepinfra/fp4.
- ~31,600 untagged assets with thumbnails at 6:25 PM EST (candidate RPC `get_ai_tag_candidates` also excludes deleted, tiers 5/9 and style groups already tagged, so the reachable number is lower).
- Previous pass (6:31 AM–4:58 PM EST 2026-11-26): 18,604 tagged, 1,898 failed (~10%).

## 3. What shipped this session
- #1397 retry same method with serving host ignored; 60 s ladder budget.
- #1405 docs (quirk #83, incident 2026-11-25).
- #1407 (7fce17f) reroute away from Straitly goes to OpenRouter.
- #1411 (98e5573) parallel cap 48.
- #1415 (9445a68) + #1420 (83312e5) same-error kill switch only fires on a real burst, measured across the failure's whole batch.
- #1440 (bd2c5b6) untagged whole-library run starts its next pass itself while anything was tagged in the last hour.
- Lessons written to https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md (quirk #83 follow-ups).

## 4. How to check
Read-only via the 1Password op_run tool (git-bash), env `PGPASSWORD=op://vibe_coding/246sf23gymd64yudpmhswcnyle/password`, `PGOPTIONS='-c default_transaction_read_only=on'`, `psql -h aws-1-us-east-1.pooler.supabase.com -p 5432 -U postgres.qsllyeztdwjgirsysgai -d postgres`:
- `select value->'ai-tag-parallel'->>'status', value->'ai-tag-parallel'->'progress'->>'tagged', value->'ai-tag-parallel'->'progress'->>'failed', value->'ai-tag-parallel'->>'error' from admin_config where key='BULK_OPERATIONS';`
- `select count(*) from assets where ai_tagged_at > now()-interval '5 minutes';` (healthy: 100–225)
- `select value->>'sha' from admin_config where key='WORKER_HEARTBEAT';`
op_run times out at ~2 min: never sleep inside it; use a background Bash sleep.

## 5. How to restart if stopped
`update admin_config set value = jsonb_set(value,'{ai-tag-parallel}', (value->'ai-tag-parallel') || jsonb_build_object('status','running','run_id','untagged-20261125','started_at',<now utc iso>,'updated_at',<now>,'error',null,'interruption_reason_code',null)) where key='BULK_OPERATIONS';` Add `'cursor',null,'last_successful_cursor',null,'progress','{}'::jsonb,'auto_resume_attempts',0` for a fresh pass. run_id MUST match AI_TAG_PARALLEL_RUN or parallel settings are ignored (that mistake made a run go stale on 2026-11-26).

## 6. Expected behaviour
- Nightly `rebuild-style-groups` at 1 AM EST pauses tagging; it auto-resumes (~1:27 AM EST observed).
- Run ends `completed` when a pass finds nothing and no asset was tagged in the last hour — then remaining untagged are persistent failures.
- Failure rate ~4–10%, mostly GLM missing `tag` in `asset_tags` (quirk #83); failed files are retried on the next pass.

## 7. Tried and failed / don't repeat
- Prompt/schema rewording for `tag` made failures worse. Relace host unusable (no image routing). Claim "Straitly is off" was wrong. Wrong run_id on restart → stale.

## 8. Open items
- Run to completion; then report how many stayed untagged and the top error.
- If the failure rate climbs above ~15% or a new error dominates, read `failure_samples` and investigate.
- PopSG tagging is a separate session (prompt given to Albert 2026-11-26).
- Worker suite has 3 known Windows-only failures (Meta IPv6 ×2, heartbeat timer).

## 9. Done when
Status `completed`, untagged-with-thumbnail count stable, final numbers reported to Albert in EST.
