# Orchestrator handover — session `feeaf3a0` — al8960ofc — 2026-08-09T1250Z

Marker issue: **#587** (`ORCHESTRATOR ACTIVE — feeaf3a0 — al8960ofc`), closed at the
end of this handover. One orchestrator ran; three sub-agents were dispatched; one
work PR merged.

> **Read this if you are picking up cold.** The single most valuable thing in this
> file is §8 — what was tried and did NOT work. Two separate accounts of the
> link-state incident were written in this session, and **the first one was wrong**.
> If you read only the merged evidence doc and not §8, you will not know that.

---

## 1. What this session was for, and what it actually was

Opened as a plain "start a shared-db orchestrator session". No pre-existing agenda
beyond the board. The work that landed was chosen live from the queue with Albert:
load the Disney OPA extract into preview (issue #581), plus one owner ruling and
one safety gate that emerged from doing it.

The orchestrator performed **no** implementation work itself. Everything below was
done by dispatched sub-agents in isolated worktrees; the orchestrator's own actions
were limited to: the marker, dispatch comments, issue bookkeeping, the collision
gate, the merge, the sweep, and this file.

---

## 2. Coordination state at write time (all re-verified 2026-08-09T1248Z)

```
origin/main tip:          9549c6329cad57f84da94ad88a84396a17086b49
max migration version:    20260807200000
migration file count:     405
open PRs:                 0
open db-claim claims:     0
open orchestrator markers: #587 (mine — closed at the end of this handover)
open db-work issues:      69
```

**Ownership at handover: NOTHING is owned.** No agent holds `supabase/migrations/`,
`HANDOFF.md`, or `AGENTS.md`. No claims are open. The next orchestrator starts with
a clear board and may dispatch immediately after its own step-0 sweep.

**Preview (`rjyboqwcdzcocqgmsyel`) — measured, not assumed:**

| Thing | Value |
| --- | --- |
| migration ledger | **405 rows**, max `20260807200000` — matches the 405 files on `main` **exactly** |
| `plm.opa_property_character` | **10,261 rows** (was 0 at session start) |
| `api.opa_property_reconciliation` | **1,444 property nodes** |
| negative-ID rows | **0** |
| `core.property_character` | **0 rows** — deliberately not populated; no resolution run was performed |
| `core.character` | **0 rows** — same |

**Preview is NOT clean, and this session is why.** It now holds a full Disney OPA
extract that exists nowhere else. Anyone rehearsing against preview must know those
10,261 rows are there. They are ours, they are deliberate, and they are the point of
issue #581 — but they are not a pristine baseline.

**Production (`qsllyeztdwjgirsysgai`) was never contacted.** Measured at 361
migrations / max `20260802194100` — **44 behind preview**. That gap includes the OPA
security migration `20260807190000`. See §7.

---

## 3. Every sub-agent, separately

### Agent: preview-observer (read-only, no worktree)

- **Asked to do:** resolve preview state from `UNKNOWN` — step 6 of the orchestrator
  sweep. Read-only, no writes of any kind.
- **Actually did:** read through the Management API with the preview ref named
  explicitly in the URL path, so the target could not drift. Made exactly one MCP
  call (`get_project_url`) and stopped.
- **Found:**
  1. **The two link files disagreed.** `supabase/.temp/project-ref` named preview;
     `supabase/.temp/linked-project.json` named **production**. This is what set off
     everything in §4.
  2. **The MCP is bound to production** (`get_project_url` →
     `qsllyeztdwjgirsysgai`), and takes no project parameter. It refused to use it
     further.
  3. **The ledger dispute is settled: 405/405 is correct.** It pulled every version
     string and diffed against filenames — identical sets, no orphans either way.
     The prior session's "400/400 exact" was **wrong**.
  4. **Issue #510 was a misread.** `MIGRATIONS_FAILED` belongs to the parent/production
     branch record (updated 2026-06-21). Preview reports `FUNCTIONS_DEPLOYED`
     (2026-07-21). Both timestamps are weeks old, so **that API status field is not a
     health signal in either direction** — measure the ledger instead.
  5. **No unmerged work on preview.** 15 of 275 tables/views appear in no migration,
     but all 15 also exist on production — legacy pre-migration baseline objects
     inherited when the branch was cut.
- **PR / branch:** none (read-only).
- **Worktree:** none. Finished.
- **Deliberately did NOT do:** did not repair the link files (outside its read-only
  limit — it reported and stopped, correctly). Did not use the Supabase CLI at all,
  because the link state was untrustworthy.

### Agent: opa-preview-load (worktree `.claude/worktrees/opa-preview-load` — RETIRED)

- **Asked to do:** issue #581 — load the Disney OPA extract into preview. Preview
  only, no migration, no production. Later given three more rounds: the review
  repairs, Albert's sentinel ruling, and a rebase.
- **Actually did:** **PR #591, merged as squash `9549c63`** — 23 files,
  +2,138/−36. Four rounds of work, each verified against the diff before acceptance.
- **PR / branch:** #591 merged. Branch `feat/opa-preview-load` deleted; worktree
  removed after confirming clean (`DIRTY_LINES=0`) and content present on `main`.
- **Worktree:** **finished and already retired.** Nothing to clean.
- **Found — five things that matter more than the load itself:**
  1. **It disproved its own headline claim.** See §8. This is the most important
     item in the handover.
  2. **A real authorization bypass**, reproduced before being fixed. The read-only
     exemption matched a substring of a whole call *line*, and the call regex was
     greedy to end-of-line. So
     `node tools/check-supabase-link-state.mjs … && node tools/sync-coldlion-licensors-properties.mjs --apply`
     parsed as **one exempt call** — the write runner inherited the guard's exemption
     and skipped the four-part production authorization entirely. **One `&&` defeated
     the gate.** Fixed by `parseRunnerCalls()`, keyed on the parsed script name, pinned
     on both the runtime checker and the contract test, with a decoy test where the
     guard's name appears only in an adjacent `echo`.
  3. **A guard that was silently not guarding.** `migrationBody()` split on `\n`,
     leaving `\r` on Windows, so `--` comment stripping never fired and `grant`
     matched *inside a comment*. One-line fix, no assertion relaxed.
  4. **A sentinel row in Disney's extract** — `licensed_property_id = -9999` /
     `character_id = -9998`, the only negative IDs in the file. It loaded as a
     legitimate node, so the property count read 1,445 when the truth is 1,444.
     Escalated to Albert; see §5.
  5. **`linked-project.json` survives `supabase link`.** Proved by planting a JSON
     naming an unrelated ref, running `supabase link` at preview, and finding it
     **byte-for-byte unchanged** while `project-ref` and `pooler-url` were created.
     So "just re-link to fix it" was never going to work. Evidence file `11`.
- **Deliberately did NOT do:**
  - **No `core.property_character` / `core.character` resolution run.** The mirror is
    loaded; nothing was resolved into the core tables. Both remain 0. This is the
    obvious next step and it was **not** in scope.
  - No migration created (the two migration CI jobs correctly report `skipped` —
    that is the proof).
  - No production contact, no promotion, no self-merge, no CSV committed to the
    public repo.
  - Did **not** make the parser reject negative IDs — only the *loader*. Rejecting at
    parse time would abort the whole run instead of counting the sentinel. The
    `bigint` typing and the parser's tolerance of a leading minus **stay**.
  - Did **not** import the exemption helper into the contract test, on purpose: a
    test that imports what it polices can excuse a bug in it.

### Agent: pr-591-reviewer, rounds 1 and 2 (read-only, no worktree)

- **Asked to do:** adversarial independent review of PR #591 before merge. Round 2
  was scoped to the delta only, because the PR had grown to touch
  `.github/workflows/coldlion-licensor-property-production.yml` — the production
  target gate.
- **Actually did:** round 1 returned APPROVE WITH FINDINGS with 2 Critical, 4 High.
  Round 2 returned APPROVE WITH FINDINGS with 0 Critical, 0 High, 3 Medium, 2 Low.
- **Found:**
  - **Round 1, C1: the guard was unreachable.** Nothing imported it; the defeated
    `cat project-ref` check was still live in 12 tools and 3 workflows including the
    production gate. **The orchestrator verified this independently by `git grep`
    before acting on it** — confirmed.
  - Round 1, H2: the account of the incident contradicted the PR's own code. This is
    what forced the measurement in §8.
  - Round 2 traced the production job step by step and confirmed it **cannot fail
    open**: no `if:`, no `continue-on-error`, `bash -e`, and every
    "cannot determine" path throws. It also confirmed it cannot wrongly *block* a
    legitimate run.
  - Round 2 confirmed the sentinel boundary is right (ID `0` kept), and that
    `OPA_MIN_ROWS` counting *loaded* rather than *read* rows is **strictly stronger**,
    not weaker.
  - Round 2 confirmed **all 24 tests are real**, checked one by one for "would this
    fail if the code broke". This repo has shipped vacuous tests before; these are not.
- **PR / branch:** none (read-only).
- **Worktree:** none. Finished.
- **Deliberately did NOT do:** did not re-review the whole PR in round 2 — delta only,
  by instruction. Did not test whether a *valid* mismatched `pooler-url` can redirect
  the CLI, because that would have required pointing a connection at production. **That
  remains untested.**

---

## 4. What merged, and what it changes for everyone

**`9549c63` — PR #591.** Three things in one commit:

1. **The Disney OPA extract is on preview.** 10,261 rows, 1,444 property nodes.
2. **Albert's sentinel ruling is implemented** (§5).
3. **A link-state gate exists and is wired into the production workflow.**
   `tools/check-supabase-link-state.mjs` — checks `project-ref` (required),
   `linked-project.json` and `pooler-url` (optional, but must agree if present).
   Fails closed on every ambiguous input.

**The gate is wired into ONE call site, not fifteen.** The production workflow gate
is protected. **14 other call sites still use the old single-file check** and are
tracked in **#593**. Do not assume the repo is covered.

Evidence: `docs/verification/opa-preview-load-20260807/` — 11 files. Files `04`–`08`,
`10`, `11` are **verbatim** captured output; `01`, `02`, `03`, `09` are **transcribed**
(real commands and outputs, hand-written `$ ` prompts). That distinction is labelled
in the files themselves because the first draft called all of them "real command
output", which was an overstatement.

---

## 5. Owner rulings given this session

**RULING (Albert, 2026-08-07): the Disney sentinel row is FILTERED OUT**, not
kept-and-labelled. Recorded on issue #581.

Implemented as instructed: at **load time in the loader** (not a one-off DELETE,
which would let the next extract re-introduce it); on the **general rule** that a
negative `licensed_property_id` or `character_id` is not a real record (not
hard-coded to `-9999`/`-9998`, which would rot the moment Disney picks different
values); with the reject count **surfaced loudly** — `rows_read`,
`rows_rejected_sentinel`, `rejected_row_ordinals`, a plain-language line, and an
explicit warning if more than one sentinel ever appears. Ordinals only, never IDs or
names. Tested both directions.

**This ruling reverses a prior deliberate decision.** Three earlier documents taught
that negative sentinel IDs are *kept*: `docs/verification/opa-source-of-truth-20260807/README.md`
(row 10 and the `bigint` note) and `BUILD-NOTE-20260807.md`. Dated supersession
pointers were added at all three sites — **the originals were not rewritten**. Each
pointer states explicitly *which half changed*: only what gets **loaded**. The
`bigint` typing and the parser's tolerance of a leading minus stay, so a sentinel
stays *counted* rather than *fatal*. **Do not add a positive check constraint.**

---

## 6. Waiting on Albert — exact questions

1. **#582 — where do the OPA extract selectors live?** `lob`, `regionName`,
   `templateId`, `workflowId` select *which slice* of Disney's data was pulled, but
   `source_url` refuses query strings. All 10,261 loaded rows currently share one
   `source_url`. **Consequence if unresolved:** a second LOB extract is
   indistinguishable from this one, and fixing it later means backfilling provenance
   across 10,262 rows. Three options were drafted; none chosen. **This was raised
   with Albert this session and is still open.**
2. **#579 — promote the five OPA migrations to production?** Production is 44
   migrations behind. **Promoting without `20260807190000` leaves every authenticated
   account — including `vendor` and `viewer` — able to read the whole confidential
   Disney extract.** Also: production's real position has never been measured
   (0 successful `production-dry-run` in 281 runs), so an apply goes into an
   unmeasured state. Recommend measuring first, in an approved window.
3. **A quiet window for the git-history scrub** — 67 commits across 13 refs. Every
   clone and worktree in the company breaks; nothing else can run during it.
4. **Whether Disney/Warner require breach notification** for the seven-week public
   window. Legal, not engineering. Still unanswered.
5. **#583 — Warner: which of two competing PRs is authoritative?** Deferred by Albert
   ("leave Warner for now"), not decided.
6. Plus the standing `needs-albert` set: #503, #515, #516, #517, #531, #539, #551.

---

## 7. The queue, and what is ready to dispatch now

**69 open `db-work` issues.** The queue is seeded — the intake-to-Issues migration
was completed by a *different* session (see §9), so every outstanding item already
has an issue. Nothing outstanding exists only in prose. Two issues were closed this
session as measured-false or completed: **#510** and claim **#589**.

Ready to dispatch immediately, in the order I would take them:

1. **Resolve the OPA mirror into `core`** — `core.property_character` and
   `core.character` are both still 0. The mirror is loaded and proven; this is the
   next step and nobody has started it. Settle #582 first if you want provenance
   right the first time.
2. **#593 — wire the link-state guard into the remaining 14 call sites.** The
   production gate is covered; the rest are not.
3. **B8 — unit-test `tools/emit-coldlion-rollback-sql.mjs`.** It is the emergency
   rollback lever, run under pressure against production, and it has no test.
4. **The Paramount recon question** — are cascading relationship fields in the search
   response, or only in per-asset metadata? Read-only; decides whether the capture is
   cheap or very expensive; unblocks **#580**.
5. **#588 — load the Warner STARLABS extract** (opened this session). Pinned snapshot
   `9092c51afc42c080f199e5784451425810c39316` in the private repo
   `u2giants/licensor-source-data`. **Read the trap in that issue before touching it:**
   Warner exposes Franchise and Property as *separate levels*, and no
   Franchise→Property, Style-Guide→Property or Style-Guide→Character link may be
   created from asset co-occurrence. Those would be inferred, and once loaded they are
   indistinguishable from real Warner records. Note it is entangled with #583.

**#580 (Paramount build) remains HELD** by owner ruling until the capture returns.
When it lands: `check-dispatch-collision.mjs` is **blind** to `create table`,
`create index`, `grant` and `comment on` — i.e. essentially that entire design.
**Judge that collision by hand.**

---

## 8. What was tried that did NOT work — MANDATORY, and read this one twice

### 8.1 The headline finding of this session was WRONG on the first telling

The session's original account was: *the two link files disagree, the documented
`cat supabase/.temp/project-ref` check passes anyway, therefore the CLI would have
written to production.* It was written up that way, in three places, as measured.

**It was not measured. It was inferred, and it was wrong.**

The reviewer caught that the PR's own code comment said the opposite, and the
orchestrator sent it back to **measure rather than argue**. Three experiments
settled it:

- **`project-ref` decides the project.** The old `cat project-ref` check was
  **RIGHT** about the CLI.
- **`pooler-url` is only the route**, and a bogus one does not redirect a correct ref.
- **`linked-project.json` is not written by `supabase link` at all** — proven by
  planting one and finding it byte-for-byte unchanged after a link.

**So what was found was orphaned editor-extension state, not a CLI wrong-target
trap.** The hazard is real but **cross-tool**: the **Supabase MCP reads
`linked-project.json`** and was bound to production while the CLI was on preview.

**Why this is in the handover and not just the commit log:** the corrected account is
in the merged doc, but anyone who read the first version, or who reasons from the
familiar "the link files disagreed, so the CLI was pointed at prod" summary, will
carry the wrong model. The corrected version is the one to repeat.

### 8.2 The same agent made the same mistake a second time, in miniature

It reported two failing tests as "pre-existing failures on `main`". **They were not** —
`main` was never red. They failed **only on Windows CRLF** and passed in CI. Same root
error: inferring instead of establishing. It posted a public correction on the PR and
fixed the actual cause (§3, finding 3).

**The pattern is the lesson.** Twice in one session, a competent agent asserted a
cause it had not established. Both times it was caught by demanding a measurement.
Demand the measurement.

### 8.3 Approaches that did not work, and should not be retried

- **"Just re-link to fix the link state."** Cannot work — `supabase link` never
  touches `linked-project.json`. Proven, evidence file `11`.
- **Deleting `supabase/.temp/` as the fix.** It is untracked, so the repair evaporates
  on the next checkout. The first draft of the doc called the trap "repaired" on this
  basis; that was corrected to OPEN.
- **`cat supabase/.temp/project-ref` as a sufficient safety check.** Correct about the
  CLI, but blind to the MCP and to `pooler-url`. Still live at 14 call sites (#593).
- **A first-draft guard that treated a missing `linked-project.json` as an error.** It
  would have failed on every correctly linked checkout. A check that cries wolf gets
  skipped. Rule is now: `project-ref` required, the others optional-but-must-agree.
- **Merging PR #591 the first time.** Refused — the head branch was behind. The
  rebase itself was conflict-free (zero file overlap), verified by byte-comparing the
  other session's file before and after (blob `02d82cab…`, 20,941 bytes, identical)
  **and** hashing all 23 of our own files both sides to prove nothing was dropped.
- **`--allocate-version` on the collision checker.** Withdrawn repo-wide; exits `2`.
  It never reserved anything. Not used this session (no migration was created).
- **The claim-filing recipe printed by `check-dispatch-collision.mjs`.** It is a bash
  heredoc and **does not work in PowerShell**, which is the default shell here. Write
  the body to a file and use `gh issue create --body-file`. That is how claim #589 was
  filed.

### 8.4 Facts in this file that may already be stale

Everything in §2 was re-verified at **2026-08-09T1248Z** and is stamped. Everything
else — the 69-issue count, the production position of 361 migrations, the contents of
other sessions' work — was read earlier and **has not been re-checked**. Documents in
this repo have gone stale within the hour. **Re-derive from `git`/`gh` before acting
on any number in this file.**

---

## 9. Things deliberately left, so nobody treats them as abandoned

- **`.claude/worktrees/csv-findings`** (branch
  `docs/licensor-property-data-quality-findings-20260806`, at `5e14c7b`). **Belongs to
  another session. Left untouched on purpose. Do not clean it.**
- **`.claude/worktrees/opa-preview-load` — already retired by this session.** Verified
  clean (`DIRTY_LINES=0`) and its content confirmed present on `main` (the guard file
  and all 11 evidence files) *before* removal. Branch label deleted. Nothing outstanding.
- **A second session ran concurrently in this repo and did not hold a marker.** It
  merged **#590, #592, #594, #595** between roughly 23:16 and 23:38 on 2026-08-07 while
  marker #587 was open. Albert identified it: it is the session **migrating the
  orchestrator's tracking from `COORDINATOR_INTAKE.md` to GitHub Issues** — process and
  docs work, no database contact. **Zero file overlap with our work**, proven by byte
  comparison, so there is nothing to unpick. Flagged here because an uncoordinated
  merge is normally the thing this whole protocol exists to prevent, and the next
  orchestrator should know this instance was benign and explained.
- **Marker #587 is closed** as part of this handover — this was a clean end, not a
  dead session. A *dead* orchestrator's marker is left open on purpose; this one is not.
- **`core.property_character` / `core.character` left at 0 rows** — a scope decision,
  not an oversight. See §3 and §7 item 1.
- **Two snags on #581 left open on purpose:** the `OPA_SOURCE_URL` slice-vs-page
  question (#582, owner gate) and the CSV bare-quote rule that has still never fired.
  #581 was therefore **left open**, not closed.
- **No untracked files** in the main checkout. `git status` is clean.

---

## 10. The gate

*Could a developer who walked in off the street this morning continue with no
questions?* The specific things that would otherwise have cost them a session:
§8.1 (the corrected account of the link-state incident — the wrong version is
plausible and is what a skim produces), §7's warning that the collision checker is
blind to `create table` for the Paramount work, §5's "do not add a positive check
constraint", §9's note that the `csv-findings` worktree belongs to someone else, and
§4's warning that the new guard covers **one** call site rather than fifteen.
