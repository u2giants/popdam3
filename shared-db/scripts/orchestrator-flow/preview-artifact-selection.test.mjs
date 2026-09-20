import test from 'node:test'
import assert from 'node:assert/strict'
import {selectPreviewArtifacts} from './preview-artifact-selection.mjs'

function fixture(conclusion = 'success') {
  const head = 'b2633a337008c8a11e5776f2e5cad3efa9137200'
  const run = {id:35228140178, head_sha:head, path:'.github/workflows/shared-supabase-migrations.yml',
    event:'workflow_dispatch', status:'completed', conclusion, run_attempt:1}
  const artifact = (id,name) => ({id,name,expired:false,digest:`sha256:${'a'.repeat(64)}`,
    workflow_run:{id:run.id,head_sha:head}})
  return {run, jobs:{total_count:6,jobs:[
    ['SQL migration guards','success'], ['preview','success'],
    ['Automatic production qualification and dispatch',conclusion],
    ['Production apply review (immutable evidence + hard guards)','skipped'],
    ['Production apply (automatic evidence gates)','skipped'], ['production-dry-run','skipped'],
  ].map(([name,conclusion])=>({name,conclusion,status:'completed'}))},
  artifacts:{total_count:2,artifacts:[artifact(10499394912,`preview-migration-apply-${head}`),
    artifact(10499494924,'automatic-production-apply-review-evidence')]}}
}

for (const conclusion of ['success','failure']) test(`accepts unique validated companion after ${conclusion}`,()=>{
  const evidence=fixture(conclusion)
  assert.deepEqual(selectPreviewArtifacts(evidence),[evidence.artifacts.artifacts[0]])
})

const mutations = {
  'unknown companion': e=>e.artifacts.artifacts[1].name='untrusted',
  'duplicate companion': e=>e.artifacts.artifacts[0].name=e.artifacts.artifacts[1].name,
  'duplicate identity': e=>e.artifacts.artifacts[1].id=e.artifacts.artifacts[0].id,
  'third artifact': e=>{e.artifacts.artifacts.push({...e.artifacts.artifacts[0],id:9});e.artifacts.total_count=3},
  'truncated listing': e=>e.artifacts.total_count=3,
  'expired companion': e=>e.artifacts.artifacts[1].expired=true,
  'unknown expiry': e=>delete e.artifacts.artifacts[1].expired,
  'missing digest': e=>delete e.artifacts.artifacts[1].digest,
  'malformed digest': e=>e.artifacts.artifacts[1].digest='sha256:wrong',
  'missing artifact identity': e=>delete e.artifacts.artifacts[1].id,
  'expired preview': e=>e.artifacts.artifacts[0].expired=true,
  'wrong preview run': e=>e.artifacts.artifacts[0].workflow_run.id++,
  'wrong preview head': e=>e.artifacts.artifacts[0].workflow_run.head_sha='d'.repeat(40),
  'wrong run': e=>e.artifacts.artifacts[1].workflow_run.id++,
  'wrong head': e=>e.artifacts.artifacts[1].workflow_run.head_sha='c'.repeat(40),
  'wrong workflow': e=>e.run.path='.github/workflows/other.yml',
  'wrong event': e=>e.run.event='push',
  'unfinished run': e=>e.run.status='in_progress',
  'rerun': e=>e.run.run_attempt=2,
  'failed preview': e=>e.jobs.jobs[1].conclusion='failure',
  'missing job': e=>e.jobs.jobs.pop(),
  'extra job': e=>e.jobs.jobs.push({...e.jobs.jobs[0]}),
  'truncated jobs': e=>e.jobs.total_count=7,
  'unfinished job': e=>e.jobs.jobs[2].status='in_progress',
  'production ran': e=>e.jobs.jobs[4].conclusion='success',
  'dispatcher mismatch': e=>e.jobs.jobs[2].conclusion='failure',
  'unknown preview artifact': e=>e.artifacts.artifacts[0].name='unrelated',
}
for (const [name, mutate] of Object.entries(mutations)) test(`retains refusal for ${name}`,()=>{
  const evidence=fixture();mutate(evidence)
  assert.equal(selectPreviewArtifacts(evidence),evidence.artifacts.artifacts)
})

test('single preview artifact remains subject to original caller verification',()=>{
  const evidence=fixture();evidence.artifacts.artifacts.pop();evidence.artifacts.total_count=1
  assert.equal(selectPreviewArtifacts(evidence),evidence.artifacts.artifacts)
})
