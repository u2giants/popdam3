import assert from 'node:assert/strict'
import test from 'node:test'
import { readSessionId, resolveSessionAuthority, sessionAuthorityRefusal, SESSION_ID_ENV } from './session-authority.mjs'

const env = (value) => (value === undefined ? {} : { [SESSION_ID_ENV]: value })

test('#3874 an undeclared or blank session is never live', () => {
  for (const value of [undefined, '', '   ']) {
    const authority = resolveSessionAuthority({ env: env(value) })
    assert.equal(authority.live, false)
    assert.equal(authority.state, 'none')
    assert.notEqual(authority.calling_task, authority.task)
  }
})

test('#3874 a malformed session id is refused, not trimmed into validity', () => {
  for (const value of ['a', 'bad id with spaces', 'x;rm -rf /', '-leading-dash']) {
    const authority = resolveSessionAuthority({ env: env(value) })
    assert.equal(authority.live, false)
    assert.equal(authority.state, 'invalid')
  }
})

test('#3874 a declared session with no named claim is live and matches itself', () => {
  const authority = resolveSessionAuthority({ env: env('claude-chat-1234') })
  assert.equal(authority.live, true)
  assert.equal(authority.task, 'claude-chat-1234')
  assert.equal(authority.calling_task, authority.task)
})

test('#3874 a named claim must be owned by the declared session', () => {
  const ok = resolveSessionAuthority({ env: env('owner-a'), claimOwner: 'owner-a' })
  assert.equal(ok.live, true)
  const other = resolveSessionAuthority({ env: env('owner-a'), claimOwner: 'owner-b' })
  assert.equal(other.live, false)
  assert.equal(other.state, 'claim-owner-mismatch')
  assert.notEqual(other.task, other.calling_task)
  for (const owner of [null, '', '  ']) {
    const unreadable = resolveSessionAuthority({ env: env('owner-a'), claimOwner: owner })
    assert.equal(unreadable.live, false)
    assert.equal(unreadable.state, 'unsafe')
  }
})

test('#3874 the refusal names the variable and the reason', () => {
  const message = sessionAuthorityRefusal(resolveSessionAuthority({ env: {} }))
  assert.match(message, /SHARED_DB_SESSION_ID/)
  assert.match(message, /not set/)
  assert.equal(readSessionId({}), null)
})

// Real #2874 adoption owner: retain the owner label and exact-object lock,
// while checking its exact declared chat identity through the production path.
const ownChat='01a1126f-6efb-7a22-8034-4471909f2c86';
const foreignChat='01a111e8-4c90-7df0-9106-4547392130ce';
test('#3972 established full chat owner labels match only their exact UUID',()=>{
  for(const engine of ['Codex','Claude']){
    const owner=`${engine} chat ${ownChat} on edge-dev3`;
    const authority=resolveSessionAuthority({env:env(ownChat),claimOwner:owner});
    assert.equal(authority.live,true);assert.equal(authority.task,ownChat);assert.equal(authority.calling_task,ownChat);
    const foreign=resolveSessionAuthority({env:env(foreignChat),claimOwner:owner});
    assert.equal(foreign.live,false);assert.equal(foreign.state,'claim-owner-mismatch');
  }
});
test('#3972 labels cannot authorize by substring, malformed UUID or ambiguous suffix',()=>{
  for(const owner of [`prefix Codex chat ${ownChat} on edge-dev3`,`Codex chat ${ownChat} on edge-dev3 extra`,
    `Codex chat ${ownChat} on edge dev3`,`Codex chat ${ownChat} on edge-dev3\nowner: ${foreignChat}`,
    `Unknown chat ${ownChat} on edge-dev3`,`Codex chat ${ownChat.slice(0,-1)} on edge-dev3`,
    `Codex chat ${ownChat} on -host`,`Codex chat ${ownChat} on edge-dev3;other`,
    `Codex chat ${foreignChat} on edge-dev3`,`Codex chat ${ownChat} on edge-dev3 on edge-dev4`]){
    const authority=resolveSessionAuthority({env:env(ownChat),claimOwner:owner});assert.equal(authority.live,false);
  }
});
test('#3972 a valid owner label never supplies missing or malformed caller authority',()=>{
  const owner=`Codex chat ${ownChat} on edge-dev3`;
  for(const session of [undefined,'','bad id',owner])assert.equal(resolveSessionAuthority({env:env(session),claimOwner:owner}).live,false);
  assert.equal(resolveSessionAuthority({env:env('other-session'),claimOwner:owner}).live,false);
});
