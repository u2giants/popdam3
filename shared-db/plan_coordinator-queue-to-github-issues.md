# Implementation plan — replace `COORDINATOR_INTAKE.md` with GitHub Issues

**File:** `plan_coordinator-queue-to-github-issues.md` · **Repo:** `u2giants/shared-db` · **Created:** 2026-08-07
**Owner decision this plan rests on:** **2026-08-07 — Albert chose PUBLIC Issues** in `u2giants/shared-db`, having been told the queue contains licensor names, customer data problems and internal incident write-ups, and having been offered a private repo as the alternative. **Do not re-open that decision.** What is still owed to him is the scrub report at step 3 — that is a different question (*what specifically gets published*), not the same one.

---

## STATUS — read this first

| # | Step | Phase | State | Date |
|---|---|---|---|---|
| 1 | Inventory the queue: classify every block OPEN / HISTORY / NOISE | A | ⬜ open | — |
| 2 | Design and create the label set; decide the issue template | A | ⬜ open | — |
| 3 | **The scrub gate — find everything that must not be published, and show Albert** | A | ⬜ open | — |
| 4 | **STOP. Albert's explicit go/no-go on the scrub report** | A | ⬜ open | — |
| 5 | Create one issue per OPEN item (scripted, idempotent, dry-run first) | B | ⬜ open | — |
| 6 | Reduce `COORDINATOR_INTAKE.md` to a pointer; history stays in git | B | ⬜ open | — |
| 7 | **Remove `Backlog / queue sync` from branch protection, THEN delete the workflow** | B | ⬜ open | — |
| 8 | Rewrite the request/handover path in `AGENTS.md` and the two skills | C | ⬜ open | — |
| 9 | Retire the B2 lifecycle and retention rules that Issues now do for free | C | ⬜ open | — |

**A fresh session starts at Step 1.** Steps 1–4 are all reversible and publish nothing. **Step 5 is the first irreversible action in this plan** and is gated on step 4.

---

## 1. The goal — what we are actually trying to achieve

**In plain business English:** the coordinator queue is a 3,837-line text file that several AI sessions edit at once. It is a hand-built imitation of an issue tracker. GitHub already gives us a real one, free, that we are not using. Move the work items there so each one is a single thing with an owner and a status, visible on a phone, impossible for two sessions to overwrite.

**What we are NOT trying to do:** tidy the file, or write more rules about how to keep it tidy. Every previous attempt did that, and the file grew anyway. Two mandatory rules currently **deadlock** — a retention rule requires archiving blocks that a CI check requires stay — which is the clearest possible evidence that the file cannot be fixed by more process.

> **If a step in this plan conflicts with that goal, THE GOAL WINS — stop and flag it.** Specifically: if a step would end with us maintaining *both* the file and Issues, do not do it. Two tracking systems is strictly worse than the one bad system we have now, because then "which is right?" becomes a real question instead of a rhetorical one.

---

## 2. What this replaces, measured

`COORDINATOR_INTAKE.md`, **3,837 lines**, measured 2026-08-07 on `main` @ `ffb9b97`:

| Section | `###` blocks | What it is | Migrates? |
|---|---|---|---|
| `REQUEST QUEUE` | 67 | Work somebody needs done | **Yes — the open ones** |
| `IN PROGRESS` | 1 | Dispatched, live | **Yes** |
| `WAITING ON OTHER PEOPLE` | 0 | Blocked externally | Yes (empty today) |
| `COMPLETED` | 12 | Done | **No — git history is the archive** |
| `INTAKE QUEUE` | 5 | Handed over by a stopped session | **Yes** |
| `TAKEN OVER` | 6 | Ingested handovers | **No — history** |
| Parts 0, A, B, B2 + standing facts | ~650 lines of prose | Instructions, templates, lifecycle rules | **No — mostly deleted, see steps 8–9** |

⚠️ **The 67 is a headline count, not an item count.** Sampling shows the section also holds `CLOSING NOTE` blocks, `SUPPLEMENT` blocks that amend a request further down, and requests already resolved but never moved. **Step 1 exists precisely to turn 67 headings into a real number.** Do not promise Albert "67 issues" before step 1 is done.

