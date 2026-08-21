# AGENTS.md §4 — the five anti-collision rules, full text

> **Active hardening plan:** [`../../plan_multi_agent_database_coordination_hardening.md`](../../plan_multi_agent_database_coordination_hardening.md), issue #1366. Read its STATUS table first. It preserves the rules below while adding read/write dependencies, proven prerequisites, provider-neutral work contracts, lifecycle traces, recoverable fenced stage leases, and an opt-in Supabase branch pilot. Its implementation is repository maintenance outside the structure/schema orchestrator.

Relocated from `AGENTS.md` on 2026-08-20 (issue #1331, PR #1212) so the router stays under its
80 KB ceiling. **Text unchanged, section number unchanged.** `AGENTS.md` §4 carries the operative
summary and points here; where the two differ in wording, `AGENTS.md` wins.

## 4. The five anti-collision rules (shared database)

1. **Up to three unrelated migrations may be authored at once. Preview, merges,
   and production promotion remain one at a time.** This is Albert's owner ruling
   of 2026-08-14. Concurrent authors must use isolated worktrees, exact object
   claims and centrally reserved versions. A fourth author is refused.

   **Do not open a migration file first.** Acquire an author lane, object claim
   and unique 14-digit version as one dispatch operation:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --claim \
     --task "<issue and outcome>" --owner "<agent/session>" \
     --branch "<branch>" --worktree "<absolute isolated worktree>" \
     --objects "<every exact object written, comma-separated>"
   ```

   Allocation is serialized across computers by a GitHub-backed lock. The command
   fails closed if claims are unreadable, objects overlap an open claim or pull
   request, GitHub is unavailable, version reservation fails, or three author
   lanes are occupied. Older claims count until they are explicitly released.
   The created issue body is authoritative and machine-readable. Never hand-edit
   its fenced blocks. The permanent version ref prevents reuse even after a lease
   ends; the lease only controls who occupies an author lane.

   Audit lanes with `node scripts/manage-migration-author-lanes.mjs --audit`.
   Audit and refill the three dynamic queues with
   `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Every open
   `db-work` issue must contain one authoritative block:

   ````text
   ```db-work-scope
   status: ready
   work_type: structural
   route: shared-db-orchestrator
   priority: 100
   depends_on:
   objects:
     - table schema.name
   ````
   ```

   Status, work type, and route are independent. Allowed statuses are `ready`,
   `blocked`, and `owner-decision`. Allowed work types are `structural`,
   `curated-master-data`, `application-data`, `source-data`, `repo-maintenance`,
   `documentation`, and `security-settings`. There is no default route. Only
   `ready + structural + shared-db-orchestrator` can enter a migration-author
   lane, and it must name every exact database object. Non-structural work must
   not claim database objects.

   **Work whose exit is REJECT — `application-data` and `source-data` — must
   also carry a `return_to:` line naming the owning repository as an
   `owner/repo` slug** (AGENTS.md §0.0-C). `curated-master-data` does NOT: §6.4
   governs it inside this repo, so it forks to a sub-agent here and never
   leaves:

   ````text
   ```db-work-scope
   status: ready
   work_type: application-data
   route: application-session
   return_to: u2giants/popdam3
   priority: 40
   depends_on:
   ````
   ```

   A malformed slug is a hard parse error; a missing one is reported as
   `NO RETURN ADDRESS` and makes `--queue-audit` exit `2`. Return the issue with
   `node scripts/manage-migration-author-lanes.mjs --return-issue <n>`, which
   files it in the owning repository first and only then closes it here. Never
   close a rejected issue by hand. `return_to` is forbidden on structural work,
   which stays here.

   Outside-sourced writes into curated `core.*` Master Data use
   `work_type: curated-master-data` and
   `route: curated-master-data-governance`. This preserves §6.4 governance but
   never grants a migration-author lane. Source-data review such as NBCU rights
   classification uses `work_type: source-data` and
   `route: source-data-session`, even while `status: owner-decision`. Changing
   only the status after Albert answers can never change its owner route.

   Exact object overlap forms a serial queue; unrelated object
   groups fill up to three author lanes. When a claim releases, rerun the queue
   audit and dispatch every reported `REFILL REQUIRED NOW` issue in the same
   turn. Never wait for Albert to ask or approve routine dispatch. Ask him only
   for a genuine business ruling or material production risk. Recompute after
   every merge. Preview and merge stay globally serialized.

   An empty author lane is valid only when the audit has classified every open
   `db-work` issue and reports no eligible issue for it. Unclassified, malformed,
   blocked, owner-decision, and every non-structural work type never consume a
   lane; unclassified or malformed issues also prevent a claim that no work
   exists. While an author waits for CI, review, preview, or merge, continue safe
   local work or prepare the next queued issue without creating overlapping
   migration files.

   After an issue reaches an exact reviewed head, atomically assign its external
   reviewer with:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --assign-reviewer \
     --issue <issue> --pr <pr> --head-sha <exact-head>
   ```

   For new assignments, the machine-independent cursor rotates Grok 4.6 → GLM
   5.2 → Kimi K3 → repeat. Qwen 3.8 Max is paused until an explicit owner
   instruction restores it. Historical Qwen assignments, failures, and
   replacement evidence remain readable and must be recovered or replaced
   through `scripts/manage-migration-author-lanes.mjs`, never hand-edited. Use
   only the wrapper returned by the manager and its fixed model settings. Reuse
   one named session for rebuttals. Require
   a current exact-head re-read and `APPROVE` or `REVISE` with evidence. Verify
   every claim independently. Relay disagreements with
   `templates/delegation/debate-turn.md`, stopping at agreement or the initial
   review plus three rebuttals. If material disagreement remains, stop the merge
   and ask Albert one concise decision. Never send secrets or licensed rows.

   **A verdict with no coverage statement is not review evidence** (issue #1220,
   fixed wrapper-side in `ai-devops` PR #43). Two wrappers could finish a run
   having produced no findings and no verdict at all and still exit 0, and one
   printed a complete five-finding review as a bare two-line `VERDICT: APPROVE`
   because it discarded everything above the verdict heading. The wrappers now
   emit the whole body and exit non-zero when no verdict was reached, so the
   evidence is guaranteed to be PRINTED. Nothing can guarantee it is READ, and
   that half is this repository's job:

   - **Never record a bare verdict.** An `APPROVE` with no findings and no
     statement of what was actually examined is a wrapper or provider failure,
     not a clean review. Treat it as `verdict=none` and use
     `--replace-failed-reviewer` exactly as for a transport failure.
   - **Require the reviewer to say what it covered** — which files, which
     migrations, which conditions — not merely what it concluded. A review whose
     coverage cannot be checked cannot be relied on to have missed nothing.
   - **If a wrapper's stdout looks truncated, read the raw provider stream before
     recording anything.** The failure that prompted this rule was recoverable in
     full from `stream.jsonl` after the wrapper had already printed two lines. Both
     recovered reviews were posted to their PRs in full, with the recovery method
     stated, so the audit trail records what was checked rather than the wrapper's
     summary of it. Do the same.
   - **Silence is never approval.** The failure mode here is silent and biased
     toward "looks approved", which is exactly the shape that gets waved through
     under time pressure.

   **Reviewer transport failures never pause the queue.** Run reviewer wrappers
   from the full-access orchestrator process, not from a delegated sandbox. Before
   starting, prove the selected wrapper can read its own authentication file and
   create its session directory. A permission denial, missing authentication,
   provider quota error, or wrapper timeout with no verdict is a transport failure,
   not a review. Stop that process, record `verdict=none` and `artifact=none`, and
   immediately use `--replace-failed-reviewer` with the matching terminal failure
   code. Continue with the manager-selected replacement from the full-access
   orchestrator in the same turn. Never leave an author, preview, merge, or
   production lane waiting on a reviewer process that cannot authenticate or
   write its own state. A real `REVISE` verdict is not a transport failure and
   must never be replaced.

   Append objective reviewer evidence through an `ai-devops` PR to
   `models_comparison_grok_kim_glm.md`: issue/PR, requested and proven model,
   verdict, confirmed/disproved findings, defects, false positives, policy/tool
   adherence, continuity, latency, turns, and only metrics the wrapper reports.
   Kimi headless metrics and returned model are unavailable; never invent them.
   After review approval, green checks, preview proof, and guarded merge, the
   production workflow runs `scripts/production_business_risk_gate.py`. It
   derives the result from the exact merged PR and required checks, immutable
   review artifact, pinned preview-apply artifact and ledger, current-main SQL,
   and the activation record. Caller-written booleans or prose are never
   evidence. Automatically promote only when those governed records prove: no
   existing data is deleted or permanently rewritten, no expected user downtime,
   no material access change, a tested credible recovery path, and no unresolved
   material objection. Ambiguous SQL stops for Albert. Ask him one plain
   business-risk question. Never ask him to approve migration numbers, project
   identifiers, SQL, or other technical details. This policy cannot authorize
   its own rollout. `config/production-risk-policy-activation.json` remains
   inactive, and the older exact-approval rule remains binding, until #1015 is
   independently reviewed, both PRs are merged, the installed skill hash matches
   canonical ai-devops, and the forward-test proof hash is recorded. The gate
   verifies those facts again before it can permit automatic promotion.
   Record Qwen High as requested, but never override the wrapper's qualified
   fixed configuration.

   Audit reports malformed claims without hiding the healthy ones; allocation
   still refuses while any malformed claim exists. **Expiry never unlocks an
   object.** Renew active work or explicitly release a claim after proving its
   branch/worktree/PR is finished. Cleanup may report stale work, but it must not
   silently close it. A reserved version is never freed for reuse because an
   abandoned version may already exist in preview's ledger.

   **If you cannot list the objects up front, your task is read-only** — and read-only work cannot
   collide. Close your claim when the work merges or is abandoned; an open claim
   is a lock on those objects, not a note.

   This runs BEFORE the work. The `Cross-PR object collision` CI check is the
   backstop AFTER it, and by the time that one fires, somebody's session is
   already wasted — on 2026-07-31, three of four were.

   Before preview and again before merge, acquire the exclusive GitHub-backed
   `preview` or `merge` lease. Instructions in chat are not a lock. Fetch `origin/main`, update the branch
   from newly merged `main`, and re-run the version/object checks and all existing
   SQL/cross-PR guards. A clean author lane does not grant access to preview.
   The orchestrator grants the single preview lane, then the single merge lane.
   Release each stage lease explicitly when that stage ends. Required CI rejects
   a migration PR unless its exact version and normalized objects match a live,
   branch-bound author claim; merge CI also requires that PR's merge lease.
   **The concrete symptom when this rule is broken:** the preview branch is
   persistent, so its ledger holds every branch that ever ran `db push` —
   including unmerged ones. A `main`-based checkout then cannot dry-run against
   preview at all; it aborts with `Remote migration versions not found in local
   migrations directory` and suggests `supabase migration repair --status
   reverted …`. **Never run that repair** — those rows belong to another team's
   applied work, and clearing them leaves the objects in place so their next
   push collides. Land or coordinate the other branch instead. Full procedure:
   [`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](docs/ai-session-instructions/shared-supabase-branch-workflow.md)
   → "When preview holds another workstream's unmerged rehearsal". A migration
   left rehearsed-but-unmerged blocks everyone, so **open its PR the same
   session** (seen 2026-07-27: 17 PopPIM migrations blocked all preview
   dry-runs until PR #271 landed).
2. **Preview database first. Production never receives untested schema.** Apply
   every migration to the preview branch, prove it works, *then* promote to
   production (`qsllyeztdwjgirsysgai`). The preview project ref is NOT written
   down here: preview is rebuilt from time to time and its ref changes when it
   is — `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18. The current ref lives
   in the repository variable `PREVIEW_PROJECT_REF`, and **every** workflow that
   targets preview reads it from there. An unset variable is refused, never
   defaulted. The older workflows that used to hard-code the deleted ref
   (`generate-database-types.yml`, `preview-ledger-orphan-reconciliation.yml`,
   the `coldlion-*` workflows) were converted to the same pattern, and
   `scripts/check-workflow-preview-ref.test.mjs` now fails the *Shared Supabase
   Migrations* guard job if any workflow pins a preview ref literal again.

   **Post-merge rehearsal (the normal order).** Merge first, then rehearse on
   preview from merged `main`, then promote. Dispatch *Shared Supabase
   Migrations* with `target=preview`, `mode=apply`,
   `merged_preview_source_pr=<the merged PR>`, `commit_sha=<the current main
   tip>` and `preview_allowlist=<the exact versions>`. Do NOT pass `claim_pr`:
   a merged pull request has no live author claim, and naming both is refused.

   The exclusive preview lock for that run is authorised by **merge-commit
   ancestry of the main tip**, not by a live author claim — the guarded merge
   released the claim and deleted the branch, which is exactly why the rule
   above used to be unexecutable (#1208). It is the same `refs/db-coordination/preview`
   lock, so it is mutually exclusive with an ordinary preview run and with a
   historical recovery — every lane that writes preview holds one ref, and this
   lane adds no second door.

   **What that lock does NOT do, stated exactly.** It does not exclude a merge
   or a production promotion. `EXCLUSIVE_REFS` gives merge and production their
   own refs, and only two cross-checks exist — both inside `acquireExclusive` in
   [`scripts/manage-migration-author-lanes.mjs`](scripts/manage-migration-author-lanes.mjs),
   findable by their refusal text rather than by a line number, which drifts:
   a promotion waits for the merge ref (`a guarded merge is active; production
   promotion must wait`), and a merge waits for the production ref
   (`production promotion is active; merges are frozen`). Nothing in
   either direction reads the preview ref. That is pre-existing behaviour of the
   ordinary preview lane, unchanged here — an earlier draft of this section
   claimed the exclusion existed, and it never did. Promotions are serialised
   among themselves by the workflow `concurrency` group, not by this lock.

   The lock fails closed if the PR is not merged, if its
   merge commit is not carried by the main tip, if the named versions were not
   *added* by that PR, or if GitHub state cannot be read.

   The evidence that run uploads carries the exact commit it checked out and the
   preview project ref it wrote to, and the production gate checks both. A
   rehearsal against a preview database that has since been rebuilt is therefore
   no longer proof for a production write.

   **A rehearsal runs ONCE. Do not re-run it — recover it.** An applied version
   can never be applied again, so there is no second bite. If the versions are
   already in preview's ledger, both ways of trying again are refused, and both
   refusals are correct:

   * **A fresh dispatch** fails at *Hard guard preflight*: the versions are now
     in preview's ledger and the guard refuses to re-apply an applied version.
     The run's conclusion becomes `failure`, and the production gate accepts
     evidence only from a run whose status is `completed` and whose conclusion is
     `success`.
   * **GitHub's "Re-run jobs"** keeps the same run id, so a second
     `preview-migration-apply-<sha>` upload lands on that one run. The gate
     requires *exactly one* apply artifact per run — two make the applied commit
     ambiguous, and an ambiguous commit is not provenance — so it refuses rather
     than pick one.

   ⚠️ **SUPERSEDED IN PART, 2026-08-20 (#1321): the historical-recovery lane
   CANNOT recover a POST-MERGE rehearsal — i.e. evidence produced by the order
   this very document mandates.** The lane pins the original run's producer files
   to the AUTHORING PULL REQUEST'S MERGE COMMIT. A post-merge rehearsal runs from
   a LATER main tip, so any producer file that changed in between (ten did, in one
   day) makes the pin fail. Measured on `20260819011639`: merged, correct,
   six-times reviewed, and refused — *"produced evidence with a different
   .github/workflows/shared-supabase-migrations.yml than the merge commit"*. No
   database write occurred. The only way through was to **supersede** the
   migration with byte-identical SQL (`20260820142402`), which costs a migration
   version and a fresh review round.

   ⚠️ **NARROWED, 2026-08-20 (orchestrator marker #1338).** The claim above is too broad. The lane
   **DOES** recover a post-merge rehearsal **when the rehearsal ran AT the authoring merge commit**.
   Measured that day on `20260820165926` (PR #1335): merged via the guarded lane to `1247d125`,
   rehearsed immediately from that exact tip, then an unrelated PR (#1340) moved main and changed
   `scripts/manage-migration-author-lanes.mjs`. The production gate refused on the producer-file
   pin, re-rehearsing was impossible (`BLOCKED: already applied on production`), and the recovery
   lane then **succeeded** — run 32402833543 — because the rehearsal commit *was* the authoring
   merge commit. Production applied as run 32402996954.
   **So the discriminator is not pre-merge versus post-merge. It is whether anything merged BETWEEN
   the authoring merge commit and the rehearsal.** `20260819011639` failed because ten producer
   files changed in between; it may well have been recoverable had it been rehearsed promptly.
   **Practical rule: rehearse in the same breath as the merge.** Do not pay a supersession — which
   costs a version and a fresh review round — before trying the lane.

   **The paragraph below is still correct for a
   PRE-merge rehearsal, which is what the lane was built for. Read #1321 before
   relying on it for anything rehearsed after its pull request merged.**

   First check whether you need a second run at all: if the original rehearsal
   completed successfully, its artifact is still the proof, and the promotion
   should simply name that run in `preview_run_id`. If it did not, **the way
   forward is the historical-recovery lane, not a weakened guard.** Dispatch
   `target=preview`, `mode=apply` with `historical_preview_source_pr` (or
   `historical_preview_source_pr_map` for a batch authored across several pull
   requests), **`historical_preview_original_run_map`**, plus
   `commit_sha=<current main tip>` and the same `preview_allowlist`. That lane
   performs **no database write**.

   `historical_preview_original_run_map` is `version:runId` pairs naming the
   preview run that **originally applied** each version, and it is **required**.
   It is not bookkeeping: because a recovery run writes nothing, it can produce
   no content manifest of its own, so the production gate goes and reads the
   named run's manifest and byte-compares the digest it recorded against the file
   on exact main. Find the run id in the Actions history — it is the successful
   `apply` run whose artifact is `preview-migration-apply-<sha>` for that batch.

   **The named run is pinned on BOTH of its commits.** The commit it advertised
   in its artifact name *and* `head_sha`, the ref GitHub read the workflow file
   from, must each be a commit of the authoring pull request or a commit exact
   main contains, and each must carry the **same producer files as the merge
   commit of the pull request that authored that version** — a commit the gate
   re-derives from GitHub, never one the promoter supplies. Without that second
   pin, anyone who can dispatch this workflow could push a branch whose copy of
   it performs no database write, hand-write a ledger delta and a content
   manifest naming exact main's digest, name that run as the "original apply",
   and promote bytes preview never executed. Pinning the two commits **to each
   other** — the #1213 round-5 wording, removed in round 7 — was a no-op: one
   commit used for both pins compared nothing at all (round 6, finding 1).

   A producer file that **did not exist yet** at the merge commit is skipped,
   and only when it is absent from *both* commits. The producer list grows, so
   an old recovery cannot be required to carry files added later; a file present
   on one side only is a real difference in the machinery that ran, and is
   refused. Absence is read from each commit's **git tree**, so it is a proved
   fact rather than an inference from a failed API read, and an unreadable or
   truncated tree refuses (#1213 round 7, finding 1).

   **What this lane proves, stated exactly.** A real, successful run of this
   workflow, whose dispatch ref and whose checkout both carry the producer code
   of the merge commit that landed the version, added each named version to
   *a* preview ledger and recorded a digest equal to the bytes on exact main; and
   a merged pull request added each version.

   **What it does not prove, and do not let anyone tell you otherwise.**
   (a) That preview's *catalog* matches its ledger — a half-applied or
   hand-repaired preview looks identical from here.
   (b) That **today's** machinery produced the evidence. The original run's
   producer code is pinned to the authoring pull request's **merge commit**,
   never to today's main, because an older commit necessarily carries older
   producer files and that rule would refuse every genuine recovery. It is *not*
   pinned to the run's own checkout: round 6 of the #1213 review showed that one
   attacker-chosen pull-request commit used as both the dispatch ref and the
   checkout compares nothing at all, and this repository squash-merges, so every
   commit ever pushed to a pull request stays citable forever.
   (c) **Which preview database it was.** The original run is deliberately not
   required to bind to the current `PREVIEW_PROJECT_REF`: preview
   `rjyboqwcdzcocqgmsyel` was deleted and rebuilt as `mvpkijzfmfcxhnzqogzs` on
   2026-08-18, so requiring it would refuse every recovery that exists, including
   the stranded merges this lane was built for. A binding it *does* carry must be
   readable and must not name the production project. The residual: the ledger
   half of this lane can be satisfied by one database and the byte half by
   another if a version reappears in the current preview by restore, clone, or a
   later apply of different bytes.

   The earlier wording here — "as strong as the claim lane was on the day of that
   rehearsal" — was **withdrawn as false** in #1213 round 5 and must not return in
   any file. The claim lane pins both of a run's commits to exact main, so a
   doctored intermediate commit can never be the promoted rehearsal; this lane
   pins them to the authoring pull request's merge commit, which is weaker at
   least in the specific, named ways listed above. Do NOT read that list as
   exhaustive: no code can establish an exhaustive negative about an attack
   surface, and the "and in no other way" tail this sentence used to carry was
   removed in #1213 round 7 for claiming one.

   **If a version's file changed after its rehearsal, this lane will refuse it,
   and that refusal is correct** — preview never ran the bytes you are asking
   production to apply. The way forward there is a new migration, never a
   recovery.

   If you find yourself editing a guard, an `if:` condition or an artifact name
   to make a re-run go through, stop. That is how the trap this section exists to
   describe was built in the first place (#1194, #1208). Open an issue instead.
3. **Additive by default (expand, then contract).** Adding a column or table
   cannot break another app. **Renaming or dropping** one that another app reads
   *will*. Default to additive changes. Only rename/drop after explicit owner
   sign-off and a checked deprecation across all dependent apps.
4. **New timestamped migration files only.** Each change is a new
   `YYYYMMDDHHMMSS_*.sql` file. Never edit a migration that has already been
   applied anywhere — that is how two sessions silently clobber each other.
5. **Never reuse a timestamp — a duplicate SILENTLY SKIPS a migration.**
   Supabase's ledger (`supabase_migrations.schema_migrations`) keys on the
   **version (the timestamp) alone — not the filename**. If two migrations share
   one timestamp, whichever applies first claims that version and **the other is
   treated as already-applied and never runs**. No error, no warning.
   *This actually happened (2026-07-22):* `20260722220000` was used by BOTH the
   PopSG trigram-index migration and the Sample Tracking
   `restore_dflow_sample_shipment_item` migration. Production recorded 220000 as
   the PopSG one and skipped the table restore, so `dflow.sample_shipment_item`
   never existed in production and the whole dependent feature (movements,
   closeouts, views) could never apply — while the ledger claimed success.
   *It happened again (2026-07-28):* `20260728160000` was used by BOTH
   `clickup_incremental_task_import` and `popdam_user_tables_foreign_keys`. See
   the second-order failure below.
   **This is now enforced in CI** — `scripts/check-sql.sh` fails the PR on any
   duplicate version, so you no longer have to remember the manual check
   (`ls supabase/migrations | cut -c1-14 | sort | uniq -d`, which must print
   nothing). **Before trusting a migration:** confirm the OBJECT exists
   (`to_regclass`), never just the ledger row.

   **A duplicate has a SECOND failure mode that outlives the skip: it blocks
   every future push.** The ledger holds one row per version, so the CLI matches
   that row to one of the two files and reports the other as pending *forever*.
   Every `supabase db push` then tries to re-insert the version and aborts:

   ```text
   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
   Key (version)=(20260728160000) already exists.
   ```

   `supabase migration list` shows it plainly — the same version twice, once
   matched and once with an empty REMOTE column.

   Fixing a collision — choose by whether the loser's content has landed yet:
   - **Not yet applied anywhere:** re-timestamp the loser (pure rename) so it
     sorts after the winner, keeping dependent migrations in order.
   - **Already landed via a later re-issue:** **delete** the superseded file.
     Re-timestamping it would apply stale DDL *after* the newer fixes and
     `create or replace` the corrected objects back to their old bodies. This
     was the 2026-07-29 resolution for `20260728160000`: the ClickUp half had
     been re-issued as `20260728174500` and then fixed by `20260728181500`, so
     renumbering it would have reverted the fixes.

   Deleting the loser is safe for the ledger **only because the winner keeps the
   version** — the CLI still finds a local file for every `schema_migrations`
   row, so it does not abort with `Remote migration versions not found in local
   migrations directory`.
