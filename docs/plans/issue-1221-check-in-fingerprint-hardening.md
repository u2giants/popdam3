---
summary: Issue #1221 plan: stop the shared check-in fingerprint from silently hashing a file that changed mid-read, and guard the Helper's build and release filter against new shared imports. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1221, or editing packages/agent-common/src/quick-hash-v1.ts, the Helper's tsconfig.node.json include list, or publish-popdam-helper.yml paths
---

# Plan: Harden the shared check-in fingerprint (u2giants/popdam3#1221)

Issue: https://github.com/u2giants/popdam3/issues/1221
Handoff: [HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md](../../HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md)
Parent plans (cleanups 03, 09, 12 of #1200): [issue-1200-03-check-in-file-fingerprints.md](issue-1200-03-check-in-file-fingerprints.md), [issue-1200-09-check-in-retry-records.md](issue-1200-09-check-in-retry-records.md), [issue-1200-12-pdf-sampling-on-both-agents.md](issue-1200-12-pdf-sampling-on-both-agents.md).
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | `quickHashV1` fails closed on a short read or a file that changed while hashing (review F5) | ⬜ open | `packages/agent-common/src/quick-hash-v1.ts:7-30` on `origin/main` `787c20b8` |
| 3 | Confirm every caller retries on that error | ⬜ open | callers in §5 |
| 4 | Contract test: Helper's shared imports are in its tsconfig include and release filter (review F3) | ⬜ open | |
| 5 | Bridge version bump, PR, merge, publish | ⬜ open | |
| 6 | Live proof, close #1221 | ⬜ open | |

Already resolved on `main` (verified 2026-11-25; do **not** redo): review F1 — Windows progress keeps its old wording (`apps/windows-agent/src/pdf-text-sampler.ts:308-314` uses only `extraction_error`), pinned by `src/test/check-in-and-sampling-contracts.test.ts:70` (`["windows", undefined]`); F2 — fixed V1 fingerprint fixtures at 0 / 65 535 / 65 536 / 65 537 / 131 072 / 131 073 bytes (`:11-30`), upload destination/redrive cases (`:32-68`), PDF batch ordering/25-row truncation/final-submit error on both agents (`:70-123`), landed in commit `b7dcbfbf`; F4 — the bridge lockfile/version jump was benign and already shipped (bridge now `1.17.3`).

**Where a fresh session starts:** Step 1.

## 1. The ultimate goal

When a designer checks a file back in through the desktop Helper, PopDAM records a short "fingerprint" of the file (first 64 KiB + last 64 KiB + size). The NAS bridge agent later re-computes that fingerprint on the copy that synced to the NAS, and only unlocks the file when they match. The same fingerprint also drives move detection during NAS scans. Today, if a file shrinks or is rewritten while it is being read, the code silently hashes zero-filled or mixed bytes and reports a fingerprint for a file that never existed. When this plan is done, a file that changes mid-read produces an error (and the caller tries again later) instead of a wrong fingerprint, and the Helper cannot silently ship without a shared file it depends on.

The fingerprint value for any stable file must not change by a single bit — it is a stored format on existing check-in receipts and assets. **If a step conflicts with this goal, the goal wins — stop and flag it.** If the fixture test in §10 changes value, stop: you changed the format.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager (https://dam.designflow.app), repo `u2giants/popdam3`, branch `main`. Pieces involved: the Electron desktop Helper (`apps/popdam-helper/`, released as GitHub Releases by `.github/workflows/publish-popdam-helper.yml`), the Synology NAS bridge agent (`apps/bridge-agent/`, ESM, Docker image `ghcr.io/u2giants/popdam-bridge:stable` via `publish-bridge-agent.yml`, applied on the NAS only on request), and shared agent code in `packages/agent-common/src/` (copied into each agent's gitignored `src/common/` by `sync.mjs`; the Helper imports `quick-hash-v1.ts` directly by relative path). Read `AGENTS.md` first.

## 3. What triggered this work

The advisory reviewer (DeepSeek via OpenRouter) reviewed merged PR #1218 ("Share check-in and PDF sampling pieces (#1200 items 03, 09, 12)", head `df6ded92`) and opened #1221 with five findings (text truncated after F5 by the review tool; the truncated tail is not recoverable). F1, F2 and F4 are resolved (STATUS). Open:
- **F3:** the Helper's `tsconfig.node.json` now has `rootDir: "../.."` and includes `../../packages/agent-common/src/quick-hash-v1.ts`, and the release filter lists only that one file; a future shared import would build against a file the release filter ignores, and nothing guards it.
- **F5:** `quickHashV1` does `stat` before `open` and ignores short reads; a file that shrinks between them hashes partial or zero-filled samples. Pre-existing (the old copies had it), now in one shared place.

The fixer bot deferred: "The source owner needs a corrective PR for the missing tests" — those tests have since landed (F2 above).

## 4. Scope

**In:** `packages/agent-common/src/quick-hash-v1.ts`; one new contract test; the bridge `package.json` version bump (the shipped bridge image changes); caller verification.

**NOT in this plan:**
- Changing the fingerprint format or version (`quick_hash_version` stays 1).
- `computeContentSha256` or the Helper's `sha256File` (stream to end; no short-read issue).
- Broadening the Helper release filter to all of `packages/agent-common/src/**` (rejected, §7).
- Windows-agent changes (it does not use `quickHashV1`).

## 5. Current state of the code (verified 2026-11-25 on `origin/main` `787c20b8`)

- `packages/agent-common/src/quick-hash-v1.ts:7-30`: `const { size } = await stat(filePath)`; `open(filePath, "r")`; reads `min(65536,size)` at 0 and, if `size > 65536`, `min(65536,size)` at `max(0,size-65536)`; ignores each `fh.read` result's `bytesRead`; appends size as little-endian u64.
- Callers:
  - Helper `apps/popdam-helper/src/main/hash.ts:15` `quickHashFile` → `apps/popdam-helper/src/main/uploadQueue.ts:189` (hashes the Helper's own retained snapshot; any throw is caught at `:216` and counted as an upload retry up to `UPLOAD_MAX_RETRIES`).
  - Bridge `apps/bridge-agent/src/hasher.ts:23` `computeQuickHash` →
    - `apps/bridge-agent/src/checkin-verifier.ts:130` (inside the per-item `try`; the `catch` at `:155-167` logs and reports `outcome: "not_ready"`, so the next pass retries);
    - `checkin-verifier.ts:212` (wrapped in its own `try { } catch { /* unreadable — fall through to foreign */ }` — **a throw here leads to "foreign", not a retry**; Step 3 must decide this one);
    - `apps/bridge-agent/src/index.ts:1236` (scan file processing; inside a `try` starting `:1234` — Step 3 confirms where its `catch` lands and that the file is retried on the next scan rather than recorded).
- Helper build: `apps/popdam-helper/tsconfig.node.json:12` `"rootDir": "../.."`, `:20` include list ends with `"../../packages/agent-common/src/quick-hash-v1.ts"`. Release filter: `.github/workflows/publish-popdam-helper.yml:8` lists `packages/agent-common/src/quick-hash-v1.ts`. `quick-hash-v1.ts` imports only `node:crypto` and `node:fs/promises`.
- Fixture test: `src/test/check-in-and-sampling-contracts.test.ts:11-30` pins six digests through Helper `quickHashFile` and shared `quickHashV1`.

## 6. Key findings

1. Opening first and taking `fh.stat()` on the open handle removes the stat→open gap; checking `bytesRead` on each read and re-checking `fh.stat()` size and `mtimeMs` after the reads catches a file truncated or rewritten during hashing. For an unchanged file every byte hashed is identical, so the digest is identical (the fixture test proves it).
2. The new failure must reach each caller as "try again", never as a stored value. Three of four call sites already do that. `checkin-verifier.ts:212` treats any error as "unreadable → foreign file", which for a file still being written by sync could wrongly mark a check-in foreign. That is a decision for Step 3 with the criterion below.
3. The Helper's only shared import is `quick-hash-v1.ts`, which has no relative imports. A contract test reading the Helper sources, its tsconfig include list and the workflow `paths:` is enough to guard F3 without widening releases.

## 7. Approaches considered and rejected

- **Leave the race (pre-existing).** Rejected: the fingerprint is the only integrity check on check-in; a silent wrong value can unlock a bad file or mismatch a good one.
- **Retry inside `quickHashV1`.** Rejected: callers already have retry loops with their own cadence; a hidden inner retry hides the condition from logs.
- **Widen the Helper release filter to `packages/agent-common/src/**`.** Rejected: every bridge/Windows-only shared edit would cut a Helper release.
- **Publish `agent-common` as an npm package for the Helper.** Rejected: packaging change far beyond this finding (cleanup 03 chose the relative import deliberately).

## 8. Design decisions

- **LOCKED (2026-11-19, cleanup 03):** V1 fingerprint format and digest values unchanged.
- **LOCKED (2026-11-25):** on a short read, or if `fh.stat()` size/`mtimeMs` after reading differs from before, throw `Error("File changed while computing quick hash: <path>")`. No inner retry.
- **OPEN (Step 3, `checkin-verifier.ts:212`):** criterion — a "changed while hashing" error must not produce a "foreign" verdict; it should report `not_ready` like the main path. If changing that branch needs more than a few lines or touches the foreign/late-landing rules, stop and flag on #1221 instead.

## 9. The plan

**Step 1 — Worktree/branch.** `git worktree add <path> -b claude/1221-fingerprint-hardening origin/main`; `npm ci`; `npm ci --prefix apps/bridge-agent`. Gate: `npx vitest run src/test/check-in-and-sampling-contracts.test.ts` and `npm test --prefix apps/bridge-agent` green before edits. `helper-ok`. Stop-and-ask: anything fails before edits.

**Step 2 — Fail closed in `quickHashV1`.** Rewrite `quick-hash-v1.ts` per §8: `open` first; `const before = await fh.stat()`; use `before.size`; for each read check `bytesRead === buffer.length`; `const after = await fh.stat()`; if any short read or `after.size !== before.size || after.mtimeMs !== before.mtimeMs`, throw. Keep the exact byte selection and size suffix. Gate: the six fixture digests in `check-in-and-sampling-contracts.test.ts:11-30` unchanged; new tests in §10 pass. `lead-only` — stored-format and integrity logic.

**Step 3 — Callers.** Read each caller in §5. Confirm (and record in the PR) that the Helper and the main verifier path retry. For `index.ts:1236`, find the `catch` of the `try` at `:1234` and confirm a thrown hash error leaves the asset unrecorded for this scan (retried next scan). For `checkin-verifier.ts:212`, apply §8 OPEN: if the error message matches "changed while computing quick hash", report `not_ready` and `return` before the foreign branch; add a test in the existing verifier test file if one exists (`grep -l checkin-verifier apps/bridge-agent/src/*.test.ts`), else add `apps/bridge-agent/src/checkin-verifier-hash-race.test.ts` and append it to the bridge `test` list. Gate: written caller table in the PR; bridge tests green. `lead-only` — production outcome decisions.

**Step 4 — Helper import contract test.** Add `src/test/helper-shared-imports.test.ts` (root Vitest): collect every import specifier in `apps/popdam-helper/src/**/*.ts` that resolves into `packages/agent-common/src/`; for each, assert the path is in `apps/popdam-helper/tsconfig.node.json` `include` and in `.github/workflows/publish-popdam-helper.yml` `on.push.paths`; and assert each such shared file has no relative imports (or that those are also listed). Gate: test passes now; adding a fake import line to `hash.ts` makes it fail (probe, not committed). `helper-ok` — fully specified. Stop-and-ask: parsing YAML needs a new dependency (use a line-based read of the `paths:` block instead; ask if that is not reliable).

**Step 5 — Version, PR, merge, publish.** Bump `apps/bridge-agent/package.json` patch version (and its lockfile's top `version` fields) in the same commit, because the bridge image's code changes. The Helper also changes (shared file is in its filter) — its workflow will publish a new Helper release on merge; bump `apps/popdam-helper/package.json` patch version if that workflow requires a new version per release (read the workflow). Verified identity; stage only named files; PR with attribution; wait; merge on required checks. Gate: `publish-bridge-agent.yml` and `publish-popdam-helper.yml` runs for the merge SHA green. `lead-only`.

**Step 6 — Live proof, close.** Ask the NAS bridge to update via the normal on-request path (`AGENT_UPDATE_REQUEST`, see `docs/deployment.md`), confirm the reported bridge version equals the bump, then do one real check-in through the Helper with the admin tester on a test asset and confirm the check-in reaches "verified" (the fingerprint path works end-to-end). Comment on #1221 with merge SHA, versions, and the verified check-in id, signed; close; update STATUS. If live proof cannot be done in this session, leave `- [ ] live proof` on #1221 and keep STATUS at "landed, not accepted". `lead-only`.

## 10. Tests required

| Test (file) | Behaviour |
|---|---|
| existing "keeps the stored V1 check-in fingerprint at %d bytes" (`src/test/check-in-and-sampling-contracts.test.ts`) | all six digests unchanged |
| new "throws when the file shrinks between open and read" (same file or `packages/agent-common/src/quick-hash-v1.test.ts`) | stub/mocked `FileHandle.read` returning `bytesRead` < requested → rejects with "changed while computing quick hash" |
| new "throws when size or mtime changes during hashing" | `fh.stat` stub returns different size second time → rejects |
| new verifier case (Step 3) | a "changed while hashing" error at the late-landing check reports `not_ready`, not foreign |
| new `src/test/helper-shared-imports.test.ts` | every Helper import into `packages/agent-common/src` is in the tsconfig include and the release filter |
| suites | root `npm test`, `npm test --prefix apps/bridge-agent`, Helper `npm test --prefix apps/popdam-helper` if it has one |

Adversarial cases (the input is a file on disk outside the repo):

| Input | Hostile case | Test |
|---|---|---|
| file being hashed | truncated after open | "throws when the file shrinks between open and read" |
| file being hashed | rewritten same size, new mtime | "throws when size or mtime changes during hashing" |
| file being hashed | empty / exactly 64 KiB / 128 KiB boundaries | existing fixture cases |
| file at check-in verification | still syncing when the late-landing check runs | new verifier case |

## 11. Constraints, standing rules, gotchas

- Fingerprint format is stored on receipts and assets — any digest change is a data incident.
- Bridge image changes need a `package.json` version bump in the same commit; the NAS applies only on request.
- Never edit an agent's generated `src/common/`.
- `agent-common` files are compiled as ESM in the bridge and loaded by Electron-vite in the Helper; use only `node:` builtins.
- Feature branch + PR; the AI merges; reviews advisory. Sign posts; EST times; secrets only via 1Password `vibe_coding`.

## 12. Access and environment

- `gh` as `u2giants`. Admin tester for a Helper check-in: 1Password vault `vibe_coding`, item named in `docs/1password.md`; Helper install and check-in flow: `docs/POPDAM_HELPER.md`.
- NAS bridge update and version check: Settings → Bridge Agent on https://dam.designflow.app (Agent Update), per `docs/deployment.md`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] `quickHashV1` fails closed; fixtures unchanged; new tests green; caller table recorded.
- [ ] Helper import contract test on `main`.
- [ ] PR merged; bridge and Helper publish runs green for the merge SHA.
- [ ] NAS on the new bridge version; one live check-in verified; #1221 closed with evidence (or `- [ ] live proof` left on it).

Risks and rollback:
- A busy NAS file that is constantly appended (e.g. a log) now fails to hash every scan. Acceptable — such a file was getting a meaningless fingerprint; watch scan error counts after rollout. Rollback: revert the PR and re-publish the previous bridge version.
- `mtimeMs` precision differs across SMB/NFS mounts; equality of two `fstat` calls on the same handle seconds apart is expected to hold. If live scans show false "changed" errors on unchanged files, drop the `mtimeMs` comparison and keep size + `bytesRead` (record on #1221).

Open questions: the §8 OPEN item only (engineering, criteria given).

## Self-audit

1. **Fresh session could execute without asking?** Yes — §5 lists the function and every caller with file:line and its current error handling, §8 locks the error rule, §9 gives each edit and gate, §10/adversarial table names every test, §12 the live path.
2. **All background carried, including what was ruled out?** Yes — STATUS records F1/F2/F4 as resolved with file:line and commit evidence, §3 notes the truncated review tail, §6 records the late-landing "foreign" trap, §7 lists four rejected approaches.
3. **Goal clear enough to steer by?** Yes — §1: never a wrong fingerprint, never a changed format; stop if fixtures move.

## Lead launch prompt

```
Read docs/plans/issue-1221-check-in-fingerprint-hardening.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 2, 3, 5 and 6 yourself. Hand Steps 1 and 4 to your helper. Your helper is your own
tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo
Flash for Mimo Pro. Never a full-strength model. Helper rules: return finished work or an evidenced blocker;
make no design decisions; never merge or post; bring back any stop-and-ask trigger; if stuck 30 minutes, the
lead takes the step back. Rules sheet:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Lead checks: fixture digests unchanged, all suites green, publish runs green, live check-in verified.
```
