---
summary: Issue #998 plan: size agent-api IN-list lookups by the real request URL, in one tested shared helper, for check-changed and hygiene findings. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #998, or editing any agent-api lookup that sends a long list of paths or ids in a PostgREST .in() filter
---

# Plan: Batch agent-api lookups by the real URL length (u2giants/popdam3#998)

Issue: https://github.com/u2giants/popdam3/issues/998
Handoff: [HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md](../../HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch; record a live baseline | ⬜ open | |
| 2 | Shared helper `supabase/functions/_shared/url-budget-groups.ts` + tests | ⬜ open | |
| 3 | Use it in `handleCheckChanged` | ⬜ open | inline grouping at `agent-api/index.ts:2511-2547` on `origin/main` `787c20b8` |
| 4 | Use it in `handleReportHygieneFindings` lookup | ⬜ open | `agent-api/index.ts:3245-3248`, 100 paths per lookup |
| 5 | Record why the other `.in()` lookups are bounded | ⬜ open | §5 table |
| 6 | PR, merge, edge deploy | ⬜ open | |
| 7 | Live proof on a long-path scan, close #998 | ⬜ open | |

Review finding 3's named lines (`.in("relative_path", needsRender)` and `.in("asset_id", assetIds)` with dropped errors) **no longer exist**: render scheduling moved to the bridge (#1094), and `handleCheckChanged` no longer queries either. The same overflow class is still present elsewhere (Step 4).

**Where a fresh session starts:** Step 1. PR #842 (open, render cover/thumbnail cache) also edits `agent-api/index.ts`; rebase on it if it merges first.

## 1. The ultimate goal

The NAS bridge agent asks the cloud, 500 files at a time, "which of these files are new or changed?" The cloud looks them up by path. Paths travel inside the web address of the database request, and long NAS paths made that address too long: on 2026-11-13 every scan of the Decor share treated all ~163,000 files as changed (live repro: 200 paths → HTTP 400, 500 → HTTP 414). PR #997 split the lookup into groups of "about 8 KB", but it measured only the paths, not the whole address, so a full group can still exceed the common 8 KiB limit. Since #1117 a failed check no longer reprocesses everything — it retries the chunk for about 18 minutes and then fails the scan — so an overflow now means **scans stall and fail** instead of reprocessing.

When this plan is done, every lookup that sends a long list is split by the length of the **actual** request address, with a safe margin, in one shared and tested helper, so no scan can fail or slow down for this reason. **If a step conflicts with this goal, the goal wins — stop and flag it.** Results must be identical to a single unlimited lookup: same rows, nothing lost, nothing duplicated.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed consumer-product art (https://dam.designflow.app), repo `u2giants/popdam3`, branch `main`. The Synology bridge agent (`apps/bridge-agent/`) scans NAS shares and calls the `agent-api` Supabase edge function (`supabase/functions/agent-api/index.ts`, Deno, project `qsllyeztdwjgirsysgai`). `agent-api` reads the shared Postgres through supabase-js (pinned `npm:@supabase/supabase-js@2.101.1` in `supabase/functions/_shared/supabase-js.ts`), whose PostgREST builder puts filters such as `.in("relative_path", [...])` into the URL query string. The Windows render agent posts hygiene findings to the same function. Read `AGENTS.md` first.

## 3. What triggered this work

The advisory reviewer (GLM) reviewed merged PR #997 ("split check-changed lookup so long paths don't overflow the URL", merged 2026-11-13, `945ec510`) and opened #998:
1. The 8000 budget counts only `encodeURIComponent("\"path\",")` per value. It omits the fixed part of the address (`/rest/v1/assets?select=…&relative_path=in.(…)&is_deleted=eq.false`, now ~200 bytes with 10 columns) and under-counts encoding (query-string encoding escapes `!'()*` that `encodeURIComponent` leaves, quotes are added only around values with `,()`), so full groups land at roughly 8.2–9.1 KB.
2. The grouping logic is new, inline in a 5,000-line file, and untested.
3. The same overflow class exists in other lookups of the same handler (those lines are gone; see STATUS).

The fixer bot deferred it ("overlapping owner work in PR #842").

## 4. Scope

**In:** one shared grouping helper with tests; `handleCheckChanged` and the hygiene-findings existing-row lookup switched to it; a short written record of the other `.in()` lookups and their bounds.

**NOT in this plan:**
- Moving lookups to POST RPCs or a database function (would need `shared-db` work; rejected §7).
- Changing the 500-file request cap, the bridge preflight retry schedule, or change-detection rules (mtime/size, hi-res backfill).
- Lookups in other edge functions (`admin-api`, `helper-api`) — out of this issue; note any you see on #998.

## 5. Current state of the code (verified 2026-11-25 on `origin/main` `787c20b8`)

- `supabase/functions/agent-api/index.ts:2497` `handleCheckChanged`: caps `files` at 500 (`:2504`); `LOOKUP_URL_BUDGET = 8000` (`:2515`); greedy grouping by `encodeURIComponent(\`"${rp}",\`).length` (`:2516-2529`); runs groups 6 at a time (`LOOKUP_CONCURRENCY`, `:2532`) with `.select("relative_path, filename, modified_at, file_size, quick_hash, thumbnail_url, thumbnail_error, hires_url, width, height").in("relative_path", paths).eq("is_deleted", false)`; any group error returns 500 (`:2543`).
- Bridge caller: `apps/bridge-agent/src/index.ts:1131` `runCheckChangedPreflight` (`apps/bridge-agent/src/check-changed-preflight.ts`) — a failed chunk is retried with `PREFLIGHT_RETRY_DELAYS_MS = [30s, 60s, 120s, 300s, 600s]` (`:36`), then the scan fails; it never widens to "all changed" (#1117).
- `agent-api/index.ts:3206` `handleReportHygieneFindings`: processes findings in `CHUNK = 100` (`:3220`); per chunk, `.in("relative_path", rows.map((r) => r.relative_path)).neq("status", "resolved")` (`:3245-3248`). 100 long paths can exceed the limit the same way (live repro: 200 paths already failed). Paths may repeat across check types (postgrest-js de-duplicates `in` values).
- Other `.in()` lists in `agent-api/index.ts` and their bounds (to record in Step 5): `:1593,1599` ids ≤ 100 (`RETIRE_MISSING_MAX_BATCH`, `:1565`) — 100 UUIDs ≈ 3.9 KB, under budget; `:1670,1681` chunks of `RETIRE_MISSING_CHUNK = 10`; `:2166` ids of claimed render jobs (claim size small — confirm); `:3161` sweep chunks; `:4211` PDF backfill result ids (claim batch 25); `:4746` chunked; `:393,427,444,2080,2215,2415,3052` fixed short key/status lists.
- postgrest-js `in` (pinned version): de-duplicates values, wraps a value in `"…"` only when it contains `,`, `(` or `)`, and appends `in.(v1,v2,…)` through `URLSearchParams`, which percent-encodes everything except letters, digits and `*-._` and turns spaces into `+`. Confirm by reading `PostgrestFilterBuilder` `in()` in the installed package before Step 2.
- No test covers the grouping.

## 6. Key findings

1. The only exact measure is the URL the client will send. The supabase-js query builder exposes it as `builder.url` (a `URL`) **before** the request is awaited, so the edge function can build the query for a candidate group and read `url.href.length` with zero guessing about encoding or the fixed prefix.
2. The real limit was never recorded; the live repro shows 200 long paths already fail. A budget well under 8 KiB with the full URL measured is the safe choice (§8).
3. Since #1117, an overflow costs a stalled, then failed, scan (~18 minutes of retries per chunk) instead of a full reprocess. The fix matters more now, not less.
4. A single path longer than the budget cannot be split; it must go alone in its own group (still sent) and the result stays correct.

## 7. Approaches considered and rejected

- **Just lower `LOOKUP_URL_BUDGET` to ~4000** (reviewer's cheap option). Rejected as the whole fix: still an estimate, still untested, and not reusable for the hygiene lookup. (A lower target is kept — §8.)
- **Send the paths in a POST body via an RPC.** Rejected for this issue: needs a new database function through `popcre/shared-db` (claim-first, preview, promotion) for a problem a client-side split solves.
- **Estimate the encoding by hand** (replicate quoting + `URLSearchParams`). Rejected in favour of measuring `builder.url` (§6.1), which cannot drift when supabase-js is bumped.
- **Fixed-count chunks (e.g. 50 paths).** Rejected: path lengths vary 20–300+ chars; a count is either too small for short paths or unsafe for long ones.

## 8. Design decisions

- **LOCKED (2026-11-25):** split by measured full-URL length; target `MAX_LOOKUP_URL_LENGTH = 6000` bytes (comfortable below 8 KiB for unknown proxy overhead and headers); one shared helper in `supabase/functions/_shared/url-budget-groups.ts`.
- **LOCKED:** results equal one unlimited lookup — every input value appears in exactly one group, order of groups follows input order, duplicates are removed before grouping, an over-long single value is its own group.
- **LOCKED:** keep `LOOKUP_CONCURRENCY = 6` and the "any group error → 500" rule in `handleCheckChanged`; the hygiene lookup keeps its error message.
- **OPEN:** helper signature. Suggested: `groupByUrlLength<T>(values: T[], measure: (group: T[]) => number, maxLength: number): T[][]` (greedy: extend the current group while `measure(group + next) <= maxLength`). Criterion: pure, no Supabase import, so it is unit-testable in Vitest.

## 9. The plan

**Step 1 — Worktree, branch, baseline.** `git worktree add <path> -b claude/998-lookup-url-budget origin/main`; `npm ci`. Read the installed postgrest-js `in()` to confirm §5. Record on #998 the longest 500 relative paths' total length from a read-only Supabase MCP query (`select length(relative_path) from assets where not is_deleted order by 1 desc limit 500`) so the live test in Step 7 uses a realistic share. Gate: numbers recorded. `lead-only` — choosing the realistic baseline.

**Step 2 — Shared helper + tests.** Create `supabase/functions/_shared/url-budget-groups.ts` per §8 and `supabase/functions/_shared/url-budget-groups.test.ts` (root Vitest `supabase/functions/**` project) with the cases in §10. Gate: tests pass. `helper-ok` — signature and cases are fully specified. Stop-and-ask: the greedy rule seems to need anything beyond §8.

**Step 3 — `handleCheckChanged`.** Replace `:2511-2529` with: `const unique = [...new Set(relativePaths)]`; a local `lookup(paths)` that returns the builder `db.from("assets").select(<same columns>).in("relative_path", paths).eq("is_deleted", false)`; `const lookupGroups = groupByUrlLength(unique, (g) => lookup(g).url.href.length, MAX_LOOKUP_URL_LENGTH)`; then the existing concurrency loop awaiting `lookup(paths)`. Keep the comment explaining the 400/414 history and add "measured on the real URL (#998)". Gate: new handler test (§10) green; `deno check` shows no new diagnostics against the `main` baseline. `lead-only` — production change-detection path.

**Step 4 — Hygiene lookup.** In `handleReportHygieneFindings` (`:3245-3248`) group the chunk's unique `relative_path`s with the same helper and query each group, merging `existing` rows before building `existingIds`; any group error returns the existing `hygiene lookup failed: …` 500. Gate: hygiene test (§10) green. `lead-only` — production data writes depend on the match.

**Step 5 — Record the bounded lookups.** Add a short comment above each of `:1593`, `:2166` and `:4211` stating its bound and why it is under the URL budget (e.g. "≤ 100 UUIDs (RETIRE_MISSING_MAX_BATCH) ≈ 3.9 KB — under MAX_LOOKUP_URL_LENGTH"). If any bound turns out to be unbounded or over budget (check `:2166`'s claim size), switch it to the helper too and say so on #998. Gate: each comment names its constant. `helper-ok` for writing comments from the §5 table. Stop-and-ask: a bound cannot be found or exceeds 6000 bytes.

**Step 6 — PR, merge, deploy.** Verified identity; stage only named files; PR to `main` with attribution; wait (`bin/ai-pr-wait` background or `gh pr checks --watch`); merge on required checks. Gate: `deploy-supabase.yml` for the merge SHA green and `agent-api` deployed version updated (Supabase MCP `list_edge_functions` shows a newer version/updated time). `lead-only`.

**Step 7 — Live proof, close.** After deploy, watch the next bridge scan of the share with the longest paths (from Step 1; Decor was the original) in Settings → Bridge Agent / scan logs: preflight completes with no "check-changed failed; retrying this chunk" warning and the changed count is a small fraction of candidates. The scan itself is the proof; no hand-made agent request is needed. Comment on #998 with merge SHA, deploy run id, scan session id and its preflight counts, signed; close; update STATUS. If no long-path scan runs within the session, leave `- [ ] live proof` on #998. `lead-only`.

## 10. Tests required

| Test (file) | Behaviour |
|---|---|
| `url-budget-groups.test.ts` "keeps every value exactly once and in input order" | flattening the groups equals the de-duplicated input |
| "no group's measured length exceeds the limit" | with a measurer that mimics `URLSearchParams` encoding plus a 200-byte prefix, every multi-value group ≤ limit |
| "a single value longer than the limit is its own group" | that value alone; neighbours in other groups |
| "values with ! ' ( ) * , spaces and non-ASCII are measured, not estimated" | the measurer receives them; groups shrink accordingly |
| "empty input returns no groups" | `[]` |
| `supabase/functions/agent-api/check-changed-lookup.test.ts` (or the nearest existing agent-api handler test pattern, e.g. `_shared/agent-update-asset-retry.test.ts`) "500 long paths produce several groups, all under 6000 bytes, and the union of results equals the single-query answer" | fake db builder exposing `url` and returning rows per group |
| "one failing group returns 500" | unchanged error contract |
| hygiene "100 long paths across check types are matched across groups" | existing rows from different groups update, others insert |
| suites | root `npm test`; `deno check supabase/functions/agent-api/index.ts` no new diagnostics |

Adversarial cases (relative paths come from the NAS, outside the repo):

| Input | Hostile case | Test |
|---|---|---|
| relative path | very long (> limit alone) | "a single value longer than the limit is its own group" |
| relative path | `!'()*`, commas, spaces, `%`, quotes, non-ASCII | "…measured, not estimated" |
| path list | duplicates | "keeps every value exactly once and in input order" |
| path list | 500 items of 300 chars | check-changed "500 long paths…" |

## 11. Constraints, standing rules, gotchas

- No database or RPC change; anything structural goes to `popcre/shared-db` (not needed here).
- Never import supabase-js from a URL other than `_shared/supabase-js.ts`; the helper must import nothing from Supabase.
- Vitest cannot load `npm:`/`https:` specifiers — test the helper as pure code and the handlers with fake builders.
- Do not change the bridge or its retry schedule; this is server-only (no bridge version bump).
- Feature branch + PR; the AI merges; reviews advisory. Sign posts ("Posted by <tool> chat (<id>) on <host>"); EST times.

## 12. Access and environment

- `gh` as `u2giants`. Supabase MCP (read-only) on `qsllyeztdwjgirsysgai` for the Step 1 baseline and deploy check.
- Admin tester for Settings → Bridge Agent: 1Password vault `vibe_coding`, item named in `docs/1password.md`.
- Local: `npm ci`, `npm test`, `npx -y deno check supabase/functions/agent-api/index.ts`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Shared helper and tests on `main`; check-changed and hygiene lookups use it; bounded lookups documented.
- [ ] PR merged; `deploy-supabase.yml` green for the merge SHA; `agent-api` redeployed.
- [ ] A long-path scan's preflight completes without retries; evidence on #998; #998 closed (or `- [ ] live proof` left).

Risks and rollback:
- More, smaller groups add a few round trips per 500-file request (6 in parallel) — negligible versus a failed scan. Rollback: revert the PR; edge functions redeploy from `main`.
- `builder.url` is a public field today; a supabase-js bump could rename it. The handler test fails loudly if so (it reads the same field).

Open questions: the §8 OPEN signature only (engineering).

## Self-audit

1. **Fresh session could execute without asking?** Yes — §5 gives every lookup with file:line and bound, §6.1 the exact measuring method, §8 locks limit and invariants, §9 per-step edits and gates, §10 every test, §12 access.
2. **All background carried, including what was ruled out?** Yes — §1/§3 carry the original live repro (200 → 400, 500 → 414) and the #1117 change in failure mode; STATUS records the reviewer's finding-3 lines as gone; §7 lists four rejected approaches.
3. **Goal clear enough to steer by?** Yes — §1: results identical to one lookup, no scan fails for URL length.

## Lead launch prompt

```
Read docs/plans/issue-998-agent-api-lookup-url-budget.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 1, 3, 4, 6 and 7 yourself. Hand Steps 2 and 5 to your helper. Your helper is your
own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX,
Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules: return finished work or an evidenced
blocker; make no design decisions; never merge or post; bring back any stop-and-ask trigger; if stuck 30
minutes, the lead takes the step back. Rules sheet:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Lead checks: all §10 tests green, deno check baseline unchanged, deploy run green, live scan preflight clean.
```
