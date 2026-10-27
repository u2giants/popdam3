# Rotation plan — leaked Supabase sb_secret key + broken AI tester logins (qsllyeztdwjgirsysgai)

## Incident summary

During a live-proof session on 2026-10-27 (~11:57 AM EDT), the full value of
the new-format Supabase API secret key (`sb_secret_…`, field
`SUPABASE_SECRET_KEY`) was printed into the ZCode chat transcript while
inspecting the 1Password item "Supabase Runtime Keys - shared POP database
(production)" (vault `vibe_coding`). Per standing rules the credential is
treated as compromised and must be rotated.

Separately discovered in the same session: the stored passwords for all three
AI tester accounts are rejected by production auth (`invalid_credentials`),
and the stored legacy `SUPABASE_SERVICE_ROLE_KEY` JWT is also rejected (401 —
Supabase legacy JWT keys have been superseded on this project).

## Exact credentials

1. `SUPABASE_SECRET_KEY` (new-format API secret, ~41 chars, `sb_secret_` prefix)
   - Storage: 1Password vault `vibe_coding`, item "Supabase Runtime Keys -
     shared POP database (production)", field `SUPABASE_SECRET_KEY`.
   - Provider: Supabase project `qsllyeztdwjgirsysgai` ("popdam", us-east-1).
   - Consumers: **none in automation.** The item notes describe it as a
     probe/future-session credential. Verified today: PopDAM frontend uses the
     publishable key; Railway/GitHub use the separately-managed legacy
     service-role env; no repo code references `sb_secret`.
2. AI tester account passwords (3):
   - `ai-viewer@designflow.app` — item "DAM AI tester login - PopDAM (viewer, dam.designflow.app, production)"
   - `ai-designer@designflow.app` — item "DAM AI tester login - PopDAM (designer, dam.designflow.app, production)"
   - `ai-tester@popcre.com` — item "PopSG / PopDAM AI tester login (sg.designflow.app + dam.designflow.app)"
   - Consumers: AI live-proof/QA sessions only (documented as "Browser/AI test
     login"). No human business users. Passwords will be generated (1Password,
     24+ chars) and stored back into the same items.
3. Legacy `SUPABASE_SERVICE_ROLE_KEY` JWT in the same runtime-keys item: stale
   (401). Read-only refresh from the Management API
   (`GET /v1/projects/qsllyeztdwjgirsysgai/legacy/apiKeys`) into the 1P field;
   no rotation of the live Railway value (worker is functioning).

## Steps (order matters; zero-downtime)

1. Reset the three tester passwords first (GoTrue admin `PUT
   /auth/v1/admin/users/{id}` using the current sb_secret), update their 1P
   items, and verify each with a password-grant sign-in.
2. Refresh the stored legacy service-role JWT value from the Management API
   into 1P (read-only).
3. Create a NEW sb_secret via `POST /v1/projects/qsllyeztdwjgirsysgai/api-keys`
   (Management API, using the stored "Supabase CLI Personal Access Token"),
   store it in the 1P field, and verify it works (admin generate_link probe).
4. Revoke the leaked sb_secret (`DELETE /v1/projects/.../api-keys` with the
   leaked key id) and verify the old value is rejected.
5. Update the 1P item notes with the event, date, and that the old key was
   revoked.

## Verification

- Each tester login succeeds via password grant after step 1.
- New sb_secret authenticates (step 3) and leaked sb_secret is rejected
  (step 4).
- No application outage at any point: the rotated key has no automation
  consumers; the Railway worker's own env is untouched.

## Rollback

Before revoking the leaked key (step 4), the new key is already stored and
verified, so rollback is unnecessary. If the new key fails, keep the leaked
key until a second new key is verified (the leaked key's exposure is a
transcript on Albert's own infrastructure; window is short).
