---
issue: 1031
status: OPEN
owner: claude/coldlion-api-validation-proofread-1d2edd
---

# ColdLion API — 2026-09-03 reply drafted, triple-reviewed, waiting on Albert to send it

## 1. Status
**Nothing is blocked on code.** ColdLion replied on 2026-09-03. A nine-section answer is written,
put through **three independent adversarial reviews** (GLM 5.3, Grok 4.6, Muse Spark 1.3
Contributor), corrected against live re-probes, and is waiting on exactly one human action:
**Albert emailing it to JamieLynn.**

**AI sessions never send ColdLion mail.** Do not draft-and-send, do not use the Outlook tools for
this. Albert sends it himself, always.

The reply is at **`C:\Users\ahazan\Documents\coldlion\coldlion-reply-20260903.md`**, with the full
working record beside it as `coldlion-response-log.md`. **Neither is in this repository and neither
may be committed** — see §9. Working tree otherwise clean on branch `claude/pr-2137-28b0dc`.

## 2. What this is
POP pulls order history, production history and item master from the ColdLion ERP REST API
(`http://x5.coldlion.com/EhpApi`, header `X-API-Key`). We are validating the feed before building a
loader. Open questions to the vendor live in `docs/coldlion-open-questions.md` — **that register is
the front door; read it before touching anything else.** New entries this session: **2.25–2.33**.

The session began as "implement PR #2137" and was redirected entirely into this validation and
reply work. **No schema, migration or database change was made, and none is pending.**

## 3. What was done this session
- **Re-tested every claim against the live API before writing it.** Roughly 150 probes.
- **Withdrew three of our own findings** after reading the Swagger *parameter* blocks rather than
  only the response schemas: the `/prodHistory` `stageCode = ISS` default, the `active = Y` default
  on six endpoints, and the claim that `/prepackDetail` and `/proddetails` cannot be enumerated.
  All three were documented behaviour reported as faults.
- **Confirmed JamieLynn's item-detail answer with evidence** — 500-item random sample, then a
  matched 200 + 200 subsample: every stocked item had a detail record; all misses were items with
  no inventory.
- **Found two new vendor defects while checking the reviewers' objections:**
  1. `/merchGroupDetails` answers 200 with **zero rows under every constructible query** while
     `/merchGroupHeaders` returns 57 rows and defines ten types, and the data provably exists
     inline on `/items` rows.
  2. `/divisions?companyCode=SPRUCE` omits SP001, yet `/items?companyCode=SPRUCE&divisionCode=SP001`
     returns 78 active items. `/divisions?active=N` is empty globally, so "hidden inactive record"
     does not explain it.
- **Narrowed the `/pickticket` 500** to "fails whenever the result set would be non-empty".
- **Ran three adversarial reviews** and acted on them (§6).
- **Updated the register** with five new §4 answers and nine new §2 entries, and marked the old
  flat-200 page-size entry SUPERSEDED.

## 4. Open items
1. **Albert sends the reply.** `C:\Users\ahazan\Documents\coldlion\coldlion-reply-20260903.md`,
   the whole file. Five things need ColdLion action: company on inventory rows (2.25), the
   `/divisions` vs `/items` contradiction (2.26), enum-violation 400s (2.27), the two defaults
   (2.28), the pick-ticket 500 (2.29), and the empty `/merchGroupDetails` (2.30).
2. **Then wait.** Do not add questions — the 2026-08-31 owner instruction still stands.
3. **An open offer to Albert, never answered:** whether to reorder the letter so the four
   no-action sections (1, 2, 8, and the first paragraph of 9) move to the end and it opens with
   what ColdLion must act on. Ask before re-editing.
4. **The predecessor handoff on this same workstream is now stale:**
   `HANDOFF.d/2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md`. Its reply was sent
   and answered. It belongs to another session — **reported, not touched.**

## 5. Key facts / gotchas
- **Spring silently ignores undeclared query parameters.** An undeclared parameter having no effect
  is CORRECT behaviour, not a defect. This session is the **eighth** time we have misread it as a
  vendor bug. Read the declared parameter list before calling any filter broken.
- **`/inventory` is one global feed.** `companyCode` is blank on every row and is not a declared
  filter. `divisionCode` cannot stand in — `CW001` exists under all three companies.
