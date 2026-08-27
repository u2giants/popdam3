---
issue: 96
status: OPEN
owner: claude/scoped-ai-metadata-steps-8-10-96
---

# HANDOFF — Scoped AI metadata: Steps 4-6 done, Step 7 half done, 8-10 open (2026-08-27, hetz/claude)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**One decision is open, and it blocks all remaining work.**

1. **Albert must approve starting the Step 8 production pilot.** It runs AI group profiling and per-file tagging across 20–50 real Style Groups of licensed artwork in production, and it ends in a human pass/fail judgement on whether the resulting metadata is actually correct. Recommendation: approve it once shared-db #1645 lands, because the pilot's own scorecard includes "search finds all members via group terms", which cannot pass until that filtering contract exists. Blocks Steps 8, 9, and 10 — that is the entire remainder of issue #96.

Nothing else needs him. Already settled — do **not** re-ask:

- 2026-08-24: product/SKU facts live once on the Style Group; file-visible facts live on the asset; search and display combine them without copying group rows onto members.
- 2026-08-24: manual and authoritative facts outrank AI; rejected AI facts persist as tombstones; legacy propagation becomes a safe group refresh and is never removed.
- Standing: all shared database structure is governed through `u2giants/shared-db`; PopDAM never adds app-side DDL and never runs direct production SQL.
- 2026-08-27 (engineering calls, recorded so they are not relitigated): a group with no usable representative image is left completely untouched rather than being given its authoritative row; profile eligibility is decided by `group_ai_description_source`, never by `group_ai_tagged_at`; group edits and every AI-suggestion review decision require an admin role.

## 1. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product artwork. Designers and sales staff browse source art, mockups, photographs, renders, and technical documents grouped by SKU into "Style Groups".

- Repository `u2giants/popdam3` at `/worksp/popdam`. App code is trunk-based, direct to `main`.
- Frontend: React/Vite in `src/`, deployed to Coolify at `https://dam.designflow.app`.
- Sibling mode PopSG at `https://sg.designflow.app` shares the image; its semantics must not change.
- Persistent worker `apps/worker/` on Railway, redeployed on every push to `main`. All long bulk jobs run there.
- Edge functions in `supabase/functions/`, deployed by GitHub Actions.
- Shared Supabase project `qsllyeztdwjgirsysgai`. Canonical structural work belongs to `u2giants/shared-db` at `/worksp/shared-db`.

