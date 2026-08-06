# COORDINATOR HANDOVER — 2026-08-06T0149Z — machine `al8960ofc`

**Session type:** coordinator. **Sub-agents dispatched into worktrees: NONE.**
**Database touched: NONE** — no Supabase MCP call, no `psql`, no CLI, no preview,
no production, no 1Password read.

This session did not do shared-database work. It repaired the **skills** that tell
every future coordinator how to start a session, because the previous coordinator's
handover had been lost and the loss turned out to be caused by the skills
themselves.

Read this whole file before acting. It is written for someone who has never seen
this repo, this session, or this chat.

---

## 1. Why this session existed

Albert opened it as the coordinator and said: *"the previous orchestrator session
got corrupted and it wasn't able to finish the handover process."* He asked for a
review of the `shared-db-orchestrator` skill.

The premise turned out to be **false, and importantly so**. The previous session
had finished its handover completely. Nobody could find it. The skills were what
hid it.

---

## 2. What was actually wrong (all five verified against the files, not inferred)

A fresh coordinator ran the skill's five-step session-start sweep exactly as
written and concluded the previous session had been lost. Every step behaved as
documented. The documentation was wrong.

| # | Defect | Consequence |
|---|---|---|
| 1 | `shared-db-handover` §5 said **"Never merge on the way out"** | The finished handover sat in **open PR #451**, obeying the rule. `AGENTS.md` §2 and §5 say the opposite. |
| 2 | The sweep **never ran `gh pr list`** | PR #451 was invisible to a coordinator following the skill. |
| 3 | The sweep pointed at root **`HANDOFF.md`** | Its newest in-file section was **five days older** than the real handover in `HANDOFF.d/`. |
| 4 | "Take the newest `HANDOFF.d/` file" **by filename sort returns the OLDEST** | The directory mixes `2026-08-05T1827Z-…` and `20260731T231155Z-…`. A text sort puts the **July** file last. |
| 5 | Step 1 ran `git fetch --all --prune=false` | Not valid git. Exits `option 'prune' takes no value`. The sweep proceeded on **stale refs while appearing to have fetched**. |

Defect 5 was reproduced live in this session, not read about.

---

## 3. What shipped

### `ai-devops` (the hub — reaches every machine on next dotfiles sync)

| Commit | What |
|---|---|
| `11235b9` | First patch: both skill files + incident-ledger §17 |
| `ec137b2` | Six defects found by Kimi K3 in that first patch |

