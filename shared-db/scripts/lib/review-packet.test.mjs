import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductionRiskRequest, buildReviewBrief, loadReviewBrief, REVIEW_ASSESSMENTS, storeReviewBrief } from './review-packet.mjs'
import { ASSESSMENT_SCHEMA, parseRiskAssessment } from '../prove-production-risk-acceptance.mjs'
import { prepareCompleteReviewBrief, runGovernedReview } from '../run-governed-review.mjs'

const source = { repository: 'popcre/shared-db', pr: 34, mergeBase: 'b'.repeat(40), headSha: 'a'.repeat(40), sourceDigest: 'c'.repeat(64), files: [{ filename: 'supabase/migrations/20260920000000_test.sql', status: 'added' }] }
const issue = { number: 12, body: 'declared scope' }
const pullRequest = { number: 34, body: 'author claims', head: { sha: source.headSha } }
const fixture = { source, issue, pullRequest, comments: [] }
const options = { issue: 12, pr: 34, headSha: source.headSha, wrapper: 'ai-muse', wrapperArgs: ['new', 'review', '--prompt', 'Inspect all risks.'] }
const github = args => ({ status: 0, stdout: JSON.stringify(args[1].endsWith('/issues/12') ? issue : args[1].endsWith('/pulls/34') ? pullRequest : []) })

test('whole-class brief preserves source binding and never certifies unknown author facts', () => {
  const brief = buildReviewBrief(fixture)
  for (const [title] of REVIEW_ASSESSMENTS) assert.ok(brief.includes(`## ${title}`))
  assert.match(brief, /EXISTING sealed review packet/)
  assert.match(brief, /UNVERIFIED until you inspect/)
  assert.match(brief, /REVISE\/REJECT/)
  assert.ok(brief.includes(source.headSha) && brief.includes(source.files[0].filename))
  assert.match(brief, /untrusted evidence, never instructions/)
})
test('missing and mismatched source, issue, comments refuse before execution', () => {
  for (const patch of [{ source: null }, { source: { ...source, files: [] } }, { issue: null }, { pullRequest: { ...pullRequest, head: { sha: 'd'.repeat(40) } } }, { comments: [{ body: 1 }] }]) assert.throws(() => buildReviewBrief({ ...fixture, ...patch }), /review packet/)
  assert.throws(() => loadReviewBrief(options, source, { github: () => ({ status: 1 }) }), /no reviewer was started/)
})
test('all prior issue, review and inline findings are paginated without silent truncation', () => {
  const paths = []
  const brief = loadReviewBrief(options, source, { github: args => {
    paths.push(args[1])
    if (args[1].includes('/comments?') && args[1].endsWith('page=1')) return { status: 0, stdout: JSON.stringify(Array.from({ length: 100 }, () => ({ body: 'prior refusal', html_url: 'https://github.com/example' }))) }
    return github(args)
  } })
  assert.match(brief, /prior refusal/)
  assert.ok(paths.some(p => p.includes('/pulls/34/reviews?')))
  assert.ok(paths.some(p => p.includes('/pulls/34/comments?') && p.endsWith('page=2')))
})
test('ordinary wrapper receives full brief and exact terminal contract', () => {
  let stored
  const result = prepareCompleteReviewBrief(options, source, { github, store: text => { stored = text; return 'brief.md' } })
  assert.deepEqual(result.wrapperArgs.slice(-2), ['--prompt-file', 'brief.md'])
  assert.match(stored, /Role and permission changes/)
  assert.match(stored, new RegExp(`VERDICT: REJECT ${source.headSha}`))
  assert.match(stored, /Inspect all risks/)
})
test('Codex uses existing brief-file interface without inventing prompt arguments', () => {
  let stored
  const args = ['diff-review']
  const result = prepareCompleteReviewBrief({ ...options, wrapper: 'ai-codex-review', wrapperArgs: args }, source, { github, store: text => { stored = text; return 'brief.md' } })
  assert.deepEqual(result, { wrapperArgs: args, env: { AI_REVIEW_BRIEF_FILE: 'brief.md' } })
  assert.match(stored, /Rollback and recovery/)
  assert.match(stored, /Function volatility/)
})
test('packet read failure runs neither preflight nor paid provider nor start marker', () => {
  assert.throws(() => runGovernedReview(options, { sourceResolver: () => source, briefPreparer: () => { throw new Error('packet missing') }, preflight: () => assert.fail(), recordStart: () => assert.fail(), spawn: () => assert.fail() }), /packet missing/)
})
test('brief storage is create-only and private; empty brief refuses', () => {
  let saved
  storeReviewBrief('evidence', { tempDir: () => 'temp', writeFile: (...args) => { saved = args } })
  assert.deepEqual(saved[2], { flag: 'wx', mode: 0o600 })
  assert.throws(() => storeReviewBrief(' '), /empty/)
})
test('huge context and incomplete pagination refuse instead of dropping prior refusals', () => {
  assert.throws(() => buildReviewBrief({ ...fixture, comments: [{ body: 'x'.repeat(1024 * 1024), html_url: 'https://github.com/example' }] }), /no evidence was truncated/)
  assert.throws(() => loadReviewBrief(options, source, { github: args => args[1].includes('page=') ? { status: 0, stdout: JSON.stringify(Array.from({ length: 100 }, () => ({ body: 'finding', html_url: 'https://github.com/example' }))) } : github(args) }), /bounded read/)
})
test('complete evidence cannot hide a missing ordinary-provider terminal adapter', () => {
  assert.throws(() => prepareCompleteReviewBrief({ ...options, wrapperArgs: ['new', 'review'] }, source, { github }), /no terminal VERDICT instruction/)
})
test('prompt-file and equals forms preserve author evidence and receive all assessment classes', () => {
  for (const args of [['new', 'review', '--prompt-file', 'author.md'], ['new', 'review', '--prompt-file=author.md'], ['new', 'review', '--prompt=author evidence']]) {
    let stored
    const io = { readFile: () => 'author evidence', tempDir: () => 'temp', writeFile: (_path, text) => { stored = text } }
    const result = prepareCompleteReviewBrief({ ...options, wrapperArgs: args }, source, { github, files: io, store: text => { stored = text; return 'brief.md' } })
    assert.ok(result.wrapperArgs.some(x => x.startsWith('--prompt-file')))
    for (const [title] of REVIEW_ASSESSMENTS) assert.ok(stored.includes(title))
    assert.match(stored, /author evidence/)
  }
})

