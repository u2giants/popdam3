---
summary: "Issue 1363: parallel tagging untagged_only is valid only for discover runs; fix wording and test the RPC mode."
kind: plan
status: open
read-when: "changing AI_TAG_PARALLEL_RUN flags (discover, untagged_only, force) or the parallel tagging handler; fixing review finding 1363"
---

# Parallel tagging run: guard `untagged_only` (issue #1363)

Issue: [#1363](https://github.com/u2giants/popdam3/issues/1363). This is the review of [PR #1362](https://github.com/u2giants/popdam3/pull/1362), merged 2026-11-25 at `b821b68c`. The fixer's PR #1364 was closed unmerged, and the `fixer-done` label is not proof of a fix.
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Reject `untagged_only` unless the run is a discover run | ⬜ open | — |
| 2. Correct the comment and docs wording | ⬜ open | — |
| 3. Handler test asserts `p_mode: "untagged"` | ⬜ open | — |
| 4. Land and live proof | ⬜ open | `- [ ] live proof` on #1363 |

A fresh session starts at step 1.

## 1. Ultimate goal

When Albert (or an AI operator) starts a big parallel tagging run with the setting "only untagged assets", it must do exactly that, or refuse to start with a clear message. It must never quietly re-tag (and re-pay for) assets that already have tags. The setting's description must say what it really selects, so nobody assumes something different.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork. The Railway cloud worker (`apps/worker/`, which auto-deploys on `main` changes under `apps/worker/**`) runs bulk AI tagging.

A temporary setting, `admin_config.AI_TAG_PARALLEL_RUN`, spreads one tagging run across one to four models. Its shape is `{run_id, models, concurrency, max_cursor?, force?, discover?, untagged_only?}`; see `docs/MODEL_RULES.md`, the "explicit-file ai-tag-parallel" paragraph.
- `discover: true` pages through every candidate from the database function `get_ai_tag_candidates(p_mode, …)`.
- Without `discover`, the run tags an explicit list of asset IDs from the operation's `params.asset_ids`.

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), protected `main`; the AI merges the PR.

## 3. What triggered this work

The advisory reviewer on PR #1362 found these problems:
- (1)–(3) `untagged_only` is accepted, and silently ignored, on explicit-ID runs, and is not validated against `discover`.
- (4) The comment says "never tagged", but the database function's `untagged` mode means something different.
- (5) No test proves that the handler sends `p_mode: "untagged"`.

All five were verified as present on `main` @ `787c20b8` (2026-11-25).

## 4. Scope

**In:**
- `apps/worker/src/handlers/ai-tag-parallel.ts` (validation);
- `apps/worker/src/handlers/ai-tagging.ts` (the comment near `:1142`);
- `docs/MODEL_RULES.md` and `docs/BULK_JOBS.md` (wording);
- tests.

**NOT in this plan:**
- Changing what `get_ai_tag_candidates('untagged')` selects. That is a shared-db function; if a literal "never tagged" mode is wanted, it is a business question for Albert and a `popcre/shared-db` change.
- Changing explicit-ID skip rules in `tagSingleAsset`.
- Colab or provider routing.

## 5. Current state of the code

- `ai-tag-parallel.ts:2`: `ParallelTagRun` includes `untagged_only?: boolean`.
- `ai-tag-parallel.ts:10`: `discover = v.discover === true && explicitIds == null`. A config with `discover: true`, but an operation started with explicit IDs, silently becomes an explicit run.
- `ai-tag-parallel.ts:22-23`: it type-checks `untagged_only` and rejects `untagged_only && force`. It does **not** require `discover`.
- `ai-tag-parallel.ts:24`: it returns `untagged_only: true` even when `discover` is false.
- `ai-tagging.ts:1142-1143`: `// An untagged-only run discovers and tags only assets that were never tagged.` then `if (parallel?.untagged_only) tagAll = false;`.
- `ai-tagging.ts:1166`: in discover mode it calls `get_ai_tag_candidates` with `p_mode: tagAll ? "all" : "untagged"`.
- `ai-tagging.ts:1222`: on an explicit page, each asset is tagged with `tagAsset(id, tagAll, model, acceptedModels)`.
- `ai-tagging.ts:977-985`: skip rules.
  - In parallel mode, an asset is skipped only if its saved `ai_model` is in `acceptedModels` and it has active same-model AI tags.
  - Otherwise it is skipped only when `status === "tagged" && ai_tagged_at && !force`.
  - An asset tagged by a model outside the run's list may therefore be re-tagged on an explicit run, whatever `untagged_only` says.
