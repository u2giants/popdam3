---
issue: 96
status: OPEN
owner: claude/scoped-ai-metadata-step5-96
---

# HANDOFF — Scoped AI metadata: Step 4 complete, Step 5 remaining (2026-08-27 01:56 UTC, hetz/claude)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream currently needs Albert's decision.** The sweep below was run line by line over §§1–9 and found no sentence requiring his judgement. The next session should put nothing to him before starting; it should just work.

Already settled — do **not** re-ask:

- 2026-08-24: physical scope ownership. Product/SKU facts live once on the Style Group; file-visible facts live on the asset; search and display combine them without copying group rows onto members.
- 2026-08-24: manual and authoritative facts outrank AI. Rejected AI facts persist as tombstones. Legacy propagation becomes a safe group refresh — it is never removed.
- Standing: all shared database structure is governed through `u2giants/shared-db`. PopDAM never adds app-side DDL and never runs direct production SQL.
- 2026-08-27 (this session, engineering call, not an owner decision — recorded so it is not relitigated): a Style Group with no usable representative image is left **completely untouched** rather than being given its authoritative product row. Reason in §5.

## 1. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product artwork — Disney, Marvel, Warner Bros. and similar. Designers and sales staff browse source art, mockups, photographs, renders, and technical documents grouped by SKU into "Style Groups".

- Repository: `u2giants/popdam3`, checked out at `/worksp/popdam`. App code is trunk-based, direct to `main`.
- Frontend: React/Vite in `src/`, deployed to Coolify on a self-hosted VPS at `https://dam.designflow.app`.
- Sibling mode: PopSG, a style-guide library at `https://sg.designflow.app`, served by the same image. Its semantics must not change.
- Persistent worker: `apps/worker/` (Node/TypeScript), deployed to Railway automatically on every push to `main`. It runs all long bulk jobs.
- Edge functions: `supabase/functions/`, deployed by GitHub Actions.
- Shared Supabase project: `qsllyeztdwjgirsysgai`. Canonical structural work lives in `u2giants/shared-db` at `/worksp/shared-db`.

