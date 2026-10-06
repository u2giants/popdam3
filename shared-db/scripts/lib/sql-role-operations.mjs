//
// EXACT GLOBAL ROLE IDENTITY + SQL ROLE OPERATION ACCOUNTING (issue #3398).
//
// THE GAP THIS CLOSES. Structural issue #3298 needs to reserve a dedicated
// cluster-global NOLOGIN worker role (`role pm_jev_triage_worker`) in a db-claim.
// Previously the claim validator rejected `role <name>` ("unknown object kind in
// claim: role …") and the SQL collision parser listed `create role`/`alter role`
// under DISPATCH_UNMODELLED_FORMS on the assumption that roles are
// Supabase-managed. That assumption is false: migration 20260911210709 creates
// four application-specific NOLOGIN roles. A broad `schema` claim is NOT a
// reservation on a cluster-global role, and two migrations touching the SAME
// role must collide while distinct roles stay independent.
//
// This module is the pure, offline accounting layer used by the supported claim
// validator, collision guards and structural admission. It deliberately owns only the
// role axis:
//
//   * exact global role identity, preserving quoted-identifier case;
//   * CREATE / ALTER / DROP ROLE, rename targets, and membership GRANT/REVOKE;
//   * function/table ownership role DEPENDENCIES (recorded, never as an
//     exclusive write on the role);
//   * literal DO/dynamic-SQL rules reused from the collision parser. Dynamic
//     SQL whose text is an EXECUTEd exact literal resolves to the same
//     operations and dependencies as the literal itself; every other dynamic
//     role/ownership mutation is REFUSED (fail closed) rather than skipped.
//
// DESIGN INVARIANTS (the issue forbids weakening any of these):
//
//   (1) NO ALIASES. Every role name is its own exact identity. A rename yields
//       TWO independent identities (old and new are both reserved, but they are
//       never collapsed into one). Membership links two DISTINCT roles and
//       never merges them. There is no name-alias map anywhere here.
//   (2) NO COUNT CAPS. Roles are tracked in unbounded sets; nothing truncates.
//   (3) NO WEAKER CHECKS / SYNTHETIC EVIDENCE. Every operation is read out of
//       real SQL text. Nothing is invented, guessed, or defaulted to "clear".
//   (4) FAIL CLOSED on dynamic role mutations. Role DDL hidden inside a dynamic
//       SQL string (`EXECUTE format('CREATE ROLE %I', …)`) is invisible to the
//       literal extractor. Rather than report a false "touches no role", the
//       extractor surfaces it as a refusal the caller must honour — the same
//       fail-closed posture as the immutable-sidecar evidence rules. The only
//       exception is an EXECUTEd string whose text is itself an exact role (or
//       ownership) statement: that resolves to exactly what the literal says,
//       identically in every exported extractor. Fragments split across string
//       concatenation (`'c' || 'reate' || ' rol' || 'e x'`) have no exact
//       identity and are always refused, never resolved.
//
// Pure and offline: no GitHub, no database, no secrets.

export class RoleExtractionError extends Error {}
export class RoleClaimError extends Error {}

