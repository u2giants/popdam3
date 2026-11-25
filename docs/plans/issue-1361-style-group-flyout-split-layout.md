---
summary: Issue #1361 plan: wide Style Group flyout fixes (pinned actions, bounded thumbnails, width fits screen, tests, doc). Read STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-1361, StyleGroupDetailPanel split layout, flyout width, detail panel resize
---

# Plan: Wide Style Group flyout — keep actions in view and fit the screen (u2giants/popdam3#1361)

Issue: https://github.com/u2giants/popdam3/issues/1361 (review finding on merged PR u2giants/popdam3#1360 "Flyout panel: open wider, split layout, fewer scroll bars", merged 2026-11-25)
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS — 2026-11-25

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Split mode: footer (Download all / Open folder) pinned below a scrolling left column | ⬜ open | — |
| 2 | Thumbnail strip height bounded | ⬜ open | — |
| 3 | Remove the unreachable 3-column branch | ⬜ open | — |
| 4 | Older copies: back to "selected file, or the only file" | ⬜ open | — |
| 5 | Docked panel width capped so the list keeps 400 px | ⬜ open | — |
| 6 | Split-mode tests | ⬜ open | — |
| 7 | `docs/UI_OVERVIEW.md` updated | ⬜ open | — |
| 8 | PR, CI, merge, deployed SHA verified | ⬜ open | — |
| 9 | Visual verification on dam.designflow.app (4 viewport/width cases) | ⬜ open | — |

A fresh session starts at step 1. Steps 1–5 touch the same two files; do them in order in one branch.

## Part 1 — Why

### 1. The ultimate goal
When someone opens a style group in the Library, the side panel (the
"flyout") shows the art, its details, and the **Download all / Open folder**
buttons without the buttons ever scrolling away, without a wall of
thumbnails pushing everything down, and without squeezing the art list off
the screen — on a laptop and on a big monitor, with or without the filter
sidebar open. *If a step conflicts with this goal, the goal wins — stop and
flag it.*

### 2. What this application is
PopDAM (`u2giants/popdam3`, branch `main`) — POP Creations' internal art
library at https://dam.designflow.app (React + Vite + Tailwind + shadcn in
`src/`, deployed by `publish-frontend.yml` → GHCR → Coolify). A **style
group** is one product (SKU) with its art files. The Library page is
`src/pages/Index.tsx`; the group flyout is
`src/components/library/StyleGroupDetailPanel.tsx`.

### 3. What triggered this work
PR #1360 (merged 2026-11-25 17:26 UTC) made the flyout open at 900 px and,
at widths ≥ 720 px, split into a left preview column and a right tabs
column. The advisory reviewer then found seven problems, all still true on
`origin/main` `787c20b8`:

1. **Footer scrolls away** — `StyleGroupDetailPanel.tsx:1361-1370`: in split
   mode `footerEl` sits inside `<aside className="… overflow-y-auto">`, so
   when hero + thumbs + title overflow, the action buttons scroll out of
   view. Before #1360 the footer was always visible.
2. **Unbounded thumbnail strip** — `:511-517` `flex flex-wrap` with no
   max-height; 20–50 files make 5–7 rows (~300 px) in both modes.
3. **Dead 3-column branch** — `:68-72` `contentCols === 3` needs
   `contentWidth ≥ 900`, i.e. panel ≥ ~1340 px, but `DETAIL_MAX_WIDTH = 1280`
   (`src/pages/Index.tsx:35`).
4. **Older copies always shown** — `:1199-1205` picks `selectedAssetId ??
   localPrimaryId ?? orderedAssets[0]?.id`, so the admin-only Older copies
   section mounts (extra query) on every open. PR #1331 (the feature) said
   "for the selected file (or the only file)".
5. **Docked width overflows** — `Index.tsx:36,56-70`: default 900 docked at
   the 1400 px breakpoint leaves ~500 px for the list (`min-w-[400px]` at
   `:265`); with `FilterSidebar` open the row exceeds the viewport. Only the
   overlay path is clamped.
6. **No split-mode tests** — `StyleGroupDetailPanel.mockup.test.tsx:93`
   renders only `width={420}`.
7. **Doc drift** — `docs/UI_OVERVIEW.md:210-218` still says range `[360,
   960]`, key `pd-detail-panel-width`, `WIDE_THRESHOLD 620`; code is `[360,
   1280]`, `pd-detail-panel-width-v2`, `SPLIT_THRESHOLD 720`.

### 4. Scope
In: the seven items above. **NOT in this plan:** the single-asset panel
(`AssetDetailPanel`); changing the 900 default, the 720 split threshold or
the 1280 max (the owner-approved "open wider" outcome stays); PopSG panels;
the Files-tab grid design; the mockup button.

## Part 2 — What we already know

