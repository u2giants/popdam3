# Implementation plan — harden the dispatch-time collision check

**File:** `plan_dispatch-collision-hardening.md` · **Repo:** `u2giants/shared-db` · **Created:** 2026-08-06
**Companion handoff:** `HANDOFF.d/2026-08-06T1700Z-t16-orchestrator-dispatch-hardening.md` (write it at session end; neither document should be read alone)

---

## STATUS — read this first

| # | Step | Phase | State | Date |
|---|---|---|---|---|
| 1 | Remove the verdict — message **and** the internal `safe` name **and** the exit-code docs | A | ✅ done | 2026-08-07 |
| 1b | **Disable `--allocate-version`** (fail with an explanation) — it reserves nothing | A | ✅ done | 2026-08-07 |
| 2 | Add the failing tests that route real DDL through the parser | A | ✅ done — landed as `todo`, RED; **step 3b must remove the `todo` flag** | 2026-08-07 |
| 2b | Fix the four gatherer defects: **draft PRs excluded**, one-version-per-PR, deleted files, unencoded path | A | ✅ done (all **five**) | 2026-08-07 |
| 3a | **Historical noise gate** — reconstruct concurrently-open PR sets; fix the acceptance rule BEFORE seeing results | B | ⬜ open | — |
| 3b | Return **structured operations** `{action, kind, target}`; separate dispatch policy from merge policy | B | ⬜ open | — |
| 4 | Default object derivation to `--sql`; make bare `--objects` warn | B | ⬜ open | — |
| 5 | **`--claim`: acquire OBJECT refs atomically.** Check and claim become one operation | B | ⬜ open | — |
| 5b | Release object refs on merge (CI) + a staleness rule for abandoned holds | B | ⬜ open | — |
| 6 | Add `--reserve-version` (atomic create-ref); version refs are **kept permanently** | C | ⬜ open | — |
| 7 | ~~Add `branch`/`pr` binding to the claim block~~ — **SUPERSEDED by step 5**; the ref's target commit *is* the binding | — | ✂️ cut | 2026-08-06 |
| 8 | Update `AGENTS.md` §4 rule 1 and the orchestrator skill to match | C | ⬜ open | — |

**Phase A is COMPLETE (2026-08-07). A fresh session starts at Step 3a.**
⚠️ **Read §14 — DRIFT AFTER PHASE A — before starting step 3a.** Phase A changed
function signatures and field names that steps 3b, 4, 5, 5b, 6 and 8 all assume,
and it left four tests deliberately RED-as-`todo` that step 3b must un-mark.

> **Reviewed twice and revised twice.** GPT-5.6 (Codex) found four scheduled-nowhere bugs,
> a better architecture for step 3, and a sequencing error. Grok 4.5 then found that **the
> lock was on the wrong thing** and the design changed materially as a result — see the
> box below. What changed and why is in §7 (R7–R12) and §8 (D11–D18). **Do not "restore"
> the earlier shape of steps 1, 3, 5 or 6** — each was reviewed and found wrong.

> ## ⚠️ THE CENTRAL DESIGN CHANGE — read before touching step 5 or 6
>
> The first two drafts made **version** reservation atomic and left **object** claiming as
> "run a check, then paste a command later." Grok 4.5 pointed out that this is backwards:
>
> - The 2026-07-31 four-way incident was **the same object**, not the same version.
> - Duplicate versions are **already blocked at merge** by `scripts/check-sql.sh`.
> - Two orchestrators could both get exit 0 for `plm.promote_coldlion_source_owned`, both
>   print a claim command, and both dispatch. Nothing serialised them. In its words, the
>   tool was *"a race reporter with extra steps, not a lock."*
>
> **The fix, and the shape of the whole tool now: do not check-then-claim. Just claim.**
> Acquiring an object is `POST /git/refs` on `refs/db-claims/objects/<kind>/<key>` — it
> succeeds or returns `422 Reference already exists`. Acquisition **is** the check, so the
> time-of-check/time-of-use gap does not exist, and an agent can never collide with its own
> claim on a re-run.
>
> **Verified live on 2026-08-06** (refs created, second attempt rejected, then deleted):
> object-encoding ref names are legal; the second `POST` returns 422; every holder is
> listable in one call via `git/matching-refs/db-claims/objects`.
>
> This **deletes** work the earlier drafts scheduled: the claim-issue mini-language, its
> heredoc recipe, most of `parseClaimBlock` hardening, and the separate binding step.

**Out of this plan entirely:** the enforcement CI check, the scaffold tool, and the
auto-draft bot. See §4.

---

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** several AI sessions work on one shared company database at
the same time. We want to stop two of them being sent to change the same thing, *before*
either does the work — so nobody's work has to be thrown away, and so two changes can
never quietly overwrite each other.

