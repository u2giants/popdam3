# Claude Instructions for popdam3

## Git Workflow

After pushing a feature branch, automatically:
1. Create a PR targeting `main`
2. Merge the PR to `main` immediately (squash or merge commit, whichever is cleaner)
3. No need to ask for confirmation before merging

Do this without prompting the user for approval.

### CRITICAL: Always branch from main's current HEAD

At the start of every new Claude Code session, the feature branch MUST be created from the latest `main`:
```bash
git fetch github main
git checkout main
git reset --hard github/main
git checkout -b claude/<feature-name>
```

**Never** base a feature branch on another Claude branch or on a stale local commit.
If `git log --oneline main..HEAD` shows commits from a previous Claude session that were already merged, the branch is based on stale state — rebase onto `github/main` before doing any work.

The reason this matters: if a session branch is based on a stale commit, 5+ weeks of merged changes are invisible to it. All fixes land in already-dead code paths (e.g. `bulk-job-runner/index.ts`, which main replaced with a 7-line stub). The branch diverges, and merging back requires resolving hundreds of conflicts.

### GitHub Access

The GitHub PAT for this repo is stored in the git `github` remote URL (embedded in `.git/config`, not committed to git).

Check if it's already configured:
```bash
git remote get-url github
# Should look like: https://ghp_...@github.com/u2giants/popdam3.git
```

If the `github` remote is missing or has no PAT:
```bash
# The PAT may be in .env.local — source it if that file exists:
source .env.local 2>/dev/null
# Or ask the user for the PAT if .env.local is missing.
git remote add github "https://${GITHUB_PAT}@github.com/u2giants/popdam3.git" 2>/dev/null || \
  git remote set-url github "https://${GITHUB_PAT}@github.com/u2giants/popdam3.git"
```

The `origin` remote is the local harness proxy (`http://127.0.0.1:.../git/...`) which auto-forwards pushes to GitHub. The `github` remote is the direct GitHub URL with auth. Push to both:
```bash
git push origin <branch>    # local harness (required for session tracking)
git push github <branch>    # GitHub direct (for PR + merge to main)
```

If the feature branch has conflicts with `github/main`, rebase before creating the PR:
```bash
git fetch github main
git rebase github/main
git push github <branch> --force-with-lease
```

Then create and immediately merge the PR:
```bash
gh pr create --repo u2giants/popdam3 --head <branch> --base main --title "..." --body "..."
gh pr merge <number> --repo u2giants/popdam3 --squash --delete-branch
```

### CRITICAL: Check CI After Every Push to main

After any push that touches `supabase/migrations/**` or `supabase/functions/**`, immediately check the Deploy Supabase GitHub Actions workflow run. Do not wait for the user to report a failure.

```bash
# Check most recent workflow runs:
curl -s -H "Authorization: token ${GITHUB_PAT}" \
  "https://api.github.com/repos/u2giants/popdam3/actions/runs?branch=main&per_page=5" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for run in data['workflow_runs']:
    print(f\"{run['id']} | {run['name']} | {run['status']} | {run['conclusion']} | {run['head_sha'][:8]}\")
"
```

If a run is `in_progress`, poll until it completes. If `conclusion == 'failure'`, get the logs:
```bash
# Get job ID:
JOB_ID=$(curl -s -H "Authorization: token ${GITHUB_PAT}" \
  "https://api.github.com/repos/u2giants/popdam3/actions/runs/<run_id>/jobs" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jobs'][0]['id'])")

# Get the logs (redirects to a download URL):
curl -s -L -H "Authorization: token ${GITHUB_PAT}" \
  "https://api.github.com/repos/u2giants/popdam3/actions/jobs/${JOB_ID}/logs" \
  | grep -A 30 "supabase db push"
```

---

## Supabase Migrations

### The Two-Path Problem (Root Cause of All Migration Drift)

There are two ways to change the DB schema, and mixing them without discipline causes `supabase db push` to fail in CI:

| Path | Records in migration history? | Creates local file? | When to use |
|------|-------------------------------|---------------------|-------------|
| `apply_migration` MCP | YES — with actual clock timestamp | NO — you must create it manually | All DDL changes |
| `execute_sql` MCP | **NO** | NO | Data queries, one-off DML only |
| `supabase db push` (CI) | YES — uses local filename timestamp | Reads from local files | Automated CI only |

**Rule: For any schema change (CREATE/ALTER/DROP TABLE, FUNCTION, POLICY, INDEX, TRIGGER), always use `apply_migration`. Never use `execute_sql` for DDL.**

`execute_sql` for DDL silently bypasses migration history. The change lands in the DB but `supabase db push` has no record of it. The next CI run will try to apply a later migration that depends on it — or worse, discover the DB state is inconsistent with the local files.

### CRITICAL: Always match the local filename timestamp to what the DB records

When applying a migration via MCP (`apply_migration`), Supabase records it in the migration history table using the **actual clock time at the moment of the call** — not any timestamp you choose. If the local filename uses a different timestamp, `supabase db push` will see a local file it can't find in history, try to re-apply it, and fail.

**Safe workflow — always do this in order:**

1. Decide on the SQL content first.
2. Call `apply_migration` to apply it to the remote DB.
3. **Immediately** call `list_migrations` to see the exact timestamp Supabase recorded.
4. Create the local file in `supabase/migrations/` using **that exact timestamp** as the filename prefix.
5. Commit and push to `main` immediately — do not let timestamp-fix work accumulate.

**Never apply via MCP and create a local file in the same step without verifying the timestamps match.**

