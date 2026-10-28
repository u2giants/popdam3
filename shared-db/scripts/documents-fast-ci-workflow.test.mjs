// Trusted pure-prose fast CI route (issue #3383): workflow integration.
//
// The classifier is only safe if the workflow that runs it is base-trusted and
// fails closed. These tests assert that shape. They fail if the route workflow
// ever checks out or executes the pull request head, if it publishes a status
// that could be mistaken for a merge authorization (issue #3505), or if any
// required engineering suite can be skipped without a proven pure-prose
// inventory.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name) => readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const route = read('documents-fast-ci.yml')
const tools = read('tools-offline-tests.yml')
const promotion = read('coldlion-promotion-contract-tests.yml')
const dbtests = read('database-contract-tests.yml')

test('no workflow references the always-empty dotted merge_group SHA fields', () => {
  // github.event.merge_group carries base_sha and head_sha. The dotted forms
  // (merge_group.base.sha / merge_group.head.sha) do not exist: they evaluate
  // to the empty string, which is how every merge-queue entry silently took
  // the full engineering path for prose-only changes -- and how the route
  // workflow's "trusted base" checkout fell through to the untrusted group
  // head (#4960). Ban the shape outright so it cannot come back by symmetry
  // with pull_request.base.sha.
  for (const [name, text] of [['documents-fast-ci.yml', route], ['tools-offline-tests.yml', tools], ['coldlion-promotion-contract-tests.yml', promotion], ['database-contract-tests.yml', dbtests]]) {
    assert.doesNotMatch(text, /merge_group\.(?:base|head)\.sha\b/, `${name} must use merge_group.base_sha/head_sha, never the dotted always-empty forms`)
  }
})

// ---------------------------------------------------------------------------
// The route workflow itself
// ---------------------------------------------------------------------------

test('the route workflow runs trusted base code and never the pull request head', () => {
  assert.match(route, /pull_request_target:/)
  assert.match(route, /merge_group:/)
  // Bare merge_group: — a types pin is a known dispatch footgun (#2530).
  assert.doesNotMatch(route, /types: \[checks_requested\]/)
  // Base identity is proven BEFORE checkout.
  const proveBase = route.indexOf('name: Prove the protected base identity before checkout')
  const checkout = route.indexOf('name: Check out trusted base code only')
  assert.ok(proveBase >= 0 && proveBase < checkout, 'base identity must be proven before checkout')
  // Checkout is pinned to the protected base, never the head. merge_group
  // names its fields base_sha/head_sha; the dotted forms are always empty and
  // once made this checkout fall through to the untrusted group head (#4960).
  assert.match(route, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha \|\| github\.sha \}\}/)
  assert.doesNotMatch(route, /ref: \$\{\{ github\.event\.pull_request\.head/)
  // The head appears only as a fetch target and a diff argument.
  assert.doesNotMatch(route, /checkout@[\s\S]{0,200}head\.sha/)
})

test('the route workflow never executes anything from the head tree', () => {
  // There is exactly one checkout and it is the base.
  const checkouts = route.match(/uses: actions\/checkout@/g) ?? []
  assert.equal(checkouts.length, 1, 'the route workflow must have exactly one checkout, and it must be the base')
  // The head is fetched as an object, not checked out -- and the fetch is
  // guarded so an unfetchable head takes the full path instead of failing red
  // or silently routing (review L1).
  assert.match(route, /if ! git fetch --no-tags --depth=1 origin "\$HEAD_SHA"/)
  assert.match(route, /git fetch --no-tags --depth=1 origin "\$HEAD_SHA"[\s\S]{0,200}route=full/)
})

test('the route workflow is read-only and cannot weaken branch protection', () => {
  assert.match(route, /permissions:\n  contents: read/)
  assert.doesNotMatch(route, /statuses:\s*write/)
  assert.doesNotMatch(route, /contents:\s*write/)
  assert.doesNotMatch(route, /--admin/)
  assert.doesNotMatch(route, /--authorize-/)
  // It publishes NO commit status at all, so it can neither grant a merge
  // authorization nor collide with the #3505 shared context name.
  assert.doesNotMatch(route, /Documents-only merge authorization/)
  assert.doesNotMatch(route, /Migration guarded merge authorization/)
})

