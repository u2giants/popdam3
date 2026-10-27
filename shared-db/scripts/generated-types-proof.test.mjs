import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildGeneratedTypesProof,
  fetchCanonicalProjectMetadata,
  GENERATED_TYPES_SCHEMAS,
  generatedTypesSha256,
  GENERATED_TYPES_WORKFLOW_PATH,
  matchesGeneratedTypesWorkflowRun,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_PROJECT_URL,
  selectGeneratedTypesArtifactEntries,
  resolveGeneratedTypesConsumerBinding,
  validateConsumerBinding,
  validateGeneratedTypesOutput,
  validateIssueScope,
  validateMainBinding,
  validateProjectMetadata,
} from './generated-types-proof.mjs'

const issue = (overrides = {}) => ({
  number: 2336,
  state: 'open',
  body: `Work is authorized.\n\n\`\`\`db-work-scope\nstatus: ready\nwork_type: structural\napplication_return_to: popcre/shared-db\ngenerated_types: required\n\`\`\``,
  ...overrides,
})
const sha = 'a'.repeat(40)
const ts = Buffer.from('export type Database = { public: { Tables: {} } }\n')
const project = { id: PRODUCTION_PROJECT_REF, name: 'Shared POP Database', organization_id: 'org-id', region: 'us-east-1', status: 'ACTIVE_HEALTHY' }

