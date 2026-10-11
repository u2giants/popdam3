import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
// Owner: reviewer assignment lane. Immutable start records bound paid rounds.
import { readStoredHashRegistry, normalizedStoredHashFile } from '../pr-content-equivalence.mjs'
import { contractHash, validateContract, validateCompletionReport, reconcileReportWithContract } from '../../agent-work-contract.mjs'
import { validateCompletionRecord } from '../work-dependencies.mjs'
import { LaneError } from './claims.mjs'
import { REVIEW_STARTED_REF_PREFIX, REVIEW_REF_ROW_LIMIT } from './constants.mjs'
import { parseTerminalFailureEvidence, reviewerFailureRef } from './review-replacement.mjs'

// Cause-bound reinstatement (#3536/#3999). A paid start whose immutable
// terminal failure record proves a verdict-less REVIEWER-SIDE failure, bound to
// the exact issue/PR/head/sequence/reviewer (and slot when recorded), produced
// no review and does not spend the unchanged-content budget. Hard ceiling per
// slot across the unchanged-content group so crashes can never loop forever.
export const REINSTATABLE_FAILURE_CODES = Object.freeze(['wrapper_terminal_failure','provider_unavailable','insufficient_quota','turn_limit_cancelled'])
export const REINSTATEMENT_CEILING = 2

function reinstatedByFailure(start,io){
  if(typeof io.readRef!=='function')return false
  const ref=reviewerFailureRef({issue:start.issue,pr:start.pr,headSha:start.headSha,failedSequence:start.sequence})
  const sha=io.readRef(ref)
  if(!sha)return false
  if(!/^[0-9a-f]{40}$/.test(String(sha)))throw new LaneError('review circuit breaker: reinstatement failure ref unreadable')
  const commit=typeof io.readReviewFailureCommit==='function'?io.readReviewFailureCommit(sha):io.getCommit(sha)
  let failure
  try{failure=parseTerminalFailureEvidence(commit)}catch{throw new LaneError('review circuit breaker: reinstatement failure evidence unreadable')}
  const message=String(commit?.message??commit?.commit?.message??'')
  const slot=/ slot=(\d+) /.exec(message)
  if(!failure||failure.issue!==start.issue||failure.pr!==start.pr||failure.headSha!==start.headSha||failure.failedSequence!==start.sequence||failure.reviewer!==start.reviewer||(slot&&Number(slot[1])!==start.slot)||!/ verdict=none artifact=none( replacement=none)?$/.test(message))throw new LaneError('review circuit breaker: reinstatement failure binding mismatch')
  return REINSTATABLE_FAILURE_CODES.includes(failure.failureCode)
}

export function paidStart(row, commit) {
  const tuple = /^refs\/db-review-started\/(\d+)-(\d+)-([0-9a-f]{40})-slot(\d+)-seq(\d+)$/.exec(row.ref)
  if (!tuple || !/^[0-9a-f]{40}$/.test(row.sha)) throw new LaneError('review circuit breaker: malformed immutable start ref')
  const [, issue, pr, headSha, slot, sequence] = tuple
  const message = String(commit?.message ?? commit?.commit?.message ?? '')
  const start = /^db-coordination review-started issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) slot=(\d+) sequence=(\d+) reviewer=([a-z0-9.-]+) at=(\S+)(?: session=([A-Za-z0-9._-]+) receipt-path=sha256:[0-9a-f]{64} source=sha256:[0-9a-f]{64})?$/.exec(message)
  if (start) {
    if (start.slice(1,6).join(':') !== tuple.slice(1).join(':') || !Number.isFinite(Date.parse(start[7]))) throw new LaneError('review circuit breaker: start record binding mismatch')
    return {issue:Number(issue),pr:Number(pr),headSha,slot:Number(slot),sequence:Number(sequence),reviewer:start[6]}
  }
  // Only the established atomic unstarted reclaim / independence conflict can
  // occupy a start marker without spending a provider attempt.
  const silence = /^db-coordination reviewer-silence-release reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) sequence=(\d+) code=silent_worker_observed probe=([0-9a-f]{40}) observed-at=(\S+) confirmed-at=(\S+) verdict=none artifact=none replacement=none$/.exec(message)
  if (silence && [silence[2],silence[3],silence[4],silence[5]].join(':') === [issue,pr,headSha,sequence].join(':') && Number.isFinite(Date.parse(silence[7])) && Number.isFinite(Date.parse(silence[8]))) return null
  const conflict=/^db-coordination reviewer-failure-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) slot=(\d+)(?: allowlist=[a-z0-9.,-]+)? failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=self failed-reviewer=([a-z0-9.-]+) code=slot_independence_conflict(?: failing-check=[a-z0-9_.-]+)? verdict=none artifact=none$/.exec(message)
  if(conflict && [conflict[3],conflict[4],conflict[5],conflict[6],conflict[7]].join(':') === tuple.slice(1).join(':')) return null
  throw new LaneError('review circuit breaker: unrecognized or unreadable start evidence')
}


