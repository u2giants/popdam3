# AGENTS.md — §12, §12.1 (standing facts)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 12. Standing facts an incoming session must know

> **Re-homed from `COORDINATOR_INTAKE.md` on 2026-08-07, verbatim.** These ten rules
> used to live in the orchestrator queue file, and `AGENTS.md` §2 pointed at that file for
> them. The queue is being retired
> ([`plan_coordinator-queue-to-github-issues.md`](../../plan_coordinator-queue-to-github-issues.md)
> step 8), so they moved here first — otherwise retiring the file would have deleted live
> safety rules, **including the background-task-chip ban**, which is the rule that stopped
> a repeat of the 2026-07-31 four-way migration collision. Caught in adversarial review by
> Kimi K3 and ranked BLOCKING; it was correct.
>
> **This is a relocation, not a rewrite.** The text below is byte-identical to its last
> revision in `COORDINATOR_INTAKE.md`. Do not tidy it here.

Read these before you write anything. Several of them describe failures that
have already happened in this repo, more than once.

1. **One orchestrator.** All work is dispatched to sub-agents in isolated
   worktrees. If you were not started as the orchestrator, you are not it.
   **Resolve who it is with `--resolve`, never from memory — §11c.**
2. **SUPERSEDED 2026-08-14, RAISED 2026-08-25:** up to **five** unrelated
   migrations may be authored concurrently under exact object claims and atomic
   version reservations. Preview, merges and production promotion remain one at
   a time — the cap is throughput, never isolation. Use §4 rule 1.
3. **Never edit a migration that has already been applied.** The migration
   ledger already records that version as run, so editing the file changes
   nothing on any database that has seen it — it only makes the repo lie. Fix
   forward with a new migration.
4. **Duplicate 14-digit migration versions cause a SILENT SKIP.** Two files with
   the same version prefix: one applies, the other is quietly ignored with no
   error. This has happened twice — `20260722220000` and `20260728160000`. CI
   now blocks duplicate versions and backdated versions, but do not rely on CI
   to save you; reserve the version atomically through
   `scripts/manage-migration-author-lanes.mjs --claim` before creating the file.
5. **Never create background task chips for this repo — banned.** Four
   chip-spawned sessions recently authored competing `CREATE OR REPLACE`
   migrations against the *same* database function, three of them sharing
   version `20260731170000`. Because of rule 4 those would have silently erased
   each other. Chips spawn sessions that cannot see each other; this repo cannot
   survive that.
6. **The Supabase MCP server may be bound to PRODUCTION, and it takes no
   project parameter.** There is no way to aim it at preview. Call
   `get_project_url` FIRST and confirm which project you are actually pointed at
   before any other MCP call. All preview work goes through the Supabase CLI /
   psql, and you must verify `cat supabase/.temp/project-ref` immediately before
   every push.
7. **Preview (`rjyboqwcdzcocqgmsyel`) is a SHARED, MUTABLE resource** holding a
   full clone of production data. It is currently **NOT a clean baseline** —
   other sessions have written to it. Never assume it is empty, never assume it
   matches production, and treat anything you apply there as visible to everyone
   else.
8. **Documents in this repo go stale within the hour.** Verify against the live
   repo, not against what a Markdown file says.
9. **Property codes are NOT globally unique — never resolve a property by code
   alone.** Licensor → Property is a **parent-child** relationship and the *same*
   code can exist as separate property rows under many different licensors at
   once. The schema enforces exactly this:
   `core.property … unique nulls not distinct (licensor_id, code)`
   (the `core.property` constraint in
   `supabase/migrations/20260621150815_app_core.sql`). **`core.licensor` is
   different** — its constraint is `unique nulls not distinct (code)`, so
   **licensor** codes are global. The two are routinely confused, and confusing
   them produces instructions like *"re-parent code `CC` under Disney"* that are
   not meaningful. Owner-confirmed by Albert Hazan, **2026-08-06**. See also
   `AGENTS.md` §6 (merch-group codes are unique only within
   `(division, mgTypeCode)`) and `fix_item_taxonomy_wiring.md`.
