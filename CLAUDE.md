# Claude Code Notes for PopDAM

Read `AGENTS.md` first. It is the canonical guide for project summary, repo
structure, task navigation, deployment, credentials, incidents, quirks, and
pending work. This file is only for Claude Code-specific workflow reminders.

- `.claudeignore` is honored by Claude Code. Other tools follow `AGENTS.md` →
  What to ignore.
- **Shared DB, host changes, secrets, models, quirks, and incidents** live
  behind the pointers in `AGENTS.md` (`docs/MODEL_RULES.md`,
  `docs/KNOWN_QUIRKS.md`, `docs/incident-log.md`, `docs/idiosyncrasies.md`).
  Do not restate them here.
- Branch policy: use a feature branch and pull request; never push application
  changes directly to protected `main`. Required checks and the normal merge
  path control deployment (see `AGENTS.md` → Deployment).
- `HANDOFF.md` if present is required reading before continuing unfinished work.
