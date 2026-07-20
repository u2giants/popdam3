# Pass 2 — On-Prem PDF Text Extraction Plan

PopDAM rich tech-pack / licensing-sheet PDF extraction is already shipped to production. Pass 1 processed the small set of eligible PDFs that already had `pdf_text_samples.extracted_text`. Pass 2 is the operational step that extracts text from the remaining ~16k–19k eligible PDFs (tech pack / licensing sheet by filename) that do not yet have `pdf_text_samples` rows, and then re-runs the cloud `rich-pdf-extract` worker op so it picks up the newly extracted text and populates `dam.pdf_rich_extraction`, `style_groups.rich_metadata`, and the Material facet.

1. **Verify preconditions before starting**
   1.1. Confirm you are querying the live Virginia project (`qsllyeztdwjgirsysgai`), not the decommissioned Ohio project.
   1.2. Verify `DEEPSEEK_API_KEY` is set in the Railway worker environment (1Password `ai-provider-api-keys/deepseek`).
   1.3. Check on-prem agent state:
        - Prefer the **Windows render agent**: it must be `health.healthy = true`, last heartbeat within ~5 min, and report `version >= 0.16.0` (the `windowsBackfillCapable` gate). If it is not capable/healthy, the heartbeat will fall back to the bridge agent, which works but runs heavy extraction CPU on the Synology.
        - Confirm the agent's `build_sha` matches `BRIDGE_LATEST_BUILD.sha` / the published Windows build to avoid running stale code.
   1.4. Confirm the heartbeat config-key set for the target agent includes `PDF_BACKFILL`, `PDF_EXTRACTION_CONFIG`, and the AI keys (`GOOGLE_AI_API_KEY`, optionally `ANTHROPIC_API_KEY` / OpenRouter).
   1.5. Confirm `admin_config` has the AI keys needed for the OCR/AI-vision fallback (at minimum the ApisTab “Google AI API Key”, since that is the live fallback path per `docs/KNOWN_QUIRKS.md` #63).
   1.6. Decide full-library vs scoped backfill:
        - The existing `PDF_BACKFILL` claim predicate selects **all** `pdf`/`ai` assets not yet in `pdf_text_samples` (~53k total in mid-2026). It has no filename filter for tech-pack/licensing only.
        - A run scoped to just the ~19k eligible PDFs would require a code change (e.g., add a filename filter to `claim_pdf_backfill_batch` or a new `admin_config` mode) plus deploy. Since this is planning-only with no edits, **run the full-library backfill**: it is the only existing mechanism that handles this volume, it unblocks Pass 2 automatically, and it also backfills non-tech-pack PDF text for search/tagging.
   1.7. Reset the backfill bookkeeping to avoid the stale-total early-exit bug:
        - Query `count_pdf_backfill_remaining()` to get the current authoritative count.
        - Set `admin_config.PDF_BACKFILL` to `{ status: "running", total: <that count>, processed: 0, started_at: <now> }`. If a previous run left a stale `total`, this prevents `processed >= total` from stopping the job early.

2. **Trigger the on-prem backfill and watch progress**
   2.1. If a previous `PDF_BACKFILL` run is stuck in `running`, pause it first and wait for the active agent loop to stop (watch `last_heartbeat` and agent logs).
   2.2. Start the backfill by setting `admin_config.PDF_BACKFILL.status = "running"` (with the corrected `total` from step 1.7). The UI path is Settings → PDF Text → PDF & .ai Text Extraction → Start/Resume.
   2.3. Wait for the next heartbeat. The heartbeat response will include `trigger_pdf_backfill: true` for the Windows agent (if capable) or the bridge agent (fallback). The agent then self-drives: `claim-pdf-backfill-batch` → process 25 files → `complete-pdf-backfill-batch` → repeat.
   2.4. Watch progress in these places:
        - **UI:** Settings → PDF Text shows queued/processed/remaining, current file, method/error stats, and agent heartbeat.
        - **DB:** `admin_config.PDF_BACKFILL` value.
        - **Authoritative remaining count:** `count_pdf_backfill_remaining()` RPC.
        - **Agent health:** `agent_registrations` filtered by `agent_type = 'windows-render'` (or `bridge`), checking `last_heartbeat`, `health.healthy`, and `metadata.version_info.version`.
        - **Logs:** Windows agent VM logs or bridge container logs for per-file `extraction_method`, `char_count`, and errors.

3. **Risks / gotchas to detect**
   3.1. **Wrong routing target:** If the Windows agent is unhealthy or `< 0.16.0`, the backfill falls back to the bridge agent and hammers the Synology CPU. Detect by monitoring `agent_registrations.agent_type` and the agent logs for which agent is claiming batches.
   3.2. **Stale `total` causing early stop:** Always use `count_pdf_backfill_remaining()` as the ground truth. If the UI/admin_config shows `completed` while `count_pdf_backfill_remaining() > 0`, the `total` was too low — reset and resume.
   3.3. **Concurrent double-processing:** `claim_pdf_backfill_batch` is non-locking. If you switch from bridge → Windows without pausing, both agents may claim the same batch. It is safe (`ON CONFLICT ignoreDuplicates` dedupes) but wasteful. Handoff: pause → wait → resume on the new target.
   3.4. **AI-vision fallback disabled:** If `GOOGLE_AI_API_KEY` (and optional Anthropic/OpenRouter) is missing, scanned PDFs that mupdf/OCR cannot read will return `failed`. Detect via a high `failed` rate in method stats.
   3.5. **Large files skipped:** Files >100 MB are intentionally skipped; this is expected.
   3.6. **Agent crash loop (historically fixed):** Watch for rapid process restarts / `unhandledRejection` logs. Current code catches claim/commit faults, but verify by checking agent uptime and heartbeat continuity.
   3.7. **Backfill self-drives once started:** A single heartbeat trigger starts the loop; it continues independently of subsequent heartbeats. To stop, you must set `PDF_BACKFILL.status = "paused"`.
   3.8. **Wrong-database trap:** All progress queries must hit `qsllyeztdwjgirsysgai`; the default Supabase MCP tooling may still point at the frozen Ohio project.
   3.9. **`.ai` files in the queue:** The full backfill also processes `.ai` files. They will not be consumed by `rich-pdf-extract` (which only looks at `file_type = 'pdf'`), so they are “extra” work from the Pass 2 perspective but useful elsewhere.

4. **Confirm Pass 2 text extraction is done, then re-run `rich-pdf-extract`**
   4.1. On-prem extraction is complete when:
        - `count_pdf_backfill_remaining()` returns `0` (or only non-eligible `.ai`/non-tech-pack files you intentionally skipped remain).
        - `admin_config.PDF_BACKFILL.status` has normalized to `completed`.
        - A spot-check query confirms the eligible PDF subset has text: count of `assets` where `file_type = 'pdf'`, `is_deleted = false`, filename matches `isStyleGuideSourcePdf`, and no matching `pdf_text_samples` row, should be ~0.
   4.2. Re-trigger the rich extraction:
        - UI path: Settings → PDF Text → **Rich PDF Extraction → Run**.
        - The worker op `rich-pdf-extract` will scan `pdf_text_samples` for eligible PDFs with text and process them in resumable batches.
   4.3. Watch `rich-pdf-extract` progress:
        - `dam.pdf_rich_extraction` row count grows.
        - `style_groups.rich_metadata` becomes non-null for affected groups.
        - `assets.product_material` / `product_dimensions` populate.
        - The worker op returns `done: true` and `eligible.length === 0` when fully scanned.
   4.4. Because the op is idempotent via `source_text_sha256`, re-running it after the on-prem backfill is safe and will only process newly extracted/changed text.
   4.5. Final validation:
        - Sample rows in `dam.pdf_rich_extraction` and verify `data.production_specs.materials` is populated.
        - Check that the Material facet (`get_dam_material_facets()` or distinct `assets.product_material`) now has options.
        - Confirm `refresh_dam_search_style_group_document` was called for affected groups so search includes the new rich metadata.