// A role is a SINGLE cluster-global identifier — never schema-qualified. This
// matches PostgreSQL: `CREATE ROLE schema.name` is invalid, but a quoted role
// may legally contain a dot (`CREATE ROLE "my.role"` names one role).
const IDENT = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)`
// Capture the entire token before validating it: matching an ASCII prefix of
// an unsupported Unicode or qualified name would reserve a different role.
const RAW_IDENT = String.raw`(?:"(?:[^"]|"")*"|[^\s;,()]+)`
const ROLE_LIST = String.raw`${RAW_IDENT}(?:\s*,\s*${RAW_IDENT})*`
const ROLE_COMMAND = String.raw`(?:role|user(?!\s+mapping\b)|group)`
// Schema-qualified object name (for ownership dependencies, which ARE qualified).
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`

// Words that may appear in a GRANT/REVOKE role list but are NOT role names.
// Filtering these is what keeps membership separate from privilege grants
// (`grant select on t to r`) and from `PUBLIC`/`CURRENT_USER` grantees.
const NON_ROLE_KEYWORDS = new Set([
  // Fully reserved grammar tokens and pseudo-role references. Nonreserved
  // words such as ROLE, SET, INSERT, CONNECT and EXECUTE are valid role names;
  // ON distinguishes privilege grants from membership, not a keyword denylist.
  // Source: PostgreSQL REL_17_STABLE parser/gram.y RoleSpec and parser/kwlist.h.
  'select', 'all', 'create', 'references', 'group', 'user',
  'public', 'current_user', 'current_role', 'session_user',
  'current_catalog', 'current_schema',
])

// Object kinds whose `OWNER TO` / `AUTHORIZATION` clause names a role. Shared
// by the literal ownership extractor and the dynamic ownership detector so the
// two can never disagree on what counts as an ownership statement.
const OWNER_OBJECT_KINDS = String.raw`foreign\s+table|materialized\s+view|table|view|sequence|function|procedure|schema|type|domain|index|database|tablespace|event\s+trigger`
const POSSIBLE_OWNER_TARGET = RAW_IDENT

// Implicit actor and PUBLIC spellings cannot establish an exact named role.
// Refuse membership that uses them rather than reserve only the named side.
const PSEUDO_ROLE_GRANTEES = new Set(['public', 'current_user', 'current_role', 'session_user'])

// Glue words of the GRANT/REVOKE membership grammar: never role names, used to
// tell "no named role anywhere" apart from "named role with no exact target".
const MEMBERSHIP_GLUE = new Set(['grant', 'revoke', 'to', 'from', 'with', 'admin', 'option', 'for', 'granted', 'by'])

/**
 * Whether `raw` names one exact role for ownership purposes, mirroring the
 * pushOwnership filter: quoted names (even `"current_user"`) are real roles,
 * while unquoted keywords name no fixed role.
 */
function isNamedOwnerToken(raw) {
  const name = canonicalRoleName(raw)
  if (!name) return false
  if (String(raw).trim().startsWith('"')) return true
  return !NON_ROLE_KEYWORDS.has(name.replace(/^"|"$/g, '').toLowerCase())
}

/**
 * Whether `text` contains any exact named-role token: a quoted identifier, or
 * an unquoted identifier that is neither a keyword nor membership grammar.
 * Used to refuse dynamic membership SQL with an unparseable side (`GRANT %I
 * TO app` must not silently lose `app`) while letting keyword-only shapes
 * (`GRANT SELECT, INSERT TO PUBLIC`) resolve to the same empty result as the
 * literal path.
 */
function hasNamedRoleToken(text) {
  const re = new RegExp(IDENT, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    const tok = m[0]
    if (tok.startsWith('"')) {
      if (canonicalRoleName(tok)) return true
      continue
    }
    const lower = tok.toLowerCase()
    if (MEMBERSHIP_GLUE.has(lower) || NON_ROLE_KEYWORDS.has(lower)) continue
    return true
  }
  return false
}


/**
 * Canonical identity for one cluster-global role name.
 *
 * Returns the collision-safe identity string, or null when `raw` is not a single
 * exact role identifier (e.g. schema-qualified, empty, or garbage).
 *
 * Quoted-case rule (matches the repo's `canonicalIdentifierParts` convention):
 * PostgreSQL folds an UNQUOTED identifier to lowercase, so `MyRole` names
 * `myrole`. A QUOTED name keeps its exact case: `"MyRole"` is the role
 * `MyRole`, distinct from `myrole`. A quoted name that is already a legal
 * lowercase unquoted identifier (`"foo"`) names the same role as `foo` and
 * folds to it. Non-lowercase quoted names are re-quoted in the identity so
 * `"MyRole"` and `myrole` can never share a key.
 */
export function canonicalRoleName(raw) {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  const m = /^(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_$]*))$/.exec(text)
  if (!m) return null
  if (m[1] !== undefined) {
    const value = m[1].replace(/""/g, '"')
    if (!value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 63) return null
    return /^[a-z_][a-z0-9_$]*$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`
  }
  if (Buffer.byteLength(m[2], 'utf8') > 63) return null
  return m[2].toLowerCase()
}

function canonicalSqlRoleOrThrow(raw) {
  const name = canonicalRoleName(raw)
  if (!name) throw new RoleExtractionError(`SQL role target is not one exact supported identifier: ${raw}`)
  return name
}

function canonicalRoleOrThrow(raw) {
  const name = canonicalRoleName(raw)
  if (!name) throw new RoleClaimError(`role claim must name one exact global role: ${raw}`)
  return name
}

/**
 * Validate the TARGET half of a `role <target>` claim and return its canonical
 * global identity. Rejects schema-qualified or non-identifier targets.
 */
export function validateRoleClaimTarget(target) {
  return canonicalRoleOrThrow(target)
}

/**
 * Normalize a full `role <target>` claim object to `role <canonical>`.
 * The supported claim validator uses this hook to accept exact global roles.
 */
export function normalizeRoleClaim(object) {
  const m = /^role\s+(.+)$/is.exec(String(object).trim())
  if (!m) throw new RoleClaimError(`not a role claim: ${object}`)
  return `role ${canonicalRoleOrThrow(m[1])}`
}

/**
 * `ALTER … OWNER TO <role>` and `CREATE SCHEMA … AUTHORIZATION <role>` create a
 * DEPENDENCY from an object onto a role. This is intentionally NOT a write on
 * the role: two migrations that each hand ownership of different functions to
 * the same role must NOT collide with each other. The dependency is returned so
 * a consumer can still detect a role DROP that would break a dependent object.
 */
function pushOwnership(deps, kind, nameRaw, ownerRaw) {
  // Implicit actors name no fixed role, so they must refuse rather than lose
  // the ownership dependency. Quoted spellings are exact named roles.
  if (!String(ownerRaw).trim().startsWith('"') && PSEUDO_ROLE_GRANTEES.has(String(ownerRaw).trim().toLowerCase())) throw new RoleExtractionError('ownership role is implicit and has no provable exact identity')
  const role = canonicalSqlRoleOrThrow(ownerRaw)
  if (!isNamedOwnerToken(ownerRaw)) return
  deps.push({ action: 'owner_dependency', role, ownerKind: kind, ownerTarget: nameRaw })
}

