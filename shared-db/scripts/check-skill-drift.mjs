#!/usr/bin/env node
// Guard: the shared-db skills must not contradict AGENTS.md.
//
// WHY THIS EXISTS.
//
// On 2026-08-07 the `shared-db-change` skill was found to say "DDL via MCP
// `apply_migration` only" while `AGENTS.md` standing fact 6 says that MCP may be bound to
// PRODUCTION with no way to aim it at preview. A session following the skill literally
// could have applied DDL straight to production believing it was doing the safe,
// documented thing.
//
// It had drifted for weeks. THREE separate adversarial model reviews of the surrounding
// work missed it, because every one of them reviewed this repository and the skills live
// in a DIFFERENT repository (`u2giants/ai-devops`). Neither repo's CI could see both, so
// no check could catch it and no reviewer was looking. That gap is the root cause, and it
// would have recurred.
//
// This check closes it from the shared-db side: CI clones nothing, but a developer or
// an agent running the offline test suite has both repos on disk, so the check runs
// locally and is wired into the tools-offline test lane, which SKIPS cleanly in CI where
// the sibling repo is absent. A check that cannot see its input must say so rather than
// pass silently — that is the false-green pattern this repo keeps rediscovering.
//
//   node scripts/check-skill-drift.mjs
//   AI_DEVOPS_DIR=/path/to/ai-devops node scripts/check-skill-drift.mjs
//
// Exit 0 = agrees, or the skills are not reachable (and it says which).
// Exit 1 = a skill contradicts AGENTS.md.
//
// Node >= 20. No dependencies, no network.

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const AGENTS = 'AGENTS.md';
const CANDIDATE_DIRS = [
  process.env.AI_DEVOPS_DIR,
  'C:/repos/ai-devops',
  '/c/repos/ai-devops',
  '/repos/ai-devops',
  join(process.env.HOME ?? '', 'repos/ai-devops'),
].filter(Boolean);

const SKILLS = ['shared-db-orchestrator', 'shared-db-change', 'shared-db-handover'];

/**
 * Each rule is a CONTRADICTION, not a style preference: a pattern that must not appear in
 * a skill, with the AGENTS.md rule it violates and why it is dangerous. Keep this list
 * short and specific. A drift check that flags wording becomes noise, and noise gets
 * ignored, which is how the original defect survived.
 */
const CONTRADICTIONS = [
  {
    id: 'mcp-ddl',
    // `~~…~~` means struck through and corrected below, which is how a superseded rule is
    // retired here. Do not re-flag a rule that has already been retired.
    pattern: /(?<!~~\*\*)DDL via MCP[^\n]*only(?![^\n]*SUPERSEDED)/i,
    agents: 'standing fact 6 — the Supabase MCP may be bound to PRODUCTION and takes no project parameter',
    why: 'A session following this can apply DDL straight to production while believing it is doing the documented safe thing. This is the exact defect that caused this check to exist.',
  },
  {
    id: 'intake-queue-append',
    // The exemption window spans NEWLINES on purpose. A correction like "…used to append
    // to `COORDINATOR_INTAKE.md`; that file was **RETIRED** on 2026-08-07" wraps, and a
    // line-scoped lookahead flagged the correction itself as the defect.
    pattern: /(append|write|file)[^\n]{0,40}(to|into)[^\n]{0,20}`?COORDINATOR_INTAKE\.md`?(?![\s\S]{0,220}(RETIRED|retired))/i,
    agents: '§2 and the retirement of the intake queue on 2026-08-07',
    why: 'COORDINATOR_INTAKE.md is a 37-line pointer. Work goes in GitHub issues, and a required check fails any PR that regrows the file.',
  },
  {
    id: 'stale-marker-label',
    pattern: /--label\s+coordinator-marker/,
    agents: 'the marker label was renamed to `orchestrator-marker` on 2026-08-07',
    why: 'Querying the old label returns EMPTY, and step 0 treats empty as permission to start. That would let a second orchestrator start while one is already live.',
  },
  {
    id: 'prune-false',
    // Not preceded by "not" — the skills correctly WARN against this flag, and flagging
    // the warning as the defect is how a drift check turns into noise.
    // Not preceded by a "not", allowing for the backtick and bolding the skills use:
    // "**not** `--prune=false`". Flagging the warning as the defect is how a drift check
    // turns into noise, and noise is how the original defect survived for weeks.
    pattern: /(?<!not\W{0,4})--prune=false/i,
    agents: 'this version of git rejects the flag, so the session-start fetch silently never happens',
    why: 'The session then reasons about a stale origin/main without being told.',
  },
];

async function findSkillsDir() {
  for (const d of CANDIDATE_DIRS) {
    try {
      await access(join(d, 'skills', 'claude', 'shared-db-orchestrator', 'SKILL.md'));
      return join(d, 'skills', 'claude');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function main() {
  await readFile(AGENTS, 'utf8'); // fail loudly if run from the wrong directory

  const dir = await findSkillsDir();
  if (!dir) {
    // Not a pass and not a failure: it is "could not look". Say so, loudly and specifically.
    console.log('SKIPPED: the ai-devops skills are not on this machine, so nothing was checked.');
    console.log('  Looked in: ' + CANDIDATE_DIRS.join(', '));
    console.log('  Set AI_DEVOPS_DIR to check them. This is expected in CI, where the sibling repo is absent.');
    console.log('  ⚠️ A green run here does NOT mean the skills agree with AGENTS.md — it means they were not read.');
    return;
  }

  const problems = [];
  for (const skill of SKILLS) {
    const path = join(dir, skill, 'SKILL.md');
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      problems.push(`${skill}: SKILL.md is missing at ${path}.`);
      continue;
    }
    for (const rule of CONTRADICTIONS) {
      const m = text.match(rule.pattern);
      if (!m) continue;
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(
        `${skill}/SKILL.md:${line} [${rule.id}]\n` +
          `      says: ${m[0].trim().slice(0, 110)}\n` +
          `      contradicts AGENTS.md: ${rule.agents}\n` +
          `      why it matters: ${rule.why}`,
      );
    }
  }

  if (problems.length) {
    console.error(`FAIL: ${problems.length} skill statement(s) contradict AGENTS.md.\n`);
    for (const p of problems) console.error('  - ' + p + '\n');
    console.error('AGENTS.md WINS. Fix the skill in u2giants/ai-devops, push, and re-sync it here.');
    console.error('If AGENTS.md is the one that is wrong, fix AGENTS.md instead — but fix ONE of them.');
    process.exit(1);
  }

  console.log(`OK: checked ${SKILLS.length} skills in ${dir} against ${AGENTS}; no contradictions.`);
}

await main();
