import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'
import { githubIo, parseQueueScope } from './manage-migration-author-lanes.mjs'
import { currentRepository, TRUSTED_OPERATOR_LOGIN } from './lib/repository-identity.mjs'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { publishStageEvent, validateStageEvent } from './lib/work-stage-evidence.mjs'

const COMMENT_STAGES = ['database-applied', 'live-verified', 'application-accepted']
export function parseArguments(argv) {
  const result = { publish: false }
  const fields = { '--issue': 'issue', '--pr': 'pr', '--stage': 'stage', '--evidence-comment-id': 'commentId' }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--publish' && !result.publish) { result.publish = true; continue }
    const key = fields[flag]
    if (!key || Object.hasOwn(result, key)) throw new Error(`unknown or duplicate argument: ${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`)
    result[key] = key === 'stage' ? value : (/^[1-9][0-9]*$/.test(value) ? Number(value) : NaN)
  }
  for (const key of ['issue', 'pr', 'commentId']) if (!Number.isSafeInteger(result[key]) || result[key] <= 0) throw new Error(`${key} must be a positive safe integer`)
  if (!COMMENT_STAGES.includes(result.stage)) throw new Error('stage must name a comment-backed intermediate stage')
  return result
}

class VerifiedNotPublished extends Error {
  constructor(event, durable) { super('verified but not published'); this.event = validateStageEvent(event); this.durable = durable }
}

/** The native publisher performs every proof check. Report mode stops at its first write. */
export function runStagePublication(options, { io = { ...githubIo, parseScope: parseQueueScope }, repository = currentRepository(), operator = () => runGitHubCommand(['api', 'user', '--jq', '.login']).trim(), env = process.env, machine = hostname() } = {}) {
  // Revalidate programmatic inputs through the same strict public interface.
  const parsed = parseArguments(['--issue', String(options.issue), '--pr', String(options.pr), '--stage', options.stage, '--evidence-comment-id', String(options.commentId), ...(options.publish === true ? ['--publish'] : [])])
  if (operator() !== TRUSTED_OPERATOR_LOGIN) throw new Error('authenticated actor is not the trusted repository operator')
  const session = env.CODEX_THREAD_ID
  if (typeof session !== 'string' || !/^\S+$/.test(session) || !/^\S+$/.test(machine)) throw new Error('actual posting chat and machine identity are required')
  const input = { issue: parsed.issue, pr: parsed.pr, stage: parsed.stage, repository, evidenceRef: `https://github.com/${repository}/issues/${parsed.issue}#issuecomment-${parsed.commentId}`, signature: `Posted by Codex chat ${session} on ${machine}` }
  if (parsed.publish) return { mode: 'publish', ...publishStageEvent(input, io), durable_event_exists: true, comment_published: true }
  const readOnlyIo = {
    ...io,
    makeOwnerCommit(message) {
      const prefix = 'db-work-stage '
      if (!message.startsWith(prefix)) throw new Error('unexpected native write intent')
      throw new VerifiedNotPublished(JSON.parse(message.slice(prefix.length)), false)
    },
    commentIssue(issue, body) {
      const match = /^```db-work-stage\n([\s\S]*?)\n```/.exec(body)
      if (issue !== parsed.issue || !match) throw new Error('unexpected native comment intent')
      throw new VerifiedNotPublished(JSON.parse(match[1]), true)
    },
    createRef() { throw new Error('report-only mode forbids reference writes') },
  }
  try {
    const result = publishStageEvent(input, readOnlyIo)
    return { mode: 'report-only', verified: true, event: result.event, durable_event_exists: true, comment_already_exists: true, comment_published: false }
  } catch (error) {
    if (!(error instanceof VerifiedNotPublished)) throw error
    return { mode: 'report-only', verified: true, event: error.event, durable_event_exists: error.durable, comment_already_exists: false, comment_published: false }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runStagePublication(parseArguments(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(`REFUSED: ${error.message}`); process.exitCode = 1 }
}
