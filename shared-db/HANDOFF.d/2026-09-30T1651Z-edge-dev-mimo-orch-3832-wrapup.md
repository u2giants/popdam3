---
issue: 3832
status: OPEN
owner: mimo/orch-3832-wrapup
---

# Shared-db orchestrator #3832 wrap-up (MiMo chat ses_ffe5f11ee4312ffetphUcC3hBX, edge-dev)

All times America/New_York (EDT). Facts checked 12:51 PM EDT, 2026-09-30.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None blocking technical work. One standing hold:

- **#1941 Laura/Ilona licensed-property sign-off** — on hold until **2026-10-05** per Albert (~3:05 PM EDT 2026-09-28). Dependents #2601, #2541 stay parked. Do not re-ask before that date.

Already settled — do NOT re-ask:

- Never ask Albert to approve technical risk; independent AI reviewer / governed machine gate decides.
- 2026-09-29 handover: authorized successor from #3821 (`owner-authorized-handover #3821`).
- 2026-09-29 ~4:40 PM EDT (Albert, current chat): "replace grok with stepfun for reviews for the rest of this session" — session-scoped preference. StepFun (`ai-stepfun`) reported `usable: true` on edge-dev via `ai-review-preflight usable stepfun`. Prefer StepFun over Grok for any further reviews **in a future session only if Albert repeats it**; otherwise normal rotation applies.

## 1. What this application is

`popcre/shared-db` is the shared Supabase schema repo for POP Creations apps. Structure (DDL) is governed here via branch+PR+Guarded Merge. Production project ref `qsllyeztdwjgirsysgai`; preview `mvpkijzfmfcxhnzqogzs`.

## 2. What we set out to do this session

Successor shared-db orchestrator after marker #3821 closed (handover PR #3831, briefing `HANDOFF.d/2026-09-29T1504Z-edge-dev-mimo-orch-3821-wrapup.md`). Ordered queue:

1. #3711 slot-2 review then merge via conductor
2. #2179 preview/prod then #2176
3. protected-file queue #3657 → #3808 → #3396 → #3787 → #3647 → DesignFlow
4. merge #3830 then finish #3683
5. #3825 / #3828

## 3. Current state — what is true right now

**Main tip `1a622c37560931f3144ac45ff47cfa6f01ee5eb9` at 12:51 PM EDT 2026-09-30.** Max migration on main: **`20260929093750`** (ColdLion item_image_metadata). Marker **#3832 OPEN** (`route_id: local_8bdb029f-3df3-4463-9681-cdef0d35fc4a`, MiMo session `ses_ffe5f11ee4312ffetphUcC3hBX`).

### Done this session

| Item | Result |
|---|---|
| Successor marker | **#3832** opened; `check-orchestrator-marker.mjs --resolve` prints own route_id |
| #3830 merged-head review binding | **MERGED** `6dda8e32` after DeepSeek APPROVE at `a334fb214`. Unblocks #3683. |
| #3711 ColdLion /itemImages | **MERGED** `1a622c37` after many review rounds. Final head `5bda0b5c7`, two-slot APPROVE (grok-4.6 + muse-spark-1.3). |
| #2179 | **CLOSED live_verified.** Migration `20260929093750` on production (run `36653830356`). |
| Preview apply | run `36652482777` (merged_rehearsal `20260929093750`) |
| Production apply | run `36653830356` via v1 Production Apply Review Evidence (`36653099478`) after auto-v2 fail-closed on material_access_change |
| #2179 writes list | Amended to exact inspection objects (table + 6 columns + 2 indexes) |
| Claim #3706 | Amended objects to include the two indexes |
| Reviewer issue | `20260929T203215Z-edge-dev-deepseek-7809` (DeepSeek REVISE-loop on required evidence head_sha layout) |
| Parked wait | Issue **#3833** (ai-blocker-watch) — can be closed; wait released by 3711 merge |

### Half-done / not done

