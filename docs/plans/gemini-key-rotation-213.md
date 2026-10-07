# Plan v6: replace PopDAM GOOGLE_AI_API_KEY (issue u2giants/popdam3#213)

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
  admin_config. Accepted residual recorded on #213 as a dead fallback (worker reads DB first; a DB-read
  miss falls back to a dead key and fails closed); owner: this session records it as an open
  checklist line on #213 for the next PopDAM worker deploy to repoint or remove it.

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
   showDeleted=true), recording uid, displayName, createTime, deleteTime, restrictions for every key;
   for each ACTIVE key only, REST getKeyString -> 0600 file -> sha256 compare to 3c9707b37660
   (never printed). Deleted keys cannot return material and are listed, not matched. Match found: record its uid, restrictions (apiTargets) and state; if not deleted,
   delete it. No match among live+deleted keys: record "no key object in the project holds the
   exposed value; N deleted keys listed" plus the API_KEY_INVALID result as evidence. lookupKey (if repeated) is the REST
   call with the key in a curl -K config, never gcloud argv. 403/429/other -> record verbatim, item stays open.
3. Usage (read-only): Cloud Monitoring serviceruntime.googleapis.com/api/request_count for ALL
   services in clever-treat-490312-i8, from the earliest point the API retains (state the actual
   retention boundary returned) to now; absence of data is recorded as "no data", never as clean, grouped by service and credential_id
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
   selected) — informational; adding a valid key needs no paired write either way.
7. 1Password: op item get <id> --format json -> jq sets ONLY field gemini_popdam_shared_supabase
   value from the key file -> 0600 template -> op item edit <id> --template. Before/after: same
   field-label list and identical sha256 of every sibling concealed field; target field sha changes.
   Also update the item notes: GCP project clever-treat-490312-i8 (113459745054), new key uid,
   restriction generativelanguage only, created 2026-10-07 for #213.
   HARD STOP: on step-7 failure retry the edit once; if still failing (or any sibling hash changed),
   restore the item from the saved pre-edit JSON, then roll the DB back to the saved prior value so
   DB and vault converge, and record it on #213 as Blocked with this session as owner.
8. Proof: sha256(DB value#>>'{}') == sha256(1Password field) == sha256(key file) != July snapshot;
   repeat step-5 call using the value read back from the DB -> 200; both agents heartbeat after
   the write.
9. Shred temp files; mark GOOGLE_AI_API_KEY rotation done but leave "- [ ] live proof: agent Google
   branch" and "- [ ] worker batchGenerateContent route unverified (no direct-Gemini model selected)"
   on #213; also a single batch-style probe: POST .../models/<model>:generateContent with
   x-goog-api-key header from a curl -K file (the worker auth shape) -> 200; mark rotated in fix_admin_config_secret_rotation.md; post
   evidence + Railway residual on #213.

All GitHub posts end with: Posted by Claude chat <CLAUDE_CODE_SESSION_ID> on hetz.

## Addendum v7.2 — Railway worker GOOGLE_AI_API_KEY fallback (2026-10-07)

Review scope: ONLY this addendum is up for approval. Steps 1-9 above were already executed and
reported on #213 (5:15 PM EDT); they are not re-run and nothing in this addendum restores any DB value.

Gate: immediately before step 1, run `ai-task-gates check --before production --reviewer-approval
<this addendum's APPROVE report>`; stop on refusal.

Coordinator decision: reuse today's new key for the Railway worker env fallback.

Inputs (exact):
- Source: op://vibe_coding/3onekcbg3dxnazpnt36d4yzfcq/7g7toqbbme6aybbs5hfzvvwoaa
  (field gemini_popdam_shared_supabase). Pre-check: sha256[:12]=3c48237f28e9 (== admin_config
  fingerprint after rotation); GET v1beta/models with x-goog-api-key -> 200.
- Target: Railway project popdam id 8645c5fe-ae60-413e-8464-508456c65365, environment production id
  70aef28e-b9f8-4aa6-b902-c9a06aec08d5, service popdam3 id f777713f-d0f8-4f9b-9685-37c9090c98ef,
  variable GOOGLE_AI_API_KEY. The CLI runs from a scratch directory linked with
  `railway link -p 8645c5fe-... -e production -s popdam3`, and every command also passes
  `-s popdam3 -e production`. Current value fingerprint 3c1804c42ed1 (dead, API_KEY_INVALID).
- Scope: exactly one Railway variable changes. No other Railway variable/service, no DB row, no code.
  The only 1Password change is to item dykqfttarudsxhzrlsktyupq2y, created by this session today as
  an empty placeholder (its concealed field has never held a value, so there is nothing to back up).
  The main-key item 3onekcbg3dxnazpnt36d4yzfcq is read only.

Steps:
0. Backup: write the current Railway value to a 0600 scratch file (read with `railway variables
   --json` piped straight into python that writes the file and prints only its sha256[:12];
   nothing raw is displayed). Shredded at the end after success.
1. Via 1Password op_run (value only in env, piped to stdin, never argv or printed):
   printf '%s' "$K" | railway variable set GOOGLE_AI_API_KEY --stdin -s popdam3 -e production
   (triggers a redeploy of the current commit).
2. Verify storage: `railway variables --json` piped into python that prints only
   sha256(value)[:12] for GOOGLE_AI_API_KEY; must equal 3c48237f28e9. Never use --kv to a terminal.
3. Verify value works from Railway's copy: the same pipeline feeds the read-back value as an
   x-goog-api-key header (curl -K from a 0600 file) to (a) GET v1beta/models -> 200 and
   (b) GET v1beta/batches (the list/poll surface the worker's batch status path uses, gemini-batch.ts)
   -> 200. Submitting a real batch is out of scope (no direct-Gemini model is selected).
4. Verify worker: new deployment status SUCCESS; deploy logs show worker startup, no crash loop,
   poll/heartbeat lines.
   Known limit: the fallback branch in apps/worker/src/google-ai-key.ts runs only when
   admin_config.GOOGLE_AI_API_KEY is empty/unreadable; deliberately emptying the production DB key
   to exercise it is out of scope. Step 3 proves the installed fallback value itself is valid.
5. Rollback (if the new deployment fails to start or logs show a new crash): restore the previous
   value from the step-0 backup via stdin `railway variable set ... --stdin` (this triggers a fresh
   deploy with the old env), confirm SUCCESS, and record Blocked on #213.
6. Update 1Password item dykqfttarudsxhzrlsktyupq2y: drop PLACEHOLDER from title, remove its empty
   concealed field, notes point to the main-key op:// ref as single source of truth; verify with
   item_get (no reveal).
7. Post evidence on #213, signed.
Cleanup (success OR failure, via shell trap): shred -u every 0600 scratch file (backup, curl -K
config). Out of scope, recorded as residual on #213: the old dead fallback key's Google project is
unknown (value never in admin_config or 1Password); it already returns API_KEY_INVALID, so it
cannot be used, and auditing its origin project needs console access to that unknown project.
