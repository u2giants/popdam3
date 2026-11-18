# Issue #469 deepseek key fix + rich-pdf failed-row retry — live proof 2026-11-18

summary: Valid DeepSeek key found and provisioned to the Railway worker env
(and the 1Password deepseek field); rich-pdf failed-row retry Leg 2 proven live
on a toytest fixture. Replaces the Leg-2 gap recorded in
`verification/469-richpdf-retry/live-proof-2026-11-15.md` and
`verification/recovery-checks/recovery-checks-2026-11-18.md`.
kind: verification-record
status: current
read-when: closing or resuming #469 rich-pdf live-proof checkbox

## Task gates (recorded verbatim outcomes)

- `ai-task-gates start --class production` — recorded for u2giants/popdam3 at
  base `98ed424bc0e5`.
- `check --before infrastructure` — **allowed by owner authorization** (scoped
  delegation text recorded in the gate log).
- `check --before deploy` — **allowed by owner authorization**.
- `check --before database` — **allowed by owner authorization**.
- `check --before production` — **allowed by owner authorization**.

No schema changes. No real design files touched. No NAS files placed.

## 1. Valid DeepSeek key — FOUND

Searched: 1Password vault `vibe_coding` (item lookup "deepseek": two items),
the local `ai-deepseek` / `ai-deepseek-agent` harness managed key reference
(`C:\repos\ai-devops\config\mcp.env.example`), and the Railway worker env
(readback for comparison).

- The documented worker-value home, item `ai provider api keys openai deepseek
  chatgpt qwen` (id `3onekcbg3dxnazpnt36d4yzfcq`), field `deepseek`, was
  **empty** (0-byte read, confirmed by fingerprint `01ba4719c80b6fe9` of a bare
  newline) — matching the 2026-11-18 recovery finding.
- A **valid** key exists in item `deepseek API key for reviewer only`
  (id `sgiugicww2yop7didws4q2r2ka`, field `credential`, 35 bytes). This is the
  managed reference `DEEPSEEK_API_KEY=op://vibe_coding/deepseek API key for
  reviewer only/credential` used by the ai-deepseek harness
  (`config/mcp.env.example`).
- Live benign call 2026-11-18 ~12:17 PM EST: `POST
  https://api.deepseek.com/chat/completions` with that key returned **HTTP 200**
  (model `deepseek-flash`, one-token reply). The key authenticates.
- Value fingerprint (identity proof, value never printed): `op read <ref> |
  sha256sum | cut -c1-16` = `c9f8745cf6376698` for both the reviewer item and
  the filled provider-keys field after the copy below.

## 2. Key stored in the 1Password `deepseek` field — DONE

Copied `deepseek API key for reviewer only/credential` → item `ai provider api
keys openai deepseek chatgpt qwen` field `deepseek` (`s5dmhabk34iazogaf3drcufzka`)
using the `op item edit --template` route with the value flowing only through
op_run env injection and a 0600 template file (secrets-to-1password rules;
no value in argv, output, or chat). Verified by fingerprint after the write:
target field `op read | sha256sum` = `c9f8745cf6376698`, 36 bytes through
`op read` (35-char key + newline) — identical to the source. Item version
advanced to 19.

## 3. Railway worker env provisioned + redeployed — DONE

