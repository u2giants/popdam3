// Curated Master Data admission (issue #4184, for #4172 / PR #4176).
//
// AGENTS.md §6.4 and docs/agents/section-4-anti-collision-rules.md require a
// curated-master-data fork that ships supabase/migrations/* to claim a lane, so
// it must also be admissible and able to draw a reviewer. It is NOT structural
// work: its scope names no database objects (parseQueueScope forbids them) and
// its migration must be a bounded row load into curated Master Data.
//
// The data-only proof is an ALLOWLIST over a PostgreSQL-accurate token stream,
// not a denylist over regex-stripped text. Every string form PostgreSQL knows
// (standard, E'' with backslash escapes, dollar-quoted, quoted identifiers,
// nested block comments) is lexed exactly once; only a DO block's body is
// re-lexed as code. Anything the lexer or the allowlist does not recognise
// refuses (fail closed). Structural changes keep using work_type structural.

export class CuratedSqlError extends Error {}

const WORD = /[A-Za-z_\u0080-￿]/
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/

export function lexPostgres(sql) {
  const text = String(sql), tokens = []
  let i = 0
  const fail = (message) => { throw new CuratedSqlError(`${message} at offset ${i}`) }
  while (i < text.length) {
    const c = text[i], n = text[i + 1]
    if (/\s/.test(c)) { i++; continue }
    if (c === '-' && n === '-') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue }
    if (c === '/' && n === '*') {
      let depth = 1; i += 2
      while (depth) {
        if (i >= text.length) fail('unterminated block comment')
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2 } else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2 } else i++
      }
      continue
    }
    if (c === '\\') fail('psql meta-command or stray backslash outside a string')
    const prev = tokens[tokens.length - 1]
    if (c === "'") {
      // E'...' (adjacent E/e word token) honours backslash escapes; every other
      // form (standard, U&'', B'', X'') uses only doubled quotes.
      const escaped = prev?.type === 'word' && prev.end === i && /^e$/i.test(prev.raw)
      if (escaped) tokens.pop()
      let j = i + 1
      for (;;) {
        if (j >= text.length) fail('unterminated string literal')
        if (escaped && text[j] === '\\') { j += 2; continue }
        if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      tokens.push({ type: 'string', start: i, end: j + 1 }); i = j + 1; continue
    }
    if (c === '"') {
      let j = i + 1, value = ''
      for (;;) {
        if (j >= text.length) fail('unterminated quoted identifier')
        if (text[j] === '"') { if (text[j + 1] === '"') { value += '"'; j += 2; continue } break }
        value += text[j++]
      }
      tokens.push({ type: 'ident', value, start: i, end: j + 1 }); i = j + 1; continue
    }
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(text.slice(i))
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length)
        if (close < 0) fail('unterminated dollar-quoted string')
        tokens.push({ type: 'dollar', body: text.slice(i + tag[0].length, close), bodyOffset: i + tag[0].length, start: i, end: close + tag[0].length })
        i = close + tag[0].length; continue
      }
      if (/[0-9]/.test(n ?? '')) { let j = i + 1; while (/[0-9]/.test(text[j] ?? '')) j++; tokens.push({ type: 'param', start: i, end: j }); i = j; continue }
      fail('unrecognised dollar sign')
    }
    if (WORD.test(c)) {
      let j = i + 1; while (j < text.length && WORD_PART.test(text[j])) j++
      const raw = text.slice(i, j)
      tokens.push({ type: 'word', raw, value: raw.toLowerCase(), start: i, end: j }); i = j; continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n ?? ''))) {
      let j = i + 1; while (/[0-9a-zA-Z_.]/.test(text[j] ?? '')) j++
      tokens.push({ type: 'number', start: i, end: j }); i = j; continue
    }
    const two = text.slice(i, i + 2)
    if ([':=', '::', '<=', '>=', '<>', '!=', '||', '->', '=>', '@>', '<@', '..'].includes(two)) { tokens.push({ type: 'punct', value: two, start: i, end: i + 2 }); i += 2; continue }
    if ('(),;.=<>+-*/%:[]|&!@#^~?'.includes(c)) { tokens.push({ type: 'punct', value: c, start: i, end: i + 1 }); i++; continue }
    fail(`unrecognised character ${JSON.stringify(c)}`)
  }
  return tokens
}

