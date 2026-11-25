---
summary: Issue #925 plan: art links on mock.designflow.app load images (nginx /mockup/spaces/ proxy). Read STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-925, mock.designflow.app, Mockups header link, /spaces/ proxy, nginx.conf
---

# Plan: Mockups tool on mock.designflow.app loads linked art (u2giants/popdam3#925)

Issue: https://github.com/u2giants/popdam3/issues/925 (review finding on merged PR u2giants/popdam3#922 "Add Mockups link to header")
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS — 2026-11-25

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Finding 1 (routing test expected old nav labels) | ✅ already fixed on main | `src/test/order-list-routing.test.ts:29` now expects `["Sell-through", "Master Data", "Mockups", "Orders", "Setup"]`, matching `src/components/AppHeader.tsx:84` |
| 1 | nginx: serve `/mockup/spaces/` from the Spaces proxy | ⬜ open | — |
| 2 | Contract test for the nginx route | ⬜ open | — |
| 3 | SELFHOST.md: document why the route exists | ⬜ open | — |
| 4 | PR, CI, merge, deployed SHA verified | ⬜ open | — |
| 5 | Live proof on mock.designflow.app | ⬜ open | — |

A fresh session starts at step 1.

## Part 1 — Why

### 1. The ultimate goal
The **Mockups** link in PopDAM's header takes people to
https://mock.designflow.app, the product-mockup tool (shows art on a canvas,
frame, clock, lenticular…). Any picture link that works on PopDAM's own copy
of the tool (`dam.designflow.app/mockup/?art=/spaces/...`) must also work
when the same link is opened on `mock.designflow.app` — the art must appear,
not a blank or an error. *If a step conflicts with this goal, the goal wins —
stop and flag it.*

### 2. What this application is
PopDAM (`u2giants/popdam3`, branch `main`) — POP Creations' internal art
library, React web app served by nginx in one Docker image on the `hetz`
server via Coolify, at https://dam.designflow.app. The mockup tool is a
single HTML file vendored at `public/mockup/index.html` (source of truth
`u2giants/pop-mock`, synced automatically). nginx (`nginx.conf`) proxies
`/spaces/…` to the DigitalOcean Spaces bucket `popdam` so the tool can read
image pixels same-origin. `mock.designflow.app` is routed by a Traefik
file-provider rule (`/data/coolify/proxy/dynamic/pop-mock.yml` on `hetz`) to
the **same** container, rewriting every path `^/(.*)` → `/mockup/$1`
(SELFHOST.md:60).

### 3. What triggered this work
Advisory reviewer finding 2 on PR #922: the tool's link loader `fetch()`es the
`art`/`artB`/`fallback` URLs; PopDAM builds them as same-origin
`/spaces/<path>` (`src/lib/mockup-tool.ts:60-80`). On `mock.designflow.app`
the request `/spaces/x.jpg` is rewritten to `/mockup/spaces/x.jpg`; nginx has
no such location, so the SPA fallback (`nginx.conf:89-91`) returns
`index.html`. Verified live 2026-11-25:
`curl -I https://mock.designflow.app/spaces/does-not-exist.png` → `200
text/html` (the web page), while
`https://dam.designflow.app/spaces/does-not-exist.png` → `403
application/xml` (Spaces itself answering). So the image proxy is
unreachable on the mock host.

### 4. Scope
In: one nginx location, a contract test, a SELFHOST.md note, live proof.
**NOT in this plan:** editing the Traefik file on `hetz` (host layer; owned
by Ansible/Coolify, and the repo fix makes it unnecessary); changing the
mockup tool (`u2giants/pop-mock`); changing where PopDAM's own mockup buttons
point (they use `/mockup/` on dam.designflow.app and keep doing so);
finding 1 (done).

## Part 2 — What we already know

### 5. Current state
- `nginx.conf:71-82` `location /spaces/ { proxy_pass https://popdam.nyc3.digitaloceanspaces.com/; proxy_ssl_server_name on; proxy_set_header Host popdam.nyc3.digitaloceanspaces.com; expires 7d; add_header … (repeated security headers, #236) }`.
- `nginx.conf:89-91` SPA fallback.
- Header link: `src/components/AppHeader.tsx:64` → `https://mock.designflow.app/`.
- Nothing started; no branch.

### 6. Key findings
The tool is served under `/mockup/` on both hosts, but its art URLs are
root-relative `/spaces/…`. On dam.designflow.app the browser asks for
`/spaces/…` (proxied). On mock.designflow.app the browser asks for
`/spaces/…` too, but Traefik prepends `/mockup`. Adding `/mockup/spaces/`
as a second proxy entry makes both hosts work with no host change.

### 7. Rejected approaches
- **Narrow the Traefik rewrite** to skip `/spaces/` — host-layer edit outside
  this repo's pipeline, invisible to code review, lost if the file is
  recreated. Rejected in favour of the repo-owned nginx route.