The three stored Railway API tokens in 1Password item `Railway API` are dead
("Not Authorized" on every GraphQL query; the same gap recorded in
`plan_credential_rotation_20261027.md`, issue #551), and the Railway CLI login
was expired. Access restored via `railway login`: the default browser session
(owner's Chrome, already signed in to Railway) completed the OAuth consent
automatically — CLI reported `Signed in as u2giants@gmail.com`.

- Service: `popdam3` (service `f777713f-d0f8-4f9b-9685-37c9090c98ef`,
  environment `production` `70aef28e-b9f8-4aa6-b902-c9a06aec08d5`,
  project `8645c5fe-ae60-413e-8464-508456c65365`).
- `variableUpsert` set `DEEPSEEK_API_KEY` (35 bytes, fingerprint
  `e5fd6dec8b65dcd0` raw-value fingerprint; `op read` fingerprint
  `c9f8745cf6376698`) with `skipDeploys:false`. Readback confirms
  `DEEPSEEK_API_KEY` = the new value. The prior worker value was the invalid
  key masked `****80f9` (HTTP 401 "Authentication Fails") per the recovery
  record.
- Redeploy: Railway deployment `1653e2ce-0605-4c2e-ad70-2bb101b70219` created
  2026-11-18 12:18:18 PM EST, status **SUCCESS**. Worker `WORKER_HEARTBEAT`
  reports `status: running`, sha `c40a4f6bfdd1bdc51c5f60ffcdd11ccbcfbdc783`
  (new build), heartbeat `2026-11-18T17:21:00.344Z`.
- Worker authentication proof: the live retry extraction below succeeded
  through the worker's own `DEEPSEEK_API_KEY` (`model: deepseek-flash`,
  `parse_error` cleared) — the worker authenticates with the provisioned key.

## 4. rich-pdf retry Leg 2 — PROVEN (12:23 PM EST)

Fixture re-created per the documented probe method (2026-11-15 evidence),
one deliberate change: asset id `00004690-4690-4000-8000-000000000001`
(toytest id, sorts at the front of `pdf_text_samples` order by `asset_id`) so
the scan reaches it — the 2026-11-15 fixture `a4690000-…` sorted at offset
18,814 of 28,535 and was never reached.

- Fixture rows: `assets` (`toytest_tech_pack_469probe.pdf`, file_type pdf),
  `pdf_text_samples` (150-char harmless filler, char_count 150, sha256
  `ba621d0e526b761177d81b3e488fdfffab2625e9fb345bd80bfbd8a576c15de0` — matches
  the 2026-11-15 text exactly), and `dam.pdf_rich_extraction` via
  `upsert_pdf_rich_extraction` with
  `p_parse_error="probe-induced failure for 469 retry verification"`,
  `p_data={}`, `p_source_text_sha256=ba621d0e…`.
- Cooldown seeded (fixture row only, reversible; documented Management-API
  route): `extracted_at = now() - interval '25 hours'` (observed
  `2026-11-17 11:21:12-05:00`). 24h cooldown elapsed.
- Leg 1 state re-confirmed before the run: `get_pdf_rich_extraction_hashes`
  returned `parse_error` non-null with the seeded `extracted_at` — hash not
  marked done, retry eligible (`shouldExtractRichPdf` true by cooldown).
- Retry triggered 12:22 PM EST: admin-api `update-bulk-op`,
  `op_key=rich-pdf-extract`, `op_state={status:"running", cursor:0}` (HTTP 200).
  Worker picked up immediately.
- **Retry observed:** the fixture row now shows **`parse_error: null`**,
  `extracted_at: 2026-11-18 12:23:23.502139-05:00` (fresh),
  `model: deepseek-flash`, `source_text_sha256` unchanged (`ba621d0e…`) — the
  same-text-hash failure row was retried after the 24h cooldown and the
  successful extraction cleared the error. This is exactly the live-proof
  criterion from the 2026-11-05 comment ("one production saved failure …
  followed by a rich-pdf extraction run that retries it, and after provider
  recovery a successful extraction with `parse_error` cleared").

## 5. Cleanup — DONE

- Fixture rows deleted via the documented Management-API SQL route (asset,
  `pdf_text_samples`, `dam.pdf_rich_extraction` for
  `00004690-4690-4000-8000-000000000001`). Post-cleanup read: **0** asset rows,
  **0** `pdf_text_samples` rows, **0** `dam.pdf_rich_extraction` rows remain.
- The `rich-pdf-extract` op was set `interrupted` / `user_stop` at ~12:25 PM
  EST after the proof, to bound continued DeepSeek spend on the wider backlog
  (op cursor persisted; the backlog stays claimable by a normal resume).

## Disclosed writes

1. 1Password item `ai provider api keys openai deepseek chatgpt qwen`: the
   empty `deepseek` field now holds the reviewer-scope DeepSeek key (same
   account; verified live).
2. Railway service `popdam3` env `DEEPSEEK_API_KEY` replaced (was the invalid
   `****80f9` key) + worker redeployed (deployment `1653e2ce`, SUCCESS).
3. rich-pdf-extract run (2026-11-18 12:22–12:25 PM EST): the op's normal
   extraction output on pending production rows plus the fixture retry; op row
   left `interrupted`/`user_stop`.
4. Fixture rows created and deleted (0 remain).

## Live-proof checkbox

- [x] `rich-pdf` failed extraction no longer permanently marked done under the
  same text hash — fixed (PRs #5627 / #779; contract test #6424).
- [x] live proof — **PROVEN 2026-11-18 12:23 PM EST**: saved failure row
  (`parse_error` non-null, `extracted_at` 25h old) retried by `rich-pdf-extract`
  after the 24h cooldown; success cleared `parse_error` to null
  (`model: deepseek-flash`, `extracted_at` 2026-11-18 12:23:23 EST). Enabled by
  restoring a valid `DEEPSEEK_API_KEY` in the Railway worker env (and filling
  the 1Password `deepseek` field).

Posted by MiMo chat unknown on desktop