// ---------------------------------------------------------------------------
// Literal / DO-block extraction. Reuses the collision parser's established
// rules: strip comments while preserving quoted identifier text; keep the body of a
// top-level `DO $$ … $$` (this repo's normal idempotent migration form) while
// blanking other dollar-quoted bodies and single-quoted string literals.
// ---------------------------------------------------------------------------

/** PostgreSQL accepts `DO $$…$$` and `DO LANGUAGE plpgsql $tag$…$tag$`. */
function dollarQuoteStartsDo(source, offset) {
  let cursor = offset
  const word = () => {
    while (cursor > 0 && /\s/.test(source[cursor - 1])) cursor--
    const end = cursor
    while (cursor > 0 && /[A-Za-z_0-9$]/.test(source[cursor - 1])) cursor--
    const token = source.slice(cursor, end)
    return (Array.isArray(token) ? token.join('') : token).toLowerCase()
  }
  const last = word()
  if (last === 'do') return true
  return /^[a-z_][a-z_0-9$]*$/.test(last) && word() === 'language' && word() === 'do'
}

function beginsExecutedSql(source, offset) {
  return /\bexecute\s+(?:format\s*\(\s*)?$/i.test(source.slice(0, offset))
}

function dynamicLiteralContext(source, offset, whole, text) {
  const before = source.slice(0, offset)
  const after = source.slice(offset + whole.length)
  const joinedBefore = /\|\|\s*$/.test(before)
  // A cast between the literal and `||` still appends to the command text.
  // Look to this statement's semicolon rather than only the next token; this
  // also catches parentheses around the literal without parsing an expression.
  const afterStatement = after.split(';', 1)[0]
  const joinedAfter = /\|\|/.test(afterStatement)
  // The checked-in authenticator migration appends one safely quoted setting
  // value after the role name and SET clause are already complete. Restrict
  // this exception to that SQL shape and a literal quote_literal argument;
  // arbitrary appended expressions can extend a role name or add statements.
  const safeSettingValue = !joinedBefore && joinedAfter &&
    /^\s*alter\s+role\s+(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*)\s+set\s+[A-Za-z_][A-Za-z_0-9$.]*\s*=\s*$/i.test(text) &&
    /^\s*\|\|\s*quote_literal\s*\(\s*'(?:[^']|'')*'\s*\)\s*;/i.test(after)
  return {
    executed: beginsExecutedSql(source, offset),
    executeExpression: /\bexecute\b[^;]*$/i.test(before),
    formatted: /\bexecute\s+format\s*\(\s*$/i.test(before),
    concatenated: (joinedBefore || joinedAfter) && !safeSettingValue,
  }
}

function normalizeSql(sql) {
  // Collapsing whitespace across the entire SQL text changes quoted role names:
  // "My  Role" and "My Role" are two different PostgreSQL identifiers.
  // Every extractor below already accepts SQL whitespace through `\s`.
  return stripSqlComments(String(sql))
}

function stripSqlComments(sql) {
  const output = sql.split('')
  const blank = (start, end) => { for (let i = start; i < end; i++) if (sql[i] !== '\n') output[i] = ' ' }
  const scan = (start, finish, insideDo = false) => {
    for (let i = start; i < finish;) {
      const ch = sql[i]
      if (ch === '"' || ch === "'") {
        let j = i + 1
        for (; j < finish; j++) {
          if (sql[j] !== ch) continue
          if (sql[j + 1] === ch) { j++; continue }
          break
        }
        if (j >= finish) throw new RoleExtractionError('unterminated SQL quote')
        i = j + 1; continue
      }
      if (sql.slice(i, i + 2) === '--') {
        const newline = sql.indexOf('\n', i), end = newline < 0 ? finish : Math.min(newline, finish)
        blank(i, end); i = end; continue
      }
      if (sql.slice(i, i + 2) === '/*') {
        let j = i + 2, depth = 1
        while (j < finish && depth) {
          if (sql.slice(j, j + 2) === '/*') { depth++; j += 2 }
          else if (sql.slice(j, j + 2) === '*/') { depth--; j += 2 }
          else j++
        }
        if (depth) throw new RoleExtractionError('unterminated SQL comment')
        blank(i, j); i = j; continue
      }
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0]
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length)
        if (end < 0 || end >= finish) throw new RoleExtractionError('unterminated dollar SQL body')
        if (!insideDo && dollarQuoteStartsDo(output, i)) scan(i + tag.length, end, true)
        i = end + tag.length; continue
      }
      i++
    }
  }
  scan(0, sql.length)
  return output.join('')
}

/**
 * Split normalized SQL into the extractable stream plus the regions the literal
 * extractor cannot see (single-quoted strings and non-DO dollar bodies). The
 * hidden regions are exactly where a DYNAMIC role mutation can hide.
 */