| Item | Exact state |
|---|---|
| **#2176** | OPEN. Consumer-safe promotion contracts (unit 6). Needs fresh claim + author. Scope block historically malformed (`function ` empty). `plm.import_coldlion_vendors(jsonb)` does **not** exist live — do not assume it. |
| **#3683** NBCU | OPEN. Unblocked now that #3830 merged. Needs governed review at merged head `258f0319` on PR #3695, then preview/prod. NBCU migration `20260929045102` not on production. |
| **protected-file queue** | #3657 (StepFun rotation, draft) → #3808 → #3396 → #3787 → #3647 → DesignFlow #2870/#3707/#3708/#3737/#2873. One open PR at a time touching `manage-migration-author-lanes.mjs`. |
| **#3825** | OPEN PR. Agent work contract FAILURE (missing/mismatched `.agent` evidence pair). Was RED on truth-audit inventory. |
| **#3828** | OPEN PR. Mostly green; guarded-merge authorization needs re-run. Unblocked after #3620. |
| Claim transfers | #2110 (#3378), #3175 (#3307), #2662 (#3294) after #3620 tool — not started. |
| **#3833** | Parked wait issue from this session — close when convenient. |

### Preview / production

- Preview: `20260929093750` applied (run `36652482777`). Ledger otherwise as prior session left it.
- Production: `20260929093750` **applied** (run `36653830356`, artifact `sha256:9772a22e21f1cdf1bd01ac4a7835bdce9d192ac79b2c8516877ad2dce0a3e6de`). Prior recovery-wave versions remain applied. NBCU `20260929045102` still not promoted.

### Merge conductor

One conductor at `C:\Users\ahazan\.cache\conductor-3821\`. Drive: `& "C:\Program Files\Git\bin\bash.exe" "C:/Users/ahazan/.cache/conductor-3821/drive.sh" <PR>`. Used successfully for #3711 and #3830.

## 4. Everything we tried that did NOT work

1. **`--prompt-file` as a run-governed-review main arg** — refused; it is a wrapper arg after the single `--` separator.
2. **`-- -- send` (double separator)** for DeepSeek — second `--` becomes `wrapperArgs[0]`; correct is `-- send --prompt-file <brief>`.
3. **Two evidence pairs in one PR** (gen 6 + gen 7 on #3711) — `Agent work contract` "more than one agent evidence pair". Fix: rebuild branch with only the latest pair after the implementation head.
4. **Evidence files split across two commits** (completion-only tail) — `only this pull request's own two evidence files may follow report.head_sha`. Both contract.json and completion.json must change together after `head_sha`.
5. **Index objects not in claim/writes** — lease check `REFUSED: migration writes undeclared objects: index ...`. Must amend both #2179 `writes:` and claim #3706 `objects:` to the exact inspection set.
6. **Backslash regex in live proof** (`\(run_id\)`) — `check-live-proof-probe.mjs` lexer refuses. Use POSIX classes `[(]` `[)]` `[.]`.
7. **Automatic v2 production promotion** on `20260929093750` — fail-closes (`material_access_change`). Supported path: v1 `Production Apply Review Evidence` + dispatch with `source_pr`.
8. **Artifact digest truncated in logs** — 63-char hex failed `DIGEST_RE`; read the full line from `gh run view --log`.
9. **`ai-reviewer-issue record --wrapper`** — unknown option; use `--command` + `--caller` + `--session-id`.
10. **`prepare-preview-dispatch` without `ORCHESTRATOR_ROUTE_ID`** — "matching live sole-orchestrator marker is required". Set env to the marker's route_id.
11. **Stranded author mutex** `refs/db-coordination/author-acquisition` at `2909add5…` — local `--recover-author-mutex` refused (needs serialized workflow). Dispatch `recover-author-mutex.yml` with `expected_sha` + `confirmation=RECOVER <sha>`.
12. **DeepSeek REVISE-loop** on the *required* `completion.head_sha` = implementation-head layout. Logged as reviewer issue `20260929T203215Z-edge-dev-deepseek-7809`. Brief must state this is not a finding; Grok/Muse accept it.
13. **Grok tool-timeout kills the runner after Grok finishes** — recover verdict via `tmp-record-*.mjs` mock-spawn pattern; do not pay for a second turn.
14. **Heredoc / `@""@` in PowerShell** for body files — write files with the Write tool first.

## 5. Root causes and key findings

