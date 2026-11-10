---
issue: 804
status: OPEN
owner: claude/close-nested-search
---

# Handoff — search accuracy work closed; three advisory review findings carry forward

Written 2026-11-10 5:31 PM EST by Claude (hetz), closing a coordinator session
and its three nested sessions. The search work itself is **finished and live**.
This file carries only three unresolved advisory review findings on the changes
that work shipped. Retire this file when issues
[883](https://github.com/u2giants/popdam3/issues/883),
[888](https://github.com/u2giants/popdam3/issues/888) and
[897](https://github.com/u2giants/popdam3/issues/897) are all closed.
Coordination record: [issue 804](https://github.com/u2giants/popdam3/issues/804).

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner.

Already settled — do NOT re-ask:

- **2026-11-10, Albert: "Keep all five."** When someone searches a character's
  name in the style-guide library (PopSG), the guide named for that character
  comes first and guides that merely contain the character stay listed after
  it. They are not hidden. The PopSG guides test passes on order (named guide
  first). Recorded in
  [docs/SEARCH_EVAL.md](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md).
- **2026-11-01:** DC and Harry Potter are properties of Warner, never licensors.
- **2026-10-29 / 2026-10-30:** reviews are advice only and never block a merge;
  only checks that stop production-data damage or secret leaks may block.

## 1. What this application is

PopDAM (`u2giants/popdam3`, live at https://dam.designflow.app) is POP
Creations' digital asset manager: designers search product artwork ("style
groups"). PopSG (https://sg.designflow.app, same repository and database) is
the licensor style-guide library. Both sit on one shared Supabase database
whose structure lives in `popcre/shared-db` and reaches production only through
that repository's automatic promotion. Search runs through the edge function
[`dam-search-ai`](https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts)
and, for PopSG, the database function `search_style_guide_library_v2`. Picture
and text indexing is done by a GPU worker (`PopDAM-ImageEmbedWorker`) on the
Windows PC `edge-dev`.

## 2. What we set out to do, and why

Albert asked on 2026-11-09 where "reliable, accurate semantic search for
library items" stood. The answer became a chain of approved fixes: restart the
stopped indexing worker and make it self-restart and alarm; measure the search
people actually use; fix every judged miss in PopSG and PopDAM.

## 3. Current state — what is true right now

All verified against GitHub and live runs at 5:30 PM EST 2026-11-10.

- **Scores (judged set version `2026-11-10c`):** PopDAM 119/119, PopSG guides
  65/65, PopSG files 65/65. Accepted "Search test set" runs on `main`:
  [42880755816](https://github.com/u2giants/popdam3/actions/runs/42880755816),
  [42886160926](https://github.com/u2giants/popdam3/actions/runs/42886160926),
  [42888083280](https://github.com/u2giants/popdam3/actions/runs/42888083280).
- **Indexing:** worker restarts itself (boot trigger plus five-minute repeat,
  kill drill passed 10:35 PM EST Nov 9); the Production Canary alarms when its
  heartbeat goes stale. Backlog of 27,870 documents drained by 12:05 AM EST
  Nov 10.
- **Issues closed:** [887](https://github.com/u2giants/popdam3/issues/887),
  [892](https://github.com/u2giants/popdam3/issues/892).
- **Landed (all merged, deploys verified):** popdam3 PRs
  [881](https://github.com/u2giants/popdam3/pull/881),
  [882](https://github.com/u2giants/popdam3/pull/882),
  [884](https://github.com/u2giants/popdam3/pull/884),
  [885](https://github.com/u2giants/popdam3/pull/885),
  [886](https://github.com/u2giants/popdam3/pull/886),
  [890](https://github.com/u2giants/popdam3/pull/890),
  [894](https://github.com/u2giants/popdam3/pull/894),
  [896](https://github.com/u2giants/popdam3/pull/896),
  [898](https://github.com/u2giants/popdam3/pull/898),
  [899](https://github.com/u2giants/popdam3/pull/899),
  [909](https://github.com/u2giants/popdam3/pull/909),
  [910](https://github.com/u2giants/popdam3/pull/910); shared-db PRs
  [5999](https://github.com/popcre/shared-db/pull/5999) and
  [6003](https://github.com/popcre/shared-db/pull/6003), both in production.
- **Not started:** the three open tasks below. No code for them exists on any
  branch.
- **Claims:** none. `ai-shared-db-closeout-check` passed for the coordinator
  and both database-touching children (zero owned claims or stages).

### Tree closed

| Session | Final state | Branch disposition |
|---|---|---|
| Coordinator (this file's author) | closed | `claude/handoff-887`, `claude/search-eval-guides-rule` merged and deleted from GitHub |
| "Fix last style-guide search miss (issue 887)" | closed, nothing open, no handoff | `claude/recursing-taussig-afd186` merged (PR 896) |
| "Repair failing tests on popdam3 main" (started by the 887 session) | closed, nothing open, no handoff | merged (PR 910), branch deleted |
| "Clear PopDAM's last search miss (com-075)" | closed, nothing open, no handoff | `claude/hungry-villani-86e8b5` merged (PR 894), remote branch deleted |

### Child handoffs

None. Every child reported its workstream closed with no handoff file. The 887
handoff written earlier was retired by PR 899.

## 4. Everything we tried that did NOT work

- **Scoring the old path.** The test harness first measured PopSG's retired
  keyword-only search, not the meaning-assisted path the page uses; early PopSG
  scores were wrong until PR 882 made
  [run.mjs](https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/run.mjs)
  call the same `popsg-query-embedding` step as the page.
- **Probing before every search.** PR 882's first form of the PopSG
  empty-result retry ran an extra lookup on every first page and only on the
  first page. It doubled first-page work and broke paging. PR 885 replaced it:
  retry only after an actually-empty first fetch, on any page.
- **Alphabetical tie-break for spelling.** The nearest-known-word fallback
  picked a joined two-word name over the obvious single name on a tie; PR 884
  prefers a whole known name.
- **Bulk re-judging with `label.py`.** It wrongly failed two PopDAM cases. Only
  the PopSG legs of that judging pass were saved; PopDAM judgments were left
  untouched.
- **Scoring right after an edge release.** A run started within minutes of a
  release hits the old instance. A run counts only if it starts more than five
  minutes after the last edge release with no release and no other scored run
  during it (documented in
  [docs/SEARCH_EVAL.md](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md)).
- **Reading speed from one run.** End-to-end p95 varied 2880–5492 ms across
  eight runs on Nov 10 from shared-database load alone. One run cannot confirm
  or rule out a small slowdown.

## 5. Root causes and key findings

- Indexing stopped Nov 6 11:19 AM EST because the worker's scheduled task ran
  only in an interactive sign-in; it is now registered to run without one
  ([worker README](https://github.com/u2giants/popdam3/blob/main/apps/image-embed-worker/README.md)).
- PopSG requires every typed word to match, so one extra or misspelt word
  emptied the page. Fix: `zeroResultFallback` in
  [popsg-query-embedding.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/popsg-query-embedding.ts),
  plus (issue 887) the database function lists a known name's files after the
  all-word matches.
- PopDAM's last miss (case `com-075`): a search naming a licensor plus a
  product form was padded with other licensors' look-alikes matched by picture
  alone. Fix: picture-only matches must belong to the named licensor
  ([named-licensors.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/named-licensors.ts),
  shared-db PR 6003).
- `POPSG_SEARCH_MODE` is `hybrid`, meaning name expansion only; picture vectors
  are not used for PopSG text search.

## 6. Open tasks — exact next steps

Three independent tasks; no dependency order, no shared files. Each is an
advisory review finding the automatic fixer deferred to the source owner.
Findings are advice: confirm each point against current `main` before changing
anything, fix what is real, and say on the issue which points were not real.

### Task 1 — issue 883: confirm the PopSG empty-result retry findings are resolved

- **Goal:** close [issue 883](https://github.com/u2giants/popdam3/issues/883)
  (review of PR 882).
- **State:** findings 1 (retry broke on later pages) and 2 (duplicate
  first-page lookup) were addressed by PR 885 after the review was written; not
  yet re-checked against the finding text. Finding 3 (minor:
  `zeroResultFallback` never considers the full typed phrase as a known name,
  because the phrase loop starts at `words.length - 1`) is untouched.
- **Next action:** read the finding; confirm 1 and 2 against
  [PopSGLibraryPage.tsx](https://github.com/u2giants/popdam3/blob/main/src/pages/popsg/PopSGLibraryPage.tsx)
  (`fetchPopSGV2Page`); decide finding 3 by test — note the fallback is only
  used after an empty search, and a full phrase that is a known name is the
  query that already ran, so "not a defect" is a legitimate outcome if a test
  shows it. Add a multi-page regression test for the retry if none exists.
- **Done when:** issue 883 is closed with a comment stating each finding's
  disposition; if code changed, a PR is merged and an accepted "Search test
  set" run on `main` still shows PopSG 65/65 guides and 65/65 files.
- **Resume from:** fresh from `main`.

### Task 2 — issue 888: tighten the PopSG guides pass rule in the scorer

- **Goal:** close [issue 888](https://github.com/u2giants/popdam3/issues/888)
  (review of PR 886).
- **State:** in
  [score.mjs](https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/score.mjs)
  a `sg_guides` case passes as soon as `first_relevant_rank === 1`. Reported:
  (1) that early return skips the `must_find` recall check; (2) it applies to
  every case kind though the docs scope it to non-code, non-nonsense cases;
  (3) it tolerates any result after rank 1, while the owner ruling covers only
  guides that contain the character.
- **Next action:** for (1) and (2), keep the order rule but still run the
  `must_find` check and limit the rule to the documented kinds; add unit tests
  in
  [score.test.mjs](https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/score.test.mjs)
 . For (3), the judged set has no
  "contains the character" label, so either add one or make
  [docs/SEARCH_EVAL.md](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md)
  say plainly that the test checks order only; do not re-ask Albert — "Keep all
  five" stands and this is a measurement choice.
- **Done when:** issue 888 closed; PR merged; an accepted "Search test set" run
  on `main` reports PopSG guides with the corrected rule. If the count drops
  below 65/65, that is a real result: report the failing case IDs on issue 804,
  do not loosen the rule to restore the number.
- **Resume from:** fresh from `main`.

### Task 3 — issue 897: harden PopDAM's named-licensor picture scoping

- **Goal:** close [issue 897](https://github.com/u2giants/popdam3/issues/897)
  (review of PR 894).
- **State:** finding 1 (no database support) was true at review time and is
  resolved by shared-db PR 6003, now in production — but the reviewer's
  follow-on point still needs proof: the scope must apply to picture-only
  matches and leave keyword matches untouched, with a database-side test.
  Open: (2) licensor detection matches only `core.licensor.name`, not the
  recorded aliases in `core.licensor_alias`, so a search typed with an alias is
  not scoped; (3) the picture-score floor comes from the unscoped best match,
  so another licensor's picture can raise it — actual result loss unverified;
  (4) the licensor-name lookup is awaited with a 1,000 ms timeout on the search
  path — latency impact unmeasured; (5) the unit test's `beforeEach` resets
  neither its licensor state nor the module cache.
- **Next action:** verify finding 1's keyword-leg contract in
  `popcre/shared-db` (read-only first; any structural change starts there with
  the `shared-db-change` skill, claim-first). Then in popdam3: load aliases in
  [named-licensors.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/named-licensors.ts),
  measure (3) and (4) before changing them, fix the test isolation in
  [index.test.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.test.ts).
- **Done when:** issue 897 closed with each finding's disposition; an
  alias-typed licensor-plus-product search is scoped live; two accepted "Search
  test set" runs on `main` still show PopDAM 119/119 with p95 under 3 s.
- **Resume from:** fresh from `main`.

## 7. Constraints and gotchas in force

- Never push to `main`; branch, PR, merge it yourself. Reviews are advice only.
- Licensed names, product codes and file IDs never go in this public
  repository, its issues or reports — case IDs and counts only. Raw harness
  output stays private under the session's temporary directory.
- Database structure changes only through `popcre/shared-db` and its automatic
  promotion; no manual production command.
- Do not disturb the scheduled readings on shared-db issue 5747 (Nov 12,
  9:47 PM EST, and Nov 18); do not start scored runs that overlap them.
- Wait on PRs with the bounded waiter (`ai-pr-wait`), never a hand-written
  loop; it refuses until the task class is declared with `ai-task-gates`.
- Do not pick up AG Grid license issues. Do not screenshot PopSG Settings.
- Sign everything posted to GitHub with `$AI_GH_SIGNATURE`.

## 8. Access and environment

- Machine `hetz`; `gh` authenticated as `u2giants`. `ssh edge-dev` reaches the
  indexing PC.
- Live database: Supabase project `qsllyeztdwjgirsysgai` (read-only by default).
- Secrets: 1Password vault `vibe_coding` — viewer tester login for the search
  harness, the publishable key, and the database password; values never in
  chat or files. A config value named `TEXT_EMBED_KEY` appeared once in a local
  query result during this work; it never left this computer, so it was
  redacted and not rotated.
- The judged set lives in the `admin_config` key `SEARCH_EVAL_SET_V1`; workflow
  "Search test set"
  ([search-eval.yml](https://github.com/u2giants/popdam3/blob/main/.github/workflows/search-eval.yml)).
- Governing plan:
  [plan_vector_consolidation.md](https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md)
  — read its STATUS first.

## 9. Open questions and risks

- **Speed (2026-11-10):** PopSG files p95 after the 887 change read 3987 ms in
  one run against a best earlier 2367 ms; the database's own timing moved
  737 → 779 ms mean, and PopDAM moved by a similar ratio in the same run, so
  shared load is the likely cause. The Nov 12 reading on shared-db issue 5747
  is the next comparable quiet measurement. Not a task; a number to look at.
- **Task 2 may lower a headline score.** That would be the test becoming
  stricter, not search getting worse.
- **Decision, 2026-11-10:** the empty-result retry is PopSG-only by design;
  PopDAM already had spelling and meaning matching.
