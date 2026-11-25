---
summary: Issue #767 plan: PR #764 leftovers (OpenRouter lookup skip, export image guard, prune back-off). Read its STATUS first.
kind: plan
status: open
read-when: implementing #767, or changing OpenRouter provider attribution, sell-through Excel export thumbnails, or the agent-api heartbeat prune
---

# Plan: Finish the "same results, less work" change from PR #764 (u2giants/popdam3#767)

Issue: https://github.com/u2giants/popdam3/issues/767 (review finding on merged PR #764, reviewer muse)
Handoff: [HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md](../../HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md)
Written 2026-11-25 (about 4:00 PM EST) by Claude. Plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Finding 1 (SkeletonCard syntax error) | ✅ already fixed | `src/components/library/StyleGroupGrid.tsx:514-550` closes with `}`; `npm run typecheck` passes on `main` (CI run for `787c20b8`) |
| 1 | OpenRouter: look up the generation unless provider AND endpoint are known | ⬜ open | `apps/worker/src/openrouter.ts:477` |
| 2 | Sell-through export: a missing image entry becomes a recorded failure, not a crash | ⬜ open | `src/lib/sell-through-export.ts:316-345` |
| 3 | Heartbeat prune: back off after a failure instead of retrying every heartbeat | ⬜ open | `supabase/functions/agent-api/index.ts:419-433` |
| 4 | Tests (§10), PR, CI, merge, deploy check | ⬜ open | |
| 5 | Live proof on #767, close | ⬜ open | `- [ ] live proof` stays on #767 |

**Where a fresh session starts:** Step 1. Steps 1–3 are independent and touch different files.

---

## 1. The ultimate goal

PR #764 was meant to make PopDAM do less repeated work **without changing any result**. Three spots either changed a result (AI model audit records lose which endpoint served a call), can crash an export instead of reporting one bad picture, or keep hammering the database during an outage. Done means: same results as before #764, the export never crashes on a bad thumbnail, and an outage does not turn every agent heartbeat into a delete query.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager (web UI `https://dam.designflow.app`, React in `src/`). Relevant parts:
- **Railway cloud worker** (`apps/worker/`, Node/TS) runs AI tagging and other bulk jobs; it calls OpenRouter (an AI model router) via `apps/worker/src/openrouter.ts` and records which provider/endpoint served each call for audit and the model bake-off (`apps/worker/src/handlers/ai-tag-bakeoff.ts`).
- **Sell-through export** (`src/lib/sell-through-export.ts`): browser-side Excel export (ExcelJS) that embeds a thumbnail per matched SKU row.
- **agent-api** (`supabase/functions/agent-api/index.ts`, Supabase edge function): the heartbeat handler also prunes old finished `render_queue` rows.
Repo `u2giants/popdam3`; protected `main`; worker auto-deploys on `apps/worker/**` merges; edge functions deploy via `deploy-supabase.yml`; frontend via `publish-frontend.yml`.

## 3. What triggered this work

Advisory review of PR #764 (merged 2026-11-05, ai-review run 41968606249). Four findings; the review-fixer deferred them because the PR was closed.
1. `SkeletonCard` closed with `});` — **already fixed** on `main` (STATUS row 0).
2. `openrouter.ts:477` `if (!info.generationId || info.provider || info.endpoint) return info;` skips the generation lookup when **either** is known, so a response that carries only the provider header now records `endpoint: null` (and loses `upstreamId`/`upstreamStatus`). Before #764 the lookup ran and filled them.
3. `sell-through-export.ts:319-345` parallel fetch uses a shared `nextUrl` counter and `images.get(url)!`. Correct today, but any future path that leaves a URL unset throws `TypeError` and kills the whole export instead of recording a `ThumbnailFetchFailure` (what the old per-row `try/catch` did).
4. `agent-api/index.ts:1,419-433` hourly prune throttle `lastRenderPruneAt` is per warm isolate; on failure it resets to `0`, so during a database outage every heartbeat retries the delete.

## 4. Scope

