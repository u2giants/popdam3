// Step 6 of plan_coordinator-queue-to-github-issues.md — create the issues.
//
// THIS IS THE FIRST IRREVERSIBLE STEP IN THE PLAN. It is gated on step 4 (the owner has
// read the scrub report and said yes) and step 4b (the plaintext-emailed credential is
// rotated, or its work item is held back).
//
//   node tools/migrate-intake-to-issues.mjs                 # DRY RUN. Creates nothing.
//   node tools/migrate-intake-to-issues.mjs --create        # actually creates issues
//   node tools/migrate-intake-to-issues.mjs --create --hold WI-16,WI-01
//
// Properties this script is required to have, and how each is met:
//
//   Reads the step-1 inventory, never the raw file
//       It imports buildInventory() and refuses to run if the inventory does not pass.
//       Nothing here re-parses COORDINATOR_INTAKE.md for classification.
//   Dry-run by default
//       `--create` is required. Without it nothing is created and the plan is printed.
//   Idempotent
//       Before creating, it lists every issue ONCE (`--state all`) and skips any work item
//       whose `(WI-nn)` marker already appears in an issue body, so a half-finished run is
//       safely re-runnable. It does NOT match on title over open issues: that duplicated on
//       a closed issue and on a renamed one.
//   It applies the approved redaction map, and refuses `--create` without one
//       Otherwise the scrub report and the owner gate change nothing and every flagged
//       value publishes on approval.
//   No heredocs
//       This is a PowerShell-first machine and heredoc recipes have silently failed here.
//       Bodies go to a temp file and are passed with `gh issue create --body-file`.
//   A temporary mapping file
//       Written to the OS temp directory, never into the repo. A permanent artefact for a
//       one-time event is the kind of leftover this repo accumulates. Summarise it in the
//       PR body instead.
//   Fails loudly and stops on the first error
//       No try/continue anywhere. A partial migration reporting success is the worst
//       available outcome.
//
// Node >= 20. Plain ESM, no dependencies. Requires `gh` authenticated.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory } from './intake-inventory.mjs';
import { loadIntake, migratingBlocks } from './intake-blocks.mjs';
import { scrub, buildRedactionMap } from './scrub-intake-for-publication.mjs';

const REPO = 'u2giants/shared-db';
const TYPE_LABEL = 'db-work';

/**
 * Hand-written outstanding work for the handover blocks (design decision D3).
 *
 * Found in review (Kimi K3, 2026-08-07): the first version emitted "fill this in when you
 * pick it up", which ships a stub and means WI-27 is born stale. There are only six work
 * items containing a handover block, so they are written by hand, and plan() REFUSES any
 * work item that contains a handover block and has no outstanding list.
 */