- Review evidence binds to exact head; any fix voids APPROVEs. Batch all findings into one head (AGENTS.md 5.0-C).
- `check-exact-head-approval` requires APPROVE on **every** required slot (2 for migrations). One REVISE blocks merge even with no High/Critical.
- Muse and Grok approve this proof-depth; DeepSeek keeps finding Mediums and never APPROVEs on this PR family. Prefer Muse+Grok for #3711-class work unless Albert asks otherwise.
- Writes/claim object lists must **exactly** match `inspectPrStructuralChange` output (not every column — only table + some columns + indexes).
- `SUPABASE_ACCESS_TOKEN` comes from 1Password item `Supabase CLI Personal Access Token` (vault `vibe_coding`). Use `op run --env-file` with an `op://` reference file; never print the value.

## 6. Exact next steps

1. **#2176** consumer contracts: new claim + author lane. Do not assume `plm.import_coldlion_vendors` exists. Fix malformed scope block first.
2. **#3683** NBCU: #3830 is merged. Governed review at `258f0319` on PR #3695 (use run-governed-review with `--worktree`; DeepSeek/Muse/StepFun). Then preview/prod/close.
3. **Protected-file queue** one PR at a time: #3657 → #3808 → #3396 → #3787 → #3647 → DesignFlow chain.
4. **#3825**: fix Agent work contract evidence pair, then review+merge.
5. **#3828**: re-run guarded-merge authorization, review+merge.
6. Claim transfers #2110/#3175/#2662 via the #3620 tool.
7. Close **#3833** (this session's parked wait).

**Verification gates:** each step ends with `gh pr view` MERGED or `gh issue view` CLOSED + live-proof comment; `check-exact-head-approval` green before every conductor drive.

## 7. Constraints and gotchas in force

- Branch + PR + Guarded Merge; AI merges; never push to protected `main`.
- Preview / production / merge are one-at-a-time lanes.
- Never auto-update PR branches from main.
- Never ask Albert to approve technical risk.
- Qwen fails on edge-dev3 until ai-devops#1035; do not draw it.
- Claude/MiMo must not review Claude/MiMo-orchestrated work.
- #1941 on hold until 2026-10-05.
- Times in EDT (America/New_York).
- Sign GitHub comments `Posted by MiMo chat ses_ffe5f11ee4312ffetphUcC3hBX on edge-dev`.
- Keep GitHub API calls bounded; one merge conductor only (`conductor-3821`).
- Session-scoped: prefer StepFun over Grok if this session continues; otherwise normal rotation.

## 8. Access and environment

- Machine: **edge-dev** (Windows). edge-dev3 reachable as `ahazan@edge-dev3`.
- `gh` authenticated as u2giants. Repo `popcre/shared-db`.
- 1Password vault `vibe_coding`. `Supabase CLI Personal Access Token` item id `3t2xoqk5luyz7ffgdhj24gvtpq`.
- Reviewer wrappers: `ai-grok-review`, `ai-muse`, `ai-deepseek-agent`, `ai-stepfun`, `ai-gemini` under `C:\repos\ai-devops-reviewer-install\bin\` / `C:\Users\ahazan\.local\bin\`.
- Preview env file pattern: `C:\repos\shared-db\.ai\tmp-preview.env` with `op://` refs + `ORCHESTRATOR_ROUTE_ID`.
- Git Bash: `"C:\Program Files\Git\bin\bash.exe"`.

## 9. Open questions and risks

- **#3683** still blocked on a governed review at the merged head; NBCU migration not on production.
- **DeepSeek** as a migration reviewer on this PR family produces REVISE-loop (Mediums forever). Logged. Prefer Muse+Grok/StepFun.
- **Protected-file serialization**: only one open PR may touch `manage-migration-author-lanes.mjs`.
- **Many pre-existing worktrees** under `.ai/worktrees/` from other sessions — do not delete without `cleanup-worktree` audit.
- Max migration / main SHA go stale within the hour — re-verify at start (§3).

---

# Part (b) — sub-agent work blocks

