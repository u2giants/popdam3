// NO FILE MAY BE BOTH TRACKED AND IGNORED (#1304).
//
// The repository once said, in `.gitignore` line 48, that a delegate-model review
// "is session scratch and must never be committable" -- while 25 reviews sat
// committed in that very directory. Two more files under
// `docs/verification/item-mg-reclassification-20260814/` were in the same state.
//
// That contradiction is not cosmetic. A session that reads the rule and acts on it
// deletes real evidence: one did exactly that, ran `rm -rf .ai`, and removed all 25
// tracked reviews. They came back only because `git status` happened to be read
// afterwards. Those files are cited BY PATH from a migration header and from four
// permanent documents, so the loss would have been about a dozen dead references in
// records that can never be edited.
//
// The fix was to name the tracked exceptions in `.gitignore` instead of leaving the
// rule and the reality disagreeing. THIS TEST IS WHAT KEEPS THEM IN AGREEMENT. A
// tracked file that becomes ignored -- by a new pattern, a moved file, or a tidy-up
// of these lists -- fails here loudly, on every pull request, instead of waiting to
// be discovered by whoever deletes it.
//
// If this test fails, do NOT "fix" it by untracking the file. Decide which is true:
// the file is evidence (add a named `!` exception and say why) or it is scratch
// (remove it from Git deliberately, in its own commit, having checked what cites it).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const git = (args, input) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })

// `git check-ignore` skips tracked files unless --no-index is given, which is
// precisely why this contradiction could sit in the repository unnoticed.
function trackedButIgnored() {
  const tracked = git(['ls-files']).split(/\r?\n/).filter(Boolean)
  assert.ok(tracked.length > 0, 'git ls-files returned nothing; the checkout is wrong')
  try {
    return git(['check-ignore', '--no-index', '--stdin'], tracked.join('\n')).split(/\r?\n/).filter(Boolean)
  } catch (error) {
    // Exit status 1 means "nothing matched", which is the state we want.
    if (error.status === 1) return []
    throw error
  }
}

test('no tracked file is also ignored', () => {
  const offenders = trackedButIgnored()
  assert.deepEqual(
    offenders,
    [],
    `these files are tracked AND ignored, so the repository states two contradictory things about them:\n` +
      offenders.map((f) => `  ${f}`).join('\n') +
      `\nDecide which is true. If the file is durable evidence, add a named '!' exception in the ` +
      `governing .gitignore with a line saying what cites it. If it is scratch, remove it from Git ` +
      `deliberately after checking what references it. Do not leave it in both states.`,
  )
})

test('the 25 cited review files are still tracked and no longer ignored', () => {
  const reviews = git(['ls-files', '.ai/reviews/']).split(/\r?\n/).filter(Boolean)
  assert.equal(reviews.length, 25, 'the cited review set changed size; that is a deliberate decision, not a drift')
  // The exception must be exact. A blanket un-ignore of the directory would let a
  // brand-new scratch review be committed by accident, which is the failure the
  // original rule was written to prevent.
  const fresh = '.ai/reviews/zzz-brand-new-scratch-review.md'
  let ignored = true
  try {
    git(['check-ignore', '--no-index', '-q', fresh])
  } catch (error) {
    if (error.status === 1) ignored = false
    else throw error
  }
  assert.ok(ignored, `${fresh} must still be ignored: a NEW review is scratch, only the named ones are evidence`)
})

test('the reviewer wrappers can still write, because the directory stays ignored for new files', () => {
  // ai-muse and its siblings refuse to write a report unless `git check-ignore -q`
  // passes for a probe path under .ai/reviews. Keeping that working is a hard
  // constraint on how the exception is written.
  let ignored = true
  try {
    git(['check-ignore', '-q', '.ai/reviews/ai-muse-probe'])
  } catch (error) {
    if (error.status === 1) ignored = false
    else throw error
  }
  assert.ok(ignored, 'the wrappers probe .ai/reviews/ai-muse-probe with git check-ignore and refuse to write if it is not ignored')
})
