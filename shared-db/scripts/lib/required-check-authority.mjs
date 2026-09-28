import { createHash } from 'node:crypto'

export class RequiredCheckAuthorityError extends Error {}
const refuse = (message) => { throw new RequiredCheckAuthorityError(message) }
const named = (value) => typeof value === 'string' && value.trim().length > 0
const validRepo = (value) => typeof value === 'string' && value.split('/').length === 2 && value.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')
const appId = (value) => value == null || value === -1 ? null : (Number.isSafeInteger(value) && value > 0 ? value : refuse('required check producer identity is unreadable'))

// Canonical JSON: object keys sorted at every level. Two reads that say the
// same thing must produce the same revision digest, or representational
// key-order jitter refuses the merge unactionably.
export function stableStringify(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) refuse('authority contains a non-JSON value')
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// The revision digest is a pure function of these five fields. Recomputing it
// binds an authority object to its own content instead of trusting a
// shape-only hex string.
export function computeRevision({ repository_id: repositoryId, repository, branch, sources, checks = [] }) {
  return createHash('sha256').update(stableStringify({ repository_id: repositoryId, repository, branch, sources, checks: normalizeRequirements(checks) })).digest('hex')
}
export function normalizeRequirements(checks) {
  if (!Array.isArray(checks)) refuse('required checks are not a complete list')
  const unique = new Map()
  for (const check of checks) {
    if (!named(check?.context)) refuse('required check context is unreadable')
    const item = { context: check.context, app_id: appId(check.app_id) }
    unique.set(JSON.stringify(item), item)
  }
  return [...unique.values()].sort((a, b) => a.context.localeCompare(b.context) || (a.app_id ?? -1) - (b.app_id ?? -1))
}

// Ref.branchProtectionRule resolves the actual classic rule for this branch.
// /rules/branches resolves applicable ACTIVE repository AND inherited rulesets.
// Neither a hand-authored manifest nor an expiring attestation authorizes a merge.
// GitHub itself performs the final atomic policy enforcement; callers must read
// this again under the merge lock and must never use an administrative bypass.
//
// TOKEN PERMISSIONS: the reads below require ADMIN-LEVEL access. GraphQL
// `branchProtectionRule` and REST `/rules/branches` need Administration:read,
// a classic PAT with `repo` scope, or a GitHub App with administration
// permission. `contents:read` is NOT sufficient — the live guarded-migration-merge
// run 36186790619 proved this: github.token received
// "Resource not accessible by integration". A 403 on any read causes
// every merge to refuse (fail-closed). When GraphQL returns
// branchProtectionRule === null, a REST /protection probe distinguishes
// genuine absence (404) from an unauthorized null (403 or 200-inconsistent):
// GitHub hides unauthorized nullable fields as null, so a bare null must never
// be trusted as "no classic rule".
function confirmClassicProtectionAbsent({ repo, branch, read }) {
  try {
    read(['api', `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`])
  } catch (error) {
    const message = String(error?.message ?? error?.stderr ?? '')
    if (/404|Not Found/i.test(message)) return
    if (/403|Forbidden|401|Unauthorized|Resource not accessible/i.test(message)) refuse('classic protection is not readable (permission denied); GraphQL null cannot be trusted as absent')
    refuse('classic protection probe failed; GraphQL null cannot be trusted as absent')
  }
  refuse('classic protection exists but GraphQL returned null; refusing unauthorized-null')
}
export function readEffectiveRequiredChecks({ repo, branch = 'main', read, now = () => new Date() }) {
  if (!validRepo(repo) || !named(branch)) refuse('repository or branch identity is invalid')
  const [owner, name] = repo.split('/')
  const query = 'query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){databaseId nameWithOwner ref(qualifiedName:$ref){name target{oid} branchProtectionRule{id requiresStatusChecks requiresStrictStatusChecks requiredStatusCheckContexts requiredStatusChecks{context app{databaseId}}}}}}'
  const response = read(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `ref=refs/heads/${branch}`])
  if (response?.errors?.length) refuse('effective branch protection GraphQL read returned errors')
  const repository = response?.data?.repository
  if (!Number.isSafeInteger(repository?.databaseId) || repository.databaseId <= 0 || repository.nameWithOwner?.toLowerCase() !== repo.toLowerCase() || repository.ref?.name !== branch || !/^[a-f0-9]{40}$/.test(repository.ref?.target?.oid ?? '')) refuse('effective branch protection repository/branch identity is unknown')
  const protection = repository.ref.branchProtectionRule
  const requirements = []
  if (protection !== null) {
    if (!named(protection?.id) || typeof protection.requiresStatusChecks !== 'boolean' || typeof protection.requiresStrictStatusChecks !== 'boolean' || !Array.isArray(protection.requiredStatusCheckContexts) || !Array.isArray(protection.requiredStatusChecks)) refuse('effective classic protection is incomplete')
    if (protection.requiresStatusChecks) {
      for (const item of protection.requiredStatusChecks) requirements.push({ context: item.context, app_id: item.app == null ? null : item.app.databaseId })
      const contexts = new Set(requirements.map((item) => item.context))
      if (protection.requiredStatusCheckContexts.some((context) => !contexts.has(context)) || requirements.some((item) => !protection.requiredStatusCheckContexts.includes(item.context))) refuse('classic context and producer lists disagree')
    }
  } else {
    // GraphQL hides unauthorized nullable fields as null. Probe REST /protection
    // to distinguish genuine absence (404) from a permission-denied null (403)
    // or an inconsistent read (200 with a real rule). Fail closed on anything
    // other than a clean 404.
    confirmClassicProtectionAbsent({ repo, branch, read })
  }
  const perPage = 100
  const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=${perPage}`])
  if (!Array.isArray(pages) || !pages.length || pages.some((page) => !Array.isArray(page))) refuse('effective ruleset read is incomplete')
  // Each non-last page must be full; a short non-last page means gh stopped
  // paginating early and we are about to under-count requirements (fail-open).
  for (let i = 0; i < pages.length - 1; i++) {
    if (pages[i].length !== perPage) refuse('effective ruleset pagination is incomplete')
  }
  // A full last page (including a single full page) is ambiguous: --paginate
  // stops at Link boundaries and a truncated read looks identical to an exact
  // multiple of per_page. Refuse unless an explicit next-page read confirms
  // the end with an empty page (fail-closed).
  if (pages[pages.length - 1].length === perPage) {
    const confirm = read(['api', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=${perPage}&page=${pages.length + 1}`])
    if (!Array.isArray(confirm) || confirm.length > 0) refuse('effective ruleset pagination is incomplete')
  }
  const rules = pages.flat()
  for (const rule of rules) {
    if (!named(rule?.type) || !Number.isSafeInteger(rule.ruleset_id) || !named(rule.ruleset_source_type) || !named(rule.ruleset_source)) refuse('effective ruleset source identity is incomplete')
    if (rule.type === 'required_status_checks') {
      if (!Array.isArray(rule.parameters?.required_status_checks)) refuse('effective ruleset check list is unreadable')
      for (const item of rule.parameters.required_status_checks) requirements.push({ context: item.context, app_id: item.integration_id ?? null })
    }
  }
  const checks = normalizeRequirements(requirements)
  if (!checks.length) refuse('effective policy requires no checks; refusing unknown or removed protection')
  const sources = { classic: protection, rulesets: rules }
  const revision = computeRevision({ repository_id: repository.databaseId, repository: repository.nameWithOwner, branch, sources, checks })
  return { schema_version: 1, mode: 'live-effective-settings', repository_id: repository.databaseId, repository: repository.nameWithOwner, branch, base_sha: repository.ref.target.oid, capturedIso: now().toISOString(), revision, sources, checks }
}

