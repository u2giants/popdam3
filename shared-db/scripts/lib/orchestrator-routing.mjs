/**
 * The orchestrator ROUTING CONTRACT: how a session learns where to send work.
 *
 * Issue #1605. Extends `plan_orchestrator-workflow-gaps.md` B1 (the marker
 * guard) and §C.
 *
 * WHY THIS EXISTS
 * ---------------
 * The open `orchestrator-marker` issue proves an orchestrator EXISTS. Until
 * this module it did not say WHERE TO REACH ONE. Marker #1602 recorded the
 * machine, a session slug, the predecessor marker and a startup proof — and
 * nothing another session could actually send a message to.
 *
 * So a session needing a structural change did what the marker left it no
 * alternative to: it resolved the destination from conversation history and an
 * old handoff, and delegated to an orchestrator session that had ALREADY
 * CLOSED. The request went nowhere and nobody was told.
 *
 * ⚠️ §C OF THE GAPS PLAN SAID "there is no mechanism that reaches a running
 * session, and this plan should not pretend to invent one." That was true when
 * written and this module does NOT contradict it. Two mechanisms have since
 * appeared — Claude cross-session messaging, and Codex `codex-reply` by thread
 * id — and BOTH need an address the marker never published. This publishes the
 * address. It does not invent the channel, and it does not promise delivery.
 *
 * THE FAIL-CLOSED RULE
 * --------------------
 * Every ambiguity here resolves toward "do not dispatch". A marker with no
 * routing block, a placeholder id, an unparseable start time, or a successor
 * that copied its predecessor's id is INVALID — and an invalid marker is not
 * downgraded to "no orchestrator". Those are different answers with opposite
 * consequences:
 *
 *   INVALID -> an orchestrator may well be live and you cannot reach it. Stop.
 *   NONE    -> nobody is running. QUEUE the work. Still do not dispatch.
 *
 * Neither is permission to start dispatching, and neither may be silently
 * turned into the other. That collapse is the exact defect B1 was built for.
 */

/**
 * The fixed session identifier for the sole shared-db orchestrator.
 * Owner instruction, Albert Hazan, 2026-08-26.
 *
 * It is a CONSTANT, not a naming suggestion. A session display name must begin
 * with it so a human, and any tool that can only see session titles, can pick
 * the orchestrator out of a session list. It is a discovery HINT only — the
 * open marker remains the sole authority. Titles are neither unique nor
 * enforced by anything, so never route on a name alone.
 */
export const ORCHESTRATOR_IDENTIFIER = 'shared-db.orch'

/** The fenced block that carries the contract, matching this repo's `db-claim` / `db-work-scope` convention. */
export const ROUTING_BLOCK = 'orchestrator-routing'

/** Engines that can hold the orchestrator, and the shape each one's routable id takes. */
export const ENGINES = {
  codex: {
    /**
     * Codex writes a rollout file per session stamped with `session_id`, a
     * UUID. That id is what `codex-reply` takes as `threadId`, and it is the
     * only durable handle Codex exposes.
     */
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    idDescription: 'a Codex thread UUID from the session rollout `session_id` (the `threadId` `codex-reply` takes)',
  },
  claude: {
    /**
     * A Claude session id as reported by its own session metadata, e.g.
     * `local_<uuid>`. The `local_`/`remote_` prefix is part of the id.
     */
    idPattern: /^(local|remote)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    idDescription: 'a Claude `sessionId` such as `local_<uuid>`, as reported by the session itself',
  },
}

/**
 * Values that LOOK like an id and route nowhere. A marker carrying one of these
 * is worse than a marker carrying nothing: it reads as answered.
 *
 * Kept deliberately short. This is a placeholder screen, not a spellchecker —
 * the per-engine `idPattern` is what actually establishes the shape.
 */
export const PLACEHOLDER_IDS = new Set([
  'tbd',
  'todo',
  'none',
  'null',
  'unknown',
  'n/a',
  'na',
  'pending',
  'xxx',
  'session-id',
  'thread-id',
  'route-id',
])

/** Fields every marker must carry. Absent or blank is a failure, never a default. */
export const REQUIRED_FIELDS = [
  'status',
  'identifier',
  'engine',
  'session_name',
  'route_id',
  'owner',
  'machine',
  'started',
  'handover_issue',
  'briefing',
]

/**
 * Parse the routing block out of a marker issue body.
 *
 * Returns `null` when there is NO block — which the caller must treat as
 * INVALID, never as "declares no routing". Same rule as `parseClaimBlock` in
 * `check-dispatch-collision.mjs`: an unparseable claim must never read as
 * harmless.
 *
 * @returns {Record<string,string>|null}
 */
export function parseRoutingBlock(body) {
  if (typeof body !== 'string') return null
  const fence = new RegExp('```' + ROUTING_BLOCK + '\\s*\\n([\\s\\S]*?)```').exec(body)
  if (!fence) return null

  const fields = {}
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([a-z_]+):\s*(.*)$/i.exec(line)
    if (!match) continue
    fields[match[1].toLowerCase()] = match[2].trim()
  }
  return fields
}

/** ISO-8601 instant, e.g. `2026-08-26T14:39:25Z`. A start time that cannot be ordered cannot resolve a race. */
function isIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * Validate a parsed routing block.
 *
 * `predecessorRouteId` — when the marker names an originating handover issue and
 * that issue's own routing id is known, pass it. A successor that reuses it is
 * REJECTED: inheriting the predecessor's id is precisely how a closed session
 * kept receiving delegations. A successor must record its OWN new id.
 *
 * @returns {{valid: boolean, problems: string[], routing: object|null}}
 */
