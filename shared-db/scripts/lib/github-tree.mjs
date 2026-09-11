// ONE tree read per ref, then blobs by SHA (issue #2342).
//
// Every collision and lease gate used to resolve file content with a per-file
// Contents call. This reader fetches one complete recursive tree per ref and
// then fetches file content by blob SHA, cached across refs.
//
// A GitHub 404 remains a semantic answer, never a retry signal. Path absence is
// derived from the complete tree. A truncated or malformed tree is refused so
// missing entries can never become a false clear.

import { runGitHubCommand, ghJson } from './github-transport.mjs'

export class TreeReadError extends Error {}

/**
 * @param {object} [io]
 * @param {(args: string[]) => any}    [io.json]  ghJson-shaped
 * @param {(args: string[]) => string} [io.raw]   runGitHubCommand-shaped
 * @param {(detail: string) => Error}  [io.wrapError] keep the caller's own refusal
 */
export function createTreeReader({ json, raw, wrapError } = {}) {
  const fail = (detail) => (wrapError ? wrapError(detail) : new TreeReadError(detail))
  const readJson = json ?? ((args) => ghJson(args, { wrapError: (detail) => fail(detail) }))
  const readRaw = raw ?? ((args) => runGitHubCommand(args, { wrapError: (detail) => fail(detail) }))

  // A visible delimiter keeps this JavaScript module readable to reviewers and
  // text guards; literal NUL bytes make Git classify it as binary.
  const trees = new Map() // `${repo}\u0000${ref}` -> Map(path -> sha)
  const blobs = new Map() // `${repo}\u0000${sha}` -> text
  const calls = { trees: 0, blobs: 0 }

  function treeAtRef(repo, ref) {
    const key = `${repo}\u0000${ref}`
    const cached = trees.get(key)
    if (cached) return cached
    calls.trees += 1
    const body = readJson(['api', `repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`])
    if (body?.truncated === true) {
      throw fail(
        `GitHub truncated the recursive tree for ${repo}@${ref}. A truncated tree makes present ` +
        'files look absent, which would be a silent false clear; refusing instead.',
      )
    }
    if (!Array.isArray(body?.tree)) throw fail(`GitHub returned no tree for ${repo}@${ref}`)
    const map = new Map()
    for (const entry of body.tree) {
      if (entry?.type === 'blob' && entry.path && entry.sha) map.set(entry.path, entry.sha)
    }
    trees.set(key, map)
    return map
  }

  return {
    /** Path -> blob SHA for the whole ref. One network call per (repo, ref). */
    treeAtRef,

    /** True when the path is tracked at that ref. Costs nothing after the tree read. */
    hasPathAtRef: (repo, path, ref) => treeAtRef(repo, ref).has(path),

    /** Every tracked path at the ref, sorted. */
    pathsAtRef: (repo, ref) => [...treeAtRef(repo, ref).keys()].sort(),

    /**
     * Raw file text at a ref, or null when the ref does not track that path.
     * Null is an answer read off the tree, never an interpreted 404.
     */
    readFileAtRef(repo, path, ref) {
      const sha = treeAtRef(repo, ref).get(path)
      if (!sha) return null
      const key = `${repo}\u0000${sha}`
      if (blobs.has(key)) return blobs.get(key)
      calls.blobs += 1
      const text = readRaw([
        'api',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${repo}/git/blobs/${sha}`,
      ])
      blobs.set(key, text)
      return text
    },

    /** Test-visible call counts; requirement 4 is measured rather than asserted-about. */
    callCounts: () => ({ ...calls }),
  }
}