- Database meaning of `p_mode = 'untagged'` (`shared-db/supabase/migrations/20261110192227_dam_cover_tier_comp_files.sql:202-232`, live): assets with `status <> 'tagged'`, excluding the cover tiers `(5, 9)`, **and excluding any asset in a style group that already has an AI-tagged representative**. "Never tagged" is therefore not literally true: a previously tagged asset whose status was reset is included, and an untagged asset in an already-represented group is not.

## 6. Key findings and root cause

The root cause: the new flag only has a meaning in discover mode (it picks the RPC mode), but validation treats it as independent of `discover`. On an explicit-ID run it has no effect at all. Fail-closed validation is the correct fix. Making explicit runs honour it would duplicate the database selection rules in TypeScript.

## 7. Approaches considered and rejected

- **Applying "untagged" semantics to explicit-ID runs in TypeScript.** Rejected. It duplicates the database `untagged` rules (status, cover tier, group representative) and would drift from them.
- **Silently ignoring the flag when `discover` is false.** Rejected. That is the current bug.
- **Changing the RPC to mean "never tagged".** Out of scope (see §4).

## 8. Design decisions

Locked:
- `force` and `untagged_only` cannot be combined (already enforced).
- Existing provider receipts always finish first (`docs/MODEL_RULES.md`).

Locked by this plan:
- `untagged_only: true` is valid only when the run is actually a discover run, meaning `v.discover === true` **and** the operation has no explicit IDs. Otherwise it is a config error. The message names both fields.

Open: none.

## 9. The plan

**Step 1. Fail closed.** `helper-ok`: a single validation line with exact tests.
- In `ai-tag-parallel.ts`, after the `untagged_only` type check, add: `if (v.untagged_only === true && !discover) throw new Error("Parallel tagging untagged_only requires discover: true and no explicit asset IDs")`. Here `discover` is the local variable at `:10`, so a `discover: true` config started with explicit IDs is also refused.
- Keep the `force` conflict check, and order the checks so the `force` message only appears when `discover` is true. That covers the reviewer's misleading-message point (3).
- Gate: these new tests in `apps/worker/src/handlers/ai-tag-parallel.test.ts` pass:
  - "untagged_only without discover throws";
  - "untagged_only with discover:true but explicit IDs throws";
  - "untagged_only with discover and no IDs returns untagged_only:true";
  - "force+untagged_only with discover throws the force message".
- Stop-and-ask trigger: an existing test relies on `untagged_only` with explicit IDs.

**Step 2. Correct the wording.** `helper-ok`.
- Replace the comment at `ai-tagging.ts:1142` with: "untagged_only (discover runs only) selects candidates with get_ai_tag_candidates('untagged'): status not 'tagged', cover tiers 5/9 excluded, and groups that already have an AI-tagged representative skipped."
- Add the same sentence to the `AI_TAG_PARALLEL_RUN` paragraph in `docs/MODEL_RULES.md`, and add `untagged_only` to the listed shape. Add it to `docs/BULK_JOBS.md` if that file lists the parallel config.
- Then run `ai-doc-health --repo . --fix-index`.
- Gate: `grep -rn "never tagged" apps/worker/src docs/MODEL_RULES.md docs/BULK_JOBS.md` finds nothing that describes this flag.
- Stop-and-ask trigger: the docs describe the RPC differently from §5.

