# Search test set

A saved, scored definition of good search for PopDAM and PopSG. Run it before and after anything
that changes search or tags, above all the full AI tagging run.

- **Cases and judgments:** database `admin_config` key `SEARCH_EVAL_SET_V1`, never this public repo.
  Licensed names, product codes and file IDs stay out of the repo, issues and reports.
- **Run:** Actions → *Search test set* → Run workflow, with a label such as `before-full-tagging`.
  Compare the job summaries. Reports hold case IDs and scores only.
- **Cost:** live searches at normal speed as the viewer tester. No tagging and no paid model.

## What counts as a pass

| Kind | Pass |
|---|---|
| Exact product code | The right style group is first |
| Nonsense | Nothing returned |
| Misspelling | Rule below, and at least half as many results as the right spelling |
| Everything else | A relevant top-10 result; at least half of judged top-10 results are relevant |
| PopSG guides (not code, nonsense) | A guide named for the search is first. Guides that only contain the character may follow: owner ruling Nov 10, 2026, "Keep all five" |

Results that are not judged are reported as *unjudged*. Over 30% unjudged prints a warning: tagging
legitimately changes results, so judge them before comparing scores.

## PopSG: a known name plus other words (#887)

PopSG keyword search needs every word. When the words contain a known licensor, property or
character name plus other words, `popsg-query-embedding` returns that name as `fallback` with
`fallback_kind`:

- `name`: sent to `search_style_guide_library_v2` as `p_fallback_query`. Results matching every
  word in names, folders or tags stay first; the name's own files and guides follow in the order a
  search for the name alone gives. Totals count both.
- `narrowed_name` (a product word is among the other words, or the words are themselves a whole
  known name) and `spelling`: searched only when the first search returns nothing.

## Judging new results

Run `scripts/search-eval/run.mjs --raw <private file>`, then `scripts/search-eval/label.py`, which
applies each case's stored rule and keeps existing labels, then save the output back to the key.
Store new judgments as a new `version` value inside the key. Keep raw files out of the repo.

## How the first judgments were made

119 searches were written from real catalog names and judged against each file's catalog fields,
folder path and tags. The top 10 of the 65 character searches were also checked by eye on contact
sheets of the actual thumbnails; that overrides the rule when they disagree. Product-form queries
rely on catalog fields because flat art does not show the product. PopSG hits are judged by folder,
file name and tags, so a guide that only mentions a character in its PDF body counts as irrelevant.
Only the style-group view is scored, not the single-file view.

## Recovering a long evaluation

Use `--checkpoint <private file> --phase <before-or-after> --run-id <unique-run>
--source-head <deployed-source-head> --label <label>` to save each completed search engine result atomically.
Restarting with the same checkpoint resumes the identical saved set without
replaying completed requests, including failed requests. A changed set, phase, run identity, source head, target or label is refused.
Use a new checkpoint for each before/after run; source identity is supplied explicitly,
so independently verify the deployed source.
Keep the checkpoint private; it contains query result identifiers and catalog details.
The aggregate report includes the set SHA-256, p50/p95 timings and error categories.
Compare identical sets and preserve natural catalog updates as a limitation; do not
interpret expired authentication or unavailable searches as relevance judgments.

Product-code intent follows the [canonical business rule](https://github.com/popcre/shared-db/blob/main/docs/business-rules/digital-asset-classification-and-tags.md#product-code-searches).
Supplemental policy cases can require an actual returned spelling correction or
semantic execution with picture guesses. The unknown-code policy check does not
judge those guesses relevant; keep them explicitly unjudged and outside the
original 119-case denominator.

The unknown-code picture-guess policy remains open on #680 and #706. The earlier
unindexed format probe was withheld after its bounded full-miss timeout. The
replacement indexed service-only reader from shared-db #5699 is verified installed;
its application consumer is prepared for source review, not yet deployed. It
normalizes only complete mixed ASCII letter/digit strings of 7–64 characters and
requires a positive catalog-format response before preserving picture guesses.
Existing catalog code/prefix identity behavior is unchanged. Unknown short
partials retain existing behavior and remain an explicit coverage gap.

The consumer bounds its required hint to 1000ms and the remaining original 30s
request budget, with Request cancellation and a same-budget handler-entry fallback.
A hint error, malformed response or deadline produces unavailable/Retry before
embedding or downstream search; it never means an unsupported format or empty
results. Local cancellation proof does not establish hosted gateway propagation
or cancellation of already-started server SQL. Keep policy failures separate
from spelling acceptance and relevance judgments; all 119 original and 21
supplemental AFTER cases remain unstarted pending final deployment/readiness.
