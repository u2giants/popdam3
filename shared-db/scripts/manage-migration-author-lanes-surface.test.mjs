// The lane manager was split into scripts/lib/lanes/*.mjs (issue #3726). The
// entrypoint must keep its whole public surface: every name exported before the
// split is still exported, with the same kind, and every public name defined in a
// module is the very same binding the entrypoint exports (a re-export, never a
// copy that could drift).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as entry from './manage-migration-author-lanes.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test-fixtures/manage-migration-author-lanes-surface.json', import.meta.url), 'utf8'))
const kind = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const lanesDir = new URL('./lib/lanes/', import.meta.url)

test('entrypoint still exports every pre-split public name with the same kind', () => {
  const missing = Object.keys(fixture.exports).filter((name) => !(name in entry))
  assert.deepEqual(missing, [], 'public names disappeared from the entrypoint')
  const retyped = Object.entries(fixture.exports).filter(([name, type]) => kind(entry[name]) !== type).map(([name]) => name)
  assert.deepEqual(retyped, [], 'public names changed kind')
})

test('every public module binding is re-exported by the entrypoint as the identical object', async () => {
  const files = readdirSync(lanesDir).filter((file) => file.endsWith('.mjs')).sort()
  assert.ok(files.length > 0, 'no lane modules found')
  const owners = new Map()
  for (const file of files) {
    const mod = await import(new URL(file, lanesDir))
    for (const name of Object.keys(mod)) {
      if (!(name in fixture.exports)) continue
      assert.equal(owners.has(name), false, `${name} is defined by both ${owners.get(name)} and ${file}`)
      owners.set(name, file)
      assert.equal(entry[name], mod[name], `${name} from ${file} is not the entrypoint's binding`)
    }
  }
})

test('the CLI entrypoint path is unchanged and still runs main only when invoked directly', () => {
  const source = readFileSync(new URL('./manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.match(source, /^#!\/usr\/bin\/env node/)
  assert.equal(typeof entry.main, 'function')
})
