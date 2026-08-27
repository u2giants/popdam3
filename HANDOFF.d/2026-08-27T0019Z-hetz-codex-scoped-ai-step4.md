---
issue: 96
status: OPEN
owner: codex/scoped-ai-metadata-step4-96
---

# HANDOFF — Scoped AI metadata Step 4 (2026-08-27 00:19 UTC, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream currently needs Albert's decision. The next session should not reopen settled scope choices.

Already settled — do not re-ask:

- On 2026-08-24 Albert chose physical scope ownership: product/SKU facts live once on the Style Group, file-visible facts live on the asset, and search/display combine them without copying group rows.
- Manual and authoritative facts outrank AI. Rejected AI facts persist as tombstones, and legacy propagation must become a safe group refresh rather than being removed.
- All shared database structure is governed through `u2giants/shared-db`; PopDAM must never add app-side DDL or run direct production SQL.

## 1. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product artwork. Designers and sales staff browse source art, mockups, photographs, renders, and technical documents grouped by SKU. The React/Vite application and Supabase edge functions are in `u2giants/popdam3` at `/worksp/popdam`; the persistent TypeScript AI worker is under `apps/worker/` and deploys through Railway from `main`. Production is `https://dam.designflow.app`; sibling mode PopSG is `https://sg.designflow.app` and must not change semantics. The shared Supabase project is `qsllyeztdwjgirsysgai`; canonical structural work belongs to `u2giants/shared-db`.

