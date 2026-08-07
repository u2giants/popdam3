# Implementation plan — replace `COORDINATOR_INTAKE.md` with GitHub Issues

**File:** `plan_coordinator-queue-to-github-issues.md` · **Repo:** `u2giants/shared-db` · **Created:** 2026-08-07
**Revised:** 2026-08-07 after an adversarial review by **GLM 5.2** (3 rounds, session `intake-queue-to-issues-plan`; reports under `.ai/reviews/glm-intake-queue-to-issues-plan-*.md`). **Two steps changed direction as a result. Do not restore the earlier shape of step 7 or step 3 — both were reviewed and found wrong.** What changed and why is in §8.

**Owner decision this plan rests on:** **2026-08-07 — Albert chose PUBLIC Issues**, having been told the queue contains licensor names, customer data problems and internal incident write-ups, and having been offered a private repo instead. **Do not re-open that decision.** Two things are still owed to him and are named as blocking gates below: the **scrub report** (step 4) and the **branch-protection instruction** (step 7a).

---

## STATUS — read this first

| # | Step | Phase | State | Date |
|---|---|---|---|---|
| 1 | Inventory: classify every block, with an arithmetic completeness cross-check | A | ⬜ open | — |
| 2 | Build the **scrub tool**; run it; write the scrub report | A | ⬜ open | — |
| 3 | Labels and the issue shape (one label, pointer model for handovers) | A | ⬜ open | — |
| 4 | **OWNER GATE — Albert's go/no-go on the scrub report** | A | ⬜ open | — |
| 4b | **Rotate the plaintext-emailed Cloud SQL credential BEFORE any publish** | A | ⬜ open | — |
| 5 | Update the skills in `ai-devops` and propagate them to every machine | B | ⬜ open | — |
| 6 | Create one issue per **work item** (scripted, dry-run default, idempotent) | B | ⬜ open | — |
| 7a | **OWNER GATE — Albert names `Backlog / queue sync` for removal from protection** | B | ⬜ open | — |
| 7b | Remove the required context, confirm, **then** delete the workflow and script | B | ⬜ open | — |
| 8 | Reduce `COORDINATOR_INTAKE.md` to a pointer | B | ⬜ open | — |
| 9 | Rewrite `HANDOFF.md` B10 and B13; delete the B2 lifecycle and retention rules | C | ⬜ open | — |

**A fresh session starts at Step 1.** Steps 1–3 publish nothing and are fully reversible.
**Step 6 is the first irreversible action in this plan.** It is gated on steps 4 and 4b.
**Step 5 comes BEFORE step 8, deliberately** — see the trap in §5.

---

## 1. The goal

**In plain business English:** the coordinator queue is a 3,837-line text file that several AI sessions edit at once. It is a hand-built imitation of an issue tracker. GitHub already gives us a real one, free. Move the work items there so each is a single thing with an owner and a status, visible on a phone, impossible for two sessions to overwrite.

**What we are NOT doing:** tidying the file, or writing more rules about keeping it tidy. Every previous attempt did that and it grew anyway.

> **If a step conflicts with that goal, THE GOAL WINS — stop and flag it.** Specifically: if a step would leave us maintaining *both* the file and Issues, do not do it. Two tracking systems is strictly worse than the one bad system we have, because "which is right?" stops being rhetorical.

---

## 2. What this replaces, measured

`COORDINATOR_INTAKE.md`, **3,837 lines**, measured on `main` @ `ffb9b97`:

| Section | `###` blocks | Migrates? |
|---|---|---|
| `REQUEST QUEUE` | 67 | **Yes — the open ones** |
| `IN PROGRESS` | 1 | **Yes** |
| `WAITING ON OTHER PEOPLE` | 0 | Yes (empty today) |
| `COMPLETED` | 12 | No — history |
| `INTAKE QUEUE` | 5 | **Yes, as pointers** (§4 D3) |
| `TAKEN OVER` | 6 | No — history |
| Parts 0, A, B, B2 + standing facts | ~650 lines | No — deleted at step 9 |