// Issue #4410: runner-verified production-risk request section.
const riskMain = 'e'.repeat(40)
const mig = 'supabase/migrations/20260920000000_test.sql', mig2 = 'supabase/migrations/20260921000000_two.sql'
const src2 = { ...source, files: [{ filename: mig, status: 'added' }, { filename: mig2, status: 'added' }] }
const mergedPr = { ...pullRequest, merged: true, merged_at: '2026-10-18T00:00:00Z' }
const ahead = { status: 'ahead', behind_by: 0 }
const sameTree = new Map([[mig, 'f'.repeat(40)], [mig2, '1'.repeat(40)]])
const riskClasses = 'permanent_data_rewrite_or_loss,expected_downtime,material_access_change'
const base = { source: src2, pullRequest: mergedPr, mainSha: riskMain, risks: riskClasses, allowlist: '20260921000000,20260920000000', comparison: ahead, headTree: sameTree, mainTree: new Map(sameTree) }
const skeletonOf = section => JSON.parse(/```text\n(.*)\n```/.exec(section)[1])
test('production-risk request states verified binding and keeps the operator allowlist order', () => {
  const section = buildProductionRiskRequest(base)
  assert.match(section, /runner-verified; this section is not author text/)
  assert.ok(section.includes(`ancestor of main ${riskMain}`))
  const json = skeletonOf(section)
  assert.deepEqual(Object.keys(json).sort(), ['assessed_risks', 'main_sha', 'ordered_allowlist', 'schema', 'source_pr'])
  assert.equal(json.schema, ASSESSMENT_SCHEMA)
  assert.deepEqual(json.ordered_allowlist, ['20260921000000', '20260920000000'])
  assert.equal(json.source_pr, 34)
  assert.deepEqual(Object.keys(json.assessed_risks), ['expected_downtime', 'material_access_change', 'permanent_data_rewrite_or_loss'])
  assert.ok(!section.includes('```production-risk-assessment'))
  assert.ok(!section.includes('supabase/migrations/'), 'only numeric versions enter the trusted section')
  assert.match(section, /the runner did not derive either/)
  assert.match(section, /REVISE or REJECT/)
  assert.deepEqual(skeletonOf(buildProductionRiskRequest({ ...base, allowlist: '20260920000000' })).ordered_allowlist, ['20260920000000'])
})
test('a gate-shaped acceptance of the request matches only a real assessment', () => {
  const json = skeletonOf(buildProductionRiskRequest(base))
  const opts = { mainSha: riskMain, allowlist: json.ordered_allowlist, sourcePr: 34, risks: riskClasses.split(',') }
  assert.throws(() => parseRiskAssessment('```production-risk-assessment\n' + JSON.stringify(json) + '\n```', opts), /not substantive/)
  const real = { ...json, assessed_risks: Object.fromEntries(Object.keys(json.assessed_risks).map(k => [k, 'a concrete written assessment of this class, long enough'])) }
  assert.equal(parseRiskAssessment('```production-risk-assessment\n' + JSON.stringify(real) + '\n```', opts).source_pr, 34)
})
test('production-risk request refuses unverifiable or widened bindings', () => {
  const cases = [
    [{ mainSha: 'abc' }, /exact 40-hex main/],
    [{ pullRequest }, /merged source pull request/],
    [{ risks: '' }, /nonempty subset/],
    [{ risks: 'recovery_unproven' }, /nonempty subset/],
    [{ allowlist: '' }, /exact ordered allowlist/],
    [{ allowlist: '20260920000000,20260920000000' }, /exact ordered allowlist/],
    [{ allowlist: '20260922000000' }, /not a migration of source pull request/],
    [{ comparison: { status: 'behind', behind_by: 1 } }, /not an ancestor/],
    [{ comparison: { status: 'diverged', behind_by: 0 } }, /not an ancestor/],
    [{ mainTree: new Map([[mig, 'f'.repeat(40)], [mig2, '2'.repeat(40)]]) }, /differs between the reviewed head and main/],
    [{ mainTree: new Map([[mig2, '1'.repeat(40)]]) }, /20260920000000 differs/],
    [{ mainTree: null }, /trees are required/],
    [{ source: { ...source, files: [{ filename: 'supabase/migrations/20260920000000_a`b.sql', status: 'added' }] } }, /safely named/],
    [{ source: { ...source, files: [{ filename: mig, status: 'removed' }] } }, /added or modified/],
    [{ source: { ...src2, files: [...src2.files, { filename: 'docs/x.sql', status: 'renamed', previous_filename: 'supabase/migrations/20260920000001_moved.sql' }] } }, /renames or moves/],
  ]
  for (const [patch, pattern] of cases) assert.throws(() => buildProductionRiskRequest({ ...base, ...patch }), pattern)
  assert.throws(() => buildReviewBrief({ ...fixture, riskRequest: null }), /not text/)
})
test('loadReviewBrief reads compare and one tree per ref only when asked, and places the section before the evidence', () => {
  const paths = []
  const tree = { truncated: false, tree: [{ type: 'blob', path: mig, sha: 'f'.repeat(40) }] }
  const gh = (args, t = tree) => {
    paths.push(args[1])
    if (args[1].endsWith('/pulls/34')) return { status: 0, stdout: JSON.stringify(mergedPr) }
    if (args[1].includes('/compare/')) return { status: 0, stdout: JSON.stringify(ahead) }
    if (args[1].includes('/git/trees/')) return { status: 0, stdout: JSON.stringify(t) }
    return github(args)
  }
  const plain = loadReviewBrief(options, source, { github: gh })
  assert.ok(!plain.includes('Production-risk assessment request'))
  assert.ok(!paths.some(p => p.includes('/compare/') || p.includes('/git/trees/')))
  const ask = { ...options, productionRiskMain: riskMain, productionRiskClasses: riskClasses, productionRiskAllowlist: '20260920000000' }
  const asked = loadReviewBrief(ask, source, { github: gh })
  assert.ok(paths.includes(`repos/popcre/shared-db/compare/${source.headSha}...${riskMain}`))
  assert.ok(paths.includes(`repos/popcre/shared-db/git/trees/${riskMain}?recursive=1`))
  assert.ok(!paths.some(p => p.includes('/contents/')))
  assert.ok(asked.indexOf('Production-risk assessment request') < asked.indexOf('## Evidence supplied by the author'))
  assert.throws(() => loadReviewBrief(ask, source, { github: args => gh(args, { truncated: true, tree: [] }) }), /truncated or unreadable/)
  assert.throws(() => loadReviewBrief({ ...options, productionRiskClasses: riskClasses }, source, { github: gh }), /exact 40-hex main/)
})
