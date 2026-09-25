// WHICH PULL REQUESTS ARE "DOCUMENTS ONLY" (issue #2102, owner decision 2026-09-02).
//
// A pull request whose changed files are all prose documents still runs every
// automated check and still merges through the guarded merge lane. What it no
// longer does is consume a slot from the small external database-reviewer pool
// that exists for migrations. PR #2034 -- a two-file documentation change --
// spent two reviewer draws, two dead-reviewer replacements and three full review
// runs; PR #2070 was the same shape. That is pool capacity migrations needed.
//
// Review is NOT removed. The review of PR #2034 caught a real customer order
// number heading into this PUBLIC repository, so the content risk is real. What
// changes is only WHICH pool answers for it: the documents-only lane is answered
// by the automated checks and the guarded merge, not by an external reviewer
// draw.
//
// RULEBOOK FILES ARE NOT DOCUMENTS HERE, and that is the whole safety of this
// module. `AGENTS.md`, anything under `.claude/skills/` or `skills/`, and
// agent command files are prose by extension but they are INSTRUCTIONS TO AGENTS:
// a bad edit to one of them is as dangerous as a bad migration, because every
// later session obeys it. They keep the full treatment. Standalone plan_*.md
// proposals are documents; plans inside protected instruction directories are not.
//
// Everything here is deterministic and path-based. It never reads file content,
// never calls GitHub, and never guesses: anything it does not positively
// recognise as a document makes the whole change non-exempt. An empty or
// unreadable file list is NOT documents-only -- "we could not tell" must cost a
// review, never grant an exemption.

// Rulebook exclusions, listed explicitly rather than derived, so a reader can
// check the list against the rule without running anything.
const RULEBOOK_BASENAMES = new Set(['agents.md', 'claude.md'])
const RULEBOOK_DIRECTORY_SEGMENTS = ['.claude/skills/', 'skills/', '.claude/agents/', '.claude/commands/']

// Prose document extensions. Deliberately short: a new extension is a decision,
// not an oversight, and the safe default for an unlisted one is "not a document".
const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.rst'])