In: findings 2, 3, 4 as above; their tests.
NOT in this plan: a true global once-per-hour prune (would need shared state or a cron — rejected in §7); any other OpenRouter routing change (the `STRAITLY_ROUTING` work in #1365 is separate); export layout changes; the SkeletonCard (done).

## 5. Current state of the code

- `apps/worker/src/openrouter.ts:400-462` `collectProviderInfo` fills provider/endpoint/model from headers, body, router metadata. `:476-500` `enrichProviderInfo` fetches `OPENROUTER_GENERATION_URL?id=…` and fills missing provider, endpoint, model, plus `upstreamId`, `upstreamStatus`. Called at `:534`.
- `apps/worker/src/openrouter.test.ts:158-173` "known provider metadata avoids a second generation lookup" asserts **one** fetch when only `x-openrouter-provider` is present — this test encodes the bug and must change.
- `src/lib/sell-through-export.ts:316-345`: dedupe URLs, 4 workers, `images: Map<url, {id}|{error}>`, then per row `images.get(url)!`.
- `supabase/functions/agent-api/index.ts:1` `let lastRenderPruneAt = 0;` `:419-433` prune block inside the heartbeat `Promise.all`.

## 6. Key findings

- The reviewer's alternative ("require both provider && endpoint") restores the pre-#764 result whenever endpoint was missing, and still saves the call when both are known (the common case with router metadata). `model` is almost always present from `body.model`, so it need not be part of the condition. `upstreamId/upstreamStatus` come only from the lookup; losing them when provider+endpoint are known was accepted by #764 and is kept (they are diagnostics, not used in decisions — `grep -rn upstreamId apps/worker/src` shows only openrouter.ts and tests).
- The shared counter is safe in JS (single thread; `nextUrl++` is synchronous between awaits). The risk is only the non-null assertion.
- A prune failure during an outage costs one extra failing query per heartbeat per isolate; harmless but noisy. A fixed retry back-off (5 minutes) keeps hourly pruning and stops the storm.

## 7. Approaches rejected

- Reverting #764's skip entirely (always look up): doubles OpenRouter calls for every tagged image again; #764's point was to avoid that.
- Global prune throttle via `admin_config` timestamp or a pg_cron job: extra moving parts for a harmless idempotent delete. Per-isolate throttle stays (reviewer called it acceptable).
- Rewriting the export fetch with a library pool: unnecessary; a guard is enough.

## 8. Design decisions

Locked (2026-11-25): skip the lookup only when `generationId` is absent or **both** `provider` and `endpoint` are known; per-isolate prune throttle stays; prune failure retries after 5 minutes, not immediately; a missing map entry is reported as `ThumbnailFetchFailure` with reason `"thumbnail not fetched"`.
Open: none.

## 9. The plan

**Step 1 — OpenRouter condition (helper-ok: one-line edit + named tests).**
`apps/worker/src/openrouter.ts:477` → `if (!info.generationId || (info.provider && info.endpoint)) return info;`. Update the comment above the function: "Skip the lookup only when both provider and endpoint are already known."
Tests in `apps/worker/src/openrouter.test.ts`: change the existing test at `:158` to send both `x-openrouter-provider` and `x-openrouter-endpoint` and keep `calls === 1`; add "provider-only response still looks up the endpoint": first fetch returns provider header only, second (generation URL) returns `{ data: { endpoint_name: "ep-1", upstream_id: "u-1" } }`; assert `providerInfo.endpoint === "ep-1"` and `calls === 2`.
Gate: `npm test --prefix apps/worker` green.
Stop-and-ask: if another test asserts single-call behaviour with provider-only metadata, bring it back.

**Step 2 — Export guard (helper-ok).**
`src/lib/sell-through-export.ts` around `:335`: replace `const image = images.get(url)!;` with `const image = images.get(url) ?? { error: "thumbnail not fetched" };`. Keep everything else.
Test in `src/test/sell-through-export.test.ts`: make `fetchThumbnail` (or the mocked fetch) succeed for one URL and throw for another; assert the export resolves, one image is added, and `thumbnailFailures` contains the failing SKU. (Existing test from #764 covers dedup; add this case.)
Gate: `npx vitest run src/test/sell-through-export.test.ts` green.
Stop-and-ask: if the function signature does not expose `thumbnailFailures` to the test, bring it back rather than changing the API.

**Step 3 — Prune back-off (helper-ok).**
`supabase/functions/agent-api/index.ts:430-432`: on failure set `lastRenderPruneAt = now - 3_600_000 + 300_000;` (retry in 5 minutes) instead of `0`; name the constants `RENDER_PRUNE_INTERVAL_MS = 3_600_000` and `RENDER_PRUNE_RETRY_MS = 300_000` next to `lastRenderPruneAt` at line 1 and use them in `:422`. Comment: "per warm isolate; a failure retries after 5 minutes, never on every heartbeat."
Gate: `deno check supabase/functions/agent-api/index.ts` (or root `npm run typecheck` if it covers edge functions) and root `npm test` green. Logic is small enough that a unit test is optional; if extracted to `_shared/render-prune-throttle.ts`, add a test: failure at t → no attempt at t+1 min, attempt at t+5 min.
Stop-and-ask: none beyond a failing type check.

**Step 4 — PR and deploy (lead-only).** One PR with steps 1–3. CI green, merge. Confirm the worker redeployed on Railway (deployment for the merge SHA) and `deploy-supabase.yml` succeeded for agent-api, and the frontend publish succeeded (live-version check in `publish-frontend.yml`).

**Step 5 — Live proof (lead-only).** (a) After the next AI tagging batch, query recent model-usage/audit rows written by the worker (the table the bake-off/tagging writes provider info to — find via `grep -rn "providerInfo" apps/worker/src/handlers`) and show rows with a non-null endpoint where the provider header alone was present. (b) Run one sell-through export in the web UI and confirm it downloads. Post on #767, close.

## 10. Tests required

- `apps/worker/src/openrouter.test.ts`: updated "known provider metadata…" (both headers), new "provider-only response still looks up the endpoint".
- `src/test/sell-through-export.test.ts`: new "one failed thumbnail is reported, export still completes".
- Optional `supabase/functions/_shared/render-prune-throttle.test.ts` if extracted.
Must stay green: `npm test --prefix apps/worker`, root `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## 11. Constraints and gotchas

Feature branch + PR to protected `main`; AI merges; reviews advisory. Do not touch OpenRouter routing (`STRAITLY_ROUTING`, #1365). No schema change. No hold or retry delay over 30 minutes (5 minutes chosen). Quote times in EST.

## 12. Access and environment

`gh` as `u2giants`. Railway MCP/CLI for worker deploy status. Supabase read-only SQL via the Supabase access token in 1Password vault `vibe_coding` (search "Supabase access token"). Web UI login: your own PopDAM account (Google SSO).

## 13. Definition of done, risks, open questions

Done: three fixes merged, CI green, worker/edge/frontend deploys confirmed for the merge SHA, live proof on #767, closed.
Risks: one extra OpenRouter generation lookup for provider-only responses (the pre-#764 cost, only for those responses). Rollback: revert the PR.
Open questions: none.

## Self-audit (2026-11-25)

1. Fresh session can execute without asking? Yes — §3/§5 give exact lines and current behaviour, §9 exact edits and tests.
2. All background incl. rejected options? Yes — §6 explains why each fix is enough, §7 lists rejected alternatives, STATUS row 0 records the already-fixed finding.
3. Goal clear for judgment? Yes — §1 "same results, less work", export never crashes, no outage storm.
Checklist passes: 13 sections, lead/helper marks with triggers, no trust-boundary input added, locked decisions labelled, out-of-scope list, named tests, secrets by location, handoff linked both ways.

## Lead launch prompt

```text
You are the lead implementing u2giants/popdam3#767. Read AGENTS.md, then docs/plans/issue-767-efficiency-change-leftovers.md (STATUS first). Fresh worktree, feature branch from origin/main.
Hand steps 1, 2 and 3 to your helper (they are independent). Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges or posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
You do steps 4 and 5 and re-run every gate yourself (worker tests, root tests, typecheck, lint, build, CI). Update STATUS as steps land; sign GitHub posts.
```
