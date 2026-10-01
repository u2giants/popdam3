import { normalizeRequirements } from './required-check-authority.mjs'

const REPOSITORY_ID = 1275568548
const REPOSITORY = 'popcre/shared-db'

function requirementsFrom(value, source) {
  const contexts = value?.contexts
  const checks = value?.checks
  if (!Array.isArray(contexts) || !Array.isArray(checks) || contexts.length !== checks.length || !contexts.length ||
      contexts.some((name) => typeof name !== 'string' || !name.trim()) || new Set(contexts).size !== contexts.length ||
      checks.some((check) => !contexts.includes(check?.context)) || new Set(checks.map((check) => check.context)).size !== checks.length) {
    throw new Error(`${source} required check identities are absent or disagree`)
  }
  return normalizeRequirements(checks)
}

function rulesFrom(pages, confirmRulesEnd) {
  if (!Array.isArray(pages) || !pages.length || pages.some((page) => !Array.isArray(page))) throw new Error('main branch ruleset pagination is incomplete')
  for (let i = 0; i < pages.length - 1; i++) if (pages[i].length !== 100) throw new Error('main branch ruleset pagination is incomplete')
  if (pages[pages.length - 1].length === 100) {
    const end = confirmRulesEnd?.(pages.length + 1)
    if (!Array.isArray(end) || end.length !== 0) throw new Error('main branch ruleset pagination needs an explicit end page')
  }
  const requirements = []
  for (const rule of pages.flat()) {
    if (typeof rule?.type !== 'string' || !rule.type.trim() || !Number.isSafeInteger(rule.ruleset_id) ||
        typeof rule.ruleset_source !== 'string' || !rule.ruleset_source.trim() ||
        typeof rule.ruleset_source_type !== 'string' || !rule.ruleset_source_type.trim()) throw new Error('main branch ruleset source identity is incomplete')
    if (rule.type === 'required_status_checks') {
      if (!Array.isArray(rule.parameters?.required_status_checks)) throw new Error('main branch ruleset required checks are unreadable')
      for (const check of rule.parameters.required_status_checks) requirements.push({ context: check.context, app_id: check.integration_id ?? null })
    }
  }
  return normalizeRequirements(requirements)
}

/** Use the public branch readback only after validating its exact repository, classic policy, and active rules. */
export function readRequiredCheckContexts({ protectedChecks, branch, branchRules, confirmRulesEnd, repository }) {
  let authoritative = null
  try {
    authoritative = requirementsFrom(protectedChecks(), 'branch protection')
  } catch (error) {
    if (!/Resource not accessible by integration \(HTTP 403\)/.test(String(error?.message ?? error))) throw error
  }
  const repo = repository()
  if (repo?.id !== REPOSITORY_ID || repo?.full_name?.toLowerCase() !== REPOSITORY) throw new Error('required-check repository identity is wrong or unreadable')
  const current = branch()
  if (current?.name !== 'main' || current?.protected !== true || current?.protection?.enabled !== true || !/^[a-f0-9]{40}$/.test(current?.commit?.sha ?? '')) {
    throw new Error('main branch protection readback is absent or ambiguous')
  }
  const classic = requirementsFrom(current.protection.required_status_checks, 'main branch readback')
  if (authoritative && JSON.stringify(authoritative) !== JSON.stringify(classic)) throw new Error('main branch required check identities disagree with branch protection')
  const rules = rulesFrom(branchRules(), confirmRulesEnd)
  const effective = normalizeRequirements([...classic, ...rules])
  if (new Set(effective.map((check) => check.context)).size !== effective.length) throw new Error('required check name has ambiguous producer identity')
  return effective.map((check) => check.context)
}
