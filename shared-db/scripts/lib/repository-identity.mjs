// Repository identity — the ONE place JavaScript decides which GitHub repository
// "this repository" is (issue #2530, plan_shared_db_popcre_transfer_merge_queue.md
// Step 2).
//
// WHY THIS EXISTS. Operational scripts used to hard-code the owner/name slug.
// When the repository changes owner, every hard-coded API path silently keeps
// following GitHub's redirect -- or stops working if the old name is retired --
// while still believing it talks to the canonical repository. Replacing one
// hard-coded owner with another was explicitly rejected in the plan (§7).
//
// RESOLUTION ORDER, and nothing else:
//   1. an explicit value (a CLI flag or API argument);
//   2. the GitHub Actions `GITHUB_REPOSITORY` environment variable;
//   3. the verified GitHub `origin` remote of THIS checkout (the checkout that
//      contains this file, never the caller's current directory).
//
// FAILS CLOSED on a malformed slug, a non-GitHub or unreadable remote, no
// resolvable source at all, or any disagreement between the sources that were
// actually available. It never guesses and never falls back to a constant.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The owner/name this repository was published under before the planned
// transfer. It is NOT a default: it exists only so evidence recorded under the
// old URL (review findings links, run links) stays verifiable after a transfer.
export const HISTORICAL_REPOSITORY_SLUG = 'u2giants/shared-db'

export class RepositoryIdentityError extends Error {
  constructor(message) { super(message); this.name = 'RepositoryIdentityError' }
}

const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/

export function parseRepositorySlug(value, label = 'repository') {
  const text = String(value ?? '').trim()
  const parts = text.split('/')
  if (parts.length !== 2 || !parts.every((part) => SEGMENT.test(part) && part !== '.' && part !== '..' && !part.endsWith('.git'))) {
    throw new RepositoryIdentityError(`${label} ${JSON.stringify(text)} is not a GitHub owner/name slug`)
  }
  return `${parts[0]}/${parts[1]}`
}

// Accepts only github.com remotes: https (optionally with credentials), ssh://,
// and the scp-like form (user git, host github.com, then :owner/name). Anything else is refused.
export function parseGitHubRemoteUrl(url) {
  const text = String(url ?? '').trim()
  const patterns = [
    /^https:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com(?::22)?\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return parseRepositorySlug(match[1], 'origin remote repository')
  }
  throw new RepositoryIdentityError(`origin remote ${JSON.stringify(text)} is not a GitHub repository URL`)
}

export function sameRepository(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase()
}

const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function readOriginUrl({ cwd = CHECKOUT_ROOT, spawn = spawnSync } = {}) {
  const result = spawn('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return null
  const url = String(result.stdout ?? '').trim()
  return url || null
}

export function resolveRepositoryIdentity({ explicit, env = process.env, readOrigin = readOriginUrl } = {}) {
  const sources = []
  if (explicit != null && String(explicit).trim() !== '') sources.push(['explicit repository', parseRepositorySlug(explicit, 'explicit repository')])
  if (env?.GITHUB_REPOSITORY) sources.push(['GITHUB_REPOSITORY', parseRepositorySlug(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY')])
  const origin = readOrigin()
  if (origin != null) sources.push(['origin remote', parseGitHubRemoteUrl(origin)])
  if (sources.length === 0) {
    throw new RepositoryIdentityError('cannot determine the GitHub repository: pass it explicitly, set GITHUB_REPOSITORY, or run from a checkout whose origin is a GitHub URL')
  }
  const [firstLabel, chosen] = sources[0]
  for (const [label, slug] of sources.slice(1)) {
    if (!sameRepository(slug, chosen)) {
      throw new RepositoryIdentityError(`repository identity disagreement: ${firstLabel} is ${chosen} but ${label} is ${slug}; refusing to guess`)
    }
  }
  return chosen
}

let cached = null
// Process-wide identity. With no explicit value it is resolved on first use and
// memoized; an explicit value is still checked against env and origin.
export function currentRepository(explicit) {
  if (explicit != null && String(explicit).trim() !== '') return resolveRepositoryIdentity({ explicit })
  if (cached == null) cached = resolveRepositoryIdentity()
  return cached
}

// True when `slug` names this repository now, or the historical slug it was
// published under. Used only to validate evidence URLs that may predate a transfer.
export function isThisRepositoryOrHistorical(slug, current = currentRepository()) {
  return sameRepository(slug, current) || sameRepository(slug, HISTORICAL_REPOSITORY_SLUG)
}

// ---------------------------------------------------------------------------
// Transfer-safe operator trust (#2530, pre-transfer gaps found by Step 2).
//
// Completion records are trusted only when GitHub says they were written by the
// one operator account. That identity is the LOGIN, and it does not change when
// the repository changes owner. What does change is how GitHub describes that
// login's relationship to the repository: `OWNER` while the repository belongs to
// the personal account, `MEMBER` once it belongs to an organization the login is a
// member of. Requiring `OWNER` forever would silently refuse every genuine record
// after the transfer; accepting any trusted association would admit any org
// member or collaborator. So the login stays mandatory and the association must
// be exactly the one that the CURRENT owner implies -- nothing looser.
export const TRUSTED_OPERATOR_LOGIN = 'u2giants'

export function expectedOperatorAssociation(repository = currentRepository()) {
  const owner = parseRepositorySlug(repository).split('/')[0]
  return owner.toLowerCase() === TRUSTED_OPERATOR_LOGIN ? 'OWNER' : 'MEMBER'
}

export function isTrustedOperatorComment(comment, repository = currentRepository()) {
  const association = String(comment?.author_association ?? comment?.authorAssociation ?? '').toUpperCase()
  const author = String(comment?.author ?? comment?.author_login ?? '').toLowerCase()
  return author === TRUSTED_OPERATOR_LOGIN && association === expectedOperatorAssociation(repository)
}

// A durable issue/PR comment URL is read ONLY from this repository. The historical
// slug is accepted as a redirect alias for links written before the transfer, and
// the read always targets the current repository, never the repository a link names.
const COMMENT_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/

export function repositoryCommentApiPath(url, repository = currentRepository()) {
  const match = COMMENT_URL.exec(String(url ?? ''))
  if (!match) throw new RepositoryIdentityError('evidence must be an exact GitHub issue or pull-request comment URL')
  if (!isThisRepositoryOrHistorical(match[1], repository)) {
    throw new RepositoryIdentityError(`evidence comment belongs to ${match[1]}, not ${repository}; only this repository (or its pre-transfer alias) is read`)
  }
  return `repos/${repository}/issues/comments/${match[2]}`
}
