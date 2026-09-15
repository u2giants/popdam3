// Issue #2437: guard the ANALYSIS path, not just the migration path.
//
// 1. checkProposalBody: an issue carrying the `destructive-proposal` label must
//    carry every checklist heading from .github/ISSUE_TEMPLATE/destructive-proposal.md
//    in its BODY, each with real content (the queue reads bodies, not comments).
// 2. findDestructiveSql: added SQL anywhere in a pull request (outside migrations
//    and the disposable test fixtures, which have their own guards) may not
//    introduce DROP / TRUNCATE / VACUUM FULL / unqualified DELETE unless the same
//    file's added lines name the tracking issue with `-- destructive-proposal: #<n>`.
// 3. findMarkedDestructiveSql + checkMarkerIssue: the marker is only a claim. CI
//    must prove every named issue exists, is an issue, carries the label and
//    passes checkProposalBody, or the file fails as if unmarked (GLM review of
//    PR #2895: an unverified marker silenced the whole file).
//
// DROP covers every object whose loss removes data, code, access or a guarantee,
// not just storage: functions and procedures break callers; triggers, policies,
// constraints and rules silently stop enforcing; roles, types, domains,
// extensions and sequences cascade; DROP OWNED BY drops everything a role owns.

export const PROPOSAL_LABEL = 'destructive-proposal'

export const REQUIRED_HEADINGS = [
  'Proposed action',
  'Observation window',
  'Positive control',
  'Second independent source',
  'Evidence class',
  'Earliest action date',
]

function stripHtmlComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '')
}

export function checkProposalBody(body) {
  const text = stripHtmlComments(body).replace(/\r\n/g, '\n')
  const sections = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (heading) {
      current = heading[1].trim().toLowerCase()
      if (!sections.has(current)) sections.set(current, '')
      continue
    }
    if (current !== null) sections.set(current, sections.get(current) + line + '\n')
  }
  const absent = []
  const empty = []
  for (const name of REQUIRED_HEADINGS) {
    const key = name.toLowerCase()
    if (!sections.has(key)) absent.push(name)
    else if (!sections.get(key).trim()) empty.push(name)
  }
  return { ok: absent.length === 0 && empty.length === 0, absent, empty }
}

export function isGuardedSqlPath(path) {
  const p = String(path).replace(/\\/g, '/')
  if (!p.toLowerCase().endsWith('.sql')) return false
  if (p.startsWith('supabase/migrations/')) return false
  if (p.startsWith('supabase/tests/')) return false
  return true
}

const DROP_OBJECTS = [
  'table', 'schema', 'index', 'materialized\\s+view', 'view', 'column', 'database',
  'function', 'procedure', 'routine', 'aggregate', 'event\\s+trigger', 'trigger',
  'policy', 'constraint', 'rule', 'role', 'user', 'group', 'type', 'domain',
  'extension', 'sequence', 'owned\\s+by', 'publication', 'subscription',
  'foreign\\s+table', 'server',
]

const DESTRUCTIVE_PATTERNS = [
  { kind: 'DROP', re: new RegExp(`\\bdrop\\s+(?:${DROP_OBJECTS.join('|')})\\b`, 'i') },
  { kind: 'TRUNCATE', re: /\btruncate\b/i },
  { kind: 'VACUUM FULL', re: /\bvacuum\s*(?:\(\s*[^)]*\bfull\b[^)]*\)|full\b)/i },
]

const MARKER = /--\s*destructive-proposal:\s*#(\d+)/gi

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''")
}

export function classifyStatement(statement) {
  const s = statement.trim()
  if (!s) return []
  const kinds = DESTRUCTIVE_PATTERNS.filter(({ re }) => re.test(s)).map(({ kind }) => kind)
  if (/\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s)) kinds.push('DELETE without WHERE')
  return kinds
}

// Parses `git diff --unified=0` output into guarded files that add destructive
// statements, with the issue numbers their markers name.
function scanDiff(diffText) {
  const files = new Map()
  let current = null
  for (const line of String(diffText ?? '').split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (header) { current = header[1]; files.set(current, []); continue }
    if (current === null || line.startsWith('+++')) continue
    if (line.startsWith('+')) files.get(current).push(line.slice(1))
  }
  const results = []
  for (const [file, added] of files) {
    if (!isGuardedSqlPath(file) || added.length === 0) continue
    const raw = added.join('\n')
    const issues = [...new Set([...raw.matchAll(MARKER)].map((m) => Number(m[1])))]
    const kinds = new Set()
    for (const statement of stripSqlComments(raw).split(';')) for (const k of classifyStatement(statement)) kinds.add(k)
    if (kinds.size) results.push({ file, kinds: [...kinds], issues })
  }
  return results
}

// Guarded files adding a destructive statement with no marker at all.
export function findDestructiveSql(diffText) {
  return scanDiff(diffText).filter((r) => r.issues.length === 0).map(({ file, kinds }) => ({ file, kinds }))
}

// Guarded files whose destructive statements a marker excused; each named issue
// still has to pass checkMarkerIssue.
export function findMarkedDestructiveSql(diffText) {
  return scanDiff(diffText).filter((r) => r.issues.length > 0)
}

// issue: { labels: [name], body, isPullRequest } or null when it does not exist.
// Returns null when the issue may excuse destructive SQL, else the reason it may not.
export function checkMarkerIssue(issue) {
  if (!issue) return 'does not exist'
  if (issue.isPullRequest) return 'is a pull request, not an issue'
  if (!(issue.labels ?? []).map((l) => String(l).toLowerCase()).includes(PROPOSAL_LABEL)) return `is not labeled ${PROPOSAL_LABEL}`
  const r = checkProposalBody(issue.body)
  if (!r.ok) return `has an incomplete checklist (absent: ${r.absent.join(', ') || 'none'}; empty: ${r.empty.join(', ') || 'none'})`
  return null
}
