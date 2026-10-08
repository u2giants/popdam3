---
issue: 3536
status: OPEN
owner: mimo/3536-takeover-20261007
---

# shared-db #3536 — CI audit rows 8 and 12 closeout handoff

Posted for successor continuation of the original whole-twelve CI audit on parent
issue #3536. Ten original outcomes remain accepted; row 8 (queue pair retirement)
and row 12 (reviewer relief + installation/live) remain unfinished.

## 0. Business decisions only the owner can make

None. All remaining work is technical: land open PRs, run governed reviews,
complete installation T and installed/live proofs. Albert must perform no manual
steps and no technical approval.

## 1. What this application is

popcre/shared-db is the canonical shared database shape and governance repository.
This workstream is repository maintenance (CI workflows, reviewer circuit-breaker,
queue retirement, installed AI tooling). It authorizes NO database shape/data
change and NO production mutation. Host for private evidence: edge-dev3 (Linux).
Windows coordinator host for this session: windows-edge.

## 2. Session goal and authority

Albert: take over popcre/shared-db issue #3536, read and follow the complete
published handoff, coordinate subagents in parallel, preserve branch
`codex/3536-fresh-whole-plan-handoff-20261007`, do not reset limits, credential
rotation is closed, recover required private evidence from edge-dev3 without
substituting verification, keep audit execution stopped until restart conditions
are satisfied, complete both unfinished outcomes with installed and live proof.
Later: "spin up subagents to do the work and bring the overall issue to completion."
Then `/wrap-up`.

Canonical published wrap handoff (read in full this session):
`HANDOFF.d/2026-10-07T2147Z-edge-dev3-codex-whole-acceptance-wrap.md` on main
(f435616ee / PR #4055). Successor prompt recovered from
`/home/ahazan/.local/state/ai-devops/private-evidence/3536-wrap-20261007/3536-next-session-prompt.md`
on edge-dev3.

Credential rotation remains CLOSED (6040953857). No limits, budgets, paid starts,
or immutable histories were reset.

## 3. Exact current state (re-verified 2026-10-08 1:39 PM EDT / 17:39 UTC)

- Parent issue #3536: OPEN, labels db-work / non-orchestrator / parked.
  Body still shows ten original accepted and two unchecked rows (8 and 12).
- Preserved branch `codex/3536-fresh-whole-plan-handoff-20261007` HEAD
  `5a3b2878da220c9009f2d55fbce2d6a1434b0ca3` intact on origin (admission gate).
- origin/main at check time: `64f1edb5c737c91e7dc75f9195f235b39358b0ef`
  (moved often during this session; re-fetch before acting).
- PR #4069 **MERGED** 2026-10-08 1:53 PM EDT, merge `8bc51f3a484862cf8a7f97fa4f378bc95fbd4569`.
  Guard security restore (14 paths from 65bb) + PR-data host-loader env sanitize.
  Muse APPROVE on 4beda6d7 carried via content-equivalence to tip c15c38b8b.
  Branch mimo/3536-guard-4050-takeover is on main (safe to retire worktree).
- PR #4050 **CLOSED** 2026-10-08 as fully superseded by #4069 (no unique proof).
  Charged REVISE 5699 history preserved (no refund/reset).
- PR #3998 OPEN head `7d695133813111eda067f50b16c83d222bde9e15` (MERGEABLE at
  last check; re-verify). Queue retirement source refreshed with main including
  #4069. Evidence pair rebound. Worktree `C:/repos/shared-db-wt-3536-queue`.
- PR #3999 OPEN head `97e55ae02e9b6ad8e168b88681b6cb9f7352d81f` (MERGEABLE at
  last check). Circuit-breaker source with producer-pin ancestry fix. Worktree
  `C:/repos/shared-db-wt-3536-circuit`. All seven paid-start heads remain
  first-parent ancestors (1efd7a02, 2f61e023, 5df4a969, 5f3cb5ee, 747e097e,
  a6df4383, c2711bcd).
