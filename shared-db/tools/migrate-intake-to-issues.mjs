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
//       Before creating, it lists EVERY existing open issue once and skips any work item
//       whose exact title is already present, so a half-finished run is safely re-runnable.
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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory } from './intake-inventory.mjs';
import { loadIntake, migratingBlocks } from './intake-blocks.mjs';

const REPO = 'u2giants/shared-db';
const TYPE_LABEL = 'db-work';

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

function buildBody({ workItem, blocks, sha }) {
  const id = workItemId(workItem);
  const isHandover = blocks.every((b) => b.section.startsWith('INTAKE QUEUE'));
  const L = [];

  L.push(`> Migrated from \`COORDINATOR_INTAKE.md\` (${id}) as of commit \`${sha}\`.`);
  L.push(`> Source: ${blocks.map((b) => `\`## ${b.section}\` line ${b.line}`).join(', ')}.`);
  if (BLOCKED.has(id)) L.push(`>\n> **Blocked:** ${BLOCKED.get(id)}`);
  L.push('');

  if (isHandover) {
    // Design decision D3: the issue POINTS at the briefing; the narrative stays a file.
    L.push('This tracks a handover. **The full briefing stays where it is** — it is not');
    L.push('reproduced here, because a ten-page briefing pasted into an issue is a ten-page');
    L.push('briefing nobody reads.');
    L.push('');
    L.push(`Read it at \`COORDINATOR_INTAKE.md\` line ${blocks[0].line}, commit \`${sha}\`:`);
    L.push('');
    L.push('```');
    L.push(`git show ${sha}:COORDINATOR_INTAKE.md | sed -n '${blocks[0].line},${blocks[0].endLine ?? blocks[0].line + 120}p'`);
    L.push('```');
    L.push('');
    L.push('**What is still outstanding is the reason this issue exists.** Fill it in from the');
    L.push('briefing when you pick it up, and close this issue when it is done.');
  } else {
    L.push('The original text, verbatim. A summary loses the reasoning, and in this queue the');
    L.push('reasoning — the traps, the "do NOT re-litigate this" lines — is the expensive part.');
    L.push('');
    for (const b of blocks) {
      if (blocks.length > 1) L.push(`### From \`## ${b.section}\`, line ${b.line}\n`);
      L.push(b.text.trim());
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('*This issue replaces a block in `COORDINATOR_INTAKE.md`. Do not re-file work into');
  L.push('that file — it is being retired. Open an issue instead.*');
  return L.join('\n');
}

export async function plan({ hold = [] } = {}) {
  const inv = await buildInventory();
  if (inv.errors.length) {
    const e = new Error('The step-1 inventory does not pass. Fix it first — migrating from a broken inventory is exactly the silent loss this plan exists to prevent.');
    e.inventoryErrors = inv.errors;
    throw e;
  }

  const parsed = await loadIntake();
  const byLine = new Map(migratingBlocks(parsed).map((b) => [b.line, b]));
  const sha = gh(['api', `repos/${REPO}/commits/main`, '--jq', '.sha']).slice(0, 40);

  const held = new Set(hold);
  const items = [];
  for (const wi of inv.workItems) {
    const id = workItemId(wi.title);
    const blocks = wi.blockLines.map((line) => {
      const b = byLine.get(line);
      if (!b) throw new Error(`Inventory references line ${line} but no block is there. Re-run the inventory.`);
      return { line, endLine: b.endLine, section: b.section, text: b.body };
    });
    items.push({
      id,
      workItem: wi.title,
      title: issueTitle(wi.title),
      labels: labelsFor(wi.title),
      blockLines: wi.blockLines,
      held: held.has(id),
      body: buildBody({ workItem: wi.title, blocks, sha }),
    });
  }
  return { inv, sha, items };
}

function existingOpenTitles() {
  // ONE call, not one per item. `gh issue list --label` works correctly in this repo —
  // re-verified 2026-08-07 against marker issue #491. The claim in COORDINATOR_INTAKE.md
  // that it returns empty is false; do not reinstate the REST workaround it prescribes.
  const raw = gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '500', '--json', 'number,title']);
  const map = new Map();
  for (const i of JSON.parse(raw)) map.set(i.title, i.number);
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

  const { inv, sha, items } = await plan({ hold });
  const live = items.filter((i) => !i.held);
  const allLabels = new Set(items.flatMap((i) => i.labels));

  console.log(`Source: COORDINATOR_INTAKE.md @ ${sha.slice(0, 7)}, ${inv.source.totalLines} lines`);
  console.log(`Inventory: ${inv.counts.MIGRATE} MIGRATE + ${inv.counts.CLOSED} CLOSED + ${inv.counts.NOISE} NOISE = ${inv.counts.total}`);
  console.log(`Work items: ${items.length}   to create: ${live.length}   held back: ${items.length - live.length}`);
  if (hold.length) console.log(`Held back by --hold: ${hold.join(', ')}`);
  console.log('');

  const missingLabels = ensureLabels(allLabels, create);
  if (missingLabels.length && !create) {
    console.log(`Labels that would be created: ${missingLabels.join(', ')}`);
    console.log('');
  }

  const existing = existingOpenTitles();
  const mapping = [];
  let created = 0;
  let skipped = 0;

  const tmp = mkdtempSync(join(tmpdir(), 'intake-migrate-'));
  try {
    for (const item of items) {
      if (item.held) {
        console.log(`HELD    ${item.id}  ${item.title}`);
        mapping.push({ ...item, body: undefined, issue: null, action: 'held' });
        continue;
      }
      const already = existing.get(item.title);
      if (already) {
        console.log(`SKIP    ${item.id}  #${already} already open  ${item.title}`);
        mapping.push({ ...item, body: undefined, issue: already, action: 'skipped' });
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

    console.log(`\n${create ? 'Created' : 'Would create'} ${create ? created : items.filter((i) => !i.held && !existing.has(i.title)).length}, skipped ${skipped}, held ${items.length - live.length}.`);
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
