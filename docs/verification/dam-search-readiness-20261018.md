# DAM search readiness — October 18, 2026

Owner: Codex chat `01a14ffa-5096-74b2-861c-097dd88f86cd`. Acceptance stays on [#97](https://github.com/u2giants/popdam3/issues/97). This is DAM-only preparation under [the reviewed plan](../../plan_semantic_search_popdam_popsg.md), not activation or closure. PopSG #107, shared-db #4437 and its repair are not DAM prerequisites.

## Reproduction and source

Dedicated current-upstream worktree started from `5e6430f520dcf496abc17e556ed1a26f2819417e`. The canonical checkout and other sessions' work were untouched. Concurrent PopSG coordinator is in its database stage; its subsequent #422 changes a separate verification document. No database object, author lane or exclusive stage was claimed by this DAM preparation.

Live aggregate/catalog reads used the supported management endpoint for production `qsllyeztdwjgirsysgai`, `read_only: true`, returning `supabase_read_only_user` and `transaction_read_only=on`. No DDL/DML, configuration change, indexing or paid tagging request was submitted. Installed vector index is HNSW/cosine over pgvector. Keep gte-small/384; no alternative extension/model adoption.

## Metadata release gate — failed, not waived

At October 18, 2026, 1:09 PM EDT, the current authorized 8,663 unique asset cohort was completely read in 50-ID chunks and active normalized tag results fully paginated in deterministic 1,000-row pages. Cohort SHA-256: `7239a49e31e89939b4f56d654a5e6b617a179db81847be55cd45afeaa9410a46`. Asset presence and uniqueness were asserted against the entire cohort.

Passing requires nonblank saved `ai_description`, matching `ai_model=meta-direct/muse-spark-1.3-contributor`, saved tagging timestamp, active asset and at least one active `asset_tags` row with `source=ai` and matching `model`. **3,719 pass; 4,944 incomplete; 40,370 matching active tag rows.** Counts are a dated audit, never an operation-completion inference. [Published on #96](https://github.com/u2giants/popdam3/issues/96#issuecomment-6252772555).

The original interrupted operation remained cursor 64/revision 841/`ambiguous_submission`; its state and key were not changed. The existing fresh operation was running, cursor 3,562, 24 recorded failures, last saved update 1:08:48 PM EDT. These counters do not discharge saved-row acceptance. Its worker heartbeat was current-main `5e6430f5` at 1:07:58 PM EDT. The owning “Muse tagging Popdam #96” chat was idle on inspection (latest session activity October 18 at 9:45 AM EDT); the worker itself was active. No duplicate operation, original recovery or key rotation is authorized here.

At 1:18 PM EDT, resolving the metadata plan's approved **28 SKU identities** against today's groups found all 28, **zero nonblank group profiles and zero active group tags**. Historical UUIDs and past completion counters cannot pass retained-group acceptance. #96's existing owner retains this prerequisite as well as current file-scope completion/failures. The required dated passing release artifact has not been published; indexing/activation must remain stopped.

## Coverage and capacity baseline

At approximately 1:05 PM EDT: 150,459 documents; 4,505 non-null vectors, all labeled gte-small; no leased/error rows. This establishes physical/model-label coverage only, not current input/hash/build identity. Search mode, automatic embedding and semantic floor settings had no saved rows. The existing indexing operation is interrupted at cursor 4,298 with batch size three; it was not reset or resumed.

At approximately 1:14 PM EDT, the source-age aggregate showed 139,331 asset documents (38,601 indexed in the last 24 hours, 51 in ten minutes), and 11,128 group documents (4,447 indexed in 24 hours, 3,390 in ten minutes). These are touched-row age counts, not distinct source-event arrival rates or proof that nightly UUID churn has been solved. They expose a material capacity concern: three documents/minute gives at most 180/hour. Do not claim sustainable freshness or freeze a synthetic ordinary-change burst from these incomplete event measurements. Measure a real ordinary burst and nightly replacement cycle after metadata release; preserve stable SKU/content/membership identity.

## Independent application repair

The additive authenticated `dam-search-ai` action `search-modes` checks the caller's existing DAM access before privileged mode reading, returns only `{modes:{dam:"keyword"|"hybrid"}}`, rejects service identities and exposes no raw settings, thresholds or SG configuration. Browser mode reads use this capability with the existing 30-second cache. Missing/invalid settings remain keyword-safe. Current production non-secret setting policy permits ordinary role reads, but the capability removes that dependency and explicitly enforces DAM access. SG adapters/settings/corpus are unchanged and may extend the additive response later.

HTTP 401/403 and database access denial now propagate through DAM ranked lookup, asset/group lists, counts/facets and keyword fallback decisions. The edge maps database denial to HTTP 403 instead of an unclassified exception. No alternate retrieval route follows denial. Existing access-denied messaging recognizes the HTTP error; expired sessions receive a sign-in action that signs out only the local session. Availability failures retain keyword fallback. Browser capability/search requests cancel at six seconds using AbortController; this is not proof of the complete live fallback latency gate or cancellation of hosted model execution.

## Remaining governed database/application work

The live effective `public.search_dam_documents` eight-argument function still caps semantic candidates at 20,000 **before** active filters; it has no explicit embedding-model predicate. Its row-return envelope supplies count/facets only alongside page rows, so an out-of-range page loses the summary. Keyword group search additionally rolls up matching member assets, while the hybrid function starts from direct group documents. These source/catalog findings must be addressed and tested through a narrowly claimed canonical shared-db change before activation; no migration or DDL belongs in this app. Inspect current claims first, claim only actual DAM functions/helpers changed, and preserve SG's protected objects. A new response contract must land before any dependent adapter edit.

The edge also clamps each request to 200 while the Library permits 500-row pages; whole-page chunking/count parity and cancellation are not delivered by this repair. This increment claims access handling and a capability endpoint only, not full paging/facet/relevance acceptance. No fixed private query judgments or semantic relevance scorecard has yet been frozen. Those, exact keyword retention, filtered recall, multi-user load, current-model canaries, sustainable freshness, shared-lane exclusion, stop/resume/restart, outage, rollback/restoration and observation remain on #97.

## Validation and delivery receipts

Targeted runtime tests cover administrator/designer/viewer capability access, denial before privileged reading, all five DAM list/count/facet surfaces, no keyword callback after 401/403, normal outage fallback, 30-second expiry/invalidation and actual six-second abort. UI tests distinguish denied access from expired sessions and preserve sign-in retry on failure. Validation, independent review, merge and live receipts are recorded on the same #97 after publication; do not infer delivery from this pre-release source document.

The initial full root suite under unrestricted workers timed out on unrelated grid/SG tests while builds/typechecks also ran. The bounded two-worker rerun passed all 96 files / 646 tests, one skipped, before the final two UI tests were added; final targeted suite passed 35 tests. Production build and lint passed (existing warnings). A standalone TypeScript check reports preexisting repository errors; a clean upstream worktree reproduces the same diagnostics apart from shifted line numbers in the edited asset hook. No new diagnostic is accepted as baseline without that comparison. Final source checks/review receipts belong on #97, including any later rerun.

Protected scripts/aggregate receipts stay outside Git. No authenticated responses, access tokens, real query judgments, descriptions, asset IDs or licensed paths are included here or in reviewer material. Source, reviewer and operational receipts must be retained at closeout; another session's private manifest/checker/receipts were only read, never overwritten.
