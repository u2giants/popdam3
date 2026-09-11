import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { main, parseArgv } from './gh-read.mjs'

test('parseArgv extracts --out and preserves gh arguments', () => {
  assert.deepEqual(parseArgv(['--out', 'x.zip', '--', 'api', 'repos/o/r/actions/artifacts/1/zip']), {
    out: 'x.zip', args: ['api', 'repos/o/r/actions/artifacts/1/zip'],
  })
  assert.throws(() => parseArgv(['--out']), /needs a file path/)
})

test('empty and mutating requests are refused before execution', () => {
  let calls = 0
  const deps = { run: () => { calls += 1 }, log: () => {}, err: () => {} }
  assert.equal(main([], deps), 2)
  assert.equal(main(['api', '-X', 'POST', 'repos/o/r/issues'], deps), 2)
  assert.equal(calls, 0)
})

test('--out preserves arbitrary bytes without UTF-8 decoding', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-read-'))
  const out = path.join(dir, 'artifact.zip')
  const expected = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80])
  try {
    assert.equal(main(['--out', out, 'api', 'repos/o/r/actions/artifacts/1/zip'], {
      run: (_args, options) => {
        assert.equal(options.encoding, null)
        return expected
      }, log: () => {}, err: () => {},
    }), 0)
    assert.deepEqual(readFileSync(out), expected)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
