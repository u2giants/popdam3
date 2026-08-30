import assert from 'node:assert/strict'
import test from 'node:test'
import { isApprovalFor, isVerdictFor } from './lib/review-verdict.mjs'

const HEAD='e3278f1048585c8ef5f6da5a9e311b6af9fdd030'
const row=(body,association)=>({body,author_association:association})

test('free-text verdicts are unauthorized by default',()=>{
  assert.equal(isApprovalFor({body:`VERDICT: APPROVE ${HEAD}`},HEAD),false)
  assert.equal(isVerdictFor({body:`VERDICT: REVISE ${HEAD}`},HEAD),false)
  for(const association of ['NONE','CONTRIBUTOR','FIRST_TIMER','FIRST_TIME_CONTRIBUTOR']){
    assert.equal(isApprovalFor(row(`VERDICT: APPROVE ${HEAD}`,association),HEAD),false)
    assert.equal(isVerdictFor(row(`VERDICT: REVISE ${HEAD}`,association),HEAD),false)
  }
})

test('repository-authorized associations retain real verdict capability',()=>{
  for(const association of ['OWNER','MEMBER','COLLABORATOR']){
    assert.equal(isApprovalFor(row(`VERDICT: APPROVE ${HEAD}`,association),HEAD),true)
    assert.equal(isVerdictFor(row(`VERDICT: REVISE ${HEAD}`,association),HEAD),true)
  }
})

test('GraphQL association casing is accepted without weakening the default',()=>{
  assert.equal(isApprovalFor({body:`VERDICT: APPROVE ${HEAD}`,authorAssociation:'OWNER'},HEAD),true)
  assert.equal(isApprovalFor({body:`VERDICT: APPROVE ${HEAD}`,authorAssociation:'NONE'},HEAD),false)
})
