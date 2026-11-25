---
summary: "Make the worker's SeaDrive installer copy robust to database hiccups: no repeated big uploads after a failed save, no downgrading a good entry when settings can't be read, every save failure logged with versions, and tests that pin it."
kind: plan
status: open
read-when: "implementing #1166 (SeaDrive mirror save-failure findings from PR #1162 / #1100)"
---

# Issue #1166 — The SeaDrive download link survives database hiccups without re-uploading

Covers [u2giants/popdam3#1166](https://github.com/u2giants/popdam3/issues/1166) (advisory review of PR #1162, the fix for #1100). Handoff:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Reads that fail are not "nothing stored" | ⬜ open | |
| 2. Skip re-upload when the copy already exists | ⬜ open | |
| 3. One save helper catches thrown and returned errors | ⬜ open | |
| 4. Tests incl. log assertions | ⬜ open | |
| 5. Deploy + live proof | ⬜ open | |

**Fresh session starts at step 1.** Findings verified on main 787c20b8 (2026-11-25).

## 1. Ultimate goal

The PopDAM Downloads page offers designers the SeaDrive installer from POP's own storage copy, kept current weekly by the cloud worker. A short database or network problem must not (a) make the worker re-download and re-upload a several-hundred-MB installer every hour, (b) replace a good "use our copy" entry with the official links, or (c) fail without a log that says which version is still offered. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`). The **cloud worker** (`apps/worker/`, Railway, auto-deploys from main changes under `apps/worker/**`) runs maintenance in `operation-loop.ts:811` → `maybeMirrorSeaDrive()` in `apps/worker/src/handlers/seadrive-mirror.ts`. It scrapes the Seafile download page, streams the macOS `.pkg` and Windows `.msi` into DigitalOcean Spaces (`SPACES_PREFIX/seadrive-<version>.<ext>`), and records `{version, mac_url, win_url, source, mirrored, checked_at}` in `admin_config` key `SEADRIVE_LATEST`, which `src/pages/DownloadsPage.tsx` reads. Note: SeaDrive is *not* the Helper's sync client (settled design, `docs/SEAFILE_INTEGRATION.md`); it is only offered as a download.

## 3. What triggered this work

Review of PR #1162 (deepseek) and review-fixer verification:
1. **Hourly re-upload loop.** `runMirror` (`seadrive-mirror.ts:202-277`) treats "already current" only when the stored row says `mirrored`. A failed save leaves the old row, so every cooldown (`RETRY_COOLDOWN_MS` = 1 h, line 29) re-runs `mirrorInstallers` — a full download+upload — then fails the save again.
2. **Unreadable settings downgrade.** `readConfig` (`:48-53`) ignores the query error and returns `{}`. Then `existing` is undefined and `loadSpacesCfg` returns null, so the worker "records official URLs only" (`:256`) — overwriting a good mirrored entry with unmirrored links if the write then succeeds.
3. **Thrown save errors.** `recordLatest` (`:174-191`) only handles a returned `{ error }`; a thrown/rejected upsert reaches the generic catch (`:271-276`) and logs "unexpected error" without attempted/published versions.
4. The `checked_at` bump (`:225-236`) has its own error handling, not the same helper, and does not catch throws.
5. Tests (`seadrive-mirror.test.ts`) mock the builder as a Promise; no case for success with `data: null`, a thrown upsert, `existing === null`, or log contents.

## 4. Scope

In: `seadrive-mirror.ts` and its test. **NOT in this plan:** the Downloads page UI, the weekly cadence, Spaces credentials, any DB change, the Helper.

## 5. Current state of the code (main @ 787c20b8)

Constants: `STORE_KEY` 21, `CHECK_INTERVAL_MS` 23 (weekly), `RETRY_COOLDOWN_MS` 29. `readConfig` 48-53, `loadSpacesCfg` 55-67, `mirrorOne` 91-120 (unconditional `PutObjectCommand`), `mirrorInstallers` ~130-152, `recordLatest` 174-191, `maybeMirrorSeaDrive` 193-199, `runMirror` 201-277. Test runner: `apps/worker` `npm test` (tsx --test).

## 6. Key findings and root cause

Two places convert "could not read/write" into "nothing there": `readConfig` swallowing errors, and the mirrored-check relying on a row that a failed save never wrote. Both make a transient failure look like new work.

## 7. Approaches considered and rejected

- **Lengthen the cooldown** — rejected: hides the loop; also rule: no hold over 30 minutes is added (existing 1 h cooldown is pre-existing; do not lengthen).
- **Cache "mirrored" in worker memory only** — rejected as sole fix: lost on restart. Instead check Spaces itself (HEAD object), which is the real truth.
- **Retry the save in a loop** — rejected: one attempt per run plus the existing cooldown is enough once re-upload is skipped.

## 8. Design decisions

Locked (2026-11-25):
- `readConfig` throws on a query error; `runMirror` catches it, logs `seadrive-mirror: settings unreadable; skipping run` and returns without writing.
- Before uploading, `mirrorOne` sends `HeadObjectCommand` for the target key; if it exists with a matching `ContentLength`, it skips the upload and returns the URL (log `already mirrored`).
- One `saveLatest(upsert, value, existing, now, reason)` helper wraps the upsert in try/catch, handles returned errors, logs `{ attempted_version, published_version, published_mirrored, reason, error }`, returns boolean. Both the record path and the `checked_at` bump use it.
- Never write an unmirrored entry over an existing mirrored entry of the **same** version.
Open: none.

## 9. The plan

**Step 1 — Read errors (lead-only: changes what gets published).** `readConfig`: `const { data, error } = …; if (error) throw new Error(\`admin_config read failed: ${error.message}\`)`. In `runMirror`, wrap the initial read in its own try/catch per §8. Verify: test `settings read failure writes nothing`.

**Step 2 — Skip existing copies (helper-ok).** In `mirrorOne`, before `fetch`, `HeadObjectCommand({ Bucket, Key })`; on success with `ContentLength > 0` return the public URL without fetching. On 404 continue; on other errors continue (upload). Import `HeadObjectCommand` from `@aws-sdk/client-s3` (already a dependency). Make it testable by extracting a small `objectExists(s3, cfg, key)` that the test can stub through the existing uploader injection in `mirrorInstallers`. Stop-and-ask: if the injection shape must change in a way that affects `runMirror` beyond one argument. Verify: test `existing object is not re-uploaded`.

**Step 3 — Single save helper (helper-ok).** Replace `recordLatest` with `saveLatest` per §8 (keep `recordLatest` name exported as an alias if other code imports it — `grep -rn recordLatest apps/worker/src`). Use it in the bump path (`:225-236`) with `reason: "checked_at"` and in the record path with `reason: "record"`. Add the same-version downgrade guard before the record save. Verify: tests.

**Step 4 — Tests (helper-ok).** In `apps/worker/src/handlers/seadrive-mirror.test.ts` add, capturing `logger.error` with `mock.method(logger, "error")` (node:test):
- `saveLatest returns true for a real-shaped success { data: null, error: null }`
- `saveLatest returns false and logs versions when the upsert throws`
- `saveLatest logs published_version null when nothing was published`
- `saveLatest logs attempted and published versions on a returned error`
- `settings read failure writes nothing` (export a `runMirrorWith(deps)` seam or test `readConfig` throwing)
- `existing object is not re-uploaded`
- `unmirrored result does not replace a mirrored entry of the same version`
Stop-and-ask: if testing `runMirror` needs network — then add a deps seam (`fetchPage`, `db`, `s3`) and bring the seam design back first. Verify: `cd apps/worker && npm test` green; `npx tsc -p apps/worker --noEmit` clean.

**Step 5 — Deploy + live proof (lead-only).** Merge → Railway worker redeploys (check deployed commit via Railway MCP `list-deployments` or worker heartbeat sha in `worker_heartbeats`/Settings). Live proof: worker logs show the weekly run either `throttled` or `already mirrored` (no `uploaded` line for an unchanged version) — Railway MCP `get-logs` filtered on `seadrive-mirror`; `select value from admin_config where key='SEADRIVE_LATEST'` still `mirrored: true`; Downloads page SeaDrive links resolve to the Spaces URLs (HTTP 200 HEAD). Post with EST times on #1166, close.

## 10. Tests required

Seven named cases above, existing six cases in `seadrive-mirror.test.ts`, full `apps/worker` `npm test`, `tsc`.

## 11. Constraints, standing rules, gotchas

No new hold longer than 30 minutes; do not change `RETRY_COOLDOWN_MS` or `CHECK_INTERVAL_MS`. `maybeMirrorSeaDrive` must never throw into the operation loop. Do not log secrets (Spaces key/secret come from `admin_config`). Branch + PR; AI merges; reviews advisory. No DB change. Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

`gh` as `u2giants`. Local: `cd apps/worker && npm ci && npm test` (script sets dummy `SUPABASE_URL`/key). Railway access: Railway MCP (token in 1Password `vibe_coding`, Railway item). Production SQL read: Supabase MCP / `SUPABASE_ACCESS_TOKEN` from the same vault. Never print values.

## 13. Definition of done, risks, open questions

Done: steps 1-4 merged, CI green, Railway on the merge SHA, live log/row/URL evidence posted, #1166 closed, STATUS updated. Risk: HEAD permission missing on the Spaces key → falls back to upload (today's behaviour). Rollback: revert PR. Open: none.

## Self-audit

1. Executable without questions? Yes — §8 fixes behaviour, §9 lines/tests, §12 commands.
2. Background carried? Yes — §3 five findings incl. the downgrade path found while planning; §7 rejections.
3. Goal clear? Yes — no repeated big uploads, no downgrade, honest logs.

## Lead launch prompt

```
Read docs/plans/issue-1166-seadrive-mirror-save-failures.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 1 and 5. Hand steps 2, 3, 4 to your helper after step 1.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring back the step's stop-and-ask trigger; taken back after 30 minutes stuck.
You verify yourself: worker tests and tsc, Railway deploy SHA, logs, the SEADRIVE_LATEST row, Downloads links.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
