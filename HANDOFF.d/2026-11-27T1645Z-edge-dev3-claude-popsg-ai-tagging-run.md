---
summary: Monitor the PopSG AI image-tagging run (ai-tag-popsg) to completion.
kind: handoff
status: open
read-when: Continuing PopSG AI tagging or checking its run.
---
# Handoff — PopSG AI image tagging run: monitor to completion

## 1. Goal
Tag all PopSG style-guide files with previews (221,034 active) with model `z-ai/glm-5.3-flash` (owner-mandated; never switch), via the PopDAM tagger path.

## 2. Current state (verified 11:42 AM EST 2026-11-27)
- `BULK_OPERATIONS.ai-tag-popsg` status `running`, run_id `popsg-untagged-20261126`, started 7:40 PM EST 2026-11-26.
- `style_guide_tagging_state` pipeline `vision`: 53,801 completed, 1,495 failed (~2.7%); 148 done in the last 5 minutes (~30/min).
- Worker heartbeat sha `719e1596fbd6bb5d692f12c90368d88e882d30d8` (includes #1450).
- PopDAM `ai-tag-parallel` status `completed` (not touched by this session).
- At ~30/min, ~167k left takes ~4 days.

## 3. What shipped
- https://github.com/u2giants/popdam3/pull/1450 (6d84e68): `ai-tag-popsg` operation — https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/popsg-ai-tag.ts. Conflicts with `ai-tag-parallel` (waits for PopDAM runs).
- https://github.com/u2giants/popdam3/pull/1451 (d4d5641): how-to in https://github.com/u2giants/popdam3/blob/main/docs/POPSG.md (section "AI image tagging").
- Data (not schema): `admin_config.AI_TAG_POPSG_RUN` = `{models:["z-ai/glm-5.3-flash"], run_id:"popsg-untagged-20261126", discover:true, untagged_only:true, concurrency:48}`. No shared-db structural change was needed (source `vision_ai` and pipeline `vision` already existed).

## 4. How to check (read-only, 1Password op_run tool)
Env `PGPASSWORD=op://vibe_coding/246sf23gymd64yudpmhswcnyle/password`, `PGOPTIONS='-c default_transaction_read_only=on'`; `psql -h aws-1-us-east-1.pooler.supabase.com -p 5432 -U postgres.qsllyeztdwjgirsysgai -d postgres`:
- `select status, count(*) from style_guide_tagging_state where pipeline='vision' group by 1;`
- `select count(*) from style_guide_tagging_state where pipeline='vision' and completed_at > now()-interval '5 minutes';` (healthy: 100–300)
- `select value->'ai-tag-popsg'->>'status', value->'ai-tag-popsg'->>'error' from admin_config where key='BULK_OPERATIONS';`

## 5. How to restart if stopped
`update admin_config set value = jsonb_set(value,'{ai-tag-popsg}', (value->'ai-tag-popsg') || jsonb_build_object('status','queued','run_id','popsg-untagged-20261126','started_at',<now utc iso>,'updated_at',<now>,'error',null,'interruption_reason_code',null)) where key='BULK_OPERATIONS';` Add `'cursor',null,'last_successful_cursor',null,'progress','{}'::jsonb,'auto_resume_attempts',0` for a fresh pass. run_id must match `AI_TAG_POPSG_RUN`.

## 6. Expected behaviour
- Pages files by id; skips `completed`; failed files retried next pass; a pass that ends while something was tagged in the last hour restarts itself; otherwise status `completed`.
- Queues behind any running PopDAM `ai-tag-parallel` run; the nightly style-group rebuild does not conflict with it.
- Failures are mostly GLM missing `tag` (quirk #83, https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md).

## 7. Tried and failed / don't repeat
- Queueing before the worker ran #1450 failed with "Unknown operation" — always check the heartbeat sha first.
- Failure text still says "4-18 items" in some samples: those came from the older live validator text; harmless.

## 8. Open items
- Run to completion; then report final tagged/failed counts and top error to Albert in EST.
- If failure rate climbs above ~15% or speed drops below ~50 per 5 minutes for 30 minutes, read `error_detail` and investigate.

## 9. Done when
`ai-tag-popsg` status `completed`, vision completed count stable, final numbers reported in EST.
