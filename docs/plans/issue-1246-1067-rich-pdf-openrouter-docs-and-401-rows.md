---
summary: Issues #1246/#1067 plan: docs must match rich-PDF DeepSeek-via-OpenRouter routing; clear leftover 401 rows. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1246 or #1067, changing how the rich-pdf-extract worker op reaches its model, or rotating the OpenRouter key
---

# Plan: rich-PDF provider routing — make the docs match production, clear the 401 leftovers (u2giants/popdam3#1246, #1067)

Issues: https://github.com/u2giants/popdam3/issues/1246 (primary) and https://github.com/u2giants/popdam3/issues/1067
Handoff: [HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md](../../HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md)
Written November 25, 2026, 4:10 PM EST on `al8960ofc` by Claude (session b5bcb2fd). Planning only: nothing was changed.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence / artifact |
|---|---|---|
| 1. Read the live Railway values (fingerprints only) | ⬜ open | — |
| 2. New decision record; mark the 2026-07-15 one partly superseded | ⬜ open | — |
| 3. Reconcile RICH_PDF_EXTRACTION, idiosyncrasies, agents-reference, MODEL_RULES | ⬜ open | — |
| 4. Document `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` in both env tables + rotation trap | ⬜ open | — |
| 5. Fix the stale worker comment in `apps/worker/src/config.ts` | ⬜ open | — |
| 6. Read-only count of lingering 401 rich-PDF failures; clear if any | ⬜ open | — |
| 7. Land, comment, close both issues | ⬜ open | — |

**Start at Step 1.**

## 1. Ultimate goal

Since November 20, 2026, the production worker sends rich-PDF extraction (pulling product facts out of tech-pack and licensing-sheet PDFs) to DeepSeek **through OpenRouter**, on Albert's instruction. Every living document still says the opposite and tells future AI sessions "do not change this to OpenRouter" — so the next session would "fix" production back. The goal: the docs describe what production really does and why, the settings that control it are documented, and no product is left without its extracted PDF facts because of the failed 2026-11-18 run. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, `main`) is POP Creations' internal licensed-art library. The Railway worker (`apps/worker/`, Railway project `8645c5fe-ae60-413e-8464-508456c65365`, service `popdam3` `f777713f-d0f8-4f9b-9685-37c9090c98ef`, environment `production` `70aef28e-b9f8-4aa6-b902-c9a06aec08d5`) runs bulk operations including `rich-pdf-extract` (`apps/worker/src/handlers/rich-pdf.ts`), which writes `dam.pdf_rich_extraction` through the RPC `upsert_pdf_rich_extraction`. Shared Supabase project `qsllyeztdwjgirsysgai`; `dam.*` is reachable only through `public` RPCs or the Management API / SQL. Owner rulings live in `docs/decisions/`.

## 3. What triggered this work

**#1246** (reviewer on PR #1245, evidence `verification/469-openrouter-retry/`): (1) the living docs forbid OpenRouter for this batch while production uses it; (2) `DEEPSEEK_BASE_URL` appears in no env-var doc.

