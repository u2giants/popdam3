---
issue: 1152
status: OPEN
owner: claude-20260818-005914Z
---

# HANDOFF — shared-db orchestrator (2026-08-18 12:15 UTC, al8960ofc/Claude)

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now

**Sample Tracking Release A production promotion is blocked on a design choice.** See §4. Albert already gave final approval for the scope, and separately approved promoting on preview evidence pinned to an earlier commit. The remaining question is HOW to satisfy a gate rule that this batch's own history makes unsatisfiable. Three options are written out in issue #1149 and in §4. Do not pick one silently.

### Already settled — do not re-ask

- Qwen is excluded from all new reviewer assignments until Albert restores it.
- Release A scope is exactly `20260814130000`, `20260814193402`, then the reconciliation, in that order. Releases B, D, E excluded. No application repository changes.
- Albert approved promoting on the preview evidence pinned to `c044d68` even though the merged head was `e4e01a5`.
- `COORDINATOR_INTAKE.md` stays retired and unwritten.
- The reconciliation's version was re-reserved from `20260817190000` to `20260818024441` by the governed supersession tool, because main had advanced past it and the backdated-migration guard refused it. Git reports a 100% similarity rename: the SQL is byte-identical. Albert was told.

## 1. What this session was asked to do

Take over as sole orchestrator, verify live state, resume #1115 first. Mid-session Albert made Sample Tracking Release A the highest priority and asked for it to be driven to production autonomously. Later he asked for Grok's advice on a durable fix for the gate blocking it, then for that fix to be implemented and Release A finished.

## 2. What actually shipped

| PR | what | state |
|---|---|---|
| #1126 | Release A reconciliation + first generated types | **merged** `46b01e3c` |
| #1155 | `generate-database-types.yml`, the repo's first types generator | **merged** |
| #1157 | production gate: bind preview proof to bytes, not commit identity | **merged** `d6752de` |
| #1154 | reviewer registry says GLM 5.2 while `ai-glm` runs 5.3 | **open, green** |
| #1117 | #1115 bulk OrderList relink | **open, green, GLM-approved on `036c596`** |
| #1145 | #1090 licensing forward | **open, green, needs a fresh review** |

Also: preview repaired so all Release A objects exist; truthful generated types committed for the first time in this repo's history; marker #1152 opened; takeover comments on #1146–#1149.

## 3. Current state — VERIFY, do not trust these

- `origin/main` was `d6752de69e8a68fa1e6108e45d7848d48e68772e` at 12:10 UTC.
- **Production `qsllyeztdwjgirsysgai` was NOT written to in this session.** Every production apply attempt failed at the evidence gate with `Production apply (automatic evidence gates)` **skipped**. Verified job-by-job on runs 32095202510, 32095324546, 32095460718, 32135255050.
- Preview `rjyboqwcdzcocqgmsyel` WAS written once: `20260818024441` applied by run 32093350643. Ledger delta exactly +1. Six unrelated pending versions were skipped by name.
- No coordination lock held; only `refs/db-coordination/reviewer-round-robin` exists.
- Three author lanes occupied: #1116 (#1115), #1125 (#975), #1144 (#1143). Queue audit: zero dispatchable, one structural issue waiting (#555, blocked), 86 non-structural skipped.

## 4. THE BLOCKER — read before touching Release A

Two blockers appeared in sequence. The first is fixed. The second is not.

**Blocker 1 — FIXED by #1157.** The gate proved a rehearsal by comparing commit IDs. A generated-types commit landing after the preview apply permanently stranded the promotion, because an applied version can never be re-rehearsed. Now bound to migration BYTES plus provenance. Merged and proven: the production apply now gets past it.

**Blocker 2 — OPEN.** `preview ledger delta must add exactly the allowlist once and remove nothing`.

The approved batch is three versions. The rehearsal added one, because the two 2026-08-14 versions were already in preview from August. Production has none of the three.

| version | in preview before the rehearsal | in production |
|---|---|---|
| `20260814130000` | yes, since 2026-08-14 | no |
| `20260814193402` | yes, since 2026-08-14 | no |
| `20260818024441` | no, added by the rehearsal | no |

The rule is sound: it stops a batch being promoted on a rehearsal of only part of it. But this batch's history makes it unsatisfiable, and the two originals cannot be re-rehearsed.

The historical no-write path (`historical_preview_source_pr`) is the designed escape, but `historical_preview_recovery.py` proves that ONE source PR authored EVERY allowlisted migration. Two PRs are involved here, so it does not fit as written.

Options, also recorded on #1149:

1. **Extend the historical proof to a per-version source-PR map.** Root cause; matches how the batch was genuinely authored. Touches the production gate again, so it needs its own independent review.
2. **Promote in two bounded events** — the originals under a historical proof from their own PR, then the reconciliation under its existing rehearsal. Changes the shape of the approved single batch. Note the reconciliation's own preconditions require both predecessors present, so ordering still holds.
3. **Stop.** Leave Release A merged and preview-correct but unpromoted.

## 5. What did NOT work — do not repeat these

