# A paused agent must be distinguishable from a finished one (#549, backlog B11)

**Status:** live convention. Adopted 2026-08-11 to close issue #549.

---

## The accident this exists to prevent

A cleanup agent deleted the worktree of an agent that had **deliberately paused awaiting
re-dispatch** — and it broke no rule doing so. The worktree was clean, unlocked, and held no
unmerged work. It passed every safety check that existed.

**That is the finding, and it is the uncomfortable one: the criteria themselves were
insufficient.** A paused agent and a finished agent are byte-for-byte identical on disk. No amount
of care applied to the old checks would have saved it, because the information needed to tell the
two apart was never written down anywhere.

## The fix: the pausing agent leaves a marker

An agent that stops without finishing **writes its own tombstone**. The information lives with the
worktree, so it survives a dead session, a full context window, and a machine reboot — none of
which a coordinator's in-memory list survives.

### If you are the agent, and you are pausing

Before you stop, write a file called `PAUSED` in the **root of your worktree**:

```bash
cat > PAUSED <<'EOF'
PAUSED: yes
AGENT: <your agent name>
SESSION: <your session id>
ISSUE: <the GitHub issue number you are working>
SINCE: 2026-08-11T14:30Z
RESUME-WHEN: <the exact thing you are waiting for, in one plain sentence>
EOF
```

Rules for that file:

- **`RESUME-WHEN` must name a real event**, not a mood. "Waiting for PR #751 to merge" is a
  resume condition. "May need more work later" is not — if that is all you have, you are finished,
  not paused, and you should say so and leave no marker.
- **Do not commit it.** It is worktree state, not repository content. `PAUSED` is in
  `.gitignore` for exactly this reason, so it can never leak into a PR.
- **Delete it yourself when you resume or when you finish.** A stale marker is the failure mode
  that makes the next person stop trusting markers at all.

### If you are a cleanup agent, or a human sweeping worktrees

**Check for `PAUSED` before you remove anything.** A worktree carrying a `PAUSED` file is
**off-limits**, even when it is clean, unlocked and fully merged — those three facts are precisely
what the accident already satisfied.

`scripts/check-paused-worktrees.mjs` does the check mechanically:

```bash
node scripts/check-paused-worktrees.mjs          # list every paused worktree
node scripts/check-paused-worktrees.mjs --guard  # exit 1 if any worktree is paused
```

## The standing rules this sits underneath — none of them are relaxed

The marker is an **additional** safeguard. It does not license a sweep.

1. **Do not sweep worktrees or branches** (backlog B11, Albert's standing instruction). A sweep
   once deleted a live agent's workspace. The default is still: leave worktrees alone.
2. **Never improvise `git worktree remove --force` or `git branch -D`.** Use the
   `cleanup-worktree` skill.
3. **A dirty worktree is never removed.** Uncommitted work is the only copy of that work — there
   is no backup and no reflog entry for an untracked file.
4. **The absence of a `PAUSED` file is not permission to delete.** It means "no agent claimed this
   is paused", which is weaker than "this is finished". Agents crash before they can write a
   marker, and the marker only became a rule on 2026-08-11 — anything older than that predates the
   convention entirely.

## Why a marker file, and not the coordinator's list

The issue offered two options: the coordinator keeps the authoritative list of resumable agents
and no sweep runs without checking it, **or** the paused agent marks its worktree visibly.

The marker wins, for one reason: **the coordinator's list dies with the coordinator's session.**
Orchestrator sessions are replaced constantly, hand over through issues and `HANDOFF.d/` files,
and routinely run out of context mid-flight. A list held there is exactly the thing that goes
missing. A file on disk next to the work does not.

Nothing stops a coordinator keeping a list as well. It is just not the safeguard the sweep relies
on.
