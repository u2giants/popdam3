# Plan v3: replace PopDAM GOOGLE_AI_API_KEY (issue u2giants/popdam3#213)

Facts verified 2026-10-07 (fingerprints/HTTP status only; re-read live at execution):
- admin_config.GOOGLE_AI_API_KEY (live project qsllyeztdwjgirsysgai): sha256(value#>>'{}') equals
  the July-exposed 1Password snapshot. generativelanguage returns 400 reason API_KEY_INVALID.
  keys:lookupKey raw response: {"parent":"projects/113459745054/locations/global"} (= clever-treat-490312-i8).
- Railway worker env GOOGLE_AI_API_KEY: different value, also API_KEY_INVALID; it was never in
  admin_config (not part of the July exposure). OUT OF SCOPE here; no Railway change in this plan.
- Worker Google code runs only for direct-Gemini batch models; current vision_tagging is not one,
  so no worker proof is claimed. Agents prefer OpenRouter and reach Google only on the legacy path.

Scope: one restricted key in clever-treat-490312-i8; one admin_config row; one 1Password field.

Gates: ai-task-gates check --before production with this review's APPROVE report before step 2,
and --before database before step 6; prove target DB (select current project ref via
pooler user postgres.qsllyeztdwjgirsysgai and a known row) before the write.

Steps (umask 077 for the whole run; secret values only in env, 0600 files, stdin, curl -H @file;
never argv, never printed):
1. Enable apikeys.googleapis.com on clever-treat-490312-i8.
2. List keys (incl. showDeleted) in clever-treat-490312-i8; re-run lookupKey for the exposed value;
   if it returns a key name, delete that key after step 7 passes; otherwise record the raw
   response as evidence the key object no longer exists.
3. Usage check (read-only): Cloud Monitoring request_count for generativelanguage in
   clever-treat-490312-i8, 2026-07-01..now; report anomalies or record unavailability verbatim.
   Gap stated: project 904692193547 (Railway value) not checked.
4. gcloud services api-keys create --project clever-treat-490312-i8 --display-name
   popdam-admin-config-2026-10-07 --api-target service=generativelanguage.googleapis.com
   --format=json > file; keyString extracted to a 0600 file; JSON shredded.
5. Probe the new key with the agent's exact call shape: generateContent on gemini-2.5-flash with a
   PNG of page 1 of a real style-guide PDF plus the agent's PDF_EXTRACTION_PROMPT; expect 200 and
   non-empty text. Key passed via curl -H @headerfile.
6. Rollback copy of the current (dead) row value in a 0600 file. Single transaction:
   UPDATE public.admin_config SET value=to_jsonb(:'k'), updated_at=now() WHERE key='GOOGLE_AI_API_KEY'
   (k from psql \getenv), assert ROW_COUNT=1 else ROLLBACK. Direct SQL skips admin-api's updated_by
   attribution; acceptable because vision_tagging is not direct-Gemini (no paired model write needed).
   Contingency: if anything after this fails, keep the new valid key in place (the prior value is dead).
7. 1Password: op item edit <item id> --template <0600 json> for gemini_popdam_shared_supabase.
8. Proof: sha256(value#>>'{}') == sha256(1Password field) == sha256(new key file); Gemini 200 from
   the DB-stored value with the step-5 PDF call; both agents heartbeat after the write (agent-api
   returns google_ai_api_key from admin_config). Live agents keep OpenRouter priority; the Google
   path is proven by the identical call, not by forcing production off OpenRouter.
9. Shred temp files; mark GOOGLE_AI_API_KEY done in fix_admin_config_secret_rotation.md; post
   evidence on #213.