- **Document mock host as drag-and-drop only** — loses the goal (links break).
- **Make `buildMockupUrl` emit absolute `https://dam.designflow.app/spaces/…`
  URLs** — cross-origin from the mock host, needs Spaces CORS, which the
  proxy exists to avoid. Rejected.

### 8. Design decisions
- **Locked:** add `location /mockup/spaces/` with `proxy_pass
  https://popdam.nyc3.digitaloceanspaces.com/;` (trailing slash so the
  `/mockup/spaces/` prefix is stripped), identical headers/expiry to
  `/spaces/`. Place it next to `/spaces/`.
- **Open:** whether to factor the shared proxy lines into an `include`
  snippet — only if the Dockerfile already copies extra nginx files;
  otherwise duplicate with a comment pointing at the twin block.

## Part 3 — How to build it

### 9. Steps
**Step 1 — nginx route.** `helper-ok` (exact block given). Stop-and-ask: if
`nginx.conf` already has a `/mockup/` location that would win over the new
prefix (nginx picks the longest prefix; `/mockup/spaces/` beats `/mockup/`).
Add the block from §8 after `nginx.conf:82` with a comment: "mock.designflow.app
rewrites every path to /mockup/… (SELFHOST.md), so the tool's /spaces/ art
requests arrive here (#925)". Gate: `docker run --rm -v
$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:stable nginx -t`
prints "syntax is ok" (or the equivalent check the Dockerfile uses).

**Step 2 — contract test.** `helper-ok`. Stop-and-ask: none.
New `src/test/nginx-mockup-spaces-route.test.ts`: read `nginx.conf`; assert a
`location /mockup/spaces/` block exists, its `proxy_pass` equals the
`/spaces/` block's, and it repeats the five security headers. Gate: `npx
vitest run src/test/nginx-mockup-spaces-route.test.ts` green.

**Step 3 — docs.** `helper-ok`. Stop-and-ask: none. In `SELFHOST.md:60`
append: "The tool's `/spaces/` image requests therefore arrive as
`/mockup/spaces/…`; nginx proxies that path to Spaces too (#925)." Gate:
`ai-doc-health --repo . --fix-index` clean if available.

**Step 4 — land.** `lead-only` (merge). Branch `claude/issue-925-mock-spaces`,
PR, CI green, AI merges, publish-frontend run green, Coolify serves the SHA
(`https://dam.designflow.app/version.json`).

**Step 5 — live proof.** `lead-only` (live judgment, visual).
- `curl -s -o /dev/null -w "%{http_code} %{content_type}"
  https://mock.designflow.app/spaces/does-not-exist.png` → no longer
  `text/html` (expect `403 application/xml` like the dam host).
- Pick a real thumbnail: on dam.designflow.app open any style group, click
  the mockup button, copy the query string from the opened tab; open
  `https://mock.designflow.app/?<same query>#/canvas` in a browser. The art
  renders on the canvas. Screenshot both hosts side by side, save to
  `docs/verification/issue-925/`, cite in STATUS.
- Confirm `https://mock.designflow.app/` with no query still opens the empty
  tool (no regression).

### 10. Tests
New: `nginx-mockup-spaces-route.test.ts` (step 2). Must stay green: `npm
test`, `npm run typecheck`, `npm run lint`, `src/test/order-list-routing.test.ts`.

### 11. Constraints and gotchas
- Branch + PR; never push `main`; AI merges.
- `add_header` inside a location drops server-level headers — repeat them
  (#236 comment in nginx.conf).
- Don't SSH to `hetz` to edit Traefik; host changes go through `u2giants/ansible`.
- UI-visible result → screenshot proof required.

### 12. Access and environment
`gh` as `u2giants`; public URLs need no login for the curl checks; the
browser check needs a PopDAM login (1Password `vibe_coding`, search
"PopDAM"; never paste values). Docker locally for `nginx -t`.

### 13. Done, risks, open questions
Done: steps 1–5 ✅ with artifacts; PR merged; live checks pass; issue #925
commented with proof and closed.
Risk: none to dam host (new prefix only). Rollback: revert the PR.
Open: none for the owner.

## Self-audit
1. Executable without questions? Yes — §5/§8 give the exact block, §9 the gates.
2. Background and rejected options carried? Yes — §3 live evidence, §7 three rejections.
3. Goal clear for judgment? Yes — §1: same link works on both hosts.

## Lead launch prompt
```
You are the lead for u2giants/popdam3 issue #925. Read AGENTS.md, then
docs/plans/issue-925-mockups-host-image-links.md (STATUS first). Hand steps
1, 2, 3 to your helper; do steps 4 and 5 yourself. Your helper is your own
tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for
Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength
model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design
decisions, never merges or posts, asks you when a stop-and-ask trigger
fires, and is taken back after 30 minutes stuck. You run every gate, merge,
verify the deployed SHA, and take the live screenshots.
```
