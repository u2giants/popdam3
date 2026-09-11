# OPA route compliance: structural and private-loader contract

Issue #2703 adds source-observation rights evidence; it authorizes no licensed-row
load. Existing Property identities, style relationships, ColdLion records and
Creative mappings remain intact. The existing OPA Property/Character capture
tables retain their separate two-route contract and are not reused here.

## Private input and required binding

The private source repository is `u2giants/licensor-source-data`, PR #72, immutable
head `7d8c7e8d6f2475ac0ce52e9f2b1be614e462c4ff`. Its `disney-opa/` inputs are:

- `opa-capture-20260910-disney-compliant-only.csv`
- `opa-capture-20260910-disney-show-all.csv`
- `opa-capture-20260910-lucas-compliant-only.csv`
- `opa-capture-20260910-lucas-show-all.csv`
- `opa-capture-20260910-two-view-manifest.json`

These private files stay private. The rows have headers `property`,
`licensedPropertyID`, `optionSourceID`, `character`, `characterID`, `brandPropertyID`.
The manifest does not establish every region, product-type and account/authentication
dimension. A reviewed private companion specification must bind those dimensions
to both views. Never borrow the unrelated existing capture tables' route constants,
infer an account, or infer a route from a name. This prerequisite blocks a real
load, not synthetic structural testing.

For each exact route/account pair, recompute file hashes, headers, numeric-ID
validity, duplicate relationship counts, distinct Property counts and relationship
counts from the files. Let C be the distinct compliant Property IDs and A the
distinct Show All IDs. Require C to be a subset of A and the compliant
Property/Character relationship set to be a subset of Show All relationships.
Empty C, including a complete empty A, is valid. Store `compliant` for C and
`non_compliant` for A minus C. A missing landing Property ID refuses the load;
this change never invents landing or curated entities.

## Loading and sealing

The private loader first emits an aggregate-only dry-run: counts, hashes,
missing-ID count and mismatches. A separately authorized, freshly target-proven
load may then insert one `plm.opa_property_compliance_capture` per paired route.
Record the immutable source commit, manifest/file hashes, exact route, account-scope
hash, authentication proof/time, paired-validation proof, counts and evidence
reference. Never store credentials, cookies, signed URLs or raw account identifiers.
The paired-validation hash identifies the private reviewed attestation containing
all recomputed checks and the companion route/account binding. The database cannot
read the private CSVs: the loader must verify their actual bytes before presenting
that attestation, rather than trusting manifest booleans.

Capture insertion always starts `loading`. Append membership observations with
the exact capture UUID, capture identity, full route and source observation time.
Each observation requires its own approved evidence attestation before it can
participate in a completed capture. Membership approval is immutable: an already
pending/rejected observation cannot be edited into approval. A later reviewed
observation requires a new capture identity retaining the original source time.

The membership digest is lowercase SHA-256 of UTF-8 text formed from rows ordered
by numeric `licensed_property_id`: `ID:compliance_status`, separated by one LF,
without a trailing LF. An empty set hashes the empty string. The loader supplies
the expected digest; the server computes it independently from loaded rows.

Call `plm.finalize_opa_property_compliance_capture(capture_uuid, approver)` through
the private loader role. It locks the parent capture and validates actual loaded
Property/compliant counts, membership digest, approved memberships, file-validation
attestations, relationship counts/subsets and duplicates. Same-time conflicting
observations for the same Property/route/account refuse rather than using an
arbitrary identifier as a tie-breaker. A route/account transaction lock serializes
those comparisons. The membership insertion trigger takes the same parent-row lock;
post-completion insertion and mutation are refused. Exact repeated finalization of
the already sealed capture is idempotent; a reused capture key with differing
source evidence is not a new observation and must refuse.

Incomplete/rejected captures never affect current rights. No source row is
deleted because it was absent from a capture. Failed loading evidence stays
retained; no partial capture may be presented as current.

## Current-rights read contract

`plm.opa_property_current_compliance` returns the newest approved complete explicit
observation for each Property and full route/account scope, ordered by source time,
not review time. Legacy approved memberships remain visible as `unknown` with no
asserted account scope. Never treat unknown as evidence that rights never existed.
Consumers must match every route/account field and require
`eligible_for_new_styles` or `eligible_for_new_coldlion_entry`; they may not borrow
eligibility from another route or account. Historical source presence, studio
classification and mapping do not provide this permission.

Missing from a later complete Show All means no new explicit observation. The last
explicit state remains and `absent_from_newer_complete_capture` flags the gap for
review. A later explicit compliant observation may reactivate a revoked route.

The authorized Data Admin RPC keeps its signature, source population, mapping and
studio presentation. Its `current_rights` array exposes exact-route/account status,
observation time and both eligibility flags for OPA and mapped Creative identities.
`current_rights_status` is a display summary (`compliant`, `non_compliant`, `unknown`
or `route_specific`), not a permission to select an unspecified route. Existing
`source_status` describes retained source/studio provenance; it must never be
used as a current-rights permission. The structural change does not claim that an
external application's selection UI has adopted this read contract.

Production acceptance requires migration/catalog proof and authenticated Data Admin
visibility/performance. Loading PR #72 and application selection integration remain
independent operations; no licensed rows are loaded by this migration.
