# Implementation Plan: Unblock Windows installation of ai-devops toolkit

## STATUS

| Phase | Step | Status | Evidence |
|-------|------|--------|----------|
| 1 | P1 — Patch `update.sh` path normalization | ⬜ open | |
| 1 | P2 — Patch `update.sh` / `ai-task-gates` lock fallback | ⬜ open | |
| 1 | P3 — Patch `ai-task-gates` launcher path check | ⬜ open | |
| 2 | P4 — Split review vs. install into separate tasks | ⬜ open | |
| 2 | P5 — Run second `final-check` review for deploy action | ⬜ open | |
| 2 | P6 — Run `authorize-install` with correct bindings | ⬜ open | |
| 3 | P7 — Run Windows installer (`install-ai-devops-windows.ps1`) | ⬜ open | |
| 3 | P8 — Verify installed hashes and routing | ⬜ open | |

**Fresh session starts at:** Phase 1. Re-read this STATUS table before each phase.

**Linked handoff:** `HANDOFF.d/2026-10-09T2200Z-edge-dev-mimo-windows-install-gates.md`

---

## Part 1 — Why

### 1. The ultimate goal

The ai-devops toolkit at merged commit `b9046892660d7eccd3efc0e4af84cf85849923a6` must be installed on the Windows machine `edge-dev` so that reviewer tooling, task gates, and installation authorizations work on this host. Today the installation refuses at multiple Windows-specific gates. When this is done, `ai-task-gates`, `ai-review`, and the managed launchers work on edge-dev the same way they work on edge-dev3 (Linux).

**If a step conflicts with this goal, the goal wins — stop and flag it.**

### 2. What this application is

