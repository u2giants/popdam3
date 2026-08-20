---
issue: 1334
status: OPEN
owner: claude-20260820-155000Z / fix/restore-art-piece-1024-1025
---

# PR #1335 — give art_piece ids 1024/1025 back to the Batman artwork

**Written:** 2026-08-20T17:50Z · **Machine:** edge-dev · **Agent:** claude
**Session:** `claude-20260820-155000Z` (orchestrator marker #1333)

**One line:** the migration is written, pushed, and passing all 12 merge-gate
checks; the ONLY thing standing between it and production is a reviewer verdict,
and the reviewer tooling failed twice today. Nothing about the SQL is in doubt.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking — nothing

**None. Do not ask Albert to approve this migration.** The one decision this work
needed — leave / renumber / delete — he already answered.

### Already settled — do NOT re-ask

| Settled | Date | Answer |
|---|---|---|
| Leave the test records (A), renumber them (B), or delete them (C)? — issue #1326 | 2026-08-20 | **B, renumber.** Answered in chat: *"#1326 - B"*. |
| Should Albert sign off on the technical risk of a migration? | standing | **No.** The owner-decision approval ritual is RETIRED for technical sign-off. Never ask him to sign off on technical risk. |
| Does moving/deleting rows need the shared-db orchestrator? | 2026-08-13 owner ruling, `AGENTS.md` §0.0-B | Data is not shared-db's job — **but this one is different and IS in scope**, see §7. Do not "helpfully" hand it back to an app team. |
| Let the stalled Grok review finish or kill it? | 2026-08-20 | Albert said *"let review-1335-restore finish"*; it was then **proved dead**, not slow (§4), and stopped on that evidence. |
| How to handle orphaned reviewer sessions? | 2026-08-20 | Albert: *"i don't know how you should handle the orphans."* Decision taken by the session: **leave them**. Deleting local records neither stops a provider turn nor refunds spend; it only destroys evidence. |

### A wrong guess is recoverable, but check with him first

- **None for this workstream.**

### Outside this workstream, and nobody is on it

1. **`plm.art_piece_attachment` still has no foreign key to any `art_piece` table**
   (issue #1327). Its rows track art pieces by number alone, so nothing at the
   database level stops them pointing at a row that does not exist or is the wrong
   one. That absent link is the reason this whole incident was possible.
   **Recommendation:** do it, as its own piece of work, after this merges.
   **Not blocking.**
2. **Reviewer tooling is unreliable and it is now costing real money and real
   hours.** Three separate defects were recorded today (§4). One of them —
   reviewing the same repository many times at once — bills in full each time.
   **Recommendation:** treat
   [`u2giants/ai-devops#56`](https://github.com/u2giants/ai-devops/issues/56)
   as a real work item for whoever owns the review tooling, not a note.
   **Not blocking this PR**, but it will block the next one the same way.
3. **Reviewer issue records are stored in a git-ignored folder**
   (`C:\repos\ai-devops\.ai\reviewer-issues\`, excluded by `.gitignore` line 61).
   They exist on `edge-dev` and nowhere else, so every one written before today is
   invisible to everyone and dies with the machine.
   **Recommendation:** have `/log-reviewer-issue` also open a GitHub issue, or
   stop treating those records as a durable report. **Not blocking.**

---

## 1. What this application is

**`u2giants/shared-db`** is the single place where the *shape* of Albert Hazan's
shared database is changed — tables, columns, views, functions, security rules.
Several separate applications read and write that one database, so if any of them
changed its shape directly they would break each other. Every structural change is
therefore written here first, as a numbered file, reviewed, rehearsed on a copy,
and only then applied to the live database.

- **Repo:** `u2giants/shared-db` (GitHub). Working copy on this machine:
  `C:\repos\shared-db`.
- **Live ("production") database:** Supabase project **`qsllyeztdwjgirsysgai`**.
- **Rehearsal ("preview") database:** Supabase project **`mvpkijzfmfcxhnzqogzs`**.
  These two are easy to confuse and getting it wrong is the worst mistake
  available here. See §7.
- **Changes are "forward-only":** files are never edited after they are applied.
  If something is wrong, a NEW file fixes it. This matters constantly — see §7.
- **The applications served include PopDAM / DesignFlow**, which is where the
  artwork records in this handoff come from.

### The specific tables involved

| Table | What it is |
|---|---|
| `dflow.art_piece` | The **live** artwork table the app writes to today. |
| `designflow.art_piece` | A **frozen copy** from an older split, 2026-07-10. Read-only leftover; nothing writes to it. |
| `plm.art_piece_attachment` | Rows linking image files to artwork **by number**, with no enforced database link. |
| `dflow.art_piece_id_seq` | The counter that hands out new artwork numbers. |

---

## 2. What we set out to do this session, and why

**In business terms:** two artwork records in the live system show *test junk*
where real Batman artwork should be, and four image links resolve to that junk.
This puts the artwork back and moves the test records out of the way, keeping
everything.

**What went wrong originally.** `dflow.art_piece` and `designflow.art_piece` were
split from a common ancestor and **the counter was never moved forward**. On
2026-07-29 the live app handed ids **1024** and **1025** to two test records:

| id | `dflow.art_piece` (live, today) | `designflow.art_piece` (frozen) |
|---|---|---|
| 1024 | `Testing Art Piece` | `Batman and Catwoman in a dynamic…` |
| 1025 | `Testing again for autocomplete` | `Batman running in a dynamic pose…` |

Four rows in `plm.art_piece_attachment` point at 1024/1025. They were captured
from the frozen copy, so they were **always meant for the Batman artwork**; today
they land on test records.

**What was already fixed earlier today.** Migration `20260820133058` pushed the
counter to **10000**, clearing every id space in play (live 1025, frozen copy 1163,
and the separate Cloud SQL system at 1465 and growing). **So this cannot happen
again.** That migration *deliberately did not* renumber the two rows that had
already collided — silently renumbering live rows from inside a schema migration
is exactly the invisible change this repository exists to prevent.

**This PR does it visibly instead**, with the owner's answer on the record.

---

## 3. Current state — what is true right now

### Done and verified

| Thing | State | Evidence |
|---|---|---|
| Migration file written | **Done** | `supabase/migrations/20260820165926_restore_art_piece_1024_1025_to_batman.sql` |
| Branch pushed | **Done** | `fix/restore-art-piece-1024-1025`, head **`e5459be24f98e8e4bacb0958a19a953c0c2d2064`** |
| PR open | **Done** | [#1335](https://github.com/u2giants/shared-db/pull/1335), state OPEN, mergeable MERGEABLE |
| Lane claim | **Held** | Issue **#1334**, lane 1, version `20260820165926`, object `table dflow.art_piece`. Lease expires `2026-08-21T04:59:22Z` — **expiry is an audit warning, not an automatic release.** |
| All merge-gate checks | **12 of 12 pass** | See the list below |
| Pre-review evidence posted | **Done** | A comment on #1335 proving the two header claims against production |
| Owner decision recorded | **Done** | #1326, answer B |

**The 12 passing checks:** Cancelled work guard · Cross-PR object collision ·
Domain ownership · Handoff contract · Intake pointer guard · Migration author lease ·
Orchestrator marker guard · PII forward guard · Promotion contract tests (offline) ·
SQL migration guards · Tools offline tests · supabase/tests against an ephemeral
database (3m28s).

The four `skipping` jobs (preview, production-dry-run, Production apply, Production
apply review) are **correct** — they only run after merge.

### Not done — this is the entire remaining blocker

**No reviewer verdict exists.** The guarded merge will not accept the PR without
one. Two attempts were made today and both failed for tooling reasons, not because
anything is wrong with the migration. Details in §4.

### Not started

- Guarded merge to `main`
- Preview rehearsal from merged main
- Production promotion
- Post-apply behavioural verification

### Environment state at time of writing

- `origin/main` = **`85c71a2`** (it moves constantly — **re-derive it, never reuse
  this value**, see §7)
- Working copy `C:\repos\shared-db` is on `fix/restore-art-piece-1024-1025`, clean
- Marker issue **#1333** is open for this session
- No reviewer processes running, no stale locks (all cleaned, §4)

---

## 4. Everything we tried that did NOT work

**Read this section before starting a review. Two failures here cost about an hour
and real money.**

### 4.1 Grok review attempt — ran 30 minutes and was dead the whole time

**What was tried:** `ai-grok-review new review-1335-restore --prompt-file
/tmp/brief-1335.md --max-turns 20`, run from an isolated clone at
`…/scratchpad/rv1335`.

**Why it seemed reasonable:** Grok is the first name in the active rotation, the
brief was complete, and the evidence packet was built correctly (base `9fb240cf`,
head `e5459be2`).

**How it failed:** it produced 261 bytes — two startup lines — and nothing else for
30 minutes. **It was hung, not thinking.** Three independent measurements agreed:

| Signal | Reading | Meaning |
|---|---|---|
| Files written after 17:22:25Z | **none**, for 30 minutes | not producing anything |
| Processor use | **0.06 seconds per minute** | not computing |
| Open network connections | **zero** | not talking to the AI service at all |

The last thing it logged: **6 of its 12 helper connections failed on startup**
(`recall-ai`, `railway`, `trigger`, `1password`, `codex-cli`, `vercel`), taking 65
seconds to time out, followed by silence. **That startup failure is the prime
suspect and is unproven.**

**Where to look yourself, next time.** This is the durable lesson — the wrapper's
own status output is not trustworthy, but the raw session files are:

```
C:\Users\ahazan\.grok\sessions\<url-encoded repo path>\<session-id>\
    events.jsonl        <- startup + provider events, timestamped
    chat_history.jsonl  <- only written when a turn COMPLETES
```

A live review keeps an open network connection and writes as it goes. Check with
`Get-NetTCPConnection -OwningProcess <pid>` and by sampling `(Get-Process -Id
<pid>).CPU` sixty seconds apart. **Zero connections plus flat processor use plus no
file writes = dead.**

**The wrapper's own 15-minute give-up timer (`AI_GROK_WAIT_TIMEOUT`, default 900
seconds) DID NOT FIRE.** It ran 30 minutes. Had it worked, this would have failed
loudly at 15 minutes and been retried. That is recorded in
[ai-devops#56](https://github.com/u2giants/ai-devops/issues/56).

### 4.2 Running reviews from isolated clones — do NOT repeat this

**What was tried:** giving each review its own fresh clone of the repository.

**Why it seemed reasonable:** issue **#1296** — two reviewers working from the same
checkout overwrite each other's evidence packet, and a reviewer was fed the wrong
commit that way. A clone per review fixes that cleanly.

**How it failed:** the wrapper's "only one review per repository at a time" lock is
keyed on the **folder path**, not the repository. A new folder gets its own lock,
so *"one review per repository"* silently became *"one review per clone"*. Five
clone identities accumulated, and Albert noticed **six concurrent Grok reviews
running**, each billed in full. The wrapper's own warning says concurrent reviews
*"were the most expensive part of the 2026-08-05 incident"* — that guard was in
place and did not fire.

**Two individually-correct guards composed into a hole.** Filed as
[ai-devops#56](https://github.com/u2giants/ai-devops/issues/56); the fix is to key
the lock on the upstream remote rather than the folder path.

**Interim rule now in force: ONE review at a time, run from the main checkout
`C:\repos\shared-db`, never from a clone.** That accepts the #1296 packet risk by
never having two reviewers running at once, which is the safe way round.

### 4.3 Killing a review locally does not stop it remotely

Two earlier runs were stopped with a local process kill. That removes the local
process; **it does not stop the provider-side turn, which keeps running and
billing**, and nothing in the tool says so. Part of ai-devops#56.

### 4.4 Aborting a review on a misleading status field — earlier today, same class

A GLM review was aborted because `ai-glm show` reported it idle. **It was working
correctly the entire time** and ~25 minutes of correct work was destroyed. Root
cause: the "last activity" timestamp could not move during a turn. Fixed in
ai-devops commit `12b0f0e` (shared-db #1298).

**The two lessons pull in opposite directions and both are real:** never abort on a
wrapper's own status field (4.4), *and* do not assume silence means progress (4.1).
**The resolution is to look at the raw evidence** — session files, processor use,
network connections — which distinguishes the two cases cleanly. That is the
standing rule in this repo: *read the raw provider stream, never the wrapper's
summary.*

### 4.5 Header prose can be mistaken for a machine instruction — already avoided here

Earlier today a migration was refused because ordinary explanatory prose in the
header contained the phrase `catalog-verification: no-op`, which the checker read
as a real declaration. **Line 1 of this migration is a deliberate, real declaration
and the guard has already accepted it.** Do not reword line 1.

---

## 5. Root causes and key findings

### 5.1 The root cause of the incident

The counter (`dflow.art_piece_id_seq`) was never advanced when the two schemas were
split, so the live app re-issued ids that already meant something else in the frozen
copy. **Already fixed** by `20260820133058` (counter set to 10000). This PR repairs
the two rows that collided before that fix landed.

### 5.2 The finding that shaped the migration — `art_number` encodes the id

**`art_number` is not free text.** Measured on production across **all 1,114 rows**
of `dflow.art_piece`:

```
total 1114 | null art_number 0 | rows whose suffix does not match the id: 0
```

Format: `PDCBM-01023` for id 1023 — the last five digits are the id, zero-padded.
**A strict invariant today, with zero exceptions.**

So renumbering a row **without** correcting its `art_number` would break an
invariant that currently holds universally, and would do so silently. The migration
therefore rewrites only the trailing `-<digits>` and preserves the prefix, which
appears to carry licensor/property meaning.

**Proved safe before writing it:** a round-trip test of the exact regex against all
1,114 existing values — **1,114 round-trip exactly, 0 would be corrupted.** 88
prefixes contain digits (so a careless pattern could have eaten them) and **0
contain hyphens**, which is why anchoring on the final `-<digits>` is safe.

**The incoming rows need no treatment:** their numbers are already `PDCBM-01024`
and `PDCBM-01025`, which satisfy the invariant at their restored ids. **The
artwork's own numbering is independent evidence that these ids were always its.**

### 5.3 Preconditions, all measured on production before authoring

| Check | Result | Why it matters |
|---|---|---|
| `dflow.art_piece_attachment` rows pointing at 1024/1025 | **0** | The main risk. Renumbering cannot orphan a live attachment. |
| `plm.art_piece_attachment` link to `art_piece` | **none exists** | Why its 4 rows follow the numbers and will land on the artwork |
| `PDCBM-01024` / `PDCBM-01025` already in `dflow` | **0** | No clash with the uniqueness rule `art_piece_art_number_key` |
| ids 10001 / 10002 in use | **0** | And new ids come from the counter anyway, not hard-coded |
| `art_piece_attachment_art_piece_id_fkey` | **ON UPDATE NO ACTION** | Relevant to the *other* attachment table; confirms nothing cascades |

### 5.4 Three design points a reviewer should check deliberately

Referring to `supabase/migrations/20260820165926_restore_art_piece_1024_1025_to_batman.sql`:

1. **`MATERIALIZED` on the CTE is load-bearing** (line 72). `nextval` is volatile;
   an inlined CTE could evaluate it more than once per row. Materialising pins each
   row to exactly one new id. **Removing that keyword is a real bug.**
2. **New ids come from `nextval`, not hard-coded** (line 75), so the counter hands
   them out and no future insert can collide with them.
3. **Order is enforced by statement order** (lines 72–83 then 88–101). The test
   records must vacate 1024/1025 before the artwork can occupy them, or the insert
   breaks the primary key. Both statements run in one transaction per file, so a
   failure at either point leaves the table exactly as it was.

Also: every column is named on **both** sides of the insert, in the same order, so
a physical column-order difference between the two tables cannot transpose values,
and a name error is a loud `undefined column` rather than silent corruption.

### 5.5 What the day proved about the wider job

Six migrations reached production today, each verified by reading production's own
migration list inside the apply run plus a behavioural read. After the 133-row
backfill (`20260820145950`): `plm.art_piece_attachment` stranded rows went **266 →
0**, resolving **2,276**; `dflow.art_piece` went 981 → 1,114 rows.

---

## 6. Exact next steps

Do these in order. **Do not skip step 1** — everything else depends on it.

### Step 1 — get one reviewer verdict on head `e5459be2`

Run **from the main checkout, not a clone** (§4.2):

```bash
bash /c/repos/ai-devops/bin/ai-grok-review new review-1335-restore-2 --prompt-file /tmp/brief-1335.md --max-turns 20
```

If `/tmp/brief-1335.md` is gone, rebuild it from the PR body of #1335 plus §5.4
above. The brief must ask for a coverage statement and a final line reading exactly
`VERDICT: APPROVE` or `VERDICT: REVISE`.

**Active reviewers, in rotation order:** `grok-4.6` (`ai-grok-review`), `glm-5.3`
(`ai-glm`), `muse-spark-1.2-contributor` (`ai-muse`). Retired, do not use:
`qwen-3.8-max`, `glm-5.2`, `kimi-k3`. **Never delete a name from the `REVIEWERS`
list in `scripts/manage-migration-author-lanes.mjs`** — one lookup there is not
guarded against a missing name. Pause by adding to `RETIRED_REVIEWERS` instead.

**Watch it properly.** Check at 3 minutes, not 30. Dead if all three hold: no file
written under the session folder, processor use flat, zero open network
connections (§4.1).

**If Grok stalls again, switch to `ai-glm` rather than retrying Grok** — Grok has
failed twice on this exact head today, and the tool now skips a provider that
already failed on the same head (#1297).

**You'll know it worked when:** the output contains a coverage statement naming how
much of the migration was read, and a final `VERDICT:` line. **Never accept a bare
verdict with no coverage statement**, and if the output looks truncated, read the
raw session files before recording anything (§4.1).

### Step 2 — record the review evidence and run the guarded merge

Record the verdict against claim **#1334** in the normal way, then merge via the
guarded merge lane (`.github/workflows/guarded-migration-merge.yml`).

**Before merging, re-derive `origin/main`** — `git fetch origin && git rev-parse
origin/main`. It was `85c71a2` at 17:50Z and **moves constantly**.

**Merge order matters:** PRs merge in ascending migration-version order, or a
governed supersession is paid per PR. This version is `20260820165926`. **Check
whether any lower-numbered migration PR opened while this was waiting** — if one
did, it merges first.

**You'll know it worked when:** the PR shows merged, and the merge commit is on
`origin/main`.

### Step 3 — preview rehearsal from merged main

Rehearse the migration against preview **`mvpkijzfmfcxhnzqogzs`** — *not*
production. Re-derive `origin/main` again as the input; the rehearsal must run from
the merged state, not the branch.

**You'll know it worked when:** the rehearsal run succeeds and you have its run id
and digest, which the production gate requires.

### Step 4 — promote to production

The business-risk gate needs all of: review run id + digest, source PR, preview run
id + digest. It derives risk twice, before approval and after the wait.

**You'll know it worked when:** the apply run's own reading of production's
migration list shows `20260820165926` present.

### Step 5 — verify the actual outcome, not just that it ran

Read against production `qsllyeztdwjgirsysgai` and confirm all four:

1. `dflow.art_piece` id 1024 reads `Batman and Catwoman in a dynamic…`, id 1025
   reads `Batman running in a dynamic pose…`
2. Those two rows carry `art_number` `PDCBM-01024` and `PDCBM-01025`
3. The two test records exist at new ids (expected 10001 and 10002) with matching
   corrected `art_number` suffixes — **nothing was deleted**
4. Row count is unchanged: **1,114 + 2 = 1,116**

**You'll know it worked when** all four hold. If row count is 1,114, the insert
silently did nothing (`on conflict do nothing`) and the artwork was NOT restored —
investigate rather than declaring success.

### Step 6 — close out

- Release the lane claim and close **#1334**
- Close **#1326** (the owner question, now executed)
- **Delete this handoff file** in the same commit — a finished workstream's file is
  deleted, never marked done
- Close marker **#1333** if no other work is outstanding
- Report to Albert with evidence: PR URL, merge SHA, apply run link, and the
  four readings from step 5

---

## 7. Constraints and gotchas in force

### Absolute

1. **Prove which database you are pointed at immediately before EVERY write, and
   quote the proof.** Preview is `mvpkijzfmfcxhnzqogzs`; production is
   `qsllyeztdwjgirsysgai`. They are easy to confuse. This is not optional.
2. **Forward-only.** Never edit an applied migration. A new file fixes a mistake.
3. **To answer "what does the database do right now", read the CURRENT definition
   across ALL migrations plus the production ledger** — never the migration that
   first created the object. Reading the creating migration gives an answer that
   was true months ago.
4. **`origin/main` moves constantly.** Re-derive it immediately before every
   dispatch, rehearsal and promotion input. Never reuse a SHA from a document —
   including `85c71a2` in this one.
5. **Merge PRs in ascending migration-version order**, or pay a governed
   supersession per PR.
6. **A verify block inside a migration is production code.** Assert shape from the
   catalogue; count rows only inside your own tables.
7. **Never accept a bare verdict as review evidence.** Require a coverage
   statement. If output looks truncated, read the raw provider stream first.
8. **The owner-decision approval ritual is RETIRED for technical sign-off.** Never
   ask Albert to sign off on technical risk.
9. **`COORDINATOR_INTAKE.md` stays retired and unwritten.**
10. **Never delete a name from `REVIEWERS`** (§6 step 1).

### Why this data change is legitimately shared-db work

The standing rule is that **data belongs to the application session, not to
shared-db** (owner ruling 2026-08-13, `AGENTS.md` §0.0-B) — and asking to queue a
row cleanup with the orchestrator is itself the mistake.

**This one is different and stays here** because it is the direct repair of damage
caused by a *structural* defect (an un-advanced counter), it is the completion of
`20260820133058` which explicitly deferred it, it changes primary keys rather than
ordinary field values, and it was authored under a lane claim on `table
dflow.art_piece`. **Do not hand this back to an app team**, and do not use it as
precedent for routine row edits.

### Specific traps in this migration

- **Do not reword line 1.** It is a real `catalog-verification: no-op` declaration
  that the guard has accepted. The guard re-reads the declaration and ANY `do $`
  block, schema change or grant in the file disqualifies it — both statements here
  are plain data statements, which is why it holds.
- **Do not remove `MATERIALIZED`** (§5.4).
- **Do not reorder the two statements** (§5.4).
- **`on conflict (id) do nothing` means a wrong outcome can look like success.**
  Step 5's row count is what catches that.

---

## 8. Access and environment

- **Working copy:** `C:\repos\shared-db` on `edge-dev` (Windows). Branch
  `fix/restore-art-piece-1024-1025`.
- **Review wrappers:** `C:\repos\ai-devops\bin\` — `ai-grok-review`, `ai-glm`,
  `ai-muse`. Reviews are read-only; editing and shell access are denied to them.
- **Authenticated CLIs on this machine:** `gh`, `gcloud`, `az`, `supabase`,
  `vercel`, `op`. **Verify with a real call before claiming any capability is
  missing.**
- **Commit identity — check before your first commit:** `git var
  GIT_COMMITTER_IDENT` must show `Albert Hazan
  <u2giants@users.noreply.github.com>`. Any other address fails GitHub's
  email-privacy check. Fix with `bin/ai-git-identity` BEFORE committing.
- **Reading the shared database is allowed from anywhere**, with no issue and no
  permission. Only *structural changes* go through this repo.
- **Connection facts that cost time to learn:**
  - Production direct host `db.<ref>.supabase.co` is IPv6-only and **fails** here.
    Use the pooler: `aws-1-us-east-1.pooler.supabase.com:6543`, user
    `postgres.qsllyeztdwjgirsysgai`.
  - **The preview pooler tenant does not resolve at all.** Use the Supabase
    Management API query endpoint with the personal access token instead.
  - The Supabase MCP is **read-only**; applying changes goes through the GitHub
    workflow or the Management API query endpoint.
  - **The preview ledger is unreliable** — do not treat it as proof of state.
- **Cloud SQL (a separate, unrelated database) read-only:** 1Password item
  `tcaf3o3u2cx52g6ivvczxbhola`, user `albert_read_only`, `104.198.220.200:5432`.
- **Secrets:** 1Password, vault `vibe_coding` only. **Serialize all 1Password
  reads — never run them in parallel.** Never paste secret values into files,
  commits or documents.

---

## 9. Open questions and risks

### Risks in this change

| Risk | Assessment | Why |
|---|---|---|
| Renumbering orphans a live image link | **Very low** | Measured: 0 rows in `dflow.art_piece_attachment` point at 1024/1025 |
| The number rewrite corrupts a value | **Very low** | Round-trip tested against all 1,114 rows: 0 would be corrupted (§5.2) |
| Partial application leaves a broken state | **Very low** | Both statements run in one transaction per file |
| The insert silently does nothing | **Real, and detectable** | `on conflict do nothing` hides it; step 5's row count catches it |
| Production has no point-in-time recovery | **Real, and unchanged by this** | `pitr_enabled: false` measured today. There is no rewind button on this database — a wrong write is repaired forward, by another migration. |

### Open questions

1. **Why did the Grok review stall?** Unproven. The 65-second startup failure of 6
   of 12 helper connections is the prime suspect and has not been confirmed.
   Recorded in ai-devops#56.
2. **Are there orphaned provider-side reviews still billing?** Unknown and
   unknowable from this machine — killing the local process does not stop the
   remote turn, and nothing reports it. Decision taken: leave them, since deleting
   local records changes nothing except destroying evidence (§0).
3. **What does the `art_number` prefix actually mean?** It looks like a
   licensor/property code (`PDCBM`). Deliberately preserved and never parsed, since
   nothing here needs to know. Worth documenting if anyone ever finds out.

### Decisions taken this session, dated, so a later session cannot unknowingly contradict them

- **2026-08-20 — Renumber rather than delete or leave** (Albert, answering #1326
  with B).
- **2026-08-20 — Correct `art_number` when renumbering**, because it encodes the
  id and the invariant currently holds with zero exceptions (§5.2). Session
  decision, evidence-backed.
- **2026-08-20 — Allocate new ids with `nextval`, not hard-coded 10001/10002**, so
  no future insert can collide.
- **2026-08-20 — One review at a time, from the main checkout, no per-review
  clones**, until ai-devops#56 is fixed (§4.2).
- **2026-08-20 — Leave orphaned reviewer sessions in place** rather than clean them
  up, to preserve evidence (§0).
- **2026-08-20 — This data change stays in shared-db** despite the general
  data-belongs-to-the-app rule (§7).

---

## Self-audit (run before this file was shown)

1. **Could a brand-new developer pick this up without skipping a beat?** Yes. §1
   explains the app and the tables from zero. §2 gives the incident. §3 states
   exactly what exists and what does not. §6 is executable without judgement
   calls. §8 covers access and the connection traps.
2. **Could they continue as effectively as this session can right now?** Yes. The
   non-obvious knowledge is all written down: the `art_number` invariant and its
   round-trip proof (§5.2), the three load-bearing design points (§5.4), how to
   tell a dead review from a live one using raw evidence (§4.1), and why clones
   must not be used (§4.2).
3. **Is every relevant detail present?** Yes — background §1–2, state §3, dead ends
   §4, findings §5, next steps with verification gates §6, constraints §7, access
   §8, risks and dated decisions §9. Commit, push and merge status are explicit in
   §3; secrets appear as vault and item references only, never values.
4. **If Albert read ONLY section 0, would he see every decision needed from him,
   including out-of-scope ones?** Yes, and this was checked by walking §1–§9 line
   by line rather than from memory. Nothing in this workstream blocks on him — the
   one decision it needed is answered and is listed under "already settled" so it
   is not re-asked. The three items that DO need his judgement are all outside this
   workstream (the missing database link #1327, the reviewer tooling in
   ai-devops#56, and reviewer records being stored where nobody can see them), and
   each is promoted into §0 with a recommendation. Those are exactly the category
   that historically never gets raised.