The complete brief and the phase gates are in `plan_style_group_scoped_ai_metadata.md`. GitHub issue [#96](https://github.com/u2giants/popdam3/issues/96) remains the completion authority and is still OPEN.

## 2. What we set out to do this session, and why

The predecessor session (`HANDOFF.d/2026-08-27T0019Z-hetz-codex-scoped-ai-step4.md`, now retired by this one) had landed only the deterministic representative selector for Step 4. This session's job was the rest of Step 4: the Style Group profile handler, the atomic database writer, restart-safe operation state, and admin/conflict registration — then every verification and review gate, a commit to `main`, and deployment proof.

Business outcome: a file should be findable by the product facts its Style Group shares — licensor, property, product type, item description, artwork theme — without inheriting false facts from a sibling file. Before this work, a single "primary" image's tags were copied onto every file in the group, so a technical drawing could be tagged "photograph, front view, pastel pink". Step 4 replaces that with one bounded, evidence-backed profile per group built from several genuinely different member files.

## 3. Current state — what is true right now

**Step 4 is COMPLETE and independently approved.** Steps 1–3 were already complete. Step 5 is partially complete. Steps 6–10 are open.

Landed in this session's commit (see §3 "Commit status" below):

- `apps/worker/src/handlers/ai-style-group-profile.ts` — the whole profile pass. It consumes `selectStyleGroupRepresentatives` from `apps/worker/src/style-group-representatives.ts` (landed earlier at `bbc2a6e8`) rather than reimplementing selection.
- `apps/worker/src/handlers/ai-style-group-profile.test.ts` — 23 tests, registered in `apps/worker/package.json`.
- `apps/worker/vendor/tag-style-group-contract.js` / `.d.ts` — the Railway image's copy of the canonical group contract, plus `apps/worker/src/tag-style-group-contract.ts` re-export and two new `COPY` lines in `apps/worker/Dockerfile`.
- `src/test/worker-group-contract-sync.test.ts` — fails on vendor drift and asserts that file-only categories can never reach the group.
- `src/test/operation-registry-sync.test.ts` — asserts conflict-map symmetry and agreement across all three operation registries.
- New operation key `ai-tag-group-profiles`, registered in `apps/worker/src/operation-loop.ts` (lane, conflicts, `mergeProgress`, `buildResultMessage`, `dispatch`), `supabase/functions/_shared/operation-constants.ts`, `supabase/functions/_shared/types.ts`, `src/components/settings/diagnostics/types.ts`, `src/hooks/usePersistentOperation.ts`, and `apps/worker/src/operation-retry.ts`.
- Admin control: a "Profile Style Groups" button and a `GroupProfileProgress` panel in `src/components/settings/diagnostics/AiTaggingSection.tsx`.
- `apps/worker/src/handlers/ai-tagging.ts` — one-line change only: `getVisionModels` is now exported so the group handler reads the same model configuration.
- Incidental correctness fix: the worker's `OP_CONFLICTS` was missing the `rebuild-style-groups` ⇄ `rich-pdf-extract` pair that the backend and UI already had. The new symmetry test caught it; it is fixed in `apps/worker/src/operation-loop.ts`.
- `plan_style_group_scoped_ai_metadata.md` STATUS row 4 updated to ✅ complete.

**Verification evidence, all green at commit time:**

- `apps/worker`: `npm test` → 96 pass / 0 fail. `npm run build` → clean `tsc`.
- Repository root: `npx vitest run` → 37 files, 181 tests, all passing, including both new test files.
- Root `npm run lint` → 0 errors (209 pre-existing warnings, unchanged). Root `npm run build` → built.
- `git diff --check` → clean.

**Independent review:** GLM 5.3, session `scoped-ai-step4-final-diff-review`, returned **APPROVE** on 2026-08-27T01:54Z after a REVISE-then-fix cycle. Reports are at `.ai/reviews/glm-scoped-ai-step4-final-diff-review-20260827T014959Z.md` (initial REVISE) and `...-20260827T015450Z.md` (final APPROVE). All five findings were acted on — see §5.

**Not started, still open:** the remaining Step 5 gates (§9 Step 5 of the plan), and Steps 6–10.

**Predecessor state, still true:** shared-db compatibility repair #1597 is complete (PR #1604 merged as `7da455b1ce7444f864f899d75007510c0ee21dd2`, production migration ledger `20260826144047` verified). Step 3 landed on `main` at `16cc5070132a3d9d72a5fa592481d8b849ba1e00`. The Step 4 selector landed at `bbc2a6e8`; its progress record at `7cc72743`. All three are confirmed ancestors of `origin/main`.

**Commit status:** see the closing report from this session for the exact SHA. Derive it any time with:

```bash
git log -1 --oneline -- apps/worker/src/handlers/ai-style-group-profile.ts
```

**Checkout hygiene:** work was done in the linked worktree `/worksp/popdam/.claude/worktrees/style-group-scoped-ai-step4-18b6f6` on branch `claude/style-group-scoped-ai-step4-18b6f6`, then landed on `main`. `apps/worker/node_modules/` and root `node_modules/` were installed in that worktree; both are gitignored. The unrelated untracked `.claude/` directory in the main checkout was never inspected, staged, changed, or deleted — **preserve it**.

## 4. Everything we tried that did NOT work

- **`npm run build` at the repository root failed on a fresh worktree** with `Could not load .../node_modules/react/jsx-runtime`. This is NOT a code fault: a linked worktree starts with an empty `node_modules/`, and vitest happens to resolve from the parent checkout while vite does not. `npm ci` in the worktree (and separately in `apps/worker`) fixes it. Do not "fix" this by changing vite config.
- **`ai-glm doctor` reported `FAIL health endpoint answers`** and `ai-glm server start` reported success while the endpoint kept returning 401 to an authenticated probe. The running server had been started with a stale password; the credential file at `/home/ai/.config/ai-devops/opencode/server-password` had since changed. `ai-glm server restart` fixed it and doctor went fully clean. Do NOT report this as a GLM outage, a provider fault, or a reason to bypass `ai-glm` — restart the service.
- **A first attempt at bounding the image payload used only `thumbnail_size_bytes`.** The `assets` table has no such column, so the estimate always fell back to a default. The handler now measures the ACTUAL decoded bytes of each downloaded thumbnail. Estimate-only enforcement is not sufficient and must not be reintroduced.
- **A first version of the group-tag test fixtures used equal-sized images to prove budget exhaustion.** That is arithmetically impossible once a per-image cap of 25% of the ceiling exists — four equal images always fit. The test now uses six images against a 4200-byte ceiling. Also note base64 padding: a 1024-byte body measures 1026 decoded bytes, so a ceiling of exactly 4096 rejects everything.
- **A first version wrote authoritative product facts for groups with no usable image.** GLM correctly showed this was a permanent-exclusion bug — see §5. It was removed rather than patched.
- **Predecessor dead ends, still in force:** Grok ran 900 s with no verdict and left a retained lock — do not call that approval or retry it until the lock is repaired through the Grok procedure. Kimi K3 lost its processes while its durable state said `running`; incident logged at `/worksp/ai-devops/.ai/reviewer-issues/20260826T123006Z-hetz-kimi-1406692`. Gemini doctor returns `QUARANTINED`. **GLM is currently the only reviewer proven to complete and return a verdict on this workstream.**
- **Predecessor dead end worth repeating:** `/usr/local/bin/supabase` is a shim and its companion may not be on the shell's path. The supported binary is `/home/ai/.local/share/supabase/supabase-go`; invoke with `SUPABASE_GO_BINARY=/home/ai/.local/share/supabase/supabase-go supabase migration list --linked`. A shim error is not a credential or Supabase outage.

## 5. Root causes and key findings

- **The governed writer sets `source = p_source` on every row it inserts, and always overwrites the `group_ai_description*` columns.** Read it at `shared-db/supabase/migrations/20260825082910_popdam_ai_search_reconciliation_and_activation.sql:2585`. This is why the handler calls `replace_style_group_ai_profile` **twice per group** — once with `p_source='authoritative'`, then once with `p_source='group_ai'` — and why **both calls carry the same final description**. Authoritative first, AI second, so the group's final provenance columns belong to the AI pass, and a failure between the two calls can never blank a description. Its DELETE is scoped to `source = p_source AND model = p_model AND created_by IS NULL`, so manual rows and rejected tombstones survive by construction. See `apps/worker/src/handlers/ai-style-group-profile.ts:243`.
- **The RPC stamps `group_ai_tagged_at = now()` unconditionally.** That single fact drives the most important behavior in the handler: when a group has no usable representative image, the handler writes **nothing at all** and returns `visual_analysis_unavailable` (`ai-style-group-profile.ts:419`). Writing authoritative-only facts there would mark the group profiled and permanently exclude it from every later default run, so a group whose thumbnails were merely missing that day would never be profiled once they recovered. Authoritative-only refresh for permanently unanalyzable groups is **Step 6's** declared job.
- **A soft-deleted asset keeps its thumbnail in Spaces.** Without `.eq("is_deleted", false)` a deleted file could be shown to the model as a representative and counted toward the two-evidence promotion rule. Every comparable worker query already filters it (`apps/worker/src/handlers/style-groups.ts:161`, `relink-orphaned.ts:15`, `erp.ts:141`). A source-level regression test now pins the filter inside `defaultFetchMembers`.
- **`quick_hash` is sampled, not content-unique.** Near-duplicate suppression uses normalized filename revision patterns plus stable file metadata as a heuristic only (`style-group-representatives.ts:49`). Never treat `quick_hash` as a content identity.
- **The existing operation key `ai-tag-groups` means "force-tag assets scoped by groups".** It is NOT the group-profile operation and its meaning is unchanged. The new key is `ai-tag-group-profiles`. A test asserts both facts.
- **Operation definitions are intentionally duplicated in three places** — `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts`, `src/components/settings/diagnostics/types.ts` — plus the cursor validators in `apps/worker/src/operation-retry.ts` (worker auto-resume) and `src/hooks/usePersistentOperation.ts` (UI manual resume). All five must be updated together. `src/test/operation-registry-sync.test.ts` now fails if the three registries drift or a conflict entry becomes asymmetric.
- **The Railway worker's Docker build context is `apps/worker`, so it cannot import arbitrary monorepo files at runtime.** Shared contracts are vendored under `apps/worker/vendor/` and copied to their monorepo-relative path in the image. `src/test/worker-group-contract-sync.test.ts` fails on drift, mirroring the existing `worker-tag-contract-sync.test.ts`.
- **OpenRouter durable submission is receipt-gated.** A batch may be POSTed only after the loop issues `lease_receipt_issued === true` with a non-empty `lease_token` (`apps/worker/src/operation-lease.ts`). The group path reuses that exact machinery via a `group_items` array on the existing `external_job` state — there is no second job registry. `phase: "ambiguous_submission"` fails closed with `error_code: "contract_error"` and never resubmits.
- **GLM's five findings and their disposition** (all verified fixed by GLM in the same session): (1) soft-deleted members — fixed; (2) unavailable groups permanently excluded — fixed as described above; (3) `isValidAutoResumeCursor` rejected the UUID cursor so the op could not auto-resume after a Railway restart — fixed in `apps/worker/src/operation-retry.ts:23`; (4) the byte ceiling exempted the first image — fixed with `MAX_SINGLE_IMAGE_SHARE` at 25%; (5) dead code removed, and a stale-`authoritative`-row edge case **deliberately deferred to Step 6** with GLM's agreement. See §6 step 5.

## 6. Exact next steps

1. Start from current `origin/main` and re-read `AGENTS.md`, then the STATUS table in `plan_style_group_scoped_ai_metadata.md`, then §9 Step 5 of that plan in full. Run `git status --short` before editing and preserve the unrelated `.claude/` directory. **You'll know it worked when** the checkout is current and only known unrelated files are present. Do not re-derive Steps 1–4.
2. Complete the remaining Step 5 gates. The plan lists them at §9 Step 5 and §10 "Extend `apps/worker/src/handlers/ai-tagging.test.ts`". The writers themselves already share the atomic asset-only RPC path; what remains is the test matrix and the three-file fixture. **You'll know it worked when** worker tests cover normal, single-asset, and durable-batch writers; manual collision; re-tag removing stale AI rows only; character isolation; the no-thumbnail unavailable outcome; malformed output; provider fallback; and crash/resume — and a three-file fixture proves the photograph alone gets photography/view/color tags, the tech pack alone gets technical-document facts, and all three remain findable by the group's product and property terms.
3. Do NOT start Step 6 until both Step 4 and Step 5 satisfy their verification gates in the plan. **You'll know it worked when** the STATUS table shows both phases complete and no test demonstrates cross-file leakage.
4. When you do reach Step 6, keep the user's ability to refresh a group. Add the canonical `refresh-group-metadata` key and keep `propagate-group-tags` as a compatibility alias that invokes the safe refresh with a deprecation diagnostic. Update all five registration sites named in §5. **You'll know it worked when** tests prove neither the alias nor the new key ever inserts, updates, or deletes sibling `asset_tags`, `asset_characters`, `licensor_id`, `property_id`, `ai_description`, `scene_description`, `content_type`, or asset visual fields.
5. Step 6 must also clear the deferred stale-`authoritative`-row case: when a group's `product_category` is cleared after an earlier run, `buildGroupProfileWrites` produces no authoritative tags, the authoritative RPC call is skipped, and the previous run's `active` authoritative row survives. The agreed fix is to always issue the authoritative call — even with an empty tag array — so the RPC's own DELETE clears it. **You'll know it worked when** a fixture that clears `product_category` and reruns leaves zero `authoritative` rows on that group.
6. Step 6 should also decide whether the "Profile Style Groups" admin button needs a force/re-profile affordance, the way "Re-tag Everything" has one. The handler already honours `params.force` and `params.group_ids`; only the UI lacks the toggle. It is not needed for correctness — groups without usable images now stay eligible automatically — so treat it as an ergonomics call, not a defect.
7. Before landing anything, run every command in `plan_style_group_scoped_ai_metadata.md` §10 "Commands that must stay green", then request an independent read-only final diff review and incorporate only verified findings. **You'll know it worked when** all suites are green and the reviewer returns APPROVE.
8. Update the plan STATUS, write your own new `HANDOFF.d/` file, retire this one under the successor rule, stage only owned paths, commit as `Albert Hazan <u2giants@users.noreply.github.com>`, push to `main`, and verify exact-SHA GitHub checks plus a Railway-successful deployment containing your commit. **You'll know it worked when** origin ancestry, CI, and deployment evidence agree.

## 7. Constraints and gotchas in force

- PopDAM app work lands directly on `main`. Shared database structure always goes through the `u2giants/shared-db` orchestrator with a branch, PR, preview, and production apply. Never add app-side DDL, never create files under this repo's `supabase/migrations/`, and never edit the vendored read-only `shared-db/` mirror.
- Pushes to this repo are frequently rejected as non-fast-forward because automated `chore: sync shared-db` commits land often. Rebase with `git rebase --autostash origin/main`, confirm the worktree came back unchanged, and push again. **Never force-push, broad-reset, or revert files you did not modify.**
- Do not edit generated `src/integrations/supabase/types.ts`; automated type generation owns it.
- Keep group rows physically on Style Groups. Never append group tags to `assets.tags`, never copy group identity onto member assets, and never infer scope from tag text.
- Preserve manual priority and rejected tombstones on every rerun. The governed RPCs enforce this — call them, never write `style_group_tags` or `asset_tags` directly.
- Do not remove the existing propagation capability. Step 6 converts it into a safe group refresh behind a compatibility alias.
- Do not change model selection or add model-name routing. Capability profiles and explicit overrides remain authoritative.
- Never expose licensed images, filenames, extracted document content, or secrets in reviewer prompts, fixtures, commits, logs, or handoffs.
- A linked worktree needs its own `npm ci` at the root AND in `apps/worker` before `npm run build` will work. See §4.
- Railway's GitHub deployment badge proves the worker only. Frontend freshness needs the frontend workflow and the live SHA — required for Step 7, when UI work begins in earnest.

## 8. Access and environment

- Current machine is `hetz`. Repository path `/worksp/popdam`, branch policy `main`.
- GitHub CLI is authenticated for `u2giants/popdam3` and `u2giants/shared-db`. Commit identity verified: `git var GIT_COMMITTER_IDENT` → `Albert Hazan <u2giants@users.noreply.github.com>`.
- The production-linked Supabase CLI works when invoked with `SUPABASE_GO_BINARY=/home/ai/.local/share/supabase/supabase-go`. Use read-only ledger and catalog checks unless a governed workflow explicitly authorizes a write. The repo link resolves production project `qsllyeztdwjgirsysgai`.
- Railway deployment evidence is available through GitHub deployments.
- Reviewers: GLM works — session `scoped-ai-step4-final-diff-review` in `/worksp/popdam/.claude/worktrees/style-group-scoped-ai-step4-18b6f6` is warm and can be continued with `ai-glm ask`. If `ai-glm doctor` fails the health check, run `ai-glm server restart` (see §4) before concluding anything is broken. Grok holds a failed lock, Kimi failed without a verdict, Gemini is quarantined — none is a valid approval path until its canonical tool is repaired.
- Secrets live in 1Password vault `vibe_coding`. No secret value is required in source or in this handoff; never print or commit one.

## 9. Open questions and risks

- No owner question is open.
- The 4–8 representative count is an engineering measurement, locked to the smallest useful set. A pilot may tighten safety thresholds but must never loosen them.
- Images beyond the payload budget are still fully downloaded before being discarded. This is bounded by the 4–8 representative cap and was accepted by the reviewer, but a future change that raises the cap should revisit it.
- A model may cite an asset outside the current group. `buildGroupProfileWrites` drops foreign evidence before the RPC even though the database also fails closed — keep both.
- Mixed deployment versions remain a risk. Land schema, worker, API, and UI additively. Do not delete legacy rows and do not start a library-wide run before the bounded pilot in Step 8.
- **Housekeeping owned by another workstream:** `HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md` names owner `codex/ai-model-routing-plan-90`, but issue #90 is closed. This session did not touch another session's file. Its owner or successor should retire it after confirming its obligations are preserved.

## Handoff self-audit

1. **Can a street-new developer continue without asking a question? Yes.** §1 defines the product, repos, hosts, and production URLs; §3 states exactly what landed, what was verified and how, and what remains; §6 gives eight ordered actions each with a verification gate; §8 names the machine, credentials route, and reviewer state.
2. **Can they continue as effectively as this session? Yes.** §4 preserves every dead end including the worktree build failure, the GLM credential fault, the payload-measurement mistake, the fixture arithmetic trap, and the predecessor's reviewer and Supabase-shim failures. §5 preserves the non-obvious findings — the RPC's `source`/`p_description` semantics, the unconditional `group_ai_tagged_at` stamp and why it dictates the unavailable-group policy, soft-deleted thumbnails, the `ai-tag-groups` naming trap, the five registration sites, the Docker vendor constraint, and the lease receipt gate.
3. **Are failed attempts included with reasons? Yes.** §4 lists six from this session and three carried forward, each with the symptom, the cause, and the correct recovery.
4. **Is every next action concrete and verifiable? Yes.** §6 has eight numbered actions naming files, behavior, and an explicit "you'll know it worked when" gate for each.
5. **Are terms, identifiers, paths, URLs, and SHAs defined? Yes.** §§1, 3, 5, and 8 define PopDAM, PopSG, the repositories, the production project, the issue, the migration file and line, the RPC, the predecessor commits confirmed on `main`, the review report paths, and the way to derive this session's commit SHA.
6. **Did the section-0 sweep pass? Yes.** Every sentence in §§1–9 containing "decide", "owner", "approve", "call", or "question" was checked. The four items found — the two 2026-08-24 scope decisions, the standing shared-db rule, and this session's unavailable-group engineering call — are all already settled and are listed in §0's do-not-re-ask block. The two judgement-shaped items in §6 (steps 5 and 6) are engineering choices with recommendations already given, not owner rulings. §0 states "None" explicitly.

Final synthesis:

1. **Comprehensive enough for a brand-new developer to continue without missing a beat? Yes** — §§1–9, with the exact landed state in §3 and the ordered path in §6.
2. **Can they continue as well as this session, with all relevant background? Yes** — the full brief is linked in §1, and session-specific knowledge and failures are preserved in §§4–5.
3. **Is every relevant detail for flawless continuation present? Yes** — scope, outcome, state, failures, decisions, constraints, risks, access, and verification are covered in §§0–9.
4. **Would Albert see every needed decision by reading only §0? Yes** — the full line-by-line sweep found no open decision, and §0 says so explicitly rather than being silent.