test('the route workflow fails closed when the inventory cannot be proven', () => {
  assert.match(route, /Fail closed: no comparable base\/head pair/)
  // The classification step only writes `route=pure-prose` from the classifier's
  // own success exit; every other path writes `route=full`.
  assert.match(route, /node scripts\/check-documents-ci-route\.mjs "\$BASE_SHA" "\$HEAD_SHA"/)
  const step = route.slice(route.indexOf('id: route'), route.indexOf('name: Publish the routing decision'))
  assert.match(step, /route=full/)
  assert.match(step, /route=pure-prose/)
  // The classifier and its tests are proven before they are trusted.
  assert.match(route, /name: Prove the classifier and its tests before trusting them/)
  assert.match(route, /check-documents-ci-route\.test\.mjs/)
})

test('the route workflow never cancels a merge_group run', () => {
  assert.match(route, /cancel-in-progress: \$\{\{ github\.event_name != 'merge_group' \}\}/)
})

test('the route workflow does not path-filter: a filtered route silently misses the change', () => {
  const onBlock = /^on:\n([\s\S]*?)^\w/m.exec(route)?.[1] ?? ''
  assert.ok(!/^ {4}paths(-ignore)?:/m.test(onBlock), 'the route workflow must not carry a paths filter')
})

// ---------------------------------------------------------------------------
// Engineering-suite skip wiring
// ---------------------------------------------------------------------------

// The exact required-context names from the branch-protection mirror. A rename
// of these strings is a branch-protection change and must fail here (review M2).
const REQUIRED_CONTEXTS = {
  'tools-offline-tests.yml': 'Tools offline tests',
  'coldlion-promotion-contract-tests.yml': 'Promotion contract tests (offline)',
}
const mirror = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/verification/main-required-status-checks.json', import.meta.url)), 'utf8'))