function normalize(path) {
  return String(path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

// A rulebook path tells agents how to behave. `.claude/skills/x/SKILL.md` and a
// top-level `skills/...` file both qualify wherever they sit in the tree, because
// a nested copy instructs just as loudly as a top-level one.
export function isRulebookPath(path) {
  const normalized = normalize(path)
  if (!normalized) return true
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (RULEBOOK_BASENAMES.has(basename)) return true
  const probe = `/${normalized}`
  return RULEBOOK_DIRECTORY_SEGMENTS.some((segment) => probe.includes(`/${segment}`))
}

// A prose document: recognised extension, and not a rulebook file.
export function isDocumentPath(path) {
  const normalized = normalize(path)
  if (!normalized) return false
  if (normalized.endsWith('/')) return false
  if (isRulebookPath(normalized)) return false
  const dot = normalized.lastIndexOf('.')
  const slash = normalized.lastIndexOf('/')
  if (dot <= slash) return false
  return DOCUMENT_EXTENSIONS.has(normalized.slice(dot))
}

// The required-status lane has a slightly wider, separately named policy than
// the scarce database-reviewer exemption. Plans are prose delivery records and
// may use the lightweight required-status path (#2715), but they remain
// rulebooks for reviewer assignment under #2102. Executable agent instructions
// (AGENTS/CLAUDE and skill/agent/command directories) are never lightweight.
export function isLightweightMergeDocumentPath(path) {
  const normalized = normalize(path)
  if (!normalized || normalized.endsWith('/')) return false
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (RULEBOOK_BASENAMES.has(basename)) return false
  const probe = `/${normalized}`
  if (RULEBOOK_DIRECTORY_SEGMENTS.some((segment) => probe.includes(`/${segment}`))) return false
  const dot = normalized.lastIndexOf('.')
  const slash = normalized.lastIndexOf('/')
  return dot > slash && DOCUMENT_EXTENSIONS.has(normalized.slice(dot))
}

const DECLARATIVE_POINTER_BASENAMES = new Set(['agents.md', 'claude.md', 'task-router.md'])
const LOCAL_MARKDOWN_LINK = /\[([^\]\r\n]+)\]\(([^)\r\n]+\.md(?:#[^)\r\n]*)?)\)/gi

function isInstructionBearingPath(path) {
  const normalized = normalize(path)
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (DECLARATIVE_POINTER_BASENAMES.has(basename)) return true
  const probe = `/${normalized}`
  const dot=normalized.lastIndexOf('.'),slash=normalized.lastIndexOf('/')
  const proseExtension=dot>slash&&DOCUMENT_EXTENSIONS.has(normalized.slice(dot))
  return proseExtension&&RULEBOOK_DIRECTORY_SEGMENTS.some((segment) => probe.includes(`/${segment}`))
}

// A path-only Markdown test cannot safely distinguish a routing pointer from a
// new operating instruction. For instruction-bearing files, inspect every
// changed hunk line. The accepted grammar is intentionally small: a list/table
// row containing only local Markdown links whose labels literally name their
// target files. This is structural, not a verb denylist: arbitrary prose cannot
// become trusted by choosing a synonym the classifier forgot. Missing or
// truncated patches are not pointers.
export function isDeclarativePointerPatch(patch, additions, deletions, changes) {
  if (typeof patch !== 'string' || !patch.trim() || patch.includes('\\ No newline at end of file')) return false
  if(!Number.isInteger(additions)||additions<0||!Number.isInteger(deletions)||deletions<0||changes!==additions+deletions)return false
  const lines=patch.replace(/\r?\n$/,'').split(/\r?\n/)
  let hunk=null,seenAdditions=0,seenDeletions=0
  const closeHunk=()=>{
    if(!hunk)return true
    return hunk.oldSeen===hunk.oldCount&&hunk.newSeen===hunk.newCount
  }
  for(const line of lines){
    const header=line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/)
    if(header){
      if(!closeHunk())return false
      hunk={oldCount:Number(header[1]??1),newCount:Number(header[2]??1),oldSeen:0,newSeen:0}
      continue
    }
    if(!hunk)return false
    if(line.startsWith('+')){hunk.newSeen++;seenAdditions++}
    else if(line.startsWith('-')){hunk.oldSeen++;seenDeletions++}
    else if(line.startsWith(' ')){hunk.oldSeen++;hunk.newSeen++}
    else return false
  }
  if(!closeHunk()||seenAdditions!==additions||seenDeletions!==deletions)return false
  const changed = lines.filter((line) => /^[+-]/.test(line)).map((line) => line.slice(1))
  if (!changed.length) return false
  return changed.every((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    if (!/^(?:[-*+]\s+|\|)/.test(trimmed)) return false
    const links = [...trimmed.matchAll(LOCAL_MARKDOWN_LINK)]
    if (!links.length) return false
    const literalTargets=links.every((match)=>{
      const label=match[1].trim().replace(/^`|`$/g,'').replace(/\\/g,'/').toLowerCase()
      const rawTarget=match[2].split('#')[0]
      if(!rawTarget||/%|\\|^\/|\/\/|(?:^|\/)\.\.(?:\/|$)|^[a-z][a-z0-9+.-]*:/i.test(rawTarget))return false
      const target=rawTarget.toLowerCase()
      const basename=target.slice(target.lastIndexOf('/')+1)
      return label===target||label===basename
    })
    if(!literalTargets)return false
    const remainder=trimmed.replace(LOCAL_MARKDOWN_LINK,'').replace(/^[-*+]\s+/,'').replace(/\|/g,'').trim()
    return remainder===''
  })
}

export function classifyLightweightMergePullRequestFiles(rows) {
  if (!Array.isArray(rows) || !rows.length) return { documentsOnly: false, reason: 'the pull request file list was empty or unreadable' }
  const paths = changedPathsFromPullRequestFiles(rows)
  const pathVerdict = classifyLightweightMergePaths(paths)
  if (!pathVerdict.documentsOnly) return pathVerdict
  for (const row of rows) {
    const current = normalize(row?.filename)
    const previous = normalize(row?.previous_filename)
    if (previous && (isInstructionBearingPath(current) || isInstructionBearingPath(previous))) {
      return { documentsOnly: false, reason: `an instruction-bearing rename always retains the guarded path: ${previous} -> ${current}` }
    }
    for (const path of [current, previous].filter(Boolean)) {
      if (isInstructionBearingPath(path) && !isDeclarativePointerPatch(row?.patch,row?.additions,row?.deletions,row?.changes)) {
        return { documentsOnly: false, reason: `instruction-bearing file does not contain only declarative routing pointers: ${path}` }
      }
    }
  }
  return pathVerdict
}

export function classifyLightweightMergePaths(paths) {
  if (!Array.isArray(paths)) return { documentsOnly: false, reason: 'the changed-file list could not be read', documents: [], other: [] }
  if (paths.some((path) => typeof path !== 'string' || !normalize(path))) {
    return { documentsOnly: false, reason: 'the changed-file list contains an unreadable entry', documents: [], other: [] }
  }
  if (!paths.length) return { documentsOnly: false, reason: 'no changed files were reported; an unknown change is never documents-only', documents: [], other: [] }
  const documents = paths.filter((path) => isLightweightMergeDocumentPath(path) || isInstructionBearingPath(path))
  const other = paths.filter((path) => !isLightweightMergeDocumentPath(path) && !isInstructionBearingPath(path))
  if (other.length) return { documentsOnly: false, reason: `non-lightweight file(s) changed: ${other.join(', ')}`, documents, other }
  return { documentsOnly: true, reason: `all ${documents.length} changed file(s) are lightweight prose documents`, documents, other }
}

// The classification the merge gate and the reviewer draw both use. `paths` must
// be the COMPLETE changed-file list for the head being merged, including the
// previous name of every rename -- a file renamed out of `supabase/migrations/`
// into a `.md` is a migration change wearing a document's name.
export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths)) return { documentsOnly: false, reason: 'the changed-file list could not be read', documents: [], rulebook: [], other: [] }
  if (paths.some((path) => typeof path !== 'string' || !normalize(path))) {
    return { documentsOnly: false, reason: 'the changed-file list contains an unreadable entry', documents: [], rulebook: [], other: [] }
  }
  if (!paths.length) return { documentsOnly: false, reason: 'no changed files were reported; an unknown change is never documents-only', documents: [], rulebook: [], other: [] }

  const rulebook = paths.filter((path) => isRulebookPath(path))
  const documents = paths.filter((path) => isDocumentPath(path))
  const other = paths.filter((path) => !isRulebookPath(path) && !isDocumentPath(path))
  if (rulebook.length) return { documentsOnly: false, reason: `rulebook file(s) changed, which are never documents for this purpose: ${rulebook.join(', ')}`, documents, rulebook, other }
  if (other.length) return { documentsOnly: false, reason: `non-document file(s) changed: ${other.join(', ')}`, documents, rulebook, other }
  return { documentsOnly: true, reason: `all ${documents.length} changed file(s) are prose documents`, documents, rulebook, other }
}

