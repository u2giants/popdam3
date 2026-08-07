# Implementation plan — replace `COORDINATOR_INTAKE.md` with GitHub Issues

**File:** `plan_coordinator-queue-to-github-issues.md` · **Repo:** `u2giants/shared-db` · **Created:** 2026-08-07
**Revised:** 2026-08-07 after an adversarial review by **GLM 5.2** (3 rounds, session `intake-queue-to-issues-plan`; reports under `.ai/reviews/glm-intake-queue-to-issues-plan-*.md`). **Two steps changed direction as a result. Do not restore the earlier shape of step 7 or step 3 — both were reviewed and found wrong.** What changed and why is in §8.

**Owner decision this plan rests on:** **2026-08-07 — Albert chose PUBLIC Issues**, having been told the queue contains licensor names, customer data problems and internal incident write-ups, and having been offered a private repo instead. **Do not re-open that decision.** Two things are still owed to him and are named as blocking gates below: the **scrub report** (step 4) and the **branch-protection instruction** (step 7a).

---

## STATUS — read this first

| # | Step | Phase | State | Date |
|---|---|---|---|---|
| 1 | Inventory: classify every block, with an arithmetic completeness cross-check | A | ✅ **done** | 2026-08-07 |
| 2 | Build the **scrub tool**; run it; write the scrub report | A | ✅ **done** | 2026-08-07 |
| 3 | Labels and the issue shape (one label, pointer model for handovers) | A | ✅ **done — specified, nothing created** | 2026-08-07 |
| 4 | **OWNER GATE — Albert's go/no-go on the scrub report** | A | ✅ **APPROVED** | 2026-08-07 |
| 4b | Rotate the credential before publishing | A | ✅ **owner overruled — published as written** | 2026-08-07 |
| 4c | **Freeze the queue** between the final inventory and step 6 | A | ✅ held; inventory re-run clean at publish | 2026-08-07 |
| 5 | Update the skills in `ai-devops` and propagate them to every machine | B | ⚠️ **authored + pushed; PROPAGATION PENDING (issue #565)** | 2026-08-07 |
| 5b | **Re-home the standing facts into `AGENTS.md`** before the file shrinks | B | ✅ **done, byte-identical** (`AGENTS.md` §12) | 2026-08-07 |
| 5c | Land the **intake pointer guard** as a required check, while dormant | B | ✅ **required and green** | 2026-08-07 |
| 6 | Create one issue per **work item** | B | ✅ **63 issues created** (#502–#565) | 2026-08-07 |
| 7a | **OWNER GATE — protection changes, both named by the owner** | B | ✅ **APPROVED** | 2026-08-07 |
| 7b | Remove the context, confirm, **then** delete the workflow and script | B | ✅ **done in order** | 2026-08-07 |
| 8 | Reduce `COORDINATOR_INTAKE.md` to a pointer | B | ⛔ **BLOCKED on step 5 propagation (issue #565)** | — |
| 9 | Rewrite `HANDOFF.md` B10/B13; delete the B2 lifecycle rules | C | ✅ **B10 and B13 closed**; B2 deletion rides with step 8 | 2026-08-07 |

**Phases A and B are complete except step 8. A fresh session starts at STEP 8, and step 8
is BLOCKED — read the box below before touching anything.**

> ## ⛔ STEP 8 IS BLOCKED, AND THE BLOCK IS NOT TECHNICAL
>
> Step 8 reduces `COORDINATOR_INTAKE.md` to a pointer. It is gated on the updated skills
> reaching **every machine**, and they have not. Verified in sync: `al8960ofc` (by hash) and
> `t16` (by its own session's report). **Unverified: `hetz`, `916`, `4837`.**
>
> **Albert must run "sync my dotfiles" on those machines** — tracked as issue **#565**. A
> machine still on the old skills appends its handover to the pointer file and regrows the
> queue, live, which is the exact failure this plan exists to prevent.
>
> The `Intake pointer guard` required check now DETECTS that and fails the PR, so the
> failure is loud rather than silent. **That is a safety net, not permission to skip the
> gate.** Do step 8 after the sync, and flip `POINTER_MODE` to `true` in
> `scripts/check-intake-pointer.mjs` in the same PR.
>
> **Deleting the Part B2 lifecycle rules (the rest of step 9) rides with step 8**, because
> those rules live inside the file step 8 rewrites.

**What actually shipped: 63 issues, `gh issue list --repo u2giants/shared-db --label db-work`.**
63 `db-work`, 7 `needs-albert`, 6 `blocked`.
**Step 6 is the first irreversible action in this plan.** It is gated on steps 4 and 4b.
**Step 5 comes BEFORE step 8, deliberately** — see the trap in §5.

**⚠️ Before reading step 4 to Albert, read §10.** The repository went private and public
again on 2026-08-07; step 4 reads correctly as written, but §10 explains why.

### What Phase A produced

| Artefact | What it is |
|---|---|
| `tools/intake-blocks.mjs` | Shared parser. Splits the file into sections and blocks; ignores `###` lines inside code fences, which the file's own templates contain. |
| `tools/intake-inventory.mjs` | Step 1. Carries the classification of all 89 blocks and **fails loudly** if a block is unclassified, if the list stops lining up with the file, or if the arithmetic does not balance. |
| `tools/scrub-intake-for-publication.mjs` | Step 2. The denylist scanner. Never prints a matched value — it masks every hit, so the report is safe to hand over. |
| `docs/verification/intake-publication-scrub-20260807.md` | Step 2's report. |
| `tools/migrate-intake-to-issues.mjs` | Step 6. Dry-run by default; refuses `--create` without an approved redaction map. **Not run.** |
| `scripts/check-intake-pointer.mjs` + its workflow | Step 5c. The pointer guard, dormant until step 8. Eight negative-path tests. |
| `docs/intake-to-issues-shape.md` | Step 3. Labels and issue shape, written down; **nothing created**. |

**Step 1 arithmetic, from `node tools/intake-inventory.mjs`:**

```
89 blocks  =  71 MIGRATE  +  16 CLOSED (each with a checked reason)  +  2 NOISE
71 migrating blocks collapse to 63 WORK ITEMS  →  63 issues, not 89
```

⚠️ **These numbers moved once already.** The first inventory measured 86 blocks and 60
work items. PR #490 merged three more `INTAKE QUEUE` blocks hours later. The inventory
**refused to run** and named all three rather than skipping them — which is the behaviour
it exists for, and is why step 4c now declares a freeze. **Re-run it before step 6; do not
quote these figures from here.**

Every CLOSED reason was checked against `git log` / `gh pr list` / `gh issue view` / the
live working tree. None was accepted from another document.

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

### Step 4c — FREEZE the queue between the final inventory and step 6

Raised by Kimi K3, 2026-08-07, and it is a real hole: between the moment the inventory is
finalised and the moment the issues exist, any session appending a block creates work that
belongs to neither system. **PR #490 did exactly this on 2026-08-07**, adding three blocks
after the first inventory was taken.

The freeze is announced in the queue file's own preamble and in the coordinator marker
issue: *"This file is frozen pending migration. File an issue instead."* It is **not**
mechanical, and that is a known weakness — but the window is short, and the inventory's
order-check makes a violation loud rather than silent. When PR #490 landed mid-Phase-A the
inventory refused to run and named all three new blocks. Nothing was lost.

**Verification gate.** Re-run `node tools/intake-inventory.mjs` immediately before step 6.
If it passes, no block arrived. If it fails, classify the new blocks and re-run the scrub —
`--create` will refuse a redaction map that predates them.

### Step 5 — Skills first, and this ordering is load-bearing

Update `AGENTS.md` and both skills in `u2giants/ai-devops` (main-only, push directly, no PR) so the instruction is **open an issue**, not "append to a section of a 3,837-line file". Delete the copy-paste templates the file carried; `gh issue create` needs none.

⚠️ **This MUST land, and propagate to every machine, BEFORE step 8 turns the file into a pointer.** *(GLM's trace, and I had the order backwards.)* Otherwise: an updated machine files issues while a machine still running the old skill appends to a pointer file and **re-creates its body** — the rebuild this plan exists to prevent, happening live during the migration, with no alarm.

The skills currently exist on one machine only, because the `ai-devops` PR is unmerged and the other machines have not been synced. **Step 8 is gated on propagation being confirmed on every machine, not on the PR being merged.**

⚠️ `bin/ai-install-skills` does not run on Windows (CRLF vs `set -o pipefail`). Copy the file and verify with `Get-FileHash` that hub and local match.

**Verification gate.** No document instructs anyone to edit `COORDINATOR_INTAKE.md`, and every machine's local skill copy hash-matches the hub.

### Step 5b — Re-home the standing facts BEFORE the file shrinks

⚠️ **Found by Kimi K3, 2026-08-07, ranked BLOCKING, and confirmed. Without this, step 8
deletes live safety rules.**

`AGENTS.md:21-29` tells every session that `COORDINATOR_INTAKE.md` *"carries the standing
facts an incoming session needs (silent duplicate-version skips, the production-bound
Supabase MCP, preview as a shared mutable resource) and the ban on background task chips"*.
Those facts are `COORDINATOR_INTAKE.md:309-375` — eight numbered rules, 67 lines. §2 of
this plan schedules them for deletion at step 9.

§3 says the safety rules are out of scope, but it means the ones written *inside*
`AGENTS.md`. These are only *pointed at* from it and live in the file being deleted. **The
chip ban is among them, and it is the rule that stopped a repeat of the four-way migration
collision.**

**Move them verbatim into `AGENTS.md` as a new section, and repoint `AGENTS.md:21-29` at
itself.** `AGENTS.md` is the right home rather than a new `docs/standing-facts.md`: it
already propagates to every session automatically, and a separate document is one more
thing nobody must read. Move strictly verbatim — this is a relocation, not a rewrite.

**This also amends the definition of done.** The clause "the `AGENTS.md` safety rules are
untouched, verified by diff" now means *unchanged in substance*: this step adds a section
to `AGENTS.md` deliberately, and the diff check must allow that one addition and nothing
else.

**Verification gate.** All eight standing facts appear in `AGENTS.md`, byte-identical to
their text at the prior SHA; `AGENTS.md:21-29` no longer points at `COORDINATOR_INTAKE.md`
for them; and this lands **before** step 8.

### Step 5c — Land the pointer guard while it is dormant

`scripts/check-intake-pointer.mjs` + `.github/workflows/intake-pointer-guard.yml`, made a
**required** status check while `POINTER_MODE` is still `false`.

This is step 5's gate, inverted. "Propagation confirmed on every machine" is not verifiable
by any single session, so instead of proving every machine is current beforehand, the guard
detects the one behaviour a stale machine produces — an append that regrows the queue — on
the next PR, and fails. Its eight tests are all negative-path (backlog B7 standard).

⚠️ **It must be required and green BEFORE step 8**, otherwise step 8's own PR is blocked by
the gate step 8 introduces. Adding a required context is a **branch-protection change**, so
step 7a's owner question must name it too.

Propagation itself remains an owner task, tracked as work item **WI-63**.

### Step 6 — Create the issues (first irreversible step)

`tools/migrate-intake-to-issues.mjs`:

1. Reads the step-1 inventory, never the raw file.
2. **`--dry-run` by default.** Creates nothing without an explicit flag.
3. **Idempotent** — see item 8 below for how. *(The original wording here described a title-based check over open issues only; that was replaced after review because it duplicated on both a closed issue and a renamed one.)* `gh issue list --label` **works correctly in this repo**; a claim in `COORDINATOR_INTAKE.md:3019` that it returns empty is **false**, verified live 2026-08-07 (`--label coordinator-marker` correctly returned issue #473).
4. Uses `gh issue create --body-file`, never a heredoc — this is a PowerShell-first machine and heredoc recipes have silently failed here before.
5. Writes a **temporary** mapping file (block → issue number). Summarise it in the PR body; do not commit it. A permanent artefact for a one-time event is the leftover this repo accumulates.
6. **Fails loudly and stops on the first error.** A partial migration reporting success is the worst available outcome.

7. ⚠️ **It applies the approved redaction map, and refuses `--create` without one.**
   **This was missing and it was the worst defect in the work** (found by Kimi K3,
   2026-08-07, ranked BLOCKING). The scrub proposed redactions, the owner approved them,
   and the script then pasted every block **verbatim** — nothing consumed the report. That
   made steps 2 and 4 pure ceremony and would have published all 225 flagged values on
   approval. Now: `node tools/scrub-intake-for-publication.mjs --emit-redactions <tempfile>`
   produces a map grouped **by value** (225 hits collapse to ~54 decisions, so nobody
   rubber-stamps 132 lines); every HUMAN-category value starts `UNRESOLVED` and the map
   does not validate until a person rules on each; `--create` refuses without it.
   Redaction is applied by **literal value match**, never by character offset — an offset
   recorded against one revision of a 5,500-line file silently redacts the wrong span
   once the file shifts. At `--create` time the map is re-validated against a **fresh
   scrub**, so a map approved before the file changed is rejected rather than applied.
   Any value marked `hold-back` removes its whole work item from the run.
   ⚠️ **The map lists the sensitive values themselves. Write it to a temp directory and
   never commit it.**
8. **Idempotent on the `(WI-nn)` marker in the body, over `--state all`.** Matching on
   title over `--state open` duplicated on two paths: close a migrated issue and a re-run
   recreates it; rename a title and a re-run creates a second copy. Matching is done
   locally on one fetched list, **not** through `gh issue list --search` — that index is
   eventually consistent and also matches comment text, so a fresh issue can be missed
   while an unrelated comment mentioning `WI-12` causes a false skip, silently dropping a
   work item. *(Both found by Kimi K3.)*
9. **It asserts local `HEAD` equals `origin/main` and that the queue file is committed**
   before creating anything, so the "as of commit" line in every body points at a revision
   a reader can actually look up.
10. **Handover issues carry a hand-written outstanding-work list, or the script refuses.**
    "Fill this in when you pick it up" ships a stub. There are only six handover blocks;
    they are written by hand.
11. **Request and handover handling is decided PER BLOCK, not per issue.** WI-07 mixes
    three REQUEST blocks with one 280-line `INTAKE QUEUE` handover; deciding per issue sent
    the whole thing down the verbatim path and pasted the handover in full, violating D3.

**Verification gate.** Issue count equals the OPEN work-item count from step 1, the mapping has no blanks, and three spot-checked issues match their source blocks — **including that the approved redactions are actually present in the published text.**

### Step 7a — OWNER GATE: branch protection

`AGENTS.md:1081` (§6.7 rule 3): *"Branch protection must not be removed or weakened without an explicit, per-change owner instruction naming the setting… If a required check is wrong, fix the check — never the protection."*

So the AI cannot drop this context on its own authority, and Albert's public-Issues decision does **not** cover it — that was a different question. **Ask him, naming the setting exactly:**

**⚠️ The question now covers TWO protection changes, not one.** Step 5c adds a required
context as well as removing one, and adding a required context is also a protection change.
Ask both together, verbatim:

> **May I make two changes to branch protection on `main` in `u2giants/shared-db`?**
>
> **(1) Remove the required status check named `Backlog / queue sync`.** It checks that
> each of the 14 backlog items in `HANDOFF.md` has an entry in the coordinator queue. After
> the migration that queue no longer exists, so the check has nothing to read. It is also
> already broken — it reports a pass when it should fail.
>
> **(2) Add a required status check named `Intake pointer guard`.** It fails a pull request
> if the retired queue file starts growing back, which is what happens if a machine that
> has not been updated files work the old way. It needs to be required, because as an
> optional check it would spot the problem and nobody would notice.
>
> That leaves **six** required checks, the same number as today.

**No is a valid answer** to either part, and both are survivable:
- No to (1): keep the check and repoint it at Issues — §7 Q1's fallback.
- No to (2): the guard still runs on every PR, just advisory. Weaker, and the weakness
  must be recorded rather than glossed: an advisory guard detecting a silent rebuild that
  nobody reads is the same defect class as the check being retired.

### Step 7b — Retire the check, in this order

1. Remove `Backlog / queue sync` from `required_status_checks.contexts`, and add
   `Intake pointer guard` (step 5c) in the same call.
2. **Confirm** both: `gh api repos/u2giants/shared-db/branches/main/protection --jq '.required_status_checks.contexts'`.
3. **Then** delete `.github/workflows/backlog-queue-sync.yml`, `scripts/check-backlog-queue-sync.mjs` and its tests.
4. **In the same PR as 7b.3**, fix the documents that assert the retired check still exists.
   Found by Kimi K3, 2026-08-07; the first two are already stale *today*, before this plan
   touches anything:
   - `AGENTS.md:1118` — rule 4 says *"all **FOUR** required contexts"* and lists four.
     There are **six**. Correct the count and the list.
   - `AGENTS.md:1084` — the §6.7 table lists the six contexts, including the retired one.
   - `plan_dispatch-collision-hardening.md:966` — *"Six required checks"*.
5. **Close work item WI-58** (*"the `Backlog / queue sync` check false-passes — fix it or
   retire it"*). Retiring it IS the resolution; leaving it open invites someone to fix a
   deleted script.

**Reversing this order hangs every future PR forever** on a required context that can never report. Same class as renaming the `Cross-PR object collision` job.

⚠️ **Step 7b.3 must not be bundled into a PR that merges before 7b.1 has run.** Step 7b.1 is a standalone `gh api` action, not part of any PR. *(Found by GLM.)*

**Verification gate.** Protection lists **six** contexts — the five that survive plus `Intake pointer guard` — and a throwaway PR reaches mergeable state. *(This gate said "five" until step 5c added a required context; a stale count here would read as a failed change.)*

### Step 8 — Reduce the file to a pointer

Replace the contents with a short pointer: what the file was, where work lives now, the `gh issue list` command, and the SHA where the full history can be read.

⚠️ **The pointer MUST carry the "empty does not mean idle" warning.** `COORDINATOR_INTAKE.md:1–30` exists because a coordinator once concluded the project was idle from an empty queue while about 20 jobs sat in the backlog. The pointer must say: an empty issue list is not proof there is no work — also read `HANDOFF.md ## BACKLOG` and `HANDOFF.d/`. *(Found by GLM; my earlier draft dropped this.)*

**Verification gate.** Under ~40 lines, carrying that warning; `git log` still shows the full text at the prior SHA.

### Step 9 — Delete the rules, including the two that would rebuild the file

Remove the B2 lifecycle, the B2.2 retention rule, and the six-section model wherever restated. **This step is the point of the plan.** Leave the rules in force with nothing to govern and a future session will faithfully obey them and rebuild the file.

⚠️ **Two live backlog items are instructions to rebuild exactly what this plan removes** *(found by GLM; my earlier gate would have passed while both survived)*:
- `HANDOFF.md:1850` — *"B10 — Coordinator intake lifecycle/retention is MANUAL; CI could enforce it (NOT implemented)"*. **Rewrite or close it.** A session that implements B10 rebuilds the queue.
- `HANDOFF.md:1943` — *"B13 — CI check: every BACKLOG `B<n>` should have a `REQUEST QUEUE` entry (DONE)"*. **Rewrite** to describe issue-backed tracking, or close it as superseded.

**Verification gate.** Search, **case-insensitively**, for `INTAKE QUEUE`, `TAKEN OVER`,
`B2.2`, `REQUEST QUEUE`, `B10`, `B13`, `Backlog / queue sync`, `intake-archive`, `Part B2`
and `COORDINATOR_INTAKE`. *(The first three alone were a false-green gate — the same
disease as the check being retired.)*

Two corrections to that gate, both from Kimi K3, 2026-08-07:

- **Case matters.** `AGENTS.md:1011` and `:1013` say *"the coordinator intake"* in lower
  case. A case-sensitive gate walks straight past them, and they are live instructions.
  **They must be rewritten at step 9**, not just found.
- **Scope with a per-file allowlist, not a directory exclusion.** Excluding `docs/`
  wholesale is wrong because `docs/` mixes live guidance with historical evidence. Allowlist
  the specific files that will legitimately carry these tokens forever — this plan,
  `plan_dispatch-collision-hardening.md`, `docs/verification/**` reports, `.ai/reviews/**`,
  and `HANDOFF.d/**` — each with a written reason. Anything not on the list is a hit.

**The gate must be able to go red for the right reason.** A gate that can only pass is the
false-green being replaced.

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
9. **⚠️ CROSS-PLAN CONFLICT with `plan_dispatch-collision-hardening.md` — read before step 7b.**
   That plan is live (Phase A merged 2026-08-07; Phases B and C open) and it touches the same script from the other direction:
   - Its **§4 item 4** (`:177`) defers *fixing* `scripts/check-backlog-queue-sync.mjs`, describing the fix as "tracked in the `REQUEST QUEUE`". This plan **deletes both the script and that queue**. The two plans have opposite fates for one file and neither pointed at the other until now.
   - Its **§10 "must stay green"** list (`:950–951`) runs `node scripts/check-backlog-queue-sync.mjs` and `node --test scripts/check-backlog-queue-sync.test.mjs`. **Step 7b.3 deletes both.** A Phase B or C session following that plan literally would run a command against a deleted file and read the failure as its own breakage.
   **Whoever reaches step 7b first must update that plan's §4 item 4 and §10 in the same PR.** Do not delete the script without doing so.
10. **An open coordinator marker exists: issue #473, "COORDINATOR ACTIVE — session 774f5010 — t16".** The orchestrator skill's step 0 says an open marker that is not yours means STOP and ask Albert before dispatching. Raised with him 2026-08-07; **confirm its status before starting this work**, do not assume it is stale.
11. **A warm GLM review session already holds this plan's full context** — `intake-queue-to-issues-plan` (3 rounds, reports under `.ai/reviews/glm-intake-queue-to-issues-plan-*.md`). **Continue it with `ai-glm ask`; do not start a new one.** A fresh session re-reads the repo, loses every conclusion reached, and pays full price for context this one already has cached.
12. **The `ai-glm` review wrapper trips on its own report file.** It snapshots `git status` before and after and fails if the tree changed; its round-1 report under `.ai/reviews/` is itself a new untracked file, so the next turn aborts. Recovery: `ai-glm abort <session>` then re-ask — the session keeps its context. Not a GLM failure and not a working-tree problem.

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
- [ ] The eight **standing facts** were re-homed into `AGENTS.md` verbatim BEFORE step 8, and `AGENTS.md:21-29` no longer points at the queue file for them
- [ ] The **approved redaction map was applied**, and three spot-checked issues show the redactions actually present in the published text
- [ ] The `Intake pointer guard` context is required and green
- [ ] `AGENTS.md:1118` ("FOUR"), `AGENTS.md:1084` and `plan_dispatch-collision-hardening.md:966` corrected; WI-58 closed
- [ ] The `AGENTS.md` safety rules are unchanged **in substance** — verified by diff, allowing only the step-5b standing-facts section
- [ ] Committed, pushed, PR merged by you, checks green
- [ ] STATUS table dated, drift recorded, `HANDOFF.d/` file written

---

## 10. DRIFT — recorded at the end of Phase A, 2026-08-07

Every remaining step was re-read against the live repo before this was written, as §5
requires. **Fourteen items drifted. Two of them invalidate whole steps.** Read D2 and D3
before doing anything else.

### D1 — the file is 42% bigger than the plan measured, and §2's table is wrong

Measured on `main` @ `ce16397`, 2026-08-07: **5,449 lines, not 3,837.**

| Section | §2 says | **Actually** |
|---|---|---|
| `REQUEST QUEUE` | 67 | **78** |
| `IN PROGRESS` | 1 | 1 |
| `WAITING ON OTHER PEOPLE` | 0 | 0 |
| `COMPLETED` | 12 | 12 |
| `INTAKE QUEUE` | 5 | **7** |
| `TAKEN OVER` | 6 | **5** |

Ten of the new `REQUEST QUEUE` entries were seeded by session `774f5010` at ~16:00 UTC on
2026-08-07 — **after** the plan was written. The plan's own warning ("do not promise Albert
67 issues") was right for the wrong number. **The real figures are 86 blocks → 60 issues.**

> ### ✅ D2 AND D3 WERE RESOLVED THE SAME DAY — read this before acting on either
>
> Both were put to Albert immediately. **On 2026-08-07 he ruled that the Disney extract
> is not sensitive and instructed, twice, that the repository be made public again.** It
> was, and **branch protection was restored in full** and read back live: six required
> contexts, `strict: true`, `enforce_admins: true`, force-pushes and deletions off.
>
> **Net effect on this plan: the original premises hold again.**
> - **The repo is PUBLIC.** §1, constraint 4 and design decision D1 ("public Issues") are
>   correct as originally written. Step 4's script may be read to Albert as written.
> - **Constraint 3 is correct as written.** Protection is back to the documented six.
> - **Steps 7a and 7b are NOT moot after all.** The required context `Backlog / queue sync`
>   exists again, so the owner gate at 7a is real and must be put to Albert before 7b.
> - **Open question Q1 is live again.**
> - **The scrub's hold-back proposal for the 3 Disney work items is overruled by the owner
>   ruling.** Those items may be published. The rest of the scrub report stands.
> - **R-SEC-1's history scrub is CANCELLED.** See `AGENTS.md` §6.7.
>
> **D2 and D3 are kept below unedited**, because the failure they document is real, is
> undocumented anywhere else, and will recur: on this account's plan, **making the repo
> private silently destroys branch protection**. Anyone who flips visibility again must
> re-read this.

### D2 — ⚠️ THE REPOSITORY IS PRIVATE. The plan's foundation is gone. *(resolved — see the box above)*

`u2giants/shared-db` was flipped to **PRIVATE on 2026-08-07 at ~15:10 UTC** on Albert's
instruction, because it had held Disney's confidential character extract while public
(request **R-SEC-1**, `COORDINATOR_INTAKE.md:689`). Verified live: `gh repo view` reports
`"visibility": "PRIVATE"`.

What this breaks:

- **§1 and constraint 4** — *"`shared-db` is PUBLIC. That is load-bearing for this
  workstream."* No longer true.
- **Design decision D1, "Public Issues"** — issues created now are **private**, visible
  only to people with repository access. Albert chose *public* Issues on 2026-08-07 having
  been told what the queue contains. He is now getting something different from what he
  agreed to. **That is not a downgrade he needs to worry about, but he must be told**, and
  it is not a licence to skip the scrub.
- **Step 4's script** — it tells Albert *"publishing is one-way — content can be indexed
  and cached even if deleted later."* Read as written, that is now **false and alarming**.
  Rewrite it: this is private today, but R-SEC-1 part (d) explicitly contemplates making
  the repo public again, and everything in an issue becomes public at that moment.
- **§7 risk row 1** is materially reduced today and returns in full if the repo goes public.

**The scrub still matters and step 4 is still a gate.** Do not treat "it is private now" as
permission to publish unreviewed.

### D3 — ⚠️ BRANCH PROTECTION ON `main` IS GONE. Steps 7a and 7b are moot. *(resolved — see the box above D2)*

Verified live 2026-08-07:

```
gh api repos/u2giants/shared-db/branches/main/protection
  → 403  "Upgrade to GitHub Pro or make this repository public to enable this feature."
gh api repos/u2giants/shared-db/branches/main --jq .protected
  → false
```

Private repositories on this account's plan **cannot have branch protection**. Flipping the
repo to private therefore removed it silently — all six required status checks, `strict:
true`, `enforce_admins: true`, the force-push and deletion blocks. Nobody recorded this.

Consequences for this plan:

- **Step 7a is moot.** There is no required context named `Backlog / queue sync` to remove,
  so there is nothing to ask Albert to name. **Do not put the step-7a question to him as
  written** — it asks permission to remove something that no longer exists, and he would
  reasonably conclude protection is still on.
- **Step 7b.1 and 7b.2 are moot** for the same reason. **7b.3 — deleting the workflow, the
  script and its tests — is still wanted**, and is now unblocked by any owner gate. It
  remains blocked by the cross-plan conflict in constraint 9, which is unchanged.
- **Open question Q1 is moot.** There is no required gate to repoint.
- **Constraint 3 is false as written** and must not be relied on.
- ⚠️ **This is a live safety regression far bigger than this plan.** `main` is writable
  directly, force-pushable and deletable, with no check enforced, in the repository that is
  the sole legal path for schema changes across five applications. It is carried as work
  item **WI-57** and it belongs in front of Albert now, not at step 7.

### D4 — the coordinator marker gate is satisfied, but a NEW marker is open

- **Issue #473** (`COORDINATOR ACTIVE — session 774f5010 — t16`) is **CLOSED**, with a
  closing comment recording a clean end: handover merged as PR #489, zero open PRs, zero
  open `db-claim` issues, no live agents, all worktrees retired. **Constraint 10, and
  handoff §0 item 8 and §6 step 1, are all satisfied. Do not re-raise #473.**
- **Issue #491 is OPEN** — `COORDINATOR ACTIVE — 697b5b87-a3a5-4aef-a03b-26fe277d52f5 —
  al8960ofc`, opened 2026-08-07 16:14 UTC, inheriting from session 774f5010. **It is not
  this session's marker.** Phase A dispatched no sub-agent, created no marker, made no
  database call and published nothing, so it did not conflict — but **anything that
  dispatches work must resolve #491 first.**

### D5 — R-SEC-1 is now a prerequisite for step 6, not an item within it

R-SEC-1 asks for Disney's confidential CSV to be moved to a private repository and
**scrubbed from this repo's git history**. Until that lands, quoting the surrounding
material into issues spreads it into a second store. The step-2 scrub agrees independently:
"licensor-owned internal identifiers" is the only category that produced a genuine
**hold-back** proposal, and it maps to exactly this material (3 work items, 4 blocks).
**Sequence R-SEC-1 before step 6, or hold those 3 work items back.**

### D6 — an intake PR is open and will add blocks after the inventory was taken

**PR #490** (`intake: three workstreams from a non-coordinator session on t16`) is OPEN and
appends to `COORDINATOR_INTAKE.md`. The inventory was taken at `ce16397` and does not
include it. **Re-run `node tools/intake-inventory.mjs` immediately before step 6** — it will
fail loudly on the new blocks rather than skip them, which is the intended behaviour.

### D7 — every `COORDINATOR_INTAKE.md` line number in this plan has moved

| Cited as | Now at | What it is |
|---|---|---|
| `:988` | **`:1283`** | the ⛔ Cloud SQL rotation request (step 4b's anchor) |
| `:991` | **`:1286`** | "emailed in plaintext on 2026-08-04" |
| `:682`, `:776`, `:821`, `:2946` | **`:977`, `:1071`, `:1116`, `:776` + `:3266`** | the OPA work item — it now spans **five** blocks, not four |
| `:3019` | **`:3333`** | the false "`gh issue list --label` returns empty" claim |
| `:1–30` | `:1–30` | the "empty does not mean idle" warning — unmoved |

`HANDOFF.md:1850` (B10) and `HANDOFF.md:1943` (B13) are **still correct** — re-verified.

### D8 — step 4b's premise holds, unchanged

The rotation request at `:1283` is still open, so the credential is still presumed
unrotated. **Step 4b stands exactly as written.** It is the one step nothing has undermined.

### D9 — step 2's denylist was missing its most important category

The plan's minimum-pattern list did not include **licensor-owned internal identifiers** —
Disney's own `licensedPropertyID` / `characterID` / `brandPropertyID` keys. That is the
R-SEC-1 material, and it turned out to be the **only** category producing a genuine
hold-back. It has been added to the tool.

Also added: a separate rule for 40-character hex strings. Folding them into "credentials"
made the tool propose holding back three work items over ordinary **git commit SHAs**,
which this repo quotes constantly. They are now their own HUMAN-decision category with the
`git cat-file -t` test written into the report.

### D10 — step 5's stated blocker is stale, but its real gate is not

The plan and the `WAITING ON OTHER PEOPLE` list both say the `ai-devops` skills PR is
unmerged. **It is merged** — `u2giants/ai-devops` PRs **#1 and #2 are both MERGED**,
verified live. The skills are no longer waiting on a merge.

**Step 5's actual gate is unchanged and still unmet:** propagation to *every machine*, not
the PR. Nothing in Phase A verified that, and it cannot be verified from this machine alone.

### D11 — step 9's verification gate needs one more token

Searching the repo today: `INTAKE QUEUE` appears in 9 files, `TAKEN OVER` in 15, `B2.2` in
5, `REQUEST QUEUE` in **21**. The gate's token list is right as far as it goes, but it will
also need **`COORDINATOR_INTAKE`** itself — several documents reference the file by name
rather than by section, and those pointers break silently at step 8.

### D12 — open question Q4 is asking about the wrong number

Q4 asks whether "the six questions already waiting on Albert" become one issue or six. The
inventory counts **nine** work items that need an owner decision, not six: WI-02, WI-14,
WI-15, WI-16, WI-30, WI-37, WI-49, plus the two gates this plan itself owes (steps 4 and
4b). **Re-ask it as nine.**

### D13 — the `IN PROGRESS` block carries a tooling claim that is false

`COORDINATOR_INTAKE.md:3333` tells the next coordinator that `gh issue list --label`
returns empty in this repo and prescribes a REST workaround. **Re-verified live 2026-08-07:
it works** — `--label coordinator-marker --state open` correctly returned issue #491. §8
already recorded this as GLM's one error; it is recorded here too because the false claim is
still sitting in the file, where the next coordinator will read it. It should not be carried
into any migrated issue.

### D14 — no drift

Design decisions D1–D8, the §5 step ordering (5 before 8, 7b's internals), the §5C
cross-plan conflict with `plan_dispatch-collision-hardening.md`, and constraints 1, 2, 5, 6,
7, 8, 11 and 12 were all re-checked and are **unchanged**. Constraint 11's warm GLM session
`intake-queue-to-issues-plan` was **not** used in Phase A — no review was needed for an
inventory and a scanner — so it is still warm and still holds the full plan context.
