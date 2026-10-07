# Plan v2: replace PopDAM GOOGLE_AI_API_KEY (issue u2giants/popdam3#213)

Facts verified 2026-10-07 (fingerprints/HTTP status only):
- admin_config.GOOGLE_AI_API_KEY (live project qsllyeztdwjgirsysgai): sha256 of the unwrapped
  string (value#>>'{}') == July-exposed 1Password snapshot. Google returns API_KEY_INVALID.
  keys:lookupKey returns only parent projects/113459745054 (= clever-treat-490312-i8) and no key name.
- Railway worker env GOOGLE_AI_API_KEY (project 8645c5fe..., service f777713f..., env production
  70aef28e...) holds a DIFFERENT value, also API_KEY_INVALID (parent project 904692193547).
- AI_TASK_MODELS.vision_tagging = meta-direct/muse-spark-1.3-contributor, so the worker Gemini
  batch route is not active; the agent pdf-text-sampler Google path is the legacy path used only
  when no OpenRouter key is set.
- 1Password item id for "ai provider api keys openai deepseek chatgpt qwen" is resolved by id
  (op item get by exact title, verify field gemini_popdam_shared_supabase exists) before editing.
Consumers: agent-api heartbeat -> windows-render-agent + synology-bridge-1; Railway worker
(google-ai-key.ts: DB first, env fallback, 60 s cache). admin-api only validates on save.

Steps (no value ever printed; values only in 0600 files / env / stdin; no argv):
1. Enable apikeys.googleapis.com on clever-treat-490312-i8 (read/manage keys).
2. List keys in 113459745054 and 904692193547 (where permitted), incl. showDeleted. Re-run
   lookupKey for both exposed values; for any that resolves to a key NAME, delete that key.
   If neither resolves, record "key object already deleted" as proof.
3. Usage check: Cloud Monitoring serviceruntime request_count for generativelanguage in
   clever-treat-490312-i8 from 2026-07-01 to now, by credential if available; report anomalies.
   (read-only; if monitoring is unavailable, record that verbatim)
4. Create key: gcloud services api-keys create --project clever-treat-490312-i8
   --display-name popdam-admin-config-2026-10-07 --api-target service=generativelanguage.googleapis.com
   --format=json > 0600 file; extract keyString to 0600 file; delete JSON.
5. Probe generateContent with pinned model gemini-2.5-flash, header x-goog-api-key -> expect 200.
6. Save rollback: copy current admin_config value and Railway value into 0600 files (both dead,
   but restorable exactly). Rollback = restore those values and delete the new key.
7. DB write: one transaction, UPDATE public.admin_config SET value=to_jsonb(<key from \getenv>),
   updated_at=now() WHERE key='GOOGLE_AI_API_KEY'; assert exactly 1 row before COMMIT.
8. Railway: variableUpsert GOOGLE_AI_API_KEY for the worker service with the new key (GraphQL,
   body from file), so the fallback is also valid; let it redeploy; confirm deployment SUCCESS.
9. 1Password: op item edit <id> --template (0600 JSON) setting gemini_popdam_shared_supabase.
10. Proof: sha256(value#>>'{}') == sha256(1Password field) == sha256(Railway var) == sha256(new key);
    Gemini 200; wait >= 2 heartbeats of both agents (and > 60 s worker cache TTL); submit 1-asset
    targeted PDF_TEXT_SAMPLE_REQUEST, confirm completed with no error; worker logs clean of
    google-ai-key errors after redeploy.
11. Shred temp files. Post evidence on #213.
