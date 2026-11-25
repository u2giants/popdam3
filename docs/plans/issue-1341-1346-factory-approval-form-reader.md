---
summary: Issues #1341/#1346 plan: FAMA/LMS form reader — retry vs fail, bounded download, route checks, safer parser fallbacks. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue 1341 or 1346, or changing factory-approval-parse.ts, factory-approval-ocr.ts, or the claim/complete-factory-approval-form agent-api routes
---

# Plan: Factory approval form reader hardening (u2giants/popdam3#1341 and #1346)

Issues: https://github.com/u2giants/popdam3/issues/1341 (review of merged PR https://github.com/u2giants/popdam3/pull/1340) and https://github.com/u2giants/popdam3/issues/1346 (review of merged PR https://github.com/u2giants/popdam3/pull/1345). Both touch the same parser file; one plan resolves both.
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-indra-fama-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-indra-fama-plans.md)
Companion plan (Indra engine provisioning on the same agent): [issue-1329-indra-provisioning-lock-and-version-check.md](issue-1329-indra-provisioning-lock-and-version-check.md)
Written 2026-11-25 3:55 PM EST by Claude (plan only; no implementation started). Code facts checked against `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Out-of-order fixtures built from the real forms' line order (values invented) | ⬜ open | — |
| 2 | FAMA parser: unique-or-nothing fallbacks, labelled value first, expiry label, aliases cleanup | ⬜ open | — |
| 3 | NBCU parser: keep the full manufacturer code; unknown program refused | ⬜ open | — |
| 4 | Agent reader: retry vs fail, attempt cap, bounded download with timeout, lazy page rendering, batch keeps going | ⬜ open | — |
| 5 | agent-api routes: Windows-agent only, attempts passed through, sign errors retried, payload caps | ⬜ open | — |
| 6 | Tests (parser, reader, routes) incl. the adversarial table | ⬜ open | — |
| 7 | Runbook section updated | ⬜ open | — |
| 8 | Release, deploy, live proof on real uploaded forms | ⬜ open | — |

Fresh session starts at step 1. Steps 1–3 (parser) can run in parallel with step 5 (edge function); step 4 depends on step 3's `parseFactoryApprovalForm` signature and step 5's `attempts` field. All of 1–7 land in one PR.

---

## Part 1 — Why

### 1. The ultimate goal

When the team uploads a Disney FAMA or NBCU LMS factory approval PDF in DesignFlow, the factory's approval record should get the **right** facility name, facility/manufacturer number, issue and expiry dates — or, if the form genuinely cannot be read, a clear "failed" with the reason. A temporary network or engine problem must never mark a good form as failed, and a guessed value must never overwrite a factory's approval. **Missing is better than wrong:** when the reader is unsure, it leaves a field empty (people fill it in by hand) rather than guess.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

### 2. What this application is

PopDAM (`u2giants/popdam3`, release branch protected `main`, PR only) is POP Creations' internal asset manager. Its **Windows render agent** (`apps/windows-agent/`, Node/TypeScript Windows service on the office render box) also reads factory approval forms. Flow (runbook `docs/WINDOWS_AGENT_RUNBOOK.md`, section "Factory approval forms (Disney FAMA / NBCU LMS)"):

1. DesignFlow (PLM app, separate repo) uploads a PDF to Supabase Storage bucket `factory-approval-forms` and inserts a row in shared table `core.factory_approval_form` (`ocr_status = 'pending'`).
2. Every 2 min (`apps/windows-agent/src/index.ts:925`) the agent calls agent-api route `claim-factory-approval-forms` (edge function `supabase/functions/agent-api/index.ts:4054`), which calls DB function `core.claim_factory_approval_form_ocr(limit)` and returns a signed download URL per row.
3. The agent (`apps/windows-agent/src/factory-approval-ocr.ts`) downloads the PDF, reads embedded text with `mupdf` (or Indra OCR on rendered page images when there is no embedded text), parses it (`packages/agent-common/src/factory-approval-parse.ts`), and posts `complete-factory-approval-form` (`index.ts:4081`), which calls `core.record_factory_approval_form_ocr(...)`.
4. That DB function marks the form `done` (or `failed` when an error is passed) and, if it is the newest done form for that factory and program, overwrites `core.factory_approval`'s name, number, issue date, expiry and form reference (FAMA has no printed expiry: DB sets issue + 1 year).

Terms: **FAMA** = Disney "Facility and Merchandise Authorization" (fields: Facility Name with `(FAC-nnnnnn)` code, FAMA ID like `1WSJUPOCR6TX`, Issuance Date, Facility Alias Name(s)). **LMS** = NBCUniversal licensing-management letter (Manufacturer Name, Manufacturer Code like `L-12813`, Issued Date, Approval Expiration Date). Database objects are owned by `popcre/shared-db` (vendored read-only mirror in `shared-db/`; definitions at `shared-db/supabase/migrations/20261225130400_core_factory_program_approvals.sql:134-194`).

### 3. What triggered this work

- **#1341** — advisory review (muse-meta) of PR #1340 (the reader's first version): eager page rendering, unbounded/hanging download, transient errors recorded as permanent failures, non-`Error` throws, a failing completion aborting the batch, claim route not restricted to Windows agents and leaking claimed rows, unbounded completion payload, unvalidated `program`, NBCU number regex dropping the code's letters, `valueAfter` missing duplicate labels, no route/orchestration tests. Automatic fix was deferred (source moved). Nothing landed.
- **#1346** — advisory review of PR #1345 (the "labels first, values later" out-of-order fix): `Expires Date` label no longer matched, FAMA ID taken only when bare and otherwise a document-wide guess, first bare date used as issuance, alias fallback both drops and invents aliases, first `(FAC-…)` line wins over the labelled name, no out-of-order fixture. Fix PR #1347 was closed unmerged.
- Live state: the reader went live 2026-11-24 11:44 PM EST on agent 0.17.0.225 with the two real sample forms reaching `done` (runbook). The defects are about wrong or lost values on other forms, not a current outage.

### 4. Scope

In: `packages/agent-common/src/factory-approval-parse.ts` + test; `apps/windows-agent/src/factory-approval-ocr.ts` (+ new test); `apps/windows-agent/src/api-client.ts:498-524`; `supabase/functions/agent-api/index.ts:4051-4100` and a new helper `supabase/functions/_shared/factory-approval-payload.ts` + test; runbook section; Windows agent version bump and release.

**NOT in this plan:**
- Any `shared-db` change (no new columns such as a claimed-by worker; rejected in §7). If implementation proves one is required, stop: it goes to `popcre/shared-db` as its own PR first.
- DesignFlow upload screens or the reminders cron.
- The Indra engine install (#1329 plan).
- Retailer programs (Dollar General, Walmart) — they have no forms.
- Re-reading forms already `done` (no backfill; optional re-queue is a separate owner decision).

---

## Part 2 — What we already know

### 5. Current state of the code (`origin/main` `787c20b8`)

Parser `packages/agent-common/src/factory-approval-parse.ts`:
- `valueAfter()` `:57-70`: same-line value, else next non-empty line within 3 lines unless that line looks like a label; on a label it `break`s the inner loop and the **outer loop continues to later occurrences**.
- `parseFamaForm()` `:105-145`: `facLine` = first line anywhere ending in `(FAC-nnnn)` (`:107`) and it **wins over** the `FACILITY NAME:` labelled value (`:108`); `formReference` = labelled value only if the whole value is a bare 8–16 char letter+digit token, else **first such line in the document** (`:121-123`); `issuedOn` = labelled, else **first bare `M/D/YYYY` line** (`:125-126`); aliases = labelled block, else every line with a company word (`co`, `ltd`, `company`, `corp`, `factory`, `products`…) that is not the FAC line, not licensee/Disney text, no 3-digit run (`:130-136`) — no dedupe, does not exclude the parsed name; expiry label `Expir(?:ation|y)\s+Date` (`:141`) — PR #1345 dropped `es` (`Expires Date`).
- `parseNbcuLmsForm()` `:147-162`: number = `codeRaw.match(/[A-Z]{1,3}\s*-\s*\d+|\d{3,}/i)` — `ABC12345` → `12345`.
- `parseFactoryApprovalForm()` `:165-167`: anything not `"disney"` is parsed as NBCU.
- Tests `factory-approval-parse.test.ts`: reading-order FAMA, one-line FAMA, NBCU, dates, optional real samples via env `FAMA_SAMPLE_TXT` / `LMS_SAMPLE_TXT` (`:69-87`). No out-of-order fixture.

Reader `apps/windows-agent/src/factory-approval-ocr.ts`:
- `readPdfText()` `:19-43` renders every page (≤ 6) to a 2× PNG **before** checking embedded text.
- `processForm()` `:45-69`: `fetch` with no timeout; whole body buffered before the 50 MB check; every error (download, mupdf, Indra missing, the success-path completion call) goes to the `catch`, which records `failed` with null fields; `(e as Error).message` crashes on non-`Error` throws; a throw from the catch-path completion escapes and aborts the remaining jobs of the batch (`:81`).
- `runFactoryApprovalOcr()` `:74-88`: up to 20 rounds × 10 claims, `running` guard.

API client `apps/windows-agent/src/api-client.ts:500-510`: `FactoryApprovalFormJob {id, program, file_name, download_url}`, no shape checks.

Edge function `supabase/functions/agent-api/index.ts`:
- `handleClaimFactoryApprovalForms(body)` `:4054-4079`: ignores the caller's `agentId/agentType` (dispatch at `:5223-5226`; compare `handleClaimStyleGuidePdfText(agentId, agentType)` `:3968-3969`, which returns 403 unless `agentType === "windows-render"`); signs each row for 900 s; a sign error records the form `failed` permanently; `createSignedUrl` throwing (rather than returning an error) would escape the loop.
- `handleCompleteFactoryApprovalForm(body)` `:4081-4100`: no cap on `ocr_text`; `aliases` filtered only by `typeof === "string"`.

Database (read-only facts, shared-db mirror `:134-194`): claim takes rows that are `pending`, or `processing` with `ocr_claimed_at` older than **30 minutes** (built-in lease and retry), increments `ocr_attempts`, returns full rows (so `ocr_attempts` is available to the route). Record sets `done`/`failed`, has no ownership check, and only updates the approval on success.

### 6. Key findings

- **#1341 finding "valueAfter returns null on the first label hit" is wrong**: the `break` at `:65` exits the inner loop only, so later occurrences are scanned. Resolution: lock the behaviour with a test (`valueAfter scans a later duplicate label`), no code change.
- The DB's 30-minute lease already gives a free retry path: if the agent simply **does not record** a transient failure, the row stays `processing` and is re-claimed after 30 min. So "retry" needs no new timer and no DB change. `ocr_attempts` lets the agent stop after a fixed number of tries.
- The record function upper-cases the number (`extracted_number = upper(btrim(p_number))`), so #1341's "not upper-cased" is harmless; the real bug is dropped letters.
- Aliases are stored only on the form row (`extracted_aliases`); the approval update does not use them. A wrong alias is low-stakes, but it is shown to users in the form history, so it should still be avoided.
- Out-of-order text: the real FAMA PDFs are fillable forms; `mupdf` returns all labels first, then all values. The real sample texts are not in the repo (private business documents); their `ocr_text` is stored on the `done` rows of `core.factory_approval_form`.
- A completion for a form that was re-claimed by another run is idempotent (same PDF, same parser) — duplicate completions write the same values.

### 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Add `ocr_claimed_by` / lease token to the DB and check it on completion (#1341 suggestion) | Needs a shared-db migration for no business gain: duplicate completions of the same PDF write identical values; the 30-min lease already bounds overlap. App-side `windows-render` check closes the authorization gap. |
| Agent retries transient failures itself in a loop with backoff | Duplicates the DB lease; risks long holds. Leaving the row `processing` reuses the existing mechanism. |
| Make the FAMA fallback smarter (score lines by position) | Unknowable without many real forms; "unique-or-nothing" is safe and testable. |
| Drop all fallbacks (labels only) | Re-breaks the out-of-order real forms that PR #1345 fixed. |
| Put real sample text in the repo as fixtures | Private business data; fixtures must use invented values in the real line order. |
| Mark unknown `program` as NBCU (today) | Silent misparse; refuse instead. |
| Sign URLs for longer than 30 min | Longer than the lease; an expired URL is simply a transient failure re-signed on re-claim. |

### 8. Design decisions

Locked (2026-11-25, this plan):
- **Unique-or-nothing fallbacks (FAMA).** Labelled value first. Shape fallbacks apply only when the label gives nothing, and only when **exactly one** candidate line exists in the document; otherwise the field is `null`.
  - Name/number: if the `FACILITY NAME:` labelled value carries a `(FAC-…)` tail, use it; else the unique `(FAC-…)` line; two different FAC lines and no labelled value → name and number `null` (form fails as unreadable — correct, a person checks it).
  - Form reference: take the **first token** `[A-Z0-9]{8,16}` with a letter and a digit inside the labelled `FAMA ID` value (so `1WSJUPOCR6TX extra` works); fallback only to a unique bare token line, and only if the text contains a `FAMA ID` label at all.
  - Issue date: labelled `Issu(ance|ed) Date`, else the unique bare date line; if the text also has an `Expir…` label or two bare date lines → `null`.
  - Expiry label: `Expir(?:ation|y|es)\s+Date` (restore `Expires Date`).
  - Aliases: labelled block as today; fallback keeps the company-word rule but excludes the parsed name (case-insensitive), any line that is a prefix of the facility line, the licensee block lines, and duplicates; max 10, each ≤ 200 chars. Accepted limitation: short aliases without a company word (`OKAY HOME`) are found only by the labelled path.
- **NBCU number.** Take the first token matching `[A-Z]{1,3}\s*-?\s*\d{3,}` or `\d{3,}` from the labelled value and keep the letters: `ABC12345` → `ABC12345`, `L - 12813` → `L-12813` (normalise spaces; keep the dash only if printed). Values over 20 chars → `null`.
- **Program.** `parseFactoryApprovalForm` throws `UnsupportedProgramError` for anything but `disney` / `nbcu`; reader records it as a permanent failure "unsupported program <x>".
- **Error classes in the reader.** `PermanentFormError` (unreadable content): no text, name and number both missing, over 50 MB, mupdf cannot open the file, HTTP 404/410, unsupported program. Everything else is **transient** (network, timeout, HTTP 403 expired URL, 5xx, Indra unavailable, completion call failure).
  - Permanent → record `failed` with the reason.
  - Transient with `attempts < 3` → log a warning and **do not record**; the DB lease re-claims after 30 min.
  - Transient with `attempts >= 3` → record `failed` "gave up after 3 attempts: <reason>".
  - A completion-call failure on the success path is transient (never converted into a content failure).
- **Download.** `fetch(url, { signal: AbortSignal.timeout(60_000) })`; refuse when `content-length` > 50 MB; otherwise stream the body and abort once 50 MB is exceeded.
- **Lazy rendering.** Extract embedded text from all pages first; render pages to PNG (2×, ≤ 6 pages) only when embedded text is under the 80-character threshold; render and OCR one page at a time, freeing each pixmap.
- **Error messages.** `errorMessage(e) = String((e as Error)?.message ?? e).slice(0, 1000)`; each job wrapped in its own try/catch so one bad job never stops the batch.
- **Routes.** Both routes return 403 unless `agentType === "windows-render"` and log `agentId`. Claim returns `attempts` (= `ocr_attempts`) and `program`, validated against `disney|nbcu` (others recorded failed "unsupported program"); signed URLs 1800 s; the per-row signing is in try/catch; a sign error is recorded `failed` only when the object is missing (`Object not found` / 404) or attempts ≥ 3, otherwise skipped (left for re-claim). Complete: `ocr_text` trimmed and capped at 200,000 chars; `aliases` trimmed, non-empty, deduped, ≤ 10 items, ≤ 200 chars each; `name` ≤ 300, `number` ≤ 40, `form_reference` ≤ 40 (over-long → `null`); dates must match `YYYY-MM-DD` or become `null`. Validation lives in pure functions in `supabase/functions/_shared/factory-approval-payload.ts` so vitest can test them.
- Claim batch size from the agent: 5 (was 10), so a batch finishes well inside the signed URL's life.

Open (criteria given):
- Exact attempt cap value 3 may become 2 or 4 if live proof shows Indra installs take more than one lease; never more than 4 (each try can be 30 min apart; 4 tries ≈ 2 h of total elapsed time, each wait ≤ 30 min).
- Whether `PermanentFormError` lives in `packages/agent-common` or the agent; criterion: whichever keeps the parser free of network concerns.

---

## Part 3 — How to build it

### 9. Steps

**Step 1 — Fixtures in real line order** · `lead-only` (reads private business data; decides what the fixtures must look like).
- Read-only query of the shared DB (Supabase MCP `execute_sql` read-only, or the Supabase dashboard SQL viewer in read mode): `select program, ocr_text from core.factory_approval_form where ocr_status = 'done' order by uploaded_at desc limit 5;`. Note only the **order of lines** (which labels appear, where values appear). Never copy names, codes or addresses.
- Write fixtures into `factory-approval-parse.test.ts` with invented values in that order: `FAMA_OUT_OF_ORDER` (all labels, then values: FAC line, bare FAMA ID, bare date, alias lines), `FAMA_TWO_FAC_LINES`, `FAMA_TWO_DATES`, `FAMA_ID_WITH_SUFFIX`, `FAMA_EXPIRES_LABEL`, `NBCU_LETTER_CODE` (`Manufacturer Code: ABC12345`), `NBCU_DUP_LABEL` (first `Issued Date:` followed by a label, second has the value).
- Gate: fixtures contain no real names/codes (lead reviews by eye); the existing real-sample tests still run when `FAMA_SAMPLE_TXT` / `LMS_SAMPLE_TXT` are set.

**Step 2 — FAMA parser** · `lead-only` (decides which value overwrites a factory approval).
- `parseFamaForm()` per §8: name/number precedence, `formReference` token extraction + guarded fallback, issue date guard, expiry label, alias cleanup. Add a small `uniqueOrNull<T>(items: T[])` helper.
- Gate: all step-6 parser tests pass; existing tests unchanged and green.

**Step 3 — NBCU parser and program check** · `helper-ok`. Stop-and-ask trigger: any fixture where the new number rule changes a value the existing tests expect.
- `parseNbcuLmsForm()` number rule per §8; `parseFactoryApprovalForm()` throws `UnsupportedProgramError` (exported) for other programs.
- Gate: tests `nbcu keeps letter prefix`, `nbcu normalises spaced dash`, `unknown program throws`.

**Step 4 — Agent reader** · `lead-only` (retry vs fail decides whether good forms are lost).
- `factory-approval-ocr.ts`: add `PermanentFormError`; `downloadPdf(url)` with timeout, content-length check and streaming cap; split `readPdfText` into `embeddedText(doc)` then `ocrPages(doc)` (lazy, one page at a time); `processForm(job)` applies the §8 error classes using `job.attempts`; per-job try/catch in the loop; `errorMessage()` helper; claim 5 per round.
- `api-client.ts`: `FactoryApprovalFormJob` gains `attempts: number`; `claimFactoryApprovalForms` returns `[]` when `data.forms` is not an array and drops entries missing `id`/`download_url` (log once).
- Make the module testable: export `processForm` with an injectable `{ fetch, readText, complete }` dependency object (default to the real ones).
- Gate: step-6 reader tests pass; `npm --prefix apps/windows-agent test` green.

**Step 5 — agent-api routes** · `lead-only` (authorization and production DB writes).
- New `supabase/functions/_shared/factory-approval-payload.ts`: `sanitizeCompletion(body)` and `classifySignError(err, attempts)` pure functions per §8.
- `index.ts`: pass `agentId, agentType` to both handlers at `:5223-5226`; 403 for non-`windows-render`; claim returns `{id, program, file_name, download_url, attempts}`; 1800 s signed URLs; try/catch per row; unsupported program recorded failed; complete uses `sanitizeCompletion`.
- Gate: vitest `supabase/functions/_shared/factory-approval-payload.test.ts` green (`npx vitest run supabase/functions/_shared/factory-approval-payload.test.ts`); `deno check supabase/functions/agent-api/index.ts` (or the repo's edge-function CI job) green.

**Step 6 — Tests** · `helper-ok` for writing the tests named in §10 against the fixtures from step 1. Stop-and-ask trigger: a test that only passes by changing the parser's locked rules.

**Step 7 — Runbook** · `helper-ok`. Stop-and-ask trigger: a statement that cannot be matched to code.
- `docs/WINDOWS_AGENT_RUNBOOK.md` "Factory approval forms" section: unique-or-nothing rule, retry vs fail rule (3 attempts, 30-min lease), Windows-agent-only routes, payload caps.

**Step 8 — Release, deploy, live proof** · `lead-only`.
- Bump `apps/windows-agent/package.json` patch version in the PR. After merge: edge function deploys via `deploy-supabase.yml`; Windows agent publishes via its release workflow; update the render box as `docs/WINDOWS_AGENT_RUNBOOK.md` describes.
- **Deploy order matters:** the new agent reads `attempts`; if it is missing (old edge function), treat attempts as 1. The new edge function returns 403 to non-Windows callers only — the old agent is a Windows agent, so either order works.
- Proof (all read-only): (a) the agent log shows one full pass on the new version with no unhandled error; (b) `select ocr_status, ocr_attempts, ocr_error from core.factory_approval_form order by uploaded_at desc limit 10;` shows no new `failed` row whose error is a network/timeout/Indra reason; (c) a `claim-factory-approval-forms` call made with a non-Windows agent identity returns 403; (d) if a new form is uploaded during the proof window, its `done` values match the PDF when viewed by eye. Ask Albert nothing. Save evidence under `docs/verification/` and cite it in STATUS.

No step makes anything wait more than 30 minutes; the DB lease is exactly 30 minutes (unchanged).

### 10. Tests required

`packages/agent-common/src/factory-approval-parse.test.ts` (run by `npm --prefix apps/windows-agent test`):
- `FAMA out-of-order labels then values` — name, number, form reference, issue date, aliases from `FAMA_OUT_OF_ORDER`.
- `FAMA labelled facility name wins over another FAC line`.
- `FAMA two FAC lines and no label → name and number null`.
- `FAMA ID with suffix keeps the token` (`1WSJUPOCR6TX extra`).
- `FAMA ID fallback ignores bare tokens when no FAMA ID label exists`.
- `FAMA two bare dates → issuedOn null`.
- `FAMA Expires Date label parsed`.
- `FAMA alias fallback excludes the name, the facility line split, duplicates`.
- `valueAfter scans a later duplicate label` (via `NBCU_DUP_LABEL`).
- `nbcu keeps letter prefix`, `nbcu normalises spaced dash`, `nbcu over-long code → null`.
- `unknown program throws`.
- Existing tests stay unchanged and green.

`apps/windows-agent/src/factory-approval-ocr.test.ts` (new; add to the `test` script list in `apps/windows-agent/package.json:10`):
- `transient download failure under 3 attempts records nothing`.
- `transient failure at attempt 3 records failed with gave-up reason`.
- `HTTP 404 records permanent failure`.
- `body over 50 MB aborts without buffering it all` (fake streaming body).
- `download timeout is transient`.
- `success-path completion failure is not recorded as content failure`.
- `non-Error throw is reported as text`.
- `one failing job does not stop the batch`.
- `embedded text found → no page rendering` (spy on the renderer).
- `malformed claim response yields no jobs`.

`supabase/functions/_shared/factory-approval-payload.test.ts` (vitest, edge-functions project):
- `ocr_text capped at 200000 chars`, `aliases trimmed, deduped, max 10, each ≤ 200`, `over-long name/number/reference become null`, `bad dates become null`, `classifySignError: missing object is permanent, other errors retried until attempts 3`, `non-windows agent gets 403` (pure `requireWindowsAgent(agentType)` helper).

Must stay green: `npm --prefix apps/windows-agent test`, `npx vitest run` (root), PR CI.

**Adversarial-cases table** (every outside input × hostile case × proving test):

| External input | Hostile / bad case | Expected behaviour | Test |
|---|---|---|---|
| Form text (FAMA) | Two `(FAC-…)` lines from different blocks | name/number null → failed unreadable | `FAMA two FAC lines and no label → name and number null` |
| Form text (FAMA) | Unrelated 8–16 char code line, no FAMA ID label | formReference null | `FAMA ID fallback ignores bare tokens when no FAMA ID label exists` |
| Form text (FAMA) | FAMA ID value with trailing words | token extracted | `FAMA ID with suffix keeps the token` |
| Form text (FAMA) | Two bare dates (issue + expiry, out of order) | issuedOn null | `FAMA two bare dates → issuedOn null` |
| Form text (FAMA) | `Expires Date:` wording | expiry parsed | `FAMA Expires Date label parsed` |
| Form text (FAMA) | Name line split from its FAC line; vendor header lines | not taken as aliases | `FAMA alias fallback excludes the name, the facility line split, duplicates` |
| Form text (NBCU) | Code `ABC12345` (no dash) | `ABC12345` kept | `nbcu keeps letter prefix` |
| Form text (NBCU) | Code value 200 chars of junk | number null | `nbcu over-long code → null` |
| Form text (NBCU) | Duplicate label, first followed by a label | later value used | `valueAfter scans a later duplicate label` |
| Claim response `program` | `"walmart"` / garbage | refused, recorded unsupported | `unknown program throws` + route sanitizer test |
| Claim response shape | `forms` not an array / entries without URL | treated as empty / skipped | `claimFactoryApprovalForms` shape test in `factory-approval-ocr.test.ts` (`malformed claim response yields no jobs`) |
| Download URL body | > 50 MB, or no content-length and endless stream | aborted at 50 MB, permanent | `body over 50 MB aborts without buffering it all` |
| Download URL | Never responds | 60 s timeout, transient | `download timeout is transient` |
| Download URL | 403 (expired), 5xx | transient, retried via lease | `transient download failure under 3 attempts records nothing` |
| Download URL | 404 | permanent | `HTTP 404 records permanent failure` |
| PDF bytes | Corrupt / not a PDF | permanent failure, batch continues | `one failing job does not stop the batch` |
| Thrown values | Non-`Error` throw (string, object) | message stringified | `non-Error throw is reported as text` |
| Completion body (edge) | 10 MB `ocr_text`, 10,000 aliases, empty/blank aliases | capped / cleaned | `ocr_text capped at 200000 chars`, `aliases trimmed, deduped, max 10, each ≤ 200` |
| Completion body (edge) | Over-long name/number/reference, bad date strings | null | `over-long name/number/reference become null`, `bad dates become null` |
| Caller identity (edge) | Bridge agent token calls claim/complete | 403 | route test `non-windows agent gets 403` in `factory-approval-payload.test.ts` (test the pure `requireWindowsAgent(agentType)` helper) |
| Storage signing | Object missing vs temporary error | missing → failed; temporary → left for re-claim | `classifySignError: missing object is permanent, other errors retried until attempts 3` |

### 11. Constraints and gotchas

- Protected `main`: branch + PR; AI merges after required checks; reviews advisory.
- **No shared-db change** in this plan; never add files under `supabase/migrations/` or edit `shared-db/` (vendored mirror). If a DB change becomes necessary, stop and route it to `popcre/shared-db` first (load the `shared-db-change` skill).
- Production DB is read-only for this work except through the normal agent flow; the step-1 and step-8 queries are `select` only.
- Never put real form contents (names, codes, addresses) in the repo, a PR, an issue or a log line beyond what the agent already logs (form id, program, number).
- Edit `packages/agent-common/src/` only; never `apps/*/src/common/` (generated copies).
- No hold, wait, timeout or retry over 30 minutes (owner rule 2026-11-20); the DB lease is 30 min and stays.
- Missing beats wrong (§1): any doubt → `null`.
- Times in docs in EST/EDT.

### 12. Access and environment

- `gh` authenticated as `u2giants`.
- Local: `npm ci` at root; `npm --prefix apps/windows-agent test`; `npx vitest run supabase/functions/_shared/factory-approval-payload.test.ts`.
- Shared DB (project `qsllyeztdwjgirsysgai`): read-only via the Supabase MCP or dashboard; credentials in 1Password vault `vibe_coding` (search "Supabase" / "PopDAM"); never paste values.
- Real sample text files for the optional real-sample tests: set `FAMA_SAMPLE_TXT` / `LMS_SAMPLE_TXT` to local files you extract yourself from the bucket PDFs; never commit them.
- Edge function deploy: `.github/workflows/deploy-supabase.yml` on merge. Windows agent release: `docs/deployment.md` → Windows agent.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–7 merged to `main` in one PR, CI green; PR linked on #1341 and #1346.
- [ ] Edge function deployed (deploy run id cited); Windows agent released and running on the render box (version cited).
- [ ] Step-8 live proof saved under `docs/verification/` and cited in STATUS.
- [ ] STATUS and handoff updated; #1341 and #1346 closed with evidence (a `- [ ] live proof` checklist item stays on each issue until step 8 is done — no new issue).

Risks and rollback:
- Stricter parsing may leave fields empty that were filled before (by design); people fill them by hand. If the out-of-order real forms lose name or number, that is a bug — the real-sample tests must stay green.
- A wrongly classified permanent error could still mark a good form failed; the attempt cap limits the opposite risk. Rollback: revert the PR and release the previous agent version; the edge function rolls back with the revert's deploy.
- Failed forms can be re-queued by setting `ocr_status = 'pending'` — that is a data change done only through the app's normal path or a shared-db-approved route, not ad hoc.

Open questions: none needing the owner. Attempt cap tuning criteria are in §8.

### Self-audit (final answers)

1. *Could a brand-new session execute this without asking?* Yes — §2 explains the whole upload → claim → read → record flow and the terms; §5 gives exact lines; §8 locks each rule with values; §9 names files, functions, gates and who does each step; §10 names every test; §12 gives access by location.
2. *Does it carry all background and what was ruled out?* Yes — §3 lists every finding from both reviews and the closed fix PR #1347; §6 records that one #1341 finding is wrong and why; §7 lists seven rejected approaches.
3. *Is the goal clear enough for judgment calls?* Yes — §1: right values or a clear failure, transient problems never fail a form, missing beats wrong.

Trust boundary: the adversarial-cases table in §10 covers form text, claim responses, download bodies, PDF bytes, thrown values, completion payloads, caller identity and storage signing; every row names a test.

### Lead launch prompt

```text
You are the lead implementing u2giants/popdam3 issues #1341 and #1346 (factory approval form reader).
Read first: AGENTS.md, then docs/plans/issue-1341-1346-factory-approval-form-reader.md (STATUS
table first; do not redo finished rows), then packages/agent-common/src/factory-approval-parse.ts,
apps/windows-agent/src/factory-approval-ocr.ts, and supabase/functions/agent-api/index.ts lines
4051-4100.
You do steps 1, 2, 4, 5 and 8 yourself (lead-only). Hand steps 3, 6 and 7 to your helper with the
plan's exact files, rules and test names; step 3 can start at once, step 6 after steps 1-5, step 7 last.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high)
for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges,
pushes to main, releases, deploys or GitHub posts; when a stop-and-ask trigger fires, bring it to
you; if stuck 30 minutes, you take the step back.
You run yourself: npm --prefix apps/windows-agent test; npx vitest run
supabase/functions/_shared/factory-approval-payload.test.ts; review every helper diff and every
fixture for real business data; the PR, merge after required checks, deploy and release checks,
and the live proof. Never write real form contents into the repo. No shared-db change: if one
seems needed, stop and route it to popcre/shared-db. Keep every wait at or under 30 minutes.
Update STATUS with artifacts (commit SHA, CI/deploy run ids, docs/verification/ path).
```
