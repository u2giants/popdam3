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

## Addendum v8.7 — Railway worker GOOGLE_AI_API_KEY fallback (2026-10-07, simplified)

Review scope: ONLY this addendum. Steps 1-9 above already ran and were reported on #213 (5:15 PM
EDT); nothing here touches the DB. Owner of this addendum and its residuals: this Claude session.

Gate (fresh, for this addendum only): immediately before EACH production mutation (the step-2
variable set, and the single step-5 redeploy if it happens) run
`ai-task-gates check --before production --reviewer-approval <this addendum's APPROVE report>`;
stop on refusal. There is no other production mutation in this addendum. The gate recorded for steps 1-9 is not reused.

Restart race (accepted residual, stated plainly): the worker has no maintenance fence, so an
operation could be started/queued by an admin in the seconds between check 1c and shutdown. This is
the identical exposure of every push-to-main deploy of this service (several today, e.g. 5:32 PM
and 5:36 PM EDT); the #74 saved-provider-ID design covers every phase except a pre-ID submission in
that window. Mitigation: check 1c runs last, immediately before step 2, and is re-run after D1 is
healthy; any op found submitting/ambiguous is reported on #213 and reconciled per #74, not
restarted.

Inputs (exact):
- Source: op://vibe_coding/3onekcbg3dxnazpnt36d4yzfcq/7g7toqbbme6aybbs5hfzvvwoaa. Already
  validated: sha256[:12]=NEW (== admin_config), GET v1beta/models -> 200. Re-validated
  (GET v1beta/models -> 200) twice more: immediately before step 2 from 1Password, and after step 2
  from Railway's read-back value, piped as the header via `curl -H @-` (stdin only; never on disk
  or argv).
- Target: Railway project 8645c5fe-ae60-413e-8464-508456c65365, env production, service popdam3
  (f777713f-d0f8-4f9b-9685-37c9090c98ef), variable GOOGLE_AI_API_KEY; all commands pass -p/-e/-s.
  Expected current fingerprint OLD (dead, API_KEY_INVALID).
- Scope: one Railway variable; 1Password item dykqfttarudsxhzrlsktyupq2y only (this session's
  empty placeholder).
- Full digests: NEW = NEW0a9bc34ddca4d6da9ae932beb25840767f8644bdf5b22616f0c1,
  OLD = OLD4699cf6afbbdc5d029157dbd1d0ce3c457b5a24b77263ba2beb1.
- F = `railway variables --json` piped into python printing only the FULL sha256 hex digest of
  GOOGLE_AI_API_KEY; every comparison in this addendum uses full 64-hex digests (the 12-char
  prefixes quoted here are labels only; step 1a records the full old digest, and the full new
  digest is computed from the 1Password field via op_run before step 2).
  Command shapes validated read-only today (variables --json; deployment list --json with
  id/status/createdAt; logs <id> --lines N).

Steps:
1. Preconditions, all read-only, run back-to-back immediately before step 2:
   a. F == OLD (else stop: someone changed it). And the live DB key digest == NEW: read-only
      `select value#>>'{}' from admin_config where key='GOOGLE_AI_API_KEY'` via
      psql "postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
      (live Virginia project; never the default MCP project), run with `psql -At` (unaligned, tuples only) and piped through
      `python3 -c "import sys,hashlib;print(hashlib.sha256(sys.stdin.read().rstrip('\n').encode()).hexdigest())"`
      so exactly the raw key bytes are hashed. Else stop.
   b. `railway deployment list --json`: the newest deployment (any status) is SUCCESS and is the
      only non-REMOVED one; record it as D0. If anything is BUILDING/DEPLOYING/FAILED, wait up to
      20 min for that to settle, else stop.
   c. Restart safety (KNOWN_QUIRKS #74): admin_config BULK_OPERATIONS (same explicit qsllyeztdwjgirsysgai connection;
      WORKER_HEARTBEAT in step 4 also read there) has no op running/queued/
      pending/starting, no batch_job phase submitting/ambiguous_submission, and no interrupted op
      eligible for auto-resume (transient reason + attempts under cap). 5:37 PM EDT check: none.
   d. No backup of the old value is taken (it is dead and there is no rollback to it); only its
      full sha256 digest is recorded.
