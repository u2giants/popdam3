# Effective asset counts and grouped-filter activation

PopDAM issue #127 implements the application portion of shared-db issue #2501.

## Release prerequisite

The application must not ship before shared-db migration `20260911052640` is
verified in production. Shared-db PR #2734 merged as
`84a1a1d76a79d1d3d9f45c106c6722cec9eeed5c`; its preview apply succeeded in
[run 34581214593](https://github.com/u2giants/shared-db/actions/runs/34581214593).
Production [run 34595295842](https://github.com/u2giants/shared-db/actions/runs/34595295842)
succeeded against exact main `d530f85bc54d2b3c1f3ac52fcb9ee8d57c17fe3e`.
The production ledger contains the migration and all three indexes are valid and
ready. The immutable apply artifact is `10262431870`, digest
`sha256:d89ea12c3db55e0aaf5261d7f40e0cdb0224dbf05216d5c437e73f06d245270a`.
No database change is authored by this application patch.

## Corrected request shape

An exact count on the full-row RPC materializes every matching wide asset.
The application now fetches the original full-row page separately from an
ID-only exact count. The SDK converts a JSON-object RPC argument with
`head: true` to POST; appending `select()` requests a response body again.
Serializing the JSON argument retains a real HEAD request. An explicit one-row
range also bounds the request. Tests inspect the actual SDK-produced method,
query string, exact-count preference, absent response body, and full page shape.

Effective-scope page, facet and count requests are serialized. Running all three
together twice reproduced the database's bounded eight-second timeout, first on
the count and then on the page. Serial execution keeps ordinary asset queries
concurrent while preventing those three requests from competing for the same
effective-metadata working set.

All requests retain deletion, visibility, search IDs or fallback, and every
additional library filter. Failures in either request fail the library query;
an unavailable total is not presented as zero. Category and file-status choices
are also forwarded to the existing facet contract. Existing keyword facet
search semantics are unchanged.

Category filtering uses the contract's existing category/path predicate instead
of repeating its OR outside the RPC. An outer category OR timed out at 7.8s;
adding it both inside and outside still timed out. Applying the identical
supported predicate inside alone passed, with the first count taking 5.5s and
matching the facet total. Unsupported category choices remain ignored.

## Authenticated preview proof

On 2026-09-11 the sealed viewer logged into preview project
`mvpkijzfmfcxhnzqogzs`; its JWT role, subject and issuer were checked before reads.
Each case ran twice with the app's deletion and visibility predicates, full
pages 0 and 1, ID-only exact HEAD count, and facet total:

- Tag: 27,146.
- Licensor: 92.
- Property: 129.
- Combined tag/licensor/property: 0.
- Mixed tag/file-type/stage: 2,063.
- Tag plus Wall category: 12,120.
- Tag plus Has Preview: 27,053.

Every total agreed, both pages retained full fields, and there were no duplicate
IDs across the two pages. The first tag/mixed run completed its 16 calls in
156–1,725 ms. Fixture identifiers, licensed rows, and credentials are excluded.

Category/file-status qualification also passed twice, with full pages and exact
facet parity. A final concurrency acceptance alternated facet-first and
page-first order for all seven shapes, twice each. All 42 primary requests and
14 second-page reads passed; the coldest tag page was 3,054 ms and count 1,664 ms,
then 605 ms and 500 ms warm. The coldest category page was 1,528 ms and count
1,268 ms. Production visual verification remains pending.

## Local checks

- Focused SDK, hook, filtering and search tests: 22 passed, none skipped. The
  suite verifies that effective page, facets and count never overlap and that
  the exact count starts only after the visible page completes.
- Production build and full lint: passed.
- Earlier full Windows suite: 334 passed, two existing failures. The registry
  test assumes LF in a CRLF checkout; the export test exceeded its parallel
  five-second limit and passed alone. Neither failure concerns modified code.
- Standalone type checking reports existing errors in unrelated files; neither
  modified file has a reported type error.