test('issue-bound scope accepts open structural work with a valid issue-owned consumer and required generated types', () => {
  assert.deepEqual(validateIssueScope(issue(), 2336), { work_issue: 2336, application_repository: 'popcre/shared-db' })
  for (const [value, pattern] of [
    [issue({ pull_request: { url: 'https://api.github.com/repos/popcre/shared-db/pulls/2336' } }), /pull request/],
    [issue({ number: 2337 }), /expected #2336/],
    [issue({ state: 'closed' }), /not open/],
    [issue({ body: issue().body.replace('work_type: structural', 'work_type: repo-maintenance') }), /work_type: structural/],
    [issue({ body: issue().body.replace('application_return_to: popcre\/shared-db', 'application_return_to: https:\/\/github.com\/popcre\/other') }), /application_return_to/],
    [issue({ body: issue().body.replace('generated_types: required', 'generated_types: not-applicable') }), /generated_types: required/],
    [issue({ body: `${issue().body}\n\n\`\`\`db-work-scope\nstatus: ready\n\`\`\`` }), /exactly one/],
  ]) assert.throws(() => validateIssueScope(value, 2336), pattern)
  assert.throws(() => validateIssueScope(issue(), 4326), /expected #4326/)
  assert.throws(() => validateIssueScope(issue(), '23; echo unsafe'), /positive decimal/)
})

test('main binding requires main ref, checked-out SHA, workflow SHA, and current main to agree exactly', () => {
  assert.equal(validateMainBinding({ issueNumber: 2336, applicationCommitSha: sha, checkoutSha: sha, currentMainSha: sha, gitHubRef: 'refs/heads/main' }), sha)
  for (const changed of [
    { gitHubRef: 'refs/heads/feature' },
    { checkoutSha: 'b'.repeat(40) },
    { currentMainSha: 'b'.repeat(40) },
    { applicationCommitSha: 'abcdef' },
  ]) assert.throws(() => validateMainBinding({ issueNumber: 2336, applicationCommitSha: sha, checkoutSha: sha, currentMainSha: sha, gitHubRef: 'refs/heads/main', ...changed }))
})

test('only the successful main-branch proof producer at the exact application SHA is accepted', () => {
  const run = { conclusion: 'success', event: 'workflow_dispatch', path: GENERATED_TYPES_WORKFLOW_PATH, head_branch: 'main', head_sha: sha }
  const evidence = { application_repository: 'popcre/shared-db', application_commit_sha: sha }
  assert.equal(matchesGeneratedTypesWorkflowRun(run, evidence), true)
  for (const changed of [
    { path: '.github/workflows/other.yml' },
    { head_branch: 'feature' },
    { event: 'push' },
    { conclusion: 'failure' },
    { head_sha: 'b'.repeat(40) },
  ]) assert.equal(matchesGeneratedTypesWorkflowRun({ ...run, ...changed }, evidence), false)
  assert.equal(matchesGeneratedTypesWorkflowRun(run, { ...evidence, application_repository: 'popcre/other' }), false)
})

test('Management API project URL, returned identity, and preview separation are exact', () => {
  const input = { requestUrl: PRODUCTION_PROJECT_URL, metadata: project, previewRef: 'p'.repeat(20) }
  assert.equal(validateProjectMetadata(input).source_project_ref, PRODUCTION_PROJECT_REF)
  assert.throws(() => validateProjectMetadata({ ...input, requestUrl: 'https://api.supabase.com/v1/projects/' + 'x'.repeat(20) }), /URL/)
  assert.throws(() => validateProjectMetadata({ ...input, metadata: { ...project, id: 'x'.repeat(20) } }), /identity/)
  assert.throws(() => validateProjectMetadata({ ...input, previewRef: PRODUCTION_PROJECT_REF }), /different/)
  assert.throws(() => validateProjectMetadata({ ...input, productionRef: 'x'.repeat(20) }), /canonical/)
})

test('project identity request is bounded, authenticated from environment input, and never leaks its token', async () => {
  let captured
  const metadata = await fetchCanonicalProjectMetadata({
    accessToken: 'private-test-token', previewRef: 'p'.repeat(20), timeoutMs: 1234,
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return { ok: true, json: async () => project }
    },
  })
  assert.equal(captured.url, PRODUCTION_PROJECT_URL)
  assert.equal(captured.options.method, 'GET')
  assert.equal(captured.options.headers.Authorization, 'Bearer private-test-token')
  assert.equal(captured.options.redirect, 'error')
  assert.ok(captured.options.signal)
  assert.equal(metadata.source_project_ref, PRODUCTION_PROJECT_REF)
  await assert.rejects(fetchCanonicalProjectMetadata({ accessToken: 'private-test-token', previewRef: PRODUCTION_PROJECT_REF, fetchImpl: async () => ({ ok: true, json: async () => project }) }), /different/)
  await assert.rejects(fetchCanonicalProjectMetadata({ accessToken: 'private-test-token', previewRef: 'p'.repeat(20), timeoutMs: 0, fetchImpl: async () => assert.fail('invalid timeout must not call network') }), /bounded/)
  await assert.rejects(fetchCanonicalProjectMetadata({ accessToken: 'private-test-token', previewRef: 'p'.repeat(20), fetchImpl: async () => { throw new Error('private-test-token') } }), (error) => !error.message.includes('private-test-token'))
})

test('fresh generated bytes must be nonempty, UTF-8, contain Database marker, and use the fixed schema set', () => {
  assert.deepEqual(validateGeneratedTypesOutput(ts, GENERATED_TYPES_SCHEMAS), ts)
  for (const [bytes, schemas, pattern] of [
    [Buffer.alloc(0), GENERATED_TYPES_SCHEMAS, /empty/],
    [Buffer.from('export type Other = {}'), GENERATED_TYPES_SCHEMAS, /Database/],
    [ts, ['public'], /exactly/],
    [ts, ['public', 'dflow', 'plm', 'core', 'dam'], /exactly/],
    [Buffer.from([0xff]), GENERATED_TYPES_SCHEMAS, /UTF-8/],
  ]) assert.throws(() => validateGeneratedTypesOutput(bytes, schemas), pattern)
})

test('artifact proof selection requires both exact entries and refuses extra, renamed, or malformed entries', () => {
  const proof = Buffer.from('{"schema_version":1}')
  const valid = new Map([['database.types.ts', ts], ['db-generated-types-proof.json', proof]])
  assert.deepEqual(selectGeneratedTypesArtifactEntries(valid), { typescriptBytes: ts, proof: { schema_version: 1 } })
  assert.equal(selectGeneratedTypesArtifactEntries(new Map([...valid, ['extra.txt', Buffer.from('x')]])), null)
  assert.equal(selectGeneratedTypesArtifactEntries(new Map([['nested/database.types.ts', ts], ['db-generated-types-proof.json', proof]])), null)
  assert.equal(selectGeneratedTypesArtifactEntries(new Map([['database.types.ts', ts]])), null)
  assert.equal(selectGeneratedTypesArtifactEntries(new Map([['database.types.ts', ts], ['db-generated-types-proof.json', Buffer.from('{')]])), null)
})

test('proof binds issue, exact current main, production target, fixed schemas, and the fresh output bytes', () => {
  const proof = buildGeneratedTypesProof({
    issue: issue(), issueNumber: 2336, applicationCommitSha: sha, checkoutSha: sha, currentMainSha: sha,
    gitHubRef: 'refs/heads/main', generatedTypesBytes: ts, schemas: GENERATED_TYPES_SCHEMAS,
    projectRequestUrl: PRODUCTION_PROJECT_URL, projectMetadata: project, previewProjectRef: 'p'.repeat(20),
    generatedAt: '2026-10-15T14:00:00.000Z',
  })
  assert.deepEqual(proof, {
    schema_version: 1,
    work_issue: 2336,
    application_commit_sha: sha,
    result: 'passed',
    generated_types_sha256: generatedTypesSha256(ts),
    environment: 'production',
    source_project_ref: PRODUCTION_PROJECT_REF,
    source_project_url: PRODUCTION_PROJECT_URL,
    schemas: [...GENERATED_TYPES_SCHEMAS],
    generated_at: '2026-10-15T14:00:00.000Z',
  })
  assert.throws(() => buildGeneratedTypesProof({ issue: issue({ number: 4326 }), issueNumber: 2336, applicationCommitSha: sha, checkoutSha: sha, currentMainSha: sha, gitHubRef: 'refs/heads/main', generatedTypesBytes: ts, schemas: GENERATED_TYPES_SCHEMAS, projectRequestUrl: PRODUCTION_PROJECT_URL, projectMetadata: project, previewProjectRef: 'p'.repeat(20) }), /expected #2336/)
})

test('workflow isolates the unchanged preview generator from the guarded production proof producer', () => {
  const workflow = readFileSync(new URL('../.github/workflows/generate-database-types.yml', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('./generated-types-proof.mjs', import.meta.url), 'utf8')
  assert.match(workflow, /work_issue:[\s\S]*?required:\s*false[\s\S]*?default:\s*["']?["']?\s*\n/)
  assert.match(workflow, /generate:\n[\s\S]*?if:\s*\$\{\{\s*!inputs\.work_issue\s*\}\}/)
  assert.match(workflow, /generate-production-proof:\n[\s\S]*?if:\s*\$\{\{\s*inputs\.work_issue\s*!=\s*''\s*\}\}/)
  const production = workflow.split('  generate-production-proof:\n')[1]
  assert.ok(production, 'production proof job exists')
  assert.match(production, /issues:\s*read/)
  assert.match(production, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN\s*\}\}/)
  assert.match(production, /PRODUCTION_PROJECT_REF: qsllyeztdwjgirsysgai/)
  assert.match(production, /SCHEMAS: public,dflow,plm,core,app/)
  assert.match(production, /validate-issue/)
  assert.match(production, /validate-main/)
  assert.match(production, /validate-project/)
  assert.match(production, /supabase gen types typescript --project-id "\$PRODUCTION_PROJECT_REF" --schema "\$SCHEMAS"/)
  assert.match(production, /\$RUNNER_TEMP\/database\.types\.ts/)
  assert.match(production, /\$RUNNER_TEMP\/db-generated-types-proof\.json/)
  assert.match(production, /shared-db-generated-types-\$\{\{ inputs\.work_issue \}\}-\$\{\{ steps\.consumer\.outputs\.application_commit_sha \}\}/)
  assert.doesNotMatch(production, /SUPABASE_DB_PASSWORD|supabase link|supabase login|supabase db push|types\/database\.types\.ts|--token\s+"?\$SUPABASE_ACCESS_TOKEN/)
  assert.match(helper, /PRODUCTION_PROJECT_REF = 'qsllyeztdwjgirsysgai'/)
  assert.match(helper, /\['public', 'dflow', 'plm', 'core', 'app'\]/)
  assert.match(helper, /redirect:\s*'error'/)
  assert.match(helper, /AbortSignal\.timeout\(timeoutMs\)/)
  assert.match(helper, /application_return_to must name one GitHub owner\/repository/)
  assert.match(production, /APPLICATION_COMMIT_SHA: \$\{\{ inputs\.application_commit_sha \}\}/)
  assert.match(production, /validate-consumer/)
  assert.match(production, /secrets\.SYNC_TOKEN \|\| github\.token/)
  assert.match(helper, /generated_types: 'required'/)
  assert.match(helper, /refs\/heads\/main/)
  assert.match(helper, /export\\s\+type\\s\+Database/)
})

const consumerRepo='u2giants/popdam3', consumerSha='b'.repeat(40)
const consumerIssue=()=>issue({body:issue().body.replace('application_return_to: popcre/shared-db',`application_return_to: ${consumerRepo}`)})
const consumerInput=()=>({applicationRepository:consumerRepo,applicationCommitSha:consumerSha,repositoryMetadata:{full_name:consumerRepo,default_branch:'main'},defaultBranchSha:consumerSha})

test('consumer binding refuses substituted repository, stale/nonfull commits and malformed default branch',()=>{
  assert.equal(validateConsumerBinding(consumerInput()).application_commit_sha,consumerSha)
  for(const changed of [
    {repositoryMetadata:{full_name:'attacker/popdam3',default_branch:'main'}},
    {repositoryMetadata:{full_name:consumerRepo,default_branch:''}},
    {repositoryMetadata:{full_name:consumerRepo,default_branch:'main\nforged'}},
    {applicationCommitSha:'b'.repeat(39)}, {applicationCommitSha:'g'.repeat(40)},
    {defaultBranchSha:'c'.repeat(40)}, {defaultBranchSha:'b'.repeat(39)},
    {applicationRepository:'https://github.com/'+consumerRepo},
  ])assert.throws(()=>validateConsumerBinding({...consumerInput(),...changed}))
})

test('consumer lookup derives repository solely from the live issue and independently reads its actual default branch head',()=>{
  const calls=[],read=args=>{calls.push(args[1]);return args[1]===`repos/${consumerRepo}`?{full_name:consumerRepo,default_branch:'develop'}:{sha:consumerSha}}
  const result=resolveGeneratedTypesConsumerBinding(consumerIssue(),2336,consumerSha,read)
  assert.equal(result.application_default_branch,'develop')
  assert.deepEqual(calls,[`repos/${consumerRepo}`,`repos/${consumerRepo}/commits/develop`])
  assert.throws(()=>resolveGeneratedTypesConsumerBinding(consumerIssue(),2336,'short',()=>assert.fail('must refuse before network')),/40-character/)
  assert.throws(()=>resolveGeneratedTypesConsumerBinding(consumerIssue(),2336,consumerSha,args=>args[1]===`repos/${consumerRepo}`?{full_name:consumerRepo,default_branch:'main'}:{sha:'c'.repeat(40)}),/current default-branch/)
})

function consumerProofInput(){return {issue:consumerIssue(),issueNumber:2336,applicationCommitSha:consumerSha,producerCommitSha:sha,consumerRepositoryMetadata:consumerInput().repositoryMetadata,consumerDefaultBranchSha:consumerSha,checkoutSha:sha,currentMainSha:sha,gitHubRef:'refs/heads/main',generatedTypesBytes:ts,schemas:GENERATED_TYPES_SCHEMAS,projectRequestUrl:PRODUCTION_PROJECT_URL,projectMetadata:project,previewProjectRef:'p'.repeat(20)}}

test('v2 proof separates exact canonical producer from issue-bound consumer, never downgrading target or schemas',()=>{
 const proof=buildGeneratedTypesProof(consumerProofInput())
 assert.equal(proof.schema_version,2);assert.equal(proof.producer_repository,'popcre/shared-db');assert.equal(proof.producer_commit_sha,sha)
 assert.equal(proof.application_repository,consumerRepo);assert.equal(proof.application_commit_sha,consumerSha);assert.equal(proof.application_default_branch,'main')
 for(const changed of [{producerCommitSha:consumerSha},{consumerDefaultBranchSha:sha},{consumerRepositoryMetadata:{full_name:'attacker/popdam3',default_branch:'main'}},{applicationCommitSha:'bad'},{schemas:['public']},{projectMetadata:{id:'x'.repeat(20)}},{currentMainSha:consumerSha}])assert.throws(()=>buildGeneratedTypesProof({...consumerProofInput(),...changed}))
})

test('noncanonical producer run must be the successful canonical workflow main run, independently bound by v2 artifact',()=>{
 const run={conclusion:'success',event:'workflow_dispatch',path:GENERATED_TYPES_WORKFLOW_PATH,head_branch:'main',head_sha:sha,repository:{full_name:'popcre/shared-db'}}
 const evidence={application_repository:consumerRepo,application_commit_sha:consumerSha}
 assert.equal(matchesGeneratedTypesWorkflowRun(run,evidence),true)
 for(const changed of [{repository:{full_name:consumerRepo}},{head_sha:'short'},{head_branch:'feature'},{path:'.github/workflows/deploy-supabase.yml'},{event:'push'},{conclusion:'failure'}])assert.equal(matchesGeneratedTypesWorkflowRun({...run,...changed},evidence),false)
})
