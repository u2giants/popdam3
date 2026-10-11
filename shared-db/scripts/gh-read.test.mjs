import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

async function runCliThroughPipe(args, payload, ghExit = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-read-pipe-'))
  try {
    const body = path.join(dir, 'body'); writeFileSync(body, payload)
    // Intercept only the external gh process; execute the real CLI and transport on every platform.
    const preload = path.join(dir, 'fixture.cjs')
    writeFileSync(preload, `const cp = require('node:child_process'); const fs = require('node:fs'); const original = cp.execFileSync; cp.execFileSync = (file, args, options) => { if (file !== 'gh') return original(file, args, options); if (Number(process.env.GH_READ_EXIT)) throw new Error('fixture permanent failure'); const bytes = fs.readFileSync(process.env.GH_READ_FIXTURE); return options.encoding ? bytes.toString(options.encoding) : bytes; }; require('node:module').syncBuiltinESMExports();\n`)
    const child = spawn(process.execPath, ['--require', preload, fileURLToPath(new URL('./gh-read.mjs', import.meta.url)), ...args], {
      env: { ...process.env, GH_READ_FIXTURE: body, GH_READ_EXIT: String(ghExit) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
    return { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

for (const text of ['x'.repeat(512 * 1024), '你好 🦁 café'.repeat(50000)]) {
  test(`real CLI pipe preserves complete ${Buffer.byteLength(text)}-byte JSON`, async () => {
    const payload = Buffer.from(JSON.stringify({ number: 4170, body: text }))
    const result = await runCliThroughPipe(['api', 'repos/o/r/pulls/4170'], payload)
    assert.equal(result.code, 0)
    // Compare bytes directly to keep failure messages bounded.
    assert.ok(result.stdout.equals(payload), `stdout was ${result.stdout.length} bytes, expected ${payload.length}`)
    assert.ok(JSON.parse(result.stdout).body === text, 'decoded body differs from the fixture')
  })
}

test('real CLI keeps refusal and transport failure exit codes', async () => {
  const refused = await runCliThroughPipe(['api', '-X', 'POST', 'repos/o/r/issues'], Buffer.from('must not execute'))
  assert.equal(refused.code, 2); assert.equal(refused.stdout.length, 0)
  assert.match(refused.stderr.toString(), /READS only/)
  const failed = await runCliThroughPipe(['api', 'repos/o/r/pulls/1'], Buffer.alloc(0), 1)
  assert.equal(failed.code, 1); assert.equal(failed.stdout.length, 0)
  assert.match(failed.stderr.toString(), /failed after retries/)
})
