import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { claimBody } from './manage-migration-author-lanes.mjs'
import { replaceLeaseExpiry } from './lib/lanes/claim-maintenance.mjs'
import { canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs'
import { REVIEW_ASSIGNMENT_REF_PREFIX } from './lib/lanes/constants.mjs'
import { REVIEW_VERDICT_REF_PREFIX } from './lib/review-verdict-artifact.mjs'
import { MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF } from './lib/lanes/constants.mjs'
import { recoverStaleAuthorMutex } from './lib/lanes/holds-and-refs.mjs'
import { transferStoppedMergedClaimAuthor, validateStoppedMergedAdoptionRequest, validateObservation } from './lib/lanes/stopped-merged-claim-adoption.mjs'
import { parseArgs } from './transfer-stopped-merged-claim-author.mjs'

const request = { issue:2421, claim:4158, pr:4161, headSha:'09583df0f6d822479e9821234f7071f505a54953', oldOwner:'codex/01a12d90-cce8-7131-b1eb-eff6becc806e-2421', newOwner:'codex/01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e-4158', branch:'codex/2421-source', worktree:'/old', targetWorktree:'/new', worktreeState:'clean', authorizationChatId:'01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e', authorizationQuote:'I authorize this exact registered custody succession.', recoveryArtifact:'artifact:'+'a'.repeat(40), leaseHours:0.5 }
test('registered request is exact and bounded', () => assert.deepEqual(validateStoppedMergedAdoptionRequest(request), request))
test('request parser preserves a Unicode authorization quote exactly', () => {
  const quoted = { ...request, authorizationQuote: 'I authorize this exact registered custody succession — café 東京.' }
  assert.equal(validateStoppedMergedAdoptionRequest(quoted).authorizationQuote, quoted.authorizationQuote)
})
test('unknown tuple and extra fields refuse', () => {
  assert.throws(() => validateStoppedMergedAdoptionRequest({ ...request, pr: 9 }), /unknown registered case/)
  assert.throws(() => validateStoppedMergedAdoptionRequest({ ...request, extra: true }), /missing or extra/)
})
test('adversarial request custody and grant values refuse before IO', () => {
  for (const patch of [
    { headSha: 'x'.repeat(40) },
    { newOwner: 'old-owner' },
    { targetWorktree: request.worktree },
    { leaseHours: 0.5001 },
    { branch: 'codex/bad branch' },
    { recoveryArtifact: 'line\n injection' },
  ]) assert.throws(() => validateStoppedMergedAdoptionRequest({ ...request, ...patch }), /refused|invalid|exact|bounded|operator session|malformed/)
})
test('observation is strict and time bounded', () => {
  const manifest = { original_owner_session:'01a12d90-cce8-7131-b1eb-eff6becc806e', actor:'01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e' }
  const now = new Date('2026-10-18T12:00:00.000Z')
  const observation = { schema_version:1, original_owner_session:manifest.original_owner_session, state:'notLoaded', latest_turn_status:'completed', observed_at:'2026-10-18T11:59:30.000Z', actor:manifest.actor }
  assert.deepEqual(validateObservation(observation, now, manifest), observation)
  assert.throws(() => validateObservation({ ...observation, state:'loaded' }, now, manifest), /exact completed/)
  assert.throws(() => validateObservation({ ...observation, observed_at:'2026-10-18T11:56:00.000Z' }, now, manifest), /stale/)
  assert.throws(() => validateObservation({ ...observation, actor:'foreign' }, now, manifest), /exact completed/)
  assert.throws(() => validateObservation({ ...observation, observed_at:'2026-10-18T12:00:01.000Z' }, now, manifest), /future/)
  assert.throws(() => validateObservation({ ...observation, extra:true }, now, manifest), /missing or extra/)
})
test('CLI keeps the preservation bundle separate and binds review issue 3618', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stopped-merged-cli-'))
  try {
    const requestFile = join(dir, 'request.json'), observationFile = join(dir, 'observation.json')
    writeFileSync(requestFile, JSON.stringify(request, null, 2))
    writeFileSync(observationFile, JSON.stringify({ schema_version:1, original_owner_session:'01a12d90-cce8-7131-b1eb-eff6becc806e', state:'notLoaded', latest_turn_status:'completed', observed_at:'2026-10-18T11:59:30.000Z', actor:'01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e' }))
    const args = parseArgs(['--request-file',requestFile,'--review-issue','3618','--review-pr','5000','--review-head-sha','a'.repeat(40),'--observation-file',observationFile,'--preservation-bundle',join(dir, 'bundle')])
    assert.equal(args.request.recoveryArtifact, request.recoveryArtifact)
    assert.equal(args.preservationBundle, join(dir, 'bundle'))
    assert.throws(() => parseArgs(['--request-file',requestFile,'--review-issue','4161','--review-pr','5000','--review-head-sha','a'.repeat(40),'--observation-file',observationFile,'--preservation-bundle',join(dir, 'bundle')]), /3618/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

function operationFixture() {
  const now = new Date('2026-10-18T12:00:00.000Z'), sourceHead = request.headSha, sourceMerge = '3ed8c2ed7b1eb8e5b2f7291340a3d35421012072', reviewHead = 'a'.repeat(40), main = 'c'.repeat(40), reservation = '99148a74024a801fbd5e941f7e437b14ed6d25e6', bundle = '/private/source.bundle'
  const body = claimBody({ version:'20261012012727', objects:['table plm.art_piece_attachment'], owner:request.oldOwner, branch:request.branch, worktree:request.worktree, expiresAt:new Date('2026-10-17T12:00:00.000Z'), capacityState:'relinquished', blockedOn:'issue:#2421', worktreeState:'clean', recoveryArtifact:request.recoveryArtifact })
  const observation = { schema_version:1, original_owner_session:'01a12d90-cce8-7131-b1eb-eff6becc806e', state:'notLoaded', latest_turn_status:'completed', observed_at:'2026-10-18T11:59:30.000Z', actor:'01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e' }
  const manifest = { schema_version:1, kind:'registered-stopped-merged-claim-adoption', claim:4158, work_issue:2421, source_pr:4161, source_head_sha:sourceHead, source_merge_sha:sourceMerge, version:'20261012012727', original_owner:request.oldOwner, original_owner_session:observation.original_owner_session, actor:observation.actor, original_claim_body_sha256:sha256(body), reservation_sha:reservation, request_sha256:sha256(canonicalJson(request)), original_worktree_sha256:sha256(request.worktree), successor_worktree_sha256:sha256(request.targetWorktree), source_bundle_sha256:'f'.repeat(64), human_identity_authenticated:false }
  const audit = `\`\`\`db-work-scope\nstatus: ready\nwork_type: repo-maintenance\nroute: repo-maintenance\npriority: 1\nwrites:\n\`\`\`\n\n\`\`\`stopped-merged-custody-audit\nclaim: 4158\nsource_pr: 4161\nsource_head_sha: ${sourceHead}\noriginal_owner: ${request.oldOwner}\nmanifest_sha256: ${sha256(canonicalJson(manifest))}\n\`\`\``
  const work = '```db-work-scope\nstatus: ready\nwork_type: structural\nroute: claim-first\npriority: 1\nwrites:\n  - table plm.art_piece_attachment\n```'
  const issues = new Map([[4158,{number:4158,state:'open',title:'CLAIM: #2421 stopped merged source',body}],[2421,{number:2421,state:'open',body:work}],[3618,{number:3618,state:'open',body:audit}]])
  const refs = new Map([[`refs/db-claims/20261012012727`,reservation]]), commits = new Map([[reservation,{message:'permanent reservation'}]])
  const files = new Map(); const capability = ['scripts/lib/lanes/stopped-merged-claim-adoption.mjs','scripts/transfer-stopped-merged-claim-author.mjs','scripts/stopped-merged-claim-adoption.test.mjs','docs/agents/stopped-merged-claim-recovery.md']
  for (const file of capability) files.set(file, readFileSync(file,'utf8'))
  const assignment = '1'.repeat(40), verdict = '2'.repeat(40), findings = 'reviewed exact capability'
  commits.set(assignment,{message:`db-coordination reviewer-cursor sequence=1 reviewer=glm-5.3 issue=3618 pr=5000 head=${reviewHead} slot=1`})
  commits.set(verdict,{message:`db-review-verdict ${JSON.stringify({verdict:'APPROVE',head_sha:reviewHead,issue:3618,pr:5000,slot:1,reviewer:'glm-5.3',assignment_sha:assignment,findings_digest:createHash('sha256').update(findings).digest('hex'),findings_ref:'https://github.com/popcre/shared-db/pull/5000#issuecomment-1'})}`,parents:[{sha:assignment}]})
  refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/3618-5000-${reviewHead}`,assignment); refs.set(`${REVIEW_VERDICT_REF_PREFIX}/3618-5000-${reviewHead}`,verdict)
  let serial = 10
  const io = { env:{SHARED_DB_SESSION_ID:observation.actor}, issues, refs, commits, now:()=>now, repository:()=> 'popcre/shared-db', getIssue:n=>structuredClone(issues.get(Number(n))), updateIssue:(n,v)=>{issues.get(Number(n)).body=v.body}, openClaims:()=>[structuredClone(issues.get(4158))], getPr:n=>Number(n)===4161?{state:'closed',merged:true,merge_commit_sha:sourceMerge,head:{sha:sourceHead,ref:request.branch}}:{state:'closed',merged:true,merge_commit_sha:'b'.repeat(40),head:{sha:reviewHead,ref:'codex/capability'}}, getPrFiles:n=>Number(n)===4161?[{filename:'supabase/migrations/20261012012727_source.sql',status:'added'}]:[], prStructuralObjects:()=>['table plm.art_piece_attachment'], mainSha:()=>main, compareCommits:()=>({status:'ahead',behind_by:0}), getFileAt:(file)=>file==='docs/verification/claim4158-recovery/manifest.json'?JSON.stringify(manifest):files.get(file), readFindings:()=>findings, localClean:()=>true, localHead:()=>sourceHead, localBranch:()=>request.branch, worktreeRepository:()=> 'popcre/shared-db', physicalCheckoutIdentity:path=>({ requested:path, top:path, gitDir:path+'/.git' }), lstat:()=>({isFile:()=>true,isSymbolicLink:()=>false}), fileSha256:()=>manifest.source_bundle_sha256, verifyBundle:()=>({headSha:sourceHead}), prSources:()=>[], listRefs:prefix=>[...refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})), readRef:ref=>refs.get(ref)??null, deleteRef:ref=>{refs.delete(ref)}, createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true}, makeOwnerCommit:message=>{const sha=String(serial++).padStart(40,'0');commits.set(sha,{message});return sha}, getCommit:sha=>commits.get(sha), wait:()=>{} }
  return { io, now, request, manifest, observation, bundle }
}
function operationContext(f) {
  return { request:f.request, manifest:f.manifest, observation:f.observation, manifestBytes:JSON.stringify(f.manifest), preservationBundle:f.bundle, reviewIssue:3618, reviewPr:5000, reviewHeadSha:'a'.repeat(40), currentFiles:Object.fromEntries(['scripts/lib/lanes/stopped-merged-claim-adoption.mjs','scripts/transfer-stopped-merged-claim-author.mjs','scripts/stopped-merged-claim-adoption.test.mjs','docs/agents/stopped-merged-claim-recovery.md'].map(file=>[file,readFileSync(file,'utf8')])) }
}
test('operation harness succeeds, mutates only custody, writes receipt, and replays exactly', () => {
  const f = operationFixture(), context = operationContext(f)
  assert.ok(f.io.getIssue(3618).body.includes(sha256(canonicalJson(f.manifest))))
  const first = transferStoppedMergedClaimAuthor(context, f.now, f.io), after = f.io.getIssue(4158).body
  assert.equal(first.idempotent, false); assert.match(after, /owner: codex\/01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e-4158/); assert.equal(f.io.readRef('refs/db-claims/20261012012727'),'99148a74024a801fbd5e941f7e437b14ed6d25e6')
  assert.ok(first.attemptRef); assert.ok(first.attemptSha); const attempt = JSON.parse(f.io.getCommit(first.attemptSha).message.slice('db-coordination stopped-merged-adoption-attempt '.length)); assert.equal(attempt.current_main_sha, 'c'.repeat(40)); assert.equal(attempt.adoption_ref, first.ref); assert.equal(attempt.adoption_sha, first.sha); assert.equal(attempt.observation.observed_at, f.observation.observed_at); assert.equal(f.io.getIssue(4158).state, 'open'); assert.match(after, /version: 20261012012727/); assert.match(after, /table plm\.art_piece_attachment/); assert.equal(f.io.getIssue(2421).state, 'open')
  const second = transferStoppedMergedClaimAuthor(context, f.now, f.io); assert.equal(second.idempotent, true); assert.equal(second.sha, first.sha); assert.equal(f.io.getIssue(4158).body, after)
})
test('operation refuses every source, custody, reservation, stage, review and observation boundary before mutation', () => {
  const cases = [
    ['source PR moved', io => { io.getPr = n => n === 4161 ? { state:'open', head:{sha:request.headSha,ref:request.branch} } : { state:'closed',merged:true,merge_commit_sha:'b'.repeat(40),head:{sha:'a'.repeat(40),ref:'codex/capability'} } }],
    ['source parser object escapes claim', io => { io.prStructuralObjects = () => ['table plm.other'] }],
    ['reservation changes', io => { io.refs.set('refs/db-claims/20261012012727','e'.repeat(40)) }],
    ['stage is held', io => { io.refs.set('refs/db-coordination/preview','e'.repeat(40)) }],
    ['ready consent appears', io => { io.refs.set('refs/db-author-handoff-ready/4158-x','e'.repeat(40)) }],
    ['original custody is dirty', io => { io.localClean = () => false }],
    ['reviewed capability bytes change', io => { const old = io.getFileAt; io.getFileAt = (file, ref) => file.endsWith('.mjs') && ref === 'a'.repeat(40) ? old(file,ref)+'tampered' : old(file,ref) }],
    ['current main moves', io => { io.mainSha = () => 'd'.repeat(40); io.compareCommits = () => ({ status:'diverged', behind_by:1 }) }],
    ['bundle verification fails', io => { io.verifyBundle = () => false }],
    ['roster body differs', io => { io.openClaims = () => [{ ...io.getIssue(4158), body:'foreign' }] }],
  ]
  for (const [name, mutate] of cases) {
    const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body
    mutate(f.io); assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /refused|changed|held|consent|tampered|outside|reservation|custody|bundle|roster|not contained/, name); assert.equal(f.io.getIssue(4158).body, before, name); assert.equal(f.io.listRefs('refs/db-stopped-merged-claim-adoptions/').length, 0, name)
  }
})
test('receipt publication races refuse and preserve the original claim', () => {
  for (const [name, mutate] of [['main race', io => { io.mainSha = () => 'd'.repeat(40) }], ['reservation race', io => { io.refs.set('refs/db-claims/20261012012727','e'.repeat(40)) }], ['target custody race', io => { io.localClean = () => false }]]) {
    const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body, create = f.io.createRef
    f.io.createRef = (ref, sha) => { const ok = create(ref, sha); if (ref.startsWith('refs/db-stopped-merged-claim-adoptions/')) mutate(f.io); return ok }
    assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /refused|changed|reservation|custody|main|rollback/i, name); assert.equal(f.io.getIssue(4158).body, before, name)
  }
})
test('post-mutation failure rolls back with owned mutex and reports evidence when lock is lost', () => {
  const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body, update = f.io.updateIssue
  f.io.updateIssue = (n,v) => { update(n,v); throw Error('simulated claim write interruption') }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /simulated claim write interruption|before_sha256|ROLLBACK/, 'owned rollback'); assert.equal(f.io.getIssue(4158).body, before)
  const lost = operationFixture(), lostContext = operationContext(lost), lostUpdate = lost.io.updateIssue
  lost.io.updateIssue = (n,v) => { lostUpdate(n,v); lost.io.refs.set('refs/db-coordination/author-acquisition','f'.repeat(40)); throw Error('simulated lock loss') }
  assert.throws(() => transferStoppedMergedClaimAuthor(lostContext, lost.now, lost.io), /ROLLBACK NOT ATTEMPTED|mutex|simulated lock loss/, 'lost mutex'); assert.notEqual(lost.io.getIssue(4158).body, before)
})
test('cleanup failure reports completed receipt after successful mutation', () => {
  const f = operationFixture(), context = operationContext(f), deleteRef = f.io.deleteRef
  f.io.deleteRef = ref => { if (ref === 'refs/db-coordination/author-acquisition') throw Error('simulated mutex cleanup failure'); return deleteRef(ref) }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /OPERATION_COMPLETED|cleanup failure/, 'cleanup failure')
  assert.match(f.io.getIssue(4158).body, /owner: codex\/01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e-4158/)
})

function refusalCase(name, mutate, expected) {
  test(`operation refuses ${name}`, () => {
    const f = operationFixture(), context = operationContext(f)
    mutate(f.io, f, context)
    const before = f.io.getIssue(4158).body
    assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), error => {
      assert.match(String(error.message), expected, name)
      return true
    }, name)
    assert.equal(f.io.getIssue(4158).body, before, `${name}: claim mutated`)
  })
}

refusalCase('a missing capability review', io => {
  io.getPr = n => Number(n) === 5000 ? null : operationFixture().io.getPr(n)
}, /capability review PR is not genuinely merged|review approval|review/i)
refusalCase('an unmerged capability review', io => {
  const original = io.getPr
  io.getPr = n => Number(n) === 5000 ? { ...original(n), merged: false, state: 'open', merged_at: null } : original(n)
}, /review approval|genuinely merged|review/i)
refusalCase('a capability review at the wrong head', io => {
  const original = io.getPr
  io.getPr = n => Number(n) === 5000 ? { ...original(n), head: { sha: 'd'.repeat(40), ref: 'codex/capability' } } : original(n)
}, /review approval|reviewed head|review/i)
refusalCase('current main capability bytes differing from the reviewed head', io => {
  const original = io.getFileAt
  io.getFileAt = (file, ref) => file === 'scripts/transfer-stopped-merged-claim-author.mjs' && ref === 'c'.repeat(40) ? original(file, ref) + '\ntampered main' : original(file, ref)
}, /capability file .* differs from reviewed head/)
refusalCase('an absent audit fence', io => {
  io.issues.get(3618).body = '```db-work-scope\nstatus: ready\nwork_type: repo-maintenance\nroute: repo-maintenance\npriority: 1\nwrites:\n```'
}, /exact stopped-merged-custody-audit fence is absent or ambiguous/)
refusalCase('duplicate audit fences', io => {
  io.issues.get(3618).body += '\n```stopped-merged-custody-audit\nclaim: 4158\nsource_pr: 4161\nsource_head_sha: 09583df0f6d822479e9821234f7071f505a54953\noriginal_owner: codex/01a12d90-cce8-7131-b1eb-eff6becc806e-2421\nmanifest_sha256: ' + sha256(canonicalJson(operationFixture().manifest)) + '\n```'
}, /exact stopped-merged-custody-audit fence is absent or ambiguous/)
refusalCase('a wrong audit claim binding', io => {
  io.issues.get(3618).body = io.issues.get(3618).body.replace('claim: 4158', 'claim: 9999')
}, /custody audit fence claim differs/)
refusalCase('a mismatched actor session', io => {
  io.env.SHARED_DB_SESSION_ID = '01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e-0001'
}, /current session authority does not equal/)
refusalCase('an active source lease', io => {
  io.issues.get(4158).body = io.issues.get(4158).body.replace('capacity_state: relinquished', 'capacity_state: active').replace('blocked_on: issue:#2421', 'blocked_on:').replace(/expires_at: .*$/m, 'expires_at: 2026-10-19T12:00:00.000Z')
}, /exact open relinquished stopped claim required|unreadable db-author-lease block/)
refusalCase('an unexpired source lease', io => {
  io.issues.get(4158).body = io.issues.get(4158).body.replace(/expires_at: .*$/m, 'expires_at: 2026-10-19T12:00:00.000Z')
}, /exact open relinquished stopped claim required/)
refusalCase('a dirty relinquished source lease', io => {
  io.issues.get(4158).body = io.issues.get(4158).body.replace('worktree_state: clean', 'worktree_state: dirty')
}, /exact open relinquished stopped claim required/)
refusalCase('a wrong source migration version', io => {
  io.getPrFiles = () => [{ filename: 'supabase/migrations/20261012012728_source.sql', status: 'added' }]
}, /source migration does not match permanent version/)
refusalCase('an empty canonical source parser', io => {
  io.prStructuralObjects = () => []
}, /canonical merged-source object parser is empty/)
refusalCase('a collision with another claim', io => {
  const original = io.openClaims
  io.openClaims = () => [...original(), { number: 9999, title: '#9999 collision', body: claimBody({ version:'20261012012728', objects:['table plm.other'], owner:'codex/other', branch:'codex/other', worktree:'/new', expiresAt:new Date('2026-10-20T00:00:00.000Z'), capacityState:'relinquished', blockedOn:'issue:#9999', worktreeState:'clean', recoveryArtifact:'artifact:'+'b'.repeat(40) }) }]
}, /successor worktree belongs to another claim/)
refusalCase('a collision with a ready successor worktree', io => {
  io.refs.set('refs/db-author-handoff-ready/4158-foreign', 'e'.repeat(40))
}, /ready author consent appeared/)
refusalCase('a preservation bundle symlink', io => {
  io.lstat = () => ({ isFile: () => true, isSymbolicLink: () => true })
}, /preservation bundle is missing, unsafe or does not verify/)
refusalCase('a preservation bundle hash mismatch', io => {
  io.fileSha256 = () => '0'.repeat(64)
}, /preservation bundle is missing, unsafe or does not verify/)
refusalCase('a preservation bundle with the wrong advertised head', io => {
  io.verifyBundle = () => ({ headSha: 'd'.repeat(40) })
}, /preservation bundle is missing, unsafe or does not verify/)
refusalCase('an original worktree path digest mismatch', (io, f, context) => {
  f.manifest.original_worktree_sha256 = '0'.repeat(64)
  context.manifestBytes = JSON.stringify(f.manifest)
  const original = io.getFileAt
  io.getFileAt = (file, ref) => file === 'docs/verification/claim4158-recovery/manifest.json' && ref === 'a'.repeat(40) ? context.manifestBytes : original(file, ref)
  io.issues.get(3618).body = io.issues.get(3618).body.replace(/manifest_sha256: [0-9a-f]+/, `manifest_sha256: ${sha256(canonicalJson(f.manifest))}`)
}, /original and successor worktrees are not clean exact custody/)


test('fresh observation becomes stale after immutable receipt creation, then retry succeeds within grant', () => {
  const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body
  const originalCreate = f.io.createRef
  f.io.createRef = (ref, sha) => { const ok = originalCreate(ref, sha); if (ref.startsWith('refs/db-stopped-merged-claim-adoptions/')) f.io.now = () => new Date(f.now.valueOf() + 121000); return ok }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /stale|future|expired|observation/)
  assert.equal(f.io.getIssue(4158).body, before)
  const adoptionRef = [...f.io.refs.keys()].find(ref => ref.startsWith('refs/db-stopped-merged-claim-adoptions/')); assert.ok(adoptionRef)
  f.io.now = () => f.now
  const retry = transferStoppedMergedClaimAuthor(context, f.now, f.io)
  assert.equal(retry.idempotent, false); assert.equal(retry.ref, adoptionRef); assert.ok(retry.attemptRef)
})

test('expired immutable receipt refuses a non-adopted retry with a fresh observation', () => {
  const f = operationFixture(), context = operationContext(f)
  const first = transferStoppedMergedClaimAuthor(context,f.now,f.io)
  const commit = f.io.getCommit(first.sha), prefix = 'db-coordination stopped-merged-claim-author-adoption '
  const record = JSON.parse(commit.message.slice(prefix.length))
  f.io.issues.get(4158).body = record.original_body
  record.created_at = new Date(f.now.valueOf()-31*60000).toISOString()
  record.adopted_body = replaceLeaseExpiry(record.adopted_body,new Date(Date.parse(record.created_at)+30*60000))
  record.adopted_body_sha256 = sha256(record.adopted_body)
  commit.message = prefix+JSON.stringify(record)
  assert.throws(() => transferStoppedMergedClaimAuthor(context,f.now,f.io), /immutable receipt expired/)
  assert.equal(f.io.getIssue(4158).body,record.original_body)
})

test('changed adopted observation replays without regrant and records a distinct immutable attempt', () => {
  const f = operationFixture(), context = operationContext(f)
  const first = transferStoppedMergedClaimAuthor(context, f.now, f.io)
  const changed = { ...f.observation, observed_at: '2026-10-18T11:59:29.000Z' }
  const replay = { ...context, observation: changed }
  const second = transferStoppedMergedClaimAuthor(replay, f.now, f.io)
  assert.equal(second.idempotent, true); assert.equal(second.sha, first.sha); assert.notEqual(second.attemptRef, first.attemptRef); assert.notEqual(second.attemptSha, first.attemptSha)
  const receipt = JSON.parse(f.io.getCommit(first.sha).message.slice('db-coordination stopped-merged-claim-author-adoption '.length))
  const attempt = JSON.parse(f.io.getCommit(second.attemptSha).message.slice('db-coordination stopped-merged-adoption-attempt '.length))
  assert.equal(receipt.created_at, attempt.grant_created_at); assert.equal(attempt.observation.observed_at, changed.observed_at); assert.equal(attempt.adoption_ref, first.ref); assert.equal(attempt.adoption_sha, first.sha)
})

test('unreadable mutex leaves the adopted body and does not rollback', () => {
  const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body, originalUpdate = f.io.updateIssue, originalRead = f.io.readRef
  f.io.updateIssue = (n, v) => { originalUpdate(n, v); f.io.readRef = ref => ref === 'refs/db-coordination/author-acquisition' ? (() => { throw Error('mutex unreadable') })() : originalRead(ref) }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /mutex unreadable|ROLLBACK NOT ATTEMPTED/)
  assert.notEqual(f.io.getIssue(4158).body, before)
})

test('foreign postwrite claim body is never clobbered by rollback', () => {
  const f = operationFixture(), context = operationContext(f), foreign = 'foreign postwrite body', originalUpdate = f.io.updateIssue
  f.io.updateIssue = (n, v) => { originalUpdate(n, v); f.io.issues.get(n).body = foreign; throw Error('postwrite failure') }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /foreign claim body; rollback refused|ROLLBACK INCOMPLETE/)
  assert.equal(f.io.getIssue(4158).body, foreign)
})

test('failed receipt readback retains the immutable receipt reference', () => {
  const f = operationFixture(), context = operationContext(f), originalRead = f.io.readRef, originalCreate = f.io.createRef
  let created = false, createdRef = null
  f.io.createRef = (ref, sha) => { const ok = originalCreate(ref, sha); if (ref.startsWith('refs/db-stopped-merged-claim-adoptions/')) { created = true; createdRef = ref } return ok }
  f.io.readRef = ref => created && ref.startsWith('refs/db-stopped-merged-claim-adoptions/') ? 'e'.repeat(40) : originalRead(ref)
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /immutable receipt (readback failed|unreadable)/)
  assert.equal(created, true)
  assert.equal(createdRef.startsWith('refs/db-stopped-merged-claim-adoptions/'), true)
  assert.ok(f.io.refs.get(createdRef),'immutable receipt remains physically retained')
})


test('owned rollback leaves the immutable receipt and retry reuses exact bodies and deadline', () => {
  const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body
  const originalUpdate = f.io.updateIssue; let failed = true
  f.io.updateIssue = (n, v) => { originalUpdate(n, v); if (failed) { failed = false; throw Error('one-shot postwrite failure') } }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /one-shot postwrite failure|ROLLBACK/)
  assert.equal(f.io.getIssue(4158).body, before)
  const ref = [...f.io.refs.keys()].find(key => key.startsWith('refs/db-stopped-merged-claim-adoptions/')); assert.ok(ref)
  const receiptSha = f.io.refs.get(ref), firstRecord = JSON.parse(f.io.getCommit(receiptSha).message.slice('db-coordination stopped-merged-claim-author-adoption '.length))
  const retry = transferStoppedMergedClaimAuthor(context, f.now, f.io)
  const secondRecord = JSON.parse(f.io.getCommit(retry.sha).message.slice('db-coordination stopped-merged-claim-author-adoption '.length))
  assert.equal(retry.sha, receiptSha); assert.equal(secondRecord.created_at, firstRecord.created_at)
  assert.equal(secondRecord.original_body_sha256, firstRecord.original_body_sha256); assert.equal(secondRecord.adopted_body_sha256, firstRecord.adopted_body_sha256)
  assert.equal(secondRecord.original_body, firstRecord.original_body); assert.equal(secondRecord.adopted_body, firstRecord.adopted_body)
})

test('post-receipt rollback retries on a descendant main with a fresh observation and unchanged grant', () => {
  const f = operationFixture(), context = operationContext(f), originalUpdate = f.io.updateIssue; let failOnce = true
  f.io.updateIssue = (n, v) => { originalUpdate(n, v); if (failOnce) { failOnce = false; throw Error('post-receipt rollback') } }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /post-receipt rollback|ROLLBACK/)
  const ref = [...f.io.refs.keys()].find(key => key.startsWith('refs/db-stopped-merged-claim-adoptions/')); assert.ok(ref)
  const receiptSha = f.io.refs.get(ref), receipt = JSON.parse(f.io.getCommit(receiptSha).message.slice('db-coordination stopped-merged-claim-author-adoption '.length))
  const freshObservation = { ...f.observation, observed_at: '2026-10-18T11:59:50.000Z' }; const retryContext = { ...context, observation: freshObservation }
  f.io.mainSha = () => 'd'.repeat(40); f.io.compareCommits = () => ({ status:'ahead', behind_by:0 }); f.io.now = () => new Date('2026-10-18T12:00:00.000Z')
  const retry = transferStoppedMergedClaimAuthor(retryContext, f.now, f.io); assert.equal(retry.idempotent, false); assert.equal(retry.sha, receiptSha); assert.equal(retry.ref, ref)
  const attempt = JSON.parse(f.io.getCommit(retry.attemptSha).message.slice('db-coordination stopped-merged-adoption-attempt '.length)); assert.equal(attempt.current_main_sha, 'd'.repeat(40)); assert.equal(attempt.observation.observed_at, freshObservation.observed_at)
  const after = JSON.parse(f.io.getCommit(retry.sha).message.slice('db-coordination stopped-merged-claim-author-adoption '.length)); assert.equal(after.created_at, receipt.created_at); assert.equal(after.original_body, receipt.original_body); assert.equal(after.adopted_body, receipt.adopted_body)
})

test('descendant current main is accepted while unrelated or diverged main is refused', () => {
  const descendant = operationFixture(), descendantContext = operationContext(descendant)
  descendant.io.mainSha = () => 'd'.repeat(40); descendant.io.compareCommits = () => ({ status:'ahead', behind_by:0 })
  assert.equal(transferStoppedMergedClaimAuthor(descendantContext, descendant.now, descendant.io).idempotent, false)
  for (const [label, main, comparison] of [['unrelated', 'e'.repeat(40), { status:'diverged', behind_by:1 }], ['diverged', 'f'.repeat(40), { status:'behind', behind_by:2 }]]) {
    const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body
    f.io.mainSha = () => main; f.io.compareCommits = () => comparison
    assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /main|history|diverged|behind|unrelated/, label)
    assert.equal(f.io.getIssue(4158).body, before, label)
  }
})

test('stopped or expired adopted body never receives a fresh grant', () => {
  for (const [label, edit] of [['stopped', body => body.replace('capacity_state: active', 'capacity_state: relinquished')], ['expired', body => body.replace(/expires_at: .*$/m, 'expires_at: 2026-10-17T12:00:00.000Z')]]) {
    const f = operationFixture(), context = operationContext(f)
    transferStoppedMergedClaimAuthor(context, f.now, f.io)
    const before = f.io.getIssue(4158).body; f.io.issues.get(4158).body = edit(before)
    assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /adopted permission is stopped or expired|immutable receipt differs|body changed|relinquished author capacity must name blocked_on/, label)
    assert.equal(f.io.getIssue(4158).body, edit(before), label)
  }
})

test('physical checkout identity rejects aliases, shared git directories, wrong tops, and unavailable proofs', () => {
  const cases = [
    ['same physical top', io => { io.physicalCheckoutIdentity = path => ({ requested:'/physical/shared', top:'/physical/shared', gitDir:path+'/.git' }) }],
    ['same physical git directory', io => { io.physicalCheckoutIdentity = path => ({ requested:path, top:path, gitDir:'/physical/shared/.git' }) }],
    ['wrong top owner', io => { io.physicalCheckoutIdentity = path => ({ requested:path, top:'/other', gitDir:path+'/.git' }) }],
    ['unavailable identity', io => { io.physicalCheckoutIdentity = () => { throw Error('physical identity unavailable') } }],
  ]
  for (const [label, mutate] of cases) {
    const f = operationFixture(), context = operationContext(f), before = f.io.getIssue(4158).body; mutate(f.io)
    assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /physical|checkout|git directory|identity|distinct|alias/i, label)
    assert.equal(f.io.getIssue(4158).body, before, label)
  }
})

test('actual minted stopped-adoption mutex survives hard failure and is recoverable canonically', () => {
  const f = operationFixture(), context = operationContext(f), originalMake = f.io.makeOwnerCommit, originalDelete = f.io.deleteRef; let mutexSha = null
  f.io.makeOwnerCommit = message => { const sha = originalMake(message); if (message.startsWith('db-coordination claim-author-transfer-mutex ')) { mutexSha = sha; f.io.getCommit(sha).committer = { date:'2026-10-18T10:00:00.000Z' } } return sha }
  f.io.deleteRef = ref => { if (ref === MUTEX_REF) throw Error('simulated hard failure before cleanup'); return originalDelete(ref) }
  assert.throws(() => transferStoppedMergedClaimAuthor(context, f.now, f.io), /simulated hard failure before cleanup|outcome incomplete|mutex/)
  assert.ok(mutexSha); assert.match(f.io.getCommit(mutexSha).message, /^db-coordination claim-author-transfer-mutex claim=4158 operation=stopped-merged-adoption$/); assert.equal(f.io.readRef(MUTEX_REF), mutexSha)
  f.io.deleteRef = originalDelete
  const result = recoverStaleAuthorMutex({ expectedSha:mutexSha, confirmStale:true, serializedRecovery:true, now:new Date('2026-10-18T12:00:00.000Z'), minAgeMs:60*60*1000, quietMs:0 }, f.io)
  assert.equal(result.released, mutexSha); assert.equal(f.io.readRef(MUTEX_REF), null); assert.equal(f.io.readRef(MUTEX_RECOVERY_ACTIVE_REF), null)
})