// Words that may never appear as code anywhere in a curated migration, in any
// position: each one runs SQL from a string, changes structure, privileges,
// sessions or replication behaviour, or bypasses row-level reasoning.
const FORBIDDEN_WORDS = new Set([
  'execute', 'truncate', 'copy', 'merge', 'call', 'prepare', 'deallocate', 'reassign', 'listen', 'unlisten', 'notify',
  'discard', 'vacuum', 'reindex', 'cluster', 'refresh', 'checkpoint', 'grant', 'revoke', 'create', 'alter', 'drop',
  'reset', 'lock', 'security', 'import', 'load', 'savepoint', 'rollback', 'commit', 'release', 'abort', 'start',
  'set_config', 'setval', 'session_replication_role', 'session_authorization', 'search_path', 'role',
  'pg_catalog', 'information_schema', 'cron', 'cron_schedule', 'schedule_in_database', 'unschedule', 'alter_job', 'cursor', 'open', 'fetch', 'move', 'close', 'format', 'quote_ident', 'quote_literal',
  'lo_import', 'lo_export', 'lo_unlink', 'lo_from_bytea', 'lo_put',
])
const FORBIDDEN_PREFIXES = ['pg_', 'lo_', 'dblink', 'query_to_', 'table_to_', 'schema_to_', 'database_to_', 'cursor_to_', 'xpath_table']
const ALLOWED_PG_WORDS = new Set(['pg_backend_pid'])
// Forbidden in every position, including as a qualified member: sequence
// advancing functions, and the cron schema/functions under any spelling.
const FORBIDDEN_IDENTS = new Set(['nextval', 'currval', 'lastval', 'cron', 'pg_catalog', 'information_schema'])
const WHERE_KEYWORDS = new Set(['where', 'and', 'or', 'not', 'true', 'false', 'null', 'is', 'in', 'returning'])

// `SET LOCAL <one of these>` is the only session statement a curated load may use.
const SETTABLE = new Set(['statement_timeout', 'lock_timeout'])

// Curated Master Data lives in core.*; a curated write into core.property is
// authorised by a row in plm.licensing_write_authorization (the licensing guard).
// The licensing guard ledger is append-only: each curated transaction inserts
// its own authorization row keyed by backend pid and transaction id, so it is
// written by every curated load and is not an exclusive claim object.
export const CURATED_LEDGER_TABLES = Object.freeze(['table plm.licensing_write_authorization'])
export function isCuratedTarget(schema, name) {
  return schema === 'core' || (schema === 'plm' && name === 'licensing_write_authorization')
}

function identAt(tokens, index) {
  const token = tokens[index]
  if (!token || (token.type !== 'word' && token.type !== 'ident')) return null
  // PostgreSQL folds only unquoted names; a quoted name keeps its case.
  return token.value
}

// Returns the qualified target at tokens[index] as {schema, name, next}.
function qualifiedTarget(tokens, index) {
  const first = identAt(tokens, index)
  if (first === null) return null
  if (tokens[index + 1]?.type === 'punct' && tokens[index + 1].value === '.') {
    const second = identAt(tokens, index + 2)
    if (second === null) return null
    if (tokens[index + 3]?.type === 'punct' && tokens[index + 3].value === '.') return { schema: null, name: null, next: index + 4 }
    return { schema: first, name: second, next: index + 3 }
  }
  return { schema: null, name: first, next: index + 1 }
}

