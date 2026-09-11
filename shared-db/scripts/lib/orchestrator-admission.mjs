/**
 * ADMISSION: what makes a session allowed to hold the shared-db orchestrator.
 *
 * Issue #2318. Companion to `orchestrator-routing.mjs`, which answers "where do
 * I send work". This module answers the earlier question that had no enforced
 * answer at all: "was this session ever allowed to be the orchestrator?"
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-04 a DesignFlow application session hit a shared-db constraint
 * defect, opened orchestrator marker #2312, and ran a structural repair. Albert
 * had never authorized it. The session did not lie to itself about any fact --
 * it reasoned that delegated task traffic plus a genuine structural need added
 * up to authority. They do not. The finding recorded in
 * `HANDOFF.d/2026-09-04T2010Z-edge-dev-codex-unauthorized-orchestrator-handover.md`
 * section 5 is exact: "Structural work need does not confer orchestrator
 * authority. The marker itself was evidence of an unauthorized assumption, not
 * evidence that authority existed."
 *
 * The marker guard could not have caught it. `check-orchestrator-marker.mjs`
 * counts open markers and validates the routing block; #2312 was the ONLY open
 * marker and its routing block was well-formed, so every check passed. Nothing
 * anywhere asked on what grounds the role had been taken.
 *
 * WHAT THIS CAN AND CANNOT DO
 * ---------------------------
 * This cannot PREVENT a session opening a marker issue. Markers are claimed
 * outside any pull request, exactly as `check-orchestrator-marker.mjs` states
 * for collisions. What it does is make the grounds a REQUIRED, TYPED,
 * PUBLISHED field, so that:
 *
 *   1. a session must write down its grounds before the marker validates;
 *   2. the specific inferences that produced #2312 are named and REFUSED by
 *      the parser, with the refusal quoting why;
 *   3. an unrecognised ground fails closed rather than passing as free text;
 *   4. any later reader can audit the claim instead of reconstructing it.
 *
 * It cannot prove Albert said the words. No repository check can. It converts a
 * silent assumption into a written, refutable assertion -- and it makes the
 * inferences that actually happened impossible to write down as valid.
 *
 * THE SAFE DEFAULT IS PATH A
 * --------------------------
 * Absent an admissible ground, the answer is NOT-AUTHORIZED, which means the
 * session proceeds as an ordinary non-orchestrator session (Path A) and queues
 * structural work. Absent is never "probably fine", and an unreadable answer is
 * never "authorized". Every ambiguity here resolves away from the role.
 */

/** The field carrying the grounds, inside the existing `orchestrator-routing` block. */
export const AUTHORIZATION_FIELD = 'authorization'

/**
 * The date the authorization field became required.
 *
 * Markers opened BEFORE this date are grandfathered by the same rule the
 * routing contract uses (`CONTRACT_EFFECTIVE_DATE` in
 * `check-orchestrator-marker.mjs`): a live orchestrator must not be failed for
 * a field that did not exist when it started. Grandfathering is reported as a
 * warning, never silently. The test is the marker's own opening date, so any
 * marker opened before the cutoff -- including one opened today -- takes this
 * branch; after the cutoff no marker is grandfathered at all.
 */
export const AUTHORIZATION_EFFECTIVE_DATE = '2026-09-10'

/**
 * The ONLY two admissible grounds.
 *
 * Deliberately short. Every additional form is another thing a session can talk
 * itself into, and the incident was caused by exactly that kind of reasoning.
 *
 * - `owner-current-chat <ISO-8601 instant>` -- Albert authorized THIS session to
 *   hold the orchestrator, in the conversation this session is running in, at
 *   that instant. Not a past chat, not another session's chat, not a standing
 *   document.
 * - `owner-authorized-handover #<issue>` -- direct succession from the named
 *   predecessor marker. The predecessor must be the SAME issue this marker
 *   already declares as `handover_issue:`, so a session cannot cite a handover
 *   it is not actually continuing.
 */
