# Product Mockups tool (item-page integration)

The **Create product mockup** button on an asset's detail panel opens the
Product Mockups tool in a new tab with that asset's thumbnail already loaded.

- **Tool file:** `public/mockup/index.html` — vendored single-file app, served
  verbatim by nginx at `/mockup/`. Do not edit it here.
- **Source of truth:** [`u2giants/pop-mock`](https://github.com/u2giants/pop-mock)
  (`Product Mockups.html`). To upgrade: copy the new release file over
  `public/mockup/index.html` in the same PR that lands it in pop-mock.
- **Link contract:** `?art=<image url>&name=<file name>` plus a `#/<product>`
  route (added in pop-mock v6.9). `src/lib/mockup-tool.ts` builds the URL.
- **Image access:** the tool reads pixels, so the thumbnail is served same-origin
  through the nginx `/spaces/` proxy (`nginx.conf`; Vite dev proxy in
  `vite.config.ts` mirrors it). No Spaces bucket CORS configuration is needed.
- **Limitation:** the asset thumbnail (800 px JPEG) drives the mockup, not the
  original PSD/AI. For a final high-res mockup, open the source file in the tool
  directly (drag-and-drop).
