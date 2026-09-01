import assert from 'node:assert/strict'
import test from 'node:test'
import { runGovernedReview, verdictFromOutput } from './run-governed-review.mjs'

const options={issue:1824,pr:2000,headSha:'a'.repeat(40),reviewer:'glm-5.3',wrapper:'ai-glm',worktree:'C:/review',slot:1,wrapperArgs:['review']}

test('adapter with real process payload shapes posts findings and records before returning output',()=>{
  const order=[],spawn=(command)=>{order.push(command);return command==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'})}:{status:0,stdout:`Coverage: scripts.\nVERDICT: APPROVE ${options.headSha}`}}
  const result=runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>order.push('preflight'),record:(row)=>{order.push('record');assert.equal(row.verdict,'APPROVE');return{ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)}}})
  assert.deepEqual(order,['preflight','ai-glm','gh','record'])
  assert.match(result.body,/Coverage/)
  assert.match(result.body,/NON-AUTHORIZING UNLESS/)
})

test('recording failure leaves an explicit durable non-authorizing notice',()=>{
  const posts=[]
  const spawn=(command,args,spawnOptions)=>{if(command!=='gh')return{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`};posts.push(JSON.parse(spawnOptions.input).body);return{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'})}}
  assert.throws(()=>runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record:()=>{throw new Error('lease changed')}}),/lease changed/)
  assert.match(posts[0],/NON-AUTHORIZING UNLESS/)
  assert.match(posts[1],/REVIEW RECORDING FAILED/)
})

test('honest review output without a verdict artifact path is refused',()=>{
  assert.throws(()=>runGovernedReview(options,{spawn:()=>({status:0,stdout:'I reviewed every file and found no issues.'}),resolve:(name)=>name,preflight:()=>{},record:()=>assert.fail('must not record')}),/did not produce/)
})
test('wrapper refusal forms remain terminal verdicts, not transport failures',()=>{
  assert.equal(verdictFromOutput(`VERDICT: REVISE ${options.headSha}`,options.headSha),'REVISE')
  assert.equal(verdictFromOutput(`VERDICT: REJECT ${options.headSha}`,options.headSha),'REJECT')
  assert.equal(verdictFromOutput(`VERDICT: APPROVE ${options.headSha}\nVERDICT: REJECT ${options.headSha}`,options.headSha),null)
  assert.equal(verdictFromOutput(`VERDICT: APPROVE ${'b'.repeat(40)}`,options.headSha),null)
})