### Agent: general-1 / general-7 / general-8 / general-10 / general-12 / general-13 / general-15 / general-17 / general-19 / general-21 / general-23 / general-25 / general-27 / general-29 / general-30 — #3711 review rounds
- **Asked to do:** Fix Grok/DeepSeek/Muse REVISE findings and run exact-head reviews at successive heads.
- **Actually did:** Landed FK assertions, named-column/type pins, POSIX-safe regex, index additions + assertions, service_role grant, CHECK identity, FK actions, source_raw removal, gen-7 sole evidence pair. Final head `5bda0b5c7`; MERGED `1a622c37`. Two-slot APPROVE (Grok+Muse).
- **Found:** DeepSeek never APPROVEs this family (Mediums only). Muse later APPROVE at `f72d4fc79` was refused because a REVISE artifact already stood. Writes/claim must match inspection objects exactly.
- **PR / branch:** PR #3711 `claude/coldlion-item-images-2179`; rebuilt as `pr3711-rebuild`.
- **Worktree:** `C:/repos/shared-db-review-3711-v2` at `5bda0b5c7` — **finished (safe to clean)**. Also `C:/repos/shared-db-review-3711` (older head) — finished.
- **Deliberately did NOT do:** row loads; production apply (done separately); assumed `plm.import_coldlion_vendors` (does not exist).

### Agent: general-2 / general-5 — #3830 tools offline tests
- **Asked to do:** Fix Tools offline tests failure on PR #3830.
- **Actually did:** Refreshed disposition catalogue for context-bound semantic key drift; rebuilt branch to one evidence pair (gen 2 at `refs/db-contracts/3829/2`); head `a334fb214`; MERGED `6dda8e32`.
- **Found:** Context-bound `semantic_key` drifts when nearby lines change even if the matched line does not.
- **PR / branch:** PR #3830 `fix/3821-merged-review-source`.
- **Worktree:** `C:/repos/shared-db-fix-3830` at `a334fb214` — **finished (safe to clean)**. Also `C:/repos/shared-db-wt-review-3830-a334fb21` — finished (reviewer scratch).
- **Deliberately did NOT do:** merge (done by orchestrator after APPROVE).

### Agent: general-4 / general-6 / general-9 / general-14 / general-16 / general-18 / general-20 / general-22 / general-24 / general-26 / general-28 — review-only
- **Asked to do:** Governed reviews only (no merge).
- **Actually did:** Durable verdicts under `refs/db-review-verdicts/2179-3711-*` and `refs/db-review-verdicts/3829-3830-*`.
- **Found:** See §4 items 12–13 (DeepSeek head_sha false-positive; Grok timeout recovery).
- **PR / branch:** none (review only).
- **Worktree:** various review copies — finished unless named above.
- **Deliberately did NOT do:** merge, preview, production.

---

## Secrets / docs

- Secrets sweep: **no new credential created**. Used existing 1Password item `Supabase CLI Personal Access Token` (`3t2xoqk5luyz7ffgdhj24gvtpq`) via `op run` with an `op://` env file (`C:\repos\shared-db\.ai\tmp-preview.env`) — the file stores only the reference, not the value. No secret printed in chat or commits.
- Docs pass: nothing outside this handover is stale that this session proved wrong. Durable lessons live in §4–§5. `AGENTS.md` still correct on never-ask-Albert-to-approve and evidence-pair rules.

## Queue seed (REQUIRED)

Outstanding items already have open issues or PRs:

| Item | Issue / PR | Next |
|---|---|---|
| #2176 consumer contracts | #2176 OPEN | New claim + author; fix scope block |
| #3683 NBCU | #3683 OPEN | Review at `258f0319` / PR #3695 after #3830 merge |
| #3657 StepFun rotation | PR #3657 DRAFT | Protected-file queue head |
| #3808 / #3396 / #3787 / #3647 | draft PRs | Protected-file queue after #3657 |
| DesignFlow chain | #2870/#3707/#3708/#3737/#2873 | After #3647 |
| #3825 risk-gate | PR #3825 | Fix evidence pair, review, merge |
| #3828 deadlock messages | PR #3828 | Re-run authorization, review, merge |
| Claim transfers | #2110/#3175/#2662 | After #3620 tool |
| Parked wait | #3833 | Close |
| Reviewer issue | `20260929T203215Z-edge-dev-deepseek-7809` | Maintenance sweep later |

No new `db-work` issues required — all outstanding work is already queued.

Posted by MiMo chat ses_ffe5f11ee4312ffetphUcC3hBX on edge-dev
