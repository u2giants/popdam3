# Plan: Mockup auto-match — open the right product with the right images from an item (u2giants/popdam3#544)
Issue: https://github.com/u2giants/popdam3/issues/544
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

This plan **supersedes the tool-version assumptions** of the root
[`plan_mockup_auto_match.md`](../../plan_mockup_auto_match.md) (written
2026-10-27 against pop-mock v6.10). That file's Part 1 (goal), §6 (findings),
§7 (rejected approaches) and §8 (locked decisions) still hold and are not
duplicated here; this plan re-targets every step at pop-mock **7.3**, the
version vendored today, and says exactly what remains. When the two plans
disagree on a tool detail, **this plan wins**; when they disagree on the goal,
the root plan's §1 wins.

## STATUS — 2026-11-04 (nothing started)

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Refresh the root plan header (point it here; bump "v6.10" → "7.4") | ⬜ open | — |
| 1 | pop-mock 7.4 link loader: `artB`/`nameB`, `fallback`, layered-only guard | ⬜ open | — |
| 2 | Vendor 7.4 into `public/mockup/index.html` | ⬜ open | — |
| 3 | `pickMockupRoute()` in `src/lib/mockup-tool.ts` (11 products, mirrors tool RULES) + tests | ⬜ open | — |
| 4 | `buildMockupUrl()` v2 (object arg, route, artB, fallback) + tests | ⬜ open | — |
| 5 | `StyleGroupDetailPanel` hero button: route + lenticular A/B | ⬜ open | — |
| 6 | `AssetDetailPanel` button: route from asset fields | ⬜ open | — |
| 7 | Docs: `docs/MOCKUP_TOOL.md`, `AGENTS.md` router row, root plan STATUS | ⬜ open | — |
| 8 | PR, CI green, squash-merge, deployed SHA verified, `/mockup/` serves 7.4 | ⬜ open | — |
| 9 | Live proof on dam.designflow.app (lenticular A/B, clock, framed, canvas, cork, unmatched) | ⬜ open | — |

Where a fresh session starts: step 0, after reading this whole file and the
root plan's §1, §6, §7, §8.

---

## 1. The ultimate goal

When a PopDAM user clicks the small cube button on an item (or on one file
inside an item), the Product Mockups tool must open **already showing the right
product for that item with the item's picture(s) placed in the right slots**.
A "Framed 3D Lenticular" item opens the lenticular product with picture A and
picture B filled; a clock opens the clock; a corkboard opens the corkboard; a
framed print opens the framed print. The user should not have to pick a product
or drop an image. Today every click opens the generic Canvas product with one
flat picture (evidence: `src/lib/mockup-tool.ts:19` always appends `#/canvas`;
both buttons call it at `src/components/library/StyleGroupDetailPanel.tsx:474`
and `src/components/library/AssetDetailPanel.tsx:97`).

**If a step conflicts with this goal, the goal wins — stop and flag it.** Do not
ship a step that technically passes but still leaves the user correcting the
product or re-dropping images.

## 2. What this application is

- **PopDAM** — `github.com/u2giants/popdam3` (GitHub identity `u2giants`),
  branch `main`, React + Vite + TypeScript SPA under `src/`, built to static
  files, served by nginx in Docker, deployed by Coolify (app
  `qxj8a0j3tpa9lq4q5rs6pezy`) at **https://dam.designflow.app** (same image
  also serves sg.designflow.app in PopSG mode — out of scope). Data in Supabase
  Postgres (project `qsllyeztdwjgirsysgai`, Virginia). Thumbnails and PDF page
  renders live in the DigitalOcean Spaces bucket `popdam.nyc3.digitaloceanspaces.com`
  (`thumbnails/<assetId>.jpg` 800 px; `pdf-pages/<assetId>_p1.jpg`, `_p2.jpg`).
