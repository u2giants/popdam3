import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
    // Windows reports EPERM -- not EEXIST -- when a racing process still holds
    // this path open with a delete pending. That is transient contention, not an
    // answer: reporting false would claim another owner holds the ref and would
    // refuse an author who is entitled to it, so retry briefly and only then
    // fail loudly. EEXIST remains the real "someone else won" verdict.
    for(let attempt=0;attempt<100;attempt++){
      try { const fd=openSync(refPath(ref),'wx');writeFileSync(fd,sha);closeSync(fd);return true }
      catch(error){
        if(error.code==='EEXIST')return false
        if(error.code!=='EPERM')throw error
        const until=Date.now()+2;while(Date.now()<until);
      }
    }
    throw new Error(`createRef never settled contention for ${ref}`)
  },
  readRef: (ref) => existsSync(refPath(ref)) ? readFileSync(refPath(ref),'utf8') : null,
  // #2301 Step 3: the lane guard asks for the retirement namespace once. This
  // double stores refs as files, so list the directory rather than returning []
  // unconditionally -- a hard-coded empty answer would make the double lie.
  listRefs(prefix){
    const dir=path.join(store,'refs')
    if(!existsSync(dir))return []
    return readdirSync(dir).map((name)=>decodeURIComponent(name)).filter((ref)=>ref===prefix||ref.startsWith(`${prefix}/`)).map((ref)=>({ref,sha:readFileSync(refPath(ref),'utf8')}))
  },
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