export const ADMISSIBLE_FORMS = Object.freeze({
  'owner-current-chat': /^owner-current-chat\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/,
  'owner-authorized-handover': /^owner-authorized-handover\s+#?(\d+)$/,
})

/**
 * Grounds that are REFUSED BY NAME, each with the reason.
 *
 * These are not a blacklist protecting against malice. They are the reasoning
 * steps a well-intentioned session actually took on 2026-09-04, plus the
 * nearest neighbours of each. Naming them means the refusal explains itself
 * instead of saying "invalid value", which is what a session in that position
 * would have read as a formatting problem and worked around.
 */
export const REFUSED_GROUNDS = Object.freeze({
  'db-work':
    'a `db-work` label routes work to an orchestrator; it never creates one. The label says the work needs the role, not that you hold it.',
  'db-work-label':
    'a `db-work` label routes work to an orchestrator; it never creates one. The label says the work needs the role, not that you hold it.',
  delegation:
    'being delegated to is not being authorized. A delegating session cannot grant a role it does not own.',
  'delegated-task':
    'being delegated to is not being authorized. A delegating session cannot grant a role it does not own.',
  'task-traffic':
    'receiving task traffic is not authorization. This is the exact inference that produced unauthorized marker #2312.',
  'cross-task-delegation':
    'receiving task traffic is not authorization. This is the exact inference that produced unauthorized marker #2312.',
  'structural-need':
    'needing a structural change is the reason to QUEUE work for an orchestrator, not grounds to become one. See the #2318 briefing section 5.',
  'migration-needed':
    'needing a structural change is the reason to QUEUE work for an orchestrator, not grounds to become one. See the #2318 briefing section 5.',
  'blocked-on-schema':
    'needing a structural change is the reason to QUEUE work for an orchestrator, not grounds to become one. See the #2318 briefing section 5.',
  handoff:
    'a handoff document records what a predecessor did; it cannot confer a role. If a handover really was owner-ordered, cite it as `owner-authorized-handover #<marker issue>`.',
  'handoff-document':
    'a handoff document records what a predecessor did; it cannot confer a role. If a handover really was owner-ordered, cite it as `owner-authorized-handover #<marker issue>`.',
  'predecessor-handoff':
    'a handoff document records what a predecessor did; it cannot confer a role. If a handover really was owner-ordered, cite it as `owner-authorized-handover #<marker issue>`.',
  'repository-location':
    'working in `u2giants/shared-db` is not authorization. Most sessions in this repository are non-orchestrator sessions.',
  'marker-exists':
    'an open marker proves someone else holds the role. It is the strongest possible reason NOT to take it.',
  'no-marker-open':
    'no open marker means nobody is running, which means QUEUE the work. `check-orchestrator-marker.mjs` says so in its own exit codes: NONE "is not a licence to dispatch".',
  self: 'a session cannot authorize itself. That is what an unauthorized claim IS.',
  'self-authorized': 'a session cannot authorize itself. That is what an unauthorized claim IS.',
  inferred: 'authority is granted, never inferred. If you are inferring it, you do not have it.',
  assumed: 'authority is granted, never inferred. If you are inferring it, you do not have it.',
  implied: 'authority is granted, never inferred. If you are inferring it, you do not have it.',
  none: 'no grounds means no role. Proceed as a non-orchestrator session and queue the work.',
})

/**
 * Judge one `authorization:` value.
 *
 * @param {string|undefined} value raw field text
 * @param {{handoverIssue?: number|null}} context the marker's own `handover_issue`
 * @returns {{admissible: boolean, form: string|null, problems: string[]}}
 */