for (const [name, text] of [['tools-offline-tests.yml', tools], ['coldlion-promotion-contract-tests.yml', promotion]]) {
  test(`${name} skips its engineering suite only on a proven pure-prose route`, () => {
    // The skip decision is produced by the trusted classifier, not by a paths
    // filter or a head-authored expression. Pin the actual invocation: a
    // comment mention of the classifier proves nothing (review M2).
    assert.match(text, /node "\$scratch\/scripts\/check-documents-ci-route\.mjs"/, `${name} must invoke the base-extracted route classifier`)
    // Fail closed: an absent classifier or an unreadable inventory takes the
    // full path. The wiring must be able to write a non-pure-prose decision.
    assert.match(text, /pure_prose=false/, `${name} must be able to refuse the fast route`)
    assert.match(text, /pure_prose=true/, `${name} must record a proven fast route`)
    // The classifier is extracted from the protected base tree so a head cannot
    // rewrite its own grader.
    assert.match(text, /git archive "\$BASE_SHA" scripts\/check-documents-ci-route\.mjs/, `${name} must extract the classifier from the protected base`)
    assert.match(text, /scratch=/, `${name} must run the classifier outside the working tree`)
    // Required context name is unchanged: the skip must not rename the job.
    // Pin the exact context string as the name expression's default branch --
    // merely finding `name: ${` would pass a rename of the context itself.
    const context = REQUIRED_CONTEXTS[name]
    assert.ok(context, `no required context pinned for ${name}`)
    assert.ok(
      text.includes(`|| '${context}'`) || new RegExp(`^ {4}name: ${context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(text),
      `${name} must keep its stable required-context job name "${context}"`,
    )
    assert.ok(Array.isArray(mirror.contexts) && mirror.contexts.includes(context), `required-context mirror no longer lists "${context}"`)
    // A skipped suite must leave a visible signal on the check itself (review L3).
    assert.match(text, /::notice::/, `${name} must annotate the check when the suite is skipped`)
  })

  test(`${name} does not gain a paths filter or a weakened required context`, () => {
    const onBlock = /^on:\n([\s\S]*?)^\w/m.exec(text)?.[1] ?? ''
    assert.ok(!/^ {4}paths(-ignore)?:/m.test(onBlock), `${name} must not gain a paths filter`)
    assert.doesNotMatch(text, /continue-on-error:\s*true/, `${name} must not soften a failure into a warning`)
  })
}

test('the route-safety suites are invoked by a required workflow, not only by the optional route workflow', () => {
  // Review H1/M1: the classifier negative tests and these workflow-shape tests
  // must gate the required "Tools offline tests" context. A PR that deletes or
  // weakens them has to fail a required check to merge.
  assert.match(tools, /node --test scripts\/check-documents-ci-route\.test\.mjs scripts\/documents-fast-ci-workflow\.test\.mjs/, 'tools-offline-tests.yml must run both route-safety suites')
  assert.match(tools, /Route-safety test file is absent/, 'tools-offline-tests.yml must refuse to run without the route-safety suites')
  // And the route workflow proves them on the trusted base before classifying.
  assert.match(route, /scripts\/documents-fast-ci-workflow\.test\.mjs/)
  assert.match(route, /scripts\/check-documents-ci-route\.test\.mjs/)
})

// ---------------------------------------------------------------------------
// Queue and post-merge coverage (#4960): the skip must not evaporate the
// moment a proven pure-prose change leaves the pull-request event. A one-file
// handoff note merged 2026-10-28 (#4957) skipped the PR-side suite in 24
// seconds and then paid the FULL ephemeral-database suite twice -- once in the
// merge queue and once on the push to main. These assertions keep every event
// that can run a heavy suite deciding applicability first, and they run inside
// a deliberately unskippable route-safety suite, so removing the coverage
// again must fail a required check.
// ---------------------------------------------------------------------------

test('database-contract-tests.yml decides applicability on every event it runs on', () => {
  const classifyBlock = dbtests.slice(dbtests.indexOf('  classify:'), dbtests.indexOf('  contract-tests:'))
  // The classify job itself must carry no event guard: pull_request, merge_group,
  // push and workflow_dispatch all get a decision.
  assert.doesNotMatch(classifyBlock, /\bif:/, 'the classify job must run on every event; no event guard inside the job')
  // merge_group resolves its one queued PR through the queue contract, exactly
  // as pr-guards.yml does, and asks the same trusted policy.
  assert.match(classifyBlock, /merge-queue-contract\.mjs --resolve-queue-pr/, 'merge_group must resolve its queued pull request before classifying')
  // push has no pull request: it proves its own before..sha range with the
  // trusted inventory classifier from the trusted pushed main tree.
  assert.match(classifyBlock, /check-documents-ci-route\.mjs/, 'push must prove its range with the trusted inventory classifier')
  assert.match(classifyBlock, /github\.event\.before/, 'the push range starts at the previous main tip')
  // And no suite step may bypass the decision by event type: the decision alone
  // gates the steps, and an unreadable decision refuses instead of skipping.
  assert.doesNotMatch(dbtests, /github\.event_name != 'pull_request' \|\|/, 'no step may bypass the applicability decision by event type')
  assert.match(dbtests, /if: needs\.classify\.result != 'success'/, 'an unreadable applicability decision must refuse, on every event')
})

for (const [name, text] of [['tools-offline-tests.yml', tools], ['coldlion-promotion-contract-tests.yml', promotion]]) {
  test(`${name} classifies the merge queue and the push to main, not only pull requests`, () => {
    // The queue fields are base_sha/head_sha (the dotted forms are banned
    // above) and the push range is the previous main tip and the pushed
    // commit, so a proven pure-prose change skips the engineering suites on
    // every event that can run them.
    assert.match(text, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha \|\| github\.event\.before \}\}/, `${name} must wire the queue base and the push previous tip`)
    assert.match(text, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.event\.merge_group\.head_sha \|\| github\.sha \}\}/, `${name} must wire the queue head and the pushed commit`)
  })
}

// ---------------------------------------------------------------------------
// The existing documents-only lane must not be weakened
// ---------------------------------------------------------------------------

test('the documents-only merge authorization lane is untouched and still exclusive', () => {
  const documents = read('documents-only-merge-authorization.yml')
  assert.match(documents, /pull_request_target:/)
  assert.match(documents, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/)
  assert.doesNotMatch(documents, /ref: \$\{\{ github\.event\.pull_request\.head/)
  assert.match(documents, /--authorize-repository-maintenance-status/)
  // The strict documents-only rules are still what the lane proves.
  const classifier = readFileSync(fileURLToPath(new URL('../scripts/lib/documents-only-change.mjs', import.meta.url)), 'utf8')
  assert.match(classifier, /RULEBOOK_BASENAMES = new Set\(\['agents\.md', 'claude\.md'\]\)/)
  assert.match(classifier, /DOCUMENT_EXTENSIONS = new Set\(\['\.md', '\.markdown', '\.txt', '\.rst'\]\)/)
  // The pure-prose route is STRICTER than the documents-only lane: it uses the
  // same non-rulebook prose definition plus a mode check, so it can never grant
  // something the documents-only lane refuses.
  assert.match(classifier, /PROSE_FILE_MODE = '100644'/)
  assert.match(classifier, /export function classifyProseGitInventory/)
})