export function isDocumentsOnlyChange(paths) {
  return classifyChangedPaths(paths).documentsOnly
}

// GitHub's `pulls/{n}/files` rows, reduced to the path list this module judges.
// Both `filename` and `previous_filename` are taken: a rename must be judged on
// where the bytes came from as well as where they landed. A row that does not
// carry a usable filename yields an unreadable marker, which fails the whole
// classification closed rather than silently shrinking the list.
export function changedPathsFromPullRequestFiles(rows) {
  if (!Array.isArray(rows)) return null
  return rows.flatMap((row) => {
    const filename = row && typeof row === 'object' ? row.filename : undefined
    if (typeof filename !== 'string' || !filename.trim()) return [null]
    const previous = row.previous_filename
    return typeof previous === 'string' && previous.trim() ? [filename, previous] : [filename]
  })
}

// PURE-PROSE FAST CI ROUTE (issue #3383).
//
// A prose-only pull request may use a trusted fast CI path that skips the
// engineering suites. The proof is an EXACT base/head Git inventory including
// file modes: every changed path must be a non-rulebook prose document, and
// every mode on both sides of the change must be the regular non-executable
// blob mode. Code, migrations, executable agent instructions, symlinks and
// executable modes all retain the full engineering path.
//
// Fail closed, always. An empty inventory, an unreadable record, an unknown
// status, an unknown mode, a truncated parse -- none of these are "probably
// fine". They all refuse the fast route and force the full path. The safe
// default for anything this classifier does not positively recognise as pure
// prose is "run the engineering suites".

// The ONLY mode a pure-prose change may carry. 100644 is a regular
// non-executable blob. 100755 (executable), 120000 (symlink) and 160000
// (submodule) all force the full path; so does anything unrecognised.
const PROSE_FILE_MODE = '100644'

// Git raw-diff status letters this classifier understands. A rename or copy
// reports as R100 / C75 etc; the score is ignored and only the letter matters.
const KNOWN_STATUS_LETTERS = new Set(['M', 'A', 'D', 'R', 'C', 'T'])

function proseInventoryFailure (reason) {
  return { pureProse: false, reason, documents: [], other: [] }
}