A tool for this was built and merged this morning (PR #464). **It currently gives the
wrong answer in the most common case.** It tells the orchestrator "SAFE TO DISPATCH" when
two agents are both about to alter the same table, because the SQL parser it uses cannot
see `alter table` at all. This plan fixes that, and makes the tool honest about the limits
of what it checked.

> **If a step in this plan conflicts with that goal, THE GOAL WINS — stop and flag it.**
> Specifically: if a change would make the tool *more* likely to print a confident answer
> it cannot justify, do not make it, even if this document says to. The failure mode we
> are eliminating is false confidence, not missing features. A tool that says "I could not
> tell" is correct; a tool that says "safe" when it did not look is the bug.

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for **one** Supabase PostgreSQL database
shared by five applications, each in its own separate repo:

| App | Status | Repo |
|---|---|---|
| PopDAM | live | `u2giants/popdam3` |
| PopCRM | live | `u2giants/popcrm-web` |
| DesignFlow PLM ("dflow") | live | `popcre/designflow-*` (six repos) |
| PopPIM | in development | `u2giants/poppim-web` |
| monitor | live | `u2giants/synology-monitor` |

There is no "just this app" change here — a bad schema change breaks all five at once, and
it is usually found days later by a user rather than by a test.

- **Branch model:** `shared-db` uses branch + PR, and **the AI merges its own PRs.** Do not
  self-merge in the dflow repos; that rule is specific to shared-db.
- **Databases:** preview `rjyboqwcdzcocqgmsyel`, production `qsllyeztdwjgirsysgai`. Every
  migration goes to preview first and is proved there before production.
- **Stack for this plan:** plain Node.js ESM scripts under `scripts/`, no build step, no
  framework. Tests are `node --test`. **No database access is needed for any step in this
  plan** — everything here reads GitHub metadata and committed `.sql` text.
- **Who works here:** AI sessions (Claude, Codex, GLM, Grok, Kimi) across several machines,
  frequently 3–7 at once. The owner, Albert Hazan, is a business owner and **not a
  programmer** — he cannot maintain manual discipline, so controls must be mechanical.

---

## 3. What triggered this work

On 2026-08-06 the dispatch-time collision check (`scripts/check-dispatch-collision.mjs`)
was written and merged as **PR #464** (`e1db90d`). Two independent model reviews — Kimi K3
and GLM 5.2 — then reviewed it, and GLM found a defect that was **reproduced locally**:

```bash
# Agent A has an open PR containing:  alter table core.licensor add column risk_tier text;
# Agent B is proposed to touch the same table:
node scripts/check-dispatch-collision.mjs --task "agent B" --objects "table core.licensor"
```

Output:

```
Checked against 1 in-flight item(s).
SAFE TO DISPATCH — no in-flight work touches these objects.
```

Exit code `0`. **This is false.** The PR does touch `core.licensor`; the parser simply
cannot see `alter table`.

Reproduce the parser blindness directly:

```bash
node -e 'import("./scripts/check-pr-object-collisions.mjs").then(m=>{
  console.log(m.extractObjects("alter table core.licensor add column foo text;")); // []
  console.log(m.extractObjects("create table core.widget (id uuid primary key);")); // []
  console.log(m.extractObjects("create index idx on core.licensor(code);"));        // []
  console.log(m.extractObjects("grant select on core.licensor to anon;"));          // []
})'
```

**Measured scale of the blind spot** (run in the repo root):

```bash
grep -rioE "create (or replace )?(function|procedure|view|trigger)|create materialized view|create policy|drop (function|view|trigger|policy)" supabase/migrations/ | wc -l   # 754  (modelled)
grep -rioE "alter table|create (unique )?index|^ *grant |comment on|create table|create type|alter function|alter policy" supabase/migrations/ | wc -l                        # 1921 (NOT modelled)
```

Roughly **2.5 unmodelled statements for every modelled one**, and the unmodelled class
includes the additive-column change that `AGENTS.md` §4 rule 3 actively encourages as the
safe default.

---

## 4. Scope — in and out

### In scope

Hardening `scripts/check-dispatch-collision.mjs`, broadening `PATTERNS` in
`scripts/check-pr-object-collisions.mjs`, their tests, and the two documents that describe
the dispatch gate (`AGENTS.md` §4 rule 1 and the `shared-db-orchestrator` skill).

### Explicitly NOT in this plan

1. **The enforcement CI check** (fail a migration PR with no covering claim). Deliberately
   deferred — see §7 rejected approach R4.
2. **The scaffold tool** (`tools/new-migration.mjs`) and the **auto-draft claim bot**. Both
   are good ideas from Kimi K3; both are follow-on work with their own plan.
3. **Migrating `COORDINATOR_INTAKE.md` to GitHub Issues.** Separate, larger decision the
   owner has not yet made.
4. ~~**Fixing `scripts/check-backlog-queue-sync.mjs`** (the documented false-passing required
   check). Real and worth doing — tracked in the `REQUEST QUEUE` — but a different defect.~~
   ⚠️ **RESOLVED 2026-08-07, and NOT by fixing it.** The script, its tests and its workflow
   are **deleted**, and the `Backlog / queue sync` required context was removed from branch
   protection by owner instruction naming it. The queue it read no longer holds the work —
   that moved to GitHub Issues the same day. **Do not try to fix it; there is nothing there.**
   The tracking issue is closed as retired. The `REQUEST QUEUE` this item pointed at no
   longer exists either; work is now `gh issue list --label db-work`.
5. **Any change to `scripts/check-pr-object-collisions.mjs` behaviour other than adding
   patterns.** Its `Skip`-to-green posture is correct for a required merge gate and must
   not be altered. Broadening `PATTERNS` *will* make that guard stricter too; that is
   intended and is a bonus, but no other change to it is in scope.
6. **Any database contact whatsoever.** No migration, no preview push, no production
   access, no `supabase` CLI, no Supabase MCP call, no `psql`.

---

## 5. Current state of the code

All of the following is **merged to `origin/main`** and deployed nowhere (these are
developer scripts, not a running service). `main` tip at time of writing: `700f08f`.

| Artefact | State |
|---|---|
| `scripts/check-dispatch-collision.mjs` | Merged (PR #464). ~470 lines. **Contains the defect.** |
| `scripts/check-dispatch-collision.test.mjs` | Merged. 23 tests, all passing — **and all blind to the defect** (see §6). |
| `scripts/check-pr-object-collisions.mjs` | Pre-existing merge-time guard. `PATTERNS` at line 128. Unchanged today. |
| `.github/workflows/pr-object-collision.yml` | Runs both test suites in the job named `Cross-PR object collision`. |
| `AGENTS.md` §4 rule 1 | Updated by PR #465 to name the dispatch command. |
| `shared-db-orchestrator` skill | In `u2giants/ai-devops` at `skills/claude/shared-db-orchestrator/SKILL.md`, commit `9d56671`. **Not in this repo.** |
| `db-claim` GitHub label | Created on `u2giants/shared-db`. **Zero claims filed so far.** |

### Exact locations you will edit

> ⚠️ **REFRESHED 2026-08-07 after Phase A. Every line number in the STEP BODIES
> below (§9) is from before Phase A and is now WRONG by 20–60 lines.** Trust this
> table, or better, `grep` for the symbol name — the names are stable, the numbers
> are not. Items Phase A already resolved are struck through.

| What | Where (as of `main` @ `60b130c`, 2026-08-07) |
|---|---|
| `PATTERNS` array (the parser's whole vocabulary) | `scripts/check-pr-object-collisions.mjs:128–229` |
| `KNOWN_DDL_CLASSES` (**new** — the NOT-CHECKED vocabulary) | `scripts/check-pr-object-collisions.mjs:231` |
| `describeCoverage` (**new** — derives CHECKED / NOT CHECKED) | `scripts/check-pr-object-collisions.mjs:257` |
| `extractObjects` | `scripts/check-pr-object-collisions.mjs:281` |
| `parseClaimBlock` (the brittle parser) | `scripts/check-dispatch-collision.mjs:108` |
| `findDispatchConflicts` (returns `overlapFound`, compares `versions[]`) | `scripts/check-dispatch-collision.mjs:169` |
| ~~`formatReport` — the `SAFE TO DISPATCH` line~~ **removed in Phase A** | `scripts/check-dispatch-collision.mjs:222` (the coverage report lives here now) |
| ~~`gatherOpenPrObjects` — `version ??= stamp` bug~~ **fixed in Phase A** | `scripts/check-dispatch-collision.mjs:388` |
| ~~Unencoded filename in contents fetch~~ **fixed in Phase A** | `encodeRepoPath` at `scripts/check-dispatch-collision.mjs:376` |
| `defaultIo` (**new** — the injectable GitHub calls) | `scripts/check-dispatch-collision.mjs:433` |
| ~~`--allocate-version` implementation~~ **withdrawn in Phase A** | the tombstone is in `main()` at `scripts/check-dispatch-collision.mjs:506` |
| `nextFreeVersion` (kept for step 6; comment corrected) | `scripts/check-dispatch-collision.mjs:215` |
| `versionsOnDisk` (kept for step 6; no runtime caller today) | `scripts/check-dispatch-collision.mjs:446` |
| `claimCommand` (emits the `db-claim` block; step 5 deletes it) | `scripts/check-dispatch-collision.mjs:277` |
| `USAGE` (exit-code documentation) | `scripts/check-dispatch-collision.mjs:479` |

### Branch/commit state

Working tree on `main`, clean except two untracked directories that are **not yours and
must not be deleted**: `.ai/deepseek-sessions/` and `.ai/reviews/`.

---

## 6. Key findings and root cause

**Root cause:** `extractObjects` (`check-pr-object-collisions.mjs:235`) iterates a fixed
`PATTERNS` list (line 128) containing exactly six object kinds — `function`, `procedure`,
`view`, `materialized view`, `trigger`, `policy` — in `create`/`drop` forms only. There is
no `table`, no column, no index, no grant, no type, and **no `alter` verb of any kind.**
The script's own header admits this at lines 62–63. That limitation is *acceptable* for a
merge-time backstop and *not* acceptable for a dispatch-time tool that prints a verdict.

**Why the 23 existing tests do not catch it — this is the important finding.** The test
helper at `check-dispatch-collision.test.mjs:73`:

```js
const CLAIM = (label, objects, version = null) => ({ label, objects, version, url: `https://x/${label}` })
```

injects object arrays **directly**. No test routes real SQL through `extractObjects` into
`findDispatchConflicts`. Consequence: **if `extractObjects` returned `[]` for every input,
the entire suite would still pass.** The test that would have caught this does not exist —
that is Step 2, and it must be written *before* the parser fix so it is watched to fail.

**Four further defects in `parseClaimBlock`, all reproduced:**

```
parseClaimBlock("```db-claim\nobjects:\n  # a comment\n  - table core.a\n```")
  → { version: null, objects: [] }        ← ALL objects silently dropped
parseClaimBlock("```db-claim\nversion: 20260806120000 # allocated\n…")
  → version: null                          ← inline comment kills version matching
parseClaimBlock("```db-claim\nversion: null\n…")
  → version: "null"                        ← literal string; only 'none' is special-cased
parseClaimBlock("```db-claim\nobjects: [table core.a]\n```")
  → objects: []                            ← compact list form unmatched
```

The first is the most dangerous: a single `#` comment turns a claim into an **empty claim
that can never collide** — a silent false-safe inside the ledger itself.

**The allocator does not do what its own comment claims.** `--allocate-version`
(line 444) computes a stamp from `new Date()`, checks it against versions on disk and in
open claims, and then **prints** a suggestion. Nothing is reserved between the check and
the (manual) filing. Two orchestrators dispatching in the same minute both see the version
as free and both take it. The header comment on `nextFreeVersion` (line 190) says this
"kills the duplicate-timestamp class"; **it does not**, and that comment must be corrected.

**Verified facts about the git-ref locking primitive** (all tested live against
`u2giants/shared-db` on 2026-08-06, test refs created and deleted):

| Claim | Result |
|---|---|
| GitHub refuses custom ref namespaces like `refs/db-claims/*` | **FALSE.** The push was accepted. (GLM 5.2 asserted this; it is wrong.) |
| `git push` of a non-descendant to an existing ref is rejected | TRUE — `! [rejected] … (non-fast-forward)` |
| `git push` of a **descendant** to an existing ref is rejected | **FALSE — it SUCCEEDS and silently steals the lock.** |
| `POST /repos/{o}/{r}/git/refs` on an existing ref fails | TRUE — `422 Reference already exists` |
| `POST /repos/{o}/{r}/git/refs` on a new ref succeeds | TRUE |

**Therefore a plain `git push` is NOT a create-only primitive** and must not be used as
the lock. The GitHub REST create-ref endpoint is, because it has no fast-forward path.

---

## 7. Approaches considered and REJECTED

**R1 — Store claims in a file in the repo.** Rejected before PR #464. A claims file is a
single-writer document edited by many concurrent sessions; that is precisely the design
that made `COORDINATOR_INTAKE.md` (4,542 lines) a merge-conflict magnet. A claim must also
survive the death of the session that filed it. **Do not revisit.**

**R2 — A database registry table (`app.migration_claim`) with `version text primary key`.**
Proposed by GLM 5.2 as "the only concurrency-safe option." **Rejected, and GLM withdrew it
when challenged.** Two reasons: (a) it puts database credentials on the *dispatch* path —
the hot path every task crosses — in order to solve a *wasted work* problem, and this repo
already suffered a **442-row production `DELETE`** from a session that believed it was on
preview (`AGENTS.md` §4.2, incident 2026-07-31); the blast-radius asymmetry is
unacceptable. (b) The orchestrator is explicitly forbidden from making database calls at
all, which is a load-bearing control, not an incidental style rule. **Do not reintroduce
without owner sign-off.**

**R3 — `git push origin HEAD:refs/db-claims/<version>` as the atomic lock.** This was *my*
counter-proposal to R2 and **it is broken** — see the table in §6. A descendant commit
fast-forwards straight over an existing ref and steals the claim silently. GLM's separate
objection (that GitHub refuses the namespace) is *also* wrong. Both were tested. Use the
REST endpoint instead. **Do not "simplify" step 6 back to a plain `git push`.**

**R4 — Build the enforcement CI check now** (fail a migration PR with no covering claim).
Deferred, on Kimi K3's reasoning, which I accept: ship the check before the compliant path
is cheap and the first week is red X's on the owner's ad-hoc sessions, followed by pressure
to add an exemption label — and an exemption label becomes the norm and kills the gate.
Build the scaffold tool and auto-draft bot first so compliance is the path of least
resistance, *then* the check. **Not a rejection of the idea — a sequencing decision.**

**R5 — Revert PR #464 entirely** until the parser can see the dominant DDL class. Argued
as option (B) to GLM. **Rejected on evidence:** every incident that has actually occurred
(the four-way `create or replace function` collision, both duplicate-timestamp incidents)
falls in the class the check *does* model. The blind spot is a latent risk measured by
statement frequency, not the shape of anything that has yet bitten. Fixing in place is
cheaper and keeps the value. **Reconsider only if a real `alter table`/`grant` collision
occurs that this tool's output abetted** — that would be evidence, and B would become
correct retroactively.

**R10 — Object claims as GitHub-issue bodies parsed with a mini-language (drafts 1 and 2).**
Rejected after Grok review. An issue body is not create-if-absent, so it cannot serialise
anything: two orchestrators could both read "no claim exists", both file one, and both
dispatch. It also required a hand-rolled parser that produced four reproduced defects in a
day, and a shell recipe that did not work on this machine's shell. Atomic refs give
exclusivity, binding and listing for free and delete all of that code. **Do not reintroduce
issue-parsing as the lock.** An issue as *optional human commentary* is fine (D15).

**R11 — Check first, then claim in a separate step.** Rejected: that is a
time-of-check/time-of-use race, and it was the actual hole in the merged tool — the
motivating 2026-07-31 incident is precisely the case where both agents pass the check
before either claims. Acquisition must **be** the check.

**R12 — Releasing object refs on the same "never release" rule as version refs (D13).**
Rejected as a category error, and called out because the two rules sit side by side and
look contradictory. A version ref reserves an integer from an unbounded space, so keeping
it forever is free and *safer* (the preview ledger is persistent). An object ref is a lock
on a real thing; never releasing it freezes that object permanently. **Version refs:
permanent. Object refs: released.** See D13 and D16.

**R7 — One flat `PATTERNS` list shared by both checks (the first draft of step 3).**
Rejected after Codex review. It couples extraction to policy: the merge guard is a required
check built around whole-object replacement, and making it report every table touched would
render its own failure messages inaccurate. Structured operations with per-consumer policy
keep D6 (one parser) without forcing D-one-policy. **Do not collapse this back.**

**R8 — Deleting reservation refs when work merges or is abandoned.** Rejected on Codex's
argument, which beat mine: preview is a persistent database whose ledger holds every
version that ever ran `db push`, including from abandoned branches, so a released number
could collide with something preview already recorded. Refs are kept permanently. This also
deletes an entire class of machinery (rollback, ownership, reconciliation) that would
otherwise need building and maintaining.

**R9 — A two-phase transaction (ref + issue) with rollback, ownership metadata, idempotent
retry and a reconciliation command.** Codex initially required this before shipping
reservation; **I argued it was over-engineered and Codex withdrew it.** The reasoning: an
orphaned ref wastes one integer from an unbounded, monotonic space and is invisible in the
branch list, whereas the proposed machinery is new state to maintain in a repo whose
defining pathology is process machinery outgrowing the work. The one real hazard —
continuing after the *issue* fails to file — is handled by a loud non-zero exit (step 6,
point 4) rather than by a transaction.

**R6 — Keep "SAFE TO DISPATCH" but add caveats after it.** Rejected on GLM's argument,
which is the sharpest point of the review: an advisory tool that prints "SAFE" invites
overtrust regardless of what follows, because agents grep for the word and act on it. The
verdict must be *removed*, not qualified.

---

## 8. Design decisions already made

| # | Decision | Status | Reasoning / date |
|---|---|---|---|
| D1 | ~~Claims live in GitHub issues~~ — **SUPERSEDED by D15.** The lock is an atomic object ref; an issue is optional commentary. The *reason* still stands: claims are not a repo file (R1). | ⤴️ superseded | R1, then R10. 2026-08-06 |
| D2 | The dispatch tool makes **no database calls** | **LOCKED** | R2, `AGENTS.md` §4.2. 2026-08-06 |
| D3 | Advisory output carries **no verdict word** — report only | **LOCKED** | R6, GLM 5.2. 2026-08-06 |
| D4 | Version reservation uses the **GitHub create-ref REST endpoint**, never `git push` | **LOCKED** | Tested; R3. 2026-08-06 |
| D5 | ~~Claims carry branch/PR binding in the issue body~~ — **SUPERSEDED by D17.** The requirement stands and is now free: a ref's target commit *is* the binding. | ⤴️ superseded | Kimi K3 found the enforcement false-pass; refs satisfy it without a parsed field. 2026-08-06 |
| D6 | Reuse one SQL parser (`extractObjects`) — never grow a second | **LOCKED** | Two parsers drift. 2026-08-06 |
| D7 | "Cannot declare objects → dispatch READ-ONLY" stays as brief-quality guidance | **LOCKED** | Both models agree it is sound taxonomy and **useless as a control**. Keep it; **never cite it as a reason enforcement is unnecessary.** 2026-08-06 |
| D8 | Exact ref namespace (`refs/db-claims/*` vs `refs/heads/db-claims/*`) | **OPEN** | Both work. Prefer `refs/db-claims/*`: invisible in the branch list, so it cannot add to the 131-branch clutter. Implementer's call. |
| D9 | Whether broadened `PATTERNS` should distinguish column-level from table-level | **OPEN** | Table-level granularity (`table core.licensor`) is simpler and over-blocks slightly. Column-level is precise and more code. **Start table-level**; note it. |
| D10 | Exact staleness definition for **claim issue** release | **OPEN** | Needs a rule before release can be automated. Suggested: bound PR merged/closed, **or** no bound PR and age > 7 days. Applies to issues only — refs are never released (D13). |
| D11 | Parser returns **structured operations**; dispatch and merge apply **different policies** over them | **LOCKED** | R7, Codex 2026-08-06. One parser, two policies. |
| D12 | The required merge guard's policy does not widen without the §3a historical evidence | **LOCKED** | Codex 2026-08-06. Prevents trading a false-clear for alarm fatigue. |
| D13 | Reservation refs are **kept permanently**; no release, no reconciliation | **LOCKED** | R8, Codex 2026-08-06. The preview ledger is persistent, so a reused version can collide with something already recorded there. |
| D14 | Draft PRs **count as in flight** for dispatch (but not for the merge guard) | **LOCKED** | Codex 2026-08-06. Draft work is still work; over-blocking fails safe. Needs a stale-draft rule or abandoned drafts become permanent locks. |
| D15 | **The lock is an atomic object ref. Claim issues are optional commentary and nothing may parse them.** | **LOCKED** | R10, Grok 2026-08-06. Supersedes D1. |
| D16 | **Object refs are RELEASED** (on merge, or when found stale) — unlike version refs | **LOCKED** | R12. Never conflate with D13; confusing them freezes the schema. |
| D17 | Acquisition **is** the check — there is no separate check-then-claim step | **LOCKED** | R11, Grok 2026-08-06. Removes the TOCTOU race and self-collision together. |
| D18 | Any command the tool prints must use `--body-file`/JSON, **never a bash heredoc** | **LOCKED** | Grok 2026-08-06: this machine is PowerShell-first and the heredoc recipe never worked here. |

---

## 9. The plan — ordered, executable steps

> **Read the STATUS table for the execution order — it, not the order of headings below,
> is authoritative.** Steps 1b and 2b were inserted after review and appear out of
> numerical sequence in this document.
>
> **Phase A = steps 1, 1b, 2, 2b** — urgent. Removes the live false-clear, disables an
> allocator that allocates nothing, and fixes four gatherer defects that each produce
> their own false-clear.
> **Phase B = steps 3a, 3b, 4, 5** — the historical gate, then the real parser work.
> **Phase C = steps 6, 7, 8** — reservation, binding, docs.
> Context cut points after Phase A and after Phase B. **Re-read the remaining steps at the
> start of each phase** — this plan may have been updated by whoever did the previous phase.
>
> **AND, AT THE END OF YOUR PHASE — this is a required completion step, not tidying:**
> re-read **every remaining step through step 8**, and report any **drift**: anything you
> did or learned that changes a later step's assumptions, files, identifiers, or approach.
> Then write it into this file before you hand over. A later phase built on a stale
> assumption is the single most expensive failure mode this document has, because the next
> session cannot know what you learned. If nothing drifted, say so explicitly in the STATUS
> table — "no drift" is information; silence is not.

---

### Step 1 — Remove the verdict; report what was and was NOT checked

**File:** `scripts/check-dispatch-collision.mjs`, `formatReport` at lines 197–235
(the verdict is line 206), plus the `USAGE` block at line 383 and the exit-code
documentation.

**What to change.** Delete the string `SAFE TO DISPATCH — no in-flight work touches these
objects.` Replace the clear-result branch with a report naming coverage explicitly, e.g.:

```
No overlap found in the object classes this tool can see.
  CHECKED:     function, procedure, view, materialized view, trigger, policy
  NOT CHECKED: table, column, index, grant, comment, type, and every ALTER form
This is EVIDENCE, not clearance. The orchestrator must confirm no collision in the
unchecked classes before dispatching.
```

The `CHECKED` list must be **derived from `PATTERNS`, not hard-coded**, so it cannot drift
when step 3 lands. Export a `describeCoverage()` from `check-pr-object-collisions.mjs` that
returns the distinct `kind` values, and print that.

Also: when `inFlight.length === 0`, say so prominently — "checked against 0 in-flight
items" is a statement about having found nothing to compare, not about safety.

Keep the collision branch's wording as-is; `DO NOT DISPATCH` is a correct, actionable
negative and does not invite overtrust.

**⚠️ The message alone is not enough — Codex's finding, and it is correct.** Changing only
the printed sentence is partly cosmetic, because the old meaning survives in three other
places that callers actually read:

- `result.safe` at line 177 → rename to **`overlapFound`** (inverted sense), and update
  `findDispatchConflicts`, `formatReport` and the `--json` output together.
- The `USAGE` text at line 400 says "Exit 0 = safe to dispatch" → reword to
  **"Exit 0 = the check completed and found no overlap in the classes it can see."**
- Any doc repeating the old gloss (see step 8).

Do all four in this step. A caller reading `--json` for `"safe": true` must not be able to
keep the old semantics after the printed sentence changes.

**And the exit code still means "go" — decide this deliberately.** Grok's point: grepping
for "SAFE" stops working, but `if ($LASTEXITCODE -eq 0)` does not. Renaming a field does
not change what a script does. Two acceptable resolutions; **pick one and write it into
the docs, do not leave it implicit:**

- **Preferred, and it falls out of step 5:** exit 0 stops meaning "cleared to dispatch" and
  starts meaning **"the claim succeeded — you now hold these objects."** That is a fact
  about state, not a judgement, so a caller acting on it is doing the right thing.
- If step 5 is deferred, document exit 0 as *"completed; no overlap found in the classes it
  can see"* and say plainly that it is evidence, not clearance.

**Behaviour when done.** No output path, field name, or doc line asserts safety. Exit codes
are unchanged (0 / 1 / 2), so nothing that consumes the exit code breaks.

**Dependencies.** None. Do this first.

**Verification gate.**
```bash
node scripts/check-dispatch-collision.mjs --task t --objects "function plm.foo" | grep -i "safe" && echo "FAIL: verdict still present" || echo "PASS: no verdict"
node --test scripts/check-dispatch-collision.test.mjs   # update the two formatReport tests that assert /SAFE TO DISPATCH/
```

---

### Step 2 — Add the test that would have caught everything (watch it FAIL first)

**File:** `scripts/check-dispatch-collision.test.mjs`

**What to change.** Add a test that routes **real DDL text** through `extractObjects` into
`findDispatchConflicts` — the path no existing test exercises:

```js
test('an alter table in an open PR collides with a proposal naming that table', () => {
  const prObjects = extractObjects('alter table core.licensor add column risk_tier text;')
  const result = findDispatchConflicts(
    { objects: ['table core.licensor'] },
    [{ label: 'PR #501', objects: prObjects, version: null }],
  )
  assert.equal(result.safe, false)   // FAILS TODAY — prObjects is []
})
```

Add sibling cases for `create table`, `create index … on`, and `grant … on`.

**Watch it fail before you make it pass** — the B7 standard; a guard is proven by watching
it fire (`.github/workflows/pr-object-collision.yml` lines 55–57 document the same
discipline for the merge guard).

> ⚠️ **Do NOT open a PR containing only the red tests.** Grok caught this: that suite runs
> inside the **required** job `Cross-PR object collision`, so a PR whose tip is red can
> never merge — an implementer following the earlier wording would create a permanently
> stuck PR. The procedure is: run the tests red **locally**, paste the failing output into
> the PR body as the evidence, and land the tests together with the step-3 fix so the
> mergeable tip is green.

**Dependencies.** None; can run in parallel with step 1.

**Verification gate.** `node --test scripts/check-dispatch-collision.test.mjs` reports the
new tests **failing**, with output pasted into the commit message or PR body. Then, after
step 3, the same command reports them passing.

---

### Step 1b — Disable `--allocate-version`

**File:** `scripts/check-dispatch-collision.mjs:444–447`, `USAGE` at 397.

**Why now, not in Phase C.** The flag is live and its own header comment claims it "kills
the duplicate-timestamp class." It does not — it reads, then prints, reserving nothing
(§6). Leaving a tool that overstates its guarantee active for two more phases is
indefensible. Note that duplicate versions **are** already blocked at merge by
`scripts/check-sql.sh`, so disabling this loses no real protection.

**What to change.** Make `--allocate-version` exit 2 with: "this flag never reserved
anything and has been withdrawn; use `--reserve-version` (step 6), or pick a version
manually and rely on the `SQL migration guards` check." Correct the false comment on
`nextFreeVersion` (line 190). Keep `nextFreeVersion` itself — step 6 reuses it to pick the
candidate before attempting the atomic reservation.

**Verification gate.** `node scripts/check-dispatch-collision.mjs --task t --objects "table core.a" --allocate-version; echo $?` → prints the explanation, exits `2`.

---

### Step 2b — Fix the four gatherer defects

**File:** `scripts/check-dispatch-collision.mjs`, `gatherOpenPrObjects` at 322–349.

All four were found by Codex; all four are documented in §6 of the first draft of this plan
and **were scheduled by no step** — a real gap in the plan, not just in the code.

1. **Draft PRs are excluded** (`if (pr.draft) continue`, line 326). This is correct for the
   merge guard — a draft is not competing to merge — and **wrong for dispatch**, where
   draft work is absolutely work in flight. It is a false-clear in its own right. Include
   drafts; label them as drafts in the report. Including them over-blocks, which fails safe.
2. **Only the first migration's version is captured** (`version ??= stamp`, line 334). A PR
   with three migrations exposes one version to collision checking. Replace the scalar
   `version` with `versions[]` through `gatherClaims`, `gatherOpenPrObjects`,
   `findDispatchConflicts` and `formatReport`, and compare every version against every
   version.
3. **Deleted migration files** are fetched anyway. Skip entries whose status is `removed`.
4. **The filename is not URL-encoded** (line 335). ⚠️ **Do not simply copy the sibling's
   `encodeURI` (`check-pr-object-collisions.mjs:393,428`) — Grok is right that it does not
   encode `#`,** so a path containing `#` still truncates at the fragment. Encode each path
   *segment* with `encodeURIComponent` and rejoin with `/`.
5. **The content fetch is weaker than the sibling's** (lines 335–336): dispatch uses the
   JSON Contents API and base64-decodes, while the merge guard uses
   `Accept: application/vnd.github.raw`. For a large file the JSON form can return a null
   or truncated `content` **without an error**, yielding an empty object set and a false
   clear for that PR's DDL. Align on the raw fetch, and **fail loudly** if the body is
   empty for a migration whose status is not `removed`.

**Verification gate.** A unit test per defect: a draft PR collides; a PR whose *second*
migration carries the colliding version is detected; a removed file does not throw; a
filename containing a space **and one containing `#`** both resolve; an empty body for a
present file raises rather than returning `[]`.

---

### Step 3a — The historical noise gate (do this BEFORE step 3b)

**Why this is a gate, not a risk note.** Broadening the parser also strengthens
`check-pr-object-collisions.mjs`, a **required** check on `main`. If concurrent PRs
routinely touch the same table, that check becomes noisy — which is precisely the
alarm-fatigue disease this workstream exists to cure. The first draft of this plan left
this as a mitigation in §13; Codex is right that it must gate the change, and right that
"test the last ten PRs" is the wrong test.

**What to do.**
1. Reconstruct sets of PRs that were **open at the same time** (from `gh pr list --state
   merged` with created/merged timestamps) — not the last ten in isolation. Overlap is the
   only thing that matters.
2. Run the proposed extraction and the proposed dispatch/merge policies over those sets.
3. Classify every new failure: **useful** / **harmless but worth serializing** / **noise**.
4. **Fix the acceptance rule before looking at the results.** Suggested: if more than 20%
   of historical concurrent sets produce a new merge-guard failure classified as noise, the
   merge guard keeps its current narrow policy and only the dispatch policy broadens.

**Verification gate.** A short written artefact under `docs/verification/` recording the
sets tested, the classification, the pre-registered rule, and the resulting decision. This
artefact is the evidence for D12 and must exist before step 3b merges.

---

### Step 3b — Return structured operations, and split the two policies

**File:** `scripts/check-pr-object-collisions.mjs`, `PATTERNS` at lines 128–220.

**The design changed after review. Read this before writing code.** The first draft said
"broaden `PATTERNS`" — one flat list of canonical strings, shared by both checks. Codex
showed that conflates two separate things: **one parser** (good, D6) and **one collision
policy** (wrong). The merge guard is built around whole-object replacement and its failure
messages say so; making it report every table touched would make its own explanations
false.

**So the parser returns structured operations, not flat strings:**

```js
{ action: 'create_or_replace', kind: 'function', target: 'plm.foo' }
{ action: 'alter',             kind: 'table',    target: 'core.licensor' }
{ action: 'grant',             kind: 'table',    target: 'core.licensor' }
```

Each consumer then picks its own policy over the same operations:

- **Dispatch policy:** any write to the same target collides. Broad, over-blocks, fails safe.
- **Merge-guard policy:** only the classes it intentionally supports fail the build; table-
  level conflicts are reported under their own, accurate explanation. Its current behaviour
  is preserved unless step 3a's evidence says to widen it.

Keep `extractObjects` as a thin wrapper returning the old flat strings so existing callers
and tests keep working; add `extractOperations` as the new primary.

**Operation-specific handling Codex flagged — do not skip these:**

- `GRANT` can target tables, sequences, schemas or functions — not always a table.
- `COMMENT ON COLUMN core.t.c` must collide with changes to `core.t`.
- `ALTER POLICY n ON t` needs **both** the policy and the table identity.
- `RENAME` and `SET SCHEMA` need **both** the old and new identity.
- `CREATE INDEX` should emit both the index and its table; `DROP INDEX` often cannot
  recover the owning table from the SQL alone — emit the index only and say so.

Note the existing extractor only has special multi-target output for triggers and policies
(`check-pr-object-collisions.mjs:242`); this generalises that.

**Add a coverage-inventory test.** Codex's point: nothing today would notice a *new* large
blind class. Add a test that scans `supabase/migrations/` for leading DDL verbs, subtracts
the ones the parser models, and fails if any unmodelled verb exceeds a threshold count.
That is what prevents a repeat of this whole defect.

Canonical keys still come from `canonical()` (line 221). Target mapping:

| DDL | Emit |
|---|---|
| `create table [if not exists] X` / `drop table X` | `table X` |
| `alter table [only] X …` (any action) | `table X` |
| `create [unique] index [name] on X` / `drop index` | `table X` *and* `index <name>` when named |
| `grant … on [table] X to …` / `revoke …` | `table X` |
| `comment on <kind> X` | `<kind> X` |
| `create type X` / `alter type X` / `drop type X` | `type X` |
| `alter function X` / `alter view X` / `alter policy N on X` | existing kinds |

Per D9 start **table-level**: every `alter table` on a table yields the same key regardless
of which column it touches. This over-blocks two agents touching different columns of one
table — acceptable, and far safer than the current silence.

**Watch for:** `alter table` has many forms (`only`, `if exists`, quoted identifiers,
schema-qualified and bare). Reuse `normalizeSql` (line 115) — it already strips comments
CRLF-safely, and its deliberately non-`$`-anchored line-comment regex must not be changed
(header lines 52–56 explain why).

**Behaviour when done.** The step-2 tests pass. The merge-time guard also becomes stricter
— intended, but see the risk in §13.

**Dependencies.** Step 2 must exist and be failing first.

**Verification gate.**
```bash
node --test scripts/check-pr-object-collisions.test.mjs   # existing suite must stay green
node --test scripts/check-dispatch-collision.test.mjs     # step-2 tests now pass
# and the ratio check from §3 should now be mostly modelled:
node -e 'import("./scripts/check-pr-object-collisions.mjs").then(m=>console.log(m.extractObjects("alter table core.licensor add column foo text;")))'
# expect: [ 'table core.licensor' ]
```

---

### Step 4 — Make `--sql` the primary input; treat bare `--objects` as lower-trust

**File:** `scripts/check-dispatch-collision.mjs`, `main()` around lines 425–440, `USAGE`
at 383.

**What to change.** A hand-typed `--objects` list records what the agent *intended*; the
SQL records what it will actually write. Where a draft migration exists, derive from it.
When `--objects` is used **without** `--sql`, print a one-line note that the list is
unverified and only as good as the declaration.

Do **not** remove `--objects` — at genuine dispatch time the SQL does not exist yet, which
is the whole point of a dispatch-time check.

**Dependencies.** Step 3 (otherwise `--sql` derivation inherits the blind spot).

**Verification gate.** `node scripts/check-dispatch-collision.mjs --sql <a real migration
from supabase/migrations/>` lists that migration's tables and functions.

---

### Step 5 — `--claim`: acquire object refs atomically (THE CORE CHANGE)

**File:** `scripts/check-dispatch-collision.mjs`. Replaces `claimCommand` (237–268) and
most of `parseClaimBlock` (102–139) and `gatherClaims` (296–321).

**The primitive.** One object = one ref. Acquire with:

```bash
gh api -X POST repos/u2giants/shared-db/git/refs \
  -f ref=refs/db-claims/objects/<kind>/<key> -f sha=<claiming branch's head>
```

Success = you hold it. `422 Reference already exists` = someone else does. **Verified live
2026-08-06**, including that a second `POST` is refused and that all holds are readable in
one call:

```bash
gh api repos/u2giants/shared-db/git/matching-refs/db-claims/objects --jq '.[]|"\(.ref) -> \(.object.sha[0:7])"'
```

**Ref naming — must be deterministic AND injective.** The canonical key
`function plm.promote_coldlion_source_owned` becomes
`refs/db-claims/objects/function/plm.promote_coldlion_source_owned`. Rules:

- Space between kind and target becomes `/`. Lowercase (matching `canonical()`).
- Any character outside `[a-z0-9._/-]` is percent-encoded. Git forbids space, `~^:?*[\`,
  `..`, a trailing `.lock`, and control characters — reject or encode all of them.
- **If sanitising changed the key at all, append `--<first 8 hex of sha256(canonical key)>`.**
  Without this, two distinct quoted identifiers could sanitise to one ref name: harmless
  when it over-blocks, but it would also let one claim silently *satisfy* another. The hash
  guarantees one key ↔ one ref.
- Unit-test the mapping both ways: same key ⇒ same ref, different keys ⇒ different refs.

**Acquire-all-or-nothing.** A task usually needs several objects. Acquire in sorted order;
on the first 422, **release everything already acquired in this attempt**, then report the
conflict and exit 1.

> **This rollback is required, and it does NOT contradict R9.** R9 rejected rollback for
> *version* refs because an orphaned version wastes one integer from an unbounded space.
> An orphaned **object** ref is the opposite: it locks a real object against everyone.
> Different lifetimes, different rules — see D13 vs D16.

**The tool now performs the claim itself.** No printed shell recipe.

> **Why this matters more than it looks (Grok, 2026-08-06):** the old `claimCommand`
> emitted a **bash heredoc**, and this is a **PowerShell-first** machine. Pasting it into
> `pwsh` mangles the body. "Zero claims have ever been filed" was not purely a discipline
> failure — the prescribed path did not work on the host it was prescribed for. Any
> fallback that still prints a command must use `gh issue create --body-file <path>` or
> `gh api` with a JSON body, **never** a heredoc.

**Read-only tasks claim nothing.** This resolves the contradiction Grok found between the
old design (empty object lists deliberately valid, `check-dispatch-collision.test.mjs:46–49`)
and the earlier step 5 (reject zero-object claims): with refs there is no empty claim to
reject — a read-only task simply acquires no refs. Delete the `# none — read-only task`
emission at line 242 along with `claimCommand`.

**Self-collision disappears by construction.** Because acquisition *is* the check, an agent
can never be blocked by its own claim on a re-run — the earlier design's undefined
everyday flow (Grok finding D) no longer exists.

**Open PRs are still consulted.** Refs only cover work that claimed; `gatherOpenPrObjects`
still covers work that did not (nine PRs merged outside orchestrator control). If an open PR
touches a requested object, release what you acquired and report the conflict.

**Optional human context.** A `db-claim` issue may still be filed for readability, but it
is **not the lock** and nothing may depend on parsing it. D1 is demoted accordingly (D15).

**Dependencies.** Step 3b (needs accurate objects to claim). Do not start before it.

**Verification gate.**
```bash
# acquire, then prove the second attempt is refused, then release
node scripts/check-dispatch-collision.mjs --task t --objects "table core.zz_test" --claim   # exit 0
node scripts/check-dispatch-collision.mjs --task u --objects "table core.zz_test" --claim   # exit 1, names the holder
node scripts/check-dispatch-collision.mjs --release --objects "table core.zz_test"
gh api repos/u2giants/shared-db/git/matching-refs/db-claims/objects --jq '.[].ref'          # empty
```
Plus unit tests for the key→ref mapping and for partial-acquisition rollback.

---

### Step 5b — Release object refs, and define staleness

**Why this is not optional.** An object ref that is never released locks that object
**forever**. This is the exact inverse of version refs (D13, kept permanently), and
confusing the two would freeze the schema.

**Automatic release on merge.** A workflow on `push: branches: [main]` that, for every
migration in the merged commit, deletes the matching object refs. That makes release
mechanical rather than another written rule — the thing this whole workstream keeps
learning.

**Staleness for abandoned work.** The ref's target commit is the binding (this is why
step 7 was cut): from it you can tell whether the claiming work landed or died.

- Target commit is an ancestor of `origin/main` ⇒ the work merged; release.
- Target commit is on no open PR and no remote branch ⇒ abandoned; release.
- Otherwise ⇒ live; leave it and name it in the orchestrator's register.

This replaces D10's issue-staleness question for objects. **D10 remains open only if
optional claim issues are used at all.**

**Verification gate.** Merge a PR carrying a claimed migration and confirm the ref is gone
without anyone running a command; plus a unit test per staleness branch.

---

### Step 6 — Add `--reserve-version`, an atomic reservation

**Files:** `scripts/check-dispatch-collision.mjs:190` (`nextFreeVersion`, and its incorrect
header comment), `:444–447` (the allocate path).

**What to change.** Reserving a version must be a single atomic create-if-absent. Use:

```bash
gh api -X POST repos/u2giants/shared-db/git/refs \
  -f ref=refs/db-claims/<version> -f sha=<any commit sha>
```

`422 Reference already exists` ⇒ that version is taken; increment and retry (bounded, e.g.
60 attempts). Success ⇒ the version is now **yours**, reserved server-side, with no
read-then-write window. Target the ref at the current `main` commit; **never create a
special commit for a reservation.**

**Name it `--reserve-version`, not `--allocate-version`.** Codex's point: the old flag
meant "print a suggestion" and was read-only. Reusing the name for something that mutates
remote state is a surprising behaviour change, and this repo's rule is that public
repository content is not created without the owner's say-so — so the mutation must be
visible in the name.

**Refs are created once and KEPT PERMANENTLY. There is no release step, and that is
deliberate.** Reservations were originally going to be deleted on merge; Codex argued the
opposite and is right: the preview database is persistent and its ledger holds **every**
version that ever ran `db push`, including from abandoned branches. Releasing a number for
reuse could therefore collide with a version preview has already recorded. A kept ref costs
one 14-digit integer out of an effectively unbounded space, and `refs/db-claims/*` does not
appear in the branch list, so it cannot add to the 131-branch clutter.

This removes, deliberately, the need for ref rollback, ref ownership metadata, ownership
checks on release, stale-ref reconciliation, and routine ref deletion. **Do not add them.**

The exact flow (agreed with Codex after debate):

1. Create `refs/db-claims/<version>` via the API.
2. On 422, increment and retry.
3. Create the claim issue carrying that version.
4. **If issue creation fails, exit non-zero and say loudly "reserved <version> but the
   claim was NOT filed — do not dispatch."** This is the one genuinely dangerous state:
   the version is reserved while the object work is invisible to everyone else.
5. Do not dispatch until the claim issue exists.

**Note the asymmetry, because it drives the whole design:** an orphaned *ref* wastes an
integer; an orphaned *claim issue* blocks an object and genuinely needs a release rule —
that is D10, and it remains open.

**Correct the false comment** on `nextFreeVersion` — it currently claims to kill the
duplicate-timestamp class, which is only true once reservation is atomic.

**Do NOT use `git push`** for this. See R3 and the §6 table: a descendant commit
fast-forwards over an existing ref and steals the lock silently.

**Dependencies.** None, but land after Phase A so the urgent fix is not held up.

**Verification gate.** Reserve a test version twice; the second attempt must fail with 422.
**Delete every test ref afterwards** and confirm with
`gh api repos/u2giants/shared-db/git/matching-refs/db-claims --jq '.[].ref'` returning empty.

---

### Step 7 — CUT (superseded by step 5)

**Do not implement this. It is kept as a heading so the numbering in the STATUS table and
in older commit messages still resolves.**

The original step added `branch:` and `pr:` fields to the `db-claim` issue body so a claim
could be matched to its work. **Atomic object refs give that for free:** a ref points at a
commit, and that commit *is* the binding — it tells you which branch holds the object,
whether the work merged (ancestor of `origin/main`), or whether it was abandoned (on no
open PR and no remote branch). That is exactly what step 5b's staleness rule reads.

Kimi's original reason for wanting binding — that an unbound claim would let a stale claim
satisfy coverage for an unrelated future PR in the *enforcement* check — still holds, and
is still satisfied: the enforcement check (deferred, R4) will resolve a claim through its
ref target rather than through a parsed issue body.

### Step 8 — Update the two documents that describe the gate

**Files:** `AGENTS.md` §4 rule 1 (this repo) **and**
`skills/claude/shared-db-orchestrator/SKILL.md` in `u2giants/ai-devops` (a **different
repo** — clone at `C:\repos\ai-devops`, main-only, push directly).

**What to change.** Both currently describe exit 0 as "safe". After step 1 there is no such
verdict — say "no overlap found in the checked classes" and state that the unchecked
classes remain the orchestrator's judgment. Add the reservation command from step 6 and the
release step. Note the coverage limit **at the gate**, not in a footnote.

⚠️ After editing the skill in `ai-devops`, run `bin/ai-install-skills` to install it on this
machine, or the local copy stays stale (it was 84 lines out of date on 2026-08-06).

**Dependencies.** Steps 1 and 6.

**Verification gate.** `diff` the hub copy against
`C:\Users\ahazan2\.claude\skills\shared-db-orchestrator\SKILL.md` — identical. No occurrence
of "SAFE TO DISPATCH" in either document.

---

## 10. Tests required

**New**, in `scripts/check-dispatch-collision.test.mjs`:

1. `alter table … add column` in an open PR collides with `--objects "table core.x"` *(step 2 — must be watched failing first)*
2. `create table` — same shape
3. `create index … on` — same shape
4. `grant … on` — same shape
5. `parseClaimBlock` ignores `#` comment lines without truncating the object list
6. `parseClaimBlock` reads a version with a trailing inline comment
7. `parseClaimBlock` treats `null`/`nil`/`n/a` as no version
8. `parseClaimBlock` accepts the compact `objects: [a, b]` form
9. A zero-object or wildcard claim is **rejected as malformed**, not accepted
10. `claimCommand` round-trips `branch` and `pr`
11. `formatReport` output contains **no** verdict word, and names the unchecked classes

**New**, in `scripts/check-pr-object-collisions.test.mjs`: one case per added pattern
(table / alter table / index / grant / comment / type), plus a negative asserting no
regression on the six existing kinds.

**Must stay green:**
```bash
node --test scripts/check-pr-object-collisions.test.mjs
node --test scripts/check-dispatch-collision.test.mjs
# NOTE 2026-08-07: check-backlog-queue-sync.mjs and its tests were DELETED. Running them
# now fails with "no such file", which is NOT your breakage. Removed from this list; the
# replacement guard below is the one that must stay green.
node --test scripts/check-intake-pointer.test.mjs
bash scripts/check-sql.sh
```

---

## 11. Constraints, standing rules, and gotchas in force

1. **Branch + PR, and you merge it yourself.** Never commit to `main` directly. This is
   shared-db's rule and differs from the dflow repos.
2. **Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.** Confirm
   with `git var GIT_COMMITTER_IDENT` before the first commit; fixing it afterwards means
   rewriting history. 231 wrong-identity commits have already reached shared branches.
3. **No database contact in this plan.** Nothing here needs it.
4. **Branch protection is on and `strict: true`** — your branch must be up to date before
   merging, so expect to update it if `main` moves. Six required checks (the set CHANGED 2026-08-07: `Backlog / queue sync` retired, `Intake pointer guard` added — re-derive with `gh api`).
5. **Never weaken `check-pr-object-collisions.mjs`'s `Skip`-to-green posture.** A required
   gate that cannot gather its inputs must warn and pass, or it blocks every PR. The
   dispatch tool's opposite posture (unknown ⇒ exit 2) is also deliberate. **Do not
   "harmonise" them.**
6. **No band-aids, no silent failures.** Every fallback must be loud.
7. **Do not delete `.ai/deepseek-sessions/` or `.ai/reviews/`** — untracked, not yours.
8. **Do not create GitHub issues, labels, or public content without asking** — `shared-db`
   is a **public** repo.
9. **Clean up every test ref/branch you create.** Verify with `matching-refs`.
10. **`COORDINATOR_INTAKE.md` blocks are moved only by the orchestrator**, and only forward.
11. **Gotcha — Windows line endings.** These files are CRLF in the working tree; `.mjs`
    edits will show a `LF will be replaced by CRLF` warning. Harmless; do not "fix" it, and
    do not reformat whole files (backlog B1 covers `.gitattributes` separately).
12. **Gotcha — GitHub Actions flakes, and the ORPHANED-RUN trap.** On 2026-08-06 Actions
    had a `major_outage`. Checks failed with `Failed to resolve action download info.
    Error: Service Unavailable`. That is infra, not your code — `gh run rerun <id> --failed`
    clears the simple case.

    ⚠️ **But there is a worse failure that `rerun` does NOT fix, and it cost a session
    real time.** Two required checks were left **stranded**: `status=queued`,
    `conclusion=null`, `attempt=1`, not updating for hours. GitHub refused to cancel them
    (`Cannot cancel a workflow run that is completed`) **while still reporting them as
    queued**. They can never report a conclusion, so the PR stays `BLOCKED` forever on a
    required context. Neither `gh run rerun` nor closing/reopening the PR helps — the
    stranded runs hold that commit SHA.

    **The only reliable fix is to move the SHA:**
    ```bash
    git commit --allow-empty -m "ci: re-trigger checks stranded by an Actions outage"
    git push
    ```
    Diagnose it with `gh api repos/u2giants/shared-db/actions/runs/<id> --jq '.status, .conclusion, .updated_at'` — a `queued` run whose `updated_at` is hours old is stranded, not slow.

13. **⚠️ Gotcha — YOU MAY BE SHARING THIS CHECKOUT WITH ANOTHER LIVE AI SESSION.**
    `C:\repos\shared-db` is a shared working copy and 3–7 sessions run at once. On
    2026-08-06 this went wrong in a way that is easy to miss and expensive to unpick:

    - Another session committed its work while this one was creating a branch, so
      **the new branch silently inherited that session's commit** (`48680a3`).
    - That work later reached `main` by a different route — including a commit that
      **retracted the claim the inherited commit made.**
    - Merging `main` then conflicted in **three files this session never touched**, and
      the branch was carrying a retracted claim toward `main`.

    **Before you start:** run `git status` and `git log --oneline -5`, and know exactly
    which commits are yours. **Before you open a PR:** run
    `git diff origin/main --stat` and confirm it lists **only** files you meant to change.
    If it lists someone else's, resolve by taking `origin/main`'s version for their files —
    do **not** delete or revert their work, and never `git add -A`/`git add .`; stage
    explicit paths only. Uncommitted changes you did not make are **another session's
    live work** — leave them exactly as they are.

---

## 12. Access and environment

- **Authenticated CLIs on this machine:** `gh`, `gcloud`, `az`, `supabase`, `vercel`, `op`.
  Verify with a real call before claiming any is unavailable.
- **Repos:** `C:\repos\shared-db` (this work) and `C:\repos\ai-devops` (step 8 only,
  main-only, push directly — no PR).
- **Node:** v24 locally, v22 in CI. Plain ESM, no build step, no install needed.
- **Run the tool:** `node scripts/check-dispatch-collision.mjs --help`
- **Secrets:** none required. If one ever is, it is in 1Password vault `vibe_coding` —
  reference by item title, **never paste a value**.
- **CI:** `.github/workflows/pr-object-collision.yml` runs both suites under the job name
  `Cross-PR object collision`. **Keep that job name** — it is a required status context,
  and renaming it makes every future PR hang forever waiting for a check that never reports.

---

## 13. Definition of done, risks, and open questions

### Done means all of:

- [ ] Steps 1–8 complete, or explicitly deferred with the reason recorded in the STATUS table
- [ ] No occurrence of `SAFE TO DISPATCH` anywhere in the repo
- [ ] The step-2 tests were **observed failing**, and that output is in the PR body
- [ ] All five suites in §10 green locally
- [ ] Every test ref deleted; `matching-refs/db-claims` returns empty
- [ ] Committed, pushed, PR opened, **all six required checks green**, PR merged by you
- [ ] `git status` clean apart from the two untracked directories
- [ ] `AGENTS.md` and the orchestrator skill agree with the code; skill installed locally
- [ ] STATUS table at the top of this file updated with dates
- [ ] A `HANDOFF.d/<UTC>-<machine>-<agent>-<slug>.md` written per `handoff-writer`, with the
      mandatory "what I tried that did NOT work" section, cross-linked to this plan

### Risks

| Risk | Mitigation |
|---|---|
| **Broadening `PATTERNS` makes the required merge guard stricter and may fail PRs that used to pass** — the highest-impact risk here | Before merging step 3, run the guard against the last ~10 merged PRs' migrations and check for retro-failures. If common, land the broadened patterns in the **dispatch** tool first and the merge guard second, in separate PRs. |
| Table-level granularity over-blocks agents touching different columns (D9) | Accepted for now; revisit if it bites. Over-blocking fails safe. |
| Ref-reservation leakage — reserved versions never released, exhausting nothing but confusing everyone | Step 6 must ship its release command, and D10's staleness rule must be written before automating release. |
| Someone "simplifies" step 6 back to `git push` | R3 documents the exact failure and the test that proves it. |
| This plan goes stale as it is executed | STATUS table + the plan-file gate in `session-docs-update`. |

### Open questions

1. **D8** — `refs/db-claims/*` or `refs/heads/db-claims/*`? Both verified working.
   Recommendation: the former.
2. **D9** — table-level vs column-level granularity. Start table-level.
3. **D10** — the staleness definition for claim release. Must be settled before release is
   automated; until then, release is manual at session start (skill step 7).
4. **Sequencing of R4** (enforcement check) — after the scaffold tool and bot, per Kimi.
   Needs its own plan and the owner's decision on the Issues migration.

---

## 14. DRIFT AFTER PHASE A (recorded 2026-08-07 — read before step 3a)

Required completion step of Phase A: every remaining step through step 8 was
re-read against what actually shipped. **Drift was found in six of them.** Each
item below says what changed, which step it hits, and what that step must now do
differently. Nothing here is optional tidying — a later phase built on the old
assumption breaks a test or reintroduces a false clear.

### D-A1 — `result.safe` no longer exists. The field is `overlapFound` (inverted).
**Hits:** steps 4, 5, 5b, 6, and any `--json` consumer.
`findDispatchConflicts` now returns `{objectConflicts, versionConflicts, overlapFound}`.
A test asserts the result has **no** key named `safe`, so re-adding one fails the
build. `main()` returns `overlapFound ? 1 : 0`. Step 5's redefinition of exit 0
("the claim succeeded — you now hold these objects") sits on top of this cleanly.

### D-A2 — a holder's version field is `versions` (an ARRAY), not `version`.
**Hits:** steps 5, 5b, 6, and every test helper.
`gatherClaims` emits `versions: [v]` or `[]`; `gatherOpenPrObjects` emits every
14-digit stamp in the pull request. `findDispatchConflicts` compares the proposed
scalar version against every entry. **`proposed.version` is still scalar** — a
proposal has one version, a holder can have several. Do not "harmonise" those two.

### D-A3 — `gatherOpenPrObjects(repo, io)` now takes an injectable I/O object.
**Hits:** steps 5 and 5b, which both add gathering.
Signature: `gatherOpenPrObjects(repo, io = defaultIo)` where `io` is
`{listPulls, listPullFiles, readFileAtRef}` (exported as `defaultIo`). This is
the only reason the five step-2b defects are unit-testable at all — the old code
called `gh` inline and could not be tested without a network. **Any new gathering
in step 5 must go through the same object, or its defects become untestable too.**

### D-A4 — the coverage report is DERIVED, and a test locks it to the parser.
**Hits:** step 3b directly.
`describeCoverage()` is a new export of `check-pr-object-collisions.mjs`. It
returns `{checked, notChecked, alterModelled}`, computing `checked` from
`PATTERNS` and `notChecked` as `KNOWN_DDL_CLASSES` minus `checked`.
`formatReport` prints both lists, and a test asserts the printed report contains
every entry of both. **Step 3b must therefore:**
- keep `PATTERNS` (or whatever replaces it) readable by `describeCoverage()`, and
- add each newly-modelled kind using the SAME vocabulary as `KNOWN_DDL_CLASSES`
  (`table`, `column`, `index`, `grant`, `comment`, `type`, `sequence`, `schema`).
Use a different word (`tables`, `indexes`) and the class silently stays on the
NOT CHECKED list forever — a false statement printed by a tool whose whole
purpose is not making false statements.

### D-A5 — step 2's four tests are LANDED AS `todo`, and step 3b must un-mark them.
**Hits:** step 3b. This is the one that is easiest to miss.
The plan said "run them red locally, land them with the step-3 fix." That is not
possible when step 3 is in a **later phase** than step 2 — a pull request whose
tip is red can never merge past the required `Cross-PR object collision` job. So
they are landed with `{ todo: … }`: `node --test` runs them, reports them every
run (`ℹ todo 4`), and does not fail the build.

**Observed failing locally on 2026-08-07, exactly as the plan required:**

```
⚠ an alter table in an open PR collides with a proposal naming that table  # RED until plan step 3b
⚠ a create table in an open PR collides with a proposal naming that table  # RED until plan step 3b
⚠ a create index in an open PR collides with a proposal naming its table   # RED until plan step 3b
⚠ a grant in an open PR collides with a proposal naming that table         # RED until plan step 3b
  AssertionError: Expected values to be strictly equal: false !== true
ℹ tests 37   ℹ pass 33   ℹ fail 0   ℹ todo 4
```

A fifth test, *"the modelled class DOES route through the parser end to end"*, is
a **positive control**: it passes today, proving the wiring is sound and that the
four failures are the parser's blind spot and nothing else.

⚠️ **STEP 3b MUST DELETE THE `TODO_UNTIL_STEP_3B` OPTION FROM ALL FOUR TESTS.**
If they are still `todo` when step 3b is called done, the fix is unproven and the
plan's central defect is still shipping.

### D-A6 — `extractObjects` must keep emitting FLAT STRINGS including the new kinds.
**Hits:** step 3b.
Step 3b says to add `extractOperations` and keep `extractObjects` as "a thin
wrapper returning the old flat strings **so existing callers and tests keep
working**." Read literally, a wrapper that returns only the *old six kinds* would
leave all four step-2 tests red forever, because they call `extractObjects`
directly and expect `alter table core.licensor` to yield `table core.licensor`.
**The wrapper must flatten every operation, new kinds included.**

### D-A7 — AGENTS.md and the orchestrator skill were PARTLY updated already.
**Hits:** step 8, which is now smaller.
Both documented the gate with `--allocate-version` and glossed exit 0 as "safe".
Withdrawing the flag (step 1b) made the documented command exit 2 on every run,
so leaving that for Phase C would have broken the gate for every orchestrator in
the meantime. Already corrected in this phase:
- `AGENTS.md` §4 rule 1 — flag removed from the snippet, exit-0 gloss rewritten,
  a withdrawal notice added.
- `u2giants/ai-devops` → `skills/claude/shared-db-orchestrator/SKILL.md` — same
  two corrections, plus a warning that the printed claim recipe is bash-only.
**Still owed by step 8:** the AGENTS.md "KNOWN LIMIT" paragraph (rewrite once the
parser can see the classes it names), the step-6 reservation and release commands,
and the `bin/ai-install-skills` re-install + hub/local `diff`.

### D-A8 — `claimCommand`'s bash heredoc is still live, now loudly labelled.
**Hits:** step 5, which deletes it.
D18 forbids a printed heredoc, but replacing it in Phase A would rewrite
`bodyFromClaimCommand` and its tests — all of which step 5 deletes anyway. It now
prints a warning that it is bash-only and does not work in PowerShell. **This is
labelling, not a fix; step 5 is still owed.**

### D-A9 — `versionsOnDisk` and `nextFreeVersion` are now unreferenced by `main()`.
**Hits:** step 6.
Both are still exported and tested. `--allocate-version` returns 2 **before any
network call**, so nothing calls them at runtime today. Step 6 re-wires both into
`--reserve-version`. **Recommendation: keep `--allocate-version` permanently as a
tombstone that exits 2** rather than deleting the flag — a orchestrator pasting an
older command then gets the explanation instead of `unknown argument`.

### D-A10 — EVERY line number inside the step bodies (§9) is now WRONG.
**Hits:** every remaining step.
Phase A added roughly 130 lines to `check-dispatch-collision.mjs` and 46 to
`check-pr-object-collisions.mjs`, so references like "`main()` around lines
425–440" or "`PATTERNS` at 128–220" are off by 20–60 lines. **The §5 table has
been refreshed against `main` @ `60b130c` and is the one to trust** — or grep for
the symbol name, which is stable. The step bodies were deliberately left
unedited: rewriting numbers inside prose that also carries reasoning is how a
plan gets quietly corrupted.

### D-A11 — ⚠️ A SIBLING PLAN NOW PROPOSES DELETING A FILE THIS PLAN DEPENDS ON.
**Hits:** §4 item 4 and §10. **Added 2026-08-07, after Phase A, by the same session.**
`plan_coordinator-queue-to-github-issues.md` (merged, not yet started) replaces
`COORDINATOR_INTAKE.md` with GitHub Issues and, at its step 7b, **deletes
`scripts/check-backlog-queue-sync.mjs`, its tests and its workflow** — after an
explicit owner instruction removes the required context.

Two things in THIS plan go stale the moment that lands:

- **§4 item 4** (`:177`) defers fixing that script and says the fix is "tracked in
  the `REQUEST QUEUE`". That queue is being deleted too. If the sibling plan runs,
  the deferral is not deferred — it is **moot**, and item 4 should say so.
- **§10 "must stay green"** (`:950–951`) runs `node scripts/check-backlog-queue-sync.mjs`
  and its test file. **Both disappear.** A Phase B or C session running that list
  verbatim would hit a missing file and reasonably read it as its own breakage.

**Neither plan may quietly win.** Whichever reaches the conflict first updates the
other in the same PR. If Phase B or C runs first, nothing here needs changing yet
— just do not "fix" a missing file. If the sibling plan's step 7b runs first, it
owns updating §4 item 4 and §10 above.

### No drift found in:
**Step 3a** (the historical noise gate) — untouched by Phase A; its inputs and its
`docs/verification/` artefact requirement stand exactly as written.

### One local-environment note, unrelated to the plan
`bash scripts/check-sql.sh` cannot run under Git Bash on Windows: it fails at
`set -o pipefail` because the file has CRLF line endings (backlog B1). It runs
correctly in CI on Linux. **Do not "fix" it by editing the script** — the line
endings are the issue, and B1 owns them.

---

## Self-audit (mandatory gate — re-run after each revision)

### Re-audit 3 — after the atomic-object-ref rebuild (2026-08-06, post-Grok 4.5)

The design changed, so the audit was re-run rather than assumed to still hold.

**New gaps found by this re-audit and fixed before committing:**
- D1 and D5 were still marked **LOCKED** while D15 and D17 contradicted them. Two locked
  decisions in direct conflict is precisely the "provably impossible rule pair" that this
  repo has already shown teaches models that rules are decorative. Both are now marked
  **superseded**, with their original reasoning preserved rather than deleted.
- Step 7's body still described the abandoned issue-body binding. A cut step whose body
  still reads as instructions is worse than a deleted one — an implementer skimming
  headings would build it. Replaced with an explicit CUT notice that says what replaced it
  and why, and confirms Kimi's original concern is still satisfied.
- The partial-acquisition rollback in step 5 superficially contradicts R9, which rejected
  rollback for version refs. Called out inline, because the next reader will otherwise
  "simplify" it away.

**Still true after the rebuild:** the goal in §1 is unchanged and still governs; every step
still names files and a verification gate; the out-of-scope list in §4 still holds (the
rebuild *removed* scope rather than adding it).

**One thing a fresh session must know that the plan cannot fix:** every live experiment in
this document was run against the real repository and cleaned up. Re-running them is cheap
and is the right move if anything here looks doubtful — the commands are all inline.

### Re-audit 2 — after the Codex review

Four defects were documented in §6 and scheduled by no step; that is the exact failure the
13-section format exists to catch, and it was caught only by an external reviewer. Fixed by
adding steps 1b, 2b, 3a and splitting 3b.

### Audit 1 — original

**1. Could a brand-new AI session with no project knowledge execute this without asking
anything?** Yes. §2 defines the repo, the five dependent apps, the branch model and the
stack; §5 gives the exact `file:line` for every edit; §9 gives per-step verification
commands with expected output; §12 covers access, Node versions and how to run the tool;
§11 names the traps including two — the CRLF warning and the Actions outage — that would
otherwise cost a session real time. Every identifier a newcomer would not know (preview vs
production project ids, `dflow`, B7, `strict: true`, the six required checks) is expanded
where first used. **Gap found and fixed during audit:** the first draft did not say that
renaming the CI job breaks a required status context — added to §12, because it is silent
and severe.

**2. Does it carry every piece of background and reasoning I hold, including what was ruled
out?** Yes. §7 records six rejected approaches with reasons, including two where **I was
wrong** (R3, my own git-push lock) and one where **GLM was wrong** (the ref-namespace
claim) — both with the live test results in §6 so nobody re-derives them. §8 marks seven
decisions LOCKED and three OPEN, so the implementer knows what is theirs to judge. The
442-row production incident is given as the reason D2 is locked, rather than asserted as a
rule. **Gap found and fixed:** the first draft did not record that the existing 23 tests
would all still pass if `extractObjects` returned `[]` — that is the single most important
finding for whoever writes step 2, and it is now stated explicitly in §6.

**3. Is the ultimate goal clear enough to support a correct judgment call when a step is
wrong?** Yes. §1 states the goal in business English before any technical wording, and adds
the specific steering rule for *this* work: never make the tool more likely to print a
confident answer it cannot justify — a tool that says "I could not tell" is correct. That
is the criterion an implementer needs when, for example, they discover a seventh DDL form
in step 3 that this plan does not list.

**Checklist:** all 13 sections present; goal stated in business English up top with the
goal-wins instruction; rejected approaches and failed attempts recorded with reasons; every
step names concrete files and has a verification gate; locked vs open decisions labelled;
explicit out-of-scope list; tests specified by behaviour, not "add tests"; no secret values;
definition of done includes commit, push, CI green and the handoff. **All items pass.**
