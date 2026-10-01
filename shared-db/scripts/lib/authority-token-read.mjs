// Authority reads (branch protection and the main-branch protection readback)
// need admin-level access that a GitHub Actions workflow token can never have
// -- there is no `administration` scope for GITHUB_TOKEN. The guarded-merge
// workflow solves this by passing a classic PAT (secrets.SYNC_TOKEN) as
// AUTHORITY_TOKEN and using it ONLY for those reads. This module is that same
// pattern for the abandonment audit: when AUTHORITY_TOKEN is present, the two
// authority reads run with it; every other GitHub call stays on GH_TOKEN, and
// with no elevated token the reads fail closed exactly as before (issue #3857).

export function authorityReadEnv(env = process.env) {
  const token = String(env.AUTHORITY_TOKEN ?? '').trim()
  if (!token) return null
  return { ...env, GH_TOKEN: token }
}
