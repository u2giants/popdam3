# plan_reviewer_lease_capacity_truth.md

**Making reviewer capacity tell the truth: release dead leases, age them, report them,
and stop misnaming the refusal — plus repair the reviewer-issue evidence capture.**

Governed by **issue [#2058](https://github.com/u2giants/shared-db/issues/2058)** —
the purpose-built repository-maintenance handover opened at 2026-09-01 16:31 UTC by
the orchestrator session that hit this deadlock. Its briefing is
[`HANDOFF.d/2026-09-01T1630Z-edge-dev-codex-reviewer-capacity-deadlock.md`](HANDOFF.d/2026-09-01T1630Z-edge-dev-codex-reviewer-capacity-deadlock.md).
Issue [#1851](https://github.com/u2giants/shared-db/issues/1851) is the earlier,
broader record of the same pool and holds two defects deliberately left out of scope
here; keep it open and cross-referenced. This plan is the design #2058 asks for.

Also governed by
("reviewer pool exhausted: all six reviewers leased across three PRs, no lane can
commission"), label `db-work`, `work_type: repo-maintenance`.
Session handoff: [`HANDOFF.d/2026-09-01T1627Z-edge-dev-claude-reviewer-lease-capacity-truth.md`](HANDOFF.d/2026-09-01T1627Z-edge-dev-claude-reviewer-lease-capacity-truth.md)

---

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Plan written, registered, linked from `AGENTS.md` | ⬜ open | this file + handoff backlink |
| 1 | `--release-failed-reviewer`: release a dead lease without drawing a replacement | ⬜ open | — |
| 2 | Lease age + holder identity readable (`held_since`, terminal-state marker) | ⬜ open | — |
| 3 | `--reviewer-capacity` report: who holds what, since when, alive or dead | ⬜ open | — |
| 4 | Refusal message names the true cause and the blocking holders | ⬜ open | — |
| 5 | `ai-reviewer-issue`: never advertise evidence that was not captured | ⬜ open | — |
| 6 | Tests green, PR merged, `#2058` closed and `#1851` updated | ⬜ open | — |

**A fresh session starts at Step 1.** Steps 1–4 are one repository
(`u2giants/shared-db`), one file, one pull request. Step 5 is a *different*
repository (`u2giants/ai-devops`) and a separate pull request — it can be done
first, last, or in parallel by another session.

---

# Part 1 — Why

## 1. The ultimate goal (plain business English)

Albert's database work is reviewed by six independent AI reviewers. Each reviewer
can only be working on one thing at a time, and the system tracks that with six
"slots". **Today a slot can be occupied by a review that is already dead — one
that crashed, ran out of turns, or refused to continue — and nothing ever frees
it.** When enough dead reviews pile up, every slot looks busy, no new review can
start, and *all* database work stops, on every unrelated task at once. That is
what happened on 2026-09-01: five of six slots were held by finished or abandoned
reviews and the whole queue stalled.

**When this work is done:** a review that dies releases its slot, a slot that has
been held too long is visible as suspicious rather than silently indistinguishable
from a healthy one, anyone can see the state of all six slots with one command,
and when the system does refuse it says the true reason. Work stops waiting on
ghosts.

> **If any step in this plan conflicts with that goal, the goal wins — stop and
> flag it.** In particular: never "fix" a stall by deleting coordination refs by
> hand, by shrinking what a lease protects, or by disabling a refusal. A refusal
> that is correct must stay correct; only refusals that are *false* are in scope.
> Suppressing a symptom here silently un-reviews a database change, which is the
> exact harm the whole mechanism exists to prevent.

## 2. What this application is

- **Repository:** `u2giants/shared-db` — https://github.com/u2giants/shared-db.
  It is the single source of truth for the *structure* (schema, tables, columns,
  views, functions, triggers, RLS, indexes, migrations) of the one Supabase
  database shared by POP Creations' apps: PM/PIM (`poppim-web`), CRM
  (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*` PLM repos.
  Its whole contents are mirrored into a read-only `shared-db/` folder inside each
  consumer repo on every push to `main`.
- **Second repository (Step 5 only):** `u2giants/ai-devops` — the private-ish
  toolkit repo holding the `bin/ai-*` command-line tools every AI session on this
  machine uses. Local checkout `C:\repos\ai-devops`.
- **Stack for the code being changed:** plain Node.js ESM (`.mjs`), no build step,
  no framework, no package.json in `shared-db` — scripts are run directly with
  `node`. Tests use the Node built-in test runner (`node --test`). The
  `ai-devops` tool is POSIX shell (`bash`) with `jq`.
- **Where it runs:** on developer/AI machines, not a server. There is nothing
  deployed. The "state" this code manipulates lives as **Git refs on the GitHub
  remote** (custom namespaces such as `refs/db-review-active/<reviewer>`), read
  and written through the `gh` CLI and `git push --atomic`.
- **Branch policy:** `shared-db` uses a **branch and a pull request**, never a
  direct push to `main`. `ai-devops` is pushed via a branch too (see §11).

### The concepts you need before reading any further

The file you will edit,
[`scripts/manage-migration-author-lanes.mjs`](scripts/manage-migration-author-lanes.mjs)
(3,917 lines), coordinates multiple concurrent AI sessions working on the same
database. Two separate lease systems live in it, and **confusing them is the
single most likely way to get this wrong**:

| | **Author lanes** | **Reviewer slots** |
|---|---|---|
| What it protects | the right to *write* a migration | the right to *review* a pull request |
| Capacity | `MAX_AUTHOR_LANES` | 6 (`ACTIVE_REVIEWERS`, line 195) |
| Stored as | a block inside a GitHub *issue body* | a Git ref `refs/db-review-active/<reviewer>` |
| Has an expiry | **yes** — `expiresAt`, `capacity_state`, `expired-unconfirmed` (line 581–590) | **no — this is the defect** |
| Release command | `--release-claim --owner --confirm-finished`; `--cleanup-stale` reports | **none exists** |

Everything in Steps 1–4 is about the **right-hand column only**. Do not touch
author-lane capacity, `MAX_AUTHOR_LANES`, `parseAuthorLease`, or `--cleanup-stale`.

Other terms used throughout:

- **Lease / active lease** — the ref `refs/db-review-active/<reviewer>` pointing at
  a commit whose *message* is the record. Format parsed at
  `parseReviewLease()`, line 1445:
  `db-coordination reviewer-lease generation=<n> reviewer=<name> issue=<n> pr=<n> head=<40-hex> sequence=<n>`.
  **The message carries no timestamp and no state** — that is the gap Step 2 fills.
- **Head / exact head** — the 40-character commit SHA of the pull request's tip at
  the moment the review was commissioned. A review is only valid for the exact
  head it was assigned for.
- **Verdict** — a comment or GitHub review containing `APPROVE`, `REVISE`, or
  `REQUEST_CHANGES` that is *tied* to the exact head (either `commit_id` equals it
  or the body contains the SHA). Detected at line 1772.
- **Stale (existing meaning)** — `findBusyReviewers()` (line 1741) calls a lease
  stale when **the PR is closed, or the PR head moved, or a verdict exists for the
  exact head** (lines 1524, 1527). Anything else counts as *busy*.
- **Terminal failure** — a permanent, non-retryable reviewer death. The recognised
  set is `TERMINAL_FAILURE_CODES` at line 225:
  `insufficient_quota`, `provider_unavailable`, `local_dependency_unavailable`,
  `wrapper_terminal_failure`, `turn_limit_cancelled`.
- **The review mutex** — `MUTEX_REF`, a single global lock ref every mutating
  reviewer operation takes before touching any reviewer ref, and releases after.
- **Atomic ref transition** — `io.atomicReviewRefs(changes)` (line 819): a single
  `git push --atomic` with a `--force-with-lease` per ref, so a set of ref changes
  either all land or none do. **Every mutation in Step 1 must go through it.**

## 3. What triggered this work

On **2026-09-01 15:57 UTC** an orchestration session on machine `edge-dev` could
not commission a reviewer for two independent pull requests and logged a reviewer
issue. Its full evidence is on this machine at:

```
C:\repos\ai-devops\.ai\reviewer-issues\20260901T155739Z-edge-dev-reviewer-coordination-2741130\
```

(`details.redacted.txt` is the narrative; `issue.json` is the metadata. **This
directory is machine-local and is NOT in any repository** — copy anything you need
to cite into the pull request body, because a future reader may be on another
machine.)

What it recorded, verbatim in substance:

- The command that failed:
  `node scripts/manage-migration-author-lanes.mjs --replace-failed-reviewer --issue 1999 --pr 2002 --head-sha 0903384fb8db610c823c4c2bd9a3f9e0c45dfb53 --failed-sequence 809 --failure-code turn_limit_cancelled --confirm-no-verdict --confirm-no-artifact`
- The refusal:
  `no other reviewer is available; every active provider has already failed on this exact head` (thrown at **line 2438**).
- The actual state of the six slots at that moment:

| reviewer | issue / PR | sequence | real state |
|---|---|---|---|
| `glm-5.3` | #2054 | 813 | **genuinely running** — the only live one |
| `deepseek-chat` | #1609 | 808 | finished BLOCKED; its wrapper refused same-session evidence attachment |
| `grok-4.6` | #1999 | 809 | **terminal `turn_limit_cancelled`, no verdict** |
| `codex-gpt-5.6-sol` | #2035 | 797 | older, unrelated |
| `kimi-k3` | #1824 | 747 | older, unrelated |
| `muse-spark-1.2-contributor` | #1987 | 801 | older, unrelated |

- What was tried and did **not** work: posting a machine-recognisable `REVISE`
  verdict for the live GLM review; retrying `--replace-failed-reviewer` for
  sequences 808 and 809; retrying `--assign-reviewer`. No refs were hand-deleted
  or bypassed (correctly).

**Reproducing it** is not required and not advised (it needs six live leases). The
root cause is proven by reading the code — see §6 — and Step 1's tests reproduce it
deterministically against the in-memory fake IO the existing test file already uses.

## 4. Scope

### In scope

1. A governed command that releases the slot of a **terminally failed** reviewer
   *without* requiring a replacement to be available.
2. Making a lease say **when it was taken** and **whether its holder reported a
   terminal end**, so age and death are readable facts rather than inferences.
3. A **read-only capacity report** covering all six slots.
4. Making the refusal at line 2438 (and its sibling at line 2042) state the
   **true** cause and name the blocking holders.
5. Repairing `ai-devops`'s `bin/ai-reviewer-issue` so an issue report never
   advertises evidence files it did not actually capture.

### NOT in this plan (explicitly out of scope)

- **Any database change.** This plan authorises **no** migration, no schema
  change, no SQL, and no Supabase access whatsoever. It must not be routed to the
  structure/schema orchestrator (precedent: `plan_reviewer_assignment_api_budget.md`
  for issue #1767, and `plan_multi_agent_database_coordination_hardening.md` for
  issue #1366, both explicitly held outside it).
- **A per-pull-request ceiling on how much of the roster one PR may hold.** This is
  defect 1 of issue #1851 and is real, but it is a *policy* design question with an
  open answer ("two? half minus one?"). Leave it to a follow-up. Do not invent a
  number here.
- **A wait queue / fair ordering for lanes.** Defect 2 of #1851 (a waiting lane can
  be passed over forever). Genuinely needed; genuinely a separate build.
- **Adding, removing, or retiring reviewers**, changing `REVIEWERS` (line 48),
  `RETIRED_REVIEWERS`, or `ACTIVE_REVIEWERS` (line 195). Roster size is not the
  bug — see the first comment on #1851.
- **A "this reviewer is unusable for this PR, not failed" state** — that is issue
  #1833.
- **A durable verdict artifact** — that is issue #1824.
- **Author-lane capacity, claims, preview dispatch, the migration ledger,** or any
  other subsystem in the same file.
- **Deleting or rewriting any existing refusal.** Refusals get *better messages*
  and, in exactly one new case, a *governed alternative*; none is removed.
- **Retro-fixing the 2026-09-01 incident's own stuck leases.** By the time this
  ships they will have been cleared. If they have not, releasing them is an
  ordinary use of the new Step 1 command, not extra work.

---

# Part 2 — What we already know

## 5. Current state of the code

Everything below is **already on `main`** at `bcd2ec1a` and is *unchanged* — no
part of this plan has been started. There is no half-done work anywhere.

| Thing | Where | State |
|---|---|---|
| Reviewer coordination logic | `scripts/manage-migration-author-lanes.mjs` (3,917 lines) | on `main`, untouched |
| Its tests | `scripts/manage-migration-author-lanes.test.mjs` (2,579 lines) | on `main`, untouched |
| Reviewer-issue logger | `ai-devops` `bin/ai-reviewer-issue` (392 lines) | on `main`, untouched |
| Its tests | `ai-devops` `tests/test-ai-reviewer-issue.sh` | on `main`, untouched |
| Governed issue | `u2giants/shared-db` #2058 | **open**, `db-work`, `work_type: repo-maintenance`, `route: repo-maintenance` |
| Earlier related issue | `u2giants/shared-db` #1851 | **open** — same pool, wider scope |

Key landmarks in `scripts/manage-migration-author-lanes.mjs`:

**Verified against `main` at `bcd2ec1a`, 3,917 lines.** The shared checkout at
`C:
epos\shared-db` was ~800 lines stale when this plan was first drafted and its
line numbers were wrong throughout. Re-derive any number below with `grep -n`
before relying on it; treat the symbol name as the truth and the line as a hint.


| Line | Symbol | What it is |
|---|---|---|
| 46 | `REVIEW_ACTIVE_REF_PREFIX` | `refs/db-review-active` |
| 49 | `REVIEW_ACTIVE_CUTOVER_REF` | must exist or lease reads refuse entirely (line 1745) |
| 64 | `REVIEWERS` | the full roster |
| 211 | `ACTIVE_REVIEWERS` | roster minus retired — the six |
| 241 | `TERMINAL_FAILURE_CODES` | the five recognised terminal codes |
| 770–850 | `readActiveReviewLeases`, `readReviewStates`, `readReviewRefs`, `readReviewRecords` | GraphQL batch readers, with hard-won comments about `object(expression:)` vs `ref(qualifiedName:)` — **read those comments before writing any new query** |
| 853 | `atomicReviewRefs(changes)` | the atomic multi-ref push |
| 1437 | `reviewActiveRef(reviewer)` | ref path for a reviewer |
| 1445 | `parseReviewLease(commit)` | the lease message grammar (three alternated regexes on ONE line) |
| 1741 | `findBusyReviewers(io, requested=[])` | **the heart of the defect** |
| 1769, 1772 | staleness tests | PR closed / head moved / verdict exists |
| 1775–1777 | `busy.stale`, `busy.states`, `busy.leases` | non-enumerable side-channels on the returned Set |
| 2042 | assignment refusal | already reworded upstream — names busy / already-assigned / excluded, and lists durable exclusions |
| 2043 | assignment lease commit message | `reviewer-cursor` form, with optional ` slot=N` |
| 2072 | `io.deleteRef(leaseRef)` | the assignment path already releases a *stale* lease it selects |
| 2259 | `reviewerExecutionPreflight` | `--reviewer-preflight`, runs a wrapper's own `doctor` |
| 2280 | `replaceFailedReviewerOperation({...,slot=1}, io)` | the whole replacement path |
| 2427–2437 | replacement selection loop | skips retired / already-failed / busy / excluded |
| 2438 | replacement refusal | **the false message** |
| 2446–2470 | the atomic replacement transaction | where the failed lease *is* released (2461) |
| 3582 | `parseArgs` | where new flags go |
| 3672 | command dispatch (`o.assignReviewer` …) | where new commands go |

## 6. Key findings and root cause

**Finding 1 — the release of a dead lease is welded to a successful replacement
draw. This is the primary defect.**

Read `replaceFailedReviewerOperation` in order:

- Line **2427–2437**: it loops the roster looking for a replacement, skipping any
  candidate that is retired, already failed on this head, or `preflightBusy`.
- Line **2438**: if none is found it **throws immediately**.
- Line **2446–2462**: only *after* a replacement exists does it build the atomic
  change set — and only there does `{ref: failedLeaseRef, expected: failedLeaseSha, sha: null}`
  (line 2461) release the dead reviewer's slot.

So the code can only free a slot as a *side effect* of filling another one. When
the pool is full, the one operation that would free capacity refuses for lack of
capacity. **It is a deadlock by construction**, and it is worst exactly when
capacity matters most. (Issue #1851's third comment reached the same conclusion
from the opposite direction: "There is currently no command that reclaims one.")

**Finding 2 — `findBusyReviewers` has no concept of a dead review.**

At line 1769/1772 a lease is only stale if the PR closed, the head moved, or a
verdict exists. A reviewer that ran out of turns, crashed, or refused to attach
evidence produces **none of those three**: the PR is still open, the head has not
moved, and there is no verdict precisely *because* it died. Its lease therefore
reads as `busy` forever. Three of the six slots in the 2026-09-01 census were in
exactly this state, plus two more that were simply old.

**Finding 3 — a lease cannot be aged, because it records no time and no state.**

`parseReviewLease` (line 1445) accepts three message grammars and extracts
`generation, reviewer, issue, pr, headSha, sequence`. There is **no timestamp** and
**no lifecycle field**. A slot taken four days ago for an unrelated issue is
byte-indistinguishable from one taken four minutes ago. (The underlying Git commit
does carry an author date, but nothing reads it, and it is not part of the parsed
record.)

**Finding 4 — the refusal misnames its own cause.**

Line 2438 says *"every active provider has already failed on this exact head."*
On 2026-09-01 that was false: exactly one provider had failed on that head. The
truth was "five of six are held by other work, and the sixth already failed here."
The loop at 2044 skips for three distinct reasons — ineligible, already-failed,
and busy — and collapses all three into the already-failed wording. A session
reading that message reasonably concludes the head is poisoned and starts trying
to change the head, which is the wrong repair. **This is the second time this
class of bug has bitten**: #1851's second comment records a lost mutex race being
reported as `RECOVERY REQUIRED`, sending an operator to a recovery workflow when
nothing was damaged.

**Finding 5 — the reviewer-issue logger advertises evidence it did not capture.**

In `ai-devops` `bin/ai-reviewer-issue`, **all** evidence capture is gated on
`exact_json` finding a reviewer *metadata* record matching provider + repo + head +
run/session + caller (line ~221). When no such record exists — which is guaranteed
for a `--provider reviewer-coordination` report, because coordination is not a
provider and writes no wrapper metadata — `capture_exact_files` writes nothing and
`capture_scoreboard` `rm -f`s its own output (line 168). But the `jq -n` block at
line **266–268** hard-codes the evidence paths regardless:

```
complete_matching_review_reports:"review-reports/",
recent_provider_logs:"provider-logs/",
latest_scoreboard_entry:"latest-scoreboard-entry.json",
```

The 2026-09-01 report is the proof: `issue.json` names
`latest-scoreboard-entry.json`, and **that file does not exist in the directory**;
`review-reports/` and `provider-logs/` exist but are empty. A future reader is told
evidence is there when it is not. `missing-evidence.txt` *was* written correctly —
so the tool knows the truth and reports it in one place while contradicting it in
another.

## 7. Approaches considered and REJECTED

Do not re-derive these. Each was considered on 2026-09-01 and rejected for the
reason given.

1. **Add a seventh reviewer / enlarge the roster.** Rejected — this is explicitly
   rebutted in the first comment on #1851: a larger roster raises the number one PR
   can absorb and saturation recurs one replacement-draw later. It also hides the
   defect rather than fixing it.
2. **Hand-delete the stuck `refs/db-review-active/*` refs.** Rejected, and it must
   stay rejected. The 2026-09-01 session was right not to. A hand-deleted lease
   leaves no failure evidence, no cursor movement, and no record that a review ever
   existed — which is how an un-reviewed change reaches `main`. Any repair must go
   through the mutex and leave immutable evidence, exactly as the existing
   replacement path does.
3. **Post a synthetic verdict to make a lease look stale.** Tried during the
   incident (a machine-recognisable `REVISE` was posted for GLM #2054) and it did
   not free the pool. It is also **actively dangerous**: verdict text near a head
   SHA is read as a *recorded verdict with no author check* (this repo has been
   bitten by prose satisfying a gate before). Manufacturing verdicts to manipulate
   capacity is forbidden.
4. **Give leases a plain wall-clock TTL and auto-expire them.** Rejected as the
   *primary* mechanism: a long, legitimately slow review would be silently
   evicted mid-flight and its work discarded. Age is used in this plan only to
   *flag and to permit a governed release after re-checking live state*, never to
   auto-delete. (See Step 2's locked decision.)
5. **Broaden `findBusyReviewers`'s staleness test to treat "no verdict after N
   hours" as stale.** Rejected for the same reason as 4, plus it would make
   assignment itself start evicting other lanes' work as a side effect — the
   opposite of the "release must be explicit and evidenced" principle.
6. **Make `--replace-failed-reviewer` release the failed lease *before* choosing a
   replacement, and keep refusing afterwards.** Tempting and nearly right, but
   rejected as the *only* change: the operation is a single atomic transaction by
   design, and splitting it so the release commits while the rest aborts turns one
   all-or-nothing push into two, reintroducing partial state the atomic path exists
   to prevent. Step 1 instead adds a **separate, complete, atomic operation** whose
   whole job is the release — and then lets the existing replacement path reuse it.

**Rejected (2026-09-01, after independent review) — putting the lease timestamp in
the commit message.** This plan originally proposed appending an optional
` held-since=<ISO8601>` field to the lease line. Rejected: the same message family
is parsed by `parseReviewLease` (line 1445) *and* `parseReviewCursor` (line 1429);
both anchor the cursor form with `$`, so any appended field breaks both, and
capture group 6 already means `sequence` in one and `slot` in the other while
`parseReviewLease` derives `cursorForm` from `!match[6]`. A cosmetic field is not
worth a silent lease/cursor misclassification. The commit's `committedDate` already
carries the answer and costs nothing to read.

## 8. Design decisions already made

Dated 2026-09-01 unless stated. **LOCKED** decisions must not be relitigated;
**OPEN** ones are the implementer's judgment.

- **LOCKED — one new release command, not a change to the refusal.** Capacity is
  freed by an explicit governed operation that records evidence, never by
  weakening a check.
- **LOCKED — releasing requires the same evidence a replacement requires.** A
  recognised `TERMINAL_FAILURE_CODES` code, the exact issue/PR/head/sequence, and
  the existing `--confirm-no-verdict` / `--confirm-no-artifact` confirmations. A
  release is not cheaper than a replacement; it is only *possible when a
  replacement is not*.
- **LOCKED — releasing re-checks live state under the mutex.** Before deleting,
  re-read the PR/issue/verdict state (the same `readReviewStates` freshness check
  the replacement path does at line 2063–2068) and refuse if a verdict has appeared
  or the head moved. Never delete on the strength of a preflight read.
- **LOCKED — the failure evidence ref is written even when no replacement is
  drawn.** The record of *why* a slot was freed is the point. It must be immutable
  and create-only, like `failureRef` today.
- **LOCKED — age never auto-deletes.** Step 2 makes age *visible* and Step 3
  *reports* it. Eviction stays a human/agent-invoked, evidenced act.
- **LOCKED — backward compatibility of the lease grammar.** `parseReviewLease`
  and `parseReviewCursor` must keep accepting today's three message forms
  **byte-identically**. Neither regex may be edited. Any lease whose age cannot be
  determined must report "unknown" rather than erroring or defaulting to zero.
- **LOCKED — Step 3's report is read-only.** It takes no mutex and writes no ref.
- **LOCKED — `ai-devops` fix is honesty, not new capture.** Step 5 stops the tool
  lying about what it has. Making coordination-class reports capture *richer*
  evidence is a good idea and is out of scope.
- **LOCKED (revised 2026-09-01) — the lease message grammar does not change at
  all.** Lease age comes from the commit's own `committedDate`, read via the
  existing GraphQL query. See Step 2 for why appending a field is unsafe: two
  parsers read the same messages, both `$`-anchored, and capture group 6 already
  carries different meanings in each.
- **OPEN — the age threshold at which the report flags a slot as suspicious.**
  Pick something defensible (12h or 24h) and put the number in one named constant
  with a comment saying it is advisory only. It gates no behaviour.
- **OPEN — command naming.** `--release-failed-reviewer` and `--reviewer-capacity`
  are the names used throughout this plan; if an existing convention in the file
  fits better, follow the file.

---

# Part 3 — How to build it

## 9. The plan

> **Phase A = Steps 1–4** (`shared-db`, one PR). **Phase B = Step 5** (`ai-devops`,
> its own PR). They are independent. If context runs short, Phase A alone is a
> complete, shippable improvement — cut there, and re-read this file before
> starting Phase B.

Before starting **any** step: read §5's landmark table, read the comments at
`scripts/manage-migration-author-lanes.mjs` lines 779–806 (they record two separate
days lost to GitHub's GraphQL silently answering `null` for custom ref namespaces),
and read the existing reviewer tests at
`scripts/manage-migration-author-lanes.test.mjs` lines ~350–510 to learn the
in-memory fake IO the suite uses.

---

### Step 1 — `--release-failed-reviewer`: free a dead slot without needing a replacement

**Dependencies:** none. Do this first; Steps 3 and 4 read better once it exists.

**What to change**

1. `scripts/manage-migration-author-lanes.mjs`: add
   `releaseFailedReviewerOperation({issue, pr, headSha, failedSequence, failureCode, failingCheck, confirmNoVerdict, confirmNoArtifact}, io)`,
   placed immediately **before** `replaceFailedReviewerOperation` (currently line
   2280) so the two read together.
2. Reuse, do not re-implement: the argument and evidence validation at lines
   1920–1935 (terminal-code check, confirmations, `local_dependency_unavailable`
   special case), the mutex acquisition at line 2446, the freshness re-check at
   2063–2068, and `io.atomicReviewRefs` at 819.
3. The atomic change set is a strict subset of the replacement one:
   - `{ref: MUTEX_REF, expected: ownerSha, sha: ownerSha}`
   - `{ref: failureRef, expected: null, sha: failureSha}` — create-only immutable
     evidence, message identical in shape to line 2439's but with
     `replacement=none` in place of the replacement fields, so a reader can tell a
     release from a replacement at a glance.
   - `{ref: failedLeaseRef, expected: failedLeaseSha, sha: null}` — the release.
   - **No cursor movement.** The rotation cursor advances when a replacement is
     *drawn*; a release draws nobody, so `REVIEW_CURSOR_REF` must not move.
     Moving it here would skip a healthy reviewer's turn.
4. Verify the identity of what you are deleting exactly as line 2024 does: refuse
   unless the live lease's `issue`, `pr`, `headSha`, `sequence`, and `reviewer` all
   match the failure evidence. A freshness check is not an identity check — check
   both.
5. Read back after the push (`io.readReviewRefs`) and refuse on mismatch, mirroring
   line 2463–2464. Roll back on error in the same shape as lines 2466–2470.
6. Wire the CLI: add `--release-failed-reviewer` to the flag parser (near line
   2876) and dispatch it (near line 2944). It takes the same `--issue --pr
   --head-sha --failed-sequence --failure-code --confirm-no-verdict
   --confirm-no-artifact` arguments as `--replace-failed-reviewer`.
7. **Then make the replacement path reuse it.** In
   `replaceFailedReviewerOperation`, when the selection loop at 2427–2437 finds no
   reviewer, do **not** simply throw: throw an error whose message (see Step 4)
   names the true cause **and** tells the caller the exact
   `--release-failed-reviewer` command to run instead. Do not silently auto-release
   — the caller decides.

**How it should behave when done**

Running the release command against a lease held by a reviewer that reported a
terminal failure frees that one slot, leaves permanent evidence of why, moves no
cursor, touches no other reviewer, and is refused if a verdict appeared, the head
moved, the PR closed, or the lease does not match the evidence.

**Verification gate**

```bash
node --test scripts/manage-migration-author-lanes.test.mjs
```

New tests must include one that constructs six busy leases and asserts that
`--replace-failed-reviewer` still refuses while `--release-failed-reviewer`
succeeds and leaves exactly five leases. That test **must fail against `main`'s
code** — run it against the unmodified function once and confirm it goes red
before you make it green. (See §11: prove a check can fail before trusting it.)

---

### Step 2 — Make a lease say when it was taken

**Dependencies:** Step 1 can land first or together; Step 3 depends on this.

**LOCKED decision, revised 2026-09-01 after review: do NOT put the timestamp in the
commit message.** Use the lease commit's own `committedDate`. Reasoning below — the
original grammar approach is now a rejected approach, not the plan.

Why the grammar approach was dropped: the lease message family is parsed by **two**
functions, not one — `parseReviewLease` (line 1445) and `parseReviewCursor`
(line 1429). Both anchor the `reviewer-cursor` form with `$`, so *any* appended
field breaks both immediately. Worse, capture group 6 means `sequence` in one
parser and `slot` in the other, and `parseReviewLease` derives `cursorForm` from
`!match[6]` — so adding an optional group anywhere near it risks silently
reclassifying a lease as a cursor. That is a correctness hazard for a cosmetic
gain.

**What to change instead**

1. In `readActiveReviewLeases` (line 770), extend the GraphQL selection from
   `... on Commit{message}` to `... on Commit{message committedDate}` and carry
   `committedDate` into the returned entry alongside `sha` and `commit`. This is
   one field on an existing query: **no extra request, no budget change.**
2. In `findBusyReviewers` (line 1741), attach that date to each record and expose
   it on the existing non-enumerable `busy.leases` side-channel (lines 1775–1777)
   as `heldSince`.
3. Add a small exported helper `reviewLeaseAgeHours(heldSince, now)` returning a
   number or `null`. `null` means the date was unavailable, and every consumer must
   render that as unknown, never as `0`.
4. Leave `parseReviewLease` and `parseReviewCursor` **untouched.**

**Behaviour when done:** every lease reports its age, including leases taken before
this change — because the date was always on the commit; nobody was reading it.

**Verification gate:** `node --test scripts/manage-migration-author-lanes.test.mjs`
with new cases covering (a) `parseReviewLease` and `parseReviewCursor` byte-identical
behaviour on all three message forms (regression guard — these must not change),
(b) a lease record carrying `heldSince` through `findBusyReviewers`, (c)
`reviewLeaseAgeHours` returning `null` when the fake IO omits the date. The fake IO
in the test file must be extended to supply `committedDate`.

---

### Step 3 — `--reviewer-capacity`: one command that shows all six slots

**Dependencies:** Step 2 (for age). Read-only; takes no mutex.

**What to change**

Add `reviewerCapacityReport(io)` near `findBusyReviewers` (line 1741) and a
`--reviewer-capacity` CLI command (parser ~2876, dispatch ~2944) printing JSON
(`JSON.stringify(..., null, 2)`, matching how `--reviewer-preflight` prints at line
2944). One row per reviewer in `ACTIVE_REVIEWERS`, each with:

`reviewer, held (bool), issue, pr, headSha, sequence, heldSinceIso, ageHours (or null), prState, headMatches (bool), verdictPresent (bool), classification`

where `classification` is one of `free`, `live`, `stale-reclaimable` (the existing
`busy.stale` conditions), `suspect-aged` (held longer than the advisory threshold
with no verdict), or `unknown` (state unreadable). Plus a summary line: total,
free, live, reclaimable.

Reuse `findBusyReviewers`'s existing reads — it already computes `busy.stale`,
`busy.states`, and `busy.leases` as non-enumerable properties (lines 1530–1532).
Do not issue new per-reviewer GraphQL queries; batch through
`readActiveReviewLeases` / `readReviewStates` as it already does, and respect the
request budget (`withReviewRequestBudget`, `requireReviewWireCapacity`).

**Behaviour when done:** the 2026-09-01 diagnosis — "five of these six are dead" —
takes one command instead of an afternoon.

**Verification gate:** a test asserting the classification of each of: a free slot,
a live one, a head-moved one, a verdict-present one, an aged one, and a legacy
lease with no timestamp. Plus a real run once merged:
`node scripts/manage-migration-author-lanes.mjs --reviewer-capacity` must print six
rows and exit 0 — paste that output into the PR.

---

### Step 4 — Make the refusals name their true cause

**Dependencies:** Step 1 (so the message can point at the new command).

**What to change**

1. In the selection loop at lines 2427–2437, **record why** each candidate was
   skipped — `ineligible`, `already-failed-on-this-head`, or `busy` (with the
   issue/PR it is busy on).
2. Replace the message at line 2438 so it states the counts and names the holders,
   e.g.:
   `no replacement reviewer is available: 1 of 6 already failed on this exact head (grok-4.6), 5 of 6 are holding other leases (glm-5.3 #2054, deepseek-chat #1609, ...). If a holder has terminally failed, free it with --release-failed-reviewer.`
3. The assignment refusal at line 2042 has **already been improved upstream** (it
   now distinguishes busy / already-assigned / excluded and lists durable
   exclusions). Do not rewrite it. Add only the missing half: the live counts
   (`N of 6`), the issue/PR each busy holder is on, and the pointer to
   `--release-failed-reviewer`. Re-read that line before editing — if it has moved
   on again, keep whatever it already says and add only what is absent.
4. Do **not** change any refusal *condition*. Message only.

**Safety note carried from review (verify before implementing):** the assignment
path at line 2072 already deletes a lease it judged stale, and the retry/repair
branches near lines 1976–2010 can **re-create** a lease for a sequence whose lease
was released. Before landing Step 1, prove with a test that a slot released by
`--release-failed-reviewer` is not silently re-created by a later
`--assign-reviewer` retry for the same issue/PR/head. If it can be, Step 1 must
also write a durable release record that those branches consult.

**Behaviour when done:** a session that hits the wall is told which of the two very
different problems it has, and what to do next.

**Verification gate:** tests asserting the refusal text contains the true counts
and at least one blocking holder's name in a scenario where exactly one provider
failed on the head and five are busy elsewhere — i.e. an assertion that would have
caught the 2026-09-01 wording.

---

### Step 5 (Phase B) — `ai-reviewer-issue` must not advertise evidence it lacks

**Repository: `u2giants/ai-devops`, local `C:\repos\ai-devops`. Separate branch,
separate PR.** Independent of Steps 1–4.

**What to change** in `bin/ai-reviewer-issue`:

1. In the `jq -n` block at lines ~262–269, make each evidence path **conditional on
   what actually exists**: emit `"review-reports/"` only if that directory contains
   at least one file, `"provider-logs/"` likewise, and
   `"latest-scoreboard-entry.json"` only if the file exists (remember
   `capture_scoreboard` deletes it when empty, line 168). Emit `null` otherwise —
   `session_details` and `complete_error_log` already do exactly this and are the
   pattern to copy.
2. Add a `captured` count for each so a reader sees `0` rather than a bare path.
3. Make `missing-evidence.txt` also written when metadata *was* found but every
   capture came back empty, with a one-line reason. Today it is written only for
   "no match" and "ambiguous match".

**Behaviour when done:** a reviewer-issue report is never contradicted by its own
directory listing.

**Verification gate:**
```bash
bash tests/test-ai-reviewer-issue.sh
```
plus a new case that records an issue for a provider with no metadata and asserts
`jq -e '.evidence.latest_scoreboard_entry == null'` on the resulting `issue.json`.
Confirm the new case fails against unmodified `bin/ai-reviewer-issue` before fixing.

---

## 10. Tests required

**New, in `scripts/manage-migration-author-lanes.test.mjs`** (follow the existing
in-memory fake-IO style at lines ~350–510; the whole reviewer suite is offline —
no live GitHub calls, ever):

| Test | Asserts |
|---|---|
| `release frees a terminally failed lease when the pool is full` | six leases in, five out; the released one is the named reviewer |
| `release refuses when a verdict appeared after preflight` | throws; no ref changed |
| `release refuses when the live lease does not match the failure evidence` | throws on any of issue/PR/head/sequence/reviewer mismatch |
| `release does not move the rotation cursor` | `REVIEW_CURSOR_REF` unchanged |
| `release writes create-only immutable failure evidence` | second identical release refuses rather than overwriting |
| `legacy lease messages still parse` | all three existing grammars, unchanged |
| `timestamped lease round-trips and ages` | `heldSince` parsed, `reviewLeaseAgeHours` correct |
| `age is null, never zero, for a legacy lease` | `null` |
| `capacity report classifies free / live / stale / suspect / unknown` | one case each |
| `refusal names true counts and blocking holders` | text contains both numbers and a holder name |

**Existing suites that must stay green (do not modify to make new code pass):**

```bash
node --test scripts/manage-migration-author-lanes.test.mjs
```

and whatever else `.github/workflows/tools-offline-tests.yml` runs (see its lines
64, 89, 140 — it runs `node --test` over a file list). The full required check set
on `main` must be green before merge; `shared-db` has nine merge-gate checks and
this is a **code** change, so none of them may be skipped.

**In `ai-devops`:** `bash tests/test-ai-reviewer-issue.sh`, plus the new case above.

---

## 11. Constraints, standing rules, and gotchas in force

**Repository and branch rules**

- `shared-db` changes go on a **branch with a pull request**, never a direct push
  to `main`. `ai-devops` likewise pushes via a branch.
- Before the first commit in either repo, run `git var GIT_COMMITTER_IDENT`; it
  must read `Albert Hazan <u2giants@users.noreply.github.com>`.
- **This is a code change, so the normal checks apply in full.** The
  documentation-only fast-merge exception does **not** apply to Phase A or Phase B.
  (It would apply to a PR that only touched this plan file and the handoff.)
- **Claude merges its own PRs.** Do not end the work by asking Albert to review or
  merge. If a check fails or a conflict appears, fix it.
- `gh pr merge` from a linked worktree can print `'main' is already used by
  worktree`. That is **local branch cleanup failing after the merge succeeded** —
  confirm with `gh pr view <n> --json state`, delete the remote branch, continue.
- This session is working in a git **worktree** at
  `C:\repos\shared-db\.claude\worktrees\find-edge-dev-reviewer-coordination-9ec999`
  on branch `claude/find-edge-dev-reviewer-coordination-9ec999`. Run everything
  from there; do not `cd` to `C:\repos\shared-db`. **Never use bare `git stash` /
  `git stash pop`** — the stash stack is shared with other sessions.
- **The shared checkout `C:\repos\shared-db` can be tens of commits stale.** Read
  verification facts from `origin/main`, not from that working copy.

**Rules specific to this subsystem**

- **Structure, not data.** This plan authorises no database access at all. If a
  step seems to need one, stop — it is out of scope.
- **Do not route this to the shared-db orchestrator.** It is repo-maintenance,
  per the precedent of #1767 and #1366.
- **Never hand-delete a coordination ref**, and never bypass the mutex. Every
  mutation goes through `io.atomicReviewRefs` with `--force-with-lease` and a
  read-back.
- **Never manufacture a verdict** to influence capacity, and never widen what
  counts as a verdict. Verdict-shaped prose already satisfies a gate in this repo
  with no author check; do not feed it.
- **A refusal that is correct stays.** Only false refusals and false *messages* are
  in scope. Symptom suppression is not a fix.
- **GraphQL trap, already paid for twice:** `ref(qualifiedName:)` silently returns
  `null` for refs outside `refs/heads/` and `refs/tags/`, and `refs(refPrefix:)`
  rejects or ignores custom namespaces. Use `object(expression:)`, or the REST
  `git/matching-refs` fallback. Comments at lines 779–806 record the evidence — read
  them before writing a query.
- **Request budget:** reviewer operations run under `withReviewRequestBudget` and
  `requireReviewWireCapacity(n)` (see line 2446's `requireReviewWireCapacity(12)`).
  Any new reads must be batched and budgeted; do not add per-reviewer round trips.
  Never test scale by scanning live historical assignment refs.
- **Prove a check can fail before trusting it.** Every new test must be observed
  red against unmodified code before being made green. This repo has shipped a
  confidently-wrong "all clear" from a predicate whose escaping inverted its answer.
- **Cite artifacts, not numbers.** Any claim in the PR body or the STATUS table
  must name a file, a command, a test name, or a commit — never a bare count, and
  never an issue/PR number as evidence of a *result*.
- **The orchestrator engine is always excluded from reviewing its own change** —
  Codex cannot review a Codex-orchestrated change, Claude cannot review a
  Claude-orchestrated one. Relevant when this PR itself goes for review.
- **No background task chips** in this repo (§12 of `AGENTS.md`).

## 12. Access and environment

- **Authenticated and ready on this machine (`edge-dev`, Windows 11, PowerShell +
  Git Bash):** `gh` CLI (as `u2giants`), `git`, `node`. No login step needed.
- **Target branch:** a new branch off `main` in each repo; PRs into `main`.
- **`main` at plan time:** `bcd2ec1a` (`shared-db`).
- **No environment variables, secrets, or credentials are required for Phase A or
  Phase B.** Nothing here touches Supabase, so `SUPABASE_ACCESS_TOKEN` is not
  needed. If some future step seems to need a secret, it is out of scope — secrets
  live in 1Password vault `vibe_coding` and are never pasted into chat, arguments,
  or files.
- **Running the tests:** from the repo root,
  `node --test scripts/manage-migration-author-lanes.test.mjs` (offline, seconds).
- **Running the tool against live state (read-only, safe):**
  `node scripts/manage-migration-author-lanes.mjs --reviewer-capacity` after Step 3.
- **The incident evidence** is machine-local at
  `C:\repos\ai-devops\.ai\reviewer-issues\20260901T155739Z-edge-dev-reviewer-coordination-2741130\`
  and is not in any repo — quote from it rather than linking to it.

---

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

### Done means all of these

- [ ] Steps 1–4 implemented in `scripts/manage-migration-author-lanes.mjs`.
- [ ] Every test in §10 written, each observed **red first**, then green.
- [ ] `node --test scripts/manage-migration-author-lanes.test.mjs` passes locally.
- [ ] Branch pushed; PR opened against `u2giants/shared-db` `main`, body citing
      issues #2058 and #1851 and quoting the 2026-09-01 census.
- [ ] All required checks green on the PR (nine merge-gate checks; none skipped —
      this is code).
- [ ] PR **merged by this session**, merge commit SHA recorded.
- [ ] `--reviewer-capacity` run once against live state after merge; its six-row
      output pasted into issue #2058 as proof.
- [ ] Step 5 implemented in `ai-devops`, its test suite green, its own PR merged.
- [ ] Issue #2058 closed with the evidence below, and issue #1851 updated with a comment stating which of its defects are now
      closed (the third — no reclaim command) and which remain open (defect 1, the
      per-PR ceiling; defect 2, the missing queue).
- [ ] This file's STATUS table updated: every row marked with a citable artifact
      (commit SHA / test name / command), never a bare number.
- [ ] The handoff file listed at the top updated to point at the merge, or deleted
      if nothing remains.
- [ ] `AGENTS.md` carries a link to this plan under "Active contracts and
      implementation plans", worded like the #1767 entry ("read its STATUS table
      first; repository-maintenance work outside the structure/schema orchestrator").
- [ ] A memory entry exists saying to read this plan's STATUS table first rather
      than re-deriving it.

### Risks and rollback

| Risk | Mitigation / rollback |
|---|---|
| A release deletes a lease whose review was actually alive | Terminal-code + confirmations + identity match + under-mutex freshness re-check. Rollback: re-run `--assign-reviewer` for that PR; the failure evidence ref records exactly what happened. |
| The new lease field breaks parsing of leases written by an older copy of the script running on another machine | Field is optional and additive; legacy-parse tests are mandatory. A version skew only loses *age*, never correctness. |
| Partial ref state if a push half-lands | All mutations are single `git push --atomic` transactions with `--force-with-lease` and a read-back, plus the existing rollback block pattern. |
| Someone uses the release command as a routine way to clear busy slots | It demands terminal-failure evidence and writes an immutable record naming the caller's reason. Consider auditing usage later; not gated here. |
| The whole change is reverted | It is one file plus tests in one PR — `git revert <merge SHA>` restores today's behaviour exactly. Nothing is migrated, nothing is stateful. |

### Genuinely open questions (decide during implementation, record the answer here)

1. **The advisory age threshold** for `suspect-aged` — 12h or 24h. Criterion: it
   should be comfortably longer than the slowest legitimate review observed
   (multi-hour), and short enough that a day-old ghost is flagged before it stalls
   a queue. It gates nothing, so a wrong answer is cheap.
2. **Whether `--release-failed-reviewer` should accept a batch** of failed
   sequences. Criterion: if the 2026-09-01 shape (three dead at once) is common,
   batching saves three mutex round-trips; if it is rare, one-at-a-time is safer
   and simpler. Default to one-at-a-time unless the implementer finds evidence of
   recurrence.
3. **Whether the assignment path (line 2042) should also point at the release
   command.** It probably should, but its failure mode is subtly different
   (no failure evidence exists yet for a lease that was never commissioned by this
   caller). Judgment call; err toward a hint, not an instruction.

---

## Self-audit (mandatory gate — answered before this plan was shown)

**1. Could a brand-new AI session with no project knowledge and no context from
this conversation execute this plan to perfection, without asking anything?**
Yes. §2 defines the repository, the stack, where state actually lives (Git refs,
not a database), and — critically — the author-lane vs reviewer-slot distinction
that is the likeliest source of a wrong edit. §5 gives a line-number landmark table
for a 3,917-line file. §9 names the exact functions to add, the exact lines to reuse,
and the change-set contents. §12 confirms no credential or environment setup is
needed. Gap found and fixed during audit: the first draft assumed the reader knew
what a "lease", a "verdict", an "exact head" and the mutex were — §2 now defines
every term before use, and §5 states plainly that nothing has been started.

**2. Does the plan carry every piece of background, nuance, and reasoning currently
held — including what was ruled out and why?**
Yes. §3 reproduces the incident census and the three things the incident session
tried that failed. §6 gives the root cause at line-number precision, including the
subtle one (release welded to a successful draw at 2438 vs 2461) that reading the
function top-to-bottom does not reveal. §7 lists six rejected approaches, two of
which (hand-deleting refs, posting a synthetic verdict) are dangerous enough that
omitting them would invite real harm. §11 carries the GraphQL trap, the
request-budget rule, the prove-it-can-fail rule, and the worktree stash hazard.
Gap found and fixed during audit: the first draft did not say that the incident
evidence directory is machine-local and absent from every repository — a reader on
another machine would have chased a dead path.

**3. Is the ultimate goal stated clearly enough that the implementer could make a
correct judgment call if a step turns out to be wrong?**
Yes. §1 states the business outcome in plain English before any technical wording,
names the concrete failure it prevents, and carries the explicit "the goal wins —
stop and flag it" instruction, plus the specific warning that suppressing a refusal
would silently un-review a database change. §8 labels every decision LOCKED or
OPEN, and §13 lists the three genuinely undecided questions with the criteria for
settling each — so an implementer knows exactly where judgment is invited and where
it is not.

**Result: all comprehensiveness-checklist items pass.**