Example — what a correct sequence looks like:
```
# 1. Apply the migration:
apply_migration(name="add_foo_index", query="CREATE INDEX ...")

# 2. Check what timestamp was recorded:
list_migrations()
→ [..., {"version": "20260406153042", "name": "add_foo_index"}]

# 3. Create the local file with THAT exact timestamp:
supabase/migrations/20260406153042_add_foo_index.sql
```

### Supabase Project IDs — Never Mix Them Up

There are two Supabase projects. Always verify which one you're targeting:

| Project | ID | Use for |
|---------|-----|---------|
| **popdam-prod** | `ryltkzzernhwnojzouyb` | All popdam3 migrations and edge functions |
| SynoMon | `qnjimovrsaacneqkggsn` | Completely separate project — never use for popdam3 |

Applying a migration to the wrong project puts orphaned records in the wrong migration history and can break both projects' CI. If you ever see `smon_*` named migrations in popdam-prod's history, they were accidentally applied to the wrong project.

### Diagnosing CI Failures from `supabase db push`

#### Error: "Remote migration versions not found in local migrations directory"

The DB has migrations in its history that have no corresponding local file. Typical causes:
- Old bootstrap migrations applied before git tracking was set up (`00001`–`00007` style)
- Migrations applied to the wrong project (e.g., smon_ prefixed migrations in popdam-prod)
- Migrations applied via `execute_sql` or directly via Supabase dashboard without creating local files

**Fix:** Delete the orphaned records from the migration history table (equivalent to `supabase migration repair --status reverted`):
```sql
-- Run via execute_sql MCP:
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('00001', '00002', ... <list from the error message>);
```

Verify they're gone, then re-trigger CI (via `workflow_dispatch` API or by pushing a trivial change).

Do NOT run `supabase migration repair` via CLI — the CLI isn't available in this environment. Use `execute_sql` MCP for direct DB manipulation.

#### Error: "Found local migration files to be inserted before the last migration on remote database"

A local file exists with a timestamp **before** the latest migration in the DB, but the DB has no record of it. `supabase db push` refuses to apply out-of-order migrations without `--include-all`.

This happens when a file was committed to git but the actual DB change was made directly (via `execute_sql`) rather than via a committed migration file being pushed.

**Fix options (choose based on whether the SQL has already been applied):**

Option A — SQL is already in the DB (applied directly, just not recorded):
```sql
-- Run via execute_sql MCP. Mark it as applied without re-running the SQL:
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('<timestamp_from_filename>', '<name>', ARRAY['-- applied directly; see git history'])
ON CONFLICT (version) DO NOTHING;
```

Option B — SQL has never been applied to the DB:
- Apply it via `apply_migration` MCP (it will record a new timestamp)
- Get the recorded timestamp via `list_migrations`
- Rename the local file to that exact timestamp
- Commit the rename

**Never add `--include-all` to the workflow** — it would apply out-of-order migrations to the live DB, potentially rolling back schema changes that were already superseded by later migrations.

#### Error: "policy already exists" / "already exists"

A local migration file has a timestamp that is NOT in the DB history, so `supabase db push` tries to apply it. The SQL fails because the object already exists (e.g., the migration was already applied under a different timestamp).

**Fix:** The local file has the wrong timestamp. Find the correct timestamp:
```
list_migrations()
→ Look for a migration name that matches the content of your local file
```

Then either:
- Rename the local file to match the DB's recorded timestamp
- OR delete the local file and create a new one with the correct timestamp

### If the Mismatch Has Already Happened (After Committing the Wrong File)

After squash-merges, both old-timestamp and new-timestamp files may end up on `main`:

1. Run `list_migrations` to see what's in the DB.
2. Identify which local filename timestamps are NOT in the DB history.
3. Delete those files (`git rm`).
4. Confirm the correct-timestamp files exist. If not, create them (same SQL content).
5. Commit and push to `main`.

### What `supabase db push` Actually Checks

`supabase db push` enforces a strict two-way sync:
1. **Local files not in DB history** → tries to apply them in timestamp order.
2. **DB history entries not in local files** → refuses to run (error #1 above).
3. **Local files with timestamps before the last DB migration but not in history** → refuses to run without `--include-all` (error #2 above).

The CI workflow runs `supabase db push` (not `--include-all`) on every push to `main` that touches `supabase/migrations/`. Keep the local files and DB history in perfect sync at all times.

---

## ERP Sync — After Changing MG Lookup Tables

`supabase/functions/_shared/mg-codes.ts` contains the reverse lookup maps used by `erp-sync` to resolve API descriptions to letter codes. If this file changes:

1. Redeploy edge functions (GitHub Actions `deploy-supabase.yml`, or push to `main` which triggers it)
2. In the admin UI (Settings → ERP Enrichment), run a **Full Sync** to re-process all existing rows
3. After the sync, verify the "Unresolved MG Codes" stat card is 0 or matches expected count

Similarly, if `src/lib/mg-lookup.ts` (the frontend forward maps) changes, deploy the frontend.

Both files must agree on the MerchGroup schema — if new MG01/02/03 codes are added to the CSV, update both files in the same PR.

---

## Versioning

Whenever changes are made to `apps/bridge-agent/`, bump `apps/bridge-agent/package.json` version as part of the same commit:
- Patch (x.x.**X**): bug fixes, non-breaking changes
- Minor (x.**X**.0): new features, behavioral changes
- Major (**X**.0.0): breaking changes or major rewrites

Always include the version bump in the commit that contains the changes — never in a separate commit.
