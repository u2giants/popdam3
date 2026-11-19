---
issue: 1037
status: OPEN
owner: u2giants
summary: Continue production acceptance of typed PopDAM search after the scored run and canary drill passed.
kind: record
read-when: resuming issue 1037 or interpreting its remaining relevance and indexing gates
---

# Handoff — finish PopDAM typed-search acceptance

Verified November 19, 2026. Start with the STATUS table in the [typed-search plan](https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1037-typed-search-meaning-matching.md) and the latest receipts on [issue #1037](https://github.com/u2giants/popdam3/issues/1037). This handoff updates the next steps from the [earlier rollout handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-18T0942Z-hetz-claude-typed-search-meaning-finish.md), which remains available for its deployment history.

## 0. Business decisions only the owner can make

The expected clock result is limited to clocks for the requested character. Two records currently labeled must-find conflict with that expectation. Inspect the actual artwork and trusted catalog first. If the evidence cannot establish whether either record belongs, ask Albert to adjudicate the two cases together before changing acceptance labels. Recommend keeping a must-find label only when both the clock type and requested character are supported. The normal evidence path and the unattended indexing check can proceed while any business question is open.

The prior plan’s property-only filtering question applies only if a property case still fails after the current fixes. No such failure is reported in the passing suite. Use existing equipment. Consider the prior larger-model option only if fresh evidence shows a meaningful relevance shortfall it could fix.

## 1. What this application is

[PopDAM](https://dam.designflow.app) is POP Creations’ internal artwork library. In the style-group view, search ranks products built from related artwork records. The frontend sends typed searches to [dam-search-ai](https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts), which combines exact words, description/folder meaning, and picture similarity through the shared database. Database structure and promotion belong to [popcre/shared-db](https://github.com/popcre/shared-db). A hosted query service embeds search text, and the two production text-indexing workers embed catalog documents.

## 2. What this session set out to do

The owner reported missing close wording and unrelated products. A named character should restrict results to that character, and relevant products of the requested type should rank first. The remaining job is acceptance of the deployed search for ordinary staff, independent of the harness score. Storage rotation and employee-data issue disposition were separate tracks and do not block search.

## 3. Current production state

- The text-meaning leg is live and enabled. The [Step 8 reference run](https://github.com/u2giants/popdam3/actions/runs/44499851023), dated November 19 at 4:54 AM EST, passed 137 of 137 PopDAM cases with zero errors and p95 of 2.0 seconds on set version 2026-11-19-1037. The one PopSG case failing in both baseline and after runs predates this change. See the [scorecard summary](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7005714227).
- The [signed-in viewer check](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7005745339) at 4:56 AM EST found all seven verified framed results first, no other character in that case, and the expected sort on open. The clock query ranked its eight expected clocks first and returned three extra results afterward. Two of those extra items conflict with the current must-find labels. Screenshots remain private.
- The [canary drill](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7008861370) passed. Both workers were restored, the three test jobs drained with no errors, and [the alert](https://github.com/u2giants/popdam3/issues/1194) auto-closed at 7:17 AM EST. A continuous 24-hour unattended drain is still unproven.
- The [shared-capacity incident](https://github.com/popcre/shared-db/issues/6685) is closed. The import worker cap was verified live. The November 19 [viewer timing check](https://github.com/popcre/shared-db/issues/6685#issuecomment-7012982049) at [10:04–10:07 AM EST](https://github.com/popcre/shared-db/issues/6685#issuecomment-7013015418) returned results on all 30 requests. Warm medians were about 1.2–1.7 seconds, with cold requests up to 6.3 seconds and one warm outlier. A later [first-hit mitigation](https://github.com/u2giants/popdam3/pull/1199) merged while preparing this handoff. Check its live deployment and fresh cold timings before crediting it.
- No search runtime change is included in this documentation handoff. The repository custodian holds #1037. Recheck active work, production mode and current issue evidence before acting.

## 4. Attempts that failed

The early loaded run mixed activation timing with database contention and missed relevance or time gates. The later v2 run recovered speed but regressed previously passing cases, so the earlier activation was reverted at that point. Neither failure applies to the current deployed configuration on its own. The clock investigation simulated licensor restriction, property restriction, a minimum share of tagged files and description-only name matching. Each removed other valid results and does not justify a general rule change. [Earlier v2 results](https://github.com/u2giants/popdam3/issues/1037#issuecomment-6995525302) · [Clock investigation](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7006078524)

## 5. Root causes and key findings

The character alias correctly resolves. One disputed entry qualifies through name text and the other through a member-file tag. Both are must-find in the private scorecard, so suppressing them today makes the existing scorecard fail. A 137/137 result therefore cannot settle the disputed business labels. Confirm the source artwork and catalog identity before changing the truth data or expected labels. Review the third extra result independently because it is distinct from the two disputed must-finds. [Clock diagnosis](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7006078524)

## 6. Exact next steps

1. Read the current plan and issue, and check for another active owner before touching configuration or label data. Confirm the active search setting and private set version without printing the values of secrets or the test data. The gate is a single active owner and a verified starting configuration.
2. Reconcile the viewer clock case against trusted descriptions, artwork and tags using ordinary sign-in. If source evidence proves an incorrect tag or name, correct it through the owning workflow on the existing issue. Update only incorrectly labeled private scorecard cases grounded in those findings. Gate: the expected list and the production business evidence agree, with the three extra results accounted for.
3. Run the supported [search evaluation workflow](https://github.com/u2giants/popdam3/actions/workflows/search-eval.yml) after a stable release window. Use the [scorecard guide](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md). Read the actual artifact. Gate: all 137 expected PopDAM cases pass, errors are zero, p95 is under three seconds, and an ordinary signed-in viewer independently sees the agreed clock results and the frame control. Record aggregate proof on #1037.
4. Verify the indexing lane ran for a continuous 24-hour unattended window after the drill restoration. Use worker and canary evidence across the window, including queue progress, recovery or drain, and any errors. Gate: the recorded window proves the lane kept up without a manual restart or intervention. The completed drill can be cited.
5. Verify whether the preview-only refresh-on-edit proof still needs a production test under the plan. Prefer observed ordinary edits with no fabricated live asset changes. Gate: any required refresh proof is recorded or remains explicitly unchecked.
6. Update the plan STATUS with the fresh receipts, retire this handoff once its obligations are complete, and close #1037 only after the viewer and queue gates pass.

## 7. Constraints

Use the established application route for settings and [shared-db’s governed release route](https://github.com/popcre/shared-db) for structural changes. Keep licensed product identifiers, screenshots, raw scorecard cases and credentials out of public artifacts. Preserve named-character behavior and avoid broad ranking changes to compensate for suspect source data. Measure cold and warm latency separately. Keep the current mode during wrap-up. If later testing verifies a regression, follow the plan’s documented rollback route.

## 8. Access and environment

Use the production PopDAM viewer tester and scoped evaluation access in 1Password vault `vibe_coding`, through the protected method in the [1Password guide](https://github.com/u2giants/popdam3/blob/main/docs/1password.md). The [search evaluation guide](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md) names the evaluator inputs and gates. Verify production project identity privately before database checks. Worker details are in the [indexing worker guide](https://github.com/u2giants/popdam3/blob/main/apps/image-embed-worker/README.md). GitHub custody for this issue is `u2giants`.

## 9. Open questions and closeout boundary

The remaining uncertainty is how the disputed clock entries should be labeled based on trusted content, plus the continuous unattended window and any outstanding refresh proof. Section 0 covers the only potential business question. The [storage rotation issue](https://github.com/u2giants/popdam3/issues/714) is closed and ordinary new thumbnail verification is recorded in the [rotation closeout](https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-714-replace-do-spaces-key.md). The [employee-data issue](https://github.com/u2giants/popdam3/issues/1022#issuecomment-6985401487) was closed by owner direction. Current files and discussion were redacted. Historical removal was outside the closure and remains unverified. Neither closed issue is a task for this successor.

Self-audit passed. Sections 1–3 identify the application, delivered scope and proof. Sections 4–5 preserve failed attempts and the source-label conflict. Section 6 supplies ordered actions and observable gates. Sections 7–8 locate access and constraints through portable references. The decision sweep found the conditional clock-label adjudication and the two existing plan contingencies, all in Section 0. Sections 3 and 9 separate verified production behavior from open acceptance and distinguish the two closed tracks.
