# Merge-queue canary — 2026-10-15

Docs-only canary for issue #2530 Step 9. This pure-prose pull request
exercises GitHub's native merge queue after the authorized-head gate fix
landed in #4363.

Success means: at least one `merge_group` workflow run, required contexts
green on the synthetic SHA, and GitHub merges the PR through the queue
(not Guarded Merge direct).

Posted by MiMo chat ffe5ec4d8a438ffeMsuIzWTbV4 on edge-dev
