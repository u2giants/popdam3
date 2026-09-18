# #2530 Step 6 — consumer sync after the popcre transfer (2026-09-18)

- Identity PR #3254 merged as `2f204a481270808eef752a6dc0f716c6b9f81159`; fixture PR #3256
  merged as `08f9a83ad35d9a56bc7c57f169042c77382afc98`.
- Both were merged by the guarded merge lane, which pushes as `github-actions`. GitHub does not
  start push workflows for pushes made with the workflow token, so `sync.yml` did not run for
  either merge. The last sync before this note ran on `262209fa` (PR #3260, merged by `u2giants`).
- This note is merged by `u2giants`, so its push to `main` starts `sync.yml` with the full
  post-transfer tree. The run ID and the nine consumer results are recorded on #2530.
- Consequence for later steps: any change landed by the guarded lane reaches consumers only on
  the next non-bot push to `main`. Tracked on #2530.
