# Registered stopped-merged claim recovery

This is a separately reviewed, exact-case operator succession lane for claim
4158, work issue 2421, and merged PR 4161. It exists because the ordinary
expired, relinquished, completed-work, and cooperative routes correctly refuse
this stopped state.

The operation accepts only the published request and manifest for this case.
It proves the exact merged source, migration reservation, original claim body,
both clean working copies, preservation bundle, review approval, current main,
stage leases, and a fresh app status observation before changing custody.
The only mutation is the claim's owner, worktree, bounded lease expiry, and
active capacity. It never closes the claim or work issue, changes source,
objects, branch, version reservation, or database data.

The observation is an operator attestation. `human_identity_authenticated` is
false: it is not provider-signed consent and cannot stand in for owner-issued
ready consent. A future structural session must check in again before work.

The receipt and its create-only ref bind the complete request, manifest,
initial observation, complete original and adopted claim bodies and hashes,
source merge, initial main, reservation, and timestamp. A changed request,
source, deadline or custody state cannot reactivate the operation. Each
fresh stopped observation is preserved in a separate create-only attempt
receipt, with the current proved main and the unchanged original grant window.

## Required sequence

The registered descriptor and the four capability files must first pass the
allocator-assigned independent review and normal guarded merge under #3618.
Run the entrypoint only from the resulting main tree. Supply the new capability
PR's exact approved head through `--review-issue 3618 --review-pr <capability-pr>
--review-head-sha <reviewed-head>`; PR 4161 is the preserved source, not the
capability review. The operation compares reviewed, main and executing bytes.

Keep the request, fresh observation and source bundle in protected private
storage. Pass their paths through `--request-file`, `--observation-file` and
`--preservation-bundle`; the last is separate from the immutable source artifact
reference. The descriptor binds the request, both working-copy path hashes,
original full claim body and bundle hash. No secret is an input.

Obtain a fresh native app status for the original chat immediately before use.
The exact stopped/completed observation expires after 120 seconds and is checked
again after network reads. Never replace missing evidence with a guessed status,
impersonate the original chat, manufacture ready consent, or resume a lease just
to wait for expiry. A newly appearing owner-ready receipt requires the ordinary
cooperative route instead.

The immutable receipt retains both complete claim bodies, their hashes and the
bounded permission deadline. Interrupted attempts retain that receipt. A fresh
stopped observation may retry within that original deadline; an immutable
attempt receipt preserves the new observation and current main. Neither retry
nor successful replay extends the deadline or restores stopped/changed custody.
A descendant main is accepted only after source, capability bytes, claims and
all live gates are proved again. Expiry requires a separately reviewed new
request; this entrypoint cannot silently grant a new deadline. If lock ownership is
lost or unreadable, the operator reports the attempted mutation and body hashes
without changing a foreign claim. Cleanup failure after verified success reports
`OPERATION_COMPLETED` and its receipt; reconcile that outcome before retrying.

After adoption, use the ordinary current-owner check-in before any structural
work. An ordinary claim release is separate from application acceptance: it
cannot close #2421, erase preserved work or certify its outstanding live checks.
The #4427–#4430 repairs each require fresh independent structural admission and
keep their own live-proof checklists on the same issues.

## Ownership and retirement

Issue #3618 owns this narrow tooling capability and any future consolidation.
The one registered case is deliberate. Generalizing the lane, changing the
reviewed descriptor or consolidating recovery modules requires a new prospective
contract and independent review. Existing recovery state refusals are unchanged.

The global mutex uses the existing recognized `claim-author-transfer-mutex`
kind, so the supported stale-mutex recovery can recover a hard-killed operator.
New direct local Git probes use the shared bounded timeout. Repeated reads of immutable
commit/file objects may be cached by exact SHA within one invocation; mutable
refs, claims, PRs, review evidence and filesystem checks are always re-read.
Both physical checkout roots and Git directories must differ, preventing a
symlink from redirecting successor custody back into the stopped source.
