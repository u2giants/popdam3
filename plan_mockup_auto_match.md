# Implementation Plan — Mockup auto-match: right product, right images, sharper art

**STATUS — 2026-10-27 (all rows open; nothing started)**

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | pop-mock v6.10: `artB`/`nameB` second image + shaped-product image fallback + `fallback` art param | ⬜ open | — |
| 2 | Vendor v6.10 into popdam3 `public/mockup/index.html` | ⬜ open | — |
| 3 | `pickMockupRoute()` keyword map + tests in `src/lib/mockup-tool.ts` | ⬜ open | — |
| 4 | `buildMockupUrl()` v2 (route + artB) + tests | ⬜ open | — |
| 5 | StyleGroupDetailPanel hero button uses route + A/B selection | ⬜ open | — |
| 6 | AssetDetailPanel button uses route | ⬜ open | — |
| 7 | Docs (`docs/MOCKUP_TOOL.md`, `AGENTS.md` router) updated | ⬜ open | — |
| 8 | PR(s), CI green, merged, deployed SHA verified | ⬜ open | — |
| 9 | Live proof on production (lenticular A/B, clock, framed, canvas, unmatched) | ⬜ open | — |

A fresh session starts at step 1 and re-reads this whole plan first.
Handoff entry (discovery + traps): [HANDOFF.d/20261027T1434Z-edge-dev-zcode-mockup-auto-match-plan.md](HANDOFF.d/20261027T1434Z-edge-dev-zcode-mockup-auto-match-plan.md)

---

## Part 1 — Why

### 1. The ultimate goal

When a PopDAM user clicks the mockup cube on an item, the mockup tool must
open showing **the right product for that item** with **the right art already
placed in the right slots** — a "Framed 3D Lenticular" item opens the
lenticular mockup with both of its pictures in windows A and B; a clock item
opens the clock; a framed print opens the framed print — with no manual
product picking or image dropping. Today every item opens the generic Canvas
product with a single flat picture.

If a step in this plan conflicts with that goal, **the goal wins — stop and
flag it** rather than shipping a step that technically passes but leaves the
user manually correcting the result.

### 2. What these applications are

- **PopDAM** (`github.com/u2giants/popdam3`, identity `u2giants`) — internal
  Digital Asset Manager for licensed consumer-product art (Disney, Marvel,
  NBC, Warner…). React + Vite SPA in `src/`, built to static files served by
  nginx inside Docker (`Dockerfile.ci`, `nginx.conf`), deployed by Coolify at
  **https://dam.designflow.app** (PopSG mode serves the same image at
  sg.designflow.app — not relevant here). Supabase (Postgres) for data;
  DigitalOcean Spaces bucket `popdam.nyc3.digitaloceanspaces.com` for
  thumbnails and PDF page renders. Item thumbnails are 800px JPEGs at
  `thumbnails/<assetId>.jpg`; PDF page renders at
  `pdf-pages/<assetId>_p1.jpg` / `_p2.jpg` (same bucket).
- **Product Mockups tool** (`github.com/u2giants/pop-mock`) — Albert's
  single-file HTML app (`Product Mockups.html`, ~3.3MB, currently v6.9,
  APP_VERSION near line 18003) that renders 3D product mockups (Shadowbox,
  Canvas, Framed 3D Lenticular, Framed Print, Shaped Frame, MDF Die-Cut,
  Clock, Stager 4 Piece) from art files or flat images, and exports
  PNG/3D/mockup files. It is **vendored verbatim** into PopDAM at
  `public/mockup/index.html` and served at `/mockup/`. **pop-mock is the
  source of truth; never edit the vendored copy directly** — edit pop-mock,
  bump its version, then copy the file over in a popdam3 PR.
- Integration that already exists (shipped 2026-10-26, live): a cube button
  on the item flyout (`StyleGroupDetailPanel`) and on the file detail flyout
  (`AssetDetailPanel`) opens `/mockup/?art=…&name=…#/canvas`. The art URL is
  rewritten to the same-origin nginx proxy `/spaces/…` (nginx.conf; Vite dev
  proxy mirrors it) because the tool needs pixel access and the bucket has no
  CORS configuration. Link contract and sync rules: `docs/MOCKUP_TOOL.md`.