function extractableAndHidden(sql) {
  const hidden = []
  const base = normalizeSql(sql)
  // Use UTF-16 indices throughout, matching regex offsets and slice().
  const output = base.split('')
  const blank = (start, end) => { for (let i = start; i < end; i++) output[i] = ' ' }
  const scan = (start, end, insideDo = false) => {
    for (let i = start; i < end;) {
      if (base[i] === '"') {
        let j = i + 1
        for (; j < end; j++) {
          if (base[j] !== '"') continue
          if (base[j + 1] === '"') { j++; continue }
          break
        }
        i = j + 1
        continue
      }
      if (base[i] === "'") {
        let j = i + 1
        for (; j < end; j++) {
          if (base[j] !== "'") continue
          if (base[j + 1] === "'") { j++; continue }
          break
        }
        const whole = base.slice(i, j + 1), text = whole.slice(1, -1).replace(/''/g, "'")
        hidden.push({ kind: 'string-literal', text, offset: i, end: j + 1,
          ...dynamicLiteralContext(base, i, whole, text) })
        blank(i, j + 1); i = j + 1; continue
      }
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(base.slice(i))?.[0]
      if (tag) {
        const close = base.indexOf(tag, i + tag.length)
        if (close < 0 || close >= end) throw new RoleExtractionError('unterminated dollar SQL body')
        const finish = close + tag.length, body = base.slice(i + tag.length, close)
        if (!insideDo && dollarQuoteStartsDo(base, i)) {
          blank(i, i + tag.length); blank(close, finish)
          scan(i + tag.length, close, true)
        } else {
          const whole = base.slice(i, finish)
          hidden.push({ kind: insideDo ? 'nested-dollar-string' : 'dollar-body', text: body, offset: i, end: finish,
            ...dynamicLiteralContext(base, i, whole, body) })
          blank(i, finish)
        }
        i = finish; continue
      }
      i++
    }
  }
  scan(0, base.length)
  const extractable = output.join('')
  const codeMask = extractable.replace(/"(?:[^"]|"")*"/g, (value) => ' '.repeat(value.length))
  for (const item of hidden) item.executeExpression = /\bexecute\b[^;]*$/i.test(codeMask.slice(0, item.offset))
  return { extractable, hidden, scanSource: base }
}