- **Product Mockups tool** — `github.com/u2giants/pop-mock`, a single-file HTML
  app (`Product Mockups.html`). pop-mock `main` head today: `19dd229`
  (2026-11-04 14:51Z, "Merge pull request #9 from u2giants/fix/sync-alerts").
  The file is **vendored verbatim** into PopDAM at `public/mockup/index.html`
  (4.9 MB, `APP_VERSION="7.3"` at `public/mockup/index.html:30889`, vendored by
  commit `05482937` "mockup: pop-mock 7.3 (u2giants/pop-mock@ba06738)") and
  served at `/mockup/`. **pop-mock is the source of truth; never edit the
  vendored copy directly.** Edit pop-mock, bump its version, copy the file
  over in a popdam3 PR (`docs/MOCKUP_TOOL.md`).
- The existing integration: a cube button on the item flyout
  (`StyleGroupDetailPanel.tsx:467-482`) and the file flyout
  (`AssetDetailPanel.tsx:93-99`, button ~`:555`) opens
  `/mockup/?art=/spaces/<path>&name=<file>#/canvas`. The art URL is rewritten
  to the same-origin nginx proxy `/spaces/` (`nginx.conf`; `vite.config.ts` dev
  proxy mirrors it) because the tool reads pixels and the bucket has no CORS.

## 3. What triggered this work

Albert asked on 2026-10-27 for the mockup to "automatically match up the item
in the panel with the correct item in the mockup and automatically insert the
correct image into the correct place". The root plan was written that day
against pop-mock v6.9→v6.10. The issue review on 2026-11-04 (issue #544 comment)
found: *plan targets v6.10 but the vendored tool is now 7.3; the feature is not
built (buttons still open `#/canvas`); refresh the plan before step 1.* This
file is that refresh.

Reproduce today: log in at https://dam.designflow.app (login in §12), open any
item whose description contains "Lenticular" or "Clock", click the cube at the
hero's top-right → the tool opens on **Canvas** with one picture.

## 4. Scope

**In:**
- Keyword → product-route mapping from the item's description fields, aligned
  with the tool's own 7.3 file-name rules (so a drag-and-drop and a link pick
  the same product for the same words).
- Lenticular two-image auto-fill (A and B) through new `artB`/`nameB` link
  params in pop-mock.
- Tool-side `fallback` art URL and the layered-only guard (shadowbox / shaped /
  plaque / photoframe / cork / shapedcanvas with a flat image → Framed Print +
  notice).
- Unit tests for every pure function; live proof on production.

**NOT in this plan (do not build):**
- No database schema changes, no new columns, no shared-db work; read-only use
  of `style_groups.item_short_description / cover_description /
  item_description / product_category` and `assets.pdf_page2_url`.