const OUTSTANDING = {
  'WI-27': [
    'Retire the one leftover worktree the 2026-08-07 branch-label sweep did not remove: `.claude/worktrees/csv-findings`, branch `docs/licensor-property-data-quality-findings-20260806`.',
    'Confirm it is clean and its branch is merged before removing it. Use the `cleanup-worktree` skill; never improvise `git worktree remove --force` or `git branch -D`.',
    'Backlog B11 applies: a paused agent is indistinguishable from a finished one, and a worktree\'s uncommitted work is the only copy.',
  ],
  'WI-60': [
    '`core.character` is EMPTY (0 rows) in production. Decide whether the characters/style-guides Phase 3 backfill populates it, and from which source.',
    'Record Laura\'s round-2 answers into the committed evidence set. The licensing question stream is CLOSED; there is no round 4.',
    'Fix the defect in the question generator that the intake block identifies, with negative-path tests proving it refuses (backlog B7 standard).',
  ],
  'WI-07': [
    'From the licensor/property taxonomy intake: **PR #408 is MERGED to `main` but is NOT promoted to production.** It must ship as one change with the `FR` removal work (`AGENTS.md` §6.5).',
    'The unmatched ColdLion property codes and the broken PLM sync described in that intake block are still open, and are inputs to this work item.',
  ],
  'WI-61': [
    'Phase B of `plan_dispatch-collision-hardening.md` starts at **step 3a, not 3b**. 3a is the historical-noise gate; skipping it trades a false clear for alarm fatigue on a required check.',
    '⚠️ **Four DDL tests are landed marked `node --test` `todo` and are genuinely RED.** Step 3b must delete the `TODO_UNTIL_STEP_3B` marker from all four, or the Phase A fix is unproven. They were landed as `todo` rather than `skip` deliberately: a skipped test is invisible, which is the silent-failure pattern this repo forbids.',
    '⚠️ **Cross-plan conflict:** that plan\'s §4 item 4 and §10 reference `scripts/check-backlog-queue-sync.mjs`, which step 7b of the intake-to-Issues plan deletes. Whichever plan reaches the conflict first updates the other in the same PR.',
  ],
  'WI-62': [
    'Finish steps 4 through 9 of `plan_coordinator-queue-to-github-issues.md`. Phase A (steps 1-3) is done and merged; the STATUS table in that file is authoritative.',
    'Three owner gates are outstanding: step 4 (approve the scrub report), step 4b (rotate the plaintext-emailed Cloud SQL credential, or hold that item back), and step 7a (name `Backlog / queue sync` for removal from branch protection).',
    'Decide the fate of the three untracked `.ai/reviews/glm-intake-queue-to-issues-plan-*.md` files. The plan cites them, so while they are untracked that citation is dead on every machine except `t16`. Note this repo already tracks 14 review files, so committing them is the conventional choice.',
  ],
  'WI-63': [
    'Albert runs "sync my dotfiles" on every machine other than `t16` and `al8960ofc`. Until then those machines run the OLD skills.',
    'This is the gate step 5 of the intake-to-Issues plan depends on, and it cannot be verified from a single machine. Verified in sync on `al8960ofc` 2026-08-07 by hash; `t16` reported in sync by its own session; `hetz`, `916` and `4837` are unverified.',
    'What is stale on an unsynced machine: the hardened `handoff-writer` (section 0, the owner-decisions section), and the `shared-db-orchestrator` correction that stops the dispatch-gate command exiting 2 on every run.',
  ],
};

// Work items that are blocked on something OTHER than the owner. Each carries the reason,
// because "blocked" with no cause is how the queue's own status fields became useless.
const BLOCKED = new Map([
  ['WI-13', 'The output is on a Desktop this session cannot reach.'],
  ['WI-31', 'The app-side half lives in C:/repos/dflow, a different repo.'],
  ['WI-41', 'Lives in u2giants/popdam3, a different repo, and needs its own owner.'],
  ['WI-55', 'The affected checkout is /worksp/shared-db on a different machine.'],
  ['WI-34', 'Explicitly on HOLD in its own block until the alert-diagnosis report lands.'],
  ['WI-42', 'Explicitly on hold; start only on a deliberate, dedicated dispatch.'],
]);

const gh = (args, opts = {}) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();

/** Work-item title without the WI-nn prefix. Issue titles should read like work, not like ids. */
export function issueTitle(workItem) {
  return workItem.replace(/^WI-\d+\s+/, '');
}

export function workItemId(workItem) {
  const m = workItem.match(/^(WI-\d+)/);
  if (!m) throw new Error(`Work item has no WI-nn id: "${workItem}"`);
  return m[1];
}

export function labelsFor(workItem) {
  const labels = [TYPE_LABEL];
  // Mechanical, not a hand-kept list: the inventory titles owner decisions with "OWNER:".
  if (/\bOWNER:/.test(workItem)) labels.push('needs-albert');
  if (BLOCKED.has(workItemId(workItem))) labels.push('blocked');
  return labels;
}

