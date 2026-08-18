#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const library = path.join(root, 'docs', 'business-rules');
const allowedStatuses = new Set(['Settled', 'Proposed', 'Historical', 'Unknown']);
const failures = [];

function fail(message) {
  failures.push(message);
}

for (const name of fs.readdirSync(library).filter((name) => name.endsWith('.md'))) {
  const file = path.join(library, name);
  const text = fs.readFileSync(file, 'utf8');
  const isTopic = name !== 'README.md' && name !== 'application-map.md' && !name.startsWith('audit-inventory-');
  if (isTopic) {
    const status = text.match(/^\*\*Status:\*\* (.+)$/m)?.[1]?.trim();
    if (!allowedStatuses.has(status)) fail(`${name}: status must be exactly Settled, Proposed, Historical, or Unknown`);
    if (status === 'Proposed' && /(?:companywide rule|owns the business rules)/i.test(text)) {
      fail(`${name}: Proposed topic claims to be a companywide rule`);
    }
  }

  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) fail(`${name}: broken local link ${match[1]}`);
  }
}

const legacyChecks = [
  ['docs/merch-group-taxonomy-architecture.md', '**Status:** implementation and historical evidence, not business authority'],
  ['docs/style-guides-characters-and-royalties.md', '**Status:** Historical.'],
  ['docs/core-master-data-consolidation-aim.md', '**Business authority moved 2026-08-18:**'],
];

for (const [relative, marker] of legacyChecks) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!text.includes(marker)) fail(`${relative}: missing legacy-authority guard`);
}

const forbiddenLegacyClaims = [
  ['docs/merch-group-taxonomy-architecture.md', /Read this before touching/i],
  ['docs/style-guides-characters-and-royalties.md', /supplies business authority|remains the authority/i],
  ['docs/core-master-data-consolidation-aim.md', /\*\*Status:\*\* SETTLED/i],
];

for (const [relative, pattern] of forbiddenLegacyClaims) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  if (pattern.test(text)) fail(`${relative}: still contains a competing authority claim`);
}

const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
if (!agents.includes('docs/business-rules/application-map.md')) {
  fail('AGENTS.md: missing companywide business-rule map');
}

if (failures.length) {
  console.error('Business-rule library check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Business-rule library check passed.');
