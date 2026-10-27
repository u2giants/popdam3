# DesignFlow database release readiness

Work issue: #4655. Application outcome: popcre/designflow-backend#232.

This implementation is not activated or proven merely because its files exist.
The six application manifests must reach their default branches, canonical source
must pass independent review and guarded merge, and the centrally controlled
main merge protection must pass a live negative test (or a centrally controlled
deployment gate must be proven if native protection is unavailable). Until those facts are
recorded on #4655, no automatic release or enforced deployment hold is claimed.

## Current delivery update — October 27, 2026

Verified at 2:26 PM EDT. This supersedes the October 26 pending-source snapshot below without removing its historical evidence. All six source PRs (backend #241, Item Master #144, Tracking #158, data-syncing #82, BFF #64, frontend #384) and all six following production PRs are merged. No additional PR from Uma was identified.

| Application | Merged production PR | Production source |
|---|---|---|
| backend | [#243](https://github.com/popcre/designflow-backend/pull/243) | `8a21fb82410bb4e1b975ddfb15ad977e86a93a77` |
| item-master | [#146](https://github.com/popcre/designflow-item-master/pull/146) | `1f94e0f0e56509fc8299be8e87a6987ca752e37e` |
| tracking | [#160](https://github.com/popcre/designflow-tracking/pull/160) | `ff96fbb61870196920901931e512fb49bc9066bf` |
| data-syncing | [#84](https://github.com/popcre/designflow-data-syncing/pull/84) | `490be7b0b4b2c44cd83bf4d88d0a115fdd5b33d4` |
| bff | [#66](https://github.com/popcre/designflow-bff/pull/66) | `fa88b587230b82a7322ab3e3ba33d36781a70ea5` |
| frontend | [#388](https://github.com/popcre/designflow-frontend/pull/388) | `22562c6f6c11e67579aa77b7159e613a53155fa9` |

All six exact production sources have successful Cloud Build runs. Read-only Cloud Run service readbacks show every latest revision Ready and receiving 100% of untagged traffic. This proves deployment, not business acceptance. The broader issue #4655 remains open for the remaining notification/event evidence and application acceptance; do not repeat completed lock repairs or production promotions.

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
pairs, migration versions and paths remain unique. Tracking and frontend now
require the combined successor #4735 (version `20261024234538`, source SHA256
`98210290dca92fbbf9b8a995c4bbc13e8bd6af22d88e6ff8eb75c73984640d04`),
which production apply [40151562831 attempt 1](https://github.com/popcre/shared-db/actions/runs/40151562831/attempts/1)
delivered successfully. The later attempt 2 refused stale main and did not change
that successful attempt 1 delivery. The historical #4648/#4673 SQL files, reviewer refusals and preview
ledgers remain intact. Both original versions are permanently blocked from any
new allowlist by `HARD_BLOCKED` and classified as retired by the existing pending
version policy; no ledger row is fabricated and no historical claim is adopted.
Consumer manifests must name the actual successor before they can pass the
updated central baseline. Other requirements, including milestone persistence,
remain independent and are not declared delivered by this replacement.
Contract digests remain independent of this source list. A pending companion set reports `qualified-migration-train-required`
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

## Immediate consumer notifications: source and activation

Issue #4655 owns `config/designflow-consumer-release-notify.yml` as the canonical notification template. It uses JSON syntax (valid YAML) so its configuration tests require only Python’s standard library; no YAML package is required. The six eventual copies belong at `.github/workflows/designflow-db-release-notify.yml` in the named application repositories. Change the template first and keep all six copies byte-identical. Retire the copies and dedicated dispatch credential only after a native cross-repository event trigger replaces them and actual event delivery is proved.

The five-minute cron is a fallback, not a latency guarantee: actual scheduled runs 39902566401 and 39933299973 arrived at 12:51 AM EDT and 5:38 AM EDT on October 23, 2026; no later scheduled run existed at 9:35 AM EDT that day. Notifications reuse the existing central workflow, which independently reads current application heads, requirements and production proof. A notification supplies no release authorization.

The original dedicated App and six consumer notifications were already active before PR #4847; authenticated app-triggered observers and the October 26 completion batch prove delivery. The sequence below records the original provisioning design, not unfinished work. Do not recreate the App, reinstall it, regenerate keys or rotate credentials to roll out the updated template. Any future resource change follows the then-current owner policy and resource checks. Keep configuration activation, actual observer execution/status publication and real develop-event delivery distinct.

Historical provisioning sequence (completed; retain its constraints, do not replay):
1. Create a private GitHub App owned by popcre, requested slug popcre-dflow-db-release-dispatch, homepage https://github.com/popcre/shared-db, no webhook, no OAuth/client secret use, no organization/account permissions, repository Actions WRITE only plus GitHub implicit metadata READ. Install ONLY on popcre/shared-db, not all repositories. Do not modify the existing pop-ai-watchers App or existing status publisher permissions.
2. Generate one new dedicated private key; transport only via its protected downloaded file and pipes, store in 1Password vibe_coding with durable title/context/tags and actual App/installation IDs. Never expose values in chat, logs, arguments or commits. Delete no existing credential and perform no rotation.
3. Set the new dedicated key as repository Actions secret DFLOW_RELEASE_DISPATCH_PRIVATE_KEY in exactly popcre/designflow-backend, designflow-bff, designflow-frontend, designflow-item-master, designflow-tracking and designflow-data-syncing. Set public variable DFLOW_RELEASE_DISPATCH_APP_ID in those six repositories to the actual new App ID. No central SYNC_TOKEN or watcher private key is copied. The new key can mint only central installation Actions-write tokens; no repository contents, admin or database permission is granted. Actions-write includes cancellation/dispatch capability; review that explicit limited residual risk.
4. Add the exact workflow below to the six already-owned sandbox change sets, preserving all current app work. Publish through normal application process only after relevant production database prerequisites are proved; do not self-merge application PRs to develop/main. No commit hook, new required check, human reviewer requirement, new scheduler, runtime executor or deployed receiver/service. Keep central cron as fallback. Fork PRs receive no credential.
5. Before declaring activation, independently verify App permissions/install repository selection and each repository secret/variable metadata, then mint a bounded installation token in a protected local process, issue the SAME fixed workflow_dispatch request, and verify actual central observer execution and designated App status publication. Final develop event delivery remains tied to the normal app merge; do not simulate that by deploying app code or falsely claim it already occurred.

Recovery: before any activation preserve current App/secret metadata; changes are additive. If verification fails, leave notifications unactivated and repair within scope; do not remove existing checks/scheduler or weaken status-publisher binding. No production SQL or app runtime modification is part of these configuration actions.

The fixed template accepts only develop/main pushes and same-repository PR events targeting main. It checks out no application code and accepts no caller-provided workflow, ref or SQL. Repository Actions-write is the minimum dispatch permission but also permits cancellation/other Actions operations in shared-db; this residual risk remains explicit. The dedicated key is new, never the existing central operator credential or watcher key. No required check, commit hook, webhook receiver, scheduler or executor is added.

### Separate current-live reverification

When an original successful production apply archive is authentically unavailable,
`Production Catalog Verification Recovery` has an explicit
`current-live-reverification` mode. Its default remains the existing failed-catalog
recovery mode. This separate mode never applies SQL, reconstructs historical ledger
deltas, or grants application acceptance. Issue #4655 owns this mode; retire it only
when its callers and retained certificates have a reviewed replacement.

The mode requires the exact original successful attempt, all three successful
native jobs, authenticated upload identity, and positively authenticated artifact
404 or verified expiry. Every later attempt must have completed with its unique
production apply job skipped. Canonical merged source bytes, durable assigned
approval, ancestry, exact live ledger statements and enforcing catalogue assertions
are checked before a separately typed certificate is uploaded. Main/source/approval
and the original attempt counter are checked again before publication.

The central observer independently checks its existing fresh live ledger and
catalogue. Native dependency checks consume the trusted completed Recovery
certificate through GitHub only; they do not claim to have queried the database.
The additive outcome proof kind is `shared-db-current-live-reverification/v1`;
original apply pins remain mandatory, and legacy recovery fields cannot be mixed
with this kind. A verified database stage still requires the existing native stage
publisher and a genuine evidence comment. Neither certificate nor stage closes
application live proof or changes who releases DesignFlow applications.

The certificate's exact metadata-only inner ZIP is signed by GitHub artifact
attestation from this Recovery workflow on the exact main commit and run attempt.
Verification pins the GitHub OIDC issuer, workflow, source commit/ref, immutable
repository and owner identifiers, invocation, and subject SHA256. Only the two
named metadata files are allowed; no business rows or secrets are included.
The uploaded outer Actions archive is authenticated by its GitHub digest during
initial capture. Its storage identifier/digest records transport history; it is
not the lasting acceptance authority and no expired outer archive is reconstructed.

A create-only receipt retains the exact inner ZIP and signature bundle, bounded
together with its metadata to 96 KiB. After positively authenticated outer404 or
verified expiry, the same signature and fresh canonical producer/source checks
still apply. Available storage metadata mismatch,403,network failure, malformed
signature or unavailable trust always refuse. Changing any authorizing receipt
field must disagree with the signed inner subject and refuse. A bare Git ref or
bot identity never substitutes for cryptographic verification. Ordinary native
checks receive no production credential; their database state claim is the signed
read-only workflow observation, while central readiness still checks its own
fresh ledger and catalogue.

### Maintenance recovery while a migration rehearsal is pending

The merge queue's preview ordering hold applies to migration-bearing groups.
Maintenance may repair the evidence needed by a pending rehearsal; it creates no
preview success status and grants no database authority. The next migration group
selects the latest migration-bearing commit on main's first-parent history, even
when maintenance commits intervened, and still requires that exact commit's
successful rehearsal. Missing history, malformed identities and unreadable status
remain refusals. Existing review, authorization, merge lock and production freeze
checks apply to every group. Tracked with the delivery-evidence repair on #4655.

### Tracking current-state recovery assertions (#4655)

The original successful Tracking apply remains the historical producer. A current
catalogue report with no behavioral assertions cannot replace its unavailable
archive: `validateCurrentLiveBinding` deliberately refuses that report, even when
the enforcing catalogue verifier exits successfully. Recovery run 40220100990
exposed this missing coverage; it produced no certificate and reapplied nothing.

Trusted main must first register the fixed verifier-owned installed-state contract
for the Tracking link view and its bounded access model. Only after that registration
lands may a separate change add the exact-hash sidecar for `20261024234538`;
the guarded merge checker deliberately rejects an unknown contract before then.
It does not authorize SQL from sidecar input, change the applied migration, claim
historical ledger changes, settle unrelated role drift, or prove application
acceptance. The same signed certificate, original-attempt identity, approval,
source fingerprint, current-main and subsequent native stage gates still apply.

The self-contained PostgreSQL17 fixture runs in the normal tools CI job, with
view-definition, index, RLS, policy and grant-option mutation negatives. Each
completion check records its own freshly captured output; the rejected generation46
record remains unchanged in history and its immutable published contract.

### Retained certificate storage remains bounded (#4655)

A real current-live producer carries the complete authenticated original run,
job and later-attempt facts. Its signed metadata ZIP can exceed the receipt's
96 KiB limit after base64 encoding. New receipts therefore store that exact ZIP
with lossless gzip compression; the signed ZIP itself and attestation bundle
are unchanged. Legacy uncompressed receipts remain readable. The reader rejects
mixed encodings, malformed data, receipts above the unchanged 96 KiB limit and
ZIP expansion beyond the existing 4 MiB authenticated-package bound. Restored
bytes must still pass the original signature, producer, source and ledger checks.
This storage change grants no new production or application acceptance.

Existing immutable receipt references are preserved when a lossless encoding
changes. Their restored ZIP and bundle must exactly equal the newly authenticated
candidate bytes and all source, ledger and proof fields must remain identical.
A different encoding never authorizes a changed certificate or rewritten reference.

### Local RLS benchmark statement boundaries (#4655)

Tracking producer delivery exposed two consecutive queue failures in the unchanged
`rls_public_admin_initplan_contracts.sql` timing fixture. Its single `DO` statement
ran all 198 samples under one 30-second PostgreSQL statement timer. The repair
executes the original nine cardinality/command cells as separate statements,
each still bounded by that same 30-second timer. This intentionally changes the
aggregate timer boundary; it does not increase the per-statement setting or the
workflow job budget.

All three row sizes, three commands, alternating original/candidate pairs, one
warmup plus ten measured pairs per cell, actual authenticated nonowner/nonbypass
execution, sample rollback, exact 198-sample completeness, and final policy/ACL/
helper/RLS/owner restoration checks remain. Raw plans and timings are retained.
The temporary batch function and all fixture changes stay inside the existing
rollback-only disposable database test. This grants no shared-preview or
production execution authority and supplies no live application acceptance.

Current-live artifact readers preserve the two exact ZIP and attestation members as binary bytes before authentication. Unexpected, missing, empty or oversized members fail closed. Generic text proof readers retain their existing behavior. This changes the verifier source closure and requires a fresh signed current-live run after merge; prior certificates are retained as historical evidence.

The pinned attestation build type is `https://actions.github.io/buildtypes/workflow/v1`, confirmed in the official CLI’s authenticated result for [current-live run40258907625](https://github.com/popcre/shared-db/actions/runs/40258907625). The previous synthetic URI and all unrecognized types are rejected; the remaining certificate and provenance checks are unchanged.

Declared release requirements use a separately named read-only merged-source identity binding when GitHub has no closing link. The existing body, current completion, migration-version and permanent reservation checks remain mandatory; conflicting real links refuse. This changes the trusted reader closure and requires a fresh certificate after merge.

Read-only source identity accepts genuinely open or closed work after proving the same immutable merged-head evidence, published contract and reserved migrations. Admission and reviewer bindings still require open work, with no closed-work option or state override.

## Consolidated mirror notifications (issue #4655)

The canonical sync workflow sends one readiness notification after the complete consumer-sync matrix, including partial failure or cancellation. It reads the actual current application heads through the existing readiness workflow. A failed sync stays failed; the notification does not certify delivery or copy any status. The normal periodic fallback and every production proof, App binding, and exact-head readiness requirement remain unchanged.

Rollout is additive: merge and prove the central completion notification before activating the consumer filter. Keep existing consumer notifications active until that proof exists. The canonical consumer template skips only an authenticated mirror-only push: its bot identity and message must match, and bounded root-tree metadata must prove that only the shared-db tree changed. Real application changes, mixed changes, relevant production PR events, unknown metadata, and API errors all retain their normal notification. Filtering affects duplicate delivery only, never readiness decisions or pending/failure/success publication.

Issue #4655 owns the template and all six byte-identical consumer copies. Unit tests exercise the actual classifier and completion dispatch, including partial failures, malformed metadata, mixed changes, and dispatch failures. Synthetic tests do not replace actual central dispatch and consumer rollout evidence recorded on that issue.

### Verified delivery and remaining rollout — October 26, 2026

This is a dated delivery record, not authority to reuse a stale commit stamp. The
coordinator's complete evidence and merge list are on
[issue #4655](https://github.com/popcre/shared-db/issues/4655#issuecomment-6428912824).
Read current PR heads and current checks before acting; preserve the completed
repairs, parked source and unrestricted sandbox/develop commits.

| Outcome | Verified state | Next owner / proof |
|---|---|---|
| Dependency locks in Backend, Item Master, Tracking and Data Syncing | Done in the prepared source: unchanged locks recovered from successful production images, frozen installs and both environment suites passed | Do not regenerate or upgrade these dependencies as part of notification rollout |
| Central completion notification | Done: [PR #4847](https://github.com/popcre/shared-db/pull/4847), merged as `d1b88949f17c6c53087b997bfa6c45b3cf5c5439` | Preserve every existing readiness decision, status publisher and production check |
| Six consumer workflow updates | Source prepared; all six PRs remained open at 8:12 PM EDT on October 26 | Uma merges the source PRs below through the existing application process |
| Production delivery of this follow-up | Open; sandbox evidence is not production delivery | Uma performs normal develop-to-main promotion with all existing checks; coordinator records subsequent runtime proof on #4655 |
| Active consumer filtering | Open until the consumer workflows reach their default/release branches | Coordinator proves a real mirror-only push is suppressed and a real/mixed application change still notifies; keep live proof open on #4655 |

The complete source PR list is [Backend #241](https://github.com/popcre/designflow-backend/pull/241),
[Item Master #144](https://github.com/popcre/designflow-item-master/pull/144),
[Tracking #158](https://github.com/popcre/designflow-tracking/pull/158),
[Data Syncing #82](https://github.com/popcre/designflow-data-syncing/pull/82),
[BFF #64](https://github.com/popcre/designflow-bff/pull/64) and
[Frontend #384](https://github.com/popcre/designflow-frontend/pull/384).
These target develop; do not self-merge application PRs. Existing appearance,
linked-item and session-revocation work in those shared sandbox PRs is preserved.

Actual [batch 40411453210](https://github.com/popcre/shared-db/actions/runs/40411453210)
completed nine consumer mirrors and one completion dispatch. Its first observer
was replaced in the existing legacy notification burst. A subsequent unchanged
[batch 40411909589](https://github.com/popcre/shared-db/actions/runs/40411909589)
proved isolated delivery to exactly one correlated
[observer 40411985776](https://github.com/popcre/shared-db/actions/runs/40411985776),
which reported all twelve develop/main snapshots READY. Actor, canonical main
SHA and creation time were bound to the completion job. The original per-app
notifications remained enabled during that proof. Seventeen tests covered the
actual classifier and dispatch, including partial failures and mixed changes;
these synthetic negatives are not a claim of an actual failed-mirror exercise.

At 6:33 PM EDT on October 26, all six final source heads had green checks and
successful sandbox builds, and their Ready revisions served 100% traffic with
image digests matching the exact successful builds:

| App | Verified sandbox source head | Build | Ready revision |
|---|---|---|---|
| Backend | `0237b66106075eef27e83910eba8127d728aa764` | `fd43d6d2-a2cc-470a-920f-5a41674a837b` | `popcre-albert-core-sandbox-00904-qkj` |
| Item Master | `af32389e9b5e1d5da04a7ed325bd839f444b4cf1` | `5dd4bf12-eebe-4310-b5ea-3ff20845ab8a` | `popcre-albert-item-sandbox-00207-xvv` |
| Tracking | `2c0ebbf8f97364fed87333aa2a7269adc4b4c6ce` | `8c42b9df-2b61-49df-b30d-ef3fb424ed5d` | `popcre-albert-tracking-sandbox-00460-7bf` |
| Data Syncing | `d479f5980bf91bce6d92794d0c468dd493b6c5bd` | `0d07e367-5d7a-463b-8354-d447fa917449` | `popcre-albert-sync-sandbox-00153-8kd` |
| BFF | `afb0678dfda9be03452fa9ad9e116174fa1bcbbe` | `5a177c70-ff79-40e5-a92a-5420b0f1d653` | `popcre-albert-bff-sandbox-00131-kgh` |
| Frontend | `233d2394c6c0c89f0164e27c4703372445eca8a2` | `d0af073d-3ae3-4935-9871-cbf734cc29a8` | `popcre-albert-frontend-sandbox-00735-bks` |

Frontend advanced to `b180879cfc8c1d6ff8f6ec471694903fd4249700` by the
8:12 PM EDT documentation readback. Its reported GitHub checks, including its
sandbox build check, were green. The table's earlier live-image observation
remains historical and does not independently prove that newer image is live.
The other five PR heads still matched the table. Re-read all heads, checks and
runtime images before claiming present delivery; do not redo completed repairs.

### Dependency locks and environment-safe tests

Tracking's production build `191c2f89` failed because one business-behavior test
assumed the development schema for AuditLog. The existing repairs in Tracking
#156/#157 are preserved. The incident does not justify removing explicit schema
expectations from tests whose purpose is schema mapping.

Backend, Item Master and Tracking now carry the unchanged production `yarn.lock`
and require Yarn Classic 1.22.22 with frozen installs. Data Syncing carries the
unchanged production `package-lock.json` and requires npm 11.19.1 with `npm ci`;
its historical Yarn lock remains preserved but does not govern npm installs.
Docker build contexts exclude local node_modules. Dependency definitions were
unchanged apart from package-manager metadata; this was not a dependency upgrade.

Their automatic unit matrix runs the complete mocked suite for production and
develop on PRs and sandbox pushes. Install the full locked test dependencies
before setting the test environment. Production tests use `NODE_ENV=production`
and `SCHEMA=dflow_prod`; develop tests use `NODE_ENV=develop` and an empty
`SCHEMA`. No production database credentials or live writes belong in these tests.

The final matrices passed for Backend (225 suites, 2604 tests per environment),
Item Master (61 suites, 647 tests), Tracking (124 suites, 1670 passes and one
existing skip) and Data Syncing (25 suites, 260 tests). Existing inherited
environment assumptions found in Backend and Item Master were repaired while
retaining independently expected schema assertions. Controlled mismatches also
proved that both frozen Yarn and npm ci refuse manifest/lock disagreement.
Frontend's recorded image build ran its full unit suite and sandbox AOT build;
it was not a production deployment or a production-configuration build claim.

Follow the consumer testing rule in [development](development.md#designflow-consumer-environment-tests).
The app repositories' own development guides contain their exact install and
test commands. Shared-db itself has no package.json and no app test runtime.
