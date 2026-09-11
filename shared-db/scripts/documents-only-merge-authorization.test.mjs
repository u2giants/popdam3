import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/documents-only-merge-authorization.yml', import.meta.url)), 'utf8')

test('documents-only authorization executes trusted base code with narrow permissions', () => {
  assert.match(workflow, /pull_request_target:/)
  assert.match(workflow, /branches: \[main\]/)
  const proveBase=workflow.indexOf('name: Prove the protected base identity before checkout')
  const checkout=workflow.indexOf('name: Check out trusted base code only')
  assert.ok(proveBase>=0&&proveBase<checkout)
  assert.match(workflow.slice(proveBase,checkout), /BASE_REF[\s\S]+BASE_REPO[\s\S]+test "\$BASE_REF" = main[\s\S]+test "\$BASE_REPO" = "\$GITHUB_REPOSITORY"/)
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/)
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /pull-requests: read/)
  assert.match(workflow, /statuses: write/)
  assert.doesNotMatch(workflow, /issues: write|actions: write|workflows: write/)
})

test('only a twice-proven prose head can receive success under the repository-maintenance mutex', () => {
  const classify = workflow.indexOf('name: Classify the complete pull request file list')
  const authorize = workflow.indexOf('name: Re-prove and authorize under the repository-maintenance mutex')
  assert.ok(classify >= 0 && classify < authorize)
  assert.equal(workflow.match(/check-documents-only-merge-authorization\.mjs/g)?.length, 1)
  assert.match(workflow.slice(authorize), /--authorize-repository-maintenance-status/)
  assert.doesNotMatch(workflow, /--acquire-(?:preview|merge|production)/)
})

test('ordinary mixed/code pull requests cannot poison the required context', () => {
  const classify = workflow.indexOf('name: Classify the complete pull request file list')
  const authorize = workflow.indexOf('name: Re-prove and authorize under the repository-maintenance mutex')
  const classificationStep = workflow.slice(classify, authorize)
  assert.doesNotMatch(classificationStep, /statuses\//)
  assert.doesNotMatch(classificationStep, /--authorize-repository-maintenance-status/)
  assert.doesNotMatch(workflow.slice(authorize), /if: steps\.classify\.outputs\.documents_only/)
  assert.match(workflow, /--revoke-required-status/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /ready_for_review, edited/)
})
