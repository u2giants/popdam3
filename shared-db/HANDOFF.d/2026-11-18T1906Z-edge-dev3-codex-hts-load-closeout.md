---
issue: 6685
status: OPEN
owner: codex/6685-coordinator-closeout
---

# Shared database triage closeout and HTS load handoff

## 0. Business decisions

None. The remaining actions are operational and already have owners.

## 1. Application and repositories

[Shared-db](https://github.com/popcre/shared-db) owns the shared Supabase schema. DesignFlow's HTS research process scores tariff-classification cases and queries the shared database for similar products. PopDAM serves merchandise search from the same database. Heavy scorer reads raised PopDAM latency and caused viewer timeouts. [Incident](https://github.com/popcre/shared-db/issues/6685) · [HTS program](https://github.com/popcre/designflow-backend/issues/278) · [PopDAM acceptance](https://github.com/u2giants/popdam3/issues/1037)

## 2. Session goal

Update the shared-db checkout, select the three highest-priority open issues, and delegate each through normal release and live proof. Two are closed. The third, HTS load, remains open with separate named owners for the database backstop, DesignFlow change, and PopDAM acceptance.

## 3. Verified state and coordination

Snapshot November 18, 2026, 2:05 PM EST. Shared-db main was [0887d7f](https://github.com/popcre/shared-db/commit/0887d7fb3f47ef14705fe3c5d522c39e0f6806e4), with maximum committed version 20261218090000. Re-fetch before choosing a migration version or acting on any live state.

- [#6657](https://github.com/popcre/shared-db/issues/6657) is closed with live proof. [#6690](https://github.com/popcre/shared-db/pull/6690) retired the unsafe original. [#6694](https://github.com/popcre/shared-db/pull/6694) merged at [6b2921a](https://github.com/popcre/shared-db/commit/6b2921aeed3d3a124b728c661b75d8830a655367), and migration 20261218084807 applied in [preview](https://github.com/popcre/shared-db/actions/runs/44373477734) and [production](https://github.com/popcre/shared-db/actions/runs/44374236575). The probe proved worker and administrative use, three browser revocations, and continued PopDAM triage and seven CRM grants. Old forward versions were absent at delivery. [Signed proof](https://github.com/popcre/shared-db/issues/6657#issuecomment-6988452384)
- [#6658](https://github.com/popcre/shared-db/issues/6658) is closed. [#6692](https://github.com/popcre/shared-db/pull/6692) merged at [a5e29e6](https://github.com/popcre/shared-db/commit/a5e29e63409d2f986f451e9c457071fb4c9afe83). Official read-only checks proved four already-applied versions against the original apply receipts. No database changes were replayed. [Signed proof](https://github.com/popcre/shared-db/issues/6658#issuecomment-6985740881)
- [#6685](https://github.com/popcre/shared-db/issues/6685) remains open. Its database role claim belongs to the MiMo session named on [#6710](https://github.com/popcre/shared-db/issues/6710). [#6711](https://github.com/popcre/shared-db/pull/6711) was open; its scope is an eight-connection login backstop. Two preview-ready receipts exist for an earlier head, so recheck exact-head preview proof after subsequent changes. Uma owns [DesignFlow #458](https://github.com/popcre/designflow-backend/pull/458), open from sandbox-albert to develop. The PopDAM owner retains readiness and acceptance on [#1037](https://github.com/u2giants/popdam3/issues/1037).
- Shared preview is mutable. This session's grant version applied there without business-row writes. The foreign HTS backstop has earlier preview receipts; verify the current ledger and lease before any action. No shared database role, session, or lock from the HTS workstream was changed by our subagent. The automatic watcher listed [#6709](https://github.com/popcre/shared-db/pull/6709) parked and no held promotions at the closeout scan. Its owning workstream is separate.
- A closeout sweep exposed [#6693](https://github.com/popcre/shared-db/issues/6693), a lease-free property-lookup claim still attributed to the original Codex signature. [The successor reported taking custody of #6698](https://github.com/popcre/shared-db/pull/6698#issuecomment-6987585279), but the claim has no native owner or acceptance record. Preserve the other session’s source. [MiMo recorded the exact overlap](https://github.com/popcre/shared-db/issues/6693#issuecomment-6988713559): both PRs named version 20261218084708, already reserved for #6710/#6711. This can block #6711 rehearsal. Check both heads and current reservations before acting.

## 4. Failed attempts and false leads

- The original 16-way scorer had no live throttle or graceful drain. A login ceiling cannot disconnect existing pooled connections or bring an active workload under the four-query PopDAM readiness ceiling by itself. The isolated restart preserved the completed cases and reduced live load temporarily. A second launch later brought active readers back to 11–12. A one-run cap cannot govern separately launched jobs.
- The initial PopDAM retest had two searches over three seconds. All four passed on the second pass, then two were slow again on a later check. One fast pass is insufficient for release acceptance. [Recovery proof](https://github.com/popcre/shared-db/issues/6685#issuecomment-6985385233) · [Recurrence](https://github.com/popcre/shared-db/issues/6685#issuecomment-6986782339)
- The approved cloud worker password failed a fresh connection. The existing approved vault binding authenticated. The worker retained the approved fallback. Do not recover a secret from a process environment.
- [#6695](https://github.com/popcre/shared-db/pull/6695) removed the triage revocation from the old source and claimed 36 revocations. That version remains retired; the 36 did not ship. The earlier search for literal RPC calls missed seven CRM functions called through a helper. [Correction](https://github.com/popcre/shared-db/issues/6457#issuecomment-6988452633)
- #6694's first merge group was refused during a different production freeze. Main then passed its proposed migration version. The recovery agent verified both ledgers, reserved a higher version with unchanged SQL, and merged through the queue. [Final PR](https://github.com/popcre/shared-db/pull/6694)
- The original #6658 runs had already committed when catalog verification reported failure. Current checks prove the effects separately from recording delivery. Re-running the original migrations would be unnecessary and wrong. [Recovery receipts](https://github.com/popcre/shared-db/issues/6658#issuecomment-6985740881)

## 5. Delegated work and custody

### worker_load

Traced the I/O load to the nearest-product scorer, kept 33,385 completed results intact at takeover, and verified 34,006 total saved cases by 12:08 PM EST. The patched scorer limited concurrency and drained on shutdown. [DesignFlow change](https://github.com/popcre/designflow-backend/pull/458) passed the sandbox run and is with Uma. The exact private recovery registry is discoverable on the scoring host by issue number through the owner-only ai-devops recovery area. It retains the original checkpoint and tracks the resumed checkpoint outside temporary storage. The operational worktree is live and preserved. The agent finished its session, did not merge DesignFlow's develop PR, and left the release and runtime live-proof check open.

### popdam_grants

Retired the original release in [#6690](https://github.com/popcre/shared-db/pull/6690), confirmed live caller use, and narrowed [#6694](https://github.com/popcre/shared-db/pull/6694) to three evidenced worker-only permissions. Added regression and read-only checks for browser, worker, and named application grants. The first queue attempt was ejected. The work subsequently landed by the recovery agent. Its historical local copies have no delivery role; custody and incorporation must be proved separately before cleanup. The agent did not release the old broad set.

### delivery_verification

Merged [#6692](https://github.com/popcre/shared-db/pull/6692) and ran both exact read-only recovery checks. [#6658 receipt](https://github.com/popcre/shared-db/issues/6658#issuecomment-6985740881) closes the work. No database write or replay by this agent. Its merged source is durable; any historical local copy is outside the continuation path.

### clear_6694

Recovered the ejected queue entry by verifying both ledgers, renewing the version as 20261218084807, and landing [#6694](https://github.com/popcre/shared-db/pull/6694). Verified the governed production run and both database states, then posted the signed scope correction on [#6657](https://github.com/popcre/shared-db/issues/6657#issuecomment-6988452384) and [#6457](https://github.com/popcre/shared-db/issues/6457#issuecomment-6988452633). This agent's work is complete. It preserved foreign freezes, leases, and preview work.

## 6. Next actions and how to verify them

1. Re-read [#6685](https://github.com/popcre/shared-db/issues/6685), [#6710](https://github.com/popcre/shared-db/issues/6710), [#6711](https://github.com/popcre/shared-db/pull/6711), and [DesignFlow #458](https://github.com/popcre/designflow-backend/pull/458). Use current exact ownership. If the MiMo author owns the claim, coordinate via that issue and preserve it. A successor may act only after a governed acquisition. Success is current PR and release disposition with exactly one structural owner.
2. If the version collision persists, the owner of [#6698](https://github.com/popcre/shared-db/pull/6698) must reconcile #6693’s owner attribution through the supported lane and use a different reserved version for its migration, sidecar and registry entry. The owner of #6711 must independently recheck its own ordering against current main and update under its own claim if required. Success is two distinct valid versions or a natively parked source, with #6693 either released or accepted by its actual successor.
3. Check #6711's exact-version production evidence through the ordinary preview and promotion workflow. Verify the live worker login attribute by read-only probe and confirm a healthy scorer still commits results. Treat the ceiling as a backstop; aggregate active load must independently meet the readiness limit. Success is immutable production proof plus an advancing scorer.
4. Verify Uma released #458 through the normal DesignFlow path. The runtime owner reconciles concurrent scorer launches while preserving checkpoints and legitimate scoring. Check approved credential bindings if a restart fails. Confirmation requires sustained active load of four or fewer while the intended scorer advances.
5. With the PopDAM owner, run the ordinary-viewer controls on [#1037](https://github.com/u2giants/popdam3/issues/1037). Keep the existing search mode until the owner verifies the readiness and acceptance rules on that issue. Repeated four-of-four under three seconds and sustained shared load are required for acceptance. Record and close on [#6685](https://github.com/popcre/shared-db/issues/6685) only after the outstanding production proof succeeds.

## 7. Constraints

Use the current [shared-db rules](https://github.com/popcre/shared-db/blob/main/AGENTS.md), exact-object claims and supported version reservation. Shared writes use normal protected workflow only. Uma owns the DesignFlow develop release. The PopDAM owner controls search activation. Preserve both scorer checkpoints and the original release receipts, and never re-enable the retired revoke set. Keep the proof checklist on the original incident.

## 8. Access, documentation, and secrets

Use the installed GitHub and Supabase access routes documented for each repository. Identify the target immediately before each live read or approved workflow. Operational checkpoints and credential material remain private on the scoring host or in approved vault-backed storage. Closeout sweep found no new plaintext credential. The old revoke claim is superseded by the signed scope correction; no standing rule or unrelated documentation requires change.

## 9. Open risks and audit

As of the stated snapshot, the backstop and DesignFlow release were open. Existing pooled sessions may outlive a role change. Report aggregate active readers and checkpoint progress together. Early observations on activity, reservations, target ledgers and branch tips are point-in-time and require refresh. The closeout checker rejects the unresolved lease-free #6693 attribution. A PR takeover comment does not release or transfer the claim. The native release path requires a recorded exact owner, so preserve source and custody until that ownership is reconciled. The coordinator must rerun the installed closeout checker for the original session after the ownership operation.

Self-audit passed. Sections 1–3 identify the business use, work, and current owners. Sections 4–5 preserve failed approaches, contradictions, and evidence by agent. Sections 6–9 give ordered actions, verification, and constraints. Walking sections 1–9 uncovered no pending business decision for Albert. A fresh reader can use section 6 directly with the cited issues and receipts.