function splitRoleList(raw) {
  const parts = []
  let start = 0
  let quoted = false
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') { i += 1; continue }
      quoted = !quoted
    } else if (!quoted && c === ',') {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  parts.push(raw.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

function roleNamesFrom(listRaw) {
  const parts = splitRoleList(listRaw)
  if (parts.some((part) => !part.startsWith('"') && NON_ROLE_KEYWORDS.has(part.toLowerCase()) && !PSEUDO_ROLE_GRANTEES.has(part.toLowerCase()))) return []
  return parts
    .map((p) => ({ name: canonicalSqlRoleOrThrow(p), quoted: p.startsWith('"') }))
    .filter(({ name, quoted }) => {
      if (!name) return false
      const bare = name.replace(/^"|"$/g, '').toLowerCase()
      return quoted || !NON_ROLE_KEYWORDS.has(bare)
    })
    .map(({ name }) => name)
}

// Statement-boundary-anchored role DDL, for detecting a role mutation hidden in
// a dynamic SQL string. Anchoring (start / after `;` / `begin` / `then`) is what
// keeps mid-sentence prose ("… do not grant read on their own …") from reading
// as executable membership DDL.
function looksLikeRoleStatement(content) {
  return content.split(';').some((seg) => {
    const s = seg.trim()
    if (!s) return false
    if (/^(?:create|alter|drop)\s+user\s+mapping\b/i.test(s)) return false
    if (/^(?:create|alter|drop)\s+(?:role|user|group)\b/i.test(s)) return true
    const mem = /^(?:grant|revoke)\s+(?:(?:admin|inherit|set)\s+option\s+for\s+)?([\s\S]*?)\s+(?:to|from)\s+([\s\S]*)$/i.exec(s)
    if (!mem) return false
    // A privilege grant carries `on <object>` before the connector; membership does not.
    return !/\bon\b/i.test(mem[1])
  })
}

/**
 * Whether a hidden string reads as an ownership change (`ALTER … OWNER TO
 * <role>`, `CREATE SCHEMA … AUTHORIZATION <role>`, `CREATE DATABASE … OWNER
 * <role>`). Uses the same object kinds as the literal ownership extractor.
 * Exact, implicit and unsupported owner tokens all reach the same validation;
 * unsupported text must not disappear merely because it is inside a string.
 */
function looksLikeOwnershipChange(content) {
  return content.split(';').some((seg) => {
    const s = seg.trim()
    if (!s) return false
    if (/^(?:create|alter|drop)\s+user\s+mapping\b/i.test(s)) return false
    const m =
      new RegExp(`^alter\\s+(?:${OWNER_OBJECT_KINDS})\\b[\\s\\S]*?\\bowner\\s+to\\s+(${POSSIBLE_OWNER_TARGET})`, 'i').exec(s) ||
      new RegExp(`^create\\s+schema\\b[\\s\\S]*?\\bauthorization\\s+(${POSSIBLE_OWNER_TARGET})`, 'i').exec(s) ||
      new RegExp(`^create\\s+database\\b[\\s\\S]*?\\bowner\\s*(?:=\\s*)?(${POSSIBLE_OWNER_TARGET})`, 'i').exec(s)
    // A format placeholder can become any role at execution time. It is not
    // an exact dependency, but it is a reason to refuse instead of clearing.
    // Even unsupported tokens must reach validation. Otherwise a Unicode or
    // qualified owner hidden in executed SQL could disappear before refusal.
    return !!m
  })
}

/**
 * Whether a hidden string reads as any role-axis mutation: role DDL,
 * membership, or a named ownership change. Statement-anchored (start / after
 * `;`) so mid-sentence prose never reads as executable SQL.
 */
function looksLikeRoleMutation(content) {
  return looksLikeRoleStatement(content) || looksLikeOwnershipChange(content)
}

/**
 * Role DDL, membership, and named ownership changes hidden inside dynamic SQL
 * strings. These are invisible to the literal extractor (the string is
 * blanked), so unresolvable ones are REFUSED rather than skipped.
 *
 * Single-quoted literals and nested dollar strings inside DO are scanned: a
 * role verb inside one can be dynamic SQL (`EXECUTE '…'`, `EXECUTE
 * format($sql$CREATE ROLE %I$sql$, …)`). Role DDL
 * written literally inside a non-DO function body is deferred to call time and
 * is deliberately not a migration-time collision axis — consistent with the
 * collision parser's decision to blank function bodies.
 *
 * @returns {{kind: string, text: string}[]}
 */
export function findDynamicRoleMutations(sql) {
  const { extractable, hidden, scanSource } = extractableAndHidden(sql)
  const dynamicKinds = new Set(['string-literal', 'nested-dollar-string', 'dollar-body'])
  const direct = hidden
    .filter((h) => dynamicKinds.has(h.kind) && (h.kind !== 'dollar-body' || h.executed || h.executeExpression) && (
      looksLikeRoleMutation(h.text) ||
      ((h.executed || h.executeExpression || h.formatted) && /\b(?:role|user|group)\b/i.test(h.text)) ||
      (h.formatted && h.text.includes('%') && /\b(?:role|user|group)\b/i.test(h.text))
    ))
    .map((h) => ({
      kind: h.concatenated || (h.formatted && h.text.includes('%')) ? 'fragmented-execute' : h.kind,
      text: h.text.trim(), executed: h.executed,
    }))
  // A command split across string concatenation (`'c' || 'reate' || ' rol' ||
  // `'e x`) has no exact identity: no single fragment starts with the verb, so
  // windows open at EVERY fragment, not just verb-leading ones. Fragments are
  // joined with '' — the exact `||` semantics — in source order, including
  // mixed single-quoted and dollar-quoted pieces. The nested-dollar replacement
  // above preserves width, so both kinds' offsets remain comparable. A window
  // that contains an already-recognized single fragment is skipped: that fragment
  // is accounted on its own, and only the unaccounted remainder may refuse.
  // Windows only recognize the hazard, never invent a key.
  if (/\bexecute\b/i.test(extractable)) {
    const pieces = hidden
      .filter((h) => dynamicKinds.has(h.kind))
      .sort((a, b) => a.offset - b.offset)
    const hit = pieces.map((p) => looksLikeRoleMutation(p.text))
    for (let i = 0; i < pieces.length; i += 1) {
      if (hit[i] || !pieces[i].executed) continue
      let fragments = pieces[i].text
      for (let j = i + 1; j < pieces.length; j += 1) {
        const between = scanSource.slice(pieces[j - 1].end, pieces[j].offset)
        if (!between.includes('||') || between.includes(';')) break
        fragments += pieces[j].text
        if (hit.slice(i, j + 1).some(Boolean)) continue
        // A format placeholder or non-literal expression can complete an
        // otherwise split verb. A concatenated EXECUTE that has a standalone
        // role/user/group token but no exact statement is unresolvable, not
        // evidence that no role will be touched. This has no fragment cap.
        if (looksLikeRoleMutation(fragments) || /\b(?:role|user|group)\b/i.test(fragments)) {
          direct.push({ kind: 'fragmented-execute', text: fragments.trim(), executed: false })
          break
        }
      }
    }
  }
  return direct
}

/** Fail-closed guard: refuse when any dynamic role mutation is present. */
export function assertNoDynamicRoleMutations(sql) {
  const found = findDynamicRoleMutations(sql)
  if (found.length) {
    throw new RoleExtractionError(
      `dynamic role mutation(s) cannot be accounted for and must be refused: ${found.map((f) => f.text).join(' | ')}`,
    )
  }
}

/**
 * The role-axis view of a migration.
 *
 * @returns {{
 *   operations: {action: string, kind: 'role', target: string, from?: string, to?: string, members?: string[], grantees?: string[]}[],
 *   ownershipDependencies: {action: 'owner_dependency', role: string, ownerKind: string, ownerTarget: string}[],
 *   dynamicRefusals: {kind: string, text: string}[],
 * }}
 */
function opKey(op) {
  return JSON.stringify([op.action, op.target ?? null, op.from ?? null, op.to ?? null, op.members ?? [], op.grantees ?? [], op.grantor ?? null])
}

function compareOperations(a, b) {
  return `${a.action} ${a.target}`.localeCompare(`${b.action} ${b.target}`)
}

function extractRoleOperationsUnchecked(sql) {
  const { extractable, hidden } = extractableAndHidden(sql)
  const text = extractable
  // ALTER ROLE ALL names every role at once: there is no exact global target
  // to account, so every exported extractor refuses it (fail closed). A quoted
  // `"all"` is one exact role and is unaffected.
  const operations = []
  const ownershipDependencies = []
  const seen = new Set()
  const add = (op) => {
    const key = opKey(op)
    if (seen.has(key)) return
    seen.add(key)
    operations.push(op)
  }

  const quotedPositions = new Set()
  let inIdentifier = false
  for (let i = 0; i < text.length; i++) {
    if (inIdentifier) quotedPositions.add(i)
    if (text[i] === '"') {
      if (inIdentifier && text[i + 1] === '"') { quotedPositions.add(++i); continue }
      inIdentifier = !inIdentifier
    }
  }
  const run = (re, fn) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) { if (!quotedPositions.has(m.index)) fn(m) }
  }

  run(/\balter\s+(?:role|user|group)\s+all\b/gi, () => {
    throw new RoleExtractionError('ALTER ROLE/USER/GROUP ALL has no exact role target and must be refused')
  })

  // Reject unsupported role token spellings rather than accepting an ASCII
  // prefix, including schema qualification, Unicode escape identifiers and
  // names PostgreSQL would truncate to its 63-byte identifier limit.
  const rawTarget = String.raw`(${RAW_IDENT})`
  run(new RegExp(String.raw`\b(?:create|alter|drop)\s+${ROLE_COMMAND}\s+(?:if\s+(?:not\s+)?exists\s+)?${rawTarget}`, 'gi'), (m) => {
    const raw = m[1].toLowerCase()
    if (!m[1].startsWith('"') && PSEUDO_ROLE_GRANTEES.has(raw)) throw new RoleExtractionError('role mutation names an implicit or reserved role, not an exact identity')
    if (raw !== 'all') canonicalSqlRoleOrThrow(m[1])
  })
  run(new RegExp(String.raw`\bowner\s+to\s+${rawTarget}`, 'gi'), (m) => {
    if (!m[1].startsWith('"') && PSEUDO_ROLE_GRANTEES.has(m[1].toLowerCase())) throw new RoleExtractionError('ownership role is implicit and has no provable exact identity')
    canonicalSqlRoleOrThrow(m[1])
  })

  // CREATE ROLE | USER | GROUP  (the three spellings are one PostgreSQL command;
  // covering all three so no role mutation is skipped, while identity stays
  // exact and un-aliased per name).
  run(new RegExp(String.raw`\bcreate\s+${ROLE_COMMAND}\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'gi'), (m) => {
    const target = canonicalSqlRoleOrThrow(m[1])
    if (target) add({ action: 'create', kind: 'role', target })
  })

  // DROP ROLE a, b  → one drop op per name.
  run(new RegExp(String.raw`\bdrop\s+${ROLE_COMMAND}\s+(?:if\s+exists\s+)?`, 'gi'), (m) => {
    const start = m.index + m[0].length
    let finish = start, quoted = false
    for (; finish < text.length; finish++) {
      if (text[finish] === '"') {
        if (quoted && text[finish + 1] === '"') { finish++; continue }
        quoted = !quoted
      } else if (!quoted && text[finish] === ';') break
    }
    for (const part of splitRoleList(text.slice(start, finish))) {
      add({ action: 'drop', kind: 'role', target: canonicalSqlRoleOrThrow(part) })
    }
  })

  // ALTER ROLE x [RENAME TO y] — rename reserves BOTH identities (independent,
  // never aliased); a plain alter reserves the one.
  run(new RegExp(String.raw`\balter\s+${ROLE_COMMAND}\s+(?!all\b)(${IDENT})(?:\s+rename\s+to\s+(${IDENT}))?`, 'gi'), (m) => {
    const from = canonicalSqlRoleOrThrow(m[1])
    if (!from) return
    if (m[2]) {
      const to = canonicalSqlRoleOrThrow(m[2])
      if (to) add({ action: 'rename', kind: 'role', from, to })
    } else {
      add({ action: 'alter', kind: 'role', target: from })
    }
  })

  run(new RegExp(String.raw`\balter\s+group\s+(${IDENT})\s+(?:add|drop)\s+user\s+(${ROLE_LIST})`, 'gi'), (m) => {
    const group = canonicalRoleName(m[1])
    if (splitRoleList(m[2]).some((raw) => !raw.startsWith('"') && PSEUDO_ROLE_GRANTEES.has(raw.toLowerCase()))) throw new RoleExtractionError('group membership names an implicit role')
    const members = roleNamesFrom(m[2])
    if (group && members.length) add({ action: 'group_membership', kind: 'role', target: group, members })
  })

  // CREATE ROLE x with a membership option: IN ROLE / IN GROUP (the legacy
  // spelling) and ROLE / ADMIN / USER (`CREATE ROLE x ROLE y`, `ADMIN y`,
  // `USER y` — all valid PostgreSQL). Each option list links its named roles
  // to the created role; the created role itself is recorded by the plain
  // CREATE op above, so its identity is never lost either way.
  run(new RegExp(String.raw`\bcreate\s+${ROLE_COMMAND}\s+(${IDENT})([^;]*)`, 'gi'), (m) => {
    const grantee = canonicalRoleName(m[1])
    if (!grantee) return
    const optRe = new RegExp(String.raw`(?:\bin\s+(?:role|group)|\brole|\badmin|\buser(?!\s+mapping\b))\s+(${ROLE_LIST})`, 'gi')
    let om
    while ((om = optRe.exec(m[2])) !== null) {
      const prefix = m[2].slice(0, om.index).replace(/""/g, '')
      if ((prefix.match(/"/g) ?? []).length % 2) continue
      if (splitRoleList(om[1]).some((raw) => !raw.startsWith('"') && PSEUDO_ROLE_GRANTEES.has(raw.toLowerCase()))) throw new RoleExtractionError('CREATE ROLE membership names an implicit role')
      const members = roleNamesFrom(om[1])
      if (members.length) add({ action: 'grant_membership', kind: 'role', target: [...members, grantee].sort().join(' '), members, grantees: [grantee] })
    }
  })

  // Membership writes need exact named roles on both sides. An implicit actor
  // or PUBLIC counterpart cannot be turned into a partial reservation.
  const addMembership = (action, membersRaw, granteesRaw, grantorRaw) => {
    const members = roleNamesFrom(membersRaw)
    const grantees = roleNamesFrom(granteesRaw)
    const memberHasImplicitActor = splitRoleList(membersRaw).some((raw) => !raw.startsWith('"') && PSEUDO_ROLE_GRANTEES.has(raw.toLowerCase()))
    if ((members.length || grantees.length || memberHasImplicitActor) && [...splitRoleList(membersRaw), ...splitRoleList(granteesRaw)].some((raw) => !raw.startsWith('"') && PSEUDO_ROLE_GRANTEES.has(raw.toLowerCase()))) throw new RoleExtractionError('membership role is implicit or reserved and has no provable exact identity')
    if (members.length && grantees.length) {
      if (grantorRaw && !grantorRaw.startsWith('"') && PSEUDO_ROLE_GRANTEES.has(grantorRaw.toLowerCase())) throw new RoleExtractionError('membership grantor is implicit and has no provable exact identity')
      const grantor = grantorRaw ? canonicalSqlRoleOrThrow(grantorRaw) : null
      add({ action, kind: 'role', target: [...members, ...grantees].sort().join(' '), members, grantees, ...(grantor ? { grantor } : {}) })
    }
  }

  // Membership GRANT a, b TO c, d  (no `on`, so never a privilege grant).
  run(new RegExp(String.raw`\bgrant\s+(?:(?:admin|inherit|set)\s+option\s+for\s+)?(${ROLE_LIST})\s+to\s+(${ROLE_LIST})(?:\s+with\s+(?:admin|inherit|set)\s+(?:option|true|false)(?:\s*,\s*(?:admin|inherit|set)\s+(?:option|true|false))*)?(?:\s+granted\s+by\s+${rawTarget})?`, 'gi'), (m) => {
    addMembership('grant_membership', m[1], m[2], m[3])
  })

  // Membership REVOKE a FROM c.
  run(new RegExp(String.raw`\brevoke\s+(?:(?:admin|inherit|set)\s+option\s+for\s+)?(${ROLE_LIST})\s+from\s+(${ROLE_LIST})(?:\s+granted\s+by\s+${rawTarget})?`, 'gi'), (m) => {
    addMembership('revoke_membership', m[1], m[2], m[3])
  })

  // Ownership dependencies: ALTER <kind> <name> OWNER TO <role>. The optional
  // `(…)` skips a function/procedure argument list so `alter function f(…) owner
  // to r` still resolves the owning role. This is a DEPENDENCY, never a write.
  run(new RegExp(String.raw`\balter\s+(foreign\s+table|materialized\s+view|table|view|sequence|function|procedure|schema|type|domain|index|database|tablespace|event\s+trigger)\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})(?:\s*\((?:[^()]|\([^()]*\))*\))?\s+owner\s+to\s+(${IDENT}|current_user|current_role|session_user)`, 'gi'), (m) => {
    pushOwnership(ownershipDependencies, m[1].toLowerCase().replace(/\s+/g, ' '), m[2], m[3])
  })

  // CREATE SCHEMA … AUTHORIZATION <role> and CREATE DATABASE … OWNER <role>.
  run(new RegExp(String.raw`\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?(${IDENT})(?:\s+authorization\s+${rawTarget})?`, 'gi'), (m) => {
    if (m[2]) pushOwnership(ownershipDependencies, 'schema', m[1], m[2])
  })
  // PostgreSQL also permits CREATE SCHEMA AUTHORIZATION r with no schema name:
  // the schema is named after r. This is still a dependency, never a role write.
  run(new RegExp(String.raw`\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?authorization\s+${rawTarget}`, 'gi'), (m) => {
    pushOwnership(ownershipDependencies, 'schema', m[1], m[1])
  })
  run(new RegExp(String.raw`\bcreate\s+database\s+(${IDENT})(?:\s+(?:with\s+)?owner\s*(?:=\s*)?${rawTarget})?`, 'gi'), (m) => {
    if (m[2]) pushOwnership(ownershipDependencies, 'database', m[1], m[2])
  })

  // A supported OWNER TO role must not disappear because the preceding object
  // name or signature is outside the ownership extractor's exact grammar.
  run(new RegExp(String.raw`\bowner\s+to\s+${rawTarget}`, 'gi'), (m) => {
    const role = canonicalSqlRoleOrThrow(m[1])
    if (isNamedOwnerToken(m[1]) && !ownershipDependencies.some((dep) => dep.role === role)) throw new RoleExtractionError('ownership object cannot be accounted exactly; refusing to omit its role dependency')
  })

  const dynamicRefusals = findDynamicRoleMutations(sql)

  operations.sort(compareOperations)
  return { operations, ownershipDependencies, dynamicRefusals }
}

// A role DDL verb whose target never materialized: a placeholder
// (`CREATE ROLE %I`), a bare verb fragment, or any other unparseable target.
// Resolving such a literal to "no operations" would be a false clear.
const ROLE_VERB_MISSING_TARGET = new RegExp(`\\b(?:create|alter|drop)\\s+${ROLE_COMMAND}\\b`, 'i')

/**
 * Resolve one EXECUTEd dynamic literal to exactly what its text says — the
 * same operations and ownership dependencies the literal path reports — or
 * refuse it. Fragments, non-executed strings, and literals with no exact
 * target never reach here (the caller refuses those); this function refuses
 * the remainder that parses to nothing accountable.
 */
function resolveExecutedLiteral(item) {
  const inner = extractRoleOperations(item.text)
  if (inner.operations.length || inner.ownershipDependencies.length) return inner
  if (ROLE_VERB_MISSING_TARGET.test(item.text)) {
    throw new RoleExtractionError(`dynamic role mutation target cannot be accounted exactly: ${item.text}`)
  }
  if (looksLikeOwnershipChange(item.text)) {
    throw new RoleExtractionError(`dynamic ownership mutation target cannot be accounted exactly: ${item.text}`)
  }
  if (/^\s*(?:grant|revoke)\b/i.test(item.text) && hasNamedRoleToken(item.text)) {
    throw new RoleExtractionError(`dynamic membership mutation target cannot be accounted exactly: ${item.text}`)
  }
  return inner
}

/**
 * The role-axis view of a migration: literal operations and ownership
 * dependencies, plus whatever EXECUTEd exact dynamic literals resolve to.
 *
 * Fail-closed and consistent across every exported extractor: `ALTER ROLE ALL`
 * (no exact target), fragments, non-executed strings, and dynamic literals
 * with no exact target all throw `RoleExtractionError` here, so no caller can
 * read a silent empty result where a role mutation hides.
 *
 * @returns {{
 *   operations: {action: string, kind: 'role', target: string, from?: string, to?: string, members?: string[], grantees?: string[]}[],
 *   ownershipDependencies: {action: 'owner_dependency', role: string, ownerKind: string, ownerTarget: string}[],
 *   dynamicRefusals: {kind: string, text: string}[],
 * }}
 */
export function extractRoleOperations(sql) {
  const result = extractRoleOperationsUnchecked(sql)
  if (!result.dynamicRefusals.length) return result
  const operations = [...result.operations]
  const ownershipDependencies = [...result.ownershipDependencies]
  const seen = new Set(operations.map(opKey))
  const seenDeps = new Set(ownershipDependencies.map((d) => JSON.stringify([d.role, d.ownerKind, d.ownerTarget])))
  for (const item of result.dynamicRefusals) {
    if (item.kind === 'fragmented-execute' || !item.executed) {
      throw new RoleExtractionError(`dynamic role mutation has no provable executed exact target: ${item.text}`)
    }
    const inner = resolveExecutedLiteral(item)
    for (const op of inner.operations) {
      if (seen.has(opKey(op))) continue
      seen.add(opKey(op))
      operations.push(op)
    }
    for (const dep of inner.ownershipDependencies) {
      const key = JSON.stringify([dep.role, dep.ownerKind, dep.ownerTarget])
      if (seenDeps.has(key)) continue
      seenDeps.add(key)
      ownershipDependencies.push(dep)
    }
  }
  operations.sort(compareOperations)
  return { operations, ownershipDependencies, dynamicRefusals: [] }
}

/**
 * Collision keys for the role writes only: `"<kind> <canonical>"`, the exact
 * shape a coordinator types into a `db-claim`. Ownership dependencies are
 * deliberately EXCLUDED — they are couplings, not exclusive writes.
 *
 * Fails closed exactly like extractRoleOperations (which supplies the
 * operations): dynamic role SQL that cannot be resolved to exact targets
 * throws instead of clearing.
 *
 * @returns {string[]} e.g. `['role pm_jev_triage_worker']`
 */
export function roleCollisionKeys(sql) {
  const { operations } = extractRoleOperations(sql)
  const keys = new Set()
  for (const op of operations) {
    if (op.action === 'rename') {
      keys.add(`role ${op.from}`)
      keys.add(`role ${op.to}`)
      continue
    }
    if (op.action === 'grant_membership' || op.action === 'revoke_membership' || op.action === 'group_membership') {
      for (const name of [...(op.members ?? []), ...(op.grantees ?? [])]) keys.add(`role ${name}`)
      if (op.action === 'group_membership') keys.add(`role ${op.target}`)
      continue
    }
    if (op.target) keys.add(`role ${op.target}`)
  }
  return [...keys].sort()
}

/**
 * Ownership role dependencies only (NOT writes). A consumer pairs these with a
 * role DROP to catch "drop the role a function/table depends on" without ever
 * treating the dependency as an exclusive reservation on the role. Dynamic
 * literals resolve exactly like extractRoleOperations; anything unresolvable
 * throws there instead of clearing.
 */
export function roleOwnershipDependencies(sql) {
  return extractRoleOperations(sql).ownershipDependencies
}
