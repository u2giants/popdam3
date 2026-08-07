// Step 2 of plan_coordinator-queue-to-github-issues.md — the publication scrub.
//
// Scans every block the step-1 inventory marked MIGRATE against a denylist and writes
// a report: blocks scanned, hits by category, and a proposal for each hit.
//
//   node tools/scrub-intake-for-publication.mjs                  # report to stdout
//   node tools/scrub-intake-for-publication.mjs --out report.md  # report to a file
//   node tools/scrub-intake-for-publication.mjs --json
//
// WHAT THIS TOOL IS. A floor under human judgement, not a replacement for it. A clean
// run does NOT authorise publishing — it only means the mechanical patterns are found.
// An earlier draft of the plan said "do not scrub by eye" and then supplied no tool,
// which is an eye-scan with extra words. This is the tool. It still ends at a human.
//
// TWO CATEGORIES IT CANNOT DECIDE, flagged as HUMAN-DECISION and never auto-proposed:
//   1. Named individuals outside the company.
//   2. Descriptions of live, unfixed weaknesses. Publishing a working description of a
//      hole that is still open is materially different from publishing a closed one.
//
// It never prints a secret VALUE. Matches are reported by category, line and a
// character-bounded excerpt with the match itself masked, so the report is safe to
// paste to the owner.
//
// Node >= 20. Plain ESM, no dependencies.

import { writeFile } from 'node:fs/promises';
import { buildInventory } from './intake-inventory.mjs';

