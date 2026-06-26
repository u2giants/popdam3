# POP DAM Helper — Photoshop plugin

Detects when you **close** a checked-out file in Photoshop and tells the POP DAM
Helper, which then offers to check the file back in. Photoshop-only (Illustrator
has no document-close event for plugins).

## How it works
- The plugin keeps a live map of open document IDs → file paths.
- On a document `close` event it POSTs `{ event: "documentClosed", path }` to the
  running Helper at `http://127.0.0.1:47380/editor-event`.
- The Helper matches that path to an active checkout that has un-checked-in edits
  and pops "Check it in now?".

## Install (pilot / development)
The plugin is **unsigned**, so it can't be distributed through Creative Cloud.
Load it with Adobe's **UXP Developer Tool (UDT)**:

1. Install **UXP Developer Tool** from the Creative Cloud app (free).
2. Open UDT → **Add Plugin** → select this folder's `manifest.json`.
3. Select the plugin row → **Load**. (Photoshop must be running.)
4. In Photoshop: **Plugins → POP DAM Helper** to show the panel. The panel
   shows "Connected to POP DAM Helper" when the Helper is running.

`manifest.json` lives inside the installed Helper at:
- **Windows:** `…\resources\photoshop-plugin\manifest.json`
- **macOS:** `POP DAM Helper.app/Contents/Resources/photoshop-plugin/manifest.json`

The Helper's Settings has a **"Reveal Photoshop plugin folder"** button that opens
this location for you.

## Notes / limitations
- Requires Photoshop 23.0+ (UXP).
- A fully silent auto-install isn't possible for an unsigned UXP plugin; UDT
  sideload is the supported path for the pilot.
