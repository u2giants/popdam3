import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHunks, routeHunks } from './route-lane-manager-patch.mjs'

const files = {
  'scripts/manage-migration-author-lanes.mjs': 'import a from "./a.mjs"\nimport b from "./b.mjs"\n\nexport function main(){\n  return 1\n}\n',
  'scripts/lib/lanes/x.mjs': 'import c from "../c.mjs"\n\nexport function helper(){\n  const v=1\n  return v\n}\nexport function other(){\n  return 2\n}\n',
}

test('a hunk moves to the one file that now holds its old side, export prefix included', () => {
  const patch = ['diff --git a/scripts/manage-migration-author-lanes.mjs b/scripts/manage-migration-author-lanes.mjs', '--- a/x', '+++ b/x', '@@ -40,5 +40,5 @@', ' function helper(){', '   const v=1', '-  return v', '+  return v+1', ' }', ''].join('\n')
  const { patch: out, refused } = routeHunks(parseHunks(patch), files)
  assert.deepEqual(refused, [])
  assert.match(out, /^diff --git a\/scripts\/lib\/lanes\/x\.mjs/)
  assert.match(out, /\n export function helper\(\)\{\n   const v=1\n-  return v\n\+  return v\+1\n/)
})

test('a hunk whose old side exists nowhere is refused, never guessed', () => {
  const patch = ['@@ -1,2 +1,2 @@', ' nothing like this', '-exists anywhere', '+changed', ''].join('\n')
  const { refused } = routeHunks(parseHunks(patch), files)
  assert.equal(refused.length, 1)
})
