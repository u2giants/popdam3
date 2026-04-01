# Claude Instructions for popdam3

## Git Workflow

After pushing a feature branch, automatically:
1. Create a PR targeting `main`
2. Merge the PR to `main` immediately (squash or merge commit, whichever is cleaner)
3. No need to ask for confirmation before merging

Do this without prompting the user for approval.

### GitHub Access

A GitHub Personal Access Token is stored in `.env.local` (gitignored) as `GITHUB_PAT`.
Use it for all GitHub operations (PR creation, merging, pushing to `main`).

Setup (run once per session if not already configured):
```bash
source .env.local
gh auth login --with-token <<< "$GITHUB_PAT"
git remote add github "https://${GITHUB_PAT}@github.com/u2giants/popdam3.git" 2>/dev/null || \
  git remote set-url github "https://${GITHUB_PAT}@github.com/u2giants/popdam3.git"
```

Push feature branches to **both** remotes, but use `github` remote for PR/merge:
```bash
git push origin <branch>    # local harness (required for session tracking)
git push github <branch>    # GitHub (for PR + merge to main)
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

## Supabase Migrations

### CRITICAL: Always match the local filename timestamp to what the DB records

When applying a migration via MCP (`mcp__Supabase__apply_migration`), Supabase records it in the
migration history table using the **actual clock time at the moment of the call** — not any
timestamp you choose. If the local filename uses a different timestamp, `supabase db push` will see
a local file it can't find in history, try to re-apply it, and fail (e.g. "policy already exists").

**Safe workflow — do this in order:**

1. Decide on the SQL content first.
2. Call `mcp__Supabase__apply_migration` to apply it to the remote DB.
3. Immediately check `mcp__Supabase__list_migrations` to see the exact timestamp Supabase recorded.
4. Create the local file in `supabase/migrations/` using **that exact timestamp** as the filename prefix.

**If the mismatch has already happened:**

- Both the old-timestamp file and a new-timestamp file may end up on `main` after squash merges (the rename becomes an add without removing the original).
- Check which timestamp is in the remote DB history: `mcp__Supabase__list_migrations`.
- Delete the file whose timestamp is **not** in the DB history.
- Commit and merge to `main` — the deploy workflow will then skip the already-applied migration.

**Never apply via MCP and create a local file in the same step without verifying the timestamps match.**

## ERP Sync — After Changing MG Lookup Tables

`supabase/functions/_shared/mg-codes.ts` contains the reverse lookup maps used by `erp-sync` to resolve API descriptions to letter codes. If this file changes:

1. Redeploy edge functions (GitHub Actions `deploy-supabase.yml`, or push to `main` which triggers it)
2. In the admin UI (Settings → ERP Enrichment), run a **Full Sync** to re-process all existing rows
3. After the sync, verify the "Unresolved MG Codes" stat card is 0 or matches expected count

Similarly, if `src/lib/mg-lookup.ts` (the frontend forward maps) changes, deploy the frontend.

Both files must agree on the MerchGroup schema — if new MG01/02/03 codes are added to the CSV, update both files in the same PR.

## Versioning

Whenever changes are made to `apps/bridge-agent/`, bump `apps/bridge-agent/package.json` version as part of the same commit:
- Patch (x.x.**X**): bug fixes, non-breaking changes
- Minor (x.**X**.0): new features, behavioral changes
- Major (**X**.0.0): breaking changes or major rewrites

Always include the version bump in the commit that contains the changes — never in a separate commit.