**Step 3. Handler-level test.** `helper-ok`.
- In `apps/worker/src/handlers/ai-tagging.test.ts`, copy the pattern at around `:207` (it asserts `calls[0].p_mode === "all"`): use a fake client that records `rpc` calls, a `parallelConfig` with `{run_id, models:[m], concurrency:2, discover:true, untagged_only:true}`, no `asset_ids`, and a `tagAsset` spy.
- Assert `calls[0].p_mode === "untagged"`, and that the spy received `tagAll === false`.
- Add the negative case: the same config with `asset_ids` set → the handler returns `ok:false`, with an error containing "untagged_only requires discover".
- Gate: both tests pass.
- Stop-and-ask trigger: the handler's dependency injection does not allow a fake RPC client.

**Step 4. Land and live proof.** `lead-only`: a live-proof judgment.
- Open a PR and merge once the required checks pass. The worker auto-deploys; verify that the Railway SHA equals the merge SHA.
- Live proof: read the current `admin_config.AI_TAG_PARALLEL_RUN` read-only. If an active run uses `untagged_only`, confirm it has `discover: true`, and that the worker logs show no config error after the deploy. If no such run exists, record that the config was checked, that no active run is affected, and leave `- [ ] live proof` on #1363 until the next untagged-only run starts and logs its first page.

## 10. Tests required

- The four cases in `ai-tag-parallel.test.ts` from step 1.
- The two handler cases in `ai-tagging.test.ts` from step 3.
- Existing: `cd apps/worker && npm test && npm run build`. `parallel-tag-conflicts.test.ts` must stay green. Its explicit-ID shape at `:52-75` must not set `untagged_only`; if it does, that is a stop-and-ask.

## 11. Constraints and gotchas

- Use a feature branch and PR; never push to `main`.
- **A live parallel run may be using this setting.** Before merging, read `AI_TAG_PARALLEL_RUN` read-only. If an active run sets `untagged_only` without `discover`, it would start failing at its next page after the deploy. In that case, stop and tell the session that owns the run (see open `HANDOFF.d/` files, and [issue-680 full tagging run](issue-680-full-ai-tagging-run.md)) before merging. Never edit their config.
- Never change the RPC from this repo; it belongs to shared-db.

## 12. Access and environment

- `gh` is authenticated as `u2giants`.
- Read-only SQL: the Supabase Management API, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token", injected with `op run` (see `docs/MCP_SERVERS.md`).
- Railway logs: the Railway MCP `get-logs`.
- Local: `npm ci` at the root, then `cd apps/worker && npm test`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–3 are merged to `main` with CI green.
- [ ] The Railway SHA is verified.
- [ ] The live-proof check from step 4 is recorded on #1363, then #1363 is closed, or `- [ ] live proof` is left on it.
- [ ] STATUS is updated.

Risk: an active misconfigured run fails after the deploy; the pre-merge read in §11 guards against that. Rollback: redeploy the previous worker SHA.

Open question for Albert (business meaning, raise only if someone wants it): should a mode exist that means literally "assets never tagged by any model"? This is not needed to close #1363.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. §5 gives the exact lines and the database meaning, §9 the exact edits and gates, and §11 the live-run trap.
2. *Is all background captured, including what was rejected?* Yes. §6 gives the root cause and §7 the rejected alternatives, with reasons.
3. *Is the goal clear for judgment calls?* Yes. §1 says: never quietly re-tag, and refuse with a clear message.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1363-parallel-untagged-only-guard.md in u2giants/popdam3. Read AGENTS.md, then the plan (STATUS first). Give steps 1, 2 and 3 to your helper in order. Do step 4 and the pre-merge live-run check in §11 yourself. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring stop-and-ask triggers back to you. If stuck for 30 minutes, the step is taken back. You re-run every gate and the worker suite, merge when required checks pass, verify the Railway SHA, record live proof, update STATUS, and close #1363 with evidence.
```