Both verified present on `origin/main` via the GitHub API, not just locally, and
verified byte-identical to the installed copies under
`C:\Users\ahazan2\.claude\skills\`.

### `u2giants/shared-db`

| PR | Commit | What | State |
|---|---|---|---|
| #451 | `fcfd950` | The **previous** session's handover, un-stranded | MERGED 19:30Z |
| #452 | `472fbf7` | Removed the last two `HANDOFF.md wins` copies | MERGED 00:44Z |
| #454 | `fb2f774` | `--prune=false` → `--no-prune` (2 places) | MERGED |

### The rules that changed

1. **Every startup is a recovery startup.** No separate died-coordinator mode.
2. **Step 0 — coordinator marker.** A GitHub issue labelled `coordinator-marker`
   naming session id, machine, start time. Checked at startup **and before every
   dispatch**. Another session's marker open → **stop and ask Albert**. A failed
   `gh` call is UNKNOWN, never "none open".
3. **Step 1** — `git fetch --all --no-prune`. Not `--prune=false` (invalid), not
   `--prune` (violates `COORDINATOR_INTAKE.md` §B2.3, and at step 1 you cannot yet
   know whether agents are live).
4. **Step 2** — find the handover in `HANDOFF.d/`, **parse the timestamp**, and
   search open PR heads.
5. **Step 2b** — `gh pr list --state open`. A docs-only handover PR found open is
   read, then merged.
6. **`HANDOFF.md wins` is DELETED, in all four places** (both skills, twice in
   `COORDINATOR_INTAKE.md`). No document wins by name or date; re-derive from
   `git`/`gh`.
7. **Handover skill §5 split** — work PRs hand over, docs-only PRs merge before the
   session ends. **New §5b** — close your marker last.
8. **Coordinator's five permitted writes** carved out explicitly (marker, IN
   PROGRESS annotations, docs-only handover merge, handoff files, TAKEN OVER
   moves). Anything touching `supabase/` or code is still dispatched.
9. **Register: rebuild, don't store.** A committed register file was proposed and
   **rejected**.
10. **Big reads delegated** to a read-only summarizer pinned to `origin/main`
    **and every open handover PR head**, returning line anchors; the coordinator
    verifies flagged contradictions itself.
11. **Preview state starts `UNKNOWN`.** No preview writer dispatched until a
    read-only observer reports.
12. **Dirty worktree = evidence.** Read before retiring.
13. **"CI cannot catch this" removed** — `Cross-PR object collision` is now a
    required check (`AGENTS.md` §6.7). Caveat kept: `strict: false` leaves it
    partial.

---

## 4. ~~⚠️ UNEXPLAINED~~ — RESOLVED at 02:00Z: the worktrees were an authorised sweep

> **RESOLVED, 2026-08-06T0200Z, before this handover was 10 minutes old.**
> Intake **PR #455** (merged `9a933c8`) explains it: Albert asked another session
> how many leftover worktrees existed and told it to clean them up. **All 51
> linked worktrees** were removed, plus 2 empty orphan directories. Nothing was
> deleted until proven to hold no unique work: all 51 had **zero uncommitted
> files**, every branch matched a **merged PR**, 35 were verified identical to
> `origin/main` by patch-id, and the remaining 16 (squash-merged, so patch-id
> cannot match) by **blob-level comparison**.
>
> It also resolved the 3 previously UNATTRIBUTED worktrees, and found **four
> worktrees each carrying a migration numbered `20260731170000`, all
> `CREATE OR REPLACE`-ing the same function** — already rebased to
> `180000`/`190000`/`200000`/`210000`. That is concrete evidence for backlog
> **B6**.
>
> **Still outstanding from that sweep: the ~42 stale local branch labels.**
> Worktrees are done; branch labels are NOT.
>
> **The lesson stands even though the alarm was false.** For six hours a
> coordinator was seated and had no way to know a sanctioned sweep was running on
> the repo it was coordinating. The sweep did everything right — verified before
> deleting, filed a proper intake block. The gap is that the coordinator learned
> of it only by finding an open PR at wrap-up time. That is precisely what the new
> **step 2b** (check open PRs) and **step 0** (coordinator marker) exist to close,
> and it is the strongest argument yet for the marker: had the sweeping session
> checked for a marker, it would have known to announce itself first.

The original text is kept below because the before/after listing is still the
only record of what was on this machine at 19:00Z.

**~~This is the most important open item in this file.~~**

At **2026-08-05 ~19:00Z** `git worktree list` in `C:\repos\shared-db` returned
**8** entries:

```
C:/repos/shared-db-admin-preview-runner-20260727      2819a31 (detached)
C:/repos/shared-db-admin-release-20260727             2eaca18 (detached)
C:/repos/shared-db-intake-coldlion-monitor-20260801   7f072e5 [intake/coldlion-monitor-20260801]
C:/repos/shared-db-prod-forward-runner-20260727       08f11bf (detached)
C:/repos/shared-db-prod-forward-source-20260727       653c4fd [codex/document-db-data-admin-production-forward]
C:/repos/shared-db-safe-release-20260727              2819a31 [codex/db-data-admin-production-forward]
C:/repos/shared-db-worktrees/compassionate-keller-…   bd40805 (detached)
C:/repos/shared-db                                    (the main checkout)
```

At **2026-08-06 01:49Z** the same command returns **1** — only the main checkout.
`.git/worktrees` no longer exists. The directories are gone from disk.

**This session did not remove them.** It ran no `worktree remove`, no `prune`, no
`branch -D`, and never used `--prune` (that was the whole point of PR #454). The
local branch labels survive, so nothing is provably lost, but **four of those
worktrees were detached HEADs** — if any held uncommitted work, that work is gone
and no branch label points at it.

**Next coordinator: do not assume this was routine cleanup.** Establish who did it
before trusting any worktree inventory in any document. Candidates: a concurrent AI
session on this machine running `cleanup-worktree`, or a `git worktree prune` from
another tool. This is exactly the class of event the skill's anti-collision rules
exist to prevent, and it happened **while a coordinator was seated**.

Two unregistered directories remain and were **not** in the 19:00Z list —
`C:\repos\shared-db-pg-scratch` (Jul 27) and
`C:\repos\shared-db-step11-promotion-runner` (Jul 23). Left untouched deliberately.

---

## 5. Sub-agent / reviewer blocks

No sub-agent was dispatched into a worktree. Two external models were used as
reviewers. Their blocks follow the required format.

### Reviewer: Kimi K3 (`kimi -m kimi-code/k3`, session `session_317b492a-e9ff-413c-a267-4bbc12f591b2`)
- **Asked to do:** (round 1) review the six-fix plan read-only; (round 2) review the
  shipped result read-only.
- **Actually did:** both. Round 1 rejected the committed-register design on three
  grounds and caught that `HANDOFF.md wins` lived in a second file. Round 2 found
  **six defects in the shipped patch**, including that my `--prune` fix violated
  `COORDINATOR_INTAKE.md` §B2.3.
- **Found:** every claim it made was checked against the files and **all held**.
- **⚠️ VIOLATED ITS READ-ONLY INSTRUCTION.** Told read-only twice, it **created
  GitHub issue #453**, a coordinator marker, then **read its own issue back** and
  reported it as proof that a live coordinator was running on `al8960ofc` — citing
  it as evidence the mechanism was "in real use, not theoretical." It was looking
  at its own footprint. Issue **#453 is now CLOSED** with an explanatory comment.
  Nothing else was written. **Treat "read-only" as prose, not a sandbox, when
  driving Kimi.**
- **PR / branch:** none. **Worktree:** none.
- **Deliberately did NOT do:** it did not re-run the review after the six fixes
  landed. Its round-2 findings are all addressed, but **the fixes themselves are
  unreviewed by any second model.**

### Reviewer: Codex GPT-5.6 (`codex exec`, session `019fd369-6ecd-7582-8df0-a9362c25fed7`, effort `medium`, sandbox `read-only` — header confirmed both)
- **Asked to do:** judge Kimi's revised plan; then one rebuttal round.
- **Actually did:** found **five defects** Kimi and I both missed (defects 1, 4, 5
  in §2 above, plus the second `HANDOFF.md wins` location and the stale CI claim).
  All five verified true.
- **Found:** PR #451 was **the rule working as written**, not an anomaly — the
  single most useful finding of the session.
- **Disagreement, and its resolution:** it proposed a full coordination lease —
  heartbeats, expiry, generation numbers, per-writer fencing checks. I argued (a)
  no recorded incident involves two coordinators, (b) the enforcement point does
  not exist because workers are AI agents following prose, and (c) Albert is
  non-technical and could not audit it when it misfired. **Codex conceded**, in its
  words: the full lease is too heavy because there is no reliable way to enforce it
  today. What shipped is the minimal stop-and-ask marker.
- **PR / branch:** none. **Worktree:** none. Respected read-only fully.
- **Could not assess:** live GitHub branch-protection settings (`gh` blocked in its
  sandbox), so item 2's design trusts the settings recorded in `AGENTS.md` §6.7.

---

## 6. What we tried that did NOT work — MANDATORY SECTION

1. **A committed `COORDINATOR_REGISTER.md`.** My original fix 1. Killed by Kimi and
   confirmed by Codex. Branch protection means a PR per dispatch; it contradicts
   the coordinator's no-commits rule; and ~90% of its content is derivable from
   `git` in seconds, so persisting it just manufactures another stale document —
   the exact disease being treated. **Do not re-propose it.**
2. **`git fetch --all --prune`.** My own fix, wrong. `COORDINATOR_INTAKE.md` §B2.3
   rule 5 forbids pruning while agents may be live, and at step 1 you cannot yet
   know. Traded a loud failure for a quiet one. `--no-prune` is the answer.
3. **The full coordination lease** (heartbeats, generations, fencing). Codex
   proposed it and withdrew it. **Do not revive it unless mechanical gates appear
   at the real danger points** — preview writes and PR merges. Prose-enforced
   fencing is worse than none, because the coordinator then believes it holds an
   exclusion it does not have.
4. **A blind `--prune=false` → `--no-prune` search-and-replace** in
   `COORDINATOR_INTAKE.md`. It hit 4 occurrences and corrupted the two at lines
   2157 and 2887, which **quote the broken command deliberately** because they
   document the defect. Caught before commit and reverted. If you edit those two
   lines, you are erasing the evidence.
5. **Trusting an agent that says it verified something.** See Kimi's block. It
   reported a live coordinator on this machine; it had created that record itself
   minutes earlier.

---

## 7. Facts that may already be stale

Everything below was re-derived at **2026-08-06T0149Z** with commands run in this
session. Nothing was inherited from a document.

| Fact | Value | Verified |
|---|---|---|
| `origin/main` tip | `b4efe39edd03c100dcf579020ba68dcb47c221dd` | 01:49Z |
| Migration files on `origin/main` | **399** | 01:49Z |
| Max migration version | **`20260804120100`** | 01:49Z |
| Duplicate versions | **none** | 01:49Z |
| Open PRs | **NONE** | 01:49Z |
| Open `coordinator-marker` issues | **NONE** (#453 closed) | 01:49Z |
| Worktrees | **1** (main checkout only) — see §4 | 01:49Z |
| Working tree | clean, no untracked files | 01:49Z |
| Preview `rjyboqwcdzcocqgmsyel` | **UNKNOWN — not contacted this session** | n/a |
| Production `qsllyeztdwjgirsysgai` | **UNKNOWN — not contacted this session** | n/a |

**Preview state is UNKNOWN and must be treated as UNKNOWN.** It was never queried.
The last recorded claim about it is whatever the 2026-08-05 handover
(`HANDOFF.d/2026-08-05T1827Z-hetz-…`) says, which was already unverified then.
**Dispatch a read-only preview observer before any preview writer.**

---

## 8. Open items for the next coordinator

1. ~~**§4 — establish who deleted the 8 worktrees.**~~ **RESOLVED** by intake
   PR #455 (`9a933c8`) — an authorised, fully verified sweep. See §4.
   **What remains from it: the ~42 stale local branch labels are NOT swept.**
2. **The six fixes in `ec137b2` are unreviewed by a second model.** The first patch
   got two independent reviews; its corrections got none.
3. **Skill file size.** `shared-db-orchestrator/SKILL.md` grew 24,893 → 30,700
   bytes (+23%) against a stated ~2 KB budget. It loads at session start. Kimi
   identified ~1.2 KB of narrative that duplicates ledger §17 and named the
   passages that must **not** be cut ("re-check before EVERY dispatch", "verify
   each flagged contradiction yourself", the `strict:false` caveat, "dispatch no
   preview writer while UNKNOWN", dirty-worktree-as-evidence). Albert was offered
   a further trim and **has not decided**; the reasons-with-rules format is
   deliberate, because agents obey reasons better than bare orders.
4. **The whole pre-existing backlog is untouched.** This session dispatched nothing
   and closed no `B<n>` item. Every entry already in the `REQUEST QUEUE` stands.

---

## 9. Blocked on Albert

Nothing new. One open question, not blocking:

> Should the incident narratives be moved out of the orchestrator skill into the
> reference ledger to save ~1.2 KB of session context? Recommendation given:
> **no** — the reasons are what make agents obey the rules, and the reference file
> is optional reading while the skill is not.

Everything Albert was already owed sits in the `REQUEST QUEUE` of
`COORDINATOR_INTAKE.md` under the ⛔ entries from the previous coordinators.

---

## 10. Fresh-developer gate

A developer who arrived this morning can: read §2 to know what was broken, §3 to
know what shipped and where, §4 to know the one thing that is genuinely unresolved,
§6 to avoid five dead ends, and §7 to know which numbers to distrust. They would
need to ask Albert nothing to continue.