`popcre/ai-devops` is the AI DevOps toolkit: reviewer wrappers (`ai-review`), task gates (`ai-task-gates`), lifecycle tracking, sandbox management, and installers. It is installed locally on each machine (no cloud deployment). The canonical checkout is `C:\repos\ai-devops`. Managed launchers live at `%USERPROFILE%\.local\bin\`. The repo's `main` branch is the release branch; merge queue enforces checks.

### 3. What triggered this work

Session `ses_ffe5ee11d71a2ffe5UuMOc8kR7` on edge-dev merged PR #1533 (fixture repair for the code-only test) and attempted to install the merged toolkit. The installation hit seven distinct Windows gate failures in sequence. The handoff at `HANDOFF.d/2026-10-09T0400Z-edge-dev3-codex-770-recovery-continuation.md` assumed installation on edge-dev3 (Linux). This machine (edge-dev, Windows 11, Git Bash MINGW64) has never had a clean supported install of this release.

### 4. Scope

**In scope:**
- Patch `update.sh` and `ai-task-gates` for Windows path and lock compatibility.
- Run the two-task install process (review task + installation task) on edge-dev.
- Run `install-ai-devops-windows.ps1` with one-use authorization.
- Verify installed hashes and routing.

**NOT in this plan:**
- Fixing the ENVY CI runner (Smart App Control / Worker 2.337.0). Separate limitation, preserved not bypassed.
- The shared-db #770 production cutover, rehearsal, or credential issuance. Those are downstream of installation.
- The private custody archive transfer from edge-dev3. Separate dependency.
- Any change to the merge queue, branch protection, or CI workflow configuration.

---

## Part 2 — What we already know

### 5. Current state of the code

- **Merged target:** `b9046892660d7eccd3efc0e4af84cf85849923a6` on `popcre/ai-devops` `main`. PR #1533 merged 2026-10-09T15:52:39Z. CI green except ENVY Windows section 2 (known limitation).
- **Installed checkout:** `C:\repos\ai-devops` at `63e83b0772b5b8e7a071264829b163dd863c39f6` (the commit before #1533). Needs update to `b904689`.
- **Managed launchers:** `%USERPROFILE%\.local\bin\ai-task-gates` (bash) and `.cmd`. Both have 6-line format with `source-sha`/`source-hash` receipt pointing at `356a79d6deba7d721d01967ce2dfa9525f94b98f`.
- **Candidate worktree:** `C:\tmp\ai-devops-install` was created at `b904689`, reset to `63e83b07`, fast-forwarded to `b904689`. Its `ai-task-gates start --class installation` was called with `start_head=63e83b07`, `base=b904689`.
- **Review reports:** Muse diff-review APPROVE at `C:\tmp\ai-devops-1533\.ai\reviews\muse-diff-review-20261009T125444-1278485-12429.md`. Muse final-check APPROVE at `C:\tmp\ai-devops-install\.ai\reviews\muse-final-check-20261009T175147-1827819-20806.md`. The final-check was run on the candidate worktree at `b904689`.
- **`update.sh`** is at repo root. `install-ai-devops-windows.ps1` is at `bin/`. `authorize-install` is a subcommand of `ai-task-gates`.

### 6. Key findings and root cause

| # | Error | Root cause | Evidence |
|---|-------|-----------|----------|
| 1 | `flock: command not found` | Git Bash lacks `flock` (util-linux). `update.sh:67` calls `flock -n 9`. | `update.sh:67` |
| 2 | `candidate or installed path is not a Git worktree root` | `pwd` returns `/c/tmp/...`; `git rev-parse --show-toplevel` returns `C:/tmp/...`. String comparison at `update.sh:44` fails. | `update.sh:44` |
| 3 | `Launcher is not canonical managed path` | `$HOME` is `/c/Users/ahazan` (MSYS). The canonical path is `$HOME/.local/bin/ai-task-gates`. Passing `C:/Users/...` fails the `=` comparison. | `ai-task-gates:1834-1835` |
| 4 | `Installed Windows launcher routing differs` | `PROGRAMFILES` env var is unset in Git Bash. `windows_launcher_route` builds `expected_programfiles` from `${PROGRAMFILES}\Git\bin\bash.exe`. Unset → mismatch. | `ai-task-gates:910-916` |
| 5 | `This install verification route is Linux-only` | Hard-coded `uname -s` check. `[ "$(uname -s)" = Linux ] || blocked ...` | `ai-task-gates:1495` |
| 6 | `Empty release needs an installed receipt` | `start_head == target_head` when the installation task was declared at the target commit instead of the pre-update head. | `ai-task-gates:1780-1782` |
| 7 | `Protected review and installation must use separate tasks` | The same Muse review was reused for both the PR diff-review and the install deploy authorization. `reviewer_approval_summary` for action `deploy` requires `review_mode` to be `final-check` or `security-review`, and the task declaration must be `installation` (separate from the review task). | `ai-task-gates:1835`, `review-operation.sh:449` |

### 7. Approaches considered and REJECTED

- **Faking `flock` with a stub that always succeeds.** Rejected as a permanent fix: it silently disables mutual exclusion. Acceptable only as a temporary unblock while the real fix lands; must not be committed.
- **Patching `update.sh` in the candidate worktree and committing it.** Rejected: the candidate HEAD must exactly match the reviewed commit (`b904689`). A local commit changes the HEAD and the gate refuses.
- **Bare `git pull` on the installed checkout.** Rejected by handoff rule: "Never bare-pull installed canonical checkout or copy launcher files manually."
- **Using `ai-review-preflight passed-head` to skip review.** Not applicable: that path is for reusing an existing pass, not for authorizing a deploy.
- **Running the Linux `update.sh` install verification route.** It is hard-coded Linux-only (`ai-task-gates:1495`). The Windows route is `install-ai-devops-windows.ps1`.
- **Reusing the Muse diff-review as the deploy approval.** Rejected by `reviewer_approval_summary`: action `deploy` requires `review_mode` of `final-check` or `security-review`, not `diff-review`.

### 8. Design decisions already made

- **LOCKED:** The installation must go through `ai-task-gates authorize-install` with a one-use authorization consumed by the installer. No bare pulls, no manual launcher copies.
- **LOCKED:** The review that authorizes the deploy must be a separate `final-check` review with `--implementer mimo` (different from provider `muse`), bound to the exact target head.
- **LOCKED:** The installation task must be declared with `start --class installation` at the **pre-update** installed head (`63e83b07`), then the candidate advances to the target (`b904689`).
- **LOCKED:** The ENVY CI runner limitation is preserved, not bypassed.
- **OPEN:** Whether to patch `update.sh` upstream (contributing back to `popcre/ai-devops`) or only fix locally. Default: fix locally first, propose upstream if the fix is clean.
- **OPEN:** Whether `PROGRAMFILES` should be set in the Git Bash profile or detected by the script. Default: detect in the script (more robust).

---

## Part 3 — How to build it

### Phase 1 — Patch the Windows incompatibilities (30 min)

Context cut point. Re-read this STATUS table before Phase 2.

#### P1 — Patch `update.sh` path normalization

**Target:** `update.sh` lines 42-55 (the worktree-root comparison block).

**Change:** Replace the string comparison of `source_top`/`installed_top` with `SOURCE_ROOT`/`REPO_ROOT` to use `cygpath -m` normalization with `realpath` fallback. On Windows Git Bash, `cygpath -m` converts both MSYS and Windows paths to `C:/...` form. On Linux, `cygpath` is absent and `realpath` is the correct tool.

```bash
# Before (line 44):
[ "$source_top" = "$SOURCE_ROOT" ] && [ "$installed_top" = "$REPO_ROOT" ] || {

# After:
[ "$(cygpath -m "$source_top" 2>/dev/null || realpath "$source_top")" = "$(cygpath -m "$SOURCE_ROOT" 2>/dev/null || realpath "$SOURCE_ROOT")" ] && [ "$(cygpath -m "$installed_top" 2>/dev/null || realpath "$installed_top")" = "$(cygpath -m "$REPO_ROOT" 2>/dev/null || realpath "$REPO_ROOT")" ] || {
```

**Verification gate:** `bash -n update.sh` passes. Running `update.sh --installed-checkout /c/repos/ai-devops --expected-head b9046892660d7eccd3efc0e4af84cf85849923a6` from a clean candidate worktree no longer prints `candidate or installed path is not a Git worktree root`.

#### P2 — Patch lock fallback for missing `flock`

**Target:** `update.sh` line 67. Also check `ai-task-gates` for any `flock` usage.

**Change:** Before the `flock -n 9` call, test whether `flock` exists. If not, use a fallback: create a lock directory with `mkdir` (atomic on all platforms) and store the PID. On exit, remove it. The fallback must still refuse concurrent installs.

```bash
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { warn 'another installation is active for this checkout'; exit 1; }
else
  # Git Bash on Windows lacks flock. Use mkdir-based lock.
  lockdir="${install_lock_file}.d"
  mkdir "$lockdir" 2>/dev/null || { warn 'another installation is active for this checkout'; exit 1; }
  trap 'rmdir "$lockdir" 2>/dev/null' EXIT INT TERM
fi
```

**Verification gate:** Running `update.sh` on Git Bash proceeds past the lock step. Two concurrent runs: the second prints `another installation is active`.

#### P3 — Patch `ai-task-gates` launcher path and `PROGRAMFILES` detection

**Target:** `ai-task-gates` lines 1834-1835 (canonical launcher check) and lines 910-916 (inside `windows_launcher_route`).

**Change A (launcher path):** Normalize both sides of the comparison at line 1835 with `cygpath -m`:

```bash
[ "$(cygpath -m "$installed_launcher" 2>/dev/null || echo "$installed_launcher")" = "$(cygpath -m "$canonical_launcher" 2>/dev/null || echo "$canonical_launcher")" ] || blocked 'ai-task-gates: STOP. Launcher is not canonical managed path.'
```

**Change B (`PROGRAMFILES`):** At the top of `windows_launcher_route`, detect `PROGRAMFILES` from the registry or filesystem if unset:

```bash
if [ -z "${PROGRAMFILES:-${ProgramFiles:-}}" ]; then
  if [ -d "/c/Program Files/Git" ]; then
    PROGRAMFILES="C:\\Program Files"
  fi
fi
program_files="${PROGRAMFILES:-${ProgramFiles:-}}"
```

**Verification gate:** `ai-task-gates authorize-install` with MSYS-style launcher path passes the canonical-path check and the launcher-routing check (no more `Installed Windows launcher routing differs`).

---

### Phase 2 — Two-task review and authorization (45 min)

Context cut point. Re-read Phase 1 verification results before starting.

#### P4 — Split review vs. install into separate tasks

**Target:** The `ai-task-gates` task declaration state under `%USERPROFILE%\.local\state\ai-devops\task-gates\`.

**What to do:** The review that approved PR #1533 was a `diff-review` under a `reviewer-safety` or `code-only-review` task. The installation needs its own `installation`-class task with `start_head=63e83b07` (the pre-update head). The existing candidate worktree at `C:\tmp\ai-devops-install` already has this state (verified: `status` shows `declared_class: installation`, `start_head: 63e83b07`, `base: b904689`). Do not create a second installation task — use this one.

**Verification gate:** `ai-task-gates status` from `C:\tmp\ai-devops-install` shows `declared_class: installation` and `start_head` equal to the full SHA `63e83b0772b5b8e7a071264829b163dd863c39f6`.

#### P5 — Run second `final-check` review for deploy action

**Target:** Run `ai-review muse final-check --implementer mimo --base 1861259dfa243ebe25f1b984b43d1f2a44bcd8c4 --assert-head b9046892660d7eccd3efc0e4af84cf85849923a6` from the candidate worktree `C:\tmp\ai-devops-install`.

**Critical:** The `--base` must be the merge-base (`1861259dfa243ebe25f1b984b43d1f2a44bcd8c4`), NOT `origin/main` (which is ahead). Using `origin/main` makes reviewers find false issues in files not in the PR diff. This cost 2 hours in the prior session.

**Also critical:** The review must complete with `review_mode: final-check` (not `diff-review`). The `reviewer_approval_summary` function at `ai-task-gates:450` requires `final-check` or `security-review` for the `deploy` action.

**Note:** A `final-check` review was already run at `C:\tmp\ai-devops-install\.ai\reviews\muse-final-check-20261009T175147-1827819-20806.md`. If that lifecycle record is still present and non-stale, it can be reused. Check first:

```bash
ls ~/.local/state/ai-devops/review-lifecycle/runs/4f09a1a507678570aa6c6b414021875a79038ab90865c9c97920623777170f00/muse/zcode/
```

If a completed APPROVE final-check at head `b9046892660d7eccd3efc0e4af84cf85849923a6` exists, reuse its report path. Otherwise run a fresh one.

**Verification gate:** The lifecycle state JSON has `"status":"completed"`, `"verdict":"APPROVE"`, `"stale":false`, `"review_mode":"final-check"`, `"head":"b9046892660d7eccd3efc0e4af84cf85849923a6"`, and `provider` != `implementer_engine`.

#### P6 — Run `authorize-install` with correct bindings

**Target:** From `C:\tmp\ai-devops-install`:

```bash
export PROGRAMFILES="C:\Program Files"
/c/repos/ai-devops/bin/ai-task-gates authorize-install \
  --target-head b9046892660d7eccd3efc0e4af84cf85849923a6 \
  --installed-checkout /c/repos/ai-devops \
  --installed-launcher /c/Users/ahazan/.local/bin/ai-task-gates \
  --review-report <path-to-final-check-report> \
  --reviewer-approval <path-to-same-report>
```

**Critical:** Use MSYS-style paths (`/c/...`), not Windows-style (`C:/...`) for `--installed-checkout` and `--installed-launcher`. The canonical launcher comparison at `ai-task-gates:1834` uses `$HOME` which is `/c/Users/ahazan` in Git Bash.

**Critical:** `--installed-launcher` must be `/c/Users/ahazan/.local/bin/ai-task-gates` (the managed extensionless launcher), NOT `C:/repos/ai-devops/bin/ai-task-gates`.

**Verification gate:** The command prints an authorization receipt (a one-use token/path). No `STOP` message.

---

### Phase 3 — Install and verify (30 min)

#### P7 — Run the Windows installer

**Target:** From the candidate worktree `C:\tmp\ai-devops-install`:

```powershell
pwsh -NoProfile -File C:\tmp\ai-devops-install\bin\install-ai-devops-windows.ps1 -RepoPath C:\repos\ai-devops -ExpectedHead b9046892660d7eccd3efc0e4af84cf85849923a6
```

The installer consumes the one-use authorization from P6. It fast-forwards the installed checkout, refreshes managed launchers, and records the install manifest.

**Verification gate:** The installer exits 0. `git -C C:\repos\ai-devops rev-parse HEAD` returns `b9046892660d7eccd3efc0e4af84cf85849923a6`. The managed launchers at `%USERPROFILE%\.local\bin\ai-task-gates` have a fresh `source-sha` receipt matching the new HEAD.

#### P8 — Verify installed hashes and routing

**Commands:**

```bash
# Source receipt matches
sha256sum /c/repos/ai-devops/bin/ai-task-gates
grep source-sha /c/Users/ahazan/.local/bin/ai-task-gates

# Launchers work
/c/Users/ahazan/.local/bin/ai-task-gates --version 2>&1 | head -3

# Reviewer wrapper resolves
ai-review-preflight usable deepseek 2>&1 | head -5

# Task gates functional
cd /c/repos/ai-devops && ai-task-gates start --class reviewer-safety 2>&1
```

**Verification gate:** All four commands succeed. `ai-review-preflight usable deepseek` names the resolved wrapper (`wrapper_command: ai-deepseek-agent` or similar).

---

## Part 4 — Landing it

### 10. Tests required

- `bash -n update.sh` — syntax check after P1 and P2 patches.
- `bash -n bin/ai-task-gates` — syntax check after P3 patches.
- `tests/test-ai-task-gates.sh` — must stay green (run from `C:\repos\ai-devops` after install, or from the candidate before).
- `tests/test-ai-review-lifecycle.sh` — must stay green.
- No new test files are required for the path/lock fallbacks if the existing suites cover the code paths; add a focused test only if the existing suites do not exercise the Windows path format.

### 11. Constraints, standing rules, and gotchas

- **Branch policy:** `feature-branch-pr` for `popcre/ai-devops`. Never push to protected `main` directly. The patches in P1-P3 need their own PR if contributed upstream; a local-only fix does not.
- **No bare pulls** on the installed checkout. Always through `authorize-install` + installer.
- **Never copy launcher files manually.** The installer owns them.
- **Reviewer must differ from implementer.** Provider `muse`, implementer `mimo`. Never the same engine.
- **`--base` must be the merge-base** (`1861259d`), not `origin/main`. Using `origin/main` makes reviewers diff against the wrong range and find phantom issues.
- **MSYS paths in `authorize-install` calls.** `/c/Users/ahazan/.local/bin/ai-task-gates`, not `C:/Users/...`.
- **`PROGRAMFILES` must be set** in the shell running `authorize-install` if the script patch (P3-B) is not yet applied.
- **The installation task's `start_head` must be the pre-update head** (`63e83b07`), not the target. Declaring at the target triggers `Empty release needs an installed receipt`.
- **ENVY runner limitation is preserved.** Do not disable Smart App Control or downgrade Worker.

### 12. Access and environment

- **Machine:** edge-dev (Windows 11, Git Bash MINGW64_NT-10.0-26300).
- **Git identity:** `Albert Hazan <u2giants@users.noreply.github.com>` (verified via `git var GIT_COMMITTER_IDENT`).
- **Repos:** `C:\repos\ai-devops` (installed checkout), `C:\tmp\ai-devops-install` (candidate worktree).
- **1Password:** vault `vibe_coding`. No secrets needed for this installation — the reviewer wrappers use their own protected key stores.
- **Reviewer tooling:** `ai-review` at `%USERPROFILE%\.local\bin\ai-review`. Muse is registered and available. DeepSeek doctor passes (curl, Python, timeout 300s).
- **Environment variables needed:** `PROGRAMFILES="C:\Program Files"` (until P3-B lands).

### 13. Definition of done

- [ ] P1-P3 patches applied and `bash -n` passes on each patched file.
- [ ] Existing test suites (`test-ai-task-gates.sh`, `test-ai-review-lifecycle.sh`) pass.
- [ ] P4: installation task correctly declared with `start_head=63e83b07`.
- [ ] P5: `final-check` APPROVE review exists at head `b904689` with `review_mode: final-check`.
- [ ] P6: `authorize-install` produces a one-use authorization receipt.
- [ ] P7: Windows installer exits 0; installed checkout HEAD is `b904689`.
- [ ] P8: launcher hashes match; `ai-review-preflight usable` resolves wrappers; `ai-task-gates start` works.
- [ ] GitHub issue closed with live proof.
- [ ] Plan STATUS table updated with evidence for each completed row.

**Risks:**
- The Muse review system was flaky on this machine earlier (DeepSeek processes killed, Codex sandbox denied). If Muse also fails, try `ai-review stepfun final-check` or `ai-review glm final-check` — both are registered.
- The installer may hit additional Windows gates not yet discovered. Each new gate needs its root cause diagnosed before a workaround is applied; do not blanket-disable checks.

**Open questions:**
- Should the P1-P3 patches be contributed upstream to `popcre/ai-devops`? Criteria: if the fix is clean (≤10 lines total, no security change), open a PR. Otherwise keep local and open an upstream issue.
- If `final-check` review at the exact head cannot be obtained (reviewer outage), the install is blocked. No skip path exists by design.

---

## Self-audit

1. **Could a brand-new AI session with no project knowledge execute this plan without asking anything?** Yes. Sections 5-8 carry the full state, root causes, and rejected approaches. Section 9 names exact files, line numbers, commands, and verification gates. Section 12 defines the environment. The one gap found and filled: the `--base` merge-base trap (P5) and MSYS path requirement (P6) were added after the audit prompted for "every trap specific to THIS work."

2. **Does the plan carry every piece of background and nuance?** Yes. Section 7 records all seven failures and their root causes with `file:line` evidence. Section 7 lists every rejected approach. Section 8 labels locked vs. open decisions.

3. **Is the ultimate goal stated clearly enough for judgment calls?** Yes. Section 1 states the goal in business English and includes the "goal wins" instruction. If a patch would break Linux behavior, the implementer knows to stop and flag.