// Expand DO blocks: their dollar body is re-lexed as PL/pgSQL code. Any other
// dollar-quoted token stays a string literal.
function codeUnits(sql) {
  const top = lexPostgres(sql), units = [{ tokens: [], plpgsql: false }], current = units[0]
  for (let k = 0; k < top.length; k++) {
    const token = top[k]
    const leading = k === 0 || (top[k - 1].type === 'punct' && top[k - 1].value === ';')
    if (leading && token.type === 'word' && token.value === 'do') {
      let j = k + 1
      if (top[j]?.type === 'word' && top[j].value === 'language') {
        if (!(top[j + 1]?.type === 'word' && top[j + 1].value === 'plpgsql')) throw new CuratedSqlError('DO block language must be plpgsql')
        j += 2
      }
      const body = top[j]
      if (body?.type !== 'dollar') throw new CuratedSqlError('DO block body must be a dollar-quoted string')
      if (top[j + 1]?.type === 'word' && top[j + 1].value === 'language') {
        if (!(top[j + 2]?.type === 'word' && top[j + 2].value === 'plpgsql')) throw new CuratedSqlError('DO block language must be plpgsql')
        j += 2
      }
      units.push({ tokens: lexPostgres(body.body), plpgsql: true })
      current.tokens.push({ type: 'punct', value: ';', start: body.end, end: body.end })
      k = j + (top[j + 1]?.type === 'punct' && top[j + 1].value === ';' ? 1 : 0)
      continue
    }
    current.tokens.push(token)
  }
  return units
}

// Expression-level calls are an ALLOWLIST too: only these side-effect-free
// builtins may be called. Anything else (pg_net, vault, SECURITY DEFINER
// helpers, extension functions) refuses, because its body is never seen here.
const CALLABLE = new Set(['count', 'coalesce', 'nullif', 'greatest', 'least', 'lower', 'upper', 'trim', 'btrim', 'ltrim', 'rtrim',
  'length', 'char_length', 'concat', 'concat_ws', 'replace', 'split_part', 'left', 'right', 'substr', 'position',
  'jsonb_build_object', 'jsonb_build_array', 'json_build_object', 'json_build_array', 'to_jsonb', 'jsonb_agg', 'jsonb_object_agg',
  'array_agg', 'string_agg', 'min', 'max', 'sum', 'avg', 'bool_and', 'bool_or', 'array_length', 'cardinality', 'abs', 'round',
  'now', 'clock_timestamp', 'statement_timestamp', 'transaction_timestamp', 'gen_random_uuid', 'encode', 'decode', 'md5',
  'digest', 'pg_backend_pid', 'txid_current'])
const QUALIFIED_CALLABLE = new Set(['extensions.digest', 'extensions.gen_random_uuid'])
// Words that take a parenthesis without being a function call.
const PAREN_KEYWORDS = new Set(['values', 'in', 'exists', 'not', 'and', 'or', 'any', 'all', 'some', 'row', 'filter', 'over', 'as',
  'select', 'from', 'where', 'on', 'conflict', 'using', 'when', 'then', 'else', 'if', 'elsif', 'case', 'returning', 'into', 'join',
  'with', 'by', 'distinct', 'array', 'is', 'between', 'like', 'ilike', 'set', 'loop', 'exception', 'raise', 'perform', 'return',
  'while', 'assert', 'cast', 'interval', 'lateral', 'except', 'union', 'intersect', 'having', 'group', 'order', 'limit', 'offset'])
// Read sources a curated load may use: curated Master Data and the licensing
// source extracts it is curated from.
const READ_SCHEMAS = new Set(['core', 'plm'])

function checkCall(tokens, k, declaring) {
  const t = tokens[k], name = t.type === 'word' ? t.value : t.value
  const prev = tokens[k - 1]
  if (t.type === 'word' && PAREN_KEYWORDS.has(name)) return
  // the column list of INSERT INTO <target> ( ... )
  const before = prev?.type === 'punct' && prev.value === '.' ? tokens[k - 3] : prev
  if (before?.type === 'word' && before.value === 'into' && tokens[k - (prev?.value === '.' ? 4 : 2)]?.type === 'word' && tokens[k - (prev?.value === '.' ? 4 : 2)].value === 'insert') return
  if (declaring) return // a type modifier such as numeric(10, 2) in a DECLARE section
  if (prev?.type === 'punct' && prev.value === '.') {
    const schema = tokens[k - 2]
    const qualified = `${schema?.value ?? ''}.${name}`
    if (schema?.type === 'word' && QUALIFIED_CALLABLE.has(qualified)) return
    throw new CuratedSqlError(`call to ${qualified} is not an allowed side-effect-free builtin`)
  }
  if (t.type === 'word' && CALLABLE.has(name)) return
  throw new CuratedSqlError(`call to ${t.type === 'ident' ? `"${name}"` : name} is not an allowed side-effect-free builtin`)
}

