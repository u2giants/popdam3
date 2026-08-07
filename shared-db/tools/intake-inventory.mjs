// Step 1 of plan_coordinator-queue-to-github-issues.md — the inventory.
//
// Classifies every `###` block in COORDINATOR_INTAKE.md's four migrating sections
// (REQUEST QUEUE, IN PROGRESS, WAITING ON OTHER PEOPLE, INTAKE QUEUE) into exactly
// one of three buckets, and asserts the completeness arithmetic the plan mandates:
//
//     MIGRATE + CLOSED + NOISE  ==  total blocks in those sections
//
// The plan's warning is that the silent-loss door is HERE, not at the issue-creation
// step: a block wrongly marked CLOSED or NOISE never reaches the migration script, and
// a block->issue mapping file can only ever prove "nothing was lost from the set the
// script was given", which is circular. So every non-MIGRATE block carries a reason a
// stranger can check, and this script FAILS if a block is unclassified, if the list no
// longer lines up with the file, or if the arithmetic is off.
//
//   node tools/intake-inventory.mjs            # verify + print the summary
//   node tools/intake-inventory.mjs --json     # emit the machine-readable inventory
//
// Classified 2026-08-07 against COORDINATOR_INTAKE.md at 5,449 lines. Every CLOSED
// reason was checked against `git log` / `gh pr list` / `gh issue view` / the live
// working tree — never against another document, because this repo's standing rule is
// that no document wins by name or by date.
//
// Node >= 20. Plain ESM, no dependencies.

import { loadIntake, migratingBlocks, headingDate, backlogRefs } from './intake-blocks.mjs';

// Each entry is [headingFragment, verdict, workItem-or-reason]. The list is
// ORDER-CHECKED against the file: entry i's fragment must appear in block i's heading.
// Keying by a slug would silently tolerate an inserted or reordered block; this does
// not. If the file changes shape, this script fails and says exactly where.
const M = (fragment, item) => [fragment, 'MIGRATE', item];
const X = (fragment, reason) => [fragment, 'CLOSED', reason];
const N = (fragment, reason) => [fragment, 'NOISE', reason];

const WI_OPA = 'WI-03 Disney OPA property/character lookup table';
const WI_CLOUDSQL = 'WI-07 Move licensor/property off Cloud SQL, with ColdLion as the source';
const WI_CODEQ = 'WI-37 OWNER: the 5 remaining ColdLion property-code contract questions';
const WI_SKILL = 'WI-26 Fix the shared-db-orchestrator skill: stale 1Password vault ID and an invalid fetch command';

