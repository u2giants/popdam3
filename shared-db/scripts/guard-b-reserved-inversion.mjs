#!/usr/bin/env node
//
// GUARD B RESERVED-INVERSION EXEMPTION (issue #6798).
//
// THE DEFECT. `--reserve-version --future-minutes N` hands out a version above
// main's newest, but reservation order is not merge order: A reserves, B
// reserves a later version, B merges first, and Guard B in check-sql.sh then
// refuses A as "backdated" at queue time. Every renumber can be overtaken the
// same way while queued (#6777, #6789, #6794 on 2026-11-18/19).
//
// THE GUARD'S INTENT, KEPT. Guard B exists so older DDL never lands after newer
// DDL that touches the same object (a stale `create or replace` restoring a
// corrected body) and so a version is never hand-picked behind main. The apply
// lanes already apply bounded, named version sets below a ledger head, so
// version order alone is not the danger; object overlap is.
//
// THE RULE. An added migration whose version sorts below main's newest is
// accepted ONLY when ALL of these hold, otherwise Guard B refuses as before:
//   1. its version holds a live `refs/db-claims/<version>` reservation (it was
//      allocated by the atomic tool, not picked by hand);
//   2. its SQL yields at least one object under the BROAD dispatch parser
//      (zero detected objects cannot prove anything, so it fails closed);
//   3. no migration already on main with a NEWER version writes any object it
//      writes (same broad parser: any write to the same target collides);
//   4. every such newer main migration is readable on disk (fails closed).
//
// Usage: node scripts/guard-b-reserved-inversion.mjs <added-file> <migration-dir> <newer-versions-file>
// Exit 0 = exempt, 1 = refuse (reason on stderr). Never exits 0 on doubt.
//
// Test seam: CHECK_SQL_RESERVED_VERSIONS names a file of reserved versions, one
// per line, instead of asking `origin` for refs/db-claims/<version>.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dispatchObjectKeys } from './check-pr-object-collisions.mjs'

export function isReserved(version, { env = process.env, cwd = process.cwd(), lsRemote } = {}) {
  if (env.CHECK_SQL_RESERVED_VERSIONS) {
    if (!existsSync(env.CHECK_SQL_RESERVED_VERSIONS)) return false
    return readFileSync(env.CHECK_SQL_RESERVED_VERSIONS, 'utf8').split(/\r?\n/).some((line) => line.trim() === version)
  }
  const ref = `refs/db-claims/${version}`
  const read = lsRemote ?? (() => execFileSync('git', ['-C', cwd, 'ls-remote', 'origin', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  try {
    return read(ref).split(/\r?\n/).some((line) => line.trim().endsWith(`\t${ref}`) || line.trim().endsWith(` ${ref}`))
  } catch {
    return false
  }
}

/**
 * Pure decision. `newer` is [{ name, sql }] for every main migration whose version
 * sorts above `version`; `undefined` sql means it could not be read.
 * @returns {{ok: boolean, reason: string}}
 */
export function decideInversion({ version, sql, reserved, newer }) {
  if (!reserved) return { ok: false, reason: `version ${version} holds no live refs/db-claims reservation` }
  const mine = dispatchObjectKeys(sql)
  if (mine.length === 0) return { ok: false, reason: `no objects detected in ${version}; disjointness cannot be proven` }
  const set = new Set(mine)
  for (const entry of newer) {
    if (entry.sql === undefined) return { ok: false, reason: `newer main migration ${entry.name} could not be read` }
    const overlap = dispatchObjectKeys(entry.sql).filter((key) => set.has(key))
    if (overlap.length) return { ok: false, reason: `newer main migration ${entry.name} also writes ${overlap.join(', ')}` }
  }
  return { ok: true, reason: `reserved ${version}; objects (${mine.join(', ')}) untouched by the ${newer.length} newer main migration(s)` }
}

function main([file, dir, newerFile]) {
  const version = path.basename(file).slice(0, 14)
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql'))
  const newerVersions = readFileSync(newerFile, 'utf8').split(/\r?\n/).map((v) => v.trim()).filter((v) => /^\d{14}$/.test(v))
  const newer = newerVersions.map((v) => {
    const name = names.find((n) => n.startsWith(`${v}_`))
    return { name: name ?? v, sql: name ? readFileSync(path.join(dir, name), 'utf8') : undefined }
  })
  const result = decideInversion({
    version,
    sql: readFileSync(file, 'utf8'),
    reserved: isReserved(version, { cwd: dir }),
    newer,
  })
  if (result.ok) {
    console.log(`Guard B reserved inversion (#6798): ${path.basename(file)} accepted -- ${result.reason}.`)
    return 0
  }
  console.error(`Guard B reserved inversion (#6798) not applicable to ${path.basename(file)}: ${result.reason}.`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`Guard B reserved inversion (#6798) failed closed: ${error.message}`)
    process.exitCode = 1
  }
}
