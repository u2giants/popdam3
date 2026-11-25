---
summary: "Issue 797: old character relink scripts target the pre-cutover table; make them refuse to run, then retire or port them safely."
kind: plan
status: open
read-when: "running, changing or retiring scripts/relink-existing-ai-characters*.mts, scripts/apply-existing-ai-character-relinks.mts or scripts/atomic-ai-character-relink.mjs; fixing review finding 797"
---

# Historical character relink scripts after the shared-character cutover (issue #797)

Issue: [#797](https://github.com/u2giants/popdam3/issues/797). This is the review of [PR #796](https://github.com/u2giants/popdam3/pull/796), merged 2026-11-05 at `b3f1c79f`. The fixer's PR #798 was closed unmerged.
Related plans: [issue-680-character-relink.md](issue-680-character-relink.md), the relink task these scripts serve, and [issue-1313-shared-character-cutover-leftovers.md](issue-1313-shared-character-cutover-leftovers.md).
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Scripts refuse to run against the post-cutover schema | ⬜ open | — |
| 2. Decide: retire or port (criteria in §8) | ⬜ open | — |
| 3a. Retire: delete the scripts, keep the tests' lessons in docs | ⬜ open (if retire) | — |
| 3b. Port: per-asset abstain, exact receipts, resolver parity, behaviour tests | ⬜ open (if port) | — |
| 4. Update the #680 relink plan STATUS | ⬜ open | — |
| 5. Land | ⬜ open | — |

A fresh session starts at step 1. Step 1 is urgent and independent of step 2.

## 1. Ultimate goal

Old AI character tags on artwork should point at the right characters in the company's shared character list, and nothing should damage those links. The one-off repair tools written for this must either work safely against today's database or be unable to run at all. A tool that writes to an outdated table would corrupt the cleanup Albert asked for.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork. Assets are linked to characters.

Until 2026-11-24, the target of new AI character links was `public.asset_licensor_characters`, which pointed at licensor character records, and `public.asset_characters` was "legacy". On 2026-11-24, stage C2 of the no-copies effort (popcre/shared-db [#6995](https://github.com/popcre/shared-db/issues/6995), migration `20261225091406_asset_characters_core_character`) re-pointed `asset_characters.character_id` at the shared `core.character`. Stage C3 ([#1301](https://github.com/u2giants/popdam3/issues/1301)) made PopDAM write only `asset_characters` and clear `asset_licensor_characters` on every re-tag (`apps/worker/src/handlers/ai-tagging.ts:370-372`). See [plan_shared_data_no_copies.md](../../plan_shared_data_no_copies.md).

The scripts in question, all in `scripts/`, run by an operator with `tsx` against production:
- `relink-existing-ai-characters.mts`: a read-only planner that writes a private manifest;
- `apply-existing-ai-character-relinks.mts`: the runner, read-only by default, which applies only with an exact reviewed manifest hash;
- `atomic-ai-character-relink.mjs`: per-asset SERIALIZABLE transactions;
- `relink-existing-ai-characters-safety.mjs`: helpers;
- tests in `relink-existing-ai-characters-safety.test.mjs` and `scripts/tests/atomic-ai-character-relink.pg17.test.mjs`.

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), protected `main`.

## 3. What triggered this work

The reviewer on PR #796's head (`73fc9e46`) found six problems:
1. A dependency-read failure aborts the whole run instead of abstaining that asset, in both the planner and the runner.
2. A gap between the receipt recheck and the insert.
3. Receipt ownership is a substring match (`JSON.stringify(op.external_job).includes(assetId)`).
4. Case and status mismatches against the worker's resolver (`ai-tagging-shared.ts:289-304` lowercases IDs and treats anything not archived or deleted as matchable; the scripts require `status === 'active'` and compare raw IDs).
5. Post-insert verification also asserts that the asset, tag and legacy rows are unchanged, which a benign trigger would break.
6. The tests do not exercise the real paths.

The merged version replaced the REST runner with the native atomic runner. That resolves (2) and (5) in substance: SERIALIZABLE per-asset transactions, and a fresh-reader comparison under locks (see the 680 plan, "Current bounded packet and atomic proofs").

Re-checked on `main` @ `787c20b8` (2026-11-25):
- (1) is still present: `relink-existing-ai-characters.mts:79,92` throws "Group preimage dependency failed" and "Scope dependency failed".
- (3) is still present, case-insensitive now (`relink-existing-ai-characters-safety.mjs:12-20`, `relink-existing-ai-characters.mts:29,82`).
- (4) is still present (`relink-existing-ai-characters.mts:103,113,151,157` and `relink-existing-ai-characters-safety.mjs` `appendPayload`, which require `status === "active"`).
- (6) is partly addressed: there are 24 native PostgreSQL 17 cases, but the planner has no behaviour tests.

**New, and more important than every finding above:** the scripts still treat `asset_licensor_characters` as the link target and `asset_characters` as legacy (`atomic-ai-character-relink.mjs:105-106,143-144,206,218-219`, `apply-existing-ai-character-relinks.mts` read-only loop). After C2/C3 that is backwards. An apply run today would insert licensor-era character IDs into a table the tagger empties, and would treat the canonical table as "legacy evidence".

## 4. Scope

**In:** the five scripts and their tests, the decision to retire or port them, and the STATUS of the #680 relink plan.

**NOT in this plan:**
- Running any relink packet. Each release needs its own exact reviewed manifest; see the 680 plan.
- Shared-db changes.
- The Chase and Cheer Bear catalog delivery (shared-db #5683 and its successors).
- The full tagging run.

## 5. Current state

See §3 for exact line references. Further facts:
- `apply-existing-ai-character-relinks.mts:19-33` requires a private manifest, a create-only journal and the production `PGPASSWORD`, and applies only when a reviewed SHA-256 is given.
- `:120-142`: in apply mode an asset error is counted as abstained, except for stop, point-read and journal failures. The runner therefore already abstains per asset; the planner does not.
- In production (read-only, 2026-11-25), `asset_characters.character_id` references `core.character`. `asset_licensor_characters` still has 73,547 rows but is being cleared per asset by every re-tag, and its retirement is being routed to shared-db by the [#1313 plan](issue-1313-shared-character-cutover-leftovers.md) step 4.
- The 680 relink plan's STATUS (2026-11-05) lists unfinished items: complete historical coverage, Chase and Cheer Bear, fresh packets, and the five named examples.

## 6. Key findings and root cause

The scripts were written against the data model as it was before the cutover. The cutover changed which table is canonical and which character list IDs come from. Every safety proof the scripts carry (preimages, resolver parity, receipts) is therefore about the wrong tables now. That root cause outranks findings (1), (3), (4) and (6). Fixing them in place, without re-pointing the scripts, would only harden a tool that must not run.

## 7. Approaches considered and rejected

- **Fixing findings (1), (3), (4) and (6) in place on the old tables.** Rejected, for the reason in §6.
- **Silently re-pointing table names in the scripts.** Rejected. The character IDs differ (licensor-era versus `core.character`). The resolver, scope rules, manifests and every preserved packet would all change meaning. A port is a redesign, so it needs the decision in step 2.
- **Leaving the scripts as they are, with a doc warning.** Rejected. A warning does not stop an operator; a hard refusal does.

## 8. Design decisions

Locked:
- Execution defaults to read-only, and a release needs an exact reviewed manifest hash (680 plan).
- Private manifests and journals never enter the repo.
- The canonical link table is `asset_characters` → `core.character` (C2, 2026-11-24).

Open (step 2): retire or port. Criteria:
- **Retire** if C2's migration already carried the historical AI links into `asset_characters` (migration step 3: "links that collapse onto the same (asset, core character) keep one row"), **and** a read-only check shows no remaining class of AI tag whose character name resolves to a `core.character` but has no link.
  Use this check: count active `asset_tags` with `source='ai'` whose normalized tag equals a `core.character` name or alias within the asset's licensor, and with no matching `asset_characters` row. Base it on the worker resolver in `apps/worker/src/handlers/ai-tagging-shared.ts` around `:280-310`. If the count is at most the ordinary new-tag lag (for example, assets tagged in the last hour), there is nothing left to relink.
- **Port** if that count is material, or if the 680 plan's five named examples are still missing links.
- This is a technical call, not a business one. Record the counts in STATUS.

## 9. The plan

**Step 1. Hard refusal.** `lead-only`: production safety.
- At the top of `apply-existing-ai-character-relinks.mts` and `relink-existing-ai-characters.mts`, before connecting, refuse to run unless the manifest declares `schemaVersion: "core-character-v1"`. No existing manifest declares this.
- After connecting, before any read, check the live foreign key: `select confrelid::regclass from pg_constraint where conrelid='public.asset_characters'::regclass and contype='f' and conname like '%character_id%'`. If it is `core."character"` and the script still targets `asset_licensor_characters`, throw "Relink scripts predate the shared-character cutover (C2); see docs/plans/issue-797-character-relink-script-hardening.md".
- Gate: a unit test in `relink-existing-ai-characters-safety.test.mjs` proves that a manifest without `schemaVersion` throws before any client is created. Running the planner with a dummy manifest and no credentials exits with that message.

**Step 2. Decide.** `lead-only`: this is §8.
- Run the read-only count from §8 and record it in STATUS.
- Choose retire or port by the criteria.

**Step 3a. Retire** (if chosen). `helper-ok`.
- `git rm` the five scripts and their two test files.
- Move the durable lessons into a short section of `docs/plans/issue-680-character-relink.md` → "Retired tooling": SERIALIZABLE per-asset transactions, fresh-reader phantom check, every-status receipt exclusion, unknown-commit point-read reconciliation, and lock budgets. Keep it short and link to commit `b3f1c79f` for the code.
- Gate: `git grep -n "atomic-ai-character-relink\|relink-existing-ai-characters" -- ':!docs'` is empty, and the root `npm test` is green.
- Stop-and-ask trigger: another script imports these files.

**Step 3b. Port** (if chosen). `lead-only`: it redesigns production data repair.
- Re-point the target to `asset_characters` (`character_id` = `core.character.id`) and the source catalog to `core.character` plus its aliases. Drop the "legacy" role.
- Apply the reviewer's fixes:
  - (1) every per-asset dependency failure becomes `abstain("<reason>")` and the loop continues, in the planner and the runner;
  - (3) receipt ownership is exact membership of the asset ID in the receipt's explicit asset-ID fields (`external_job.asset_ids` or `external_job.items[].asset_id`; read the live `BULK_OPERATIONS` shape first), never a substring;
  - (4) import the worker resolver's own normalization and matchability (lowercased IDs; not archived or deleted), and share it rather than restating it.
- Add behaviour tests:
  - a group read failure abstains one asset and the next asset proceeds;
  - an exact receipt match excludes, and a substring-only coincidence does not;
  - a mixed-case ID matches;
  - an active-like status matches, with parity to the resolver;
  - dry-run makes no writes.
- Port the PostgreSQL 17 suite to the new tables.
- Set the manifest `schemaVersion: "core-character-v1"`.
- Gate: all new and ported tests pass on a disposable localhost PostgreSQL 17 (`T2_TEST_DATABASE_URL`; the suite refuses remote databases).

**Step 4. Update the 680 relink plan.** `helper-ok`.
- Add a dated STATUS line to `docs/plans/issue-680-character-relink.md`: "2026-11-25: tooling predates C2; see the issue-797 plan; packets from before C2 are void and must never be applied."
- Gate: the line is present.
- Stop-and-ask trigger: the 680 plan has been rewritten by another session since; then merge the wording in, do not overwrite.

**Step 5. Land.** `lead-only`.
- Open a PR to `main` and merge once the required checks pass. No deploy is involved; these scripts are operator-run only.
- Comment on #797 with the decision, the step 2 counts and the PR, then close it. Live proof here is the step 1 refusal demonstrated on `main` (retire: the files are gone); there is no runtime service.

## 10. Tests required

- Step 1: the "no schemaVersion → throws before connect" test.
- Step 3b, if porting: the five behaviour tests listed there, and the ported PostgreSQL 17 suite.
- Existing: the root `npm test` (vitest picks up `scripts/*.test.mjs` if configured; otherwise run `node --test scripts/relink-existing-ai-characters-safety.test.mjs`).

## 11. Constraints and gotchas

- Never run an apply against production from this plan.
- Never commit manifests, journals or licensed rows.
- `PGPASSWORD` for production comes from 1Password `vibe_coding`, and is used only by an operator releasing a reviewed packet. It is not needed for this plan.
- The step 2 count is read-only SQL only.
- Use a feature branch and PR; never push to `main`.

## 12. Access and environment

- `gh` is authenticated as `u2giants`.
- Read-only SQL: the Supabase Management API read-only endpoint, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token", injected with `op run` (see `docs/MCP_SERVERS.md`).
- Local PostgreSQL 17 for the port tests: any disposable localhost instance.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Step 1 is merged.
- [ ] The step 2 decision and its counts are recorded.
- [ ] Step 3a or 3b is merged with tests green.
- [ ] The step 4 line is added.
- [ ] #797 is closed with evidence.
- [ ] STATUS is updated.

Risk: retiring removes a tool someone may want later. The code stays recoverable at `b3f1c79f`, and the lessons are kept in the 680 plan.

Open: retire or port, decided by §8's criteria.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. §2 explains the cutover that changes everything, §3 and §5 give exact lines, §8 gives objective decision criteria, and §9 gives the gates.
2. *Is all background captured?* Yes. §3 separates the findings the native runner already resolved from those still open, and §7 records why in-place fixes are rejected.
3. *Is the goal clear for judgment calls?* Yes. §1 says the tools must either be safe against today's database or unable to run.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-797-character-relink-script-hardening.md in u2giants/popdam3. Read AGENTS.md, then this plan and docs/plans/issue-680-character-relink.md (STATUS first). Do steps 1, 2, 3b (if chosen) and 5 yourself. Give step 3a (if chosen) and step 4 to your helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring stop-and-ask triggers back to you. If stuck for 30 minutes, the step is taken back. Never run a relink apply. Merge when required checks pass, update STATUS, and close #797 with evidence.
```