export const CLASSIFICATION = [
  // ---- REQUEST QUEUE — 2026-08-07 batch (outgoing coordinator 774f5010) ----
  M('R-SEC-1', 'WI-01 Disney extract: move it to the private repo and scrub it from git history'),
  M('four owner decisions left open', 'WI-02 OWNER: four decisions left open by session 774f5010'),
  M('Phase 2: BUILD the OPA lookup table', WI_OPA),
  M('Execute the DS', 'WI-04 DS->DY at its source (Albert ruled: no hard-coding)'),
  M('Promote migration `20260807030000`', 'WI-05 Promote migration 20260807030000 (the Coco ruling) to production'),
  M('Parentage durability', 'WI-06 Parentage durability: nothing protects core.property.licensor_id'),
  M('ColdLion as the source for Supabase', WI_CLOUDSQL),
  M('SILENT FAILURE: the dead PLM feed', 'WI-08 Silent failure: the dead PLM feed reports success on every run'),
  M('Preview Supabase branch reports', 'WI-09 Preview Supabase branch reports MIGRATIONS_FAILED'),
  M('`core.character` is `ON DELETE CASCADE`', 'WI-10 core.character is ON DELETE CASCADE on core.property'),
  M('Close the app-repo blast-radius gap', 'WI-11 Close the app-repo blast-radius gap (popdam3 and three others)'),

  // ---- REQUEST QUEUE — 2026-08-06 opa-scrape batch ----
  M('CLOSING NOTE', WI_OPA),
  M('§6.7 is STALE on branch protection', 'WI-12 Shared-checkout collisions: make worktree-only an AGENTS.md rule'),
  M('SUPPLEMENT to the OPA lookup-table', WI_OPA),
  M('Store the Disney OPA property', WI_OPA),

  // ---- REQUEST QUEUE — 2026-08-06 al8960ofc batch ----
  X('FIRST ACTION: push and merge FIVE unpushed',
    'Landed. The five branches reached `main` as PRs #455-#460, all MERGED, and coordinator marker issue #453 is CLOSED. Both verified live 2026-08-07 with `gh pr list --state all` and `gh issue view 453`.'),
  M('Collect the `csv-export` agent', 'WI-13 Collect the csv-export agent output left on the Desktop'),
  M('how should an ownerless property be stored', 'WI-14 OWNER: how should an ownerless property be stored?'),
  M('the remaining licensor/property cutover decisions', 'WI-15 OWNER: the six remaining licensor/property cutover decisions'),
  M('approve rotating the Cloud SQL read-only password', 'WI-16 OWNER: rotate the Cloud SQL read-only password emailed in plaintext'),
  M('Execute the licensor/property cutover plan', WI_CLOUDSQL),
  M('Blocker 8 was mis-stated', 'WI-17 Blocker 8 mis-stated: the real writer is PATCH /api/admin/updateMerchGroup'),
  M('Reconcile the 9 documents', 'WI-18 Reconcile the 9 documents the triage ruling now contradicts'),
  M('Backlog B8', 'WI-19 Backlog B8: its HANDOFF.md heading still says "NOT implemented" and is stale'),

  // ---- REQUEST QUEUE — 2026-08-06 stale-sweep batch ----
  M('QUESTION TO RESOLVE', 'WI-20 Which CC property row should the Disney Coco style guide point at?'),
  M('matches property codes GLOBALLY', 'WI-21 Defect: validate-licensing-answers.mjs matches property codes globally'),
  M('Re-derive the "66 missing', 'WI-22 Re-derive the ColdLion property-code gap per licensor'),
  M('`GENERAL_ROYALTY_LABEL` exclusion', 'WI-23 Resolver gap: GENERAL_ROYALTY_LABEL misses the abbreviation "Gen"'),
  M('`LOGO_LABEL` rule', 'WI-24 Resolver gap: LOGO_LABEL only matches "logo" at the start or end'),
  M('Record the 8 round-3 licensing answers', 'WI-25 Record the 8 round-3 licensing answers and run the mandated validator'),
  M('Fix a stale 1Password vault ID', WI_SKILL),
  X('Finish the sweep PR #455 started',
    'Landed. PR #472 ("stale local branch labels swept, 134 to 64") is MERGED — verified live with `gh pr list --state all`. Its one residual, a leftover worktree, is carried by WI-27 and is not lost.'),
  M('Backlog B6 now has hard evidence', 'WI-28 Backlog B6: fold in the four-worktree collision evidence and re-assess the guard'),
  M('Second-model review of the six skill corrections', 'WI-29 Second-model review of the six skill corrections in ai-devops ec137b2'),
  M('decide whether to trim the orchestrator skill', 'WI-30 OWNER: trim the orchestrator skill, or leave it as it is?'),

  // ---- REQUEST QUEUE — 2026-08-03 and earlier ----
  M("Let DesignFlow show an item's UPCs", "WI-31 DesignFlow: show an item's UPCs on the item detail page (app-side half)"),
  M('Re-verify the master-data scoreboard counts', 'WI-32 Re-verify the master-data scoreboard counts merged unverified by PR #337'),
  M('Document the MG07-becomes-populated', 'WI-33 Document the MG07-becomes-populated reconciliation case'),
  M('Close the pre-link ColdLion alert-delivery gap', 'WI-34 Close the pre-link ColdLion alert-delivery gap'),
  M('Restart ColdLion Phase 6 preview monitoring', 'WI-35 Restart ColdLion Phase 6 preview monitoring'),
  X('Establish what the 3 UNATTRIBUTED worktrees are before',
    'Answered. PR #455 ("worktree sweep complete — all 51 removed, 3 unattributed ones resolved") is MERGED, and the 2026-08-05 INTAKE QUEUE block records all three identified by name. Verified live: `git worktree list` now returns 2 entries, not 34.'),
  M('production migration lane able to produce a plan', 'WI-36 The production migration lane cannot produce a plan (Step 8 blocker)'),
  M('Put the 5 remaining ColdLion property-code', WI_CODEQ),
  M('Add supersession pointers', 'WI-38 Supersession pointers for the 2 live docs still asserting an immutable bronze layer'),
  M('8 Exorcist assets', 'WI-39 PopDAM data quality: 8 Exorcist assets filed under the wrong licensor'),
  M('Assemble the ColdLion Step 8 approval package', 'WI-40 Assemble the ColdLion Step 8 approval package'),
  M('popdam3 worker alias cutover', 'WI-41 popdam3 worker alias cutover (different repo)'),
  M('PopSG PSG-5 rebuild', 'WI-42 PopSG PSG-5 rebuild (hold — dedicated dispatch only)'),
  X('Sweep the 22 worktrees',
    'Superseded and landed. The worktree half went in PR #455 and the branch-label half in PR #472, both MERGED. This block is the same item at an earlier count and says so in its own body.'),
  X('Update the stale shared checkout',
    'Satisfied. Recorded satisfied in this same file by the 2026-08-02 intake-ingest note, and re-verified live 2026-08-07: `C:/repos/shared-db` sits on `main` at origin tip `ce16397` with a clean tree. The separate `/worksp/shared-db` re-break is a different checkout on a different machine and is carried by WI-55.'),

  // ---- REQUEST QUEUE — the B1..B12 backlog mirrors ----
  M('Backlog B1', 'WI-43 Backlog B1: add .gitattributes and force LF'),
  X('Backlog B2',
    'Landed. PR #445 ("ci: make DB guards always-on required checks (B2)") is MERGED — verified live with `gh pr list --state all` — and the always-on workflows it added are present in `.github/workflows/`.'),
  M('Backlog B3', 'WI-44 Backlog B3: audit the pre-existing SECURITY DEFINER privilege exposure'),
  X('Backlog B4',
    'Nothing to do. The block states in its own body that the rule is already in force in `AGENTS.md` and standing fact 5, and that no action is required. It exists only so that no backlog number is invisible in the queue — a need this migration removes outright.'),
  M('Backlog B5', 'WI-45 Backlog B5: the two live constraints it still carries'),
  X('Backlog B6 — cross-PR object collision guard',
    'Landed. PR #397 shipped `.github/workflows/pr-object-collision.yml`, which is present in the tree, and the guard was proven by drill PRs #398/#399/#401/#404/#405. The one open follow-up — re-assessing it against the four-worktree evidence — is carried by WI-28.'),
  X('Backlog B7',
    'Not a task. Its own annotation says the standard "is not done, it is now how guards are built" — it is standing policy, proven by PR #397. There is nothing left to close.'),
  M('Backlog B9', 'WI-46 Backlog B9: no armed-but-read-only state for the production enable variable'),
  X('Backlog B10',
    'Superseded by this migration, deliberately. B10 asks for CI that enforces this file\'s lifecycle and retention rules. This plan deletes the file and those rules, so implementing B10 would rebuild precisely what is being removed. Plan step 9 requires B10 be rewritten or closed — this is that closure, and it MUST be mirrored into `HANDOFF.md:1850` or a future session will faithfully rebuild the queue.'),
  M('Backlog B11', 'WI-47 Backlog B11: a paused agent is indistinguishable from a finished one'),
  M('Backlog B12', 'WI-48 Backlog B12: the WSL psql wrapper leaks orphaned processes'),

  // ---- REQUEST QUEUE — 2026-08-03 handover-writer batch ----
  M('stop the ColdLion alert monitor', 'WI-49 OWNER: stop the ColdLion alert monitor, build dedupe, then close the duplicates'),
  M('the 5 remaining ColdLion property-code contract questions', WI_CODEQ),
  M('Move Licensors and Properties off Cloud SQL', WI_CLOUDSQL),
  M('the health-lane re-pin', 'WI-50 ColdLion sync: the health-lane re-pin'),
  M('the 7-step import/removal sequence', 'WI-51 Licensor/property mappings: the 7-step import and removal sequence'),
  M('Build the DB Data Admin', 'WI-52 Build the DB Data Admin licensor->property curation screen'),
  M('Stop the three overwrite paths', 'WI-53 Stop the three overwrite paths that violate AGENTS.md 6.4 in production'),
  M('Correct the disproved lines', 'WI-54 Correct the disproved lines in the merch-group taxonomy doc'),
  X('Establish what the 3 UNATTRIBUTED worktrees are, and do NOT sweep',
    'Answered — the same finding as the 2026-07-31 block above, re-filed. PR #455 identified all three by name and removed all 51 worktrees. Verified live: `git worktree list` returns 2 entries.'),

  // ---- REQUEST QUEUE — 2026-08-05 hetz batch ----
  M('close the two remaining branch-protection gaps',
    'WI-57 Branch protection on main is GONE — restore it (this block is now understated)'),
  M('fix the backlog/queue CI guard', 'WI-58 The "Backlog / queue sync" check false-passes — fix it or retire it'),
  M('un-park the shared checkout', 'WI-55 Un-park the shared checkout /worksp/shared-db and find the root cause'),
  M('the 2 untracked GLM review files', 'WI-56 Decide the fate of the 2 untracked GLM review files'),
  M('read the diffs of the nine pull requests', 'WI-59 Read the diffs of the nine PRs that merged outside coordinator control'),
  X('the "92 rows" style-guide question is ANSWERED',
    'Self-closing. The block IS the answer: it states the question has been located, is answered in `fix_characters_style_guides.md`, and that the only outcome needed is that the next coordinator stops carrying it. Migrating it would carry it further, which is the one thing it asks nobody to do.'),
  X("ALBERT'S ASK #3",
    'Answered elsewhere in this same file. The 2026-08-06 rotation request records the credential as 1Password item `tcaf3o3u2cx52g6ivvczxbhola`, vault `vibe_coding`, user `albert_read_only`, granted 2026-08-04 — which is exactly the yes-plus-item-title this block asks for. The rotation itself is a separate live item, WI-16.'),
  M('fix the `shared-db-orchestrator` skill', WI_SKILL),

  // ---- IN PROGRESS ----
  N('IN PROGRESS — Store the Disney OPA',
    'Audit trail, not work in flight. Its own banner, added 2026-08-07 ~16:00 UTC, says session 774f5010 ended, every agent finished and every worktree is retired — "nothing below is live". Verified live: zero open db-claim issues, `git worktree list` returns 2. The live remainder is Phase 2, which is already its own REQUEST QUEUE block and is carried by WI-03.'),

  // ---- INTAKE QUEUE (design decision D3: the issue points at the file) ----
  M('Stale local BRANCH LABELS swept', 'WI-27 Retire the one leftover worktree from the branch-label sweep'),
  M('Characters/style-guides:', 'WI-60 Characters/style-guides: core.character is empty, plus a question-generator defect'),
  X('The worktree sweep is DONE',
    'Complete on its own terms. Delivered by PR #455 (MERGED); the heading states the outcome — all 51 worktrees removed, all 3 unattributed ones identified. Nothing outstanding: verified live, `git worktree list` returns 2 entries.'),
  X('ColdLion Phase 6 baseline drift diagnosis',
    'Ingested. Delivered by PR #426 (MERGED) and triaged by PR #428, which verified all five of its claims against live preview and production. Its outstanding work became the health-lane re-pin request, carried by WI-50.'),
  M('Licensor/property taxonomy: unmatched codes', WI_CLOUDSQL),
  X('ColdLion MG07 "Style Guide" doc lookup',
    'Ingested and taken over. Delivered by intake PR #366, which has its own matching `## TAKEN OVER` block at the bottom of this file. Its one residual — documenting the MG07-becomes-populated case — is a separate live request carried by WI-33.'),
  N('EXAMPLE TEMPLATE BLOCK',
    'Documentation, not work. Its own heading says "EXAMPLE TEMPLATE BLOCK (not real work — do not action, do not delete)". The template it demonstrates retires with the file; the replacement is `gh issue create`.'),
];