/**
 * Apply the approved redaction map to one block's text, by literal value match.
 *
 * By VALUE, not by character offset: an offset recorded against one revision of a
 * 5,450-line file silently redacts the wrong span once the file shifts by a line.
 */
function applyRedactions(text, redactions) {
  let out = text;
  for (const e of redactions) {
    if (e.action !== 'redact') continue;
    out = out.split(e.value).join(e.replacement ?? `[redacted: ${e.rule}]`);
  }
  return out;
}

function buildBody({ workItem, blocks, sha, redactions }) {
  const id = workItemId(workItem);
  const L = [];

  L.push(`> Migrated from \`COORDINATOR_INTAKE.md\` (${id}) as of commit \`${sha}\`.`);
  L.push(`> Source: ${blocks.map((b) => `\`## ${b.section}\` line ${b.line}`).join(', ')}.`);
  if (BLOCKED.has(id)) L.push(`>\n> **Blocked:** ${BLOCKED.get(id)}`);
  L.push('');

  const outstanding = OUTSTANDING[id];
  if (outstanding?.length) {
    L.push('## What is still outstanding');
    L.push('');
    for (const o of outstanding) L.push(`- ${o}`);
    L.push('');
  }

  // Decided PER BLOCK, not per issue. WI-07 mixes three REQUEST blocks with one 280-line
  // INTAKE QUEUE handover; `blocks.every(...)` sent the whole thing down the verbatim path
  // and pasted the handover in full, violating D3. (Found by Kimi K3, 2026-08-07.)
  const requests = blocks.filter((b) => !b.section.startsWith('INTAKE QUEUE'));
  const handovers = blocks.filter((b) => b.section.startsWith('INTAKE QUEUE'));

  if (requests.length) {
    L.push('## The request, verbatim');
    L.push('');
    L.push('A summary loses the reasoning, and in this queue the reasoning — the traps, the');
    L.push('"do NOT re-litigate this" lines — is the expensive part.');
    L.push('');
    for (const b of requests) {
      if (requests.length > 1) L.push(`### From \`## ${b.section}\`, line ${b.line}\n`);
      L.push(applyRedactions(b.text.trim(), redactions));
      L.push('');
    }
  }

  for (const b of handovers) {
    // Design decision D3: the issue POINTS at the briefing; the narrative stays a file.
    L.push('## The handover briefing stays a file');
    L.push('');
    L.push('It is not reproduced here: a ten-page briefing pasted into an issue is a ten-page');
    L.push('briefing nobody reads. Read it at its source.');
    L.push('');
    L.push('```');
    L.push(`git show ${sha}:COORDINATOR_INTAKE.md | sed -n '${b.line},${b.endLine ?? b.line + 200}p'`);
    L.push('```');
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('*This issue replaces a block in `COORDINATOR_INTAKE.md`. Do not re-file work into');
  L.push('that file — it is being retired. Open an issue instead.*');
  return L.join('\n');
}

/**
 * Load and validate the approved redaction map.
 *
 * Validation re-runs the scrub NOW and compares. A map approved against an older revision
 * of the file can be missing a value that has since appeared, and applying it would
 * publish that value while reporting success. (Kimi K3's change to fix 1, 2026-08-07.)
 */
function loadRedactionMap(path, freshMap) {
  const map = JSON.parse(readFileSync(path, 'utf8'));
  const unresolved = map.entries.filter((e) => e.action === 'UNRESOLVED');
  if (unresolved.length) {
    throw new Error(
      `The redaction map still has ${unresolved.length} UNRESOLVED values. A human must rule on each before anything is published:\n` +
        unresolved.map((e) => `    ${e.rule}  "${e.value.slice(0, 50)}"`).join('\n'),
    );
  }
  const approved = new Set(map.entries.map((e) => `${e.rule} ${e.value}`));
  const missing = freshMap.entries.filter((e) => !approved.has(`${e.rule} ${e.value}`));
  if (missing.length) {
    throw new Error(
      `The file has changed since the map was approved: ${missing.length} value(s) are flagged now but are not in the map. Re-run the scrub, get the additions ruled on, and re-approve:\n` +
        missing.map((e) => `    ${e.rule}  "${e.value.slice(0, 50)}"`).join('\n'),
    );
  }
  const bad = map.entries.filter((e) => !['redact', 'publish', 'hold-back'].includes(e.action));
  if (bad.length) throw new Error(`The redaction map has ${bad.length} entries with an unknown action.`);
  return map;
}