### The four problems this deletes

1. **The retention rule** (B2.2) — Issues do not need one; closed is closed.
2. **The lifecycle rules** (B2, ~160 lines of when a block moves between six sections) — an issue is open or closed, with labels.
3. **The broken CI check** — `scripts/check-backlog-queue-sync.mjs` is a **required** status check that **reports a pass when it should fail** (verified in the live code 2026-08-07). It exists only to police this file. Step 7 deletes it.
4. **"Which document is right?"** — the file itself carries a rule saying no document wins by name or date and that facts must be re-derived from `git`/`gh`. That rule is an admission the file is not trustworthy.

---

## 3. Scope — in and out

### In scope
The queue file, its CI check, and the three places that tell a session how to file a request: `AGENTS.md`, `skills/claude/shared-db-orchestrator/SKILL.md` and `skills/claude/shared-db-handover/SKILL.md` (both in `u2giants/ai-devops`, a **different repo**).

### Explicitly NOT in scope

1. **The safety rules in `AGENTS.md`.** Preview before production, never reuse a migration timestamp, add rather than rename, prove your database target. **These are not bureaucracy — each one exists because it already prevented real data loss, and the timestamp rule caught a genuine bug twice.** Do not touch them. They are the reason this plan is safe to run.
2. **`HANDOFF.d/` and the handoff standard.** A handoff is a 10-page briefing document for the next worker; an issue is a unit of work. Pasting the first into the second gives an unreadable issue and a worse handoff. Handoffs stay as files. *(Decided 2026-08-07.)*
3. **The `## BACKLOG` items B1–B14** in root `HANDOFF.md`. Several queue blocks reference them by number. See risk R3 — they need a decision, not a silent migration.
4. **Answering the decisions the queue is currently holding.** Six are waiting on Albert. Migrating them is this plan; answering them is his.
5. **Any database contact.** Nothing here needs it.

---

## 4. Approaches considered and REJECTED

**R1 — Keep the file and fix its rules.** This is what every previous session did. The file went 0 → 68 items in six days and **never once shrank**; two of its rules now deadlock. The file is not failing for want of a better rule.

**R2 — A private repo for the Issues, `shared-db` staying public for code.** My recommendation, and **Albert chose public instead on 2026-08-07.** Recorded so nobody re-litigates it. The residual privacy risk is handled by the scrub at step 3, not by reversing the decision.

**R3 — Migrate everything, including `COMPLETED` and `TAKEN OVER`.** Rejected. Creating 18 issues just to close them immediately publishes internal history for no operational benefit. Git history already holds every word, and the file's own commits are the archive.

**R4 — Migrate by hand, block by block.** Rejected. ~70 blocks, each needing consistent labels and a body; a human-driven pass will be inconsistent by item 20, and it cannot be re-run after a mistake. Step 5 is a script with a dry-run mode and idempotency, so a bad run can be corrected rather than cleaned up by hand.

**R5 — Delete the CI workflow first, then remove it from branch protection.** Rejected, and this ordering is a real trap: `Backlog / queue sync` is a **required status context**. Delete the workflow while it is still required and **every future PR hangs forever** waiting for a check that will never report. **Protection first, workflow second.** This is the same class of trap as renaming the `Cross-PR object collision` job.

---

## 5. The plan — ordered, executable steps

### Step 1 — Inventory: classify every block

**What to do.** Parse `COORDINATOR_INTAKE.md` into blocks by `### ` heading. For each, record: which section it is in, its title, its date, its requesting session, whether it is a real request or a `CLOSING NOTE` / `SUPPLEMENT` / already-resolved leftover, and whether it references a `B<n>` backlog item.

Then, for each block in `REQUEST QUEUE`, `IN PROGRESS` and `INTAKE QUEUE`, **verify against the repo whether it is actually still open** — the same method the 2026-08-07 handoff audit used. Several are known to be landed-but-unmoved; PR #463 already retired five that way.

