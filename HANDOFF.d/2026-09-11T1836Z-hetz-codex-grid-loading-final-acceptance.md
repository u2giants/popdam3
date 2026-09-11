---
issue: 121
status: OPEN
owner: codex/grid-loading-final-acceptance
---

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs Albert. Albert already confirmed on 2026-09-11 that the released pages load faster. The remaining work is repeatable production acceptance evidence, not a product or rollout choice.

Already settled — do not re-ask: preserve Master Data full-tab behavior, keep OrderList's bounded 500-row loading, never put exact counts on the visible-row path, never increase timeouts, and use the governed database lookup for OrderList Find.

## 1. What this application is

PopDAM is POP Creations' internal artwork and product-data application. The Master Data page at `https://dam.designflow.app/styles` must make a large style-tracker sheet usable promptly; OrderList at `https://dam.designflow.app/orders` must find late matching orders without downloading the entire list. This checkout is `/worksp/popdam`, repository `u2giants/popdam3`, and ships directly from `main`.

## 2. What we set out to do this session, and why

Complete the loading-performance plan for PopDAM issue #121: show the first 4,000 Master Data rows promptly, stop fetching unused view columns, and replace OrderList Find's browser-side position scan with one governed lookup. The customer problem was waiting for rows and Find results.

## 3. Current state — what is true right now

All implementation is committed, pushed, and deployed on PopDAM `main`:

- `1d17075e` delivers progressive Master Data loading and explicit field projection.
- Shared-db migration `20260911081204` is production-live through shared-db PR #2748 (merge `9da98edefecc7104d709762e53fd1efb421cc9dc`); it supplies the governed Find lookup. PopDAM did not author or apply this database migration.
- `dc7e4c0` makes OrderList Find call that lookup and preserves only a missing-function deployment-skew fallback.
- `f6af7dd8` removes exact counting from visible OrderList block loading; summary counts are deferred and sequential.
- `6a0fc68d` corrected the plan's release status after production investigation.

Focused tests, the production build, and the full frontend suite (55 files, 345 tests) passed during this work. The live bundle was verified to contain the Find integration. The governed lookup itself passed signed-in production acceptance before the app integration shipped.

Albert reported on 2026-09-11 that the released pages load faster. The plan remains honestly partial only because no sanitized current Generic-Master-Data and OrderList timing evidence has been captured and no fresh full signed-in visual pass has been recorded after credential rotation. Issue #121 is still open with no comments.

The authoritative plan is `plan_master_data_orderlist_loading_performance.md`; its status table has this session's update.

## 4. Everything we tried that did NOT work

- Same-request exact counts on OrderList row blocks caused the production timeout. Do not restore them. A parallel count path also created contention, so counts now start after visible rows and run one at a time.
- The previous Find design fetched matching data then scanned IDs in browser requests. It could make roughly 25 requests and was replaced by one governed lookup.
- A low-level browser network diagnostic exposed an authorization header in tool output during prior QA. Do not inspect request headers, cookies, or browser storage. No value was committed. The affected production administrative test account has since had its password replaced, fresh login verified, and all sessions globally signed out.
- During this session, the first credential-rotation command stopped before any production change because the replacement credential had already superseded the old stored value. A second attempt had a shell quotation error and also made no production change. The final protected command returned password update `200`, global sign-out `204`, and a separate fresh-login verification/global sign-out also returned `204`.

## 5. Root causes and key findings

- Master Data's delay was caused by withholding already-loaded rows until every page completed, not only by grid rendering. The released code publishes a four-range first wave and appends later pages.
- `.select("*")` coupled Master Data payload size to unrelated fields in the shared view. The released explicit projection protects the page while retaining required JSON and editing fields.
- OrderList opening must stay bounded. The performance win is only Find positioning; loading all rows would reverse the intentional infinite-grid design.
- PostgreSQL owns the filtered/sorted set, so row position belongs in the governed database function. Missing-function fallback is allowed solely for deployment skew; permission, malformed input, timeout, and SQL errors remain visible.
- Global session sign-out prevents further refresh-token use. Previously issued access tokens remain usable only until their normal expiry; do not represent the account as instantaneously revoked at every API endpoint.

## 6. Exact next steps

1. Use the approved production browser test account through protected 1Password injection; never inspect headers, cookies, local storage, or raw request details. Open `/styles`, test both Licensed and Generic tabs, confirm the first wave appears before background completion, partial status remains truthful, and full-tab Find/filter works after completion. You will know it worked when a sanitized note has timings and screenshots without rows, tokens, or headers.
2. Open `/orders` with a cold cache. Confirm initial visible rows appear without a count-driven wait; then use Find for a late matching record and verify one lookup finds, scrolls to, and highlights the result under active filters/sort. You will know it worked when sanitized timings and request-count evidence show the new bounded behavior and no fallback warning.
3. Add the acceptance evidence to PopDAM #121 and update the plan status. You will know it worked when evidence covers Master Data Licensed and Generic, OrderList opening and Find, plus the exact deployed commits.
4. Close #121 only after those gates pass. You will know it worked when the GitHub issue is closed with the production evidence linked and this handoff is retired by that completing session.

## 7. Constraints and gotchas in force

- PopDAM is direct-to-`main`; stage only files you own. Never reset, clean, or alter other sessions' files.
- The shared production database is Virginia project `qsllyeztdwjgirsysgai`; do not use retired Ohio project `ryltkzzernhwnojzouyb`.
- Do not write migrations under PopDAM. Any new shared database structure belongs to canonical `/worksp/shared-db` via its authorized orchestrator workflow.
- Keep Master Data complete client-side after it finishes loading. Keep OrderList infinite and 500-row bounded. Never increase timeouts or conceal errors.
- Do not alter old `HANDOFF.d` files. This is a new, write-once file and remains until a completing session proves #121 closed.

## 8. Access and environment

- GitHub CLI is authenticated; `main` was clean and aligned with `origin/main` at closeout.
- Production frontend: `https://dam.designflow.app`.
- Credentials are in 1Password vault `vibe_coding`. The production administrative browser test account was rotated on 2026-09-11 and its rotation metadata was stored there. Use protected injection only; never reveal, paste, log, commit, or put a value in command arguments.
- The shared-db orchestrator marker open at closeout is #2758, owned by another session. This session is not the orchestrator and did not claim it.

## 9. Open questions and risks

- Albert's faster-load observation is real customer feedback but does not replace comparable sanitized performance evidence for the Generic tab and OrderList. Capture it before issue closure.
- Do not repeat the unsafe diagnostic that leaked a browser authorization header. If the approved browser tool cannot produce redacted evidence, record the limitation on #121 rather than weakening secrecy rules.
- The prior handoff `HANDOFF.d/2026-09-10T1519Z-hetz-codex-grid-loading-phase-a.md` is another session's file. Its credential-rotation prerequisite is now satisfied, but it must be retired only by a session that meets the successor rule.

## Self-audit

1. Yes — §§1–3 define the product, outcome, current commits, deployment state, issue state, and exact unfinished acceptance gates for a new developer.
2. Yes — §4 preserves both performance and credential-rotation failures; §5 records the non-obvious design and session-revocation facts; §§7–8 preserve operating constraints and safe access.
3. Yes — §6 is ordered and each step has a clear completion test; §§3 and 9 distinguish deployed facts, remaining evidence, and risks without secret values.
4. Yes — the line-by-line owner-decision sweep found no new owner choice. §0 explicitly says so and records Albert's settled acceptance feedback.
