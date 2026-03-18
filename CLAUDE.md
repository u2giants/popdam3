# Claude Instructions for popdam3

## Git Workflow

After pushing a feature branch, automatically:
1. Create a PR targeting `main`
2. Merge the PR to `main` immediately (squash or merge commit, whichever is cleaner)
3. No need to ask for confirmation before merging

Do this without prompting the user for approval.

## Versioning

Whenever changes are made to `apps/bridge-agent/`, bump `apps/bridge-agent/package.json` version as part of the same commit:
- Patch (x.x.**X**): bug fixes, non-breaking changes
- Minor (x.**X**.0): new features, behavioral changes
- Major (**X**.0.0): breaking changes or major rewrites

Always include the version bump in the commit that contains the changes — never in a separate commit.
