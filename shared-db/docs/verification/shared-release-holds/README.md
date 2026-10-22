# Shared release holds — verification evidence

Evidence folder for [#3779](https://github.com/popcre/shared-db/issues/3779) and
`plan_shared_release_hold_reduction.md`. Each file is public-safe: run IDs, step
timings and lease hold spans read from the GitHub Actions API, never private log
content, credentials or customer rows.

- `2026-10-20-guarded-merge-baseline.md` — merge-stage baseline before the
  prepare/merge job split (plan step 1, merge stage) and the shape after it.
- `2026-10-21-legacy-sha-release-call-site-audit.md` — the five workflow
  release sites that passed only an acquisition sha, the unserialized CLI path
  they hit, and what the step 8a first landing changed (plan step 8a).

Live traces of the split (an independent merge progressing while another
request prepares; simultaneous dispatches admitting one writer) are linked from
the issue, with their run IDs, and summarized here once recorded.
