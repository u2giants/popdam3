---
summary: Item-page product mockup integration: buttons, link params and product auto-matching; pop-mock releases vendor in automatically.
kind: living
status: current
read-when: changing the mockup tool or its auto-match
---

# Product Mockups tool (item-page integration)

The **Create product mockup** button on an asset's or item's detail panel opens
the Product Mockups tool in a new tab with the right product and the right art
already placed.

- **Tool file:** `public/mockup/index.html` — vendored single-file app, served
  verbatim by nginx at `/mockup/`. Do not edit it here.
- **Source of truth:** [`u2giants/pop-mock`](https://github.com/u2giants/pop-mock)
  (`source/` + `Product Mockups.html`). Vendoring is **automatic**: merging a
  pop-mock release to its `main` fires its `sync-popdam.yml` workflow, which
  copies the release over `public/mockup/index.html`, pushes to this repo's
  `main`, and waits until dam.designflow.app serves the new version.
- **Link contract (pop-mock 7.4+):** `?art=<image url>&name=<file name>` plus
  `&artB=&nameB=` (second picture — fills lenticular windows A and B),
  `&fallback=` (backup URL tried when `art` fails), and a `#/<product>` route.
  `src/lib/mockup-tool.ts` builds the URL. In the tool, a flat image linked
  into Shadowbox / Shaped Frame / MDF Die-Cut (which need the layered `.ai`)
  opens Framed Print with a notice instead.
- **Product matching:** `pickMockupRoute()` in `src/lib/mockup-tool.ts` maps
  the item's description keywords to a product route — lenticular first, then
  shadowbox, clock, framed, canvas, stager, shaped, mdf/die-cut; unmatched
  items keep Canvas. The item flyout matches on `item_short_description`,
  `cover_description` and `item_description`; the file flyout only matches
  `product_category` "Clock" (asset rows carry no item description).
- **Lenticular A/B:** when the hero asset has `pdf_page2_url`, A = the
  deterministic `pdf-pages/<assetId>_p1.jpg` render, B = that `pdf_page2_url`
  (thumbnail as `fallback`); otherwise A = the hero thumbnail and B = the next
  thumbnail-bearing asset in the carousel.
- **Image access:** the tool reads pixels, so art URLs are served same-origin
  through the nginx `/spaces/` proxy (`nginx.conf`; Vite dev proxy in
  `vite.config.ts` mirrors it). No Spaces bucket CORS configuration is needed.
- **Limitation:** thumbnails and PDF page renders (800 px / hi-res JPEGs)
  drive the mockup, not the original PSD/AI. For a final mockup from the
  source file, open it in the tool directly (drag-and-drop).
