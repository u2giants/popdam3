# Reviewer cutover activation - request budget and sequencing

Issue: #1798. PR: #1799. Scope: repository coordination only; no database,
preview, production, or application data changes.

This records what the reviewer operations actually cost on the wire, because two
successive review rounds on this branch found tests that passed by charging less
than production does. Every price below was read off `githubIo`, not off a
fixture.

## Production request prices

| Call | Requests | Why |
| --- | --- | --- |
| `getRateLimit` | 2 | REST `rate_limit` plus a GraphQL `rateLimit` |
| `readReviewRecords(refs, prefix)` | 2 | one GraphQL read for the explicit refs, one REST listing for the prefix |
| `readReviewRecords(refs, null)` | 1 | no prefix listing |
| `listReviewRefsPaged` | 1 per 100-ref page | each page is a counted request |
| `readActiveReviewLeases` | 1 | one GraphQL read; also warms the commit base |

The rows returned by the prefix listing carry **no commit message**. Anything
that needs the message must look it up separately, and must test the message
rather than the record object - `record.commit` is `{message}` and stays truthy
even when GraphQL returned nothing.

## The page ceiling's headroom is illusory

`REVIEW_REF_PAGE_LIMIT` is 6, which reads like 600 refs of room per namespace.
It is not. The page limit is not the ceiling; the wire-request budget is, and
the two durable namespaces share it - one counted request per page each. Against
the current budget the cutover audit has room for roughly **500 assignment refs
and 200 replacement refs combined**, not 600 apiece.

Today the repository holds 370 assignment refs (4 pages) and 106 replacement
refs (2 pages), in namespaces that only ever grow. The operation will hit the
request budget before it ever reaches the page limit. The next person to read
the page constant will otherwise draw exactly the wrong conclusion from it, as
this lane did.

## Slot >=2 assignment costs more than slot 1

This branch and PR #1813 found the same slot-2 defect and fixed it two different
ways. #1813 merged first, so this branch defers to its design in full; what
follows describes the merged one, not the superseded one.

Under the merged design a fresh second-reviewer assignment spends 8 requests
BEFORE taking the mutex - the slot-1 preflight plus the extra
`resolveSlotOneReviewer` read, which stays pre-mutex - and must then still be
able to reserve `REVIEW_MUTEX_SECTION_RESERVE` (13) for the whole mutex-held
section. The entry gate is what that sum has to clear: 8 + 13 = 21, one under
`REVIEW_OPERATION_REQUEST_LIMIT`, so there is exactly one spare request.

#1813 derived that pre-mutex figure as 9, because `resolveSlotOneReviewer` cost
three wire calls there. On this branch the same resolve is batched into one
`readReviewRecords`, which costs 2, so the honest figure is 8. Taking #1813's
mutex placement together with this branch's cheaper resolve while keeping
#1813's arithmetic is half-applied accounting - mutex placement from one design,
resolve cost from another, the total from neither - and it went green. Two test
figures were corrected for this reason: the slot-2 assignment cost and #1832's
slot-2 replacement cost, which measured 16 rather than the 17 it pinned. Both
were verified from the call labels, not inferred: two `readReviewRecords` calls
and no `listRefs`/`readRef`/`getCommit` triple.

## The cutover's own reserve

Activation reserved a bare `15` - the in-lock reserve of the slot-2 design this
branch deleted when it deferred to #1813. It survived the merge as a number
attached to nothing, and it sat before the open-PR walk rather than at the mutex
acquire, so it guaranteed the release of nothing. Measured on this head: 10
requests are spent before the mutex and 9 inside it. The entry gate now asks for
18 (the 7 pre-mutex requests still to come, plus the reserve) and the mutex-held
section reserves 11 at its own acquire site, two above its measured spend. The
replacement ref listing runs inside that lock, so extra replacement pages and
per-ref commit fallbacks are in-lock spend.

Measured against merged `main`, on 2026-08-30:

| Operation | Measured spend | Ceiling |
| --- | --- | --- |
| Complete slot-2 assignment | 20 requests | 22 |
| Complete slot-2 replacement | 16 requests | 22 |
| Cutover activation with a live review, real page counts | 19 requests | 22 |

Reserved is not spent. The reserve is deliberately larger than the measured
in-lock spend, because a reserve must be at least the spend and erring the other
way is what put the operation into the hard wall mid-window in the first place.
Anyone re-deriving these numbers should compare a measured spend against the
reserve and expect the reserve to be the larger of the two.

The superseded fix on this branch moved the slot-1 resolve inside the lock and
used a slot-aware reserve of 15. It is recorded here only so the deletion of
`REVIEW_SLOT_N_LOCKED_WINDOW_REQUESTS` is legible: two fixes for one defect is
worse than either, so the constant is gone and the resolve stays pre-mutex where
#1813's reserve derivation assumes it is paid.

The tests assert this in both directions against the imported ceiling: below the
honest cost they require a clean pre-mutex refusal with no mutex taken; at or
above it they require the operation to complete within that cost.

## Sequencing decision: activate in the same session as the merge

The cutover is activated in the session that merges, not deferred to a later
one. A request-budget throw can land after the write has already succeeded, so
the operation reports failure for work that was done; recovery then depends on
the next run self-healing, which is a property being relied on rather than one
that was designed. Keeping activation in the merging session means a human is
present for that window instead of a later run inheriting it.

Merge order: PR #1799 lands only after PR #1813 raises the request ceiling. The
budget tests here assert against the imported constant, so they track the raise,
but they are re-run against merged `main` before merging rather than assumed.

## Slot-scoped replacements in the cutover reader

PR #1838 made the replacement WRITER slot-aware. The cutover READER was not: it
gathered replacements per pull request and applied one shared list to every
assignment on that PR, highest failure sequence winning. A slot-1 replacement
therefore overwrote the slot-2 assignment, the live slot-2 reviewer never got a
lease, and the busy probe went blind to a provider that was actually reviewing -
the double-assignment hazard this activation exists to prevent. Legacy
unsuffixed slot-1 replacement refs are deliberately still honoured, so the bad
state was reachable on today's refs, not only on historical ones.

The reader now binds each replacement to its assignment's own slot suffix, read
back off the assignment ref rather than assumed. A combined-state test seeds a
replaced slot 1 and a live, never-replaced slot 2 on one open pull request and
requires both reviewers to be leased. It was watched failing first, against this
branch merged with `main` at `a79ba256`: it reported the same reviewer leased
twice and the slot-2 reviewer not at all.
