import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainModule, launchPlan, SERVER_ARGS } from './mcp-supabase-launch.mjs'

const EXPECTED_SERVER_ARGS = ['-y', '@supabase/mcp-server-supabase@0.11.0', '--read-only', '--project-ref', 'qsllyeztdwjgirsysgai']

test('server arguments are pinned exactly, including --read-only against production', () => {
  assert.deepEqual([...SERVER_ARGS], EXPECTED_SERVER_ARGS)
})

test('windows keeps the cmd launcher route with an exact win32 path on any host', () => {
  assert.deepEqual(launchPlan('win32', 'C:\\Users\\x'), {
    command: 'cmd',
    args: ['/c', 'C:\\Users\\x\\.config\\ai-devops\\mcp-launch.cmd', 'cmd', '/c', 'npx', ...EXPECTED_SERVER_ARGS],
  })
})

test('linux and macOS use the shell launcher with an exact posix path on any host', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(launchPlan(platform, '/home/x'), {
      command: '/home/x/.config/ai-devops/mcp-launch.sh',
      args: ['npx', ...EXPECTED_SERVER_ARGS],
    })
  }
})

test('main-module guard compares real paths and never throws', () => {
  // win32 file URLs need a drive letter (fileURLToPath throws otherwise), so
  // build them via pathToFileURL. The mock realpath folds separators so the
  // '/link/' -> '/real/' mapping applies on both win32 and POSIX.
  const root = process.platform === 'win32' ? 'C:' : ''
  const url = (posixPath) => pathToFileURL(root + posixPath).href
  const real = (p) => p.replaceAll('\\', '/').replace('/link/', '/real/')
  assert.equal(isMainModule(url('/link/a.mjs'), root + '/real/a.mjs', real), true)
  assert.equal(isMainModule(url('/real/a.mjs'), root + '/real/b.mjs', real), false)
  assert.equal(isMainModule(url('/real/a.mjs'), undefined, real), false)
  assert.equal(isMainModule(url('/real/a.mjs'), '/x', () => { throw new Error('ENOENT') }), false)
})

test('.mcp.json launches the existing script through node and holds no secret', () => {
  const cfg = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
  const s = cfg.mcpServers.supabase
  assert.equal(s.command, 'node')
  assert.deepEqual(s.args, ['scripts/mcp-supabase-launch.mjs'])
  assert.equal(s.env, undefined)
  assert.ok(existsSync(fileURLToPath(new URL('../' + s.args[0], import.meta.url))))
})