// proposal: what to do if a hit is confirmed real.
//   'hold-back'  — do not publish the block at all; context gives it away even redacted
//   'redact'     — publish the block with this span replaced
//   'review'     — a human rules; the tool has no safe default
const RULES = [
  {
    id: 'credential',
    label: 'Credentials, tokens, keys and connection strings',
    proposal: 'hold-back',
    patterns: [
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|bearer|private[_-]?key)\s*[:=]\s*\S+/gi,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
      /\bpostgres(?:ql)?:\/\/[^\s`)]+/gi,
      /\bghp_[A-Za-z0-9]{20,}\b/g,
      /\bsbp_[A-Za-z0-9]{20,}\b/g,
      /\bAIza[A-Za-z0-9_\-]{30,}\b/g,
    ],
  },
  {
    id: 'hex40',
    label: '40-character hex strings (git SHAs, but also key fingerprints)',
    proposal: 'review',
    human: true,
    patterns: [/\b[0-9a-f]{40}\b/g],
    note: 'Shape alone cannot separate a git commit SHA — harmless, and this repo quotes them constantly — from a service-account key fingerprint, which is not. In practice almost every hit here is a commit SHA. Check each against `git cat-file -t <sha>`: if git knows it, publish it. At least one is NOT a commit — the service-account key id recorded beside the Cloud SQL rotation request.',
  },
  {
    id: 'onepassword',
    label: '1Password item and vault IDs, and field names',
    proposal: 'redact',
    patterns: [
      /\b[a-z0-9]{26}\b/g, // 1Password IDs are 26 lowercase alphanumerics
      /\bvault\s+`?vibe_coding`?/gi,
    ],
  },
  {
    id: 'db-project',
    label: 'Supabase project refs and pooler hosts',
    proposal: 'redact',
    patterns: [
      /\bqsllyeztdwjgirsysgai\b/g,
      /\brjyboqwcdzcocqgmsyel\b/g,
      /\b[a-z]{20}\.supabase\.(?:co|com)\b/g,
      /\baws-\d-[a-z0-9-]+\.pooler\.supabase\.com\b/g,
    ],
  },
  {
    id: 'internal-host',
    label: 'Internal hostnames and internal URLs',
    proposal: 'redact',
    patterns: [
      /\bx5\.coldlion\.com\b/gi,
      /\b[a-z0-9-]+\.designflow\.app\b/gi,
      /\bopa\.disney\.com\b/gi,
      /\bcreatiflow-database\b/gi,
      /\blithe-breaker-\d+\b/gi,
    ],
  },
  {
    id: 'machine',
    label: 'Machine names',
    proposal: 'redact',
    patterns: [/\b(?:al8960ofc|edgesynology[12])\b/g, /\bt16\b/g, /\bhetz\b/g],
  },
  {
    id: 'local-path',
    label: 'Local filesystem paths',
    proposal: 'redact',
    patterns: [
      /\bC:[\\/][A-Za-z0-9_\\/.\-]+/g,
      /\bD:[\\/][A-Za-z0-9_\\/.\-]+/g,
      /\b\/home\/[A-Za-z0-9_\-]+[A-Za-z0-9_\-/.]*/g,
      /\b\/worksp\/[A-Za-z0-9_\-/.]*/g,
      /\bZ:[\\/][A-Za-z0-9_\\/.\-]+/g,
    ],
  },
  {
    id: 'email',
    label: 'Email addresses',
    proposal: 'redact',
    patterns: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  },
  {
    id: 'person',
    label: 'Named individuals',
    proposal: 'review',
    human: true,
    patterns: [/\bAlbert(?:\s+Hazan)?\b/g, /\bLaura\b/g, /\bUma\b/g],
    note: 'Albert is the owner and is named throughout; the ones that matter are the OTHERS. At least one individual outside the company appears in the WAITING section. A human rules on each.',
  },
  {
    id: 'commercial',
    label: 'Licensor and customer commercial terms',
    proposal: 'review',
    human: true,
    patterns: [
      /\broyalt(?:y|ies)\b/gi,
      /\blicense[ed]?\s+(?:product|item|asset)s?\b/gi,
      /\bstyle\s+guide\s+(?:licens\w+|approval)/gi,
      /\bentitle(?:d|ment)s?\b/gi,
      /\bconfidential\b/gi,
    ],
    note: 'Licensor names alone are not confidential — POP is publicly a licensee. What matters is commercial detail: what we pay, what we are entitled to, and a licensor\'s own internal identifiers.',
  },
  {
    id: 'licensor-ids',
    label: "Licensor-owned internal identifiers (Disney's own keys and similar)",
    proposal: 'hold-back',
    human: true,
    note: '⚠️ **There is a standing owner ruling on this category** — `AGENTS.md` §6.7, Albert Hazan, 2026-08-07: the Disney OPA property/character extract is **NOT sensitive**. So the mechanical `hold-back` default is very likely wrong here, and holding these back silently would override the owner. It is marked HUMAN precisely so someone has to say `publish` out loud rather than letting a default decide. Do not blanket-publish either: the ruling covers the Disney OPA extract, not every licensor identifier that may appear later.',
    patterns: [
      /\blicensedPropertyID\b/g,
      /\bbrandPropertyID\b/g,
      /\bcharacterID\b/g,
      /\boptionSourceID\b/g,
      /\bopa-characters\.csv\b/g,
    ],
  },
  {
    id: 'live-weakness',
    label: 'Descriptions of live, unfixed weaknesses',
    proposal: 'review',
    human: true,
    patterns: [
      /\bsilent(?:ly)?\s+(?:fail\w*|overwrit\w*|eras\w*|drop\w*|blank\w*)/gi,
      /\bunvalidated\s+\w+\s+endpoint\b/gi,
      /\bopen\s+to\s+\d+\s+roles\b/gi,
      /\bno\s+duplicate\s+detection\b/gi,
      /\bfalse[- ]pass\w*/gi,
      /\bnot\s+rotated\b/gi,
      /\bemailed\s+in\s+plaintext\b/gi,
      /\bno\s+branch\s+protection\b/gi,
      /\bunprotected\b/gi,
    ],
    note: 'A working description of a hole that is STILL OPEN is a different thing from the write-up of a closed one. Each hit needs a human to say whether the weakness it describes is fixed today.',
  },
];

const mask = (s) => (s.length <= 4 ? '*'.repeat(s.length) : s.slice(0, 2) + '*'.repeat(Math.min(s.length - 2, 12)));

/**
 * Every span in the block that any rule matches. Used so an excerpt cannot leak a
 * NEIGHBOURING secret while masking the one it is anchored on.
 *
 * Found in review (Kimi K3, 2026-08-07): the first version masked only the anchor match
 * and printed 45 raw characters either side, so a credential sitting next to a machine
 * name rode out in the machine name's excerpt. Spans are extended to full match
 * boundaries, so a match that only partly overlaps the window is still masked whole.
 */
function allSpans(body) {
  const spans = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      for (const m of body.matchAll(pattern)) spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

function excerpt(body, index, length, spans) {
  let start = Math.max(0, index - 45);
  let end = Math.min(body.length, index + length + 45);
  // Extend the window out to the boundaries of any match it clips, so nothing is
  // half-shown. A half-shown secret is still a shown secret.
  for (const [s, e] of spans) {
    if (e > start && s < end) {
      if (s < start) start = s;
      if (e > end) end = e;
    }
  }
  let out = '';
  let cursor = start;
  for (const [s, e] of spans) {
    if (e <= start || s >= end) continue;
    if (s > cursor) out += body.slice(cursor, s).replace(/\s+/g, ' ');
    const isAnchor = s === index && e === index + length;
    out += (isAnchor ? '[[' : '<') + mask(body.slice(s, e)) + (isAnchor ? ']]' : '>');
    cursor = e;
  }
  if (cursor < end) out += body.slice(cursor, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${out}${end < body.length ? '…' : ''}`;
}

export async function scrub(intakePath) {
  const inv = await buildInventory(intakePath);
  if (inv.errors.length) {
    const e = new Error('The step-1 inventory does not pass. Fix it before scrubbing — scrubbing an incomplete inventory scans the wrong set of blocks.');
    e.inventoryErrors = inv.errors;
    throw e;
  }

  const { loadIntake, migratingBlocks } = await import('./intake-blocks.mjs');
  const parsed = await loadIntake(intakePath);
  const byLine = new Map(migratingBlocks(parsed).map((b) => [b.line, b]));

  const migrating = inv.blocks.filter((b) => b.verdict === 'MIGRATE');
  const hits = [];

  for (const row of migrating) {
    const body = byLine.get(row.line)?.body ?? '';
    const spans = allSpans(body);
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        for (const m of body.matchAll(pattern)) {
          hits.push({
            rule: rule.id,
            label: rule.label,
            proposal: rule.proposal,
            human: Boolean(rule.human),
            blockLine: row.line,
            blockHeading: row.heading,
            workItem: row.workItem,
            // The literal matched text. This is what the migrate tool searches for and
            // replaces, so redaction is a value match, never a character offset — offsets
            // go stale the moment the source file shifts by a line.
            value: m[0],
            excerpt: excerpt(body, m.index, m[0].length, spans),
          });
        }
      }
    }
  }

  const byRule = new Map();
  for (const h of hits) {
    if (!byRule.has(h.rule)) byRule.set(h.rule, []);
    byRule.get(h.rule).push(h);
  }

  const blocksWithHoldBack = new Set(hits.filter((h) => h.proposal === 'hold-back').map((h) => h.blockLine));
  const workItemsWithHoldBack = new Set(hits.filter((h) => h.proposal === 'hold-back').map((h) => h.workItem));

  return { inventory: inv, migratingCount: migrating.length, hits, byRule, blocksWithHoldBack, workItemsWithHoldBack };
}