- PR #4078 (`fix(#3806)` verdict-ref ceiling archive) is **MERGED** at head
  `a74a719224272514a9e274e3ce308c700fc4caf0` (verified after wrap-up started).
  This clears the collision that blocked #3999 reviewer draws
  (`scripts/manage-migration-author-lanes.mjs`).
- PR #4002 (`acde6c92`) still OPEN — serialized queue route after row 8.
- Handoff publication PRs #4034 / #4036 still OPEN (do not touch; publisher-owned).
- GLM official quota last read EXHAUSTED (2026-10-07 5:27:53 PM EDT). No
  generation, paid probe, unpause, or reset. Phase7 GLM live proof stays pending.

### Preview / production

Nothing applied to preview or production. No database writes. No settings writes
this session (settings12 already live from prior work; readback confirmed).

## 4. Attempts that did NOT work (mandatory)

1. Two-commit evidence-pair rebuild orphaned paid-start first-parent ancestry on
   #3999 (`review budget complete first-parent ancestry unavailable`). Fix:
   keep historical start heads as ancestors; merge main on top of last impl commit
   rather than rebuilding from main.
2. Merging main without restoring owned `scripts/production_business_risk_gate.py`
   bytes made both merge parents match protectedMain's pin blob →
   `review budget producer pin protected parent is ambiguous`. Fix: keep owned pin
   blob distinct on the implementation side (restore from f2901a131) so exactly
   one parent is ancestral and matches protectedMain.
3. `contract_sha256` must be `contractHash()` (canonical JSON), not raw file
   SHA256. Raw hash fails `validatePullRequestCompletion`.
4. Published contract refs are immutable — after base/head rebound, publish a NEW
   generation (329/330), never rewrite 327/328.
5. Evidence tail must be exactly the two pair files after `report.head_sha`; if a
   main merge brings `.agent/` files into the impl diff, delete them in the impl
   commit and re-add as the tail.
6. `GitHub pull.base.sha` is the merge-base, not live main tip. Nonclosing
   maintenance binding compares it to `io.mainSha()` (live tip) — any main push
   breaks the bind until refresh + (usually) a new exact-head review.
7. Content-equivalence (#2758) carries an APPROVE only when the approved head is a
   true ancestor and the PR diff is byte-identical ignoring only `.agent/` files.
   History rewrite breaks carry-forward even when the net diff matches.
8. Qwen draw (seq 5887) emitted zero verdict lines; replace with
   `wrapper_terminal_failure` + `--confirm-no-verdict --confirm-no-artifact`.
   Replacement draws need `--replacement-sequence <failed-seq>` or recording reads
   the stale assignment cursor.
9. StepFun wrapper timed out (seq 5826); same replacement path.
10. Muse `new` is single-use per session name; reuse with `ask`.
11. `refresh-code-pr-branch.mjs` refuses unless completion checks match its
    standard strings; manual rebind + re-prove is the documented fallback.
12. Verdict namespace hit the 1000-ref ceiling; archived 36 settled refs via
    `--archive-old-review-verdicts --apply-recovery` (remaining 965 at that time).
    Long-term fix is PR #4078 (now merged).
13. Documents-only checks fail on code PRs by design; they are not required
    contexts for #4069-style changes.
14. Windows: `core.autocrlf=true` and `core.filemode=false` break fixture tests
    that string-match after `git merge` or use `chmodSync` for modes. Use
    `core.autocrlf=false` / `core.eol=lf` / `git update-index --chmod=+x` +
    chmod on disk.
15. `LD_LIBRARY_PATH` from setup-python made `validatePrDataRoot` refuse the whole
    process env. Fixed in #4069 via `sanitizePrDataEnv` default (explicit env
    injection still refused).

## 5. Exact next steps and verification gates

Ordered gates (row 8 then row 12), from plans
`.ai/tmp-3536-row8-plan.md` and `.ai/tmp-3536-row12-install-plan.md`:

