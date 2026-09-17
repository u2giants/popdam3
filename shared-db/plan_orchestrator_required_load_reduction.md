# Implementation plan — reduce what MUST pass through the orchestrator, without reducing safety

Tracking issue: [#3199](https://github.com/u2giants/shared-db/issues/3199) (`db-work` label; `db-work-scope` block with `work_type: repo-maintenance`, `route: repo-maintenance`).

Companion plan (do NOT re-plan it here): [`plan_shared_db_popcre_transfer_merge_queue.md`](plan_shared_db_popcre_transfer_merge_queue.md) — issue #2530, the org transfer + native merge queue.

Paired handoff: [`HANDOFF.d/2026-09-17T1325Z-zcode-plan-orchestrator-load-reduction.md`](HANDOFF.d/2026-09-17T1325Z-zcode-plan-orchestrator-load-reduction.md)

**Review record.** Muse Spark 1.3 was asked first and could not complete (wrapper failure, incident `20260917T141421Z-edge-dev-muse-4088612` in the ai-devops reviewer-issue log; three fenced sessions). The owner authorized substituting Grok 4.6 on 2026-09-17. Grok 4.6's verdict: **sound-with-changes** (session `01a0afc1-854d-7be2-9bab-f2202f92063c`, 15 turns, $0.43; full review preserved at `.ai/reviews/grok-orchestrator-load-plan-review-20260917T142326Z-4117926.md` on the authoring worktree — its material findings are folded into this revision; the merge-dispatch right it surfaced was independently verified against `.github/workflows/guarded-migration-merge.yml` before being locked in §8).

## STATUS — read first

| Step | State | Date | Evidence / next gate |
|---|---|---|---|
| A1. Label every open unlabelled issue (scope block verified first) | ⬜ open | 2026-09-17 | Rerun `node scripts/manage-migration-author-lanes.mjs --queue-audit`; the `UNLABELLED ISSUES` block must be empty. |
| A2. Close out expired author-lease claim #3089 via `--release-claim` (PR already merged) | ⬜ open | 2026-09-17 | Same audit; the `EXPIRED AUTHOR LEASES` block must no longer list claim #3089. |
| A3. Ship read-only scheduled `Queue Hygiene Report` (write-stripped subcommand + `author-lane-abandonment-audit.yml` shape) | ⬜ open | 2026-09-17 | One green `workflow_dispatch` run; permissions block proves read-only; a backed-up (dispatchable) queue does NOT fail it. |
| B1. Ship the self-service additive-lane boundary classifier (reusing existing lexers) + dirty-first tests | ⬜ open | 2026-09-17 | `node --test scripts/check-self-service-additive-lane.test.mjs` green with the §10 fixture list; wired into a CI workflow. |
| B2. Admit route `self-service-additive` in `QUEUE_ROUTES`/`ROUTES_BY_WORK_TYPE`/`evaluateAdmission`/`renewalIssueScope`/expand paths; excluded from orchestrator refill — ONLY in the same pull request as B3 (or after it) | ⬜ open | 2026-09-17 | `--queue-audit` prints a separate self-service section and does not refill from it; a claim through the route succeeds and its objects lock; a lease through the route RENEWS; sync test green. |
| B3. Classifier enforced at merge time (pre-lock step in the guarded merge workflow) + write down the already-existing merge-dispatch right — must land WITH or BEFORE B2 | ⬜ open | 2026-09-17 | Guard refuses a deliberately out-of-boundary fixture before any merge lock is taken; dispatch-right decision recorded in §8; B2's admission change and this enforcement are provably in the same landed change (or this one first). |
| B4. Document the lane (AGENTS.md front-matter banner + §0.0-C/§4, both `shared-db-change` skills, memory) incl. the author's exact commands | ⬜ open | 2026-09-17 | A cold fresh session can execute the lane from the documentation alone, including reviewer draw and preview dispatch. |
| C1. Write the merge→production hop table for the #2758 ephemeral route | ⬜ open | 2026-09-17 | Hop table merged as docs; every hop names actor and why manual. |
| C2. Automate only pure-mechanics hops — or land "no code change" if every remaining hop is load-bearing | ⬜ open | 2026-09-17 | Either automations with tests in the `test_production_preview_skip.py` style, or a justified hop table with zero refusal semantics removed. |
| D. Landing: STATUS upkeep per phase; retire handoff when the tracking issue closes | ⬜ open | 2026-09-17 | Plan STATUS current at every merge; handoff deleted in the closing change. |

**Fresh implementation starts at Step A1.** Natural context cut points: after A3, after B4, after C1. Before each phase, re-read this STATUS table, `git fetch origin` and re-derive the live queue state — the counts in §3 are the 2026-09-17 reading, not standing truth.

---

## 1. Ultimate goal

Today every structural database change in this company funnels through ONE orchestrator session, and that session is chronically backed up, so applications wait on it for work whose safety does not actually depend on it. When this plan is done:

- An application session that needs a **small additive change confined to its own app-owned schema** (a new extension table, a new nullable column on its own ext table, a new view in its own schema) can take that change from idea to merged pull request **without any orchestrator-session turn** — it claims the lane, authors, draws both reviewers, and dispatches the guarded merge itself; the workflow, not the caller, is the gate.
- The queue stops losing work to **administrative silence** (unlabelled issues, expired leases nobody closed) because a read-only report surfaces them daily.
- The remaining manual hops between merge and production for already-classified low-risk changes are either automated (if pure mechanics) or written down with the reason they must stay manual.
- The orchestrator session's context is reserved for what genuinely needs judgment: shared-object structural changes, contention, and owner decisions.

**The safety floor is NOT negotiable and NOT reduced.** The serial one-at-a-time preview apply, guarded merge and production promotion lanes; exact-head review verdicts; exact-object collision locks and version reservation; the two-reviewer rule for migrations; the curated Master Data gate (§6.4); and the full orchestrator path for anything touching a shared object — all unchanged. If any step in this plan conflicts with that floor, **the floor wins — stop and flag it** rather than implementing the step as written.

## 2. What this application is

`shared-db` (`u2giants/shared-db`, public; transfer to `popcre` planned under #2530) is the canonical repository for the schema, migrations, policies and coordination machinery of ONE Supabase/Postgres database shared by CRM (`popcrm-web`), DAM (`popdam-web`), PM/PIM (`poppim-web`) and six `popcre/designflow-*` PLM repositories. Pushes to `main` mirror the repo root into nine consumer repositories.

Its distinguishing mechanism: a single **orchestrator session** (found via `node scripts/check-orchestrator-marker.mjs --resolve`) triages `db-work`-labelled GitHub issues, admits structural work, dispatches it to sub-agents in isolated worktrees, draws reviewers, and drives guarded merges and production promotion. Nearly all safety is enforced by **scripts and GitHub-backed locks**, not by the orchestrator's judgment: `scripts/manage-migration-author-lanes.mjs` (claims, object locks, version reservation, queue audit, reviewer draw), `.github/workflows/guarded-migration-merge.yml` (exact-head approval gate; plain `workflow_dispatch` — it enforces everything itself and constrains no caller), `scripts/dispatch-production-apply.mjs` + `scripts/production_business_risk_gate.py` (production lane and the #2758 low-risk "ephemeral" classifier `preview_required_reasons`), and the CI guards run on every pull request.

This plan is repository-maintenance work: it changes scripts, workflows and documents in this repository. It authorizes **no database schema or row change** and touches no credentials.

## 3. What triggered this work

Albert's observation on 2026-09-17: *"the orchestrator is always backed up and holds everything else back as well."* A read-only queue audit and PR listing run that day agreed, and located the backlog:

- **Merge-stage aging.** `gh pr list --repo u2giants/shared-db` showed open pull requests dating to 2026-09-08 (#2607) and 2026-09-12 (#2835, #2846) — waiting on merge attention, not on safety checks.
- **Administrative pile.** `node scripts/manage-migration-author-lanes.mjs --queue-audit` (2026-09-17 run; re-derive rather than trusting these numbers, per the §4.3 owner ruling) printed: ten `UNLABELLED ISSUES` — **including #2530 itself**, so the queue's highest-leverage relief plan was invisible to label-filtered queries; an `EXPIRED AUTHOR LEASES` entry for claim #3089 whose pull request was already merged (bookkeeping debt; expiry never releases object protection, so the claim still holds its objects); and a large `NOT ORCHESTRATOR WORK` block of repo-maintenance issues that are legitimately outside the orchestrator but inflate everyone's sense of the queue.
- **Authoring itself was healthy.** Four author lanes with active, fresh leases. The bottleneck is attention and serialization, not capacity.

The deepest relief — GitHub's native merge queue — already has a full plan (#2530), but its STATUS shows Steps 1–2 done and everything after gated on **Step 0: the owner's explicit transfer authorization and change window**, then the org transfer, then queue rebuild (Steps 7–8). That relief is real but not imminent. This plan delivers relief that does NOT wait on the transfer — including the merge hop itself, which §8 locks down as an operating-rule clarification, not a permission change.

## 4. Scope

### In this plan

- **Phase A — queue hygiene:** label currently-unlabelled open issues (verifying each scope block first); close out expired claim #3089 through the guarded `--release-claim` path; add a scheduled read-only `Queue Hygiene Report` (new write-stripped reporting subcommand + workflow) that surfaces unlabelled issues, expired leases and aging non-orchestrator work daily without writing anything and without treating a merely-backed-up queue as a failure.
- **Phase B — self-service additive lane:** a fail-closed classifier + an admitted structural **route** (`self-service-additive`) letting an application session claim an author lane, author, draw reviewers and land additive changes **confined to the `crm`/`pim`/`dam` schemas** without orchestrator triage/dispatch, keeping every existing gate and enforced at merge time.
- **Phase C — zero-touch wait chain:** a written audit of every manual orchestrator turn between merge and production apply on the #2758 ephemeral (low-risk) route; automation of pure-mechanics hops only, with "no code change needed" as a first-class outcome.
- **Phase D — documentation landing:** AGENTS.md (including the front-matter banner that today tells every structure-change session to stop and open an issue), both `shared-db-change` skills, memory entries, plan STATUS upkeep.

### NOT in this plan

- **No second orchestrator session.** The marker system assumes exactly one; changing that is a separate, later decision (see §7).
- **No re-planning or execution of #2530** (org transfer, merge queue). This plan depends on it only for the serialization end-state; nothing here waits on it.
- **No parallelizing the preview, merge or production lanes.** Owner ruling 2026-09-11: those one-at-a-time lanes are safety isolation. Never reintroduce a count limit or a parallel apply.
- **No weakening of any gate:** required checks, exact-head approvals, two reviewers for migrations, object collision locks, version reservation, admission tests, business-risk conclusions. Adding a required context (if ever needed) goes through `scripts/update-required-checks.mjs` and the pinned mirror — never a hand-edit of `docs/verification/main-required-status-checks.json`.
- **No auto-labeling bot.** The `db-work` label drives admission; a bot applying it from a guess would silently misroute work (see §7).
- **No change to the curated Master Data gate (§6.4)** or its matched-row abstention rule.
- **No database schema or data changes, no credential or secret work, no consumer-repo changes** (skill-file copies under user directories are documentation, not consumer-repo sync targets).
- **No self-service boundary beyond `{crm, pim, dam}`** — not `plm`, `api`, `core`, `public`, `ingest`, `storage`, `dflow`, or `app`, and **not brand-new schemas** (creating a schema is how a second shared schema gets born without an owner decision). Extending the boundary, including to `dflow`/`app` for DesignFlow work, requires a new owner decision.

## 5. Current state of the code

Baseline read from `origin/main` on 2026-09-17 (worktree cut at `ae7145128de8`). Orientation only — re-derive before executing.

### The pieces this plan builds on (all existing, all working)

- `scripts/manage-migration-author-lanes.mjs` (~8,600 lines): `--claim --admit-issue <n>` (lane + objects + version reservation, GitHub-backed, fail-closed), `--queue-audit` (reads every open issue; prints `NOT ORCHESTRATOR WORK`, `UNLABELLED ISSUES`, `EXPIRED AUTHOR LEASES`; exits 2 while unlabelled issues exist — and, note for A3, also exits 2 whenever dispatchable work exists, and its `githubIo.commentIssue` path can post `urgent_waiting_capacity` comments, so it is NOT read-only-safe to run as a scheduled job), `--assign-reviewer` (automated draw from the rotation minus the live orchestrator's engine), `--release-claim <n> --owner <owner> --confirm-finished` (guarded claim close-out: exact owner, no open PR on the branch, author mutex), and the route machinery: `NON_STRUCTURAL_EXITS` (work_type → exit; `structural` already exits `accept` — this is NOT where a new route goes), `QUEUE_ROUTES`, `ROUTES_BY_WORK_TYPE` (today `structural: new Set(['shared-db-orchestrator'])`), with the `shared-db-orchestrator` string also hard-coded in `admitIssue`'s legacy path (~line 6738), `buildDynamicQueues` (~:913), `renewalIssueScope` (~:7420), `expandActiveClaimFromPr` (~:7595) and `expandActiveClaimFromIssue` (~:7652). Line numbers are the 2026-09-17 reading and will drift; re-find by symbol.
- `scripts/orchestrator-flow/admission.mjs` — `evaluateAdmission` (lines ~68–113): currently hard-refuses anything that is not `work_type structural` + `route shared-db-orchestrator`. **This file is where Phase B's admission change actually lives** (the Grok review caught that the original draft named the wrong table).
- `.github/workflows/guarded-migration-merge.yml`: the merge gate; `on: workflow_dispatch` with `pull_request` + `head_sha` inputs, a repo-wide concurrency group, and no orchestrator-only trigger — it re-proves required checks, exact-head approval, lease and admission itself, so **any write-authenticated session may dispatch it; the workflow, not the caller, is the safety property**.
- `scripts/dispatch-production-apply.mjs` + `scripts/production_business_risk_gate.py`: the production lane and the #2758 carve-out — `ephemeral_check_run_id` substitutes for preview proof when the conservative classifier recognizes the migration as low-risk; anything unrecognized still requires preview. The classifier's `ALLOWLIST` already encodes the safe shapes this plan reuses: `create_table` refuses `REFERENCES`/`LIKE`/`INHERITS` (a foreign key locks the referenced table), `create_function` demands `SECURITY INVOKER`, no `DEFINER`, no `SET`, and `add_nullable_column` models the catalog-only `ALTER TABLE … ADD COLUMN` (nullable, built-in type). Tests: `scripts/test_production_preview_skip.py`, `scripts/test_automatic_qualification_route.py`.
- Existing DDL lexers this plan MUST reuse rather than replace: `inspectPrStructuralChange` / `inventoryDdlVerbs` (admission side) and `sql_top_level_statements` (production side). A third, looser parser is how the boundary silently becomes the whole queue.
- `.github/workflows/author-lane-abandonment-audit.yml`: the correct no-write scheduled-workflow precedent (`on: schedule` + `workflow_dispatch`, `contents`/`issues`/`pull-requests`: read, write hooks stripped, files no issue and no comment).
- `.github/workflows/tools-offline-tests.yml`: the pattern for new guards — **own workflow, NO `paths:` filter**, offline-only tests, and explicit wiring of every new test (the PR #331 lesson).
- `.github/workflows/documents-only-merge-authorization.yml` + `scripts/lib/documents-only-change.mjs`: the rule-18 documents-only PR path — **which classifies `plan_*.md` as rulebook, not documents** (this very plan's PR therefore carries an `.agent/` contract + completion pair).
- `docs/verification/main-required-status-checks.json` + `PINNED_REQUIRED_CONTEXTS` in `scripts/check-required-checks-preflight.mjs`: the required-context floor; the pin may grow (via `scripts/update-required-checks.mjs`, never by hand) and never shrink. Unlisted checks do not block merges — which is why Phase B's classifier must run inside the guarded merge workflow, not as a freestanding check.
- `plan_shared_db_popcre_transfer_merge_queue.md` (#2530): 12-step evidence-gated plan; STATUS shows Steps 1–2 done on 2026-09-17, Step 0 (owner authorization + window) open and blocking Steps 3+, merge queue at Steps 7–8.

### What does NOT exist yet

- No `self-service-additive` route anywhere (admission, audit output, docs).
- No boundary classifier for app-owned-schema additive changes.
- No write-stripped queue-hygiene reporting command or scheduled report.
- No written hop table for the ephemeral route's merge→production path.

## 6. Key findings and root cause

1. **Safety no longer lives in the orchestrator session's attention.** It lives in the GitHub-backed locks, CI guards, exact-head review gate, reviewer rotation and serial lanes — all of which execute without the orchestrator's judgment. The owner's 2026-09-16 no-ceilings ruling made this explicit: the only admission controls that matter are exact-object collision locks, version reservation, and the serial apply/merge/promote lanes. The orchestrator session is therefore mostly a **scheduler and clerk**, and scheduler/clerk work is exactly what can be removed without touching the safety floor.
2. **The backlog is at the merge stage and in administration, not in authoring.** Lanes were fresh; PRs aged at merge; ten issues were invisible for want of a label; one merged PR's claim was never released. Each is an attention problem, not a capacity or correctness problem. The merge hop in particular is an **attention convention, not a gate** (§5): the guarded merge workflow already accepts a dispatch from any write-authenticated session and re-proves everything itself.
3. **The biggest single serialization relief (native merge queue) is blocked behind the org transfer**, which is blocked on the owner's Step 0 authorization. Relief that does not depend on the transfer is therefore worth building now: remove orchestrator **traffic** (Phase B), **administrative turns** (Phases A and C), and the unstated merge-dispatch convention (§8, locked). #2530 still owns the serialization end-state.
4. **The 2026-08-13 through 2026-09-16 trajectory already points this way.** §0.0-A freed reads, §0.0-B freed data writes, the 2026-08-21 ruling freed repo-maintenance, rule 18 (#2102) freed documents-only PRs from review, #2758 freed low-risk SQL from the preview apply, and the 2026-09-16 ruling removed every concurrency ceiling. Phase B is the next step on the same line: free the *least dangerous class of structural work* from orchestrator triage.
5. **(Grok review, 2026-09-17)** The self-service boundary is only as safe as its classifier is strict about **every named object**, not just the created one: a `CREATE TABLE crm.foo (… REFERENCES core.customer(id))` passes a schema-of-created-object check yet locks a shared table; a `CREATE FUNCTION` without the #2758 invoker constraints can write anywhere; a new browser-exposed `crm`/`pim` table (§8.1: `pgrst.db_schemas` exposes `crm` and `pim`) with a `GRANT` and no RLS is a material access change. The classifier must therefore check FK targets, function/view bodies, `SECURITY DEFINER`, and RLS-before-grant — reusing the production classifier's `ALLOWLIST` rules, not inventing a laxer parallel set.

## 7. Approaches considered and REJECTED

- **A second orchestrator session.** The locks would still fail closed, but `scripts/check-orchestrator-marker.mjs` assumes a single live marker; two sessions racing triage, merge execution and marker writes need an arbitration redesign. Rejected **for now** — revisit only if Phases A–C plus #2530 leave real backlog. (The Grok review independently endorsed this rejection.)
- **Parallelizing preview/merge/production.** Forbidden by the owner's 2026-09-11 ruling; those lanes are safety isolation. Not a backlog fix anyway — the waits are attention gaps, not lane occupancy.
- **An auto-labeling bot for unlabelled issues.** The `db-work` label is the admission trigger; a bot applying it from a guess would route work invisibly. The audit's refusal (exit 2) stays; the fix is a read-only report plus a session applying the label after reading the issue (Step A1's order: scope block verified BEFORE labelling). (Also independently endorsed by the Grok review.)
- **Fewer reviewers for the self-service lane.** Migrations need two independent reviewers (§4 full text). The draw is automated (`--assign-reviewer`), so reviews cost the orchestrator nothing — removing them would trade real safety for zero load reduction.
- **Skipping the author-lane claim for self-service work.** The claim's version reservation and object locks are the collision safety that lets unlimited authors coexist. Self-service keeps them; it only skips orchestrator triage/dispatch.
- **Batching several authors' migrations into one pull request** to reduce merge count. Blurs attribution, review targeting and rollback. The merge queue (#2530) is the correct serialization answer.
- **Letting the self-service classifier grow "just one" convenience case later** (a backfill, a grant change, `dflow` "since DesignFlow needs it too"). Every one of those is how the boundary silently becomes the whole queue. Boundary changes require a new owner decision; `dflow`/`app` and brand-new schemas are named out in §4 precisely so nobody has to guess.
- **A freestanding (non-required) CI check as the self-service merge guard.** Caught by the Grok review: unlisted checks do not block the guarded merge, and growing the required-context pin is a special merge-order problem. Phase B therefore invokes the classifier **inside** the guarded merge workflow's pre-lock steps (Step B3) instead.
- **Hand-editing `docs/verification/main-required-status-checks.json`.** Refused by `check-required-checks-preflight.mjs`; if a required context ever must grow, `scripts/update-required-checks.mjs` is the only route.
- **Changing the guarded-merge workflow's permissions or caller checks in this plan.** Nothing needs to change — the workflow is already dispatchable by any write-authenticated session and enforces everything itself. §8 writes that fact down; it grants nobody anything new.

## 8. Design decisions already made

**Locked (do not relitigate while executing):**

- **Safety floor** (§1 list): serial lanes, exact-head approvals, two reviewers for migrations, collision locks + version reservation, §6.4 gate, full orchestrator path for shared-object work. Locked by standing owner rulings 2026-09-11 and 2026-09-16, not by this plan.
- **The merge-dispatch right (locked 2026-09-17, Grok-review finding, verified against the workflow file):** any write-authenticated session may dispatch `guarded-migration-merge.yml` for a pull request that already has its exact-head approval and green required checks. The workflow — not the caller's identity — is the gate (it re-proves required checks, exact-head approval, lease and admission under its own lock). This is an operating-rule clarification of an existing capability, not a permission change, and it is the single largest immediate relief available: approved PRs stop aging while the orchestrator is busy. #2530's queue still owns the serialization end-state and supersedes this convention when it lands.
- **Phase B boundary = additive-only, `{crm, pim, dam}` schemas only.** Every named object in every statement — created objects, FK targets, objects referenced inside function and view bodies — must resolve to those schemas. Explicitly OUT: `plm`, `api`, `core`, `public`, `ingest`, `storage`, `dflow`, `app`, and any schema that does not already exist (no `CREATE SCHEMA` in the lane). Rationale: §4.1 already routes app-specific attributes to per-app extension tables; a change whose every named object lives in one app's schema can only break that app, which is the party best placed to test it.
- **Statement whitelist (mirrors the production classifier's `ALLOWLIST`, never looser):** `create table` without `REFERENCES`/`LIKE`/`INHERITS`; `create view`/`create function` with `SECURITY INVOKER`, no `DEFINER`, no `SET`, and bodies referencing only in-boundary objects; `create index`/`create sequence`; `create policy` + `enable row level security` on objects the same file set creates; `grant` only on new in-boundary objects, and **no grant to `anon`/`authenticated` on a `crm`/`pim` object unless RLS is enabled on it** (both schemas are browser-exposed per §8.1); and the #2758 `add_nullable_column` shape — `alter table <crm|pim|dam table> add column` with a nullable built-in type and no rewriting default — so the plan's own "new column on its own ext table" headline case is legal. Zero data statements, zero `drop`, zero `truncate`, zero `create or replace` of anything that exists on `main`.
- **Reuse the existing lexers.** The classifier consumes `inspectPrStructuralChange`/`inventoryDdlVerbs` and `sql_top_level_statements` + `ALLOWLIST` — a third parser is forbidden (§6.5).
- **Phase B changes NOTHING about preview/production policy.** A self-service PR inherits whatever the existing rules say for its content: classifier-clean low-risk SQL may use the #2758 ephemeral path; anything else previews as usual. No new carve-out is created here.
- **Scheduled jobs never write.** The hygiene report holds read-only permissions and files no issue, comment or label — the `author-lane-abandonment-audit.yml` discipline.
- **Work type stays `structural`.** The lane is a new ROUTE admitted for claims, never a new non-structural exit; `NON_STRUCTURAL_EXITS` is untouched, and the AGENTS.md §0.0-C prose gains a route row (not a work-type row) in the same pull request.

**Open (implementer judgment, with criteria):**

- Whether the hygiene report should exit non-zero when unlabelled/expired rows exist (proposal: report-only, exit 0, because the interactive `--queue-audit` already refuses loudly; make it an alarm only if the daily report proves too easy to ignore).
- Exact fixture corpus details beyond §10's list.
- Whether C2 finds anything to automate at all — its "no code change" outcome is equally acceptable (§9, Step C2).

## 9. The plan

### Phase A — queue hygiene (no gate behavior changes; safe to land independently)

**A1. Label the unlabelled issues.**
For each issue the audit prints under `UNLABELLED ISSUES` (2026-09-17 reading: #3193, #3191, #3187, #3181, #3174, #3149, #3148, #3146, #3125, #2530 — re-derive, the list will have moved):
1. Read the issue body. If it lacks a `db-work-scope` fenced block, write one with the authoring session if reachable, else draft it from the issue's own text and note that you did.
2. Apply the label: `gh issue edit <n> --repo u2giants/shared-db --add-label db-work`.
Order matters: scope block first, label second — the label is what makes the issue visible to admission, so an unverified label is a silent misroute. #2530 already carries a valid block (`work_type: documentation`, `route: repo-maintenance`); it needs only the label.
*You'll know it worked when:* a rerun of `--queue-audit` prints no `UNLABELLED ISSUES` block (the audit may still exit 2 for dispatchable work — that is the normal backed-up state, not a hygiene failure).

**A2. Close out expired claim #3089 — release, do not recover.**
The audit's `EXPIRED AUTHOR LEASES` block names claim #3089, lane 2, "PR merged, queued none". Expiry never releases object protection (`table plm.production_lane_canary` stays locked), so the claim must be explicitly closed. The guarded close-out for a claim whose PR is already merged is:

    node scripts/manage-migration-author-lanes.mjs --release-claim 3089 --owner <exact owner string from the claim's issue body> --confirm-finished

(Do NOT use `--recover-expired-claim-from-pr` here: that path requires an **open** PR with uncovered objects — it renews/extends a live lease; #3089's PR is merged, so it would refuse. If `--release-claim` itself refuses — owner mismatch, an open PR on the branch, or the author mutex — STOP and paste the refusal verbatim into #3199; a refusal here is a safety result, not an obstacle.)
*Gate:* the audit's `EXPIRED AUTHOR LEASES` block no longer lists #3089.

**A3. Ship the `Queue Hygiene Report` — a write-stripped command plus a no-write workflow.**
Two deliverables:
1. A new reporting subcommand in `scripts/manage-migration-author-lanes.mjs` — `--queue-hygiene-report` — that reuses the audit's issue/lease/pull-request reads but (a) never constructs the commenting IO (strip the write hooks exactly the way the abandonment audit does), and (b) reports ONLY the hygiene sections (`UNLABELLED ISSUES`, `EXPIRED AUTHOR LEASES`, `NOT ORCHESTRATOR WORK` aging). It must NOT exit non-zero merely because dispatchable structural work exists — a backed-up queue is the normal state this plan is fixing, not a hygiene failure.
2. `.github/workflows/queue-hygiene-report.yml`, copying `author-lane-abandonment-audit.yml` (NOT `domain-ownership.yml`): `on: schedule` (daily) + `workflow_dispatch`, `permissions: contents: read, issues: read, pull-requests: read` and nothing else, one job printing the report to the job summary. No comments, no labels, no issues filed. State that invariant in a file comment.
*Gate:* one green `workflow_dispatch` run against the live (backed-up) queue; the merged permissions block shows read-only.

### Phase B — the self-service additive lane

**Ordering rule (governed slot-1 review of PR #3204, finding 3): B1, B2 and B3 land as ONE change, or B3 lands first.** B2 alone would admit the route for claims while the boundary classifier is not yet merge-blocking — the current route gate would be replaced before its replacement exists. No pull request may extend admission (`evaluateAdmission`, `QUEUE_ROUTES`, `ROUTES_BY_WORK_TYPE`) to `self-service-additive` unless the same pull request also adds the merge-time classifier invocation of Step B3, or that invocation is already on `main`.

**B1. The boundary classifier.**
New `scripts/check-self-service-additive-lane.mjs` plus `scripts/check-self-service-additive-lane.test.mjs`. Input: the pull request's changed files and the text of any new `supabase/migrations/*.sql` files. Verdict `pass` ONLY when every rule in §8's locked boundary holds; any miss, any parse doubt, anything unrecognized → `refuse` with the named reason (fail closed). Implementation constraint: **consume the existing lexers** (`inspectPrStructuralChange`/`inventoryDdlVerbs`, `sql_top_level_statements`, the `ALLOWLIST` shapes) — do not write a third parser. Non-migration changes must be documents only (no workflow, script, or `.github` changes riding along). Every migration file must be NEW (its version absent from `main`). Write the tests dirty-first (§10 lists the required refusal fixtures, including the ones the Grok review contributed: `REFERENCES core.*`, `SECURITY DEFINER`, grants on RLS-less `crm`/`pim` tables, `CREATE OR REPLACE` of a live object, `dflow.*`/`app.*`, `.github` riding along, and both sides of the `ADD COLUMN` boundary).
*Gate:* `node --test scripts/check-self-service-additive-lane.test.mjs` green offline.

**B2. Admit the route — in the route machinery, not the exit table.**
In `scripts/manage-migration-author-lanes.mjs`: add `self-service-additive` to `QUEUE_ROUTES` and to `ROUTES_BY_WORK_TYPE.structural` (so `work_type: structural, route: self-service-additive` issues are valid); extend `evaluateAdmission` in `scripts/orchestrator-flow/admission.mjs` to accept the new route for claims; update the hard-coded `shared-db-orchestrator` checks in `admitIssue`'s legacy path (~:6738), `buildDynamicQueues` (~:913), `renewalIssueScope` (~:7420), and BOTH expand paths `expandActiveClaimFromPr` (~:7595) / `expandActiveClaimFromIssue` (~:7652) — `renewalIssueScope` or a self-service claim cannot renew its lease (caught by the governed slot-1 review of PR #3204), the expand paths or a self-service author who discovers a second object cannot expand the claim and the lane is write-once. `--queue-audit` must exclude the route from the orchestrator's refill list and print it in its own section (the way `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` is printed). Do NOT touch `NON_STRUCTURAL_EXITS` (the existing test "every work type keeps an exit" guards it, and shape work stays structural). Update the AGENTS.md §4 sentence ("Only `ready + structural + shared-db-orchestrator` can enter an author lane") and add the §0.0-C route row in the SAME pull request; add a small sync test asserting the script's route set and the AGENTS.md prose agree.
*Gate:* sync test green; audit shows the section without refilling from it; a claim through the route on a dry-run issue succeeds and its objects lock; expand-from-PR works on a fixture.

**B3. Enforce the boundary at merge time + write down the dispatch right.**
1. Invoke the B1 classifier from `.github/workflows/guarded-migration-merge.yml`'s **pre-lock steps** (alongside `check-sql.sh` and the lease checks), gated on the PR's linked issue carrying `route: self-service-additive`: if the route is declared, the classifier must pass before any lock is taken; orchestrator-routed PRs are unaffected. This makes the boundary merge-blocking without touching the required-context pin. (The alternative — growing `PINNED_REQUIRED_CONTEXTS` via `scripts/update-required-checks.mjs` — stays available if in-workflow invocation proves insufficient, and is the fallback, not the first move.)
2. Record the §8 merge-dispatch decision in the workflow file's comments and in AGENTS.md's §5 checklist prose: any write-authenticated session may dispatch the guarded merge for an approved, green PR.
3. Wire the B1 and B2 tests into `tools-offline-tests.yml` (explicitly — the PR #331 lesson).
*Gate:* a deliberately out-of-boundary fixture PR is refused before the merge lock; the dispatch-right text is on `main`.

**B4. Document the lane — including the banner that currently generates the traffic.**
AGENTS.md, in one pull request: (a) rewrite the front-matter banner ("Any other session with a STRUCTURE change opens a GitHub issue and stops", lines ~67–89 of the boxed rules) to carve the self-service exception — sessions with a qualifying additive `{crm,pim,dam}` change follow the lane instead of stopping; (b) extend the §0.0-C table with the route row and §4's operative summary with the lane's short description; (c) keep it tight — AGENTS.md has a size ceiling it has fought before. Update BOTH skill copies (`shared-db-change` in `~/.zcode/skills/` and `codex-shared-db-change` in `~/.agents/skills/`) with the author's exact command sequence: claim with `--claim --admit-issue`, author in a worktree, open the PR declaring the route, **run `--assign-reviewer` yourself for both review slots**, and for content the #2758 classifier does not cover, run the preview-dispatch commands (`--acquire-exclusive` / `--prepare-preview-dispatch`) yourself; when reviews are green, dispatch the guarded merge. Add rerouting guidance: an open `structural`/`shared-db-orchestrator` issue whose objects now provably fit the boundary may be re-scoped to the new route by its authoring session. Add the memory entry with wording that respects §4.3: *"read the plan's STATUS table first, then re-derive live queue/PR state with the named commands — never trust pasted counts."*
*Gate:* a cold fresh session, given only AGENTS.md and the skill, can correctly execute a qualifying change end-to-end and correctly refuse a non-qualifying one.

### Phase C — zero-touch wait chain for classifier-clean production

**C1. The hop table (do this first; it decides whether C2 has any work).**
Read `scripts/dispatch-production-apply.mjs`, `scripts/production_business_risk_gate.py`, `scripts/test_automatic_qualification_route.py`, and the dispatching workflows. Write `docs/agents/ephemeral-route-hop-table.md`: for every hop between "merge completed" and "production apply finished" on the #2758 ephemeral route — who or what performs it, what evidence it consumes, whether it is manual, and if manual, exactly why. Note that §5 of AGENTS.md already auto-qualifies and dispatches production after a successful rehearsal, and `test_automatic_qualification_route.py` already substitutes the ephemeral route — so the table's job is to find hops those automations do not already cover. Counts and states cited as the command that produces them (§4.3 ruling), never pasted numbers.
*Gate:* the table is merged and every hop has a named actor.

**C2. Automate pure mechanics only — or land "no code change."**
For each manual hop C1 finds: if it is evidence lookup/transcription with no judgment, automate it the way the existing automatic-qualification route works, with tests in the style of `scripts/test_production_preview_skip.py`, preserving every refusal. If the hop is a guard judgment (owner decision, business-risk conclusion, target proof), it STAYS manual and the table says so. **A fully justified hop table with zero code change is a successful C2 outcome, not a failure.** The ordinary #2758 path's constraint stands: no manual production command, no manual workflow dispatch, no bypass — automation extends the existing narrow path, it does not add a second one.
*Gate:* each automation lands with tests and the hop table updated in the same pull request; zero refusal semantics removed (each refusal still fires on its fixture); or the no-code-change outcome is recorded on the STATUS row with the table as its artifact.

### Phase D — landing

Update this plan's STATUS row after every landed step (the doing session owns de-staling, `session-docs-update` gate). When the tracking issue closes, retire the paired handoff file in that same change (§2.1-H: finished files are deleted, never marked done).

## 10. Tests required

- `scripts/check-self-service-additive-lane.test.mjs` — dirty-first, every fixture asserting REFUSE before any asserts PASS:
  - `CREATE TABLE crm.foo (… REFERENCES core.customer(id))` — created schema in-boundary, FK target out (the §6.5 hole);
  - `CREATE FUNCTION` with `SECURITY DEFINER` or a `SET` clause, or a body referencing `core.*`/`plm.*`;
  - `GRANT` to `anon`/`authenticated` on a new `crm`/`pim` table with no RLS enabled;
  - `CREATE OR REPLACE` of an object that exists on `main`;
  - anything in `dflow.*`, `app.*`, `plm.*`, `api.*`, `core.*`, `public.*`, `ingest.*`, `storage.*`;
  - `CREATE SCHEMA` (brand-new schemas are out of the lane);
  - a `.github`/workflow/script file riding along on the PR;
  - data statements (`insert`/`update`/`delete`/`merge`), `drop`, `truncate`;
  - `ALTER TABLE crm.customer_ext ADD COLUMN notes text` (nullable built-in — must PASS) vs `ADD COLUMN x int NOT NULL DEFAULT 0` and `ADD COLUMN y int REFERENCES …` (must REFUSE);
  - PASS fixtures: new `dam.*` table + its RLS enablement + policy + grant + an index on the new table; new `crm.*` view over only `crm.*` objects with RLS-grant ordering respected.
- `scripts/check-lane-route-sync.test.mjs` (Step B2) — parses the script's route set and the AGENTS.md prose; refuses on drift.
- Step C2 automations (if any): tests mirroring `scripts/test_production_preview_skip.py` (offline, fixture-driven, refusal-preserving), wired into the same workflow that runs their siblings.
- Existing suites that must stay green: `tools-offline-tests.yml` (`node --test tools/*.test.mjs` + its explicit scripts list, including `manage-migration-author-lanes.test.mjs`'s "every work type keeps an exit"), the `SQL migration guards` job, and the guarded-merge preflight — find the workflow that runs each before touching its subject, not after.
- Every new test file is explicitly wired into a workflow in the same pull request that adds it.

## 11. Constraints, standing rules, and gotchas

- **Worktree-only (§2.1-W):** every executing session works in its own `git worktree` cut from `origin/main`; nobody branches or commits in the shared checkout `C:\repos\shared-db`. Remove only your own worktree.
- **Task gates:** each session declares its class before work (`ai-task-gates start --class <class>`). Phase A1/A3/D are `prose` or `code`; Phase B/C sessions re-declare and expect escalation to the protected `shared-db` class — satisfy its proofs; acknowledgement flags do not bypass protected classes.
- **Rulebook PRs are not documents-only:** a PR touching `plan_*.md` (like this plan's own) needs the `.agent/contract.json` + `.agent/completion.json` evidence pair — implementation head first, then a commit touching only the two `.agent` files, bound via `--publish-contract` (learned live on PR #3204, 2026-09-17).
- **Never edit an applied migration, never reuse a timestamp (§4 rules 4–5)** — Phase B creates none, but its fixtures must not either.
- **Never weaken required checks** (also a #2530 constraint); growing the pin goes through `scripts/update-required-checks.mjs` only.
- **Scheduled jobs hold read-only permissions and write nothing** (A3); the abandonment-audit precedent is the citation if challenged. `--queue-audit` itself is NOT write-safe to schedule (it can comment and exits 2 on dispatchable work) — only the new write-stripped subcommand is.
- **The label is an admission trigger** (A1 order: verify scope block, then label).
- **Public repo (§6.14):** no personal identifiers, no secrets by value, licensed data stays out. Skills reference 1Password by vault + item title only (none expected here).
- **§4.2 connection proof** applies only if any step ever touches a database — none is planned; if one appears, stop and re-scope.
- **AGENTS.md size ceiling:** keep the banner rewrite and the route row tight.
- **Concurrent sessions:** `origin/main` moved twice during this plan's authoring; always `git fetch origin` and re-derive queue state rather than trusting this document's counts (§4.3).

## 12. Access and environment

- **GitHub:** `gh` CLI authenticated (owner account). Issue/PR/workflow writes go through it; reads inside workflows via `node scripts/gh-read.mjs api …` (§5.2-B: workflows never make bare `gh api` reads; Node gates use `scripts/lib/github-transport.mjs` + `scripts/lib/github-tree.mjs`).
- **Worktree:** `C:\repos\shared-db\.claude\worktrees\<slug>`; branch `zcode/…` or `codex/…` per session tool; cut from `origin/main` after a fresh `git fetch origin --prune`.
- **Running tests locally:** `node --test scripts/<file>.test.mjs` for Node; Python gate tests follow the invocation used by the workflow that wires them (check the workflow, don't guess).
- **Secrets:** none required. No Supabase tokens, no `PREVIEW_PROJECT_REF` reads, no ephemeral check runs except as read-only evidence in Phase C's audit.
- **Local checkouts of skills:** `C:\Users\ahazan\.zcode\skills\shared-db-change\SKILL.md` and `C:\Users\ahazan\.agents\skills\codex-shared-db-change\SKILL.md` (machine-local, not in this repo).
- **Paid second opinions:** `ai-muse` (currently failing — see the review record; incident `20260917T141421Z-edge-dev-muse-4088612`) and `ai-grok-review` (working; used for this plan's review at $0.43).

## 13. Definition of done, risks, open questions

**Definition of done:** A1–A3, B1–B4, C1–C2 landed on `main` with CI green and tests wired; `--queue-audit` shows the self-service section with the sync test guarding route/prose agreement; the guarded merge workflow enforces the boundary pre-lock; the hop table exists with every remaining manual hop justified (or C2's no-code-change outcome recorded); AGENTS.md banner + route row + both skills + memory updated; this plan's STATUS current at every merge; the tracking issue closed with evidence links; the paired handoff deleted in the closing change. Success is measured live, not historically: after Phase B has been in use, a qualifying app change merges with zero orchestrator-session turns — visible in the audit's self-service section and in `gh pr list` aging.

**Risks and rollback:** the classifier false-accepting an out-of-boundary change (mitigation: fail-closed reuse of the production lexers, dirty-first fixtures incl. the FK/DEFINER/RLS holes, merge-time enforcement; rollback: revert the route from `QUEUE_ROUTES` — refusals return instantly since fail-closed is the default); route drift between script and AGENTS.md (sync test); admission-machinery regressions (the lane script's existing test families, incl. "every work type keeps an exit", must stay green through B2); A1 labelling mistakes (scope-block-first order; a wrong label is removable and the audit re-runs); workflow write-permission creep (review the permissions block; the file's own comment states the invariant); merge-hop misuse (no permission changes — the workflow already re-proves everything; the §8 note only documents what exists). Every phase is independently revertible by pull request revert; none writes to any database.

**Open questions:** (1) whether the hygiene report should alarm (non-zero exit) on unlabelled/expired rows or stay report-only — decide after a week of daily runs; (2) whether C1 finds any automatable hop at all — C2's no-code-change outcome is acceptable by design; (3) whether, after #2530 lands and Phase B is proven, a second orchestrator session is still wanted — separate decision, deliberately not this plan's; (4) whether DesignFlow (`dflow`/`app`) should ever get its own lane — an owner decision this plan explicitly does not take.

---

## Self-audit (mandatory, per the implementation-plan standard)

1. **Could a brand-new session execute this without asking anything?** Yes — §9 names every file, command and subcommand with the exact guarded invocation (including the release-vs-recover distinction A2 learned from the Grok review and the write-stripped-report requirement A3 learned from it), §5 gives the current-state inventory with paths and line-approximate call sites, §12 gives access and invocation details, and every step has a verification gate. The judgment-shaped spots (B3's fallback ordering, C2's automate-or-document) state their criteria and their safe default.
2. **Does it carry everything the planning session knew?** Yes — §7 includes every rejected approach with its reason (including the two the Grok review independently endorsed and the freestanding-check trap it caught); §6 records the root cause, the merge-is-convention-not-gate discovery, and the classifier holes (FK targets, DEFINER, RLS-before-grant) with their source; §3 records the live evidence with the commands to re-derive it (§4.3 discipline); the review record preserves what Muse and Grok each contributed and what it cost.
3. **Is the ultimate goal clear enough to steer by when a step is wrong?** Yes — §1 states the outcome and the non-negotiable safety floor with the explicit "the floor wins — stop and flag it" instruction, and §8 separates locked from open decisions with dates, including the merge-dispatch right locked only after independent verification.
