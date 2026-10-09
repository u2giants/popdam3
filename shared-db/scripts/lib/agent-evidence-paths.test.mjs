import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePrDataRoot, acceptableEvidencePairs, EvidencePathError, evidencePaths, isEvidencePath, LEGACY_PAIR, resolveEvidencePair } from './agent-evidence-paths.mjs'

test('canonical task identifiers reject numeric aliases and precision loss', () => {
  for (const bad of ['01', '1e2', ' 1', '+1', true, 9007199254740992, '9007199254740993']) {
    assert.throws(() => evidencePaths(bad, 1), EvidencePathError)
    assert.throws(() => evidencePaths(1, bad), EvidencePathError)
  }
  assert.throws(() => resolveEvidencePair(['.agent/work/9007199254740993/1/contract.json', '.agent/work/9007199254740993/1/completion.json']), EvidencePathError)
})

test('#2708: the pair is keyed by work issue and generation, mirroring the contract ref', () => {
  assert.deepEqual(evidencePaths(2708, 1), {
    key: '2708/1',
    directory: '.agent/work/2708/1',
    contract: '.agent/work/2708/1/contract.json',
    completion: '.agent/work/2708/1/completion.json',
  })
  assert.equal(evidencePaths(2845).contract, '.agent/work/2845/1/contract.json')
  assert.notEqual(evidencePaths(2708, 1).directory, evidencePaths(2708, 2).directory)
})

test('#2708: two pull requests on different issues share no evidence path at all', () => {
  const a = evidencePaths(2640, 1)
  const b = evidencePaths(2695, 3)
  assert.deepEqual([a.contract, a.completion].filter((path) => [b.contract, b.completion].includes(path)), [])
})

test('#2708: a path key must be a positive integer', () => {
  for (const bad of [0, -1, '1.5', 'main', null, undefined]) assert.throws(() => evidencePaths(bad, 1), EvidencePathError)
  assert.throws(() => evidencePaths(42, 0), EvidencePathError)
})

test('#2708: evidence paths are recognised, and lookalikes are not', () => {
  assert.ok(isEvidencePath('.agent/contract.json'))
  assert.ok(isEvidencePath('.agent/work/42/1/completion.json'))
  assert.equal(isEvidencePath('.agent/work/42/1/notes.json'), false)
  assert.equal(isEvidencePath('.agent/work/42/contract.json'), false)
  assert.equal(isEvidencePath('sub/.agent/contract.json'), false)
  assert.equal(isEvidencePath('scripts/fix.mjs'), false)
})

test('#2708: resolution names the exact pair, or fails closed on more than one', () => {
  assert.deepEqual(resolveEvidencePair([]), { state: 'inherited', contract: null, completion: null, key: null })
  assert.deepEqual(resolveEvidencePair([...LEGACY_PAIR]), { state: 'current', contract: '.agent/contract.json', completion: '.agent/completion.json', key: 'legacy' })
  assert.equal(resolveEvidencePair(['.agent/work/42/1/contract.json', '.agent/work/42/1/completion.json', 'scripts/fix.mjs']).state, 'current')
  assert.equal(resolveEvidencePair(['.agent/work/42/1/completion.json']).state, 'partial')
  const conflicted = resolveEvidencePair(['.agent/contract.json', '.agent/completion.json', '.agent/work/42/1/contract.json', '.agent/work/42/1/completion.json'])
  assert.equal(conflicted.state, 'conflicted')
  assert.equal(conflicted.contract, null)
})

test('#2708: the legacy pair stays acceptable for a generation-1 root so open pull requests need not all rewrite at once', () => {
  const pairs = acceptableEvidencePairs({ work_issue: 42, generation: 1 })
  assert.deepEqual(pairs[0], ['.agent/work/42/1/completion.json', '.agent/work/42/1/contract.json'])
  assert.deepEqual(pairs.at(-1), [...LEGACY_PAIR])
  assert.deepEqual(acceptableEvidencePairs({}), [[...LEGACY_PAIR]])
})

