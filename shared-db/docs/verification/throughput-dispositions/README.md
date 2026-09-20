# Throughput guard call-site dispositions

`scripts/check-throughput-truth-audit.mjs` discovers every line in `scripts/` and
`.github/workflows/` matching the tracked pattern (`missing`, `never created`, `not applied`,
`NOT_DERIVABLE`, `_created_by_applied_dynamic_ddl`) and refuses unless **every** discovered call
site carries a hand-written disposition with a substantive reason.

## One catalogue per source file

Reviewed dispositions live here, partitioned by the source file they describe:

```
docs/verification/throughput-dispositions/<source path with "/" replaced by "~">.json
```

For example `scripts/check-live-proof-probe.mjs` is reviewed in
`scripts~check-live-proof-probe.mjs.json`.

Each catalogue is:

```json
{
  "schema_version": 1,
  "source": "scripts/example.mjs",
  "sites": [
    {
      "site": "scripts/example.mjs:42",
      "semantic_key": "scripts/example.mjs:<sha256 of the line>:<occurrence>",
      "line_sha256": "<sha256 of the line>",
      "disposition": "enriched | excluded",
      "reason": "At least 20 characters saying why this call site is safe as written."
    }
  ]
}
```

`site` is a diagnostic line number. Identity is `semantic_key` + `line_sha256`, so moving an
unchanged reviewed line needs no edit, while changing what the line *says* invalidates its
review.

## Why it is partitioned (issue #2832)

The previous aggregate carried one repo-wide `call_site_count` and one `call_site_sha256` over
every discovered site. Any pull request that added or removed a matching line had to edit that one
file, so two otherwise unrelated lanes could not both be correct — whichever landed second was
forced to recompute. Adding a call site in one source file now edits only that source file's own
catalogue, and two independent lanes merge cleanly.

The global count and digest are still computed on every run, but they are **derived and reported**
by the checker rather than stored in a shared artifact an author must edit.

## What did not change

- Every call site still needs its own hand-written disposition and substantive reason.
- There is still no blanket regenerate or `--update` flag, deliberately: a bulk regenerate would
  let new call sites through unreviewed while leaving the guard green.
- Unknown, stale, retired, duplicate and short-reason sites all still fail the check, and a source
  file with no catalogue fails.

## Adding or changing a call site

1. Run `node scripts/check-throughput-truth-audit.mjs`. It names the exact source file and site.
2. Edit only that source file's catalogue here, adding or retiring the affected entries.
3. Write a real reason. Re-run the checker until it prints `truth audit OK`.

`docs/verification/throughput-guard-truth-audit-20260828.json` is retained as historical evidence
of the dispositions at the cutover. It is not read and is not a second source of truth.
