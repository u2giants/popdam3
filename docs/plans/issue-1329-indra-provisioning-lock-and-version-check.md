---
summary: Issue #1329 plan: Indra install lock under 30 minutes, child-process cleanup, tolerant version check, tests. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue 1329, changing Windows agent Indra OCR provisioning, its lock, or its version/marker checks
---

# Plan: Indra provisioning lock, version check and tests after the 1.2.0 upgrade (u2giants/popdam3#1329)

Issue: https://github.com/u2giants/popdam3/issues/1329 (review finding on merged PR https://github.com/u2giants/popdam3/pull/1327)
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-indra-fama-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-indra-fama-plans.md)
Companion plan (same Windows agent, factory approval form reader): [issue-1341-1346-factory-approval-form-reader.md](issue-1341-1346-factory-approval-form-reader.md)
Written 2026-11-25 3:55 PM EST by Claude (plan only; no implementation started). Code facts checked against `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Heartbeat lock: holder refreshes, stale after 2 min without refresh, waiter capped at 30 min | ⬜ open | — |
| 2 | Whole-provision budget under 28 min; each step's timeout clipped to what is left | ⬜ open | — |
| 3 | Kill the whole child-process tree when a step times out | ⬜ open | — |
| 4 | Version check tolerant of trailing `.0`, still rejects pre/post releases | ⬜ open | — |
| 5 | Regression tests for version check, marker, lock, budget | ⬜ open | — |
| 6 | Runbook §10 corrected; reason for the bridge 1.2.0 bump recorded | ⬜ open | — |
| 7 | Release a Windows agent build and prove live on the Windows box | ⬜ open | — |

Fresh session starts at step 1. Steps 1–4 touch one file and should land in one PR with step 5's tests and step 6's doc edit; step 7 is after merge.

---

## Part 1 — Why

### 1. The ultimate goal

Every Windows render agent should read scanned artwork and factory-approval PDFs with the better OCR engine (Indra), not fall back to the weaker one (tesseract.js) just because an upgrade is in progress or a second agent on the same computer started at the same time. When an upgrade runs, it must finish, or fail visibly, within 30 minutes, and the admin panel must say truthfully which engine is in use.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

### 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product art. Repo `u2giants/popdam3`, release branch `main` (protected; PR only). The **Windows render agent** (`apps/windows-agent/`, TypeScript on Node, runs as a Windows service on the office render box) renders previews and extracts text from PDFs. Text from PDFs without embedded text comes from **Indra OCR** — a Python package (`indra-ocr`) plus ONNX model files from Hugging Face (`datalab-to/indra-ocr`), installed outside the shipped code at `C:\ProgramData\PopDAM\indra` (venv) and `C:\ProgramData\PopDAM\indra\models`. The NAS bridge agent (`apps/bridge-agent/`, Docker) bakes the same engine into its image. Shared Node client: `packages/agent-common/src/indra-ocr.ts` (copied into `apps/*/src/common/` at build — never edit those copies).

The agent self-provisions Indra at startup (`apps/windows-agent/src/indra-provision.ts`, `provisionIndra()`), and the "Settings → Windows Render Agent" panel shows its state from the heartbeat. A box can run several agent children (one per `TENANTS` entry); all share the one install folder, so a lock file `C:\ProgramData\PopDAM\indra.provision.lock` makes them queue.

### 3. What triggered this work

PR #1327 (merged; "Upgrade Indra OCR to 1.2.0 with v1.2.0 models") made the verification step demand package version `1.2.0` and a model-revision marker file `.indra-revision` containing `v1.2.0`. Every box on the old version therefore does a full reinstall on its next start. The advisory reviewer (deepseek) filed issue #1329 with four findings:

1. A waiting agent can give up on the lock before the holder finishes, then run on tesseract.js for the whole session; a timed-out holder's child processes can outlive the lock.
2. The plain string equality `v == "1.2.0"` can wrongly reject a correct install, forcing a reinstall on every start.
3. No tests cover the new version check, the marker, or "old marker forces reprovision".
4. No stated reason for moving the bridge image to 1.2.0 (OCR output could change).

The automatic fixer opened PR #1330 against the source branch; it was closed unmerged on 2026-11-24 (the source PR had already merged). Nothing from #1330 is on `main`.

### 4. Scope

In: `apps/windows-agent/src/indra-provision.ts`, `apps/windows-agent/src/indra-provision.test.ts`, `docs/WINDOWS_AGENT_RUNBOOK.md` §10 "Indra OCR self-check and self-install", the Windows agent version bump and release needed to prove it live.

**NOT in this plan:**
- Changing the Indra version or model revision (stays `indra-ocr==1.2.0`, `v1.2.0`).
- The bridge agent Dockerfile (its build-time `OrtOCR` check already fails the image build on a bad install; no runtime provisioning exists there).
- `scripts/windows-agent/install-service.ps1` logic (only check its pins still match; change nothing unless they differ).
- The factory approval form reader (#1341/#1346 — companion plan).
- Moving provisioning into the tenant supervisor (rejected, §7).
- Any database change.

---

## Part 2 — What we already know

### 5. Current state of the code (`origin/main` `787c20b8`)

All in `apps/windows-agent/src/indra-provision.ts`:
- Pins: `INDRA_PACKAGE_SPEC = "indra-ocr==1.2.0"` (`:39`), `INDRA_MODEL_REVISION = "v1.2.0"` (`:40`), `INDRA_PACKAGE_VERSION` from splitting the spec (`:41`), marker name `.indra-revision` (`:43`).
- `deepVerifyScript()` (`:122-131`) builds one Python one-liner: exact string `assert v == "1.2.0"`, marker must exist and equal `v1.2.0`, then `OrtOCR(<dir>)` loads the model and prints `indra-ok`.
- `provisionPlan()` (`:187-205`): steps venv 180 s, package (pip) 420 s, models (`snapshot_download` + marker write, marker written only after the download call returns) 900 s, verify 180 s — 1,680 s = 28 min of step timeouts. The fast path (`:424-440`) can add one more 180 s verify before falling into the full path, so a holder can run ~31 min plus `findSystemPython` (15 s) and `persistMachineEnv` (30 s).
- Lock: `LOCK_STALE_MS = 45 min` (`:260`), `LOCK_WAIT_MS = LOCK_STALE_MS + 5 min = 50 min` (`:264`), dead-PID grace 30 s (`:261`), poll 2 s (`:265`). The lock file content is `{pid, at, token}` written once at acquire; `at` is never refreshed. `acquireProvisionLock()` (`:362-399`), atomic `removeLockIfUnchanged()` (`:333-359`).
- Steps run through `execFileAsync(file, args, {timeout})` (`:457`). On timeout Node kills only the direct child; on Windows that is `TerminateProcess` of `python.exe`, and any grandchild (pip build subprocesses) is left running.
- Tests (`apps/windows-agent/src/indra-provision.test.ts`): pins appear in the plan (`:60-67`), path quoting in `deepVerifyScript` and models step (`:105-118`), `LOCK_WAIT_MS > LOCK_STALE_MS` (`:241`). Nothing checks the version assertion's form, that the marker write follows the download in the same script, or that a wrong/missing marker fails verification.
- Runbook `docs/WINDOWS_AGENT_RUNBOOK.md` §10 says "If the lock cannot be taken within 30 minutes the agent reports an error" — the code says 50 min. The doc and code disagree.
- Run the tests: `npm --prefix apps/windows-agent test` (script in `apps/windows-agent/package.json:10`, uses `tsx --test`).

### 6. Key findings

- **Finding 1 as worded is partly wrong.** The reviewer quoted a 450-second wait; the real wait is 50 minutes (`:264`), longer than the holder's ~31 min worst case, so a waiter does not normally give up early. But the real defect is different and worse for the owner's rules: the wait (50 min) and the stale window (45 min) both break the standing owner rule "never build an automated hold, wait, retry delay or timeout longer than 30 minutes" (owner rule 2026-11-20). And because `at` is never refreshed, a holder that dies without its PID being reused is detected only by the PID check, while a hung-but-alive holder holds the lock for 45 min.
- The orphaned-child half of finding 1 is real: `execFile`'s timeout does not kill grandchildren on Windows.
- **Finding 2 is mostly theoretical but cheap to close.** pip installs exactly `1.2.0` for spec `==1.2.0`, and `importlib.metadata.version()` returns the distribution's recorded version. The one realistic false reject: PEP 440 treats `1.2` and `1.2.0` as equal, so if a build ever recorded `1.2`, the agent would reinstall on every start. Post-releases (`1.2.0.post1`) and pre-releases do NOT satisfy `==1.2.0` in pip, so rejecting them is correct.
- The `packaging` library the reviewer suggested is not guaranteed importable inside the Indra venv (pip vendors its own copy privately), so it cannot be relied on in the verify script.
- **Finding 3 is real** (see §5 tests).
- **Finding 4 needs no code.** The bump was the purpose of PR #1327 (title: "Upgrade Indra OCR to 1.2.0 with v1.2.0 models"), deliberately applied to both agents (`apps/bridge-agent/Dockerfile:92-93` pins the same version and revision). OCR text stored by earlier versions is not re-read; output may differ slightly for newly read pages, which is the intended improvement. It only needs to be written down (step 6).

### 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Keep the 45/50-minute windows, just fix the runbook (what PR #1330 did) | Violates the 30-minute owner rule; a hung holder still blocks others for 45 min. |
| Raise the waiter's wait further | Same rule; makes the hang case worse. |
| Use `packaging.version.Version` in the verify script (reviewer's suggestion) | `packaging` may not be importable in the venv; a failed import would fail verification on every start — the exact loop the finding warns about. |
| Drop the version check, rely on the marker only | The marker proves the models, not the package; a box with new models and the old package would pass. |
| Move provisioning into the tenant supervisor (one provisioner per box) | Settled earlier (comment at `indra-provision.ts:251-259`, PR #452/#457): the lock also covers restarts and stray instances, and the supervisor must not grow an Indra dependency. |
| Waiter skips the lock and runs on tesseract.js immediately, retrying later | Needs a new retry timer and state machine; a heartbeat lock with a capped wait gives the same result with less code. |

### 8. Design decisions

Locked (2026-11-25, this plan; do not relitigate):
- **Heartbeat lock.** The holder rewrites the lock file's `at` (same `pid` and `token`) every 30 s while provisioning. A lock is stale when `now - at > 2 min` (no heartbeat) or, after the 30 s grace, its PID is dead. The waiter waits at most **30 min** total, then reports `error` with detail "another agent on this computer has been installing Indra for 30 minutes".
- **Provision budget 28 min.** One deadline for the whole `provisionIndra()` holder run; each step's timeout is `min(step timeout, time left − 30 s)`; if less than 30 s is left before a step, fail with "Indra provisioning ran out of time at <step>". Step defaults stay as today except models 900 s → 840 s, so the full path alone fits the budget.
- **Tree kill on timeout.** On a step timeout or budget expiry, run `taskkill /PID <pid> /T /F` on the step's child before reporting failure (Windows only; on other platforms fall back to `child.kill()`).
- **Version check.** Compare with trailing `.0` groups stripped on both sides (`1.2` == `1.2.0` == `1.2.0.0`); anything else must match exactly, so `1.2.0.post1`, `1.2.0rc1`, `1.2.0+local` are rejected. Implemented with `re` only — no new imports.
- Pins and paths unchanged.

Open (implementer's judgment, criteria given):
- Heartbeat implementation: `setInterval` that calls a `refreshLock()` helper, or rewrite on each `onProgress`. Criterion: must refresh at least every 30 s even during one long `execFile` step, so a timer is expected.
- Whether `refreshLock()` uses the atomic rename pattern of `removeLockIfUnchanged()`. Criterion: it must never overwrite a lock whose token is not ours (stolen lock); read-compare-write with a token check is acceptable because only a stale lock can be stolen and a refreshing holder is not stale.

---

## Part 3 — How to build it

### 9. Steps

**Step 1 — Heartbeat lock** · `lead-only` (concurrency logic; a mistake is not caught by single-process tests).
- `indra-provision.ts`: set `LOCK_STALE_MS = 2 * 60_000`, `LOCK_WAIT_MS = 30 * 60_000`, add `LOCK_HEARTBEAT_MS = 30_000`. Update the comments at `:260-264` (the "waiter must outlast the stale window" reasoning no longer applies: heartbeats keep a live lock fresh).
- Add exported `refreshProvisionLock(lockPath, info): boolean` — re-read the file; if its token equals ours, write `{pid, at: Date.now(), token}`; return false if the token differs (lock was stolen; log a warning; provisioning continues but stops refreshing).
- `acquireProvisionLock()` returns `{ release, refresh }` or keeps returning a release function that also clears the heartbeat timer — choose one and update `provisionIndra()`.
- In `provisionIndra()` start the heartbeat timer right after acquiring; clear it in `finally` before `releaseLock`. Use `timer.unref()` so it never keeps the process alive.
- Waiter timeout message as in §8.
- Gate: tests `lock heartbeat keeps a live holder fresh`, `lock without heartbeat for 2 min is stolen`, `waiter gives up after waitMs with the new detail`, `refresh does not overwrite a stolen lock` (step 5) pass; `grep -n "45 \* 60_000\|LOCK_STALE_MS + 5" apps/windows-agent/src/indra-provision.ts` returns nothing.

**Step 2 — Provision budget** · `lead-only` (decides when a production box gives up).
- Add `PROVISION_BUDGET_MS = 28 * 60_000` and exported pure `stepTimeout(defaultMs, deadline, now): number | null` (null = not enough time). In `provisionPlan()` change models to `840_000`.
- In `provisionIndra()` compute `deadline = startedAt + PROVISION_BUDGET_MS` after the lock is acquired (waiting time does not count against the holder's budget; the waiter has its own 30-min cap); apply `stepTimeout` to the fast-path verify, every plan step and the final verify.
- Gate: test `stepTimeout clips to remaining budget and refuses under 30 s`; test `full-path step timeouts sum to at most PROVISION_BUDGET_MS`.

**Step 3 — Tree kill** · `helper-ok` (mechanical once step 2's runner exists). Stop-and-ask trigger: if `execFile` cannot expose the child PID with the current promisified call, bring it back to the lead rather than redesigning the runner.
- Replace the promisified `execFileAsync` call at `:457` (and the verify calls at `:239`) with a small `runStep(file, args, timeoutMs)` that uses `execFile` with a callback, keeps the `ChildProcess`, and on timeout calls exported `killTree(pid)` → `execFile("taskkill", ["/PID", String(pid), "/T", "/F"], {windowsHide: true})` on `win32`, `child.kill("SIGKILL")` elsewhere. Keep `maxBuffer: STEP_MAX_BUFFER` and `windowsHide: true`.
- Gate: test `killTree builds taskkill /T /F on win32` (inject the exec function); `npm --prefix apps/windows-agent test` green.

**Step 4 — Version check** · `helper-ok`. Stop-and-ask trigger: any wish to import a non-standard-library module in the verify script.
- In `deepVerifyScript()` replace the exact assertion with: `import re; n = lambda s: re.sub(r"(\.0+)+$", "", s.strip()); assert n(v) == n(<pin>), "indra-ocr " + v + " is not the pinned version";`. Keep the path and marker lines unchanged.
- Gate: test `version check accepts 1.2 and 1.2.0, rejects 1.2.0.post1 / 1.2.0rc1 / 1.2.0+local / 1.2.1` — run the generated normaliser through `python` if available on the CI runner (`spawnSync("python", ["-c", ...])`, `skip` when no python), and always assert the script text contains the `re.sub` normaliser and the pin.

**Step 5 — Tests** · `helper-ok` (test names fixed below). Stop-and-ask trigger: a test that needs a real network download or the real `C:\ProgramData` path — use temp dirs and injected functions instead.
Add to `apps/windows-agent/src/indra-provision.test.ts` the tests listed in §10.

**Step 6 — Docs** · `helper-ok`. Stop-and-ask trigger: any runbook statement you cannot match to code.
- `docs/WINDOWS_AGENT_RUNBOOK.md` §10 "Cross-process lock" bullet: heartbeat every 30 s, stale after 2 min without heartbeat or dead PID, waiter gives up after 30 min, whole provision limited to 28 min, timed-out steps' process trees are killed.
- Add one bullet "Why 1.2.0 on both agents": intentional upgrade from PR #1327 on both Windows and bridge agents; earlier stored OCR text is not re-read; newly read pages may differ slightly — the improvement is the point.
- Gate: the runbook numbers match the constants (`grep -n "LOCK_\|PROVISION_BUDGET" apps/windows-agent/src/indra-provision.ts`).

**Step 7 — Release and live proof** · `lead-only` (live-proof judgment).
- Bump `apps/windows-agent/package.json` version (patch) in the same PR; after merge, the Windows agent GitHub Release workflow publishes it (see `docs/deployment.md` → Windows agent). Trigger the agent update the way `docs/WINDOWS_AGENT_RUNBOOK.md` describes.
- Proof: on the render box, the admin panel "Settings → Windows Render Agent" shows `OCR engine: Indra (ready)` for every tenant child after restart; the agent log shows either "engine already on disk — verifying before reuse" followed by "ready", or a full install finishing inside 28 min; the lock file `C:\ProgramData\PopDAM\indra.provision.lock` is absent afterwards. Record the evidence (log lines + screenshot) under `docs/verification/` and cite it in STATUS.

No step makes anything wait more than 30 minutes.

### 10. Tests required

New, in `apps/windows-agent/src/indra-provision.test.ts`:
- `verify script asserts the normalised pinned version` — text contains the pin and `re.sub`.
- `version check accepts 1.2 and 1.2.0, rejects 1.2.0.post1 / 1.2.0rc1 / 1.2.0+local / 1.2.1` — executes the normaliser with python when present.
- `verify script requires the revision marker to equal v1.2.0` — text contains the marker name and `INDRA_MODEL_REVISION`, both JSON-quoted.
- `models step writes the marker only after snapshot_download in the same script` — index of `write_text` > index of `snapshot_download(`; marker value is `INDRA_MODEL_REVISION`.
- `marker and version checks survive a models path containing a quote` — `deepVerifyScript("D:\\in'dra")` keeps the path JSON-quoted on the marker line.
- `lock heartbeat keeps a live holder fresh` — temp lock path; refresh moves `at`; `isProvisionLockStale` false at `at + 1 min`.
- `lock without heartbeat for 2 min is stolen` — `isProvisionLockStale(info, at + 2 min + 1)` true.
- `refresh does not overwrite a stolen lock` — different token on disk → returns false, file unchanged.
- `waiter gives up after waitMs with the new detail` — `acquireProvisionLock({waitMs: 50, pollMs: 10, pidAlive: () => true})` with a fresh foreign lock rejects with the message.
- `stepTimeout clips to remaining budget and refuses under 30 s`.
- `full-path step timeouts sum to at most PROVISION_BUDGET_MS`.
- `killTree builds taskkill /T /F on win32`.
- Replace the existing `LOCK_WAIT_MS > LOCK_STALE_MS` assertion (`:241`) with `LOCK_WAIT_MS <= 30 min && LOCK_STALE_MS <= 30 min && LOCK_HEARTBEAT_MS < LOCK_STALE_MS`.

Must stay green: `npm --prefix apps/windows-agent test`; repo CI on the PR.

### 11. Constraints and gotchas

- Protected `main`: feature branch + PR; the AI merges after required checks; reviews are advisory and never block.
- No database change is involved. Never add files to `supabase/migrations/`.
- Edit `packages/agent-common/src/…` only for shared code; never edit `apps/*/src/common/` (generated copies). This plan needs no shared-code edit.
- No hold, wait, timeout or retry may exceed 30 minutes (owner rule 2026-11-20).
- Do not log secrets; this work involves none.
- Generated Python must keep embedding paths with `pythonString()` (JSON quoting) — never `r'...'` (`:103-110`).
- Do not change pins; the bridge image and `install-service.ps1` must keep the same pins (`grep -n "1.2.0" scripts/windows-agent/install-service.ps1 apps/bridge-agent/Dockerfile`).
- `taskkill` exists on every Windows box; do not add a dependency for tree-kill.
- Times in docs and handoffs are written in EST/EDT.

### 12. Access and environment

- `gh` CLI authenticated as `u2giants` for PRs and releases.
- Local tests: Node 20+, `npm ci` at the repo root, then `npm --prefix apps/windows-agent test`. Python is optional locally (step 4's runtime test skips without it).
- Live box: the office Windows render box running the agent service; admin panel at the PopDAM web app (Settings → Windows Render Agent). Admin login: 1Password vault `vibe_coding`, the PopDAM admin item (search "PopDAM"); never paste values.
- Release mechanics: `docs/deployment.md` (Windows agent section) and `docs/WINDOWS_AGENT_RUNBOOK.md`.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–6 merged to `main` in one PR, CI green, PR linked on issue #1329.
- [ ] Windows agent version bumped and released; render box updated.
- [ ] Live proof (step 7) recorded under `docs/verification/` and cited in STATUS.
- [ ] This plan's STATUS updated with artifacts; handoff file updated or closed.
- [ ] Issue #1329 closed with the evidence link (keep a `- [ ] live proof` checklist item on #1329 itself until step 7 is done — no new issue for it).

Risks and rollback:
- A heartbeat bug could let two children provision at once (pip/venv race). Mitigation: the steal tests; rollback = revert the PR and release the previous agent version.
- A 28-min budget could be too short on a slow line; the result is a visible `error` and tesseract.js fallback, and the next start resumes (snapshot_download skips finished files). If live proof shows the models step needs more, shorten other steps rather than exceed 28 min.
- `taskkill /F` on the wrong PID: only the PID of the child we spawned is passed.

Open questions: none needing the owner. If the live box shows a version string other than `1.2.0` or `1.2`, record it in STATUS and keep the normaliser rule.

### Self-audit (final answers)

1. *Could a brand-new session execute this without asking?* Yes — §2 defines the agent, Indra and the lock; §5 gives exact lines and constants; §8 locks every number; §9 names files, functions and gates; §10 names every test; §12 gives access by location.
2. *Does it carry all background, including what was ruled out?* Yes — §3 covers the review and the closed PR #1330; §6 corrects the reviewer's 450 s figure; §7 lists six rejected approaches with reasons.
3. *Is the goal clear enough for judgment calls?* Yes — §1: stay on Indra, finish or fail visibly within 30 minutes, panel tells the truth; §13 says what to trade if the budget proves too short.

Trust boundary: this plan's only outside inputs are the installed package's version string and the marker file; both hostile cases (wrong/odd version, missing/old marker, quote in path) are covered by named tests in §10. No parser of user files is changed here.

### Lead launch prompt

```text
You are the lead implementing u2giants/popdam3 issue #1329.
Read first: AGENTS.md, then docs/plans/issue-1329-indra-provisioning-lock-and-version-check.md
(STATUS table first; do not redo finished rows), then apps/windows-agent/src/indra-provision.ts
and its test file.
You do steps 1, 2 and 7 yourself (lead-only). Hand steps 3, 4, 5 and 6 to your helper in that
order, after step 2 is in place, each with the plan's exact file, edit and gate.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high)
for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges,
pushes to main, releases or GitHub posts; when a step's stop-and-ask trigger fires, bring it to
you; if stuck 30 minutes, you take the step back.
You run yourself: npm --prefix apps/windows-agent test; review every helper diff; the grep gates
in steps 1 and 6; the PR, merge after required checks, the agent release, and the live proof.
Keep every wait, hold and timeout at or under 30 minutes. Update the STATUS table with artifacts
(commit SHA, CI run id, docs/verification/ path) as rows finish.
```