10. **Worktree counts in this repo are per-MACHINE and go stale immediately — always
    re-measure, never quote.** Measured on **`al8960ofc`, 2026-08-06**:
    **3 worktrees** — the `C:\repos\shared-db` main checkout plus two live
    sub-agent worktrees (`.claude/worktrees/cutover-plan`,
    `.claude/worktrees/stale-sweep`), both **held by running agents**. Verified
    with `git worktree list`. **Every earlier count is SUPERSEDED as a statement
    of today's state** — 18 and 22 (2026-07-31), 23, 33/34 (2026-07-31 late),
    51/52 (2026-08-03/05), 16 (2026-08-05), and 1 (2026-08-06 01:49Z). They were
    each true when written, on the machine that wrote them; they are history, not
    inventory. The drop from 51 to 1 was an **authorised sweep**, not a mystery —
    resolved by intake PR #455 (`9a933c8`) and recorded in
    `HANDOFF.d/2026-08-06T0149Z-al8960ofc-orchestrator-skill-repair.md` §4. **Do
    not sweep or remove any worktree on the strength of a number in a document**,
    and never remove one that is dirty, locked, or held by a live agent (B2.3).

### 12.1 More standing facts, added after the relocation (2026-08-12, issue #772; item 15 added 2026-08-13)

> The ten rules above are a **frozen, byte-identical relocation** from the retired
> `COORDINATOR_INTAKE.md` and must not be tidied. The items below are **new** and are recorded
> here instead. Each one has already misled at least one session. Numbering continues from 10.

11. **Preview and production have diverged IN BOTH DIRECTIONS. Neither predicts the other.**
    Verified by object on **2026-08-11**: preview `rjyboqwcdzcocqgmsyel` holds **all 23
    `plm.pmt_*` tables**, with both prerequisite migrations genuinely applied, and production
    `qsllyeztdwjgirsysgai` holds **ZERO** of them. In the other direction,
    `20260810140000_production_lane_canary` **is applied on production and is NOT applied on
    preview**. Both ledgers are also applied **out of order**, in different ways, so a high max
    applied version does **not** mean everything below it is applied. Any claim of the shape
    *"preview is production minus N migrations"* is wrong. A passing preview rehearsal means
    *"this behaved correctly on preview"* and never *"this will behave correctly in production"* —
    **post-apply verification against production objects and behaviour is not optional.** This has
    misled at least three sessions.

12. **The advisory model review in the production apply is a permanent silent no-op.** The step
    *"Production apply review (advisory model verdict + hard guards)"* reports **"NOT RUN —
    `ANTHROPIC_API_KEY` is not configured on this repository"** and is `continue-on-error`. No HTTP
    request is made. **A green production apply run does NOT mean a model reviewed the
    migrations.** The hard guards in that same job are real; the model verdict is not. Tracked as
    #709 and #737.