- **Re-running preview to refresh evidence.** Refused: `validate_candidates()` blocks re-applying a version already in the target ledger, in dry-run AND apply. Its message says "already applied on production" even when the target is preview — shared wording, documented at `.github/workflows/shared-supabase-migrations.yml:365`. It does NOT mean production was touched.
- **The owner-decision hatch for the `head_sha` error.** `prove_preview()` runs BEFORE the owner-decision branch and raises unconditionally; the hatch accepts only the five derived BUSINESS risks. Verified in code before asking Albert to post an approval block that would have failed.
- **Backgrounding the AI reviewers** (`nohup ai-glm new ... &`). The session is created but the response never lands, and the wrapper then reports the session busy for 300s. Run reviewers in the FOREGROUND.
- **Trusting Grok's design unreviewed.** Grok recommended accepting a rehearsal from any commit of the PR. GLM showed that admits a complete forgery: dispatch preview at a commit carrying a doctored workflow that fabricates the evidence files, then restore it, leaving the reviewed diff clean. Three rounds of Critical findings followed, each one hop deeper — the lanes script that runs first, then a pinned script's unpinned import. The final design WALKS the execution closure instead of hand-listing it, because the hand list rotted twice in one afternoon.
- **The rotation's assigned reviewer for #1157.** It assigned Grok, which authored the design. Not independent. GLM was used instead and both roles are recorded on the PR.
- **GitHub runner package mirrors** stalled `Install psql` and `Install SQL check dependencies` for 26+ minutes twice, on steps that normally take seconds. Cancel and rerun clears it. Not our code. If such a run holds the preview lock, cancelling still releases it, because the release step is `if: always()` — verified.
- **Heredocs containing regex backslashes** through the shell mangled `\n` and `\b` into literal control characters more than once. Use the file-editing tools for code containing escapes.

## 6. Exact next steps

1. Take Blocker 2's option choice to Albert using #1149. **Verification:** the choice is recorded on #1149 before any gate edit.
2. If option 1: extend `historical_preview_recovery.py` to a per-version source-PR map, with tests, reviewed by a party that did NOT design it. **Verification:** independent APPROVE on the exact head with no Critical or High.
3. Complete Release A production: freeze merges, prove `qsllyeztdwjgirsysgai` immediately before the write, apply the three versions in the approved order, verify tables/fields/rules/triggers/functions/carrier rows/shipment protections/inventory view, run the Release A contract against production read-only, release the freeze, close #1149 and release claim #1125. **Verification:** ledger shows each version exactly once and unrelated pending versions are untouched.
4. Merge #1154. Green, low risk, and it corrects reviewer attribution in permanent evidence.
5. #1115: GLM-approved on `036c596`, all checks green. Needs bounded preview, guarded merge, production. With #1157 merged a follow-up commit no longer strands it, but still do the preview as the LAST action before merge.
6. #1090 / #1145: needs a fresh exact-head review. The interrupted sequences 154, 155 and 157 are not approval.
7. Open follow-ups filed this session: #1153 (reviewer label), #1156 (gate identity — closed by #1157), #1158 (atomic path mixes raw-byte and CRLF-normalised digests, so a CRLF atomic migration can never pass).

## 7. Constraints in force

- Production is `qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`. Prove the target immediately before every write.
- Exact-head review evidence expires whenever the reviewed head changes.
- `20260817150944` is preview-history restoration and is production-held. Never promote it.
- Never `git add -A`, reset or clean in the main checkout. Use worktrees.
- Delegated reviewers get a self-contained review copy, never a raw linked worktree.
- Never supply risk booleans or prose as production evidence.

## 8. Access and environment

- `C:\repos\shared-db` was **empty** at session start and was re-cloned. **All previous worktrees were gone**, including `C:\repos\shared-db-wt-1113\.private\item-mg-taxonomy-20260817`, which the previous handoff flagged as possibly the only copy of the Item Master taxonomy review (3,961 classified parser outputs, 110 accepted, 5 reviewed aliases, 10 placeholders, 245 source rows reviewed). Searched the machine; not found. **No code was lost** — every branch was on origin and the three lane worktrees were rebuilt from it.
- Worktrees created this session: `shared-db-wt-1115`, `shared-db-worktrees/issue-1143-fr-ruling-forward`, `shared-db-worktrees/issue-975-release-a-promotion`, `shared-db-wt-gate`, `shared-db-wt-gate-rev`, `shared-db-wt-handoff`.
- `gh` authenticated as `u2giants`. Git identity verified as `Albert Hazan <u2giants@users.noreply.github.com>` before the first commit.
- Supabase credentials exist only as GitHub secrets and were deliberately not brought onto the laptop. That is why the types generator runs in CI.
- Secrets sweep: no new credential was introduced this session; nothing to store in 1Password.

## 9. Open questions and risks

- Blocker 2 is unresolved and Release A is the owner's stated top priority.
- The production gate produced three Critical findings in one day. Treat further edits as high-risk and always have them reviewed by a party that did not design the change.
- Claim #1116's author lease expired at 2026-08-18T01:19Z. Expiry is an audit warning, not a release, and the tool only permits renewal of an already-expired lease — renew it or accept the audit noise.
- GitHub runner package mirrors were intermittently stalling; the same class of hang may recur.
- The types artifact currently describes preview, which is ahead of production until Release A promotes. That window is intentional and documented in `types/README.md`, but consumers building against it before promotion will see objects production does not yet have.