- **Page size: 2,000 everywhere except `/prodHistory` and `/orderHistory`, which cap at 200.** The
  old register entry claiming a flat 200 was measured on a capped endpoint and generalised wrongly.
- **`toDate` is documented INCLUSIVE** on both history endpoints. Only `createdTo` on
  `/pickticket` and `/receiving` is genuinely open.
- **`/receiving` is clean** — 458 consecutive days, zero failures. Never say otherwise; a review
  fix pass introduced that error and Muse caught it.
- **Record every probe in the log the moment you run it.** Four true measurements were called
  "not in evidence" by two reviewers in a row purely because they were never written down.
- Standard probe shape, secret never in command text:
  `op_run`, `shell: powershell`, env `CL_KEY = op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`.
  Use **explicit string concatenation** (`$b+'/items?...'`), never PowerShell interpolation —
  interpolation produced 404s on all 54 calls in one earlier run.
- Field names that bite: `createdTime` (not `createTime`), **`mGCategory` with a capital G**,
  `sizeRangeCode` (not `sizeCode`). A wrong name returns **silence, not an error**.
- Two numbering schemes: outbound issue numbers (what ColdLion sees) are NOT register entries
  (`2.x`). Do not conflate them.
- Owner context: **pick tickets and receiving are USA-warehouse stock orders, a small part of the
  business** — not blocking. And **we are the only consumer of this API**, so
  backward-compatibility arguments about other callers are void.

## 6. What was tried and failed
- **Three reviewers, three different failure modes.** GLM 5.3 stalled without ever returning a
  verdict. Grok 4.6 returned REJECT with 10 findings — five were real errors of mine, and the rest
  I refuted with live probes (it called the SPRUCE division mix fabricated; it is real). Muse Spark
  1.3 returned NOT SAFE TO SEND with 4 cuts, one of which was the genuine `/receiving`
  contradiction. **Verify a reviewer's claim before accepting it, and log the refutation.**
- **A fix pass broke something that was already right.** Rewriting §6 for Grok introduced
  "`/receiving` behaves the same way", contradicting our own sent report. That is exactly why the
  third review was worth running.
- `ai-grok-review` needs a git repo with an unambiguous `origin` and `.ai/reviews/` in
  `.gitignore`, and it is **read-only** — a prompt asking it to write a file is refused.
- `ai-muse` hardcodes `muse-spark-1.2-contributor` with no env override and byte-compares its
  config against `$ROOT/config/opencode-muse/`. To run 1.3 I copied `/c/repos/ai-devops/{bin,config}`
  to an isolated scratch directory and rewrote the version there, with `AI_MUSE_CONFIG_DIR` /
  `AI_MUSE_STATE_DIR` / `AI_MUSE_CALLER` pointed at it. **The shared ai-devops checkout was
  deliberately not modified** — another session has uncommitted changes there including `bin/ai-muse`.
- `sed` mangled a multi-line prompt rewrite into a broken fragment; a Python heredoc fixed it.
- Bash heredocs inside the Bash tool repeatedly failed with "unexpected EOF" on long quoted
  content. Write the script with the Write tool and run it as a file.

## 7. Files
- `C:\Users\ahazan\Documents\coldlion\coldlion-reply-20260903.md` — **the deliverable.** Not in the
  repo, and must not be.
- `C:\Users\ahazan\Documents\coldlion\coldlion-response-log.md` — the authoritative working record:
  every probe, every reviewer finding, what was accepted and what was refuted.
- `docs/coldlion-open-questions.md` — the register. **Start here.** Entries 2.25–2.33 are this
  session's.
- `HANDOFF.d/2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md` — the predecessor,
  now stale, another session's file.

## 8. Secrets
API key: 1Password vault `vibe_coding`, item "Coldlion ERP API key x5.coldlion.com", field
`credential`. **Already stored; nothing new appeared this session and nothing was added.** Inject
via `op_run` with `shell: "powershell"`. Never paste the key into chat, arguments, logs or commits.
**Do not rotate it** (owner ruling — rotation was withdrawn).

## 9. Data handling
Raw ColdLion payloads are customer order data and **shared-db is a PUBLIC repository.** The reply
draft contains item numbers and a licensed item description, which is exactly the class of content
that was withdrawn from this repo on 2026-09-01. **It lives outside the repo and stays there.**
Only redacted, aggregate outcomes go into the register — that is what was committed this session.
The repo has a PII forward guard that will fail the merge if this is ignored.
