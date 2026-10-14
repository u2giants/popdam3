# Issue #2336: exact pre-merge historical migration pin

This change registers the exact SQL body already applied to preview for migration
`20261013130102`. The original source PR #4206 has not merged, so the registry
contains the preview-apply identity and byte pin only; `sourcePr` and
`sourceMergeCommit` remain absent. This is not producer provenance and does not
authorize production.

## Exact preview evidence

The original preview apply was run `38428069849` (successful), dispatched from
`dc6636aadc871597b3ef77067d0650a00ed77691`, and recorded applied commit
`b2f08b55f3fed5b368c95552acf6fd5640bb9e90` in preview project
`mvpkijzfmfcxhnzqogzs`. Its official artifact was `11829452658`, whose immutable
ZIP SHA-256 is
`2f49bc74aeab3097506ec1035301597a78f9a96eb0f74539eeafc7769002ab81`.

The exact source is
`eeda52f55b6cb17bfab18fe266700a23b35366c1:supabase/migrations/20261013130102_licensing_support_forward.sql`:

- File bytes: `149215`; file SHA-256:
  `14a97f1f999fa1ea9a70fe12362ced166a9cba317a6fd40db74763bc8c0a328d`.
- SQL statement bytes after its one trailing newline: `149214`; statement
  SHA-256: `1ca2696a37075d622116933ad791f22ebc69fbd2810e1579f40b54020d95aa13`.
- The registry pins 67 structural object keys derived from those exact SQL bytes.

The exact source is retained under `scripts/test-fixtures/` only because this
branch does not yet contain the source migration on `main`. The positive test
checks the file and statement hashes and compares all 67 registry keys with the
repository's migration object parser. Negative tests reject a wrong path,
changed bytes, and an unregistered version. The actual exact SQL also remains
ineligible for production-producer validation until a real source merge is
registered. No `codeTruthOnly` exemption is added.

## Scope and remaining gates

This is a restoration pin for the already-applied preview bytes. It does not
change migration claims, source ownership, or production authorization. Claim
#4152 retains its existing 102 object holds and permanent version reservation;
new author grants remain capped at 30 minutes, with explicit owner check-in at
the existing 10-minute cadence. Licensing correctness, preview requalification,
production promotion, and live acceptance remain separate work and are not
proved by this pin.

After the exact source migration is merged and the repository's merge authority
records its actual provenance, a separately reviewed registry update should
replace the test-only duplicate fixture with the main-tree SQL reader and add
only verified source-merge provenance. Until then, keep this fixture and leave
`sourcePr`/`sourceMergeCommit` absent.