13. **The migration history is not self-contained — do not expect a clean replay.** Replaying all
    429 migrations into an empty database **applies 363 and fails 66**, because this repo was
    adopted on top of an already-populated database: `public.assets`, the legacy popdam tables and
    the `dflow.*` mirrors exist in preview and production with **no migration here creating
    them**. A CI bootstrap (PR #759) closes most of the gap — quarantined contract files 26 → 11,
    passing tests 14 → 29, replay failures 66 → 10. It lives at `supabase/ci-bootstrap/` and is
    **deliberately not a migration**: a file inserted at the front of an already-applied sequence
    can never re-run, and a back-dated version is exactly what Guard B exists to stop. See also
    §10.1.

14. **Freeze merges before every production apply.** The production apply is pinned to an exact
    `origin/main` SHA. On **2026-08-11** that pin refused **two separately approved runs**, each
    because PRs merged between staging and the owner's click. Nothing was written either time —
    the guard worked — but two owner approvals were wasted, and the third only landed under a
    deliberate merge freeze. **Announce a freeze, hold every merge from staging until the run
    finishes, then release it.** This is standard practice, not an improvisation.

15. **The single-orchestrator rule is scoped to STRUCTURE (owner ruling §0.0-B, 2026-08-13).**
    Rules 1 and 2 above ("one orchestrator", "unlimited concurrent migration authors, each on exact object claims") govern changes to the
    *shape* of the database. They do **not** make an application session's ordinary row writes
    into orchestrator work, and a session must not open an issue or hand over merely because its
    feature writes data. The single exception is curated Master Data under §6.4, which stays
    gated. §4.2's connection-target proof still applies to every data write regardless.

16. **REPOSITORY MAINTENANCE IS NOT ORCHESTRATOR WORK (owner ruling, 2026-08-21, issue #1366).**
    The shared-db orchestrator accepts, dispatches, reviews, merges and promotes **structural and
    schema work only**. `repo-maintenance` and `documentation` are performed by a **separately
    started repository session** and are never an orchestrator assignment — not even to dispatch.
    `security-settings` goes to Albert, because it needs authority the orchestrator does not have.
    `--queue-audit` lists these under `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` for audit
    visibility only; that list is **not** a worklist.

    This ruling narrowed the boundary rather than restating it. Until 2026-08-21 all three exited
    by `fork`, which reads as "the orchestrator hands this out", and on that basis an orchestrator
    session accepted a repository-maintenance planning task. Do not route such work back to the
    orchestrator, and do not read a `fork` in an old document as current.

    **It did not touch curated Master Data.** `curated-master-data` still exits by `fork` under
    §6.4 and is still governed inside this repository. Extending the ruling to it needs a separate
    explicit decision from Albert. See `NON_STRUCTURAL_EXITS` in
    `scripts/manage-migration-author-lanes.mjs` for the enforced form.

17. **`required_status_checks.strict` is FALSE on purpose (owner ruling, 2026-08-19, issue #1286).**
    Requiring every branch to be up to date before merging restarted the full check suite on every
    open branch after every unrelated merge, costing roughly 50 minutes a day. Albert turned it
    off deliberately. **It is not drift and must not be "fixed".**

    What actually re-checks a migration pull request against current `main` is
    `.github/workflows/guarded-migration-merge.yml`, whose required context
    `Migration guarded merge authorization` re-runs collision, exact-head review, and—when the
    pull request changes a migration—lease validation on a head that contains current `main`,
    while holding the merge lock. **Every executable, rulebook, configuration, workflow, test,
    migration, and mixed pull request uses that guarded merge lane.** A non-migration pull request
    needs no migration-author claim, but it is never auto-authorized by the lease workflow. A
    proven documents-only pull request instead receives the same required status from the
    base-only lightweight path described in rule 18. When production
    acquires its lock, it revokes every open pull request's earlier merge authorization before
    releasing that lock, so a stale green result cannot bypass the production freeze.

    Older documents — including `docs/owner-rulings.md`'s 2026-08-06/14 entries and
    `plan_orchestrator-workflow-gaps.md` — describe the earlier `strict: true` state. That history
    is real and is preserved; it is **superseded** as a current instruction. Only issue #1286
    governs whether strict mode is ever reconsidered.

18. **A DOCUMENTS-ONLY PULL REQUEST DRAWS NO DATABASE REVIEWER (owner decision, 2026-09-02, issue
    #2102; lightweight status path #2715).** A pull request whose changed files are **all** prose
    documents still runs **every** automated check. It receives the required
    `Migration guarded merge authorization` status from
    `.github/workflows/documents-only-merge-authorization.yml` without dispatching the database
    guarded-merge workflow or consuming a slot from the small external **database reviewer pool**
    that exists for migrations.
    PR #2034 — a two-file documentation change — spent two reviewer draws, two dead-reviewer
    replacements and three full review runs, and PR #2070 repeated the shape. That capacity belongs
    to migrations.

    **Rulebook files are NOT documents for this purpose and keep the full treatment:** `AGENTS.md`
    (and `CLAUDE.md`), anything under `.claude/skills/` or `skills/`, and plan files
    (`plan_*.md`). They instruct every later session, so a bad edit to one of them is as dangerous
    as a bad migration. One non-document file of any kind — a `.sql`, a script, a workflow, a test,
    a config file — removes the exemption from the whole pull request.

    **Review is not removed, and this is not a merge exemption.** The review of PR #2034 caught a
    real customer order number heading into this **public** repository, so the content risk is
    real; what changed is only which pool answers for it. The automated checks and the guarded
    merge lane still answer, and a refusal already recorded at the exact head still blocks it — the
    exemption is from *drawing* a reviewer and dispatching the database merge workflow, never from
    *answering* a review already recorded for the exact head or from running automated checks.

    Enforced, not documented: `scripts/lib/documents-only-change.mjs` is the single deterministic
    classifier, listing the rulebook exclusions explicitly and failing closed whenever the
    changed-file list is empty, unreadable or absent. The required-status adapter
    `scripts/check-documents-only-merge-authorization.mjs` separately permits plan files and
    declarative routing pointers in AGENTS, task-router, and skill files. It inspects the actual
    changed hunks and accepts only link-only list/table rows whose labels literally name the local
    Markdown target; free-form or behavior-changing instructions stay on the guarded code path. An
    ordinary mixed/code pull request gets a separate, green `Not applicable` diagnostic (and a green
    job) that directs it to guarded code checks without competing for the required context (#2838:
    a routine red trained everyone to ignore this check). Red on that diagnostic now means a genuine
    refusal: a moved head, a production freeze, or an unreadable comparison. If the same commit already carries this workflow's lightweight success, or
    if its base is retargeted, the command explicitly revokes that required status before guarded
    checks re-authorize the new comparison. Thus an unreadable,
    over-ceiling, retargeted, or non-prose comparison cannot strand an absent or stale-green result. The
    lightweight workflow is restricted to `main`, independently proves the protected base repository
    and branch before checkout, checks out only that trusted base, classifies the complete pull-request
    file list, then reclassifies an immutable
    exact base-to-head comparison (refusing GitHub's file ceiling) and rechecks the live PR
    while holding only the global coordination mutex and proving the production ref absent before
    it writes success. This repository-maintenance command never claims an author or reviewer lane,
    never acquires preview, merge, or production, and emits no structural lifecycle event. Unknown or
    non-document changes receive no status from that path. `scripts/check-exact-head-approval.mjs`
    — the gate the guarded merge waits on — uses the classifier to skip the reviewer requirement, and
    `--assign-reviewer` in `scripts/manage-migration-author-lanes.mjs` refuses to draw for such a
    pull request. `scripts/lib/documents-only-change.test.mjs` fails if the classifier exempts a
    rulebook file or a mixed change.

---

19. **CI RUNS ON BLACKSMITH (owner ruling, Albert Hazan, 2026-09-23).** "anything that's queued and not actually running, send to blacksmith. the merge rules are hereby changed: a Blacksmith run produces a main check" — Albert Hazan, chat, 2026-09-23. GitHub hosted runners were starved (62 runs queued). Workflows use `blacksmith-2vcpu-ubuntu-2404`; a check produced on a Blacksmith runner satisfies the same required status as a hosted-runner check. **Credential-holding jobs run there too:** "the outside runner is not run by an outlaw. we can send production-credential jobs there." — Albert Hazan, chat, 2026-09-24 (issue #3473). Staying on `ubuntu-latest`: the two registered queue-sensitive lanes, their `Queue-sensitive aggregate` (it must not share a pool it exists to watch), and `database-contract-tests.yml`'s `classify` job. `scripts/orchestrator-flow/runner-lanes.*` governs only those registered lanes, which remain GitHub-hosted, so it is unchanged.