test('#3380: a schema_version 2 contract accepts only its keyed pair, never the legacy paths', () => {
  // The tail predicate and resolveCurrentPair must agree: a v2 contract is not
  // allowed to fall back to the legacy pair at the first join.
  const v2 = acceptableEvidencePairs({ schema_version: 2, work_issue: 42, generation: 2 })
  assert.equal(v2.length, 1)
  assert.deepEqual(v2[0], ['.agent/work/42/2/completion.json', '.agent/work/42/2/contract.json'])

  const v2Root = acceptableEvidencePairs({ schema_version: 2, work_issue: 42, generation: 1 })
  assert.equal(v2Root.length, 1)
  assert.deepEqual(v2Root[0], ['.agent/work/42/1/completion.json', '.agent/work/42/1/contract.json'])

  // A v1 generation-1 root keeps both, so open pull requests need not rewrite
  // at once.
  const v1Root = acceptableEvidencePairs({ schema_version: 1, work_issue: 42, generation: 1 })
  assert.equal(v1Root.length, 2)

  // Pair↔generation binding holds even for v1: a schema_version 1 contract at
  // generation > 1 is NOT given the legacy paths (#3380).
  const v1 = acceptableEvidencePairs({ schema_version: 1, work_issue: 42, generation: 2 })
  assert.equal(v1.length, 1)
  assert.deepEqual(v1[0], ['.agent/work/42/2/completion.json', '.agent/work/42/2/contract.json'])
})

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
function boundaryFixture() {
  const directory=mkdtempSync(path.join(tmpdir(),'pr-data-boundary-'))
  const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  const roots={}
  for(const kind of ['data','source']) {
    const root=path.join(directory,kind);mkdirSync(root)
    git(root,['init','-q']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@example.invalid'])
    writeFileSync(path.join(root,'safe.json'),'{}');git(root,['add','safe.json']);git(root,['commit','-qm','fixture'])
    roots[kind]=root;roots[kind+'Sha']=git(root,['rev-parse','HEAD'])
  }
  return {directory,git,options:{root:roots.data,headSha:roots.dataSha,sourceRoot:roots.source,sourceSha:roots.sourceSha},...roots}
}
test('explicit PR data identity accepts real data without executing malicious tracked scripts',()=>{
 const f=boundaryFixture()
 try {writeFileSync(path.join(f.data,'malicious.js'),'throw new Error("must never execute")');f.git(f.data,['add','malicious.js']);f.git(f.data,['commit','-qm','untrusted script data']);f.options.headSha=f.git(f.data,['rev-parse','HEAD']);assert.equal(validatePrDataRoot(f.options,{}),f.data)} finally {rmSync(f.directory,{recursive:true,force:true})}
})
for (const [label,mutate] of [
 ['wrong head',f=>f.options.headSha='a'.repeat(40)],
 ['source drift',f=>writeFileSync(path.join(f.source,'safe.json'),'changed')],
 ['tracked symlink',f=>{symlinkSync('/etc/passwd',path.join(f.data,'escape'));f.git(f.data,['add','escape']);f.git(f.data,['commit','-qm','linked data']);f.options.headSha=f.git(f.data,['rev-parse','HEAD'])}],
 ['unsafe Git hook',f=>f.git(f.data,['config','core.hooksPath','/unsafe'])],
 ['same root',f=>{f.options.sourceRoot=f.data;f.options.sourceSha=f.options.headSha}],
]) test('PR data boundary refuses '+label,()=>{const f=boundaryFixture();try{mutate(f);assert.throws(()=>validatePrDataRoot(f.options,{}),EvidencePathError)}finally{rmSync(f.directory,{recursive:true,force:true})}})
for(const key of ['NODE_OPTIONS','BASH_ENV','PYTHONPATH','LD_PRELOAD','GIT_EXTERNAL_DIFF','GIT_CONFIG_PARAMETERS','GIT_CONFIG_GLOBAL']) test('PR data boundary refuses '+key+' injection',()=>{const f=boundaryFixture();try{assert.throws(()=>validatePrDataRoot(f.options,{[key]:'untrusted'}),EvidencePathError)}finally{rmSync(f.directory,{recursive:true,force:true})}})