// Every relation in a FROM list is checked, including comma-separated ones;
// a parenthesised subquery is skipped here because its own FROM is checked
// when the token walk reaches it. Returns the qualified relations read.
const FROM_LIST_END = new Set(['where', 'group', 'order', 'limit', 'offset', 'having', 'union', 'except', 'intersect', 'returning',
  'on', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'for', 'window', 'into', 'loop', 'then', 'using', 'set', 'values', 'select'])
function checkSource(tokens, k) {
  const prev = tokens[k - 1]
  if (tokens[k].value === 'from' && prev?.type === 'word' && ['delete', 'distinct'].includes(prev.value)) return []
  const reads = []
  let i = k + 1
  for (;;) {
    const t = tokens[i]
    if (t?.type === 'word' && t.value === 'lateral') i++
    if (tokens[i]?.type === 'punct' && tokens[i].value === '(') {
      let depth = 0
      for (; i < tokens.length; i++) {
        if (tokens[i].type === 'punct' && tokens[i].value === '(') depth++
        else if (tokens[i].type === 'punct' && tokens[i].value === ')' && --depth === 0) { i++; break }
      }
    } else {
      const target = qualifiedTarget(tokens, i)
      if (!target?.schema || !READ_SCHEMAS.has(target.schema) || (tokens[target.next]?.type === 'punct' && tokens[target.next].value === '(')) throw new CuratedSqlError(`read source ${target?.schema ? `${target.schema}.${target.name}` : (target?.name ?? 'expression')} is outside curated Master Data and its licensing sources (core.*, plm.*)`)
      reads.push(`table ${target.schema}.${target.name}`)
      i = target.next
    }
    if (tokens[i]?.type === 'word' && tokens[i].value === 'as') i++
    if ((tokens[i]?.type === 'word' && !FROM_LIST_END.has(tokens[i].value)) || tokens[i]?.type === 'ident') i++ // alias
    if (tokens[i]?.type === 'punct' && tokens[i].value === ',' ) { i++; continue }
    return reads
  }
}

const DML_START = new Set(['insert', 'update', 'delete'])
// Statement-leading allowlists. Anything else leading a statement refuses, so a
// keyword split by a comment (exec/**/ute) or any unmodelled command fails closed.
const TOP_LEVEL_LEADING = new Set(['insert', 'update', 'delete', 'select', 'with', 'set'])
const PLPGSQL_LEADING = new Set(['begin', 'end', 'if', 'elsif', 'else', 'raise', 'return', 'perform', 'get', 'loop', 'for', 'foreach',
  'while', 'exit', 'continue', 'assert', 'null', 'exception', 'when', 'case', 'select', 'insert', 'update', 'delete', 'with', 'declare'])