// Budget-only historical normalization. Strict review equivalence is unchanged.
function verifiedIntermediatePairs(before,after,rows,git,expectedPr,readContract,neededFiles) {
  const run=args=>String(git(args)).trim(),raw=args=>String(git(args))
  const ancestor=(a,b)=>{try{run(['merge-base','--is-ancestor',a,b]);return true}catch(e){if(e.status===1)return false;throw e}}
  const pairPaths=(issue,generation)=>['contract','completion'].map(kind=>`.agent/work/${issue}/${generation}/${kind}.json`)
  const cache=new Map()
  const read=(commit,issue,generation)=>{
    const key=`${commit}:${issue}:${generation}`;if(cache.has(key))return cache.get(key)
    const paths=pairPaths(issue,generation),records=[]
    for(const file of paths){
      const entry=raw(['ls-tree','-z',commit,'--',file]).split('\0').filter(Boolean)
      if(entry.length===0){cache.set(key,null);return null}
      if(entry.length!==1 || !/^100644 blob [0-9a-f]{40}\t/.test(entry[0]))throw new LaneError('review budget historical evidence regular mode refused')
      const bytes=raw(['show',`${commit}:${file}`]);if(Buffer.byteLength(bytes)>1048576)throw new LaneError('review budget historical evidence oversized')
      records.push(JSON.parse(bytes))
    }
    const [contract,report]=records,value={contract,report,paths,key:records.map(x=>JSON.stringify(x)).join('\0')};cache.set(key,value);return value
  }
  const canonicalTail=(record,commit)=>{
    const h=record.report.head_sha;if(!/^[0-9a-f]{40}$/.test(h??'') || !ancestor(h,commit))return false
    const tail=run(['rev-list','--first-parent','--max-count=1001',`${h}..${commit}`]).split('\n').filter(Boolean)
    if(!tail.length || tail.length>=1000)return false
    const touched=new Set()
    for(const c of tail){
      const parents=run(['rev-list','--parents','-n','1',c]).split(' ').slice(1);if(parents.length!==1)return false
      const lines=raw(['diff','--name-status','--no-renames',parents[0],c]).split('\n').filter(Boolean)
      for(const line of lines){const [status,file]=line.split('\t');if(!['A','M'].includes(status)||!record.paths.includes(file))return false;touched.add(file)}
    }
    return touched.size===2
  }
  const findEndpoint=tip=>{
  const listed=run(['ls-tree','-r','--name-only',tip,'--','.agent/work']).split('\n').filter(Boolean)
  if(listed.length>=1000)throw new LaneError('review budget historical evidence listing incomplete')
  const endpoints=[]
  for(const file of listed){const m=/^\.agent\/work\/(\d+)\/(\d+)\/completion\.json$/.exec(file);if(!m)continue
    const record=read(tip,Number(m[1]),Number(m[2]));if(record && record.report.pr===expectedPr && canonicalTail(record,tip))endpoints.push(record)
  }
  if(!endpoints.length)return null
  if(endpoints.length!==1)throw new LaneError('review budget ambiguous endpoint evidence')
  return endpoints[0]
  }
  const endpoint=findEndpoint(after);if(!endpoint)return []
  const baseline=findEndpoint(before);if(!baseline)throw new LaneError('review budget historical evidence trusted start pair unavailable')
  const baselineGeneration=baseline.contract.generation??1
  const requiredPairs=new Set([baselineGeneration,endpoint.contract.generation??1])
  for(const file of neededFiles){const m=/^\.agent\/work\/(\d+)\/(\d+)\/(contract|completion)\.json$/.exec(file);if(!m || Number(m[1])!==endpoint.contract.work_issue)throw new LaneError('review budget foreign or unknown merge evidence refused');requiredPairs.add(Number(m[2]))}
  const issue=endpoint.contract.work_issue,pr=endpoint.report.pr
  if(baseline.contract.work_issue!==issue || baseline.report.pr!==pr)throw new LaneError('review budget historical evidence start scope mismatch')
  const boundary=rows.indexOf(before);if(boundary<0 || boundary>=1000)throw new LaneError('review budget historical evidence complete start ancestry unavailable')
  if(!Number.isInteger(pr)||pr<1 || !Number.isInteger(issue)||issue<1)throw new LaneError('review budget historical evidence scope unreadable')

  const groups=new Map(),contracts=new Map(),foreignPairs=new Set()
  for(const commit of rows.slice(0,boundary+1)){
    const files=run(['ls-tree','-r','--name-only',commit,'--',`.agent/work/${issue}`]).split('\n').filter(Boolean)
    if(files.length>=1000)throw new LaneError('review budget historical evidence paths incomplete')
    for(const file of files){const m=/^\.agent\/work\/(\d+)\/(\d+)\/contract\.json$/.exec(file);if(!m)continue
      const generation=Number(m[2]),entry=raw(['ls-tree','-z',commit,'--',file]);if(!/^100644 blob [0-9a-f]{40}\t/.test(entry))throw new LaneError('review budget historical contract regular mode refused')
      const bytes=raw(['show',`${commit}:${file}`]);if(Buffer.byteLength(bytes)>1048576)throw new LaneError('review budget historical contract oversized')
      const c=JSON.parse(bytes);validateContract(c);if(c.work_issue!==issue || (c.generation??1)!==generation)throw new LaneError('review budget historical contract identity refused')
      const variants=contracts.get(generation)??new Map();variants.set(contractHash(c),c);contracts.set(generation,variants)
    }
    for(const file of files){const m=/^\.agent\/work\/(\d+)\/(\d+)\/completion\.json$/.exec(file);if(!m)continue
      const generation=Number(m[2]),record=read(commit,issue,generation);if(!record)continue
      if(record.report.pr!==pr){foreignPairs.add(generation);continue}
      const variants=groups.get(generation)??new Map(),variant=variants.get(record.key)??{record,witnesses:[]}
      if(canonicalTail(record,commit))variant.witnesses.push(commit)
      variants.set(record.key,variant);groups.set(generation,variants)
    }
  }
  // Actual endpoints, not superseded incomplete local report variants, bind
  // the start/current authority. Removed intermediate pairs keep every variant.
  for(const record of [baseline,endpoint]){
    const generation=record.contract.generation??1
    if(neededFiles.some(file=>record.paths.includes(file)))continue
    groups.set(generation,new Map([[record.key,{record,witnesses:[generation===baselineGeneration?before:after]}]]))
  }
  const validating=new Set(),validated=new Map()
  const validate=generation=>{
    if(validated.has(generation))return validated.get(generation)
    if(validating.has(generation))throw new LaneError('review budget historical evidence cyclic lineage')
    validating.add(generation)
    if(foreignPairs.has(generation))throw new LaneError('review budget foreign intermediate evidence pair refused')
    const variants=groups.get(generation)
    if(!requiredPairs.has(generation)){
      let candidates=contracts.get(generation)
      if(!candidates?.size){
        if(typeof readContract!=='function')throw new LaneError(`review budget historical evidence missing predecessor generation ${generation}`)
        const c=readContract(`refs/db-contracts/${issue}/${generation}`);validateContract(c)
        if(c.work_issue!==issue || (c.generation??1)!==generation)throw new LaneError('review budget immutable predecessor identity refused')
        candidates=new Map([[contractHash(c),c]])
      }
      if(candidates.size!==1)throw new LaneError(`review budget historical evidence ambiguous predecessor generation ${generation}`)
      const [hash,c]=[...candidates][0],parent=c.evidence_parent
      if(generation<baselineGeneration || !parent || parent.generation<baselineGeneration || parent.work_issue!==issue || validate(parent.generation)!==parent.contract_sha256)throw new LaneError('review budget historical contract-only predecessor hash refused')
      validating.delete(generation);validated.set(generation,hash);return hash
    }
    if(!variants?.size)throw new LaneError('review budget required historical pair unavailable')
    let hash
    for(const {record,witnesses} of variants.values()){
      const {contract,report}=record;validateContract(contract);validateCompletionReport(report,{validateCompletionRecord})
      if(!witnesses.length || contract.work_issue!==issue || (contract.generation??1)!==generation || report.work_issue!==issue || report.pr!==pr || report.contract_ref!==`refs/db-contracts/${issue}/${generation}` || !ancestor(contract.base_sha,report.head_sha) || !/^[0-9a-f]{40}$/.test(report.base_sha??contract.base_sha) || !ancestor(report.base_sha??contract.base_sha,report.head_sha))throw new LaneError('review budget historical evidence identity/ancestor/tail refused')
      const actualFiles=run(['diff','--name-only',report.base_sha??contract.base_sha,report.head_sha]).split('\n').filter(Boolean).sort()
      if(JSON.stringify(actualFiles)!==JSON.stringify([...report.files_changed].sort()))throw new LaneError('review budget historical evidence implementation file proof refused')
      if(!Array.isArray(report.files_changed)||!Array.isArray(report.checks)||!Array.isArray(report.db_reads)||!Array.isArray(report.db_writes)||!Array.isArray(report.stop_conditions_hit)||!reconcileReportWithContract(report,contract).satisfied)throw new LaneError('review budget historical evidence completion/hash refused')
      const actual=contractHash(contract);if(hash && hash!==actual)throw new LaneError('review budget historical evidence mutated generation');hash=actual
      if(generation===baselineGeneration){if(actual!==contractHash(baseline.contract))throw new LaneError('review budget historical evidence trusted start hash mismatch')}
      else {const parent=contract.evidence_parent;if(!parent || parent.generation<baselineGeneration || parent.work_issue!==issue || validate(parent.generation)!==parent.contract_sha256)throw new LaneError('review budget historical evidence predecessor hash refused')}
    }
    validating.delete(generation);validated.set(generation,hash);return hash
  }
  validate(endpoint.contract.generation??1)
  // Only the actual endpoint predecessor chain belongs to this workstream.
  for(const generation of requiredPairs)validate(generation)
  return [...requiredPairs].flatMap(generation=>pairPaths(issue,generation))
}