⚠️ **67 is a heading count, not an item count.** The section also holds `CLOSING NOTE` blocks, `SUPPLEMENT` blocks amending a request further down, and requests resolved but never moved. **Step 1 turns 67 headings into a real number. Do not promise Albert "67 issues".**

⚠️ **One work item can span several blocks.** The Disney OPA item spans **four**: `COORDINATOR_INTAKE.md:682` (CLOSING NOTE), `:776` (SUPPLEMENT), `:821` (REQUEST) and `:2946` (IN PROGRESS). "One issue per block" would produce four issues for one thing — the sprawl this plan claims to prevent. *(Found by GLM.)*

### Evidence the rules model has failed

- `docs/intake-archive/` **does not exist**, so the B2.2 retention rule has **never once fired**. The file has grown monotonically, 0 → 68 in six days.
- Two mandatory rules deadlock: retention requires archiving blocks that the CI check requires stay present.
- The file itself instructs readers that no document wins by name or date and that facts must be re-derived from `git`/`gh` — an admission that it is not trustworthy.

---

## 3. Scope — in and out

### In scope
The queue file, its CI check, and the three places that tell a session how to file a request: `AGENTS.md`, and `shared-db-orchestrator` / `shared-db-handover` in `u2giants/ai-devops` (a **different repo**).

### Explicitly NOT in scope

1. **The safety rules in `AGENTS.md`.** Preview before production, never reuse a migration timestamp, add rather than rename, prove your database target. **Each exists because it already prevented real data loss, and the timestamp rule caught a genuine bug twice.** Untouched, and the definition of done verifies that by diff.
2. **`HANDOFF.d/` and the handoff standard.** Handoffs stay as files. See D3 for how handovers are tracked without becoming issues.
3. **Answering the decisions the queue is holding.** Six are waiting on Albert. Migrating them is this plan; answering them is his.
4. **Any database contact.** Nothing here needs it. *(Exception: step 4b is a credential rotation, which is an owner-approved security action, not schema work.)*

---

## 4. Design decisions

| # | Decision | Status | Reasoning |
|---|---|---|---|
| D1 | Public Issues in `u2giants/shared-db` | **LOCKED** | Albert, 2026-08-07, after being offered a private repo |
| D2 | Only OPEN items migrate; `COMPLETED`/`TAKEN OVER` stay in git history | **LOCKED** | Publishing 18 items purely to close them exposes internal history for no benefit |
| D3 | **A handover is tracked by an issue that POINTS at it; the narrative stays a file** | **LOCKED** | GLM was right that the earlier line was drawn by *which file a block sat in* rather than by what it is. The consistent rule: the issue is the tracked unit and carries what is outstanding plus a link; the 10-page briefing stays a document. Applies equally to `INTAKE QUEUE` blocks and `HANDOFF.d/` files |
| D4 | **One issue per WORK ITEM, not per block** | **LOCKED** | The OPA four-block case. Collapse rules in step 1 |
| D5 | **The required CI check is retired via an owner instruction, not repointed at Issues** | **LOCKED** | See §8. This reversed my position |
| D6 | One type label, not a `db-request`/`db-handover` split | **LOCKED** | The distinction cannot be drawn cleanly (D3) and issues do not enforce it |
| D7 | No status-label lifecycle. Open or closed, plus `needs-albert` / `blocked` | **LOCKED** | A status label set is the six-section lifecycle in a new costume |
| D8 | The dead-end (“what did not work”) content becomes **a named loss**, not a silent one | **OPEN** | See §7 Q2 |

---

## 5. The plan — ordered, executable steps

### Step 1 — Inventory, with an arithmetic completeness check

Parse the file into blocks by `### ` heading. For each record: section, title, date, requesting session, kind (REQUEST / CLOSING NOTE / SUPPLEMENT / handover), any `B<n>` reference, and which **work item** it belongs to (D4).

For every block in `REQUEST QUEUE`, `IN PROGRESS` and `INTAKE QUEUE`, verify against the repo whether it is genuinely still open — the method PR #463 used to retire five landed-but-unmoved blocks.

⚠️ **The silent-loss door is HERE, not at step 6, and the mapping file cannot see it.** A block misclassified NOISE or ALREADY-DONE never reaches step 6, and a mapping file only records what the script was given — proving nothing was lost from the set it saw is circular. *(Found by GLM.)* So:

