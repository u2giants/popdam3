---
issue: 3532
status: OPEN
owner: mimo/non-orchestrator-wrapup-20260925
---

# Non-orchestrator sweep — wrap-up handoff (2026-09-27 ~8:00 PM EST)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking (work cannot proceed without Albert)

1. **Merge queue (#2530).** Every parallel PR races on `main` tip. Content-preserving refresh (`isContentPreservingRefresh`) keeps APPROVE when the author diff is unchanged, but any real content fix voids the head and forces a re-review. Native GitHub merge queue is the structural fix. Albert has not said yes yet.
2. **#2290 — authorize ColdLion health-lane deployment** (or say no and close). Blocks ColdLion sync closeout.
3. **#2541 — confirm the authorized ColdLion property-code set is the 33 unique codes** in `docs/coldlion-unmatched-properties-by-licensor-20260731.md` (not the stale "66"), and whether Laura/Ilona **#1941 is a hard gate**. Recommendation: confirm 33; treat #1941 as NOT a hard gate.

### Scheduling (recoverable, but wasteful to guess)

4. **#2701 — production deploy of popdam3 `444f960`** + live Property Matches proof for Ilona Kereki and Laura Arevalo. Recommendation: schedule the `workflow_dispatch` deploy (`launch-data-designflow-app`).

### Hand-offs (nobody is on them)

5. **#3218** — DesignFlow production missing `hts_rag` schema. Hand to the DesignFlow production session.
6. **#3351** — ColdLion technical must answer `/proddetails` row identity. Albert chases ColdLion tech.
7. **#2600** — Licensing Master Data 3.5 preview/performance proof. Curated Master Data route; blocked on #2336.
8. **Required-check mirror drift** (12 vs 4 contexts). Open a small refresh ticket.

### Already settled — do NOT re-ask

- Five contested property attributions ruled live (#539, 2026-08-18).
- No `HANDOFF.d/` file-count cap (2026-08-13).
- Technical production approvals go to an independent reviewer (2026-09-16).
- #3505 is owned by session `shared-db.orch` — do not touch.
- AGENTS.md conflict resolution on PR #3352 was authorized by Albert (this session) and is DONE.

---

## 1. What this application is

`popcre/shared-db` — shared Supabase database repo for POP Creations. Every app reads/writes the same tables. This repo holds migrations, guarded merge/review tooling (`scripts/manage-migration-author-lanes.mjs` and friends), CI workflows, and the cross-app rulebook (`AGENTS.md` → `docs/agents/`).

Non-orchestrator = repo-maintenance, reviewer-tooling, docs, CI, source-data loaders — **not** database structure. Machine `edge-dev`, Windows. Shared checkout `C:\repos\shared-db` is landing-only — use worktrees.

## 2. What we set out to do

Finish remaining open non-orchestrator issues from the 2026-09-25 sweep (handoff PR #3534): check general-27's #3248 outcome; authorize and land the #3352 AGENTS.md conflict; fix #3445's five findings and #3369's token-permission gap; re-review and merge both. Verify `gh issue list --label non-orchestrator --state open` shrinks to claims/programs/external only.

## 3. Current state — what is true right now

**Checked 2026-09-27 ~8:00 PM EST.** `origin/main` = `d68be25cb86cb0546dc2b58602953d148c44faef`.

### Landed this session (2 PRs)

| PR | Issue | Reviewer | Merge commit | Time |
|---|---|---|---|---|
| #3352 | #3002 | muse-spark-1.3-contributor | `95c5db5e9` | 2026-09-25 3:47 PM EST |
| #3248 | #3262 | gemini-3.8-flash-high (APPROVE held via content-preserving refresh) | `999e56744` | 2026-09-25 6:45 PM EST |

Also: **#2678 closed** earlier. **#3002 and #3262 closed**.

### Open PRs this session owns — UNFINISHED (fix agents cancelled mid-round)

**#3445 / issue #3380** — head `b0732232c091c51e67db81d497b9d058a47eb66f`, branch `codex/immutable-generations-3380`, worktree `C:\repos\shared-db-3380-immutable-generations`.
DeepSeek REVISE at `b0732232` (durable `refs/db-review-verdicts/3380-3445-b0732232…`). Findings on record (NOT yet fixed):
1. Medium — `scripts/agent-work-contract-git-evidence.mjs:114-119` flattens `git fetch` failure into `missing predecessor contract`, conflating transport vs absence. Same at `:76` for the PR's own ref.
2. Medium — head under review has no executed-test evidence (100-passed claims belong to implementation `14c247148`, one commit below the rebind head). Run tests at the new head and record exact contract-required commands in `completion.json` `checks[]`.
3. Minor — v1 pair↔generation binding never enforced (`evidence-generation-lineage.mjs:177-179`) though docs claim it.
4. Minor — `isRealEvidenceRecord` / `classifyAgentPaths` are path-shape-only.
5. Gap — gen-8 contract `allowed_paths` still lists retired gen-7 pair files → needs generation 9 successor.
6. Gap — gate never ties `report.contract_sha256` to the checked-in contract.
7. Unverified without shell — `files_changed` exact match and exactly-one-pair net-diff at `b0732232`.
Prior gemini APPROVE at `6ca778a2` is void. Five original findings (contract scope, head_sha topology, files_changed, planSuccessor regex, readPublishedContract) ARE fixed in the current head.

**#3369 / issue #3361** — head `ea332508b981627d5c1110dcfdd9ac5be39d407d`, branch `codex/workflow-refactor-required-authority`, worktree `C:\repos\shared-db\.ai\worktrees\fix-3369-d-mimo`.
Grok REVISE at `ea332508` (durable `refs/db-review-verdicts/3361-3369-ea332508…`). Findings (NOT yet fixed):
1. **P1 — chicken-and-egg:** `AUTHORITY_TOKEN: ${{ secrets.SYNC_TOKEN }}` exists only in this PR's YAML, but `workflow_dispatch` runs main's YAML which still passes only `github.token`. Live run 36186790619 proved `github.token` cannot read GraphQL `branchProtectionRule` / REST `/rules/branches` ("Resource not accessible by integration"). The PR removed the committed-mirror fallback, so dispatching this head as-is reproduces the 403.
   Fix direction: bootstrap fallback when `AUTHORITY_TOKEN` is unset (loud warning, still fail-closed if mirror is stale) so the PR can merge under main's YAML; the NEXT merge then runs this YAML from main and uses `AUTHORITY_TOKEN`. Or a YAML-only predecessor PR.
2. P2 — gen-4 contract still records the false `contents:read` claim at `.agent/work/3361/4/contract.json:60`. Needs generation 5.
3. P2 — `tokenScopedRead` env-swap untested (no test asserts which token `gh` sees per endpoint).
4. P2 — `probeAuthorityReadPermissions` can succeed on unauthorized GraphQL null; require non-null `branchProtectionRule`.
LIVE PROOF on issue #3361: `github.token` has no `administration` permission. `secrets.SYNC_TOKEN` (classic PAT, `repo` scope) is the intended authority token. Admin `gh` (u2giants) CAN read the five required checks via GraphQL.

### Claims (leave alone — live author leases)

3502 (→#3510), 3486 (→#3490), 3483 (→#3487), 3482 (→#3489), 3378 (→#3391), 3307 (→#3309), 3294 (→#3304), 2834 (→#2835), 2745 (→#3385). Also: 3546 (→#3539), 2357 (→#2835 area).

### Programs / markers / parked

1403 (Switch 2 gated), 2326 (handover), 2530 (merge queue — **Albert decision**), 3084 (alarm), 3306 (workflow-refactor parent), 3401 (handover), 3505 (**other session**), 3508 (parked), 3552 (orchestrator marker — **other session**), 3536/3538 (CI audit), 3541/3542 (parked).

### External

2290 (Albert), 2600 (curated MD), 2986 (sandbox), 3218 (DesignFlow prod), 3351 (ColdLion tech).

## 4. Everything we tried that did NOT work

1. **The `main`-moves race is real and constant.** Every content fix voids the exact-head APPROVE. Refresh + re-review + merge only works if `main` stays still for ~2 minutes. Several merges bounced with `pull request is not based on the current main tip`.
2. **`isContentPreservingRefresh` (content-preserving refresh) DOES work** when the author diff is unchanged and only the evidence pair rebinds. That is how #3248 landed. Use it: merge main, strip the pair from the implementation commit, rebind `completion.json` `head_sha`/`base_sha`, pair alone on top, push, dispatch merge. Do NOT re-review if the five prose files are byte-identical.
3. **Docs-only merge path does NOT apply to PRs with `.agent/work/**` evidence JSON** — `Documents-only merge authorization` says "code change; guarded code checks required".
4. **`workflow_dispatch` runs the workflow YAML from `main`, not the PR head.** Scripts are checked out from the PR, but step lists/permissions come from main. A permission fix in the PR YAML cannot help until it lands.
5. **GITHUB_TOKEN has no `administration` permission** (adding it makes workflows unparseable). GraphQL `branchProtectionRule` and REST `/rules/branches` need a classic PAT (`repo` scope) or GitHub App. The old claim that `contents:read` suffices is FALSE — live run 36186790619.
6. **`--assign-reviewer` can block 5+ minutes** on the author-acquisition mutex. Retry with a long timeout; empty output usually means the process was killed, not success.
7. **A completed review's second run returns `REFUSED: no held reviewer lease`** — the lease is single-use. If you see that, check `git ls-remote origin 'refs/db-review-verdict*<issue>-<pr>-<head>*'` — the verdict is often already recorded.
8. **Muse `start_failed: the wrapper refused before the provider turn started`** can mean "session name already exists" (preparation_failed). `ai-muse delete <name>` then retry.
9. **`gh pr update-branch` / merge-from-main voids exact-head APPROVE** unless the change is content-preserving. Always rebind `base_sha`/`head_sha` in `completion.json` after a main refresh.
10. **Evidence-pair topology is strict:** implementation commit (no evidence files) then exactly `contract.json` + `completion.json` alone on top. Interleaving breaks `verifyGitEvidence` permanently at that head. Superseding a generation means the old pair must leave the net diff.
11. **Published contract refs (`refs/db-contracts/<issue>/<gen>`) are immutable.** Wording fixes need a successor generation (`--publish-contract`), not an edit. `required_checks` commands must appear verbatim in `completion.json` `checks[]`.
12. **Throughput disposition identity is `semantic_key`**, not line numbers. Resolve catalogue conflicts by re-running `discover()` on the merged source.
13. **Wrapper args after `--`**: `new <session> --prompt-file <file>` for muse/gemini/grok; `send "<msg>" --review --file <file>` for ai-deepseek-agent. Set all `AI_*_CALLER=mimo`.
14. **Do not use `--admin` for prose merges** (admins are enforced). Do not dispatch `guarded-migration-merge` for a handoff-only PR.

## 5. Root causes and key findings

- **CI-authority PRs attract deep review and deserve it.** A broken gate freezes every merge. Prove load-bearing assumptions with live evidence (the 36186790619 run is the proof for #3361).
- **The evidence-pair contract (#2845) is the main merge blocker** after any main refresh. Content-preserving refresh is the designed escape when the author diff is unchanged.
- **Parallel PRs without a merge queue will keep racing.** #2530 is the structural fix.
- **Documents-only merge authorization posts in ~30s.** Docs-only PRs (HANDOFF.d + docs/** only, no `.agent/`) merge with `gh pr merge --squash` after that check turns green.

## 6. Exact next steps

1. **#3445 / #3380** — fix the DeepSeek REVISE findings in §3 (transport vs absence, run tests at head and record, gen-9 successor for allowed_paths, contract_sha256 binding, v1 binding claim). Push, re-review, merge, close #3380.
2. **#3369 / #3361** — implement the P1 bootstrap (AUTHORITY_TOKEN when set; loud fail-closed mirror fallback when unset) or a YAML-only predecessor, plus the three P2s (gen-5 contract, token-swap test, probe null check). Push, re-review, merge, close #3361.
3. **Verify**: `gh issue list --label non-orchestrator --state open` shrinks to claims/programs/external only.
4. **Optional (Albert):** activate merge queue (#2530).

## 7. Constraints and gotchas in force

- **Worktree-only.** Never edit `C:\repos\shared-db` shared checkout.
- **Non-orchestrator only.** No migrations, no schema, no RLS, no production applies. Structural work goes to the orchestrator.
- **One independent review** for scripts/docs/CI. Never invent verdicts. Silence is never approval.
- **REVISE/REJECT stops the merge** — fix findings, push a new head, re-review. Content-preserving refresh is the only APPROVE-surviving refresh.
- **Do not touch** #3505 (other session), #3552 (other session's orchestrator marker), any `db-claim` issue's claim state, or structural PRs unless you are their author.
- **Sign every GitHub body**: `Posted by MiMo chat unknown on edge-dev`
- **Never weaken a guard or delete a check to go green.**

## 8. Access and environment

- `gh` authenticated as `u2giants`. Git remote `https://github.com/popcre/shared-db.git`.
- Machine `edge-dev`, Windows. Git bash at `C:\Program Files\Git\bin\bash.exe`.
- Reviewer pool (usable): Muse, Grok, Gemini, DeepSeek. Qwen quarantined. GLM/Kimi retired. StepFun Linux-only.
- Reviewer wrappers in `C:\repos\ai-devops\bin\` (`ai-muse`, `ai-grok-review`, `ai-gemini`, `ai-deepseek-agent`).
- Merge dispatch: `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<exact head>`
- `secrets.SYNC_TOKEN` is the classic PAT intended for authority reads (branch protection). Do not print it.
- No new 1Password entries created this session; no credentials appeared in chat.

## 9. Open questions and risks

- **2026-09-27:** Parallel sessions race on `main` constantly. Content-preserving refresh is the only cheap path; anything else needs a quiet `main` window.
- **Risk:** #3369's P1 is a real chicken-and-egg. Landing it as-is will bounce every merge until the YAML with `AUTHORITY_TOKEN` is on main. Fix the bootstrap first.
- **Risk:** #3445's DeepSeek findings are in the evidence-gate tooling every future PR depends on. Do not rush; a broken gate freezes everyone.

---

Posted by MiMo chat unknown on edge-dev
