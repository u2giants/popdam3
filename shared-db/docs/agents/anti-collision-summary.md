# AGENTS.md — §4, §4.1 to §4.3 (the five anti-collision rules, operative summary)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 4. The five anti-collision rules (shared database)

**Full text, including the whole migration-author-lane and reviewer machinery, the post-merge
preview rehearsal and its recovery lane:
[`docs/agents/section-4-anti-collision-rules.md`](../../docs/agents/section-4-anti-collision-rules.md).
Read it in full before you claim a lane, author a migration, or rehearse on preview.** The five
rules below are the operative summary.

1. **There is no limit on how many unrelated migrations may be authored at once. Preview, merges,
   and production promotion remain one at a time** (owner ruling 2026-09-11, marker #2758, issue
   #2775: no limit on migration author lanes, ever). Exact object claims and version reservations
   still refuse every object/version collision, including against protected relinquished claims.

   **Do not open a migration file first.** Acquire an author lane, an exact object claim, and a
   centrally reserved 14-digit version as one dispatch operation:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --claim \
     --admit-issue <work-issue> \
     --task "<issue and outcome>" --owner "<agent/session>" \
     --branch "<branch>" --worktree "<absolute isolated worktree>" \
     --objects "<every exact object written, comma-separated>"
   ```

   Allocation is serialized across computers by a GitHub-backed lock and **fails closed**. The
   created issue body is authoritative and machine-readable — **never hand-edit its fenced
   blocks.**

   - **If you cannot list the objects up front, your task is read-only** — and read-only work
     cannot collide.
   - **An open claim is a lock, not a note.** Close it when the work merges or is abandoned.
     **Expiry never unlocks an object**, and a reserved version is never freed for reuse.
   - **Preview and merge need their own exclusive GitHub-backed leases**, acquired separately;
     a clean author lane does not grant preview. Instructions in chat are not a lock.
   - **Never run `supabase migration repair --status reverted`** when preview aborts with
     `Remote migration versions not found in local migrations directory` — those rows are another
     team's applied work. Land or coordinate the other branch instead. A migration left
     rehearsed-but-unmerged blocks everyone, so **open its PR the same session.**
   - Every open `db-work` issue carries one authoritative `db-work-scope` block. Only
     `ready + structural + shared-db-orchestrator` (or `route: self-service-additive` for additive
     work confined to `{crm,pim,dam,plm}` — merge-time-classifier-enforced, no orchestrator triage) can enter an author lane, and it must name
     every exact object. Outside-sourced writes into curated `core.*` Master Data use
     `curated-master-data` / `curated-master-data-governance` — §6.4 governance. It normally stays
     outside author lanes, but a fork that ships `supabase/migrations/*` must claim a lane before
     authoring so version reservation and exact-object collision locking remain enforced.
   - **A verdict with no coverage statement is not review evidence** (issue #1220). An `APPROVE`
     with no findings and no statement of what was examined is a wrapper or provider failure, not
     a clean review — treat it as `verdict=none` and use `--replace-failed-reviewer`. **Silence is
     never approval.**
   - Reviewer rotation, the business-risk gate, and the transport-failure rule (**a wrapper that
     cannot authenticate is a transport failure, not a review — replace it, never pause the
     queue; a real `REVISE` is never a transport failure**) are in the full text.
   - **Guard diagnosis must be reproducible.** Run `node scripts/triage-gate.mjs <guard>` first.
     Do not call a root cause proved without a rerunnable command or verification artifact; after
     ten minutes without proof, label it a `working hypothesis`. Do not announce a proved guard
     incident or close it while triage prints `LEDGER_MISSING`; create the minimal blocker stub
     first. Scripts/docs/CI-only work needs one independent reviewer. Migrations, data movement,
     production applies, and security/RLS work still need two.
   - Probe reviewer process/session updates and a non-empty output stream before waiting. Replace
     only when there is no verdict and no progress, or a concrete transport, coverage, or
     truncated-output failure. Never replace `REVISE` or reduce coverage: exhaust active providers
    not failed on the exact head, then fail closed with the exact blocker. The configured rotation is
    Grok 4.6, Qwen 3.8 Max, Muse Spark 1.3 Contributor,
    Gemini 3.8 Flash High, and DeepSeek V4.1 Flash, minus the live orchestrator's own engine — exactly
    `ACTIVE_REVIEWERS` in `scripts/manage-migration-author-lanes.mjs`. Gemini
    re-entered on 2026-09-06 (PR #2438) after a live re-qualification. Kimi K3
    was unpaused on 2026-09-07 (PR #2483) after a passing wrapper doctor; it
    is paused again as of 2026-09-22 (see below). Qwen 3.8 Max was unquarantined on 2026-09-07 by owner
    instruction (ai-devops PR #316, merge `795902d8`) and is drawable again.
    **GLM 5.3 is paused as of 2026-09-18** (owner instruction, chat directive —
    weekly account-usage rotation, no provider fault; Kimi verified healthy the
    same day) and is not drawable until it is removed from `RETIRED_REVIEWERS`;
    restoring it is a one-line deletion. The 2026-09-17 ruling that GLM never
    reviews GLM-orchestrated work still binds when it returns.
    **Kimi K3 is paused as of 2026-09-22** (owner instruction, issue #3423): its
    account has been out of credit since 2026-09-17, so every draw on it failed and
    left the PR waiting for a replacement. Restore it with a one-line deletion from
    `RETIRED_REVIEWERS` once the account has credit and its wrapper doctor passes.
    A reviewer already running other reviews is never a reason to wait: there is
    no per-reviewer concurrency limit.
    **DeepSeek V4.1 Flash (`deepseek-v4.1-flash`) is drawable as of 2026-09-23**
    (owner instruction, issue #3468): `ai-deepseek-agent --review` now reads the
    repository through read-only tools (ai-devops PR #730) and passed a live
    qualification and a live governed review. The text-only `deepseek-chat` row,
    RETIRED on 2026-09-01 (issue #2078), stays retired.
    **Codex GPT-5.6 Sol is NOT in the rotation:** the owner retired it
    permanently on 2026-09-06 (issue #2485) once the other providers were
    working, so it sits in `RETIRED_REVIEWERS` and is not drawable. Its
    `REVIEWERS` row stays, so every durable verdict it already recorded still
    authorizes a merge.

   The `Cross-PR object collision` CI check is only the backstop. By the time it fires, somebody's
   session is already wasted — on 2026-07-31, three of four were.

2. **Preview database first. Production never receives untested schema.** Apply every migration to
   the preview branch, prove it works, *then* promote to production (`qsllyeztdwjgirsysgai`).

   ⚠️ **Exception, #2758: low-risk SQL may skip the preview apply.** Dispatch the production apply
   with `ephemeral_check_run_id` (the job ID of the successful `supabase/tests against an ephemeral
   database` check on the source PR head) instead of `preview_run_id`/`preview_artifact_digest`.
   The gate refuses unless that job's run positively applied each migration and the merged bytes
   equal the tested head, and it refuses outright for anything its conservative classifier does
   not recognise as low-risk (rewrites, long locks, drops, backfills, unknown statements) — those
   still need preview. Target proof, the lane lock and post-apply verification are unchanged.

   ⚠️ **The preview project ref is deliberately NOT written down here.** Preview is rebuilt from
   time to time and its ref changes when it is — `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18.
   The current ref lives in the repository variable `PREVIEW_PROJECT_REF`, every workflow that
   targets preview reads it from there, an unset variable is refused rather than defaulted, and
   `scripts/check-workflow-preview-ref.test.mjs` fails the guard job if any workflow pins a literal
   again.

   ⚠️ **Merging requires an APPROVE pinned to the EXACT head being merged, and the merge gate now enforces it (#1816, 2026-08-29).** A reviewer assignment is not an approval, and an approval of an earlier head is not an approval of these bytes: answering a `REJECT` with a new commit requires a fresh exact-head review before that commit can merge. Enforced by `scripts/check-exact-head-approval.mjs`, run twice in `guarded-migration-merge` (up front, then re-proven under the merge lock). Before this it was convention only, and PR #1809 merged unapproved bytes onto `main`. Free-text verdicts are unauthorized by default and count only from GitHub's OWNER, MEMBER or COLLABORATOR associations. The gate still does **not** prove the assigned provider is the commenter, because assignment refs do not carry an identity that can be bound to GitHub authorship. Do not cite a pass as proof of who reviewed. Full limits in `docs/agents/section-4-anti-collision-rules.md`. ⚠️ **One exemption, added 2026-09-02 (#2102): a documents-only pull request draws no reviewer and the gate requires no verdict for it — see rule 18. Rulebook files are not documents.** ⚠️ **Merged-PR audit mode (#2839, PR #3375):** running the gate with `APPROVAL_AUDIT=merged` on a merged pull request does not re-read reviewer verdicts; it passes only if the newest `Migration guarded merge authorization` status on the exact head, at or before `merged_at`, is a `github-actions[bot]` success carrying the guarded lane's description (or the documents-only lane's, when the PR's files still classify documents-only). Open PRs refuse in this mode, closed-unmerged PRs refuse, and without the variable the gate stays the live verdict check for every caller. Known limit: the merge commit SHA is recorded but not bound to the authorized head.
   ⚠️ **Refreshing from main keeps the APPROVE (#2758, 2026-09-11).** An APPROVE recorded at head A still counts at a later head B when A is an ancestor of B and the pull request's own diff against its merge base with main is byte-identical at both, ignoring only `.agent/` evidence files (`scripts/lib/pr-content-equivalence.mjs`, used by the merge gate and the preview gate). **The exclusion is the whole `.agent/` tree**, so it still covers the per-pull-request evidence paths `.agent/work/<work_issue>/<generation>/` introduced by #2708 (2026-09-20); an APPROVE carried forward across a refresh is unchanged by that move. Any change of the author's own, even whitespace in SQL, needs a new review, as does main editing a file the pull request also edits; a refusal at any equivalent head (found through its assignments, returns or verdicts) is never carried past, and a head with reviewer records of its own (an assignment, return or verdict) is judged on those alone. By the same rule, a main that moved after dispatch no longer stops the guarded merge when the pull request touches no file or migration version main changed, merges into it cleanly, and keeps its own diff; and a production promotion no longer rejects its preview proof because main later gained another migration's verification sidecar, unless that migration names an object the promoted migration names.

   **Merge first, then rehearse on preview from merged `main`, then promote.** A rehearsal runs
   **once** — an applied version can never be applied again, so a re-dispatch and a GitHub
   "Re-run jobs" are both refused, and both refusals are correct. If a rehearsal must be recovered,
   use the historical-recovery lane, never a weakened guard. ⚠️ **Superseded in part, 2026-08-20
   (#1321): that lane cannot recover a POST-merge rehearsal** — it pins producer files to the
   authoring PR's merge commit, so a later main tip fails the pin, and the only way through is to
   supersede the migration with byte-identical SQL. Read the full text before relying on either.
   ⚠️ **NARROWED, 2026-08-20 (orchestrator marker #1338): the lane DOES recover a post-merge
   rehearsal when the rehearsal ran AT the authoring merge commit.** Recovered cleanly that day for
   `20260820165926` (preview recovery run 32402833543, then production apply 32402996954) with
   `historical_preview_source_pr` + `historical_preview_original_run_map`. **The discriminator is
   not pre-merge versus post-merge — it is whether anything merged BETWEEN the authoring merge
   commit and the rehearsal.** Rehearse in the same breath as the merge and the pin holds; let
   another PR land first and it does not. Do not pay a supersession before trying the lane.

3. **Additive by default (expand, then contract).** Adding a column or table cannot break another
   app. **Renaming or dropping** one another app reads *will*. Only rename/drop after explicit
   owner sign-off and a checked deprecation across all dependent apps.

4. **New timestamped migration files only.** Each change is a new `YYYYMMDDHHMMSS_*.sql` file.
   **Never edit a migration that has already been applied anywhere** — that is how two sessions
   silently clobber each other. Since issue #2037 this is ENFORCED, not merely written down:
   `scripts/check-applied-migration-edit.mjs` runs in the `SQL migration guards` job and refuses
   any pull request that modifies, deletes or renames a migration file whose version is present
   in the preview or production ledger. Fix forward at a new version instead.

5. **Never reuse a timestamp — a duplicate SILENTLY SKIPS a migration.** The ledger
   (`supabase_migrations.schema_migrations`) keys on the **version alone, not the filename**. If
   two migrations share a timestamp, the first to apply claims the version and **the other is
   treated as already-applied and never runs. No error, no warning.** It has happened twice
   (`20260722220000`, `20260728160000`); the first left `dflow.sample_shipment_item` missing from
   production while the ledger claimed success.

   **A duplicate also blocks every future push forever** with
   `duplicate key value violates unique constraint "schema_migrations_pkey"`.

   Now enforced in CI by `scripts/check-sql.sh`. **Before trusting any migration, confirm the
   OBJECT exists (`to_regclass`) — never just the ledger row.** Fixing a collision: re-timestamp
   the loser if its content has not landed anywhere; **delete** it if the content already landed
   via a later re-issue (re-timestamping would apply stale DDL over the newer fixes). Worked
   detail in the full text.
## 4.1 App-specific attributes go in per-app extension tables (decided 2026-07-17)

When an app needs a field on a shared canonical entity (`core.customer`,
`core.factory`, etc.) that other apps don't care about, **do NOT add a column to
the shared `core.*` table.** Put it in a per-app **extension table** in that app's
own schema: `crm.customer_ext`, `dam.customer_ext`, `pim.factory_ext`, etc.

- **Shape:** 1:1 with the core row — `customer_id uuid primary key references
  core.customer(id) on delete cascade` (no surrogate id). A missing ext row means
  "all defaults"; consumers LEFT JOIN it.
- **RLS/grants:** the ext table lives in the app's schema and follows that app's
  existing policy pattern. Remember: an RLS policy is **not** a GRANT — a
  browser-writable app table needs both.
- **Views:** each app's own `api.*` view joins core + *its* ext table. Never one
  mega-view joining every app's ext tables.
- **A column stays on `core.*` only if** two+ apps need it, or it's
  identity/classification (name, status, domain, address), or it feeds cross-app
  joins/shared pickers. Provenance/sync bookkeeping stays in `core.*_source_ref`.
  No jsonb bags for structured fields; **no EAV, ever.**
- The grandfathered CRM-ish columns already on `core.customer`
  (`customer_status`, `chain_type`, `routing_aliases`, `so_patterns`, …) are left
  as-is — do not migrate them out now; just don't add more.

Full implementation guide (DDL template, per-app sections, rollout order):
[`docs/per-app-extension-tables-plan.md`](../../docs/per-app-extension-tables-plan.md).

## 4.2 OWNER RULING — moved

> **4.2 OWNER RULING — prove which database you are connected to before any destructive statement (Albert Hazan, 2026-08-02)**
> Full ruling: [`docs/owner-rulings.md`](../../docs/owner-rulings.md#42-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.
>
> **The operative rule, in full, so nobody has to click through to be safe.** Before any statement
> that writes, changes or removes data, schema or privileges — `INSERT`, `UPDATE`, `DELETE`,
> `TRUNCATE`, `DROP`, `ALTER`, `GRANT`, `CREATE`, a mutating function or RPC, a script, a CI
> workflow, or asking a person including the owner to run one — **in ANY environment, preview and
> production alike, prove which database it is about to run against.** Preview being "the safe one"
> is not an exemption, and **§0.0-B does not narrow this**: §0.0-B decides who authorises a
> statement, §4.2 decides that you know where it lands.
>
> **"Prove" means an explicit check of the live connection target, executed immediately before the
> statement** — never an assumption, a memory, an earlier check, a filename, a branch name, or a
> plan that said "preview". One proof covers what is submitted in the same tool call or the
> immediately following one; **any tool call, reconnect or turn boundary in between invalidates it
> — redo it.** It is settled: do not re-ask it and do not weaken it. The full ruling carries the
> incident behind it and the exact queries that count as proof.
## 4.3 OWNER RULING — moved

> **4.3 OWNER RULING — issues, handovers and plans point at the LIVE reading, never at a number (Albert Hazan, 2026-08-11)**
> Full ruling: [`docs/owner-rulings.md`](../../docs/owner-rulings.md#43-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.
>
> In one line: **never paste a measured count into a document.** Name the query, the view, or the
> dashboard that produces it, so the reader gets today's number instead of the day-you-wrote-it
> number.