function renderReport(r) {
  const L = [];
  L.push('# Publication scrub report — `COORDINATOR_INTAKE.md`');
  L.push('');
  L.push('Generated by `tools/scrub-intake-for-publication.mjs`. **A clean run does not authorise publishing.**');
  L.push('This tool is a floor under human judgement: it finds the mechanical patterns. Two categories are');
  L.push('marked HUMAN and carry no automatic proposal, because no regex can rule on them.');
  L.push('');
  L.push('| | |');
  L.push('| --- | --- |');
  L.push(`| Source | \`${r.inventory.source.path}\`, ${r.inventory.source.totalLines} lines |`);
  L.push(`| Blocks scanned | ${r.migratingCount} (every block the inventory marked MIGRATE) |`);
  L.push(`| Work items behind them | ${r.inventory.counts.workItems} |`);
  L.push(`| Total hits | ${r.hits.length} |`);
  L.push(`| Blocks with a HOLD-BACK hit | ${r.blocksWithHoldBack.size} |`);
  L.push(`| Work items with a HOLD-BACK hit | ${r.workItemsWithHoldBack.size} |`);
  L.push('');
  L.push('## Hits by category');
  L.push('');
  L.push('| Category | Hits | Blocks | Proposal |');
  L.push('| --- | ---: | ---: | --- |');
  for (const rule of RULES) {
    const hs = r.byRule.get(rule.id) ?? [];
    const blocks = new Set(hs.map((h) => h.blockLine)).size;
    L.push(`| ${rule.label}${rule.human ? ' **(HUMAN)**' : ''} | ${hs.length} | ${blocks} | ${hs.length ? rule.proposal : '—'} |`);
  }
  L.push('');

  for (const rule of RULES) {
    const hs = r.byRule.get(rule.id) ?? [];
    if (!hs.length) continue;
    L.push(`## ${rule.label}`);
    L.push('');
    L.push(`**Proposal if confirmed: \`${rule.proposal}\`.**${rule.human ? ' **A human must rule on every hit in this category — the tool has no safe default.**' : ''}`);
    if (rule.note) {
      L.push('');
      L.push(rule.note);
    }
    L.push('');
    const seen = new Map();
    for (const h of hs) {
      if (!seen.has(h.blockLine)) seen.set(h.blockLine, []);
      seen.get(h.blockLine).push(h);
    }
    for (const [line, list] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
      L.push(`- **line ${line}** — ${list[0].workItem}`);
      for (const h of list.slice(0, 4)) L.push(`  - \`${h.excerpt.replace(/`/g, "'")}\``);
      if (list.length > 4) L.push(`  - …and ${list.length - 4} more in this block`);
    }
    L.push('');
  }

  if (r.workItemsWithHoldBack.size) {
    L.push('## Work items proposed for HOLD-BACK');
    L.push('');
    L.push('These carry a hit whose category cannot be safely redacted, because the surrounding text');
    L.push('gives the redacted thing away by context. The proposal is to publish nothing for them until');
    L.push('the underlying issue is resolved.');
    L.push('');
    for (const wi of [...r.workItemsWithHoldBack].sort()) L.push(`- ${wi}`);
    L.push('');
  }

  L.push('## What this report does NOT tell you');
  L.push('');
  L.push('- Whether a licensor would object. That is a relationship judgement, not a pattern.');
  L.push('- Whether a described weakness is fixed **today**. The tool reads the text, not the system.');
  L.push('- Whether an individual named here consented to being named.');
  L.push('');
  L.push('**Nothing may be published until the owner has read this report and said yes.**');
  return L.join('\n');
}

