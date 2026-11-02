#!/usr/bin/env node
// One recoverable namespace retirement owned by #5426. No database operations.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { contractStorageRef, CONTRACT_STORAGE_PREFIX, LEGACY_CONTRACT_PREFIX } from './lib/contract-storage.mjs'

const REF = /^refs\/db-contracts\/[1-9]\d*\/[1-9]\d*$/
const SHA = /^[0-9a-f]{40}$/
export function parseRefs(text) {
  const refs = new Map()
  for (const line of text.trim().split(/\r?\n/).filter(Boolean)) {
    const [sha, ref, extra] = line.split(/\s+/)
    if (extra || !SHA.test(sha) || !ref?.startsWith('refs/') || refs.has(ref)) throw Error('Malformed or duplicate remote ref')
    refs.set(ref, sha)
  }
  return refs
}
export function retirementPlan(original, archived) {
  return [...original].sort(([a], [b]) => a.localeCompare(b)).map(([ref, sha]) => {
    if (!REF.test(ref) || !SHA.test(sha)) throw Error('Retirement contains an unexpected ref or SHA')
    const target = contractStorageRef(ref)
    if (archived.has(target) && archived.get(target) !== sha) throw Error(`Archive differs: ${target}`)
    return { ref, sha, target }
  })
}
export function deletionArguments(plan, live, archived) {
  if (!plan.length || live.size !== plan.length) throw Error('Original namespace changed; prepare a fresh backup')
  const unique = new Set()
  for (const row of plan) {
    if (!REF.test(row.ref) || !SHA.test(row.sha) || row.target !== contractStorageRef(row.ref) || unique.has(row.ref)) throw Error('Invalid backup manifest')
    unique.add(row.ref)
    if (live.get(row.ref) !== row.sha || archived.get(row.target) !== row.sha) throw Error(`Original or archive changed: ${row.ref}`)
  }
  // Atomic deletion with per-ref compare-and-swap. Never force an unobserved ref.
  return ['push', '--atomic', ...plan.map(row => `--force-with-lease=${row.ref}:${row.sha}`), 'origin', ...plan.map(row => `:${row.ref}`)]
}
export function main(argv, run = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] })) {
  const [mode, backup] = argv
  if (!['--prepare', '--apply', '--audit'].includes(mode) || !backup || argv.length !== 2) throw Error('Usage: retire-contract-refs.mjs --prepare|--apply|--audit ABSOLUTE_BACKUP_BUNDLE')
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(backup)) throw Error('Backup must be an absolute path')
  const origin = run(['remote', 'get-url', 'origin']).trim()
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)popcre\/shared-db(?:\.git)?$/.test(origin)) throw Error('Origin is not popcre/shared-db')
  const read = prefix => parseRefs(run(['ls-remote', 'origin', `${prefix}/*`]))
  const original = read(LEGACY_CONTRACT_PREFIX), archived = read(CONTRACT_STORAGE_PREFIX)
  const manifest = `${backup}.json`
  if (mode === '--prepare') {
    const plan = retirementPlan(original, archived)
    if (!plan.length) throw Error('No original refs to retire')
    const local = row => row.ref.replace(LEGACY_CONTRACT_PREFIX, 'refs/retirement-backup/5426')
    if (existsSync(backup) || existsSync(manifest)) {
      if (!existsSync(backup) || !existsSync(manifest)) throw Error('Incomplete previous backup; never overwrite it')
      const prior = JSON.parse(readFileSync(manifest, 'utf8'))
      if (prior.issue !== 5426 || prior.origin !== origin || JSON.stringify(prior.plan) !== JSON.stringify(plan)) throw Error('Originals changed since backup; preserve this backup and prepare another')
    } else {
      run(['fetch', '--no-tags', 'origin', `${LEGACY_CONTRACT_PREFIX}/*:refs/retirement-backup/5426/*`])
      for (const row of plan) if (run(['rev-parse', local(row)]).trim() !== row.sha) throw Error('Ref changed during backup fetch')
      run(['bundle', 'create', backup, ...plan.map(local)])
      writeFileSync(manifest, `${JSON.stringify({ issue: 5426, origin, plan }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    }
    run(['bundle', 'verify', backup])
    const bundled = parseRefs(run(['bundle', 'list-heads', backup]))
    for (const row of plan) if (bundled.get(local(row)) !== row.sha || run(['rev-parse', local(row)]).trim() !== row.sha) throw Error('Backup differs from originals')
    const unpublished = plan.filter(row => !archived.has(row.target))
    // Bounded batches let GitHub's unchanged secret scanner complete. No
    // original is deleted until every batch has been copied and verified.
    for (let offset = 0; offset < unpublished.length; offset += 50) {
      const batch = unpublished.slice(offset, offset + 50)
      run(['push', '--atomic', 'origin', ...batch.map(row => `${local(row)}:${row.target}`)])
      console.error(`Preserved ${Math.min(offset + 50, unpublished.length)}/${unpublished.length} pending records`)
    }
    const after = read(CONTRACT_STORAGE_PREFIX)
    for (const row of plan) if (after.get(row.target) !== row.sha) throw Error('Archive verification failed; originals retained')
    return { prepared: plan.length, originalsRetained: true }
  }
  const saved = JSON.parse(readFileSync(manifest, 'utf8'))
  if (saved.issue !== 5426 || saved.origin !== origin || !Array.isArray(saved.plan)) throw Error('Backup manifest identity differs')
  run(['bundle', 'verify', backup])
  const bundled = parseRefs(run(['bundle', 'list-heads', backup]))
  for (const row of saved.plan) {
    if (!REF.test(row.ref) || bundled.get(row.ref.replace(LEGACY_CONTRACT_PREFIX, 'refs/retirement-backup/5426')) !== row.sha || archived.get(row.target) !== row.sha) throw Error('Backup or archive is incomplete')
  }
  if (mode === '--audit') return { preserved: saved.plan.length, legacyRefsRemaining: original.size }
  run(['fetch', '--no-tags', 'origin', 'main'])
  run(['cat-file', '-e', 'origin/main:scripts/manage-migration-coordination.mjs'])
  let retired = false
  try { run(['cat-file', '-e', 'origin/main:scripts/manage-migration-author-lanes.mjs']) } catch { retired = true }
  if (!retired) throw Error('Coordinator move has not merged; originals retained')
  const mapped = run(['show', 'origin/main:scripts/lib/contract-storage.mjs'])
  if (!mapped.includes(CONTRACT_STORAGE_PREFIX)) throw Error('Main lacks archive-aware contract storage')
  run(deletionArguments(saved.plan, original, archived))
  if (read(LEGACY_CONTRACT_PREFIX).size) throw Error('Original refs remain after retirement')
  const after = read(CONTRACT_STORAGE_PREFIX)
  for (const row of saved.plan) if (after.get(row.target) !== row.sha) throw Error('Post-retirement archive verification failed')
  return { retired: saved.plan.length, preserved: saved.plan.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
