import assert from 'node:assert/strict'
import test from 'node:test'
import { repairVoidedFindings, unvoidFindingsBody, commentIdFromFindingsRef, githubIoCallShapes, createGithubIo } from './repair-voided-findings.mjs'
import { neutraliseVerdictLine } from './run-governed-review.mjs'
import { findingsDigest } from './lib/review-verdict-artifact.mjs'
import { ghJson, spawnGitHub } from './lib/github-transport.mjs'

const headSha='c5a186effd6207d05a763fc422670c1db53e1fea'
const ref=`refs/db-review-verdicts/2460-2461-${headSha}`
const findingsRef='https://github.com/u2giants/shared-db/pull/2461#issuecomment-987654'
const original=`GOVERNED REVIEW FINDINGS\n\nCoverage: scripts/x.mjs lines 1-40.\nNo material findings.\nVERDICT: APPROVE ${headSha}`
const voided=neutraliseVerdictLine(original,'create-only verdict readback disagrees with the created object')

function ioFixture({body=voided,digest=findingsDigest(original)}={}){
  const comments=new Map([[987654,body]])
  const patches=[]
  return{comments,patches,
    readRef:()=>'a'.repeat(40),
    getCommit:()=>({message:`db-review-verdict ${JSON.stringify({verdict:'APPROVE',head_sha:headSha,issue:2460,pr:2461,slot:2,findings_digest:digest,findings_ref:findingsRef})}`}),
    readComment:(id)=>comments.get(id)??null,
    patchComment:(id,next)=>{patches.push({id,next});comments.set(id,next)}}
}

test('the void transform is exactly invertible',()=>{
  assert.equal(unvoidFindingsBody(voided),original)
})

test('a dry run proves the repair without writing, and --apply restores the recorded digest',()=>{
  const io=ioFixture()
  const dry=repairVoidedFindings({ref},io)
  assert.equal(dry.status,'repairable')
  assert.equal(io.patches.length,0)
  const applied=repairVoidedFindings({ref,apply:true},io)
  assert.equal(applied.status,'repaired')
  assert.equal(io.comments.get(987654),original)
  assert.equal(applied.digest,findingsDigest(original))
})

test('an undamaged comment is reported as already valid and never written',()=>{
  const io=ioFixture({body:original})
  assert.equal(repairVoidedFindings({ref,apply:true},io).status,'already-valid')
  assert.equal(io.patches.length,0)
})

// PROVE THE PROOF CAN FAIL. The digest is the whole safeguard: it is the artifact's own
// evidence, written before the damage. If the un-voided bytes do not reproduce it, the
// restoration is wrong -- a differently-damaged comment, a hand edit, a different review --
// and the tool must write nothing rather than install a body that merely looks plausible.
test('a restoration that does not reproduce the recorded digest writes nothing',()=>{
  const io=ioFixture({digest:'0'.repeat(64)})
  assert.throws(()=>repairVoidedFindings({ref,apply:true},io),/did not reproduce the digest/)
  assert.equal(io.patches.length,0)
})