export function validateRouting(fields, { predecessorRouteId = null } = {}) {
  const problems = []

  if (fields === null || typeof fields !== 'object') {
    return {
      valid: false,
      routing: null,
      problems: [
        `the marker has no \`${ROUTING_BLOCK}\` block, so it names no delegation target. ` +
          `A marker without one proves only that an orchestrator EXISTS. It is INVALID, ` +
          `not "no orchestrator" — one may be live and unreachable.`,
      ],
    }
  }

  for (const field of REQUIRED_FIELDS) {
    const value = fields[field]
    if (value === undefined) problems.push(`\`${field}:\` is missing from the \`${ROUTING_BLOCK}\` block.`)
    else if (value === '') problems.push(`\`${field}:\` is blank. Blank is never a default — state a value or \`none\`.`)
  }

  const status = (fields.status ?? '').toLowerCase()
  if (fields.status !== undefined && fields.status !== '' && status !== 'active') {
    problems.push(
      `\`status: ${fields.status}\` — an OPEN marker must be \`active\`. An orchestrator that ` +
        `is no longer active closes its marker; it does not leave one open in another state, ` +
        `because an open marker is what stops a successor starting.`,
    )
  }

  if (fields.identifier !== undefined && fields.identifier !== ORCHESTRATOR_IDENTIFIER) {
    problems.push(
      `\`identifier: ${fields.identifier}\` — must be exactly \`${ORCHESTRATOR_IDENTIFIER}\`. ` +
        `It is a fixed constant (owner instruction 2026-08-26), not a free-text label.`,
    )
  }

  const engine = (fields.engine ?? '').toLowerCase()
  const spec = ENGINES[engine]
  if (fields.engine !== undefined && fields.engine !== '' && !spec) {
    problems.push(`\`engine: ${fields.engine}\` — must be one of: ${Object.keys(ENGINES).join(', ')}.`)
  }

  const routeId = fields.route_id ?? ''
  if (routeId) {
    if (PLACEHOLDER_IDS.has(routeId.toLowerCase())) {
      problems.push(
        `\`route_id: ${routeId}\` is a placeholder, not a routable id. A placeholder is worse ` +
          `than an empty field: it reads as answered and routes nowhere.`,
      )
    } else if (spec && !spec.idPattern.test(routeId)) {
      problems.push(`\`route_id: ${routeId}\` is not ${spec.idDescription}.`)
    }
    if (predecessorRouteId && routeId.toLowerCase() === String(predecessorRouteId).toLowerCase()) {
      problems.push(
        `\`route_id\` is INHERITED from the predecessor marker (${routeId}). A successor must ` +
          `record its OWN id. Reusing the predecessor's is how delegations kept arriving at a ` +
          `session that had already closed — the failure this contract exists to stop.`,
      )
    }
  }

  const sessionName = fields.session_name ?? ''
  if (sessionName && !sessionName.startsWith(ORCHESTRATOR_IDENTIFIER)) {
    problems.push(
      `\`session_name: ${sessionName}\` must begin with \`${ORCHESTRATOR_IDENTIFIER}\` so the ` +
        `orchestrator is identifiable in a session list. The name is a discovery HINT only — ` +
        `the open marker remains the sole authority for routing.`,
    )
  }

  if (fields.started && !isIsoInstant(fields.started)) {
    problems.push(`\`started: ${fields.started}\` is not an ISO-8601 instant such as \`2026-08-26T14:39:25Z\`.`)
  }

  const handover = fields.handover_issue ?? ''
  if (handover && !/^(#?\d+|none)$/i.exec(handover)) {
    problems.push(
      `\`handover_issue: ${handover}\` — give the originating marker issue number, or \`none\` ` +
        `for a cold start with no predecessor. Blank is not \`none\`.`,
    )
  }

  return {
    valid: problems.length === 0,
    problems,
    routing: problems.length === 0 ? freeze(fields, engine, routeId) : null,
  }
}

function freeze(fields, engine, routeId) {
  const handover = (fields.handover_issue ?? '').replace(/^#/, '')
  return {
    identifier: ORCHESTRATOR_IDENTIFIER,
    engine,
    routeId,
    sessionName: fields.session_name,
    owner: fields.owner,
    machine: fields.machine,
    started: fields.started,
    handoverIssue: /^\d+$/.test(handover) ? Number(handover) : null,
    briefing: fields.briefing,
    /** How to actually reach it, so the caller does not have to know each engine. */
    /**
     * How to ATTEMPT delivery. Not a promise that it arrives.
     *
     * ⚠️ Validation here is SHAPE ONLY. Nothing in this repository can check
     * that the session exists, is running, belongs to the declared owner or
     * machine, is the shared-db orchestrator, or can receive a message -- there
     * is no session API to ask. A fabricated UUID with otherwise valid fields
     * resolves identically to a real one. Flagged by independent Codex GPT-5.6
     * review, 2026-08-26; the wording is exact rather than reassuring because
     * the caller has to know silence is not delivery.
     */
    howToReach:
      engine === 'codex'
        ? `Codex \`codex-reply\` with threadId ${routeId}`
        : `Claude cross-session message to sessionId ${routeId}`,
  }
}

/**
 * Render a routing block for a new marker. Used by the startup procedure so a
 * marker is authored in the one shape the guard accepts.
 */
export function renderRoutingBlock(values) {
  const lines = REQUIRED_FIELDS.map((field) => `${field}: ${values[field] ?? ''}`)
  return ['```' + ROUTING_BLOCK, ...lines, '```'].join('\n')
}
