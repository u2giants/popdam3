# Shared release holds — verification evidence

Evidence folder for [#3779](https://github.com/popcre/shared-db/issues/3779) and
`plan_shared_release_hold_reduction.md`. Each file is public-safe: run IDs, step
timings and lease hold spans read from the GitHub Actions API, never private log
content, credentials or customer rows.

- `2026-10-20-guarded-merge-baseline.md` — merge-stage baseline before the
  prepare/merge job split (plan step 1, merge stage) and the shape after it.

Live traces of the split (an independent merge progressing while another
request prepares; simultaneous dispatches admitting one writer) are linked from
the issue, with their run IDs, and summarized here once recorded.