**Completeness cross-check (mandatory).** Count `###` blocks in the three source sections. Assert:

```
migrated + closed-with-a-cited-reason + noise-with-a-written-justification  ==  total blocks
```

Any block in the middle two categories carries its evidence inline. **An unexplained block is a failed inventory, not a rounding error.**

**Verification gate.** The arithmetic balances, and every non-migrated block has a reason a stranger could check. Put this in the migration PR description, **not** in `docs/verification/` — that directory is for proving a change correct, not for process bookkeeping.

### Step 2 — Build the scrub TOOL, then write the scrub report

**The earlier draft said "do not do it by eye" and then supplied no tool. In a repo whose entire control philosophy is "mechanical or it does not happen", that was the weakest specification attached to the highest-blast-radius step.** *(GLM's non-negotiable, and it is right.)*

Write `tools/scrub-intake-for-publication.mjs`. It scans every block marked OPEN by step 1 against a denylist and emits a report. It is a **floor under human judgement, not a replacement for it** — a clean run does not authorise publishing, it only means the obvious hits are found.

Minimum patterns: credentials, tokens, connection strings, private keys · 1Password item IDs and field names · database project refs (`qsllyeztdwjgirsysgai`, `rjyboqwcdzcocqgmsyel`) and pooler hosts · internal hostnames (`x5.coldlion.com`, `*.designflow.app`) · machine names (`t16`, `hetz`, `al8960ofc`, `916`, `4837`) · local filesystem paths (`C:\Users\…`, `/home/…`) · email addresses and personal names · licensor and customer commercial terms.

**Two categories the tool cannot decide — a human must rule on each hit:**
- **Named individuals outside the company.** At least one exists in the `WAITING` section.
- **Descriptions of live, unfixed weaknesses.** Publishing a working description of an unfixed hole is materially different from publishing a resolved one.

**Verification gate.** A report stating blocks scanned, hits by category, and a proposal — redact / hold back / publish as-is — for every hit. **Nothing is published before Albert reads it.**

### Step 3 — Labels and issue shape

Labels: `db-work` (the type label, D6), `needs-albert` (⛔ owner decision), `blocked`. `db-claim` and `coordinator-marker` already exist — leave them alone.

Status is open/closed (D7). Ownership is the assignee, or a line naming the session, since AI sessions have no GitHub account.

**Body:** for a request, the original text verbatim under a header naming the source file, section and commit SHA. Verbatim matters — a summarised block loses the reasoning, and the reasoning is why some blocks are worth keeping. **For a handover (D3): what is outstanding, plus a link to the file. Never the whole briefing.**

### Step 4 — OWNER GATE: the scrub report

Present it in plain English: how many issues, what they contain, what was redacted, and that publishing is one-way — content can be indexed and cached even if deleted later. **Wait for an explicit yes.** Albert has chosen public Issues in principle; this is the first time he sees *what specifically* goes out.

### Step 4b — Rotate the credential BEFORE publishing

`COORDINATOR_INTAKE.md:988` is an open request: *"⛔ ALBERT: approve rotating the Cloud SQL read-only password that was emailed in plaintext"*, and `:991` records it was *"emailed in plaintext on 2026-08-04"* and *"should be rotated **after** the migration"*.

**That ordering is now wrong and this plan inverts it.** The request is still open, so the credential is presumed **unrotated**. Publishing that block — or any block referencing it — announces publicly that a live credential was emailed in plaintext and never rotated. **Rotate first, then publish.** If rotation is refused or deferred, the block is **held back entirely**, not redacted, because the surrounding blocks give it away by context. *(Found by GLM; upgraded from scrub finding to hard block.)*

### Step 5 — Skills first, and this ordering is load-bearing

Update `AGENTS.md` and both skills in `u2giants/ai-devops` (main-only, push directly, no PR) so the instruction is **open an issue**, not "append to a section of a 3,837-line file". Delete the copy-paste templates the file carried; `gh issue create` needs none.

⚠️ **This MUST land, and propagate to every machine, BEFORE step 8 turns the file into a pointer.** *(GLM's trace, and I had the order backwards.)* Otherwise: an updated machine files issues while a machine still running the old skill appends to a pointer file and **re-creates its body** — the rebuild this plan exists to prevent, happening live during the migration, with no alarm.

The skills currently exist on one machine only, because the `ai-devops` PR is unmerged and the other machines have not been synced. **Step 8 is gated on propagation being confirmed on every machine, not on the PR being merged.**

⚠️ `bin/ai-install-skills` does not run on Windows (CRLF vs `set -o pipefail`). Copy the file and verify with `Get-FileHash` that hub and local match.

**Verification gate.** No document instructs anyone to edit `COORDINATOR_INTAKE.md`, and every machine's local skill copy hash-matches the hub.

### Step 6 — Create the issues (first irreversible step)

`tools/migrate-intake-to-issues.mjs`:

1. Reads the step-1 inventory, never the raw file.
2. **`--dry-run` by default.** Creates nothing without an explicit flag.
3. **Idempotent** — searches for an existing open issue with the same title and skips if found, so a half-finished run is safely re-runnable. `gh issue list --label` **works correctly in this repo**; a claim in `COORDINATOR_INTAKE.md:3019` that it returns empty is **false**, verified live 2026-08-07 (`--label coordinator-marker` correctly returned issue #473).
4. Uses `gh issue create --body-file`, never a heredoc — this is a PowerShell-first machine and heredoc recipes have silently failed here before.
5. Writes a **temporary** mapping file (block → issue number). Summarise it in the PR body; do not commit it. A permanent artefact for a one-time event is the leftover this repo accumulates.
6. **Fails loudly and stops on the first error.** A partial migration reporting success is the worst available outcome.

**Verification gate.** Issue count equals the OPEN work-item count from step 1, the mapping has no blanks, and three spot-checked issues match their source blocks.

### Step 7a — OWNER GATE: branch protection

`AGENTS.md:1081` (§6.7 rule 3): *"Branch protection must not be removed or weakened without an explicit, per-change owner instruction naming the setting… If a required check is wrong, fix the check — never the protection."*

So the AI cannot drop this context on its own authority, and Albert's public-Issues decision does **not** cover it — that was a different question. **Ask him, naming the setting exactly:**

> May I remove the required status check named `Backlog / queue sync` from branch protection on `main` in `u2giants/shared-db`? It checks that each of the 14 backlog items in `HANDOFF.md` has an entry in the coordinator queue. After the migration that queue no longer exists, so the check has nothing to read. It is also already broken — it reports a pass when it should fail. Removing it leaves five required checks in place.

**No is a valid answer**, and it is survivable: see §7 Q1 for the fallback.

### Step 7b — Retire the check, in this order

1. Remove `Backlog / queue sync` from `required_status_checks.contexts`.
2. **Confirm** it is gone: `gh api repos/u2giants/shared-db/branches/main/protection --jq '.required_status_checks.contexts'`.
3. **Then** delete `.github/workflows/backlog-queue-sync.yml`, `scripts/check-backlog-queue-sync.mjs` and its tests.

**Reversing this order hangs every future PR forever** on a required context that can never report. Same class as renaming the `Cross-PR object collision` job.

⚠️ **Step 7b.3 must not be bundled into a PR that merges before 7b.1 has run.** Step 7b.1 is a standalone `gh api` action, not part of any PR. *(Found by GLM.)*

**Verification gate.** Protection lists five contexts and a throwaway PR reaches mergeable state.

### Step 8 — Reduce the file to a pointer

Replace the contents with a short pointer: what the file was, where work lives now, the `gh issue list` command, and the SHA where the full history can be read.

⚠️ **The pointer MUST carry the "empty does not mean idle" warning.** `COORDINATOR_INTAKE.md:1–30` exists because a coordinator once concluded the project was idle from an empty queue while about 20 jobs sat in the backlog. The pointer must say: an empty issue list is not proof there is no work — also read `HANDOFF.md ## BACKLOG` and `HANDOFF.d/`. *(Found by GLM; my earlier draft dropped this.)*

**Verification gate.** Under ~40 lines, carrying that warning; `git log` still shows the full text at the prior SHA.

### Step 9 — Delete the rules, including the two that would rebuild the file

Remove the B2 lifecycle, the B2.2 retention rule, and the six-section model wherever restated. **This step is the point of the plan.** Leave the rules in force with nothing to govern and a future session will faithfully obey them and rebuild the file.

⚠️ **Two live backlog items are instructions to rebuild exactly what this plan removes** *(found by GLM; my earlier gate would have passed while both survived)*:
- `HANDOFF.md:1850` — *"B10 — Coordinator intake lifecycle/retention is MANUAL; CI could enforce it (NOT implemented)"*. **Rewrite or close it.** A session that implements B10 rebuilds the queue.
- `HANDOFF.md:1943` — *"B13 — CI check: every BACKLOG `B<n>` should have a `REQUEST QUEUE` entry (DONE)"*. **Rewrite** to describe issue-backed tracking, or close it as superseded.

**Verification gate.** Searching the repo for `INTAKE QUEUE`, `TAKEN OVER`, `B2.2`, **`REQUEST QUEUE`, `B10` and `B13`** returns only the pointer file and historical handoffs. *(The first three tokens alone were a false-green gate — the same disease as the check being retired.)*

### ⚠️ Required at the END of each phase
Re-read every remaining step and record **drift** into this file before handing over. If nothing drifted, write "no drift" in the STATUS table; silence is not information. **This is kept deliberately against a reviewer's advice to cut it** — the identical instruction ran on the sibling plan on 2026-08-07 and produced ten concrete drift items, including every line number being off by 20–60. It is the highest-yield instruction in that document, measured.

---

## 6. Constraints and gotchas

1. **Branch + PR, and you merge it yourself.** Never commit to `main` directly.
2. **Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.** Check `git var GIT_COMMITTER_IDENT` before the first commit.
3. **Branch protection: `strict: true`, six required contexts, `enforce_admins: true`.** `main` moves often; expect `gh pr update-branch`. **Never weaken protection without a named owner instruction** (§6.7 rule 3, `AGENTS.md:1081`).
4. **`shared-db` is PUBLIC.** A file committed here is published exactly as an issue is. There is no "local, non-published" location inside this repo — any archive proposal must pass the same scrub gate.
5. **You may share this checkout with other live sessions.** Before opening a PR run `git diff origin/main --stat` and confirm it lists only your files. Never `git add -A`.
6. **Do not delete `.ai/deepseek-sessions/` or `.ai/reviews/`.**
7. **No band-aids, no silent failures.** Every fallback must be loud.
8. **Windows line endings:** `.mjs`/`.md` edits warn `LF will be replaced by CRLF`. Harmless; do not "fix" it, do not reformat whole files.
9. **The `ai-glm` review wrapper trips on its own report file.** It snapshots `git status` before and after and fails if the tree changed; its round-1 report under `.ai/reviews/` is itself a new untracked file, so the next turn aborts. Recovery: `ai-glm abort <session>` then re-ask — the session keeps its context. Not a GLM failure and not a working-tree problem.

---

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| **Something confidential is published, and it is one-way** | Step 2 tool + step 4 owner gate + step 4b credential rotation |
| **A genuinely open item is misclassified at step 1 and silently vanishes** | The arithmetic cross-check; every non-migrated block carries a checkable reason |
| **New work is filed to two different homes during the cutover** | Step 5 precedes step 8, gated on propagation to every machine |
| **The rules survive and a future session rebuilds the file** | Step 9, including B10 and B13 |
| **Deleting the workflow before de-listing the context hangs every PR** | Step 7b's ordering, and 7b.1 is not part of any PR |
| **Issue sprawl replaces file sprawl** | Only OPEN items (D2), one issue per work item (D4), no status lifecycle (D7) |

### Open questions

1. **Q1 — What if Albert says no at step 7a?** Then the check must not be deleted, and the fallback is to **repoint it at Issues** (assert each `B<n>` has an issue, open or closed). That path was reviewed in depth and rejected as the primary because it puts an external API on a required gate: an outage becomes either a false pass (if it skips green) or a freeze on every schema change across all five apps (if it fails). It also needs `issues: read` added to `.github/workflows/backlog-queue-sync.yml:35`, which today grants only `contents: read`, and a rewrite of the header comment that currently claims the job reads two files and needs no token. **Acceptable as a fallback, wrong as the plan.**
2. **Q2 — D8, the dead-end content.** The file's own retention rule says the "what did not work" sections are its most valuable content and must stay findable. After step 8 they exist only in old commits, which is where nobody looks. Options: accept it as a **named loss** told to Albert plainly, or publish a scrubbed digest — which is publishing, and must clear step 2. **Decide before step 8.**
3. **Q3 — the `B1`–`B14` backlog.** Several blocks reference it by number. Decide during step 1 whether those become issues, or the references break.
4. **Q4 — the six decisions waiting on Albert.** One issue each, or one combined? Six is more actionable; one is less noisy on a phone.

---

## 8. What the review changed, and the one thing it got wrong

Three rounds with **GLM 5.2**, adversarial by request. Recorded so nobody re-derives it.

**It reversed my position on step 7.** I proposed repointing the CI check at Issues, partly because it needed no owner decision. GLM's argument, which I accept: the check only ever policed **14 backlog items and never once looked at the 67 queue items** that are the actual sprawl, and it was false-passing anyway. Installing a more complex, externally-dependent required gate to preserve a small broken one is this repo's defining pathology in miniature. And "it needs no owner decision" was the tell — I was optimising to avoid asking Albert, when §6.7 rule 3 exists precisely to make that ask mandatory. Satisfying the rule by the letter (keep the context name) while changing the check from offline-deterministic to online-best-effort is routing around a control, which is the behaviour the rule forbids.

**It found seven defects I had missed**, all verified against the repo before being accepted: the §6.7 violation in step 7; `HANDOFF.md` B10/B13 being live rebuild instructions; the step-9 gate searching tokens that appear in neither; step 5/8 being in the wrong order; the four-block OPA item; the step-1 silent-loss door; and the "empty does not mean idle" warning missing from the pointer. It also refused to let the eye-scan scrub stand, and was right.

**It was wrong once, and how it went wrong is worth keeping.** It claimed `gh issue list --label` returns empty in this repo, citing `COORDINATOR_INTAKE.md:3019`, and built two objections on it. Tested live: it works (`--label coordinator-marker` → issue #473). It had quoted a **document** as evidence — in a review whose entire subject is that this repo trusts documents over the repo. Both objections were withdrawn. **The lesson is the repo's own standing rule: re-derive from `git`/`gh`, including when a reviewer is the one citing.**

**It conceded three of my pushbacks**: that a "local, non-published archive" is impossible in a public repo; that the consistent handover rule is issue-points-to-file rather than handoff-becomes-issue; and that the per-phase drift re-read is not ceremony, on the measured evidence.

**It also withdrew one of its own arguments mid-review** — an "org-wide deploy freeze" mechanism it could not substantiate on checking, replacing it with the narrower and correct one: a false-fail blocks every *schema* change across all five apps, because `shared-db` is the sole legal path for them, while app code keeps deploying.

---

## 9. Definition of done

- [ ] Steps 1–9 complete, or explicitly deferred with the reason in the STATUS table
- [ ] Every OPEN work item exists as an issue; the step-1 arithmetic balances
- [ ] The scrub tool exists, ran, and its report was approved by Albert
- [ ] The plaintext-emailed credential is rotated, or its block was held back entirely
- [ ] Skills propagated to every machine **before** the file became a pointer
- [ ] `COORDINATOR_INTAKE.md` is a pointer under ~40 lines carrying the "empty ≠ idle" warning
- [ ] `Backlog / queue sync` removed from protection **by named owner instruction**, then the workflow deleted — in that order
- [ ] `HANDOFF.md` B10 and B13 rewritten or closed
- [ ] The `AGENTS.md` safety rules are **untouched** — verified by diff
- [ ] Committed, pushed, PR merged by you, checks green
- [ ] STATUS table dated, drift recorded, `HANDOFF.d/` file written