test('a comment that carries no void markers is refused, not guessed at',()=>{
  const io=ioFixture({body:'someone edited this by hand'})
  assert.throws(()=>repairVoidedFindings({ref,apply:true},io),/does not carry the governed runner's void markers/)
  assert.equal(io.patches.length,0)
})

test('a missing artifact and a malformed ref are both refused',()=>{
  const io=ioFixture();io.readRef=()=>null
  assert.throws(()=>repairVoidedFindings({ref},io),/nothing to repair/)
  assert.throws(()=>repairVoidedFindings({ref:'refs/heads/main'},ioFixture()),/a verdict ref is required/)
})

test('the comment id comes from the findings ref',()=>{
  assert.equal(commentIdFromFindingsRef(findingsRef),987654)
  assert.equal(commentIdFromFindingsRef('https://github.com/u2giants/shared-db/pull/2461'),null)
})

// THE FIXTURE-INJECTED TESTS ABOVE CANNOT SEE THE REAL TRANSPORT (glm-5.3, PR #2479).
// Every one of them hands `repairVoidedFindings` its own `io`, so the shipped IO
// object -- the one the CLI actually runs with -- was never executed by a test at
// all, and shipped with all four of its calls malformed: no executor, and three
// reads sent through the mutation door. These build the SAME object the CLI builds,
// with the two transport doors injected, so the wiring itself is under test: put
// any read back on the mutation door, or drop the executor or the body from the
// PATCH, and these fail (grok-4.6, PR #2479).
const door = () => {
  const calls = []
  const readDoor = (args, options) => { calls.push({ door: 'read', args, options }); return { object: { sha: 'b'.repeat(40) }, body: 'findings', message: 'm' } }
  const mutateDoor = (args, options) => { calls.push({ door: 'mutate', args, options }); return { status: 0, stdout: '', stderr: '' } }
  const refuseReads = (args) => { throw new Error('use runGitHubCommand for reads') }
  return { calls, readDoor, mutateDoor, refuseReads }
}

test('every read the CLI makes goes through the read door, never the mutation door', () => {
  const d = door()
  // The mutation door here refuses reads exactly as the real transport does, so a
  // regression that routes a read back through it throws instead of passing.
  const io = createGithubIo({ ghJson: d.readDoor, spawnGitHub: () => d.refuseReads(), spawner: () => {} })
  assert.equal(io.readRef('refs/db-review-verdicts/2461-2462-' + 'a'.repeat(40)), 'b'.repeat(40))
  assert.equal(io.getCommit('a'.repeat(40)).message, 'm')
  assert.equal(io.readComment(987654), 'findings')
  assert.equal(d.calls.length, 3)
  for (const call of d.calls) {
    assert.equal(call.door, 'read')
    assert.equal(call.args[0], 'api')
    assert.equal(call.args.includes('-X'), false, 'a read must not carry a method')
  }
})

test('the CLI PATCH goes through the mutation door carrying both an executor and the body', () => {
  const d = door()
  const io = createGithubIo({ ghJson: () => { throw new Error('a write must not use the read door') }, spawnGitHub: d.mutateDoor, spawner: 'the-spawner' })
  io.patchComment(987654, 'repaired body')
  assert.equal(d.calls.length, 1)
  const [call] = d.calls
  assert.equal(call.door, 'mutate')
  assert.deepEqual(call.args.slice(0, 3), ['api', '-X', 'PATCH'])
  assert.equal(call.options.executor, 'the-spawner', 'the mutation door refuses a call with no executor')
  assert.equal(call.options.input, JSON.stringify({ body: 'repaired body' }))
})

test('the shipped call shapes satisfy the real transport doors', () => {
  for (const build of [githubIoCallShapes.readRef, githubIoCallShapes.getCommit, githubIoCallShapes.readComment]) {
    const call = build('a'.repeat(40))
    assert.equal(call.read, true)
    assert.throws(() => spawnGitHub(call.args, { executor: () => ({ status: 0, stdout: '{}' }) }), /use runGitHubCommand for reads/)
    let seen = null
    assert.deepEqual(ghJson(call.args, { executor: (file, args) => { seen = { file, args }; return '{"ok":true}' } }), { ok: true })
    assert.deepEqual(seen.args, call.args)
  }
  const patch = githubIoCallShapes.patchComment(12345)
  assert.equal(patch.read, false)
  assert.throws(() => spawnGitHub(patch.args, { input: '{}' }), /requires an executor/)
})

test('only a real 404 is absence: every other read failure surfaces', () => {
  const fail = (text) => createGithubIo({ ghJson: () => { const error = new Error(text); error.stderr = text; throw error }, spawnGitHub: () => {}, spawner: () => {} })
  assert.equal(fail('gh: HTTP 404: Not Found').readRef('refs/db-review-verdicts/x'), null)
  assert.equal(fail('gh: HTTP 404: Not Found').readComment(1), null)
  // Loose prose is NOT absence: a transport fault says "not found" too, and a DNS
  // failure says "could not resolve". Reporting either as "nothing to repair"
  // would be a confident wrong answer.
  for (const text of ['HTTP 403: rate limit exceeded', 'HTTP 401: Bad credentials', 'transport endpoint not found', 'could not resolve host: api.github.com']) {
    assert.throws(() => fail(text).readRef('refs/db-review-verdicts/x'), (error) => error.message === text, `${text} must not be reported as absence`)
  }
})
