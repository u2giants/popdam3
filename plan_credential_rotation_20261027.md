# CANCELLED by owner ruling 2026-10-27 — kept as reference

Albert's ruling (verbatim, from his chat): "if the keys were not published
outside of this computer then no need to rotate, just redact them from where
they appeared." The exposure was confined to the local session transcript on
hetz; all occurrences were redacted in place the same day (verified zero
remaining), and the ruling is recorded in `ai-devops docs/owner-rulings.md`
(2026-10-27). Rotation will NOT be executed. The one surviving follow-up is
the AI tester password repair, tracked on its own issue. Everything below is
the unexecuted plan, retained for the next real rotation.

# Rotation plan v7 — leaked Supabase sb_secret key + broken AI tester logins (qsllyeztdwjgirsysgai)

## Incident summary

During a live-proof session on 2026-10-27 (~11:57 AM EDT), the full value of
the new-format Supabase API secret key (`sb_secret_…`, field
`SUPABASE_SECRET_KEY`) was printed into the ZCode chat transcript while
inspecting the 1Password item "Supabase Runtime Keys - shared POP database
(production)" (vault `vibe_coding`). Per standing rules the credential is
treated as compromised and must be rotated.

Separately discovered: the stored passwords for all three AI tester accounts
are rejected by production auth (`invalid_credentials`).

v2 of this plan corrects v1's central error (REJECT by stepfun review
20261027T164123): the leaked key IS consumed by live automation. Findings
below are probe-verified on production, not assumed.

## Verified facts (probes run 2026-10-27, read-only)

- Edge functions: `POST /functions/v1/admin-api` with the leaked sb_secret
  passes the auth gate (returns app-level `Unknown action` for a probe
  action) — proving the deployed edge env `SUPABASE_SERVICE_ROLE_KEY` holds
  the leaked key (exact-match in `supabase/functions/_shared/admin-auth.ts`).
- The same probe with the legacy service-role JWT stored in the same 1P item
  ALSO passes (via the `allowVerifiedLegacyServiceRole` verified path), and
  that JWT can select `admin_config` via PostgREST — so the stored legacy JWT
  is alive for PostgREST/edge use (it is rejected only by the auth admin API).
- Railway worker (`apps/worker/src/config.ts`): `SUPABASE_SECRET_KEY` env is
  OPTIONAL and used ONLY as the edge-invocation key for the on-demand admin
  operation `reprocess-metadata` (`apps/worker/src/handlers/metadata-reprocess.ts`);
  it falls back to the legacy JWT, which passes the verified-legacy path.
  Whether Railway's env holds the leaked key is UNKNOWN (both Railway API
  tokens in 1Password item "Railway API" are rejected — see Open item).