export function validateAuthorizationValue(value, { handoverIssue = null } = {}) {
  const raw = String(value ?? '').trim()
  const problems = []

  if (raw === '') {
    problems.push(
      '`authorization:` is missing or blank. Blank is never a default: it reads as answered and ' +
        'grants nothing. State `owner-current-chat <ISO-8601 instant>` or ' +
        '`owner-authorized-handover #<marker issue>`, or do not open a marker.',
    )
    return { admissible: false, form: null, problems }
  }

  const refusalKey = raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[.:;,]+$/, '')
  const refusal = REFUSED_GROUNDS[refusalKey]
  if (refusal) {
    problems.push(
      `\`authorization: ${raw}\` is REFUSED -- ${refusal} The safe default is Path A: run as a ` +
        'non-orchestrator session and queue the structural work.',
    )
    return { admissible: false, form: null, problems }
  }

  const chat = ADMISSIBLE_FORMS['owner-current-chat'].exec(raw)
  if (chat) {
    if (Number.isNaN(Date.parse(chat[1]))) {
      problems.push(`\`authorization: ${raw}\` -- \`${chat[1]}\` is not a real instant.`)
      return { admissible: false, form: null, problems }
    }
    return { admissible: true, form: 'owner-current-chat', problems }
  }

  const handover = ADMISSIBLE_FORMS['owner-authorized-handover'].exec(raw)
  if (handover) {
    const cited = Number(handover[1])
    if (handoverIssue === null || handoverIssue === undefined) {
      problems.push(
        `\`authorization: ${raw}\` cites a handover, but this marker's \`handover_issue:\` is not ` +
          'a marker number. A handover you are not continuing is not a handover.',
      )
      return { admissible: false, form: null, problems }
    }
    if (cited !== Number(handoverIssue)) {
      problems.push(
        `\`authorization: ${raw}\` cites marker #${cited}, but \`handover_issue: ${handoverIssue}\` ` +
          'names a different one. Cite the predecessor you are actually continuing.',
      )
      return { admissible: false, form: null, problems }
    }
    return { admissible: true, form: 'owner-authorized-handover', problems }
  }

  // Fail closed. An unrecognised ground is refused, never accepted as free text:
  // free text is how "the task needed it" would have passed.
  problems.push(
    `\`authorization: ${raw}\` is not a recognised ground, so it is REFUSED. Only ` +
      '`owner-current-chat <ISO-8601 instant>` and `owner-authorized-handover #<marker issue>` ' +
      'admit a session to the orchestrator role. Anything else -- a label, a delegation, a ' +
      'handoff, a structural need, or your own judgement -- is Path A: stay a non-orchestrator ' +
      'session and queue the work.',
  )
  return { admissible: false, form: null, problems }
}

/**
 * Judge a whole parsed routing block.
 *
 * @param {Record<string,string>|null} fields from `parseRoutingBlock`
 * @param {{createdAt?: string|null, effectiveDate?: string}} options
 * @returns {{required: boolean, admissible: boolean, form: string|null, problems: string[], warnings: string[]}}
 */
export function validateAdmission(
  fields,
  { createdAt = null, effectiveDate = AUTHORIZATION_EFFECTIVE_DATE } = {},
) {
  // No block at all is already INVALID for routing reasons. Say nothing extra
  // rather than pile a second failure onto the same cause.
  if (fields === null || typeof fields !== 'object') {
    return { required: true, admissible: false, form: null, problems: [], warnings: [] }
  }

  const opened =
    typeof createdAt === 'string' && createdAt.length >= 10 ? createdAt.slice(0, 10) : null
  const grandfathered = opened !== null && opened < effectiveDate
  const handoverRaw = String(fields.handover_issue ?? '').replace(/^#/, '')
  const handoverIssue = /^\d+$/.test(handoverRaw) ? Number(handoverRaw) : null

  const declared = fields[AUTHORIZATION_FIELD]
  if (grandfathered && (declared === undefined || String(declared).trim() === '')) {
    return {
      required: false,
      admissible: false,
      form: null,
      problems: [],
      warnings: [
        `this marker opened ${opened}, before orchestrator admission took effect on ` +
          `${effectiveDate}, so a missing \`${AUTHORIZATION_FIELD}:\` does not fail the guard. It ` +
          'also means the grounds on which this session holds the role were never recorded and ' +
          'cannot be audited. Add the field, or close the marker.',
      ],
    }
  }

  const { admissible, form, problems } = validateAuthorizationValue(declared, { handoverIssue })
  return { required: true, admissible, form, problems, warnings: [] }
}
