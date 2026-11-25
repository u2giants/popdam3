---
summary: "Issue #760 plan: admin indexing-health card for three corpora and a bounded requeue button; supersedes PR #758. Read STATUS first."
kind: plan
status: open
read-when: "building the search indexing health card or changing the reset-embedding-errors admin action; resolving #760 or closing PR #758"
---

# Plan: search indexing health card and bounded requeue (u2giants/popdam3#760)

Issue: [#760](https://github.com/u2giants/popdam3/issues/760) — review of [PR #758](https://github.com/u2giants/popdam3/pull/758) "Show indexing health and safely retry recoverable pictures" (branch `codex/vector-pipeline-watchdog`, head `03b82077`, **still open and unmerged**, last updated Nov 5, 2026).
Parent plan: [plan_vector_consolidation.md](../../plan_vector_consolidation.md) Steps 1 (watchdog, "accurate live card" open) and 4 (errored-document reset, "app #758 held"). This plan is the app-side execution of those two rows; where they differ, update the parent's STATUS from this plan's evidence.
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-read the live health function and the admin actions on current main | ⬜ open | |
| 2 | Edge: `embedding-health` admin action | ⬜ open | |
| 3 | Edge: requeue uses the bounded reset with exact arguments | ⬜ open | |
| 4 | Strict parser for health rows | ⬜ open | |
| 5 | Health card in Settings → AI Tagging | ⬜ open | |
| 6 | Close PR #758 as superseded | ⬜ open | |
| 7 | PR, merge, deploy, visual proof, close #760, update parent STATUS | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 2–5 are one PR; step 6 after that PR merges.

---

## 1. The ultimate goal

Search by meaning only works for pictures and catalog text that have been indexed. Today an administrator cannot see, in the app, whether indexing is keeping up or stuck, and the "Requeue terminal errors" button resets every failed document at once. When this plan is done, an administrator opens Settings and sees, for PopDAM pictures, PopSG pages and PopDAM catalog text: how many are waiting, how many failed, when the last one was indexed, and a clear "stalled" warning only when work that *can* be done has not moved for two hours. Requeue retries at most 5,000 recoverable documents per click.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopDAM** (https://dam.designflow.app) — POP Creations' internal licensed-artwork library; **PopSG** (https://sg.designflow.app) — the style-guide library. Repo [u2giants/popdam3](https://github.com/u2giants/popdam3), branch `main` (protected). React + Vite + Tailwind + shadcn in `src/`, served by Coolify; Supabase edge functions in `supabase/functions/` deployed by `deploy-supabase.yml`.
- Indexing: a GPU poller on the edge-dev machine (`apps/image-embed-worker`) writes picture vectors to `public.dam_search_documents` (PopDAM) and `public.style_guide_search_documents` (PopSG) and text vectors to `dam.search_text_vectors`.
- Database (shared Supabase project `qsllyeztdwjgirsysgai`, owned by `popcre/shared-db`; this repo has only a read-only mirror in `shared-db/`):
  - `public.get_search_embedding_health()` → rows `(corpus, pending, errored, last_write, minutes_since_last_write, stale)`; corpora `dam`, `popsg`, `dam_text`. `stale` = pending > 0 and no write for 120 minutes. Pending counts only documents that **can** be claimed (thumbnail present). Granted to `authenticated` and `service_role`; inside it raises 42501 unless service role or `has_role(auth.uid(),'admin')`. Latest body: `shared-db/supabase/migrations/20261204003532_search_embedding_health_fast.sql` (fast rewrite after a 63 s timeout; same signature).
  - `public.reset_dam_search_embedding_errors(p_category text, p_limit integer)` (service_role only) → calls the 3-arg form `(p_category, p_limit, p_document_type)`; resets at most `p_limit` (1–5000) unleased, errored, thumbnail-bearing documents (`20261105073920_search_embedding_health_and_bounded_reset.sql:54-99`).
  - The legacy unbounded `reset_dam_search_embedding_errors(p_document_type text, p_entity_ids uuid[])` still exists (generated types `src/integrations/supabase/types.ts:5463-5466`).

## 3. What triggered this work

DeepSeek review of PR #758 (head `03b82077`, posted as #760):
1. (Blocker) The PR's requeue sent `p_category, p_limit, p_document_type` against a database that then had only the 2-arg legacy signature → PostgREST resolution failure.
2. (Blocker) The card called `get_search_embedding_health`, which did not exist yet; `as never` hid the type error; mounted unconditionally.
3. (Medium) The parser never validated `minutes_since_last_write`.
4. (Medium) The health RPC must count only claimable (thumbnail-bearing) documents as pending, or `stale` stays true forever; the parser required exactly two rows. (Remainder of the review was truncated by the reviewer.)

PR #758 was never merged, so none of these defects is live. The database pieces it needed have since landed (§2). The useful feature is still missing from `main`.

## 4. Scope

In: a health card and a bounded requeue on current `main`, meeting every #760 finding; closing PR #758.

### NOT in this plan
- Any database change (all needed functions exist). If one is needed, stop and open it in `popcre/shared-db`.
- A PopSG or text-lane requeue button (no bounded SG/text reset exists for the app; add later only with its own shared-db function).
- The alarm path (Production Canary, alert issue, outside-hours drill) — parent plan Step 1.
- The existing `SearchIndexCard` coverage numbers (`embedding-status` action) — keep as is.
- The README/plan edits PR #758 carried (`apps/image-embed-worker/README.md`, `plan_vector_consolidation.md`); re-derive only what is still true when updating parent STATUS in step 7.

## 5. Current state of the code (origin/main `787c20b8`)

- `src/components/settings/SearchIndexCard.tsx`: calls `dam-search-ai` actions `embedding-status` (`:~24`) and `reset-embedding-errors` (`:~34`, button "Requeue terminal errors", toast "Could not requeue terminal search documents" on failure). Mounted in `src/components/settings/AiTaggingTab.tsx:102`.
- `supabase/functions/dam-search-ai/index.ts:563-569` `embedding-status` (admin-only, service client, `get_dam_search_embedding_status`).
- `index.ts:571-579` `reset-embedding-errors` (admin-only) calls the **legacy unbounded** form `{p_document_type, p_entity_ids: null}` — every errored document in one call.
- No health card, parser or test exists on `main` (`grep -rn "get_search_embedding_health" src supabase/functions` finds only generated types).
- PR #758 files (for reference only, do not merge): `src/components/settings/diagnostics/SearchEmbeddingHealthCard.tsx`, `src/lib/search-embedding-health.ts`, `src/test/search-embedding-health.test.ts`, a 2-line change in `index.ts`, `AiTaggingTab.tsx`.

## 6. Key findings and root cause

- The PR was written ahead of its database dependency and then parked when that dependency landed in a different shape (3 corpora, two reset overloads). Rebasing it would carry the stale two-row assumption; rebuilding on `main` is smaller and cleaner.
- Today's live risk is the unbounded requeue: one click can reset thousands of documents and flood the queue — the reason the bounded function was created (parent plan §"Reset RPC floods the queue").

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Rebase and merge PR #758 | Its parser hard-codes two rows and its RPC call shape predates the landed functions; every file needs rewriting anyway. |
| Call `get_search_embedding_health` directly from the browser | Allowed by grants, but the edge action keeps one admin check, one error shape and lets tests mock a single fetch path, matching `embedding-status`. Judgment recorded; either works. |
| Keep the legacy unbounded reset as the default | Floods the queue; parent plan requires the bounded path. |
| Hide the card when the RPC errors | Hides real outages. Show "Health unavailable" with the error kind, and a Retry. |

## 8. Design decisions

- **LOCKED** (parent plan Step 4, shared-db #5719): reset is bounded to ≤ 5,000 per call, service role only, never touches leased or thumbnail-less documents.
- **LOCKED** (health function): `stale` comes from the database; the app never recomputes it.
- **LOCKED here:** requeue sends exactly `{ p_category: "permanent" | null, p_limit: 5000 }` to the 2-arg overload. Default category `null` (all categories) to keep today's button meaning, but bounded. The button label becomes "Requeue up to 5,000 failed pictures".
- **LOCKED here:** the parser accepts 1–N rows keyed by corpus; it shows known corpora (`dam` "PopDAM pictures", `popsg` "PopSG pages", `dam_text` "PopDAM catalog text") and ignores unknown corpora with a console warning.
- **OPEN:** exact card layout (follow existing `SearchIndexCard` styling; shadcn `Card`, `Badge`).

## 9. The plan

### Step 1 — Re-read live contracts (`lead-only`: decides argument shapes)
On fresh `origin/main` re-read `shared-db/supabase/migrations/` for the newest `get_search_embedding_health` and both `reset_dam_search_embedding_errors` overloads (`grep -rln` then open the newest). If the signatures differ from §2, update §8 before coding.
**Gate:** §2 citations confirmed or corrected in this file.

### Step 2 — `embedding-health` action (`helper-ok`)
In `dam-search-ai/index.ts` beside `embedding-status` (`:563`): `if (action === "embedding-health") { if (!auth.admin) return err("Admin authorization required", 403); const { data, error } = await serviceClient().rpc("get_search_embedding_health"); if (error) { console.error("search embedding health failed", error.message); return err("Health unavailable", 503); } return json({ ok: true, health: data }); }`. Regenerate nothing by hand: `get_search_embedding_health` is in generated types (`types.ts`); no `as never`.
**Gate:** edge test "embedding-health returns rows for an admin and 403 for a non-admin" passes.
**Stop-and-ask trigger:** if the function is missing from generated types.

### Step 3 — Bounded requeue (`lead-only`: changes a production write path)
Replace `index.ts:571-579` body: validate `body.category` ∈ {`"permanent"`, `"transient"`, undefined}; call `rpc("reset_dam_search_embedding_errors", { p_category: category ?? null, p_limit: 5000 })`; return `{ ok: true, reset: data, limit: 5000 }`. Reject any other category with 400. Do not send `p_document_type` or `p_entity_ids` (PostgREST picks the overload by argument names; sending exactly these two selects the 2-arg form).
**Gate:** edge tests "requeue calls the bounded reset with exactly p_category and p_limit" and "requeue rejects an unknown category" pass; a read-only `select pg_get_function_identity_arguments(oid) from pg_proc where proname='reset_dam_search_embedding_errors'` (Supabase MCP or psql) lists `p_category text, p_limit integer`.

### Step 4 — Strict parser (`helper-ok`)
New `src/lib/search-embedding-health.ts`: `export interface SearchEmbeddingHealth { corpus: string; pending: number; errored: number; last_write: string | null; minutes_since_last_write: number | null; stale: boolean }` and `parseSearchEmbeddingHealth(value: unknown): SearchEmbeddingHealth[] | null` — null unless an array of ≥1 objects where `corpus` is a non-empty string, `pending`/`errored` are finite non-negative numbers (accept numeric strings from bigint, convert), `last_write` is null or a parseable ISO string, `minutes_since_last_write` is null or a finite non-negative number, `stale` is boolean. No casts of unverified data.
**Gate:** `src/test/search-embedding-health.test.ts` cases in §10 pass.

### Step 5 — Health card (`helper-ok`; visual check is the lead's)
New `src/components/settings/diagnostics/SearchEmbeddingHealthCard.tsx` mounted in `AiTaggingTab.tsx` next to `SearchIndexCard` (`:102`). Calls `supabase.functions.invoke("dam-search-ai", { body: { action: "embedding-health" } })` with React Query (`useQuery`, key `["search-embedding-health"]`, refetch every 60 s while visible). One row per known corpus: label, waiting, failed, "last indexed <relative time> (<EST time>)" or "never", and a red "Stalled — no progress for over 2 hours" badge only when `stale`. Error state: "Search health is unavailable" + Retry button (never silently hidden). Update `SearchIndexCard`'s requeue button label/toast to the bounded wording and show `reset` count in the success toast.
**Gate:** `src/test/SearchEmbeddingHealthCard.test.tsx` passes; lead screenshots the card on a local `npm run dev` against production read data (admin login) and on production after deploy.
**Stop-and-ask trigger:** any design choice beyond "match `SearchIndexCard` styling".

### Step 6 — Close PR #758 (`lead-only`: outward-facing)
After step 7's merge, comment on PR #758: superseded by the new PR (link), list which #760 findings each change answers, sign with the session signature, and close it (not delete the branch unless it has no other referrers — leave it).
**Gate:** PR #758 state CLOSED with the comment.

### Step 7 — Land and prove (`lead-only`)
Branch `claude/search-health-card-760`; PR body "Fixes #760"; merge when required checks pass. Verify `deploy-supabase.yml` deployed `dam-search-ai` and `publish-frontend.yml` → Coolify served the merge SHA (stale-site check in `docs/deployment.md`). Visual proof on https://dam.designflow.app Settings → AI Tagging as an admin: card shows three corpora with plausible numbers (cross-check with read-only `select * from public.get_search_embedding_health()`). Do **not** click Requeue for proof unless `errored > 0` for `dam` and the parent plan's Step 4 owner agrees it is wanted; if clicked, record the returned count (≤ 5,000) and that pending rose by that count. Screenshot stays private if it shows licensed thumbnails (this card shows none). Comment on #760 with SHA, deploy run ids and the screenshot; close #760. Update `plan_vector_consolidation.md` STATUS rows 1 ("accurate live card") and 4 ("app #758") with this evidence.
**Gate:** #760 closed; parent STATUS rows updated in the same or a follow-up PR.

## 10. Tests required

- `src/test/search-embedding-health.test.ts`: accepts three valid rows; accepts numeric strings for counts; rejects missing `minutes_since_last_write`; rejects negative or non-finite numbers; rejects non-boolean `stale`; rejects empty array; ignores (keeps) an unknown corpus row without failing.
- `src/test/SearchEmbeddingHealthCard.test.tsx`: renders three labelled rows; shows "Stalled" only for `stale: true`; shows unavailable + Retry on error; Retry refetches.
- `supabase/functions/dam-search-ai/index.test.ts`: "embedding-health returns rows for an admin and 403 for a non-admin"; "embedding-health answers 503 when the function errors"; "requeue calls the bounded reset with exactly p_category and p_limit"; "requeue rejects an unknown category".
- Must stay green: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`.

## 11. Constraints, standing rules and gotchas

- No DDL in this repo; never hand-edit `src/integrations/supabase/types.ts`.
- The health function is admin-gated inside the database; still check `auth.admin` in the edge action.
- Requeue writes production data (clears error marks); it is an existing admin capability, now bounded. Never run it as part of testing without a reason.
- UI work needs visual verification (screenshot), not just tests.
- Times shown to people in EST/EDT (`America/New_York`).
- Branch + PR; AI merges; reviews advisory.

## 12. Access and environment

- `gh` as `u2giants`; Node 20+, `npm ci`; `npm run dev` for local UI (env per `docs/development.md`).
- Admin test login for https://dam.designflow.app: 1Password vault `vibe_coding`, the PopDAM admin tester item (search "PopDAM admin"); never print it.
- Read-only SQL: Supabase MCP `execute_sql` on `qsllyeztdwjgirsysgai` (token required), or `psql` with the read DSN from 1Password `vibe_coding`.

## 13. Definition of done, risks and open questions

- [ ] Steps 2–5 merged (SHA); all §10 tests green in CI.
- [ ] Edge and frontend deployed from that SHA (run ids; served-SHA check).
- [ ] Admin screenshot of the card on production; numbers match the SQL read.
- [ ] PR #758 closed as superseded.
- [ ] #760 closed with evidence; parent plan STATUS rows 1 and 4 updated.

Risks: health function slowness (it timed out once at 63 s before the fast rewrite) → card shows "unavailable"; acceptable and visible. Rollback: revert the PR (requeue returns to unbounded — note that in the revert PR).
Open: layout details only.

## Self-audit (Mode A)

1. *Fresh session could execute without asking?* Yes — §2 explains the app, the three corpora and both reset overloads with migration paths; §5 shows today's code including the unbounded reset; §9 gives exact edits, argument shapes and gates; §12 access.
2. *All background including rejected paths?* Yes — §3 the review and that PR #758 never merged; §6 why rebuild beats rebase; §7 rejected options.
3. *Goal clear for judgment?* Yes — §1 in admin terms; §8 locks bounded reset and DB-owned `stale`.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issue #760. Read AGENTS.md, docs/plans/issue-760-search-index-health-card-and-bounded-requeue.md (STATUS first), plan_vector_consolidation.md STATUS rows 1 and 4, and HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md. Work in your own worktree from origin/main.
You do steps 1, 3, 6 and 7 and the visual checks. Hand steps 2, 4 and 5 to your helper in that order; review each diff.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes to main or GitHub posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Checks you run yourself: lint, typecheck, test, build, deno check, the overload read in SQL, deploy/served-SHA checks and an admin screenshot on production.
```