### 5. Current state
- `StyleGroupDetailPanel.tsx`: `SPLIT_THRESHOLD = 720` (:42); `split`,
  `leftWidth = min(440, max(300, round(width*0.38)))`, `contentWidth`,
  `contentCols` (:68-72); `thumbsEl` (:511); multi-column content using
  `contentCols` (:657-661); Older copies IIFE (:1199-1205); `footerEl`
  (:1290); split/stacked layout (:1359-1385).
- `Index.tsx`: `DETAIL_MIN_WIDTH 360`, `DETAIL_MAX_WIDTH 1280`,
  `DETAIL_DEFAULT_WIDTH 900` (:34-36); `useResizablePanel({storageKey:
  "pd-detail-panel-width-v2", …})` (:56-65); overlay clamp (:68-70); list
  container `min-w-[400px]` (:265); `FilterSidebar` (resizable, key
  `library-filter-sidebar-width`, `src/components/library/FilterSidebar.tsx:45-47`).
- `src/hooks/useResizablePanel.ts` clamps to `[min, max]` and re-clamps when
  `min`/`max` change (:42-45) — so passing a smaller dynamic `max` shrinks
  the width automatically.
- Nothing started; no branch.

### 6. Key findings
- Item 1 is purely structural: move `footerEl` out of the scrolling element.
- Item 5: because `useResizablePanel` re-clamps on `max` change, the fix is
  to compute `max` from the real available row width rather than a constant.

### 7. Rejected approaches
- **`position: sticky` footer inside the aside** — works but leaves the
  footer overlapping content on short screens; a non-scrolling flex child is
  simpler. Rejected.
- **Raise `DETAIL_MAX_WIDTH` to make 3 columns reachable** — the owner asked
  for wider, not huge; a 1340 px panel leaves no list on most monitors.
  Rejected; remove the branch.
- **Revert the thumbnail strip to one horizontal scroll row** — PR #1360
  deliberately wrapped them ("fewer scroll bars"). Keep wrap, cap height.
- **Clamp docked width to `window.innerWidth - 400 - 260`** (guessed sidebar
  width) — sidebar is resizable; a guess breaks. Measure instead.

### 8. Design decisions
- **Locked:** split layout = `<aside className="flex shrink-0 flex-col
  overflow-hidden">` containing `<div className="min-h-0 flex-1
  overflow-y-auto">{heroEl}{thumbsEl}{titleEl}</div>{footerEl}`.
- **Locked:** thumbnail strip keeps `flex-wrap`, adds `max-h-[7.5rem]
  overflow-y-auto` in split mode (≈2 rows of `h-11`), `max-h-[5rem]` in
  stacked mode (≈2 rows of `h-9`).
- **Locked:** `contentCols = contentWidth >= 520 ? 2 : 1`.
- **Locked:** Older copies target = `selectedAssetId ?? (orderedAssets.length
  === 1 ? orderedAssets[0].id : null)` — the #1331 rule.
- **Locked:** in `Index.tsx`, measure the flex row containing the list +
  panel with a `ResizeObserver` (ref on the row; include the sidebar since it
  is in the same row) and pass `max = max(DETAIL_MIN_WIDTH,
  min(DETAIL_MAX_WIDTH, rowWidth - sidebarWidth - 400 - handleWidth))` to
  `useResizablePanel`. Simplest correct form: observe the **list container**
  itself is not enough (it is what shrinks) — observe the row and read the
  sidebar element's `offsetWidth` via a ref.
- **Open:** exact max-height values may be tuned ±1 row during visual
  verification if two rows look cramped; record the final values in the doc.

## Part 3 — How to build it

