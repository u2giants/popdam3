# Plan: replace PopDAM GOOGLE_AI_API_KEY (issue #213)

Facts (2026-10-07): admin_config.GOOGLE_AI_API_KEY on live project qsllyeztdwjgirsysgai
has the same sha256 as the July-exposed pre-rotation snapshot and Google returns
API_KEY_INVALID for it (already revoked). The key lives in GCP project
clever-treat-490312-i8 (number 113459745054). generativelanguage API is enabled there;
apikeys API is not.

Consumers (read admin_config, no env change needed): agent-api heartbeat ->
windows-render-agent + synology-bridge-1 (pdf-text-sampler legacy Google path);
Railway worker google-ai-key.ts (DB value first, env fallback); admin-api AI handlers.

Steps (no value ever printed; values move only via 0600 files / env / stdin):
1. gcloud services enable apikeys.googleapis.com --project clever-treat-490312-i8.
2. gcloud services api-keys create --project clever-treat-490312-i8
   --display-name popdam-admin-config-2026-10-07
   --api-target service=generativelanguage.googleapis.com, output JSON to 0600 file;
   extract keyString to 0600 file; delete JSON.
3. Probe: generateContent (gemini flash model) with x-goog-api-key from the file -> expect 200.
4. Backup: current admin_config row hash recorded (old value is dead; no rollback value needed).
   UPDATE public.admin_config SET value=to_jsonb(:key), updated_at=now() WHERE key='GOOGLE_AI_API_KEY'
   in one transaction asserting exactly 1 row, key read via psql \getenv from env.
5. 1Password item "ai provider api keys openai deepseek chatgpt qwen" field
   gemini_popdam_shared_supabase updated via op item edit --template (0600 file), verify by sha256 match.
6. Proof: sha256(admin_config) == sha256(1Password) == sha256(created key); Gemini 200;
   wait for both agents' next heartbeat (agent-api returns google_ai_api_key from admin_config);
   submit a 1-asset targeted PDF_TEXT_SAMPLE_REQUEST and confirm the agent completes it with no
   error; check worker logs show no google-ai-key errors.
7. Shred temp files. Old key: already invalid; nothing to revoke. Do not delete other keys in project.
Rollback: delete the new key (gcloud services api-keys delete) and restore prior row value if any consumer breaks.