// ---------------------------------------------------------------------------

export async function buildInventory(path) {
  const parsed = await loadIntake(path);
  const blocks = migratingBlocks(parsed);
  const errors = [];
  const rows = [];

  if (blocks.length !== CLASSIFICATION.length) {
    errors.push(`The file holds ${blocks.length} blocks in the migrating sections but the classification list has ${CLASSIFICATION.length} entries. A block was added, removed or moved — reclassify it, do not adjust the count.`);
  }

  const n = Math.min(blocks.length, CLASSIFICATION.length);
  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    const [fragment, verdict, detail] = CLASSIFICATION[i];
    if (!b.heading.includes(fragment)) {
      errors.push(`MISALIGNED at position ${i} (line ${b.line}): expected a heading containing\n      "${fragment}"\n    but found\n      "${b.heading}"`);
      continue;
    }
    if (verdict !== 'MIGRATE' && !detail) {
      errors.push(`Block at line ${b.line} is ${verdict} with no reason: "${b.heading}"`);
    }
    rows.push({
      line: b.line,
      section: b.section,
      kind: b.kind,
      heading: b.heading,
      date: headingDate(b.heading),
      backlogRefs: backlogRefs(b.body),
      verdict,
      workItem: verdict === 'MIGRATE' ? detail : null,
      reason: verdict === 'MIGRATE' ? null : detail,
    });
  }

  const counts = { MIGRATE: 0, CLOSED: 0, NOISE: 0 };
  for (const r of rows) counts[r.verdict]++;
  const total = blocks.length;
  const sum = counts.MIGRATE + counts.CLOSED + counts.NOISE;
  if (sum !== total) {
    errors.push(`ARITHMETIC FAILED: ${counts.MIGRATE} migrate + ${counts.CLOSED} closed + ${counts.NOISE} noise = ${sum}, but the file holds ${total} blocks in the migrating sections.`);
  }

  const workItems = new Map();
  for (const r of rows) {
    if (r.verdict !== 'MIGRATE') continue;
    if (!workItems.has(r.workItem)) workItems.set(r.workItem, []);
    workItems.get(r.workItem).push(r.line);
  }

  return {
    source: { path: path ?? 'COORDINATOR_INTAKE.md', totalLines: parsed.totalLines },
    counts: { ...counts, total, workItems: workItems.size },
    workItems: [...workItems.entries()]
      .map(([title, blockLines]) => ({ title, blockLines }))
      .sort((a, b) => a.title.localeCompare(b.title, 'en')),
    blocks: rows,
    errors,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const inv = await buildInventory();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(inv, null, 2));
  } else {
    const { counts } = inv;
    console.log(`COORDINATOR_INTAKE.md — ${inv.source.totalLines} lines`);
    console.log(`Blocks in the migrating sections: ${counts.total}`);
    console.log(`  MIGRATE ${counts.MIGRATE}  +  CLOSED ${counts.CLOSED}  +  NOISE ${counts.NOISE}  =  ${counts.MIGRATE + counts.CLOSED + counts.NOISE}`);
    console.log(`Distinct WORK ITEMS (= issues to create at step 6): ${counts.workItems}\n`);
    for (const wi of inv.workItems) console.log(`  ${wi.title}\n      blocks at line: ${wi.blockLines.join(', ')}`);
  }
  if (inv.errors.length) {
    console.error('\nFAILED — the inventory is not complete:');
    for (const e of inv.errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.error('\nOK — every block is classified, the list lines up with the file, and the arithmetic balances.');
}