1. **Land PR #3999** (circuit evaluator). 4078 collision is cleared.
   - Verify seven paid-start heads still ancestors of live head.
   - `--assign-reviewer --issue 3536 --pr 3999 --head-sha <live>`.
   - Governed review with terminal `VERDICT: APPROVE|REVISE|REJECT <head>`.
   - Immediately `guarded-migration-merge.yml -f pull_request=3999 -f head_sha=<head>`
     while base matches main; else refresh (impl+pair-tail) and content-equivalence.
   - Gate: MERGED + fetched ancestry. Then actual merged-protected evaluator live
     capacity proof (handoff Phase5).
2. **Land PR #3998** (queue pair retirement). After 3999.
   - Refresh if CONFLICTING; rebind pair; re-run local checks.
   - Proofs already collected: settings12 readback (12 contexts, strict:false,
     app 15368), Queue-sensitive aggregate SKIPPED, absent queue producer.
   - Still needed: 13 nonself producers + legitimate self14 before/under lock;
     guarded merge; mirror/settings12; serialize #4002 after.
   - Do not change frozen queue source or required settings to manufacture success.
   - Gate: MERGED + ordinary-PR negative proof + settings12 agreement.
3. **Installation T (row 12).** Six inputs recovered at
   `.ai/tmp-3536-evidence/six-inputs/` (sha256-verified). Rebind Am.1–Am.6 to a
   new immutable T after 1394/1397/1398/1419 + 3999 source are current. One
   independent operation APPROVE; foreign inactivity + exclusive lock; one-use
   updater; installed readback.
4. **Installed/live (Phase7).** Pause/global identity/holds; DeepSeek two-turn cap;
   Gemini+DeepSeek live credit; timer + cadence skip; four official readers;
   GLM well-formed only after genuine capacity (currently EXHAUSTED).
5. Tick rows 8 and 12 on #3536 only with real installed and live proof. Keep
   parent OPEN until all twelve original outcomes are accepted. Never Closes
   #3536 from a partial PR. No leftover-proof tickets.

## 6. Constraints and gotchas

- Never reset limits, budgets, paid starts, or immutable histories.
- Credential rotation CLOSED; remaining binary transcript cleanup is nonblocking.
- Exact-head APPROVE required; only .agent/ content-equivalence may carry.
- Nonclosing binding: exactly one `Refs #3536`, signed attribution line, PR base
  must match live main at draw/merge time.
- SHARED_DB_AUTHOR_ENGINE=zcode (MiMo maps to zcode). AI_MUSE_CALLER=codex or
  AI_STEPFUN_CALLER=codex when those wrappers run.
- Private evidence stays private; no credential values in any file or comment.
- Worktree-only edits; never admin-merge; never force another owner's branch.
- Times in EST (America/New_York) in human-facing notes.

## 7. Access and environment

- gh CLI on Windows and edge-dev3; ai-devops toolkit at
  `/home/ahazan/repos/ai-devops/bin/` on edge-dev3.
- Private evidence roots on edge-dev3:
  `/home/ahazan/.local/state/ai-devops/private-evidence/3536-verification-20261007`,
  `.../3536-wrap-20261007`, `/home/ahazan/.codex/private-evidence/3536-publication-audit-20261007`.
- Six install inputs recovered from Codex transcripts (see
  `.ai/tmp-3536-evidence/six-inputs/recovery-report.md`). Original
  `/tmp/ai-devops-3536-native-credit-recovery-20261007` is gone; do not invent.
- Large git bundles remain on edge-dev3 only (hashes in recovery report).
- GLM reader: `/home/ahazan/repos/ai-devops/tools/glm_credit.py`; last official
  read EXHAUSTED. Never reveal key values.

## 8. Open questions, risks, ownership and self-audit

- No business questions pending for Albert.
- Risk: main moves quickly; each push can void a live bind and force re-review.
- Risk: GLM exhaustion blocks Phase7 GLM live acceptance.
- Risk: coherent-install-preparation listing on edge-dev3 showed 0 entries at
  wrap time (path may have been cleaned); six inputs exist locally under
  `.ai/tmp-3536-evidence/six-inputs/` — re-verify before install T.
- Self-audit: (1) stranger can resume from §§3–5 and §7; (2) failed attempts in
  §4; (3) remaining requirements in §5; (4) no owner-only decisions.

### Coordination state