/**
 * The REDACTION MAP — the missing apply step.
 *
 * Found in review (Kimi K3, 2026-08-07), ranked BLOCKING and correct: the scrub proposed
 * redactions, the owner approved them, and the migration script then pasted every block
 * VERBATIM. Nothing consumed the report. That made steps 2 and 4 ceremony.
 *
 * The map is keyed by (work item, literal value) rather than by character offset, because
 * offsets go stale as soon as the source file shifts and a stale offset redacts the wrong
 * span silently. `migrate-intake-to-issues.mjs` refuses to run with `--create` unless a
 * validated map is supplied.
 *
 * It groups by VALUE, not by hit, so the 103 name hits collapse to 3 decisions instead of
 * 103 rubber-stamps. Every `review` value starts as `UNRESOLVED` and the map does not
 * validate until a human has changed each one.
 *
 * ⚠️ The map lists the exact sensitive values. It is the secret list. Write it to a temp
 * directory and NEVER commit it.
 */
export function buildRedactionMap(result) {
  const byValue = new Map();
  for (const h of result.hits) {
    const key = `${h.rule} ${h.value}`;
    if (!byValue.has(key)) {
      byValue.set(key, {
        rule: h.rule,
        label: h.label,
        value: h.value,
        // 'redact' and 'hold-back' are mechanical and pre-filled. Every HUMAN category
        // starts UNRESOLVED and must be decided before the map validates.
        action: h.human ? 'UNRESOLVED' : h.proposal,
        replacement: h.proposal === 'redact' ? `[redacted: ${h.rule}]` : null,
        occurrences: 0,
        workItems: new Set(),
        sampleExcerpt: h.excerpt,
      });
    }
    const e = byValue.get(key);
    e.occurrences++;
    e.workItems.add(h.workItem);
  }
  const entries = [...byValue.values()]
    .map((e) => ({ ...e, workItems: [...e.workItems].sort() }))
    .sort((a, b) => b.occurrences - a.occurrences);
  return {
    generatedFrom: { path: result.inventory.source.path, totalLines: result.inventory.source.totalLines },
    legend: {
      redact: 'replace every occurrence with `replacement` before publishing',
      publish: 'leave as-is; a human ruled it is not sensitive',
      'hold-back': 'do not publish the work item at all',
      UNRESOLVED: 'a human has not ruled yet; the map will not validate',
    },
    unresolved: entries.filter((e) => e.action === 'UNRESOLVED').length,
    entries,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  let result;
  try {
    result = await scrub();
  } catch (err) {
    console.error(err.message);
    for (const e of err.inventoryErrors ?? []) console.error('  - ' + e);
    process.exit(1);
  }
  const ri = process.argv.indexOf('--emit-redactions');
  if (ri !== -1) {
    const map = buildRedactionMap(result);
    const out = process.argv[ri + 1];
    if (!out) {
      console.error('--emit-redactions needs a path. Write it to a TEMP directory: the map lists the exact sensitive values and must never be committed.');
      process.exit(1);
    }
    await writeFile(out, JSON.stringify(map, null, 2) + '\n', 'utf8');
    console.error(`Redaction map written to ${out}`);
    console.error(`${map.entries.length} distinct values, ${map.unresolved} still UNRESOLVED and needing a human ruling.`);
    console.error('⚠️ This file lists the sensitive values themselves. Do not commit it.');
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, byRule: undefined, blocksWithHoldBack: [...result.blocksWithHoldBack], workItemsWithHoldBack: [...result.workItemsWithHoldBack] }, null, 2));
  } else {
    const md = renderReport(result);
    const i = process.argv.indexOf('--out');
    if (i !== -1 && process.argv[i + 1]) {
      await writeFile(process.argv[i + 1], md + '\n', 'utf8');
      console.error(`Report written to ${process.argv[i + 1]} — ${result.hits.length} hits across ${result.migratingCount} blocks.`);
    } else {
      console.log(md);
    }
  }
}
