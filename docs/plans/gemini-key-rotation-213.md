# Plan v5: replace PopDAM GOOGLE_AI_API_KEY (issue u2giants/popdam3#213)

Facts verified 2026-10-07 (fingerprints/HTTP status only; re-read live at execution):
- admin_config.GOOGLE_AI_API_KEY (live project qsllyeztdwjgirsysgai): sha256(value#>>'{}') equals
  the July-exposed snapshot (sha256 prefix 3c9707b37660). Google already rejects it: generativelanguage 400 API_KEY_INVALID.
  So the exposed key is NOT valid today; nothing it can serve. lookupKey raw response:
  {"parent":"projects/113459745054/locations/global"} (= clever-treat-490312-i8).
- Live PDF_EXTRACTION_CONFIG.ai_vision_model_id = qwen/qwen3-vl-32b-instruct (OpenRouter), and
  agents prefer OpenRouter. The agents' Google branch is therefore NOT reachable in the current
  config; this plan restores a valid Google key so that branch (and any direct-Gemini model choice)
  works again. It does not claim a live agent Google call.
- Railway worker env fallback GOOGLE_AI_API_KEY: different value, also API_KEY_INVALID, never in
  admin_config. Accepted residual recorded on #213 as a dead fallback (worker reads DB first);
  not changed here to avoid a production worker redeploy.

Scope: one restricted key in clever-treat-490312-i8; one admin_config row; one field of 1Password
item "ai provider api keys openai deepseek chatgpt qwen" (resolved to its id; this is the item the
repo docs call ai-provider-api-keys), field gemini_popdam_shared_supabase.

Gates: ai-task-gates start --class production (already declared), then check --before production
with this review's APPROVE before step 1, and check --before database before step 6. Prove target DB
(pooler user postgres.qsllyeztdwjgirsysgai; SELECT the GOOGLE_AI_API_KEY row hash = expected) first.

Steps (umask 077 throughout; secrets only in env, 0600 files, stdin, curl -K config files; never
argv, never printed):
1. Enable apikeys.googleapis.com on clever-treat-490312-i8.
2. Decisive key match: list ALL keys incl. deleted in clever-treat-490312-i8 (REST keys.list
   showDeleted=true); for each key, REST getKeyString -> 0600 file -> sha256 compare to 3c9707b37660
   (never printed). Match found: record its uid, restrictions (apiTargets) and state; if not deleted,
   delete it. No match among live+deleted keys: record "no key object in the project holds the
   exposed value" plus the API_KEY_INVALID result as evidence. lookupKey (if repeated) is the REST
   call with the key in a curl -K config, never gcloud argv. 403/429/other -> record verbatim, item stays open.
3. Usage (read-only): Cloud Monitoring serviceruntime.googleapis.com/api/request_count for ALL
   services in clever-treat-490312-i8, 2026-07-01..now, grouped by service and credential_id
   (covers an unrestricted key). Unexplained traffic -> record on #213 with an owner line and continue
   (key is already dead). Gap: project 904692193547 not checked.
4. gcloud services api-keys create --project clever-treat-490312-i8 --display-name
   popdam-admin-config-<UTC timestamp> --api-target service=generativelanguage.googleapis.com
   --format=json > 0600 file; extract keyString to 0600 file; shred JSON.
5. Probe in the agents' exact shape: POST .../v1beta/models/gemini-2.5-flash:generateContent?key=<key>
   (model = the google apiModel from the live AI model catalog if one exists, else
   gemini-2.5-flash) with inlineData PNG of page 1 of a real style-guide PDF plus the agents' PDF_EXTRACTION_PROMPT;
   URL and body come from a 0600 curl -K config file (not argv). Expect 200 and non-empty text.
6. Single transaction: UPDATE public.admin_config SET value=to_jsonb(:'k'), updated_at=now()
   WHERE key='GOOGLE_AI_API_KEY' (k via psql \getenv), assert 1 row else ROLLBACK. Rollback copy of
   the dead prior value kept in a 0600 file. Contingency: on any later failure keep the new key.
   Direct SQL skips admin-api updated_by. Invariant check before the write: re-read AI_TASK_MODELS
   and PDF_EXTRACTION_CONFIG and confirm no model needs a paired write (no direct-Gemini model
   selected); if one is, stop and use admin-api instead.
7. 1Password: op item get <id> --format json -> jq sets ONLY field gemini_popdam_shared_supabase
   value from the key file -> 0600 template -> op item edit <id> --template. Before/after: same
   field-label list and identical sha256 of every sibling concealed field; target field sha changes.
   HARD STOP: any step-7 failure or sibling-hash change -> do not mark done; restore the item from the
   saved pre-edit JSON (0600) and record the DB/1Password divergence on #213.
8. Proof: sha256(DB value#>>'{}') == sha256(1Password field) == sha256(key file) != July snapshot;
   repeat step-5 call using the value read back from the DB -> 200; both agents heartbeat after
   the write.
9. Shred temp files; mark GOOGLE_AI_API_KEY rotation done but leave "- [ ] live proof: agent Google
   branch" on #213 (unreachable while vision model is OpenRouter); mark rotated in fix_admin_config_secret_rotation.md; post
   evidence + Railway residual on #213.
