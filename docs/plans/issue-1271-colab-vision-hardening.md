---
summary: "Issue 1271: Colab vision hardening - release the GPU on every exit, validate model IDs, fix proxy path checks."
kind: plan
status: open
read-when: "changing colab-direct routing, the Colab vision notebook, or the Colab GPU shutdown/refcount logic; fixing review finding 1271"
---

# Colab vision server hardening (issue #1271)

Issue: [#1271](https://github.com/u2giants/popdam3/issues/1271). This is the review of [PR #1270](https://github.com/u2giants/popdam3/pull/1270), merged 2026-11-22.
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Release the Colab consumer on every exit (try/finally) | ⬜ open | — |
| 2. Fail fast on malformed `colab-direct/` IDs | ⬜ open | — |
| 3. Base-URL guard: numeric IPv6 ranges and encoding tests | ⬜ open | — |
| 4. Notebook proxy: normalise, then check and forward the same path | ⬜ open | — |
| 5. Decide on and document unauthenticated `/health` | ⬜ open | — |
| 6. Land and live proof | ⬜ open | `- [ ] live proof` on #1271 |

A fresh session starts at step 1. Steps 1–3 are worker TypeScript; steps 4–5 are the notebook. The two groups are independent.

## 1. Ultimate goal

When PopDAM borrows a Google Colab GPU to tag images, the GPU is handed back as soon as nobody needs it, so paid Colab compute units are not burned by a job that already failed. The temporary public server running on that GPU exposes only what PopDAM needs (the model's `/v1/*` API) to authenticated callers. A typo in a Colab model name fails loudly instead of quietly being sent to OpenRouter.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork. The Railway cloud worker (`apps/worker/`, which auto-deploys on `main` changes under `apps/worker/**`) AI-tags images.

One model route is `colab-direct/<hf-model-id>`, for example `colab-direct/Qwen/Qwen3-VL-32B-Instruct`. It targets an ephemeral vLLM server that Albert starts in Google Colab from `scripts/colab/popdam_vision_server.ipynb`. The notebook exposes the server through a public `trycloudflare.com` tunnel and protects it with a Bearer key. The worker reads `admin_config.COLAB_VISION_CONFIG` (`{base_url, api_key, auto_shutdown}`) and, when a job ends, calls `POST /popdam/shutdown` to release the GPU. Docs: `docs/MODEL_RULES.md` (the Colab paragraph).

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), protected `main`; the AI merges the PR.

## 3. What triggered this work

The advisory reviewer on PR #1270 found five problems. The automatic fixer deferred, because the source PR was closed. Each finding was re-checked on `main` @ `787c20b8` (2026-11-25); the verdicts are in §6.

## 4. Scope

**In:** `apps/worker/src/colab-vision-api.ts`, the Colab consumer lifecycle in `apps/worker/src/handlers/ai-tagging.ts` and `apps/worker/src/handlers/ai-tag-bakeoff.ts`, the routing fall-through in `apps/worker/src/handlers/ai-tagging-shared.ts`, and `scripts/colab/popdam_vision_server.ipynb`.

**NOT in this plan:**
- DNS-rebinding protection (a public hostname that resolves to a private IP). The base URL is set only by an administrator in Settings, and the worker runs on Railway with no private network to the NAS. Record this as accepted residual risk.
- Changing the Colab idle timeout.
- Other providers' routing, which is the [routing plan](issue-1322-ai-provider-routing-hardening.md).
- The parallel-run flags, which is [#1363](issue-1363-parallel-untagged-only-guard.md).

## 5. Current state of the code

- `colab-vision-api.ts:37-41`: `isColabDirectModel()` requires the prefix plus `COLAB_MODEL_SHAPE`, which accepts one or two path segments. `:43-45`: `colabModelId()` just slices the prefix off, with no validation.
- `ai-tagging-shared.ts:608,659`: when `isColabDirectModel()` is false, the call goes on to the generic route. A malformed `colab-direct/a/b/c` is therefore sent to OpenRouter (or Straitly) instead of failing.
- `colab-vision-api.ts:61-85`: `isPrivateOrLoopbackHost()`. `:67`: the ULA and link-local test is the regex `/^f[cd][0-9a-f]{2}:/`. `:82`: it rejects integer and hex hosts.
- `colab-vision-api.ts:186-205`: `activeColabConsumers` is an in-process `Set`.
  - `markColabConsumerActive(id)` adds to it.
  - `releaseColabConsumerAndMaybeShutdown(id)` deletes from it, and shuts the server down only when the set is empty.
- `ai-tagging.ts` (around `:1200`): `if (usesColab) markColabConsumerActive(colabConsumerId)` runs **before** several early returns that never release:
  - the "Single-asset tag operation has no asset ID" return;
  - the bad explicit cursor return (`candidate_fetch`);
  - the `max_cursor` yield;
  - the decode and candidate-fetch failure returns further down.
  The release happens only on the success and done paths (around `:1249` and `:1325`).
- `ai-tag-bakeoff.ts:542`: mark. `:551,:624`: release on completion. `:560`: `if (assetErr) return …` without a release.
- Notebook `_forward()`:
  - `clean_path = urllib.parse.urlsplit(self.path).path.rstrip("/")`;
  - auth is skipped for `/health`;
  - the request is allowed when `clean_path.startswith("/v1/")`;
  - but it forwards `f"http://127.0.0.1:{VLLM_PORT}{self.path}"`, the **raw** path.

## 6. Key findings and root cause (verified 2026-11-25)

1. **Refcount leak: real.**
   - The `Set` is only drained on success. Any early return or thrown error after `mark` leaves the ID in the set for the life of the worker process.
   - Every later job's release then sees `size > 0` and defers the shutdown.
   - The 20-minute Colab idle timeout is the only backstop, so up to 20 minutes of GPU per occurrence is wasted.
   - Root cause: mark and release are not paired with `try/finally`.
2. **Malformed ID mis-routing: real.** This is the `ai-tagging-shared.ts:608,659` fall-through described in §5.
3. **Base-URL guard bypass: mostly not exploitable, but unproven by tests.** `validateColabBaseUrl()` passes `new URL(raw).hostname`, and the WHATWG URL parser already normalises IPv4 forms. Checked with Node on 2026-11-25:
   - `0x7f.0.0.1` → `127.0.0.1`;
   - `0177.0.0.1` → `127.0.0.1`;
   - `0xC0.0xA8.1.1` → `192.168.1.1`;
   - `2130706433` → `127.0.0.1`;
   - `127.1` → `127.0.0.1`;
   - `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`.
   All of these then hit the dotted-quad or mapped checks. `fd::1` means `00fd::1`, which is **not** a unique local address, so the regex is right to let it through. The real weakness is that the IPv6 range check is a string regex, and no test proves these encodings are rejected. Fix it with a numeric first-group check and a test table.
4. **Notebook path confusion: real.** The checked path and the forwarded path differ.
   - `/v1/../metrics` passes the `startswith("/v1/")` check and is forwarded raw. vLLM's server may normalise it to `/metrics`.
   - Percent-encoded dot segments (`%2e%2e`) behave the same way.
5. **Unauthenticated `/health`: low severity.** It reveals only that the tunnel is alive. It is needed by the notebook's own readiness loop, which calls vLLM's `/health` on `127.0.0.1` directly and does not go through the proxy. Decide in step 5.

## 7. Approaches considered and rejected

- **Keeping a time-to-live on consumer IDs instead of `try/finally`.** Rejected. It adds a timer and guesses at job length. `finally` is exact.
- **Rejecting all IPv6 hosts outright.** Rejected. It is legitimate for Cloudflare tunnels to resolve over IPv6, although the URL host is a name. Being over-strict on literals is acceptable, but only for real private ranges.
- **Resolving DNS in the validator.** Rejected for this plan (see §4). It adds a network dependency to a config parse, and the input comes from an administrator.
- **Blocking `..` with a string search in the notebook.** Rejected. It misses encoded forms. Percent-decode once, run `posixpath.normpath`, reject any path that changes or escapes `/v1/`, and forward the normalised path plus the original query.

## 8. Design decisions

Locked:
- Colab never receives database credentials, and `auto_shutdown` defaults to true (`docs/MODEL_RULES.md`, owner design 2026-11-22).
- The 20-minute idle timeout stays as the backup.

Open (the implementer decides):
- Step 5, `/health` auth. The default recommendation is to keep it unauthenticated but return only `{"ok":true}`, with no model names or versions, and to document this in the notebook header. If the response today includes any detail, strip it.

## 9. The plan

**Step 1. Pair mark and release.** `lead-only`: this is the production control flow of the tagging loop.
- In `handlers/ai-tagging.ts`, wrap everything after `markColabConsumerActive(colabConsumerId)` up to the function's return in `try { … } finally { … }`.
- The `finally` releases **only when the operation will not continue on a later step**. The worker calls this handler once per page: `done: true`, or `ok: false && done: true`, or a thrown error, or `state_transition` that ends the op.
- Intent: a paused page (`done: false`) must keep the consumer so the GPU is not shut down between pages. Every terminal exit must release.
- Extract a helper, `isTerminalStepResult(result)`, so the rule is tested in one place.
- Apply the same pattern in `handlers/ai-tag-bakeoff.ts` around `:542-624`.
- Gate: the new tests "early return 'no asset ID' releases the consumer", "thrown candidate-fetch error releases", "done:false page keeps the consumer" and "bake-off assetErr releases" in `colab-vision-api.test.ts` or the handler test files. Each asserts the internal set size through a new test hook, `getActiveColabConsumerCountForTests()`.

**Step 2. Fail fast on malformed Colab IDs.** `helper-ok`: the files and behaviour are exact.
- In `ai-tagging-shared.ts:608,659` (and anywhere `isColabDirectModel` gates routing; grep `isColabDirectModel(`), add a check: if the trimmed model starts with `colab-direct/` but `isColabDirectModel()` is false, throw `Invalid colab-direct model id: <id>`.
- Make `colabModelId()` throw on an invalid shape.
- Gate: the tests "`colab-direct/a/b/c` throws and makes no fetch" and "`colab-direct/Qwen/Qwen3-VL-32B-Instruct` routes to Colab".
- Stop-and-ask trigger: some caller deliberately relies on the fall-through.

**Step 3. Base-URL guard.** `helper-ok`.
- In `isPrivateOrLoopbackHost`, replace the `:67` regex with parsing:
  - take the first hextet of the (bracket-stripped) IPv6 literal;
  - expand `::` with a small helper, or reuse the URL-normalised compressed form and parse the first group with `parseInt(…, 16)`;
  - reject `(g & 0xfe00) === 0xfc00` (fc00::/7) and `(g & 0xffc0) === 0xfe80` (fe80::/10).
- Keep every other check.
- Add a table test through `validateColabBaseUrl()`:
  - rejected: `0x7f.0.0.1`, `0177.0.0.1`, `0xC0.0xA8.1.1`, `2130706433`, `127.1`, `[::1]`, `[fc00::1]`, `[fd12:3456::1]`, `[fe80::1]`, `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `localhost`, `x.internal`, `http://example.com`, and `https://user:pw@example.com`;
  - accepted: `https://abc.trycloudflare.com` and `[fd::1]` (this is `00fd::1`, which is public).
- Gate: the table test passes.
- Stop-and-ask trigger: Node normalises some form differently than the list above.

**Step 4. Notebook proxy path.** `lead-only`: it is a security boundary.
- In the `_forward()` cell of `scripts/colab/popdam_vision_server.ipynb`:
  - parse `self.path` with `urlsplit`;
  - `raw = parts.path`;
  - `decoded = urllib.parse.unquote(raw)`;
  - `norm = posixpath.normpath(decoded)`.
- Reject with 400 if `decoded` contains `\x00` or `\\`.
- Reject with 404 unless `norm == "/health"`, `norm == "/popdam/shutdown"` (POST), or `norm.startswith("/v1/")`.
- Use `norm` for the auth decision, the activity timestamp and the allowlist.
- Forward `norm + ("?" + parts.query if parts.query else "")`, never `self.path`.
- Add a small pure function, `route_path(raw) -> (norm|None, query)`, in the same cell, plus a test cell guarded by `if __name__ == "__main__"`, or a sibling `scripts/colab/test_route_path.py`, that asserts:
  - `/v1/../metrics` → None;
  - `/v1/%2e%2e/metrics` → None;
  - `/v1//chat/completions` → `/v1/chat/completions`;
  - `/v1/chat/completions?x=..` → path `/v1/chat/completions`, query `x=..`;
  - `/health` → `/health`;
  - `/metrics` → None.
- Gate: `python -I scripts/colab/test_route_path.py` passes. Extract the function to that file and have the notebook import or duplicate it with a comment pointing at the test.

**Step 5. `/health` exposure.** `lead-only`: this is decision §8.
- Apply the default: `/health` stays unauthenticated and returns only `{"ok": true}`. Document this in the notebook's first markdown cell and in `docs/MODEL_RULES.md`.
- Gate: reading the cell shows no model or version data in the `/health` response.

**Step 6. Land and live proof.** `lead-only`.
- Open a PR to `main` and merge once the required checks pass. The worker auto-deploys. The notebook change takes effect the next time Albert starts a Colab session; tell him only if the notebook's run steps change. They should not.
- Live proof, when the next Colab job runs: Railway logs show `colab-vision-api` shutdown called once at the end of the job, with no "deferring instant shutdown" line when only one job ran.
- If no Colab job runs within this session, leave `- [ ] live proof` on #1271 and record the exact log query to use.

## 10. Tests required

- The lifecycle tests from step 1 (four cases).
- The malformed-ID tests from step 2 (two cases).
- The `validateColabBaseUrl` table from step 3 (all rows listed).
- The Python `route_path` tests from step 4 (six cases).
- Existing: `cd apps/worker && npm test && npm run build`. `colab-vision-api.test.ts` must stay green.

### Adversarial-cases table (trust boundary: the administrator-supplied URL and the public tunnel requests)

| External input | Hostile case | Test |
|---|---|---|
| `COLAB_VISION_CONFIG.base_url` | hex, octal or integer IPv4 loopback | step 3 table rows `0x7f.0.0.1`, `0177.0.0.1`, `2130706433`, `127.1` |
| `base_url` | private IPv4 in hex | `0xC0.0xA8.1.1` row |
| `base_url` | IPv6 loopback, ULA, link-local, mapped | `[::1]`, `[fc00::1]`, `[fd12:3456::1]`, `[fe80::1]`, `[::ffff:7f00:1]` rows |
| `base_url` | embedded credentials or plain http | the `user:pw@` and `http://` rows |
| model ID | `colab-direct/a/b/c` | step 2 "throws and makes no fetch" |
| tunnel request path | dot-segment escape | `route_path('/v1/../metrics')` → None |
| tunnel request path | percent-encoded escape | `route_path('/v1/%2e%2e/metrics')` → None |
| tunnel request path | query carrying `..` | `route_path('/v1/chat/completions?x=..')` keeps the query and the path |
| tunnel request | unauthenticated `/v1/*` | the existing auth check, plus a new assertion in `test_route_path.py` that auth uses `norm` |

## 11. Constraints and gotchas

- Use a feature branch and PR; never push to `main`. Reviews are advisory.
- The worker handler is called once per page. Releasing on a `done:false` page would shut down the GPU mid-run. This is the one subtle point in step 1.
- Never print `COLAB_VISION_CONFIG.api_key`.
- Run Python for the test with `-I`.
- No database schema change is involved.

## 12. Access and environment

- `gh` is authenticated as `u2giants`.
- Railway worker logs: use the Railway MCP `get-logs` or the CLI.
- `admin_config.COLAB_VISION_CONFIG` can be read read-only through the Supabase Management API, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token", injected with `op run`. Never echo the key.
- Local: `npm ci` at the root, `cd apps/worker && npm test`, plus Python 3.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–5 are merged to `main` and CI is green.
- [ ] The Railway worker runs the merge SHA.
- [ ] Live proof from step 6 is recorded, or `- [ ] live proof` is left on #1271 with the log query.
- [ ] #1271 is closed with evidence after the proof.
- [ ] STATUS is updated.

Risk: a wrong terminal-result rule in step 1 could shut the GPU down between pages, so the job fails over to `vision_tagging_fallback`. The "done:false keeps the consumer" test guards against that. Rollback: redeploy the previous worker SHA.

Open: none besides §8.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. §5 gives the exact code locations, §9 the files, behaviour and gates, and §12 the access. The subtle page-continuation rule is spelled out in step 1 and §11.
2. *Is all background, including what was ruled out, captured?* Yes. §6 records which findings are real and which are not exploitable, with the Node evidence. §7 records the rejected approaches.
3. *Is the goal clear for judgment calls?* Yes. §1 says: release the GPU promptly, expose only the authenticated model API, and make a typo fail loudly.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1271-colab-vision-hardening.md in u2giants/popdam3. Read AGENTS.md, then the plan (STATUS first). Do steps 1, 4, 5 and 6 yourself. Give steps 2 and 3 to your helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring stop-and-ask triggers back to you. If stuck for 30 minutes, the step is taken back. You re-run every gate and the worker suite, merge the PR when required checks pass, verify the Railway SHA, record live proof, update STATUS, and close #1271 with evidence.
```
