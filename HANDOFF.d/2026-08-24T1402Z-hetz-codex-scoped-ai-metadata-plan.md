---
issue: 96
status: OPEN
owner: codex/scoped-ai-metadata-plan-96
---

# HANDOFF — Style-Group-scoped AI metadata plan

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None. Albert requested this implementation plan and already defined the essential distinction: product/Style Group facts may apply to every file, while file/image facts must not propagate.

Already settled on 2026-08-24; do not re-ask:

- Store shared facts once on the Style Group and file facts on the asset.
- Combine them for search/display without copying group rows onto every asset.
- Keep manual and authoritative data above AI.
- Replace the existing sync/propagation capability with safe group metadata refresh rather than removing the capability.
- Route all shared schema implementation through `u2giants/shared-db`.

A line-by-line sweep of §§1–9 found no other owner choice. Pilot thresholds and representative counts have conservative default criteria in the plan and are engineering measurements, not owner gates.

## 1. What this application is

PopDAM is POP Creations’ internal licensed-art Digital Asset Manager. Designers, sales, and production staff browse files grouped by SKU. The React/Vite UI runs at `https://dam.designflow.app`; a Node/TypeScript Railway worker performs AI tagging; the shared Supabase backend is structurally owned by `u2giants/shared-db`.

- App repo/path: `u2giants/popdam3`, `/worksp/popdam`, normally direct to `main`
- Shared schema repo/path: `u2giants/shared-db`, `/worksp/shared-db`, branch + PR through its single orchestrator
- Complete build specification: [`../plan_style_group_scoped_ai_metadata.md`](../plan_style_group_scoped_ai_metadata.md)
- Tracking issue: [u2giants/popdam3#96](https://github.com/u2giants/popdam3/issues/96)

## 2. What we set out to do this session, and why

Albert asked for an implementation plan after discussing how to tag every asset while separating shared SKU facts—licensor, property, product type, product description, and supported artwork concepts—from file-specific facts—tech pack versus photography, view, scene, colors, and visible content.

This session’s objective was planning and discoverability only: inspect the actual code/schema, lock a safe design, write a zero-context 13-section plan, link it from the repository router/topic documentation, create a trackable issue, register this handoff, self-audit, commit, push, and verify publication. No application behavior or production data was to change.

## 3. Current state — what is true right now

- Issue #96 exists for the implementation work.
- The complete plan is `plan_style_group_scoped_ai_metadata.md`; every STATUS row is open and a fresh session starts at Step 1.
- The plan requires new Style Group tag/profile storage, typed asset tag metadata, group and asset AI passes, effective search union, safe refresh, UI scope labels, pilot, rollout, and cleanup.
- The repository already has product-level `style_groups.item_description`, file-level `assets.content_type`, rich-PDF group metadata, and search rollups. These are the foundation, not work to recreate.
- The current flat contract and propagation remain untouched by this planning session. Existing risk is documented, not claimed repaired.
- Planning baseline before edits was PopDAM `main`/`origin/main` `dfe25d6909809648218f3c54afd7909b70e1c641`; implementation must fetch and drift-check.
- `/worksp/shared-db` was clean but 758 commits behind `origin/main`; implementation must not start schema work from that stale checkout and must use the orchestrator’s fresh worktree.
- At the time this handoff was drafted, plan/router/topic/handoff edits were not yet committed or pushed. The closing section below must be updated by commit evidence before reporting completion of this planning session.
- No runtime code, database row/schema, configuration, AI request, deployment, or secret changed.

## 4. Everything we tried that did NOT work

- `gh issue list --repo u2giants/popdam` failed because the actual GitHub repository is `u2giants/popdam3`; the corrected command worked and issue #96 was created there.
- A combined `git status --short /worksp/shared-db` invocation from the PopDAM repository failed because Git rejects an outside path. Using `git -C /worksp/shared-db ...` is the correct read-only form.
- The existing exact-text file-tag blacklist is not a workable design. Current controlled phrases already fall outside it, and the plan rejects extending it.
- Primary-asset propagation, copied group rows, prompt string prefixes, one-file-per-group tagging, and destructive immediate cleanup were considered and rejected in plan §7 with reasons.

## 5. Root causes and key findings

- `supabase/functions/_shared/tag-asset-contract.js:18-52` returns one flat string array with no scope/category/provenance.
- Its prompt mixes group and file facts at `:123-168`, so writers cannot safely separate them afterward.
- `supabase/functions/_shared/tag-propagation.ts:21-49` uses an incomplete exact-text denylist.
- The same file says `ai_description` is file-specific at `:13-16` but copies it to blank siblings at `:159-169`.
- `docs/STYLE_GROUPS.md:49-106` establishes the primary asset as the legacy propagation source, although primary selection is for card/preview suitability, not group truth.
- `apps/worker/src/handlers/ai-tagging.ts:202-240` writes asset fields and replaces AI tag rows; both durable-batch and normal paths must converge on one atomic new writer.
- `src/components/library/StyleGroupDetailPanel.tsx:1170-1260` shows flat selected-file tags/descriptions and offers “Sync Tags to All Group Members.”
- Search already combines Style Group and asset metadata through shared-db document-refresh functions, making read/index-time union the safe seam.

## 6. Exact next steps

1. Open `plan_style_group_scoped_ai_metadata.md`, read its STATUS table and §§1–13 completely, then fetch/drift-check PopDAM and shared-db/open handoffs. **You’ll know it worked when** Step 1’s baseline artifact and synthetic fixtures cite current SHAs and exact commands.
2. Execute plan Step 2 by opening a fresh `u2giants/shared-db` `db-work` issue with the exact requested objects and letting its single orchestrator own the migration. **You’ll know it worked when** shared-db preview tests, merge, canonical note, and approved production ledger/object evidence exist.
3. Execute plan Steps 3–6 in order, using the context cut after Step 2 and again after Step 6 if needed. **You’ll know it worked when** the group/asset contracts are typed, both AI writers converge, and old/new refresh operations cannot mutate sibling file facts.
4. Execute plan Step 7 and visually verify both detail panels. **You’ll know it worked when** synthetic/local evidence shows common Style Group chips plus distinct “This file” chips, with safe manual/candidate controls.
5. Execute Steps 8–9: bounded pilot first, then full rollout only if every critical pilot criterion passes. **You’ll know it worked when** exact-SHA production evidence and reconciled aggregate counters exist and reviewed files have zero cross-file leakage.
6. Execute Step 10, update the plan STATUS with artifacts, close issue #96 only after Definition of Done, and delete this handoff in the completion commit. **You’ll know it worked when** the issue is closed, docs match live behavior, this file is absent from `origin/main`, and git history retains it.

## 7. Constraints and gotchas in force

- The plan is the brief; do not rely on this chat.
- Shared structure changes never originate in PopDAM. Use `u2giants/shared-db` branch/PR/orchestrator and prove the target immediately before every write.
- PopDAM app work goes directly to `main`; preserve concurrent changes and stage only owned paths.
- Do not edit generated Supabase types, historical app migrations, or the vendored shared-db mirror.
- Keep current AI capability routing, restart-safe batch state, operation conflicts, diagnostics, and single-asset scope guard working.
- Never copy group tag rows onto assets, infer scope from string text, treat `quick_hash` as unique, overwrite manual/authoritative facts, or mark no-preview assets visually analyzed.
- A Railway green deployment proves the worker only; frontend requires its own workflow/Coolify/live-SHA proof.
- Never expose secrets, licensed artwork, private filenames, or extracted licensed content in issues, commits, fixtures, or external prompts.
- Whoever executes any plan step must immediately update its STATUS/current-state text with artifact-backed evidence.

## 8. Access and environment

- GitHub CLI was authenticated for `u2giants/popdam3` and created issue #96.
- Git committer identity was `Albert Hazan <u2giants@users.noreply.github.com>`.
- PopDAM was clean/current at `dfe25d69` before these planning edits.
- Supabase CLI, Railway, Coolify, live admin login, and OpenRouter budget/auth were not verified and must be checked when needed.
- Secrets live in 1Password vault `vibe_coding`; use the repository-named Supabase CLI PAT, shared preview/production DB password, runtime service credentials, GitHub credential, and AI provider/OpenRouter items by title only. Never expose values.

## 9. Open questions and risks

No owner question is open. Engineering measurements and their criteria are in plan §13: representative set 4–8, starting auto-promotion rule confidence ≥0.85 plus two distinct evidence assets, conservative pilot failure behavior, and delayed legacy cleanup.

Principal risks are false shared facts, manual tag loss, search regression, cost growth, mixed-version deployment, lock contention, and assets moving groups. The plan addresses them through physical scope ownership, source priority, candidates/evidence, atomic RPCs, no-copy search union, bounded pilot, additive rollout, exact-SHA proof, and reversible cleanup.

## Handoff self-audit

1. **Can a new developer continue without asking a question? Yes.** §§1–3 define the system, issue, plan, baseline, and untouched production state; §6 gives the exact continuation order and gates.
2. **Can they continue as effectively as this session? Yes.** §§4–5 preserve command errors, rejected design paths, exact root causes, code locations, and the search seam; the linked plan carries the full 13-section build spec.
3. **Is every detail needed for flawless continuation present? Yes.** §§1–9 cover background, goal, current state, failures, findings, steps, constraints, access, risks, decisions, and verification; the reciprocal plan names every file/test/phase.
4. **Would Albert see every needed decision by reading only §0? Yes.** A line-by-line sweep of §§1–9 found no request for approval or judgment. All semantics are already settled; pilot tuning has conservative engineering criteria and schema routing is procedural.

**Self-audit result: PASS.**
