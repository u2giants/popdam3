import assert from 'node:assert/strict'
import test from 'node:test'

import { checkOwnership } from './check-domain-ownership.mjs'

test('accepts the hostname when DB Data Admin ownership is explicit', () => {
  assert.deepEqual(
    checkOwnership([
      ['README.md', 'DB Data Admin runs at https://data.designflow.app.'],
    ]),
    [],
  )
})

test('rejects an ownerless hostname reference', () => {
  assert.match(
    checkOwnership([
      ['old-plan.md', 'Production API: https://data.designflow.app'],
    ])[0],
    /without identifying its owner/,
  )
})

test('rejects retired runtime connection material', () => {
  const failures = checkOwnership([
    ['runbook.md', 'Load credentials from .directus-deploy.env and set DX_URL=example.'],
  ])

  assert.equal(failures.length, 2)
  assert.match(failures[0], /retired environment file/)
  assert.match(failures[1], /retired API connection variable/)
})

test('rejects claims that the retired application remains a rollback service', () => {
  assert.match(
    checkOwnership([
      ['cutover.md', 'Directus remains online as a read-only rollback source.'],
    ])[0],
    /live or rollback role/,
  )
})

test('permits historical provenance without a live dependency', () => {
  assert.deepEqual(
    checkOwnership([
      [
        'migration.sql',
        "The source_system='directus' label records retired-source provenance only.",
      ],
    ]),
    [],
  )
})
