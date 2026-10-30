// #5141 — the io-bound half of the unapplied-migration-edit subset proof.
// The pure decision lives in scripts/db-flow/admission.mjs
// (structuralWritesMatchUnappliedEdit); this module gathers the facts that
// decision needs from live coordination state so every caller runs the SAME
// proof:
//
//   1. the applied-migration ledgers (preview + production), read through the
//      io hook `appliedMigrationVersions()`, which fails closed exactly like
//      every other ledger-reading guard; and
//   2. the pull request's branch-bound ACTIVE claim — the same definition the
//      exclusive merge lane uses (legacy leases never match, and the claim
//      must not have expired). Exactly one must exist; zero or several is an
//      unknown, not a pass.
//
// Nothing here admits anything on its own. Every unreadable fact throws, so an
// operator sees which condition failed instead of a generic exact-match
// refusal that an edited migration can never satisfy.
import { parseAuthorLease } from './claims.mjs'
import { fileMatchesLedgerStatements } from '../../check-applied-migration-edit.mjs'

export class UnappliedEditSubsetError extends Error {}

export function branchBoundClaimWrites(branch, io, { now = new Date() } = {}) {
  const refuse = (reason) => { throw new UnappliedEditSubsetError(reason) }
  if (typeof branch !== 'string' || !branch.trim()) refuse('the pull request head branch is unreadable')
  if (typeof io.openClaims !== 'function') refuse('open claims are not readable through this io, so the branch-bound claim cannot be proven')
  let claims
  try { claims = io.openClaims() } catch (error) { refuse(`the open-claim listing failed: ${error.message}`) }
  if (!Array.isArray(claims)) refuse('the open-claim listing is unreadable')
  const matching = []
  for (const claim of claims) {
    let lease
    try { lease = parseAuthorLease(String(claim?.body ?? ''), now) } catch (error) { refuse(`claim #${claim?.number ?? '?'} is unreadable: ${error.message}`) }
    if (!lease.legacy && lease.branch === branch && lease.active) matching.push({ ...claim, lease })
  }
  if (matching.length !== 1) {
    refuse(`exactly one active branch-bound claim is required for branch ${branch}; found ${matching.length}${matching.length ? ` (${matching.map((claim) => `#${claim.number}`).join(', ')})` : ''}`)
  }
  const writes = [...(matching[0].lease.writes ?? [])]
  if (!writes.length) refuse(`claim #${matching[0].number} holds no writes`)
  return { claimNumber: Number(matching[0].number), writes }
}

export function appliedLedgerVersions(io) {
  const refuse = (reason) => { throw new UnappliedEditSubsetError(reason) }
  if (typeof io.appliedMigrationVersions !== 'function') refuse('the applied-migration ledgers are not readable through this io (fail closed)')
  let ledgers
  try { ledgers = io.appliedMigrationVersions() } catch (error) { refuse(`the applied-migration ledger read failed (fail closed): ${error.message}`) }
  if (!ledgers || !(ledgers.preview instanceof Set) || !(ledgers.production instanceof Set)) refuse('the applied-migration ledgers came back unreadable')
  return { ...ledgers, previewIdentical: new Set() }
}

// The sanctioned preview continuation (#5141 cure, mirroring the edit guard's
// PR #2933 exception): a version this same pull request's rehearsal applied to
// preview is excused ONLY when the preview row's recorded statements are
// reproduced exactly by the file at the pull request head. Any unreadable row,
// unreadable file body, or byte difference stays unexcused (fail closed).
export function previewVerifiedIdentical(migrationFiles, ledgers, io, { readFileAt }) {
  const refuse = (reason) => { throw new UnappliedEditSubsetError(reason) }
  if (typeof io.previewLedgerStatements !== 'function') refuse('preview ledger statements are not readable through this io (fail closed)')
  const verified = new Set()
  for (const row of migrationFiles) {
    if (!ledgers.preview.has(row.version)) continue
    let statements, body
    try { statements = io.previewLedgerStatements(row.version) } catch (error) { refuse(`preview statements for ${row.version} are unreadable (fail closed): ${error.message}`) }
    try { body = readFileAt(row.name) } catch (error) { refuse(`${row.name} at the pull request head is unreadable: ${error.message}`) }
    if (body === null || body === undefined || typeof body !== 'string') refuse(`${row.name} at the pull request head is unreadable`)
    if (fileMatchesLedgerStatements(body, statements)) verified.add(row.version)
  }
  return verified
}
