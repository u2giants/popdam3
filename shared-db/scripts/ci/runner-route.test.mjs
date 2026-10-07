import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRunner, SELF_HOSTED } from './runner-route.mjs'

const now = 1_800_000_000
const base = { eventName: 'pull_request', headRepo: 'popcre/shared-db', repository: 'popcre/shared-db', fallback: 'blacksmith-2vcpu-ubuntu-2404', nowSeconds: now }
const hb = (s, b, t = now - 30) => `${s},${b},${t}`

test('online and idle routes to the self-hosted runner', () => {
  assert.deepEqual(decideRunner({ ...base, heartbeat: hb('online', 'idle') }).runsOn, SELF_HOSTED)
  for (const eventName of ['merge_group', 'push', 'workflow_dispatch'])
    assert.deepEqual(decideRunner({ ...base, eventName, headRepo: undefined, heartbeat: hb('online', 'idle') }).runsOn, SELF_HOSTED)
})

test('every other state falls back to the hosted label', () => {
  const cases = [
    { heartbeat: hb('online', 'busy') },
    { heartbeat: hb('offline', 'idle') },
    { heartbeat: hb('online', 'idle', now - 151) },
    { heartbeat: hb('online', 'idle', now + 3600) },
    { heartbeat: '' },
    { heartbeat: undefined },
    { heartbeat: 'online,idle,notanumber' },
    { heartbeat: 'garbage' },
    { heartbeat: hb('online', 'idle'), headRepo: 'someone/shared-db' },
    { heartbeat: hb('online', 'idle'), headRepo: undefined },
    { heartbeat: hb('online', 'idle'), eventName: 'pull_request_target' },
  ]
  for (const c of cases) assert.equal(decideRunner({ ...base, ...c }).runsOn, base.fallback, JSON.stringify(c))
})

test('an absent fallback is an error, not a silent self-hosted route', () => {
  assert.throws(() => decideRunner({ ...base, fallback: '', heartbeat: hb('online', 'idle') }))
})
