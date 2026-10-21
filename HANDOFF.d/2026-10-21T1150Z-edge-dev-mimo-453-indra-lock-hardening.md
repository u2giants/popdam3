---
issue: 453
status: OPEN
owner: mimo/453-indra-lock-hardening
---

# Handoff — Indra provisioning lock hardening (#453), closing the ScaleDown/Indra workstreams

Written at 2026-10-21T11:50Z by MiMo session `ses_ffe5eaa01304affevw0YvNwLI7` on machine `edge-dev`. All facts re-checked at write time (see §3 and §9 for the check stamps).

## 0. Business decisions only the owner can make

**None blocking — nothing in this workstream needs the owner.**

One judgment call worth his one-word answer, not blocking anything:

- **Should a multi-tenant Windows render agent ever be supported?** The lock hardening in [#453](https://github.com/u2giants/popdam3/issues/453) exists only for boxes that run several agent tenants at once; production runs a single agent on `edge-alien`. **Recommendation: leave #453 parked until such a box is actually planned.** Blocks nothing today.

**Already settled — do NOT re-ask** (all from Albert, 2026-10-20/21):

- ScaleDown Summarize must be selectable for PDF Text Extraction ("make sure scaledown summarize is available in the dropdown") — shipped, PR #445.
- Every PDF text-extraction path must start with Indra ("it will always start with Indra") — verified true; bridge image and Windows agent both provisioned.
- Bridge agent must run the newest image ("bridge agent on the latest now") — done via the apply request the Update button writes.
- Windows agent must check for Indra at startup, show it in the panel, and install it if missing — shipped, PR #450/#452.
- Issue #451's four deferred review items — shipped by sub-agent `general-1` in PR #452, issue closed.

Instruction for the next session: if any owner question ever appears, put the whole list to Albert in ONE message before starting work.

## 1. What this application is

PopDAM is an internal Digital Asset Manager for licensed consumer-product art (Disney, Marvel, etc.) at [u2giants/popdam3](https://github.com/u2giants/popdam3). A React web app (Vite + Tailwind + Shadcn) on Coolify serves two hostnames: `dam.designflow.app` (PopDAM catalog) and `sg.designflow.app` (PopSG style-guide library). Supabase project `qsllyeztdwjgirsysgai` is the shared backend (Postgres + edge functions). Two always-on agents do the heavy lifting: the **bridge agent** in Docker on Synology NAS `edgesynology1`, and the **Windows render agent** (`PopDAMWindowsAgent` service) on the Windows VM `edge-alien` (Inkscape/ImageMagick/Ghostscript/Poppler/**Indra OCR** — no Illustrator). The Railway worker does AI tagging batches. PDF text extraction cascade everywhere: native PDF text layer (mupdf) → **Indra OCR** (tesseract.js only if Indra is absent/broken) → AI vision (ScaleDown / OpenRouter / direct Google/Anthropic).

## 2. What we set out to do this session, and why

Four linked owner requests, in order (2026-10-20/21):

1. Make `scaledown/summarize` selectable as the PDF Text Extraction model in Settings → Processing → AI Tagging, and make selecting it actually work on both agents (it was hard-blocked by `modelAllowedForTask` and neither agent could call ScaleDown).
2. Verify that every PDF text-extraction path starts with Indra; fix labels that still said "tesseract.js"; decide whether the bridge's compat-placeholder check should use Indra.
3. Get the Windows agent to check for Indra at startup, show status in the panel, and self-install when missing — because Indra is provisioned **outside** the shipped code (Python venv + models, set once by the installer), while OTA updates only swap code, so an older install silently OCR'd with tesseract.js.
4. Take GitHub issue #451 (the deferred review items from the #450 review) — delegated to sub-agent `general-1`, shipped as PR #452.

## 3. Current state — what is true right now

Checked 2026-10-21T11:48Z: `origin/main` = `2221712c50672a718aaa22eed8ea204d4505183c`.

**Shipped and live (all four PRs MERGED):**

- [PR #445](https://github.com/u2giants/popdam3/pull/445) — ScaleDown Summarize for PDF Text Extraction (squash `d50aae5b`). Selectable in the task dropdown only for `pdf_extraction`; agents route `scaledown/` to ScaleDown's endpoint **before** the OpenRouter branch; `SCALEDOWN_API_KEY` delivered to both agents with the other provider keys. Live proof: dropdown confirmed in the live settings UI by Albert.
- [PR #448](https://github.com/u2giants/popdam3/pull/448) — OCR labels corrected (`OCR (Indra)` in the PDF-samples progress UI; `docs/WORKER_LOGIC.md` cascade rows) + unit test + `docs/idiosyncrasies.md` dispatch note (compat audit is Windows-only, perceptual hash, no OCR).
- [PR #450](https://github.com/u2giants/popdam3/pull/450) — Windows agent Indra self-check/self-install (`apps/windows-agent/src/indra-provision.ts`), `ocr_indra` heartbeat → `agent-api` metadata → Settings → Windows Render Agent panel line, runbook §10. Windows agent **0.16.9.183** is live on `edge-alien` and reports `{"state":"ready","python":"C:\\ProgramData\\PopDAM\\indra\\Scripts\\python.exe","models_dir":"...\\indra\\models"}`.
- [PR #452](https://github.com/u2giants/popdam3/pull/452) (sub-agent `general-1`) — closes [#451](https://github.com/u2giants/popdam3/issues/451): cross-process provisioning lock (`indra.provision.lock`, stale PID/age detection), honest panel status during reprovision (`beginProvisioningStatus` / `provisionIndra(onProgress)`), `npm test --prefix apps/windows-agent` wired into [ci.yml](https://github.com/u2giants/popdam3/blob/2221712c/.github/workflows/ci.yml) (live run: [actions/runs/39533766153](https://github.com/u2giants/popdam3/actions/runs/39533766153)), package-lock/runbook/path-escaping minors.

**Half-done:** nothing. No unpushed commits of this session; no open PR of this session.

**Not started:** the three lock residuals tracked in [#453](https://github.com/u2giants/popdam3/issues/453) (see §6).

**One deliberately kept local branch:** `mimo/scaledown-pdf-text-extraction` in the shared checkout holds a **foreign, unpushed** commit `241c01f1` ("Merge remote-tracking branch 'origin/main' into mimo/scaledown-pdf-text-extraction") created by another session's `git pull` while my branch was checked out. Its remote counterpart pointed at `057a0705` (PR #445's head) and was deleted after merge. The local branch is kept so that other session's bytes are not destroyed — a later session may inspect and drop it (the merge carries nothing unique: both parents are on `main`).

## 4. Everything we tried that did NOT work

This is the expensive knowledge; do not re-walk these.

1. **`modelAllowedForTask` blocked every `scaledown/` id** (`src/lib/ai-model-options.ts`). Fixing it was not enough — the model also never appeared in the dropdown because the catalog comes from `get-openrouter-vision-models`, which cannot list a direct-provider model. It must be injected client-side (`SCALEDOWN_SUMMARIZE_CATALOG_MODEL` in `src/lib/ai-model-catalog.ts`, merged in `ApisTab.tsx`), the same trick `ModelPoolEditor` already used.
2. **First review REJECT (PR #450):** my "partial download is not a complete engine" check used `existsSync(modelsDir)`, but `snapshot_download` creates the directory before the first file lands — a timed-out download looked installed and the panel said "ready". Fix: completeness = `meta.json` + at least one `.onnx` over 1 MB.
3. **Second review REJECT (PR #450):** the verify step ran `OrtOCR(model_dir())` **before** the environment was set, so on the first-time self-install `model_dir()` fell back to the Hugging Face cache (empty) → the whole install reported `error` even though venv/pip/models had succeeded. Fix: pass the models directory explicitly in the verify command (`deepVerifyScript(modelsDir)`), never rely on env a subprocess is about to set. A regression test now forbids `model_dir()` in the plan's verify step.
4. **ScaleDown truncation bug caught in two review rounds (PR #445):** an envelope `{finish_reason:"length", summary:"PARTIAL"}` was accepted as page text (first fix only checked the API-level `finish_reason`), and an error envelope could also be indexed. Final rule: the envelope's own `finish_reason`/`error` wins; only a non-empty `summary` is returned; JSON without text throws — never store the envelope as transcription.
5. **`ai-task-gates check --before ship` refused repeatedly** until all of these were true at once: the review mode was `final-check` (a `diff-review` approval does not satisfy a ship action), the report path matched the recorded `report_path` exactly (so a moved worktree breaks the path check — recreate the worktree at the same path or re-review), the record carried `implementer_engine` different from the reviewer, and the record carried `tests.exit==0` — which only happens when the review is run with `--tests "…"`; the command must install its own dependencies because the review snapshot has no `node_modules` (`npm ci --no-audit --prefer-offline && npm ci --prefix apps/windows-agent --no-audit --prefer-offline && npm test -- --testTimeout=20000 && npm test --prefix apps/windows-agent`).
6. **`ai-review` intermittent failures:** `stale-source`/`source-identity-changed` when a leftover `.ai/deepseek-sessions/*.source.oCMeeT` temp file from a failed run sits in the tree (delete it and retry), and `source-head-mismatch` when another session moves the shared checkout's HEAD mid-review (always review from your own worktree). Long runs can also die with `ChildProcess.kill` from the bash tool — the recorded workaround is to start the review detached (`Start-Process`) and poll a log file.
7. **`bash` on PATH in this Windows environment is WSL** ("Windows Subsystem for Linux has no installed distributions"). Scripts for Git bash must be invoked as `"C:\Program Files\Git\bin\bash.exe" …`, ideally via a temp script file — nested `bash -c "…"` quoting from PowerShell mangles silently.
8. **Shared-checkout clobbering (twice):** running `ai-task-gates start`/`end` with the default working directory recorded or cleared **another session's** task declaration in `C:\repos\popdam3`. Both times it was restored with that session's exact reason/base. Rule: every write-capable task gets its own worktree, and gates commands run with `workdir` set to it.
9. **`git worktree remove` failures:** it refuses while the shell's cwd is inside the worktree, and Windows file locks can leave a directory behind even after git unregisters it — run the removal from the repo root, then `Remove-Item -Recurse -Force` the leftover once `git worktree list` no longer shows it.
10. **Frontend tests flaky under machine load:** `order-list-grid` and other jsdom tests hit vitest's 5 s timeout when another session is running suites — `npm test -- --testTimeout=20000` is the contention-safe form (CI is unaffected). Also pre-existing and unrelated: `apps/bridge-agent` `liveness-watchdog` "SIGKILLs a frozen process" fails on Windows (signal reporting differs) — ignore.
11. **`ai-shared-db-closeout-check` cannot take a MiMo identity:** it only accepts a UUID in Codex/Claude owner formats (`"Codex chat <uuid> on <machine>"` etc.) and rejects `ses_ffe5eaa0…`. No claim was ever opened on `popcre/shared-db` by this session (verified by `gh search issues --repo popcre/shared-db "ses_ffe5eaa01304affevw0YvNwLI7"` → empty), so nothing was owed; the receipt itself is a tooling gap, not missing data.
12. **`gh` OAuth token lacks the `workflow` scope** (found by sub-agent `general-1`): pushes that touch `.github/workflows/**` are refused; push such branches over SSH (`git push git@github.com:u2giants/popdam3.git …`). `gh auth refresh` needs an interactive device flow. Also never set `AI_REVIEW_EVENT_DIR` inside a repo — the events file trips the `never-open-raw-transcript-archives` task gate.
13. **The prose-only admin-merge lane is unusable on popdam3 (2026-10-21):** `bin/ai-doc-safety` cannot produce a receipt here. `ai-public-boundary-check` kills its whole process tree on this repo in this environment (it never returns — even a fully detached, output-redirected launch dies; the script accumulates every `[a-z]{20}` match into one shell string and appears to blow up on a 4,400-file docs-heavy tree), and `tools/check-markdown-links.py` exits 1 on **652 pre-existing** missing local targets, all inside the vendored `shared-db/` mirror (e.g. `shared-db/plan_*.md` pointing at handoff files that never existed in this repo) plus a couple of `file:///home/...` escapes in `shared-db/docs/investigations/`. None of those hits are in the handoff file being landed (0 matches). The admin lane says "fix the named file first" — the named files are vendored mirror content owned by `popcre/shared-db`, and fixing the checker is `ai-devops` work: both are new work and belong to the next session, not this wrap-up. Consequence used here: the handoff PR goes through the **normal** squash lane with CI (lint + tests) instead of `--admin`.

## 5. Root causes and key findings

- **Indra lives outside the code** — a Python venv + ONNX models under `C:\ProgramData\PopDAM\indra`, set once by `scripts/windows-agent/install-service.ps1` (or baked into the bridge image). OTA updates swap code only. That is why a pre-Indra install silently OCR'd with tesseract.js forever, and why `apps/windows-agent/src/indra-provision.ts` exists: check at startup, install/repair in the background, report `ocr_indra` on every heartbeat, verify by **loading the model from the directory it provisioned**. Pins everywhere: `indra-ocr==1.1.1`, models revision `v1.1.0`.
- **Compat-placeholder detection is not text extraction.** `agent-api` dispatches compat audit requests only to `windows-render` agents, and Windows detects the Adobe warning page by perceptual hash (`apps/windows-agent/src/compat-audit.ts`) with no OCR at all. The OCR-based handler still sitting in `apps/bridge-agent/src/handlers/compat-audit.ts` is unreachable — do **not** add Indra (or any OCR) there ([docs/idiosyncrasies.md](https://github.com/u2giants/popdam3/blob/2221712c/docs/idiosyncrasies.md) "Compat-thumbnail audit" entry).
- **ScaleDown PDF route** (`scaledown/summarize`): page goes to `https://api.scaledown.xyz/v1/chat/completions` as the non-standard base64 `document` field; response unwrapped from `{"summary": …}`; key `SCALEDOWN_API_KEY` from `admin_config` (delivered to agents in the heartbeat `ai.scaledown_api_key`; the Railway env fallback is worker-only). AI vision never runs before the Indra OCR step.
- **Task-gate classes** come from path globs in [`.ai-devops/task-gates.json`](https://github.com/u2giants/popdam3/blob/2221712c/.ai-devops/task-gates.json): `apps/**` and `supabase/functions/**` are `deployment` → ship needs an assigned AI reviewer APPROVE (`final-check` mode) with passing `--tests` evidence, plus `local-tests`. `src/**` alone is `ui-live-workflow` (no tool-level gate).
- **Bridge update flow:** `admin_config.AGENT_UPDATE_REQUEST {action:"apply", requested_at, request_id}` (what the panel's Update button writes) is consumed on the next bridge heartbeat (5-minute age window) and forces `docker pull ghcr.io/u2giants/popdam-bridge:stable` + restart. The NAS never auto-applies a release.

## 6. Exact next steps (the only open work: #453)

Work lives in [issue #453](https://github.com/u2giants/popdam3/issues/453) — three hardening residuals on the provisioning lock added by PR #452, in `apps/windows-agent/src/indra-provision.ts`:

1. Make lock steal/release atomic (today it is read-then-unlink, so a second process can race the unlink). You'll know it worked when a unit test shows a competing acquirer cannot steal a lock mid-release.
2. Revisit `pidAlive`'s EPERM handling (treated as dead today, so a live foreign-uid owner looks stale). You'll know it worked when EPERM keeps the lock instead of stealing it.
3. Align `LOCK_WAIT_MS` (30 min) with `LOCK_STALE_MS` (45 min) so a waiter cannot give up while the lock is still considered fresh. You'll know it worked when the two constants have a documented relationship and a test asserts it.

Shipping procedure (same as PR #452): own worktree from `origin/main` → branch `mimo/453-…` → implement + unit tests in `apps/windows-agent/src/indra-provision.test.ts` → `npm test --prefix apps/windows-agent`, `npm test -- --testTimeout=20000`, `npm run lint`, `npx tsc --noEmit -p tsconfig.json` and `-p apps/windows-agent/tsconfig.json` all clean → push (SSH if the change touches `.github/workflows/**`) → PR to `main` → `ai-task-gates start --class deployment --reason … --base <origin/main sha>` in your worktree → `ai-review deepseek final-check --base <base> --assert-head <head> --implementer mimo --tests "npm ci --no-audit --prefer-offline && npm ci --prefix apps/windows-agent --no-audit --prefer-offline && npm test -- --testTimeout=20000 && npm test --prefix apps/windows-agent"` → `ai-task-gates check --before ship --reviewer-approval <report>` → wait CI green → `gh pr merge <n> --repo u2giants/popdam3 --squash` → verify the merge commit's workflows all succeed → close #453 with a signed comment (`Posted by MiMo chat <id> on edge-dev`) and live-proof evidence → `ai-task-gates end` in your worktree and remove it.

If Albert answers §0 "yes, multi-tenant Windows will be supported", do #453 before any such box ships. If "no", #453 stays parked — say so on the issue and do not implement it speculatively.

## 7. Constraints and gotchas in force

- **Never edit the shared checkout `C:\repos\popdam3`** — other live sessions work there (`mimo/indra-ocr-1.1.1` and several `codex/*` worktrees). Create your own worktree per task; run `ai-task-gates` with that worktree as cwd; never `git pull` in it (another session's `git pull` is what produced the stray merge commit on `mimo/scaledown-pdf-text-extraction`).
- **Ship path:** branch + PR to `main`, never a direct push; squash-merge. Do not use `git branch --merged` to judge mergedness (squash destroys ancestry) — ask GitHub (`gh pr view <n> --json state,mergedAt`).
- **Deployment-class changes** (`apps/**`, `supabase/functions/**`, `.github/workflows/**`) need the DeepSeek `final-check` review with `--tests` evidence before `check --before ship` passes. Reviewer must differ from the implementer (`--implementer mimo`).
- **Bump versions in the same commit as agent code:** `apps/bridge-agent/package.json` (NAS sees no update without it; then apply via `AGENT_UPDATE_REQUEST`) and `apps/windows-agent/package.json` (base version; CI stamps `BASE.RUN_NUMBER`, e.g. `0.16.9.183`).
- **Sign every GitHub post:** `Posted by MiMo chat ses_ffe5eaa01304affevw0YvNwLI7 on edge-dev` (or the current session id / machine).
- **No secrets in files, commits, chat, or command arguments.** 1Password vault `vibe_coding` only; fetch via `op item get … --reveal` into a variable that is never printed.
- **Untracked files in the shared checkout are not yours:** `.playwright-cli/`, `.tmp-liveproof-243/`, `docs/verification/*.png`, and `.ai/` (review reports) belong to other sessions/tooling — leave them.

## 8. Access and environment

- Machine: `edge-dev` (Windows). Git bash at `"C:\Program Files\Git\bin\bash.exe"`; PowerShell 7 shell; `npm`/`node` on PATH; `MIMO_PYTHON` etc. for the bundled runtimes.
- `gh` is authenticated as `u2giants` (pull/PR/merge fine; **no `workflow` scope** — use SSH to push workflow changes). Repo: [u2giants/popdam3](https://github.com/u2giants/popdam3).
- Installed CLIs: `ai-task-gates`, `ai-review` (DeepSeek final-check works; run detached if it gets killed), `ai-housekeeping`, `ai-doc-safety`, `ai-shared-db-closeout-check` (identity gap for MiMo, see §4.11), `op` (1Password).
- 1Password vault `vibe_coding` (reference by item ID only): Supabase runtime keys for the shared POP database = `3hhxwrljnaq2tykxi7hplq5ryi`; SSH key `916-alien` = `5zgrrzljx52tewbj7excuzvloa` (also present as the local `916-alien` key file).
- Windows agent host `edge-alien` reachable as `ssh edge-alien` (user `ahazan`, Tailscale/LAN) — read-only inspection of the agent install is fine; host changes are Ansible-territory only for `hetz`, not this VM (its runbook is `docs/WINDOWS_AGENT_RUNBOOK.md`).
- Test commands that pass here: `npm test -- --testTimeout=20000` (root), `npm test --prefix apps/windows-agent`, `npm test --prefix apps/bridge-agent` (one pre-existing Windows-only failure, see §4.10).

## 9. Open questions and risks

- **[#453](https://github.com/u2giants/popdam3/issues/453) (open, 2026-10-21):** lock TOCTOU, `pidAlive` EPERM handling, wait/stale window — parked until a multi-tenant Windows box is planned (owner call, §0). Single-tenant production is unaffected.
- **MiMo identity gap in `ai-shared-db-closeout-check`** (2026-10-21): it only understands Codex/Claude UUID owner strings, so a MiMo session cannot produce the mandated receipt. This session owed no shared-db handover (read-only schema inspection + one ordinary `admin_config` application row write — owner ruling 2026-08-13 says that is not a handover trigger; zero claims, verified by search). A future MiMo session that *does* take shared-db claims will need this fixed or a reviewed workaround.
- **`ai-doc-safety` unusable on popdam3** (2026-10-21, see §4.13): the boundary check kills its process tree and the markdown-link check fails on 652 pre-existing vendored `shared-db/` targets. Until someone fixes the checker (ai-devops) or the mirror links (shared-db), prose-only PRs in this repo must use the normal squash+CI lane and say why. Candidate follow-up work, not started.
- **Stale local branch `mimo/scaledown-pdf-text-extraction`** (2026-10-21): holds foreign unpushed merge commit `241c01f1`; kept deliberately (§3). Safe to drop once its owner confirms; do not push it.
- **Bridge OCR compat handler is dead code** (2026-10-21): unreachable (Windows-only dispatch). Retire it someday; do not "fix" it by adding Indra.
- **Version strings can lie** (existing quirk): trust `build_sha` on the bridge; the Windows agent reports only a stamped version (`BASE.RUN_NUMBER`).
- Anything read more than an hour before a later session should be re-checked: `origin/main` tip was `2221712c` at 2026-10-21T11:48Z; PR states #445/#448/#450/#452 MERGED at the same time.

## Part (b) — sub-agent work, separated by sub-agent

### Agent: `general-1` (spawned 2026-10-21, worktree `C:\repos\popdam3-wt-451`, branch `mimo/451-indra-followups`) — FINISHED
- **Asked to do:** implement and ship all four items of issue #451 (multi-tenant provisioning race; panel honesty during reprovision; run windows-agent tests in CI; minors), then close the issue with live-proof evidence.
- **Actually did:** PR #452, squash-merged as `2221712c50672a718aaa22eed8ea204d4505183c` (2026-10-21T02:34Z). Lock file `indra.provision.lock` with stale PID/age detection; `beginProvisioningStatus`/`provisionIndra(onProgress)` so the panel says "installing" for the whole window; `ci.yml` runs `npm test --prefix apps/windows-agent` (live run [39533766153](https://github.com/u2giants/popdam3/actions/runs/39533766153), 68 node:test + 11 vitest pass); package-lock → 0.16.9; runbook sections re-ordered 8→9→10; Python JSON-string and PowerShell quoted-path escaping with tests. DeepSeek final-check APPROVE on head `bab69bbc`. Issue #451 closed with evidence comment.
- **Found:** `gh` token lacks `workflow` scope (push workflow changes over SSH); `AI_REVIEW_EVENT_DIR` inside a repo trips the task gate; long `ai-review` runs die under the bash tool's `ChildProcess.kill` (start detached + poll a log). Reviewer-accepted residuals became issue #453.
- **PR / branch:** [PR #452](https://github.com/u2giants/popdam3/pull/452) merged; remote branch deleted after merge.
- **Worktree:** finished — removed by the sub-agent after merge.
- **Deliberately did NOT do, and why:** the three lock hardening residuals (TOCTOU, EPERM, wait/stale window) — accepted by the reviewer as non-blocking for the single-tenant production shape and filed as #453 rather than expanding scope on a shipping PR.

## Self-audit (handoff-writer gate)

1. **Comprehensive enough for a brand-new developer?** Yes — §1 explains the app and hosts; §2 the four owner asks; §3 the exact landed state with PR URLs and live proofs; §6 the one open workstream with per-step verification gates; §7/§8 the rules and access.
2. **Detailed enough to continue as well as I could right now?** Yes — §4 lists every dead end with the fix (gate modes, review identity/path/tests evidence, stale-source, WSL `bash`, shared-checkout clobbering, flaky timeouts); §5 the durable findings with file references.
3. **Every relevant detail included?** Yes — background/goals (§1–2), current + deployed state (§3), failures (§4), decisions/constraints (§0, §5, §7), risks (§9), exact next actions + evidence gates (§6), sub-agent record (part b). Secrets by vault/item ID only (§8).
4. **Owner reading only §0 sees every business decision and no technical approvals?** Yes — §0 has one non-blocking judgment (multi-tenant future) with a recommendation, the settled list, and no technical approvals; the sweep found no other owner-only sentences in §1–§9 or part (b) (everything technical routes to an AI reviewer, an issue, or `Blocked —`).