// Budget provenance is separate from strict review-diff equivalence. Git may
// write unreferenced merge-tree cache objects, never refs or source files.
export function derivePaidContentProof(before, after, protectedMain, git, excludePaths = [], expectedPr = null, readContract = null) {
  const sha = /^[0-9a-f]{40}$/
  if (![before,after,protectedMain].every(x=>sha.test(x))) throw new LaneError('review budget Git scope unreadable')
  const run = args => String(git(args)).trim()
  const ancestor = (a,b) => { try { run(['merge-base','--is-ancestor',a,b]); return true } catch (error) { if(error?.status===1)return false;throw error } }
  const registry=readStoredHashRegistry(protectedMain,{gitRunner:git})
  const stored=[...new Set(registry.map(entry=>entry.file))]
  const canonicalAppends=[]
  const canonicalPinOverlaps=[]
  let paths = [':(top)**', ...[...excludePaths,...stored].map(p=>`:(top,literal,exclude)${p}`)]
  const tree = value => typeof value==='string'?value:value.tree
  const raw = args => String(git(args))
  const entry = (commit,file,allowAbsent=false) => {
    const record=raw(['ls-tree','-z',tree(commit),'--',file]).split('\0').filter(Boolean)
    if(record.length===0 && allowAbsent)return null
    if(record.length!==1)throw new LaneError('review budget canonical blob missing')
    const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(record[0])
    if(!match || match[3]!==file)throw new LaneError('review budget canonical regular mode unreadable')
    const text=raw(['show',`${tree(commit)}:${file}`])
    if(Buffer.byteLength(text)>1048576 || createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')!==match[2])throw new LaneError('review budget canonical blob bytes unreadable or oversized')
    return {mode:match[1],blob:match[2],text}
  }
  const equal = (a,b) => {
    const overrides=a?.overrides??new Map()
    const selected=[...overrides.keys()]
    if(run(['diff','--name-only',tree(a),tree(b),'--',...paths,...selected.map(p=>`:(top,literal,exclude)${p}`)])!=='')return false
    if(!stored.every(file=>normalizedStoredHashFile(tree(a),file,registry,{gitRunner:git})===normalizedStoredHashFile(tree(b),file,registry,{gitRunner:git})))return false
    return selected.every(file=>{const actual=entry(b,file),expected=overrides.get(file);return actual.mode===expected.mode && actual.text===expected.text})
  }
  const canonicalAppend = (a,b,base) => {
    const file='scripts/manage-migration-author-lanes.test.mjs'
    const blobs=[a,base,b].map(commit=>entry(commit,file))
    if(new Set(blobs.map(x=>x.mode)).size!==1 || blobs.some(x=>/^(?:<{7}|\|{7}|={7}|>{7})/m.test(x.text)))throw new LaneError('review budget canonical append mode or marker ambiguity refused')
    const dir=mkdtempSync(path.join(tmpdir(),'review-budget-append-'))
    const labels=[`budget-ours-${a}`,`budget-base-${base}`,`budget-main-${b}`]
    try {
      const files=blobs.map((blob,i)=>{const f=path.join(dir,String(i));writeFileSync(f,blob.text);return f})
      let merged
      try { merged=raw(['merge-file','--diff3','-p','-L',labels[0],'-L',labels[1],'-L',labels[2],...files]);throw new LaneError('review budget canonical append requires exactly one conflict') }
      catch(error) { if(error?.status!==1 || typeof error.stdout!=='string')throw error;merged=error.stdout }
      if(Buffer.byteLength(merged)>3145728)throw new LaneError('review budget append output oversized')
      const markers=[`<<<<<<< ${labels[0]}\n`,`||||||| ${labels[1]}\n`,'=======\n',`>>>>>>> ${labels[2]}\n`]
      const positions=markers.map(marker=>{const index=merged.indexOf(marker);if(index<0 || merged.indexOf(marker,index+marker.length)!==-1)throw new LaneError('review budget append marker ambiguity');return index})
      if(!positions.every((index,i)=>i===0 || index>positions[i-1]) || positions[3]+markers[3].length!==merged.length)throw new LaneError('review budget append must be one EOF conflict')
      const ours=merged.slice(positions[0]+markers[0].length,positions[1])
      const ancestorBytes=merged.slice(positions[1]+markers[1].length,positions[2])
      const theirs=merged.slice(positions[2]+markers[2].length,positions[3])
      if(ancestorBytes!=='' || ours.trim()==='' || theirs.trim()==='')throw new LaneError('review budget append cannot modify old lines or omit a parent')
      const text=merged.slice(0,positions[0])+ours+theirs
      canonicalAppends.push({base,parents:[a,b],path:file,mode:blobs[0].mode,parentBlobs:blobs.map(x=>x.blob),canonicalBlob:createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')})
      return new Map([[file,{mode:blobs[0].mode,text}]])
    } finally { rmSync(dir,{recursive:true,force:true}) }
  }
  // The only non-test conflict accepted is an identical additive closure inventory.
  // Exact byte reconstruction is stricter than AST equivalence: only these known
  // ASCII comment lines may differ, so executable Python bytes are identical.
  const canonicalPinOverlap = (a,b,base) => {
    const file='scripts/production_business_risk_gate.py'
    const rows=[base,a,b].map(commit=>entry(commit,file))
    if(rows.some(row=>row.mode!=='100644'))throw new LaneError('review budget producer pin overlap requires exact regular mode')
    const anchor='    "scripts/manage-migration-author-lanes.mjs",\n'
    const pins=['agent-work-contract-git-evidence.mjs','agent-work-contract.mjs','refresh-code-pr-branch.mjs','run-governed-review.mjs'].map(name=>`    "scripts/${name}",\n`).join('')
    const comments=['    # Existing modules newly reachable through exact budget/contract imports.\n','    # Existing normal canonical validators now used by authenticated nonclosing routing.\n']
    if(rows.some(row=>row.text.includes('\0') || row.text.split('PREVIEW_PRODUCER_PATHS = (').length!==2 || row.text.split('PREVIEW_PRODUCER_PATHS = (\n')[1]?.split('\n)')[0]?.split(anchor).length!==2))throw new LaneError('review budget producer pin anchor is ambiguous')
    const ancestorInventory=rows[0].text.split('PREVIEW_PRODUCER_PATHS = (\n')[1].split('\n)')[0]
    if(pins.trim().split('\n').some(line=>ancestorInventory.includes(line.trim())))throw new LaneError('review budget producer pin ancestor already contains a reconciled key')
    const blockOf=row=>{
      const blocks=comments.map(comment=>anchor+comment+pins).filter(block=>row.text.includes(block))
      if(blocks.length!==1 || row.text.split(blocks[0]).length!==2)throw new LaneError('review budget producer pin block differs')
      return blocks[0]
    }
    // The protected parent is identified by ancestry alone: exactly one merge parent
    // must already be in protected main. Its bytes are protected content, so they may
    // carry later protected edits beyond the pin block (main keeps evolving this file).
    // The unprotected (author) parent may differ from the merge base ONLY by the exact
    // pin block, so the canonical merge result is the protected parent's bytes.
    const sides=[a,b].map((commit,index)=>({commit,row:rows[index+1],protected:ancestor(commit,protectedMain)}))
    const candidates=sides.filter(side=>side.protected)
    if(candidates.length!==1)throw new LaneError('review budget producer pin protected parent is ambiguous')
    const author=sides.find(side=>!side.protected),canonical=candidates[0].row
    // Protected main may reorder or interleave its own lines around the pins; it must
    // still carry every author pin exactly once in the inventory, or the protected
    // bytes would silently drop the author side of the merge.
    const protectedInventory=canonical.text.split('PREVIEW_PRODUCER_PATHS = (\n')[1].split('\n)')[0]+'\n'
    if(pins.split('\n').filter(Boolean).some(line=>protectedInventory.split(`${line}\n`).length!==2))throw new LaneError('review budget producer pin block differs')
    if(author.row.text.replace(blockOf(author.row),anchor)!==rows[0].text)throw new LaneError('review budget producer pin overlap changes other source bytes')
    canonicalPinOverlaps.push({base,parents:[a,b],path:file,mode:'100644',parentBlobs:rows.map(row=>row.blob),protectedParent:candidates[0].commit,canonicalBlob:canonical.blob})
    return new Map([[file,{mode:canonical.mode,text:canonical.text}]])
  }
  const automaticMerge = (a,b) => {
    if (ancestor(b,a)) return run(['rev-parse',`${a}^{tree}`])
    const base=run(['merge-base',a,b])
    if(!sha.test(base))throw new LaneError('review budget merge base unreadable')
    const changed=[...new Set([a,b].flatMap(tip=>raw(['diff','--name-only','-z',base,tip]).split('\0').filter(Boolean)))]
    if(changed.length>=1000)throw new LaneError('review budget merge path bound refused')
    for(const tip of [base,a,b,null]) {
      const attributes=changed.length?raw(['check-attr',...(tip?[`--source=${tip}`]:[]),'-z','merge','filter','working-tree-encoding','--',...changed]).split('\0'):[]
      for(let i=2;i<attributes.length;i+=3)if(attributes[i]!=='unspecified')throw new LaneError('review budget custom merge/filter/encoding attributes refused')
      if(tip && raw(['diff','--name-status','-M',base,tip]).split('\n').some(line=>/^R[0-9]+\t/.test(line)))throw new LaneError('review budget renamed merge source refused')
    }
    let result
    try { result=run(['merge-tree','--write-tree',a,b]) }
    catch(error) {
      if(error?.status!==1 || typeof error.stdout!=='string')throw error
      const lines=error.stdout.split('\n'),resultTree=lines[0]
      const stages=lines.slice(1).filter(line=>/^[0-9]{6} /.test(line))
      if(!sha.test(resultTree) || stages.length!==3)throw new LaneError('review budget conflict is outside the one canonical test append')
      if(stages.every((line,i)=>new RegExp(`^(100644|100755) [0-9a-f]{40} ${i+1}\\tscripts/manage-migration-author-lanes\\.test\\.mjs$`).test(line)))return {tree:resultTree,overrides:canonicalAppend(a,b,base)}
      if(stages.every((line,i)=>new RegExp(`^100644 [0-9a-f]{40} ${i+1}\\tscripts/production_business_risk_gate\\.py$`).test(line)))return {tree:resultTree,overrides:canonicalPinOverlap(a,b,base)}
      throw new LaneError('review budget conflict is outside the one canonical test append')
    }
    if (!sha.test(result)) throw new LaneError('review budget automatic merge proof unreadable')
    return result
  }
  const mergeCache=new Map()
  const merge=(a,b)=>{const key=`${a}:${b}`;if(!mergeCache.has(key))mergeCache.set(key,automaticMerge(a,b));return mergeCache.get(key)}
  try {
    const incorporatedMain = run(['merge-base',after,protectedMain])
    if (!sha.test(incorporatedMain)) throw new LaneError('review budget protected main ancestry unreadable')
    const expected = merge(before,incorporatedMain)
    if (equal(expected,after)) return {schema:1,before,after,protectedMain,kind:'unchanged',canonicalAppends,canonicalPinOverlaps}
    const rows = run(['rev-list','--first-parent','--max-count=1001',after]).split('\n')
    const index = rows.indexOf(before)
    if(index<0 || index>=1000)throw new LaneError('review budget complete first-parent ancestry unavailable')
    const neededFiles=new Set()
    for(const commit of rows.slice(0,index)){
      const parents=run(['rev-list','--parents','-n','1',commit]).split(' ').slice(1)
      if(parents.length===2){const candidate=merge(...parents)
        for(const file of run(['diff','--name-only',tree(candidate),commit,'--',...paths]).split('\n').filter(Boolean))if(file.startsWith('.agent/'))neededFiles.add(file)
      } else if(parents.length===1){
        for(const line of run(['diff','--name-status','--no-renames',parents[0],commit]).split('\n').filter(Boolean)){
          const [status,file]=line.split('\t')
          if(status==='D' && file?.startsWith('.agent/'))neededFiles.add(file)
        }
      }
    }
    // Ordinary authored retirement is evidence history too. Authenticate every
    // net metadata difference before excluding it; source merge proof is unchanged.
    for(const file of run(['diff','--name-only',tree(expected),after,'--',...paths]).split('\n').filter(Boolean)){
      if(file.startsWith('.agent/'))neededFiles.add(file)
    }
    const intermediate = neededFiles.size?verifiedIntermediatePairs(before,after,rows,git,expectedPr,readContract,[...neededFiles]):[]
    if(intermediate.length)paths=[...paths,...intermediate.map(p=>`:(top,literal,exclude)${p}`)]
    // Recompute with the exact authenticated historical pair paths. They can
    // explain evidence retirement but can never serve as an author witness.
    if(intermediate.length && equal(expected,after))return {schema:1,before,after,protectedMain,kind:'unchanged',canonicalAppends,canonicalPinOverlaps}

    if (index < 0 || index >= 1000) throw new LaneError('review budget complete first-parent ancestry unavailable')
    const authorCandidates=[]
    let authored = false,witness=null
    for (const commit of rows.slice(0,index)) {
      const parents = run(['rev-list','--parents','-n','1',commit]).split(' ').slice(1)
      if (parents.length === 2) {
        if (!ancestor(parents[1],protectedMain) || !equal(merge(...parents),commit)) throw new LaneError('review budget noncanonical or foreign merge refused')
      } else if (parents.length === 1) {
        if (!ancestor(commit,protectedMain)) {
          authorCandidates.push({commit,parent:parents[0]})
        }
      } else throw new LaneError('review budget ambiguous merge provenance refused')
    }
    const witnessExcludes=[...(canonicalAppends.length?[':(top,literal,exclude)scripts/manage-migration-author-lanes.test.mjs']:[]),...(canonicalPinOverlaps.length?[':(top,literal,exclude)scripts/production_business_risk_gate.py']:[])]
    const netPaths=run(['diff','--name-only',tree(expected),after,'--',...paths,...witnessExcludes]).split('\n').filter(Boolean)
    if(netPaths.some(file=>file.startsWith('.agent/')))throw new LaneError('review budget unverified evidence cannot witness authored repair')
    const managerFile='scripts/manage-migration-author-lanes.mjs'
    const managerTestFile='scripts/manage-migration-author-lanes.test.mjs'
    const standaloneImport="import { readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'\n"
    const combinedImport="import { verifyGitEvidence, gitIo, readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'\n"
    const count=(text,line)=>text.split(line).length-1
    const protectedManager=entry(incorporatedMain,managerFile,true)
    const protectedBinding=protectedManager?.mode==='100644' && count(protectedManager.text,combinedImport)===1 && count(protectedManager.text,standaloneImport)===0
    const projectedEntry=(commit,file)=>{
      const projected=merge(commit,incorporatedMain),override=projected?.overrides?.get(file)
      if(!override)return entry(projected,file,true)
      return {...override,blob:createHash('sha1').update(`blob ${Buffer.byteLength(override.text)}\0`).update(override.text).digest('hex')}
    }
    const symmetricManagerWitness=(commit,parent,actual)=>{
      if(!protectedBinding || actual?.mode!=='100644' || count(actual.text,combinedImport)!==1 || count(actual.text,standaloneImport)!==0)return null
      const originals=[entry(parent,managerFile,true),entry(commit,managerFile,true)]
      if(originals.some(row=>row?.mode!=='100644'||count(row.text,standaloneImport)!==1||count(row.text,combinedImport)!==0))return null
      const projected=[parent,commit].map(value=>projectedEntry(value,managerFile))
      if(projected.some(row=>row?.mode!=='100644'||count(row.text,standaloneImport)!==1||count(row.text,combinedImport)!==1))return null
      const normalized=projected.map(row=>row.text.replace(standaloneImport,''))
      if(normalized[1]!==actual.text || normalized[0]===normalized[1] || !normalized[1].length)return null
      const tests=[parent,commit].map(value=>projectedEntry(value,managerTestFile)),actualTest=entry(after,managerTestFile,true)
      if(tests.some(row=>row?.mode!=='100644') || actualTest?.mode!=='100644' || tests[1].text!==actualTest.text || tests[0].text===tests[1].text)return null
      return {commit,path:managerFile,mode:actual.mode,blob:actual.blob,baselineBlob:entry(expected,managerFile).blob,
        symmetricProjection:{parent,incorporatedMain,originalBlobs:originals.map(row=>row.blob),projectedBlobs:projected.map(row=>row.blob),parentNormalizedBlob:createHash('sha1').update(`blob ${Buffer.byteLength(normalized[0])}\0`).update(normalized[0]).digest('hex'),testBlobs:tests.map(row=>row.blob),actualTestBlob:actualTest.blob}}
    }
    for(const {commit,parent} of authorCandidates) {
      const changed=run(['diff','--name-only',parent,commit,'--',...paths]).split('\n')
      for(const file of netPaths.filter(file=>changed.includes(file))) {
        const original=entry(commit,file,true),actual=entry(after,file,true),baseline=entry(expected,file,true)
        if(file===managerFile){
          const previous=entry(parent,file,true)
          // Removing the duplicate imported binding never supplies authored capacity.
          if(previous?.mode==='100644' && original?.mode==='100644' && count(previous.text,standaloneImport)===1 && previous.text.replace(standaloneImport,'')===original.text){
            if(!protectedBinding || count(previous.text,combinedImport)!==1)throw new LaneError('review budget imported binding consolidation proof unavailable')
            continue
          }
          const projectedWitness=symmetricManagerWitness(commit,parent,actual)
          if(projectedWitness){authored=true;witness=projectedWitness;continue}
        }
        const survives=original===null?actual===null:actual!==null && original.mode===actual.mode && original.blob===actual.blob
        const byteDelta=actual===null?baseline!==null && Buffer.byteLength(baseline.text)>0:baseline===null?Buffer.byteLength(actual.text)>0:baseline.blob!==actual.blob
        if(survives && byteDelta){authored=true;witness={commit,path:file,mode:original?.mode??'absent',blob:original?.blob??'absent',baselineBlob:baseline?.blob??'absent'}}
      }
    }
    if (!authored) throw new LaneError('review budget surviving author source edit unavailable')
    return {schema:1,before,after,protectedMain,kind:'substantive',historyCount:index,witness,canonicalAppends,canonicalPinOverlaps}
  } catch (error) {
    throw new LaneError(`review budget Git provenance refused: ${String(error?.message??error).split('\n')[0]}`)
  }
}

export function assertPaidReviewCapacity(request, io) {
  if(!Number.isInteger(request.pr)||request.pr<1||!Number.isInteger(request.slot)||request.slot<1)throw new LaneError('review circuit breaker: exact positive PR and slot required')
  const prefix=`${REVIEW_STARTED_REF_PREFIX}/`
  const rows = typeof io.readPaidReviewStarts === 'function' ? io.readPaidReviewStarts(prefix,request.pr) : io.listRefs(prefix)
  if (!Array.isArray(rows)) throw new LaneError('review circuit breaker: immutable start listing unreadable')
  if(rows.length>=REVIEW_REF_ROW_LIMIT)throw new LaneError('review circuit breaker: bounded start listing may be truncated')
  const starts = rows.map(row=>paidStart(row,row.commit ?? io.getCommit(row.sha))).filter(row=>row && row.pr === request.pr && row.slot === request.slot)
  let count=0,reinstated=0
  const comparisonContext={}
  starts.sort((a,b)=>a.sequence-b.sequence)
  for (const start of starts) {
    let same=start.headSha === request.headSha
    if (!same) {
      if (typeof io.reviewContentComparison !== 'function') throw new LaneError('review circuit breaker: substantive content comparison unavailable')
      const comparison=io.reviewContentComparison(start.headSha,request.headSha,request.pr,comparisonContext)
      if (!comparison || !/^[0-9a-f]{64}$/.test(comparison.before) || !/^[0-9a-f]{64}$/.test(comparison.after)) throw new LaneError('review circuit breaker: substantive content proof unreadable')
      const proof=comparison.budgetProof
      if(!proof || proof.schema!==1 || proof.before!==start.headSha || proof.after!==request.headSha || !/^[0-9a-f]{40}$/.test(proof.protectedMain??'') || !['unchanged','substantive'].includes(proof.kind)) throw new LaneError('review circuit breaker: author-owned Git provenance proof unreadable')
      if(proof.kind==='substantive' && (!Number.isInteger(proof.historyCount)||proof.historyCount<1||proof.historyCount>=1000)) throw new LaneError('review circuit breaker: complete substantive history proof unreadable')
      same=proof.kind==='unchanged'
    }
    if(!same)continue
    if(reinstated<REINSTATEMENT_CEILING && reinstatedByFailure(start,io)){reinstated++;continue}
    count++
  }
  if(count>=2) throw new LaneError(`review circuit breaker: two paid attempts already started for unchanged reviewed content in slot ${request.slot}; third draw refused pending substantive repair or supported cause-bound reinstatement proof`)
  return reinstated?{paidAttempts:count,remaining:2-count,reinstated}:{paidAttempts:count,remaining:2-count}
}

// Provider outage/quota evidence differs from a local preparation failure.
export function pauseActualReviewFailure(record,io) {
  if(!['insufficient_quota','provider_unavailable'].includes(record.failureCode))return {paused:false,reason:'not a verified provider failure class'}
  if(typeof io.readPaidReviewStarts!=='function'||typeof io.pauseReviewerFailure!=='function')throw new LaneError('verified provider failure requires the supported monotonic pause bridge')
  const rows=io.readPaidReviewStarts(`${REVIEW_STARTED_REF_PREFIX}/`,record.pr)
  if(!Array.isArray(rows))throw new LaneError('provider failure paid-start lineage unreadable')
  const start=rows.map(row=>paidStart(row,row.commit??io.getCommit(row.sha))).find(row=>row&&row.issue===record.issue&&row.pr===record.pr&&row.headSha===record.headSha&&row.slot===record.slot&&row.sequence===record.failedSequence&&(!record.reviewer||row.reviewer===record.reviewer))
  if(!start)return {paused:false,reason:'no immutable paid-start evidence'}
  const boundRecord={...record,reviewer:start.reviewer}
  const commit=typeof io.readReviewFailureCommit==='function'?io.readReviewFailureCommit(record.failureSha):io.getCommit(record.failureSha)
  const failure=parseTerminalFailureEvidence(commit)
  if(!failure || ['issue','pr','headSha','failedSequence','reviewer','failureCode'].some(key=>failure[key]!==boundRecord[key]))throw new LaneError('provider pause immutable terminal failure binding mismatch')
  const timestamp=commit?.committedDate??commit?.commit?.committer?.date
  const observed=Date.parse(timestamp)
  if(typeof timestamp!=='string'||!Number.isFinite(observed)||observed<0)throw new LaneError('provider pause immutable failure timestamp unreadable')
  const result=io.pauseReviewerFailure({...boundRecord,observedEpoch:Math.floor(observed/1000)})
  return result?.status==='expired'?{paused:false,reason:'original failure window expired',...result}:{paused:true}
}