- Live workstreams: #3999 circuit (worktree circuit), #3998 queue (worktree
  queue), #4002 serialized route (after 3998), installation/live (after source).
- Owned dirty worktrees: none observed (all three clean at wrap).
- Preview: not written this session.
- main SHA and max migration version must be re-fetched at next session start.

### Per sub-agent (this session)

#### Agent: general evidence recovery (six inputs + wrap private files)
- Asked to: recover private evidence from edge-dev3 without substitution.
- Actually did: 188 small files copied to `.ai/tmp-3536-evidence/`; six
  installation inputs recovered byte-exact from Codex transcripts (hashes match).
- Found: native-credit-recovery /tmp tree missing; subject.md embeds the six.
- PR / branch: n/a
- Worktree: finished (evidence only)
- Deliberately did NOT do: copy multi-40MB bundles (recorded hashes on edge-dev3).

#### Agent: guard 4069 security restore
- Asked to: restore 65bb security sources, fix acquire regex, sanitize PR-data env.
- Actually did: PR #4069 MERGED `8bc51f3a`; Muse APPROVE 4beda6d7; gen330 pair.
- Found: LD_LIBRARY_PATH false positive; quoted-path regex; pair hash rules.
- PR / branch: #4069 mimo/3536-guard-4050-takeover — MERGED
- Worktree: finished (safe to retire)
- Deliberately did NOT do: database/production writes; limit resets.

#### Agent: circuit 3999 source
- Asked to: refresh circuit-breaker preserving six starts and M1 34999.
- Actually did: Windows/Linux fixture fixes; pin-ancestry diagnosis; head
  97e55ae02 pushed with pair rebound.
- Found: first-parent ancestry and pin-parent rules (see §4).
- PR / branch: #3999 codex/3536-reviewer-circuit-breaker — OPEN
- Worktree: live (resumable) `C:/repos/shared-db-wt-3536-circuit`
- Deliberately did NOT do: reviewer draw while 4078 collision open; no merge.

#### Agent: queue 3998 refresh + proofs
- Asked to: refresh 3998 and collect row-8 proofs.
- Actually did: merged main (incl. 4069); pair rebound to 7d6951338; proofs A/B/C
  in `.ai/tmp-3536-row8-proofs.md`.
- Found: settings12 already live; aggregate SKIPPED + absent producer proven.
- PR / branch: #3998 codex/3536-queue-retirement — OPEN
- Worktree: live `C:/repos/shared-db-wt-3536-queue`
- Deliberately did NOT do: paid review (gated on 3999); 13+self14 producer proof.

#### Agent: 4050 supersession
- Asked to: compare 4050 vs merged 4069.
- Actually did: closed #4050 as superseded; 5699 history preserved.
- Found: 4069 is a security superset; no unique required proof on 4050.
- PR / branch: #4050 CLOSED
- Worktree: finished
- Deliberately did NOT do: merge 4050; reset limits.

#### Agent: 4078 unblock (started, then session restarted)
- Asked to: land #4078 so #3999 can draw reviewers.
- Actually did: process restarted before completion; #4078 is now MERGED
  (a74a7192) — likely another session or late CI. Verify before relying.
- PR / branch: #4078 MERGED
- Worktree: n/a
- Deliberately did NOT do: expand #3806 scope.

## 9. Outstanding work seeded on the same issue (no new tickets)

Outstanding items live on parent #3536 as this handover comment + this file.
Do not open leftover-proof issues. Next session continues rows 8 and 12 on
#3536 only.

## 10. Secrets and docs (wrap closeout)

- Secrets sweep: no new credentials appeared this session. Credential rotation
  remains CLOSED. No vault writes. (Private evidence files contain no secrets by
  design; install inputs are non-secret templates/inventories.)
- Docs pass: no AGENTS.md rule was disproved by this session. Durable lessons are
  recorded here and in `.ai/tmp-3536-row8-plan.md` /
  `.ai/tmp-3536-row12-install-plan.md` / `.ai/tmp-3536-evidence/six-inputs/recovery-report.md`.
  Nothing outside this handover was found stale enough to supersede in-tree docs.
