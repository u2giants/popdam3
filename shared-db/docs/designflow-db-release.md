# DesignFlow database release readiness

Work issue: #4655. Application outcome: popcre/designflow-backend#232.

This implementation is not activated or proven merely because its files exist.
The six application manifests must reach their default branches, canonical source
must pass independent review and guarded merge, and the centrally controlled
main merge protection must pass a live negative test (or a centrally controlled
deployment gate must be proven if native protection is unavailable). Until those facts are
recorded on #4655, no automatic release or enforced deployment hold is claimed.

## Release identity and source custody

Each application records `.release/database.json` with its exact canonical source
PRs/issues, migration paths/content hashes, and bounded table/column/runtime-role
contracts. The parser accepts only six named applications, the configured
production project, bounded identifiers, known fields, and fixed privilege names.
No manifest SQL, shell, repository code, or arbitrary endpoint is executed.

`config/designflow-db-releases.json` is the reviewed central policy. It pins each
application's contract fingerprint, minimum baseline source requirements, schemas
and runtime roles. Empty or weakened application requirements cannot erase that
baseline. Baselines are application-specific, derived from actual consumers:
backend needs role/model prerequisites and WeChat; tracking needs template fields,
PO/raw-history access, milestones and archive; data-syncing needs the item sync
fields; frontend needs roles, WeChat administration, unmatched orders and archive.
BFF has no new-source dependency among these repairs. Item Master and the frontend
also require the production UPC view/access repair (#4659), discovered by an actual
read-only query under the deployed Item Master identity; Item Master checks both
the currently deployed and intended service-specific readers. An unrelated
application prerequisite must not hold a healthy app release.

Database changes must update the canonical migration, this policy and
the consuming application's manifest together. Agent/app workflow guidance must
retain that requirement; automatic promotion does not capture ad-hoc sandbox SQL.

Before accepting a requirement, the observer proves its PR is merged into canonical
main, links exclusively to its work issue, declares exactly its authored migration
set, and has the same migration bytes at its author head and current main. Changed,
omitted, rewritten, forked or unmerged sources refuse. The current archive metadata
correction remains blocked until its authentic preserved-source route is resolved;
do not weaken content validation to conceal that correction.

## Existing promotion only

The central five-minute observer checks develop and main snapshots. Only develop
can initiate promotion. It asks the existing native preview selector for a stored
`merged_rehearsal` instruction and accepts only the exact required source PR,
versions and current canonical main. The native issue/PR admission check is read-only:
closed unfinished work is returned to its existing owner rather than silently
reopened. An existing authenticated current ready record is reused without taking
the global mutex or adding another issue event. First preparation rechecks under
the native admission mutex and invokes the existing native preparation once;
partial event/ref writes stop for reconciliation. Existing guards, reviewer evidence, claimed
source custody, risk assessment and preview/production locks remain authoritative.

Dry-run and apply are sequenced across bounded observer runs. Each native dispatch
is preserved before its single API write. The migration workflow's deterministic
run name uses its existing inputs; no 26th input or alternative SQL apply path is
introduced. A recorded dispatch whose run has not appeared yet stays pending and is never
replayed. An ambiguous, failed or uncertain dispatch requires authentic reconciliation.
Ordinary waiting does not fail the scheduled observer; a blocked proof does.
Full synthetic database tests run for source PRs and manual runs, rather than on
every scheduled read. A timed-out write is never replayed as if it had not happened.

Successful native production evidence is verified by the existing exact-source
artifact verifier plus archive-byte digest, exact migration-content hashes,
enforced catalog results and successful canonical producer jobs. Before expiring
Actions artifacts can make an old prerequisite unverifiable, the observer preserves
a compact create-only receipt under `refs/designflow-db-apply-receipts/`. Its owner
is #4655's canonical release process; one record binds each required source head.
Each reuse rechecks canonical source/producer ancestry and fresh SHA256 fingerprints
of the production migration ledger. A changed ledger or source refuses. These
receipts contain metadata/hashes, not business rows or credentials. Retain them
while any application policy references that source; retirement requires a scoped
review after every consumer has removed the dependency, never age-based deletion.
Current read-only production catalogs independently check the
declared columns, schema access and runtime privileges. Already applied source is
idempotent success only after both checks. No application data is queried or copied.

The existing central `SYNC_TOKEN` authenticates canonical operator effects and
cross-repository source reads. A separate short-lived token from the existing
`pop-ai-watchers` App (ID5112061), limited to the six application repositories,
publishes statuses with status-write and content-read permissions. The publisher
refuses another identity or a missing token; there is no PAT fallback for statuses.
The existing central Supabase credential performs read-only catalog inspection.
Neither credential is distributed to applications. Repeated source/evidence reads
are cached within one observer run, and the observer preserves an API reserve.

## Readiness is separate from release enforcement

Statuses and a digest-bearing Actions artifact bind each result to an exact app
commit and manifest. Main readiness additionally requires an actual merged PR
from that repository's develop branch and an identical source tree. A main snapshot
with missing production requirements waits; it never initiates a belated apply.
Application acceptance and business acceptance remain separate from database
readiness. A failed or waiting result is never reported as ready.

The initial audit found GitHub Free and private protection queries returned an
upgrade restriction. Albert authorized GitHub Team for two seats up to $8/month
before tax; GitHub billing and organization API now confirm Team with two seats at that amount. Record protection
configuration and enforcement proof on #4655 before claiming the gate is active.

After Team is active, the preferred enforcement is native main protection for the
six apps: require the `database/production-ready` status specifically from App
ID5112061, require an up-to-date pull request, enforce for administrators, and permit
no bypass, forced update or deletion. Preserve any stricter existing protections.
Prove a missing/failed/wrong-App check cannot permit a main merge. Keep the existing
six production triggers on main, and retain Uma's application merge authority.
The process does not automatically merge application code.

This native main gate can satisfy the requested pre-main protection without adding
a new Cloud Build wrapper or mutating production infrastructure. Such a wrapper was
proposed while private main protection was unavailable; it is not an activated
capability. The infrastructure repository's production-forbidden policy remains
intact. If native protection proves insufficient, return to a reviewed supported
infrastructure route rather than changing triggers ad hoc.

Routine commits and sandbox source pushes acquire no new approval gate from this
process. The required status applies to the final main release only and uses the
existing structural review. The scheduled observer checks every five minutes;
scheduling may be delayed by GitHub, so measure actual release latency before
claiming any bound. An on-demand canonical run may refresh an exact release
without weakening its checks.

Statuses record a verified snapshot. GitHub does not give commit statuses an
application-defined expiration time; the central observer rechecks the current
heads every five minutes. Do not describe a cached green status as continuous
production proof or general application acceptance. Database changes continue
through the existing consumer-safety, rehearsal and production checks.

The observer checks out the exact workflow producer SHA and refuses checkout
source drift. A pinned App identity prevents a user token or application workflow
from supplying the required central readiness status. It does not prevent an
organization owner from deliberately changing protection settings.

## Verification and recovery

Tests cover strict source/manifest validation, role/policy weakening, absent evidence,
exact-commit drift, fail-closed statuses, idempotency and bounded preview identity.
Synthetic PostgreSQL tests prove actual query behavior for positive column grants,
schema/table/column/role denials, write privileges, empty contracts and read-only
transaction enforcement. These are not production or application acceptance.

Recover uncertain native operations through their existing issue and immutable
records, never by deleting dispatch custody or releasing another author's claim.
Roll back defective observer source through the guarded repository route; retain
the last valid application runtime while readiness is unavailable. Structural
rollback remains a new reviewed forward migration.

## Exact protection activation inputs

Each application's `main_protection` in the central policy records the complete
read-only baseline, its canonical JSON SHA256, and the exact desired GitHub request.
The production-class action is reviewed against those inputs at the final source
head. Immediately before each write, compare the complete live baseline again;
abort on any drift. Preserve frontend's existing required review. No setting applies
to sandbox commits or develop commits. The exact synthetic probe is sealed in `enforcement_probe`: temporary branches
only, cloned protection payload, missing-status and wrong-publisher rejection,
then cleanup of only the owned probe resources. Their names must not match
application deployment triggers. A missing status may not be replaced by a
manual success; the wrong-publisher probe deliberately proves this restriction. Read
back main protection after activation and record publisher-bound enforcement proof
on #4655. No actual main push or application release is used as a negative test.

GitHub's protection request uses only `required_status_checks.checks`, including
the designated App ID. Do not also send `contexts`, even an empty array: the REST
schema rejects the overlapping alternatives with HTTP422. An absent baseline is
a positively authenticated `404 Branch not protected` plus a verified branch,
sealed as JSON null and its SHA256; it is not unknown or missing evidence. A fresh
complete read must still match that absence immediately before activation.


## Companion sources on one application issue

A requirement identifies one canonical source PR and exactly the migrations it
added. Two different source PRs may implement the same issue; PRs, issue/PR
pairs, migration versions and paths remain unique. Tracking and frontend require
both #4648 and its #4673 companion. Contract digests remain independent of this
source list. A pending companion set reports `qualified-migration-train-required`
and never starts its members as unrelated single-source promotions. An operator
must qualify the existing native train; this observer grants no train authority.

A successful combined apply may satisfy each original requirement only through
its complete native train proof. The observer authenticates the canonical run,
attempt and successful guard/review/apply jobs. The original guard-job log must
name exactly one dispatched train input, and the immutable record must reproduce
the native train identity, production target, main SHA and full allowlist. Every
entry is independently checked against its actual merged PR, current source
bytes and source issue; the entire ledger delta, manifest hashes and enforced
catalog must match. A subset or unrelated artifact cannot stand in for the batch.

Version 2 immutable receipts retain the complete train/source map and full live
ledger fingerprints alongside the individual requirement identity. On reuse,
the original archive, producer, train, all current sources and the entire live
ledger are authenticated again. Missing or expired archive/log provenance,
changed source, partial apply or ambiguous maps refuse readiness. Existing
version 1 single-source receipt checks and promotion behavior remain unchanged.