The complete brief and phase gates are in `plan_style_group_scoped_ai_metadata.md`. GitHub issue [#96](https://github.com/u2giants/popdam3/issues/96) remains the completion authority.

## 2. What we set out to do this session, and why

The session resumed implementation after shared-db compatibility repair #1597 was reported complete. Its goals were to prove #1597 was genuinely in production, clear the Step 3 landing gate, ship the already-reviewed typed asset/group metadata increment, and begin Step 4's Style Group profiling pass.

Business outcome: every file should remain searchable using shared product facts without inheriting false file facts from a sibling. Step 4 supplies one bounded, evidence-backed group artwork profile built from diverse representative files rather than treating a single primary image as group truth.

## 3. Current state — what is true right now

- Shared-db #1597 is complete. PR #1604 merged as `7da455b1ce7444f864f899d75007510c0ee21dd2`; production migration ledger `20260826144047` was independently confirmed with the supported Supabase CLI binary. This repaired `public.propagate_group_tags_batch` required `category`/`status` fields.
- Step 3 and the implemented portion of Step 5 landed on PopDAM `main` at `16cc5070132a3d9d72a5fa592481d8b849ba1e00`. All six GitHub workflows passed. Railway production deployment `fd551b9da6cbf8a003c316516a8a61f21ed868ec` succeeded and contains `16cc5070` as an ancestor.
- GLM session `scoped-ai-metadata-plan-audit` returned APPROVE after verifying the three correction blockers: manual tag required fields, durable thumbnail 403/404 handling, and app propagation required fields. Grok/Kimi/Gemini failures are recorded in §4 so they are not mistaken for verdicts.
- Step 4 is in progress. `apps/worker/src/style-group-representatives.ts:1-116` and its test landed at `bbc2a6e8`. It chooses the primary first, excludes missing previews, diversifies by content/file family and filename view hints, suppresses near-identical revisions without using `quick_hash`, caps representatives at 4–8, and enforces a bounded estimated thumbnail payload.
- `apps/worker/src/style-group-representatives.test.ts` is registered in `apps/worker/package.json`. The worker suite passed 73/73 and `npm run build` passed.
- Plan STATUS at `plan_style_group_scoped_ai_metadata.md:10-21` accurately marks Steps 1–3 complete, Step 4 and part of Step 5 in progress, and Steps 6–10 open. The Step 4 progress record landed at `7cc72743`.
- Not started in Step 4: `apps/worker/src/handlers/ai-style-group-profile.ts`; group-contract vendor copy for the worker image; model execution; `replace_style_group_ai_profile` writer; durable external-job resume; operation/admin/UI registration and conflict-map tests.
- The checkout contains an unrelated untracked `.claude/` directory. This session did not inspect, stage, change, or delete it. Preserve it.
- At closeout preparation, `origin/main` had advanced by the unrelated OrderList commit `559a1c82`; the closeout commit must be rebased over it and pushed. Derive the final closeout SHA with `git log -1 --oneline -- HANDOFF.d/2026-08-27T0019Z-hetz-codex-scoped-ai-step4.md`.

## 4. Everything we tried that did NOT work

- Grok's final review ran for 900 seconds without a terminal verdict and left contradictory auth/lock state. Do not call that approval or retry it until its retained lock is repaired through the Grok procedure.
- Kimi K3's job lost its processes while durable state remained `running`; its stream ended mid-tool-call. It issued no verdict. The failure was logged as reviewer incident `20260826T123006Z-hetz-kimi-1406692` under `/worksp/ai-devops/.ai/reviewer-issues/`.
- Gemini doctor returned `QUARANTINED`, so it was not a valid reviewer. GLM was the first fallback that completed and produced a real verdict.
- The first GLM verdict was REVISE, not approval. It correctly found that manual and legacy propagation inserts omitted production-NOT-NULL `category`/`status`, and durable thumbnail preparation treated only a missing URL as unavailable. Those were fixed and the same GLM session then returned APPROVE.
- A first production-ledger check incorrectly concluded the Supabase CLI was broken because `/usr/local/bin/supabase` is a shim and its companion was not on that shell's lookup path. The supported binary exists at `/home/ai/.local/share/supabase/supabase-go`; `SUPABASE_GO_BINARY=/home/ai/.local/share/supabase/supabase-go supabase migration list --linked` worked and proved `20260826144047`. Do not report a credential or Supabase outage from the shim error.
- The first push of the Step 3 commit was rejected because a concurrent shared-db mirror sync reached `main`. Inspection proved it touched only `shared-db/`; a clean rebase preserved both changes. Never force-push or broadly reset this shared checkout.
- The exact `16cc5070` Railway deployment became `inactive` because automated edge-format/type-generation descendants followed immediately. This was not a failed release: descendant `fd551b9d` reached Railway `success` and ancestry proves it contains `16cc5070`.

## 5. Root causes and key findings

- A Style Group profile needs diversity, not just the primary asset. The deterministic seam now lives in `apps/worker/src/style-group-representatives.ts:65-116`; model/database code must consume this selector rather than reimplement selection.
- `quick_hash` is sampled and not content-unique. Near-duplicate suppression therefore uses normalized filename revision patterns plus stable file metadata (`style-group-representatives.ts:49-58`) only as a heuristic.
- The existing operation key `ai-tag-groups` means force-tagging assets scoped by groups; it is not the new group-profile operation. Step 4 must add the distinct key `ai-tag-group-profiles` and must not silently change `ai-tag-groups` semantics.
- The governed database writer already exists as service-role-only `public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])`. It preserves manual/rejected rows and validates evidence asset membership. Call it atomically; do not write `style_group_tags` directly.
- The canonical group JSON contract is `supabase/functions/_shared/tag-style-group-contract.js`. The worker Docker build context cannot import arbitrary root files at runtime, so Step 4 needs a synchronized worker vendor copy and a drift test, just as the asset contract already has.
- Operation definitions are intentionally duplicated across `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts`, and `src/components/settings/diagnostics/types.ts`. Update all three plus their tests in one increment or UI/backend enforcement will disagree.
- OpenRouter durable submission is receipt-gated. A new group batch may submit only after `lease_receipt_issued === true` and a non-empty `lease_token`; ambiguous POST/save states fail closed without resubmission.

## 6. Exact next steps

1. Start from current `origin/main`, preserve `.claude/`, read `AGENTS.md`, the STATUS table, and plan Step 4 completely. Re-run `git status --short` before editing. **You'll know it worked when** the checkout is current and only known unrelated files are present.
2. Add synchronized worker vendor copies of `tag-style-group-contract.js/.d.ts` and update `apps/worker/Dockerfile`. Add a comparison/contract test that fails on drift and validates group categories, confidence, evidence UUIDs, and rejection of file-only categories. **You'll know it worked when** the worker image can import the group contract and tests reject invalid scope.
3. Implement `apps/worker/src/handlers/ai-style-group-profile.ts` using `selectStyleGroupRepresentatives`. Load authoritative Style Group context and candidate assets through existing public tables/RPC wrappers; fetch only selected thumbnails; keep identity read-only. Use the existing capability planner/structured-output executor without model-name regexes. **You'll know it worked when** a synthetic tech-pack/photo/mockup group yields one group artwork summary and no file type/view/color group tags.
4. Convert model tags to database rows: status is `active` only at confidence >= 0.85 with evidence from at least two distinct member assets; otherwise `candidate`. Call `replace_style_group_ai_profile` once per group with evidence IDs/model/source. Preserve manual approvals/rejections by relying on the RPC. **You'll know it worked when** idempotent rerun, two-evidence promotion, candidate preservation, and manual rejection tests pass.
5. Add restart-safe durable batch handling by reusing the existing `external_job` state machine and receipt gate; do not create an in-memory provider job registry. **You'll know it worked when** crash/resume tests poll the saved batch ID and prove no replacement POST occurs.
6. Register `ai-tag-group-profiles` in worker dispatch/progress/result text, backend names/lanes/actions/conflicts, diagnostics/UI names/conflicts, and admin operation controls. It must conflict with rebuild, asset AI tagging, and legacy propagation. **You'll know it worked when** symmetry tests pass and both backend and UI reject conflicting concurrent starts.
7. Run worker tests/build, root focused tests, full root tests/lint/build, and `git diff --check`; request an independent read-only final diff review. Incorporate only verified findings. **You'll know it worked when** every required check is green and the reviewer returns APPROVE.
8. Update the plan STATUS and this workstream's next handoff, stage owned paths only, commit under `Albert Hazan <u2giants@users.noreply.github.com>`, push to `main`, and verify exact-SHA GitHub checks plus a Railway-successful descendant containing the commit. **You'll know it worked when** origin ancestry, CI, and production deployment evidence agree.
9. Re-read Steps 5–10 before continuing, then complete the remaining Step 5 writer/fixture gates. Do not start Step 6 until both Steps 4 and 5 satisfy their verification gates. **You'll know it worked when** STATUS and tests show both phases complete without cross-file leakage.

## 7. Constraints and gotchas in force

- PopDAM app work is direct-to-`main`; shared-db structure always uses the separate orchestrator branch/PR/preview/production workflow.
- Preserve concurrent work. Inspect remote commits before rebase, stage explicit owned paths, and never force-push, broad-reset, or stage `.claude/`.
- Do not edit generated `src/integrations/supabase/types.ts`; automated type generation owns it.
- Keep group rows physically on Style Groups. Never append group tags to `assets.tags`, copy identity into member assets, or infer scope from tag text.
- Preserve manual and authoritative priority and rejected tombstones on every rerun.
- Do not remove the existing propagation capability; Step 6 changes it into safe group refresh with a compatibility alias.
- Do not change model selection or add model-name routing. Capability profiles and explicit overrides remain authoritative.
- Do not expose licensed images, filenames, extracted content, or secrets in external reviewer prompts, fixtures, commits, logs, or handoffs.
- Railway's GitHub production badge proves the worker only. Frontend freshness requires the frontend workflow/live SHA when UI work begins.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/popdam3` and `u2giants/shared-db`.
- The production-linked Supabase CLI works when invoked with `SUPABASE_GO_BINARY=/home/ai/.local/share/supabase/supabase-go`; the repo's link resolves production project `qsllyeztdwjgirsysgai`. Use read-only ledger/catalog checks unless a governed workflow explicitly authorizes writes.
- Railway deployment evidence is available through GitHub deployments; the worker project link is attached to those records. Coolify/frontend authenticated live verification was not needed for this worker-only increment.
- Reviewer state: GLM worked; Grok retained a failed/stopped lock, Kimi failed without a verdict, and Gemini was quarantined. Do not treat the latter three as available approval paths without repairing their canonical tools.
- Secrets live in 1Password vault `vibe_coding`. No secret value is required in source or this handoff; never print or commit one.
- Current machine is `hetz`; repo path is `/worksp/popdam`; branch policy is `main`.

## 9. Open questions and risks

- No owner question is open. Representative count is an engineering measurement locked to the smallest useful 4–8 set; the pilot may tighten, but never loosen, safety thresholds.
- The selector estimates payload from `thumbnail_size_bytes` when available and otherwise uses a conservative default. The handler must enforce the actual downloaded-byte ceiling too; estimate-only enforcement is not sufficient.
- Model output may cite an asset outside the selected/current group. Validate UUID membership before calling the RPC even though the database also fails closed.
- Mixed deployment versions remain a risk. Land schema/worker/API/UI additively and do not delete legacy rows or activate a library-wide run before the bounded pilot.
- Stale handoff warning: `HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md` has owner `codex/ai-model-routing-plan-90`, but issue #90 is closed. This session did not delete another session's file; its owner/successor should retire it after confirming its obligations are preserved.

## Handoff self-audit

1. **Can a street-new developer continue without asking a question? Yes.** §§1–3 define the product, repos, production targets, exact landed commits, current unfinished boundary, and unrelated checkout state; §6 supplies the ordered implementation path with a verification gate for every step.
2. **Can they continue as effectively as this session? Yes.** §§4–5 preserve every reviewer/tool/deployment dead end and the non-obvious operation-key, RPC, Docker-vendor, conflict-map, and lease-receipt findings.
3. **Are failed attempts included with reasons? Yes.** §4 records the non-verdict reviewers, Supabase shim misdiagnosis, concurrent push rejection, and Railway descendant behavior, including the correct recovery for each.
4. **Is every next action concrete and verifiable? Yes.** §6 has nine ordered actions naming files, behavior, and explicit “you'll know it worked when” gates.
5. **Are terms, identifiers, paths, URLs, and SHAs defined? Yes.** §§1, 3, 5, and 8 define PopDAM, PopSG, repositories, production project, issue, migrations, commits, RPC, machine, and access route.
6. **Did the section-0 sweep pass? Yes.** A line-by-line review of §§1–9 found no request for owner approval or judgment. The decisions mentioned in §§1, 2, 5, 7, and 9 are already settled and are consolidated in §0; the stale #90 handoff needs housekeeping, not a business ruling.

Final synthesis:

1. **Is this handoff comprehensive enough for a brand-new developer to continue without missing a beat? Yes.** Supported by §§1–9 and the exact state/next-step evidence in §§3 and 6.
2. **Can they continue as well as this session with all relevant background? Yes.** The complete brief is linked in §1, while session-specific knowledge and failures are preserved in §§2–5.
3. **Is every relevant detail needed for flawless continuation present? Yes.** Scope, outcome, state, failures, decisions, constraints, risks, access, and verification are covered in §§0–9.
4. **Would Albert see every needed decision by reading only §0? Yes.** The full sweep found no open decision; §0 explicitly says none and lists the settled choices that must not be reopened.
