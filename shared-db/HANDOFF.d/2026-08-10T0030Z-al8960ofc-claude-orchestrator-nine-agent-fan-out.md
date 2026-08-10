# HANDOVER — orchestrator session `8b3f21c4`, machine `al8960ofc`, 2026-08-09/10 UTC

**Marker issue:** [#622](https://github.com/u2giants/shared-db/issues/622) — **still OPEN.**
Close it only at true session end, after the merges in §6 are done.

**Written by:** Claude (Opus 5) acting as the shared-db *orchestrator* — a session that does no
database work itself and dispatches every task to isolated sub-agents in their own git worktrees.

**Everything below was re-verified against the live repo with `gh`/`git` at 2026-08-10T00:30Z.**
Where the orchestrator's own dictated summary was wrong, the repo won and the correction is
marked **CORRECTION**. Do the same: re-derive before you trust this file.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Albert is the owner (GitHub `u2giants`). He is a business owner, not a programmer. **Put this
whole list to him in ONE message before starting work.** Do not meet these one at a time.

### Blocking — nothing moves until he answers

| # | Ask (plain English) | Recommendation | What it blocks |
|---|---|---|---|
| 1 | **Approve the waiting workflow run.** https://github.com/u2giants/shared-db/actions/runs/31342955746 is sitting at `status=waiting` on an approval gate that only he can clear. It is a *rehearsal* (a dry run), not a real change to the live database. | **Approve it.** | Verified live: it blocks the whole production lane **and**, because of the concurrency mechanic in §5.1, it blocks every other agent's preview database run too. This is the single highest-priority item on the board. |
| 2 | **The credential hole (§5.2).** The approval gate above is supposed to mean "only Albert can say yes". On this machine the `gh` command-line tool is logged in **as Albert**, and GitHub reports `current_user_can_approve: true`. So any AI session on this machine can click his approval with his own credentials. Verified live this session. | Give the AI sessions their own limited GitHub login that **cannot** approve, and keep approval to Albert in a browser. No code change can fix this — the hole is the credential the agent already holds. | Nothing technically, which is exactly why it will keep being skipped. It undermines every production safeguard built this session. |

### A wrong guess is recoverable, but rework is wasteful

| # | Ask | Recommendation |
|---|---|---|
| 3 | **`can_admins_bypass` is `true`** on the `production` environment (verified live). That means an administrator can walk past the approval gate. Leave it, or turn it off? | **Turn it off**, once item 2 is settled. Turning it off first, while `prevent_self_review` is `false`, is safe; see item 4. |
| 4 | **`prevent_self_review` must STAY `false`.** Albert is both the person who starts the run and the only approver. Turning it on would make the gate impossible to satisfy and permanently brick the production lane. Confirm he agrees to leave it alone. | **Leave it false.** One-word answer. |
| 5 | **Should rehearsals be gated at all?** Right now the `production-dry-run` job also sits behind his approval, so every practice run costs him a click. Training him to click "approve" on production prompts by reflex is the risk. | **Move the dry run to a separate, ungated environment**, so the gate guards only the real change. NOT yet approved — do not build it without a yes. |
| 6 | **A live email address and a full name are published in a public repo** — already merged on `main`, in `supabase/migrations/20260726210000_*.sql:112` and `20260809170500_*.sql:5,:19`. Rewriting git history is off the table (it breaks every clone). | Decide: accept it, or replace the values in a *new* migration going forward. Recommend **accept and stop adding new ones**. |
| 7 | **The three "Exorcist" questions (§5.6).** Nine PopDAM asset rows show the wrong licensor, and the root cause is much bigger than nine rows: roughly **9,973 assets** carry a licensor link that disagrees with their own product code, and **73,476** licensed assets have no property at all. Nothing has been written yet; the sub-agent stopped and waited. | He must rule on (a) whether the product-code convention or the folder location is the source of truth, (b) whether to bulk-correct the ~10k, (c) who owns fixing the folder reorganisation that caused it. Recommend: **code is truth**, bulk-correct in one reviewed migration. |

### Already settled — do NOT re-ask

- **2026-08-09:** Lift the Paramount hold and ship all 21+2 tables. This supersedes AGENTS.md
  §6.13 rulings 2 and 4 and is now recorded in the rulebook by merged PR #632.
- **2026-08-09:** A bounded throwaway-database spend is approved (for the rehearsal clone).
- **2026-08-09:** Albert is the named required reviewer on the `production` GitHub environment.
- **Earlier:** The Disney extract history scrub is CANCELLED (issue #502).

**Sweep performed.** Every sentence in §1–§9 and part (b) that needs Albert's judgement is in the
table above: items 1, 2, 3, 4, 5 come from §5.1/§5.2 and §3; item 6 from §9; item 7 from part (b)
block 7. Items 5, 6 and 7 are the ones that would otherwise have been filed as "findings" and
never raised.

---

## 1. What this application is

- **`u2giants/shared-db`** is the *only* place schema changes to the shared Supabase database are
  authored. It is a migrations repo: SQL files under `supabase/migrations/`, plus guard scripts
  under `scripts/`, docs under `docs/`, and GitHub Actions under `.github/workflows/`.
- **The database** is Supabase project `qsllyeztdwjgirsysgai` (**production**) with a long-lived
  preview project `rjyboqwcdzcocqgmsyel` (**preview**). Five applications read and write it:
  PopDAM (digital asset manager), PopPIM, PopCRM, a monitor app, and hiclaw. DesignFlow (dflow) is
  a *different* system on Cloud SQL — do not confuse them.
- **The business** is POP Creations, a licensed-merchandise company. The database holds licensors
  (Disney, Warner, NBCU, Paramount), their properties and characters, product/item master data,
  and digital assets.
- **The rulebook is `AGENTS.md`** at the repo root. Read it first. `HANDOFF.md` at the root is a
  static pointer to `HANDOFF.d/` — never rewrite it.
- **Migration file naming:** `<14-digit UTC version>_<snake_case_name>.sql`, e.g.
  `20260810030000_warner_starlabs_source_landing.sql`. The 14 digits are the ordering key and are
  hand-allocated by the orchestrator (§7).

## 2. What we set out to do, and why

Fan out nine parallel workstreams from the backlog in one orchestrator session, each in its own
worktree, each ending in a pull request. The session goal in business terms: **get four licensor
data sets landed in the database (Warner, NBCU, Paramount, PopDAM order lists), unblock the
production release lane, and clean up documentation that was actively lying to future sessions.**

The trigger was the previous handover
(`HANDOFF.d/2026-08-09T2243Z-al8960ofc-claude-orchestrator-production-lane-unblocked.md`), which
reported the production lane as "nearly runnable" and left a large ready backlog.

**Session start state (verified then):** `main` = `25178f75`, 411 migration files, newest version
`20260809170500`, zero open PRs, zero open claims, 83 open `db-work` issues.

## 3. Current state — what is true right now

**`main` is now `4f26099`** (`ci(#614): bounded --include-all for the production dry-run…` (#626)).
Still **411 migration files**, newest still `20260809170500` — because every new migration is in an
unmerged PR. 84 open issues.

### Merged this session (all verified via `gh pr list --state merged`)

| PR | What it did | Status |
|---|---|---|
| #630 | Corrected four disproved sentences in the merch-group taxonomy doc. Closed issue #556. | MERGED |
| #632 | AGENTS.md §6.13: the owner's 2026-08-09 ruling supersedes Paramount rulings 2 and 4. Also fixed a §5.1 self-contradiction about `--include-all`. | MERGED |
| #633 | Three licensing-resolver defects (#522, #524, #525) plus a fourth nobody had filed. | MERGED |
| #626 | **The production lane fix**: bounded `--include-all` plus `assert-bounded` in the migrations workflow. | MERGED |
| `u2giants/ai-devops` #16 | 20 stale/unsafe items across 10 skill files. Closed issue #574. **Different repo.** | MERGED |

### Open PRs — FIVE, all deliberately unmerged, all `MERGEABLE`, all checks green

| PR | Issue | Branch | Migration versions it adds |
|---|---|---|---|
| #635 | #613 PopDAM OrderList | `issue-613-popdam-order-list` | `20260810010000`, `20260810060000` |
| #636 | #623 Paramount | `issue-623-pmt-creative-library` | `20260810020000` |
| #637 | #588 Warner | `issue-588-warner-starlabs-source` | `20260810030000` |
| #631 | #607 app_access | `issue-607-admin-app-access` | `20260810050000` |
| #634 | NBCU (claim #628) | `nbcu-step3` | `20260810070000`, `20260810080000` |

> **CORRECTION to the orchestrator's own summary.** It said Warner phase 2 "was NEVER STARTED" and
> that the deadlock involved **four** PRs. Both are wrong. **PR #637 exists**, head commit
> `02597d85`, exactly two files, all eight checks passing. **The deadlock involves FIVE PRs.**
> Two further fixes the summary listed as "in flight" (`20260810090000` for Paramount and
> `20260810100000` for PopDAM) are **not in any open PR** — see §6 step 3.

### Open claim issues (a claim is a LOCK, not a note — close it when its work merges)

#624 (#613) · #625 (#623) · #627 (#588) · #628 (NBCU) · #629 (#607). All five verified OPEN.

### Nothing is deployed to production. Nothing new is on `main`.

---

## 4. Everything we tried that did NOT work

1. **Dispatching the Paramount build (#623) without first reading `AGENTS.md` §6.13.** The work
   contradicted two settled owner rulings and the agent had to be halted mid-flight. Albert then
   lifted the hold, and PR #632 recorded it. **Rule learned: check the rulebook for an owner ruling
   BEFORE dispatching, not after.**
2. **Telling the #607 agent to hard-code "exactly 3 administrators and 4 targets."** Correct for
   production, guaranteed to fail on preview (which has 4), and brittle the moment somebody is
   hired. Replaced with a derived count plus a non-fatal notice.
3. **Telling agents preview was a clean baseline.** True of the migration *ledger* only; false of
   the *data*. The read-only observer agent (block 2) had only ever checked the ledger, and the
   orchestrator over-extended its verdict to identity data in later briefs. Cost one agent a
   blocked run. See §5.3.
4. **Assuming the migration PRs could merge in some order.** They cannot. See §5.4.
5. **`--allocate-version` on the collision checker.** Withdrawn; it exits 2. Versions are allocated
   by hand by the orchestrator.
6. **Copy-pasting the collision checker's printed claim recipe.** It is a bash heredoc and mangles
   in PowerShell. Use `gh issue create --body-file <file>` instead.
7. **Proving a test works by asserting instead of mutating** (production-lane agent, block 12). Its
   first mutation run *reported a pass* because the patch had silently no-opped through a mangled
   heredoc. **"The mutation passed" and "the mutation never ran" look identical in a terminal.** It
   added an `assert new != s` guard.
8. **Running `scripts/check-pr-object-collisions.mjs` locally as a pre-check.** It **skips
   silently** when `GITHUB_REPOSITORY` is unset (`scripts/check-pr-object-collisions.mjs:481-482`
   throws `Skip`). It works correctly in CI. A local skip reads exactly like a pass.
9. **Believing a Supabase Management API restore could clone production into a *new* project.**
   There is no such endpoint. Every restore path restores *into* the project named in the URL, so
   pointed at production it would overwrite production. The agent caught and corrected its own
   recommendation before anyone acted on it.

---

## 5. Root causes and key findings

### 5.1 THE CONCURRENCY BLOCK — new, and the reason item 1 in §0 is urgent

`.github/workflows/shared-supabase-migrations.yml:40-45` sets the concurrency group:

```yaml
group: ${{ github.event_name == 'pull_request' && format('shared-supabase-migrations-{0}', github.ref) || 'shared-supabase-migrations' }}
```

Pull-request validations get a per-branch group and run in parallel — those are fine. **Every
`workflow_dispatch` run shares ONE global group.** Run `31342955746` is a `workflow_dispatch` on
`main` sitting at `status=waiting` on the owner's approval. It holds the global lane, so **every
other manually dispatched run queues behind it.** Verified live: Warner's preview apply,
run `31342963264` on branch `issue-588-warner-starlabs-source`, has been `pending` since
2026-08-09T23:52Z and never ran.

**So the unapproved gate is not just blocking production — it is blocking every agent's preview
database applies.** Understand the mechanism, not just the symptom.

### 5.2 THE CREDENTIAL HOLE — the most serious finding of the session

The `production` GitHub environment now has a required reviewer (`u2giants`), added this session;
`gh api repos/u2giants/shared-db/environments` shows `protection_rules` went from `[]` to a
`required_reviewers` rule. Verified live just now.

**But `gh` on this machine is authenticated as `u2giants` (Albert himself)**, and
`gh api repos/u2giants/shared-db/actions/runs/31342955746/pending_deployments` returns
`current_user_can_approve: true`. **Any agent session on this machine can satisfy the owner's
approval gate using his own credentials.** The production-lane agent had this capability,
identified it, and refused to use it.

No workflow change closes this. The hole is the credential the agent already holds. It is strictly
worse than `can_admins_bypass` (also `true`), which merely lets an admin walk past the gate.

### 5.3 Preview is NOT a production clone

- 4 active administrators vs production's 3.
- Two of production's administrators are absent from `app.profile` entirely.
- Three hand-made `admin` grants in `app.app_access` (dated 2026-07-22, 07-24, 07-28) exist in no
  migration at all.
- 33 `app_access` rows vs production's 36.

**Preview currently holds SIX unmerged migrations:** `20260810010000`, `20260810020000`,
`20260810050000`, `20260810060000`, `20260810070000`, `20260810080000`.

**Do NOT reset preview. Do NOT run `supabase migration repair`** — it deletes ledger rows while
leaving the objects behind, which breaks other agents' workstreams. To push past the six, use
documented **option 3** in `docs/shared-supabase-branch-workflow.md`: temporarily copy the other
agents' migration files into your worktree, push only your own, then delete the borrowed files
before committing.

### 5.4 THE MERGE DEADLOCK — read this before touching any PR

**Guard B lives in `scripts/check-sql.sh` lines 49–134** — not in `production_migration_guard.py`,
where people keep looking. It compares every version a PR **adds** against the newest 14-digit
version in `supabase/migrations` **on the live tip of `origin/main`**, read from git. No ledger is
consulted. Because `$base_rev` is the live tip, the verdict changes every time `main` moves.

**Rule: at merge time, every version a PR adds must be `>=` main's newest version.**

Main's newest is `20260809170500`. Added versions:

| PR | min added | max added |
|---|---|---|
| #635 | `20260810010000` | `20260810060000` |
| #636 | `20260810020000` | `20260810020000` |
| #637 | `20260810030000` | `20260810030000` |
| #631 | `20260810050000` | `20260810050000` |
| #634 | `20260810070000` | `20260810080000` |

Merge #631 first and main's newest becomes `20260810050000`; #635, #636 and #637 then all fail.
Merge #635 first and main's newest becomes `20260810060000`; #636 and #637 fail. **There is no
valid permutation of the five.**

Branch protection is `strict: true` **and** `enforce_admins: true` (verified live). No stale-check
slip, no admin override. Getting the order wrong is **not** a five-minute fix: recovery needs
either temporarily relaxing branch protection (an owner action on production repo settings) or
re-issuing the DDL under a new version — and re-issuing is forbidden, because all these versions
are already applied to preview.

**THE APPROVED FIX — one combined merge.** Cut an integration branch off `main`, merge the four
feature branches (#635, #636, #637, #631) into it with plain `git merge`, and open ONE pull request
from the integration branch to `main`. In a single merge, main's newest is still `20260809170500`,
so every added version sorts above it and Guard B passes. Then merge #634 normally.

**Do NOT retarget the PRs to stack on one another.** A stacked base makes Guard B compare against
the stack tip and it fails identically.

Two things to watch on the combined PR: the **Cross-PR object collision** check now sees one PR
instead of four, and **four claims ride one merge** (close #624, #625, #627, #629 together).

### 5.5 Guard B's blind spot

Guard B compares to `main`, never to preview. So an agent can pass clean with a migration that is
backdated relative to what preview already holds. Proposed fix (unassigned): have it read the
preview ledger too.

### 5.6 The PopDAM licensor defect (from block 7 — nothing written yet)

- It is **9 rows, not 8**, all one SKU: `AAH62NBEX01`.
- **Root cause:** PopDAM derives the licensor by *slicing the SKU* (`NB` = NBC), and 98.1% of
  54,916 assets match that convention. The database is faithfully reporting a SKU coded NBC on a
  Warner Bros title. The data is not corrupt; the convention is.
- **Durability is asymmetric, and this reverses an earlier statement made to the owner.** The four
  TEXT columns are rewritten on **every** scan (`agent-api/index.ts:923`,
  `metadata-handlers.ts:157`), but the foreign-key columns are **null-only fill and never
  corrected** (`metadata-handlers.ts:73-78`). **A fix to `licensor_id`/`property_id` SURVIVES; a
  fix to the text columns does not.**
- **The wider defect:** `_shared/metadata-derivation.ts:98-105` reads the licensor from folder
  segment 3 *by position*. A folder reorganisation put **117,576 of 117,969** licensed assets
  (99.7%) under `____New Structure`, which matches no licensor. **9,973 assets** have a foreign key
  disagreeing with their own code; 99.3% sit under the new structure; 99.0% date to the March bulk
  load. **73,476** licensed assets have no property at all.
- **Latent trap:** `____New Structure` contains four underscores, which are SQL `LIKE` wildcards
  passed straight into `.ilike()`. Harmless today; a licensor named to fit would silently capture
  thousands of rows.

### 5.7 The `plm` schema-wide privilege hole (from block 11)

The `plm` schema carries `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO service_role`. **Every
table created in `plm` is therefore handed UPDATE, DELETE and TRUNCATE automatically at
`CREATE TABLE` time.** A migration's own `grant select, insert` was a no-op and its immutability
guarantee was inert — while the migration applied cleanly and its ledger row went green.

Only **contract test D** caught it, because it asserts the *resulting privileges* rather than
asserting that the migration ran. Fixed for `nbcu` at `20260810080000`. **`plm.erp_*` still carries
UPDATE, DELETE, TRUNCATE ×4** — deliberately left as the before-picture for a general fix that
nobody has been assigned.

### 5.8 Document contradictions still live on `main`

- **`AGENTS.md:542-543` says the `domain-ownership` workflow is "Not yet built."**
  **`AGENTS.md:1159-1161` says the required `Domain ownership` context comes from
  `.github/workflows/domain-ownership.yml`.** The file exists and the check passes (verified: PR
  #637's `Domain ownership` check passed in 6s). §5.2 of AGENTS.md contradicts §11 directly.
  **PR #632 fixed the §5.1 contradiction but NOT this one.**
- **`COORDINATOR_INTAKE.md` and `.github/workflows/intake-pointer-guard.yml` both still exist**
  despite being documented as retired on 2026-08-07. The intake guard workflow still runs and
  passes on every PR.

---

## 6. Exact next steps

1. **Re-verify the ground truth before trusting this file.**
   `gh issue view 622` (marker still open?), `git log --oneline -5 origin/main`,
   `ls supabase/migrations | tail -1`, `gh pr list --state open`.
   *You'll know it worked when* you can state main's SHA and newest migration version yourself.

2. **Get run `31342955746` approved by Albert** (§0 item 1). Send him the URL and one sentence:
   "this is a practice run, it changes nothing, and it is blocking every other database job."
   *You'll know it worked when* `gh run view 31342955746 --json status` reads `in_progress` or
   `completed`, **and** the queued preview run `31342963264` starts moving.

3. **Land the combined merge.** Read §5.4 in full first. Then:
   ```
   git fetch origin
   git checkout -b integration/combined-20260810 origin/main
   git merge --no-ff origin/issue-613-popdam-order-list
   git merge --no-ff origin/issue-623-pmt-creative-library
   git merge --no-ff origin/issue-588-warner-starlabs-source
   git merge --no-ff origin/issue-607-admin-app-access
   git push -u origin integration/combined-20260810
   gh pr create --base main --title "combined merge: #613, #623, #588, #607" --body-file <file>
   ```
   *You'll know it worked when* all required checks pass on the combined PR — in particular
   `SQL migration guards`, which is Guard B. If Guard B fails, **stop** and re-read §5.4; do not
   improvise a version bump.
   Then merge **#634 (NBCU) normally, last.**
   **Two fixes named in the orchestrator's summary — `20260810090000` (Paramount:
   `load_pmt_capture_chunk` returns 0 instead of refusing on an invalid target name with an empty
   chunk) and `20260810100000` (PopDAM ambiguity, review Finding 1 in block 3) — are NOT in any
   open PR.** Confirm whether those agents finished. If not, that work is unfinished and must be
   redone before or immediately after the combined merge.

4. **Close the claims as their work merges.** #624, #625, #627, #629 with the combined merge; #628
   with #634. *You'll know it worked when* `gh issue list --label db-claim --state open` is empty.

5. **Chase the §0 owner list in one message.** *You'll know it worked when* you have a written
   answer for items 1–7, and you have added them to the "already settled" list with dates.

---

## 7. Constraints and gotchas in force

- **Migration versions allocated this session — never reuse any of these:**
  `20260810010000` #613 · `20260810020000` #623 · `20260810030000` #588 ·
  `20260810040000` NBCU (superseded, unused) · `20260810050000` #607 · `20260810060000` #613 fix ·
  `20260810070000` NBCU · `20260810080000` NBCU revoke · `20260810090000` #623 fix (**not shipped**)
  · `20260810100000` #613 fix (**not shipped**).
- **Branch + PR only. The orchestrator merges its own PRs.** Never push to `main`.
- **Worktrees only, never the shared checkout** `C:\repos\shared-db`. Several agents work here at
  once.
- **Git identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.** Confirm with
  `git var GIT_COMMITTER_IDENT` before your first commit. Fixing it afterwards means rewriting
  history.
- **Never run direct `ALTER`/`CREATE`/`DROP` against the shared database** (psql or MCP). The
  Supabase MCP is read-only. Apply happens through the GitHub workflow.
- **Never `supabase migration repair`** and never reset preview (§5.3).
- **`HANDOFF.d/` holds 15 files before this one — three times the 5-file warning threshold.**
  Oldest first: `20260731T231155Z-t16-…`, `2026-08-03T2359Z-t16-…`, `2026-08-05T1827Z-hetz-…`,
  three `2026-08-06T*-al8960ofc-…`, four `2026-08-07T*`, `2026-08-09T1250Z`, `2026-08-09T1330Z`,
  `2026-08-09T2243Z`. **Somebody must decide which are finished and delete them.** A fresh
  developer currently faces sixteen nine-section essays.
- **`plm.item` carries the same `unique nulls not distinct (source_system, source_id)` trap** fixed
  on `plm.production_order` this session. It was deliberately left alone. Do not touch it without a
  dispatch of its own.
- **Merged PR #633 changed resolver behaviour**: issue #526's validator can now flag two new kinds
  of problem, so a spreadsheet that used to come back clean may not.

## 8. Access and environment

- **Authenticated CLIs on `al8960ofc`:** `gh` (as `u2giants` — see §5.2), `gcloud`, `az`,
  `supabase`, `vercel`. Supabase MCP is **read-only**.
- **Machine facts:** no `psql` reachable at the pooler level except via Node + the `pg` package.
  No Docker. `db.rjyboqwcdzcocqgmsyel.supabase.co` **does not resolve** — pooler only, host
  `aws-0-us-east-1`. PostgreSQL **17.10 client only** was installed this session via
  `winget install PostgreSQL.PostgreSQL.17 --custom "--disable-components server,pgAdmin,stackbuilder"`;
  no server, no service, PATH untouched, binaries at `C:\Program Files\PostgreSQL\17\bin\`.
- **`Z:` trap on this machine:** Git Bash's `$HOME` resolves to `Z:` (a NAS share), not
  `C:\Users\ahazan2`. Set `CLAUDE_HOME=/c/Users/ahazan2/.claude` for any installer keyed off
  `$HOME`.
- **Secrets live in 1Password, vault `vibe_coding` only.** Never paste values into files or
  commits. Serialize 1Password reads — never fan them out in parallel.
- **The 47-migration production apply set** derived this session is recorded in
  `docs/verification/production-apply-set-and-rehearsal-20260809.md`. It MUST be carried forward.

## 9. Open questions and risks

- **Risk (high):** the combined merge in §6 step 3 is a four-way octopus of independent schema
  work. If any two branches touch the same object, `git merge` will conflict and the deadlock gets
  harder. Nobody has diffed them against each other. Do that before merging.
- **Risk (high):** PR #637 (Warner) **never applied to preview** — it was blocked by the
  concurrency queue in §5.1. Its 48 objects are grammar-proven and statically checked but have
  **never existed in a live database**. Merging it means the first real execution happens on the
  way to production.
- **Open (dated 2026-08-09):** whether the two unshipped fixes (`…090000`, `…100000`) were ever
  written. See §6 step 3.
- **Decision (2026-08-09):** PR #631's preview ledger row for `20260810050000` was written by the
  *pre-review* body of the migration, and a recorded version never re-runs. So the reviewed body is
  **transaction-true, not ledger-true**. The orchestrator judged a superseding file **not**
  warranted. A later session may disagree — this is why it is written down.
- **Decision (2026-08-09):** issue #583's "two competing Warner PRs" was ruled **stale**. PR #2 is
  an abandoned 2-row checkpoint; PR #3's lineage (with #6, #7, #8) is authoritative.
- **Unassigned work created by this session:** the `plm` default-privileges hole (§5.7); the PopDAM
  folder-position resolver defect (§5.6); the `plm.item` nulls-not-distinct trap; the skills-versus-
  rulebook drift with no CI on either side (block 10); Guard B's preview blind spot (§5.5); the two
  AGENTS.md / retired-file contradictions (§5.8); and **Finding 5 on PR #635** —
  `api.dam_order_list` left-joins `plm.item`, whose `plm_read` policy PopDAM staff do not satisfy,
  so item columns will render blank for exactly the users the new policy was added for. Latent
  until `plm.item` is populated.

---

# PART (b) — ONE BLOCK PER SUB-AGENT

Twelve blocks. Nine were feature workstreams; three were read-only or support.

## 1. Startup summarizer — read-only, complete

**Asked to:** summarise the existing handover and backlog so the orchestrator did not have to read
sixteen documents.
**Did:** produced that summary.
**Found:** 15 `HANDOFF.d/` files (three times the 5-file warning threshold), zero untracked `B<n>`
backlog items, and 7 contradictions between live documents.
**Did NOT do:** it did not fix or delete anything. Read-only by design.

## 2. Preview observer — read-only, complete

**Asked to:** confirm the preview database matched `main` before any work started.
**Did:** confirmed 411 migrations, max `20260809170500`, clean.
**Found:** a clean match.
**Did NOT do — and this matters:** **its verdict covered the migration ledger ONLY, not the data.**
The orchestrator over-extended it to identity data in later briefs and was wrong. That error is why
block 6 hit a blocker. See §5.3.

## 3. PopDAM OrderList #613 — PR #635, OPEN, one fix in flight

**Asked to:** build the shared database contract for PopDAM's order list (Step 1 of issue #613).
**Did:** 4 canonical objects, a serving view, a saved-views table, 3 write RPCs. 86 object tests
and 33 behaviour tests, all passing, rollback-scoped with zero residue.
**Found:** a pre-existing `unique nulls not distinct (source_system, source_id)` on
`plm.production_order` and `plm.production_order_line`, meaning **each table could only ever hold
ONE row with no source pair.** The orchestrator approved changing both to `nulls distinct` plus
stamping the source pair in the RPC (migration `20260810060000`).
**In flight, review Finding 1:** `link_dam_order_line` counts candidates scoped by `plm_item_id`,
so it never asks whether the SKU resolves to exactly one item. It would stamp a line `matched`
against an arbitrarily chosen product — which is precisely the 449-case ambiguity population. The
code contradicts its own comment. **The fix was allocated `20260810100000` and is NOT in the PR.**
**Did NOT do:** it was **forbidden** from touching the identical trap on `plm.item`.

## 4. Paramount #623 — PR #636, OPEN, one fix in flight

**Asked to:** build the Paramount Creative Library landing schema and private metadata import.
**Did:** 23 tables, 8 `api` views, 7 functions, 24 triggers, a loader, 35 contract tests. Loader
dry-run: all 20 populations match, 0 of 258 batches incomplete.
**Found — three defects it caught in its own draft before applying.** The dangerous one:
`force row level security` on all 23 tables, which combined with SECURITY DEFINER functions running
as `postgres` **would have filtered every INSERT to zero rows and reported success — a green
migration, a green ledger, and an empty database.** Also `NEW` referenced in a DELETE trigger, and
two reporter functions marked SECURITY DEFINER and granted to `authenticated` (a read-around of
row-level security).
**In flight:** `load_pmt_capture_chunk` returns 0 instead of refusing when given an invalid target
name with an empty chunk. Allocated `20260810090000`. **Not in the PR.**
**Did NOT do:** it was halted mid-flight once, because the orchestrator dispatched it against a
build that contradicted two settled owner rulings (§4 item 1). Work resumed after Albert lifted the
hold.

## 5. Warner #588 — PR #637, OPEN — **CORRECTED**

> The orchestrator's dictated summary said phase 2 "was approved but NEVER STARTED." **That is
> wrong.** PR #637 exists and is complete. Verified: head `02597d85`, two files, eight checks
> passing.

**Asked to:** land the Warner STARLABS source extract, and write the scrape-contract doc that had
been referenced everywhere but never existed.
**Did (phase 1):** ruled issue #583 stale — the "two competing PRs" are not competing; PR #2 is an
abandoned 2-row checkpoint, PR #3's lineage (with #6, #7, #8) is authoritative, and every README
count matches the file at pinned commit `9092c51afc42c080f199e5784451425810c39316`.
**Did (phase 2):** migration `20260810030000` plus the previously-missing
`docs/licensor-portal-scrape-source-schema-20260807.md`. **48 objects:** 8 tables, 13 indexes, 8
RLS policies, 17 functions, 2 `api` views. No `core.*` object and no `core` write.
**Proved:** full Postgres grammar validation of 162 statements and 17 plpgsql bodies via `pglast`;
`check-sql.sh` clean; production read-only confirmed **0** `plm.wb_*` tables and **0** `sync_wb_*`
functions; all eight row counts matching pinned commit `9092c51a`; referential integrity in all
eight directions with zero orphans. Its phase-1 worry that 159 Product properties lacked identity
rows was **wrong** — all 165 resolve.
**Three bugs it caught before shipping:** doubled `%%` surviving into 61 `RAISE` strings (prints a
literal `%` instead of substituting, so every guard-failure message would have been unreadable);
`%s` used as a plpgsql placeholder when the correct token is `%` (shrink-band messages would have
printed `4158s`); and a temp-table collision where `ON COMMIT DROP` does not fire until the
transaction ends, so calling all eight loaders in one transaction — the normal full-refresh shape —
would have failed on the second with "relation `_wb_raw` already exists".
**Did NOT do — say this plainly: it never applied to preview.** Its preview run (`31342963264`) was
queued behind the waiting production gate (§5.1) and never executed. **The 48 objects are
grammar-checked and statically proven but have never been proven to exist or behave in a live
database.** It also deliberately omitted an `api.wb_source_integrity` orphan-reporting view as
outside its claim, returning orphan counts from each link loader as `rows_orphan_identity` instead.
**Near-miss worth remembering:** `C:\repos\licensor-source-data-warner` has a **staged deletion** of
`links-property-character.csv`, the only file carrying direct Warner property-to-character records.
An agent reading the working tree instead of the pinned commit would load **zero** of them and not
notice.

## 6. DB Data Admin #607 — PR #631, OPEN, approved, awaiting the combined merge

**Asked to:** provision Carlos for Product Depth editing; the Designer role alone was not enough.
**Found — much bigger than the ask:** `app.app_access` in **production** holds **zero** rows with
`app = 'admin'`, for anybody, **including all three active administrators**. So every DB Data Admin
surface is closed to every human user, and there is **no provisioning route at all** — the only
writer is the signup hook, which does not grant `admin`.
**Did:** migration `20260810050000` provisions all 3 administrators plus the named designer. DML
only, no schema change. Reviewed and re-verified: reproduced the reviewer's "Rail 1" concern on
preview (the pre-review body aborted with `P0001`; the reviewed body completed clean).
**Caveat carried in the PR:** preview's ledger row for `20260810050000` was written by the
pre-review body, and a recorded version never re-runs — so the reviewed body is transaction-true,
not ledger-true.
**Did NOT do:** the orchestrator judged a superseding migration file **not** warranted. It also did
**not** hard-code "3 administrators and 4 targets" (§4 item 2) — the count is derived, with a
non-fatal notice.

## 7. PopDAM data quality #541 (the "Exorcist" assets) — NOTHING WRITTEN, blocked on the owner

**Asked to:** investigate 8 PopDAM assets filed under the wrong licensor.
**Did:** phase 1 plus a deep root-cause analysis. **Wrote no code and no migration.**
**Found:** it is 9 rows, not 8, all one SKU. Root cause, durability asymmetry, the folder-position
resolver defect, the ~9,973 wrong foreign keys, the 73,476 property-less assets, and the
`____New Structure` wildcard trap. **All detail is in §5.6 — read it there.**
**Did NOT do:** it deliberately stopped before writing anything, because the fix depends on three
rulings only Albert can give (§0 item 7).

## 8. Licensing resolvers #522/#524/#525 — PR #633, MERGED

**Asked to:** fix three filed resolver defects.
**Did:** found that #524 and #525 were **one** defect: every marker rule matched the start or end of
the whole name, but real labels are compounds. It fixed the approach rather than the symptoms.
Tests went 697 → 716.
**Found:** a **fourth** instance nobody had filed, and fixed that too.
**Warning it left:** issue #526's validator can now flag two new kinds of problem, so a spreadsheet
that used to come back clean may not.
**Did NOT do:** it did not touch #526 itself.

## 9. Merch-group taxonomy doc #556 — PR #630, MERGED, issue closed

**Asked to:** correct the disproved lines in the merch-group taxonomy document.
**Did:** four sentences disproved and superseded in place with evidence anchors; the conclusions
that survived were re-confirmed and left standing.
**Found:** one other document with the same overreach —
`docs/master-data-cutover-scoreboard.md:148-152`.
**Did NOT do:** it flagged that second document but did **not** edit it. Still open.

## 10. Skills audit — `u2giants/ai-devops` PR #16, MERGED, issue #574 closed

**Note: this is a DIFFERENT repository** (`u2giants/ai-devops`), where the shared AI skills live.
**Asked to:** audit the shared-db-related skills against the current rulebook.
**Did:** corrected 20 items across 10 skill files.
**Found — the dangerous one:** `skills/codex/codex-shared-db-change/SKILL.md` carried a preview
project ref that **is not a project in this account** (`xjcyeuvzkhtzsheknaiu`) in three places, and
taught an app-repo session to go **straight from a preview push to a direct production `db push`**
with no owner approval, no §5 checklist, no bounded temp checkout, and no mention that only the
orchestrator may do the work.
Also corrected the orchestrator skill's claim that branch protection `strict` is `false` — verified
live via the GitHub API that it is **`true`**.
**Root cause UNFIXED and it will recur:** skills live in `ai-devops`, their rulebook lives in
`shared-db`, and CI in neither repo sees both.
**Housekeeping note:** a concurrent session committed onto this agent's first branch mid-run
(`c183528`, local and unpushed, on `skills/shared-db-rulebook-audit-574`). Somebody should decide
what that commit is.
**Did NOT do:** it did not build the cross-repo CI that would prevent recurrence.

## 11. NBCU import — PR #634, OPEN, complete and green

**Asked to:** land the NBCU Creative Asset Factory data (a multi-step issue; this covered steps 1,
3 and 5).
**Did:** step 1 gate passed with **every one of 16 counts matching exactly** (108,026 assets),
verified by a proper RFC 4180 CSV parse rather than `wc -l`. Steps 3 and 5: 16 tables, 2 functions,
59 indexes, RLS on all 16. **160 tests passing, 0 failing.**
**Found:** the `plm` schema-wide privilege hole — full detail in §5.7. Fixed for `nbcu` at
`20260810080000`.
**Also:** resolved a genuine impossibility in the spec — §7 asks `finalize` to both persist a
rejection **and** raise an error, which cancel each other out — in favour of the evidence
surviving.
**Did NOT do:** it deliberately left `plm.erp_*` carrying UPDATE, DELETE and TRUNCATE ×4, as the
before-picture for a general fix nobody has been assigned. **Step 4 is blocked on one thing:** the
rule for which of `LICENSED_SCOPE.md`'s 75 lines are the 57 documented rights.

## 12. Production lane #614–#617 — PR #626 MERGED; #615 blocked on the owner; #616 and #611 in flight

**Asked to:** make the production migration lane actually runnable.
**Did (#614, merged as PR #626):** bounded `--include-all` plus `assert-bounded` in the migrations
workflow.
**How it proved its own test — and the lesson:** by **mutation** rather than assertion. Its first
mutation run reported a pass because the patch had silently no-opped through a mangled heredoc.
"The mutation passed" and "the mutation never ran" are indistinguishable in a terminal. It added an
`assert new != s` guard. **Copy that habit.**
**Re-derived the allowlist** against the live production ledger: 361 rows, head `20260802194100`,
411 local files, 50 missing, **47 to apply.** Three were removed: `20260729120000`
(RETIRE / HARD_BLOCKED) and `20260802170000` + `20260802171000` (HELD under AGENTS.md §6.5). **The
full 47-version list is in `docs/verification/production-apply-set-and-rehearsal-20260809.md` and
must be carried forward.**
**Corrected its own recommendation, unprompted, twice.** First: there is no Supabase Management API
endpoint that clones to a **new** project — every restore path restores *into* the project named in
the path, so pointed at production it would overwrite production. Second: its own #616 schema
allowlist (`plm`/`core`/`api`/`pim`) would have restored `dam` **empty**, so the validating foreign
key that `20260731150000` adds to `dam.popsg_property_resolution` would validate trivially and the
rehearsal would silently prove nothing. It replaced that with
`pg_dump --exclude-table-data` naming exactly the six large tables, and proved read-only that
**none of the 47 migrations touches any of the six**, checking the real foreign-key graph for
indirect revalidation rather than just table names.
**#611 canary attempt 1 failed** and the throwaway project was deleted with post-delete re-fetch
evidence (it lived 2m38s). Cause: **its readiness probe tested the Management API path while the
actual work used the connection pooler, so a passing probe meant nothing.** Attempt 2 was running
at session end.
**Did NOT do:** #609 guard-lexer defect F1 is queued; **F2 and F5 were deliberately left untouched**
(0 of 411 migrations have live exposure). And it **refused to approve the production gate with
Albert's credentials** even though it could — see §5.2.

---

## Self-audit (mandatory gate — run before this file was shown)

**1. Could a brand-new developer pick this up and not skip a beat?** Yes. §1 defines the app, the
two database projects, the file-naming scheme and the rulebook. §3 gives the exact live state with
SHAs and PR numbers. §6 gives copy-paste commands with verification gates. Every identifier used is
defined at first mention.

**2. Could they continue as effectively as the orchestrator can right now?** Yes. The three things
that only existed in the orchestrator's head are written down: the merge deadlock and its approved
fix (§5.4), the concurrency block that makes owner item 1 urgent (§5.1), and the credential hole
(§5.2). Each sub-agent's findings and refusals are in part (b), including the two fixes that were
allocated versions but never shipped (§6 step 3, blocks 3 and 4).

**3. Is every relevant detail included?** Yes. Background §1; goals §2; state §3; failures §4 (nine
dead ends, each with why it failed); root causes §5; next actions §6; constraints §7; access §8;
risks and dated decisions §9; per-agent detail in part (b). Gaps found and fixed during the audit:
the deadlock table was four PRs and is now five; block 5 said "never started" and now records the
real PR #637; the concurrency mechanic and the local `GITHUB_REPOSITORY` skip were missing and are
now §5.1 and §4 item 8.

**4. If the owner read ONLY section 0, would he see every decision needed from him?** Yes, and it
was answered the hard way by walking §1–§9 and part (b) line by line. The sentences needing his
judgement are: the waiting run (§3, §5.1, §6 step 2) → §0 item 1; the credential hole (§5.2) → item
2; `can_admins_bypass` (§5.2) → item 3; `prevent_self_review` (§5.4 context) → item 4; the gated
rehearsal proposal → item 5; the published email and name (§9) → item 6; the three Exorcist
rulings (§5.6, block 7) → item 7. All seven appear in §0 with a recommendation. Items 5, 6 and 7
are out-of-scope findings that would otherwise never have been raised.