// PREFLIGHT-TIME PERMISSION PROBE (issue #3361). The authority reads above are
// load-bearing: if the token cannot complete them, EVERY merge refuses
// permanently at the preflight with no hint about why. This probe attempts
// exactly those two reads first and fails closed with an actionable message
// naming the real requirement (admin / Administration:read / GitHub App),
// turning "every merge refuses mysteriously" into "permission denied, here's
// what to grant". The guarded-lane run of this probe is itself the run-link
// proof that the token can complete the reads.
export function probeAuthorityReadPermissions({ repo, branch = 'main', read }) {
  if (!validRepo(repo) || !named(branch)) refuse('repository or branch identity is invalid')
  const [owner, name] = repo.split('/')
  const query = 'query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){databaseId nameWithOwner ref(qualifiedName:$ref){name target{oid} branchProtectionRule{id}}}}'
  const actionable = (detail) => refuse(`authority-read token cannot complete the required-check authority reads (${detail}). GraphQL branchProtectionRule and REST /rules/branches require admin-level access: a classic PAT with repo scope, Administration:read, or a GitHub App with administration permission. contents:read is NOT enough. Set a repository secret (e.g. SYNC_TOKEN or REQUIRED_CHECKS_AUTHORITY_TOKEN) holding a token with admin access and pass it as AUTHORITY_TOKEN to the preflight step. This probe fails closed so the merge path cannot refuse later without naming the denied permission.`)
  try {
    const response = read(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `ref=refs/heads/${branch}`])
    if (response?.errors?.length) actionable(`GraphQL branchProtectionRule read returned errors: ${JSON.stringify(response.errors).slice(0, 200)}`)
    const repository = response?.data?.repository
    if (!Number.isSafeInteger(repository?.databaseId) || repository.databaseId <= 0 || repository.nameWithOwner?.toLowerCase() !== repo.toLowerCase() || repository.ref?.name !== branch || !/^[a-f0-9]{40}$/.test(repository.ref?.target?.oid ?? '')) actionable('GraphQL branchProtectionRule read did not return the requested repository and branch identity')
    if (repository.ref.branchProtectionRule === null) confirmClassicProtectionAbsent({ repo, branch, read })
    else if (!named(repository.ref.branchProtectionRule?.id)) actionable('GraphQL branchProtectionRule read returned incomplete protection')
  } catch (error) {
    const message = String(error?.message ?? error?.stderr ?? '')
    if (/403|Forbidden|401|Unauthorized|Resource not accessible/i.test(message)) actionable(`GraphQL branchProtectionRule read denied: ${message.slice(0, 200)}`)
    actionable(`GraphQL branchProtectionRule read failed: ${message.slice(0, 200)}`)
  }
  try {
    const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=100`])
    if (!Array.isArray(pages) || !pages.length || pages.some((page) => !Array.isArray(page))) actionable('REST /rules/branches read did not return a usable rule list')
  } catch (error) {
    const message = String(error?.message ?? error?.stderr ?? '')
    if (/403|Forbidden|401|Unauthorized|Resource not accessible/i.test(message)) actionable(`REST /rules/branches read denied: ${message.slice(0, 200)}`)
    actionable(`REST /rules/branches read failed: ${message.slice(0, 200)}`)
  }
  return { ok: true, repo, branch, proven: ['GraphQL branchProtectionRule', 'REST /rules/branches'] }
}