2. op_run pipes $K to `railway variable set GOOGLE_AI_API_KEY --stdin -p 8645c5fe-ae60-413e-8464-508456c65365 -e production -s
   popdam3` (normal deploy-triggering set — one restart, same as every push to main).
   Reconcile by F regardless of exit code: NEW = applied; OLD = not applied,
   before any retry, reconcile deployments: if a deployment was created after the step-2 start,
   re-read F: continue from step 3 with no retry ONLY if F == NEW; if F == OLD the deployment is
   unrelated and the set did not land, so treat as not applied (below); other = stop; otherwise retry once,
   and if still old stop (nothing changed, no deploy) and record Blocked on #213;
   any other digest = stop and investigate (a concurrent change may be legitimate; never
   overwrite it), record on #213.
3. Identify the deployment: D1 = the deployment created after the step-2 start time. If F == NEW
   but no such deployment exists within 3 min (the set did not trigger one), run the gate and the
   step-5 redeploy command once (after check 1c), then take its returned ID as D1. Bounded wait
   15 min for D1 SUCCESS and D0 REMOVED. If a further deployment (another session's push) appears,
   take the newest one as D1 and re-assert F == NEW; every check below uses that ID. If
   that unrelated deployment fails, do NOT roll back the key (the key is not the cause): stop,
   record on #213 with the deployment ID, and leave the valid new key in place.
4. Health of D1: exactly one non-REMOVED deployment (D1, SUCCESS); `railway logs D1 --lines 200`
   shows "worker: starting" and "polling loop started" with no crash/restart loop; admin_config
   WORKER_HEARTBEAT.updated_at advances past the time this session first observed D0 as
   REMOVED (deployment list exposes only id/status/createdAt, so the observation time is used)
   within 3 min (attributed to D1 by
   exclusivity; the row carries no deployment ID). Re-run check 1c to confirm nothing went
   ambiguous.
4b. Final assertion after health (and after any step-5 redeploy): F == NEW and the Railway
   read-back value -> GET v1beta/models 200. Any mismatch = stop and record on #213.
5. No key rollback on deployment failure: the worker reads GOOGLE_AI_API_KEY lazily
   (google-ai-key.ts, only on a direct-Gemini batch with an admin_config miss), so the new value
   cannot cause a startup failure, and the old value is dead anyway. If the step-2 deployment
   fails step 3/4: read its logs, redeploy once (with check 1c and the gate first) using exactly
   `railway redeploy -y --json -p 8645c5fe-ae60-413e-8464-508456c65365 -e production -s popdam3`
   (redeploys the service's latest deployment, which after re-running step 1b must be the failed
   step-2 deployment; if it is not, stop), and if it still fails record
   Blocked on #213 with the deployment ID and log excerpt. No secret-bearing file exists to keep.
6. 1Password: edit item dykqfttarudsxhzrlsktyupq2y into a documented POINTER (coordinator
   instruction): title "Google AI (Gemini) API Key - PopDAM Railway worker env fallback (production,
   same key as admin_config)"; keep its 8 tags; first prove the concealed field empty via op_run (its sha256 must equal
   e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, the empty-string digest; else
   stop), then remove that empty concealed field so it holds no
   secret and cannot diverge (single source of truth = main-key field); notes keep the full context
   (purpose, consumer, Railway IDs, NEW digest, install date, how to rotate both together) plus the
   main-key op:// ref. Not a duplicate: it stores no value. Resolve the vault ID with vault_list (vibe_coding =
   pimcaogmxxzoafh7lsluj6uxkq today), then item_lookup "gemini", "google", "GOOGLE_AI", "railway
   worker" and confirm only this item and the main-key item match before editing; verify with item_get (no reveal). On
   failure retry once; the item holds no secret, so a failed edit is cosmetic and recorded on #213.
   The worker's env-fallback runtime path (google-ai-key.ts:29-45) stays unproved by design:
   exercising it requires emptying the production DB key; it is left as the same-issue live-proof
   checklist item below, per the standing rule.
7. Post evidence on #213 (EDT times, signed), keeping unchecked, owned by this session:
   "- [ ] live proof: worker env-fallback branch (runs only on admin_config miss)".
Failure-path evidence: these commands cannot be dry-run against production; each failure branch
is defined above with a stop + #213 record, and the read-only shapes were exercised today.
Cleanup: nothing secret is written to disk (new key moves by stdin pipes only; no old-key backup;
API checks pass the header via stdin).
Residual on #213: the old dead key's origin Google project is unknown; it already returns
API_KEY_INVALID.
