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

## Addendum v8.1 — Railway worker GOOGLE_AI_API_KEY fallback (2026-10-07, simplified)

Review scope: ONLY this addendum. Steps 1-9 above already ran and were reported on #213 (5:15 PM
EDT); nothing here touches the DB. Owner of this addendum and its residuals: this Claude session.

Inputs (exact):
- Source: op://vibe_coding/3onekcbg3dxnazpnt36d4yzfcq/7g7toqbbme6aybbs5hfzvvwoaa. Already
  validated: sha256[:12]=3c48237f28e9 (== admin_config), GET v1beta/models -> 200. Because the
  value written to Railway is proven byte-identical by fingerprint, no separate post-write API
  call is needed (identical bytes, identical result).
- Target: Railway project 8645c5fe-ae60-413e-8464-508456c65365, env production, service popdam3
  (f777713f-d0f8-4f9b-9685-37c9090c98ef), variable GOOGLE_AI_API_KEY; all commands pass -p/-e/-s.
  Expected current fingerprint 3c1804c42ed1 (dead, API_KEY_INVALID).
- Scope: one Railway variable; 1Password item dykqfttarudsxhzrlsktyupq2y only (this session's
  empty placeholder).
- F = `railway variables --json` piped into python printing only sha256(GOOGLE_AI_API_KEY)[:12].
  Command shapes validated read-only today (variables --json; deployment list --json with
  id/status/createdAt; logs <id> --lines N).

Steps:
1. Preconditions, all read-only, run back-to-back immediately before step 2:
   a. F == 3c1804c42ed1 (else stop: someone changed it).
   b. `railway deployment list --json`: the newest deployment (any status) is SUCCESS and is the
      only non-REMOVED one; record it as D0. If anything is BUILDING/DEPLOYING/FAILED, wait up to
      20 min for that to settle, else stop.
   c. Restart safety (KNOWN_QUIRKS #74): admin_config BULK_OPERATIONS has no op running/queued/
      pending/starting, no batch_job phase submitting/ambiguous_submission, and no interrupted op
      eligible for auto-resume (transient reason + attempts under cap). 5:37 PM EDT check: none.
   d. Back up the old RAW value (not its hash) to a 0600 scratch file: `railway variables --json`
      piped into python that writes the GOOGLE_AI_API_KEY string itself to the file and prints only
      sha256(file contents)[:12], which must equal 3c1804c42ed1.
2. op_run pipes $K to `railway variable set GOOGLE_AI_API_KEY --stdin -p .. -e production -s
   popdam3` (normal deploy-triggering set — one restart, same as every push to main).
   Reconcile by F regardless of exit code: 3c48237f28e9 = applied; 3c1804c42ed1 = not applied,
   retry once, and if still 3c1804c42ed1 stop (nothing changed, no deploy) and record Blocked on
   #213; other = restore backup, assert F == 3c1804c42ed1, stop.
3. Identify the deployment: D1 = the deployment created after the step-2 start time. Bounded wait
   15 min for D1 SUCCESS and D0 REMOVED. If a further deployment (another session's push) appears,
   take the newest one as D1 and re-assert F == 3c48237f28e9; every check below uses that ID. If
   that unrelated deployment fails, do NOT roll back the key (the key is not the cause): stop,
   record on #213 with the deployment ID, and leave the valid new key in place.
4. Health of D1: exactly one non-REMOVED deployment (D1, SUCCESS); `railway logs D1 --lines 200`
   shows "worker: starting" and "polling loop started" with no crash/restart loop; admin_config
   WORKER_HEARTBEAT.updated_at advances past D0's removal time within 3 min (attributed to D1 by
   exclusivity; the row carries no deployment ID). Re-run check 1c to confirm nothing went
   ambiguous.
5. Rollback (only when the deployment created by step 2 itself fails step 3/4): pipe the backup back via `--stdin` (deploy-triggering), assert
   F == 3c1804c42ed1, and repeat steps 3-4 for that deployment. Old key is dead, so rollback only
   restores prior state. If rollback fails, keep the backup and record Blocked on #213.
6. 1Password: edit item dykqfttarudsxhzrlsktyupq2y (drop PLACEHOLDER from title, remove the empty
   concealed field, notes point to the main-key op:// ref); verify with item_get (no reveal). On
   failure retry once; the item holds no secret, so a failed edit is cosmetic and recorded on #213.
7. Post evidence on #213 (EDT times, signed), keeping unchecked, owned by this session:
   "- [ ] live proof: worker env-fallback branch (runs only on admin_config miss)".
Cleanup: shred the backup (old dead key) once the final state is verified; keep it only if a
rollback failed. The live key is never written to disk (stdin pipe only).
Residual on #213: the old dead key's origin Google project is unknown; it already returns
API_KEY_INVALID.