**Verification gate.** A table under `docs/verification/` with one row per block: heading, section, verdict (OPEN / ALREADY DONE / NOISE / SUPPLEMENT-OF-#n), and the evidence for anything marked done. **This artefact is what makes step 5 auditable** — without it, nobody can later tell whether an item was migrated, merged into another, or dropped.

### Step 2 — Labels and the issue shape

**Labels** (create with `gh label create`; naming kept boring on purpose):

| Label | Meaning |
|---|---|
| `db-request` | work somebody needs done |
| `db-handover` | work a stopped session handed over |
| `needs-albert` | ⛔ blocked on an owner decision |
| `blocked` | blocked on something else |
| `coordinator-marker` | already exists; leave it alone |
| `db-claim` | already exists; leave it alone |

**Status is open/closed plus labels. Do not build a status label set** — that is the six-section lifecycle again, in a new costume.

**Ownership** is the GitHub assignee, or a line in the body naming the session, since AI sessions have no GitHub account.

**Body:** the original block text, verbatim, under a one-line header naming the source file, section, and the commit it was read from. **Verbatim matters** — a summarised block loses the reasoning, and the reasoning is the only reason some of these blocks are worth keeping.

### Step 3 — THE SCRUB GATE

**Do not skip this and do not do it by eye.** Publishing is one-way: once an issue exists, it can be indexed and cached even if deleted afterwards.

Scan every block that step 1 marked OPEN for:

- credentials, tokens, connection strings, 1Password item IDs or field names
- database hostnames, project refs, internal URLs
- personal data, and named individuals outside the company
- customer and licensor commercial detail (the licensor/property blocks are the highest-risk group)
- anything describing a live unfixed security or data-integrity weakness — publishing a working description of an unfixed hole is different from publishing a resolved one

For each hit: quote it, name the block, and propose one of **redact** / **move to a private note** / **publish as-is**.

**Verification gate.** A written scrub report. It must state the number of blocks scanned, the number with hits, and a proposal for each hit. **Nothing is published before Albert has read it.**

### Step 4 — STOP: Albert's go/no-go

Present the scrub report in plain English: how many issues will be created, what they contain, what has been redacted, and the one-way nature of publishing. **Wait for an explicit yes.** He has already chosen public Issues in principle; this is the confirmation of *what specifically goes out*, which he has not yet seen.

### Step 5 — Create the issues (first irreversible step)

A script, `tools/migrate-intake-to-issues.mjs`, that:

1. Reads the step-1 inventory, not the raw file.
2. Has a **`--dry-run` default** that prints each issue it would create and creates nothing.
3. Is **idempotent**: before creating, searches for an existing open issue with the same title; skips if found. A half-finished run must be safely re-runnable.
4. Uses `gh issue create --body-file` (never a heredoc — this is a PowerShell-first machine and heredoc recipes have silently failed here before).
5. Writes a mapping file: block heading → issue number. **This is what step 6 needs**, and what proves nothing was lost.
6. **Fails loudly and stops on the first error.** A partial migration that reports success is the worst outcome available.

**Verification gate.** Issue count equals the OPEN count from step 1, the mapping file has no blanks, and spot-checking three issues shows the body matches the source block verbatim.

### Step 6 — Reduce the file to a pointer

Replace the entire contents of `COORDINATOR_INTAKE.md` with a short pointer, the same pattern root `HANDOFF.md` uses: what the file used to be, where the work lives now, the `gh issue list` command to see it, and the commit SHA where the full history can be read. **Do not keep a "recently completed" section.** Git history is the archive.

**Verification gate.** The file is under ~40 lines; `git log` still shows the full text at the prior SHA.

### Step 7 — Retire the broken CI check, in this order

1. **First** remove `Backlog / queue sync` from `required_status_checks.contexts` on `main`.
2. **Confirm** the context is gone (`gh api repos/u2giants/shared-db/branches/main/protection`).
3. **Then** delete the workflow, `scripts/check-backlog-queue-sync.mjs` and its tests.

**Reversing this order hangs every future PR forever** (R5).

**Verification gate.** Protection lists five contexts, and a throwaway PR reaches mergeable state.

### Step 8 — Rewrite the request path

`AGENTS.md`, plus `shared-db-orchestrator` and `shared-db-handover` in `u2giants/ai-devops` (main-only, push directly, no PR). The instruction becomes: **open an issue** with the right label, not "edit a section of a 3,837-line file." Delete the copy-paste templates the file carried; `gh issue create` needs no template.

⚠️ After editing skills in `ai-devops`, install them locally. **`bin/ai-install-skills` does not run on Windows** (CRLF vs `set -o pipefail`) — copy the file and verify with `Get-FileHash` that hub and local match.

**Verification gate.** No document tells anyone to edit `COORDINATOR_INTAKE.md`, and both skill copies hash-match the hub.

### Step 9 — Delete the rules that Issues now do for free

Remove the B2 lifecycle, the B2.2 retention rule, and the six-section model from every document that restates them. **This step is the point of the whole plan.** Skipping it leaves the rules in force with nothing to govern, and a future session will faithfully obey them and rebuild the file.

**Verification gate.** Searching the repo for `INTAKE QUEUE`, `TAKEN OVER` and `B2.2` returns only the pointer file and historical handoffs.

### ⚠️ Required at the END of each phase
Re-read every remaining step and record any **drift** — anything you did or learned that changes a later step's assumptions — into this file before handing over. If nothing drifted, write "no drift" in the STATUS table. **Silence is not information.**

---

## 6. Constraints and gotchas in force

1. **Branch + PR, and you merge it yourself.** Never commit to `main` directly. Specific to `shared-db`.
2. **Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.** Check `git var GIT_COMMITTER_IDENT` before the first commit.
3. **Branch protection: `strict: true`, six required contexts (five after step 7), `enforce_admins: true`.** Your branch must be up to date before merging, and `main` moves often — expect to run `gh pr update-branch`.
4. **`shared-db` is PUBLIC.** Step 5 is the first action in this plan that publishes anything, and it is gated on step 4.
5. **You may be sharing this checkout with other live sessions.** Before opening a PR, run `git diff origin/main --stat` and confirm it lists only your files. Never `git add -A`.
6. **Do not delete `.ai/deepseek-sessions/` or `.ai/reviews/`** — untracked, not yours.
7. **No band-aids, no silent failures.** Every fallback must be loud. This is why step 5 stops on the first error.
8. **Never rename or delete a required CI job without removing it from protection first** (R5).
9. **Windows line endings:** `.mjs` and `.md` edits show a `LF will be replaced by CRLF` warning. Harmless; do not "fix" it, and do not reformat whole files.

---

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| **Something confidential is published, and publishing is one-way** | Steps 3 and 4: a written scrub report and an explicit owner go/no-go before the first issue is created |
| **A half-finished migration leaves work in two places** | Step 5 is idempotent, dry-run by default, and stops loudly on the first error; the mapping file proves completeness |
| **The file is emptied but the rules survive, so a future session rebuilds it** | Step 9, and it is stated as the point of the plan rather than as cleanup |
| **Deleting the workflow before de-listing the required context hangs every PR** | R5 and step 7's explicit ordering |
| **Issue sprawl replaces file sprawl** | Only OPEN items migrate (R3); no status-label lifecycle (step 2) |

### Open questions

1. **The `B1`–`B14` backlog** lives in root `HANDOFF.md` and several queue blocks reference it by number. Migrate those to issues too, leave them, or convert them? **Decide during step 1, before any issue is created**, or the references break.
2. **Assignees.** AI sessions have no GitHub account. Naming the session in the body is the fallback; confirm that is enough to answer "who is on this?"
3. **The six decisions currently waiting on Albert** become `needs-albert` issues. Worth asking whether he wants them as one issue or six — six is more actionable, one is less noisy on a phone.

---

## 8. Definition of done

- [ ] Steps 1–9 complete, or explicitly deferred with the reason in the STATUS table
- [ ] Every OPEN block exists as an issue, proven by the mapping file
- [ ] `COORDINATOR_INTAKE.md` is a pointer under ~40 lines
- [ ] `Backlog / queue sync` is gone from protection **and** the workflow is deleted, in that order
- [ ] No document instructs anyone to edit the queue file
- [ ] The `AGENTS.md` safety rules are **untouched** — verified by diff
- [ ] Committed, pushed, PR merged by you, checks green
- [ ] STATUS table dated, drift recorded, and a `HANDOFF.d/` file written