export async function plan({ hold = [], redactionMapPath = null, requireMap = false } = {}) {
  const inv = await buildInventory();
  if (inv.errors.length) {
    const e = new Error('The step-1 inventory does not pass. Fix it first — migrating from a broken inventory is exactly the silent loss this plan exists to prevent.');
    e.inventoryErrors = inv.errors;
    throw e;
  }

  const parsed = await loadIntake();
  const byLine = new Map(migratingBlocks(parsed).map((b) => [b.line, b]));

  // The SHA the bodies cite must be the revision actually parsed. Citing remote `main`
  // while parsing a stale local tree produces bodies whose "as of commit" line points at
  // text that is not what was published. (Found by Kimi K3, 2026-08-07.)
  const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (requireMap) {
    // Only enforced for a real run. A dry run from a feature branch is legitimate and
    // must not be blocked; publishing from one is not.
    const remoteSha = gh(['api', `repos/${REPO}/commits/main`, '--jq', '.sha']).trim();
    if (localSha !== remoteSha) {
      throw new Error(`Local HEAD (${localSha.slice(0, 7)}) is not origin/main (${remoteSha.slice(0, 7)}). Pull first — the issue bodies must cite the revision they were built from, and readers must be able to look that revision up.`);
    }
    if (execFileSync('git', ['status', '--porcelain', 'COORDINATOR_INTAKE.md'], { encoding: 'utf8' }).trim()) {
      throw new Error('COORDINATOR_INTAKE.md has uncommitted changes. Migrating from an unpushed edit publishes text nobody can look up.');
    }
  }
  const sha = localSha;

  // The apply step. Without a validated map, --create refuses: the scrub and the owner
  // gate are otherwise ceremony, which is the defect this whole review round found.
  const freshScrub = await scrub();
  const freshMap = buildRedactionMap(freshScrub);
  let redactions = [];
  let holdBackItems = new Set();
  if (redactionMapPath) {
    const map = loadRedactionMap(redactionMapPath, freshMap);
    redactions = map.entries;
    for (const e of map.entries) {
      if (e.action === 'hold-back') for (const wi of e.workItems) holdBackItems.add(workItemId(wi));
    }
  } else if (requireMap) {
    throw new Error(
      '--create requires --redactions <path to the APPROVED map>.\n' +
        '  Produce it with:  node tools/scrub-intake-for-publication.mjs --emit-redactions <tempfile>\n' +
        '  Then a human rules on every UNRESOLVED value, and the owner approves the result (step 4).\n' +
        '  Without this the scrub report and the owner gate change nothing and every flagged value publishes.',
    );
  }

  const held = new Set(hold);
  const items = [];
  for (const wi of inv.workItems) {
    const id = workItemId(wi.title);
    const blocks = wi.blockLines.map((line) => {
      const b = byLine.get(line);
      if (!b) throw new Error(`Inventory references line ${line} but no block is there. Re-run the inventory.`);
      return { line, endLine: b.endLine, section: b.section, text: b.body };
    });
    // `some`, not `every`. With `every`, a MIXED work item like WI-07 — three REQUEST
    // blocks plus one handover — escaped the check entirely and could ship a handover
    // pointer with no outstanding list. (Found by Kimi K3 on re-review, 2026-08-07.)
    const hasHandover = blocks.some((b) => b.section.startsWith('INTAKE QUEUE'));
    if (hasHandover && !OUTSTANDING[id]?.length) {
      throw new Error(`${id} contains a handover block and has no outstanding-work list. A handover pointer with no outstanding list is a stub. Add one to OUTSTANDING in this file.`);
    }
    items.push({
      id,
      workItem: wi.title,
      title: issueTitle(wi.title),
      labels: labelsFor(wi.title),
      blockLines: wi.blockLines,
      held: held.has(id) || holdBackItems.has(id),
      heldReason: holdBackItems.has(id) ? 'redaction map says hold-back' : held.has(id) ? '--hold' : null,
      body: buildBody({ workItem: wi.title, blocks, sha, redactions }),
    });
  }
  return { inv, sha, items, freshMap };
}

