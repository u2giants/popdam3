#!/usr/bin/env node
//
// REVIEWER TURN BUDGET — why a large migration got no verdict (issue #2492)
//
// WHAT HAPPENED, THREE TIMES
// --------------------------
//   `ai-grok-review` returned no recordable terminal verdict on PR #2409, a
//   1798-line migration, and the round had to be released as
//   `turn_limit_cancelled` and replaced. The same reviewer succeeded on PR #2490,
//   a 914-line migration. Each occurrence burned a reviewer slot, a release, a
//   replacement and a full re-review.
//
// WHERE THE CEILING ACTUALLY IS
// -----------------------------
//   It is not an input-size limit and it is not a token limit. The wrapper takes
//   the whole brief through `--prompt-file`, so nothing is truncated. The limit is
//   a TURN budget: `ai-grok-review` defaults to 20 agent turns
//   (`AI_GROK_MAX_TURNS`). A reviewer reading a 1798-line migration spends its
//   turns opening files and runs out before it writes a verdict line. The two
//   observed data points bracket the threshold between 914 and 1798 changed lines.
//
//   `--max-turns` is documented in that wrapper as overridable PER CALL — it is a
//   runtime bound, not part of the cached prompt prefix — so the caller can size
//   it. That is what this module does, and it is why this fix belongs here in
//   `shared-db` (the caller that knows how big the review is) rather than as a
//   blind change to the wrapper's global default in another repository.
//
// WHY RAISE THE BUDGET RATHER THAN SKIP GROK ON BIG MIGRATIONS
// ------------------------------------------------------------
//   Skipping a reviewer on exactly the changes that most need reviewing is the
//   wrong half of the choice offered on the issue: the largest migrations carry
//   the most risk. Sizing the budget keeps the reviewer on the work.
//
// THE FLOOR IS TODAY'S DEFAULT, AND THE MEASUREMENT CANNOT BLOCK A REVIEW.
//   No review ever receives FEWER turns than it does today. If the size cannot be
//   measured, the review still starts, on the unmeasured floor, and the reason is
//   carried forward so a later refusal can name it. A measurement that could veto
//   a review would be a new way to lose a reviewer slot, which is the defect.

export const GROK_WRAPPER = 'ai-grok-review'

/**
 * Per-wrapper turn policy. Only wrappers whose `--max-turns` contract is
 * documented as a per-call runtime bound may appear here.
 *
 * `base` is the wrapper's own default, so the floor is a no-op against today.
 * `perLines`/`step` come from the two measured occurrences: 914 changed lines fit
 * inside 20 turns and 1798 did not, so the grant rises with the reading load
 * rather than being set to one guessed number.
 */
export const TURN_BUDGET_POLICY = Object.freeze({
  [GROK_WRAPPER]: Object.freeze({ option: '--max-turns', base: 20, perLines: 250, step: 5, cap: 120, unmeasured: 40 }),
})

export const MIGRATIONS_PATH = 'supabase/migrations'

export function wrapperBaseName(wrapper) {
  return String(wrapper ?? '').replace(/\\/g, '/').split('/').pop().replace(/\.(cmd|bat|exe)$/i, '')
}

/**
 * Windows resolves these wrappers through `.cmd` shims whose on-disk casing is not
 * guaranteed, so the lookup is case-insensitive. A wrapper that missed its policy
 * over a capital letter would silently go back to the 20-turn default.
 */
export function turnPolicyFor(wrapper) {
  return TURN_BUDGET_POLICY[wrapperBaseName(wrapper).toLowerCase()] ?? null
}

/**
 * The turn budget for a review of `changedLines` changed migration lines.
 *
 * `null` lines means the size is UNKNOWN, which is not the same as small: an
 * unknown size gets the unmeasured floor, which is above the wrapper default,
 * because the case this exists for is precisely the one that is hard to read.
 */
export function turnBudgetFor(changedLines, policy) {
  if (!policy) return null
  if (changedLines === null || changedLines === undefined) return policy.unmeasured
  const lines = Number(changedLines)
  if (!Number.isFinite(lines) || lines < 0) return policy.unmeasured
  return Math.min(policy.cap, policy.base + Math.ceil(lines / policy.perLines) * policy.step)
}

/**
 * Changed lines under `supabase/migrations` between the review head and its merge
 * base with the base branch, measured with local git in the review worktree.
 *
 * EVERY failure returns `null` (unknown) and never throws. This runs immediately
 * before a reviewer is launched; a measurement that could throw would be a new way
 * to spend a reviewer slot on a crash.
 */
export function changedMigrationLines({ worktree, baseRef = 'origin/main', headRef = 'HEAD' }, run) {
  try {
    const git = (args) => String(run('git', ['-C', worktree, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) ?? '')
    const mergeBase = git(['merge-base', baseRef, headRef]).trim()
    if (!/^[0-9a-f]{7,40}$/.test(mergeBase)) return null
    const numstat = git(['diff', '--numstat', mergeBase, headRef, '--', MIGRATIONS_PATH])
    let total = 0
    for (const line of numstat.split(/\r?\n/)) {
      const [added, removed] = line.trim().split(/\s+/)
      if (added === '-' || removed === '-') continue
      const a = Number(added)
      const r = Number(removed)
      if (Number.isFinite(a)) total += a
      if (Number.isFinite(r)) total += r
    }
    return total
  } catch {
    return null
  }
}

/**
 * Add the sized `--max-turns` to a wrapper argument list.
 *
 * A caller that supplied its own `--max-turns` is left alone: an explicit operator
 * bound is deliberate and must not be silently overridden.
 *
 * @returns {{args: string[], applied: boolean, budget: number|null, changedLines: number|null, reason: string}}
 */
export function withTurnBudget(wrapper, args, changedLines) {
  const list = [...(args ?? [])]
  const policy = turnPolicyFor(wrapper)
  if (!policy) return { args: list, applied: false, budget: null, changedLines, reason: 'this wrapper has no per-call turn budget contract' }
  const overrideIndex = list.findIndex((arg) =>
    typeof arg === 'string' && (arg === policy.option || arg.startsWith(`${policy.option}=`)))
  if (overrideIndex !== -1) {
    const override = list[overrideIndex]
    // The governed runner accepts both spellings; the installed wrapper takes
    // only separate --max-turns N tokens. Preserve the operator's bound.
    if (override !== policy.option) list.splice(overrideIndex, 1, policy.option, override.slice(policy.option.length + 1))
    return { args: list, applied: false, budget: null, changedLines, reason: `the caller supplied its own ${policy.option}` }
  }
  const budget = turnBudgetFor(changedLines, policy)
  list.push(policy.option, String(budget))
  return {
    args: list,
    applied: true,
    budget,
    changedLines,
    reason: changedLines === null || changedLines === undefined
      ? `migration size could not be measured, so the unmeasured floor of ${budget} turns was granted`
      : `${changedLines} changed migration line(s) were granted ${budget} turns`,
  }
}

/**
 * The sentence appended to a non-verdict refusal so the failure is diagnosable
 * from the refusal alone. Issue #2492's whole cost was that "no verdict" said
 * nothing about why, so each occurrence had to be re-investigated by hand.
 */
export function turnBudgetDiagnostic(decision) {
  if (!decision || !decision.applied) return ''
  return ` The reviewer was launched with ${decision.budget} turn(s): ${decision.reason}. If it exhausted them, raise the turn policy in scripts/lib/reviewer-turn-budget.mjs rather than re-running the same budget.`
}
