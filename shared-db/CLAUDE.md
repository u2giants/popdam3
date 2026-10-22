# CLAUDE.md

Read `AGENTS.md` first — it is the canonical operating guide and documentation
router. This file only carries Claude Code-specific notes.

## Session rules that matter here

- Work only in your own `git worktree` from `origin/main` (AGENTS.md §2.1-W).
- Declare `ai-task-gates start --class …` before edits. Changing `AGENTS.md`,
  `CLAUDE.md`, skills, or `plan_*.md` is class `reviewer-safety`, not a
  documents-only shortcut.
- Never ask Albert to approve, merge, or run commands. The AI owns git mechanics.
- SSH is not a deployment path. There is no app deploy from this repo.
- Commit style: short imperative subject; body explains *why*. Sign GitHub posts
  with `Posted by MiMo chat <id> on <machine>` when the standing rules require it.

## Ignore context

Use `.claudeignore` in this repository. For other tools, follow the
“What to ignore” section in `AGENTS.md`.

## Do not

- Hand-edit `types/database.types.ts`.
- Rewrite `HANDOFF.md` or another session's `HANDOFF.d/` file.
- Invent architecture, credentials, or deployment behavior; mark unknowns and
  say how to verify them.