/**
 * Which work items already have an issue.
 *
 * Keyed on the `(WI-nn)` marker in the body's first line, over `--state all`. The first
 * version matched on TITLE over `--state open`, which duplicates on two paths: close a
 * migrated issue and a re-run recreates it, and rename a title and a re-run creates a
 * second copy. (Found by Kimi K3, 2026-08-07.)
 *
 * Matching happens LOCALLY on a fetched list rather than through `gh issue list --search`:
 * the search index is eventually consistent and also matches comment text, so a freshly
 * created issue can be missed while an unrelated comment mentioning `WI-12` produces a
 * false skip. A false skip silently drops a work item, which is the worst outcome here.
 *
 * ONE call, not one per item. `gh issue list` works correctly in this repo — re-verified
 * 2026-08-07 against marker issue #491. The claim at `COORDINATOR_INTAKE.md:3333` that it
 * returns empty is false; do not reinstate the REST workaround it prescribes.
 */
function existingByWorkItem() {
  const LIMIT = 800;
  const raw = gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', String(LIMIT), '--json', 'number,title,body,state']);
  const all = JSON.parse(raw);
  // Silent truncation at the limit would make the idempotency check miss existing issues
  // and create duplicates, reporting success. Fail instead. (Kimi K3's nit, 2026-08-07.)
  if (all.length >= LIMIT) {
    throw new Error(`gh returned ${all.length} issues, at or above the --limit of ${LIMIT}. The list may be truncated, which would silently defeat the duplicate check. Raise the limit and re-run.`);
  }
  const map = new Map();
  for (const i of all) {
    const m = (i.body ?? '').split('\n', 1)[0].match(/\((WI-\d+)\)/);
    if (m) map.set(m[1], { number: i.number, state: i.state, title: i.title });
  }
  return map;
}

function ensureLabels(labels, create) {
  const existing = new Set(
    JSON.parse(gh(['label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name'])).map((l) => l.name),
  );
  const spec = {
    'db-work': ['1D76DB', 'A unit of work on the shared database or this repo. Migrated from the coordinator queue.'],
    'needs-albert': ['D93F0B', 'Blocked on an owner decision. Do not act without a fresh answer in the current chat.'],
    blocked: ['B60205', 'Blocked on something other than the owner: another item, an upstream system, or an unreachable machine.'],
  };
  const missing = [...labels].filter((l) => !existing.has(l));
  if (!missing.length) return [];
  if (!create) return missing;
  for (const name of missing) {
    const [colour, description] = spec[name] ?? ['CCCCCC', ''];
    gh(['label', 'create', name, '--repo', REPO, '--color', colour, '--description', description]);
  }
  return missing;
}