**#1067** (reviewer on PR #1066, evidence `verification/recovery-checks/`). Decision per finding:
1. Which credential `admin-api` accepted — **moot**: wording in a closed audit (#469 closed 2026-11-22).
2. A 2026-11-18 run with a dead key stamped a 401 `parse_error` on ~90 production rows — **real data question, step 6**. The feared overwrite of good data is **not** possible for unchanged PDFs: `shouldExtractRichPdf` (`apps/worker/src/handlers/rich-pdf.ts:175-186`) skips a same-hash row that already succeeded; only a row whose PDF text changed is re-extracted, and its old data was already stale. Failed rows retry after the 24 h cooldown.
3. 1Password `deepseek` field empty — **already fixed** on 2026-11-18 (`verification/469-deepseek-retry/evidence.json:119`), but the docs now point at the wrong key (step 4/5).
4. Scan counters / 17 errors — **moot**: closed audit record.
5. Fixture deleted early — **moot**: closed audit record.

## 4. Scope

In: docs, one code comment, a read-only production count, and (only if rows remain) one normal run of the existing op. NOT in scope: changing the routing or the worker code paths; moving rich-PDF to Straitly; making the worker read the OpenRouter key from `admin_config` for this op (a real improvement — see §13, separate work); any schema change; the general cacheable-batch rule for other workloads.

## 5. Current state (main at 787c20b8)

- Code: `apps/worker/src/config.ts:51-60` — `deepSeekApiKey` (`DEEPSEEK_API_KEY`) and `deepSeekBaseUrl` (`DEEPSEEK_BASE_URL`, default `https://api.deepseek.com/chat/completions`); comment on :51-53 still says the value lives in the 1Password `deepseek` field.
- Production (per `verification/469-openrouter-retry/live-proof-2026-11-20.md:46-72`): `DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1/chat/completions`; `DEEPSEEK_API_KEY` = a copy of the OpenRouter key from `admin_config.OPENROUTER_API_KEY` (fingerprint `da8b115ed72519de`); `admin_config.AI_TASK_MODELS.rich_pdf_extraction = deepseek/deepseek-v4.1-flash-1017`.
- Stale docs: `docs/decisions/2026-07-15-rich-pdf-and-cacheable-batches-use-direct-api.md` (status `current`); `docs/RICH_PDF_EXTRACTION.md:26-28, 209-219, 240-244`; `docs/idiosyncrasies.md:259-263`; `docs/agents-reference.md:321`; `docs/MODEL_RULES.md:99-103` (line 103 also points to `docs/KNOWN_QUIRKS.md` #64, which is actually about the `dam` schema — repoint it to the idiosyncrasy and the new decision record); `docs/RICH_PDF_EXTRACTION.md:24` makes the same wrong #64/#65 pointer for the routing lesson.
- Env tables missing both vars: `docs/configuration.md` worker table (~lines 205-216) and `docs/INFRASTRUCTURE.md:93-101`.

## 6. Key findings

- Owner words, 2026-11-20 (verbatim, recorded at `verification/469-openrouter-retry/live-proof-2026-11-20.md:10`): "use deepseek through openrouter". Earlier rule, 2026-07-15: "is there repeated submissions that can be cached to save money? if so we never want to use OpenRouter for that."
- Key-rotation trap: the worker reads `DEEPSEEK_API_KEY` from Railway only. Rotating the OpenRouter key in Settings (`admin_config.OPENROUTER_API_KEY`) does not update it, so rich-PDF would fail with 401 while everything else works — the same failure class documented at `docs/idiosyncrasies.md:165-169`.
- The Supabase MCP was unauthorized on the planning machine, so the step-6 count was not taken during planning.

## 7. Rejected approaches

- **Reading the 2026-11-20 words as repealing the general cacheable-batch rule** — rejected: they name only DeepSeek for this op. Narrow reading; the general rule stays for other batches.
- **Deleting the 2026-07-15 decision** — rejected: decisions are history; mark it partly superseded and link forward.
- **Mass-deleting 401 failure rows** — rejected: a normal op run retries them and keeps the audit trail.
- **Closing #1246 as "the record already notes the supersession"** — rejected: the reviewer's point is that the canonical docs, not the evidence file, are what sessions read.

## 8. Decisions

Locked: production routing stays as is (owner, 2026-11-20); narrow reading of the ruling (rich-PDF only); docs-only plus comment. Open: wording of docs; whether step 6 needs a run (decided by its count).

## 9. Steps

1. **Read live values** — `railway variables --service popdam3 --environment production --json` piped through a local script that prints only `DEEPSEEK_BASE_URL` in full and a sha256-16 fingerprint of `DEEPSEEK_API_KEY`; compare to §5. Also read `admin_config` `AI_TASK_MODELS` (read-only SQL). Gate: values recorded in the PR body by fingerprint. If production differs from §5, stop and report: the docs must describe reality. `lead-only` — production read and judgment.
2. **Decision record** — create `docs/decisions/2026-11-20-rich-pdf-deepseek-via-openrouter.md` (four-key header, `kind: decision`, `status: current`) quoting the 2026-11-20 words, stating the scope (rich-PDF only), the settings, and that the caching trade-off was accepted. In the 2026-07-15 file set `status: partly-superseded` (or the repo's existing superseded convention — `grep -n "status:" docs/decisions/*.md`) and add one line linking the new record. Gate: `ai-doc-health --repo . --fix-index` regenerates `docs/INDEX.md` without errors. `lead-only` — records an owner ruling.
3. **Reconcile docs** — rewrite the §5 passages so they say: rich-PDF calls DeepSeek through OpenRouter since 2026-11-20 by owner decision (link the new record), via `DEEPSEEK_BASE_URL`; prompt layout (stable `system`, variable `user`) stays. Retitle the idiosyncrasy and its agents-reference index line accordingly; keep the general direct-API rule for other batches. Gate: `grep -rn "not OpenRouter\|NOT OpenRouter\|DIRECT API" docs/` returns no rich-PDF claim that contradicts production. `helper-ok` with exact passages listed. Stop-and-ask: any passage whose meaning is unclear after the change.
4. **Env tables** — add rows for `DEEPSEEK_BASE_URL` (default direct DeepSeek; production OpenRouter chat-completions URL) and `DEEPSEEK_API_KEY` (must match the base URL's provider; production holds a copy of the OpenRouter key; **update it on every OpenRouter key rotation**) in `docs/configuration.md` and `docs/INFRASTRUCTURE.md`; add the rotation step wherever OpenRouter rotation is documented (`grep -rn "rotat" docs/ | grep -i openrouter`). Gate: both vars appear in both tables. `helper-ok`. Stop-and-ask: no OpenRouter rotation procedure found.
5. **Code comment** — update `apps/worker/src/config.ts:51-53` to say the production value is the OpenRouter key (1Password `vibe_coding`, the OpenRouter key item — name it by title found with `op item list --vault vibe_coding | grep -i openrouter`, never a value) and must be refreshed on rotation. Gate: `npm --prefix apps/worker test` (or the worker's test script) stays green. `helper-ok`. Stop-and-ask: comment change breaks a source-contract test.
6. **401 leftovers** — read-only SQL: `select count(*) filter (where parse_error ilike '%401%') , max(extracted_at) filter (where parse_error ilike '%401%'), count(*) filter (where parse_error is not null) from dam.pdf_rich_extraction;` (Management API or Supabase MCP). If the 401 count is 0: record the result on #1067. If not 0 and older than 24 h: start one normal `rich-pdf-extract` run from Settings → PDF Text → Rich PDF Extraction (an existing admin action, production class), wait for it to finish (no hold longer than 30 minutes; re-check counts each transition), re-count. Gate: 401 count is 0, or every remaining row is explained (e.g. PDF now unreadable) in the #1067 comment. `lead-only` — production action.
7. **Land** — branch, PR (steps 2-5), merge on required checks; comment on #1246 and #1067 with PR link and the step-1/step-6 evidence; close both. `lead-only`.

## 10. Tests

No new tests (docs and a comment). Must stay green: worker test suite, `ci.yml`, advisory doc-health.

## 11. Constraints

Never print key values; fingerprints only. No schema or `admin_config` writes. Feature branch + PR; AI merges; reviews advisory. Production task gate class for steps 1 and 6 (`.ai-devops/task-gates.json`). Times in EST. Sign comments with the `$AI_GH_SIGNATURE` format.

## 12. Access

`railway` CLI (OAuth login via `railway whoami`; the 1Password "Railway API" tokens are known dead). `gh` as `u2giants`. Supabase SQL via the Supabase MCP or Management API with `SUPABASE_ACCESS_TOKEN` from 1Password `vibe_coding` (item found by title search "Supabase access token"). Admin web login for step 6: 1Password `vibe_coding` admin tester item (search "popdam admin tester").

## 13. Done, risks, open questions

Done: steps 1-7, CI green, both issues closed with evidence, STATUS updated, handoff closed. Risks: a future OpenRouter rotation breaks rich-PDF silently until the docs are read — mitigated by step 4; a permanent fix is a small worker change to resolve the key from `admin_config.OPENROUTER_API_KEY` when the base URL is OpenRouter (separate issue, not this plan). Open: none for Albert; the narrow reading in §7 is reversible if he says the general rule is also lifted.

## Self-audit

1. Executable without questions? Yes — §5 lists every stale passage by file:line, §9 gives each edit, gate and access (§12).
2. All background, including rejections? Yes — §3 decides all seven findings, §6 the owner words and the rotation trap, §7 four rejected options.
3. Goal clear for judgment? Yes — §1: docs must match production; step 1 says to stop if production differs.

## Lead launch prompt

```
Implement docs/plans/issue-1246-1067-rich-pdf-openrouter-docs-and-401-rows.md in u2giants/popdam3. Read the whole plan, then STATUS.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You do step 1 first. Then you do step 2; give the helper steps 3, 4, 5 (helper-ok). The helper returns finished work or an evidenced blocker, decides nothing, never merges or posts, asks you on a stop-and-ask trigger, and is taken back after 30 minutes stuck.
You review every doc edit against production, then do steps 6 and 7 yourself. Update STATUS and close the handoff.
```