The complete brief and phase gates are in `plan_style_group_scoped_ai_metadata.md`. GitHub issue [#96](https://github.com/u2giants/popdam3/issues/96) is the completion authority and is still OPEN.

## 2. What we set out to do this session, and why

Continue from Step 4 and complete as many downstream steps as could be finished correctly, running each past an independent reviewer.

Business outcome: a file should be findable by the product facts its Style Group shares — licensor, property, product type, item description, artwork theme — without inheriting false facts from a sibling. Before this work, one "primary" image's tags were copied onto every file in the group, so a technical drawing could be tagged "photograph, front view, pastel pink".

## 3. Current state — what is true right now

Steps 1–6 are complete. Step 7 is half complete. Steps 8–10 are open.

**Landed and deployed this session:**

| Commit on `main` | What |
|---|---|
| `08c80234` | Step 4 — the Style Group profile pass (`ai-tag-group-profiles`) |
| `72b07e23` | Steps 5–6 — asset-only file tagging proven; propagation replaced by safe group refresh |
| `3f04d22e` | Test fix: the legacy-caller grep matched its own test files once committed |
| `70e0f8d2` | Step 7 application half — scoped metadata UI, scoped write contract, admin gating |

All CI green on each exact SHA. Railway deployments containing `08c80234`, `3f04d22e`, and `70e0f8d2` reported success. The live frontend HTML at `dam.designflow.app` contains the commit stamp `70e0f8d`, proving the UI half is live.

**What works now, in plain terms:** every file shows two sections — shared Style Group facts and its own file facts. Suggestions are separated from confirmed facts. Removing an AI fact remembers the rejection so a rerun cannot bring it back. Master Data facts cannot be edited away in the panel. Group edits and review decisions require an admin. Nothing copies tags between files any more.

**What is NOT done in Step 7:** effective-tag filtering and grouped-identity filtering, with facet-count parity and the cold 8-second ceiling. `src/hooks/useAssets.ts` still filters `assets.tags @> [tag]` and `assets.licensor_id` / `property_id` directly. Group tags are deliberately absent from `assets.tags`, so `@>` structurally cannot express a shared product tag; and since propagation was removed, nothing null-fills sibling identity, so those filters now miss grouped assets. Requested as **[`u2giants/shared-db#1645`](https://github.com/u2giants/shared-db/issues/1645)**.

**Independent reviews (GLM 5.3, session `scoped-ai-step56-review`):** Step 4 APPROVE; Step 5 REVISE then accepted; Step 6 REVISE then APPROVE; Step 7 application half REVISE then APPROVE. Reports are in `.ai/reviews/`.

**Checkout state:** work was done in the linked worktree `/worksp/popdam/.claude/worktrees/style-group-scoped-ai-step4-18b6f6` on branch `claude/style-group-scoped-ai-step4-18b6f6`, then landed on `main`. `node_modules/` was installed in that worktree at both the root and `apps/worker` (both gitignored). The unrelated untracked `.claude/` directory in the main checkout was never inspected, staged, changed, or deleted — **preserve it**.

## 4. Everything we tried that did NOT work

- **A grep guard that passed locally and failed in CI.** The test proving no production path calls the deleted tag-propagation helper used `git grep`, which searches tracked content. It passed while its own test files were untracked, then matched its own assertion text once committed. Fixed by excluding `*.test.ts` / `*.test.tsx`, and re-proved non-vacuous by grepping a symbol that does exist in production. **Any grep-based guard must be checked after committing, not before.**
- **Contract assertions pinned to a superseded migration.** Tests asserted the asset writer's semantics against `20260825082910`, but `20260825165139` had replaced that function and deliberately dropped the model terms being asserted. The test could never fail. Fixed by `apps/worker/src/handlers/live-migration-contract.ts`, which resolves the newest migration defining a function. **Never hard-code a migration filename in a contract test.**
- **A review run while the working tree was being edited.** `ai-glm ask` snapshots `git status` before and after and failed the session as "review mode must be read-only". Nothing was lost — the diff was entirely my own in-flight work. **Do not edit during a review turn.** The failed session had to be `ai-glm delete`d before the name could be reused.
- **`ai-glm doctor` reporting `FAIL health endpoint answers`** while `ai-glm server start` claimed success. The running server held a stale password; the credential file had since changed. `ai-glm server restart` fixed it. Do NOT report this as a GLM or provider outage.
- **A fresh worktree cannot run `npm run build`** until `npm ci` is run at the root AND in `apps/worker`. Vitest resolves from the parent checkout; vite does not.
- **Test fixture arithmetic.** Proving budget exhaustion with equal-sized images is impossible once a per-image cap of 25% exists — four equal images always fit. Also, base64 padding makes a 1024-byte body measure 1026 decoded bytes, so a ceiling of exactly 4096 rejects everything.
- **A pre-existing flake made worse.** The OrderList AG Grid assertions used `waitFor`'s 1s default and began failing intermittently as the suite grew. Raised to 10s; three consecutive full runs green. GLM confirmed this masks nothing. If that suite ever legitimately approaches 10s, split the file rather than raise again.
- **Reviewer state carried forward:** Grok holds a retained failed lock, Kimi failed without a verdict (incident `/worksp/ai-devops/.ai/reviewer-issues/20260826T123006Z-hetz-kimi-1406692`), Gemini doctor returns `QUARANTINED`. **GLM is the only reviewer proven to complete on this workstream.**
- **The Supabase CLI shim.** `/usr/local/bin/supabase` is a shim; the supported binary is `/home/ai/.local/share/supabase/supabase-go`. A shim error is not a credential or Supabase outage.

## 5. Root causes and key findings

- **The governed group writer sets `source = p_source` on every row and always overwrites `group_ai_description*`** (`shared-db/supabase/migrations/20260825082910_...sql:2585`). That is why the profile pass calls `replace_style_group_ai_profile` twice per group — `authoritative` first, then `group_ai`, both carrying the same final description, so a failure between them can never blank a group.
- **That RPC stamps `group_ai_tagged_at` unconditionally.** Two consequences, both load-bearing: a group with no usable image is written **not at all** (`ai-style-group-profile.ts`), and profile eligibility keys off `group_ai_description_source`, never the timestamp. Keying off the timestamp would let one bulk refresh silently exclude most of the library from ever being profiled — the reviewer caught exactly that.
- **A soft-deleted asset keeps its thumbnail in Spaces**, so `defaultFetchMembers` must filter `is_deleted = false` or a deleted file becomes a representative and counts toward the two-evidence promotion rule.
- **The live asset writer is `20260825165139`**, whose DELETE is scoped by source but NOT by model — so changing vision model still supersedes the previous run's rows. Its upsert guard also carries `status in ('active','candidate')`, which is the tombstone protection.
- **Operation definitions are duplicated in five places** — `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts`, `src/components/settings/diagnostics/types.ts`, plus the cursor validators in `apps/worker/src/operation-retry.ts` (worker auto-resume) and `src/hooks/usePersistentOperation.ts` (UI resume). `src/test/operation-registry-sync.test.ts` fails on drift or asymmetry.
- **The Railway image loads the VENDOR copies** under `apps/worker/vendor/`, not the repo canonical. Tests import the canonical, so vendor rot would ship green — `src/test/worker-group-contract-sync.test.ts` byte-compares both contract and policy mirrors.
- **`assets.tags` is asset-only by design.** Its trigger builds from `asset_tags` where `status = 'active'`; group tags are never appended and rejected rows are excluded. This is why the tag filter cannot be fixed app-side.
- **`asset_tags.evidence` is a JSONB array; `style_group_tags.evidence` is an object.** Review provenance is nested as `{ review: {...}, prior: <original> }` rather than spread, or an array would persist as `{"0": ...}`.
- **There is no `reviewed_by` column** on either tag table. Review audit lives in `evidence`; do not invent a column app-side.

## 6. Exact next steps

1. Read `AGENTS.md`, then the STATUS table in `plan_style_group_scoped_ai_metadata.md`, then §9 Steps 7–10. Run `git status --short` before editing and preserve the unrelated `.claude/` directory. **You'll know it worked when** the checkout is current and only known unrelated files are present. Do not re-derive Steps 1–6.
2. Check `u2giants/shared-db#1645`. If it has not been picked up, re-resolve the orchestrator (do NOT reuse the route in §8 — a handover changes it) and re-route. **You'll know it worked when** the issue is assigned to a lane or an orchestrator has replied on it.
3. When the contract lands, wire it: replace `assets.tags @> [tag]` at `src/hooks/useAssets.ts:207` and the identity filters at `:190-195`, regenerate database types, and add the parity tests the plan's §10 requires — group-term versus asset-term matching, facet-count parity, and a cold `authenticated` performance check with headroom stated. **You'll know it worked when** filtering by a tag that exists only on the Style Group returns every member, filtering by a file-only tag returns one file, counts equal the list total, and every path finishes under 8 seconds cold.
4. Put the section-0 decision to Albert in one message, then run Step 8 exactly as written in §9: prove the database target before every write, backfill in the governed order, pick 20–50 groups covering the listed variety, run group profiling then per-file tagging, and store a before/after manifest in protected operational evidence. **You'll know it worked when** `verification/ai-tagging-scope/<UTC>/pilot-summary.md` cites the deployed SHA, target proof, operation IDs, aggregate before/after queries, and every scorecard result, with 100% on manual preservation, identity preservation, and zero cross-file leakage.
5. Only after pilot acceptance, run Step 9 rollout in resumable batches with the monitoring listed in §9, then Step 10 documentation and issue closure. **You'll know it worked when** CI, Railway, and the live frontend SHA all agree, production aggregates reconcile, and issue #96 closes with exact evidence.
6. Retire this handoff under the successor rule once Step 8 lands, and retire `HANDOFF.d/2026-08-24T1402Z-hetz-codex-scoped-ai-metadata-plan.md` in the Step 10 completion commit as §9 Step 10 requires.

## 7. Constraints and gotchas in force

- PopDAM app work lands directly on `main`. Shared database structure always goes through the `u2giants/shared-db` orchestrator: branch, PR, preview, production apply. Never add app-side DDL, never create files under this repo's `supabase/migrations/`, never edit the vendored `shared-db/` mirror.
- Pushes are frequently rejected as non-fast-forward because automated `chore: sync shared-db` commits land often. Rebase with `git rebase --autostash origin/main`, confirm the worktree came back unchanged, push again. **Never force-push, broad-reset, or revert files you did not modify.**
- Do not edit generated `src/integrations/supabase/types.ts`; automated type generation owns it.
- Keep group rows physically on Style Groups. Never append group tags to `assets.tags`, never copy group identity onto member assets, never infer scope from tag text.
- Preserve manual priority and rejected tombstones on every rerun. Call the governed RPCs; never write `style_group_tags` or `asset_tags` directly.
- Do not remove the propagation capability. `propagate-group-tags` remains a deprecation-emitting alias over the safe refresh until the shared-db orchestrator retires `propagate_group_tags_batch` in a later additive migration, after production has run one full cycle safely.
- Do not change model selection or add model-name routing.
- Never expose licensed images, filenames, extracted content, or secrets in reviewer prompts, fixtures, commits, logs, or handoffs. The visual harness under `verification/ai-tagging-scope/harness/` is synthetic and offline by construction — keep it that way.
- Railway's GitHub deployment badge proves the worker only. Frontend freshness needs the frontend workflow plus the live commit stamp in the served HTML.
- A review turn requires a quiet working tree. See §4.

## 8. Access and environment

- Machine `hetz`. Repository `/worksp/popdam`, branch policy `main`. Commit identity verified: `Albert Hazan <u2giants@users.noreply.github.com>`.
- GitHub CLI is authenticated for `u2giants/popdam3` and `u2giants/shared-db`.
- The production-linked Supabase CLI works as `SUPABASE_GO_BINARY=/home/ai/.local/share/supabase/supabase-go supabase migration list --linked`. Read-only unless a governed workflow authorizes a write.
- **`/worksp/shared-db` is 1169 commits behind `origin/main`** as of this session. Pull before doing anything there.
- Reviewer: GLM session `scoped-ai-step56-review` is warm in this worktree and can be continued with `ai-glm ask`. If doctor fails the health check, `ai-glm server restart` first.
- Shared-db routing at the time of writing: marker issue #1632 declared `route_id 01a040cd-19a0-7d70-8f85-9ec2e5d6abba`, a codex session on EDGE-DEV, unreachable from hetz. **Re-resolve before routing anything; never reuse this.**
- Secrets live in 1Password vault `vibe_coding`. Never print or commit one.

## 9. Open questions and risks

- The section-0 pilot approval is the only open owner decision.
- Step 8's scorecard includes "search finds all members via group terms", which cannot pass until shared-db #1645 lands. Sequence #1645 before the pilot or that criterion will fail for a reason unrelated to tagging quality.
- Images beyond the payload budget are still fully downloaded before being discarded, bounded by the 4–8 representative cap. Revisit if that cap is ever raised.
- A refresh currently forces a write whenever a rejected authoritative row exists, and the group RPC's upsert guard has no status filter — so a human-rejected authoritative group tag could be resurrected. Unreachable today because nothing produces one, but Step 7's remaining work or any reject UI for authoritative rows must address it.
- Mixed deployment versions remain a risk. Land schema, worker, API, and UI additively; do not delete legacy rows and do not start a library-wide run before the bounded pilot.
- **Housekeeping owned by another workstream:** `HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md` names owner `codex/ai-model-routing-plan-90`, but issue #90 is closed. Not touched here; its owner should retire it.

## Handoff self-audit

1. **Can a street-new developer continue without asking a question? Yes.** §1 defines the product, repos, and production targets; §3 gives the exact landed commits, deployment proof, and the precise unfinished boundary; §6 supplies six ordered actions each with a verification gate; §8 names machine, credentials, repo freshness, and reviewer state.
2. **Can they continue as effectively as this session? Yes.** §4 preserves eight dead ends including the two that produced permanently-passing tests, and §5 preserves the non-obvious findings — the RPC's source/description semantics, the unconditional timestamp stamp and both behaviors it dictates, soft-deleted thumbnails, the live-writer file, the five registration sites, the vendor-load path, the evidence-shape difference, and the absent `reviewed_by` column.
3. **Are failed attempts included with reasons? Yes.** §4, each with symptom, cause, and correct recovery.
4. **Is every next action concrete and verifiable? Yes.** §6, six numbered actions with explicit "you'll know it worked when" gates.
5. **Are terms, identifiers, paths, URLs, and SHAs defined? Yes.** §§1, 3, 5, 8 define the apps, repositories, production project, issue numbers, the four landed commits with their CI and deployment evidence, the migration files by name, the shared-db request, and the access route.
6. **Did the section-0 sweep pass? Yes.** §§1–9 were walked line by line. One item requires Albert — approving the Step 8 production pilot — and it appears in §0 with a recommendation and what it blocks, and again in §6 step 4 and §9. The four engineering calls found in §§3, 5, and 9 are already-made decisions and are listed in §0's do-not-re-ask block. The stale #90 handoff in §9 is housekeeping for another owner, not a business ruling.

Final synthesis:

1. **Comprehensive enough for a brand-new developer to continue without missing a beat? Yes** — §§1–9, with the landed state in §3 and the ordered path in §6.
2. **Can they continue as well as this session? Yes** — the brief is linked in §1; session knowledge and failures are in §§4–5.
3. **Is every relevant detail for flawless continuation present? Yes** — scope, outcome, state, failures, decisions, constraints, risks, access, and verification are in §§0–9.
4. **Would Albert see every needed decision by reading only §0? Yes** — the one decision he owns is stated first, with a recommendation and its blast radius.