async function main() {
  const argv = process.argv.slice(2);
  const create = argv.includes('--create');
  const holdArg = argv[argv.indexOf('--hold') + 1];
  const hold = argv.includes('--hold') && holdArg ? holdArg.split(',').map((s) => s.trim()) : [];

  const ri = argv.indexOf('--redactions');
  const redactionMapPath = ri !== -1 ? argv[ri + 1] : null;

  const { inv, sha, items, freshMap } = await plan({ hold, redactionMapPath, requireMap: create });
  const live = items.filter((i) => !i.held);
  const allLabels = new Set(items.flatMap((i) => i.labels));

  console.log(`Source: COORDINATOR_INTAKE.md @ ${sha.slice(0, 7)}, ${inv.source.totalLines} lines`);
  console.log(`Inventory: ${inv.counts.MIGRATE} MIGRATE + ${inv.counts.CLOSED} CLOSED + ${inv.counts.NOISE} NOISE = ${inv.counts.total}`);
  console.log(`Scrub: ${freshMap.entries.length} distinct flagged values, ${freshMap.unresolved} unresolved`);
  console.log(`Redaction map: ${redactionMapPath ?? 'NONE (dry run only)'}`);
  console.log(`Work items: ${items.length}   to create: ${live.length}   held back: ${items.length - live.length}`);
  console.log('');

  const missingLabels = ensureLabels(allLabels, create);
  if (missingLabels.length && !create) {
    console.log(`Labels that would be created: ${missingLabels.join(', ')}`);
    console.log('');
  }

  const existing = existingByWorkItem();
  const mapping = [];
  let created = 0;
  let skipped = 0;

  const tmp = mkdtempSync(join(tmpdir(), 'intake-migrate-'));
  try {
    for (const item of items) {
      if (item.held) {
        console.log(`HELD    ${item.id}  (${item.heldReason})  ${item.title}`);
        mapping.push({ ...item, body: undefined, issue: null, action: 'held' });
        continue;
      }
      const already = existing.get(item.id);
      if (already) {
        console.log(`SKIP    ${item.id}  #${already.number} exists (${already.state})  ${item.title}`);
        mapping.push({ ...item, body: undefined, issue: already.number, action: 'skipped' });
        skipped++;
        continue;
      }
      if (!create) {
        console.log(`WOULD   ${item.id}  [${item.labels.join(' ')}]  ${item.title}`);
        mapping.push({ ...item, body: undefined, issue: null, action: 'would-create' });
        continue;
      }
      const bodyFile = join(tmp, `${item.id}.md`);
      writeFileSync(bodyFile, item.body, 'utf8');
      // No try/catch. If gh fails, this throws and the run stops, by design.
      const url = gh(['issue', 'create', '--repo', REPO, '--title', item.title, '--body-file', bodyFile,
        ...item.labels.flatMap((l) => ['--label', l])]);
      const number = Number(url.split('/').pop());
      if (!Number.isInteger(number)) throw new Error(`Could not read an issue number out of: ${url}`);
      console.log(`CREATED ${item.id}  #${number}  ${item.title}`);
      mapping.push({ ...item, body: undefined, issue: number, action: 'created' });
      created++;
    }

    const mappingFile = join(tmpdir(), `intake-issue-mapping-${sha.slice(0, 7)}.json`);
    writeFileSync(mappingFile, JSON.stringify({ sha, counts: inv.counts, mapping }, null, 2), 'utf8');
    console.log(`\nMapping written to ${mappingFile}`);
    console.log('It is TEMPORARY. Summarise it in the PR body; do not commit it.');

    const blanks = mapping.filter((m) => m.action === 'created' && !m.issue);
    if (blanks.length) throw new Error(`${blanks.length} created rows have no issue number. The mapping is not trustworthy.`);

    console.log(`\n${create ? 'Created' : 'Would create'} ${create ? created : items.filter((i) => !i.held && !existing.has(i.id)).length}, skipped ${skipped}, held ${items.length - live.length}.`);
    if (!create) console.log('\nDRY RUN — nothing was created. Re-run with --create once steps 4 and 4b are cleared.');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    await main();
  } catch (err) {
    console.error(`\nSTOPPED: ${err.message}`);
    for (const e of err.inventoryErrors ?? []) console.error('  - ' + e);
    process.exit(1);
  }
}
