# AGENTS.md — §2.1-W worktree-only rule, §2.1-H HANDOFF.d contract, §2.1 host/server boundary

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 2.1-W WORKTREE-ONLY — no session works directly in the shared `shared-db` checkout (standing rule, added 2026-08-12, issue #513)

**The rule.** In this repository, **every session — the orchestrator included — does its work in
its own `git worktree` cut from `origin/main`.** The shared checkout (`C:\repos\shared-db` on the
Windows boxes, and its equivalent elsewhere) is for reading and for `git fetch`. Nobody branches
in it, commits in it, or leaves it checked out on a working branch.

```bash
git -C <shared-checkout> fetch origin --prune
git -C <shared-checkout> worktree add <shared-checkout>/.claude/worktrees/<slug> -b <branch> origin/main
```

**Why it is a rule and not a preference.** Several sessions run this repo concurrently and they
all share one working copy. Observed, dated damage:

- **2026-08-06** — mid-session another session switched the shared checkout off the branch the
  first session was on, onto `docs/plan-dispatch-collision-hardening`, and committed on top. A
  commit landed on the **wrong branch and was pushed there** before anyone noticed. Recovery was
  non-destructive (cherry-pick to the right branch through a temporary worktree; no branch was
  rewritten, reverted, or force-pushed) but it cost a session.
- The same event left PR #467 carrying four files belonging to PR #466, because #467's branch was
  cut from the polluted checkout. The clean fix there was to **merge the earlier PR first** so the
  files drop out of the later diff by themselves — never a rebase or force-push of someone else's
  branch.
- §5.1's own step-2 recipe already says to do sensitive git work in a dedicated worktree. This
  section makes that the general rule rather than one recipe's footnote.

**If you find the shared checkout on a working branch**, do not "fix" it by switching it back —
another live agent may be mid-task on it. Leave it, work in your own worktree, and say so in your
handoff. Remove your own worktree when your branch has merged; never remove one that is dirty,
locked, or held by a live agent.

**Before treating working-tree files as current `main` evidence**, run
`node scripts/check-worktree-freshness.mjs`. It fetches live `origin/main` and refuses unless the
checked-out commit is that exact tip. A refusal means read the required files from a fresh isolated
worktree or from `git show origin/main:<path>`; never update or switch the shared checkout to make
the guard pass. Verification tools that read the migration tree must refresh `origin/main`
themselves and fail closed if that refresh is unavailable.

### 2.1-W.1 Retiring a worktree — and the squash-merge trap that has defeated every attempt

`scripts/reap-merged-worktrees.mjs` does this. Dry run by default; `--apply` to act.

**The trap.** `main` is squash-merged, which rewrites the commit, so **`git branch --merged`
cannot see a merged feature branch.** Measured 2026-08-13: 74 of 130 branches looked unmerged to
git while their pull request was merged. Every reaper keyed on git ancestry therefore reports
live work and cleans nothing, which is why 29 worktrees and 130 branches accumulated here.
**Ask GitHub whether the PULL REQUEST merged. Never judge by git ancestry alone.**

The script refuses to remove a worktree that is dirty, locked, detached, holds unpushed commits,
or is the main checkout — it prints those instead. Uncommitted work is unrecoverable, and no
amount of "its PR merged" makes deleting it safe.

**Branches now delete themselves.** `delete-branch-on-merge` was turned on for this repository on
2026-08-13, so a merged branch disappears without anybody remembering to sweep it.

## 2.1-H The HANDOFF.d contract — the file's own session retires it (issue #658, owner ruling 2026-08-13)

**There is NO limit on how many files `HANDOFF.d/` holds.** Twenty concurrent workstreams across
the five applications sharing this database means twenty files, and that is correct. What is
limited is **stale** files, and the target for those is **zero**.

⛔ **Do not add a check that fails a pull request when the directory exceeds N files.** It was
proposed on 2026-08-13 and rejected by the owner in the same breath:

> "when the 6th file gets there legitimately, if there are five files already there and some are
> stale, the legitimate file will get rejected. The sessions that do the work must take care of
> their own housekeeping. they are better informed than anyone as to whether something is
> finished or not." — Albert Hazan, 2026-08-13

A count cap bills whoever shows up next for somebody else's mess. Any earlier "threshold of 5"
wording, here or in a skill, is **superseded** by this section.

**Every `HANDOFF.d/` file opens with a contract block** naming the issue that would prove it
finished:

```
---
issue: 925                            # bare number; the issue that proves this done
status: OPEN                          # OPEN or BLOCKED — never DONE, see below
owner: codex/wb-scrape-schema-925     # the branch or session that owns it
---
```

**A finished file is DELETED, never marked done.** `status: DONE` is rejected. A file that stays
behind saying "finished" is the same archaeology problem as one that says nothing.

**One line, and "is this finished?" stops costing an hour.** Without it, answering that question
for 30 files meant reading all of them against live GitHub — which is why nobody did, and why 27
finished files sat in this directory for weeks.

**Three checks enforce it, and each can only ever fail the session that owns the file:**

| | What | Where | Blocks? |
|---|---|---|---|
| 1 | A handoff file you **add or modify** must carry a valid contract block | `Handoff Contract Guard` on every PR | yes, only your file |
| 2 | If a file you touched points at a **CLOSED** issue, or this PR **closes** an issue some file points at, retire that file **in this same PR** | same guard | yes, only your file |
| 3 | Files whose issue is already closed are listed weekly, with the owner named | `Handoff Stale Report`, Mondays | **never** |

Check 3 is the backstop for the only gap the other two cannot close: **a session that dies
mid-run never comes back to retire its file.** It reports and never deletes — deciding a
workstream is finished is a judgement, and the report names the file's owner so the ask lands on
the session that created it rather than on a stranger.

**When you inherit somebody's issue, you inherit their handoff file**, including the duty to
retire it. That is the whole mechanism: the duty travels with the work, not with the calendar.

**If the owning session is genuinely gone** and you are confident the work is done, any
orchestrator may retire the file — but say so in the pull request body, with the evidence
(closed issue, merged PR). Never delete another session's file silently.

## 2.1 Host/server boundary

This repo owns shared database schema and Supabase migrations. (The PLM import code and the `systemd/plm-sync.*` templates were removed by #2794 and must not be recreated.) Durable host/OS changes on `hetz` are owned by the canonical Ansible repo at `/worksp/ansible` / [`u2giants/ansible`](https://github.com/u2giants/ansible), then applied by GitHub Actions.

Route packages, users, firewall, SSH/sudo, Docker engine or daemon config, systemd units/timers, cron, `/etc`, `/usr/local/bin`, `/usr/local/sbin`, Cloudflare Tunnel 1, Coolify host glue, and backup/DNS watchdogs through an Ansible PR. Do not SSH, sudo, or hand-edit the host directly for durable infrastructure changes. App/database code and templates that belong to `shared-db` still change here; deploying those templates onto the host belongs in Ansible. Break-glass direct host repair must be explicit and followed by an Ansible PR that captures or reconciles the drift.
