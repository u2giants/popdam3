// Lane route sync tests (issue #3199 Phase B2/B3).
//
// The self-service additive lane is safe only while three artifacts agree:
//   1. the route machinery admits `self-service-additive` (QUEUE_ROUTES,
//      ROUTES_BY_WORK_TYPE.structural, STRUCTURAL_ROUTES in admission.mjs),
//   2. the guarded merge workflow invokes the boundary classifier for it,
//   3. AGENTS.md documents the same route and the same {crm,pim,dam} boundary.
// The ordering rule (governed slot-1 review of PR #3204, finding 3) is that
// admission and merge-time enforcement land together — this test makes that
// rule PERMANENT: a main that admits the route without enforcing the boundary
// fails here, whatever pull request introduced the drift.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { QUEUE_ROUTES, ROUTES_BY_WORK_TYPE } from './manage-migration-author-lanes.mjs'
import { STRUCTURAL_ROUTES } from './orchestrator-flow/admission.mjs'
import { BOUNDARY_SCHEMAS, SELF_SERVICE_ROUTE } from './check-self-service-additive-lane.mjs'

const ROUTE = SELF_SERVICE_ROUTE
const laneScript = readFileSync(new URL('./manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
const admissionScript = readFileSync(new URL('./orchestrator-flow/admission.mjs', import.meta.url), 'utf8')
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
const guardedMerge = readFileSync(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url), 'utf8')

test('the route machinery, admission and workflow agree on the route name', () => {
  assert.ok(QUEUE_ROUTES.has(ROUTE), 'QUEUE_ROUTES admits the route')
  assert.ok(ROUTES_BY_WORK_TYPE.structural.has(ROUTE), 'ROUTES_BY_WORK_TYPE.structural admits the route')
  assert.deepEqual([...STRUCTURAL_ROUTES].sort(), [...ROUTES_BY_WORK_TYPE.structural].sort(), 'admission.mjs and the lane script carry the SAME structural route set')
  assert.ok(admissionScript.includes('self-service-additive'), 'admission names the route in prose')
})

test('ORDERING RULE: admitting the route and enforcing the boundary cannot drift apart', () => {
  // The single most important assertion in this file (plan §9 B2/B3). A tree
  // that admits `self-service-additive` for claims MUST also invoke the
  // boundary classifier inside the guarded merge, pre-lock. Either both exist
  // or neither does.
  const enforced = guardedMerge.includes('check-self-service-additive-lane.mjs')
  const admitted = QUEUE_ROUTES.has(ROUTE) && ROUTES_BY_WORK_TYPE.structural.has(ROUTE)
  assert.ok(admitted === enforced || (!admitted && !enforced),
    admitted && !enforced
      ? 'self-service-additive is admitted for claims but the guarded merge never invokes the boundary classifier — PR #3204 finding 3 exactly; add the pre-lock step or remove the route'
      : 'the boundary classifier runs although the route is not admitted — dead enforcement is also drift')
})

test('AGENTS.md documents the same route and the same boundary', () => {
  assert.match(agents, /route: self-service-additive/, '§0.0-C names the route')
  assert.match(agents, /\{crm, pim, dam\}/, 'the documented boundary is {crm, pim, dam}')
  assert.match(agents, /check-self-service-additive-lane\.mjs/, 'the classifier is named where the route is described')
  assert.match(agents, /self-service-additive` for additive/, 'the §4 operative summary carries the route')
  // The boundary schemas in code and prose must be the same three schemas.
  assert.deepEqual([...BOUNDARY_SCHEMAS], ['crm', 'pim', 'dam'])
})

test('the lane machinery still keeps non-structural exits untouched', () => {
  // Shape work stays structural: the route is a ROUTE, never a work type, and
  // the non-structural exit table keeps guarding every non-structural type.
  assert.ok(!laneScript.includes("'self-service-additive': '"), 'the route never appears as a NON_STRUCTURAL_EXITS key')
})