export function inspectCuratedSql(sql) {
  const writes = new Set(), reads = new Set()
  let dml = 0
  for (const { tokens, plpgsql } of codeUnits(sql)) {
    let declaring = false, caseDepth = 0
    const variables = new Set()
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k]
      const before = tokens[k - 1]
      if (plpgsql && token.type === 'word') {
        if (declaring && (before?.value === ';' || before?.value === 'declare') && tokens[k + 1]?.type === 'word') variables.add(token.value)
        if (token.value === 'declare') declaring = true
        else if (token.value === 'begin') declaring = false
        else if (token.value === 'case') caseDepth++
        else if (token.value === 'end' && caseDepth > 0 && !(tokens[k + 1]?.type === 'word' && ['if', 'loop'].includes(tokens[k + 1].value))) caseDepth--
      }
      const leading = !before || (before.type === 'punct' && before.value === ';')
        || (plpgsql && before.type === 'word' && (['begin', 'loop'].includes(before.value) || (caseDepth === 0 && ['then', 'else'].includes(before.value))))
      if (leading && !(plpgsql && declaring) && !(token.type === 'punct' && token.value === ';')) {
        const assignment = plpgsql && token.type === 'word' && tokens[k + 1]?.type === 'punct' && [':=', '='].includes(tokens[k + 1].value)
        const allowed = token.type === 'word' && (plpgsql ? PLPGSQL_LEADING : TOP_LEVEL_LEADING).has(token.value)
        if (!allowed && !assignment) throw new CuratedSqlError(`statement may not begin with ${token.type === 'word' ? token.value.toUpperCase() : token.type}`)
      }
      if (token.type === 'dollar') {
        if (plpgsql) throw new CuratedSqlError('nested dollar-quoted strings inside a DO block are refused')
        continue
      }
      if (token.type === 'ident') {
        // A quoted identifier names the same catalog object or function as its
        // bare spelling (case aside), so it gets the same forbidden checks.
        const name = token.value.toLowerCase(), member = tokens[k - 1]?.type === 'punct' && tokens[k - 1].value === '.'
        if (FORBIDDEN_WORDS.has(name) || FORBIDDEN_IDENTS.has(name) || (FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix)) && !ALLOWED_PG_WORDS.has(name))) throw new CuratedSqlError(`forbidden quoted identifier "${token.value}"`)
        if (tokens[k + 1]?.type === 'punct' && tokens[k + 1].value === '(') checkCall(tokens, k, plpgsql && declaring)
        continue
      }
      if (token.type !== 'word') continue
      const word = token.value, prev = tokens[k - 1], next = tokens[k + 1]
      if (FORBIDDEN_WORDS.has(word)) throw new CuratedSqlError(`forbidden word ${word.toUpperCase()}`)
      if (FORBIDDEN_IDENTS.has(word)) throw new CuratedSqlError(`forbidden function ${word}`)
      if (FORBIDDEN_PREFIXES.some((prefix) => word.startsWith(prefix)) && !ALLOWED_PG_WORDS.has(word)) throw new CuratedSqlError(`forbidden function or catalog ${word}`)
      if (next?.type === 'punct' && next.value === '(') checkCall(tokens, k, plpgsql && declaring)
      if (['from', 'join'].includes(word)) for (const read of checkSource(tokens, k)) reads.add(read)
      if (word === 'do' && !(next?.type === 'word' && ['nothing', 'update'].includes(next.value))) {
        throw new CuratedSqlError('nested or non-leading DO is refused')
      }
      if (word === 'set') {
        const statementLeading = !prev || (prev.type === 'punct' && prev.value === ';') || (prev.type === 'word' && ['begin', 'then', 'else', 'loop'].includes(prev.value))
        if (statementLeading) {
          if (!(next?.type === 'word' && next.value === 'local' && tokens[k + 2]?.type === 'word' && SETTABLE.has(tokens[k + 2].value))) throw new CuratedSqlError('only SET LOCAL statement_timeout or lock_timeout is allowed')
        }
        continue
      }
      if (word === 'into') {
        if (prev?.type === 'word' && prev.value === 'insert') continue
        // PL/pgSQL assignment target: one unqualified variable list. Outside a
        // DO block, SELECT ... INTO creates a table and is refused.
        if (!plpgsql) throw new CuratedSqlError('SELECT ... INTO outside a DO block creates a table')
        let j = k + 1
        if (tokens[j]?.type === 'word' && tokens[j].value === 'strict') j++
        if (tokens[j]?.type !== 'word' || (tokens[j + 1]?.type === 'punct' && tokens[j + 1].value === '.')) throw new CuratedSqlError('INTO target must be an unqualified PL/pgSQL variable')
        continue
      }
      if (!DML_START.has(word)) continue
      // UPDATE in FOR UPDATE / FOR NO KEY UPDATE and ON CONFLICT DO UPDATE SET
      // is not a statement; INSERT/DELETE have no such clause forms.
      if (word === 'update' && prev?.type === 'word' && ['for', 'key', 'do'].includes(prev.value)) continue
      let j = k + 1
      if (word === 'insert') { if (!(next?.type === 'word' && next.value === 'into')) throw new CuratedSqlError('INSERT must be INSERT INTO'); j = k + 2 }
      if (word === 'delete') { if (!(next?.type === 'word' && next.value === 'from')) throw new CuratedSqlError('DELETE must be DELETE FROM'); j = k + 2 }
      if (tokens[j]?.type === 'word' && tokens[j].value === 'only') j++
      const target = qualifiedTarget(tokens, j)
      if (!target?.schema || !target.name) throw new CuratedSqlError(`${word.toUpperCase()} target must be a schema-qualified table`)
      if (!isCuratedTarget(target.schema, target.name)) throw new CuratedSqlError(`${word.toUpperCase()} target ${target.schema}.${target.name} is outside curated Master Data`)
      if (word !== 'insert') {
        let end = j, depth = 0, where = -1, returning = -1
        for (; end < tokens.length; end++) {
          const t = tokens[end]
          if (t.type === 'punct' && t.value === '(') depth++
          else if (t.type === 'punct' && t.value === ')') depth--
          else if (t.type === 'punct' && t.value === ';' && depth <= 0) break
          else if (depth === 0 && t.type === 'word' && t.value === 'where' && where < 0) where = end
          else if (depth === 0 && t.type === 'word' && t.value === 'returning' && returning < 0) returning = end
          else if (depth === 0 && where < 0 && t.type === 'word' && ['from', 'using'].includes(t.value) && end > target.next) throw new CuratedSqlError(`${word.toUpperCase()} on ${target.schema}.${target.name} may not join other relations (FROM/USING)`)
        }
        // Bounded means the whole top-level WHERE is a conjunction of
        // `column = value` terms: no OR, NOT, subquery, function call or
        // tautology, so every term narrows the rows touched.
        // A value is a literal or a declared PL/pgSQL variable, never a column.
        const isValue = (t) => ['string', 'number'].includes(t?.type) || (t?.type === 'word' && variables.has(t.value))
        const isColumn = (t) => t?.type === 'ident' || (t?.type === 'word' && !WHERE_KEYWORDS.has(t.value))
        const clause = where < 0 ? [] : tokens.slice(where + 1, returning > where ? returning : end)
        let bounded = clause.length > 0, p = 0
        while (bounded && p < clause.length) {
          let column = p
          if (!isColumn(clause[p])) { bounded = false; break }
          if (clause[p + 1]?.type === 'punct' && clause[p + 1].value === '.') { if (!isColumn(clause[p + 2])) { bounded = false; break } column = p + 2; p += 2 }
          if (!(clause[p + 1]?.type === 'punct' && clause[p + 1].value === '=')) { bounded = false; break }
          let v = p + 2
          if (clause[v]?.type === 'punct' && clause[v].value === '-' && clause[v + 1]?.type === 'number') v++
          if (!isValue(clause[v]) || (clause[v].type === 'word' && clause[v].value === clause[column].value) || (clause[v + 1]?.type === 'punct' && ['.', '(', '::'].includes(clause[v + 1].value))) { bounded = false; break }
          p = v + 1
          if (p === clause.length) break
          if (!(clause[p]?.type === 'word' && clause[p].value === 'and')) { bounded = false; break }
          p++
          if (p === clause.length) bounded = false
        }
        if (!bounded) throw new CuratedSqlError(`${word.toUpperCase()} on ${target.schema}.${target.name} has no top-level WHERE clause that is a conjunction of column = value terms`)
      }
      writes.add(`table ${target.schema}.${target.name}`)
      dml++
    }
  }
  if (!dml) throw new CuratedSqlError('the migration writes no row')
  return { writes: [...writes].sort(), reads: [...reads].sort() }
}

// pg_cron (issue #4184, for #4190 / PR #4192): cron.schedule, schedule_in_database,
// unschedule and alter_job change scheduled database behaviour by writing rows in
// cron.job. They carry no statement-leading DDL, so the structural detectors saw
// nothing and refused the migration as "not structural". Each call is a write on
// the exact object `table cron.job`, found in top-level code and in DO bodies
// (string literals and comments are lexed out, so prose cannot trigger it).
const PG_CRON_WRITERS = new Set(['schedule', 'schedule_in_database', 'unschedule', 'alter_job'])
export function pgCronWrites(sql) {
  let units
  try { units = codeUnits(sql) } catch { return [] }
  for (const { tokens } of units) {
    for (let k = 0; k + 3 < tokens.length; k++) {
      const [a, dot, b, open] = [tokens[k], tokens[k + 1], tokens[k + 2], tokens[k + 3]]
      const name = (t) => t.type === 'word' ? t.value : t.type === 'ident' ? t.value.toLowerCase() : null
      if (name(a) === 'cron' && dot.type === 'punct' && dot.value === '.'
        && PG_CRON_WRITERS.has(name(b)) && open.type === 'punct' && open.value === '(') return ['table cron.job']
    }
  }
  return []
}