// One inventory record: the shape `parseGitRawInventory` produces and
// `classifyProseGitInventory` judges. `srcPath` is null on an add, `dstPath`
// is null on a delete; on a rename both are set and must both be prose.
function inventoryRecordProblem (entry) {
  if (!entry || typeof entry !== 'object') return 'the inventory contains an unreadable record'
  const { status, srcMode, dstMode, srcPath, dstPath } = entry
  if (typeof status !== 'string' || !/^[MARCDT]/.test(status)) return `the inventory record has an unknown status: ${String(status)}`
  if (!KNOWN_STATUS_LETTERS.has(status[0])) return `the inventory record has an unknown status: ${status}`
  for (const [label, mode] of [['source', srcMode], ['destination', dstMode]]) {
    if (mode === null || mode === undefined) continue
    if (typeof mode !== 'string' || !/^[0-7]{6}$/.test(mode)) return `the inventory record has an unreadable ${label} mode: ${String(mode)}`
    if (mode !== PROSE_FILE_MODE) return `the ${label} mode ${mode} is not the regular non-executable prose mode ${PROSE_FILE_MODE}`
  }
  for (const [label, path] of [['source', srcPath], ['destination', dstPath]]) {
    if (path === null || path === undefined) continue
    if (typeof path !== 'string' || !normalize(path)) return `the inventory record has an unreadable ${label} path`
    if (path.endsWith('/')) return `the inventory record has a directory ${label} path: ${path}`
    if (isRulebookPath(path)) return `instruction-bearing file(s) always retain the full path: ${path}`
    if (!isDocumentPath(path)) return `non-prose file(s) always retain the full path: ${path}`
  }
  if ((srcPath ?? dstPath) === null) return 'the inventory record has neither a source nor a destination path'
  return null
}

// Judge a complete base/head inventory. `entries` must be the FULL change list.
// Anything that is not positively pure prose refuses the fast route.
export function classifyProseGitInventory (entries) {
  if (!Array.isArray(entries)) return proseInventoryFailure('the change inventory could not be read')
  if (!entries.length) return proseInventoryFailure('the change inventory was empty; an unknown change is never pure prose')
  const documents = []
  const other = []
  for (const entry of entries) {
    const problem = inventoryRecordProblem(entry)
    if (problem) {
      for (const path of [entry?.srcPath, entry?.dstPath]) {
        if (typeof path === 'string' && path) documents.push(path)
        else other.push(String(path ?? entry?.status ?? 'unreadable'))
      }
      return proseInventoryFailure(problem)
    }
    for (const path of [entry.srcPath, entry.dstPath]) {
      if (typeof path === 'string' && path && !documents.includes(path)) documents.push(path)
    }
  }
  return {
    pureProse: true,
    reason: `all ${documents.length} inventory path(s) are non-rulebook prose documents at mode ${PROSE_FILE_MODE}`,
    documents,
    other,
  }
}

// Parse `git diff --raw -z` output into inventory records. The NUL form is
// required: a path containing a space or a quote would otherwise be ambiguous.
// Any record that does not parse cleanly makes the WHOLE inventory null, and a
// null inventory is never pure prose.
//
// Record shape (NUL-separated):
//   :<srcMode> <dstMode> <srcSha> <dstSha> <status>\0<path>\0
//   :<srcMode> <dstMode> <srcSha> <dstSha> R100\0<srcPath>\0<dstPath>\0
export function parseGitRawInventory (raw) {
  if (typeof raw !== 'string' || !raw.length) return null
  const parts = raw.split('\0')
  // `git diff --raw -z` ends with a trailing NUL, so the final part is empty.
  if (parts[parts.length - 1] !== '') return null
  parts.pop()
  const entries = []
  let index = 0
  while (index < parts.length) {
    const header = parts[index]
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([MARCDT][0-9]*)$/.exec(header ?? '')
    if (!match) return null
    const [, srcMode, dstMode, , , status] = match
    const letter = status[0]
    const needsTwoPaths = letter === 'R' || letter === 'C'
    if (needsTwoPaths) {
      if (index + 2 >= parts.length) return null
      const srcPath = parts[index + 1]
      const dstPath = parts[index + 2]
      if (typeof srcPath !== 'string' || !srcPath || typeof dstPath !== 'string' || !dstPath) return null
      entries.push({ status, srcMode, dstMode, srcPath, dstPath })
      index += 3
    } else if (letter === 'A') {
      if (index + 1 >= parts.length) return null
      const path = parts[index + 1]
      if (typeof path !== 'string' || !path) return null
      entries.push({ status, srcMode: null, dstMode, srcPath: null, dstPath: path })
      index += 2
    } else if (letter === 'D') {
      if (index + 1 >= parts.length) return null
      const path = parts[index + 1]
      if (typeof path !== 'string' || !path) return null
      entries.push({ status, srcMode, dstMode: null, srcPath: path, dstPath: null })
      index += 2
    } else {
      if (index + 1 >= parts.length) return null
      const path = parts[index + 1]
      if (typeof path !== 'string' || !path) return null
      entries.push({ status, srcMode, dstMode, srcPath: path, dstPath: path })
      index += 2
    }
  }
  return entries
}
