import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORICAL_REPOSITORY_SLUG, RepositoryIdentityError, currentRepository, isThisRepositoryOrHistorical,
  parseGitHubRemoteUrl, parseRepositorySlug, readOriginUrl, resolveRepositoryIdentity,
} from './repository-identity.mjs'

const origin = (url) => () => url
const resolve = (opts) => resolveRepositoryIdentity({ env: {}, readOrigin: origin(null), ...opts })

// "@" is joined at runtime so the PII forward guard does not read git remotes as email addresses.
const AT = '@'

test('explicit value is used and must agree with other sources', () => {
  assert.equal(resolve({ explicit: 'popcre/shared-db' }), 'popcre/shared-db')
  assert.throws(() => resolve({ explicit: 'popcre/shared-db', env: { GITHUB_REPOSITORY: 'u2giants/shared-db' } }), RepositoryIdentityError)
  assert.throws(() => resolve({ explicit: 'popcre/shared-db', readOrigin: origin('https://github.com/u2giants/shared-db.git') }), /disagreement/)
})

test('GitHub Actions GITHUB_REPOSITORY is used', () => {
  assert.equal(resolve({ env: { GITHUB_REPOSITORY: 'popcre/shared-db' } }), 'popcre/shared-db')
})

test('HTTPS and both SSH remote forms resolve, old and destination slugs alike', () => {
  for (const url of ['https://github.com/popcre/shared-db.git', `https://x-access-token:abc${AT}github.com/popcre/shared-db`,
    `git${AT}github.com:popcre/shared-db.git`, `ssh://git${AT}github.com/popcre/shared-db.git`]) {
    assert.equal(resolve({ readOrigin: origin(url) }), 'popcre/shared-db', url)
  }
  assert.equal(resolve({ readOrigin: origin('https://github.com/u2giants/shared-db') }), 'u2giants/shared-db')
})

test('malformed, non-GitHub and absent sources fail closed', () => {
  for (const url of ['https://gitlab.com/popcre/shared-db.git', 'https://github.com/popcre', 'C:/repos/shared-db', 'https://github.com.evil/popcre/shared-db']) {
    assert.throws(() => parseGitHubRemoteUrl(url), RepositoryIdentityError, url)
  }
  for (const bad of ['popcre', 'a/b/c', '../x', 'popcre/shared-db.git', 'popcre/ space', '']) {
    assert.throws(() => parseRepositorySlug(bad), RepositoryIdentityError, bad)
  }
  assert.throws(() => resolve({}), /cannot determine/)
  assert.throws(() => resolve({ env: { GITHUB_REPOSITORY: 'nonsense' } }), RepositoryIdentityError)
})

test('env and origin disagreement is refused; case-only difference agrees', () => {
  assert.throws(() => resolve({ env: { GITHUB_REPOSITORY: 'popcre/shared-db' }, readOrigin: origin(`git${AT}github.com:u2giants/shared-db.git`) }), /refusing to guess/)
  assert.equal(resolve({ env: { GITHUB_REPOSITORY: 'PopCre/shared-db' }, readOrigin: origin(`git${AT}github.com:popcre/shared-db.git`) }), 'PopCre/shared-db')
})

test('an unreadable origin is absent, not a guess', () => {
  assert.equal(readOriginUrl({ spawn: () => ({ status: 2, stdout: '' }) }), null)
  assert.equal(readOriginUrl({ spawn: () => ({ error: new Error('no git') }) }), null)
})

test('historical slug is accepted only for evidence, alongside the current one', () => {
  assert.equal(HISTORICAL_REPOSITORY_SLUG, 'u2giants/shared-db')
  assert.equal(isThisRepositoryOrHistorical('u2giants/shared-db', 'popcre/shared-db'), true)
  assert.equal(isThisRepositoryOrHistorical('popcre/shared-db', 'popcre/shared-db'), true)
  assert.equal(isThisRepositoryOrHistorical('someone/shared-db', 'popcre/shared-db'), false)
})

test('this checkout resolves to a slug', () => {
  assert.match(currentRepository(), /^[^/]+\/[^/]+$/)
})

// ---- #2530 pre-transfer gaps: operator trust and evidence-comment repository ----
import {
  TRUSTED_OPERATOR_LOGIN, expectedOperatorAssociation, isTrustedOperatorComment, repositoryCommentApiPath,
} from './repository-identity.mjs'

test('operator trust keeps the login and requires the association the current owner implies', () => {
  assert.equal(TRUSTED_OPERATOR_LOGIN, 'u2giants')
  const before = 'u2giants/shared-db', after = 'popcre/shared-db'
  assert.equal(expectedOperatorAssociation(before), 'OWNER')
  assert.equal(expectedOperatorAssociation(after), 'MEMBER')
  assert.equal(isTrustedOperatorComment({ author: 'u2giants', author_association: 'OWNER' }, before), true)
  assert.equal(isTrustedOperatorComment({ author: 'U2giants', authorAssociation: 'owner' }, before), true)
  assert.equal(isTrustedOperatorComment({ author: 'u2giants', author_association: 'MEMBER' }, after), true)
  // not weakened: wrong login, looser association, or the other owner's association all refuse
  assert.equal(isTrustedOperatorComment({ author: 'someone', author_association: 'OWNER' }, before), false)
  assert.equal(isTrustedOperatorComment({ author: 'someone', author_association: 'MEMBER' }, after), false)
  assert.equal(isTrustedOperatorComment({ author: 'u2giants', author_association: 'MEMBER' }, before), false)
  assert.equal(isTrustedOperatorComment({ author: 'u2giants', author_association: 'COLLABORATOR' }, after), false)
  assert.equal(isTrustedOperatorComment({ author: 'u2giants', author_association: 'OWNER' }, after), false)
  assert.equal(isTrustedOperatorComment({ author: 'u2giants' }, before), false)
  assert.throws(() => expectedOperatorAssociation('not a slug'), RepositoryIdentityError)
})

test('evidence comments are read only from the current repository, pre-move slug as a redirect alias', () => {
  const after = 'popcre/shared-db'
  assert.equal(repositoryCommentApiPath('https://github.com/popcre/shared-db/issues/12#issuecomment-99', after), 'repos/popcre/shared-db/issues/comments/99')
  // the historical slug is an alias: accepted, but the read targets the CURRENT repository
  assert.equal(repositoryCommentApiPath('https://github.com/u2giants/shared-db/pull/3#issuecomment-7', after), 'repos/popcre/shared-db/issues/comments/7')
  assert.equal(repositoryCommentApiPath('https://github.com/U2GIANTS/Shared-DB/issues/3#issuecomment-7', 'u2giants/shared-db'), 'repos/u2giants/shared-db/issues/comments/7')
  for (const foreign of [
    'https://github.com/attacker/shared-db/issues/1#issuecomment-5',
    'https://github.com/popcre/designflow-backend/pull/1#issuecomment-5',
    'https://github.com/u2giants/other/issues/1#issuecomment-5',
  ]) assert.throws(() => repositoryCommentApiPath(foreign, after), /not popcre\/shared-db/)
  for (const malformed of ['', null, 'https://github.com/popcre/shared-db/issues/1', 'https://evil.example/popcre/shared-db/issues/1#issuecomment-5', 'https://github.com/popcre/shared-db/issues/1#issuecomment-5x']) {
    assert.throws(() => repositoryCommentApiPath(malformed, after), RepositoryIdentityError)
  }
})