- No new server-side proxy or rendering beyond the existing `/spaces/` proxy.
- No new tool products (Tin Signs, tapestries, mats, hampers stay unmatched →
  Canvas). No 7.3 "High gloss" / "Floating frame" option passing through the
  link (the tool's dialog sets those only on home drop; OPEN item in §8).
- No auto-export or saving mockups back into PopDAM.
- No PopSG UI changes. No change to the tool's own home-drop dialog.
- Not re-vendoring anything newer than the pop-mock release that carries the
  loader change (if pop-mock has moved past 7.3 by then, vendor that release;
  the plan calls it "7.4" throughout).

## 5. Current state of the code (2026-11-04, popdam3 worktree HEAD `01fcfc34`; `origin/main` `4409e2d3` is 3 tagging commits ahead and touches none of these files)

Shipped and working (unchanged since 2026-10-27):
- `src/lib/mockup-tool.ts:7-20` — `buildMockupUrl(thumbnailUrl, filename)`:
  proxies the URL to `/spaces/<path><search>`, appends `#/canvas`. Tests in
  `src/lib/mockup-tool.test.ts`.
- `src/components/library/StyleGroupDetailPanel.tsx:467-482` — hero cube
  button, uses `displayThumbnail` (`:220`) and `currentThumbAsset` (`:219`,
  the carousel's current asset from `thumbStrip`, which is `orderedAssets`
  filtered to those with a thumbnail, `:205`). `groupAssets` (`:105-117`) is
  the full `assets` select for the group ordered by filename. Test:
  `src/components/library/StyleGroupDetailPanel.mockup.test.tsx`.
- `src/components/library/AssetDetailPanel.tsx:95-99` `openMockupTool(asset)`
  → `buildMockupUrl(asset.thumbnail_url, asset.filename)`.
- `StyleGroup` type (`src/hooks/useStyleGroups.ts:25,44-46`) already carries
  `product_category`, `cover_description`, `item_short_description?`,
  `item_description?`; the search text at `:267` already joins them.
- `AGENTS.md:86` router row points mockup work at `plan_mockup_auto_match.md`.

Vendored tool 7.3 (`public/mockup/index.html`), verified by grep:
- Link loader `loadFromLink` IIFE at `:31984-32021` reads **only**
  `art`, `name`, `product` and the `#/route` hash. No `artB`, `nameB`,
  `fallback` exist (grep for those strings finds nothing in the loader).
  Explicit `#/route` still wins (`:31989-31990`, `TOOLS[route0]`); a flat
  image with no route goes to Canvas (`:32005-32007`). It waits on a
  `setTimeout`, never `requestAnimationFrame` (`:32011`).
- Product registry `PRODUCTS` at `:30951`+ now has **11** ids:
  `shadowbox, canvas, lenticular, framed, shaped, plaque, clock, stager,
  photoframe (Die-cut MDF Photo Frame, 7.2), cork (Corkboard, 7.2),
  shapedcanvas (Shaped Canvas)`. `TOOLS` map at `:30976`.
- 7.3 added a **home-drop file-name picker** at `:32023+` with a `RULES`
  regex list (most specific first): high-gloss canvas → canvas(gloss);
  shaped/arch/round canvas → shapedcanvas; stager; shadowbox; lenticular;
  floating frame → framed(float); photo/picture frame → photoframe; cork;
  clock; shaped/arch/die-cut frame → shaped; framed|frame → framed;
  mdf|plaque|die-cut|block|tabletop → plaque; canvas|chenille|glitter|foil|
  handpaint|led light → canvas. **This is the vocabulary PopDAM's matcher
  must mirror** so the link and the drop agree.
- Lenticular still loads a 2-file list into slots A/B: `loadFreeFiles(files,
  slot)` at `:14527` (and per-product copies at `:16983`, …); the lenticular
  file input is set `multiple=true` at `:14589`; artboard 1 = A, artboard 2 =
  B (`:13855-13860`).
- Changelog entries `{v:"7.3", date:"2026-11-03"}` … at `:30891-30894`.

Not started: everything in STATUS rows 0-9. No branch, no commits.

## 6. Key findings (verified 2026-11-04; add to root plan §6, which still holds)

- The root plan's step 1 assumed v6.9 line numbers (~16698); in 7.3 the loader
  is at `:31984`, the file has grown to 4.9 MB, and three new products exist.
  A matcher that only knows the 8 old products would route "Corkboard" and
  "Photo Frame" items to Canvas or (worse) "frame" → framed. Mirror the 7.3
  `RULES` order instead of inventing a second vocabulary.
- 7.3's `RULES` puts `lenticular` **after** `shadowbox` and **before**
  `framed`, so "Framed 3D Lenticular" → lenticular (matches the root plan's
  locked ordering) and "MDF shadowbox with die-cut layer" → shadowbox.
- "Die-cut MDF Photo Frame" contains "die-cut", "mdf", "frame" and "photo
  frame": the tool resolves it to `photoframe` only because that rule sits
  above `shaped` (die-cut frame) and `plaque` (mdf). Keep that order.
- `pdf_page2_url` is the only stored page URL; page 1 key is deterministic
  (`pdf-pages/<assetId>_p1.jpg`), see root plan §6 bullet 2. Still true: no
  `pdf_page1_url` column exists (grep in `src/hooks/useAssets.ts`).
- PR #713 ("fix: close verified audit backlog findings", OPEN, CI green) does
  not touch any mockup file; no conflict expected.

## 7. Approaches considered and REJECTED

All five rejections in the root plan §7 stand. Added 2026-11-04:
- **Let the tool do the matching from `name=` using its 7.3 home-drop
  picker** (pass the item description as `name`) — rejected: the picker runs
  only on a home drop and shows a confirmation dialog; the link loader
  bypasses it (`:31984+` never calls `guess`). Also the dialog would reappear
  on every click, which is the manual step the goal removes. PopDAM mirrors
  the rule table instead (step 3) and sends an explicit `#/route`.
- **Pass the description in a new `hint=` param and add the guess inside the
  loader** — rejected: it moves PopDAM's domain vocabulary into the tool and
  makes the rule order untestable from this repo (vitest cannot load a
  4.9 MB page). Keep routing on the PopDAM side where it has unit tests;
  the tool only needs the two-image and fallback mechanics.
- **Skip the pop-mock change and fake A/B by sending one two-page PDF** —
  rejected: PopDAM has no PDF of the two renders; building one in the browser
  is more code than the loader change.

## 8. Design decisions

LOCKED (do not relitigate; dates):
- 2026-10-26: vendored verbatim; pop-mock is source of truth; explicit
  `#/route` wins; art through `/spaces/` proxy (root plan §8).
- 2026-10-27: matching source = item description keywords; unmatched →
  `#/canvas`; lenticular A/B primary = page renders of the current hero asset
  when `pdf_page2_url` exists, secondary = hero thumbnail + next art asset's
  thumbnail (root plan §8).
- **2026-11-04: the matcher mirrors the pop-mock 7.3 `RULES` list (id and
  order) exactly**, plus description-only extras listed in step 3. When the
  tool's `RULES` change, the matcher changes in the same vendoring PR.
- **2026-11-04: the tool release carrying the loader change is "7.4" (or the
  next free minor after whatever pop-mock main is at when step 1 starts).**
  Never ship the loader change without a version bump — the deployed
  `APP_VERSION` is the live proof.
- **2026-11-04: new link params are `artB`, `nameB`, `fallback`** (names from
  the root plan; unchanged). All optional; a 7.3-style link keeps working.
- **2026-11-04: layered-only guard set = `shadowbox, shaped, plaque,
  photoframe, cork, shapedcanvas`** → redirect to `framed` with a notice when
  the fetched blob is `image/*`. (Clock, canvas, framed, lenticular, stager
  accept flat images — root plan §6.) Verify `cork` and `shapedcanvas` in step
  1 by dropping a JPG on each in the local tool; if either accepts a flat
  image, remove it from the guard set and record that in the PR body.

OPEN (implementer's judgment; state the choice in the PR body):
- Whether to pass 7.3 options (`finish=gloss`, `frStyle=float`) through the
  link when the description says "high gloss" / "floating". Default: **no**
  (out of scope §4); the route alone is the deliverable.
- `AssetDetailPanel` source fields: default = `[asset.product_category]` plus
  the parent group's descriptions **if** the panel already has the group
  loaded; otherwise category only.
- Notice wording for the guard redirect (tool side, I18N-aware: the tool has
  `I18N.t` since 7.0 — add the string to all three languages or use plain
  English with `T()`).

## 9. The plan

### Step 0 — re-point the root plan (5 minutes, same PR as step 7)
Edit `plan_mockup_auto_match.md` header: add a line under the STATUS table
"Superseded for tool details by `docs/plans/issue-544-mockup-auto-match.md`
(2026-11-04): the tool is 7.3, targets are 7.4." Do not rewrite its sections.
Gate: `grep -n "issue-544" plan_mockup_auto_match.md` prints the line.

### Phase A — tool (pop-mock), then vendor

**Step 1 — pop-mock 7.4 link loader.** Clone `u2giants/pop-mock` fresh into a
scratch dir (`git clone https://github.com/u2giants/pop-mock` under
`$TMPDIR`; no clone exists on hetz today). Work on a branch, open a PR there
(pop-mock now merges PRs — its last commit is "Merge pull request #9"; do not
push to its `main` directly). Edit `Product Mockups.html`, the `loadFromLink`
IIFE (search `(async function loadFromLink`):
1. Read `artB`, `nameB`, `fallback` from the query string beside `art`.
2. Fetch `art` and `artB` in parallel (`Promise.allSettled`). If `art` fails
   and `fallback` is set, fetch `fallback` and use it as A. If `artB` fails,
   continue with A alone and `note()` "The second picture could not be loaded;
   only picture A was placed." (reuse the existing `note` helper).
3. Resolve the product exactly as today (explicit route wins). Then the
   **layered-only guard**: if the product is in the locked guard set and A's
   blob type starts with `image/`, set `product="framed"`, change the hash, and
   `note()` "That product needs the layered .ai file; opened Framed Print with
   this picture instead."
4. Inject: build one `File` per blob, add **both** to one `DataTransfer`, set
   `inp.files`, dispatch `change`. Before setting, if `!inp.multiple` and two
   files are present, set `inp.multiple = true` (allowed from script).
5. Bump `APP_VERSION` to `"7.4"`, prepend a changelog entry
   `{v:"7.4", date:"<today>", items:["Links can carry two pictures (artB) and a fallback picture; shadowbox-type links with a flat picture open Framed Print with a note."]}`
   beside the 7.3 entry (search `{v:"7.3"`), keep the file's `Versions/`
   convention if the repo has one (`ls Versions`).
Gate (all must pass before the PR):
- Syntax: a Node script that extracts every plain `<script>` block (not
  `type="module"`/JSON) and runs `new Function(block)` — every block parses.
- Serve the clone (`python3 -m http.server 8931 --directory <clone>`) and open
  in a browser (Playwright MCP is available on hetz):
  `http://localhost:8931/Product%20Mockups.html?art=<png A>&artB=<png B>&name=a.png&nameB=b.png#/lenticular`
  → lenticular opens with **two different** pictures in slots A and B.
  `…?art=<png>#/shadowbox` → lands on Framed Print with the notice.
  `…?art=<404 url>&fallback=<png>#/canvas` → the fallback picture loads.
  `…?art=<png>&artB=<404 url>#/lenticular` → A loads, notice shown.
  `…?art=<png>&name=x.ai#/canvas` → still Canvas (route wins; v6.9 case).
  Drop a JPG on `cork` and `shapedcanvas` to confirm the guard set (§8).
- pop-mock PR merged; note the merge SHA in this plan's STATUS row 1.

**Step 2 — vendor 7.4.** In a fresh popdam3 worktree off `origin/main`
(`git worktree add ../popdam3-544 origin/main -b feat/544-mockup-auto-match`
from the canonical checkout `/worksp/popdam`), copy the merged
`Product Mockups.html` over `public/mockup/index.html`. Commit message:
`mockup: pop-mock 7.4 (u2giants/pop-mock@<sha>)` (same shape as `05482937`).
Gate: `grep -c 'APP_VERSION="7.4"' public/mockup/index.html` → 1; `npm run
build` succeeds (the file is static, nothing else changes).

### Phase B — PopDAM

**Step 3 — `pickMockupRoute(texts: Array<string | null | undefined>): MockupRoute`**
in `src/lib/mockup-tool.ts`. Export `MOCKUP_ROUTES` as a `const` tuple of the
11 ids and the `MockupRoute` union. Lower-case and join the texts with a
space; first matching rule wins; rules **in this order** (mirrors 7.3 `RULES`
at `public/mockup/index.html:32029-32042`, extended with description spellings):
1. `/high[\s_-]*gloss|gloss(y)?[\s_-]*canvas/` → `canvas`
2. `/shaped[\s_-]*canvas|arch(ed)?[\s_-]*canvas|round[\s_-]*canvas|circle[\s_-]*canvas/` → `shapedcanvas`
3. `/stager|4[\s_-]*piece|four[\s_-]*piece/` → `stager`
4. `/shadow[\s_-]*box/` → `shadowbox`
5. `/lenticular|3d[\s_-]*lent/` → `lenticular`
6. `/float(ing)?[\s_-]*(frame|canvas)/` → `framed`
7. `/photo[\s_-]*frame|picture[\s_-]*frame/` → `photoframe`
8. `/cork/` → `cork`
9. `/clock/` → `clock`
10. `/shaped[\s_-]*frame|arch(ed)?[\s_-]*frame|die[\s_-]*cut[\s_-]*frame/` → `shaped`
11. `/framed|frame\b/` → `framed`
12. `/\bmdf\b|plaque|die[\s_-]*cut|\bblock\b|tabletop/` → `plaque`
13. `/canvas|chenille|glitter|foil|handpaint|led[\s_-]*light/` → `canvas`
14. no match → `canvas`
Put the table in one exported array so a test can assert its length and order.
Gate: tests in step 10 green (`npx vitest run src/lib/mockup-tool.test.ts`).

**Step 4 — `buildMockupUrl` v2.** New signature
`buildMockupUrl(opts: { art: string; name?: string | null; route?: MockupRoute; artB?: string | null; nameB?: string | null; fallback?: string | null })`.
Keep a thin overload for the old positional call `(thumbnailUrl, filename)`
→ `{ art, name, route: "canvas" }` so nothing breaks mid-PR, then update the
two call sites and delete the overload in the same PR. Proxy every URL-ish
param (`art`, `artB`, `fallback`) through the existing `toProxyPath` logic
(extract the current try/`new URL` block into `toSpacesPath(url)`), omit
params that are null/empty, and end with `#/<route>`.
Gate: `src/lib/mockup-tool.test.ts` extended (step 10), green; `npm run
typecheck` green.

**Step 5 — `StyleGroupDetailPanel` hero button** (`:467-482`):
- `route = pickMockupRoute([group.item_short_description, group.cover_description, group.item_description, group.product_category])`.
- If `route === "lenticular"`: let `hero = currentThumbAsset`. If
  `hero?.pdf_page2_url` → `art = https://popdam.nyc3.digitaloceanspaces.com/pdf-pages/<hero.id>_p1.jpg`
  (build it from the host of `hero.pdf_page2_url` so the bucket host is not
  hard-coded twice: `new URL(hero.pdf_page2_url).origin + "/pdf-pages/" + hero.id + "_p1.jpg"`),
  `artB = hero.pdf_page2_url`, `fallback = displayThumbnail`. Else `art =
  displayThumbnail`, `artB = thumbStrip.find(a => a.id !== hero?.id)?.thumbnail_url ?? null`.
- Else: `art = displayThumbnail`, no `artB`.
- `name = currentThumbAsset?.filename ?? group.sku`; `nameB` = the B asset's
  filename or `<sku>-B`.
Extract this into a pure helper `buildGroupMockupLink(group, hero, thumbStrip, displayThumbnail)`
in `src/lib/mockup-tool.ts` so it is unit-testable without rendering.
Gate: `StyleGroupDetailPanel.mockup.test.tsx` extended (step 10) green;
dev-server click-through (`npm run dev`, port 8080, tester login §12): a
lenticular group opens the lenticular product with two pictures.

**Step 6 — `AssetDetailPanel`** (`:95-99`): `route = pickMockupRoute([asset.product_category])`
(plus group descriptions if `AssetDetailPanel` already receives the group —
check its props; OPEN in §8). Single `art`, no `artB`.
Gate: typecheck + full suite green.

**Step 7 — docs.** `docs/MOCKUP_TOOL.md`: replace the "Link contract" bullet
with the v2 params (`art`, `name`, `artB`, `nameB`, `fallback`, `#/<route>`),
add one paragraph "How the product is picked" pointing at `pickMockupRoute`
and the rule that the matcher mirrors the tool's `RULES`, and the lenticular
A/B strategy; bump "pop-mock v6.9" wording to 7.4. `AGENTS.md:86`: append
"(auto-match plan: `docs/plans/issue-544-mockup-auto-match.md`)". Root plan:
step 0 line plus STATUS rows updated with the artifacts.
Gate: `grep -n "artB" docs/MOCKUP_TOOL.md` and `grep -n "issue-544" AGENTS.md`
both hit.

**Step 8 — land.** One popdam3 PR for steps 0, 2-7. Locally:
`npm run lint && npm run typecheck && npm test && npm run build`. Open the PR
against `main`, title `feat(mockup): open the matched product with A/B images (#544)`,
body lists the manual gate results from step 1 and the pop-mock merge SHA,
ends with the attribution line from the session's system reminder. Wait with
`ai-pr-wait <pr> --repo u2giants/popdam3` **in the background** (it is on PATH
at `/usr/local/bin/ai-pr-wait`; never a sleep loop). Merge
`gh pr merge <pr> --squash --delete-branch` (the AI merges; Albert does not).
Deploy is automatic (`publish-frontend.yml` → GHCR → Coolify).
Gate: the app header's build stamp on dam.designflow.app shows the merge SHA;
`curl -s https://dam.designflow.app/mockup/ | grep -c 'APP_VERSION="7.4"'` → 1.

**Step 9 — live proof on production** (Playwright MCP, tester login §12). For
each class open one group and click the cube; screenshot the opened tool:
lenticular (two pictures in A/B), clock, framed, canvas, cork or photo frame
(expect the guard → Framed Print + notice, since only a JPG is available),
and an unmatched item (e.g. a hamper/mat → Canvas). Attach screenshots to the
issue comment, tick `- [ ] live proof` on issue #544 (same issue, never a new
one), sign with `$AI_GH_SIGNATURE`, update this plan's STATUS table with the
screenshot paths and SHA.

Phases A and B are independent until step 8 (the PopDAM code can be written
and unit-tested against the 7.3 file; only the lenticular/fallback live
behavior needs 7.4). Context cut point: after step 2 — a fresh session can
start Phase B by re-reading §5 and §8.

### Adversarial-cases table (trust boundary: description text and URLs from the DB/bucket)

| External input | Hostile / odd case | Required behavior | Test (vitest name) |
|---|---|---|---|
| description | "Venom Framed 3D Lenticular" | lenticular (rule 5 before 11) | `pickMockupRoute ranks lenticular above framed` |
| description | "MDF Shadowbox with Die-Cut 3D Layer" | shadowbox (rule 4 before 12) | `pickMockupRoute ranks shadowbox above plaque` |
| description | "Die-cut MDF Photo Frame" | photoframe (rule 7 before 10/12) | `pickMockupRoute sends photo frame to photoframe` |
| description | "Arched Framed Canvas" | shapedcanvas? no — "arch canvas" needs adjacency; expect `framed` (rule 11) unless "arched canvas" literal | `pickMockupRoute treats arched framed canvas as framed` |
| description | "High Gloss Canvas 16x20" | canvas | `pickMockupRoute matches gloss canvas` |
| description | null / "" / "   " | canvas default | `pickMockupRoute defaults to canvas` |
| description | 5 000-char junk, regex metachars `(.*+[` | no throw, canvas | `pickMockupRoute survives junk text` |
| description | "Corkboard 12in" | cork | `pickMockupRoute sends cork to cork` |
| `pdf_page2_url` | has `?v=3` query string | proxied path keeps query | `buildMockupUrl keeps query in proxied path` |
| `pdf_page2_url` | non-URL garbage | passed through unproxied, no throw | `buildMockupUrl passes a non-URL art through` |
| filename | `"a#b&c=d.ai"`, emoji | URL-encoded, round-trips via `URLSearchParams` | `buildMockupUrl encodes hostile names` |
| lenticular group | only one thumbnail asset | no `artB` param | `buildGroupMockupLink sends no artB with one file` |
| lenticular group | hero has `pdf_page2_url` | artB = page 2, art = p1 key on same origin, fallback = thumbnail | `buildGroupMockupLink uses page renders when page 2 exists` |
| art URL (tool) | 404 + `fallback` | fallback loads | manual step 1 gate (not unit-testable here) |
| route + image (tool) | `#/cork` with JPG | Framed Print + notice | manual step 1 gate |

## 10. Tests required

New/extended (vitest; `npx vitest run <file>`):
- `src/lib/mockup-tool.test.ts`: the 11 `pickMockupRoute` / `buildMockupUrl` /
  `buildGroupMockupLink` names in the table above, plus
  `MOCKUP_RULES has 13 entries in tool order` and
  `buildMockupUrl keeps the legacy positional call working` (delete when the
  overload is removed).
- `src/components/library/StyleGroupDetailPanel.mockup.test.tsx`:
  `lenticular group opens the lenticular route with two pictures`;
  `clock group opens the clock route`; existing canvas test stays.
- Existing suites stay green: `npm test` (root), `npm run typecheck`,
  `npm run lint`, `npm run build`. Worker/agent suites are untouched but CI
  runs them (`.github/workflows/ci.yml`).
- Tool: not unit-testable in this repo; the step 1 manual gate list is its
  test; record results and screenshots in the PR body.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`; the AI squash-merges.
  Reviews are advisory and never block.
- No DB changes here; if one ever seems needed, stop — schema goes through
  `popcre/shared-db` (`/worksp/shared-db`, claim-first on its issue, load the
  `shared-db-change` skill). This plan needs none.
- Never edit `public/mockup/index.html` by hand; it is a verbatim copy.
- The vendored file is 4.9 MB: grep for anchors, never open it whole.
- **Never wait on `requestAnimationFrame` in the loader** (background tabs).
- CRLF warnings from git on the HTML are benign.
- Spaces has no CORS; keep every art URL on `/spaces/`.
- Production is read-only by default; this work writes nothing to the DB.
- Times for humans in EST; sign GitHub posts with `$AI_GH_SIGNATURE`.
- Live proof before closing; the `- [ ] live proof` item stays on #544.
- Albert does not click or type anything; the AI runs the browser.
- Lint/typecheck must pass — CI runs `npm run lint && npm run typecheck`.

## 12. Access and environment

- Machine: hetz (production VPS). Canonical checkout `/worksp/popdam` is
  landing-only; create a worktree for the work (step 2).
- `gh` is authenticated as `u2giants`; `ai-pr-wait`, `ai-task-gates` on PATH.
  Declare the class with `ai-task-gates` (code; ui-live-workflow for step 9).
- Playwright MCP (`mcp__playwright__*`) for the tool gate and live proof.
- Test login: 1Password vault `vibe_coding`, item
  **"DAM AI tester login - PopDAM (designer, dam.designflow.app, production)"**
  (email + password fields; sign-in page, not Microsoft). Never paste values.
- Supabase URL + publishable key are public in `public/dam-config.json`.
- Local dev: `npm ci && npm run dev` (port 8080, `/spaces` proxy included).
- pop-mock: clone fresh under `$TMPDIR`; serve with `python3 -m http.server`.

## 13. Definition of done, risks, open questions

Done when: STATUS rows 0-9 cite artifacts (pop-mock merge SHA, popdam3 PR
number + merge SHA, CI run id, screenshot paths); production serves
`APP_VERSION="7.4"`; live proof covers lenticular A/B, clock, framed, canvas,
guard redirect and unmatched; `docs/MOCKUP_TOOL.md`, `AGENTS.md`, root plan
updated; #544's live-proof checkbox ticked with evidence; the handoff file
linked above records the outcome.

Risks: (a) p1 render missing for older PDFs → `fallback`; (b) pop-mock main
moves during the work → re-vendor the latest release, re-run the step 1 gate;
(c) the 7.3 `RULES` order changes in a later pop-mock release → the matcher
table has a length/order test that will fail loudly on re-vendor review (the
test cannot see the tool; the implementer re-diffs `RULES` on every vendor);
(d) `cork`/`shapedcanvas` may accept flat images → guard set shrinks (§8).
Rollback: revert the squash commit; the previous image redeploys.

Open questions: none blocking; §8 OPEN items have defaults.

## Self-audit

1. **Could a fresh session execute this without asking anything?** Yes — §2,
   §5 and §12 give every path, line number, SHA, CLI and login location; each
   step in §9 has a gate; the tool's new loader behavior is specified
   param-by-param with the exact test URLs.
2. **Does it carry every piece of background including rejections?** Yes —
   §6 records the 7.3 discoveries (loader location, 11 products, `RULES`
   order), §7 adds three new rejections to the root plan's five, §8 dates
   every locked decision and lists the open ones with defaults.
3. **Is the goal stated clearly enough to steer a wrong step?** Yes — §1 names
   the user-visible outcome per product class, cites the lines that make
   today's behavior wrong, and carries the stop-and-flag rule.
