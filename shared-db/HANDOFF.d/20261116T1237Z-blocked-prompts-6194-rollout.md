# Prompts for the two blocked items (2026-11-16 7:37 AM EST)

## Prompt 1 — Move seven production functions off the stale property copy (#6194)

Repo popcre/shared-db. Read AGENTS.md first; load `shared-db-change`; declare the task class `shared-db`; work in your own worktree from origin/main.

Issue https://github.com/popcre/shared-db/issues/6194 remains open for one reason. Seven production functions still read the old frozen merch-group copy of the property list, when they should read `core.property`. The daily ColdLion fill of `core.property` (cron `coldlion-core-property-sync`, 10:30 AM EST) has been confirmed working since 2026-11-13. See the issue comments for the function list. If the list is missing, find the seven functions read-only on production by searching `pg_proc` bodies for the stale table.

Claim the exact functions on #6194. Write one migration that repoints them to `core.property` with no behavior change beyond the data source, and add a contract test. Open a PR and land it through the merge queue. Wait with `ai-pr-wait <pr> --repo popcre/shared-db` in the background.

Done when production `pg_proc` shows none of the seven functions reading the stale copy, each one returns the same shape when called read-only, and #6194 is closed with evidence. Never run a manual production command; production changes go out only through the automatic promotion workflow.

## Prompt 2 — Fix changes that exhausted automatic rollout attempts (6203, 6245, 6260)

Repo popcre/shared-db. Read AGENTS.md first; declare the task class `shared-db`; work in your own worktree from origin/main.

The automatic production promotion queue reports "ENGINEER ACTION REQUIRED". Merged migration PRs 6203, 6245 and 6260 each used up their three automatic attempts. PR 6263 was in the same state, but it later applied on its own. Each one's migration is still not in production (check `supabase_migrations.schema_migrations`).

For each PR, read its failed preview or production apply runs (`gh run list --repo popcre/shared-db`, titles contain `PR<number>`). Classify the cause:
- Transient: a GitHub API error, the "main moved past dispatched commit" refusal, or the occupied author-mutex. Re-dispatch it the way the workflow's own rules allow.
- Real migration defect: fix it with a follow-up migration PR.

Also check the "held by #6248 / #6261 / #6281" review-finding holds on PRs 6246, 6257 and 6280. Clear each finding properly so its PR can promote.

Done when each listed migration version appears in production `schema_migrations` with a successful run linked, or carries an evidenced blocker comment on its PR. Never run a manual production command; never re-run a failed run (the queue dispatches fresh runs).
