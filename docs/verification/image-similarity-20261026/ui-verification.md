# Image similarity — UI live verification (2026-10-26)

Tracking issue: [#486](https://github.com/u2giants/popdam3/issues/486).
Verified on production `https://dam.designflow.app` (frontend bundle
`Index-BjIDepIR.js`, PR #505 merge `068063bf`) with a real signed-in
designer session (AI tester login), headless Chrome 1600×1000.

## Flow verified

1. Sign in → `/library` loads.
2. The **Find by picture** button appears in the Library top bar (hidden
   entirely while `IMAGE_SIM_ENABLED` is false — it appeared after the flag
   flip with no redeploy, proving the flag read).
3. Clicking it opens the drop strip: *"Drop an image here or click to
   browse — matches at 90%+ appear below"* (drag-drop and file picker both
   wired to the same hidden `input[type=file]`).
4. Uploading a real library thumbnail drives the edge function
   (`action=search` → poll `query-status`) and renders the results card:
   header read **"Find same artwork | 4 matches at 90%+"** with banded
   match cards (percentages observed: 100.0 %, 100.0 %, 100.0 %, 100.0 %).

## Named screenshots (this folder)

- `library-drop-zone-open.png` — top bar with the drop strip open.
- `library-results-card.png` — results card with banded matches.

## Rejected/edge states

- No session → edge 401 (verified); service-key callers are refused
  (user-session required); while disabled the whole surface hides (410 from
  the edge, button absent in UI).
- Oversize (>15 MB) → client blocks; edge 413; poller permanently rejects
  bombs/animations/unsupported containers (13 pytest cases on edge-dev).
