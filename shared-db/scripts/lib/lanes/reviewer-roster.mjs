// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { wrapperEmitsGovernedVerdict } from '../../lib/reviewer-capabilities.mjs'
import { execFileSync } from 'node:child_process'
import { LaneError } from './claims.mjs'
import { parseReviewCursor, readReviewReturns } from './review-records.mjs'
import { parseReviewReplacement } from './review-replacement.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'
import { readSessionId } from '../session-authority.mjs'

//
// `readsRepository` RECORDS A FACT ABOUT THE WRAPPER, NOT A PREFERENCE (#2078).
// `true` means the wrapper hands its model a real, self-contained checkout of the
// code under review and the model can open files in it. `false` means the wrapper
// is a conversational API client: it sees only the text of the brief it is given,
// so it can only review the change as DESCRIBED, never as WRITTEN. Verified per
// wrapper in ai-devops/bin before this field was written, not assumed:
//   ai-grok-review    -- `--cwd` on a real checkout, read-only permission set.
//   ai-glm            -- OpenCode session pinned to the review directory, read-only agent.
//   ai-kimi           -- read-only agent profile over the checkout/worktree.
//   ai-muse           -- `ai-review-sandbox ensure-copy` clone plus an evidence packet;
//                        its live doctor probe reads a file inside that directory.
//   ai-codex-review   -- `codex exec --sandbox read-only` over the sandbox copy.
//   ai-deepseek-agent -- until 2026-09-23 an HTTP conversation only (the retired
//                        'deepseek-chat' row). Since popcre/ai-devops PR #730 its
//                        --review mode reads the exact-head snapshot through
//                        read-only list_dir/read_file/grep tools ('deepseek-v4.1-flash').
// A `false` entry can never record a code-review verdict; see recordReviewVerdict.
//
// THIS IS A HAND-MAINTAINED CROSS-REPOSITORY CLAIM, AND IT CAN ROT (#2079).
// The wrappers live in `u2giants/ai-devops`, not here. No check in THIS
// repository can open them, so nothing mechanical re-verifies these values: if
// `ai-muse`'s sandbox copy or `ai-kimi`'s read-only profile changes upstream,
// the roster keeps saying `true` and the gate keeps recording confabulations
// with full ceremony. Rather than pretend that is solved, every entry records
// WHEN the claim was checked and AGAINST WHAT, so staleness is visible instead
// of implied. `date` is the day a human read the wrapper; `evidence` is the
// exact wrapper behaviour that was read. Treat an old date as UNVERIFIED and
// re-read the wrapper before trusting its `true`.
export const REVIEWERS = Object.freeze([
  { name:'grok-4.6', provider:'grok', wrapper:'ai-grok-review', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-grok-review: grok --cwd <checkout> with a read-only permission set' } },
  { name:'glm-5.3', provider:'glm', wrapper:'ai-glm', orchestratorEngine:'glm', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-glm: OpenCode session pinned to the review directory, read-only agent' } },
  { name:'kimi-k3', provider:'kimi', wrapper:'ai-kimi', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-kimi: read-only agent profile over the checkout/worktree' } },
  { name:'qwen-3.8-max', provider:'qwen', wrapper:'ai-qwen', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-07', evidence:'ai-devops/bin/ai-qwen: read-only review over a sealed evidence packet copy of the checkout; the live qualification review of merged commit 795902d8 cited specific file lines from it and returned a well-formed verdict' } },
  { name:'glm-5.2', provider:'glm', wrapper:'ai-glm', orchestratorEngine:'glm', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'historical label for the ai-glm wrapper above; same checkout' } },
  { name:'muse-spark-1.2-contributor', provider:'muse', wrapper:'ai-muse', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'historical label for the ai-muse wrapper; durable assignments and verdicts recorded before issue #2285 still resolve through this row' } },
  { name:'muse-spark-1.3-contributor', provider:'muse', wrapper:'ai-muse', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-23', evidence:'ai-devops/bin/ai-muse muse-code engine (pinned Muse Code 1.3.0-R3233.1): sealed evidence-packet checkout; live native-engine qualification 2026-09-23 (popcre/ai-devops#542 D1) identified bare model muse-spark-1.3-contributor, cited tools/reviewer_usage.py and bin/ai-muse with line evidence, returned VERDICT: NO FINDINGS under REQUIRE_VERDICT, and retained non-null durable-store usage with a catalog-priced estimate. That NO FINDINGS line came from `ai-muse review`; governed reviews may run ai-muse only through `new`/`ask`, which scripts/run-governed-review.mjs enforces before start (#2831)' } },
  { name:'codex-gpt-5.6-sol', provider:'codex', wrapper:'ai-codex-review', orchestratorEngine:'codex', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-codex-review: codex exec --sandbox read-only over the sandbox copy' } },
  { name:'deepseek-chat', provider:'deepseek', wrapper:'ai-deepseek-agent', readsRepository:false,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-deepseek-agent: HTTP chat completions only; --worktree sets a spawn cwd it never uses' } },
  { name:'gemini-3.8-flash-high', provider:'gemini', wrapper:'ai-gemini', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-06', evidence:'ai-devops/bin/ai-gemini: disposable sandbox copy of the checkout under --sandbox with a byte inventory; the live re-qualification review of merged commit 99fbefcb cited specific file lines from it' } },
  // Appended 2026-09-23 (owner instruction "put DeepSeek back on the reviewer list").
  // A NEW name, not an un-retirement: 'deepseek-chat' stays retired because its
  // durable refs record reviews made without repository access (#2078).
  { name:'deepseek-v4.1-flash', provider:'deepseek', wrapper:'ai-deepseek-agent', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-23', evidence:'ai-devops/bin/ai-deepseek-agent --review (PR #730 plus dd46fa46, model deepseek-flash): read-only list_dir/read_file/grep over the exact-head review snapshot, secret and .git paths refused, bounded loop; ai-review-preflight check deepseek --live PASSED and the live review of merged commit e2e41104 cited tools/ci/runner-router.cjs and verify.yml line numbers and ended VERDICT: REVISE e2e41104735a0c3e1981dabccbdc9089f109d970' } },
  // Appended 2026-09-25 (owner instruction "put stepfun into the reviewer rotation").
  // UBUNTU/LINUX ONLY: StepCode has no Windows build and the wrapper needs bubblewrap
  // (Linux only). The allocator stays platform-agnostic on purpose -- on any other OS `ai-review-preflight usable` reports
  // stepfun `unsupported-platform` / usable:false, so allocatableReviewers() skips it
  // on that machine exactly like any other unusable provider.
  { name:'stepfun-step-5-preview', provider:'stepfun', wrapper:'ai-stepfun', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-25', evidence:'ai-devops/bin/ai-stepfun review (PR popcre/ai-devops#849, merged f1758c21): StepCode step/step-5-preview with only read/grep/find/ls under strict approval, inside bubblewrap (only /usr, /etc and its own read-only review copy mounted; empty home, /tmp, /run; cleared environment), over the shared sealed evidence packet (MANIFEST.md) re-verified after the run; live review of 94bf83c6 on 2026-09-25 cited bin/ai-stepfun line numbers and ended VERDICT: REVISE 94bf83c64889c2c29e229a2faa66d8ee183e911c; on edge-dev3 (Ubuntu) 2026-09-25 `ai-stepfun doctor --live` printed `OK step=0.1.1 model=step/step-5-preview live=verified` and `ai-review-preflight usable stepfun` returned {"provider":"stepfun","status":"installed-healthy","usable":true,"registry_state":"registered"}. A future retirement must add this name to RETIRED_REVIEWERS and keep the row' } },
])
// Keep REVIEWERS as the historical evidence registry. Paused providers remain
// readable forever, but only ACTIVE_REVIEWERS can receive new work.
//
// WHY 'glm-5.2' IS STILL LISTED BUT NOT ACTIVE
// -------------------------------------------
// The `ai-glm` wrapper has pinned MODEL=glm-5.3 (ai-devops/bin/ai-glm), so every
// review routed through it was ALREADY running on 5.3 while this registry
// recorded it as 'glm-5.2'. The model was right; the label was wrong, and the
// label is what lands in durable review evidence. Corrected here at the source.
//
// 'glm-5.2' is deliberately NOT deleted. Reviewer names are read back out of
// permanent coordination refs (`parseReviewCursor` -> `REVIEWERS.find(...)`), so
// every historical GLM review recorded before this change still has to resolve to
// a wrapper. One of those lookups is not null-guarded, so a missing name is a
// crash, not a graceful miss. Retired names stay readable forever; only
// ACTIVE_REVIEWERS receives new work -- the same exclusion QUARANTINED_REVIEWERS applies.
//
// 'glm-5.3' occupies the SAME rotation slot 'glm-5.2' held, so no in-flight
// sequence is reassigned out of order. It no longer keeps ACTIVE_REVIEWERS at the
// same LENGTH -- issue #1290 changed the length from two to three. See the
// ROTATION SLOTS block below, which is the accurate statement.
//
// RESTORED 2026-08-20 (owner instruction, issue #1290): 'glm-5.3'.
// ITS PAUSE ON 2026-08-18 WAS A FALSE DIAGNOSIS, and the diagnosis is the lesson.
// The three `provider_unavailable` failures -- sequences 161, 164 and 167 -- were not
// the remote provider being down. `ai-glm doctor` showed every check passing EXCEPT
// `health endpoint answers`, because the LOCAL `opencode` server was not running.
// `opencode-glm-launch` fixed it in about thirty seconds, and glm-5.3 then produced a
// full 10 KB review with a coverage statement on the first attempt. One stopped local
// process cost a two-day reviewer outage.
//
// WHY THAT COULD HAPPEN, and what was done about it (#1287, CLOSED by the three
// changes below; ai-devops#45 fixed the wrapper half upstream):
//
//   1. `provider_unavailable` conflated "the remote provider is down" (wait) with
//      "a local dependency of the wrapper is not running" (thirty-second fix).
//      `local_dependency_unavailable` is now a separate terminal code -- see
//      TERMINAL_FAILURE_CODES -- and `replaceFailedReviewer` REFUSES to spend a
//      rotation slot on one until the operator states the local fault cannot be
//      fixed on this machine. A working provider no longer collects permanent
//      failure evidence because a background process stopped.
//   2. Recording a local fault now REQUIRES naming the failing check, and the name
//      is written into the immutable failure evidence. A failure record that
//      cannot say what broke is a guess, and the last guess cost two days.
//   3. `reviewerExecutionPreflight` runs the wrapper's own `doctor` and quotes the
//      failing check, so the operator is told "your local server is down, start
//      it" instead of a wrong verdict about a model. It refuses outright rather
//      than report ready on a probe it never ran.
//
// A pause entry below must still NAME the failing health check, or state explicitly
// that the health check passed and the failure was elsewhere. That rule is now
// enforced in code for the local-fault path, not left to the writer's memory.
//
// PAUSED 2026-08-20 (owner instruction, issue #1290): 'kimi-k3'. ELEVEN terminal
// failures against FIVE successes in a single session, in three distinct modes:
// findings discarded above the verdict heading (1), usage-limit exhaustion (1), and
// nine consecutive 6-second `exit 127` deaths. Health check: NOT the cause in the
// glm-5.3 sense -- the `exit 127` deaths are the wrapper's own launch failing, which
// is a local fault, but it is kimi's wrapper and it was not repairable in session.
// Reviewer issue `20260820T004602Z-edge-dev-kimi-k3-385556` carries the raw evidence.
// This is a PAUSE, not a retirement.
//
// UPGRADED 2026-09-08 (owner instruction, issue #2285): 'muse-spark-1.3-contributor'.
// The active slot moved from 1.2 to the live-qualified 1.3 model. The historical
// 1.2 name remains in REVIEWERS and RETIRED_REVIEWERS because immutable assignments
// and verdicts still name it; deleting or renaming it would orphan that evidence.
// On the head-to-head trial 1.3 produced a complete review ending in APPROVE.
// KNOWN DEFECT, and the caller must handle it: the wrapper's verdict DETECTION fails
// and writes "This is not a review result" over correct work. It SAVES the output, so
// every such result is fully recoverable -- READ THE SAVED ARTIFACT before recording
// any Muse failure, and never record a bare "incomplete" from this wrapper without
// having read the raw provider stream.
//
// ADDED 2026-09-06 (ai-devops issue #285): 'gemini-3.8-flash-high'. It was held out
// because `ai-gemini doctor` passed while two live attempts produced `no usable
// Gemini verdict` and then a bare `PASS` with an EMPTY report -- the worst failure
// mode for a review gate, because a decision token with no analysis behind it is
// indistinguishable from a real approval. The hold is lifted on evidence, not on
// hope: `ai-review-preflight qualify gemini` now records a live safety
// qualification bound to wrapper sha256, agy 1.1.27 and model gemini-3.8-flash-high,
// and a live review of merged commit 99fbefcb returned a well-formed
// `VERDICT APPROVE 99fbefcb4cf3388a3d46e77a2fdddb1f06bd25a1` line above 3,137
// characters of real analysis citing specific lines. The empty-report mode is also
// now caught rather than trusted: ai-devops `bin/ai-review-lifecycle` converts any
// APPROVE or REJECT whose report carries no substantive analysis into BLOCKED
// (`empty-report`), for every provider. Evidence:
// ai-devops tests/verification/reviewer-usable-reconciliation/.
//
// ROTATION SLOTS. 'glm-5.3' still occupies the slot 'glm-5.2' held. Muse was
// APPENDED, so it took the slot kimi-k3's pause vacated rather than displacing
// anyone.
// 'gemini-3.8-flash-high' was likewise APPENDED to the end of REVIEWERS, so no
// existing name changes position and no in-flight sequence is reassigned out of
// order. It only adds capacity.
//
// KIMI-K3 UNPAUSED, 2026-08-25 (owner instruction, with the lane cap raise to
// five). It returns to its ORIGINAL position in REVIEWERS, so the rotation is
// ['grok-4.6','glm-5.3','kimi-k3','muse-spark-1.3-contributor'] -- FOUR names.
// Verified before unpausing, not assumed: `AI_KIMI_CALLER=claude ai-kimi doctor`
// on edge-dev reports kimi 0.36.1, model pin kimi-code/k3, read-only profile
// PASS and `auth : OK`. Its one FAIL, `preflight (execution-context-denied)`,
// is an execution-context rule -- credentialed Kimi jobs must run from the Full
// Access main task -- not a broken install.
//
// THAT FAIL WAS INVISIBLE UNTIL THIS CHANGE, and fixing it was part of the
// unpause. `ai-kimi` and `ai-grok-review` report `<name> : PASS|FAIL|OK`, not
// the `PASS  <check>` form ai-glm, ai-muse and ai-codex-review use, so
// summarizeDoctorOutput scored kimi's output as an unrecognized format and
// therefore healthy-by-exit-status. Un-retiring a wrapper whose FAIL lines
// nothing parses would have re-armed exactly the false local-fault diagnosis
// this machinery exists to end, so parseDoctorFailures now reads both forms.
// See the note above summarizeDoctorOutput for the doctor output all five
// wrappers actually produce.
//
// WHAT THREE NAMES DOES AND DOES NOT FIX. An earlier draft of this block claimed an
// odd-length rotation removes the `replaceFailedReviewer` same-provider trap. THAT
// CLAIM WAS FALSE and a review caught it (#1290 review, High). The old refuse --
// `next durable reviewer is the same failed provider` -- fired whenever there had
// been N-1 assignments since the failure, for ANY N, so three names only moved the
// collision from ONE intervening assignment to TWO. Do not re-add an odd-length
// safety claim here; roster length was never the fix.
//
// The actual fix landed in #1297: `replaceFailedReviewer` now SKIPS every provider
// that already failed on the exact head and advances the cursor past it, refusing
// only when no other active reviewer is left. Roster length therefore buys independence
// and failure substitution, not concurrency (there is no per-provider ceiling since
// issue #3130). Historically it bought CAPACITY
// -- three reviews in flight, and for most of 2026-08-19 the rotation was
// effectively Grok alone because ai-grok-review then held a per-REPOSITORY in-flight
// lock (removed under the 2026-09-16 owner ruling, issue #3130) -- and nothing else.
//
// Capacity is worth having on its own terms: twice on 2026-08-19 a second reviewer
// overturned the first's conclusion, once by refuting an author's design rationale
// using the author's own test fixture. A rotation of one is not a rotation.
// Gemini remains outside the registry while ai-devops reviewer reliability is
// being repaired (owner instruction, 2026-08-28). Historical names are never
// deleted because durable refs use them.
//
// QWEN IS NOT RETIRED (owner instruction, 2026-09-04). Every statement that
// 'qwen-3.8-max' is retired, paused or historical-only has been removed from
// this repository, and the name is no longer carried in RETIRED_REVIEWERS.
// It is QUARANTINED instead, which is a different and narrower fact: as of
// 2026-09-04 `ai-review-preflight status qwen` reports `status: quarantined`
// with `failure_class: live-qualification-required`, live re-qualification was
// attempted that day and FAILED (`terminal-result-error`; two hand runs died
// after 900s and 240s returning no answer), and that quarantine has NOT been
// cleared. Clearing it without a passing qualification would be symptom
// suppression, so the roster keeps Qwen undrawable until ai-devops qualifies it.
// Un-quarantining is a one-line deletion from QUARANTINED_REVIEWERS below, to be
// made only after `ai-review-preflight qualify qwen` passes for real.
//
// RETIRED 2026-09-01 (issue #2078): 'deepseek-chat'. NOT a provider-quality pause
// and not a health-check failure -- `ai-deepseek-agent` is structurally incapable
// of reading the code it is asked to review. On issue #1987 / PR #1989 it produced
// a complete, confidently formatted, well-ranked review of a file name, five
// functions, two tables and two columns that DO NOT EXIST anywhere in the branch,
// and the pipeline recorded it as a durable verdict artifact bound to the exact
// head. The same run could have said APPROVE and produced a green merge gate over
// SQL no reviewer ever saw. Retirement is the correct disposition, not a pause:
// no future wrapper version fixes a conversational API client having no checkout.
// That verdict applies to the 'deepseek-chat' name and the wrapper's plain
// conversation mode only. Since 2026-09-23 (#3468) 'deepseek-v4.1-flash' is the
// drawable successor: the same wrapper in `--review` mode, which reads the
// checkout through read-only repository tools.
// Its historical name stays readable in REVIEWERS forever because durable refs
// (`refs/db-review-assignments/1987-1989-2108fcd1...`) still name it.
//
// PAUSED 2026-09-03T16:55Z (owner instruction, chat directive, no issue): 'kimi-k3'.
// Account-wide weekly usage cap, confirmed genuine (403, not retryable this week) via
// raw evidence across multiple PRs (#2145, #2200, #2199). This is a PAUSE, not a
// retirement -- same pattern as the 2026-08-20 pause in issue #1290 above. Owner
// stated the cap clears in 24 hours from the timestamp above, i.e. on or after
// 2026-09-04T16:55Z. Whoever is orchestrating then should verify the cap has
// actually lifted (do not assume the clock alone; confirm with a real doctor/attempt)
// before removing 'kimi-k3' from this list and restoring its original rotation slot.
// UNPAUSED 2026-09-07 (owner instruction, this session): 'kimi-k3' is back in the
// rotation. Its 2026-08-20 pause was a credit exhaustion plus wrapper launch
// failure, both of which are gone: `AI_KIMI_CALLER=claude ai-kimi doctor` on this
// machine reports kimi 0.36.1, model pin kimi-code/k3, read-only PASS, preflight
// PASS and auth OK. Verified by running the doctor, not by reading the wrapper.
//
// RETIRED 2026-09-06 (owner instruction, issue #2485):
// 'codex-gpt-5.6-sol'. Its account usage limit was exhausted for the whole of a
// working session: every draw on PRs #2468 and #2479 came back
// `ERROR: You've hit your usage limit`, each one costing a failed run plus a
// replacement round while the rest of the queue waited. The owner directed
// permanent removal from the pool. This is a disposition on the ACCOUNT, not on
// the wrapper: `ai-codex-review` reads the repository correctly and its row in
// REVIEWERS keeps `readsRepository:true`, so every durable artifact this
// reviewer already recorded still authorizes exactly as before. Restoring it is
// a one-line deletion from this list once the account has quota again.
//
// PAUSED 2026-09-18 (owner instruction, chat directive, no issue): 'glm-5.3'.
// No provider fault is alleged and no health check failed -- the owner is
// rotating providers in and out of the active pool through the week to spread
// account usage, and this week GLM sits out. Kimi K3 stayed in then and was verified
// the same day (`AI_KIMI_CALLER=claude ai-kimi doctor`: read-only PASS,
// preflight PASS, auth OK); Kimi was itself paused on 2026-09-22 (below). This is a PAUSE, not a retirement: restoring GLM is
// a one-line deletion from this list once the owner asks for it back, and its
// REVIEWERS row stays so every durable verdict it already recorded still
// authorizes a merge. The 2026-09-17 owner ruling -- GLM never reviews
// GLM-orchestrated work -- is unaffected and keeps binding when GLM returns.
//
// RESTORED 2026-09-30 (owner instruction, chat: "add GLM back into the reviewer
// rotation"): 'glm-5.3' is deleted from this list. The REVIEWERS row stays where
// it always sat (same slot as 'glm-5.2'), so no in-flight sequence is reassigned
// and every durable verdict it already recorded still authorizes a merge. The
// 2026-09-17 independence ruling (GLM never reviews GLM-orchestrated work) is
// unchanged and still binding.
//
// PAUSED 2026-09-22 (owner instruction, issue #3423): 'kimi-k3'.
// The Kimi account has been out of credit and suspended since 2026-09-17, so
// every draw that landed on it failed and left the PR "waiting for a reviewer"
// until a replacement round. The owner then confirmed the live pool as Grok,
// Qwen, Muse and Gemini (GLM was paused above that day, since restored
// 2026-09-30); DeepSeek V4.1 Flash joined it on 2026-09-23 (issue #3468), and
// with glm-5.3 restored the live pool is six. This is a PAUSE, not a
// retirement: restoring Kimi is a one-line deletion from this list once the
// account has credit AND `AI_KIMI_CALLER=claude ai-kimi doctor` passes. Its
// REVIEWERS row stays so every durable verdict it recorded still authorizes.
//
// PAUSED 2026-10-07 then RESTORED 2026-10-08 (owner instruction, chat: "put
// Grok back in the rotation"): 'grok-4.6' was briefly listed here (PR #4051)
// and is deleted again. Re-entry proof, 2026-10-08 on edge-dev3: `ai-grok-review
// doctor --live` returned `live probe : OK` on the subscription login (no paid
// API key), and a live review session ended with a well-formed `VERDICT:
// APPROVE <head>` line. Its REVIEWERS row never moved, so no in-flight sequence
// is reassigned; Grok is again the cost fallback (#3592) behind the others.
export const RETIRED_REVIEWERS = Object.freeze(['glm-5.2', 'muse-spark-1.2-contributor', 'deepseek-chat', 'codex-gpt-5.6-sol', 'kimi-k3'])

// Not retired -- quarantined pending a passing live qualification. Kept separate
// from RETIRED_REVIEWERS on purpose: retirement is a permanent disposition,
// quarantine is a reversible one, and conflating them is what put a false 'Qwen
// is retired' claim into the roster in the first place. Both lists are excluded
// from ACTIVE_REVIEWERS. Names here stay readable in REVIEWERS forever because
// durable refs name them.
//
// UNQUARANTINED 2026-09-07 (owner instruction, ai-devops PR #316, merge commit
// 795902d8): 'qwen-3.8-max' is drawable again, so this list is now empty. The
// quarantine was real and its cause is fixed, not waived. Qwen never
// authenticated because its credential preloader assumed a single-process
// runtime while Qwen Code re-execs itself twice during startup, and because the
// Alibaba Coding Plan subscription key had died (401). The wrapper now hands the
// key over in a form that survives the re-exec while remaining strippable from
// tool children, and runs on the Model Studio pay-per-token lane. Verified by
// running it, not by reading it: `ai-qwen doctor --live` reports `live probe :
// OK` on the installed command, and two live review sessions on that commit each
// returned a single well-formed verdict on model qwen3.8-max above a substantive
// report. Restoring the quarantine is a one-name addition back to this list.
export const QUARANTINED_REVIEWERS = Object.freeze([])

// The single fact the gate was missing (#2078). A verdict is evidence only if the
// reviewer could open the file. Unknown names fail closed.
export function reviewerReadsRepository(name, reviewers=REVIEWERS){
  return reviewers.find((row)=>row.name===name)?.readsRepository===true
}

// #2831. The sibling fact: a reviewer is drawable for a governed review only if its
// wrapper can end a review with the governed `VERDICT: <decision> <head>` line. The
// list lives in scripts/lib/reviewer-capabilities.mjs, which the governed runner also
// reads, so the allocator and the runner cannot disagree. Unknown names fail closed.
export function reviewerEmitsGovernedVerdict(name, reviewers=REVIEWERS){
  const row=reviewers.find((candidate)=>candidate.name===name)
  return Boolean(row)&&wrapperEmitsGovernedVerdict(row.wrapper)
}

// #2079 ROUND 3. The two directions need OPPOSITE defaults for an unknown name.
// The merge gate asks "may this verdict authorize?" and an unknown name must
// answer no -- that is `reviewerReadsRepository` above. Replacement asks "may this
// verdict be stripped off the head?" and an unknown name must answer NO THERE TOO,
// which is the opposite boolean. Only a roster row that positively says
// `readsRepository:false` (today: deepseek-chat) may be discarded. A name that is
// absent, misspelled, case-shifted (`parseReviewCursor` matches case-insensitively
// while the roster lookup does not) or dropped from REVIEWERS is UNCLASSIFIABLE,
// and un-reviewing a head on an unclassifiable artifact is the hole #2078 was.
export function reviewerKnownNonReading(name, reviewers=REVIEWERS){
  const row=reviewers.find((entry)=>entry.name===name)
  return Boolean(row)&&row.readsRepository===false
}

// ACTIVE ROTATION EXPANSION (owner approval, 2026-08-28). 'codex-gpt-5.6-sol' and
// 'deepseek-chat' were added as active rotation providers then. NEITHER NAME IS
// ACTIVE NOW: 'deepseek-chat' was retired for fabricated reviews (DeepSeek itself
// returned as 'deepseek-v4.1-flash' on 2026-09-23), and Codex on 2026-09-06 for an
// exhausted account (see RETIRED_REVIEWERS above, which is the only roster that
// decides this). No overflow provider remains. A provider with live reviews is
// never "occupied": one reviewer may run any number of concurrent reviews
// (owner ruling 2026-09-16), so there is no ordered wait for a free reviewer.
//
// It is listed in REVIEWERS like every other name, so a cursor commit naming it
// still resolves to a wrapper forever (`REVIEWERS.find(...)` at parse time is
// not null-guarded on every path -- see the retired-name note above).
//
// `ai-codex-review` pins `codex exec -m gpt-5.6-sol --sandbox read-only
// -c model_reasoning_effort=medium`. That satisfies the standing rule that
// GPT-5.6 runs at low or medium reasoning only, and the pin lives in the
// wrapper, so no caller here can raise it. `ai-codex-review doctor` was run on
// edge-dev before activation and returns
// `PASS provider=codex sandbox=read-only reasoning=explicit command=codex`.
export const OVERFLOW_REVIEWERS = Object.freeze([])
export const ACTIVE_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>!RETIRED_REVIEWERS.includes(row.name)&&!QUARANTINED_REVIEWERS.includes(row.name)))
// Owner instruction, 2026-09-27 (issue #3592): Grok is expensive, so rotate
// among the other eligible reviewers first. Grok remains an eligible fallback.
export const REVIEWER_FALLBACK_PROVIDERS = Object.freeze(['grok'])
export function orderedReviewers(sequence,reviewers=ACTIVE_REVIEWERS){
  if(!Number.isSafeInteger(sequence)||sequence<1)throw new LaneError('reviewer sequence must be a positive integer')
  const rotate=(rows)=>rows.length?Array.from({length:rows.length},(_,offset)=>rows[(sequence-1+offset)%rows.length]):[]
  return [...rotate(reviewers.filter((row)=>!REVIEWER_FALLBACK_PROVIDERS.includes(row.provider))),
    ...rotate(reviewers.filter((row)=>REVIEWER_FALLBACK_PROVIDERS.includes(row.provider)))]
}
export function drawOrder(sequence,io){
  // The injected order exists only for historical safety fixtures. Production
  // always uses the owner policy above; fixtures may reorder but never change
  // membership, which keeps every admission and exhaustion check meaningful.
  if(io===githubIo||!io?.reviewerOrder)return orderedReviewers(sequence)
  const rows=io.reviewerOrder(sequence)
  const names=ACTIVE_REVIEWERS.map((row)=>row.name).sort()
  if(!Array.isArray(rows)||rows.length!==names.length||!rows.every((row)=>ACTIVE_REVIEWERS.includes(row))||JSON.stringify(rows.map((row)=>row.name).sort())!==JSON.stringify(names))throw new LaneError('injected reviewer order must be a permutation of the active roster')
  return rows
}

export function canonicalReviewerAllowlist(value){
  if(value===undefined||value===null)return null
  const raw=Array.isArray(value)?value:String(value).split(',')
  if(!raw.length||raw.some((name)=>typeof name!=='string'||!name||name!==name.trim()))throw new LaneError('reviewer allowlist must contain non-empty canonical reviewer names without surrounding whitespace')
  if(new Set(raw).size!==raw.length)throw new LaneError('reviewer allowlist contains duplicate reviewer names')
  const registered=[...REVIEWERS,...OVERFLOW_REVIEWERS.filter((row)=>!REVIEWERS.some((known)=>known.name===row.name))],knownNames=new Set(registered.map((row)=>row.name))
  for(const name of raw){
    if(!knownNames.has(name))throw new LaneError(`reviewer allowlist names unknown canonical reviewer ${name}`)
    if(RETIRED_REVIEWERS.includes(name))throw new LaneError(`reviewer allowlist names retired reviewer ${name}`)
  }
  const requested=new Set(raw)
  return Object.freeze(registered.filter((row)=>requested.has(row.name)).map((row)=>row.name))
}
export function parseRecordedReviewerAllowlist(value){
  if(!value)return null
  const names=String(value).split(',')
  if(names.some((name)=>!/^[a-z0-9.-]+$/.test(name))||new Set(names).size!==names.length)throw new LaneError('durable reviewer allowlist is malformed')
  return Object.freeze(names)
}
export function reviewerAllowlistSuffix(allowlist){return allowlist?` allowlist=${allowlist.join(',')}`:''}
export function sameReviewerAllowlist(left,right){return left===null&&right===null||Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((name,index)=>name===right[index])}
export function inheritReviewerAllowlist(requested,recorded){
  recorded??=null
  if(recorded===null){
    if(requested!==null)throw new LaneError('reviewer allowlist does not match the durable unrestricted assignment')
    return null
  }
  if(requested===null)return recorded
  if(!sameReviewerAllowlist(requested,recorded))throw new LaneError(`reviewer allowlist does not match the durable assignment (${recorded.join(',')})`)
  return recorded
}
export function reviewerAllowed(name,allowlist){return allowlist===null||allowlist.includes(name)}
export function assertReviewerAllowlistConsistency(records){
  const present=records.filter(Boolean)
  if(present.some((record)=>!sameReviewerAllowlist(present[0].reviewerAllowlist??null,record.reviewerAllowlist??null)))throw new LaneError('durable reviewer assignment history has conflicting allowlists')
}

export function inheritReturnedReviewerAllowlist(requested,request,io){
  let inherited=requested,recorded=null,seen=false
  for(const returned of readReviewReturns(request.issue,request.pr,request.headSha,io).filter((row)=>row.slot===request.slot)){
    const commit=io.getCommit(returned.assignmentSha),assignment=parseReviewCursor(commit)
    let slot=assignment.slot??1
    if(returned.replacementSequence!==null){
      const replacement=parseReviewReplacement(commit)
      if(replacement.failedSequence!==returned.replacementSequence)throw new LaneError('returned reviewer allowlist evidence does not match its replacement')
      // Pre-#2077 replacement messages omitted slot; the checked return ref is
      // then authoritative. A slotless original cursor still means slot one.
      slot=assignment.slot??returned.slot
    }
    if(assignment.issue!==request.issue||assignment.pr!==request.pr||assignment.headSha!==request.headSha||slot!==request.slot||assignment.reviewer!==returned.reviewer||(returned.sequence!==null&&assignment.sequence!==returned.sequence))throw new LaneError('returned reviewer allowlist evidence does not match its assignment')
    const policy=assignment.reviewerAllowlist??null
    if(seen&&!sameReviewerAllowlist(recorded,policy))throw new LaneError('returned assignments have conflicting durable reviewer allowlists')
    inherited=inheritReviewerAllowlist(inherited,policy)
    recorded=policy;seen=true
  }
  return {allowlist:inherited,found:seen}
}

// `engine === null` is a POSITIVE answer, not an absent one: the marker resolver
// said `state: none`, so no orchestrator is running and there is no same-engine
// conflict to guard against. The exclusion list is empty and the whole rotation
// stays eligible (issue #2127 decision (a)).
//
// `undefined` and `''` remain unreadable and still refuse. That distinction is
// load-bearing: every call site reaches this through `io.resolveOrchestratorEngine?.()`,
// which yields `undefined` when the io object has no resolver at all, and that
// must never be mistaken for "no orchestrator is running".
//
// THE EXCLUSION FOLLOWS THE MODEL ENGINE, NOT THE HARNESS NAME (#3232). A ZCode
// orchestrator is a GLM-engine session, and the owner ruled on 2026-09-17 that
// GLM must never review GLM code, so a `zcode` orchestrator must exclude the
// `glm` rows even though no row carries the string 'zcode'. This map is the
// reviewer-draw's own vocabulary: it MUST cover every engine
// `lib/orchestrator-routing.mjs` lets a marker declare, which the lane test
// suite asserts key-for-key. It lives HERE, beside the rows it filters, rather
// than as an import from the routing module, so editing the routing contract
// does not enter this manager's import closure and become a global evidence
// invalidator (config/orchestrator-global-invalidators-v1.json).
export const ENGINE_REVIEWER_EXCLUSION=Object.freeze({codex:'codex',claude:'claude',zcode:'glm'})

// The authoring engine is MANDATORY and fails closed (#3874 review): an unset,
// blank, malformed or unknown value refuses rather than silently excluding no
// reviewer. Known engines are the exclusion-map keys plus every reviewer engine
// (test 1652 already pins the exclusion-map keys to the routing engine list).
export function knownAuthorEngines(reviewers=REVIEWERS){
  return new Set([...Object.keys(ENGINE_REVIEWER_EXCLUSION),...reviewers.map((row)=>String(row.orchestratorEngine??'').toLowerCase()).filter(Boolean)])
}
export function authorEngineFromEnv(value,known=knownAuthorEngines()){
  const engine=String(value??'').trim().toLowerCase()
  if(!engine)throw new LaneError('SHARED_DB_AUTHOR_ENGINE is not set; declare the authoring session engine (e.g. claude, codex, zcode) so a same-engine reviewer is excluded. Reviewer assignment refused')
  if(!known.has(engine))throw new LaneError(`SHARED_DB_AUTHOR_ENGINE="${engine.slice(0,40)}" is not a known engine (${[...known].sort().join(', ')}); reviewer assignment refused`)
  return engine
}

export function reviewersForOrchestrator(engine, reviewers=ACTIVE_REVIEWERS){
  if(engine===null)return reviewers.filter(()=>true)
  const normalized=String(engine??'').trim().toLowerCase()
  if(!normalized)throw new LaneError('live orchestrator engine is unreadable; reviewer assignment refused')
  const excluded=String(ENGINE_REVIEWER_EXCLUSION[normalized]??normalized).trim().toLowerCase()
  return reviewers.filter((row)=>String(row.orchestratorEngine??'').toLowerCase()!==excluded)
}

export function reviewerAdmissionAllowed(row,overrides={},now=Date.now()){
  const admission=row?.admission,safe=(value)=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value)
  const refuse=(reason)=>{throw new LaneError(`reviewer admission ${reason}; no sequence or lease was consumed`)}
  if(!admission||admission.schema_version!==1||admission.provider!==row.provider||!['eligible','unknown','backoff'].includes(admission.state)||admission.quota_state!=='unknown'||admission.reset_at!==null||!safe(admission.reason))refuse('is missing or malformed')
  const profile=admission.credential_profile_scope,model=admission.model_scope
  if((profile!==null&&!safe(profile))||(model!==null&&!safe(model)))refuse('scope is malformed')
  if((overrides.profile&&profile!==overrides.profile)||(overrides.model&&model!==overrides.model))refuse('scope does not match the effective override')
  if(admission.state==='unknown'){
    if(admission.reason!=='unscopable'||(safe(profile)&&safe(model)))refuse('unknown state is malformed')
    return true // An explicit unknown quota is not evidence of provider refusal.
  }
  if(!safe(profile)||!safe(model))refuse('requires an exact profile and model')
  if(admission.state==='eligible'){
    if(admission.reason!=='no-applicable-backoff')refuse('eligible state is malformed')
    return true
  }
  if(admission.reason!=='observed-usage-limit'||!Number.isSafeInteger(admission.policy_expires_epoch)||admission.policy_expires_epoch<=0||!safe(admission.source_run_id)||!/^[0-9a-f]{64}$/i.test(admission.evidence_sha256??''))refuse('backoff proof is malformed')
  if(!Number.isFinite(now))refuse('clock is unreadable')
  return admission.policy_expires_epoch<=Math.floor(now/1000)
}

export function reconcilePreflightRows(output,reviewers,{complete=true}={}){
  const rows=[]
  for(const line of output.split(/\r?\n/).filter(Boolean)){
    try{const row=JSON.parse(line);if(typeof row?.provider==='string'&&typeof row?.usable==='boolean')rows.push(row)}catch{/* explanatory output is not provider state */}
  }
  const requested=new Set(reviewers.map((reviewer)=>reviewer?.provider))
  if(!rows.some((row)=>requested.has(row.provider)))throw new LaneError('ai-review-preflight returned no reconciled state for any provider; reviewer assignment refused')
  const byProvider=new Map(rows.map((row)=>[row.provider,row]))
  for(const reviewer of reviewers){
    if(!reviewer?.provider)throw new LaneError(`reviewer ${reviewer?.name??'unknown'} has no ai-review-preflight provider identity`)
    // A provider with no reconciled row is UNUSABLE for this draw, never a
    // reason to refuse every other reviewer (one Qwen fault blocked all draws).
    if(!byProvider.has(reviewer.provider)&&!complete)throw new LaneError(`ai-review-preflight was cut off before reporting ${reviewer.provider}; reviewer assignment refused`)
    if(!byProvider.has(reviewer.provider))byProvider.set(reviewer.provider,{provider:reviewer.provider,status:'no-reconciled-state',failure_class:'preflight-no-row',usable:false,admission:{state:'unknown',reason:'no-reconciled-state'}})
  }
  return byProvider
}

export function allocatableReviewers(io){
  const independent=reviewersForOrchestrator(io.resolveOrchestratorEngine?.())
  if(!independent.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  if(typeof io.reviewerUsability!=='function')throw new LaneError('reviewer allocation cannot read the reconciled ai-review-preflight state; no sequence or lease was consumed')
  const usability=io.reviewerUsability(independent)
  if(!(usability instanceof Map))throw new LaneError('reviewer allocation received malformed reconciled ai-review-preflight state; no sequence or lease was consumed')
  const reconciled=new Map()
  for(const row of independent){
    const state=usability.get(row.provider)
    if(state?.provider!==row.provider)throw new LaneError('reviewer admission provider identity does not match the requested provider; no sequence or lease was consumed')
    // An already-unusable provider is skipped without judging its admission
    // record, so one provider's bad or absent entry cannot block the others.
    const allowed=state?.usable===true&&reviewerAdmissionAllowed(state,io.reviewerAdmissionOverrides?.(row)??{})
    reconciled.set(row.provider,{...state,usable:state.usable===true&&allowed,...(state.usable===true&&!allowed?{status:'admission-backoff',failure_class:'observed-usage-limit'}:{})})
  }
  const usable=(row)=>reconciled.get(row.provider)?.usable===true
  return {
    eligible:independent.filter(usable),
    unusable:new Map(independent.filter((row)=>!usable(row)).map((row)=>[row.name,reconciled.get(row.provider)]))
  }
}

// The orchestrator marker resolver (issue #2127) was retired with the role
// (issue #3874); session authority lives in lib/session-authority.mjs.
export function readSessionIdOrUnknown(){const id=readSessionId();return typeof id==='string'?id:'unknown-session'}
