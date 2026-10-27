---
status: OPEN — plan only, no implementation started
owner: zcode-chat@EDGE-DEV
---

# Mockup auto-match — implementation plan open, nothing built yet

Facts checked 2026-10-27 ~9:35 AM EST. Albert approved the feature
("match the item to the right mockup product and insert the right images
automatically") and asked for a plan.

## What this session did

Investigated feasibility, sampled production data for the matching source
(style group descriptions carry the product vocabulary), and wrote the full
implementation plan:

**→ [plan_mockup_auto_match.md](../plan_mockup_auto_match.md) — read its
STATUS table first; all rows are open.**

## Exact state

- Tool (pop-mock `main` @ 6e51117): v6.9 link-loading live; supports one
  linked image, explicit `#/route` wins, image art opens in Canvas. No
  artB/fallback/image-guard yet.
- popdam3 `main` @ 99d0a10f: cube buttons live on both flyouts
  (StyleGroupDetailPanel hero + AssetDetailPanel), always `#/canvas`,
  single image (`src/lib/mockup-tool.ts`). Production build c073983 + later
  doc merges.
- No branches/worktrees carry any auto-match code. The plan's Phase A/B
  steps have not been started.

## Successor instructions

Start at plan step 1 (pop-mock v6.10 loader), following the plan file
verbatim. Do not re-derive the matching source or the A/B strategy — both
are LOCKED decisions (plan §8) with evidence in §6.

## Traps already paid for (do not repay)

- Tool loader must never await `requestAnimationFrame` (background tabs).
- Spaces bucket has no CORS — all art goes through the `/spaces/` proxy.
- Vendored `public/mockup/index.html` is never edited in place; sync from
  pop-mock releases only.
- UI automation: open flyouts in a fresh tab; fought-over tabs accumulate
  selection state.