- CI workflows use `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (legacy JWT class,
  verified working) against PostgREST — unaffected by sb_secret rotation.
- Frontends use the publishable key; agents use AGENT_KEY — unaffected.
- Management API access works via 1Password "Supabase CLI Personal Access
  Token" (`sbp_…`). Edge secret values are write-only via the API; the
  secrets list returns only names.

## Exposure record (what the transcript actually contains)

The ZCode transcript of this session printed, in full, exactly one secret
value: the `SUPABASE_SECRET_KEY` (sb_secret class; no fragment of it is quoted
anywhere in this plan or repository), during a
mistaken un-redacted `op item get … --fields SUPABASE_SECRET_KEY --reveal`
output at ~11:57 AM EDT. Every other credential in this plan moved only
through shell environment variables and pipes into HTTP requests and was
never echoed: the legacy `SUPABASE_SERVICE_ROLE_KEY` JWT, the Supabase CLI
token, the Railway tokens, and the tester passwords (old and new). The
per-viewer session minted during the live proof was deleted from disk at
12:15 PM EDT. No other session, log, or file received the leaked value. The transcript
that did contain it is the ZCode session store on `hetz`
(`~/.zcode/…`, session id recorded as `unknown` by the client); it is
retained until Stage B closes the key — purging session continuity stores
is not taken unilaterally, and this retention is an explicitly accepted
residual risk, tracked on issue #551, because the value is revoked at
Stage B completion in any case.

## Current edge-function secret set (GET /v1/projects/qsllyeztdwjgirsysgai/secrets, 2026-10-27)

Names only (values are write-only via the API): `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEYS`,
`SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`,
`BULK_OPERATION_ALERT_SECRET`, `BREVO_API_KEY`, `META_API_KEY`,
`TEXT_EMBED_URL`, `TEXT_EMBED_KEY`. The secrets-update call in Stage A is executed
under a proven-at-execution contract: the Management API bulk-secrets
update is a POST that creates-or-updates only the named secrets it is
given; secret deletion is a separate DELETE endpoint and is never called in
this plan. Before the POST, take the current secret name list via GET
(recorded above); after the POST, re-list names and assert `BREVO_API_KEY`,
`TEXT_EMBED_KEY` and `META_API_KEY` are still present and no name vanished.
If any name is missing, restore it immediately from 1Password/known values —
the recovery is executable because the write only ever carries the single
changed pair, so any disappearance is a platform fault to reverse at once.

## Blast radius of the edge-secret update

`SUPABASE_SERVICE_ROLE_KEY` in the edge runtime gates PopDAM's edge functions
(admin-api, agent-api, helper-api, exports, verify-app-access,
dam-search-ai), all deployed from this repository. Bridge/Windows agents
authenticate with `AGENT_KEY`, the desktop Helper with its own flow, and
frontends with the publishable key — none read this secret. shared-db
tooling scripts use their own environment variables, not edge-runtime
secrets. The only external caller relying on the exact-match value is the
Railway worker edge invocation covered in the risk section.

## Exact credentials

1. `SUPABASE_SECRET_KEY` (new-format API secret, `sb_secret_` prefix)
   - Storage: 1Password vault `vibe_coding`, item "Supabase Runtime Keys -
     shared POP database (production)", field `SUPABASE_SECRET_KEY`.
   - Provider: Supabase project `qsllyeztdwjgirsysgai`.
   - Consumers after rotation: (a) edge function env `SUPABASE_SERVICE_ROLE_KEY`
     (proven = leaked value); (b) Railway worker env `SUPABASE_SECRET_KEY`
     (unknown; only affects the on-demand admin `reprocess-metadata` op).
2. AI tester account passwords (3): `ai-viewer@designflow.app`,
   `ai-designer@designflow.app`, `ai-tester@popcre.com` — AI-session test
   logins only, no human business users. New 24+ char passwords generated by
   1Password CLI, stored in the same items.

## 1Password inventory (every item and field this plan writes)

| Item | Field | Write |
|---|---|---|
| DAM AI tester login - PopDAM (viewer, …) | `password` | new generated value |
| DAM AI tester login - PopDAM (designer, …) | `password` | new generated value |
| PopSG / PopDAM AI tester login (…) | `password` | new generated value |
| Supabase Runtime Keys - shared POP database (production) | `SUPABASE_SECRET_KEY` | new sb_secret value |
| Supabase Runtime Keys - shared POP database (production) | `notesPlain` | rotation record: leaked value's key id `c4f5a00a-53ae-4392-996d-9f519462f488`, dates, Stage B open item |

No other 1Password item is read for writes. The leaked value itself is not
re-recorded anywhere.

## Steps

### Stage A — execute now (no revocation; cannot break the worker DB path)

The leaked key is NOT revoked in Stage A, so whatever value Railway's
required `SUPABASE_SERVICE_ROLE_KEY` env holds remains valid throughout.
Multiple sb_secret keys may be active simultaneously on one project, which
is what makes this stage safe.

1. Resolve each tester account's auth user id via GoTrue admin
   `GET /auth/v1/admin/users` filtered by email (the viewer id is already
   recorded in its 1P item: `8ec13aa5-f283-47cc-8999-94cb65cfb80e`). If an
   account is missing or banned, record that fact, skip it, and continue
   with the others; do not fail the stage.
2. Reset the three tester passwords (GoTrue admin `PUT /auth/v1/admin/users/{id}`,
   body `{"password": <generated>}`, authenticated with the still-valid
   leaked sb_secret — its validity is already proven by today's recorded
   probes), update their 1P items, verify each with a password-grant
   sign-in.
3. Create a NEW sb_secret (`POST /v1/projects/qsllyeztdwjgirsysgai/api-keys`,
   Management API, name `popdam-rotation-20261027`). Record BOTH ids
   durably in the 1P notes before anything else: the leaked key's id
   `c4f5a00a-53ae-4392-996d-9f519462f488` (marked "leaked, pending revoke")
   and the NEW key's id and name (marked "active, deployed"). Store the new
   value in the 1P field `SUPABASE_SECRET_KEY`.
4. Verify the new key against PostgREST and the auth admin API (read-only probes) BEFORE any edge change.
5. WRITABILITY GATE — determine whether the edge-runtime
   `SUPABASE_SERVICE_ROLE_KEY` is a user-writable secret or a
   platform-injected value derived from the project's default secret key
   (`docs/archive/plan_admin_auth_helper.md` records the deployed digest
   matching the project default sb_secret). Probe: submit a secrets update
   for that name carrying the CURRENT value (a no-op write; zero behavioral
   delta whether accepted or rejected).
   - If ACCEPTED: the name is user-writable; continue with step 6 as
     written.
   - If REJECTED: the value is platform-managed and can only change by
     rotating the project's default secret key — which revokes the leaked
     key immediately. That is a Stage-B-class action: STOP after steps 1–4
     and step 8, leave the leaked key's edge power in place, and record on
     issue #551 that the rotation is wholly gated on Railway confirmation.
6. Update the edge function secret `SUPABASE_SERVICE_ROLE_KEY` to the new key
   (`PUT /v1/projects/qsllyeztdwjgirsysgai/secrets`). This is the proven
   consumer of the leaked value.
7. Verify with probes against every edge function whose AUTH accepts this
   key class as a bearer token — the five `allowServiceRole` functions:
   `admin-api`, `dam-search-ai`, `export-table`, `export-sql-dump`,
   `export-thumbnail-manifest`. Expect the NEW key to authenticate (an
   app-level error reply, never 401/403) and the leaked key to be refused
   (401/403). Only `admin-api` and `dam-search-ai` additionally carry the
   verified-legacy-JWT path. Functions NOT probed because they never accept
   this key class as a caller credential, and are unchanged by
   construction: `agent-api` (bridge/Windows agents authenticate with
   `x-agent-key`); `helper-api` and `verify-app-access` (end-user JWTs). The worker's `reprocess-metadata` operation enters
   through the same `admin-api` gate and code path as the admin-api probe,
   so its behavior follows that probe result; it is additionally confirmed
   by the operator on the next natural use rather than by triggering a bulk
   job for testing.
8. Update the 1P item notes with the rotation record and open item.

Stage A risk: only the on-demand admin `reprocess-metadata` operation can
degrade (worker → admin-api 401) IF Railway's optional `SUPABASE_SECRET_KEY`
holds the leaked value. No scheduled job, no data path, no frontend, and no
worker database operation is affected, because nothing is revoked and the
worker's required DB credential is untouched.

### Stage B — revoke (blocked on Railway confirmation, tracked as issue #551)

The leaked key stays PostgREST/auth-valid until Railway's env is confirmed,
because if Railway's required `SUPABASE_SERVICE_ROLE_KEY` were the leaked
sb_secret, revoking it would stop every worker database operation (AI
tagging, ERP, style groups, SeaDrive mirror) with no recovery path while
Railway API access is dead. Stage B therefore runs only after Railway access
is restored (fresh API token — both stored tokens are rejected; obtaining one
needs Railway browser SSO) or Railway's env values are otherwise confirmed:

- If Railway's DB key is the legacy JWT (expected per the Sept 7 worker-key
  history): revoke the leaked sb_secret immediately
  (`DELETE /v1/projects/qsllyeztdwjgirsysgai/api-keys/c4f5a00a-…`), verify
  rejection at PostgREST/auth, done.
- If Railway's DB key is the leaked sb_secret: update Railway env to the new
  sb_secret, restart the worker, verify operations, then revoke the leaked
  key and verify. Stage B closes only on POSITIVE evidence: new-key
  admin-api probe passes, one real worker operation observed healthy
  (`WORKER_HEARTBEAT` admin_config row advances), and the leaked key is
  rejected by PostgREST and auth admin.

Residual risk during the Stage B window: the leaked key retains
service-role PostgREST and auth-admin power. Exposure was one transcript on
Albert's own infrastructure; the window is tracked on issue #551 with this plan attached.

## Rollback

Stage A: redeploy the leaked key to the edge secret (it is still valid —
nothing was revoked), restoring the exact prior state. Tester passwords:
rotate again if needed; they are test accounts.
Stage B: a second new sb_secret is created and deployed before any old key
is revoked, so a failed consumer is recovered by re-running the stage.

## Out of scope

- Refreshing the stored legacy `SUPABASE_SERVICE_ROLE_KEY` JWT value (alive
  for PostgREST/edge; only the auth admin API rejects it).
- Rotating `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (GitHub, legacy JWT class) or
  the dead Railway API tokens (tracked with Stage B on issue #551).