### 3. What triggered this work

Albert (owner) asked on 2026-10-27: *"we need it to automatically match up the
item in the panel with the correct item in the mockup and automatically insert
the correct image into the correct place in the mockup app."* After seeing the
assessment he said go and asked for this plan. Context: he had just reported
not finding the cube button (it was on the file panel, not the item flyout —
fixed in PR #522); the item flyout button shipped at 2026-10-26 ~8:48 PM EST
(build c073983) always opens Canvas, which is wrong for lenticulars, clocks,
framed prints.

### 4. Scope

**In:**
- Keyword→product-route mapping from the item's own description fields.
- Lenticular two-image auto-fill (image A and image B).
- Tool-side graceful handling: second linked image; flat image routed to a
  product that needs a layered `.ai` (shadowbox/shaped/plaque) redirects to
  Framed Print with a visible notice; optional fallback art URL on 404.
- Optional sharper art: prefer the PDF page-1 render over the 800px thumbnail
  when it exists (fallback to thumbnail on failure).
- Unit tests for all new pure logic; live proof on production.

**NOT in this plan (do not build):**
- No database schema changes, no new columns, no shared-db work (read-only
  use of existing fields only).
- No server-side rendering/proxy beyond the existing `/spaces/` proxy.
- No new tool products (Tin Signs, tapestries, mats, hampers etc. stay
  unmatched → default Canvas; they are not mockup-able in the tool today).
- No auto-export/saving mockups back into PopDAM.
- No PopSG (sg.designflow.app) UI changes.

## Part 2 — What we already know

### 5. Current state of the code

popdam3 `main` @ `99d0a10f` (2026-10-27); production build c073983 (the
#522 merge) is what runs live at dam.designflow.app; a later docs-only merge
(#537 and shared-db syncs) means main is slightly ahead of the running build
— deploys are automatic on merge (publish-frontend workflow), so merging this
plan's PRs deploys them.

Shipped and working (verified live 2026-10-26/27, and by tests):
- `src/lib/mockup-tool.ts` — `buildMockupUrl(thumbnailUrl, filename)` builds
  `/mockup/?art=/spaces/<path>&name=<file>#/canvas`. Tested in
  `src/lib/mockup-tool.test.ts`.
- `src/components/library/StyleGroupDetailPanel.tsx` (~line 438) — cube
  button on the hero, uses `displayThumbnail` (the thumbnail currently shown
  in the hero carousel; `currentThumbAsset` is that asset). Tested in
  `StyleGroupDetailPanel.mockup.test.tsx` (renders + opens expected URL).
- `src/components/library/AssetDetailPanel.tsx` (~line 95 `openMockupTool`,
  ~line 546 the button) — same, per-file.
- `nginx.conf` `/spaces/` proxy; `vite.config.ts` dev proxy (parity).
- `docs/MOCKUP_TOOL.md` — integration doc; `AGENTS.md` router row exists.
- pop-mock `main` @ `6e51117` (v6.9). Link loader is the **last `<script>`**
  in `Product Mockups.html` (`loadFromLink` IIFE). v6.9 behavior: reads
  `?art=&name=&product=`, an explicit `#/route` in the link wins over the
  file-type guess, image-content art opens in Canvas. Injects the fetched
  blob as a File into the active product's `#file` input via DataTransfer +
  change event. **The loader must never wait on `requestAnimationFrame`**
  (never fires in background tabs — cost a full debugging session).

### 6. Key findings (do not rediscover)

- **The fine product vocabulary lives in `style_groups.item_short_description`
  / `cover_description` / `item_description`**, not in `product_category`
  (which is a coarse bucket: Wall/Storage/Tabletop/… and NULL for ~30% of
  groups). Sampled production 2026-10-27: keyword hits across ~3k groups —
  canvas 370, framed 108, shadowbox 38, clock 18, lenticular 19, sign 23,
  mat 43, tapestry 12, tray 6, mdf 3. Descriptions read like "Bombers Framed
  Print", "Spider-Man Web Comic Canvas", "Venom And Spiderman Framed
  Lenticular".
- **Lenticular artboards render to PDF page images**: the tool's lenticular
  mode uses artboard 1 = image A, artboard 2 = image B from one `.ai`/PDF;
  PopDAM's windows-agent uploads hi-res renders of those pages to Spaces at
  `pdf-pages/<assetId>_p1.jpg` and `_p2.jpg`, and `assets.pdf_page2_url`
  stores the page-2 URL (popdam3 `apps/windows-agent/src/index.ts:548-557`,
  `apps/windows-agent/src/uploader.ts:91-98`). Page-1 URL is NOT stored on
  the row but the key is deterministic.
- **The tool already supports two images and slots**: lenticular's
  `loadFiles`→`loadFreeFiles(files, slot)` sends a 2-file list to slots a/b
  (`Product Mockups.html` ~line 16698-16706 region as of v6.9); the shaped
  product's file input is `multiple=true` (verify lenticular's during step 1).
- **Products that REQUIRE a layered `.ai`** (Shadowbox, Shaped Frame,
  MDF Die-Cut) reject flat images with a status message. Clock, Canvas,
  Framed Print, Lenticular, Stager accept flat images.
- **Spaces has no CORS config**; that's why the `/spaces/` same-origin proxy
  exists. Probe from 2026-10-26: error responses carry no ACAO header, so
  don't "simplify" the proxy away.
- **Open the flyout in the UI**: single click on a group card selects AND
  opens the flyout (`src/hooks/useSelectionManager.ts` plain-click branch →
  `onSingleClick`). Programmatic `.click()` works; `requestAnimationFrame`
  hangs in a backgrounded IAB pane (see v6.9 debugging).

### 7. Approaches considered and REJECTED

- **Ask the bucket for CORS instead of the proxy** — rejected: needs DO
  credentials that live only on the NAS agent, adds infra state; proxy is
  code-only and already shipped.
- **Match on `product_category`** — rejected: too coarse (Wall/Storage/…,
  NULL for ~30%); the descriptions carry the real product names.
- **Port the tool to a React component** — rejected 2026-10-26: 3.3MB
  self-contained app with its own design system; vendoring keeps one source
  of truth and zero maintenance fork.
- **Routing shadowbox-keyword items to the Shadowbox product with a flat
  image** — naive version rejected: the product rejects flat images, user
  gets a dead end. The accepted design routes to the product but the TOOL
  redirects to Framed Print with a notice (step 1).
- **Fetching original `.ai`/PSD files from the browser** — rejected: source
  files live on the NAS; the web app cannot fetch them; helper check-out is
  out of scope.

### 8. Design decisions

LOCKED (do not relitigate):
- 2026-10-26: tool is vendored verbatim; pop-mock is source of truth; sync =
  copy on release in the same PR cadence (`docs/MOCKUP_TOOL.md`).
- 2026-10-26: art flows through `/spaces/` same-origin proxy, never direct
  bucket URLs.
- 2026-10-26: explicit `#/route` in the link wins over the tool's own
  file-type guess.
- 2026-10-27: matching source = item description keywords (order below),
  unmatched → `#/canvas` (today's behavior).
- 2026-10-27: lenticular A/B primary strategy = page renders of the primary
  asset when `pdf_page2_url` exists (A = `/spaces/pdf-pages/<primaryId>_p1.jpg`,
  B = that `pdf_page2_url` proxied); secondary strategy = primary thumbnail
  (A) + next art asset's thumbnail (B). Rationale: the two artboards are the
  real two images; the deterministic p1 key avoids a new DB read.
- 2026-10-27: tool version ships as **v6.10**.

OPEN (implementer's judgment, state your choice in the PR):
- Exact keyword priority order details beyond the required first-match list
  in step 3 (e.g. whether "stained glass" maps anywhere — default: no).
- Whether the AssetDetailPanel button matches keywords from the asset's own
  fields or defaults to canvas when the parent group is unknown — either is
  acceptable; prefer using `asset.product_category` only for "Clock" and
  defaulting otherwise, because asset rows lack the group's description.
- How to surface "opened Framed Print instead of Shadowbox" (tool toast
  wording).

## Part 9 — The plan

### Phase A — tool changes (pop-mock, then vendor)

**Step 1 — pop-mock v6.10 loader upgrade** (edit
`D:\repos\pop-mock\Product Mockups.html`; work directly on `main` of the
pop-mock clone — it is a one-file app, single-session repo):
1. Extend `loadFromLink` (last `<script>`): accept `artB` and `nameB` query
   params. Fetch art and artB in parallel; build one File per image. Inject
   BOTH files in one DataTransfer into the active product's `#file` input
   (its change handler already routes a 2-file list to slots a/b on
   lenticular; verify the lenticular input has `multiple` — if not, set
   `.multiple=true` on it during injection, which is allowed from script).
   If only `artB` fails, load `art` alone and toast that the second picture
   could not be loaded.
2. Accept `fallback` param (a second URL tried when `art` fails; used by
   PopDAM for thumbnail-behind-hi-res).
3. Image-vs-product guard: when the link's explicit route (or `product=`
   param) is shadowbox/shaped/plaque AND the fetched art blob type is
   `image/*`, redirect to `#/framed`, load it there, and show the existing
   toast style: shadowboxes/die-cuts need the layered .ai — opened Framed
   Print with this picture instead (final wording open).
4. Bump `APP_VERSION` to "6.10", prepend a CHANGELOG entry (one line,
   matching the file's terse style), copy the file to
   `Versions/Product Mockups v6.10.html`.
5. Verification gate:
   - `node -e` script that extracts every plain `<script>` block and runs
     `new Function(block)` — all parse.
   - Local live test (this exact sequence worked in the planning session):
     serve the repo (`python -m http.server 8931`), open in a browser
     `http://localhost:8931/Product%20Mockups.html?art=<local png url>&artB=<second png url>&name=a.png&nameB=b.png#/lenticular`
     → lenticular opens with BOTH images loaded (each slot shows its own
     picture; the tool's "no file loaded" note gone). Also test:
     `#/shadowbox` + image → lands on Framed Print with the notice; art URL
     404 + `fallback` → fallback loads; `artB` 404 → A loads + notice.
   - Commit + push to pop-mock `main` (allowed: single-file tool repo, direct
     push is its convention; include the ZCode signature trailer).

**Step 2 — vendor v6.10 into popdam3**: fresh worktree off `origin/main`,
copy the file over `public/mockup/index.html`, commit, push, include in the
Phase B PR (single PR is fine; it keeps the sync atomic).
Gate: `curl -s <deploy>/mockup/ | grep -c APP_VERSION=\"6.10\"` after deploy.

### Phase B — PopDAM changes

**Step 3 — `pickMockupRoute(descriptions: string[]): MockupRoute`** in
`src/lib/mockup-tool.ts`. Lowercased first-match over the joined description
text; priority order (first hit wins): `lenticular`→lenticular, `shadow
box|shadowbox`→shadowbox, `clock`→clock, `framed`→framed, `canvas`→canvas,
`stager|4 piece|four piece`→stager, `shaped|arch`→shaped,
`mdf|die-cut|diecut`→plaque; no match → canvas. ("Framed 3D Lenticular"
contains both "framed" and "lenticular" — lenticular must rank above framed;
that's why it's first.)
Gate: new unit tests pass (step 10 lists them by name).

**Step 4 — `buildMockupUrl` v2** in the same file, backwards-compatible:
`buildMockupUrl({ art, name, artB?, nameB?, fallback?, route? })` (keep a
deprecated positional signature or update the 3 call sites — implementer's
choice, tests must cover both lenticular output
`?art=…&name=…&artB=…&nameB=…#/lenticular` and simple canvas output).
Gate: `src/lib/mockup-tool.test.ts` extended, green.

**Step 5 — StyleGroupDetailPanel hero button** (file ~line 438): route from
`pickMockupRoute([group.item_short_description, group.cover_description,
group.item_description])`; lenticular A/B per the locked decision: if the
current hero asset (`currentThumbAsset`) has `pdf_page2_url` → A =
`/spaces/pdf-pages/<currentThumbAsset.id>_p1.jpg`, B = proxied
`pdf_page2_url`, `fallback` = `displayThumbnail` (covers missing p1 render);
else A = `displayThumbnail`, B = next thumbnail-bearing art asset from the
panel's existing ordered asset list (skip the current one). Update
`StyleGroupDetailPanel.mockup.test.tsx` for the lenticular + fallback cases.
Gate: panel test green + manual dev-server click-through (vite dev, log in
with the AI tester, open a lenticular group → tool opens lenticular with two
pictures).

**Step 6 — AssetDetailPanel button** (~line 95): route from
`pickMockupRoute([asset.product_category ?? ""])` (coarse; asset rows lack
the description — acceptable, mostly yields canvas; "Clock" works).
Gate: typecheck + existing suite green.

**Step 7 — docs**: update `docs/MOCKUP_TOOL.md` (new params, matching rules,
A/B strategy, v6.10 sync note); update the `AGENTS.md` router row to mention
auto-matching; keep one paragraph each.

**Step 8 — land**: one PR for steps 2-7 (plus the pop-mock push from step 1
already on its main). Standard flow: `npm run typecheck && npm test &&
npm run lint && npm run build` locally; PR; wait CI with
`/c/repos/ai-devops/bin/ai-pr-wait <n> --repo u2giants/popdam3
--timeout-minutes 10 --fit-tool-call`; merge `--squash --delete-branch`;
deploy is automatic (publish-frontend). Gate: merged SHA + build stamp on
dam.designflow.app header shows the new commit; `/mockup/` serves 6.10.

**Step 9 — live proof on production** (browser, AI tester login): open one
group per class — lenticular (e.g. any "…Framed Lenticular" group: expect
lenticular product, two pictures in A and B), framed print, canvas, clock,
and an unmatched item (e.g. a mat/hamper: canvas). Screenshot each state;
update this plan's STATUS rows with the evidence. `- [ ] live proof` stays
open on the tracking issue until this step passes.

### Adversarial-cases table (trust boundary: external description text + URLs)

| External input | Hostile/odd case | Behavior required | Test |
|---|---|---|---|
| `item_short_description` | "Framed 3D Lenticular" (two keywords) | lenticular wins (priority) | `pickMockupRoute ranks lenticular above framed` |
| description | "Glow in the dark Canvas with foil" | canvas; must not crash on extra words | `pickMockupRoute matches canvas inside decorated names` |
| description | empty / null / only whitespace | canvas default | `pickMockupRoute defaults to canvas` |
| description | "MDF shadowbox with Die-cut 3D Layer" (coming-soon product) | shadowbox route; tool's image-guard redirects to framed with notice | unit: shadowbox keyword; live: step 9 |
| `art` URL | 404 (p1 render missing) | `fallback` loads; if no fallback, tool toast | manual step 1 gate; `buildMockupUrl includes fallback param` |
| `artB` URL | 404 / absent | A loads alone + notice | manual step 1 gate |
| `pdf_page2_url` | spaces URL with query string | proxy path strips origin, keeps path+query | `buildMockupUrl keeps query in proxied path` |
| name params | `"…#/@§"` weird chars, emoji | URL-encoded round-trip; tool never executes it | `buildMockupUrl encodes hostile names` |
| lenticular group | only ONE art file | B absent → single image in slot A | panel test `lenticular with one file sends no artB` |
| route param | `#/canvas` + `.ai` filename + image art (the v6.9 bug shape) | explicit route still wins | existing v6.9 manual case re-run in step 1 gate |

## Part 10 — Tests required (names, not vibes)

New/extended unit tests (vitest, run `npx vitest run <path>`):
- `src/lib/mockup-tool.test.ts`: `pickMockupRoute ranks lenticular above
  framed`; `pickMockupRoute matches canvas inside decorated names`;
  `pickMockupRoute defaults to canvas`; `pickMockupRoute sends clock to
  clock`; `buildMockupUrl emits artB/nameB and lenticular route`;
  `buildMockupUrl includes fallback param`; `buildMockupUrl keeps query in
  proxied path`; `buildMockupUrl encodes hostile names`.
- `StyleGroupDetailPanel.mockup.test.tsx`: `lenticular group sends page
  renders as A and B`; `lenticular with one file sends no artB`;
  `non-lenticular group sends single art and matched route`.
- Existing suites must stay green: `npm test` (721+ tests), plus `npm run
  typecheck`, `npm run lint` (0 errors), `npm run build`.
- Tool (not unit-testable in this repo): the step 1 manual gate list is its
  test; record results in the PR body.

## Part 11 — Constraints, standing rules, gotchas

- Branch policy: never push to popdam3 `main`; feature branch → PR → CI →
  squash-merge. pop-mock (single-file tool) pushes to its own main directly.
- No DB changes of any kind; read-only use of existing columns.
- Reviews: not required in this repo (owner ruling 2026-10-15); observation
  week rules: if `ai-task-gates check --before ship` prints MERGE-UNREVIEWED,
  merge on green CI with label `unreviewed-week`.
- Every GitHub post carries the trailer `Posted by ZCode chat
  $ZCODE_SESSION_ID on $COMPUTERNAME`.
- Sign nothing with secrets; tester login referenced by vault location only
  (section 12).
- **Never wait on `requestAnimationFrame` in the tool loader** (background
  tabs never fire it — v6.9 bug).
- The vendored tool file is ~3.3MB — do not open it whole in an editor
  context; edit by targeted search (`grep -n`) + Edit tool on narrow ranges;
  syntax-check with the block-wise `new Function` script from step 1.
- CRLF warnings from git on these HTML files are expected/benign.
- Deploy is automatic from main; production checks must use the build stamp
  in the app header (top-right area, `commit · date`) to confirm the running
  SHA.
- If a live-UI probe misbehaves in the in-app browser pane (flyout not
  opening), retry in a FRESH tab before concluding anything — a tab that has
  fought the automation accumulates selection state (learned 2026-10-27).

## Part 12 — Access and environment

- Repos: `D:\repos\pop-mock` (clone of u2giants/pop-mock) and
  `C:\repos\popdam3` (canonical, landing-only — write-capable work goes in
  `D:\repos\popdam3-worktrees\<name>` worktrees created off a fresh
  `origin/main`).
- Production: https://dam.designflow.app. Deploy = automatic on merge
  (publish-frontend → GHCR → Coolify webhook).
- Test login (production, designer tier, read-testing): 1Password vault
  `vibe_coding`, item **"DAM AI tester login - PopDAM (designer,
  dam.designflow.app, production)"** — email + password fields; log in on
  the sign-in page with email/password (not Microsoft). Never paste values
  anywhere.
- Supabase URL + publishable key are public in `public/dam-config.json`.
- Local dev: `npm ci` then `npm run dev` (port 8080; `/spaces` dev proxy
  included). Local tool test: `python -m http.server 8931 --directory
  D:\repos\pop-mock`.
- Waiter/gates CLIs: `/c/repos/ai-devops/bin/ai-pr-wait`,
  `ai-task-gates` on PATH.

## Part 13 — Definition of done + risks

Done means: steps 1-9 STATUS rows cite artifacts (commits, CI runs, live
screenshots, grep outputs); production shows the tool at v6.10; live proof
covers lenticular A/B, clock, framed, canvas, unmatched; docs and
`docs/MOCKUP_TOOL.md` updated; this plan's STATUS updated; the tracking
issue's `- [ ] live proof` checked with evidence.

Risks: (a) page-1 render key may not exist for older PDFs — mitigated by the
`fallback` param; (b) lenticular's `#file` input may lack `multiple` —
mitigated in step 1.3 (set it during injection); (c) description keywords
drift as new products appear — matching table is data in one function with
tests; extend there; (d) two sequential fetches slow the load on weak links —
parallel fetch, and the tool shows its own busy state.

Open questions: none blocking. The OPEN items in section 8 are implementer
choices with stated defaults.

---

### Self-audit (mandatory gate — passed 2026-10-27)

1. **Could a fresh session execute this without asking anything?** Yes —
   sections 2, 5, 6, 11, 12 define every path, SHA, command, login location,
   and trap; steps 1-9 each carry a verification gate and the tool's exact
   test URLs.
2. **Does it carry all background including rejections?** Yes — sections 6
   (findings incl. the rAF bug, CORS probe, description-field discovery),
   7 (five rejected approaches with reasons), 8 (locked/open decisions with
   dates).
3. **Is the goal clear enough to steer a wrong step?** Yes — section 1 names
   the user-visible outcome per product class and the stop-and-flag rule.