### 9. Steps
**Step 1 — Footer out of the scroll.** `helper-ok` (exact JSX given in §8).
Stop-and-ask: if `heroEl` relies on the aside being the scroll container
(e.g. sticky hero). Edit `StyleGroupDetailPanel.tsx:1361-1370`. Update the
comment to "Left: preview, thumbnails and title scroll; the action buttons
stay pinned below them." Gate: step 6 test `split mode keeps the footer
outside the scrolling column`.

**Step 2 — Bound thumbnails.** `helper-ok`. Stop-and-ask: none. Add the §8
classes to the `cn(...)` at `:515-518` keyed on `split`. Gate: step 6 test
`thumbnail strip is height-bounded`.

**Step 3 — Remove 3-col.** `helper-ok`. Stop-and-ask: if `contentCols` is
read anywhere expecting 3. Edit `:72`; check `:657-661` still compiles.
Gate: `npm run typecheck`.

**Step 4 — Older copies rule.** `lead-only` (behaviour choice that the
reviewer flagged as diverging from Overview; check `detailAsset` vs
`selectedAssetId` interplay by reading the component). Edit `:1199-1205`.
Gate: step 6 tests.

**Step 5 — Docked width cap.** `lead-only` (layout logic across viewport,
sidebar, hook; easy to get subtly wrong). Implement §8 in `Index.tsx`; keep
the overlay path unchanged. When rowWidth is unknown (first render) use
`DETAIL_MAX_WIDTH`. Gate: step 9 cases B and C.

**Step 6 — Tests.** `helper-ok`. Stop-and-ask: if jsdom can't render the
split branch. Add to a new
`src/components/library/StyleGroupDetailPanel.split.test.tsx` (copy setup
from `StyleGroupDetailPanel.mockup.test.tsx`), rendering `width={900}`:
- `split mode renders the close button in the tab bar` (:634-642).
- `split mode keeps the footer outside the scrolling column` (Download all
  button's closest `[class*=overflow-y-auto]` is not an ancestor).
- `thumbnail strip is height-bounded` (has `max-h-` class) with 30 assets.
- `split content uses two columns` (`columnCount: 2` style present).
- `Older copies shows only for the selected or only file` (1 asset → shown;
  3 assets, none selected → not shown; select one → shown). Mock
  `OlderCopiesSection` to a stub.
Gate: `npx vitest run src/components/library/StyleGroupDetailPanel.split.test.tsx` green.

**Step 7 — Doc.** `helper-ok`. Stop-and-ask: none. Rewrite
`docs/UI_OVERVIEW.md:204-225` bullets: range `[360, 1280]` capped to leave
the list 400 px; key `pd-detail-panel-width-v2`; default 900; `SPLIT_THRESHOLD
720` split layout (left preview column 300–440 px with pinned actions;
right tabs); two-column content when right side ≥ 520 px; thumbnail strip
bounded height. Gate: doc matches constants (grep).

**Step 8 — Land.** `lead-only`. Branch `claude/issue-1361-flyout-fit`, PR, CI
green, AI merges; Coolify serves SHA (`/version.json`).

**Step 9 — Visual verification.** `lead-only` (visual judgment). On
https://dam.designflow.app, open a style group with ≥30 files and a long
title, screenshot each case:
- A: 1920×1080, sidebar closed, panel 900 — footer visible, thumbs ≤2 rows
  then scroll, two-column overview.
- B: 1440×900, sidebar open — list still ≥400 px, no horizontal page
  scrollbar, panel shrank.
- C: drag panel to max on 1920 — list keeps 400 px.
- D: 1280×800 (overlay mode) and panel 480 (stacked) — footer visible,
  thumbs bounded.
- E: admin, 3-file group, no file selected → no Older copies; select a file
  in Files tab → Older copies appears.
Save to `docs/verification/issue-1361/` and cite in STATUS.

### 10. Tests
New: the five tests in step 6. Must stay green:
`StyleGroupDetailPanel.mockup.test.tsx`, `OlderCopiesSection.test.tsx`,
`npm test`, `npm run typecheck`, `npm run lint` (the PR #1360 body notes 9
pre-existing unrelated test failures on main — compare against main, don't
fix them here).

### 11. Constraints and gotchas
- Branch + PR; AI merges; reviews advisory.
- Keep the `1400px` breakpoint in sync with the `max-[1399px]:` overlay
  classes (UI_OVERVIEW.md note).
- Don't change the storage key — bumping it resets everyone's saved width
  again.
- `useCompactChrome()` caps the hero at 26vh on short screens — keep it.
- UI work requires screenshots before closing.

### 12. Access and environment
`gh` as `u2giants`. Local: `npm run dev` → http://localhost:8080/library.
Login: 1Password `vibe_coding`, search "PopDAM" (an admin login is needed
for case E). Browser automation: the in-app browser or Playwright MCP; set
viewport sizes per case.

### 13. Done, risks, open questions
Done: steps 1–9 ✅ with artifacts; PR merged; SHA live; issue #1361
commented with screenshots and closed.
Risks: ResizeObserver loop warnings — guard with `requestAnimationFrame`.
Rollback: revert PR.
Open: none for the owner.

## Self-audit
1. Executable without questions? Yes — §5 lines, §8 exact JSX/rules, §9 gates.
2. Background and rejected paths carried? Yes — §3 all seven findings, §7 four rejections.
3. Goal clear? Yes — §1: buttons always visible, list never squeezed off screen.

## Lead launch prompt
```
You are the lead for u2giants/popdam3 issue #1361. Read AGENTS.md, then
docs/plans/issue-1361-style-group-flyout-split-layout.md (STATUS first).
Hand steps 1, 2, 3, then 6 and 7 to your helper; do steps 4, 5, 8 and 9
yourself. Your helper is your own tool's smaller model — Haiku (high
effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo
Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design
decisions, never merges or posts, asks you when a stop-and-ask trigger
fires, and is taken back after 30 minutes stuck. You run every gate, merge,
verify the deployed SHA, and take all screenshots.
```
