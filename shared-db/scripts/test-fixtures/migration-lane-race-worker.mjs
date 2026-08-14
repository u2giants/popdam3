import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireAuthorLane, LaneError } from '../manage-migration-author-lanes.mjs'

const [store, owner, object] = process.argv.slice(2)
mkdirSync(path.join(store, 'refs'), { recursive: true })
const claimsPath = path.join(store, 'claims.json')
const refPath = (ref) => path.join(store, 'refs', encodeURIComponent(ref))
const readClaims = () => existsSync(claimsPath) ? JSON.parse(readFileSync(claimsPath, 'utf8')) : []
const io = {
  openClaims: readClaims,
  openPulls: () => [],
  prSources: () => [],
  makeOwnerCommit: () => randomUUID(),
  createRef(ref, sha) {
    try { const fd=openSync(refPath(ref),'wx');writeFileSync(fd,sha);closeSync(fd);return true }
    catch(error){ if(error.code==='EEXIST')return false;throw error }
  },
  readRef: (ref) => existsSync(refPath(ref)) ? readFileSync(refPath(ref),'utf8') : null,
  deleteRef: (ref) => unlinkSync(refPath(ref)),
  reserveVersion: () => ({ version: `20260814${String(170000 + Number(owner)).padStart(6,'0')}` }),
  createClaim(_title, body) {
    const claims=readClaims();claims.push({number:claims.length+1,body});writeFileSync(claimsPath,JSON.stringify(claims));return `fake://claim/${claims.length}`
  },
}
try {
  const result=acquireAuthorLane({task:`race-${owner}`,owner,branch:`codex/${owner}`,worktree:`C:/w/${owner}`,objects:[object],leaseHours:12},new Date('2026-08-14T20:00:00Z'),io)
  process.stdout.write(JSON.stringify({ok:true,result}))
} catch(error) {
  if(!(error instanceof LaneError))throw error
  process.stdout.write(JSON.stringify({ok:false,error:error.message}))
  process.exitCode=2
}
